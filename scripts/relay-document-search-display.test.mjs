import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const contractPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
);
const displayPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDisplay.ts",
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

async function loadDisplayModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-display-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchDisplay.mjs"),
    transpile(displayPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchDisplay.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Relay document search display adapter creates beginner-safe cards", async () => {
  const { module, cleanup } = await loadDisplayModule();
  try {
    const display = module.relayDocumentSearchResultToDisplayModel(
      {
        schemaVersion: "RelayDocumentSearchResult.v1",
        status: "partial",
        progress: { stage: "partial_filename_candidates", percent: 100, scannedFiles: 125, skippedFiles: 2 },
        job: { jobId: "job-1", lifecycle: "partial", cancellable: false },
        correlation: { relayJobId: "job-1" },
        queryPlan: {},
        coverage: { truncated: true },
        results: [
          {
            product_result_contract: "RelayDocumentSearchProductResult.v1",
            result_id: "result-1",
            file_id: "file-1",
            display_name: "FY160-1Q_連結CFS精算表.xlsx",
            path: "H:/shr1/160連結/FY160-1Q_連結CFS精算表.xlsx",
            match_mode: "filename",
            evidence_state: "filename_only",
            index_state: "metadata_indexed",
            preview_state: "preview_pending",
            open_state: "open_ready",
            score: 10,
            score_breakdown: {
              score_breakdown_contract: "RelayDocumentSearchScoreBreakdown.v1",
              rankingVersion: "relay-deterministic-ranker-v1",
              deterministic: true,
              filename_score: 5,
              path_score: 2,
              term_score: 1,
              base_score: 10,
              warning_penalty: 2,
              final_score: 8,
              components: {
                grouping: { score: 0, applied: true, reason: "variant_group_representative" },
              },
            },
            primary_source_index: "filename_index",
            source_indexes: [
              { kind: "metadata_cache", label: "メタデータ", state: "used" },
              { kind: "filename_index", label: "ファイル名索引", state: "used", score: 10 },
            ],
            anchors: [{ sheet: "Sheet1", cell: "A1" }],
            folder_role: "work",
            preview_action: { kind: "preview", enabled: true },
            open_action: { kind: "open_file", enabled: true },
            action_models: [
              { kind: "preview", label: "プレビュー", enabled: true },
              { kind: "open_file", label: "開く", enabled: true },
            ],
            ui_state: {
              stableSelectionKey: "file-1:v1",
              evidenceLinkable: false,
              answerCitationAllowed: false,
            },
            result_group: {
              schemaVersion: "RelayDocumentSearchResultGrouping.v1",
              groupId: "group-1",
              collapsedCount: 2,
            },
            warnings: ["filename_only", "content_reader_unavailable"],
            actions: ["preview", "open-file", "copy-path"],
          },
          {
            product_result_contract: "RelayDocumentSearchProductResult.v1",
            result_id: "result-2",
            file_id: "file-2",
            display_name: "XSA_連結CF.xlsx",
            path: "H:/shr1/160連結/XSA_連結CF.xlsx",
            match_mode: "filename",
            evidence_state: "filename_only",
            index_state: "metadata_indexed",
            preview_state: "preview_pending",
            open_state: "open_ready",
            score: 8,
            score_breakdown: { filename: 1 },
            primary_source_index: "filename_index",
            source_indexes: [
              { kind: "metadata_cache", label: "メタデータ", state: "used" },
              { kind: "filename_index", label: "ファイル名索引", state: "used", score: 8 },
            ],
            anchors: [],
            warnings: ["filename_only"],
            actions: ["preview"],
            action_models: [{ kind: "preview", label: "プレビュー", enabled: true }],
            preview_action: { kind: "preview", enabled: true },
            open_action: { kind: "open_file", enabled: true },
            ui_state: {
              stableSelectionKey: "file-2:v1",
              evidenceLinkable: false,
              answerCitationAllowed: false,
            },
          },
        ],
        evidencePack: {
          warnings: [{ code: "attachment_skipped", message: "attachments were skipped" }],
        },
        localDraft: {
          schemaVersion: "RelayDocumentSearchLocalDraft.v1",
          local_draft_id: "local-draft-1",
          evidence_pack_id: "evidence-pack-1",
          job_id: "job-1",
          generated_at: "2026-05-10T00:00:00.000Z",
          answer_policy: "candidate_only",
          citation_policy: "candidate_language_only",
          can_replace_with_copilot_polish: false,
          summary: "ファイル名・パスの候補が2件あります。中身の根拠はまだ確認できていません。",
          sections: [],
          citations: [],
          caveats: ["ファイル名・パスの候補であり、中身の根拠はまだありません。"],
          next_actions: ["候補ファイルを開いて中身を確認する"],
          validation: {
            groundedInEvidencePack: true,
            unsupportedClaims: [],
            evidenceItemCount: 0,
            candidateFileCount: 2,
            warningCodes: ["candidate_only"],
          },
          ai_boundary: {
            localFirst: true,
            copilotMayOnlyPolish: true,
            copilotPolishRequiresCitationValidation: true,
            originalFilesIncluded: false,
          },
        },
        answer: {
          schemaVersion: "RelayDocumentSearchAnswer.v1",
          answer_id: "answer-1",
          generated_at: "2026-05-10T00:00:00.000Z",
          source: "local_draft",
          evidence_pack_id: "evidence-pack-1",
          local_draft_id: "local-draft-1",
          text: "ファイル名・パスの候補が2件あります。中身の根拠はまだ確認できていません。",
          citation_ids: [],
          evidence_ids: [],
          replacement: {
            localDraftCommitted: true,
            replacementCount: 0,
            canReplaceAgain: false,
            reason: "copilot_polish_skipped",
          },
          validation: {
            groundedInEvidencePack: true,
            acceptedPolish: false,
            polishValidationState: "polish_skipped",
          },
          ai_boundary: {
            localFirst: true,
            originalFilesIncluded: false,
            copilotMayOnlyReplaceAfterValidation: true,
            replacementAtMostOnce: true,
          },
        },
        polishRequest: {
          schemaVersion: "RelayDocumentSearchPolishRequest.v1",
          status: "not_allowed",
          reason: "local_draft_not_polishable",
          generated_at: "2026-05-10T00:00:00.000Z",
          prompt_template_id: "relay_answer_polish_prompt.v1",
          expected_output_schema: "RelayDocumentSearchPolishedAnswer.v1",
          evidence_pack_id: "evidence-pack-1",
          local_draft_id: "local-draft-1",
          query: "CFS",
          correlation: {
            relayJobId: "job-1",
            queryId: "query-1",
            evidencePackId: "evidence-pack-1",
            localDraftId: "local-draft-1",
          },
          redaction_policy: "local_only",
          redacted_evidence_count: 0,
          citation_ids: [],
          evidence_ids: [],
          payload: {
            evidence_pack_id: "evidence-pack-1",
            local_draft_id: "local-draft-1",
            query: "CFS",
            local_draft_summary: "ファイル名・パスの候補が2件あります。",
            citations: [],
            redacted_evidence: [],
          },
          warnings: [{ code: "local_draft_not_polishable", message: "candidate-only draft" }],
          ai_boundary: {
            localFirst: true,
            originalFilesIncluded: false,
            fullPathsIncluded: false,
            extractedContentIncludedOnlyAfterRedaction: true,
            expectsStructuredPolishedAnswer: true,
          },
        },
        polishProvider: {
          schemaVersion: "RelayDocumentSearchPolishProvider.v1",
          state: "not_allowed",
          reason: "request_not_ready",
          generated_at: "2026-05-10T00:00:00.000Z",
          prompt_template_id: "relay_answer_polish_prompt.v1",
          expected_output_schema: "RelayDocumentSearchPolishedAnswer.v1",
          evidence_pack_id: "evidence-pack-1",
          local_draft_id: "local-draft-1",
          prompt_character_count: 0,
          candidate_received: false,
          local_search_blocked: false,
          local_draft_blocked: false,
          preview_open_blocked: false,
          warnings: [{ code: "request_not_ready", message: "not ready" }],
        },
        display: {
          beginnerSummary: "ファイル名とパスから候補を表示しています。",
          emptyStateGuidance: [],
          refineActions: ["broaden-keywords"],
        },
        diagnostics: {
          polishValidation: {
            schemaVersion: "RelayDocumentSearchPolishValidation.v1",
            state: "polish_skipped",
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
              relayJobId: "job-1",
              queryId: "query-1",
              aionuiMessageId: "message-1",
              evidencePackId: "evidence-pack-1",
              localDraftId: "local-draft-1",
            },
            errors: [],
            warnings: [{ code: "local_draft_not_polishable", message: "candidate-only draft" }],
            ai_boundary: {
              localFirst: true,
              originalFilesIncluded: false,
              acceptsOnlyEvidencePackCitations: true,
              repairAtMostOnce: true,
            },
          },
          copilotState: {
            schemaVersion: "RelayDocumentSearchCopilotState.v1",
            state: "copilot_sign_in_required",
            phase: "copilot_unavailable",
            generated_at: "2026-05-10T00:00:00.000Z",
            beginner_label: "AI文章チェックにはサインインが必要です",
            support_code: "copilot_sign_in_required",
            message: "sign in required",
            polish_validation_state: "polish_skipped",
            correlation: {
              relayJobId: "job-1",
              queryId: "query-1",
              aionuiMessageId: "message-1",
              evidencePackId: "evidence-pack-1",
              localDraftId: "local-draft-1",
            },
            visible_to_user: true,
            local_search_blocked: false,
            local_draft_blocked: false,
            preview_open_blocked: false,
            should_wait_for_copilot: false,
            optional_polish_retry_available: true,
            warnings: [{ code: "copilot_sign_in_required", message: "optional polish only" }],
            ai_boundary: {
              localResultsAuthoritative: true,
              copilotOptional: true,
              originalFilesIncluded: false,
              canOnlyPolishValidatedDraft: true,
            },
          },
          queryTrace: {
            schemaVersion: "RelayDocumentSearchQueryTrace.v1",
            traceId: "trace-job-1",
            plannerOwner: "relay",
            copilotRole: "optional_language_only",
            progressStage: "partial_filename_candidates",
            stages: [
              {
                name: "index_db",
                state: "partial",
                facts: {
                  enabled: true,
                  backend: "sqlite_fts",
                  dbPath: "/workspace/private/document-search.sqlite",
                  schemaRevision: 2,
                  readinessStatus: "degraded",
                  readinessReasons: ["no_fts_evidence_promoted_in_this_query"],
                  primaryPathGate: {
                    mode: "primary",
                    activePath: "filename_content",
                    eligible: false,
                    rollbackActive: true,
                    reasons: [
                      "primary_rollback_to_filename_content",
                      "readiness_degraded",
                      "fts_result_limit_reached",
                    ],
                  },
                  schemaReady: true,
                  migrationReady: true,
                  writeReady: true,
                  searchReady: true,
                  evidencePromotionReady: false,
                  resultUsage: {
                    candidateCount: 2,
                    returnedResultCount: 1,
                    searchMatchedFileCount: 2,
                    currentScanMatchedFileCount: 1,
                    freshCurrentScanMatchedFileCount: 1,
                    staleCurrentScanMatchedFileCount: 1,
                    outsideCurrentScanMatchedFileCount: 1,
                    scoredCandidateCount: 2,
                    scoredResultCount: 1,
                    promotedCandidateCount: 0,
                    promotedResultCount: 0,
                    candidateScoreTotal: 7,
                    maxCandidateScore: 4,
                    returnedScoreTotal: 4,
                    maxReturnedScore: 4,
                    candidateUncappedScoreTotal: 10,
                    returnedUncappedScoreTotal: 6,
                    candidateScoreCapLossTotal: 3,
                    returnedScoreCapLossTotal: 2,
                    scoreCappedCandidateCount: 1,
                    scoreCappedResultCount: 1,
                    nonReturnedScoredCandidateCount: 1,
                    nonReturnedPromotedCandidateCount: 0,
                    nonReturnedScoreTotal: 3,
                    scoreTotal: 4,
                    maxScore: 4,
                  },
                  staleEvidenceRowCount: 3,
                  staleEvidenceReasons: {
                    missing_anchor: 2,
                    source_metadata_mismatch: 1,
                  },
                  currentScanFtsRowCount: 3,
                  currentScanFtsFileCount: 1,
                  freshCurrentScanFtsRowCount: 2,
                  freshCurrentScanFtsFileCount: 1,
                  metadataBoostedFreshFtsRowCount: 1,
                  metadataBoostedFreshFtsFileCount: 1,
                  titleBoostedFreshFtsRowCount: 1,
                  titleBoostedFreshFtsFileCount: 1,
                  locationBoostedFreshFtsRowCount: 1,
                  locationBoostedFreshFtsFileCount: 1,
                  staleCurrentScanFtsRowCount: 1,
                  staleCurrentScanFtsFileCount: 1,
                  outsideCurrentScanFtsRowCount: 2,
                  outsideCurrentScanFtsFileCount: 1,
                  searchMaxRows: 3,
                  searchRawRowCount: 7,
                  searchDroppedRowCount: 4,
                  searchTruncated: true,
                  writeErrorCount: 0,
                  searchErrorCount: 0,
                  recentHealthEvents: [
                    {
                      kind: "maintenance_completed",
                      action: "rebuild-derived-indexes",
                      status: "repaired",
                    },
                  ],
                },
              },
              { name: "metadata_scan", state: "completed", facts: {} },
              { name: "content_scan", state: "partial", facts: {} },
            ],
          },
        },
      },
      { maxCards: 1 },
    );

    assert.equal(display.schemaVersion, "RelayDocumentSearchDisplay.v1");
    assert.equal(display.statusLabel, "一部だけ検索できました");
    assert.equal(display.summary, "ファイル名とパスから候補を表示しています。");
    assert.equal(display.indexStatus.state, "degraded");
    assert.equal(display.indexStatus.label, "索引は一部だけ利用中");
    assert.equal(display.indexStatus.activePathLabel, "ファイル名と本文検索を使用");
    assert.equal(display.indexStatus.actions.some((action) => action.kind === "rebuild_index"), true);
    assert.equal(display.partialResultExplanations.some((item) => item.includes("通常の検索結果を優先")), true);
    assert.equal(display.repairActions.some((action) => action.kind === "retry_search"), true);
    assert.match(display.answerSummary, /ファイル名・パスの候補/);
    assert.equal(display.answerSourceLabel, "ローカル下書き");
    assert.deepEqual(display.answerCitationLabels, []);
    assert.match(display.localDraftSummary, /ファイル名・パスの候補/);
    assert.deepEqual(display.localDraftCitationLabels, []);
    assert.equal(display.cards.length, 1);
    assert.equal(display.cards[0].title, "FY160-1Q_連結CFS精算表.xlsx");
    assert.equal(display.cards[0].stableSelectionKey, "file-1:v1");
    assert.equal(display.cards[0].position, 1);
    assert.equal(display.cards[0].selected, false);
    assert.equal(display.cards[0].matchLabel, "ファイル名・パスに一致");
    assert.equal(display.cards[0].evidenceLabel, "ファイル名候補");
    assert.equal(display.cards[0].sourceLabel, "ファイル名索引から検索");
    assert.deepEqual(display.cards[0].sourceLabels, ["メタデータ", "ファイル名索引"]);
    assert.equal(display.cards[0].rankingLabel, "関連度 8（警告で調整）");
    assert.deepEqual(display.cards[0].scoreBreakdownLabels, [
      "ファイル名 +5",
      "パス +2",
      "キーワード +1",
      "類似候補を集約",
      "警告 -2",
      "最終 8",
    ]);
    assert.equal(display.cards[0].previewLabel, "プレビュー準備中");
    assert.equal(display.cards[0].openLabel, "開けます");
    assert.equal(display.cards[0].folderRoleLabel, "作業フォルダ");
    assert.equal(display.cards[0].actionModels.length, 2);
    assert.equal(display.cards[0].groupLabel, "2件の類似候補をまとめています");
    assert.equal(display.cards[0].collapsedGroupCount, 2);
    assert.deepEqual(display.cards[0].warningLabels, [
      "中身はまだ確認していません",
      "この形式の中身確認は未対応です",
    ]);
    assert.equal(display.hasMore, true);
    assert.deepEqual(display.continuationAction, { kind: "show-more-results", label: "さらに表示", nextOffset: 1 });
    assert.equal(display.resultFlow.schemaVersion, "RelayDocumentSearchResultFlow.v1");
    assert.equal(display.resultFlow.structuredResultCardsPrimary, true);
    assert.equal(display.resultFlow.copilotProseSecondary, true);
    assert.deepEqual(display.resultFlow.batch, {
      strategy: "capped-batches",
      offset: 0,
      limit: 1,
      shownStart: 1,
      shownEnd: 1,
      shownResults: 1,
      totalResults: 2,
      hasMore: true,
      nextOffset: 1,
    });
    assert.deepEqual(display.resultFlow.continuationAction, {
      kind: "show-more-results",
      label: "さらに表示",
      nextOffset: 1,
    });
    assert.deepEqual(display.resultFlow.selection, {
      strategy: "stableSelectionKey",
      selectedVisible: false,
      selectedAvailable: false,
      visibleStableSelectionKeys: ["file-1:v1"],
      allStableSelectionKeys: ["file-1:v1", "file-2:v1"],
    });
    assert.equal(display.resultFlow.indexStatus.state, "degraded");
    assert.deepEqual(display.resultFlow.refineActions, ["broaden-keywords"]);
    assert.equal(display.resultFlow.copilotProse.summaryField, "answerSummary");
    assert.equal(display.resultFlow.copilotProse.localDraftField, "localDraftSummary");
    assert.equal(display.totalResults, 2);
    assert.equal(display.shownResults, 1);
    assert.deepEqual(display.detailLevels, [
      { level: "overview", label: "標準", visibleByDefault: true },
      { level: "details", label: "詳細", visibleByDefault: false },
      { level: "support", label: "サポート", visibleByDefault: false },
    ]);
    assert.equal(display.detailSections.some((section) => section.title === "回答"), true);
    assert.equal(display.detailSections.some((section) => section.title === "根拠の場所"), true);
    assert.equal(display.detailSections.some((section) => section.title === "回答下書き"), true);
    assert.equal(display.detailSections.some((section) => section.title === "構造・表の情報"), true);
    assert.equal(display.detailSections.some((section) => section.title === "検索経路"), true);
    assert.equal(display.detailSections.some((section) => section.title === "関連度内訳"), true);
    assert.equal(display.detailSections.some((section) => section.title === "索引状態"), true);
    assert.equal(display.detailSections.some((section) => section.title === "添付ファイル"), true);
    assert.equal(display.detailSections.some((section) => section.title === "AI文章チェック" && section.supportOnly), true);
    assert.equal(display.detailSections.some((section) => section.title === "Copilot状態" && section.supportOnly), true);
    assert.equal(display.detailSections.some((section) => section.title === "サポート用の実行記録" && section.supportOnly), true);
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Sheet1!A1")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("再置換: false")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Query Trace: trace-job-1")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("index_db: partial")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Index DB: degraded")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB readiness gates: schema=true migration=true write=true search=true evidence=false")
      ),
      true,
    );
    assert.equal(
      display.detailSections.find((section) => section.title === "索引状態").items.some((item) =>
        item.includes("操作: 索引を作り直す")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB active path: filename_content mode=primary eligible=false rollback=true")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB primary gate reasons: primary_rollback_to_filename_content")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Index DB scored results: 1")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB scored candidates: 2")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB score totals: candidates=7 results=4 nonReturned=3 maxCandidate=4 maxResult=4")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB score cap: cappedCandidates=1 cappedResults=1 candidateUncapped=10 resultUncapped=6 candidateLoss=3 resultLoss=2")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB non-returned scored candidates: 1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB current matched files: 1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB fresh matched files: 1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB stale current matched files: 1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB outside matched files: 1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Index DB promoted results: 0")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB stale row reasons: missing_anchor=2, source_metadata_mismatch=1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB current scan: files=1 rows=3")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB fresh scan: files=1 rows=2")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB metadata boosted fresh scan: files=1 rows=1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB metadata boost split: titleFiles=1 titleRows=1 locationFiles=1 locationRows=1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB stale current scan: files=1 rows=1")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB outside scan: files=1 rows=2")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB result limit reached: max=3 dropped=4")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) =>
        item.includes("Index DB recent health: maintenance_completed:rebuild-derived-indexes:repaired")
      ),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("private/document-search.sqlite")),
      false,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Polish: polish_skipped")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Polish request: not_allowed")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Provider polish: not_allowed")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Answer prompt: relay_answer_polish_prompt.v1")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Copilot: copilot_sign_in_required")),
      true,
    );
    assert.equal(
      display.detailSections.flatMap((section) => section.items).some((item) => item.includes("Blocks local results: false")),
      true,
    );
    assert.match(display.coverageLabel, /途中まで/);
    assert.deepEqual(display.refineActions, ["broaden-keywords"]);
  } finally {
    cleanup();
  }
});

