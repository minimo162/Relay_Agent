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
        var allowMock = Environment.GetEnvironmentVariable("RELAY_ALLOW_MOCK_COPILOT") == "1";
        if (allowMock && !string.IsNullOrWhiteSpace(mock))
        {
            return new MockCopilotTransport(mock);
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

public sealed class MockCopilotTransport(string response) : ICopilotTransport
{
    public Task<ReadinessCheck> CheckAsync(CancellationToken cancellationToken) =>
        Task.FromResult(new ReadinessCheck("copilot-cdp", true, "mock Copilot transport enabled for explicit test run."));

    public Task<string> SendAsync(string prompt, CancellationToken cancellationToken) =>
        Task.FromResult(response);
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
        var target = await ResolveCopilotTargetAsync(cancellationToken);
        await using var session = await CdpSession.ConnectAsync(target.WebSocketDebuggerUrl, cancellationToken);
        await session.SendAsync("Runtime.enable", null, cancellationToken);
        await EnsureCopilotPageAsync(session, cancellationToken);

        var baseline = await GetBodyTextAsync(session, cancellationToken);
        var pasted = await PastePromptAsync(session, prompt, cancellationToken);
        if (pasted < Math.Min(prompt.Length, 20))
        {
            throw new InvalidOperationException($"Prompt did not reach Copilot composer (visible length {pasted}, expected ~{prompt.Length}).");
        }

        var sent = await ClickSendAsync(session, cancellationToken);
        if (!sent)
        {
            throw new InvalidOperationException("Copilot send button was not found or was disabled.");
        }

        return await WaitForReplyAsync(session, baseline, cancellationToken);
    }

    private async Task<CdpTarget> ResolveCopilotTargetAsync(CancellationToken cancellationToken)
    {
        var targets = await GetTargetsAsync(cancellationToken);
        var target = targets.FirstOrDefault(IsCopilotTarget);
        if (target is not null) return target;

        var createUrl = $"http://127.0.0.1:{port}/json/new?{Uri.EscapeDataString("https://m365.cloud.microsoft/chat")}";
        using var response = await _http.GetAsync(createUrl, cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        target = JsonSerializer.Deserialize<CdpTarget>(body, JsonOptions.Default);
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
        var ready = await session.EvaluateJsonAsync<bool>("document.readyState === 'complete' || document.readyState === 'interactive'", cancellationToken);
        if (!ready)
        {
            await Task.Delay(1000, cancellationToken);
        }
    }

    private static Task<string> GetBodyTextAsync(CdpSession session, CancellationToken cancellationToken) =>
        session.EvaluateJsonAsync<string>("document.body ? document.body.innerText : ''", cancellationToken);

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
  const selection = el.ownerDocument.getSelection();
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  el.ownerDocument.execCommand('insertText', false, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return String(el.innerText || el.textContent || '').length;
})()
""";
        return session.EvaluateJsonAsync<int>(script, cancellationToken);
    }

    private static Task<bool> ClickSendAsync(CdpSession session, CancellationToken cancellationToken)
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
        return session.EvaluateJsonAsync<bool>(script, cancellationToken);
    }

    private static async Task<string> WaitForReplyAsync(CdpSession session, string baseline, CancellationToken cancellationToken)
    {
        var normalizedBaseline = NormalizeVisibleText(baseline);
        string best = "";
        var quietTicks = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));

        while (!timeout.IsCancellationRequested)
        {
            await Task.Delay(1200, timeout.Token);
            var text = NormalizeVisibleText(await GetBodyTextAsync(session, timeout.Token));
            var delta = ExtractDelta(normalizedBaseline, text);
            if (delta.Length > best.Length)
            {
                best = delta;
                quietTicks = 0;
            }
            else if (best.Length > 20)
            {
                quietTicks++;
            }

            if (quietTicks >= 2 && best.Length > 20)
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
