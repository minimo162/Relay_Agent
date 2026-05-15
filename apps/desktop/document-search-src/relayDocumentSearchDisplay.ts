/**
 * Renderer-neutral display adapter for Relay Document Search results.
 *
 * AionUi owns the visual components. This module only converts the stable
 * `RelayDocumentSearchResult.v1` payload into a compact, beginner-safe display
 * model that existing chat/result-card surfaces can render without asking
 * Copilot to rewrite local search state.
 */

import {
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  validateRelayDocumentSearchResult,
  type RelayDocumentSearchResultV1,
} from './relayDocumentSearchContract';

export const RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT = 'RelayDocumentSearchDisplay.v1' as const;
export const RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT = 'RelayDocumentSearchResultFlow.v1' as const;

export type RelayDocumentSearchDisplayDetailLevel = 'overview' | 'details' | 'support';

export type RelayDocumentSearchDisplayDetailSection = {
  level: RelayDocumentSearchDisplayDetailLevel;
  title: string;
  items: string[];
  initiallyCollapsed: boolean;
  supportOnly?: boolean;
};

export type RelayDocumentSearchDisplayCard = {
  resultId: string;
  stableSelectionKey: string;
  position: number;
  selected: boolean;
  title: string;
  path: string;
  matchLabel: string;
  evidenceLabel: string;
  indexLabel: string;
  sourceLabel: string;
  sourceLabels: string[];
  rankingLabel: string;
  scoreBreakdownLabels: string[];
  previewLabel: string;
  openLabel: string;
  warningLabels: string[];
  groupLabel?: string;
  folderRoleLabel?: string;
  candidateBucketLabel?: string;
  collapsedGroupCount?: number;
  actions: string[];
  actionModels: Array<Record<string, unknown>>;
};

export type RelayDocumentSearchDisplayAction = {
  kind: 'retry_search' | 'rebuild_index' | 'show_index_status';
  label: string;
  enabled: boolean;
  reason?: string;
};

export type RelayDocumentSearchIndexStatusDisplay = {
  state: 'disabled' | 'ready' | 'degraded' | 'blocked' | 'unknown';
  label: string;
  activePathLabel: string;
  message: string;
  reasons: string[];
  actions: RelayDocumentSearchDisplayAction[];
};

export type RelayDocumentSearchDisplaySelectionState = {
  strategy: 'stableSelectionKey';
  selectedStableSelectionKey?: string;
  selectedResultId?: string;
  selectedPosition?: number;
  selectedVisible: boolean;
  selectedAvailable: boolean;
  visibleStableSelectionKeys: string[];
  allStableSelectionKeys: string[];
};

export type RelayDocumentSearchResultFlowV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT;
  owner: 'aionui';
  rendererPolicy: 'structured-result-cards-primary';
  structuredResultCardsPrimary: true;
  copilotProseSecondary: true;
  batch: {
    strategy: 'capped-batches';
    offset: number;
    limit: number;
    shownStart: number;
    shownEnd: number;
    shownResults: number;
    totalResults: number;
    hasMore: boolean;
    nextOffset?: number;
  };
  continuationAction?: {
    kind: 'show-more-results';
    label: string;
    nextOffset: number;
    preserveSelectionKey?: string;
  };
  refineActions: string[];
  selection: RelayDocumentSearchDisplaySelectionState;
  partialResultExplanations: string[];
  indexStatus: RelayDocumentSearchIndexStatusDisplay;
  copilotProse: {
    role: 'secondary';
    summaryField: 'answerSummary' | 'summary';
    localDraftField?: 'localDraftSummary';
  };
};

export type RelayDocumentSearchDisplayV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT;
  sourceSchemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT;
  resultFlow: RelayDocumentSearchResultFlowV1;
  status: RelayDocumentSearchResultV1['status'];
  statusLabel: string;
  summary: string;
  answerSummary?: string;
  answerSourceLabel?: string;
  answerCitationLabels?: string[];
  localDraftSummary?: string;
  localDraftCitationLabels?: string[];
  indexStatus: RelayDocumentSearchIndexStatusDisplay;
  partialResultExplanations: string[];
  repairActions: RelayDocumentSearchDisplayAction[];
  cards: RelayDocumentSearchDisplayCard[];
  hasMore: boolean;
  coverageLabel: string;
  emptyStateGuidance: string[];
  refineActions: string[];
  totalResults: number;
  shownResults: number;
  nextOffset?: number;
  continuationAction?: {
    kind: 'show-more-results';
    label: string;
    nextOffset: number;
  };
  detailLevels: Array<{
    level: RelayDocumentSearchDisplayDetailLevel;
    label: string;
    visibleByDefault: boolean;
  }>;
  detailSections: RelayDocumentSearchDisplayDetailSection[];
  supportDetailsAvailable: boolean;
};

export type RelayDocumentSearchDisplayOptions = {
  maxCards?: number;
  offset?: number;
  selectedStableSelectionKey?: string;
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compactUnique(items: Array<string | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item && item.trim())))];
}

