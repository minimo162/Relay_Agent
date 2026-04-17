use std::{
    env,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::time::sleep;
use tracing::{info, warn};
use uuid::Uuid;

use crate::models::{CopilotBridgeFailureInfo, CopilotRepairStageStats};

const READY_TIMEOUT_SECS: u64 = 30;
const HEALTH_POLL_INTERVAL_MS: u64 = 500;
/// `GET /status` drives Edge launch + navigation; allow longer than default HTTP client timeout.
const WARMUP_STATUS_TIMEOUT_SECS: u64 = 120;
const COMPLETION_REJOIN_TIMEOUT_SECS: u64 = 90;
const ABORT_REQUEST_TIMEOUT_SECS: u64 = 5;
/// If `127.0.0.1:18080` is held by a stray `node copilot_server.js` (e.g. after `--keep-app`), try the next ports.
const COPILOT_HTTP_PORT_FALLBACKS: u16 = 32;
pub(crate) const RELAY_COPILOT_SERVICE_NAME: &str = "relay_copilot_server";

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotStatusResponse {
    pub connected: bool,
    pub login_required: bool,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub last_bridge_failure: Option<CopilotBridgeFailureInfo>,
    #[serde(default)]
    pub repair_stage_stats: Vec<CopilotRepairStageStats>,
}

#[derive(Debug, Clone)]
pub struct CopilotStatusHttpError {
    pub status: u16,
    pub error_code: Option<String>,
    pub message: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug)]
pub enum CopilotStatusCheckError {
    Transport(CopilotError),
    Http(CopilotStatusHttpError),
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptErrorBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    failure_class: Option<String>,
    #[serde(default)]
    stage_label: Option<String>,
    #[serde(default)]
    request_chain: Option<String>,
    #[serde(default)]
    request_attempt: Option<usize>,
    #[serde(default)]
    transport_attempt: Option<usize>,
    #[serde(default)]
    repair_replay_attempt: Option<usize>,
    #[serde(default)]
    want_new_chat: Option<bool>,
    #[serde(default)]
    new_chat_ready: Option<bool>,
    #[serde(default)]
    submit_observed: Option<bool>,
    #[serde(default)]
    network_seed_seen: Option<bool>,
    #[serde(default)]
    dom_wait_started: Option<bool>,
    #[serde(default)]
    dom_wait_finished: Option<bool>,
    #[serde(default)]
    paste_done: Option<bool>,
    #[serde(default)]
    new_chat_ready_elapsed_ms: Option<u64>,
    #[serde(default)]
    paste_elapsed_ms: Option<u64>,
    #[serde(default)]
    wait_response_elapsed_ms: Option<u64>,
    #[serde(default)]
    total_elapsed_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    status: String,
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    instance_id: Option<String>,
}

fn validate_health_body(
    expected_instance_id: Option<&str>,
    body: &HealthBody,
) -> Result<(), String> {
    if body.status != "ok" {
        return Err(format!(
            "health check failed: body status {:?}",
            body.status
        ));
    }
    if body.service.as_deref() != Some(RELAY_COPILOT_SERVICE_NAME) {
        return Err(format!(
            "health check failed: unexpected service {:?}",
            body.service
        ));
    }
    if let Some(expected) = expected_instance_id {
        if body.instance_id.as_deref() != Some(expected) {
            return Err("unexpected copilot_server instance".to_string());
        }
    }
    Ok(())
}

fn prompt_error_to_bridge_failure(body: &PromptErrorBody) -> Option<CopilotBridgeFailureInfo> {
    let failure = CopilotBridgeFailureInfo {
        failure_class: body.failure_class.clone(),
        stage_label: body.stage_label.clone(),
        request_chain: body.request_chain.clone(),
        request_attempt: body.request_attempt,
        transport_attempt: body.transport_attempt,
        repair_replay_attempt: body.repair_replay_attempt,
        want_new_chat: body.want_new_chat,
        new_chat_ready: body.new_chat_ready,
        paste_done: body.paste_done,
        submit_observed: body.submit_observed,
        network_seed_seen: body.network_seed_seen,
        dom_wait_started: body.dom_wait_started,
        dom_wait_finished: body.dom_wait_finished,
        new_chat_ready_elapsed_ms: body.new_chat_ready_elapsed_ms,
        paste_elapsed_ms: body.paste_elapsed_ms,
        wait_response_elapsed_ms: body.wait_response_elapsed_ms,
        total_elapsed_ms: body.total_elapsed_ms,
        message: body
            .message
            .clone()
            .or(body.error.clone())
            .filter(|value| !value.trim().is_empty()),
    };
    let has_metadata = failure.failure_class.is_some()
        || failure.stage_label.is_some()
        || failure.request_chain.is_some()
        || failure.request_attempt.is_some()
        || failure.transport_attempt.is_some()
        || failure.repair_replay_attempt.is_some()
        || failure.want_new_chat.is_some()
        || failure.new_chat_ready.is_some()
        || failure.paste_done.is_some()
        || failure.submit_observed.is_some()
        || failure.network_seed_seen.is_some()
        || failure.dom_wait_started.is_some()
        || failure.dom_wait_finished.is_some()
        || failure.new_chat_ready_elapsed_ms.is_some()
        || failure.paste_elapsed_ms.is_some()
        || failure.wait_response_elapsed_ms.is_some()
        || failure.total_elapsed_ms.is_some();
    has_metadata.then_some(failure)
}

