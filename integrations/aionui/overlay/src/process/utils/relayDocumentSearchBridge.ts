/**
 * AionUi-facing bridge for Relay Document Search.
 *
 * The bridge is deliberately small: it validates the model/tool-call boundary,
 * enforces Relay's alias policy, invokes the deterministic executor, and emits
 * a structured tool result that AionUi can render in its existing conversation
 * and preview surfaces.
 */

import {
  RELAY_DOCUMENT_SEARCH_JOB_CONTRACT,
  RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT,
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  RELAY_DOCUMENT_SEARCH_TOOL_NAME,
  acceptsRelayDocumentSearchAlias,
  relayDocumentSearchOpenAiToolSchema,
  validateRelayDocumentSearchResult,
  type RelayDocumentSearchResultV1,
} from './relayDocumentSearchContract';
import { emptyRelayDocumentSearchEvidencePack } from './relayDocumentSearchEvidencePack';
import {
  RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
  RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT,
  relayDocumentSearchResultToDisplayModel,
  type RelayDocumentSearchDisplayV1,
} from './relayDocumentSearchDisplay';
import {
  RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT,
  runRelayDocumentSearchJob,
  type RelayDocumentSearchJobRunOptions,
} from './relayDocumentSearchJobLifecycle';

export const RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT =
  'RelayDocumentSearchAionUiResultFlow.v1' as const;
export const RELAY_DOCUMENT_SEARCH_RESULT_SUMMARY_CONTRACT =
  'RelayDocumentSearchResultSummary.v1' as const;

export type RelayDocumentSearchBridgeOptions = RelayDocumentSearchJobRunOptions & {
  advertisedTools?: unknown[];
  source?: 'openai-tool-call' | 'aionui-skill' | 'relay-provider';
  displayMaxCards?: number;
  displayOffset?: number;
  selectedStableSelectionKey?: string;
};

export type RelayDocumentSearchAionUiResultFlowV1 = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT;
  toolName: typeof RELAY_DOCUMENT_SEARCH_TOOL_NAME;
  toolCallId?: string;
  resultContract: typeof RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT;
  resultSummaryContract: typeof RELAY_DOCUMENT_SEARCH_RESULT_SUMMARY_CONTRACT;
  displayContract: typeof RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT;
  resultFlowContract: typeof RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT;
  presentation: {
    rendererOwner: 'AionUi';
    structuredResultCardsPrimary: true;
    copilotProseSecondary: true;
    rawResultOmitted: true;
  };
  resultSummary: Record<string, unknown>;
  display: Record<string, unknown>;
};

export type RelayDocumentSearchBridgeExecution = {
  ok: boolean;
  handled: true;
  toolName: typeof RELAY_DOCUMENT_SEARCH_TOOL_NAME;
  toolCallId?: string;
  result: RelayDocumentSearchResultV1;
  display: RelayDocumentSearchDisplayV1;
  aionuiResultFlow: RelayDocumentSearchAionUiResultFlowV1;
  content: string;
  aionuiContent: string;
};

type NormalizedToolCall =
  | {
      ok: true;
      toolCallId?: string;
      toolName: string;
      arguments: unknown;
    }
  | {
      ok: false;
      toolCallId?: string;
      toolName?: string;
      reason: string;
      code: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('functions.')) return trimmed.slice('functions.'.length);
  return trimmed;
}

