/**
 * Tauri IPC bridge — provider diagnostics.
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
 * Legacy agent chat/session commands are intentionally not exported from this
 * frontend bridge. Provider-mode execution belongs to OpenCode/OpenWork.
 *
 * Relay-owned agent events were removed with the hard-cut migration.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserAutomationSettings as GeneratedBrowserAutomationSettings,
  CdpConnectResult as GeneratedCdpConnectResult,
  CdpPromptResult as GeneratedCdpPromptResult,
  CdpSendPromptRequest as GeneratedCdpSendPromptRequest,
  ConnectCdpRequest as GeneratedConnectCdpRequest,
  InstructionSurface as GeneratedInstructionSurface,
  McpAddServerRequest as GeneratedMcpAddServerRequest,
  McpServerInfo as GeneratedMcpServerInfo,
  RelayDiagnostics as GeneratedRelayDiagnostics,
  RustAnalyzerProbeRequest as GeneratedRustAnalyzerProbeRequest,
  RustAnalyzerProbeResponse as GeneratedRustAnalyzerProbeResponse,
  WorkspaceAllowlistSnapshot as GeneratedWorkspaceAllowlistSnapshot,
  WorkspaceInstructionSurfaces as GeneratedWorkspaceInstructionSurfaces,
  WorkspaceSkillRow as GeneratedWorkspaceSkillRow,
  WorkspaceSlashCommandRow as GeneratedWorkspaceSlashCommandRow,
} from "./ipc.generated";

/* ============================================================
   Request / Response types (Rust models.rs → camelCase)
   ============================================================ */

export type BrowserAutomationSettings = GeneratedBrowserAutomationSettings;

/** `get_relay_diagnostics` payload (camelCase from Rust). */
export type RelayDiagnostics = GeneratedRelayDiagnostics;

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

export type AgentSessionPhase =
  | "idle"
  | "running"
  | "retrying"
  | "compacting"
  | "waiting_approval"
  | "cancelling";

/* ============================================================
   Diagnostic Tauri commands
   ============================================================ */

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

export type RustAnalyzerProbeRequest = GeneratedRustAnalyzerProbeRequest;
export type RustAnalyzerProbeResponse = GeneratedRustAnalyzerProbeResponse;

/** Minimal LSP milestone: runs `rust-analyzer --version` in the given folder (`docs/LSP_MILESTONE.md`). */
export async function probeRustAnalyzer(
  request: RustAnalyzerProbeRequest,
): Promise<RustAnalyzerProbeResponse> {
  return invoke<RustAnalyzerProbeResponse>("probe_rust_analyzer", { request });
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
