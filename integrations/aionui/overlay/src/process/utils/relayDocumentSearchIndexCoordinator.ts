import { createHash, randomUUID } from 'crypto';
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export const RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_CONTRACT = 'RelayDocumentSearchIndexCoordinator.v1';
export const RELAY_DOCUMENT_SEARCH_INDEX_LOCK_CONTRACT = 'RelayDocumentSearchIndexLock.v1';
export const RELAY_DOCUMENT_SEARCH_INDEX_HEALTH_EVENT_CONTRACT = 'RelayDocumentSearchIndexHealthEvent.v1';
export const RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_ACTIVE_POINTER_CONTRACT =
  'RelayDocumentSearchContentIndexActivePointer.v1';
export const RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT =
  'RelayDocumentSearchContentIndexCommit.v1';

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;
const COORDINATOR_DIR_ENV = 'RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_DIR';

export type RelayDocumentSearchIndexHealthEventKind =
  | 'lock_acquired'
  | 'lock_released'
  | 'stale_lock_recovered'
  | 'lock_busy'
  | 'job_started'
  | 'job_finished'
  | 'job_abandoned'
  | 'content_index_committed'
  | 'content_index_commit_failed'
  | 'maintenance_completed'
  | 'maintenance_failed';

export type RelayDocumentSearchIndexLockSnapshot = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_LOCK_CONTRACT;
  ownerId: string;
  pid: number;
  appVersion?: string;
  acquiredAt: string;
  heartbeatAt: string;
  activeJobIds: string[];
};

export type RelayDocumentSearchIndexHealthEvent = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_HEALTH_EVENT_CONTRACT;
  eventId: string;
  kind: RelayDocumentSearchIndexHealthEventKind;
  createdAt: string;
  ownerId: string;
  pid: number;
  jobId?: string;
  details?: Record<string, unknown>;
};

export type RelayDocumentSearchContentIndexPointerState = 'active' | 'stale';

export type RelayDocumentSearchContentIndexActivePointer = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_ACTIVE_POINTER_CONTRACT;
  state: RelayDocumentSearchContentIndexPointerState;
  sourceFileId: string;
  sourcePath: string;
  sourceMetadataVersion: string;
  parsedDocumentUid: string;
  parsedDocumentVersion: string;
  parserVersion: string;
  parsedCacheKey?: string;
  derivedCacheKey?: string;
  searchStoreRowCount: number;
  ftsRowCount: number;
  previewSpanCount: number;
  committedAt: string;
  staleAt?: string;
  previous?: RelayDocumentSearchContentIndexPointerSummary;
  lastFailure?: {
    failedAt: string;
    reason: string;
    message?: string;
  };
};

export type RelayDocumentSearchContentIndexPointerSummary = Pick<
  RelayDocumentSearchContentIndexActivePointer,
  | 'state'
  | 'sourceMetadataVersion'
  | 'parsedDocumentUid'
  | 'parsedDocumentVersion'
  | 'parserVersion'
  | 'parsedCacheKey'
  | 'derivedCacheKey'
  | 'committedAt'
>;

export type RelayDocumentSearchContentIndexCommitInput = {
  jobId?: string;
  sourceFileId: string;
  sourcePath: string;
  sourceMetadataVersion: string;
  parsedDocumentUid: string;
  parsedDocumentVersion: string;
  parserVersion: string;
  parsedCacheKey?: string;
  derivedCacheKey?: string;
  searchStoreRowCount: number;
  ftsRowCount: number;
  previewSpanCount: number;
};

export type RelayDocumentSearchContentIndexCommitReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT;
  status: 'committed' | 'stale_previous_active' | 'no_previous_active' | 'failed';
  sourceFileId: string;
  active?: RelayDocumentSearchContentIndexActivePointer;
  previous?: RelayDocumentSearchContentIndexActivePointer;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexCoordinatorOptions = {
  coordinatorDir?: string;
  lockStaleMs?: number;
  now?: Date;
  ownerId?: string;
  appVersion?: string;
};

export class RelayDocumentSearchIndexWriterBusyError extends Error {
  readonly snapshot?: RelayDocumentSearchIndexLockSnapshot;
  readonly event: RelayDocumentSearchIndexHealthEvent;

  constructor(snapshot: RelayDocumentSearchIndexLockSnapshot | undefined, event: RelayDocumentSearchIndexHealthEvent) {
    super('Relay document search index writer is already active.');
    this.name = 'RelayDocumentSearchIndexWriterBusyError';
    this.snapshot = snapshot;
    this.event = event;
  }
}

