use serde::Deserialize;
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use tauri::{AppHandle, Emitter};

pub const DEV_FIRST_RUN_SEND_EVENT: &str = "relay:dev-first-run-send";
pub const DEV_APPROVE_LATEST_EVENT: &str = "relay:dev-approve-latest";
pub const DEV_APPROVE_LATEST_SESSION_EVENT: &str = "relay:dev-approve-latest-session";
pub const DEV_APPROVE_LATEST_WORKSPACE_EVENT: &str = "relay:dev-approve-latest-workspace";
pub const DEV_REJECT_LATEST_EVENT: &str = "relay:dev-reject-latest";
const DEFAULT_DEV_CONTROL_PORT: u16 = 18_411;

#[derive(Debug, Deserialize)]
struct DevFirstRunSendRequest {
    text: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFirstRunSendEvent {
    text: String,
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
            return write_json_response(
                &mut stream,
                413,
                &json!({ "ok": false, "error": "request_too_large" }),
            );
        }
    }

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
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();

    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("content-length") {
                return None;
            }
            value.trim().parse::<usize>().ok()
        })
        .unwrap_or(0);

    let mut body = buffer[(header_end + 4)..].to_vec();
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

    match (method, path) {
        ("GET", "/health") => write_json_response(
            &mut stream,
            200,
            &json!({ "ok": true, "port": port, "event": DEV_FIRST_RUN_SEND_EVENT }),
        ),
        ("POST", "/first-run-send") => {
            let payload: DevFirstRunSendRequest = serde_json::from_slice(&body)?;
            let text = payload.text.trim().to_string();
            if text.is_empty() {
                return write_json_response(
                    &mut stream,
                    400,
                    &json!({ "ok": false, "error": "missing_text" }),
                );
            }
            let event = DevFirstRunSendEvent { text };
            tracing::info!(
                "[dev-control] emitting {} via {} chars",
                DEV_FIRST_RUN_SEND_EVENT,
                event.text.chars().count()
            );
            app.emit(DEV_FIRST_RUN_SEND_EVENT, event)?;
            write_json_response(
                &mut stream,
                202,
                &json!({ "ok": true, "event": DEV_FIRST_RUN_SEND_EVENT }),
            )
        }
        ("POST", "/approve-latest") => {
            tracing::info!("[dev-control] emitting {}", DEV_APPROVE_LATEST_EVENT);
            app.emit(DEV_APPROVE_LATEST_EVENT, json!({ "mode": "once" }))?;
            write_json_response(
                &mut stream,
                202,
                &json!({ "ok": true, "event": DEV_APPROVE_LATEST_EVENT }),
            )
        }
        ("POST", "/approve-latest-session") => {
            tracing::info!(
                "[dev-control] emitting {}",
                DEV_APPROVE_LATEST_SESSION_EVENT
            );
            app.emit(
                DEV_APPROVE_LATEST_SESSION_EVENT,
                json!({ "mode": "session" }),
            )?;
            write_json_response(
                &mut stream,
                202,
                &json!({ "ok": true, "event": DEV_APPROVE_LATEST_SESSION_EVENT }),
            )
        }
        ("POST", "/approve-latest-workspace") => {
            tracing::info!(
                "[dev-control] emitting {}",
                DEV_APPROVE_LATEST_WORKSPACE_EVENT
            );
            app.emit(
                DEV_APPROVE_LATEST_WORKSPACE_EVENT,
                json!({ "mode": "workspace" }),
            )?;
            write_json_response(
                &mut stream,
                202,
                &json!({ "ok": true, "event": DEV_APPROVE_LATEST_WORKSPACE_EVENT }),
            )
        }
        ("POST", "/reject-latest") => {
            tracing::info!("[dev-control] emitting {}", DEV_REJECT_LATEST_EVENT);
            app.emit(DEV_REJECT_LATEST_EVENT, json!({ "mode": "reject" }))?;
            write_json_response(
                &mut stream,
                202,
                &json!({ "ok": true, "event": DEV_REJECT_LATEST_EVENT }),
            )
        }
        _ => write_json_response(
            &mut stream,
            404,
            &json!({ "ok": false, "error": "not_found" }),
        ),
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