fn format_bridge_failure(failure: &CopilotBridgeFailureInfo) -> String {
    let mut parts = Vec::new();
    if let Some(value) = &failure.failure_class {
        parts.push(format!("failureClass={value}"));
    }
    if let Some(value) = &failure.stage_label {
        parts.push(format!("stageLabel={value}"));
    }
    if let Some(value) = &failure.request_chain {
        parts.push(format!("requestChain={value}"));
    }
    if let Some(value) = failure.request_attempt {
        parts.push(format!("requestAttempt={value}"));
    }
    if let Some(value) = failure.transport_attempt {
        parts.push(format!("transportAttempt={value}"));
    }
    if let Some(value) = failure.repair_replay_attempt {
        parts.push(format!("repairReplayAttempt={value}"));
    }
    if let Some(value) = failure.want_new_chat {
        parts.push(format!("wantNewChat={value}"));
    }
    if let Some(value) = failure.new_chat_ready {
        parts.push(format!("newChatReady={value}"));
    }
    if let Some(value) = failure.paste_done {
        parts.push(format!("pasteDone={value}"));
    }
    if let Some(value) = failure.submit_observed {
        parts.push(format!("submitObserved={value}"));
    }
    if let Some(value) = failure.network_seed_seen {
        parts.push(format!("networkSeedSeen={value}"));
    }
    if let Some(value) = failure.dom_wait_started {
        parts.push(format!("domWaitStarted={value}"));
    }
    if let Some(value) = failure.dom_wait_finished {
        parts.push(format!("domWaitFinished={value}"));
    }
    if let Some(value) = failure.new_chat_ready_elapsed_ms {
        parts.push(format!("newChatReadyElapsedMs={value}"));
    }
    if let Some(value) = failure.paste_elapsed_ms {
        parts.push(format!("pasteElapsedMs={value}"));
    }
    if let Some(value) = failure.wait_response_elapsed_ms {
        parts.push(format!("waitResponseElapsedMs={value}"));
    }
    if let Some(value) = failure.total_elapsed_ms {
        parts.push(format!("totalElapsedMs={value}"));
    }
    if let Some(value) = &failure.message {
        parts.push(format!("message={value}"));
    }
    parts.join(" ")
}

#[derive(Debug, Clone)]
pub enum CopilotPromptFailure {
    Message(String),
    Bridge(CopilotBridgeFailureInfo),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotProgressSnapshot {
    pub relay_session_id: String,
    pub relay_request_id: String,
    pub visible_text: String,
    pub done: bool,
    pub phase: String,
    pub updated_at: u64,
}

#[derive(Clone)]
pub struct CopilotProgressProbe {
    server_url: String,
    boot_token: Option<String>,
    client: Client,
}

impl CopilotProgressProbe {
    pub async fn fetch(
        &self,
        relay_session_id: &str,
        relay_request_id: &str,
    ) -> Result<Option<CopilotProgressSnapshot>, CopilotError> {
        let url = format!("{}/v1/chat/progress", self.server_url);
        let mut request = self
            .client
            .get(url)
            .query(&[
                ("relay_session_id", relay_session_id),
                ("relay_request_id", relay_request_id),
            ])
            .timeout(Duration::from_secs(3));
        if let Some(token) = &self.boot_token {
            request = request.header("X-Relay-Boot-Token", token);
        }
        let response = request.send().await.map_err(CopilotError::Http)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(parse_prompt_error_body(status, &body));
        }
        let snapshot = response
            .json::<CopilotProgressSnapshot>()
            .await
            .map_err(CopilotError::Http)?;
        Ok(Some(snapshot))
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CopilotSendPromptRequest<'a> {
    pub relay_session_id: &'a str,
    pub relay_request_id: &'a str,
    pub relay_request_chain: &'a str,
    pub relay_request_attempt: usize,
    pub relay_stage_label: &'a str,
    pub relay_probe_mode: bool,
    pub relay_force_fresh_chat: bool,
    pub system_prompt: &'a str,
    pub user_prompt: &'a str,
    pub timeout_secs: u64,
    pub attachment_paths: &'a [String],
    pub new_chat: bool,
}

fn parse_prompt_error_body(status: reqwest::StatusCode, raw_body: &str) -> CopilotError {
    let parsed = serde_json::from_str::<PromptErrorBody>(raw_body).ok();
    if let Some(body) = parsed {
        if let Some(failure) = prompt_error_to_bridge_failure(&body) {
            if failure.failure_class.is_some() {
                return CopilotError::PromptError(Box::new(CopilotPromptFailure::Bridge(failure)));
            }
            return CopilotError::BridgeBug(Box::new(failure));
        }
        let message = body
            .error
            .or(body.message)
            .unwrap_or_else(|| "unknown error".to_string());
        return CopilotError::PromptError(Box::new(CopilotPromptFailure::Message(format!(
            "copilot returned {status}: {message}"
        ))));
    }

    match serde_json::from_str::<Value>(raw_body) {
        Ok(value) => CopilotError::PromptError(Box::new(CopilotPromptFailure::Message(format!(
            "copilot returned {status}: {value}"
        )))),
        Err(_) => CopilotError::PromptError(Box::new(CopilotPromptFailure::Message(format!(
            "copilot returned {status}: {raw_body}"
        )))),
    }
}

pub struct CopilotServer {
    process: Option<Arc<Mutex<Child>>>,
    port: u16,
    cdp_port: u16,
    /// Shared out-of-band with `copilot_server.js` for authenticated mutable endpoints only.
    boot_token: Option<String>,
    /// Public `/health` fingerprint so we can identify our spawned bridge instance without exposing the boot token.
    instance_id: Option<String>,
    client: Client,
    script_path: Option<PathBuf>,
    user_data_dir: Option<PathBuf>,
    edge_path: Option<String>,
    last_bridge_failure: Option<CopilotBridgeFailureInfo>,
    last_repair_stage_stats: Vec<CopilotRepairStageStats>,
    #[allow(dead_code)]
    log_threads: Vec<thread::JoinHandle<()>>,
}

#[derive(Debug)]
pub enum CopilotError {
    #[allow(dead_code)]
    #[allow(clippy::upper_case_acronyms)]
    Http(reqwest::Error),
    StartupTimeout,
    ProcessExited(Option<i32>),
    Spawn(std::io::Error),
    #[allow(dead_code)]
    PromptError(Box<CopilotPromptFailure>),
    #[allow(dead_code)]
    BridgeBug(Box<CopilotBridgeFailureInfo>),
}

impl std::fmt::Display for CopilotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CopilotError::Http(e) => write!(f, "HTTP error: {e}"),
            CopilotError::StartupTimeout => write!(
                f,
                "copilot server did not become ready within {READY_TIMEOUT_SECS}s"
            ),
            CopilotError::ProcessExited(code) => {
                write!(f, "copilot server exited with code {code:?}")
            }
            CopilotError::Spawn(e) => write!(f, "failed to spawn copilot server: {e}"),
            CopilotError::PromptError(prompt_error) => match prompt_error.as_ref() {
                CopilotPromptFailure::Message(msg) => {
                    write!(f, "prompt error: {msg}")
                }
                CopilotPromptFailure::Bridge(failure) => {
                    write!(f, "prompt error: {}", format_bridge_failure(failure))
                }
            },
            CopilotError::BridgeBug(failure) => {
                write!(f, "bridge bug: {}", format_bridge_failure(failure))
            }
        }
    }
}

