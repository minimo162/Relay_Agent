import { watch } from 'fs';
import { readdir } from 'fs/promises';
import { delimiter, join, resolve } from 'path';

import {
  RelayDocumentSearchBackgroundScheduler,
  type RelayDocumentSearchBackgroundSchedulerSnapshot,
  type RelayDocumentSearchBackgroundWorkRunner,
} from './relayDocumentSearchBackgroundScheduler';
import {
  appendRelayDocumentSearchSyncJournalEvent,
  relayDocumentSearchSyncJournalEnabled,
  type RelayDocumentSearchSyncJournalOptions,
} from './relayDocumentSearchSyncJournal';

export const RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER_CONTRACT = 'RelayDocumentSearchSyncProducer.v1' as const;

export type RelayDocumentSearchWatchHandle = {
  close(): void;
};

export type RelayDocumentSearchWatchImpl = (
  root: string,
  listener: (eventType: string, filename?: string) => void,
) => RelayDocumentSearchWatchHandle;

export type RelayDocumentSearchIntervalImpl = (listener: () => void, intervalMs: number) => unknown;
export type RelayDocumentSearchClearIntervalImpl = (handle: unknown) => void;
export type RelayDocumentSearchSyncProducerEnv = Record<string, string | undefined>;

export type RelayDocumentSearchDirectoryEnumerator = (
  root: string,
  options: {
    maxDepth: number;
    maxDirectories: number;
    excludeDirectoryNames: string[];
  },
) => Promise<{
  directories: string[];
  skippedDirectoryCount: number;
  limitReached: boolean;
}>;

export type RelayDocumentSearchSyncProducerRootState = {
  root: string;
  watcherPolicy: 'watch_and_periodic' | 'periodic_only' | 'disabled';
  watcherPolicyReason: 'local_root_default' | 'network_share_periodic_default' | 'filesystem_watcher_disabled';
  watcherState: 'running' | 'disabled' | 'failed' | 'stopped';
  watcherError?: string;
  periodicState: 'scheduled' | 'disabled' | 'stopped';
  watchedDirectoryCount: number;
  watcherLimitReached: boolean;
  watcherSkippedDirectoryCount: number;
  queuedWatcherEventCount: number;
  scheduledPeriodicScanCount: number;
  lastWatcherEventAt?: string;
  lastPeriodicScanAt?: string;
};

export type RelayDocumentSearchSyncProducerSnapshot = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER_CONTRACT;
  generatedAt: string;
  stopped: boolean;
  rootCount: number;
  watcherEnabled: boolean;
  periodicEnabled: boolean;
  debounceMs: number;
  periodicScanIntervalMs: number;
  queuedWatcherEventCount: number;
  scheduledPeriodicScanCount: number;
  roots: RelayDocumentSearchSyncProducerRootState[];
  scheduler: RelayDocumentSearchBackgroundSchedulerSnapshot;
};

export type RelayDocumentSearchSyncProducerOptions = RelayDocumentSearchSyncJournalOptions & {
  roots: string[];
  scheduler?: RelayDocumentSearchBackgroundScheduler;
  watcherRunner?: RelayDocumentSearchBackgroundWorkRunner;
  periodicRunner?: RelayDocumentSearchBackgroundWorkRunner;
  useFilesystemWatcher?: boolean;
  usePeriodicScan?: boolean;
  watcherRecursive?: boolean;
  watcherMaxDepth?: number;
  watcherMaxDirectories?: number;
  watcherExcludeDirectoryNames?: string[];
  periodicScanIntervalMs?: number;
  watcherDebounceMs?: number;
  watchImpl?: RelayDocumentSearchWatchImpl;
  directoryEnumerator?: RelayDocumentSearchDirectoryEnumerator;
  setIntervalImpl?: RelayDocumentSearchIntervalImpl;
  clearIntervalImpl?: RelayDocumentSearchClearIntervalImpl;
};

type PendingWatcherEvent = {
  root: string;
  eventType: string;
  path?: string;
  recordedAt: string;
};

