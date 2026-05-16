using System.Security.Cryptography;
using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseKestrel(options => options.AddServerHeader = false);
builder.Services.AddAGUI();

var version = typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.3.3";
var options = RelayOptions.FromEnvironment(args);
var token = options.Token;
var ledger = new RunLedger(options.DataDirectory);
var copilot = CopilotTransportFactory.FromEnvironment();
var copilotChatClient = new RelayCopilotChatClient(copilot);
var toolResolver = new ToolResolver(options.DataDirectory);
var tools = new ToolReadiness(copilot, toolResolver, options.DataDirectory);
var agentRunner = new RelayAgentFrameworkRunner(copilotChatClient, new RelayToolExecutor(options.DataDirectory, toolResolver));
var runManager = new RunManager(ledger, tools, agentRunner);
var agUiHostedAgent = agentRunner.CreateHostedAgent();

var app = builder.Build();
app.Lifetime.ApplicationStopping.Register(runManager.Dispose);
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.None,
});

app.Use(async (context, next) =>
{
    if (!IsLocalHost(context.Request.Host.Host))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Host is not allowed."));
        return;
    }

    if (RequiresToken(context.Request) && !HasValidToken(context.Request, token))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Relay launch token is required."));
        return;
    }

    if (IsStateChanging(context.Request.Method) && !HasAllowedOrigin(context.Request, options.PublicOrigin))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Origin is not allowed."));
        return;
    }

    await next();
});

var staticRoot = options.WorkbenchDist;
if (Directory.Exists(staticRoot))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(staticRoot),
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(staticRoot),
        ServeUnknownFileTypes = false,
    });
}

app.MapGet("/api/status", async (CancellationToken cancellationToken) =>
{
    var checks = await tools.CheckAllAsync(cancellationToken);
    return Results.Json(new StatusResponse(
        App: "Relay Agent",
        Version: version,
        Ready: checks.Where(check => check.Required).All(check => check.Ready),
        Checks: checks));
});

app.MapPost("/api/workspace", (WorkspaceRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Path))
    {
        return Results.BadRequest(new ErrorResponse("Workspace path is required."));
    }

    var fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(request.Path));
    return Results.Json(new WorkspaceResponse(
        Path: fullPath,
        Exists: Directory.Exists(fullPath),
        DisplayPath: fullPath));
});

app.MapPost("/api/runs", async (RunRequest request, CancellationToken cancellationToken) =>
{
    var run = await runManager.StartAsync(request, cancellationToken);
    return Results.Json(RunResponse.FromRun(run));
});

app.MapGet("/api/runs/{runId}", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await runManager.GetAsync(runId, cancellationToken);
    return run is null ? Results.NotFound(new ErrorResponse("Run not found.")) : Results.Json(RunResponse.FromRun(run));
});

app.MapGet("/api/runs/{runId}/events", async (HttpContext context, string runId, CancellationToken cancellationToken) =>
{
    var subscription = await runManager.SubscribeAsync(runId, cancellationToken);
    if (subscription is null)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Run not found."), cancellationToken);
        return;
    }

    context.Response.ContentType = "text/event-stream; charset=utf-8";
    foreach (var runEvent in subscription.Snapshot.Events)
    {
        await WriteSseAsync(context, runEvent, cancellationToken);
    }

    if (subscription.LiveEvents is not null)
    {
        try
        {
            await foreach (var runEvent in subscription.LiveEvents.ReadAllAsync(cancellationToken))
            {
                await WriteSseAsync(context, runEvent, cancellationToken);
            }
        }
        finally
        {
            subscription.Lease?.Dispose();
        }
    }
});

app.MapGet("/api/runs/{runId}/agui-events", async (HttpContext context, string runId, CancellationToken cancellationToken) =>
{
    var subscription = await runManager.SubscribeAsync(runId, cancellationToken);
    if (subscription is null)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Run not found."), cancellationToken);
        return;
    }

    context.Response.ContentType = "text/event-stream; charset=utf-8";
    foreach (var runEvent in subscription.Snapshot.Events)
    {
        await WriteAgUiSseAsync(context, runEvent, cancellationToken);
    }

    if (subscription.LiveEvents is not null)
    {
        try
        {
            await foreach (var runEvent in subscription.LiveEvents.ReadAllAsync(cancellationToken))
            {
                await WriteAgUiSseAsync(context, runEvent, cancellationToken);
            }
        }
        finally
        {
            subscription.Lease?.Dispose();
        }
    }
});

