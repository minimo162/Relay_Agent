import type { RelayDocumentSearchRequestV1, RelayDocumentSearchStatus } from './relayDocumentSearchContract';
import type { RelayDocumentSearchQualityReport } from './relayDocumentSearchQualityGates';
import type { RelayDocumentSearchQueryPlanV1 } from './relayDocumentSearchQueryPlan';

export const RELAY_DOCUMENT_SEARCH_QUERY_TRACE_CONTRACT = 'RelayDocumentSearchQueryTrace.v1';

export type RelayDocumentSearchTraceStage = {
  name:
    | 'request_validation'
    | 'query_normalization'
    | 'index_coordination'
    | 'index_db'
    | 'metadata_scan'
    | 'content_scan'
    | 'ranking'
    | 'quality_gate';
  state: 'completed' | 'partial' | 'skipped';
  facts: Record<string, unknown>;
};

export type RelayDocumentSearchQueryTraceV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_TRACE_CONTRACT;
  traceId: string;
  jobId: string;
  queryId?: string;
  generatedAt: string;
  plannerOwner: 'relay';
  copilotRole: 'optional_language_only';
  status: RelayDocumentSearchStatus;
  progressStage: string;
  stages: RelayDocumentSearchTraceStage[];
};

export type RelayDocumentSearchQueryTraceInput = {
  request: RelayDocumentSearchRequestV1;
  queryPlan: RelayDocumentSearchQueryPlanV1;
  jobId: string;
  queryId?: string;
  generatedAt: string;
  status: RelayDocumentSearchStatus;
  progressStage: string;
  searchedRoots: string[];
  maxScanFiles: number;
  maxContentInspectFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  inaccessiblePathCount: number;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  metadataCache: {
    hits: string[];
    misses: string[];
    writes: string[];
    writeErrors: unknown[];
  };
  filenameIndex: {
    enabled: boolean;
    mode: string;
    inMemoryFileCount: number;
    inMemoryTermCount: number;
    searchHitCount: number;
    readHits: string[];
    readMisses: string[];
    writes: string[];
    writeErrors: unknown[];
  };
  contentScan: {
    scannedFiles: number;
    skippedFiles: number;
    evidenceFileCount: number;
    required: boolean;
    requiredButUnconfirmed: boolean;
  };
  ranking: {
    candidateCount: number;
    returnedCount: number;
    collapsedCandidateCount?: number;
    userMemoryBoostedFileCount?: number;
    warningPenaltyAppliedCount?: number;
    warningPenaltyTotal?: number;
    scoreBreakdown?: {
      score_breakdown_contract?: string;
      rankingVersion?: string;
      deterministic?: boolean;
      candidateCount?: number;
      returnedCount?: number;
      activePath?: string;
      componentTotals?: Record<string, number>;
      warningPenaltyTotal?: number;
      groupingCollapsedCandidateCount?: number;
      hybridMergeMode?: string;
    };
    perDirectoryLimit: number;
    uniqueDirectoryCount: number;
    deferredCandidateCount: number;
  };
  indexCoordinator: {
    enabled: boolean;
    acquired: boolean;
    busy: boolean;
    events: Array<{ kind?: string }>;
  };
  indexDb?: {
    enabled: boolean;
    backend: string;
    dbPath?: string;
    schemaRevision?: number;
    readinessStatus: 'disabled' | 'ready' | 'degraded' | 'blocked';
    readinessReasons: string[];
    primaryPathGate?: {
      mode?: string;
      activePath?: string;
      eligible?: boolean;
      rollbackActive?: boolean;
      reasons?: string[];
      thresholds?: Record<string, unknown>;
    };
    schemaReady: boolean;
    migrationReady: boolean;
    writeReady: boolean;
    searchReady: boolean;
    evidencePromotionReady: boolean;
    schemaGate?: {
      schemaVersion?: string;
      status?: string;
      componentCount?: number;
      readOnlyComponentCount?: number;
      rebuildRequiredComponentCount?: number;
      invalidComponentCount?: number;
      durableDataPreserved?: boolean;
      userStatePreserved?: boolean;
      components?: Array<{
        name?: string;
        status?: string;
        readOnly?: boolean;
        rebuildRequired?: boolean;
      }>;
    };
    resultUsage: {
      candidateCount: number;
      returnedResultCount: number;
      searchMatchedFileCount: number;
      currentScanMatchedFileCount: number;
      freshCurrentScanMatchedFileCount: number;
      staleCurrentScanMatchedFileCount: number;
      outsideCurrentScanMatchedFileCount: number;
      scoredCandidateCount: number;
      scoredResultCount: number;
      promotedCandidateCount: number;
      promotedResultCount: number;
      candidateScoreTotal: number;
      maxCandidateScore: number;
      returnedScoreTotal: number;
      maxReturnedScore: number;
      candidateUncappedScoreTotal: number;
      returnedUncappedScoreTotal: number;
      candidateScoreCapLossTotal: number;
      returnedScoreCapLossTotal: number;
      scoreCappedCandidateCount: number;
      scoreCappedResultCount: number;
      nonReturnedScoredCandidateCount: number;
      nonReturnedPromotedCandidateCount: number;
      nonReturnedScoreTotal: number;
      scoreTotal: number;
      maxScore: number;
    };
    staleEvidenceRowCount: number;
    staleEvidenceReasons?: Record<string, number>;
    currentScanFtsRowCount: number;
    currentScanFtsFileCount: number;
    freshCurrentScanFtsRowCount: number;
    freshCurrentScanFtsFileCount: number;
    metadataBoostedFreshFtsRowCount: number;
    metadataBoostedFreshFtsFileCount: number;
    titleBoostedFreshFtsRowCount: number;
    titleBoostedFreshFtsFileCount: number;
    locationBoostedFreshFtsRowCount: number;
    locationBoostedFreshFtsFileCount: number;
    staleCurrentScanFtsRowCount: number;
    staleCurrentScanFtsFileCount: number;
    outsideCurrentScanFtsRowCount: number;
    outsideCurrentScanFtsFileCount: number;
    searchMaxRows?: number;
    searchRawRowCount?: number;
    searchDroppedRowCount?: number;
    searchTruncated?: boolean;
    writeErrorCount: number;
    searchErrorCount: number;
    recentHealthEvents?: Array<{
      kind?: string;
      createdAt?: string;
      jobId?: string;
      action?: string;
      status?: string;
      automatic?: boolean;
      userStarted?: boolean;
      backend?: string;
      indexDbStatus?: string;
      sqliteFtsEnabled?: boolean;
      schemaRevision?: number;
      storeNames?: string[];
      storeCount?: number;
      checkCount?: number;
      invalidJsonFileCount?: number;
      warningCount?: number;
      errorCount?: number;
    }>;
    healthEventReadError?: string;
  };
  redaction: {
    policy: string;
    canSendToCopilot: boolean;
    redactedEvidenceCount: number;
  };
  quality: RelayDocumentSearchQualityReport;
};

