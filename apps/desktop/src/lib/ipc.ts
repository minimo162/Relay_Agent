/**
 * Tauri IPC bridge — provider diagnostics plus legacy desktop diagnostic events.
 *
 * Provider-mode execution does not use these commands. OpenCode/OpenWork calls
 * the OpenAI-compatible provider gateway directly and owns sessions, tools,
 * permissions, transcript state, and workspace execution.
 *
 * Diagnostic commands (tauri_bridge.rs):
 *   warmup_copilot_bridge (optional browserSettings), get_relay_diagnostics,
 *   get_workspace_allowlist, remove_workspace_allowlist_tool, clear_workspace_allowlist,
 *   list_workspace_slash_commands,
 *   connect_cdp, cdp_send_prompt, cdp_start_new_chat, cdp_screenshot
 *
 * Legacy diagnostic commands still present while deletion proceeds:
 *   start_agent, respond_approval, cancel_agent, get_session_history,
 *   compact_agent_session
 *
 * Events:
 *   agent:tool_start | agent:tool_result | agent:approval_needed | agent:user_question
 *   agent:status | agent:turn_complete | agent:text_delta | agent:error
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn, Event } from "@tauri-apps/api/event";
import type {
  AgentApprovalNeededEvent as GeneratedAgentApprovalNeededEvent,
  AgentErrorEvent as GeneratedAgentErrorEvent,
  AgentSessionHistoryResponse as GeneratedAgentSessionHistoryResponse,
  AgentSessionStatusEvent as GeneratedAgentSessionStatusEvent,
  AgentTextDeltaEvent as GeneratedAgentTextDeltaEvent,
  AgentToolResultEvent as GeneratedAgentToolResultEvent,
  AgentToolStartEvent as GeneratedAgentToolStartEvent,
  AgentTurnCompleteEvent as GeneratedAgentTurnCompleteEvent,
  AgentUserQuestionNeededEvent as GeneratedAgentUserQuestionNeededEvent,
  BrowserAutomationSettings as GeneratedBrowserAutomationSettings,
  CancelAgentRequest as GeneratedCancelAgentRequest,
  CdpConnectResult as GeneratedCdpConnectResult,
  CdpPromptResult as GeneratedCdpPromptResult,
  CdpSendPromptRequest as GeneratedCdpSendPromptRequest,
  CompactAgentSessionRequest as GeneratedCompactAgentSessionRequest,
  CompactAgentSessionResponse as GeneratedCompactAgentSessionResponse,
  ContinueAgentSessionRequest as GeneratedContinueAgentSessionRequest,
  ConnectCdpRequest as GeneratedConnectCdpRequest,
  GetAgentSessionHistoryRequest as GeneratedGetAgentSessionHistoryRequest,
  InstructionSurface as GeneratedInstructionSurface,
  McpAddServerRequest as GeneratedMcpAddServerRequest,
  McpServerInfo as GeneratedMcpServerInfo,
  MessageContent as GeneratedMessageContent,
  RelayDiagnostics as GeneratedRelayDiagnostics,
  RustAnalyzerProbeRequest as GeneratedRustAnalyzerProbeRequest,
  RustAnalyzerProbeResponse as GeneratedRustAnalyzerProbeResponse,
  SessionWriteUndoRequest as GeneratedSessionWriteUndoRequest,
  SessionWriteUndoStatusResponse as GeneratedSessionWriteUndoStatusResponse,
  StartAgentRequest as GeneratedStartAgentRequest,
  WorkspaceAllowlistSnapshot as GeneratedWorkspaceAllowlistSnapshot,
  WorkspaceInstructionSurfaces as GeneratedWorkspaceInstructionSurfaces,
  WorkspaceSkillRow as GeneratedWorkspaceSkillRow,
  WorkspaceSlashCommandRow as GeneratedWorkspaceSlashCommandRow,
} from "./ipc.generated";

/* ============================================================
   Request / Response types (Rust models.rs → camelCase)
   ============================================================ */

export type BrowserAutomationSettings = GeneratedBrowserAutomationSettings;

export type StartAgentRequest = GeneratedStartAgentRequest;
export type ContinueAgentSessionRequest = GeneratedContinueAgentSessionRequest;

/**
 * Tool approvals (OpenWork-style): `approved` unblocks one execution; `rememberForSession`
 * adds the tool name to a session allow-list so the host skips further prompts for that tool
 * until the session ends. This request drives interactive prompts from the agent loop.
 */
export interface RespondAgentApprovalRequest {
  sessionId: string;
  approvalId: string;
  approved: boolean;
  rememberForSession?: boolean;
  rememberForWorkspace?: boolean;
}

/** Answer a pending `AskUserQuestion` tool invocation. */
export interface RespondUserQuestionRequest {
  sessionId: string;
  questionId: string;
  answer: string;
}

