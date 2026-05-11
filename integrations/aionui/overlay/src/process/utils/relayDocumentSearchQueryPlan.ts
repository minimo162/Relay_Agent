/**
 * Deterministic query planning for Relay Document Search.
 *
 * Copilot may suggest wording, but Relay owns the final query plan used by the
 * executor. This module is intentionally filesystem-free: it normalizes the
 * user's request into terms, hints, and confirmation policy without scanning or
 * parsing documents.
 */

import type { RelayDocumentSearchRequestV1 } from './relayDocumentSearchContract';

export const RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT = 'RelayDocumentSearchQueryPlan.v1' as const;
export const RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION = 'relay-query-normalizer-v1' as const;

export type RelayDocumentSearchQueryPlanV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT;
  normalizerVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION;
  mode: 'filename' | 'hybrid' | 'evidence';
  query: string;
  roots: string[];
  normalizedTerms: string[];
  synonymExpansions: Array<{ source: string; terms: string[] }>;
  periodHints: string[];
  fileTypeHints: string[];
  rejectedTokens: Array<{ token: string; reason: string }>;
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

export function normalizeRelaySearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\\/_\-・.()[\]{}:;,"'`]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function addTerm(terms: Set<string>, value: string): void {
  const normalized = normalizeRelaySearchText(value);
  if (normalized.length >= 2) terms.add(normalized);
}

function baseTokens(query: string): { terms: Set<string>; rejectedTokens: RelayDocumentSearchQueryPlanV1['rejectedTokens'] } {
  const terms = new Set<string>();
  const rejectedTokens: RelayDocumentSearchQueryPlanV1['rejectedTokens'] = [];
  for (const token of normalizeRelaySearchText(query).split(/\s+/u)) {
    if (!token) continue;
    if (token.length < 2) {
      rejectedTokens.push({ token, reason: 'too_short' });
      continue;
    }
    terms.add(token);
  }
  return { terms, rejectedTokens };
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

export function buildRelayDocumentSearchQueryPlan(
  request: RelayDocumentSearchRequestV1,
  roots: string[],
): RelayDocumentSearchQueryPlanV1 {
  const { terms, rejectedTokens } = baseTokens(request.query);
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

  const periods = periodHints(request.query);
  for (const hint of periods) addTerm(terms, hint);
  const hints = fileTypeHints(request.query, request);
  const policy = confirmationPolicy(request);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_QUERY_PLAN_CONTRACT,
    normalizerVersion: RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
    mode: request.thoroughness === 'quick' ? 'filename' : policy === 'content_required' ? 'evidence' : 'hybrid',
    query: request.query,
    roots,
    normalizedTerms: [...terms],
    synonymExpansions,
    periodHints: periods,
    fileTypeHints: hints,
    rejectedTokens,
    confirmationPolicy: policy,
  };
}
