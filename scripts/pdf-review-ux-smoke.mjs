#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const app = read("apps/workbench/src/App.tsx");
const styles = read("apps/workbench/src/styles.css");
const program = read("apps/sidecar/Program.cs");
const pdfService = read("apps/sidecar/PdfReviewService.cs");

for (const needle of [
  "Relay PDF Review",
  "PDFを選ぶだけで確認を開始できます",
  "誤字・表記",
  "文書内整合",
  "2つのPDF比較",
  "/v1/pdf/review",
  "/v1/pdf/jobs/",
  "type=\"file\"",
  "accept=\"application/pdf,.pdf\"",
  "レビューを開始",
  "サポート情報を保存",
]) {
  assert(app.includes(needle), `PDF HTML client is missing: ${needle}`);
}

for (const forbidden of [
  "CopilotChat",
  "useHumanInTheLoop",
  "作業フォルダ",
  "資料を探す",
  "Officeファイルを編集する",
  "コードを書く",
  "RelayDocumentSearch",
]) {
  assert(!app.includes(forbidden), `PDF HTML client must not expose old Workbench/chat mode: ${forbidden}`);
}

for (const needle of [
  ".hero-card",
  ".drop-zone",
  ".review-type-group",
  ".finding-card",
  ".support",
]) {
  assert(styles.includes(needle), `PDF HTML styling is missing: ${needle}`);
}

for (const needle of [
  "/v1/pdf/capabilities",
  "/v1/pdf/review",
  "/v1/pdf/review-paths",
  "/v1/pdf/jobs/{jobId}",
  "PdfReviewService",
  "RelayPdfReviewCapabilities.v1",
  "Text-layer PDF extraction is supported.",
]) {
  assert(program.includes(needle), `Sidecar PDF API route is missing: ${needle}`);
}

for (const needle of [
  "RelayPdfReviewJob.v1",
  "OCR is not included",
  "Page",
  "ReportMarkdown",
  "Finding",
]) {
  assert(pdfService.includes(needle), `PDF review service contract is missing: ${needle}`);
}

console.log("[pdf-review-ux-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
