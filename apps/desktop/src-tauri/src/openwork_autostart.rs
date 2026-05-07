use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::app_services::{CopilotBridgeManager, CopilotServerState};
use crate::models::OpenWorkSetupSnapshot;
use crate::openwork_bootstrap::{
    bootstrap_cache_root, default_global_opencode_config_path,
    download_and_verify_artifact_with_progress, extract_zip_artifact, load_manifest,
    platform_artifact, probe_opencode_entrypoint, write_opencode_provider_config_file,
    BootstrapArtifactKey, BootstrapDownloadProgress,
};

const PROVIDER_PORT: u16 = 18180;
const EDGE_CDP_PORT: u16 = 9360;
const PLATFORM: &str = "windows-x64";
const OPENCODE_WEB_PORT_START: u16 = 4096;
const OPENCODE_WEB_PORT_END: u16 = 4127;
const PROGRESS_PROVIDER_GATEWAY: u8 = 8;
const PROGRESS_PROVIDER_CONFIG: u8 = 16;
const PROGRESS_DOWNLOAD_START: u8 = 24;
const PROGRESS_DOWNLOAD_END: u8 = 88;
const PROGRESS_EXTRACT: u8 = 91;
const PROGRESS_HANDOFF: u8 = 96;

#[derive(Debug, Clone)]
struct ProviderGatewayStart {
    token: String,
    base_url: String,
}

pub fn spawn(
    app: AppHandle,
    provider_bridge: Arc<CopilotBridgeManager>,
    status: Arc<Mutex<OpenWorkSetupSnapshot>>,
) {
    if std::env::var("RELAY_OPENWORK_AUTOSTART").as_deref() == Ok("0") {
        tracing::info!("[openwork-autostart] disabled by RELAY_OPENWORK_AUTOSTART=0");
        set_status(
            &status,
            OpenWorkSetupSnapshot::needs_attention(
                "Automatic OpenCode setup is disabled for diagnostics.",
            ),
        );
        return;
    }

    std::thread::spawn(move || {
        set_status(
            &status,
            OpenWorkSetupSnapshot::preparing_stage_progress(
                "setup",
                "Preparing OpenCode for M365 Copilot.",
                Some(2),
                Some("Starting the setup checks.".to_string()),
            ),
        );
        if let Err(error) = run(app, provider_bridge, Arc::clone(&status)) {
            tracing::warn!("[openwork-autostart] setup failed: {error}");
            set_status(&status, setup_attention_snapshot(&status, error));
        }
    });
}

pub fn open_prepared_opencode_web(
    app: &AppHandle,
    workspace: Option<PathBuf>,
) -> Result<(), String> {
    if cfg!(windows) {
        let app_local_data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("resolve app data dir: {error}"))?;
        let workspace = resolve_workspace_for_launch(Some(&app_local_data_dir), workspace)?;
        let path = find_cached_opencode_windows_executable(&app_local_data_dir)
            .ok_or_else(|| "OpenCode is not ready yet. Use Try Setup Again first.".to_string())?;
        spawn_opencode_web(&path, &workspace)?;
        return Ok(());
    }

    let workspace = resolve_workspace_for_launch(None, workspace)?;
    let mut command = std::process::Command::new("opencode");
    command
        .args(opencode_web_args(choose_opencode_web_port()?))
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if command.spawn().is_ok() {
        return Ok(());
    }
    Err("OpenCode is not installed or not on PATH yet.".to_string())
}

