using System.Security.Cryptography;
using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;
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
var copilot = CopilotTransportFactory.FromEnvironment(options.DataDirectory);
var copilotChatClient = new RelayCopilotChatClient(copilot);
var chatGate = new SemaphoreSlim(1, 1);
var toolResolver = new ToolResolver(options.DataDirectory);
var tools = new ToolReadiness(copilot, toolResolver, options.DataDirectory);
var agentRunner = new RelayAgentFrameworkRunner(copilotChatClient, new RelayToolExecutor(options.DataDirectory, toolResolver));
var agUiHostedAgent = agentRunner.CreateHostedAgent();

var app = builder.Build();
await using var lifecycle = new SidecarLifecycle(app.Lifetime, options.IdleExit);
lifecycle.Start();
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.None,
});

app.Use(async (context, next) =>
{
    context.Response.Headers["x-request-id"] = context.TraceIdentifier;

    if (!IsLocalHost(context.Request.Host.Host))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await WriteHttpErrorAsync(context, "Host is not allowed.", StatusCodes.Status403Forbidden, "invalid_request_error", "host_not_allowed");
        return;
    }

    if (RequiresToken(context.Request) && !HasValidToken(context.Request, token))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await WriteHttpErrorAsync(context, "Relay launch token is required.", StatusCodes.Status401Unauthorized, "authentication_error", "missing_api_key");
        return;
    }

    var origin = context.Request.Headers.Origin.ToString();
    if (!string.IsNullOrWhiteSpace(origin) && HasAllowedOrigin(origin, options.PublicOrigin))
    {
        ApplyCorsHeaders(context.Response, origin);
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        if (!HasAllowedOrigin(origin, options.PublicOrigin))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await WriteHttpErrorAsync(context, "Origin is not allowed.", StatusCodes.Status403Forbidden, "invalid_request_error", "origin_not_allowed");
            return;
        }
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    if (IsStateChanging(context.Request.Method) && !HasAllowedOrigin(origin, options.PublicOrigin))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await WriteHttpErrorAsync(context, "Origin is not allowed.", StatusCodes.Status403Forbidden, "invalid_request_error", "origin_not_allowed");
        return;
    }

    using var requestLease = lifecycle.TrackRequest(context.Request.Path);
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

app.MapGet("/health", async (CancellationToken cancellationToken) =>
{
    var checks = await tools.CheckAllAsync(cancellationToken);
    return Results.Json(new HealthResponse(
        SchemaVersion: "RelayCoreHealth.v1",
        App: "Relay Agent",
        Version: version,
        Ready: checks.Where(check => check.Required).All(check => check.Ready),
        Checks: checks));
});

app.MapGet("/v1/copilot/session", async (CancellationToken cancellationToken) =>
{
    var check = await copilot.CheckAsync(cancellationToken);
    return Results.Json(new CopilotSessionResponse(
        SchemaVersion: "RelayCopilotSession.v1",
        Ready: check.Ready,
        State: check.State ?? (check.Ready ? "ready" : "unknown"),
        Detail: check.Detail));
});

app.MapGet("/v1/workspace", () =>
    Results.Json(new WorkspaceCoreResponse(
        SchemaVersion: "RelayWorkspace.v1",
        Path: null,
        DisplayPath: null,
        Exists: false,
        SelectionMode: "native-picker-or-browser-upload")));

app.MapGet("/v1/tools", () =>
    Results.Json(RelayToolCatalogSnapshot.FromCurrentCatalog(), JsonOptions.Default));

app.MapGet("/v1/relay/manifest", (HttpRequest request) =>
{
    var requestBase = $"{request.Scheme}://{request.Host}";
    return Results.Json(RelayHtmlToolManifest.Create(version, requestBase, options.PublicOrigin), JsonOptions.Default);
});

app.MapPost("/v1/workspace/select", async (WorkspacePickRequest request, CancellationToken cancellationToken) =>
{
    var result = await WorkspacePicker.PickAsync(request.CurrentPath, cancellationToken);
    return Results.Json(result, JsonOptions.Default);
});

app.MapGet("/api/tool-catalog", () =>
    Results.Json(RelayToolCatalogSnapshot.FromCurrentCatalog(), JsonOptions.Default));

app.MapGet("/api/prevention-metrics", () =>
    Results.Json(RelayPreventionMetrics.Snapshot().ToJson(), JsonOptions.Default));

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