function toolCallIdFrom(rawToolCall: unknown): string | undefined {
  if (!isRecord(rawToolCall)) return undefined;
  for (const field of ['id', 'tool_call_id', 'toolCallId']) {
    const value = rawToolCall[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function toolNameFrom(rawToolCall: unknown): string | undefined {
  if (!isRecord(rawToolCall)) return undefined;
  const directName = normalizeToolName(rawToolCall.name ?? rawToolCall.recipient_name);
  if (directName) return directName;
  if (isRecord(rawToolCall.function)) {
    const functionName = normalizeToolName(rawToolCall.function.name);
    if (functionName) return functionName;
  }
  return undefined;
}

function toolArgumentsFrom(rawToolCall: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!isRecord(rawToolCall)) {
    return { ok: false, reason: 'tool call must be an object' };
  }

  const candidates = [
    isRecord(rawToolCall.function) ? rawToolCall.function.arguments : undefined,
    rawToolCall.arguments,
    rawToolCall.parameters,
  ];
  const candidate = candidates.find((value) => value !== undefined);
  if (candidate === undefined) {
    return { ok: false, reason: 'tool call arguments are required' };
  }
  if (typeof candidate === 'string') {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      return { ok: false, reason: 'tool call arguments must be valid JSON' };
    }
  }
  return { ok: true, value: candidate };
}

function advertisedToolForName(toolName: string, advertisedTools: unknown[]): unknown | undefined {
  return advertisedTools.find((tool) => {
    if (!isRecord(tool)) return false;
    return toolNameFrom(tool) === toolName;
  });
}

function acceptsToolCallName(rawToolCall: unknown, toolName: string, advertisedTools: unknown[]): boolean {
  if (acceptsRelayDocumentSearchAlias({ name: toolName })) return true;
  if (isRecord(rawToolCall) && acceptsRelayDocumentSearchAlias(rawToolCall)) return true;
  const advertisedTool = advertisedToolForName(toolName, advertisedTools);
  return acceptsRelayDocumentSearchAlias(advertisedTool);
}

export const relayDocumentSearchBridgeToolDefinition = {
  ...relayDocumentSearchOpenAiToolSchema,
  requestContract: RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT,
  resultContract: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  displayContract: RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
  resultFlowContract: RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT,
  aionuiResultFlowContract: RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT,
  jobContract: RELAY_DOCUMENT_SEARCH_JOB_CONTRACT,
  jobLifecycleContract: RELAY_DOCUMENT_SEARCH_JOB_LIFECYCLE_CONTRACT,
  backgroundSchedulerContract: 'RelayDocumentSearchBackgroundScheduler.v1',
  syncProducerContract: 'RelayDocumentSearchSyncProducer.v1',
  bridgeModule: 'src/process/utils/relayDocumentSearchBridge.ts',
  displayModule: 'src/process/utils/relayDocumentSearchDisplay.ts',
  jobLifecycleModule: 'src/process/utils/relayDocumentSearchJobLifecycle.ts',
  backgroundSchedulerModule: 'src/process/utils/relayDocumentSearchBackgroundScheduler.ts',
  syncProducerModule: 'src/process/utils/relayDocumentSearchSyncProducer.ts',
  executorExport: 'executeRelayDocumentSearch',
  jobLifecycleRunnerExport: 'runRelayDocumentSearchJob',
  backgroundSchedulerClassExport: 'RelayDocumentSearchBackgroundScheduler',
  syncProducerStartExport: 'startRelayDocumentSearchSyncProducer',
  handlerExport: 'handleRelayDocumentSearchToolCall',
  displayAdapterExport: 'relayDocumentSearchResultToDisplayModel',
  aionuiResultFlowExport: 'relayDocumentSearchExecutionToAionUiResultFlow',
  resultSummaryContract: RELAY_DOCUMENT_SEARCH_RESULT_SUMMARY_CONTRACT,
  resultFlowPolicy: {
    rendererOwner: 'AionUi',
    structuredResultCardsPrimary: true,
    copilotProseSecondary: true,
    continuationAction: 'show-more-results',
    stableSelectionKeyField: 'ui_state.stableSelectionKey',
  },
} as const;

export function normalizeRelayDocumentSearchToolCall(
  rawToolCall: unknown,
  options: RelayDocumentSearchBridgeOptions = {},
): NormalizedToolCall {
  const toolCallId = toolCallIdFrom(rawToolCall);
  const toolName = toolNameFrom(rawToolCall);
  if (!toolName) {
    return {
      ok: false,
      toolCallId,
      code: 'missing_tool_name',
      reason: 'Relay document search tool call is missing a tool name.',
    };
  }
  if (!acceptsToolCallName(rawToolCall, toolName, options.advertisedTools ?? [])) {
    return {
      ok: false,
      toolCallId,
      toolName,
      code: 'untrusted_tool_alias',
      reason:
        `Tool alias ${toolName} is not accepted for Relay document search. ` +
        'Aliases require Relay request/result contract metadata.',
    };
  }

  const parsedArguments = toolArgumentsFrom(rawToolCall);
  if (!parsedArguments.ok) {
    return {
      ok: false,
      toolCallId,
      toolName,
      code: 'invalid_tool_arguments',
      reason: parsedArguments.reason,
    };
  }

  return {
    ok: true,
    toolCallId,
    toolName,
    arguments: parsedArguments.value,
  };
}

function bridgeErrorResult(
  code: string,
  message: string,
  options: RelayDocumentSearchBridgeOptions,
  rawToolName?: string,
): RelayDocumentSearchResultV1 {
  const jobId = options.jobId ?? `job-${Date.now().toString(36)}`;
  const now = (options.now ?? new Date()).toISOString();
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    status: 'failed',
    progress: { stage: 'bridge_rejected', percent: 100, scannedFiles: 0, skippedFiles: 0 },
    job: { jobId, lifecycle: 'failed', cancellable: false },
    correlation: {
      relayJobId: jobId,
      queryId: options.queryId,
      aionuiConversationId: options.aionuiConversationId,
      aionuiMessageId: options.aionuiMessageId,
    },
    queryPlan: {},
    coverage: { searchedRoots: [], incompleteRoots: [], generatedAt: now },
    results: [],
    evidencePack: emptyRelayDocumentSearchEvidencePack({
      jobId,
      queryId: options.queryId,
      generatedAt: now,
      warnings: [{ code, message }],
    }),
    display: {
      beginnerSummary: '検索ツールの呼び出しを実行できませんでした。',
      emptyStateGuidance: ['時間をおいてもう一度試すか、検索するフォルダと検索語を確認してください。'],
    },
    diagnostics: {
      bridge: 'relay-document-search-bridge',
      code,
      message,
      rawToolName,
      source: options.source,
    },
  };
}