export type RelayDocumentSearchIndexWriter = {
  snapshot: RelayDocumentSearchIndexLockSnapshot;
  events: RelayDocumentSearchIndexHealthEvent[];
  heartbeat: () => Promise<RelayDocumentSearchIndexLockSnapshot>;
  beginJob: (jobId: string) => Promise<RelayDocumentSearchIndexLockSnapshot>;
  finishJob: (jobId: string) => Promise<RelayDocumentSearchIndexLockSnapshot>;
  release: () => Promise<void>;
};

function currentDate(options: RelayDocumentSearchIndexCoordinatorOptions): Date {
  return options.now ?? new Date();
}

function event(
  kind: RelayDocumentSearchIndexHealthEventKind,
  options: RelayDocumentSearchIndexCoordinatorOptions,
  details?: Record<string, unknown>,
  jobId?: string,
): RelayDocumentSearchIndexHealthEvent {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_HEALTH_EVENT_CONTRACT,
    eventId: randomUUID(),
    kind,
    createdAt: currentDate(options).toISOString(),
    ownerId: options.ownerId ?? `pid-${process.pid}`,
    pid: process.pid,
    jobId,
    details,
  };
}

function lockSnapshot(options: RelayDocumentSearchIndexCoordinatorOptions): RelayDocumentSearchIndexLockSnapshot {
  const now = currentDate(options).toISOString();
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_LOCK_CONTRACT,
    ownerId: options.ownerId ?? `pid-${process.pid}`,
    pid: process.pid,
    appVersion: options.appVersion,
    acquiredAt: now,
    heartbeatAt: now,
    activeJobIds: [],
  };
}

export function relayDocumentSearchIndexCoordinatorDir(
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
): string {
  if (options.coordinatorDir) return resolve(options.coordinatorDir);
  if (process.env[COORDINATOR_DIR_ENV]) return resolve(process.env[COORDINATOR_DIR_ENV] as string);
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Relay Agent')
    : join(homedir(), '.relay-agent');
  return join(base, 'document-search', 'index-coordinator');
}

function lockPathForDir(dir: string): string {
  return join(dir, 'writer.lock.json');
}

function eventsPathForDir(dir: string): string {
  return join(dir, 'health-events.jsonl');
}

function activePointerDirForDir(dir: string): string {
  return join(dir, 'content-index-active');
}

function activePointerPathForSourceFileId(dir: string, sourceFileId: string): string {
  const hash = createHash('sha256').update(sourceFileId).digest('hex').slice(0, 32);
  return join(activePointerDirForDir(dir), `${hash}.json`);
}

async function appendHealthEvent(dir: string, item: RelayDocumentSearchIndexHealthEvent): Promise<void> {
  await mkdir(dirname(eventsPathForDir(dir)), { recursive: true });
  await appendFile(eventsPathForDir(dir), `${JSON.stringify(item)}\n`, 'utf8');
}

function pointerSummary(
  pointer: RelayDocumentSearchContentIndexActivePointer,
): RelayDocumentSearchContentIndexPointerSummary {
  return {
    state: pointer.state,
    sourceMetadataVersion: pointer.sourceMetadataVersion,
    parsedDocumentUid: pointer.parsedDocumentUid,
    parsedDocumentVersion: pointer.parsedDocumentVersion,
    parserVersion: pointer.parserVersion,
    parsedCacheKey: pointer.parsedCacheKey,
    derivedCacheKey: pointer.derivedCacheKey,
    committedAt: pointer.committedAt,
  };
}

function validContentIndexPointer(value: unknown): value is RelayDocumentSearchContentIndexActivePointer {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_ACTIVE_POINTER_CONTRACT &&
    typeof (value as { sourceFileId?: unknown }).sourceFileId === 'string';
}

