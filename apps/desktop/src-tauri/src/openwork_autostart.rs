use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::app_services::{CopilotBridgeManager, CopilotServerState};
use crate::models::OpenWorkSetupSnapshot;
use crate::openwork_bootstrap::{
    bootstrap_cache_root, default_global_opencode_config_path, download_and_verify_artifact,
    extract_zip_artifact, load_manifest, platform_artifact, probe_opencode_entrypoint,
    write_opencode_provider_config_file, BootstrapArtifactKey, BootstrapError,
};

const PROVIDER_PORT: u16 = 18180;
const EDGE_CDP_PORT: u16 = 9360;
const PROVIDER_BASE_URL: &str = "http://127.0.0.1:18180/v1";
const PLATFORM: &str = "windows-x64";

#[derive(Debug, Clone, PartialEq, Eq)]
enum WindowsLaunchTarget {
    Executable(PathBuf),
    Shortcut(PathBuf),
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
                "Automatic OpenWork/OpenCode setup is disabled for diagnostics.",
            ),
        );
        return;
    }

    std::thread::spawn(move || {
        set_status(
            &status,
            OpenWorkSetupSnapshot::preparing("Preparing OpenWork/OpenCode for M365 Copilot."),
        );
        if let Err(error) = run(app, provider_bridge, Arc::clone(&status)) {
            tracing::warn!("[openwork-autostart] setup failed: {error}");
            set_status(
                &status,
                OpenWorkSetupSnapshot::needs_attention(format!(
                    "OpenWork/OpenCode setup needs attention: {error}"
                )),
            );
        }
    });
}

pub fn open_openwork_or_opencode() -> Result<(), String> {
    if cfg!(windows) {
        if let Some(target) = find_openwork_windows_launch_target() {
            open_windows_launch_target(&target)?;
            return Ok(());
        }
        if let Some(path) = find_cached_opencode_windows_executable() {
            let mut command = std::process::Command::new(&path);
            command.arg("--help");
            crate::windows_command::no_console_window(&mut command);
            command
                .spawn()
                .map_err(|error| format!("open OpenCode at {}: {error}", path.display()))?;
            return Ok(());
        }
        return Err(
            "OpenWork is not installed yet. Approve the OpenWork installer, then try again."
                .to_string(),
        );
    }

    if std::process::Command::new("openwork").spawn().is_ok() {
        return Ok(());
    }
    if std::process::Command::new("opencode").spawn().is_ok() {
        return Ok(());
    }
    Err("OpenWork/OpenCode is not installed or not on PATH yet.".to_string())
}

fn open_windows_launch_target(target: &WindowsLaunchTarget) -> Result<(), String> {
    match target {
        WindowsLaunchTarget::Executable(path) => {
            let mut command = std::process::Command::new(path);
            crate::windows_command::no_console_window(&mut command);
            command
                .spawn()
                .map_err(|error| format!("open OpenWork at {}: {error}", path.display()))?;
        }
        WindowsLaunchTarget::Shortcut(path) => {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "start", ""]).arg(path);
            crate::windows_command::no_console_window(&mut command);
            command.spawn().map_err(|error| {
                format!("open OpenWork shortcut at {}: {error}", path.display())
            })?;
        }
    }
    Ok(())
}

