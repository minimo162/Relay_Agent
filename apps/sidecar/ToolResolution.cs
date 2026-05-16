using System.Diagnostics;
using System.IO.Compression;

public sealed record ToolResolution(
    string Name,
    bool Available,
    string? ExecutablePath,
    string Detail,
    bool Required);

public sealed class ToolResolver(string dataDirectory)
{
    private const string OfficeCliVersion = "1.0.92";

    public ToolResolution ResolveRipgrep() =>
        ResolveExecutable(
            name: "ripgrep",
            commandName: "rg",
            envVar: "RELAY_RIPGREP_PATH",
            required: true,
            bundledRelativePaths:
            [
                PlatformExecutable("relay-tools/ripgrep/rg"),
                PlatformExecutable("resources/relay-tools/ripgrep/rg"),
            ]);

    public ToolResolution ResolveOfficeCli() =>
        ResolveExecutable(
            name: "officecli",
            commandName: "officecli",
            envVar: "RELAY_OFFICECLI_PATH",
            required: false,
            bundledRelativePaths:
            [
                PlatformExecutable("relay-tools/officecli/officecli"),
                PlatformExecutable("resources/relay-tools/officecli/officecli"),
                Path.Combine(dataDirectory, "tools", "officecli", OfficeCliVersion, WindowsExecutable("officecli")),
                Path.Combine(dataDirectory, "tools", "officecli", WindowsExecutable("officecli")),
                Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".relay-agent",
                    "tools",
                    "officecli",
                    OfficeCliVersion,
                    WindowsExecutable("officecli")),
            ]);

    private static ToolResolution ResolveExecutable(
        string name,
        string commandName,
        string envVar,
        bool required,
        IReadOnlyList<string> bundledRelativePaths)
    {
        var envPath = Environment.GetEnvironmentVariable(envVar);
        if (!string.IsNullOrWhiteSpace(envPath))
        {
            var expanded = Environment.ExpandEnvironmentVariables(envPath);
            if (File.Exists(expanded))
            {
                return new ToolResolution(name, true, Path.GetFullPath(expanded), $"resolved from {envVar}", required);
            }

            return new ToolResolution(name, false, null, $"{envVar} points to a missing file: {expanded}", required);
        }

        foreach (var candidate in bundledRelativePaths)
        {
            var full = Path.IsPathRooted(candidate) ? candidate : Path.Combine(AppContext.BaseDirectory, candidate);
            if (File.Exists(full))
            {
                return new ToolResolution(name, true, Path.GetFullPath(full), "resolved from bundled or user-local resources", required);
            }
        }

        var pathCandidate = FindOnPath(commandName);
        if (pathCandidate is not null)
        {
            return new ToolResolution(name, true, pathCandidate, "resolved from PATH", required);
        }

        return new ToolResolution(name, false, null, $"{commandName} was not found in bundled resources, user-local tools, or PATH.", required);
    }

    private static string PlatformExecutable(string pathWithoutExtension) =>
        OperatingSystem.IsWindows() ? WindowsExecutable(pathWithoutExtension) : pathWithoutExtension;

    private static string WindowsExecutable(string pathWithoutExtension) =>
        pathWithoutExtension.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? pathWithoutExtension : $"{pathWithoutExtension}.exe";

    private static string? FindOnPath(string commandName)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path)) return null;

        string[] extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            : [""];
        IEnumerable<string> names = OperatingSystem.IsWindows() && !Path.HasExtension(commandName)
            ? extensions.Select(extension => commandName + extension)
            : [commandName];

        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            foreach (var name in names)
            {
                var candidate = Path.Combine(directory, name);
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
        }

        return null;
    }
}

public static class ToolReadinessChecks
{
    public static async Task<ReadinessCheck> CheckExecutableAsync(
        ToolResolution resolution,
        IReadOnlyList<string> args,
        string workingDirectory,
        CancellationToken cancellationToken,
        int timeoutMs = 5000)
    {
        if (!resolution.Available || string.IsNullOrWhiteSpace(resolution.ExecutablePath))
        {
            return new ReadinessCheck(resolution.Name, false, resolution.Detail, resolution.Required);
        }

        var result = await RelayProcess.RunAsync(
            resolution.ExecutablePath,
            args,
            workingDirectory,
            cancellationToken,
            timeoutMs: timeoutMs);
        return result.Success
            ? new ReadinessCheck(resolution.Name, true, resolution.Detail, resolution.Required)
            : new ReadinessCheck(resolution.Name, false, $"{resolution.Detail}; {result.Output}", resolution.Required);
    }

