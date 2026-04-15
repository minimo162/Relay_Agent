use crate::agent_loop::{msg_to_relay, MessageContent};
use crate::app_services::AppServices;
use crate::doctor::relay_diagnostics_blocking;
use crate::models::{
    BrowserAutomationSettings, ContinueAgentSessionRequest, RespondAgentApprovalRequest,
    StartAgentRequest,
};
use crate::registry::SessionRunState;
use crate::tauri_bridge::{
    continue_agent_session_inner, respond_approval_inner, start_agent_inner,
};
use runtime::ConversationMessage;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub const DEV_FIRST_RUN_SEND_EVENT: &str = "relay:dev-first-run-send";
pub const DEV_CONFIGURE_EVENT: &str = "relay:dev-configure";
pub const DEV_APPROVE_LATEST_EVENT: &str = "relay:dev-approve-latest";
pub const DEV_APPROVE_LATEST_SESSION_EVENT: &str = "relay:dev-approve-latest-session";
pub const DEV_APPROVE_LATEST_WORKSPACE_EVENT: &str = "relay:dev-approve-latest-workspace";
pub const DEV_REJECT_LATEST_EVENT: &str = "relay:dev-reject-latest";
const DEFAULT_DEV_CONTROL_PORT: u16 = 18_411;
static DEV_AUTOMATION_CONFIG: OnceLock<Mutex<Option<DevConfigureRequest>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct DevFirstRunSendRequest {
    text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevStartAgentRequest {
    goal: String,
    cwd: Option<String>,
    cdp_port: Option<u16>,
    auto_launch_edge: Option<bool>,
    timeout_ms: Option<u32>,
    max_turns: Option<usize>,
    session_preset: Option<String>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevConfigureRequest {
    workspace_path: Option<String>,
    session_preset: Option<String>,
    cdp_port: Option<u16>,
    auto_launch_edge: Option<bool>,
    timeout_ms: Option<u32>,
    max_turns: Option<u32>,
    always_on_top: Option<bool>,
    persist_settings: Option<bool>,
    rerun_warmup: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevDirectApprovalRequest {
    session_id: String,
    approval_id: String,
    approved: Option<bool>,
    remember_for_session: Option<bool>,
    remember_for_workspace: Option<bool>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFirstRunSendEvent {
    text: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevPendingApprovalState {
    approval_id: String,
    tool_name: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevSessionState {
    session_id: String,
    cwd: Option<String>,
    running: bool,
    run_state: String,
    last_stop_reason: Option<String>,
    retry_count: usize,
    message_count: usize,
    pending_approvals: Vec<DevPendingApprovalState>,
    tool_use_counts: BTreeMap<String, usize>,
    tool_result_counts: BTreeMap<String, usize>,
    tool_error_counts: BTreeMap<String, usize>,
    last_assistant_text: Option<String>,
    current_copilot_request_id: Option<String>,
    stream_delta_count: usize,
    first_stream_at_ms: Option<u64>,
    last_stream_at_ms: Option<u64>,
    stream_preview_text: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevStateResponse {
    ok: bool,
    relay_diagnostics: crate::models::RelayDiagnostics,
    latest_session_id: Option<String>,
    sessions: Vec<DevSessionState>,
}

struct ParsedHttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn dev_automation_config() -> &'static Mutex<Option<DevConfigureRequest>> {
    DEV_AUTOMATION_CONFIG.get_or_init(|| Mutex::new(None))
}

pub fn spawn(app: &AppHandle) {
    if !cfg!(debug_assertions) {
        return;
    }

    let port = std::env::var("RELAY_DEV_APP_CONTROL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_DEV_CONTROL_PORT);
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::warn!("[dev-control] failed to bind 127.0.0.1:{}: {}", port, error);
            return;
        }
    };
    let app = app.clone();
    thread::spawn(move || {
        tracing::info!(
            "[dev-control] listening on http://127.0.0.1:{} (debug-only)",
            port
        );
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    if let Err(error) = handle_connection(stream, &app, port) {
                        tracing::warn!("[dev-control] request failed: {}", error);
                    }
                }
                Err(error) => {
                    tracing::warn!("[dev-control] incoming connection failed: {}", error);
                }
            }
        }
    });
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let request = read_http_request(&mut stream)?;
    dispatch_http_request(&mut stream, app, port, &request)
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Result<ParsedHttpRequest, Box<dyn std::error::Error + Send + Sync>> {
    let buffer = read_http_request_buffer(stream)?;
    parse_http_request(stream, buffer)
}

fn read_http_request_buffer(
    stream: &mut TcpStream,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 1024];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 1024 * 1024 {
            write_json_response(
                stream,
                413,
                &json!({ "ok": false, "error": "request_too_large" }),
            )?;
            return Err("request_too_large".into());
        }
    }
    Ok(buffer)
}

fn parse_http_request(
    stream: &mut TcpStream,
    mut buffer: Vec<u8>,
) -> Result<ParsedHttpRequest, Box<dyn std::error::Error + Send + Sync>> {
    let request = String::from_utf8_lossy(&buffer).to_string();
    let header_end = request
        .find("\r\n\r\n")
        .ok_or_else(|| "missing HTTP header terminator".to_string())?;
    let header_text = &request[..header_end];
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("content-length") {
                return None;
            }
            value.trim().parse::<usize>().ok()
        })
        .unwrap_or(0);

    let mut body = buffer.split_off(header_end + 4);
    let mut chunk = [0_u8; 1024];
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    if body.len() > content_length {
        body.truncate(content_length);
    }

    Ok(ParsedHttpRequest { method, path, body })
}

