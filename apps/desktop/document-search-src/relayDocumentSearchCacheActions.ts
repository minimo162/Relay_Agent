/**
 * Safe cache maintenance actions for Relay Document Search.
 *
 * These actions are local-only support hooks. The default repair path removes
 * rebuildable derived caches and preserves roots, metadata discovery state,
 * pins, search history, and job snapshots.
 */

import { readdir, readFile, rm, stat } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';

import {
  relayDocumentSearchFilenameIndexDir,
  relayDocumentSearchFilenameIndexPathForRoot,
} from './relayDocumentSearchFilenameIndex';
import { relayDocumentSearchDerivedContentIndexCacheDir } from './relayDocumentSearchDerivedContentIndex';
import { relayDocumentSearchJobStoreDir } from './relayDocumentSearchJobStore';
import {
  relayDocumentSearchMetadataCacheLockPathForRoot,
  relayDocumentSearchMetadataCachePathForRoot,
} from './relayDocumentSearchMetadataCache';
import { relayDocumentSearchUserMemoryDir } from './relayDocumentSearchUserMemory';
import { relayParsedDocumentCachePolicy } from './relayParsedDocumentCache';

export const RELAY_DOCUMENT_SEARCH_CACHE_ACTIONS_CONTRACT = 'RelayDocumentSearchCacheActions.v1' as const;

export type RelayDocumentSearchCacheAction =
  | 'inspect'
  | 'clear-derived-caches'
  | 'clear-rescan-caches'
  | 'clear-root-caches'
  | 'remove-root-caches'
  | 'clear-metadata-cache'
  | 'clear-filename-index'
  | 'clear-derived-content-index'
  | 'clear-parsed-document-cache'
  | 'clear-job-store';

export type RelayDocumentSearchCacheStoreName =
  | 'metadataCache'
  | 'filenameIndex'
  | 'derivedContentIndex'
  | 'parsedDocumentCache'
  | 'jobStore'
  | 'userMemory';

export type RelayDocumentSearchCacheActionOptions = {
  root?: string;
  metadataCacheDir?: string;
  filenameIndexDir?: string;
  derivedContentIndexDir?: string;
  parsedDocumentCacheDir?: string;
  jobStoreDir?: string;
  userMemoryDir?: string;
  confirmRootRemoval?: boolean;
  allowUnsafeCacheDirForTests?: boolean;
  signal?: AbortSignal;
  now?: Date;
};

export type RelayDocumentSearchCacheStoreReport = {
  name: RelayDocumentSearchCacheStoreName;
  path: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  protected: boolean;
  contentBearing: boolean;
  preservedByDerivedRepair: boolean;
  errors: string[];
};

export type RelayDocumentSearchCacheActionResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_CACHE_ACTIONS_CONTRACT;
  action: RelayDocumentSearchCacheAction;
  generatedAt: string;
  ok: boolean;
  cancelled: boolean;
  removedStores: RelayDocumentSearchCacheStoreName[];
  removedPathCounts: Partial<Record<RelayDocumentSearchCacheStoreName, number>>;
  preservedStores: RelayDocumentSearchCacheStoreName[];
  before: RelayDocumentSearchCacheStoreReport[];
  after: RelayDocumentSearchCacheStoreReport[];
  warnings: string[];
  errors: Array<{ store?: RelayDocumentSearchCacheStoreName; message: string }>;
};

function defaultDocumentSearchDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search');
}

function metadataCacheDir(options: RelayDocumentSearchCacheActionOptions): string {
  return resolve(
    options.metadataCacheDir ||
      process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR ||
      join(defaultDocumentSearchDir(), 'metadata-cache'),
  );
}

function parsedDocumentCacheDir(options: RelayDocumentSearchCacheActionOptions): string {
  return relayParsedDocumentCachePolicy({
    cacheDir: options.parsedDocumentCacheDir,
  }).cacheDir;
}