function countLabel(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function numberRecordSummary(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`);
}

function indexDbFactsFromResult(result: RelayDocumentSearchResultV1): Record<string, unknown> | undefined {
  const diagnostics = asRecord(result.diagnostics);
  const queryTrace = asRecord(diagnostics?.queryTrace);
  const stages = Array.isArray(queryTrace?.stages) ? queryTrace.stages : [];
  return stages
    .map((stage) => asRecord(stage))
    .find((stage) => asString(stage?.name) === 'index_db')
    ? asRecord(stages
      .map((stage) => asRecord(stage))
      .find((stage) => asString(stage?.name) === 'index_db')?.facts)
    : asRecord(asRecord(diagnostics?.indexDb)?.cutoverReadiness);
}

function indexReasonLabel(reason: string): string {
  switch (reason) {
    case 'primary_mode_disabled':
      return '高速索引は通常検索の補助として使っています';
    case 'primary_rollback_to_filename_content':
    case 'primary_rollback_forced':
      return '安全のため通常の検索経路に戻しています';
    case 'readiness_degraded':
      return '索引の一部を確認中です';
    case 'readiness_blocked':
      return '索引を今は使えません';
    case 'fts_result_limit_reached':
      return '一致が多いため索引結果は一部だけ確認しました';
    case 'stale_or_incomplete_fts_rows_present':
      return '古い索引があるため再確認が必要です';
    case 'fts_rows_outside_current_scan':
      return '今回のフォルダ確認外の索引候補を除外しました';
    case 'write_errors_present':
    case 'search_errors_present':
    case 'search_report_errors_present':
    case 'write_report_errors_present':
      return '索引の更新または検索でエラーがありました';
    case 'no_fresh_current_scan_fts_files':
    case 'no_fresh_current_scan_fts_rows':
    case 'no_fts_evidence_promoted_in_this_query':
      return '今回の検索で使える新しい索引根拠はまだありません';
    case 'sqlite_fts_primary_active':
      return '高速索引を主な検索経路として使っています';
    case 'primary_shadow_eligible':
      return '高速索引は主経路候補として検証中です';
    case 'primary_shadow_blocked':
      return '高速索引は主経路候補ですが、まだ条件を満たしていません';
    default:
      return reason.replace(/_/gu, ' ');
  }
}

function indexActivePathLabel(activePath: string): string {
  switch (activePath) {
    case 'sqlite_fts_primary':
      return '高速索引を主に使用';
    case 'filename_content':
      return 'ファイル名と本文検索を使用';
    case 'disabled':
      return '高速索引は未使用';
    default:
      return '検索経路を確認中';
  }
}

function indexStatusDisplay(result: RelayDocumentSearchResultV1): RelayDocumentSearchIndexStatusDisplay {
  const facts = indexDbFactsFromResult(result);
  const primaryPathGate = asRecord(facts?.primaryPathGate);
  const enabled = Boolean(facts?.enabled ?? asRecord(result.diagnostics)?.indexDb);
  const readiness = asString(facts?.readinessStatus, asString(facts?.status, enabled ? 'unknown' : 'disabled'));
  const activePath = asString(primaryPathGate?.activePath, enabled ? 'filename_content' : 'disabled');
  const rollback = Boolean(primaryPathGate?.rollbackActive);
  const reasonCodes = compactUnique([
    ...asStringArray(facts?.readinessReasons),
    ...asStringArray(primaryPathGate?.reasons),
    ...(facts?.searchTruncated ? ['fts_result_limit_reached'] : []),
  ]);
  const state: RelayDocumentSearchIndexStatusDisplay['state'] =
    readiness === 'ready'
      ? 'ready'
      : readiness === 'degraded'
        ? 'degraded'
        : readiness === 'blocked'
          ? 'blocked'
          : readiness === 'disabled'
            ? 'disabled'
            : 'unknown';
  const label = (() => {
    if (state === 'ready') return activePath === 'sqlite_fts_primary' ? '高速索引で検索中' : '索引は利用できます';
    if (state === 'degraded') return '索引は一部だけ利用中';
    if (state === 'blocked') return '索引を再確認中';
    if (state === 'disabled') return '高速索引は未使用';
    return '索引状態を確認中';
  })();
  const message = (() => {
    if (state === 'ready' && activePath === 'sqlite_fts_primary') return '高速索引を主な検索経路として使っています。';
    if (state === 'ready') return '高速索引は補助として使えます。';
    if (rollback) return '索引に未確認の点があるため、通常の検索結果を優先しています。';
    if (state === 'degraded') return '索引の一部を使いながら、確認できた範囲の結果を表示しています。';
    if (state === 'blocked') return '索引を使えないため、通常の検索結果を表示しています。';
    if (state === 'disabled') return '通常の検索経路で結果を表示しています。';
    return '検索経路を確認しています。';
  })();
  const actions: RelayDocumentSearchDisplayAction[] = state === 'degraded' || state === 'blocked'
    ? [
        { kind: 'retry_search', label: 'もう一度検索', enabled: true },
        { kind: 'rebuild_index', label: '索引を作り直す', enabled: true },
        { kind: 'show_index_status', label: '索引状態を見る', enabled: true },
      ]
    : state === 'ready'
      ? [{ kind: 'show_index_status', label: '索引状態を見る', enabled: true }]
      : [];
  return {
    state,
    label,
    activePathLabel: indexActivePathLabel(activePath),
    message,
    reasons: compactUnique(reasonCodes.map(indexReasonLabel)),
    actions,
  };
}

function partialResultExplanations(
  result: RelayDocumentSearchResultV1,
  indexStatus: RelayDocumentSearchIndexStatusDisplay,
): string[] {
  return compactUnique([
    result.status === 'partial' ? '確認できた範囲の結果を表示しています。' : undefined,
    result.coverage.truncated ? '検索対象が多いため、途中までの結果です。' : undefined,
    indexStatus.state === 'degraded' || indexStatus.state === 'blocked' ? indexStatus.message : undefined,
    ...asStringArray(result.display?.emptyStateGuidance),
  ]);
}

function statusLabel(status: RelayDocumentSearchResultV1['status']): string {
  switch (status) {
    case 'ok':
      return '検索できました';
    case 'partial':
      return '一部だけ検索できました';
    case 'needs_input':
      return 'フォルダの指定が必要です';
    case 'failed':
      return '検索できませんでした';
    default:
      return '検索状態を確認してください';
  }
}

function matchLabel(matchMode: string): string {
  switch (matchMode) {
    case 'filename':
      return 'ファイル名・パスに一致';
    case 'content':
      return '本文に一致';
    case 'hybrid':
      return 'ファイル名と本文に一致';
    case 'table':
      return '表に一致';
    case 'semantic':
      return '意味的に近い候補';
    default:
      return '候補';
  }
}

function evidenceLabel(evidenceState: string): string {
  switch (evidenceState) {
    case 'filename_only':
      return 'ファイル名候補';
    case 'concept_confirmed':
      return '概念一致を確認';
    case 'concept_candidate':
      return '概念候補';
    case 'entity_context_match':
      return '名称文脈の候補';
    case 'content_confirmed':
      return '中身を確認済み';
    case 'content_backed':
      return '本文根拠あり';
    case 'table_backed':
      return '表の根拠あり';
    case 'evidence_backed':
      return '根拠あり';
    case 'stale':
      return '再確認が必要';
    case 'failed':
      return '中身確認に失敗';
    case 'skipped':
      return '中身確認をスキップ';
    default:
      return '未確認';
  }
}

function indexLabel(indexState: string): string {
  switch (indexState) {
    case 'metadata_indexed':
      return 'メタデータ検索';
    case 'content_indexed':
      return '本文検索';
    case 'table_indexed':
      return '表検索';
    case 'stale':
      return '再確認が必要';
    case 'failed':
      return '索引作成に失敗';
    case 'skipped':
      return '索引作成をスキップ';
    default:
      return '検索状態不明';
  }
}

function sourceIndexLabel(kind: string): string {
  switch (kind) {
    case 'metadata_cache':
      return 'メタデータ';
    case 'filename_index':
      return 'ファイル名索引';
    case 'filename_fallback':
      return 'ファイル名';
    case 'sqlite_fts_index':
      return 'SQLite FTS索引';
    case 'parsed_document_ir':
      return '文書解析結果';
    case 'derived_content_index':
      return '本文索引';
    case 'table_index':
      return '表索引';
    case 'preview_anchor_index':
      return 'プレビュー位置';
    case 'user_memory':
      return 'ピン/履歴';
    case 'future_vector_index':
      return 'ベクトル索引';
    default:
      return kind || '検索索引';
  }
}

function sourceLabels(candidate: Record<string, unknown>): string[] {
  if (!Array.isArray(candidate.source_indexes)) return [];
  return compactUnique(candidate.source_indexes
    .map((sourceIndex) => asRecord(sourceIndex))
    .filter((sourceIndex): sourceIndex is Record<string, unknown> => Boolean(sourceIndex))
    .filter((sourceIndex) => !asString(sourceIndex.state) || asString(sourceIndex.state) === 'used')
    .map((sourceIndex) => asString(sourceIndex.label, sourceIndexLabel(asString(sourceIndex.kind)))));
}

function sourceLabel(candidate: Record<string, unknown>): string {
  const sources = Array.isArray(candidate.source_indexes)
    ? candidate.source_indexes
      .map((sourceIndex) => asRecord(sourceIndex))
      .filter((sourceIndex): sourceIndex is Record<string, unknown> => Boolean(sourceIndex))
      .map((sourceIndex) => asString(sourceIndex.kind))
    : [];
  const primary = asString(candidate.primary_source_index);
  const has = (kind: string) => primary === kind || sources.includes(kind);
  if (has('table_index')) return '表の中身から検索';
  if (has('derived_content_index') || has('parsed_document_ir')) return '本文の中身から検索';
  if (has('filename_index')) return 'ファイル名索引から検索';
  if (has('filename_fallback')) return 'ファイル名から検索';
  if (has('user_memory')) return 'ピン/履歴を優先';
  if (has('metadata_cache')) return 'メタデータから検索';
  return '検索経路を確認中';
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function scoreBreakdownLabels(candidate: Record<string, unknown>): string[] {
  const scoreBreakdown = asRecord(candidate.score_breakdown);
  if (!scoreBreakdown) return [];
  const components = asRecord(scoreBreakdown.components);
  const labels = [
    numberFromRecord(scoreBreakdown, 'filename_score') > 0
      ? `ファイル名 +${numberFromRecord(scoreBreakdown, 'filename_score')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'path_score') > 0
      ? `パス +${numberFromRecord(scoreBreakdown, 'path_score')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'term_score') > 0
      ? `キーワード +${numberFromRecord(scoreBreakdown, 'term_score')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'folder_role') > 0
      ? `作業フォルダ +${numberFromRecord(scoreBreakdown, 'folder_role')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'folder_role') < 0
      ? `保管/監査フォルダ ${numberFromRecord(scoreBreakdown, 'folder_role')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'sqlite_fts') > 0
      ? `SQLite FTS +${numberFromRecord(scoreBreakdown, 'sqlite_fts')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'content') > 0
      ? `本文 +${numberFromRecord(scoreBreakdown, 'content')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'table_cell') > 0
      ? `表/セル +${numberFromRecord(scoreBreakdown, 'table_cell')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'memory') > 0 || numberFromRecord(scoreBreakdown, 'pin_history') > 0
      ? `ピン/履歴 +${numberFromRecord(scoreBreakdown, 'memory') || numberFromRecord(scoreBreakdown, 'pin_history')}`
      : undefined,
    asRecord(components?.grouping)?.applied === true ? '類似候補を集約' : undefined,
    numberFromRecord(scoreBreakdown, 'warning_penalty') > 0
      ? `警告 -${numberFromRecord(scoreBreakdown, 'warning_penalty')}`
      : undefined,
    numberFromRecord(scoreBreakdown, 'final_score') > 0
      ? `最終 ${numberFromRecord(scoreBreakdown, 'final_score')}`
      : undefined,
  ];
  return compactUnique(labels);
}

function rankingLabel(candidate: Record<string, unknown>): string {
  const scoreBreakdown = asRecord(candidate.score_breakdown);
  const finalScore = numberFromRecord(scoreBreakdown, 'final_score') || (
    typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : 0
  );
  const warningPenalty = numberFromRecord(scoreBreakdown, 'warning_penalty');
  if (warningPenalty > 0) return `関連度 ${finalScore}（警告で調整）`;
  if (asRecord(asRecord(scoreBreakdown?.components)?.grouping)?.applied === true) {
    return `関連度 ${finalScore}（類似候補を集約）`;
  }
  return `関連度 ${finalScore}`;
}

function previewLabel(previewState: string): string {
  switch (previewState) {
    case 'preview_ready':
      return 'プレビューできます';
    case 'preview_pending':
      return 'プレビュー準備中';
    case 'preview_unavailable':
      return 'プレビュー未対応';
    case 'preview_stale':
      return 'プレビュー再確認が必要';
    case 'preview_denied':
      return 'プレビュー権限なし';
    case 'preview_failed':
      return 'プレビュー失敗';
    default:
      return 'プレビュー状態不明';
  }
}

function openLabel(openState: string): string {
  switch (openState) {
    case 'open_ready':
      return '開けます';
    case 'open_denied':
      return '開く権限がありません';
    case 'open_missing':
      return 'ファイルが見つかりません';
    case 'open_offline':
      return 'オフラインです';
    case 'open_policy_blocked':
      return 'ポリシーで開けません';
    default:
      return '開く状態不明';
  }
}

function warningLabel(warning: string): string {
  switch (warning) {
    case 'filename_only':
      return '中身はまだ確認していません';
    case 'content_reader_unavailable':
      return 'この形式の中身確認は未対応です';
    case 'content_not_confirmed':
      return '中身に一致する根拠は未確認です';
    case 'unsupported_content_reader':
      return 'この形式はファイル名のみ検索できます';
    case 'access_denied':
      return '現在のユーザーでは開けません';
    case 'permission_changed':
      return 'アクセス権が変わったため再確認が必要です';
    case 'offline_share':
      return '共有フォルダに接続できません';
    case 'locked_file':
      return 'ファイルが使用中のため確認できません';
    case 'policy_denied':
      return 'ポリシーにより操作できません';
    case 'not_found':
      return 'ファイルが見つかりません';
    case 'preview_denied':
      return 'プレビュー権限がありません';
    case 'open_denied':
      return '開く権限がありません';
    case 'open_offline':
      return 'オフラインのため開けません';
    case 'open_policy_blocked':
      return 'ポリシーにより開けません';
    case 'stale':
      return '古い索引のため再確認が必要です';
    case 'failed':
      return '確認に失敗しました';
    case 'skipped':
      return '確認をスキップしました';
    case 'attachment_skipped':
      return '添付ファイルはまだ確認していません';
    case 'table_extraction_unavailable':
      return '表の詳細確認は未対応です';
    case 'no_filename_candidates':
      return 'ファイル名候補がありません';
    default:
      return warning;
  }
}

function folderRoleLabel(role: string): string | undefined {
  switch (role) {
    case 'filing':
      return '保管・提出フォルダ';
    case 'output':
      return '出力・最終版フォルダ';
    case 'audit':
      return '監査・会計士関連フォルダ';
    case 'backup':
      return 'バックアップフォルダ';
    case 'work':
      return '作業フォルダ';
    case 'source':
      return '元データフォルダ';
    case 'review':
      return '確認・レビューフォルダ';
    default:
      return undefined;
  }
}

function candidateBucketLabel(bucket: string): string | undefined {
  switch (bucket) {
    case 'direct_source_workpaper':
      return '作業用・元資料候補';
    case 'supporting_evidence':
      return '補助根拠候補';
    case 'disclosure_output':
      return '開示・出力候補';
    case 'review_or_audit':
      return '確認・監査候補';
    case 'backup_or_archive':
      return 'バックアップ・履歴候補';
    case 'uncategorized':
      return '未分類候補';
    default:
      return undefined;
  }
}

function candidateBucketSortKey(bucket: string): number {
  switch (bucket) {
    case 'direct_source_workpaper':
      return 0;
    case 'supporting_evidence':
      return 1;
    case 'disclosure_output':
      return 2;
    case 'review_or_audit':
      return 3;
    case 'backup_or_archive':
      return 4;
    default:
      return 5;
  }
}

function coverageLabel(result: RelayDocumentSearchResultV1): string {
  const scannedFiles = typeof result.progress.scannedFiles === 'number' ? result.progress.scannedFiles : 0;
  const skippedFiles = typeof result.progress.skippedFiles === 'number' ? result.progress.skippedFiles : 0;
  const truncated = Boolean(result.coverage.truncated);
  if (truncated) {
    return `${scannedFiles}件を確認しました。結果は途中までです。`;
  }
  if (skippedFiles > 0) {
    return `${scannedFiles}件を確認しました。${skippedFiles}件は対象外または確認できませんでした。`;
  }
  return `${scannedFiles}件を確認しました。`;
}

function stableSelectionKeyForCandidate(candidate: Record<string, unknown>): string {
  const uiState = asRecord(candidate.ui_state);
  return asString(
    uiState?.stableSelectionKey,
    asString(candidate.file_id, asString(candidate.path, asString(candidate.result_id))),
  );
}

function cardFromResult(
  candidate: Record<string, unknown>,
  position: number,
  selectedStableSelectionKey?: string,
): RelayDocumentSearchDisplayCard {
  const fileMetadata = candidate.file_metadata && typeof candidate.file_metadata === 'object'
    ? (candidate.file_metadata as Record<string, unknown>)
    : {};
  const title = asString(candidate.display_name, asString(fileMetadata.name, '名称未設定のファイル'));
  const path = asString(candidate.path, asString(candidate.display_path, asString(fileMetadata.path)));
  const group = candidate.result_group && typeof candidate.result_group === 'object'
    ? (candidate.result_group as Record<string, unknown>)
    : {};
  const collapsedGroupCount = typeof group.collapsedCount === 'number' ? group.collapsedCount : 0;
  const resolvedSourceLabels = sourceLabels(candidate);
  const resolvedScoreLabels = scoreBreakdownLabels(candidate);
  const stableSelectionKey = stableSelectionKeyForCandidate(candidate);
  return {
    resultId: asString(candidate.result_id, asString(candidate.file_id, path || title)),
    stableSelectionKey,
    position,
    selected: Boolean(selectedStableSelectionKey && stableSelectionKey === selectedStableSelectionKey),
    title,
    path,
    matchLabel: matchLabel(asString(candidate.match_mode)),
    evidenceLabel: evidenceLabel(asString(candidate.evidence_state)),
    indexLabel: indexLabel(asString(candidate.index_state)),
    sourceLabel: sourceLabel(candidate),
    sourceLabels: resolvedSourceLabels,
    rankingLabel: rankingLabel(candidate),
    scoreBreakdownLabels: resolvedScoreLabels,
    previewLabel: previewLabel(asString(candidate.preview_state)),
    openLabel: openLabel(asString(candidate.open_state)),
    warningLabels: asStringArray(candidate.warnings).map(warningLabel),
    groupLabel: collapsedGroupCount > 0 ? `${collapsedGroupCount}件の類似候補をまとめています` : undefined,
    folderRoleLabel: folderRoleLabel(asString(candidate.folder_role)),
    candidateBucketLabel: candidateBucketLabel(asString(candidate.candidate_bucket)),
    collapsedGroupCount: collapsedGroupCount > 0 ? collapsedGroupCount : undefined,
    actions: asStringArray(candidate.actions),
    actionModels: Array.isArray(candidate.action_models)
      ? candidate.action_models.filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
      : [],
  };
}

function anchorLocationLabel(anchor: Record<string, unknown>): string | undefined {
  const sheet = asString(anchor.sheet, asString(anchor.sheet_name));
  const cell = asString(anchor.cell, asString(anchor.cell_address, asString(anchor.address, asString(anchor.range))));
  if (sheet && cell) return `表: ${sheet}!${cell}`;
  if (cell) return `表: ${cell}`;

  const page = countLabel(anchor.page ?? anchor.pageNumber);
  if (page) return `ページ ${page}`;

  const line = countLabel(anchor.line ?? anchor.lineNumber);
  if (line) return `行 ${line}`;

  const paragraph = countLabel(anchor.paragraph ?? anchor.paragraphIndex);
  if (paragraph) return `段落 ${paragraph}`;

  const table = countLabel(anchor.tableId ?? anchor.table_id);
  if (table) return `表 ${table}`;

  const node = asString(anchor.nodeId, asString(anchor.node_id));
  if (node) return `構造位置 ${node}`;

  const kind = asString(anchor.kind, asString(anchor.type));
  return kind ? `根拠位置: ${kind}` : undefined;
}

function anchorIsStructured(anchor: Record<string, unknown>): boolean {
  return Boolean(
    anchor.sheet ||
      anchor.cell ||
      anchor.cell_address ||
      anchor.address ||
      anchor.range ||
      anchor.sheet_name ||
      anchor.tableId ||
      anchor.table_id ||
      anchor.nodeId ||
      anchor.node_id ||
      anchor.paragraph ||
      anchor.paragraphIndex,
  );
}

function candidateBucketDetailItems(candidates: Record<string, unknown>[]): string[] {
  const buckets = new Map<string, { count: number; examples: string[] }>();
  for (const candidate of candidates) {
    const bucket = asString(candidate.candidate_bucket, 'uncategorized');
    const current = buckets.get(bucket) ?? { count: 0, examples: [] };
    current.count += 1;
    const title = asString(candidate.display_name, asString(candidate.path));
    if (title && current.examples.length < 3) current.examples.push(title);
    buckets.set(bucket, current);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => candidateBucketSortKey(left) - candidateBucketSortKey(right))
    .map(([bucket, value]) => {
      const label = candidateBucketLabel(bucket) ?? bucket;
      const examples = value.examples.length ? `（例: ${value.examples.join(' / ')}）` : '';
      return `${label}: ${value.count}件${examples}`;
    });
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(?:xlsx|xlsm|xls|docx|doc|pptx|ppt|pdf|csv|txt|md|lnk)$/iu, '');
}

function candidateFamilyKey(candidate: Record<string, unknown>): string {
  const title = stripKnownExtension(asString(candidate.display_name, asString(candidate.path)));
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b20\d{2}[-_.]?\d{2}[-_.]?\d{2}\b/gu, ' ')
    .replace(/\b\d{6,8}\b/gu, ' ')
    .replace(/[（(]\s*(?:\d+|監査|リンク|確|final\d*|draft\d*|copy|コピー)\s*[）)]/giu, ' ')
    .replace(/(?:修正履歴|コピー|複製|backup|bak|old|archive|final\d*|draft\d*|リンク|監査|確)/giu, ' ')
    .replace(/[\\/_\-・.()[\]{}【】（）→]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function modifiedTimeMs(candidate: Record<string, unknown>): number {
  const parsed = Date.parse(asString(candidate.modified_time));
  return Number.isFinite(parsed) ? parsed : 0;
}

function candidateFamilyDetailItems(candidates: Record<string, unknown>[]): string[] {
  const families = new Map<string, Record<string, unknown>[]>();
  for (const candidate of candidates) {
    const key = candidateFamilyKey(candidate);
    if (!key) continue;
    const current = families.get(key) ?? [];
    current.push(candidate);
    families.set(key, current);
  }
  return [...families.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([, left], [, right]) => right.length - left.length)
    .slice(0, 8)
    .map(([key, members]) => {
      const sorted = [...members].sort((left, right) =>
        modifiedTimeMs(right) - modifiedTimeMs(left) ||
        asString(left.display_path, asString(left.path)).localeCompare(asString(right.display_path, asString(right.path))),
      );
      const top = asString(sorted[0].display_name, asString(sorted[0].path, key));
      const examples = sorted.slice(0, 3)
        .map((candidate) => asString(candidate.display_name, asString(candidate.path)))
        .filter(Boolean);
      return `${top}: ${members.length}件の版違い・類似候補（表示範囲内、例: ${examples.join(' / ')}）`;
    });
}

function queryTraceSupportItems(result: RelayDocumentSearchResultV1): string[] {
  const diagnostics = asRecord(result.diagnostics);
  const queryTrace = asRecord(diagnostics?.queryTrace);
  if (!queryTrace) return [];
  const stages = Array.isArray(queryTrace.stages) ? queryTrace.stages : [];
  const stageRecords = stages
    .map((stage) => asRecord(stage))
    .filter((stage): stage is Record<string, unknown> => Boolean(stage));
  const stageSummary = stages
    .map((stage) => asRecord(stage))
    .filter((stage): stage is Record<string, unknown> => Boolean(stage))
    .map((stage) => `${asString(stage.name, 'stage')}: ${asString(stage.state, 'unknown')}`);
  const indexDbStage = stageRecords.find((stage) => asString(stage.name) === 'index_db');
  const indexDbFacts = asRecord(indexDbStage?.facts);
  const indexDbResultUsage = asRecord(indexDbFacts?.resultUsage);
  const indexDbPrimaryPathGate = asRecord(indexDbFacts?.primaryPathGate);
  const indexDbReasons = asStringArray(indexDbFacts?.readinessReasons);
  const hasIndexDbReadinessGates = Boolean(indexDbFacts) &&
    ['schemaReady', 'migrationReady', 'writeReady', 'searchReady', 'evidencePromotionReady'].some((key) =>
      typeof indexDbFacts?.[key] === 'boolean'
    );
  const indexDbReadinessGates = hasIndexDbReadinessGates
    ? `Index DB readiness gates: schema=${Boolean(indexDbFacts?.schemaReady)} migration=${Boolean(indexDbFacts?.migrationReady)} write=${Boolean(indexDbFacts?.writeReady)} search=${Boolean(indexDbFacts?.searchReady)} evidence=${Boolean(indexDbFacts?.evidencePromotionReady)}`
    : undefined;
  const indexDbPrimaryPath = indexDbPrimaryPathGate
    ? `Index DB active path: ${asString(indexDbPrimaryPathGate.activePath, 'unknown')} mode=${asString(indexDbPrimaryPathGate.mode, 'disabled')} eligible=${String(Boolean(indexDbPrimaryPathGate.eligible))} rollback=${String(Boolean(indexDbPrimaryPathGate.rollbackActive))}`
    : undefined;
  const indexDbPrimaryPathReasons = asStringArray(indexDbPrimaryPathGate?.reasons);
  const indexDbStaleReasons = numberRecordSummary(indexDbFacts?.staleEvidenceReasons);
  const indexDbCurrentScanRows = countLabel(indexDbFacts?.currentScanFtsRowCount);
  const indexDbCurrentScanFiles = countLabel(indexDbFacts?.currentScanFtsFileCount);
  const indexDbCurrentScan = indexDbCurrentScanRows || indexDbCurrentScanFiles
    ? `Index DB current scan: files=${indexDbCurrentScanFiles ?? '0'} rows=${indexDbCurrentScanRows ?? '0'}`
    : undefined;
  const indexDbFreshScanRows = countLabel(indexDbFacts?.freshCurrentScanFtsRowCount);
  const indexDbFreshScanFiles = countLabel(indexDbFacts?.freshCurrentScanFtsFileCount);
  const indexDbFreshScan = indexDbFreshScanRows || indexDbFreshScanFiles
    ? `Index DB fresh scan: files=${indexDbFreshScanFiles ?? '0'} rows=${indexDbFreshScanRows ?? '0'}`
    : undefined;
  const indexDbMetadataBoostedRows = countLabel(indexDbFacts?.metadataBoostedFreshFtsRowCount);
  const indexDbMetadataBoostedFiles = countLabel(indexDbFacts?.metadataBoostedFreshFtsFileCount);
  const indexDbMetadataBoostedFreshScan = indexDbMetadataBoostedRows || indexDbMetadataBoostedFiles
    ? `Index DB metadata boosted fresh scan: files=${indexDbMetadataBoostedFiles ?? '0'} rows=${indexDbMetadataBoostedRows ?? '0'}`
    : undefined;
  const indexDbTitleBoostedRows = countLabel(indexDbFacts?.titleBoostedFreshFtsRowCount);
  const indexDbTitleBoostedFiles = countLabel(indexDbFacts?.titleBoostedFreshFtsFileCount);
  const indexDbLocationBoostedRows = countLabel(indexDbFacts?.locationBoostedFreshFtsRowCount);
  const indexDbLocationBoostedFiles = countLabel(indexDbFacts?.locationBoostedFreshFtsFileCount);
  const indexDbMetadataBoostSplit = indexDbTitleBoostedRows ||
    indexDbTitleBoostedFiles ||
    indexDbLocationBoostedRows ||
    indexDbLocationBoostedFiles
    ? `Index DB metadata boost split: titleFiles=${indexDbTitleBoostedFiles ?? '0'} titleRows=${indexDbTitleBoostedRows ?? '0'} locationFiles=${indexDbLocationBoostedFiles ?? '0'} locationRows=${indexDbLocationBoostedRows ?? '0'}`
    : undefined;
  const indexDbStaleCurrentScanRows = countLabel(indexDbFacts?.staleCurrentScanFtsRowCount);
  const indexDbStaleCurrentScanFiles = countLabel(indexDbFacts?.staleCurrentScanFtsFileCount);
  const indexDbStaleCurrentScan = indexDbStaleCurrentScanRows || indexDbStaleCurrentScanFiles
    ? `Index DB stale current scan: files=${indexDbStaleCurrentScanFiles ?? '0'} rows=${indexDbStaleCurrentScanRows ?? '0'}`
    : undefined;
  const indexDbOutsideScanRows = countLabel(indexDbFacts?.outsideCurrentScanFtsRowCount);
  const indexDbOutsideScanFiles = countLabel(indexDbFacts?.outsideCurrentScanFtsFileCount);
  const indexDbOutsideScan = indexDbOutsideScanRows || indexDbOutsideScanFiles
    ? `Index DB outside scan: files=${indexDbOutsideScanFiles ?? '0'} rows=${indexDbOutsideScanRows ?? '0'}`
    : undefined;
  const indexDbSearchMaxRows = countLabel(indexDbFacts?.searchMaxRows);
  const indexDbSearchDroppedRows = countLabel(indexDbFacts?.searchDroppedRowCount);
  const indexDbSearchLimit = indexDbFacts?.searchTruncated
    ? `Index DB result limit reached: max=${indexDbSearchMaxRows ?? 'unknown'} dropped=${indexDbSearchDroppedRows ?? '0'}`
    : undefined;
  const indexDbCandidateScoreTotal = countLabel(indexDbResultUsage?.candidateScoreTotal);
  const indexDbReturnedScoreTotal = countLabel(indexDbResultUsage?.returnedScoreTotal);
  const indexDbMaxCandidateScore = countLabel(indexDbResultUsage?.maxCandidateScore);
  const indexDbMaxReturnedScore = countLabel(indexDbResultUsage?.maxReturnedScore);
  const indexDbNonReturnedScoreTotal = countLabel(indexDbResultUsage?.nonReturnedScoreTotal);
  const indexDbCandidateUncappedScoreTotal = countLabel(indexDbResultUsage?.candidateUncappedScoreTotal);
  const indexDbReturnedUncappedScoreTotal = countLabel(indexDbResultUsage?.returnedUncappedScoreTotal);
  const indexDbCandidateScoreCapLossTotal = countLabel(indexDbResultUsage?.candidateScoreCapLossTotal);
  const indexDbReturnedScoreCapLossTotal = countLabel(indexDbResultUsage?.returnedScoreCapLossTotal);
  const indexDbScoreTotals = indexDbCandidateScoreTotal ||
    indexDbReturnedScoreTotal ||
    indexDbMaxCandidateScore ||
    indexDbMaxReturnedScore ||
    indexDbNonReturnedScoreTotal
    ? `Index DB score totals: candidates=${indexDbCandidateScoreTotal ?? '0'} results=${indexDbReturnedScoreTotal ?? '0'} nonReturned=${indexDbNonReturnedScoreTotal ?? '0'} maxCandidate=${indexDbMaxCandidateScore ?? '0'} maxResult=${indexDbMaxReturnedScore ?? '0'}`
    : undefined;
  const hasIndexDbScoreCap = [
    indexDbResultUsage?.scoreCappedCandidateCount,
    indexDbResultUsage?.scoreCappedResultCount,
    indexDbResultUsage?.candidateScoreCapLossTotal,
    indexDbResultUsage?.returnedScoreCapLossTotal,
  ].some((value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0;
  });
  const indexDbScoreCap = hasIndexDbScoreCap
    ? `Index DB score cap: cappedCandidates=${countLabel(indexDbResultUsage?.scoreCappedCandidateCount) ?? '0'} cappedResults=${countLabel(indexDbResultUsage?.scoreCappedResultCount) ?? '0'} candidateUncapped=${indexDbCandidateUncappedScoreTotal ?? '0'} resultUncapped=${indexDbReturnedUncappedScoreTotal ?? '0'} candidateLoss=${indexDbCandidateScoreCapLossTotal ?? '0'} resultLoss=${indexDbReturnedScoreCapLossTotal ?? '0'}`
    : undefined;
  const recentHealthEvents = Array.isArray(indexDbFacts?.recentHealthEvents) ? indexDbFacts.recentHealthEvents : [];
  const recentHealthEventLabels = recentHealthEvents
    .map((item) => {
      const event = asRecord(item);
      if (!event) return undefined;
      const label = compactUnique([
        asString(event.kind),
        asString(event.action),
        asString(event.status),
      ]).join(':');
      return label || undefined;
    })
    .filter((label): label is string => Boolean(label));
  const indexDbRecentHealth = recentHealthEventLabels.length
    ? `Index DB recent health: ${recentHealthEventLabels.join(', ')}`
    : undefined;
  const indexDbWriteErrors = countLabel(indexDbFacts?.writeErrorCount);
  const indexDbSearchErrors = countLabel(indexDbFacts?.searchErrorCount);
  const indexDbErrorSummary = indexDbWriteErrors || indexDbSearchErrors
    ? `Index DB errors: write=${indexDbWriteErrors ?? '0'} search=${indexDbSearchErrors ?? '0'}`
    : undefined;
  return compactUnique([
    asString(queryTrace.traceId) ? `Query Trace: ${asString(queryTrace.traceId)}` : undefined,
    asString(queryTrace.plannerOwner) ? `Planner: ${asString(queryTrace.plannerOwner)}` : undefined,
    asString(queryTrace.copilotRole) ? `Copilot: ${asString(queryTrace.copilotRole)}` : undefined,
    asString(queryTrace.progressStage) ? `Stage: ${asString(queryTrace.progressStage)}` : undefined,
    ...stageSummary,
    asString(indexDbFacts?.readinessStatus) ? `Index DB: ${asString(indexDbFacts?.readinessStatus)}` : undefined,
    asString(indexDbFacts?.backend) ? `Index DB backend: ${asString(indexDbFacts?.backend)}` : undefined,
    countLabel(indexDbFacts?.schemaRevision) ? `Index DB schema: ${countLabel(indexDbFacts?.schemaRevision)}` : undefined,
    indexDbReasons.length ? `Index DB reasons: ${indexDbReasons.join(', ')}` : undefined,
    indexDbReadinessGates,
    indexDbPrimaryPath,
    indexDbPrimaryPathReasons.length ? `Index DB primary gate reasons: ${indexDbPrimaryPathReasons.join(', ')}` : undefined,
    countLabel(indexDbResultUsage?.searchMatchedFileCount)
      ? `Index DB matched files: ${countLabel(indexDbResultUsage?.searchMatchedFileCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.currentScanMatchedFileCount)
      ? `Index DB current matched files: ${countLabel(indexDbResultUsage?.currentScanMatchedFileCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.freshCurrentScanMatchedFileCount)
      ? `Index DB fresh matched files: ${countLabel(indexDbResultUsage?.freshCurrentScanMatchedFileCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.staleCurrentScanMatchedFileCount)
      ? `Index DB stale current matched files: ${countLabel(indexDbResultUsage?.staleCurrentScanMatchedFileCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.outsideCurrentScanMatchedFileCount)
      ? `Index DB outside matched files: ${countLabel(indexDbResultUsage?.outsideCurrentScanMatchedFileCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.scoredCandidateCount)
      ? `Index DB scored candidates: ${countLabel(indexDbResultUsage?.scoredCandidateCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.scoredResultCount)
      ? `Index DB scored results: ${countLabel(indexDbResultUsage?.scoredResultCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.nonReturnedScoredCandidateCount)
      ? `Index DB non-returned scored candidates: ${countLabel(indexDbResultUsage?.nonReturnedScoredCandidateCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.promotedCandidateCount)
      ? `Index DB promoted candidates: ${countLabel(indexDbResultUsage?.promotedCandidateCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.promotedResultCount)
      ? `Index DB promoted results: ${countLabel(indexDbResultUsage?.promotedResultCount)}`
      : undefined,
    countLabel(indexDbResultUsage?.nonReturnedPromotedCandidateCount)
      ? `Index DB non-returned promoted candidates: ${countLabel(indexDbResultUsage?.nonReturnedPromotedCandidateCount)}`
      : undefined,
    indexDbScoreTotals,
    indexDbScoreCap,
    countLabel(indexDbFacts?.staleEvidenceRowCount)
      ? `Index DB stale rows: ${countLabel(indexDbFacts?.staleEvidenceRowCount)}`
      : undefined,
    indexDbStaleReasons.length ? `Index DB stale row reasons: ${indexDbStaleReasons.join(', ')}` : undefined,
    indexDbCurrentScan,
    indexDbFreshScan,
    indexDbMetadataBoostedFreshScan,
    indexDbMetadataBoostSplit,
    indexDbStaleCurrentScan,
    indexDbOutsideScan,
    indexDbSearchLimit,
    indexDbRecentHealth,
    indexDbErrorSummary,
  ]);
}

function localDraftCitationLabels(localDraft: Record<string, unknown> | undefined): string[] {
  const citations = Array.isArray(localDraft?.citations) ? localDraft.citations : [];
  return citations
    .map((citation) => asRecord(citation))
    .filter((citation): citation is Record<string, unknown> => Boolean(citation))
    .map((citation) => {
      const id = asString(citation.citation_id);
      const label = asString(citation.label, asString(citation.evidence_id, '根拠'));
      const anchor = asString(citation.anchor_summary);
      return compactUnique([id, label, anchor]).join(' - ');
    })
    .filter(Boolean);
}

function answerSourceLabel(answer: Record<string, unknown> | undefined): string | undefined {
  const source = asString(answer?.source);
  if (source === 'copilot_polish') return 'Copilotで整えた回答';
  if (source === 'local_draft') return 'ローカル下書き';
  return undefined;
}

function answerCitationLabels(answer: Record<string, unknown> | undefined): string[] {
  return asStringArray(answer?.citation_ids).map((citationId) => `引用 ${citationId}`);
}

function answerDetailItems(result: RelayDocumentSearchResultV1): string[] {
  const answer = asRecord(result.answer);
  if (!answer) return [];
  const text = asString(answer.text);
  const sourceLabel = answerSourceLabel(answer);
  const replacement = asRecord(answer.replacement);
  return compactUnique([
    text ? `回答: ${text}` : undefined,
    sourceLabel ? `採用元: ${sourceLabel}` : undefined,
    typeof replacement?.replacementCount === 'number'
      ? `置換回数: ${String(replacement.replacementCount)}`
      : undefined,
    typeof replacement?.canReplaceAgain === 'boolean'
      ? `再置換: ${String(replacement.canReplaceAgain)}`
      : undefined,
    ...answerCitationLabels(answer),
  ]);
}

function localDraftDetailItems(result: RelayDocumentSearchResultV1): string[] {
  const localDraft = asRecord(result.localDraft);
  if (!localDraft) return [];
  const summary = asString(localDraft.summary);
  const citationLabels = localDraftCitationLabels(localDraft);
  const caveats = asStringArray(localDraft.caveats);
  const nextActions = asStringArray(localDraft.next_actions);
  return compactUnique([
    summary ? `下書き: ${summary}` : undefined,
    ...citationLabels.map((label) => `引用: ${label}`),
    ...caveats.map((item) => `注意: ${item}`),
    ...nextActions.map((item) => `次: ${item}`),
  ]);
}

function polishValidationSupportItems(result: RelayDocumentSearchResultV1): string[] {
  const diagnostics = asRecord(result.diagnostics);
  const polishValidation = asRecord(diagnostics?.polishValidation);
  if (!polishValidation) return [];
  const errors = Array.isArray(polishValidation.errors) ? polishValidation.errors : [];
  const warnings = Array.isArray(polishValidation.warnings) ? polishValidation.warnings : [];
  const promptTemplateIds = asRecord(polishValidation.prompt_template_ids);
  const correlation = asRecord(polishValidation.correlation);
  return compactUnique([
    asString(polishValidation.state) ? `Polish: ${asString(polishValidation.state)}` : undefined,
    typeof polishValidation.accepted === 'boolean' ? `Accepted: ${String(polishValidation.accepted)}` : undefined,
    promptTemplateIds?.answerPolish ? `Answer prompt: ${asString(promptTemplateIds.answerPolish)}` : undefined,
    promptTemplateIds?.polishRepair ? `Repair prompt: ${asString(promptTemplateIds.polishRepair)}` : undefined,
    correlation?.relayJobId ? `Relay job: ${asString(correlation.relayJobId)}` : undefined,
    correlation?.aionuiMessageId ? `AionUi message: ${asString(correlation.aionuiMessageId)}` : undefined,
    correlation?.copilotRequestId ? `Copilot request: ${asString(correlation.copilotRequestId)}` : undefined,
    ...errors
      .map((error) => asRecord(error))
      .filter((error): error is Record<string, unknown> => Boolean(error))
      .map((error) => `Error: ${asString(error.code, asString(error.message))}`),
    ...warnings
      .map((warning) => asRecord(warning))
      .filter((warning): warning is Record<string, unknown> => Boolean(warning))
      .map((warning) => `Warning: ${asString(warning.code, asString(warning.message))}`),
  ]);
}

function polishRequestSupportItems(result: RelayDocumentSearchResultV1): string[] {
  const polishRequest = asRecord(result.polishRequest);
  if (!polishRequest) return [];
  return compactUnique([
    asString(polishRequest.status) ? `Polish request: ${asString(polishRequest.status)}` : undefined,
    asString(polishRequest.reason) ? `Reason: ${asString(polishRequest.reason)}` : undefined,
    asString(polishRequest.prompt_template_id) ? `Prompt: ${asString(polishRequest.prompt_template_id)}` : undefined,
    asString(polishRequest.expected_output_schema)
      ? `Expected output: ${asString(polishRequest.expected_output_schema)}`
      : undefined,
    typeof polishRequest.redacted_evidence_count === 'number'
      ? `Redacted evidence: ${String(polishRequest.redacted_evidence_count)}`
      : undefined,
    typeof polishRequest.prompt === 'string'
      ? `Prompt chars: ${String(polishRequest.prompt.length)}`
      : undefined,
  ]);
}

function polishProviderSupportItems(result: RelayDocumentSearchResultV1): string[] {
  const polishProvider = asRecord(result.polishProvider) ?? asRecord(asRecord(result.diagnostics)?.polishProvider);
  if (!polishProvider) return [];
  const warnings = Array.isArray(polishProvider.warnings) ? polishProvider.warnings : [];
  return compactUnique([
    asString(polishProvider.state) ? `Provider polish: ${asString(polishProvider.state)}` : undefined,
    asString(polishProvider.reason) ? `Provider reason: ${asString(polishProvider.reason)}` : undefined,
    asString(polishProvider.provider_kind) ? `Provider kind: ${asString(polishProvider.provider_kind)}` : undefined,
    asString(polishProvider.model) ? `Provider model: ${asString(polishProvider.model)}` : undefined,
    asString(polishProvider.copilot_request_id)
      ? `Provider request: ${asString(polishProvider.copilot_request_id)}`
      : undefined,
    typeof polishProvider.candidate_received === 'boolean'
      ? `Provider candidate: ${String(polishProvider.candidate_received)}`
      : undefined,
    typeof polishProvider.elapsed_ms === 'number' ? `Provider elapsed ms: ${String(polishProvider.elapsed_ms)}` : undefined,
    typeof polishProvider.response_character_count === 'number'
      ? `Provider response chars: ${String(polishProvider.response_character_count)}`
      : undefined,
    ...warnings
      .map((warning) => asRecord(warning))
      .filter((warning): warning is Record<string, unknown> => Boolean(warning))
      .map((warning) => `Provider warning: ${asString(warning.code, asString(warning.message))}`),
  ]);
}

function copilotStateSupportItems(result: RelayDocumentSearchResultV1): string[] {
  const diagnostics = asRecord(result.diagnostics);
  const copilotState = asRecord(diagnostics?.copilotState);
  if (!copilotState) return [];
  const warnings = Array.isArray(copilotState.warnings) ? copilotState.warnings : [];
  return compactUnique([
    asString(copilotState.state) ? `Copilot: ${asString(copilotState.state)}` : undefined,
    asString(copilotState.beginner_label) ? `Label: ${asString(copilotState.beginner_label)}` : undefined,
    typeof copilotState.local_search_blocked === 'boolean'
      ? `Blocks local results: ${String(copilotState.local_search_blocked)}`
      : undefined,
    typeof copilotState.should_wait_for_copilot === 'boolean'
      ? `Waits for Copilot: ${String(copilotState.should_wait_for_copilot)}`
      : undefined,
    typeof copilotState.optional_polish_retry_available === 'boolean'
      ? `Polish retry: ${String(copilotState.optional_polish_retry_available)}`
      : undefined,
    ...warnings
      .map((warning) => asRecord(warning))
      .filter((warning): warning is Record<string, unknown> => Boolean(warning))
      .map((warning) => `Warning: ${asString(warning.code, asString(warning.message))}`),
  ]);
}

function searchModeLabel(mode: string | undefined): string | undefined {
  switch (mode) {
    case 'filename':
      return 'ファイル名';
    case 'keyword':
      return '本文キーワード';
    case 'hybrid':
      return 'ハイブリッド';
    case 'evidence':
      return '根拠確認';
    case 'answer':
      return '回答用';
    default:
      return mode;
  }
}

function contentStrategyLabel(strategy: string | undefined): string | undefined {
  switch (strategy) {
    case 'candidate_first':
      return '候補優先';
    case 'content_required':
      return '本文確認';
    case 'answer_required':
      return '回答根拠';
    default:
      return strategy;
  }
}

function searchModeDetailItems(result: RelayDocumentSearchResultV1): string[] {
  const queryPlan = asRecord(result.queryPlan);
  if (!queryPlan) return [];
  const terms = asStringArray(queryPlan.normalizedTerms).slice(0, 12);
  const fileTypes = asStringArray(queryPlan.fileTypeHints).slice(0, 8);
  return compactUnique([
    searchModeLabel(asString(queryPlan.mode))
      ? `検索モード: ${searchModeLabel(asString(queryPlan.mode))}`
      : undefined,
    contentStrategyLabel(asString(queryPlan.contentStrategy))
      ? `確認方法: ${contentStrategyLabel(asString(queryPlan.contentStrategy))}`
      : undefined,
    asString(queryPlan.searchModeReason) ? `理由: ${asString(queryPlan.searchModeReason)}` : undefined,
    asString(queryPlan.confirmationPolicy) ? `根拠ポリシー: ${asString(queryPlan.confirmationPolicy)}` : undefined,
    terms.length ? `検索語: ${terms.join(', ')}` : undefined,
    fileTypes.length ? `ファイル種別ヒント: ${fileTypes.join(', ')}` : undefined,
    asString(queryPlan.copilotHintSummary) ? `Copilot展開: ${asString(queryPlan.copilotHintSummary)}` : undefined,
  ]);
}

function scanBudgetStrategyLabel(strategy: string): string {
  switch (strategy) {
    case 'latest_first':
      return '新しい期を厚めに確認';
    case 'historical_examples':
      return '過去事例も厚めに確認';
    case 'explicit_period':
      return '指定された期を優先';
    case 'balanced':
      return '各期をバランス確認';
    case 'single_root_fallback':
      return '単一フォルダを順次確認';
    default:
      return strategy || '検索配分を確認中';
  }
}

function scanBudgetFolderRoleLabel(role: string): string {
  switch (role) {
    case 'explicit':
      return '指定期';
    case 'latest':
      return '最新期';
    case 'recent':
      return '近近期';
    case 'historical':
      return '過去期';
    default:
      return 'その他';
  }
}

function searchBudgetDetailItems(result: RelayDocumentSearchResultV1): string[] {
  const diagnostics = asRecord(result.diagnostics);
  const searchBudget = asRecord(diagnostics?.searchBudget);
  const reports = Array.isArray(searchBudget?.reports) ? searchBudget.reports : [];
  const reportRecords = reports
    .map((report) => asRecord(report))
    .filter((report): report is Record<string, unknown> => Boolean(report));
  if (!reportRecords.length) return [];

  const items: string[] = [];
  for (const report of reportRecords.slice(0, 3)) {
    const strategy = asString(report.strategy);
    const timeScopeReason = asString(report.timeScopeReason);
    const maxScanFiles = countLabel(report.maxScanFiles);
    const folderCount = countLabel(report.folderCount);
    const minimumGuarantee = countLabel(report.minimumGuaranteePerFolder);
    const truncatedFolderCount = countLabel(report.budgetTruncatedFolderCount);
    items.push(
      compactUnique([
        `配分: ${scanBudgetStrategyLabel(strategy)}`,
        timeScopeReason ? `理由: ${timeScopeReason}` : undefined,
        maxScanFiles ? `上限: ${maxScanFiles}件` : undefined,
        folderCount ? `対象フォルダ: ${folderCount}件` : undefined,
        minimumGuarantee ? `最低保証: ${minimumGuarantee}件/フォルダ` : undefined,
        truncatedFolderCount ? `未完了フォルダ: ${truncatedFolderCount}件` : undefined,
      ]).join('、'),
    );

    const folders = Array.isArray(report.folders) ? report.folders : [];
    for (const folder of folders
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .slice(0, 12)) {
      const displayPath = asString(folder.displayPath, asString(folder.path, 'フォルダ'));
      const allocated = countLabel(folder.allocatedFiles) ?? '0';
      const scanned = countLabel(folder.scannedFiles) ?? '0';
      const skipped = countLabel(folder.skippedFiles);
      const role = scanBudgetFolderRoleLabel(asString(folder.role));
      const truncated = Boolean(folder.truncated);
      items.push(compactUnique([
        `${displayPath}: ${scanned}/${allocated}件確認`,
        role,
        skipped && skipped !== '0' ? `${skipped}件スキップ` : undefined,
        truncated ? '未完了' : undefined,
      ]).join('、'));
    }
  }
  return compactUnique(items);
}

function buildDetailSections(result: RelayDocumentSearchResultV1): RelayDocumentSearchDisplayDetailSection[] {
  const candidates = result.results.filter((candidate): candidate is Record<string, unknown> =>
    Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
  );
  const evidenceLocationItems = compactUnique(candidates.flatMap((candidate) => {
    const title = asString(candidate.display_name, asString(candidate.path, '候補'));
    const anchors = Array.isArray(candidate.anchors) ? candidate.anchors : [];
    return anchors
      .map((anchor) => asRecord(anchor))
      .filter((anchor): anchor is Record<string, unknown> => Boolean(anchor))
      .map((anchor) => {
        const label = anchorLocationLabel(anchor);
        return label ? `${title}: ${label}` : undefined;
      });
  }));
  const structuredItems = compactUnique(candidates.flatMap((candidate) => {
    const title = asString(candidate.display_name, asString(candidate.path, '候補'));
    const anchors = Array.isArray(candidate.anchors) ? candidate.anchors : [];
    return anchors
      .map((anchor) => asRecord(anchor))
      .filter((anchor): anchor is Record<string, unknown> => Boolean(anchor && anchorIsStructured(anchor)))
      .map((anchor) => {
        const label = anchorLocationLabel(anchor);
        return label ? `${title}: ${label}` : undefined;
      });
  }));
  const sourceItems = compactUnique(candidates.map((candidate) => {
    const title = asString(candidate.display_name, asString(candidate.path, '候補'));
    const labels = sourceLabels(candidate);
    return labels.length ? `${title}: ${labels.join(' / ')}` : undefined;
  }));
  const candidateBucketItems = candidateBucketDetailItems(candidates);
  const candidateFamilyItems = candidateFamilyDetailItems(candidates);
  const scoreItems = compactUnique(candidates.map((candidate) => {
    const title = asString(candidate.display_name, asString(candidate.path, '候補'));
    const labels = scoreBreakdownLabels(candidate);
    return labels.length ? `${title}: ${labels.join(' / ')}` : undefined;
  }));
  const warningItems = compactUnique([
    ...candidates.flatMap((candidate) => asStringArray(candidate.warnings).map(warningLabel)),
    ...(
      Array.isArray(result.evidencePack?.warnings)
        ? result.evidencePack.warnings
          .map((warning) => asRecord(warning))
          .map((warning) => warningLabel(asString(warning?.code, asString(warning?.message))))
        : []
    ),
  ]);
  const attachmentItems = warningItems.filter((item) => /添付/u.test(item));
  const localDraftItems = localDraftDetailItems(result);
  const answerItems = answerDetailItems(result);
  const polishRequestItems = polishRequestSupportItems(result);
  const polishProviderItems = polishProviderSupportItems(result);
  const polishItems = polishValidationSupportItems(result);
  const copilotStateItems = copilotStateSupportItems(result);
  const supportItems = queryTraceSupportItems(result);
  const searchModeItems = searchModeDetailItems(result);
  const searchBudgetItems = searchBudgetDetailItems(result);
  const indexStatus = indexStatusDisplay(result);
  const indexStatusItems = compactUnique([
    `状態: ${indexStatus.label}`,
    `検索経路: ${indexStatus.activePathLabel}`,
    indexStatus.message,
    ...indexStatus.reasons.map((reason) => `理由: ${reason}`),
    ...indexStatus.actions.map((action) => `操作: ${action.label}`),
  ]);

  return [
    answerItems.length
      ? {
          level: 'details' as const,
          title: '回答',
          items: answerItems,
          initiallyCollapsed: false,
        }
      : undefined,
    localDraftItems.length
      ? {
          level: 'details' as const,
          title: '回答下書き',
          items: localDraftItems,
          initiallyCollapsed: true,
        }
      : undefined,
    searchModeItems.length
      ? {
          level: 'details' as const,
          title: '検索モード',
          items: searchModeItems,
          initiallyCollapsed: false,
        }
      : undefined,
    searchBudgetItems.length
      ? {
          level: 'details' as const,
          title: '検索配分',
          items: searchBudgetItems,
          initiallyCollapsed: false,
        }
      : undefined,
    candidateBucketItems.length
      ? {
          level: 'details' as const,
          title: '候補の分類',
          items: candidateBucketItems,
          initiallyCollapsed: false,
        }
      : undefined,
    candidateFamilyItems.length
      ? {
          level: 'details' as const,
          title: '版違い・類似候補',
          items: candidateFamilyItems,
          initiallyCollapsed: true,
        }
      : undefined,
    evidenceLocationItems.length
      ? {
          level: 'details' as const,
          title: '根拠の場所',
          items: evidenceLocationItems,
          initiallyCollapsed: true,
        }
      : undefined,
    structuredItems.length
      ? {
          level: 'details' as const,
          title: '構造・表の情報',
          items: structuredItems,
          initiallyCollapsed: true,
        }
      : undefined,
    sourceItems.length
      ? {
          level: 'details' as const,
          title: '検索経路',
          items: sourceItems,
          initiallyCollapsed: true,
        }
      : undefined,
    scoreItems.length
      ? {
          level: 'details' as const,
          title: '関連度内訳',
          items: scoreItems,
          initiallyCollapsed: true,
        }
      : undefined,
    indexStatusItems.length
      ? {
          level: 'details' as const,
          title: '索引状態',
          items: indexStatusItems,
          initiallyCollapsed: indexStatus.state === 'ready',
        }
      : undefined,
    attachmentItems.length
      ? {
          level: 'details' as const,
          title: '添付ファイル',
          items: attachmentItems,
          initiallyCollapsed: true,
        }
      : undefined,
    warningItems.length
      ? {
          level: 'details' as const,
          title: '確認が必要な点',
          items: warningItems,
          initiallyCollapsed: true,
        }
      : undefined,
    (polishRequestItems.length || polishProviderItems.length || polishItems.length)
      ? {
          level: 'support' as const,
          title: 'AI文章チェック',
          items: [...polishRequestItems, ...polishProviderItems, ...polishItems],
          initiallyCollapsed: true,
          supportOnly: true,
        }
      : undefined,
    copilotStateItems.length
      ? {
          level: 'support' as const,
          title: 'Copilot状態',
          items: copilotStateItems,
          initiallyCollapsed: true,
          supportOnly: true,
        }
      : undefined,
    supportItems.length
      ? {
          level: 'support' as const,
          title: 'サポート用の実行記録',
          items: supportItems,
          initiallyCollapsed: true,
          supportOnly: true,
        }
      : undefined,
  ].filter((section): section is RelayDocumentSearchDisplayDetailSection => Boolean(section));
}

function detailLevels(): RelayDocumentSearchDisplayV1['detailLevels'] {
  return [
    { level: 'overview', label: '標準', visibleByDefault: true },
    { level: 'details', label: '詳細', visibleByDefault: false },
    { level: 'support', label: 'サポート', visibleByDefault: false },
  ];
}

function normalizedLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 20, 100));
}

function normalizedOffset(value: number | undefined, totalResults: number): number {
  if (!Number.isFinite(value ?? 0)) return 0;
  const offset = Math.floor(value ?? 0);
  return Math.max(0, Math.min(offset, Math.max(0, totalResults)));
}

function displaySelectionState(
  result: RelayDocumentSearchResultV1,
  visibleCandidates: Record<string, unknown>[],
  selectedStableSelectionKey?: string,
): RelayDocumentSearchDisplaySelectionState {
  const allCandidates = result.results.filter((candidate): candidate is Record<string, unknown> =>
    Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
  );
  const allStableSelectionKeys = compactUnique(allCandidates.map(stableSelectionKeyForCandidate));
  const visibleStableSelectionKeys = compactUnique(visibleCandidates.map(stableSelectionKeyForCandidate));
  const selectedKey = asString(selectedStableSelectionKey);
  const selectedIndex = selectedKey
    ? allCandidates.findIndex((candidate) => stableSelectionKeyForCandidate(candidate) === selectedKey)
    : -1;
  const selectedCandidate = selectedIndex >= 0 ? allCandidates[selectedIndex] : undefined;
  return {
    strategy: 'stableSelectionKey',
    ...(selectedKey ? { selectedStableSelectionKey: selectedKey } : {}),
    ...(selectedCandidate ? { selectedResultId: asString(selectedCandidate.result_id) } : {}),
    ...(selectedIndex >= 0 ? { selectedPosition: selectedIndex + 1 } : {}),
    selectedVisible: Boolean(selectedKey && visibleStableSelectionKeys.includes(selectedKey)),
    selectedAvailable: selectedIndex >= 0,
    visibleStableSelectionKeys,
    allStableSelectionKeys,
  };
}

function resultFlow(
  params: {
    totalResults: number;
    offset: number;
    limit: number;
    shownResults: number;
    hasMore: boolean;
    nextOffset?: number;
    continuationAction?: RelayDocumentSearchDisplayV1['continuationAction'];
    refineActions: string[];
    selection: RelayDocumentSearchDisplaySelectionState;
    partialResultExplanations: string[];
    indexStatus: RelayDocumentSearchIndexStatusDisplay;
    hasAnswerSummary: boolean;
    hasLocalDraftSummary: boolean;
  },
): RelayDocumentSearchResultFlowV1 {
  const shownStart = params.shownResults > 0 ? params.offset + 1 : 0;
  const shownEnd = params.offset + params.shownResults;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT,
    owner: 'aionui',
    rendererPolicy: 'structured-result-cards-primary',
    structuredResultCardsPrimary: true,
    copilotProseSecondary: true,
    batch: {
      strategy: 'capped-batches',
      offset: params.offset,
      limit: params.limit,
      shownStart,
      shownEnd,
      shownResults: params.shownResults,
      totalResults: params.totalResults,
      hasMore: params.hasMore,
      ...(params.nextOffset !== undefined ? { nextOffset: params.nextOffset } : {}),
    },
    continuationAction: params.continuationAction
      ? {
          ...params.continuationAction,
          ...(params.selection.selectedStableSelectionKey
            ? { preserveSelectionKey: params.selection.selectedStableSelectionKey }
            : {}),
        }
      : undefined,
    refineActions: params.refineActions,
    selection: params.selection,
    partialResultExplanations: params.partialResultExplanations,
    indexStatus: params.indexStatus,
    copilotProse: {
      role: 'secondary',
      summaryField: params.hasAnswerSummary ? 'answerSummary' : 'summary',
      ...(params.hasLocalDraftSummary ? { localDraftField: 'localDraftSummary' } : {}),
    },
  };
}