app.MapPost("/api/workspace/pick", async (WorkspacePickRequest request, CancellationToken cancellationToken) =>
{
    var result = await WorkspacePicker.PickAsync(request.CurrentPath, cancellationToken);
    return Results.Json(result, JsonOptions.Default);
});

app.MapPost("/api/copilot/open", async (CancellationToken cancellationToken) =>
{
    var result = await new EdgeCdpManager(options.DataDirectory).ResolveAsync(startIfMissing: true, cancellationToken);
    return Results.Json(new CopilotOpenResponse(result.Ready, result.Detail, result.State), JsonOptions.Default);
});

app.MapPost("/api/session/heartbeat", async (HttpRequest request, CancellationToken cancellationToken) =>
{
    var body = await JsonSerializer.DeserializeAsync<WorkbenchSessionRequest>(
        request.Body,
        JsonOptions.Default,
        cancellationToken);
    if (string.IsNullOrWhiteSpace(body?.ClientId))
    {
        return Results.BadRequest(new ErrorResponse("Workbench clientId is required."));
    }

    return Results.Json(lifecycle.Heartbeat(body.ClientId.Trim()), JsonOptions.Default);
});

app.MapPost("/api/session/closed", async (HttpRequest request, CancellationToken cancellationToken) =>
{
    var body = await JsonSerializer.DeserializeAsync<WorkbenchSessionRequest>(
        request.Body,
        JsonOptions.Default,
        cancellationToken);
    if (string.IsNullOrWhiteSpace(body?.ClientId))
    {
        return Results.BadRequest(new ErrorResponse("Workbench clientId is required."));
    }

    return Results.Json(lifecycle.Close(body.ClientId.Trim()), JsonOptions.Default);
});

app.MapGet("/api/session/status", () =>
    Results.Json(lifecycle.Status(), JsonOptions.Default));

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

app.MapGet("/v1/models", () => Results.Json(OpenAiApi.ModelsList(), JsonOptions.Default));

app.MapGet("/v1/models/{modelId}", (string modelId) =>
    string.Equals(modelId, OpenAiApi.ModelId, StringComparison.Ordinal)
        ? Results.Json(OpenAiApi.ModelObject(), JsonOptions.Default)
        : OpenAiApi.Error(404, $"Model '{modelId}' was not found. Use '{OpenAiApi.ModelId}'.", param: "model", code: "model_not_found"));

app.MapPost("/v1/chat/completions", async (HttpRequest httpRequest, CancellationToken cancellationToken) =>
{
    var (request, error) = await OpenAiApi.ReadChatRequestAsync(httpRequest, cancellationToken);
    if (error is not null || request is null)
    {
        return error ?? OpenAiApi.Error(400, "Invalid request.");
    }

    if (!await chatGate.WaitAsync(0, cancellationToken))
    {
        return OpenAiApi.Error(409, "Copilot is already handling another request. Retry after the current request completes.", type: "conflict_error", code: "copilot_busy");
    }

    try
    {
        var prompt = OpenAiApi.BuildCopilotPrompt(request);
        var reply = (await copilotChatClient.GetResponseAsync(
            [new Microsoft.Extensions.AI.ChatMessage(Microsoft.Extensions.AI.ChatRole.User, prompt)],
            new Microsoft.Extensions.AI.ChatOptions { ModelId = OpenAiApi.ModelId },
            cancellationToken)).Text;

        return OpenAiApi.BuildOpenAiResponse(request, reply);
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
        return OpenAiApi.Error(408, "The request was cancelled or timed out.", type: "timeout_error", code: "request_cancelled");
    }
    catch (Exception ex)
    {
        return OpenAiApi.Error(502, $"Copilot provider failed: {ex.Message}", type: "api_error", code: "provider_error");
    }
    finally
    {
        chatGate.Release();
    }
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

static bool RequiresToken(HttpRequest request)
{
    if (request.Path == "/" || request.Path == "/index.html") return false;
    return request.Path.StartsWithSegments("/api")
        || request.Path.StartsWithSegments("/agui")
        || request.Path.StartsWithSegments("/events")
        || request.Path.StartsWithSegments("/v1");
}

static Task WriteHttpErrorAsync(HttpContext context, string message, int statusCode, string type, string code)
{
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "application/json; charset=utf-8";
    if (context.Request.Path.StartsWithSegments("/v1"))
    {
        return context.Response.WriteAsJsonAsync(
            new OpenAiErrorEnvelope(new OpenAiError(message, type, null, code)),
            JsonOptions.Default);
    }

    return context.Response.WriteAsJsonAsync(new ErrorResponse(message), JsonOptions.Default);
}

static bool HasValidToken(HttpRequest request, string token)
{
    if (request.Headers.TryGetValue("X-Relay-Token", out var header) && header == token) return true;
    if (request.Headers.TryGetValue("Authorization", out var authorization))
    {
        foreach (var value in authorization)
        {
            if (!string.IsNullOrWhiteSpace(value) &&
                value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(value["Bearer ".Length..].Trim(), token, StringComparison.Ordinal))
            {
                return true;
            }
        }
    }
    return request.Query.TryGetValue("token", out var query) && query == token;
}

static bool IsStateChanging(string method) =>
    HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);

static bool HasAllowedOrigin(string origin, string publicOrigin)
{
    if (string.IsNullOrWhiteSpace(origin)) return true;
    var normalized = origin.TrimEnd('/');
    if (StringComparer.OrdinalIgnoreCase.Equals(normalized, publicOrigin.TrimEnd('/'))) return true;
    if (StringComparer.OrdinalIgnoreCase.Equals(normalized, "null")) return true;
    if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri)) return false;
    return (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && IsLocalHost(uri.Host);
}

