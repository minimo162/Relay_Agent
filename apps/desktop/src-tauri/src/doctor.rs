#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use desktop_core::doctor::{
    failed_check, ok_check, report_from_checks as core_report_from_checks, runtime_assets_check,
    warn_check, workspace_config_check, RELAY_MAX_TEXT_FILE_READ_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::State;
use uuid::Uuid;

use crate::app_services::{AppServices, CopilotBridgeManager};
use crate::copilot_server::{
    CopilotError, CopilotStatusCheckError, CopilotStatusHttpError, CopilotStatusResponse,
    RELAY_COPILOT_SERVICE_NAME,
};
use crate::models::{
    BrowserAutomationSettings, CopilotWarmupFailureCode, CopilotWarmupResult, CopilotWarmupStage,
    RelayDiagnostics, RelayDoctorCheck, RelayDoctorReport,
};
use crate::registry::SessionRegistry;

const DEFAULT_BROWSER_TIMEOUT_MS: u32 = 120_000;
const DOCTOR_BRIDGE_URL_ENV: &str = "RELAY_DOCTOR_BRIDGE_URL";
const DOCTOR_BOOT_TOKEN_ENV: &str = "RELAY_DOCTOR_BOOT_TOKEN";

#[derive(Clone, Debug)]
pub struct RelayDoctorOptions {
    pub workspace: Option<PathBuf>,
    pub browser_settings: BrowserAutomationSettings,
    pub auto_launch_edge: bool,
}

#[derive(Clone, Debug)]
struct DoctorBridgeOverride {
    url: String,
    boot_token: Option<String>,
}

#[derive(Debug)]
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

#[derive(Debug)]
enum BridgeStatusOutcome {
    Ready(Box<CopilotStatusResponse>),
    LoginRequired {
        message: String,
        status_code: Option<u16>,
        url: Option<String>,
    },
    Unauthorized {
        message: String,
        status_code: Option<u16>,
    },
    Failed {
        message: String,
        status_code: Option<u16>,
        url: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    status: String,
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    instance_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusErrorBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

impl Default for RelayDoctorOptions {
    fn default() -> Self {
        Self {
            workspace: std::env::current_dir().ok(),
            browser_settings: default_browser_settings(),
            auto_launch_edge: true,
        }
    }
}

#[must_use]
pub fn default_browser_settings() -> BrowserAutomationSettings {
    BrowserAutomationSettings {
        cdp_port: crate::tauri_bridge::effective_cdp_port(None),
        auto_launch_edge: true,
        timeout_ms: DEFAULT_BROWSER_TIMEOUT_MS,
    }
}

fn status_timeout_secs(timeout_ms: u32) -> u64 {
    let millis = u64::from(timeout_ms.clamp(10_000, 900_000));
    std::cmp::max(10, millis / 1_000)
}

fn timeout_duration(timeout_ms: u32) -> Duration {
    Duration::from_millis(u64::from(timeout_ms.clamp(1_000, 900_000)))
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

pub async fn warmup_copilot_bridge(
    registry: SessionRegistry,
    bridge: Arc<CopilotBridgeManager>,
    browser_settings: Option<BrowserAutomationSettings>,
) -> Result<CopilotWarmupResult, String> {
    let settings = browser_settings.unwrap_or_else(default_browser_settings);
    let request_id = Uuid::new_v4().to_string();
    tokio::task::spawn_blocking(move || {
        run_copilot_warmup_blocking(registry, bridge, settings, request_id)
    })
    .await
    .map_err(|e| format!("copilot warmup task: {e}"))?
}

pub fn run_copilot_warmup_blocking(
    registry: SessionRegistry,
    bridge: Arc<CopilotBridgeManager>,
    browser_settings: BrowserAutomationSettings,
    request_id: String,
) -> Result<CopilotWarmupResult, String> {
    let cdp_port = crate::tauri_bridge::effective_cdp_port(Some(&browser_settings));
    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present=false",
        request_id,
        cdp_port,
        "ensure_server",
    );
    let server_arc = match crate::tauri_bridge::ensure_copilot_server(
        cdp_port,
        true,
        bridge,
        Some(&registry),
    ) {
        Ok(server_arc) => server_arc,
        Err(error) => {
            tracing::warn!(
                    "[CopilotWarmup] request_id={} cdp_port={} stage={} outcome=failed failure_code={} message={}",
                    request_id,
                    cdp_port,
                    "ensure_server",
                    "ensure_server_failed",
                    error
                );
            return Ok(warmup_result(
                &request_id,
                cdp_port,
                false,
                CopilotWarmupStage::EnsureServer,
                error,
                CopilotWarmupResultSpec::failed(Some(CopilotWarmupFailureCode::EnsureServerFailed)),
            ));
        }
    };

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("copilot warmup runtime: {e}"))?;
    let mut guard = server_arc
        .lock()
        .map_err(|e| format!("copilot server mutex poisoned: {e}"))?;
    let boot_token_present = guard.boot_token().is_some();

    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present={}",
        request_id,
        cdp_port,
        "health_check",
        boot_token_present,
    );
    if let Err(error) = runtime.block_on(guard.health_check()) {
        tracing::warn!(
            "[CopilotWarmup] request_id={} cdp_port={} stage={} outcome=failed failure_code={} boot_token_present={} message={}",
            request_id,
            cdp_port,
            "health_check",
            "health_check_failed",
            boot_token_present,
            error
        );
        return Ok(warmup_result(
            &request_id,
            cdp_port,
            boot_token_present,
            CopilotWarmupStage::HealthCheck,
            error.to_string(),
            CopilotWarmupResultSpec::failed(Some(CopilotWarmupFailureCode::HealthCheckFailed)),
        ));
    }

