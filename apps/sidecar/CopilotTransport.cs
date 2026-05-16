using System.Net.WebSockets;
using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

public interface ICopilotTransport
{
    Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken);
    Task<string> SendAsync(string prompt, CancellationToken cancellationToken);
}

public static class CopilotTransportFactory
{
    public static ICopilotTransport FromEnvironment()
    {
        var mock = Environment.GetEnvironmentVariable("RELAY_COPILOT_MOCK_RESPONSE");
        var mockResponses = Environment.GetEnvironmentVariable("RELAY_COPILOT_MOCK_RESPONSES_JSON");
        var allowMock = Environment.GetEnvironmentVariable("RELAY_ALLOW_MOCK_COPILOT") == "1";
        if (allowMock && !string.IsNullOrWhiteSpace(mockResponses))
        {
            var responses = JsonSerializer.Deserialize<List<string>>(mockResponses, JsonOptions.Default) ?? [];
            return new MockCopilotTransport(responses.Count > 0 ? responses : [""]);
        }
        if (allowMock && !string.IsNullOrWhiteSpace(mock))
        {
            return new MockCopilotTransport([mock]);
        }

        var portText = Environment.GetEnvironmentVariable("RELAY_COPILOT_CDP_PORT");
        return int.TryParse(portText, out var port)
            ? new EdgeCdpCopilotTransport(port)
            : new MissingCopilotTransport("Set RELAY_COPILOT_CDP_PORT to a signed-in Edge CDP port.");
    }
}

public sealed class MissingCopilotTransport(string reason) : ICopilotTransport
{
    public Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken) =>
        Task.FromResult(new ReadinessCheck("copilot-cdp", false, reason));

    public Task<string> SendAsync(string prompt, CancellationToken cancellationToken) =>
        throw new InvalidOperationException(reason);
}

public sealed class MockCopilotTransport(IReadOnlyList<string> responses) : ICopilotTransport
{
    private int _index;

    public Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken) =>
        Task.FromResult(new ReadinessCheck("copilot-cdp", true, "mock Copilot transport enabled for explicit test run."));

    public Task<string> SendAsync(string prompt, CancellationToken cancellationToken)
    {
        var index = Math.Min(Interlocked.Increment(ref _index) - 1, responses.Count - 1);
        return Task.FromResult(responses[index]);
    }
}

public sealed class EdgeCdpCopilotTransport(int port) : ICopilotTransport
{
    private const string CopilotUrl = "https://m365.cloud.microsoft/chat";
    private const int ComposerWaitMs = 25_000;
    private const int ComposerPasteSettlePollMs = 42;
    private const int ComposerPasteSettleKirokuPollMaxMs = 380;
    private const int ComposerPasteSettleKirokuFallbackMs = 240;
    private const int ComposerPasteSettleExecPollMaxMs = 440;
    private const int ComposerPasteSettleExecFallbackMs = 360;
    private const int LongPromptSkipSyncInPageChars = 12_000;
    private const int FastInlineInsertMaxChars = 4_000;
    private const string ComposerDomHelpers = """
  function __raVis(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 20 && rect.height > 10;
  }
  function __raComposerLabelHints(el) {
    if (!el || el.nodeType !== 1) return false;
    const lab = (
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('data-placeholder') || '')
    ).toLowerCase();
    if (!lab.trim()) return false;
    const hints = ['send a message', 'message to copilot', 'copilot', 'メッセージ', '返信', 'type a message', 'reply', 'ask copilot', 'compose', 'prompt'];
    return hints.some((hint) => lab.includes(hint));
  }
  function __raBestInnerTextbox(root) {
    if (!root || !__raVis(root)) return null;
    const inner = root.querySelector && root.querySelector('[contenteditable="true"]');
    return __raVis(inner) ? inner : root;
  }
  function __raWalkFindComposerLabeled(root, depth) {
    if (!root || depth > 18) return null;
    if (root.nodeType === 1 || root.nodeType === 11 || root.nodeType === 9) {
      try {
        if (root.matches && root.matches('[role="textbox"]') && __raComposerLabelHints(root) && __raVis(root)) {
          const el = __raBestInnerTextbox(root);
          if (el) return el;
        }
      } catch (_) {}
      const kids = root.children || root.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        const f = __raWalkFindComposerLabeled(kids[i], depth + 1);
        if (f) return f;
      }
      if (root.shadowRoot) {
        const f = __raWalkFindComposerLabeled(root.shadowRoot, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  function __raFindComposerEditableInDoc(doc, depth) {
    if (!doc || depth > 14) return null;
    const roots = [
      doc.querySelector('#m365-chat-editor-target-element'),
      doc.querySelector('[data-lexical-editor="true"]'),
      doc.querySelector('[role="textbox"][aria-label*="メッセージを送信"]'),
      doc.querySelector('[role="textbox"][aria-label*="Send a message"]'),
      doc.querySelector('main [role="textbox"]'),
      doc.querySelector('[role="main"] [role="textbox"]'),
      doc.querySelector('[role="textbox"][aria-label*="Copilot"]')
    ].filter(Boolean);
    const seen = new Set();
    for (const root of roots) {
      if (!root || seen.has(root)) continue;
      seen.add(root);
      if (!__raVis(root)) continue;
      const inner = root.querySelector && root.querySelector('[contenteditable="true"]');
      const el = __raVis(inner) ? inner : root;
      try { if (doc.defaultView) doc.defaultView.focus(); } catch (_) {}
      return el;
    }
    try {
      const labeled = Array.from(doc.querySelectorAll('[role="textbox"]')).filter((n) => __raComposerLabelHints(n) && __raVis(n));
      for (let i = 0; i < labeled.length; i++) {
        const el = __raBestInnerTextbox(labeled[i]);
        if (el) {
          try { if (doc.defaultView) doc.defaultView.focus(); } catch (_) {}
          return el;
        }
      }
    } catch (_) {}
    const walked = __raWalkFindComposerLabeled(doc.body || doc.documentElement, 0);
    if (walked) {
      try { if (doc.defaultView) doc.defaultView.focus(); } catch (_) {}
      return walked;
    }
    const scope = doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body || doc.documentElement;
    const fallbacks = ['div[role="textbox"][contenteditable="true"]', 'div[role="textbox"]', '[contenteditable="true"]', 'textarea'];
    for (const sel of fallbacks) {
      let el = null;
      try { el = scope.querySelector(sel); } catch (_) { el = null; }
      if (__raVis(el)) {
        try { if (doc.defaultView) doc.defaultView.focus(); } catch (_) {}
        return el;
      }
    }
    let frames;
    try { frames = doc.querySelectorAll('iframe'); } catch (_) { return null; }
    for (let i = 0; i < frames.length; i++) {
      try {
        const found = __raFindComposerEditableInDoc(frames[i].contentDocument, depth + 1);
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }
  function __raFindComposerEditable() {
    return __raFindComposerEditableInDoc(document, 0);
  }
""";

