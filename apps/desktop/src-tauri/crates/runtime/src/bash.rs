use std::env;
use std::fs::File;
use std::io;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command as TokioCommand;
use tokio::runtime::Builder;
use tokio::time::timeout;

use crate::bash_validation::validate_bash_against_config_permission;
use crate::sandbox::{
    build_linux_sandbox_command, resolve_sandbox_status_for_request, FilesystemIsolationMode,
    SandboxConfig, SandboxStatus,
};
use crate::tool_hard_denylist::validate_bash_hard_deny;
use crate::{ConfigLoader, ResolvedPermissionMode};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BashCommandInput {
    pub command: String,
    pub timeout: Option<u64>,
    pub description: Option<String>,
    #[serde(rename = "run_in_background")]
    pub run_in_background: Option<bool>,
    #[serde(rename = "backgroundedBy")]
    pub backgrounded_by: Option<BackgroundedBy>,
    #[serde(
        rename = "dangerouslyDisableSandbox",
        alias = "dangerously_disable_sandbox"
    )]
    pub dangerously_disable_sandbox: Option<bool>,
    #[serde(rename = "namespaceRestrictions")]
    pub namespace_restrictions: Option<bool>,
    #[serde(rename = "isolateNetwork")]
    pub isolate_network: Option<bool>,
    #[serde(rename = "filesystemMode")]
    pub filesystem_mode: Option<FilesystemIsolationMode>,
    #[serde(rename = "allowedMounts")]
    pub allowed_mounts: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskState {
    Requested,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundedBy {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackgroundTaskStdioPaths {
    #[serde(rename = "stdoutPath")]
    pub stdout_path: String,
    #[serde(rename = "stderrPath")]
    pub stderr_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackgroundTaskInfo {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub state: BackgroundTaskState,
    #[serde(rename = "startedBy")]
    pub started_by: BackgroundedBy,
    pub stdio: BackgroundTaskStdioPaths,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedBackgroundTaskLogs {
    task_id: String,
    stdio: BackgroundTaskStdioPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BashCommandOutput {
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "rawOutputPath")]
    pub raw_output_path: Option<String>,
    pub interrupted: bool,
    #[serde(rename = "isImage")]
    pub is_image: Option<bool>,
    #[serde(rename = "backgroundTaskId")]
    pub background_task_id: Option<String>,
    #[serde(rename = "backgroundedByUser")]
    pub backgrounded_by_user: Option<bool>,
    #[serde(rename = "assistantAutoBackgrounded")]
    pub assistant_auto_backgrounded: Option<bool>,
    pub stdio: Option<BackgroundTaskStdioPaths>,
    pub state: Option<BackgroundTaskState>,
    #[serde(rename = "backgroundedBy")]
    pub backgrounded_by: Option<BackgroundedBy>,
    pub background: Option<BackgroundTaskInfo>,
    #[serde(rename = "dangerouslyDisableSandbox")]
    pub dangerously_disable_sandbox: Option<bool>,
    #[serde(rename = "returnCodeInterpretation")]
    pub return_code_interpretation: Option<String>,
    #[serde(rename = "noOutputExpected")]
    pub no_output_expected: Option<bool>,
    #[serde(rename = "structuredContent")]
    pub structured_content: Option<Vec<serde_json::Value>>,
    #[serde(rename = "persistedOutputPath")]
    pub persisted_output_path: Option<String>,
    #[serde(rename = "persistedOutputSize")]
    pub persisted_output_size: Option<u64>,
    #[serde(rename = "sandboxStatus")]
    pub sandbox_status: Option<SandboxStatus>,
}

pub fn execute_bash(input: BashCommandInput) -> io::Result<BashCommandOutput> {
    let cwd = env::current_dir()?;
    let (sandbox_status, read_only_mode) = sandbox_status_for_input(&input, &cwd);
    ensure_sandbox_available_for_read_only(read_only_mode, &sandbox_status)?;
    if let Err(error) = validate_bash_hard_deny(&input.command) {
        eprintln!(
            "[RelayAgent] bash heuristic-deny (hard denylist): {}",
            input.command
        );
        return Err(error);
    }
    if let Err(error) = validate_bash_against_config_permission(&input.command) {
        eprintln!(
            "[RelayAgent] bash heuristic-deny (read-only heuristic): {}",
            input.command
        );
        return Err(error);
    }

    if input.run_in_background.unwrap_or(false) {
        let started_by = input
            .backgrounded_by
            .clone()
            .unwrap_or(BackgroundedBy::User);
        let prepared_logs = prepare_background_stdio_paths()?;
        let stdout_file = File::create(&prepared_logs.stdio.stdout_path)?;
        let stderr_file = File::create(&prepared_logs.stdio.stderr_path)?;
        let mut child = prepare_command(&input.command, &cwd, &sandbox_status, false);
        let child = child
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()?;
        let _pid = child.id();
        let task_id = prepared_logs.task_id;

        return Ok(BashCommandOutput {
            stdout: String::new(),
            stderr: String::new(),
            raw_output_path: None,
            interrupted: false,
            is_image: None,
            background_task_id: Some(task_id.clone()),
            backgrounded_by_user: Some(started_by == BackgroundedBy::User),
            assistant_auto_backgrounded: Some(started_by == BackgroundedBy::Assistant),
            stdio: Some(prepared_logs.stdio.clone()),
            state: Some(BackgroundTaskState::Running),
            backgrounded_by: Some(started_by.clone()),
            background: Some(BackgroundTaskInfo {
                task_id,
                state: BackgroundTaskState::Running,
                started_by,
                stdio: prepared_logs.stdio,
            }),
            dangerously_disable_sandbox: input.dangerously_disable_sandbox,
            return_code_interpretation: None,
            no_output_expected: Some(true),
            structured_content: None,
            persisted_output_path: Some(
                env::current_dir()?
                    .join(".relay/background-tasks")
                    .to_string_lossy()
                    .to_string(),
            ),
            persisted_output_size: None,
            sandbox_status: Some(sandbox_status),
        });
    }

    let runtime = Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(execute_bash_async(input, sandbox_status, cwd))
}

async fn execute_bash_async(
    input: BashCommandInput,
    sandbox_status: SandboxStatus,
    cwd: std::path::PathBuf,
) -> io::Result<BashCommandOutput> {
    let mut command = prepare_tokio_command(&input.command, &cwd, &sandbox_status, true);

    let output_result = if let Some(timeout_ms) = input.timeout {
        match timeout(Duration::from_millis(timeout_ms), command.output()).await {
            Ok(result) => (result?, false),
            Err(_) => {
                return Ok(BashCommandOutput {
                    stdout: String::new(),
                    stderr: format!("Command exceeded timeout of {timeout_ms} ms"),
                    raw_output_path: None,
                    interrupted: true,
                    is_image: None,
                    background_task_id: None,
                    backgrounded_by_user: None,
                    assistant_auto_backgrounded: None,
                    stdio: None,
                    state: None,
                    backgrounded_by: None,
                    background: None,
                    dangerously_disable_sandbox: input.dangerously_disable_sandbox,
                    return_code_interpretation: Some(String::from("timeout")),
                    no_output_expected: Some(true),
                    structured_content: None,
                    persisted_output_path: None,
                    persisted_output_size: None,
                    sandbox_status: Some(sandbox_status),
                });
            }
        }
    } else {
        (command.output().await?, false)
    };

    let (output, interrupted) = output_result;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let no_output_expected = Some(stdout.trim().is_empty() && stderr.trim().is_empty());
    let return_code_interpretation = output.status.code().and_then(|code| {
        if code == 0 {
            None
        } else {
            Some(format!("exit_code:{code}"))
        }
    });

    Ok(BashCommandOutput {
        stdout,
        stderr,
        raw_output_path: None,
        interrupted,
        is_image: None,
        background_task_id: None,
        backgrounded_by_user: None,
        assistant_auto_backgrounded: None,
        stdio: None,
        state: None,
        backgrounded_by: None,
        background: None,
        dangerously_disable_sandbox: input.dangerously_disable_sandbox,
        return_code_interpretation,
        no_output_expected,
        structured_content: None,
        persisted_output_path: None,
        persisted_output_size: None,
        sandbox_status: Some(sandbox_status),
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackgroundTaskOutputInput {
    #[serde(rename = "backgroundTaskId")]
    pub background_task_id: String,
    pub stream: Option<String>,
    pub offset: Option<u64>,
    pub tail: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BackgroundTaskOutputSlice {
    #[serde(rename = "backgroundTaskId")]
    pub background_task_id: String,
    pub stream: String,
    pub offset: u64,
    #[serde(rename = "nextOffset")]
    pub next_offset: u64,
    pub data: String,
}

pub fn read_background_task_output(
    input: BackgroundTaskOutputInput,
) -> io::Result<BackgroundTaskOutputSlice> {
    let stream = input.stream.unwrap_or_else(|| "stdout".to_string());
    let log_path = background_task_stream_path(&input.background_task_id, &stream);
    let mut file = File::open(log_path)?;
    let file_len = file.metadata()?.len();
    let start = input
        .tail
        .map(|tail| file_len.saturating_sub(tail as u64))
        .or(input.offset)
        .unwrap_or(0)
        .min(file_len);
    file.seek(SeekFrom::Start(start))?;
    let mut data = String::new();
    file.read_to_string(&mut data)?;
    let next_offset = start + data.len() as u64;
    Ok(BackgroundTaskOutputSlice {
        background_task_id: input.background_task_id,
        stream,
        offset: start,
        next_offset,
        data,
    })
}

fn prepare_background_stdio_paths() -> io::Result<PreparedBackgroundTaskLogs> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let task_id = format!("{nanos}-{}", std::process::id());
    let root = env::current_dir()?
        .join(".relay/background-tasks")
        .join(&task_id);
    std::fs::create_dir_all(&root)?;
    Ok(PreparedBackgroundTaskLogs {
        task_id,
        stdio: BackgroundTaskStdioPaths {
            stdout_path: root.join("stdout.log").to_string_lossy().to_string(),
            stderr_path: root.join("stderr.log").to_string_lossy().to_string(),
        },
    })
}

fn background_task_stream_path(background_task_id: &str, stream: &str) -> PathBuf {
    let safe_stream = if stream.eq_ignore_ascii_case("stderr") {
        "stderr"
    } else {
        "stdout"
    };
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".relay/background-tasks")
        .join(background_task_id)
        .join(format!("{safe_stream}.log"))
}

fn sandbox_status_for_input(
    input: &BashCommandInput,
    cwd: &std::path::Path,
) -> (SandboxStatus, bool) {
    let runtime_config = ConfigLoader::default_for(cwd).load().ok();
    let config = runtime_config
        .as_ref()
        .map_or_else(SandboxConfig::default, |runtime_config| {
            runtime_config.sandbox().clone()
        });
    let read_only_mode = runtime_config
        .as_ref()
        .and_then(super::config::RuntimeConfig::permission_mode)
        == Some(ResolvedPermissionMode::ReadOnly);
    let force_read_only_profile = read_only_mode;
    let request = config.resolve_request(
        force_read_only_profile
            .then_some(true)
            .or_else(|| input.dangerously_disable_sandbox.map(|disabled| !disabled)),
        force_read_only_profile
            .then_some(true)
            .or(input.namespace_restrictions),
        force_read_only_profile
            .then_some(false)
            .or(input.isolate_network),
        force_read_only_profile
            .then_some(FilesystemIsolationMode::WorkspaceOnly)
            .or(input.filesystem_mode),
        input.allowed_mounts.clone(),
    );
    (
        resolve_sandbox_status_for_request(&request, cwd),
        read_only_mode,
    )
}

fn ensure_sandbox_available_for_read_only(
    read_only_mode: bool,
    sandbox_status: &SandboxStatus,
) -> io::Result<()> {
    if !read_only_mode {
        return Ok(());
    }
    if sandbox_status.active {
        return Ok(());
    }
    eprintln!(
        "[RelayAgent] bash sandbox-deny (read-only requires OS sandbox): {:?}",
        sandbox_status.fallback_reason
    );
    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!(
            "bash: read-only session requires OS sandbox, but sandbox startup is unavailable. {}",
            sandbox_status
                .fallback_reason
                .clone()
                .unwrap_or_else(|| "No fallback available (fail-closed).".to_string())
        ),
    ))
}

fn prepare_command(
    command: &str,
    cwd: &std::path::Path,
    sandbox_status: &SandboxStatus,
    create_dirs: bool,
) -> Command {
    if create_dirs {
        prepare_sandbox_dirs(cwd);
    }

    if let Some(launcher) = build_linux_sandbox_command(command, cwd, sandbox_status) {
        let mut prepared = Command::new(launcher.program);
        prepared.args(launcher.args);
        prepared.current_dir(cwd);
        prepared.envs(launcher.env);
        return prepared;
    }

    let mut prepared = Command::new("sh");
    prepared.arg("-lc").arg(command).current_dir(cwd);
    if sandbox_status.filesystem_active {
        prepared.env("HOME", cwd.join(".sandbox-home"));
        prepared.env("TMPDIR", cwd.join(".sandbox-tmp"));
    }
    prepared
}

fn prepare_tokio_command(
    command: &str,
    cwd: &std::path::Path,
    sandbox_status: &SandboxStatus,
    create_dirs: bool,
) -> TokioCommand {
    if create_dirs {
        prepare_sandbox_dirs(cwd);
    }

    if let Some(launcher) = build_linux_sandbox_command(command, cwd, sandbox_status) {
        let mut prepared = TokioCommand::new(launcher.program);
        prepared.args(launcher.args);
        prepared.current_dir(cwd);
        prepared.envs(launcher.env);
        return prepared;
    }

    let mut prepared = TokioCommand::new("sh");
    prepared.arg("-lc").arg(command).current_dir(cwd);
    if sandbox_status.filesystem_active {
        prepared.env("HOME", cwd.join(".sandbox-home"));
        prepared.env("TMPDIR", cwd.join(".sandbox-tmp"));
    }
    prepared
}

fn prepare_sandbox_dirs(cwd: &std::path::Path) {
    let _ = std::fs::create_dir_all(cwd.join(".sandbox-home"));
    let _ = std::fs::create_dir_all(cwd.join(".sandbox-tmp"));
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::{ensure_sandbox_available_for_read_only, execute_bash, BashCommandInput};
    use crate::sandbox::FilesystemIsolationMode;

    #[test]
    fn executes_simple_command() {
        let output = execute_bash(BashCommandInput {
            command: String::from("printf 'hello'"),
            timeout: Some(1_000),
            description: None,
            run_in_background: Some(false),
            backgrounded_by: None,
            dangerously_disable_sandbox: Some(true),
            namespace_restrictions: Some(false),
            isolate_network: Some(false),
            filesystem_mode: Some(FilesystemIsolationMode::WorkspaceOnly),
            allowed_mounts: None,
        })
        .expect("bash command should execute");

        assert!(
            !output.stdout.is_empty() || !output.stderr.is_empty(),
            "expected command output in either stream"
        );
        assert!(!output.interrupted);
        assert!(output.sandbox_status.is_some());
    }

    #[test]
    fn disables_sandbox_when_requested() {
        let output = execute_bash(BashCommandInput {
            command: String::from("printf 'hello'"),
            timeout: Some(1_000),
            description: None,
            run_in_background: Some(false),
            backgrounded_by: None,
            dangerously_disable_sandbox: Some(true),
            namespace_restrictions: None,
            isolate_network: None,
            filesystem_mode: None,
            allowed_mounts: None,
        })
        .expect("bash command should execute");

        assert!(!output.sandbox_status.expect("sandbox status").enabled);
    }

    #[test]
    fn read_only_settings_block_mutating_bash() {
        let _lock = crate::test_env_lock();
        let root = std::env::temp_dir().join(format!("relay-bash-ro-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".claw")).expect("claw dir");
        std::fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"read-only"}"#,
        )
        .expect("write settings");
        let _guard = crate::BashConfigCwdGuard::set(Some(root.clone()));
        let err = execute_bash(BashCommandInput {
            command: String::from("rm -f scratch.txt"),
            timeout: Some(1_000),
            description: None,
            run_in_background: Some(false),
            backgrounded_by: None,
            dangerously_disable_sandbox: Some(false),
            namespace_restrictions: Some(false),
            isolate_network: Some(false),
            filesystem_mode: Some(FilesystemIsolationMode::WorkspaceOnly),
            allowed_mounts: None,
        })
        .expect_err("read-only should reject rm");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_only_fail_closed_when_sandbox_is_inactive() {
        let mut status = crate::sandbox::SandboxStatus::default();
        status.active = false;
        status.fallback_reason = Some("sandbox unavailable".to_string());
        let err = ensure_sandbox_available_for_read_only(true, &status)
            .expect_err("inactive sandbox must fail-closed in read-only mode");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        assert!(err.to_string().contains("requires OS sandbox"));
    }
}
