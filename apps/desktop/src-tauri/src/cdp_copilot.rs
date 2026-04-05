#![allow(
    clippy::result_large_err,
    clippy::items_after_statements,
    clippy::too_many_lines
)]

//! CDP-driven M365 Copilot client.
//!
//! Automatically launches a dedicated Edge instance on a free port,
//! keeping it separate from the user's personal browser.
//!
//! ## Architecture
//!
//! `CopilotPage` wraps a CDP WebSocket connection to a specific browser tab.
//! The connection is established on first use via `Ctx` (one-shot pattern:
//! connect → send command → receive response → close). This avoids holding
//! long-running WebSocket connections while keeping the debug URL stable.
//!
//! The client supports:
//! - Auto-detection of existing browsers via `/json/list`
//! - Dedicated Edge launch with isolated profile
//! - Robust prompt-sending with multi-selector fallback (i18n-aware send button detection)
//! - Response completion detection via streaming-indicator + content-stability polling

use anyhow::{bail, Context, Result};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use tracing::{debug, info, warn};
use tungstenite::Message;

/* ── Port scanning ──────────────────────────────────────────── */

/// Find a free TCP port starting from `base_port`.
pub fn find_free_port(base_port: u16, max_attempts: u16) -> u16 {
    for i in 0..max_attempts {
        let port = base_port + i;
        if port_is_free(port) {
            return port;
        }
    }
    // Last resort: use the last attempted port
    base_port + max_attempts - 1
}

fn port_is_free(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_err()
}

/* ── Edge auto-launch ────────────────────────────────────────── */

/// Launch a dedicated Edge instance for CDP control.
/// Uses a separate user-data-dir so it doesn't conflict with
/// the user's personal browser.
pub fn launch_dedicated_edge(port: u16) -> Result<std::process::Child> {
    let edge_path = find_edge_path()?;

    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                PathBuf::from(r"C:\Users\Default\AppData\Local")
            } else {
                PathBuf::from("/tmp")
            }
        });

    let profile_dir = home.join("RelayAgentEdgeProfile");
    std::fs::create_dir_all(&profile_dir).ok();

    info!(
        "[CDP] Launching Edge on port {} with profile: {:?}",
        port, profile_dir
    );

    let mut cmd = std::process::Command::new(&edge_path);
    cmd.args([
        "--remote-debugging-port",
        &port.to_string(),
        "--user-data-dir",
        profile_dir.to_str().unwrap(),
        "--no-first-run",
        "--no-default-browser-check",
        "--no-startup-window",
        "--disable-infobars",
        "--disable-hang-monitor",
        "--window-size=1440,900",
        "https://m365.cloud.microsoft/chat",
    ]);

    let child = cmd
        .spawn()
        .with_context(|| format!("failed to spawn Edge at {edge_path}"))?;

    info!("[CDP] Edge process spawned (PID: {})", child.id());
    Ok(child)
}

fn find_edge_path() -> Result<String> {
    if cfg!(windows) {
        let candidates = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                return Ok(path.to_string());
            }
        }
        bail!("Microsoft Edge not found in standard Windows locations");
    } else if cfg!(target_os = "macos") {
        let path = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
        if std::path::Path::new(path).exists() {
            Ok(path.to_string())
        } else {
            bail!("Microsoft Edge not found on macOS");
        }
    } else {
        // Linux: try PATH
        for candidate in ["microsoft-edge-stable", "microsoft-edge", "microsoft-edge-dev"] {
            if let Ok(output) = std::process::Command::new("which").arg(candidate).output() {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }
            }
        }
        bail!("Microsoft Edge not found on Linux (tried microsoft-edge-stable, microsoft-edge, microsoft-edge-dev)");
    }
}

/// Wait for the CDP endpoint to become available (browser is ready).
pub async fn wait_for_cdp_ready(debug_url: &str, max_wait_secs: u64) -> Result<()> {
    let start = std::time::Instant::now();
    let interval = Duration::from_millis(500);
    let mut attempts = 0u64;

    loop {
        if start.elapsed() > Duration::from_secs(max_wait_secs) {
            bail!(
                "Edge did not become ready within {max_wait_secs}s ({attempts} attempts)"
            );
        }
        attempts += 1;

        match reqwest::get(&format!("{debug_url}/json/version")).await {
            Ok(resp) if resp.status().is_success() => {
                info!(
                    "[CDP] Edge ready on {} (after {} attempts)",
                    debug_url, attempts
                );
                return Ok(());
            }
            Ok(_) => debug!("[CDP] connect attempt {} returned {}", attempts, resp.status()),
            Err(e) => debug!("[CDP] connect attempt {} failed: {}", attempts, e),
        }

        tokio::time::sleep(interval).await;
    }
}

