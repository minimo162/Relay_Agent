use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::cdp_copilot;
use crate::models::{
    CancelAgentRequest, GetAgentSessionHistoryRequest, McpAddServerRequest, McpServerInfo,
    RespondAgentApprovalRequest, StartAgentRequest,
};
use crate::registry::SessionRegistry;

/* ── Copilot Server management ─────────────────────────────── *
 * Uses copilot_server.js (Playwright-based HTTP proxy) instead  *
 * of direct CDP WebSocket. This works around VBS/Code Integrity *
 * error 577 in corporate environments.                         */

struct CopilotServerState {
    server: Arc<tokio::sync::Mutex<crate::copilot_server::CopilotServer>>,
    port: u16,
    cdp_port: u16,
    started: bool,
}

static COPILOT_SERVER: OnceLock<Mutex<Option<CopilotServerState>>> = OnceLock::new();

fn copilot_server_state() -> &'static Mutex<Option<CopilotServerState>> {
    COPILOT_SERVER.get_or_init(|| Mutex::new(None))
}

const COPILOT_SERVER_CDP_PORT: u16 = 9333;
const COPILOT_SERVER_HTTP_PORT: u16 = 18080;

fn default_user_data_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|d| PathBuf::from(d).join("RelayAgent").join("edge-profile"))
    } else {
        std::env::var("HOME")
            .ok()
            .map(|d| PathBuf::from(d).join("RelayAgent").join("edge-profile"))
    }
}

/// Initialize and ensure the copilot server is ready.
/// This is called before agent loop starts.
fn ensure_copilot_server_initialized(server_port: u16, cdp_port: u16) -> Result<Arc<tokio::sync::Mutex<crate::copilot_server::CopilotServer>>, String> {
    let arc_server = {
        let state = copilot_server_state().lock().map_err(|e| format!("lock poisoned: {e}"))?;
        if let Some(existing) = state.as_ref() {
            if existing.port == server_port && existing.cdp_port == cdp_port {
                return Ok(Arc::clone(&existing.server));
            }
            // Different config; restart needed (will be handled below)
        }
        let new_server = crate::copilot_server::CopilotServer::new(
            server_port,
            cdp_port,
            default_user_data_dir(),
            None, // edge_path: auto-discovered by copilot_server.js
        ).map_err(|e| format!("copilot server init: {e}"))?;
        Arc::new(tokio::sync::Mutex::new(new_server))
    };

    // Actually initialize the state
    let mut state = copilot_server_state().lock().map_err(|e| format!("lock poisoned: {e}"))?;

    if let Some(existing) = state.as_ref() {
        if existing.port == server_port && existing.cdp_port == cdp_port && existing.started {
            return Ok(Arc::clone(&existing.server));
        }
    }

    *state = Some(CopilotServerState {
        server: Arc::clone(&arc_server),
        port: server_port,
        cdp_port,
        started: false,
    });

    Ok(arc_server)
}

/// Get or initialize the copilot server for use by the agent loop.
pub fn ensure_copilot_server() -> Result<Arc<tokio::sync::Mutex<crate::copilot_server::CopilotServer>>, String> {
    let server_port = COPILOT_SERVER_HTTP_PORT;
    let cdp_port = COPILOT_SERVER_CDP_PORT;
    let server = ensure_copilot_server_initialized(server_port, cdp_port)?;

    // Start it synchronously if not running
    let start_result = {
        let mut state = copilot_server_state().lock().map_err(|e| format!("lock poisoned: {e}"))?;
        if let Some(ref mut s) = state.as_mut() {
            if !s.started {
                // Cannot await here — start in a blocking manner
                // Actually we need async; use block_on
                let server_clone = Arc::clone(&s.server);
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| format!("runtime: {e}"))?;
                let res = rt.block_on(async {
                    let mut srv = server_clone.lock().await;
                    srv.start().await
                });
                s.started = res.is_ok();
                res.map_err(|e| format!("{e}"))
            } else {
                Ok(())
            }
        } else {
            Err("copilot server state not initialized".to_string())
        }
    };

    if let Err(e) = start_result {
        return Err(format!("copilot server failed to start: {e}"));
    }

    Ok(server)
}

// Re-export registry and agent_loop types for external consumers
pub use crate::agent_loop::{AgentErrorEvent, AgentSessionHistoryResponse};
pub use crate::registry::SessionEntry;

