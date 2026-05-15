#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[hard-cut-guard] ${message}`);
    process.exitCode = 1;
  }
}

function fileExists(path) {
  return existsSync(resolve(root, path)) && statSync(resolve(root, path)).isFile();
}

const rootPackage = JSON.parse(read("package.json"));
const scripts = rootPackage.scripts ?? {};
const activeScriptText = JSON.stringify(scripts, null, 2);

for (const forbidden of [
  "opencode",
  "openwork",
  "aionui",
  "tauri",
  "desktop-launch",
  "windows-smoke",
]) {
  assert(!activeScriptText.toLowerCase().includes(forbidden), `root package scripts still reference ${forbidden}`);
}

assert(fileExists("apps/sidecar/Relay.Sidecar.csproj"), "missing .NET sidecar project");
assert(fileExists("apps/workbench/package.json"), "missing browser workbench package");
assert(read("PLANS.md").includes("No transitional fallback architecture"), "PLANS.md must retain hard-cutover rule");
assert(read("README.md").includes("browser-hosted local web workbench"), "README.md must describe the sidecar workbench architecture");
assert(/browser-hosted local web\s+workbench/.test(read("AGENTS.md")), "AGENTS.md must describe the sidecar workbench architecture");

const ci = read(".github/workflows/ci.yml");
assert(ci.includes("pnpm check") && ci.includes("Set up .NET"), "CI must build the sidecar through the active acceptance gate");
assert(!ci.includes("tauri"), "CI must not run Tauri in the active hard-cut path");
assert(!ci.toLowerCase().includes("opencode"), "CI must not run OpenCode/OpenWork in the active hard-cut path");

const release = read(".github/workflows/release-windows-installer.yml");
assert(release.includes("dotnet publish apps/sidecar/Relay.Sidecar.csproj"), "release workflow must publish the sidecar");
assert(!release.includes("tauri build"), "release workflow must not build the Tauri installer");

if (process.exitCode) process.exit(process.exitCode);
console.log("[hard-cut-guard] ok");