app.MapPost("/api/runs/{runId}/approve", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await runManager.ApproveAsync(runId, cancellationToken);
    if (run is null) return Results.NotFound(new ErrorResponse("Run not found."));
    if (run.PendingApproval is null) return Results.BadRequest(new ErrorResponse("Run is not waiting for approval."));
    return Results.Json(RunResponse.FromRun(run));
});

app.MapPost("/api/runs/{runId}/reject", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await runManager.RejectAsync(runId, cancellationToken);
    return run is null ? Results.NotFound(new ErrorResponse("Run not found.")) : Results.Json(RunResponse.FromRun(run));
});

app.MapPost("/api/runs/{runId}/cancel", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await runManager.CancelAsync(runId, cancellationToken);
    return run is null ? Results.NotFound(new ErrorResponse("Run not found.")) : Results.Json(RunResponse.FromRun(run));
});

app.MapAGUI("/agui/relay", agUiHostedAgent);

app.MapPost("/api/support-bundle", async (HttpRequest request, CancellationToken cancellationToken) =>
{
    var includeSensitive = false;
    if ((request.ContentLength ?? 0) > 0)
    {
        var bundleRequest = await JsonSerializer.DeserializeAsync<SupportBundleRequest>(
            request.Body,
            JsonOptions.Default,
            cancellationToken);
        includeSensitive = bundleRequest?.IncludeSensitive ?? false;
    }

    var path = await SupportBundle.CreateAsync(options.DataDirectory, includeSensitive, cancellationToken);
    return Results.File(path, "application/zip", Path.GetFileName(path));
});

app.MapGet("/v1/models", () => Results.Json(new
{
    @object = "list",
    data = new[]
    {
        new
        {
            id = "m365-copilot",
            @object = "model",
            owned_by = "relay-sidecar",
        },
    },
}));

app.MapPost("/v1/chat/completions", async (OpenAiChatCompletionRequest request, CancellationToken cancellationToken) =>
{
    var prompt = request.LastUserMessage();
    if (string.IsNullOrWhiteSpace(prompt))
    {
        return Results.BadRequest(new ErrorResponse("No user message was supplied."));
    }

    var reply = (await copilotChatClient.GetResponseAsync(
        [new Microsoft.Extensions.AI.ChatMessage(Microsoft.Extensions.AI.ChatRole.User, prompt)],
        new Microsoft.Extensions.AI.ChatOptions { ModelId = request.Model ?? "m365-copilot" },
        cancellationToken)).Text;
    return Results.Json(OpenAiChatCompletionResponse.FromText(request.Model ?? "m365-copilot", reply));
});

app.MapPost("/api/shutdown", (IHostApplicationLifetime lifetime) =>
{
    lifetime.StopApplication();
    return Results.Json(new { ok = true });
});

if (Directory.Exists(staticRoot))
{
    app.MapFallback(async context =>
    {
        var pathValue = context.Request.Path.Value ?? string.Empty;
        if (context.Request.Path.StartsWithSegments("/assets") ||
            (pathValue.Length > 1 && pathValue.EndsWith('/')))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        var index = Path.Combine(staticRoot, "index.html");
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(index);
    });
}

var url = $"http://127.0.0.1:{options.Port}";
app.Urls.Clear();
app.Urls.Add(url);

Console.WriteLine(JsonSerializer.Serialize(new
{
    relay = "ready",
    url = $"{url}/?token={Uri.EscapeDataString(token)}",
    dataDirectory = options.DataDirectory,
    workbenchDist = staticRoot,
}));

await app.RunAsync();

static async Task WriteSseAsync(HttpContext context, RunEvent runEvent, CancellationToken cancellationToken)
{
    await context.Response.WriteAsync("event: run-event\n", cancellationToken);
    await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(runEvent, JsonOptions.Compact)}\n\n", cancellationToken);
    await context.Response.Body.FlushAsync(cancellationToken);
}

