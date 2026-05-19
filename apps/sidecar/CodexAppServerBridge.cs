using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class CodexAppServerBridgeService : IDisposable
{
    private readonly CodexAppServerOptions options;
    private readonly SemaphoreSlim startGate = new(1, 1);
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonNode?>> pending = new();
    private readonly Dictionary<string, CodexBridgeSessionState> sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CodexBridgeTurnState> turns = new(StringComparer.Ordinal);
    private readonly List<CodexBridgeEventRecord> events = [];
    private readonly object stateGate = new();
    private readonly CancellationTokenSource shutdown = new();
    private Process? process;
    private Task? readerTask;
    private long nextRequestId;
    private long nextEventSequence;
    private TaskCompletionSource<long> eventSignal = NewSignal();
    private bool initialized;
    private string state = "not_configured";
    private string detail;

    public CodexAppServerBridgeService(RelayOptions relayOptions)
    {
        options = CodexAppServerOptions.FromEnvironment(relayOptions.DataDirectory);
        state = options.Configured ? "configured" : "not_configured";
        detail = options.Configured
            ? "Codex app-server command is configured; protocol readiness starts on first bridge session."
            : "Codex app-server runtime is not configured or bundled yet.";
    }

    public CodexBridgeHealthResponse Health()
    {
        lock (stateGate)
        {
            return new CodexBridgeHealthResponse(
                "RelayCodexAppServerBridgeHealth.v1",
                options.Configured,
                initialized && process is { HasExited: false },
                state,
                detail,
                options.Configured ? options.DisplayCommand : null);
        }
    }

    public async Task<CodexBridgeSessionResponse> CreateSessionAsync(CodexBridgeSessionRequest request, CancellationToken cancellationToken)
    {
        await EnsureStartedAsync(cancellationToken);
        var workArea = string.IsNullOrWhiteSpace(request.WorkArea) ? null : Path.GetFullPath(request.WorkArea);
        var result = await SendRequestAsync("thread/start", new JsonObject
        {
            ["cwd"] = workArea,
            ["ephemeral"] = request.Ephemeral,
        }, cancellationToken);
        var threadId = ExtractString(result, "threadId")
            ?? ExtractString(result, "thread", "id")
            ?? throw new CodexBridgeException(StatusCodes.Status502BadGateway, "app_server_protocol_error", "thread/start did not return a thread id.");
        var sessionId = "session-" + Guid.NewGuid().ToString("N")[..12];
        var session = new CodexBridgeSessionState(sessionId, threadId, workArea, DateTimeOffset.UtcNow);
        lock (stateGate)
        {
            sessions[sessionId] = session;
        }
        return new CodexBridgeSessionResponse(
            "RelayCodexAppServerBridgeSession.v1",
            sessionId,
            threadId,
            workArea);
    }

    public CodexBridgeSessionResponse GetSession(string sessionId)
    {
        lock (stateGate)
        {
            if (!sessions.TryGetValue(sessionId, out var session))
            {
                throw new CodexBridgeException(StatusCodes.Status404NotFound, "session_not_found", $"Bridge session '{sessionId}' was not found.");
            }
            return new CodexBridgeSessionResponse(
                "RelayCodexAppServerBridgeSession.v1",
                session.SessionId,
                session.AppThreadId,
                session.WorkArea);
        }
    }

    public async Task<CodexBridgeTurnResponse> StartTurnAsync(string sessionId, CodexBridgeTurnRequest request, CancellationToken cancellationToken)
    {
        CodexBridgeSessionState session;
        lock (stateGate)
        {
            if (!sessions.TryGetValue(sessionId, out session!))
            {
                throw new CodexBridgeException(StatusCodes.Status404NotFound, "session_not_found", $"Bridge session '{sessionId}' was not found.");
            }
        }

        if (string.IsNullOrWhiteSpace(request.Input))
        {
            throw new CodexBridgeException(StatusCodes.Status400BadRequest, "invalid_turn_input", "Turn input is required.");
        }

        var result = await SendRequestAsync("turn/start", new JsonObject
        {
            ["threadId"] = session.AppThreadId,
            ["input"] = request.Input,
            ["cwd"] = request.WorkArea ?? session.WorkArea,
            ["attachmentIds"] = request.AttachmentIds is null ? null : JsonSerializer.SerializeToNode(request.AttachmentIds, JsonOptions.Default),
        }, cancellationToken);
        var appTurnId = ExtractString(result, "turnId")
            ?? ExtractString(result, "turn", "id")
            ?? throw new CodexBridgeException(StatusCodes.Status502BadGateway, "app_server_protocol_error", "turn/start did not return a turn id.");
        var turnId = "turn-" + Guid.NewGuid().ToString("N")[..12];
        var turn = new CodexBridgeTurnState(turnId, sessionId, appTurnId, DateTimeOffset.UtcNow);
        lock (stateGate)
        {
            turns[turnId] = turn;
        }
        return new CodexBridgeTurnResponse(
            "RelayCodexAppServerBridgeTurn.v1",
            turnId,
            sessionId,
            appTurnId,
            $"/bridge/turns/{turnId}/events");
    }

    public async Task<CodexBridgeCancelResponse> CancelTurnAsync(string turnId, CancellationToken cancellationToken)
    {
        var turn = GetTurn(turnId);
        await SendRequestAsync("turn/interrupt", new JsonObject
        {
            ["turnId"] = turn.AppTurnId,
        }, cancellationToken);
        return new CodexBridgeCancelResponse("RelayCodexAppServerBridgeCancel.v1", turnId, true);
    }

    public async Task StreamTurnEventsAsync(string turnId, HttpContext context)
    {
        var turn = GetTurn(turnId);
        context.Response.Headers.ContentType = "text/event-stream; charset=utf-8";
        context.Response.Headers.CacheControl = "no-cache";

        var lastSequence = 0L;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        while (!context.RequestAborted.IsCancellationRequested && DateTimeOffset.UtcNow < deadline)
        {
            var batch = SnapshotEvents(turn.AppTurnId, lastSequence);
            foreach (var item in batch)
            {
                lastSequence = Math.Max(lastSequence, item.Sequence);
                await context.Response.WriteAsync($"id: {item.Sequence}\n", context.RequestAborted);
                await context.Response.WriteAsync($"event: {item.Event}\n", context.RequestAborted);
                await context.Response.WriteAsync($"data: {item.Payload.ToJsonString(JsonOptions.Compact)}\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
                if (item.Completed)
                {
                    return;
                }
            }

            await WaitForEventAsync(lastSequence, TimeSpan.FromSeconds(2), context.RequestAborted);
        }
    }

    public void Dispose()
    {
        shutdown.Cancel();
        try
        {
            if (process is { HasExited: false })
            {
                process.StandardInput.Close();
                if (!process.WaitForExit(1500))
                {
                    process.Kill(entireProcessTree: true);
                }
            }
        }
        catch
        {
            // Shutdown is best-effort; startup/readiness smokes cover normal cleanup.
        }
        finally
        {
            shutdown.Dispose();
            startGate.Dispose();
            writeGate.Dispose();
        }
    }

    private async Task EnsureStartedAsync(CancellationToken cancellationToken)
    {
        if (!options.Configured)
        {
            throw new CodexBridgeException(StatusCodes.Status503ServiceUnavailable, "app_server_not_configured", detail);
        }
        if (initialized && process is { HasExited: false })
        {
            return;
        }

        await startGate.WaitAsync(cancellationToken);
        try
        {
            if (initialized && process is { HasExited: false })
            {
                return;
            }

            Directory.CreateDirectory(options.HomeDirectory);
            var startInfo = new ProcessStartInfo(options.Command!)
            {
                WorkingDirectory = AppContext.BaseDirectory,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                StandardInputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                StandardOutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                StandardErrorEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            };
            foreach (var arg in options.Arguments)
            {
                startInfo.ArgumentList.Add(arg);
            }
            startInfo.Environment["CODEX_HOME"] = options.HomeDirectory;
            startInfo.Environment["RELAY_APP_SERVER_HOME"] = options.HomeDirectory;

            process = Process.Start(startInfo)
                ?? throw new CodexBridgeException(StatusCodes.Status502BadGateway, "app_server_start_failed", "Failed to start Codex app-server process.");
            readerTask = Task.Run(() => ReadLoopAsync(process, shutdown.Token), shutdown.Token);

            await SendRequestAsync("initialize", new JsonObject
            {
                ["clientInfo"] = new JsonObject
                {
                    ["name"] = "Relay Agent",
                    ["version"] = typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.0.0",
                },
                ["capabilities"] = new JsonObject
                {
                    ["experimentalApi"] = true,
                    ["optOutNotificationMethods"] = new JsonArray(),
                },
            }, cancellationToken);
            await SendNotificationAsync("initialized", new JsonObject(), cancellationToken);

            lock (stateGate)
            {
                initialized = true;
                state = "ready";
                detail = "Codex app-server protocol initialized.";
            }
        }
        catch (CodexBridgeException)
        {
            throw;
        }
        catch (Exception ex)
        {
            lock (stateGate)
            {
                initialized = false;
                state = "failed";
                detail = ex.Message;
            }
            throw new CodexBridgeException(StatusCodes.Status502BadGateway, "app_server_start_failed", ex.Message);
        }
        finally
        {
            startGate.Release();
        }
    }

    private async Task<JsonNode?> SendRequestAsync(string method, JsonObject parameters, CancellationToken cancellationToken)
    {
        if (process is null || process.HasExited)
        {
            throw new CodexBridgeException(StatusCodes.Status503ServiceUnavailable, "app_server_not_running", "Codex app-server process is not running.");
        }

        var id = Interlocked.Increment(ref nextRequestId);
        var completion = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        var message = new JsonObject
        {
            ["id"] = id,
            ["method"] = method,
            ["params"] = parameters,
        };
        await WriteJsonLineAsync(message, cancellationToken);
        var completed = await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(15), cancellationToken));
        if (completed != completion.Task)
        {
            pending.TryRemove(id, out _);
            throw new CodexBridgeException(StatusCodes.Status504GatewayTimeout, "app_server_timeout", $"Timed out waiting for app-server response to {method}.");
        }
        return await completion.Task;
    }

    private Task SendNotificationAsync(string method, JsonObject parameters, CancellationToken cancellationToken) =>
        WriteJsonLineAsync(new JsonObject
        {
            ["method"] = method,
            ["params"] = parameters,
        }, cancellationToken);

    private async Task WriteJsonLineAsync(JsonObject message, CancellationToken cancellationToken)
    {
        await writeGate.WaitAsync(cancellationToken);
        try
        {
            if (process is null || process.HasExited)
            {
                throw new CodexBridgeException(StatusCodes.Status503ServiceUnavailable, "app_server_not_running", "Codex app-server process is not running.");
            }
            await process.StandardInput.WriteLineAsync(message.ToJsonString(JsonOptions.Compact));
            await process.StandardInput.FlushAsync(cancellationToken);
        }
        finally
        {
            writeGate.Release();
        }
    }

    private async Task ReadLoopAsync(Process target, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await target.StandardOutput.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    break;
                }
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                JsonNode? node;
                try
                {
                    node = JsonNode.Parse(line);
                }
                catch (JsonException ex)
                {
                    AppendEvent(null, "protocol/error", new JsonObject
                    {
                        ["message"] = "Invalid JSON from app-server stdout.",
                        ["detail"] = ex.Message,
                    });
                    continue;
                }
                if (node is not JsonObject obj)
                {
                    continue;
                }

                if (obj.TryGetPropertyValue("id", out var idNode) &&
                    TryGetInt64(idNode, out var id) &&
                    pending.TryRemove(id, out var completion))
                {
                    if (obj.TryGetPropertyValue("error", out var errorNode) && errorNode is not null)
                    {
                        completion.TrySetException(new CodexBridgeException(
                            StatusCodes.Status502BadGateway,
                            "app_server_protocol_error",
                            errorNode.ToJsonString(JsonOptions.Compact)));
                    }
                    else
                    {
                        completion.TrySetResult(obj.TryGetPropertyValue("result", out var result) ? result?.DeepClone() : null);
                    }
                    continue;
                }

                if (obj.TryGetPropertyValue("method", out var methodNode) &&
                    methodNode is JsonValue methodValue &&
                    methodValue.TryGetValue<string>(out var method))
                {
                    AppendEvent(ExtractTurnId(obj), method, obj.DeepClone());
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
        catch (Exception ex)
        {
            AppendEvent(null, "process/error", new JsonObject
            {
                ["message"] = ex.Message,
            });
        }
        finally
        {
            lock (stateGate)
            {
                if (!shutdown.IsCancellationRequested)
                {
                    initialized = false;
                    state = "exited";
                    detail = "Codex app-server stdout closed.";
                }
            }
        }
    }

    private CodexBridgeTurnState GetTurn(string turnId)
    {
        lock (stateGate)
        {
            if (!turns.TryGetValue(turnId, out var turn))
            {
                throw new CodexBridgeException(StatusCodes.Status404NotFound, "turn_not_found", $"Bridge turn '{turnId}' was not found.");
            }
            return turn;
        }
    }

    private void AppendEvent(string? appTurnId, string method, JsonNode payload)
    {
        var sequence = Interlocked.Increment(ref nextEventSequence);
        var completed = method.Equals("turn/completed", StringComparison.OrdinalIgnoreCase)
            || method.Equals("turn/failed", StringComparison.OrdinalIgnoreCase)
            || method.Equals("turn/cancelled", StringComparison.OrdinalIgnoreCase);
        TaskCompletionSource<long> previous;
        lock (stateGate)
        {
            events.Add(new CodexBridgeEventRecord(sequence, appTurnId, method, payload, completed));
            previous = eventSignal;
            eventSignal = NewSignal();
        }
        previous.TrySetResult(sequence);
    }

    private IReadOnlyList<CodexBridgeEventRecord> SnapshotEvents(string appTurnId, long afterSequence)
    {
        lock (stateGate)
        {
            return events
                .Where(item => item.Sequence > afterSequence && (item.AppTurnId is null || item.AppTurnId == appTurnId))
                .OrderBy(item => item.Sequence)
                .ToList();
        }
    }

    private async Task WaitForEventAsync(long afterSequence, TimeSpan timeout, CancellationToken cancellationToken)
    {
        Task<long> signalTask;
        lock (stateGate)
        {
            signalTask = eventSignal.Task;
            if (nextEventSequence > afterSequence)
            {
                return;
            }
        }
        await Task.WhenAny(signalTask, Task.Delay(timeout, cancellationToken));
    }

    private static TaskCompletionSource<long> NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static string? ExtractString(JsonNode? node, params string[] path)
    {
        var current = node;
        foreach (var segment in path)
        {
            if (current is not JsonObject obj || !obj.TryGetPropertyValue(segment, out current))
            {
                return null;
            }
        }
        return current is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
    }

    private static string? ExtractTurnId(JsonObject obj) =>
        ExtractString(obj, "params", "turnId")
        ?? ExtractString(obj, "params", "turn", "id")
        ?? ExtractString(obj, "params", "turn", "turnId");

    private static bool TryGetInt64(JsonNode? node, out long value)
    {
        value = 0;
        if (node is not JsonValue jsonValue)
        {
            return false;
        }
        if (jsonValue.TryGetValue<long>(out value))
        {
            return true;
        }
        if (jsonValue.TryGetValue<int>(out var intValue))
        {
            value = intValue;
            return true;
        }
        if (jsonValue.TryGetValue<JsonElement>(out var element))
        {
            if (element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out value))
            {
                return true;
            }
            if (element.ValueKind == JsonValueKind.String && long.TryParse(element.GetString(), out value))
            {
                return true;
            }
        }
        return jsonValue.TryGetValue<string>(out var text) && long.TryParse(text, out value);
    }
}

