// Generated from Rust IPC source types via ts-rs.
// Source: apps/desktop/src-tauri/src/models.rs, agent_loop/events, tauri_bridge.rs

export type SessionPreset = "build" | "plan" | "explore";

export interface BrowserAutomationSettings {
  cdpPort: number;
  autoLaunchEdge: boolean;
  timeoutMs: number;
}

export interface StartAgentRequest {
  goal: string;
  files: string[];
  cwd?: string | null;
  browserSettings?: BrowserAutomationSettings | null;
  maxTurns?: number | null;
  sessionPreset: SessionPreset;
}

export interface RespondAgentApprovalRequest {
  sessionId: string;
  approvalId: string;
  approved: boolean;
  rememberForSession?: boolean | null;
  rememberForWorkspace?: boolean | null;
}

export interface RespondUserQuestionRequest {
  sessionId: string;
  questionId: string;
  answer: string;
}

export interface RelayDiagnostics {
  appVersion: string;
  targetOs: string;
  copilotNodeBridgePort: number;
  defaultEdgeCdpPort: number;
  relayAgentDevMode: boolean;
  architectureNotes: string;
  processCwd: string;
  clawConfigHomeDisplay: string;
  maxTextFileReadBytes: number;
  doctorHints: string[];
  predictabilityNotes: string[];
}

export interface CancelAgentRequest {
  sessionId: string;
}

export interface GetAgentSessionHistoryRequest {
  sessionId: string;
}

export interface SessionWriteUndoRequest {
  sessionId: string;
}

export interface SessionWriteUndoStatusResponse {
  canUndo: boolean;
  canRedo: boolean;
}

export interface RustAnalyzerProbeRequest {
  workspacePath?: string | null;
}

export interface RustAnalyzerProbeResponse {
  ok: boolean;
  versionLine?: string | null;
  error?: string | null;
}

export interface CompactAgentSessionRequest {
  sessionId: string;
}

export interface CompactAgentSessionResponse {
  message: string;
  removedMessageCount: number;
}

export interface DesktopPermissionSummaryRow {
  name: string;
  hostMode: string;
  requiredMode: string;
  requirement: "auto_allow" | "require_approval" | "auto_deny";
  description: string;
}

export interface GetPermissionSummaryRequest {
  sessionPreset: SessionPreset;
}

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
  args: string[];
}

export interface WorkspaceAllowlistEntryRow {
  workspaceKey: string;
  tools: string[];
}

export interface WorkspaceAllowlistSnapshot {
  storePath: string;
  entries: WorkspaceAllowlistEntryRow[];
}

export interface WorkspaceAllowlistRemoveToolRequest {
  cwd: string;
  toolName: string;
}

export interface WorkspaceAllowlistCwdRequest {
  cwd: string;
}

export interface WorkspaceSlashCommandRow {
  name: string;
  description?: string | null;
  body: string;
  source: string;
}

export interface ListWorkspaceSlashCommandsRequest {
  cwd?: string | null;
}

export interface WorkspaceInstructionSurfacesRequest {
  cwd?: string | null;
}

export interface InstructionSurface {
  label: string;
  path: string;
  exists: boolean;
  isDirectory: boolean;
}

export interface WorkspaceInstructionSurfaces {
  workspaceRoot?: string | null;
  surfaces: InstructionSurface[];
}

export interface ConnectCdpRequest {
  autoLaunch?: boolean | null;
  basePort?: number | null;
}

export interface CdpSendPromptRequest {
  prompt: string;
  waitResponseSecs?: number | null;
}

export interface CdpConnectResult {
  ok: boolean;
  debugUrl: string;
  pageUrl: string;
  pageTitle: string;
  port?: number | null;
  launched: boolean;
  error?: string | null;
}

export interface CdpPromptResult {
  ok: boolean;
  responseText: string;
  bodyLength: number;
  error?: string | null;
}

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

export interface AgentUserQuestionNeededEvent {
  sessionId: string;
  questionId: string;
  prompt: string;
}

export interface AgentApprovalNeededEvent {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string | null;
  input: unknown;
  workspaceCwdConfigured: boolean;
}

export interface AgentTurnCompleteEvent {
  sessionId: string;
  stopReason: string;
  assistantMessage: string;
  messageCount: number;
}

export interface AgentSessionStatusEvent {
  sessionId: string;
  phase: string;
  attempt?: number | null;
  message?: string | null;
  nextRetryAtMs?: number | null;
  toolName?: string | null;
  stopReason?: string | null;
}

export interface AgentErrorEvent {
  sessionId: string;
  error: string;
  cancelled: boolean;
}

export interface AgentTextDeltaEvent {
  sessionId: string;
  text: string;
  isComplete: boolean;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "toolUse"; id: string; name: string; input: unknown }
  | { type: "toolResult"; toolUseId: string; content: string; isError: boolean };

export interface RelayMessage {
  role: string;
  content: MessageContent[];
}

export interface AgentSessionHistoryResponse {
  sessionId: string;
  running: boolean;
  messages: RelayMessage[];
}
