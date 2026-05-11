import { resolve } from 'path';

import type { RelayDocumentSearchResultV1 } from './relayDocumentSearchContract';

export const RELAY_DOCUMENT_SEARCH_BACKGROUND_SCHEDULER_CONTRACT =
  'RelayDocumentSearchBackgroundScheduler.v1' as const;

export type RelayDocumentSearchBackgroundWorkKind =
  | 'foreground_query'
  | 'background_content_index'
  | 'periodic_sync'
  | 'watcher_sync'
  | 'derived_index_rebuild'
  | 'index_maintenance';

export type RelayDocumentSearchBackgroundWorkPriority = 'foreground' | 'high' | 'normal' | 'idle';

export type RelayDocumentSearchBackgroundWorkLifecycle =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RelayDocumentSearchBackgroundSchedulerState = 'clear' | 'busy' | 'throttled' | 'paused';

export type RelayDocumentSearchBackgroundWorkSnapshot = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_BACKGROUND_SCHEDULER_CONTRACT;
  workId: string;
  jobId?: string;
  queryId?: string;
  kind: RelayDocumentSearchBackgroundWorkKind;
  priority: RelayDocumentSearchBackgroundWorkPriority;
  lifecycle: RelayDocumentSearchBackgroundWorkLifecycle;
  roots: string[];
  queuePosition?: number;
  cancellable: boolean;
  cancellationRequested: boolean;
  promotionReason?: string;
  progress?: RelayDocumentSearchResultV1['progress'];
  resultStatus?: RelayDocumentSearchResultV1['status'];
  error?: string;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
};

export type RelayDocumentSearchBackgroundSchedulerRootSnapshot = {
  root: string;
  queuedJobs: number;
  activeJobs: number;
  concurrencyLimit: number;
  throttled: boolean;
  paused: boolean;
  reasons: string[];
};

export type RelayDocumentSearchBackgroundSchedulerSnapshot = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_BACKGROUND_SCHEDULER_CONTRACT;
  generatedAt: string;
  state: RelayDocumentSearchBackgroundSchedulerState;
  paused: boolean;
  pauseReasons: string[];
  maxConcurrentJobs: number;
  perRootConcurrency: number;
  queueDepth: number;
  activeJobCount: number;
  completedJobCount: number;
  failedJobCount: number;
  cancelledJobCount: number;
  throttledRoots: string[];
  roots: RelayDocumentSearchBackgroundSchedulerRootSnapshot[];
  items: RelayDocumentSearchBackgroundWorkSnapshot[];
};

export type RelayDocumentSearchBackgroundWorkInput = {
  workId?: string;
  jobId?: string;
  queryId?: string;
  kind?: RelayDocumentSearchBackgroundWorkKind;
  priority?: RelayDocumentSearchBackgroundWorkPriority;
  roots: string[];
};

export type RelayDocumentSearchBackgroundWorkResult = {
  jobId?: string;
  status?: RelayDocumentSearchResultV1['status'];
  progress?: RelayDocumentSearchResultV1['progress'];
};

export type RelayDocumentSearchBackgroundWorkRunner = (
  work: RelayDocumentSearchBackgroundWorkSnapshot,
  context: { signal: AbortSignal },
) => Promise<RelayDocumentSearchBackgroundWorkResult | void> | RelayDocumentSearchBackgroundWorkResult | void;

export type RelayDocumentSearchBackgroundSchedulerOptions = {
  maxConcurrentJobs?: number;
  perRootConcurrency?: number;
  maxQueueDepth?: number;
  paused?: boolean;
  pauseReasons?: string[];
  now?: Date;
  onEvent?: (
    work: RelayDocumentSearchBackgroundWorkSnapshot,
    scheduler: RelayDocumentSearchBackgroundSchedulerSnapshot,
  ) => void;
};

type WorkRecord = {
  snapshot: RelayDocumentSearchBackgroundWorkSnapshot;
  runner: RelayDocumentSearchBackgroundWorkRunner;
  controller: AbortController;
  sequence: number;
  completion?: Promise<void>;
};

