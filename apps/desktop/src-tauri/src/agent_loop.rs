use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// M365 Copilot (CDP) cannot take API `tools`; model must emit this fenced JSON for invocations.
const CDP_TOOL_FENCE: &str = "```relay_tool";

use runtime::{
    self, ApiClient, ApiRequest, AssistantEvent, ContentBlock, ConversationMessage, McpServerManager,
    PermissionMode, PermissionPolicy, PermissionPromptDecision, PermissionPrompter,
    PermissionRequest, RuntimeError, Session as RuntimeSession, TokenUsage, ToolExecutor,
};

use crate::copilot_persistence::{self, PersistedSessionConfig};
use crate::error::AgentLoopError;
use crate::registry::SessionRegistry;
use crate::tauri_bridge;

/* ── Event name constants ─── */

pub(crate) const E_TOOL_START: &str = "agent:tool_start";
pub(crate) const E_TOOL_RESULT: &str = "agent:tool_result";
pub(crate) const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
pub(crate) const E_TURN_COMPLETE: &str = "agent:turn_complete";
pub(crate) const E_ERROR: &str = "agent:error";
pub(crate) const E_TEXT_DELTA: &str = "agent:text_delta";

/* ── POSIX shell escaping ─── */

/// POSIX-compliant shell escaping for use in `sh -c` contexts.
/// Wraps the string in single quotes, escaping embedded single quotes as `'\''`.
/// Rejects null bytes and control characters (except tab 0x09).
pub(crate) fn posix_shell_escape(s: &str) -> Result<String, String> {
    if s.bytes()
        .any(|b| b == 0 || (b < 0x20 && b != 0x09) || b == 0x7F)
    {
        return Err("working directory path contains control characters".to_string());
    }
    Ok(s.replace('\'', "'\\''"))
}

/* ── Agent loop ─── */

#[allow(clippy::needless_pass_by_value)]
pub fn run_agent_loop_impl(
    app: &AppHandle,
    registry: &SessionRegistry,
    session_id: &str,
    goal: String,
    cwd: Option<String>,
    max_turns: Option<usize>,
    cancelled: Arc<AtomicBool>,
) -> Result<(), AgentLoopError> {
    let server = tauri_bridge::ensure_copilot_server()
        .map_err(|e| AgentLoopError::InitializationError(e))?;
    let api_client = CdpApiClient::new(server);

    let tool_executor = build_tool_executor(app, session_id, cwd.clone());
    let permission_policy = PermissionPolicy::new(PermissionMode::Prompt);
    let system_prompt = vec![build_system_prompt(&goal)];
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
                emit_error(app, session_id, &format!("agent loop failed: {error}"), false);
                break;
            }
        };

        persist_turn(app, registry, &runtime_session, session_id, &goal, &cwd, max_turns)?;

        let needs_more_turns = summary.assistant_messages.last().is_some_and(|message| {
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

    if let Some(summary) = &final_summary {
        emit_turn_complete(app, session_id, summary, &runtime_session, &cancelled);
    }

    let session = runtime_session.into_session();
    copilot_persistence::save_session(
        session_id,
        &session,
        PersistedSessionConfig {
            goal: Some(goal),
            cwd,
            max_turns: Some(max_turns),
        },
    )
    .map_err(|error| AgentLoopError::PersistenceError(error.to_string()))?;
    let _ignore = registry.mutate_session(session_id, |entry| {
        entry.session = session;
    });

    Ok(())
}

/* ── CDP-based API client ─── */

/// Sends prompts to M365 Copilot via the bundled `copilot_server.js` (Node + CDP).
pub struct CdpApiClient {
    server: std::sync::Arc<std::sync::Mutex<crate::copilot_server::CopilotServer>>,
    response_timeout_secs: u64,
}

impl CdpApiClient {
    fn new(server: std::sync::Arc<std::sync::Mutex<crate::copilot_server::CopilotServer>>) -> Self {
        Self {
            server,
            response_timeout_secs: 120,
        }
    }
}

impl ApiClient for CdpApiClient {
    fn stream(&mut self, request: &ApiRequest<'_>) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let prompt = build_cdp_prompt(request);

        let prompt_preview = &prompt[..prompt.len().min(80)];
        tracing::info!("[CdpApiClient] sending prompt: {prompt_preview}…");

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::new(format!("tokio runtime: {e}")))?;

        let response_text = {
            let srv = self
                .server
                .lock()
                .map_err(|e| RuntimeError::new(format!("copilot server lock poisoned: {e}")))?;
            rt.block_on(async {
                srv
                    .send_prompt("", &prompt, self.response_timeout_secs)
                    .await
            })
            .map_err(|e| RuntimeError::new(format!("Copilot request failed: {e}")))?
        };

        tracing::info!("[CdpApiClient] response {} chars", response_text.len());

        let (visible_text, tool_calls) = parse_copilot_tool_response(&response_text);

        let mut events = Vec::new();
        if !visible_text.is_empty() {
            // Chunk the response into TextDelta events for UI progress display
            let mut start = 0;
            for (i, _) in visible_text.char_indices() {
                if i > start && (i - start) >= 200 {
                    events.push(AssistantEvent::TextDelta(visible_text[start..i].to_string()));
                    start = i;
                }
            }
            if start < visible_text.len() {
                events.push(AssistantEvent::TextDelta(visible_text[start..].to_string()));
            }
        }

        for (id, name, input) in tool_calls {
            events.push(AssistantEvent::ToolUse { id, name, input });
        }

        events.push(AssistantEvent::Usage(TokenUsage {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }));
        events.push(AssistantEvent::MessageStop);
        Ok(events)
    }
}