function executionFromResult(
  result: RelayDocumentSearchResultV1,
  toolCallId: string | undefined,
  options: RelayDocumentSearchBridgeOptions,
): RelayDocumentSearchBridgeExecution {
  const display = relayDocumentSearchResultToDisplayModel(result, {
    maxCards: options.displayMaxCards,
    offset: options.displayOffset,
    selectedStableSelectionKey: options.selectedStableSelectionKey,
  });
  const aionuiResultFlow = relayDocumentSearchExecutionToAionUiResultFlow({
    toolCallId,
    result,
    display,
  });
  return {
    ok: result.status !== 'failed',
    handled: true,
    toolName: RELAY_DOCUMENT_SEARCH_TOOL_NAME,
    toolCallId,
    result,
    display,
    aionuiResultFlow,
    content: JSON.stringify(result),
    aionuiContent: JSON.stringify(aionuiResultFlow),
  };
}

export function relayDocumentSearchExecutionToAionUiResultFlow(
  input: {
    toolCallId?: string;
    result: RelayDocumentSearchResultV1;
    display: RelayDocumentSearchDisplayV1;
  },
): RelayDocumentSearchAionUiResultFlowV1 {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT,
    toolName: RELAY_DOCUMENT_SEARCH_TOOL_NAME,
    toolCallId: input.toolCallId,
    resultContract: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
    resultSummaryContract: RELAY_DOCUMENT_SEARCH_RESULT_SUMMARY_CONTRACT,
    displayContract: RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
    resultFlowContract: RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT,
    presentation: {
      rendererOwner: 'AionUi',
      structuredResultCardsPrimary: true,
      copilotProseSecondary: true,
      rawResultOmitted: true,
    },
    resultSummary: compactResultSummaryForToolOutput(input.result),
    display: compactDisplayForToolOutput(input.display),
  };
}

function compactStringArray(values: unknown, limit = 12): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, limit);
}

function compactCardsForToolOutput(cards: RelayDocumentSearchDisplayV1['cards']): Array<Record<string, unknown>> {
  return cards.map((card) => ({
    resultId: card.resultId,
    position: card.position,
    selected: card.selected,
    title: card.title,
    path: card.path,
    matchLabel: card.matchLabel,
    evidenceLabel: card.evidenceLabel,
    sourceLabels: card.sourceLabels,
    rankingLabel: card.rankingLabel,
    previewLabel: card.previewLabel,
    openLabel: card.openLabel,
    warningLabels: card.warningLabels,
    folderRoleLabel: card.folderRoleLabel,
    candidateBucketLabel: card.candidateBucketLabel,
    groupLabel: card.groupLabel,
    collapsedGroupCount: card.collapsedGroupCount,
    actions: card.actions.filter((action) =>
      ['preview', 'open-file', 'copy-path', 'refine-search', 'use-as-evidence'].includes(action),
    ),
  }));
}

function compactDetailSectionsForToolOutput(
  sections: RelayDocumentSearchDisplayV1['detailSections'],
): Array<Record<string, unknown>> {
  const allowedTitles = new Set([
    '回答',
    '回答下書き',
    '検索モード',
    '検索配分',
    '候補の分類',
    '版違い・類似候補',
    '確認が必要な点',
    '索引状態',
  ]);
  return sections
    .filter((section) => !section.supportOnly && allowedTitles.has(section.title))
    .slice(0, 6)
    .map((section) => ({
      level: section.level,
      title: section.title,
      items: section.items.slice(0, 8).map((item) => item.length > 280 ? `${item.slice(0, 277)}...` : item),
      initiallyCollapsed: section.initiallyCollapsed,
    }));
}

