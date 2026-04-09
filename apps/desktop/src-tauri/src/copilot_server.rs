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
use uuid::Uuid;
use tokio::time::sleep;
use tracing::{info, warn};

const READY_TIMEOUT_SECS: u64 = 30;
const HEALTH_POLL_INTERVAL_MS: u64 = 500;
/// `GET /status` drives Edge launch + navigation; allow longer than default HTTP client timeout.
const WARMUP_STATUS_TIMEOUT_SECS: u64 = 120;
/// If `127.0.0.1:18080` is held by a stray `node copilot_server.js` (e.g. after `--keep-app`), try the next ports.
const COPILOT_HTTP_PORT_FALLBACKS: u16 = 32;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    status: String,
    boot_token: Option<String>,
}

pub struct CopilotServer {
    process: Option<Arc<Mutex<Child>>>,
    port: u16,
    cdp_port: u16,
    /// Matches `copilot_server.js` `/health` `bootToken` so we never treat a stale listener on `port` as ready.
    boot_token: Option<String>,
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
            CopilotError::StartupTimeout => write!(f, "copilot server did not become ready within {READY_TIMEOUT_SECS}s"),
            CopilotError::ProcessExited(code) => write!(f, "copilot server exited with code {code:?}"),
            CopilotError::Spawn(e) => write!(f, "failed to spawn copilot server: {e}"),
            CopilotError::PromptError(msg) => write!(f, "prompt error: {msg}"),
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
            self.boot_token = Some(boot_token.clone());

            crate::copilot_port_reclaim::maybe_reclaim_stale_copilot_http_port(
                &self.client,
                self.port,
                &boot_token,
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
        if body.status != "ok" {
            return Err(CopilotError::PromptError(format!(
                "health check failed: body status {:?}",
                body.status
            )));
        }

        if let Some(expected) = &self.boot_token {
            if body.boot_token.as_deref() != Some(expected.as_str()) {
                warn!(
                    "[copilot] /health bootToken mismatch (stale process on port {}?); expected this session's token",
                    self.port
                );
                return Err(CopilotError::PromptError(format!(
                    "stale copilot_server on port {} (bootToken mismatch); stop the orphan node.exe or free the port",
                    self.port
                )));
            }
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
        let response = self
            .client
            .get(format!("{}/status", self.server_url()))
            .timeout(Duration::from_secs(timeout_secs))
            .send()
            .await
            .map_err(CopilotError::Http)?;

        if response.status().is_success() {
            response
                .json::<CopilotStatusResponse>()
                .await
                .map_err(CopilotError::Http)
        } else {
            Err(CopilotError::PromptError(format!(
                "status check failed: status {}",
                response.status()
            )))
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

    async fn send_prompt_once(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        timeout_secs: u64,
        attachment_paths: &[String],
    ) -> Result<String, CopilotError> {
        let url = format!("{}/v1/chat/completions", self.server_url());
        info!(
            "[copilot] POST {} (timeout {}s, user_prompt_chars={}, system_chars={}, attachments={})",
            url,
            timeout_secs,
            user_prompt.len(),
            system_prompt.len(),
            attachment_paths.len()
        );
        let t0 = Instant::now();
        let mut body = json!({
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        });
        if !attachment_paths.is_empty() {
            body["relay_attachments"] = json!(attachment_paths);
        }
        let response = self
            .client
            .post(url)
            .json(&body)
            .timeout(Duration::from_secs(timeout_secs))
            .send()
            .await
            .map_err(|e| {
                warn!(
                    "[copilot] POST failed after {:?}: {}",
                    t0.elapsed(),
                    e
                );
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
            return Err(CopilotError::PromptError(format!(
                "copilot returned {status}: {body}"
            )));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(CopilotError::Http)?;

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
    pub async fn send_prompt(
        &mut self,
        system_prompt: &str,
        user_prompt: &str,
        timeout_secs: u64,
        attachment_paths: &[String],
    ) -> Result<String, CopilotError> {
        match self
            .send_prompt_once(system_prompt, user_prompt, timeout_secs, attachment_paths)
            .await
        {
            Ok(t) => Ok(t),
            Err(e) if Self::http_error_recoverable(&e) => {
                warn!(
                    "[copilot] chat/completions failed ({e}); restarting Node bridge and retrying once"
                );
                self.start().await?;
                self.send_prompt_once(system_prompt, user_prompt, timeout_secs, attachment_paths)
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
        env::current_exe().ok().and_then(|p| {
            p.parent().map(|p| p.join("binaries/copilot_server.js"))
        }),
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
