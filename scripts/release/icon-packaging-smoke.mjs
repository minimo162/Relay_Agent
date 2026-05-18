#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const requiredAssets = [
  "assets/app-icon/relay-agent.ico",
  "assets/app-icon/relay-agent.svg",
  "assets/app-icon/relay-agent.png",
  "assets/app-icon/32x32.png",
  "assets/app-icon/128x128.png",
];

for (const asset of requiredAssets) {
  assert(existsSync(resolve(root, asset)), `missing active icon asset: ${asset}`);
}

const launcherProject = readFileSync(resolve(root, "apps/launcher/Relay.Launcher.csproj"), "utf8");
assert(
  launcherProject.includes("<ApplicationIcon>..\\..\\assets\\app-icon\\relay-agent.ico</ApplicationIcon>"),
  "launcher project must reference active app icon",
);
assert(launcherProject.includes("<OutputType>WinExe</OutputType>"), "launcher must use the Windows GUI subsystem to avoid a console window");

const packageScript = readFileSync(resolve(root, "scripts/release/package-sidecar.mjs"), "utf8");
assert(packageScript.includes("relay-assets"), "package-sidecar must copy relay-assets");
assert(packageScript.includes("relay-agent.ico"), "package-sidecar must copy relay-agent.ico");
assert(packageScript.includes("Relay Agent.exe"), "portable Windows package must expose Relay Agent.exe as the primary launcher");
assert(packageScript.includes("README-FIRST.html"), "portable package must include first-run help as README-FIRST.html");
assert(packageScript.includes("relay-agent"), "portable Linux package must expose relay-agent as the primary launcher");

const nsisScript = readFileSync(resolve(root, "scripts/release/build-windows-installer.mjs"), "utf8");
for (const needle of [
  "RequestExecutionLevel user",
  "Icon \"${icon}\"",
  "UninstallIcon \"${icon}\"",
  "!define MUI_ICON \"${icon}\"",
  "!define MUI_UNICON \"${icon}\"",
  "!define MUI_FINISHPAGE_RUN",
  "!define MUI_FINISHPAGE_RUN_FUNCTION LaunchRelayAgent",
  "relay-assets\\\\relay-agent.ico",
  "StopRunningRelayAgent",
  "Function LaunchRelayAgent",
  "ExecShell \"open\" \"$1\\\\Relay Agent.exe\"",
  "Get-Process -Name 'Relay.Sidecar','Relay.Launcher','Relay Agent'",
  "app-${version}-$0",
  "WriteRegStr HKCU \"Software\\\\Relay Agent\" \"AppDir\" \"$1\"",
  "$LOCALAPPDATA\\\\Programs\\\\Relay Agent",
  "$LOCALAPPDATA\\\\Programs\\\\RelayAgent",
  "Do not overwrite a running Relay.Sidecar.exe",
]) {
  assert(nsisScript.includes(needle), `NSIS generator is missing icon wiring: ${needle}`);
}

assert(!nsisScript.includes("RequestExecutionLevel admin"), "installer must not request admin execution level");
assert(!nsisScript.includes("HKLM"), "installer must not write machine-wide HKLM registry keys");
assert(nsisScript.includes('Section "Desktop shortcut" SecDesktop'), "desktop shortcut section must be selected by default");
assert(!nsisScript.includes('Section /o "Desktop shortcut" SecDesktop'), "desktop shortcut must not be opt-in only");

const preflightIndex = nsisScript.indexOf("Call StopRunningRelayAgent");
const fileCopyIndex = nsisScript.indexOf("File /r");
const versionedPayloadIndex = nsisScript.indexOf("app-${version}-$0");
assert(preflightIndex >= 0 && preflightIndex < fileCopyIndex, "process stop preflight must run before File /r");
assert(versionedPayloadIndex >= 0 && versionedPayloadIndex < fileCopyIndex, "versioned payload directory must be selected before File /r");
assert(
  !nsisScript.includes('Delete "$INSTDIR\\\\Relay.Sidecar.exe"'),
  "installer must not delete/overwrite a potentially running root Relay.Sidecar.exe before copy",
);

for (const packagedAsset of [
  "dist/relay-agent-win-x64/relay-assets/relay-agent.ico",
  "dist/relay-agent-linux-x64/relay-assets/relay-agent.ico",
]) {
  const path = resolve(root, packagedAsset);
  if (existsSync(resolve(root, packagedAsset.split("/").slice(0, -1).join("/")))) {
    assert(existsSync(path), `published package is missing icon asset: ${packagedAsset}`);
  }
}

console.log("[icon-packaging-smoke] ok");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
