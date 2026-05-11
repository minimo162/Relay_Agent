import type { RelayDocumentSearchQualityReport } from './relayDocumentSearchQualityGates';

export const RELAY_DOCUMENT_SEARCH_EVIDENCE_REDACTION_CONTRACT = 'RelayDocumentSearchEvidenceRedaction.v1';

export type RelayDocumentSearchEvidenceRedactionPolicy = 'local_only' | 'metadata_only' | 'snippets_allowed';

export type RelayDocumentSearchRedactedEvidence = {
  file_id?: unknown;
  display_path?: unknown;
  evidence_state?: unknown;
  parsed_document_uid?: unknown;
  anchor?: Record<string, unknown>;
};

export type RelayDocumentSearchEvidenceRedactionReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_EVIDENCE_REDACTION_CONTRACT;
  policy: RelayDocumentSearchEvidenceRedactionPolicy;
  canSendToCopilot: boolean;
  sourceEvidenceCount: number;
  redactedEvidenceCount: number;
  omittedEvidenceCount: number;
  redactedEvidence: RelayDocumentSearchRedactedEvidence[];
  warnings: Array<{ code: string; message: string }>;
};

const REDACTION_POLICY_ENV = 'RELAY_DOCUMENT_SEARCH_EVIDENCE_REDACTION_POLICY';

export function relayDocumentSearchEvidenceRedactionPolicyFromEnv(): RelayDocumentSearchEvidenceRedactionPolicy {
  const policy = process.env[REDACTION_POLICY_ENV];
  if (policy === 'metadata_only' || policy === 'snippets_allowed' || policy === 'local_only') return policy;
  return 'local_only';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedSnippet(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function redactedAnchor(anchor: unknown, includeSnippet: boolean): Record<string, unknown> {
  const record = asRecord(anchor);
  const allowed: Record<string, unknown> = {
    type: record.type,
    node_id: record.node_id,
    table_id: record.table_id,
    cell_id: record.cell_id,
    sheet_name: record.sheet_name,
    cell_address: record.cell_address,
    row: record.row,
    column: record.column,
    matchedTerms: record.matchedTerms,
    parser_name: record.parser_name,
    parser_profile: record.parser_profile,
    anchor_confidence: record.anchor_confidence,
  };
  if (includeSnippet) allowed.snippet = boundedSnippet(record.snippet);
  return Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
}

function redactedEvidenceItem(
  item: unknown,
  policy: RelayDocumentSearchEvidenceRedactionPolicy,
): RelayDocumentSearchRedactedEvidence {
  const record = asRecord(item);
  return {
    file_id: record.file_id,
    display_path: record.display_path,
    evidence_state: record.evidence_state,
    parsed_document_uid: record.parsed_document_uid,
    anchor: redactedAnchor(record.anchor, policy === 'snippets_allowed'),
  };
}

export function buildRelayDocumentSearchEvidenceRedactionReport(input: {
  evidence: unknown[];
  quality: RelayDocumentSearchQualityReport;
  policy?: RelayDocumentSearchEvidenceRedactionPolicy;
}): RelayDocumentSearchEvidenceRedactionReport {
  const policy = input.policy ?? relayDocumentSearchEvidenceRedactionPolicyFromEnv();
  const sourceEvidenceCount = input.evidence.length;
  const warnings: RelayDocumentSearchEvidenceRedactionReport['warnings'] = [];

  if (policy === 'local_only') {
    warnings.push({
      code: 'local_only_policy',
      message: 'Evidence snippets stay local and are not prepared for Copilot polish.',
    });
  }
  if (!input.quality.canAskCopilotForFinalAnswer) {
    warnings.push({
      code: 'quality_gate_blocks_copilot',
      message: 'Evidence quality is not sufficient for final Copilot wording.',
    });
  }

  const redactedEvidence = policy === 'local_only'
    ? []
    : input.evidence.map((item) => redactedEvidenceItem(item, policy));
  const canSendToCopilot = policy === 'snippets_allowed' &&
    input.quality.canAskCopilotForFinalAnswer &&
    redactedEvidence.length > 0;

  if (policy === 'metadata_only') {
    warnings.push({
      code: 'snippets_redacted',
      message: 'Only metadata is available after redaction; Copilot polish is disabled.',
    });
  }

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_EVIDENCE_REDACTION_CONTRACT,
    policy,
    canSendToCopilot,
    sourceEvidenceCount,
    redactedEvidenceCount: redactedEvidence.length,
    omittedEvidenceCount: sourceEvidenceCount - redactedEvidence.length,
    redactedEvidence,
    warnings,
  };
}
