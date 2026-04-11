#![allow(clippy::needless_pass_by_value, clippy::unused_async)]

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;
use uuid::Uuid;

use std::time::Duration;

use crate::app_services::{AppServices, CopilotBridgeManager, CopilotServerState};
use crate::cdp_copilot;
use crate::models::{
    BrowserAutomationSettings, CancelAgentRequest, DesktopPermissionSummaryRow,
    GetAgentSessionHistoryRequest, GetPermissionSummaryRequest, ListWorkspaceSlashCommandsRequest,
    McpAddServerRequest, McpServerInfo, RelayDiagnostics, RespondAgentApprovalRequest,
    RespondUserQuestionRequest, RustAnalyzerProbeRequest, RustAnalyzerProbeResponse,
    SessionWriteUndoRequest, SessionWriteUndoStatusResponse, StartAgentRequest,
    WorkspaceAllowlistCwdRequest, WorkspaceAllowlistRemoveToolRequest, WorkspaceAllowlistSnapshot,
    WorkspaceInstructionSurfacesRequest, WorkspaceSlashCommandRow,
};
use crate::registry::{SessionHandle, SessionRegistry, SessionRunState, SessionState};
use runtime::MAX_TEXT_FILE_READ_BYTES;

/* ── Copilot Node bridge (copilot_server.js) ───────────────── *
 * Spawns Node + copilot_server.js, which attaches to Edge via *
 * CDP and drives M365 Copilot (Input.insertText + Edge launch). *
 * This is the default path so Edge opens without a global       *
 * `agent-browser` install. See `agent_browser_daemon.rs` for   *
 * an optional alternate approach.                               */

/// Notify the Node `copilot_server.js` bridge to abort an in-flight `describe` wait loop (best-effort).
async fn request_copilot_bridge_abort(bridge: Arc<CopilotBridgeManager>) {
    let Some(url) = bridge.lock().ok().and_then(|g| {
        g.as_ref().and_then(|st| {
            st.server
                .lock()
                .ok()
                .map(|srv| format!("{}/v1/chat/abort", srv.server_url()))
        })
    }) else {
        return;
    };
    match reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => tracing::info!(
            "[RelayAgent] copilot bridge abort POST status={}",
            resp.status()
        ),
        Err(e) => tracing::warn!("[RelayAgent] copilot bridge abort POST failed: {e}"),
    }
}

const COPILOT_HTTP_PORT: u16 = 18080;
/// M365 Copilot Edge CDP base port: must match `scripts/start-relay-edge-cdp.sh`, `copilot_server.js`, and Playwright defaults (`YakuLingo` uses 9333; Relay avoids collision).
const COPILOT_JS_CDP_PORT: u16 = 9360;

fn env_cdp_port_override() -> Option<u16> {
    std::env::var("RELAY_EDGE_CDP_PORT")
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&p| p > 0)
}

/// Effective CDP port: session `browser_settings` (if present) wins, then `RELAY_EDGE_CDP_PORT`, then default **9360**.
pub fn effective_cdp_port(browser_settings: Option<&BrowserAutomationSettings>) -> u16 {
    if let Some(bs) = browser_settings {
        if bs.cdp_port > 0 {
            return bs.cdp_port;
        }
    }
    env_cdp_port_override().unwrap_or(COPILOT_JS_CDP_PORT)
}

