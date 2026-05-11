/**
 * Metadata-only support export for Relay Document Search.
 *
 * The export is intentionally previewable and content-minimizing: original
 * files, raw databases, DB paths, full extracted text, and snippets are omitted
 * unless the caller explicitly selects evidence snippets.
 */

import {
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  validateRelayDocumentSearchResult,
  type RelayDocumentSearchResultV1,
} from './relayDocumentSearchContract';

export const RELAY_DOCUMENT_SEARCH_SUPPORT_EXPORT_CONTRACT = 'RelayDocumentSearchSupportExport.v1' as const;

export type RelayDocumentSearchSupportExportMode = 'metadata_only' | 'include_selected_evidence_snippets';

export type RelayDocumentSearchSupportExportOptions = {
  mode?: RelayDocumentSearchSupportExportMode;
  selectedEvidenceIds?: string[];
  generatedAt?: Date | string;
};

export type RelayDocumentSearchSupportExportV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SUPPORT_EXPORT_CONTRACT;
  sourceSchemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT;
  generatedAt: string;
  mode: RelayDocumentSearchSupportExportMode;
  source: {
    status: string;
    jobId?: string;
    queryId?: string;
    progressStage?: string;
    validationOk: boolean;
    validationErrors: string[];
  };
  redaction: {
    originalFilesIncluded: false;
    rawDatabasesIncluded: false;
    dbPathsIncluded: false;
    fullExtractedTextIncluded: false;
    snippetsIncluded: boolean;
    pathPolicy: 'root_relative_or_basename';
  };
  coverage: Record<string, unknown>;
  results: Array<Record<string, unknown>>;
  evidence: {
    evidenceCount: number;
    exportedEvidenceCount: number;
    selectedEvidenceIds: string[];
    items: Array<Record<string, unknown>>;
    warnings: Array<Record<string, unknown>>;
  };
  diagnostics: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const result = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
  );
  return Object.keys(result).length ? result : undefined;
}

function indexDbCutoverReadinessSummary(value: unknown): Record<string, unknown> | undefined {
  const source = isRecord(value) ? value : undefined;
  if (!source) return undefined;
  const summary = primitivePick(source, [
    'status',
    'schemaReady',
    'migrationReady',
    'writeReady',
    'searchReady',
    'evidencePromotionReady',
  ]) ?? {};
  const reasons = asStringArray(source.reasons);
  if (reasons.length) summary.reasons = reasons;
  return Object.keys(summary).length ? summary : undefined;
}

function indexDbPrimaryPathGateSummary(value: unknown): Record<string, unknown> | undefined {
  const source = isRecord(value) ? value : undefined;
  if (!source) return undefined;
  const summary = primitivePick(source, [
    'mode',
    'activePath',
    'eligible',
    'rollbackActive',
  ]) ?? {};
  const reasons = asStringArray(source.reasons);
  if (reasons.length) summary.reasons = reasons;
  if (isRecord(source.thresholds)) {
    summary.thresholds = primitivePick(source.thresholds, [
      'readinessStatus',
      'searchTruncated',
      'maxStaleEvidenceRows',
      'maxOutsideCurrentScanRows',
      'maxWriteErrors',
      'maxSearchErrors',
      'minFreshCurrentScanFtsFiles',
      'minFreshCurrentScanFtsRows',
    ]);
  }
  return Object.keys(summary).length ? summary : undefined;
}

