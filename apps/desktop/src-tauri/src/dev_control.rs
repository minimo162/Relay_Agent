use crate::app_services::AppServices;
use crate::doctor::relay_diagnostics_blocking;
use crate::registry::SessionRunState;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Manager};

const DEFAULT_DEV_CONTROL_PORT: u16 = 18_411;
static DEV_AUTOMATION_CONFIG: OnceLock<Mutex<Option<DevConfigureRequest>>> = OnceLock::new();

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
    automation_config: Option<DevConfigureRequest>,
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
        ("POST", "/configure") => handle_configure(stream, &request.body),
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
    write_json_response(stream, 200, &json!({ "ok": true, "port": port }))
}

fn handle_configure(
    stream: &mut TcpStream,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload: DevConfigureRequest = serde_json::from_slice(body)?;
    *dev_automation_config()
        .lock()
        .map_err(|_| "dev automation config lock poisoned")? = Some(payload.clone());
    tracing::info!("[dev-control] stored diagnostic configuration");
    write_json_response(stream, 202, &json!({ "ok": true }))
}

fn build_state_response(
    app: &AppHandle,
) -> Result<DevStateResponse, Box<dyn std::error::Error + Send + Sync>> {
    let services = app.state::<AppServices>();
    let registry = services.registry();
    let relay_diagnostics = relay_diagnostics_blocking(services.copilot_bridge());
    let automation_config = dev_automation_config()
        .lock()
        .map_err(|_| "dev automation config lock poisoned")?
        .clone();
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
        automation_config,
        latest_session_id,
        sessions,
    })
}

fn build_session_state(
    session_id: &str,
    state: &crate::registry::SessionState,
    pending_approvals: Vec<DevPendingApprovalState>,
) -> DevSessionState {
    DevSessionState {
        session_id: session_id.to_string(),
        cwd: state.session_config.cwd.clone(),
        running: state.running,
        run_state: run_state_label(state.run_state).to_string(),
        last_stop_reason: state.last_stop_reason.clone(),
        retry_count: state.retry_count,
        message_count: 0,
        pending_approvals,
        tool_use_counts: BTreeMap::new(),
        tool_result_counts: BTreeMap::new(),
        tool_error_counts: BTreeMap::new(),
        last_assistant_text: None,
        current_copilot_request_id: state.current_copilot_request_id.clone(),
        stream_delta_count: state.stream_delta_count,
        first_stream_at_ms: state.first_stream_at_ms,
        last_stream_at_ms: state.last_stream_at_ms,
        stream_preview_text: state.stream_preview_text.clone(),
    }
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