    tracing::info!(
        "[CopilotWarmup] request_id={} cdp_port={} stage={} boot_token_present={}",
        request_id,
        cdp_port,
        "status_request",
        boot_token_present,
    );
    let result = match runtime.block_on(
        guard.status_with_timeout_detailed(status_timeout_secs(browser_settings.timeout_ms)),
    ) {
        Ok(response) => {
            classify_warmup_status_response(&request_id, cdp_port, boot_token_present, response)
        }
        Err(CopilotStatusCheckError::Http(error)) => {
            classify_warmup_status_http_error(&request_id, cdp_port, boot_token_present, error)
        }
        Err(CopilotStatusCheckError::Transport(error)) => {
            classify_warmup_status_transport_error(&request_id, cdp_port, boot_token_present, error)
        }
    };
    log_warmup_result(&result);
    Ok(result)
}

pub async fn get_relay_diagnostics(bridge: Arc<CopilotBridgeManager>) -> RelayDiagnostics {
    let opencode_snapshot = crate::opencode_runtime::snapshot().await;
    let mut diagnostics = tokio::task::spawn_blocking(move || relay_diagnostics_blocking(bridge))
        .await
        .unwrap_or_else(|error| {
            let mut diagnostics = relay_diagnostics_base();
            diagnostics
                .doctor_hints
                .push(format!("Copilot bridge diagnostics task failed: {error}"));
            diagnostics
        });
    diagnostics.opencode_runtime_url = opencode_snapshot.url;
    diagnostics.opencode_runtime_running = Some(opencode_snapshot.running);
    diagnostics.opencode_runtime_message = Some(opencode_snapshot.message);
    diagnostics
}

