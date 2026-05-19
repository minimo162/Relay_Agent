using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;

var appDir = AppContext.BaseDirectory;
var sidecarDir = ResolveSidecarDirectory(appDir);
var sidecarName = OperatingSystem.IsWindows() ? "Relay.Sidecar.exe" : "Relay.Sidecar";
var sidecarPath = Path.Combine(sidecarDir, sidecarName);

if (!File.Exists(sidecarPath))
{
    Console.Error.WriteLine($"Relay sidecar was not found: {sidecarPath}");
    return 1;
}

var port = ResolvePort();
var token = CreateToken();
var dataDir = ResolveDataDirectory();
var workbenchDist = Path.Combine(sidecarDir, "wwwroot");

Directory.CreateDirectory(dataDir);

var startInfo = new ProcessStartInfo
{
    FileName = sidecarPath,
    WorkingDirectory = sidecarDir,
    UseShellExecute = false,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
    CreateNoWindow = true,
};
startInfo.Environment["RELAY_PORT"] = port.ToString();
startInfo.Environment["RELAY_LAUNCH_TOKEN"] = token;
startInfo.Environment["RELAY_DATA_DIR"] = dataDir;
startInfo.Environment["RELAY_WORKBENCH_DIST"] = workbenchDist;
startInfo.Environment["RELAY_ENABLE_IDLE_EXIT"] = "1";
startInfo.Environment["RELAY_IDLE_EXIT_MS"] = Environment.GetEnvironmentVariable("RELAY_IDLE_EXIT_MS") ?? "60000";
startInfo.Environment["RELAY_IDLE_STARTUP_GRACE_MS"] = Environment.GetEnvironmentVariable("RELAY_IDLE_STARTUP_GRACE_MS") ?? "180000";
startInfo.Environment["RELAY_IDLE_HEARTBEAT_TTL_MS"] = Environment.GetEnvironmentVariable("RELAY_IDLE_HEARTBEAT_TTL_MS") ?? "30000";

using var process = Process.Start(startInfo);
if (process is null)
{
    Console.Error.WriteLine("Relay sidecar could not be started.");
    return 1;
}

var readyUrl = await WaitForReadyUrlAsync(process, TimeSpan.FromSeconds(20));
if (readyUrl is null)
{
    try
    {
        if (!process.HasExited) process.Kill(entireProcessTree: true);
    }
    catch
    {
        // Best-effort cleanup.
    }
    Console.Error.WriteLine("Relay sidecar did not report readiness.");
    return 1;
}

OpenBrowser(readyUrl);
Console.WriteLine($"Relay Agent is running: {readyUrl}");
return 0;

static int ResolvePort()
{
    if (int.TryParse(Environment.GetEnvironmentVariable("RELAY_PORT"), out var configured) && configured > 0)
    {
        return configured;
    }

    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    listener.Stop();
    return port;
}

static string ResolveSidecarDirectory(string launcherDirectory)
{
    var packagedSidecarDirectory = Path.Combine(launcherDirectory, "app", "relay-core");
    if (File.Exists(Path.Combine(
            packagedSidecarDirectory,
            OperatingSystem.IsWindows() ? "Relay.Sidecar.exe" : "Relay.Sidecar")))
    {
        return packagedSidecarDirectory;
    }

    return launcherDirectory;
}

static string ResolveDataDirectory()
{
    var configured = Environment.GetEnvironmentVariable("RELAY_DATA_DIR");
    if (!string.IsNullOrWhiteSpace(configured)) return configured;

    var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    if (string.IsNullOrWhiteSpace(root))
    {
        root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
    }
    return Path.Combine(root, "Relay Agent");
}

static string CreateToken()
{
    Span<byte> bytes = stackalloc byte[32];
    RandomNumberGenerator.Fill(bytes);
    return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

static async Task<string?> WaitForReadyUrlAsync(Process process, TimeSpan timeout)
{
    using var cts = new CancellationTokenSource(timeout);
    while (!cts.IsCancellationRequested && !process.HasExited)
    {
        var line = await ReadLineWithCancellationAsync(process.StandardOutput, cts.Token);
        if (line is null) continue;
        try
        {
            using var document = JsonDocument.Parse(line);
            if (document.RootElement.TryGetProperty("relay", out var relay)
                && relay.GetString() == "ready"
                && document.RootElement.TryGetProperty("url", out var url))
            {
                return url.GetString();
            }
        }
        catch
        {
            // Sidecar may print non-JSON framework output before readiness.
        }
    }
    return null;
}

static async Task<string?> ReadLineWithCancellationAsync(StreamReader reader, CancellationToken cancellationToken)
{
    try
    {
        return await reader.ReadLineAsync(cancellationToken);
    }
    catch (OperationCanceledException)
    {
        return null;
    }
}

static void OpenBrowser(string url)
{
    try
    {
        if (OperatingSystem.IsWindows() || OperatingSystem.IsMacOS())
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            return;
        }

        if (TryStart("xdg-open", url)) return;
        if (TryStart("gio", "open", url)) return;
        Console.WriteLine(url);
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Could not open browser automatically: {ex.Message}");
        Console.WriteLine(url);
    }
}

static bool TryStart(string fileName, params string[] args)
{
    try
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = false,
        }.WithArguments(args));
        return true;
    }
    catch
    {
        return false;
    }
}

internal static class ProcessStartInfoExtensions
{
    public static ProcessStartInfo WithArguments(this ProcessStartInfo startInfo, IEnumerable<string> args)
    {
        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }
        return startInfo;
    }
}
