// Generated from Rust IPC source types via ts-rs.
// Source: apps/desktop/src-tauri/src/models.rs, agent_projection.rs, tauri_bridge.rs

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
}

export interface ContinueAgentSessionRequest {
  sessionId: string;
  message: string;
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

export interface CopilotBridgeFailureInfo {
  failureClass?: string | null;
  stageLabel?: string | null;
  requestChain?: string | null;
  requestAttempt?: number | null;
  transportAttempt?: number | null;
  repairReplayAttempt?: number | null;
  wantNewChat?: boolean | null;
  newChatReady?: boolean | null;
  pasteDone?: boolean | null;
  submitObserved?: boolean | null;
  networkSeedSeen?: boolean | null;
  domWaitStarted?: boolean | null;
  domWaitFinished?: boolean | null;
  newChatReadyElapsedMs?: number | null;
  pasteElapsedMs?: number | null;
  waitResponseElapsedMs?: number | null;
  totalElapsedMs?: number | null;
  message?: string | null;
}

export interface CopilotRepairStageFailureCount {
  failureClass: string;
  count: number;
}

export interface CopilotRepairStageStats {
  stageLabel: string;
  attempts: number;
  successCount: number;
  newChatReadyCount: number;
  pasteCount: number;
  submitCount: number;
  networkSeedCount: number;
  domWaitStartedCount: number;
  domWaitFinishedCount: number;
  failureCounts: CopilotRepairStageFailureCount[];
  lastRequestChain?: string | null;
  lastFailureClass?: string | null;
  lastTotalElapsedMs?: number | null;
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
  copilotBridgeRunning?: boolean | null;
  copilotBridgeConnected?: boolean | null;
  copilotBridgeLoginRequired?: boolean | null;
  copilotBridgeStatusUrl?: string | null;
  copilotBridgeCdpPort?: number | null;
  copilotBootTokenPresent?: boolean | null;
  lastCopilotBridgeFailure?: CopilotBridgeFailureInfo | null;
  copilotRepairStageStats: CopilotRepairStageStats[];
  executionBackend?: string | null;
  opencodeRuntimeUrl?: string | null;
  opencodeRuntimeRunning?: boolean | null;
  opencodeRuntimeMessage?: string | null;
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
  warnings: string[];
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

export interface WorkspaceSkillRow {
  name: string;
  description?: string | null;
  body: string;
  source: string;
}

export interface ListWorkspaceSkillsRequest {
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
  input: unknown;
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
  replaceExisting: boolean;
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
