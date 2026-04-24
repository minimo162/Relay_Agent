use crate::models::{
    BrowserAutomationSettings, RelayDoctorCheck, RelayDoctorReport, RelayDoctorStatus,
};
use chrono::Utc;
use serde_json::{json, Value as JsonValue};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::DesktopCoreError;

pub const RELAY_MAX_TEXT_FILE_READ_BYTES: u64 = 10 * 1024 * 1024;

#[must_use]
pub fn report_from_checks(
    browser_settings: BrowserAutomationSettings,
    checks: Vec<RelayDoctorCheck>,
    doctor_hints: Vec<String>,
) -> RelayDoctorReport {
    RelayDoctorReport {
        status: aggregate_status(&checks),
        timestamp: Utc::now().to_rfc3339(),
        browser_settings,
        checks,
        doctor_hints,
    }
}

pub fn ok_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Ok,
        message: message.into(),
        details,
    }
}

pub fn warn_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Warn,
        message: message.into(),
        details,
    }
}

pub fn failed_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Fail,
        message: message.into(),
        details,
    }
}

#[must_use]
pub fn workspace_config_check(workspace: Option<&Path>) -> RelayDoctorCheck {
    let Some(workspace) = workspace else {
        return warn_check(
            "workspace_config",
            "Workspace path was not provided; project .claw discovery was skipped.",
            None,
        );
    };
    if !workspace.exists() {
        return failed_check(
            "workspace_config",
            format!("Workspace path does not exist: {}", workspace.display()),
            None,
        );
    }
    if !workspace.is_dir() {
        return failed_check(
            "workspace_config",
            format!("Workspace path is not a directory: {}", workspace.display()),
            None,
        );
    }

    let discovered = workspace_config_candidates(workspace);
    match workspace_config_discovery(workspace) {
        Ok(discovery) => {
            if discovery.loaded_entries.is_empty() {
                warn_check(
                    "workspace_config",
                    "Workspace exists, but no .claw config files were discovered.",
                    Some(json!({
                        "workspace": workspace.display().to_string(),
                        "configHome": default_config_home().display().to_string(),
                        "discoveredCandidates": discovery.discovered_candidates,
                    })),
                )
            } else {
                ok_check(
                    "workspace_config",
                    "Workspace and .claw configuration were discovered successfully.",
                    Some(json!({
                        "workspace": workspace.display().to_string(),
                        "configHome": default_config_home().display().to_string(),
                        "discoveredCandidates": discovery.discovered_candidates,
                        "loadedEntries": discovery.loaded_entries,
                    })),
                )
            }
        }
        Err(error) => failed_check(
            "workspace_config",
            format!("Failed to load .claw configuration: {error}"),
            Some(json!({
                "workspace": workspace.display().to_string(),
                "configHome": default_config_home().display().to_string(),
                "discoveredCandidates": discovered,
            })),
        ),
    }
}

#[must_use]
pub fn runtime_assets_check() -> RelayDoctorCheck {
    match liteparse_runtime_paths() {
        Ok(paths) => ok_check(
            "runtime_assets",
            "Relay runtime assets for LiteParse and Node are available.",
            Some(json!({
                "runner": paths.runner.display().to_string(),
                "parseMjs": paths.parse_mjs.display().to_string(),
                "node": paths.node.display().to_string(),
            })),
        ),
        Err(error) => failed_check(
            "runtime_assets",
            error.to_string(),
            Some(json!({
                "bundledNodeEnv": std::env::var("RELAY_BUNDLED_NODE").ok(),
                "liteparseRunnerEnv": std::env::var("RELAY_LITEPARSE_RUNNER_ROOT").ok(),
            })),
        ),
    }
}