function traceId(jobId: string, queryId?: string): string {
  return `trace-${queryId || jobId}`;
}

function stateFromPartial(...flags: boolean[]): RelayDocumentSearchTraceStage['state'] {
  return flags.some(Boolean) ? 'partial' : 'completed';
}

function indexDbTraceState(indexDb?: RelayDocumentSearchQueryTraceInput['indexDb']): RelayDocumentSearchTraceStage['state'] {
  if (!indexDb?.enabled) return 'skipped';
  return indexDb.readinessStatus === 'ready' ? 'completed' : 'partial';
}

function indexDbTraceFacts(indexDb?: RelayDocumentSearchQueryTraceInput['indexDb']): Record<string, unknown> {
  const recentHealthEvents = indexDb?.recentHealthEvents ?? [];
  const schemaGate = indexDb?.schemaGate;
  return {
    enabled: Boolean(indexDb?.enabled),
    backend: indexDb?.backend ?? 'disabled',
    dbPath: indexDb?.dbPath,
    schemaRevision: indexDb?.schemaRevision,
    readinessStatus: indexDb?.readinessStatus ?? 'disabled',
    readinessReasons: indexDb?.readinessReasons ?? [],
    primaryPathGate: indexDb?.primaryPathGate ?? {
      mode: 'disabled',
      activePath: indexDb?.enabled ? 'filename_content' : 'disabled',
      eligible: false,
      rollbackActive: false,
      reasons: indexDb?.enabled ? ['primary_gate_unavailable'] : ['index_db_disabled'],
      thresholds: {},
    },
    schemaReady: indexDb?.schemaReady ?? false,
    migrationReady: indexDb?.migrationReady ?? false,
    writeReady: indexDb?.writeReady ?? false,
    searchReady: indexDb?.searchReady ?? false,
    evidencePromotionReady: indexDb?.evidencePromotionReady ?? false,
    schemaGate: schemaGate
      ? {
          schemaVersion: schemaGate.schemaVersion,
          status: schemaGate.status,
          componentCount: schemaGate.componentCount ?? 0,
          readOnlyComponentCount: schemaGate.readOnlyComponentCount ?? 0,
          rebuildRequiredComponentCount: schemaGate.rebuildRequiredComponentCount ?? 0,
          invalidComponentCount: schemaGate.invalidComponentCount ?? 0,
          durableDataPreserved: Boolean(schemaGate.durableDataPreserved),
          userStatePreserved: Boolean(schemaGate.userStatePreserved),
          componentStatuses: (schemaGate.components ?? []).map((component) => ({
            name: component.name,
            status: component.status,
            readOnly: Boolean(component.readOnly),
            rebuildRequired: Boolean(component.rebuildRequired),
          })),
        }
      : undefined,
    resultUsage: indexDb?.resultUsage ?? {
      candidateCount: 0,
      returnedResultCount: 0,
      searchMatchedFileCount: 0,
      currentScanMatchedFileCount: 0,
      freshCurrentScanMatchedFileCount: 0,
      staleCurrentScanMatchedFileCount: 0,
      outsideCurrentScanMatchedFileCount: 0,
      scoredCandidateCount: 0,
      scoredResultCount: 0,
      promotedCandidateCount: 0,
      promotedResultCount: 0,
      candidateScoreTotal: 0,
      maxCandidateScore: 0,
      returnedScoreTotal: 0,
      maxReturnedScore: 0,
      candidateUncappedScoreTotal: 0,
      returnedUncappedScoreTotal: 0,
      candidateScoreCapLossTotal: 0,
      returnedScoreCapLossTotal: 0,
      scoreCappedCandidateCount: 0,
      scoreCappedResultCount: 0,
      nonReturnedScoredCandidateCount: 0,
      nonReturnedPromotedCandidateCount: 0,
      nonReturnedScoreTotal: 0,
      scoreTotal: 0,
      maxScore: 0,
    },
    staleEvidenceRowCount: indexDb?.staleEvidenceRowCount ?? 0,
    staleEvidenceReasons: indexDb?.staleEvidenceReasons ?? {},
    currentScanFtsRowCount: indexDb?.currentScanFtsRowCount ?? 0,
    currentScanFtsFileCount: indexDb?.currentScanFtsFileCount ?? 0,
    freshCurrentScanFtsRowCount: indexDb?.freshCurrentScanFtsRowCount ?? 0,
    freshCurrentScanFtsFileCount: indexDb?.freshCurrentScanFtsFileCount ?? 0,
    metadataBoostedFreshFtsRowCount: indexDb?.metadataBoostedFreshFtsRowCount ?? 0,
    metadataBoostedFreshFtsFileCount: indexDb?.metadataBoostedFreshFtsFileCount ?? 0,
    titleBoostedFreshFtsRowCount: indexDb?.titleBoostedFreshFtsRowCount ?? 0,
    titleBoostedFreshFtsFileCount: indexDb?.titleBoostedFreshFtsFileCount ?? 0,
    locationBoostedFreshFtsRowCount: indexDb?.locationBoostedFreshFtsRowCount ?? 0,
    locationBoostedFreshFtsFileCount: indexDb?.locationBoostedFreshFtsFileCount ?? 0,
    staleCurrentScanFtsRowCount: indexDb?.staleCurrentScanFtsRowCount ?? 0,
    staleCurrentScanFtsFileCount: indexDb?.staleCurrentScanFtsFileCount ?? 0,
    outsideCurrentScanFtsRowCount: indexDb?.outsideCurrentScanFtsRowCount ?? 0,
    outsideCurrentScanFtsFileCount: indexDb?.outsideCurrentScanFtsFileCount ?? 0,
    searchMaxRows: indexDb?.searchMaxRows,
    searchRawRowCount: indexDb?.searchRawRowCount,
    searchDroppedRowCount: indexDb?.searchDroppedRowCount,
    searchTruncated: Boolean(indexDb?.searchTruncated),
    writeErrorCount: indexDb?.writeErrorCount ?? 0,
    searchErrorCount: indexDb?.searchErrorCount ?? 0,
    recentHealthEventCount: recentHealthEvents.length,
    recentHealthEventKinds: recentHealthEvents.map((event) => event.kind).filter(Boolean),
    recentHealthEvents,
    healthEventReadError: indexDb?.healthEventReadError,
  };
}