fn run(
    app: AppHandle,
    provider_bridge: Arc<CopilotBridgeManager>,
    status: Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<(), String> {
    tracing::info!("[openwork-autostart] starting OpenCode setup");
    set_status(
        &status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "provider_gateway",
            "Starting the local Copilot provider gateway.",
            Some(PROGRESS_PROVIDER_GATEWAY),
            Some("Starting Relay's local Copilot gateway.".to_string()),
        ),
    );
    let provider_gateway = ensure_provider_gateway(provider_bridge)?;
    set_status(
        &status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "provider_config",
            "Writing the OpenCode provider config.",
            Some(PROGRESS_PROVIDER_CONFIG),
            Some("Writing the OpenCode provider configuration.".to_string()),
        ),
    );
    let global_config = global_config_path()?;
    write_opencode_provider_config_file(
        &global_config,
        &provider_gateway.base_url,
        &provider_gateway.token,
    )
    .map_err(|error| format!("write global OpenCode config: {error}"))?;
    tracing::info!(
        "[openwork-autostart] installed global OpenCode provider config at {} with provider {}",
        global_config.display(),
        provider_gateway.base_url
    );

    if cfg!(windows) {
        run_windows_first_run(&app, &status)?;
    }

    let mut ready = OpenWorkSetupSnapshot::ready(
        "OpenCode Web is configured to use M365 Copilot without an admin install.",
        provider_gateway.base_url,
        global_config.display().to_string(),
    );
    ready.progress_detail =
        Some("Portable OpenCode is ready. Open OpenCode Web to start in your browser.".to_string());
    ready.action_label = Some("Open OpenCode Web".to_string());
    ready.launch_label = Some("Open OpenCode Web".to_string());
    set_status(&status, ready);
    Ok(())
}

fn ensure_provider_gateway(
    provider_bridge: Arc<CopilotBridgeManager>,
) -> Result<ProviderGatewayStart, String> {
    let server_arc = {
        let mut slot = provider_bridge.lock()?;
        if slot.is_none() {
            let edge_profile = crate::copilot_server::default_edge_profile_dir();
            let _ = std::fs::create_dir_all(&edge_profile);
            let server = crate::copilot_server::CopilotServer::new(
                PROVIDER_PORT,
                EDGE_CDP_PORT,
                Some(edge_profile),
                None,
            )
            .map(crate::copilot_server::CopilotServer::with_orphan_node_port_range_reclaim)
            .map_err(|error| format!("provider gateway init failed: {error}"))?;
            let arc = Arc::new(Mutex::new(server));
            *slot = Some(CopilotServerState {
                server: Arc::clone(&arc),
                started: false,
            });
        }

        Arc::clone(
            &slot
                .as_ref()
                .expect("provider gateway slot just populated")
                .server,
        )
    };

    {
        let mut slot = provider_bridge.lock()?;
        let state = slot
            .as_mut()
            .expect("provider gateway slot must exist after init");
        if !state.started {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| format!("provider gateway runtime init failed: {error}"))?;
            let start_result = {
                let mut server = state
                    .server
                    .lock()
                    .map_err(|error| format!("provider gateway mutex poisoned: {error}"))?;
                runtime.block_on(server.start())
            };
            if let Err(error) = start_result {
                if let Ok(mut server) = state.server.lock() {
                    server.stop();
                }
                *slot = None;
                return Err(format!("provider gateway start failed: {error}"));
            }
            state.started = true;
        }
    }

    let server = server_arc
        .lock()
        .map_err(|error| format!("provider gateway mutex poisoned: {error}"))?;
    let token = server
        .boot_token()
        .map(str::to_string)
        .ok_or_else(|| "provider gateway did not expose a boot token".to_string())?;
    Ok(ProviderGatewayStart {
        token,
        base_url: server.openai_base_url(),
    })
}

fn run_windows_first_run(
    app: &AppHandle,
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<(), String> {
    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage(
            "download_opencode",
            "Downloading and verifying OpenCode.",
        ),
    );
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    let cache_root = bootstrap_cache_root(&app_local_data_dir);
    let manifest = load_manifest().map_err(|error| format!("load bootstrap manifest: {error}"))?;

    let opencode = platform_artifact(&manifest, PLATFORM, BootstrapArtifactKey::OpenCodeCli)
        .map_err(|error| format!("select OpenCode artifact: {error}"))?;
    let total_download_bytes = opencode.size.max(1);
    download_and_verify_artifact_with_progress(
        &cache_root,
        PLATFORM,
        BootstrapArtifactKey::OpenCodeCli,
        opencode,
        |progress| {
            set_download_progress_status(
                status,
                progress.downloaded_bytes,
                total_download_bytes,
                &progress,
            );
        },
    )
    .map_err(|error| format!("download OpenCode: {error}"))?;
    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "download_opencode",
            "Extracting and checking OpenCode.",
            Some(PROGRESS_EXTRACT),
            Some("OpenCode is downloaded. Checking the command now.".to_string()),
        ),
    );
    let extracted = extract_zip_artifact(
        &cache_root,
        PLATFORM,
        BootstrapArtifactKey::OpenCodeCli,
        opencode,
    )
    .map_err(|error| format!("extract OpenCode: {error}"))?;
    let version = probe_opencode_entrypoint(&extracted.entrypoint_path)
        .map_err(|error| format!("probe OpenCode: {error}"))?;
    tracing::info!("[openwork-autostart] OpenCode ready: {version}");

    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "opencode_web",
            "Preparing OpenCode Web.",
            Some(PROGRESS_HANDOFF),
            Some("OpenCode is ready. No installer or admin approval is required.".to_string()),
        ),
    );
    let workspace = resolve_workspace_for_launch(Some(&app_local_data_dir), None)?;
    std::fs::create_dir_all(&workspace).map_err(|error| {
        format!(
            "create OpenCode workspace at {}: {error}",
            workspace.display()
        )
    })?;
    Ok(())
}