impl std::fmt::Display for CopilotStatusCheckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CopilotStatusCheckError::Transport(error) => write!(f, "{error}"),
            CopilotStatusCheckError::Http(error) => write!(
                f,
                "status check failed: status {} ({})",
                error.status,
                error
                    .error_code
                    .as_deref()
                    .or(error.message.as_deref())
                    .unwrap_or("unknown")
            ),
        }
    }
}

impl CopilotServer {
    pub fn new(
        port: u16,
        cdp_port: u16,
        user_data_dir: Option<PathBuf>,
        edge_path: Option<String>,
    ) -> Result<Self, CopilotError> {
        let script_path = resolve_script_path();
        if script_path.is_none() {
            warn!("[copilot] copilot_server.js not found in any known location");
        }
        Ok(Self {
            process: None,
            port,
            cdp_port,
            boot_token: None,
            instance_id: None,
            client: Client::builder()
                // Per-request timeouts still apply; avoid a tight default that races slow Windows loopback.
                .timeout(Duration::from_secs(30))
                // Stale keep-alive sockets to localhost Node after process restarts → "error sending request".
                .pool_max_idle_per_host(0)
                .build()
                .map_err(CopilotError::Http)?,
            script_path,
            user_data_dir,
            edge_path,
            last_bridge_failure: None,
            last_repair_stage_stats: Vec::new(),
            log_threads: Vec::new(),
        })
    }

    pub fn cdp_port(&self) -> u16 {
        self.cdp_port
    }

    pub fn boot_token(&self) -> Option<&str> {
        self.boot_token.as_deref()
    }

    pub fn last_bridge_failure(&self) -> Option<&CopilotBridgeFailureInfo> {
        self.last_bridge_failure.as_ref()
    }

    pub fn last_repair_stage_stats(&self) -> &[CopilotRepairStageStats] {
        &self.last_repair_stage_stats
    }

    fn set_last_bridge_failure(&mut self, failure: Option<CopilotBridgeFailureInfo>) {
        self.last_bridge_failure = failure;
    }

    fn record_status_snapshot(&mut self, status: &CopilotStatusResponse) {
        if status.last_bridge_failure.is_some() {
            self.last_bridge_failure
                .clone_from(&status.last_bridge_failure);
        }
        self.last_repair_stage_stats
            .clone_from(&status.repair_stage_stats);
    }

    /// Update CDP port before a restart (`stop` + `start`); does not affect the HTTP listen port.
    pub fn set_cdp_port(&mut self, port: u16) {
        self.cdp_port = port;
    }

