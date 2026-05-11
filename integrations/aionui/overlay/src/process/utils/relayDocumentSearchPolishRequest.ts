import { RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES } from './relayDocumentSearchContract';
import {
  RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT,
  type RelayDocumentSearchPolishCorrelation,
} from './relayDocumentSearchPolishValidation';
import type { RelayDocumentSearchEvidencePackV1 } from './relayDocumentSearchEvidencePack';
import type { RelayDocumentSearchEvidenceRedactionReport } from './relayDocumentSearchEvidenceRedaction';
import type { RelayDocumentSearchLocalDraftV1 } from './relayDocumentSearchLocalDraft';

export const RELAY_DOCUMENT_SEARCH_POLISH_REQUEST_CONTRACT =
  'RelayDocumentSearchPolishRequest.v1' as const;

export type RelayDocumentSearchPolishRequestStatus = 'ready' | 'not_allowed';

export type RelayDocumentSearchPolishRequestReason =
  | 'ready_for_copilot'
  | 'local_draft_not_polishable'
  | 'redaction_policy_blocks_copilot'
  | 'no_redacted_evidence';

export type RelayDocumentSearchPolishRequestV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_POLISH_REQUEST_CONTRACT;
  status: RelayDocumentSearchPolishRequestStatus;
  reason: RelayDocumentSearchPolishRequestReason;
  generated_at: string;
  prompt_template_id: typeof RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish;
  expected_output_schema: typeof RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT;
  evidence_pack_id: string;
  local_draft_id: string;
  query: string;
  correlation: RelayDocumentSearchPolishCorrelation;
  redaction_policy: RelayDocumentSearchEvidenceRedactionReport['policy'];
  redacted_evidence_count: number;
  citation_ids: string[];
  evidence_ids: string[];
  payload: {
    evidence_pack_id: string;
    local_draft_id: string;
    query: string;
    local_draft_summary: string;
    citations: Array<{
      citation_id: string;
      evidence_id: string;
      label: string;
      anchor_summary?: string;
    }>;
    redacted_evidence: RelayDocumentSearchEvidenceRedactionReport['redactedEvidence'];
  };
  prompt?: string;
  warnings: Array<{ code: string; message: string }>;
  ai_boundary: {
    localFirst: true;
    originalFilesIncluded: false;
    fullPathsIncluded: false;
    extractedContentIncludedOnlyAfterRedaction: true;
    expectsStructuredPolishedAnswer: true;
  };
};

export type RelayDocumentSearchPolishRequestInput = {
  evidencePack: RelayDocumentSearchEvidencePackV1;
  localDraft: RelayDocumentSearchLocalDraftV1;
  redaction: RelayDocumentSearchEvidenceRedactionReport;
  generatedAt?: string;
  correlation?: Partial<RelayDocumentSearchPolishCorrelation>;
};

export type RelayDocumentSearchPolishRequestValidation = {
  ok: boolean;
  errors: string[];
};

function reasonFor(input: RelayDocumentSearchPolishRequestInput): RelayDocumentSearchPolishRequestReason {
  if (!input.localDraft.can_replace_with_copilot_polish) return 'local_draft_not_polishable';
  if (!input.redaction.canSendToCopilot) return 'redaction_policy_blocks_copilot';
  if (input.redaction.redactedEvidence.length === 0) return 'no_redacted_evidence';
  return 'ready_for_copilot';
}

function promptFor(request: Omit<RelayDocumentSearchPolishRequestV1, 'prompt'>): string {
  return [
    `Prompt template: ${request.prompt_template_id}`,
    `Return only a JSON object with schemaVersion "${request.expected_output_schema}".`,
    'Rewrite the local draft in Japanese using only the cited Evidence Pack items below.',
    'Every factual claim must include inline citation ids like [E1].',
    'Do not add files, paths, folders, sheet names, cells, dates, amounts, counts, or completion claims not present in this payload.',
    'Do not mention unsupported or omitted evidence. Do not include Markdown fences.',
    '',
    JSON.stringify({
      schemaVersion: request.schemaVersion,
      evidence_pack_id: request.evidence_pack_id,
      local_draft_id: request.local_draft_id,
      expected_output_schema: request.expected_output_schema,
      payload: request.payload,
    }),
  ].join('\n');
}

