use std::{
    env,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    BrowserAutomationSettings, CheckCopilotConnectionRequest, CopilotBrowserErrorCode,
    CopilotBrowserProgressEvent, CopilotBrowserResult, CopilotConnectResult,
    SendCopilotPromptRequest,
};

const COPILOT_PROGRESS_EVENT: &str = "copilot-browser-progress";
const RESOURCE_SCRIPT_PATH: &str = "../scripts/dist/copilot-browser.js";

#[derive(Clone, Copy)]
enum BrowserCommandAction {
    Connect,
    Send,
}

struct BrowserCommandOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    cdp_port: Option<u16>,
}

#[tauri::command]
pub async fn send_copilot_prompt(
    app: AppHandle,
    request: SendCopilotPromptRequest,
) -> Result<CopilotBrowserResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match run_browser_command_blocking(
            &app,
            BrowserCommandAction::Send,
            request.settings,
            Some(request.prompt),
            request.progress_event_id,
        ) {
            Ok(output) => parse_send_result(output),
            Err(message) => CopilotBrowserResult::Error {
                error_code: CopilotBrowserErrorCode::SendFailed,
                message,
                cdp_port: None,
            },
        }
    })
    .await
    .map_err(|error| format!("Copilot browser task failed: {error}"))
}

#[tauri::command]
pub async fn check_copilot_connection(
    app: AppHandle,
    request: CheckCopilotConnectionRequest,
) -> Result<CopilotConnectResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match run_browser_command_blocking(
            &app,
            BrowserCommandAction::Connect,
            request.settings,
            None,
            request.progress_event_id,
        ) {
            Ok(output) => parse_connect_result(output),
            Err(message) => CopilotConnectResult::Error {
                error_code: CopilotBrowserErrorCode::SendFailed,
                message,
                cdp_port: None,
            },
        }
    })
    .await
    .map_err(|error| format!("Copilot browser task failed: {error}"))
}

fn run_browser_command_blocking(
    app: &AppHandle,
    action: BrowserCommandAction,
    settings: BrowserAutomationSettings,
    prompt: Option<String>,
    progress_event_id: Option<String>,
) -> Result<BrowserCommandOutput, String> {
    let script_path = resolve_browser_script_path(app)?;
    let mut args = vec![
        script_path.display().to_string(),
        "--action".to_string(),
        match action {
            BrowserCommandAction::Connect => "connect".to_string(),
            BrowserCommandAction::Send => "send".to_string(),
        },
    ];

    if settings.auto_launch_edge {
        args.push("--auto-launch".to_string());
    } else {
        args.push("--cdp-port".to_string());
        args.push(settings.cdp_port.to_string());
    }

    args.push("--timeout".to_string());
    args.push(settings.timeout_ms.to_string());

    if let Some(prompt) = prompt {
        args.push("--prompt".to_string());
        args.push(prompt);
    }

    let mut child = Command::new("node")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!("Failed to start the Copilot browser automation command: {error}")
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Copilot browser command did not expose stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Copilot browser command did not expose stderr.".to_string())?;

    let stderr_handle = thread::spawn(move || {
        let mut buffer = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buffer);
        buffer
    });

    let mut stdout_text = String::new();
    let mut resolved_cdp_port = None;
    let mut stdout_reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        let read = stdout_reader
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read Copilot browser output: {error}"))?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(progress) = parse_progress_event(trimmed, progress_event_id.as_deref()) {
            if let Some(request_id) = progress_event_id.as_ref() {
                let _ = app.emit(
                    COPILOT_PROGRESS_EVENT,
                    CopilotBrowserProgressEvent {
                        request_id: request_id.clone(),
                        step: progress.0,
                        detail: progress.1,
                    },
                );
            }
            continue;
        }

        if let Some(port) = extract_cdp_port(trimmed) {
            resolved_cdp_port = Some(port);
        }

        stdout_text.push_str(trimmed);
        stdout_text.push('\n');
    }

    let status = child
        .wait()
        .map_err(|error| format!("Failed to wait for Copilot browser command: {error}"))?;
    let stderr_text = stderr_handle.join().unwrap_or_default();

    Ok(BrowserCommandOutput {
        code: status.code(),
        stdout: stdout_text.trim().to_string(),
        stderr: stderr_text.trim().to_string(),
        cdp_port: resolved_cdp_port,
    })
}

fn resolve_browser_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("RELAY_AGENT_TEST_COPILOT_SCRIPT_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(RESOURCE_SCRIPT_PATH));
        candidates.push(
            resource_dir
                .join("scripts")
                .join("dist")
                .join("copilot-browser.js"),
        );
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join("apps")
                .join("desktop")
                .join("scripts")
                .join("dist")
                .join("copilot-browser.js"),
        );
    }

    candidates.push(
        manifest_dir
            .join("..")
            .join("scripts")
            .join("dist")
            .join("copilot-browser.js"),
    );

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "Could not resolve the path to copilot-browser.js. Run `pnpm --filter @relay-agent/desktop copilot-browser:build` and restart the app.".to_string()
        })
}