function cacheStores(options: RelayDocumentSearchCacheActionOptions): Array<{
  name: RelayDocumentSearchCacheStoreName;
  path: string;
  protected: boolean;
  contentBearing: boolean;
  preservedByDerivedRepair: boolean;
}> {
  return [
    {
      name: 'metadataCache',
      path: metadataCacheDir(options),
      protected: false,
      contentBearing: false,
      preservedByDerivedRepair: true,
    },
    {
      name: 'filenameIndex',
      path: relayDocumentSearchFilenameIndexDir({ indexDir: options.filenameIndexDir }),
      protected: false,
      contentBearing: false,
      preservedByDerivedRepair: false,
    },
    {
      name: 'derivedContentIndex',
      path: relayDocumentSearchDerivedContentIndexCacheDir({ cacheDir: options.derivedContentIndexDir }),
      protected: false,
      contentBearing: true,
      preservedByDerivedRepair: false,
    },
    {
      name: 'parsedDocumentCache',
      path: parsedDocumentCacheDir(options),
      protected: false,
      contentBearing: true,
      preservedByDerivedRepair: false,
    },
    {
      name: 'jobStore',
      path: relayDocumentSearchJobStoreDir({
        jobStoreDir: options.jobStoreDir,
        now: options.now,
      }),
      protected: false,
      contentBearing: false,
      preservedByDerivedRepair: true,
    },
    {
      name: 'userMemory',
      path: relayDocumentSearchUserMemoryDir({ memoryDir: options.userMemoryDir }),
      protected: true,
      contentBearing: false,
      preservedByDerivedRepair: true,
    },
  ];
}

