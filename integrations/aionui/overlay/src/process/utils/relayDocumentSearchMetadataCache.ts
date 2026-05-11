/**
 * Durable metadata cache for Relay Document Search.
 *
 * This is Docufinder-style discovery state only: path/name/type/size/mtime.
 * It deliberately does not store extracted document text, ParsedDocument IR,
 * previews, embeddings, or Office/PDF contents.
 */

import { createHash } from 'crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export const RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT = 'RelayDocumentSearchMetadataCache.v1' as const;
export const RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION = 1 as const;
export const RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT =
  'RelayDocumentSearchMetadataCacheMigration.v1' as const;

export type RelayDocumentSearchAccessAction = 'metadata' | 'content' | 'preview' | 'open';
export type RelayDocumentSearchAccessState =
  | 'ok'
  | 'access_denied'
  | 'not_found'
  | 'offline_share'
  | 'locked_file'
  | 'policy_denied'
  | 'unknown';

export type RelayDocumentSearchAccessSnapshot = {
  action: RelayDocumentSearchAccessAction;
  state: RelayDocumentSearchAccessState;
  checkedAt: string;
  warningCode?: string;
  message?: string;
};

export type RelayDocumentSearchAccessSnapshots = Partial<
  Record<RelayDocumentSearchAccessAction, RelayDocumentSearchAccessSnapshot>
>;

export type RelayDocumentSearchCachedFileMetadata = {
  fileId: string;
  root: string;
  path: string;
  displayPath: string;
  name: string;
  extension: string;
  size: number;
  modifiedTime: string;
  sourceMetadataVersion: string;
  accessSnapshots?: RelayDocumentSearchAccessSnapshots;
};

export type RelayDocumentSearchMetadataCacheRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT;
  cacheVersion: typeof RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION;
  root: string;
  generatedAt: string;
  files: RelayDocumentSearchCachedFileMetadata[];
  stats: {
    fileCount: number;
    truncated: boolean;
    inaccessiblePathCount: number;
  };
};

export type RelayDocumentSearchMetadataCacheOptions = {
  cacheDir?: string;
  maxAgeMs?: number;
  lockStaleMs?: number;
  now?: Date;
};

export type RelayDocumentSearchMetadataCacheMigrationState = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT;
  store: 'metadataCache';
  path: string;
  status: 'missing' | 'compatible' | 'read_only_downgrade' | 'rebuild_required' | 'invalid';
  expectedSchemaVersion: typeof RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT;
  detectedSchemaVersion?: string;
  expectedCacheVersion: typeof RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION;
  detectedCacheVersion?: number;
  readOnly: boolean;
  rebuildRequired: boolean;
  durableDataPreserved: boolean;
  warnings: string[];
  errors: string[];
};

const DEFAULT_MAX_CACHE_AGE_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 1000;

function defaultCacheDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'metadata-cache');
}

export function relayDocumentSearchMetadataCachePathForRoot(
  root: string,
  options: RelayDocumentSearchMetadataCacheOptions = {},
): string {
  const normalizedRoot = resolve(root);
  const cacheDir = options.cacheDir || process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR || defaultCacheDir();
  const hash = createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 24);
  return join(cacheDir, `${hash}.json`);
}

