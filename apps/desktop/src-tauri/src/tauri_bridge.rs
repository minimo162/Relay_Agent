#![allow(clippy::needless_pass_by_value, clippy::unused_async)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use tauri::{AppHandle, State};
use ts_rs::TS;
use uuid::Uuid;

use desktop_core::doctor::RELAY_MAX_TEXT_FILE_READ_BYTES;

use crate::app_services::{AppServices, CopilotBridgeManager, CopilotServerState};
use crate::cdp_copilot;
use crate::models::{
    BrowserAutomationSettings, ListWorkspaceSkillsRequest, ListWorkspaceSlashCommandsRequest,
    McpAddServerRequest, McpServerInfo, RelayDiagnostics, RustAnalyzerProbeRequest,
    RustAnalyzerProbeResponse, WorkspaceAllowlistCwdRequest, WorkspaceAllowlistRemoveToolRequest,
    WorkspaceAllowlistSnapshot, WorkspaceInstructionSurfacesRequest, WorkspaceSkillRow,
    WorkspaceSlashCommandRow,
};

/* ── Copilot Node bridge (copilot_server.js) ───────────────── *
 * Spawns Node + copilot_server.js, which attaches to Edge via *
 * CDP and drives M365 Copilot (Input.insertText + Edge launch). *
 * This is the default path so Edge opens without a global       *
 * `agent-browser` install.                                      */

pub(crate) const COPILOT_HTTP_PORT: u16 = 18080;
/// M365 Copilot Edge CDP base port: must match `scripts/start-relay-edge-cdp.sh`, `copilot_server.js`, and Playwright defaults (`YakuLingo` uses 9333; Relay avoids collision).
pub(crate) const COPILOT_JS_CDP_PORT: u16 = 9360;

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
pub fn ensure_copilot_server(
    desired_cdp_port: u16,
    bridge: Arc<CopilotBridgeManager>,
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
) -> Result<CopilotWarmupResult, String> {
    let bridge = services.copilot_bridge();
    let cdp = effective_cdp_port(browser_settings.as_ref());
    let request_id = Uuid::new_v4().to_string();
    tokio::task::spawn_blocking(move || run_copilot_warmup_blocking(bridge, cdp, request_id))
        .await
        .map_err(|e| format!("copilot warmup task: {e}"))?
}

fn run_copilot_warmup_blocking(
    bridge: Arc<CopilotBridgeManager>,
    cdp: u16,
    request_id: String,
) -> Result<CopilotWarmupResult, String> {
    // `ensure_copilot_server` builds a temporary runtime and uses `block_on`; it must not run on a
    // Tokio worker thread (nested runtime panic: "Cannot start a runtime from within a runtime").
    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present=false",
        request_id,
        cdp,
        "ensure_server",
    );
    let server_arc = match ensure_copilot_server(cdp, bridge) {
        Ok(server_arc) => server_arc,
        Err(error) => {
            tracing::warn!(
                "[CopilotWarmup] request_id={} cdp_port={} stage={} outcome=failed failure_code={} message={}",
                request_id,
                cdp,
                "ensure_server",
                "ensure_server_failed",
                error
            );
            return Ok(warmup_result(
                &request_id,
                cdp,
                false,
                CopilotWarmupStage::EnsureServer,
                error,
                CopilotWarmupResultSpec::failed(Some(CopilotWarmupFailureCode::EnsureServerFailed)),
            ));
        }
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("copilot warmup runtime: {e}"))?;
    let mut guard = server_arc
        .lock()
        .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
    let boot_token_present = guard.boot_token().is_some();

    if let Some(result) =
        run_warmup_health_check(&request_id, cdp, boot_token_present, &rt, &mut guard)
    {
        return Ok(result);
    }

    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present={}",
        request_id,
        cdp,
        "status_request",
        boot_token_present,
    );
    let result = match rt.block_on(guard.status_with_timeout_detailed(120)) {
        Ok(response) => {
            classify_warmup_status_response(&request_id, cdp, boot_token_present, response)
        }
        Err(crate::copilot_server::CopilotStatusCheckError::Http(error)) => {
            classify_warmup_status_http_error(&request_id, cdp, boot_token_present, error)
        }
        Err(crate::copilot_server::CopilotStatusCheckError::Transport(error)) => {
            classify_warmup_status_transport_error(&request_id, cdp, boot_token_present, error)
        }
    };
    log_warmup_result(&result);
    Ok(result)
}

