/**
 * In-process lifecycle coordinator for Relay Document Search jobs.
 *
 * This is not the final durable index/store lock. It is the first product
 * lifecycle boundary: one active job per equivalent request, cancellable
 * execution, retry tokens, duplicate-submit attachment, and structured
 * terminal results.
 */

import {
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  type RelayDocumentSearchResultV1,
  validateRelayDocumentSearchRequest,
} from './relayDocumentSearchContract';
import {
  executeRelayDocumentSearch,
  type RelayDocumentSearchExecutorOptions,
} from './relayDocumentSearchExecutor';
import { emptyRelayDocumentSearchEvidencePack } from './relayDocumentSearchEvidencePack';
import {
  findActiveRelayDocumentSearchJobByFingerprint,
  relayDocumentSearchJobStoreEnabled,
  recoverRelayDocumentSearchJobStore,
  writeRelayDocumentSearchJobSnapshot,
  type RelayDocumentSearchJobStoreOptions,
} from './relayDocumentSearchJobStore';

export const RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT = 'RelayDocumentSearchJobLifecycle.v1' as const;

export type RelayDocumentSearchJobSnapshot = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT;
  jobId: string;
  queryId?: string;
  requestFingerprint: string;
  lifecycle: RelayDocumentSearchResultV1['job']['lifecycle'];
  cancellable: boolean;
  retryToken: string;
  duplicateSubmitCorrelationId?: string;
  progress: RelayDocumentSearchResultV1['progress'];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type RelayDocumentSearchJobRunOptions = RelayDocumentSearchExecutorOptions & RelayDocumentSearchJobStoreOptions & {
  jobRegistry?: RelayDocumentSearchJobRegistry;
};

export type RelayDocumentSearchRunner = (
  rawRequest: unknown,
  options: RelayDocumentSearchExecutorOptions,
) => Promise<RelayDocumentSearchResultV1>;

type StartedJob = {
  kind: 'started';
  snapshot: RelayDocumentSearchJobSnapshot;
  controller: AbortController;
};

type DuplicateJob = {
  kind: 'duplicate';
  snapshot: RelayDocumentSearchJobSnapshot;
  duplicateSubmitCorrelationId: string;
  source: 'memory' | 'job_store';
};

type JobEntry = {
  snapshot: RelayDocumentSearchJobSnapshot;
  controller: AbortController;
};

function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(rawRequest: unknown): string {
  const parsed = validateRelayDocumentSearchRequest(rawRequest);
  return stableId(stableStringify(parsed.ok ? parsed.value : rawRequest));
}

function nowIso(options: RelayDocumentSearchJobRunOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function activeLifecycle(lifecycle: RelayDocumentSearchJobSnapshot['lifecycle']): boolean {
  return lifecycle === 'queued' || lifecycle === 'running';
}

function persistJobSnapshotIfEnabled(
  snapshot: RelayDocumentSearchJobSnapshot,
  options: RelayDocumentSearchJobRunOptions,
): void {
  if (!relayDocumentSearchJobStoreEnabled(options)) return;
  writeRelayDocumentSearchJobSnapshot(snapshot, options);
}

export class RelayDocumentSearchJobRegistry {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly activeByFingerprint = new Map<string, string>();

  begin(rawRequest: unknown, options: RelayDocumentSearchJobRunOptions = {}): StartedJob | DuplicateJob {
    const fingerprint = requestFingerprint(rawRequest);
    const activeJobId = this.activeByFingerprint.get(fingerprint);
    if (activeJobId) {
      const active = this.jobs.get(activeJobId);
      if (active && activeLifecycle(active.snapshot.lifecycle)) {
        const duplicateSubmitCorrelationId = `dup-${stableId(`${activeJobId}:${Date.now()}`)}`;
        active.snapshot = {
          ...active.snapshot,
          duplicateSubmitCorrelationId,
          updatedAt: nowIso(options),
        };
        this.jobs.set(activeJobId, active);
        return {
          kind: 'duplicate',
          snapshot: active.snapshot,
          duplicateSubmitCorrelationId,
          source: 'memory',
        };
      }
    }

    if (relayDocumentSearchJobStoreEnabled(options)) {
      recoverRelayDocumentSearchJobStore(options);
      const active = findActiveRelayDocumentSearchJobByFingerprint(fingerprint, options);
      if (active && activeLifecycle(active.lifecycle)) {
        const duplicateSubmitCorrelationId = `dup-${stableId(`${active.jobId}:${Date.now()}`)}`;
        const snapshot = {
          ...active,
          duplicateSubmitCorrelationId,
          updatedAt: nowIso(options),
        };
        persistJobSnapshotIfEnabled(snapshot, options);
        return {
          kind: 'duplicate',
          snapshot,
          duplicateSubmitCorrelationId,
          source: 'job_store',
        };
      }
    }

    const createdAt = nowIso(options);
    const jobId = options.jobId ?? `job-${Date.now().toString(36)}-${fingerprint}`;
    const controller = new AbortController();
    const snapshot: RelayDocumentSearchJobSnapshot = {
      schemaVersion: RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT,
      jobId,
      queryId: options.queryId,
      requestFingerprint: fingerprint,
      lifecycle: 'queued',
      cancellable: true,
      retryToken: `${jobId}:retry`,
      progress: { stage: 'queued', percent: 0, scannedFiles: 0, skippedFiles: 0 },
      createdAt,
      updatedAt: createdAt,
    };
    this.jobs.set(jobId, { snapshot, controller });
    this.activeByFingerprint.set(fingerprint, jobId);
    persistJobSnapshotIfEnabled(snapshot, options);
    return {
      kind: 'started',
      snapshot,
      controller,
    };
  }

  markRunning(jobId: string, options: RelayDocumentSearchJobRunOptions = {}): RelayDocumentSearchJobSnapshot | undefined {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    entry.snapshot = {
      ...entry.snapshot,
      lifecycle: 'running',
      cancellable: true,
      progress: { ...entry.snapshot.progress, stage: 'running', percent: Math.max(1, entry.snapshot.progress.percent) },
      updatedAt: nowIso(options),
    };
    this.jobs.set(jobId, entry);
    persistJobSnapshotIfEnabled(entry.snapshot, options);
    return entry.snapshot;
  }

  updateProgress(
    jobId: string,
    progress: RelayDocumentSearchResultV1['progress'],
    options: RelayDocumentSearchJobRunOptions = {},
  ): RelayDocumentSearchJobSnapshot | undefined {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    entry.snapshot = {
      ...entry.snapshot,
      progress,
      updatedAt: nowIso(options),
    };
    this.jobs.set(jobId, entry);
    persistJobSnapshotIfEnabled(entry.snapshot, options);
    return entry.snapshot;
  }

  requestCancel(jobId: string, options: RelayDocumentSearchJobRunOptions = {}): boolean {
    const entry = this.jobs.get(jobId);
    if (!entry || !activeLifecycle(entry.snapshot.lifecycle)) return false;
    entry.controller.abort();
    entry.snapshot = {
      ...entry.snapshot,
      lifecycle: 'cancelled',
      cancellable: false,
      progress: { ...entry.snapshot.progress, stage: 'cancel_requested' },
      updatedAt: nowIso(options),
    };
    this.jobs.set(jobId, entry);
    this.activeByFingerprint.delete(entry.snapshot.requestFingerprint);
    persistJobSnapshotIfEnabled(entry.snapshot, options);
    return true;
  }

  complete(
    jobId: string,
    result: RelayDocumentSearchResultV1,
    options: RelayDocumentSearchJobRunOptions = {},
  ): RelayDocumentSearchResultV1 {
    const entry = this.jobs.get(jobId);
    if (!entry) return result;
    const finishedAt = nowIso(options);
    const lifecycle = result.job.lifecycle;
    entry.snapshot = {
      ...entry.snapshot,
      lifecycle,
      cancellable: false,
      retryToken: result.job.retryToken ?? entry.snapshot.retryToken,
      progress: result.progress,
      updatedAt: finishedAt,
      finishedAt,
    };
    this.jobs.set(jobId, entry);
    this.activeByFingerprint.delete(entry.snapshot.requestFingerprint);
    persistJobSnapshotIfEnabled(entry.snapshot, options);
    return {
      ...result,
      job: {
        ...result.job,
        jobId,
        lifecycle,
        cancellable: false,
        retryToken: result.job.retryToken ?? entry.snapshot.retryToken,
        duplicateSubmitCorrelationId: entry.snapshot.duplicateSubmitCorrelationId,
      },
      correlation: {
        ...result.correlation,
        relayJobId: jobId,
        queryId: options.queryId,
      },
      diagnostics: {
        ...result.diagnostics,
        jobLifecycle: RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT,
        retryToken: result.job.retryToken ?? entry.snapshot.retryToken,
      },
    };
  }

  get(jobId: string): RelayDocumentSearchJobSnapshot | undefined {
    return this.jobs.get(jobId)?.snapshot;
  }

  list(): RelayDocumentSearchJobSnapshot[] {
    return [...this.jobs.values()].map((entry) => entry.snapshot);
  }
}

export const defaultRelayDocumentSearchJobRegistry = new RelayDocumentSearchJobRegistry();

function duplicateResult(snapshot: RelayDocumentSearchJobSnapshot, source: DuplicateJob['source']): RelayDocumentSearchResultV1 {
  const generatedAt = snapshot.updatedAt || snapshot.createdAt || new Date().toISOString();
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    status: 'partial',
    progress: snapshot.progress,
    job: {
      jobId: snapshot.jobId,
      lifecycle: snapshot.lifecycle,
      cancellable: snapshot.cancellable,
      retryToken: snapshot.retryToken,
      duplicateSubmitCorrelationId: snapshot.duplicateSubmitCorrelationId,
    },
    correlation: {
      relayJobId: snapshot.jobId,
      queryId: snapshot.queryId,
    },
    queryPlan: {},
    coverage: { searchedRoots: [], incompleteRoots: [], duplicateSubmit: true },
    results: [],
    evidencePack: emptyRelayDocumentSearchEvidencePack({
      jobId: snapshot.jobId,
      queryId: snapshot.queryId,
      generatedAt,
      warnings: [{ code: 'duplicate_submit_attached', message: 'Attached to an already running search job.' }],
    }),
    display: {
      beginnerSummary: '同じ検索がすでに進行中です。既存の検索に接続しました。',
      emptyStateGuidance: [],
      refineActions: [],
    },
    diagnostics: {
      jobLifecycle: RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT,
      duplicateSubmitCorrelationId: snapshot.duplicateSubmitCorrelationId,
      duplicateSubmitSource: source,
      jobStoreAttached: source === 'job_store',
    },
  };
}