test("Relay document search display adapter returns a safe failure model for invalid results", async () => {
  const { module, cleanup } = await loadDisplayModule();
  try {
    const display = module.relayDocumentSearchResultToDisplayModel({ status: "ok" });
    assert.equal(display.status, "failed");
    assert.equal(display.cards.length, 0);
    assert.equal(display.resultFlow.schemaVersion, "RelayDocumentSearchResultFlow.v1");
    assert.deepEqual(display.resultFlow.batch, {
      strategy: "capped-batches",
      offset: 0,
      limit: 20,
      shownStart: 0,
      shownEnd: 0,
      shownResults: 0,
      totalResults: 0,
      hasMore: false,
    });
    assert.match(display.summary, /表示できませんでした/);
  } finally {
    cleanup();
  }
});

test("Relay document search display adapter supports continuation offsets and stable selection", async () => {
  const { module, cleanup } = await loadDisplayModule();
  try {
    const result = {
      schemaVersion: "RelayDocumentSearchResult.v1",
      status: "ok",
      progress: { stage: "completed", percent: 100, scannedFiles: 2, skippedFiles: 0 },
      job: { jobId: "job-continuation", lifecycle: "completed", cancellable: false },
      correlation: { relayJobId: "job-continuation" },
      queryPlan: {},
      coverage: { truncated: false },
      results: [
        {
          product_result_contract: "RelayDocumentSearchProductResult.v1",
          result_id: "result-a",
          file_id: "file-a",
          display_name: "A.xlsx",
          path: "/workspace/A.xlsx",
          match_mode: "filename",
          evidence_state: "filename_only",
          index_state: "metadata_indexed",
          preview_state: "preview_pending",
          open_state: "open_ready",
          score: 10,
          score_breakdown: { final_score: 10 },
          primary_source_index: "filename_index",
          source_indexes: [{ kind: "filename_index", label: "ファイル名索引", state: "used" }],
          anchors: [],
          warnings: [],
          actions: ["preview"],
          action_models: [{ kind: "preview", label: "プレビュー", enabled: true }],
          preview_action: { kind: "preview", enabled: true },
          open_action: { kind: "open_file", enabled: true },
          ui_state: { stableSelectionKey: "file-a", evidenceLinkable: false, answerCitationAllowed: false },
        },
        {
          product_result_contract: "RelayDocumentSearchProductResult.v1",
          result_id: "result-b",
          file_id: "file-b",
          display_name: "B.xlsx",
          path: "/workspace/B.xlsx",
          match_mode: "content",
          evidence_state: "content_confirmed",
          index_state: "content_indexed",
          preview_state: "preview_ready",
          open_state: "open_ready",
          score: 8,
          score_breakdown: { final_score: 8 },
          primary_source_index: "derived_content_index",
          source_indexes: [{ kind: "derived_content_index", label: "本文索引", state: "used" }],
          anchors: [{ sheet: "Sheet1", cell: "A1" }],
          warnings: [],
          actions: ["preview", "open-file"],
          action_models: [{ kind: "preview", label: "プレビュー", enabled: true }],
          preview_action: { kind: "preview", enabled: true },
          open_action: { kind: "open_file", enabled: true },
          ui_state: { stableSelectionKey: "file-b", evidenceLinkable: true, answerCitationAllowed: true },
        },
      ],
      evidencePack: {},
      display: { beginnerSummary: "2件の候補です。", refineActions: ["broaden-keywords"] },
      diagnostics: {},
    };

    const secondBatch = module.relayDocumentSearchResultToDisplayModel(result, {
      maxCards: 1,
      offset: 1,
      selectedStableSelectionKey: "file-a",
    });

    assert.equal(secondBatch.cards.length, 1);
    assert.equal(secondBatch.cards[0].resultId, "result-b");
    assert.equal(secondBatch.cards[0].stableSelectionKey, "file-b");
    assert.equal(secondBatch.cards[0].position, 2);
    assert.equal(secondBatch.cards[0].selected, false);
    assert.equal(secondBatch.hasMore, false);
    assert.equal(secondBatch.nextOffset, undefined);
    assert.equal(secondBatch.continuationAction, undefined);
    assert.deepEqual(secondBatch.resultFlow.batch, {
      strategy: "capped-batches",
      offset: 1,
      limit: 1,
      shownStart: 2,
      shownEnd: 2,
      shownResults: 1,
      totalResults: 2,
      hasMore: false,
    });
    assert.deepEqual(secondBatch.resultFlow.selection, {
      strategy: "stableSelectionKey",
      selectedStableSelectionKey: "file-a",
      selectedResultId: "result-a",
      selectedPosition: 1,
      selectedVisible: false,
      selectedAvailable: true,
      visibleStableSelectionKeys: ["file-b"],
      allStableSelectionKeys: ["file-a", "file-b"],
    });

    const selectedVisible = module.relayDocumentSearchResultToDisplayModel(result, {
      maxCards: 2,
      selectedStableSelectionKey: "file-b",
    });
    assert.equal(selectedVisible.cards[1].selected, true);
    assert.equal(selectedVisible.resultFlow.selection.selectedVisible, true);
  } finally {
    cleanup();
  }
});