// What we need from agent_loop
use crate::agent_loop::E_ERROR;
use crate::agent_loop::{msg_to_relay, run_agent_loop_impl};

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
        finished_at: None,
    };
    let cancelled = Arc::clone(&entry.cancelled);
    registry
        .insert(session_id.clone(), entry)
        .map_err(|e| e.to_string())?;

    let app_for_task = app.clone();
    let sid_for_task = session_id.clone();
    let reg_for_task = registry.inner().clone();

    // Periodically evict stale sessions to prevent memory leaks
    let ttl_seconds = crate::config::AgentConfig::global()
        .session_cleanup_ttl_minutes
        .cast_signed()
        * 60;
    if let Err(e) = registry.cleanup_stale_sessions(ttl_seconds) {
        tracing::warn!("[RelayAgent] stale session cleanup failed: {e}");
    }

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
                    error: err.to_string(),
                    cancelled: false,
                };
                if let Err(e) = app_for_task.emit(E_ERROR, &evt) {
                    tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
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
                tracing::error!("[RelayAgent] agent loop panicked ({sid_for_task}): {msg}");
                let evt = AgentErrorEvent {
                    session_id: sid_for_task.clone(),
                    error: format!("agent loop panicked: {msg}"),
                    cancelled: false,
                };
                if let Err(e) = app_for_task.emit(E_ERROR, &evt) {
                    tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
                }
            }
        }

        // Always clean up session state, even on panic
        let _ignore = reg_for_task
            .mutate_session(&sid_for_task, super::registry::SessionEntry::mark_finished);

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

        let cmd_result = handle_slash_command("/compact", &entry.session, config)
            .ok_or_else(|| "compact command is only available for existing sessions".to_string())?;

        let _removed = cmd_result.message.len();
        let removed_count = entry
            .session
            .messages
            .len()
            .saturating_sub(cmd_result.session.messages.len());

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
    // Mark cancelled and drain approvals via the registry API
    if let Ok(mut data) = registry.data.lock() {
        if let Some(entry) = data.get_mut(&request.session_id) {
            entry.cancelled.store(true, Ordering::Relaxed);
            entry.running = false;
        }
    }
    // Drain approvals and reject them all
    match registry.drain_approvals(&request.session_id) {
        Ok(senders) => {
            for tx in senders {
                let _ = tx.send(false);
            }
        }
        Err(e) => {
            tracing::error!("[RelayAgent] drain approvals failed during cancel: {e}");
        }
    }

    let evt = AgentErrorEvent {
        session_id: request.session_id.clone(),
        error: "session cancelled by user".into(),
        cancelled: true,
    };
    if let Err(e) = app.emit(E_ERROR, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
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

    let loaded = crate::copilot_persistence::load_session(&request.session_id)
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

/// Shared state: tracks the session for auto-launched Edge + connection status.
struct CdpSessionState {
    /// Port of our auto-launched Edge instance (if any).
    launched_port: Option<u16>,
    /// Whether the frontend currently has an active CDP connection.
    connected: bool,
    /// URL of the Copilot page (if connected).
    page_url: Option<String>,
    /// Connected Copilot page for agent loop use.
    page: Option<cdp_copilot::CopilotPage>,
}

static CDP_SESSION: OnceLock<Mutex<CdpSessionState>> = OnceLock::new();

fn cdp_session() -> &'static Mutex<CdpSessionState> {
    CDP_SESSION.get_or_init(|| {
        Mutex::new(CdpSessionState {
            launched_port: None,
            connected: false,
            page_url: None,
            page: None,
        })
    })
}

fn get_cdp_debug_url(preferred_base: u16) -> String {
    match cdp_session().lock() {
        Ok(state) => {
            if let Some(port) = state.launched_port {
                format!("http://127.0.0.1:{port}")
            } else {
                format!("http://127.0.0.1:{preferred_base}")
            }
        }
        Err(e) => {
            tracing::warn!("[CDP] cdp_session lock poisoned in get_cdp_debug_url: {e}");
            format!("http://127.0.0.1:{preferred_base}")
        }
    }
}

fn cdp_is_connected() -> bool {
    cdp_session().lock().map_or(false, |s| s.connected)
}

fn mark_cdp_connected(port: u16, page_url: String, page: cdp_copilot::CopilotPage) {
    if let Ok(mut state) = cdp_session().lock() {
        state.launched_port = Some(port);
        state.connected = true;
        state.page_url = Some(page_url);
        state.page = Some(page);
    } else {
        tracing::warn!("[CDP] cdp_session lock poisoned in mark_cdp_connected");
    }
}

fn mark_cdp_disconnected() {
    if let Ok(mut state) = cdp_session().lock() {
        state.connected = false;
        state.page_url = None;
        state.page = None;
    } else {
        tracing::warn!("[CDP] cdp_session lock poisoned in mark_cdp_disconnected");
    }
}

