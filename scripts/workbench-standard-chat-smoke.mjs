#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
const packageJson = JSON.parse(read("package.json"));
const catalog = JSON.parse(read("scripts/fixtures/agent-tool-catalog-snapshot.json"));

for (const needle of [
  "Relay API Hub",
  "/health",
  "/v1/relay/manifest",
  "/v1/chat/completions",
  "/agui/relay",
  "aria-live=\"polite\"",
  "role=\"alert\"",
  "<summary>診断</summary>",
]) {
  assert(app.includes(needle), `PDF client surface is missing: ${needle}`);
}

for (const forbidden of [
  "CopilotChat",
  "CopilotKitProvider",
  "useDefaultRenderTool",
  "useHumanInTheLoop",
  "Document search",
  "Office file",
  "RelayDocumentSearch",
  "document_search_mode",
  "Relay PDF Review",
  "/v1/pdf/review",
]) {
  assert(!app.includes(forbidden), `Default PDF client must not expose generic chat/workbench code: ${forbidden}`);
}

const expectedTools = [
  "glob",
  "grep",
  "read",
  "officecli",
  "workspace_status",
  "diff",
  "ask_user",
  "officecli_mutate",
  "edit",
  "write",
  "apply_patch",
  "bash",
];
const actualTools = catalog.tools.map((tool) => tool.name);
assert(
  JSON.stringify(actualTools) === JSON.stringify(expectedTools),
  `model-visible tool catalog drifted: ${JSON.stringify(actualTools)}`,
);

for (const scriptName of ["agent:tool-catalog-smoke", "agent:workbench-standard-chat-smoke", "agent:api-tool-ux-smoke"]) {
  assert(packageJson.scripts[scriptName], `missing package script: ${scriptName}`);
}

assert(
  packageJson.scripts.check.includes("pnpm agent:workbench-standard-chat-smoke"),
  "pnpm check must include the default client smoke",
);

console.log("[workbench-standard-chat-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
