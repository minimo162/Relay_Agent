use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Debug / support bundle fields (OpenWork-style Settings → Debug export).
#[derive(Debug, Clone, Serialize, TS)]
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
    /// Short bullets explaining defaults vs Settings (OpenWork-style predictability).
    #[serde(default)]
    pub predictability_notes: Vec<String>,
}

/// OpenCode-style session posture: **Build** matches the default desktop permission ladder
/// (read tools auto, writes/shell escalate to approval). **Plan** uses a read-only host policy
/// so mutating tools are rejected without prompts—start a Build session to apply changes.
/// **Explore** is read-only like Plan but only exposes `read_file` / `glob_search` / `grep_search`
/// in the Copilot tool catalog (OpenCode-style fast codebase exploration).
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub enum SessionPreset {
    #[default]
    Build,
    Plan,
    Explore,
}

/// Settings for M365 Copilot browser automation via Chrome `DevTools` Protocol.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    #[allow(dead_code)]
    pub auto_launch_edge: bool,
    pub timeout_ms: u32,
}

/// Request to start a new agent session.
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

/// Request to approve or reject a pending tool execution.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RespondAgentApprovalRequest {
    pub session_id: String,
    pub approval_id: String,
    pub approved: bool,
    /// When `true` with `approved`, add this tool name to the session allow-list (no further prompts for that tool this session).
    #[serde(default)]
    pub remember_for_session: Option<bool>,
    /// When `true` with `approved`, persist for normalized workspace `cwd` and merge into session allow-list.
    #[serde(default)]
    pub remember_for_workspace: Option<bool>,
}

/// Answer for a pending `AskUserQuestion` tool call.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RespondUserQuestionRequest {
    pub session_id: String,
    pub question_id: String,
    pub answer: String,
}

/// Request to cancel a running agent session.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentRequest {
    pub session_id: String,
}

/// Request to retrieve session message history.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentSessionHistoryRequest {
    pub session_id: String,
}

/// Undo/redo for session write stack (same `session_id` shape as history).
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

/// Optional workspace folder for `rust-analyzer --version` probe (`docs/LSP_MILESTONE.md`).
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

/// One tool row for the desktop permission summary (Context → Policy).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPermissionSummaryRow {
    pub name: String,
    pub host_mode: String,
    pub required_mode: String,
    /// `auto_allow` | `require_approval` | `auto_deny`
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

/// Information about a registered MCP server.
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

/// Request to add an MCP server to the registry.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct McpAddServerRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// One persisted workspace → allowed tools row (`~/.relay-agent/workspace_allowed_tools.json`).
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

/// Workspace-defined slash command (`.relay/commands/*.md` or `commands.json`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSlashCommandRow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
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
