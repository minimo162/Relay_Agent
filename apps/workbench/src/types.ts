export type StatusResponse = {
  app: string;
  version: string;
  ready: boolean;
  checks: ReadonlyArray<{
    name: string;
    ready: boolean;
    detail: string;
    required?: boolean;
  }>;
};

export type RunEvent = {
  type:
    | "status"
    | "tool"
    | "approval"
    | "final"
    | "copilot_turn_started"
    | "copilot_turn_completed"
    | "tool_call_started"
    | "tool_call_completed"
    | "approval_requested"
    | "approval_resolved"
    | "artifact_created"
    | "completed"
    | "cancelled"
    | "error";
  message: string;
  detail?: string;
  data?: unknown;
  runId?: string;
  sequence?: number;
  timestamp?: string;
};

export type ApprovalState = {
  approvalId: string;
  clientToolCall?: {
    id: string;
    name: string;
    args: string;
  };
  toolCall: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
  };
};

export type RunStatus = "running" | "completed" | "failed" | "approval_required" | "cancelled";

export const runEventTypes: readonly RunEvent["type"][] = [
  "status",
  "tool",
  "approval",
  "final",
  "copilot_turn_started",
  "copilot_turn_completed",
  "tool_call_started",
  "tool_call_completed",
  "approval_requested",
  "approval_resolved",
  "artifact_created",
  "completed",
  "cancelled",
  "error",
];