fn run_warmup_health_check(
    request_id: &str,
    cdp: u16,
    boot_token_present: bool,
    rt: &tokio::runtime::Runtime,
    guard: &mut crate::copilot_server::CopilotServer,
) -> Option<CopilotWarmupResult> {
    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present={}",
        request_id,
        cdp,
        "health_check",
        boot_token_present,
    );
    if let Err(error) = rt.block_on(guard.health_check()) {
        tracing::warn!(
            "[CopilotWarmup] request_id={} cdp_port={} stage={} outcome=failed failure_code={} boot_token_present={} message={}",
            request_id,
            cdp,
            "health_check",
            "health_check_failed",
            boot_token_present,
            error
        );
        return Some(warmup_result(
            request_id,
            cdp,
            boot_token_present,
            CopilotWarmupStage::HealthCheck,
            error.to_string(),
            CopilotWarmupResultSpec::failed(Some(CopilotWarmupFailureCode::HealthCheckFailed)),
        ));
    }
    None
}

fn classify_warmup_status_http_error(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    error: crate::copilot_server::CopilotStatusHttpError,
) -> CopilotWarmupResult {
    let (stage, failure_code) = match error.error_code.as_deref() {
        Some("unauthorized") => (
            CopilotWarmupStage::BootTokenAuth,
            CopilotWarmupFailureCode::BootTokenUnauthorized,
        ),
        Some("login_required") => (
            CopilotWarmupStage::LoginCheck,
            CopilotWarmupFailureCode::LoginRequired,
        ),
        _ => (
            CopilotWarmupStage::StatusRequest,
            CopilotWarmupFailureCode::StatusHttpError,
        ),
    };
    let login_required = failure_code == CopilotWarmupFailureCode::LoginRequired;
    warmup_result(
        request_id,
        cdp_port,
        boot_token_present,
        stage,
        error
            .message
            .clone()
            .or(error.error_code.clone())
            .unwrap_or_else(|| format!("status check failed: status {}", error.status)),
        CopilotWarmupResultSpec {
            connected: false,
            login_required,
            failure_code: Some(failure_code),
            status_code: Some(error.status),
            url: error.url.clone(),
        },
    )
}

fn classify_warmup_status_transport_error(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    error: crate::copilot_server::CopilotError,
) -> CopilotWarmupResult {
    let error_text = error.to_string();
    let lower = error_text.to_ascii_lowercase();
    let (stage, failure_code) = if lower.contains("cdp")
        || lower.contains("debugging endpoint")
        || lower.contains("websocket")
    {
        (
            CopilotWarmupStage::CdpAttach,
            CopilotWarmupFailureCode::CdpAttachFailed,
        )
    } else {
        (
            CopilotWarmupStage::StatusRequest,
            CopilotWarmupFailureCode::StatusTransportError,
        )
    };
    warmup_result(
        request_id,
        cdp_port,
        boot_token_present,
        stage,
        error_text,
        CopilotWarmupResultSpec::failed(Some(failure_code)),
    )
}

fn log_warmup_result(result: &CopilotWarmupResult) {
    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={:?} outcome={} failure_code={:?} boot_token_present={} status_code={:?} message={}",
        result.request_id,
        result.cdp_port,
        result.stage,
        if result.failure_code.is_some() { "failed" } else { "ok" },
        result.failure_code,
        result.boot_token_present,
        result.status_code,
        result.message
    );
}

#[derive(Clone, Copy, Debug, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopilotWarmupStage {
    EnsureServer,
    HealthCheck,
    BootTokenAuth,
    StatusRequest,
    CdpAttach,
    CopilotTab,
    LoginCheck,
    Ready,
}

#[derive(Clone, Copy, Debug, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopilotWarmupFailureCode {
    EnsureServerFailed,
    HealthCheckFailed,
    BootTokenUnauthorized,
    StatusHttpError,
    StatusTransportError,
    CdpAttachFailed,
    CopilotTabUnavailable,
    LoginRequired,
    Unknown,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct CopilotWarmupResult {
    pub request_id: String,
    pub connected: bool,
    pub login_required: bool,
    pub boot_token_present: bool,
    pub cdp_port: u16,
    pub stage: CopilotWarmupStage,
    pub message: String,
    pub failure_code: Option<CopilotWarmupFailureCode>,
    pub status_code: Option<u16>,
    pub url: Option<String>,
}