test("Relay document search display adapter labels non-happy evidence and index states", async () => {
  const { module, cleanup } = await loadDisplayModule();
  try {
    const display = module.relayDocumentSearchResultToDisplayModel({
      schemaVersion: "RelayDocumentSearchResult.v1",
      status: "partial",
      progress: { stage: "partial_content_candidates", percent: 100, scannedFiles: 4, skippedFiles: 1 },
      job: { jobId: "job-state", lifecycle: "partial", cancellable: false },
      correlation: { relayJobId: "job-state" },
      queryPlan: {},
      coverage: { truncated: false },
      results: [
        {
          product_result_contract: "RelayDocumentSearchProductResult.v1",
          result_id: "result-state",
          file_id: "file-state",
          display_name: "確認中.xlsx",
          path: "H:/shr1/確認中.xlsx",
          match_mode: "hybrid",
          evidence_state: "table_backed",
          index_state: "table_indexed",
          preview_state: "preview_ready",
          open_state: "open_ready",
          score: 7,
          score_breakdown: { table: 1 },
          primary_source_index: "table_index",
          source_indexes: [
            { kind: "metadata_cache", label: "メタデータ", state: "used" },
            { kind: "parsed_document_ir", label: "文書解析結果", state: "used" },
            { kind: "derived_content_index", label: "本文索引", state: "used", score: 7 },
            { kind: "table_index", label: "表索引", state: "used", score: 7 },
          ],
          anchors: [{ sheet: "CF", cell: "B12" }],
          warnings: ["stale", "skipped", "failed", "access_denied", "offline_share"],
          actions: ["preview", "open-file"],
          action_models: [{ kind: "preview", label: "プレビュー", enabled: true }],
          preview_action: { kind: "preview", enabled: true },
          open_action: { kind: "open_file", enabled: true },
          ui_state: {
            stableSelectionKey: "file-state:v1",
            evidenceLinkable: true,
            answerCitationAllowed: true,
          },
        },
      ],
      evidencePack: {},
      display: { beginnerSummary: "状態ラベルを確認します。" },
      diagnostics: {},
    });

    assert.equal(display.cards[0].matchLabel, "ファイル名と本文に一致");
    assert.equal(display.cards[0].evidenceLabel, "表の根拠あり");
    assert.equal(display.cards[0].indexLabel, "表検索");
    assert.equal(display.cards[0].sourceLabel, "表の中身から検索");
    assert.deepEqual(display.cards[0].warningLabels, [
      "古い索引のため再確認が必要です",
      "確認をスキップしました",
      "確認に失敗しました",
      "現在のユーザーでは開けません",
      "共有フォルダに接続できません",
    ]);
  } finally {
    cleanup();
  }
});
