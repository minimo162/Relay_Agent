import type { RelayDocumentSearchEvidencePackV1 } from './relayDocumentSearchEvidencePack';
import type { RelayDocumentSearchAnswerPolicy, RelayDocumentSearchQualityReport } from './relayDocumentSearchQualityGates';

export const RELAY_DOCUMENT_SEARCH_LOCAL_DRAFT_CONTRACT = 'RelayDocumentSearchLocalDraft.v1' as const;

export type RelayDocumentSearchLocalDraftCitation = {
  citation_id: string;
  evidence_id: string;
  result_id?: string;
  file_id?: string;
  label: string;
  anchor_summary?: string;
};

export type RelayDocumentSearchLocalDraftSection = {
  kind: 'confirmed_evidence' | 'candidate_files' | 'caveats' | 'next_steps';
  title: string;
  items: Array<{
    text: string;
    citation_ids?: string[];
    result_id?: string;
    file_id?: string;
  }>;
};

export type RelayDocumentSearchLocalDraftV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_LOCAL_DRAFT_CONTRACT;
  local_draft_id: string;
  evidence_pack_id: string;
  job_id: string;
  query_id?: string;
  generated_at: string;
  query: string;
  answer_policy: RelayDocumentSearchAnswerPolicy;
  citation_policy: 'evidence_pack_ids_required' | 'candidate_language_only';
  can_replace_with_copilot_polish: boolean;
  summary: string;
  sections: RelayDocumentSearchLocalDraftSection[];
  citations: RelayDocumentSearchLocalDraftCitation[];
  caveats: string[];
  next_actions: string[];
  validation: {
    groundedInEvidencePack: true;
    unsupportedClaims: [];
    evidenceItemCount: number;
    candidateFileCount: number;
    warningCodes: string[];
  };
  ai_boundary: {
    localFirst: true;
    copilotMayOnlyPolish: true;
    copilotPolishRequiresCitationValidation: true;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchLocalDraftInput = {
  evidencePack: RelayDocumentSearchEvidencePackV1;
  quality: RelayDocumentSearchQualityReport;
  generatedAt?: string;
};

export type RelayDocumentSearchLocalDraftValidation = {
  ok: boolean;
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundedText(value: unknown, limit = 180): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/gu, ' ').trim();
  return text ? text.slice(0, limit) : undefined;
}

function anchorSummary(anchor: unknown): string | undefined {
  const record = isRecord(anchor) ? anchor : {};
  const sheet = asString(record.sheet_name, asString(record.sheet));
  const cell = asString(record.cell_address, asString(record.cell));
  if (sheet && cell) return `${sheet}!${cell}`;
  if (cell) return cell;
  const page = asString(record.page_id, asString(record.page));
  if (page) return `ページ ${page}`;
  const line = asString(record.line_id, asString(record.line));
  if (line) return `行 ${line}`;
  const node = asString(record.node_id);
  if (node) return `構造位置 ${node}`;
  return asString(record.type) || undefined;
}

function candidateLabel(candidate: unknown): string {
  const record = isRecord(candidate) ? candidate : {};
  return asString(record.display_name, asString(record.display_path, asString(record.path, '候補ファイル')));
}

function warningCopy(code: string): string {
  switch (code) {
    case 'candidate_only':
    case 'filename_only':
      return 'ファイル名・パスの候補であり、中身の根拠はまだありません。';
    case 'content_unconfirmed':
    case 'content_not_confirmed':
      return '一部の候補は中身の一致を確認できていません。';
    case 'coverage_incomplete':
      return '検索範囲に未完了、スキップ、権限不足、またはタイムアウトがあります。';
    case 'content_reader_unavailable':
      return '一部の形式は現在の reader では中身確認できません。';
    case 'unsupported_content_reader':
      return '未対応形式はファイル名候補としてのみ扱っています。';
    case 'timeout_partial':
      return '検索がタイムアウトしたため、途中までの結果です。';
    case 'cancelled':
      return '検索がキャンセルされたため、途中までの結果です。';
    case 'no_results':
    case 'no_filename_candidates':
      return '条件に合う候補は見つかりませんでした。';
    default:
      return code;
  }
}

