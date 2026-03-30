use std::path::PathBuf;

use serde::Serialize;

use crate::models::RelayMode;
use crate::state::{
    DesktopState, StartupIssue, StartupPreflight,
    StartupRecoveryAction as StateStartupRecoveryAction,
};
use crate::storage::AppStorage;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupStatus {
    Ready,
    Attention,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupRecoveryAction {
    RetryInit,
    ContinueTemporaryMode,
    OpenSettings,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeAppStartupIssue {
    pub problem: String,
    pub reason: String,
    pub next_steps: Vec<String>,
    pub recovery_actions: Vec<StartupRecoveryAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_path: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeAppResponse {
    pub app_name: &'static str,
    pub initialized: bool,
    pub storage_ready: bool,
    pub storage_mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_path: Option<String>,
    pub session_count: usize,
    pub supported_relay_modes: Vec<RelayMode>,
    pub startup_status: StartupStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_issue: Option<InitializeAppStartupIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_workbook_path: Option<String>,
}

pub fn bootstrap_desktop_state(
    app_local_data_dir: Result<PathBuf, String>,
    sample_workbook_path: Option<PathBuf>,
) -> DesktopState {
    let (storage, startup_preflight) = match app_local_data_dir {
        Ok(app_local_data_dir) => match AppStorage::open(app_local_data_dir.clone()) {
            Ok(storage) => (storage, StartupPreflight::ready(Some(app_local_data_dir))),
            Err(error) => (
                AppStorage::default(),
                StartupPreflight::storage_unavailable(app_local_data_dir, error),
            ),
        },
        Err(error) => (
            AppStorage::default(),
            StartupPreflight::path_unavailable(error),
        ),
    };

    DesktopState::new(storage, startup_preflight, sample_workbook_path)
}

pub fn bootstrap_retry_recovery_state(
    app_local_data_dir: PathBuf,
    sample_workbook_path: Option<PathBuf>,
) -> DesktopState {
    DesktopState::new(
        AppStorage::default(),
        StartupPreflight::storage_unavailable(
            app_local_data_dir,
            "simulated startup failure before retry".to_string(),
        ),
        sample_workbook_path,
    )
}

pub fn build_initialize_app_response(state: &DesktopState) -> InitializeAppResponse {
    let mut initialized = state.initialized.lock().expect("desktop state poisoned");
    let mut startup_preflight = state
        .startup_preflight
        .lock()
        .expect("startup preflight state poisoned");
    let mut storage = state.storage.lock().expect("desktop storage poisoned");

    if let Some(recovered_storage) = startup_preflight.retry_storage_recovery() {
        *storage = recovered_storage;
    }

    *initialized = true;
    let startup_issue = startup_preflight
        .issue()
        .map(InitializeAppStartupIssue::from_state_issue);
    let startup_status = if startup_issue.is_some() {
        StartupStatus::Attention
    } else {
        StartupStatus::Ready
    };

    InitializeAppResponse {
        app_name: "Relay Agent",
        initialized: *initialized,
        storage_ready: storage.storage_ready() && startup_issue.is_none(),
        storage_mode: storage.storage_mode(),
        storage_path: storage.storage_path(),
        session_count: storage.session_count(),
        supported_relay_modes: vec![
            RelayMode::Discover,
            RelayMode::Plan,
            RelayMode::Repair,
            RelayMode::Followup,
        ],
        startup_status,
        startup_issue,
        sample_workbook_path: state
            .sample_workbook_path
            .as_ref()
            .map(|path| path.display().to_string()),
    }
}

pub fn discover_sample_workbook_path_from_candidates<I>(candidates: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = PathBuf>,
{
    candidates.into_iter().find(|path| path.is_file())
}

impl InitializeAppStartupIssue {
    fn from_state_issue(issue: &StartupIssue) -> Self {
        Self {
            problem: issue.problem.clone(),
            reason: issue.reason.clone(),
            next_steps: issue.next_steps.clone(),
            recovery_actions: issue
                .recovery_actions
                .iter()
                .map(|action| match action {
                    StateStartupRecoveryAction::RetryInit => StartupRecoveryAction::RetryInit,
                    StateStartupRecoveryAction::ContinueTemporaryMode => {
                        StartupRecoveryAction::ContinueTemporaryMode
                    }
                    StateStartupRecoveryAction::OpenSettings => StartupRecoveryAction::OpenSettings,
                })
                .collect(),
            storage_path: issue
                .storage_path
                .as_ref()
                .map(|path| path.display().to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use uuid::Uuid;

    use super::{
        bootstrap_desktop_state, bootstrap_retry_recovery_state, build_initialize_app_response,
        discover_sample_workbook_path_from_candidates, StartupRecoveryAction, StartupStatus,
    };

    fn unique_test_path(tag: &str) -> PathBuf {
        env::temp_dir().join(format!("relay-agent-{tag}-{}", Uuid::new_v4()))
    }

    #[test]
    fn ready_startup_response_reports_local_storage_and_sample_path() {
        let app_data_dir = unique_test_path("startup-ready");
        let sample_path = unique_test_path("startup-sample").with_extension("csv");
        fs::write(&sample_path, "customer_id,amount\n1,42.5\n").expect("sample csv should exist");

        let discovered_sample = discover_sample_workbook_path_from_candidates([
            sample_path.clone(),
            unique_test_path("missing-sample"),
        ]);
        let state = bootstrap_desktop_state(Ok(app_data_dir.clone()), discovered_sample.clone());
        let response = build_initialize_app_response(&state);

        assert_eq!(response.startup_status, StartupStatus::Ready);
        assert!(response.storage_ready);
        assert_eq!(response.storage_mode, "local-json");
        assert_eq!(
            response.sample_workbook_path,
            discovered_sample.map(|path| path.to_string_lossy().into_owned())
        );

        fs::remove_dir_all(app_data_dir).expect("startup test storage should clean up");
        fs::remove_file(sample_path).expect("startup sample should clean up");
    }

    #[test]
    fn retry_recovery_startup_response_returns_to_ready() {
        let app_data_dir = unique_test_path("startup-retry");
        let state = bootstrap_retry_recovery_state(app_data_dir.clone(), None);
        let response = build_initialize_app_response(&state);

        assert_eq!(response.startup_status, StartupStatus::Ready);
        assert!(response.storage_ready);
        assert_eq!(response.storage_mode, "local-json");
        assert!(response.startup_issue.is_none());

        fs::remove_dir_all(app_data_dir).expect("retry startup storage should clean up");
    }

    #[test]
    fn attention_startup_response_reports_recovery_actions() {
        let blocked_path = unique_test_path("startup-blocked");
        fs::write(&blocked_path, "not-a-directory").expect("blocked test file should exist");

        let state = bootstrap_desktop_state(Ok(blocked_path.clone()), None);
        let response = build_initialize_app_response(&state);

        assert_eq!(response.startup_status, StartupStatus::Attention);
        assert!(!response.storage_ready);
        assert_eq!(response.storage_mode, "memory");
        assert!(response.startup_issue.is_some());
        assert!(response
            .startup_issue
            .as_ref()
            .map(|issue| issue
                .recovery_actions
                .contains(&StartupRecoveryAction::RetryInit))
            .unwrap_or(false));
        assert!(response
            .startup_issue
            .as_ref()
            .map(|issue| issue
                .recovery_actions
                .contains(&StartupRecoveryAction::ContinueTemporaryMode))
            .unwrap_or(false));

        fs::remove_file(blocked_path).expect("blocked startup file should clean up");
    }
}