function indexDbResultUsageSummary(value: unknown): Record<string, number> | undefined {
  const source = isRecord(value) ? value : undefined;
  if (!source) return undefined;
  const keys = [
    'candidateCount',
    'returnedResultCount',
    'searchMatchedFileCount',
    'currentScanMatchedFileCount',
    'freshCurrentScanMatchedFileCount',
    'staleCurrentScanMatchedFileCount',
    'outsideCurrentScanMatchedFileCount',
    'scoredCandidateCount',
    'scoredResultCount',
    'promotedCandidateCount',
    'promotedResultCount',
    'candidateScoreTotal',
    'maxCandidateScore',
    'returnedScoreTotal',
    'maxReturnedScore',
    'candidateUncappedScoreTotal',
    'returnedUncappedScoreTotal',
    'candidateScoreCapLossTotal',
    'returnedScoreCapLossTotal',
    'scoreCappedCandidateCount',
    'scoreCappedResultCount',
    'nonReturnedScoredCandidateCount',
    'nonReturnedPromotedCandidateCount',
    'nonReturnedScoreTotal',
    'scoreTotal',
    'maxScore',
  ];
  const result: Record<string, number> = {};
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

function schemaGateSummary(value: unknown): Record<string, unknown> | undefined {
  const source = isRecord(value) ? value : undefined;
  if (!source) return undefined;
  const components = Array.isArray(source.components)
    ? source.components
      .filter(isRecord)
      .map((component) => primitivePick(component, [
        'name',
        'kind',
        'status',
        'readOnly',
        'rebuildRequired',
        'durableDataPreserved',
        'userStatePreserved',
      ]))
      .filter((component): component is Record<string, unknown> => Boolean(component))
    : [];
  return {
    schemaVersion: asString(source.schemaVersion),
    status: asString(source.status),
    componentCount: asNumber(source.componentCount) ?? components.length,
    readOnlyComponentCount: asNumber(source.readOnlyComponentCount) ?? 0,
    rebuildRequiredComponentCount: asNumber(source.rebuildRequiredComponentCount) ?? 0,
    invalidComponentCount: asNumber(source.invalidComponentCount) ?? 0,
    durableDataPreserved: Boolean(source.durableDataPreserved),
    userStatePreserved: Boolean(source.userStatePreserved),
    components,
    warningCount: Array.isArray(source.warnings) ? source.warnings.length : 0,
    errorCount: Array.isArray(source.errors) ? source.errors.length : 0,
  };
}

function healthEventSummary(event: unknown): Record<string, unknown> | undefined {
  const source = isRecord(event) ? event : undefined;
  if (!source) return undefined;
  const summary = primitivePick(source, [
    'kind',
    'createdAt',
    'jobId',
    'action',
    'status',
    'automatic',
    'userStarted',
    'backend',
    'indexDbStatus',
    'sqliteFtsEnabled',
    'schemaRevision',
    'detectedSchemaRevision',
    'schemaGateStatus',
    'schemaGateComponentCount',
    'schemaGateReadOnlyComponentCount',
    'schemaGateRebuildRequiredComponentCount',
    'schemaGateInvalidComponentCount',
    'durableDataPreserved',
    'userStatePreserved',
    'storeCount',
    'checkCount',
    'invalidJsonFileCount',
    'missingTableCount',
    'incompleteStagingRecordCount',
    'parsedWithoutDerivedRowsCount',
    'parsedWithoutPreviewSpanCount',
    'walFileBytes',
    'shmFileBytes',
    'walCheckpointRecommended',
    'pendingMigrationCount',
    'indexDbRootInvalidatedFileCount',
    'indexDbFileInvalidatedFileCount',
    'failedFileRetryCandidateCount',
    'failedFileRetrySelectedCount',
    'failedFileRetryParsedCacheInvalidatedCount',
    'failedFileRetryDerivedCacheInvalidatedCount',
    'warningCount',
    'errorCount',
  ]) ?? {};
  const storeNames = asStringArray(source.storeNames);
  if (storeNames.length) summary.storeNames = storeNames;
  return Object.keys(summary).length ? summary : undefined;
}

function healthEventsSummary(events: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(events)) return [];
  return events
    .slice(-12)
    .map(healthEventSummary)
    .filter((event): event is Record<string, unknown> => Boolean(event));
}