/* ── Config ─────────────────────────────────────────────────── */

#[derive(Clone, Debug)]
pub struct CdpConfig {
    pub debug_url: String,
    pub copilot_url: String,
    pub auto_launch: bool,
    pub base_port: u16,
}

impl Default for CdpConfig {
    fn default() -> Self {
        Self {
            debug_url: "http://127.0.0.1:9222".into(),
            copilot_url: "https://m365.cloud.microsoft/chat".into(),
            auto_launch: false,
            base_port: 9222,
        }
    }
}

/* ── Page info ──────────────────────────────────────────────── */

#[derive(Debug, Clone)]
pub struct PageInfo {
    pub kind: String,
    pub url: String,
    pub title: String,
    pub ws_url: String,
}

pub async fn list_pages(debug_url: &str) -> Result<Vec<PageInfo>> {
    let resp = reqwest::get(&format!("{debug_url}/json/list"))
        .await
        .context("fetch /json/list")?;
    let items: Vec<Value> = resp.json().await.context("/json/list JSON")?;
    Ok(items
        .into_iter()
        .filter_map(|v| {
            Some(PageInfo {
                kind: v.get("type")?.as_str()?.into(),
                url: v.get("url")?.as_str()?.into(),
                title: v.get("title")?.as_str()?.into(),
                ws_url: v.get("webSocketDebuggerUrl")?.as_str()?.into(),
            })
        })
        .collect())
}

/// Copilot page URL patterns checked in order.
const COPILOT_URL_PATTERNS: &[&str] = &[
    "m365.cloud.microsoft",
    "copilot.microsoft.com",
    "copilot.cloud.microsoft",
    "m365.microsoft.com/chat",
];

pub async fn find_copilot_page(debug_url: &str) -> Result<Option<PageInfo>> {
    for p in list_pages(debug_url).await? {
        if p.kind == "page" && COPILOT_URL_PATTERNS.iter().any(|pat| p.url.contains(pat)) {
            return Ok(Some(p));
        }
    }
    Ok(None)
}

/* ── One-shot CDP helpers ───────────────────────────────────── */

struct Ctx {
    next: AtomicU64,
    ws_url: String,
}

impl Ctx {
    fn new(ws_url: String) -> Self {
        Self {
            next: AtomicU64::new(1),
            ws_url,
        }
    }