type RootWatcherPolicy = Pick<
  RelayDocumentSearchSyncProducerRootState,
  'watcherPolicy' | 'watcherPolicyReason'
>;

const DEFAULT_PERIODIC_SCAN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_WATCHER_DEBOUNCE_MS = 750;
const DEFAULT_WATCHER_MAX_DEPTH = 3;
const DEFAULT_WATCHER_MAX_DIRECTORIES = 64;
const DEFAULT_WATCHER_EXCLUDE_DIRECTORY_NAMES = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'target',
  'dist',
  'build',
  '.cache',
];
const SYNC_PRODUCER_ENV = 'RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER';
const WORKSPACE_ENV = 'RELAY_DOCUMENT_SEARCH_WORKSPACE';
const ROOTS_ENV = 'RELAY_DOCUMENT_SEARCH_ROOTS';
const WATCHER_ENV = 'RELAY_DOCUMENT_SEARCH_WATCHER';
const WATCHER_RECURSIVE_ENV = 'RELAY_DOCUMENT_SEARCH_WATCHER_RECURSIVE';
const WATCHER_DEBOUNCE_MS_ENV = 'RELAY_DOCUMENT_SEARCH_WATCHER_DEBOUNCE_MS';
const WATCHER_MAX_DEPTH_ENV = 'RELAY_DOCUMENT_SEARCH_WATCHER_MAX_DEPTH';
const WATCHER_MAX_DIRECTORIES_ENV = 'RELAY_DOCUMENT_SEARCH_WATCHER_MAX_DIRECTORIES';
const PERIODIC_SCAN_ENV = 'RELAY_DOCUMENT_SEARCH_PERIODIC_SCAN';
const PERIODIC_SCAN_MS_ENV = 'RELAY_DOCUMENT_SEARCH_PERIODIC_SCAN_MS';

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function rootLooksLikeNetworkShare(root: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+/u.test(root) || /^\/\/[^/]+\/[^/]+/u.test(root);
}

