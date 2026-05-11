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
const supportExportPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSupportExport.ts",
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

async function loadSupportExportModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-support-export-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchSupportExport.mjs"),
    transpile(supportExportPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchSupportExport.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function searchResult() {
  return {
    schemaVersion: "RelayDocumentSearchResult.v1",
    status: "partial",
    progress: { stage: "partial_content_candidates", percent: 100, scannedFiles: 7, skippedFiles: 1 },
    job: { jobId: "job-support-export", lifecycle: "partial", cancellable: false },
    correlation: { relayJobId: "job-support-export", queryId: "query-support-export" },
    queryPlan: {},
    coverage: {
      searchedRoots: ["/workspace"],
      incompleteRoots: ["/workspace"],
      inaccessiblePaths: ["/workspace/private/denied"],
      truncated: false,
      scannedFiles: 7,
      skippedFiles: 1,
      generatedAt: "2026-05-10T00:00:00.000Z",
    },
    results: [
      {
        product_result_contract: "RelayDocumentSearchProductResult.v1",
        result_id: "result-1",
        file_id: "file-1",
        display_name: "report.md",
        path: "/workspace/private/report.md",
        match_mode: "content",
        evidence_state: "content_backed",
        index_state: "content_indexed",
        preview_state: "preview_ready",
        open_state: "open_ready",
        score: 9,
        score_breakdown: {
          score_breakdown_contract: "RelayDocumentSearchScoreBreakdown.v1",
          rankingVersion: "relay-deterministic-ranker-v1",
          deterministic: true,
          sqlite_fts: 9,
          sqlite_fts_uncapped: 12,
          sqlite_fts_cap_loss: 3,
          content: 4,
          table_cell: 0,
          memory: 1,
          base_score: 13,
          warning_penalty: 4,
          final_score: 9,
          components: {
            sqlite_fts: {
              score: 9,
              applied: true,
              reason: "sqlite_fts_match",
              rawScore: 12,
              cappedScore: 9,
              capLoss: 3,
            },
            warning_penalty: {
              score: -4,
              applied: true,
              reason: "warning_confidence_penalty",
              rawScore: 4,
            },
          },
          totals: {
            baseScore: 13,
            penaltyScore: 4,
            finalScore: 9,
            uncappedScore: 16,
            capLoss: 3,
          },
          tieBreakers: ["score", "content_evidence", "file_id"],
          explanationCodes: ["sqlite_fts:content"],
        },
        primary_source_index: "sqlite_fts_index",
        source_indexes: [
          { kind: "sqlite_fts_index", label: "SQLite FTS", state: "used", score: 9 },
        ],
        anchors: [{ type: "text_excerpt", snippet: "SECRET BODY TEXT", source_index: "sqlite_fts_index" }],
        warnings: ["content_unconfirmed"],
        actions: ["preview", "open-file"],
        action_models: [{ kind: "preview", label: "Preview", enabled: true }],
        preview_action: { kind: "preview", enabled: true },
        open_action: { kind: "open_file", enabled: true },
        ui_state: {
          stableSelectionKey: "file-1:v1",
          evidenceLinkable: true,
          answerCitationAllowed: true,
        },
      },
    ],
    evidencePack: {
      evidence: [
        {
          evidence_id: "evidence-1",
          result_id: "result-1",
          file_id: "file-1",
          display_name: "report.md",
          source_index: "sqlite_fts_index",
          citation_allowed: true,
          anchor: {
            type: "text_excerpt",
            source_index: "sqlite_fts_index",
            snippet: "SECRET BODY TEXT",
            location_label: "Body",
          },
        },
        {
          evidence_id: "evidence-2",
          result_id: "result-1",
          file_id: "file-1",
          display_name: "report.md",
          source_index: "derived_content_index",
          citation_allowed: true,
          anchor: {
            type: "text_excerpt",
            source_index: "derived_content_index",
            snippet: "HIDDEN OTHER BODY",
            location_label: "Body",
          },
        },
      ],
      warnings: [{ code: "content_unconfirmed", severity: "warning", message: "candidate" }],
    },
    display: { beginnerSummary: "partial", emptyStateGuidance: [], refineActions: [] },
    diagnostics: {
      executor: "relay-document-search-phase-1-filename",
      fileMetadataOnly: false,
      parsedDocumentsGenerated: 1,
      textContentScanned: 1,
      textContentSkipped: 0,
      contentEvidenceGenerated: 1,
      parsedDocumentCache: {
        enabled: true,
        hits: ["/workspace/private/report.md"],
        misses: ["/workspace/private/missing.md"],
        writes: ["/workspace/private/report.md"],
        writeErrors: [{ path: "/workspace/private/bad.md", message: "disk full" }],
        policy: [
          {
            schemaVersion: "RelayParsedDocumentCachePolicy.v1",
            cacheDir: "/workspace/private/cache/parsed-document-cache",
            mode: "protection_required",
            enabled: true,
            readAllowed: false,
            writeAllowed: false,
            protectionState: "unprotected_plaintext",
            reason: "protection_required_but_unavailable",
          },
        ],
        quota: [
          {
            cacheDir: "/workspace/private/cache/parsed-document-cache",
            entryCount: 10,
            totalBytes: 2048,
            maxCacheEntries: 8,
            maxCacheBytes: 1024,
            quotaPressure: true,
            evicted: [
              {
                path: "/workspace/private/cache/parsed-document-cache/old.json",
                bytes: 512,
                reason: "entry_quota",
                generatedAt: "2026-05-09T00:00:00.000Z",
              },
            ],
            errors: [{ path: "/workspace/private/cache/bad.json", message: "bad cache" }],
          },
        ],
        moveMigration: {
          schemaVersion: "RelayParsedDocumentCacheMoveMigration.v1",
          highConfidenceMoveCount: 1,
          migratedCacheRecordCount: 1,
          skippedMissingCacheCount: 0,
          skippedIncompatibleMoveCount: 0,
        },
      },
      derivedContentIndex: {
        cache: {
          enabled: true,
          hits: ["/workspace/private/report.md"],
          misses: [],
          writes: ["/workspace/private/report.md"],
          writeErrors: [{ path: "/workspace/private/report.md", message: "cache write failed" }],
          policy: [
            {
              schemaVersion: "RelayDocumentSearchDerivedContentIndexCachePolicy.v1",
              cacheDir: "/workspace/private/cache/derived-content-index-cache",
              mode: "protection_required",
              enabled: true,
              readAllowed: true,
              writeAllowed: true,
              protectionState: "externally_protected",
              reason: "externally_protected",
            },
          ],
          quota: [
            {
              cacheDir: "/workspace/private/cache/derived-content-index-cache",
              entryCount: 3,
              totalBytes: 4096,
              maxCacheEntries: 4,
              maxCacheBytes: 8192,
              quotaPressure: false,
              evicted: [
                {
                  path: "/workspace/private/cache/derived-content-index-cache/old-derived.json",
                  bytes: 256,
                  reason: "byte_quota",
                  generatedAt: "2026-05-09T00:00:00.000Z",
                },
              ],
              errors: [],
            },
          ],
        },
      },
      contentIndexCommit: {
        enabled: true,
        attemptedCount: 2,
        committedCount: 1,
        staleFallbackCount: 1,
        failedCount: 0,
        reports: [
          {
            schemaVersion: "RelayDocumentSearchContentIndexCommit.v1",
            status: "committed",
            sourceFileId: "secret-source-file-id",
            active: {
              schemaVersion: "RelayDocumentSearchContentIndexActivePointer.v1",
              state: "active",
              sourceFileId: "secret-source-file-id",
              sourcePath: "/workspace/private/report.md",
              sourceMetadataVersion: "metadata-private-version",
              parsedDocumentUid: "parsed-private-uid",
              parsedDocumentVersion: "RelayParsedDocument.v1",
              parserVersion: "RelayParsedDocumentIr.v1",
              parsedCacheKey: "parsed-secret-cache-key",
              derivedCacheKey: "derived-secret-cache-key",
              searchStoreRowCount: 2,
              ftsRowCount: 2,
              previewSpanCount: 1,
              committedAt: "2026-05-10T00:00:00.000Z",
            },
            warnings: [],
            errors: [],
          },
          {
            schemaVersion: "RelayDocumentSearchContentIndexCommit.v1",
            status: "stale_previous_active",
            sourceFileId: "secret-source-file-id",
            active: {
              schemaVersion: "RelayDocumentSearchContentIndexActivePointer.v1",
              state: "stale",
              sourceFileId: "secret-source-file-id",
              sourcePath: "/workspace/private/report.md",
              sourceMetadataVersion: "metadata-private-version",
              parsedDocumentUid: "parsed-private-uid",
              parsedDocumentVersion: "RelayParsedDocument.v1",
              parserVersion: "RelayParsedDocumentIr.v1",
              parsedCacheKey: "parsed-secret-cache-key",
              derivedCacheKey: "derived-secret-cache-key",
              searchStoreRowCount: 2,
              ftsRowCount: 2,
              previewSpanCount: 1,
              committedAt: "2026-05-10T00:00:00.000Z",
              staleAt: "2026-05-10T00:01:00.000Z",
              lastFailure: {
                failedAt: "2026-05-10T00:01:00.000Z",
                reason: "index_db_write_failed",
                message: "ACTIVE POINTER PRIVATE MESSAGE",
              },
            },
            warnings: ["previous_active_content_index_marked_stale"],
            errors: [],
          },
        ],
        errors: [{ path: "/workspace/private/report.md", message: "ACTIVE POINTER PRIVATE MESSAGE" }],
      },
      indexDb: {
        enabled: true,
        contract: "RelayDocumentSearchIndexDb.v1",
        backend: "sqlite_fts",
        dbPath: "/workspace/private/document-search.sqlite",
        schemaRevision: 2,
        requiredMigrations: ["20260510_preview_spans_anchor_json"],
        appliedMigrations: ["20260510_preview_spans_anchor_json"],
        existingMigrations: [],
        cutoverReadiness: {
          status: "degraded",
          reasons: ["no_fts_evidence_promoted_in_this_query"],
          schemaReady: true,
          migrationReady: true,
          writeReady: true,
          searchReady: true,
          evidencePromotionReady: false,
          debugDbPath: "/workspace/private/cutover-debug.sqlite",
          rawDebugText: "CUTOVER PRIVATE DEBUG",
        },
        primaryPathGate: {
          mode: "primary",
          activePath: "filename_content",
          eligible: false,
          rollbackActive: true,
          reasons: ["primary_rollback_to_filename_content", "readiness_degraded"],
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
          rawDebugText: "PRIMARY GATE PRIVATE DEBUG",
        },
        schemaGate: {
          schemaVersion: "RelayDocumentSearchSchemaMigrationGate.v1",
          status: "read_only",
          componentCount: 2,
          readOnlyComponentCount: 1,
          rebuildRequiredComponentCount: 1,
          invalidComponentCount: 0,
          durableDataPreserved: true,
          userStatePreserved: true,
          components: [
            {
              name: "metadata_cache",
              kind: "durable_store",
              status: "read_only_downgrade",
              currentSchemaVersion: "RelayDocumentSearchMetadataCache.v1",
              detectedSchemaVersion: "RelayDocumentSearchMetadataCache.v99",
              detectedVersion: 99,
              path: "/workspace/private/cache/metadata-cache/newer.json",
              readOnly: true,
              rebuildRequired: false,
              durableDataPreserved: true,
              userStatePreserved: true,
            },
            {
              name: "derived_indexes",
              kind: "rebuildable_store",
              status: "rebuild_required",
              currentSchemaVersion: "RelayDocumentSearchDerivedContentIndex.v1",
              detectedSchemaVersion: "RelayDocumentSearchDerivedContentIndex.v0",
              path: "/workspace/private/cache/derived-content-index-cache/old.json",
              readOnly: false,
              rebuildRequired: true,
              durableDataPreserved: true,
              userStatePreserved: true,
            },
          ],
          warnings: ["SCHEMA GATE PRIVATE WARNING"],
          errors: [],
        },
        resultUsage: {
          candidateCount: 2,
          returnedResultCount: 1,
          searchMatchedFileCount: 1,
          currentScanMatchedFileCount: 1,
          freshCurrentScanMatchedFileCount: 1,
          staleCurrentScanMatchedFileCount: 1,
          outsideCurrentScanMatchedFileCount: 0,
          scoredCandidateCount: 2,
          scoredResultCount: 1,
          promotedCandidateCount: 0,
          promotedResultCount: 0,
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
          debugDbPath: "/workspace/private/result-usage-debug.sqlite",
          rawDebugText: "RESULT USAGE PRIVATE DEBUG",
        },
        promotedEvidenceFileCount: 0,
        staleEvidenceRowCount: 1,
        staleEvidenceReasons: {
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
        writeErrors: [],
        searchErrors: [],
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
            missingTableCount: 0,
            pendingMigrationCount: 0,
            incompleteStagingRecordCount: 2,
            parsedWithoutDerivedRowsCount: 1,
            parsedWithoutPreviewSpanCount: 2,
            walFileBytes: 4096,
            shmFileBytes: 0,
            walCheckpointRecommended: true,
            indexDbRootInvalidatedFileCount: 4,
            indexDbFileInvalidatedFileCount: 2,
            failedFileRetryCandidateCount: 2,
            failedFileRetrySelectedCount: 1,
            failedFileRetryParsedCacheInvalidatedCount: 1,
            failedFileRetryDerivedCacheInvalidatedCount: 1,
            warningCount: 1,
            errorCount: 0,
          },
        ],
        metadataWrite: {
          status: "ready",
          dbPath: "/workspace/private/document-search.sqlite",
          schemaRevision: 2,
          fileMetadataRowCount: 1,
          ftsRowCount: 2,
          previewSpanRowCount: 1,
        },
        derivedWrites: [{ path: "/workspace/private/report.md", status: "ready", ftsRowCount: 2 }],
        search: {
          status: "ready",
          dbPath: "/workspace/private/document-search.sqlite",
          schemaRevision: 2,
          maxRows: 3,
          rowCount: 2,
          rawRowCount: 5,
          droppedRowCount: 3,
          truncated: true,
          matchedFileCount: 1,
          textRowCount: 2,
          tableCellRowCount: 0,
          textRawRowCount: 5,
          tableCellRawRowCount: 0,
        },
      },
      queryTrace: {
        schemaVersion: "RelayDocumentSearchQueryTrace.v1",
        traceId: "trace-query-support-export",
        jobId: "job-support-export",
        queryId: "query-support-export",
        plannerOwner: "relay",
        copilotRole: "optional_language_only",
        status: "partial",
        progressStage: "partial_content_candidates",
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
                reasons: ["primary_rollback_to_filename_content", "readiness_degraded"],
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
                rawDebugText: "PRIMARY GATE TRACE PRIVATE DEBUG",
              },
              schemaReady: true,
              migrationReady: true,
              writeReady: true,
              searchReady: true,
              evidencePromotionReady: false,
              schemaGate: {
                schemaVersion: "RelayDocumentSearchSchemaMigrationGate.v1",
                status: "read_only",
                componentCount: 1,
                readOnlyComponentCount: 1,
                rebuildRequiredComponentCount: 0,
                invalidComponentCount: 0,
                durableDataPreserved: true,
                userStatePreserved: true,
                components: [
                  {
                    name: "metadata_cache",
                    status: "read_only_downgrade",
                    path: "/workspace/private/cache/metadata-cache/newer.json",
                    readOnly: true,
                    rebuildRequired: false,
                  },
                ],
                warnings: ["TRACE SCHEMA PRIVATE WARNING"],
                errors: [],
              },
              resultUsage: {
                searchMatchedFileCount: 1,
                currentScanMatchedFileCount: 1,
                freshCurrentScanMatchedFileCount: 1,
                staleCurrentScanMatchedFileCount: 1,
                outsideCurrentScanMatchedFileCount: 0,
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
                scoredCandidateCount: 2,
                scoredResultCount: 1,
                promotedCandidateCount: 0,
                promotedResultCount: 0,
              },
              staleEvidenceRowCount: 1,
              staleEvidenceReasons: {
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
              searchRawRowCount: 5,
              searchDroppedRowCount: 3,
              searchTruncated: true,
              writeErrorCount: 0,
              searchErrorCount: 0,
              recentHealthEventCount: 1,
              recentHealthEventKinds: ["maintenance_completed"],
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
                  missingTableCount: 0,
                  pendingMigrationCount: 0,
                  incompleteStagingRecordCount: 2,
                  parsedWithoutDerivedRowsCount: 1,
                  parsedWithoutPreviewSpanCount: 2,
                  walFileBytes: 4096,
                  shmFileBytes: 0,
                  walCheckpointRecommended: true,
                  indexDbRootInvalidatedFileCount: 4,
                  indexDbFileInvalidatedFileCount: 2,
                  failedFileRetryCandidateCount: 2,
                  failedFileRetrySelectedCount: 1,
                  failedFileRetryParsedCacheInvalidatedCount: 1,
                  failedFileRetryDerivedCacheInvalidatedCount: 1,
                  warningCount: 1,
                  errorCount: 0,
                },
              ],
            },
          },
        ],
      },
      syncJournal: {
        enabled: true,
        writtenEventCount: 4,
        failedEventCount: 0,
        reconciliation: {
          schemaVersion: "RelayDocumentSearchSyncReconciliation.v1",
          rootCount: 1,
          periodicDueRootCount: 1,
        },
      },
    },
  };
}