fn run(
    app: AppHandle,
    provider_bridge: Arc<CopilotBridgeManager>,
    status: Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<(), String> {
    tracing::info!("[openwork-autostart] starting OpenWork/OpenCode setup");
    set_status(
        &status,
        OpenWorkSetupSnapshot::preparing("Starting the local Copilot provider gateway."),
    );
    let provider_token = ensure_provider_gateway(provider_bridge)?;
    set_status(
        &status,
        OpenWorkSetupSnapshot::preparing("Writing the OpenCode provider config."),
    );
    let global_config = global_config_path()?;
    write_opencode_provider_config_file(&global_config, PROVIDER_BASE_URL, &provider_token)
        .map_err(|error| format!("write global OpenCode config: {error}"))?;
    tracing::info!(
        "[openwork-autostart] installed global OpenCode provider config at {}",
        global_config.display()
    );

    if cfg!(windows) {
        run_windows_first_run(&app, &status)?;
    }

    set_status(
        &status,
        OpenWorkSetupSnapshot::ready(
            "OpenWork/OpenCode is configured to use M365 Copilot.",
            PROVIDER_BASE_URL,
            global_config.display().to_string(),
        ),
    );
    Ok(())
}

fn ensure_provider_gateway(provider_bridge: Arc<CopilotBridgeManager>) -> Result<String, String> {
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
    server
        .boot_token()
        .map(str::to_string)
        .ok_or_else(|| "provider gateway did not expose a boot token".to_string())
}

fn run_windows_first_run(
    app: &AppHandle,
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<(), String> {
    set_status(
        status,
        OpenWorkSetupSnapshot::preparing("Downloading and verifying OpenWork/OpenCode."),
    );
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    let cache_root = bootstrap_cache_root(&app_local_data_dir);
    let manifest = load_manifest().map_err(|error| format!("load bootstrap manifest: {error}"))?;

    let opencode = platform_artifact(&manifest, PLATFORM, BootstrapArtifactKey::OpenCodeCli)
        .map_err(|error| format!("select OpenCode artifact: {error}"))?;
    download_and_verify_artifact(
        &cache_root,
        PLATFORM,
        BootstrapArtifactKey::OpenCodeCli,
        opencode,
    )
    .map_err(|error| format!("download OpenCode: {error}"))?;
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
        OpenWorkSetupSnapshot::preparing("Preparing the OpenWork installer handoff."),
    );
    let openwork = platform_artifact(&manifest, PLATFORM, BootstrapArtifactKey::OpenWorkDesktop)
        .map_err(|error| format!("select OpenWork artifact: {error}"))?;
    let verified = download_and_verify_artifact(
        &cache_root,
        PLATFORM,
        BootstrapArtifactKey::OpenWorkDesktop,
        openwork,
    )
    .map_err(|error| format!("download OpenWork: {error}"))?;

    open_openwork_installer_once(&app_local_data_dir, &verified.path, &openwork.version)
        .map_err(|error| format!("open OpenWork installer: {error}"))?;
    Ok(())
}

fn set_status(status: &Arc<Mutex<OpenWorkSetupSnapshot>>, snapshot: OpenWorkSetupSnapshot) {
    if let Ok(mut current) = status.lock() {
        *current = snapshot;
    }
}

fn open_openwork_installer_once(
    app_local_data_dir: &Path,
    installer_path: &Path,
    version: &str,
) -> Result<(), BootstrapError> {
    let stamp = app_local_data_dir.join(format!("openwork-installer-opened-{version}.stamp"));
    if stamp.exists() {
        tracing::info!(
            "[openwork-autostart] OpenWork installer handoff already recorded at {}",
            stamp.display()
        );
        return Ok(());
    }
    open_openwork_installer(installer_path)?;
    std::fs::write(&stamp, installer_path.display().to_string()).map_err(|source| {
        BootstrapError::Io {
            path: stamp,
            source,
        }
    })?;
    Ok(())
}

fn open_openwork_installer(path: &Path) -> Result<u32, BootstrapError> {
    if !cfg!(windows) {
        return Err(BootstrapError::UnsupportedPlatform(
            "openwork_installer_handoff_requires_windows".to_string(),
        ));
    }
    let mut command = std::process::Command::new("msiexec");
    command.arg("/i").arg(path);
    crate::windows_command::no_console_window(&mut command);
    let child = command.spawn().map_err(|error| BootstrapError::Command {
        path: PathBuf::from("msiexec"),
        message: error.to_string(),
    })?;
    Ok(child.id())
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

fn find_openwork_windows_launch_target() -> Option<WindowsLaunchTarget> {
    find_openwork_windows_shortcut()
        .map(WindowsLaunchTarget::Shortcut)
        .or_else(|| find_openwork_windows_executable().map(WindowsLaunchTarget::Executable))
}

fn find_openwork_windows_executable() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        std::env::var_os("PROGRAMFILES").map(PathBuf::from),
        std::env::var_os("PROGRAMFILES(X86)").map(PathBuf::from),
    ];
    let relative = [
        PathBuf::from("OpenWork").join("OpenWork.exe"),
        PathBuf::from("OpenWork Desktop").join("OpenWork.exe"),
        PathBuf::from("Programs")
            .join("OpenWork")
            .join("OpenWork.exe"),
    ];
    candidates
        .into_iter()
        .flatten()
        .flat_map(|root| relative.iter().map(move |path| root.join(path)))
        .find(|path| path.exists())
}

