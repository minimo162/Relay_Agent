/**
 * Deterministic query planning for Relay Document Search.
 *
 * Copilot may suggest wording, but Relay owns the final query plan used by the
 * executor. This module is intentionally filesystem-free: it normalizes the
 * user's request into terms, hints, and confirmation policy without scanning or
 * parsing documents.
 */

import type {
  RelayDocumentSearchRequestV1,
  RelayDocumentSearchTimeScopeIntent,
} from './relayDocumentSearchContract';

export const RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT = 'RelayDocumentSearchQueryPlan.v1' as const;
export const RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION = 'relay-query-normalizer-v1' as const;

export type RelayDocumentSearchQueryPlanV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT;
  normalizerVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION;
  mode: 'filename' | 'keyword' | 'hybrid' | 'evidence' | 'answer';
  searchModeReason: string;
  contentStrategy: 'candidate_first' | 'content_required' | 'answer_required';
  query: string;
  roots: string[];
  normalizedTerms: string[];
  synonymExpansions: Array<{ source: string; terms: string[] }>;
  copilotHintSummary?: string;
  periodHints: string[];
  fileTypeHints: string[];
  rejectedTokens: Array<{ token: string; reason: string }>;
  ignoredIntentTerms: string[];
  excludedTerms: string[];
  demoteTerms: string[];
  recencyPreference: 'neutral' | 'prefer_recent' | 'prefer_older';
  timeScopeIntent: RelayDocumentSearchTimeScopeIntent;
  timeScopeReason: string;
  confirmationPolicy: 'candidate_ok' | 'content_required';
};

const ACCOUNTING_SYNONYMS: Array<{ pattern: RegExp; source: string; terms: string[] }> = [
  {
    pattern: /キャッシュ\s*[-・]?\s*フロー|cash\s*flow|c\s*\/\s*f|\bcfs?\b/iu,
    source: 'cash_flow',
    terms: ['キャッシュフロー', 'キャッシュフロー計算書', 'cf', 'cfs', 'c f', '連結cf', '連結cfs'],
  },
  {
    pattern: /精算|adjust(?:ment)?|adj/iu,
    source: 'adjustment',
    terms: ['精算表', 'adj', 'adjustment'],
  },
  {
    pattern: /連結|consolidat/iu,
    source: 'consolidated',
    terms: ['連結', 'consolidated'],
  },
  {
    pattern: /\bbs\b|貸借対照表|balance\s*sheet/iu,
    source: 'balance_sheet',
    terms: ['bs', '貸借対照表', 'balance sheet'],
  },
  {
    pattern: /\bpl\b|損益計算書|profit\s*(?:and|&)?\s*loss/iu,
    source: 'profit_loss',
    terms: ['pl', '損益計算書', 'profit loss'],
  },
  {
    pattern: /部品\s*売上|パーツ\s*売上|部販|補修部品|parts?\s*sales?/iu,
    source: 'parts_sales',
    terms: [
      '部品売上',
      '部品他売上',
      'パーツ売上',
      '部販',
      'パーツ',
      '補修部品',
      '販社 パーツ',
      'parts sales',
    ],
  },
];

const FILE_TYPE_HINTS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\.xlsx\b|エクセル|excel|workbook|ブック|シート/iu, type: 'xlsx' },
  { pattern: /\.xlsm\b|マクロ/iu, type: 'xlsm' },
  { pattern: /\.docx\b|word|ワード/iu, type: 'docx' },
  { pattern: /\.pptx\b|power\s*point|パワーポイント/iu, type: 'pptx' },
  { pattern: /\.pdf\b|pdf/iu, type: 'pdf' },
  { pattern: /\.csv\b|csv/iu, type: 'csv' },
  { pattern: /\.md\b|markdown|マークダウン/iu, type: 'md' },
  { pattern: /\.txt\b|テキスト|text/iu, type: 'txt' },
];

