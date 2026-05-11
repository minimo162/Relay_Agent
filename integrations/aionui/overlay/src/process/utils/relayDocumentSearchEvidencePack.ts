import type { RelayDocumentSearchRequestV1 } from './relayDocumentSearchContract';
import type { RelayDocumentSearchQueryPlanV1 } from './relayDocumentSearchQueryPlan';

export const RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT = 'RelayDocumentSearchEvidencePack.v1' as const;

export type RelayDocumentSearchEvidencePackWarning = {
  code: string;
  message: string;
  count?: number;
};

export type RelayDocumentSearchEvidencePackCoverage = {
  searchedRoots: string[];
  metadataScannedFiles: number;
  contentScannedFiles: number;
  skippedFiles: number;
  inaccessiblePathCount: number;
  resultCount: number;
  contentEvidenceFileCount: number;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  generatedAt: string;
};

export type RelayDocumentSearchEvidencePackCandidate = {
  result_id: string;
  file_id: string;
  path: string;
  display_path: string;
  display_name: string;
  file_type: string;
  source_metadata_version?: string;
  match_mode: string;
  evidence_state: string;
  index_state: string;
  score: number;
  score_breakdown: Record<string, unknown>;
  source_indexes: unknown[];
  warnings: string[];
  anchor_count: number;
};

export type RelayDocumentSearchEvidencePackEvidenceItem = {
  evidence_id: string;
  result_id?: string;
  file_id?: string;
  path?: string;
  display_path?: string;
  display_name?: string;
  file_type?: string;
  evidence_state?: string;
  source_metadata_version?: string;
  parsed_document_uid?: string;
  parsed_document_version?: string;
  parser?: Record<string, unknown>;
  document_metadata?: Record<string, unknown>;
  structure_profile?: Record<string, unknown>;
  anchor: Record<string, unknown>;
  warnings: unknown[];
};

export type RelayDocumentSearchEvidencePackContentSource = {
  fileId: string;
  evidence: Array<Record<string, unknown>>;
  parsedDocumentUid?: string;
  parsedDocumentVersion?: string;
  parser?: Record<string, unknown>;
  documentMetadata?: Record<string, unknown>;
  structureProfile?: Record<string, unknown>;
  warnings?: unknown[];
};

export type RelayDocumentSearchEvidencePackV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT;
  evidence_pack_id: string;
  job_id: string;
  query_id?: string;
  generated_at: string;
  query: string;
  query_plan: {
    mode: string;
    terms: string[];
    file_types: string[];
    period_hints: unknown[];
    evidence: string;
  };
  coverage: RelayDocumentSearchEvidencePackCoverage;
  candidate_files: RelayDocumentSearchEvidencePackCandidate[];
  evidence: RelayDocumentSearchEvidencePackEvidenceItem[];
  warnings: RelayDocumentSearchEvidencePackWarning[];
  ai_boundary: {
    localFirst: true;
    copilotMayUseOnlyEvidencePack: true;
    originalFilesIncluded: false;
    parsedDocumentPayloadIncluded: false;
  };
};

export type RelayDocumentSearchEvidencePackInput = {
  jobId: string;
  queryId?: string;
  generatedAt: string;
  request: RelayDocumentSearchRequestV1;
  queryPlan: RelayDocumentSearchQueryPlanV1;
  roots: string[];
  metadataScannedFiles: number;
  contentScannedFiles: number;
  skippedFiles: number;
  inaccessiblePathCount: number;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  results: Array<Record<string, unknown>>;
  contentEvidence: RelayDocumentSearchEvidencePackContentSource[];
  warnings: RelayDocumentSearchEvidencePackWarning[];
};

