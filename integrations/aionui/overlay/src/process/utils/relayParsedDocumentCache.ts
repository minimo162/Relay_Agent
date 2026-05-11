/**
 * Durable ParsedDocument cache for Relay Document Search.
 *
 * This stores rebuildable parser output only. It is separate from the
 * Docufinder-style metadata cache because extracted text/IR is content-bearing
 * data and must be enabled, diagnosed, and invalidated independently.
 */

import { createHash } from 'crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, extname, join, resolve } from 'path';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';
import type {
  RelayDocumentSearchFreshnessChange,
  RelayDocumentSearchFreshnessReport,
} from './relayDocumentSearchFreshness';
import {
  RELAY_PARSED_DOCUMENT_IR_CONTRACT,
  RELAY_PARSED_DOCUMENT_IR_VERSION,
  RELAY_OFFICE_OPENXML_READER_VERSION,
  RELAY_PDF_READER_VERSION,
  RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
  RELAY_STRUCTURE_PATTERN_VERSION,
  RELAY_TEXT_READER_VERSION,
  profileForDocumentFile,
  validateRelayParsedDocument,
  type RelayParsedDocument,
} from './relayParsedDocumentIr';

export const RELAY_PARSED_DOCUMENT_CACHE_CONTRACT = 'RelayParsedDocumentCache.v1' as const;
export const RELAY_PARSED_DOCUMENT_CACHE_VERSION = 1 as const;
export const RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION = 'relay-parsed-document-cache-key-v1' as const;
export const RELAY_PARSED_DOCUMENT_CACHE_POLICY_CONTRACT = 'RelayParsedDocumentCachePolicy.v1' as const;
export const RELAY_PARSED_DOCUMENT_CACHE_MOVE_MIGRATION_CONTRACT =
  'RelayParsedDocumentCacheMoveMigration.v1' as const;
export const RELAY_PARSED_DOCUMENT_CACHE_STAGE_CONTRACT = 'RelayParsedDocumentCacheStage.v1' as const;
export const RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT =
  'RelayParsedDocumentCacheSchemaMigration.v1' as const;

export type RelayParsedDocumentCacheProtectionMode =
  | 'plaintext_allowed'
  | 'protection_required'
  | 'disabled';

export type RelayParsedDocumentCacheOptions = {
  cacheDir?: string;
  maxAgeMs?: number;
  lockStaleMs?: number;
  maxCacheBytes?: number;
  maxCacheEntries?: number;
  enforceQuota?: boolean;
  cacheProtectionMode?: RelayParsedDocumentCacheProtectionMode;
  protectedAtRest?: boolean;
  now?: Date;
  parserParametersVersion?: string;
  onQuota?: (result: RelayParsedDocumentCacheQuotaResult) => void;
  onPolicy?: (result: RelayParsedDocumentCachePolicyResult) => void;
  onMigration?: (result: RelayParsedDocumentCacheMigrationState) => void;
};

export type RelayParsedDocumentCachePolicyResult = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_POLICY_CONTRACT;
  cacheDir: string;
  mode: RelayParsedDocumentCacheProtectionMode;
  enabled: boolean;
  readAllowed: boolean;
  writeAllowed: boolean;
  protectionState: 'externally_protected' | 'unprotected_plaintext';
  reason:
    | 'plaintext_allowed'
    | 'externally_protected'
    | 'protection_required_but_unavailable'
    | 'cache_disabled';
};

export type RelayParsedDocumentCacheQuotaResult = {
  cacheDir: string;
  entryCount: number;
  totalBytes: number;
  maxCacheEntries: number;
  maxCacheBytes: number;
  quotaPressure: boolean;
  evicted: Array<{
    path: string;
    bytes: number;
    reason: 'invalid_record' | 'entry_quota' | 'byte_quota';
    generatedAt?: string;
  }>;
  errors: Array<{ path: string; message: string }>;
};