export function relayDocumentSearchMetadataCacheLockPathForRoot(
  root: string,
  options: RelayDocumentSearchMetadataCacheOptions = {},
): string {
  return `${relayDocumentSearchMetadataCachePathForRoot(root, options)}.lock`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ACCESS_ACTIONS: readonly RelayDocumentSearchAccessAction[] = ['metadata', 'content', 'preview', 'open'];
const ACCESS_STATES: readonly RelayDocumentSearchAccessState[] = [
  'ok',
  'access_denied',
  'not_found',
  'offline_share',
  'locked_file',
  'policy_denied',
  'unknown',
];

function isAccessSnapshot(value: unknown, action: RelayDocumentSearchAccessAction): value is RelayDocumentSearchAccessSnapshot {
  return (
    isRecord(value) &&
    value.action === action &&
    typeof value.checkedAt === 'string' &&
    typeof value.state === 'string' &&
    ACCESS_STATES.includes(value.state as RelayDocumentSearchAccessState) &&
    (value.warningCode === undefined || typeof value.warningCode === 'string') &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

function isAccessSnapshots(value: unknown): value is RelayDocumentSearchAccessSnapshots {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return ACCESS_ACTIONS.every((action) =>
    value[action] === undefined || isAccessSnapshot(value[action], action),
  );
}

function isCachedFileMetadata(value: unknown): value is RelayDocumentSearchCachedFileMetadata {
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
    isAccessSnapshots(value.accessSnapshots)
  );
}

function parseCacheRecord(
  text: string,
  root: string,
  options: RelayDocumentSearchMetadataCacheOptions,
): RelayDocumentSearchMetadataCacheRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.schemaVersion !== RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT) return undefined;
  if (parsed.cacheVersion !== RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION) return undefined;
  if (resolve(String(parsed.root || '')) !== resolve(root)) return undefined;
  if (typeof parsed.generatedAt !== 'string') return undefined;
  if (!Array.isArray(parsed.files) || !parsed.files.every(isCachedFileMetadata)) return undefined;

  const generatedAtMs = Date.parse(parsed.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return undefined;
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
  if (maxAgeMs >= 0 && nowMs - generatedAtMs > maxAgeMs) return undefined;

  return parsed as RelayDocumentSearchMetadataCacheRecord;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function migrationStateFromRawCache(
  raw: unknown,
  cachePath: string,
): RelayDocumentSearchMetadataCacheMigrationState {
  if (!isRecord(raw)) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
      store: 'metadataCache',
      path: cachePath,
      status: 'invalid',
      expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
      expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
      readOnly: false,
      rebuildRequired: true,
      durableDataPreserved: true,
      warnings: ['metadata_cache_invalid_json_shape_rebuild_required'],
      errors: [],
    };
  }
  const detectedSchemaVersion = stringField(raw.schemaVersion);
  const detectedCacheVersion = numberField(raw.cacheVersion);
  if (
    detectedSchemaVersion === RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT &&
    detectedCacheVersion !== undefined &&
    detectedCacheVersion > RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION
  ) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
      store: 'metadataCache',
      path: cachePath,
      status: 'read_only_downgrade',
      expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
      detectedSchemaVersion,
      expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
      detectedCacheVersion,
      readOnly: true,
      rebuildRequired: false,
      durableDataPreserved: true,
      warnings: ['metadata_cache_newer_schema_opened_read_only'],
      errors: [],
    };
  }
  if (
    detectedSchemaVersion !== RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT ||
    detectedCacheVersion !== RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION
  ) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
      store: 'metadataCache',
      path: cachePath,
      status: 'rebuild_required',
      expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
      detectedSchemaVersion,
      expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
      detectedCacheVersion,
      readOnly: false,
      rebuildRequired: true,
      durableDataPreserved: true,
      warnings: ['metadata_cache_schema_mismatch_rebuild_required'],
      errors: [],
    };
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
    store: 'metadataCache',
    path: cachePath,
    status: 'compatible',
    expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
    detectedSchemaVersion,
    expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
    detectedCacheVersion,
    readOnly: false,
    rebuildRequired: false,
    durableDataPreserved: true,
    warnings: [],
    errors: [],
  };
}

