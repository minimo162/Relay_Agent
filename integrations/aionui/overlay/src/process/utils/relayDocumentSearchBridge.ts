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
  displayContract: typeof RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT;
  resultFlowContract: typeof RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT;
  presentation: {
    rendererOwner: 'AionUi';
    structuredResultCardsPrimary: true;
    copilotProseSecondary: true;
  };
  result: RelayDocumentSearchResultV1;
  display: RelayDocumentSearchDisplayV1;
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
    displayContract: RELAY_DOCUMENT_SEARCH_DISPLAY_CONTRACT,
    resultFlowContract: RELAY_DOCUMENT_SEARCH_RESULT_FLOW_CONTRACT,
    presentation: {
      rendererOwner: 'AionUi',
      structuredResultCardsPrimary: true,
      copilotProseSecondary: true,
    },
    result: input.result,
    display: input.display,
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
