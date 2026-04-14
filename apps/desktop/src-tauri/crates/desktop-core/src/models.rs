use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use serde_with::skip_serializing_none;
use ts_rs::TS;

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CopilotBridgeFailureInfo {
    pub failure_class: Option<String>,
    pub stage_label: Option<String>,
    pub request_chain: Option<String>,
    pub request_attempt: Option<usize>,
    pub transport_attempt: Option<usize>,
    pub repair_replay_attempt: Option<usize>,
    pub want_new_chat: Option<bool>,
    pub new_chat_ready: Option<bool>,
    pub paste_done: Option<bool>,
    pub submit_observed: Option<bool>,
    pub network_seed_seen: Option<bool>,
    pub dom_wait_started: Option<bool>,
    pub dom_wait_finished: Option<bool>,
    pub new_chat_ready_elapsed_ms: Option<u64>,
    pub paste_elapsed_ms: Option<u64>,
    pub wait_response_elapsed_ms: Option<u64>,
    pub total_elapsed_ms: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CopilotRepairStageFailureCount {
    pub failure_class: String,
    pub count: u64,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CopilotRepairStageStats {
    pub stage_label: String,
    pub attempts: u64,
    pub success_count: u64,
    pub new_chat_ready_count: u64,
    pub paste_count: u64,
    pub submit_count: u64,
    pub network_seed_count: u64,
    pub dom_wait_started_count: u64,
    pub dom_wait_finished_count: u64,
    pub failure_counts: Vec<CopilotRepairStageFailureCount>,
    pub last_request_chain: Option<String>,
    pub last_failure_class: Option<String>,
    pub last_total_elapsed_ms: Option<u64>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayDiagnostics {
    pub app_version: String,
    pub target_os: String,
    pub copilot_node_bridge_port: u16,
    pub default_edge_cdp_port: u16,
    pub relay_agent_dev_mode: bool,
    pub architecture_notes: String,
    pub process_cwd: String,
    pub claw_config_home_display: String,
    pub max_text_file_read_bytes: u64,
    pub doctor_hints: Vec<String>,
    #[serde(default)]
    pub predictability_notes: Vec<String>,
    #[serde(default)]
    pub copilot_bridge_running: Option<bool>,
    #[serde(default)]
    pub copilot_bridge_connected: Option<bool>,
    #[serde(default)]
    pub copilot_bridge_login_required: Option<bool>,
    #[serde(default)]
    pub copilot_bridge_status_url: Option<String>,
    #[serde(default)]
    pub copilot_bridge_cdp_port: Option<u16>,
    #[serde(default)]
    pub copilot_boot_token_present: Option<bool>,
    #[serde(default)]
    pub last_copilot_bridge_failure: Option<CopilotBridgeFailureInfo>,
    #[serde(default)]
    pub copilot_repair_stage_stats: Vec<CopilotRepairStageStats>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopilotWarmupStage {
    EnsureServer,
    HealthCheck,
    BootTokenAuth,
    StatusRequest,
    CdpAttach,
    CopilotTab,
    LoginCheck,
    Ready,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopilotWarmupFailureCode {
    EnsureServerFailed,
    HealthCheckFailed,
    BootTokenUnauthorized,
    StatusHttpError,
    StatusTransportError,
    CdpAttachFailed,
    CopilotTabUnavailable,
    LoginRequired,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct CopilotWarmupResult {
    pub request_id: String,
    pub connected: bool,
    pub login_required: bool,
    pub boot_token_present: bool,
    pub cdp_port: u16,
    pub stage: CopilotWarmupStage,
    pub message: String,
    pub failure_code: Option<CopilotWarmupFailureCode>,
    pub status_code: Option<u16>,
    pub url: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelayDoctorStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDoctorCheck {
    pub id: String,
    pub status: RelayDoctorStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<JsonValue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDoctorReport {
    pub status: RelayDoctorStatus,
    pub timestamp: String,
    pub browser_settings: BrowserAutomationSettings,
    pub checks: Vec<RelayDoctorCheck>,
    pub doctor_hints: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub enum SessionPreset {
    #[default]
    Build,
    Plan,
    Explore,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    #[allow(dead_code)]
    pub auto_launch_edge: bool,
    pub timeout_ms: u32,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentRequest {
    pub goal: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub browser_settings: Option<BrowserAutomationSettings>,
    #[serde(default)]
    pub max_turns: Option<usize>,
    #[serde(default)]
    pub session_preset: SessionPreset,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContinueAgentSessionRequest {
    pub session_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RespondAgentApprovalRequest {
    pub session_id: String,
    pub approval_id: String,
    pub approved: bool,
    #[serde(default)]
    pub remember_for_session: Option<bool>,
    #[serde(default)]
    pub remember_for_workspace: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RespondUserQuestionRequest {
    pub session_id: String,
    pub question_id: String,
    pub answer: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentSessionHistoryRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionWriteUndoRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionWriteUndoStatusResponse {
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RustAnalyzerProbeRequest {
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RustAnalyzerProbeResponse {
    pub ok: bool,
    pub version_line: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPermissionSummaryRow {
    pub name: String,
    pub host_mode: String,
    pub required_mode: String,
    pub requirement: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GetPermissionSummaryRequest {
    pub session_preset: SessionPreset,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInstructionSurfacesRequest {
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub status: String,
    pub connected: bool,
    #[serde(default)]
    pub tools: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct McpAddServerRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAllowlistEntryRow {
    pub workspace_key: String,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAllowlistSnapshot {
    pub store_path: String,
    pub entries: Vec<WorkspaceAllowlistEntryRow>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAllowlistRemoveToolRequest {
    pub cwd: String,
    pub tool_name: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAllowlistCwdRequest {
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct WorkspaceSlashCommandRow {
    pub name: String,
    pub description: Option<String>,
    pub body: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceSlashCommandsRequest {
    #[serde(default)]
    pub cwd: Option<String>,
}
