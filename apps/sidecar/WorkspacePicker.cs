using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

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

    [SupportedOSPlatform("windows")]
    private static async Task<WorkspacePickResponse> PickWindowsAsync(string? currentPath, CancellationToken cancellationToken)
    {
        var native = await TryPickWindowsNativeAsync(currentPath, cancellationToken);
        if (native is not null)
        {
            return native;
        }

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
if ($dialog.PSObject.Properties.Name -contains 'AutoUpgradeEnabled') {
  $dialog.AutoUpgradeEnabled = $true
}
$dialog.RootFolder = [System.Environment+SpecialFolder]::Desktop
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

    [SupportedOSPlatform("windows")]
    private static async Task<WorkspacePickResponse?> TryPickWindowsNativeAsync(string? currentPath, CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource<WorkspacePickResponse?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                tcs.TrySetResult(ShowNativeWindowsFolderDialog(currentPath));
            }
            catch (COMException ex) when (IsDialogUnavailable(ex))
            {
                tcs.TrySetResult(null);
            }
            catch (PlatformNotSupportedException)
            {
                tcs.TrySetResult(null);
            }
            catch (Exception ex)
            {
                tcs.TrySetResult(new WorkspacePickResponse(false, null, false, null, ex.Message));
            }
        })
        {
            IsBackground = true,
            Name = "Relay workspace folder picker",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        try
        {
            return await tcs.Task.WaitAsync(ReadPickerTimeout(), cancellationToken);
        }
        catch (TimeoutException)
        {
            return new WorkspacePickResponse(false, null, false, null, "Folder picker timed out.");
        }
    }

    [SupportedOSPlatform("windows")]
    private static WorkspacePickResponse ShowNativeWindowsFolderDialog(string? currentPath)
    {
        var type = Type.GetTypeFromCLSID(FileOpenDialogClsid, throwOnError: false);
        if (type is null) throw new PlatformNotSupportedException("Windows FileOpenDialog is not available.");
        var instance = Activator.CreateInstance(type) ?? throw new PlatformNotSupportedException("Windows FileOpenDialog could not be created.");
        var dialog = (IFileOpenDialog)instance;

        dialog.GetOptions(out var options);
        dialog.SetOptions(
            options |
            FileOpenOptions.FosPickFolders |
            FileOpenOptions.FosForceFileSystem |
            FileOpenOptions.FosPathMustExist |
            FileOpenOptions.FosNoChangeDir);
        dialog.SetTitle("Select Relay workspace");
        dialog.SetOkButtonLabel("Select folder");

        if (!string.IsNullOrWhiteSpace(currentPath) && Directory.Exists(currentPath))
        {
            try
            {
                var shellItemId = typeof(IShellItem).GUID;
                SHCreateItemFromParsingName(Path.GetFullPath(currentPath), IntPtr.Zero, ref shellItemId, out var folder);
                dialog.SetFolder(folder);
            }
            catch
            {
                // Initial-folder setup is best effort. The picker remains usable
                // through Desktop/This PC/network locations if this path is gone.
            }
        }

        var hr = dialog.Show(IntPtr.Zero);
        if (hr == HResultCancelled)
        {
            return new WorkspacePickResponse(true, null, false, null);
        }
        if (hr < 0)
        {
            Marshal.ThrowExceptionForHR(hr);
        }

        dialog.GetResult(out var item);
        item.GetDisplayName(ShellItemDisplayName.FileSystemPath, out var selectedPathPointer);
        try
        {
            var selectedPath = Marshal.PtrToStringUni(selectedPathPointer);
            if (string.IsNullOrWhiteSpace(selectedPath))
            {
                return new WorkspacePickResponse(false, null, false, null, "Folder picker did not return a filesystem path.");
            }
            return NormalizeResult(selectedPath);
        }
        finally
        {
            if (selectedPathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(selectedPathPointer);
        }
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

    private static bool IsDialogUnavailable(COMException ex) =>
        ex.HResult is unchecked((int)0x80040154) or unchecked((int)0x80004002);

    private static readonly Guid FileOpenDialogClsid = new("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
    private const int HResultCancelled = unchecked((int)0x800704C7);

    [Flags]
    private enum FileOpenOptions : uint
    {
        FosNoChangeDir = 0x00000008,
        FosPickFolders = 0x00000020,
        FosForceFileSystem = 0x00000040,
        FosPathMustExist = 0x00000800,
    }

    private enum ShellItemDisplayName : uint
    {
        FileSystemPath = 0x80058000,
    }

    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig]
        int Show(IntPtr parent);
        void SetFileTypes(uint fileTypesCount, IntPtr fileTypes);
        void SetFileTypeIndex(uint fileTypeIndex);
        void GetFileTypeIndex(out uint fileTypeIndex);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileOpenOptions options);
        void GetOptions(out FileOpenOptions options);
        void SetDefaultFolder(IShellItem shellItem);
        void SetFolder(IShellItem shellItem);
        void GetFolder(out IShellItem shellItem);
        void GetCurrentSelection(out IShellItem shellItem);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem shellItem);
        void AddPlace(IShellItem shellItem, int fileDialogAddPlace);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string defaultExtension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport]
    [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog : IFileDialog
    {
        void GetResults(out IntPtr shellItemArray);
        void GetSelectedItems(out IntPtr shellItemArray);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr output);
        void GetParent(out IShellItem shellItem);
        void GetDisplayName(ShellItemDisplayName displayName, out IntPtr name);
        void GetAttributes(uint attributeMask, out uint attributes);
        void Compare(IShellItem shellItem, uint hint, out int order);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    [SupportedOSPlatform("windows")]
    private static extern void SHCreateItemFromParsingName(
        string path,
        IntPtr bindContext,
        ref Guid interfaceId,
        out IShellItem shellItem);
}