export type RelayParsedDocumentCacheRecord = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_CONTRACT;
  cacheVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_VERSION;
  cacheKeyVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION;
  cacheKey: string;
  generatedAt: string;
  root: string;
  fileId: string;
  sourcePath: string;
  sourceMetadataVersion: string;
  parsedDocumentIrVersion: typeof RELAY_PARSED_DOCUMENT_IR_VERSION;
  parserVersion: string;
  parserProfile: string;
  parserParametersVersion: string;
  parsedDocument: RelayParsedDocument;
};

export type RelayParsedDocumentCacheStage = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_STAGE_CONTRACT;
  cacheKey: string;
  activePath: string;
  stagingPath: string;
  record: RelayParsedDocumentCacheRecord;
  promote: () => Promise<RelayParsedDocumentCacheRecord>;
  discard: () => Promise<void>;
};

export type RelayParsedDocumentCacheMigrationState = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT;
  store: 'parsedDocumentCache';
  path: string;
  status: 'missing' | 'compatible' | 'read_only_downgrade' | 'rebuild_required' | 'invalid';
  expectedSchemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_CONTRACT;
  detectedSchemaVersion?: string;
  expectedCacheVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_VERSION;
  detectedCacheVersion?: number;
  expectedCacheKeyVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION;
  detectedCacheKeyVersion?: string;
  expectedParsedDocumentIrVersion: typeof RELAY_PARSED_DOCUMENT_IR_VERSION;
  detectedParsedDocumentIrVersion?: string;
  readOnly: boolean;
  rebuildRequired: boolean;
  contentBearing: true;
  warnings: string[];
  errors: string[];
};

export type RelayParsedDocumentCacheMoveMigrationReport = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_CACHE_MOVE_MIGRATION_CONTRACT;
  highConfidenceMoveCount: number;
  migratedCacheRecordCount: number;
  skippedMissingCacheCount: number;
  skippedIncompatibleMoveCount: number;
  errors: Array<{ path?: string; message: string }>;
  ai_boundary: {
    localMetadataOnly: false;
    extractedContentIncluded: true;
    originalFilesIncluded: false;
  };
};

const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 1000;
const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 10_000;
const MOVE_MIGRATION_PARSER_VERSIONS = [
  RELAY_TEXT_READER_VERSION,
  RELAY_PDF_READER_VERSION,
  RELAY_OFFICE_OPENXML_READER_VERSION,
] as const;

function defaultCacheDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'parsed-document-cache');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsedDocumentUidForCacheLineage(file: RelayDocumentSearchCachedFileMetadata): string {
  return `parsed-${createHash('sha256')
    .update(`${file.fileId}:${file.sourceMetadataVersion}`)
    .digest('hex')
    .slice(0, 8)}`;
}

function parserParametersVersion(options: RelayParsedDocumentCacheOptions): string {
  return options.parserParametersVersion || process.env.RELAY_PARSED_DOCUMENT_CACHE_PARAMETERS_VERSION || 'default';
}

function cacheDirFromOptions(options: RelayParsedDocumentCacheOptions = {}): string {
  return resolve(options.cacheDir || process.env.RELAY_PARSED_DOCUMENT_CACHE_DIR || defaultCacheDir());
}

function parsedPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function maxCacheBytes(options: RelayParsedDocumentCacheOptions): number {
  return Math.max(
    1,
    options.maxCacheBytes ??
      parsedPositiveInteger(process.env.RELAY_PARSED_DOCUMENT_CACHE_MAX_BYTES) ??
      DEFAULT_MAX_CACHE_BYTES,
  );
}

function maxCacheEntries(options: RelayParsedDocumentCacheOptions): number {
  return Math.max(
    1,
    options.maxCacheEntries ??
      parsedPositiveInteger(process.env.RELAY_PARSED_DOCUMENT_CACHE_MAX_ENTRIES) ??
      DEFAULT_MAX_CACHE_ENTRIES,
  );
}

function quotaEnforcementEnabled(options: RelayParsedDocumentCacheOptions): boolean {
  if (options.enforceQuota !== undefined) return options.enforceQuota;
  return process.env.RELAY_PARSED_DOCUMENT_CACHE_ENFORCE_QUOTA !== '0';
}

