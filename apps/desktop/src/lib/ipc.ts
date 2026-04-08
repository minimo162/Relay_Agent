/**
 * Tauri IPC bridge — commands + events for Relay Agent
 *
 * Commands (tauri_bridge.rs):
 *   start_agent, respond_approval, cancel_agent, get_session_history,
 *   compact_agent_session,
 *   connect_cdp, cdp_send_prompt, cdp_start_new_chat, cdp_screenshot
 *
 * Events:
 *   agent:tool_start | agent:tool_result | agent:approval_needed
 *   agent:turn_complete | agent:text_delta | agent:error
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn, Event } from "@tauri-apps/api/event";

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
   CDP (Chrome DevTools Protocol) — M365 Copilot integration
   ============================================================ */

export interface ConnectCdpRequest {
  autoLaunch?: boolean;
  /** When `autoLaunch` is true, CDP port is OS-assigned (`DevToolsActivePort`); this is a hint only. */
  /** When `autoLaunch` is false: explicit CDP port, or omit to resolve marker / DevToolsActivePort then **9333**. */
  basePort?: number;
}

export interface CdpConnectResult {
  ok: boolean;
  debugUrl: string;
  pageUrl: string;
  pageTitle: string;
  port?: number;
  launched: boolean;
  error: string | null;
}

export interface CdpSendPromptRequest {
  prompt: string;
  waitResponseSecs?: number;
}

export interface CdpPromptResult {
  ok: boolean;
  responseText: string;
  bodyLength: number;
  error: string | null;
}

/** Connect to M365 Copilot via Edge CDP */
export async function connectCdp(
  request: ConnectCdpRequest,
): Promise<CdpConnectResult> {
  return invoke<CdpConnectResult>("connect_cdp", { request });
}

/** Send a prompt to M365 Copilot and wait for the response */
export async function cdpSendPrompt(
  request: CdpSendPromptRequest,
): Promise<CdpPromptResult> {
  return invoke<CdpPromptResult>("cdp_send_prompt", { request });
}

/** Start a new chat in M365 Copilot */
export async function cdpStartNewChat(
  request: ConnectCdpRequest,
): Promise<CdpConnectResult> {
  return invoke<CdpConnectResult>("cdp_start_new_chat", { request });
}

/** Capture a screenshot of the Copilot browser */
export async function cdpScreenshot(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("cdp_screenshot", {});
}

/** Disconnect from the Copilot page and clean up the auto-launched browser */
export async function disconnectCdp(): Promise<void> {
  return invoke<void>("disconnect_cdp", {});
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
  const toolCallIndex = new Map<string, Extract<UiChunk, { kind: "tool_call" }>>();
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
          const chunk = {
            kind: "tool_call" as const,
            toolUseId: block.id,
            toolName: block.name,
            result: null as string | null,
            status: "running" as const,
          };
          chunks.push(chunk);
          toolCallIndex.set(block.id, chunk);
        }
        if (block.type === "tool_result") {
          const lastTool = toolCallIndex.get(block.tool_use_id);
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

/** User-facing status while a tool runs (no internal tool names in the main line). */
export function friendlyToolActivityLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_file: "Reading a file…",
    glob_search: "Searching the workspace for files…",
    grep_search: "Searching file contents…",
    write_file: "Writing a file…",
    edit_file: "Updating a file…",
    bash: "Running a shell command…",
    PowerShell: "Running PowerShell…",
    REPL: "Running code…",
    WebFetch: "Fetching web content…",
    WebSearch: "Searching the web…",
    TodoWrite: "Updating tasks…",
    NotebookEdit: "Editing a notebook…",
    Config: "Changing settings…",
    Agent: "Running a sub-task…",
    Skill: "Loading instructions…",
    ToolSearch: "Looking up tools…",
    Sleep: "Waiting briefly…",
    SendUserMessage: "Preparing a message…",
    Brief: "Preparing a message…",
    StructuredOutput: "Formatting a response…",
    CliList: "Listing command-line tools…",
    CliDiscover: "Discovering command-line tools…",
    CliRegister: "Registering a CLI…",
    CliUnregister: "Removing a CLI registration…",
    CliRun: "Running an external command…",
    ElectronApps: "Checking desktop apps…",
    ElectronLaunch: "Launching an app…",
    ElectronEval: "Inspecting an app…",
    ElectronGetText: "Reading app content…",
    ElectronClick: "Automating a click…",
    ElectronTypeText: "Typing into an app…",
  };
  return labels[toolName] ?? "Working on your request…";
}

/* ============================================================
   MCP Server Management
   ============================================================ */

export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  status: string;
  connected: boolean;
  tools: string[];
}

export interface McpAddServerRequest {
  name: string;
  command: string;
  args?: string[];
}

/* ============================================================
   Context Panel types
   ============================================================ */

export interface ContextFile {
  name: string;
  path: string;
  size: number;
}

export /** Re-export as McpServer for UI convenience */
interface McpServer {
  /** Server name (same as McpServerInfo.name) */
  name: string;
  /** Command to spawn the MCP server */
  command: string;
  /** Command arguments */
  args: string[];
  /** Connection status for UI */
  status: "connected" | "disconnected";
  /** Number of tools available */
  toolCount: number;
}

export interface Policy {
  name: string;
  requirement: "require_approval" | "auto_deny" | "auto_allow";
  description?: string;
}

/** List all registered MCP servers (mapped from McpServerInfo to McpServer). */
export async function mcpListServers(): Promise<McpServer[]> {
  const servers = await invoke<McpServerInfo[]>("mcp_list_servers", {});
  return servers.map((s) => ({
    name: s.name,
    command: s.command,
    args: s.args,
    status: s.connected ? ("connected" as const) : ("disconnected" as const),
    toolCount: s.tools.length,
  }));
}

/** Add an MCP server to the registry. */
export async function mcpAddServer(
  request: McpAddServerRequest,
): Promise<McpServer> {
  const info = await invoke<McpServerInfo>("mcp_add_server", { request });
  return {
    name: info.name,
    command: info.command,
    args: info.args,
    status: info.connected ? ("connected" as const) : ("disconnected" as const),
    toolCount: info.tools.length,
  };
}

/** Remove an MCP server from the registry. Returns true if it existed. */
export async function mcpRemoveServer(name: string): Promise<boolean> {
  return invoke<boolean>("mcp_remove_server", { name });
}

/** Check the status of a single MCP server. */
export async function mcpCheckServerStatus(name: string): Promise<McpServerInfo> {
  return invoke<McpServerInfo>("mcp_check_server_status", { name });
}