    /// Open a WebSocket, send one CDP command, wait for response, close.
    ///
    /// Uses a dedicated reader task with a proper error branch so that
    /// WS errors are logged instead of silently swallowed.
    #[allow(clippy::result_large_err, clippy::items_after_statements)]
    async fn one_shot(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let cmd = json!({ "id": id, "method": method, "params": params });

        let (ws, _) = tokio_tungstenite::connect_async(&self.ws_url)
            .await
            .with_context(|| format!("connect {}", self.ws_url))?;

        let (mut write, mut read) = ws.split();
        let (tx, rx) = oneshot::channel::<Value>();

        // reader — drains the WS until the matching response is found
        let reader_handle = tokio::spawn(async move {
            loop {
                match read.next().await {
                    Some(Ok(msg)) => {
                        if let Ok(txt) = msg.to_text() {
                            if let Ok(v) = serde_json::from_str::<Value>(txt) {
                                if v.get("id").and_then(serde_json::Value::as_u64) == Some(id) {
                                    tx.send(v).ok();
                                    return;
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        debug!("[CDP] one_shot reader error: {e}");
                        return;
                    }
                    None => return,
                }
            }
        });

        write
            .send(Message::Text(cmd.to_string()))
            .await
            .context("send CDP cmd")?;

        let resp = timeout(Duration::from_secs(10), rx)
            .await
            .context("CDP timeout")?
            .context("response lost")?;

        // close the writer side to signal the remote, then wait for the reader
        let _ = write.close().await;
        let _ = reader_handle.await;

        if let Some(err) = resp.get("error") {
            bail!("CDP {method}: {err}");
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn eval(&self, expr: &str) -> Result<Value> {
        self.one_shot(
            "Runtime.evaluate",
            json!({ "expression": expr, "returnByValue": true }),
        )
        .await
    }
}

/* ── Copilot Page Handle ────────────────────────────────────── */

#[derive(Clone)]
pub struct CopilotPage {
    debug_url: String,
    ws_url: String,
    pub url: String,
    pub title: String,
}

impl CopilotPage {
    async fn ctx(&self) -> Result<Ctx> {
        let ws = resolve_ws(&self.debug_url, &self.ws_url).await?;
        Ok(Ctx::new(ws))
    }

    pub async fn body_text(&self) -> Result<String> {
        let ctx = self.ctx().await?;
        let r = ctx.eval("document.body.innerText").await?;
        Ok(r["result"]["value"].as_str().unwrap_or_default().into())
    }

    pub async fn navigate_to_chat(&self) -> Result<()> {
        info!("[CDP] navigate to /chat");
        let ctx = self.ctx().await?;
        ctx.one_shot(
            "Page.navigate",
            json!({ "url": "https://m365.cloud.microsoft/chat" }),
        )
        .await?;
        ctx.one_shot("Page.enable", json!({})).await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        Ok(())
    }

    /// Send a prompt to the Copilot composer and click send.
    /// Uses multi-selector fallback for the composer and send button
    /// to handle UI changes and i18n (Japanese/English).
    pub async fn send_prompt(&self, text: &str) -> Result<()> {
        let preview = text.chars().take(60).collect::<String>();
        info!("[CDP] send: {preview}…");
        let ctx = self.ctx().await?;

        // 1. Type into composer — try multiple selectors
        let js = format!(
            r#"(() => {{
                for (const s of [
                    'div[role="textbox"]',
                    'textarea',
                    '[contenteditable="true"]',
                    '#m365-chat-editor-target-element',
                    'div[role="combobox"]'
                ]) {{
                    const el = document.querySelector(s);
                    if (el && el.offsetParent !== null) {{
                        el.focus();
                        el.innerText = {};
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        return true;
                    }}
                }}
                return false;
            }})()"#,
            serde_json::to_string(text)?
        );
        let r = ctx.eval(&js).await?;
        if r["result"]["value"].as_bool() != Some(true) {
            bail!("composer not found — Copilot page may not be ready");
        }

        tokio::time::sleep(Duration::from_millis(800)).await;

        // 2. Click send — i18n-aware multi-selector fallback
        let ctx2 = self.ctx().await?;
        let js2 = r#"(() => {
            for (const s of [
                // Japanese
                'button[aria-label="送信"]',
                'button[aria-label*="送信"]',
                // English
                'button[aria-label="Send"]',
                'button[aria-label="Reply"]',
                'button[aria-label*="Send"]',
                // Generic
                'button[data-testid="sendButton"]',
                'button[type="submit"]',
                // Icon button patterns
                'button:has(svg[iconName="Send"])',
                '[data-icon-name="Send"]'
            ]) {
                const b = document.querySelector(s);
                if (b && b.offsetParent !== null) {
                    b.click();
                    return JSON.stringify({ ok: true });
                }
            }
            return JSON.stringify({ ok: false });
        })()"#;
        let r2 = ctx2.eval(js2).await?;
        let val: Value = serde_json::from_str(r2["result"]["value"].as_str().unwrap_or("{}"))
            .unwrap_or(Value::Null);
        if val.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
            bail!("send button not found — page may not be interactive");
        }