    pub fn is_running(&self) -> bool {
        if let Some(arc_child) = &self.process {
            match arc_child.lock() {
                Ok(mut child) => match child.try_wait() {
                    Ok(None) => true,
                    Ok(_) | Err(_) => false,
                },
                Err(_) => true, // poisoned means probably alive
            }
        } else {
            false
        }
    }

    pub fn stop(&mut self) {
        if let Some(arc_child) = self.process.take() {
            if let Ok(mut child) = arc_child.lock() {
                info!("[copilot] killing copilot process (pid: {})", child.id());
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    #[allow(clippy::too_many_lines)]
    pub async fn start(&mut self) -> Result<(), CopilotError> {
        if self.process_running() {
            if self.health_check().await.is_ok() {
                return Ok(());
            }
            info!("[copilot] process exists but unhealthy, restarting");
            self.stop();
        }

        let node = find_node().ok_or_else(|| {
            CopilotError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Node.js not found in PATH",
            ))
        })?;
        let script_path = self.script_path.clone().ok_or_else(|| {
            CopilotError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "copilot_server.js not found",
            ))
        })?;

        let preferred_port = self.port;

        for offset in 0..COPILOT_HTTP_PORT_FALLBACKS {
            self.stop();
            self.port = preferred_port.saturating_add(offset);

            if offset > 0 {
                warn!(
                    "[copilot] retrying copilot_server on HTTP port {} (previous port not usable)",
                    self.port
                );
            }

            let boot_token = Uuid::new_v4().to_string();
            let instance_id = Uuid::new_v4().to_string();
            self.boot_token = Some(boot_token.clone());
            self.instance_id = Some(instance_id.clone());

            crate::copilot_port_reclaim::maybe_reclaim_stale_copilot_http_port(
                &self.client,
                self.port,
                &instance_id,
            )
            .await;

            let mut args = vec![
                "--no-warnings".to_string(), // suppress ESM warnings
                script_path.to_string_lossy().to_string(),
                "--port".to_string(),
                self.port.to_string(),
                "--cdp-port".to_string(),
                self.cdp_port.to_string(),
                "--boot-token".to_string(),
                boot_token,
                "--instance-id".to_string(),
                instance_id,
            ];

            if let Some(ref data_dir) = self.user_data_dir {
                args.push("--user-data-dir".to_string());
                args.push(data_dir.to_string_lossy().to_string());
                info!(
                    "[copilot] launching: node {} --port {} --cdp-port {} --user-data-dir {}",
                    script_path.display(),
                    self.port,
                    self.cdp_port,
                    data_dir.display()
                );
            } else {
                info!(
                    "[copilot] launching: node {} --port {} --cdp-port {}",
                    script_path.display(),
                    self.port,
                    self.cdp_port
                );
            }

            let mut child = match Command::new(&node)
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(c) => c,
                Err(e) => return Err(CopilotError::Spawn(e)),
            };

            info!("[copilot] spawned node (pid: {})", child.id());

            // Pipe stderr/stdout to tracing so we can see JS-side errors
            let mut log_threads = Vec::new();
            if let Some(stderr) = child.stderr.take() {
                log_threads.push(thread::spawn(move || {
                    use std::io::BufRead;
                    for line in std::io::BufReader::new(stderr)
                        .lines()
                        .map_while(Result::ok)
                    {
                        tracing::info!("[copilot:err] {line}");
                    }
                }));
            }
            if let Some(stdout) = child.stdout.take() {
                log_threads.push(thread::spawn(move || {
                    use std::io::BufRead;
                    for line in std::io::BufReader::new(stdout)
                        .lines()
                        .map_while(Result::ok)
                    {
                        tracing::info!("[copilot:out] {line}");
                    }
                }));
            }
            self.log_threads = log_threads;
            self.process = Some(Arc::new(Mutex::new(child)));

