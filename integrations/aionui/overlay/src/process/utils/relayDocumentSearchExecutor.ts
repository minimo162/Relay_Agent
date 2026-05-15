/**
 * Phase -1 conservative document-search executor.
 *
 * This is intentionally metadata first. It can confirm bounded text/CSV/Markdown
 * content through the ParsedDocument IR, and can use the optional LiteParse PDF
 * text reader when available, lightweight OOXML Office text/cell extraction,
 * and an explicitly enabled ParsedDocument cache.
 */

import { spawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'path';

import {
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  type RelayDocumentSearchRequestV1,
  type RelayDocumentSearchResultV1,
  validateRelayDocumentSearchRequest,
} from './relayDocumentSearchContract';
import {
  readRelayDocumentSearchMetadataCache,
  writeRelayDocumentSearchMetadataCache,
  type RelayDocumentSearchCachedFileMetadata,
} from './relayDocumentSearchMetadataCache';
import {
  RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT,
  buildRelayDocumentSearchFilenameIndex,
  readRelayDocumentSearchFilenameIndex,
  searchRelayDocumentSearchFilenameIndex,
  writeRelayDocumentSearchFilenameIndex,
  type RelayDocumentSearchFilenameIndexMatch,
} from './relayDocumentSearchFilenameIndex';
import {
  RelayDocumentSearchIndexWriterBusyError,
  acquireRelayDocumentSearchIndexWriter,
  commitRelayDocumentSearchContentIndexActivePointer,
  markRelayDocumentSearchContentIndexActivePointerStale,
  relayDocumentSearchIndexCoordinatorDir,
  readRelayDocumentSearchIndexHealthEvents,
  type RelayDocumentSearchContentIndexCommitReport,
  type RelayDocumentSearchIndexHealthEvent,
  type RelayDocumentSearchIndexWriter,
} from './relayDocumentSearchIndexCoordinator';
import {
  migrateRelayParsedDocumentCacheForHighConfidenceMoves,
  readRelayParsedDocumentCache,
  stageRelayParsedDocumentCache,
  type RelayParsedDocumentCacheRecord,
  type RelayParsedDocumentCacheStage,
  type RelayParsedDocumentCacheMoveMigrationReport,
  type RelayParsedDocumentCacheProtectionMode,
  type RelayParsedDocumentCachePolicyResult,
  type RelayParsedDocumentCacheQuotaResult,
} from './relayParsedDocumentCache';
import {
  RELAY_OFFICE_OPENXML_READER_VERSION,
  RELAY_PARSED_DOCUMENT_IR_VERSION,
  RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
  RELAY_PDF_READER_VERSION,
  RELAY_TEXT_READER_VERSION,
  readerCapabilitiesForExtension,
  readOfficeOpenXmlFileAsRelayParsedDocument,
  readPdfFileAsRelayParsedDocument,
  readTextFileAsRelayParsedDocument,
  type RelayParsedDocumentStructureProfileStatus,
  type RelayParsedDocument,
} from './relayParsedDocumentIr';
import {
  RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
  buildRelayDocumentSearchDerivedIndexOwnershipReport,
  buildRelayDocumentSearchDerivedSearchStore,
  buildRelayDocumentSearchDerivedContentIndex,
  readRelayDocumentSearchDerivedContentIndexCache,
  searchRelayDocumentSearchDerivedSearchStore,
  stageRelayDocumentSearchDerivedContentIndexCache,
  type RelayDocumentSearchDerivedContentIndexCachePolicyResult,
  type RelayDocumentSearchDerivedContentIndexCacheProtectionMode,
  type RelayDocumentSearchDerivedContentIndexCacheQuotaResult,
  type RelayDocumentSearchDerivedContentIndexCacheRecord,
  type RelayDocumentSearchDerivedContentIndexCacheStage,
  type RelayDocumentSearchDerivedContentIndexV1,
  type RelayDocumentSearchDerivedSearchStoreSearchResult,
  type RelayDocumentSearchDerivedSearchStoreV1,
} from './relayDocumentSearchDerivedContentIndex';
import {
  RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
  relayDocumentSearchIndexDbPathForOptions,
  searchRelayDocumentSearchIndexDbFts,
  writeRelayDocumentSearchIndexDbDerivedSearchStore,
  writeRelayDocumentSearchIndexDbMetadata,
  type RelayDocumentSearchIndexDbSearchResult,
  type RelayDocumentSearchIndexDbSearchRow,
  type RelayDocumentSearchIndexDbStatus,
  type RelayDocumentSearchIndexDbWriteReport,
  type RelayDocumentSearchSqliteModule,
} from './relayDocumentSearchIndexDb';
import {
  RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
  buildRelayDocumentSearchQueryPlan,
  normalizeRelaySearchText,
  type RelayDocumentSearchQueryPlanV1,
} from './relayDocumentSearchQueryPlan';
import { buildRelayDocumentSearchIndexReport } from './relayDocumentSearchIndexReport';
import {
  groupRelayDocumentSearchCandidates,
  type RelayDocumentSearchResultGroup,
} from './relayDocumentSearchResultGrouping';
import {
  RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT,
  applyRelayDocumentSearchMoveFreshnessToUserMemory,
  emptyRelayDocumentSearchUserMemory,
  readRelayDocumentSearchUserMemory,
  relayDocumentSearchUserMemoryBoostForFile,
  withRelayDocumentSearchPinnedTarget,
  withRelayDocumentSearchRecentSearch,
  writeRelayDocumentSearchUserMemory,
  type RelayDocumentSearchPinnedTarget,
  type RelayDocumentSearchRecentSearch,
  type RelayDocumentSearchUserMemoryMoveMigrationReport,
  type RelayDocumentSearchUserMemoryRecord,
} from './relayDocumentSearchUserMemory';
import {
  buildRelayDocumentSearchEvidenceRedactionReport,
  relayDocumentSearchEvidenceRedactionPolicyFromEnv,
  type RelayDocumentSearchEvidenceRedactionPolicy,
} from './relayDocumentSearchEvidenceRedaction';
import { buildRelayDocumentSearchPolishRequest } from './relayDocumentSearchPolishRequest';
import {
  invokeRelayDocumentSearchPolishProvider,
  type RelayDocumentSearchPolishProviderCallback,
  type RelayDocumentSearchPolishProviderFetch,
} from './relayDocumentSearchPolishProvider';
import {
  buildRelayDocumentSearchEvidencePack,
  emptyRelayDocumentSearchEvidencePack,
} from './relayDocumentSearchEvidencePack';
import { buildRelayDocumentSearchLocalDraft } from './relayDocumentSearchLocalDraft';
import { validateRelayDocumentSearchCopilotPolish } from './relayDocumentSearchPolishValidation';
import {
  buildRelayDocumentSearchCopilotStateReport,
  type RelayDocumentSearchCopilotState,
} from './relayDocumentSearchCopilotState';
import {
  buildRelayDocumentSearchFreshnessReport,
  summarizeRelayDocumentSearchFreshnessReports,
  type RelayDocumentSearchFreshnessReport,
} from './relayDocumentSearchFreshness';
import { buildRelayDocumentSearchAnswer } from './relayDocumentSearchAnswer';
import { buildRelayDocumentSearchQualityReport } from './relayDocumentSearchQualityGates';
import { buildRelayDocumentSearchQueryTrace } from './relayDocumentSearchQueryTrace';
import {
  RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT,
  appendRelayDocumentSearchSyncJournalEvent,
  appendRelayDocumentSearchSyncJournalEvents,
  buildRelayDocumentSearchSyncReconciliationReport,
  relayDocumentSearchSyncJournalDir,
  relayDocumentSearchSyncJournalEnabled,
  type RelayDocumentSearchSyncJournalRecord,
  type RelayDocumentSearchSyncJournalEventInput,
  type RelayDocumentSearchSyncReconciliationReport,
} from './relayDocumentSearchSyncJournal';
import {
  recordRelayDocumentSearchFailure,
  type RelayDocumentSearchFailureKind,
} from './relayDocumentSearchFailureRegistry';
import { buildRelayDocumentSearchSchedulerReport } from './relayDocumentSearchSchedulerReport';
import {
  classifyRelayDocumentSearchFolderRoles,
  summarizeRelayDocumentSearchFolderRoles,
  type RelayDocumentSearchFolderRoleReport,
} from './relayDocumentSearchFolderRoles';
import {
  RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
  RELAY_DOCUMENT_SEARCH_RANKING_VERSION,
  buildRelayDocumentSearchProductResult,
  type RelayDocumentSearchEvidenceState,
  type RelayDocumentSearchScoreBreakdown,
  type RelayDocumentSearchSourceIndex,
} from './relayDocumentSearchProductResult';

export type RelayDocumentSearchExecutorOptions = {
  maxScanFiles?: number;
  maxContentInspectFiles?: number;
  useMetadataCache?: boolean;
  metadataCacheDir?: string;
  metadataCacheMaxAgeMs?: number;
  useFilenameIndex?: boolean;
  filenameIndexDir?: string;
  filenameIndexMaxAgeMs?: number;
  useUserMemory?: boolean;
  userMemoryDir?: string;
  userMemoryMaxRecentSearches?: number;
  pinnedTargets?: RelayDocumentSearchPinnedTarget[];
  recentSearches?: RelayDocumentSearchRecentSearch[];
  useParsedDocumentCache?: boolean;
  parsedDocumentCacheDir?: string;
  parsedDocumentCacheMaxAgeMs?: number;
  parsedDocumentCacheProtectionMode?: RelayParsedDocumentCacheProtectionMode;
  parsedDocumentCacheProtectedAtRest?: boolean;
  useDerivedContentIndexCache?: boolean;
  derivedContentIndexDir?: string;
  derivedContentIndexMaxAgeMs?: number;
  derivedContentIndexCacheMaxBytes?: number;
  derivedContentIndexCacheMaxEntries?: number;
  derivedContentIndexCacheProtectionMode?: RelayDocumentSearchDerivedContentIndexCacheProtectionMode;
  derivedContentIndexCacheProtectedAtRest?: boolean;
  useIndexDb?: boolean;
  indexDbPrimaryMode?: RelayDocumentSearchIndexDbPrimaryMode;
  indexDbSearchMaxRows?: number;
  indexDbPath?: string;
  sqliteModule?: RelayDocumentSearchSqliteModule;
  useIndexCoordinator?: boolean;
  indexCoordinatorDir?: string;
  indexCoordinatorLockStaleMs?: number;
  useSyncJournal?: boolean;
  syncJournalDir?: string;
  syncJournalMaxEntries?: number;
  useFailureRegistry?: boolean;
  failureRegistryDir?: string;
  failureRegistryMaxEntries?: number;
  schedulerPaused?: boolean;
  schedulerPauseReasons?: string[];
  schedulerPerRootConcurrency?: number;
  evidenceRedactionPolicy?: RelayDocumentSearchEvidenceRedactionPolicy;
  copilotPolishCandidate?: unknown;
  enableCopilotPolishProvider?: boolean;
  copilotPolishProvider?: RelayDocumentSearchPolishProviderCallback;
  copilotPolishProviderBaseUrl?: string;
  copilotPolishProviderApiKey?: string;
  copilotPolishProviderModel?: string;
  copilotPolishProviderTimeoutMs?: number;
  copilotPolishProviderFetch?: RelayDocumentSearchPolishProviderFetch;
  copilotPolishRepairAttempt?: number;
  copilotPolishState?: RelayDocumentSearchCopilotState;
  copilotPolishStateMessage?: string;
  copilotSessionId?: string;
  copilotRequestId?: string;
  copilotTurnId?: string;
  appVersion?: string;
  now?: Date;
  jobId?: string;
  queryId?: string;
  aionuiConversationId?: string;
  aionuiMessageId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  ripgrepPath?: string;
  ripgrepListTimeoutMs?: number;
  ripgrepMaxFiles?: number;
  onProgress?: (progress: RelayDocumentSearchResultV1['progress']) => void;
};

export type RelayDocumentSearchIndexDbPrimaryMode = 'disabled' | 'shadow' | 'primary' | 'rollback';

type FileMetadata = RelayDocumentSearchCachedFileMetadata;

type ContentEvidence = {
  source: 'derived_search_store' | 'sqlite_fts';
  score: number;
  uncappedScore?: number;
  scoreCapLoss?: number;
  anchors: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  parsedDocument?: RelayParsedDocument;
  derivedIndex?: RelayDocumentSearchDerivedContentIndexV1;
  derivedSearchStore?: RelayDocumentSearchDerivedSearchStoreV1;
  derivedSearch?: RelayDocumentSearchDerivedSearchStoreSearchResult;
};

type RankedCandidate = {
  file: FileMetadata;
  score: number;
  baseScore: number;
  reasons: string[];
  filenameScore: number;
  pathScore: number;
  termScore: number;
  folderRoleScore: number;
  contentScore: number;
  indexDbScore: number;
  indexDbUncappedScore: number;
  indexDbScoreCapLoss: number;
  recencyScore: number;
  userMemoryBoost: number;
  rrfScore: number;
  warningPenalty: number;
  rankingWarnings: string[];
  filenameIndexMatch?: RelayDocumentSearchFilenameIndexMatch;
  contentEvidence?: ContentEvidence;
  semanticAllowed?: boolean;
  semanticConfirmed?: boolean;
};

type SemanticConceptMatchStrength =
  | 'none'
  | 'filename_direct'
  | 'filename_compound'
  | 'content_direct'
  | 'content_compound'
  | 'hybrid_compound'
  | 'partial';

type SemanticConceptMatchResult = {
  matched: boolean;
  confirmed: boolean;
  strength: SemanticConceptMatchStrength;
  reasons: string[];
  score: number;
  entityContext: boolean;
};

type RelayDocumentSearchCandidateBucket =
  | 'direct_source_workpaper'
  | 'supporting_evidence'
  | 'disclosure_output'
  | 'backup_or_archive'
  | 'review_or_audit'
  | 'uncategorized';

type RankingScoreBreakdownSummary = {
  score_breakdown_contract: typeof RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT;
  rankingVersion: typeof RELAY_DOCUMENT_SEARCH_RANKING_VERSION;
  deterministic: true;
  candidateCount: number;
  returnedCount: number;
  activePath: string;
  componentTotals: Record<string, number>;
  warningPenaltyTotal: number;
  groupingCollapsedCandidateCount: number;
  hybridMergeMode: string;
};

type DiversityResult = {
  candidates: RankedCandidate[];
  perDirectoryLimit: number;
  uniqueDirectoryCount: number;
  deferredCandidateCount: number;
};

type ScanBudgetStrategy =
  | 'latest_first'
  | 'historical_examples'
  | 'balanced'
  | 'explicit_period'
  | 'single_root_fallback';

type ScanBudgetFolderRole = 'explicit' | 'latest' | 'recent' | 'historical' | 'other';

type ScanBudgetFolderReport = {
  path: string;
  displayPath: string;
  role: ScanBudgetFolderRole;
  periodKey?: number;
  modifiedTime?: string;
  weight: number;
  minimumGuaranteedFiles: number;
  allocatedFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  truncated: boolean;
};

type ScanBudgetReport = {
  schemaVersion: 'RelayDocumentSearchScanBudget.v1';
  root: string;
  strategy: ScanBudgetStrategy;
  timeScopeIntent: RelayDocumentSearchQueryPlanV1['timeScopeIntent'];
  timeScopeReason: string;
  maxScanFiles: number;
  rootFileBudget: number;
  rootFilesScanned: number;
  rootFilesSkipped: number;
  rootFilesTruncated: boolean;
  folderCount: number;
  minimumGuaranteePerFolder: number;
  budgetedFolderCount: number;
  budgetTruncatedFolderCount: number;
  folders: ScanBudgetFolderReport[];
};

function contentEvidenceHasTableAnchor(contentEvidence: ContentEvidence | undefined): boolean {
  if (!contentEvidence) return false;
  return contentEvidence.anchors.some((anchor) =>
    anchor.type === 'cell_excerpt' ||
      typeof anchor.cell === 'string' ||
      typeof anchor.cell_address === 'string' ||
      typeof anchor.sheet === 'string' ||
      typeof anchor.sheet_name === 'string' ||
      typeof anchor.table_id === 'string',
  );
}

function numberFromScoreBreakdown(scoreBreakdown: Record<string, unknown>, key: string): number {
  const value = scoreBreakdown[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sourceIndexesForCandidate(
  candidate: RankedCandidate,
  scoreBreakdown: Record<string, unknown>,
): RelayDocumentSearchSourceIndex[] {
  const sourceIndexes: RelayDocumentSearchSourceIndex[] = [
    {
      kind: 'metadata_cache',
      label: 'メタデータ',
      state: 'used',
      reason: 'file_discovery_and_metadata',
    },
  ];

  if (candidate.filenameIndexMatch) {
    sourceIndexes.push({
      kind: 'filename_index',
      label: 'ファイル名索引',
      state: 'used',
      score: candidate.filenameIndexMatch.score,
      reason: 'filename_index_match',
    });
  } else if (
    numberFromScoreBreakdown(scoreBreakdown, 'filename_score') > 0 ||
    numberFromScoreBreakdown(scoreBreakdown, 'path_score') > 0 ||
    numberFromScoreBreakdown(scoreBreakdown, 'term_score') > 0
  ) {
    sourceIndexes.push({
      kind: 'filename_fallback',
      label: '簡易ファイル名検索',
      state: 'used',
      score:
        numberFromScoreBreakdown(scoreBreakdown, 'filename_score') +
        numberFromScoreBreakdown(scoreBreakdown, 'path_score') +
        numberFromScoreBreakdown(scoreBreakdown, 'term_score'),
      reason: 'filename_or_path_match',
    });
  }

  if (candidate.contentEvidence) {
    if (candidate.contentEvidence.source === 'derived_search_store') {
      sourceIndexes.push(
        {
          kind: 'parsed_document_ir',
          label: '文書解析結果',
          state: 'used',
          reason: 'content_was_parsed',
        },
        {
          kind: 'derived_content_index',
          label: '本文派生索引',
          state: 'used',
          score: candidate.contentEvidence.score,
          reason: 'content_match',
        },
      );
    }
    if (candidate.indexDbScore > 0 || candidate.contentEvidence.source === 'sqlite_fts') {
      sourceIndexes.push({
        kind: 'sqlite_fts_index',
        label: 'SQLite FTS索引',
        state: 'used',
        score: candidate.indexDbScore || candidate.contentEvidence.score,
        reason: 'sqlite_fts_content_match',
      });
    }
    if (candidate.contentEvidence.anchors.length > 0) {
      sourceIndexes.push({
        kind: 'preview_anchor_index',
        label: 'プレビュー位置',
        state: 'used',
        reason: 'preview_anchor_available',
      });
    }
    if (contentEvidenceHasTableAnchor(candidate.contentEvidence)) {
      sourceIndexes.push({
        kind: 'table_index',
        label: '表索引',
        state: 'used',
        score: candidate.contentEvidence.score,
        reason: 'table_or_cell_match',
      });
    }
  }

  if (candidate.userMemoryBoost > 0) {
    sourceIndexes.push({
      kind: 'user_memory',
      label: 'ピン/履歴',
      state: 'used',
      score: candidate.userMemoryBoost,
      reason: 'pinned_or_recent_user_signal',
    });
  }

  return sourceIndexes;
}

type WalkState = {
  scannedFiles: number;
  skippedFiles: number;
  inaccessiblePaths: string[];
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  deadlineMs?: number;
  signal?: AbortSignal;
  onProgress?: RelayDocumentSearchExecutorOptions['onProgress'];
  budgetReports: ScanBudgetReport[];
};

type MetadataCacheState = {
  hits: string[];
  misses: string[];
  writes: string[];
  writeErrors: Array<{ root: string; message: string }>;
};

type FilenameIndexState = {
  enabled: boolean;
  contract: typeof RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT;
  mode: 'in_memory' | 'persistent';
  inMemoryFileCount: number;
  inMemoryTermCount: number;
  searchHitCount: number;
  readHits: string[];
  readMisses: string[];
  writes: string[];
  writeErrors: Array<{ root: string; message: string }>;
};

type UserMemoryState = {
  enabled: boolean;
  contract: typeof RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT;
  persistent: boolean;
  pinCount: number;
  recentSearchCount: number;
  boostedFileCount: number;
  recordedRecentSearch: boolean;
  moveMigration?: RelayDocumentSearchUserMemoryMoveMigrationReport;
  readError?: string;
  writeError?: string;
};

type ParsedDocumentCacheState = {
  hits: string[];
  misses: string[];
  writes: string[];
  writeErrors: Array<{ path: string; message: string }>;
  quota: RelayParsedDocumentCacheQuotaResult[];
  policy: RelayParsedDocumentCachePolicyResult[];
  moveMigration?: RelayParsedDocumentCacheMoveMigrationReport;
};

type ParsedDocumentReadResult = {
  parsedDocument: RelayParsedDocument;
  cacheRecord?: RelayParsedDocumentCacheRecord;
  cacheHit: boolean;
};

type DerivedContentIndexCacheState = {
  enabled: boolean;
  hits: string[];
  misses: string[];
  writes: string[];
  writeErrors: Array<{ path: string; message: string }>;
  quota: RelayDocumentSearchDerivedContentIndexCacheQuotaResult[];
  policy: RelayDocumentSearchDerivedContentIndexCachePolicyResult[];
};

type ContentIndexCommitState = {
  enabled: boolean;
  attemptedCount: number;
  committedCount: number;
  staleFallbackCount: number;
  failedCount: number;
  reports: RelayDocumentSearchContentIndexCommitReport[];
  errors: Array<{ path?: string; message: string }>;
};

type IndexDbWriteSummary = {
  path?: string;
  schemaRevision: number;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  fileMetadataRowCount: number;
  ftsRowCount: number;
  previewSpanRowCount: number;
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  warnings: string[];
  errors: string[];
};

type IndexDbSearchSummary = {
  schemaRevision: number;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  query: string;
  maxRows: number;
  rowCount: number;
  rawRowCount: number;
  droppedRowCount: number;
  truncated: boolean;
  matchedFileCount: number;
  textRowCount: number;
  tableCellRowCount: number;
  textRawRowCount: number;
  tableCellRawRowCount: number;
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  warnings: string[];
  errors: string[];
};

type IndexDbCutoverReadiness = {
  status: 'disabled' | 'ready' | 'degraded' | 'blocked';
  reasons: string[];
  schemaReady: boolean;
  migrationReady: boolean;
  writeReady: boolean;
  searchReady: boolean;
  evidencePromotionReady: boolean;
};

type IndexDbPrimaryPathGate = {
  mode: RelayDocumentSearchIndexDbPrimaryMode;
  activePath: 'disabled' | 'filename_content' | 'sqlite_fts_primary';
  eligible: boolean;
  rollbackActive: boolean;
  reasons: string[];
  thresholds: {
    readinessStatus: 'ready';
    searchTruncated: false;
    maxStaleEvidenceRows: 0;
    maxOutsideCurrentScanRows: 0;
    maxWriteErrors: 0;
    maxSearchErrors: 0;
    minFreshCurrentScanFtsFiles: 1;
    minFreshCurrentScanFtsRows: 1;
  };
};

type IndexDbResultUsage = {
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

type IndexDbHealthEventSummary = {
  kind: string;
  createdAt: string;
  jobId?: string;
  action?: string;
  status?: string;
  automatic?: boolean;
  userStarted?: boolean;
  backend?: string;
  indexDbStatus?: string;
  sqliteFtsEnabled?: boolean;
  schemaRevision?: number;
  detectedSchemaRevision?: number;
  schemaGateStatus?: string;
  schemaGateComponentCount?: number;
  schemaGateReadOnlyComponentCount?: number;
  schemaGateRebuildRequiredComponentCount?: number;
  schemaGateInvalidComponentCount?: number;
  durableDataPreserved?: boolean;
  userStatePreserved?: boolean;
  storeNames?: string[];
  storeCount?: number;
  checkCount?: number;
  invalidJsonFileCount?: number;
  warningCount?: number;
  errorCount?: number;
};

type IndexDbState = {
  enabled: boolean;
  contract: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  backend: 'disabled' | 'sqlite_fts';
  dbPath?: string;
  schemaRevision?: number;
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  metadataWrite?: IndexDbWriteSummary;
  derivedWrites: IndexDbWriteSummary[];
  search?: IndexDbSearchSummary;
  cutoverReadiness: IndexDbCutoverReadiness;
  primaryPathGate: IndexDbPrimaryPathGate;
  resultUsage: IndexDbResultUsage;
  promotedEvidenceFileCount: number;
  staleEvidenceRowCount: number;
  staleEvidenceReasons: Record<string, number>;
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
  writeErrors: Array<{ path?: string; message: string }>;
  searchErrors: string[];
  recentHealthEvents: IndexDbHealthEventSummary[];
  healthEventReadError?: string;
};

type IndexDbSearchProbe = {
  scoresByFileId: Map<string, number>;
  uncappedScoresByFileId: Map<string, number>;
  scoreCapLossByFileId: Map<string, number>;
  rowsByFileId: Map<string, RelayDocumentSearchIndexDbSearchRow[]>;
};

type IndexCoordinatorDiagnostics = {
  enabled: boolean;
  mode: 'disabled' | 'advisory';
  acquired: boolean;
  busy: boolean;
  coordinatorDir?: string;
  ownerId?: string;
  lockStaleMs?: number;
  error?: string;
  events: RelayDocumentSearchIndexHealthEvent[];
};

type ActiveIndexCoordinator = {
  writer?: RelayDocumentSearchIndexWriter;
  diagnostics: IndexCoordinatorDiagnostics;
};

type SyncJournalDiagnostics = {
  enabled: boolean;
  contract: typeof RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT;
  journalDir?: string;
  writeCount: number;
  writtenEventCount: number;
  reconciliation?: RelayDocumentSearchSyncReconciliationReport;
  writeErrors: string[];
};

type ParsedDocumentStructureProfileSummary = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT;
  documentCount: number;
  validCount: number;
  degradedCount: number;
  invalidCount: number;
  profiles: Record<string, number>;
  warningCount: number;
  errorCount: number;
  lossyWarningCount: number;
  unsupportedWarningCount: number;
};

const DEFAULT_MAX_SCAN_FILES = 5000;
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_CONTENT_INSPECT_FILES = 500;
const CANDIDATE_FIRST_CONTENT_SCAN_MIN_FILES = 40;
const CANDIDATE_FIRST_CONTENT_SCAN_MAX_FILES = 120;
const DEFAULT_MAX_EVIDENCE_ANCHORS = 3;
const DEFAULT_INDEX_DB_SEARCH_MAX_ROWS = 20;
const MAX_INDEX_DB_SEARCH_MAX_ROWS = 100;
const INDEX_DB_SCORE_CAP = 8;
const DEFAULT_DIRECTORY_DIVERSITY_RATIO = 0.5;
const DEFAULT_RIPGREP_LIST_TIMEOUT_MS = 15_000;
const DEFAULT_RIPGREP_MAX_FILES = 50_000;
const SKIPPED_DIRS = new Set(['.git', '.aionrs', 'node_modules', 'target', 'dist', 'build']);
const TEXT_CONTENT_EXTENSIONS = new Set(['txt', 'md', 'csv']);
const PDF_CONTENT_EXTENSIONS = new Set(['pdf']);
const STRUCTURED_CONTENT_EXTENSIONS = new Set(['docx', 'xlsx', 'xlsm', 'pptx']);
const READABLE_CONTENT_EXTENSIONS = new Set([
  ...TEXT_CONTENT_EXTENSIONS,
  ...PDF_CONTENT_EXTENSIONS,
  ...STRUCTURED_CONTENT_EXTENSIONS,
]);

function shouldStop(state: WalkState): boolean {
  if (state.signal?.aborted) {
    state.cancelled = true;
    return true;
  }
  if (state.deadlineMs !== undefined && Date.now() >= state.deadlineMs) {
    state.timedOut = true;
    return true;
  }
  return false;
}

function emitProgress(state: WalkState, stage: string, percent: number): void {
  state.onProgress?.({
    stage,
    percent,
    scannedFiles: state.scannedFiles,
    skippedFiles: state.skippedFiles,
  });
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `file-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function rootRelativePath(root: string, filePath: string): string {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(filePath);
  if (normalizedPath === normalizedRoot) return basename(normalizedPath);
  if (normalizedPath.startsWith(`${normalizedRoot}${sep}`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function directoryBucket(displayPath: string): string {
  const normalized = displayPath.replace(/\\/gu, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '.';
}

function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function sourceMetadataVersion(path: string, size: number, modifiedTimeMs: number): string {
  return `${stableId(path)}:${size}:${Math.trunc(modifiedTimeMs)}`;
}

function scoreCandidate(file: FileMetadata, terms: string[]): { score: number; reasons: string[] } {
  const name = normalizeRelaySearchText(file.name);
  const displayPath = normalizeRelaySearchText(file.displayPath);
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (name.includes(term)) {
      score += 5;
      reasons.push(`filename:${term}`);
    } else if (displayPath.includes(term)) {
      score += 2;
      reasons.push(`path:${term}`);
    }
  }
  return { score, reasons };
}

function normalizedFileHaystack(file: FileMetadata): string {
  return `${normalizeRelaySearchText(file.name)} ${normalizeRelaySearchText(file.displayPath)}`;
}

const SEMANTIC_ENTITY_CONTEXT_TERMS = [
  '人的資本',
  '従業員',
  '人員',
  '役員',
  '所在地',
  '会社の状況',
  '提出会社',
  '関係会社の状況',
  'コーポレートガバナンス',
  'ガバナンス',
  '会社概要',
  '会社情報',
  '会社名',
  '各社ファイル',
  '会社別',
  'jbu',
];

function fileHasSemanticEntityContext(
  file: FileMetadata,
  queryPlan?: RelayDocumentSearchQueryPlanV1,
): boolean {
  const haystack = normalizedFileHaystack(file);
  const dynamicTerms = [
    ...(queryPlan?.semanticEntityRiskTerms ?? []),
    ...((queryPlan?.semanticConceptGroups ?? []).flatMap((group) => group.entityRiskTerms)),
  ];
  return [...SEMANTIC_ENTITY_CONTEXT_TERMS, ...dynamicTerms]
    .some((term) => haystack.includes(normalizeRelaySearchText(term)));
}

function matchedSemanticTerms(text: string, terms: string[]): string[] {
  const normalized = normalizeRelaySearchText(text);
  return terms.filter((term) => term && normalized.includes(term));
}

function contentEvidenceMatchedTerms(evidence: ContentEvidence | undefined): string[] {
  if (!evidence) return [];
  const terms = new Set<string>();
  for (const anchor of evidence.anchors) {
    const matchedTerms = (anchor as { matchedTerms?: unknown }).matchedTerms;
    if (!Array.isArray(matchedTerms)) continue;
    for (const term of matchedTerms) {
      if (typeof term === 'string') {
        const normalized = normalizeRelaySearchText(term);
        if (normalized) terms.add(normalized);
      }
    }
  }
  return [...terms];
}

function contentEvidenceAnchorTermGroups(evidence: ContentEvidence | undefined): string[][] {
  if (!evidence) return [];
  const groups: string[][] = [];
  const tableRowGroups = new Map<string, Set<string>>();
  for (const anchor of evidence.anchors) {
    const matchedTerms = (anchor as { matchedTerms?: unknown }).matchedTerms;
    if (!Array.isArray(matchedTerms)) continue;
    const terms = new Set<string>();
    for (const term of matchedTerms) {
      if (typeof term === 'string') {
        const normalized = normalizeRelaySearchText(term);
        if (normalized) terms.add(normalized);
      }
    }
    if (!terms.size) continue;
    groups.push([...terms]);
    const tableId = typeof anchor.table_id === 'string' ? anchor.table_id : '';
    const sheetName = typeof anchor.sheet_name === 'string' ? anchor.sheet_name : '';
    const row = typeof anchor.row === 'number' || typeof anchor.row === 'string' ? String(anchor.row) : '';
    if (tableId || (sheetName && row)) {
      const key = `${tableId}|${sheetName}|${row}`;
      const current = tableRowGroups.get(key) ?? new Set<string>();
      for (const term of terms) current.add(term);
      tableRowGroups.set(key, current);
    }
  }
  groups.push(...[...tableRowGroups.values()].map((terms) => [...terms]));
  return groups;
}

function semanticTermsContainAny(matchedTerms: string[], requiredTerms: string[]): boolean {
  return requiredTerms.some((required) =>
    matchedTerms.some((matched) => matched === required || matched.includes(required) || required.includes(matched)),
  );
}

function semanticTermsContainDirectPhrase(matchedTerms: string[], directTerms: string[]): boolean {
  return directTerms.some((required) =>
    matchedTerms.some((matched) => matched === required || matched.includes(required)),
  );
}

function semanticConceptMatchForCandidate(
  file: FileMetadata,
  evidence: ContentEvidence | undefined,
  queryPlan: RelayDocumentSearchQueryPlanV1,
): SemanticConceptMatchResult {
  const entityContext = fileHasSemanticEntityContext(file, queryPlan);
  if (!queryPlan.semanticConceptGroups.length) {
    return { matched: true, confirmed: true, strength: 'none', reasons: [], score: 0, entityContext };
  }

  const haystack = normalizedFileHaystack(file);
  const nameHaystack = normalizeRelaySearchText(file.name);
  const pathHaystack = normalizeRelaySearchText(file.displayPath);
  const haystackMatches = [
    ...queryPlan.semanticConceptGroups.flatMap((group) => [
      ...matchedSemanticTerms(haystack, group.directTerms),
      ...group.allOfAny.flatMap((termGroup) => matchedSemanticTerms(haystack, termGroup)),
    ]),
  ];
  const anchorTermGroups = contentEvidenceAnchorTermGroups(evidence);
  const allEvidenceTerms = contentEvidenceMatchedTerms(evidence);
  let best: SemanticConceptMatchResult = {
    matched: false,
    confirmed: false,
    strength: 'none',
    reasons: [],
    score: 0,
    entityContext,
  };
  const take = (candidate: SemanticConceptMatchResult) => {
    if (!candidate.matched) return;
    if (candidate.score > best.score || (candidate.score === best.score && candidate.confirmed && !best.confirmed)) {
      best = candidate;
    }
  };

  for (const group of queryPlan.semanticConceptGroups) {
    const nameDirectMatches = matchedSemanticTerms(nameHaystack, group.directTerms);
    const pathDirectMatches = matchedSemanticTerms(pathHaystack, group.directTerms)
      .filter((term) => !nameDirectMatches.includes(term));
    const directMatches = [...nameDirectMatches, ...pathDirectMatches];
    if (directMatches.length) {
      const strongNameDirect = nameDirectMatches.some((term) => /売上|sales|revenue/iu.test(term));
      take({
        matched: true,
        confirmed: true,
        strength: 'filename_direct',
        reasons: directMatches.map((term) => `semantic_direct:${group.source}:${term}`),
        score: (strongNameDirect ? 52 : nameDirectMatches.length ? 40 : 28) + Math.min(12, directMatches.length * 4),
        entityContext,
      });
    }

    const nameAllOfAnyMatches = group.allOfAny.map((termGroup) => matchedSemanticTerms(nameHaystack, termGroup));
    const pathAllOfAnyMatches = group.allOfAny.map((termGroup) => matchedSemanticTerms(pathHaystack, termGroup));
    const haystackAllOfAnyMatches = group.allOfAny.map((termGroup) => matchedSemanticTerms(haystack, termGroup));
    if (nameAllOfAnyMatches.every((matches) => matches.length > 0)) {
      take({
        matched: true,
        confirmed: true,
        strength: 'filename_compound',
        reasons: [`semantic_compound:${group.source}:filename`],
        score: 30,
        entityContext,
      });
    } else if (pathAllOfAnyMatches.every((matches) => matches.length > 0)) {
      take({
        matched: true,
        confirmed: false,
        strength: 'filename_compound',
        reasons: [`semantic_compound:${group.source}:path_only`],
        score: entityContext ? 4 : 12,
        entityContext,
      });
    } else if (haystackAllOfAnyMatches.every((matches) => matches.length > 0)) {
      take({
        matched: true,
        confirmed: false,
        strength: 'filename_compound',
        reasons: [`semantic_compound:${group.source}:cross_path`],
        score: entityContext ? 3 : 8,
        entityContext,
      });
    }

    for (const anchorTerms of anchorTermGroups) {
      if (semanticTermsContainDirectPhrase(anchorTerms, group.directTerms)) {
        take({
          matched: true,
          confirmed: true,
          strength: 'content_direct',
          reasons: [`semantic_content_direct:${group.source}`],
          score: 54,
          entityContext,
        });
      }
      if (group.allOfAny.every((termGroup) => semanticTermsContainAny(anchorTerms, termGroup))) {
        take({
          matched: true,
          confirmed: false,
          strength: 'content_compound',
          reasons: [`semantic_content_compound:${group.source}:candidate`],
          score: entityContext ? 8 : 16,
          entityContext,
        });
      }
      const combined = [...new Set([...haystackMatches, ...anchorTerms])];
      if (group.allOfAny.every((termGroup) => semanticTermsContainAny(combined, termGroup))) {
        take({
          matched: true,
          confirmed: false,
          strength: 'hybrid_compound',
          reasons: [`semantic_hybrid_compound:${group.source}`],
          score: entityContext ? 2 : 6,
          entityContext,
        });
      }
    }

    if (semanticTermsContainAny([...haystackMatches, ...allEvidenceTerms], [...group.directTerms, ...group.allOfAny.flat()])) {
      take({
        matched: false,
        confirmed: false,
        strength: 'partial',
        reasons: [`semantic_partial:${group.source}`],
        score: 0,
        entityContext,
      });
    }
  }

  return best;
}

function semanticScoreForCandidate(
  file: FileMetadata,
  queryPlan: RelayDocumentSearchQueryPlanV1,
  evidence?: ContentEvidence,
): { required: boolean; allowed: boolean; confirmed: boolean; entityContext: boolean; score: number; reasons: string[] } {
  const required = queryPlan.semanticConceptGroups.length > 0;
  if (!required) {
    const demoteMatches = matchedSemanticTerms(normalizedFileHaystack(file), queryPlan.demoteTerms);
    return {
      required: false,
      allowed: true,
      confirmed: true,
      entityContext: fileHasSemanticEntityContext(file, queryPlan),
      score: -(demoteMatches.length * 4),
      reasons: demoteMatches.map((term) => `demote:${term}`),
    };
  }

  const haystack = normalizedFileHaystack(file);
  const conceptMatch = semanticConceptMatchForCandidate(file, evidence, queryPlan);
  let allowed = conceptMatch.matched;
  let score = conceptMatch.score;
  const reasons: string[] = [...conceptMatch.reasons];
  if (allowed) {
    for (const group of queryPlan.semanticConceptGroups) {
      const supportMatches = matchedSemanticTerms(haystack, [...queryPlan.supportOnlyTerms, ...group.supportTerms]);
      if (supportMatches.length) {
        score += conceptMatch.confirmed ? Math.min(4, supportMatches.length) : Math.min(1, supportMatches.length);
        reasons.push(...supportMatches.slice(0, 4).map((term) => `semantic_support:${term}`));
      }
    }
  }

  if (allowed && !conceptMatch.confirmed) {
    reasons.push(`semantic_unconfirmed:${conceptMatch.strength}`);
  }
  if (allowed && conceptMatch.entityContext && !conceptMatch.confirmed) {
    score -= 12;
    reasons.push('semantic_entity_context_demote');
  }

  const demoteMatches = matchedSemanticTerms(haystack, queryPlan.demoteTerms);
  if (demoteMatches.length) {
    score -= demoteMatches.length * 4;
    reasons.push(...demoteMatches.map((term) => `demote:${term}`));
  }

  if (!allowed) reasons.push('semantic_gate:missing_required_concept');
  return {
    required,
    allowed,
    confirmed: conceptMatch.confirmed,
    entityContext: conceptMatch.entityContext,
    score,
    reasons,
  };
}

function semanticContentScanEligible(file: FileMetadata, queryPlan: RelayDocumentSearchQueryPlanV1): boolean {
  if (!queryPlan.semanticConceptGroups.length) return true;
  if (semanticScoreForCandidate(file, queryPlan).allowed) return true;
  const haystack = normalizedFileHaystack(file);
  return queryPlan.semanticConceptGroups.some((group) =>
    matchedSemanticTerms(haystack, [...group.directTerms, ...group.recallTerms]).length > 0,
  );
}

function isTransientOfficeLockFile(file: FileMetadata): boolean {
  return file.name.startsWith('~$');
}

function fileMatchesExcludedTerms(file: FileMetadata, excludedTerms: string[]): boolean {
  if (!excludedTerms.length) return false;
  const name = normalizeRelaySearchText(file.name);
  const displayPath = normalizeRelaySearchText(file.displayPath);
  const haystack = `${name} ${displayPath}`;
  return excludedTerms.some((term) => term.length >= 2 && haystack.includes(term));
}

function recencyScoreForCandidate(
  file: FileMetadata,
  preference: 'neutral' | 'prefer_recent' | 'prefer_older' | undefined,
  now: Date,
): number {
  if (!file.modifiedTime || !preference || preference === 'neutral') return 0;
  const modifiedMs = Date.parse(file.modifiedTime);
  if (!Number.isFinite(modifiedMs)) return 0;
  const ageDays = Math.max(0, (now.getTime() - modifiedMs) / 86_400_000);
  if (preference === 'prefer_recent') {
    if (ageDays <= 7) return 3;
    if (ageDays <= 90) return 2;
    if (ageDays <= 365) return 1;
    return 0.25;
  }
  if (ageDays > 365 * 3) return 2;
  if (ageDays > 365) return 1;
  return 0;
}

function candidateBucketForFolderRoles(
  folderRoles: RelayDocumentSearchFolderRoleReport,
): RelayDocumentSearchCandidateBucket {
  const roles = new Set([
    folderRoles.primaryRole,
    ...folderRoles.roles.map((role) => role.role),
  ].filter(Boolean));
  if (roles.has('source') || roles.has('work')) return 'direct_source_workpaper';
  if (roles.has('backup')) return 'backup_or_archive';
  if (roles.has('audit') || roles.has('review')) return 'review_or_audit';
  if (roles.has('filing') || roles.has('output')) return 'disclosure_output';
  return 'uncategorized';
}

function folderRoleScoreForCandidate(file: FileMetadata): { score: number; reasons: string[] } {
  const bucket = candidateBucketForFolderRoles(classifyRelayDocumentSearchFolderRoles(file.displayPath));
  switch (bucket) {
    case 'direct_source_workpaper':
      return { score: 4, reasons: ['folder_role:direct_source_workpaper'] };
    case 'supporting_evidence':
      return { score: 1, reasons: ['folder_role:supporting_evidence'] };
    case 'review_or_audit':
      return { score: -2, reasons: ['folder_role:review_or_audit'] };
    case 'disclosure_output':
      return { score: -3, reasons: ['folder_role:disclosure_output'] };
    case 'backup_or_archive':
      return { score: -5, reasons: ['folder_role:backup_or_archive'] };
    default:
      return { score: 0, reasons: [] };
  }
}

function summarizeCandidateBuckets(
  results: Array<Record<string, unknown>>,
): Record<RelayDocumentSearchCandidateBucket, number> {
  const summary: Record<RelayDocumentSearchCandidateBucket, number> = {
    direct_source_workpaper: 0,
    supporting_evidence: 0,
    disclosure_output: 0,
    backup_or_archive: 0,
    review_or_audit: 0,
    uncategorized: 0,
  };
  for (const result of results) {
    const bucket = result.candidate_bucket;
    if (typeof bucket === 'string' && bucket in summary) {
      summary[bucket as RelayDocumentSearchCandidateBucket] += 1;
    }
  }
  return summary;
}

function scoreFromReasons(reasons: string[], prefix: string, weight: number): number {
  return reasons.filter((reason) => reason.startsWith(prefix)).length * weight;
}

function warningPenalty(
  warnings: string[],
  request: RelayDocumentSearchRequestV1,
): number {
  const requiresContent = requiresContentConfirmation(request);
  return warnings.reduce((sum, warning) => {
    switch (warning) {
      case 'filename_only':
        return sum + (requiresContent ? 2 : 1);
      case 'content_not_confirmed':
        return sum + (requiresContent ? 5 : 2);
      case 'content_reader_unavailable':
        return sum + (requiresContent ? 6 : 3);
      case 'unsupported_content_reader':
        return sum + (requiresContent ? 4 : 2);
      case 'stale':
      case 'failed':
      case 'permission_denied':
      case 'permission_changed':
      case 'access_denied':
      case 'not_found':
      case 'offline_share':
      case 'locked_file':
      case 'policy_denied':
      case 'preview_denied':
      case 'open_denied':
        return sum + 8;
      case 'open_offline':
      case 'open_policy_blocked':
      case 'preview_failed':
        return sum + 6;
      case 'skipped':
        return sum + 4;
      default:
        return sum + 1;
    }
  }, 0);
}

function rankingWarningsForCandidate(
  file: FileMetadata,
  request: RelayDocumentSearchRequestV1,
  hasContentEvidence: boolean,
): string[] {
  const contentWarning = contentWarningForCandidate(file, request, hasContentEvidence);
  return [...new Set([
    ...(hasContentEvidence ? [] : ['filename_only']),
    ...(contentWarning ? [contentWarning] : []),
    ...accessWarningsForFile(file),
  ])];
}

function evidenceStateForCandidate(
  candidate: RankedCandidate,
  queryPlan: RelayDocumentSearchQueryPlanV1,
): RelayDocumentSearchEvidenceState {
  if (!candidate.contentEvidence) return 'filename_only';
  if (!queryPlan.semanticConceptGroups.length) return 'content_confirmed';
  const semanticMatch = semanticConceptMatchForCandidate(candidate.file, candidate.contentEvidence, queryPlan);
  if (semanticMatch.matched && semanticMatch.confirmed) return 'concept_confirmed';
  if (semanticMatch.matched && semanticMatch.entityContext) return 'entity_context_match';
  if (semanticMatch.matched) return 'concept_candidate';
  return contentEvidenceMatchedTerms(candidate.contentEvidence).length ? 'partial_content_match' : 'generic_content_match';
}

function modifiedTimeMs(file: FileMetadata): number {
  const parsed = Date.parse(file.modifiedTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withRrfHybridScores(candidates: RankedCandidate[]): RankedCandidate[] {
  const scores = new Map<string, number>();
  const addSource = (items: RankedCandidate[]) => {
    const ranked = items
      .filter((candidate) => candidate.baseScore > 0)
      .sort(compareRankedCandidatesWithoutRrf);
    ranked.forEach((candidate, index) => {
      const current = scores.get(candidate.file.fileId) ?? 0;
      scores.set(candidate.file.fileId, current + (1 / (60 + index + 1)));
    });
  };
  addSource(candidates.filter((candidate) => candidate.filenameScore + candidate.pathScore + candidate.termScore > 0));
  addSource(candidates.filter((candidate) => candidate.indexDbScore > 0));
  addSource(candidates.filter((candidate) => candidate.contentScore > 0));
  addSource(candidates.filter((candidate) => candidate.recencyScore > 0));
  addSource(candidates.filter((candidate) => candidate.userMemoryBoost > 0));
  addSource(candidates.filter((candidate) => candidate.folderRoleScore > 0));
  return candidates.map((candidate) => ({
    ...candidate,
    rrfScore: Number((scores.get(candidate.file.fileId) ?? 0).toFixed(6)),
  }));
}

function compareRankedCandidatesWithoutRrf(left: RankedCandidate, right: RankedCandidate): number {
  const leftContent = left.contentEvidence ? 1 : 0;
  const rightContent = right.contentEvidence ? 1 : 0;
  return (
    right.score - left.score ||
    rightContent - leftContent ||
    right.userMemoryBoost - left.userMemoryBoost ||
    right.baseScore - left.baseScore ||
    left.warningPenalty - right.warningPenalty ||
    modifiedTimeMs(right.file) - modifiedTimeMs(left.file) ||
    left.file.displayPath.localeCompare(right.file.displayPath) ||
    left.file.fileId.localeCompare(right.file.fileId)
  );
}

function compareRankedCandidates(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.rrfScore - left.rrfScore ||
    compareRankedCandidatesWithoutRrf(left, right)
  );
}

function compareRankedCandidatesWithIndexDbPrimary(left: RankedCandidate, right: RankedCandidate): number {
  const leftIndexDb = left.indexDbScore > 0 ? 1 : 0;
  const rightIndexDb = right.indexDbScore > 0 ? 1 : 0;
  return (
    rightIndexDb - leftIndexDb ||
    right.indexDbScore - left.indexDbScore ||
    right.indexDbUncappedScore - left.indexDbUncappedScore ||
    compareRankedCandidates(left, right)
  );
}

function diversifyRankedCandidates(candidates: RankedCandidate[], maxResults: number): DiversityResult {
  const uniqueDirectoryCount = new Set(candidates.map((candidate) => directoryBucket(candidate.file.displayPath))).size;
  const perDirectoryLimit = Math.max(1, Math.ceil(maxResults * DEFAULT_DIRECTORY_DIVERSITY_RATIO));
  const selected: RankedCandidate[] = [];
  const deferred: RankedCandidate[] = [];
  const counts = new Map<string, number>();

  for (const candidate of candidates) {
    const bucket = directoryBucket(candidate.file.displayPath);
    const count = counts.get(bucket) ?? 0;
    if (count < perDirectoryLimit && selected.length < maxResults) {
      selected.push(candidate);
      counts.set(bucket, count + 1);
    } else {
      deferred.push(candidate);
    }
  }

  for (const candidate of deferred) {
    if (selected.length >= maxResults) break;
    selected.push(candidate);
  }

  return {
    candidates: selected.slice(0, maxResults),
    perDirectoryLimit,
    uniqueDirectoryCount,
    deferredCandidateCount: deferred.length,
  };
}

function scoreComponent(
  score: number,
  applied: boolean,
  reason: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    score,
    applied,
    reason,
    ...extra,
  };
}

function scoreBreakdownForCandidate(
  candidate: RankedCandidate,
  group: RelayDocumentSearchResultGroup | undefined,
  activePath: string,
): RelayDocumentSearchScoreBreakdown {
  const tableCellScore = contentEvidenceHasTableAnchor(candidate.contentEvidence)
    ? candidate.contentScore || candidate.indexDbScore
    : 0;
  const filenameReasonCount = candidate.reasons.filter((reason) => reason.startsWith('filename:')).length;
  const pathReasonCount = candidate.reasons.filter((reason) => reason.startsWith('path:')).length;
  const termReasonCount = candidate.reasons.filter((reason) => reason.startsWith('term:')).length;
  const folderRoleReasonCount = candidate.reasons.filter((reason) => reason.startsWith('folder_role:')).length;
  const explanationCodes = [...candidate.reasons, ...candidate.rankingWarnings.map((warning) => `warning:${warning}`)];
  const tieBreakers = [
    'rrf_score',
    'score',
    'content_evidence',
    'pin_history',
    'base_score',
    'warning_penalty',
    'modified_time',
    'display_path',
    'file_id',
  ];
  return {
    score_breakdown_contract: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
    schemaVersion: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
    rankingVersion: RELAY_DOCUMENT_SEARCH_RANKING_VERSION,
    deterministic: true,
    filename: filenameReasonCount,
    path: pathReasonCount,
    term: termReasonCount,
    filename_score: candidate.filenameScore,
    path_score: candidate.pathScore,
    term_score: candidate.termScore,
    folder_role: candidate.folderRoleScore,
    sqlite_fts: candidate.indexDbScore,
    sqlite_fts_uncapped: candidate.indexDbUncappedScore,
    sqlite_fts_cap_loss: candidate.indexDbScoreCapLoss,
    memory: candidate.userMemoryBoost,
    pin_history: candidate.userMemoryBoost,
    content: candidate.contentScore,
    table_cell: tableCellScore,
    recency: candidate.recencyScore,
    rrf_score: candidate.rrfScore,
    grouping: 0,
    hybrid_merge: candidate.baseScore,
    base_score: candidate.baseScore,
    warning_penalty: candidate.warningPenalty,
    final_score: candidate.score,
    components: {
      filename: scoreComponent(candidate.filenameScore, candidate.filenameScore > 0, 'filename_match', {
        count: filenameReasonCount,
      }),
      path: scoreComponent(candidate.pathScore, candidate.pathScore > 0, 'path_match', {
        count: pathReasonCount,
      }),
      keyword: scoreComponent(candidate.termScore, candidate.termScore > 0, 'normalized_keyword_match', {
        count: termReasonCount,
      }),
      folder_role: scoreComponent(candidate.folderRoleScore, candidate.folderRoleScore !== 0, 'folder_role_preference', {
        count: folderRoleReasonCount,
      }),
      sqlite_fts: scoreComponent(candidate.indexDbScore, candidate.indexDbScore > 0, 'sqlite_fts_match', {
        rawScore: candidate.indexDbUncappedScore,
        cappedScore: candidate.indexDbScore,
        capLoss: candidate.indexDbScoreCapLoss,
      }),
      content: scoreComponent(candidate.contentScore, candidate.contentScore > 0, 'derived_content_match'),
      table_cell: scoreComponent(tableCellScore, tableCellScore > 0, 'table_or_cell_match'),
      recency: scoreComponent(candidate.recencyScore, candidate.recencyScore > 0, 'modified_time_preference', {
        details: { modifiedTimePresent: Boolean(candidate.file.modifiedTime) },
      }),
      rrf: scoreComponent(candidate.rrfScore, candidate.rrfScore > 0, 'reciprocal_rank_fusion', {
        details: {
          sources: ['filename_path', 'sqlite_fts', 'derived_content', 'recency', 'pin_history', 'folder_role'],
          k: 60,
        },
      }),
      pin_history: scoreComponent(candidate.userMemoryBoost, candidate.userMemoryBoost > 0, 'pinned_or_recent_user_signal'),
      grouping: scoreComponent(0, Boolean(group), group ? 'variant_group_representative' : 'not_grouped', {
        count: group?.collapsedCount ?? 0,
        details: group
          ? {
              memberCount: group.memberCount,
              collapsedCount: group.collapsedCount,
              variantReasons: group.variantReasons,
            }
          : undefined,
      }),
      warning_penalty: scoreComponent(-Math.abs(candidate.warningPenalty), candidate.warningPenalty > 0, 'warning_confidence_penalty', {
        rawScore: candidate.warningPenalty,
        details: { warnings: candidate.rankingWarnings },
      }),
      hybrid_merge: scoreComponent(candidate.baseScore, true, 'deterministic_hybrid_merge', {
        details: {
          activePath,
          filenamePathKeywordScore: candidate.filenameScore + candidate.pathScore + candidate.termScore,
          folderRoleScore: candidate.folderRoleScore,
          contentScore: candidate.contentScore,
          sqliteFtsScore: candidate.indexDbScore,
          recencyScore: candidate.recencyScore,
          pinHistoryScore: candidate.userMemoryBoost,
          rrfScore: candidate.rrfScore,
        },
      }),
    },
    totals: {
      baseScore: candidate.baseScore,
      penaltyScore: candidate.warningPenalty,
      finalScore: candidate.score,
      uncappedScore: candidate.baseScore + candidate.indexDbScoreCapLoss,
      capLoss: candidate.indexDbScoreCapLoss,
    },
    tieBreakers,
    explanationCodes,
  };
}

function rankingScoreBreakdownSummary(
  candidates: RankedCandidate[],
  returned: RankedCandidate[],
  collapsedCandidateCount: number,
  activePath: string,
): RankingScoreBreakdownSummary {
  const sum = (items: RankedCandidate[], selector: (candidate: RankedCandidate) => number) =>
    items.reduce((total, candidate) => total + selector(candidate), 0);
  return {
    score_breakdown_contract: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
    rankingVersion: RELAY_DOCUMENT_SEARCH_RANKING_VERSION,
    deterministic: true,
    candidateCount: candidates.length,
    returnedCount: returned.length,
    activePath,
    componentTotals: {
      filename: sum(returned, (candidate) => candidate.filenameScore),
      path: sum(returned, (candidate) => candidate.pathScore),
      keyword: sum(returned, (candidate) => candidate.termScore),
      folder_role: sum(returned, (candidate) => candidate.folderRoleScore),
      sqlite_fts: sum(returned, (candidate) => candidate.indexDbScore),
      content: sum(returned, (candidate) => candidate.contentScore),
      table_cell: sum(returned, (candidate) =>
        contentEvidenceHasTableAnchor(candidate.contentEvidence)
          ? candidate.contentScore || candidate.indexDbScore
          : 0,
      ),
      recency: sum(returned, (candidate) => candidate.recencyScore),
      rrf: sum(returned, (candidate) => candidate.rrfScore),
      pin_history: sum(returned, (candidate) => candidate.userMemoryBoost),
      grouping: 0,
      warning_penalty: -sum(returned, (candidate) => candidate.warningPenalty),
      hybrid_merge: sum(returned, (candidate) => candidate.baseScore),
    },
    warningPenaltyTotal: sum(candidates, (candidate) => candidate.warningPenalty),
    groupingCollapsedCandidateCount: collapsedCandidateCount,
    hybridMergeMode: activePath === 'sqlite_fts_primary' ? 'sqlite_fts_primary_rrf' : 'filename_content_rrf',
  };
}

function fileTypeMatches(file: FileMetadata, request: RelayDocumentSearchRequestV1): boolean {
  return request.fileTypes.includes('any') || request.fileTypes.includes(file.extension as never);
}

function shouldInspectContent(request: RelayDocumentSearchRequestV1): boolean {
  return (
    request.thoroughness === 'thorough' ||
    request.evidence === 'required' ||
    request.intent === 'answer_with_evidence' ||
    request.intent === 'summarize_with_evidence' ||
    request.intent === 'inspect_file'
  );
}

function requiresContentConfirmation(request: RelayDocumentSearchRequestV1): boolean {
  return (
    request.evidence === 'required' ||
    request.intent === 'answer_with_evidence' ||
    request.intent === 'summarize_with_evidence' ||
    request.intent === 'inspect_file'
  );
}

function accessWarningsForFile(file: FileMetadata): string[] {
  const snapshots = file.accessSnapshots;
  if (!snapshots) return [];
  const warnings: string[] = [];
  for (const [action, snapshot] of Object.entries(snapshots)) {
    if (!snapshot || snapshot.state === 'ok' || snapshot.state === 'unknown') continue;
    if (snapshot.warningCode) warnings.push(snapshot.warningCode);
    switch (snapshot.state) {
      case 'access_denied':
        warnings.push('access_denied');
        if (action === 'preview') warnings.push('preview_denied');
        if (action === 'open') warnings.push('open_denied');
        break;
      case 'not_found':
        warnings.push('not_found');
        break;
      case 'offline_share':
        warnings.push('offline_share');
        if (action === 'open') warnings.push('open_offline');
        break;
      case 'locked_file':
        warnings.push('locked_file');
        if (action === 'preview') warnings.push('preview_failed');
        break;
      case 'policy_denied':
        warnings.push('policy_denied');
        if (action === 'preview') warnings.push('preview_denied');
        if (action === 'open') warnings.push('open_policy_blocked');
        break;
      default:
        break;
    }
  }
  return [...new Set(warnings)];
}

function contentAccessUnavailable(file: FileMetadata): boolean {
  const metadataState = file.accessSnapshots?.metadata?.state;
  const contentState = file.accessSnapshots?.content?.state;
  return [metadataState, contentState].some((state) =>
    state === 'access_denied' ||
      state === 'not_found' ||
      state === 'offline_share' ||
      state === 'locked_file' ||
      state === 'policy_denied',
  );
}

function contentWarningForCandidate(
  file: FileMetadata,
  request: RelayDocumentSearchRequestV1,
  hasContentEvidence: boolean,
): string | undefined {
  if (!shouldInspectContent(request) || hasContentEvidence) return undefined;
  if (contentAccessUnavailable(file)) return accessWarningsForFile(file)[0] ?? 'access_denied';
  if (PDF_CONTENT_EXTENSIONS.has(file.extension)) return 'content_reader_unavailable';
  if (TEXT_CONTENT_EXTENSIONS.has(file.extension) || STRUCTURED_CONTENT_EXTENSIONS.has(file.extension)) {
    return 'content_not_confirmed';
  }
  return 'unsupported_content_reader';
}

function lineSnippet(line: string): string {
  return line.replace(/\s+/gu, ' ').trim().slice(0, 240);
}

function matchedTermsForText(text: string, terms: string[]): string[] {
  const normalized = normalizeRelaySearchText(text);
  return terms.filter((term) => term && normalized.includes(term));
}

function contentInspectionTerms(queryPlan: RelayDocumentSearchQueryPlanV1): string[] {
  const out = new Set<string>(queryPlan.normalizedTerms);
  for (const group of queryPlan.semanticConceptGroups) {
    for (const term of group.directTerms) out.add(term);
    for (const termGroup of group.allOfAny) {
      for (const term of termGroup) out.add(term);
    }
  }
  return [...out].filter(Boolean);
}

function evidenceForAnchor(
  file: FileMetadata,
  parsedDocument: RelayParsedDocument,
  anchor: Record<string, unknown>,
): Record<string, unknown> {
  return {
    file_id: file.fileId,
    path: file.path,
    display_path: file.displayPath,
    anchor,
    evidence_state: 'content_confirmed',
    source_metadata_version: file.sourceMetadataVersion,
    parsed_document_uid: parsedDocument.metadata.uid,
  };
}

function textAnchorForNode(
  parsedDocument: RelayParsedDocument,
  node: RelayParsedDocument['content']['structure']['subparagraphs'][number],
  matchedTerms: string[],
): Record<string, unknown> {
  return {
    type: 'text_excerpt',
    node_id: node.node_id,
    line_id: node.metadata.line_id,
    line: node.metadata.line_number,
    page_id: node.metadata.page_id,
    snippet: lineSnippet(node.text),
    matchedTerms,
    parsed_document_version: parsedDocument.version,
    parser_name: parsedDocument.parser.name,
    parser_profile: parsedDocument.parser.profile,
    anchor_confidence: node.metadata.page_anchors_available === false ? 'medium' : 'high',
    page_anchors_available: node.metadata.page_anchors_available,
    extraction_method: node.metadata.extraction_method,
    office_format: node.metadata.office_format,
  };
}

function tableCellAnchors(
  file: FileMetadata,
  parsedDocument: RelayParsedDocument,
  terms: string[],
): { score: number; anchors: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>> } {
  const anchors: Array<Record<string, unknown>> = [];
  const evidence: Array<Record<string, unknown>> = [];
  let score = 0;
  for (const table of parsedDocument.content.tables) {
    if (anchors.length >= DEFAULT_MAX_EVIDENCE_ANCHORS) break;
    for (const row of table.rows) {
      if (anchors.length >= DEFAULT_MAX_EVIDENCE_ANCHORS) break;
      for (const cell of row) {
        if (anchors.length >= DEFAULT_MAX_EVIDENCE_ANCHORS) break;
        const searchable = [
          cell.text,
          typeof cell.metadata.formula === 'string' ? cell.metadata.formula : '',
          typeof cell.metadata.cell_address === 'string' ? cell.metadata.cell_address : '',
          typeof cell.metadata.sheet_name === 'string' ? cell.metadata.sheet_name : '',
        ].join(' ');
        const matchedTerms = matchedTermsForText(searchable, terms);
        if (!matchedTerms.length) continue;
        score += 12 + matchedTerms.length;
        const anchor = {
          type: 'cell_excerpt',
          table_id: table.table_id,
          cell_id: cell.cell_id,
          row: cell.row,
          column: cell.column,
          sheet_name: cell.metadata.sheet_name,
          sheet_index: cell.metadata.sheet_index,
          cell_address: cell.metadata.cell_address,
          hidden_state: cell.metadata.hidden_state,
          cached_value_state: cell.metadata.cached_value_state,
          has_formula: Boolean(cell.metadata.formula),
          snippet: lineSnippet(cell.text || String(cell.metadata.formula || '')),
          matchedTerms,
          parsed_document_version: parsedDocument.version,
          parser_name: parsedDocument.parser.name,
          parser_profile: parsedDocument.parser.profile,
          anchor_confidence: 'high',
        };
        anchors.push(anchor);
        evidence.push(evidenceForAnchor(file, parsedDocument, anchor));
      }
    }
  }
  return { score, anchors, evidence };
}

function recordParsedDocumentCachePolicy(
  cacheState: ParsedDocumentCacheState,
  policy: RelayParsedDocumentCachePolicyResult,
): void {
  if (cacheState.policy.some((item) =>
    item.mode === policy.mode &&
    item.reason === policy.reason &&
    item.protectionState === policy.protectionState &&
    item.readAllowed === policy.readAllowed &&
    item.writeAllowed === policy.writeAllowed
  )) {
    return;
  }
  cacheState.policy.push(policy);
}

function recordDerivedContentIndexCachePolicy(
  cacheState: DerivedContentIndexCacheState,
  policy: RelayDocumentSearchDerivedContentIndexCachePolicyResult,
): void {
  if (cacheState.policy.some((item) =>
    item.mode === policy.mode &&
    item.reason === policy.reason &&
    item.protectionState === policy.protectionState &&
    item.readAllowed === policy.readAllowed &&
    item.writeAllowed === policy.writeAllowed
  )) {
    return;
  }
  cacheState.policy.push(policy);
}

function recordContentIndexCommitReport(
  state: ContentIndexCommitState,
  report: RelayDocumentSearchContentIndexCommitReport,
): void {
  state.reports.push(report);
  if (report.status === 'committed') {
    state.committedCount += 1;
  } else if (report.status === 'stale_previous_active') {
    state.staleFallbackCount += 1;
  } else if (report.status === 'failed') {
    state.failedCount += 1;
  }
  for (const error of report.errors) {
    state.errors.push({ message: error });
  }
}

function failureRegistryEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  return options.useFailureRegistry === true || Boolean(options.failureRegistryDir);
}

function parsedDocumentFailureCode(parsedDocument: RelayParsedDocument): string | undefined {
  return parsedDocument.warnings.find((warning) => warning.severity === 'error')?.code ??
    parsedDocument.warnings[0]?.code;
}

async function recordFileFailure(
  file: FileMetadata,
  kind: RelayDocumentSearchFailureKind,
  code: string,
  source: string,
  options: RelayDocumentSearchExecutorOptions,
  message?: string,
): Promise<void> {
  if (!failureRegistryEnabled(options)) return;
  try {
    await recordRelayDocumentSearchFailure(
      {
        root: file.root,
        path: file.path,
        displayPath: file.displayPath,
        fileId: file.fileId,
        kind,
        code,
        message,
        source,
      },
      {
        failureRegistryDir: options.failureRegistryDir,
        failureRegistryMaxEntries: options.failureRegistryMaxEntries,
        now: options.now,
      },
    );
  } catch {
    // Search results should not fail because local diagnostics could not be written.
  }
}

async function readParsedDocumentForContent(
  file: FileMetadata,
  options: RelayDocumentSearchExecutorOptions,
  cacheState: ParsedDocumentCacheState,
): Promise<ParsedDocumentReadResult | undefined> {
  const parserVersion = parserVersionForFile(file);
  if (!parserVersion) return undefined;

  if (parsedDocumentCacheEnabled(options)) {
    const cached = await readRelayParsedDocumentCache(file, parserVersion, {
      cacheDir: options.parsedDocumentCacheDir,
      maxAgeMs: options.parsedDocumentCacheMaxAgeMs,
      now: options.now,
      cacheProtectionMode: options.parsedDocumentCacheProtectionMode,
      protectedAtRest: options.parsedDocumentCacheProtectedAtRest,
      onPolicy: (policy) => recordParsedDocumentCachePolicy(cacheState, policy),
    });
    if (cached) {
      cacheState.hits.push(file.path);
      return { parsedDocument: cached.parsedDocument, cacheRecord: cached, cacheHit: true };
    }
    cacheState.misses.push(file.path);
  }

  const parsedDocument = PDF_CONTENT_EXTENSIONS.has(file.extension)
    ? await readPdfFileAsRelayParsedDocument(file)
    : STRUCTURED_CONTENT_EXTENSIONS.has(file.extension)
      ? await readOfficeOpenXmlFileAsRelayParsedDocument(file)
      : await readTextFileAsRelayParsedDocument(file);

  if (parsedDocument?.parser_confidence === 'low') {
    await recordFileFailure(
      file,
      'parser',
      parsedDocumentFailureCode(parsedDocument) ?? 'parser_low_confidence',
      parsedDocument.parser.name,
      options,
    );
  }

  return parsedDocument ? { parsedDocument, cacheHit: false } : undefined;
}

async function inspectTextContent(
  file: FileMetadata,
  terms: string[],
  options: RelayDocumentSearchExecutorOptions,
  cacheState: ParsedDocumentCacheState,
  derivedCacheState: DerivedContentIndexCacheState,
  indexDb: IndexDbState,
  contentIndexCommit: ContentIndexCommitState,
): Promise<ContentEvidence | undefined> {
  if (!READABLE_CONTENT_EXTENSIONS.has(file.extension)) return undefined;
  const parsedResult = await readParsedDocumentForContent(file, options, cacheState);
  const parsedDocument = parsedResult?.parsedDocument;
  if (!parsedDocument || parsedDocument.parser_confidence === 'low') return undefined;
  let derivedIndex: RelayDocumentSearchDerivedContentIndexV1 | undefined;
  let derivedSearchStore: RelayDocumentSearchDerivedSearchStoreV1 | undefined;
  let derivedCacheRecord: RelayDocumentSearchDerivedContentIndexCacheRecord | undefined;
  if (derivedContentIndexCacheEnabled(options)) {
    const cached = await readRelayDocumentSearchDerivedContentIndexCache(parsedDocument, {
      cacheDir: options.derivedContentIndexDir,
      maxAgeMs: options.derivedContentIndexMaxAgeMs,
      maxCacheBytes: options.derivedContentIndexCacheMaxBytes,
      maxCacheEntries: options.derivedContentIndexCacheMaxEntries,
      cacheProtectionMode: options.derivedContentIndexCacheProtectionMode,
      protectedAtRest: options.derivedContentIndexCacheProtectedAtRest,
      now: options.now,
      onPolicy: (policy) => recordDerivedContentIndexCachePolicy(derivedCacheState, policy),
    });
    if (cached) {
      derivedCacheState.hits.push(file.path);
      derivedCacheRecord = cached;
      derivedIndex = cached.index;
      derivedSearchStore = cached.searchStore;
    } else {
      derivedCacheState.misses.push(file.path);
    }
  }
  if (!derivedIndex) {
    derivedIndex = buildRelayDocumentSearchDerivedContentIndex(parsedDocument);
    derivedSearchStore = buildRelayDocumentSearchDerivedSearchStore(derivedIndex);
  }
  if (!derivedSearchStore) {
    derivedSearchStore = buildRelayDocumentSearchDerivedSearchStore(derivedIndex);
  }
  let parsedStage: RelayParsedDocumentCacheStage | undefined;
  let derivedStage: RelayDocumentSearchDerivedContentIndexCacheStage | undefined;
  let parsedCacheRecord = parsedResult.cacheRecord;
  const builtDerivedForThisScan = !derivedCacheRecord;
  if (builtDerivedForThisScan) {
    contentIndexCommit.attemptedCount += 1;
    try {
      if (parsedDocumentCacheEnabled(options) && !parsedResult.cacheHit) {
        parsedStage = await stageRelayParsedDocumentCache(file, parsedDocument, {
          cacheDir: options.parsedDocumentCacheDir,
          now: options.now,
          cacheProtectionMode: options.parsedDocumentCacheProtectionMode,
          protectedAtRest: options.parsedDocumentCacheProtectedAtRest,
          onPolicy: (policy) => recordParsedDocumentCachePolicy(cacheState, policy),
          onQuota: (result) => cacheState.quota.push(result),
        });
      }
      if (derivedContentIndexCacheEnabled(options)) {
        derivedStage = await stageRelayDocumentSearchDerivedContentIndexCache(parsedDocument, derivedIndex, {
          cacheDir: options.derivedContentIndexDir,
          maxAgeMs: options.derivedContentIndexMaxAgeMs,
          maxCacheBytes: options.derivedContentIndexCacheMaxBytes,
          maxCacheEntries: options.derivedContentIndexCacheMaxEntries,
          cacheProtectionMode: options.derivedContentIndexCacheProtectionMode,
          protectedAtRest: options.derivedContentIndexCacheProtectedAtRest,
          now: options.now,
          onPolicy: (policy) => recordDerivedContentIndexCachePolicy(derivedCacheState, policy),
          onQuota: (result) => derivedCacheState.quota.push(result),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (parsedStage) await parsedStage.discard().catch(() => undefined);
      if (derivedStage) await derivedStage.discard().catch(() => undefined);
      cacheState.writeErrors.push({ path: file.path, message });
      derivedCacheState.writeErrors.push({ path: file.path, message });
      await recordFileFailure(file, 'index', 'content_index_stage_failed', 'content-index-transaction', options, message);
      if (contentIndexCommit.enabled) {
        const report = await markRelayDocumentSearchContentIndexActivePointerStale(file.fileId, 'content_index_stage_failed', {
          coordinatorDir: options.indexCoordinatorDir,
          now: options.now,
          ownerId: options.jobId,
          appVersion: options.appVersion,
          jobId: options.jobId,
          message,
        });
        recordContentIndexCommitReport(contentIndexCommit, report);
      }
    }
  }
  const indexDbWrite = await writeIndexDbDerivedSearchStore(file, derivedSearchStore, options, indexDb);
  if (builtDerivedForThisScan) {
    const indexDbFailed = Boolean(indexDbWrite?.errors.length);
    if (indexDbFailed) {
      const message = indexDbWrite?.errors.join('; ') || 'index_db_write_failed';
      await parsedStage?.discard().catch(() => undefined);
      await derivedStage?.discard().catch(() => undefined);
      await recordFileFailure(file, 'index', 'content_index_commit_failed', 'index-db', options, message);
      if (contentIndexCommit.enabled) {
        const report = await markRelayDocumentSearchContentIndexActivePointerStale(file.fileId, 'index_db_write_failed', {
          coordinatorDir: options.indexCoordinatorDir,
          now: options.now,
          ownerId: options.jobId,
          appVersion: options.appVersion,
          jobId: options.jobId,
          message,
        });
        recordContentIndexCommitReport(contentIndexCommit, report);
      }
    } else {
      try {
        if (derivedStage) {
          derivedCacheRecord = await derivedStage.promote();
          derivedCacheState.writes.push(file.path);
        }
        if (parsedStage) {
          parsedCacheRecord = await parsedStage.promote();
          cacheState.writes.push(file.path);
        }
        if (contentIndexCommit.enabled) {
          const report = await commitRelayDocumentSearchContentIndexActivePointer({
            jobId: options.jobId,
            sourceFileId: file.fileId,
            sourcePath: file.path,
            sourceMetadataVersion: file.sourceMetadataVersion,
            parsedDocumentUid: parsedDocument.metadata.uid,
            parsedDocumentVersion: parsedDocument.version,
            parserVersion: parsedDocument.parser.version,
            parsedCacheKey: parsedCacheRecord?.cacheKey,
            derivedCacheKey: derivedCacheRecord?.cacheKey,
            searchStoreRowCount: derivedSearchStore.diagnostics.rowCount,
            ftsRowCount: indexDbWrite?.ftsRowCount ?? 0,
            previewSpanCount: indexDbWrite?.previewSpanRowCount ?? derivedSearchStore.diagnostics.previewSpanSeedCount,
          }, {
            coordinatorDir: options.indexCoordinatorDir,
            now: options.now,
            ownerId: options.jobId,
            appVersion: options.appVersion,
          });
          recordContentIndexCommitReport(contentIndexCommit, report);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await parsedStage?.discard().catch(() => undefined);
        await derivedStage?.discard().catch(() => undefined);
        cacheState.writeErrors.push({ path: file.path, message });
        derivedCacheState.writeErrors.push({ path: file.path, message });
        await recordFileFailure(file, 'index', 'content_index_promote_failed', 'content-index-transaction', options, message);
        if (contentIndexCommit.enabled) {
          const report = await markRelayDocumentSearchContentIndexActivePointerStale(file.fileId, 'content_index_promote_failed', {
            coordinatorDir: options.indexCoordinatorDir,
            now: options.now,
            ownerId: options.jobId,
            appVersion: options.appVersion,
            jobId: options.jobId,
            message,
          });
          recordContentIndexCommitReport(contentIndexCommit, report);
        }
      }
    }
  }
  const derivedSearch = searchRelayDocumentSearchDerivedSearchStore(derivedSearchStore, terms, {
    maxAnchors: DEFAULT_MAX_EVIDENCE_ANCHORS,
  });
  const anchors = derivedSearch.anchors;
  const evidence = anchors.map((anchor) => evidenceForAnchor(file, parsedDocument, anchor));
  return derivedSearch.score > 0
    ? { source: 'derived_search_store', score: derivedSearch.score, anchors, evidence, parsedDocument, derivedIndex, derivedSearchStore, derivedSearch }
    : undefined;
}

async function collectContentEvidence(
  files: FileMetadata[],
  terms: string[],
  request: RelayDocumentSearchRequestV1,
  state: WalkState,
  options: RelayDocumentSearchExecutorOptions,
  parsedDocumentCache: ParsedDocumentCacheState,
  derivedContentIndexCache: DerivedContentIndexCacheState,
  indexDb: IndexDbState,
  contentIndexCommit: ContentIndexCommitState,
): Promise<{ byFileId: Map<string, ContentEvidence>; scannedFiles: number; skippedFiles: number }> {
  const byFileId = new Map<string, ContentEvidence>();
  if (!shouldInspectContent(request) || terms.length === 0 || shouldStop(state)) {
    return { byFileId, scannedFiles: 0, skippedFiles: 0 };
  }

  let scannedFiles = 0;
  let skippedFiles = 0;
  const maxContentInspectFiles = maxContentInspectFilesForOptions(options);
  emitProgress(state, 'content_scan', 60);
  for (const file of files) {
    if (shouldStop(state)) break;
    if (scannedFiles >= maxContentInspectFiles) break;
    if (contentAccessUnavailable(file)) {
      skippedFiles += 1;
      continue;
    }
    if (!READABLE_CONTENT_EXTENSIONS.has(file.extension)) {
      skippedFiles += 1;
      continue;
    }
    scannedFiles += 1;
    try {
      const evidence = await inspectTextContent(
        file,
        terms,
        options,
        parsedDocumentCache,
        derivedContentIndexCache,
        indexDb,
        contentIndexCommit,
      );
      if (evidence) byFileId.set(file.fileId, evidence);
    } catch (error) {
      skippedFiles += 1;
      await recordFileFailure(
        file,
        'content',
        'content_inspection_failed',
        'content-scan',
        options,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (scannedFiles % 50 === 0) emitProgress(state, 'content_scan', 70);
  }
  return { byFileId, scannedFiles, skippedFiles };
}

function filesForCandidateFirstContentScan(
  files: FileMetadata[],
  filenameMatches: Map<string, RelayDocumentSearchFilenameIndexMatch>,
  request: RelayDocumentSearchRequestV1,
  queryPlan: RelayDocumentSearchQueryPlanV1,
): FileMetadata[] {
  if (queryPlan.contentStrategy !== 'candidate_first' || requiresContentConfirmation(request)) {
    return files;
  }

  const limit = Math.min(
    CANDIDATE_FIRST_CONTENT_SCAN_MAX_FILES,
    Math.max(CANDIDATE_FIRST_CONTENT_SCAN_MIN_FILES, request.maxResults * 2),
  );
  const byFileId = new Map(files.map((file) => [file.fileId, file]));
  const matched = [...filenameMatches.values()]
    .sort((left, right) => right.score - left.score || left.displayPath.localeCompare(right.displayPath))
    .map((match) => byFileId.get(match.fileId))
    .filter((file): file is FileMetadata => Boolean(file));

  const semanticMatched = queryPlan.semanticConceptGroups.length
    ? matched.filter((file) => semanticContentScanEligible(file, queryPlan))
    : matched;
  if (semanticMatched.length > 0) {
    return semanticMatched.slice(0, limit);
  }
  if (matched.length > 0) {
    return matched.slice(0, limit);
  }
  return files.slice(0, limit);
}

function periodKeyFromPathSegment(value: string): number | undefined {
  const normalized = value.normalize('NFKC').toLowerCase();
  const patterns = [
    /\bfy\s*(\d{2,4})(?:\s*[-_ ]?\s*([1-4])\s*q)?\b/u,
    /\b(\d{2,4})\s*期(?:\s*[-_ ]?\s*([1-4])\s*q)?/u,
    /\b(\d{2,4})\s*[-_ ]\s*([1-4])\s*q\b/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const year = Number(match[1]);
    const quarter = match[2] ? Number(match[2]) : 0;
    if (!Number.isFinite(year)) continue;
    return year * 10 + (Number.isFinite(quarter) ? quarter : 0);
  }
  return undefined;
}

function explicitPeriodKeys(queryPlan: RelayDocumentSearchQueryPlanV1): Set<number> {
  return new Set(
    queryPlan.periodHints
      .map(periodKeyFromPathSegment)
      .filter((key): key is number => typeof key === 'number' && Number.isFinite(key)),
  );
}

function scanBudgetStrategy(queryPlan: RelayDocumentSearchQueryPlanV1): ScanBudgetStrategy {
  if (queryPlan.timeScopeIntent === 'explicit_period') return 'explicit_period';
  if (queryPlan.timeScopeIntent === 'latest_first') return 'latest_first';
  if (queryPlan.timeScopeIntent === 'historical_examples') return 'historical_examples';
  return 'balanced';
}

function folderRoleForBudget(
  periodKey: number | undefined,
  newestPeriodKey: number | undefined,
  explicitKeys: Set<number>,
  strategy: ScanBudgetStrategy,
): ScanBudgetFolderRole {
  if (periodKey !== undefined && explicitKeys.has(periodKey)) return 'explicit';
  if (periodKey === undefined || newestPeriodKey === undefined) return 'other';
  if (periodKey === newestPeriodKey) return 'latest';
  if (newestPeriodKey - periodKey <= 20) return 'recent';
  if (strategy === 'historical_examples') return 'historical';
  return 'historical';
}

function folderWeightForBudget(role: ScanBudgetFolderRole, strategy: ScanBudgetStrategy): number {
  if (strategy === 'explicit_period') {
    if (role === 'explicit') return 12;
    if (role === 'recent') return 3;
    if (role === 'latest') return 4;
    if (role === 'historical') return 1;
    return 1;
  }
  if (strategy === 'latest_first') {
    if (role === 'latest') return 10;
    if (role === 'recent') return 4;
    if (role === 'historical') return 1;
    return 1;
  }
  if (strategy === 'historical_examples') {
    if (role === 'historical') return 5;
    if (role === 'recent') return 4;
    if (role === 'latest') return 3;
    if (role === 'explicit') return 6;
    return 1;
  }
  if (role === 'latest') return 5;
  if (role === 'recent') return 3;
  if (role === 'historical') return 1.5;
  if (role === 'explicit') return 8;
  return 1;
}

function minimumGuaranteeRatio(strategy: ScanBudgetStrategy): number {
  switch (strategy) {
    case 'historical_examples':
      return 0.35;
    case 'balanced':
      return 0.25;
    case 'explicit_period':
      return 0.12;
    case 'latest_first':
      return 0.15;
    default:
      return 0.2;
  }
}

async function buildScanBudgetReport(
  root: string,
  directoryEntries: Array<{ name: string; path: string }>,
  rootFileCount: number,
  maxScanFiles: number,
  queryPlan: RelayDocumentSearchQueryPlanV1,
): Promise<ScanBudgetReport | undefined> {
  if (!directoryEntries.length) return undefined;
  const normalizedRoot = resolve(root);
  const strategy = scanBudgetStrategy(queryPlan);
  const explicitKeys = explicitPeriodKeys(queryPlan);
  const folderFacts = await Promise.all(directoryEntries.map(async (entry) => {
    const periodKey = periodKeyFromPathSegment(entry.name);
    let modifiedTime: string | undefined;
    try {
      modifiedTime = (await stat(entry.path)).mtime.toISOString();
    } catch {
      modifiedTime = undefined;
    }
    return {
      entry,
      periodKey,
      modifiedTime,
    };
  }));
  const newestPeriodKey = folderFacts
    .map((fact) => fact.periodKey)
    .filter((key): key is number => typeof key === 'number' && Number.isFinite(key))
    .reduce<number | undefined>((max, key) => max === undefined ? key : Math.max(max, key), undefined);
  const rootFileBudget = rootFileCount > 0
    ? Math.min(maxScanFiles, 100, Math.max(10, Math.floor(maxScanFiles * 0.02)))
    : 0;
  const folderBudget = Math.max(0, maxScanFiles - rootFileBudget);
  const minPool = Math.floor(folderBudget * minimumGuaranteeRatio(strategy));
  const minimumGuaranteePerFolder = directoryEntries.length > 0 && folderBudget > 0
    ? Math.max(1, Math.min(150, Math.floor(minPool / directoryEntries.length)))
    : 0;
  const baseTotal = Math.min(folderBudget, minimumGuaranteePerFolder * directoryEntries.length);
  const remaining = Math.max(0, folderBudget - baseTotal);
  const folders = folderFacts.map((fact): ScanBudgetFolderReport => {
    const role = folderRoleForBudget(fact.periodKey, newestPeriodKey, explicitKeys, strategy);
    return {
      path: fact.entry.path,
      displayPath: rootRelativePath(normalizedRoot, fact.entry.path),
      role,
      periodKey: fact.periodKey,
      modifiedTime: fact.modifiedTime,
      weight: folderWeightForBudget(role, strategy),
      minimumGuaranteedFiles: minimumGuaranteePerFolder,
      allocatedFiles: minimumGuaranteePerFolder,
      scannedFiles: 0,
      skippedFiles: 0,
      truncated: false,
    };
  });
  const weightTotal = folders.reduce((sum, folder) => sum + folder.weight, 0);
  let allocated = folders.reduce((sum, folder) => sum + folder.allocatedFiles, 0);
  for (const folder of folders) {
    if (remaining <= 0 || weightTotal <= 0) continue;
    const extra = Math.floor((remaining * folder.weight) / weightTotal);
    folder.allocatedFiles += extra;
    allocated += extra;
  }
  let leftover = Math.max(0, folderBudget - allocated);
  const priority = [...folders].sort((left, right) =>
    right.weight - left.weight ||
    (right.periodKey ?? 0) - (left.periodKey ?? 0) ||
    left.displayPath.localeCompare(right.displayPath),
  );
  for (const folder of priority) {
    if (leftover <= 0) break;
    folder.allocatedFiles += 1;
    leftover -= 1;
  }
  folders.sort((left, right) =>
    right.weight - left.weight ||
    (right.periodKey ?? 0) - (left.periodKey ?? 0) ||
    left.displayPath.localeCompare(right.displayPath),
  );
  return {
    schemaVersion: 'RelayDocumentSearchScanBudget.v1',
    root: normalizedRoot,
    strategy,
    timeScopeIntent: queryPlan.timeScopeIntent,
    timeScopeReason: queryPlan.timeScopeReason,
    maxScanFiles,
    rootFileBudget,
    rootFilesScanned: 0,
    rootFilesSkipped: 0,
    rootFilesTruncated: false,
    folderCount: folders.length,
    minimumGuaranteePerFolder,
    budgetedFolderCount: folders.filter((folder) => folder.allocatedFiles > 0).length,
    budgetTruncatedFolderCount: 0,
    folders,
  };
}

async function fileMetadataForPath(
  normalizedRoot: string,
  fullPath: string,
  checkedAt: string,
): Promise<FileMetadata> {
  const info = await stat(fullPath);
  const displayPath = rootRelativePath(normalizedRoot, fullPath);
  return {
    fileId: stableId(`${normalizedRoot}:${displayPath}`),
    root: normalizedRoot,
    path: fullPath,
    displayPath,
    name: basename(fullPath),
    extension: extname(fullPath).replace(/^\./u, '').toLowerCase(),
    size: info.size,
    modifiedTime: info.mtime.toISOString(),
    sourceMetadataVersion: sourceMetadataVersion(fullPath, info.size, info.mtimeMs),
    accessSnapshots: {
      metadata: {
        action: 'metadata',
        state: 'ok',
        checkedAt,
      },
    },
  };
}

async function walkDirectoryWithBudget(
  normalizedRoot: string,
  folder: ScanBudgetFolderReport,
  state: WalkState,
  maxScanFiles: number,
  checkedAt: string,
): Promise<FileMetadata[]> {
  const out: FileMetadata[] = [];
  if (folder.allocatedFiles <= 0) {
    folder.truncated = true;
    return out;
  }
  const stack = [folder.path];
  while (stack.length) {
    if (shouldStop(state)) break;
    if (state.scannedFiles >= maxScanFiles) {
      state.truncated = true;
      folder.truncated = true;
      break;
    }
    if (folder.scannedFiles >= folder.allocatedFiles) {
      folder.truncated = true;
      break;
    }
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch {
      state.inaccessiblePaths.push(dir);
      state.skippedFiles += 1;
      folder.skippedFiles += 1;
      continue;
    }

    for (const entry of entries) {
      if (shouldStop(state)) break;
      const fullPath = join(dir, entry.name);
      if (!isInsideRoot(normalizedRoot, fullPath)) {
        state.skippedFiles += 1;
        folder.skippedFiles += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        state.skippedFiles += 1;
        folder.skippedFiles += 1;
        continue;
      }
      if (state.scannedFiles >= maxScanFiles) {
        state.truncated = true;
        folder.truncated = true;
        break;
      }
      if (folder.scannedFiles >= folder.allocatedFiles) {
        folder.truncated = true;
        break;
      }
      try {
        const metadata = await fileMetadataForPath(normalizedRoot, fullPath, checkedAt);
        if (shouldStop(state)) break;
        state.scannedFiles += 1;
        folder.scannedFiles += 1;
        if (state.scannedFiles % 250 === 0) emitProgress(state, 'metadata_scan', 40);
        out.push(metadata);
      } catch {
        state.inaccessiblePaths.push(fullPath);
        state.skippedFiles += 1;
        folder.skippedFiles += 1;
      }
    }
  }
  return out;
}

type RipgrepFileListResult = {
  paths: string[];
  truncated: boolean;
  error?: string;
};

async function listFilesWithRipgrep(
  normalizedRoot: string,
  state: WalkState,
  maxScanFiles: number,
  options: RelayDocumentSearchExecutorOptions,
): Promise<RipgrepFileListResult | null> {
  const executable = String(options.ripgrepPath || '').trim();
  if (!executable) return null;
  const maxFiles = Math.max(
    maxScanFiles,
    Math.min(
      Math.trunc(options.ripgrepMaxFiles ?? DEFAULT_RIPGREP_MAX_FILES),
      DEFAULT_RIPGREP_MAX_FILES,
    ),
  );
  const timeoutMs = Math.max(
    1_000,
    Math.trunc(options.ripgrepListTimeoutMs ?? DEFAULT_RIPGREP_LIST_TIMEOUT_MS),
  );
  const args = [
    '--files',
    '--hidden',
    '--no-messages',
    ...[...SKIPPED_DIRS].flatMap((name) => ['--glob', `!**/${name}/**`]),
    normalizedRoot,
  ];

  return new Promise((resolvePromise) => {
    const child = spawn(executable, args, { windowsHide: true });
    const paths: string[] = [];
    const seen = new Set<string>();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    let killedForLimit = false;
    const finish = (result: RipgrepFileListResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const pushLine = (line: string) => {
      const value = line.trim();
      if (!value) return;
      const fullPath = resolve(value);
      if (!isInsideRoot(normalizedRoot, fullPath)) return;
      if (seen.has(fullPath)) return;
      seen.add(fullPath);
      paths.push(fullPath);
      if (paths.length >= maxFiles && !killedForLimit) {
        killedForLimit = true;
        child.kill();
      }
    };
    const flushStdout = () => {
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) pushLine(line);
    };
    const timer = setTimeout(() => {
      killedForLimit = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      flushStdout();
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderrBuffer += String(chunk);
      if (stderrBuffer.length > 1_000) stderrBuffer = stderrBuffer.slice(-1_000);
    });
    child.on('error', (error) => {
      finish({ paths: [], truncated: false, error: error.message });
    });
    child.on('close', (code) => {
      if (stdoutBuffer) {
        pushLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      const uniqueSorted = [...paths].sort((left, right) => rootRelativePath(normalizedRoot, left).localeCompare(rootRelativePath(normalizedRoot, right)));
      if (code && code !== 1 && uniqueSorted.length === 0) {
        finish({
          paths: [],
          truncated: false,
          error: stderrBuffer.trim() || `ripgrep exited with code ${code}`,
        });
        return;
      }
      finish({
        paths: uniqueSorted,
        truncated: killedForLimit || uniqueSorted.length >= maxFiles,
      });
    });
  }).then((result) => {
    if (result?.error) {
      state.inaccessiblePaths.push(`${normalizedRoot} (ripgrep: ${result.error})`);
      return null;
    }
    return result;
  });
}

async function appendRipgrepMetadata(
  out: FileMetadata[],
  normalizedRoot: string,
  fullPath: string,
  checkedAt: string,
  state: WalkState,
  folder?: ScanBudgetFolderReport,
): Promise<boolean> {
  try {
    out.push(await fileMetadataForPath(normalizedRoot, fullPath, checkedAt));
    state.scannedFiles += 1;
    if (folder) folder.scannedFiles += 1;
    if (state.scannedFiles % 250 === 0) emitProgress(state, 'metadata_scan', 40);
    return true;
  } catch {
    state.inaccessiblePaths.push(fullPath);
    state.skippedFiles += 1;
    if (folder) folder.skippedFiles += 1;
    return false;
  }
}

async function filesFromRipgrepList(
  normalizedRoot: string,
  paths: string[],
  state: WalkState,
  maxScanFiles: number,
  checkedAt: string,
): Promise<FileMetadata[]> {
  const out: FileMetadata[] = [];
  for (const fullPath of paths) {
    if (shouldStop(state)) break;
    if (state.scannedFiles >= maxScanFiles) {
      state.truncated = true;
      break;
    }
    await appendRipgrepMetadata(out, normalizedRoot, fullPath, checkedAt, state);
  }
  if (paths.length > out.length) state.truncated = true;
  return out;
}

async function filesFromRipgrepBudget(
  normalizedRoot: string,
  paths: string[],
  budgetReport: ScanBudgetReport,
  state: WalkState,
  maxScanFiles: number,
  checkedAt: string,
): Promise<FileMetadata[]> {
  const out: FileMetadata[] = [];
  const consumed = new Set<string>();
  for (const fullPath of paths) {
    if (shouldStop(state) || state.scannedFiles >= maxScanFiles) break;
    if (dirname(fullPath) !== normalizedRoot) continue;
    if (budgetReport.rootFilesScanned >= budgetReport.rootFileBudget) {
      budgetReport.rootFilesTruncated = true;
      break;
    }
    if (await appendRipgrepMetadata(out, normalizedRoot, fullPath, checkedAt, state)) {
      budgetReport.rootFilesScanned += 1;
      consumed.add(fullPath);
    } else {
      budgetReport.rootFilesSkipped += 1;
    }
  }

  for (const folder of budgetReport.folders) {
    if (shouldStop(state) || state.scannedFiles >= maxScanFiles) break;
    if (folder.allocatedFiles <= 0) {
      folder.truncated = true;
      continue;
    }
    const folderPrefix = folder.path.endsWith(sep) ? folder.path : `${folder.path}${sep}`;
    for (const fullPath of paths) {
      if (shouldStop(state) || state.scannedFiles >= maxScanFiles) break;
      if (folder.scannedFiles >= folder.allocatedFiles) {
        folder.truncated = true;
        break;
      }
      if (consumed.has(fullPath) || !fullPath.startsWith(folderPrefix)) continue;
      if (await appendRipgrepMetadata(out, normalizedRoot, fullPath, checkedAt, state, folder)) {
        consumed.add(fullPath);
      }
    }
    if (paths.some((fullPath) => !consumed.has(fullPath) && fullPath.startsWith(folderPrefix))) {
      folder.truncated = true;
    }
  }

  budgetReport.budgetTruncatedFolderCount = budgetReport.folders.filter((folder) => folder.truncated).length;
  if (
    state.scannedFiles >= maxScanFiles ||
    budgetReport.rootFilesTruncated ||
    budgetReport.budgetTruncatedFolderCount > 0 ||
    paths.length > consumed.size
  ) {
    state.truncated = true;
  }
  state.budgetReports.push(budgetReport);
  return out;
}

async function walkRoot(
  root: string,
  state: WalkState,
  maxScanFiles: number,
  checkedAt: string,
  queryPlan: RelayDocumentSearchQueryPlanV1,
  options: RelayDocumentSearchExecutorOptions,
): Promise<FileMetadata[]> {
  const normalizedRoot = resolve(root);
  const out: FileMetadata[] = [];
  let rootEntries;
  try {
    rootEntries = (await readdir(normalizedRoot, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  } catch {
    state.inaccessiblePaths.push(normalizedRoot);
    state.skippedFiles += 1;
    return out;
  }
  const rootFiles = rootEntries.filter((entry) => entry.isFile());
  const rootDirs = rootEntries
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
    .map((entry) => ({ name: entry.name, path: join(normalizedRoot, entry.name) }));
  const budgetReport = await buildScanBudgetReport(normalizedRoot, rootDirs, rootFiles.length, maxScanFiles, queryPlan);
  const ripgrepList = await listFilesWithRipgrep(normalizedRoot, state, maxScanFiles, options);
  if (ripgrepList) {
    if (budgetReport) {
      const files = await filesFromRipgrepBudget(
        normalizedRoot,
        ripgrepList.paths,
        budgetReport,
        state,
        maxScanFiles,
        checkedAt,
      );
      if (ripgrepList.truncated) state.truncated = true;
      return files;
    }
    const files = await filesFromRipgrepList(normalizedRoot, ripgrepList.paths, state, maxScanFiles, checkedAt);
    if (ripgrepList.truncated) state.truncated = true;
    return files;
  }
  if (budgetReport) {
    for (const entry of rootFiles) {
      if (shouldStop(state) || state.scannedFiles >= maxScanFiles) {
        state.truncated = true;
        budgetReport.rootFilesTruncated = true;
        break;
      }
      if (budgetReport.rootFilesScanned >= budgetReport.rootFileBudget) {
        budgetReport.rootFilesTruncated = true;
        break;
      }
      try {
        const metadata = await fileMetadataForPath(normalizedRoot, join(normalizedRoot, entry.name), checkedAt);
        state.scannedFiles += 1;
        budgetReport.rootFilesScanned += 1;
        out.push(metadata);
      } catch {
        state.inaccessiblePaths.push(join(normalizedRoot, entry.name));
        state.skippedFiles += 1;
        budgetReport.rootFilesSkipped += 1;
      }
    }
    for (const folder of budgetReport.folders) {
      if (shouldStop(state) || state.scannedFiles >= maxScanFiles) {
        state.truncated = true;
        folder.truncated = true;
        break;
      }
      out.push(...await walkDirectoryWithBudget(normalizedRoot, folder, state, maxScanFiles, checkedAt));
    }
    budgetReport.budgetTruncatedFolderCount = budgetReport.folders.filter((folder) => folder.truncated).length;
    if (budgetReport.rootFilesTruncated || budgetReport.budgetTruncatedFolderCount > 0) {
      state.truncated = true;
    }
    state.budgetReports.push(budgetReport);
    return out;
  }

  const stack = [normalizedRoot];

  while (stack.length) {
    if (shouldStop(state)) break;
    if (state.scannedFiles >= maxScanFiles) {
      state.truncated = true;
      break;
    }
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      state.inaccessiblePaths.push(dir);
      state.skippedFiles += 1;
      continue;
    }

    for (const entry of entries) {
      if (shouldStop(state)) break;
      const fullPath = join(dir, entry.name);
      if (!isInsideRoot(normalizedRoot, fullPath)) {
        state.skippedFiles += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        state.skippedFiles += 1;
        continue;
      }
      if (state.scannedFiles >= maxScanFiles) {
        state.truncated = true;
        break;
      }
      try {
        const info = await stat(fullPath);
        if (shouldStop(state)) break;
        state.scannedFiles += 1;
        if (state.scannedFiles % 250 === 0) emitProgress(state, 'metadata_scan', 40);
        const displayPath = rootRelativePath(normalizedRoot, fullPath);
        out.push({
          fileId: stableId(`${normalizedRoot}:${displayPath}`),
          root: normalizedRoot,
          path: fullPath,
          displayPath,
          name: basename(fullPath),
          extension: extname(fullPath).replace(/^\./u, '').toLowerCase(),
          size: info.size,
          modifiedTime: info.mtime.toISOString(),
          sourceMetadataVersion: sourceMetadataVersion(fullPath, info.size, info.mtimeMs),
          accessSnapshots: {
            metadata: {
              action: 'metadata',
              state: 'ok',
              checkedAt,
            },
          },
        });
      } catch {
        state.inaccessiblePaths.push(fullPath);
        state.skippedFiles += 1;
      }
    }
  }

  return out;
}

function metadataCacheEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useMetadataCache !== undefined) return options.useMetadataCache;
  return process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE === '1';
}

function filenameIndexEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useFilenameIndex !== undefined) return options.useFilenameIndex;
  return process.env.RELAY_DOCUMENT_SEARCH_FILENAME_INDEX === '1';
}

function userMemoryEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useUserMemory !== undefined) return options.useUserMemory;
  return process.env.RELAY_DOCUMENT_SEARCH_USER_MEMORY === '1';
}

function parsedDocumentCacheEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useParsedDocumentCache !== undefined) return options.useParsedDocumentCache;
  return process.env.RELAY_PARSED_DOCUMENT_CACHE === '1';
}

function derivedContentIndexCacheEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useDerivedContentIndexCache !== undefined) return options.useDerivedContentIndexCache;
  return process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE === '1';
}

function indexDbEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useIndexDb !== undefined) return options.useIndexDb;
  return process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB === '1';
}

function indexDbPrimaryModeForOptions(options: RelayDocumentSearchExecutorOptions): RelayDocumentSearchIndexDbPrimaryMode {
  const configured = options.indexDbPrimaryMode ??
    process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB_PRIMARY_MODE ??
    process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB_PRIMARY;
  if (configured === undefined && indexDbEnabled(options)) return 'primary';
  const normalized = String(configured ?? 'disabled').trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'primary') return 'primary';
  if (normalized === 'shadow') return 'shadow';
  if (normalized === 'rollback') return 'rollback';
  return 'disabled';
}

function indexDbSearchMaxRowsForOptions(options: RelayDocumentSearchExecutorOptions): number {
  const configured = options.indexDbSearchMaxRows ?? Number(process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS);
  const requested = Number.isFinite(configured) ? Number(configured) : DEFAULT_INDEX_DB_SEARCH_MAX_ROWS;
  return Math.max(DEFAULT_MAX_EVIDENCE_ANCHORS, Math.min(Math.trunc(requested), MAX_INDEX_DB_SEARCH_MAX_ROWS));
}

function disabledIndexDbCutoverReadiness(): IndexDbCutoverReadiness {
  return {
    status: 'disabled',
    reasons: ['index_db_disabled'],
    schemaReady: false,
    migrationReady: false,
    writeReady: false,
    searchReady: false,
    evidencePromotionReady: false,
  };
}

function disabledIndexDbPrimaryPathGate(mode: RelayDocumentSearchIndexDbPrimaryMode = 'disabled'): IndexDbPrimaryPathGate {
  return {
    mode,
    activePath: 'disabled',
    eligible: false,
    rollbackActive: false,
    reasons: ['index_db_disabled'],
    thresholds: {
      readinessStatus: 'ready',
      searchTruncated: false,
      maxStaleEvidenceRows: 0,
      maxOutsideCurrentScanRows: 0,
      maxWriteErrors: 0,
      maxSearchErrors: 0,
      minFreshCurrentScanFtsFiles: 1,
      minFreshCurrentScanFtsRows: 1,
    },
  };
}

function emptyIndexDbResultUsage(): IndexDbResultUsage {
  return {
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
  };
}

function indexDbStateForOptions(options: RelayDocumentSearchExecutorOptions): IndexDbState {
  const enabled = indexDbEnabled(options);
  const primaryMode = indexDbPrimaryModeForOptions(options);
  return {
    enabled,
    contract: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
    backend: enabled ? 'sqlite_fts' : 'disabled',
    dbPath: enabled ? relayDocumentSearchIndexDbPathForOptions(options) : undefined,
    requiredMigrations: [],
    appliedMigrations: [],
    existingMigrations: [],
    derivedWrites: [],
    cutoverReadiness: disabledIndexDbCutoverReadiness(),
    primaryPathGate: enabled
      ? { ...disabledIndexDbPrimaryPathGate(primaryMode), activePath: 'filename_content', reasons: ['primary_gate_not_evaluated'] }
      : disabledIndexDbPrimaryPathGate(primaryMode),
    resultUsage: emptyIndexDbResultUsage(),
    promotedEvidenceFileCount: 0,
    staleEvidenceRowCount: 0,
    staleEvidenceReasons: {},
    currentScanFtsRowCount: 0,
    currentScanFtsFileCount: 0,
    freshCurrentScanFtsRowCount: 0,
    freshCurrentScanFtsFileCount: 0,
    metadataBoostedFreshFtsRowCount: 0,
    metadataBoostedFreshFtsFileCount: 0,
    titleBoostedFreshFtsRowCount: 0,
    titleBoostedFreshFtsFileCount: 0,
    locationBoostedFreshFtsRowCount: 0,
    locationBoostedFreshFtsFileCount: 0,
    staleCurrentScanFtsRowCount: 0,
    staleCurrentScanFtsFileCount: 0,
    outsideCurrentScanFtsRowCount: 0,
    outsideCurrentScanFtsFileCount: 0,
    writeErrors: [],
    searchErrors: [],
    recentHealthEvents: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsedDocumentStructureProfile(
  parsedDocument: RelayParsedDocument | undefined,
): Record<string, unknown> | undefined {
  const extraData = parsedDocument?.metadata.extra_data;
  const structureProfile = isRecord(extraData) ? extraData.structure_profile : undefined;
  return isRecord(structureProfile) ? structureProfile : undefined;
}

function structureProfileStatus(value: Record<string, unknown>): RelayParsedDocumentStructureProfileStatus | undefined {
  return value.status === 'valid' || value.status === 'degraded' || value.status === 'invalid'
    ? value.status
    : undefined;
}

function summarizeParsedDocumentStructureProfiles(
  parsedDocuments: RelayParsedDocument[],
): ParsedDocumentStructureProfileSummary {
  const profiles: Record<string, number> = {};
  const summary: ParsedDocumentStructureProfileSummary = {
    schemaVersion: RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
    documentCount: 0,
    validCount: 0,
    degradedCount: 0,
    invalidCount: 0,
    profiles,
    warningCount: 0,
    errorCount: 0,
    lossyWarningCount: 0,
    unsupportedWarningCount: 0,
  };
  for (const parsedDocument of parsedDocuments) {
    const profile = parsedDocumentStructureProfile(parsedDocument);
    if (!profile) continue;
    summary.documentCount += 1;
    const profileName = primitiveString(profile.profile) ?? parsedDocument.parser.profile;
    profiles[profileName] = (profiles[profileName] ?? 0) + 1;
    const status = structureProfileStatus(profile);
    if (status === 'valid') summary.validCount += 1;
    if (status === 'degraded') summary.degradedCount += 1;
    if (status === 'invalid') summary.invalidCount += 1;
    summary.warningCount += primitiveNumber(profile.warningCount) ?? 0;
    summary.errorCount += primitiveNumber(profile.errorCount) ??
      (Array.isArray(profile.errors) ? profile.errors.length : 0);
    summary.lossyWarningCount += primitiveNumber(profile.lossyWarningCount) ?? 0;
    summary.unsupportedWarningCount += primitiveNumber(profile.unsupportedWarningCount) ?? 0;
  }
  return summary;
}

function primitiveString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function primitiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function primitiveBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function summarizeIndexHealthEvent(event: RelayDocumentSearchIndexHealthEvent): IndexDbHealthEventSummary {
  const details = event.details ?? {};
  const storeNames = Array.isArray(details.storeNames)
    ? details.storeNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : undefined;
  return {
    kind: event.kind,
    createdAt: event.createdAt,
    jobId: event.jobId,
    action: primitiveString(details.action),
    status: primitiveString(details.status),
    automatic: primitiveBoolean(details.automatic),
    userStarted: primitiveBoolean(details.userStarted),
    backend: primitiveString(details.backend),
    indexDbStatus: primitiveString(details.indexDbStatus),
    sqliteFtsEnabled: primitiveBoolean(details.sqliteFtsEnabled),
    schemaRevision: primitiveNumber(details.schemaRevision),
    detectedSchemaRevision: primitiveNumber(details.detectedSchemaRevision),
    schemaGateStatus: primitiveString(details.schemaGateStatus),
    schemaGateComponentCount: primitiveNumber(details.schemaGateComponentCount),
    schemaGateReadOnlyComponentCount: primitiveNumber(details.schemaGateReadOnlyComponentCount),
    schemaGateRebuildRequiredComponentCount: primitiveNumber(details.schemaGateRebuildRequiredComponentCount),
    schemaGateInvalidComponentCount: primitiveNumber(details.schemaGateInvalidComponentCount),
    durableDataPreserved: primitiveBoolean(details.durableDataPreserved),
    userStatePreserved: primitiveBoolean(details.userStatePreserved),
    storeNames,
    storeCount: primitiveNumber(details.storeCount),
    checkCount: primitiveNumber(details.checkCount),
    invalidJsonFileCount: primitiveNumber(details.invalidJsonFileCount),
    warningCount: primitiveNumber(details.warningCount),
    errorCount: primitiveNumber(details.errorCount),
  };
}

async function refreshIndexDbRecentHealthEvents(
  options: RelayDocumentSearchExecutorOptions,
  indexDb: IndexDbState,
): Promise<void> {
  if (!options.indexCoordinatorDir && !indexCoordinatorEnabled(options)) return;
  try {
    const events = await readRelayDocumentSearchIndexHealthEvents(
      {
        coordinatorDir: options.indexCoordinatorDir,
        now: options.now,
        ownerId: options.jobId,
        appVersion: options.appVersion,
      },
      12,
    );
    indexDb.recentHealthEvents = events.map(summarizeIndexHealthEvent);
    indexDb.healthEventReadError = undefined;
  } catch (error) {
    indexDb.healthEventReadError = error instanceof Error ? error.message : String(error);
  }
}

function refreshIndexDbResultUsage(
  indexDb: IndexDbState,
  candidates: RankedCandidate[],
  returned: RankedCandidate[],
): void {
  const scoredCandidates = candidates.filter((candidate) => candidate.indexDbScore > 0);
  const scoredReturned = returned.filter((candidate) => candidate.indexDbScore > 0);
  const promotedCandidates = candidates.filter((candidate) => candidate.contentEvidence?.source === 'sqlite_fts');
  const promotedReturned = returned.filter((candidate) => candidate.contentEvidence?.source === 'sqlite_fts');
  const candidateScores = candidates.map((candidate) => candidate.indexDbScore).filter((score) => score > 0);
  const returnedScores = returned.map((candidate) => candidate.indexDbScore).filter((score) => score > 0);
  const candidateScoreTotal = candidateScores.reduce((sum, score) => sum + score, 0);
  const maxCandidateScore = candidateScores.reduce((max, score) => Math.max(max, score), 0);
  const returnedScoreTotal = returnedScores.reduce((sum, score) => sum + score, 0);
  const maxReturnedScore = returnedScores.reduce((max, score) => Math.max(max, score), 0);
  const candidateUncappedScoreTotal = candidates.reduce((sum, candidate) => sum + candidate.indexDbUncappedScore, 0);
  const returnedUncappedScoreTotal = returned.reduce((sum, candidate) => sum + candidate.indexDbUncappedScore, 0);
  const candidateScoreCapLossTotal = candidates.reduce((sum, candidate) => sum + candidate.indexDbScoreCapLoss, 0);
  const returnedScoreCapLossTotal = returned.reduce((sum, candidate) => sum + candidate.indexDbScoreCapLoss, 0);
  indexDb.resultUsage = {
    candidateCount: candidates.length,
    returnedResultCount: returned.length,
    searchMatchedFileCount: indexDb.search?.matchedFileCount ?? 0,
    currentScanMatchedFileCount: indexDb.currentScanFtsFileCount,
    freshCurrentScanMatchedFileCount: indexDb.freshCurrentScanFtsFileCount,
    staleCurrentScanMatchedFileCount: indexDb.staleCurrentScanFtsFileCount,
    outsideCurrentScanMatchedFileCount: indexDb.outsideCurrentScanFtsFileCount,
    scoredCandidateCount: scoredCandidates.length,
    scoredResultCount: scoredReturned.length,
    promotedCandidateCount: promotedCandidates.length,
    promotedResultCount: promotedReturned.length,
    candidateScoreTotal,
    maxCandidateScore,
    returnedScoreTotal,
    maxReturnedScore,
    candidateUncappedScoreTotal,
    returnedUncappedScoreTotal,
    candidateScoreCapLossTotal,
    returnedScoreCapLossTotal,
    scoreCappedCandidateCount: candidates.filter((candidate) => candidate.indexDbScoreCapLoss > 0).length,
    scoreCappedResultCount: returned.filter((candidate) => candidate.indexDbScoreCapLoss > 0).length,
    nonReturnedScoredCandidateCount: Math.max(0, scoredCandidates.length - scoredReturned.length),
    nonReturnedPromotedCandidateCount: Math.max(0, promotedCandidates.length - promotedReturned.length),
    nonReturnedScoreTotal: Math.max(0, candidateScoreTotal - returnedScoreTotal),
    scoreTotal: returnedScoreTotal,
    maxScore: maxReturnedScore,
  };
}

function summarizeIndexDbWriteReport(
  report: RelayDocumentSearchIndexDbWriteReport,
  path?: string,
): IndexDbWriteSummary {
  return {
    path,
    schemaRevision: report.schemaRevision,
    status: report.status,
    dbPath: report.dbPath,
    fileMetadataRowCount: report.fileMetadataRowCount,
    ftsRowCount: report.ftsRowCount,
    previewSpanRowCount: report.previewSpanRowCount,
    requiredMigrations: report.requiredMigrations,
    appliedMigrations: report.appliedMigrations,
    existingMigrations: report.existingMigrations,
    warnings: report.warnings,
    errors: report.errors,
  };
}

function summarizeIndexDbSearchResult(result: RelayDocumentSearchIndexDbSearchResult): IndexDbSearchSummary {
  return {
    schemaRevision: result.schemaRevision,
    status: result.status,
    dbPath: result.dbPath,
    query: result.query,
    maxRows: result.maxRows,
    rowCount: result.rows.length,
    rawRowCount: result.rawRowCount,
    droppedRowCount: result.droppedRowCount,
    truncated: result.truncated,
    matchedFileCount: new Set(result.rows.map((row) => row.file_id).filter(Boolean)).size,
    textRowCount: result.rows.filter((row) => row.entry_kind === 'text').length,
    tableCellRowCount: result.rows.filter((row) => row.entry_kind === 'table_cell').length,
    textRawRowCount: result.textRawRowCount,
    tableCellRawRowCount: result.tableCellRawRowCount,
    requiredMigrations: result.requiredMigrations,
    appliedMigrations: result.appliedMigrations,
    existingMigrations: result.existingMigrations,
    warnings: result.warnings,
    errors: result.errors,
  };
}

function updateIndexDbMigrationState(
  indexDb: IndexDbState,
  report: Pick<
    RelayDocumentSearchIndexDbWriteReport | RelayDocumentSearchIndexDbSearchResult,
    'schemaRevision' | 'requiredMigrations' | 'appliedMigrations' | 'existingMigrations'
  >,
): void {
  indexDb.schemaRevision = report.schemaRevision;
  indexDb.requiredMigrations = report.requiredMigrations;
  indexDb.appliedMigrations = report.appliedMigrations;
  indexDb.existingMigrations = report.existingMigrations;
}

function refreshIndexDbCutoverReadiness(indexDb: IndexDbState): void {
  if (!indexDb.enabled) {
    indexDb.cutoverReadiness = disabledIndexDbCutoverReadiness();
    return;
  }

  const knownMigrations = new Set([...indexDb.appliedMigrations, ...indexDb.existingMigrations]);
  const migrationReady = indexDb.requiredMigrations.length > 0 &&
    indexDb.requiredMigrations.every((migration) => knownMigrations.has(migration));
  const schemaReady = (indexDb.schemaRevision ?? 0) >= 2;
  const writeReportErrorCount = [
    ...(indexDb.metadataWrite?.errors ?? []),
    ...indexDb.derivedWrites.flatMap((write) => write.errors),
  ].length;
  const searchReportErrorCount = indexDb.search?.errors.length ?? 0;
  const writeReady = indexDb.metadataWrite?.status === 'ready' &&
    indexDb.metadataWrite.errors.length === 0 &&
    indexDb.derivedWrites.length > 0 &&
    indexDb.derivedWrites.every((write) => write.status === 'ready' && write.errors.length === 0);
  const searchReady = indexDb.search?.status === 'ready' &&
    indexDb.search.errors.length === 0 &&
    !indexDb.search.warnings.includes('empty_fts_query');
  const searchLimited = Boolean(indexDb.search?.truncated || indexDb.search?.warnings.includes('fts_result_limit_reached'));
  const evidencePromotionReady = indexDb.promotedEvidenceFileCount > 0 || indexDb.freshCurrentScanFtsFileCount > 0;
  const reasons: string[] = [];

  if (!schemaReady) reasons.push('schema_revision_not_ready');
  if (!migrationReady) reasons.push('required_migrations_incomplete');
  if (!writeReady) reasons.push('writes_not_ready');
  if (!searchReady) reasons.push('search_not_ready');
  if (indexDb.writeErrors.length > 0) reasons.push('write_errors_present');
  if (indexDb.searchErrors.length > 0) reasons.push('search_errors_present');
  if (writeReportErrorCount > 0) reasons.push('write_report_errors_present');
  if (searchReportErrorCount > 0) reasons.push('search_report_errors_present');
  if (searchLimited) reasons.push('fts_result_limit_reached');
  if (indexDb.staleEvidenceRowCount > 0) reasons.push('stale_or_incomplete_fts_rows_present');
  if (indexDb.outsideCurrentScanFtsRowCount > 0) reasons.push('fts_rows_outside_current_scan');

  let status: IndexDbCutoverReadiness['status'] = 'ready';
  if (!schemaReady || !migrationReady || !writeReady || !searchReady) {
    status = 'blocked';
  } else if (
    indexDb.writeErrors.length > 0 ||
    indexDb.searchErrors.length > 0 ||
    writeReportErrorCount > 0 ||
    searchReportErrorCount > 0 ||
    searchLimited ||
    indexDb.staleEvidenceRowCount > 0 ||
    indexDb.outsideCurrentScanFtsRowCount > 0 ||
    !evidencePromotionReady
  ) {
    status = 'degraded';
  }
  if (status === 'ready') reasons.push('sqlite_fts_cutover_ready');
  if (status === 'degraded' && !evidencePromotionReady) reasons.push('no_fts_evidence_promoted_in_this_query');

  indexDb.cutoverReadiness = {
    status,
    reasons,
    schemaReady,
    migrationReady,
    writeReady,
    searchReady,
    evidencePromotionReady,
  };
}

function indexDbWriteErrorCount(indexDb: IndexDbState): number {
  return indexDb.writeErrors.length +
    (indexDb.metadataWrite?.errors.length ?? 0) +
    indexDb.derivedWrites.reduce((sum, write) => sum + write.errors.length, 0);
}

function indexDbSearchErrorCount(indexDb: IndexDbState): number {
  return indexDb.searchErrors.length + (indexDb.search?.errors.length ?? 0);
}

function refreshIndexDbPrimaryPathGate(
  indexDb: IndexDbState,
  mode: RelayDocumentSearchIndexDbPrimaryMode,
): void {
  if (!indexDb.enabled) {
    indexDb.primaryPathGate = disabledIndexDbPrimaryPathGate(mode);
    return;
  }

  const blockerReasons: string[] = [];
  if (indexDb.cutoverReadiness.status !== 'ready') {
    blockerReasons.push(`readiness_${indexDb.cutoverReadiness.status}`);
    blockerReasons.push(...indexDb.cutoverReadiness.reasons.filter((reason) => reason !== 'sqlite_fts_cutover_ready'));
  }
  if (indexDb.search?.truncated) blockerReasons.push('fts_result_limit_reached');
  if (indexDb.staleEvidenceRowCount > 0) blockerReasons.push('stale_or_incomplete_fts_rows_present');
  if (indexDb.outsideCurrentScanFtsRowCount > 0) blockerReasons.push('fts_rows_outside_current_scan');
  if (indexDbWriteErrorCount(indexDb) > 0) blockerReasons.push('write_errors_present');
  if (indexDbSearchErrorCount(indexDb) > 0) blockerReasons.push('search_errors_present');
  if (indexDb.freshCurrentScanFtsFileCount < 1) blockerReasons.push('no_fresh_current_scan_fts_files');
  if (indexDb.freshCurrentScanFtsRowCount < 1) blockerReasons.push('no_fresh_current_scan_fts_rows');

  const eligible = blockerReasons.length === 0;
  let activePath: IndexDbPrimaryPathGate['activePath'] = 'filename_content';
  let rollbackActive = false;
  const modeReasons: string[] = [];

  if (mode === 'disabled') {
    modeReasons.push('primary_mode_disabled');
  } else if (mode === 'shadow') {
    modeReasons.push(eligible ? 'primary_shadow_eligible' : 'primary_shadow_blocked');
  } else if (mode === 'rollback') {
    modeReasons.push('primary_rollback_forced');
    rollbackActive = true;
  } else if (eligible) {
    activePath = 'sqlite_fts_primary';
    modeReasons.push('sqlite_fts_primary_active');
  } else {
    modeReasons.push('primary_rollback_to_filename_content');
    rollbackActive = true;
  }

  indexDb.primaryPathGate = {
    mode,
    activePath,
    eligible,
    rollbackActive,
    reasons: [...new Set([...modeReasons, ...blockerReasons])],
    thresholds: {
      readinessStatus: 'ready',
      searchTruncated: false,
      maxStaleEvidenceRows: 0,
      maxOutsideCurrentScanRows: 0,
      maxWriteErrors: 0,
      maxSearchErrors: 0,
      minFreshCurrentScanFtsFiles: 1,
      minFreshCurrentScanFtsRows: 1,
    },
  };
}

async function writeIndexDbMetadata(
  files: FileMetadata[],
  options: RelayDocumentSearchExecutorOptions,
  indexDb: IndexDbState,
): Promise<void> {
  if (!indexDb.enabled) return;
  try {
    const report = await writeRelayDocumentSearchIndexDbMetadata(files, {
      indexDbPath: options.indexDbPath,
      sqliteModule: options.sqliteModule,
      now: options.now,
    });
    indexDb.dbPath = report.dbPath ?? indexDb.dbPath;
    updateIndexDbMigrationState(indexDb, report);
    indexDb.metadataWrite = summarizeIndexDbWriteReport(report);
  } catch (error) {
    indexDb.writeErrors.push({ message: error instanceof Error ? error.message : String(error) });
  }
}

async function writeIndexDbDerivedSearchStore(
  file: FileMetadata,
  searchStore: RelayDocumentSearchDerivedSearchStoreV1,
  options: RelayDocumentSearchExecutorOptions,
  indexDb: IndexDbState,
): Promise<IndexDbWriteSummary | undefined> {
  if (!indexDb.enabled) return undefined;
  try {
    const report = await writeRelayDocumentSearchIndexDbDerivedSearchStore(searchStore, {
      indexDbPath: options.indexDbPath,
      sqliteModule: options.sqliteModule,
      now: options.now,
    });
    indexDb.dbPath = report.dbPath ?? indexDb.dbPath;
    updateIndexDbMigrationState(indexDb, report);
    const summary = summarizeIndexDbWriteReport(report, file.path);
    indexDb.derivedWrites.push(summary);
    return summary;
  } catch (error) {
    const summary: IndexDbWriteSummary = {
      path: file.path,
      schemaRevision: indexDb.schemaRevision ?? 0,
      status: 'failed',
      dbPath: indexDb.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      requiredMigrations: indexDb.requiredMigrations,
      appliedMigrations: indexDb.appliedMigrations,
      existingMigrations: indexDb.existingMigrations,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
    indexDb.writeErrors.push({
      path: file.path,
      message: summary.errors[0],
    });
    indexDb.derivedWrites.push(summary);
    return summary;
  }
}

async function searchIndexDbFts(
  terms: string[],
  roots: string[],
  options: RelayDocumentSearchExecutorOptions,
  indexDb: IndexDbState,
): Promise<IndexDbSearchProbe> {
  const scoresByFileId = new Map<string, number>();
  const uncappedScoresByFileId = new Map<string, number>();
  const scoreCapLossByFileId = new Map<string, number>();
  const rowsByFileId = new Map<string, RelayDocumentSearchIndexDbSearchRow[]>();
  if (!indexDb.enabled || terms.length === 0) return { scoresByFileId, uncappedScoresByFileId, scoreCapLossByFileId, rowsByFileId };
  try {
    const result = await searchRelayDocumentSearchIndexDbFts(terms, {
      indexDbPath: options.indexDbPath,
      sqliteModule: options.sqliteModule,
      now: options.now,
      maxRows: indexDbSearchMaxRowsForOptions(options),
      roots,
    });
    indexDb.dbPath = result.dbPath ?? indexDb.dbPath;
    updateIndexDbMigrationState(indexDb, result);
    indexDb.search = summarizeIndexDbSearchResult(result);
    for (const row of result.rows) {
      const rows = rowsByFileId.get(row.file_id) ?? [];
      rows.push(row);
      rowsByFileId.set(row.file_id, rows);
    }
  } catch (error) {
    indexDb.searchErrors.push(error instanceof Error ? error.message : String(error));
  }
  return { scoresByFileId, uncappedScoresByFileId, scoreCapLossByFileId, rowsByFileId };
}

function staleIndexDbRowReasons(
  row: RelayDocumentSearchIndexDbSearchRow,
  file: FileMetadata,
): string[] {
  const reasons: string[] = [];
  if (!row.source_metadata_version) {
    reasons.push('missing_source_metadata_version');
  } else if (row.source_metadata_version !== file.sourceMetadataVersion) {
    reasons.push('source_metadata_mismatch');
  }
  if (!row.parsed_document_uid) reasons.push('missing_parsed_document_uid');
  if (!row.preview_text) reasons.push('missing_preview_text');
  if (!row.anchor) reasons.push('missing_anchor');
  return reasons;
}

function recordStaleIndexDbRowReasons(indexDb: IndexDbState, reasons: string[]): void {
  if (!reasons.length) return;
  indexDb.staleEvidenceRowCount += 1;
  for (const reason of reasons) {
    indexDb.staleEvidenceReasons[reason] = (indexDb.staleEvidenceReasons[reason] ?? 0) + 1;
  }
}

function indexDbReasonCountsSummary(reasons: Record<string, number>): string | undefined {
  const items = Object.entries(reasons)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`);
  return items.length ? items.join(',') : undefined;
}

function indexDbRowScore(row: RelayDocumentSearchIndexDbSearchRow): number {
  let score = row.entry_kind === 'table_cell' ? 3 : 2;
  if (indexDbRowHasTitleBoost(row)) score += 1;
  if (indexDbRowHasLocationBoost(row)) score += 1;
  if (row.fts_snippet?.includes('[[HL]]')) score += 1;
  if (typeof row.bm25_score === 'number' && Number.isFinite(row.bm25_score)) {
    score += Math.max(0, Math.min(2, 1 / (1 + Math.abs(row.bm25_score))));
  }
  return score;
}

function indexDbScoreForRows(rows: RelayDocumentSearchIndexDbSearchRow[]): number {
  return Math.min(indexDbUncappedScoreForRows(rows), INDEX_DB_SCORE_CAP);
}

function indexDbUncappedScoreForRows(rows: RelayDocumentSearchIndexDbSearchRow[]): number {
  return rows.reduce((sum, row) => sum + indexDbRowScore(row), 0);
}

function indexDbScoreCapLoss(uncappedScore: number): number {
  return Math.max(0, uncappedScore - INDEX_DB_SCORE_CAP);
}

function indexDbRowHasTitleBoost(row: RelayDocumentSearchIndexDbSearchRow): boolean {
  return Boolean(row.title?.trim());
}

function indexDbRowHasLocationBoost(row: RelayDocumentSearchIndexDbSearchRow): boolean {
  return Boolean(row.location_label?.trim());
}

function indexDbRowHasTitleLocationBoost(row: RelayDocumentSearchIndexDbSearchRow): boolean {
  return indexDbRowHasTitleBoost(row) || indexDbRowHasLocationBoost(row);
}

function validateIndexDbRowsForCurrentScan(
  files: FileMetadata[],
  rowsByFileId: Map<string, RelayDocumentSearchIndexDbSearchRow[]>,
  indexDb: IndexDbState,
): Map<string, RelayDocumentSearchIndexDbSearchRow[]> {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const freshRowsByFileId = new Map<string, RelayDocumentSearchIndexDbSearchRow[]>();
  for (const [fileId, rows] of rowsByFileId) {
    if (!fileId) continue;
    const file = filesById.get(fileId);
    if (file) {
      indexDb.currentScanFtsFileCount += 1;
      indexDb.currentScanFtsRowCount += rows.length;
      const freshRows: RelayDocumentSearchIndexDbSearchRow[] = [];
      let staleRowsForFile = 0;
      for (const row of rows) {
        const staleReasons = staleIndexDbRowReasons(row, file);
        if (staleReasons.length) {
          staleRowsForFile += 1;
          recordStaleIndexDbRowReasons(indexDb, staleReasons);
        } else {
          freshRows.push(row);
        }
      }
      if (staleRowsForFile > 0) {
        indexDb.staleCurrentScanFtsFileCount += 1;
        indexDb.staleCurrentScanFtsRowCount += staleRowsForFile;
      }
      if (freshRows.length) {
        indexDb.freshCurrentScanFtsFileCount += 1;
        indexDb.freshCurrentScanFtsRowCount += freshRows.length;
        const metadataBoostedRows = freshRows.filter(indexDbRowHasTitleLocationBoost);
        if (metadataBoostedRows.length) {
          indexDb.metadataBoostedFreshFtsFileCount += 1;
          indexDb.metadataBoostedFreshFtsRowCount += metadataBoostedRows.length;
        }
        const titleBoostedRows = freshRows.filter(indexDbRowHasTitleBoost);
        if (titleBoostedRows.length) {
          indexDb.titleBoostedFreshFtsFileCount += 1;
          indexDb.titleBoostedFreshFtsRowCount += titleBoostedRows.length;
        }
        const locationBoostedRows = freshRows.filter(indexDbRowHasLocationBoost);
        if (locationBoostedRows.length) {
          indexDb.locationBoostedFreshFtsFileCount += 1;
          indexDb.locationBoostedFreshFtsRowCount += locationBoostedRows.length;
        }
        freshRowsByFileId.set(fileId, freshRows);
      }
      continue;
    }
    indexDb.outsideCurrentScanFtsFileCount += 1;
    indexDb.outsideCurrentScanFtsRowCount += rows.length;
  }
  return freshRowsByFileId;
}

function anchorForIndexDbRow(
  row: RelayDocumentSearchIndexDbSearchRow,
  terms: string[],
): Record<string, unknown> {
  const matchedTerms = matchedTermsForText(`${row.text} ${row.preview_text ?? ''}`, terms);
  const anchor: Record<string, unknown> = {
    ...(row.anchor ?? {}),
    source_index: 'sqlite_fts_index',
    sqlite_fts_entry_id: row.entry_id,
    sqlite_fts_span_id: row.span_id,
    snippet: String(row.anchor?.snippet ?? row.fts_snippet ?? row.preview_text ?? lineSnippet(row.text)),
    matchedTerms,
    source_metadata_version: row.source_metadata_version,
    parsed_document_uid: row.parsed_document_uid,
    parser_version: row.parser_version,
    anchor_confidence: row.anchor?.anchor_confidence ?? 'medium',
  };
  if (row.title) anchor.title = row.title;
  if (row.location_label) anchor.locationLabel = row.location_label;
  return anchor;
}

function evidenceForIndexDbRow(
  file: FileMetadata,
  row: RelayDocumentSearchIndexDbSearchRow,
  anchor: Record<string, unknown>,
): Record<string, unknown> {
  const evidence: Record<string, unknown> = {
    file_id: file.fileId,
    path: file.path,
    display_path: file.displayPath,
    anchor,
    evidence_state: 'content_confirmed',
    source_metadata_version: row.source_metadata_version ?? file.sourceMetadataVersion,
    source_index: 'sqlite_fts_index',
  };
  if (row.parsed_document_uid) evidence.parsed_document_uid = row.parsed_document_uid;
  return evidence;
}

function promoteIndexDbEvidence(
  files: FileMetadata[],
  byFileId: Map<string, ContentEvidence>,
  searchProbe: IndexDbSearchProbe,
  terms: string[],
  indexDb: IndexDbState,
): void {
  const freshRowsByFileId = validateIndexDbRowsForCurrentScan(files, searchProbe.rowsByFileId, indexDb);
  searchProbe.scoresByFileId.clear();
  searchProbe.uncappedScoresByFileId.clear();
  searchProbe.scoreCapLossByFileId.clear();
  for (const [fileId, rows] of freshRowsByFileId) {
    const uncappedScore = indexDbUncappedScoreForRows(rows);
    searchProbe.scoresByFileId.set(fileId, Math.min(uncappedScore, INDEX_DB_SCORE_CAP));
    searchProbe.uncappedScoresByFileId.set(fileId, uncappedScore);
    searchProbe.scoreCapLossByFileId.set(fileId, indexDbScoreCapLoss(uncappedScore));
  }
  for (const file of files) {
    if (byFileId.has(file.fileId)) continue;
    const rows = freshRowsByFileId.get(file.fileId) ?? [];
    if (!rows.length) continue;
    const returnedRows = rows.slice(0, DEFAULT_MAX_EVIDENCE_ANCHORS);
    if (!returnedRows.length) continue;
    const anchors = returnedRows.map((row) => anchorForIndexDbRow(row, terms));
    const evidence = returnedRows.map((row, index) => evidenceForIndexDbRow(file, row, anchors[index]));
    const uncappedScore = indexDbUncappedScoreForRows(returnedRows);
    const score = Math.min(uncappedScore, INDEX_DB_SCORE_CAP);
    byFileId.set(file.fileId, {
      source: 'sqlite_fts',
      score,
      uncappedScore,
      scoreCapLoss: indexDbScoreCapLoss(uncappedScore),
      anchors,
      evidence,
    });
    indexDb.promotedEvidenceFileCount += 1;
  }
}

function syncJournalDiagnosticsForOptions(options: RelayDocumentSearchExecutorOptions): SyncJournalDiagnostics {
  const enabled = relayDocumentSearchSyncJournalEnabled(options);
  return {
    enabled,
    contract: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT,
    journalDir: enabled ? relayDocumentSearchSyncJournalDir(options) : undefined,
    writeCount: 0,
    writtenEventCount: 0,
    writeErrors: [],
  };
}

async function recordSyncJournalEvent(
  diagnostics: SyncJournalDiagnostics,
  event: RelayDocumentSearchSyncJournalEventInput,
  options: RelayDocumentSearchExecutorOptions,
): Promise<RelayDocumentSearchSyncJournalRecord | undefined> {
  if (!diagnostics.enabled) return undefined;
  try {
    const journal = await appendRelayDocumentSearchSyncJournalEvent(event, options);
    diagnostics.writeCount += 1;
    diagnostics.writtenEventCount += 1;
    return journal;
  } catch (error) {
    diagnostics.writeErrors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function recordSyncJournalEvents(
  diagnostics: SyncJournalDiagnostics,
  events: RelayDocumentSearchSyncJournalEventInput[],
  options: RelayDocumentSearchExecutorOptions,
): Promise<RelayDocumentSearchSyncJournalRecord | undefined> {
  if (!diagnostics.enabled || events.length === 0) return undefined;
  try {
    const journal = await appendRelayDocumentSearchSyncJournalEvents(events, options);
    diagnostics.writeCount += 1;
    diagnostics.writtenEventCount += events.length;
    return journal;
  } catch (error) {
    diagnostics.writeErrors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function maxContentInspectFilesForOptions(options: RelayDocumentSearchExecutorOptions): number {
  return Math.max(
    1,
    Math.min(options.maxContentInspectFiles ?? DEFAULT_MAX_CONTENT_INSPECT_FILES, DEFAULT_MAX_CONTENT_INSPECT_FILES),
  );
}

function indexCoordinatorEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  if (options.useIndexCoordinator !== undefined) return options.useIndexCoordinator;
  return process.env.RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR === '1';
}

function contentIndexCommitEnabled(options: RelayDocumentSearchExecutorOptions): boolean {
  return indexCoordinatorEnabled(options) || Boolean(options.indexCoordinatorDir);
}

function evidenceRedactionPolicyForOptions(
  options: RelayDocumentSearchExecutorOptions,
): RelayDocumentSearchEvidenceRedactionPolicy {
  return options.evidenceRedactionPolicy ?? relayDocumentSearchEvidenceRedactionPolicyFromEnv();
}

function parserVersionForFile(file: FileMetadata): string | undefined {
  if (PDF_CONTENT_EXTENSIONS.has(file.extension)) return RELAY_PDF_READER_VERSION;
  if (STRUCTURED_CONTENT_EXTENSIONS.has(file.extension)) return RELAY_OFFICE_OPENXML_READER_VERSION;
  if (TEXT_CONTENT_EXTENSIONS.has(file.extension)) return RELAY_TEXT_READER_VERSION;
  return undefined;
}

async function filesForRoot(
  root: string,
  state: WalkState,
  maxScanFiles: number,
  queryPlan: RelayDocumentSearchQueryPlanV1,
  options: RelayDocumentSearchExecutorOptions,
  cacheState: MetadataCacheState,
  freshnessReports: RelayDocumentSearchFreshnessReport[],
): Promise<FileMetadata[]> {
  let previousCacheForFreshness:
    | Awaited<ReturnType<typeof readRelayDocumentSearchMetadataCache>>
    | undefined;
  if (metadataCacheEnabled(options)) {
    const cached = await readRelayDocumentSearchMetadataCache(root, {
      cacheDir: options.metadataCacheDir,
      maxAgeMs: options.metadataCacheMaxAgeMs,
      now: options.now,
    });
    if (cached) {
      cacheState.hits.push(root);
      state.scannedFiles += cached.files.length;
      if (cached.stats.truncated) state.truncated = true;
      emitProgress(state, 'metadata_cache', 30);
      return cached.files;
    }
    cacheState.misses.push(root);
    previousCacheForFreshness = await readRelayDocumentSearchMetadataCache(root, {
      cacheDir: options.metadataCacheDir,
      maxAgeMs: -1,
      now: options.now,
    });
  }

  const inaccessibleBefore = state.inaccessiblePaths.length;
  const files = await walkRoot(root, state, maxScanFiles, (options.now ?? new Date()).toISOString(), queryPlan, options);
  if (previousCacheForFreshness) {
    freshnessReports.push(buildRelayDocumentSearchFreshnessReport({
      root: resolve(root),
      generatedAt: (options.now ?? new Date()).toISOString(),
      previousFiles: previousCacheForFreshness.files,
      currentFiles: files,
    }));
  }
  if (metadataCacheEnabled(options) && !state.cancelled && !state.timedOut) {
    try {
      await writeRelayDocumentSearchMetadataCache(
        root,
        files,
        {
          truncated: state.truncated,
          inaccessiblePathCount: state.inaccessiblePaths.length - inaccessibleBefore,
        },
        {
          cacheDir: options.metadataCacheDir,
          now: options.now,
        },
      );
      cacheState.writes.push(root);
    } catch (error) {
      cacheState.writeErrors.push({
        root,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return files;
}

async function prepareFilenameIndex(
  roots: string[],
  files: FileMetadata[],
  terms: string[],
  request: RelayDocumentSearchRequestV1,
  state: WalkState,
  options: RelayDocumentSearchExecutorOptions,
): Promise<{ matches: Map<string, RelayDocumentSearchFilenameIndexMatch>; diagnostics: FilenameIndexState }> {
  const persistent = filenameIndexEnabled(options);
  const combinedRoot = roots.length === 1 ? roots[0] : process.cwd();
  const inMemory = buildRelayDocumentSearchFilenameIndex(combinedRoot, files, { now: options.now });
  const matches = searchRelayDocumentSearchFilenameIndex(inMemory, terms, {
    fileTypes: request.fileTypes,
    maxResults: Math.max(files.length, 1),
  });
  const diagnostics: FilenameIndexState = {
    enabled: persistent,
    contract: RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT,
    mode: persistent ? 'persistent' : 'in_memory',
    inMemoryFileCount: inMemory.stats.fileCount,
    inMemoryTermCount: inMemory.stats.termCount,
    searchHitCount: matches.length,
    readHits: [],
    readMisses: [],
    writes: [],
    writeErrors: [],
  };

  if (!persistent || state.cancelled || state.timedOut) {
    return { matches: new Map(matches.map((match) => [match.fileId, match])), diagnostics };
  }

  for (const root of roots) {
    const rootFiles = files.filter((file) => resolve(file.root) === resolve(root));
    try {
      const cached = await readRelayDocumentSearchFilenameIndex(root, {
        indexDir: options.filenameIndexDir,
        maxAgeMs: options.filenameIndexMaxAgeMs,
        now: options.now,
      });
      if (cached) diagnostics.readHits.push(root);
      else diagnostics.readMisses.push(root);
    } catch {
      diagnostics.readMisses.push(root);
    }
    try {
      await writeRelayDocumentSearchFilenameIndex(root, rootFiles, {
        indexDir: options.filenameIndexDir,
        now: options.now,
      });
      diagnostics.writes.push(root);
    } catch (error) {
      diagnostics.writeErrors.push({
        root,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { matches: new Map(matches.map((match) => [match.fileId, match])), diagnostics };
}

async function prepareUserMemory(
  options: RelayDocumentSearchExecutorOptions,
): Promise<{ record: RelayDocumentSearchUserMemoryRecord; diagnostics: UserMemoryState }> {
  const persistent = userMemoryEnabled(options);
  const enabled = persistent || Boolean(options.pinnedTargets?.length || options.recentSearches?.length);
  let record = emptyRelayDocumentSearchUserMemory({ now: options.now });
  const diagnostics: UserMemoryState = {
    enabled,
    contract: RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT,
    persistent,
    pinCount: 0,
    recentSearchCount: 0,
    boostedFileCount: 0,
    recordedRecentSearch: false,
  };
  if (!enabled) return { record, diagnostics };
  if (persistent) {
    try {
      record = await readRelayDocumentSearchUserMemory({
        memoryDir: options.userMemoryDir,
        maxRecentSearches: options.userMemoryMaxRecentSearches,
        now: options.now,
      });
    } catch (error) {
      diagnostics.readError = error instanceof Error ? error.message : String(error);
    }
  }
  for (const pin of options.pinnedTargets ?? []) {
    record = withRelayDocumentSearchPinnedTarget(record, pin, { now: options.now });
  }
  record = {
    ...record,
    recentSearches: [...(options.recentSearches ?? []), ...record.recentSearches],
  };
  diagnostics.pinCount = record.pins.length;
  diagnostics.recentSearchCount = record.recentSearches.length;
  return { record, diagnostics };
}

async function beginIndexCoordinator(
  options: RelayDocumentSearchExecutorOptions,
  jobId: string,
): Promise<ActiveIndexCoordinator> {
  if (!indexCoordinatorEnabled(options)) {
    return {
      diagnostics: {
        enabled: false,
        mode: 'disabled',
        acquired: false,
        busy: false,
        events: [],
      },
    };
  }

  const coordinatorOptions = {
    coordinatorDir: options.indexCoordinatorDir,
    lockStaleMs: options.indexCoordinatorLockStaleMs,
    now: options.now,
    ownerId: jobId,
    appVersion: options.appVersion,
  };
  const diagnostics: IndexCoordinatorDiagnostics = {
    enabled: true,
    mode: 'advisory',
    acquired: false,
    busy: false,
    coordinatorDir: relayDocumentSearchIndexCoordinatorDir(coordinatorOptions),
    lockStaleMs: options.indexCoordinatorLockStaleMs,
    events: [],
  };

  try {
    const writer = await acquireRelayDocumentSearchIndexWriter(coordinatorOptions);
    diagnostics.acquired = true;
    diagnostics.ownerId = writer.snapshot.ownerId;
    diagnostics.events = writer.events;
    await writer.beginJob(jobId);
    return { writer, diagnostics };
  } catch (error) {
    if (error instanceof RelayDocumentSearchIndexWriterBusyError) {
      diagnostics.busy = true;
      diagnostics.ownerId = error.snapshot?.ownerId;
      diagnostics.events = [error.event];
      return { diagnostics };
    }
    diagnostics.error = error instanceof Error ? error.message : String(error);
    return { diagnostics };
  }
}

async function finishIndexCoordinator(coordinator: ActiveIndexCoordinator, jobId: string): Promise<void> {
  if (!coordinator.writer) return;
  try {
    await coordinator.writer.finishJob(jobId);
  } catch (error) {
    coordinator.diagnostics.error = error instanceof Error ? error.message : String(error);
  }
  try {
    await coordinator.writer.release();
  } catch (error) {
    coordinator.diagnostics.error = error instanceof Error ? error.message : String(error);
  }
}

function resultFromFailure(message: string, options: RelayDocumentSearchExecutorOptions): RelayDocumentSearchResultV1 {
  const now = (options.now ?? new Date()).toISOString();
  const jobId = options.jobId ?? `job-${Date.now().toString(36)}`;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    status: 'failed',
    progress: { stage: 'failed', percent: 100, scannedFiles: 0, skippedFiles: 0 },
    job: { jobId, lifecycle: 'failed', cancellable: false },
    correlation: {
      relayJobId: jobId,
      queryId: options.queryId,
      aionuiConversationId: options.aionuiConversationId,
      aionuiMessageId: options.aionuiMessageId,
    },
    queryPlan: {},
    coverage: { searchedRoots: [], incompleteRoots: [], generatedAt: now },
    results: [],
    evidencePack: emptyRelayDocumentSearchEvidencePack({
      jobId,
      queryId: options.queryId,
      generatedAt: now,
      warnings: [{ code: 'executor_failed', message }],
    }),
    display: { beginnerSummary: '検索を実行できませんでした。', emptyStateGuidance: ['フォルダと検索語を確認してください。'] },
    diagnostics: { error: message },
  };
}

export async function executeRelayDocumentSearch(
  rawRequest: unknown,
  options: RelayDocumentSearchExecutorOptions = {},
): Promise<RelayDocumentSearchResultV1> {
  const parsed = validateRelayDocumentSearchRequest(rawRequest);
  if (!parsed.ok) return resultFromFailure(parsed.errors.join('; '), options);

  const request: RelayDocumentSearchRequestV1 = parsed.value;
  const now = (options.now ?? new Date()).toISOString();
  const jobId = options.jobId ?? `job-${Date.now().toString(36)}`;
  const roots = request.roots.map((root) => resolve(root));
  if (!roots.length) {
    return {
      ...resultFromFailure('roots is required for the initial executor', options),
      status: 'needs_input',
      job: { jobId, lifecycle: 'failed', cancellable: false },
      display: {
        beginnerSummary: '検索するフォルダを選んでください。',
        emptyStateGuidance: ['フォルダを追加してから、もう一度検索してください。'],
      },
    };
  }

  const state: WalkState = {
    scannedFiles: 0,
    skippedFiles: 0,
    inaccessiblePaths: [],
    truncated: false,
    cancelled: false,
    timedOut: false,
    deadlineMs: options.timeoutMs !== undefined ? Date.now() + Math.max(0, options.timeoutMs) : undefined,
    signal: options.signal,
    onProgress: options.onProgress,
    budgetReports: [],
  };
  const syncJournal = syncJournalDiagnosticsForOptions(options);
  await recordSyncJournalEvent(syncJournal, {
    kind: 'search_started',
    jobId,
    queryId: options.queryId,
    query: request.query,
    count: roots.length,
    details: {
      thoroughness: request.thoroughness,
      intent: request.intent,
      evidence: request.evidence,
      fileTypes: request.fileTypes.join(','),
    },
  }, options);
  emitProgress(state, 'metadata_scan', 5);
  const maxScanFiles = Math.max(1, Math.min(options.maxScanFiles ?? DEFAULT_MAX_SCAN_FILES, DEFAULT_MAX_SCAN_FILES));
  const relayQueryPlan = buildRelayDocumentSearchQueryPlan(request, roots);
  const terms = relayQueryPlan.normalizedTerms;
  const contentTerms = contentInspectionTerms(relayQueryPlan);
  const files: FileMetadata[] = [];
  const metadataCache: MetadataCacheState = { hits: [], misses: [], writes: [], writeErrors: [] };
  const freshnessReports: RelayDocumentSearchFreshnessReport[] = [];
  const parsedDocumentCache: ParsedDocumentCacheState = {
    hits: [],
    misses: [],
    writes: [],
    writeErrors: [],
    quota: [],
    policy: [],
  };
  const derivedContentIndexCache: DerivedContentIndexCacheState = {
    enabled: derivedContentIndexCacheEnabled(options),
    hits: [],
    misses: [],
    writes: [],
    writeErrors: [],
    quota: [],
    policy: [],
  };
  const contentIndexCommit: ContentIndexCommitState = {
    enabled: contentIndexCommitEnabled(options),
    attemptedCount: 0,
    committedCount: 0,
    staleFallbackCount: 0,
    failedCount: 0,
    reports: [],
    errors: [],
  };
  const indexDb = indexDbStateForOptions(options);
  let filenameIndex: Awaited<ReturnType<typeof prepareFilenameIndex>> = {
    matches: new Map<string, RelayDocumentSearchFilenameIndexMatch>(),
    diagnostics: {
      enabled: filenameIndexEnabled(options),
      contract: RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT,
      mode: filenameIndexEnabled(options) ? 'persistent' : 'in_memory',
      inMemoryFileCount: 0,
      inMemoryTermCount: 0,
      searchHitCount: 0,
      readHits: [],
      readMisses: [],
      writes: [],
      writeErrors: [],
    },
  };
  const userMemory = await prepareUserMemory(options);
  const syncJournalEvents: RelayDocumentSearchSyncJournalEventInput[] = [];
  let filteredFiles: FileMetadata[] = [];
  let excludedByQueryPlanCount = 0;
  let contentEvidence: Awaited<ReturnType<typeof collectContentEvidence>> = {
    byFileId: new Map<string, ContentEvidence>(),
    scannedFiles: 0,
    skippedFiles: 0,
  };
  let indexDbSearchProbe: IndexDbSearchProbe = {
    scoresByFileId: new Map<string, number>(),
    uncappedScoresByFileId: new Map<string, number>(),
    scoreCapLossByFileId: new Map<string, number>(),
    rowsByFileId: new Map<string, RelayDocumentSearchIndexDbSearchRow[]>(),
  };
  const indexCoordinator = await beginIndexCoordinator(options, jobId);
  try {
    for (const root of roots) {
      if (shouldStop(state)) break;
      const scannedBefore = state.scannedFiles;
      const skippedBefore = state.skippedFiles;
      const inaccessibleBefore = state.inaccessiblePaths.length;
      const rootFiles = await filesForRoot(root, state, maxScanFiles, relayQueryPlan, options, metadataCache, freshnessReports);
      files.push(...rootFiles);
      syncJournalEvents.push({
        kind: 'metadata_scan_completed',
        jobId,
        queryId: options.queryId,
        root,
        count: rootFiles.length,
        scannedFiles: state.scannedFiles - scannedBefore,
        skippedFiles: state.skippedFiles - skippedBefore,
        details: {
          metadataCacheHit: metadataCache.hits.includes(root),
          metadataCacheWritten: metadataCache.writes.includes(root),
          truncated: state.truncated,
        },
      });
      for (const inaccessiblePath of state.inaccessiblePaths.slice(inaccessibleBefore)) {
        syncJournalEvents.push({
          kind: 'inaccessible_path',
          jobId,
          queryId: options.queryId,
          root,
          path: inaccessiblePath,
        });
      }
      if (state.truncated) break;
    }
    filteredFiles = files
      .filter((file) => fileTypeMatches(file, request))
      .filter((file) => !isTransientOfficeLockFile(file));
    const excludedByQueryPlan = filteredFiles.filter((file) =>
      fileMatchesExcludedTerms(file, relayQueryPlan.excludedTerms ?? []),
    );
    excludedByQueryPlanCount = excludedByQueryPlan.length;
    if (excludedByQueryPlanCount > 0) {
      filteredFiles = filteredFiles.filter((file) =>
        !fileMatchesExcludedTerms(file, relayQueryPlan.excludedTerms ?? []),
      );
    }
    await writeIndexDbMetadata(filteredFiles, options, indexDb);
    filenameIndex = await prepareFilenameIndex(roots, filteredFiles, terms, request, state, options);
    if (parsedDocumentCacheEnabled(options) && freshnessReports.some((report) => report.moved_file_count > 0)) {
      parsedDocumentCache.moveMigration = await migrateRelayParsedDocumentCacheForHighConfidenceMoves(freshnessReports, {
        cacheDir: options.parsedDocumentCacheDir,
        maxAgeMs: options.parsedDocumentCacheMaxAgeMs,
        now: options.now,
        cacheProtectionMode: options.parsedDocumentCacheProtectionMode,
        protectedAtRest: options.parsedDocumentCacheProtectedAtRest,
        onPolicy: (policy) => recordParsedDocumentCachePolicy(parsedDocumentCache, policy),
      });
    }
    const contentScanFiles = filesForCandidateFirstContentScan(
      filteredFiles,
      filenameIndex.matches,
      request,
      relayQueryPlan,
    );
    contentEvidence = await collectContentEvidence(
      contentScanFiles,
      contentTerms,
      request,
      state,
      options,
      parsedDocumentCache,
      derivedContentIndexCache,
      indexDb,
      contentIndexCommit,
    );
    indexDbSearchProbe = await searchIndexDbFts(contentTerms, roots, options, indexDb);
    promoteIndexDbEvidence(filteredFiles, contentEvidence.byFileId, indexDbSearchProbe, contentTerms, indexDb);
    refreshIndexDbCutoverReadiness(indexDb);
    refreshIndexDbPrimaryPathGate(indexDb, indexDbPrimaryModeForOptions(options));
    syncJournalEvents.push({
      kind: 'content_scan_completed',
      jobId,
      queryId: options.queryId,
      count: contentEvidence.byFileId.size,
      contentScannedFiles: contentEvidence.scannedFiles,
      contentSkippedFiles: contentEvidence.skippedFiles,
      evidenceFileCount: contentEvidence.byFileId.size,
      details: {
        contentRequired: requiresContentConfirmation(request),
      },
    });
  } finally {
    await finishIndexCoordinator(indexCoordinator, jobId);
  }
  const moveMigration = applyRelayDocumentSearchMoveFreshnessToUserMemory(
    userMemory.record,
    freshnessReports,
    { now: options.now },
  );
  userMemory.record = moveMigration.record;
  userMemory.diagnostics.moveMigration = moveMigration.report;
  userMemory.diagnostics.pinCount = userMemory.record.pins.length;
  userMemory.diagnostics.recentSearchCount = userMemory.record.recentSearches.length;

  const maxResults = Math.min(request.maxResults || DEFAULT_MAX_RESULTS, DEFAULT_MAX_RESULTS);
  const candidateComparator = indexDb.primaryPathGate.activePath === 'sqlite_fts_primary'
    ? compareRankedCandidatesWithIndexDbPrimary
    : compareRankedCandidates;
  const rankedCandidates = filteredFiles
    .map((file) => {
      const indexedMatch = filenameIndex.matches.get(file.fileId);
      const filenameScore = indexedMatch
        ? { score: indexedMatch.score, reasons: indexedMatch.reasons }
        : scoreCandidate(file, terms);
      const memoryScore = relayDocumentSearchUserMemoryBoostForFile(file, userMemory.record);
      const evidence = contentEvidence.byFileId.get(file.fileId);
      const semanticScore = semanticScoreForCandidate(file, relayQueryPlan, evidence);
      const filenameComponent = scoreFromReasons(filenameScore.reasons, 'filename:', 5);
      const pathComponent = scoreFromReasons(filenameScore.reasons, 'path:', 2);
      const termComponent = scoreFromReasons(filenameScore.reasons, 'term:', 1);
      const folderRoleScore = folderRoleScoreForCandidate(file);
      const rawContentComponent = evidence?.source === 'sqlite_fts' ? 0 : evidence?.score ?? 0;
      const semanticRequiresConfirmation = relayQueryPlan.semanticConceptGroups.length > 0;
      const contentComponent = semanticRequiresConfirmation && !semanticScore.confirmed
        ? Math.min(2, rawContentComponent)
        : rawContentComponent;
      const indexDbComponent = evidence?.source === 'sqlite_fts'
        ? semanticRequiresConfirmation && !semanticScore.confirmed
          ? Math.min(2, evidence.score)
          : evidence.score
        : evidence
          ? semanticRequiresConfirmation && !semanticScore.confirmed
            ? Math.min(2, indexDbSearchProbe.scoresByFileId.get(file.fileId) ?? 0)
            : indexDbSearchProbe.scoresByFileId.get(file.fileId) ?? 0
          : 0;
      const indexDbUncappedScore = evidence?.source === 'sqlite_fts'
        ? evidence.uncappedScore ?? evidence.score
        : evidence
          ? indexDbSearchProbe.uncappedScoresByFileId.get(file.fileId) ?? indexDbComponent
          : 0;
      const indexDbScoreCapLoss = evidence?.source === 'sqlite_fts'
        ? evidence.scoreCapLoss ?? 0
        : evidence
          ? indexDbSearchProbe.scoreCapLossByFileId.get(file.fileId) ?? 0
          : 0;
      const recencyScore = recencyScoreForCandidate(file, relayQueryPlan.recencyPreference, options.now ?? new Date());
      const baseScore =
        filenameScore.score +
        semanticScore.score +
        folderRoleScore.score +
        memoryScore.score +
        contentComponent +
        indexDbComponent +
        recencyScore;
      const rankingWarnings = rankingWarningsForCandidate(file, request, Boolean(evidence));
      const penalty = warningPenalty(rankingWarnings, request);
      return {
        file,
        score: Math.max(0, baseScore - penalty),
        baseScore,
        reasons: [...filenameScore.reasons, ...semanticScore.reasons, ...folderRoleScore.reasons, ...memoryScore.reasons],
        filenameScore: filenameComponent,
        pathScore: pathComponent,
        termScore: termComponent,
        folderRoleScore: folderRoleScore.score,
        contentScore: contentComponent,
        indexDbScore: indexDbComponent,
        indexDbUncappedScore,
        indexDbScoreCapLoss,
        recencyScore,
        userMemoryBoost: memoryScore.score,
        rrfScore: 0,
        warningPenalty: penalty,
        rankingWarnings,
        filenameIndexMatch: indexedMatch,
        contentEvidence: evidence,
        semanticAllowed: semanticScore.allowed,
        semanticConfirmed: semanticScore.confirmed,
      };
    })
    .filter((candidate) =>
      (candidate.semanticAllowed ?? true) &&
      (
        terms.length === 0 ||
        candidate.filenameScore > 0 ||
        candidate.pathScore > 0 ||
        candidate.termScore > 0 ||
        candidate.contentScore > 0 ||
        candidate.indexDbScore > 0 ||
        candidate.userMemoryBoost > 0
      )
    );
  const semanticConfirmedAvailable = relayQueryPlan.semanticConceptGroups.length > 0 &&
    rankedCandidates.some((candidate) => candidate.semanticConfirmed);
  const preferredRankedCandidates = semanticConfirmedAvailable
    ? rankedCandidates.filter((candidate) => candidate.semanticConfirmed || candidate.userMemoryBoost > 0)
    : rankedCandidates;
  const rankedAll = withRrfHybridScores(preferredRankedCandidates).sort(candidateComparator);
  userMemory.diagnostics.boostedFileCount = rankedAll.filter((candidate) => candidate.userMemoryBoost > 0).length;
  const groupedRanked = groupRelayDocumentSearchCandidates(rankedAll);
  const diversity = diversifyRankedCandidates(groupedRanked.candidates, maxResults);
  const ranked = diversity.candidates;
  const rankingScoreSummary = rankingScoreBreakdownSummary(
    rankedAll,
    ranked,
    groupedRanked.diagnostics.collapsedCandidateCount,
    indexDb.primaryPathGate.activePath,
  );
  refreshIndexDbResultUsage(indexDb, rankedAll, ranked);
  await refreshIndexDbRecentHealthEvents(options, indexDb);

  const results = ranked.map((candidate) => {
    const folderRoles = classifyRelayDocumentSearchFolderRoles(candidate.file.displayPath);
    const roleBucket = candidateBucketForFolderRoles(folderRoles);
    const candidateBucket = roleBucket === 'uncategorized' && candidate.contentEvidence
      ? 'supporting_evidence'
      : roleBucket;
    const warnings = candidate.rankingWarnings;
    const matchMode = candidate.contentEvidence ? 'content' : 'filename';
    const evidenceState = evidenceStateForCandidate(candidate, relayQueryPlan);
    const indexState = candidate.contentEvidence ? 'content_indexed' : 'metadata_indexed';
    const resultId = `result-${candidate.file.fileId}`;
    const resultGroup = groupedRanked.groupsByFileId.get(candidate.file.fileId);
    const scoreBreakdown = scoreBreakdownForCandidate(candidate, resultGroup, indexDb.primaryPathGate.activePath);
    const sourceIndexes = sourceIndexesForCandidate(candidate, scoreBreakdown);
    const actions = candidate.contentEvidence
      ? ['preview', 'open-file', 'copy-path', 'pin-result', 'use-as-evidence', 'refine-search']
      : ['preview', 'open-file', 'copy-path', 'pin-result', 'refine-search'];
    const productResult = buildRelayDocumentSearchProductResult({
      resultId,
      fileId: candidate.file.fileId,
      path: candidate.file.path,
      displayName: candidate.file.name,
      displayPath: candidate.file.displayPath,
      extension: candidate.file.extension,
      modifiedTime: candidate.file.modifiedTime,
      sourceMetadataVersion: candidate.file.sourceMetadataVersion,
      matchMode,
      evidenceState,
      indexState,
      score: candidate.score,
      scoreBreakdown,
      sourceIndexes,
      anchors: candidate.contentEvidence?.anchors ?? [],
      warnings,
      actions,
    });
    return {
      ...productResult,
      file_metadata: candidate.file,
      result_group: resultGroup,
      folder_roles: folderRoles,
      folder_role: folderRoles.primaryRole,
      candidate_bucket: candidateBucket,
    };
  });
  const candidateBuckets = summarizeCandidateBuckets(results);
  if (userMemory.diagnostics.persistent && !state.cancelled) {
    try {
      userMemory.record = withRelayDocumentSearchRecentSearch(
        userMemory.record,
        {
          query: request.query,
          normalizedTerms: terms,
          roots,
          fileTypes: request.fileTypes,
          resultFileIds: results.map((result) => String(result.file_id)),
          resultPaths: results.map((result) => String(result.path)).filter(Boolean),
        },
        {
          memoryDir: options.userMemoryDir,
          maxRecentSearches: options.userMemoryMaxRecentSearches,
          now: options.now,
        },
      );
      await writeRelayDocumentSearchUserMemory(userMemory.record, {
        memoryDir: options.userMemoryDir,
        maxRecentSearches: options.userMemoryMaxRecentSearches,
        now: options.now,
      });
      userMemory.diagnostics.recordedRecentSearch = true;
      userMemory.diagnostics.pinCount = userMemory.record.pins.length;
      userMemory.diagnostics.recentSearchCount = userMemory.record.recentSearches.length;
    } catch (error) {
      userMemory.diagnostics.writeError = error instanceof Error ? error.message : String(error);
    }
  }

  const contentReaderUnavailableCount = results.filter((candidate) =>
    Array.isArray(candidate.warnings) && candidate.warnings.includes('content_reader_unavailable'),
  ).length;
  const contentNotConfirmedCount = results.filter((candidate) =>
    Array.isArray(candidate.warnings) && candidate.warnings.includes('content_not_confirmed'),
  ).length;
  const unsupportedContentReaderCount = results.filter((candidate) =>
    Array.isArray(candidate.warnings) && candidate.warnings.includes('unsupported_content_reader'),
  ).length;
  const accessUnavailableCount = results.filter((candidate) =>
    Array.isArray(candidate.warnings) && candidate.warnings.some((warning) =>
      [
        'access_denied',
        'permission_changed',
        'not_found',
        'offline_share',
        'locked_file',
        'policy_denied',
      ].includes(String(warning)),
    ),
  ).length;
  const contentRequiredButUnavailable = requiresContentConfirmation(request) && contentReaderUnavailableCount > 0;
  const contentRequiredButUnconfirmed = requiresContentConfirmation(request) &&
    (contentReaderUnavailableCount + contentNotConfirmedCount + unsupportedContentReaderCount + accessUnavailableCount > 0);
  const status = (
    state.truncated ||
    state.inaccessiblePaths.length ||
    state.cancelled ||
    state.timedOut ||
    accessUnavailableCount > 0 ||
    contentRequiredButUnconfirmed
  )
    ? 'partial'
    : 'ok';
  const lifecycle = state.cancelled ? 'cancelled' : status === 'partial' ? 'partial' : 'completed';
  const hasContentEvidence = contentEvidence.byFileId.size > 0;
  const progressStage = (() => {
    if (state.cancelled) return 'cancelled';
    if (state.timedOut) return 'timeout_partial';
    if (contentRequiredButUnconfirmed) return 'partial_filename_candidates';
    if (status === 'partial') return hasContentEvidence ? 'partial_content_candidates' : 'partial_filename_candidates';
    return hasContentEvidence ? 'content_candidates' : 'filename_candidates';
  })();
  const warnings = [
    ...(hasContentEvidence
      ? [{ code: 'content_confirmed', message: 'Some candidates include local text evidence.' }]
        : results.length
          ? [{ code: 'filename_only', message: 'Candidates are not content evidence yet.' }]
          : [{ code: 'no_filename_candidates', message: 'No filename candidates matched the query.' }]),
    ...(contentReaderUnavailableCount > 0
      ? [{
          code: 'content_reader_unavailable',
          message: 'Some candidates need Office/PDF readers before Relay can treat them as content evidence.',
          count: contentReaderUnavailableCount,
        }]
      : []),
    ...(contentNotConfirmedCount > 0
      ? [{
          code: 'content_not_confirmed',
          message: 'Some filename candidates did not contain matching readable content within the current extraction budget.',
          count: contentNotConfirmedCount,
        }]
      : []),
    ...(unsupportedContentReaderCount > 0
      ? [{
          code: 'unsupported_content_reader',
          message: 'Some candidates use formats that are not readable by the current document search reader set.',
          count: unsupportedContentReaderCount,
        }]
      : []),
    ...(accessUnavailableCount > 0
      ? [{
          code: 'access_changed',
          message: 'Some candidates have current-user access changes, so previous content evidence is stale or unavailable.',
          count: accessUnavailableCount,
        }]
      : []),
    ...(state.cancelled ? [{ code: 'cancelled', message: 'Search was cancelled before all roots were scanned.' }] : []),
    ...(state.timedOut ? [{ code: 'timeout_partial', message: 'Search timed out and returned partial results.' }] : []),
  ];
  const beginnerSummary = (() => {
    if (state.cancelled) return '検索をキャンセルしました。途中までの候補を表示しています。';
    if (state.timedOut) return '時間内に一部だけ検索しました。途中までの候補を表示しています。';
    if (contentRequiredButUnconfirmed) {
      return 'ファイル名候補は見つかりましたが、中身まで確認できない候補があります。根拠が必要な検索なので一部結果として表示しています。';
    }
    if (hasContentEvidence) return 'ファイル名・パスに加えて、中身を確認できた候補を表示しています。';
    if (results.length) return 'ファイル名とパスから候補を表示しています。中身の確認は次の段階で行います。';
    return '条件に合うファイル名の候補は見つかりませんでした。';
  })();
  const contentEvidenceSources = [...contentEvidence.byFileId.entries()].map(([fileId, item]) => ({
    fileId,
    evidence: item.evidence,
    parsedDocumentUid: item.parsedDocument?.metadata.uid,
    parsedDocumentVersion: item.parsedDocument?.version,
    parser: item.parsedDocument?.parser,
    documentMetadata: item.parsedDocument?.metadata,
    structureProfile: parsedDocumentStructureProfile(item.parsedDocument),
    warnings: item.parsedDocument?.warnings ?? [],
  }));
  const derivedIndexes = [...contentEvidence.byFileId.values()]
    .map((item) => item.derivedIndex)
    .filter((index): index is RelayDocumentSearchDerivedContentIndexV1 => Boolean(index));
  const derivedSearchStores = [...contentEvidence.byFileId.values()]
    .map((item) => item.derivedSearchStore)
    .filter((store): store is RelayDocumentSearchDerivedSearchStoreV1 => Boolean(store));
  const derivedSearches = [...contentEvidence.byFileId.values()]
    .map((item) => item.derivedSearch)
    .filter((search): search is RelayDocumentSearchDerivedSearchStoreSearchResult => Boolean(search));
  const parsedDocumentsWithEvidence = [...contentEvidence.byFileId.values()]
    .map((item) => item.parsedDocument)
    .filter((parsedDocument): parsedDocument is RelayParsedDocument => Boolean(parsedDocument));
  const structureProfileSummary = summarizeParsedDocumentStructureProfiles(parsedDocumentsWithEvidence);
  const derivedIndexOwnership = buildRelayDocumentSearchDerivedIndexOwnershipReport(freshnessReports);
  const folderRoleReports = results
    .map((result) => result.folder_roles)
    .filter((report): report is RelayDocumentSearchFolderRoleReport =>
      Boolean(report) && typeof report === 'object' && !Array.isArray(report),
    );
  const quality = buildRelayDocumentSearchQualityReport({
    resultCount: results.length,
    contentEvidenceCount: contentEvidence.byFileId.size,
    contentRequired: requiresContentConfirmation(request),
    contentRequiredButUnconfirmed,
    truncated: state.truncated,
    cancelled: state.cancelled,
    timedOut: state.timedOut,
    inaccessiblePathCount: state.inaccessiblePaths.length,
    indexCoordinatorBusy: indexCoordinator.diagnostics.busy,
    parsedDocumentCachePolicyDenied: parsedDocumentCache.policy.some((policy) => !policy.readAllowed || !policy.writeAllowed),
  });
  const evidencePack = buildRelayDocumentSearchEvidencePack({
    jobId,
    queryId: options.queryId,
    generatedAt: now,
    request,
    queryPlan: relayQueryPlan,
    roots,
    metadataScannedFiles: state.scannedFiles,
    contentScannedFiles: contentEvidence.scannedFiles,
    skippedFiles: state.skippedFiles,
    inaccessiblePathCount: state.inaccessiblePaths.length,
    truncated: state.truncated,
    cancelled: state.cancelled,
    timedOut: state.timedOut,
    results,
    contentEvidence: contentEvidenceSources,
    warnings,
  });
  const localDraft = buildRelayDocumentSearchLocalDraft({
    evidencePack,
    quality,
    generatedAt: now,
  });
  const evidenceRedaction = buildRelayDocumentSearchEvidenceRedactionReport({
    evidence: evidencePack.evidence,
    quality,
    policy: evidenceRedactionPolicyForOptions(options),
  });
  const polishRequest = buildRelayDocumentSearchPolishRequest({
    evidencePack,
    localDraft,
    redaction: evidenceRedaction,
    generatedAt: now,
    correlation: {
      relayJobId: jobId,
      queryId: options.queryId,
      aionuiConversationId: options.aionuiConversationId,
      aionuiMessageId: options.aionuiMessageId,
      copilotSessionId: options.copilotSessionId,
      copilotRequestId: options.copilotRequestId,
      copilotTurnId: options.copilotTurnId,
    },
  });
  const polishProvider = await invokeRelayDocumentSearchPolishProvider({
    polishRequest,
    enabled: options.copilotPolishCandidate !== undefined ? false : options.enableCopilotPolishProvider,
    provider: options.copilotPolishProvider,
    baseUrl: options.copilotPolishProviderBaseUrl,
    apiKey: options.copilotPolishProviderApiKey,
    model: options.copilotPolishProviderModel,
    timeoutMs: options.copilotPolishProviderTimeoutMs,
    fetchImpl: options.copilotPolishProviderFetch,
    generatedAt: now,
  });
  const copilotRequestId = options.copilotRequestId ?? polishProvider.copilotRequestId;
  const copilotTurnId = options.copilotTurnId ?? polishProvider.copilotTurnId;
  const polishCandidate = options.copilotPolishCandidate !== undefined
    ? options.copilotPolishCandidate
    : polishProvider.candidate;
  const polishValidation = validateRelayDocumentSearchCopilotPolish({
    candidate: polishCandidate,
    evidencePack,
    localDraft,
    generatedAt: now,
    repairAttempt: options.copilotPolishRepairAttempt,
    redactionAllowsCopilot: evidenceRedaction.canSendToCopilot,
    correlation: {
      relayJobId: jobId,
      queryId: options.queryId,
      aionuiConversationId: options.aionuiConversationId,
      aionuiMessageId: options.aionuiMessageId,
      copilotSessionId: options.copilotSessionId,
      copilotRequestId,
      copilotTurnId,
    },
  });
  const answer = buildRelayDocumentSearchAnswer({
    localDraft,
    polishValidation,
    generatedAt: now,
  });
  const copilotState = buildRelayDocumentSearchCopilotStateReport({
    generatedAt: now,
    requestedState: options.copilotPolishState,
    message: options.copilotPolishStateMessage,
    polishValidation,
    correlation: {
      copilotSessionId: options.copilotSessionId,
      copilotRequestId,
      copilotTurnId,
    },
  });
  const queryTrace = buildRelayDocumentSearchQueryTrace({
    request,
    queryPlan: relayQueryPlan,
    jobId,
    queryId: options.queryId,
    generatedAt: now,
    status,
    progressStage,
    searchedRoots: roots,
    maxScanFiles,
    maxContentInspectFiles: maxContentInspectFilesForOptions(options),
    scannedFiles: state.scannedFiles,
    skippedFiles: state.skippedFiles,
    inaccessiblePathCount: state.inaccessiblePaths.length,
    truncated: state.truncated,
    cancelled: state.cancelled,
    timedOut: state.timedOut,
    metadataCache,
    filenameIndex: filenameIndex.diagnostics,
    contentScan: {
      scannedFiles: contentEvidence.scannedFiles,
      skippedFiles: contentEvidence.skippedFiles,
      evidenceFileCount: contentEvidence.byFileId.size,
      required: requiresContentConfirmation(request),
      requiredButUnconfirmed: contentRequiredButUnconfirmed,
    },
    ranking: {
      candidateCount: rankedAll.length,
      returnedCount: results.length,
      collapsedCandidateCount: groupedRanked.diagnostics.collapsedCandidateCount,
      userMemoryBoostedFileCount: userMemory.diagnostics.boostedFileCount,
      warningPenaltyAppliedCount: rankedAll.filter((candidate) => candidate.warningPenalty > 0).length,
      warningPenaltyTotal: rankedAll.reduce((sum, candidate) => sum + candidate.warningPenalty, 0),
      scoreBreakdown: rankingScoreSummary,
      perDirectoryLimit: diversity.perDirectoryLimit,
      uniqueDirectoryCount: diversity.uniqueDirectoryCount,
      deferredCandidateCount: diversity.deferredCandidateCount,
    },
    indexCoordinator: indexCoordinator.diagnostics,
    indexDb: {
      enabled: indexDb.enabled,
      backend: indexDb.backend,
      dbPath: indexDb.dbPath,
      schemaRevision: indexDb.schemaRevision,
      readinessStatus: indexDb.cutoverReadiness.status,
      readinessReasons: indexDb.cutoverReadiness.reasons,
      primaryPathGate: indexDb.primaryPathGate,
      schemaReady: indexDb.cutoverReadiness.schemaReady,
      migrationReady: indexDb.cutoverReadiness.migrationReady,
      writeReady: indexDb.cutoverReadiness.writeReady,
      searchReady: indexDb.cutoverReadiness.searchReady,
      evidencePromotionReady: indexDb.cutoverReadiness.evidencePromotionReady,
      resultUsage: indexDb.resultUsage,
      staleEvidenceRowCount: indexDb.staleEvidenceRowCount,
      staleEvidenceReasons: indexDb.staleEvidenceReasons,
      currentScanFtsRowCount: indexDb.currentScanFtsRowCount,
      currentScanFtsFileCount: indexDb.currentScanFtsFileCount,
      freshCurrentScanFtsRowCount: indexDb.freshCurrentScanFtsRowCount,
      freshCurrentScanFtsFileCount: indexDb.freshCurrentScanFtsFileCount,
      metadataBoostedFreshFtsRowCount: indexDb.metadataBoostedFreshFtsRowCount,
      metadataBoostedFreshFtsFileCount: indexDb.metadataBoostedFreshFtsFileCount,
      titleBoostedFreshFtsRowCount: indexDb.titleBoostedFreshFtsRowCount,
      titleBoostedFreshFtsFileCount: indexDb.titleBoostedFreshFtsFileCount,
      locationBoostedFreshFtsRowCount: indexDb.locationBoostedFreshFtsRowCount,
      locationBoostedFreshFtsFileCount: indexDb.locationBoostedFreshFtsFileCount,
      staleCurrentScanFtsRowCount: indexDb.staleCurrentScanFtsRowCount,
      staleCurrentScanFtsFileCount: indexDb.staleCurrentScanFtsFileCount,
      outsideCurrentScanFtsRowCount: indexDb.outsideCurrentScanFtsRowCount,
      outsideCurrentScanFtsFileCount: indexDb.outsideCurrentScanFtsFileCount,
      searchMaxRows: indexDb.search?.maxRows,
      searchRawRowCount: indexDb.search?.rawRowCount,
      searchDroppedRowCount: indexDb.search?.droppedRowCount,
      searchTruncated: indexDb.search?.truncated ?? false,
      writeErrorCount: indexDbWriteErrorCount(indexDb),
      searchErrorCount: indexDbSearchErrorCount(indexDb),
      recentHealthEvents: indexDb.recentHealthEvents,
      healthEventReadError: indexDb.healthEventReadError,
    },
    quality,
    redaction: {
      policy: evidenceRedaction.policy,
      canSendToCopilot: evidenceRedaction.canSendToCopilot,
      redactedEvidenceCount: evidenceRedaction.redactedEvidenceCount,
    },
  });
  const searchBudget = {
    schemaVersion: 'RelayDocumentSearchScanBudgetSummary.v1',
    deterministic: true,
    budgetedRootCount: state.budgetReports.length,
    truncatedFolderCount: state.budgetReports.reduce(
      (sum, report) => sum + report.budgetTruncatedFolderCount,
      0,
    ),
    strategies: [...new Set(state.budgetReports.map((report) => report.strategy))],
    reports: state.budgetReports,
  };
  const indexReport = buildRelayDocumentSearchIndexReport({
    generatedAt: now,
    status,
    roots,
    allFiles: files,
    filteredFiles,
    results,
    contentEvidenceFileIds: [...contentEvidence.byFileId.keys()],
    inaccessiblePaths: state.inaccessiblePaths,
    requestedFileTypes: request.fileTypes,
    cancelled: state.cancelled,
    timedOut: state.timedOut,
    truncated: state.truncated,
    metadataCache,
    filenameIndex: filenameIndex.diagnostics,
    contentCaches: {
      parsedDocument: {
        enabled: parsedDocumentCacheEnabled(options),
        policies: parsedDocumentCache.policy,
        quotas: parsedDocumentCache.quota,
        writeErrors: parsedDocumentCache.writeErrors,
      },
      derivedContentIndex: {
        enabled: derivedContentIndexCache.enabled,
        policies: derivedContentIndexCache.policy,
        quotas: derivedContentIndexCache.quota,
        writeErrors: derivedContentIndexCache.writeErrors,
      },
    },
  });
  const schedulerReport = buildRelayDocumentSearchSchedulerReport({
    generatedAt: now,
    roots,
    jobId,
    paused: options.schedulerPaused,
    pauseReasons: options.schedulerPauseReasons,
    scannedFiles: state.scannedFiles,
    skippedFiles: state.skippedFiles,
    candidateCount: rankedAll.length,
    resultCount: results.length,
    maxScanFiles,
    maxContentInspectFiles: maxContentInspectFilesForOptions(options),
    contentScannedFiles: contentEvidence.scannedFiles,
    contentSkippedFiles: contentEvidence.skippedFiles,
    truncated: state.truncated,
    cancelled: state.cancelled,
    timedOut: state.timedOut,
    indexCoordinatorBusy: indexCoordinator.diagnostics.busy,
    indexCoordinatorOwnerId: indexCoordinator.diagnostics.ownerId,
    perRootConcurrency: options.schedulerPerRootConcurrency,
  });
  if (state.truncated) {
    syncJournalEvents.push({
      kind: 'truncated',
      jobId,
      queryId: options.queryId,
      count: state.scannedFiles,
    });
  }
  if (state.cancelled) {
    syncJournalEvents.push({
      kind: 'cancelled',
      jobId,
      queryId: options.queryId,
      count: state.scannedFiles,
    });
  }
  if (state.timedOut) {
    syncJournalEvents.push({
      kind: 'timed_out',
      jobId,
      queryId: options.queryId,
      count: state.scannedFiles,
    });
  }
  syncJournalEvents.push({
    kind: status === 'ok' || status === 'partial' ? 'search_completed' : 'search_failed',
    jobId,
    queryId: options.queryId,
    query: request.query,
    status,
    scannedFiles: state.scannedFiles,
    skippedFiles: state.skippedFiles,
    resultCount: results.length,
    warningCodes: warnings.map((warning) => String(warning.code)),
    details: {
      lifecycle,
      inaccessiblePathCount: state.inaccessiblePaths.length,
      contentEvidenceFileCount: contentEvidence.byFileId.size,
      indexCoordinatorBusy: indexCoordinator.diagnostics.busy,
      indexDbEnabled: indexDb.enabled,
      indexDbReadiness: indexDb.cutoverReadiness.status,
      indexDbReadinessReasons: indexDb.cutoverReadiness.reasons.join(','),
      indexDbPrimaryMode: indexDb.primaryPathGate.mode,
      indexDbActivePath: indexDb.primaryPathGate.activePath,
      indexDbPrimaryEligible: indexDb.primaryPathGate.eligible,
      indexDbPrimaryRollbackActive: indexDb.primaryPathGate.rollbackActive,
      indexDbPrimaryGateReasons: indexDb.primaryPathGate.reasons.join(','),
      indexDbSchemaReady: indexDb.cutoverReadiness.schemaReady,
      indexDbMigrationReady: indexDb.cutoverReadiness.migrationReady,
      indexDbWriteReady: indexDb.cutoverReadiness.writeReady,
      indexDbSearchReady: indexDb.cutoverReadiness.searchReady,
      indexDbEvidencePromotionReady: indexDb.cutoverReadiness.evidencePromotionReady,
      indexDbSearchMatchedFileCount: indexDb.resultUsage.searchMatchedFileCount,
      indexDbCurrentScanMatchedFileCount: indexDb.resultUsage.currentScanMatchedFileCount,
      indexDbFreshCurrentScanMatchedFileCount: indexDb.resultUsage.freshCurrentScanMatchedFileCount,
      indexDbStaleCurrentScanMatchedFileCount: indexDb.resultUsage.staleCurrentScanMatchedFileCount,
      indexDbOutsideCurrentScanMatchedFileCount: indexDb.resultUsage.outsideCurrentScanMatchedFileCount,
      indexDbStaleEvidenceRowCount: indexDb.staleEvidenceRowCount,
      indexDbStaleEvidenceReasons: indexDbReasonCountsSummary(indexDb.staleEvidenceReasons),
      indexDbCandidateScoreTotal: indexDb.resultUsage.candidateScoreTotal,
      indexDbMaxCandidateScore: indexDb.resultUsage.maxCandidateScore,
      indexDbReturnedScoreTotal: indexDb.resultUsage.returnedScoreTotal,
      indexDbMaxReturnedScore: indexDb.resultUsage.maxReturnedScore,
      indexDbCandidateUncappedScoreTotal: indexDb.resultUsage.candidateUncappedScoreTotal,
      indexDbReturnedUncappedScoreTotal: indexDb.resultUsage.returnedUncappedScoreTotal,
      indexDbCandidateScoreCapLossTotal: indexDb.resultUsage.candidateScoreCapLossTotal,
      indexDbReturnedScoreCapLossTotal: indexDb.resultUsage.returnedScoreCapLossTotal,
      indexDbScoreCappedCandidateCount: indexDb.resultUsage.scoreCappedCandidateCount,
      indexDbScoreCappedResultCount: indexDb.resultUsage.scoreCappedResultCount,
      indexDbNonReturnedScoredCandidateCount: indexDb.resultUsage.nonReturnedScoredCandidateCount,
      indexDbNonReturnedPromotedCandidateCount: indexDb.resultUsage.nonReturnedPromotedCandidateCount,
      indexDbNonReturnedScoreTotal: indexDb.resultUsage.nonReturnedScoreTotal,
      indexDbScoredCandidateCount: indexDb.resultUsage.scoredCandidateCount,
      indexDbScoredResultCount: indexDb.resultUsage.scoredResultCount,
      indexDbPromotedCandidateCount: indexDb.resultUsage.promotedCandidateCount,
      indexDbPromotedResultCount: indexDb.resultUsage.promotedResultCount,
      indexDbSearchMaxRows: indexDb.search?.maxRows ?? 0,
      indexDbSearchRawRowCount: indexDb.search?.rawRowCount ?? 0,
      indexDbSearchDroppedRowCount: indexDb.search?.droppedRowCount ?? 0,
      indexDbSearchTruncated: indexDb.search?.truncated ?? false,
      indexDbCurrentScanFtsRowCount: indexDb.currentScanFtsRowCount,
      indexDbCurrentScanFtsFileCount: indexDb.currentScanFtsFileCount,
      indexDbFreshCurrentScanFtsRowCount: indexDb.freshCurrentScanFtsRowCount,
      indexDbFreshCurrentScanFtsFileCount: indexDb.freshCurrentScanFtsFileCount,
      indexDbMetadataBoostedFreshFtsRowCount: indexDb.metadataBoostedFreshFtsRowCount,
      indexDbMetadataBoostedFreshFtsFileCount: indexDb.metadataBoostedFreshFtsFileCount,
      indexDbTitleBoostedFreshFtsRowCount: indexDb.titleBoostedFreshFtsRowCount,
      indexDbTitleBoostedFreshFtsFileCount: indexDb.titleBoostedFreshFtsFileCount,
      indexDbLocationBoostedFreshFtsRowCount: indexDb.locationBoostedFreshFtsRowCount,
      indexDbLocationBoostedFreshFtsFileCount: indexDb.locationBoostedFreshFtsFileCount,
      indexDbStaleCurrentScanFtsRowCount: indexDb.staleCurrentScanFtsRowCount,
      indexDbStaleCurrentScanFtsFileCount: indexDb.staleCurrentScanFtsFileCount,
      indexDbOutsideCurrentScanFtsRowCount: indexDb.outsideCurrentScanFtsRowCount,
      indexDbOutsideCurrentScanFtsFileCount: indexDb.outsideCurrentScanFtsFileCount,
      contentIndexCommitAttemptedCount: contentIndexCommit.attemptedCount,
      contentIndexCommitCommittedCount: contentIndexCommit.committedCount,
      contentIndexCommitStaleFallbackCount: contentIndexCommit.staleFallbackCount,
      contentIndexCommitFailedCount: contentIndexCommit.failedCount,
      searchBudgetStrategies: searchBudget.strategies.join(','),
      searchBudgetTruncatedFolderCount: searchBudget.truncatedFolderCount,
    },
  });
  const finalSyncJournal = await recordSyncJournalEvents(syncJournal, syncJournalEvents, options);
  if (finalSyncJournal) {
    syncJournal.reconciliation = buildRelayDocumentSearchSyncReconciliationReport(finalSyncJournal, {
      roots,
      now: options.now,
    });
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    status,
    progress: {
      stage: progressStage,
      percent: 100,
      scannedFiles: state.scannedFiles,
      skippedFiles: state.skippedFiles,
    },
    job: {
      jobId,
      lifecycle,
      cancellable: lifecycle === 'running',
      retryToken: status === 'partial' ? `${jobId}:retry` : undefined,
    },
    correlation: {
      relayJobId: jobId,
      queryId: options.queryId,
      aionuiConversationId: options.aionuiConversationId,
      aionuiMessageId: options.aionuiMessageId,
    },
    queryPlan: {
      ...relayQueryPlan,
      fileTypes: request.fileTypes,
      evidence: request.evidence,
      readerCapabilities: Object.fromEntries(
        [...new Set(filteredFiles.map((file) => file.extension).filter(Boolean))]
          .map((extension) => [extension, readerCapabilitiesForExtension(extension)]),
      ),
      note:
        'Phase -1 executor uses metadata/filename search plus bounded Dedoc-compatible ParsedDocument IR for txt/md/csv, OOXML Office text/cell extraction, optional LiteParse PDF text, and an optional ParsedDocument cache.',
    },
    coverage: {
      searchedRoots: roots,
      incompleteRoots: state.truncated || state.cancelled || state.timedOut ? roots : [],
      inaccessiblePaths: state.inaccessiblePaths,
      truncated: state.truncated,
      scannedFiles: state.scannedFiles,
      skippedFiles: state.skippedFiles,
      excludedByQueryPlanCount,
      generatedAt: now,
    },
    results,
    evidencePack,
    localDraft,
    polishRequest,
    polishProvider: polishProvider.report,
    answer,
    display: {
      beginnerSummary,
      emptyStateGuidance: results.length ? [] : ['検索語を広げるか、別のフォルダを選んでください。'],
      refineActions: ['broaden-keywords', 'clear-extension-filters', 'show-index-status'],
    },
    diagnostics: {
      executor: 'relay-document-search-phase-1-filename',
      fileMetadataOnly: !hasContentEvidence,
      documentMetadataParsed: false,
      noDuplicateDedocScan: true,
      parsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      parsedDocumentStructureProfile: structureProfileSummary,
      queryNormalizerVersion: RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
      parsedDocumentsGenerated: [...contentEvidence.byFileId.values()].filter((item) => item.parsedDocument).length,
      textContentScanned: contentEvidence.scannedFiles,
      textContentSkipped: contentEvidence.skippedFiles,
      contentEvidenceGenerated: contentEvidence.byFileId.size,
      contentReaderUnavailableCount,
      accessUnavailableCount,
      contentRequiredButUnavailable,
      contentNotConfirmedCount,
      unsupportedContentReaderCount,
      contentRequiredButUnconfirmed,
      ranking: {
        deterministic: true,
        warningPenaltyAppliedCount: rankedAll.filter((candidate) => candidate.warningPenalty > 0).length,
        warningPenaltyTotal: rankedAll.reduce((sum, candidate) => sum + candidate.warningPenalty, 0),
        scoreBreakdown: rankingScoreSummary,
        tieBreakers: ['score', 'content_evidence', 'user_memory', 'base_score', 'warning_penalty', 'modified_time', 'display_path', 'file_id'],
      },
      candidateBuckets,
      queryFiltering: {
        excludedTerms: relayQueryPlan.excludedTerms,
        excludedByQueryPlanCount,
      },
      diversity: {
        enabled: true,
        perDirectoryLimit: diversity.perDirectoryLimit,
        uniqueDirectoryCount: diversity.uniqueDirectoryCount,
        deferredCandidateCount: diversity.deferredCandidateCount,
      },
      searchBudget,
      resultGrouping: groupedRanked.diagnostics,
      folderRoles: {
        schemaVersion: 'RelayDocumentSearchFolderRoles.v1',
        summary: summarizeRelayDocumentSearchFolderRoles(folderRoleReports),
        classifiedResultCount: folderRoleReports.filter((report) => report.primaryRole).length,
      },
      userMemory: userMemory.diagnostics,
      metadataCache,
      filenameIndex: filenameIndex.diagnostics,
      freshness: summarizeRelayDocumentSearchFreshnessReports(freshnessReports),
      parsedDocumentCache,
      derivedContentIndex: {
        schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
        builtDocumentCount: derivedIndexes.length,
        entryCount: derivedIndexes.reduce((sum, index) => sum + index.entries.length, 0),
        textEntryCount: derivedIndexes.reduce((sum, index) => sum + index.diagnostics.textEntryCount, 0),
        tableCellEntryCount: derivedIndexes.reduce((sum, index) => sum + index.diagnostics.tableCellEntryCount, 0),
        previewAnchorCount: derivedIndexes.reduce((sum, index) => sum + index.diagnostics.previewAnchorCount, 0),
        searchStoreRowCount: derivedSearchStores.reduce((sum, store) => sum + store.diagnostics.rowCount, 0),
        searchStoreTextRowCount: derivedSearchStores.reduce((sum, store) => sum + store.diagnostics.textRowCount, 0),
        searchStoreTableCellRowCount: derivedSearchStores.reduce((sum, store) => sum + store.diagnostics.tableCellRowCount, 0),
        previewSpanSeedCount: derivedSearchStores.reduce((sum, store) => sum + store.diagnostics.previewSpanSeedCount, 0),
        matchedEntryCount: derivedSearches.reduce((sum, search) => sum + search.diagnostics.matchedEntryCount, 0),
        returnedAnchorCount: derivedSearches.reduce((sum, search) => sum + search.diagnostics.returnedAnchorCount, 0),
        returnedPreviewSpanCount: derivedSearches.reduce((sum, search) => sum + search.diagnostics.returnedPreviewSpanCount, 0),
        structureProfile: structureProfileSummary,
        ownership: derivedIndexOwnership,
        cache: derivedContentIndexCache,
      },
      contentIndexCommit,
      indexDb,
      indexCoordinator: indexCoordinator.diagnostics,
      scheduler: schedulerReport,
      syncJournal,
      indexReport,
      quality,
      evidenceRedaction,
      polishRequest: {
        schemaVersion: polishRequest.schemaVersion,
        status: polishRequest.status,
        reason: polishRequest.reason,
        promptTemplateId: polishRequest.prompt_template_id,
        expectedOutputSchema: polishRequest.expected_output_schema,
        redactionPolicy: polishRequest.redaction_policy,
        redactedEvidenceCount: polishRequest.redacted_evidence_count,
        promptCharacterCount: polishRequest.prompt?.length ?? 0,
      },
      polishProvider: polishProvider.report,
      localDraft: {
        schemaVersion: localDraft.schemaVersion,
        localDraftId: localDraft.local_draft_id,
        answerPolicy: localDraft.answer_policy,
        citationPolicy: localDraft.citation_policy,
        citationCount: localDraft.citations.length,
        canReplaceWithCopilotPolish: localDraft.can_replace_with_copilot_polish,
      },
      polishValidation,
      answer: {
        schemaVersion: answer.schemaVersion,
        answerId: answer.answer_id,
        source: answer.source,
        replacementCount: answer.replacement.replacementCount,
        canReplaceAgain: answer.replacement.canReplaceAgain,
        citationCount: answer.citation_ids.length,
      },
      copilotState,
      queryTrace,
      cancelled: state.cancelled,
      timedOut: state.timedOut,
    },
  };
}
