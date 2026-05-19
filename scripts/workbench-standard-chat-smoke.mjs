#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
const packageJson = JSON.parse(read("package.json"));

for (const needle of [
  "Relay Bridge Workbench",
  "Codex app server",
  "/health",
  "/bridge/health",
  "/bridge/sessions",
  "/bridge/turns/",
  "/v1/chat/completions",
  "aria-live=\"polite\"",
  "role=\"alert\"",
  "<summary>診断</summary>",
]) {
  assert(app.includes(needle), `bridge workbench surface is missing: ${needle}`);
}

for (const forbidden of [
  "Relay API Hub",
  "HTMLスターター",
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
  "/agui/relay",
  "/v1/tools",
]) {
  assert(!app.includes(forbidden), `Bridge Workbench must not expose retired UI code: ${forbidden}`);
}

for (const scriptName of ["agent:workbench-standard-chat-smoke", "agent:api-tool-ux-smoke", "sidecar:app-server-bridge-smoke"]) {
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
