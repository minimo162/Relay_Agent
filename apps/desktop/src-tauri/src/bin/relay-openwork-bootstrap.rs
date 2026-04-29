use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use relay_agent_desktop_lib::openwork_bootstrap::{
    artifact_cache_path, artifact_entrypoint_path, bootstrap_cache_root,
    download_and_verify_artifact, extract_zip_artifact, load_manifest, platform_artifact,
    probe_opencode_entrypoint, verify_cached_artifact, BootstrapArtifact, BootstrapArtifactKey,
    BootstrapError, ExtractedBootstrapArtifact, VerifiedBootstrapArtifact,
};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

const DEFAULT_PLATFORM: &str = "windows-x64";
const PROVIDER_MODEL: &str = "relay-agent/m365-copilot";
const PROVIDER_API_KEY_ENV: &str = "RELAY_AGENT_API_KEY";
const DEFAULT_PROVIDER_PORT: u16 = 18180;
const DEFAULT_EDGE_CDP_PORT: u16 = 9360;

#[derive(Debug)]
struct Options {
    platform: String,
    cache_root: Option<PathBuf>,
    app_local_data_dir: Option<PathBuf>,
    workspace: Option<PathBuf>,
    config_output: Option<PathBuf>,
    provider_port: u16,
    edge_cdp_port: u16,
    provider_token_file: Option<PathBuf>,
    copilot_server_js: Option<PathBuf>,
    start_provider_gateway: bool,
    download: bool,
    open_openwork_installer: bool,
    pretty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapReport {
    ok: bool,
    status: String,
    mode: String,
    platform: String,
    selected_track: String,
    cache_root: PathBuf,
    ownership_boundary: String,
    relay_boundary: &'static str,
    provider_handoff: ProviderHandoff,
    provider_gateway: ProviderGatewayReport,
    provider_config: Option<ProviderConfigReport>,
    openwork_installer_handoff: OpenWorkInstallerHandoffReport,
    artifacts: Vec<ArtifactReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderHandoff {
    base_url: String,
    model: &'static str,
    api_key_env: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactReport {
    artifact: String,
    name: String,
    version: String,
    kind: String,
    format: String,
    url: String,
    sha256: String,
    size: u64,
    install_mode: Option<String>,
    usage: Option<String>,
    expected_path: PathBuf,
    entrypoint_path: Option<PathBuf>,
    status: String,
    verified: Option<VerifiedBootstrapArtifact>,
    extracted: Option<ExtractedBootstrapArtifact>,
    opencode_version: Option<String>,
    error_code: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigReport {
    installed: bool,
    workspace: PathBuf,
    output: PathBuf,
    skipped_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderGatewayReport {
    requested: bool,
    running: bool,
    status: String,
    base_url: String,
    health_url: String,
    model: &'static str,
    token_source: PathBuf,
    process_id: Option<u32>,
    skipped_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenWorkInstallerHandoffReport {
    requested: bool,
    opened: bool,
    path: PathBuf,
    version: String,
    sha256: String,
    install_mode: Option<String>,
    command: Vec<String>,
    process_id: Option<u32>,
    skipped_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorReport {
    ok: bool,
    status: &'static str,
    error_code: &'static str,
    error: String,
}

fn main() -> ExitCode {
    match run() {
        Ok((report, pretty)) => {
            print_json(&report, pretty);
            ExitCode::SUCCESS
        }
        Err((error, pretty)) => {
            let report = ErrorReport {
                ok: false,
                status: "failed",
                error_code: error.code(),
                error: error.to_string(),
            };
            print_json(&report, pretty);
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(BootstrapReport, bool), (BootstrapError, bool)> {
    let options = match parse_options(env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{}", usage());
            return Err((
                BootstrapError::UnsupportedPlatform("invalid-arguments".to_string()),
                true,
            ));
        }
    };

    let manifest = load_manifest().map_err(|error| (error, options.pretty))?;
    let cache_root = resolve_cache_root(&options);
    let provider_base_url = provider_base_url(options.provider_port);
    let token_file = resolve_provider_token_file(&options);
    let keys = [
        BootstrapArtifactKey::OpenCodeCli,
        BootstrapArtifactKey::OpenWorkDesktop,
    ];
    let mut artifacts = Vec::with_capacity(keys.len());
    let mut all_verified = true;
    let mut opencode_probe_version = None;

    for key in keys {
        let artifact = platform_artifact(&manifest, &options.platform, key)
            .map_err(|error| (error, options.pretty))?;
        let report = inspect_artifact(
            &cache_root,
            &options.platform,
            key,
            artifact,
            options.download,
            options.workspace.is_some(),
        )
        .map_err(|error| (error, options.pretty))?;
        if report.verified.is_none() {
            all_verified = false;
        }
        if key == BootstrapArtifactKey::OpenCodeCli {
            opencode_probe_version = report.opencode_version.clone();
        }
        artifacts.push(report);
    }

    let provider_config = provider_config_report(
        &options,
        &provider_base_url,
        opencode_probe_version.as_deref(),
    )
    .map_err(|error| (error, options.pretty))?;
    let provider_gateway = provider_gateway_report(&options, &provider_base_url, &token_file)
        .map_err(|error| (error, options.pretty))?;
    let openwork_installer_handoff = openwork_installer_handoff_report(&options, &artifacts)
        .map_err(|error| (error, options.pretty))?;

    let status = if all_verified {
        "verified"
    } else if options.download {
        "failed"
    } else {
        "ready_for_download"
    };

    let report = BootstrapReport {
        ok: !options.download || all_verified,
        status: status.to_string(),
        mode: if options.download {
            "download_verify".to_string()
        } else {
            "preflight".to_string()
        },
        platform: options.platform,
        selected_track: manifest.selected_track,
        cache_root,
        ownership_boundary: manifest.ownership_boundary,
        relay_boundary:
            "Relay must remain a bootstrapper and provider gateway only; OpenWork/OpenCode own UX, sessions, tools, and execution.",
        provider_handoff: ProviderHandoff {
            base_url: provider_base_url,
            model: PROVIDER_MODEL,
            api_key_env: PROVIDER_API_KEY_ENV,
        },
        provider_gateway,
        provider_config,
        openwork_installer_handoff,
        artifacts,
    };

    if options.download && !all_verified {
        return Err((
            BootstrapError::UnsupportedPlatform("download_not_verified".to_string()),
            options.pretty,
        ));
    }

    Ok((report, options.pretty))
}

fn inspect_artifact(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
    download: bool,
    install_provider_config: bool,
) -> Result<ArtifactReport, BootstrapError> {
    let expected_path = artifact_cache_path(cache_root, platform, key, artifact)?;
    let entrypoint_path = if key == BootstrapArtifactKey::OpenCodeCli {
        Some(artifact_entrypoint_path(
            cache_root, platform, key, artifact,
        )?)
    } else {
        None
    };

    let verified = if download {
        Some(download_and_verify_artifact(
            cache_root, platform, key, artifact,
        )?)
    } else {
        verify_cached_artifact(cache_root, platform, key, artifact)?
    };

    let status = match &verified {
        Some(verified) if verified.reused => "cached",
        Some(_) => "downloaded",
        None => "missing",
    };
    let (extracted, opencode_version) =
        if key == BootstrapArtifactKey::OpenCodeCli && verified.is_some() {
            let extracted = extract_zip_artifact(cache_root, platform, key, artifact)?;
            let opencode_version = if install_provider_config {
                Some(probe_opencode_entrypoint(&extracted.entrypoint_path)?)
            } else {
                None
            };
            (Some(extracted), opencode_version)
        } else {
            (None, None)
        };

    Ok(ArtifactReport {
        artifact: key.as_str().to_string(),
        name: artifact.name.clone(),
        version: artifact.version.clone(),
        kind: artifact.kind.clone(),
        format: artifact.format.clone(),
        url: artifact.url.clone(),
        sha256: artifact.sha256.clone(),
        size: artifact.size,
        install_mode: artifact.install_mode.clone(),
        usage: artifact.usage.clone(),
        expected_path,
        entrypoint_path,
        status: status.to_string(),
        verified,
        extracted,
        opencode_version,
        error_code: None,
        error: None,
    })
}

fn provider_config_report(
    options: &Options,
    provider_base_url: &str,
    opencode_probe_version: Option<&str>,
) -> Result<Option<ProviderConfigReport>, BootstrapError> {
    let Some(workspace) = &options.workspace else {
        return Ok(None);
    };
    let output = options
        .config_output
        .clone()
        .unwrap_or_else(|| workspace.join("opencode.json"));

    if opencode_probe_version.is_none() {
        return Ok(Some(ProviderConfigReport {
            installed: false,
            workspace: workspace.clone(),
            output,
            skipped_reason: Some("opencode_cli_not_verified_extracted_or_probed".to_string()),
        }));
    }

    write_opencode_provider_config(workspace, &output, provider_base_url)?;
    Ok(Some(ProviderConfigReport {
        installed: true,
        workspace: workspace.clone(),
        output,
        skipped_reason: None,
    }))
}

fn openwork_installer_handoff_report(
    options: &Options,
    artifacts: &[ArtifactReport],
) -> Result<OpenWorkInstallerHandoffReport, BootstrapError> {
    let openwork = artifacts
        .iter()
        .find(|artifact| artifact.artifact == BootstrapArtifactKey::OpenWorkDesktop.as_str())
        .expect("OpenWork artifact report exists");
    let command = openwork_installer_command(&openwork.expected_path);

    if !options.open_openwork_installer {
        return Ok(OpenWorkInstallerHandoffReport {
            requested: false,
            opened: false,
            path: openwork.expected_path.clone(),
            version: openwork.version.clone(),
            sha256: openwork.sha256.clone(),
            install_mode: openwork.install_mode.clone(),
            command,
            process_id: None,
            skipped_reason: Some(
                "operator_approval_required_use_--open-openwork-installer".to_string(),
            ),
        });
    }

    if openwork.verified.is_none() {
        return Ok(OpenWorkInstallerHandoffReport {
            requested: true,
            opened: false,
            path: openwork.expected_path.clone(),
            version: openwork.version.clone(),
            sha256: openwork.sha256.clone(),
            install_mode: openwork.install_mode.clone(),
            command,
            process_id: None,
            skipped_reason: Some("openwork_desktop_msi_not_verified".to_string()),
        });
    }

    let process_id = open_openwork_installer(&openwork.expected_path)?;
    Ok(OpenWorkInstallerHandoffReport {
        requested: true,
        opened: true,
        path: openwork.expected_path.clone(),
        version: openwork.version.clone(),
        sha256: openwork.sha256.clone(),
        install_mode: openwork.install_mode.clone(),
        command,
        process_id: Some(process_id),
        skipped_reason: None,
    })
}

fn openwork_installer_command(path: &Path) -> Vec<String> {
    vec![
        "msiexec".to_string(),
        "/i".to_string(),
        path.display().to_string(),
    ]
}

fn open_openwork_installer(path: &Path) -> Result<u32, BootstrapError> {
    if !cfg!(windows) {
        return Err(BootstrapError::UnsupportedPlatform(
            "openwork_installer_handoff_requires_windows".to_string(),
        ));
    }
    let child = Command::new("msiexec")
        .arg("/i")
        .arg(path)
        .spawn()
        .map_err(|error| BootstrapError::Command {
            path: PathBuf::from("msiexec"),
            message: error.to_string(),
        })?;
    Ok(child.id())
}

fn write_opencode_provider_config(
    workspace: &Path,
    output: &Path,
    provider_base_url: &str,
) -> Result<(), BootstrapError> {
    let existing = if output.exists() {
        let raw = fs::read_to_string(output).map_err(|source| BootstrapError::Io {
            path: output.to_path_buf(),
            source,
        })?;
        if raw.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&raw)?
        }
    } else {
        json!({})
    };

    let merged = merge_opencode_config(existing, provider_base_url);
    fs::create_dir_all(workspace).map_err(|source| BootstrapError::Io {
        path: workspace.to_path_buf(),
        source,
    })?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|source| BootstrapError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    fs::write(
        output,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&merged).expect("provider config serializes")
        ),
    )
    .map_err(|source| BootstrapError::Io {
        path: output.to_path_buf(),
        source,
    })
}

fn merge_opencode_config(existing: Value, provider_base_url: &str) -> Value {
    let mut base = existing.as_object().cloned().unwrap_or_default();
    base.entry("$schema".to_string())
        .or_insert_with(|| Value::String("https://opencode.ai/config.json".to_string()));

    let mut enabled = base
        .get("enabled_providers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !enabled.iter().any(|value| value == "relay-agent") {
        enabled.push(Value::String("relay-agent".to_string()));
    }
    base.insert("enabled_providers".to_string(), Value::Array(enabled));

    let mut providers = base
        .get("provider")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    providers.insert(
        "relay-agent".to_string(),
        json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": "Relay Agent / M365 Copilot",
            "options": {
                "baseURL": provider_base_url,
                "apiKey": "{env:RELAY_AGENT_API_KEY}"
            },
            "models": {
                "m365-copilot": {
                    "name": "M365 Copilot",
                    "limit": {
                        "context": 128000,
                        "output": 8192
                    }
                }
            }
        }),
    );
    base.insert("provider".to_string(), Value::Object(providers));
    Value::Object(base)
}

fn provider_gateway_report(
    options: &Options,
    provider_base_url: &str,
    token_file: &Path,
) -> Result<ProviderGatewayReport, BootstrapError> {
    let health_url = format!("http://127.0.0.1:{}/health", options.provider_port);
    let already_running = gateway_health_ok(&health_url);
    if !options.start_provider_gateway {
        return Ok(ProviderGatewayReport {
            requested: false,
            running: already_running,
            status: if already_running {
                "already_running".to_string()
            } else {
                "not_requested".to_string()
            },
            base_url: provider_base_url.to_string(),
            health_url,
            model: PROVIDER_MODEL,
            token_source: token_file.to_path_buf(),
            process_id: None,
            skipped_reason: if already_running {
                None
            } else {
                Some("use_--start-provider-gateway".to_string())
            },
        });
    }

    let token = read_or_create_provider_token(token_file)?;
    if already_running {
        return Ok(ProviderGatewayReport {
            requested: true,
            running: true,
            status: "already_running".to_string(),
            base_url: provider_base_url.to_string(),
            health_url,
            model: PROVIDER_MODEL,
            token_source: token_file.to_path_buf(),
            process_id: None,
            skipped_reason: None,
        });
    }

    let script = resolve_copilot_server_js(options)?;
    let mut child = Command::new(node_bin())
        .arg("--no-warnings")
        .arg(&script)
        .arg("--port")
        .arg(options.provider_port.to_string())
        .arg("--cdp-port")
        .arg(options.edge_cdp_port.to_string())
        .arg("--boot-token")
        .arg(token)
        .arg("--instance-id")
        .arg(Uuid::new_v4().to_string())
        .env("RELAY_EDGE_CDP_PORT", options.edge_cdp_port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| BootstrapError::Command {
            path: script.clone(),
            message: error.to_string(),
        })?;
    let process_id = child.id();
    wait_for_gateway_health(&health_url, &mut child)?;

    Ok(ProviderGatewayReport {
        requested: true,
        running: true,
        status: "started".to_string(),
        base_url: provider_base_url.to_string(),
        health_url,
        model: PROVIDER_MODEL,
        token_source: token_file.to_path_buf(),
        process_id: Some(process_id),
        skipped_reason: None,
    })
}

fn provider_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1")
}

fn gateway_health_ok(health_url: &str) -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .and_then(|client| client.get(health_url).send())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn wait_for_gateway_health(
    health_url: &str,
    child: &mut std::process::Child,
) -> Result<(), BootstrapError> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if gateway_health_ok(health_url) {
            return Ok(());
        }
        if let Some(status) = child.try_wait().map_err(|error| BootstrapError::Command {
            path: PathBuf::from("copilot_server.js"),
            message: error.to_string(),
        })? {
            return Err(BootstrapError::Command {
                path: PathBuf::from("copilot_server.js"),
                message: format!("provider gateway exited before health check: {status}"),
            });
        }
        if Instant::now() >= deadline {
            return Err(BootstrapError::Command {
                path: PathBuf::from("copilot_server.js"),
                message: format!("provider gateway did not become healthy at {health_url}"),
            });
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn resolve_copilot_server_js(options: &Options) -> Result<PathBuf, BootstrapError> {
    let candidates = [
        options.copilot_server_js.clone(),
        env::var_os("RELAY_COPILOT_SERVER_JS").map(PathBuf::from),
        Some(PathBuf::from(
            "apps/desktop/src-tauri/binaries/copilot_server.js",
        )),
        Some(PathBuf::from("src-tauri/binaries/copilot_server.js")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(BootstrapError::Io {
        path: PathBuf::from("copilot_server.js"),
        source: io::Error::new(io::ErrorKind::NotFound, "copilot_server.js not found"),
    })
}

fn node_bin() -> String {
    env::var("NODE").unwrap_or_else(|_| "node".to_string())
}

fn resolve_provider_token_file(options: &Options) -> PathBuf {
    options
        .provider_token_file
        .clone()
        .or_else(|| env::var_os("RELAY_OPENCODE_PROVIDER_TOKEN_FILE").map(PathBuf::from))
        .unwrap_or_else(|| {
            default_home_dir()
                .join(".relay-agent")
                .join("opencode-provider-token")
        })
}

fn read_or_create_provider_token(path: &Path) -> Result<String, BootstrapError> {
    if let Ok(token) = env::var("RELAY_AGENT_API_KEY") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if path.exists() {
        let token = fs::read_to_string(path).map_err(|source| BootstrapError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| BootstrapError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let token = Uuid::new_v4().to_string();
    fs::write(path, format!("{token}\n")).map_err(|source| BootstrapError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

fn resolve_cache_root(options: &Options) -> PathBuf {
    if let Some(path) = &options.cache_root {
        return path.clone();
    }

    let app_local_data_dir = options
        .app_local_data_dir
        .clone()
        .or_else(|| env::var_os("RELAY_OPENWORK_BOOTSTRAP_APP_DATA").map(PathBuf::from))
        .unwrap_or_else(default_app_local_data_dir);
    bootstrap_cache_root(&app_local_data_dir)
}

fn default_app_local_data_dir() -> PathBuf {
    if cfg!(windows) {
        if let Some(path) = env::var_os("LOCALAPPDATA").or_else(|| env::var_os("APPDATA")) {
            return PathBuf::from(path).join("Relay_Agent");
        }
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Relay_Agent");
        }
    }

    if let Some(path) = env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(path).join("relay-agent");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("relay-agent");
    }
    env::temp_dir().join("relay-agent")
}

fn default_home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
}

fn parse_options(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut options = Options {
        platform: DEFAULT_PLATFORM.to_string(),
        cache_root: None,
        app_local_data_dir: None,
        workspace: None,
        config_output: None,
        provider_port: DEFAULT_PROVIDER_PORT,
        edge_cdp_port: DEFAULT_EDGE_CDP_PORT,
        provider_token_file: None,
        copilot_server_js: None,
        start_provider_gateway: false,
        download: false,
        open_openwork_installer: false,
        pretty: false,
    };

    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--platform" => {
                options.platform = next_arg(&mut args, "--platform")?;
            }
            "--cache-root" => {
                options.cache_root = Some(PathBuf::from(next_arg(&mut args, "--cache-root")?));
            }
            "--app-local-data-dir" => {
                options.app_local_data_dir =
                    Some(PathBuf::from(next_arg(&mut args, "--app-local-data-dir")?));
            }
            "--workspace" => {
                options.workspace = Some(PathBuf::from(next_arg(&mut args, "--workspace")?));
            }
            "--config-output" => {
                options.config_output =
                    Some(PathBuf::from(next_arg(&mut args, "--config-output")?));
            }
            "--provider-port" => {
                options.provider_port = parse_port(&next_arg(&mut args, "--provider-port")?)?;
            }
            "--edge-cdp-port" => {
                options.edge_cdp_port = parse_port(&next_arg(&mut args, "--edge-cdp-port")?)?;
            }
            "--provider-token-file" => {
                options.provider_token_file =
                    Some(PathBuf::from(next_arg(&mut args, "--provider-token-file")?));
            }
            "--copilot-server-js" => {
                options.copilot_server_js =
                    Some(PathBuf::from(next_arg(&mut args, "--copilot-server-js")?));
            }
            "--start-provider-gateway" => {
                options.start_provider_gateway = true;
            }
            "--download" => {
                options.download = true;
            }
            "--open-openwork-installer" => {
                options.open_openwork_installer = true;
            }
            "--json" => {}
            "--pretty" => {
                options.pretty = true;
            }
            "--help" | "-h" => {
                println!("{}", usage());
                std::process::exit(0);
            }
            other => return Err(format!("unknown option: {other}")),
        }
    }

    Ok(options)
}

fn parse_port(value: &str) -> Result<u16, String> {
    let port = value
        .parse::<u16>()
        .map_err(|_| format!("invalid TCP port: {value}"))?;
    if port == 0 {
        return Err(format!("invalid TCP port: {value}"));
    }
    Ok(port)
}

fn next_arg(
    args: &mut std::iter::Peekable<impl Iterator<Item = String>>,
    option: &str,
) -> Result<String, String> {
    args.next()
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| format!("{option} requires a value"))
}

fn usage() -> &'static str {
    "Usage: relay-openwork-bootstrap [--download] [--workspace PATH] [--config-output PATH] [--start-provider-gateway] [--provider-port PORT] [--edge-cdp-port PORT] [--provider-token-file PATH] [--copilot-server-js PATH] [--open-openwork-installer] [--platform windows-x64] [--cache-root PATH] [--app-local-data-dir PATH] [--json] [--pretty]"
}

fn print_json(value: &impl Serialize, pretty: bool) {
    let json = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .expect("serialize bootstrap report");
    println!("{json}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_opencode_config_preserves_existing_provider_settings() {
        let merged = merge_opencode_config(
            json!({
                "$schema": "https://example.invalid/custom-schema.json",
                "enabled_providers": ["existing"],
                "provider": {
                    "existing": {
                        "name": "Existing Provider"
                    }
                }
            }),
            "http://127.0.0.1:18180/v1",
        );

        assert_eq!(
            merged["$schema"],
            "https://example.invalid/custom-schema.json"
        );
        assert_eq!(merged["enabled_providers"][0], "existing");
        assert_eq!(merged["enabled_providers"][1], "relay-agent");
        assert_eq!(merged["provider"]["existing"]["name"], "Existing Provider");
        assert_eq!(
            merged["provider"]["relay-agent"]["options"]["baseURL"],
            "http://127.0.0.1:18180/v1"
        );
        assert_eq!(
            merged["provider"]["relay-agent"]["models"]["m365-copilot"]["name"],
            "M365 Copilot"
        );
    }

    #[test]
    fn merge_opencode_config_does_not_add_relay_provider_twice() {
        let merged = merge_opencode_config(
            json!({
                "enabled_providers": ["relay-agent"]
            }),
            "http://127.0.0.1:18180/v1",
        );
        assert_eq!(
            merged["enabled_providers"].as_array().expect("array").len(),
            1
        );
    }

    #[test]
    fn write_opencode_provider_config_merges_workspace_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let output = workspace.join("opencode.json");
        fs::create_dir_all(&workspace).expect("workspace");
        fs::write(
            &output,
            r#"{"enabled_providers":["existing"],"provider":{"existing":{"name":"Existing"}}}"#,
        )
        .expect("existing config");

        write_opencode_provider_config(&workspace, &output, "http://127.0.0.1:18180/v1")
            .expect("write config");
        let config: Value =
            serde_json::from_str(&fs::read_to_string(&output).expect("read config"))
                .expect("config json");
        assert_eq!(config["enabled_providers"][0], "existing");
        assert_eq!(config["enabled_providers"][1], "relay-agent");
        assert_eq!(config["provider"]["existing"]["name"], "Existing");
        assert_eq!(
            config["provider"]["relay-agent"]["options"]["apiKey"],
            "{env:RELAY_AGENT_API_KEY}"
        );
        assert_eq!(
            config["provider"]["relay-agent"]["models"]["m365-copilot"]["limit"]["context"],
            128000
        );
    }

    #[test]
    fn openwork_installer_command_uses_explicit_msiexec_handoff() {
        let path = Path::new(r"C:\Relay\openwork-desktop-windows-x64.msi");
        assert_eq!(
            openwork_installer_command(path),
            vec![
                "msiexec".to_string(),
                "/i".to_string(),
                path.display().to_string()
            ]
        );
    }
}
