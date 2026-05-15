/**
 * Metadata-only sync journal for Relay Document Search.
 *
 * This records recent search/indexing events for local diagnostics. It never
 * stores extracted document text, ParsedDocument IR, snippets, previews, or
 * embeddings.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export const RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT = 'RelayDocumentSearchSyncJournal.v1' as const;
export const RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION = 1 as const;
export const RELAY_DOCUMENT_SEARCH_SYNC_RECONCILIATION_CONTRACT =
  'RelayDocumentSearchSyncReconciliation.v1' as const;

export type RelayDocumentSearchSyncJournalEventKind =
  | 'search_started'
  | 'search_completed'
  | 'search_failed'
  | 'metadata_scan_completed'
  | 'content_scan_completed'
  | 'inaccessible_path'
  | 'truncated'
  | 'cancelled'
  | 'timed_out'
  | 'created'
  | 'modified'
  | 'deleted'
  | 'moved'
  | 'stale'
  | 'watcher_started'
  | 'watcher_event'
  | 'periodic_scan_started'
  | 'periodic_scan_completed'
  | 'periodic_reconciliation';

export type RelayDocumentSearchSyncJournalEventInput = {
  kind: RelayDocumentSearchSyncJournalEventKind;
  jobId?: string;
  queryId?: string;
  root?: string;
  path?: string;
  previousPath?: string;
  query?: string;
  status?: string;
  count?: number;
  scannedFiles?: number;
  skippedFiles?: number;
  contentScannedFiles?: number;
  contentSkippedFiles?: number;
  evidenceFileCount?: number;
  resultCount?: number;
  warningCodes?: string[];
  details?: Record<string, unknown>;
};

export type RelayDocumentSearchSyncJournalEvent = Omit<
  RelayDocumentSearchSyncJournalEventInput,
  'path' | 'previousPath' | 'details'
> & {
  eventId: string;
  recordedAt: string;
  path?: string;
  pathHash?: string;
  previousPath?: string;
  previousPathHash?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type RelayDocumentSearchSyncJournalRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT;
  journalVersion: typeof RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION;
  generatedAt: string;
  maxEntries: number;
  entries: RelayDocumentSearchSyncJournalEvent[];
};

export type RelayDocumentSearchSyncJournalOptions = {
  useSyncJournal?: boolean;
  syncJournalDir?: string;
  syncJournalMaxEntries?: number;
  now?: Date;
};

export type RelayDocumentSearchSyncReconciliationOptions = {
  roots: string[];
  now?: Date;
  periodicScanIntervalMs?: number;
  watcherStaleMs?: number;
};

export type RelayDocumentSearchSyncRootReconciliation = {
  root: string;
  watcherEventCount: number;
  periodicScanEventCount: number;
  lastWatcherEventAt?: string;
  lastPeriodicScanAt?: string;
  watcherState: 'recent' | 'stale' | 'not_seen';
  periodicState: 'fresh' | 'due';
  reconciliationMode: 'watcher' | 'periodic' | 'watcher_and_periodic';
  reasons: string[];
};

export type RelayDocumentSearchSyncReconciliationReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SYNC_RECONCILIATION_CONTRACT;
  generatedAt: string;
  rootCount: number;
  watcherRootCount: number;
  periodicDueRootCount: number;
  roots: RelayDocumentSearchSyncRootReconciliation[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

const SYNC_JOURNAL_ENV = 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL';
const SYNC_JOURNAL_DIR_ENV = 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR';
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_PERIODIC_SCAN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_WATCHER_STALE_MS = 5 * 60 * 1000;
const JOURNAL_FILE = 'sync-journal.json';

function defaultJournalDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'sync-journal');
}

export function relayDocumentSearchSyncJournalEnabled(
  options: RelayDocumentSearchSyncJournalOptions = {},
): boolean {
  if (options.useSyncJournal !== undefined) return options.useSyncJournal;
  return process.env[SYNC_JOURNAL_ENV] === '1';
}

export function relayDocumentSearchSyncJournalDir(
  options: RelayDocumentSearchSyncJournalOptions = {},
): string {
  return resolve(options.syncJournalDir || process.env[SYNC_JOURNAL_DIR_ENV] || defaultJournalDir());
}

function journalPath(options: RelayDocumentSearchSyncJournalOptions): string {
  return join(relayDocumentSearchSyncJournalDir(options), JOURNAL_FILE);
}

function maxEntries(options: RelayDocumentSearchSyncJournalOptions): number {
  return Math.max(1, Math.min(options.syncJournalMaxEntries ?? DEFAULT_MAX_ENTRIES, 5000));
}

function stableHash(value: string): string {
  return createHash('sha256').update(resolve(value)).digest('hex').slice(0, 24);
}

function stableEventId(event: RelayDocumentSearchSyncJournalEventInput, recordedAt: string): string {
  return createHash('sha256')
    .update(JSON.stringify([
      recordedAt,
      event.kind,
      event.jobId,
      event.queryId,
      event.root ? resolve(event.root) : undefined,
      event.path ? resolve(event.path) : undefined,
      event.status,
      event.count,
    ]))
    .digest('hex')
    .slice(0, 20);
}

function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') out[key] = value.slice(0, 240);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeEvent(
  event: RelayDocumentSearchSyncJournalEventInput,
  options: RelayDocumentSearchSyncJournalOptions,
): RelayDocumentSearchSyncJournalEvent {
  const recordedAt = (options.now ?? new Date()).toISOString();
  return {
    ...event,
    eventId: stableEventId(event, recordedAt),
    recordedAt,
    root: event.root ? resolve(event.root) : undefined,
    path: event.path ? resolve(event.path) : undefined,
    pathHash: event.path ? stableHash(event.path) : undefined,
    previousPath: event.previousPath ? resolve(event.previousPath) : undefined,
    previousPathHash: event.previousPath ? stableHash(event.previousPath) : undefined,
    details: sanitizeDetails(event.details),
  };
}

function emptyJournal(options: RelayDocumentSearchSyncJournalOptions): RelayDocumentSearchSyncJournalRecord {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT,
    journalVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    maxEntries: maxEntries(options),
    entries: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEvent(value: unknown): value is RelayDocumentSearchSyncJournalEvent {
  if (!isRecord(value)) return false;
  return typeof value.eventId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.recordedAt === 'string';
}

function parseJournal(
  value: unknown,
  options: RelayDocumentSearchSyncJournalOptions,
): RelayDocumentSearchSyncJournalRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT) return undefined;
  if (value.journalVersion !== RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION) return undefined;
  if (!Array.isArray(value.entries) || !value.entries.every(isEvent)) return undefined;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT,
    journalVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION,
    generatedAt: typeof value.generatedAt === 'string'
      ? value.generatedAt
      : (options.now ?? new Date()).toISOString(),
    maxEntries: maxEntries(options),
    entries: value.entries.slice(-maxEntries(options)),
  };
}

export async function readRelayDocumentSearchSyncJournal(
  options: RelayDocumentSearchSyncJournalOptions = {},
): Promise<RelayDocumentSearchSyncJournalRecord> {
  try {
    const parsed = JSON.parse(await readFile(journalPath(options), 'utf8')) as unknown;
    return parseJournal(parsed, options) ?? emptyJournal(options);
  } catch {
    return emptyJournal(options);
  }
}

export async function appendRelayDocumentSearchSyncJournalEvents(
  events: RelayDocumentSearchSyncJournalEventInput[],
  options: RelayDocumentSearchSyncJournalOptions = {},
): Promise<RelayDocumentSearchSyncJournalRecord> {
  const journal = await readRelayDocumentSearchSyncJournal(options);
  const normalized = events.map((event) => normalizeEvent(event, options));
  const next: RelayDocumentSearchSyncJournalRecord = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_CONTRACT,
    journalVersion: RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    maxEntries: maxEntries(options),
    entries: [...journal.entries, ...normalized].slice(-maxEntries(options)),
  };
  const path = journalPath(options);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
  return next;
}

export async function appendRelayDocumentSearchSyncJournalEvent(
  event: RelayDocumentSearchSyncJournalEventInput,
  options: RelayDocumentSearchSyncJournalOptions = {},
): Promise<RelayDocumentSearchSyncJournalRecord> {
  return appendRelayDocumentSearchSyncJournalEvents([event], options);
}

function eventSource(event: RelayDocumentSearchSyncJournalEvent): string | undefined {
  const source = event.details?.source;
  return typeof source === 'string' ? source : undefined;
}

function isWatcherEvent(event: RelayDocumentSearchSyncJournalEvent): boolean {
  return event.kind === 'watcher_started' ||
    event.kind === 'watcher_event' ||
    eventSource(event) === 'watcher';
}

function isPeriodicScanEvent(event: RelayDocumentSearchSyncJournalEvent): boolean {
  return event.kind === 'periodic_scan_started' ||
    event.kind === 'periodic_scan_completed' ||
    event.kind === 'periodic_reconciliation' ||
    eventSource(event) === 'periodic_scan';
}

function latestRecordedAt(events: RelayDocumentSearchSyncJournalEvent[]): string | undefined {
  return events
    .map((event) => event.recordedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1);
}

function eventAgeMs(recordedAt: string | undefined, now: Date): number | undefined {
  if (!recordedAt) return undefined;
  const parsed = Date.parse(recordedAt);
  return Number.isFinite(parsed) ? now.getTime() - parsed : undefined;
}

export function buildRelayDocumentSearchSyncReconciliationReport(
  journal: RelayDocumentSearchSyncJournalRecord,
  options: RelayDocumentSearchSyncReconciliationOptions,
): RelayDocumentSearchSyncReconciliationReport {
  const now = options.now ?? new Date();
  const periodicScanIntervalMs = Math.max(1, options.periodicScanIntervalMs ?? DEFAULT_PERIODIC_SCAN_INTERVAL_MS);
  const watcherStaleMs = Math.max(1, options.watcherStaleMs ?? DEFAULT_WATCHER_STALE_MS);
  const roots = options.roots.map((root) => {
    const normalizedRoot = resolve(root);
    const rootEvents = journal.entries.filter((event) => event.root === normalizedRoot);
    const watcherEvents = rootEvents.filter(isWatcherEvent);
    const periodicEvents = rootEvents.filter(isPeriodicScanEvent);
    const lastWatcherEventAt = latestRecordedAt(watcherEvents);
    const lastPeriodicScanAt = latestRecordedAt(periodicEvents);
    const watcherAgeMs = eventAgeMs(lastWatcherEventAt, now);
    const periodicAgeMs = eventAgeMs(lastPeriodicScanAt, now);
    const watcherState = watcherEvents.length === 0
      ? 'not_seen'
      : watcherAgeMs !== undefined && watcherAgeMs <= watcherStaleMs
        ? 'recent'
        : 'stale';
    const periodicState = periodicAgeMs !== undefined && periodicAgeMs <= periodicScanIntervalMs ? 'fresh' : 'due';
    const reasons = [
      watcherState === 'not_seen' ? 'watcher_not_seen' : undefined,
      watcherState === 'stale' ? 'watcher_stale' : undefined,
      periodicState === 'due' ? 'periodic_scan_due' : 'periodic_scan_fresh',
    ].filter((reason): reason is string => Boolean(reason));
    const reconciliationMode = watcherState === 'recent' && periodicState === 'fresh'
      ? 'watcher'
      : watcherState === 'recent'
        ? 'watcher_and_periodic'
        : 'periodic';
    return {
      root: normalizedRoot,
      watcherEventCount: watcherEvents.length,
      periodicScanEventCount: periodicEvents.length,
      lastWatcherEventAt,
      lastPeriodicScanAt,
      watcherState,
      periodicState,
      reconciliationMode,
      reasons,
    };
  });

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SYNC_RECONCILIATION_CONTRACT,
    generatedAt: now.toISOString(),
    rootCount: roots.length,
    watcherRootCount: roots.filter((root) => root.watcherState === 'recent').length,
    periodicDueRootCount: roots.filter((root) => root.periodicState === 'due').length,
    roots,
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}