fn set_download_progress_status(
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
    downloaded_bytes: u64,
    total_download_bytes: u64,
    progress: &BootstrapDownloadProgress,
) {
    let setup_percent = setup_download_percent(downloaded_bytes, total_download_bytes);
    let action = if progress.reused {
        "Using cached"
    } else {
        "Downloading"
    };
    let detail = format!(
        "{action} {}: {} of {}.",
        progress.artifact_name,
        human_bytes(progress.downloaded_bytes),
        human_bytes(progress.total_bytes)
    );
    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "download_opencode",
            "Downloading and verifying OpenCode.",
            Some(setup_percent),
            Some(detail),
        ),
    );
}

fn setup_download_percent(downloaded_bytes: u64, total_download_bytes: u64) -> u8 {
    let span = PROGRESS_DOWNLOAD_END.saturating_sub(PROGRESS_DOWNLOAD_START) as u64;
    if total_download_bytes == 0 {
        return PROGRESS_DOWNLOAD_END;
    }
    let ratio = downloaded_bytes
        .min(total_download_bytes)
        .saturating_mul(span)
        / total_download_bytes;
    PROGRESS_DOWNLOAD_START.saturating_add(ratio as u8)
}

fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.1} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.1} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn set_status(status: &Arc<Mutex<OpenWorkSetupSnapshot>>, snapshot: OpenWorkSetupSnapshot) {
    if let Ok(mut current) = status.lock() {
        *current = snapshot;
    }
}

fn setup_attention_snapshot(
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
    error: String,
) -> OpenWorkSetupSnapshot {
    let current = status.lock().ok().map(|snapshot| snapshot.clone());
    let stage = current
        .as_ref()
        .map(|snapshot| snapshot.stage.as_str())
        .filter(|stage| !stage.is_empty() && *stage != "ready")
        .unwrap_or("setup")
        .to_string();
    let progress_percent = current.and_then(|snapshot| snapshot.progress_percent);
    let message = format!("OpenCode setup needs attention: {error}");
    OpenWorkSetupSnapshot::needs_attention_stage_progress(
        stage.clone(),
        message,
        progress_percent,
        Some(setup_attention_detail(&stage, &error)),
    )
}

fn setup_attention_detail(stage: &str, error: &str) -> String {
    match stage {
        "provider_gateway" => provider_gateway_attention_detail(error),
        "provider_config" => format!(
            "Relay could not write the OpenCode provider config. Check file permissions and try setup again. Detail: {error}"
        ),
        "download_opencode" => format!(
            "Relay could not download or verify OpenCode. Relay retries downloads automatically, but GitHub release downloads may still be blocked by a proxy, VPN, firewall, or TLS inspection. Check the network connection and try setup again. Detail: {error}"
        ),
        "opencode_web" => format!(
            "Relay prepared OpenCode but could not finish the Web launch setup. Try setup again, then use Open OpenCode Web. Detail: {error}"
        ),
        _ => format!("Relay could not finish setup. Try setup again. Detail: {error}"),
    }
}

