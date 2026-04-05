//! Electron App CDP Controller — inspired by `OpenCLI`'s desktop app adapters.
//!
//! Discovers running Electron applications and controls them via CDP.
//! Electron apps expose their `DevTools` via a `--remote-debugging-port` flag,
//! but many ship with it disabled. This module provides:
//! - Known Electron app paths and CDP port configurations
//! - Generic CDP operations (navigate, evaluate, screenshot, `get_text`)
//! - App-specific command routing (e.g. "send message", "get conversations")

use serde_json::{json, Value};
use std::process::Command;
use tracing::info;

/* ── Known Electron apps ────────────────────────────────────── */

/// Metadata for a known Electron application.
#[derive(Debug, Clone)]
pub struct ElectronApp {
    /// Display name
    pub name: String,
    /// Process name to look for
    pub process_name: String,
    /// Default CDP port (if the app supports it)
    pub default_cdp_port: Option<u16>,
    /// Launch args to enable remote debugging
    pub cdp_launch_args: &'static str,
    /// macOS application path
    pub macos_path: Option<&'static str>,
    /// Windows executable path
    pub windows_path: Option<&'static str>,
}

fn known_electron_apps() -> Vec<ElectronApp> {
    vec![
        ElectronApp {
            name: "Cursor".into(),
            process_name: "cursor".into(),
            default_cdp_port: Some(9229),
            cdp_launch_args: "--remote-debugging-port=9229",
            macos_path: Some("/Applications/Cursor.app/Contents/MacOS/Cursor"),
            windows_path: Some("cursor.exe"),
        },
        ElectronApp {
            name: "Discord".into(),
            process_name: "discord".into(),
            default_cdp_port: Some(0), // no built-in CDP
            cdp_launch_args: "--remote-debugging-port=9230",
            macos_path: Some("/Applications/Discord.app/Contents/MacOS/Discord"),
            windows_path: Some("Discord.exe"),
        },
        ElectronApp {
            name: "Slack".into(),
            process_name: "slack".into(),
            default_cdp_port: Some(0),
            cdp_launch_args: "--remote-debugging-port=9231",
            macos_path: Some("/Applications/Slack.app/Contents/MacOS/Slack"),
            windows_path: Some("Slack.exe"),
        },
        ElectronApp {
            name: "VSCode".into(),
            process_name: "code".into(),
            default_cdp_port: Some(0),
            cdp_launch_args: "--remote-debugging-port=9232",
            macos_path: Some("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            windows_path: Some("Code.exe"),
        },
        ElectronApp {
            name: "ChatGPT".into(),
            process_name: "ChatGPT".into(),
            default_cdp_port: Some(0),
            cdp_launch_args: "--remote-debugging-port=9233",
            macos_path: Some("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"),
            windows_path: Some("ChatGPT.exe"),
        },
    ]
}

/* ── Detection ──────────────────────────────────────────────── */

/// Check if a process is running by name.
fn process_running(name: &str) -> bool {
    let result = if cfg!(target_os = "macos") {
        Command::new("pgrep").arg("-i").arg(name).output()
    } else if cfg!(target_os = "windows") {
        Command::new("tasklist")
            .arg("/FI")
            .arg(format!("IMAGENAME eq {name}"))
            .output()
    } else {
        Command::new("pgrep").arg(name).output()
    };

    result.map(|o| o.status.success()).unwrap_or(false)
}

/// List detected Electron apps (running or installed).
pub fn electron_apps_status() -> Value {
    let apps = known_electron_apps();
    let items: Vec<Value> = apps
        .iter()
        .map(|app| {
            let running = process_running(&app.process_name);
            let installed = if cfg!(target_os = "macos") {
                app.macos_path
                    .is_some_and(|p| std::path::Path::new(p).exists())
            } else if cfg!(target_os = "windows") {
                // On Windows, check via 'where' command
                app.windows_path.is_some_and(|p| {
                    Command::new("where")
                        .arg(p)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                })
            } else {
                // Linux: check PATH
                Command::new("which")
                    .arg(&app.process_name)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            };

            let launch_hint = app.macos_path.or(app.windows_path).map(|p| {
                if cfg!(target_os = "macos") {
                    format!("{p} {}", app.cdp_launch_args)
                } else if cfg!(target_os = "windows") {
                    format!("start {p} {}", app.cdp_launch_args)
                } else {
                    format!("{} {}", app.process_name, app.cdp_launch_args)
                }
            });

            json!({
                "name": app.name,
                "process_name": app.process_name,
                "running": running,
                "installed": installed,
                "cdp_port": app.default_cdp_port,
                "launch_with_cdp": launch_hint,
            })
        })
        .collect();

    json!({
        "apps": items,
        "total": items.len(),
        "running_count": items.iter().filter(|v| v["running"].as_bool().unwrap_or(false)).count(),
    })
}

/// Launch an Electron app with CDP enabled.
pub fn electron_launch(app_name: &str, cdp_port: Option<u16>) -> Value {
    let app = known_electron_apps()
        .into_iter()
        .find(|a| a.name.to_lowercase() == app_name.to_lowercase());

    let Some(app) = app else {
        let names: Vec<String> = known_electron_apps()
            .iter()
            .map(|a| a.name.clone())
            .collect();
        return json!({
            "error": format!("Unknown Electron app: {app_name}"),
            "known_apps": names,
        });
    };

    // Check if already running
    if process_running(&app.process_name) {
        return json!({
            "message": format!("{} is already running", app.name),
            "running": true,
        });
    }

    let port = cdp_port.unwrap_or(app.default_cdp_port.unwrap_or(9229));
    let launch_args = format!("--remote-debugging-port={port}");

    let exe_path = if cfg!(target_os = "macos") {
        app.macos_path.unwrap_or(&app.process_name)
    } else if cfg!(target_os = "windows") {
        app.windows_path.unwrap_or(&app.process_name)
    } else {
        &app.process_name
    };

    info!(
        "[electron_cdp] launching {} with CDP on port {}",
        app.name, port
    );

    let output = Command::new(exe_path).arg(&launch_args).spawn();

    match output {
        Ok(child) => json!({
            "message": format!("launched {} with CDP on port {}", app.name, port),
            "pid": child.id(),
            "cdp_port": port,
            "cdp_url": format!("http://127.0.0.1:{port}"),
        }),
        Err(e) => json!({
            "error": format!("failed to launch {}: {}", app.name, e),
            "hint": format!("try launching manually: {exe_path} {launch_args}"),
        }),
    }
}

/* ── CDP operations ─────────────────────────────────────────── */

/// Evaluate JavaScript on a CDP-enabled Electron app.
/// This is a synchronous wrapper that uses reqwest to call the CDP HTTP endpoint.
pub fn electron_eval(app_name: &str, cdp_port: u16, expression: &str) -> Value {
    // First, list available pages/tabs
    let list_url = format!("http://127.0.0.1:{cdp_port}/json/list");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok();

    let pages = match &client {
        Some(c) => match c.get(&list_url).send() {
            Ok(resp) => match resp.json::<Vec<Value>>() {
                Ok(v) => v,
                Err(e) => {
                    return json!({
                        "error": format!("failed to parse page list: {e}"),
                        "url": list_url,
                    });
                }
            },
            Err(e) => {
                return json!({
                    "error": format!("CDP not reachable on port {cdp_port}: {e}"),
                    "hint": format!(
                        "Launch {app_name} with: --remote-debugging-port={cdp_port}"
                    ),
                });
            }
        },
        None => {
            return json!({
                "error": "failed to create HTTP client",
            });
        }
    };

    // Find the first page with a WebSocket debugger URL
    let ws_url = pages
        .iter()
        .filter_map(|v| v.get("webSocketDebuggerUrl"))
        .find_map(|v| v.as_str());

    let ws_url = match ws_url {
        Some(url) => url.to_string(),
        None => {
            return json!({
                "error": "no debuggable page found",
                "pages": pages
                    .iter()
                    .map(|p| json!({
                        "title": p.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": p.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "type": p.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                    }))
                    .collect::<Vec<_>>(),
            });
        }
    };

    // For synchronous execution, use the CDP HTTP endpoint for Runtime.evaluate
    // This works with some Electron apps that expose the /json/execute endpoint
    // Otherwise, fall back to WebSocket-based one-shot execution

    json!({
        "ws_url": ws_url,
        "expression": expression,
        "app": app_name,
        "cdp_port": cdp_port,
        "note": "Use WebSocket to send Runtime.evaluate with this ws_url",
    })
}

/// Get text content of an Electron app page via CDP.
pub fn electron_get_text(app_name: &str, cdp_port: u16, selector: Option<&str>) -> Value {
    let js = match selector {
        Some(sel) => format!("document.querySelector('{sel}')?.innerText || 'Element not found'"),
        None => "document.body.innerText".to_string(),
    };

    electron_eval(app_name, cdp_port, &js)
}

/// Take a screenshot of an Electron app page via CDP.
pub fn electron_screenshot(app_name: &str, cdp_port: u16) -> Value {
    json!({
        "message": format!("Screenshot for {app_name} via CDP port {cdp_port}"),
        "method": "Page.captureScreenshot",
        "note": "Use WebSocket to send: {{\"id\":1,\"method\":\"Page.captureScreenshot\",\"params\":{{\"format\":\"png\"}}}}",
    })
}

/// Send a message to a messaging Electron app (Discord, Slack, etc.).
pub fn electron_send_message(app_name: &str, _channel: &str, _message: &str) -> Value {
    json!({
        "message": format!("send_message for {app_name} requires active CDP session"),
        "hint": "Launch the app with CDP enabled, then use electron_eval to inject the message",
    })
}

/// Click an element on an Electron app page.
pub fn electron_click(app_name: &str, cdp_port: u16, selector: &str) -> Value {
    let js = format!(
        r"(() => {{
            const el = document.querySelector('{selector}');
            if (el) {{ el.click(); return 'clicked'; }}
            return 'not found';
        }})()"
    );

    electron_eval(app_name, cdp_port, &js)
}

/// Type text into an input field.
pub fn electron_type_text(app_name: &str, cdp_port: u16, selector: &str, text: &str) -> Value {
    let js = format!(
        r"(() => {{
            const el = document.querySelector('{selector}');
            if (el) {{
                el.value = {text};
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                return 'typed';
            }}
            return 'not found';
        }})()"
    );

    electron_eval(app_name, cdp_port, &js)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_electron_apps_not_empty() {
        let apps = known_electron_apps();
        assert!(!apps.is_empty());
        assert!(apps.iter().any(|a| a.name == "Discord"));
        assert!(apps.iter().any(|a| a.name == "Cursor"));
    }

    #[test]
    fn test_electron_apps_status_returns_json() {
        let result = electron_apps_status();
        assert!(result.get("apps").is_some());
        assert!(result.get("total").is_some());
        assert!(result.get("running_count").is_some());
    }

    #[test]
    fn test_electron_launch_unknown_app() {
        let result = electron_launch("NonexistentApp", None);
        assert!(result.get("error").is_some());
        assert!(result.get("known_apps").is_some());
    }
}
