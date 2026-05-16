import {
  EventType,
  HttpAgent,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from "@ag-ui/client";
import type { ApprovalState, RunEvent } from "../types";

export type RelayAgUiEvent = Omit<BaseEvent, "type" | "timestamp"> & {
  type: string;
  message?: string;
  detail?: string;
  data?: unknown;
  state?: {
    approval?: ApprovalState | null;
  };
  runId?: string;
  sequence?: number;
  timestamp?: string | number;
  messageId?: string;
  parentMessageId?: string;
  role?: string;
  delta?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: string;
  code?: string;
  stepName?: string;
};

export type RelayAgUiToolCallDraft = {
  id: string;
  name: string;
  args: string;
  parentMessageId?: string;
};

export function createRelayAgUiAgent(url: string, headers: Record<string, string>): HttpAgent {
  return new HttpAgent({
    url,
    headers,
    agentId: "relay-workbench",
    description: "Relay Workbench official AG-UI transport",
    threadId: "relay-workbench",
  });
}

export function buildRunAgentInput({
  runId,
  threadId,
  workspace,
  instruction,
  messages,
  parentRunId,
}: {
  runId: string;
  threadId: string;
  workspace: string;
  instruction?: string;
  messages?: Message[];
  parentRunId?: string;
}): RunAgentInput {
  const workspaceState = {
    workspace,
    relay_workspace: workspace,
  };
  return {
    threadId,
    runId,
    parentRunId,
    state: workspaceState,
    messages: messages ?? [{
      id: `${runId}-user`,
      role: "user",
      content: instruction ?? "",
    }],
    tools: [],
    context: [
      { description: "workspace", value: workspace },
      { description: "relay_workspace", value: workspace },
    ],
    forwardedProps: workspaceState,
  };
}

export function buildApprovalMessages({
  runId,
  userText,
  approval,
  approved,
}: {
  runId: string;
  userText: string;
  approval: ApprovalState;
  approved: boolean;
}): Message[] {
  if (!approval.clientToolCall) {
    throw new Error("AG-UI approval metadata is missing.");
  }
  return [
    {
      id: `${runId}-user`,
      role: "user",
      content: userText,
    },
    {
      id: `${runId}-assistant-approval`,
      role: "assistant",
      toolCalls: [
        {
          id: approval.clientToolCall.id,
          type: "function",
          function: {
            name: approval.clientToolCall.name,
            arguments: approval.clientToolCall.args,
          },
        },
      ],
    },
    {
      id: `${runId}-tool-approval`,
      role: "tool",
      toolCallId: approval.clientToolCall.id,
      content: JSON.stringify({
        approved,
        reason: approved ? "approved in Relay Workbench" : "rejected in Relay Workbench",
      }),
    },
  ];
}

export function updateToolCallDraft(
  event: RelayAgUiEvent,
  drafts: Map<string, RelayAgUiToolCallDraft>,
): RelayAgUiToolCallDraft | null {
  if (event.type === EventType.TOOL_CALL_START) {
    if (!event.toolCallId || !event.toolCallName) return null;
    const draft = {
      id: event.toolCallId,
      name: event.toolCallName,
      args: "",
      parentMessageId: event.parentMessageId,
    };
    drafts.set(draft.id, draft);
    return draft;
  }

  if (event.type === EventType.TOOL_CALL_ARGS) {
    if (!event.toolCallId) return null;
    const draft = drafts.get(event.toolCallId);
    if (!draft) return null;
    draft.args += event.delta ?? "";
    return draft;
  }

  if (event.type === EventType.TOOL_CALL_END) {
    return event.toolCallId ? drafts.get(event.toolCallId) ?? null : null;
  }

  return null;
}

export function approvalFromToolCall(draft: RelayAgUiToolCallDraft): ApprovalState | null {
  if (draft.name !== "request_approval") return null;
  try {
    const outer = JSON.parse(draft.args || "{}") as { request?: unknown };
    const request = typeof outer.request === "string"
      ? JSON.parse(outer.request) as Record<string, unknown>
      : outer.request && typeof outer.request === "object"
        ? outer.request as Record<string, unknown>
        : null;
    if (!request) return null;

    const approvalId = asString(request.approvalId);
    const toolCallId = asString(request.toolCallId);
    const functionName = asString(request.functionName);
    if (!approvalId || !toolCallId || !functionName) return null;

    return {
      approvalId,
      clientToolCall: {
        id: draft.id,
        name: draft.name,
        args: draft.args,
      },
      toolCall: {
        id: toolCallId,
        tool: functionName,
        args: parseArguments(request.functionArguments),
      },
    };
  } catch {
    return null;
  }
}

export function runEventFromAgUi(event: RelayAgUiEvent): RunEvent {
  switch (event.type) {
    case EventType.RUN_STARTED:
      return baseRunEvent(event, "status", "Run started");
    case EventType.TEXT_MESSAGE_START:
      return baseRunEvent(event, "status", "Assistant response started");
    case EventType.TEXT_MESSAGE_CONTENT:
      return baseRunEvent(event, "final", "Assistant", event.delta);
    case EventType.TEXT_MESSAGE_END:
      return baseRunEvent(event, "status", "Assistant response completed");
    case EventType.REASONING_START:
    case EventType.THINKING_START:
      return baseRunEvent(event, "copilot_turn_started", "Copilot turn started");
    case EventType.REASONING_END:
    case EventType.THINKING_END:
      return baseRunEvent(event, "copilot_turn_completed", "Copilot turn completed");
    case EventType.REASONING_MESSAGE_CONTENT:
    case EventType.THINKING_TEXT_MESSAGE_CONTENT:
      return baseRunEvent(event, "status", "Reasoning", event.delta);
    case EventType.TOOL_CALL_START:
      return baseRunEvent(
        event,
        event.toolCallName === "request_approval" ? "approval_requested" : "tool_call_started",
        event.toolCallName === "request_approval" ? "確認が必要です" : event.toolCallName || "Tool call",
        event.toolCallId,
        event,
      );
    case EventType.TOOL_CALL_ARGS:
      return baseRunEvent(event, "status", "Tool arguments", event.delta, event);
    case EventType.TOOL_CALL_END:
      return baseRunEvent(event, "status", "Tool call prepared", event.toolCallId, event);
    case EventType.TOOL_CALL_RESULT:
      return baseRunEvent(event, "tool_call_completed", "Tool result", event.content, event);
    case EventType.STATE_SNAPSHOT:
    case EventType.STATE_DELTA:
    case EventType.MESSAGES_SNAPSHOT:
      return baseRunEvent(event, "status", "State updated", stringifyEventPayload(event));
    case EventType.STEP_STARTED:
      return baseRunEvent(event, "status", event.stepName || "Step started");
    case EventType.STEP_FINISHED:
      return baseRunEvent(event, "status", event.stepName || "Step finished");
    case EventType.RUN_FINISHED:
      return baseRunEvent(event, "completed", "完了しました", stringifyEventPayload(event));
    case EventType.RUN_ERROR:
      return baseRunEvent(event, "error", event.message || "AG-UI run failed", event.code);
    default:
      return baseRunEvent(event, "status", event.message || event.type, event.detail ?? stringifyEventPayload(event));
  }
}

export function normalizeApproval(value: unknown): ApprovalState | null {
  if (!value || typeof value !== "object") return null;
  const approval = value as { approvalId?: unknown; toolCall?: unknown; clientToolCall?: unknown };
  if (typeof approval.approvalId !== "string") return null;
  if (!approval.toolCall || typeof approval.toolCall !== "object") return null;
  const toolCall = approval.toolCall as { id?: unknown; tool?: unknown; args?: unknown };
  if (typeof toolCall.id !== "string" || typeof toolCall.tool !== "string") return null;
  const normalized: ApprovalState = {
    approvalId: approval.approvalId,
    toolCall: {
      id: toolCall.id,
      tool: toolCall.tool,
      args: toolCall.args && typeof toolCall.args === "object"
        ? (toolCall.args as Record<string, unknown>)
        : {},
    },
  };
  if (approval.clientToolCall && typeof approval.clientToolCall === "object") {
    const clientToolCall = approval.clientToolCall as { id?: unknown; name?: unknown; args?: unknown };
    if (
      typeof clientToolCall.id === "string" &&
      typeof clientToolCall.name === "string" &&
      typeof clientToolCall.args === "string"
    ) {
      normalized.clientToolCall = {
        id: clientToolCall.id,
        name: clientToolCall.name,
        args: clientToolCall.args,
      };
    }
  }
  return normalized;
}

export function eventKey(event: RunEvent): string {
  return [
    event.runId ?? "",
    event.sequence ?? "",
    event.timestamp ?? "",
    event.type,
    event.message,
    event.detail ?? "",
  ].join("\u0000");
}

function baseRunEvent(
  event: RelayAgUiEvent,
  type: RunEvent["type"],
  message: string,
  detail?: string,
  data?: unknown,
): RunEvent {
  return {
    type,
    message,
    detail: truncate(detail),
    data,
    runId: event.runId,
    sequence: event.sequence,
    timestamp: typeof event.timestamp === "number" ? String(event.timestamp) : event.timestamp,
  };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return { raw: value };
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringifyEventPayload(event: RelayAgUiEvent): string | undefined {
  const omitted = new Set(["type", "timestamp", "rawEvent"]);
  const payload = Object.fromEntries(
    Object.entries(event).filter(([key, value]) => !omitted.has(key) && value !== undefined),
  );
  if (Object.keys(payload).length === 0) return undefined;
  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncate(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}
