use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

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
const RELAY_WEB_PORT_START: u16 = 4128;
const RELAY_WEB_PORT_END: u16 = 4159;
const PROGRESS_PROVIDER_GATEWAY: u8 = 8;
const PROGRESS_PROVIDER_CONFIG: u8 = 16;
const PROGRESS_PROVIDER_WARMUP: u8 = 22;
const PROGRESS_DOWNLOAD_START: u8 = 28;
const PROGRESS_DOWNLOAD_END: u8 = 88;
const PROGRESS_EXTRACT: u8 = 91;
const PROGRESS_HANDOFF: u8 = 96;
const PROGRESS_WEB_LAUNCH: u8 = 98;
const PROVIDER_WARMUP_TIMEOUT_SECS: u64 = 120;
const RELAY_AGENT_WEB_TITLE: &str = "Relay Agent";
const RELAY_AGENT_FAVICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

static OPENCODE_WEB_AUTOLAUNCHED: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct ProviderGatewayStart {
    token: String,
    base_url: String,
    server: Arc<Mutex<crate::copilot_server::CopilotServer>>,
}

#[derive(Debug, Clone)]
struct OpenCodeWebLaunch {
    executable: PathBuf,
    workspace: PathBuf,
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
        spawn_relay_agent_web(&path, &workspace)?;
        return Ok(());
    }

    let workspace = resolve_workspace_for_launch(None, workspace)?;
    spawn_relay_agent_web(Path::new("opencode"), &workspace)
        .map_err(|error| format!("{error}; OpenCode must be installed and available on PATH"))
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
    warm_provider_gateway(&provider_gateway, &status)?;

    let mut auto_launched = false;
    if cfg!(windows) {
        let launch = run_windows_first_run(&app, &status)?;
        auto_launched = auto_launch_opencode_web_once(&launch, &status)?;
    }

    let mut ready = OpenWorkSetupSnapshot::ready(
        "OpenCode Web is configured to use M365 Copilot without an admin install.",
        provider_gateway.base_url,
        global_config.display().to_string(),
    );
    ready.progress_detail = Some(if auto_launched {
        "Relay Agent Web opened in your browser. It is powered by OpenCode.".to_string()
    } else {
        "Portable OpenCode is ready. Open Relay Agent Web to start in your browser.".to_string()
    });
    ready.action_label = Some("Open Relay Agent Web".to_string());
    ready.launch_label = Some("Open Relay Agent Web".to_string());
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

    let (token, base_url) = {
        let server = server_arc
            .lock()
            .map_err(|error| format!("provider gateway mutex poisoned: {error}"))?;
        let token = server
            .boot_token()
            .map(str::to_string)
            .ok_or_else(|| "provider gateway did not expose a boot token".to_string())?;
        (token, server.openai_base_url())
    };
    Ok(ProviderGatewayStart {
        token,
        base_url,
        server: server_arc,
    })
}

fn run_windows_first_run(
    app: &AppHandle,
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<OpenCodeWebLaunch, String> {
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
    Ok(OpenCodeWebLaunch {
        executable: extracted.entrypoint_path,
        workspace,
    })
}

fn warm_provider_gateway(
    provider_gateway: &ProviderGatewayStart,
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<(), String> {
    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "provider_warmup",
            "Connecting to Microsoft 365 Copilot.",
            Some(PROGRESS_PROVIDER_WARMUP),
            Some(
                "Preparing the Copilot connection before Relay Agent Web opens. This can take a moment on first launch."
                    .to_string(),
            ),
        ),
    );

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("provider warmup runtime init failed: {error}"))?;
    let mut server = provider_gateway
        .server
        .lock()
        .map_err(|error| format!("provider gateway mutex poisoned: {error}"))?;

    match runtime.block_on(server.status_with_timeout_detailed(PROVIDER_WARMUP_TIMEOUT_SECS)) {
        Ok(response) if response.connected => {
            tracing::info!("[openwork-autostart] provider gateway warmed successfully");
            Ok(())
        }
        Ok(response) if response.login_required => Err(format!(
            "m365 copilot sign-in required{}",
            response
                .url
                .as_deref()
                .map(|url| format!(" at {url}"))
                .unwrap_or_default()
        )),
        Ok(response) => Err(response
            .error
            .unwrap_or_else(|| "m365 copilot did not report a ready connection".to_string())),
        Err(crate::copilot_server::CopilotStatusCheckError::Http(error))
            if error.error_code.as_deref() == Some("login_required") =>
        {
            Err(error
                .message
                .unwrap_or_else(|| "m365 copilot sign-in required".to_string()))
        }
        Err(crate::copilot_server::CopilotStatusCheckError::Http(error)) => {
            Err(error.message.or(error.error_code).unwrap_or_else(|| {
                format!("provider warmup status failed with HTTP {}", error.status)
            }))
        }
        Err(crate::copilot_server::CopilotStatusCheckError::Transport(error)) => {
            Err(format!("provider warmup failed: {error}"))
        }
    }
}

