/**
 * Tauri IPC bridge — commands + events for Relay Agent
 *
 * Commands (tauri_bridge.rs):
 *   start_agent, respond_approval, cancel_agent, get_session_history
 *
 * Events:
 *   agent:tool_start | agent:tool_result | agent:approval_needed
 *   agent:turn_complete | agent:error
 */

import { invoke } from "@/tauri-mock-core";
import { listen, UnlistenFn, Event } from "@/tauri-mock-event";

/* ============================================================
   Request / Response types (Rust models.rs → camelCase)
   ============================================================ */

export interface BrowserAutomationSettings {
  cdpPort: number;
  autoLaunchEdge: boolean;
  timeoutMs: number;
}

export interface StartAgentRequest {
  goal: string;
  files?: string[];
  cwd?: string | null;
  browserSettings?: BrowserAutomationSettings | null;
  maxTurns?: number | null;
}

export interface RespondAgentApprovalRequest {
  sessionId: string;
  approvalId: string;
  approved: boolean;
}

export interface CancelAgentRequest {
  sessionId: string;
}

export interface GetAgentSessionHistoryRequest {
  sessionId: string;
}

/* Content block inside a Rust Message */
type MessageBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

export interface AgentMessage {
  role: string;
  content: MessageBlock[];
}

export interface AgentSessionHistoryResponse {
  sessionId: string;
  running: boolean;
  messages: AgentMessage[];
}

/* ============================================================
   Tauri event payloads
   ============================================================ */

export interface AgentToolStartEvent {
  sessionId: string;
  toolUseId: string;
  toolName: string;
}

export interface AgentToolResultEvent {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export interface AgentApprovalNeededEvent {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  input: Record<string, unknown>;
}

export interface AgentTurnCompleteEvent {
  sessionId: string;
  stopReason: string;
  assistantMessage: string;
  messageCount: number;
}

export interface AgentTextDeltaEvent {
  sessionId: string;
  text: string;
  isComplete: boolean;
}

export interface AgentErrorEvent {
  sessionId: string;
  error: string;
  cancelled: boolean;
}

/* Union of all agent events */
export type AgentEvent =
  | { type: "tool_start"; data: AgentToolStartEvent }
  | { type: "tool_result"; data: AgentToolResultEvent }
  | { type: "approval_needed"; data: AgentApprovalNeededEvent }
  | { type: "text_delta"; data: AgentTextDeltaEvent }
  | { type: "turn_complete"; data: AgentTurnCompleteEvent }
  | { type: "error"; data: AgentErrorEvent };

/* ============================================================
   Tauri commands
   ============================================================ */

export async function startAgent(request: StartAgentRequest): Promise<string> {
  return invoke<string>("start_agent", { request });
}

export async function respondApproval(request: RespondAgentApprovalRequest): Promise<void> {
  return invoke<void>("respond_approval", { request });
}

export async function cancelAgent(request: CancelAgentRequest): Promise<void> {
  return invoke<void>("cancel_agent", { request });
}

export async function getSessionHistory(
  request: GetAgentSessionHistoryRequest,
): Promise<AgentSessionHistoryResponse> {
  return invoke<AgentSessionHistoryResponse>("get_session_history", { request });
}

export interface CompactAgentSessionRequest {
  sessionId: string;
}

export interface CompactAgentSessionResponse {
  message: string;
  removedMessageCount: number;
}

export async function compactAgentSession(
  request: CompactAgentSessionRequest,
): Promise<CompactAgentSessionResponse> {
  return invoke<CompactAgentSessionResponse>("compact_agent_session", { request });
}

/* ============================================================
   Tauri events — listen to all
   ============================================================ */

const E_TOOL_START = "agent:tool_start";
const E_TOOL_RESULT = "agent:tool_result";
const E_APPROVAL_NEEDED = "agent:approval_needed";
const E_TEXT_DELTA = "agent:text_delta";
const E_TURN_COMPLETE = "agent:turn_complete";
const E_ERROR = "agent:error";

export function onAgentEvent(
  callback: (event: AgentEvent) => void,
): Promise<() => void> {
  const p = [
    listen<AgentToolStartEvent>(E_TOOL_START, (e) =>
      callback({ type: "tool_start", data: e.payload }),
    ),
    listen<AgentToolResultEvent>(E_TOOL_RESULT, (e) =>
      callback({ type: "tool_result", data: e.payload }),
    ),
    listen<AgentApprovalNeededEvent>(E_APPROVAL_NEEDED, (e) =>
      callback({ type: "approval_needed", data: e.payload }),
    ),
    listen<AgentTextDeltaEvent>(E_TEXT_DELTA, (e) =>
      callback({ type: "text_delta", data: e.payload }),
    ),
    listen<AgentTurnCompleteEvent>(E_TURN_COMPLETE, (e) =>
      callback({ type: "turn_complete", data: e.payload }),
    ),
    listen<AgentErrorEvent>(E_ERROR, (e) =>
      callback({ type: "error", data: e.payload }),
    ),
  ];
  return Promise.all(p).then((fns) => () => fns.forEach((fn) => fn()));
}

/* ============================================================
   Message formatting helpers
   ============================================================ */

/** Flatten a Rust Message into displayable UI chunks */
export function formatMessageBlock(block: MessageBlock): UiMessageChunk {
  switch (block.type) {
    case "text":
      return { kind: "text", text: block.text };

    case "tool_use":
      return {
        kind: "tool_use",
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
        status: "running",
      };

    case "tool_result":
      return {
        kind: "tool_result",
        toolUseId: block.tool_use_id,
        content: block.content,
        isError: block.is_error,
      };
  }
}

export type UiMessageChunk =
  | { kind: "text"; text: string }
  | {
      kind: "tool_use";
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      status: "running" | "done" | "error";
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
    };

/** Convert full history to a flat array of UI chunks (ordered) */
export function chunksFromHistory(messages: AgentMessage[]): UiChunk[] {
  const chunks: UiChunk[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const texts = msg.content
        .filter((b): b is Extract<MessageBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (texts) chunks.push({ kind: "user" as const, text: texts });
    }
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          chunks.push({ kind: "assistant" as const, text: block.text });
        }
        if (block.type === "tool_use") {
          chunks.push({
            kind: "tool_call",
            toolUseId: block.id,
            toolName: block.name,
            result: null,
            status: "running",
          });
        }
        if (block.type === "tool_result") {
          const lastTool = [...chunks]
            .reverse()
            .find(
              (c): c is Extract<UiChunk, { kind: "tool_call" }> =>
                c.kind === "tool_call" && c.toolUseId === block.tool_use_id,
            );
          if (lastTool) {
            lastTool.result = block.content;
            lastTool.status = block.is_error ? "error" : "done";
          }
        }
      }
    }
  }
  return chunks;
}

export type UiChunk =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool_call";
      toolUseId: string;
      toolName: string;
      status: "running" | "done" | "error";
      result: string | null;
    };