export type RelayDocumentSearchEvidencePackValidation = {
  ok: boolean;
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function resultByFileId(results: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  return new Map(results.map((result) => [asString(result.file_id), result]).filter(([fileId]) => Boolean(fileId)));
}

function candidateFromResult(result: Record<string, unknown>): RelayDocumentSearchEvidencePackCandidate {
  return {
    result_id: asString(result.result_id),
    file_id: asString(result.file_id),
    path: asString(result.path),
    display_path: asString(result.display_path, asString(result.path)),
    display_name: asString(result.display_name, asString(result.path, 'candidate')),
    file_type: asString(result.file_type),
    source_metadata_version: asString(result.source_metadata_version) || undefined,
    match_mode: asString(result.match_mode),
    evidence_state: asString(result.evidence_state),
    index_state: asString(result.index_state),
    score: asNumber(result.score),
    score_breakdown: isRecord(result.score_breakdown) ? result.score_breakdown : {},
    source_indexes: Array.isArray(result.source_indexes) ? result.source_indexes : [],
    warnings: asStringArray(result.warnings),
    anchor_count: Array.isArray(result.anchors) ? result.anchors.length : 0,
  };
}

function minimalDocumentMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = {
    uid: value.uid,
    file_name: value.file_name,
    file_type: value.file_type,
    size: value.size,
    modified_time: value.modified_time,
    extra_data: isRecord(value.extra_data) ? value.extra_data : undefined,
  };
  return Object.fromEntries(Object.entries(allowed).filter(([, entry]) => entry !== undefined));
}

function minimalStructureProfile(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value) && typeof value.schemaVersion === 'string') {
    return Object.fromEntries(
      Object.entries({
        schemaVersion: value.schemaVersion,
        profile: value.profile,
        status: value.status,
        treeNodeCount: value.treeNodeCount,
        tableCount: value.tableCount,
        cellCount: value.cellCount,
        annotationCount: value.annotationCount,
        warningCount: value.warningCount,
        errorCount: Array.isArray(value.errors) ? value.errors.length : value.errorCount,
        lossyWarningCount: value.lossyWarningCount,
        unsupportedWarningCount: value.unsupportedWarningCount,
      }).filter(([, entry]) => entry !== undefined),
    );
  }
  if (!isRecord(value)) return undefined;
  const extraData = isRecord(value.extra_data) ? value.extra_data : undefined;
  return minimalStructureProfile(extraData?.structure_profile);
}

function evidenceId(source: RelayDocumentSearchEvidencePackContentSource, evidence: Record<string, unknown>, index: number): string {
  return `evidence-${stableHash(`${source.fileId}:${index}:${JSON.stringify(evidence.anchor ?? evidence)}`)}`;
}

function evidenceItems(
  contentSources: RelayDocumentSearchEvidencePackContentSource[],
  results: Array<Record<string, unknown>>,
): RelayDocumentSearchEvidencePackEvidenceItem[] {
  const byFileId = resultByFileId(results);
  return contentSources.flatMap((source) => {
    const result = byFileId.get(source.fileId);
    return source.evidence.map((evidence, index) => {
      const anchor = isRecord(evidence.anchor) ? evidence.anchor : evidence;
      const documentMetadata = minimalDocumentMetadata(source.documentMetadata);
      return {
        evidence_id: evidenceId(source, evidence, index),
        result_id: result ? asString(result.result_id) : undefined,
        file_id: asString(evidence.file_id, source.fileId),
        path: asString(evidence.path, result ? asString(result.path) : ''),
        display_path: asString(evidence.display_path, result ? asString(result.display_path) : ''),
        display_name: result ? asString(result.display_name) : undefined,
        file_type: result ? asString(result.file_type) : undefined,
        evidence_state: asString(evidence.evidence_state, result ? asString(result.evidence_state) : ''),
        source_metadata_version: asString(evidence.source_metadata_version, result ? asString(result.source_metadata_version) : ''),
        parsed_document_uid: asString(evidence.parsed_document_uid, source.parsedDocumentUid),
        parsed_document_version: source.parsedDocumentVersion,
        parser: source.parser,
        document_metadata: documentMetadata,
        structure_profile: minimalStructureProfile(source.structureProfile ?? documentMetadata),
        anchor,
        warnings: source.warnings ?? [],
      };
    });
  });
}

