import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const qualityPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQualityGates.ts",
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

async function loadQualityModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-quality-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchQualityGates.mjs"), transpile(qualityPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchQualityGates.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Relay document search quality gate allows final Copilot wording only for confirmed evidence", async () => {
  const { module, cleanup } = await loadQualityModule();
  try {
    const report = module.buildRelayDocumentSearchQualityReport({
      resultCount: 2,
      contentEvidenceCount: 2,
      contentRequired: true,
      contentRequiredButUnconfirmed: false,
      truncated: false,
      cancelled: false,
      timedOut: false,
      inaccessiblePathCount: 0,
      indexCoordinatorBusy: false,
      parsedDocumentCachePolicyDenied: false,
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchQuality.v1");
    assert.equal(report.coverageConfidence, "high");
    assert.equal(report.evidenceConfidence, "high");
    assert.equal(report.answerPolicy, "evidence_confirmed");
    assert.equal(report.canAskCopilotForFinalAnswer, true);
    assert.deepEqual(report.warnings, []);
  } finally {
    cleanup();
  }
});

test("Relay document search quality gate blocks final claims for candidate-only evidence requests", async () => {
  const { module, cleanup } = await loadQualityModule();
  try {
    const report = module.buildRelayDocumentSearchQualityReport({
      resultCount: 3,
      contentEvidenceCount: 0,
      contentRequired: true,
      contentRequiredButUnconfirmed: true,
      truncated: false,
      cancelled: false,
      timedOut: false,
      inaccessiblePathCount: 0,
      indexCoordinatorBusy: false,
      parsedDocumentCachePolicyDenied: false,
    });

    assert.equal(report.evidenceConfidence, "low");
    assert.equal(report.answerPolicy, "partial_or_incomplete");
    assert.equal(report.canAskCopilotForFinalAnswer, false);
    assert.deepEqual(
      report.warnings.map((warning) => warning.code),
      ["candidate_only", "content_unconfirmed"],
    );
    assert.equal(report.warnings[0].severity, "blocker");
  } finally {
    cleanup();
  }
});

test("Relay document search quality gate downgrades incomplete coverage and busy writers", async () => {
  const { module, cleanup } = await loadQualityModule();
  try {
    const report = module.buildRelayDocumentSearchQualityReport({
      resultCount: 1,
      contentEvidenceCount: 1,
      contentRequired: true,
      contentRequiredButUnconfirmed: false,
      truncated: true,
      cancelled: false,
      timedOut: false,
      inaccessiblePathCount: 0,
      indexCoordinatorBusy: true,
      parsedDocumentCachePolicyDenied: true,
    });

    assert.equal(report.coverageConfidence, "low");
    assert.equal(report.freshnessConfidence, "medium");
    assert.equal(report.answerPolicy, "partial_or_incomplete");
    assert.equal(report.canAskCopilotForFinalAnswer, false);
    assert.deepEqual(
      report.warnings.map((warning) => warning.code),
      ["coverage_incomplete", "index_writer_busy", "cache_policy_blocks_persistence"],
    );
  } finally {
    cleanup();
  }
});

test("Relay document search quality gate blocks promotion on golden-query regression", async () => {
  const { module, cleanup } = await loadQualityModule();
  try {
    const report = module.buildRelayDocumentSearchQualityReport({
      resultCount: 2,
      contentEvidenceCount: 2,
      contentRequired: true,
      contentRequiredButUnconfirmed: false,
      truncated: false,
      cancelled: false,
      timedOut: false,
      inaccessiblePathCount: 0,
      indexCoordinatorBusy: false,
      parsedDocumentCachePolicyDenied: false,
      goldenQueryGate: {
        enabled: true,
        passed: false,
        caseCount: 6,
        failedCaseCount: 1,
        topKCoverage: 0.83,
      },
    });

    assert.equal(report.coverageConfidence, "high");
    assert.equal(report.evidenceConfidence, "high");
    assert.equal(report.answerPolicy, "partial_or_incomplete");
    assert.equal(report.canAskCopilotForFinalAnswer, false);
    assert.deepEqual(report.goldenQueryGate, {
      enabled: true,
      passed: false,
      caseCount: 6,
      failedCaseCount: 1,
      topKCoverage: 0.83,
    });
    assert.deepEqual(
      report.warnings.map((warning) => warning.code),
      ["golden_query_regression"],
    );
    assert.equal(report.warnings[0].severity, "blocker");
  } finally {
    cleanup();
  }
});