pub fn relay_diagnostics_blocking(bridge: Arc<CopilotBridgeManager>) -> RelayDiagnostics {
    let mut diagnostics = relay_diagnostics_base();
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

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            diagnostics
                .doctor_hints
                .push(format!("copilot diagnostics runtime: {error}"));
            return diagnostics;
        }
    };

    let mut server = match server_arc.lock() {
        Ok(server) => server,
        Err(error) => {
            diagnostics
                .doctor_hints
                .push(format!("copilot server mutex poisoned: {error}"));
            return diagnostics;
        }
    };

    diagnostics.copilot_bridge_running = Some(server.is_running());
    diagnostics.copilot_bridge_cdp_port = Some(server.cdp_port());
    diagnostics.copilot_boot_token_present = Some(server.boot_token().is_some());

    if server.is_running() {
        match runtime.block_on(server.status()) {
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
                diagnostics.copilot_repair_stage_stats = if status.repair_stage_stats.is_empty() {
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
                diagnostics.copilot_repair_stage_stats = server.last_repair_stage_stats().to_vec();
            }
        }
    } else {
        diagnostics.last_copilot_bridge_failure = server.last_bridge_failure().cloned();
        diagnostics.copilot_repair_stage_stats = server.last_repair_stage_stats().to_vec();
    }

    diagnostics
}

#[must_use]
pub fn run_doctor_blocking(options: RelayDoctorOptions) -> RelayDoctorReport {
    let browser_settings = options.browser_settings.clone();
    let override_config = doctor_bridge_override_from_env();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("doctor runtime");

    let mut checks = Vec::new();
    checks.push(workspace_config_check(options.workspace.as_deref()));
    checks.push(runtime_assets_check());
    checks.push(runtime.block_on(check_opencode_runtime()));

    if options.auto_launch_edge {
        run_doctor_with_auto_launch(&runtime, &browser_settings, &mut checks);
    } else {
        run_doctor_without_auto_launch(&runtime, &browser_settings, override_config, &mut checks);
    }

    report_from_checks(browser_settings, checks)
}

fn run_doctor_with_auto_launch(
    runtime: &tokio::runtime::Runtime,
    browser_settings: &BrowserAutomationSettings,
    checks: &mut Vec<RelayDoctorCheck>,
) {
    let registry = SessionRegistry::new();
    let bridge = Arc::new(CopilotBridgeManager::new());
    match crate::tauri_bridge::ensure_copilot_server(
        browser_settings.cdp_port,
        true,
        bridge,
        Some(&registry),
    ) {
        Ok(server_arc) => run_started_bridge_checks(runtime, browser_settings, checks, server_arc),
        Err(error) => {
            checks.push(runtime.block_on(check_cdp_reachability(
                browser_settings.cdp_port,
                browser_settings.timeout_ms,
            )));
            checks.push(failed_check(
                "bridge_health",
                format!("Failed to start Relay bridge for doctor: {error}"),
                None,
            ));
            checks.push(failed_check(
                "bridge_status",
                "Bridge status could not be checked because Relay could not start the bridge.",
                None,
            ));
            checks.push(warn_check(
                "m365_sign_in",
                "M365 sign-in state could not be determined because bridge startup failed.",
                None,
            ));
        }
    }
}

fn run_started_bridge_checks(
    runtime: &tokio::runtime::Runtime,
    browser_settings: &BrowserAutomationSettings,
    checks: &mut Vec<RelayDoctorCheck>,
    server_arc: Arc<std::sync::Mutex<crate::copilot_server::CopilotServer>>,
) {
    checks.push(runtime.block_on(check_cdp_reachability(
        browser_settings.cdp_port,
        browser_settings.timeout_ms,
    )));

    let mut server = match server_arc.lock() {
        Ok(server) => server,
        Err(error) => {
            checks.push(failed_check(
                "bridge_health",
                format!("copilot server mutex poisoned: {error}"),
                None,
            ));
            checks.push(failed_check(
                "bridge_status",
                "Bridge status could not be checked because the server lock failed.",
                None,
            ));
            checks.push(warn_check(
                "m365_sign_in",
                "M365 sign-in state could not be determined because bridge status failed.",
                None,
            ));
            return;
        }
    };

    checks.push(match runtime.block_on(server.health_check()) {
        Ok(()) => ok_check(
            "bridge_health",
            "Bridge /health responded with the expected Relay fingerprint.",
            Some(json!({
                "serverUrl": server.server_url(),
                "bootTokenPresent": server.boot_token().is_some(),
            })),
        ),
        Err(error) => failed_check(
            "bridge_health",
            error.to_string(),
            Some(json!({
                "serverUrl": server.server_url(),
            })),
        ),
    });

    let outcome = match runtime.block_on(
        server.status_with_timeout_detailed(status_timeout_secs(browser_settings.timeout_ms)),
    ) {
        Ok(status) => BridgeStatusOutcome::Ready(Box::new(status)),
        Err(CopilotStatusCheckError::Http(error)) => classify_status_http_error(error),
        Err(CopilotStatusCheckError::Transport(error)) => BridgeStatusOutcome::Failed {
            message: error.to_string(),
            status_code: None,
            url: None,
        },
    };
    push_status_outcome_checks(checks, outcome);
}

