//! Reclaim `127.0.0.1` HTTP ports held by stray `copilot_server.js` processes before spawning a new one.

use std::env;
use std::process::Command;
use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::copilot_server::RELAY_COPILOT_SERVICE_NAME;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    status: String,
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    instance_id: Option<String>,
}

fn should_reclaim_listener(body: &HealthBody, expected_instance_id: &str) -> bool {
    body.status == "ok"
        && body.service.as_deref() == Some(RELAY_COPILOT_SERVICE_NAME)
        && body.instance_id.as_deref() != Some(expected_instance_id)
}

/// Probes `/health` on `port`. If a Relay-owned bridge is present but its `instanceId` does not
/// match `expected_instance_id`, terminates the process listening on that port (platform-specific).
///
/// Set `RELAY_COPILOT_RECLAIM_STALE_HTTP=0` to skip (e.g. shared-port debugging).
/// On Windows, **`RELAY_COPILOT_RECLAIM_NETSTAT=1`** enables a slow `netstat`/`taskkill` fallback after `PowerShell` (default off for faster startup).
pub(crate) async fn maybe_reclaim_stale_copilot_http_port(
    client: &Client,
    port: u16,
    expected_instance_id: &str,
) {
    if env::var("RELAY_COPILOT_RECLAIM_STALE_HTTP")
        .map(|v| v == "0")
        .unwrap_or(false)
    {
        return;
    }

    let url = format!("http://127.0.0.1:{port}/health");
    let Ok(response) = client
        .get(&url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
    else {
        return;
    };

    if !response.status().is_success() {
        return;
    }

    let body: HealthBody = match response.json().await {
        Ok(b) => b,
        Err(_) => return,
    };

    if !should_reclaim_listener(&body, expected_instance_id) {
        return;
    }

    warn!(
        "[copilot] reclaiming HTTP port {} (stale Relay bridge fingerprint on /health)",
        port
    );

    let port_task = port;
    match tokio::task::spawn_blocking(move || kill_process_listening_on_local_port(port_task)).await
    {
        Ok(Ok(())) => info!("[copilot] stale listener on port {} reclaimed", port),
        Ok(Err(e)) => warn!("[copilot] could not reclaim port {}: {}", port, e),
        Err(e) => warn!("[copilot] reclaim join error: {}", e),
    }

    sleep(Duration::from_millis(150)).await;
}

fn kill_process_listening_on_local_port(port: u16) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        kill_listen_port_windows(port)
    }
    #[cfg(unix)]
    {
        kill_listen_port_unix(port)
    }
    #[cfg(not(any(windows, unix)))]
    {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "port reclaim not implemented for this OS",
        ))
    }
}

#[cfg(windows)]
fn kill_listen_port_windows(port: u16) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let ps = format!(
        r#"Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort {} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }}"#,
        port
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    // Full `netstat` scan is slow on cold start; opt-in via env when Get-NetTCPConnection misses.
    let netstat_fallback = env::var("RELAY_COPILOT_RECLAIM_NETSTAT")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    if !netstat_fallback {
        return Ok(());
    }

    let output = Command::new("cmd")
        .args(["/C", "netstat", "-ano"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;

    if !output.status.success() {
        return Ok(());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!("127.0.0.1:{port}");
    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&needle) {
            continue;
        }
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn kill_listen_port_unix(port: u16) -> std::io::Result<()> {
    let tcp = format!("{port}/tcp");
    match Command::new("fuser").args(["-k", &tcp]).status() {
        Ok(st) => {
            if st.success() || st.code() == Some(1) {
                return Ok(());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }

    let iarg = format!("-iTCP:{port}");
    let output = match Command::new("lsof")
        .args(["-nP", "-sTCP:LISTEN", "-t", &iarg])
        .output()
    {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };

    if !output.status.success() {
        return Ok(());
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let pid = line.trim();
        if pid.is_empty() {
            continue;
        }
        let _ = Command::new("kill").args(["-9", pid]).status();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{should_reclaim_listener, HealthBody};
    use crate::copilot_server::RELAY_COPILOT_SERVICE_NAME;

    #[test]
    fn reclaim_requires_relay_service_and_mismatched_instance_id() {
        let relay_other_instance = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_COPILOT_SERVICE_NAME.into()),
            instance_id: Some("other-instance".into()),
        };
        assert!(should_reclaim_listener(
            &relay_other_instance,
            "expected-instance"
        ));

        let same_instance = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_COPILOT_SERVICE_NAME.into()),
            instance_id: Some("expected-instance".into()),
        };
        assert!(!should_reclaim_listener(
            &same_instance,
            "expected-instance"
        ));

        let foreign_service = HealthBody {
            status: "ok".into(),
            service: Some("other_service".into()),
            instance_id: Some("other-instance".into()),
        };
        assert!(!should_reclaim_listener(
            &foreign_service,
            "expected-instance"
        ));

        let missing_fingerprint = HealthBody {
            status: "ok".into(),
            service: None,
            instance_id: None,
        };
        assert!(!should_reclaim_listener(
            &missing_fingerprint,
            "expected-instance"
        ));
    }
}