/** `get_relay_diagnostics` payload (camelCase from Rust). */
export type RelayDiagnostics = GeneratedRelayDiagnostics;

export type CancelAgentRequest = GeneratedCancelAgentRequest;

export type GetAgentSessionHistoryRequest = GeneratedGetAgentSessionHistoryRequest;

/* Content block inside a Rust Message */
type MessageBlock = GeneratedMessageContent;
type AgentMessage = GeneratedAgentSessionHistoryResponse["messages"][number];
export type AgentSessionHistoryResponse = GeneratedAgentSessionHistoryResponse;

/* ============================================================
   Tauri event payloads
   ============================================================ */

export type AgentToolStartEvent = GeneratedAgentToolStartEvent;
export type AgentToolResultEvent = GeneratedAgentToolResultEvent;
export type AgentApprovalNeededEvent = GeneratedAgentApprovalNeededEvent;
export type AgentUserQuestionNeededEvent = GeneratedAgentUserQuestionNeededEvent;

export type AgentStopReason =
  | "completed"
  | "cancelled"
  | "meta_stall"
  | "retry_exhausted"
  | "compaction_failed"
  | "max_turns_reached"
  | "permission_denied"
  | "tool_error"
  | "doom_loop";

export type AgentTurnCompleteEvent =
  Omit<GeneratedAgentTurnCompleteEvent, "stopReason"> & { stopReason: AgentStopReason };

export type AgentSessionPhase =
  | "idle"
  | "running"
  | "retrying"
  | "compacting"
  | "waiting_approval"
  | "cancelling";

export type AgentSessionStatusEvent =
  Omit<GeneratedAgentSessionStatusEvent, "phase" | "stopReason"> & {
    phase: AgentSessionPhase;
    stopReason?: AgentStopReason;
  };
export type AgentTextDeltaEvent = GeneratedAgentTextDeltaEvent;
export type AgentErrorEvent = GeneratedAgentErrorEvent;

/* Union of all agent events */
export type AgentEvent =
  | { type: "tool_start"; data: AgentToolStartEvent }
  | { type: "tool_result"; data: AgentToolResultEvent }
  | { type: "approval_needed"; data: AgentApprovalNeededEvent }
  | { type: "user_question"; data: AgentUserQuestionNeededEvent }
  | { type: "status"; data: AgentSessionStatusEvent }
  | { type: "text_delta"; data: AgentTextDeltaEvent }
  | { type: "turn_complete"; data: AgentTurnCompleteEvent }
  | { type: "error"; data: AgentErrorEvent };

/* ============================================================
   Tauri commands
   ============================================================ */

export async function startAgent(request: StartAgentRequest): Promise<string> {
  return invoke<string>("start_agent", { request });
}

export async function continueAgentSession(request: ContinueAgentSessionRequest): Promise<string> {
  return invoke<string>("continue_agent_session", { request });
}

export async function respondApproval(request: RespondAgentApprovalRequest): Promise<void> {
  return invoke<void>("respond_approval", { request });
}

export async function respondUserQuestion(request: RespondUserQuestionRequest): Promise<void> {
  return invoke<void>("respond_user_question", { request });
}

export async function getRelayDiagnostics(): Promise<RelayDiagnostics> {
  return invoke<RelayDiagnostics>("get_relay_diagnostics");
}

/** Write support text (e.g. diagnostics JSON) to a path from the native save dialog. */
export async function writeTextExport(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_export", { path, contents });
}

export type WorkspaceAllowlistSnapshot = GeneratedWorkspaceAllowlistSnapshot;

export async function getWorkspaceAllowlist(): Promise<WorkspaceAllowlistSnapshot> {
  return invoke<WorkspaceAllowlistSnapshot>("get_workspace_allowlist");
}

export async function removeWorkspaceAllowlistTool(cwd: string, toolName: string): Promise<void> {
  return invoke<void>("remove_workspace_allowlist_tool", {
    request: { cwd, toolName },
  });
}

export async function clearWorkspaceAllowlist(cwd: string): Promise<void> {
  return invoke<void>("clear_workspace_allowlist", { request: { cwd } });
}

export type WorkspaceSlashCommandRow = GeneratedWorkspaceSlashCommandRow;

export async function listWorkspaceSlashCommands(cwd: string | null): Promise<WorkspaceSlashCommandRow[]> {
  return invoke<WorkspaceSlashCommandRow[]>("list_workspace_slash_commands", {
    request: { cwd: cwd?.trim() || null },
  });
}

export type WorkspaceSkillRow = GeneratedWorkspaceSkillRow;

export async function listWorkspaceSkills(cwd: string | null): Promise<WorkspaceSkillRow[]> {
  return invoke<WorkspaceSkillRow[]>("list_workspace_skills", {
    request: { cwd: cwd?.trim() || null },
  });
}

