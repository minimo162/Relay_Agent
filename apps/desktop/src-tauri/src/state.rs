use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::batch::BatchRegistry;
use crate::pipeline::PipelineRegistry;
use crate::risk_evaluator::ApprovalPolicy;
use crate::storage::AppStorage;
use crate::tauri_bridge::AgentRuntimeState;

#[derive(Clone, Debug)]
pub enum StartupRecoveryAction {
    RetryInit,
    ContinueTemporaryMode,
    OpenSettings,
}

#[derive(Clone, Debug)]
pub struct StartupIssue {
    pub problem: String,
    pub reason: String,
    pub next_steps: Vec<String>,
    pub recovery_actions: Vec<StartupRecoveryAction>,
    pub storage_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct StartupPreflight {
    app_local_data_dir: Option<PathBuf>,
    issue: Option<StartupIssue>,
}

impl StartupPreflight {
    pub fn ready(app_local_data_dir: Option<PathBuf>) -> Self {
        Self {
            app_local_data_dir,
            issue: None,
        }
    }

    pub fn storage_unavailable(app_local_data_dir: PathBuf, error: String) -> Self {
        Self {
            app_local_data_dir: Some(app_local_data_dir.clone()),
            issue: Some(build_storage_issue(Some(app_local_data_dir), error)),
        }
    }

    pub fn path_unavailable(error: String) -> Self {
        Self {
            app_local_data_dir: None,
            issue: Some(StartupIssue {
                problem: "Saved work is not available yet.".to_string(),
                reason: format!(
                    "Relay Agent could not locate its app data folder during startup: {error}"
                ),
                next_steps: vec![
                    "Restart the app once and check whether the problem clears.".to_string(),
                    "If you only need a quick test, continue in temporary mode. Temporary sessions will not survive restart.".to_string(),
                    "If the issue keeps happening, open Settings and contact support with the startup details.".to_string(),
                ],
                recovery_actions: vec![
                    StartupRecoveryAction::ContinueTemporaryMode,
                    StartupRecoveryAction::OpenSettings,
                ],
                storage_path: None,
            }),
        }
    }

    pub fn issue(&self) -> Option<&StartupIssue> {
        self.issue.as_ref()
    }