static async Task WriteAgUiSseAsync(HttpContext context, RunEvent runEvent, CancellationToken cancellationToken)
{
    await context.Response.WriteAsync("event: ag-ui-event\n", cancellationToken);
    await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(ToAgUiEvent(runEvent), JsonOptions.Compact)}\n\n", cancellationToken);
    await context.Response.Body.FlushAsync(cancellationToken);
}

static object ToAgUiEvent(RunEvent runEvent)
{
    var type = runEvent.Type switch
    {
        "status" => "STATE_DELTA",
        "copilot_turn_started" => "REASONING_START",
        "copilot_turn_completed" => "REASONING_END",
        "tool_call_started" => "TOOL_CALL_START",
        "tool_call_completed" => "TOOL_CALL_END",
        "approval_requested" => "USER_CONFIRMATION_REQUEST",
        "approval_resolved" => "USER_CONFIRMATION_RESULT",
        "completed" => "RUN_FINISHED",
        "cancelled" => "RUN_CANCELLED",
        "error" => "RUN_ERROR",
        _ => "TEXT_MESSAGE_CONTENT",
    };
    var state = runEvent.Type switch
    {
        "approval_requested" => new { approval = runEvent.Data },
        "approval_resolved" => new { approval = (object?)null },
        _ => null,
    };

    return new
    {
        type,
        runId = runEvent.RunId,
        sequence = runEvent.Sequence,
        timestamp = runEvent.Timestamp,
        message = runEvent.Message,
        detail = runEvent.Detail,
        data = runEvent.Data,
        state,
    };
}

static bool RequiresToken(HttpRequest request)
{
    if (request.Path == "/" || request.Path == "/index.html") return false;
    return request.Path.StartsWithSegments("/api")
        || request.Path.StartsWithSegments("/agui")
        || request.Path.StartsWithSegments("/events")
        || request.Path.StartsWithSegments("/v1");
}

static bool HasValidToken(HttpRequest request, string token)
{
    if (request.Headers.TryGetValue("X-Relay-Token", out var header) && header == token) return true;
    return request.Query.TryGetValue("token", out var query) && query == token;
}

static bool IsStateChanging(string method) =>
    HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);

static bool HasAllowedOrigin(HttpRequest request, string publicOrigin)
{
    if (!request.Headers.TryGetValue("Origin", out var origin)) return true;
    return StringComparer.OrdinalIgnoreCase.Equals(origin.ToString().TrimEnd('/'), publicOrigin.TrimEnd('/'));
}

static bool IsLocalHost(string? host) =>
    string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
    || string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
    || string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase);

public sealed record RelayOptions(
    int Port,
    string Token,
    string DataDirectory,
    string WorkbenchDist,
    string PublicOrigin)
{
    public static RelayOptions FromEnvironment(string[] args)
    {
        var port = int.TryParse(Environment.GetEnvironmentVariable("RELAY_PORT"), out var envPort) ? envPort : 17873;
        var token = Environment.GetEnvironmentVariable("RELAY_LAUNCH_TOKEN") ?? CreateToken();
        var data = Environment.GetEnvironmentVariable("RELAY_DATA_DIR") ?? DefaultDataDirectory();
        var dist = Environment.GetEnvironmentVariable("RELAY_WORKBENCH_DIST")
            ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
        var publicOrigin = $"http://127.0.0.1:{port}";

        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--port" && i + 1 < args.Length && int.TryParse(args[i + 1], out var argPort))
            {
                port = argPort;
                publicOrigin = $"http://127.0.0.1:{port}";
                i++;
            }
        }

        Directory.CreateDirectory(data);
        return new RelayOptions(port, token, data, dist, publicOrigin);
    }

    private static string CreateToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string DefaultDataDirectory()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(root))
        {
            root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
        }
        return Path.Combine(root, "Relay Agent");
    }
}

public sealed class ToolReadiness(ICopilotTransport copilot, ToolResolver resolver, string dataDirectory)
{
    public async Task<IReadOnlyList<ReadinessCheck>> CheckAllAsync(CancellationToken cancellationToken)
    {
        var checks = new List<ReadinessCheck>
        {
            await ToolReadinessChecks.CheckExecutableAsync(resolver.ResolveRipgrep(), ["--version"], AppContext.BaseDirectory, cancellationToken),
            await ToolReadinessChecks.CheckOfficeCliAsync(resolver.ResolveOfficeCli(), dataDirectory, cancellationToken),
            await copilot.CheckAsync(cancellationToken),
        };
        return checks;
    }
}

