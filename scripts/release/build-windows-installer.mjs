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
const iconPath = resolve(packageDir, "relay-assets", "relay-agent.ico");
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
!define MUI_ABORTWARNING
!define MUI_ICON "${icon}"
!define MUI_UNICON "${icon}"
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
  SetOutPath "$INSTDIR"
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${source}\\*.*"
  CreateDirectory "$SMPROGRAMS\\Relay Agent"
  CreateShortcut "$SMPROGRAMS\\Relay Agent\\Relay Agent.lnk" "$INSTDIR\\Relay.Launcher.exe" "" "$INSTDIR\\relay-assets\\relay-agent.ico"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Relay Agent" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayName" "Relay Agent"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "Publisher" "Relay"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "DisplayIcon" "$INSTDIR\\relay-assets\\relay-agent.ico"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent" "NoRepair" 1
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  SetShellVarContext current
  CreateShortcut "$DESKTOP\\Relay Agent.lnk" "$INSTDIR\\Relay.Launcher.exe" "" "$INSTDIR\\relay-assets\\relay-agent.ico"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\\Relay Agent.lnk"
  Delete "$SMPROGRAMS\\Relay Agent\\Relay Agent.lnk"
  RMDir "$SMPROGRAMS\\Relay Agent"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Relay Agent"
  DeleteRegKey HKCU "Software\\Relay Agent"
  RMDir /r "$INSTDIR"
SectionEnd
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