    pub fn retry_storage_recovery(&mut self) -> Option<AppStorage> {
        if self.issue.is_none() {
            return None;
        }

        let app_local_data_dir = self.app_local_data_dir.clone()?;
        match AppStorage::open(app_local_data_dir.clone()) {
            Ok(storage) => {
                self.issue = None;
                Some(storage)
            }
            Err(error) => {
                self.issue = Some(build_storage_issue(Some(app_local_data_dir), error));
                None
            }
        }
    }
}

pub struct DesktopState {
    pub initialized: Mutex<bool>,
    pub storage: Arc<Mutex<AppStorage>>,
    pub startup_preflight: Mutex<StartupPreflight>,
    pub pipeline_registry: Mutex<PipelineRegistry>,
    pub batch_registry: Mutex<BatchRegistry>,
    pub claw_tool_registry: Arc<claw_tools::ToolRegistry>,
    pub agent_runtime: Arc<AgentRuntimeState>,
    pub approval_policy: Mutex<ApprovalPolicy>,
    pub sample_workbook_path: Option<PathBuf>,
}

impl DesktopState {
    pub fn new(
        storage: AppStorage,
        startup_preflight: StartupPreflight,
        sample_workbook_path: Option<PathBuf>,
    ) -> Self {
        let storage = Arc::new(Mutex::new(storage));
        Self {
            initialized: Mutex::new(false),
            storage: Arc::clone(&storage),
            startup_preflight: Mutex::new(startup_preflight),
            pipeline_registry: Mutex::new(PipelineRegistry::default()),
            batch_registry: Mutex::new(BatchRegistry::default()),
            claw_tool_registry: build_claw_tool_registry(Arc::clone(&storage)),
            agent_runtime: Arc::new(AgentRuntimeState::default()),
            approval_policy: Mutex::new(ApprovalPolicy::default()),
            sample_workbook_path,
        }
    }
}

impl Default for DesktopState {
    fn default() -> Self {
        Self::new(AppStorage::default(), StartupPreflight::ready(None), None)
    }
}

fn build_claw_tool_registry(storage: Arc<Mutex<AppStorage>>) -> Arc<claw_tools::ToolRegistry> {
    let _ = storage;
    let mut registry = claw_tools::ToolRegistry::new();
    claw_tools::register_builtin_tools(&mut registry);
    Arc::new(registry)
}

fn build_storage_issue(storage_path: Option<PathBuf>, error: String) -> StartupIssue {
    StartupIssue {
        problem: "Saved work is not available yet.".to_string(),
        reason: format!(
            "Relay Agent could not open its local storage folder during startup: {error}"
        ),
        next_steps: vec![
            "Retry startup checks after confirming your profile and app data folder are available."
                .to_string(),
            "If you only need a quick test, continue in temporary mode. Temporary sessions will not survive restart.".to_string(),
            "If the problem continues, open Settings and share the storage path with support."
                .to_string(),
        ],
        recovery_actions: vec![
            StartupRecoveryAction::RetryInit,
            StartupRecoveryAction::ContinueTemporaryMode,
            StartupRecoveryAction::OpenSettings,
        ],
        storage_path,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        sync::{Arc, Mutex},
    };

    use crate::storage::AppStorage;
    use claw_permissions::{PermissionMode, RuleBasedPolicy};
    use claw_tools::{ToolContext, ToolOutput};
    use serde_json::{json, Value};
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{build_claw_tool_registry, DesktopState, StartupPreflight};
    fn unique_test_app_data_dir() -> std::path::PathBuf {
        env::temp_dir().join(format!("relay-agent-startup-{}", Uuid::new_v4()))
    }

    #[test]
    fn retry_storage_recovery_clears_issue_once_storage_opens() {
        let app_data_dir = unique_test_app_data_dir();
        let mut startup_preflight = StartupPreflight::storage_unavailable(
            app_data_dir.clone(),
            "simulated startup failure".to_string(),
        );

        let recovered_storage = startup_preflight.retry_storage_recovery();

        assert!(recovered_storage.is_some());
        assert!(startup_preflight.issue().is_none());

        fs::remove_dir_all(app_data_dir).expect("test storage should clean up");
    }

    #[test]
    fn path_unavailable_issue_does_not_retry_storage_open() {
        let mut startup_preflight =
            StartupPreflight::path_unavailable("missing app data path".to_string());

        let recovered_storage = startup_preflight.retry_storage_recovery();

        assert!(recovered_storage.is_none());
        assert!(startup_preflight.issue().is_some());
    }

    #[test]
    fn claw_tool_registry_registers_expected_builtins() {
        let registry = build_claw_tool_registry(Arc::new(Mutex::new(AppStorage::default())));

        for tool_name in [
            "bash",
            "file_read",
            "file_write",
            "file_edit",
            "glob",
            "grep",
        ] {
            assert!(
                registry.get(tool_name).is_some(),
                "expected claw builtin `{tool_name}` to be registered"
            );
        }
    }

    fn tool_context(session_id: &str, cwd: std::path::PathBuf) -> ToolContext {
        ToolContext {
            cwd,
            permissions: Arc::new(RuleBasedPolicy::new(PermissionMode::AutoApprove)),
            session_id: session_id.to_string(),
        }
    }

    async fn execute_tool(
        registry: &claw_tools::ToolRegistry,
        ctx: &ToolContext,
        tool_name: &str,
        input: Value,
    ) -> ToolOutput {
        registry
            .get(tool_name)
            .unwrap_or_else(|| panic!("tool `{tool_name}` should be registered"))
            .execute(ctx, input)
            .await
            .unwrap_or_else(|error| panic!("tool `{tool_name}` should execute: {error}"))
    }

    #[tokio::test]
    async fn claw_tool_registry_executes_builtin_tools_end_to_end() {
        let workspace = tempdir().expect("temp dir should exist");
        let read_path = workspace.path().join("read.txt");
        let write_path = workspace.path().join("written.txt");
        let nested_dir = workspace.path().join("nested");
        fs::create_dir_all(&nested_dir).expect("nested dir should exist");
        fs::write(&read_path, "alpha\nbeta\n").expect("read fixture should be written");

        let state = DesktopState::default();
        let ctx = tool_context("builtin-e2e", workspace.path().to_path_buf());

        let bash = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "bash",
            json!({ "command": "printf builtin-ok" }),
        )
        .await;
        assert!(!bash.is_error);
        assert!(bash.content.contains("builtin-ok"));

        let file_read = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "file_read",
            json!({ "path": read_path.to_string_lossy().to_string() }),
        )
        .await;
        assert!(!file_read.is_error);
        assert!(file_read.content.contains("alpha"));
        assert!(file_read.content.contains("beta"));

        let file_write = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "file_write",
            json!({
                "path": write_path.to_string_lossy().to_string(),
                "content": "hello world\n"
            }),
        )
        .await;
        assert!(!file_write.is_error);
        assert_eq!(
            fs::read_to_string(&write_path).expect("written file should exist"),
            "hello world\n"
        );

        let file_edit = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "file_edit",
            json!({
                "path": write_path.to_string_lossy().to_string(),
                "old_string": "hello world",
                "new_string": "hello relay"
            }),
        )
        .await;
        assert!(!file_edit.is_error);
        assert_eq!(
            fs::read_to_string(&write_path).expect("edited file should exist"),
            "hello relay\n"
        );

        let glob = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "glob",
            json!({
                "path": workspace.path().to_string_lossy().to_string(),
                "pattern": "**/*.txt"
            }),
        )
        .await;
        assert!(!glob.is_error);
        assert!(glob.content.contains("read.txt"));
        assert!(glob.content.contains("written.txt"));

        let grep = execute_tool(
            &state.claw_tool_registry,
            &ctx,
            "grep",
            json!({
                "path": workspace.path().to_string_lossy().to_string(),
                "pattern": "relay",
                "glob": "*.txt"
            }),
        )
        .await;
        assert!(!grep.is_error);
        assert!(grep.content.contains("written.txt"));
        assert!(grep.content.contains("hello relay"));
    }
}