            match self.wait_for_ready(READY_TIMEOUT_SECS).await {
                Ok(()) => {
                    info!("[copilot] server ready on {}", self.server_url());
                    return Ok(());
                }
                Err(e) => {
                    warn!(
                        "[copilot] copilot_server on port {} did not become ready: {}",
                        self.port, e
                    );
                    self.stop();
                    match e {
                        CopilotError::ProcessExited(_) | CopilotError::StartupTimeout => {}
                        _ => return Err(e),
                    }
                }
            }
        }

        Err(CopilotError::PromptError(Box::new(
            CopilotPromptFailure::Message(format!(
                "copilot_server could not bind on ports {}–{}; stop orphan node.exe processes or free a port",
                preferred_port,
                preferred_port.saturating_add(COPILOT_HTTP_PORT_FALLBACKS - 1)
            )),
        )))
    }

    pub async fn health_check(&self) -> Result<(), CopilotError> {
        let response = self
            .client
            .get(format!("{}/health", self.server_url()))
            .send()
            .await
            .map_err(CopilotError::Http)?;

        if !response.status().is_success() {
            return Err(CopilotError::PromptError(Box::new(
                CopilotPromptFailure::Message(format!(
                    "health check failed: status {}",
                    response.status()
                )),
            )));
        }

        let body: HealthBody = response.json().await.map_err(CopilotError::Http)?;
        if let Err(message) = validate_health_body(self.instance_id.as_deref(), &body) {
            if self.instance_id.is_some()
                && body.service.as_deref() == Some(RELAY_COPILOT_SERVICE_NAME)
                && body.instance_id.as_deref() != self.instance_id.as_deref()
            {
                warn!(
                    "[copilot] /health instanceId mismatch (unexpected bridge on port {}?); expected this session's fingerprint",
                    self.port
                );
            }
            return Err(CopilotError::PromptError(Box::new(
                CopilotPromptFailure::Message(message),
            )));
        }

        Ok(())
    }

    pub async fn status(&mut self) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout(30).await
    }

    /// Same as [`Self::status`] but with an explicit per-request timeout (warmup / Edge cold start).
    pub async fn status_with_timeout(
        &mut self,
        timeout_secs: u64,
    ) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout_detailed(timeout_secs)
            .await
            .map_err(|error| match error {
                CopilotStatusCheckError::Transport(error) => error,
                CopilotStatusCheckError::Http(error) => {
                    CopilotError::PromptError(Box::new(CopilotPromptFailure::Message(format!(
                        "status check failed: status {}{}",
                        error.status,
                        error
                            .error_code
                            .as_deref()
                            .map(|code| format!(" ({code})"))
                            .unwrap_or_default()
                    ))))
                }
            })
    }

    pub async fn status_with_timeout_detailed(
        &mut self,
        timeout_secs: u64,
    ) -> Result<CopilotStatusResponse, CopilotStatusCheckError> {
        let mut request = self
            .client
            .get(format!("{}/status", self.server_url()))
            .timeout(Duration::from_secs(timeout_secs));
        if let Some(token) = &self.boot_token {
            request = request.header("X-Relay-Boot-Token", token);
        }
        let response = request
            .send()
            .await
            .map_err(CopilotError::Http)
            .map_err(CopilotStatusCheckError::Transport)?;

        if response.status().is_success() {
            let status = response
                .json::<CopilotStatusResponse>()
                .await
                .map_err(CopilotError::Http)
                .map_err(CopilotStatusCheckError::Transport)?;
            self.record_status_snapshot(&status);
            Ok(status)
        } else {
            let status = response.status().as_u16();
            let body = response.json::<StatusErrorBody>().await.ok();
            Err(CopilotStatusCheckError::Http(CopilotStatusHttpError {
                status,
                error_code: body.as_ref().and_then(|value| value.error.clone()),
                message: body.as_ref().and_then(|value| value.message.clone()),
                url: body.and_then(|value| value.url),
            }))
        }
    }

    /// Startup warmup: long-timeout `/status` (Edge + Copilot tab + login probe).
    pub async fn warmup_status(&mut self) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout(WARMUP_STATUS_TIMEOUT_SECS).await
    }

    fn http_error_is_timeout(err: &CopilotError) -> bool {
        matches!(err, CopilotError::Http(error) if error.is_timeout())
    }

    fn http_error_is_connect(err: &CopilotError) -> bool {
        matches!(err, CopilotError::Http(error) if error.is_connect())
    }

    fn is_aborted_error(err: &CopilotError) -> bool {
        match err {
            CopilotError::PromptError(prompt_error) => {
                matches!(
                    prompt_error.as_ref(),
                    CopilotPromptFailure::Message(message) if message.contains("relay_copilot_aborted")
                )
            }
            _ => false,
        }
    }

    fn boot_token_error_recoverable(err: &CopilotError) -> bool {
        match err {
            CopilotError::PromptError(prompt_error) => match prompt_error.as_ref() {
                CopilotPromptFailure::Message(message) => {
                    let lowered = message.to_ascii_lowercase();
                    lowered.contains("401")
                        && (lowered.contains("unauthorized")
                            || lowered.contains("copilot returned"))
                }
                CopilotPromptFailure::Bridge(failure) => failure
                    .message
                    .as_deref()
                    .map(str::to_ascii_lowercase)
                    .is_some_and(|lowered| {
                        lowered.contains("401")
                            && (lowered.contains("unauthorized")
                                || lowered.contains("copilot returned")
                                || lowered.contains("status check failed"))
                    }),
            },
            CopilotError::BridgeBug(failure) => failure
                .message
                .as_deref()
                .map(str::to_ascii_lowercase)
                .is_some_and(|lowered| {
                    lowered.contains("401")
                        && (lowered.contains("unauthorized")
                            || lowered.contains("copilot returned")
                            || lowered.contains("status check failed"))
                }),
            _ => false,
        }
    }

    fn build_send_prompt_body(request: CopilotSendPromptRequest<'_>) -> Value {
        let mut body = json!({
            "messages": [
                { "role": "system", "content": request.system_prompt },
                { "role": "user", "content": request.user_prompt }
            ],
            "relay_session_id": request.relay_session_id,
            "relay_request_id": request.relay_request_id,
            "relay_request_chain": request.relay_request_chain,
            "relay_request_attempt": request.relay_request_attempt,
            "relay_stage_label": request.relay_stage_label,
            "relay_probe_mode": request.relay_probe_mode,
            "relay_force_fresh_chat": request.relay_force_fresh_chat,
        });
        if !request.attachment_paths.is_empty() {
            body["relay_attachments"] = json!(request.attachment_paths);
        }
        if request.new_chat {
            body["relay_new_chat"] = json!(true);
        }
        body
    }

    fn build_abort_prompt_body(relay_session_id: &str, relay_request_id: &str) -> Value {
        json!({
            "relay_session_id": relay_session_id,
            "relay_request_id": relay_request_id,
        })
    }

    fn record_send_prompt_error(&mut self, error: &CopilotError) {
        match error {
            CopilotError::PromptError(prompt_error) => {
                if let CopilotPromptFailure::Bridge(failure) = prompt_error.as_ref() {
                    self.set_last_bridge_failure(Some(failure.clone()));
                    warn!(
                        "[copilot] structured bridge failure: {}",
                        format_bridge_failure(failure)
                    );
                }
            }
            CopilotError::BridgeBug(failure) => {
                self.set_last_bridge_failure(Some((**failure).clone()));
                warn!(
                    "[copilot] structured bridge failure: {}",
                    format_bridge_failure(failure)
                );
            }
            CopilotError::Http(_)
            | CopilotError::StartupTimeout
            | CopilotError::ProcessExited(_)
            | CopilotError::Spawn(_) => {}
        }
    }

    async fn parse_send_prompt_error(
        &mut self,
        status: reqwest::StatusCode,
        response: reqwest::Response,
        started_at: Instant,
    ) -> Result<String, CopilotError> {
        let body = response.text().await.unwrap_or_default();
        warn!(
            "[copilot] error body ({} bytes) after {:?}",
            body.len(),
            started_at.elapsed()
        );
        if body.contains("relay_copilot_aborted") {
            self.set_last_bridge_failure(None);
            return Err(CopilotError::PromptError(Box::new(
                CopilotPromptFailure::Message("relay_copilot_aborted".into()),
            )));
        }
        let error = parse_prompt_error_body(status, &body);
        self.record_send_prompt_error(&error);
        Err(error)
    }

    async fn send_prompt_once(
        &mut self,
        request: CopilotSendPromptRequest<'_>,
    ) -> Result<String, CopilotError> {
        let url = format!("{}/v1/chat/completions", self.server_url());
        info!(
            "[copilot] POST {} (timeout {}s, user_prompt_chars={}, system_chars={}, attachments={}, relay_new_chat={}, relay_force_fresh_chat={}, stage_label={}, request_chain={}, request_attempt={}, probe_mode={})",
            url,
            request.timeout_secs,
            request.user_prompt.len(),
            request.system_prompt.len(),
            request.attachment_paths.len(),
            request.new_chat,
            request.relay_force_fresh_chat,
            request.relay_stage_label,
            request.relay_request_chain,
            request.relay_request_attempt,
            request.relay_probe_mode
        );
        let t0 = Instant::now();
        let body = Self::build_send_prompt_body(request);
        let mut http_request = self
            .client
            .post(url)
            .json(&body)
            .timeout(Duration::from_secs(request.timeout_secs));
        if let Some(token) = &self.boot_token {
            http_request = http_request.header("X-Relay-Boot-Token", token);
        }
        let response = http_request.send().await.map_err(|e| {
            warn!("[copilot] POST failed after {:?}: {}", t0.elapsed(), e);
            CopilotError::Http(e)
        })?;

        let status = response.status();
        info!(
            "[copilot] HTTP status {} after {:?} (before body read)",
            status,
            t0.elapsed()
        );

        if !response.status().is_success() {
            return self.parse_send_prompt_error(status, response, t0).await;
        }

        let body: serde_json::Value = response.json().await.map_err(CopilotError::Http)?;
        self.set_last_bridge_failure(None);

        let content = body
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string();

        info!(
            "[copilot] completion OK content_len={} total_elapsed={:?}",
            content.len(),
            t0.elapsed()
        );

        Ok(content)
    }

    async fn abort_prompt_request(
        &self,
        relay_session_id: &str,
        relay_request_id: &str,
    ) -> Result<bool, CopilotError> {
        let url = format!("{}/v1/chat/abort", self.server_url());
        let mut http_request = self
            .client
            .post(url)
            .json(&Self::build_abort_prompt_body(
                relay_session_id,
                relay_request_id,
            ))
            .timeout(Duration::from_secs(ABORT_REQUEST_TIMEOUT_SECS));
        if let Some(token) = &self.boot_token {
            http_request = http_request.header("X-Relay-Boot-Token", token);
        }
        let response = http_request.send().await.map_err(CopilotError::Http)?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(parse_prompt_error_body(status, &body));
        }
        let body = response.json::<Value>().await.map_err(CopilotError::Http)?;
        Ok(body
            .get("aborted")
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    async fn abort_prompt_request_best_effort(
        &self,
        relay_session_id: &str,
        relay_request_id: &str,
        reason: &str,
    ) {
        match self
            .abort_prompt_request(relay_session_id, relay_request_id)
            .await
        {
            Ok(aborted) => info!(
                "[copilot] best-effort abort before replay reason={} relay_session_id={} relay_request_id={} aborted={}",
                reason, relay_session_id, relay_request_id, aborted
            ),
            Err(error) => warn!(
                "[copilot] best-effort abort failed before replay reason={} relay_session_id={} relay_request_id={} error={}",
                reason, relay_session_id, relay_request_id, error
            ),
        }
    }

    async fn rejoin_prompt_after_timeout(
        &mut self,
        request: CopilotSendPromptRequest<'_>,
    ) -> Result<String, CopilotError> {
        warn!(
            "[copilot] chat/completions timed out; attempting same-request rejoin on the existing bridge for up to {}s (relay_request_id={}, request_chain={})",
            COMPLETION_REJOIN_TIMEOUT_SECS,
            request.relay_request_id,
            request.relay_request_chain
        );
        self.send_prompt_once(CopilotSendPromptRequest {
            timeout_secs: COMPLETION_REJOIN_TIMEOUT_SECS,
            ..request
        })
        .await
    }

    async fn restart_bridge_and_retry_prompt(
        &mut self,
        request: CopilotSendPromptRequest<'_>,
        reason: &str,
    ) -> Result<String, CopilotError> {
        warn!("[copilot] {reason}; restarting Node bridge and retrying once");
        self.abort_prompt_request_best_effort(
            request.relay_session_id,
            request.relay_request_id,
            reason,
        )
        .await;
        self.start().await?;
        self.send_prompt_once(request).await
    }

    /// POST to the Node bridge; on connect/timeout failure, restart `copilot_server.js` once and retry.
    ///
    /// `new_chat`: when `true`, Node may click Copilot "new chat" before pasting (see `relay_new_chat` in `copilot_server.js`). Default agent path uses `false` so turns append to the current Copilot thread.
    pub async fn send_prompt(
        &mut self,
        request: CopilotSendPromptRequest<'_>,
    ) -> Result<String, CopilotError> {
        match self.send_prompt_once(request).await {
            Ok(t) => Ok(t),
            Err(e) if Self::http_error_is_timeout(&e) => {
                match self.rejoin_prompt_after_timeout(request).await {
                    Ok(text) => Ok(text),
                    Err(rejoin_error) if Self::is_aborted_error(&rejoin_error) => Err(rejoin_error),
                    Err(rejoin_error) if Self::boot_token_error_recoverable(&rejoin_error) => {
                        self.restart_bridge_and_retry_prompt(
                            request,
                            &format!(
                                "same-request rejoin after timeout hit probable stale boot token ({rejoin_error})"
                            ),
                        )
                        .await
                    }
                    Err(rejoin_error) => {
                        self.restart_bridge_and_retry_prompt(
                            request,
                            &format!("same-request rejoin after timeout failed ({rejoin_error})"),
                        )
                        .await
                    }
                }
            }
            Err(e) if Self::http_error_is_connect(&e) => {
                self.restart_bridge_and_retry_prompt(
                    request,
                    &format!("chat/completions connect failed ({e})"),
                )
                .await
            }
            Err(e) if Self::boot_token_error_recoverable(&e) => {
                self.restart_bridge_and_retry_prompt(
                    request,
                    &format!("chat/completions failed with probable stale boot token ({e})"),
                )
                .await
            }
            Err(e) => Err(e),
        }
    }

    async fn wait_for_ready(&self, timeout_secs: u64) -> Result<(), CopilotError> {
        let deadline = Instant::now() + Duration::from_secs(timeout_secs);

        loop {
            if Instant::now() > deadline {
                return Err(CopilotError::StartupTimeout);
            }

            if let Some(arc_child) = &self.process {
                if let Ok(mut child) = arc_child.lock() {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Err(CopilotError::ProcessExited(status.code()));
                    }
                }
            }

            if self.health_check().await.is_ok() {
                return Ok(());
            }

            sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
        }
    }

    fn process_running(&self) -> bool {
        if let Some(arc_child) = &self.process {
            match arc_child.lock() {
                Ok(mut child) => match child.try_wait() {
                    Ok(None) => true,
                    Ok(_) | Err(_) => false,
                },
                Err(_) => true,
            }
        } else {
            false
        }
    }

    pub fn server_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn progress_probe(&self) -> CopilotProgressProbe {
        CopilotProgressProbe {
            server_url: self.server_url(),
            boot_token: self.boot_token.clone(),
            client: self.client.clone(),
        }
    }
}

