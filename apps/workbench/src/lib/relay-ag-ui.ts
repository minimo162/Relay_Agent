import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
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
};

export class RelayEventSourceAgent extends AbstractAgent {
  constructor(private readonly streamUrlForRun: (runId: string) => string) {
    super({
      agentId: "relay-workbench",
      description: "Relay Workbench AG-UI event stream consumer",
      threadId: "relay-workbench",
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const source = new EventSource(this.streamUrlForRun(input.runId));
      let terminal = false;

      source.addEventListener("ag-ui-event", (event) => {
        const data = (event as MessageEvent).data;
        if (!data) return;
        try {
          const parsed = JSON.parse(data) as RelayAgUiEvent;
          terminal = isTerminalAgUiEvent(parsed);
          subscriber.next(parsed as BaseEvent);
          if (terminal) {
            source.close();
            subscriber.complete();
          }
        } catch (error) {
          source.close();
          subscriber.error(error);
        }
      });

      source.onerror = () => {
        source.close();
        if (terminal) {
          subscriber.complete();
        } else {
          subscriber.complete();
        }
      };

      return () => {
        source.close();
      };
    });
  }
}

export function runEventFromAgUi(event: RelayAgUiEvent): RunEvent {
  return {
    type: runEventTypeFromAgUi(event.type),
    message: event.message || event.type,
    detail: event.detail,
    data: event.data,
    runId: event.runId,
    sequence: event.sequence,
    timestamp: typeof event.timestamp === "number" ? String(event.timestamp) : event.timestamp,
  };
}

export function normalizeApproval(value: unknown): ApprovalState | null {
  if (!value || typeof value !== "object") return null;
  const approval = value as { approvalId?: unknown; toolCall?: unknown };
  if (typeof approval.approvalId !== "string") return null;
  if (!approval.toolCall || typeof approval.toolCall !== "object") return null;
  const toolCall = approval.toolCall as { id?: unknown; tool?: unknown; args?: unknown };
  if (typeof toolCall.id !== "string" || typeof toolCall.tool !== "string") return null;
  return {
    approvalId: approval.approvalId,
    toolCall: {
      id: toolCall.id,
      tool: toolCall.tool,
      args: toolCall.args && typeof toolCall.args === "object"
        ? (toolCall.args as Record<string, unknown>)
        : {},
    },
  };
}

export function approvalFromEvents(nextEvents: readonly RunEvent[], status: string): ApprovalState | null {
  if (status !== "approval_required") return null;
  let approval: ApprovalState | null = null;
  for (const event of nextEvents) {
    if (event.type === "approval_requested") {
      approval = normalizeApproval(event.data);
    } else if (isTerminalRunEvent(event)) {
      approval = null;
    }
  }
  return approval;
}

export function eventKey(event: RunEvent): string {
  if (event.runId && event.sequence) {
    return `${event.runId}:${event.sequence}`;
  }
  return `${event.type}\u0000${event.message}\u0000${event.detail ?? ""}`;
}

function runEventTypeFromAgUi(type: string): RunEvent["type"] {
  switch (type) {
    case EventType.STATE_DELTA:
    case EventType.STATE_SNAPSHOT:
      return "status";
    case EventType.THINKING_START:
    case EventType.REASONING_START:
      return "copilot_turn_started";
    case EventType.THINKING_END:
    case EventType.REASONING_END:
      return "copilot_turn_completed";
    case EventType.TOOL_CALL_START:
      return "tool_call_started";
    case EventType.TOOL_CALL_END:
    case EventType.TOOL_CALL_RESULT:
      return "tool_call_completed";
    case "USER_CONFIRMATION_REQUEST":
      return "approval_requested";
    case "USER_CONFIRMATION_RESULT":
      return "approval_resolved";
    case EventType.RUN_FINISHED:
      return "completed";
    case "RUN_CANCELLED":
      return "cancelled";
    case EventType.RUN_ERROR:
      return "error";
    default:
      return "status";
  }
}

function isTerminalAgUiEvent(event: RelayAgUiEvent): boolean {
  return event.type === EventType.RUN_FINISHED ||
    event.type === EventType.RUN_ERROR ||
    event.type === "RUN_CANCELLED" ||
    event.type === "USER_CONFIRMATION_REQUEST";
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === "approval_resolved" ||
    event.type === "completed" ||
    event.type === "cancelled" ||
    event.type === "error";
}
