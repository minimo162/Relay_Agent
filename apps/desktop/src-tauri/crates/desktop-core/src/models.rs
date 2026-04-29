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
    pub action_label: Option<String>,
    pub provider_base_url: Option<String>,
    pub config_path: Option<String>,
    pub updated_at: String,
}

impl OpenWorkSetupSnapshot {
    #[must_use]
    pub fn preparing(message: impl Into<String>) -> Self {
        Self {
            status: "preparing".to_string(),
            stage: "setup".to_string(),
            message: message.into(),
            action_label: None,
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
            action_label: Some("Open OpenWork/OpenCode".to_string()),
            provider_base_url: Some(provider_base_url.into()),
            config_path: Some(config_path.into()),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[must_use]
    pub fn needs_attention(message: impl Into<String>) -> Self {
        Self {
            status: "needs_attention".to_string(),
            stage: "needs_attention".to_string(),
            message: message.into(),
            action_label: Some("Retry setup".to_string()),
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
