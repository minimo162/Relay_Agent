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
assert(fileExists("tools/codex-app-server/manifest.json"), "missing pinned Codex app-server artifact manifest");
assert(read("PLANS.md").includes("No transitional fallback architecture"), "PLANS.md must retain hard-cutover rule");
assert(read("PLANS.md").includes("bundled Codex app-server mediation path"), "PLANS.md must describe the bundled app-server architecture");
assert(read("README.md").includes("Codex app-server bridge"), "README.md must describe the Codex app-server bridge architecture");
assert(read("AGENTS.md").includes("Codex app-server bridge"), "AGENTS.md must describe the Codex app-server bridge architecture");
const workbenchSource = walk("apps/workbench/src")
  .filter((path) => /\.(ts|tsx|css)$/.test(path))
  .map((path) => read(path))
  .join("\n");
assert(workbenchSource.includes("Relay Bridge Workbench"), "default browser client must be the Relay Bridge Workbench");
assert(workbenchSource.includes("Codex app server"), "Workbench must describe the Codex app server bridge");
assert(workbenchSource.includes("/bridge/health"), "Workbench must use the bridge health endpoint");
assert(workbenchSource.includes("/bridge/sessions"), "Workbench must show the bridge session endpoint");
assert(workbenchSource.includes("/bridge/turns/"), "Workbench must show the bridge turn event endpoint");
assert(workbenchSource.includes("/v1/chat/completions"), "Workbench must identify /v1 as the low-level app-server provider API");
assert(!workbenchSource.includes("Relay API Hub"), "default browser client must not remain the Relay API Hub");
assert(!workbenchSource.includes("HTMLスターター"), "default browser client must not advertise starter HTML as the primary product");
assert(!workbenchSource.includes("Relay PDF Review"), "PDF review UI must not remain the default client");
assert(!workbenchSource.includes("/v1/pdf/"), "PDF review client routes must not remain in the default client");
assert(!workbenchSource.includes("CopilotChat"), "old CopilotKit Workbench must not remain the default client");
assert(!workbenchSource.includes("/agui/relay"), "default Workbench must not route through AG-UI while the bundled app-server bridge is active");
assert(!workbenchSource.includes("/v1/tools"), "default Bridge Workbench must not advertise Relay-owned local tools as a public HTML tool contract");
const sidecarProgram = read("apps/sidecar/Program.cs");
const sidecarSource = walk("apps/sidecar")
  .filter((path) => /\.(cs|csproj)$/.test(path))
  .map((path) => read(path))
  .join("\n");
assert(sidecarProgram.includes("CodexAppServerBridgeService"), "Sidecar must construct the Codex app-server bridge service");
assert(sidecarProgram.includes("/bridge/health"), "Sidecar must expose bridge health");
assert(sidecarProgram.includes("/bridge/sessions"), "Sidecar must expose bridge sessions");
assert(sidecarProgram.includes("/bridge/turns/{turnId}/events"), "Sidecar must expose bridge turn events");
assert(sidecarProgram.includes("/v1/models"), "Sidecar must expose the OpenAI-compatible models endpoint");
assert(sidecarProgram.includes("/v1/chat/completions"), "Sidecar must expose the Copilot provider endpoint");
assert(activeScriptText.includes("sidecar:app-server-bridge-smoke"), "pnpm check must include the app-server bridge smoke");
assert(activeScriptText.includes("sidecar:app-server-artifact-smoke"), "pnpm check must include the app-server artifact smoke");
assert(scripts["sidecar:publish:linux"]?.includes("appserver:fetch:linux"), "linux publish must fetch the pinned app server");
assert(scripts["sidecar:publish:windows"]?.includes("appserver:fetch:windows"), "windows publish must fetch the pinned app server");
assert(read("scripts/release/package-sidecar.mjs").includes("copyAppServerBundle"), "release package must copy the app-server bundle");
assert(read("scripts/release/collect-inventory.mjs").includes("tools/codex-app-server"), "release inventory must include the app-server artifact");
assert(!sidecarProgram.includes("/v1/pdf/"), "Sidecar must not expose retired PDF review endpoints");
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