        // 3. Wait for composer to clear (confirms prompt was dispatched)
        tokio::time::sleep(Duration::from_millis(500)).await;
        timeout(Duration::from_secs(5), async {
            loop {
                let ctx3 = self.ctx().await.ok();
                if let Some(ctx_ref) = ctx3 {
                    if let Ok(r) = ctx_ref
                        .eval(
                            r#"(() => {
                            for (const el of document.querySelectorAll(
                                'div[role="textbox"],textarea,[contenteditable="true"],#m365-chat-editor-target-element'
                            )) {
                                if ((el.innerText||'').trim().length > 5) return false;
                            }
                            return true;
                        })()"#,
                        )
                        .await
                    {
                        if r["result"]["value"].as_bool() == Some(true) {
                            return Ok::<(), anyhow::Error>(());
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await
        .context("composer didn't clear after send")??;

        info!("[CDP] prompt sent ✓");
        Ok(())
    }

    /// Check if Copilot is currently generating a response.
    pub async fn is_streaming(&self) -> Result<bool> {
        let ctx = self.ctx().await?;
        let r = ctx
            .eval(
                r#"(() => {
                for (const s of [
                    'button[aria-label*="生成を停止"]',
                    'button[aria-label*="Stop generating"]',
                    'button[aria-label*="Stop response"]',
                    'button[data-testid="stopGeneratingButton"]'
                ]) {
                    for (const el of document.querySelectorAll(s)) {
                        if (el.offsetParent !== null) return true;
                    }
                }
                return false;
            })()"#,
            )
            .await?;
        Ok(r["result"]["value"].as_bool().unwrap_or(false))
    }

    /// Wait for Copilot to finish generating a response.
    /// Uses streaming detection + content stability polling.
    pub async fn wait_for_response(&self, timeout_secs: u64) -> Result<String> {
        const MAX_CONSECUTIVE_ERRORS: usize = 5;
        let start = std::time::Instant::now();
        let mut prev = 0;
        let mut stable = 0;
        let mut streaming = false;
        let mut consecutive_errors = 0;

        loop {
            if start.elapsed() > Duration::from_secs(timeout_secs) {
                bail!("response timeout after {timeout_secs}s");
            }

            let txt = match self.body_text().await {
                Ok(text) => {
                    consecutive_errors = 0;
                    text
                }
                Err(e) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        bail!(
                            "body_text failed {MAX_CONSECUTIVE_ERRORS} times in a row: {e}"
                        );
                    }
                    debug!("[CDP] body_text error (attempt {consecutive_errors}): {e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            let len = txt.len();

            let is_streaming = self.is_streaming().await.unwrap_or(false);

            if is_streaming {
                streaming = true;
                stable = 0;
            } else if streaming && len > 200 {
                if len == prev {
                    stable += 1;
                    if stable >= 2 {
                        info!("[CDP] response done ({} chars)", len);
                        return Ok(txt);
                    }
                } else {
                    stable = 0;
                }
            } else if len > prev + 30 {
                stable = 0;
            }

            prev = len;
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    /// Capture a screenshot of the current page.
    pub async fn screenshot(&self, path: &str) -> Result<()> {
        let ctx = self.ctx().await?;
        let r = ctx
            .one_shot("Page.captureScreenshot", json!({ "format": "png" }))
            .await?;
        let b64 = r["data"].as_str().context("no screenshot data in CDP response")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .context("base64 decode failed")?;
        std::fs::write(path, bytes)?;
        info!("[CDP] screenshot → {}", path);
        Ok(())
    }
}

/* ── Public API ─────────────────────────────────────────────── */

/// Result of the connection attempt.
pub struct ConnectionResult {
    pub page: CopilotPage,
    pub port: u16,
    pub launched: bool,
    edge_process: Option<Child>,
}

impl ConnectionResult {
    /// Quit the Edge process if it was launched by this connection.
    /// Safe to call multiple times; subsequent calls are no-ops.
    pub fn quit_edge(&mut self) {
        if let Some(mut child) = self.edge_process.take() {
            info!("[CDP] Quitting Edge process (PID: {})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for ConnectionResult {
    fn drop(&mut self) {
        if self.edge_process.is_some() {
            info!(
                "[CDP] ConnectionResult dropped with running Edge process (PID: {}) — call quit_edge() to clean up explicitly",
                self.edge_process
                    .as_ref()
                    .map_or(0, Child::id)
            );
        }
    }
}

/// Disconnect from a Copilot page and clean up the browser if it was auto-launched.
///
/// Takes ownership of the `ConnectionResult`, calls `quit_edge()` to gracefully
/// shut down the browser process, and drops the WebSocket connection.
/// Safe to call even if no Edge process was launched (`launched == false`).
pub async fn disconnect_copilot_page(result: ConnectionResult) -> Result<(), anyhow::Error> {
    let debug_url = result.page.debug_url.clone();
    let mut result = result;
    result.quit_edge();
    info!("[CDP] Disconnected from {:?}", debug_url);
    Ok(())
}

/// Connect to a Copilot page, auto-launching Edge if needed.
pub async fn connect_copilot_page(
    debug_url: &str,
    auto_launch: bool,
    base_port: u16,
) -> Result<ConnectionResult> {
    // Try existing browser first
    if let Some(p) = try_existing(debug_url).await {
        return p;
    }

    if !auto_launch {
        bail!(
            "No Copilot browser found at {debug_url}. \
             Enable auto_launch or start Edge with --remote-debugging-port."
        );
    }

    // Find a free port and launch Edge
    let port = find_free_port(base_port, 20);
    let debug_url_new = format!("http://127.0.0.1:{port}");

    info!(
        "[CDP] No existing browser found. Launching dedicated Edge on port {}...",
        port
    );

    let child = launch_dedicated_edge(port)?;
    wait_for_cdp_ready(&debug_url_new, 30).await?;

    // Find or create the Copilot page
    if let Some(mut p) = try_existing(&debug_url_new).await {
        if let Ok(ref mut result) = p {
            result.edge_process = Some(child);
            result.launched = true;
        }
        return p;
    }

    // Fallback: use any available page
    let pages = list_pages(&debug_url_new).await?;
    let first = pages
        .iter()
        .find(|p| p.kind == "page")
        .context("no page found after Edge launch")?;
    Ok(ConnectionResult {
        page: CopilotPage {
            debug_url: debug_url_new,
            ws_url: first.ws_url.clone(),
            url: first.url.clone(),
            title: first.title.clone(),
        },
        port,
        launched: true,
        edge_process: Some(child),
    })
}

/// Try to find an existing Copilot page at the given debug URL.
/// Returns `Some(Ok(...))` if a page was found, `Some(Err(...))` on network error,
/// or `None` if the browser is unreachable.
async fn try_existing(debug_url: &str) -> Option<Result<ConnectionResult>> {
    if let Ok(Some(p)) = find_copilot_page(debug_url).await {
        info!("[CDP] using existing copilot tab: {}", p.url);
        return Some(Ok(ConnectionResult {
            page: CopilotPage {
                debug_url: debug_url.into(),
                ws_url: p.ws_url,
                url: p.url,
                title: p.title,
            },
            port: parse_port(debug_url).unwrap_or(9222),
            launched: false,
            edge_process: None,
        }));
    }

    // Check if the browser is reachable at all
    if reqwest::get(&format!("{debug_url}/json/version"))
        .await
        .is_ok()
    {
        // Browser is up but no Copilot page — use any page
        if let Ok(pages) = list_pages(debug_url).await {
            if let Some(first) = pages.iter().find(|p| p.kind == "page") {
                warn!("[CDP] No Copilot page found, falling back to tab: {}", first.url);
                return Some(Ok(ConnectionResult {
                    page: CopilotPage {
                        debug_url: debug_url.into(),
                        ws_url: first.ws_url.clone(),
                        url: first.url.clone(),
                        title: first.title.clone(),
                    },
                    port: parse_port(debug_url).unwrap_or(9222),
                    launched: false,
                    edge_process: None,
                }));
            }
        }
    }

    None
}

fn parse_port(debug_url: &str) -> Option<u16> {
    debug_url
        .split(':')
        .next_back()
        .and_then(|s| s.parse().ok())
}

/// Resolve the actual WebSocket URL for CDP communication.
/// Handles localhost ↔ 127.0.0.1 normalization.
async fn resolve_ws(debug: &str, ws: &str) -> Result<String> {
    // If the WS URL already uses a routable host, use it as-is
    if ws.starts_with("ws://")
        && !ws.contains("localhost")
        && !ws.contains("127.0.0.1")
    {
        return Ok(ws.into());
    }
    let r = reqwest::get(&format!("{debug}/json/version"))
        .await
        .context("/json/version")?;
    let v: Value = r.json().await.context("/json/version JSON")?;
    let url = v["webSocketDebuggerUrl"]
        .as_str()
        .context("missing webSocketDebuggerUrl")?
        .to_string();
    let host = debug
        .strip_prefix("http://")
        .or_else(|| debug.strip_prefix("https://"))
        .unwrap_or(debug);
    // Normalize both localhost and 127.0.0.1 to the debug URL's host
    let url = url.replace("ws://localhost/", &format!("ws://{host}/"));
    Ok(url.replace("ws://127.0.0.1/", &format!("ws://{host}/")))
}