fn find_openwork_windows_shortcut() -> Option<PathBuf> {
    openwork_start_menu_roots()
        .into_iter()
        .find_map(find_openwork_shortcut_under)
}

fn openwork_start_menu_roots() -> Vec<PathBuf> {
    [
        std::env::var_os("APPDATA").map(PathBuf::from),
        std::env::var_os("PROGRAMDATA").map(PathBuf::from),
    ]
    .into_iter()
    .flatten()
    .map(|root| {
        root.join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
    })
    .collect()
}

fn find_openwork_shortcut_under(root: PathBuf) -> Option<PathBuf> {
    for relative in [
        PathBuf::from("OpenWork.lnk"),
        PathBuf::from("OpenWork Desktop.lnk"),
        PathBuf::from("OpenWork").join("OpenWork.lnk"),
        PathBuf::from("OpenWork Desktop").join("OpenWork.lnk"),
    ] {
        let candidate = root.join(relative);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    find_openwork_shortcut_recursive(&root, 0)
}

fn find_openwork_shortcut_recursive(dir: &Path, depth: usize) -> Option<PathBuf> {
    if depth > 3 {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_openwork_shortcut(&path) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_openwork_shortcut_recursive(&path, depth + 1) {
                return Some(found);
            }
        }
    }
    None
}

fn is_openwork_shortcut(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let lower = file_name.to_ascii_lowercase();
    lower.ends_with(".lnk") && lower.contains("openwork")
}

fn find_cached_opencode_windows_executable() -> Option<PathBuf> {
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| bootstrap_cache_root(&path.join("com.relayagent.desktop")))?;
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
        let config = crate::openwork_bootstrap::merge_opencode_provider_config(
            json!({}),
            PROVIDER_BASE_URL,
            "token",
        );
        assert_eq!(config["model"], "relay-agent/m365-copilot");
        assert_eq!(
            config["provider"]["relay-agent"]["options"]["baseURL"],
            PROVIDER_BASE_URL
        );
    }

    #[test]
    fn openwork_windows_candidates_include_common_install_paths() {
        let local = PathBuf::from(r"C:\Users\relay\AppData\Local")
            .join("Programs")
            .join("OpenWork")
            .join("OpenWork.exe");
        assert!(local.ends_with(Path::new("Programs").join("OpenWork").join("OpenWork.exe")));
    }

    #[test]
    fn openwork_shortcut_detection_matches_lnk_names() {
        assert!(is_openwork_shortcut(Path::new("OpenWork.lnk")));
        assert!(is_openwork_shortcut(Path::new("OpenWork Desktop.lnk")));
        assert!(!is_openwork_shortcut(Path::new("OpenCode.lnk")));
        assert!(!is_openwork_shortcut(Path::new("OpenWork.exe")));
    }

    #[test]
    fn explicit_openwork_shortcut_is_found_before_recursive_scan() {
        let temp = tempfile::tempdir().expect("tempdir");
        let shortcut = temp.path().join("OpenWork").join("OpenWork.lnk");
        std::fs::create_dir_all(shortcut.parent().expect("parent")).expect("mkdir");
        std::fs::write(&shortcut, b"shortcut").expect("shortcut");
        assert_eq!(
            find_openwork_shortcut_under(temp.path().to_path_buf()),
            Some(shortcut)
        );
    }
}