export type InstructionSurface = GeneratedInstructionSurface;
export type WorkspaceInstructionSurfaces = GeneratedWorkspaceInstructionSurfaces;

/** Read-only Claw-style instruction paths under workspace `cwd`. */
export async function fetchWorkspaceInstructionSurfaces(
  cwd: string | null,
): Promise<WorkspaceInstructionSurfaces> {
  return invoke<WorkspaceInstructionSurfaces>("workspace_instruction_surfaces", {
    request: { cwd: cwd?.trim() || null },
  });
}

const AUDIT_SUMMARY_LINE_MAX = 280;

function trimAuditText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Compact, copy-paste friendly audit trail from session history (tools + truncated text). */
export function formatSessionAuditSummary(res: AgentSessionHistoryResponse): string {
  const lines: string[] = [];
  lines.push("Relay Agent — session audit summary");
  lines.push(`sessionId: ${res.sessionId}`);
  lines.push(`running: ${res.running}`);
  lines.push("");
  let mi = 0;
  for (const msg of res.messages) {
    mi += 1;
    lines.push(`--- Message ${mi} (${msg.role}) ---`);
    for (const block of msg.content) {
      if (block.type === "text") {
        const t = block.text.trim();
        if (t) lines.push(trimAuditText(t, AUDIT_SUMMARY_LINE_MAX));
      } else if (block.type === "toolUse") {
        lines.push(`tool: ${block.name}  [${block.id}]`);
      } else if (block.type === "toolResult") {
        const flag = block.isError ? " (error)" : "";
        lines.push(`tool_result: ${block.toolUseId}${flag}`);
        const c = block.content.trim();
        if (c) lines.push(`  ${trimAuditText(c, AUDIT_SUMMARY_LINE_MAX)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function cancelAgent(request: CancelAgentRequest): Promise<void> {
  return invoke<void>("cancel_agent", { request });
}

export async function getSessionHistory(
  request: GetAgentSessionHistoryRequest,
): Promise<AgentSessionHistoryResponse> {
  return invoke<AgentSessionHistoryResponse>("get_session_history", { request });
}

export type SessionWriteUndoRequest = GeneratedSessionWriteUndoRequest;
export type SessionWriteUndoStatusResponse = GeneratedSessionWriteUndoStatusResponse;

export async function undoSessionWrite(request: SessionWriteUndoRequest): Promise<void> {
  return invoke<void>("undo_session_write", { request });
}

export async function redoSessionWrite(request: SessionWriteUndoRequest): Promise<void> {
  return invoke<void>("redo_session_write", { request });
}

export async function getSessionWriteUndoStatus(
  request: SessionWriteUndoRequest,
): Promise<SessionWriteUndoStatusResponse> {
  return invoke<SessionWriteUndoStatusResponse>("get_session_write_undo_status", { request });
}

export type RustAnalyzerProbeRequest = GeneratedRustAnalyzerProbeRequest;
export type RustAnalyzerProbeResponse = GeneratedRustAnalyzerProbeResponse;

/** Minimal LSP milestone: runs `rust-analyzer --version` in the given folder (`docs/LSP_MILESTONE.md`). */
export async function probeRustAnalyzer(
  request: RustAnalyzerProbeRequest,
): Promise<RustAnalyzerProbeResponse> {
  return invoke<RustAnalyzerProbeResponse>("probe_rust_analyzer", { request });
}

export type CompactAgentSessionRequest = GeneratedCompactAgentSessionRequest;
export type CompactAgentSessionResponse = GeneratedCompactAgentSessionResponse;

export async function compactAgentSession(
  request: CompactAgentSessionRequest,
): Promise<CompactAgentSessionResponse> {
  return invoke<CompactAgentSessionResponse>("compact_agent_session", { request });
}

/** Node bridge `GET /status` after ensuring Edge/Copilot tab (startup prewarm). */
export type CopilotWarmupStage =
  | "ensure_server"
  | "health_check"
  | "boot_token_auth"
  | "status_request"
  | "cdp_attach"
  | "copilot_tab"
  | "login_check"
  | "ready";

export type CopilotWarmupFailureCode =
  | "ensure_server_failed"
  | "health_check_failed"
  | "boot_token_unauthorized"
  | "status_http_error"
  | "status_transport_error"
  | "cdp_attach_failed"
  | "copilot_tab_unavailable"
  | "login_required"
  | "unknown";

export interface CopilotWarmupResult {
  requestId: string;
  connected: boolean;
  loginRequired: boolean;
  bootTokenPresent: boolean;
  cdpPort: number;
  stage: CopilotWarmupStage;
  message: string;
  failureCode?: CopilotWarmupFailureCode | null;
  statusCode?: number | null;
  url?: string | null;
}

export async function warmupCopilotBridge(
  browserSettings?: BrowserAutomationSettings | null,
): Promise<CopilotWarmupResult> {
  return invoke<CopilotWarmupResult>("warmup_copilot_bridge", {
    browserSettings: browserSettings ?? null,
  });
}

/* ============================================================
   CDP (Chrome DevTools Protocol) — M365 Copilot integration
   ============================================================ */

export type ConnectCdpRequest = GeneratedConnectCdpRequest;
export type CdpConnectResult = GeneratedCdpConnectResult;
export type CdpSendPromptRequest = GeneratedCdpSendPromptRequest;
export type CdpPromptResult = GeneratedCdpPromptResult;

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
const E_USER_QUESTION = "agent:user_question";
const E_TEXT_DELTA = "agent:text_delta";
const E_STATUS = "agent:status";
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
    listen<AgentUserQuestionNeededEvent>(E_USER_QUESTION, (e) =>
      callback({ type: "user_question", data: e.payload }),
    ),
    listen<AgentSessionStatusEvent>(E_STATUS, (e) =>
      callback({ type: "status", data: e.payload }),
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

    case "toolUse":
      return {
        kind: "tool_use",
        toolUseId: block.id,
        toolName: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
        status: "running",
      };

    case "toolResult":
      return {
        kind: "tool_result",
        toolUseId: block.toolUseId,
        content: block.content,
        isError: block.isError,
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

const COPILOT_TRANSIENT_STATUS_PATTERNS = [
  /Loading image/gi,
  /Image has been generated/gi,
];

function stripTransientCopilotStatus(text: string): string {
  let cleaned = text;
  for (const pattern of COPILOT_TRANSIENT_STATUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, "\n");
  }
  return cleaned;
}

function dedupeConsecutiveLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let prev: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      prev = null;
      continue;
    }
    if (trimmed === prev) continue;
    out.push(trimmed);
    prev = trimmed;
  }
  return out.join("\n");
}

function dedupeConsecutiveParagraphs(text: string): string {
  const parts = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (out.at(-1) === trimmed) continue;
    out.push(trimmed);
  }
  return out.join("\n\n");
}

export function normalizeAssistantVisibleText(text: string): string {
  const cleaned = dedupeConsecutiveParagraphs(
    dedupeConsecutiveLines(stripTransientCopilotStatus(String(text ?? ""))),
  );
  return cleaned.trim();
}

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
          const text = normalizeAssistantVisibleText(block.text);
          if (!text) continue;
          chunks.push({ kind: "assistant" as const, text, streaming: false });
        }
        if (block.type === "toolUse") {
          const chunk = {
            kind: "tool_call" as const,
            toolUseId: block.id,
            toolName: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
            result: null as string | null,
            status: "running" as const,
          };
          chunks.push(chunk);
          toolCallIndex.set(block.id, chunk);
        }
        if (block.type === "toolResult") {
          const lastTool = toolCallIndex.get(block.toolUseId);
          if (lastTool) {
            lastTool.result = block.content;
            lastTool.status = block.isError ? "error" : "done";
          }
        }
      }
    }
  }
  return chunks;
}

export interface UiUserChunk {
  kind: "user";
  text: string;
}

export interface UiAssistantChunk {
  kind: "assistant";
  text: string;
  streaming?: boolean;
}

export interface UiToolCallChunk {
  kind: "tool_call";
  toolUseId: string;
  toolName: string;
  input?: Record<string, unknown>;
  status: "running" | "done" | "error";
  result: string | null;
}

export interface UiApprovalRequestChunk {
  kind: "approval_request";
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  workspaceCwdConfigured?: boolean;
  status: "pending" | "approved" | "rejected";
}

export interface UiUserQuestionChunk {
  kind: "user_question";
  sessionId: string;
  questionId: string;
  prompt: string;
  status: "pending" | "answered" | "cancelled";
}

export type UiChunk =
  | UiUserChunk
  | UiAssistantChunk
  | UiToolCallChunk
  | UiApprovalRequestChunk
  | UiUserQuestionChunk;

/** User-facing status while a tool runs (no internal tool names in the main line). */
export function friendlyToolActivityLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read: "Reading a file…",
    read_file: "Reading a file…",
    glob: "Searching the workspace for files…",
    glob_search: "Searching the workspace for files…",
    grep: "Searching file contents…",
    grep_search: "Searching file contents…",
    office_search: "Searching Office/PDF contents…",
    write: "Writing a file…",
    write_file: "Writing a file…",
    edit: "Updating a file…",
    edit_file: "Updating a file…",
    pdf_merge: "Merging PDFs…",
    pdf_split: "Splitting a PDF…",
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

export type McpServerInfo = GeneratedMcpServerInfo;
export type McpAddServerRequest = GeneratedMcpAddServerRequest;

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