static void ApplyCorsHeaders(HttpResponse response, string origin)
{
    response.Headers["Access-Control-Allow-Origin"] = origin;
    response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Relay-Token";
    response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    response.Headers["Access-Control-Max-Age"] = "600";
    response.Headers["Vary"] = "Origin";
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
    string PublicOrigin,
    SidecarIdleExitOptions IdleExit)
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
        return new RelayOptions(port, token, data, dist, publicOrigin, SidecarIdleExitOptions.FromEnvironment());
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
    private ReadinessCheck? _officeCache;
    private DateTimeOffset _officeCacheAt;
    private Task<ReadinessCheck>? _officeProbeTask;
    private readonly object _officeGate = new();

    public async Task<IReadOnlyList<ReadinessCheck>> CheckAllAsync(CancellationToken cancellationToken)
    {
        var ripgrepTask = ToolReadinessChecks.CheckExecutableAsync(
            resolver.ResolveRipgrep(),
            ["--version"],
            AppContext.BaseDirectory,
            cancellationToken);
        var copilotTask = copilot.CheckAsync(cancellationToken);
        var office = CheckOfficeCliCachedOrStart();

        await Task.WhenAll(ripgrepTask, copilotTask);
        return [await ripgrepTask, office, await copilotTask];
    }

    private ReadinessCheck CheckOfficeCliCachedOrStart()
    {
        if (_officeCache is not null && DateTimeOffset.UtcNow - _officeCacheAt < TimeSpan.FromMinutes(3))
        {
            return _officeCache;
        }

        lock (_officeGate)
        {
            if (_officeProbeTask is { IsCompleted: true })
            {
                try
                {
                    _officeCache = _officeProbeTask.GetAwaiter().GetResult();
                }
                catch (Exception ex)
                {
                    _officeCache = new ReadinessCheck(
                        "officecli",
                        false,
                        $"OfficeCLI readiness check failed: {ex.Message}",
                        Required: false,
                        State: "provider_error");
                }
                _officeCacheAt = DateTimeOffset.UtcNow;
                _officeProbeTask = null;
                return _officeCache;
            }

            _officeProbeTask ??= Task.Run(() =>
                ToolReadinessChecks.CheckOfficeCliAsync(resolver.ResolveOfficeCli(), dataDirectory, CancellationToken.None));
        }

        return new ReadinessCheck(
            "officecli",
            false,
            "OfficeCLI readiness check is warming up in the background.",
            Required: false,
            State: "connecting");
    }
}

public sealed record WorkspaceRequest(string Path);

public sealed record WorkspaceResponse(string Path, bool Exists, string DisplayPath);

public sealed record WorkspacePickRequest(string? CurrentPath);

public sealed record WorkspacePickResponse(bool Cancelled, string? Path, bool Exists, string? DisplayPath, string? Error = null);

public sealed record CopilotOpenResponse(bool Ready, string Detail, string State);

public sealed record StatusResponse(string App, string Version, bool Ready, IReadOnlyList<ReadinessCheck> Checks);

public sealed record ReadinessCheck(string Name, bool Ready, string Detail, bool Required = true, string? State = null);

