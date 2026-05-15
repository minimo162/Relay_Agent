/**
 * Result grouping for Relay Document Search.
 *
 * This keeps broad shared-folder results from being dominated by backup/copy
 * variants while avoiding aggressive grouping of legitimate period/date
 * versions. The grouping contract is metadata-only.
 */

import { basename } from 'path';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';
import { normalizeRelaySearchText } from './relayDocumentSearchQueryPlan';

export const RELAY_DOCUMENT_SEARCH_RESULT_GROUPING_CONTRACT = 'RelayDocumentSearchResultGrouping.v1' as const;
const RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT = 'RelayDocumentSearchScoreBreakdown.v1' as const;

export type RelayDocumentSearchGroupableCandidate = {
  file: RelayDocumentSearchCachedFileMetadata;
  score: number;
  contentEvidence?: unknown;
};

export type RelayDocumentSearchResultGroup = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_GROUPING_CONTRACT;
  groupId: string;
  groupKey: string;
  representativeFileId: string;
  memberFileIds: string[];
  memberCount: number;
  collapsedCount: number;
  variantReasons: string[];
  score_breakdown: {
    score_breakdown_contract: typeof RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT;
    groupingScore: number;
    representativeScore: number;
    highestMemberScore: number;
    collapsedMemberScoreTotal: number;
    deterministicTieBreakers: string[];
  };
};

export type RelayDocumentSearchResultGroupingReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_GROUPING_CONTRACT;
  enabled: boolean;
  groupCount: number;
  groupedCandidateCount: number;
  representativeCount: number;
  collapsedCandidateCount: number;
};

export type RelayDocumentSearchGroupedCandidates<T extends RelayDocumentSearchGroupableCandidate> = {
  candidates: T[];
  groupsByFileId: Map<string, RelayDocumentSearchResultGroup>;
  groups: RelayDocumentSearchResultGroup[];
  diagnostics: RelayDocumentSearchResultGroupingReport;
};

const VARIANT_TOKENS = new Set([
  'backup',
  'backups',
  'bak',
  'copy',
  'copies',
  'old',
  'archive',
  'archived',
  'tmp',
  'temp',
  'コピー',
  '複製',
  '控え',
  '予備',
  '旧',
  '過去',
  'バックアップ',
]);

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripExtension(file: RelayDocumentSearchCachedFileMetadata): string {
  const suffix = file.extension ? `.${file.extension}` : '';
  return suffix && file.name.toLowerCase().endsWith(suffix)
    ? file.name.slice(0, -suffix.length)
    : basename(file.name, suffix);
}

function pathTokens(file: RelayDocumentSearchCachedFileMetadata): string[] {
  return normalizeRelaySearchText(`${file.displayPath} ${file.name}`).split(/\s+/u).filter(Boolean);
}

function variantReasons(file: RelayDocumentSearchCachedFileMetadata): string[] {
  const tokens = pathTokens(file);
  const reasons = new Set<string>();
  for (const token of tokens) {
    if (VARIANT_TOKENS.has(token)) reasons.add(`variant_token:${token}`);
    if (/^v(?:er(?:sion)?)?\d+(?:\s?\d+)?$/iu.test(token)) reasons.add('version_token');
  }
  if (/backup|backups|archive|old|コピー|複製|バックアップ|過去|旧/iu.test(file.displayPath)) {
    reasons.add('variant_path');
  }
  if (/\b(?:copy|backup|bak|old|tmp|temp)\b|コピー|複製|バックアップ|旧/iu.test(file.name)) {
    reasons.add('variant_name');
  }
  return [...reasons].sort();
}

