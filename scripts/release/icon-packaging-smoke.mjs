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

const packageScript = readFileSync(resolve(root, "scripts/release/package-sidecar.mjs"), "utf8");
assert(packageScript.includes("relay-assets"), "package-sidecar must copy relay-assets");
assert(packageScript.includes("relay-agent.ico"), "package-sidecar must copy relay-agent.ico");

const nsisScript = readFileSync(resolve(root, "scripts/release/build-windows-installer.mjs"), "utf8");
for (const needle of [
  "Icon \"${icon}\"",
  "UninstallIcon \"${icon}\"",
  "!define MUI_ICON \"${icon}\"",
  "!define MUI_UNICON \"${icon}\"",
  "relay-assets\\\\relay-agent.ico",
]) {
  assert(nsisScript.includes(needle), `NSIS generator is missing icon wiring: ${needle}`);
}

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