function generatedAt(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return new Date().toISOString();
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function basename(value: string): string {
  const normalized = normalizePathSeparators(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function redactedPath(value: unknown, roots: string[]): string | undefined {
  const path = asString(value);
  if (!path) return undefined;
  const normalizedPath = normalizePathSeparators(path);
  const normalizedRoots = roots.map(normalizePathSeparators).filter(Boolean).sort((a, b) => b.length - a.length);
  const root = normalizedRoots.find((candidate) => normalizedPath === candidate || normalizedPath.startsWith(`${candidate}/`));
  if (!root) return basename(normalizedPath);
  if (normalizedPath === root) return '.';
  return normalizedPath.slice(root.length + 1) || basename(normalizedPath);
}

function selectedEvidenceIds(options: RelayDocumentSearchSupportExportOptions): string[] {
  return [...new Set(asStringArray(options.selectedEvidenceIds))];
}

function snippetAllowed(
  mode: RelayDocumentSearchSupportExportMode,
  evidenceId: string,
  selectedIds: Set<string>,
): boolean {
  return mode === 'include_selected_evidence_snippets' && selectedIds.has(evidenceId);
}

function boundedSnippet(value: unknown): string | undefined {
  const snippet = asString(value);
  if (!snippet) return undefined;
  return snippet.length > 500 ? `${snippet.slice(0, 500)}...` : snippet;
}

function anchorLocation(anchor: unknown, includeSnippet: boolean): Record<string, unknown> | undefined {
  const source = isRecord(anchor) ? anchor : undefined;
  if (!source) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of [
    'type',
    'source_index',
    'preview_anchor_contract',
    'anchor_confidence',
    'sheet',
    'cell',
    'slide',
    'paragraph',
    'paragraphIndex',
    'table_id',
    'tableId',
    'rowIndex',
    'columnIndex',
    'location_label',
    'title',
  ]) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  if (includeSnippet) {
    const snippet = boundedSnippet(source.snippet ?? source.preview_text);
    if (snippet) result.snippet = snippet;
  }
  return Object.keys(result).length ? result : undefined;
}

function primitivePick(source: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function warningSummary(warning: unknown): Record<string, unknown> | undefined {
  return primitivePick(warning, ['code', 'severity', 'message', 'count']);
}

function sourceIndexSummary(sourceIndex: unknown): Record<string, unknown> | undefined {
  return primitivePick(sourceIndex, ['kind', 'label', 'state', 'score', 'reason']);
}

function scoreComponentSummary(component: unknown): Record<string, unknown> | undefined {
  const source = isRecord(component) ? component : undefined;
  if (!source) return undefined;
  const summary = primitivePick(source, [
    'score',
    'applied',
    'reason',
    'rawScore',
    'cappedScore',
    'capLoss',
    'count',
  ]) ?? {};
  if (isRecord(source.details)) {
    const details = primitivePick(source.details, [
      'activePath',
      'filenamePathKeywordScore',
      'contentScore',
      'sqliteFtsScore',
      'pinHistoryScore',
      'memberCount',
      'collapsedCount',
      'modifiedTimePresent',
    ]);
    if (details) summary.details = details;
  }
  return Object.keys(summary).length ? summary : undefined;
}

function scoreBreakdownSummary(scoreBreakdown: unknown): Record<string, unknown> | undefined {
  const source = isRecord(scoreBreakdown) ? scoreBreakdown : undefined;
  if (!source) return undefined;
  const components = isRecord(source.components)
    ? Object.fromEntries(
        Object.entries(source.components)
          .map(([key, component]) => [key, scoreComponentSummary(component)])
          .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1])),
      )
    : {};
  const summary = primitivePick(source, [
    'score_breakdown_contract',
    'schemaVersion',
    'rankingVersion',
    'deterministic',
    'filename_score',
    'path_score',
    'term_score',
    'sqlite_fts',
    'sqlite_fts_uncapped',
    'sqlite_fts_cap_loss',
    'content',
    'table_cell',
    'recency',
    'memory',
    'pin_history',
    'grouping',
    'hybrid_merge',
    'base_score',
    'warning_penalty',
    'final_score',
  ]) ?? {};
  const totals = primitivePick(source.totals, [
    'baseScore',
    'penaltyScore',
    'finalScore',
    'uncappedScore',
    'capLoss',
  ]);
  if (totals) summary.totals = totals;
  if (Object.keys(components).length) summary.components = components;
  const tieBreakers = asStringArray(source.tieBreakers);
  if (tieBreakers.length) summary.tieBreakers = tieBreakers;
  if (Array.isArray(source.explanationCodes)) summary.explanationCodeCount = source.explanationCodes.length;
  return Object.keys(summary).length ? summary : undefined;
}

function resultSummary(result: unknown, roots: string[]): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined;
  const summary = primitivePick(result, [
    'result_id',
    'file_id',
    'display_name',
    'match_mode',
    'evidence_state',
    'index_state',
    'preview_state',
    'open_state',
    'primary_source_index',
    'score',
    'folder_role',
  ]) ?? {};
  const path = redactedPath(result.path, roots);
  if (path) summary.path = path;
  const sourceIndexes = Array.isArray(result.source_indexes)
    ? result.source_indexes.map(sourceIndexSummary).filter(Boolean)
    : [];
  if (sourceIndexes.length) summary.source_indexes = sourceIndexes;
  const scores = scoreBreakdownSummary(result.score_breakdown);
  if (scores) summary.score_breakdown = scores;
  const warnings = asStringArray(result.warnings);
  if (warnings.length) summary.warnings = warnings;
  const anchors = Array.isArray(result.anchors)
    ? result.anchors.map((anchor) => anchorLocation(anchor, false)).filter(Boolean)
    : [];
  if (anchors.length) summary.anchors = anchors;
  return summary;
}

