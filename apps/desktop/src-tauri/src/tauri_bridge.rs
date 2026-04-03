use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use runtime::{
    PermissionMode, PermissionPolicy, PermissionPrompter,
    PermissionRequest, PermissionPromptDecision, ContentBlock,
    Session as RuntimeSession, ConversationMessage, ToolExecutor,
};

use crate::copilot_client::{CopilotApiClient, CopilotStreamEvent, PersistedSessionConfig};
use crate::models::*;

/* ── Session registry (managed by Tauri) ─── */

/// Shared state for an active agent session.
/// The approval channel map lets respond_approval() unblock the agent loop.
pub struct SessionEntry {
    pub session: RuntimeSession,
    pub running: bool,
    pub cancelled: Arc<AtomicBool>,
    /// approval_id → oneshot Sender<bool>
    pub approvals: std::sync::Mutex<HashMap<String, std::sync::mpsc::Sender<bool>>>,
}

pub struct SessionRegistry {
    data: Arc<std::sync::Mutex<HashMap<String, SessionEntry>>>,
}

// Manual Clone: Arc is already shared, no deep clone needed
impl Clone for SessionRegistry {
    fn clone(&self) -> Self {
        Self {
            data: Arc::clone(&self.data),
        }
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            data: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }
}

/* ── Event names ─── */

const E_TOOL_START: &str = "agent:tool_start";
const E_TOOL_RESULT: &str = "agent:tool_result";
const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
const E_TURN_COMPLETE: &str = "agent:turn_complete";
const E_ERROR: &str = "agent:error";
const E_TEXT_DELTA: &str = "agent:text_delta";

