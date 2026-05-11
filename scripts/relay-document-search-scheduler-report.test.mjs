import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schedulerReportPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSchedulerReport.ts",
);

function transpile(path) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText),
    [],
  );
  return compiled.outputText;
}

async function loadSchedulerReportModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-scheduler-report-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchSchedulerReport.mjs"), transpile(schedulerReportPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchSchedulerReport.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("scheduler report exposes content budget backpressure", async () => {
  const { module, cleanup } = await loadSchedulerReportModule();
  try {
    const report = module.buildRelayDocumentSearchSchedulerReport({
      generatedAt: "2026-05-10T00:00:00.000Z",
      roots: ["C:/workspace"],
      jobId: "job-scheduler",
      scannedFiles: 5000,
      skippedFiles: 2,
      candidateCount: 100,
      resultCount: 50,
      maxScanFiles: 5000,
      maxContentInspectFiles: 10,
      contentScannedFiles: 10,
      contentSkippedFiles: 3,
      truncated: true,
      cancelled: false,
      timedOut: false,
      indexCoordinatorBusy: false,
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchSchedulerReport.v1");
    assert.equal(report.state, "throttled");
    assert.equal(report.queueDepth, 90);
    assert.equal(report.promotedFiles, 10);
    assert.deepEqual(report.reasons, ["scan_file_budget_reached", "content_inspection_budget_reached"]);
    assert.equal(report.throttledRoots.length, 1);
    assert.equal(report.roots[0].throttled, true);
  } finally {
    cleanup();
  }
});

test("scheduler report exposes busy writer and paused states", async () => {
  const { module, cleanup } = await loadSchedulerReportModule();
  try {
    const busy = module.buildRelayDocumentSearchSchedulerReport({
      generatedAt: "2026-05-10T00:00:00.000Z",
      roots: ["C:/workspace"],
      scannedFiles: 10,
      skippedFiles: 0,
      candidateCount: 1,
      resultCount: 1,
      maxScanFiles: 5000,
      maxContentInspectFiles: 500,
      contentScannedFiles: 0,
      contentSkippedFiles: 0,
      truncated: false,
      cancelled: false,
      timedOut: false,
      indexCoordinatorBusy: true,
      indexCoordinatorOwnerId: "other-job",
    });
    assert.equal(busy.state, "busy");
    assert.equal(busy.concurrency.indexWriterBusy, true);
    assert.equal(busy.concurrency.indexWriterOwnerId, "other-job");
    assert.deepEqual(busy.reasons, ["index_writer_busy"]);

    const paused = module.buildRelayDocumentSearchSchedulerReport({
      generatedAt: "2026-05-10T00:00:00.000Z",
      roots: ["C:/workspace"],
      paused: true,
      pauseReasons: ["network_share_throttled"],
      scannedFiles: 10,
      skippedFiles: 0,
      candidateCount: 1,
      resultCount: 1,
      maxScanFiles: 5000,
      maxContentInspectFiles: 500,
      contentScannedFiles: 0,
      contentSkippedFiles: 0,
      truncated: false,
      cancelled: false,
      timedOut: false,
      indexCoordinatorBusy: false,
    });
    assert.equal(paused.state, "paused");
    assert.deepEqual(paused.pauseReasons, ["network_share_throttled"]);
  } finally {
    cleanup();
  }
});
