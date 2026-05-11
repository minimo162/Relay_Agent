/**
 * Relay-owned document search contract for the Relay-branded AionUi shell.
 *
 * This module is intentionally UI-neutral. AionUi owns the visible skill,
 * conversation, preview, and history surfaces; Relay owns the model-facing
 * contract, alias policy, validation boundary, and result facts that Copilot is
 * allowed to consume.
 */

export const RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT = 'RelayDocumentSearchRequest.v1' as const;
export const RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT = 'RelayDocumentSearchResult.v1' as const;
export const RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT = 'RelayDocumentSearchProductResult.v1' as const;
export const RELAY_DOCUMENT_SEARCH_JOB_CONTRACT = 'RelayDocumentSearchJob.v1' as const;
export const RELAY_DOCUMENT_SEARCH_TOOL_NAME = 'relay_document_search' as const;

export const RELAY_DOCUMENT_SEARCH_APPROVED_ALIASES = [
  'relay_document_search',
  'relay-document-search',
  'workspace_document_search',
  'workspace-search',
  'find-files',
] as const;

export const RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES = {
  tool: 'relay_document_search_tool_prompt.v1',
  toolRepair: 'relay_document_search_repair_prompt.v1',
  querySuggestion: 'relay_query_suggestion_prompt.v1',
  answerPolish: 'relay_answer_polish_prompt.v1',
  polishRepair: 'relay_polish_repair_prompt.v1',
} as const;

export const RELAY_DOCUMENT_SEARCH_MODEL_FIELDS = [
  'query',
  'roots',
  'intent',
  'thoroughness',
  'fileTypes',
  'maxResults',
  'evidence',
] as const;

const RELAY_CONTROLLED_FIELDS = new Set([
  'cacheId',
  'cache_id',
  'jobId',
  'job_id',
  'queryId',
  'query_id',
  'traceId',
  'trace_id',
  'parserVersion',
  'parser_version',
  'redactionPolicy',
  'redaction_policy',
  'evidencePackId',
  'evidence_pack_id',
  'sourceMetadataVersion',
  'source_metadata_version',
]);

export type RelayDocumentSearchIntent =
  | 'find_files'
  | 'answer_with_evidence'
  | 'summarize_with_evidence'
  | 'inspect_file'
  | 'similar_documents';

export type RelayDocumentSearchThoroughness = 'quick' | 'thorough';
export type RelayDocumentSearchEvidenceMode = 'none' | 'candidate' | 'required';
export type RelayDocumentSearchStatus = 'ok' | 'partial' | 'needs_input' | 'failed';
export type RelayDocumentSearchFileType =
  | 'any'
  | 'txt'
  | 'md'
  | 'csv'
  | 'docx'
  | 'xlsx'
  | 'xlsm'
  | 'pptx'
  | 'pdf';

export type RelayDocumentSearchRequestV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT;
  query: string;
  roots: string[];
  intent: RelayDocumentSearchIntent;
  thoroughness: RelayDocumentSearchThoroughness;
  fileTypes: RelayDocumentSearchFileType[];
  maxResults: number;
  evidence: RelayDocumentSearchEvidenceMode;
};

export type RelayDocumentSearchResultV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT;
  status: RelayDocumentSearchStatus;
  progress: {
    stage: string;
    percent: number;
    scannedFiles?: number;
    skippedFiles?: number;
  };
  job: {
    jobId: string;
    lifecycle: 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
    cancellable: boolean;
    retryToken?: string;
    duplicateSubmitCorrelationId?: string;
  };
  correlation: Record<string, string | undefined>;
  queryPlan: Record<string, unknown>;
  coverage: Record<string, unknown>;
  results: Array<Record<string, unknown>>;
  evidencePack: Record<string, unknown>;
  localDraft?: Record<string, unknown>;
  polishRequest?: Record<string, unknown>;
  polishProvider?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  display: {
    beginnerSummary: string;
    emptyStateGuidance?: string[];
    refineActions?: string[];
  };
  diagnostics: Record<string, unknown>;
};

type ValidationOk<T> = {
  ok: true;
  value: T;
  errors: [];
};

type ValidationError = {
  ok: false;
  value?: undefined;
  errors: string[];
};

export type RelayValidationResult<T> = ValidationOk<T> | ValidationError;

