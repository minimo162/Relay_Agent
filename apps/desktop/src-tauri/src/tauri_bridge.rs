use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use async_trait::async_trait;
use claw_compact::TokenBudget;
use claw_core::{AgentError, ContentBlock, Message, Role, SessionConfig, SessionState};
use claw_permissions::{
    PermissionDecision, PermissionMode, PermissionPolicy, PermissionRequest, ResourceKind,
};
use claw_provider::{ModelProvider, ModelRequest, ResponseContent, StopReason};
use claw_tools::{ToolContext, ToolOutput, ToolRegistry};
use serde::Serialize;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, State};
use tokio::sync::{oneshot, Notify};
use uuid::Uuid;

use crate::{
    copilot_provider::CopilotChatProvider,
    models::{
        AddInboxFileRequest, BrowserAutomationSettings, CancelAgentRequest, CreateSessionRequest,
        GetAgentSessionHistoryRequest, RelayMode, RespondAgentApprovalRequest, StartAgentRequest,
        StartTurnRequest,
    },
    risk_evaluator::{evaluate_risk, should_auto_approve, ApprovalPolicy, OperationRisk},
    state::DesktopState,
};

const EVENT_TOOL_START: &str = "agent:tool_start";
const EVENT_TOOL_RESULT: &str = "agent:tool_result";
const EVENT_APPROVAL_NEEDED: &str = "agent:approval_needed";
const EVENT_TURN_COMPLETE: &str = "agent:turn_complete";
const EVENT_ERROR: &str = "agent:error";
const DEFAULT_AGENT_MAX_TURNS: usize = 12;

type AgentEventEmitter = Arc<dyn Fn(AgentBridgeEvent) + Send + Sync>;

pub struct AgentRuntimeState {
    sessions: Mutex<HashMap<String, Arc<AgentSessionRuntime>>>,
}

impl AgentRuntimeState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create_session(&self, session_id: String) -> Arc<AgentSessionRuntime> {
        let session = Arc::new(AgentSessionRuntime::new());
        self.sessions
            .lock()
            .expect("agent runtime mutex poisoned")
            .insert(session_id, Arc::clone(&session));
        session
    }

    pub fn get_session(&self, session_id: &str) -> Option<Arc<AgentSessionRuntime>> {
        self.sessions
            .lock()
            .expect("agent runtime mutex poisoned")
            .get(session_id)
            .cloned()
    }

    pub fn pending_approval_ids(&self, session_id: &str) -> Vec<String> {
        self.get_session(session_id)
            .map(|session| session.pending_approval_ids())
            .unwrap_or_default()
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions
            .lock()
            .expect("agent runtime mutex poisoned")
            .remove(session_id);
    }
}

