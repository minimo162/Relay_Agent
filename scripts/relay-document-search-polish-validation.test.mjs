import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
);
const polishValidationPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishValidation.ts",
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

async function loadPolishValidationModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-polish-validation-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchPolishValidation.mjs"),
    transpile(polishValidationPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchPolishValidation.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function evidencePack(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchEvidencePack.v1",
    evidence_pack_id: "evidence-pack-query-1",
    job_id: "job-1",
    query_id: "query-1",
    generated_at: "2026-05-10T00:00:00.000Z",
    query: "キャッシュフロー 精算表",
    query_plan: {
      mode: "evidence",
      terms: ["キャッシュフロー", "精算表"],
      file_types: ["xlsx"],
      period_hints: [],
      evidence: "required",
    },
    coverage: {
      searchedRoots: ["H:/shr1"],
      metadataScannedFiles: 12,
      contentScannedFiles: 1,
      skippedFiles: 0,
      inaccessiblePathCount: 0,
      resultCount: 1,
      contentEvidenceFileCount: 1,
      truncated: false,
      cancelled: false,
      timedOut: false,
      generatedAt: "2026-05-10T00:00:00.000Z",
    },
    candidate_files: [
      {
        result_id: "result-file-1",
        file_id: "file-1",
        path: "H:/shr1/CFS.xlsx",
        display_path: "CFS.xlsx",
        display_name: "CFS.xlsx",
        file_type: "xlsx",
        match_mode: "content",
        evidence_state: "content_confirmed",
        index_state: "content_indexed",
        score: 10,
        score_breakdown: {},
        source_indexes: [],
        warnings: [],
        anchor_count: 1,
      },
    ],
    evidence: [
      {
        evidence_id: "evidence-1",
        result_id: "result-file-1",
        file_id: "file-1",
        path: "H:/shr1/CFS.xlsx",
        display_path: "CFS.xlsx",
        display_name: "CFS.xlsx",
        evidence_state: "content_confirmed",
        anchor: {
          type: "cell_excerpt",
          sheet_name: "CFS",
          cell_address: "A1",
          snippet: "キャッシュフロー計算書 精算表",
        },
        warnings: [],
      },
    ],
    warnings: [],
    ai_boundary: {
      localFirst: true,
      copilotMayUseOnlyEvidencePack: true,
      originalFilesIncluded: false,
      parsedDocumentPayloadIncluded: false,
    },
    ...overrides,
  };
}

function localDraft(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchLocalDraft.v1",
    local_draft_id: "local-draft-1",
    evidence_pack_id: "evidence-pack-query-1",
    job_id: "job-1",
    query_id: "query-1",
    generated_at: "2026-05-10T00:00:00.000Z",
    query: "キャッシュフロー 精算表",
    answer_policy: "evidence_confirmed",
    citation_policy: "evidence_pack_ids_required",
    can_replace_with_copilot_polish: true,
    summary: "中身を確認できた根拠が1件あります。CFS.xlsx の CFS!A1 に根拠があります。[E1]",
    sections: [],
    citations: [
      {
        citation_id: "E1",
        evidence_id: "evidence-1",
        result_id: "result-file-1",
        file_id: "file-1",
        label: "CFS.xlsx",
        anchor_summary: "CFS!A1",
      },
    ],
    caveats: [],
    next_actions: ["CFS.xlsx を開く"],
    validation: {
      groundedInEvidencePack: true,
      unsupportedClaims: [],
      evidenceItemCount: 1,
      candidateFileCount: 1,
      warningCodes: [],
    },
    ai_boundary: {
      localFirst: true,
      copilotMayOnlyPolish: true,
      copilotPolishRequiresCitationValidation: true,
      originalFilesIncluded: false,
    },
    ...overrides,
  };
}

function validCandidate(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchPolishedAnswer.v1",
    polished_answer_id: "polished-1",
    prompt_template_id: "relay_answer_polish_prompt.v1",
    evidence_pack_id: "evidence-pack-query-1",
    local_draft_id: "local-draft-1",
    answer: "CFS.xlsx の CFS!A1 にキャッシュフロー計算書の根拠があります。[E1]",
    citations: [{ citation_id: "E1", evidence_id: "evidence-1" }],
    ...overrides,
  };
}

