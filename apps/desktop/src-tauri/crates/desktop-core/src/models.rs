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
pub struct OpenWorkSetupSnapshot {
    pub status: String,
    pub stage: String,
    pub message: String,
    pub progress_percent: Option<u8>,
    pub progress_detail: Option<String>,
    pub action_label: Option<String>,
    pub launch_label: Option<String>,
    pub provider_base_url: Option<String>,
    pub config_path: Option<String>,
    pub updated_at: String,
}

impl OpenWorkSetupSnapshot {
    #[must_use]
    pub fn preparing(message: impl Into<String>) -> Self {
        Self::preparing_stage("setup", message)
    }

    #[must_use]
    pub fn preparing_stage(stage: impl Into<String>, message: impl Into<String>) -> Self {
        Self::preparing_stage_progress(stage, message, None, None)
    }

    #[must_use]
    pub fn preparing_stage_progress(
        stage: impl Into<String>,
        message: impl Into<String>,
        progress_percent: Option<u8>,
        progress_detail: Option<String>,
    ) -> Self {
        Self {
            status: "preparing".to_string(),
            stage: stage.into(),
            message: message.into(),
            progress_percent: progress_percent.map(|value| value.min(100)),
            progress_detail,
            action_label: None,
            launch_label: None,
            provider_base_url: None,
            config_path: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[must_use]
    pub fn ready(
        message: impl Into<String>,
        provider_base_url: impl Into<String>,
        config_path: impl Into<String>,
    ) -> Self {
        Self {
            status: "ready".to_string(),
            stage: "ready".to_string(),
            message: message.into(),
            progress_percent: Some(100),
            progress_detail: Some("OpenCode setup is complete.".to_string()),
            action_label: Some("Open OpenCode Web".to_string()),
            launch_label: Some("Open OpenCode Web".to_string()),
            provider_base_url: Some(provider_base_url.into()),
            config_path: Some(config_path.into()),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[must_use]
    pub fn needs_attention(message: impl Into<String>) -> Self {
        Self::needs_attention_stage_progress("needs_attention", message, None, None)
    }

    #[must_use]
    pub fn needs_attention_stage_progress(
        stage: impl Into<String>,
        message: impl Into<String>,
        progress_percent: Option<u8>,
        progress_detail: Option<String>,
    ) -> Self {
        Self {
            status: "needs_attention".to_string(),
            stage: stage.into(),
            message: message.into(),
            progress_percent: progress_percent.map(|value| value.min(100)),
            progress_detail,
            action_label: Some("Retry setup".to_string()),
            launch_label: None,
            provider_base_url: None,
            config_path: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
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
    #[serde(default)]
    pub execution_backend: Option<String>,
    #[serde(default)]
    pub opencode_runtime_url: Option<String>,
    #[serde(default)]
    pub opencode_runtime_running: Option<bool>,
    #[serde(default)]
    pub opencode_runtime_message: Option<String>,
    #[serde(default)]
    pub openwork_setup: Option<OpenWorkSetupSnapshot>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayWorkspaceState {
    pub app_version: String,
    pub workspace_path: Option<String>,
    pub app_local_data_dir: String,
    pub document_search_cache_dir: String,
    pub office_backup_dir: String,
    pub document_search_available: bool,
    pub document_search_message: String,
    pub officecli_available: bool,
    pub officecli_path: Option<String>,
    pub officecli_message: String,
    pub ripgrep_available: bool,
    pub ripgrep_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RelayDocumentSearchIntent {
    FindFiles,
    AnswerWithEvidence,
    SummarizeWithEvidence,
    InspectFile,
    SimilarDocuments,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RelayDocumentSearchThoroughness {
    Quick,
    Thorough,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RelayDocumentSearchEvidence {
    None,
    Candidate,
    Required,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RelayDocumentSearchTimeScopeIntent {
    LatestFirst,
    HistoricalExamples,
    Balanced,
    ExplicitPeriod,
    Unknown,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayDocumentSearchQueryPlanHints {
    pub schema_version: String,
    pub raw_query: String,
    pub intent: RelayDocumentSearchIntent,
    pub evidence: RelayDocumentSearchEvidence,
    pub thoroughness: RelayDocumentSearchThoroughness,
    pub expanded_terms: Vec<String>,
    pub support_terms: Vec<String>,
    pub demote_terms: Vec<String>,
    pub file_type_hints: Vec<String>,
    pub time_scope_intent: Option<RelayDocumentSearchTimeScopeIntent>,
    pub summary: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayDocumentSearchRequest {
    pub query: String,
    pub workspace_path: String,
    pub intent: RelayDocumentSearchIntent,
    pub thoroughness: RelayDocumentSearchThoroughness,
    pub evidence: RelayDocumentSearchEvidence,
    pub max_results: u16,
    pub file_types: Vec<String>,
    pub query_plan_hints: Option<RelayDocumentSearchQueryPlanHints>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelaySearchResultCard {
    pub title: String,
    pub path: String,
    pub display_path: Option<String>,
    pub file_type: Option<String>,
    pub modified_time: Option<String>,
    pub match_mode: Option<String>,
    pub evidence_state: Option<String>,
    pub score: Option<f64>,
    pub bucket: Option<String>,
    pub folder_role: Option<String>,
    pub warnings: Vec<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayDocumentSearchResponse {
    pub ok: bool,
    pub status: String,
    pub summary: String,
    pub coverage_label: String,
    pub elapsed_ms: u64,
    pub cards: Vec<RelaySearchResultCard>,
    #[ts(type = "unknown")]
    pub raw: JsonValue,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayOfficeInspectRequest {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayOfficeExecuteRequest {
    pub file_path: String,
    pub officecli_args: String,
    pub create_backup: bool,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayOfficeCommandResponse {
    pub ok: bool,
    pub command: Vec<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub backup_path: Option<String>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
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

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    #[allow(dead_code)]
    pub auto_launch_edge: bool,
    pub timeout_ms: u32,
}