/* ── Tauri commands ─── */

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    request: StartAgentRequest,
) -> Result<String, String> {
    let goal = request.goal.trim().to_string();
    if goal.is_empty() {
        return Err("goal must not be empty".into());
    }

    let session_id = format!("session-{}", Uuid::new_v4());

    let entry = SessionEntry {
        session: RuntimeSession::new(),
        running: true,
        cancelled: Arc::new(AtomicBool::new(false)),
        approvals: std::sync::Mutex::new(HashMap::new()),
    };
    let cancelled = Arc::clone(&entry.cancelled);
    registry
        .data
        .lock()
        .expect("registry poisoned")
        .insert(session_id.clone(), entry);

    let app_for_task = app.clone();
    let sid_for_task = session_id.clone();
    let reg_for_task = registry.inner().clone();

    std::thread::spawn(move || {
        let result = run_agent_loop_impl(
            &app_for_task,
            &reg_for_task,
            &sid_for_task,
            goal,
            request.cwd,
            request.max_turns,
            cancelled,
        );

        if let Err(err) = result {
            let _ = app_for_task.emit(
                E_ERROR,
                AgentErrorEvent {
                    session_id: sid_for_task.clone(),
                    error: err,
                    cancelled: false,
                },
            );
        }

        if let Ok(mut data) = reg_for_task.data.lock() {
            if let Some(entry) = data.get_mut(&sid_for_task) {
                entry.running = false;
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn respond_approval(
    _app: AppHandle,
    registry: State<'_, SessionRegistry>,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    let data = registry.data.lock().expect("registry poisoned");
    let entry = data
        .get(&request.session_id)
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;

    let tx = entry
        .approvals
        .lock()
        .expect("approvals mutex poisoned")
        .remove(&request.approval_id)
        .ok_or_else(|| format!("approval `{}` not pending", request.approval_id))?;

    drop(data);

    tx.send(request.approved)
        .map_err(|_| "approval channel closed — session may have ended".into())
}

#[tauri::command]
pub async fn cancel_agent(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    request: CancelAgentRequest,
) -> Result<(), String> {
    if let Ok(mut data) = registry.data.lock() {
        if let Some(entry) = data.get_mut(&request.session_id) {
            entry.cancelled.store(true, Ordering::SeqCst);
            entry.running = false;
            // Cancel all pending approvals
            for (_, tx) in entry.approvals.lock().expect("poisoned").drain() {
                let _ = tx.send(false);
            }
        }
    }

    let _ = app.emit(
        E_ERROR,
        AgentErrorEvent {
            session_id: request.session_id,
            error: "agent session was cancelled".into(),
            cancelled: true,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn get_session_history(
    registry: State<'_, SessionRegistry>,
    request: GetAgentSessionHistoryRequest,
) -> Result<AgentSessionHistoryResponse, String> {
    let maybe_loaded = {
        let data = registry.data.lock().expect("registry poisoned");
        data.get(&request.session_id).map(|entry| {
            let running = entry.running && !entry.cancelled.load(Ordering::SeqCst);
            let messages = entry.session.messages.iter().map(msg_to_relay).collect();
            AgentSessionHistoryResponse {
                session_id: request.session_id.clone(),
                running,
                messages,
            }
        })
    };

    if let Some(history) = maybe_loaded {
        return Ok(history);
    }

    let api_client = CopilotApiClient::new_with_default_settings();
    let loaded = api_client
        .load_session(&request.session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;
    let messages = loaded.session.messages.iter().map(msg_to_relay).collect();

    Ok(AgentSessionHistoryResponse {
        session_id: request.session_id,
        running: false,
        messages,
    })
}

/* ── Agent loop ─── */

fn run_agent_loop_impl(
    app: &AppHandle,
    registry: &SessionRegistry,
    session_id: &str,
    goal: String,
    cwd: Option<String>,
    max_turns: Option<usize>,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    let original_cwd = std::env::current_dir().ok();
    if let Some(path) = cwd.as_deref() {
        std::env::set_current_dir(path)
            .map_err(|error| format!("failed to set working directory to `{path}`: {error}"))?;
    }

    let app_for_stream = app.clone();
    let session_for_stream = session_id.to_string();
    let api_client = CopilotApiClient::new_with_default_settings().with_stream_callback(
        move |event| match event {
            CopilotStreamEvent::TextDelta(text) => {
                let _ = app_for_stream.emit(
                    E_TEXT_DELTA,
                    AgentTextDeltaEvent {
                        session_id: session_for_stream.clone(),
                        text,
                        is_complete: false,
                    },
                );
            }
            CopilotStreamEvent::MessageStop => {
                let _ = app_for_stream.emit(
                    E_TEXT_DELTA,
                    AgentTextDeltaEvent {
                        session_id: session_for_stream.clone(),
                        text: String::new(),
                        is_complete: true,
                    },
                );
            }
        },
    );
    let persistence_client = CopilotApiClient::new_with_default_settings();
    let tool_executor = build_tool_executor(app, session_id);
    let permission_policy = PermissionPolicy::new(PermissionMode::Prompt);
    let system_prompt = vec![build_system_prompt(&goal)];
    let max_turns = max_turns.unwrap_or(32);

    let mut runtime = runtime::ConversationRuntime::new(
        RuntimeSession::new(),
        api_client,
        tool_executor,
        permission_policy,
        system_prompt,
    );
    runtime = runtime.with_max_iterations(max_turns);

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
        let summary = match runtime.run_turn(turn_input, Some(&mut prompter)) {
            Ok(summary) => summary,
            Err(error) => {
                let _ = app.emit(
                    E_ERROR,
                    AgentErrorEvent {
                        session_id: session_id.to_string(),
                        error: format!("agent loop failed: {error}"),
                        cancelled: false,
                    },
                );
                break;
            }
        };

        if let Ok(mut data) = registry.data.lock() {
            if let Some(entry) = data.get_mut(session_id) {
                entry.session = runtime.session().clone();
            }
        }
        persistence_client
            .save_session(
                session_id,
                runtime.session(),
                PersistedSessionConfig {
                    goal: Some(goal.clone()),
                    cwd: cwd.clone(),
                    max_turns: Some(max_turns),
                },
            )
            .map_err(|error| error.to_string())?;

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
            let _ = app.emit(
                E_TURN_COMPLETE,
                AgentTurnCompleteEvent {
                    session_id: session_id.to_string(),
                    stop_reason: "end_turn".into(),
                    assistant_message: last_text,
                    message_count: runtime.session().messages.len(),
                },
            );
        }
    }

    let session = runtime.into_session();
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
        .map_err(|error| error.to_string())?;
    if let Ok(mut data) = registry.data.lock() {
        if let Some(entry) = data.get_mut(session_id) {
            entry.session = session;
        }
    }

    if let Some(path) = original_cwd {
        let _ = std::env::set_current_dir(path);
    }

    Ok(())
}

/* ── Approval prompter with real channel wiring ─── */

struct TauriApprovalPrompter {
    app: AppHandle,
    session_id: String,
    registry: SessionRegistry,
}

impl PermissionPrompter for TauriApprovalPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        if self
            .registry
            .data
            .lock()
            .expect("registry poisoned")
            .get(&self.session_id)
            .is_some_and(|entry| entry.cancelled.load(Ordering::SeqCst))
        {
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

        let _ = self.app.emit(
            E_APPROVAL_NEEDED,
            AgentApprovalNeededEvent {
                session_id: self.session_id.clone(),
                approval_id: approval_id.clone(),
                tool_name: request.tool_name.clone(),
                description,
                target: None,
                input: input_obj,
            },
        );

        // Create oneshot channel
        let (tx, rx) = std::sync::mpsc::channel::<bool>();

        // Register it in the session entry
        {
            let data = self.registry.data.lock().expect("registry poisoned");
            if let Some(entry) = data.get(&self.session_id) {
                let mut approvals = entry.approvals.lock().expect("approvals poisoned");
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

fn build_tool_executor(app: &AppHandle, session_id: &str) -> TauriToolExecutor {
    TauriToolExecutor {
        app: app.clone(),
        session_id: session_id.to_string(),
    }
}

struct TauriToolExecutor {
    app: AppHandle,
    session_id: String,
}

impl ToolExecutor for TauriToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, runtime::ToolError> {
        let tool_use_id = Uuid::new_v4().to_string();
        let _ = self.app.emit(
            E_TOOL_START,
            AgentToolStartEvent {
                session_id: self.session_id.clone(),
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.to_string(),
            },
        );

        let input_value: Value =
            serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));
        let result =
            tools::execute_tool(tool_name, &input_value).map_err(|e| runtime::ToolError::new(e))?;

        let _ = self.app.emit(
            E_TOOL_RESULT,
            AgentToolResultEvent {
                session_id: self.session_id.clone(),
                tool_use_id,
                tool_name: tool_name.to_string(),
                content: result.clone(),
                is_error: false,
            },
        );

        Ok(result)
    }
}

/* ── Helpers ─── */

fn msg_to_relay(msg: &ConversationMessage) -> RelayMessage {
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

fn build_system_prompt(goal: &str) -> String {
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
