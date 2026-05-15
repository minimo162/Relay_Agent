using System.Diagnostics;
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
var tools = new ToolReadiness(copilot);

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
        Ready: checks.All(check => check.Ready),
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

    events.Add(RunEvent.Status("準備状態を確認しています", "Copilot、ripgrep、OfficeCLI、workspace access を確認しています。"));
    var checks = await tools.CheckAllAsync(cancellationToken);
    foreach (var check in checks)
    {
        events.Add(RunEvent.Tool(check.Name, check.Ready ? "ready" : check.Detail));
    }

    var copilotReady = checks.FirstOrDefault(check => check.Name == "copilot-cdp")?.Ready == true;
    if (!copilotReady)
    {
        events.Add(RunEvent.Error(
            "Copilot transport is not ready",
            "M365 Copilot via Edge CDP が未設定です。Relay はローカル実行にフォールバックしません。"));
        return await Finish(run, "failed", events, cancellationToken);
    }

    events.Add(RunEvent.Status("Copilot に計画を依頼します", "Relay はツール実行だけを担当し、Copilot の判断結果を検証します。"));
    try
    {
        var reply = await copilot.SendAsync(BuildRelayPrompt(request), cancellationToken);
        events.Add(RunEvent.Final("Copilot から応答を取得しました", reply));
    }
    catch (Exception ex)
    {
        events.Add(RunEvent.Error("Copilot transport failed", ex.Message));
        return await Finish(run, "failed", events, cancellationToken);
    }
    return await Finish(run, "completed", events, cancellationToken);
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

async Task<IResult> Finish(RunRecord run, string status, List<RunEvent> events, CancellationToken cancellationToken)
{
    run = run with
    {
        Status = status,
        CompletedAt = DateTimeOffset.UtcNow,
        Events = events,
    };
    await ledger.AppendAsync(run, cancellationToken);
    return Results.Json(new RunResponse(run.RunId, status, events));
}

static string BuildRelayPrompt(RunRequest request) =>
    string.Join("\n", [
        "RELAY AGENT RUN",
        "You are the planning and synthesis brain. Relay executes local tools.",
        "Do not claim local execution unless Relay observations prove it.",
        "Return a concise Japanese answer for the user request.",
        $"WORKSPACE: {request.Workspace}",
        "USER REQUEST:",
        request.Instruction,
    ]);

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

public sealed class ToolReadiness(ICopilotTransport copilot)
{
    public async Task<IReadOnlyList<ReadinessCheck>> CheckAllAsync(CancellationToken cancellationToken)
    {
        var checks = new List<ReadinessCheck>
        {
            CheckExecutable("ripgrep", "rg", "--version"),
            CheckExecutable("officecli", "officecli", "--version"),
            await copilot.CheckAsync(cancellationToken),
        };
        return checks;
    }

    private static ReadinessCheck CheckExecutable(string name, string fileName, string argument)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = fileName,
                ArgumentList = { argument },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (process is null) return new ReadinessCheck(name, false, $"{fileName} could not start.");
            if (!process.WaitForExit(5000))
            {
                process.Kill(entireProcessTree: true);
                return new ReadinessCheck(name, false, $"{fileName} timed out.");
            }
            return new ReadinessCheck(name, process.ExitCode == 0, process.ExitCode == 0 ? "ready" : $"{fileName} exited {process.ExitCode}.");
        }
        catch (Exception ex)
        {
            return new ReadinessCheck(name, false, ex.Message);
        }
    }
}

public sealed class RunLedger(string dataDirectory)
{
    private readonly string _runDirectory = Path.Combine(dataDirectory, "runs");
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task AppendAsync(RunRecord run, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_runDirectory);
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var path = Path.Combine(_runDirectory, $"{run.RunId}.json");
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(run, JsonOptions.Default), cancellationToken);
        }
        finally
        {
            _lock.Release();
        }
    }
}

public sealed record RunRequest(string Instruction, string Workspace);

public sealed record RunResponse(string RunId, string Status, IReadOnlyList<RunEvent> Events);

public sealed record StatusResponse(string App, string Version, bool Ready, IReadOnlyList<ReadinessCheck> Checks);

public sealed record ReadinessCheck(string Name, bool Ready, string Detail);

public sealed record ErrorResponse(string Error);

public sealed record RunEvent(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("detail")] string? Detail = null)
{
    public static RunEvent Status(string message, string? detail = null) => new("status", message, detail);
    public static RunEvent Tool(string message, string? detail = null) => new("tool", message, detail);
    public static RunEvent Error(string message, string? detail = null) => new("error", message, detail);
    public static RunEvent Final(string message, string? detail = null) => new("final", message, detail);
}

public sealed record RunRecord(
    string RunId,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt,
    RunRequest Request,
    IReadOnlyList<RunEvent> Events)
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
