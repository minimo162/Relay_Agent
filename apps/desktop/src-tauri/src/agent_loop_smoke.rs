#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

#[derive(Clone, Debug, PartialEq, Eq)]
struct SmokeConfig {
    summary_path: PathBuf,
    local_data_dir: Option<PathBuf>,
}

impl SmokeConfig {
    fn from_env() -> Option<Self> {
        Self::from_env_values(
            std::env::var("RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE").ok(),
            std::env::var("RELAY_AGENT_AGENT_LOOP_SMOKE_SUMMARY_PATH").ok(),
            std::env::var("RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR").ok(),
        )
    }

    fn from_env_values(
        autorun_flag: Option<String>,
        summary_path: Option<String>,
        local_data_dir: Option<String>,
    ) -> Option<Self> {
        if autorun_flag.as_deref().map(str::trim) != Some("1") {
            return None;
        }
        let summary_path = summary_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())?;
        let local_data_dir = local_data_dir
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        Some(Self {
            summary_path: PathBuf::from(summary_path),
            local_data_dir,
        })
    }
}

pub fn apply_test_app_local_data_dir_override() {
    let local_data_dir = std::env::var("RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| SmokeConfig::from_env().and_then(|config| config.local_data_dir));
    let Some(dir) = local_data_dir else {
        return;
    };
    crate::test_support::apply_test_app_local_data_dir_override(&dir);
}

pub fn spawn_if_configured<R: Runtime>(app: &AppHandle<R>) {
    let Some(config) = SmokeConfig::from_env() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let summary = crate::test_support::run_agent_loop_smoke(app, config.local_data_dir).await;
        if let Err(error) = crate::test_support::write_summary(&config.summary_path, &summary) {
            tracing::error!(
                "[agent-loop-smoke] failed to write summary {}: {error}",
                config.summary_path.display()
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::SmokeConfig;
    use crate::test_support::AgentLoopSmokeSummary;

    #[test]
    fn smoke_config_requires_flag_and_summary_path() {
        assert_eq!(
            SmokeConfig::from_env_values(
                Some("1".to_string()),
                Some("/tmp/agent-loop-summary.json".to_string()),
                Some("/tmp/app-data".to_string())
            )
            .expect("config should load")
            .summary_path
            .to_string_lossy(),
            "/tmp/agent-loop-summary.json"
        );
        assert!(SmokeConfig::from_env_values(None, Some("/tmp/x".to_string()), None).is_none());
        assert!(SmokeConfig::from_env_values(
            Some("0".to_string()),
            Some("/tmp/x".to_string()),
            None
        )
        .is_none());
        assert!(SmokeConfig::from_env_values(Some("1".to_string()), None, None).is_none());
    }

    #[test]
    fn summary_type_still_supports_failure_recording() {
        let mut summary = AgentLoopSmokeSummary {
            status: "failed".to_string(),
            ..AgentLoopSmokeSummary::default()
        };
        summary.push_step("initialize-app", "ok", "workspace ready");
        summary.finish_failure("wait-approval", "approval timed out");
        assert_eq!(summary.steps.len(), 2);
        assert_eq!(
            summary.failure_reason.as_deref(),
            Some("approval timed out")
        );
    }

    #[test]
    fn wrapper_creates_and_runs_mock_app_harness() {
        let app = crate::test_support::create_test_app();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let root = tempfile::tempdir().expect("tempdir");
        let summary = runtime.block_on(crate::test_support::run_agent_loop_smoke(
            app.handle().clone(),
            Some(root.path().to_path_buf()),
        ));
        assert_eq!(summary.status, "ok");
        assert!(summary.retry_recovered);
        assert_eq!(summary.final_stop_reason.as_deref(), Some("completed"));
    }
}