export function buildRelayDocumentSearchPolishRequest(
  input: RelayDocumentSearchPolishRequestInput,
): RelayDocumentSearchPolishRequestV1 {
  const reason = reasonFor(input);
  const status: RelayDocumentSearchPolishRequestStatus = reason === 'ready_for_copilot' ? 'ready' : 'not_allowed';
  const correlation: RelayDocumentSearchPolishCorrelation = {
    relayJobId: input.correlation?.relayJobId ?? input.evidencePack.job_id,
    queryId: input.correlation?.queryId ?? input.evidencePack.query_id ?? input.localDraft.query_id,
    evidencePackId: input.evidencePack.evidence_pack_id,
    localDraftId: input.localDraft.local_draft_id,
  };
  if (input.correlation?.aionuiConversationId) correlation.aionuiConversationId = input.correlation.aionuiConversationId;
  if (input.correlation?.aionuiMessageId) correlation.aionuiMessageId = input.correlation.aionuiMessageId;
  if (input.correlation?.copilotSessionId) correlation.copilotSessionId = input.correlation.copilotSessionId;
  if (input.correlation?.copilotRequestId) correlation.copilotRequestId = input.correlation.copilotRequestId;
  if (input.correlation?.copilotTurnId) correlation.copilotTurnId = input.correlation.copilotTurnId;
  if (input.correlation?.polishedAnswerId) correlation.polishedAnswerId = input.correlation.polishedAnswerId;

  const payload: RelayDocumentSearchPolishRequestV1['payload'] = {
    evidence_pack_id: input.evidencePack.evidence_pack_id,
    local_draft_id: input.localDraft.local_draft_id,
    query: input.localDraft.query || input.evidencePack.query,
    local_draft_summary: input.localDraft.summary,
    citations: input.localDraft.citations.map((citation) => {
      const item: RelayDocumentSearchPolishRequestV1['payload']['citations'][number] = {
        citation_id: citation.citation_id,
        evidence_id: citation.evidence_id,
        label: citation.label,
      };
      if (citation.anchor_summary) item.anchor_summary = citation.anchor_summary;
      return item;
    }),
    redacted_evidence: input.redaction.redactedEvidence,
  };
  const warnings = [...input.redaction.warnings];
  if (reason === 'local_draft_not_polishable') {
    warnings.push({
      code: 'local_draft_not_polishable',
      message: 'Local draft cannot be replaced by Copilot polish.',
    });
  } else if (reason === 'no_redacted_evidence') {
    warnings.push({
      code: 'no_redacted_evidence',
      message: 'No redacted evidence is available for Copilot polish.',
    });
  }

  const requestWithoutPrompt: Omit<RelayDocumentSearchPolishRequestV1, 'prompt'> = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_POLISH_REQUEST_CONTRACT,
    status,
    reason,
    generated_at: input.generatedAt ?? input.evidencePack.generated_at,
    prompt_template_id: RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish,
    expected_output_schema: RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT,
    evidence_pack_id: input.evidencePack.evidence_pack_id,
    local_draft_id: input.localDraft.local_draft_id,
    query: payload.query,
    correlation,
    redaction_policy: input.redaction.policy,
    redacted_evidence_count: input.redaction.redactedEvidence.length,
    citation_ids: input.localDraft.citations.map((citation) => citation.citation_id),
    evidence_ids: input.localDraft.citations.map((citation) => citation.evidence_id),
    payload,
    warnings,
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      fullPathsIncluded: false,
      extractedContentIncludedOnlyAfterRedaction: true,
      expectsStructuredPolishedAnswer: true,
    },
  };
  if (status !== 'ready') return requestWithoutPrompt;
  return {
    ...requestWithoutPrompt,
    prompt: promptFor(requestWithoutPrompt),
  };
}

export function validateRelayDocumentSearchPolishRequest(
  input: unknown,
): RelayDocumentSearchPolishRequestValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['polish request must be an object'] };
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== RELAY_DOCUMENT_SEARCH_POLISH_REQUEST_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_POLISH_REQUEST_CONTRACT}`);
  }
  if (record.prompt_template_id !== RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish) {
    errors.push('prompt_template_id is invalid');
  }
  if (record.expected_output_schema !== RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT) {
    errors.push('expected_output_schema is invalid');
  }
  if (record.status !== 'ready' && record.status !== 'not_allowed') errors.push('status is invalid');
  for (const field of ['reason', 'generated_at', 'evidence_pack_id', 'local_draft_id', 'query']) {
    if (typeof record[field] !== 'string' || !String(record[field]).trim()) errors.push(`${field} is required`);
  }
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    errors.push('payload is required');
  }
  if (!record.correlation || typeof record.correlation !== 'object' || Array.isArray(record.correlation)) {
    errors.push('correlation is required');
  }
  if (!Array.isArray(record.citation_ids)) errors.push('citation_ids must be an array');
  if (!Array.isArray(record.evidence_ids)) errors.push('evidence_ids must be an array');
  if (typeof record.redacted_evidence_count !== 'number') errors.push('redacted_evidence_count must be a number');
  if (!Array.isArray(record.warnings)) errors.push('warnings must be an array');
  const aiBoundary = record.ai_boundary;
  if (!aiBoundary || typeof aiBoundary !== 'object' || Array.isArray(aiBoundary)) {
    errors.push('ai_boundary is required');
  } else {
    const boundary = aiBoundary as Record<string, unknown>;
    if (boundary.originalFilesIncluded !== false) errors.push('ai_boundary.originalFilesIncluded must be false');
    if (boundary.fullPathsIncluded !== false) errors.push('ai_boundary.fullPathsIncluded must be false');
    if (boundary.expectsStructuredPolishedAnswer !== true) {
      errors.push('ai_boundary.expectsStructuredPolishedAnswer must be true');
    }
  }
  if (record.status === 'ready' && (typeof record.prompt !== 'string' || !record.prompt.trim())) {
    errors.push('ready polish requests require prompt');
  }
  if (record.status === 'not_allowed' && typeof record.prompt === 'string') {
    errors.push('not_allowed polish requests must not include prompt');
  }
  return { ok: errors.length === 0, errors };
}