public sealed class RunLedger(string dataDirectory)
{
    private readonly string _runDirectory = Path.Combine(dataDirectory, "runs");
    private readonly string _eventDirectory = Path.Combine(dataDirectory, "run-events");
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task AppendAsync(RunRecord run, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_runDirectory);
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var path = Path.Combine(_runDirectory, $"{run.RunId}.json");
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(run, JsonOptions.Default), cancellationToken);
            Directory.CreateDirectory(_eventDirectory);
            var eventPath = Path.Combine(_eventDirectory, $"{run.RunId}.jsonl");
            var existing = File.Exists(eventPath) ? await File.ReadAllLinesAsync(eventPath, cancellationToken) : [];
            var previousCount = existing.Length;
            var nextEvents = run.Events.Skip(previousCount)
                .Select(runEvent => JsonSerializer.Serialize(runEvent, JsonOptions.Default));
            await File.AppendAllLinesAsync(eventPath, nextEvents, cancellationToken);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<RunRecord?> LoadAsync(string runId, CancellationToken cancellationToken)
    {
        var path = Path.Combine(_runDirectory, $"{runId}.json");
        if (!File.Exists(path)) return null;
        var text = await File.ReadAllTextAsync(path, cancellationToken);
        return JsonSerializer.Deserialize<RunRecord>(text, JsonOptions.Default);
    }
}

public sealed record RunRequest(string Instruction, string Workspace);

public sealed record WorkspaceRequest(string Path);

public sealed record WorkspaceResponse(string Path, bool Exists, string DisplayPath);

public sealed record RunResponse(string RunId, string Status, IReadOnlyList<RunEvent> Events)
{
    public static RunResponse FromRun(RunRecord run) => new(run.RunId, run.Status, run.Events);
}

public sealed record StatusResponse(string App, string Version, bool Ready, IReadOnlyList<ReadinessCheck> Checks);

public sealed record ReadinessCheck(string Name, bool Ready, string Detail, bool Required = true);

public sealed record ErrorResponse(string Error);

public sealed record SupportBundleRequest(bool IncludeSensitive = false);

public sealed record RunEvent(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("detail")] string? Detail = null,
    [property: JsonPropertyName("data")] object? Data = null,
    [property: JsonPropertyName("runId")] string? RunId = null,
    [property: JsonPropertyName("sequence")] long Sequence = 0,
    [property: JsonPropertyName("timestamp")] DateTimeOffset? Timestamp = null)
{
    public static RunEvent Status(string message, string? detail = null) => new("status", message, detail);
    public static RunEvent CopilotTurnStarted(string message, string? detail = null) => new("copilot_turn_started", message, detail);
    public static RunEvent CopilotTurnCompleted(string message, string? detail = null) => new("copilot_turn_completed", message, detail);
    public static RunEvent ToolCallStarted(string message, string? detail = null) => new("tool_call_started", message, detail);
    public static RunEvent ToolCallCompleted(string message, string? detail = null) => new("tool_call_completed", message, detail);
    public static RunEvent Approval(string message, string? detail = null, object? data = null) => new("approval_requested", message, detail, data);
    public static RunEvent ApprovalResolved(string message, string? detail = null) => new("approval_resolved", message, detail);
    public static RunEvent Error(string message, string? detail = null) => new("error", message, detail);
    public static RunEvent Completed(string message, string? detail = null) => new("completed", message, detail);
}

public sealed record RunRecord(
    string RunId,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt,
    RunRequest Request,
    IReadOnlyList<RunEvent> Events,
    PendingApproval? PendingApproval = null,
    JsonElement? AgentSessionState = null)
{
    public static RunRecord Start(RunRequest request) =>
        new($"run-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{RandomNumberGenerator.GetHexString(6).ToLowerInvariant()}",
            "running",
            DateTimeOffset.UtcNow,
            null,
            request,
            []);
}

public static class JsonOptions
{
    public static readonly JsonSerializerOptions Default = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
    };

    public static readonly JsonSerializerOptions Compact = new(JsonSerializerDefaults.Web)
    {
        TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
    };
}