function evidenceItemSummary(
  evidence: unknown,
  mode: RelayDocumentSearchSupportExportMode,
  selectedIds: Set<string>,
): Record<string, unknown> | undefined {
  if (!isRecord(evidence)) return undefined;
  const evidenceId = asString(evidence.evidence_id);
  const includeSnippet = snippetAllowed(mode, evidenceId, selectedIds);
  const summary = primitivePick(evidence, [
    'evidence_id',
    'result_id',
    'file_id',
    'display_name',
    'source_index',
    'citation_allowed',
    'parser_version',
    'parsed_document_uid',
  ]) ?? {};
  const anchor = anchorLocation(evidence.anchor, includeSnippet);
  if (anchor) summary.anchor = anchor;
  return Object.keys(summary).length ? summary : undefined;
}

function coverageSummary(coverage: unknown): Record<string, unknown> {
  const source = isRecord(coverage) ? coverage : {};
  const searchedRoots = asStringArray(source.searchedRoots);
  const inaccessiblePaths = Array.isArray(source.inaccessiblePaths) ? source.inaccessiblePaths : [];
  return {
    rootCount: searchedRoots.length,
    incompleteRootCount: asStringArray(source.incompleteRoots).length,
    inaccessiblePathCount: inaccessiblePaths.length,
    truncated: Boolean(source.truncated),
    cancelled: Boolean(source.cancelled),
    timedOut: Boolean(source.timedOut),
    scannedFiles: asNumber(source.scannedFiles) ?? 0,
    skippedFiles: asNumber(source.skippedFiles) ?? 0,
    generatedAt: asString(source.generatedAt),
  };
}

function indexDbSummary(indexDb: unknown): Record<string, unknown> | undefined {
  const source = isRecord(indexDb) ? indexDb : undefined;
  if (!source) return undefined;
  const metadataWrite = primitivePick(source.metadataWrite, [
    'schemaRevision',
    'status',
    'fileMetadataRowCount',
    'ftsRowCount',
    'previewSpanRowCount',
  ]);
  const search = primitivePick(source.search, [
    'schemaRevision',
    'status',
    'maxRows',
    'rowCount',
    'rawRowCount',
    'droppedRowCount',
    'truncated',
    'matchedFileCount',
    'textRowCount',
    'tableCellRowCount',
    'textRawRowCount',
    'tableCellRawRowCount',
  ]);
  const derivedWrites = Array.isArray(source.derivedWrites) ? source.derivedWrites : [];
  const recentHealthEvents = healthEventsSummary(source.recentHealthEvents);
  return {
    enabled: Boolean(source.enabled),
    contract: asString(source.contract),
    backend: asString(source.backend),
    schemaRevision: asNumber(source.schemaRevision),
    requiredMigrations: asStringArray(source.requiredMigrations),
    appliedMigrations: asStringArray(source.appliedMigrations),
    existingMigrations: asStringArray(source.existingMigrations),
    cutoverReadiness: indexDbCutoverReadinessSummary(source.cutoverReadiness),
    primaryPathGate: indexDbPrimaryPathGateSummary(source.primaryPathGate),
    schemaGate: schemaGateSummary(source.schemaGate),
    resultUsage: indexDbResultUsageSummary(source.resultUsage),
    promotedEvidenceFileCount: asNumber(source.promotedEvidenceFileCount) ?? 0,
    staleEvidenceRowCount: asNumber(source.staleEvidenceRowCount) ?? 0,
    staleEvidenceReasons: numberRecord(source.staleEvidenceReasons) ?? {},
    currentScanFtsRowCount: asNumber(source.currentScanFtsRowCount) ?? 0,
    currentScanFtsFileCount: asNumber(source.currentScanFtsFileCount) ?? 0,
    freshCurrentScanFtsRowCount: asNumber(source.freshCurrentScanFtsRowCount) ?? 0,
    freshCurrentScanFtsFileCount: asNumber(source.freshCurrentScanFtsFileCount) ?? 0,
    metadataBoostedFreshFtsRowCount: asNumber(source.metadataBoostedFreshFtsRowCount) ?? 0,
    metadataBoostedFreshFtsFileCount: asNumber(source.metadataBoostedFreshFtsFileCount) ?? 0,
    titleBoostedFreshFtsRowCount: asNumber(source.titleBoostedFreshFtsRowCount) ?? 0,
    titleBoostedFreshFtsFileCount: asNumber(source.titleBoostedFreshFtsFileCount) ?? 0,
    locationBoostedFreshFtsRowCount: asNumber(source.locationBoostedFreshFtsRowCount) ?? 0,
    locationBoostedFreshFtsFileCount: asNumber(source.locationBoostedFreshFtsFileCount) ?? 0,
    staleCurrentScanFtsRowCount: asNumber(source.staleCurrentScanFtsRowCount) ?? 0,
    staleCurrentScanFtsFileCount: asNumber(source.staleCurrentScanFtsFileCount) ?? 0,
    outsideCurrentScanFtsRowCount: asNumber(source.outsideCurrentScanFtsRowCount) ?? 0,
    outsideCurrentScanFtsFileCount: asNumber(source.outsideCurrentScanFtsFileCount) ?? 0,
    writeErrorCount: Array.isArray(source.writeErrors) ? source.writeErrors.length : 0,
    searchErrorCount: asStringArray(source.searchErrors).length,
    metadataWrite,
    derivedWriteCount: derivedWrites.length,
    search,
    recentHealthEventCount: recentHealthEvents.length,
    recentHealthEvents,
    healthEventReadError: asString(source.healthEventReadError),
  };
}