const INTENT_WORD_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /このフォルダ|当フォルダ|対象フォルダ|指定フォルダ|フォルダ|folder/giu, label: 'folder_reference' },
  { pattern: /配下|以下|直下|中から|から/giu, label: 'scope_instruction' },
  { pattern: /ファイル|資料|文書|ドキュメント|document|file/giu, label: 'document_noun' },
  { pattern: /探して|探す|検索して|検索|見つけて|見つける|抽出して|抽出|列挙して|一覧|に関する|に関連する|に係る|について|関係する|関連する|関係ありそうな|関連しそうな/giu, label: 'search_instruction' },
  { pattern: /ください|下さい|お願い|して|する|ほしい|欲しい/giu, label: 'polite_or_auxiliary' },
];

const GENERIC_STOP_TERMS = new Set([
  'この',
  'その',
  'あの',
  'ここ',
  'そこ',
  'どこ',
  'もの',
  'こと',
  'ため',
  '対象',
  '候補',
  'ファイル',
  '資料',
  '文書',
  'ドキュメント',
  'フォルダ',
  'folder',
  'file',
  'files',
  'document',
  'documents',
  'search',
  'find',
]);

const EXCLUSION_HINTS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /(?:バックアップ|backup|bak|old|archive|履歴|過去|旧)(?:を)?(?:除外|外して|抜いて|以外|なし|不要|含めない)|(?:除外|外して|抜いて|以外|なし|不要|含めない).{0,8}(?:バックアップ|backup|bak|old|archive|履歴|過去|旧)/iu,
    terms: ['バックアップ', 'backup', 'bak', 'old', 'archive', '履歴', '過去', '旧'],
  },
  {
    pattern: /(?:ファイリング|filing|xsa|開示|disclosure)(?:を)?(?:除外|外して|抜いて|以外|なし|不要|含めない)|(?:除外|外して|抜いて|以外|なし|不要|含めない).{0,8}(?:ファイリング|filing|xsa|開示|disclosure)/iu,
    terms: ['ファイリング', 'filing', 'xsa', '開示', 'disclosure'],
  },
  {
    pattern: /(?:出力|output|提出|submit)(?:を)?(?:除外|外して|抜いて|以外|なし|不要|含めない)|(?:除外|外して|抜いて|以外|なし|不要|含めない).{0,8}(?:出力|output|提出|submit)/iu,
    terms: ['出力', 'output', '提出', 'submit'],
  },
];

export function normalizeRelaySearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\\/_\-・.()[\]{}:;,"'`]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripJapaneseParticles(value: string): string {
  return value.replace(/^[のにをがはへとやもでからまで]+|[のにをがはへとやもでからまで]+$/gu, '');
}

function addTerm(terms: Set<string>, value: string): void {
  const normalized = normalizeRelaySearchText(value);
  if (normalized.length >= 2) terms.add(normalized);
}

function collectIntentNoise(query: string): { cleaned: string; ignoredIntentTerms: string[] } {
  let cleaned = query.normalize('NFKC');
  const ignoredIntentTerms = new Set<string>();
  for (const hint of EXCLUSION_HINTS) {
    cleaned = cleaned.replace(hint.pattern, (match) => {
      const normalized = normalizeRelaySearchText(match);
      if (normalized) ignoredIntentTerms.add(`exclusion_instruction:${normalized}`);
      return ' ';
    });
  }
  for (const item of INTENT_WORD_PATTERNS) {
    cleaned = cleaned.replace(item.pattern, (match) => {
      const normalized = normalizeRelaySearchText(match);
      if (normalized) ignoredIntentTerms.add(`${item.label}:${normalized}`);
      return ' ';
    });
  }
  return { cleaned, ignoredIntentTerms: [...ignoredIntentTerms] };
}