function cacheProtectionMode(options: RelayParsedDocumentCacheOptions): RelayParsedDocumentCacheProtectionMode {
  if (options.cacheProtectionMode) return options.cacheProtectionMode;
  const envMode = process.env.RELAY_PARSED_DOCUMENT_CACHE_POLICY;
  if (envMode === 'disabled' || envMode === 'protection_required' || envMode === 'plaintext_allowed') {
    return envMode;
  }
  if (process.env.RELAY_PARSED_DOCUMENT_CACHE_REQUIRE_PROTECTION === '1') return 'protection_required';
  return 'plaintext_allowed';
}

function protectedAtRest(options: RelayParsedDocumentCacheOptions): boolean {
  if (options.protectedAtRest !== undefined) return options.protectedAtRest;
  return process.env.RELAY_PARSED_DOCUMENT_CACHE_PROTECTED_AT_REST === '1';
}

export function relayParsedDocumentCachePolicy(
  options: RelayParsedDocumentCacheOptions = {},
): RelayParsedDocumentCachePolicyResult {
  const mode = cacheProtectionMode(options);
  const externallyProtected = protectedAtRest(options);
  if (mode === 'disabled') {
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_POLICY_CONTRACT,
      cacheDir: cacheDirFromOptions(options),
      mode,
      enabled: false,
      readAllowed: false,
      writeAllowed: false,
      protectionState: externallyProtected ? 'externally_protected' : 'unprotected_plaintext',
      reason: 'cache_disabled',
    };
  }
  if (mode === 'protection_required' && !externallyProtected) {
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_POLICY_CONTRACT,
      cacheDir: cacheDirFromOptions(options),
      mode,
      enabled: true,
      readAllowed: false,
      writeAllowed: false,
      protectionState: 'unprotected_plaintext',
      reason: 'protection_required_but_unavailable',
    };
  }
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_POLICY_CONTRACT,
    cacheDir: cacheDirFromOptions(options),
    mode,
    enabled: true,
    readAllowed: true,
    writeAllowed: true,
    protectionState: externallyProtected ? 'externally_protected' : 'unprotected_plaintext',
    reason: externallyProtected ? 'externally_protected' : 'plaintext_allowed',
  };
}

export function relayParsedDocumentCacheKey(
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions = {},
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      keyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      root: resolve(file.root),
      path: resolve(file.path),
      fileId: file.fileId,
      sourceMetadataVersion: file.sourceMetadataVersion,
      parsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      parserVersion,
      parserProfile: profileForDocumentFile(file),
      parserParametersVersion: parserParametersVersion(options),
      capabilityRegistryVersion: RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
      patternSetVersion: RELAY_STRUCTURE_PATTERN_VERSION,
    }))
    .digest('hex');
}

function cachePathForParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions = {},
): string {
  const cacheDir = cacheDirFromOptions(options);
  const cacheKey = relayParsedDocumentCacheKey(file, parserVersion, options);
  return join(cacheDir, `${cacheKey.slice(0, 2)}`, `${cacheKey}.json`);
}

function lockPathForParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions = {},
): string {
  return `${cachePathForParsedDocument(file, parserVersion, options)}.lock`;
}