fn run_doctor_without_auto_launch(
    runtime: &tokio::runtime::Runtime,
    browser_settings: &BrowserAutomationSettings,
    override_config: Option<DoctorBridgeOverride>,
    checks: &mut Vec<RelayDoctorCheck>,
) {
    checks.push(runtime.block_on(check_cdp_reachability(
        browser_settings.cdp_port,
        browser_settings.timeout_ms,
    )));

    if let Some(override_config) = override_config {
        checks.push(runtime.block_on(check_bridge_health_url(
            &override_config.url,
            browser_settings.timeout_ms,
        )));
        if let Some(token) = override_config.boot_token {
            let outcome = runtime.block_on(check_bridge_status_url(
                &override_config.url,
                Some(&token),
                browser_settings.timeout_ms,
            ));
            push_status_outcome_checks(checks, outcome);
        } else {
            checks.push(warn_check(
                "bridge_status",
                "Bridge status check was skipped because no boot token override was provided.",
                Some(json!({
                    "serverUrl": override_config.url,
                })),
            ));
            checks.push(warn_check(
                "m365_sign_in",
                "M365 sign-in state could not be determined because authenticated bridge status was skipped.",
                Some(json!({
                    "serverUrl": override_config.url,
                })),
            ));
        }
        return;
    }

    let default_url = format!(
        "http://127.0.0.1:{}",
        crate::tauri_bridge::COPILOT_HTTP_PORT
    );
    checks.push(runtime.block_on(check_bridge_health_url(
        &default_url,
        browser_settings.timeout_ms,
    )));
    checks.push(warn_check(
        "bridge_status",
        "Bridge status check was skipped because --no-auto-launch-edge was set and no test bridge override was provided.",
        Some(json!({
            "serverUrl": default_url,
        })),
    ));
    checks.push(warn_check(
        "m365_sign_in",
        "M365 sign-in state could not be determined because authenticated bridge status was skipped.",
        None,
    ));
}

fn report_from_checks(
    browser_settings: BrowserAutomationSettings,
    checks: Vec<RelayDoctorCheck>,
) -> RelayDoctorReport {
    core_report_from_checks(browser_settings, checks, relay_doctor_hints())
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
        "Copilot Node bridge port {}; default Edge CDP target port {} (see scripts/start-relay-edge-cdp.sh and docs/COPILOT_E2E_CDP_PITFALLS.md).",
        crate::tauri_bridge::COPILOT_HTTP_PORT,
        crate::tauri_bridge::COPILOT_JS_CDP_PORT,
    ));
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
        "PDF read_file uses LiteParse via bundled relay-node when present (see README / AGENTS.md)."
            .into(),
    );
    hints
}