const INTENTS: readonly RelayDocumentSearchIntent[] = [
  'find_files',
  'answer_with_evidence',
  'summarize_with_evidence',
  'inspect_file',
  'similar_documents',
];
const THOROUGHNESS: readonly RelayDocumentSearchThoroughness[] = ['quick', 'thorough'];
const EVIDENCE_MODES: readonly RelayDocumentSearchEvidenceMode[] = ['none', 'candidate', 'required'];
const FILE_TYPES: readonly RelayDocumentSearchFileType[] = [
  'any',
  'txt',
  'md',
  'csv',
  'docx',
  'xlsx',
  'xlsm',
  'pptx',
  'pdf',
];
const STATUSES: readonly RelayDocumentSearchStatus[] = ['ok', 'partial', 'needs_input', 'failed'];
const PRODUCT_RESULT_REQUIRED_STRING_FIELDS = [
  'product_result_contract',
  'result_id',
  'file_id',
  'path',
  'display_name',
  'match_mode',
  'evidence_state',
  'index_state',
  'preview_state',
  'open_state',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function normalizeStringArray(value: unknown, field: string, errors: string[], maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${field} may contain at most ${maxItems} entries`);
  const result: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${field} entries must be non-empty strings`);
      continue;
    }
    if (hasControlCharacters(item)) {
      errors.push(`${field} entries must not contain control characters`);
      continue;
    }
    result.push(item.trim());
  }
  return result;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  errors: string[],
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.push(`${field} must be one of: ${allowed.join(', ')}`);
    return fallback;
  }
  return value as T;
}

function normalizeFileTypes(value: unknown, errors: string[]): RelayDocumentSearchFileType[] {
  if (value === undefined) return ['any'];
  if (!Array.isArray(value)) {
    errors.push('fileTypes must be an array');
    return ['any'];
  }
  const normalized = new Set<RelayDocumentSearchFileType>();
  for (const item of value) {
    if (typeof item !== 'string') {
      errors.push('fileTypes entries must be strings');
      continue;
    }
    const fileType = item.trim().toLowerCase().replace(/^\./u, '') as RelayDocumentSearchFileType;
    if (!FILE_TYPES.includes(fileType)) {
      errors.push(`Unsupported file type: ${item}`);
      continue;
    }
    normalized.add(fileType);
  }
  return normalized.size > 0 ? [...normalized] : ['any'];
}

function normalizeMaxResults(value: unknown, errors: string[]): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 300) {
    errors.push('maxResults must be an integer between 1 and 300');
    return 50;
  }
  return value;
}

export function validateRelayDocumentSearchRequest(input: unknown): RelayValidationResult<RelayDocumentSearchRequestV1> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: ['request must be an object'],
    };
  }

  for (const field of Object.keys(input)) {
    if (RELAY_CONTROLLED_FIELDS.has(field)) {
      errors.push(`${field} is Relay-controlled and cannot be supplied by Copilot`);
    } else if (!RELAY_DOCUMENT_SEARCH_MODEL_FIELDS.includes(field as (typeof RELAY_DOCUMENT_SEARCH_MODEL_FIELDS)[number])) {
      errors.push(`Unknown request field: ${field}`);
    }
  }

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) errors.push('query is required');
  if (query.length > 2000) errors.push('query must be 2000 characters or less');
  if (hasControlCharacters(query)) errors.push('query must not contain control characters');

  const roots = normalizeStringArray(input.roots, 'roots', errors, 16);
  const intent = normalizeEnum(input.intent, INTENTS, 'find_files', 'intent', errors);
  const thoroughness = normalizeEnum(input.thoroughness, THOROUGHNESS, 'thorough', 'thoroughness', errors);
  const evidence = normalizeEnum(input.evidence, EVIDENCE_MODES, 'candidate', 'evidence', errors);
  const fileTypes = normalizeFileTypes(input.fileTypes, errors);
  const maxResults = normalizeMaxResults(input.maxResults, errors);

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    errors: [],
    value: {
      schemaVersion: RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT,
      query,
      roots,
      intent,
      thoroughness,
      fileTypes,
      maxResults,
      evidence,
    },
  };
}

