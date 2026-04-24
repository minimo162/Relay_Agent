use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use ts_rs::TS;

pub(crate) const E_TOOL_START: &str = "agent:tool_start";
pub(crate) const E_TOOL_RESULT: &str = "agent:tool_result";
pub(crate) const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
pub(crate) const E_USER_QUESTION: &str = "agent:user_question";
pub(crate) const E_TURN_COMPLETE: &str = "agent:turn_complete";
pub(crate) const E_ERROR: &str = "agent:error";
pub(crate) const E_TEXT_DELTA: &str = "agent:text_delta";
pub(crate) const E_STATUS: &str = "agent:status";

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStartEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    #[ts(type = "unknown")]
    pub input: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResultEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserQuestionNeededEvent {
    pub session_id: String,
    pub question_id: String,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct AgentApprovalNeededEvent {
    pub session_id: String,
    pub approval_id: String,
    pub tool_name: String,
    pub description: String,
    pub target: Option<String>,
    #[ts(type = "unknown")]
    pub input: serde_json::Value,
    pub workspace_cwd_configured: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnCompleteEvent {
    pub session_id: String,
    pub stop_reason: String,
    pub assistant_message: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct AgentSessionStatusEvent {
    pub session_id: String,
    pub phase: String,
    pub attempt: Option<usize>,
    pub message: Option<String>,
    pub next_retry_at_ms: Option<u64>,
    pub tool_name: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorEvent {
    pub session_id: String,
    pub error: String,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTextDeltaEvent {
    pub session_id: String,
    pub text: String,
    pub is_complete: bool,
    #[serde(default)]
    pub replace_existing: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayMessage {
    pub role: String,
    pub content: Vec<MessageContent>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageContent {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        #[ts(type = "unknown")]
        input: serde_json::Value,
    },
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: String,
        #[serde(rename = "isError")]
        is_error: bool,
    },
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<RelayMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionPhase {
    Idle,
    Running,
    Retrying,
    Compacting,
    WaitingApproval,
    Cancelling,
}

impl AgentSessionPhase {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Retrying => "retrying",
            Self::Compacting => "compacting",
            Self::WaitingApproval => "waiting_approval",
            Self::Cancelling => "cancelling",
        }
    }
}