export function relayDocumentSearchResultToDisplayModel(
  input: unknown,
  options: RelayDocumentSearchDisplayOptions = {},
): RelayDocumentSearchDisplayV1 {
  const validated = validateRelayDocumentSearchResult(input);
  if (!validated.ok) {
    const indexStatus: RelayDocumentSearchIndexStatusDisplay = {
      state: 'unknown',
      label: '索引状態を確認中',
      activePathLabel: '検索経路を確認中',
      message: '検索結果の形式を確認できませんでした。',
      reasons: [],
      actions: [],
    };
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
      sourceSchemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
      resultFlow: resultFlow({
        totalResults: 0,
        offset: 0,
        limit: normalizedLimit(options.maxCards),
        shownResults: 0,
        hasMore: false,
        refineActions: [],
        selection: {
          strategy: 'stableSelectionKey',
          selectedVisible: false,
          selectedAvailable: false,
          visibleStableSelectionKeys: [],
          allStableSelectionKeys: [],
        },
        partialResultExplanations: ['検索結果の形式を確認できませんでした。'],
        indexStatus,
        hasAnswerSummary: false,
        hasLocalDraftSummary: false,
      }),
      status: 'failed',
      statusLabel: statusLabel('failed'),
      summary: '検索結果を表示できませんでした。',
      indexStatus,
      partialResultExplanations: ['検索結果の形式を確認できませんでした。'],
      repairActions: [],
      cards: [],
      hasMore: false,
      coverageLabel: '検索結果の形式を確認できませんでした。',
      emptyStateGuidance: ['時間をおいてもう一度試してください。'],
      refineActions: [],
      totalResults: 0,
      shownResults: 0,
      detailLevels: detailLevels(),
      detailSections: [],
      supportDetailsAvailable: true,
    };
  }

  const result = validated.value;
  const maxCards = normalizedLimit(options.maxCards);
  const offset = normalizedOffset(options.offset, result.results.length);
  const visibleCandidates = result.results
    .slice(offset, offset + maxCards)
    .filter((candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
    );
  const cards = visibleCandidates.map((candidate, index) =>
    cardFromResult(candidate, offset + index + 1, options.selectedStableSelectionKey),
  );
  const display = result.display ?? { beginnerSummary: '' };
  const localDraft = asRecord(result.localDraft);
  const answer = asRecord(result.answer);
  const nextOffset = offset + cards.length;
  const hasMore = result.results.length > nextOffset;
  const indexStatus = indexStatusDisplay(result);
  const partialExplanations = partialResultExplanations(result, indexStatus);
  const refineActions = asStringArray(display.refineActions);
  const selection = displaySelectionState(result, visibleCandidates, options.selectedStableSelectionKey);
  const continuationAction = hasMore
    ? { kind: 'show-more-results' as const, label: 'さらに表示', nextOffset }
    : undefined;
  const detailSections = buildDetailSections(result);
  const answerSummary = asString(answer?.text) || undefined;
  const localDraftSummary = asString(localDraft?.summary) || undefined;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
    sourceSchemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    resultFlow: resultFlow({
      totalResults: result.results.length,
      offset,
      limit: maxCards,
      shownResults: cards.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : undefined,
      continuationAction,
      refineActions,
      selection,
      partialResultExplanations: partialExplanations,
      indexStatus,
      hasAnswerSummary: Boolean(answerSummary),
      hasLocalDraftSummary: Boolean(localDraftSummary),
    }),
    status: result.status,
    statusLabel: statusLabel(result.status),
    summary: asString(display.beginnerSummary, statusLabel(result.status)),
    answerSummary,
    answerSourceLabel: answerSourceLabel(answer),
    answerCitationLabels: answerCitationLabels(answer),
    localDraftSummary,
    localDraftCitationLabels: localDraftCitationLabels(localDraft),
    indexStatus,
    partialResultExplanations: partialExplanations,
    repairActions: indexStatus.actions,
    cards,
    hasMore,
    coverageLabel: coverageLabel(result),
    emptyStateGuidance: asStringArray(display.emptyStateGuidance),
    refineActions,
    totalResults: result.results.length,
    shownResults: cards.length,
    nextOffset: hasMore ? nextOffset : undefined,
    continuationAction,
    detailLevels: detailLevels(),
    detailSections,
    supportDetailsAvailable: true,
  };
}
