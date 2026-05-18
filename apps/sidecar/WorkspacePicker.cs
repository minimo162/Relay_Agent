using System.Diagnostics;

public static class WorkspacePicker
{
    public static async Task<WorkspacePickResponse> PickAsync(string? currentPath, CancellationToken cancellationToken)
    {
        var mock = Environment.GetEnvironmentVariable("RELAY_WORKSPACE_PICKER_MOCK_PATH");
        if (!string.IsNullOrWhiteSpace(mock))
        {
            if (string.Equals(mock, "__CANCEL__", StringComparison.OrdinalIgnoreCase))
            {
                return new WorkspacePickResponse(true, null, false, null);
            }
            if (string.Equals(mock, "__ERROR__", StringComparison.OrdinalIgnoreCase))
            {
                return new WorkspacePickResponse(false, null, false, null, "Mock workspace picker failure.");
            }
            return NormalizeResult(mock);
        }

        if (OperatingSystem.IsWindows())
        {
            return await PickWindowsAsync(currentPath, cancellationToken);
        }

        if (OperatingSystem.IsLinux())
        {
            return await PickLinuxAsync(currentPath, cancellationToken);
        }

        return new WorkspacePickResponse(false, null, false, null, "Workspace picker is not supported on this platform.");
    }

    private static async Task<WorkspacePickResponse> PickWindowsAsync(string? currentPath, CancellationToken cancellationToken)
    {
        var shell = ResolveCommand("powershell.exe") ?? ResolveCommand("pwsh");
        if (shell is null)
        {
            return new WorkspacePickResponse(false, null, false, null, "PowerShell was not found, so the folder picker cannot be opened.");
        }

        const string script = """
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Relay workspace'
$dialog.ShowNewFolderButton = $false
if ($env:RELAY_WORKSPACE_PICKER_DEFAULT -and (Test-Path -LiteralPath $env:RELAY_WORKSPACE_PICKER_DEFAULT)) {
  $dialog.SelectedPath = $env:RELAY_WORKSPACE_PICKER_DEFAULT
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.WindowState = 'Minimized'
try {
  $result = $dialog.ShowDialog($owner)
} finally {
  $owner.Dispose()
}
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  Write-Output $dialog.SelectedPath
  exit 0
}
exit 2
""";

        var args = new List<string>();
        if (string.Equals(Path.GetFileName(shell), "powershell.exe", StringComparison.OrdinalIgnoreCase))
        {
            args.Add("-STA");
        }
        args.AddRange(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);

        var result = await RunPickerProcessAsync(
            shell,
            args,
            currentPath,
            cancellationToken);
        return ResultFromProcess(result, cancelExitCode: 2);
    }

    private static async Task<WorkspacePickResponse> PickLinuxAsync(string? currentPath, CancellationToken cancellationToken)
    {
        if (ResolveCommand("zenity") is { } zenity)
        {
            var args = new List<string>
            {
                "--file-selection",
                "--directory",
                "--title=Select Relay workspace",
            };
            if (!string.IsNullOrWhiteSpace(currentPath) && Directory.Exists(currentPath))
            {
                args.Add($"--filename={Path.GetFullPath(currentPath).TrimEnd(Path.DirectorySeparatorChar)}/");
            }
            return ResultFromProcess(await RunPickerProcessAsync(zenity, args, currentPath, cancellationToken), cancelExitCode: 1);
        }

        if (ResolveCommand("kdialog") is { } kdialog)
        {
            var initial = !string.IsNullOrWhiteSpace(currentPath) && Directory.Exists(currentPath)
                ? Path.GetFullPath(currentPath)
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return ResultFromProcess(
                await RunPickerProcessAsync(kdialog, ["--getexistingdirectory", initial], currentPath, cancellationToken),
                cancelExitCode: 1);
        }

        return new WorkspacePickResponse(false, null, false, null, "No graphical folder picker was found. Install zenity or kdialog, or set the workspace through a supported launcher path.");
    }

    private static WorkspacePickResponse ResultFromProcess(PickerProcessResult process, int cancelExitCode)
    {
        if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(process.Output))
        {
            return NormalizeResult(process.Output.Trim());
        }
        if (process.ExitCode == cancelExitCode)
        {
            return new WorkspacePickResponse(true, null, false, null);
        }
        return new WorkspacePickResponse(false, null, false, null, process.Error.Trim().Length > 0 ? process.Error.Trim() : "Folder picker did not return a workspace.");
    }

    private static WorkspacePickResponse NormalizeResult(string path)
    {
        var expanded = Environment.ExpandEnvironmentVariables(path);
        var fullPath = Path.GetFullPath(expanded);
        return new WorkspacePickResponse(false, fullPath, Directory.Exists(fullPath), fullPath);
    }

    private static async Task<PickerProcessResult> RunPickerProcessAsync(
        string fileName,
        IReadOnlyList<string> args,
        string? currentPath,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(ReadPickerTimeout());
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        if (!string.IsNullOrWhiteSpace(currentPath))
        {
            process.StartInfo.Environment["RELAY_WORKSPACE_PICKER_DEFAULT"] = currentPath;
        }
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);

        try
        {
            process.Start();
            var stdout = await process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = await process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            return new PickerProcessResult(process.ExitCode, stdout, stderr);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKill(process);
            return new PickerProcessResult(-1, "", "Folder picker timed out.");
        }
        catch (Exception ex)
        {
            return new PickerProcessResult(-1, "", ex.Message);
        }
    }

    private static string? ResolveCommand(string name)
    {
        if (Path.IsPathRooted(name) && File.Exists(name)) return name;
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path)) return null;
        var names = OperatingSystem.IsWindows() && !Path.HasExtension(name)
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(extension => name + extension)
            : [name];
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            foreach (var candidateName in names)
            {
                var candidate = Path.Combine(directory, candidateName);
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
        }
        return null;
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

    private static TimeSpan ReadPickerTimeout()
    {
        if (int.TryParse(Environment.GetEnvironmentVariable("RELAY_WORKSPACE_PICKER_TIMEOUT_MS"), out var milliseconds))
        {
            return TimeSpan.FromMilliseconds(Math.Clamp(milliseconds, 10_000, 300_000));
        }
        return TimeSpan.FromMinutes(2);
    }

    private sealed record PickerProcessResult(int ExitCode, string Output, string Error);
}