fn relay_diagnostics_base() -> RelayDiagnostics {
    let dev = std::env::var("RELAY_AGENT_DEV_MODE").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    });
    let process_cwd = std::env::current_dir().map_or_else(
        |error| format!("(unavailable: {error})"),
        |path| path.display().to_string(),
    );
    let claw_config_home_display = std::env::var("CLAW_CONFIG_HOME").map_or_else(
        |_| "~/.claw (default; set CLAW_CONFIG_HOME to override)".to_string(),
        |value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                "~/.claw (default)".to_string()
            } else {
                trimmed.to_string()
            }
        },
    );
    RelayDiagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        target_os: std::env::consts::OS.to_string(),
        copilot_node_bridge_port: crate::tauri_bridge::COPILOT_HTTP_PORT,
        default_edge_cdp_port: crate::tauri_bridge::COPILOT_JS_CDP_PORT,
        relay_agent_dev_mode: dev,
        architecture_notes: "Relay is the desktop UX and adapter between M365 Copilot CDP and OpenCode/OpenWork execution. Copilot controls the turn; OpenCode/OpenWork owns tool execution state.".to_string(),
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

fn doctor_bridge_override_from_env() -> Option<DoctorBridgeOverride> {
    let url = std::env::var(DOCTOR_BRIDGE_URL_ENV).ok()?;
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return None;
    }
    let boot_token = std::env::var(DOCTOR_BOOT_TOKEN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Some(DoctorBridgeOverride { url, boot_token })
}

async fn check_opencode_runtime() -> RelayDoctorCheck {
    let snapshot = crate::opencode_runtime::snapshot().await;
    if snapshot.running {
        ok_check(
            "opencode_runtime",
            snapshot.message,
            Some(json!({
                "backend": crate::opencode_runtime::execution_backend_name(),
                "url": snapshot.url,
            })),
        )
    } else {
        warn_check(
            "opencode_runtime",
            snapshot.message,
            Some(json!({
                "backend": crate::opencode_runtime::execution_backend_name(),
                "url": snapshot.url,
                "urlEnv": "RELAY_OPENCODE_TOOL_RUNTIME_URL",
            })),
        )
    }
}

