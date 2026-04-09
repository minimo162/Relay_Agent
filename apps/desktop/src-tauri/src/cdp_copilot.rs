#![allow(
    clippy::result_large_err,
    clippy::items_after_statements,
    clippy::too_many_lines
)]

//! CDP-driven M365 Copilot client.
//!
//! Automatically launches a dedicated Edge instance with an OS-assigned CDP port
//! (`--remote-debugging-port=0`), discovered via `DevToolsActivePort` in the
//! isolated profile — no port scanning and no collision with devtools on 9222.
//! If that profile already has a live CDP endpoint, reconnects reuse it.
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
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tokio::time::{timeout, Duration};
use tracing::{debug, info, warn};
use tungstenite::Message;

/* ── Profile + DevToolsActivePort (port 0) ───────────────────── */

/// Isolated Edge profile directory (same path the Tauri `disconnect_cdp` cleanup expects).
pub fn relay_agent_edge_profile_dir() -> PathBuf {
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
    home.join("RelayAgentEdgeProfile")
}

/// Read the Chromium-written `DevToolsActivePort` file (first line = port).
fn read_devtools_active_port(profile_dir: &std::path::Path) -> Option<u16> {
    let path = profile_dir.join("DevToolsActivePort");
    let data = std::fs::read_to_string(&path).ok()?;
    let line = data.lines().next()?.trim();
    let port: u16 = line.parse().ok()?;
    (port > 0).then_some(port)
}

/// Poll until `DevToolsActivePort` appears after `--remote-debugging-port=0` launch.
async fn wait_for_devtools_active_port(profile_dir: &std::path::Path, max_wait_secs: u64) -> Result<u16> {
    let deadline = std::time::Instant::now() + Duration::from_secs(max_wait_secs);
    let interval = Duration::from_millis(100);
    loop {
        if std::time::Instant::now() > deadline {
            bail!("DevToolsActivePort did not appear within {max_wait_secs}s");
        }
        if let Some(p) = read_devtools_active_port(profile_dir) {
            return Ok(p);
        }
        tokio::time::sleep(interval).await;
    }
}

async fn cdp_http_ready(debug_url: &str) -> bool {
    matches!(
        reqwest::get(format!("{debug_url}/json/version")).await,
        Ok(r) if r.status().is_success()
    )
}

/// Same relative path as `copilot_server.js` `RELAY_CDP_PORT_MARKER` under the Edge profile dir.
const RELAY_CDP_PORT_MARKER: &str = ".relay-agent-cdp-port";

fn read_relay_cdp_port_marker(profile_dir: &std::path::Path) -> Option<u16> {
    let path = profile_dir.join(RELAY_CDP_PORT_MARKER);
    let raw = std::fs::read_to_string(&path).ok()?;
    let n: u32 = raw.trim().parse().ok()?;
    (1..=65535)
        .contains(&n)
        .then(|| u16::try_from(n).ok())
        .flatten()
}

/// CDP HTTP port when attaching with `auto_launch: false` and no explicit `base_port`.
///
/// Resolution order: **`.relay-agent-cdp-port`** (if `/json/version` succeeds) →
/// **`DevToolsActivePort`** (if live) → **`preferred`** (Relay default **9360**; override with env / legacy 9333 Edge via `DevTools` file).
pub async fn resolve_cdp_attachment_port(preferred: u16) -> u16 {
    let profile_dir = relay_agent_edge_profile_dir();
    if let Some(p) = read_relay_cdp_port_marker(&profile_dir) {
        let url = format!("http://127.0.0.1:{p}");
        if cdp_http_ready(&url).await {
            info!("[CDP] resolve_cdp_attachment_port: using marker port {p}");
            return p;
        }
    }
    if let Some(p) = read_devtools_active_port(&profile_dir) {
        let url = format!("http://127.0.0.1:{p}");
        if cdp_http_ready(&url).await {
            info!("[CDP] resolve_cdp_attachment_port: using DevToolsActivePort {p}");
            return p;
        }
    }
    debug!("[CDP] resolve_cdp_attachment_port: fallback to preferred port {preferred}");
    preferred
}

