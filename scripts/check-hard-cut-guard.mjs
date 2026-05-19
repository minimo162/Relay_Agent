#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

function walk(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) return [];
  const stat = statSync(full);
  if (stat.isFile()) return [path];
  return readdirSync(full).flatMap((entry) => walk(`${path}/${entry}`));
}

function assertNoForbidden(path, patterns) {
  if (!fileExists(path)) return;
  const text = read(path);
  for (const { pattern, label } of patterns) {
    assert(!pattern.test(text), `${path} still references ${label}`);
  }
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
assert(fileExists("apps/workbench/package.json"), "missing browser client package");
assert(read("PLANS.md").includes("No transitional fallback architecture"), "PLANS.md must retain hard-cutover rule");
assert(read("README.md").includes("PDF review HTML client"), "README.md must describe the PDF HTML client architecture");
assert(read("AGENTS.md").includes("PDF review HTML client"), "AGENTS.md must describe the PDF HTML client architecture");
const workbenchSource = walk("apps/workbench/src")
  .filter((path) => /\.(ts|tsx|css)$/.test(path))
  .map((path) => read(path))
  .join("\n");
assert(workbenchSource.includes("Relay PDF Review"), "default browser client must be the PDF review HTML client");
assert(workbenchSource.includes("/v1/pdf/review"), "PDF client must call the Relay Core PDF review API");
assert(!workbenchSource.includes("CopilotChat"), "generic CopilotKit Workbench must not remain the default client");
const sidecarProgram = read("apps/sidecar/Program.cs");
const sidecarSource = walk("apps/sidecar")
  .filter((path) => /\.(cs|csproj)$/.test(path))
  .map((path) => read(path))
  .join("\n");
assert(sidecarProgram.includes("/agui/relay"), "Sidecar must expose the official Agent Framework AG-UI endpoint");
assert(sidecarProgram.includes("/v1/pdf/review"), "Sidecar must expose the Relay Core PDF review endpoint");
assert(!sidecarProgram.includes("/api/" + "runs"), "Sidecar must not expose the legacy run REST product path");
assert(!sidecarSource.includes("Run" + "Manager"), "Sidecar must not retain the legacy RunManager runtime");
assert(!sidecarSource.includes("Run" + "Response"), "Sidecar must not retain the legacy RunResponse protocol");
assert(!sidecarSource.includes("Pending" + "Approval"), "Sidecar must not retain the legacy PendingApproval protocol");
assert(!sidecarSource.includes('"rg_files"'), "Sidecar model-facing catalog must not expose rg_files");
assert(!sidecarSource.includes('"rg_search"'), "Sidecar model-facing catalog must not expose rg_search");
assert(!sidecarSource.includes('"run_command"'), "Sidecar model-facing catalog must not expose run_command");
assert(!workbenchSource.includes("/agui-events"), "PDF client must not consume the old custom AG-UI run stream");
assert(!workbenchSource.includes("/api/runs"), "PDF client must not use the legacy run REST product path");
assert(!/\/events[`'"]/.test(workbenchSource), "PDF client must not consume the old custom run-event stream");
assert(!workbenchSource.includes("pendingApproval"), "PDF client must not revive RunResponse.pendingApproval");

const ci = read(".github/workflows/ci.yml");
assert(ci.includes("pnpm check") && ci.includes("Set up .NET"), "CI must build the sidecar through the active acceptance gate");
assert(!ci.includes("tauri"), "CI must not run Tauri in the active hard-cut path");
assert(!ci.toLowerCase().includes("opencode"), "CI must not run OpenCode/OpenWork in the active hard-cut path");

const release = read(".github/workflows/release-windows-installer.yml");
assert(
  release.includes("pnpm sidecar:publish:windows") && release.includes("pnpm sidecar:publish:linux"),
  "release workflow must publish the sidecar for Windows and Linux",
);
assert(release.includes("pnpm sidecar:installer:windows"), "release workflow must build the sidecar NSIS installer");
assert(release.includes("RequestExecutionLevel user"), "release workflow must verify user-scope NSIS policy");
assert(!release.includes("tauri build"), "release workflow must not build the Tauri installer");
assert(!release.includes("apps/desktop"), "release workflow must not package resources from apps/desktop");
assert(!release.toLowerCase().includes("aionui"), "release workflow must not package AionUi resources");
assert(!release.toLowerCase().includes("opencode"), "release workflow must not package OpenCode/OpenWork resources");

const activeSourceFiles = [
  ...walk("apps/sidecar").filter((path) => /\.(cs|csproj)$/.test(path)),
  ...walk("apps/workbench/src").filter((path) => /\.(ts|tsx|css)$/.test(path)),
  ...walk("scripts/release").filter((path) => /\.mjs$/.test(path)),
];
for (const path of activeSourceFiles) {
  assertNoForbidden(path, [
    { label: "Tauri active path", pattern: /src-tauri|tauri build/i },
    { label: "AionUi overlay active path", pattern: /apply-aionui|aionui-relay/i },
    { label: "RelayDocumentSearch active path", pattern: /RelayDocumentSearch|relay-document-search/ },
    { label: "apps/desktop active path", pattern: /apps\/desktop|apps\\desktop/ },
  ]);
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[hard-cut-guard] ok");