fn dispatch_http_request(
    stream: &mut TcpStream,
    app: &AppHandle,
    port: u16,
    request: &ParsedHttpRequest,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => write_health_response(stream, port),
        ("GET", "/state") => write_state_response(stream, app),
        ("POST", "/first-run-send") => handle_first_run_send(stream, app, &request.body),
        ("POST", "/start-agent") => handle_start_agent(stream, app, &request.body),
        ("POST", "/configure") => handle_configure(stream, app, &request.body),
        ("POST", "/approve") => handle_direct_approval(stream, app, &request.body),
        ("POST", "/approve-latest") => {
            emit_mode_event(stream, app, DEV_APPROVE_LATEST_EVENT, "once")
        }
        ("POST", "/approve-latest-session") => {
            emit_mode_event(stream, app, DEV_APPROVE_LATEST_SESSION_EVENT, "session")
        }
        ("POST", "/approve-latest-workspace") => {
            emit_mode_event(stream, app, DEV_APPROVE_LATEST_WORKSPACE_EVENT, "workspace")
        }
        ("POST", "/reject-latest") => {
            emit_mode_event(stream, app, DEV_REJECT_LATEST_EVENT, "reject")
        }
        _ => write_json_response(stream, 404, &json!({ "ok": false, "error": "not_found" })),
    }
}

fn write_state_response(
    stream: &mut TcpStream,
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = build_state_response(app)?;
    write_json_response(stream, 200, &serde_json::to_value(state)?)
}

fn write_health_response(
    stream: &mut TcpStream,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    write_json_response(
        stream,
        200,
        &json!({ "ok": true, "port": port, "event": DEV_FIRST_RUN_SEND_EVENT }),
    )
}

fn handle_configure(
    stream: &mut TcpStream,
    app: &AppHandle,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload: DevConfigureRequest = serde_json::from_slice(body)?;
    *dev_automation_config()
        .lock()
        .map_err(|_| "dev automation config lock poisoned")? = Some(payload.clone());
    tracing::info!("[dev-control] emitting {}", DEV_CONFIGURE_EVENT);
    app.emit(DEV_CONFIGURE_EVENT, &payload)?;
    write_json_response(
        stream,
        202,
        &json!({ "ok": true, "event": DEV_CONFIGURE_EVENT }),
    )
}

fn handle_start_agent(
    stream: &mut TcpStream,
    app: &AppHandle,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload: DevStartAgentRequest = serde_json::from_slice(body)?;
    let goal = payload.goal.trim();
    if goal.is_empty() {
        return write_json_response(
            stream,
            400,
            &json!({ "ok": false, "error": "missing_goal" }),
        );
    }

    let request = StartAgentRequest {
        goal: goal.to_string(),
        files: Vec::new(),
        cwd: payload.cwd.map(|value| value.trim().to_string()),
        browser_settings: Some(BrowserAutomationSettings {
            cdp_port: payload.cdp_port.unwrap_or(9360),
            auto_launch_edge: payload.auto_launch_edge.unwrap_or(false),
            timeout_ms: payload.timeout_ms.unwrap_or(60_000),
        }),
        max_turns: payload.max_turns,
    };

    let services = app.state::<AppServices>();
    let session_id = tauri::async_runtime::block_on(start_agent_inner(
        app.clone(),
        services.registry(),
        services.agent_semaphore(),
        services.config().clone(),
        request,
    ))
    .map_err(|error| format!("start_agent failed: {error}"))?;

    write_json_response(stream, 202, &json!({ "ok": true, "sessionId": session_id }))
}

