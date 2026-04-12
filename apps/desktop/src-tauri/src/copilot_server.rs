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
use serde_json::json;
use tokio::time::sleep;
use tracing::{info, warn};
use uuid::Uuid;

const READY_TIMEOUT_SECS: u64 = 30;
const HEALTH_POLL_INTERVAL_MS: u64 = 500;
/// `GET /status` drives Edge launch + navigation; allow longer than default HTTP client timeout.
const WARMUP_STATUS_TIMEOUT_SECS: u64 = 120;
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
    PromptError(String),
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
            CopilotError::PromptError(msg) => write!(f, "prompt error: {msg}"),
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
            log_threads: Vec::new(),
        })
    }

    pub fn cdp_port(&self) -> u16 {
        self.cdp_port
    }

    pub fn boot_token(&self) -> Option<&str> {
        self.boot_token.as_deref()
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

        Err(CopilotError::PromptError(format!(
            "copilot_server could not bind on ports {}–{}; stop orphan node.exe processes or free a port",
            preferred_port,
            preferred_port.saturating_add(COPILOT_HTTP_PORT_FALLBACKS - 1)
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
            return Err(CopilotError::PromptError(format!(
                "health check failed: status {}",
                response.status()
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
            return Err(CopilotError::PromptError(message));
        }

        Ok(())
    }

    pub async fn status(&self) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout(30).await
    }

    /// Same as [`Self::status`] but with an explicit per-request timeout (warmup / Edge cold start).
    pub async fn status_with_timeout(
        &self,
        timeout_secs: u64,
    ) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout_detailed(timeout_secs)
            .await
            .map_err(|error| match error {
                CopilotStatusCheckError::Transport(error) => error,
                CopilotStatusCheckError::Http(error) => CopilotError::PromptError(format!(
                    "status check failed: status {}{}",
                    error.status,
                    error
                        .error_code
                        .as_deref()
                        .map(|code| format!(" ({code})"))
                        .unwrap_or_default()
                )),
            })
    }

    pub async fn status_with_timeout_detailed(
        &self,
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
            response
                .json::<CopilotStatusResponse>()
                .await
                .map_err(CopilotError::Http)
                .map_err(CopilotStatusCheckError::Transport)
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
    pub async fn warmup_status(&self) -> Result<CopilotStatusResponse, CopilotError> {
        self.status_with_timeout(WARMUP_STATUS_TIMEOUT_SECS).await
    }

    fn http_error_recoverable(err: &CopilotError) -> bool {
        match err {
            CopilotError::Http(e) => e.is_connect() || e.is_timeout(),
            _ => false,
        }
    }

    fn boot_token_error_recoverable(err: &CopilotError) -> bool {
        match err {
            CopilotError::PromptError(message) => {
                let lowered = message.to_ascii_lowercase();
                lowered.contains("401")
                    && (lowered.contains("unauthorized") || lowered.contains("copilot returned"))
            }
            _ => false,
        }
    }

    async fn send_prompt_once(
        &self,
        relay_session_id: &str,
        relay_request_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        timeout_secs: u64,
        attachment_paths: &[String],
        new_chat: bool,
    ) -> Result<String, CopilotError> {
        let url = format!("{}/v1/chat/completions", self.server_url());
        info!(
            "[copilot] POST {} (timeout {}s, user_prompt_chars={}, system_chars={}, attachments={}, relay_new_chat={})",
            url,
            timeout_secs,
            user_prompt.len(),
            system_prompt.len(),
            attachment_paths.len(),
            new_chat
        );
        let t0 = Instant::now();
        let mut body = json!({
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "relay_session_id": relay_session_id,
            "relay_request_id": relay_request_id,
        });
        if !attachment_paths.is_empty() {
            body["relay_attachments"] = json!(attachment_paths);
        }
        if new_chat {
            body["relay_new_chat"] = json!(true);
        }
        let mut request = self
            .client
            .post(url)
            .json(&body)
            .timeout(Duration::from_secs(timeout_secs));
        if let Some(token) = &self.boot_token {
            request = request.header("X-Relay-Boot-Token", token);
        }
        let response = request.send().await.map_err(|e| {
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
            let body = response.text().await.unwrap_or_default();
            warn!(
                "[copilot] error body ({} bytes) after {:?}",
                body.len(),
                t0.elapsed()
            );
            if body.contains("relay_copilot_aborted") {
                return Err(CopilotError::PromptError("relay_copilot_aborted".into()));
            }
            return Err(CopilotError::PromptError(format!(
                "copilot returned {status}: {body}"
            )));
        }

        let body: serde_json::Value = response.json().await.map_err(CopilotError::Http)?;

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

    /// POST to the Node bridge; on connect/timeout failure, restart `copilot_server.js` once and retry.
    ///
    /// `new_chat`: when `true`, Node may click Copilot "new chat" before pasting (see `relay_new_chat` in `copilot_server.js`). Default agent path uses `false` so turns append to the current Copilot thread.
    pub async fn send_prompt(
        &mut self,
        relay_session_id: &str,
        relay_request_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        timeout_secs: u64,
        attachment_paths: &[String],
        new_chat: bool,
    ) -> Result<String, CopilotError> {
        match self
            .send_prompt_once(
                relay_session_id,
                relay_request_id,
                system_prompt,
                user_prompt,
                timeout_secs,
                attachment_paths,
                new_chat,
            )
            .await
        {
            Ok(t) => Ok(t),
            Err(e) if Self::http_error_recoverable(&e) => {
                warn!(
                    "[copilot] chat/completions failed ({e}); restarting Node bridge and retrying once"
                );
                self.start().await?;
                self.send_prompt_once(
                    relay_session_id,
                    relay_request_id,
                    system_prompt,
                    user_prompt,
                    timeout_secs,
                    attachment_paths,
                    new_chat,
                )
                .await
            }
            Err(e) if Self::boot_token_error_recoverable(&e) => {
                warn!(
                    "[copilot] chat/completions failed with probable stale boot token ({e}); restarting Node bridge and retrying once"
                );
                self.start().await?;
                self.send_prompt_once(
                    relay_session_id,
                    relay_request_id,
                    system_prompt,
                    user_prompt,
                    timeout_secs,
                    attachment_paths,
                    new_chat,
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
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(name.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{validate_health_body, HealthBody, RELAY_COPILOT_SERVICE_NAME};

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
}