/// Spawns or reuses the Node `copilot_server.js` bridge with `--cdp-port` matching `desired_cdp_port`.
///
/// When the port must change and the bridge was already running, the Node process is stopped and
/// restarted unless `block_port_change_on_concurrent_sessions` is true **and** more than one agent
/// session is running (returns an error).
pub fn ensure_copilot_server(
    desired_cdp_port: u16,
    block_port_change_on_concurrent_sessions: bool,
    bridge: Arc<CopilotBridgeManager>,
    registry: Option<&SessionRegistry>,
) -> Result<Arc<Mutex<crate::copilot_server::CopilotServer>>, String> {
    let server_arc = {
        let mut slot = bridge.lock()?;
        if slot.is_none() {
            let edge_profile = crate::copilot_server::default_edge_profile_dir();
            let _ = std::fs::create_dir_all(&edge_profile);
            let server = crate::copilot_server::CopilotServer::new(
                COPILOT_HTTP_PORT,
                desired_cdp_port,
                Some(edge_profile),
                None,
            )
            .map_err(|e| format!("Copilot server init failed: {e}"))?;
            let arc = Arc::new(Mutex::new(server));
            *slot = Some(CopilotServerState {
                server: Arc::clone(&arc),
                started: false,
            });
        } else if let Some(st) = slot.as_mut() {
            let mut srv = st
                .server
                .lock()
                .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
            if srv.cdp_port() != desired_cdp_port {
                if st.started {
                    if block_port_change_on_concurrent_sessions {
                        if let Some(reg) = registry {
                            let n = reg.running_session_count().map_err(|e| e.to_string())?;
                            if n > 1 {
                                return Err("Cannot change Copilot CDP port while multiple agent sessions are running. Wait for sessions to finish or restart the app.".to_string());
                            }
                        }
                    }
                    srv.stop();
                    st.started = false;
                }
                srv.set_cdp_port(desired_cdp_port);
            }
        }
        if let Some(st) = slot.as_mut() {
            if st.started {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| {
                        format!("failed to create tokio runtime for copilot health: {e}")
                    })?;
                let healthy = {
                    let srv = st
                        .server
                        .lock()
                        .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
                    rt.block_on(async { srv.is_running() && srv.health_check().await.is_ok() })
                };
                if !healthy {
                    tracing::warn!(
                        "[copilot] bridge marked started but process or /health failed; restarting"
                    );
                    if let Ok(mut srv) = st.server.lock() {
                        srv.stop();
                    }
                    st.started = false;
                }
            }
        }
        Arc::clone(
            &slot
                .as_ref()
                .expect("copilot server slot just populated")
                .server,
        )
    };

    {
        let mut slot = bridge.lock()?;
        let st = slot
            .as_mut()
            .expect("copilot server slot must exist after init");
        if !st.started {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| format!("failed to create tokio runtime for copilot start: {e}"))?;
            let start_result = {
                let mut srv = st
                    .server
                    .lock()
                    .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
                rt.block_on(srv.start())
            };
            if let Err(e) = start_result {
                if let Ok(mut srv) = st.server.lock() {
                    srv.stop();
                }
                *slot = None;
                return Err(format!("copilot server start failed: {e}"));
            }
            st.started = true;
        }
    }

    Ok(server_arc)
}

/// Ensure Node `copilot_server.js` is up and run `GET /status` (Edge launch + Copilot tab + login probe).
pub async fn warmup_copilot_bridge(
    services: State<'_, AppServices>,
    browser_settings: Option<BrowserAutomationSettings>,
) -> Result<crate::copilot_server::CopilotStatusResponse, String> {
    let reg = services.registry();
    let bridge = services.copilot_bridge();
    let cdp = effective_cdp_port(browser_settings.as_ref());
    // `ensure_copilot_server` builds a temporary runtime and uses `block_on`; it must not run on a
    // Tokio worker thread (nested runtime panic: "Cannot start a runtime from within a runtime").
    tokio::task::spawn_blocking(move || {
        let server_arc = ensure_copilot_server(cdp, true, bridge, Some(&reg))?;
        let srv_clone = Arc::clone(&server_arc);
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("copilot warmup runtime: {e}"))?;
        let guard = srv_clone
            .lock()
            .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
        let out = rt.block_on(guard.warmup_status());
        Ok(match out {
            Ok(resp) => resp,
            Err(e) => crate::copilot_server::CopilotStatusResponse {
                connected: false,
                login_required: false,
                url: None,
                error: Some(e.to_string()),
            },
        })
    })
    .await
    .map_err(|e| format!("copilot warmup task: {e}"))?
}

// Re-export registry and agent_loop types for external consumers
pub(crate) use crate::agent_loop::{
    AgentErrorEvent, AgentSessionHistoryResponse, AgentSessionStatusEvent,
};