fn handle_direct_approval(
    stream: &mut TcpStream,
    app: &AppHandle,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload: DevDirectApprovalRequest = serde_json::from_slice(body)?;
    let services = app.state::<AppServices>();
    respond_approval_inner(
        services.registry(),
        RespondAgentApprovalRequest {
            session_id: payload.session_id,
            approval_id: payload.approval_id,
            approved: payload.approved.unwrap_or(true),
            remember_for_session: payload.remember_for_session,
            remember_for_workspace: payload.remember_for_workspace,
        },
    )
    .map_err(|error| format!("respond_approval failed: {error}"))?;

    write_json_response(stream, 202, &json!({ "ok": true }))
}

fn handle_first_run_send(
    stream: &mut TcpStream,
    app: &AppHandle,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload: DevFirstRunSendRequest = serde_json::from_slice(body)?;
    let text = payload.text.trim().to_string();
    if text.is_empty() {
        return write_json_response(
            stream,
            400,
            &json!({ "ok": false, "error": "missing_text" }),
        );
    }
    let event = DevFirstRunSendEvent { text };
    let services = app.state::<AppServices>();
    let registry = services.registry();
    let latest_session_id = build_state_response(app)?.latest_session_id;

    if let Some(session_id) = latest_session_id {
        let continued_session_id = tauri::async_runtime::block_on(continue_agent_session_inner(
            app.clone(),
            registry,
            services.agent_semaphore(),
            services.config().clone(),
            ContinueAgentSessionRequest {
                session_id,
                message: event.text.clone(),
            },
        ))
        .map_err(|error| format!("continue_agent_session failed: {error}"))?;

        return write_json_response(
            stream,
            202,
            &json!({
                "ok": true,
                "mode": "backend_continue",
                "event": DEV_FIRST_RUN_SEND_EVENT,
                "sessionId": continued_session_id
            }),
        );
    }

    let config = dev_automation_config()
        .lock()
        .map_err(|_| "dev automation config lock poisoned")?
        .clone();
    if let Some(config) = config {
        let started_session_id = tauri::async_runtime::block_on(start_agent_inner(
            app.clone(),
            registry,
            services.agent_semaphore(),
            services.config().clone(),
            StartAgentRequest {
                goal: event.text.clone(),
                files: Vec::new(),
                cwd: config.workspace_path.map(|value| value.trim().to_string()),
                browser_settings: Some(BrowserAutomationSettings {
                    cdp_port: config.cdp_port.unwrap_or(9360),
                    auto_launch_edge: config.auto_launch_edge.unwrap_or(false),
                    timeout_ms: config.timeout_ms.unwrap_or(60_000),
                }),
                max_turns: config.max_turns.map(|value| value as usize),
            },
        ))
        .map_err(|error| format!("start_agent failed: {error}"))?;

        return write_json_response(
            stream,
            202,
            &json!({
                "ok": true,
                "mode": "backend_start",
                "event": DEV_FIRST_RUN_SEND_EVENT,
                "sessionId": started_session_id
            }),
        );
    }

    tracing::info!(
        "[dev-control] emitting {} via {} chars",
        DEV_FIRST_RUN_SEND_EVENT,
        event.text.chars().count()
    );
    app.emit(DEV_FIRST_RUN_SEND_EVENT, event)?;
    write_json_response(
        stream,
        202,
        &json!({ "ok": true, "event": DEV_FIRST_RUN_SEND_EVENT }),
    )
}

fn emit_mode_event(
    stream: &mut TcpStream,
    app: &AppHandle,
    event_name: &str,
    mode: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing::info!("[dev-control] emitting {}", event_name);
    app.emit(event_name, json!({ "mode": mode }))?;
    write_json_response(stream, 202, &json!({ "ok": true, "event": event_name }))
}

