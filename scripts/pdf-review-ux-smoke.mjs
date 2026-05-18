#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
for (const needle of [
  "PDFを選んで誤字確認",
  "2つのPDFを選んで比較",
  "/api/pdf/pick",
  "pickPdfForProofread",
  "pickPdfsForCompare",
  "insertPromptIntoComposer",
  "buildPdfProofreadPrompt",
  "buildPdfComparePrompt",
  "exact path で read",
  "OCRが必要",
]) {
  assert(app.includes(needle), `Workbench PDF starter is missing: ${needle}`);
}

const program = read("apps/sidecar/Program.cs");
for (const needle of ["/api/pdf/pick", "PdfPickRequest", "PdfPickResponse", "PickPdfAsync"]) {
  assert(program.includes(needle), `Sidecar PDF picker route is missing: ${needle}`);
}

const workspacePicker = read("apps/sidecar/WorkspacePicker.cs");
for (const needle of [
  "RELAY_PDF_PICKER_MOCK_PATH",
  "PickPdfAsync",
  "ShowNativeWindowsPdfDialog",
  "FosFileMustExist",
  "PDF files (*.pdf)",
  "--file-filter=PDF files | *.pdf",
]) {
  assert(workspacePicker.includes(needle), `Native PDF picker implementation is missing: ${needle}`);
}

const styles = read("apps/workbench/src/styles.css");
for (const needle of [".starter-row", ".starter-chip", ".starter-notice"]) {
  assert(styles.includes(needle), `Workbench starter styling is missing: ${needle}`);
}

const sidecarPrompt = [
  read("apps/sidecar/AgentRunner.cs"),
  read("apps/sidecar/RelayPromptBuilder.cs"),
  read("apps/sidecar/RelayCopilotChatClient.cs"),
].join("\n");
for (const needle of [
  "PDF proofreading",
  "two-PDF comparison",
  "text-layer",
  "OCR",
  "read every exact PDF",
]) {
  assert(sidecarPrompt.includes(needle), `PDF prompt guidance is missing: ${needle}`);
}

const packageScript = read("scripts/release/package-sidecar.mjs");
for (const needle of [
  "Relay Agent.html",
  "Relay Agent を起動.cmd",
  "portableFrontDoorHtml",
  "PDFを確認する",
  "PDFを選んで誤字確認",
  "2つのPDFを選んで比較",
  "画像だけのPDFやOCRが必要なページ",
]) {
  assert(packageScript.includes(needle), `Portable HTML front door is missing: ${needle}`);
}

for (const forbidden of ["RelayDocumentSearch", "pdf_review_runner", "document_search_mode"]) {
  assert(!app.includes(forbidden), `PDF UX must not revive dedicated mode: ${forbidden}`);
}

console.log("[pdf-review-ux-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