export function buildRelayDocumentSearchQueryTrace(
  input: RelayDocumentSearchQueryTraceInput,
): RelayDocumentSearchQueryTraceV1 {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_QUERY_TRACE_CONTRACT,
    traceId: traceId(input.jobId, input.queryId),
    jobId: input.jobId,
    queryId: input.queryId,
    generatedAt: input.generatedAt,
    plannerOwner: 'relay',
    copilotRole: 'optional_language_only',
    status: input.status,
    progressStage: input.progressStage,
    stages: [
      {
        name: 'request_validation',
        state: 'completed',
        facts: {
          intent: input.request.intent,
          thoroughness: input.request.thoroughness,
          evidence: input.request.evidence,
          requestedFileTypes: input.request.fileTypes,
          rootCount: input.searchedRoots.length,
          maxResults: input.request.maxResults,
        },
      },
      {
        name: 'query_normalization',
        state: 'completed',
        facts: {
          normalizerVersion: input.queryPlan.normalizerVersion,
          mode: input.queryPlan.mode,
          normalizedTermCount: input.queryPlan.normalizedTerms.length,
          normalizedTerms: input.queryPlan.normalizedTerms,
          synonymSources: input.queryPlan.synonymExpansions.map((expansion) => expansion.source),
          periodHints: input.queryPlan.periodHints,
          fileTypeHints: input.queryPlan.fileTypeHints,
          rejectedTokens: input.queryPlan.rejectedTokens,
          confirmationPolicy: input.queryPlan.confirmationPolicy,
        },
      },
      {
        name: 'index_coordination',
        state: input.indexCoordinator.enabled ? (input.indexCoordinator.busy ? 'partial' : 'completed') : 'skipped',
        facts: {
          enabled: input.indexCoordinator.enabled,
          acquired: input.indexCoordinator.acquired,
          busy: input.indexCoordinator.busy,
          eventKinds: input.indexCoordinator.events.map((event) => event.kind).filter(Boolean),
        },
      },
      {
        name: 'index_db',
        state: indexDbTraceState(input.indexDb),
        facts: indexDbTraceFacts(input.indexDb),
      },
      {
        name: 'metadata_scan',
        state: stateFromPartial(input.truncated, input.cancelled, input.timedOut, input.inaccessiblePathCount > 0),
        facts: {
          searchedRoots: input.searchedRoots,
          maxScanFiles: input.maxScanFiles,
          scannedFiles: input.scannedFiles,
          skippedFiles: input.skippedFiles,
          inaccessiblePathCount: input.inaccessiblePathCount,
          truncated: input.truncated,
          cancelled: input.cancelled,
          timedOut: input.timedOut,
          cacheHits: input.metadataCache.hits.length,
          cacheMisses: input.metadataCache.misses.length,
          cacheWrites: input.metadataCache.writes.length,
          cacheWriteErrors: input.metadataCache.writeErrors.length,
          filenameIndex: {
            enabled: input.filenameIndex.enabled,
            mode: input.filenameIndex.mode,
            inMemoryFileCount: input.filenameIndex.inMemoryFileCount,
            inMemoryTermCount: input.filenameIndex.inMemoryTermCount,
            searchHitCount: input.filenameIndex.searchHitCount,
            readHits: input.filenameIndex.readHits.length,
            readMisses: input.filenameIndex.readMisses.length,
            writes: input.filenameIndex.writes.length,
            writeErrors: input.filenameIndex.writeErrors.length,
          },
        },
      },
      {
        name: 'content_scan',
        state: input.contentScan.requiredButUnconfirmed
          ? 'partial'
          : input.contentScan.scannedFiles > 0
            ? 'completed'
            : 'skipped',
        facts: {
          required: input.contentScan.required,
          maxContentInspectFiles: input.maxContentInspectFiles,
          scannedFiles: input.contentScan.scannedFiles,
          skippedFiles: input.contentScan.skippedFiles,
          evidenceFileCount: input.contentScan.evidenceFileCount,
          requiredButUnconfirmed: input.contentScan.requiredButUnconfirmed,
        },
      },
      {
        name: 'ranking',
        state: 'completed',
        facts: {
          candidateCount: input.ranking.candidateCount,
          returnedCount: input.ranking.returnedCount,
          collapsedCandidateCount: input.ranking.collapsedCandidateCount ?? 0,
          userMemoryBoostedFileCount: input.ranking.userMemoryBoostedFileCount ?? 0,
          warningPenaltyAppliedCount: input.ranking.warningPenaltyAppliedCount ?? 0,
          warningPenaltyTotal: input.ranking.warningPenaltyTotal ?? 0,
          scoreBreakdown: input.ranking.scoreBreakdown ?? {
            score_breakdown_contract: 'RelayDocumentSearchScoreBreakdown.v1',
            deterministic: true,
            componentTotals: {},
          },
          directoryDiversity: {
            perDirectoryLimit: input.ranking.perDirectoryLimit,
            uniqueDirectoryCount: input.ranking.uniqueDirectoryCount,
            deferredCandidateCount: input.ranking.deferredCandidateCount,
          },
        },
      },
      {
        name: 'quality_gate',
        state: input.quality.canAskCopilotForFinalAnswer ? 'completed' : 'partial',
        facts: {
          coverageConfidence: input.quality.coverageConfidence,
          evidenceConfidence: input.quality.evidenceConfidence,
          freshnessConfidence: input.quality.freshnessConfidence,
          answerPolicy: input.quality.answerPolicy,
          canAskCopilotForFinalAnswer: input.quality.canAskCopilotForFinalAnswer,
          redactionPolicy: input.redaction.policy,
          redactionAllowsCopilot: input.redaction.canSendToCopilot,
          redactedEvidenceCount: input.redaction.redactedEvidenceCount,
          warningCodes: input.quality.warnings.map((warning) => warning.code),
          goldenQueryGate: input.quality.goldenQueryGate ?? { enabled: false },
        },
      },
    ],
  };
}