export function buildRelayDocumentSearchEvidencePack(
  input: RelayDocumentSearchEvidencePackInput,
): RelayDocumentSearchEvidencePackV1 {
  const evidence = evidenceItems(input.contentEvidence, input.results);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT,
    evidence_pack_id: `evidence-pack-${input.queryId || input.jobId}`,
    job_id: input.jobId,
    query_id: input.queryId,
    generated_at: input.generatedAt,
    query: input.request.query,
    query_plan: {
      mode: input.queryPlan.mode,
      terms: input.queryPlan.normalizedTerms,
      file_types: input.request.fileTypes,
      period_hints: input.queryPlan.periodHints,
      evidence: input.request.evidence,
    },
    coverage: {
      searchedRoots: input.roots,
      metadataScannedFiles: input.metadataScannedFiles,
      contentScannedFiles: input.contentScannedFiles,
      skippedFiles: input.skippedFiles,
      inaccessiblePathCount: input.inaccessiblePathCount,
      resultCount: input.results.length,
      contentEvidenceFileCount: input.contentEvidence.length,
      truncated: input.truncated,
      cancelled: input.cancelled,
      timedOut: input.timedOut,
      generatedAt: input.generatedAt,
    },
    candidate_files: input.results.map(candidateFromResult),
    evidence,
    warnings: input.warnings,
    ai_boundary: {
      localFirst: true,
      copilotMayUseOnlyEvidencePack: true,
      originalFilesIncluded: false,
      parsedDocumentPayloadIncluded: false,
    },
  };
}

export function emptyRelayDocumentSearchEvidencePack(input: {
  jobId: string;
  queryId?: string;
  generatedAt: string;
  warnings: RelayDocumentSearchEvidencePackWarning[];
}): RelayDocumentSearchEvidencePackV1 {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT,
    evidence_pack_id: `evidence-pack-${input.queryId || input.jobId}`,
    job_id: input.jobId,
    query_id: input.queryId,
    generated_at: input.generatedAt,
    query: '',
    query_plan: { mode: 'unknown', terms: [], file_types: [], period_hints: [], evidence: 'none' },
    coverage: {
      searchedRoots: [],
      metadataScannedFiles: 0,
      contentScannedFiles: 0,
      skippedFiles: 0,
      inaccessiblePathCount: 0,
      resultCount: 0,
      contentEvidenceFileCount: 0,
      truncated: false,
      cancelled: false,
      timedOut: false,
      generatedAt: input.generatedAt,
    },
    candidate_files: [],
    evidence: [],
    warnings: input.warnings,
    ai_boundary: {
      localFirst: true,
      copilotMayUseOnlyEvidencePack: true,
      originalFilesIncluded: false,
      parsedDocumentPayloadIncluded: false,
    },
  };
}

export function validateRelayDocumentSearchEvidencePack(input: unknown): RelayDocumentSearchEvidencePackValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['evidence pack must be an object'] };
  if (input.schemaVersion !== RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT}`);
  }
  for (const field of ['evidence_pack_id', 'job_id', 'generated_at']) {
    if (typeof input[field] !== 'string' || !String(input[field]).trim()) errors.push(`${field} is required`);
  }
  if (!isRecord(input.query_plan)) errors.push('query_plan is required');
  if (!isRecord(input.coverage)) errors.push('coverage is required');
  if (!Array.isArray(input.candidate_files)) errors.push('candidate_files must be an array');
  if (!Array.isArray(input.evidence)) errors.push('evidence must be an array');
  if (!Array.isArray(input.warnings)) errors.push('warnings must be an array');
  if (!isRecord(input.ai_boundary)) {
    errors.push('ai_boundary is required');
  } else {
    if (input.ai_boundary.originalFilesIncluded !== false) errors.push('ai_boundary.originalFilesIncluded must be false');
    if (input.ai_boundary.parsedDocumentPayloadIncluded !== false) errors.push('ai_boundary.parsedDocumentPayloadIncluded must be false');
  }
  return { ok: errors.length === 0, errors };
}
