/**
 * Rebuildable derived content index for Relay Document Search.
 *
 * This module consumes ParsedDocument IR and emits query-independent content
 * entries plus preview anchors. It never walks the filesystem or parses files;
 * callers rebuild it from ParsedDocument whenever the source metadata or parser
 * version changes.
 */

import { createHash } from 'crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

import { normalizeRelaySearchText } from './relayDocumentSearchQueryPlan';
import type { RelayDocumentSearchFreshnessReport } from './relayDocumentSearchFreshness';
import type {
  RelayParsedDocument,
  RelayParsedDocumentStructureProfileStatus,
  RelayParsedDocumentStructureProfileValidation,
  RelayTreeNode,
  RelayCellWithMeta,
  RelayTable,
} from './relayParsedDocumentIr';
import {
  RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
  validateRelayParsedDocumentStructureProfile,
} from './relayParsedDocumentIr';

export const RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT =
  'RelayDocumentSearchDerivedContentIndex.v1' as const;
export const RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT = 'RelayDocumentSearchPreviewAnchor.v1' as const;
export const RELAY_DOCUMENT_SEARCH_PREVIEW_SPAN_CONTRACT = 'RelayDocumentSearchPreviewSpan.v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT =
  'RelayDocumentSearchDerivedSearchStore.v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_INDEX_OWNERSHIP_CONTRACT =
  'RelayDocumentSearchDerivedIndexOwnership.v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT =
  'RelayDocumentSearchDerivedContentIndexCache.v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION =
  'relay-derived-content-index-cache-key-v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY_CONTRACT =
  'RelayDocumentSearchDerivedContentIndexCachePolicy.v1' as const;
export const RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_STAGE_CONTRACT =
  'RelayDocumentSearchDerivedContentIndexCacheStage.v1' as const;

export type RelayDocumentSearchDerivedContentIndexCacheProtectionMode =
  | 'plaintext_allowed'
  | 'protection_required'
  | 'disabled';

export type RelayDocumentSearchDerivedEntryKind = 'text' | 'table_cell';

export type RelayDocumentSearchPreviewAnchor = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT;
  kind: RelayDocumentSearchDerivedEntryKind;
  title: string;
  locationLabel: string;
  snippet: string;
  sourceFileId: string;
  sourceMetadataVersion: string;
  parsedDocumentUid: string;
  parserVersion: string;
};

export type RelayDocumentSearchPreviewHighlight = {
  term: string;
  start: number;
  end: number;
};

export type RelayDocumentSearchPreviewSpan = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_PREVIEW_SPAN_CONTRACT;
  span_id: string;
  entry_id: string;
  kind: RelayDocumentSearchDerivedEntryKind;
  title: string;
  locationLabel: string;
  snippet: string;
  matched_terms: string[];
  highlights: RelayDocumentSearchPreviewHighlight[];
  sourceFileId: string;
  sourceMetadataVersion: string;
  parsedDocumentUid: string;
  parserVersion: string;
  anchor: RelayDocumentSearchPreviewAnchor;
};

export type RelayDocumentSearchDerivedContentEntry = {
  entry_id: string;
  entry_kind: RelayDocumentSearchDerivedEntryKind;
  text: string;
  normalized_text: string;
  anchor: Record<string, unknown>;
  preview: RelayDocumentSearchPreviewAnchor;
};

export type RelayDocumentSearchDerivedContentIndexStructureProfileDiagnostics = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT;
  profile: string;
  status: RelayParsedDocumentStructureProfileStatus;
  treeNodeCount: number;
  tableCount: number;
  cellCount: number;
  annotationCount: number;
  warningCount: number;
  errorCount: number;
  lossyWarningCount: number;
  unsupportedWarningCount: number;
};

export type RelayDocumentSearchDerivedContentIndexV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT;
  source_file_id: string;
  source_metadata_version: string;
  parsed_document_uid: string;
  parsed_document_version: string;
  parser: {
    name: string;
    version: string;
    profile: string;
  };
  entries: RelayDocumentSearchDerivedContentEntry[];
  diagnostics: {
    textEntryCount: number;
    tableCellEntryCount: number;
    previewAnchorCount: number;
    structureProfile: RelayDocumentSearchDerivedContentIndexStructureProfileDiagnostics;
  };
};

export type RelayDocumentSearchDerivedSearchStoreRow = {
  row_id: string;
  entry_id: string;
  entry_kind: RelayDocumentSearchDerivedEntryKind;
  normalized_text: string;
  anchor: Record<string, unknown>;
  preview: RelayDocumentSearchPreviewAnchor;
};

export type RelayDocumentSearchDerivedSearchStoreV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT;
  source_file_id: string;
  source_metadata_version: string;
  parsed_document_uid: string;
  parsed_document_version: string;
  parser: {
    name: string;
    version: string;
    profile: string;
  };
  rows: RelayDocumentSearchDerivedSearchStoreRow[];
  diagnostics: {
    rowCount: number;
    textRowCount: number;
    tableCellRowCount: number;
    previewSpanSeedCount: number;
    structureProfileStatus: RelayParsedDocumentStructureProfileStatus;
  };
};