public sealed record ErrorResponse(string Error);

public sealed record SupportBundleRequest(bool IncludeSensitive = false);

public sealed record HealthResponse(
    string SchemaVersion,
    string App,
    string Version,
    bool Ready,
    IReadOnlyList<ReadinessCheck> Checks);

public sealed record CopilotSessionResponse(
    string SchemaVersion,
    bool Ready,
    string State,
    string Detail);

public sealed record WorkspaceCoreResponse(
    string SchemaVersion,
    string? Path,
    string? DisplayPath,
    bool Exists,
    string SelectionMode);

public sealed record RelayHtmlToolManifest(
    string SchemaVersion,
    string App,
    string Version,
    string BaseUrl,
    RelayHtmlToolAuth Auth,
    RelayHtmlToolCors Cors,
    IReadOnlyList<RelayHtmlToolEndpoint> Endpoints)
{
    public static RelayHtmlToolManifest Create(string version, string baseUrl, string publicOrigin) =>
        new(
            SchemaVersion: "RelayHtmlToolManifest.v1",
            App: "Relay Agent",
            Version: version,
            BaseUrl: baseUrl.TrimEnd('/'),
            Auth: new RelayHtmlToolAuth("launch-token", "token", "X-Relay-Token"),
            Cors: new RelayHtmlToolCors(
                LocalHtmlTools: true,
                AllowedOrigins: [publicOrigin.TrimEnd('/'), "null", "http://127.0.0.1:*", "http://localhost:*"]),
            Endpoints: [
                new RelayHtmlToolEndpoint("GET", "/health", "Read Relay Core readiness."),
                new RelayHtmlToolEndpoint("GET", "/v1/relay/manifest", "Discover the HTML tool API contract."),
                new RelayHtmlToolEndpoint("GET", "/v1/copilot/session", "Read Copilot provider state."),
                new RelayHtmlToolEndpoint("GET", "/v1/models", "List OpenAI-compatible Relay models."),
                new RelayHtmlToolEndpoint("GET", "/v1/models/{model}", "Read a single OpenAI-compatible Relay model."),
                new RelayHtmlToolEndpoint("POST", "/v1/chat/completions", "Ask M365 Copilot through an OpenAI-compatible chat shape. Client tools are declared with OpenAI function tools and executed by the client."),
                new RelayHtmlToolEndpoint("POST", "/api/support-bundle", "Export an explicit redacted diagnostics bundle.")
            ]);
}

public sealed record RelayHtmlToolAuth(string Type, string QueryParameter, string Header);

public sealed record RelayHtmlToolCors(bool LocalHtmlTools, IReadOnlyList<string> AllowedOrigins);

public sealed record RelayHtmlToolEndpoint(string Method, string Path, string Purpose);

public sealed record RelayToolCatalogSnapshot(
    string SchemaVersion,
    IReadOnlyList<RelayToolCatalogSnapshotEntry> Tools)
{
    public static RelayToolCatalogSnapshot FromCurrentCatalog() =>
        new(
            "RelayAgentToolCatalogSnapshot.v1",
            RelayAgentToolCatalog.All.Select(tool => new RelayToolCatalogSnapshotEntry(
                tool.Name,
                tool.Description,
                tool.ExecutorTool,
                tool.Safety.ToString(),
                tool.FrameworkToolType.ToString(),
                tool.CapabilityFamily,
                tool.ProviderKey,
                tool.MutationClass.ToString(),
                tool.ApprovalPolicy,
                tool.OutputContract,
                tool.PromptVisibility)).ToArray());
}

public sealed record RelayToolCatalogSnapshotEntry(
    string Name,
    string Description,
    string ExecutorTool,
    string Safety,
    string FrameworkToolType,
    string CapabilityFamily,
    string ProviderKey,
    string MutationClass,
    string ApprovalPolicy,
    string OutputContract,
    string PromptVisibility);

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

        AddText(
            archive,
            "audit/tool-call-summary.json",
            await ToolCallAuditSummary.CreateJsonAsync(dataDirectory, cancellationToken));
        AddText(
            archive,
            "audit/prevention-metrics.json",
            RelayPreventionMetrics.Snapshot().ToJson().ToJsonString(JsonOptions.Default));

        foreach (var directoryName in new[] { "runs", "run-events", "agui-events", "traces" })
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

