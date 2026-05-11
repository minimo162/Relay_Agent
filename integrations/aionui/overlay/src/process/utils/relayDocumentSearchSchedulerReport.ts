/**
 * Scheduler/backpressure report for Relay Document Search.
 *
 * This is a diagnostic contract for the current inline executor and the future
 * background scheduler. It explains why a search is waiting, throttled, paused,
 * or partial without exposing document contents.
 */

import { resolve } from 'path';

export const RELAY_DOCUMENT_SEARCH_SCHEDULER_REPORT_CONTRACT = 'RelayDocumentSearchSchedulerReport.v1' as const;

export type RelayDocumentSearchSchedulerState = 'clear' | 'busy' | 'throttled' | 'paused';

export type RelayDocumentSearchSchedulerRootReport = {
  root: string;
  queueDepth: number;
  promotedFiles: number;
  throttled: boolean;
  paused: boolean;
  concurrencyLimit: number;
  activeJobs: number;
  reasons: string[];
};

export type RelayDocumentSearchSchedulerReportInput = {
  generatedAt: string;
  roots: string[];
  jobId?: string;
  paused?: boolean;
  pauseReasons?: string[];
  scannedFiles: number;
  skippedFiles: number;
  candidateCount: number;
  resultCount: number;
  maxScanFiles: number;
  maxContentInspectFiles: number;
  contentScannedFiles: number;
  contentSkippedFiles: number;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  indexCoordinatorBusy: boolean;
  indexCoordinatorOwnerId?: string;
  perRootConcurrency?: number;
};

export type RelayDocumentSearchSchedulerReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SCHEDULER_REPORT_CONTRACT;
  generatedAt: string;
  mode: 'inline_executor';
  state: RelayDocumentSearchSchedulerState;
  jobId?: string;
  queueDepth: number;
  promotedFiles: number;
  throttledRoots: string[];
  paused: boolean;
  pauseReasons: string[];
  concurrency: {
    perRootLimit: number;
    activeJobs: number;
    indexWriterBusy: boolean;
    indexWriterOwnerId?: string;
  };
  budgets: {
    maxScanFiles: number;
    maxContentInspectFiles: number;
    scannedFiles: number;
    skippedFiles: number;
    contentScannedFiles: number;
    contentSkippedFiles: number;
  };
  roots: RelayDocumentSearchSchedulerRootReport[];
  reasons: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function schedulerState(input: RelayDocumentSearchSchedulerReportInput, reasons: string[]): RelayDocumentSearchSchedulerState {
  if (input.paused || input.cancelled) return 'paused';
  if (input.indexCoordinatorBusy) return 'busy';
  if (input.truncated || input.timedOut || input.contentScannedFiles >= input.maxContentInspectFiles) return 'throttled';
  return reasons.length ? 'throttled' : 'clear';
}

function reportReasons(input: RelayDocumentSearchSchedulerReportInput): string[] {
  const reasons: string[] = [];
  if (input.paused) reasons.push(...(input.pauseReasons?.length ? input.pauseReasons : ['paused_by_policy']));
  if (input.cancelled) reasons.push('cancelled');
  if (input.timedOut) reasons.push('timeout_budget_reached');
  if (input.truncated) reasons.push('scan_file_budget_reached');
  if (input.indexCoordinatorBusy) reasons.push('index_writer_busy');
  if (input.contentScannedFiles >= input.maxContentInspectFiles && input.candidateCount > input.contentScannedFiles) {
    reasons.push('content_inspection_budget_reached');
  }
  return unique(reasons);
}

export function buildRelayDocumentSearchSchedulerReport(
  input: RelayDocumentSearchSchedulerReportInput,
): RelayDocumentSearchSchedulerReport {
  const perRootLimit = Math.max(1, input.perRootConcurrency ?? 1);
  const queueDepth = Math.max(0, input.candidateCount - input.contentScannedFiles);
  const promotedFiles = Math.min(input.candidateCount, input.contentScannedFiles);
  const reasons = reportReasons(input);
  const state = schedulerState(input, reasons);
  const throttled = state === 'throttled' || input.indexCoordinatorBusy || input.timedOut || input.truncated;
  const throttledRoots = throttled ? input.roots.map((root) => resolve(root)) : [];
  const rootCount = Math.max(1, input.roots.length);
  const perRootQueueDepth = Math.ceil(queueDepth / rootCount);
  const perRootPromotedFiles = Math.ceil(promotedFiles / rootCount);
  const roots = input.roots.map((root) => ({
    root: resolve(root),
    queueDepth: perRootQueueDepth,
    promotedFiles: perRootPromotedFiles,
    throttled,
    paused: Boolean(input.paused || input.cancelled),
    concurrencyLimit: perRootLimit,
    activeJobs: input.indexCoordinatorBusy ? 1 : 0,
    reasons,
  }));

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SCHEDULER_REPORT_CONTRACT,
    generatedAt: input.generatedAt,
    mode: 'inline_executor',
    state,
    jobId: input.jobId,
    queueDepth,
    promotedFiles,
    throttledRoots,
    paused: Boolean(input.paused || input.cancelled),
    pauseReasons: input.paused ? (input.pauseReasons ?? ['paused_by_policy']) : input.cancelled ? ['cancelled'] : [],
    concurrency: {
      perRootLimit,
      activeJobs: input.indexCoordinatorBusy ? 1 : 0,
      indexWriterBusy: input.indexCoordinatorBusy,
      indexWriterOwnerId: input.indexCoordinatorOwnerId,
    },
    budgets: {
      maxScanFiles: input.maxScanFiles,
      maxContentInspectFiles: input.maxContentInspectFiles,
      scannedFiles: input.scannedFiles,
      skippedFiles: input.skippedFiles,
      contentScannedFiles: input.contentScannedFiles,
      contentSkippedFiles: input.contentSkippedFiles,
    },
    roots,
    reasons,
  };
}
