/**
 * Product-level result object contract for Relay Document Search.
 *
 * These fields are UI-neutral but actionable. AionUi owns rendering and actual
 * preview/open execution; Relay provides stable state and action descriptors so
 * Copilot prose never becomes the only way to act on search results.
 */

import { RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT } from './relayDocumentSearchContract';

export { RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT };

export const RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT = 'RelayDocumentSearchScoreBreakdown.v1' as const;
export const RELAY_DOCUMENT_SEARCH_RANKING_VERSION = 'relay-deterministic-ranker-v1' as const;

export type RelayDocumentSearchMatchMode = 'filename' | 'content' | 'hybrid' | 'table' | 'similar';
export type RelayDocumentSearchEvidenceState =
  | 'filename_only'
  | 'content_confirmed'
  | 'content_backed'
  | 'table_backed'
  | 'evidence_backed'
  | 'stale'
  | 'failed'
  | 'skipped';
export type RelayDocumentSearchIndexState =
  | 'metadata_indexed'
  | 'content_indexed'
  | 'table_indexed'
  | 'stale'
  | 'failed'
  | 'skipped';
export type RelayDocumentSearchPreviewState =
  | 'preview_ready'
  | 'preview_pending'
  | 'preview_unavailable'
  | 'preview_stale'
  | 'preview_denied'
  | 'preview_failed';
export type RelayDocumentSearchOpenState =
  | 'open_ready'
  | 'open_denied'
  | 'open_missing'
  | 'open_offline'
  | 'open_policy_blocked';
export type RelayDocumentSearchSourceIndexKind =
  | 'metadata_cache'
  | 'filename_index'
  | 'filename_fallback'
  | 'parsed_document_ir'
  | 'derived_content_index'
  | 'sqlite_fts_index'
  | 'table_index'
  | 'preview_anchor_index'
  | 'user_memory'
  | 'future_vector_index';
export type RelayDocumentSearchSourceIndexState = 'used' | 'available' | 'not_used' | 'unavailable';

export type RelayDocumentSearchSourceIndex = {
  kind: RelayDocumentSearchSourceIndexKind;
  label: string;
  state: RelayDocumentSearchSourceIndexState;
  score?: number;
  reason?: string;
};

export type RelayDocumentSearchScoreComponent = {
  score: number;
  applied: boolean;
  reason: string;
  rawScore?: number;
  cappedScore?: number;
  capLoss?: number;
  count?: number;
  details?: Record<string, unknown>;
};

export type RelayDocumentSearchScoreBreakdown = Record<string, unknown> & {
  score_breakdown_contract: typeof RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT;
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT;
  rankingVersion: typeof RELAY_DOCUMENT_SEARCH_RANKING_VERSION;
  deterministic: true;
  components: Record<string, RelayDocumentSearchScoreComponent>;
  totals: {
    baseScore: number;
    penaltyScore: number;
    finalScore: number;
    uncappedScore: number;
    capLoss: number;
  };
  tieBreakers: string[];
  explanationCodes: string[];
};

export type RelayDocumentSearchProductAction = {
  id: string;
  kind:
    | 'preview'
    | 'open_file'
    | 'open_containing_folder'
    | 'copy_path'
    | 'pin_result'
    | 'use_as_evidence'
    | 'refine_search'
    | 'retry_result'
    | 'rebuild_index';
  label: string;
  enabled: boolean;
  state?: RelayDocumentSearchPreviewState | RelayDocumentSearchOpenState | 'ready' | 'unavailable';
  path?: string;
  resultId?: string;
  reason?: string;
};

export type RelayDocumentSearchProductResultInput = {
  resultId: string;
  fileId: string;
  path: string;
  displayName: string;
  displayPath: string;
  extension: string;
  modifiedTime?: string;
  sourceMetadataVersion?: string;
  matchMode: RelayDocumentSearchMatchMode;
  evidenceState: RelayDocumentSearchEvidenceState;
  indexState: RelayDocumentSearchIndexState;
  score: number;
  scoreBreakdown: Record<string, unknown> | RelayDocumentSearchScoreBreakdown;
  anchors: Array<Record<string, unknown>>;
  warnings: string[];
  actions: string[];
  sourceIndexes?: RelayDocumentSearchSourceIndex[];
};