struct CopilotWarmupResultSpec {
    connected: bool,
    login_required: bool,
    failure_code: Option<CopilotWarmupFailureCode>,
    status_code: Option<u16>,
    url: Option<String>,
}

impl CopilotWarmupResultSpec {
    fn failed(failure_code: Option<CopilotWarmupFailureCode>) -> Self {
        Self {
            connected: false,
            login_required: false,
            failure_code,
            status_code: None,
            url: None,
        }
    }
}

fn warmup_result(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    stage: CopilotWarmupStage,
    message: impl Into<String>,
    spec: CopilotWarmupResultSpec,
) -> CopilotWarmupResult {
    CopilotWarmupResult {
        request_id: request_id.to_string(),
        connected: spec.connected,
        login_required: spec.login_required,
        boot_token_present,
        cdp_port,
        stage,
        message: message.into(),
        failure_code: spec.failure_code,
        status_code: spec.status_code,
        url: spec.url,
    }
}

fn classify_warmup_status_response(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    response: crate::copilot_server::CopilotStatusResponse,
) -> CopilotWarmupResult {
    if response.connected {
        return warmup_result(
            request_id,
            cdp_port,
            boot_token_present,
            CopilotWarmupStage::Ready,
            "Copilot ready.",
            CopilotWarmupResultSpec {
                connected: true,
                login_required: false,
                failure_code: None,
                status_code: None,
                url: response.url,
            },
        );
    }
    if response.login_required {
        return warmup_result(
            request_id,
            cdp_port,
            boot_token_present,
            CopilotWarmupStage::LoginCheck,
            response
                .error
                .unwrap_or_else(|| "Sign in to Copilot in Edge, then return here.".to_string()),
            CopilotWarmupResultSpec {
                connected: false,
                login_required: true,
                failure_code: Some(CopilotWarmupFailureCode::LoginRequired),
                status_code: None,
                url: response.url,
            },
        );
    }

    let error = response
        .error
        .unwrap_or_else(|| "Copilot is unavailable right now.".to_string());
    let lower = error.to_ascii_lowercase();
    let (stage, code) = if lower.contains("copilot page not available") {
        (
            CopilotWarmupStage::CopilotTab,
            CopilotWarmupFailureCode::CopilotTabUnavailable,
        )
    } else if lower.contains("cdp")
        || lower.contains("debugging endpoint")
        || lower.contains("websocket")
    {
        (
            CopilotWarmupStage::CdpAttach,
            CopilotWarmupFailureCode::CdpAttachFailed,
        )
    } else {
        (
            CopilotWarmupStage::StatusRequest,
            CopilotWarmupFailureCode::Unknown,
        )
    };
    warmup_result(
        request_id,
        cdp_port,
        boot_token_present,
        stage,
        error,
        CopilotWarmupResultSpec {
            connected: false,
            login_required: false,
            failure_code: Some(code),
            status_code: None,
            url: response.url,
        },
    )
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
    /// PID of the browser process launched by this app, if tracked.
    browser_pid: Option<u32>,
    /// Whether the frontend currently has an active CDP connection.
    connected: bool,
    /// URL of the Copilot page (if connected).
    page_url: Option<String>,
    /// Connected Copilot page for provider diagnostics and CDP prompts.
    page: Option<cdp_copilot::CopilotPage>,
}

static CDP_SESSION: OnceLock<Mutex<CdpSessionState>> = OnceLock::new();

