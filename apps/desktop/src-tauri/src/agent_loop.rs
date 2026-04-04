use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use runtime::{
    self, PermissionPolicy, PermissionMode, PermissionPrompter,
    PermissionRequest, PermissionPromptDecision, ContentBlock,
    Session as RuntimeSession, ConversationMessage, ToolExecutor,
};

use crate::copilot_client::{CopilotApiClient, CopilotStreamEvent, PersistedSessionConfig};
use crate::error::AgentLoopError;
use crate::registry::SessionRegistry;

/* ── Event name constants ─── */

pub(crate) const E_TOOL_START: &str = "agent:tool_start";
pub(crate) const E_TOOL_RESULT: &str = "agent:tool_result";
pub(crate) const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
pub(crate) const E_TURN_COMPLETE: &str = "agent:turn_complete";
pub(crate) const E_ERROR: &str = "agent:error";
pub(crate) const E_TEXT_DELTA: &str = "agent:text_delta";

/* ── Shared resources ─── */

static SHARED_ANTHROPIC_CLIENT: std::sync::OnceLock<api::AnthropicClient> = std::sync::OnceLock::new();

/* ── POSIX shell escaping ─── */

/// POSIX-compliant shell escaping for use in `sh -c` contexts.
/// Wraps the string in single quotes, escaping embedded single quotes as `'\''`.
/// Rejects null bytes and control characters (except tab 0x09).
pub(crate) fn posix_shell_escape(s: &str) -> String {
    if s.bytes().any(|b| b == 0 || (b < 0x20 && b != 0x09) || b == 0x7F) {
        return String::from(".");
    }
    s.replace('\'', "'\\''")
}

/* ── Agent loop ─── */