export type RelayDocumentSearchProductResult = {
  product_result_contract: typeof RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT;
  result_id: string;
  file_id: string;
  path: string;
  display_name: string;
  display_path: string;
  file_type: string;
  modified_time?: string;
  source_metadata_version?: string;
  match_mode: RelayDocumentSearchMatchMode;
  evidence_state: RelayDocumentSearchEvidenceState;
  index_state: RelayDocumentSearchIndexState;
  preview_state: RelayDocumentSearchPreviewState;
  open_state: RelayDocumentSearchOpenState;
  score: number;
  score_breakdown: RelayDocumentSearchScoreBreakdown;
  source_indexes: RelayDocumentSearchSourceIndex[];
  primary_source_index: RelayDocumentSearchSourceIndexKind;
  anchors: Array<Record<string, unknown>>;
  warnings: string[];
  actions: string[];
  action_models: RelayDocumentSearchProductAction[];
  preview_action: RelayDocumentSearchProductAction;
  open_action: RelayDocumentSearchProductAction;
  ui_state: {
    stableSelectionKey: string;
    stableSelectionKeyStrategy: 'file_id';
    evidenceLinkable: boolean;
    answerCitationAllowed: boolean;
    previewIndependentOfCopilot: true;
    openIndependentOfCopilot: true;
  };
};

export type RelayDocumentSearchProductResultValidation = {
  ok: boolean;
  errors: string[];
};

function includesAny(values: string[], targets: string[]): boolean {
  return targets.some((target) => values.includes(target));
}

function sourceIndexLabel(kind: RelayDocumentSearchSourceIndexKind): string {
  switch (kind) {
    case 'metadata_cache':
      return 'メタデータ';
    case 'filename_index':
      return 'ファイル名索引';
    case 'filename_fallback':
      return '簡易ファイル名検索';
    case 'parsed_document_ir':
      return '文書解析結果';
    case 'derived_content_index':
      return '本文派生索引';
    case 'sqlite_fts_index':
      return 'SQLite FTS索引';
    case 'table_index':
      return '表索引';
    case 'preview_anchor_index':
      return 'プレビュー位置';
    case 'user_memory':
      return 'ピン/履歴';
    case 'future_vector_index':
      return 'ベクトル索引';
    default:
      return '検索索引';
  }
}