async fn check_cdp_reachability(cdp_port: u16, timeout_ms: u32) -> RelayDoctorCheck {
    let url = format!("http://127.0.0.1:{cdp_port}/json/version");
    let client = reqwest::Client::new();
    let timeout = timeout_duration(timeout_ms);
    let retry_until = tokio::time::Instant::now() + timeout.min(Duration::from_millis(1_500));

    loop {
        match client.get(&url).timeout(timeout).send().await {
            Ok(response) if response.status().is_success() => {
                let details = response.json::<JsonValue>().await.ok();
                return ok_check(
                    "edge_cdp",
                    "Edge CDP endpoint is reachable.",
                    Some(json!({
                        "url": url,
                        "details": details,
                    })),
                );
            }
            Ok(response) => {
                let status = response.status();
                if tokio::time::Instant::now() >= retry_until {
                    return failed_check(
                        "edge_cdp",
                        format!("Edge CDP probe returned HTTP {status}"),
                        Some(json!({
                            "url": url,
                            "status": status.as_u16(),
                        })),
                    );
                }
            }
            Err(error) => {
                if tokio::time::Instant::now() >= retry_until {
                    return failed_check(
                        "edge_cdp",
                        format!("Edge CDP probe failed: {error}"),
                        Some(json!({
                            "url": url,
                        })),
                    );
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn check_bridge_health_url(url: &str, timeout_ms: u32) -> RelayDoctorCheck {
    let client = reqwest::Client::new();
    let health_url = format!("{}/health", url.trim_end_matches('/'));
    match client
        .get(&health_url)
        .timeout(timeout_duration(timeout_ms))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match response.json::<HealthBody>().await
        {
            Ok(body)
                if body.status == "ok"
                    && body.service.as_deref() == Some(RELAY_COPILOT_SERVICE_NAME) =>
            {
                ok_check(
                    "bridge_health",
                    "Bridge /health responded with the expected Relay fingerprint.",
                    Some(json!({
                        "serverUrl": url,
                        "instanceId": body.instance_id,
                    })),
                )
            }
            Ok(body) => failed_check(
                "bridge_health",
                "Bridge /health returned an unexpected fingerprint.",
                Some(json!({
                    "serverUrl": url,
                    "body": body,
                })),
            ),
            Err(error) => failed_check(
                "bridge_health",
                format!("Bridge /health JSON parse failed: {error}"),
                Some(json!({
                    "serverUrl": url,
                })),
            ),
        },
        Ok(response) => failed_check(
            "bridge_health",
            format!("Bridge /health returned HTTP {}", response.status()),
            Some(json!({
                "serverUrl": url,
                "status": response.status().as_u16(),
            })),
        ),
        Err(error) => failed_check(
            "bridge_health",
            format!("Bridge /health probe failed: {error}"),
            Some(json!({
                "serverUrl": url,
            })),
        ),
    }
}

async fn check_bridge_status_url(
    url: &str,
    boot_token: Option<&str>,
    timeout_ms: u32,
) -> BridgeStatusOutcome {
    let client = reqwest::Client::new();
    let mut request = client
        .get(format!("{}/status", url.trim_end_matches('/')))
        .timeout(timeout_duration(timeout_ms));
    if let Some(token) = boot_token {
        request = request.header("X-Relay-Boot-Token", token);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return BridgeStatusOutcome::Failed {
                message: format!("Bridge /status request failed: {error}"),
                status_code: None,
                url: None,
            }
        }
    };

    if response.status().is_success() {
        match response.json::<CopilotStatusResponse>().await {
            Ok(status) if status.login_required => BridgeStatusOutcome::LoginRequired {
                message: status
                    .error
                    .clone()
                    .unwrap_or_else(|| "M365 Copilot sign-in is required.".to_string()),
                status_code: None,
                url: status.url.clone(),
            },
            Ok(status) => BridgeStatusOutcome::Ready(Box::new(status)),
            Err(error) => BridgeStatusOutcome::Failed {
                message: format!("Bridge /status JSON parse failed: {error}"),
                status_code: None,
                url: None,
            },
        }
    } else {
        let status_code = response.status().as_u16();
        let body = response.json::<StatusErrorBody>().await.ok();
        let http_error = CopilotStatusHttpError {
            status: status_code,
            error_code: body.as_ref().and_then(|value| value.error.clone()),
            message: body.as_ref().and_then(|value| value.message.clone()),
            url: body.and_then(|value| value.url),
        };
        classify_status_http_error(http_error)
    }
}

fn classify_status_http_error(error: CopilotStatusHttpError) -> BridgeStatusOutcome {
    match error.error_code.as_deref() {
        Some("unauthorized") => BridgeStatusOutcome::Unauthorized {
            message: error
                .message
                .clone()
                .unwrap_or_else(|| "Bridge /status rejected the boot token.".to_string()),
            status_code: Some(error.status),
        },
        Some("login_required") => BridgeStatusOutcome::LoginRequired {
            message: error
                .message
                .clone()
                .unwrap_or_else(|| "M365 Copilot sign-in is required.".to_string()),
            status_code: Some(error.status),
            url: error.url.clone(),
        },
        _ => BridgeStatusOutcome::Failed {
            message: error
                .message
                .clone()
                .unwrap_or_else(|| format!("Bridge /status failed with HTTP {}", error.status)),
            status_code: Some(error.status),
            url: error.url.clone(),
        },
    }
}

fn push_status_outcome_checks(checks: &mut Vec<RelayDoctorCheck>, outcome: BridgeStatusOutcome) {
    match outcome {
        BridgeStatusOutcome::Ready(status) => {
            checks.push(ok_check(
                "bridge_status",
                if status.connected {
                    "Authenticated bridge status succeeded."
                } else {
                    "Authenticated bridge status returned a non-ready state."
                },
                Some(json!({
                    "connected": status.connected,
                    "loginRequired": status.login_required,
                    "url": status.url,
                    "error": status.error,
                })),
            ));
            if status.connected {
                checks.push(ok_check(
                    "m365_sign_in",
                    "M365 Copilot appears signed in and reachable.",
                    Some(json!({
                        "url": status.url,
                    })),
                ));
            } else {
                checks.push(warn_check(
                    "m365_sign_in",
                    status.error.unwrap_or_else(|| {
                        "Could not confirm M365 sign-in state from bridge status.".to_string()
                    }),
                    Some(json!({
                        "url": status.url,
                    })),
                ));
            }
        }
        BridgeStatusOutcome::LoginRequired {
            message,
            status_code,
            url,
        } => {
            checks.push(warn_check(
                "bridge_status",
                "Authenticated bridge status reached Copilot, but the session requires sign-in.",
                Some(json!({
                    "statusCode": status_code,
                    "url": url,
                })),
            ));
            checks.push(warn_check(
                "m365_sign_in",
                message,
                Some(json!({
                    "statusCode": status_code,
                    "url": url,
                })),
            ));
        }
        BridgeStatusOutcome::Unauthorized {
            message,
            status_code,
        } => {
            checks.push(failed_check(
                "bridge_status",
                message,
                Some(json!({
                    "statusCode": status_code,
                })),
            ));
            checks.push(warn_check(
                "m365_sign_in",
                "M365 sign-in state could not be determined because authenticated bridge status failed.",
                Some(json!({
                    "statusCode": status_code,
                })),
            ));
        }
        BridgeStatusOutcome::Failed {
            message,
            status_code,
            url,
        } => {
            checks.push(failed_check(
                "bridge_status",
                message,
                Some(json!({
                    "statusCode": status_code,
                    "url": url,
                })),
            ));
            checks.push(warn_check(
                "m365_sign_in",
                "M365 sign-in state could not be determined because bridge status failed.",
                Some(json!({
                    "statusCode": status_code,
                    "url": url,
                })),
            ));
        }
    }
}

fn classify_warmup_status_response(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    response: CopilotStatusResponse,
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
                .unwrap_or_else(|| "Copilot sign-in required.".to_string()),
            CopilotWarmupResultSpec {
                connected: false,
                login_required: true,
                failure_code: Some(CopilotWarmupFailureCode::LoginRequired),
                status_code: None,
                url: response.url,
            },
        );
    }
    warmup_result(
        request_id,
        cdp_port,
        boot_token_present,
        CopilotWarmupStage::StatusRequest,
        response
            .error
            .unwrap_or_else(|| "Copilot bridge status not ready.".to_string()),
        CopilotWarmupResultSpec {
            connected: false,
            login_required: false,
            failure_code: Some(CopilotWarmupFailureCode::Unknown),
            status_code: None,
            url: response.url,
        },
    )
}

fn classify_warmup_status_http_error(
    request_id: &str,
    cdp_port: u16,
    boot_token_present: bool,
    error: CopilotStatusHttpError,
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
    error: CopilotError,
) -> CopilotWarmupResult {
    let error_text = error.to_string();
    let lowered = error_text.to_ascii_lowercase();
    let (stage, failure_code) = if lowered.contains("cdp")
        || lowered.contains("debugging endpoint")
        || lowered.contains("websocket")
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

pub async fn warmup_copilot_bridge_from_state(
    services: State<'_, AppServices>,
    browser_settings: Option<BrowserAutomationSettings>,
) -> Result<CopilotWarmupResult, String> {
    warmup_copilot_bridge(
        services.registry(),
        services.copilot_bridge(),
        browser_settings,
    )
    .await
}

pub async fn get_relay_diagnostics_from_state(
    services: State<'_, AppServices>,
) -> RelayDiagnostics {
    get_relay_diagnostics(services.copilot_bridge()).await
}