public static class SupportBundle
{
    public static async Task<string> CreateAsync(string dataDirectory, bool includeSensitive, CancellationToken cancellationToken)
    {
        var bundleRoot = Path.Combine(dataDirectory, "support-bundles");
        Directory.CreateDirectory(bundleRoot);
        var path = Path.Combine(bundleRoot, $"relay-support-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}.zip");
        if (File.Exists(path)) File.Delete(path);

        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        AddText(archive, "README.txt", string.Join("\n", [
            "Relay Agent support bundle",
            "This bundle contains run metadata, bounded observations, and event logs.",
            includeSensitive
                ? "Sensitive fields were included because the caller explicitly requested them."
                : "Local paths and content-like fields are redacted by default.",
            $"Created: {DateTimeOffset.UtcNow:O}",
            "",
        ]));

        foreach (var directoryName in new[] { "runs", "run-events" })
        {
            var directory = Path.Combine(dataDirectory, directoryName);
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(dataDirectory, file).Replace('\\', '/');
                if (includeSensitive)
                {
                    archive.CreateEntryFromFile(file, relative, CompressionLevel.Fastest);
                }
                else
                {
                    AddText(archive, relative, SupportBundleRedactor.Redact(await File.ReadAllTextAsync(file, cancellationToken)));
                }
            }
        }

        await Task.CompletedTask;
        return path;
    }

    private static void AddText(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = new StreamWriter(stream);
        writer.Write(content);
    }
}

public static class SupportBundleRedactor
{
    private static readonly HashSet<string> SensitiveFieldNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization",
        "backupPath",
        "content",
        "cookie",
        "detail",
        "filePath",
        "instruction",
        "messageContent",
        "messages",
        "newString",
        "observation",
        "oldString",
        "originalPath",
        "output",
        "password",
        "path",
        "prompt",
        "rawInstruction",
        "result",
        "secret",
        "stderr",
        "stdout",
        "text",
        "token",
        "workspace",
    };

    public static string Redact(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        try
        {
            var node = JsonNode.Parse(text);
            if (node is not null)
            {
                RedactNode(node, parentKey: null);
                return RedactFreeText(node.ToJsonString(JsonOptions.Default));
            }
        }
        catch (JsonException)
        {
            // Fall through to best-effort free-text redaction for plain logs.
        }

        return RedactFreeText(text);
    }

    private static void RedactNode(JsonNode node, string? parentKey)
    {
        if (node is JsonObject obj)
        {
            foreach (var property in obj.ToArray())
            {
                if (property.Value is null) continue;
                if (IsSensitiveField(property.Key))
                {
                    obj[property.Key] = "[REDACTED]";
                    continue;
                }
                RedactNode(property.Value, property.Key);
            }
            return;
        }

        if (node is JsonArray array)
        {
            if (parentKey is not null && IsSensitiveField(parentKey))
            {
                array.Clear();
                array.Add("[REDACTED]");
                return;
            }

            foreach (var item in array)
            {
                if (item is not null) RedactNode(item, parentKey);
            }
            return;
        }

        if (node is JsonValue value && value.TryGetValue<string>(out var text))
        {
            var redacted = RedactFreeText(text);
            if (!string.Equals(text, redacted, StringComparison.Ordinal))
            {
                node.ReplaceWith(JsonValue.Create(redacted));
            }
        }
    }

    private static bool IsSensitiveField(string name)
    {
        if (SensitiveFieldNames.Contains(name)) return true;
        return name.EndsWith("Path", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith("Token", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith("Secret", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("password", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("cookie", StringComparison.OrdinalIgnoreCase);
    }

    private static string RedactFreeText(string text)
    {
        var redacted = Regex.Replace(text, "[A-Za-z]:\\\\[^\"'\\r\\n]+", "[REDACTED_PATH]");
        redacted = Regex.Replace(redacted, "/(?:home|root|tmp|Users|mnt|workspace|private|var)/[^\"'\\s\\r\\n]+", "[REDACTED_PATH]");
        redacted = Regex.Replace(redacted, @"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]");
        redacted = Regex.Replace(redacted, @"(?i)\b(bearer|token|secret|password)\s*[:=]\s*[^\s""']+", "$1=[REDACTED]");
        return redacted;
    }
}