function indexDbTraceFacts(facts: unknown): Record<string, unknown> | undefined {
  const source = isRecord(facts) ? facts : undefined;
  if (!source) return undefined;
  const recentHealthEvents = healthEventsSummary(source.recentHealthEvents);
  return {
    enabled: Boolean(source.enabled),
    backend: asString(source.backend),
    schemaRevision: asNumber(source.schemaRevision),
    readinessStatus: asString(source.readinessStatus),
    readinessReasons: asStringArray(source.readinessReasons),
    primaryPathGate: indexDbPrimaryPathGateSummary(source.primaryPathGate),
    schemaReady: typeof source.schemaReady === 'boolean' ? source.schemaReady : undefined,
    migrationReady: typeof source.migrationReady === 'boolean' ? source.migrationReady : undefined,
    writeReady: typeof source.writeReady === 'boolean' ? source.writeReady : undefined,
    searchReady: typeof source.searchReady === 'boolean' ? source.searchReady : undefined,
    evidencePromotionReady: typeof source.evidencePromotionReady === 'boolean' ? source.evidencePromotionReady : undefined,
    schemaGate: schemaGateSummary(source.schemaGate),
    resultUsage: indexDbResultUsageSummary(source.resultUsage),
    staleEvidenceRowCount: asNumber(source.staleEvidenceRowCount) ?? 0,
    staleEvidenceReasons: numberRecord(source.staleEvidenceReasons) ?? {},
    currentScanFtsRowCount: asNumber(source.currentScanFtsRowCount) ?? 0,
    currentScanFtsFileCount: asNumber(source.currentScanFtsFileCount) ?? 0,
    freshCurrentScanFtsRowCount: asNumber(source.freshCurrentScanFtsRowCount) ?? 0,
    freshCurrentScanFtsFileCount: asNumber(source.freshCurrentScanFtsFileCount) ?? 0,
    metadataBoostedFreshFtsRowCount: asNumber(source.metadataBoostedFreshFtsRowCount) ?? 0,
    metadataBoostedFreshFtsFileCount: asNumber(source.metadataBoostedFreshFtsFileCount) ?? 0,
    titleBoostedFreshFtsRowCount: asNumber(source.titleBoostedFreshFtsRowCount) ?? 0,
    titleBoostedFreshFtsFileCount: asNumber(source.titleBoostedFreshFtsFileCount) ?? 0,
    locationBoostedFreshFtsRowCount: asNumber(source.locationBoostedFreshFtsRowCount) ?? 0,
    locationBoostedFreshFtsFileCount: asNumber(source.locationBoostedFreshFtsFileCount) ?? 0,
    staleCurrentScanFtsRowCount: asNumber(source.staleCurrentScanFtsRowCount) ?? 0,
    staleCurrentScanFtsFileCount: asNumber(source.staleCurrentScanFtsFileCount) ?? 0,
    outsideCurrentScanFtsRowCount: asNumber(source.outsideCurrentScanFtsRowCount) ?? 0,
    outsideCurrentScanFtsFileCount: asNumber(source.outsideCurrentScanFtsFileCount) ?? 0,
    searchMaxRows: asNumber(source.searchMaxRows),
    searchRawRowCount: asNumber(source.searchRawRowCount),
    searchDroppedRowCount: asNumber(source.searchDroppedRowCount),
    searchTruncated: Boolean(source.searchTruncated),
    writeErrorCount: asNumber(source.writeErrorCount) ?? 0,
    searchErrorCount: asNumber(source.searchErrorCount) ?? 0,
    recentHealthEventCount: asNumber(source.recentHealthEventCount) ?? recentHealthEvents.length,
    recentHealthEventKinds: asStringArray(source.recentHealthEventKinds),
    recentHealthEvents,
    healthEventReadError: asString(source.healthEventReadError),
  };
}

