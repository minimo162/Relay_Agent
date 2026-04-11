//! External CLI Hub — inspired by `OpenCLI`'s unified CLI discovery pattern.
//!
//! Discovers, registers, auto-installs, and passthrough-executes external
//! CLI tools so AI agents have a single interface to all command-line utilities.
//!
//! ## Architecture
//!
//! - **Known CLIs**: A curated list of popular CLIs with install instructions per OS
//! - **Custom Registry**: User-registered CLIs persisted to `cli_registry.json`
//! - **Discovery**: Scans PATH for known CLI names
//! - **Auto-install**: Detects missing CLIs and offers install commands
//! - **Passthrough**: Forwards arguments to the real CLI and captures output

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::sandbox::{
    build_linux_sandbox_command, resolve_sandbox_status_for_request, FilesystemIsolationMode,
    SandboxConfig,
};
use runtime::{ConfigLoader, ResolvedPermissionMode, validate_bash_hard_deny};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use tracing::{info, warn};

/* ── CLI metadata ───────────────────────────────────────────── */

/// Metadata for a known external CLI tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliEntry {
    /// CLI command name (e.g. "gh", "docker")
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// Install commands per OS
    pub install_commands: BTreeMap<String, String>,
}

/* ── Known CLI catalog ──────────────────────────────────────── */

fn known_clis() -> Vec<CliEntry> {
    vec![
        CliEntry {
            name: "gh".into(),
            description: "GitHub CLI — repos, PRs, issues, actions".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "brew install gh".into()),
                ("linux".into(), "sudo apt install gh".into()),
                ("windows".into(), "winget install GitHub.cli".into()),
            ]),
        },
        CliEntry {
            name: "docker".into(),
            description: "Docker — containers, images, compose".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "brew install --cask docker".into()),
                (
                    "linux".into(),
                    "curl -fsSL https://get.docker.com | sh".into(),
                ),
                (
                    "windows".into(),
                    "winget install Docker.DockerDesktop".into(),
                ),
            ]),
        },
        CliEntry {
            name: "obsidian".into(),
            description: "Obsidian CLI — vault search, note management".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "brew install obsidian-cli".into()),
                ("linux".into(), "cargo install obsidian-cli".into()),
                ("windows".into(), "cargo install obsidian-cli".into()),
            ]),
        },
        CliEntry {
            name: "vercel".into(),
            description: "Vercel CLI — deploy, manage projects and env vars".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "npm i -g vercel".into()),
                ("linux".into(), "npm i -g vercel".into()),
                ("windows".into(), "npm i -g vercel".into()),
            ]),
        },
        CliEntry {
            name: "lark-cli".into(),
            description: "Lark/Feishu CLI — messages, docs, calendar, tasks".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "npm i -g @larksuiteoapi/cli".into()),
                ("linux".into(), "npm i -g @larksuiteoapi/cli".into()),
                ("windows".into(), "npm i -g @larksuiteoapi/cli".into()),
            ]),
        },
        CliEntry {
            name: "taze".into(),
            description: "Taze — modern dependency updater".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "npm i -g taze".into()),
                ("linux".into(), "npm i -g taze".into()),
                ("windows".into(), "npm i -g taze".into()),
            ]),
        },
        CliEntry {
            name: "eza".into(),
            description: "eza — modern ls replacement".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "brew install eza".into()),
                ("linux".into(), "cargo install eza".into()),
                ("windows".into(), "scoop install eza".into()),
            ]),
        },
        CliEntry {
            name: "ripgrep".into(),
            description: "ripgrep (rg) — fast regex search".into(),
            install_commands: BTreeMap::from([
                ("macos".into(), "brew install ripgrep".into()),
                ("linux".into(), "sudo apt install ripgrep".into()),
                ("windows".into(), "scoop install ripgrep".into()),
            ]),
        },
    ]
}

fn registry_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".relay-agent")
        .join("cli_registry.json")
}

fn load_custom_registry() -> Vec<String> {
    let path = registry_path();
    if !path.exists() {
        return Vec::new();
    }
    if let Some(entries) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
    {
        entries
    } else {
        warn!("[cli_hub] failed to parse registry at {:?}", path);
        Vec::new()
    }
}