export type RelayDocumentSearchDerivedContentMatch = {
  entry: RelayDocumentSearchDerivedContentEntry;
  score: number;
  matchedTerms: string[];
  anchor: Record<string, unknown>;
  previewSpan: RelayDocumentSearchPreviewSpan;
};

export type RelayDocumentSearchDerivedContentSearchResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT;
  score: number;
  anchors: Array<Record<string, unknown>>;
  preview_spans: RelayDocumentSearchPreviewSpan[];
  matches: RelayDocumentSearchDerivedContentMatch[];
  diagnostics: {
    searchedEntryCount: number;
    matchedEntryCount: number;
    returnedAnchorCount: number;
    returnedPreviewSpanCount: number;
  };
};

export type RelayDocumentSearchDerivedSearchStoreMatch = {
  row: RelayDocumentSearchDerivedSearchStoreRow;
  score: number;
  matchedTerms: string[];
  anchor: Record<string, unknown>;
  previewSpan: RelayDocumentSearchPreviewSpan;
};

export type RelayDocumentSearchDerivedSearchStoreSearchResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT;
  score: number;
  anchors: Array<Record<string, unknown>>;
  preview_spans: RelayDocumentSearchPreviewSpan[];
  matches: RelayDocumentSearchDerivedSearchStoreMatch[];
  diagnostics: {
    searchedRowCount: number;
    matchedRowCount: number;
    searchedEntryCount: number;
    matchedEntryCount: number;
    returnedAnchorCount: number;
    returnedPreviewSpanCount: number;
  };
};

export type RelayDocumentSearchDerivedIndexOwnershipMove = {
  previous_file_id: string;
  current_file_id: string;
  previous_path: string;
  current_path: string;
  previous_source_metadata_version: string;
  current_source_metadata_version: string;
  move_confidence: 'high';
  ownership_owner_file_id: string;
  ownership_source_metadata_version: string;
  ownership_action: 'transfer_on_rebuild';
  cache_reuse_allowed: false;
  reason: 'source_path_or_metadata_changed';
};

export type RelayDocumentSearchDerivedIndexOwnershipReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_INDEX_OWNERSHIP_CONTRACT;
  highConfidenceMoveCount: number;
  transferOnRebuildCount: number;
  cacheReuseAllowedCount: 0;
  moves: RelayDocumentSearchDerivedIndexOwnershipMove[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchDerivedContentSearchOptions = {
  maxAnchors?: number;
};

export type RelayDocumentSearchDerivedContentIndexCacheOptions = {
  cacheDir?: string;
  maxAgeMs?: number;
  lockStaleMs?: number;
  maxCacheBytes?: number;
  maxCacheEntries?: number;
  enforceQuota?: boolean;
  cacheProtectionMode?: RelayDocumentSearchDerivedContentIndexCacheProtectionMode;
  protectedAtRest?: boolean;
  now?: Date;
  onQuota?: (result: RelayDocumentSearchDerivedContentIndexCacheQuotaResult) => void;
  onPolicy?: (result: RelayDocumentSearchDerivedContentIndexCachePolicyResult) => void;
};

export type RelayDocumentSearchDerivedContentIndexCachePolicyResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY_CONTRACT;
  cacheDir: string;
  mode: RelayDocumentSearchDerivedContentIndexCacheProtectionMode;
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

export type RelayDocumentSearchDerivedContentIndexCacheQuotaResult = {
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

export type RelayDocumentSearchDerivedContentIndexCacheRecord = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT;
  cacheKeyVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION;
  cacheKey: string;
  generatedAt: string;
  sourceFileId: string;
  sourcePath: string;
  sourceMetadataVersion: string;
  parsedDocumentUid: string;
  parsedDocumentVersion: string;
  parserVersion: string;
  index: RelayDocumentSearchDerivedContentIndexV1;
  searchStore: RelayDocumentSearchDerivedSearchStoreV1;
};

export type RelayDocumentSearchDerivedContentIndexCacheStage = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_STAGE_CONTRACT;
  cacheKey: string;
  activePath: string;
  stagingPath: string;
  record: RelayDocumentSearchDerivedContentIndexCacheRecord;
  promote: () => Promise<RelayDocumentSearchDerivedContentIndexCacheRecord>;
  discard: () => Promise<void>;
};

const DEFAULT_MAX_ANCHORS = 3;
const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 1000;
const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 20_000;

function defaultCacheDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'derived-content-index-cache');
}

export function relayDocumentSearchDerivedContentIndexCacheDir(
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): string {
  return resolve(
    options.cacheDir ||
      process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR ||
      defaultCacheDir(),
  );
}

function parsedPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function maxCacheBytes(options: RelayDocumentSearchDerivedContentIndexCacheOptions): number {
  return Math.max(
    1,
    options.maxCacheBytes ??
      parsedPositiveInteger(process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_MAX_BYTES) ??
      DEFAULT_MAX_CACHE_BYTES,
  );
}

function maxCacheEntries(options: RelayDocumentSearchDerivedContentIndexCacheOptions): number {
  return Math.max(
    1,
    options.maxCacheEntries ??
      parsedPositiveInteger(process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_MAX_ENTRIES) ??
      DEFAULT_MAX_CACHE_ENTRIES,
  );
}

