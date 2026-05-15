using System.Net.WebSockets;
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
    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(10),
    };

    public async Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            var targets = await GetTargetsAsync(cancellationToken);
            var target = targets.FirstOrDefault(IsCopilotTarget) ?? targets.FirstOrDefault(t => t.Type == "page");
            return target is null
                ? new ReadinessCheck("copilot-cdp", false, $"Edge CDP port {port} has no page target.")
                : new ReadinessCheck("copilot-cdp", true, $"Edge CDP port {port} ready.");
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
        await using var session = await CdpSession.ConnectAsync(target.WebSocketDebuggerUrl, cancellationToken);
        try
        {
            await session.SendAsync("Runtime.enable", null, cancellationToken);
            await EnsureCopilotPageAsync(session, cancellationToken);

            var baseline = await GetConversationTextAsync(session, cancellationToken);
            var pasted = await InsertPromptAsync(session, prompt, cancellationToken);
            if (pasted < Math.Min(prompt.Length, 20))
            {
                pasted = await PastePromptAsync(session, prompt, cancellationToken);
            }
            if (pasted < Math.Min(prompt.Length, 20))
            {
                pasted = await WaitForComposerLengthAsync(session, Math.Min(prompt.Length, 20), cancellationToken);
            }
            if (pasted < Math.Min(prompt.Length, 20))
            {
                throw new InvalidOperationException($"Prompt did not reach Copilot composer (visible length {pasted}, expected ~{prompt.Length}).");
            }

            var sent = await ClickSendAsync(session, cancellationToken);
            if (!sent)
            {
                throw new InvalidOperationException("Copilot send button was not found or was disabled.");
            }

            return await WaitForReplyAsync(session, baseline, prompt, cancellationToken);
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
        var target = targets.FirstOrDefault(IsCopilotTarget);
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

    private static bool IsCopilotTarget(CdpTarget target) =>
        target.Type == "page"
        && (target.Url.Contains("m365.cloud.microsoft/chat", StringComparison.OrdinalIgnoreCase)
            || target.Url.Contains("copilot.microsoft.com", StringComparison.OrdinalIgnoreCase));

    private static async Task EnsureCopilotPageAsync(CdpSession session, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 120; attempt++)
        {
            var ready = await session.EvaluateJsonAsync<bool>("document.readyState === 'complete' || document.readyState === 'interactive'", cancellationToken);
            var composerReady = await HasVisibleComposerAsync(session, cancellationToken);
            if (ready && composerReady) return;
            await Task.Delay(500, cancellationToken);
        }
    }

    private static Task<bool> HasVisibleComposerAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  for (const doc of docs) {
    const candidates = Array.from(doc.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]'));
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none') return true;
    }
  }
  return false;
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
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

    private static Task<int> PastePromptAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var promptJson = JsonSerializer.Serialize(prompt);
        var script = $$"""
(() => {
  const text = {{promptJson}};
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  const candidates = [];
  for (const doc of docs) {
    candidates.push(...doc.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]'));
  }
  const el = candidates.find(x => {
    const rect = x.getBoundingClientRect();
    const style = getComputedStyle(x);
    return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  if (!el) return 0;
  el.focus();
  if ('value' in el) {
    el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value || '').length;
  }
  el.textContent = '';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  const selection = el.ownerDocument.getSelection();
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  el.ownerDocument.execCommand('insertText', false, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return String(el.innerText || el.textContent || '').length;
})()
""";
        return session.EvaluateJsonAsync<int>(script, cancellationToken);
    }

    private static async Task<int> InsertPromptAsync(CdpSession session, string prompt, CancellationToken cancellationToken)
    {
        var focused = await FocusAndClearComposerAsync(session, cancellationToken);
        if (!focused) return 0;
        await session.SendAsync("Input.insertText", new { text = prompt }, cancellationToken);
        return await WaitForComposerLengthAsync(session, Math.Min(prompt.Length, 20), cancellationToken);
    }

    private static Task<bool> FocusAndClearComposerAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  const candidates = [];
  for (const doc of docs) {
    candidates.push(...doc.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]'));
  }
  const el = candidates.find(x => {
    const rect = x.getBoundingClientRect();
    const style = getComputedStyle(x);
    return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  if (!el) return false;
  el.focus();
  if ('value' in el) {
    el.value = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  el.textContent = '';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  return true;
})()
""";
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task<int> WaitForComposerLengthAsync(CdpSession session, int minLength, CancellationToken cancellationToken)
    {
        var best = 0;
        for (var attempt = 0; attempt < 20; attempt++)
        {
            await Task.Delay(250, cancellationToken);
            best = Math.Max(best, await GetComposerLengthAsync(session, cancellationToken));
            if (best >= minLength) return best;
        }
        return best;
    }

    private static Task<int> GetComposerLengthAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  let best = 0;
  for (const doc of docs) {
    const candidates = Array.from(doc.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]'));
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 20 || rect.height <= 10 || style.visibility === 'hidden' || style.display === 'none') continue;
      const len = String(('value' in el ? el.value : (el.innerText || el.textContent)) || '').trim().length;
      best = Math.max(best, len);
    }
  }
  return best;
})()
""";
        return session.EvaluateJsonAsync<int>(script, cancellationToken);
    }

    private static async Task<bool> ClickSendAsync(CdpSession session, CancellationToken cancellationToken)
    {
        const string script = """
(() => {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];
  const sendWords = ['send', '送信', 'submit'];
  for (const doc of docs) {
    const buttons = Array.from(doc.querySelectorAll('button,[role="button"]'));
    const button = buttons.find(b => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
      const disabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
      const rect = b.getBoundingClientRect();
      return !disabled && rect.width > 8 && rect.height > 8 && sendWords.some(w => label.includes(w));
    });
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
})()
""";
        for (var attempt = 0; attempt < 40; attempt++)
        {
            if (await session.EvaluateJsonAsync<bool>(script, cancellationToken)) return true;
            await Task.Delay(250, cancellationToken);
        }
        return false;
    }

    private static async Task<string> WaitForReplyAsync(CdpSession session, string baseline, string prompt, CancellationToken cancellationToken)
    {
        var normalizedBaseline = NormalizeVisibleText(baseline);
        var baselineReply = ExtractLatestAssistantAnswer(baseline);
        var baselineAssistantMarkers = CountAssistantMarkers(baseline);
        string best = "";
        var quietTicks = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));

        while (!timeout.IsCancellationRequested)
        {
            await Task.Delay(1200, timeout.Token);
            var rawText = await GetConversationTextAsync(session, timeout.Token);
            var text = NormalizeVisibleText(rawText);
            var delta = ExtractDelta(normalizedBaseline, text);
            var promptReply = ExtractAssistantAnswerAfterPrompt(rawText, prompt);
            if (promptReply.FoundPrompt && promptReply.FoundAssistantMarker && promptReply.Answer.Length == 0)
            {
                quietTicks = 0;
                continue;
            }

            var latestReply = ExtractLatestAssistantAnswer(rawText);
            var currentAssistantMarkers = CountAssistantMarkers(rawText);
            var hasNewAssistantTurn = currentAssistantMarkers > baselineAssistantMarkers;
            var exactPromptAnswer = promptReply.Answer.Length > 0 ? promptReply.Answer : "";
            if (hasNewAssistantTurn && latestReply.Length == 0 && exactPromptAnswer.Length == 0)
            {
                quietTicks = 0;
                continue;
            }

            var candidate = exactPromptAnswer.Length > 0
                ? exactPromptAnswer
                : latestReply.Length > 0 &&
                            (hasNewAssistantTurn || !latestReply.Equals(baselineReply, StringComparison.Ordinal))
                ? latestReply
                : hasNewAssistantTurn ? "" : delta;
            if (candidate.Length == 0) continue;
            if (candidate.Length > best.Length)
            {
                best = candidate;
                quietTicks = 0;
            }
            else if (best.Length > 0)
            {
                quietTicks++;
            }

            if (quietTicks >= 2 && best.Length > 0)
            {
                return TrimCopilotNoise(best);
            }
        }

        throw new TimeoutException("Timed out waiting for Copilot response.");
    }

    private static string ExtractDelta(string baseline, string current)
    {
        if (current.StartsWith(baseline, StringComparison.Ordinal)) return current[baseline.Length..].Trim();
        var index = current.LastIndexOf(baseline.Length > 120 ? baseline[^120..] : baseline, StringComparison.Ordinal);
        return index >= 0 ? current[(index + Math.Min(120, baseline.Length))..].Trim() : current.Trim();
    }

    private static string NormalizeVisibleText(string text) =>
        string.Join("\n", text.Replace("\r", "\n").Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0));

    private static string TrimCopilotNoise(string text)
    {
        var lines = text.Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .Where(line => !line.Equals("Copilot", StringComparison.OrdinalIgnoreCase))
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
        var started = false;
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
                if (started) break;
                continue;
            }

            started = true;
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
        var started = false;
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
                if (started) break;
                continue;
            }

            started = true;
            answer.Add(line);
        }
        return string.Join("\n", answer).Trim();
    }

    private sealed record PromptReply(bool FoundPrompt, bool FoundAssistantMarker, string Answer);
}

public sealed record CdpTarget(
    string Id,
    string Type,
    string Url,
    [property: JsonPropertyName("webSocketDebuggerUrl")] string WebSocketDebuggerUrl);

public sealed class CdpSession : IAsyncDisposable
{
    private readonly ClientWebSocket _socket = new();
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
            if (node?["id"]?.GetValue<int>() != id) continue;
            if (node["error"] is JsonNode error)
            {
                throw new InvalidOperationException($"CDP {method} failed: {error}");
            }
            return node["result"];
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
}
