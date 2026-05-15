using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseKestrel(options => options.AddServerHeader = false);

var version = typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.3.1";
var options = RelayOptions.FromEnvironment(args);
var token = options.Token;
var ledger = new RunLedger(options.DataDirectory);
var copilot = CopilotTransportFactory.FromEnvironment();
var toolResolver = new ToolResolver(options.DataDirectory);
var tools = new ToolReadiness(copilot, toolResolver, options.DataDirectory);
var agentRunner = new RelayAgentRunner(copilot, new RelayToolExecutor(options.DataDirectory, toolResolver));

var app = builder.Build();
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

app.MapPost("/api/runs", async (RunRequest request, CancellationToken cancellationToken) =>
{
    var run = RunRecord.Start(request);
    var events = new List<RunEvent>
    {
        RunEvent.Status("受け付けました", "Relay sidecar がタスクを検証しています。"),
    };

    if (string.IsNullOrWhiteSpace(request.Instruction))
    {
        events.Add(RunEvent.Error("指示が空です", "自然言語のタスクを入力してください。"));
        return await Finish(run, "failed", events, cancellationToken);
    }

    if (string.IsNullOrWhiteSpace(request.Workspace) || !Directory.Exists(request.Workspace))
    {
        events.Add(RunEvent.Error("Workspace を確認できません", "存在するローカルフォルダを指定してください。"));
        return await Finish(run, "failed", events, cancellationToken);
    }

    events.Add(RunEvent.Status("準備状態を確認しています", "Copilot、ripgrep、workspace access を確認しています。OfficeCLI は Office 操作時だけ必要です。"));
    var checks = await tools.CheckAllAsync(cancellationToken);
    foreach (var check in checks)
    {
        var requiredLabel = check.Required ? "required" : "optional";
        events.Add(RunEvent.Tool(check.Name, check.Ready ? $"ready ({requiredLabel})" : $"{check.Detail} ({requiredLabel})"));
    }

    var requiredFailures = checks.Where(check => check.Required && !check.Ready).ToArray();
    if (requiredFailures.Length > 0)
    {
        events.Add(RunEvent.Error(
            "必須ツールが未準備です",
            string.Join("\n", requiredFailures.Select(check => $"{check.Name}: {check.Detail}"))));
        return await Finish(run, "failed", events, cancellationToken);
    }

    events.Add(RunEvent.Status("Copilot に計画を依頼します", "Relay はツール実行だけを担当し、Copilot の判断結果を検証します。"));
    try
    {
        var result = await agentRunner.RunAsync(request, run.RunId, cancellationToken);
        events.AddRange(result.Events);
        return await Finish(run, result.Status, events, cancellationToken, result.PendingApproval);
    }
    catch (Exception ex)
    {
        events.Add(RunEvent.Error("Copilot transport failed", ex.Message));
        return await Finish(run, "failed", events, cancellationToken);
    }
});

app.MapGet("/api/runs/{runId}", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await ledger.LoadAsync(runId, cancellationToken);
    return run is null ? Results.NotFound(new ErrorResponse("Run not found.")) : Results.Json(run);
});

app.MapGet("/api/runs/{runId}/events", async (HttpContext context, string runId, CancellationToken cancellationToken) =>
{
    var run = await ledger.LoadAsync(runId, cancellationToken);
    if (run is null)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("Run not found."), cancellationToken);
        return;
    }

    context.Response.ContentType = "text/event-stream; charset=utf-8";
    foreach (var runEvent in run.Events)
    {
        await context.Response.WriteAsync($"event: {runEvent.Type}\n", cancellationToken);
        await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(runEvent, JsonOptions.Default)}\n\n", cancellationToken);
        await context.Response.Body.FlushAsync(cancellationToken);
    }
});

app.MapPost("/api/runs/{runId}/approve", async (string runId, CancellationToken cancellationToken) =>
{
    var run = await ledger.LoadAsync(runId, cancellationToken);
    if (run is null) return Results.NotFound(new ErrorResponse("Run not found."));
    if (run.PendingApproval is null) return Results.BadRequest(new ErrorResponse("Run is not waiting for approval."));

    var result = await agentRunner.ApproveAsync(run, cancellationToken);
    var events = run.Events.Concat(result.Events).ToList();
    return await Finish(run, result.Status, events, cancellationToken, result.PendingApproval);
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

    var reply = await copilot.SendAsync(prompt, cancellationToken);
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

async Task<IResult> Finish(RunRecord run, string status, List<RunEvent> events, CancellationToken cancellationToken, PendingApproval? pendingApproval = null)
{
    run = run with
    {
        Status = status,
        CompletedAt = status is "completed" or "failed" or "cancelled" ? DateTimeOffset.UtcNow : null,
        Events = events,
        PendingApproval = pendingApproval,
    };
    await ledger.AppendAsync(run, cancellationToken);
    return Results.Json(new RunResponse(run.RunId, status, events, pendingApproval));
}

static bool RequiresToken(HttpRequest request)
{
    if (request.Path == "/" || request.Path == "/index.html") return false;
    return request.Path.StartsWithSegments("/api")
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

public sealed record RunResponse(string RunId, string Status, IReadOnlyList<RunEvent> Events, PendingApproval? PendingApproval = null);

public sealed record StatusResponse(string App, string Version, bool Ready, IReadOnlyList<ReadinessCheck> Checks);

public sealed record ReadinessCheck(string Name, bool Ready, string Detail, bool Required = true);

public sealed record ErrorResponse(string Error);

public sealed record RunEvent(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("detail")] string? Detail = null)
{
    public static RunEvent Status(string message, string? detail = null) => new("status", message, detail);
    public static RunEvent Tool(string message, string? detail = null) => new("tool", message, detail);
    public static RunEvent Approval(string message, string? detail = null) => new("approval", message, detail);
    public static RunEvent Error(string message, string? detail = null) => new("error", message, detail);
    public static RunEvent Final(string message, string? detail = null) => new("final", message, detail);
}

public sealed record RunRecord(
    string RunId,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt,
    RunRequest Request,
    IReadOnlyList<RunEvent> Events,
    PendingApproval? PendingApproval = null)
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
    };
}