fn parse_progress_event(line: &str, request_id: Option<&str>) -> Option<(String, Option<String>)> {
    let payload: Value = serde_json::from_str(line).ok()?;
    let record = payload.as_object()?;
    if record.get("type")?.as_str()? != "progress" {
        return None;
    }

    let step = record.get("step")?.as_str()?.trim();
    if step.is_empty() {
        return None;
    }

    if request_id.is_none() {
        return Some((step.to_string(), None));
    }

    let detail = record
        .get("detail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    Some((step.to_string(), detail))
}

fn extract_cdp_port(line: &str) -> Option<u16> {
    let payload: Value = serde_json::from_str(line).ok()?;
    let port = payload.get("cdpPort")?.as_u64()?;
    u16::try_from(port).ok()
}

fn parse_send_result(output: BrowserCommandOutput) -> CopilotBrowserResult {
    if let Some(payload) = parse_json_line(&output.stdout) {
        if let Some(record) = payload.as_object() {
            if record.get("status").and_then(Value::as_str) == Some("ok") {
                if let Some(response) = record
                    .get("response")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return CopilotBrowserResult::Ok {
                        response: response.to_string(),
                        cdp_port: record
                            .get("cdpPort")
                            .and_then(Value::as_u64)
                            .and_then(|value| u16::try_from(value).ok())
                            .or(output.cdp_port),
                    };
                }
            }

            if record.get("status").and_then(Value::as_str) == Some("error") {
                return CopilotBrowserResult::Error {
                    error_code: parse_error_code(record.get("errorCode"))
                        .unwrap_or(CopilotBrowserErrorCode::SendFailed),
                    message: record
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(
                            "The Copilot browser command returned an error without a message.",
                        )
                        .to_string(),
                    cdp_port: record
                        .get("cdpPort")
                        .and_then(Value::as_u64)
                        .and_then(|value| u16::try_from(value).ok())
                        .or(output.cdp_port),
                };
            }
        }
    }

    if output.code == Some(0) && output.stdout.trim().is_empty() {
        return CopilotBrowserResult::Error {
            error_code: CopilotBrowserErrorCode::SendFailed,
            message: "The Copilot browser script exited without returning JSON.".to_string(),
            cdp_port: output.cdp_port,
        };
    }

    CopilotBrowserResult::Error {
        error_code: CopilotBrowserErrorCode::SendFailed,
        message: build_parse_error_message(
            &output,
            "The Copilot browser response did not match the expected JSON shape.",
        ),
        cdp_port: output.cdp_port,
    }
}

fn parse_connect_result(output: BrowserCommandOutput) -> CopilotConnectResult {
    if let Some(payload) = parse_json_line(&output.stdout) {
        if let Some(record) = payload.as_object() {
            if record.get("status").and_then(Value::as_str) == Some("ready") {
                if let Some(port) = record
                    .get("cdpPort")
                    .and_then(Value::as_u64)
                    .and_then(|value| u16::try_from(value).ok())
                    .or(output.cdp_port)
                {
                    return CopilotConnectResult::Ready { cdp_port: port };
                }
            }

            if record.get("status").and_then(Value::as_str) == Some("error") {
                return CopilotConnectResult::Error {
                    error_code: parse_error_code(record.get("errorCode"))
                        .unwrap_or(CopilotBrowserErrorCode::SendFailed),
                    message: record
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(
                            "The Copilot browser command returned an error without a message.",
                        )
                        .to_string(),
                    cdp_port: record
                        .get("cdpPort")
                        .and_then(Value::as_u64)
                        .and_then(|value| u16::try_from(value).ok())
                        .or(output.cdp_port),
                };
            }
        }
    }

    CopilotConnectResult::Error {
        error_code: CopilotBrowserErrorCode::SendFailed,
        message: build_parse_error_message(
            &output,
            "The connect response did not match the expected JSON shape.",
        ),
        cdp_port: output.cdp_port,
    }
}

fn parse_json_line(stdout: &str) -> Option<Value> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

fn parse_error_code(value: Option<&Value>) -> Option<CopilotBrowserErrorCode> {
    match value?.as_str()? {
        "CDP_UNAVAILABLE" => Some(CopilotBrowserErrorCode::CdpUnavailable),
        "NOT_LOGGED_IN" => Some(CopilotBrowserErrorCode::NotLoggedIn),
        "RESPONSE_TIMEOUT" => Some(CopilotBrowserErrorCode::ResponseTimeout),
        "COPILOT_ERROR" => Some(CopilotBrowserErrorCode::CopilotError),
        "SEND_FAILED" => Some(CopilotBrowserErrorCode::SendFailed),
        _ => None,
    }
}

fn build_parse_error_message(output: &BrowserCommandOutput, reason: &str) -> String {
    let details = if !output.stderr.trim().is_empty() {
        output.stderr.trim()
    } else {
        output.stdout.trim()
    };

    if details.is_empty() {
        reason.to_string()
    } else {
        format!("{reason} {details}")
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_connect_result, parse_send_result, BrowserCommandOutput};
    use crate::models::{CopilotBrowserErrorCode, CopilotBrowserResult, CopilotConnectResult};

    #[test]
    fn parse_send_result_returns_structured_send_failed_on_invalid_json() {
        let result = parse_send_result(BrowserCommandOutput {
            code: Some(0),
            stdout: "not-json".to_string(),
            stderr: "".to_string(),
            cdp_port: None,
        });

        match result {
            CopilotBrowserResult::Error { error_code, .. } => {
                assert_eq!(error_code, CopilotBrowserErrorCode::SendFailed);
            }
            CopilotBrowserResult::Ok { .. } => panic!("expected structured error"),
        }
    }

    #[test]
    fn parse_connect_result_reads_ready_status() {
        let result = parse_connect_result(BrowserCommandOutput {
            code: Some(0),
            stdout: r#"{"status":"ready","cdpPort":9333}"#.to_string(),
            stderr: "".to_string(),
            cdp_port: None,
        });

        match result {
            CopilotConnectResult::Ready { cdp_port } => assert_eq!(cdp_port, 9333),
            CopilotConnectResult::Error { .. } => panic!("expected ready result"),
        }
    }
}