function buildCitations(evidencePack: RelayDocumentSearchEvidencePackV1): RelayDocumentSearchLocalDraftCitation[] {
  return evidencePack.evidence.map((item, index) => {
    const citationId = `E${index + 1}`;
    const label = asString(item.display_name, asString(item.display_path, asString(item.path, citationId)));
    return {
      citation_id: citationId,
      evidence_id: item.evidence_id,
      result_id: item.result_id,
      file_id: item.file_id,
      label,
      anchor_summary: anchorSummary(item.anchor),
    };
  });
}

function summaryFor(input: RelayDocumentSearchLocalDraftInput): string {
  const evidenceCount = input.evidencePack.evidence.length;
  const candidateCount = input.evidencePack.candidate_files.length;
  if (evidenceCount > 0 && input.quality.answerPolicy === 'evidence_confirmed') {
    return `中身を確認できた根拠が${evidenceCount}件あります。候補ファイルは${candidateCount}件です。`;
  }
  if (evidenceCount > 0) {
    return `中身を確認できた根拠が${evidenceCount}件ありますが、検索範囲は一部未完了です。`;
  }
  if (candidateCount > 0) {
    return `ファイル名・パスの候補が${candidateCount}件あります。中身の根拠はまだ確認できていません。`;
  }
  return '条件に合う候補は見つかりませんでした。検索語やフォルダを変えて再検索できます。';
}

function confirmedEvidenceSection(
  evidencePack: RelayDocumentSearchEvidencePackV1,
  citations: RelayDocumentSearchLocalDraftCitation[],
): RelayDocumentSearchLocalDraftSection | undefined {
  if (!evidencePack.evidence.length) return undefined;
  return {
    kind: 'confirmed_evidence',
    title: '確認済みの根拠',
    items: evidencePack.evidence.slice(0, 5).map((item, index) => {
      const citation = citations[index];
      const summary = citation.anchor_summary ? ` (${citation.anchor_summary})` : '';
      const snippet = boundedText(isRecord(item.anchor) ? item.anchor.snippet : undefined);
      return {
        text: `${citation.label}${summary}${snippet ? `: ${snippet}` : ''}`,
        citation_ids: [citation.citation_id],
        result_id: item.result_id,
        file_id: item.file_id,
      };
    }),
  };
}

function candidateSection(evidencePack: RelayDocumentSearchEvidencePackV1): RelayDocumentSearchLocalDraftSection | undefined {
  if (!evidencePack.candidate_files.length) return undefined;
  return {
    kind: 'candidate_files',
    title: '候補ファイル',
    items: evidencePack.candidate_files.slice(0, 5).map((candidate) => ({
      text: `${candidateLabel(candidate)} - ${asString(candidate.evidence_state) || 'candidate'}`,
      result_id: isRecord(candidate) ? asString(candidate.result_id) : undefined,
      file_id: isRecord(candidate) ? asString(candidate.file_id) : undefined,
    })),
  };
}

function uniqueWarnings(input: RelayDocumentSearchLocalDraftInput): string[] {
  const evidenceWarnings = input.evidencePack.warnings.map((warning) => warning.code);
  const qualityWarnings = input.quality.warnings.map((warning) => warning.code);
  return [...new Set([...evidenceWarnings, ...qualityWarnings])].filter(Boolean);
}

function caveatsFor(input: RelayDocumentSearchLocalDraftInput): string[] {
  return uniqueWarnings(input).map(warningCopy);
}

function nextActionsFor(input: RelayDocumentSearchLocalDraftInput): string[] {
  if (input.quality.answerPolicy === 'evidence_confirmed') {
    return ['根拠カードをプレビューで確認する', '必要ならこの根拠を使って回答文を整える'];
  }
  if (input.evidencePack.candidate_files.length > 0) {
    return ['候補ファイルを開いて中身を確認する', '検索語を広げるか、対象フォルダを変えて再検索する'];
  }
  return ['検索語を広げる', '別のフォルダを選ぶ', '拡張子フィルターを外す'];
}

