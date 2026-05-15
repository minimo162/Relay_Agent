import type {
  RelayDocumentSearchPolishCorrelation,
  RelayDocumentSearchPolishValidationReport,
} from './relayDocumentSearchPolishValidation';

export const RELAY_DOCUMENT_SEARCH_COPILOT_STATE_CONTRACT = 'RelayDocumentSearchCopilotState.v1' as const;

export type RelayDocumentSearchCopilotState =
  | 'copilot_ready'
  | 'copilot_warming'
  | 'copilot_sign_in_required'
  | 'copilot_disconnected'
  | 'copilot_capture_unhealthy'
  | 'copilot_timeout'
  | 'copilot_rate_limited'
  | 'copilot_tenant_restricted'
  | 'copilot_policy_disabled'
  | 'polish_skipped'
  | 'polish_rejected'
  | 'polish_accepted';

export type RelayDocumentSearchCopilotStatePhase =
  | 'ready_for_optional_polish'
  | 'copilot_unavailable'
  | 'polish_terminal'
  | 'polish_not_applicable';

export type RelayDocumentSearchCopilotStateReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_COPILOT_STATE_CONTRACT;
  state: RelayDocumentSearchCopilotState;
  phase: RelayDocumentSearchCopilotStatePhase;
  generated_at: string;
  beginner_label: string;
  support_code: RelayDocumentSearchCopilotState;
  message?: string;
  polish_validation_state: RelayDocumentSearchPolishValidationReport['state'];
  correlation: RelayDocumentSearchPolishCorrelation;
  visible_to_user: true;
  local_search_blocked: false;
  local_draft_blocked: false;
  preview_open_blocked: false;
  should_wait_for_copilot: false;
  optional_polish_retry_available: boolean;
  warnings: Array<{ code: string; message: string }>;
  ai_boundary: {
    localResultsAuthoritative: true;
    copilotOptional: true;
    originalFilesIncluded: false;
    canOnlyPolishValidatedDraft: true;
  };
};

export type RelayDocumentSearchCopilotStateInput = {
  generatedAt?: string;
  requestedState?: RelayDocumentSearchCopilotState;
  message?: string;
  polishValidation: RelayDocumentSearchPolishValidationReport;
  correlation?: Partial<RelayDocumentSearchPolishCorrelation>;
};

function stateFromPolishValidation(
  polishValidation: RelayDocumentSearchPolishValidationReport,
): RelayDocumentSearchCopilotState {
  if (polishValidation.state === 'polish_accepted') return 'polish_accepted';
  if (polishValidation.state === 'polish_rejected' || polishValidation.state === 'polish_repair_required') {
    return 'polish_rejected';
  }
  if (polishValidation.state === 'polish_skipped') return 'polish_skipped';
  return 'copilot_ready';
}

function phaseForState(state: RelayDocumentSearchCopilotState): RelayDocumentSearchCopilotStatePhase {
  if (state === 'copilot_ready') return 'ready_for_optional_polish';
  if (state === 'polish_skipped') return 'polish_not_applicable';
  if (state === 'polish_accepted' || state === 'polish_rejected') return 'polish_terminal';
  return 'copilot_unavailable';
}

function beginnerLabelForState(state: RelayDocumentSearchCopilotState): string {
  switch (state) {
    case 'copilot_ready':
      return 'AI文章チェックは利用できます';
    case 'copilot_warming':
      return 'AI文章チェックを準備中です';
    case 'copilot_sign_in_required':
      return 'AI文章チェックにはサインインが必要です';
    case 'copilot_disconnected':
      return 'AI文章チェックに接続できません';
    case 'copilot_capture_unhealthy':
      return 'AI文章チェックの画面取得を確認できません';
    case 'copilot_timeout':
      return 'AI文章チェックが時間内に完了しませんでした';
    case 'copilot_rate_limited':
      return 'AI文章チェックは一時的に混み合っています';
    case 'copilot_tenant_restricted':
      return 'AI文章チェックは組織ポリシーで制限されています';
    case 'copilot_policy_disabled':
      return 'AI文章チェックは設定で無効です';
    case 'polish_skipped':
      return 'AI文章チェックは省略されました';
    case 'polish_rejected':
      return 'AI文章チェック結果は採用されませんでした';
    case 'polish_accepted':
      return 'AI文章チェック結果を採用しました';
  }
}

function retryAvailableForState(state: RelayDocumentSearchCopilotState): boolean {
  return !new Set<RelayDocumentSearchCopilotState>([
    'copilot_policy_disabled',
    'copilot_tenant_restricted',
    'polish_accepted',
    'polish_skipped',
  ]).has(state);
}

export function buildRelayDocumentSearchCopilotStateReport(
  input: RelayDocumentSearchCopilotStateInput,
): RelayDocumentSearchCopilotStateReport {
  const state = input.requestedState ?? stateFromPolishValidation(input.polishValidation);
  const correlation: RelayDocumentSearchPolishCorrelation = {
    ...input.polishValidation.correlation,
    ...input.correlation,
    evidencePackId: input.polishValidation.evidence_pack_id,
    localDraftId: input.polishValidation.local_draft_id,
    polishedAnswerId: input.polishValidation.polished_answer_id ?? input.polishValidation.correlation.polishedAnswerId,
  };
  const warnings: RelayDocumentSearchCopilotStateReport['warnings'] = [];
  if (state.startsWith('copilot_') && state !== 'copilot_ready') {
    warnings.push({
      code: state,
      message: 'Copilot optional polish state does not block local search results.',
    });
  }
  if (input.polishValidation.state === 'polish_repair_required') {
    warnings.push({
      code: 'polish_repair_required',
      message: 'Copilot polish needs one strict repair before it can be displayed.',
    });
  }

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_COPILOT_STATE_CONTRACT,
    state,
    phase: phaseForState(state),
    generated_at: input.generatedAt ?? input.polishValidation.generated_at,
    beginner_label: beginnerLabelForState(state),
    support_code: state,
    message: input.message,
    polish_validation_state: input.polishValidation.state,
    correlation,
    visible_to_user: true,
    local_search_blocked: false,
    local_draft_blocked: false,
    preview_open_blocked: false,
    should_wait_for_copilot: false,
    optional_polish_retry_available: retryAvailableForState(state),
    warnings,
    ai_boundary: {
      localResultsAuthoritative: true,
      copilotOptional: true,
      originalFilesIncluded: false,
      canOnlyPolishValidatedDraft: true,
    },
  };
}
