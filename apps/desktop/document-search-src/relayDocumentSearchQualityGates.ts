export const RELAY_DOCUMENT_SEARCH_QUALITY_CONTRACT = 'RelayDocumentSearchQuality.v1';

export type RelayDocumentSearchConfidence = 'high' | 'medium' | 'low';
export type RelayDocumentSearchAnswerPolicy = 'evidence_confirmed' | 'candidate_only' | 'partial_or_incomplete';

export type RelayDocumentSearchGoldenQueryGateSummary = {
  enabled: boolean;
  passed: boolean;
  caseCount: number;
  failedCaseCount: number;
  topKCoverage?: number;
};

export type RelayDocumentSearchQualityWarning = {
  code:
    | 'candidate_only'
    | 'content_unconfirmed'
    | 'coverage_incomplete'
    | 'index_writer_busy'
    | 'cache_policy_blocks_persistence'
    | 'no_results'
    | 'golden_query_regression';
  severity: 'info' | 'warning' | 'blocker';
  message: string;
};

export type RelayDocumentSearchQualityInput = {
  resultCount: number;
  contentEvidenceCount: number;
  contentRequired: boolean;
  contentRequiredButUnconfirmed: boolean;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  inaccessiblePathCount: number;
  indexCoordinatorBusy: boolean;
  parsedDocumentCachePolicyDenied: boolean;
  goldenQueryGate?: RelayDocumentSearchGoldenQueryGateSummary;
};

export type RelayDocumentSearchQualityReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_QUALITY_CONTRACT;
  coverageConfidence: RelayDocumentSearchConfidence;
  evidenceConfidence: RelayDocumentSearchConfidence;
  freshnessConfidence: RelayDocumentSearchConfidence;
  answerPolicy: RelayDocumentSearchAnswerPolicy;
  canAskCopilotForFinalAnswer: boolean;
  warnings: RelayDocumentSearchQualityWarning[];
  goldenQueryGate?: RelayDocumentSearchGoldenQueryGateSummary;
};

export function buildRelayDocumentSearchQualityReport(
  input: RelayDocumentSearchQualityInput,
): RelayDocumentSearchQualityReport {
  const warnings: RelayDocumentSearchQualityWarning[] = [];
  const coverageConfidence: RelayDocumentSearchConfidence = (() => {
    if (input.cancelled || input.timedOut || input.truncated) return 'low';
    if (input.inaccessiblePathCount > 0) return 'medium';
    return 'high';
  })();
  const evidenceConfidence: RelayDocumentSearchConfidence = (() => {
    if (input.contentEvidenceCount > 0 && !input.contentRequiredButUnconfirmed) return 'high';
    if (input.resultCount > 0 && !input.contentRequired) return 'medium';
    return 'low';
  })();
  const freshnessConfidence: RelayDocumentSearchConfidence = input.indexCoordinatorBusy ? 'medium' : 'high';

  if (input.resultCount === 0) {
    warnings.push({
      code: 'no_results',
      severity: 'info',
      message: 'No matching local files were found in the searched scope.',
    });
  }
  if (input.resultCount > 0 && input.contentEvidenceCount === 0) {
    warnings.push({
      code: 'candidate_only',
      severity: input.contentRequired ? 'blocker' : 'warning',
      message: 'Results are filename/path candidates and are not confirmed content evidence.',
    });
  }
  if (input.contentRequiredButUnconfirmed) {
    warnings.push({
      code: 'content_unconfirmed',
      severity: 'blocker',
      message: 'The request requires content evidence, but some candidates were not content-confirmed.',
    });
  }
  if (coverageConfidence !== 'high') {
    warnings.push({
      code: 'coverage_incomplete',
      severity: coverageConfidence === 'low' ? 'blocker' : 'warning',
      message: 'The searched coverage is incomplete, so final claims must be downgraded.',
    });
  }
  if (input.indexCoordinatorBusy) {
    warnings.push({
      code: 'index_writer_busy',
      severity: 'warning',
      message: 'Another Relay search writer is active; current freshness may change after it finishes.',
    });
  }
  if (input.parsedDocumentCachePolicyDenied) {
    warnings.push({
      code: 'cache_policy_blocks_persistence',
      severity: 'info',
      message: 'Parsed document content was not persisted because cache protection policy blocked it.',
    });
  }
  if (input.goldenQueryGate?.enabled && !input.goldenQueryGate.passed) {
    warnings.push({
      code: 'golden_query_regression',
      severity: 'blocker',
      message: 'The golden-query regression gate failed, so ranking or analyzer changes must not be promoted.',
    });
  }

  const answerPolicy: RelayDocumentSearchAnswerPolicy = (() => {
    if (input.goldenQueryGate?.enabled && !input.goldenQueryGate.passed) return 'partial_or_incomplete';
    if (coverageConfidence !== 'high' || input.contentRequiredButUnconfirmed) return 'partial_or_incomplete';
    if (input.contentEvidenceCount > 0) return 'evidence_confirmed';
    return 'candidate_only';
  })();

  const report: RelayDocumentSearchQualityReport = {
    schemaVersion: RELAY_DOCUMENT_SEARCH_QUALITY_CONTRACT,
    coverageConfidence,
    evidenceConfidence,
    freshnessConfidence,
    answerPolicy,
    canAskCopilotForFinalAnswer: answerPolicy === 'evidence_confirmed',
    warnings,
  };
  if (input.goldenQueryGate) report.goldenQueryGate = input.goldenQueryGate;
  return report;
}