public sealed record CodexBridgeHealthResponse(
    string SchemaVersion,
    bool Configured,
    bool Ready,
    string State,
    string Detail,
    string? Command);

public sealed record CodexBridgeSessionRequest(string? WorkArea = null, bool Ephemeral = true);

public sealed record CodexBridgeSessionResponse(
    string SchemaVersion,
    string SessionId,
    string AppServerThreadId,
    string? WorkArea);

public sealed record CodexBridgeTurnRequest(
    string Input,
    string? WorkArea = null,
    IReadOnlyList<string>? AttachmentIds = null);

public sealed record CodexBridgeTurnResponse(
    string SchemaVersion,
    string TurnId,
    string SessionId,
    string AppServerTurnId,
    string EventUrl);

public sealed record CodexBridgeCancelResponse(string SchemaVersion, string TurnId, bool Cancelled);

public sealed record CodexBridgeErrorResponse(string SchemaVersion, string Code, string Error);

public sealed class CodexBridgeException(int statusCode, string code, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
}

public sealed record CodexBridgeEventRecord(
    long Sequence,
    string? AppTurnId,
    string Event,
    JsonNode Payload,
    bool Completed);

public sealed record CodexBridgeSessionState(
    string SessionId,
    string AppThreadId,
    string? WorkArea,
    DateTimeOffset CreatedAt);

