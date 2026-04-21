#!/usr/bin/env node
/**
 * Windows dev helper: `tauri-build` copies externalBin sidecars into
 * target/debug before the app starts. If a previous dev run left one of those
 * sidecars alive, Windows keeps target/debug/relay-node.exe or relay-rg.exe
 * locked and the next `tauri dev` fails with PermissionDenied.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(desktopRoot, "../..");

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function unique(values) {
  return [...new Set(values)];
}

export function cleanupTauriDebugSidecars() {
  if (process.platform !== "win32") {
    return;
  }

  const targetRoots = [path.join(repoRoot, "target")];
  if (process.env.CARGO_TARGET_DIR?.trim()) {
    targetRoots.push(path.resolve(process.env.CARGO_TARGET_DIR.trim()));
  }

  const targetExecutables = unique(
    targetRoots.flatMap((targetRoot) => [
      path.join(targetRoot, "debug", "relay-node.exe"),
      path.join(targetRoot, "debug", "relay-rg.exe"),
    ]),
  );

  if (!targetExecutables.some((file) => existsSync(file))) {
    return;
  }

  const targets = targetExecutables.map(psString).join(", ");
  const script = `
$targets = @(${targets}) | ForEach-Object {
  [System.IO.Path]::GetFullPath($_).ToLowerInvariant()
}
$processes = Get-CimInstance Win32_Process -Filter "Name = 'relay-node.exe' OR Name = 'relay-rg.exe'" -ErrorAction SilentlyContinue
$killed = 0
foreach ($p in $processes) {
  if ([string]::IsNullOrWhiteSpace($p.ExecutablePath)) {
    continue
  }
  $exe = [System.IO.Path]::GetFullPath($p.ExecutablePath).ToLowerInvariant()
  if ($targets -notcontains $exe) {
    continue
  }
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $p.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    $killed += 1
  } catch {
    Write-Warning ("failed to stop {0} pid={1}: {2}" -f $p.ExecutablePath, $p.ProcessId, $_.Exception.Message)
  }
}
if ($killed -gt 0) {
  Write-Output ("[cleanup-tauri-debug-sidecars] stopped {0} stale sidecar process(es)" -f $killed)
}
`;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );

  if (result.stdout?.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr?.trim()) {
    console.warn(result.stderr.trim());
  }
  if (result.error) {
    console.warn(
      `[cleanup-tauri-debug-sidecars] could not run PowerShell cleanup: ${result.error.message}`,
    );
  } else if (result.status !== 0) {
    console.warn(
      `[cleanup-tauri-debug-sidecars] PowerShell cleanup exited with ${result.status}; continuing tauri dev`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanupTauriDebugSidecars();
}
