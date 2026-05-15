/**
 * Per-root index/search report for Relay Document Search.
 *
 * This report answers "what did Relay actually search?" without exposing
 * document contents. It is intended for AionUi result cards, support details,
 * and future cache repair actions.
 */

import { resolve } from 'path';

import type { RelayDocumentSearchResultV1, RelayDocumentSearchStatus } from './relayDocumentSearchContract';
import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';

export const RELAY_DOCUMENT_SEARCH_INDEX_REPORT_CONTRACT = 'RelayDocumentSearchIndexReport.v1' as const;

export type RelayDocumentSearchRootIndexReport = {
  root: string;
  state: 'ready' | 'partial' | 'cancelled' | 'timed_out';
  scannedFiles: number;
  metadataReadyFiles: number;
  filenameSearchableFiles: number;
  contentReadyFiles: number;
  candidateCount: number;
  inaccessiblePathCount: number;
  skippedExtensionCounts: Record<string, number>;
  cache: {
    metadata: 'hit' | 'miss' | 'written' | 'write_error' | 'disabled';
    filenameIndex: 'hit' | 'miss' | 'written' | 'write_error' | 'disabled';
  };
  warnings: string[];
};

export type RelayDocumentSearchIndexReportV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_REPORT_CONTRACT;
  generatedAt: string;
  status: RelayDocumentSearchStatus;
  roots: RelayDocumentSearchRootIndexReport[];
  summary: {
    rootCount: number;
    scannedFiles: number;
    metadataReadyFiles: number;
    filenameSearchableFiles: number;
    contentReadyFiles: number;
    candidateCount: number;
    inaccessiblePathCount: number;
    incompleteRootCount: number;
  };
  cache?: {
    parsedDocument?: RelayDocumentSearchIndexReportCacheSummary;
    derivedContentIndex?: RelayDocumentSearchIndexReportCacheSummary;
  };
};

export type RelayDocumentSearchIndexReportCacheSummary = {
  enabled: boolean;
  policyDenied: boolean;
  quotaPressure: boolean;
  quotaRunCount: number;
  totalBytes: number;
  maxCacheBytes: number;
  entryCount: number;
  maxCacheEntries: number;
  evictedCount: number;
  evictedBytes: number;
  writeErrorCount: number;
};

type RelayDocumentSearchIndexReportCacheInput = {
  enabled: boolean;
  policies?: Array<{ readAllowed: boolean; writeAllowed: boolean }>;
  quotas?: Array<{
    entryCount: number;
    totalBytes: number;
    maxCacheEntries: number;
    maxCacheBytes: number;
    quotaPressure: boolean;
    evicted?: Array<{ bytes?: number }>;
  }>;
  writeErrors?: unknown[];
};

export type RelayDocumentSearchIndexReportInput = {
  generatedAt: string;
  status: RelayDocumentSearchStatus;
  roots: string[];
  allFiles: RelayDocumentSearchCachedFileMetadata[];
  filteredFiles: RelayDocumentSearchCachedFileMetadata[];
  results: RelayDocumentSearchResultV1['results'];
  contentEvidenceFileIds: string[];
  inaccessiblePaths: string[];
  requestedFileTypes: string[];
  cancelled: boolean;
  timedOut: boolean;
  truncated: boolean;
  metadataCache: {
    hits: string[];
    misses: string[];
    writes: string[];
    writeErrors: Array<{ root: string }>;
  };
  filenameIndex: {
    enabled: boolean;
    readHits: string[];
    readMisses: string[];
    writes: string[];
    writeErrors: Array<{ root: string }>;
  };
  contentCaches?: {
    parsedDocument?: RelayDocumentSearchIndexReportCacheInput;
    derivedContentIndex?: RelayDocumentSearchIndexReportCacheInput;
  };
};

