//! agent-browser daemon client.
//!
//! Connects to the agent-browser daemon via TCP on Windows (or Unix domain socket
//! on Linux/macOS) and sends line-delimited JSON commands to control the browser.
//!
//! This replaces the `copilot_server.js` (Playwright-based) approach, using
//! agent-browser's native CDP Input.dispatchKeyEvent for reliable text input
//! into Lexical-based editors (M365 Copilot).
//!
//! Prerequisite: `npm install -g agent-browser && agent-browser install`

use std::io::{self, BufRead, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

const COPILOT_URL: &str = "https://m365.cloud.microsoft/chat/";
const INPUT_SELECTOR: &str = "#m365-chat-editor-target-element";
const SEND_BUTTON_SELECTOR: &str = ".fai-SendButton";
const STOP_BUTTON_SELECTOR: &str = ".fai-SendButton__stopBackground";
const RESPONSE_TIMEOUT_MS: u64 = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotStatusResponse {
    pub connected: bool,
    pub login_required: bool,
}

#[derive(Debug)]
pub enum DaemonError {
    Io(io::Error),
    Json(serde_json::Error),
    Command(String),
    NotRunning,
}

impl std::fmt::Display for DaemonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DaemonError::Io(e) => write!(f, "IO error: {e}"),
            DaemonError::Json(e) => write!(f, "JSON error: {e}"),
            DaemonError::Command(msg) => write!(f, "Command failed: {msg}"),
            DaemonError::NotRunning => write!(f, "agent-browser daemon not running"),
        }
    }
}

impl From<io::Error> for DaemonError {
    fn from(e: io::Error) -> Self {
        DaemonError::Io(e)
    }
}

impl From<serde_json::Error> for DaemonError {
    fn from(e: serde_json::Error) -> Self {
        DaemonError::Json(e)
    }
}

/// Handle to an active agent-browser daemon connection.
pub struct AgentBrowserDaemon {
    /// Session name used for daemon socket identification.
    session: String,
    /// TCP port (populated after start on Windows).
    port: Option<u16>,
    /// CDP port to connect Edge with.
    cdp_port: u16,
    /// Whether the browser has been launched/connected.
    browser_ready: bool,
    /// Current page URL (tracked locally).
    current_url: Option<String>,
}

fn agent_browser_dir() -> PathBuf {
    if cfg!(windows) {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\default".to_string())
        });
        PathBuf::from(local).join("agent-browser")
    } else {
        // On Unix, use XDG or home
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home).join(".agent-browser")
    }
}

/// Read the TCP port file for the given session (Windows).
fn read_daemon_port(session: &str) -> Option<u16> {
    let dir = agent_browser_dir();
    let port_file = dir.join(format!("{session}.port"));
    std::fs::read_to_string(&port_file)
        .ok()?
        .trim()
        .parse::<u16>()
        .ok()
}

/// Connect to the daemon via TCP.
fn connect_to_daemon(port: u16, timeout: std::time::Duration) -> Result<TcpStream, io::Error> {
    let addr = format!("127.0.0.1:{port}");
    let stream = TcpStream::connect_timeout(&addr.parse().unwrap(), timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    Ok(stream)
}

/// Send a single JSON command and read the response.
fn send_command(stream: &mut TcpStream, cmd: &Value) -> Result<Value, DaemonError> {
    let mut line = serde_json::to_string(cmd)?;
    line.push('\n');
    stream.write_all(line.as_bytes())?;

    let mut reader = io::BufReader::new(stream.try_clone()?);
    let mut response_line = String::new();
    reader.read_line(&mut response_line)?;

    let response: Value = serde_json::from_str(response_line.trim())?;
    Ok(response)
}

/// Extract the success/data/error from a daemon response.
fn check_response(resp: &Value, action: &str) -> Result<Value, DaemonError> {
    if let Some(true) = resp.get("success").and_then(Value::as_bool) {
        Ok(resp.get("data").cloned().unwrap_or(Value::Null))
    } else {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        Err(DaemonError::Command(format!(
            "action '{action}' failed: {err}"
        )))
    }
}

/// Build a standard daemon command envelope.
fn cmd(id: &str, action: &str, params: Vec<(&str, Value)>) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("id".to_string(), Value::String(id.to_string()));
    obj.insert("action".to_string(), Value::String(action.to_string()));
    for (k, v) in params {
        obj.insert(k.to_string(), v);
    }
    Value::Object(obj)
}

