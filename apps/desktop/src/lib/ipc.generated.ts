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

export interface RelayWorkspaceState {
  appVersion: string;
  workspacePath?: string | null;
  appLocalDataDir: string;
  documentSearchCacheDir: string;
  officeBackupDir: string;
  documentSearchAvailable: boolean;
  documentSearchMessage: string;
  officecliAvailable: boolean;
  officecliPath?: string | null;
  officecliMessage: string;
  ripgrepAvailable: boolean;
  ripgrepPath?: string | null;
}

export type RelayDocumentSearchIntent =
  | "find_files"
  | "answer_with_evidence"
  | "summarize_with_evidence"
  | "inspect_file"
  | "similar_documents";

export type RelayDocumentSearchThoroughness =
  | "quick"
  | "thorough";

export type RelayDocumentSearchEvidence =
  | "none"
  | "candidate"
  | "required";

export type RelayDocumentSearchTimeScopeIntent =
  | "latest_first"
  | "historical_examples"
  | "balanced"
  | "explicit_period"
  | "unknown";

export interface RelayDocumentSearchCoreConceptHint {
  label: string;
  directTerms: string[];
  requiredTermGroups: string[][];
  entityRiskTerms: string[];
}

export interface RelayDocumentSearchQueryPlanHints {
  schemaVersion: string;
  rawQuery: string;
  intent: RelayDocumentSearchIntent;
  evidence: RelayDocumentSearchEvidence;
  thoroughness: RelayDocumentSearchThoroughness;
  coreConcepts: RelayDocumentSearchCoreConceptHint[];
  expandedTerms: string[];
  supportTerms: string[];
  demoteTerms: string[];
  entityRiskTerms: string[];
  fileTypeHints: string[];
  timeScopeIntent?: RelayDocumentSearchTimeScopeIntent | null;
  summary?: string | null;
}

export interface RelayDocumentSearchRequest {
  query: string;
  workspacePath: string;
  intent: RelayDocumentSearchIntent;
  thoroughness: RelayDocumentSearchThoroughness;
  evidence: RelayDocumentSearchEvidence;
  maxResults: number;
  fileTypes: string[];
  queryPlanHints?: RelayDocumentSearchQueryPlanHints | null;
}

export interface RelaySearchResultCard {
  title: string;
  path: string;
  displayPath?: string | null;
  fileType?: string | null;
  modifiedTime?: string | null;
  matchMode?: string | null;
  evidenceState?: string | null;
  score?: number | null;
  bucket?: string | null;
  folderRole?: string | null;
  warnings: string[];
}

export interface RelayDocumentSearchResponse {
  ok: boolean;
  status: string;
  summary: string;
  coverageLabel: string;
  elapsedMs: number;
  cards: RelaySearchResultCard[];
  raw: unknown;
  error?: string | null;
}

export interface RelayOfficeInspectRequest {
  filePath: string;
}

export interface RelayOfficeExecuteRequest {
  filePath: string;
  officecliArgs: string;
  createBackup: boolean;
}

export interface RelayOfficeCommandResponse {
  ok: boolean;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  backupPath?: string | null;
  elapsedMs: number;
  error?: string | null;
}

export interface RelayCodeContextRequest {
  workspacePath: string;
  instruction: string;
  targetPaths: string[];
  maxFiles?: number | null;
}

export interface RelayCodeContextFile {
  relativePath: string;
  language?: string | null;
  sizeBytes: number;
  modifiedTime?: string | null;
  content: string;
  truncated: boolean;
  score: number;
  reasons: string[];
}

export interface RelayCodeContextResponse {
  ok: boolean;
  workspacePath: string;
  summary: string;
  files: RelayCodeContextFile[];
  scannedFiles: number;
  elapsedMs: number;
  error?: string | null;
}

export interface RelayCodePatchEdit {
  relativePath: string;
  oldString: string;
  newString: string;
  summary: string;
}

export interface RelayCodePatchApplyRequest {
  workspacePath: string;
  edits: RelayCodePatchEdit[];
}

export interface RelayCodePatchApplyResponse {
  ok: boolean;
  changedFiles: string[];
  diffStat: string;
  diff: string;
  elapsedMs: number;
  error?: string | null;
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