/// Serialize built-in tool specs for the Copilot text prompt.
fn cdp_tool_catalog_section() -> String {
    let catalog: Vec<Value> = tools::mvp_tool_specs()
        .iter()
        .map(|s| {
            json!({
                "name": s.name,
                "description": s.description,
                "input_schema": s.input_schema.clone(),
            })
        })
        .collect();
    let json_pretty = serde_json::to_string_pretty(&catalog).unwrap_or_else(|_| "[]".to_string());
    format!(
        r#"## Relay Agent tools

The JSON array below lists every tool you may invoke. Each entry has `name`, `description`, and `input_schema` (JSON Schema for the tool's `input` object).

```json
{json_pretty}
```

## Tool invocation protocol

When you need to call one or more tools, you may write a short user-facing explanation, then append a Markdown fenced block whose **info string is exactly** `relay_tool` (three backticks, then `relay_tool`, then a newline). Inside the fence put **only** JSON — no markdown, no commentary.

- **Single tool:** one JSON object: `{{ "name": "<tool_name>", "input": {{ ... }} }}`
- **Optional:** `"id": "<string>"` — omit if unsure; the host will assign one.
- **Multiple tools:** either one JSON **array** of such objects inside a single `relay_tool` fence, or several separate `relay_tool` fences in order.

Example:

```relay_tool
{{"name":"read_file","input":{{"path":"README.md"}}}}
```
"#,
        json_pretty = json_pretty
    )
}

/// Strip `relay_tool` fences and parse tool calls. Returns `(visible_text, Vec<(id, name, input_json)>)`.
fn parse_copilot_tool_response(raw: &str) -> (String, Vec<(String, String, String)>) {
    let (stripped, payloads) = extract_relay_tool_fences(raw);
    let calls = parse_tool_payloads(&payloads);
    (stripped, calls)
}

fn extract_relay_tool_fences(text: &str) -> (String, Vec<String>) {
    let mut display = String::new();
    let mut payloads = Vec::new();
    let mut rest = text;

    loop {
        if let Some(idx) = rest.find(CDP_TOOL_FENCE) {
            display.push_str(&rest[..idx]);
            rest = &rest[idx + CDP_TOOL_FENCE.len()..];
            for prefix in ["\r\n", "\n"] {
                if let Some(s) = rest.strip_prefix(prefix) {
                    rest = s;
                    break;
                }
            }
            match find_relay_tool_fence_end(rest) {
                Some(end_inner) => {
                    let inner = rest[..end_inner].trim();
                    if !inner.is_empty() {
                        payloads.push(inner.to_string());
                    }
                    rest = &rest[end_inner..];
                    if let Some(after) = rest.strip_prefix("\r\n```") {
                        rest = after;
                    } else if let Some(after) = rest.strip_prefix("\n```") {
                        rest = after;
                    } else {
                        rest = rest.strip_prefix("```").unwrap_or(rest);
                    }
                    if let Some(s) = rest.strip_prefix("\r\n") {
                        rest = s;
                    } else if let Some(s) = rest.strip_prefix('\n') {
                        rest = s;
                    }
                }
                None => {
                    display.push_str(CDP_TOOL_FENCE);
                    display.push_str(rest);
                    break;
                }
            }
        } else {
            display.push_str(rest);
            break;
        }
    }

    (display.trim().to_string(), payloads)
}

/// Byte offset in `rest` where inner content ends (before `\n``` ` or a trailing ` ``` `).
fn find_relay_tool_fence_end(rest: &str) -> Option<usize> {
    if let Some(idx) = rest.find("\n```") {
        return Some(idx);
    }
    rest.rfind("```")
}

fn parse_tool_payloads(payloads: &[String]) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for p in payloads {
        let v: Value = match serde_json::from_str(p) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("[CdpApiClient] skip invalid relay_tool JSON: {e}");
                continue;
            }
        };
        match v {
            Value::Array(arr) => {
                for item in arr {
                    if let Some(t) = parse_one_tool_call(item) {
                        out.push(t);
                    }
                }
            }
            Value::Object(_) => {
                if let Some(t) = parse_one_tool_call(v) {
                    out.push(t);
                }
            }
            _ => tracing::warn!("[CdpApiClient] relay_tool JSON must be object or array"),
        }
    }
    out
}