pub fn run_agent_loop_impl(
    app: &AppHandle,
    registry: &SessionRegistry,
    session_id: &str,
    goal: String,
    cwd: Option<String>,
    max_turns: Option<usize>,
    cancelled: Arc<AtomicBool>,
) -> Result<(), AgentLoopError> {
    let app_for_stream = app.clone();
    let session_for_stream = session_id.to_string();
    let _shared_client = SHARED_ANTHROPIC_CLIENT.get_or_init(|| {
        api::AnthropicClient::from_auth(api::AuthSource::None).with_base_url(api::read_base_url())
    });
    let api_client = CopilotApiClient::new_with_default_settings().with_stream_callback(
        move |event| match event {
            CopilotStreamEvent::TextDelta(text) => {
                if let Err(e) = app_for_stream.emit(
                    E_TEXT_DELTA,
                    AgentTextDeltaEvent {
                        session_id: session_for_stream.clone(),
                        text,
                        is_complete: false,
                    },
                ) {
                    tracing::warn!("[RelayAgent] emit failed ({E_TEXT_DELTA}): {e}");
                }
            }
            CopilotStreamEvent::MessageStop => {
                if let Err(e) = app_for_stream.emit(
                    E_TEXT_DELTA,
                    AgentTextDeltaEvent {
                        session_id: session_for_stream.clone(),
                        text: String::new(),
                        is_complete: true,
                    },
                ) {
                    tracing::warn!("[RelayAgent] emit failed ({E_TEXT_DELTA}): {e}");
                }
            }
        },
    );
    let persistence_client = CopilotApiClient::new_with_default_settings();
    let tool_executor = build_tool_executor(app, session_id, cwd.clone());
    let permission_policy = PermissionPolicy::new(PermissionMode::Prompt);
    let system_prompt = vec![build_system_prompt(&goal)];
    // Default: 16 turns — enough for most tasks without ballooning token costs.
    let config = crate::config::AgentConfig::global();
    let max_turns = max_turns.unwrap_or(config.max_turns);

    let mut runtime_session = runtime::ConversationRuntime::new(
        RuntimeSession::new(),
        api_client,
        tool_executor,
        permission_policy,
        system_prompt,
    );
    runtime_session = runtime_session.with_max_iterations(max_turns);

    let mut prompter = TauriApprovalPrompter {
        app: app.clone(),
        session_id: session_id.to_string(),
        registry: registry.clone(),
    };

    let mut final_summary = None;

    for turn in 0..max_turns {
        if cancelled.load(Ordering::SeqCst) {
            break;
        }

        let turn_input = if turn == 0 { goal.as_str() } else { "Continue." };
        let summary = match runtime_session.run_turn(turn_input, Some(&mut prompter)) {
            Ok(summary) => summary,
            Err(error) => {
                let evt = AgentErrorEvent {
                    session_id: session_id.to_string(),
                    error: format!("agent loop failed: {error}"),
                    cancelled: false,
                };
                if let Err(e) = app.emit(E_ERROR, &evt) {
                    tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
                }
                break;
            }
        };

        // Update session state in registry without holding lock across turns
        let _ignore = registry.mutate_session(session_id, |entry| {
            entry.session = runtime_session.session().clone();
        });
        persistence_client
            .save_session(
                session_id,
                runtime_session.session(),
                PersistedSessionConfig {
                    goal: Some(goal.clone()),
                    cwd: cwd.clone(),
                    max_turns: Some(max_turns),
                },
            )
            .map_err(|error| AgentLoopError::PersistenceError(error.to_string()))?;

        let needs_more_turns = summary
            .assistant_messages
            .last()
            .is_some_and(|message| {
                message
                    .blocks
                    .iter()
                    .any(|block| matches!(block, ContentBlock::ToolUse { .. }))
            });

        final_summary = Some(summary);

        if !needs_more_turns {
            break;
        }
    }

    if let Some(summary) = final_summary {
        let last_text = summary
            .assistant_messages
            .last()
            .map(|msg| {
                msg.blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::Text { text } => Some(text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();

        if !cancelled.load(Ordering::SeqCst) {
            if let Err(e) = app.emit(
                E_TURN_COMPLETE,
                AgentTurnCompleteEvent {
                    session_id: session_id.to_string(),
                    stop_reason: "end_turn".into(),
                    assistant_message: last_text,
                    message_count: runtime_session.session().messages.len(),
                },
            ) {
                tracing::warn!("[RelayAgent] emit failed ({E_TURN_COMPLETE}): {e}");
            }
        }
    }

    let session = runtime_session.into_session();
    persistence_client
        .save_session(
            session_id,
            &session,
            PersistedSessionConfig {
                goal: Some(goal),
                cwd,
                max_turns: Some(max_turns),
            },
        )
        .map_err(|error| AgentLoopError::PersistenceError(error.to_string()))?;
    // Update final session state
    let _ignore = registry.mutate_session(session_id, |entry| {
        entry.session = session;
    });

    Ok(())
}

/* ── Approval prompter with real channel wiring ─── */
/* Fix #3: restructured to avoid nested registry + approvals lock */

pub struct TauriApprovalPrompter {
    pub app: AppHandle,
    pub session_id: String,
    pub registry: SessionRegistry,
}

impl PermissionPrompter for TauriApprovalPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        // Step 1 — check cancelled (short, independent lock)
        let cancelled = {
            match self.registry.data.lock() {
                Ok(data) => data
                    .get(&self.session_id)
                    .is_some_and(|entry| entry.cancelled.load(Ordering::SeqCst)),
                Err(e) => {
                    tracing::error!("[RelayAgent] registry lock poisoned during permission check: {e}");
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            }
        };

        if cancelled {
            return PermissionPromptDecision::Deny {
                reason: "session was cancelled".into(),
            };
        }

        let approval_id = Uuid::new_v4().to_string();

        // Build a human-readable description from input JSON
        let description = match serde_json::from_str::<serde_json::Value>(&request.input) {
            Ok(v) => {
                if let Some(path) = v.get("path").and_then(|p| p.as_str()) {
                    format!("{} on {}", request.tool_name, path)
                } else if let Some(cmd) = v.get("command").and_then(|c| c.as_str()) {
                    format!("{}: {}", request.tool_name, cmd.chars().take(60).collect::<String>())
                } else {
                    format!("{} request", request.tool_name)
                }
            }
            Err(_) => format!("{} request", request.tool_name),
        };

        // Parse input for the event
        let input_obj = serde_json::from_str(&request.input).unwrap_or(serde_json::json!({}));

        if let Err(e) = self.app.emit(
            E_APPROVAL_NEEDED,
            AgentApprovalNeededEvent {
                session_id: self.session_id.clone(),
                approval_id: approval_id.clone(),
                tool_name: request.tool_name.clone(),
                description,
                target: None,
                input: input_obj,
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_APPROVAL_NEEDED}): {e}");
        }

        // Create oneshot channel
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        {
            let mut data = match self.registry.data.lock() {
                Ok(d) => d,
                Err(e) => {
                    tracing::error!("[RelayAgent] registry lock poisoned during approval registration: {e}");
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            };
            if let Some(entry) = data.get_mut(&self.session_id) {
                let mut approvals = entry.approvals.lock().unwrap_or_else(|e| {
                    tracing::error!("[RelayAgent] approvals lock poisoned: {e}");
                    e.into_inner()
                });
                approvals.insert(approval_id.clone(), tx);
            }
            drop(data);
        }

        // Block until the user responds via respond_approval
        match rx.recv() {
            Ok(true) => PermissionPromptDecision::Allow,
            Ok(false) => PermissionPromptDecision::Deny {
                reason: "user rejected the tool execution".into(),
            },
            Err(_) => PermissionPromptDecision::Deny {
                reason: "approval channel was closed (session ended or was cancelled)".into(),
            },
        }
    }
}

/* ── Tool executor ─── */

pub fn build_tool_executor(
    app: &AppHandle,
    session_id: &str,
    cwd: Option<String>,
) -> TauriToolExecutor {
    TauriToolExecutor {
        app: app.clone(),
        session_id: session_id.to_string(),
        cwd,
    }
}

pub struct TauriToolExecutor {
    app: AppHandle,
    session_id: String,
    cwd: Option<String>,
}

impl ToolExecutor for TauriToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, runtime::ToolError> {
        let tool_use_id = Uuid::new_v4().to_string();
        if let Err(e) = self.app.emit(
            E_TOOL_START,
            AgentToolStartEvent {
                session_id: self.session_id.clone(),
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.to_string(),
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_TOOL_START}): {e}");
        }

        let mut input_value: Value =
            serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));

        // Fix #2 — prevent AI from disabling the sandbox via input JSON
        if tool_name == "bash" {
            if let Some(obj) = input_value.as_object_mut() {
                obj.remove("dangerouslyDisableSandbox");
            }
            // Fix #4 — prepend cwd to bash commands instead of mutating process-global CWD
            if let Some(ref cwd) = self.cwd {
                if let Some(cmd) = input_value.get("command").and_then(|v| v.as_str()) {
                    let escaped = posix_shell_escape(cwd);
                    let prefixed = format!("cd '{}' && ( {} )", escaped, cmd);
                    input_value["command"] = Value::String(prefixed);
                }
            }
        }

        let result =
            tools::execute_tool(tool_name, &input_value).map_err(|e| runtime::ToolError::new(e))?;

        if let Err(e) = self.app.emit(
            E_TOOL_RESULT,
            AgentToolResultEvent {
                session_id: self.session_id.clone(),
                tool_use_id,
                tool_name: tool_name.to_string(),
                content: result.clone(),
                is_error: false,
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_TOOL_RESULT}): {e}");
        }

        Ok(result)
    }
}