fn default_config_home() -> PathBuf {
    std::env::var_os("CLAW_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claw")))
        .unwrap_or_else(|| PathBuf::from(".claw"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceConfigDiscovery {
    discovered_candidates: Vec<String>,
    loaded_entries: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LiteparseRuntimePaths {
    runner: PathBuf,
    parse_mjs: PathBuf,
    node: PathBuf,
}

fn workspace_config_discovery(
    workspace: &Path,
) -> Result<WorkspaceConfigDiscovery, DesktopCoreError> {
    let discovered_candidates = workspace_config_candidates(workspace);
    let loaded_entries = workspace_config_entry_paths(workspace)
        .into_iter()
        .filter_map(|path| match read_optional_json_object(&path) {
            Ok(Some(())) => Some(Ok(path.display().to_string())),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(WorkspaceConfigDiscovery {
        discovered_candidates,
        loaded_entries,
    })
}

fn workspace_config_candidates(workspace: &Path) -> Vec<String> {
    workspace_config_entry_paths(workspace)
        .into_iter()
        .map(|path| path.display().to_string())
        .collect()
}

fn workspace_config_entry_paths(workspace: &Path) -> Vec<PathBuf> {
    let config_home = default_config_home();
    let user_legacy_path = config_home.parent().map_or_else(
        || PathBuf::from(".claw.json"),
        |parent| parent.join(".claw.json"),
    );
    vec![
        user_legacy_path,
        config_home.join("settings.json"),
        workspace.join(".claw.json"),
        workspace.join(".claw").join("settings.json"),
        workspace.join(".claw").join("settings.local.json"),
    ]
}

fn read_optional_json_object(path: &Path) -> Result<Option<()>, DesktopCoreError> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(path).map_err(|error| {
        DesktopCoreError::new(format!(
            "failed to read workspace configuration {}: {error}",
            path.display()
        ))
    })?;
    let value: JsonValue = serde_json::from_str(&contents).map_err(|error| {
        DesktopCoreError::new(format!(
            "failed to parse workspace configuration {}: {error}",
            path.display()
        ))
    })?;
    if !value.is_object() {
        return Err(DesktopCoreError::new(format!(
            "workspace configuration {} must be a JSON object",
            path.display()
        )));
    }
    Ok(Some(()))
}

fn liteparse_runtime_paths() -> Result<LiteparseRuntimePaths, DesktopCoreError> {
    let runner = liteparse_runner_root().ok_or_else(|| {
        DesktopCoreError::new(
            "LiteParse runner not found (missing liteparse-runner/parse.mjs). Run: npm ci --omit=dev --prefix apps/desktop/src-tauri/liteparse-runner",
        )
    })?;
    let parse_mjs = runner.join("parse.mjs");
    let node = resolve_node_binary().ok_or_else(|| {
        DesktopCoreError::new(
            "Node.js not found for PDF parsing (set RELAY_BUNDLED_NODE or install `node` on PATH, or run apps/desktop/scripts/fetch-bundled-node.mjs before tauri build)",
        )
    })?;
    Ok(LiteparseRuntimePaths {
        runner,
        parse_mjs,
        node,
    })
}

fn liteparse_runner_root() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("RELAY_LITEPARSE_RUNNER_ROOT") {
        let path = PathBuf::from(path);
        return path.join("parse.mjs").is_file().then_some(path);
    }

    let manifest_dir = option_env!("CARGO_MANIFEST_DIR")?;
    let candidate = Path::new(manifest_dir)
        .join("..")
        .join("..")
        .join("liteparse-runner");
    let candidate = std::fs::canonicalize(candidate).ok()?;
    candidate.join("parse.mjs").is_file().then_some(candidate)
}

fn resolve_node_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("RELAY_BUNDLED_NODE") {
        let path = PathBuf::from(path);
        return path.is_file().then_some(path);
    }

    if let Some(base) = sidecar_base_dir() {
        #[cfg(windows)]
        let path = base.join("relay-node.exe");
        #[cfg(not(windows))]
        let path = base.join("relay-node");
        if path.is_file() {
            return Some(path);
        }
    }

    ["node", "node.exe"]
        .into_iter()
        .find(|name| {
            Command::new(name)
                .arg("--version")
                .output()
                .ok()
                .is_some_and(|output| output.status.success())
        })
        .map(PathBuf::from)
}

fn sidecar_base_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let base = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    Some(base.to_path_buf())
}

#[must_use]
pub fn aggregate_status(checks: &[RelayDoctorCheck]) -> RelayDoctorStatus {
    if checks
        .iter()
        .any(|check| check.status == RelayDoctorStatus::Fail)
    {
        RelayDoctorStatus::Fail
    } else if checks
        .iter()
        .any(|check| check.status == RelayDoctorStatus::Warn)
    {
        RelayDoctorStatus::Warn
    } else {
        RelayDoctorStatus::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    fn browser_settings() -> BrowserAutomationSettings {
        BrowserAutomationSettings {
            cdp_port: 9360,
            auto_launch_edge: true,
            timeout_ms: 120_000,
        }
    }

    #[test]
    fn aggregate_status_prefers_fail_then_warn() {
        assert_eq!(
            aggregate_status(&[ok_check("one", "ok", None), warn_check("two", "warn", None),]),
            RelayDoctorStatus::Warn
        );
        assert_eq!(
            aggregate_status(&[
                ok_check("one", "ok", None),
                failed_check("two", "fail", None),
                warn_check("three", "warn", None),
            ]),
            RelayDoctorStatus::Fail
        );
    }

    #[test]
    fn doctor_report_serializes_expected_shape() {
        let report = report_from_checks(
            browser_settings(),
            vec![
                ok_check("workspace_config", "ok", None),
                warn_check(
                    "m365_sign_in",
                    "warn",
                    Some(json!({"url": "https://example.com"})),
                ),
            ],
            vec!["hint".to_string()],
        );
        let json = serde_json::to_value(report).expect("serialize report");
        assert_eq!(json.get("status").and_then(JsonValue::as_str), Some("warn"));
        assert!(json.get("timestamp").and_then(JsonValue::as_str).is_some());
        assert!(json
            .get("browserSettings")
            .and_then(|value| value.get("cdpPort"))
            .is_some());
        assert_eq!(
            json.get("checks")
                .and_then(JsonValue::as_array)
                .expect("checks array")
                .len(),
            2
        );
    }

    #[test]
    fn workspace_config_discovery_loads_existing_json_object_files() {
        let _lock = env_lock();
        let temp = tempfile::tempdir().expect("tempdir");
        let config_home = temp.path().join("home").join(".claw");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(&config_home).expect("create config home");
        fs::create_dir_all(workspace.join(".claw")).expect("create workspace config dir");
        fs::write(temp.path().join("home").join(".claw.json"), "{}").expect("write legacy config");
        fs::write(config_home.join("settings.json"), "{\"model\":\"test\"}")
            .expect("write user config");
        fs::write(
            workspace.join(".claw").join("settings.local.json"),
            "{\"permissionMode\":\"read-only\"}",
        )
        .expect("write local config");
        let _env = EnvGuard::set([(
            "CLAW_CONFIG_HOME",
            Some(config_home.to_string_lossy().into_owned()),
        )]);

        let discovery = workspace_config_discovery(&workspace).expect("discover config");

        assert_eq!(discovery.discovered_candidates.len(), 5);
        assert_eq!(discovery.loaded_entries.len(), 3);
        assert!(
            discovery
                .loaded_entries
                .iter()
                .any(|path| path.ends_with(".claw.json")),
            "{:?}",
            discovery.loaded_entries
        );
        assert!(
            discovery
                .loaded_entries
                .iter()
                .any(|path| path.ends_with("settings.local.json")),
            "{:?}",
            discovery.loaded_entries
        );
    }

    #[test]
    fn workspace_config_discovery_rejects_non_object_json() {
        let _lock = env_lock();
        let temp = tempfile::tempdir().expect("tempdir");
        let config_home = temp.path().join("home").join(".claw");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(&config_home).expect("create config home");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(config_home.join("settings.json"), "[]").expect("write invalid config");
        let _env = EnvGuard::set([(
            "CLAW_CONFIG_HOME",
            Some(config_home.to_string_lossy().into_owned()),
        )]);

        let error = workspace_config_discovery(&workspace).expect_err("reject non-object config");

        assert!(error.to_string().contains("must be a JSON object"));
    }

    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock")
    }

    struct EnvGuard {
        previous: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn set<const N: usize>(values: [(&'static str, Option<String>); N]) -> Self {
            let previous = values
                .iter()
                .map(|(key, _)| (*key, std::env::var(key).ok()))
                .collect::<Vec<_>>();
            for (key, value) in values {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
            Self { previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.previous.drain(..).rev() {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}
