import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const localDraftPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchLocalDraft.ts",
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

async function loadLocalDraftModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-local-draft-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchLocalDraft.mjs"), transpile(localDraftPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchLocalDraft.mjs")).href),
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
        display_name: "CFS.xlsx",
        display_path: "CFS.xlsx",
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
    warnings: [{ code: "content_confirmed", message: "Some candidates include local text evidence." }],
    ai_boundary: {
      localFirst: true,
      copilotMayUseOnlyEvidencePack: true,
      originalFilesIncluded: false,
      parsedDocumentPayloadIncluded: false,
    },
    ...overrides,
  };
}

function quality(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchQuality.v1",
    coverageConfidence: "high",
    evidenceConfidence: "high",
    freshnessConfidence: "high",
    answerPolicy: "evidence_confirmed",
    canAskCopilotForFinalAnswer: true,
    warnings: [],
    ...overrides,
  };
}

test("Local draft builds citation-bound Japanese answer material from Evidence Pack", async () => {
  const { module, cleanup } = await loadLocalDraftModule();
  try {
    const draft = module.buildRelayDocumentSearchLocalDraft({
      evidencePack: evidencePack(),
      quality: quality(),
    });

    assert.equal(draft.schemaVersion, "RelayDocumentSearchLocalDraft.v1");
    assert.match(draft.local_draft_id, /^local-draft-/);
    assert.equal(draft.answer_policy, "evidence_confirmed");
    assert.equal(draft.citation_policy, "evidence_pack_ids_required");
    assert.equal(draft.can_replace_with_copilot_polish, true);
    assert.match(draft.summary, /中身を確認できた根拠が1件/);
    assert.equal(draft.citations[0].citation_id, "E1");
    assert.equal(draft.citations[0].anchor_summary, "CFS!A1");
    assert.match(
      draft.sections.find((section) => section.kind === "confirmed_evidence").items[0].text,
      /キャッシュフロー計算書/,
    );
    assert.equal(draft.validation.groundedInEvidencePack, true);
    assert.equal(draft.validation.unsupportedClaims.length, 0);
    assert.equal(draft.ai_boundary.originalFilesIncluded, false);
    assert.deepEqual(module.validateRelayDocumentSearchLocalDraft(draft), { ok: true, errors: [] });
  } finally {
    cleanup();
  }
});

test("Local draft keeps candidate-only results out of Copilot replacement flow", async () => {
  const { module, cleanup } = await loadLocalDraftModule();
  try {
    const draft = module.buildRelayDocumentSearchLocalDraft({
      evidencePack: evidencePack({
        evidence: [],
        warnings: [{ code: "filename_only", message: "Candidates are not content evidence yet." }],
      }),
      quality: quality({
        evidenceConfidence: "low",
        answerPolicy: "candidate_only",
        canAskCopilotForFinalAnswer: false,
        warnings: [{ code: "candidate_only", severity: "warning", message: "candidate only" }],
      }),
    });

    assert.equal(draft.answer_policy, "candidate_only");
    assert.equal(draft.citation_policy, "candidate_language_only");
    assert.equal(draft.can_replace_with_copilot_polish, false);
    assert.equal(draft.citations.length, 0);
    assert.match(draft.summary, /ファイル名・パスの候補/);
    assert.ok(draft.caveats.some((item) => item.includes("中身の根拠はまだありません")));
    assert.deepEqual(module.validateRelayDocumentSearchLocalDraft(draft), { ok: true, errors: [] });
  } finally {
    cleanup();
  }
});

test("Local draft validator rejects Copilot replacement without citations", async () => {
  const { module, cleanup } = await loadLocalDraftModule();
  try {
    const invalid = module.validateRelayDocumentSearchLocalDraft({
      schemaVersion: "RelayDocumentSearchLocalDraft.v1",
      local_draft_id: "local-draft-invalid",
      evidence_pack_id: "evidence-pack-invalid",
      job_id: "job-invalid",
      generated_at: "2026-05-10T00:00:00.000Z",
      answer_policy: "evidence_confirmed",
      can_replace_with_copilot_polish: true,
      summary: "bad",
      sections: [],
      citations: [],
      caveats: [],
      next_actions: [],
      validation: { groundedInEvidencePack: true, unsupportedClaims: [] },
      ai_boundary: {
        localFirst: true,
        copilotMayOnlyPolish: true,
        copilotPolishRequiresCitationValidation: true,
        originalFilesIncluded: false,
      },
    });

    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join("\n"), /requires evidence citations/);
  } finally {
    cleanup();
  }
});
