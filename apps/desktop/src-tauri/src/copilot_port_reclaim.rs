//! Reclaim `127.0.0.1` HTTP ports held by stray `copilot_server.js` processes before spawning a new one.

use std::env;
use std::process::Command;
use std::time::Duration;

use reqwest::Client;
use tokio::time::{sleep, timeout};
use tracing::{info, warn};

use crate::copilot_server::RELAY_COPILOT_SERVICE_NAME;
use desktop_core::copilot_port_reclaim::{should_reclaim_listener, HealthBody};

/// Upper bound on the full `/health` probe (connect + headers + body read). Reclaim runs on
/// startup, so this must never hang the app behind an unresponsive listener that happens to
/// hold `127.0.0.1:<port>` without replying.
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

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
    if env::var("RELAY_COPILOT_RECLAIM_STALE_HTTP").is_ok_and(|v| v == "0") {
        return;
    }

    let url = format!("http://127.0.0.1:{port}/health");
    // Wrap both the send() and body-parse phases in a single explicit deadline. The per-request
    // reqwest `.timeout()` normally covers both, but piggy-backing on it leaves the bound brittle
    // to client builder changes; the outer `timeout` guarantees the probe never exceeds
    // `HEALTH_PROBE_TIMEOUT` regardless of future client configuration.
    let probe = async {
        let response = client
            .get(&url)
            .timeout(HEALTH_PROBE_TIMEOUT)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json::<HealthBody>().await.ok()
    };

    let body = match timeout(HEALTH_PROBE_TIMEOUT, probe).await {
        Ok(Some(body)) => body,
        Ok(None) => return,
        Err(_) => {
            warn!(
                "[copilot] /health probe on port {} exceeded {}s; skipping reclaim",
                port,
                HEALTH_PROBE_TIMEOUT.as_secs()
            );
            return;
        }
    };

    if !should_reclaim_listener(&body, expected_instance_id, RELAY_COPILOT_SERVICE_NAME) {
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

/// Provider-gateway recovery path for installed Relay.
///
/// A previous app launch can leave `node.exe` / bundled `relay-node.exe` holding every
/// OpenAI-compatible provider port before the new instance has a chance to answer `/health`.
/// For the dedicated provider range only, reclaim listeners that are clearly Relay's
/// `copilot_server.js` process. Set `RELAY_COPILOT_RECLAIM_ORPHAN_NODE=0` to disable.
pub(crate) async fn maybe_reclaim_orphan_copilot_node_port_range(start_port: u16, end_port: u16) {
    if env::var("RELAY_COPILOT_RECLAIM_STALE_HTTP").is_ok_and(|v| v == "0")
        || env::var("RELAY_COPILOT_RECLAIM_ORPHAN_NODE").is_ok_and(|v| v == "0")
    {
        return;
    }

    let start = start_port.min(end_port);
    let end = start_port.max(end_port);
    let reclaim_task = tokio::task::spawn_blocking(move || {
        kill_orphan_copilot_node_listeners_in_range(start, end)
    });

    match reclaim_task.await {
        Ok(Ok(0)) => {}
        Ok(Ok(count)) => {
            warn!(
                "[copilot] reclaimed {} orphan Relay node listener(s) on ports {}-{}",
                count, start, end
            );
            sleep(Duration::from_millis(150)).await;
        }
        Ok(Err(error)) => warn!(
            "[copilot] orphan Relay node listener reclaim failed on ports {}-{}: {}",
            start, end, error
        ),
        Err(error) => warn!(
            "[copilot] orphan Relay node listener reclaim join error on ports {}-{}: {}",
            start, end, error
        ),
    }
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

fn kill_orphan_copilot_node_listeners_in_range(
    start_port: u16,
    end_port: u16,
) -> std::io::Result<usize> {
    #[cfg(windows)]
    {
        kill_orphan_copilot_node_listeners_windows(start_port, end_port)
    }
    #[cfg(unix)]
    {
        kill_orphan_copilot_node_listeners_unix(start_port, end_port)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (start_port, end_port);
        Ok(0)
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

#[cfg(windows)]
fn kill_orphan_copilot_node_listeners_windows(
    start_port: u16,
    end_port: u16,
) -> std::io::Result<usize> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let ps = format!(
        r#"
$start = {start_port}
$end = {end_port}
$connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -State Listen -ErrorAction SilentlyContinue |
  Where-Object {{ $_.LocalPort -ge $start -and $_.LocalPort -le $end }}
$owningPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($owningPid in $owningPids) {{
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $owningPid" -ErrorAction SilentlyContinue
  if ($null -eq $proc) {{ continue }}
  $name = [string]$proc.Name
  $cmd = [string]$proc.CommandLine
  $exe = [string]$proc.ExecutablePath
  $isNode = $name -ieq "node.exe" -or $name -ieq "relay-node.exe" -or $exe -match "\\(?:node|relay-node)\.exe$"
  $isRelayCopilot = $cmd -match "copilot_server\.js" -or $exe -match "\\relay-node\.exe$"
  if ($isNode -and $isRelayCopilot) {{
    Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
    Write-Output $owningPid
  }}
}}
"#,
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;

    if !output.status.success() {
        return Ok(0);
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count())
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

#[cfg(unix)]
fn kill_orphan_copilot_node_listeners_unix(
    start_port: u16,
    end_port: u16,
) -> std::io::Result<usize> {
    let mut killed = 0usize;
    for port in start_port..=end_port {
        let iarg = format!("-iTCP:{port}");
        let output = match Command::new("lsof")
            .args(["-nP", "-sTCP:LISTEN", "-t", &iarg])
            .output()
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(killed),
            Err(error) => return Err(error),
        };
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let pid = line.trim();
            if pid.is_empty() || !unix_process_looks_like_relay_copilot_node(pid) {
                continue;
            }
            let _ = Command::new("kill").args(["-9", pid]).status();
            killed += 1;
        }
    }
    Ok(killed)
}

#[cfg(unix)]
fn unix_process_looks_like_relay_copilot_node(pid: &str) -> bool {
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline"))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default()
        .replace('\0', " ");
    if cmdline.contains("copilot_server.js") {
        return true;
    }

    let exe = std::fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    exe.ends_with("/relay-node")
}