    private const string A11yControlHelpers = """
  function __raNameFromLabelledBy(el) {
    try {
      const id = el.getAttribute('aria-labelledby');
      if (!id) return '';
      const doc = el.ownerDocument || document;
      return id.split(/\s+/).map((part) => doc.getElementById(part)?.textContent || '').join(' ');
    } catch (_) {
      return '';
    }
  }
  function __raActivAccessibleName(el) {
    if (!el || el.nodeType !== 1) return '';
    return [
      el.getAttribute('aria-label') || '',
      __raNameFromLabelledBy(el),
      el.getAttribute('title') || '',
      el.getAttribute('name') || '',
      el.textContent || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }
  function __raActivOk(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8 && rect.bottom > 1 && rect.right > 1 && rect.top < innerHeight - 1 && rect.left < innerWidth - 1;
  }
  function __raIsActivatable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'BUTTON') return true;
    if (tag === 'A' && el.getAttribute('href')) return true;
    const role = el.getAttribute('role');
    return role === 'button' || role === 'menuitem' || role === 'tab';
  }
  function __raHintsMatch(nameLow, hints) {
    return hints.some((hint) => nameLow.includes(hint));
  }
  function __raExcludesMatch(nameLow, excludes) {
    return excludes.some((exclude) => nameLow.includes(exclude));
  }
  function __raWalkClickMatching(root, hints, excludes, depth) {
    if (!root || depth > 22) return false;
    if (root.nodeType === 1) {
      if (__raIsActivatable(root)) {
        const nameLow = __raActivAccessibleName(root).toLowerCase();
        if (nameLow && __raHintsMatch(nameLow, hints) && !__raExcludesMatch(nameLow, excludes) && __raActivOk(root)) {
          try { root.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
          root.click();
          return true;
        }
      }
      const kids = root.children || [];
      for (let i = 0; i < kids.length; i++) {
        if (__raWalkClickMatching(kids[i], hints, excludes, depth + 1)) return true;
      }
      if (root.shadowRoot && __raWalkClickMatching(root.shadowRoot, hints, excludes, depth + 1)) return true;
    } else if (root.nodeType === 11) {
      const kids = root.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        if (__raWalkClickMatching(kids[i], hints, excludes, depth + 1)) return true;
      }
    } else if (root.nodeType === 9) {
      return __raWalkClickMatching(root.documentElement, hints, excludes, depth + 1);
    }
    return false;
  }
  function __raClickLabeledControlDeep(hints, excludes) {
    function tryDoc(doc, depth) {
      if (!doc || depth > 14) return false;
      const top = doc.documentElement || doc.body;
      if (top && __raWalkClickMatching(top, hints, excludes, 0)) return true;
      let frames;
      try { frames = doc.querySelectorAll('iframe'); } catch (_) { return false; }
      for (let i = 0; i < frames.length; i++) {
        try {
          if (tryDoc(frames[i].contentDocument, depth + 1)) return true;
        } catch (_) {}
      }
      return false;
    }
    return tryDoc(document, 0);
  }
""";

    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(10),
    };

    public async Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            var version = await GetBrowserVersionAsync(cancellationToken);
            if (!version.Browser.Contains("Edg", StringComparison.OrdinalIgnoreCase) &&
                !version.Browser.Contains("Edge", StringComparison.OrdinalIgnoreCase))
            {
                return new ReadinessCheck("copilot-cdp", false, $"CDP port {port} is not Microsoft Edge: {version.Browser}");
            }
            var targets = await GetTargetsAsync(cancellationToken);
            var target = targets.FirstOrDefault(IsCopilotTarget) ?? targets.FirstOrDefault(t => t.Type == "page");
            return target is null
                ? new ReadinessCheck("copilot-cdp", false, $"Edge CDP port {port} has no page target.")
                : new ReadinessCheck("copilot-cdp", true, $"Edge CDP port {port} ready ({version.Browser}).");
        }
        catch (Exception ex)
        {
            return new ReadinessCheck("copilot-cdp", false, ex.Message);
        }
    }

    public async Task<string> SendAsync(string prompt, CancellationToken cancellationToken)
    {
        var closeWhenDone = Environment.GetEnvironmentVariable("RELAY_COPILOT_FRESH_TARGET") == "1";
        var target = await ResolveCopilotTargetAsync(cancellationToken);
        if (Environment.GetEnvironmentVariable("RELAY_COPILOT_PASTE_TRACE") == "1")
        {
            Console.Error.WriteLine($"[relay:copilot:target] id={target.Id} url={target.Url}");
        }
        await using var session = await CdpSession.ConnectAsync(target.WebSocketDebuggerUrl, cancellationToken);
        try
        {
            await session.SendAsync("Runtime.enable", null, cancellationToken);
            await session.SendAsync("Page.enable", null, cancellationToken).ConfigureAwait(false);
            await session.SendAsync("Page.bringToFront", null, cancellationToken).ConfigureAwait(false);
            await EnsureCopilotPageAsync(session, cancellationToken);
            if (Environment.GetEnvironmentVariable("RELAY_COPILOT_SKIP_NEW_CHAT") != "1")
            {
                await TryStartNewChatAsync(session, cancellationToken);
                await EnsureCopilotPageAsync(session, cancellationToken);
            }

            var baseline = await GetConversationTextAsync(session, cancellationToken);
            await using var networkCapture = await CopilotNetworkCapture.StartAsync(session, cancellationToken);
            var pasted = await PastePromptAsync(session, prompt, cancellationToken);
            await SubmitPromptAsync(session, prompt.Length, pasted, cancellationToken);

            return await WaitForReplyAsync(session, baseline, prompt, networkCapture, cancellationToken);
        }
        finally
        {
            if (closeWhenDone)
            {
                await TryCloseTargetAsync(session, target.Id);
            }
        }
    }

    private async Task<CdpTarget> ResolveCopilotTargetAsync(CancellationToken cancellationToken)
    {
        if (Environment.GetEnvironmentVariable("RELAY_COPILOT_FRESH_TARGET") == "1")
        {
            return await CreateCopilotTargetAsync(cancellationToken);
        }

        var targets = await GetTargetsAsync(cancellationToken);
        var target = targets.LastOrDefault(IsCopilotTarget);
        if (target is not null) return target;

        target = targets.LastOrDefault(IsLoginTarget) ?? targets.LastOrDefault(t => t.Type == "page");
        if (target is not null) return target;

        return await CreateCopilotTargetAsync(cancellationToken);
    }

    private async Task<CdpTarget> CreateCopilotTargetAsync(CancellationToken cancellationToken)
    {
        var createUrl = $"http://127.0.0.1:{port}/json/new?{Uri.EscapeDataString("https://m365.cloud.microsoft/chat")}";
        using var response = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Put, createUrl), cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var target = JsonSerializer.Deserialize<CdpTarget>(body, JsonOptions.Default);
        if (target?.WebSocketDebuggerUrl is null)
        {
            throw new InvalidOperationException("Edge CDP did not create a Copilot target.");
        }
        return target;
    }

    private async Task<IReadOnlyList<CdpTarget>> GetTargetsAsync(CancellationToken cancellationToken)
    {
        var body = await _http.GetStringAsync($"http://127.0.0.1:{port}/json", cancellationToken);
        return JsonSerializer.Deserialize<List<CdpTarget>>(body, JsonOptions.Default) ?? [];
    }

    private async Task<CdpVersion> GetBrowserVersionAsync(CancellationToken cancellationToken)
    {
        var body = await _http.GetStringAsync($"http://127.0.0.1:{port}/json/version", cancellationToken);
        return JsonSerializer.Deserialize<CdpVersion>(body, JsonOptions.Default) ?? new CdpVersion("");
    }

    private static bool IsCopilotTarget(CdpTarget target) =>
        target.Type == "page"
        && (target.Url.Contains("m365.cloud.microsoft/chat", StringComparison.OrdinalIgnoreCase)
            || target.Url.Contains("copilot.microsoft.com", StringComparison.OrdinalIgnoreCase));

    private static bool IsLoginTarget(CdpTarget target) =>
        target.Type == "page"
        && (target.Url.Contains("login.microsoftonline.com", StringComparison.OrdinalIgnoreCase)
            || target.Url.Contains("login.live.com", StringComparison.OrdinalIgnoreCase));

    private static async Task EnsureCopilotPageAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var href = await session.EvaluateJsonAsync<string>("location.href", cancellationToken);
        if (!LooksLikeCopilotOrLoginUrl(href))
        {
            await session.SendAsync("Page.navigate", new { url = CopilotUrl }, cancellationToken);
        }

        for (var attempt = 0; attempt < 120; attempt++)
        {
            var ready = await session.EvaluateJsonAsync<bool>("document.readyState === 'complete' || document.readyState === 'interactive'", cancellationToken);
            var health = await InspectCopilotPageHealthAsync(session, cancellationToken);
            if (!health.Healthy && ready)
            {
                throw new InvalidOperationException($"copilot_page_unhealthy: {health.Reason}");
            }
            var composerReady = await HasVisibleComposerAsync(session, cancellationToken);
            if (ready && composerReady) return;
            await Task.Delay(500, cancellationToken);
        }

        throw new InvalidOperationException("composer_not_ready: Copilot composer did not become visible.");
    }

    private static Task<CopilotPageHealth> InspectCopilotPageHealthAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const href = location.href || '';
  const title = document.title || '';
  const body = (document.body ? document.body.innerText : '') || '';
  const sample = body.slice(0, 2500);
  if (/DNS error|host name.*does not exist|ERR_NAME_NOT_RESOLVED|This site can.t be reached/i.test(title + '\n' + sample)) {
    return { healthy: false, reason: 'dns_error_or_unreachable_page' };
  }
  if (/Aw,\s*Snap|STATUS_ACCESS_VIOLATION|crashed/i.test(title + '\n' + sample)) {
    return { healthy: false, reason: 'edge_page_crashed' };
  }
  if (/Sign in|サインイン|login/i.test(title + '\n' + sample) && !/m365\.cloud\.microsoft\/chat|copilot\.microsoft\.com/i.test(href)) {
    return { healthy: true, reason: 'login_page' };
  }
  return { healthy: true, reason: 'ok' };
})()
""";
        return session.EvaluateJsonAsync<CopilotPageHealth>(script, cancellationToken);
    }

    private static bool LooksLikeCopilotOrLoginUrl(string? href) =>
        !string.IsNullOrWhiteSpace(href)
        && (href.Contains("m365.cloud.microsoft/chat", StringComparison.OrdinalIgnoreCase)
            || href.Contains("copilot.microsoft.com", StringComparison.OrdinalIgnoreCase)
            || href.Contains("login.microsoftonline.com", StringComparison.OrdinalIgnoreCase)
            || href.Contains("login.live.com", StringComparison.OrdinalIgnoreCase));

    private static Task<bool> HasVisibleComposerAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  return !!__raFindComposerEditable();
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task TryStartNewChatAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var clicked = await ClickLabeledControlAsync(
            session,
            ["new chat", "new conversation", "start new", "新しいチャット", "新規チャット", "新しい会話"],
            ["history", "履歴", "settings", "設定", "close", "閉じる"],
            cancellationToken);
        if (clicked)
        {
            await Task.Delay(1200, cancellationToken);
        }
    }

    private static async Task TryCloseTargetAsync(CdpSession session, string targetId)
    {
        try
        {
            await session.SendAsync("Target.closeTarget", new { targetId }, CancellationToken.None);
        }
        catch
        {
            // Closing the temporary Copilot tab is best-effort.
        }
    }

    private static Task<string> GetConversationTextAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  const selectors = ['[role="feed"]', '[aria-label="Chat conversation"]'];
  let best = '';
  for (const doc of docs) {
    for (const selector of selectors) {
      for (const el of Array.from(doc.querySelectorAll(selector))) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width <= 20 || rect.height <= 20 || style.visibility === 'hidden' || style.display === 'none') continue;
        const text = String(el.innerText || el.textContent || '').trim();
        if ((text.includes('Copilot said:') || text.includes('You said:')) && text.length > best.length) {
          best = text;
        }
      }
    }
  }
  return best || (document.body ? document.body.innerText : '');
})()
""";
        return session.EvaluateJsonAsync<string>(script, cancellationToken);
    }

    private static async Task<int> PastePromptAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var tracePaste = Environment.GetEnvironmentVariable("RELAY_COPILOT_PASTE_TRACE") == "1";
        void Trace(string message)
        {
            if (tracePaste) Console.Error.WriteLine($"[relay:copilot:paste] {message}");
        }

        var timing = CopilotPromptTiming.Default;
        Trace($"begin chars={prompt.Length}");
        await TrySendAsync(session, "Runtime.enable", null, cancellationToken);
        await TrySendAsync(session, "DOM.enable", null, cancellationToken);
        await EnableCdpInputAsync(session, cancellationToken);
        await WaitForComposerAsync(session, cancellationToken);
        Trace("composer-ready");
        await Task.Delay(timing.ComposerReadyDelayMs, cancellationToken);

        var preClearLen = await GetComposerLengthAsync(session, cancellationToken);
        Trace($"pre-clear-len={preClearLen}");
        if (preClearLen > 0)
        {
            await ClearComposerViaKeyboardAsync(session, cancellationToken);
            await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
        }

        await FocusComposerAsync(session, cancellationToken);
        await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);

        Exception? insertError = null;
        var len = 0;
        var pasted = false;
        var needMin = PasteNeedMinChars(prompt.Length);
        var skipSyncInPage = prompt.Length > LongPromptSkipSyncInPageChars;
        var skipBulkFallbacks = false;

        if (timing.FastInline && prompt.Length <= FastInlineInsertMaxChars)
        {
            try
            {
                Trace("fast-inline-begin");
                await session.SendAsync("Input.insertText", new { text = prompt }, cancellationToken);
                len = await WaitForComposerPasteSettleAsync(
                    session,
                    prompt.Length,
                    maxPollMs: 360,
                    fallbackMs: 120,
                    cancellationToken);
                Trace($"fast-inline-len={len}");
                skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
            }
            catch (Exception ex)
            {
                insertError = ex;
                Trace($"fast-inline-error={ex.Message}");
            }
        }

        if (!skipBulkFallbacks && len > 0)
        {
            await ClearComposerViaKeyboardAsync(session, cancellationToken);
            await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);
            len = await GetComposerLengthAsync(session, cancellationToken);
        }

        if (!skipBulkFallbacks)
        {
            Trace("native-clipboard-begin");
            var nativePasteOk = await PasteViaNavigatorClipboardAsync(session, prompt, cancellationToken);
            Trace($"native-clipboard-ok={nativePasteOk}");
            if (nativePasteOk)
            {
                len = await WaitForComposerPasteSettleAsync(
                    session,
                    prompt.Length,
                    ComposerPasteSettleKirokuPollMaxMs,
                    ComposerPasteSettleKirokuFallbackMs,
                    cancellationToken);
                Trace($"native-clipboard-len={len}");
                skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
            }
        }

        if (!skipBulkFallbacks && len > 0)
        {
            await ClearComposerViaKeyboardAsync(session, cancellationToken);
            await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);
            len = await GetComposerLengthAsync(session, cancellationToken);
        }

        if (!skipBulkFallbacks && prompt.Length <= 16_000)
        {
            Trace("kiroku-begin");
            var kirokuOk = await PasteViaKirokuOuterClipboardOnlyAsync(session, prompt, cancellationToken);
            Trace($"kiroku-ok={kirokuOk}");
            if (kirokuOk)
            {
                len = await WaitForComposerPasteSettleAsync(
                    session,
                    prompt.Length,
                    ComposerPasteSettleKirokuPollMaxMs,
                    ComposerPasteSettleKirokuFallbackMs,
                    cancellationToken);
                Trace($"kiroku-len={len}");
                skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
            }
        }

        if (!skipBulkFallbacks && len > 0)
        {
            await ClearComposerViaKeyboardAsync(session, cancellationToken);
            await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);
            len = await GetComposerLengthAsync(session, cancellationToken);
        }

        if (!skipBulkFallbacks && !skipSyncInPage)
        {
            try
            {
                Trace("sync-exec-begin");
                await PasteViaSyncBrowserExecCommandAsync(session, prompt, cancellationToken);
                Trace("sync-exec-end");
            }
            catch
            {
                Trace("sync-exec-error");
                // This fallback is opportunistic; the next path verifies whether text landed.
            }

            len = await WaitForComposerPasteSettleAsync(
                session,
                prompt.Length,
                ComposerPasteSettleExecPollMaxMs,
                ComposerPasteSettleExecFallbackMs,
                cancellationToken);
            Trace($"sync-exec-len={len}");
            skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
        }

        if (!skipBulkFallbacks && prompt.Length > LongPromptSkipSyncInPageChars)
        {
            try
            {
                await InsertTextViaCdpAsync(session, prompt, cancellationToken);
                len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 480, 400, cancellationToken);
                if (PasteLooksComplete(len, prompt.Length))
                {
                    skipBulkFallbacks = true;
                }
                else if (len > 0)
                {
                    await ClearComposerViaKeyboardAsync(session, cancellationToken);
                    await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
                    await FocusComposerAsync(session, cancellationToken);
                    await Task.Delay(80, cancellationToken);
                    insertError = null;
                }
            }
            catch (Exception ex)
            {
                insertError = ex;
            }
        }

        if (!skipBulkFallbacks && !PasteLooksComplete(len, prompt.Length))
        {
            try
            {
                pasted = await PasteViaSyntheticClipboardAsync(session, prompt, cancellationToken);
            }
            catch
            {
                pasted = false;
            }

            len = pasted
                ? await WaitForComposerPasteSettleAsync(session, prompt.Length, 420, 380, cancellationToken)
                : await GetComposerLengthAsync(session, cancellationToken);
            skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
        }

        if (!skipBulkFallbacks && !PasteLooksComplete(len, prompt.Length))
        {
            if (pasted && len > 0)
            {
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(100, cancellationToken);
                await FocusComposerAsync(session, cancellationToken);
                await Task.Delay(80, cancellationToken);
            }

            try
            {
                await InsertTextViaCdpAsync(session, prompt, cancellationToken);
            }
            catch (Exception ex)
            {
                insertError = ex;
            }

            len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 360, 320, cancellationToken);
            skipBulkFallbacks = PasteLooksComplete(len, prompt.Length);
        }

        await Task.Delay(timing.PostPasteDelayMs, cancellationToken);
        len = await GetComposerLengthAsync(session, cancellationToken);

        if (prompt.Length >= 80 &&
            (!PasteLooksComplete(len, prompt.Length) ||
             !await ComposerTextLooksLikePromptAsync(session, prompt, cancellationToken)))
        {
            Trace($"safe-repaste-begin len={len}");
            await ClearComposerViaKeyboardAsync(session, cancellationToken);
            await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);

            if (await PasteViaSyntheticClipboardAsync(session, prompt, cancellationToken))
            {
                len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 700, 500, cancellationToken);
                Trace($"safe-synthetic-len={len}");
            }

            if (!PasteLooksComplete(len, prompt.Length) ||
                !await ComposerTextLooksLikePromptAsync(session, prompt, cancellationToken))
            {
                Trace($"safe-sync-exec-begin len={len}");
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
                await FocusComposerAsync(session, cancellationToken);
                await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);
                await PasteViaSyncBrowserExecCommandAsync(session, prompt, cancellationToken);
                len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 700, 500, cancellationToken);
                Trace($"safe-sync-exec-len={len}");
            }

            if (!PasteLooksComplete(len, prompt.Length) ||
                !await ComposerTextLooksLikePromptAsync(session, prompt, cancellationToken))
            {
                Trace($"safe-cdp-begin len={len}");
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(timing.AfterClearDelayMs, cancellationToken);
                await FocusComposerAsync(session, cancellationToken);
                await Task.Delay(timing.AfterRefocusDelayMs, cancellationToken);
                await InsertTextViaCdpAsync(session, prompt, cancellationToken);
                len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 700, 500, cancellationToken);
                Trace($"safe-cdp-len={len}");
            }
        }

        if (!skipBulkFallbacks &&
            len < needMin &&
            prompt.Length >= 20 &&
            prompt.Length <= 400 &&
            !prompt.Contains('\n', StringComparison.Ordinal))
        {
            await FocusComposerAsync(session, cancellationToken);
            if (await GetComposerLengthAsync(session, cancellationToken) > 0)
            {
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(100, cancellationToken);
            }

            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(100, cancellationToken);
            await InsertTextViaExecCommandAsync(session, prompt, cancellationToken);
            len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 340, 300, cancellationToken);
        }

        if (!skipBulkFallbacks &&
            len < needMin &&
            prompt.Length >= 20 &&
            prompt.Length <= 400 &&
            !prompt.Contains('\n', StringComparison.Ordinal))
        {
            await FocusComposerAsync(session, cancellationToken);
            if (await GetComposerLengthAsync(session, cancellationToken) > 0)
            {
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(100, cancellationToken);
            }

            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(80, cancellationToken);
            await InsertTextViaInputEventsAsync(session, prompt, cancellationToken);
            len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 340, 300, cancellationToken);
        }

        if (!skipBulkFallbacks &&
            len < needMin &&
            prompt.Length >= 20 &&
            prompt.Length <= 400 &&
            !prompt.Contains('\n', StringComparison.Ordinal))
        {
            await FocusComposerAsync(session, cancellationToken);
            if (await GetComposerLengthAsync(session, cancellationToken) > 0)
            {
                await ClearComposerViaKeyboardAsync(session, cancellationToken);
                await Task.Delay(100, cancellationToken);
            }

            await FocusComposerAsync(session, cancellationToken);
            await Task.Delay(80, cancellationToken);
            await InsertTextViaKeyCharsAsync(session, prompt, cancellationToken);
            len = await WaitForComposerPasteSettleAsync(session, prompt.Length, 400, 420, cancellationToken);
        }

        if (prompt.Length >= 20 && !PasteLooksComplete(len, prompt.Length))
        {
            Trace($"final-short-len={len}");
            var floorLong = Math.Min(2200, (int)Math.Floor(prompt.Length * 0.045));
            if (!(prompt.Length > 8000 && len >= 700 && len >= floorLong))
            {
                var hint = insertError is null ? "" : $" CDP insertText error: {insertError.Message}";
                throw new InvalidOperationException($"prompt_insert_failed: Prompt did not reach Copilot composer (visible length {len}, expected ~{prompt.Length}).{hint}");
            }
        }

        if (prompt.Length >= 80 && !await ComposerTextLooksLikePromptAsync(session, prompt, cancellationToken))
        {
            Trace($"final-corrupt-len={len}");
            throw new InvalidOperationException(
                $"prompt_insert_failed: Prompt text reached Copilot composer but was corrupted before submit (visible length {len}, expected ~{prompt.Length}).");
        }

        Trace($"done len={len}");
        await Task.Delay(timing.PostPasteDelayMs, cancellationToken);
        return len;
    }

    private static async Task<bool> PasteViaNavigatorClipboardAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        await TrySendAsync(session, "Browser.grantPermissions", new
        {
            origin = "https://m365.cloud.microsoft",
            permissions = new[] { "clipboardReadWrite", "clipboardSanitizedWrite" }
        }, cancellationToken);

        var promptJson = JsonSerializer.Serialize(prompt);
        var wrote = await session.EvaluateJsonAsync<bool>($$"""
(async (fullText) => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
    await navigator.clipboard.writeText(fullText);
    return true;
  } catch (_) {
    return false;
  }
})({{promptJson}})
""", cancellationToken);
        if (!wrote) return false;

        await FocusComposerAsync(session, cancellationToken);
        await Task.Delay(80, cancellationToken);
        await DispatchPasteShortcutAsync(session, cancellationToken);
        return true;
    }

    private static Task<bool> PasteViaKirokuOuterClipboardOnlyAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var promptJson = JsonSerializer.Serialize(prompt);
        var script = $$"""
((fullText) => {
  const el =
    document.querySelector("#m365-chat-editor-target-element") ??
    document.querySelector('[data-lexical-editor="true"]');
  if (!el) return false;
  try {
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", fullText);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    return true;
  } catch (_) {
    return false;
  }
})({{promptJson}})
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static Task<JsonObject?> PasteViaSyncBrowserExecCommandAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var promptJson = JsonSerializer.Serialize(prompt);
        var script = $$"""
