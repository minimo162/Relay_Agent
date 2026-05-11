import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryTrace.ts",
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

async function loadTraceModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-query-trace-module-"));
  writeFileSync(
    resolve(dir, "relayDocumentSearchQueryTrace.mjs"),
    transpile(tracePath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchQualityGates';", "from './relayDocumentSearchQualityGates.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchQueryTrace.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function traceInput(overrides = {}) {
  return {
    request: {
      schemaVersion: "RelayDocumentSearchRequest.v1",
      query: "キャッシュフロー CFS",
      roots: ["/workspace"],
      intent: "answer_with_evidence",
      thoroughness: "thorough",
      fileTypes: ["xlsx"],
      maxResults: 10,
      evidence: "required",
    },
    queryPlan: {
      schemaVersion: "RelayDocumentSearchQueryPlan.v1",
      normalizerVersion: "relay-query-normalizer-v1",
      mode: "evidence",
      query: "キャッシュフロー CFS",
      roots: ["/workspace"],
      normalizedTerms: ["キャッシュフロー", "cfs"],
      synonymExpansions: [{ source: "cash_flow", terms: ["キャッシュフロー", "cfs"] }],
      periodHints: [],
      fileTypeHints: ["xlsx"],
      rejectedTokens: [],
      confirmationPolicy: "content_required",
    },
    jobId: "job-trace",
    queryId: "query-trace",
    generatedAt: "2026-05-09T00:00:00.000Z",
    status: "ok",
    progressStage: "content_candidates",
    searchedRoots: ["/workspace"],
    maxScanFiles: 5000,
    maxContentInspectFiles: 500,
    scannedFiles: 20,
    skippedFiles: 1,
    inaccessiblePathCount: 0,
    truncated: false,
    cancelled: false,
    timedOut: false,
    metadataCache: { hits: [], misses: ["/workspace"], writes: ["/workspace"], writeErrors: [] },
    filenameIndex: {
      enabled: true,
      mode: "persistent",
      inMemoryFileCount: 20,
      inMemoryTermCount: 40,
      searchHitCount: 4,
      readHits: [],
      readMisses: ["/workspace"],
      writes: ["/workspace"],
      writeErrors: [],
    },
    contentScan: {
      scannedFiles: 3,
      skippedFiles: 1,
      evidenceFileCount: 2,
      required: true,
      requiredButUnconfirmed: false,
    },
    ranking: {
      candidateCount: 4,
      returnedCount: 2,
      scoreBreakdown: {
        score_breakdown_contract: "RelayDocumentSearchScoreBreakdown.v1",
        rankingVersion: "relay-deterministic-ranker-v1",
        deterministic: true,
        candidateCount: 4,
        returnedCount: 2,
        activePath: "sqlite_fts_primary",
        componentTotals: {
          filename: 3,
          path: 1,
          keyword: 2,
          sqlite_fts: 9,
          content: 4,
          table_cell: 0,
          recency: 0,
          pin_history: 1,
          grouping: 0,
          warning_penalty: -2,
          hybrid_merge: 19,
        },
        warningPenaltyTotal: 2,
        groupingCollapsedCandidateCount: 1,
        hybridMergeMode: "sqlite_fts_primary",
      },
      perDirectoryLimit: 5,
      uniqueDirectoryCount: 2,
      deferredCandidateCount: 0,
    },
    indexCoordinator: { enabled: true, acquired: true, busy: false, events: [{ kind: "lock_acquired" }] },
    indexDb: {
      enabled: true,
      backend: "sqlite_fts",
      dbPath: "/workspace/.relay/document-search.sqlite",
      schemaRevision: 2,
      readinessStatus: "ready",
      readinessReasons: ["sqlite_fts_cutover_ready"],
      primaryPathGate: {
        mode: "primary",
        activePath: "sqlite_fts_primary",
        eligible: true,
        rollbackActive: false,
        reasons: ["sqlite_fts_primary_active"],
        thresholds: {
          readinessStatus: "ready",
          searchTruncated: false,
          maxStaleEvidenceRows: 0,
          maxOutsideCurrentScanRows: 0,
          maxWriteErrors: 0,
          maxSearchErrors: 0,
          minFreshCurrentScanFtsFiles: 1,
          minFreshCurrentScanFtsRows: 1,
        },
      },
      schemaReady: true,
      migrationReady: true,
      writeReady: true,
      searchReady: true,
      evidencePromotionReady: true,
      schemaGate: {
        schemaVersion: "RelayDocumentSearchSchemaMigrationGate.v1",
        status: "ready",
        componentCount: 2,
        readOnlyComponentCount: 0,
        rebuildRequiredComponentCount: 0,
        invalidComponentCount: 0,
        durableDataPreserved: true,
        userStatePreserved: true,
        components: [
          { name: "metadata_cache", status: "compatible", readOnly: false, rebuildRequired: false },
          { name: "sqlite_fts", status: "compatible", readOnly: false, rebuildRequired: false },
        ],
      },
      resultUsage: {
        candidateCount: 4,
        returnedResultCount: 2,
        searchMatchedFileCount: 2,
        currentScanMatchedFileCount: 1,
        freshCurrentScanMatchedFileCount: 1,
        staleCurrentScanMatchedFileCount: 0,
        outsideCurrentScanMatchedFileCount: 0,
        scoredCandidateCount: 2,
        scoredResultCount: 1,
        promotedCandidateCount: 1,
        promotedResultCount: 1,
        candidateScoreTotal: 12,
        maxCandidateScore: 9,
        returnedScoreTotal: 9,
        maxReturnedScore: 9,
        candidateUncappedScoreTotal: 15,
        returnedUncappedScoreTotal: 12,
        candidateScoreCapLossTotal: 3,
        returnedScoreCapLossTotal: 3,
        scoreCappedCandidateCount: 1,
        scoreCappedResultCount: 1,
        nonReturnedScoredCandidateCount: 1,
        nonReturnedPromotedCandidateCount: 0,
        nonReturnedScoreTotal: 3,
        scoreTotal: 9,
        maxScore: 9,
      },
      staleEvidenceRowCount: 0,
      currentScanFtsRowCount: 2,
      currentScanFtsFileCount: 1,
      freshCurrentScanFtsRowCount: 2,
      freshCurrentScanFtsFileCount: 1,
      metadataBoostedFreshFtsRowCount: 1,
      metadataBoostedFreshFtsFileCount: 1,
      titleBoostedFreshFtsRowCount: 1,
      titleBoostedFreshFtsFileCount: 1,
      locationBoostedFreshFtsRowCount: 1,
      locationBoostedFreshFtsFileCount: 1,
      staleCurrentScanFtsRowCount: 0,
      staleCurrentScanFtsFileCount: 0,
      outsideCurrentScanFtsRowCount: 0,
      outsideCurrentScanFtsFileCount: 0,
      writeErrorCount: 0,
      searchErrorCount: 0,
      recentHealthEvents: [
        {
          kind: "maintenance_completed",
          createdAt: "2026-05-10T00:00:00.000Z",
          action: "rebuild-derived-indexes",
          status: "repaired",
          userStarted: true,
          backend: "json_stores",
          schemaRevision: 2,
          storeNames: ["filenameIndex", "derivedContentIndex", "parsedDocumentCache"],
          warningCount: 1,
          errorCount: 0,
        },
      ],
    },
    redaction: {
      policy: "snippets_allowed",
      canSendToCopilot: true,
      redactedEvidenceCount: 2,
    },
    quality: {
      schemaVersion: "RelayDocumentSearchQuality.v1",
      coverageConfidence: "high",
      evidenceConfidence: "high",
      freshnessConfidence: "high",
      answerPolicy: "evidence_confirmed",
      canAskCopilotForFinalAnswer: true,
      warnings: [],
    },
    ...overrides,
  };
}

test("Relay document search query trace records deterministic search stages without answer prose", async () => {
  const { module, cleanup } = await loadTraceModule();
  try {
    const trace = module.buildRelayDocumentSearchQueryTrace(traceInput());

    assert.equal(trace.schemaVersion, "RelayDocumentSearchQueryTrace.v1");
    assert.equal(trace.traceId, "trace-query-trace");
    assert.equal(trace.plannerOwner, "relay");
    assert.equal(trace.copilotRole, "optional_language_only");
    assert.deepEqual(
      trace.stages.map((stage) => stage.name),
      [
        "request_validation",
        "query_normalization",
        "index_coordination",
        "index_db",
        "metadata_scan",
        "content_scan",
        "ranking",
        "quality_gate",
      ],
    );
    assert.equal(trace.stages.at(-1).facts.canAskCopilotForFinalAnswer, true);
    assert.equal(trace.stages.at(-1).facts.redactionPolicy, "snippets_allowed");
    assert.deepEqual(trace.stages.at(-1).facts.goldenQueryGate, { enabled: false });
    assert.equal(trace.stages.find((stage) => stage.name === "metadata_scan").facts.filenameIndex.enabled, true);
    const indexDbStage = trace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbStage.state, "completed");
    assert.equal(indexDbStage.facts.readinessStatus, "ready");
    assert.equal(indexDbStage.facts.primaryPathGate.activePath, "sqlite_fts_primary");
    assert.equal(indexDbStage.facts.primaryPathGate.mode, "primary");
    assert.equal(indexDbStage.facts.primaryPathGate.eligible, true);
    assert.equal(indexDbStage.facts.primaryPathGate.rollbackActive, false);
    assert.equal(indexDbStage.facts.schemaReady, true);
    assert.equal(indexDbStage.facts.migrationReady, true);
    assert.equal(indexDbStage.facts.writeReady, true);
    assert.equal(indexDbStage.facts.searchReady, true);
    assert.equal(indexDbStage.facts.evidencePromotionReady, true);
    assert.equal(indexDbStage.facts.schemaGate.status, "ready");
    assert.equal(indexDbStage.facts.schemaGate.componentCount, 2);
    assert.equal(indexDbStage.facts.schemaGate.userStatePreserved, true);
    assert.equal(indexDbStage.facts.schemaGate.componentStatuses[0].name, "metadata_cache");
    assert.equal(indexDbStage.facts.resultUsage.scoredResultCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.promotedResultCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.candidateScoreTotal, 12);
    assert.equal(indexDbStage.facts.resultUsage.returnedScoreTotal, 9);
    assert.equal(indexDbStage.facts.resultUsage.maxCandidateScore, 9);
    assert.equal(indexDbStage.facts.resultUsage.maxReturnedScore, 9);
    assert.equal(indexDbStage.facts.resultUsage.candidateUncappedScoreTotal, 15);
    assert.equal(indexDbStage.facts.resultUsage.returnedUncappedScoreTotal, 12);
    assert.equal(indexDbStage.facts.resultUsage.candidateScoreCapLossTotal, 3);
    assert.equal(indexDbStage.facts.resultUsage.returnedScoreCapLossTotal, 3);
    assert.equal(indexDbStage.facts.resultUsage.scoreCappedCandidateCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.scoreCappedResultCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.nonReturnedScoredCandidateCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.nonReturnedPromotedCandidateCount, 0);
    assert.equal(indexDbStage.facts.resultUsage.nonReturnedScoreTotal, 3);
    assert.equal(indexDbStage.facts.resultUsage.currentScanMatchedFileCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.freshCurrentScanMatchedFileCount, 1);
    assert.equal(indexDbStage.facts.resultUsage.staleCurrentScanMatchedFileCount, 0);
    assert.equal(indexDbStage.facts.resultUsage.outsideCurrentScanMatchedFileCount, 0);
    assert.equal(indexDbStage.facts.currentScanFtsRowCount, 2);
    assert.equal(indexDbStage.facts.currentScanFtsFileCount, 1);
    assert.equal(indexDbStage.facts.freshCurrentScanFtsRowCount, 2);
    assert.equal(indexDbStage.facts.freshCurrentScanFtsFileCount, 1);
    assert.equal(indexDbStage.facts.metadataBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbStage.facts.metadataBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbStage.facts.titleBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbStage.facts.titleBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbStage.facts.locationBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbStage.facts.locationBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbStage.facts.staleCurrentScanFtsRowCount, 0);
    assert.equal(indexDbStage.facts.staleCurrentScanFtsFileCount, 0);
    assert.equal(indexDbStage.facts.outsideCurrentScanFtsRowCount, 0);
    assert.equal(indexDbStage.facts.outsideCurrentScanFtsFileCount, 0);
    assert.equal(indexDbStage.facts.recentHealthEventCount, 1);
    assert.deepEqual(indexDbStage.facts.recentHealthEventKinds, ["maintenance_completed"]);
    assert.equal(indexDbStage.facts.recentHealthEvents[0].action, "rebuild-derived-indexes");
    const rankingStage = trace.stages.find((stage) => stage.name === "ranking");
    assert.equal(rankingStage.facts.scoreBreakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(rankingStage.facts.scoreBreakdown.rankingVersion, "relay-deterministic-ranker-v1");
    assert.equal(rankingStage.facts.scoreBreakdown.componentTotals.sqlite_fts, 9);
    assert.equal(rankingStage.facts.scoreBreakdown.groupingCollapsedCandidateCount, 1);
  } finally {
    cleanup();
  }
});

test("Relay document search query trace marks incomplete searches as partial", async () => {
  const { module, cleanup } = await loadTraceModule();
  try {
    const trace = module.buildRelayDocumentSearchQueryTrace(
      traceInput({
        status: "partial",
        progressStage: "partial_filename_candidates",
        truncated: true,
        contentScan: {
          scannedFiles: 0,
          skippedFiles: 0,
          evidenceFileCount: 0,
          required: true,
          requiredButUnconfirmed: true,
        },
        indexDb: {
          ...traceInput().indexDb,
          readinessStatus: "blocked",
          readinessReasons: ["search_not_ready"],
          searchErrorCount: 1,
          schemaGate: {
            ...traceInput().indexDb.schemaGate,
            status: "read_only",
            readOnlyComponentCount: 1,
            components: [
              { name: "metadata_cache", status: "read_only_downgrade", readOnly: true, rebuildRequired: false },
            ],
          },
        },
        quality: {
          schemaVersion: "RelayDocumentSearchQuality.v1",
          coverageConfidence: "low",
          evidenceConfidence: "low",
          freshnessConfidence: "high",
          answerPolicy: "partial_or_incomplete",
          canAskCopilotForFinalAnswer: false,
          warnings: [
            { code: "content_unconfirmed", severity: "blocker", message: "unconfirmed" },
            { code: "golden_query_regression", severity: "blocker", message: "golden regression" },
          ],
          goldenQueryGate: {
            enabled: true,
            passed: false,
            caseCount: 6,
            failedCaseCount: 1,
            topKCoverage: 0.83,
          },
        },
      }),
    );

    assert.equal(trace.stages.find((stage) => stage.name === "metadata_scan").state, "partial");
    assert.equal(trace.stages.find((stage) => stage.name === "content_scan").state, "partial");
    assert.equal(trace.stages.find((stage) => stage.name === "index_db").state, "partial");
    assert.equal(trace.stages.find((stage) => stage.name === "index_db").facts.schemaGate.status, "read_only");
    assert.equal(
      trace.stages.find((stage) => stage.name === "index_db").facts.schemaGate.componentStatuses[0].readOnly,
      true,
    );
    assert.equal(trace.stages.find((stage) => stage.name === "quality_gate").state, "partial");
    assert.equal(trace.stages.find((stage) => stage.name === "quality_gate").facts.answerPolicy, "partial_or_incomplete");
    assert.deepEqual(
      trace.stages.find((stage) => stage.name === "quality_gate").facts.goldenQueryGate,
      {
        enabled: true,
        passed: false,
        caseCount: 6,
        failedCaseCount: 1,
        topKCoverage: 0.83,
      },
    );
    assert.deepEqual(
      trace.stages.find((stage) => stage.name === "quality_gate").facts.warningCodes,
      ["content_unconfirmed", "golden_query_regression"],
    );
  } finally {
    cleanup();
  }
});
