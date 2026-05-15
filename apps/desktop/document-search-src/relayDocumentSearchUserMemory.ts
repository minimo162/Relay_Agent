/**
 * Local user memory for Relay Document Search.
 *
 * Stores only user-confirmed pins and recent search metadata. It does not store
 * extracted document contents, snippets, ParsedDocument IR, or Copilot prose.
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';
import type {
  RelayDocumentSearchFreshnessChange,
  RelayDocumentSearchFreshnessReport,
} from './relayDocumentSearchFreshness';
import {
  RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
  normalizeRelaySearchText,
} from './relayDocumentSearchQueryPlan';

export const RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT = 'RelayDocumentSearchUserMemory.v1' as const;
export const RELAY_DOCUMENT_SEARCH_USER_MEMORY_VERSION = 1 as const;
export const RELAY_DOCUMENT_SEARCH_USER_MEMORY_MOVE_MIGRATION_CONTRACT =
  'RelayDocumentSearchUserMemoryMoveMigration.v1' as const;

export type RelayDocumentSearchPinnedTarget = {
  kind: 'file' | 'folder';
  path: string;
  label?: string;
  createdAt: string;
  weight?: number;
};

export type RelayDocumentSearchRecentSearch = {
  query: string;
  normalizedTerms: string[];
  roots: string[];
  fileTypes: string[];
  createdAt: string;
  resultFileIds: string[];
  resultPaths: string[];
};

export type RelayDocumentSearchUserMemoryRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT;
  memoryVersion: typeof RELAY_DOCUMENT_SEARCH_USER_MEMORY_VERSION;
  normalizerVersion: typeof RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION;
  updatedAt: string;
  pins: RelayDocumentSearchPinnedTarget[];
  recentSearches: RelayDocumentSearchRecentSearch[];
};

export type RelayDocumentSearchUserMemoryOptions = {
  memoryDir?: string;
  maxRecentSearches?: number;
  now?: Date;
};

export type RelayDocumentSearchUserMemoryBoost = {
  score: number;
  reasons: string[];
};

export type RelayDocumentSearchUserMemoryMoveMigrationReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_USER_MEMORY_MOVE_MIGRATION_CONTRACT;
  highConfidenceMoveCount: number;
  migratedPinCount: number;
  migratedRecentSearchCount: number;
  migratedRecentPathCount: number;
  migratedRecentFileIdCount: number;
};

export type RelayDocumentSearchUserMemoryMoveMigrationResult = {
  record: RelayDocumentSearchUserMemoryRecord;
  report: RelayDocumentSearchUserMemoryMoveMigrationReport;
};

const DEFAULT_MAX_RECENT_SEARCHES = 50;

function defaultMemoryDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'user-memory');
}

export function relayDocumentSearchUserMemoryDir(options: RelayDocumentSearchUserMemoryOptions = {}): string {
  return options.memoryDir || process.env.RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR || defaultMemoryDir();
}

function memoryPath(options: RelayDocumentSearchUserMemoryOptions = {}): string {
  return join(relayDocumentSearchUserMemoryDir(options), 'user-memory.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedPath(path: string): string {
  return path.normalize('NFKC').replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '').toLowerCase();
}

function isPinnedTarget(value: unknown): value is RelayDocumentSearchPinnedTarget {
  return (
    isRecord(value) &&
    (value.kind === 'file' || value.kind === 'folder') &&
    typeof value.path === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.label === undefined || typeof value.label === 'string') &&
    (value.weight === undefined || typeof value.weight === 'number')
  );
}

function isRecentSearch(value: unknown): value is RelayDocumentSearchRecentSearch {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    Array.isArray(value.normalizedTerms) &&
    value.normalizedTerms.every((term) => typeof term === 'string') &&
    Array.isArray(value.roots) &&
    value.roots.every((root) => typeof root === 'string') &&
    Array.isArray(value.fileTypes) &&
    value.fileTypes.every((fileType) => typeof fileType === 'string') &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.resultFileIds) &&
    value.resultFileIds.every((fileId) => typeof fileId === 'string') &&
    Array.isArray(value.resultPaths) &&
    value.resultPaths.every((path) => typeof path === 'string')
  );
}

function parseMemoryRecord(text: string): RelayDocumentSearchUserMemoryRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.schemaVersion !== RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT) return undefined;
  if (parsed.memoryVersion !== RELAY_DOCUMENT_SEARCH_USER_MEMORY_VERSION) return undefined;
  if (parsed.normalizerVersion !== RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION) return undefined;
  if (typeof parsed.updatedAt !== 'string') return undefined;
  if (!Array.isArray(parsed.pins) || !parsed.pins.every(isPinnedTarget)) return undefined;
  if (!Array.isArray(parsed.recentSearches) || !parsed.recentSearches.every(isRecentSearch)) return undefined;
  return parsed as RelayDocumentSearchUserMemoryRecord;
}

export function emptyRelayDocumentSearchUserMemory(
  options: RelayDocumentSearchUserMemoryOptions = {},
): RelayDocumentSearchUserMemoryRecord {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_USER_MEMORY_CONTRACT,
    memoryVersion: RELAY_DOCUMENT_SEARCH_USER_MEMORY_VERSION,
    normalizerVersion: RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION,
    updatedAt: (options.now ?? new Date()).toISOString(),
    pins: [],
    recentSearches: [],
  };
}

export async function readRelayDocumentSearchUserMemory(
  options: RelayDocumentSearchUserMemoryOptions = {},
): Promise<RelayDocumentSearchUserMemoryRecord> {
  try {
    return parseMemoryRecord(await readFile(memoryPath(options), 'utf8')) ?? emptyRelayDocumentSearchUserMemory(options);
  } catch {
    return emptyRelayDocumentSearchUserMemory(options);
  }
}

export async function writeRelayDocumentSearchUserMemory(
  record: RelayDocumentSearchUserMemoryRecord,
  options: RelayDocumentSearchUserMemoryOptions = {},
): Promise<RelayDocumentSearchUserMemoryRecord> {
  const target = memoryPath(options);
  const next = {
    ...record,
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next)}\n`, 'utf8');
  await rename(tempPath, target);
  return next;
}

export function withRelayDocumentSearchPinnedTarget(
  record: RelayDocumentSearchUserMemoryRecord,
  pin: RelayDocumentSearchPinnedTarget,
  options: RelayDocumentSearchUserMemoryOptions = {},
): RelayDocumentSearchUserMemoryRecord {
  const pinPath = normalizedPath(pin.path);
  const pins = [
    pin,
    ...record.pins.filter((existing) => !(existing.kind === pin.kind && normalizedPath(existing.path) === pinPath)),
  ];
  return {
    ...record,
    updatedAt: (options.now ?? new Date()).toISOString(),
    pins,
  };
}

export function withRelayDocumentSearchRecentSearch(
  record: RelayDocumentSearchUserMemoryRecord,
  recent: Omit<RelayDocumentSearchRecentSearch, 'createdAt'> & { createdAt?: string },
  options: RelayDocumentSearchUserMemoryOptions = {},
): RelayDocumentSearchUserMemoryRecord {
  const createdAt = recent.createdAt || (options.now ?? new Date()).toISOString();
  const key = [
    normalizeRelaySearchText(recent.query),
    recent.roots.map(normalizedPath).sort().join('|'),
    recent.fileTypes.map((fileType) => fileType.toLowerCase()).sort().join('|'),
  ].join('::');
  const nextRecent: RelayDocumentSearchRecentSearch = {
    ...recent,
    createdAt,
  };
  const maxRecentSearches = Math.max(1, options.maxRecentSearches ?? DEFAULT_MAX_RECENT_SEARCHES);
  const recentSearches = [
    nextRecent,
    ...record.recentSearches.filter((item) =>
      [
        normalizeRelaySearchText(item.query),
        item.roots.map(normalizedPath).sort().join('|'),
        item.fileTypes.map((fileType) => fileType.toLowerCase()).sort().join('|'),
      ].join('::') !== key
    ),
  ].slice(0, maxRecentSearches);
  return {
    ...record,
    updatedAt: createdAt,
    recentSearches,
  };
}

function highConfidenceMoveChanges(
  reports: RelayDocumentSearchFreshnessReport[],
): RelayDocumentSearchFreshnessChange[] {
  return reports.flatMap((report) =>
    report.changes.filter((change) =>
      change.reason === 'moved' &&
        change.move_confidence === 'high' &&
        Boolean(change.previous_path && change.current_path),
    ),
  );
}

function replaceMovedPath(path: string, moveByPreviousPath: Map<string, string>): string {
  return moveByPreviousPath.get(normalizedPath(path)) ?? path;
}

function replaceMovedFileId(fileId: string, moveByPreviousFileId: Map<string, string>): string {
  return moveByPreviousFileId.get(fileId) ?? fileId;
}

export function applyRelayDocumentSearchMoveFreshnessToUserMemory(
  record: RelayDocumentSearchUserMemoryRecord,
  reports: RelayDocumentSearchFreshnessReport[],
  options: RelayDocumentSearchUserMemoryOptions = {},
): RelayDocumentSearchUserMemoryMoveMigrationResult {
  const moves = highConfidenceMoveChanges(reports);
  const moveByPreviousPath = new Map<string, string>();
  const moveByPreviousFileId = new Map<string, string>();
  for (const move of moves) {
    if (move.previous_path && move.current_path) {
      moveByPreviousPath.set(normalizedPath(move.previous_path), move.current_path);
    }
    if (move.previous_file_id && move.current_file_id) {
      moveByPreviousFileId.set(move.previous_file_id, move.current_file_id);
    }
  }

  let migratedPinCount = 0;
  const pins = record.pins.map((pin) => {
    if (pin.kind !== 'file') return pin;
    const nextPath = replaceMovedPath(pin.path, moveByPreviousPath);
    if (nextPath === pin.path) return pin;
    migratedPinCount += 1;
    return {
      ...pin,
      path: nextPath,
    };
  });

  let migratedRecentSearchCount = 0;
  let migratedRecentPathCount = 0;
  let migratedRecentFileIdCount = 0;
  const recentSearches = record.recentSearches.map((recent) => {
    const nextPaths = recent.resultPaths.map((path) => replaceMovedPath(path, moveByPreviousPath));
    const nextFileIds = recent.resultFileIds.map((fileId) => replaceMovedFileId(fileId, moveByPreviousFileId));
    const pathChanges = nextPaths.filter((path, index) => path !== recent.resultPaths[index]).length;
    const fileIdChanges = nextFileIds.filter((fileId, index) => fileId !== recent.resultFileIds[index]).length;
    if (pathChanges === 0 && fileIdChanges === 0) return recent;
    migratedRecentSearchCount += 1;
    migratedRecentPathCount += pathChanges;
    migratedRecentFileIdCount += fileIdChanges;
    return {
      ...recent,
      resultPaths: [...new Set(nextPaths)],
      resultFileIds: [...new Set(nextFileIds)],
    };
  });

  const changed = migratedPinCount > 0 || migratedRecentSearchCount > 0;
  return {
    record: changed
      ? {
          ...record,
          updatedAt: (options.now ?? new Date()).toISOString(),
          pins,
          recentSearches,
        }
      : record,
    report: {
      schemaVersion: RELAY_DOCUMENT_SEARCH_USER_MEMORY_MOVE_MIGRATION_CONTRACT,
      highConfidenceMoveCount: moves.length,
      migratedPinCount,
      migratedRecentSearchCount,
      migratedRecentPathCount,
      migratedRecentFileIdCount,
    },
  };
}

function pinWeight(pin: RelayDocumentSearchPinnedTarget): number {
  if (typeof pin.weight === 'number' && Number.isFinite(pin.weight)) {
    return Math.max(0, Math.min(pin.weight, 10));
  }
  return pin.kind === 'file' ? 6 : 4;
}

export function relayDocumentSearchUserMemoryBoostForFile(
  file: RelayDocumentSearchCachedFileMetadata,
  memory: RelayDocumentSearchUserMemoryRecord,
): RelayDocumentSearchUserMemoryBoost {
  const filePath = normalizedPath(file.path);
  let score = 0;
  const reasons: string[] = [];
  for (const pin of memory.pins) {
    const targetPath = normalizedPath(pin.path);
    if (pin.kind === 'file' && filePath === targetPath) {
      const weight = pinWeight(pin);
      score += weight;
      reasons.push(`pin:file:${weight}`);
    }
    if (pin.kind === 'folder' && (filePath === targetPath || filePath.startsWith(`${targetPath}/`))) {
      const weight = pinWeight(pin);
      score += weight;
      reasons.push(`pin:folder:${weight}`);
    }
  }
  for (const recent of memory.recentSearches.slice(0, 10)) {
    if (recent.resultPaths.map(normalizedPath).includes(filePath) || recent.resultFileIds.includes(file.fileId)) {
      score += 1;
      reasons.push('history:recent-result:1');
      break;
    }
  }
  return { score, reasons };
}