    public static async Task<ReadinessCheck> CheckOfficeCliAsync(
        ToolResolution resolution,
        string dataDirectory,
        CancellationToken cancellationToken)
    {
        if (!resolution.Available || string.IsNullOrWhiteSpace(resolution.ExecutablePath))
        {
            return new ReadinessCheck(resolution.Name, false, resolution.Detail, Required: false);
        }

        var version = await RelayProcess.RunAsync(
            resolution.ExecutablePath,
            ["--version"],
            AppContext.BaseDirectory,
            cancellationToken,
            timeoutMs: 8000);
        if (!version.Success)
        {
            return new ReadinessCheck(
                resolution.Name,
                false,
                $"OfficeCLI was found at {resolution.ExecutablePath}, but it is not runnable: {version.Output}",
                Required: false);
        }

        var smokeRoot = Path.Combine(dataDirectory, "officecli-smoke");
        Directory.CreateDirectory(smokeRoot);
        PruneOldSmokeWorkbooks(smokeRoot);

        ProcessResult last = new(false, "not run");
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            var smokePath = Path.Combine(smokeRoot, $"relay-officecli-smoke-{Guid.NewGuid():N}.xlsx");
            CreateMinimalWorkbook(smokePath);
            last = await RelayProcess.RunAsync(
                resolution.ExecutablePath,
                ["view", smokePath, "outline", "--json"],
                smokeRoot,
                cancellationToken,
                timeoutMs: 10000);
            TryDelete(smokePath);

            if (last.Success)
            {
                return new ReadinessCheck(
                    resolution.Name,
                    true,
                    $"OfficeCLI ready at {resolution.ExecutablePath}; view outline smoke passed.",
                    Required: false);
            }

            if (!IsSharingViolation(last.Output) || attempt == 3) break;
            await Task.Delay(250, cancellationToken);
        }

        return new ReadinessCheck(
            resolution.Name,
            false,
            $"OfficeCLI was found at {resolution.ExecutablePath}, but it is not ready: OfficeCLI view smoke test failed; {last.Output}",
            Required: false);
    }

    private static void CreateMinimalWorkbook(string path)
    {
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        AddText(archive, "[Content_Types].xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
              <Default Extension="xml" ContentType="application/xml"/>
              <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
              <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            </Types>
            """);
        AddText(archive, "_rels/.rels", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
            </Relationships>
            """);
        AddText(archive, "xl/workbook.xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
              <sheets>
                <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
              </sheets>
            </workbook>
            """);
        AddText(archive, "xl/_rels/workbook.xml.rels", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
            </Relationships>
            """);
        AddText(archive, "xl/worksheets/sheet1.xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <dimension ref="A1"/>
              <sheetData/>
            </worksheet>
            """);
    }

    private static void AddText(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = new StreamWriter(stream);
        writer.Write(content);
    }

    private static void PruneOldSmokeWorkbooks(string smokeRoot)
    {
        foreach (var file in Directory.EnumerateFiles(smokeRoot, "relay-officecli-smoke-*.xlsx"))
        {
            try
            {
                if (File.GetCreationTimeUtc(file) < DateTime.UtcNow.AddDays(-1)) File.Delete(file);
            }
            catch
            {
                // Best-effort cleanup must not block readiness.
            }
        }
    }

    private static bool IsSharingViolation(string output) =>
        output.Contains("being used by another process", StringComparison.OrdinalIgnoreCase)
        || output.Contains("別のプロセス", StringComparison.OrdinalIgnoreCase)
        || output.Contains("使用されている", StringComparison.OrdinalIgnoreCase);

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            // Best-effort cleanup must not block readiness.
        }
    }
}

public static class RelayProcess
{
    public static async Task<ProcessResult> RunAsync(
        string fileName,
        IReadOnlyList<string> args,
        string workingDirectory,
        CancellationToken cancellationToken,
        bool allowExitOne = false,
        int timeoutMs = 120000)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutMs);

        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);

        try
        {
            process.Start();
            var stdout = await process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = await process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var success = process.ExitCode == 0 || (allowExitOne && process.ExitCode == 1);
            return new ProcessResult(success, string.Join("\n", [stdout, stderr]).Trim());
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKill(process);
            return new ProcessResult(false, $"{fileName} timed out after {timeoutMs}ms.");
        }
        catch (Exception ex)
        {
            return new ProcessResult(false, ex.Message);
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best-effort cleanup.
        }
    }
}