((fullText) => {
{{ComposerDomHelpers}}
  function lenOf(el) {
    if (!el) return 0;
    const raw = el.innerText || el.textContent || "";
    const t = raw.replace(new RegExp(String.fromCharCode(0x200b), "g"), "");
    return t.trim().length;
  }
  const el = __raFindComposerEditable();
  if (!el) return { ok: false, reason: "no_composer", visibleLen: 0 };
  el.focus();
  const doc = el.ownerDocument;
  try { doc.defaultView && doc.defaultView.focus(); } catch (_) {}
  try {
    const sel = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
  const units = Array.from(fullText);
  const step = 1200;
  let execTrue = 0;
  for (let i = 0; i < units.length; i += step) {
    const slice = units.slice(i, i + step).join("");
    try {
      if (doc.execCommand("insertText", false, slice)) execTrue++;
    } catch (e) {
      return { ok: false, reason: String(e && e.message ? e.message : e), visibleLen: lenOf(el), execTrue };
    }
  }
  return { ok: true, visibleLen: lenOf(el), codeUnits: units.length, execTrue };
})({{promptJson}})
""";
        return session.EvaluateJsonAsync<JsonObject?>(script, cancellationToken);
    }

    private static async Task<bool> PasteViaSyntheticClipboardAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var parts = ChunkByCodePoints(prompt, 12_000);
        for (var index = 0; index < parts.Count; index++)
        {
            var partJson = JsonSerializer.Serialize(parts[index]);
            var isFirst = index == 0 ? "true" : "false";
            var script = $$"""
((payload, isFirstPart) => {
{{ComposerDomHelpers}}
  const el = __raFindComposerEditable();
  if (!el) return false;
  if (isFirstPart) {
    el.focus();
    try {
      const sel = el.ownerDocument.getSelection();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', payload);
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      data: payload
    }));
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
    return true;
  } catch (_) {
    return false;
  }
})({{partJson}}, {{isFirst}})
""";
            if (!await session.EvaluateJsonAsync<bool>(script, cancellationToken)) return false;
            await Task.Delay(parts.Count > 1 ? 120 : 80, cancellationToken);
        }

        return true;
    }

    private static async Task InsertTextViaCdpAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var chunkSize = prompt.Length > 8000 ? 380 : 200;
        var chunks = ChunkByCodePoints(prompt, chunkSize);
        var pause = chunks.Count > 50 ? 42 : 30;
        foreach (var chunk in chunks)
        {
            await session.SendAsync("Input.insertText", new { text = chunk }, cancellationToken);
            await Task.Delay(pause, cancellationToken);
        }
    }

    private static async Task InsertTextViaInputEventsAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        foreach (var segment in ChunkByCodePoints(prompt, 4000))
        {
            foreach (var batch in ChunkByCodePoints(segment, 48))
            {
                var batchJson = JsonSerializer.Serialize(batch);
                var script = $$"""
