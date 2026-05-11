import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

import type { RelayDocumentSearchJobSnapshot } from './relayDocumentSearchJobLifecycle';

export const RELAY_DOCUMENT_SEARCH_JOB_STORE_CONTRACT = 'RelayDocumentSearchJobStore.v1' as const;

const JOB_STORE_ENV = 'RELAY_DOCUMENT_SEARCH_JOB_STORE';
const JOB_STORE_DIR_ENV = 'RELAY_DOCUMENT_SEARCH_JOB_STORE_DIR';
const DEFAULT_ACTIVE_STALE_MS = 5 * 60 * 1000;

export type RelayDocumentSearchJobStoreOptions = {
  useJobStore?: boolean;
  jobStoreDir?: string;
  jobStoreActiveStaleMs?: number;
  now?: Date;
};

export type RelayDocumentSearchJobStoreRecovery = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_JOB_STORE_CONTRACT;
  abandoned: RelayDocumentSearchJobSnapshot[];
};

function nowIso(options: RelayDocumentSearchJobStoreOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function activeLifecycle(lifecycle: RelayDocumentSearchJobSnapshot['lifecycle']): boolean {
  return lifecycle === 'queued' || lifecycle === 'running';
}

function stale(snapshot: RelayDocumentSearchJobSnapshot, options: RelayDocumentSearchJobStoreOptions): boolean {
  const updatedAt = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  const activeStaleMs = Math.max(1, options.jobStoreActiveStaleMs ?? DEFAULT_ACTIVE_STALE_MS);
  return (options.now ?? new Date()).getTime() - updatedAt > activeStaleMs;
}

function isSnapshot(value: unknown): value is RelayDocumentSearchJobSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 'RelayDocumentSearchJobLifecycle.v1' &&
    typeof record.jobId === 'string' &&
    typeof record.requestFingerprint === 'string' &&
    typeof record.lifecycle === 'string' &&
    typeof record.updatedAt === 'string';
}

export function relayDocumentSearchJobStoreEnabled(options: RelayDocumentSearchJobStoreOptions = {}): boolean {
  if (options.useJobStore !== undefined) return options.useJobStore;
  return process.env[JOB_STORE_ENV] === '1';
}

export function relayDocumentSearchJobStoreDir(options: RelayDocumentSearchJobStoreOptions = {}): string {
  if (options.jobStoreDir) return resolve(options.jobStoreDir);
  if (process.env[JOB_STORE_DIR_ENV]) return resolve(process.env[JOB_STORE_DIR_ENV] as string);
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Relay Agent')
    : join(homedir(), '.relay-agent');
  return join(base, 'document-search', 'jobs');
}

function jobPath(jobId: string, options: RelayDocumentSearchJobStoreOptions): string {
  return join(relayDocumentSearchJobStoreDir(options), `${encodeURIComponent(jobId)}.json`);
}

export function writeRelayDocumentSearchJobSnapshot(
  snapshot: RelayDocumentSearchJobSnapshot,
  options: RelayDocumentSearchJobStoreOptions = {},
): void {
  const path = jobPath(snapshot.jobId, options);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}

export function readRelayDocumentSearchJobSnapshot(
  jobId: string,
  options: RelayDocumentSearchJobStoreOptions = {},
): RelayDocumentSearchJobSnapshot | undefined {
  try {
    const parsed = JSON.parse(readFileSync(jobPath(jobId, options), 'utf8')) as unknown;
    return isSnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function listRelayDocumentSearchJobSnapshots(
  options: RelayDocumentSearchJobStoreOptions = {},
): RelayDocumentSearchJobSnapshot[] {
  const dir = relayDocumentSearchJobStoreDir(options);
  if (!existsSync(dir)) return [];
  const snapshots: RelayDocumentSearchJobSnapshot[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry.name), 'utf8')) as unknown;
      if (isSnapshot(parsed)) snapshots.push(parsed);
    } catch {
      rmSync(join(dir, entry.name), { force: true });
    }
  }
  return snapshots.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function abandonSnapshot(
  snapshot: RelayDocumentSearchJobSnapshot,
  options: RelayDocumentSearchJobStoreOptions,
): RelayDocumentSearchJobSnapshot {
  const updatedAt = nowIso(options);
  return {
    ...snapshot,
    lifecycle: 'partial',
    cancellable: false,
    progress: {
      ...snapshot.progress,
      stage: 'abandoned',
    },
    updatedAt,
    finishedAt: updatedAt,
  };
}

export function recoverRelayDocumentSearchJobStore(
  options: RelayDocumentSearchJobStoreOptions = {},
): RelayDocumentSearchJobStoreRecovery {
  const abandoned: RelayDocumentSearchJobSnapshot[] = [];
  for (const snapshot of listRelayDocumentSearchJobSnapshots(options)) {
    if (!activeLifecycle(snapshot.lifecycle) || !stale(snapshot, options)) continue;
    const recovered = abandonSnapshot(snapshot, options);
    writeRelayDocumentSearchJobSnapshot(recovered, options);
    abandoned.push(recovered);
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_JOB_STORE_CONTRACT,
    abandoned,
  };
}

export function findActiveRelayDocumentSearchJobByFingerprint(
  requestFingerprint: string,
  options: RelayDocumentSearchJobStoreOptions = {},
): RelayDocumentSearchJobSnapshot | undefined {
  for (const snapshot of listRelayDocumentSearchJobSnapshots(options)) {
    if (snapshot.requestFingerprint !== requestFingerprint || !activeLifecycle(snapshot.lifecycle)) continue;
    if (stale(snapshot, options)) {
      writeRelayDocumentSearchJobSnapshot(abandonSnapshot(snapshot, options), options);
      continue;
    }
    return snapshot;
  }
  return undefined;
}
