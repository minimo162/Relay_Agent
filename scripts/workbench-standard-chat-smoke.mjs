#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
const styles = read("apps/workbench/src/styles.css");
const packageJson = JSON.parse(read("package.json"));
const catalog = JSON.parse(read("scripts/fixtures/agent-tool-catalog-snapshot.json"));

for (const needle of [
  "CopilotChat",
  "useDefaultRenderTool",
  "useHumanInTheLoop",
  "普通のチャットと同じように依頼してください",
  "メッセージを入力",
  "チャットを始める",
  "作業フォルダを選ぶ",
  "変更は確認して実行",
  "role=\"alert\"",
  "aria-live=\"polite\"",
  "tool-card-heading",
  "<summary>診断</summary>",
]) {
  assert(app.includes(needle), `standard chatbot Workbench is missing: ${needle}`);
}

for (const needle of [
  ".onboarding-card",
  ".onboarding-steps",
  ".tool-card-heading",
  ".chat-card",
  ".workspace-bar",
]) {
  assert(styles.includes(needle), `standard chatbot styling is missing: ${needle}`);
}

for (const forbidden of [
  "資料を探す",
  "Officeファイルを編集する",
  "コードを書く",
  "Document search",
  "Office file",
  "RelayDocumentSearch",
  "document_search_mode",
]) {
  assert(!app.includes(forbidden), `Workbench must not expose old mode or dedicated search text: ${forbidden}`);
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

for (const scriptName of ["agent:tool-catalog-smoke", "agent:workbench-standard-chat-smoke"]) {
  assert(packageJson.scripts[scriptName], `missing package script: ${scriptName}`);
}

assert(
  packageJson.scripts.check.includes("pnpm agent:workbench-standard-chat-smoke"),
  "pnpm check must include the Workbench standard chat smoke",
);

console.log("[workbench-standard-chat-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