/// Dedicated Edge profile for CDP auto-launch (same path as `cdp_copilot::relay_agent_edge_profile_dir`).
/// Without this, spawning `msedge.exe` while a normal Edge is running often hands off to the
/// existing singleton process, so `--remote-debugging-port` never binds and CDP probes time out.
pub fn default_edge_profile_dir() -> PathBuf {
    crate::cdp_copilot::relay_agent_edge_profile_dir()
}

fn resolve_script_path() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = [
        // Dev mode: CARGO_MANIFEST_DIR/binaries/
        option_env!("CARGO_MANIFEST_DIR")
            .map(|d| PathBuf::from(d).join("binaries/copilot_server.js")),
        // Next to the binary
        env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("binaries/copilot_server.js"))),
        // Resource dir (Tauri bundles)
        option_env!("CARGO_MANIFEST_DIR")
            .map(|d| PathBuf::from(d).join("../../../src-tauri/binaries/copilot_server.js")),
    ]
    .into_iter()
    .flatten()
    .collect();

    candidates.into_iter().find(|p| p.exists()).or_else(|| {
        // Try the same directory as Cargo.toml
        option_env!("CARGO_MANIFEST_DIR")
            .map(|d| PathBuf::from(d).join("binaries/copilot_server.js"))
            .filter(|p| p.exists())
    })
}