function baseTokens(query: string): {
  terms: Set<string>;
  rejectedTokens: RelayDocumentSearchQueryPlanV1['rejectedTokens'];
  ignoredIntentTerms: string[];
} {
  const terms = new Set<string>();
  const rejectedTokens: RelayDocumentSearchQueryPlanV1['rejectedTokens'] = [];
  const ignoredIntentTerms = new Set<string>();
  const { cleaned, ignoredIntentTerms: ignored } = collectIntentNoise(query);
  for (const token of ignored) ignoredIntentTerms.add(token);
  const normalized = normalizeRelaySearchText(cleaned);
  for (const rawToken of normalized.split(/\s+/u)) {
    const token = stripJapaneseParticles(rawToken);
    if (!token) continue;
    if (token.length < 2 || GENERIC_STOP_TERMS.has(token)) {
      rejectedTokens.push({ token, reason: token.length < 2 ? 'too_short' : 'generic_intent_word' });
      continue;
    }
    terms.add(token);
  }
  for (const match of cleaned.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}|[A-Za-z][A-Za-z0-9]{1,}|\d{2,4}(?:期|q)?/giu)) {
    const token = stripJapaneseParticles(normalizeRelaySearchText(match[0]));
    if (!token || terms.has(token)) continue;
    if (token.length < 2 || GENERIC_STOP_TERMS.has(token)) {
      rejectedTokens.push({ token, reason: token.length < 2 ? 'too_short' : 'generic_intent_word' });
      continue;
    }
    terms.add(token);
  }
  return { terms, rejectedTokens, ignoredIntentTerms: [...ignoredIntentTerms] };
}

function periodHints(query: string): string[] {
  const out = new Set<string>();
  const normalized = query.normalize('NFKC');
  for (const match of normalized.matchAll(/\b(?:FY)?(\d{2,4})\s*(?:期)?\s*[-_ ]?\s*([1-4])\s*Q\b/giu)) {
    const year = match[1];
    const quarter = match[2];
    out.add(`${year}期-${quarter}Q`);
    out.add(`FY${year}-${quarter}Q`);
    out.add(`${year}-${quarter}Q`);
    out.add(`${quarter}Q`);
  }
  for (const match of normalized.matchAll(/\bFY?(\d{2,4})\b|(\d{2,4})期/giu)) {
    const year = match[1] ?? match[2];
    if (!year) continue;
    out.add(`${year}期`);
    out.add(`FY${year}`);
  }
  return [...out];
}

function fileTypeHints(query: string, request: RelayDocumentSearchRequestV1): string[] {
  const out = new Set<string>();
  for (const requested of request.fileTypes) {
    if (requested !== 'any') out.add(requested);
  }
  for (const hint of FILE_TYPE_HINTS) {
    if (hint.pattern.test(query)) out.add(hint.type);
  }
  return [...out];
}

function confirmationPolicy(request: RelayDocumentSearchRequestV1): RelayDocumentSearchQueryPlanV1['confirmationPolicy'] {
  return (
    request.evidence === 'required' ||
    request.intent === 'answer_with_evidence' ||
    request.intent === 'summarize_with_evidence' ||
    request.intent === 'inspect_file'
  )
    ? 'content_required'
    : 'candidate_ok';
}

function excludedTerms(query: string): string[] {
  const out = new Set<string>();
  for (const hint of EXCLUSION_HINTS) {
    if (!hint.pattern.test(query)) continue;
    for (const term of hint.terms) addTerm(out, term);
  }
  return [...out];
}

function recencyPreference(query: string): RelayDocumentSearchQueryPlanV1['recencyPreference'] {
  if (/最新|最新版|直近|新しい|最近|recent|newest|latest|current/iu.test(query)) return 'prefer_recent';
  if (/古い|過去|旧版|以前|old|older|archive/iu.test(query)) return 'prefer_older';
  return 'neutral';
}

function timeScopeIntent(
  request: RelayDocumentSearchRequestV1,
  periods: string[],
  recency: RelayDocumentSearchQueryPlanV1['recencyPreference'],
): { intent: RelayDocumentSearchTimeScopeIntent; reason: string } {
  if (periods.length > 0) {
    return { intent: 'explicit_period', reason: 'period_hint_detected' };
  }
  const hinted = request.queryPlanHints?.timeScopeIntent;
  if (hinted && hinted !== 'unknown') {
    return { intent: hinted, reason: 'validated_copilot_time_scope_hint' };
  }
  if (/前例|事例|過去|以前|昨年|前年|前期|過年度|参考|類似|同じ処理|同様|prior|past|historical|example|reference/iu.test(request.query)) {
    return { intent: 'historical_examples', reason: 'historical_example_terms_detected' };
  }
  if (recency === 'prefer_recent' || /今期|当期|今回|最新|最新版|直近|新しい|最近|current|latest|newest|recent/iu.test(request.query)) {
    return { intent: 'latest_first', reason: 'recency_terms_detected' };
  }
  return { intent: 'balanced', reason: 'default_balanced_time_scope' };
}