/// Get the current CDP CopilotPage for use by the agent loop.
pub fn get_cdp_page() -> Result<cdp_copilot::CopilotPage, String> {
    let state = cdp_session()
        .lock()
        .map_err(|e| format!("cdp_session lock poisoned: {e}"))?;
    state
        .page
        .clone()
        .ok_or_else(|| "CDP not connected — call connect_cdp first".to_string())
}

/// Ensure a CDP connection is available, auto-connecting if needed.
/// This allows the agent loop to start without requiring a prior `connect_cdp` call.
/// If already connected (e.g. via `connect_cdp`), returns the existing page immediately.
pub fn ensure_cdp_connected() -> Result<cdp_copilot::CopilotPage, String> {
    // Fast path: already connected via `connect_cdp`
    if let Ok(state) = cdp_session().lock() {
        if let Some(ref page) = state.page {
            return Ok(page.clone());
        }
    }

    // Slow path: auto-connect CDP
    let debug_url = get_cdp_debug_url(9333);
    tracing::info!("[CDP] auto-connecting to {} (start_agent)…", debug_url);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("CDP: failed to create runtime: {e}"))?;

    let result = rt
        .block_on(async {
            cdp_copilot::connect_copilot_page(&debug_url, true, 9333).await
        })
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Microsoft Edge could not be found") {
                format!("CDP: Microsoft Edge is not installed. Please install Edge and try again.")
            } else if msg.contains("Edge did not become ready") {
                format!("CDP: Edge did not start within 30 seconds. It may be blocked by a security policy.")
            } else {
                format!("CDP: {msg}")
            }
        })?;

    let page = result.page.clone();
    let port = result.port;
    let page_url = result.page.url.clone();

    if result.launched {
        // Edge was auto-launched: track port so disconnect_cdp can clean it up
        mark_cdp_connected(port, page_url, page.clone());
    } else {
        // Existing browser: mark connected but don't track a launched port
        if let Ok(mut state) = cdp_session().lock() {
            state.connected = true;
            state.page_url = Some(page_url);
            state.page = Some(page.clone());
        }
    }

    tracing::info!("[CDP] auto-connected to {}", page.url);
    // ConnectionResult dropped here; its Edge process ownership is no longer needed
    // since the port is tracked in CdpSessionState and disconnect_cdp handles cleanup.

    Ok(page)
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
    // If already connected, return current status
    {
        let state = cdp_session().lock().map_err(|e| format!("cdp_session lock poisoned: {e}"))?;
        if state.connected {
            return Ok(CdpConnectResult {
                ok: true,
                debug_url: state.launched_port.map_or_else(
                    || format!("http://127.0.0.1:{}", request.base_port.unwrap_or(9222)),
                    |p| format!("http://127.0.0.1:{p}"),
                ),
                page_url: state.page_url.clone().unwrap_or_default(),
                page_title: String::new(),
                port: state.launched_port,
                launched: state.launched_port.is_some(),
                error: None,
            });
        }
    }

    let auto_launch = request.auto_launch.unwrap_or(true);
    let base_port = request.base_port.unwrap_or(9222);
    let debug_url = get_cdp_debug_url(base_port);

    tracing::info!(
        "[CDP] connect → {} (auto_launch={})",
        debug_url,
        auto_launch
    );

    match cdp_copilot::connect_copilot_page(&debug_url, auto_launch, base_port).await {
        Ok(res) => {
            tracing::info!("[CDP] connected → {} — {}", res.page.url, res.page.title);
            if res.launched {
                mark_cdp_connected(res.port, res.page.url.clone(), res.page.clone());
            } else {
                // Existing browser: still mark as connected but don't track port as launched
                if let Ok(mut state) = cdp_session().lock() {
                    state.connected = true;
                    state.page_url = Some(res.page.url.clone());
                    state.page = Some(res.page.clone());
                } else {
                    tracing::warn!("[CDP] cdp_session lock poisoned during connect");
                }
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
    let debug_url = get_cdp_debug_url(9222);
    let timeout_secs = request.wait_response_secs.unwrap_or(120);

    let prompt_preview = &request.prompt[..request.prompt.len().min(60)];
    tracing::info!("[CDP] send prompt: {prompt_preview}…");

    // Use existing connection if available, otherwise connect fresh
    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, 9222).await {
        Ok(r) => r.page.clone(),
        Err(e) => {
            return Ok(CdpPromptResult {
                ok: false,
                response_text: String::new(),
                body_length: 0,
                error: Some(format!("CDP connect: {e}")),
            })
        }
    };

    if let Err(e) = page.send_prompt(&request.prompt).await {
        return Ok(CdpPromptResult {
            ok: false,
            response_text: String::new(),
            body_length: 0,
            error: Some(format!("Send: {e}")),
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
                error: Some(format!("Response timeout: {e}")),
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
    let debug_url = get_cdp_debug_url(base_port);

    let res = match cdp_copilot::connect_copilot_page(&debug_url, auto_launch, base_port).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(CdpConnectResult {
                ok: false,
                debug_url,
                page_url: String::new(),
                page_title: String::new(),
                port: None,
                launched: false,
                error: Some(e.to_string()),
            })
        }
    };

    if res.launched {
        mark_cdp_connected(res.port, res.page.url.clone(), res.page.clone());
    }

    if let Err(e) = res.page.navigate_to_chat().await {
        return Ok(CdpConnectResult {
            ok: false,
            debug_url: debug_url.clone(),
            page_url: res.page.url.clone(),
            page_title: res.page.title.clone(),
            port: Some(res.port),
            launched: res.launched,
            error: Some(format!("Navigate: {e}")),
        });
    }

    Ok(CdpConnectResult {
        ok: true,
        debug_url,
        page_url: res.page.url.clone(),
        page_title: res.page.title.clone(),
        port: Some(res.port),
        launched: res.launched,
        error: None,
    })
}

/// Disconnect from the Copilot page and clean up the browser if it was auto-launched.
#[tauri::command]
pub async fn disconnect_cdp(_app: AppHandle) -> Result<(), String> {
    // Use the tracked port to avoid reconnecting to the CDP endpoint.
    // The ConnectionResult from a prior connect_copilot_page() call owns the Edge child
    // process, but since CDP commands are one-shot (open WS → send → close), we can
    // kill the process directly by port ownership.
    let launched_port = cdp_session()
        .lock()
        .map_err(|e| format!("cdp_session lock poisoned: {e}"))?
        .launched_port;

    if let Some(port) = launched_port {
        tracing::info!("[CDP] disconnect: killing auto-launched Edge (port {port})");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            // Kill Edge processes that use our isolated profile directory
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/FI", &format!("WINDOWTITLE eq *{}*", port)])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "msedge.exe", "/FI", &format!("CMDLINE eq *RelayAgentEdgeProfile*")])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Match the actual profile directory name used in cdp_copilot.rs
            let _ = std::process::Command::new("pkill")
                .arg("-f")
                .arg("RelayAgentEdgeProfile")
                .output();
        }
    }

    mark_cdp_disconnected();
    tracing::info!("[CDP] disconnected");
    Ok(())
}

#[tauri::command]
pub async fn cdp_screenshot(_app: AppHandle) -> Result<serde_json::Value, String> {
    let debug_url = get_cdp_debug_url(9222);

    // If already connected, reuse the session; otherwise do a fresh lookup
    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, 9222).await {
        Ok(r) => r.page.clone(),
        Err(e) => return Err(format!("CDP connect: {e}")),
    };

    let tmp = std::env::temp_dir().join("relay_cdp_screenshot.png");
    page.screenshot(tmp.to_str().unwrap_or("screenshot.png"))
        .await
        .map_err(|e| format!("Screenshot: {e}"))?;

    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(serde_json::json!({ "ok": true, "format": "png", "data": b64 }))
}