async function inspectPath(path: string): Promise<{ exists: boolean; fileCount: number; totalBytes: number; errors: string[] }> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return { exists: false, fileCount: 0, totalBytes: 0, errors: [] };
  }
  if (info.isFile()) {
    return { exists: true, fileCount: 1, totalBytes: info.size, errors: [] };
  }
  if (!info.isDirectory()) {
    return { exists: true, fileCount: 0, totalBytes: 0, errors: ['not_a_directory'] };
  }
  const out = { exists: true, fileCount: 0, totalBytes: 0, errors: [] as string[] };
  await inspectDirectory(path, out);
  return out;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function inspectDirectory(
  path: string,
  out: { fileCount: number; totalBytes: number; errors: string[] },
): Promise<void> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
    return;
  }
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await inspectDirectory(entryPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(entryPath);
      out.fileCount += 1;
      out.totalBytes += info.size;
    } catch (error) {
      out.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

export async function inspectRelayDocumentSearchCaches(
  options: RelayDocumentSearchCacheActionOptions = {},
): Promise<RelayDocumentSearchCacheStoreReport[]> {
  const reports: RelayDocumentSearchCacheStoreReport[] = [];
  for (const store of cacheStores(options)) {
    const inspected = await inspectPath(store.path);
    reports.push({
      ...store,
      ...inspected,
    });
  }
  return reports;
}

function storesForAction(action: RelayDocumentSearchCacheAction): RelayDocumentSearchCacheStoreName[] {
  switch (action) {
    case 'inspect':
      return [];
    case 'clear-derived-caches':
      return ['filenameIndex', 'derivedContentIndex', 'parsedDocumentCache'];
    case 'clear-rescan-caches':
      return ['metadataCache', 'filenameIndex', 'derivedContentIndex', 'parsedDocumentCache'];
    case 'clear-root-caches':
      return ['metadataCache', 'filenameIndex'];
    case 'remove-root-caches':
      return ['metadataCache', 'filenameIndex', 'derivedContentIndex', 'parsedDocumentCache'];
    case 'clear-metadata-cache':
      return ['metadataCache'];
    case 'clear-filename-index':
      return ['filenameIndex'];
    case 'clear-derived-content-index':
      return ['derivedContentIndex'];
    case 'clear-parsed-document-cache':
      return ['parsedDocumentCache'];
    case 'clear-job-store':
      return ['jobStore'];
    default:
      return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeToRemove(path: string, options: RelayDocumentSearchCacheActionOptions): boolean {
  if (options.allowUnsafeCacheDirForTests) return true;
  const normalized = resolve(path).replace(/\\/gu, '/').toLowerCase();
  return normalized.includes('/relay agent/document-search/') ||
    normalized.includes('/.relay-agent/document-search/');
}

function removalPathsForStore(
  action: RelayDocumentSearchCacheAction,
  store: { name: RelayDocumentSearchCacheStoreName; path: string },
  options: RelayDocumentSearchCacheActionOptions,
): string[] {
  if (action !== 'clear-root-caches' && action !== 'remove-root-caches') return [store.path];
  if (!options.root) return [];
  switch (store.name) {
    case 'metadataCache':
      return [
        relayDocumentSearchMetadataCachePathForRoot(options.root, { cacheDir: options.metadataCacheDir }),
        relayDocumentSearchMetadataCacheLockPathForRoot(options.root, { cacheDir: options.metadataCacheDir }),
      ];
    case 'filenameIndex':
      return [
        relayDocumentSearchFilenameIndexPathForRoot(options.root, { indexDir: options.filenameIndexDir }),
      ];
    case 'derivedContentIndex':
    case 'parsedDocumentCache':
      return [];
    default:
      return [];
  }
}

function normalizePathForRootMatch(path: string): string {
  const slashPath = path.replace(/\\/gu, '/').replace(/\/+/gu, '/');
  if (/^[A-Za-z]:\//u.test(slashPath)) return slashPath.toLowerCase();
  return resolve(slashPath).replace(/\\/gu, '/');
}

function pathIsWithinRoot(path: string | undefined, root: string | undefined): boolean {
  if (!path || !root) return false;
  const normalizedPath = normalizePathForRootMatch(path);
  const normalizedRoot = normalizePathForRootMatch(root);
  const rootPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootPrefix);
}

async function collectJsonFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonFiles(path, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

function cacheRecordBelongsToRoot(
  store: RelayDocumentSearchCacheStoreName,
  record: Record<string, unknown>,
  root: string | undefined,
): boolean {
  if (store === 'parsedDocumentCache') {
    if (record.schemaVersion !== 'RelayParsedDocumentCache.v1') return false;
    return pathIsWithinRoot(typeof record.root === 'string' ? record.root : undefined, root) ||
      pathIsWithinRoot(typeof record.sourcePath === 'string' ? record.sourcePath : undefined, root);
  }
  if (store === 'derivedContentIndex') {
    if (record.schemaVersion !== 'RelayDocumentSearchDerivedContentIndexCache.v1') return false;
    return pathIsWithinRoot(typeof record.sourcePath === 'string' ? record.sourcePath : undefined, root);
  }
  return false;
}

async function removeRootScopedContentCacheEntries(
  store: { name: RelayDocumentSearchCacheStoreName; path: string },
  options: RelayDocumentSearchCacheActionOptions,
  warnings: string[],
  errors: RelayDocumentSearchCacheActionResult['errors'],
  recordCancellation: () => boolean,
): Promise<number> {
  if (store.name !== 'parsedDocumentCache' && store.name !== 'derivedContentIndex') return 0;
  let removed = 0;
  for (const path of await collectJsonFiles(store.path)) {
    if (recordCancellation()) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      if (!warnings.includes(`${store.name}_unreadable_entries_preserved`)) {
        warnings.push(`${store.name}_unreadable_entries_preserved`);
      }
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (!cacheRecordBelongsToRoot(store.name, parsed, options.root)) continue;
    if (!safeToRemove(path, options)) {
      errors.push({ store: store.name, message: `Refusing to remove unsafe cache path: ${path}` });
      continue;
    }
    try {
      await rm(path, { force: true });
      await rm(`${path}.lock`, { force: true }).catch(() => undefined);
      removed += 1;
    } catch (error) {
      errors.push({
        store: store.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return removed;
}

function operationCancelled(options: RelayDocumentSearchCacheActionOptions): boolean {
  return options.signal?.aborted === true;
}

export async function runRelayDocumentSearchCacheAction(
  action: RelayDocumentSearchCacheAction,
  options: RelayDocumentSearchCacheActionOptions = {},
): Promise<RelayDocumentSearchCacheActionResult> {
  const before = await inspectRelayDocumentSearchCaches(options);
  const stores = cacheStores(options);
  const targets = new Set(storesForAction(action));
  const removedStores: RelayDocumentSearchCacheStoreName[] = [];
  const removedPathCounts: Partial<Record<RelayDocumentSearchCacheStoreName, number>> = {};
  const errors: RelayDocumentSearchCacheActionResult['errors'] = [];
  const warnings: string[] = [];
  let cancelled = false;

  if ((action === 'clear-root-caches' || action === 'remove-root-caches') && !options.root) {
    errors.push({ message: 'root_required' });
  }
  if (action === 'remove-root-caches' && options.confirmRootRemoval !== true) {
    errors.push({ message: 'root_removal_confirmation_required' });
  }

  const recordCancellation = (): boolean => {
    if (!operationCancelled(options)) return false;
    cancelled = true;
    if (!warnings.includes('operation_cancelled')) warnings.push('operation_cancelled');
    if (!errors.some((error) => error.message === 'operation_cancelled')) {
      errors.push({ message: 'operation_cancelled' });
    }
    return true;
  };

  recordCancellation();

  const blockedByValidation = errors.some((error) =>
    error.message === 'root_required' ||
    error.message === 'root_removal_confirmation_required'
  );

  for (const store of blockedByValidation ? [] : stores) {
    if (recordCancellation()) break;
    if (!targets.has(store.name)) continue;
    if (store.protected) {
      warnings.push(`${store.name}_protected`);
      continue;
    }
    if (!safeToRemove(store.path, options)) {
      errors.push({ store: store.name, message: `Refusing to remove unsafe cache path: ${store.path}` });
      continue;
    }
    let removed = false;
    if (action === 'remove-root-caches' && (store.name === 'derivedContentIndex' || store.name === 'parsedDocumentCache')) {
      const removedCount = await removeRootScopedContentCacheEntries(store, options, warnings, errors, recordCancellation);
      if (removedCount > 0) {
        removed = true;
        removedPathCounts[store.name] = removedCount;
      }
      if (removed) removedStores.push(store.name);
      continue;
    }
    for (const removalPath of removalPathsForStore(action, store, options)) {
      if (recordCancellation()) break;
      if (!safeToRemove(removalPath, options)) {
        errors.push({ store: store.name, message: `Refusing to remove unsafe cache path: ${removalPath}` });
        continue;
      }
      try {
        const existed = await pathExists(removalPath);
        await rm(removalPath, { recursive: true, force: true });
        if (existed) {
          removed = true;
          removedPathCounts[store.name] = (removedPathCounts[store.name] ?? 0) + 1;
        }
      } catch (error) {
        errors.push({
          store: store.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (removed) {
      removedStores.push(store.name);
    }
  }

  recordCancellation();
  const after = await inspectRelayDocumentSearchCaches(options);
  const preservedStores = stores
    .map((store) => store.name)
    .filter((name) => !removedStores.includes(name));
  if (action === 'clear-derived-caches') {
    warnings.push('metadata_user_memory_and_jobs_preserved');
  }
  if (action === 'clear-rescan-caches') {
    warnings.push('user_memory_and_jobs_preserved');
  }
  if (action === 'clear-root-caches') {
    warnings.push('root_metadata_and_filename_index_cleared');
    warnings.push('user_memory_jobs_and_content_caches_preserved');
  }
  if (action === 'remove-root-caches') {
    if (removedStores.length > 0) warnings.push('root_scoped_caches_removed');
    warnings.push('unrelated_roots_user_memory_jobs_and_history_preserved');
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_CACHE_ACTIONS_CONTRACT,
    action,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ok: errors.length === 0 && !cancelled,
    cancelled,
    removedStores,
    removedPathCounts,
    preservedStores,
    before,
    after,
    warnings,
    errors,
  };
}