function compactDisplayForToolOutput(display: RelayDocumentSearchDisplayV1): Record<string, unknown> {
  return {
    schemaVersion: display.schemaVersion,
    sourceSchemaVersion: display.sourceSchemaVersion,
    resultFlow: display.resultFlow,
    status: display.status,
    statusLabel: display.statusLabel,
    summary: display.summary,
    answerSummary: display.answerSummary,
    answerSourceLabel: display.answerSourceLabel,
    localDraftSummary: display.localDraftSummary,
    indexStatus: {
      state: display.indexStatus.state,
      label: display.indexStatus.label,
      activePathLabel: display.indexStatus.activePathLabel,
      message: display.indexStatus.message,
      reasons: display.indexStatus.reasons,
    },
    partialResultExplanations: display.partialResultExplanations,
    cards: compactCardsForToolOutput(display.cards),
    hasMore: display.hasMore,
    coverageLabel: display.coverageLabel,
    emptyStateGuidance: display.emptyStateGuidance,
    refineActions: display.refineActions,
    totalResults: display.totalResults,
    shownResults: display.shownResults,
    nextOffset: display.nextOffset,
    continuationAction: display.continuationAction,
    detailSections: compactDetailSectionsForToolOutput(display.detailSections),
    supportDetailsAvailable: display.supportDetailsAvailable,
  };
}

function compactResultSummaryForToolOutput(result: RelayDocumentSearchResultV1): Record<string, unknown> {
  const queryPlan = result.queryPlan && typeof result.queryPlan === 'object' && !Array.isArray(result.queryPlan)
    ? result.queryPlan as Record<string, unknown>
    : {};
  const diagnostics = result.diagnostics && typeof result.diagnostics === 'object' && !Array.isArray(result.diagnostics)
    ? result.diagnostics as Record<string, unknown>
    : {};
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_RESULT_SUMMARY_CONTRACT,
    sourceSchemaVersion: result.schemaVersion,
    status: result.status,
    progress: result.progress,
    job: result.job,
    correlation: result.correlation,
    queryPlan: {
      mode: queryPlan.mode,
      searchModeReason: queryPlan.searchModeReason,
      contentStrategy: queryPlan.contentStrategy,
      query: queryPlan.query,
      roots: queryPlan.roots,
      normalizedTerms: compactStringArray(queryPlan.normalizedTerms, 20),
      copilotHintSummary: queryPlan.copilotHintSummary,
      fileTypes: queryPlan.fileTypes,
      fileTypeHints: queryPlan.fileTypeHints,
      demoteTerms: compactStringArray(queryPlan.demoteTerms, 12),
      evidence: queryPlan.evidence,
      confirmationPolicy: queryPlan.confirmationPolicy,
    },
    coverage: result.coverage,
    candidateBuckets: diagnostics.candidateBuckets,
    totalResults: result.results.length,
    returnedDisplayResults: Math.min(result.results.length, 20),
    resultFieldsOmitted: [
      'readerCapabilities',
      'score_breakdown',
      'file_metadata',
      'action_models',
      'diagnostics.queryTrace',
      'evidencePack',
    ],
  };
}

export async function handleRelayDocumentSearchToolCall(
  rawToolCall: unknown,
  options: RelayDocumentSearchBridgeOptions = {},
): Promise<RelayDocumentSearchBridgeExecution> {
  const normalized = normalizeRelayDocumentSearchToolCall(rawToolCall, options);
  if (!normalized.ok) {
    return executionFromResult(
      bridgeErrorResult(normalized.code, normalized.reason, options, normalized.toolName),
      normalized.toolCallId,
      options,
    );
  }

  const result = await runRelayDocumentSearchJob(normalized.arguments, options);
  const validated = validateRelayDocumentSearchResult(result);
  if (!validated.ok) {
    return executionFromResult(
      bridgeErrorResult(
        'invalid_executor_result',
        `Relay document search executor returned an invalid result: ${validated.errors.join('; ')}`,
        options,
        normalized.toolName,
      ),
      normalized.toolCallId,
      options,
    );
  }
  return executionFromResult(validated.value, normalized.toolCallId, options);
}

export function relayDocumentSearchExecutionToOpenAiToolMessage(execution: RelayDocumentSearchBridgeExecution) {
  return {
    role: 'tool',
    tool_call_id: execution.toolCallId,
    name: execution.toolName,
    content: execution.content,
  };
}