fn auto_launch_opencode_web_once(
    launch: &OpenCodeWebLaunch,
    status: &Arc<Mutex<OpenWorkSetupSnapshot>>,
) -> Result<bool, String> {
    if OPENCODE_WEB_AUTOLAUNCHED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        tracing::info!("[openwork-autostart] OpenCode Web auto-launch already attempted");
        return Ok(false);
    }

    set_status(
        status,
        OpenWorkSetupSnapshot::preparing_stage_progress(
            "opencode_web",
            "Opening Relay Agent Web.",
            Some(PROGRESS_WEB_LAUNCH),
            Some("Starting Relay Agent Web in your browser.".to_string()),
        ),
    );

    if let Err(error) = spawn_relay_agent_web(&launch.executable, &launch.workspace) {
        OPENCODE_WEB_AUTOLAUNCHED.store(false, Ordering::Release);
        return Err(format!("auto-launch Relay Agent Web: {error}"));
    }

    tracing::info!(
        "[openwork-autostart] OpenCode Web auto-launched from {}",
        launch.executable.display()
    );
    Ok(true)
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
        "provider_warmup" => format!(
            "Relay started the local provider, but Microsoft 365 Copilot was not ready yet. Sign in to Copilot if Edge asks, then use Try Setup Again. Detail: {error}"
        ),
        "download_opencode" => format!(
            "Relay could not download or verify OpenCode. Relay retries downloads automatically, but GitHub release downloads may still be blocked by a proxy, VPN, firewall, or TLS inspection. Check the network connection and try setup again. Detail: {error}"
        ),
        "opencode_web" => format!(
            "Relay prepared OpenCode but could not finish the browser launch setup. Try setup again, then use Open Relay Agent Web. Detail: {error}"
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

fn spawn_relay_agent_web(path: &Path, workspace: &Path) -> Result<(), String> {
    let port = choose_opencode_web_port()?;
    std::fs::create_dir_all(workspace).map_err(|error| {
        format!(
            "create OpenCode workspace at {}: {error}",
            workspace.display()
        )
    })?;
    let mut command = std::process::Command::new(path);
    command
        .args(opencode_serve_args(port))
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("start OpenCode server at {}: {error}", path.display()))?;
    wait_for_opencode_server_start(&mut child, port)?;
    let opencode_url = format!("http://127.0.0.1:{port}/");
    let relay_url = start_relay_agent_web_wrapper(&opencode_url)?;
    open_url_in_default_browser(&relay_url)?;
    Ok(())
}

fn opencode_serve_args(port: u16) -> [String; 5] {
    [
        "serve".to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ]
}

fn wait_for_opencode_server_start(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("check OpenCode server process: {error}"))?
        {
            return Err(format!(
                "OpenCode server exited before the browser opened: {status}"
            ));
        }
        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    tracing::warn!(
        "[openwork-autostart] OpenCode server did not accept TCP within 10s; opening Relay wrapper with retry UI"
    );
    Ok(())
}

fn start_relay_agent_web_wrapper(opencode_url: &str) -> Result<String, String> {
    let listener = bind_relay_agent_web_listener()?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("read Relay Agent Web wrapper port: {error}"))?
        .port();
    let target_url = opencode_url.to_string();
    std::thread::Builder::new()
        .name("relay-agent-web-wrapper".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if let Err(error) = handle_relay_agent_web_request(stream, &target_url) {
                            tracing::debug!(
                                "[openwork-autostart] Relay Agent Web wrapper request failed: {error}"
                            );
                        }
                    }
                    Err(error) => {
                        tracing::debug!(
                            "[openwork-autostart] Relay Agent Web wrapper accept failed: {error}"
                        );
                    }
                }
            }
        })
        .map_err(|error| format!("start Relay Agent Web wrapper: {error}"))?;
    Ok(format!("http://127.0.0.1:{port}/"))
}