function watcherPolicyForRoot(
  root: string,
  options: RelayDocumentSearchSyncProducerOptions,
): RootWatcherPolicy {
  if (options.useFilesystemWatcher === false) {
    return {
      watcherPolicy: 'disabled',
      watcherPolicyReason: 'filesystem_watcher_disabled',
    };
  }
  if (rootLooksLikeNetworkShare(root)) {
    return {
      watcherPolicy: 'periodic_only',
      watcherPolicyReason: 'network_share_periodic_default',
    };
  }
  return {
    watcherPolicy: 'watch_and_periodic',
    watcherPolicyReason: 'local_root_default',
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultWatchImpl(
  root: string,
  listener: (eventType: string, filename?: string) => void,
): RelayDocumentSearchWatchHandle {
  return watch(root, { persistent: false }, (eventType, filename) => {
    listener(String(eventType), filename ? filename.toString() : undefined);
  });
}

function defaultSyncRunner() {
  return {
    status: 'ok' as const,
    progress: { stage: 'sync_scheduled', percent: 100, scannedFiles: 0, skippedFiles: 0 },
  };
}

function resolveEventPath(root: string, filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  return resolve(join(root, filename));
}

async function defaultDirectoryEnumerator(
  root: string,
  options: {
    maxDepth: number;
    maxDirectories: number;
    excludeDirectoryNames: string[];
  },
): Promise<{
  directories: string[];
  skippedDirectoryCount: number;
  limitReached: boolean;
}> {
  const directories: string[] = [];
  let skippedDirectoryCount = 0;
  let limitReached = false;
  const excluded = new Set(options.excludeDirectoryNames);
  const pending = [{ path: resolve(root), depth: 0 }];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    if (directories.length >= options.maxDirectories) {
      skippedDirectoryCount += 1 + pending.length;
      limitReached = true;
      break;
    }
    directories.push(current.path);
    if (current.depth >= options.maxDepth) continue;

    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      skippedDirectoryCount += 1;
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue;
      pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }

  return {
    directories,
    skippedDirectoryCount,
    limitReached,
  };
}

function envFlag(env: RelayDocumentSearchSyncProducerEnv, key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function envNumber(
  env: RelayDocumentSearchSyncProducerEnv,
  key: string,
  fallback: number,
): number {
  const value = env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rootsFromEnv(env: RelayDocumentSearchSyncProducerEnv): string[] {
  const roots = env[ROOTS_ENV]
    ?.split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  if (roots?.length) return roots;
  return env[WORKSPACE_ENV] ? [env[WORKSPACE_ENV] as string] : [];
}

export class RelayDocumentSearchSyncProducer {
  readonly scheduler: RelayDocumentSearchBackgroundScheduler;
  private readonly roots: string[];
  private readonly rootWatcherPolicies = new Map<string, RootWatcherPolicy>();
  private readonly watcherHandles: RelayDocumentSearchWatchHandle[] = [];
  private readonly intervalHandles: unknown[] = [];
  private readonly rootStates = new Map<string, RelayDocumentSearchSyncProducerRootState>();
  private readonly pendingWatcherEvents: PendingWatcherEvent[] = [];
  private watcherFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private sequence = 0;

  constructor(private readonly options: RelayDocumentSearchSyncProducerOptions) {
    this.scheduler = options.scheduler ?? new RelayDocumentSearchBackgroundScheduler({ now: options.now });
    this.roots = [];
    for (const rootInput of unique(options.roots)) {
      const root = resolve(rootInput);
      if (this.rootWatcherPolicies.has(root)) continue;
      this.roots.push(root);
      this.rootWatcherPolicies.set(root, watcherPolicyForRoot(rootInput, options));
    }
    for (const root of this.roots) {
      const watcherPolicy = this.rootWatcherPolicy(root);
      this.rootStates.set(root, {
        root,
        ...watcherPolicy,
        watcherState: this.rootWatcherEnabled(root) ? 'running' : 'disabled',
        periodicState: this.periodicEnabled() ? 'scheduled' : 'disabled',
        watchedDirectoryCount: 0,
        watcherLimitReached: false,
        watcherSkippedDirectoryCount: 0,
        queuedWatcherEventCount: 0,
        scheduledPeriodicScanCount: 0,
      });
    }
  }

  async start(): Promise<RelayDocumentSearchSyncProducerSnapshot> {
    if (this.watcherEnabled()) {
      const watchImpl = this.options.watchImpl ?? defaultWatchImpl;
      for (const root of this.roots) {
        if (!this.rootWatcherEnabled(root)) {
          this.updateRoot(root, {
            watcherState: 'disabled',
            watchedDirectoryCount: 0,
            watcherLimitReached: false,
            watcherSkippedDirectoryCount: 0,
          });
          continue;
        }
        const directoryReport = await this.watcherDirectories(root);
        let startedCount = 0;
        const errors: string[] = [];
        try {
          for (const watchRoot of directoryReport.directories) {
            const handle = watchImpl(watchRoot, (eventType, filename) => {
              this.notifyWatcherEventFromWatchRoot(root, watchRoot, eventType, filename);
            });
            this.watcherHandles.push(handle);
            startedCount += 1;
          }
        } catch (error) {
          errors.push(messageFromError(error));
        }
        this.updateRoot(root, {
          watcherState: startedCount > 0 ? 'running' : 'failed',
          watcherError: errors[0],
          watchedDirectoryCount: startedCount,
          watcherLimitReached: directoryReport.limitReached,
          watcherSkippedDirectoryCount: directoryReport.skippedDirectoryCount + errors.length,
        });
        if (startedCount > 0) {
          await this.recordJournalEvent({
            kind: 'watcher_started',
            root,
            details: {
              source: 'watcher',
              recursive: this.watcherRecursive(),
              watchedDirectoryCount: startedCount,
              watcherLimitReached: directoryReport.limitReached,
            },
          });
        }
      }
    }

    if (this.periodicEnabled()) {
      const intervalImpl = this.options.setIntervalImpl ?? ((listener, intervalMs) => setInterval(listener, intervalMs));
      for (const root of this.roots) {
        const handle = intervalImpl(() => {
          void this.triggerPeriodicScan(root);
        }, this.periodicScanIntervalMs());
        this.intervalHandles.push(handle);
      }
    }

    return this.snapshot();
  }

  notifyWatcherEvent(rootInput: string, eventType: string, filename?: string): void {
    const root = resolve(rootInput);
    this.recordWatcherEvent(root, eventType, resolveEventPath(root, filename));
  }

  private notifyWatcherEventFromWatchRoot(
    rootInput: string,
    watchRootInput: string,
    eventType: string,
    filename?: string,
  ): void {
    const root = resolve(rootInput);
    const watchRoot = resolve(watchRootInput);
    this.recordWatcherEvent(root, eventType, resolveEventPath(watchRoot, filename));
  }

  private recordWatcherEvent(root: string, eventType: string, path: string | undefined): void {
    if (this.stopped || !this.rootWatcherEnabled(root)) return;
    if (!this.rootStates.has(root)) return;
    const event: PendingWatcherEvent = {
      root,
      eventType,
      path,
      recordedAt: this.nowIso(),
    };
    this.pendingWatcherEvents.push(event);
    this.updateRoot(root, {
      queuedWatcherEventCount: (this.rootStates.get(root)?.queuedWatcherEventCount ?? 0) + 1,
      lastWatcherEventAt: event.recordedAt,
    });
    this.scheduleWatcherFlush();
  }

  async flushWatcherEvents(): Promise<RelayDocumentSearchSyncProducerSnapshot> {
    if (this.watcherFlushTimer) {
      clearTimeout(this.watcherFlushTimer);
      this.watcherFlushTimer = undefined;
    }
    const events = this.pendingWatcherEvents.splice(0);
    const byRoot = new Map<string, PendingWatcherEvent[]>();
    for (const event of events) {
      byRoot.set(event.root, [...(byRoot.get(event.root) ?? []), event]);
    }

    for (const [root, rootEvents] of byRoot) {
      for (const event of rootEvents) {
        await this.recordJournalEvent({
          kind: 'watcher_event',
          root,
          path: event.path,
          details: { source: 'watcher', eventType: event.eventType },
        });
      }
      this.enqueueSchedulerWork(
        {
          kind: 'watcher_sync',
          priority: 'high',
          root,
          reason: 'filesystem_watcher_event',
        },
        this.options.watcherRunner ?? defaultSyncRunner,
      );
      this.updateRoot(root, { queuedWatcherEventCount: 0 });
    }

    return this.snapshot();
  }

  async triggerPeriodicScan(rootInput?: string): Promise<RelayDocumentSearchSyncProducerSnapshot> {
    if (this.stopped || !this.periodicEnabled()) return this.snapshot();
    const roots = rootInput ? [resolve(rootInput)] : this.roots;
    for (const root of roots) {
      if (!this.rootStates.has(root)) continue;
      const state = this.rootStates.get(root);
      const scheduledPeriodicScanCount = (state?.scheduledPeriodicScanCount ?? 0) + 1;
      this.updateRoot(root, {
        scheduledPeriodicScanCount,
        lastPeriodicScanAt: this.nowIso(),
      });
      await this.recordJournalEvent({
        kind: 'periodic_scan_started',
        root,
        details: { source: 'periodic_scan' },
      });
      this.enqueueSchedulerWork(
        {
          kind: 'periodic_sync',
          priority: 'idle',
          root,
          reason: 'periodic_scan_due',
        },
        async (work, context) => {
          const result = await (this.options.periodicRunner ?? defaultSyncRunner)(work, context);
          await this.recordJournalEvent({
            kind: 'periodic_scan_completed',
            root,
            status: result?.status ?? 'ok',
            details: { source: 'periodic_scan' },
          });
          return result;
        },
      );
    }
    return this.snapshot();
  }

  async stop(): Promise<RelayDocumentSearchSyncProducerSnapshot> {
    this.stopped = true;
    if (this.watcherFlushTimer) {
      clearTimeout(this.watcherFlushTimer);
      this.watcherFlushTimer = undefined;
    }
    for (const handle of this.watcherHandles) handle.close();
    this.watcherHandles.splice(0);
    const clearIntervalImpl = this.options.clearIntervalImpl ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    for (const handle of this.intervalHandles) clearIntervalImpl(handle);
    this.intervalHandles.splice(0);
    for (const root of this.roots) {
      this.updateRoot(root, {
        watcherState: this.rootStates.get(root)?.watcherState === 'disabled' ? 'disabled' : 'stopped',
        periodicState: this.rootStates.get(root)?.periodicState === 'disabled' ? 'disabled' : 'stopped',
      });
    }
    return this.snapshot();
  }

  snapshot(): RelayDocumentSearchSyncProducerSnapshot {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER_CONTRACT,
      generatedAt: this.nowIso(),
      stopped: this.stopped,
      rootCount: this.roots.length,
      watcherEnabled: this.watcherEnabled(),
      periodicEnabled: this.periodicEnabled(),
      debounceMs: this.watcherDebounceMs(),
      periodicScanIntervalMs: this.periodicScanIntervalMs(),
      queuedWatcherEventCount: this.pendingWatcherEvents.length,
      scheduledPeriodicScanCount: [...this.rootStates.values()]
        .reduce((sum, root) => sum + root.scheduledPeriodicScanCount, 0),
      roots: [...this.rootStates.values()],
      scheduler: this.scheduler.snapshot(),
    };
  }

  private enqueueSchedulerWork(
    input: {
      kind: 'watcher_sync' | 'periodic_sync';
      priority: 'high' | 'idle';
      root: string;
      reason: string;
    },
    runner: RelayDocumentSearchBackgroundWorkRunner,
  ): void {
    this.sequence += 1;
    const workId = `sync-${input.kind}-${Date.now().toString(36)}-${this.sequence}`;
    const snapshot = this.scheduler.enqueue(
      {
        workId,
        jobId: `job-${workId}`,
        kind: input.kind,
        priority: input.priority,
        roots: [input.root],
      },
      runner,
    );
    if (input.priority === 'high') this.scheduler.promote(snapshot.workId, input.reason);
  }

  private async recordJournalEvent(
    event: Parameters<typeof appendRelayDocumentSearchSyncJournalEvent>[0],
  ): Promise<void> {
    if (!relayDocumentSearchSyncJournalEnabled(this.options)) return;
    await appendRelayDocumentSearchSyncJournalEvent(event, this.options);
  }

  private scheduleWatcherFlush(): void {
    const debounceMs = this.watcherDebounceMs();
    if (debounceMs <= 0) return;
    if (this.watcherFlushTimer) clearTimeout(this.watcherFlushTimer);
    this.watcherFlushTimer = setTimeout(() => {
      void this.flushWatcherEvents();
    }, debounceMs);
  }

  private updateRoot(root: string, patch: Partial<RelayDocumentSearchSyncProducerRootState>): void {
    const current = this.rootStates.get(root);
    if (!current) return;
    this.rootStates.set(root, { ...current, ...patch });
  }

  private watcherEnabled(): boolean {
    return this.roots.some((root) => this.rootWatcherEnabled(root));
  }

  private rootWatcherPolicy(root: string): RootWatcherPolicy {
    return this.rootWatcherPolicies.get(root) ?? {
      watcherPolicy: 'disabled',
      watcherPolicyReason: 'filesystem_watcher_disabled',
    };
  }

  private rootWatcherEnabled(root: string): boolean {
    return this.rootWatcherPolicy(root).watcherPolicy === 'watch_and_periodic';
  }

  private watcherRecursive(): boolean {
    return this.options.watcherRecursive !== false;
  }

  private watcherMaxDepth(): number {
    return Math.max(0, this.options.watcherMaxDepth ?? DEFAULT_WATCHER_MAX_DEPTH);
  }

  private watcherMaxDirectories(): number {
    return Math.max(1, this.options.watcherMaxDirectories ?? DEFAULT_WATCHER_MAX_DIRECTORIES);
  }

  private watcherExcludeDirectoryNames(): string[] {
    return this.options.watcherExcludeDirectoryNames ?? DEFAULT_WATCHER_EXCLUDE_DIRECTORY_NAMES;
  }

  private async watcherDirectories(root: string): Promise<{
    directories: string[];
    skippedDirectoryCount: number;
    limitReached: boolean;
  }> {
    if (!this.watcherRecursive()) {
      return {
        directories: [root],
        skippedDirectoryCount: 0,
        limitReached: false,
      };
    }
    const enumerator = this.options.directoryEnumerator ?? defaultDirectoryEnumerator;
    const report = await enumerator(root, {
      maxDepth: this.watcherMaxDepth(),
      maxDirectories: this.watcherMaxDirectories(),
      excludeDirectoryNames: this.watcherExcludeDirectoryNames(),
    });
    return {
      directories: report.directories.length ? report.directories.map((directory) => resolve(directory)) : [root],
      skippedDirectoryCount: report.skippedDirectoryCount,
      limitReached: report.limitReached,
    };
  }

  private periodicEnabled(): boolean {
    return this.options.usePeriodicScan !== false;
  }

  private periodicScanIntervalMs(): number {
    return Math.max(1, this.options.periodicScanIntervalMs ?? DEFAULT_PERIODIC_SCAN_INTERVAL_MS);
  }

  private watcherDebounceMs(): number {
    return Math.max(0, this.options.watcherDebounceMs ?? DEFAULT_WATCHER_DEBOUNCE_MS);
  }

  private nowIso(): string {
    return (this.options.now ?? new Date()).toISOString();
  }
}

export async function startRelayDocumentSearchSyncProducer(
  options: RelayDocumentSearchSyncProducerOptions,
): Promise<RelayDocumentSearchSyncProducer> {
  const producer = new RelayDocumentSearchSyncProducer(options);
  await producer.start();
  return producer;
}

export function relayDocumentSearchSyncProducerEnabledFromEnv(
  env: RelayDocumentSearchSyncProducerEnv = process.env,
): boolean {
  return envFlag(env, SYNC_PRODUCER_ENV, false);
}

export async function startRelayDocumentSearchSyncProducerFromEnvironment(
  options: Partial<RelayDocumentSearchSyncProducerOptions> & {
    env?: RelayDocumentSearchSyncProducerEnv;
  } = {},
): Promise<RelayDocumentSearchSyncProducer | undefined> {
  const env = options.env ?? process.env;
  if (!relayDocumentSearchSyncProducerEnabledFromEnv(env)) return undefined;
  const roots = options.roots?.length ? options.roots : rootsFromEnv(env);
  if (!roots.length) return undefined;
  return startRelayDocumentSearchSyncProducer({
    ...options,
    roots,
    useSyncJournal: options.useSyncJournal ?? true,
    useFilesystemWatcher: options.useFilesystemWatcher ?? envFlag(env, WATCHER_ENV, true),
    usePeriodicScan: options.usePeriodicScan ?? envFlag(env, PERIODIC_SCAN_ENV, true),
    watcherRecursive: options.watcherRecursive ?? envFlag(env, WATCHER_RECURSIVE_ENV, true),
    watcherDebounceMs: options.watcherDebounceMs ?? envNumber(env, WATCHER_DEBOUNCE_MS_ENV, DEFAULT_WATCHER_DEBOUNCE_MS),
    watcherMaxDepth: options.watcherMaxDepth ?? envNumber(env, WATCHER_MAX_DEPTH_ENV, DEFAULT_WATCHER_MAX_DEPTH),
    watcherMaxDirectories: options.watcherMaxDirectories ??
      envNumber(env, WATCHER_MAX_DIRECTORIES_ENV, DEFAULT_WATCHER_MAX_DIRECTORIES),
    periodicScanIntervalMs: options.periodicScanIntervalMs ??
      envNumber(env, PERIODIC_SCAN_MS_ENV, DEFAULT_PERIODIC_SCAN_INTERVAL_MS),
  });
}