function queryTraceSummary(queryTrace: unknown): Record<string, unknown> | undefined {
  const source = isRecord(queryTrace) ? queryTrace : undefined;
  if (!source) return undefined;
  const stages = Array.isArray(source.stages)
    ? source.stages
      .map((stage) => {
        if (!isRecord(stage)) return undefined;
        const name = asString(stage.name);
        const state = asString(stage.state);
        const summary: Record<string, unknown> = { name, state };
        if (name === 'index_db') summary.facts = indexDbTraceFacts(stage.facts);
        if (name === 'ranking') {
          summary.facts = primitivePick(stage.facts, [
            'candidateCount',
            'returnedCount',
            'collapsedCandidateCount',
            'userMemoryBoostedFileCount',
            'warningPenaltyAppliedCount',
            'warningPenaltyTotal',
          ]);
          const facts = isRecord(summary.facts) ? summary.facts : {};
          const sourceFacts = isRecord(stage.facts) ? stage.facts : {};
          const scores = scoreBreakdownSummary(sourceFacts.scoreBreakdown);
          if (scores) facts.scoreBreakdown = scores;
          summary.facts = facts;
        }
        if (name === 'quality_gate') {
          summary.facts = primitivePick(stage.facts, [
            'coverageConfidence',
            'evidenceConfidence',
            'freshnessConfidence',
            'answerPolicy',
            'canAskCopilotForFinalAnswer',
            'redactionPolicy',
            'redactionAllowsCopilot',
            'redactedEvidenceCount',
          ]);
        }
        return summary;
      })
      .filter(Boolean)
    : [];
  return {
    schemaVersion: asString(source.schemaVersion),
    traceId: asString(source.traceId),
    jobId: asString(source.jobId),
    queryId: asString(source.queryId),
    plannerOwner: asString(source.plannerOwner),
    copilotRole: asString(source.copilotRole),
    status: asString(source.status),
    progressStage: asString(source.progressStage),
    stages,
  };
}

function syncJournalSummary(syncJournal: unknown): Record<string, unknown> | undefined {
  if (!isRecord(syncJournal)) return undefined;
  const reconciliation = isRecord(syncJournal.reconciliation) ? syncJournal.reconciliation : undefined;
  return {
    enabled: Boolean(syncJournal.enabled),
    writtenEventCount: asNumber(syncJournal.writtenEventCount) ?? 0,
    failedEventCount: asNumber(syncJournal.failedEventCount) ?? 0,
    reconciliation: reconciliation
      ? primitivePick(reconciliation, [
          'schemaVersion',
          'rootCount',
          'recentWatcherRootCount',
          'periodicDueRootCount',
          'watcherDisabledRootCount',
          'offlineRootCount',
          'deniedRootCount',
        ])
      : undefined,
  };
}

function contentIndexCommitSummary(contentIndexCommit: unknown): Record<string, unknown> | undefined {
  if (!isRecord(contentIndexCommit)) return undefined;
  const reports = Array.isArray(contentIndexCommit.reports) ? contentIndexCommit.reports.filter(isRecord) : [];
  const reportStatuses: Record<string, number> = {};
  let reportWarningCount = 0;
  let reportErrorCount = 0;
  for (const report of reports) {
    const status = asString(report.status, 'unknown');
    reportStatuses[status] = (reportStatuses[status] ?? 0) + 1;
    reportWarningCount += Array.isArray(report.warnings) ? report.warnings.length : 0;
    reportErrorCount += Array.isArray(report.errors) ? report.errors.length : 0;
  }
  return {
    enabled: Boolean(contentIndexCommit.enabled),
    attemptedCount: asNumber(contentIndexCommit.attemptedCount) ?? 0,
    committedCount: asNumber(contentIndexCommit.committedCount) ?? (reportStatuses.committed ?? 0),
    staleFallbackCount:
      asNumber(contentIndexCommit.staleFallbackCount) ?? (reportStatuses.stale_previous_active ?? 0),
    failedCount: asNumber(contentIndexCommit.failedCount) ?? (reportStatuses.failed ?? 0),
    reportCount: reports.length,
    reportStatuses,
    warningCount: reportWarningCount,
    errorCount: Array.isArray(contentIndexCommit.errors) ? contentIndexCommit.errors.length : reportErrorCount,
  };
}

function evictionSummary(evicted: unknown): Record<string, unknown> {
  const items = Array.isArray(evicted) ? evicted.filter(isRecord) : [];
  const byReason: Record<string, number> = {};
  let totalBytes = 0;
  for (const item of items) {
    const reason = asString(item.reason, 'unknown');
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    totalBytes += asNumber(item.bytes) ?? 0;
  }
  return {
    totalCount: items.length,
    totalBytes,
    byReason,
  };
}

