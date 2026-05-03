// Generated from Rust IPC source types via ts-rs.
// Source: apps/desktop/src-tauri/src/models.rs, tauri_bridge.rs

export interface BrowserAutomationSettings {
  cdpPort: number;
  autoLaunchEdge: boolean;
  timeoutMs: number;
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

export interface OpenWorkSetupSnapshot {
  status: string;
  stage: string;
  message: string;
  progressPercent?: number | null;
  progressDetail?: string | null;
  actionLabel?: string | null;
  launchLabel?: string | null;
  providerBaseUrl?: string | null;
  configPath?: string | null;
  updatedAt: string;
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
  openworkSetup?: OpenWorkSetupSnapshot | null;
}

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