fn parse_one_tool_call(v: Value) -> Option<(String, String, String)> {
    let obj = v.as_object()?;
    let name = obj.get("name")?.as_str()?.to_string();
    let id = obj
        .get("id")
        .and_then(|x| x.as_str())
        .map(String::from)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let input = obj
        .get("input")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let input_str = serde_json::to_string(&input).ok()?;
    Some((id, name, input_str))
}

/// Convert an `ApiRequest` into a human-readable text prompt for CDP.
fn build_cdp_prompt(request: &ApiRequest<'_>) -> String {
    let mut parts = Vec::new();

    if !request.system_prompt.is_empty() {
        parts.push(request.system_prompt.join("\n\n"));
    }

    for msg in request.messages {
        let role = match msg.role {
            runtime::MessageRole::System | runtime::MessageRole::User => "User",
            runtime::MessageRole::Assistant => "Assistant",
            runtime::MessageRole::Tool => "Tool Result",
        };

        let text: Vec<String> = msg
            .blocks
            .iter()
            .map(|b| match b {
                ContentBlock::Text { text } => text.clone(),
                ContentBlock::ToolUse { name, input, .. } => {
                    format!("[Tool Call: {name}] {input}")
                }
                ContentBlock::ToolResult {
                    output, is_error, ..
                } => {
                    if *is_error {
                        format!("[Error] {output}")
                    } else {
                        output.clone()
                    }
                }
            })
            .collect();

        parts.push(format!("{role}:\n{}", text.join("\n")));
    }

    let mut out = parts.join("\n\n");
    out.push_str("\n\n");
    out.push_str(&cdp_tool_catalog_section());
    out
}