function quotaSummary(quota: unknown): Record<string, unknown> | undefined {
  if (!isRecord(quota)) return undefined;
  return {
    entryCount: asNumber(quota.entryCount) ?? 0,
    totalBytes: asNumber(quota.totalBytes) ?? 0,
    maxCacheEntries: asNumber(quota.maxCacheEntries) ?? 0,
    maxCacheBytes: asNumber(quota.maxCacheBytes) ?? 0,
    quotaPressure: Boolean(quota.quotaPressure),
    evicted: evictionSummary(quota.evicted),
    errorCount: Array.isArray(quota.errors) ? quota.errors.length : 0,
  };
}

function aggregateEvictions(quotas: Record<string, unknown>[]): Record<string, unknown> {
  const byReason: Record<string, number> = {};
  let totalCount = 0;
  let totalBytes = 0;
  for (const quota of quotas) {
    const evicted = evictionSummary(quota.evicted);
    totalCount += asNumber(evicted.totalCount) ?? 0;
    totalBytes += asNumber(evicted.totalBytes) ?? 0;
    const reasons = isRecord(evicted.byReason) ? evicted.byReason : {};
    for (const [reason, count] of Object.entries(reasons)) {
      byReason[reason] = (byReason[reason] ?? 0) + (asNumber(count) ?? 0);
    }
  }
  return { totalCount, totalBytes, byReason };
}

function parsedDocumentCachePolicySummary(policy: unknown): Record<string, unknown> | undefined {
  return primitivePick(policy, [
    'schemaVersion',
    'mode',
    'enabled',
    'readAllowed',
    'writeAllowed',
    'protectionState',
    'reason',
  ]);
}

function parsedDocumentCacheSummary(cache: unknown): Record<string, unknown> | undefined {
  if (!isRecord(cache)) return undefined;
  const policies = Array.isArray(cache.policy)
    ? cache.policy.map(parsedDocumentCachePolicySummary).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const quotas = Array.isArray(cache.quota) ? cache.quota.filter(isRecord) : [];
  const quotaSummaries = quotas.map(quotaSummary).filter((item): item is Record<string, unknown> => Boolean(item));
  const latestQuota = quotaSummaries.at(-1);
  const writeErrors = Array.isArray(cache.writeErrors) ? cache.writeErrors : [];
  return {
    enabled: Boolean(cache.enabled),
    hitCount: asStringArray(cache.hits).length,
    missCount: asStringArray(cache.misses).length,
    writeCount: asStringArray(cache.writes).length,
    writeErrorCount: writeErrors.length,
    policy: policies,
    policyDenied: policies.some((policy) => policy.readAllowed === false || policy.writeAllowed === false),
    quotaRunCount: quotaSummaries.length,
    quotaPressure: quotaSummaries.some((quota) => quota.quotaPressure === true),
    latestQuota,
    evicted: aggregateEvictions(quotas),
    moveMigration: primitivePick(cache.moveMigration, [
      'schemaVersion',
      'highConfidenceMoveCount',
      'migratedCacheRecordCount',
      'skippedMissingCacheCount',
      'skippedIncompatibleMoveCount',
    ]),
  };
}

function derivedContentIndexCacheSummary(cache: unknown): Record<string, unknown> | undefined {
  if (!isRecord(cache)) return undefined;
  const policies = Array.isArray(cache.policy)
    ? cache.policy.map(parsedDocumentCachePolicySummary).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const quotas = Array.isArray(cache.quota) ? cache.quota.filter(isRecord) : [];
  const quotaSummaries = quotas.map(quotaSummary).filter((item): item is Record<string, unknown> => Boolean(item));
  const latestQuota = quotaSummaries.at(-1);
  return {
    enabled: Boolean(cache.enabled),
    hitCount: asStringArray(cache.hits).length,
    missCount: asStringArray(cache.misses).length,
    writeCount: asStringArray(cache.writes).length,
    writeErrorCount: Array.isArray(cache.writeErrors) ? cache.writeErrors.length : 0,
    policy: policies,
    policyDenied: policies.some((policy) => policy.readAllowed === false || policy.writeAllowed === false),
    quotaRunCount: quotaSummaries.length,
    quotaPressure: quotaSummaries.some((quota) => quota.quotaPressure === true),
    latestQuota,
    evicted: aggregateEvictions(quotas),
  };
}

function cacheSummary(source: Record<string, unknown>): Record<string, unknown> {
  const derivedContentIndex = isRecord(source.derivedContentIndex) ? source.derivedContentIndex : undefined;
  return {
    parsedDocument: parsedDocumentCacheSummary(source.parsedDocumentCache),
    derivedContentIndex: derivedContentIndexCacheSummary(derivedContentIndex?.cache),
  };
}