export function buildRelayDocumentSearchLocalDraft(
  input: RelayDocumentSearchLocalDraftInput,
): RelayDocumentSearchLocalDraftV1 {
  const generatedAt = input.generatedAt ?? input.evidencePack.generated_at;
  const citations = buildCitations(input.evidencePack);
  const caveats = caveatsFor(input);
  const nextActions = nextActionsFor(input);
  const sections = [
    confirmedEvidenceSection(input.evidencePack, citations),
    candidateSection(input.evidencePack),
    caveats.length
      ? {
          kind: 'caveats' as const,
          title: '確認が必要な点',
          items: caveats.map((text) => ({ text })),
        }
      : undefined,
    {
      kind: 'next_steps' as const,
      title: '次の操作',
      items: nextActions.map((text) => ({ text })),
    },
  ].filter((section): section is RelayDocumentSearchLocalDraftSection => Boolean(section));
  const warningCodes = uniqueWarnings(input);

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_LOCAL_DRAFT_CONTRACT,
    local_draft_id: `local-draft-${stableHash(`${input.evidencePack.evidence_pack_id}:${generatedAt}`)}`,
    evidence_pack_id: input.evidencePack.evidence_pack_id,
    job_id: input.evidencePack.job_id,
    query_id: input.evidencePack.query_id,
    generated_at: generatedAt,
    query: input.evidencePack.query,
    answer_policy: input.quality.answerPolicy,
    citation_policy: citations.length ? 'evidence_pack_ids_required' : 'candidate_language_only',
    can_replace_with_copilot_polish: input.quality.canAskCopilotForFinalAnswer,
    summary: summaryFor(input),
    sections,
    citations,
    caveats,
    next_actions: nextActions,
    validation: {
      groundedInEvidencePack: true,
      unsupportedClaims: [],
      evidenceItemCount: input.evidencePack.evidence.length,
      candidateFileCount: input.evidencePack.candidate_files.length,
      warningCodes,
    },
    ai_boundary: {
      localFirst: true,
      copilotMayOnlyPolish: true,
      copilotPolishRequiresCitationValidation: true,
      originalFilesIncluded: false,
    },
  };
}

export function validateRelayDocumentSearchLocalDraft(input: unknown): RelayDocumentSearchLocalDraftValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['local draft must be an object'] };
  if (input.schemaVersion !== RELAY_DOCUMENT_SEARCH_LOCAL_DRAFT_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_LOCAL_DRAFT_CONTRACT}`);
  }
  for (const field of ['local_draft_id', 'evidence_pack_id', 'job_id', 'generated_at', 'summary']) {
    if (typeof input[field] !== 'string' || !String(input[field]).trim()) errors.push(`${field} is required`);
  }
  if (!['evidence_confirmed', 'candidate_only', 'partial_or_incomplete'].includes(asString(input.answer_policy))) {
    errors.push('answer_policy is invalid');
  }
  if (!Array.isArray(input.sections)) errors.push('sections must be an array');
  if (!Array.isArray(input.citations)) errors.push('citations must be an array');
  if (!Array.isArray(input.caveats)) errors.push('caveats must be an array');
  if (!Array.isArray(input.next_actions)) errors.push('next_actions must be an array');
  if (!isRecord(input.validation)) {
    errors.push('validation is required');
  } else if (input.validation.groundedInEvidencePack !== true) {
    errors.push('validation.groundedInEvidencePack must be true');
  }
  if (!isRecord(input.ai_boundary)) {
    errors.push('ai_boundary is required');
  } else {
    if (input.ai_boundary.originalFilesIncluded !== false) errors.push('ai_boundary.originalFilesIncluded must be false');
    if (input.ai_boundary.copilotMayOnlyPolish !== true) errors.push('ai_boundary.copilotMayOnlyPolish must be true');
    if (input.ai_boundary.copilotPolishRequiresCitationValidation !== true) {
      errors.push('ai_boundary.copilotPolishRequiresCitationValidation must be true');
    }
  }
  if (input.can_replace_with_copilot_polish === true && asArray(input.citations).length === 0) {
    errors.push('copilot polish replacement requires evidence citations');
  }
  return { ok: errors.length === 0, errors };
}
