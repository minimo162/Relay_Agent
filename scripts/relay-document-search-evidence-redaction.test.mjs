import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const redactionPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidenceRedaction.ts",
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

async function loadRedactionModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-redaction-module-"));
  writeFileSync(
    resolve(dir, "relayDocumentSearchEvidenceRedaction.mjs"),
    transpile(redactionPath).replace(
      "from './relayDocumentSearchQualityGates';",
      "from './relayDocumentSearchQualityGates.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchEvidenceRedaction.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function quality(canAskCopilotForFinalAnswer = true) {
  return {
    schemaVersion: "RelayDocumentSearchQuality.v1",
    coverageConfidence: "high",
    evidenceConfidence: "high",
    freshnessConfidence: "high",
    answerPolicy: canAskCopilotForFinalAnswer ? "evidence_confirmed" : "partial_or_incomplete",
    canAskCopilotForFinalAnswer,
    warnings: [],
  };
}

const evidence = [
  {
    file_id: "file-1",
    path: "H:/secret/share/source.xlsx",
    display_path: "160連結/source.xlsx",
    evidence_state: "content_confirmed",
    parsed_document_uid: "parsed-1",
    anchor: {
      type: "cell_excerpt",
      sheet_name: "CFS",
      cell_address: "A1",
      row: 1,
      column: 1,
      snippet: "キャッシュフロー計算書の根拠",
      matchedTerms: ["キャッシュフロー"],
    },
  },
];

test("Relay evidence redaction keeps evidence local by default", async () => {
  const { module, cleanup } = await loadRedactionModule();
  try {
    const report = module.buildRelayDocumentSearchEvidenceRedactionReport({
      evidence,
      quality: quality(true),
      policy: "local_only",
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchEvidenceRedaction.v1");
    assert.equal(report.canSendToCopilot, false);
    assert.equal(report.redactedEvidenceCount, 0);
    assert.equal(report.omittedEvidenceCount, 1);
    assert.equal(report.warnings[0].code, "local_only_policy");
  } finally {
    cleanup();
  }
});

test("Relay evidence redaction allows bounded snippets only when policy and quality allow it", async () => {
  const { module, cleanup } = await loadRedactionModule();
  try {
    const report = module.buildRelayDocumentSearchEvidenceRedactionReport({
      evidence,
      quality: quality(true),
      policy: "snippets_allowed",
    });

    assert.equal(report.canSendToCopilot, true);
    assert.equal(report.redactedEvidenceCount, 1);
    assert.equal(report.redactedEvidence[0].path, undefined);
    assert.equal(report.redactedEvidence[0].display_path, "160連結/source.xlsx");
    assert.equal(report.redactedEvidence[0].anchor.snippet, "キャッシュフロー計算書の根拠");
  } finally {
    cleanup();
  }
});

test("Relay evidence redaction blocks Copilot handoff when quality is incomplete", async () => {
  const { module, cleanup } = await loadRedactionModule();
  try {
    const report = module.buildRelayDocumentSearchEvidenceRedactionReport({
      evidence,
      quality: quality(false),
      policy: "snippets_allowed",
    });

    assert.equal(report.canSendToCopilot, false);
    assert.equal(report.redactedEvidenceCount, 1);
    assert.ok(report.warnings.some((warning) => warning.code === "quality_gate_blocks_copilot"));
  } finally {
    cleanup();
  }
});
