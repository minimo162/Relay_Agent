use serde::{Deserialize, Serialize};

/// Debug / support bundle fields (OpenWork-style Settings → Debug export).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDiagnostics {
    pub app_version: String,
    pub target_os: String,
    pub copilot_node_bridge_port: u16,
    pub default_edge_cdp_port: u16,
    pub relay_agent_dev_mode: bool,
    pub architecture_notes: String,
    /// Process current directory (may differ from session workspace `cwd`).
    pub process_cwd: String,
    /// Effective Claw-style config home hint (`CLAW_CONFIG_HOME` or default `~/.claw`).
    pub claw_config_home_display: String,
    /// Plain-text `read_file` byte cap (claw-style large-file guard).
    pub max_text_file_read_bytes: u64,
    /// Short preflight strings (claw `doctor`-style hints for support bundles).
    pub doctor_hints: Vec<String>,
}

/// Settings for M365 Copilot browser automation via Chrome `DevTools` Protocol.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    #[allow(dead_code)]
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
    /// When `true` with `approved`, add this tool name to the session allow-list (no further prompts for that tool this session).
    #[serde(default)]
    pub remember_for_session: Option<bool>,
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

/// Information about a registered MCP server.
#[derive(Clone, Debug, Serialize, Deserialize)]
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

/// Request to add an MCP server to the registry.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAddServerRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}