fn find_node() -> Option<String> {
    for name in &["node", "node.exe"] {
        if Command::new(name)
            .arg("--version")
            .output()
            .is_ok_and(|o| o.status.success())
        {
            return Some(name.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        parse_prompt_error_body, validate_health_body, CopilotError, CopilotPromptFailure,
        CopilotSendPromptRequest, CopilotServer, HealthBody, RELAY_COPILOT_SERVICE_NAME,
    };
    use reqwest::StatusCode;

    #[test]
    fn health_body_requires_service_and_matching_instance_id() {
        let ok = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_COPILOT_SERVICE_NAME.into()),
            instance_id: Some("instance-123".into()),
        };
        assert!(validate_health_body(Some("instance-123"), &ok).is_ok());

        let wrong_service = HealthBody {
            status: "ok".into(),
            service: Some("other_service".into()),
            instance_id: Some("instance-123".into()),
        };
        assert!(validate_health_body(Some("instance-123"), &wrong_service).is_err());

        let wrong_instance = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_COPILOT_SERVICE_NAME.into()),
            instance_id: Some("other-instance".into()),
        };
        assert!(validate_health_body(Some("instance-123"), &wrong_instance).is_err());
    }

    #[test]
    fn parse_prompt_error_body_preserves_bridge_failure_metadata() {
        let body = serde_json::json!({
            "error": "dom response timed out",
            "failureClass": "dom_response_timeout",
            "stageLabel": "repair1",
            "requestChain": "live-repair-repair1-123",
            "requestAttempt": 2,
            "transportAttempt": 1,
            "repairReplayAttempt": 1,
            "wantNewChat": true,
            "newChatReady": true,
            "pasteDone": true,
            "submitObserved": true,
            "networkSeedSeen": false,
            "domWaitStarted": true,
            "domWaitFinished": false,
            "totalElapsedMs": 8123
        })
        .to_string();
        let error = parse_prompt_error_body(StatusCode::INTERNAL_SERVER_ERROR, &body);
        let CopilotError::PromptError(prompt_error) = error else {
            panic!("expected structured bridge failure");
        };
        let CopilotPromptFailure::Bridge(failure) = prompt_error.as_ref() else {
            panic!("expected structured bridge failure");
        };
        assert_eq!(
            failure.failure_class.as_deref(),
            Some("dom_response_timeout")
        );
        assert_eq!(failure.stage_label.as_deref(), Some("repair1"));
        assert_eq!(
            failure.request_chain.as_deref(),
            Some("live-repair-repair1-123")
        );
        assert_eq!(failure.repair_replay_attempt, Some(1));
        assert_eq!(failure.paste_done, Some(true));
        assert_eq!(failure.dom_wait_finished, Some(false));
        assert_eq!(failure.total_elapsed_ms, Some(8123));
        assert_eq!(failure.message.as_deref(), Some("dom response timed out"));
    }

    #[test]
    fn parse_prompt_error_body_treats_unclassified_bridge_failure_as_bug() {
        let body = serde_json::json!({
            "error": "bridge timeout",
            "stageLabel": "repair2",
            "requestChain": "live-repair-repair2-123",
            "submitObserved": true
        })
        .to_string();
        let error = parse_prompt_error_body(StatusCode::INTERNAL_SERVER_ERROR, &body);
        let CopilotError::BridgeBug(failure) = error else {
            panic!("expected unclassified bridge failure to be surfaced as bridge bug");
        };
        assert_eq!(failure.stage_label.as_deref(), Some("repair2"));
        assert_eq!(failure.submit_observed, Some(true));
        assert_eq!(failure.failure_class, None);
    }

    #[test]
    fn build_send_prompt_body_includes_force_fresh_chat_flag() {
        let body = CopilotServer::build_send_prompt_body(CopilotSendPromptRequest {
            relay_session_id: "session-1",
            relay_request_id: "request-1",
            relay_request_chain: "chain-1",
            relay_request_attempt: 1,
            relay_stage_label: "repair1",
            relay_probe_mode: false,
            relay_force_fresh_chat: true,
            system_prompt: "",
            user_prompt: "Tool protocol repair.",
            timeout_secs: 30,
            attachment_paths: &[],
            new_chat: false,
        });
        assert_eq!(body["relay_force_fresh_chat"], serde_json::json!(true));
        assert_eq!(body["relay_stage_label"], serde_json::json!("repair1"));
    }

    #[test]
    fn build_abort_prompt_body_targets_specific_request() {
        let body = CopilotServer::build_abort_prompt_body("session-1", "request-1");
        assert_eq!(body["relay_session_id"], serde_json::json!("session-1"));
        assert_eq!(body["relay_request_id"], serde_json::json!("request-1"));
    }
}
