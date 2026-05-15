import { RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES } from './relayDocumentSearchContract';
import type { RelayDocumentSearchEvidencePackV1 } from './relayDocumentSearchEvidencePack';
import type { RelayDocumentSearchLocalDraftV1 } from './relayDocumentSearchLocalDraft';

export const RELAY_DOCUMENT_SEARCH_POLISH_VALIDATION_CONTRACT =
  'RelayDocumentSearchPolishValidation.v1' as const;
export const RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT =
  'RelayDocumentSearchPolishedAnswer.v1' as const;

export type RelayDocumentSearchPolishState =
  | 'polish_pending'
  | 'polish_accepted'
  | 'polish_repair_required'
  | 'polish_rejected'
  | 'polish_skipped';

export type RelayDocumentSearchPolishCorrelation = {
  relayJobId?: string;
  queryId?: string;
  aionuiConversationId?: string;
  aionuiMessageId?: string;
  copilotSessionId?: string;
  copilotRequestId?: string;
  copilotTurnId?: string;
  evidencePackId: string;
  localDraftId: string;
  polishedAnswerId?: string;
};

export type RelayDocumentSearchPolishedAnswerV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT;
  polished_answer_id?: string;
  prompt_template_id?: typeof RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish;
  evidence_pack_id: string;
  local_draft_id: string;
  answer: string;
  citations: Array<{
    citation_id?: string;
    evidence_id: string;
  }>;
};

export type RelayDocumentSearchPolishValidationReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_POLISH_VALIDATION_CONTRACT;
  state: RelayDocumentSearchPolishState;
  accepted: boolean;
  generated_at: string;
  evidence_pack_id: string;
  local_draft_id: string;
  polished_answer_id?: string;
  accepted_answer?: string;
  citation_ids: string[];
  evidence_ids: string[];
  repair_attempt: number;
  prompt_template_ids: {
    answerPolish: typeof RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish;
    polishRepair: typeof RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.polishRepair;
  };
  repair_prompt_template_id?: typeof RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.polishRepair;
  correlation: RelayDocumentSearchPolishCorrelation;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  ai_boundary: {
    localFirst: true;
    originalFilesIncluded: false;
    acceptsOnlyEvidencePackCitations: true;
    repairAtMostOnce: true;
  };
};

export type RelayDocumentSearchPolishValidationInput = {
  candidate?: unknown;
  evidencePack: RelayDocumentSearchEvidencePackV1;
  localDraft: RelayDocumentSearchLocalDraftV1;
  generatedAt?: string;
  repairAttempt?: number;
  redactionAllowsCopilot?: boolean;
  correlation?: Partial<RelayDocumentSearchPolishCorrelation>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
    : '';
}

function baseReport(
  input: RelayDocumentSearchPolishValidationInput,
  state: RelayDocumentSearchPolishState,
  generatedAt: string,
): RelayDocumentSearchPolishValidationReport {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_POLISH_VALIDATION_CONTRACT,
    state,
    accepted: false,
    generated_at: generatedAt,
    evidence_pack_id: input.evidencePack.evidence_pack_id,
    local_draft_id: input.localDraft.local_draft_id,
    citation_ids: [],
    evidence_ids: [],
    repair_attempt: Math.max(0, input.repairAttempt ?? 0),
    prompt_template_ids: {
      answerPolish: RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish,
      polishRepair: RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.polishRepair,
    },
    correlation: {
      relayJobId: input.correlation?.relayJobId ?? input.evidencePack.job_id,
      queryId: input.correlation?.queryId ?? input.evidencePack.query_id ?? input.localDraft.query_id,
      aionuiConversationId: input.correlation?.aionuiConversationId,
      aionuiMessageId: input.correlation?.aionuiMessageId,
      copilotSessionId: input.correlation?.copilotSessionId,
      copilotRequestId: input.correlation?.copilotRequestId,
      copilotTurnId: input.correlation?.copilotTurnId,
      evidencePackId: input.evidencePack.evidence_pack_id,
      localDraftId: input.localDraft.local_draft_id,
      polishedAnswerId: input.correlation?.polishedAnswerId,
    },
    errors: [],
    warnings: [],
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      acceptsOnlyEvidencePackCitations: true,
      repairAtMostOnce: true,
    },
  };
}

function citationIdByEvidenceId(localDraft: RelayDocumentSearchLocalDraftV1): Map<string, string> {
  return new Map(localDraft.citations.map((citation) => [citation.evidence_id, citation.citation_id]));
}

function allowedEvidenceIds(evidencePack: RelayDocumentSearchEvidencePackV1): Set<string> {
  return new Set(evidencePack.evidence.map((item) => item.evidence_id));
}