impl AgentBrowserDaemon {
    pub fn new(cdp_port: u16) -> Self {
        Self {
            session: "relay-copilot".to_string(),
            port: None,
            cdp_port,
            browser_ready: false,
            current_url: None,
        }
    }

    /// Start the daemon process and connect to it.
    pub fn start(&mut self) -> Result<(), DaemonError> {
        // Try to find existing daemon port
        self.port = read_daemon_port(&self.session);

        // If no daemon running, start one
        if self.port.is_none() {
            info!("[agent-browser] starting daemon session={}", self.session);
            start_daemon_process(&self.session)?;
            // Wait for port file
            for _ in 0..30 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Some(p) = read_daemon_port(&self.session) {
                    self.port = Some(p);
                    break;
                }
            }
        }

        let port = self.port.ok_or_else(|| {
            DaemonError::Command("daemon did not start within timeout".to_string())
        })?;

        info!(
            "[agent-browser] daemon ready on port {}, connecting...",
            port
        );
        Ok(())
    }

    /// Connect to an existing Edge browser via CDP port.
    fn ensure_browser_connected(&mut self) -> Result<(), DaemonError> {
        if self.browser_ready {
            return Ok(());
        }

        let port = self.port.ok_or(DaemonError::NotRunning)?;
        let mut stream = connect_to_daemon(port, std::time::Duration::from_secs(10))?;

        // Launch/connect to Edge via CDP
        let resp = send_command(
            &mut stream,
            &cmd("1", "launch", vec![("cdpPort", json!(self.cdp_port))]),
        )?;
        check_response(&resp, "launch")?;

        self.browser_ready = true;

        // Get current URL to track state
        if let Ok(resp) = send_command(&mut stream, &cmd("2", "url", vec![])) {
            if let Some(url_str) = resp
                .get("data")
                .and_then(|d| d.get("url"))
                .and_then(|v| v.as_str())
            {
                self.current_url = Some(url_str.to_string());
            }
        }

        info!(
            "[agent-browser] browser connected via CDP port {}",
            self.cdp_port
        );
        Ok(())
    }

    /// Send a command and get a response, auto-connecting to daemon.
    fn with_connection<T>(
        &self,
        f: impl FnOnce(&mut TcpStream) -> Result<T, DaemonError>,
    ) -> Result<T, DaemonError> {
        let port = self
            .port
            .ok_or_else(|| DaemonError::Command("daemon not started".to_string()))?;
        let mut stream = connect_to_daemon(port, std::time::Duration::from_secs(10))?;
        f(&mut stream)
    }

    /// Navigate to a URL.
    pub fn navigate(&self, url: &str) -> Result<(), DaemonError> {
        self.with_connection(|stream| {
            let resp = send_command(stream, &cmd("1", "navigate", vec![("url", json!(url))]))?;
            check_response(&resp, "navigate")?;
            Ok(())
        })
    }

    /// Execute JavaScript on the page and return the result.
    pub fn evaluate(&self, script: &str) -> Result<String, DaemonError> {
        self.with_connection(|stream| {
            let resp = send_command(
                stream,
                &cmd("1", "evaluate", vec![("script", json!(script))]),
            )?;
            let data = check_response(&resp, "evaluate")?;
            let result = data
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(result)
        })
    }

    /// Click an element by selector.
    pub fn click(&self, selector: &str) -> Result<(), DaemonError> {
        self.with_connection(|stream| {
            let resp = send_command(
                stream,
                &cmd("1", "click", vec![("selector", json!(selector))]),
            )?;
            check_response(&resp, "click")?;
            Ok(())
        })
    }

    /// Type text into an element using real keystrokes (Input.dispatchKeyEvent).
    /// This is the key method that works with Lexical editors where paste events fail.
    pub fn type_into(&self, selector: &str, text: &str) -> Result<(), DaemonError> {
        self.with_connection(|stream| {
            let resp = send_command(
                stream,
                &cmd(
                    "1",
                    "type",
                    vec![
                        ("selector", json!(selector)),
                        ("text", json!(text)),
                        ("delay", json!(5)), // 5ms between keystrokes
                    ],
                ),
            )?;
            check_response(&resp, "type")?;
            Ok(())
        })
    }

    /// Clear and fill an input field.
    pub fn fill(&self, selector: &str, value: &str) -> Result<(), DaemonError> {
        self.with_connection(|stream| {
            let resp = send_command(
                stream,
                &cmd(
                    "1",
                    "fill",
                    vec![("selector", json!(selector)), ("value", json!(value))],
                ),
            )?;
            check_response(&resp, "fill")?;
            Ok(())
        })
    }

    /// Check if the current page is a Copilot page.
    pub fn is_copilot_page(&self) -> bool {
        match self.get_url() {
            Some(url) => url.contains("m365.cloud.microsoft/chat"),
            None => false,
        }
    }

    /// Check if the current page is a login page.
    pub fn is_login_page(&self) -> bool {
        match self.get_url() {
            Some(url) => {
                url.contains("login.microsoftonline.com")
                    || url.contains("login.live.com")
                    || url.contains("microsoft.com/fwlink")
            }
            None => false,
        }
    }

    /// Get the current URL.
    pub fn get_url(&self) -> Option<String> {
        self.with_connection(|stream| {
            let resp = send_command(stream, &cmd("1", "url", vec![]))?;
            let data = check_response(&resp, "url")?;
            Ok(data.get("url").and_then(|v| v.as_str()).map(String::from))
        })
        .ok()
        .flatten()
    }

    /// Check copilot status.
    pub fn status(&self) -> CopilotStatusResponse {
        CopilotStatusResponse {
            connected: self.browser_ready,
            login_required: self.is_login_page(),
        }
    }

    /// Close the browser and daemon.
    pub fn close(&mut self) {
        if let Err(e) = self.with_connection(|stream| {
            let resp = send_command(stream, &cmd("1", "close", vec![]))?;
            let _ = resp; // May not get response for close
            Ok(())
        }) {
            warn!("[agent-browser] close command failed: {e}");
        }
        self.browser_ready = false;
    }

    /// Send a prompt to Copilot and wait for response.
    pub fn send_prompt(
        &mut self,
        _system_prompt: &str,
        user_prompt: &str,
        _timeout_secs: u64,
    ) -> Result<String, DaemonError> {
        // Ensure browser is connected
        self.ensure_browser_connected()?;

        // Navigate to Copilot if not already there
        if !self.is_copilot_page() {
            info!("[agent-browser] navigating to Copilot URL...");
            self.navigate(COPILOT_URL)?;
            std::thread::sleep(std::time::Duration::from_secs(3));
        }

        // Check login state
        if self.is_login_page() {
            return Err(DaemonError::Command(
                "Copilot にログインしてください。Edge の画面を確認してください。".to_string(),
            ));
        }

        // Start new chat (click new chat button)
        info!("[agent-browser] starting new chat...");
        let _ = self.click("[data-testid='newChatButton']");
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Type the prompt using real keystrokes
        info!(
            "[agent-browser] typing prompt ({} chars)...",
            user_prompt.len()
        );
        self.type_into(INPUT_SELECTOR, user_prompt)?;
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Click send
        info!("[agent-browser] clicking send...");
        self.click(SEND_BUTTON_SELECTOR)?;

        // Wait for response
        self.wait_for_response()
    }

    /// Wait for Copilot to generate a response and extract the text.
    fn wait_for_response(&self) -> Result<String, DaemonError> {
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(RESPONSE_TIMEOUT_MS);

        // Wait for stop button to appear (generation started)
        info!("[agent-browser] waiting for response generation...");
        for _ in 0..60 {
            // 60 * 250ms = 15s max
            let script = format!(
                "const el = document.querySelector('{}'); el ? (el.offsetParent !== null) : false",
                STOP_BUTTON_SELECTOR.replace('\'', "\\'")
            );
            if let Ok(result) = self.evaluate(&script) {
                if result == "true" {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }

        // Wait for stop button to disappear (generation finished)
        while std::time::Instant::now() < deadline {
            let script = format!(
                "const el = document.querySelector('{}'); el ? (el.offsetParent !== null) : false",
                STOP_BUTTON_SELECTOR.replace('\'', "\\'")
            );
            let stop_visible = self.evaluate(&script).unwrap_or("false".to_string()) == "true";

            if !stop_visible {
                // Try to get response
                for selector in &[
                    "[data-testid='markdown-reply']",
                    "div[data-message-type='Chat']",
                    "article[data-message-author-role='assistant']",
                ] {
                    let script = format!(
                        "(() => {{
                            const el = document.querySelector('{}');
                            return el ? el.innerText : '';
                        }})()",
                        selector.replace('\'', "\\'")
                    );
                    if let Ok(text) = self.evaluate(&script) {
                        if !text.trim().is_empty() {
                            return Ok(text.trim().to_string());
                        }
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_secs(1));
        }

        // Timeout - return whatever we can find
        for selector in &[
            "[data-testid='markdown-reply']",
            "div[data-message-type='Chat']",
            "article[data-message-author-role='assistant']",
        ] {
            let script = format!(
                "const el = document.querySelector('{}'); el ? el.innerText : ''",
                selector.replace('\'', "\\'")
            );
            if let Ok(text) = self.evaluate(&script) {
                if !text.trim().is_empty() {
                    return Ok(text.trim().to_string());
                }
            }
        }

        Err(DaemonError::Command(
            "Copilot response not found in DOM".to_string(),
        ))
    }
}

