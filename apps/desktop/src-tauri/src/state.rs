use std::{path::PathBuf, sync::Mutex};

use crate::batch::BatchRegistry;
use crate::pipeline::PipelineRegistry;
use crate::risk_evaluator::ApprovalPolicy;
use crate::storage::AppStorage;

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
    pub storage: Mutex<AppStorage>,
    pub startup_preflight: Mutex<StartupPreflight>,
    pub pipeline_registry: Mutex<PipelineRegistry>,
    pub batch_registry: Mutex<BatchRegistry>,
    pub approval_policy: Mutex<ApprovalPolicy>,
    pub sample_workbook_path: Option<PathBuf>,
}

impl DesktopState {
    pub fn new(
        storage: AppStorage,
        startup_preflight: StartupPreflight,
        sample_workbook_path: Option<PathBuf>,
    ) -> Self {
        Self {
            initialized: Mutex::new(false),
            storage: Mutex::new(storage),
            startup_preflight: Mutex::new(startup_preflight),
            pipeline_registry: Mutex::new(PipelineRegistry::default()),
            batch_registry: Mutex::new(BatchRegistry::default()),
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
    use std::{env, fs};

    use uuid::Uuid;

    use super::StartupPreflight;

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
}