((payload) => {
{{ComposerDomHelpers}}
  const el = __raFindComposerEditable();
  if (!el) return false;
  el.focus();
  for (const c of payload) {
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: c
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: c
    }));
  }
  return true;
})({{batchJson}})
""";
                await session.EvaluateJsonAsync<bool>(script, cancellationToken);
                await Task.Delay(12, cancellationToken);
            }
            await Task.Delay(80, cancellationToken);
        }
    }

    private static async Task InsertTextViaExecCommandAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var chunks = ChunkByCodePoints(prompt, 180);
        for (var index = 0; index < chunks.Count; index++)
        {
            var chunkJson = JsonSerializer.Serialize(chunks[index]);
            var isFirst = index == 0 ? "true" : "false";
            var script = $$"""
((payload, isFirst) => {
{{ComposerDomHelpers}}
  const el = __raFindComposerEditable();
  if (!el) return false;
  if (isFirst) {
    el.focus();
    try {
      const sel = el.ownerDocument.getSelection();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }
  try {
    return el.ownerDocument.execCommand('insertText', false, payload);
  } catch (_) {
    return false;
  }
})({{chunkJson}}, {{isFirst}})
""";
            await session.EvaluateJsonAsync<bool>(script, cancellationToken);
            await Task.Delay(14, cancellationToken);
        }
    }

    private static async Task InsertTextViaKeyCharsAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var units = prompt.EnumerateRunes().ToArray();
        var slice = units.Length > 12_000 ? units.Take(12_000).ToArray() : units;
        foreach (var rune in slice)
        {
            var text = rune.ToString();
            if (text == "\n")
            {
                await DispatchEnterKeyAsync(session, 0, cancellationToken);
            }
            else
            {
                await session.SendAsync("Input.dispatchKeyEvent", new { type = "char", text }, cancellationToken);
            }
        }
    }

    private static async Task<int> WaitForComposerPasteSettleAsync(
        CdpSession session,
        int fullLength,
        int maxPollMs,
        int fallbackMs,
        CancellationToken cancellationToken,
        int intervalMs = ComposerPasteSettlePollMs)
    {
        var len = await GetComposerLengthAsync(session, cancellationToken);
        if (PasteLooksComplete(len, fullLength)) return len;

        var deadline = DateTimeOffset.UtcNow.AddMilliseconds(maxPollMs);
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(intervalMs, cancellationToken);
            len = await GetComposerLengthAsync(session, cancellationToken);
            if (PasteLooksComplete(len, fullLength)) return len;
        }

        if (fallbackMs > 0)
        {
            await Task.Delay(fallbackMs, cancellationToken);
            len = await GetComposerLengthAsync(session, cancellationToken);
        }
        return len;
    }

    private static async Task WaitForComposerAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow.AddMilliseconds(ComposerWaitMs);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (await FocusComposerAsync(session, cancellationToken)) return;
            await Task.Delay(250, cancellationToken);
        }

        throw new InvalidOperationException("composer_not_found: Copilot composer not found or not visible.");
    }

    private static Task<bool> FocusComposerAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  const el = __raFindComposerEditable();
  if (!el) return false;
  try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
  try { el.click(); } catch (_) {}
  el.focus();
  return true;
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task EnableCdpInputAsync(CdpSession session, CancellationToken cancellationToken)
    {
        await TrySendAsync(session, "Page.bringToFront", null, cancellationToken);
        await TrySendAsync(session, "Input.enable", null, cancellationToken);
    }

    private static async Task TrySendAsync(CdpSession session, string method, object? parameters, CancellationToken cancellationToken)
    {
        try
        {
            await session.SendAsync(method, parameters, cancellationToken);
        }
        catch
        {
            // Compatibility shim: some CDP domains/methods are unavailable on older Edge channels.
        }
    }

    private static async Task ClearComposerViaKeyboardAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var modifiers = OperatingSystem.IsMacOS() ? 4 : 2;
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = "a",
            code = "KeyA",
            windowsVirtualKeyCode = 65,
            nativeVirtualKeyCode = 65,
            modifiers
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = "a",
            code = "KeyA",
            windowsVirtualKeyCode = 65,
            nativeVirtualKeyCode = 65,
            modifiers
        }, cancellationToken);
        await Task.Delay(40, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = "Backspace",
            code = "Backspace",
            windowsVirtualKeyCode = 8,
            nativeVirtualKeyCode = 8
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = "Backspace",
            code = "Backspace",
            windowsVirtualKeyCode = 8,
            nativeVirtualKeyCode = 8
        }, cancellationToken);
        await Task.Delay(80, cancellationToken);
    }

    private static Task<bool> ClearComposerViaDomAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  const el = __raFindComposerEditable();
  if (!el) return false;
  try { el.focus(); } catch (_) {}
  try {
    const sel = el.ownerDocument.getSelection();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
  try { el.ownerDocument.execCommand('delete', false); } catch (_) {}
  try {
    if ('value' in el) el.value = '';
    el.textContent = '';
    el.innerHTML = '';
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward',
      data: null
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
      data: null
    }));
  } catch (_) {}
  return true;
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static Task<int> GetComposerLengthAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  const el = __raFindComposerEditable();
  if (!el) return 0;
  const raw = String(('value' in el ? el.value : (el.innerText || el.textContent)) || '');
  return raw.replace(new RegExp(String.fromCharCode(0x200b), 'g'), '').trim().length;
})()
""";
        return session.EvaluateJsonAsync<int>(script, cancellationToken);
    }

    private static Task<string> GetComposerTextAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  const el = __raFindComposerEditable();
  if (!el) return "";
  const raw = el.innerText || el.textContent || "";
  return String(raw).replace(new RegExp(String.fromCharCode(0x200b), "g"), "").trim();
})()
""";
        return session.EvaluateJsonAsync<string>(script, cancellationToken);
    }

    private static async Task<bool> ComposerTextLooksLikePromptAsync(
        CdpSession session,
        string prompt,
        CancellationToken cancellationToken)
    {
        var text = await GetComposerTextAsync(session, cancellationToken);
        return ComposerTextLooksLikePrompt(text, prompt);
    }

    private static bool ComposerTextLooksLikePrompt(string composerText, string prompt)
    {
        var visible = NormalizeForComposerComparison(composerText);
        var expected = NormalizeForComposerComparison(prompt);
        if (expected.Length < 80) return visible.Contains(expected, StringComparison.Ordinal);

        var headLength = Math.Min(160, expected.Length);
        var head = expected[..headLength];
        if (visible.StartsWith(head, StringComparison.Ordinal) || visible.Contains(head, StringComparison.Ordinal))
        {
            return true;
        }

        var userIndex = expected.IndexOf("user:", StringComparison.OrdinalIgnoreCase);
        if (userIndex >= 0)
        {
            var userSlice = expected[userIndex..Math.Min(expected.Length, userIndex + 180)];
            if (userSlice.Length >= 60 && visible.Contains(userSlice, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static string NormalizeForComposerComparison(string text) =>
        Regex.Replace(
                text.Replace("\r", "\n").Replace("\u200b", "").Replace("\ufeff", ""),
                @"\s+",
                " ")
            .Trim();

    private static async Task SubmitPromptAsync(CdpSession session, int expectedPromptLength, int initialComposerLength, CancellationToken cancellationToken)
    {
        var timing = CopilotPromptTiming.Default;
        var minComposer = MinComposerThresholdForSubmit(expectedPromptLength);
        var composerReadyLen = initialComposerLength;
        if (composerReadyLen < minComposer && expectedPromptLength >= 20)
        {
            var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
            while (DateTimeOffset.UtcNow < deadline)
            {
                var n = await GetComposerLengthAsync(session, cancellationToken);
                composerReadyLen = n;
                if (n >= minComposer) break;
                await Task.Delay(200, cancellationToken);
            }
        }

        var lenBefore = await GetComposerLengthAsync(session, cancellationToken);
        var sent = false;
        try
        {
            await TrySubmitViaEnterAsync(session, cancellationToken);
            sent = await ComposerSubmitLooksSentAsync(session, lenBefore, timing.SubmitConfirmDelayMs, cancellationToken);
        }
        catch
        {
            sent = false;
        }

        var deadlineButtons = DateTimeOffset.UtcNow.AddSeconds(45);
        var stableSince = DateTimeOffset.MinValue;
        while (!sent && DateTimeOffset.UtcNow < deadlineButtons)
        {
            var pos = await FindSendButtonCenterAsync(session, cancellationToken);
            if (pos.Ok)
            {
                if (stableSince == DateTimeOffset.MinValue) stableSince = DateTimeOffset.UtcNow;
                if ((DateTimeOffset.UtcNow - stableSince).TotalMilliseconds >= timing.SendButtonStableMs)
                {
                    var domOk = await ClickSendViaDomAsync(session, cancellationToken);
                    if (!domOk)
                    {
                        await ClickLabeledControlAsync(
                            session,
                            ["send", "送信", "submit"],
                            ["stop", "停止", "cancel", "中止", "generating", "作成中"],
                            cancellationToken);
                    }

                    await Task.Delay(520, cancellationToken);
                    var status = await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken);
                    sent = status.Generating || status.Length + 25 < lenBefore;
                    if (!sent)
                    {
                        await ClickSendViaCdpMouseAsync(session, cancellationToken);
                        await Task.Delay(520, cancellationToken);
                        status = await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken);
                        sent = status.Generating || status.Length + 25 < lenBefore;
                    }

                    if (!sent)
                    {
                        stableSince = DateTimeOffset.MinValue;
                        await Task.Delay(500, cancellationToken);
                    }
                }
            }
            else
            {
                stableSince = DateTimeOffset.MinValue;
            }

            if (!sent) await Task.Delay(200, cancellationToken);
        }

        if (!sent)
        {
            await TrySubmitViaCtrlEnterAsync(session, cancellationToken);
            await Task.Delay(2200, cancellationToken);
            var status = await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken);
            sent = status.Generating || status.Length + 30 < lenBefore;
        }

        if (!sent)
        {
            await TrySubmitViaEnterAsync(session, cancellationToken);
            await Task.Delay(300, cancellationToken);
            await ClickSendViaCdpMouseAsync(session, cancellationToken);
            await Task.Delay(2000, cancellationToken);
            var status = await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken);
            sent = status.Generating || status.Length + 30 < lenBefore;
        }

        if (!sent)
        {
            var visible = await GetComposerLengthAsync(session, cancellationToken);
            throw new InvalidOperationException($"submit_not_confirmed: Copilot send failed; composer visible length={visible}.");
        }
    }

    private static async Task TrySubmitViaEnterAsync(CdpSession session, CancellationToken cancellationToken)
    {
        await EnableCdpInputAsync(session, cancellationToken);
        await FocusComposerAsync(session, cancellationToken);
        await Task.Delay(100, cancellationToken);
        await DispatchEnterKeyAsync(session, 0, cancellationToken);
    }

    private static async Task TrySubmitViaCtrlEnterAsync(CdpSession session, CancellationToken cancellationToken)
    {
        await EnableCdpInputAsync(session, cancellationToken);
        await FocusComposerAsync(session, cancellationToken);
        await Task.Delay(100, cancellationToken);
        await DispatchEnterKeyAsync(session, 2, cancellationToken);
    }

    private static async Task DispatchPasteShortcutAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var modifiers = OperatingSystem.IsMacOS() ? 4 : 2;
        await EnableCdpInputAsync(session, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = OperatingSystem.IsMacOS() ? "Meta" : "Control",
            code = OperatingSystem.IsMacOS() ? "MetaLeft" : "ControlLeft",
            windowsVirtualKeyCode = OperatingSystem.IsMacOS() ? 91 : 17,
            nativeVirtualKeyCode = OperatingSystem.IsMacOS() ? 91 : 17,
            modifiers
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = "v",
            code = "KeyV",
            windowsVirtualKeyCode = 86,
            nativeVirtualKeyCode = 86,
            modifiers
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = "v",
            code = "KeyV",
            windowsVirtualKeyCode = 86,
            nativeVirtualKeyCode = 86,
            modifiers
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = OperatingSystem.IsMacOS() ? "Meta" : "Control",
            code = OperatingSystem.IsMacOS() ? "MetaLeft" : "ControlLeft",
            windowsVirtualKeyCode = OperatingSystem.IsMacOS() ? 91 : 17,
            nativeVirtualKeyCode = OperatingSystem.IsMacOS() ? 91 : 17
        }, cancellationToken);
        await Task.Delay(160, cancellationToken);
    }

    private static async Task DispatchEnterKeyAsync(CdpSession session, int modifiers, CancellationToken cancellationToken)
    {
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = "Enter",
            code = "Enter",
            modifiers,
            windowsVirtualKeyCode = 13,
            nativeVirtualKeyCode = 13
        }, cancellationToken);
        await session.SendAsync("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = "Enter",
            code = "Enter",
            modifiers,
            windowsVirtualKeyCode = 13,
            nativeVirtualKeyCode = 13
        }, cancellationToken);
    }

    private static async Task<bool> ComposerSubmitLooksSentAsync(CdpSession session, int lenBefore, int confirmDelayMs, CancellationToken cancellationToken)
    {
        await Task.Delay(confirmDelayMs, cancellationToken);
        var status = await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken);
        return status.Generating || status.Length + 25 < lenBefore;
    }

    private static async Task<ButtonCenter> FindSendButtonCenterAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  function visible(el) {
    return el && el.offsetParent !== null;
  }
  function clickable(el) {
    if (!visible(el)) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    return true;
  }
  function badLabel(label) {
    if (!label) return true;
    return /send feedback|送信する場所|settings|設定|share|共有/i.test(label);
  }
  function controlName(el) {
    return [
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.textContent || "",
    ].join(" ").replace(/\s+/g, " ").trim();
  }
  function isStopOrCancelControl(el) {
    const label = controlName(el);
    return /stop\s+generating|stop\s+response|\bstop\b|cancel\s+response|生成を停止|停止|中断/i.test(label);
  }
  function tryEl(el) {
    if (!clickable(el)) return null;
    if (isStopOrCancelControl(el)) return null;
    const rect = el.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  const bySelector = [
    'button[data-testid="sendButton"]',
    'button[data-testid^="send"]',
    '[data-testid="sendButton"]',
    ".fai-SendButton",
    'button.fai-SendButton',
    'div[role="button"][data-testid="sendButton"]'
  ];
  for (const sel of bySelector) {
    for (const el of document.querySelectorAll(sel)) {
      const p = tryEl(el);
      if (p) return p;
    }
  }
  for (const el of document.querySelectorAll("button, [role='button']")) {
    const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    if (badLabel(label)) continue;
    if (
      /送信(?!.*フィードバック)/.test(label) ||
      /^send$/i.test(label) ||
      /send message/i.test(label) ||
      (label.includes("Send") && !/sending|sender/i.test(label)) ||
      /^reply$/i.test(label)
    ) {
      const p = tryEl(el);
      if (p) return p;
    }
  }
  return { ok: false, x: 0, y: 0 };
})()
""";
        return await session.EvaluateJsonAsync<ButtonCenter>(script, cancellationToken) ?? new ButtonCenter(false, 0, 0);
    }

    private static Task<bool> ClickSendViaDomAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  function visible(el) {
    return el && el.offsetParent !== null;
  }
  function clickable(el) {
    if (!visible(el)) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    return true;
  }
  function badLabel(label) {
    if (!label) return true;
    return /send feedback|送信する場所|settings|設定/i.test(label);
  }
  function controlName(el) {
    return [
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.textContent || "",
    ].join(" ").replace(/\s+/g, " ").trim();
  }
  function isStopOrCancelControl(el) {
    const label = controlName(el);
    return /stop\s+generating|stop\s+response|\bstop\b|cancel\s+response|生成を停止|停止|中断/i.test(label);
  }
  const bySelector = [
    'button[data-testid="sendButton"]',
    'button[data-testid^="send"]',
    ".fai-SendButton",
    'button.fai-SendButton'
  ];
  for (const sel of bySelector) {
    for (const el of document.querySelectorAll(sel)) {
      if (isStopOrCancelControl(el)) continue;
      if (clickable(el)) {
        el.click();
        return true;
      }
    }
  }
  for (const el of document.querySelectorAll("button, [role='button']")) {
    const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    if (badLabel(label)) continue;
    if (
      /送信(?!.*フィードバック)/.test(label) ||
      /^send$/i.test(label) ||
      /send message/i.test(label) ||
      (label.includes("Send") && !/sending|sender/i.test(label)) ||
      /^reply$/i.test(label)
    ) {
      if (clickable(el)) {
        el.click();
        return true;
      }
    }
  }
  return false;
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task<bool> ClickSendViaCdpMouseAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var pos = await FindSendButtonCenterAsync(session, cancellationToken);
        if (!pos.Ok) return false;
        await TrySendAsync(session, "Input.dispatchMouseEvent", new { type = "mouseMoved", x = pos.X, y = pos.Y }, cancellationToken);
        await Task.Delay(40, cancellationToken);
        await TrySendAsync(session, "Input.dispatchMouseEvent", new { type = "mousePressed", x = pos.X, y = pos.Y, button = "left", buttons = 1, clickCount = 1 }, cancellationToken);
        await TrySendAsync(session, "Input.dispatchMouseEvent", new { type = "mouseReleased", x = pos.X, y = pos.Y, button = "left", buttons = 0, clickCount = 1 }, cancellationToken);
        return true;
    }

    private static Task<ComposerStatus> GetComposerLenAndCopilotGeneratingAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var script = """
(() => {
""" + ComposerDomHelpers + """
  function lenOf(el) {
    if (!el) return 0;
    const raw = el.innerText || el.textContent || "";
    const t = raw.replace(new RegExp(String.fromCharCode(0x200b), "g"), "");
    return t.trim().length;
  }
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }
  function nameOf(el) {
    return [
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.textContent || "",
    ].join(" ").replace(/\s+/g, " ").trim();
  }
  const cEl = __raFindComposerEditable();
  const len = lenOf(cEl);
  let generating = false;
  for (const el of document.querySelectorAll("button, [role='button'], [aria-label], [data-testid]")) {
    if (!visible(el)) continue;
    const label = nameOf(el);
    if (/stop\s+generating|stop\s+response|\bstop\b|cancel\s+response|生成を停止|停止|中断/i.test(label)) {
      generating = true;
      break;
    }
  }
  const bodyText = document.body ? String(document.body.innerText || document.body.textContent || "") : "";
  if (/(\n|^)\s*(Generating response|Creating response|Thinking|応答を生成しています|応答を作成しています|考えています)[.\u2026…\s]*(\n|$)/i.test(bodyText)) {
    generating = true;
  }
  return { length: len, generating };
})()
""";
        return session.EvaluateJsonAsync<ComposerStatus>(script, cancellationToken);
    }

    private static async Task<bool> IsCopilotGeneratingAsync(CdpSession session, CancellationToken cancellationToken)
    {
        try
        {
            return (await GetComposerLenAndCopilotGeneratingAsync(session, cancellationToken)).Generating;
        }
        catch
        {
            return false;
        }
    }

    private static int PasteNeedMinChars(int textLength)
    {
        if (textLength < 20) return 1;
        var n = Math.Min(120, Math.Max(12, (int)Math.Floor(textLength * 0.06)));
        if (textLength > 5000) n = Math.Min(n, 96);
        return n;
    }

    private static bool PasteLooksComplete(int visibleLength, int fullLength)
    {
        if (fullLength < 20) return visibleLength >= 1;
        if (fullLength <= 400) return visibleLength >= Math.Max(1, (int)Math.Floor(fullLength * 0.82));
        if (fullLength <= 2500) return visibleLength >= Math.Max(80, (int)Math.Floor(fullLength * 0.22));
        if (fullLength <= 8000) return visibleLength >= Math.Max(200, Math.Min(1800, (int)Math.Floor(fullLength * 0.18)));
        var need = Math.Max(900, Math.Min(3200, (int)Math.Floor(fullLength * 0.065)));
        return visibleLength >= need;
    }

    private static int MinComposerThresholdForSubmit(int expectedPromptLength)
    {
        var raw = Math.Min(
            Math.Max(8, (int)Math.Floor(expectedPromptLength * 0.15)),
            (int)Math.Floor(expectedPromptLength * 0.85));
        return Math.Min(raw, 400);
    }

    private static List<string> ChunkByCodePoints(string text, int size)
    {
        var runes = text.EnumerateRunes().Select(rune => rune.ToString()).ToArray();
        var chunks = new List<string>();
        for (var index = 0; index < runes.Length; index += size)
        {
            chunks.Add(string.Concat(runes.Skip(index).Take(size)));
        }
        return chunks;
    }

    private static Task<bool> ClickLabeledControlAsync(
        CdpSession session,
        IReadOnlyList<string> hints,
        IReadOnlyList<string> excludes,
        CancellationToken cancellationToken)
    {
        var script = $$"""
(() => {
{{A11yControlHelpers}}
  return __raClickLabeledControlDeep({{JsonSerializer.Serialize(hints)}}, {{JsonSerializer.Serialize(excludes)}});
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task<string> WaitForReplyAsync(
        CdpSession session,
        string baseline,
        string prompt,
        CopilotNetworkCapture networkCapture,
        CancellationToken cancellationToken)
    {
        var normalizedBaseline = NormalizeVisibleText(baseline);
        var baselineSnapshot = await ExtractAssistantSnapshotAsync(session, prompt, cancellationToken);
        var baselineReply = baselineSnapshot.Reply.Length > 0 ? baselineSnapshot.Reply : ExtractLatestAssistantAnswer(baseline);
        var baselineAssistantMarkers = Math.Max(baselineSnapshot.AssistantCount, CountAssistantMarkers(baseline));
        var expectToolJson = prompt.Contains("RELAY_TOOL_JSON_ONLY", StringComparison.Ordinal);
        string best = "";
        string previous = "";
        var quietTicks = 0;
        var phantomGeneratingTicks = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(GetReplyTimeout());

        while (!timeout.IsCancellationRequested)
        {
            AssistantSnapshot snapshot;
            try
            {
                await Task.Delay(500, timeout.Token);
                snapshot = await ExtractAssistantSnapshotAsync(session, prompt, timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && timeout.IsCancellationRequested)
            {
                break;
            }

            var rawText = snapshot.ConversationText;
            var text = NormalizeVisibleText(rawText);
            var delta = ExtractDelta(normalizedBaseline, text);
            var promptReply = ExtractAssistantAnswerAfterPrompt(rawText, prompt);
            bool generating;
            try
            {
                generating = snapshot.Generating || await IsCopilotGeneratingAsync(session, timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && timeout.IsCancellationRequested)
            {
                break;
            }
            phantomGeneratingTicks = generating ? phantomGeneratingTicks + 1 : 0;
            var latestReply = snapshot.Reply.Length > 0 ? snapshot.Reply : ExtractLatestAssistantAnswer(rawText);
            var currentAssistantMarkers = Math.Max(snapshot.AssistantCount, CountAssistantMarkers(rawText));
            var hasNewAssistantTurn = currentAssistantMarkers > baselineAssistantMarkers;
            var exactPromptAnswer = promptReply.Answer.Length > 0 ? promptReply.Answer : "";
            if (promptReply.FoundPrompt && promptReply.FoundAssistantMarker && exactPromptAnswer.Length == 0)
            {
                quietTicks = 0;
                continue;
            }

            var candidate = exactPromptAnswer.Length > 0
                ? exactPromptAnswer
                : latestReply.Length > 0 && (hasNewAssistantTurn || !latestReply.Equals(baselineReply, StringComparison.Ordinal))
                    ? latestReply
                    : hasNewAssistantTurn ? "" : delta;

            candidate = NormalizeAssistantCandidate(candidate);
            if (CandidateLooksLikePromptEcho(candidate, prompt) || snapshot.PromptEcho)
            {
                quietTicks = 0;
                continue;
            }

            if (candidate.Length == 0)
            {
                candidate = networkCapture.LatestCandidate();
            }
            candidate = NormalizeAssistantCandidate(candidate);
            if (candidate.Length == 0) continue;
            if (CandidateLooksLikePromptEcho(candidate, prompt)) continue;

            if (candidate.Length > best.Length)
            {
                best = candidate;
                quietTicks = 0;
            }
            else if (best.Length > 0 && candidate.Equals(previous, StringComparison.Ordinal))
            {
                quietTicks++;
            }
            previous = candidate;

            if (quietTicks >= 2 && best.Length > 0)
            {
                if ((generating && phantomGeneratingTicks < 12) ||
                    (snapshot.IncompleteJson && !ContainsCompleteJsonObject(best)) ||
                    LooksIncompleteAssistantResponse(best))
                {
                    quietTicks = 1;
                    continue;
                }
                if (expectToolJson && !ContainsCompleteJsonObject(best) && quietTicks < 36)
                {
                    quietTicks = 1;
                    continue;
                }
                return NormalizeAssistantCandidate(best);
            }
        }

        var fallback = NormalizeAssistantCandidate(best.Length > 0 ? best : networkCapture.LatestCandidate());
        if (fallback.Length > 0 && !LooksIncompleteAssistantResponse(fallback) && (!expectToolJson || ContainsCompleteJsonObject(fallback))) return fallback;
        throw new TimeoutException("Timed out waiting for Copilot response.");
    }

    private static bool ContainsCompleteJsonObject(string text)
    {
        if (LooksLikeCompleteLenientWriteObject(text)) return true;

        var start = text.IndexOf('{');
        if (start < 0) return false;

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var index = start; index < text.Length; index++)
        {
            var c = text[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    continue;
                }
                if (c == '\\')
                {
                    escaped = true;
                    continue;
                }
                if (c == '"') inString = false;
                continue;
            }

            if (c == '"')
            {
                inString = true;
                continue;
            }
            if (c == '{')
            {
                depth++;
                continue;
            }
            if (c == '}')
            {
                depth--;
                if (depth == 0) return true;
                if (depth < 0) return false;
            }
        }

        return false;
    }

    private static TimeSpan GetReplyTimeout()
    {
        var raw = Environment.GetEnvironmentVariable("RELAY_COPILOT_REPLY_TIMEOUT_SECONDS");
        if (!int.TryParse(raw, CultureInfo.InvariantCulture, out var seconds))
        {
            seconds = 300;
        }

        return TimeSpan.FromSeconds(Math.Clamp(seconds, 30, 900));
    }

    private static bool LooksLikeCompleteLenientWriteObject(string text) =>
        text.Contains("\"action\"", StringComparison.Ordinal) &&
        text.Contains("\"tool\"", StringComparison.Ordinal) &&
        text.Contains("\"write\"", StringComparison.Ordinal) &&
        text.Contains("\"content\"", StringComparison.Ordinal) &&
        (text.LastIndexOf("\"}}", StringComparison.Ordinal) > text.IndexOf("\"content\"", StringComparison.Ordinal) ||
         text.LastIndexOf("\"}\n}", StringComparison.Ordinal) > text.IndexOf("\"content\"", StringComparison.Ordinal));

    private static Task<AssistantSnapshot> ExtractAssistantSnapshotAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var promptJson = JsonSerializer.Serialize(prompt);
        var script = $$"""
(() => {
  const submittedPrompt = {{promptJson}};
  const assistantSelectors = [
    '[data-testid="copilot-message-reply-div"]',
    '[class*="fai-CopilotMessage"]',
    '[data-testid="markdown-reply"]',
    '[data-testid*="message-content"]',
    '[data-testid*="message-body"]',
    '[data-testid*="assistant"]',
    '[data-message-author-role="assistant"]',
    'article[data-message-author-role="assistant"]',
    '[role="article"]',
    '.markdown-body',
    '.fui-ChatMessageBody',
    '[class*="ChatMessage"]',
    '[class*="MessageBody"]',
    '[class*="message-body"]'
  ];
  const noiseSelectors = [
    '.fai-SuggestionList',
    '.fai-Suggestion',
    '[data-testid="chat-suggestion"]',
    '#m365-chat-editor-target-element',
    '[data-lexical-editor="true"]',
    '[role="textbox"]'
  ];
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8 && rect.bottom > 1 && rect.right > 1;
  }
  function inNoise(el) {
    for (const sel of noiseSelectors) {
      try { if (el.closest && el.closest(sel)) return true; } catch (_) {}
    }
    return false;
  }
  function elementText(el) {
    const inner = String(el?.innerText || '');
    const text = String(el?.textContent || '');
    if (text.length > inner.length + 200 &&
        (text.includes('```json') ||
         text.includes('"action"') ||
         text.includes('\\"action\\"') ||
         text.includes('<!DOCTYPE') ||
         text.includes('<!doctype') ||
         text.includes('<style'))) {
      return text;
    }
    return inner || text;
  }
  function stripChrome(text) {
    let s = String(text || '').replace(/\r/g, '\n').trim();
    s = s.replace(/^Copilot said:\s*/i, '');
    s = s.replace(/^Copilot\s*(\n+|$)/im, '');
    const lines = s.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const filtered = lines.filter((line) => {
      if (/^copilot$/i.test(line)) return false;
      if (/^plain text$/i.test(line)) return false;
      if (/^sources?$/i.test(line)) return false;
      if (/^copy code$/i.test(line)) return false;
      if (/^show (more lines|less)$/i.test(line)) return false;
      if (/^display options$/i.test(line)) return false;
      if (/^more actions$/i.test(line)) return false;
      if (/^feedback$/i.test(line)) return false;
      if (/^reasoning\b.*$/i.test(line)) return false;
      if (/AI-generated content may be incorrect/i.test(line)) return false;
      if (/^(generating|thinking|creating response|応答を生成しています|応答を作成しています|考えています)[.\u2026…\s]*$/i.test(line)) return false;
      return true;
    });
    return filtered.join('\n').trim();
  }
  function isGenerating() {
    for (const el of document.querySelectorAll('button, [role="button"], [aria-label], [data-testid]')) {
      if (!visible(el)) continue;
      const label = [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.textContent || ''
      ].join(' ');
      if (/stop\s+generating|stop\s+response|\bstop\b|cancel\s+response|生成を停止|停止|中断/i.test(label)) {
        return true;
      }
    }
    const bodyText = document.body ? String(document.body.innerText || document.body.textContent || '') : '';
    if (/(\n|^)\s*(Generating response|Creating response|Thinking|応答を生成しています|応答を作成しています|考えています)[.\u2026…\s]*(\n|$)/i.test(bodyText)) {
      return true;
    }
    return false;
  }
  function latestMarkerReply(conversation) {
    const marker = /Copilot said:/ig;
    let match;
    let last = -1;
    while ((match = marker.exec(conversation))) last = match.index + match[0].length;
    if (last < 0) return '';
    const after = conversation.slice(last);
    const cut = after.search(/\n\s*(You said:|Message Copilot|メッセージを送信)/i);
    return stripChrome(cut >= 0 ? after.slice(0, cut) : after);
  }
  function assistantCountFromMarkers(conversation) {
    return (conversation.match(/Copilot said:/gi) || []).length;
  }
  function incompleteJson(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (/^(generating|thinking|応答を生成しています|応答を作成しています)/i.test(s)) return true;
    if (!(s.startsWith('{') || s.startsWith('[') || s.includes('{"'))) return false;
    let depth = 0, bracket = 0, inString = false, escaped = false;
    for (const ch of s) {
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === '[') bracket++;
      if (ch === ']') bracket--;
    }
    return inString || depth > 0 || bracket > 0 || /[:,]\s*$/.test(s);
  }
  const conversationRoots = ['[role="feed"]', '[aria-label="Chat conversation"]', 'main', '[role="main"]'];
  let conversation = '';
  for (const sel of conversationRoots) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const text = elementText(el).trim();
      if (text.length > conversation.length) conversation = text;
    }
  }
  if (!conversation && document.body) conversation = elementText(document.body);

  const candidates = [];
  for (const sel of assistantSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (inNoise(el)) continue;
      if (!visible(el) && sel !== '[data-testid="markdown-reply"]' && sel !== '[data-testid="copilot-message-reply-div"]') continue;
      const text = stripChrome(elementText(el));
      if (text.length > 0) candidates.push(text);
    }
  }
  for (const el of document.querySelectorAll('[data-testid="markdown-reply"], [data-testid="lastChatMessage"]')) {
    if (inNoise(el)) continue;
    const text = stripChrome(String(el.innerText || el.textContent || ''));
    if (text.length > 0 && !candidates.includes(text)) candidates.push(text);
  }
  let reply = candidates.length ? candidates[candidates.length - 1] : latestMarkerReply(conversation);
  const markerReply = latestMarkerReply(conversation);
  if (markerReply.length > reply.length + 20) reply = markerReply;
  reply = stripChrome(reply);
  const promptHead = String(submittedPrompt || '').slice(0, Math.min(160, String(submittedPrompt || '').length));
  const promptEcho = !!promptHead && reply.includes(promptHead) && reply.length <= String(submittedPrompt || '').length + 200;
  return {
    reply,
    conversationText: conversation,
    assistantCount: Math.max(candidates.length, assistantCountFromMarkers(conversation)),
    generating: isGenerating(),
    promptEcho,
    incompleteJson: incompleteJson(reply)
  };
})()
""";
        return session.EvaluateJsonAsync<AssistantSnapshot>(script, cancellationToken);
    }

    private static string ExtractDelta(string baseline, string current)
    {
        if (current.StartsWith(baseline, StringComparison.Ordinal)) return current[baseline.Length..].Trim();
        var index = current.LastIndexOf(baseline.Length > 120 ? baseline[^120..] : baseline, StringComparison.Ordinal);
        return index >= 0 ? current[(index + Math.Min(120, baseline.Length))..].Trim() : current.Trim();
    }

    private static string NormalizeVisibleText(string text) =>
        string.Join("\n", text.Replace("\r", "\n").Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0));

    private static string NormalizeAssistantCandidate(string? text)
    {
        var trimmed = TrimCopilotNoise(text ?? "");
        trimmed = Regex.Replace(trimmed, @"\r", "\n");
        trimmed = Regex.Replace(trimmed, @"\n{3,}", "\n\n");
        trimmed = Regex.Replace(trimmed, @"(?im)^\s*(Generating response|Creating response|Thinking|応答を生成しています|応答を作成しています|考えています)[.\u2026…\s]*$", "");
        trimmed = Regex.Replace(trimmed, @"(?im)^\s*(Show more lines|Show less|Copy code|Display options|More actions)\s*$", "");
        return trimmed.Trim();
    }

    private static bool CandidateLooksLikePromptEcho(string candidate, string prompt)
    {
        if (string.IsNullOrWhiteSpace(candidate) || string.IsNullOrWhiteSpace(prompt)) return false;
        var normalizedCandidate = NormalizeVisibleText(candidate);
        var normalizedPrompt = NormalizeVisibleText(prompt);
        if (normalizedCandidate.Equals(normalizedPrompt, StringComparison.Ordinal)) return true;
        var prefixLength = Math.Min(180, normalizedPrompt.Length);
        return prefixLength > 40
               && normalizedCandidate.Contains(normalizedPrompt[..prefixLength], StringComparison.Ordinal)
               && normalizedCandidate.Length <= normalizedPrompt.Length + 240;
    }

    private static bool LooksIncompleteAssistantResponse(string candidate)
    {
        var text = (candidate ?? "").Trim();
        if (text.Length == 0) return true;
        if (LooksLikeCompleteLenientWriteObject(text)) return false;
        if (Regex.IsMatch(text, @"(?i)(Generating response|Creating response|Thinking|Please wait|応答を生成しています|応答を作成しています|考えています)[.\u2026…\s]*$")) return true;
        if (!text.StartsWith('{') && !text.StartsWith('[') && !text.Contains("{\"")) return false;

        var objectDepth = 0;
        var arrayDepth = 0;
        var inString = false;
        var escaped = false;
        foreach (var c in text)
        {
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    continue;
                }
                if (c == '\\')
                {
                    escaped = true;
                    continue;
                }
                if (c == '"') inString = false;
                continue;
            }
            if (c == '"')
            {
                inString = true;
                continue;
            }
            if (c == '{') objectDepth++;
            if (c == '}') objectDepth--;
            if (c == '[') arrayDepth++;
            if (c == ']') arrayDepth--;
        }

        return inString || objectDepth > 0 || arrayDepth > 0 || text.EndsWith(':') || text.EndsWith(',');
    }

    private static string TrimCopilotNoise(string text)
    {
        var lines = text.Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .Where(line => !line.Equals("Copilot", StringComparison.OrdinalIgnoreCase))
            .Where(line => !Regex.IsMatch(line, @"^Reasoning\b", RegexOptions.IgnoreCase))
            .Where(line => !line.Contains("AI-generated content may be incorrect", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        return string.Join("\n", lines).Trim();
    }

    private static string ExtractLatestAssistantAnswer(string text)
    {
        var lines = text.Replace("\r", "\n").Split('\n').Select(line => line.Trim()).ToArray();
        var markerIndex = Array.FindLastIndex(lines, line => line.Equals("Copilot said:", StringComparison.OrdinalIgnoreCase));
        if (markerIndex < 0) return "";

        var answer = new List<string>();
        for (var index = markerIndex + 1; index < lines.Length; index++)
        {
            var line = lines[index];
            if (line.Equals("You said:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("Message Copilot", StringComparison.OrdinalIgnoreCase))
            {
                break;
            }
            if (line.Equals("Copilot", StringComparison.OrdinalIgnoreCase) ||
                line.Contains("AI-generated content may be incorrect", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (line.Length == 0)
            {
                continue;
            }

            answer.Add(line);
        }

        return string.Join("\n", answer).Trim();
    }

    private static int CountAssistantMarkers(string text) =>
        text.Replace("\r", "\n")
            .Split('\n')
            .Count(line => line.Trim().Equals("Copilot said:", StringComparison.OrdinalIgnoreCase));

    private static PromptReply ExtractAssistantAnswerAfterPrompt(string text, string prompt)
    {
        var normalizedText = text.Replace("\r", "\n");
        var promptIndex = normalizedText.LastIndexOf(prompt, StringComparison.Ordinal);
        if (promptIndex < 0 && prompt.Length > 80)
        {
            promptIndex = normalizedText.LastIndexOf(prompt[..80], StringComparison.Ordinal);
        }
        if (promptIndex < 0) return new PromptReply(false, false, "");

        var afterPrompt = normalizedText[(promptIndex + Math.Min(prompt.Length, normalizedText.Length - promptIndex))..];
        var markerIndex = afterPrompt.IndexOf("Copilot said:", StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0) return new PromptReply(true, false, "");

        var answer = ExtractLatestAssistantAnswer(afterPrompt[(markerIndex + "Copilot said:".Length)..]);
        if (answer.Length == 0)
        {
            answer = ExtractAssistantAnswerBody(afterPrompt[(markerIndex + "Copilot said:".Length)..]);
        }
        return new PromptReply(true, true, answer);
    }

    private static string ExtractAssistantAnswerBody(string text)
    {
        var lines = text.Replace("\r", "\n").Split('\n').Select(line => line.Trim()).ToArray();
        var answer = new List<string>();
        foreach (var line in lines)
        {
            if (line.Equals("You said:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("Message Copilot", StringComparison.OrdinalIgnoreCase))
            {
                break;
            }
            if (line.Equals("Copilot", StringComparison.OrdinalIgnoreCase) ||
                line.Contains("AI-generated content may be incorrect", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (line.Length == 0)
            {
                continue;
            }

            answer.Add(line);
        }
        return string.Join("\n", answer).Trim();
    }

    private sealed record PromptReply(bool FoundPrompt, bool FoundAssistantMarker, string Answer);

    private sealed record CopilotPromptTiming(
        bool FastInline,
        int ComposerReadyDelayMs,
        int AfterClearDelayMs,
        int AfterRefocusDelayMs,
        int PostPasteDelayMs,
        int SendButtonStableMs,
        int SubmitConfirmDelayMs)
    {
        public static CopilotPromptTiming Default { get; } = new(
            FastInline: true,
            ComposerReadyDelayMs: 120,
            AfterClearDelayMs: 40,
            AfterRefocusDelayMs: 40,
            PostPasteDelayMs: 80,
            SendButtonStableMs: 180,
            SubmitConfirmDelayMs: 450);
    }

    private sealed record ButtonCenter(
        [property: JsonPropertyName("ok")] bool Ok,
        [property: JsonPropertyName("x")] double X,
        [property: JsonPropertyName("y")] double Y);

    private sealed record ComposerStatus(
        [property: JsonPropertyName("length")] int Length,
        [property: JsonPropertyName("generating")] bool Generating);

    private sealed record AssistantSnapshot(
        [property: JsonPropertyName("reply")] string Reply,
        [property: JsonPropertyName("conversationText")] string ConversationText,
        [property: JsonPropertyName("assistantCount")] int AssistantCount,
        [property: JsonPropertyName("generating")] bool Generating,
        [property: JsonPropertyName("promptEcho")] bool PromptEcho,
        [property: JsonPropertyName("incompleteJson")] bool IncompleteJson);
}

public sealed record CdpTarget(
    string Id,
    string Type,
    string Url,
    [property: JsonPropertyName("webSocketDebuggerUrl")] string WebSocketDebuggerUrl);

public sealed record CdpVersion([property: JsonPropertyName("Browser")] string Browser);

public sealed record CopilotPageHealth(
    [property: JsonPropertyName("healthy")] bool Healthy,
    [property: JsonPropertyName("reason")] string Reason);

public sealed class CopilotNetworkCapture : IAsyncDisposable
{
    private readonly ConcurrentQueue<string> _candidates = new();
    private readonly IDisposable _webSocketSubscription;
    private readonly IDisposable _responseSubscription;

    private CopilotNetworkCapture(CdpSession session)
    {
        _webSocketSubscription = session.On("Network.webSocketFrameReceived", OnWebSocketFrameReceived);
        _responseSubscription = session.On("Network.responseReceived", OnResponseReceived);
    }

    public static async Task<CopilotNetworkCapture> StartAsync(CdpSession session, CancellationToken cancellationToken)
    {
        var capture = new CopilotNetworkCapture(session);
        try
        {
            await session.SendAsync("Network.enable", new
            {
                maxTotalBufferSize = 8_000_000,
                maxResourceBufferSize = 2_000_000,
            }, cancellationToken);
        }
        catch
        {
            // CDP Network capture is a secondary signal; DOM extraction remains primary.
        }
        return capture;
    }

    public string LatestCandidate()
    {
        var latest = "";
        foreach (var candidate in _candidates)
        {
            latest = candidate;
        }
        return latest;
    }

    private void OnWebSocketFrameReceived(JsonNode? parameters)
    {
        var payload = parameters?["response"]?["payloadData"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(payload)) return;
        foreach (var candidate in ExtractAssistantCandidates(payload))
        {
            AddCandidate(candidate);
        }
    }

    private void OnResponseReceived(JsonNode? parameters)
    {
        var url = parameters?["response"]?["url"]?.GetValue<string>() ?? "";
        if (url.Contains("chathub", StringComparison.OrdinalIgnoreCase) ||
            url.Contains("copilot", StringComparison.OrdinalIgnoreCase))
        {
            // Response bodies require an async CDP call keyed by requestId. The current
            // capture intentionally limits itself to WebSocket frames so command replies
            // stay serialized through CdpSession.
        }
    }

    private void AddCandidate(string candidate)
    {
        var normalized = NormalizeNetworkCandidate(candidate);
        if (normalized.Length < 2 || LooksLikeNetworkGarbage(normalized)) return;
        _candidates.Enqueue(normalized);
        while (_candidates.Count > 32)
        {
            _candidates.TryDequeue(out _);
        }
    }

    private static IEnumerable<string> ExtractAssistantCandidates(string raw)
    {
        foreach (var segment in raw.Split('\u001e', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var jsonStart = segment.IndexOfAny(['{', '[']);
            if (jsonStart < 0)
            {
                if (LooksLikeAssistantText(segment)) yield return segment;
                continue;
            }

            var jsonText = segment[jsonStart..];
            JsonNode? node = null;
            var fallbackText = "";
            try
            {
                node = JsonNode.Parse(jsonText);
            }
            catch
            {
                if (LooksLikeAssistantText(segment)) fallbackText = segment;
            }
            if (fallbackText.Length > 0) yield return fallbackText;
            if (node is null) continue;

            foreach (var text in ExtractStrings(node, keyHint: null))
            {
                if (LooksLikeAssistantText(text)) yield return text;
            }
        }
    }

    private static IEnumerable<string> ExtractStrings(JsonNode? node, string? keyHint)
    {
        if (node is null) yield break;
        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out var text) && IsAssistantTextKey(keyHint))
            {
                yield return text;
            }
            yield break;
        }

        if (node is JsonObject obj)
        {
            foreach (var (key, child) in obj)
            {
                foreach (var text in ExtractStrings(child, key))
                {
                    yield return text;
                }
            }
            yield break;
        }

        if (node is JsonArray array)
        {
            foreach (var child in array)
            {
                foreach (var text in ExtractStrings(child, keyHint))
                {
                    yield return text;
                }
            }
        }
    }

    private static bool IsAssistantTextKey(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return false;
        return Regex.IsMatch(key, "(text|content|message|markdown|answer|body|value)", RegexOptions.IgnoreCase);
    }

    private static bool LooksLikeAssistantText(string text)
    {
        var trimmed = NormalizeNetworkCandidate(text);
        if (trimmed.Length < 2) return false;
        if (LooksLikeNetworkGarbage(trimmed)) return false;
        return trimmed.Contains('\n') ||
               trimmed.Contains("。", StringComparison.Ordinal) ||
               trimmed.Contains("{\"", StringComparison.Ordinal) ||
               trimmed.Length >= 12;
    }

    private static string NormalizeNetworkCandidate(string text)
    {
        var normalized = text.Replace("\\n", "\n").Replace("\\r", "\r").Replace("\r", "\n");
        normalized = Regex.Replace(normalized, @"\n{3,}", "\n\n");
        normalized = Regex.Replace(normalized, @"(?im)^\s*(Copilot said:|Copilot|Sources?|Feedback|Copy code|Show more lines|Show less)\s*$", "");
        return normalized.Trim();
    }

    private static bool LooksLikeNetworkGarbage(string text)
    {
        var trimmed = text.Trim();
        if (trimmed.Length == 0) return true;
        if (Regex.IsMatch(trimmed, @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase)) return true;
        if (Regex.IsMatch(trimmed, @"^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$")) return true;
        if (trimmed.Contains("SubstrateTraceId", StringComparison.OrdinalIgnoreCase)) return true;
        if (trimmed.Contains("browserVersion", StringComparison.OrdinalIgnoreCase) && trimmed.Contains("cardCount", StringComparison.OrdinalIgnoreCase)) return true;
        if (trimmed.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public ValueTask DisposeAsync()
    {
        _webSocketSubscription.Dispose();
        _responseSubscription.Dispose();
        return ValueTask.CompletedTask;
    }
}

public sealed class CdpSession : IAsyncDisposable
{
    private readonly ClientWebSocket _socket = new();
    private readonly Dictionary<string, List<Action<JsonNode?>>> _eventHandlers = new();
    private readonly object _eventHandlersLock = new();
    private int _nextId;

    private CdpSession()
    {
    }

    public static async Task<CdpSession> ConnectAsync(string webSocketDebuggerUrl, CancellationToken cancellationToken)
    {
        var session = new CdpSession();
        await session._socket.ConnectAsync(new Uri(webSocketDebuggerUrl), cancellationToken);
        return session;
    }

    public async Task<JsonNode?> SendAsync(string method, object? parameters, CancellationToken cancellationToken)
    {
        var id = Interlocked.Increment(ref _nextId);
        var payload = JsonSerializer.Serialize(new
        {
            id,
            method,
            @params = parameters,
        }, JsonOptions.Default);
        await _socket.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, cancellationToken);

        while (true)
        {
            var node = await ReceiveAsync(cancellationToken);
            if (node?["method"] is JsonNode eventMethodNode)
            {
                DispatchEvent(eventMethodNode.GetValue<string>(), node["params"]);
                continue;
            }
            if (node?["id"]?.GetValue<int>() != id) continue;
            if (node["error"] is JsonNode error)
            {
                throw new InvalidOperationException($"CDP {method} failed: {error}");
            }
            return node["result"];
        }
    }

    public IDisposable On(string method, Action<JsonNode?> handler)
    {
        lock (_eventHandlersLock)
        {
            if (!_eventHandlers.TryGetValue(method, out var handlers))
            {
                handlers = [];
                _eventHandlers[method] = handlers;
            }
            handlers.Add(handler);
        }

        return new EventSubscription(() =>
        {
            lock (_eventHandlersLock)
            {
                if (!_eventHandlers.TryGetValue(method, out var handlers)) return;
                handlers.Remove(handler);
                if (handlers.Count == 0) _eventHandlers.Remove(method);
            }
        });
    }

    private void DispatchEvent(string method, JsonNode? parameters)
    {
        Action<JsonNode?>[] handlers;
        lock (_eventHandlersLock)
        {
            handlers = _eventHandlers.TryGetValue(method, out var list) ? list.ToArray() : [];
        }

        foreach (var handler in handlers)
        {
            try
            {
                handler(parameters);
            }
            catch
            {
                // Event consumers are diagnostic/secondary paths; command dispatch must continue.
            }
        }
    }

    public async Task<T> EvaluateJsonAsync<T>(string expression, CancellationToken cancellationToken)
    {
        var result = await SendAsync("Runtime.evaluate", new
        {
            expression,
            awaitPromise = true,
            returnByValue = true,
        }, cancellationToken);
        var valueNode = result?["result"]?["value"];
        if (valueNode is null) return default!;
        return valueNode.Deserialize<T>(JsonOptions.Default)!;
    }

    private async Task<JsonNode?> ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await _socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new InvalidOperationException("CDP WebSocket closed.");
            }
            stream.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return JsonNode.Parse(Encoding.UTF8.GetString(stream.ToArray()));
    }

    public async ValueTask DisposeAsync()
    {
        if (_socket.State == WebSocketState.Open)
        {
            await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
        }
        _socket.Dispose();
    }

    private sealed class EventSubscription(Action dispose) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                dispose();
            }
        }
    }
}