/* ── MCP Server Management ─────────────────────────────────── */

/// Global registry of MCP servers keyed by name.
static MCP_SERVER_REGISTRY: OnceLock<Mutex<HashMap<String, McpServerInfo>>> = OnceLock::new();

fn mcp_registry() -> &'static Mutex<HashMap<String, McpServerInfo>> {
    MCP_SERVER_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn new_server_info(name: &str, command: &str, args: Vec<String>) -> McpServerInfo {
    McpServerInfo {
        name: name.to_string(),
        command: command.to_string(),
        args,
        status: "registered".to_string(),
        connected: false,
        tools: Vec::new(),
    }
}

/// List all registered MCP servers.
#[tauri::command]
pub fn mcp_list_servers() -> Result<Vec<McpServerInfo>, String> {
    let registry = mcp_registry();
    let data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    let mut servers: Vec<McpServerInfo> = data.values().cloned().collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(servers)
}

/// Add an MCP server to the registry, or replace an existing one.
/// If the server was already connected, it is reset to disconnected.
#[tauri::command]
pub fn mcp_add_server(request: McpAddServerRequest) -> Result<McpServerInfo, String> {
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("server name must not be empty".into());
    }

    let command = request.command.trim().to_string();
    if command.is_empty() {
        return Err("command must not be empty".into());
    }

    let registry = mcp_registry();
    let mut data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;

    let info = new_server_info(&name, &command, request.args);
    data.insert(name.clone(), info.clone());
    Ok(info)
}