fn cdp_session() -> &'static Mutex<CdpSessionState> {
    CDP_SESSION.get_or_init(|| {
        Mutex::new(CdpSessionState {
            cdp_port: None,
            owns_browser: false,
            browser_pid: None,
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
    browser_pid: Option<u32>,
    page_url: String,
    page: cdp_copilot::CopilotPage,
) {
    if let Ok(mut state) = cdp_session().lock() {
        state.cdp_port = Some(port);
        state.owns_browser = owns_browser;
        state.browser_pid = browser_pid;
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
        state.browser_pid = None;
        state.connected = false;
        state.page_url = None;
        state.page = None;
    } else {
        tracing::warn!("[CDP] cdp_session lock poisoned in mark_cdp_disconnected");
    }
}

/// Get the current CDP `CopilotPage` for provider diagnostics and CDP prompts.
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
/// This allows CDP-backed diagnostics to run without requiring a prior `connect_cdp` call.
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
    tracing::info!(
        "[CDP] auto-connecting to {} (provider diagnostics)…",
        debug_url
    );

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

    set_cdp_session_connected(
        port,
        result.launched,
        result.edge_process_id(),
        page_url,
        page.clone(),
    );

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
#[skip_serializing_none]
pub struct CdpConnectResult {
    pub ok: bool,
    pub debug_url: String,
    pub page_url: String,
    pub page_title: String,
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
                res.edge_process_id(),
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
        res.edge_process_id(),
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
    let (owns_browser, browser_pid) = {
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
        (kill, state.browser_pid)
    };

    if owns_browser {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            if let Some(pid) = browser_pid {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(pid) = browser_pid {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
            }
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
        "Edge CDP defaults to port 9360 for the M365 Copilot provider bridge unless RELAY_EDGE_CDP_PORT or a diagnostic browser setting overrides it."
            .into(),
        "Provider-mode workspace state belongs to OpenCode/OpenWork; diagnostics processCwd is only the Relay process working directory."
            .into(),
        "OpenCode/OpenWork owns tool permissions in provider mode. Relay workspace allowlist data is diagnostic desktop state only."
            .into(),
        "OpenCode/OpenWork owns slash commands, MCP, plugins, skills, and workspace config for the product path."
            .into(),
    ]
}

fn relay_doctor_hints() -> Vec<String> {
    let mut hints = Vec::new();
    hints.push(format!(
        "Provider bridge port {COPILOT_HTTP_PORT}; default Edge CDP target port {COPILOT_JS_CDP_PORT} (see pnpm start:opencode-provider-gateway and docs/COPILOT_E2E_CDP_PITFALLS.md)."
    ));
    hints.push(
        "OpenCode/OpenWork provider mode uses Relay only as an OpenAI-compatible M365 Copilot gateway; UX, sessions, permissions, and tools live in OpenCode/OpenWork."
            .into(),
    );
    if std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .is_some_and(|s| !s.trim().is_empty())
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
            .is_some_and(|s| !s.trim().is_empty())
        {
            hints.push(format!(
                "{label} is set; ensure proxies allow localhost CDP/WebSocket to Edge if connections fail."
            ));
        }
    }
    hints.push(
        "Office/PDF extraction is not a Relay provider fallback. Add it through OpenCode/OpenWork extension points when needed."
            .into(),
    );
    hints
}

fn relay_diagnostics_base() -> RelayDiagnostics {
    let dev = std::env::var("RELAY_AGENT_DEV_MODE").is_ok_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    });
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
        architecture_notes: "OpenCode/OpenWork owns UX, sessions, permissions, workspace tools, transcript, and execution state. Relay is an OpenAI-compatible M365 Copilot provider gateway plus diagnostics, not a desktop execution fallback.".to_string(),
        process_cwd,
        claw_config_home_display,
        max_text_file_read_bytes: RELAY_MAX_TEXT_FILE_READ_BYTES,
        doctor_hints: relay_doctor_hints(),
        predictability_notes: relay_predictability_notes(),
        copilot_bridge_running: None,
        copilot_bridge_connected: None,
        copilot_bridge_login_required: None,
        copilot_bridge_status_url: None,
        copilot_bridge_cdp_port: None,
        copilot_boot_token_present: None,
        last_copilot_bridge_failure: None,
        copilot_repair_stage_stats: Vec::new(),
        execution_backend: Some(crate::opencode_runtime::execution_backend_name()),
        opencode_runtime_url: crate::opencode_runtime::external_runtime_url(),
        opencode_runtime_running: None,
        opencode_runtime_message: None,
    }
}

