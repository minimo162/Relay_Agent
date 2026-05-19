#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
const styles = read("apps/workbench/src/styles.css");
const program = read("apps/sidecar/Program.cs");
const packageJson = JSON.parse(read("package.json"));

for (const needle of [
  "Relay Bridge Workbench",
  "Codex app server",
  "/bridge/health",
  "/bridge/sessions",
  "/bridge/turns/",
  "/v1/chat/completions",
  "Next runtime gate",
  "サポート情報を保存",
]) {
  assert(app.includes(needle), `bridge Workbench is missing: ${needle}`);
}

for (const forbidden of [
  "Relay API Hub",
  "HTMLスターター",
  "Relay PDF Review",
  "PDFを選択",
  "/v1/pdf/review",
  "sectionAlignments",
  "PdfReview",
  "CopilotChat",
  "useHumanInTheLoop",
  "資料を探す",
  "Officeファイルを編集する",
  "コードを書く",
  "/agui/relay",
  "/v1/tools",
]) {
  assert(!app.includes(forbidden), `bridge Workbench must not expose retired feature UI: ${forbidden}`);
}

for (const needle of [
  ".hero-card",
  ".quick-steps",
  ".console-grid",
  ".endpoint-list",
  ".code-sample",
  ".support",
]) {
  assert(styles.includes(needle), `Bridge Workbench styling is missing: ${needle}`);
}

for (const needle of [
  "CodexAppServerBridgeService",
  "/bridge/health",
  "/bridge/sessions",
  "/bridge/turns/{turnId}/events",
  "/v1/models",
  "/v1/chat/completions",
  "ApplyCorsHeaders",
]) {
  assert(program.includes(needle), `Sidecar bridge/provider route is missing: ${needle}`);
}

for (const forbidden of [
  "/v1/pdf/",
  "PdfReviewService",
  "RelayPdfReview",
]) {
  assert(!program.includes(forbidden), `Sidecar must not expose retired PDF review API: ${forbidden}`);
}

assert(packageJson.scripts["agent:api-tool-ux-smoke"], "missing API tool UX smoke script");
assert(packageJson.scripts.check.includes("pnpm agent:api-tool-ux-smoke"), "pnpm check must include API tool UX smoke");
assert(packageJson.scripts.check.includes("pnpm sidecar:app-server-bridge-smoke"), "pnpm check must include app-server bridge smoke");

console.log("[api-tool-ux-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