function quotaEnforcementEnabled(options: RelayDocumentSearchDerivedContentIndexCacheOptions): boolean {
  if (options.enforceQuota !== undefined) return options.enforceQuota;
  return process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_ENFORCE_QUOTA !== '0';
}

function cacheProtectionMode(
  options: RelayDocumentSearchDerivedContentIndexCacheOptions,
): RelayDocumentSearchDerivedContentIndexCacheProtectionMode {
  if (options.cacheProtectionMode) return options.cacheProtectionMode;
  const envMode = process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY;
  if (envMode === 'disabled' || envMode === 'protection_required' || envMode === 'plaintext_allowed') {
    return envMode;
  }
  if (process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_REQUIRE_PROTECTION === '1') {
    return 'protection_required';
  }
  return 'plaintext_allowed';
}

function protectedAtRest(options: RelayDocumentSearchDerivedContentIndexCacheOptions): boolean {
  if (options.protectedAtRest !== undefined) return options.protectedAtRest;
  return process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_PROTECTED_AT_REST === '1';
}

export function relayDocumentSearchDerivedContentIndexCachePolicy(
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): RelayDocumentSearchDerivedContentIndexCachePolicyResult {
  const mode = cacheProtectionMode(options);
  const externallyProtected = protectedAtRest(options);
  if (mode === 'disabled') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY_CONTRACT,
      cacheDir: relayDocumentSearchDerivedContentIndexCacheDir(options),
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
      schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY_CONTRACT,
      cacheDir: relayDocumentSearchDerivedContentIndexCacheDir(options),
      mode,
      enabled: true,
      readAllowed: false,
      writeAllowed: false,
      protectionState: 'unprotected_plaintext',
      reason: 'protection_required_but_unavailable',
    };
  }
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_POLICY_CONTRACT,
    cacheDir: relayDocumentSearchDerivedContentIndexCacheDir(options),
    mode,
    enabled: true,
    readAllowed: true,
    writeAllowed: true,
    protectionState: externallyProtected ? 'externally_protected' : 'unprotected_plaintext',
    reason: externallyProtected ? 'externally_protected' : 'plaintext_allowed',
  };
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function relayDocumentSearchDerivedContentIndexCacheKey(
  parsedDocument: RelayParsedDocument,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      keyVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION,
      sourceFileId: parsedDocument.source_file_id,
      sourcePath: resolve(parsedDocument.source_path),
      sourceMetadataVersion: parsedDocument.source_metadata_version,
      parsedDocumentUid: parsedDocument.metadata.uid,
      parsedDocumentVersion: parsedDocument.version,
      parserName: parsedDocument.parser.name,
      parserVersion: parsedDocument.parser.version,
      parserProfile: parsedDocument.parser.profile,
      patternSetVersion: parsedDocument.parser.patternSetVersion,
      structureProfileContract: RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
    }))
    .digest('hex');
}

