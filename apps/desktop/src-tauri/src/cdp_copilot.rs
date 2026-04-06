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
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex as AsyncMutex};
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
        .map_or_else(
            || {
                if cfg!(target_os = "windows") {
                    PathBuf::from(r"C:\Users\Default\AppData\Local")
                } else {
                    PathBuf::from("/tmp")
                }
            },
            PathBuf::from,
        );

    let profile_dir = home.join("RelayAgentEdgeProfile");
    std::fs::create_dir_all(&profile_dir).ok();

    info!(
        "[CDP] Launching Edge on port {} with profile: {:?}",
        port, profile_dir
    );

    // Launch Edge with a blank start page. Use flags to avoid VBS/Code
    // Integrity issues (error 577) on Windows corporate environments.
    let mut cmd = std::process::Command::new(&edge_path);
    cmd.args([
        "--remote-debugging-port",
        &port.to_string(),
        &format!("--user-data-dir={}", profile_dir.to_str().unwrap()),
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-hang-monitor",
        "--disable-restore-session-state",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--no-sandbox",
        "--disable-site-isolation-trials",
        "--disable-breakpad",
        "--disable-crashpad",
        "--disable-features=RendererCodeIntegrity,EdgeEnclave,VbsEnclave",
        "about:blank",
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
        for candidate in [
            "microsoft-edge-stable",
            "microsoft-edge",
            "microsoft-edge-dev",
        ] {
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
            bail!("Edge did not become ready within {max_wait_secs}s ({attempts} attempts)");
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
            Ok(r) => debug!("[CDP] connect attempt {} returned {}", attempts, r.status()),
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
            debug_url: "http://127.0.0.1:9333".into(),
            copilot_url: "https://m365.cloud.microsoft/chat".into(),
            auto_launch: false,
            base_port: 9333,
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

/* ── Persistent CDP connection ──────────────────────────────── */

type PendingMap = Arc<AsyncMutex<HashMap<u64, oneshot::Sender<Value>>>>;
type WsWriter = Arc<AsyncMutex<
    futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
>>;

/// A persistent WebSocket connection to a CDP target.
/// A background reader task dispatches responses by ID to waiting callers.
/// Multiple commands can be multiplexed over a single connection.
struct Ctx {
    next: AtomicU64,
    writer: WsWriter,
    pending: PendingMap,
    _reader_task: tokio::task::JoinHandle<()>,
}

impl Ctx {
    /// Establish a persistent WebSocket connection with a background reader.
    async fn connect(ws_url: &str) -> Result<Self> {
        let (ws, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .with_context(|| format!("connect {ws_url}"))?;

        let (write, mut read) = ws.split();
        let writer = Arc::new(AsyncMutex::new(write));
        let pending: PendingMap = Arc::new(AsyncMutex::new(HashMap::new()));
        let pending_clone = Arc::clone(&pending);

        let reader_task = tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(msg) => {
                        if let Ok(txt) = msg.to_text() {
                            if let Ok(v) = serde_json::from_str::<Value>(txt) {
                                if let Some(id) = v.get("id").and_then(|v| v.as_u64()) {
                                    let mut map = pending_clone.lock().await;
                                    if let Some(tx) = map.remove(&id) {
                                        tx.send(v).ok();
                                    }
                                }
                                // Non-response events (e.g. DOM events) are silently dropped
                            }
                        }
                    }
                    Err(e) => {
                        debug!("[CDP] persistent reader error: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            next: AtomicU64::new(1),
            writer,
            pending,
            _reader_task: reader_task,
        })
    }

    /// Send a CDP command over the persistent connection and wait for the response.
    async fn send(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let cmd = json!({ "id": id, "method": method, "params": params });

        let (tx, rx) = oneshot::channel::<Value>();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        {
            let mut writer = self.writer.lock().await;
            writer
                .send(Message::Text(cmd.to_string()))
                .await
                .context("send CDP cmd")?;
        }

        let resp = timeout(Duration::from_secs(10), rx)
            .await
            .context("CDP timeout")?
            .context("response channel closed")?;

        if let Some(err) = resp.get("error") {
            bail!("CDP {method}: {err}");
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Evaluate a JS expression over the persistent connection.
    async fn eval(&self, expr: &str) -> Result<Value> {
        self.send(
            "Runtime.evaluate",
            json!({ "expression": expr, "returnByValue": true }),
        )
        .await
    }

    /// One-shot: connect WS, send one command, drop connection.
    async fn one_shot(ws_url: &str, method: &str, params: Value) -> Result<Value> {
        let (ws, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .with_context(|| format!("one_shot connect {ws_url}"))?;
        let (mut write, mut read) = ws.split();

        let id = 1u64;
        let cmd = json!({ "id": id, "method": method, "params": params });
        write.send(Message::Text(cmd.to_string())).await.context("send CDP one_shot")?;

        while let Some(msg) = read.next().await {
            if let Ok(txt) = msg?.to_text() {
                if let Ok(v) = serde_json::from_str::<Value>(txt) {
                    if v.get("id").and_then(|v| v.as_u64()) == Some(id) {
                        if let Some(err) = v.get("error") {
                            bail!("CDP {method}: {err}");
                        }
                        return Ok(v.get("result").cloned().unwrap_or(Value::Null));
                    }
                }
            }
        }
        bail!("CDP one_shot: no response for method={method}");
    }
}

/* ── Copilot Page Handle ────────────────────────────────────── */

#[derive(Clone)]
pub struct CopilotPage {
    debug_url: String,
    ws_url: String,
    /// Cached resolved WS URL — avoids repeated `/json/version` HTTP calls.
    resolved_ws: Arc<AsyncMutex<Option<String>>>,
    pub url: String,
    pub title: String,
}

impl CopilotPage {
    /// Resolve the WS URL once and cache it. Subsequent calls return the cached value.
    async fn resolve_ws_cached(&self) -> Result<String> {
        {
            let cached = self.resolved_ws.lock().await;
            if let Some(ref url) = *cached {
                return Ok(url.clone());
            }
        }
        let resolved = resolve_ws(&self.debug_url, &self.ws_url).await?;
        let mut cached = self.resolved_ws.lock().await;
        *cached = Some(resolved.clone());
        Ok(resolved)
    }

    /// Open a persistent CDP connection for multi-command sequences.
    async fn connect_ctx(&self) -> Result<Ctx> {
        let ws_url = self.resolve_ws_cached().await?;
        Ctx::connect(&ws_url).await
    }

    /// One-shot helper: resolve WS, run a single command, done.
    async fn one_shot(&self, method: &str, params: Value) -> Result<Value> {
        let ws_url = self.resolve_ws_cached().await?;
        Ctx::one_shot(&ws_url, method, params).await
    }

    pub async fn body_text(&self) -> Result<String> {
        let r = self.one_shot_eval("document.body.innerText").await?;
        Ok(r["result"]["value"].as_str().unwrap_or_default().into())
    }

    /// Evaluate JS via a one-shot connection.
    async fn one_shot_eval(&self, expr: &str) -> Result<Value> {
        self.one_shot(
            "Runtime.evaluate",
            json!({ "expression": expr, "returnByValue": true }),
        )
        .await
    }

    pub async fn navigate_to_chat(&self) -> Result<()> {
        info!("[CDP] navigate to /chat");
        let ctx = self.connect_ctx().await?;
        ctx.send(
            "Page.navigate",
            json!({ "url": "https://m365.cloud.microsoft/chat" }),
        )
        .await?;
        ctx.send("Page.enable", json!({})).await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        Ok(())
    }

    /// Send a prompt to the Copilot composer and click send.
    /// Uses a single persistent connection for all 3 CDP operations (type, click, wait-clear).
    /// Uses multi-selector fallback for the composer and send button
    /// to handle UI changes and i18n (Japanese/English).
    pub async fn send_prompt(&self, text: &str) -> Result<()> {
        let preview = text.chars().take(60).collect::<String>();
        info!("[CDP] send: {preview}…");
        let ctx = self.connect_ctx().await?;

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
        let r2 = ctx.eval(js2).await?;
        let val: Value = serde_json::from_str(r2["result"]["value"].as_str().unwrap_or("{}"))
            .unwrap_or(Value::Null);
        if val.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
            bail!("send button not found — page may not be interactive");
        }

        // 3. Wait for composer to clear (confirms prompt was dispatched)
        tokio::time::sleep(Duration::from_millis(500)).await;
        timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(r) = ctx
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
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await
        .context("composer didn't clear after send")??;

        info!("[CDP] prompt sent ✓");
        Ok(())
    }

    /// Check if Copilot is currently generating a response.
    /// Accepts a `Ctx` to reuse the existing connection.
    async fn is_streaming_ctx(ctx: &Ctx) -> Result<bool> {
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
    /// Uses a single persistent connection for all polling operations.
    /// Uses streaming detection + content stability polling.
    /// All polling uses a single persistent WebSocket connection.
    pub async fn wait_for_response(&self, timeout_secs: u64) -> Result<String> {
        const MAX_CONSECUTIVE_ERRORS: usize = 5;
        let start = std::time::Instant::now();
        let mut prev = 0;
        let mut stable = 0;
        let mut streaming = false;
        let mut consecutive_errors = 0;

        let ctx = self.connect_ctx().await?;

        loop {
            if start.elapsed() > Duration::from_secs(timeout_secs) {
                bail!("response timeout after {timeout_secs}s");
            }

            let txt = match Self::body_text_ctx(&ctx).await {
                Ok(text) => {
                    consecutive_errors = 0;
                    text
                }
                Err(e) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        bail!("body_text failed {MAX_CONSECUTIVE_ERRORS} times in a row: {e}");
                    }
                    debug!("[CDP] body_text error (attempt {consecutive_errors}): {e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            let len = txt.len();

            let is_streaming = Self::is_streaming_ctx(&ctx).await.unwrap_or(false);

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

    /// Get body text via an existing Ctx connection.
    async fn body_text_ctx(ctx: &Ctx) -> Result<String> {
        let r = ctx.eval("document.body.innerText").await?;
        Ok(r["result"]["value"].as_str().unwrap_or_default().into())
    }

    /// Capture a screenshot of the current page.
    pub async fn screenshot(&self, path: &str) -> Result<()> {
        let r = self
            .one_shot("Page.captureScreenshot", json!({ "format": "png" }))
            .await?;
        let b64 = r["data"]
            .as_str()
            .context("no screenshot data in CDP response")?;
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
pub fn disconnect_copilot_page(result: ConnectionResult) {
    let debug_url = result.page.debug_url.clone();
    let mut result = result;
    result.quit_edge();
    info!("[CDP] Disconnected from {:?}", debug_url);
}

/// Connect to a Copilot page, auto-launching Edge if needed.
pub async fn connect_copilot_page(
    debug_url: &str,
    auto_launch: bool,
    base_port: u16,
) -> Result<ConnectionResult> {
    if !auto_launch {
        if let Some(p) = try_existing(debug_url).await {
            return p;
        }
        bail!(
            "No Copilot browser found at {debug_url}. \
             Enable auto_launch or start Edge with --remote-debugging-port."
        );
    }

    let port = find_free_port(base_port, 50);
    let debug_url_new = format!("http://127.0.0.1:{port}");

    info!(
        "[CDP] Launching dedicated Edge on port {}...",
        port
    );

    let child = launch_dedicated_edge(port)?;
    wait_for_cdp_ready(&debug_url_new, 30).await?;

    // Wait a bit for the initial tab to settle
    tokio::time::sleep(Duration::from_secs(3)).await;

    // Get all pages — retry a few times since Edge may need a moment to register tabs
    let ws_url = resolve_ws_from_port(&debug_url_new).await?;
    let ctx = Ctx::connect(&ws_url).await?;

    let mut pages = Vec::new();
    for attempt in 0..3 {
        pages = list_pages(&debug_url_new).await.unwrap_or_default();
        if !pages.is_empty() {
            if attempt > 0 {
                info!("[CDP] pages found on attempt {} ({} tabs)", attempt + 1, pages.len());
            }
            break;
        }
        info!("[CDP] no pages on attempt {}, waiting…", attempt + 1);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    if pages.is_empty() {
        bail!("[CDP] no tabs found after Edge launch");
    }
    let mut copilot_page: Option<PageInfo> = None;

    for page in &pages {
        if page.kind != "page" {
            continue;
        }
        if COPILOT_URL_PATTERNS.iter().any(|pat| page.url.contains(pat)) {
            // Already a Copilot tab — use it
            info!("[CDP] Found existing Copilot tab: {}", page.url);
            copilot_page = Some(page.clone());
            break;
        }
    }

    if copilot_page.is_none() {
        // No Copilot tab — navigate the first blank/about:blank tab to Copilot
        if let Some(first_page) = pages.iter().find(|p| p.kind == "page") {
            info!(
                "[CDP] Navigating existing tab to Copilot (was: {})",
                first_page.url
            );
            let page_ctx = Ctx::connect(&first_page.ws_url).await?;
            let result = page_ctx
                .send(
                    "Page.navigate",
                    json!({ "url": "https://m365.cloud.microsoft/chat" }),
                )
                .await;
            info!("[CDP] Page.navigate result: {:?}", result);
            tokio::time::sleep(Duration::from_secs(10)).await;

            // Re-check if navigation succeeded
            let pages2 = list_pages(&debug_url_new).await.unwrap_or_default();
            copilot_page = pages2
                .into_iter()
                .find(|p| {
                    p.kind == "page"
                        && COPILOT_URL_PATTERNS.iter().any(|pat| p.url.contains(pat))
                });
        }
    }

    if copilot_page.is_none() {
        // Create a new tab via Target.createTarget
        info!("[CDP] Creating new Copilot tab via Target.createTarget…");
        let create_result = ctx
            .send(
                "Target.createTarget",
                json!({
                    "type": "page",
                    "url": "https://m365.cloud.microsoft/chat"
                }),
            )
            .await;
        info!("[CDP] Target.createTarget result: {:?}", create_result);
        tokio::time::sleep(Duration::from_secs(10)).await;

        let pages3 = list_pages(&debug_url_new).await.unwrap_or_default();
        copilot_page = pages3.into_iter().find(|p| {
            p.kind == "page" && COPILOT_URL_PATTERNS.iter().any(|pat| p.url.contains(pat))
        });
    }

    // Last resort: use any available page even if not Copilot URL
    if copilot_page.is_none() {
        warn!("[CDP] No Copilot tab found, falling back to first available page");
        let pages4 = list_pages(&debug_url_new).await.unwrap_or_default();
        if let Some(first) = pages4.into_iter().find(|p| p.kind == "page") {
            // Navigate it to Copilot URL
            let page_ctx = Ctx::connect(&first.ws_url).await?;
            let _ = page_ctx
                .send(
                    "Page.navigate",
                    json!({ "url": "https://m365.cloud.microsoft/chat" }),
                )
                .await;
            tokio::time::sleep(Duration::from_secs(5)).await;
            copilot_page = Some(first);
        }
    }

    let copilot_page =
        copilot_page.context("no Copilot tab found after all attempts")?;

    info!(
        "[CDP] Using Copilot tab: {} ({})",
        copilot_page.url, copilot_page.title
    );

    Ok(ConnectionResult {
        page: CopilotPage {
            debug_url: debug_url_new.clone(),
            ws_url: copilot_page.ws_url.clone(),
            resolved_ws: Arc::new(AsyncMutex::new(None)),
            url: copilot_page.url.clone(),
            title: copilot_page.title.clone(),
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
                resolved_ws: Arc::new(AsyncMutex::new(None)),
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
                warn!(
                    "[CDP] No Copilot page found, falling back to tab: {}",
                    first.url
                );
                return Some(Ok(ConnectionResult {
                    page: CopilotPage {
                        debug_url: debug_url.into(),
                        ws_url: first.ws_url.clone(),
                        resolved_ws: Arc::new(AsyncMutex::new(None)),
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

/// Extract the target ID from a WebSocket debugger URL.
/// Format: ws://host:port/devtools/page/<target-id>
fn extract_target_id(ws_url: &str) -> Option<String> {
    ws_url.rsplit('/').next().filter(|s| !s.is_empty()).map(String::from)
}

/// Resolve the WebSocket URL from a debug endpoint by fetching /json/version directly.
async fn resolve_ws_from_port(debug_url: &str) -> Result<String> {
    let r = reqwest::get(&format!("{debug_url}/json/version"))
        .await
        .context("/json/version")?;
    let v: Value = r.json().await.context("/json/version JSON")?;
    let url = v["webSocketDebuggerUrl"]
        .as_str()
        .context("missing webSocketDebuggerUrl")?
        .to_string();
    // Windows may return ws://0.0.36.6/… — normalize to 127.0.0.1
    let url = url.replace("ws://0.0.36.6/", "ws://127.0.0.1/");
    Ok(url)
}

/// Resolve the actual WebSocket URL for CDP communication.
/// Handles localhost, 127.0.0.1, and Windows IPv4-mapped ::1 (0.0.36.6) normalization.
async fn resolve_ws(debug: &str, ws: &str) -> Result<String> {
    let target_host = debug
        .strip_prefix("http://")
        .or_else(|| debug.strip_prefix("https://"))
        .unwrap_or(debug);

    // If the WS URL already uses a routable (non-loopback) host, use it as-is
    if ws.starts_with("ws://")
        && !ws.contains("localhost")
        && !ws.contains("127.0.0.1")
        && !ws.contains("0.0.36.6")
    {
        return Ok(ws.into());
    }

    // Fetch the canonical WebSocket debugger URL from the CDP endpoint
    let r = reqwest::get(&format!("{target_host}/json/version"))
        .await
        .context("/json/version")?;
    let v: Value = r.json().await.context("/json/version JSON")?;
    let url = v["webSocketDebuggerUrl"]
        .as_str()
        .context("missing webSocketDebuggerUrl")?
        .to_string();

    // Force all loopback addresses to the target host:
    //   ws://localhost/…       -> ws://{target_host}/…
    //   ws://127.0.0.1/…       -> ws://{target_host}/…
    //   ws://0.0.36.6/…        -> ws://{target_host}/… (Windows IPv4-mapped ::1)
    // Also handle URLs that include a port: ws://0.0.36.6:9222/…
    let url = url.replace("ws://localhost/", &format!("ws://{target_host}/"));
    let url = url.replace("ws://127.0.0.1/", &format!("ws://{target_host}/"));
    Ok(url.replace("ws://0.0.36.6/", &format!("ws://{target_host}/")))
}