const PRIORITY_RANK: Record<RelayDocumentSearchBackgroundWorkPriority, number> = {
  foreground: 0,
  high: 1,
  normal: 2,
  idle: 3,
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedRoots(roots: string[]): string[] {
  return unique(roots.map((root) => resolve(root)));
}

function terminal(lifecycle: RelayDocumentSearchBackgroundWorkLifecycle): boolean {
  return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RelayDocumentSearchBackgroundScheduler {
  private readonly records = new Map<string, WorkRecord>();
  private readonly active = new Map<string, WorkRecord>();
  private readonly activeByRoot = new Map<string, number>();
  private sequence = 0;
  private pumpScheduled = false;
  private paused: boolean;
  private pauseReasons: string[];

  constructor(private readonly options: RelayDocumentSearchBackgroundSchedulerOptions = {}) {
    this.paused = Boolean(options.paused);
    this.pauseReasons = options.pauseReasons ?? [];
  }

  enqueue(
    input: RelayDocumentSearchBackgroundWorkInput,
    runner: RelayDocumentSearchBackgroundWorkRunner,
  ): RelayDocumentSearchBackgroundWorkSnapshot {
    const queued = this.queuedRecords().length;
    const active = this.active.size;
    const maxQueueDepth = Math.max(1, this.options.maxQueueDepth ?? 1000);
    if (queued + active >= maxQueueDepth) {
      throw new Error(`Relay document search background scheduler queue is full (${maxQueueDepth}).`);
    }

    const now = this.nowIso();
    const workId = input.workId ?? `relay-document-search-work-${Date.now().toString(36)}-${this.sequence + 1}`;
    if (this.records.has(workId)) {
      throw new Error(`Relay document search background scheduler work already exists: ${workId}`);
    }

    const snapshot: RelayDocumentSearchBackgroundWorkSnapshot = {
      schemaVersion: RELAY_DOCUMENT_SEARCH_BACKGROUND_SCHEDULER_CONTRACT,
      workId,
      jobId: input.jobId,
      queryId: input.queryId,
      kind: input.kind ?? 'background_content_index',
      priority: input.priority ?? 'normal',
      lifecycle: 'queued',
      roots: normalizedRoots(input.roots),
      cancellable: true,
      cancellationRequested: false,
      enqueuedAt: now,
      updatedAt: now,
    };
    const record: WorkRecord = {
      snapshot,
      runner,
      controller: new AbortController(),
      sequence: this.sequence,
    };
    this.sequence += 1;
    this.records.set(workId, record);
    this.updateQueuePositions();
    this.emit(record);
    this.schedulePump();
    return record.snapshot;
  }

  promote(workId: string, reason = 'foreground_query'): RelayDocumentSearchBackgroundWorkSnapshot | undefined {
    const record = this.records.get(workId);
    if (!record || record.snapshot.lifecycle !== 'queued') return undefined;
    record.snapshot = {
      ...record.snapshot,
      priority: 'foreground',
      promotionReason: reason,
      updatedAt: this.nowIso(),
    };
    this.records.set(workId, record);
    this.updateQueuePositions();
    this.emit(record);
    this.schedulePump();
    return record.snapshot;
  }

  pause(reasons: string[] = ['paused_by_policy']): RelayDocumentSearchBackgroundSchedulerSnapshot {
    this.paused = true;
    this.pauseReasons = reasons.length ? reasons : ['paused_by_policy'];
    return this.snapshot();
  }

  resume(): RelayDocumentSearchBackgroundSchedulerSnapshot {
    this.paused = false;
    this.pauseReasons = [];
    this.schedulePump();
    return this.snapshot();
  }

  requestCancel(workId: string): boolean {
    const record = this.records.get(workId);
    if (!record || terminal(record.snapshot.lifecycle)) return false;
    record.controller.abort();
    const now = this.nowIso();
    if (record.snapshot.lifecycle === 'queued') {
      record.snapshot = {
        ...record.snapshot,
        lifecycle: 'cancelled',
        queuePosition: undefined,
        cancellable: false,
        cancellationRequested: true,
        finishedAt: now,
        updatedAt: now,
      };
      this.records.set(workId, record);
      this.updateQueuePositions();
      this.emit(record);
      this.schedulePump();
      return true;
    }

    record.snapshot = {
      ...record.snapshot,
      cancellationRequested: true,
      updatedAt: now,
    };
    this.records.set(workId, record);
    this.emit(record);
    return true;
  }

  snapshot(): RelayDocumentSearchBackgroundSchedulerSnapshot {
    this.updateQueuePositions();
    const queuedRecords = this.queuedRecords();
    const items = this.sortedRecords().map((record) => record.snapshot);
    const maxConcurrentJobs = this.maxConcurrentJobs();
    const perRootConcurrency = this.perRootConcurrency();
    const rootValues = unique(items.flatMap((item) => item.roots));
    const globalThrottled = queuedRecords.length > 0 && this.active.size >= maxConcurrentJobs;
    const roots = rootValues.map((root) => {
      const queuedJobs = queuedRecords.filter((record) => record.snapshot.roots.includes(root)).length;
      const activeJobs = this.activeByRoot.get(root) ?? 0;
      const rootThrottled = queuedJobs > 0 && activeJobs >= perRootConcurrency;
      const reasons = [
        ...(this.paused ? this.pauseReasons : []),
        ...(globalThrottled ? ['global_concurrency_limit_reached'] : []),
        ...(rootThrottled ? ['per_root_concurrency_limit_reached'] : []),
      ];
      return {
        root,
        queuedJobs,
        activeJobs,
        concurrencyLimit: perRootConcurrency,
        throttled: rootThrottled || globalThrottled,
        paused: this.paused,
        reasons: unique(reasons),
      };
    });
    const throttledRoots = roots.filter((root) => root.throttled).map((root) => root.root);
    const failedJobCount = items.filter((item) => item.lifecycle === 'failed').length;
    const cancelledJobCount = items.filter((item) => item.lifecycle === 'cancelled').length;
    const state = this.schedulerState(queuedRecords.length, throttledRoots.length);

    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_BACKGROUND_SCHEDULER_CONTRACT,
      generatedAt: this.nowIso(),
      state,
      paused: this.paused,
      pauseReasons: this.paused ? this.pauseReasons : [],
      maxConcurrentJobs,
      perRootConcurrency,
      queueDepth: queuedRecords.length,
      activeJobCount: this.active.size,
      completedJobCount: items.filter((item) => item.lifecycle === 'completed').length,
      failedJobCount,
      cancelledJobCount,
      throttledRoots,
      roots,
      items,
    };
  }

  async drain(): Promise<RelayDocumentSearchBackgroundSchedulerSnapshot> {
    this.pump();
    while (!this.paused && (this.active.size > 0 || this.queuedRecords().length > 0)) {
      const activeCompletions = [...this.active.values()]
        .map((record) => record.completion)
        .filter((completion): completion is Promise<void> => Boolean(completion));
      if (activeCompletions.length === 0) {
        this.pump();
        await Promise.resolve();
        if (this.active.size === 0) break;
        continue;
      }
      await Promise.race(activeCompletions);
    }
    return this.snapshot();
  }

  private nowIso(): string {
    return (this.options.now ?? new Date()).toISOString();
  }

  private maxConcurrentJobs(): number {
    return Math.max(1, this.options.maxConcurrentJobs ?? 2);
  }

  private perRootConcurrency(): number {
    return Math.max(1, this.options.perRootConcurrency ?? 1);
  }

  private queuedRecords(): WorkRecord[] {
    return [...this.records.values()].filter((record) => record.snapshot.lifecycle === 'queued');
  }

  private sortedRecords(): WorkRecord[] {
    return [...this.records.values()].sort((left, right) => {
      if (terminal(left.snapshot.lifecycle) !== terminal(right.snapshot.lifecycle)) {
        return terminal(left.snapshot.lifecycle) ? 1 : -1;
      }
      if (left.snapshot.lifecycle === 'running' && right.snapshot.lifecycle !== 'running') return -1;
      if (left.snapshot.lifecycle !== 'running' && right.snapshot.lifecycle === 'running') return 1;
      const priority = PRIORITY_RANK[left.snapshot.priority] - PRIORITY_RANK[right.snapshot.priority];
      if (priority !== 0) return priority;
      return left.sequence - right.sequence;
    });
  }

  private sortedQueuedRecords(): WorkRecord[] {
    return this.queuedRecords().sort((left, right) => {
      const priority = PRIORITY_RANK[left.snapshot.priority] - PRIORITY_RANK[right.snapshot.priority];
      if (priority !== 0) return priority;
      return left.sequence - right.sequence;
    });
  }

  private updateQueuePositions(): void {
    this.sortedQueuedRecords().forEach((record, index) => {
      record.snapshot = {
        ...record.snapshot,
        queuePosition: index + 1,
      };
      this.records.set(record.snapshot.workId, record);
    });
  }

  private schedulerState(queuedCount: number, throttledRootCount: number): RelayDocumentSearchBackgroundSchedulerState {
    if (this.paused) return 'paused';
    if (throttledRootCount > 0 || (queuedCount > 0 && this.active.size >= this.maxConcurrentJobs())) return 'throttled';
    if (this.active.size > 0 || queuedCount > 0) return 'busy';
    return 'clear';
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.paused) return;
    this.updateQueuePositions();
    for (;;) {
      if (this.active.size >= this.maxConcurrentJobs()) return;
      const next = this.sortedQueuedRecords().find((record) => this.canStart(record));
      if (!next) return;
      this.start(next);
    }
  }

  private canStart(record: WorkRecord): boolean {
    if (record.snapshot.lifecycle !== 'queued') return false;
    if (this.active.size >= this.maxConcurrentJobs()) return false;
    return record.snapshot.roots.every((root) => (this.activeByRoot.get(root) ?? 0) < this.perRootConcurrency());
  }

  private start(record: WorkRecord): void {
    const now = this.nowIso();
    record.snapshot = {
      ...record.snapshot,
      lifecycle: 'running',
      queuePosition: undefined,
      startedAt: now,
      updatedAt: now,
    };
    this.records.set(record.snapshot.workId, record);
    this.active.set(record.snapshot.workId, record);
    for (const root of record.snapshot.roots) {
      this.activeByRoot.set(root, (this.activeByRoot.get(root) ?? 0) + 1);
    }
    this.emit(record);

    record.completion = Promise.resolve()
      .then(() => record.runner(record.snapshot, { signal: record.controller.signal }))
      .then((result) => this.finish(record, result))
      .catch((error) => this.fail(record, error));
  }

  private finish(record: WorkRecord, result: RelayDocumentSearchBackgroundWorkResult | void): void {
    const cancelled = record.snapshot.cancellationRequested || record.controller.signal.aborted;
    const now = this.nowIso();
    record.snapshot = {
      ...record.snapshot,
      jobId: result?.jobId ?? record.snapshot.jobId,
      lifecycle: cancelled ? 'cancelled' : 'completed',
      cancellable: false,
      cancellationRequested: cancelled,
      progress: result?.progress ?? record.snapshot.progress,
      resultStatus: result?.status ?? (cancelled ? 'partial' : 'ok'),
      finishedAt: now,
      updatedAt: now,
    };
    this.releaseActive(record);
    this.records.set(record.snapshot.workId, record);
    this.emit(record);
    this.schedulePump();
  }

  private fail(record: WorkRecord, error: unknown): void {
    const cancelled = record.snapshot.cancellationRequested || record.controller.signal.aborted;
    const now = this.nowIso();
    record.snapshot = {
      ...record.snapshot,
      lifecycle: cancelled ? 'cancelled' : 'failed',
      cancellable: false,
      cancellationRequested: cancelled,
      resultStatus: cancelled ? 'partial' : 'failed',
      error: cancelled ? undefined : messageFromError(error),
      finishedAt: now,
      updatedAt: now,
    };
    this.releaseActive(record);
    this.records.set(record.snapshot.workId, record);
    this.emit(record);
    this.schedulePump();
  }

  private releaseActive(record: WorkRecord): void {
    this.active.delete(record.snapshot.workId);
    for (const root of record.snapshot.roots) {
      const nextCount = Math.max(0, (this.activeByRoot.get(root) ?? 0) - 1);
      if (nextCount === 0) {
        this.activeByRoot.delete(root);
      } else {
        this.activeByRoot.set(root, nextCount);
      }
    }
  }

  private emit(record: WorkRecord): void {
    this.options.onEvent?.(record.snapshot, this.snapshot());
  }
}