function cachePathForParsedDocument(
  parsedDocument: RelayParsedDocument,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): string {
  const cacheKey = relayDocumentSearchDerivedContentIndexCacheKey(parsedDocument);
  return join(relayDocumentSearchDerivedContentIndexCacheDir(options), `${cacheKey.slice(0, 2)}`, `${cacheKey}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateIndexForParsedDocument(
  index: unknown,
  parsedDocument: RelayParsedDocument,
): index is RelayDocumentSearchDerivedContentIndexV1 {
  if (!isRecord(index)) return false;
  if (index.schemaVersion !== RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT) return false;
  if (index.source_file_id !== parsedDocument.source_file_id) return false;
  if (index.source_metadata_version !== parsedDocument.source_metadata_version) return false;
  if (index.parsed_document_uid !== parsedDocument.metadata.uid) return false;
  if (index.parsed_document_version !== parsedDocument.version) return false;
  if (!isRecord(index.parser)) return false;
  if (index.parser.version !== parsedDocument.parser.version) return false;
  if (!Array.isArray(index.entries)) return false;
  if (!isRecord(index.diagnostics)) return false;
  if (!isRecord(index.diagnostics.structureProfile)) return false;
  if (index.diagnostics.structureProfile.schemaVersion !== RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT) return false;
  if (index.diagnostics.structureProfile.profile !== parsedDocument.parser.profile) return false;
  if (index.diagnostics.structureProfile.status === 'invalid') return false;
  for (const entry of index.entries) {
    if (!isRecord(entry)) return false;
    if (typeof entry.entry_id !== 'string' || typeof entry.entry_kind !== 'string') return false;
    if (typeof entry.text !== 'string' || typeof entry.normalized_text !== 'string') return false;
    if (!isRecord(entry.anchor) || !isRecord(entry.preview)) return false;
    if (entry.preview.schemaVersion !== RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT) return false;
  }
  return true;
}

function validateSearchStoreForIndex(
  searchStore: unknown,
  index: RelayDocumentSearchDerivedContentIndexV1,
): searchStore is RelayDocumentSearchDerivedSearchStoreV1 {
  if (!isRecord(searchStore)) return false;
  if (searchStore.schemaVersion !== RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT) return false;
  if (searchStore.source_file_id !== index.source_file_id) return false;
  if (searchStore.source_metadata_version !== index.source_metadata_version) return false;
  if (searchStore.parsed_document_uid !== index.parsed_document_uid) return false;
  if (searchStore.parsed_document_version !== index.parsed_document_version) return false;
  if (!isRecord(searchStore.parser)) return false;
  if (searchStore.parser.version !== index.parser.version) return false;
  if (!Array.isArray(searchStore.rows)) return false;
  if (!isRecord(searchStore.diagnostics)) return false;
  if (searchStore.diagnostics.structureProfileStatus !== index.diagnostics.structureProfile.status) return false;
  for (const row of searchStore.rows) {
    if (!isRecord(row)) return false;
    if (typeof row.row_id !== 'string' || typeof row.entry_id !== 'string') return false;
    if (row.entry_kind !== 'text' && row.entry_kind !== 'table_cell') return false;
    if (typeof row.normalized_text !== 'string') return false;
    if (!isRecord(row.anchor) || !isRecord(row.preview)) return false;
    if (row.preview.schemaVersion !== RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT) return false;
  }
  return true;
}

function parseCacheRecord(
  text: string,
  parsedDocument: RelayParsedDocument,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions,
): RelayDocumentSearchDerivedContentIndexCacheRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const cacheKey = relayDocumentSearchDerivedContentIndexCacheKey(parsedDocument);
  if (parsed.schemaVersion !== RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT) return undefined;
  if (parsed.cacheKeyVersion !== RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION) return undefined;
  if (parsed.cacheKey !== cacheKey) return undefined;
  if (parsed.sourceFileId !== parsedDocument.source_file_id) return undefined;
  if (resolve(String(parsed.sourcePath || '')) !== resolve(parsedDocument.source_path)) return undefined;
  if (parsed.sourceMetadataVersion !== parsedDocument.source_metadata_version) return undefined;
  if (parsed.parsedDocumentUid !== parsedDocument.metadata.uid) return undefined;
  if (parsed.parsedDocumentVersion !== parsedDocument.version) return undefined;
  if (parsed.parserVersion !== parsedDocument.parser.version) return undefined;
  if (typeof parsed.generatedAt !== 'string') return undefined;

  const generatedAtMs = Date.parse(parsed.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return undefined;
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
  if (maxAgeMs >= 0 && nowMs - generatedAtMs > maxAgeMs) return undefined;
  if (!validateIndexForParsedDocument(parsed.index, parsedDocument)) return undefined;
  const searchStore = validateSearchStoreForIndex(parsed.searchStore, parsed.index)
    ? parsed.searchStore
    : buildRelayDocumentSearchDerivedSearchStore(parsed.index);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT,
    cacheKeyVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION,
    cacheKey,
    generatedAt: String(parsed.generatedAt),
    sourceFileId: String(parsed.sourceFileId),
    sourcePath: resolve(String(parsed.sourcePath)),
    sourceMetadataVersion: String(parsed.sourceMetadataVersion),
    parsedDocumentUid: String(parsed.parsedDocumentUid),
    parsedDocumentVersion: String(parsed.parsedDocumentVersion),
    parserVersion: String(parsed.parserVersion),
    index: parsed.index,
    searchStore,
  };
}

function lineSnippet(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 240);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function tableLocation(table: RelayTable, cell: RelayCellWithMeta): string {
  const sheet = asString(cell.metadata.sheet_name);
  const address = asString(cell.metadata.cell_address);
  if (sheet && address) return `${sheet}!${address}`;
  if (address) return address;
  return `${table.table_id} R${cell.row}C${cell.column}`;
}

function textLocation(node: RelayTreeNode): string {
  const page = asString(node.metadata.page_id);
  const line = typeof node.metadata.line_number === 'number' ? `行 ${node.metadata.line_number}` : '';
  if (page && line) return `${page} ${line}`;
  if (line) return line;
  if (page) return page;
  return String(node.node_id);
}

function previewForAnchor(
  parsedDocument: RelayParsedDocument,
  kind: RelayDocumentSearchDerivedEntryKind,
  title: string,
  locationLabel: string,
  snippet: string,
): RelayDocumentSearchPreviewAnchor {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT,
    kind,
    title,
    locationLabel,
    snippet,
    sourceFileId: parsedDocument.source_file_id,
    sourceMetadataVersion: parsedDocument.source_metadata_version,
    parsedDocumentUid: parsedDocument.metadata.uid,
    parserVersion: parsedDocument.parser.version,
  };
}

function textEntry(parsedDocument: RelayParsedDocument, node: RelayTreeNode): RelayDocumentSearchDerivedContentEntry | undefined {
  const snippet = lineSnippet(node.text);
  if (!snippet) return undefined;
  const location = textLocation(node);
  const anchor = {
    type: 'text_excerpt',
    preview_anchor_contract: RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT,
    node_id: node.node_id,
    line_id: node.metadata.line_id,
    line: node.metadata.line_number,
    page_id: node.metadata.page_id,
    snippet,
    parsed_document_version: parsedDocument.version,
    parser_name: parsedDocument.parser.name,
    parser_profile: parsedDocument.parser.profile,
    anchor_confidence: node.metadata.page_anchors_available === false ? 'medium' : 'high',
    page_anchors_available: node.metadata.page_anchors_available,
    extraction_method: node.metadata.extraction_method,
    office_format: node.metadata.office_format,
    preview: previewForAnchor(parsedDocument, 'text', parsedDocument.metadata.file_name, location, snippet),
  };
  return {
    entry_id: `text-${stableId(`${parsedDocument.metadata.uid}:${node.node_id}:${snippet}`)}`,
    entry_kind: 'text',
    text: node.text,
    normalized_text: normalizeRelaySearchText(node.text),
    anchor,
    preview: anchor.preview,
  };
}

function collectTextEntries(parsedDocument: RelayParsedDocument, node: RelayTreeNode, entries: RelayDocumentSearchDerivedContentEntry[]): void {
  const entry = textEntry(parsedDocument, node);
  if (entry) entries.push(entry);
  for (const child of node.subparagraphs) collectTextEntries(parsedDocument, child, entries);
}

function structureProfileDiagnostics(
  report: RelayParsedDocumentStructureProfileValidation,
): RelayDocumentSearchDerivedContentIndexStructureProfileDiagnostics {
  return {
    schemaVersion: report.schemaVersion,
    profile: String(report.profile),
    status: report.status,
    treeNodeCount: report.treeNodeCount,
    tableCount: report.tableCount,
    cellCount: report.cellCount,
    annotationCount: report.annotationCount,
    warningCount: report.warningCount,
    errorCount: report.errors.length,
    lossyWarningCount: report.lossyWarningCount,
    unsupportedWarningCount: report.unsupportedWarningCount,
  };
}

function tableCellEntry(
  parsedDocument: RelayParsedDocument,
  table: RelayTable,
  cell: RelayCellWithMeta,
): RelayDocumentSearchDerivedContentEntry | undefined {
  const searchable = [
    cell.text,
    asString(cell.metadata.formula),
    asString(cell.metadata.cell_address),
    asString(cell.metadata.sheet_name),
  ].filter(Boolean).join(' ');
  if (!searchable.trim()) return undefined;
  const snippet = lineSnippet(cell.text || asString(cell.metadata.formula));
  const location = tableLocation(table, cell);
  const anchor = {
    type: 'cell_excerpt',
    preview_anchor_contract: RELAY_DOCUMENT_SEARCH_PREVIEW_ANCHOR_CONTRACT,
    table_id: table.table_id,
    cell_id: cell.cell_id,
    row: cell.row,
    column: cell.column,
    sheet_name: cell.metadata.sheet_name,
    sheet_index: cell.metadata.sheet_index,
    cell_address: cell.metadata.cell_address,
    hidden_state: cell.metadata.hidden_state,
    cached_value_state: cell.metadata.cached_value_state,
    has_formula: Boolean(cell.metadata.formula),
    snippet,
    parsed_document_version: parsedDocument.version,
    parser_name: parsedDocument.parser.name,
    parser_profile: parsedDocument.parser.profile,
    anchor_confidence: 'high',
    preview: previewForAnchor(parsedDocument, 'table_cell', parsedDocument.metadata.file_name, location, snippet),
  };
  return {
    entry_id: `cell-${stableId(`${parsedDocument.metadata.uid}:${table.table_id}:${cell.cell_id}:${searchable}`)}`,
    entry_kind: 'table_cell',
    text: searchable,
    normalized_text: normalizeRelaySearchText(searchable),
    anchor,
    preview: anchor.preview,
  };
}

export function buildRelayDocumentSearchDerivedContentIndex(
  parsedDocument: RelayParsedDocument,
): RelayDocumentSearchDerivedContentIndexV1 {
  const structureProfile = validateRelayParsedDocumentStructureProfile(parsedDocument);
  const entries: RelayDocumentSearchDerivedContentEntry[] = [];
  if (structureProfile.status !== 'invalid') {
    collectTextEntries(parsedDocument, parsedDocument.content.structure, entries);
    for (const table of parsedDocument.content.tables) {
      for (const row of table.rows) {
        for (const cell of row) {
          const entry = tableCellEntry(parsedDocument, table, cell);
          if (entry) entries.push(entry);
        }
      }
    }
  }
  const textEntryCount = entries.filter((entry) => entry.entry_kind === 'text').length;
  const tableCellEntryCount = entries.filter((entry) => entry.entry_kind === 'table_cell').length;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
    source_file_id: parsedDocument.source_file_id,
    source_metadata_version: parsedDocument.source_metadata_version,
    parsed_document_uid: parsedDocument.metadata.uid,
    parsed_document_version: parsedDocument.version,
    parser: {
      name: parsedDocument.parser.name,
      version: parsedDocument.parser.version,
      profile: parsedDocument.parser.profile,
    },
    entries,
    diagnostics: {
      textEntryCount,
      tableCellEntryCount,
      previewAnchorCount: entries.length,
      structureProfile: structureProfileDiagnostics(structureProfile),
    },
  };
}

export function buildRelayDocumentSearchDerivedSearchStore(
  index: RelayDocumentSearchDerivedContentIndexV1,
): RelayDocumentSearchDerivedSearchStoreV1 {
  const rows = index.entries.map((entry) => ({
    row_id: `row-${stableId(`${index.parsed_document_uid}:${entry.entry_id}:${entry.normalized_text}`)}`,
    entry_id: entry.entry_id,
    entry_kind: entry.entry_kind,
    normalized_text: entry.normalized_text,
    anchor: entry.anchor,
    preview: entry.preview,
  }));
  const textRowCount = rows.filter((row) => row.entry_kind === 'text').length;
  const tableCellRowCount = rows.filter((row) => row.entry_kind === 'table_cell').length;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT,
    source_file_id: index.source_file_id,
    source_metadata_version: index.source_metadata_version,
    parsed_document_uid: index.parsed_document_uid,
    parsed_document_version: index.parsed_document_version,
    parser: {
      name: index.parser.name,
      version: index.parser.version,
      profile: index.parser.profile,
    },
    rows,
    diagnostics: {
      rowCount: rows.length,
      textRowCount,
      tableCellRowCount,
      previewSpanSeedCount: rows.length,
      structureProfileStatus: index.diagnostics.structureProfile.status,
    },
  };
}

export function buildRelayDocumentSearchDerivedIndexOwnershipReport(
  freshnessReports: RelayDocumentSearchFreshnessReport[],
): RelayDocumentSearchDerivedIndexOwnershipReport {
  const moves = freshnessReports.flatMap((report) =>
    report.changes
      .filter((change) =>
        change.reason === 'moved' &&
          change.move_confidence === 'high' &&
          Boolean(
            change.previous_file_id &&
              change.current_file_id &&
              change.previous_path &&
              change.current_path &&
              change.previous_source_metadata_version &&
              change.current_source_metadata_version,
          ),
      )
      .map((change) => ({
        previous_file_id: String(change.previous_file_id),
        current_file_id: String(change.current_file_id),
        previous_path: String(change.previous_path),
        current_path: String(change.current_path),
        previous_source_metadata_version: String(change.previous_source_metadata_version),
        current_source_metadata_version: String(change.current_source_metadata_version),
        move_confidence: 'high' as const,
        ownership_owner_file_id: String(change.current_file_id),
        ownership_source_metadata_version: String(change.current_source_metadata_version),
        ownership_action: 'transfer_on_rebuild' as const,
        cache_reuse_allowed: false as const,
        reason: 'source_path_or_metadata_changed' as const,
      })),
  );
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_INDEX_OWNERSHIP_CONTRACT,
    highConfidenceMoveCount: moves.length,
    transferOnRebuildCount: moves.length,
    cacheReuseAllowedCount: 0,
    moves,
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}

function derivedContentIndexCacheRecordForParsedDocument(
  parsedDocument: RelayParsedDocument,
  index: RelayDocumentSearchDerivedContentIndexV1,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): { record: RelayDocumentSearchDerivedContentIndexCacheRecord; cachePath: string; lockPath: string } | undefined {
  if (!validateIndexForParsedDocument(index, parsedDocument)) return undefined;
  const cacheKey = relayDocumentSearchDerivedContentIndexCacheKey(parsedDocument);
  const cachePath = cachePathForParsedDocument(parsedDocument, options);
  const searchStore = buildRelayDocumentSearchDerivedSearchStore(index);
  return {
    cachePath,
    lockPath: `${cachePath}.lock`,
    record: {
      schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT,
      cacheKeyVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION,
      cacheKey,
      generatedAt: (options.now ?? new Date()).toISOString(),
      sourceFileId: parsedDocument.source_file_id,
      sourcePath: resolve(parsedDocument.source_path),
      sourceMetadataVersion: parsedDocument.source_metadata_version,
      parsedDocumentUid: parsedDocument.metadata.uid,
      parsedDocumentVersion: parsedDocument.version,
      parserVersion: parsedDocument.parser.version,
      index,
      searchStore,
    },
  };
}

export async function readRelayDocumentSearchDerivedContentIndexCache(
  parsedDocument: RelayParsedDocument,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): Promise<RelayDocumentSearchDerivedContentIndexCacheRecord | undefined> {
  const policy = relayDocumentSearchDerivedContentIndexCachePolicy(options);
  options.onPolicy?.(policy);
  if (!policy.readAllowed) return undefined;
  try {
    return parseCacheRecord(await readFile(cachePathForParsedDocument(parsedDocument, options), 'utf8'), parsedDocument, options);
  } catch {
    return undefined;
  }
}

export async function writeRelayDocumentSearchDerivedContentIndexCache(
  parsedDocument: RelayParsedDocument,
  index: RelayDocumentSearchDerivedContentIndexV1,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): Promise<RelayDocumentSearchDerivedContentIndexCacheRecord | undefined> {
  const stage = await stageRelayDocumentSearchDerivedContentIndexCache(parsedDocument, index, options);
  return stage?.promote();
}

export async function stageRelayDocumentSearchDerivedContentIndexCache(
  parsedDocument: RelayParsedDocument,
  index: RelayDocumentSearchDerivedContentIndexV1,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): Promise<RelayDocumentSearchDerivedContentIndexCacheStage | undefined> {
  const policy = relayDocumentSearchDerivedContentIndexCachePolicy(options);
  options.onPolicy?.(policy);
  if (!policy.writeAllowed) return undefined;
  const prepared = derivedContentIndexCacheRecordForParsedDocument(parsedDocument, index, options);
  if (!prepared) return undefined;
  const { record, cachePath, lockPath } = prepared;
  const stagingPath = join(dirname(cachePath), '.staging', `${record.cacheKey}.${process.pid}.${Date.now()}.json`);
  await mkdir(dirname(cachePath), { recursive: true });
  const lock = await acquireRelayDocumentSearchDerivedContentIndexCacheLock(lockPath, options);
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
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_STAGE_CONTRACT,
    cacheKey: record.cacheKey,
    activePath: cachePath,
    stagingPath,
    record,
    async promote() {
      try {
        await rename(stagingPath, cachePath);
        if (quotaEnforcementEnabled(options)) {
          try {
            options.onQuota?.(await enforceRelayDocumentSearchDerivedContentIndexCacheQuota(options));
          } catch {
            // Derived cache cleanup is best-effort; a successful content parse
            // should still be available to the current search.
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

export async function enforceRelayDocumentSearchDerivedContentIndexCacheQuota(
  options: RelayDocumentSearchDerivedContentIndexCacheOptions = {},
): Promise<RelayDocumentSearchDerivedContentIndexCacheQuotaResult> {
  const cacheDir = relayDocumentSearchDerivedContentIndexCacheDir(options);
  await mkdir(cacheDir, { recursive: true });
  const lock = await acquireRelayDocumentSearchDerivedContentIndexCacheLock(
    join(cacheDir, '.quota.lock'),
    options,
  );
  try {
    const entries = await listDerivedContentIndexCacheEntries(cacheDir);
    const evicted: RelayDocumentSearchDerivedContentIndexCacheQuotaResult['evicted'] = [];
    const errors: RelayDocumentSearchDerivedContentIndexCacheQuotaResult['errors'] = [];

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
    let currentBytes = validEntries.reduce((sum, entry) => sum + entry.bytes, 0);
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

async function listDerivedContentIndexCacheEntries(cacheDir: string): Promise<Array<{
  path: string;
  bytes: number;
  generatedAt: string;
  generatedAtMs: number;
  valid: boolean;
}>> {
  const out: Array<{ path: string; bytes: number; generatedAt: string; generatedAtMs: number; valid: boolean }> = [];
  await collectDerivedContentIndexCacheEntries(cacheDir, out);
  return out;
}

async function collectDerivedContentIndexCacheEntries(
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
      await collectDerivedContentIndexCacheEntries(fullPath, out);
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
          parsed.schemaVersion === RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT &&
          parsed.cacheKeyVersion === RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_KEY_VERSION &&
          typeof parsed.cacheKey === 'string' &&
          Number.isFinite(generatedAtMs),
      });
    } catch {
      out.push({ path: fullPath, bytes, generatedAt: '', generatedAtMs: 0, valid: false });
    }
  }
}

async function acquireRelayDocumentSearchDerivedContentIndexCacheLock(
  lockPath: string,
  options: RelayDocumentSearchDerivedContentIndexCacheOptions,
): Promise<{ release: () => Promise<void> }> {
  const now = options.now ?? new Date();
  const staleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 'RelayDocumentSearchDerivedContentIndexCacheLock.v1',
        pid: process.pid,
        createdAt: now.toISOString(),
      }),
      'utf8',
    );
    await handle.close();
    return { release: () => rm(lockPath, { force: true }) };
  } catch {
    const current = await readDerivedContentIndexCacheLock(lockPath);
    if (current && now.getTime() - current.createdAtMs > staleMs) {
      await rm(lockPath, { force: true });
      return acquireRelayDocumentSearchDerivedContentIndexCacheLock(lockPath, options);
    }
    throw new Error(`Relay derived content index cache is locked: ${lockPath}`);
  }
}

async function readDerivedContentIndexCacheLock(lockPath: string): Promise<{ createdAtMs: number } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!isRecord(parsed) || typeof parsed.createdAt !== 'string') return undefined;
    const createdAtMs = Date.parse(parsed.createdAt);
    return Number.isFinite(createdAtMs) ? { createdAtMs } : undefined;
  } catch {
    return undefined;
  }
}

function scoreForKind(kind: RelayDocumentSearchDerivedEntryKind, matchedTerms: string[]): number {
  const base = kind === 'table_cell' ? 12 : 8;
  return base + matchedTerms.length;
}

function scoreForEntry(entry: RelayDocumentSearchDerivedContentEntry, matchedTerms: string[]): number {
  return scoreForKind(entry.entry_kind, matchedTerms);
}

function scoreForSearchRow(row: RelayDocumentSearchDerivedSearchStoreRow, matchedTerms: string[]): number {
  return scoreForKind(row.entry_kind, matchedTerms);
}

function previewHighlights(snippet: string, matchedTerms: string[]): RelayDocumentSearchPreviewHighlight[] {
  const foldedSnippet = snippet.normalize('NFKC').toLocaleLowerCase();
  const highlights: RelayDocumentSearchPreviewHighlight[] = [];
  for (const term of matchedTerms) {
    const foldedTerm = term.normalize('NFKC').toLocaleLowerCase();
    if (!foldedTerm) continue;
    let searchFrom = 0;
    while (searchFrom < foldedSnippet.length) {
      const start = foldedSnippet.indexOf(foldedTerm, searchFrom);
      if (start < 0) break;
      highlights.push({
        term,
        start,
        end: start + foldedTerm.length,
      });
      searchFrom = start + Math.max(1, foldedTerm.length);
    }
  }
  return highlights.sort((left, right) => left.start - right.start || left.end - right.end || left.term.localeCompare(right.term));
}

function previewSpanForPreview(
  entryId: string,
  kind: RelayDocumentSearchDerivedEntryKind,
  preview: RelayDocumentSearchPreviewAnchor,
  matchedTerms: string[],
): RelayDocumentSearchPreviewSpan {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_PREVIEW_SPAN_CONTRACT,
    span_id: `span-${stableId(`${entryId}:${matchedTerms.join('|')}:${preview.snippet}`)}`,
    entry_id: entryId,
    kind,
    title: preview.title,
    locationLabel: preview.locationLabel,
    snippet: preview.snippet,
    matched_terms: matchedTerms,
    highlights: previewHighlights(preview.snippet, matchedTerms),
    sourceFileId: preview.sourceFileId,
    sourceMetadataVersion: preview.sourceMetadataVersion,
    parsedDocumentUid: preview.parsedDocumentUid,
    parserVersion: preview.parserVersion,
    anchor: preview,
  };
}

function previewSpanForMatch(
  entry: RelayDocumentSearchDerivedContentEntry,
  matchedTerms: string[],
): RelayDocumentSearchPreviewSpan {
  return previewSpanForPreview(entry.entry_id, entry.entry_kind, entry.preview, matchedTerms);
}

function previewSpanForSearchRow(
  row: RelayDocumentSearchDerivedSearchStoreRow,
  matchedTerms: string[],
): RelayDocumentSearchPreviewSpan {
  return previewSpanForPreview(row.entry_id, row.entry_kind, row.preview, matchedTerms);
}

export function searchRelayDocumentSearchDerivedContentIndex(
  index: RelayDocumentSearchDerivedContentIndexV1,
  terms: string[],
  options: RelayDocumentSearchDerivedContentSearchOptions = {},
): RelayDocumentSearchDerivedContentSearchResult {
  const normalizedTerms = [...new Set(terms.map((term) => normalizeRelaySearchText(term)).filter(Boolean))];
  const maxAnchors = Math.max(1, Math.min(options.maxAnchors ?? DEFAULT_MAX_ANCHORS, 20));
  const matches = index.entries
    .map((entry) => {
      const matchedTerms = normalizedTerms.filter((term) => entry.normalized_text.includes(term));
      if (!matchedTerms.length) return undefined;
      const previewSpan = previewSpanForMatch(entry, matchedTerms);
      const anchor = {
        ...entry.anchor,
        matchedTerms,
        preview_span: previewSpan,
      };
      return {
        entry,
        score: scoreForEntry(entry, matchedTerms),
        matchedTerms,
        anchor,
        previewSpan,
      };
    })
    .filter((match): match is RelayDocumentSearchDerivedContentMatch => Boolean(match))
    .sort((left, right) => right.score - left.score || left.entry.entry_id.localeCompare(right.entry.entry_id));
  const returned = matches.slice(0, maxAnchors);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
    score: returned.reduce((sum, match) => sum + match.score, 0),
    anchors: returned.map((match) => match.anchor),
    preview_spans: returned.map((match) => match.previewSpan),
    matches: returned,
    diagnostics: {
      searchedEntryCount: index.entries.length,
      matchedEntryCount: matches.length,
      returnedAnchorCount: returned.length,
      returnedPreviewSpanCount: returned.length,
    },
  };
}

export function searchRelayDocumentSearchDerivedSearchStore(
  searchStore: RelayDocumentSearchDerivedSearchStoreV1,
  terms: string[],
  options: RelayDocumentSearchDerivedContentSearchOptions = {},
): RelayDocumentSearchDerivedSearchStoreSearchResult {
  const normalizedTerms = [...new Set(terms.map((term) => normalizeRelaySearchText(term)).filter(Boolean))];
  const maxAnchors = Math.max(1, Math.min(options.maxAnchors ?? DEFAULT_MAX_ANCHORS, 20));
  const matches = searchStore.rows
    .map((row) => {
      const matchedTerms = normalizedTerms.filter((term) => row.normalized_text.includes(term));
      if (!matchedTerms.length) return undefined;
      const previewSpan = previewSpanForSearchRow(row, matchedTerms);
      const anchor = {
        ...row.anchor,
        matchedTerms,
        preview_span: previewSpan,
      };
      return {
        row,
        score: scoreForSearchRow(row, matchedTerms),
        matchedTerms,
        anchor,
        previewSpan,
      };
    })
    .filter((match): match is RelayDocumentSearchDerivedSearchStoreMatch => Boolean(match))
    .sort((left, right) => right.score - left.score || left.row.entry_id.localeCompare(right.row.entry_id));
  const returned = matches.slice(0, maxAnchors);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT,
    score: returned.reduce((sum, match) => sum + match.score, 0),
    anchors: returned.map((match) => match.anchor),
    preview_spans: returned.map((match) => match.previewSpan),
    matches: returned,
    diagnostics: {
      searchedRowCount: searchStore.rows.length,
      matchedRowCount: matches.length,
      searchedEntryCount: searchStore.rows.length,
      matchedEntryCount: matches.length,
      returnedAnchorCount: returned.length,
      returnedPreviewSpanCount: returned.length,
    },
  };
}