/// JSON-friendly runtime facts for bug reports (mirrors `OpenWork` debug export, reduced scope).
pub async fn get_relay_diagnostics(services: State<'_, AppServices>) -> RelayDiagnostics {
    let mut diagnostics = relay_diagnostics_base();
    let opencode_snapshot = crate::opencode_runtime::snapshot().await;
    diagnostics.opencode_runtime_url = opencode_snapshot.url;
    diagnostics.opencode_runtime_running = Some(opencode_snapshot.running);
    diagnostics.opencode_runtime_message = Some(opencode_snapshot.message);
    let bridge = services.copilot_bridge();
    let server_arc = match bridge.lock() {
        Ok(slot) => slot.as_ref().map(|state| Arc::clone(&state.server)),
        Err(error) => {
            diagnostics
                .doctor_hints
                .push(format!("Copilot bridge state unavailable: {error}"));
            return diagnostics;
        }
    };
    let Some(server_arc) = server_arc else {
        return diagnostics;
    };

    let snapshot = tokio::task::spawn_blocking(move || -> Result<RelayDiagnostics, String> {
        let mut diagnostics = relay_diagnostics_base();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("copilot diagnostics runtime: {e}"))?;
        let mut server = server_arc
            .lock()
            .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;

        diagnostics.copilot_bridge_running = Some(server.is_running());
        diagnostics.copilot_bridge_cdp_port = Some(server.cdp_port());
        diagnostics.copilot_boot_token_present = Some(server.boot_token().is_some());

        if server.is_running() {
            match rt.block_on(server.status()) {
                Ok(status) => {
                    diagnostics.copilot_bridge_connected = Some(status.connected);
                    diagnostics.copilot_bridge_login_required = Some(status.login_required);
                    diagnostics
                        .copilot_bridge_status_url
                        .clone_from(&status.url);
                    diagnostics.last_copilot_bridge_failure = status
                        .last_bridge_failure
                        .clone()
                        .or_else(|| server.last_bridge_failure().cloned());
                    diagnostics.copilot_repair_stage_stats = if status.repair_stage_stats.is_empty()
                    {
                        server.last_repair_stage_stats().to_vec()
                    } else {
                        status.repair_stage_stats.clone()
                    };
                }
                Err(error) => {
                    diagnostics
                        .doctor_hints
                        .push(format!("Copilot bridge status unavailable: {error}"));
                    diagnostics.last_copilot_bridge_failure = server.last_bridge_failure().cloned();
                    diagnostics.copilot_repair_stage_stats =
                        server.last_repair_stage_stats().to_vec();
                }
            }
        } else {
            diagnostics.last_copilot_bridge_failure = server.last_bridge_failure().cloned();
            diagnostics.copilot_repair_stage_stats = server.last_repair_stage_stats().to_vec();
        }
        Ok(diagnostics)
    })
    .await;

    match snapshot {
        Ok(Ok(diagnostics)) => diagnostics,
        Ok(Err(error)) => {
            diagnostics
                .doctor_hints
                .push(format!("Copilot bridge diagnostics failed: {error}"));
            diagnostics
        }
        Err(error) => {
            diagnostics
                .doctor_hints
                .push(format!("Copilot bridge diagnostics task failed: {error}"));
            diagnostics
        }
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

pub fn list_workspace_skills(
    request: ListWorkspaceSkillsRequest,
) -> Result<Vec<WorkspaceSkillRow>, String> {
    crate::workspace_skills::list_for_cwd(request.cwd.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_warmup_ready_response() {
        let result = classify_warmup_status_response(
            "req-1",
            9360,
            true,
            crate::copilot_server::CopilotStatusResponse {
                connected: true,
                login_required: false,
                url: Some("https://m365.cloud.microsoft/chat/".to_string()),
                error: None,
                last_bridge_failure: None,
                repair_stage_stats: Vec::new(),
            },
        );
        assert_eq!(result.stage, CopilotWarmupStage::Ready);
        assert_eq!(result.failure_code, None);
        assert!(result.connected);
        assert!(result.boot_token_present);
    }

    #[test]
    fn classify_warmup_login_required_response() {
        let result = classify_warmup_status_response(
            "req-2",
            9360,
            true,
            crate::copilot_server::CopilotStatusResponse {
                connected: false,
                login_required: true,
                url: Some("https://login.microsoftonline.com/".to_string()),
                error: Some("Sign in to Copilot in Edge, then return here.".to_string()),
                last_bridge_failure: None,
                repair_stage_stats: Vec::new(),
            },
        );
        assert_eq!(result.stage, CopilotWarmupStage::LoginCheck);
        assert_eq!(
            result.failure_code,
            Some(CopilotWarmupFailureCode::LoginRequired)
        );
        assert!(result.login_required);
    }

    #[test]
    fn classify_warmup_copilot_tab_unavailable_response() {
        let result = classify_warmup_status_response(
            "req-3",
            9360,
            false,
            crate::copilot_server::CopilotStatusResponse {
                connected: false,
                login_required: false,
                url: None,
                error: Some("Copilot page not available".to_string()),
                last_bridge_failure: None,
                repair_stage_stats: Vec::new(),
            },
        );
        assert_eq!(result.stage, CopilotWarmupStage::CopilotTab);
        assert_eq!(
            result.failure_code,
            Some(CopilotWarmupFailureCode::CopilotTabUnavailable)
        );
        assert!(!result.connected);
    }
}