fn provider_gateway_attention_detail(error: &str) -> String {
    let lower = error.to_lowercase();
    let hint = if lower.contains("copilot_server.js not found") {
        "Relay could not find the bundled Copilot gateway file. Reinstall Relay from the latest installer, then try setup again."
    } else if lower.contains("node.js not found") || lower.contains("bundled relay-node") {
        "Relay could not find its bundled Node runtime. Reinstall Relay from the latest installer, then try setup again."
    } else if lower.contains("dynamic os-assigned port fallback")
        || lower.contains("last startup failure")
    {
        "Relay's local Copilot gateway process could not stay running. Reinstall Relay from the latest installer, then try setup again. If it repeats, export diagnostics from Settings for support."
    } else if lower.contains("could not bind on ports") || lower.contains("orphan node.exe") {
        "All local provider gateway ports are busy. Relay tried to clean up old gateway processes automatically. Close other Relay windows, then try setup again."
    } else {
        "Relay could not start the local Copilot gateway. Try setup again; if it repeats, close other Relay windows and restart Relay."
    };
    format!("{hint} Detail: {error}")
}

fn global_config_path() -> Result<PathBuf, String> {
    std::env::var_os("RELAY_OPENCODE_GLOBAL_CONFIG")
        .map(PathBuf::from)
        .or_else(|| default_home_dir().map(|home| default_global_opencode_config_path(&home)))
        .ok_or_else(|| "could not resolve home directory for global OpenCode config".to_string())
}

fn default_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn spawn_opencode_web(path: &Path, workspace: &Path) -> Result<(), String> {
    let port = choose_opencode_web_port()?;
    std::fs::create_dir_all(workspace).map_err(|error| {
        format!(
            "create OpenCode workspace at {}: {error}",
            workspace.display()
        )
    })?;
    let mut command = std::process::Command::new(path);
    command
        .args(opencode_web_args(port))
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    command
        .spawn()
        .map_err(|error| format!("open OpenCode Web at {}: {error}", path.display()))?;
    Ok(())
}

fn opencode_web_args(port: u16) -> [String; 5] {
    [
        "web".to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ]
}

fn choose_opencode_web_port() -> Result<u16, String> {
    for port in OPENCODE_WEB_PORT_START..=OPENCODE_WEB_PORT_END {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("find OpenCode Web port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("read OpenCode Web port: {error}"))
}

fn resolve_workspace_for_launch(
    app_local_data_dir: Option<&Path>,
    workspace: Option<PathBuf>,
) -> Result<PathBuf, String> {
    if let Some(path) = workspace.filter(|path| !path.as_os_str().is_empty()) {
        return Ok(path);
    }
    if let Some(home) = default_home_dir() {
        return Ok(home.join("Relay Agent Workspace"));
    }
    app_local_data_dir
        .map(|path| path.join("workspace"))
        .ok_or_else(|| "could not resolve a workspace for OpenCode".to_string())
}

fn find_cached_opencode_windows_executable(app_local_data_dir: &Path) -> Option<PathBuf> {
    let root = bootstrap_cache_root(app_local_data_dir);
    let manifest = load_manifest().ok()?;
    let opencode =
        platform_artifact(&manifest, PLATFORM, BootstrapArtifactKey::OpenCodeCli).ok()?;
    let path = crate::openwork_bootstrap::artifact_entrypoint_path(
        &root,
        PLATFORM,
        BootstrapArtifactKey::OpenCodeCli,
        opencode,
    )
    .ok()?;
    path.exists().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn global_config_uses_official_opencode_location() {
        assert_eq!(
            default_global_opencode_config_path(Path::new("/home/relay")),
            PathBuf::from("/home/relay/.config/opencode/opencode.json")
        );
    }

    #[test]
    fn provider_config_selects_relay_model_by_default() {
        let provider_base_url = "http://127.0.0.1:18180/v1";
        let config = crate::openwork_bootstrap::merge_opencode_provider_config(
            json!({}),
            provider_base_url,
            "token",
        );
        assert_eq!(config["model"], "relay-agent/m365-copilot");
        assert_eq!(
            config["provider"]["relay-agent"]["options"]["baseURL"],
            provider_base_url
        );
    }

    #[test]
    fn opencode_web_args_bind_localhost_with_explicit_port() {
        assert_eq!(
            opencode_web_args(4096),
            [
                "web".to_string(),
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                "4096".to_string()
            ]
        );
    }
}