fn build_state_response(
    app: &AppHandle,
) -> Result<DevStateResponse, Box<dyn std::error::Error + Send + Sync>> {
    let services = app.state::<AppServices>();
    let registry = services.registry();
    let relay_diagnostics = relay_diagnostics_blocking(services.copilot_bridge());
    let mut sessions = Vec::new();

    for session_id in registry.list_session_ids()? {
        let Some(handle) = registry.get_handle(&session_id)? else {
            continue;
        };
        let pending_approvals = handle
            .list_pending_approvals()?
            .into_iter()
            .map(|(approval_id, tool_name)| DevPendingApprovalState {
                approval_id,
                tool_name,
            })
            .collect::<Vec<_>>();
        let snapshot = handle.read_state(|state| {
            build_session_state(&session_id, state, pending_approvals.clone())
        })?;
        sessions.push(snapshot);
    }

    sessions.sort_by(|left, right| {
        right
            .running
            .cmp(&left.running)
            .then_with(|| {
                right
                    .pending_approvals
                    .len()
                    .cmp(&left.pending_approvals.len())
            })
            .then_with(|| right.message_count.cmp(&left.message_count))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    let latest_session_id = sessions.first().map(|session| session.session_id.clone());

    Ok(DevStateResponse {
        ok: true,
        relay_diagnostics,
        latest_session_id,
        sessions,
    })
}

fn build_session_state(
    session_id: &str,
    state: &crate::registry::SessionState,
    pending_approvals: Vec<DevPendingApprovalState>,
) -> DevSessionState {
    let (
        message_count,
        tool_use_counts,
        tool_result_counts,
        tool_error_counts,
        last_assistant_text,
    ) = summarize_session_messages(&state.session.messages);

    DevSessionState {
        session_id: session_id.to_string(),
        cwd: state.session_config.cwd.clone(),
        running: state.running,
        run_state: run_state_label(state.run_state).to_string(),
        last_stop_reason: state.last_stop_reason.clone(),
        retry_count: state.retry_count,
        message_count,
        pending_approvals,
        tool_use_counts,
        tool_result_counts,
        tool_error_counts,
        last_assistant_text,
        current_copilot_request_id: state.current_copilot_request_id.clone(),
        stream_delta_count: state.stream_delta_count,
        first_stream_at_ms: state.first_stream_at_ms,
        last_stream_at_ms: state.last_stream_at_ms,
        stream_preview_text: state.stream_preview_text.clone(),
    }
}

fn summarize_session_messages(
    messages: &[ConversationMessage],
) -> (
    usize,
    BTreeMap<String, usize>,
    BTreeMap<String, usize>,
    BTreeMap<String, usize>,
    Option<String>,
) {
    let mut tool_use_names = BTreeMap::<String, String>::new();
    let mut tool_use_counts = BTreeMap::<String, usize>::new();
    let mut tool_result_counts = BTreeMap::<String, usize>::new();
    let mut tool_error_counts = BTreeMap::<String, usize>::new();
    let mut last_assistant_text = None;

    for message in messages.iter().map(msg_to_relay) {
        for content in message.content {
            match content {
                MessageContent::Text { text } if message.role == "assistant" => {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        last_assistant_text = Some(trimmed.to_string());
                    }
                }
                MessageContent::ToolUse { id, name, .. } => {
                    tool_use_names.insert(id, name.clone());
                    *tool_use_counts.entry(name).or_insert(0) += 1;
                }
                MessageContent::ToolResult {
                    tool_use_id,
                    is_error,
                    ..
                } => {
                    if let Some(name) = tool_use_names.get(&tool_use_id).cloned() {
                        *tool_result_counts.entry(name.clone()).or_insert(0) += 1;
                        if is_error {
                            *tool_error_counts.entry(name).or_insert(0) += 1;
                        }
                    }
                }
                MessageContent::Text { .. } => {}
            }
        }
    }

    (
        messages.len(),
        tool_use_counts,
        tool_result_counts,
        tool_error_counts,
        last_assistant_text,
    )
}

fn run_state_label(state: SessionRunState) -> &'static str {
    match state {
        SessionRunState::Running => "running",
        SessionRunState::Retrying => "retrying",
        SessionRunState::WaitingApproval => "waiting_approval",
        SessionRunState::Compacting => "compacting",
        SessionRunState::Cancelling => "cancelling",
        SessionRunState::Finished => "finished",
    }
}

fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    body: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let status_text = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let body_text = serde_json::to_string(body)?;
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        status_text,
        body_text.len(),
        body_text
    )?;
    stream.flush()?;
    Ok(())
}