function diagnosticsSummary(diagnostics: unknown): Record<string, unknown> {
  const source = isRecord(diagnostics) ? diagnostics : {};
  return {
    executor: asString(source.executor),
    fileMetadataOnly: Boolean(source.fileMetadataOnly),
    parsedDocumentIrVersion: asString(source.parsedDocumentIrVersion),
    queryNormalizerVersion: asString(source.queryNormalizerVersion),
    parsedDocumentsGenerated: asNumber(source.parsedDocumentsGenerated) ?? 0,
    textContentScanned: asNumber(source.textContentScanned) ?? 0,
    textContentSkipped: asNumber(source.textContentSkipped) ?? 0,
    contentEvidenceGenerated: asNumber(source.contentEvidenceGenerated) ?? 0,
    contentRequiredButUnconfirmed: Boolean(source.contentRequiredButUnconfirmed),
    ranking: source.ranking,
    diversity: source.diversity,
    quality: source.quality,
    evidenceRedaction: primitivePick(source.evidenceRedaction, [
      'schemaVersion',
      'policy',
      'canSendToCopilot',
      'redactedEvidenceCount',
      'sourceEvidenceCount',
    ]),
    cache: cacheSummary(source),
    contentIndexCommit: contentIndexCommitSummary(source.contentIndexCommit),
    indexDb: indexDbSummary(source.indexDb),
    scheduler: source.scheduler,
    syncJournal: syncJournalSummary(source.syncJournal),
    queryTrace: queryTraceSummary(source.queryTrace),
    polishValidation: primitivePick(source.polishValidation, [
      'schemaVersion',
      'state',
      'accepted',
      'repair_attempt',
    ]),
    copilotState: primitivePick(source.copilotState, [
      'schemaVersion',
      'state',
      'phase',
      'support_code',
      'visible_to_user',
      'local_search_blocked',
      'local_draft_blocked',
      'preview_open_blocked',
      'should_wait_for_copilot',
    ]),
    cancelled: Boolean(source.cancelled),
    timedOut: Boolean(source.timedOut),
  };
}

export function buildRelayDocumentSearchSupportExport(
  result: unknown,
  options: RelayDocumentSearchSupportExportOptions = {},
): RelayDocumentSearchSupportExportV1 {
  const validation = validateRelayDocumentSearchResult(result);
  const source = validation.ok ? validation.value : undefined;
  const record = isRecord(result) ? result : {};
  const mode = options.mode ?? 'metadata_only';
  const selectedIds = selectedEvidenceIds(options);
  const selectedIdSet = new Set(selectedIds);
  const coverage = coverageSummary(source?.coverage ?? record.coverage);
  const roots = asStringArray((source?.coverage ?? record.coverage as Record<string, unknown> | undefined)?.searchedRoots);
  const evidenceItems = Array.isArray(source?.evidencePack?.evidence)
    ? source.evidencePack.evidence
    : [];
  const exportedEvidence = evidenceItems
    .map((item) => evidenceItemSummary(item, mode, selectedIdSet))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const warnings = Array.isArray(source?.evidencePack?.warnings)
    ? source.evidencePack.warnings.map(warningSummary).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SUPPORT_EXPORT_CONTRACT,
    sourceSchemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    generatedAt: generatedAt(options.generatedAt),
    mode,
    source: {
      status: asString(source?.status ?? record.status, 'failed'),
      jobId: asString(source?.job.jobId),
      queryId: asString(source?.correlation.queryId),
      progressStage: asString(source?.progress.stage ?? (isRecord(record.progress) ? record.progress.stage : undefined)),
      validationOk: validation.ok,
      validationErrors: validation.ok ? [] : validation.errors,
    },
    redaction: {
      originalFilesIncluded: false,
      rawDatabasesIncluded: false,
      dbPathsIncluded: false,
      fullExtractedTextIncluded: false,
      snippetsIncluded: mode === 'include_selected_evidence_snippets' && selectedIds.length > 0,
      pathPolicy: 'root_relative_or_basename',
    },
    coverage,
    results: Array.isArray(source?.results)
      ? source.results.map((item) => resultSummary(item, roots)).filter((item): item is Record<string, unknown> => Boolean(item))
      : [],
    evidence: {
      evidenceCount: evidenceItems.length,
      exportedEvidenceCount: exportedEvidence.length,
      selectedEvidenceIds: selectedIds,
      items: exportedEvidence,
      warnings,
    },
    diagnostics: diagnosticsSummary(source?.diagnostics),
  };
}