fn save_custom_registry(entries: &[String]) -> Result<(), String> {
    let path = registry_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Check if a command is available in PATH.
pub fn cli_installed(name: &str) -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where")
            .arg(name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("which")
            .arg(name)
            .output()
            .ok()
            .is_some_and(|o| o.status.success())
    }
}

/// List all discoverable CLIs (known + registered) with their status.
pub fn cli_list() -> Value {
    let known = known_clis();
    let registered = load_custom_registry();
    let all_names: Vec<String> = known
        .iter()
        .map(|e| e.name.clone())
        .chain(registered.iter().cloned())
        .collect();

    let items: Vec<Value> = all_names
        .iter()
        .map(|name| {
            let installed = cli_installed(name);
            let install_cmd = known
                .iter()
                .find(|e| &e.name == name)
                .and_then(|e| e.install_commands.get(os_name()))
                .cloned();
            let description = known.iter().find(|e| &e.name == name).map_or_else(
                || format!("Custom registered CLI: {name}"),
                |e| e.description.clone(),
            );

            json!({
                "name": name,
                "installed": installed,
                "description": description,
                "install_command": install_cmd,
                "source": if known.iter().any(|e| &e.name == name) { "known" } else { "custom" },
            })
        })
        .collect();

    json!({ "clis": items, "total": items.len() })
}

/// Register a new CLI by name.
#[allow(clippy::needless_pass_by_value)]
pub fn cli_register(name: String) -> Value {
    if name.is_empty() || name.contains(|c: char| !c.is_alphanumeric() && c != '-' && c != '_') {
        return json!({ "error": "invalid CLI name (alphanumeric, hyphens, underscores only)" });
    }

    let mut registry = load_custom_registry();
    if registry.contains(&name) {
        return json!({ "message": format!("{name} is already registered") });
    }

    registry.push(name.clone());
    if let Err(e) = save_custom_registry(&registry) {
        return json!({ "error": format!("failed to save registry: {e}") });
    }

    info!("[cli_hub] registered CLI: {name}");
    json!({ "message": format!("registered '{name}'"), "name": name })
}

/// Unregister a CLI.
#[allow(clippy::needless_pass_by_value)]
pub fn cli_unregister(name: String) -> Value {
    let mut registry = load_custom_registry();
    let before = registry.len();
    registry.retain(|n| n != &name);
    if registry.len() == before {
        return json!({ "error": format!("'{name}' not found in custom registry") });
    }
    if let Err(e) = save_custom_registry(&registry) {
        return json!({ "error": format!("failed to save registry: {e}") });
    }
    info!("[cli_hub] unregistered CLI: {name}");
    json!({ "message": format!("unregistered '{name}'") })
}

/// Get install command for a known CLI on the current OS.
pub fn cli_install_hint(name: &str) -> Value {
    let entry = known_clis().into_iter().find(|e| e.name == name);
    match entry {
        Some(e) => {
            let cmd = e.install_commands.get(os_name());
            json!({
                "name": e.name,
                "install_command": cmd,
                "os": os_name(),
                "all_commands": e.install_commands,
            })
        }
        None => json!({
            "error": format!("'{name}' not in known CLI catalog"),
            "hint": "use 'cli_register' to add a custom CLI",
        }),
    }
}