export function validateRelayDocumentSearchResult(input: unknown): RelayValidationResult<RelayDocumentSearchResultV1> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: ['result must be an object'],
    };
  }

  if (input.schemaVersion !== RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT}`);
  }
  if (typeof input.status !== 'string' || !STATUSES.includes(input.status as RelayDocumentSearchStatus)) {
    errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  }
  if (!isRecord(input.progress)) errors.push('progress is required');
  if (!isRecord(input.job)) errors.push('job is required');
  if (!isRecord(input.correlation)) errors.push('correlation is required');
  if (!isRecord(input.queryPlan)) errors.push('queryPlan is required');
  if (!isRecord(input.coverage)) errors.push('coverage is required');
  if (!Array.isArray(input.results)) {
    errors.push('results must be an array');
  } else {
    validateRelayDocumentSearchResultItems(input.results, errors);
  }
  if (!isRecord(input.evidencePack)) errors.push('evidencePack is required');
  if (input.localDraft !== undefined && !isRecord(input.localDraft)) errors.push('localDraft must be an object');
  if (input.polishRequest !== undefined && !isRecord(input.polishRequest)) {
    errors.push('polishRequest must be an object');
  }
  if (input.polishProvider !== undefined && !isRecord(input.polishProvider)) {
    errors.push('polishProvider must be an object');
  }
  if (input.answer !== undefined && !isRecord(input.answer)) errors.push('answer must be an object');
  if (!isRecord(input.display)) {
    errors.push('display is required');
  } else if (typeof input.display.beginnerSummary !== 'string') {
    errors.push('display.beginnerSummary is required');
  }
  if (!isRecord(input.diagnostics)) errors.push('diagnostics is required');

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }
  return {
    ok: true,
    errors: [],
    value: input as RelayDocumentSearchResultV1,
  };
}

function validateRelayDocumentSearchResultItems(results: unknown[], errors: string[]): void {
  results.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`results[${index}] must be an object`);
      return;
    }
    for (const field of PRODUCT_RESULT_REQUIRED_STRING_FIELDS) {
      if (typeof item[field] !== 'string' || !String(item[field]).trim()) {
        errors.push(`results[${index}].${field} is required`);
      }
    }
    if (item.product_result_contract !== RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT) {
      errors.push(`results[${index}].product_result_contract must be ${RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT}`);
    }
    if (typeof item.score !== 'number') errors.push(`results[${index}].score must be a number`);
    if (!isRecord(item.score_breakdown)) errors.push(`results[${index}].score_breakdown is required`);
    if (!Array.isArray(item.source_indexes)) errors.push(`results[${index}].source_indexes must be an array`);
    if (typeof item.primary_source_index !== 'string' || !String(item.primary_source_index).trim()) {
      errors.push(`results[${index}].primary_source_index is required`);
    }
    if (!Array.isArray(item.anchors)) errors.push(`results[${index}].anchors must be an array`);
    if (!Array.isArray(item.warnings)) errors.push(`results[${index}].warnings must be an array`);
    if (!Array.isArray(item.actions)) errors.push(`results[${index}].actions must be an array`);
    if (!Array.isArray(item.action_models)) errors.push(`results[${index}].action_models must be an array`);
    if (!isRecord(item.preview_action)) errors.push(`results[${index}].preview_action is required`);
    if (!isRecord(item.open_action)) errors.push(`results[${index}].open_action is required`);
    if (!isRecord(item.ui_state)) errors.push(`results[${index}].ui_state is required`);
  });
}

export function isRelayDocumentSearchAlias(name: unknown): name is (typeof RELAY_DOCUMENT_SEARCH_APPROVED_ALIASES)[number] {
  return typeof name === 'string' && RELAY_DOCUMENT_SEARCH_APPROVED_ALIASES.includes(name as never);
}

export function acceptsRelayDocumentSearchAlias(advertisedTool: unknown): boolean {
  if (!isRecord(advertisedTool)) return false;
  const name =
    typeof advertisedTool.name === 'string'
      ? advertisedTool.name
      : isRecord(advertisedTool.function) && typeof advertisedTool.function.name === 'string'
        ? advertisedTool.function.name
        : undefined;
  if (!isRelayDocumentSearchAlias(name)) return false;
  if (name === RELAY_DOCUMENT_SEARCH_TOOL_NAME) return true;
  return (
    advertisedTool.requestContract === RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT ||
    advertisedTool.resultContract === RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT
  );
}

export const relayDocumentSearchOpenAiToolSchema = {
  type: 'function',
  function: {
    name: RELAY_DOCUMENT_SEARCH_TOOL_NAME,
    description:
      'Find local workspace documents, report progress/coverage, and return evidence-backed file results through Relay Agent.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          description: 'The user request in their own words.',
        },
        roots: {
          type: 'array',
          maxItems: 16,
          items: {
            type: 'string',
            minLength: 1,
          },
          description: 'Optional workspace roots selected by AionUi or the user.',
        },
        intent: {
          type: 'string',
          enum: INTENTS,
          default: 'find_files',
        },
        thoroughness: {
          type: 'string',
          enum: THOROUGHNESS,
          default: 'thorough',
        },
        fileTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: FILE_TYPES,
          },
          default: ['any'],
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 300,
          default: 50,
        },
        evidence: {
          type: 'string',
          enum: EVIDENCE_MODES,
          default: 'candidate',
        },
      },
    },
  },
} as const;