function canonicalName(file: RelayDocumentSearchCachedFileMetadata): string {
  let normalized = normalizeRelaySearchText(stripExtension(file));
  normalized = normalized
    .replace(/\b(?:copy|copies|backup|backups|bak|old|archive|archived|tmp|temp)\b/giu, ' ')
    .replace(/(?:コピー|複製|控え|予備|旧|過去|バックアップ)/gu, ' ')
    .replace(/\b(?:v|ver|version)\s*\d+(?:\s*\d+)?\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized || normalizeRelaySearchText(stripExtension(file));
}

function groupingKey(file: RelayDocumentSearchCachedFileMetadata): string {
  return `${file.extension}:${canonicalName(file)}`;
}

function modifiedTimeMs(file: RelayDocumentSearchCachedFileMetadata): number {
  const parsed = Date.parse(file.modifiedTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRepresentatives<T extends RelayDocumentSearchGroupableCandidate>(left: T, right: T): number {
  const leftVariantCount = variantReasons(left.file).length;
  const rightVariantCount = variantReasons(right.file).length;
  const leftContent = left.contentEvidence ? 1 : 0;
  const rightContent = right.contentEvidence ? 1 : 0;
  return (
    rightContent - leftContent ||
    leftVariantCount - rightVariantCount ||
    right.score - left.score ||
    modifiedTimeMs(right.file) - modifiedTimeMs(left.file) ||
    left.file.displayPath.localeCompare(right.file.displayPath) ||
    left.file.fileId.localeCompare(right.file.fileId)
  );
}

function shouldCollapseGroup<T extends RelayDocumentSearchGroupableCandidate>(members: T[]): boolean {
  if (members.length <= 1) return false;
  const allReasons = members.flatMap((candidate) => variantReasons(candidate.file));
  if (allReasons.length > 0) return true;
  const normalizedNames = new Set(members.map((candidate) => normalizeRelaySearchText(candidate.file.name)));
  return normalizedNames.size === 1 && members.length > 2;
}

function makeGroup<T extends RelayDocumentSearchGroupableCandidate>(
  groupKey: string,
  members: T[],
): { representative: T; group: RelayDocumentSearchResultGroup } {
  const sortedMembers = [...members].sort(compareRepresentatives);
  const representative = sortedMembers[0];
  const reasons = [...new Set(sortedMembers.flatMap((candidate) => variantReasons(candidate.file)))].sort();
  const groupId = `group-${stableHash(`${groupKey}:${sortedMembers.map((candidate) => candidate.file.fileId).join(':')}`)}`;
  const collapsedMembers = sortedMembers.filter((candidate) => candidate.file.fileId !== representative.file.fileId);
  return {
    representative,
    group: {
      schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_GROUPING_CONTRACT,
      groupId,
      groupKey,
      representativeFileId: representative.file.fileId,
      memberFileIds: sortedMembers.map((candidate) => candidate.file.fileId),
      memberCount: sortedMembers.length,
      collapsedCount: Math.max(0, sortedMembers.length - 1),
      variantReasons: reasons,
      score_breakdown: {
        score_breakdown_contract: RELAY_DOCUMENT_SEARCH_SCORE_BREAKDOWN_CONTRACT,
        groupingScore: 0,
        representativeScore: representative.score,
        highestMemberScore: Math.max(...sortedMembers.map((candidate) => candidate.score)),
        collapsedMemberScoreTotal: collapsedMembers.reduce((sum, candidate) => sum + candidate.score, 0),
        deterministicTieBreakers: [
          'content_evidence',
          'variant_reason_count',
          'score',
          'modified_time',
          'display_path',
          'file_id',
        ],
      },
    },
  };
}

export function groupRelayDocumentSearchCandidates<T extends RelayDocumentSearchGroupableCandidate>(
  candidates: T[],
): RelayDocumentSearchGroupedCandidates<T> {
  const buckets = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = groupingKey(candidate.file);
    const current = buckets.get(key) ?? [];
    current.push(candidate);
    buckets.set(key, current);
  }

  const output: T[] = [];
  const groups: RelayDocumentSearchResultGroup[] = [];
  const groupsByFileId = new Map<string, RelayDocumentSearchResultGroup>();

  for (const [key, members] of buckets) {
    if (!shouldCollapseGroup(members)) {
      output.push(...members);
      continue;
    }
    const { representative, group } = makeGroup(key, members);
    output.push(representative);
    groups.push(group);
    for (const fileId of group.memberFileIds) {
      groupsByFileId.set(fileId, group);
    }
  }

  output.sort((left, right) =>
    right.score - left.score ||
    left.file.displayPath.localeCompare(right.file.displayPath) ||
    left.file.fileId.localeCompare(right.file.fileId),
  );
  const collapsedCandidateCount = groups.reduce((sum, group) => sum + group.collapsedCount, 0);
  return {
    candidates: output,
    groupsByFileId,
    groups,
    diagnostics: {
      schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_GROUPING_CONTRACT,
      enabled: true,
      groupCount: groups.length,
      groupedCandidateCount: groups.reduce((sum, group) => sum + group.memberCount, 0),
      representativeCount: groups.length,
      collapsedCandidateCount,
    },
  };
}