function allowedCitationIds(localDraft: RelayDocumentSearchLocalDraftV1): Set<string> {
  return new Set(localDraft.citations.map((citation) => citation.citation_id));
}

function allowedTextCorpus(
  evidencePack: RelayDocumentSearchEvidencePackV1,
  localDraft: RelayDocumentSearchLocalDraftV1,
): string {
  const evidenceText = evidencePack.evidence.flatMap((item) => [
    item.evidence_id,
    item.file_id,
    item.result_id,
    item.display_name,
    item.display_path,
    item.path,
    isRecord(item.anchor) ? item.anchor.sheet_name : undefined,
    isRecord(item.anchor) ? item.anchor.sheet : undefined,
    isRecord(item.anchor) ? item.anchor.cell_address : undefined,
    isRecord(item.anchor) ? item.anchor.cell : undefined,
    isRecord(item.anchor) ? item.anchor.page_id : undefined,
    isRecord(item.anchor) ? item.anchor.snippet : undefined,
  ]);
  const candidateText = evidencePack.candidate_files.flatMap((candidate) => [
    candidate.result_id,
    candidate.file_id,
    candidate.display_name,
    candidate.display_path,
    candidate.path,
  ]);
  const draftText = [
    localDraft.summary,
    ...localDraft.citations.flatMap((citation) => [
      citation.citation_id,
      citation.evidence_id,
      citation.label,
      citation.anchor_summary,
    ]),
  ];
  return normalizeText([...evidenceText, ...candidateText, ...draftText].filter(Boolean).join(' '));
}