/// Execute a CLI command with args. Returns `stdout/stderr/exit_code`.
/// If the CLI is not installed, returns a hint with the install command.
pub fn cli_execute(name: &str, args: &[&str], timeout_ms: Option<u64>) -> Value {
    if !cli_installed(name) {
        let hint = cli_install_hint(name);
        return json!({
            "error": format!("'{name}' is not installed"),
            "install_hint": hint,
        });
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let read_only_mode = ConfigLoader::default_for(&cwd)
        .load()
        .ok()
        .and_then(|cfg| cfg.permission_mode())
        == Some(ResolvedPermissionMode::ReadOnly);
    let sandbox_status = resolve_sandbox_status_for_request(
        &SandboxConfig::default().resolve_request(
            read_only_mode.then_some(true),
            read_only_mode.then_some(true),
            read_only_mode.then_some(false),
            read_only_mode.then_some(FilesystemIsolationMode::WorkspaceOnly),
            None,
        ),
        &cwd,
    );
    if read_only_mode && !sandbox_status.active {
        warn!(
            "[cli_hub] sandbox-deny (read-only requires OS sandbox): {:?}",
            sandbox_status.fallback_reason
        );
        return json!({
            "error": format!(
                "CliRun blocked: read-only session requires OS sandbox, but sandbox startup is unavailable. {}",
                sandbox_status
                    .fallback_reason
                    .clone()
                    .unwrap_or_else(|| "No fallback available (fail-closed).".to_string())
            ),
            "sandbox_status": sandbox_status,
        });
    }

    let command_line = std::iter::once(name)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ");
    if let Err(error) = validate_bash_hard_deny(&command_line) {
        warn!("[cli_hub] heuristic-deny (hard denylist): {command_line}");
        return json!({
            "error": error.to_string(),
            "blocked_by": "heuristic",
        });
    }

    info!("[cli_hub] executing: {name} {}", args.join(" "));

    let timeout = timeout_ms.unwrap_or(30_000);
    #[allow(unused_variables)]
    let _timeout = std::time::Duration::from_millis(timeout);

    let output = if read_only_mode {
        if let Some(launcher) = build_linux_sandbox_command(&command_line, &cwd, &sandbox_status) {
            let mut cmd = Command::new(launcher.program);
            cmd.args(launcher.args)
                .current_dir(&cwd)
                .envs(launcher.env)
                .output()
        } else {
            Command::new(name).args(args).output()
        }
    } else {
        Command::new(name).args(args).output()
    };

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            let success = output.status.success();

            if !success && !stderr.is_empty() {
                warn!("[cli_hub] {name} exited {exit_code}: {stderr}");
            }

            json!({
                "success": success,
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "cli": name,
                "args": args,
            })
        }
        Err(e) => json!({
            "error": format!("failed to execute {name}: {e}"),
        }),
    }
}

/// Discover all installed CLIs from the known catalog.
pub fn cli_discover() -> Value {
    let known = known_clis();
    let installed: Vec<Value> = known
        .iter()
        .filter(|e| cli_installed(&e.name))
        .map(|e| {
            json!({
                "name": e.name,
                "description": e.description,
            })
        })
        .collect();

    let missing: Vec<Value> = known
        .iter()
        .filter(|e| !cli_installed(&e.name))
        .map(|e| {
            let install_cmd = e.install_commands.get(os_name());
            json!({
                "name": e.name,
                "description": e.description,
                "install_command": install_cmd,
            })
        })
        .collect();

    json!({
        "installed": installed,
        "installed_count": installed.len(),
        "missing": missing,
        "missing_count": missing.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use runtime::validate_bash_hard_deny;

    #[test]
    fn test_known_clis_not_empty() {
        let clis = known_clis();
        assert!(!clis.is_empty());
        assert!(clis.iter().any(|c| c.name == "gh"));
        assert!(clis.iter().any(|c| c.name == "docker"));
    }

    #[test]
    fn test_os_name() {
        let os = os_name();
        assert!(["macos", "linux", "windows"].contains(&os));
    }

    #[test]
    fn test_cli_list_returns_json() {
        let result = cli_list();
        assert!(result.get("clis").is_some());
        assert!(result.get("total").is_some());
    }

    #[test]
    fn test_cli_register_invalid_name() {
        let result = cli_register("".into());
        assert!(result.get("error").is_some());

        let result = cli_register("foo bar!".into());
        assert!(result.get("error").is_some());
    }

    #[test]
    fn test_cli_register_valid() {
        let result = cli_register("my-custom-tool".into());
        assert!(result.get("message").is_some());
    }

    #[test]
    fn test_clirun_denylist_blocks_obfuscated_payloads() {
        for command in [
            "SuDo whoami",
            "/bin/RM -Rf ./tmp",
            "find . -name x -DeLeTe",
        ] {
            assert!(
                validate_bash_hard_deny(command).is_err(),
                "obfuscated command should be denied: {command}"
            );
        }
    }

    #[test]
    fn test_clirun_denylist_keeps_safe_commands() {
        for command in ["gh --version", "git status --short", "docker ps", "rg relay ."] {
            assert!(
                validate_bash_hard_deny(command).is_ok(),
                "safe command should not be denied: {command}"
            );
        }
    }
}