#[cfg(test)]
mod attachment_port_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn read_relay_cdp_port_marker_valid() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut f = std::fs::File::create(dir.path().join(RELAY_CDP_PORT_MARKER)).unwrap();
        writeln!(f, "9340").unwrap();
        assert_eq!(read_relay_cdp_port_marker(dir.path()), Some(9340));
    }

    #[test]
    fn read_relay_cdp_port_marker_whitespace_trimmed() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join(RELAY_CDP_PORT_MARKER), " 9335 \n").unwrap();
        assert_eq!(read_relay_cdp_port_marker(dir.path()), Some(9335));
    }

    #[test]
    fn read_relay_cdp_port_marker_invalid_or_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(read_relay_cdp_port_marker(dir.path()), None);
        std::fs::write(dir.path().join(RELAY_CDP_PORT_MARKER), "0").unwrap();
        assert_eq!(read_relay_cdp_port_marker(dir.path()), None);
        std::fs::write(dir.path().join(RELAY_CDP_PORT_MARKER), "70000").unwrap();
        assert_eq!(read_relay_cdp_port_marker(dir.path()), None);
        std::fs::write(dir.path().join(RELAY_CDP_PORT_MARKER), "not-a-port").unwrap();
        assert_eq!(read_relay_cdp_port_marker(dir.path()), None);
    }

    #[test]
    fn read_devtools_active_port_first_line() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("DevToolsActivePort"), "9444\nsecond\n").unwrap();
        assert_eq!(read_devtools_active_port(dir.path()), Some(9444));
    }
}

/* ── Edge auto-launch ────────────────────────────────────────── */

/// Initial tab when Relay spawns Edge (trailing slash matches Node `COPILOT_URL`).
const COPILOT_CHAT_LAUNCH_URL: &str = "https://m365.cloud.microsoft/chat/";

