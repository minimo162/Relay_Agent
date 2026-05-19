#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

function gitTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    assert(false, `git ls-files failed: ${result.stderr || result.stdout}`);
    return [];
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

const rootPackage = JSON.parse(read("package.json"));
const scripts = rootPackage.scripts ?? {};
const activeScriptText = JSON.stringify(scripts, null, 2);
const trackedFiles = gitTrackedFiles();

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
assert(workbenchSource.includes("/v1/responses"), "Workbench must identify /v1/responses as the low-level app-server provider API");
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
assert(sidecarProgram.includes("/bridge/approvals/{approvalId}"), "Sidecar must expose bridge approval resolution");
assert(sidecarProgram.includes("/bridge/attachments"), "Sidecar must expose bridge attachment staging");
assert(sidecarProgram.includes("/v1/models"), "Sidecar must expose the OpenAI-compatible models endpoint");
assert(sidecarProgram.includes("/v1/chat/completions"), "Sidecar must expose the Copilot provider endpoint");
assert(sidecarProgram.includes("/v1/responses"), "Sidecar must expose the Responses provider facade required by the app server");
assert(!sidecarProgram.includes("/agui/relay"), "Sidecar must not expose the retired AG-UI Relay runner as a product route");
assert(!sidecarProgram.includes("/v1/tools"), "Sidecar must not expose the retired public Relay tool catalog");
assert(!sidecarProgram.includes("/api/tool-catalog"), "Sidecar must not expose the retired public Relay tool-catalog endpoint");
const bridgeSource = read("apps/sidecar/CodexAppServerBridge.cs");
assert(!bridgeSource.includes("RelayToolExecutor"), "Codex app-server bridge must not depend on Relay-owned tool executor");
assert(!bridgeSource.includes("RelayToolCall"), "Codex app-server bridge must not depend on Relay-owned tool-call records");
assert(!bridgeSource.includes("ToolObservation"), "Codex app-server bridge must not publish Relay-owned tool observations");
assert(bridgeSource.includes("item/commandExecution/requestApproval"), "bridge must forward app-server command approval requests");
assert(bridgeSource.includes("item/fileChange/requestApproval"), "bridge must forward app-server file-change approval requests");
assert(bridgeSource.includes("item/permissions/requestApproval"), "bridge must forward app-server permission approval requests");
assert(bridgeSource.includes("item/tool/call"), "bridge must explicitly reject custom dynamic tool calls");
assert(activeScriptText.includes("sidecar:app-server-bridge-smoke"), "pnpm check must include the app-server bridge smoke");
assert(activeScriptText.includes("sidecar:app-server-artifact-smoke"), "pnpm check must include the app-server artifact smoke");
assert(activeScriptText.includes("sidecar:app-server-real-provider-smoke"), "pnpm check must include the real app-server/provider compatibility smoke");
assert(!scripts.check.includes("agent:agui-client-tool-smoke"), "pnpm check must not use the retired AG-UI Relay runner smoke");
assert(!scripts.check.includes("agent:tool-catalog-smoke"), "pnpm check must not use the retired public Relay tool catalog smoke");
assert(!scripts.check.includes("agent:officecli-registry-smoke"), "pnpm check must not use the retired Relay-owned OfficeCLI smoke");
assert(!scripts.check.includes("agent:office-pdf-read-smoke"), "pnpm check must not use the retired Relay-owned Office/PDF extraction smoke");
assert(!activeScriptText.includes("agent:"), "root package scripts must not expose retired agent:* smoke aliases");
assert(activeScriptText.includes("workbench:bridge-surface-smoke"), "pnpm scripts must include the Bridge Workbench surface smoke");
assert(activeScriptText.includes("workbench:bridge-chat-smoke"), "pnpm scripts must include the Bridge Workbench chat smoke");
assert(scripts["sidecar:publish:linux"]?.includes("appserver:fetch:linux"), "linux publish must fetch the pinned app server");
assert(scripts["sidecar:publish:windows"]?.includes("appserver:fetch:windows"), "windows publish must fetch the pinned app server");
assert(!scripts["sidecar:publish:linux"]?.includes("tools:fetch"), "linux publish must not fetch retired Relay-side tool bundles");
assert(!scripts["sidecar:publish:windows"]?.includes("tools:fetch"), "windows publish must not fetch retired Relay-side tool bundles");
assert(read("scripts/release/package-sidecar.mjs").includes("copyAppServerBundle"), "release package must copy the app-server bundle");
assert(!read("scripts/release/package-sidecar.mjs").includes("relay-tools/officecli"), "release package must not bundle Relay-owned OfficeCLI");
assert(!read("scripts/release/package-sidecar.mjs").includes("officecli:"), "release package config must not advertise Relay-owned OfficeCLI");
assert(read("scripts/release/collect-inventory.mjs").includes("tools/codex-app-server"), "release inventory must include the app-server artifact");
assert(!read("scripts/release/collect-inventory.mjs").includes("tools/officecli"), "release inventory must not include retired OfficeCLI inputs");
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

for (const path of trackedFiles) {
  const lower = path.toLowerCase();
  assert(!path.startsWith("integrations/aionui/"), `tracked AionUi integration asset remains: ${path}`);
  assert(!path.startsWith("apps/desktop/"), `tracked Tauri desktop asset remains: ${path}`);
  assert(!path.startsWith("docs/archive/"), `tracked archived prompt asset remains: ${path}`);
  assert(path === "docs/IMPLEMENTATION.md" || !/^docs\/[^/]+\.md$/.test(path), `tracked root-level legacy doc remains: ${path}`);
  assert(!/relaydocumentsearch/i.test(path), `tracked RelayDocumentSearch asset remains: ${path}`);
  assert(!/workspace_document_search_sqlite_fts/i.test(path), `tracked SQLite/FTS document-search asset remains: ${path}`);
  assert(!/(office-pdf-read-smoke|officecli-registry-smoke|agui-client-tool-smoke|agui-replay-smoke|agent-golden-smoke|agent-tool-catalog-smoke|dci-.*smoke|rg-stream-cap-smoke|patch-conformance-smoke|protocol-state-smoke|provider-timeout-retry-smoke|framework-native-prevention-smoke|framework-trace-smoke)/.test(lower), `tracked retired smoke asset remains: ${path}`);
  assert(!/(openwork|aionui|src-tauri|tauri_webdriver|windows_openwork)/.test(lower), `tracked retired runtime/report asset remains: ${path}`);
}

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
