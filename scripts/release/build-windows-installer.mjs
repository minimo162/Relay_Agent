#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const rid = readArg("--rid") ?? "win-x64";
if (rid !== "win-x64") throw new Error(`NSIS installer is only defined for win-x64, got ${rid}`);

const packageDir = resolve(root, "dist", "relay-agent-win-x64");
if (!existsSync(packageDir)) {
  throw new Error(`package directory does not exist. Run pnpm sidecar:publish:windows first: ${packageDir}`);
}

const version = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8")).version;
const installerDir = resolve(root, "dist", "installer");
const installerPath = resolve(installerDir, `Relay.Agent-${version}-win-x64-setup.exe`);
const scriptPath = resolve(installerDir, "relay-agent-win-x64.nsi");
const iconPath = resolve(packageDir, "app", "relay-assets", "relay-agent.ico");
if (!existsSync(iconPath)) {
  throw new Error(`installer icon is missing from package. Run pnpm sidecar:publish:windows first: ${iconPath}`);
}
mkdirSync(installerDir, { recursive: true });

writeFileSync(scriptPath, buildNsisScript({ version, packageDir, installerPath, iconPath }));

const makensis = resolveMakensis();
const result = spawnSync(makensis, [scriptPath], { cwd: root, stdio: "inherit" });
if (result.status !== 0) {
  const suffix = result.error ? ` (${result.error.message})` : "";
  throw new Error(`${makensis} ${scriptPath} failed with ${result.status}${suffix}. Install NSIS or set MAKENSIS.`);
}

console.log(`build-windows-installer: wrote ${relativePath(installerPath)}`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function buildNsisScript({ version, packageDir, installerPath, iconPath }) {
  const source = nsisPath(packageDir);
  const outFile = nsisPath(installerPath);
  const icon = nsisPath(iconPath);
  return `
Unicode true
RequestExecutionLevel user
Name "Relay Agent"
OutFile "${outFile}"
Icon "${icon}"
UninstallIcon "${icon}"
InstallDir "$LOCALAPPDATA\\Programs\\Relay Agent"
InstallDirRegKey HKCU "Software\\Relay Agent" "InstallDir"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "${icon}"
!define MUI_UNICON "${icon}"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch Relay Agent"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchRelayAgent
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "Relay Agent"
VIAddVersionKey "CompanyName" "Relay"
VIAddVersionKey "LegalCopyright" "Relay Agent contributors"
VIAddVersionKey "FileDescription" "Relay Agent sidecar Workbench installer"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "ProductVersion" "${version}"

Section "Relay Agent" SecMain
  SectionIn RO
  SetShellVarContext current
  Call StopRunningRelayAgent
  CreateDirectory "$INSTDIR"
  ; Do not overwrite a running Relay.Sidecar.exe. The browser Workbench sidecar
  ; can remain alive after the launcher exits, so upgrades copy into a fresh
  ; versioned payload directory and then repoint shortcuts/registry metadata.
  System::Call 'kernel32::GetTickCount() i .r0'
  StrCpy $1 "$INSTDIR\\app-${version}-$0"
  CreateDirectory "$1"
  SetOutPath "$1"
  File /r "${source}\\*.*"
  CreateDirectory "$SMPROGRAMS\\Relay Agent"
  CreateShortcut "$SMPROGRAMS\\Relay Agent\\Relay Agent.lnk" "$1\\Relay Agent.exe" "" "$1\\app\\relay-assets\\relay-agent.ico"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Relay Agent" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Relay Agent" "AppDir" "$1"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayName" "Relay Agent"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "Publisher" "Relay"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayIcon" "$1\\app\\relay-assets\\relay-agent.ico"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" SecDesktop
  SetShellVarContext current
  ReadRegStr $1 HKCU "Software\\Relay Agent" "AppDir"
  \${If} $1 == ""
    StrCpy $1 "$INSTDIR"
  \${EndIf}
  CreateShortcut "$DESKTOP\\Relay Agent.lnk" "$1\\Relay Agent.exe" "" "$1\\app\\relay-assets\\relay-agent.ico"
SectionEnd

Function LaunchRelayAgent
  SetShellVarContext current
  ReadRegStr $1 HKCU "Software\\Relay Agent" "AppDir"
  \${If} $1 == ""
    StrCpy $1 "$INSTDIR"
  \${EndIf}
  ExecShell "open" "$1\\Relay Agent.exe"
FunctionEnd

Function StopRunningRelayAgent
  DetailPrint "Stopping any running Relay Agent processes from this user install..."
  ; Check both the canonical install root and the legacy no-space root so
  ; upgrades from older user-scope installers can retire old sidecars when
  ; possible. This is best-effort because the package copy no longer overwrites
  ; the running executable.
  nsExec::ExecToStack \`"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference = 'SilentlyContinue'; $$roots = @('$INSTDIR', '$LOCALAPPDATA\\Programs\\Relay Agent', '$LOCALAPPDATA\\Programs\\RelayAgent') | Where-Object { $$_ }; Get-Process -Name 'Relay.Sidecar','Relay.Launcher','Relay Agent' -ErrorAction SilentlyContinue | Where-Object { $$processPath = $$_.Path; $$processPath -and ($$roots | Where-Object { $$processPath.StartsWith($$_, [System.StringComparison]::OrdinalIgnoreCase) }) } | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; exit 0 }"\`
  Pop $0
  Pop $1
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Call un.StopRunningRelayAgent
  Delete "$DESKTOP\\Relay Agent.lnk"
  Delete "$SMPROGRAMS\\Relay Agent\\Relay Agent.lnk"
  RMDir "$SMPROGRAMS\\Relay Agent"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent"
  DeleteRegKey HKCU "Software\\Relay Agent"
  RMDir /r "$INSTDIR"
SectionEnd

Function un.StopRunningRelayAgent
  DetailPrint "Stopping any running Relay Agent processes from this user install..."
  nsExec::ExecToStack \`"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference = 'SilentlyContinue'; $$roots = @('$INSTDIR', '$LOCALAPPDATA\\Programs\\Relay Agent', '$LOCALAPPDATA\\Programs\\RelayAgent') | Where-Object { $$_ }; Get-Process -Name 'Relay.Sidecar','Relay.Launcher','Relay Agent' -ErrorAction SilentlyContinue | Where-Object { $$processPath = $$_.Path; $$processPath -and ($$roots | Where-Object { $$processPath.StartsWith($$_, [System.StringComparison]::OrdinalIgnoreCase) }) } | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; exit 0 }"\`
  Pop $0
  Pop $1
FunctionEnd
`.trimStart();
}

function resolveMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files (x86)\\NSIS\\makensis.exe",
      "C:\\Program Files\\NSIS\\makensis.exe",
      "C:\\ProgramData\\chocolatey\\bin\\makensis.exe",
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  return "makensis";
}

function nsisPath(path) {
  return path.replaceAll("\\", "\\\\");
}

function relativePath(path) {
  return path.replace(`${root}${process.platform === "win32" ? "\\" : "/"}`, "");
}
