import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const answerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchAnswer.ts",
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

async function loadAnswerModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-answer-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchAnswer.mjs"), transpile(answerPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchAnswer.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function localDraft() {
  return {
    schemaVersion: "RelayDocumentSearchLocalDraft.v1",
    local_draft_id: "local-draft-1",
    evidence_pack_id: "evidence-pack-1",
    job_id: "job-1",
    query_id: "query-1",
    generated_at: "2026-05-10T00:00:00.000Z",
    query: "CFS",
    answer_policy: "evidence_confirmed",
    citation_policy: "evidence_pack_ids_required",
    can_replace_with_copilot_polish: true,
    summary: "中身を確認できた根拠が1件あります。",
    sections: [],
    citations: [{ citation_id: "E1", evidence_id: "evidence-1", label: "CFS.xlsx" }],
    caveats: [],
    next_actions: [],
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
  };
}

function polishValidation(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchPolishValidation.v1",
    state: "polish_pending",
    accepted: false,
    generated_at: "2026-05-10T00:00:00.000Z",
    evidence_pack_id: "evidence-pack-1",
    local_draft_id: "local-draft-1",
    citation_ids: [],
    evidence_ids: [],
    repair_attempt: 0,
    prompt_template_ids: {
      answerPolish: "relay_answer_polish_prompt.v1",
      polishRepair: "relay_polish_repair_prompt.v1",
    },
    correlation: {
      evidencePackId: "evidence-pack-1",
      localDraftId: "local-draft-1",
    },
    errors: [],
    warnings: [],
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      acceptsOnlyEvidencePackCitations: true,
      repairAtMostOnce: true,
    },
    ...overrides,
  };
}

test("Answer contract keeps local draft committed while polish is pending", async () => {
  const { module, cleanup } = await loadAnswerModule();
  try {
    const answer = module.buildRelayDocumentSearchAnswer({
      localDraft: localDraft(),
      polishValidation: polishValidation(),
    });

    assert.equal(answer.schemaVersion, "RelayDocumentSearchAnswer.v1");
    assert.equal(answer.source, "local_draft");
    assert.equal(answer.text, "中身を確認できた根拠が1件あります。");
    assert.equal(answer.replacement.localDraftCommitted, true);
    assert.equal(answer.replacement.replacementCount, 0);
    assert.equal(answer.replacement.canReplaceAgain, false);
    assert.equal(answer.replacement.reason, "copilot_polish_pending");
    assert.deepEqual(answer.citation_ids, ["E1"]);
    assert.deepEqual(answer.evidence_ids, ["evidence-1"]);
    assert.equal(module.validateRelayDocumentSearchAnswer(answer).ok, true);
  } finally {
    cleanup();
  }
});

test("Answer contract replaces local draft once for accepted citation-bound polish", async () => {
  const { module, cleanup } = await loadAnswerModule();
  try {
    const answer = module.buildRelayDocumentSearchAnswer({
      localDraft: localDraft(),
      polishValidation: polishValidation({
        state: "polish_accepted",
        accepted: true,
        polished_answer_id: "polished-answer-1",
        accepted_answer: "CFS.xlsx の Sheet1!A1 に根拠があります [E1]。",
        citation_ids: ["E1"],
        evidence_ids: ["evidence-1"],
      }),
    });

    assert.equal(answer.source, "copilot_polish");
    assert.equal(answer.polished_answer_id, "polished-answer-1");
    assert.match(answer.text, /Sheet1!A1/);
    assert.equal(answer.replacement.localDraftCommitted, true);
    assert.equal(answer.replacement.replacementCount, 1);
    assert.equal(answer.replacement.canReplaceAgain, false);
    assert.equal(answer.replacement.reason, "copilot_polish_accepted");
    assert.equal(answer.validation.acceptedPolish, true);
    assert.equal(module.validateRelayDocumentSearchAnswer(answer).ok, true);
  } finally {
    cleanup();
  }
});