export async function readRelayDocumentSearchContentIndexActivePointer(
  sourceFileId: string,
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
): Promise<RelayDocumentSearchContentIndexActivePointer | undefined> {
  const dir = relayDocumentSearchIndexCoordinatorDir(options);
  try {
    const parsed = JSON.parse(await readFile(activePointerPathForSourceFileId(dir, sourceFileId), 'utf8')) as unknown;
    return validContentIndexPointer(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeContentIndexActivePointer(
  pointer: RelayDocumentSearchContentIndexActivePointer,
  options: RelayDocumentSearchIndexCoordinatorOptions,
): Promise<void> {
  const dir = relayDocumentSearchIndexCoordinatorDir(options);
  const pointerPath = activePointerPathForSourceFileId(dir, pointer.sourceFileId);
  const tempPath = `${pointerPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(pointerPath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  await rename(tempPath, pointerPath);
}

export async function commitRelayDocumentSearchContentIndexActivePointer(
  input: RelayDocumentSearchContentIndexCommitInput,
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
): Promise<RelayDocumentSearchContentIndexCommitReport> {
  const previous = await readRelayDocumentSearchContentIndexActivePointer(input.sourceFileId, options);
  const active: RelayDocumentSearchContentIndexActivePointer = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_ACTIVE_POINTER_CONTRACT,
    state: 'active',
    sourceFileId: input.sourceFileId,
    sourcePath: input.sourcePath,
    sourceMetadataVersion: input.sourceMetadataVersion,
    parsedDocumentUid: input.parsedDocumentUid,
    parsedDocumentVersion: input.parsedDocumentVersion,
    parserVersion: input.parserVersion,
    parsedCacheKey: input.parsedCacheKey,
    derivedCacheKey: input.derivedCacheKey,
    searchStoreRowCount: input.searchStoreRowCount,
    ftsRowCount: input.ftsRowCount,
    previewSpanCount: input.previewSpanCount,
    committedAt: currentDate(options).toISOString(),
    previous: previous ? pointerSummary(previous) : undefined,
  };
  try {
    await writeContentIndexActivePointer(active, options);
    await recordRelayDocumentSearchIndexHealthEvent(
      'content_index_committed',
      options,
      {
        sourceFileId: input.sourceFileId,
        sourceMetadataVersion: input.sourceMetadataVersion,
        parserVersion: input.parserVersion,
        searchStoreRowCount: input.searchStoreRowCount,
        ftsRowCount: input.ftsRowCount,
        previewSpanCount: input.previewSpanCount,
        replacedPreviousActive: Boolean(previous),
      },
      input.jobId,
    );
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT,
      status: 'committed',
      sourceFileId: input.sourceFileId,
      active,
      previous,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT,
      status: 'failed',
      sourceFileId: input.sourceFileId,
      previous,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function markRelayDocumentSearchContentIndexActivePointerStale(
  sourceFileId: string,
  reason: string,
  options: RelayDocumentSearchIndexCoordinatorOptions & { jobId?: string; message?: string } = {},
): Promise<RelayDocumentSearchContentIndexCommitReport> {
  const previous = await readRelayDocumentSearchContentIndexActivePointer(sourceFileId, options);
  if (!previous) {
    await recordRelayDocumentSearchIndexHealthEvent(
      'content_index_commit_failed',
      options,
      { sourceFileId, reason, stalePreviousActive: false, message: options.message },
      options.jobId,
    );
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT,
      status: 'no_previous_active',
      sourceFileId,
      warnings: ['no_previous_active_content_index_pointer'],
      errors: [],
    };
  }
  const active: RelayDocumentSearchContentIndexActivePointer = {
    ...previous,
    state: 'stale',
    staleAt: currentDate(options).toISOString(),
    lastFailure: {
      failedAt: currentDate(options).toISOString(),
      reason,
      message: options.message,
    },
  };
  try {
    await writeContentIndexActivePointer(active, options);
    await recordRelayDocumentSearchIndexHealthEvent(
      'content_index_commit_failed',
      options,
      {
        sourceFileId,
        reason,
        stalePreviousActive: true,
        previousSourceMetadataVersion: previous.sourceMetadataVersion,
        message: options.message,
      },
      options.jobId,
    );
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT,
      status: 'stale_previous_active',
      sourceFileId,
      active,
      previous,
      warnings: ['previous_active_content_index_marked_stale'],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_CONTENT_INDEX_COMMIT_CONTRACT,
      status: 'failed',
      sourceFileId,
      previous,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function recordRelayDocumentSearchIndexHealthEvent(
  kind: RelayDocumentSearchIndexHealthEventKind,
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
  details?: Record<string, unknown>,
  jobId?: string,
): Promise<RelayDocumentSearchIndexHealthEvent> {
  const dir = relayDocumentSearchIndexCoordinatorDir(options);
  const item = event(kind, options, details, jobId);
  await appendHealthEvent(dir, item);
  return item;
}

async function readLock(lockPath: string): Promise<RelayDocumentSearchIndexLockSnapshot | undefined> {
  try {
    const content = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(content) as RelayDocumentSearchIndexLockSnapshot;
    if (parsed.schemaVersion !== RELAY_DOCUMENT_SEARCH_INDEX_LOCK_CONTRACT) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function staleLock(
  snapshot: RelayDocumentSearchIndexLockSnapshot | undefined,
  options: RelayDocumentSearchIndexCoordinatorOptions,
): boolean {
  if (!snapshot) return true;
  const heartbeatMs = Date.parse(snapshot.heartbeatAt);
  if (!Number.isFinite(heartbeatMs)) return true;
  const staleMs = Math.max(1, options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS);
  return currentDate(options).getTime() - heartbeatMs > staleMs;
}

async function createLock(lockPath: string, snapshot: RelayDocumentSearchIndexLockSnapshot): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'EEXIST') return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function writeLock(lockPath: string, snapshot: RelayDocumentSearchIndexLockSnapshot): Promise<void> {
  await writeFile(lockPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function acquireRelayDocumentSearchIndexWriter(
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
): Promise<RelayDocumentSearchIndexWriter> {
  const dir = relayDocumentSearchIndexCoordinatorDir(options);
  const lockPath = lockPathForDir(dir);
  const events: RelayDocumentSearchIndexHealthEvent[] = [];
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = lockSnapshot(options);
    if (await createLock(lockPath, snapshot)) {
      const acquired = event('lock_acquired', options, { contract: RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_CONTRACT });
      events.push(acquired);
      await appendHealthEvent(dir, acquired);
      return createWriter(dir, lockPath, snapshot, events, options);
    }

    const existing = await readLock(lockPath);
    if (staleLock(existing, options)) {
      await rm(lockPath, { force: true });
      const recovered = event('stale_lock_recovered', options, {
        previousOwnerId: existing?.ownerId,
        previousPid: existing?.pid,
        previousHeartbeatAt: existing?.heartbeatAt,
      });
      events.push(recovered);
      await appendHealthEvent(dir, recovered);
      continue;
    }

    const busy = event('lock_busy', options, {
      activeOwnerId: existing?.ownerId,
      activePid: existing?.pid,
      activeJobIds: existing?.activeJobIds ?? [],
      heartbeatAt: existing?.heartbeatAt,
    });
    events.push(busy);
    await appendHealthEvent(dir, busy);
    throw new RelayDocumentSearchIndexWriterBusyError(existing, busy);
  }

  const busy = event('lock_busy', options, { reason: 'stale_lock_recovery_race' });
  events.push(busy);
  await appendHealthEvent(dir, busy);
  throw new RelayDocumentSearchIndexWriterBusyError(undefined, busy);
}

function createWriter(
  dir: string,
  lockPath: string,
  snapshot: RelayDocumentSearchIndexLockSnapshot,
  events: RelayDocumentSearchIndexHealthEvent[],
  options: RelayDocumentSearchIndexCoordinatorOptions,
): RelayDocumentSearchIndexWriter {
  let released = false;
  const writer = {
    snapshot,
    events,
    async heartbeat() {
      if (released) return writer.snapshot;
      writer.snapshot = { ...writer.snapshot, heartbeatAt: currentDate(options).toISOString() };
      await writeLock(lockPath, writer.snapshot);
      return writer.snapshot;
    },
    async beginJob(jobId: string) {
      if (!writer.snapshot.activeJobIds.includes(jobId)) {
        writer.snapshot = { ...writer.snapshot, activeJobIds: [...writer.snapshot.activeJobIds, jobId] };
      }
      await writer.heartbeat();
      const started = event('job_started', options, undefined, jobId);
      writer.events.push(started);
      await appendHealthEvent(dir, started);
      return writer.snapshot;
    },
    async finishJob(jobId: string) {
      writer.snapshot = {
        ...writer.snapshot,
        activeJobIds: writer.snapshot.activeJobIds.filter((activeJobId) => activeJobId !== jobId),
      };
      await writer.heartbeat();
      const finished = event('job_finished', options, undefined, jobId);
      writer.events.push(finished);
      await appendHealthEvent(dir, finished);
      return writer.snapshot;
    },
    async release() {
      if (released) return;
      const activeJobIds = writer.snapshot.activeJobIds;
      for (const jobId of activeJobIds) {
        const abandoned = event('job_abandoned', options, undefined, jobId);
        writer.events.push(abandoned);
        await appendHealthEvent(dir, abandoned);
      }
      const releasedEvent = event('lock_released', options);
      writer.events.push(releasedEvent);
      await appendHealthEvent(dir, releasedEvent);
      await rm(lockPath, { force: true });
      released = true;
      writer.snapshot = { ...writer.snapshot, activeJobIds: [] };
    },
  };
  return writer;
}

export async function readRelayDocumentSearchIndexHealthEvents(
  options: RelayDocumentSearchIndexCoordinatorOptions = {},
  limit = 50,
): Promise<RelayDocumentSearchIndexHealthEvent[]> {
  const dir = relayDocumentSearchIndexCoordinatorDir(options);
  try {
    const content = await readFile(eventsPathForDir(dir), 'utf8');
    return content
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .map((line) => JSON.parse(line) as RelayDocumentSearchIndexHealthEvent);
  } catch {
    return [];
  }
}