public sealed record CodexBridgeTurnState(
    string TurnId,
    string SessionId,
    string AppTurnId,
    DateTimeOffset CreatedAt);

public sealed record CodexAppServerOptions(
    string? Command,
    IReadOnlyList<string> Arguments,
    string HomeDirectory)
{
    public bool Configured => !string.IsNullOrWhiteSpace(Command);

    public string DisplayCommand => Configured
        ? string.Join(" ", new[] { Command! }.Concat(Arguments.Select(QuoteIfNeeded)))
        : "not configured";

    public static CodexAppServerOptions FromEnvironment(string relayDataDirectory)
    {
        var home = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_HOME")
            ?? Path.Combine(relayDataDirectory, "app-server-home");
        var command = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_COMMAND");
        var args = ReadArgs();

        if (string.IsNullOrWhiteSpace(command))
        {
            var bundled = FindBundledCommand();
            if (bundled is not null)
            {
                command = bundled;
                args = ["app-server"];
            }
        }

        return new CodexAppServerOptions(command, args, home);
    }

    private static IReadOnlyList<string> ReadArgs()
    {
        var json = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_ARGS_JSON");
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                return JsonSerializer.Deserialize<List<string>>(json, JsonOptions.Default) ?? [];
            }
            catch (JsonException)
            {
                return [];
            }
        }
        return [];
    }

    private static string? FindBundledCommand()
    {
        var exe = OperatingSystem.IsWindows() ? "codex.exe" : "codex";
        foreach (var candidate in new[]
        {
            Path.Combine(AppContext.BaseDirectory, "app-server", exe),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "app-server", exe)),
        })
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }
        return null;
    }

    private static string QuoteIfNeeded(string value) =>
        value.Any(char.IsWhiteSpace) ? $"\"{value}\"" : value;
}