/// Persist the session state after a turn: update registry + save to disk.
fn persist_turn(
    _app: &AppHandle,
    registry: &SessionRegistry,
    runtime_session: &runtime::ConversationRuntime<CdpApiClient, TauriToolExecutor>,
    session_id: &str,
    goal: &str,
    cwd: &Option<String>,
    max_turns: usize,
) -> Result<(), AgentLoopError> {
    let _ignore = registry.mutate_session(session_id, |entry| {
        entry.session = runtime_session.session().clone();
    });
    copilot_persistence::save_session(
        session_id,
        runtime_session.session(),
        PersistedSessionConfig {
            goal: Some(goal.to_string()),
            cwd: cwd.clone(),
            max_turns: Some(max_turns),
        },
    )
    .map_err(|error| {
        tracing::error!("[RelayAgent] failed to persist session {session_id}: {error}");
        AgentLoopError::PersistenceError(error.to_string())
    })
}

/// Emit the `turn_complete` event with the final assistant text and message count.
fn emit_turn_complete(
    app: &AppHandle,
    session_id: &str,
    summary: &runtime::TurnSummary,
    runtime_session: &runtime::ConversationRuntime<CdpApiClient, TauriToolExecutor>,
    cancelled: &AtomicBool,
) {
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

/// Emit an error event to the frontend.
fn emit_error(app: &AppHandle, session_id: &str, error: &str, cancelled: bool) {
    let evt = AgentErrorEvent {
        session_id: session_id.to_string(),
        error: error.to_string(),
        cancelled,
    };
    if let Err(e) = app.emit(E_ERROR, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
    }
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
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during permission check: {e}"
                    );
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
                    format!(
                        "{}: {}",
                        request.tool_name,
                        cmd.chars().take(60).collect::<String>()
                    )
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
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during approval registration: {e}"
                    );
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
        mcp_manager: runtime::McpServerManager::from_servers(&std::collections::BTreeMap::new()),
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to create tokio runtime for tool executor"),
    }
}

pub struct TauriToolExecutor {
    app: AppHandle,
    session_id: String,
    cwd: Option<String>,
    mcp_manager: McpServerManager,
    runtime: tokio::runtime::Runtime,
}

impl ToolExecutor for TauriToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, runtime::ToolError> {
        // Phase 1: Route MCP tool calls (prefixed with `mcp__`) to the MCP server manager
        if let Some(mcp_result) =
            try_execute_mcp_tool(&mut self.mcp_manager, &self.runtime, tool_name, input)
        {
            return mcp_result;
        }

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
                    let escaped = posix_shell_escape(cwd)
                        .map_err(runtime::ToolError::new)?;
                    let prefixed = format!("cd '{escaped}' && ( {cmd} )");
                    input_value["command"] = Value::String(prefixed);
                }
            }
        }

        let result =
            tools::execute_tool(tool_name, &input_value).map_err(runtime::ToolError::new)?;

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

/// Phase 1: Attempt to execute an MCP tool call.
///
/// Returns `Some(Ok(result))` if the tool was successfully executed,
/// `Some(Err(error))` if it was an MCP tool but execution failed,
/// or `None` if the tool name doesn't match any MCP tool (fall back to built-in tools).
fn try_execute_mcp_tool(
    mcp_manager: &mut McpServerManager,
    runtime: &tokio::runtime::Runtime,
    tool_name: &str,
    input: &str,
) -> Option<Result<String, runtime::ToolError>> {
    // Check if this tool name maps to an MCP tool
    let route = mcp_manager.tool_index().get(tool_name).cloned();
    let Some(route) = route else {
        return None;
    };

    let input_value: serde_json::Value =
        serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));

    tracing::info!(
        "[RelayAgent] MCP tool call: {} → {} ({})",
        tool_name,
        route.server_name,
        route.raw_name
    );

    // Execute the MCP tool call via the shared async runtime
    let result: Result<runtime::JsonRpcResponse<runtime::McpToolCallResult>, runtime::ToolError> =
        runtime
            .block_on(async { mcp_manager.call_tool(tool_name, Some(input_value)).await })
            .map_err(|e| runtime::ToolError::new(e.to_string()));

    match result {
        Ok(response) => {
            if let Some(error) = response.error {
                Some(Err(runtime::ToolError::new(format!(
                    "MCP tool `{tool_name}` returned error: {} ({})",
                    error.message, error.code
                ))))
            } else if let Some(result_data) = response.result {
                let formatted = format_mcp_tool_call_result(&result_data);
                Some(Ok(formatted))
            } else {
                Some(Err(runtime::ToolError::new(format!(
                    "MCP tool `{tool_name}` returned empty response"
                ))))
            }
        }
        Err(e) => Some(Err(e)),
    }
}