function fileMentions(answer: string): string[] {
  const matches = answer.match(/[^\s"'()（）「」、。]+?\.(?:xlsx|xlsm|xls|docx|doc|pptx|ppt|pdf|csv|txt|md)\b/giu);
  return matches ?? [];
}

function sheetCellMentions(answer: string): string[] {
  const matches = answer.match(/[A-Za-z0-9_\-一-龠ぁ-んァ-ン]+![A-Z]{1,3}\d+\b/gu);
  return matches ?? [];
}

function citationMarkers(answer: string): string[] {
  return [...answer.matchAll(/\[([A-Za-z]\d+)\]/gu)].map((match) => match[1]);
}

function candidateFromUnknown(input: unknown): RelayDocumentSearchPolishedAnswerV1 | undefined {
  if (!isRecord(input)) return undefined;
  if (input.schemaVersion !== RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT) return undefined;
  if (!Array.isArray(input.citations)) return undefined;
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_POLISHED_ANSWER_CONTRACT,
    polished_answer_id: asString(input.polished_answer_id) || undefined,
    prompt_template_id: asString(input.prompt_template_id) === RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish
      ? RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish
      : undefined,
    evidence_pack_id: asString(input.evidence_pack_id),
    local_draft_id: asString(input.local_draft_id),
    answer: asString(input.answer),
    citations: input.citations
      .filter((citation): citation is Record<string, unknown> => isRecord(citation))
      .map((citation) => ({
        citation_id: asString(citation.citation_id) || undefined,
        evidence_id: asString(citation.evidence_id),
      })),
  };
}

function transitionForInvalid(repairAttempt: number): RelayDocumentSearchPolishState {
  return repairAttempt > 0 ? 'polish_rejected' : 'polish_repair_required';
}

export function validateRelayDocumentSearchCopilotPolish(
  input: RelayDocumentSearchPolishValidationInput,
): RelayDocumentSearchPolishValidationReport {
  const generatedAt = input.generatedAt ?? input.evidencePack.generated_at;
  const repairAttempt = Math.max(0, input.repairAttempt ?? 0);
  if (!input.candidate) {
    const report = baseReport(input, 'polish_pending', generatedAt);
    if (!input.localDraft.can_replace_with_copilot_polish) {
      report.state = 'polish_skipped';
      report.warnings.push({
        code: 'local_draft_not_polishable',
        message: 'Local draft quality does not allow Copilot polish replacement.',
      });
    } else if (input.redactionAllowsCopilot === false) {
      report.state = 'polish_skipped';
      report.warnings.push({
        code: 'redaction_blocks_copilot',
        message: 'Evidence redaction policy does not allow sending snippets for Copilot polish.',
      });
    }
    return report;
  }

  const report = baseReport(input, 'polish_accepted', generatedAt);
  const candidate = candidateFromUnknown(input.candidate);
  if (!candidate) {
    report.state = transitionForInvalid(repairAttempt);
    report.repair_prompt_template_id = report.state === 'polish_repair_required'
      ? RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.polishRepair
      : undefined;
    report.errors.push({
      code: 'invalid_polish_shape',
      message: 'Copilot polish must be a RelayDocumentSearchPolishedAnswer.v1 object.',
    });
    return report;
  }

  report.polished_answer_id = candidate.polished_answer_id ||
    `polished-answer-${stableHash(`${candidate.evidence_pack_id}:${candidate.local_draft_id}:${candidate.answer}`)}`;
  report.correlation.polishedAnswerId = report.polished_answer_id;
  report.citation_ids = candidate.citations.map((citation) => citation.citation_id).filter((id): id is string => Boolean(id));
  report.evidence_ids = candidate.citations.map((citation) => citation.evidence_id).filter(Boolean);

  const rawCandidate = isRecord(input.candidate) ? input.candidate : {};
  const candidatePromptTemplateId = asString(rawCandidate.prompt_template_id);
  if (candidatePromptTemplateId && candidatePromptTemplateId !== RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.answerPolish) {
    report.errors.push({
      code: 'prompt_template_mismatch',
      message: 'Polish answer must reference relay_answer_polish_prompt.v1 when a prompt template is declared.',
    });
  }
  if (!input.localDraft.can_replace_with_copilot_polish) {
    report.errors.push({
      code: 'local_draft_not_polishable',
      message: 'Candidate-only or incomplete local drafts cannot be replaced by Copilot polish.',
    });
  }
  if (candidate.evidence_pack_id !== input.evidencePack.evidence_pack_id) {
    report.errors.push({ code: 'evidence_pack_mismatch', message: 'Polish references a different Evidence Pack.' });
  }
  if (candidate.local_draft_id !== input.localDraft.local_draft_id) {
    report.errors.push({ code: 'local_draft_mismatch', message: 'Polish references a different local draft.' });
  }
  if (!candidate.answer) {
    report.errors.push({ code: 'empty_answer', message: 'Polish answer is empty.' });
  }
  if (normalizeText(candidate.answer) === normalizeText(input.localDraft.summary)) {
    report.errors.push({ code: 'duplicate_local_draft', message: 'Polish only duplicated the local draft summary.' });
  }
  if (candidate.answer.endsWith('...') || candidate.answer.endsWith('…') || candidate.answer.endsWith('、')) {
    report.errors.push({ code: 'truncated_answer', message: 'Polish answer appears truncated.' });
  }

  const knownEvidenceIds = allowedEvidenceIds(input.evidencePack);
  const knownCitationIds = allowedCitationIds(input.localDraft);
  const citationByEvidenceId = citationIdByEvidenceId(input.localDraft);
  if (!candidate.citations.length) {
    report.errors.push({ code: 'missing_citations', message: 'Polish answer must include Evidence Pack citations.' });
  }
  for (const citation of candidate.citations) {
    if (!knownEvidenceIds.has(citation.evidence_id)) {
      report.errors.push({
        code: 'unknown_evidence_id',
        message: `Unknown evidence id: ${citation.evidence_id}`,
      });
    }
    const expectedCitationId = citationByEvidenceId.get(citation.evidence_id);
    if (citation.citation_id && !knownCitationIds.has(citation.citation_id)) {
      report.errors.push({
        code: 'unknown_citation_id',
        message: `Unknown citation id: ${citation.citation_id}`,
      });
    }
    if (citation.citation_id && expectedCitationId && citation.citation_id !== expectedCitationId) {
      report.errors.push({
        code: 'citation_evidence_mismatch',
        message: `${citation.citation_id} does not point to ${citation.evidence_id}.`,
      });
    }
  }

  const markers = citationMarkers(candidate.answer);
  if (!markers.length) {
    report.errors.push({ code: 'missing_inline_citations', message: 'Polish answer must cite evidence inline.' });
  }
  for (const citationId of report.citation_ids) {
    if (!markers.includes(citationId)) {
      report.errors.push({
        code: 'citation_not_used',
        message: `Citation ${citationId} is declared but not used in the answer.`,
      });
    }
  }
  for (const marker of markers) {
    if (!knownCitationIds.has(marker)) {
      report.errors.push({
        code: 'unknown_inline_citation',
        message: `Inline citation ${marker} is not in the local draft citations.`,
      });
    }
  }

  const allowedText = allowedTextCorpus(input.evidencePack, input.localDraft);
  for (const mention of [...fileMentions(candidate.answer), ...sheetCellMentions(candidate.answer)]) {
    if (!allowedText.includes(normalizeText(mention))) {
      report.errors.push({
        code: 'unsupported_mention',
        message: `Polish mentions unsupported evidence detail: ${mention}`,
      });
    }
  }

  if (report.errors.length > 0) {
    report.state = transitionForInvalid(repairAttempt);
    report.accepted = false;
    report.repair_prompt_template_id = report.state === 'polish_repair_required'
      ? RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES.polishRepair
      : undefined;
    report.repair_attempt = repairAttempt;
    return report;
  }

  report.state = 'polish_accepted';
  report.accepted = true;
  report.accepted_answer = candidate.answer;
  return report;
}