// What we need from agent_loop
use crate::agent_loop::{msg_to_relay, run_agent_loop_impl};
use crate::agent_loop::{AgentSessionPhase, E_ERROR, E_STATUS};

pub async fn start_agent(
    app: AppHandle,
    services: State<'_, AppServices>,
    request: StartAgentRequest,
) -> Result<String, String> {
    start_agent_inner(
        app,
        services.registry(),
        services.agent_semaphore(),
        services.config().clone(),
        request,
    )
    .await
}

pub(crate) async fn start_agent_inner(
    app: AppHandle,
    registry: SessionRegistry,
    agent_semaphore: Arc<tokio::sync::Semaphore>,
    config: crate::config::AgentConfig,
    request: StartAgentRequest,
) -> Result<String, String> {
    let goal = request.goal.trim().to_string();
    if goal.is_empty() {
        return Err("goal must not be empty".into());
    }

    let session_id = format!("session-{}", Uuid::new_v4());

    let workspace_cwd = request
        .cwd
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let auto_initial: HashSet<String> =
        crate::workspace_allowlist::load_for_cwd(workspace_cwd.as_deref());

    let handle = SessionHandle::new(
        SessionState::new(runtime::Session::new(), workspace_cwd),
        auto_initial,
    );
    let cancelled = handle
        .read_state(|state| Arc::clone(&state.cancelled))
        .map_err(|e| e.to_string())?;
    registry
        .insert(session_id.clone(), handle)
        .map_err(|e| e.to_string())?;

    let app_for_task = app.clone();
    let sid_for_task = session_id.clone();
    let reg_for_task = registry.clone();

    // Periodically evict stale sessions to prevent memory leaks
    let ttl_seconds = i64::try_from(config.session_cleanup_ttl_minutes).unwrap_or(i64::MAX) * 60;
    if let Err(e) = registry.remove_stale_sessions(ttl_seconds) {
        tracing::warn!("[RelayAgent] stale session cleanup failed: {e}");
    }

    let permit = agent_semaphore
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
                request.session_preset,
                request.browser_settings,
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
        if let Ok(Some(handle)) = reg_for_task.get_handle(&sid_for_task) {
            let _ignore = handle.write_state(SessionState::mark_finished);
        }

        // Release concurrency slot
        drop(permit);
    });

    Ok(session_id)
}

pub async fn respond_approval(
    _app: AppHandle,
    services: State<'_, AppServices>,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    respond_approval_inner(services.registry(), request)
}

pub(crate) fn respond_approval_inner(
    registry: SessionRegistry,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    let handle = registry
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;
    let pending = handle
        .take_pending_approval(&request.approval_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("approval `{}` not pending", request.approval_id))?;

    if request.approved
        && (request.remember_for_session == Some(true)
            || request.remember_for_workspace == Some(true))
    {
        handle
            .add_auto_allowed_tool(&pending.tool_name)
            .map_err(|e| e.to_string())?;
    }

    if request.approved && request.remember_for_workspace == Some(true) {
        if let Some(cwd) = handle
            .read_state(|state| state.workspace_cwd.clone())
            .map_err(|e| e.to_string())?
        {
            if let Err(e) =
                crate::workspace_allowlist::remember_tool_for_workspace(&cwd, &pending.tool_name)
            {
                tracing::warn!("[RelayAgent] workspace allowlist persist failed: {e}");
            }
        }
    }

    pending
        .tx
        .send(request.approved)
        .map_err(|_| "approval channel closed — session may have ended".into())
}

pub async fn respond_user_question(
    services: State<'_, AppServices>,
    request: RespondUserQuestionRequest,
) -> Result<(), String> {
    let handle = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;
    let pending = handle
        .take_pending_user_question(&request.question_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("question `{}` not pending", request.question_id))?;

    pending
        .tx
        .send(request.answer)
        .map_err(|_| "question channel closed — session may have ended".into())
}

#[derive(serde::Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompactAgentSessionRequest {
    pub session_id: String,
}

#[derive(serde::Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompactAgentSessionResponse {
    pub message: String,
    pub removed_message_count: usize,
}

