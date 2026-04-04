use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Arc, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::cdp_copilot;
use crate::models::*;
use crate::registry::SessionRegistry;

// Re-export registry and agent_loop types for external consumers
pub use crate::registry::SessionEntry;
pub use crate::agent_loop::{
    AgentApprovalNeededEvent, AgentErrorEvent, AgentSessionHistoryResponse,
    AgentTextDeltaEvent, AgentToolResultEvent, AgentToolStartEvent, AgentTurnCompleteEvent,
    MessageContent, RelayMessage,
};

// What we need from agent_loop
use crate::agent_loop::{
    run_agent_loop_impl, msg_to_relay,
};
use crate::agent_loop::E_ERROR;

/* ── Tauri commands ─── */

/// Limits concurrent agent sessions to prevent resource exhaustion.
/// Default: 4 simultaneous agents.
static AGENT_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

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
        session: runtime::Session::new(),
        running: true,
        cancelled: Arc::new(AtomicBool::new(false)),
        approvals: Mutex::new(HashMap::new()),
    };
    let cancelled = Arc::clone(&entry.cancelled);
    registry
        .data
        .lock()
        .map_err(|e| format!("session registry lock poisoned: {e}"))?
        .insert(session_id.clone(), entry);

    let app_for_task = app.clone();
    let sid_for_task = session_id.clone();
    let reg_for_task = registry.inner().clone();

    let permit = AGENT_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "agent concurrency limit reached — try again later".to_string())?;

    tokio::task::spawn_blocking(move || {
        // Catch panics to prevent silent thread death and stuck sessions
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_agent_loop_impl(
                &app_for_task,
                &reg_for_task,
                &sid_for_task,
                goal,
                request.cwd,
                request.max_turns,
                cancelled,
            )
        }));

        match result {
            Ok(Ok(())) => {
                // Normal completion — no event needed (turn_complete already emitted)
            }
            Ok(Err(err)) => {
                let evt = AgentErrorEvent {
                    session_id: sid_for_task.clone(),
                    error: err,
                    cancelled: false,
                };
                if let Err(e) = app_for_task.emit(E_ERROR, &evt) {
                    eprintln!("[RelayAgent] emit failed ({E_ERROR}): {e}");
                }
            }
            Err(panic_info) => {
                let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "agent loop panicked with unknown payload".to_string()
                };
                eprintln!("[RelayAgent] agent loop panicked ({sid_for_task}): {msg}");
                let evt = AgentErrorEvent {
                    session_id: sid_for_task.clone(),
                    error: format!("agent loop panicked: {msg}"),
                    cancelled: false,
                };
                if let Err(e) = app_for_task.emit(E_ERROR, &evt) {
                    eprintln!("[RelayAgent] emit failed ({E_ERROR}): {e}");
                }
            }
        }

        // Always clean up session state, even on panic
        if let Ok(mut data) = reg_for_task.data.lock() {
            if let Some(entry) = data.get_mut(&sid_for_task) {
                entry.running = false;
            }
        }

        // Release concurrency slot
        drop(permit);
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn respond_approval(
    _app: AppHandle,
    registry: State<'_, SessionRegistry>,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    let data = registry
        .data
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    let entry = data
        .get(&request.session_id)
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;

    let tx = entry
        .approvals
        .lock()
        .map_err(|e| format!("approvals lock poisoned: {e}"))?
        .remove(&request.approval_id)
        .ok_or_else(|| format!("approval `{}` not pending", request.approval_id))?;

    drop(data);

    tx.send(request.approved)
        .map_err(|_| "approval channel closed — session may have ended".into())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactAgentSessionRequest {
    pub session_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactAgentSessionResponse {
    pub message: String,
    pub removed_message_count: usize,
}

#[tauri::command]
pub async fn compact_agent_session(
    registry: State<'_, SessionRegistry>,
    request: CompactAgentSessionRequest,
) -> Result<CompactAgentSessionResponse, String> {
    use commands::handle_slash_command;
    use runtime::CompactionConfig;

    let result = {
        let mut data = registry
            .data
            .lock()
            .map_err(|e| format!("registry lock poisoned: {e}"))?;
        let entry = data
            .get_mut(&request.session_id)
            .ok_or_else(|| format!("session `{}` not found", request.session_id))?;

        let config = CompactionConfig {
            preserve_recent_messages: 2,
            max_estimated_tokens: 4000,
        };

        let cmd_result = handle_slash_command(
            "/compact",
            &entry.session,
            config,
        )
        .ok_or_else(|| "compact command is only available for existing sessions".to_string())?;

        let removed = cmd_result.message.len();
        let removed_count = entry.session.messages.len().saturating_sub(cmd_result.session.messages.len());

        entry.session = cmd_result.session;
        CompactAgentSessionResponse {
            message: cmd_result.message,
            removed_message_count: removed_count,
        }
    };

    Ok(result)
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
            for (_, tx) in entry.approvals.lock().unwrap_or_else(|e| {
                eprintln!("[RelayAgent] approvals lock poisoned during cancel: {e}");
                e.into_inner()
            }).drain() {
                let _ = tx.send(false);
            }
        }
    }

    let evt = AgentErrorEvent {
        session_id: request.session_id,
        error: "agent session was cancelled".into(),
        cancelled: true,
    };
    if let Err(e) = app.emit(E_ERROR, &evt) {
        eprintln!("[RelayAgent] emit failed ({E_ERROR}): {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_session_history(
    registry: State<'_, SessionRegistry>,
    request: GetAgentSessionHistoryRequest,
) -> Result<AgentSessionHistoryResponse, String> {
    let maybe_loaded = {
        let data = registry
            .data
            .lock()
            .map_err(|e| format!("registry lock poisoned: {e}"))?;
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

    let api_client = crate::copilot_client::CopilotApiClient::new_with_default_settings();
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

/* ── CDP Copilot Tauri commands ────────────────────────────── */

/// Shared state: tracks the port of our auto-launched Edge.
static LAUNCHED_EDGE_PORT: OnceLock<Arc<Mutex<Option<u16>>>> = OnceLock::new();

fn launched_port_state() -> Arc<Mutex<Option<u16>>> {
    Arc::clone(
        LAUNCHED_EDGE_PORT
            .get_or_init(|| Arc::new(Mutex::new(None))),
    )
}

fn get_launched_port() -> Option<u16> {
    launched_port_state().lock().unwrap().clone()
}

fn set_launched_port(port: u16) {
    *launched_port_state().lock().unwrap() = Some(port);
}

fn resolve_debug_url(preferred_base: u16) -> String {
    if let Some(port) = get_launched_port() {
        format!("http://127.0.0.1:{}", port)
    } else {
        format!("http://127.0.0.1:{}", preferred_base)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectCdpRequest {
    /// If true and no existing browser is found, auto-launch a dedicated Edge.
    #[serde(default)]
    pub auto_launch: Option<bool>,
    /// Preferred base port (default: 9222). Tries 9222, 9223, …
    #[serde(default)]
    pub base_port: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpSendPromptRequest {
    pub prompt: String,
    #[serde(default)]
    pub wait_response_secs: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpConnectResult {
    pub ok: bool,
    pub debug_url: String,
    pub page_url: String,
    pub page_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default)]
    pub launched: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpPromptResult {
    pub ok: bool,
    pub response_text: String,
    pub body_length: usize,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn connect_cdp(
    _app: AppHandle,
    request: ConnectCdpRequest,
) -> Result<CdpConnectResult, String> {
    let auto_launch = request.auto_launch.unwrap_or(true);
    let base_port = request.base_port.unwrap_or(9222);
    let debug_url = resolve_debug_url(base_port);

    tracing::info!("[CDP] connect → {} (auto_launch={})", debug_url, auto_launch);

    match cdp_copilot::connect_copilot_page(&debug_url, auto_launch, base_port).await {
        Ok(res) => {
            tracing::info!("[CDP] connected → {} — {}", res.page.url, res.page.title);
            if res.launched {
                set_launched_port(res.port);
            }
            Ok(CdpConnectResult {
                ok: true,
                debug_url: format!("http://127.0.0.1:{}", res.port),
                page_url: res.page.url.clone(),
                page_title: res.page.title.clone(),
                port: Some(res.port),
                launched: res.launched,
                error: None,
            })
        }
        Err(e) => Ok(CdpConnectResult {
            ok: false,
            debug_url,
            page_url: String::new(),
            page_title: String::new(),
            port: None,
            launched: false,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn cdp_send_prompt(
    _app: AppHandle,
    request: CdpSendPromptRequest,
) -> Result<CdpPromptResult, String> {
    let debug_url = resolve_debug_url(9222);
    let timeout_secs = request.wait_response_secs.unwrap_or(120);

    let prompt_preview = &request.prompt[..request.prompt.len().min(60)];
    tracing::info!("[CDP] send prompt: {}…", prompt_preview);

    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, 9222).await {
        Ok(r) => r.page,
        Err(e) => return Ok(CdpPromptResult {
            ok: false, response_text: String::new(), body_length: 0,
            error: Some(format!("CDP connect: {}", e)),
        }),
    };

    if let Err(e) = page.send_prompt(&request.prompt).await {
        return Ok(CdpPromptResult {
            ok: false, response_text: String::new(), body_length: 0,
            error: Some(format!("Send: {}", e)),
        });
    }

    let response = match page.wait_for_response(timeout_secs).await {
        Ok(t) => t,
        Err(e) => {
            let partial = page.body_text().await.unwrap_or_default();
            return Ok(CdpPromptResult {
                ok: false,
                response_text: partial.clone(),
                body_length: partial.len(),
                error: Some(format!("Response timeout: {}", e)),
            });
        }
    };

    tracing::info!("[CDP] response {} chars", response.len());
    Ok(CdpPromptResult {
        ok: true,
        response_text: response.clone(),
        body_length: response.len(),
        error: None,
    })
}

#[tauri::command]
pub async fn cdp_start_new_chat(
    _app: AppHandle,
    request: ConnectCdpRequest,
) -> Result<CdpConnectResult, String> {
    let auto_launch = request.auto_launch.unwrap_or(true);
    let base_port = request.base_port.unwrap_or(9222);
    let debug_url = resolve_debug_url(base_port);

    let res = match cdp_copilot::connect_copilot_page(&debug_url, auto_launch, base_port).await {
        Ok(r) => r,
        Err(e) => return Ok(CdpConnectResult {
            ok: false, debug_url, page_url: String::new(),
            page_title: String::new(), port: None, launched: false,
            error: Some(e.to_string()),
        }),
    };

    if res.launched { set_launched_port(res.port); }

    if let Err(e) = res.page.navigate_to_chat().await {
        return Ok(CdpConnectResult {
            ok: false, debug_url: debug_url.clone(),
            page_url: res.page.url.clone(), page_title: res.page.title.clone(),
            port: Some(res.port), launched: res.launched,
            error: Some(format!("Navigate: {}", e)),
        });
    }

    Ok(CdpConnectResult {
        ok: true, debug_url,
        page_url: res.page.url.clone(), page_title: res.page.title.clone(),
        port: Some(res.port), launched: res.launched, error: None,
    })
}

#[tauri::command]
pub async fn cdp_screenshot(_app: AppHandle) -> Result<serde_json::Value, String> {
    let debug_url = resolve_debug_url(9222);

    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, 9222).await {
        Ok(r) => r.page,
        Err(e) => return Err(format!("CDP connect: {}", e)),
    };

    let tmp = std::env::temp_dir().join("relay_cdp_screenshot.png");
    page.screenshot(tmp.to_str().unwrap_or("screenshot.png")).await
        .map_err(|e| format!("Screenshot: {}", e))?;

    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(serde_json::json!({ "ok": true, "format": "png", "data": b64 }))
}