public static class ToolCallAuditSummary
{
    private static readonly string[] AuditDirectories = ["runs", "run-events", "agui-events", "traces"];

    public static async Task<string> CreateJsonAsync(string dataDirectory, CancellationToken cancellationToken)
    {
        var records = new List<ToolCallAuditRecord>();
        var scannedFiles = 0;

        foreach (var directoryName in AuditDirectories)
        {
            var directory = Path.Combine(dataDirectory, directoryName);
            if (!Directory.Exists(directory)) continue;

            foreach (var file in Directory.EnumerateFiles(directory, "*.json", SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                scannedFiles += 1;

                JsonNode? node;
                try
                {
                    node = JsonNode.Parse(await File.ReadAllTextAsync(file, cancellationToken));
                }
                catch (JsonException)
                {
                    records.Add(new ToolCallAuditRecord(
                        Source: Path.GetRelativePath(dataDirectory, file).Replace('\\', '/'),
                        Type: "unparseable_json",
                        ToolName: null,
                        ArgumentClassification: [],
                        ApprovalStatus: null,
                        Success: null,
                        DurationMs: null,
                        OutputTruncated: null,
                        HasBackupPointer: false,
                        HasDiffPointer: false));
                    continue;
                }

                if (node is null) continue;
                CollectRecords(
                    node,
                    Path.GetRelativePath(dataDirectory, file).Replace('\\', '/'),
                    records);
            }
        }

        var summary = new ToolCallAuditSummaryDocument(
            SchemaVersion: "RelayToolCallAuditSummary.v1",
            ScannedFiles: scannedFiles,
            ToolLikeRecords: records.Count,
            Records: records
                .OrderBy(record => record.Source, StringComparer.Ordinal)
                .ThenBy(record => record.Type, StringComparer.Ordinal)
                .ThenBy(record => record.ToolName, StringComparer.Ordinal)
                .Take(200)
                .ToArray());
        return JsonSerializer.Serialize(summary, JsonOptions.Default);
    }

    private static void CollectRecords(JsonNode node, string source, List<ToolCallAuditRecord> records)
    {
        if (node is JsonObject obj)
        {
            if (LooksLikeToolOrApprovalRecord(obj))
            {
                records.Add(new ToolCallAuditRecord(
                    Source: source,
                    Type: FindString(obj, "type") ?? "tool_or_approval",
                    ToolName: FindFirstString(obj, ["toolName", "toolCallName", "functionName", "tool", "name"]),
                    ArgumentClassification: ClassifyArguments(obj),
                    ApprovalStatus: ApprovalStatus(obj),
                    Success: SuccessState(obj),
                    DurationMs: FindFirstNumber(obj, ["durationMs", "elapsedMs", "latencyMs"]),
                    OutputTruncated: FindFirstBoolean(obj, ["outputTruncated", "truncated"]),
                    HasBackupPointer: ContainsKeyFragment(obj, "backup"),
                    HasDiffPointer: ContainsKeyFragment(obj, "diff")));
            }

            foreach (var property in obj)
            {
                if (property.Value is not null) CollectRecords(property.Value, source, records);
            }
            return;
        }

        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                if (item is not null) CollectRecords(item, source, records);
            }
        }
    }

    private static bool LooksLikeToolOrApprovalRecord(JsonObject obj)
    {
        var type = FindString(obj, "type");
        if (type is not null && (
            type.Contains("tool", StringComparison.OrdinalIgnoreCase) ||
            type.Contains("approval", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return FindFirstString(obj, ["toolName", "toolCallName", "functionName", "tool"]) is not null ||
            obj.ContainsKey("approved") ||
            obj.ContainsKey("approvalId") ||
            obj.ContainsKey("toolCallId");
    }

    private static IReadOnlyList<string> ClassifyArguments(JsonObject obj)
    {
        var classes = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var (key, value) in obj)
        {
            if (!key.Contains("arg", StringComparison.OrdinalIgnoreCase) &&
                !key.Contains("parameter", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            ClassifyNode(value, classes);
        }
        return classes.ToArray();
    }

    private static void ClassifyNode(JsonNode? node, SortedSet<string> classes)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var (key, value) in obj)
                {
                    if (LooksPathLikeKey(key)) classes.Add("path-like");
                    else if (LooksContentLikeKey(key)) classes.Add("content-like");
                    else if (LooksCommandLikeKey(key)) classes.Add("command-like");
                    else classes.Add("other");
                    ClassifyNode(value, classes);
                }
                break;
            case JsonArray array:
                foreach (var item in array) ClassifyNode(item, classes);
                break;
            case JsonValue value when value.TryGetValue<string>(out var text):
                if (Regex.IsMatch(text, @"^[A-Za-z]:\\|^/")) classes.Add("path-like");
                else classes.Add("literal");
                break;
            case JsonValue:
                classes.Add("literal");
                break;
        }
    }

    private static string? ApprovalStatus(JsonObject obj)
    {
        if (FindFirstBoolean(obj, ["approved"]) is { } approved) return approved ? "approved" : "rejected";
        var type = FindString(obj, "type");
        if (type is not null && type.Contains("approval", StringComparison.OrdinalIgnoreCase))
        {
            return FindFirstString(obj, ["status", "approvalStatus"]) ?? "requested";
        }
        return FindFirstString(obj, ["approvalStatus"]);
    }

    private static bool? SuccessState(JsonObject obj)
    {
        if (FindFirstBoolean(obj, ["success", "ok"]) is { } success) return success;
        var type = FindString(obj, "type");
        if (type is not null)
        {
            if (type.Contains("completed", StringComparison.OrdinalIgnoreCase) ||
                type.Contains("result", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            if (type.Contains("error", StringComparison.OrdinalIgnoreCase) ||
                type.Contains("failed", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }
        var status = FindString(obj, "status");
        if (status is null) return null;
        if (status.Equals("completed", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("ok", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("success", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (status.Equals("failed", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("error", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        return null;
    }

    private static string? FindFirstString(JsonObject obj, IReadOnlyList<string> names)
    {
        foreach (var name in names)
        {
            if (FindString(obj, name) is { } value) return value;
        }
        return null;
    }

    private static string? FindString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) &&
        node is JsonValue value &&
        value.TryGetValue<string>(out var text)
            ? SupportBundleRedactor.Redact(text)
            : null;

    private static double? FindFirstNumber(JsonObject obj, IReadOnlyList<string> names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetPropertyValue(name, out var node) &&
                node is JsonValue value &&
                value.TryGetValue<double>(out var number))
            {
                return number;
            }
        }
        return null;
    }

    private static bool? FindFirstBoolean(JsonObject obj, IReadOnlyList<string> names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetPropertyValue(name, out var node) &&
                node is JsonValue value &&
                value.TryGetValue<bool>(out var flag))
            {
                return flag;
            }
        }
        return null;
    }

    private static bool ContainsKeyFragment(JsonObject obj, string fragment)
    {
        foreach (var (key, value) in obj)
        {
            if (key.Contains(fragment, StringComparison.OrdinalIgnoreCase)) return true;
            if (value is JsonObject child && ContainsKeyFragment(child, fragment)) return true;
            if (value is JsonArray array)
            {
                foreach (var item in array)
                {
                    if (item is JsonObject itemObj && ContainsKeyFragment(itemObj, fragment)) return true;
                }
            }
        }
        return false;
    }

    private static bool LooksPathLikeKey(string key) =>
        key.Contains("path", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("file", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("cwd", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("workspace", StringComparison.OrdinalIgnoreCase);

    private static bool LooksContentLikeKey(string key) =>
        key.Contains("content", StringComparison.OrdinalIgnoreCase) ||
        key.Contains("string", StringComparison.OrdinalIgnoreCase) ||
        key.Contains("text", StringComparison.OrdinalIgnoreCase) ||
        key.Contains("prompt", StringComparison.OrdinalIgnoreCase);

    private static bool LooksCommandLikeKey(string key) =>
        key.Contains("command", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("argv", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("args", StringComparison.OrdinalIgnoreCase);
}

public sealed record ToolCallAuditSummaryDocument(
    string SchemaVersion,
    int ScannedFiles,
    int ToolLikeRecords,
    IReadOnlyList<ToolCallAuditRecord> Records);

public sealed record ToolCallAuditRecord(
    string Source,
    string Type,
    string? ToolName,
    IReadOnlyList<string> ArgumentClassification,
    string? ApprovalStatus,
    bool? Success,
    double? DurationMs,
    bool? OutputTruncated,
    bool HasBackupPointer,
    bool HasDiffPointer);

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
        "file_path",
        "instruction",
        "messageContent",
        "messages",
        "newString",
        "new_string",
        "observation",
        "oldString",
        "old_string",
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