fn bind_relay_agent_web_listener() -> Result<TcpListener, String> {
    for port in RELAY_WEB_PORT_START..=RELAY_WEB_PORT_END {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
    }
    TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("bind Relay Agent Web wrapper: {error}"))
}

fn handle_relay_agent_web_request(mut stream: TcpStream, opencode_url: &str) -> Result<(), String> {
    let mut buffer = [0_u8; 2048];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| format!("read wrapper request: {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    if path == "/favicon.png" {
        return write_http_response(stream, "200 OK", "image/png", RELAY_AGENT_FAVICON_PNG);
    }
    if path == "/health" {
        return write_http_response(stream, "200 OK", "text/plain; charset=utf-8", b"ok\n");
    }
    let html = relay_agent_web_wrapper_html(opencode_url);
    write_http_response(
        stream,
        "200 OK",
        "text/html; charset=utf-8",
        html.as_bytes(),
    )
}

fn write_http_response(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|error| format!("write wrapper response: {error}"))
}

fn relay_agent_web_wrapper_html(opencode_url: &str) -> String {
    let target = json_string_literal(opencode_url);
    format!(
        r##"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{RELAY_AGENT_WEB_TITLE}</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta name="theme-color" content="#111827" />
    <style>
      html, body {{ margin: 0; width: 100%; height: 100%; background: #111827; color: #f9fafb; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
      #status {{ position: fixed; inset: 0; display: grid; place-items: center; gap: 0.75rem; text-align: center; padding: 2rem; }}
      #status strong {{ display: block; font-size: 1rem; }}
      #status span {{ display: block; color: #cbd5e1; font-size: 0.875rem; }}
      #app {{ position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #111827; opacity: 0; transition: opacity 120ms ease; }}
      body.loaded #app {{ opacity: 1; }}
      body.loaded #status {{ display: none; }}
    </style>
  </head>
  <body>
    <div id="status" role="status" aria-live="polite">
      <div>
        <strong>Opening Relay Agent</strong>
        <span>Starting the OpenCode workspace.</span>
      </div>
    </div>
    <iframe id="app" title="Relay Agent workspace" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
    <script>
      const target = {target};
      const frame = document.getElementById("app");
      const statusText = document.querySelector("#status span");
      let loaded = false;
      frame.addEventListener("load", () => {{
        loaded = true;
        document.title = "Relay Agent";
        document.body.classList.add("loaded");
      }});
      async function openWhenReady(attempt) {{
        document.title = "Relay Agent";
        if (loaded) return;
        try {{
          await fetch(target, {{ mode: "no-cors", cache: "no-store" }});
          frame.src = target;
        }} catch {{
          const next = Math.min(5000, 700 + attempt * 300);
          statusText.textContent = "Starting the OpenCode workspace...";
          setTimeout(() => openWhenReady(attempt + 1), next);
        }}
      }}
      openWhenReady(0);
    </script>
  </body>
</html>
"##
    )
}

fn json_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    command
        .spawn()
        .map_err(|error| format!("open Relay Agent Web in browser: {error}"))?;
    Ok(())
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
    fn opencode_serve_args_bind_localhost_with_explicit_port() {
        assert_eq!(
            opencode_serve_args(4096),
            [
                "serve".to_string(),
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                "4096".to_string()
            ]
        );
    }

    #[test]
    fn relay_agent_web_wrapper_brands_browser_tab() {
        let html = relay_agent_web_wrapper_html("http://127.0.0.1:4096/");
        assert!(html.contains("<title>Relay Agent</title>"));
        assert!(html.contains(r#"<link rel="icon" type="image/png" href="/favicon.png" />"#));
        assert!(html.contains("Opening Relay Agent"));
        assert!(html.contains(r#"const target = "http://127.0.0.1:4096/";"#));
    }
}