export async function inspectRelayDocumentSearchMetadataCacheMigration(
  root: string,
  options: RelayDocumentSearchMetadataCacheOptions = {},
): Promise<RelayDocumentSearchMetadataCacheMigrationState> {
  const cachePath = relayDocumentSearchMetadataCachePathForRoot(root, options);
  try {
    const content = await readFile(cachePath, 'utf8');
    try {
      return migrationStateFromRawCache(JSON.parse(content) as unknown, cachePath);
    } catch (error) {
      return {
        schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
        store: 'metadataCache',
        path: cachePath,
        status: 'invalid',
        expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
        expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
        readOnly: false,
        rebuildRequired: true,
        durableDataPreserved: true,
        warnings: ['metadata_cache_invalid_json_rebuild_required'],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') {
      return {
        schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
        store: 'metadataCache',
        path: cachePath,
        status: 'missing',
        expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
        expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
        readOnly: false,
        rebuildRequired: false,
        durableDataPreserved: true,
        warnings: [],
        errors: [],
      };
    }
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_MIGRATION_CONTRACT,
      store: 'metadataCache',
      path: cachePath,
      status: 'invalid',
      expectedSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
      expectedCacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
      readOnly: false,
      rebuildRequired: true,
      durableDataPreserved: true,
      warnings: ['metadata_cache_migration_inspection_failed'],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function readRelayDocumentSearchMetadataCache(
  root: string,
  options: RelayDocumentSearchMetadataCacheOptions = {},
): Promise<RelayDocumentSearchMetadataCacheRecord | undefined> {
  const cachePath = relayDocumentSearchMetadataCachePathForRoot(root, options);
  try {
    return parseCacheRecord(await readFile(cachePath, 'utf8'), root, options);
  } catch {
    return undefined;
  }
}

export async function writeRelayDocumentSearchMetadataCache(
  root: string,
  files: RelayDocumentSearchCachedFileMetadata[],
  stats: { truncated: boolean; inaccessiblePathCount: number },
  options: RelayDocumentSearchMetadataCacheOptions = {},
): Promise<RelayDocumentSearchMetadataCacheRecord> {
  const cachePath = relayDocumentSearchMetadataCachePathForRoot(root, options);
  const lockPath = relayDocumentSearchMetadataCacheLockPathForRoot(root, options);
  const migration = await inspectRelayDocumentSearchMetadataCacheMigration(root, options);
  if (migration.readOnly) {
    throw new Error('metadata_cache_read_only_downgrade');
  }
  const record: RelayDocumentSearchMetadataCacheRecord = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
    cacheVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
    root: resolve(root),
    generatedAt: (options.now ?? new Date()).toISOString(),
    files,
    stats: {
      fileCount: files.length,
      truncated: stats.truncated,
      inaccessiblePathCount: stats.inaccessiblePathCount,
    },
  };
  await mkdir(dirname(cachePath), { recursive: true });
  const lock = await acquireRelayDocumentSearchMetadataCacheLock(lockPath, options);
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(record)}\n`, 'utf8');
    await rename(tempPath, cachePath);
    return record;
  } finally {
    await lock.release();
  }
}

async function acquireRelayDocumentSearchMetadataCacheLock(
  lockPath: string,
  options: RelayDocumentSearchMetadataCacheOptions,
): Promise<{ release: () => Promise<void> }> {
  const now = options.now ?? new Date();
  const staleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 'RelayDocumentSearchMetadataCacheLock.v1',
        pid: process.pid,
        createdAt: now.toISOString(),
      }),
      'utf8',
    );
    await handle.close();
    return {
      release: () => rm(lockPath, { force: true }),
    };
  } catch {
    const current = await readMetadataCacheLock(lockPath);
    if (current && now.getTime() - current.createdAtMs > staleMs) {
      await rm(lockPath, { force: true });
      return acquireRelayDocumentSearchMetadataCacheLock(lockPath, options);
    }
    throw new Error(`Relay document search metadata cache is locked: ${lockPath}`);
  }
}

async function readMetadataCacheLock(lockPath: string): Promise<{ createdAtMs: number } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!isRecord(parsed) || typeof parsed.createdAt !== 'string') return undefined;
    const createdAtMs = Date.parse(parsed.createdAt);
    return Number.isFinite(createdAtMs) ? { createdAtMs } : undefined;
  } catch {
    return undefined;
  }
}