export async function runRelayDocumentSearchJob(
  rawRequest: unknown,
  options: RelayDocumentSearchJobRunOptions = {},
  runner: RelayDocumentSearchRunner = executeRelayDocumentSearch,
): Promise<RelayDocumentSearchResultV1> {
  const registry = options.jobRegistry ?? defaultRelayDocumentSearchJobRegistry;
  const begin = registry.begin(rawRequest, options);
  if (begin.kind === 'duplicate') return duplicateResult(begin.snapshot, begin.source);

  const { snapshot, controller } = begin;
  registry.markRunning(snapshot.jobId, options);

  const abortFromCaller = () => registry.requestCancel(snapshot.jobId, options);
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const result = await runner(rawRequest, {
      ...options,
      jobId: snapshot.jobId,
      signal: controller.signal,
      onProgress: (progress) => {
        registry.updateProgress(snapshot.jobId, progress, options);
        options.onProgress?.(progress);
      },
    });
    return registry.complete(snapshot.jobId, result, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return registry.complete(
      snapshot.jobId,
      {
        schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
        status: 'failed',
        progress: { stage: 'failed', percent: 100, scannedFiles: 0, skippedFiles: 0 },
        job: { jobId: snapshot.jobId, lifecycle: 'failed', cancellable: false, retryToken: snapshot.retryToken },
        correlation: {
          relayJobId: snapshot.jobId,
          queryId: options.queryId,
          aionuiConversationId: options.aionuiConversationId,
          aionuiMessageId: options.aionuiMessageId,
        },
        queryPlan: {},
        coverage: { searchedRoots: [], incompleteRoots: [] },
        results: [],
        evidencePack: emptyRelayDocumentSearchEvidencePack({
          jobId: snapshot.jobId,
          queryId: options.queryId,
          generatedAt: (options.now ?? new Date()).toISOString(),
          warnings: [{ code: 'job_failed', message }],
        }),
        display: {
          beginnerSummary: '検索を実行できませんでした。',
          emptyStateGuidance: ['時間をおいてもう一度試してください。'],
        },
        diagnostics: { error: message },
      },
      options,
    );
  } finally {
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