function sameRoot(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function isUnderRoot(root: string, path: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`) ||
    normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function cacheStateForRoot(
  root: string,
  cache: { hits: string[]; misses: string[]; writes: string[]; writeErrors: Array<{ root: string }> },
): RelayDocumentSearchRootIndexReport['cache']['metadata'] {
  if (cache.writeErrors.some((error) => sameRoot(error.root, root))) return 'write_error';
  if (cache.hits.some((item) => sameRoot(item, root))) return 'hit';
  if (cache.writes.some((item) => sameRoot(item, root))) return 'written';
  if (cache.misses.some((item) => sameRoot(item, root))) return 'miss';
  return 'disabled';
}

function filenameIndexStateForRoot(
  root: string,
  index: RelayDocumentSearchIndexReportInput['filenameIndex'],
): RelayDocumentSearchRootIndexReport['cache']['filenameIndex'] {
  if (!index.enabled) return 'disabled';
  if (index.writeErrors.some((error) => sameRoot(error.root, root))) return 'write_error';
  if (index.readHits.some((item) => sameRoot(item, root))) return 'hit';
  if (index.writes.some((item) => sameRoot(item, root))) return 'written';
  if (index.readMisses.some((item) => sameRoot(item, root))) return 'miss';
  return 'miss';
}

function rootState(
  input: RelayDocumentSearchIndexReportInput,
  inaccessiblePathCount: number,
): RelayDocumentSearchRootIndexReport['state'] {
  if (input.cancelled) return 'cancelled';
  if (input.timedOut) return 'timed_out';
  if (input.truncated || inaccessiblePathCount > 0 || input.status === 'partial') return 'partial';
  return 'ready';
}

function skippedExtensionCounts(
  files: RelayDocumentSearchCachedFileMetadata[],
  requestedFileTypes: string[],
): Record<string, number> {
  if (requestedFileTypes.includes('any')) return {};
  const requested = new Set(requestedFileTypes);
  const out: Record<string, number> = {};
  for (const file of files) {
    if (requested.has(file.extension)) continue;
    const key = file.extension || '(none)';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function rootWarnings(report: {
  state: RelayDocumentSearchRootIndexReport['state'];
  inaccessiblePathCount: number;
  skippedExtensionCounts: Record<string, number>;
  filenameSearchableFiles: number;
  contentReadyFiles: number;
}): string[] {
  const warnings: string[] = [];
  if (report.state === 'cancelled') warnings.push('cancelled');
  if (report.state === 'timed_out') warnings.push('timed_out');
  if (report.inaccessiblePathCount > 0) warnings.push('inaccessible_paths');
  if (Object.keys(report.skippedExtensionCounts).length > 0) warnings.push('extension_filter_applied');
  if (report.filenameSearchableFiles > 0 && report.contentReadyFiles === 0) warnings.push('filename_only_candidates');
  return warnings;
}

function cacheSummary(cache: RelayDocumentSearchIndexReportCacheInput | undefined): RelayDocumentSearchIndexReportCacheSummary | undefined {
  if (!cache) return undefined;
  const quotas = Array.isArray(cache.quotas) ? cache.quotas : [];
  const latestQuota = quotas.at(-1);
  return {
    enabled: Boolean(cache.enabled),
    policyDenied: Array.isArray(cache.policies)
      ? cache.policies.some((policy) => !policy.readAllowed || !policy.writeAllowed)
      : false,
    quotaPressure: quotas.some((quota) => quota.quotaPressure),
    quotaRunCount: quotas.length,
    totalBytes: latestQuota?.totalBytes ?? 0,
    maxCacheBytes: latestQuota?.maxCacheBytes ?? 0,
    entryCount: latestQuota?.entryCount ?? 0,
    maxCacheEntries: latestQuota?.maxCacheEntries ?? 0,
    evictedCount: quotas.reduce((sum, quota) => sum + (quota.evicted?.length ?? 0), 0),
    evictedBytes: quotas.reduce(
      (sum, quota) =>
        sum + (quota.evicted ?? []).reduce((evictedSum, eviction) => evictedSum + (eviction.bytes ?? 0), 0),
      0,
    ),
    writeErrorCount: Array.isArray(cache.writeErrors) ? cache.writeErrors.length : 0,
  };
}

export function buildRelayDocumentSearchIndexReport(
  input: RelayDocumentSearchIndexReportInput,
): RelayDocumentSearchIndexReportV1 {
  const contentEvidenceFileIds = new Set(input.contentEvidenceFileIds);
  const resultFileIds = new Set(input.results.map((result) => String(result.file_id)));
  const rootReports = input.roots.map((root) => {
    const allRootFiles = input.allFiles.filter((file) => sameRoot(file.root, root));
    const filteredRootFiles = input.filteredFiles.filter((file) => sameRoot(file.root, root));
    const inaccessiblePathCount = input.inaccessiblePaths.filter((path) => isUnderRoot(root, path)).length;
    const contentReadyFiles = filteredRootFiles.filter((file) => contentEvidenceFileIds.has(file.fileId)).length;
    const candidateCount = filteredRootFiles.filter((file) => resultFileIds.has(file.fileId)).length;
    const skippedCounts = skippedExtensionCounts(allRootFiles, input.requestedFileTypes);
    const state = rootState(input, inaccessiblePathCount);
    const report = {
      root,
      state,
      scannedFiles: allRootFiles.length,
      metadataReadyFiles: allRootFiles.length,
      filenameSearchableFiles: filteredRootFiles.length,
      contentReadyFiles,
      candidateCount,
      inaccessiblePathCount,
      skippedExtensionCounts: skippedCounts,
      cache: {
        metadata: cacheStateForRoot(root, input.metadataCache),
        filenameIndex: filenameIndexStateForRoot(root, input.filenameIndex),
      },
      warnings: [] as string[],
    };
    report.warnings = rootWarnings(report);
    return report;
  });

  const parsedDocumentCache = cacheSummary(input.contentCaches?.parsedDocument);
  const derivedContentIndexCache = cacheSummary(input.contentCaches?.derivedContentIndex);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_REPORT_CONTRACT,
    generatedAt: input.generatedAt,
    status: input.status,
    roots: rootReports,
    summary: {
      rootCount: rootReports.length,
      scannedFiles: rootReports.reduce((sum, report) => sum + report.scannedFiles, 0),
      metadataReadyFiles: rootReports.reduce((sum, report) => sum + report.metadataReadyFiles, 0),
      filenameSearchableFiles: rootReports.reduce((sum, report) => sum + report.filenameSearchableFiles, 0),
      contentReadyFiles: rootReports.reduce((sum, report) => sum + report.contentReadyFiles, 0),
      candidateCount: rootReports.reduce((sum, report) => sum + report.candidateCount, 0),
      inaccessiblePathCount: rootReports.reduce((sum, report) => sum + report.inaccessiblePathCount, 0),
      incompleteRootCount: rootReports.filter((report) => report.state !== 'ready').length,
    },
    cache: parsedDocumentCache || derivedContentIndexCache
      ? {
          parsedDocument: parsedDocumentCache,
          derivedContentIndex: derivedContentIndexCache,
        }
      : undefined,
  };
}
