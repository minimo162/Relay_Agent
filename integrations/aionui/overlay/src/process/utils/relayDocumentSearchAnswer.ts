import type { RelayDocumentSearchLocalDraftV1 } from './relayDocumentSearchLocalDraft';
import type { RelayDocumentSearchPolishValidationReport } from './relayDocumentSearchPolishValidation';

export const RELAY_DOCUMENT_SEARCH_ANSWER_CONTRACT = 'RelayDocumentSearchAnswer.v1' as const;

export type RelayDocumentSearchAnswerSource = 'local_draft' | 'copilot_polish';

export type RelayDocumentSearchAnswerV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_ANSWER_CONTRACT;
  answer_id: string;
  generated_at: string;
  source: RelayDocumentSearchAnswerSource;
  evidence_pack_id: string;
  local_draft_id: string;
  polished_answer_id?: string;
  text: string;
  citation_ids: string[];
  evidence_ids: string[];
  replacement: {
    localDraftCommitted: true;
    replacementCount: 0 | 1;
    canReplaceAgain: false;
    reason:
      | 'local_draft_only'
      | 'copilot_polish_accepted'
      | 'copilot_polish_pending'
      | 'copilot_polish_rejected'
      | 'copilot_polish_skipped'
      | 'copilot_polish_repair_required';
  };
  validation: {
    groundedInEvidencePack: true;
    acceptedPolish: boolean;
    polishValidationState: RelayDocumentSearchPolishValidationReport['state'];
  };
  ai_boundary: {
    localFirst: true;
    originalFilesIncluded: false;
    copilotMayOnlyReplaceAfterValidation: true;
    replacementAtMostOnce: true;
  };
};

export type RelayDocumentSearchAnswerInput = {
  localDraft: RelayDocumentSearchLocalDraftV1;
  polishValidation: RelayDocumentSearchPolishValidationReport;
  generatedAt?: string;
};

export type RelayDocumentSearchAnswerValidation = {
  ok: boolean;
  errors: string[];
};

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function replacementReason(
  polishValidation: RelayDocumentSearchPolishValidationReport,
): RelayDocumentSearchAnswerV1['replacement']['reason'] {
  if (polishValidation.accepted && polishValidation.accepted_answer) return 'copilot_polish_accepted';
  switch (polishValidation.state) {
    case 'polish_pending':
      return 'copilot_polish_pending';
    case 'polish_repair_required':
      return 'copilot_polish_repair_required';
    case 'polish_rejected':
      return 'copilot_polish_rejected';
    case 'polish_skipped':
      return 'copilot_polish_skipped';
    case 'polish_accepted':
      return 'local_draft_only';
    default:
      return 'local_draft_only';
  }
}

export function buildRelayDocumentSearchAnswer(input: RelayDocumentSearchAnswerInput): RelayDocumentSearchAnswerV1 {
  const generatedAt = input.generatedAt ?? input.localDraft.generated_at;
  const acceptedPolish = Boolean(input.polishValidation.accepted && input.polishValidation.accepted_answer);
  const text = acceptedPolish ? String(input.polishValidation.accepted_answer) : input.localDraft.summary;
  const citationIds = acceptedPolish
    ? input.polishValidation.citation_ids
    : input.localDraft.citations.map((citation) => citation.citation_id);
  const evidenceIds = acceptedPolish
    ? input.polishValidation.evidence_ids
    : input.localDraft.citations.map((citation) => citation.evidence_id);
  const source: RelayDocumentSearchAnswerSource = acceptedPolish ? 'copilot_polish' : 'local_draft';
  const polishedAnswerId = acceptedPolish ? input.polishValidation.polished_answer_id : undefined;
  const answerIdSeed = [
    input.localDraft.evidence_pack_id,
    input.localDraft.local_draft_id,
    source,
    polishedAnswerId ?? '',
    text,
  ].join(':');
  const answer: RelayDocumentSearchAnswerV1 = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_ANSWER_CONTRACT,
    answer_id: `answer-${stableHash(answerIdSeed)}`,
    generated_at: generatedAt,
    source,
    evidence_pack_id: input.localDraft.evidence_pack_id,
    local_draft_id: input.localDraft.local_draft_id,
    text,
    citation_ids: [...new Set(citationIds.filter(Boolean))],
    evidence_ids: [...new Set(evidenceIds.filter(Boolean))],
    replacement: {
      localDraftCommitted: true,
      replacementCount: acceptedPolish ? 1 : 0,
      canReplaceAgain: false,
      reason: replacementReason(input.polishValidation),
    },
    validation: {
      groundedInEvidencePack: true,
      acceptedPolish,
      polishValidationState: input.polishValidation.state,
    },
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      copilotMayOnlyReplaceAfterValidation: true,
      replacementAtMostOnce: true,
    },
  };
  if (polishedAnswerId) answer.polished_answer_id = polishedAnswerId;
  return answer;
}

export function validateRelayDocumentSearchAnswer(input: unknown): RelayDocumentSearchAnswerValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['answer must be an object'] };
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== RELAY_DOCUMENT_SEARCH_ANSWER_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_ANSWER_CONTRACT}`);
  }
  for (const field of ['answer_id', 'generated_at', 'evidence_pack_id', 'local_draft_id', 'text']) {
    if (typeof record[field] !== 'string' || !String(record[field]).trim()) errors.push(`${field} is required`);
  }
  if (record.source !== 'local_draft' && record.source !== 'copilot_polish') errors.push('source is invalid');
  if (!Array.isArray(record.citation_ids)) errors.push('citation_ids must be an array');
  if (!Array.isArray(record.evidence_ids)) errors.push('evidence_ids must be an array');
  const replacement = record.replacement;
  if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
    errors.push('replacement is required');
  } else {
    const replacementRecord = replacement as Record<string, unknown>;
    if (replacementRecord.localDraftCommitted !== true) errors.push('replacement.localDraftCommitted must be true');
    if (replacementRecord.canReplaceAgain !== false) errors.push('replacement.canReplaceAgain must be false');
    if (replacementRecord.replacementCount !== 0 && replacementRecord.replacementCount !== 1) {
      errors.push('replacement.replacementCount must be 0 or 1');
    }
  }
  const validation = record.validation;
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    errors.push('validation is required');
  } else if ((validation as Record<string, unknown>).groundedInEvidencePack !== true) {
    errors.push('validation.groundedInEvidencePack must be true');
  }
  const aiBoundary = record.ai_boundary;
  if (!aiBoundary || typeof aiBoundary !== 'object' || Array.isArray(aiBoundary)) {
    errors.push('ai_boundary is required');
  } else {
    const aiBoundaryRecord = aiBoundary as Record<string, unknown>;
    if (aiBoundaryRecord.originalFilesIncluded !== false) errors.push('ai_boundary.originalFilesIncluded must be false');
    if (aiBoundaryRecord.localFirst !== true) errors.push('ai_boundary.localFirst must be true');
    if (aiBoundaryRecord.replacementAtMostOnce !== true) errors.push('ai_boundary.replacementAtMostOnce must be true');
  }
  if (record.source === 'copilot_polish' && typeof record.polished_answer_id !== 'string') {
    errors.push('copilot_polish answers require polished_answer_id');
  }
  return { ok: errors.length === 0, errors };
}