function numberFromBreakdown(scoreBreakdown: Record<string, unknown>, key: string): number {
  const value = scoreBreakdown[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recordFromBreakdown(scoreBreakdown: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = scoreBreakdown[key];
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scoreComponent(
  scoreBreakdown: Record<string, unknown>,
  key: string,
  fallbackScore: number,
  reason: string,
  options: Partial<RelayDocumentSearchScoreComponent> = {},
): RelayDocumentSearchScoreComponent {
  const source = recordFromBreakdown(recordFromBreakdown(scoreBreakdown, 'components') ?? {}, key);
  const score = typeof source?.score === 'number' && Number.isFinite(source.score)
    ? source.score
    : fallbackScore;
  const rawScore = typeof source?.rawScore === 'number' && Number.isFinite(source.rawScore)
    ? source.rawScore
    : options.rawScore;
  const cappedScore = typeof source?.cappedScore === 'number' && Number.isFinite(source.cappedScore)
    ? source.cappedScore
    : options.cappedScore;
  const capLoss = typeof source?.capLoss === 'number' && Number.isFinite(source.capLoss)
    ? source.capLoss
    : options.capLoss;
  const count = typeof source?.count === 'number' && Number.isFinite(source.count)
    ? source.count
    : options.count;
  const details = recordFromBreakdown(source ?? {}, 'details') ?? options.details;
  return {
    score,
    applied: typeof source?.applied === 'boolean' ? source.applied : Boolean(options.applied ?? score !== 0),
    reason: typeof source?.reason === 'string' && source.reason.trim() ? source.reason : reason,
    ...(rawScore !== undefined ? { rawScore } : {}),
    ...(cappedScore !== undefined ? { cappedScore } : {}),
    ...(capLoss !== undefined ? { capLoss } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(details ? { details } : {}),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function normalizeRelayDocumentSearchScoreBreakdown(
  value: Record<string, unknown>,
): RelayDocumentSearchScoreBreakdown {
  const filenameScore = numberFromBreakdown(value, 'filename_score');
  const pathScore = numberFromBreakdown(value, 'path_score');
  const termScore = numberFromBreakdown(value, 'term_score');
  const sqliteFtsScore = numberFromBreakdown(value, 'sqlite_fts');
  const sqliteFtsUncappedScore = numberFromBreakdown(value, 'sqlite_fts_uncapped') || sqliteFtsScore;
  const sqliteFtsCapLoss = numberFromBreakdown(value, 'sqlite_fts_cap_loss');
  const contentScore = numberFromBreakdown(value, 'content');
  const tableCellScore = numberFromBreakdown(value, 'table_cell');
  const recencyScore = numberFromBreakdown(value, 'recency');
  const pinHistoryScore = numberFromBreakdown(value, 'memory') || numberFromBreakdown(value, 'pin_history');
  const groupingScore = numberFromBreakdown(value, 'grouping');
  const warningPenalty = numberFromBreakdown(value, 'warning_penalty');
  const baseScore = numberFromBreakdown(value, 'base_score') ||
    filenameScore + pathScore + termScore + sqliteFtsScore + contentScore + tableCellScore + recencyScore + pinHistoryScore + groupingScore;
  const finalScore = numberFromBreakdown(value, 'final_score') || Math.max(0, baseScore - warningPenalty);
  const hybridMergeScore = numberFromBreakdown(value, 'hybrid_merge') || baseScore;
  const existingTotals = recordFromBreakdown(value, 'totals');
  const totals = {
    baseScore: typeof existingTotals?.baseScore === 'number' ? existingTotals.baseScore : baseScore,
    penaltyScore: typeof existingTotals?.penaltyScore === 'number' ? existingTotals.penaltyScore : warningPenalty,
    finalScore: typeof existingTotals?.finalScore === 'number' ? existingTotals.finalScore : finalScore,
    uncappedScore: typeof existingTotals?.uncappedScore === 'number'
      ? existingTotals.uncappedScore
      : baseScore + sqliteFtsCapLoss,
    capLoss: typeof existingTotals?.capLoss === 'number' ? existingTotals.capLoss : sqliteFtsCapLoss,
  };
  const components = {
    filename: scoreComponent(value, 'filename', filenameScore, 'filename_match', {
      count: numberFromBreakdown(value, 'filename'),
    }),
    path: scoreComponent(value, 'path', pathScore, 'path_match', {
      count: numberFromBreakdown(value, 'path'),
    }),
    keyword: scoreComponent(value, 'keyword', termScore, 'normalized_keyword_match', {
      count: numberFromBreakdown(value, 'term'),
    }),
    sqlite_fts: scoreComponent(value, 'sqlite_fts', sqliteFtsScore, 'sqlite_fts_match', {
      rawScore: sqliteFtsUncappedScore,
      cappedScore: sqliteFtsScore,
      capLoss: sqliteFtsCapLoss,
    }),
    content: scoreComponent(value, 'content', contentScore, 'derived_content_match'),
    table_cell: scoreComponent(value, 'table_cell', tableCellScore, 'table_or_cell_match'),
    recency: scoreComponent(value, 'recency', recencyScore, 'modified_time_tie_breaker', {
      applied: recencyScore > 0,
    }),
    pin_history: scoreComponent(value, 'pin_history', pinHistoryScore, 'pinned_or_recent_user_signal'),
    grouping: scoreComponent(value, 'grouping', groupingScore, 'variant_grouping', {
      applied: Boolean(recordFromBreakdown(recordFromBreakdown(value, 'components') ?? {}, 'grouping')?.applied) ||
        groupingScore !== 0,
    }),
    warning_penalty: scoreComponent(value, 'warning_penalty', -Math.abs(warningPenalty), 'warning_confidence_penalty', {
      rawScore: warningPenalty,
      applied: warningPenalty > 0,
    }),
    hybrid_merge: scoreComponent(value, 'hybrid_merge', hybridMergeScore, 'deterministic_hybrid_merge', {
      applied: true,
    }),
  };
  return {
    ...value,
    score_breakdown_contract: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
    schemaVersion: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
    rankingVersion: RELAY_DOCUMENT_SEARCH_RANKING_VERSION,
    deterministic: true,
    components,
    totals,
    tieBreakers: asStringArray(value.tieBreakers).length
      ? asStringArray(value.tieBreakers)
      : ['score', 'content_evidence', 'pin_history', 'base_score', 'warning_penalty', 'modified_time', 'display_path', 'file_id'],
    explanationCodes: asStringArray(value.explanationCodes),
  };
}

function hasTableAnchor(anchors: Array<Record<string, unknown>>): boolean {
  return anchors.some((anchor) =>
    anchor.type === 'cell_excerpt' ||
      typeof anchor.cell === 'string' ||
      typeof anchor.cell_address === 'string' ||
      typeof anchor.sheet === 'string' ||
      typeof anchor.sheet_name === 'string' ||
      typeof anchor.table_id === 'string',
  );
}

function normalizeSourceIndex(
  sourceIndex: RelayDocumentSearchSourceIndex,
): RelayDocumentSearchSourceIndex {
  return {
    kind: sourceIndex.kind,
    label: sourceIndex.label || sourceIndexLabel(sourceIndex.kind),
    state: sourceIndex.state || 'used',
    score: typeof sourceIndex.score === 'number' && Number.isFinite(sourceIndex.score)
      ? sourceIndex.score
      : undefined,
    reason: sourceIndex.reason,
  };
}

function defaultSourceIndexes(input: RelayDocumentSearchProductResultInput): RelayDocumentSearchSourceIndex[] {
  const sources: RelayDocumentSearchSourceIndex[] = [
    {
      kind: 'metadata_cache',
      label: sourceIndexLabel('metadata_cache'),
      state: 'used',
      reason: 'file_discovery_and_metadata',
    },
  ];

  if (input.matchMode === 'filename') {
    sources.push({
      kind: 'filename_fallback',
      label: sourceIndexLabel('filename_fallback'),
      state: 'used',
      score: numberFromBreakdown(input.scoreBreakdown, 'filename') + numberFromBreakdown(input.scoreBreakdown, 'path'),
      reason: 'filename_or_path_match',
    });
  } else {
    sources.push(
      {
        kind: 'parsed_document_ir',
        label: sourceIndexLabel('parsed_document_ir'),
        state: 'used',
        reason: 'content_was_parsed',
      },
      {
        kind: 'derived_content_index',
        label: sourceIndexLabel('derived_content_index'),
        state: 'used',
        score: numberFromBreakdown(input.scoreBreakdown, 'content'),
        reason: 'content_match',
      },
    );
    if (input.anchors.length > 0) {
      sources.push({
        kind: 'preview_anchor_index',
        label: sourceIndexLabel('preview_anchor_index'),
        state: 'used',
        reason: 'preview_anchor_available',
      });
    }
    if (input.matchMode === 'table' || hasTableAnchor(input.anchors)) {
      sources.push({
        kind: 'table_index',
        label: sourceIndexLabel('table_index'),
        state: 'used',
        score: numberFromBreakdown(input.scoreBreakdown, 'content'),
        reason: 'table_or_cell_match',
      });
    }
  }

  if (numberFromBreakdown(input.scoreBreakdown, 'memory') > 0) {
    sources.push({
      kind: 'user_memory',
      label: sourceIndexLabel('user_memory'),
      state: 'used',
      score: numberFromBreakdown(input.scoreBreakdown, 'memory'),
      reason: 'pinned_or_recent_user_signal',
    });
  }

  return sources;
}

function sourceIndexes(input: RelayDocumentSearchProductResultInput): RelayDocumentSearchSourceIndex[] {
  const provided = Array.isArray(input.sourceIndexes)
    ? input.sourceIndexes.filter((sourceIndex): sourceIndex is RelayDocumentSearchSourceIndex =>
        Boolean(sourceIndex?.kind),
      )
    : [];
  const normalized = (provided.length ? provided : defaultSourceIndexes(input)).map(normalizeSourceIndex);
  const seen = new Set<RelayDocumentSearchSourceIndexKind>();
  return normalized.filter((sourceIndex) => {
    if (seen.has(sourceIndex.kind)) return false;
    seen.add(sourceIndex.kind);
    return true;
  });
}

function primarySourceIndex(
  sourceIndexes: RelayDocumentSearchSourceIndex[],
): RelayDocumentSearchSourceIndexKind {
  const priority: RelayDocumentSearchSourceIndexKind[] = [
    'table_index',
    'derived_content_index',
    'sqlite_fts_index',
    'parsed_document_ir',
    'filename_index',
    'filename_fallback',
    'user_memory',
    'metadata_cache',
    'preview_anchor_index',
    'future_vector_index',
  ];
  return priority.find((kind) => sourceIndexes.some((sourceIndex) => sourceIndex.kind === kind && sourceIndex.state === 'used')) ??
    sourceIndexes[0]?.kind ??
    'metadata_cache';
}

function previewState(input: RelayDocumentSearchProductResultInput): RelayDocumentSearchPreviewState {
  if (includesAny(input.warnings, ['preview_denied', 'permission_denied', 'access_denied', 'policy_denied'])) {
    return 'preview_denied';
  }
  if (includesAny(input.warnings, ['preview_failed', 'locked_file'])) return 'preview_failed';
  if (includesAny(input.warnings, ['offline_share', 'not_found'])) return 'preview_unavailable';
  if (input.indexState === 'stale' || input.evidenceState === 'stale') return 'preview_stale';
  if (includesAny(input.warnings, ['content_reader_unavailable', 'unsupported_content_reader'])) {
    return 'preview_unavailable';
  }
  if (input.anchors.length > 0 || input.evidenceState === 'content_confirmed' || input.evidenceState === 'content_backed') {
    return 'preview_ready';
  }
  return 'preview_pending';
}

function openState(input: RelayDocumentSearchProductResultInput): RelayDocumentSearchOpenState {
  if (!input.path) return 'open_missing';
  if (includesAny(input.warnings, ['not_found'])) return 'open_missing';
  if (includesAny(input.warnings, ['open_denied', 'permission_denied', 'access_denied'])) return 'open_denied';
  if (includesAny(input.warnings, ['open_offline', 'offline_share'])) return 'open_offline';
  if (includesAny(input.warnings, ['open_policy_blocked', 'policy_denied'])) return 'open_policy_blocked';
  return 'open_ready';
}

function actionLabel(kind: RelayDocumentSearchProductAction['kind']): string {
  switch (kind) {
    case 'preview':
      return 'プレビュー';
    case 'open_file':
      return '開く';
    case 'open_containing_folder':
      return 'フォルダを開く';
    case 'copy_path':
      return 'パスをコピー';
    case 'pin_result':
      return 'ピン留め';
    case 'use_as_evidence':
      return '根拠として使う';
    case 'refine_search':
      return '条件を調整';
    case 'retry_result':
      return '再試行';
    case 'rebuild_index':
      return '索引を作り直す';
    default:
      return '操作';
  }
}

function actionForKind(
  kind: RelayDocumentSearchProductAction['kind'],
  input: RelayDocumentSearchProductResultInput,
  preview: RelayDocumentSearchPreviewState,
  open: RelayDocumentSearchOpenState,
): RelayDocumentSearchProductAction {
  const previewEnabled = preview === 'preview_ready' || preview === 'preview_pending' || preview === 'preview_stale';
  const openEnabled = open === 'open_ready';
  const enabled = (() => {
    if (kind === 'preview') return previewEnabled;
    if (kind === 'open_file' || kind === 'open_containing_folder') return openEnabled;
    if (kind === 'use_as_evidence') return input.evidenceState !== 'filename_only' && input.anchors.length > 0;
    if (kind === 'retry_result' || kind === 'rebuild_index') return input.warnings.length > 0;
    return true;
  })();
  return {
    id: `${input.resultId}:${kind}`,
    kind,
    label: actionLabel(kind),
    enabled,
    state: kind === 'preview' ? preview : kind === 'open_file' || kind === 'open_containing_folder' ? open : enabled ? 'ready' : 'unavailable',
    path: input.path,
    resultId: input.resultId,
    reason: enabled ? undefined : 'action_not_available_for_current_result_state',
  };
}

function actionKinds(input: RelayDocumentSearchProductResultInput): RelayDocumentSearchProductAction['kind'][] {
  const mapped = input.actions.map((action) => {
    switch (action) {
      case 'preview':
        return 'preview';
      case 'open-file':
        return 'open_file';
      case 'open-containing-folder':
        return 'open_containing_folder';
      case 'copy-path':
        return 'copy_path';
      case 'pin-result':
        return 'pin_result';
      case 'use-as-evidence':
        return 'use_as_evidence';
      case 'refine-search':
        return 'refine_search';
      case 'retry-result':
        return 'retry_result';
      case 'rebuild-index':
        return 'rebuild_index';
      default:
        return undefined;
    }
  }).filter((action): action is RelayDocumentSearchProductAction['kind'] => Boolean(action));
  const repairActions: RelayDocumentSearchProductAction['kind'][] = [];
  if (includesAny(input.warnings, ['stale', 'failed', 'skipped', 'content_not_confirmed', 'permission_changed'])) {
    repairActions.push('retry_result');
  }
  if (includesAny(input.warnings, ['stale', 'failed', 'skipped'])) {
    repairActions.push('rebuild_index');
  }
  return [...new Set(['preview', 'open_file', 'open_containing_folder', 'copy_path', ...mapped, ...repairActions])];
}

export function buildRelayDocumentSearchProductResult(
  input: RelayDocumentSearchProductResultInput,
): RelayDocumentSearchProductResult {
  const preview = previewState(input);
  const open = openState(input);
  const action_models = actionKinds(input).map((kind) => actionForKind(kind, input, preview, open));
  const scoreBreakdown = normalizeRelayDocumentSearchScoreBreakdown(input.scoreBreakdown);
  const evidenceLinkable = input.anchors.length > 0 &&
    preview !== 'preview_denied' &&
    preview !== 'preview_failed' &&
    preview !== 'preview_unavailable' &&
    open !== 'open_denied' &&
    open !== 'open_missing' &&
    open !== 'open_offline' &&
    open !== 'open_policy_blocked';
  const normalizedSourceIndexes = sourceIndexes(input);
  return {
    product_result_contract: RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT,
    result_id: input.resultId,
    file_id: input.fileId,
    path: input.path,
    display_name: input.displayName,
    display_path: input.displayPath,
    file_type: input.extension,
    modified_time: input.modifiedTime,
    source_metadata_version: input.sourceMetadataVersion,
    match_mode: input.matchMode,
    evidence_state: input.evidenceState,
    index_state: input.indexState,
    preview_state: preview,
    open_state: open,
    score: input.score,
    score_breakdown: scoreBreakdown,
    source_indexes: normalizedSourceIndexes,
    primary_source_index: primarySourceIndex(normalizedSourceIndexes),
    anchors: input.anchors,
    warnings: input.warnings,
    actions: input.actions,
    action_models,
    preview_action: actionForKind('preview', input, preview, open),
    open_action: actionForKind('open_file', input, preview, open),
    ui_state: {
      stableSelectionKey: input.fileId,
      stableSelectionKeyStrategy: 'file_id',
      evidenceLinkable,
      answerCitationAllowed: evidenceLinkable && input.evidenceState !== 'filename_only',
      previewIndependentOfCopilot: true,
      openIndependentOfCopilot: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateRelayDocumentSearchProductResult(input: unknown): RelayDocumentSearchProductResultValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['product result must be an object'] };
  if (input.product_result_contract !== RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT) {
    errors.push(`product_result_contract must be ${RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT}`);
  }
  for (const field of ['result_id', 'file_id', 'path', 'display_name', 'match_mode', 'evidence_state', 'index_state']) {
    if (typeof input[field] !== 'string' || !String(input[field]).trim()) errors.push(`${field} is required`);
  }
  if (typeof input.preview_state !== 'string') errors.push('preview_state is required');
  if (typeof input.open_state !== 'string') errors.push('open_state is required');
  if (!isRecord(input.score_breakdown)) {
    errors.push('score_breakdown is required');
  } else if (
    input.score_breakdown.score_breakdown_contract !== undefined &&
    input.score_breakdown.score_breakdown_contract !== RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT
  ) {
    errors.push(`score_breakdown.score_breakdown_contract must be ${RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT}`);
  }
  if (!Array.isArray(input.source_indexes)) {
    errors.push('source_indexes must be an array');
  } else if (
    input.source_indexes.some((sourceIndex) =>
      !isRecord(sourceIndex) ||
        typeof sourceIndex.kind !== 'string' ||
        typeof sourceIndex.label !== 'string' ||
        typeof sourceIndex.state !== 'string',
    )
  ) {
    errors.push('source_indexes entries must include kind, label, and state');
  }
  if (typeof input.primary_source_index !== 'string' || !String(input.primary_source_index).trim()) {
    errors.push('primary_source_index is required');
  }
  if (!Array.isArray(input.anchors)) errors.push('anchors must be an array');
  if (!Array.isArray(input.action_models)) errors.push('action_models must be an array');
  if (!isRecord(input.preview_action)) errors.push('preview_action is required');
  if (!isRecord(input.open_action)) errors.push('open_action is required');
  if (!isRecord(input.ui_state)) {
    errors.push('ui_state is required');
  } else {
    if (typeof input.ui_state.stableSelectionKey !== 'string' || !input.ui_state.stableSelectionKey.trim()) {
      errors.push('ui_state.stableSelectionKey is required');
    }
    if (input.ui_state.stableSelectionKeyStrategy !== 'file_id') {
      errors.push('ui_state.stableSelectionKeyStrategy must be file_id');
    }
  }
  return { ok: errors.length === 0, errors };
}