function modeForRequest(
  request: RelayDocumentSearchRequestV1,
  policy: RelayDocumentSearchQueryPlanV1['confirmationPolicy'],
): {
  mode: RelayDocumentSearchQueryPlanV1['mode'];
  contentStrategy: RelayDocumentSearchQueryPlanV1['contentStrategy'];
  searchModeReason: string;
} {
  if (request.intent === 'answer_with_evidence' || request.intent === 'summarize_with_evidence') {
    return {
      mode: 'answer',
      contentStrategy: 'answer_required',
      searchModeReason: 'intent_requires_answerable_content_evidence',
    };
  }
  if (policy === 'content_required') {
    return {
      mode: 'evidence',
      contentStrategy: 'content_required',
      searchModeReason: 'request_requires_content_confirmation',
    };
  }
  if (request.thoroughness === 'quick') {
    return {
      mode: 'filename',
      contentStrategy: 'candidate_first',
      searchModeReason: 'quick_search_uses_metadata_first_candidates',
    };
  }
  return {
    mode: 'hybrid',
    contentStrategy: 'candidate_first',
    searchModeReason: 'thorough_find_files_uses_filename_plus_bounded_content',
  };
}

export function buildRelayDocumentSearchQueryPlan(
  request: RelayDocumentSearchRequestV1,
  roots: string[],
): RelayDocumentSearchQueryPlanV1 {
  const { terms, rejectedTokens, ignoredIntentTerms } = baseTokens(request.query);
  const synonymExpansions: RelayDocumentSearchQueryPlanV1['synonymExpansions'] = [];
  for (const synonym of ACCOUNTING_SYNONYMS) {
    if (!synonym.pattern.test(request.query)) continue;
    const normalizedTerms: string[] = [];
    for (const term of synonym.terms) {
      addTerm(terms, term);
      normalizedTerms.push(normalizeRelaySearchText(term));
    }
    synonymExpansions.push({ source: synonym.source, terms: [...new Set(normalizedTerms)] });
  }
  const copilotHintTerms = new Set<string>();
  if (request.queryPlanHints) {
    for (const term of request.queryPlanHints.expandedTerms) {
      addTerm(terms, term);
      addTerm(copilotHintTerms, term);
    }
    for (const term of request.queryPlanHints.supportTerms) {
      addTerm(terms, term);
      addTerm(copilotHintTerms, term);
    }
    if (copilotHintTerms.size > 0) {
      synonymExpansions.push({ source: 'copilot_query_plan', terms: [...copilotHintTerms] });
    }
  }

  const periods = periodHints(request.query);
  for (const hint of periods) addTerm(terms, hint);
  const hints = new Set(fileTypeHints(request.query, request));
  for (const hint of request.queryPlanHints?.fileTypeHints ?? []) {
    if (hint !== 'any') hints.add(hint);
  }
  const policy = confirmationPolicy(request);
  const mode = modeForRequest(request, policy);
  const recency = recencyPreference(request.query);
  const timeScope = timeScopeIntent(request, periods, recency);
  const demotions = new Set<string>();
  for (const term of request.queryPlanHints?.demoteTerms ?? []) addTerm(demotions, term);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT,
    normalizerVersion: RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
    mode: mode.mode,
    searchModeReason: mode.searchModeReason,
    contentStrategy: mode.contentStrategy,
    query: request.query,
    roots,
    normalizedTerms: [...terms],
    synonymExpansions,
    ...(request.queryPlanHints?.summary ? { copilotHintSummary: request.queryPlanHints.summary } : {}),
    periodHints: periods,
    fileTypeHints: [...hints],
    rejectedTokens,
    ignoredIntentTerms,
    excludedTerms: excludedTerms(request.query),
    demoteTerms: [...demotions],
    recencyPreference: recency,
    timeScopeIntent: timeScope.intent,
    timeScopeReason: timeScope.reason,
    confirmationPolicy: policy,
  };
}
