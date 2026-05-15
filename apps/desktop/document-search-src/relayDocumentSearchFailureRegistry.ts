/**
 * Metadata-only failure registry for Relay Document Search.
 *
 * This records per-file indexing failures for local retry planning. It never
 * stores extracted document text, snippets, previews, embeddings, or original
 * file bytes.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve, sep } from 'path';

export const RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_CONTRACT =
  'RelayDocumentSearchFailureRegistry.v1' as const;
export const RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_PLAN_CONTRACT =
  'RelayDocumentSearchFailedFileRetryPlan.v1' as const;
export const RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_EXECUTION_CONTRACT =
  'RelayDocumentSearchFailedFileRetryExecution.v1' as const;
export const RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_VERSION = 1 as const;

export type RelayDocumentSearchFailureKind =
  | 'metadata'
  | 'content'
  | 'parser'
  | 'index'
  | 'access'
  | 'unknown';

export type RelayDocumentSearchFailureInput = {
  root: string;
  path?: string;
  displayPath?: string;
  fileId?: string;
  kind?: RelayDocumentSearchFailureKind;
  code: string;
  message?: string;
  source?: string;
};

export type RelayDocumentSearchFailureRecord = {
  failureId: string;
  root: string;
  path?: string;
  pathHash?: string;
  displayPath?: string;
  fileId?: string;
  kind: RelayDocumentSearchFailureKind;
  code: string;
  message?: string;
  source?: string;
  firstFailedAt: string;
  lastFailedAt: string;
  attemptCount: number;
  retryRequestedCount: number;
  lastRetryRequestedAt?: string;
};

export type RelayDocumentSearchFailureRegistryRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_CONTRACT;
  registryVersion: typeof RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_VERSION;
  generatedAt: string;
  maxEntries: number;
  failures: RelayDocumentSearchFailureRecord[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchFailedFileRetryCandidate = {
  failureId: string;
  root: string;
  path?: string;
  pathHash?: string;
  displayPath?: string;
  fileId?: string;
  kind: RelayDocumentSearchFailureKind;
  code: string;
  firstFailedAt: string;
  lastFailedAt: string;
  attemptCount: number;
  retryRequestedCount: number;
};

export type RelayDocumentSearchFailedFileRetryPlan = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_PLAN_CONTRACT;
  generatedAt: string;
  root?: string;
  failedFileCount: number;
  selectedFailureCount: number;
  maxFailures: number;
  selectedFailures: RelayDocumentSearchFailedFileRetryCandidate[];
  warnings: string[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchFailedFileRetryExecution = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_EXECUTION_CONTRACT;
  generatedAt: string;
  targetFailureCount: number;
  invalidatedParsedDocumentCacheCount: number;
  invalidatedDerivedContentIndexCount: number;
  skippedMissingIdentityCount: number;
  warnings: string[];
  errors: string[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchFailureRegistryOptions = {
  failureRegistryDir?: string;
  failureRegistryMaxEntries?: number;
  now?: Date;
};

export type RelayDocumentSearchFailedFileRetryOptions = RelayDocumentSearchFailureRegistryOptions & {
  root?: string;
  maxFailures?: number;
};

export type RelayDocumentSearchFailedFileRetryExecutionOptions = {
  parsedDocumentCacheDir?: string;
  derivedContentIndexDir?: string;
  allowUnsafeCacheDirForTests?: boolean;
  signal?: AbortSignal;
  now?: Date;
};

const FAILURE_REGISTRY_DIR_ENV = 'RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_DIR';
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_RETRY_LIMIT = 100;
const REGISTRY_FILE = 'failure-registry.json';

function defaultFailureRegistryDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'failure-registry');
}

function defaultDocumentSearchDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search');
}

function parsedDocumentCacheDir(options: RelayDocumentSearchFailedFileRetryExecutionOptions): string {
  return resolve(
    options.parsedDocumentCacheDir ||
    process.env.RELAY_PARSED_DOCUMENT_CACHE_DIR ||
    join(defaultDocumentSearchDir(), 'parsed-document-cache'),
  );
}

function derivedContentIndexDir(options: RelayDocumentSearchFailedFileRetryExecutionOptions): string {
  return resolve(
    options.derivedContentIndexDir ||
    process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR ||
    join(defaultDocumentSearchDir(), 'derived-content-index'),
  );
}

export function relayDocumentSearchFailureRegistryDir(
  options: RelayDocumentSearchFailureRegistryOptions = {},
): string {
  return resolve(
    options.failureRegistryDir ||
    process.env[FAILURE_REGISTRY_DIR_ENV] ||
    defaultFailureRegistryDir(),
  );
}

export function relayDocumentSearchFailureRegistryPath(
  options: RelayDocumentSearchFailureRegistryOptions = {},
): string {
  return join(relayDocumentSearchFailureRegistryDir(options), REGISTRY_FILE);
}

function maxEntries(options: RelayDocumentSearchFailureRegistryOptions): number {
  return Math.max(1, Math.min(options.failureRegistryMaxEntries ?? DEFAULT_MAX_ENTRIES, 10000));
}

function maxFailures(options: RelayDocumentSearchFailedFileRetryOptions): number {
  return Math.max(1, Math.min(options.maxFailures ?? DEFAULT_RETRY_LIMIT, 1000));
}

function generatedAt(options: RelayDocumentSearchFailureRegistryOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function normalizeOptionalString(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, limit) : undefined;
}

function pathHash(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 24);
}

function isInsideRoot(root: string, path: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(
    normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`,
  );
}

function safeToRemove(path: string, options: RelayDocumentSearchFailedFileRetryExecutionOptions): boolean {
  if (options.allowUnsafeCacheDirForTests) return true;
  const normalized = resolve(path).replace(/\\/gu, '/').toLowerCase();
  return normalized.includes('/relay agent/document-search/') ||
    normalized.includes('/.relay-agent/document-search/');
}

function stableFailureId(input: {
  root: string;
  pathHash?: string;
  fileId?: string;
  kind: RelayDocumentSearchFailureKind;
  code: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      resolve(input.root),
      input.fileId,
      input.pathHash,
      input.kind,
      input.code,
    ]))
    .digest('hex')
    .slice(0, 24);
}

function emptyRegistry(
  options: RelayDocumentSearchFailureRegistryOptions,
): RelayDocumentSearchFailureRegistryRecord {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_CONTRACT,
    registryVersion: RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_VERSION,
    generatedAt: generatedAt(options),
    maxEntries: maxEntries(options),
    failures: [],
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFailureKind(value: unknown): value is RelayDocumentSearchFailureKind {
  return value === 'metadata' ||
    value === 'content' ||
    value === 'parser' ||
    value === 'index' ||
    value === 'access' ||
    value === 'unknown';
}

function isFailureRecord(value: unknown): value is RelayDocumentSearchFailureRecord {
  if (!isRecord(value)) return false;
  return typeof value.failureId === 'string' &&
    typeof value.root === 'string' &&
    isFailureKind(value.kind) &&
    typeof value.code === 'string' &&
    typeof value.firstFailedAt === 'string' &&
    typeof value.lastFailedAt === 'string' &&
    typeof value.attemptCount === 'number' &&
    Number.isFinite(value.attemptCount) &&
    typeof value.retryRequestedCount === 'number' &&
    Number.isFinite(value.retryRequestedCount);
}

function normalizeFailureRecord(record: RelayDocumentSearchFailureRecord): RelayDocumentSearchFailureRecord {
  return {
    failureId: record.failureId,
    root: resolve(record.root),
    path: record.path ? resolve(record.path) : undefined,
    pathHash: record.pathHash,
    displayPath: normalizeOptionalString(record.displayPath, 240),
    fileId: normalizeOptionalString(record.fileId, 160),
    kind: record.kind,
    code: normalizeOptionalString(record.code, 120) ?? 'unknown',
    message: normalizeOptionalString(record.message, 240),
    source: normalizeOptionalString(record.source, 120),
    firstFailedAt: record.firstFailedAt,
    lastFailedAt: record.lastFailedAt,
    attemptCount: Math.max(1, Math.floor(record.attemptCount)),
    retryRequestedCount: Math.max(0, Math.floor(record.retryRequestedCount)),
    lastRetryRequestedAt: normalizeOptionalString(record.lastRetryRequestedAt, 64),
  };
}

function parseRegistry(
  value: unknown,
  options: RelayDocumentSearchFailureRegistryOptions,
): RelayDocumentSearchFailureRegistryRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_CONTRACT) return undefined;
  if (value.registryVersion !== RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_VERSION) return undefined;
  if (!Array.isArray(value.failures) || !value.failures.every(isFailureRecord)) return undefined;
  return {
    ...emptyRegistry(options),
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : generatedAt(options),
    failures: value.failures
      .map(normalizeFailureRecord)
      .sort((a, b) => a.lastFailedAt.localeCompare(b.lastFailedAt))
      .slice(-maxEntries(options)),
  };
}

async function writeRegistry(
  registry: RelayDocumentSearchFailureRegistryRecord,
  options: RelayDocumentSearchFailureRegistryOptions,
): Promise<void> {
  const path = relayDocumentSearchFailureRegistryPath(options);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function readRelayDocumentSearchFailureRegistry(
  options: RelayDocumentSearchFailureRegistryOptions = {},
): Promise<RelayDocumentSearchFailureRegistryRecord> {
  try {
    const parsed = JSON.parse(await readFile(relayDocumentSearchFailureRegistryPath(options), 'utf8')) as unknown;
    return parseRegistry(parsed, options) ?? emptyRegistry(options);
  } catch {
    return emptyRegistry(options);
  }
}

export async function recordRelayDocumentSearchFailure(
  input: RelayDocumentSearchFailureInput,
  options: RelayDocumentSearchFailureRegistryOptions = {},
): Promise<RelayDocumentSearchFailureRegistryRecord> {
  const now = generatedAt(options);
  const root = resolve(input.root);
  const resolvedPath = input.path ? resolve(input.path) : undefined;
  const normalizedPathHash = resolvedPath ? pathHash(resolvedPath) : undefined;
  const kind = input.kind ?? 'unknown';
  const code = normalizeOptionalString(input.code, 120) ?? 'unknown';
  const fileId = normalizeOptionalString(input.fileId, 160);
  const failureId = stableFailureId({
    root,
    pathHash: normalizedPathHash,
    fileId,
    kind,
    code,
  });
  const registry = await readRelayDocumentSearchFailureRegistry(options);
  const failures = registry.failures.filter((failure) => failure.failureId !== failureId);
  const existing = registry.failures.find((failure) => failure.failureId === failureId);
  const nextFailure: RelayDocumentSearchFailureRecord = {
    failureId,
    root,
    path: resolvedPath,
    pathHash: normalizedPathHash,
    displayPath: normalizeOptionalString(input.displayPath, 240),
    fileId,
    kind,
    code,
    message: normalizeOptionalString(input.message, 240),
    source: normalizeOptionalString(input.source, 120),
    firstFailedAt: existing?.firstFailedAt ?? now,
    lastFailedAt: now,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    retryRequestedCount: existing?.retryRequestedCount ?? 0,
    lastRetryRequestedAt: existing?.lastRetryRequestedAt,
  };
  const next: RelayDocumentSearchFailureRegistryRecord = {
    ...emptyRegistry(options),
    generatedAt: now,
    failures: [...failures, nextFailure]
      .sort((a, b) => a.lastFailedAt.localeCompare(b.lastFailedAt))
      .slice(-maxEntries(options)),
  };
  await writeRegistry(next, options);
  return next;
}

function retryCandidate(
  failure: RelayDocumentSearchFailureRecord,
): RelayDocumentSearchFailedFileRetryCandidate {
  return {
    failureId: failure.failureId,
    root: failure.root,
    path: failure.path,
    pathHash: failure.pathHash,
    displayPath: failure.displayPath,
    fileId: failure.fileId,
    kind: failure.kind,
    code: failure.code,
    firstFailedAt: failure.firstFailedAt,
    lastFailedAt: failure.lastFailedAt,
    attemptCount: failure.attemptCount,
    retryRequestedCount: failure.retryRequestedCount,
  };
}

export async function requestRelayDocumentSearchFailedFileRetries(
  options: RelayDocumentSearchFailedFileRetryOptions = {},
): Promise<RelayDocumentSearchFailedFileRetryPlan> {
  const registry = await readRelayDocumentSearchFailureRegistry(options);
  const now = generatedAt(options);
  const root = options.root ? resolve(options.root) : undefined;
  const candidates = registry.failures
    .filter((failure) => !root || failure.root === root)
    .sort((a, b) => a.lastFailedAt.localeCompare(b.lastFailedAt));
  const limit = maxFailures(options);
  const selected = candidates.slice(0, limit);
  if (selected.length) {
    const selectedIds = new Set(selected.map((failure) => failure.failureId));
    const next: RelayDocumentSearchFailureRegistryRecord = {
      ...registry,
      generatedAt: now,
      failures: registry.failures.map((failure) => selectedIds.has(failure.failureId)
        ? {
            ...failure,
            retryRequestedCount: failure.retryRequestedCount + 1,
            lastRetryRequestedAt: now,
          }
        : failure),
    };
    await writeRegistry(next, options);
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_PLAN_CONTRACT,
    generatedAt: now,
    root,
    failedFileCount: candidates.length,
    selectedFailureCount: selected.length,
    maxFailures: limit,
    selectedFailures: selected.map(retryCandidate),
    warnings: selected.length ? [] : ['failed_file_registry_empty'],
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}

function candidateHasIdentity(candidate: RelayDocumentSearchFailedFileRetryCandidate): boolean {
  return Boolean(candidate.fileId || candidate.path || candidate.pathHash);
}

function rootMatchesCandidate(
  candidate: RelayDocumentSearchFailedFileRetryCandidate,
  sourcePath?: string,
  root?: string,
): boolean {
  if (root && resolve(root) === resolve(candidate.root)) return true;
  return Boolean(sourcePath && isInsideRoot(candidate.root, sourcePath));
}

function candidateMatchesSource(
  candidate: RelayDocumentSearchFailedFileRetryCandidate,
  source: { fileId?: string; sourcePath?: string; root?: string },
): boolean {
  if (!candidateHasIdentity(candidate)) return false;
  if (!rootMatchesCandidate(candidate, source.sourcePath, source.root)) return false;
  if (candidate.fileId && source.fileId === candidate.fileId) return true;
  if (candidate.path && source.sourcePath && resolve(source.sourcePath) === resolve(candidate.path)) return true;
  if (candidate.pathHash && source.sourcePath && pathHash(source.sourcePath) === candidate.pathHash) return true;
  return false;
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

async function invalidateCacheRecords(
  dir: string,
  candidates: RelayDocumentSearchFailedFileRetryCandidate[],
  options: RelayDocumentSearchFailedFileRetryExecutionOptions,
  sourceFromRecord: (record: Record<string, unknown>) => { fileId?: string; sourcePath?: string; root?: string } | undefined,
): Promise<{ removed: number; errors: string[] }> {
  let removed = 0;
  const errors: string[] = [];
  for (const path of await collectJsonFiles(dir)) {
    if (options.signal?.aborted) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const source = sourceFromRecord(parsed);
    if (!source) continue;
    if (!candidates.some((candidate) => candidateMatchesSource(candidate, source))) continue;
    if (!safeToRemove(path, options)) {
      errors.push('unsafe_cache_path');
      continue;
    }
    try {
      await rm(path, { force: true });
      await rm(`${path}.lock`, { force: true }).catch(() => undefined);
      removed += 1;
    } catch {
      errors.push('cache_record_remove_failed');
    }
  }
  return { removed, errors };
}

function parsedDocumentCacheSource(record: Record<string, unknown>): { fileId?: string; sourcePath?: string; root?: string } | undefined {
  if (record.schemaVersion !== 'RelayParsedDocumentCache.v1') return undefined;
  return {
    fileId: typeof record.fileId === 'string' ? record.fileId : undefined,
    sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : undefined,
    root: typeof record.root === 'string' ? record.root : undefined,
  };
}

function derivedContentIndexCacheSource(record: Record<string, unknown>): { fileId?: string; sourcePath?: string; root?: string } | undefined {
  if (record.schemaVersion !== 'RelayDocumentSearchDerivedContentIndexCache.v1') return undefined;
  return {
    fileId: typeof record.sourceFileId === 'string' ? record.sourceFileId : undefined,
    sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : undefined,
  };
}

export async function executeRelayDocumentSearchFailedFileRetries(
  plan: RelayDocumentSearchFailedFileRetryPlan,
  options: RelayDocumentSearchFailedFileRetryExecutionOptions = {},
): Promise<RelayDocumentSearchFailedFileRetryExecution> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const candidates = plan.selectedFailures;
  const skippedMissingIdentityCount = candidates.filter((candidate) => !candidateHasIdentity(candidate)).length;
  if (skippedMissingIdentityCount > 0) warnings.push('failed_file_retry_candidate_missing_file_identity');
  if (options.signal?.aborted) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_EXECUTION_CONTRACT,
      generatedAt: (options.now ?? new Date()).toISOString(),
      targetFailureCount: candidates.length,
      invalidatedParsedDocumentCacheCount: 0,
      invalidatedDerivedContentIndexCount: 0,
      skippedMissingIdentityCount,
      warnings: [...warnings, 'operation_cancelled'],
      errors: ['operation_cancelled'],
      ai_boundary: {
        localMetadataOnly: true,
        extractedContentIncluded: false,
        originalFilesIncluded: false,
      },
    };
  }
  const parsed = await invalidateCacheRecords(
    parsedDocumentCacheDir(options),
    candidates,
    options,
    parsedDocumentCacheSource,
  );
  const derived = options.signal?.aborted
    ? { removed: 0, errors: ['operation_cancelled'] }
    : await invalidateCacheRecords(
        derivedContentIndexDir(options),
        candidates,
        options,
        derivedContentIndexCacheSource,
      );
  errors.push(...parsed.errors, ...derived.errors);
  if (options.signal?.aborted && !errors.includes('operation_cancelled')) errors.push('operation_cancelled');
  if (options.signal?.aborted) warnings.push('operation_cancelled');
  if (parsed.removed > 0 || derived.removed > 0) warnings.push('failed_file_retry_content_caches_invalidated');
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FAILED_FILE_RETRY_EXECUTION_CONTRACT,
    generatedAt: (options.now ?? new Date()).toISOString(),
    targetFailureCount: candidates.length,
    invalidatedParsedDocumentCacheCount: parsed.removed,
    invalidatedDerivedContentIndexCount: derived.removed,
    skippedMissingIdentityCount,
    warnings,
    errors,
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}
