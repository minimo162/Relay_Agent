using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class CodexAppServerBridgeService : IDisposable
{
    private const long MaxAttachmentBytes = 25L * 1024 * 1024;
    private const long MaxTotalAttachmentBytes = 100L * 1024 * 1024;
    private const int MaxAttachmentCount = 20;

    private readonly CodexAppServerOptions options;
    private readonly SemaphoreSlim startGate = new(1, 1);
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonNode?>> pending = new();
    private readonly Dictionary<string, CodexBridgeSessionState> sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CodexBridgeTurnState> turns = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CodexBridgeApprovalRequest> approvals = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CodexBridgeAttachment> attachments = new(StringComparer.Ordinal);
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
        options = CodexAppServerOptions.FromRelayOptions(relayOptions);
        state = options.Configured ? "configured" : "not_configured";
        detail = options.Configured
            ? $"Codex app-server command is configured from {options.Source}; protocol readiness starts on first bridge session."
            : "Codex app-server runtime is not configured or bundled under app/app-server yet.";
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
        ValidateAttachmentIds(request.AttachmentIds);

        var result = await SendRequestAsync("turn/start", new JsonObject
        {
            ["threadId"] = session.AppThreadId,
            ["input"] = BuildTurnInput(request.Input, request.AttachmentIds),
            ["cwd"] = request.WorkArea ?? session.WorkArea,
        }, cancellationToken);
        var appTurnId = ExtractString(result, "turnId")
            ?? ExtractString(result, "turn", "id")
            ?? throw new CodexBridgeException(StatusCodes.Status502BadGateway, "app_server_protocol_error", "turn/start did not return a turn id.");
        var turnId = "turn-" + Guid.NewGuid().ToString("N")[..12];
        var turn = new CodexBridgeTurnState(turnId, sessionId, appTurnId, request.WorkArea ?? session.WorkArea, DateTimeOffset.UtcNow);
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

    public IReadOnlyList<CodexBridgeApprovalRequestResponse> ListApprovals(string turnId)
    {
        _ = GetTurn(turnId);
        lock (stateGate)
        {
            return approvals.Values
                .Where(item => item.TurnId == turnId)
                .OrderBy(item => item.CreatedAt)
                .Select(ToApprovalResponse)
                .ToList();
        }
    }

    public async Task<CodexBridgeApprovalResult> ResolveApprovalAsync(
        string approvalId,
        CodexBridgeApprovalDecision decision,
        CancellationToken cancellationToken)
    {
        CodexBridgeApprovalRequest approval;
        lock (stateGate)
        {
            if (!approvals.TryGetValue(approvalId, out approval!))
            {
                throw new CodexBridgeException(StatusCodes.Status404NotFound, "approval_not_found", $"Bridge approval '{approvalId}' was not found.");
            }
            approvals.Remove(approvalId);
        }

        var resolved = new JsonObject
        {
            ["schemaVersion"] = "RelayCodexBridgeApprovalResolved.v1",
            ["approvalId"] = approval.ApprovalId,
            ["turnId"] = approval.TurnId,
            ["appServerTurnId"] = approval.AppTurnId,
            ["requestId"] = approval.RequestId,
            ["method"] = approval.Method,
            ["approved"] = decision.Approved,
            ["reason"] = decision.Reason,
        };

        var response = BuildApprovalResponse(approval.Method, approval.Params, decision.Approved);
        await SendResponseAsync(approval.RequestId, response, cancellationToken);
        AppendEvent(approval.AppTurnId, "approval/resolved", resolved);

        return new CodexBridgeApprovalResult(
            "RelayCodexAppServerBridgeApprovalResult.v1",
            approvalId,
            approval.TurnId,
            decision.Approved,
            approval.Method);
    }

    public async Task<CodexBridgeAttachmentListResponse> StageAttachmentsAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
        {
            throw new CodexBridgeException(StatusCodes.Status400BadRequest, "invalid_attachment_request", "Attachment upload must use multipart/form-data.");
        }

        var form = await request.ReadFormAsync(cancellationToken);
        if (form.Files.Count == 0)
        {
            throw new CodexBridgeException(StatusCodes.Status400BadRequest, "invalid_attachment_request", "At least one file is required.");
        }
        if (form.Files.Count > MaxAttachmentCount)
        {
            throw new CodexBridgeException(StatusCodes.Status413PayloadTooLarge, "too_many_attachments", $"At most {MaxAttachmentCount} files can be staged at once.");
        }

        var totalBytes = form.Files.Sum(file => file.Length);
        if (totalBytes > MaxTotalAttachmentBytes)
        {
            throw new CodexBridgeException(StatusCodes.Status413PayloadTooLarge, "attachments_too_large", $"Total staged upload size must be {MaxTotalAttachmentBytes} bytes or less.");
        }

        var root = Path.Combine(options.HomeDirectory, "attachments");
        Directory.CreateDirectory(root);
        var staged = new List<CodexBridgeAttachmentResponse>();
        foreach (var file in form.Files)
        {
            if (file.Length <= 0)
            {
                throw new CodexBridgeException(StatusCodes.Status400BadRequest, "empty_attachment", $"Attachment '{file.FileName}' is empty.");
            }
            if (file.Length > MaxAttachmentBytes)
            {
                throw new CodexBridgeException(StatusCodes.Status413PayloadTooLarge, "attachment_too_large", $"Attachment '{file.FileName}' exceeds {MaxAttachmentBytes} bytes.");
            }

            var attachmentId = "attachment-" + Guid.NewGuid().ToString("N")[..12];
            var safeName = SanitizeFileName(string.IsNullOrWhiteSpace(file.FileName) ? "attachment" : file.FileName);
            var fileRoot = Path.Combine(root, attachmentId);
            Directory.CreateDirectory(fileRoot);
            var targetPath = Path.Combine(fileRoot, safeName);
            await using (var input = file.OpenReadStream())
            await using (var output = File.Create(targetPath))
            {
                await input.CopyToAsync(output, cancellationToken);
            }

            var sha256 = await ComputeSha256Async(targetPath, cancellationToken);
            var attachment = new CodexBridgeAttachment(
                attachmentId,
                safeName,
                targetPath,
                file.ContentType,
                file.Length,
                sha256,
                "browser_upload",
                DateTimeOffset.UtcNow);
            lock (stateGate)
            {
                attachments[attachmentId] = attachment;
            }

            var metadataPath = Path.Combine(fileRoot, "metadata.json");
            await File.WriteAllTextAsync(
                metadataPath,
                JsonSerializer.Serialize(attachment, JsonOptions.Default),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                cancellationToken);
            staged.Add(ToAttachmentResponse(attachment));
        }

        return new CodexBridgeAttachmentListResponse("RelayCodexAppServerBridgeAttachments.v1", staged);
    }

    public CodexBridgeAttachmentDeleteResponse DeleteAttachment(string attachmentId)
    {
        CodexBridgeAttachment? attachment;
        lock (stateGate)
        {
            attachments.Remove(attachmentId, out attachment);
        }
        if (attachment is not null)
        {
            var root = Path.GetDirectoryName(attachment.Path);
            if (!string.IsNullOrWhiteSpace(root) && Directory.Exists(root))
            {
                try
                {
                    Directory.Delete(root, recursive: true);
                }
                catch
                {
                    // Best-effort cleanup; the user-local attachment store is also cleaned by retention jobs.
                }
            }
        }

        return new CodexBridgeAttachmentDeleteResponse("RelayCodexAppServerBridgeAttachmentDelete.v1", attachmentId, attachment is not null);
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
            Directory.CreateDirectory(Path.GetDirectoryName(options.ConfigPath)!);
            File.WriteAllText(options.ConfigPath, options.BuildConfigToml(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.WriteAllText(
                Path.Combine(options.HomeDirectory, "relay-app-server-home.json"),
                JsonSerializer.Serialize(new
                {
                    schemaVersion = "RelayCodexAppServerHome.v1",
                    generatedAt = DateTimeOffset.UtcNow,
                    providerBaseUrl = options.ProviderBaseUrl,
                    model = "m365-copilot",
                    source = options.Source,
                }, JsonOptions.Default),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

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
            startInfo.Environment["RELAY_CODEX_PROVIDER_TOKEN"] = options.ProviderToken;
            startInfo.Environment["RELAY_CODEX_PROVIDER_BASE_URL"] = options.ProviderBaseUrl;
            startInfo.Environment["CODEX_DISABLE_UPDATE_CHECK"] = "1";

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
                    if (obj.TryGetPropertyValue("id", out var requestIdNode) && TryGetInt64(requestIdNode, out var requestId))
                    {
                        await HandleServerRequestAsync(requestId, method, obj, cancellationToken);
                    }
                    else
                    {
                        var appTurnId = ExtractTurnId(obj);
                        AppendEvent(appTurnId, method, obj.DeepClone());
                    }
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

    private bool TryGetTurnByAppTurnId(string appTurnId, out CodexBridgeTurnState turn)
    {
        lock (stateGate)
        {
            turn = turns.Values.FirstOrDefault(item => item.AppTurnId == appTurnId)!;
            return turn is not null;
        }
    }

    private async Task HandleServerRequestAsync(long requestId, string method, JsonObject obj, CancellationToken cancellationToken)
    {
        var appTurnId = ExtractTurnId(obj);
        AppendEvent(appTurnId, method, obj.DeepClone());

        if (IsApprovalRequestMethod(method))
        {
            if (string.IsNullOrWhiteSpace(appTurnId) || !TryGetTurnByAppTurnId(appTurnId, out var turn))
            {
                await SendErrorResponseAsync(
                    requestId,
                    -32602,
                    "Approval request arrived before Relay could map the app-server turn.",
                    cancellationToken);
                return;
            }
            var parameters = obj.TryGetPropertyValue("params", out var paramsNode) && paramsNode is JsonObject paramsObject
                ? paramsObject.DeepClone().AsObject()
                : new JsonObject();
            var approvalId = "approval-" + Guid.NewGuid().ToString("N")[..12];
            var approval = new CodexBridgeApprovalRequest(
                approvalId,
                turn.TurnId,
                turn.AppTurnId,
                requestId,
                method,
                parameters,
                DescribeApprovalRequest(method, parameters),
                DateTimeOffset.UtcNow);
            lock (stateGate)
            {
                approvals[approvalId] = approval;
            }
            AppendEvent(turn.AppTurnId, "approval/requested", JsonSerializer.SerializeToNode(ToApprovalResponse(approval), JsonOptions.Default)!);
            return;
        }

        if (method.Equals("item/tool/call", StringComparison.OrdinalIgnoreCase))
        {
            AppendEvent(appTurnId, "dynamic-tool/rejected", new JsonObject
            {
                ["schemaVersion"] = "RelayCodexBridgeDynamicToolRejected.v1",
                ["requestId"] = requestId,
                ["method"] = method,
                ["message"] = "Relay does not provide custom dynamic tools. Codex app-server native tools must handle local work.",
            });
            await SendErrorResponseAsync(
                requestId,
                -32601,
                "Relay does not provide custom dynamic tools. Use Codex app-server native tools.",
                cancellationToken);
            return;
        }

        await SendErrorResponseAsync(requestId, -32601, $"Unsupported app-server request method: {method}", cancellationToken);
    }

    private async Task SendResponseAsync(long id, JsonObject result, CancellationToken cancellationToken)
    {
        await WriteJsonLineAsync(new JsonObject
        {
            ["id"] = id,
            ["result"] = result,
        }, cancellationToken);
    }

    private async Task SendErrorResponseAsync(long id, int code, string message, CancellationToken cancellationToken)
    {
        await WriteJsonLineAsync(new JsonObject
        {
            ["id"] = id,
            ["error"] = new JsonObject
            {
                ["code"] = code,
                ["message"] = message,
            },
        }, cancellationToken);
    }

    private static JsonObject BuildApprovalResponse(string method, JsonObject parameters, bool approved)
    {
        if (method.Equals("item/permissions/requestApproval", StringComparison.OrdinalIgnoreCase))
        {
            var permissions = approved && parameters.TryGetPropertyValue("permissions", out var permissionsNode) && permissionsNode is JsonObject permissionsObject
                ? permissionsObject.DeepClone().AsObject()
                : new JsonObject();
            return new JsonObject
            {
                ["permissions"] = permissions,
                ["scope"] = "turn",
                ["strictAutoReview"] = !approved,
            };
        }

        return new JsonObject
        {
            ["decision"] = approved ? "accept" : "decline",
        };
    }

    private JsonArray BuildTurnInput(string input, IReadOnlyList<string>? attachmentIds)
    {
        var array = new JsonArray();
        array.Add(new JsonObject
        {
            ["type"] = "text",
            ["text"] = input,
        });
        if (attachmentIds is null || attachmentIds.Count == 0)
        {
            return array;
        }

        lock (stateGate)
        {
            foreach (var id in attachmentIds)
            {
                if (attachments.TryGetValue(id, out var attachment))
                {
                    array.Add(new JsonObject
                    {
                        ["type"] = "mention",
                        ["name"] = attachment.FileName,
                        ["path"] = attachment.Path,
                    });
                }
            }
        }
        return array;
    }

    private void ValidateAttachmentIds(IReadOnlyList<string>? attachmentIds)
    {
        if (attachmentIds is null || attachmentIds.Count == 0)
        {
            return;
        }

        lock (stateGate)
        {
            foreach (var id in attachmentIds)
            {
                if (!attachments.ContainsKey(id))
                {
                    throw new CodexBridgeException(StatusCodes.Status400BadRequest, "attachment_not_found", $"Bridge attachment '{id}' was not found.");
                }
            }
        }
    }

    private static bool IsApprovalRequestMethod(string method) =>
        method.Equals("item/commandExecution/requestApproval", StringComparison.OrdinalIgnoreCase) ||
        method.Equals("item/fileChange/requestApproval", StringComparison.OrdinalIgnoreCase) ||
        method.Equals("item/permissions/requestApproval", StringComparison.OrdinalIgnoreCase);

    private static string DescribeApprovalRequest(string method, JsonObject parameters)
    {
        var reason = ExtractString(parameters, "reason");
        if (method.Equals("item/commandExecution/requestApproval", StringComparison.OrdinalIgnoreCase))
        {
            var command = ExtractString(parameters, "command");
            var cwd = ExtractString(parameters, "cwd");
            return FirstNonEmpty(
                reason,
                command is not null && cwd is not null ? $"Run command in {cwd}: {command}" : null,
                command is not null ? $"Run command: {command}" : null,
                "Codex app-server requests command execution approval.");
        }
        if (method.Equals("item/fileChange/requestApproval", StringComparison.OrdinalIgnoreCase))
        {
            var root = ExtractString(parameters, "grantRoot");
            return FirstNonEmpty(
                reason,
                root is not null ? $"Allow file changes under {root}" : null,
                "Codex app-server requests file change approval.");
        }
        return FirstNonEmpty(reason, "Codex app-server requests additional permissions.");
    }

    private static string FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "Approval requested.";

    private static CodexBridgeApprovalRequestResponse ToApprovalResponse(CodexBridgeApprovalRequest approval) =>
        new(
            "RelayCodexAppServerBridgeApproval.v1",
            approval.ApprovalId,
            approval.TurnId,
            approval.AppTurnId,
            approval.RequestId.ToString(),
            ApprovalDisplayName(approval.Method),
            approval.Summary,
            approval.Params,
            approval.CreatedAt);

    private static string ApprovalDisplayName(string method) =>
        method.Equals("item/commandExecution/requestApproval", StringComparison.OrdinalIgnoreCase)
            ? "command"
            : method.Equals("item/fileChange/requestApproval", StringComparison.OrdinalIgnoreCase)
                ? "file change"
                : method.Equals("item/permissions/requestApproval", StringComparison.OrdinalIgnoreCase)
                    ? "permissions"
                    : method;

    private static CodexBridgeAttachmentResponse ToAttachmentResponse(CodexBridgeAttachment attachment) =>
        new(
            "RelayCodexAppServerBridgeAttachment.v1",
            attachment.AttachmentId,
            attachment.FileName,
            attachment.Path,
            attachment.MediaType,
            attachment.Size,
            attachment.Sha256,
            attachment.Source,
            attachment.CreatedAt);

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

    private static string SanitizeFileName(string fileName)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var builder = new StringBuilder(fileName.Length);
        foreach (var ch in fileName)
        {
            builder.Append(invalid.Contains(ch) ? '_' : ch);
        }
        var result = builder.ToString().Trim();
        return string.IsNullOrWhiteSpace(result) ? "attachment" : result;
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
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

public sealed record CodexBridgeApprovalDecision(bool Approved, string? Reason = null);

public sealed record CodexBridgeApprovalRequestResponse(
    string SchemaVersion,
    string ApprovalId,
    string TurnId,
    string AppServerTurnId,
    string ToolCallId,
    string ToolName,
    string Summary,
    JsonObject Args,
    DateTimeOffset CreatedAt);

public sealed record CodexBridgeApprovalResult(
    string SchemaVersion,
    string ApprovalId,
    string TurnId,
    bool Approved,
    string Method);

public sealed record CodexBridgeAttachmentListResponse(string SchemaVersion, IReadOnlyList<CodexBridgeAttachmentResponse> Attachments);

public sealed record CodexBridgeAttachmentResponse(
    string SchemaVersion,
    string AttachmentId,
    string FileName,
    string Path,
    string? MediaType,
    long Size,
    string Sha256,
    string Source,
    DateTimeOffset CreatedAt);

public sealed record CodexBridgeAttachmentDeleteResponse(string SchemaVersion, string AttachmentId, bool Deleted);

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
    string? WorkArea,
    DateTimeOffset CreatedAt);

public sealed record CodexBridgeApprovalRequest(
    string ApprovalId,
    string TurnId,
    string AppTurnId,
    long RequestId,
    string Method,
    JsonObject Params,
    string Summary,
    DateTimeOffset CreatedAt);

public sealed record CodexBridgeAttachment(
    string AttachmentId,
    string FileName,
    string Path,
    string? MediaType,
    long Size,
    string Sha256,
    string Source,
    DateTimeOffset CreatedAt);

public sealed record CodexAppServerOptions(
    string? Command,
    IReadOnlyList<string> Arguments,
    string HomeDirectory,
    string ConfigPath,
    string ProviderBaseUrl,
    string ProviderToken,
    string Source)
{
    public bool Configured => !string.IsNullOrWhiteSpace(Command);

    public string DisplayCommand => Configured
        ? string.Join(" ", new[] { Command! }.Concat(Arguments.Select(QuoteIfNeeded)))
        : "not configured";

    public string BuildConfigToml()
    {
        static string EscapeToml(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);
        return string.Join("\n", new[]
        {
            "# Generated by Relay Agent. Do not edit while Relay is running.",
            "model = \"m365-copilot\"",
            "model_provider = \"relay\"",
            "",
            "[model_providers.relay]",
            "name = \"Relay M365 Copilot\"",
            $"base_url = \"{EscapeToml(ProviderBaseUrl)}\"",
            "env_key = \"RELAY_CODEX_PROVIDER_TOKEN\"",
            "wire_api = \"responses\"",
            "",
        });
    }

    public static CodexAppServerOptions FromRelayOptions(RelayOptions relayOptions)
    {
        var home = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_HOME")
            ?? Path.Combine(relayOptions.DataDirectory, "app-server-home");
        var configPath = Path.Combine(home, "config.toml");
        var providerBaseUrl = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_PROVIDER_BASE_URL")
            ?? $"{relayOptions.PublicOrigin.TrimEnd('/')}/v1";
        var providerToken = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_PROVIDER_TOKEN")
            ?? relayOptions.Token;
        var command = Environment.GetEnvironmentVariable("RELAY_APP_SERVER_COMMAND");
        var args = ReadArgs();
        var source = "environment";

        if (string.IsNullOrWhiteSpace(command))
        {
            var bundled = FindBundledCommand();
            if (bundled is not null)
            {
                command = bundled;
                args = ["app-server"];
                source = "bundled";
            }
            else
            {
                source = "missing";
            }
        }

        return new CodexAppServerOptions(command, args, home, configPath, providerBaseUrl, providerToken, source);
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
