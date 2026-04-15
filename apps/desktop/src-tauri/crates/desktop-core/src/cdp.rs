use serde_json::Value;
use std::path::{Path, PathBuf};

/// Same relative path as `copilot_server.js` `RELAY_CDP_PORT_MARKER` under the Edge profile dir.
pub const RELAY_CDP_PORT_MARKER: &str = ".relay-agent-cdp-port";

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
#[must_use]
pub fn read_devtools_active_port(profile_dir: &Path) -> Option<u16> {
    let path = profile_dir.join("DevToolsActivePort");
    let data = std::fs::read_to_string(&path).ok()?;
    let line = data.lines().next()?.trim();
    let port: u16 = line.parse().ok()?;
    (port > 0).then_some(port)
}

pub fn cdp_version_looks_like_edge(info: &Value) -> bool {
    let browser = info
        .get("Browser")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let user_agent = info
        .get("User-Agent")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let combined = format!("{browser} {user_agent}");
    if combined.contains("edg") || combined.contains("microsoft edge") {
        return true;
    }
    if combined.contains("google chrome") {
        return false;
    }
    !combined.contains("chrome/") || combined.contains("edg")
}

pub fn cdp_definitely_google_chrome_only(info: &Value) -> bool {
    let browser = info
        .get("Browser")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let user_agent = info
        .get("User-Agent")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let combined = format!("{browser} {user_agent}");
    if combined.contains("edg") || combined.contains("microsoft edge") {
        return false;
    }
    combined.contains("google chrome") || combined.contains("chrome/")
}

pub fn cdp_dedicated_relay_profile_ok(info: &Value) -> bool {
    if cdp_version_looks_like_edge(info) {
        return true;
    }
    info.get("webSocketDebuggerUrl")
        .and_then(Value::as_str)
        .is_some_and(|_| !cdp_definitely_google_chrome_only(info))
}

#[must_use]
pub fn read_relay_cdp_port_marker(profile_dir: &Path) -> Option<u16> {
    let path = profile_dir.join(RELAY_CDP_PORT_MARKER);
    let raw = std::fs::read_to_string(&path).ok()?;
    let n: u32 = raw.trim().parse().ok()?;
    (1..=65535)
        .contains(&n)
        .then(|| u16::try_from(n).ok())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_relay_cdp_port_marker_valid() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join(RELAY_CDP_PORT_MARKER), "9340\n").unwrap();
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

    #[test]
    fn cdp_version_edge_detection_prefers_edge_markers() {
        let info = json!({
            "Browser": "Chrome/136.0.0.0",
            "User-Agent": "Mozilla/5.0 Edg/136.0.0.0",
            "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/1"
        });
        assert!(cdp_version_looks_like_edge(&info));
        assert!(cdp_dedicated_relay_profile_ok(&info));
    }

    #[test]
    fn cdp_version_rejects_stock_google_chrome() {
        let info = json!({
            "Browser": "Google Chrome/136.0.0.0",
            "User-Agent": "Mozilla/5.0 Chrome/136.0.0.0",
            "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/1"
        });
        assert!(!cdp_version_looks_like_edge(&info));
        assert!(cdp_definitely_google_chrome_only(&info));
        assert!(!cdp_dedicated_relay_profile_ok(&info));
    }
}
