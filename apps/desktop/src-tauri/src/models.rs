use serde::{Deserialize, Serialize};

/// Settings for M365 Copilot browser automation via Chrome DevTools Protocol.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    pub auto_launch_edge: bool,
    pub timeout_ms: u32,
}

/// Request to start a new agent session.
#[derive(Clone, Debug, Deserialize)]
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
}

/// Request to approve or reject a pending tool execution.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondAgentApprovalRequest {
    pub session_id: String,
    pub approval_id: String,
    pub approved: bool,
}

/// Request to cancel a running agent session.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentRequest {
    pub session_id: String,
}

/// Request to retrieve session message history.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentSessionHistoryRequest {
    pub session_id: String,
}