function parsedDocumentCacheRecordForFile(
  file: RelayDocumentSearchCachedFileMetadata,
  parsedDocument: RelayParsedDocument,
  options: RelayParsedDocumentCacheOptions = {},
): { record: RelayParsedDocumentCacheRecord; cachePath: string; lockPath: string } | undefined {
  const validation = validateRelayParsedDocument(parsedDocument);
  if (!validation.ok || parsedDocument.parser_confidence === 'low') return undefined;
  if (parsedDocument.source_file_id !== file.fileId) return undefined;
  if (parsedDocument.source_metadata_version !== file.sourceMetadataVersion) return undefined;
  if (parsedDocument.source_path !== file.path) return undefined;
  if (parsedDocument.parser.profile !== profileForDocumentFile(file)) return undefined;

  const parserVersion = parsedDocument.parser.version;
  const cacheKey = relayParsedDocumentCacheKey(file, parserVersion, options);
  const cachePath = cachePathForParsedDocument(file, parserVersion, options);
  const lockPath = lockPathForParsedDocument(file, parserVersion, options);
  return {
    cachePath,
    lockPath,
    record: {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
      cacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
      cacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      cacheKey,
      generatedAt: (options.now ?? new Date()).toISOString(),
      root: resolve(file.root),
      fileId: file.fileId,
      sourcePath: resolve(file.path),
      sourceMetadataVersion: file.sourceMetadataVersion,
      parsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      parserVersion,
      parserProfile: parsedDocument.parser.profile,
      parserParametersVersion: parserParametersVersion(options),
      parsedDocument,
    },
  };
}

function parseCacheRecord(
  text: string,
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions,
): RelayParsedDocumentCacheRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const cacheKey = relayParsedDocumentCacheKey(file, parserVersion, options);
  if (parsed.schemaVersion !== RELAY_PARSED_DOCUMENT_CACHE_CONTRACT) return undefined;
  if (parsed.cacheVersion !== RELAY_PARSED_DOCUMENT_CACHE_VERSION) return undefined;
  if (parsed.cacheKeyVersion !== RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION) return undefined;
  if (parsed.cacheKey !== cacheKey) return undefined;
  if (resolve(String(parsed.root || '')) !== resolve(file.root)) return undefined;
  if (resolve(String(parsed.sourcePath || '')) !== resolve(file.path)) return undefined;
  if (parsed.fileId !== file.fileId) return undefined;
  if (parsed.sourceMetadataVersion !== file.sourceMetadataVersion) return undefined;
  if (parsed.parsedDocumentIrVersion !== RELAY_PARSED_DOCUMENT_IR_VERSION) return undefined;
  if (parsed.parserVersion !== parserVersion) return undefined;
  if (parsed.parserProfile !== profileForDocumentFile(file)) return undefined;
  if (parsed.parserParametersVersion !== parserParametersVersion(options)) return undefined;
  if (typeof parsed.generatedAt !== 'string') return undefined;

  const generatedAtMs = Date.parse(parsed.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return undefined;
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
  if (maxAgeMs >= 0 && nowMs - generatedAtMs > maxAgeMs) return undefined;

  const parsedDocument = parsed.parsedDocument;
  const validation = validateRelayParsedDocument(parsedDocument);
  if (!validation.ok) return undefined;
  if (parsedDocument.source_file_id !== file.fileId) return undefined;
  if (parsedDocument.source_metadata_version !== file.sourceMetadataVersion) return undefined;
  if (parsedDocument.source_path !== file.path) return undefined;
  if (parsedDocument.parser.version !== parserVersion) return undefined;
  if (parsedDocument.parser.profile !== parsed.parserProfile) return undefined;
  if (parsedDocument.parser_confidence === 'low') return undefined;

  return parsed as RelayParsedDocumentCacheRecord;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parsedCacheMigrationStateFromRaw(
  raw: unknown,
  cachePath: string,
): RelayParsedDocumentCacheMigrationState {
  if (!isRecord(raw)) {
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
      store: 'parsedDocumentCache',
      path: cachePath,
      status: 'invalid',
      expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
      expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
      expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      readOnly: false,
      rebuildRequired: true,
      contentBearing: true,
      warnings: ['parsed_document_cache_invalid_json_shape_rebuild_required'],
      errors: [],
    };
  }
  const detectedSchemaVersion = stringField(raw.schemaVersion);
  const detectedCacheVersion = numberField(raw.cacheVersion);
  const detectedCacheKeyVersion = stringField(raw.cacheKeyVersion);
  const detectedParsedDocumentIrVersion = stringField(raw.parsedDocumentIrVersion);
  if (
    detectedSchemaVersion === RELAY_PARSED_DOCUMENT_CACHE_CONTRACT &&
    detectedCacheVersion !== undefined &&
    detectedCacheVersion > RELAY_PARSED_DOCUMENT_CACHE_VERSION
  ) {
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
      store: 'parsedDocumentCache',
      path: cachePath,
      status: 'read_only_downgrade',
      expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
      detectedSchemaVersion,
      expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
      detectedCacheVersion,
      expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      detectedCacheKeyVersion,
      expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      detectedParsedDocumentIrVersion,
      readOnly: true,
      rebuildRequired: false,
      contentBearing: true,
      warnings: ['parsed_document_cache_newer_schema_opened_read_only'],
      errors: [],
    };
  }
  if (
    detectedSchemaVersion !== RELAY_PARSED_DOCUMENT_CACHE_CONTRACT ||
    detectedCacheVersion !== RELAY_PARSED_DOCUMENT_CACHE_VERSION ||
    detectedCacheKeyVersion !== RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION ||
    detectedParsedDocumentIrVersion !== RELAY_PARSED_DOCUMENT_IR_VERSION
  ) {
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
      store: 'parsedDocumentCache',
      path: cachePath,
      status: 'rebuild_required',
      expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
      detectedSchemaVersion,
      expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
      detectedCacheVersion,
      expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      detectedCacheKeyVersion,
      expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      detectedParsedDocumentIrVersion,
      readOnly: false,
      rebuildRequired: true,
      contentBearing: true,
      warnings: ['parsed_document_cache_schema_mismatch_rebuild_required'],
      errors: [],
    };
  }
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
    store: 'parsedDocumentCache',
    path: cachePath,
    status: 'compatible',
    expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
    detectedSchemaVersion,
    expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
    detectedCacheVersion,
    expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
    detectedCacheKeyVersion,
    expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
    detectedParsedDocumentIrVersion,
    readOnly: false,
    rebuildRequired: false,
    contentBearing: true,
    warnings: [],
    errors: [],
  };
}