pub async fn compact_agent_session(
    services: State<'_, AppServices>,
    request: CompactAgentSessionRequest,
) -> Result<CompactAgentSessionResponse, String> {
    use relay_commands::handle_slash_command;
    use runtime::CompactionConfig;

    let handle = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session `{}` not found", request.session_id))?;
    let result = handle
        .write_state(|state| {
            let config = CompactionConfig {
                preserve_recent_messages: 2,
                max_estimated_tokens: 4000,
            };

            let cmd_result =
                handle_slash_command("/compact", &state.session, config).ok_or_else(|| {
                    "compact command is only available for existing sessions".to_string()
                })?;

            let removed_count = state
                .session
                .messages
                .len()
                .saturating_sub(cmd_result.session.messages.len());

            state.session = cmd_result.session;
            Ok::<CompactAgentSessionResponse, String>(CompactAgentSessionResponse {
                message: cmd_result.message,
                removed_message_count: removed_count,
            })
        })
        .map_err(|e| e.to_string())??;

    Ok(result)
}

pub async fn cancel_agent(
    app: AppHandle,
    services: State<'_, AppServices>,
    request: CancelAgentRequest,
) -> Result<(), String> {
    let registry = services.registry();
    let bridge = services.copilot_bridge();
    let mut should_emit_status = false;
    if let Ok(Some(handle)) = registry.get_handle(&request.session_id) {
        let _ignore = handle.write_state(|state| {
            should_emit_status = !state.terminal_status_emitted;
            state.loop_epoch = state.loop_epoch.saturating_add(1);
            state.cancelled.store(true, Ordering::Relaxed);
            state.running = false;
            state.run_state = SessionRunState::Cancelling;
            state.terminal_status_emitted = false;
            state.last_stop_reason = Some("cancelled".to_string());
            state.last_error_summary = Some("session cancelled by user".to_string());
        });
    }
    if should_emit_status {
        let cancelling = AgentSessionStatusEvent {
            session_id: request.session_id.clone(),
            phase: AgentSessionPhase::Cancelling.as_str().to_string(),
            attempt: None,
            message: Some("Cancellation requested".to_string()),
            next_retry_at_ms: None,
            tool_name: None,
            stop_reason: None,
        };
        if let Err(e) = app.emit(E_STATUS, &cancelling) {
            tracing::warn!("[RelayAgent] emit failed ({E_STATUS}): {e}");
        }
    }
    // Drain approvals and reject them all
    match registry.get_handle(&request.session_id) {
        Ok(Some(handle)) => match handle.drain_approvals() {
            Ok(senders) => {
                for tx in senders {
                    let _ = tx.send(false);
                }
            }
            Err(e) => {
                tracing::error!("[RelayAgent] drain approvals failed during cancel: {e}");
            }
        },
        Ok(None) => {}
        Err(e) => {
            tracing::error!("[RelayAgent] registry failed during cancel approvals: {e}");
        }
    }
    match registry.get_handle(&request.session_id) {
        Ok(Some(handle)) => match handle.drain_user_questions() {
            Ok(senders) => {
                for tx in senders {
                    let _ = tx.send(String::new());
                }
            }
            Err(e) => {
                tracing::error!("[RelayAgent] drain user questions failed during cancel: {e}");
            }
        },
        Ok(None) => {}
        Err(e) => {
            tracing::error!("[RelayAgent] registry failed during cancel questions: {e}");
        }
    }

    request_copilot_bridge_abort(bridge).await;

    if should_emit_status {
        if let Ok(Some(handle)) = registry.get_handle(&request.session_id) {
            let _ignore = handle.write_state(|state| {
                state.run_state = SessionRunState::Finished;
                state.terminal_status_emitted = true;
            });
        }
        let idle = AgentSessionStatusEvent {
            session_id: request.session_id.clone(),
            phase: AgentSessionPhase::Idle.as_str().to_string(),
            attempt: None,
            message: Some("Session cancelled".to_string()),
            next_retry_at_ms: None,
            tool_name: None,
            stop_reason: Some("cancelled".to_string()),
        };
        if let Err(e) = app.emit(E_STATUS, &idle) {
            tracing::warn!("[RelayAgent] emit failed ({E_STATUS}): {e}");
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

pub async fn get_session_history(
    services: State<'_, AppServices>,
    request: GetAgentSessionHistoryRequest,
) -> Result<AgentSessionHistoryResponse, String> {
    let maybe_loaded = if let Some(handle) = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
    {
        Some(
            handle
                .read_state(|state| {
                    let running = state.running && !state.cancelled.load(Ordering::SeqCst);
                    let messages = state.session.messages.iter().map(msg_to_relay).collect();
                    AgentSessionHistoryResponse {
                        session_id: request.session_id.clone(),
                        running,
                        messages,
                    }
                })
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
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

pub fn undo_session_write(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<(), String> {
    let handle = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Unknown session.".to_string())?;
    handle
        .with_write_undo(super::session_write_undo::WriteUndoStacks::undo)
        .map_err(|e| e.to_string())?
}

pub fn redo_session_write(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<(), String> {
    let handle = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Unknown session.".to_string())?;
    handle
        .with_write_undo(super::session_write_undo::WriteUndoStacks::redo)
        .map_err(|e| e.to_string())?
}

pub fn get_session_write_undo_status(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<SessionWriteUndoStatusResponse, String> {
    let handle = services
        .registry()
        .get_handle(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Unknown session.".to_string())?;
    handle
        .with_write_undo(|stack| SessionWriteUndoStatusResponse {
            can_undo: stack.can_undo(),
            can_redo: stack.can_redo(),
        })
        .map_err(|e| e.to_string())
}

pub fn probe_rust_analyzer(request: RustAnalyzerProbeRequest) -> RustAnalyzerProbeResponse {
    crate::lsp_probe::probe_rust_analyzer(request.workspace_path.as_deref())
}

/* ── CDP Copilot Tauri commands ────────────────────────────── */

/// Shared state: tracks the session for auto-launched Edge + connection status.
struct CdpSessionState {
    /// Active CDP HTTP port (dynamic when using `remote-debugging-port=0`).
    cdp_port: Option<u16>,
    /// True if this app spawned Edge for this profile (disconnect may kill it).
    owns_browser: bool,
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
            cdp_port: None,
            owns_browser: false,
            connected: false,
            page_url: None,
            page: None,
        })
    })
}

fn get_cdp_debug_url(preferred_base: u16) -> String {
    match cdp_session().lock() {
        Ok(state) => {
            if let Some(port) = state.cdp_port {
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
    cdp_session().lock().is_ok_and(|s| s.connected)
}

fn set_cdp_session_connected(
    port: u16,
    owns_browser: bool,
    page_url: String,
    page: cdp_copilot::CopilotPage,
) {
    if let Ok(mut state) = cdp_session().lock() {
        state.cdp_port = Some(port);
        state.owns_browser = owns_browser;
        state.connected = true;
        state.page_url = Some(page_url);
        state.page = Some(page);
    } else {
        tracing::warn!("[CDP] cdp_session lock poisoned in set_cdp_session_connected");
    }
}

fn mark_cdp_disconnected() {
    if let Ok(mut state) = cdp_session().lock() {
        state.cdp_port = None;
        state.owns_browser = false;
        state.connected = false;
        state.page_url = None;
        state.page = None;
    } else {
        tracing::warn!("[CDP] cdp_session lock poisoned in mark_cdp_disconnected");
    }
}

/// Get the current CDP `CopilotPage` for use by the agent loop.
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
    let debug_url = get_cdp_debug_url(COPILOT_JS_CDP_PORT);
    tracing::info!("[CDP] auto-connecting to {} (start_agent)…", debug_url);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("CDP: failed to create runtime: {e}"))?;

    let result = rt
        .block_on(async {
            cdp_copilot::connect_copilot_page(&debug_url, true, COPILOT_JS_CDP_PORT).await
        })
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Microsoft Edge could not be found") {
                "CDP: Microsoft Edge is not installed. Please install Edge and try again."
                    .to_string()
            } else if msg.contains("Edge did not become ready") {
                "CDP: Edge did not start within 30 seconds. It may be blocked by a security policy."
                    .to_string()
            } else {
                format!("CDP: {msg}")
            }
        })?;

    let page = result.page.clone();
    let port = result.port;
    let page_url = result.page.url.clone();

    set_cdp_session_connected(port, result.launched, page_url, page.clone());

    tracing::info!("[CDP] auto-connected to {}", page.url);
    // ConnectionResult dropped here; its Edge process ownership is no longer needed
    // since the port is tracked in CdpSessionState and disconnect_cdp handles cleanup.

    Ok(page)
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectCdpRequest {
    /// If true and no existing browser is found, auto-launch a dedicated Edge.
    #[serde(default)]
    pub auto_launch: Option<bool>,
    /// When `auto_launch` is false: explicit CDP port, or omit to resolve from
    /// `.relay-agent-cdp-port` / `DevToolsActivePort` then fall back to 9360.
    /// When `auto_launch` is true: hint only; OS-assigned port via profile is used for launch.
    #[serde(default)]
    pub base_port: Option<u16>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CdpSendPromptRequest {
    pub prompt: String,
    #[serde(default)]
    pub wait_response_secs: Option<u64>,
}

#[derive(Serialize, TS)]
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

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CdpPromptResult {
    pub ok: bool,
    pub response_text: String,
    pub body_length: usize,
    pub error: Option<String>,
}

pub async fn connect_cdp(
    _app: AppHandle,
    request: ConnectCdpRequest,
) -> Result<CdpConnectResult, String> {
    // If already connected, return current status
    {
        let state = cdp_session()
            .lock()
            .map_err(|e| format!("cdp_session lock poisoned: {e}"))?;
        if state.connected {
            return Ok(CdpConnectResult {
                ok: true,
                debug_url: state.cdp_port.map_or_else(
                    || {
                        format!(
                            "http://127.0.0.1:{}",
                            request.base_port.unwrap_or(COPILOT_JS_CDP_PORT)
                        )
                    },
                    |p| format!("http://127.0.0.1:{p}"),
                ),
                page_url: state.page_url.clone().unwrap_or_default(),
                page_title: String::new(),
                port: state.cdp_port,
                launched: state.owns_browser,
                error: None,
            });
        }
    }

    let auto_launch = request.auto_launch.unwrap_or(true);
    let base_port = if auto_launch {
        request.base_port.unwrap_or(COPILOT_JS_CDP_PORT)
    } else if let Some(p) = request.base_port {
        p
    } else {
        cdp_copilot::resolve_cdp_attachment_port(COPILOT_JS_CDP_PORT).await
    };
    let debug_url = get_cdp_debug_url(base_port);

    tracing::info!(
        "[CDP] connect → {} (auto_launch={})",
        debug_url,
        auto_launch
    );

    match cdp_copilot::connect_copilot_page(&debug_url, auto_launch, base_port).await {
        Ok(res) => {
            tracing::info!("[CDP] connected → {} — {}", res.page.url, res.page.title);
            set_cdp_session_connected(
                res.port,
                res.launched,
                res.page.url.clone(),
                res.page.clone(),
            );
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

pub async fn cdp_send_prompt(
    _app: AppHandle,
    request: CdpSendPromptRequest,
) -> Result<CdpPromptResult, String> {
    let port = cdp_copilot::resolve_cdp_attachment_port(COPILOT_JS_CDP_PORT).await;
    let debug_url = get_cdp_debug_url(port);
    let timeout_secs = request.wait_response_secs.unwrap_or(120);

    let prompt_preview = &request.prompt[..request.prompt.len().min(60)];
    tracing::info!("[CDP] send prompt: {prompt_preview}…");

    // Use existing connection if available, otherwise connect fresh
    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, port).await {
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

pub async fn cdp_start_new_chat(
    _app: AppHandle,
    request: ConnectCdpRequest,
) -> Result<CdpConnectResult, String> {
    let auto_launch = request.auto_launch.unwrap_or(true);
    let base_port = if auto_launch {
        request.base_port.unwrap_or(COPILOT_JS_CDP_PORT)
    } else if let Some(p) = request.base_port {
        p
    } else {
        cdp_copilot::resolve_cdp_attachment_port(COPILOT_JS_CDP_PORT).await
    };
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

    let debug_url_resolved = format!("http://127.0.0.1:{}", res.port);

    set_cdp_session_connected(
        res.port,
        res.launched,
        res.page.url.clone(),
        res.page.clone(),
    );

    if let Err(e) = res.page.navigate_to_chat().await {
        return Ok(CdpConnectResult {
            ok: false,
            debug_url: debug_url_resolved.clone(),
            page_url: res.page.url.clone(),
            page_title: res.page.title.clone(),
            port: Some(res.port),
            launched: res.launched,
            error: Some(format!("Navigate: {e}")),
        });
    }

    Ok(CdpConnectResult {
        ok: true,
        debug_url: debug_url_resolved,
        page_url: res.page.url.clone(),
        page_title: res.page.title.clone(),
        port: Some(res.port),
        launched: res.launched,
        error: None,
    })
}

/// Disconnect from the Copilot page and clean up the browser if it was auto-launched.
pub async fn disconnect_cdp(_app: AppHandle) -> Result<(), String> {
    // Use the tracked port to avoid reconnecting to the CDP endpoint.
    // The ConnectionResult from a prior connect_copilot_page() call owns the Edge child
    // process, but since CDP commands are one-shot (open WS → send → close), we can
    // kill the process directly by port ownership.
    let owns_browser = {
        let state = cdp_session()
            .lock()
            .map_err(|e| format!("cdp_session lock poisoned: {e}"))?;
        let kill = state.owns_browser;
        if kill {
            tracing::info!(
                "[CDP] disconnect: killing auto-launched Edge (cdp port {:?})",
                state.cdp_port
            );
        }
        kill
    };

    if owns_browser {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let port_hint = cdp_session()
                .lock()
                .ok()
                .and_then(|s| s.cdp_port)
                .unwrap_or(0);
            // Kill Edge processes that use our isolated profile directory
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/FI", &format!("WINDOWTITLE eq *{}*", port_hint)])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = std::process::Command::new("taskkill")
                .args([
                    "/F",
                    "/IM",
                    "msedge.exe",
                    "/FI",
                    &format!("CMDLINE eq *RelayAgentEdgeProfile*"),
                ])
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

pub async fn cdp_screenshot(_app: AppHandle) -> Result<serde_json::Value, String> {
    let port = cdp_copilot::resolve_cdp_attachment_port(COPILOT_JS_CDP_PORT).await;
    let debug_url = get_cdp_debug_url(port);

    // If already connected, reuse the session; otherwise do a fresh lookup
    let page = match cdp_copilot::connect_copilot_page(&debug_url, false, port).await {
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
pub fn mcp_remove_server(name: String) -> Result<bool, String> {
    let registry = mcp_registry();
    let mut data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    Ok(data.remove(&name).is_some())
}

/// Check the status of a single MCP server.
#[allow(clippy::needless_pass_by_value)]
pub fn mcp_check_server_status(name: String) -> Result<McpServerInfo, String> {
    let registry = mcp_registry();
    let data = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    data.get(&name).cloned().ok_or_else(|| {
        format!("MCP server `{name}` not found — register it via Settings or `mcp_add_server`")
    })
}

fn relay_predictability_notes() -> Vec<String> {
    vec![
        "Edge CDP defaults to port 9360 for the Copilot bridge unless you change “CDP port hint” in Settings (Browser automation)."
            .into(),
        "The workspace path (cwd) in Settings is sent per agent run and may differ from the app process working directory (see diagnostics processCwd)."
            .into(),
        "“Allow for this workspace” persists tool names under ~/.relay-agent/workspace_allowed_tools.json (normalized folder keys)."
            .into(),
        "Optional project slash commands: add .relay/commands/<name>.md or .relay/commands/commands.json (see PLANS.md)."
            .into(),
    ]
}

fn relay_doctor_hints() -> Vec<String> {
    let mut hints = Vec::new();
    hints.push(format!(
        "Copilot Node bridge port {COPILOT_HTTP_PORT}; default Edge CDP target port {COPILOT_JS_CDP_PORT} (see scripts/start-relay-edge-cdp.sh and docs/COPILOT_E2E_CDP_PITFALLS.md)."
    ));
    if std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .is_some()
    {
        hints.push(
            "ANTHROPIC_API_KEY is set. The M365 Copilot CDP path does not use it; direct Anthropic APIs are out of scope for this surface."
                .into(),
        );
    }
    for (key, label) in [
        ("HTTP_PROXY", "HTTP_PROXY"),
        ("HTTPS_PROXY", "HTTPS_PROXY"),
        ("NO_PROXY", "NO_PROXY"),
    ] {
        if std::env::var(key)
            .ok()
            .or_else(|| std::env::var(key.to_lowercase()).ok())
            .filter(|s| !s.trim().is_empty())
            .is_some()
        {
            hints.push(format!(
                "{label} is set; ensure proxies allow localhost CDP/WebSocket to Edge if connections fail."
            ));
        }
    }
    hints.push(
        "PDF read_file uses LiteParse via bundled relay-node when present (see README / AGENTS.md)."
            .into(),
    );
    hints
}

/// JSON-friendly runtime facts for bug reports (mirrors `OpenWork` debug export, reduced scope).
pub fn get_relay_diagnostics() -> RelayDiagnostics {
    let dev = std::env::var("RELAY_AGENT_DEV_MODE")
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    let process_cwd = std::env::current_dir().map_or_else(
        |e| format!("(unavailable: {e})"),
        |p| p.display().to_string(),
    );
    let claw_config_home_display = std::env::var("CLAW_CONFIG_HOME").map_or_else(
        |_| "~/.claw (default; set CLAW_CONFIG_HOME to override)".to_string(),
        |s| {
            let t = s.trim();
            if t.is_empty() {
                "~/.claw (default)".to_string()
            } else {
                t.to_string()
            }
        },
    );
    RelayDiagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        target_os: std::env::consts::OS.to_string(),
        copilot_node_bridge_port: COPILOT_HTTP_PORT,
        default_edge_cdp_port: COPILOT_JS_CDP_PORT,
        relay_agent_dev_mode: dev,
        architecture_notes: "Copilot path uses the bundled Node bridge on copilot_node_bridge_port; Edge CDP defaults to default_edge_cdp_port (see scripts/start-relay-edge-cdp.sh).".to_string(),
        process_cwd,
        claw_config_home_display,
        max_text_file_read_bytes: MAX_TEXT_FILE_READ_BYTES,
        doctor_hints: relay_doctor_hints(),
        predictability_notes: relay_predictability_notes(),
    }
}

/// Writes UTF-8 text to a path chosen by the user (e.g. diagnostics JSON export).
pub fn write_text_export(path: String, contents: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path is empty".to_string());
    }
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(p, contents).map_err(|e| e.to_string())
}

pub fn workspace_instruction_surfaces(
    request: WorkspaceInstructionSurfacesRequest,
) -> crate::workspace_surfaces::WorkspaceInstructionSurfaces {
    crate::workspace_surfaces::scan_workspace_instructions(request.cwd)
}

pub fn get_desktop_permission_summary(
    request: GetPermissionSummaryRequest,
) -> Vec<DesktopPermissionSummaryRow> {
    crate::agent_loop::desktop_permission_summary_rows(request.session_preset)
}

pub fn get_workspace_allowlist() -> Result<WorkspaceAllowlistSnapshot, String> {
    crate::workspace_allowlist::snapshot()
}

pub fn remove_workspace_allowlist_tool(
    request: WorkspaceAllowlistRemoveToolRequest,
) -> Result<(), String> {
    crate::workspace_allowlist::remove_tool_for_cwd(&request.cwd, &request.tool_name)
}

pub fn clear_workspace_allowlist(request: WorkspaceAllowlistCwdRequest) -> Result<(), String> {
    crate::workspace_allowlist::clear_cwd(&request.cwd)
}

pub fn list_workspace_slash_commands(
    request: ListWorkspaceSlashCommandsRequest,
) -> Result<Vec<WorkspaceSlashCommandRow>, String> {
    crate::workspace_slash_commands::list_for_cwd(request.cwd.as_deref())
}