/// Launch a dedicated Edge instance for CDP control.
/// Uses a separate user-data-dir so it doesn't conflict with
/// the user's personal browser.
/// Pass `debug_port: 0` so Chromium picks a free port (see `DevToolsActivePort`).
pub fn launch_dedicated_edge(debug_port: u16) -> Result<std::process::Child> {
    let edge_path = find_edge_path()?;

    let profile_dir = relay_agent_edge_profile_dir();
    std::fs::create_dir_all(&profile_dir).ok();

    info!(
        "[CDP] Launching Edge remote-debugging-port={} profile: {:?}",
        debug_port, profile_dir
    );

    // Open Copilot directly (matches Node `copilot_server.js`) so a rare second spawn
    // is not an extra blank window. Use flags to avoid VBS/Code Integrity issues (error 577)
    // on Windows corporate environments.
    // `--no-sandbox` is omitted on Windows/macOS: Microsoft Edge reports it as unsupported there; keep on Linux (and optional override).
    let mut cmd = std::process::Command::new(&edge_path);
    cmd.arg("--remote-debugging-port")
        .arg(debug_port.to_string())
        // Chromium 111+ restricts DevTools/WebSocket origins without this; Edge needs it for CDP clients.
        .arg("--remote-allow-origins=*")
        .arg(format!(
            "--user-data-dir={}",
            profile_dir.to_str().unwrap()
        ))
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "--disable-hang-monitor",
            "--disable-restore-session-state",
            "--disable-gpu",
            "--disable-gpu-compositing",
        ]);
    if cfg!(target_os = "linux")
        || std::env::var("RELAY_EDGE_FORCE_NO_SANDBOX").as_deref() == Ok("1")
    {
        cmd.arg("--no-sandbox");
    }
    cmd.args([
        "--disable-site-isolation-trials",
        "--disable-breakpad",
        "--disable-crashpad",
        "--disable-features=RendererCodeIntegrity,EdgeEnclave,VbsEnclave",
        COPILOT_CHAT_LAUNCH_URL,
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
            r"C:\Program Files (x86)\Microsoft\Edge Beta\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge Beta\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge Dev\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge Dev\Application\msedge.exe",
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
            "microsoft-edge-beta",
            "msedge",
        ] {
            if let Ok(output) = std::process::Command::new("which").arg(candidate).output() {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }
            }
        }
        bail!("Microsoft Edge not found on Linux (tried microsoft-edge-stable, microsoft-edge, microsoft-edge-dev, microsoft-edge-beta, msedge)");
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
            debug_url: "http://127.0.0.1:9360".into(),
            copilot_url: "https://m365.cloud.microsoft/chat".into(),
            auto_launch: false,
            base_port: 9360,
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
                                if let Some(id) = v.get("id").and_then(Value::as_u64) {
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
                    if v.get("id").and_then(Value::as_u64) == Some(id) {
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

/// Match `copilot_server.js`: minimum visible composer length to trust paste for longer prompts.
fn copilot_composer_need_min(text_char_len: usize) -> u64 {
    if text_char_len < 20 {
        1
    } else {
        let scaled = (text_char_len as u128).saturating_mul(6) / 100;
        let raw = u64::try_from(scaled).unwrap_or(120);
        (12_u64).max(raw).min(120)
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

/// When `RELAY_COPILOT_NO_WINDOW_FOCUS=1`, skip CDP `Page.bringToFront` (aligns with `copilot_server.js`).
fn copilot_window_focus_allowed() -> bool {
    match std::env::var("RELAY_COPILOT_NO_WINDOW_FOCUS") {
        Ok(v) if v == "1" => false,
        _ => true,
    }
}

impl CopilotPage {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    async fn cdp_composer_visible_len(ctx: &Ctx) -> Result<u64> {
        let r = ctx
            .eval(
                r#"(() => {
                function lenOf(el) {
                    if (!el) return 0;
                    const raw = el.innerText || el.textContent || '';
                    const t = raw.replace(/\u200b/g, '');
                    return t.trim().length;
                }
                const root = document.querySelector('#m365-chat-editor-target-element')
                    ?? document.querySelector('[data-lexical-editor="true"]');
                if (root && root.offsetParent !== null) {
                    const inner = root.querySelector('[contenteditable="true"]');
                    const n = lenOf(inner && inner.offsetParent !== null ? inner : root);
                    if (n > 0) return n;
                }
                const fb = document.querySelector('div[role="textbox"]');
                return lenOf(fb);
            })()"#,
            )
            .await?;
        let v = &r["result"]["value"];
        Ok(v.as_u64()
            .or_else(|| v.as_f64().map(|f| f as u64))
            .unwrap_or(0))
    }

    async fn cdp_insert_exec_command(ctx: &Ctx, text: &str) -> Result<()> {
        // Small chunks: large execCommand runs freeze the renderer and can stall CDP responses.
        const CAP: usize = 200;
        let chars: Vec<char> = text.chars().collect();
        for chunk in chars.chunks(CAP) {
            let s: String = chunk.iter().collect();
            let escaped =
                serde_json::to_string(&s).context("escape prompt chunk for execCommand")?;
            let expr = format!(
                r#"(() => {{
                const root = document.querySelector('#m365-chat-editor-target-element')
                    ?? document.querySelector('[data-lexical-editor="true"]');
                const inner = root?.querySelector('[contenteditable="true"]');
                const el = (inner && inner.offsetParent !== null ? inner : null)
                    ?? root
                    ?? document.querySelector('div[role="textbox"]');
                if (!el) return false;
                el.focus();
                try {{ return document.execCommand('insertText', false, {escaped}); }} catch (e) {{ return false; }}
            }})()"#
            );
            ctx.eval(&expr).await?;
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        Ok(())
    }

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

        if copilot_window_focus_allowed() {
            let _ = ctx.send("Page.bringToFront", json!({})).await;
        }
        let _ = ctx.send("Input.enable", json!({})).await;

        // 1. Focus inner Lexical surface when present (same strategy as copilot_server.js).
        let focus_js = r#"(() => {
            function visible(el) {
                return el && el.offsetParent !== null;
            }
            const roots = [
                document.querySelector('#m365-chat-editor-target-element'),
                document.querySelector('[data-lexical-editor="true"]')
            ].filter(Boolean);
            for (const root of roots) {
                if (!visible(root)) continue;
                const inner = root.querySelector('[contenteditable="true"]');
                const el = visible(inner) ? inner : root;
                try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
                el.click();
                el.focus();
                return true;
            }
            const fallbacks = ['textarea', 'div[role="textbox"]', '[contenteditable="true"]'];
            for (const s of fallbacks) {
                const el = document.querySelector(s);
                if (visible(el)) {
                    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
                    el.click();
                    el.focus();
                    return true;
                }
            }
            return false;
        })()"#;
        let r = ctx.eval(focus_js).await?;
        if r["result"]["value"].as_bool() != Some(true) {
            bail!("composer not found — Copilot page may not be ready");
        }

        // 2. Insert text; fall back to execCommand if CDP typing does not reach Lexical.
        ctx.send("Input.insertText", json!({ "text": text }))
            .await
            .context("Input.insertText")?;

        tokio::time::sleep(Duration::from_millis(400)).await;

        let text_len = text.chars().count();
        let need_min = copilot_composer_need_min(text_len);
        let mut visible_len = Self::cdp_composer_visible_len(&ctx).await?;
        if text_len >= 20 && visible_len < need_min {
            warn!(
                "[CDP] Input.insertText left composer short (len={visible_len}, need~{need_min}); trying execCommand"
            );
            Self::cdp_insert_exec_command(&ctx, text).await?;
            tokio::time::sleep(Duration::from_millis(200)).await;
            visible_len = Self::cdp_composer_visible_len(&ctx).await?;
        }
        if text_len >= 20 && visible_len < need_min {
            bail!(
                "prompt did not reach Copilot composer (visible len {visible_len}, need ~{need_min})"
            );
        }

        for phase in ["keyDown", "keyUp"] {
            ctx.send(
                "Input.dispatchKeyEvent",
                json!({
                    "type": phase,
                    "key": "Enter",
                    "code": "Enter",
                    "windowsVirtualKeyCode": 13,
                    "nativeVirtualKeyCode": 13
                }),
            )
            .await
            .context("Input.dispatchKeyEvent Enter")?;
        }

        // 3. Wait for composer to clear (confirms prompt was dispatched)
        tokio::time::sleep(Duration::from_millis(500)).await;
        timeout(Duration::from_secs(8), async {
            loop {
                if let Ok(r) = ctx
                    .eval(
                        r#"(() => {
                        function lenOf(el) {
                            if (!el) return 0;
                            const raw = el.innerText || el.textContent || '';
                            return raw.replace(/\u200b/g, '').trim().length;
                        }
                        const root = document.querySelector('#m365-chat-editor-target-element')
                            ?? document.querySelector('[data-lexical-editor="true"]');
                        let n = 0;
                        if (root && root.offsetParent !== null) {
                            const inner = root.querySelector('[contenteditable="true"]');
                            n = lenOf(inner && inner.offsetParent !== null ? inner : root);
                        }
                        if (n <= 5) {
                            for (const el of document.querySelectorAll('textarea,[contenteditable="true"],div[role="textbox"]')) {
                                if (lenOf(el) > 5) return false;
                            }
                            return true;
                        }
                        return false;
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
                const stopSels = [
                    '[data-testid="stopGeneratingButton"]',
                    'button[data-testid*="stop"]',
                    '.fai-SendButton__stopBackground'
                ];
                for (const s of stopSels) {
                    for (const el of document.querySelectorAll(s)) {
                        if (el?.offsetParent) return true;
                    }
                }
                const needles = ['Stop generating', 'Stop response', '生成を停止', '応答を停止', '停止'];
                for (const b of document.querySelectorAll('button[aria-label], [role="button"]')) {
                    if (!b.offsetParent) continue;
                    const a = (b.getAttribute('aria-label') || '').toLowerCase();
                    for (const n of needles) {
                        if (a.includes(n.toLowerCase())) return true;
                    }
                    if (/\bstop\b/.test(a) && /generat|stream|response|応答|生成|回答/.test(a)) return true;
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
        let mut start_len: Option<usize> = None;

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
            if start_len.is_none() {
                start_len = Some(len);
            }
            if !streaming && len > start_len.unwrap_or(0).saturating_add(40) {
                streaming = true;
            }

            let is_streaming = Self::is_streaming_ctx(&ctx).await.unwrap_or(false);

            if is_streaming {
                streaming = true;
                stable = 0;
            } else if streaming && len > 80 {
                let delta = len.abs_diff(prev);
                if delta <= 12 {
                    stable += 1;
                    if stable >= 3 {
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
    _base_port: u16,
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

    let profile_dir = relay_agent_edge_profile_dir();
    std::fs::create_dir_all(&profile_dir).ok();

    let (debug_url_new, child, launched) =
        if let Some(p) = read_devtools_active_port(&profile_dir) {
            let url = format!("http://127.0.0.1:{p}");
            let reuse_existing = if cdp_http_ready(&url).await {
                true
            } else {
                info!(
                    "[CDP] DevToolsActivePort on {} but CDP not up yet — waiting before any new launch…",
                    p
                );
                wait_for_cdp_ready(&url, 30).await.is_ok()
            };

            if reuse_existing {
                info!(
                    "[CDP] Reusing live Edge CDP on port {} (RelayAgentEdgeProfile)",
                    p
                );
                (url, None, false)
            } else {
                warn!(
                    "[CDP] DevToolsActivePort present but CDP unreachable after wait; launching new Edge…"
                );
                let spawned = launch_dedicated_edge(0)?;
                let p2 = wait_for_devtools_active_port(&profile_dir, 30).await?;
                (
                    format!("http://127.0.0.1:{p2}"),
                    Some(spawned),
                    true,
                )
            }
        } else {
            info!("[CDP] Launching Edge with OS-assigned CDP port (remote-debugging-port=0)…");
            let spawned = launch_dedicated_edge(0)?;
            let p = wait_for_devtools_active_port(&profile_dir, 30).await?;
            (
                format!("http://127.0.0.1:{p}"),
                Some(spawned),
                true,
            )
        };

    if launched {
        wait_for_cdp_ready(&debug_url_new, 30).await?;
    } else {
        wait_for_cdp_ready(&debug_url_new, 5).await?;
    }

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

    let port = parse_port(&debug_url_new).unwrap_or(0);

    Ok(ConnectionResult {
        page: CopilotPage {
            debug_url: debug_url_new.clone(),
            ws_url: copilot_page.ws_url.clone(),
            resolved_ws: Arc::new(AsyncMutex::new(None)),
            url: copilot_page.url.clone(),
            title: copilot_page.title.clone(),
        },
        port,
        launched,
        edge_process: child,
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
            port: parse_port(debug_url).unwrap_or(9360),
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
                    port: parse_port(debug_url).unwrap_or(9360),
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
    // Windows may return ws://0.0.36.6/… or ws://0.0.36.6:port/… (IPv4-mapped ::1) — normalize.
    let url = url.replace("ws://0.0.36.6:", "ws://127.0.0.1:");
    let url = url.replace("ws://0.0.36.6/", "ws://127.0.0.1/");
    Ok(url)
}

/// Resolve the actual WebSocket URL for CDP communication.
/// Handles localhost, 127.0.0.1, and Windows IPv4-mapped `::1` (0.0.36.6) normalization.
async fn resolve_ws(debug: &str, ws: &str) -> Result<String> {
    let debug_base = debug.trim_end_matches('/');
    let target_host = debug_base
        .strip_prefix("http://")
        .or_else(|| debug_base.strip_prefix("https://"))
        .unwrap_or(debug_base);

    // If the WS URL already uses a routable (non-loopback) host, use it as-is
    if ws.starts_with("ws://")
        && !ws.contains("localhost")
        && !ws.contains("127.0.0.1")
        && !ws.contains("0.0.36.6")
    {
        return Ok(ws.into());
    }

    // Must use a full URL (scheme + host); `127.0.0.1:port` alone is invalid for HTTP clients.
    let r = reqwest::get(format!("{debug_base}/json/version"))
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
    //   ws://0.0.36.6:port/…   -> ws://127.0.0.1:port/… (keep port; target_host may include its own port)
    let url = url.replace("ws://0.0.36.6:", "ws://127.0.0.1:");
    let url = url.replace("ws://localhost/", &format!("ws://{target_host}/"));
    let url = url.replace("ws://127.0.0.1/", &format!("ws://{target_host}/"));
    Ok(url.replace("ws://0.0.36.6/", &format!("ws://{target_host}/")))
}
