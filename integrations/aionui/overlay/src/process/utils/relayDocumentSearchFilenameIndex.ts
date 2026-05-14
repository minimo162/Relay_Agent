/**
 * Filename/path index for Relay Document Search.
 *
 * This is Docufinder-style discovery state. It stores searchable metadata only
 * and never stores extracted Office/PDF/text contents or ParsedDocument IR.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';
import {
  RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
  normalizeRelaySearchText,
} from './relayDocumentSearchQueryPlan';

export const RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT = 'RelayDocumentSearchFilenameIndex.v1' as const;
export const RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_VERSION = 2 as const;

export type RelayDocumentSearchFilenameIndexEntry = RelayDocumentSearchCachedFileMetadata & {
  normalizedName: string;
  normalizedDisplayPath: string;
  terms: string[];
};

export type RelayDocumentSearchFilenameIndexRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT;
  indexVersion: typeof RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_VERSION;
  normalizerVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION;
  root: string;
  generatedAt: string;
  stats: {
    fileCount: number;
    termCount: number;
    postingCount: number;
  };
  entries: RelayDocumentSearchFilenameIndexEntry[];
  invertedIndex: Record<string, string[]>;
};

export type RelayDocumentSearchFilenameIndexOptions = {
  indexDir?: string;
  maxAgeMs?: number;
  now?: Date;
};

export type RelayDocumentSearchFilenameIndexMatch = {
  fileId: string;
  path: string;
  displayPath: string;
  score: number;
  reasons: string[];
};

export type RelayDocumentSearchFilenameIndexSearchOptions = {
  fileTypes?: string[];
  maxResults?: number;
};

const DEFAULT_MAX_INDEX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 1000;

function defaultIndexDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'filename-index');
}

export function relayDocumentSearchFilenameIndexDir(
  options: RelayDocumentSearchFilenameIndexOptions = {},
): string {
  return options.indexDir || process.env.RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR || defaultIndexDir();
}

export function relayDocumentSearchFilenameIndexPathForRoot(
  root: string,
  options: RelayDocumentSearchFilenameIndexOptions = {},
): string {
  const normalizedRoot = resolve(root);
  const hash = createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 24);
  return join(relayDocumentSearchFilenameIndexDir(options), `${hash}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function containsCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function cjkNgrams(value: string): string[] {
  const normalized = normalizeRelaySearchText(value).replace(/\s+/gu, '');
  if (!containsCjk(normalized)) return [];
  const out: string[] = [];
  for (const width of [2, 3]) {
    for (let index = 0; index <= normalized.length - width; index += 1) {
      out.push(normalized.slice(index, index + width));
    }
  }
  return out;
}

function alnumTokens(value: string): string[] {
  return normalizeRelaySearchText(value)
    .split(/[^a-z0-9]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function alnumPrefixes(value: string): string[] {
  const out: string[] = [];
  for (const token of alnumTokens(value)) {
    const max = Math.min(token.length, 24);
    for (let width = 2; width <= max; width += 1) {
      out.push(token.slice(0, width));
    }
  }
  return out;
}

function searchableTerms(file: RelayDocumentSearchCachedFileMetadata): string[] {
  const normalizedName = normalizeRelaySearchText(file.name);
  const normalizedDisplayPath = normalizeRelaySearchText(file.displayPath);
  const normalizedExtension = normalizeRelaySearchText(file.extension);
  const normalizedBasename = normalizeRelaySearchText(basename(file.name, file.extension ? `.${file.extension}` : ''));
  const splitTerms = `${normalizedName} ${normalizedDisplayPath}`
    .split(/\s+/u)
    .filter((term) => term.length >= 2);
  return unique([
    normalizedName,
    normalizedDisplayPath,
    normalizedBasename,
    normalizedExtension,
    ...splitTerms,
    ...cjkNgrams(file.name),
    ...cjkNgrams(file.displayPath),
    ...alnumPrefixes(file.name),
    ...alnumPrefixes(file.displayPath),
  ]);
}

function isFilenameIndexEntry(value: unknown): value is RelayDocumentSearchFilenameIndexEntry {
  return (
    isRecord(value) &&
    typeof value.fileId === 'string' &&
    typeof value.root === 'string' &&
    typeof value.path === 'string' &&
    typeof value.displayPath === 'string' &&
    typeof value.name === 'string' &&
    typeof value.extension === 'string' &&
    typeof value.size === 'number' &&
    typeof value.modifiedTime === 'string' &&
    typeof value.sourceMetadataVersion === 'string' &&
    typeof value.normalizedName === 'string' &&
    typeof value.normalizedDisplayPath === 'string' &&
    Array.isArray(value.terms) &&
    value.terms.every((term) => typeof term === 'string')
  );
}

function parseFilenameIndexRecord(
  text: string,
  root: string,
  options: RelayDocumentSearchFilenameIndexOptions,
): RelayDocumentSearchFilenameIndexRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.schemaVersion !== RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT) return undefined;
  if (parsed.indexVersion !== RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_VERSION) return undefined;
  if (parsed.normalizerVersion !== RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION) return undefined;
  if (resolve(String(parsed.root || '')) !== resolve(root)) return undefined;
  if (typeof parsed.generatedAt !== 'string') return undefined;
  if (!Array.isArray(parsed.entries) || !parsed.entries.every(isFilenameIndexEntry)) return undefined;
  if (!isRecord(parsed.stats) || typeof parsed.stats.fileCount !== 'number' || typeof parsed.stats.termCount !== 'number') return undefined;
  if (!isRecord(parsed.invertedIndex)) return undefined;
  if (!Object.values(parsed.invertedIndex).every((value) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  )) {
    return undefined;
  }

  const generatedAtMs = Date.parse(parsed.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return undefined;
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_INDEX_AGE_MS;
  if (maxAgeMs >= 0 && nowMs - generatedAtMs > maxAgeMs) return undefined;

  return parsed as RelayDocumentSearchFilenameIndexRecord;
}

export function buildRelayDocumentSearchFilenameIndex(
  root: string,
  files: RelayDocumentSearchCachedFileMetadata[],
  options: RelayDocumentSearchFilenameIndexOptions = {},
): RelayDocumentSearchFilenameIndexRecord {
  const entries = files.map((file) => ({
    ...file,
    normalizedName: normalizeRelaySearchText(file.name),
    normalizedDisplayPath: normalizeRelaySearchText(file.displayPath),
    terms: searchableTerms(file),
  }));
  const postings = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const term of entry.terms) {
      if (!term) continue;
      const fileIds = postings.get(term) ?? new Set<string>();
      fileIds.add(entry.fileId);
      postings.set(term, fileIds);
    }
  }
  const invertedIndex = Object.fromEntries(
    [...postings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([term, fileIds]) => [term, [...fileIds].sort()]),
  );
  const termCount = Object.keys(invertedIndex).length;
  const postingCount = Object.values(invertedIndex).reduce((sum, fileIds) => sum + fileIds.length, 0);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_CONTRACT,
    indexVersion: RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_VERSION,
    normalizerVersion: RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
    root: resolve(root),
    generatedAt: (options.now ?? new Date()).toISOString(),
    stats: {
      fileCount: entries.length,
      termCount,
      postingCount,
    },
    entries,
    invertedIndex,
  };
}

export async function readRelayDocumentSearchFilenameIndex(
  root: string,
  options: RelayDocumentSearchFilenameIndexOptions = {},
): Promise<RelayDocumentSearchFilenameIndexRecord | undefined> {
  try {
    return parseFilenameIndexRecord(
      await readFile(relayDocumentSearchFilenameIndexPathForRoot(root, options), 'utf8'),
      root,
      options,
    );
  } catch {
    return undefined;
  }
}

export async function writeRelayDocumentSearchFilenameIndex(
  root: string,
  files: RelayDocumentSearchCachedFileMetadata[],
  options: RelayDocumentSearchFilenameIndexOptions = {},
): Promise<RelayDocumentSearchFilenameIndexRecord> {
  const indexPath = relayDocumentSearchFilenameIndexPathForRoot(root, options);
  const record = buildRelayDocumentSearchFilenameIndex(root, files, options);
  await mkdir(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(record)}\n`, 'utf8');
  await rename(tempPath, indexPath);
  return record;
}

function scoreEntry(
  entry: RelayDocumentSearchFilenameIndexEntry,
  terms: string[],
): { score: number; reasons: string[] } {
  if (terms.length === 0) return { score: 0, reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    const normalizedTerm = normalizeRelaySearchText(term);
    if (!normalizedTerm) continue;
    if (entry.normalizedName.includes(normalizedTerm)) {
      score += 5;
      reasons.push(`filename:${normalizedTerm}`);
      continue;
    }
    if (entry.normalizedDisplayPath.includes(normalizedTerm)) {
      score += 2;
      reasons.push(`path:${normalizedTerm}`);
      continue;
    }
    if (entry.terms.includes(normalizedTerm)) {
      score += 1;
      reasons.push(`term:${normalizedTerm}`);
    }
  }
  return { score, reasons };
}

function entryDirectlyMatchesTerm(
  entry: RelayDocumentSearchFilenameIndexEntry,
  term: string,
): boolean {
  return (
    entry.normalizedName.includes(term) ||
    entry.normalizedDisplayPath.includes(term) ||
    entry.terms.includes(term)
  );
}

function searchKeysForTerm(term: string): string[] {
  const normalizedTerm = normalizeRelaySearchText(term);
  if (!normalizedTerm) return [];
  return unique([
    normalizedTerm,
    ...cjkNgrams(normalizedTerm),
    ...alnumPrefixes(normalizedTerm),
  ]);
}

function candidateEntriesForTerms(
  index: RelayDocumentSearchFilenameIndexRecord,
  terms: string[],
): RelayDocumentSearchFilenameIndexEntry[] {
  if (terms.length === 0) return index.entries;
  const directCandidateIds = new Set<string>();
  for (const term of terms) {
    for (const entry of index.entries) {
      if (entryDirectlyMatchesTerm(entry, term)) {
        directCandidateIds.add(entry.fileId);
      }
    }
  }

  if (directCandidateIds.size > 0) {
    return index.entries.filter((entry) => directCandidateIds.has(entry.fileId));
  }

  const fallbackCandidateIds = new Set<string>();
  for (const term of terms) {
    for (const key of searchKeysForTerm(term)) {
      for (const fileId of index.invertedIndex[key] ?? []) {
        fallbackCandidateIds.add(fileId);
      }
    }
  }
  if (!fallbackCandidateIds.size) {
    return index.entries;
  }
  return index.entries.filter((entry) => fallbackCandidateIds.has(entry.fileId));
}

function fileTypeAllowed(entry: RelayDocumentSearchFilenameIndexEntry, fileTypes?: string[]): boolean {
  if (!fileTypes || fileTypes.length === 0 || fileTypes.includes('any')) return true;
  return fileTypes.includes(entry.extension);
}

export function searchRelayDocumentSearchFilenameIndex(
  index: RelayDocumentSearchFilenameIndexRecord,
  terms: string[],
  options: RelayDocumentSearchFilenameIndexSearchOptions = {},
): RelayDocumentSearchFilenameIndexMatch[] {
  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS);
  const normalizedTerms = [...new Set(terms.map((term) => normalizeRelaySearchText(term)).filter(Boolean))];
  return candidateEntriesForTerms(index, normalizedTerms)
    .filter((entry) => fileTypeAllowed(entry, options.fileTypes))
    .map((entry) => {
      const scored = scoreEntry(entry, normalizedTerms);
      return {
        fileId: entry.fileId,
        path: entry.path,
        displayPath: entry.displayPath,
        score: scored.score,
        reasons: scored.reasons,
      };
    })
    .filter((match) => match.score > 0 || normalizedTerms.length === 0)
    .sort((left, right) => right.score - left.score || left.displayPath.localeCompare(right.displayPath))
    .slice(0, maxResults);
}