test("Relay document search support export is metadata-only by default", async () => {
  const { module, cleanup } = await loadSupportExportModule();
  try {
    const supportExport = module.buildRelayDocumentSearchSupportExport(searchResult(), {
      generatedAt: "2026-05-10T01:00:00.000Z",
    });

    assert.equal(supportExport.schemaVersion, "RelayDocumentSearchSupportExport.v1");
    assert.equal(supportExport.mode, "metadata_only");
    assert.equal(supportExport.source.status, "partial");
    assert.equal(supportExport.results[0].path, "private/report.md");
    assert.equal(supportExport.results[0].score_breakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(supportExport.results[0].score_breakdown.sqlite_fts, 9);
    assert.equal(supportExport.results[0].score_breakdown.components.sqlite_fts.rawScore, 12);
    assert.equal(supportExport.results[0].score_breakdown.components.warning_penalty.rawScore, 4);
    assert.equal(supportExport.results[0].score_breakdown.explanationCodeCount, 1);
    assert.equal(supportExport.evidence.evidenceCount, 2);
    assert.equal(supportExport.diagnostics.cache.parsedDocument.policyDenied, true);
    assert.equal(supportExport.diagnostics.cache.parsedDocument.quotaPressure, true);
    assert.equal(supportExport.diagnostics.cache.parsedDocument.latestQuota.totalBytes, 2048);
    assert.equal(supportExport.diagnostics.cache.parsedDocument.evicted.byReason.entry_quota, 1);
    assert.equal(supportExport.diagnostics.cache.parsedDocument.moveMigration.migratedCacheRecordCount, 1);
    assert.equal(supportExport.diagnostics.cache.derivedContentIndex.writeErrorCount, 1);
    assert.equal(supportExport.diagnostics.cache.derivedContentIndex.policyDenied, false);
    assert.equal(supportExport.diagnostics.cache.derivedContentIndex.latestQuota.totalBytes, 4096);
    assert.equal(supportExport.diagnostics.cache.derivedContentIndex.evicted.byReason.byte_quota, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.enabled, true);
    assert.equal(supportExport.diagnostics.contentIndexCommit.attemptedCount, 2);
    assert.equal(supportExport.diagnostics.contentIndexCommit.committedCount, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.staleFallbackCount, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.reportCount, 2);
    assert.equal(supportExport.diagnostics.contentIndexCommit.warningCount, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.errorCount, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.reportStatuses.committed, 1);
    assert.equal(supportExport.diagnostics.contentIndexCommit.reportStatuses.stale_previous_active, 1);
    assert.equal(supportExport.diagnostics.indexDb.cutoverReadiness.status, "degraded");
    assert.equal(supportExport.diagnostics.indexDb.cutoverReadiness.rawDebugText, undefined);
    assert.equal(supportExport.diagnostics.indexDb.primaryPathGate.mode, "primary");
    assert.equal(supportExport.diagnostics.indexDb.primaryPathGate.activePath, "filename_content");
    assert.equal(supportExport.diagnostics.indexDb.primaryPathGate.eligible, false);
    assert.equal(supportExport.diagnostics.indexDb.primaryPathGate.rollbackActive, true);
    assert.equal(supportExport.diagnostics.indexDb.primaryPathGate.rawDebugText, undefined);
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.status, "read_only");
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.readOnlyComponentCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.rebuildRequiredComponentCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.components[0].name, "metadata_cache");
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.components[0].readOnly, true);
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.components[0].path, undefined);
    assert.equal(supportExport.diagnostics.indexDb.schemaGate.components[0].detectedSchemaVersion, undefined);
    assert.equal(supportExport.diagnostics.indexDb.search.truncated, true);
    assert.equal(supportExport.diagnostics.indexDb.search.droppedRowCount, 3);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.currentScanMatchedFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.freshCurrentScanMatchedFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.staleCurrentScanMatchedFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.outsideCurrentScanMatchedFileCount, 0);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.candidateScoreTotal, 12);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.returnedScoreTotal, 9);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.maxCandidateScore, 9);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.maxReturnedScore, 9);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.candidateUncappedScoreTotal, 15);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.returnedUncappedScoreTotal, 12);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.candidateScoreCapLossTotal, 3);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.returnedScoreCapLossTotal, 3);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.scoreCappedCandidateCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.scoreCappedResultCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.nonReturnedScoredCandidateCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.nonReturnedPromotedCandidateCount, 0);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.nonReturnedScoreTotal, 3);
    assert.equal(supportExport.diagnostics.indexDb.resultUsage.rawDebugText, undefined);
    assert.equal(supportExport.diagnostics.indexDb.staleEvidenceReasons.source_metadata_mismatch, 1);
    assert.equal(supportExport.diagnostics.indexDb.currentScanFtsRowCount, 3);
    assert.equal(supportExport.diagnostics.indexDb.currentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.freshCurrentScanFtsRowCount, 2);
    assert.equal(supportExport.diagnostics.indexDb.freshCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.metadataBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.metadataBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.titleBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.titleBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.locationBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.locationBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.staleCurrentScanFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.staleCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.outsideCurrentScanFtsRowCount, 2);
    assert.equal(supportExport.diagnostics.indexDb.outsideCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEventCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].action, "rebuild-derived-indexes");
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].pendingMigrationCount, 0);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].incompleteStagingRecordCount, 2);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].walCheckpointRecommended, true);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].indexDbRootInvalidatedFileCount, 4);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].indexDbFileInvalidatedFileCount, 2);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].failedFileRetryCandidateCount, 2);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].failedFileRetrySelectedCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].failedFileRetryParsedCacheInvalidatedCount, 1);
    assert.equal(supportExport.diagnostics.indexDb.recentHealthEvents[0].failedFileRetryDerivedCacheInvalidatedCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.readinessStatus, "degraded");
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.primaryPathGate.mode, "primary");
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.primaryPathGate.activePath, "filename_content");
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.primaryPathGate.rollbackActive, true);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.primaryPathGate.rawDebugText, undefined);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.schemaReady, true);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.migrationReady, true);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.writeReady, true);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.searchReady, true);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.evidencePromotionReady, false);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.schemaGate.status, "read_only");
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.schemaGate.readOnlyComponentCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.schemaGate.components[0].path, undefined);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.searchTruncated, true);
    assert.equal(
      supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.currentScanMatchedFileCount,
      1,
    );
    assert.equal(
      supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.freshCurrentScanMatchedFileCount,
      1,
    );
    assert.equal(
      supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.staleCurrentScanMatchedFileCount,
      1,
    );
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.candidateScoreTotal, 12);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.returnedScoreTotal, 9);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.candidateUncappedScoreTotal, 15);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.returnedUncappedScoreTotal, 12);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.candidateScoreCapLossTotal, 3);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.returnedScoreCapLossTotal, 3);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.scoreCappedCandidateCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.scoreCappedResultCount, 1);
    assert.equal(
      supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.nonReturnedScoredCandidateCount,
      1,
    );
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.resultUsage.nonReturnedScoreTotal, 3);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.currentScanFtsRowCount, 3);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.currentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.freshCurrentScanFtsRowCount, 2);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.freshCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.metadataBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.metadataBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.titleBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.titleBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.locationBoostedFreshFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.locationBoostedFreshFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.staleCurrentScanFtsRowCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.staleCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.outsideCurrentScanFtsRowCount, 2);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.outsideCurrentScanFtsFileCount, 1);
    assert.equal(supportExport.diagnostics.queryTrace.stages[0].facts.recentHealthEventCount, 1);
    assert.equal(
      supportExport.diagnostics.queryTrace.stages[0].facts.staleEvidenceReasons.source_metadata_mismatch,
      1,
    );
    const serialized = JSON.stringify(supportExport);
    assert.equal(serialized.includes("SECRET BODY TEXT"), false);
    assert.equal(serialized.includes("HIDDEN OTHER BODY"), false);
    assert.equal(serialized.includes("document-search.sqlite"), false);
    assert.equal(serialized.includes("/workspace/private"), false);
    assert.equal(serialized.includes("parsed-document-cache"), false);
    assert.equal(serialized.includes("derived-content-index-cache"), false);
    assert.equal(serialized.includes("old-derived.json"), false);
    assert.equal(serialized.includes("old.json"), false);
    assert.equal(serialized.includes("secret-source-file-id"), false);
    assert.equal(serialized.includes("parsed-secret-cache-key"), false);
    assert.equal(serialized.includes("derived-secret-cache-key"), false);
    assert.equal(serialized.includes("ACTIVE POINTER PRIVATE MESSAGE"), false);
    assert.equal(serialized.includes("SCHEMA GATE PRIVATE WARNING"), false);
    assert.equal(serialized.includes("TRACE SCHEMA PRIVATE WARNING"), false);
    assert.equal(serialized.includes("RelayDocumentSearchMetadataCache.v99"), false);
    assert.equal(serialized.includes("CUTOVER PRIVATE DEBUG"), false);
    assert.equal(serialized.includes("RESULT USAGE PRIVATE DEBUG"), false);
    assert.equal(serialized.includes("PRIMARY GATE PRIVATE DEBUG"), false);
    assert.equal(serialized.includes("PRIMARY GATE TRACE PRIVATE DEBUG"), false);
  } finally {
    cleanup();
  }
});

test("Relay document search support export includes only explicitly selected snippets", async () => {
  const { module, cleanup } = await loadSupportExportModule();
  try {
    const supportExport = module.buildRelayDocumentSearchSupportExport(searchResult(), {
      mode: "include_selected_evidence_snippets",
      selectedEvidenceIds: ["evidence-1"],
      generatedAt: "2026-05-10T01:00:00.000Z",
    });

    assert.equal(supportExport.redaction.snippetsIncluded, true);
    const serialized = JSON.stringify(supportExport);
    assert.equal(serialized.includes("SECRET BODY TEXT"), true);
    assert.equal(serialized.includes("HIDDEN OTHER BODY"), false);
    assert.equal(serialized.includes("document-search.sqlite"), false);
  } finally {
    cleanup();
  }
});