/// Remove an MCP server from the registry.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn mcp_remove_server(name: String) -> Result<bool, String> {
    let registry = mcp_registry();
    let mut data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    Ok(data.remove(&name).is_some())
}

/// Check the status of a single MCP server.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn mcp_check_server_status(name: String) -> Result<McpServerInfo, String> {
    let registry = mcp_registry();
    let data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    data.get(&name)
        .cloned()
        .ok_or_else(|| format!("server `{name}` not found"))
}

/* ── Copilot Server (Playwright-based HTTP proxy) ──────────── */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotServerStatusResult {
    pub running: bool,
    pub port: u16,
    pub cdp_port: u16,
    pub server_url: String,
    pub connected: Option<bool>,
    pub login_required: Option<bool>,
    pub error: Option<String>,
}

/// Start the copilot server (Playwright-based HTTP proxy).
#[tauri::command]
pub async fn copilot_start(
    _app: AppHandle,
    _request: ConnectCdpRequest,
) -> Result<CopilotServerStatusResult, String> {
    let server_port = COPILOT_SERVER_HTTP_PORT;
    let cdp_port = _request.base_port.unwrap_or(COPILOT_SERVER_CDP_PORT);

    let server = ensure_copilot_server_initialized(server_port, cdp_port)?;

    {
        let mut srv = server.lock().await;
        if !srv.is_running() {
            srv.start().await.map_err(|e| format!("copilot server: {e}"))?;
            if let Ok(mut state) = copilot_server_state().lock() {
                if let Some(ref mut s) = state.as_mut() {
                    s.started = true;
                }
            }
        }
    }

    let result = server.lock().await.status().await.ok();

    Ok(CopilotServerStatusResult {
        running: true,
        port: server_port,
        cdp_port,
        server_url: format!("http://127.0.0.1:{server_port}"),
        connected: result.as_ref().map(|r| r.connected),
        login_required: result.as_ref().map(|r| r.login_required),
        error: None,
    })
}

/// Stop the copilot server.
#[tauri::command]
pub async fn copilot_stop(_app: AppHandle) -> Result<bool, String> {
    let server_option = {
        let mut state = copilot_server_state().lock().map_err(|e| format!("lock poisoned: {e}"))?;
        if let Some(ref mut s) = state.as_mut() {
            s.started = false;
            Some(Arc::clone(&s.server))
        } else {
            None
        }
    };

    if let Some(server) = server_option {
        server.lock().await.stop();
    }
    Ok(true)
}

/// Check the status of the copilot server.
#[tauri::command]
pub async fn copilot_status(_app: AppHandle) -> Result<CopilotServerStatusResult, String> {
    let server_option = {
        let state = copilot_server_state().lock().map_err(|e| format!("lock poisoned: {e}"))?;
        state.as_ref().map(|s| (s.server.clone(), s.port, s.cdp_port))
    };

    let Some((server, port, cdp_port)) = server_option else {
        return Ok(CopilotServerStatusResult {
            running: false,
            port: COPILOT_SERVER_HTTP_PORT,
            cdp_port: COPILOT_SERVER_CDP_PORT,
            server_url: format!("http://127.0.0.1:{}", COPILOT_SERVER_HTTP_PORT),
            connected: None,
            login_required: None,
            error: Some("not initialized".to_string()),
        });
    };

    let server_guard = server.lock().await;
    let running = server_guard.is_running();

    if running {
        match server_guard.status().await {
            Ok(status) => Ok(CopilotServerStatusResult {
                running: true,
                port,
                cdp_port,
                server_url: server_guard.server_url(),
                connected: Some(status.connected),
                login_required: Some(status.login_required),
                error: None,
            }),
            Err(e) => Ok(CopilotServerStatusResult {
                running: false,
                port,
                cdp_port,
                server_url: server_guard.server_url(),
                connected: None,
                login_required: None,
                error: Some(format!("{e}")),
            }),
        }
    } else {
        Ok(CopilotServerStatusResult {
            running: false,
            port,
            cdp_port,
            server_url: server_guard.server_url(),
            connected: None,
            login_required: None,
            error: Some("not running".to_string()),
        })
    }
}