impl Default for AgentRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AgentSessionRuntime {
    pending_approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    running: AtomicBool,
    cancelled: AtomicBool,
    cancel_notify: Notify,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl AgentSessionRuntime {
    fn new() -> Self {
        Self {
            pending_approvals: Mutex::new(HashMap::new()),
            running: AtomicBool::new(true),
            cancelled: AtomicBool::new(false),
            cancel_notify: Notify::new(),
            task: Mutex::new(None),
        }
    }

    fn set_task(&self, task: JoinHandle<()>) {
        *self.task.lock().expect("agent task mutex poisoned") = Some(task);
    }

    fn register_approval(&self, approval_id: String, sender: oneshot::Sender<bool>) {
        self.pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .insert(approval_id, sender);
    }

    fn pending_approval_ids(&self) -> Vec<String> {
        self.pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .keys()
            .cloned()
            .collect()
    }

    fn resolve_approval(&self, approval_id: &str, approved: bool) -> Result<(), String> {
        let sender = self
            .pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .remove(approval_id)
            .ok_or_else(|| format!("approval `{approval_id}` is not pending"))?;
        sender
            .send(approved)
            .map_err(|_| format!("approval `{approval_id}` could not be delivered"))
    }

    fn drop_approval(&self, approval_id: &str) {
        self.pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .remove(approval_id);
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
        self.cancel_notify.notify_waiters();

        let approvals = self
            .pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .drain()
            .collect::<Vec<_>>();
        for (_, sender) in approvals {
            let _ = sender.send(false);
        }

        if let Some(task) = self.task.lock().expect("agent task mutex poisoned").take() {
            task.abort();
        }
    }

    fn finish(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.pending_approvals
            .lock()
            .expect("agent approvals mutex poisoned")
            .clear();
        self.task.lock().expect("agent task mutex poisoned").take();
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
struct BridgePermissionPolicy {
    session_id: String,
    runtime: Arc<AgentSessionRuntime>,
    emit: AgentEventEmitter,
    tool_input: serde_json::Value,
    approval_policy: ApprovalPolicy,
}

#[async_trait]
impl PermissionPolicy for BridgePermissionPolicy {
    async fn check(&self, request: &PermissionRequest) -> PermissionDecision {
        if self.runtime.is_cancelled() {
            return PermissionDecision::Deny {
                reason: "agent session was cancelled".to_string(),
            };
        }

        if let Some(decision) =
            permission_decision_without_prompt(self.approval_policy, request, &self.tool_input)
        {
            return decision;
        }

        let approval_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.runtime.register_approval(approval_id.clone(), sender);

        (self.emit)(AgentBridgeEvent::ApprovalNeeded(AgentApprovalNeededEvent {
            session_id: self.session_id.clone(),
            approval_id: approval_id.clone(),
            tool_name: request.tool_name.clone(),
            description: request.description.clone(),
            target: request.target.clone(),
            input: self.tool_input.clone(),
        }));

        tokio::select! {
            decision = receiver => match decision {
                Ok(true) => PermissionDecision::Allow,
                Ok(false) => PermissionDecision::Deny {
                    reason: "user rejected the requested tool execution".to_string(),
                },
                Err(_) => PermissionDecision::Deny {
                    reason: "approval channel closed before a response was received".to_string(),
                },
            },
            _ = self.runtime.cancel_notify.notified() => {
                self.runtime.drop_approval(&approval_id);
                PermissionDecision::Deny {
                    reason: "agent session was cancelled".to_string(),
                }
            }
        }
    }
}

fn permission_decision_without_prompt(
    approval_policy: ApprovalPolicy,
    request: &PermissionRequest,
    tool_input: &serde_json::Value,
) -> Option<PermissionDecision> {
    if matches!(request.resource, ResourceKind::ShellExec) {
        return None;
    }

    let risk = evaluate_risk(&request.tool_name, tool_input);
    if matches!(risk, OperationRisk::Readonly) || should_auto_approve(approval_policy, risk) {
        return Some(PermissionDecision::Allow);
    }

    None
}

enum AgentBridgeEvent {
    ToolStart(AgentToolStartEvent),
    ToolResult(AgentToolResultEvent),
    ApprovalNeeded(AgentApprovalNeededEvent),
    TurnComplete(AgentTurnCompleteEvent),
    Error(AgentErrorEvent),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolStartEvent {
    session_id: String,
    tool_use_id: String,
    tool_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolResultEvent {
    session_id: String,
    tool_use_id: String,
    tool_name: String,
    content: String,
    is_error: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentApprovalNeededEvent {
    session_id: String,
    approval_id: String,
    tool_name: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    input: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnCompleteEvent {
    session_id: String,
    stop_reason: String,
    assistant_message: String,
    message_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentErrorEvent {
    session_id: String,
    error: String,
    cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<Message>,
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: StartAgentRequest,
) -> Result<String, String> {
    let provider: Arc<dyn ModelProvider> =
        Arc::new(provider_from_settings(request.browser_settings.clone()));
    start_agent_with_provider(app, state.inner(), request, provider)
}

pub(crate) fn start_agent_with_provider(
    app: AppHandle,
    state: &DesktopState,
    request: StartAgentRequest,
    provider: Arc<dyn ModelProvider>,
) -> Result<String, String> {
    start_agent_impl(state, request, provider, tauri_event_emitter(app.clone()))
}

fn start_agent_impl(
    state: &DesktopState,
    request: StartAgentRequest,
    provider: Arc<dyn ModelProvider>,
    emit: AgentEventEmitter,
) -> Result<String, String> {
    let goal = request.goal.trim();
    if goal.is_empty() {
        return Err("goal must not be empty".to_string());
    }

    let cwd = resolve_agent_cwd(request.cwd.as_deref(), &request.files)?;
    let session_metadata = create_backing_agent_session(state, goal, &request.files)?;
    let approval_policy = *state
        .approval_policy
        .lock()
        .expect("approval policy poisoned");
    let session_files = {
        let storage = state.storage.lock().expect("desktop storage poisoned");
        storage
            .read_session_model(&session_metadata.session_id)?
            .inbox_files
            .into_iter()
            .map(|file| file.path)
            .collect::<Vec<_>>()
    };
    let registry = Arc::clone(&state.claw_tool_registry);
    let storage = Arc::clone(&state.storage);
    let max_turns = request.max_turns.unwrap_or(DEFAULT_AGENT_MAX_TURNS);

    let mut session = SessionState::new(
        SessionConfig {
            model: "copilot-chat".to_string(),
            system_prompt: build_agent_system_prompt(&session_files),
            max_turns,
            token_budget: TokenBudget::default(),
            permission_mode: PermissionMode::Interactive,
        },
        cwd,
    );
    session.id = session_metadata.session_id.clone();
    session.push_message(Message::user(build_agent_goal_prompt(goal, &session_files)));
    {
        let mut storage = storage.lock().expect("desktop storage poisoned");
        storage.sync_session_messages(&session.id, session.messages.clone())?;
    }

    let session_id = session.id.clone();
    let runtime = state.agent_runtime.create_session(session_id.clone());
    let runtime_for_task = Arc::clone(&runtime);
    let session_id_for_task = session_id.clone();
    let agent_runtime = Arc::clone(&state.agent_runtime);

    let task = tauri::async_runtime::spawn(async move {
        let result = run_agent_session_loop(
            session,
            provider,
            registry,
            Arc::clone(&storage),
            Arc::clone(&runtime_for_task),
            approval_policy,
            Arc::clone(&emit),
        )
        .await;

        if let Err(error) = result {
            let cancelled = matches!(error, AgentError::Aborted) && runtime_for_task.is_cancelled();
            if !cancelled {
                emit(AgentBridgeEvent::Error(AgentErrorEvent {
                    session_id: session_id_for_task.clone(),
                    error: error.to_string(),
                    cancelled: false,
                }));
            }
        }

        runtime_for_task.finish();
        agent_runtime.remove_session(&session_id_for_task);
    });
    runtime.set_task(task);

    Ok(session_id)
}

#[tauri::command]
pub async fn respond_approval(
    state: State<'_, DesktopState>,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    let session = state
        .agent_runtime
        .get_session(&request.session_id)
        .ok_or_else(|| format!("agent session `{}` was not found", request.session_id))?;
    session.resolve_approval(&request.approval_id, request.approved)
}

#[tauri::command]
pub async fn cancel_agent(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: CancelAgentRequest,
) -> Result<(), String> {
    let session = state
        .agent_runtime
        .get_session(&request.session_id)
        .ok_or_else(|| format!("agent session `{}` was not found", request.session_id))?;
    session.cancel();
    let _ = app.emit(
        EVENT_ERROR,
        AgentErrorEvent {
            session_id: request.session_id,
            error: "agent session was cancelled".to_string(),
            cancelled: true,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn get_session_history(
    state: State<'_, DesktopState>,
    request: GetAgentSessionHistoryRequest,
) -> Result<AgentSessionHistoryResponse, String> {
    let running = state
        .agent_runtime
        .get_session(&request.session_id)
        .map(|session| session.is_running())
        .unwrap_or(false);
    let storage = state.storage.lock().expect("desktop storage poisoned");
    Ok(AgentSessionHistoryResponse {
        session_id: request.session_id.clone(),
        running,
        messages: storage.read_session_messages(&request.session_id)?,
    })
}

async fn run_agent_session_loop(
    mut session: SessionState,
    provider: Arc<dyn ModelProvider>,
    registry: Arc<ToolRegistry>,
    storage: Arc<Mutex<crate::storage::AppStorage>>,
    runtime: Arc<AgentSessionRuntime>,
    approval_policy: ApprovalPolicy,
    emit: AgentEventEmitter,
) -> Result<(), AgentError> {
    loop {
        if runtime.is_cancelled() {
            return Err(AgentError::Aborted);
        }

        if session.turn_count >= session.config.max_turns {
            return Err(AgentError::MaxTurnsExceeded(session.config.max_turns));
        }
        session.turn_count += 1;

        let response = provider
            .complete(ModelRequest {
                model: session.config.model.clone(),
                system: (!session.config.system_prompt.trim().is_empty())
                    .then_some(session.config.system_prompt.clone()),
                messages: session.to_request_messages(),
                max_tokens: session.config.token_budget.max_output_tokens,
                tools: Some(registry.tool_definitions()),
                temperature: None,
            })
            .await
            .map_err(AgentError::Provider)?;

        session.total_input_tokens += response.usage.input_tokens;
        session.total_output_tokens += response.usage.output_tokens;
        session.total_cache_creation_tokens +=
            response.usage.cache_creation_input_tokens.unwrap_or(0);
        session.total_cache_read_tokens += response.usage.cache_read_input_tokens.unwrap_or(0);
        session.last_input_tokens = response.usage.input_tokens;

        let stop_reason = response.stop_reason.clone().unwrap_or(StopReason::EndTurn);
        let mut assistant_content = Vec::new();
        let mut assistant_text = String::new();
        let mut tool_calls = Vec::new();

        for content in response.content {
            match content {
                ResponseContent::Text(text) => {
                    assistant_text.push_str(&text);
                    assistant_content.push(ContentBlock::Text { text });
                }
                ResponseContent::ToolUse { id, name, input } => {
                    assistant_content.push(ContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    });
                    tool_calls.push((id, name, input));
                }
            }
        }

        session.push_message(Message {
            role: Role::Assistant,
            content: assistant_content,
        });
        sync_storage_history(&storage, &session);

        if tool_calls.is_empty() {
            if stop_reason == StopReason::MaxTokens {
                session.push_message(Message::user("Please continue from where you left off."));
                sync_storage_history(&storage, &session);
                continue;
            }

            emit(AgentBridgeEvent::TurnComplete(AgentTurnCompleteEvent {
                session_id: session.id.clone(),
                stop_reason: format!("{stop_reason:?}"),
                assistant_message: assistant_text,
                message_count: session.messages.len(),
            }));
            return Ok(());
        }

        let mut result_blocks = Vec::new();
        for (tool_use_id, tool_name, tool_input) in tool_calls {
            if runtime.is_cancelled() {
                return Err(AgentError::Aborted);
            }

            emit(AgentBridgeEvent::ToolStart(AgentToolStartEvent {
                session_id: session.id.clone(),
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.clone(),
            }));

            let output = execute_tool_call(
                &session,
                Arc::clone(&registry),
                Arc::clone(&runtime),
                approval_policy,
                Arc::clone(&emit),
                &tool_name,
                tool_input.clone(),
            )
            .await;

            emit(AgentBridgeEvent::ToolResult(AgentToolResultEvent {
                session_id: session.id.clone(),
                tool_use_id: tool_use_id.clone(),
                tool_name,
                content: output.content.clone(),
                is_error: output.is_error,
            }));

            result_blocks.push(ContentBlock::ToolResult {
                tool_use_id,
                content: output.content,
                is_error: output.is_error,
            });
        }

        session.push_message(Message {
            role: Role::User,
            content: result_blocks,
        });
        sync_storage_history(&storage, &session);
    }
}

fn sync_storage_history(storage: &Arc<Mutex<crate::storage::AppStorage>>, session: &SessionState) {
    if let Ok(mut storage) = storage.lock() {
        let _ = storage.sync_session_messages(&session.id, session.messages.clone());
    }
}

async fn execute_tool_call(
    session: &SessionState,
    registry: Arc<ToolRegistry>,
    runtime: Arc<AgentSessionRuntime>,
    approval_policy: ApprovalPolicy,
    emit: AgentEventEmitter,
    tool_name: &str,
    tool_input: serde_json::Value,
) -> ToolOutput {
    let Some(tool) = registry.get(tool_name) else {
        return ToolOutput::error(format!("unknown tool: {tool_name}"));
    };

    if !tool.is_read_only() {
        let request = PermissionRequest {
            tool_name: tool_name.to_string(),
            resource: permission_resource_for_tool(tool_name),
            description: format!("execute tool {tool_name}"),
            target: permission_target_for_tool(tool_name, &tool_input),
        };
        let policy: Arc<dyn PermissionPolicy> = Arc::new(BridgePermissionPolicy {
            session_id: session.id.clone(),
            runtime: Arc::clone(&runtime),
            emit: Arc::clone(&emit),
            tool_input: tool_input.clone(),
            approval_policy,
        });
        match policy.check(&request).await {
            PermissionDecision::Allow => {}
            PermissionDecision::Deny { reason } => {
                return ToolOutput::error(format!("permission denied: {reason}"));
            }
            PermissionDecision::Ask { message } => {
                return ToolOutput::error(format!("permission required: {message}"));
            }
        }
    }

    let ctx = ToolContext {
        cwd: session.cwd.clone(),
        permissions: Arc::new(BridgePermissionPolicy {
            session_id: session.id.clone(),
            runtime: Arc::clone(&runtime),
            emit: Arc::clone(&emit),
            tool_input: tool_input.clone(),
            approval_policy,
        }),
        session_id: session.id.clone(),
    };

    match tool.execute(&ctx, tool_input).await {
        Ok(output) => output,
        Err(error) => ToolOutput::error(format!("tool execution failed: {error}")),
    }
}

fn permission_resource_for_tool(tool_name: &str) -> ResourceKind {
    match tool_name {
        "bash" => ResourceKind::ShellExec,
        "file_write" | "file_edit" => ResourceKind::FileWrite,
        _ => ResourceKind::Custom(tool_name.to_string()),
    }
}

fn permission_target_for_tool(tool_name: &str, input: &serde_json::Value) -> Option<String> {
    match tool_name {
        "bash" => input
            .get("command")
            .or_else(|| input.get("cmd"))
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned),
        _ => input
            .get("path")
            .or_else(|| input.get("outputPath"))
            .or_else(|| input.get("output_path"))
            .or_else(|| input.get("destination"))
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned),
    }
}

fn resolve_agent_cwd(cwd: Option<&str>, files: &[String]) -> Result<PathBuf, String> {
    if let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(cwd));
    }

    if let Some(first_file) = files.first() {
        let path = Path::new(first_file);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    std::env::current_dir().map_err(|error| error.to_string())
}

fn provider_from_settings(settings: Option<BrowserAutomationSettings>) -> CopilotChatProvider {
    match settings {
        Some(settings) => CopilotChatProvider::new(settings),
        None => CopilotChatProvider::with_default_settings(),
    }
}

struct BackingAgentSession {
    session_id: String,
    #[allow(dead_code)]
    turn_id: String,
}

fn create_backing_agent_session(
    state: &DesktopState,
    goal: &str,
    files: &[String],
) -> Result<BackingAgentSession, String> {
    let title = goal
        .trim()
        .chars()
        .take(80)
        .collect::<String>()
        .trim()
        .to_string();
    let primary_workbook_path = files.first().cloned();

    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    let session = storage.create_session(CreateSessionRequest {
        title: if title.is_empty() {
            "Agent session".to_string()
        } else {
            title.clone()
        },
        objective: goal.to_string(),
        primary_workbook_path,
    })?;
    for file in files {
        storage.add_inbox_file(AddInboxFileRequest {
            session_id: session.id.clone(),
            path: file.clone(),
        })?;
    }
    let turn = storage.start_turn(StartTurnRequest {
        session_id: session.id.clone(),
        title: if title.is_empty() {
            "Agent turn".to_string()
        } else {
            title
        },
        objective: goal.to_string(),
        mode: RelayMode::Plan,
    })?;

    Ok(BackingAgentSession {
        session_id: session.id,
        turn_id: turn.turn.id,
    })
}

fn build_agent_goal_prompt(goal: &str, files: &[String]) -> String {
    let file_lines = if files.is_empty() {
        "Files:\n- none provided".to_string()
    } else {
        format!(
            "Files:\n{}",
            files
                .iter()
                .map(|file| format!("- {file}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    format!(
        concat!(
            "Goal:\n{goal}\n\n",
            "{file_lines}\n\n",
            "Constraints:\n",
            "- Prefer read-only tools before mutating tools.\n",
            "- Treat original workbook inputs as read-only.\n",
            "- Use save-copy outputs for any file modifications.\n"
        ),
        goal = goal,
        file_lines = file_lines,
    )
}

fn build_agent_system_prompt(files: &[String]) -> String {
    let file_context = if files.is_empty() {
        "No initial file list was supplied.".to_string()
    } else {
        format!("Initial files:\n{}", files.join("\n"))
    };

    format!(
        concat!(
            "You are Relay Agent running inside a Tauri desktop app.\n",
            "Use only the registered tools.\n",
            "Read state first, then write only when necessary.\n",
            "Original workbook inputs are read-only and all modifications must go to save-copy outputs.\n\n",
            "{file_context}"
        ),
        file_context = file_context
    )
}

fn tauri_event_emitter(app: AppHandle) -> AgentEventEmitter {
    Arc::new(move |event| match event {
        AgentBridgeEvent::ToolStart(payload) => {
            let _ = app.emit(EVENT_TOOL_START, payload);
        }
        AgentBridgeEvent::ToolResult(payload) => {
            let _ = app.emit(EVENT_TOOL_RESULT, payload);
        }
        AgentBridgeEvent::ApprovalNeeded(payload) => {
            let _ = app.emit(EVENT_APPROVAL_NEEDED, payload);
        }
        AgentBridgeEvent::TurnComplete(payload) => {
            let _ = app.emit(EVENT_TURN_COMPLETE, payload);
        }
        AgentBridgeEvent::Error(payload) => {
            let _ = app.emit(EVENT_ERROR, payload);
        }
    })
}

#[cfg(test)]
mod tests {
    use std::{pin::Pin, sync::Mutex as StdMutex};

    use anyhow::{anyhow, Result};
    use futures::{stream, Stream};
    use serde_json::json;
    use tokio::{
        sync::mpsc,
        time::{timeout, Duration},
    };

    use super::*;
    use claw_provider::{ModelResponse, StreamEvent, Usage};
    use claw_tools::Tool;

    #[derive(Clone)]
    struct SequenceProvider {
        responses: Arc<StdMutex<Vec<ModelResponse>>>,
    }

    #[async_trait]
    impl ModelProvider for SequenceProvider {
        async fn complete(&self, _request: ModelRequest) -> Result<ModelResponse> {
            let mut responses = self
                .responses
                .lock()
                .expect("provider responses mutex poisoned");
            if responses.is_empty() {
                return Err(anyhow!("sequence provider ran out of responses"));
            }
            Ok(responses.remove(0))
        }

        async fn stream(
            &self,
            _request: ModelRequest,
        ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
            Ok(Box::pin(stream::empty()))
        }

        fn name(&self) -> &str {
            "sequence-provider"
        }
    }

    struct ReadTool;

    #[async_trait]
    impl Tool for ReadTool {
        fn name(&self) -> &str {
            "read_tool"
        }

        fn description(&self) -> &str {
            "Read-only test tool."
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({"type": "object"})
        }

        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> anyhow::Result<ToolOutput> {
            Ok(ToolOutput::success("read ok"))
        }

        fn is_read_only(&self) -> bool {
            true
        }
    }

    struct WriteTool;

    #[async_trait]
    impl Tool for WriteTool {
        fn name(&self) -> &str {
            "write_tool"
        }

        fn description(&self) -> &str {
            "Mutating test tool."
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({"type": "object"})
        }

        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> anyhow::Result<ToolOutput> {
            Ok(ToolOutput::success("write ok"))
        }

        fn is_read_only(&self) -> bool {
            false
        }
    }

    struct SaveCopyTool;

    #[async_trait]
    impl Tool for SaveCopyTool {
        fn name(&self) -> &str {
            "workbook.save_copy"
        }

        fn description(&self) -> &str {
            "Medium-risk save-copy test tool."
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({"type": "object"})
        }

        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> anyhow::Result<ToolOutput> {
            Ok(ToolOutput::success("save copy ok"))
        }

        fn is_read_only(&self) -> bool {
            false
        }
    }

    fn test_response(content: Vec<ResponseContent>, stop_reason: StopReason) -> ModelResponse {
        ModelResponse {
            id: Uuid::new_v4().to_string(),
            content,
            stop_reason: Some(stop_reason),
            usage: Usage::default(),
        }
    }

    fn test_session(goal: &str) -> SessionState {
        let mut session = SessionState::new(
            SessionConfig {
                model: "test".to_string(),
                system_prompt: "test".to_string(),
                max_turns: 4,
                token_budget: TokenBudget::default(),
                permission_mode: PermissionMode::Interactive,
            },
            std::env::temp_dir(),
        );
        session.push_message(Message::user(goal));
        session
    }

    #[tokio::test]
    async fn agent_loop_emits_tool_events_and_records_history() {
        let provider = Arc::new(SequenceProvider {
            responses: Arc::new(StdMutex::new(vec![
                test_response(
                    vec![ResponseContent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "read_tool".to_string(),
                        input: json!({}),
                    }],
                    StopReason::ToolUse,
                ),
                test_response(
                    vec![ResponseContent::Text("done".to_string())],
                    StopReason::EndTurn,
                ),
            ])),
        });
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(ReadTool));
        let registry = Arc::new(registry);
        let mut session = test_session("run read tool");
        let storage = Arc::new(Mutex::new(crate::storage::AppStorage::default()));
        {
            let mut storage = storage.lock().expect("storage mutex poisoned");
            let backing_session = storage
                .create_session(CreateSessionRequest {
                    title: "Read tool".to_string(),
                    objective: "Run read tool".to_string(),
                    primary_workbook_path: None,
                })
                .expect("session should be created");
            session.id = backing_session.id.clone();
            storage
                .sync_session_messages(&session.id, session.messages.clone())
                .expect("session history should sync");
        }
        let session_id = session.id.clone();
        let runtime = Arc::new(AgentSessionRuntime::new());
        let events = Arc::new(StdMutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        let emit: AgentEventEmitter = Arc::new(move |event| {
            events_clone
                .lock()
                .expect("events mutex poisoned")
                .push(event);
        });

        run_agent_session_loop(
            session,
            provider,
            registry,
            Arc::clone(&storage),
            Arc::clone(&runtime),
            ApprovalPolicy::Safe,
            emit,
        )
        .await
        .expect("agent loop should succeed");

        let history = storage
            .lock()
            .expect("storage mutex poisoned")
            .read_session_messages(&session_id)
            .expect("history should be readable");
        assert_eq!(history.len(), 4);
        assert!(matches!(
            history[1].content[0],
            ContentBlock::ToolUse { .. }
        ));
        assert!(matches!(
            history[2].content[0],
            ContentBlock::ToolResult { .. }
        ));
        assert!(matches!(history[3].content[0], ContentBlock::Text { .. }));

        let events = events.lock().expect("events mutex poisoned");
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentBridgeEvent::ToolStart(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentBridgeEvent::ToolResult(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentBridgeEvent::TurnComplete(_))));
    }

    #[tokio::test]
    async fn agent_loop_waits_for_approval_before_running_write_tools() {
        let provider = Arc::new(SequenceProvider {
            responses: Arc::new(StdMutex::new(vec![
                test_response(
                    vec![ResponseContent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "write_tool".to_string(),
                        input: json!({"path": "/tmp/output.csv"}),
                    }],
                    StopReason::ToolUse,
                ),
                test_response(
                    vec![ResponseContent::Text("done".to_string())],
                    StopReason::EndTurn,
                ),
            ])),
        });
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(WriteTool));
        let registry = Arc::new(registry);
        let mut session = test_session("run write tool");
        let storage = Arc::new(Mutex::new(crate::storage::AppStorage::default()));
        {
            let mut storage = storage.lock().expect("storage mutex poisoned");
            let backing_session = storage
                .create_session(CreateSessionRequest {
                    title: "Write tool".to_string(),
                    objective: "Run write tool".to_string(),
                    primary_workbook_path: None,
                })
                .expect("session should be created");
            session.id = backing_session.id.clone();
            storage
                .sync_session_messages(&session.id, session.messages.clone())
                .expect("session history should sync");
        }
        let session_id = session.id.clone();
        let runtime = Arc::new(AgentSessionRuntime::new());
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let emit: AgentEventEmitter = Arc::new(move |event| {
            let _ = event_sender.send(event);
        });

        let runtime_for_task = Arc::clone(&runtime);
        let loop_task = tokio::spawn(run_agent_session_loop(
            session,
            provider,
            registry,
            Arc::clone(&storage),
            Arc::clone(&runtime_for_task),
            ApprovalPolicy::Safe,
            emit,
        ));

        let approval_id = timeout(Duration::from_secs(2), async {
            loop {
                match event_receiver.recv().await {
                    Some(AgentBridgeEvent::ApprovalNeeded(payload)) => break payload.approval_id,
                    Some(_) => continue,
                    None => panic!("event stream closed before approval request"),
                }
            }
        })
        .await
        .expect("approval event should arrive");

        runtime
            .resolve_approval(&approval_id, true)
            .expect("approval should resolve");
        loop_task
            .await
            .expect("loop task should join")
            .expect("agent loop should succeed");

        let history = storage
            .lock()
            .expect("storage mutex poisoned")
            .read_session_messages(&session_id)
            .expect("history should be readable");
        let tool_result_message = history
            .iter()
            .find(|message| {
                message
                    .content
                    .iter()
                    .any(|block| matches!(block, ContentBlock::ToolResult { .. }))
            })
            .expect("tool_result should be present");

        let ContentBlock::ToolResult {
            content, is_error, ..
        } = &tool_result_message.content[0]
        else {
            panic!("expected tool_result block");
        };
        assert_eq!(content, "write ok");
        assert!(!is_error);
    }

    #[tokio::test]
    async fn agent_loop_auto_approves_medium_risk_tools_under_fast_policy() {
        let provider = Arc::new(SequenceProvider {
            responses: Arc::new(StdMutex::new(vec![
                test_response(
                    vec![ResponseContent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "workbook.save_copy".to_string(),
                        input: json!({"outputPath": "/tmp/reviewed.csv"}),
                    }],
                    StopReason::ToolUse,
                ),
                test_response(
                    vec![ResponseContent::Text("done".to_string())],
                    StopReason::EndTurn,
                ),
            ])),
        });
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(SaveCopyTool));
        let registry = Arc::new(registry);
        let mut session = test_session("run save copy tool");
        let storage = Arc::new(Mutex::new(crate::storage::AppStorage::default()));
        {
            let mut storage = storage.lock().expect("storage mutex poisoned");
            let backing_session = storage
                .create_session(CreateSessionRequest {
                    title: "Save copy tool".to_string(),
                    objective: "Run save copy tool".to_string(),
                    primary_workbook_path: None,
                })
                .expect("session should be created");
            session.id = backing_session.id.clone();
            storage
                .sync_session_messages(&session.id, session.messages.clone())
                .expect("session history should sync");
        }
        let session_id = session.id.clone();
        let runtime = Arc::new(AgentSessionRuntime::new());
        let events = Arc::new(StdMutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        let emit: AgentEventEmitter = Arc::new(move |event| {
            events_clone
                .lock()
                .expect("events mutex poisoned")
                .push(event);
        });

        run_agent_session_loop(
            session,
            provider,
            registry,
            Arc::clone(&storage),
            Arc::clone(&runtime),
            ApprovalPolicy::Fast,
            emit,
        )
        .await
        .expect("agent loop should succeed");

        let events = events.lock().expect("events mutex poisoned");
        assert!(!events
            .iter()
            .any(|event| matches!(event, AgentBridgeEvent::ApprovalNeeded(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentBridgeEvent::TurnComplete(_))));

        let history = storage
            .lock()
            .expect("storage mutex poisoned")
            .read_session_messages(&session_id)
            .expect("history should be readable");
        let tool_result_message = history
            .iter()
            .find(|message| {
                message
                    .content
                    .iter()
                    .any(|block| matches!(block, ContentBlock::ToolResult { .. }))
            })
            .expect("tool_result should be present");
        let ContentBlock::ToolResult {
            content, is_error, ..
        } = &tool_result_message.content[0]
        else {
            panic!("expected tool_result block");
        };
        assert_eq!(content, "save copy ok");
        assert!(!is_error);
    }

    #[test]
    fn agent_runtime_state_remove_session_drops_entry() {
        let runtime_state = AgentRuntimeState::default();
        let session = runtime_state.create_session("session-1".to_string());
        assert!(session.is_running());
        assert!(runtime_state.get_session("session-1").is_some());

        runtime_state.remove_session("session-1");

        assert!(runtime_state.get_session("session-1").is_none());
    }

    #[test]
    fn agent_session_runtime_cancel_clears_running_state() {
        let runtime = AgentSessionRuntime::new();
        assert!(runtime.is_running());
        runtime.cancel();
        assert!(!runtime.is_running());
        assert!(runtime.is_cancelled());
    }
}