/* ── Helpers ─── */

pub fn msg_to_relay(msg: &ConversationMessage) -> RelayMessage {
    let content = msg
        .blocks
        .iter()
        .map(|block| match block {
            ContentBlock::Text { text } => MessageContent::Text { text: text.clone() },
            ContentBlock::ToolUse { id, name, input } => MessageContent::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({})),
            },
            ContentBlock::ToolResult {
                tool_use_id,
                output,
                is_error,
                ..
            } => MessageContent::ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: output.clone(),
                is_error: *is_error,
            },
        })
        .collect();

    let role = match msg.role {
        runtime::MessageRole::User | runtime::MessageRole::Tool => "user".to_string(),
        runtime::MessageRole::Assistant => "assistant".to_string(),
        runtime::MessageRole::System => "system".to_string(),
    };

    RelayMessage { role, content }
}

pub fn build_system_prompt(goal: &str) -> String {
    if let Some(path) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .map(|home| home.join(".relay-agent").join("SYSTEM_PROMPT.md"))
    {
        if let Ok(contents) = std::fs::read_to_string(path) {
            let custom = contents.trim();
            if !custom.is_empty() {
                return if custom.contains("{goal}") {
                    custom.replace("{goal}", goal)
                } else {
                    format!("{custom}\n\nGoal:\n{goal}")
                };
            }
        }
    }

    format!(
        concat!(
            "You are Relay Agent running inside a Tauri desktop app.\n",
            "Use only the registered tools.\n",
            "Read state first, then write only when necessary.\n\n",
            "Goal:\n{goal}\n\n",
            "Constraints:\n",
            "- Prefer read-only tools before mutating tools.\n",
            "- When modifying files, prefer saving copies."
        ),
        goal = goal,
    )
}

/* ── Event types ─── */

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStartEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResultEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalNeededEvent {
    pub session_id: String,
    pub approval_id: String,
    pub tool_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub input: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnCompleteEvent {
    pub session_id: String,
    pub stop_reason: String,
    pub assistant_message: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorEvent {
    pub session_id: String,
    pub error: String,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTextDeltaEvent {
    pub session_id: String,
    pub text: String,
    pub is_complete: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<RelayMessage>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayMessage {
    pub role: String,
    pub content: Vec<MessageContent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageContent {
    Text { text: String },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
}