/// Start the agent-browser daemon process.
fn start_daemon_process(session: &str) -> Result<(), DaemonError> {
    use std::process::{Command, Stdio};

    // Check if agent-browser is available
    let agent_browser = find_agent_browser_binary()?;

    info!(
        "[agent-browser] launching: {} daemon --session {}",
        agent_browser, session
    );

    let child = Command::new(&agent_browser)
        .args(["daemon", "--session", session])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| DaemonError::Command(format!("failed to start agent-browser daemon: {e}")))?;

    info!(
        "[agent-browser] daemon process spawned (pid: {})",
        child.id()
    );

    // Detach the process
    #[cfg(unix)]
    {
        // Let the daemon survive after parent exits
        std::mem::forget(child);
    }

    #[cfg(windows)]
    {
        // Windows: detach by letting the process run independently
        std::mem::forget(child);
    }

    Ok(())
}

/// Find the agent-browser binary.
fn find_agent_browser_binary() -> Result<String, DaemonError> {
    // First try: in PATH
    let candidates = if cfg!(windows) {
        vec!["agent-browser.exe", "agent-browser"]
    } else {
        vec!["agent-browser"]
    };

    for name in candidates {
        let result = Command::new(name).arg("--version").output();
        if let Ok(output) = result {
            if output.status.success() {
                return Ok(name.to_string());
            }
        }
    }

    Err(DaemonError::Command(
        "agent-browser not found in PATH. Run: npm install -g agent-browser && agent-browser install".to_string(),
    ))
}