/// Format MCP tool call result content into a human-readable string.
fn format_mcp_tool_call_result(result: &runtime::McpToolCallResult) -> String {
    if result.content.is_empty() && result.structured_content.is_none() {
        return String::new();
    }

    let mut parts = Vec::new();

    for content in &result.content {
        match content.kind.as_str() {
            "text" => {
                if let Some(text) = content.data.get("text").and_then(|v| v.as_str()) {
                    parts.push(text.to_string());
                }
            }
            "image" => {
                parts.push("[image content]".to_string());
            }
            "resource" => {
                if let Some(resource) = content.data.get("resource") {
                    if let Some(text) = resource.get("text").and_then(|v| v.as_str()) {
                        parts.push(text.to_string());
                    } else if let Some(uri) = resource.get("uri").and_then(|v| v.as_str()) {
                        parts.push(format!("[resource: {uri}]"));
                    }
                }
            }
            other => {
                parts.push(format!("[{other} content]"));
            }
        }
    }

    if let Some(structured) = &result.structured_content {
        if parts.is_empty() {
            parts.push(
                serde_json::to_string_pretty(structured)
                    .unwrap_or_else(|_| format!("{structured:?}")),
            );
        }
    }

    let output = parts.join("\n\n");
    if let Some(true) = result.is_error {
        format!("Error: {output}")
    } else {
        output
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
pub struct RelayMessage {
    pub role: String,
    pub content: Vec<MessageContent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageContent {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<RelayMessage>,
}

#[cfg(test)]
mod cdp_copilot_tool_tests {
    use super::*;

    #[test]
    fn catalog_lists_builtin_tools_and_protocol() {
        let s = cdp_tool_catalog_section();
        assert!(s.contains("read_file"));
        assert!(s.contains("relay_tool"));
        assert!(s.contains("input_schema"));
    }

    #[test]
    fn parse_plain_text_no_tools() {
        let (vis, tools) = parse_copilot_tool_response("Hello, no tools here.");
        assert_eq!(vis, "Hello, no tools here.");
        assert!(tools.is_empty());
    }

    #[test]
    fn parse_single_object_fence() {
        let raw = r#"Done.

```relay_tool
{"name":"glob_search","input":{"pattern":"*.rs"}}
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.contains("Done."));
        assert!(!vis.contains("relay_tool"));
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "glob_search");
        assert!(tools[0].2.contains("*.rs"));
    }

    #[test]
    fn parse_array_inside_one_fence() {
        let raw = r#"```relay_tool
[{"name":"read_file","input":{"path":"a.txt"}},{"name":"read_file","input":{"path":"b.txt"}}]
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].1, "read_file");
        assert_eq!(tools[1].1, "read_file");
    }

    #[test]
    fn parse_two_fences() {
        let raw = r#"```relay_tool
{"name":"read_file","input":{"path":"x"}}
```
```relay_tool
{"name":"read_file","input":{"path":"y"}}
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn parse_preserves_explicit_id() {
        let raw = r#"```relay_tool
{"id":"my-id","name":"read_file","input":{"path":"p"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].0, "my-id");
    }

    #[test]
    fn parse_invalid_json_skipped_but_fence_stripped() {
        let raw = "Text\n```relay_tool\nnot json\n```\nTail";
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.contains("Text"));
        assert!(vis.contains("Tail"));
        assert!(!vis.contains("not json"));
        assert!(tools.is_empty());
    }

    #[test]
    fn closing_fence_without_leading_newline() {
        let raw = r#"```relay_tool
{"name":"read_file","input":{"path":"z"}}```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
    }
}
