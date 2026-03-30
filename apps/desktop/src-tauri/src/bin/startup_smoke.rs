use std::{env, fs, path::PathBuf};

use serde::Serialize;
use uuid::Uuid;

use relay_agent_desktop_lib::{
    bootstrap_desktop_state, bootstrap_retry_recovery_state, build_initialize_app_response,
    discover_sample_workbook_path_from_candidates, StartupRecoveryAction, StartupStatus,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupSmokeSummary {
    scenario: &'static str,
    status: &'static str,
    startup_status: StartupStatus,
    storage_mode: &'static str,
    storage_ready: bool,
    has_startup_issue: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_workbook_path: Option<String>,
}

fn unique_test_path(tag: &str) -> PathBuf {
    env::temp_dir().join(format!("relay-agent-{tag}-{}", Uuid::new_v4()))
}

fn repo_sample_workbook_path() -> Option<PathBuf> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");

    discover_sample_workbook_path_from_candidates([
        repo_root.join("examples").join("revenue-workflow-demo.csv"),
        repo_root
            .join("apps")
            .join("desktop")
            .join("examples")
            .join("revenue-workflow-demo.csv"),
    ])
}

fn ready_scenario() -> Result<StartupSmokeSummary, String> {
    let app_data_dir = unique_test_path("startup-smoke-ready");
    let response = build_initialize_app_response(&bootstrap_desktop_state(
        Ok(app_data_dir.clone()),
        repo_sample_workbook_path(),
    ));

    if response.startup_status != StartupStatus::Ready {
        return Err("ready scenario did not return `ready` startup status".to_string());
    }
    if !response.storage_ready || response.storage_mode != "local-json" {
        return Err("ready scenario did not keep local-json storage ready".to_string());
    }
    if response.sample_workbook_path.is_none() {
        return Err("ready scenario could not discover the bundled sample workbook".to_string());
    }

    fs::remove_dir_all(app_data_dir).map_err(|error| {
        format!("ready scenario could not clean up startup test storage: {error}")
    })?;

    Ok(StartupSmokeSummary {
        scenario: "ready",
        status: "ok",
        startup_status: response.startup_status,
        storage_mode: response.storage_mode,
        storage_ready: response.storage_ready,
        has_startup_issue: response.startup_issue.is_some(),
        sample_workbook_path: response.sample_workbook_path,
    })
}

fn retry_recovery_scenario() -> Result<StartupSmokeSummary, String> {
    let app_data_dir = unique_test_path("startup-smoke-retry");
    let response = build_initialize_app_response(&bootstrap_retry_recovery_state(
        app_data_dir.clone(),
        repo_sample_workbook_path(),
    ));

    if response.startup_status != StartupStatus::Ready {
        return Err("retry-recovery scenario did not recover to `ready`".to_string());
    }
    if !response.storage_ready || response.startup_issue.is_some() {
        return Err("retry-recovery scenario did not clear the startup issue".to_string());
    }

    fs::remove_dir_all(app_data_dir).map_err(|error| {
        format!("retry-recovery scenario could not clean up startup test storage: {error}")
    })?;

    Ok(StartupSmokeSummary {
        scenario: "retry-recovery",
        status: "ok",
        startup_status: response.startup_status,
        storage_mode: response.storage_mode,
        storage_ready: response.storage_ready,
        has_startup_issue: response.startup_issue.is_some(),
        sample_workbook_path: response.sample_workbook_path,
    })
}

fn attention_scenario() -> Result<StartupSmokeSummary, String> {
    let blocked_path = unique_test_path("startup-smoke-attention");
    fs::write(&blocked_path, "not-a-directory").map_err(|error| {
        format!("attention scenario could not create blocked startup file: {error}")
    })?;

    let response = build_initialize_app_response(&bootstrap_desktop_state(
        Ok(blocked_path.clone()),
        repo_sample_workbook_path(),
    ));

    if response.startup_status != StartupStatus::Attention {
        return Err("attention scenario did not return `attention` startup status".to_string());
    }
    if response.storage_ready || response.storage_mode != "memory" {
        return Err("attention scenario did not fall back to temporary memory storage".to_string());
    }
    if !response
        .startup_issue
        .as_ref()
        .map(|issue| {
            issue
                .recovery_actions
                .contains(&StartupRecoveryAction::RetryInit)
        })
        .unwrap_or(false)
    {
        return Err("attention scenario did not include retry recovery guidance".to_string());
    }
    if !response
        .startup_issue
        .as_ref()
        .map(|issue| {
            issue
                .recovery_actions
                .contains(&StartupRecoveryAction::ContinueTemporaryMode)
        })
        .unwrap_or(false)
    {
        return Err("attention scenario did not include temporary-mode guidance".to_string());
    }

    fs::remove_file(blocked_path).map_err(|error| {
        format!("attention scenario could not clean up blocked startup file: {error}")
    })?;

    Ok(StartupSmokeSummary {
        scenario: "attention",
        status: "ok",
        startup_status: response.startup_status,
        storage_mode: response.storage_mode,
        storage_ready: response.storage_ready,
        has_startup_issue: response.startup_issue.is_some(),
        sample_workbook_path: response.sample_workbook_path,
    })
}

fn main() {
    let scenarios = [
        ready_scenario(),
        retry_recovery_scenario(),
        attention_scenario(),
    ];

    for scenario in scenarios {
        match scenario {
            Ok(summary) => {
                println!(
                    "{}",
                    serde_json::to_string(&summary)
                        .expect("startup smoke summary should serialize")
                );
            }
            Err(error) => {
                eprintln!("startup smoke failed: {error}");
                std::process::exit(1);
            }
        }
    }
}