test("Copilot polish validation accepts only citation-bound Evidence Pack answers", async () => {
  const { module, cleanup } = await loadPolishValidationModule();
  try {
    const report = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft(),
      candidate: validCandidate(),
      correlation: {
        relayJobId: "job-1",
        queryId: "query-1",
        aionuiConversationId: "conversation-1",
        aionuiMessageId: "message-1",
        copilotRequestId: "copilot-request-1",
      },
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchPolishValidation.v1");
    assert.equal(report.state, "polish_accepted");
    assert.equal(report.accepted, true);
    assert.equal(report.accepted_answer, validCandidate().answer);
    assert.deepEqual(report.citation_ids, ["E1"]);
    assert.deepEqual(report.evidence_ids, ["evidence-1"]);
    assert.equal(report.prompt_template_ids.answerPolish, "relay_answer_polish_prompt.v1");
    assert.equal(report.prompt_template_ids.polishRepair, "relay_polish_repair_prompt.v1");
    assert.equal(report.correlation.relayJobId, "job-1");
    assert.equal(report.correlation.queryId, "query-1");
    assert.equal(report.correlation.aionuiConversationId, "conversation-1");
    assert.equal(report.correlation.aionuiMessageId, "message-1");
    assert.equal(report.correlation.copilotRequestId, "copilot-request-1");
    assert.equal(report.correlation.evidencePackId, "evidence-pack-query-1");
    assert.equal(report.correlation.localDraftId, "local-draft-1");
    assert.equal(report.correlation.polishedAnswerId, "polished-1");
    assert.deepEqual(report.errors, []);
    assert.equal(report.ai_boundary.repairAtMostOnce, true);
  } finally {
    cleanup();
  }
});

test("Copilot polish validation requests one repair for unsupported evidence details", async () => {
  const { module, cleanup } = await loadPolishValidationModule();
  try {
    const report = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft(),
      candidate: validCandidate({
        answer: "Other.xlsx の CFS!A1 にキャッシュフロー計算書の根拠があります。[E1]",
      }),
    });

    assert.equal(report.state, "polish_repair_required");
    assert.equal(report.accepted, false);
    assert.equal(report.repair_prompt_template_id, "relay_polish_repair_prompt.v1");
    assert.ok(report.errors.some((error) => error.code === "unsupported_mention"));
  } finally {
    cleanup();
  }
});

test("Copilot polish validation rejects an invalid repair attempt without another retry", async () => {
  const { module, cleanup } = await loadPolishValidationModule();
  try {
    const report = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft(),
      repairAttempt: 1,
      candidate: validCandidate({
        answer: "Other.xlsx の CFS!A1 にキャッシュフロー計算書の根拠があります。[E1]",
      }),
    });

    assert.equal(report.state, "polish_rejected");
    assert.equal(report.accepted, false);
    assert.equal(report.repair_prompt_template_id, undefined);
    assert.equal(report.repair_attempt, 1);
    assert.ok(report.errors.some((error) => error.code === "unsupported_mention"));
  } finally {
    cleanup();
  }
});

test("Copilot polish validation rejects mismatched prompt template ids", async () => {
  const { module, cleanup } = await loadPolishValidationModule();
  try {
    const report = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft(),
      candidate: validCandidate({
        prompt_template_id: "other_prompt.v1",
      }),
    });

    assert.equal(report.state, "polish_repair_required");
    assert.ok(report.errors.some((error) => error.code === "prompt_template_mismatch"));
  } finally {
    cleanup();
  }
});

test("Copilot polish validation skips polish when local or redaction policy blocks it", async () => {
  const { module, cleanup } = await loadPolishValidationModule();
  try {
    const redactionBlocked = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft(),
      redactionAllowsCopilot: false,
    });
    assert.equal(redactionBlocked.state, "polish_skipped");
    assert.ok(redactionBlocked.warnings.some((warning) => warning.code === "redaction_blocks_copilot"));

    const candidateOnly = module.validateRelayDocumentSearchCopilotPolish({
      evidencePack: evidencePack(),
      localDraft: localDraft({
        answer_policy: "candidate_only",
        citation_policy: "candidate_language_only",
        can_replace_with_copilot_polish: false,
        citations: [],
      }),
    });
    assert.equal(candidateOnly.state, "polish_skipped");
    assert.ok(candidateOnly.warnings.some((warning) => warning.code === "local_draft_not_polishable"));
  } finally {
    cleanup();
  }
});