export async function inspectRelayParsedDocumentCacheMigration(
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheMigrationState> {
  const cachePath = cachePathForParsedDocument(file, parserVersion, options);
  try {
    const content = await readFile(cachePath, 'utf8');
    try {
      return parsedCacheMigrationStateFromRaw(JSON.parse(content) as unknown, cachePath);
    } catch (error) {
      return {
        schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
        store: 'parsedDocumentCache',
        path: cachePath,
        status: 'invalid',
        expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
        expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
        expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
        expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
        readOnly: false,
        rebuildRequired: true,
        contentBearing: true,
        warnings: ['parsed_document_cache_invalid_json_rebuild_required'],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') {
      return {
        schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
        store: 'parsedDocumentCache',
        path: cachePath,
        status: 'missing',
        expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
        expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
        expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
        expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
        readOnly: false,
        rebuildRequired: false,
        contentBearing: true,
        warnings: [],
        errors: [],
      };
    }
    return {
      schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_SCHEMA_MIGRATION_CONTRACT,
      store: 'parsedDocumentCache',
      path: cachePath,
      status: 'invalid',
      expectedSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
      expectedCacheVersion: RELAY_PARSED_DOCUMENT_CACHE_VERSION,
      expectedCacheKeyVersion: RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
      expectedParsedDocumentIrVersion: RELAY_PARSED_DOCUMENT_IR_VERSION,
      readOnly: false,
      rebuildRequired: true,
      contentBearing: true,
      warnings: ['parsed_document_cache_migration_inspection_failed'],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function readRelayParsedDocumentCache(
  file: RelayDocumentSearchCachedFileMetadata,
  parserVersion: string,
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheRecord | undefined> {
  const policy = relayParsedDocumentCachePolicy(options);
  options.onPolicy?.(policy);
  if (!policy.readAllowed) return undefined;
  const cachePath = cachePathForParsedDocument(file, parserVersion, options);
  try {
    return parseCacheRecord(await readFile(cachePath, 'utf8'), file, parserVersion, options);
  } catch {
    return undefined;
  }
}

export async function writeRelayParsedDocumentCache(
  file: RelayDocumentSearchCachedFileMetadata,
  parsedDocument: RelayParsedDocument,
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheRecord | undefined> {
  const stage = await stageRelayParsedDocumentCache(file, parsedDocument, options);
  return stage?.promote();
}

export async function stageRelayParsedDocumentCache(
  file: RelayDocumentSearchCachedFileMetadata,
  parsedDocument: RelayParsedDocument,
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheStage | undefined> {
  const policy = relayParsedDocumentCachePolicy(options);
  options.onPolicy?.(policy);
  if (!policy.writeAllowed) return undefined;
  const prepared = parsedDocumentCacheRecordForFile(file, parsedDocument, options);
  if (!prepared) return undefined;
  const { record, cachePath, lockPath } = prepared;
  const migration = await inspectRelayParsedDocumentCacheMigration(file, parsedDocument.parser.version, options);
  options.onMigration?.(migration);
  if (migration.readOnly) return undefined;

  await mkdir(dirname(cachePath), { recursive: true });
  const lock = await acquireRelayParsedDocumentCacheLock(lockPath, options);
  const stagingPath = join(dirname(cachePath), '.staging', `${record.cacheKey}.${process.pid}.${Date.now()}.json`);
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await lock.release();
  };
  try {
    await mkdir(dirname(stagingPath), { recursive: true });
    await writeFile(stagingPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    await rm(stagingPath, { force: true }).catch(() => undefined);
    await release();
    throw error;
  }
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_STAGE_CONTRACT,
    cacheKey: record.cacheKey,
    activePath: cachePath,
    stagingPath,
    record,
    async promote() {
      try {
        await rename(stagingPath, cachePath);
        if (quotaEnforcementEnabled(options)) {
          try {
            options.onQuota?.(await enforceRelayParsedDocumentCacheQuota(options));
          } catch {
            // Quota maintenance is best-effort; a failed cleanup must not turn a
            // successful parse into a failed user search.
          }
        }
        return record;
      } finally {
        await release();
      }
    },
    async discard() {
      try {
        await rm(stagingPath, { force: true });
      } finally {
        await release();
      }
    },
  };
}

function movedFileMetadata(
  root: string,
  change: RelayDocumentSearchFreshnessChange,
  side: 'previous' | 'current',
): RelayDocumentSearchCachedFileMetadata | undefined {
  const fileId = side === 'previous' ? change.previous_file_id : change.current_file_id;
  const path = side === 'previous' ? change.previous_path : change.current_path;
  const displayPath = side === 'previous' ? change.previous_display_path : change.current_display_path;
  const size = side === 'previous' ? change.previous_size : change.current_size;
  const modifiedTime = side === 'previous' ? change.previous_modified_time : change.current_modified_time;
  const sourceMetadataVersion = side === 'previous'
    ? change.previous_source_metadata_version
    : change.current_source_metadata_version;
  if (
    !fileId ||
    !path ||
    !displayPath ||
    typeof size !== 'number' ||
    !modifiedTime ||
    !sourceMetadataVersion
  ) {
    return undefined;
  }
  return {
    fileId,
    root: resolve(root),
    path: resolve(path),
    displayPath,
    name: basename(path),
    extension: extname(path).replace(/^\./u, '').toLowerCase(),
    size,
    modifiedTime,
    sourceMetadataVersion,
  };
}

function movedFilePair(
  root: string,
  change: RelayDocumentSearchFreshnessChange,
): { previous: RelayDocumentSearchCachedFileMetadata; current: RelayDocumentSearchCachedFileMetadata } | undefined {
  if (change.reason !== 'moved' || change.move_confidence !== 'high') return undefined;
  if (change.previous_size !== change.current_size) return undefined;
  if (change.previous_modified_time !== change.current_modified_time) return undefined;
  const previous = movedFileMetadata(root, change, 'previous');
  const current = movedFileMetadata(root, change, 'current');
  if (!previous || !current) return undefined;
  if (previous.extension !== current.extension) return undefined;
  return { previous, current };
}

function rewriteParsedDocumentCacheLineage(
  parsedDocument: RelayParsedDocument,
  file: RelayDocumentSearchCachedFileMetadata,
): RelayParsedDocument {
  return {
    ...parsedDocument,
    source_file_id: file.fileId,
    source_metadata_version: file.sourceMetadataVersion,
    source_path: resolve(file.path),
    source_mtime: file.modifiedTime,
    metadata: {
      ...parsedDocument.metadata,
      uid: parsedDocumentUidForCacheLineage(file),
      file_name: file.name,
      size: file.size,
      modified_time: Date.parse(file.modifiedTime) / 1000,
    },
  };
}

export async function migrateRelayParsedDocumentCacheForHighConfidenceMoves(
  freshnessReports: RelayDocumentSearchFreshnessReport[],
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheMoveMigrationReport> {
  const moves = freshnessReports.flatMap((report) =>
    report.changes
      .map((change) => movedFilePair(report.root, change))
      .filter((pair): pair is {
        previous: RelayDocumentSearchCachedFileMetadata;
        current: RelayDocumentSearchCachedFileMetadata;
      } => Boolean(pair)),
  );
  const report: RelayParsedDocumentCacheMoveMigrationReport = {
    schemaVersion: RELAY_PARSED_DOCUMENT_CACHE_MOVE_MIGRATION_CONTRACT,
    highConfidenceMoveCount: moves.length,
    migratedCacheRecordCount: 0,
    skippedMissingCacheCount: 0,
    skippedIncompatibleMoveCount: freshnessReports.reduce(
      (count, freshnessReport) =>
        count + freshnessReport.changes.filter((change) =>
          change.reason === 'moved' &&
            change.move_confidence === 'high' &&
            !movedFilePair(freshnessReport.root, change),
        ).length,
      0,
    ),
    errors: [],
    ai_boundary: {
      localMetadataOnly: false,
      extractedContentIncluded: true,
      originalFilesIncluded: false,
    },
  };

  for (const move of moves) {
    let migratedForMove = false;
    for (const parserVersion of MOVE_MIGRATION_PARSER_VERSIONS) {
      try {
        const cached = await readRelayParsedDocumentCache(move.previous, parserVersion, options);
        if (!cached) continue;
        const rewritten = rewriteParsedDocumentCacheLineage(cached.parsedDocument, move.current);
        const written = await writeRelayParsedDocumentCache(move.current, rewritten, {
          ...options,
          enforceQuota: false,
        });
        if (written) {
          report.migratedCacheRecordCount += 1;
          migratedForMove = true;
        }
      } catch (error) {
        report.errors.push({
          path: move.previous.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!migratedForMove) report.skippedMissingCacheCount += 1;
  }

  return report;
}

export async function enforceRelayParsedDocumentCacheQuota(
  options: RelayParsedDocumentCacheOptions = {},
): Promise<RelayParsedDocumentCacheQuotaResult> {
  const cacheDir = cacheDirFromOptions(options);
  await mkdir(cacheDir, { recursive: true });
  const lockPath = join(cacheDir, '.quota.lock');
  const lock = await acquireRelayParsedDocumentCacheLock(lockPath, options);
  try {
    const entries = await listParsedDocumentCacheEntries(cacheDir);
    const evicted: RelayParsedDocumentCacheQuotaResult['evicted'] = [];
    const errors: RelayParsedDocumentCacheQuotaResult['errors'] = [];

    for (const entry of entries.filter((item) => !item.valid)) {
      try {
        await rm(entry.path, { force: true });
        evicted.push({
          path: entry.path,
          bytes: entry.bytes,
          reason: 'invalid_record',
          generatedAt: entry.generatedAt,
        });
      } catch (error) {
        errors.push({ path: entry.path, message: error instanceof Error ? error.message : String(error) });
      }
    }

    const validEntries = entries.filter((item) => item.valid && !evicted.some((eviction) => eviction.path === item.path));
    validEntries.sort((left, right) =>
      left.generatedAtMs - right.generatedAtMs ||
      left.bytes - right.bytes ||
      left.path.localeCompare(right.path),
    );

    let currentCount = validEntries.length;
    let currentBytes = validEntries.reduce((total, entry) => total + entry.bytes, 0);
    const entryLimit = maxCacheEntries(options);
    const byteLimit = maxCacheBytes(options);

    for (const entry of validEntries) {
      const overEntryLimit = currentCount > entryLimit;
      const overByteLimit = currentBytes > byteLimit;
      if (!overEntryLimit && !overByteLimit) break;
      try {
        await rm(entry.path, { force: true });
        currentCount -= 1;
        currentBytes -= entry.bytes;
        evicted.push({
          path: entry.path,
          bytes: entry.bytes,
          reason: overEntryLimit ? 'entry_quota' : 'byte_quota',
          generatedAt: entry.generatedAt,
        });
      } catch (error) {
        errors.push({ path: entry.path, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      cacheDir,
      entryCount: Math.max(0, currentCount),
      totalBytes: Math.max(0, currentBytes),
      maxCacheEntries: entryLimit,
      maxCacheBytes: byteLimit,
      quotaPressure: currentCount > entryLimit || currentBytes > byteLimit,
      evicted,
      errors,
    };
  } finally {
    await lock.release();
  }
}

async function listParsedDocumentCacheEntries(cacheDir: string): Promise<Array<{
  path: string;
  bytes: number;
  generatedAt: string;
  generatedAtMs: number;
  valid: boolean;
}>> {
  const out: Array<{ path: string; bytes: number; generatedAt: string; generatedAtMs: number; valid: boolean }> = [];
  await collectParsedDocumentCacheEntries(cacheDir, out);
  return out;
}

async function collectParsedDocumentCacheEntries(
  dir: string,
  out: Array<{ path: string; bytes: number; generatedAt: string; generatedAtMs: number; valid: boolean }>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectParsedDocumentCacheEntries(fullPath, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    let bytes = 0;
    try {
      bytes = (await stat(fullPath)).size;
      const parsed = JSON.parse(await readFile(fullPath, 'utf8'));
      const generatedAt = isRecord(parsed) && typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '';
      const generatedAtMs = Date.parse(generatedAt);
      out.push({
        path: fullPath,
        bytes,
        generatedAt,
        generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : 0,
        valid: isRecord(parsed) &&
          parsed.schemaVersion === RELAY_PARSED_DOCUMENT_CACHE_CONTRACT &&
          parsed.cacheVersion === RELAY_PARSED_DOCUMENT_CACHE_VERSION &&
          parsed.cacheKeyVersion === RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION &&
          typeof parsed.cacheKey === 'string' &&
          Number.isFinite(generatedAtMs),
      });
    } catch {
      out.push({ path: fullPath, bytes, generatedAt: '', generatedAtMs: 0, valid: false });
    }
  }
}

async function acquireRelayParsedDocumentCacheLock(
  lockPath: string,
  options: RelayParsedDocumentCacheOptions,
): Promise<{ release: () => Promise<void> }> {
  const now = options.now ?? new Date();
  const staleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 'RelayParsedDocumentCacheLock.v1',
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
    const current = await readParsedDocumentCacheLock(lockPath);
    if (current && now.getTime() - current.createdAtMs > staleMs) {
      await rm(lockPath, { force: true });
      return acquireRelayParsedDocumentCacheLock(lockPath, options);
    }
    throw new Error(`Relay ParsedDocument cache is locked: ${lockPath}`);
  }
}

async function readParsedDocumentCacheLock(lockPath: string): Promise<{ createdAtMs: number } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!isRecord(parsed) || typeof parsed.createdAt !== 'string') return undefined;
    const createdAtMs = Date.parse(parsed.createdAt);
    return Number.isFinite(createdAtMs) ? { createdAtMs } : undefined;
  } catch {
    return undefined;
  }
}
