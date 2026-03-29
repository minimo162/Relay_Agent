use serde::Serialize;
use tauri::State;

use crate::models::RelayMode;
use crate::state::{
    DesktopState, StartupIssue, StartupRecoveryAction as StateStartupRecoveryAction,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupStatus {
    Ready,
    Attention,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupRecoveryAction {
    RetryInit,
    ContinueTemporaryMode,
    OpenSettings,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeAppStartupIssue {
    pub problem: String,
    pub reason: String,
    pub next_steps: Vec<String>,
    pub recovery_actions: Vec<StartupRecoveryAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeAppResponse {
    pub app_name: &'static str,
    pub initialized: bool,
    pub storage_ready: bool,
    pub storage_mode: &'static str,
    pub session_count: usize,
    pub supported_relay_modes: Vec<RelayMode>,
    pub startup_status: StartupStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_issue: Option<InitializeAppStartupIssue>,
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn initialize_app(state: State<'_, DesktopState>) -> InitializeAppResponse {
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
        session_count: storage.session_count(),
        supported_relay_modes: vec![
            RelayMode::Discover,
            RelayMode::Plan,
            RelayMode::Repair,
            RelayMode::Followup,
        ],
        startup_status,
        startup_issue,
    }
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
