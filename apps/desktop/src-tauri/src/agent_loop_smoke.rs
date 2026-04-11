use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Listener, Manager};

use crate::agent_loop::{
    AgentApprovalNeededEvent, AgentErrorEvent, AgentSessionStatusEvent, AgentTextDeltaEvent,
    AgentToolResultEvent, AgentToolStartEvent, AgentTurnCompleteEvent, E_APPROVAL_NEEDED, E_ERROR,
    E_STATUS, E_TEXT_DELTA, E_TOOL_RESULT, E_TOOL_START, E_TURN_COMPLETE,
};
use crate::models::{RespondAgentApprovalRequest, SessionPreset, StartAgentRequest};
use crate::registry::SessionRegistry;
use crate::tauri_bridge::{respond_approval_inner, start_agent_inner};

const SMOKE_EVENT_TIMEOUT: Duration = Duration::from_secs(45);
const SMOKE_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, PartialEq, Eq)]
struct SmokeConfig {
    summary_path: PathBuf,
    local_data_dir: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeStep {
    id: String,
    status: String,
    detail: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoopSmokeSummary {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_reason: Option<String>,
    steps: Vec<SmokeStep>,
    approval_seen: bool,
    completion_seen: bool,
    retry_recovered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_stop_reason: Option<String>,
    status_sequence: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_path: Option<String>,
    output_exists: bool,
    output_filtered_only: bool,
    source_unchanged: bool,
    tool_start_count: usize,
    tool_result_count: usize,
    text_delta_count: usize,
    approval_event_count: usize,
    completion_event_count: usize,
    error_event_count: usize,
    status_event_count: usize,
    retry_count: usize,
}

#[derive(Clone, Debug, Default)]
struct ObservedSmokeEvents {
    statuses: Vec<AgentSessionStatusEvent>,
    approvals: Vec<AgentApprovalNeededEvent>,
    completions: Vec<AgentTurnCompleteEvent>,
    errors: Vec<AgentErrorEvent>,
    tool_starts: Vec<AgentToolStartEvent>,
    tool_results: Vec<AgentToolResultEvent>,
    text_deltas: Vec<AgentTextDeltaEvent>,
}

#[derive(Debug)]
struct SmokeWorkspace {
    root: PathBuf,
    source_path: PathBuf,
    output_path: PathBuf,
    source_text: String,
    expected_output: String,
}

impl AgentLoopSmokeSummary {
    fn push_step(&mut self, id: &str, status: &str, detail: impl Into<String>) {
        self.steps.push(SmokeStep {
            id: id.to_string(),
            status: status.to_string(),
            detail: detail.into(),
        });
    }

    fn finish_failure(&mut self, id: &str, detail: impl Into<String>) {
        let detail = detail.into();
        self.push_step(id, "failed", detail.clone());
        self.status = "failed".to_string();
        self.failure_reason = Some(detail);
    }
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
    let Some(config) = SmokeConfig::from_env() else {
        return;
    };
    let Some(dir) = config.local_data_dir else {
        return;
    };
    if let Err(error) = fs::create_dir_all(&dir) {
        tracing::warn!(
            "[agent-loop-smoke] failed to create test local data dir {}: {error}",
            dir.display()
        );
        return;
    }
    std::env::set_var("HOME", &dir);
    #[cfg(windows)]
    {
        std::env::set_var("USERPROFILE", &dir);
        std::env::set_var("LOCALAPPDATA", &dir);
    }
}

pub fn spawn_if_configured(app: &AppHandle) {
    let Some(config) = SmokeConfig::from_env() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let summary = run_smoke(app, config.clone()).await;
        if let Err(error) = write_summary(&config.summary_path, &summary) {
            tracing::error!(
                "[agent-loop-smoke] failed to write summary {}: {error}",
                config.summary_path.display()
            );
        }
    });
}

async fn run_smoke(app: AppHandle, config: SmokeConfig) -> AgentLoopSmokeSummary {
    let mut summary = AgentLoopSmokeSummary {
        status: "failed".to_string(),
        ..AgentLoopSmokeSummary::default()
    };

    let registry = app.state::<SessionRegistry>().inner().clone();
    let observed = Arc::new(Mutex::new(ObservedSmokeEvents::default()));
    let listeners = register_event_listeners(&app, Arc::clone(&observed));

    let result = async {
        let workspace = initialize_workspace(&config)?;
        summary.push_step(
            "initialize-app",
            "ok",
            format!("workspace={}", workspace.root.display()),
        );
        summary.push_step(
            "locate-sample",
            "ok",
            format!("source={}", workspace.source_path.display()),
        );

        let goal = build_smoke_goal(&workspace);
        let request = StartAgentRequest {
            goal,
            files: Vec::new(),
            cwd: Some(workspace.root.to_string_lossy().into_owned()),
            browser_settings: None,
            max_turns: Some(4),
            session_preset: SessionPreset::Build,
        };

        let session_id = start_agent_inner(app.clone(), registry.clone(), request).await?;
        summary.session_id = Some(session_id.clone());
        summary.push_step("start-agent", "ok", format!("session={session_id}"));

        let approval = wait_for(
            || {
                observed
                    .lock()
                    .ok()
                    .and_then(|state| state.approvals.last().cloned())
            },
            SMOKE_EVENT_TIMEOUT,
        )
        .await
        .ok_or_else(|| "timed out waiting for approval event".to_string())?;
        summary.approval_seen = true;
        summary.push_step(
            "wait-approval",
            "ok",
            format!("tool={}", approval.tool_name),
        );

        respond_approval_inner(
            registry.clone(),
            RespondAgentApprovalRequest {
                session_id: session_id.clone(),
                approval_id: approval.approval_id.clone(),
                approved: true,
                remember_for_session: Some(false),
                remember_for_workspace: Some(false),
            },
        )?;
        summary.push_step(
            "respond-approval",
            "ok",
            format!("approval={}", approval.approval_id),
        );

        let completion = wait_for(
            || {
                observed
                    .lock()
                    .ok()
                    .and_then(|state| state.completions.last().cloned())
            },
            SMOKE_EVENT_TIMEOUT,
        )
        .await
        .ok_or_else(|| "timed out waiting for turn completion".to_string())?;
        summary.completion_seen = true;
        summary.final_stop_reason = Some(completion.stop_reason.clone());
        summary.push_step(
            "wait-complete",
            "ok",
            format!("stopReason={}", completion.stop_reason),
        );

        let session_state = registry
            .get_session(&session_id, |entry| {
                (
                    entry.retry_count,
                    entry.last_stop_reason.clone(),
                    entry.last_error_summary.clone(),
                )
            })
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("session `{session_id}` missing after smoke run"))?;

        let observed_state = observed
            .lock()
            .map_err(|error| format!("smoke event state lock poisoned: {error}"))?
            .clone();
        summary.tool_start_count = observed_state.tool_starts.len();
        summary.tool_result_count = observed_state.tool_results.len();
        summary.text_delta_count = observed_state.text_deltas.len();
        summary.approval_event_count = observed_state.approvals.len();
        summary.completion_event_count = observed_state.completions.len();
        summary.error_event_count = observed_state.errors.len();
        summary.status_event_count = observed_state.statuses.len();
        summary.retry_count = session_state.0;
        summary.retry_recovered = session_state.0 > 0;
        summary.status_sequence = observed_state
            .statuses
            .iter()
            .map(|evt| match evt.stop_reason.as_deref() {
                Some(reason) => format!("{}:{reason}", evt.phase),
                None => evt.phase.clone(),
            })
            .collect();

        let final_stop_reason = session_state.1.unwrap_or_default();
        if final_stop_reason != "completed" {
            return Err(format!(
                "expected completed stop reason, got `{final_stop_reason}`"
            ));
        }
        if !summary.retry_recovered {
            return Err("smoke run did not record transient retry recovery".to_string());
        }
        if !observed_state.errors.is_empty() {
            let first = &observed_state.errors[0];
            return Err(format!("unexpected agent:error event: {}", first.error));
        }
        if summary.tool_start_count == 0 || summary.tool_result_count == 0 {
            return Err("smoke run did not observe tool_start/tool_result events".to_string());
        }
        if summary.text_delta_count == 0 {
            return Err("smoke run did not observe text delta events".to_string());
        }
        for required in ["running", "retrying", "waiting_approval", "idle:completed"] {
            if !summary
                .status_sequence
                .iter()
                .any(|phase| phase == required)
            {
                return Err(format!(
                    "smoke run did not observe required status `{required}`"
                ));
            }
        }
        summary.push_step(
            "verify-events",
            "ok",
            format!(
                "toolStarts={}, toolResults={}, textDeltas={}, retries={}, statuses={}",
                summary.tool_start_count,
                summary.tool_result_count,
                summary.text_delta_count,
                summary.retry_count,
                summary.status_sequence.join(" -> ")
            ),
        );

        let output_text = fs::read_to_string(&workspace.output_path).map_err(|error| {
            format!(
                "failed to read smoke output {}: {error}",
                workspace.output_path.display()
            )
        })?;
        summary.output_path = Some(workspace.output_path.to_string_lossy().into_owned());
        summary.output_exists = workspace.output_path.is_file();
        summary.output_filtered_only = output_text == workspace.expected_output;
        if !summary.output_exists || !summary.output_filtered_only {
            return Err(format!(
                "unexpected output content at {}",
                workspace.output_path.display()
            ));
        }
        summary.push_step(
            "verify-output",
            "ok",
            format!("output={}", workspace.output_path.display()),
        );

        let source_text = fs::read_to_string(&workspace.source_path).map_err(|error| {
            format!(
                "failed to read smoke source {}: {error}",
                workspace.source_path.display()
            )
        })?;
        summary.source_unchanged = source_text == workspace.source_text;
        if !summary.source_unchanged {
            return Err(format!(
                "source file changed unexpectedly: {}",
                workspace.source_path.display()
            ));
        }
        summary.push_step(
            "verify-source",
            "ok",
            format!("source={}", workspace.source_path.display()),
        );

        if let Some(last_error) = session_state.2 {
            tracing::info!(
                "[agent-loop-smoke] last error summary recorded during retry: {last_error}"
            );
        }

        Ok::<(), String>(())
    }
    .await;

    for listener in listeners {
        app.unlisten(listener);
    }

    if let Err(error) = result {
        let step_id = if summary.steps.iter().any(|step| step.id == "wait-complete") {
            "verify-events"
        } else if summary
            .steps
            .iter()
            .any(|step| step.id == "respond-approval")
        {
            "wait-complete"
        } else if summary.steps.iter().any(|step| step.id == "wait-approval") {
            "respond-approval"
        } else if summary.steps.iter().any(|step| step.id == "start-agent") {
            "wait-approval"
        } else {
            "initialize-app"
        };
        summary.finish_failure(step_id, error);
        return summary;
    }

    summary.status = "ok".to_string();
    summary.failure_reason = None;
    summary
}

fn initialize_workspace(config: &SmokeConfig) -> Result<SmokeWorkspace, String> {
    let root = config
        .local_data_dir
        .clone()
        .unwrap_or_else(std::env::temp_dir)
        .join("agent-loop-smoke");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create smoke workspace {}: {error}",
            root.display()
        )
    })?;

    let source_path = root.join("source.txt");
    let output_path = root.join("source.filtered.txt");
    let source_text = "DROP: archive\nKEEP: alpha\nKEEP: beta\nDROP: footer\n".to_string();
    let expected_output = "KEEP: alpha\nKEEP: beta\n".to_string();

    fs::write(&source_path, &source_text).map_err(|error| {
        format!(
            "failed to write smoke source fixture {}: {error}",
            source_path.display()
        )
    })?;
    let _ = fs::remove_file(&output_path);

    Ok(SmokeWorkspace {
        root,
        source_path,
        output_path,
        source_text,
        expected_output,
    })
}

fn build_smoke_goal(workspace: &SmokeWorkspace) -> String {
    let encoded_output =
        base64::engine::general_purpose::STANDARD.encode(workspace.expected_output.as_bytes());
    format!(
        concat!(
            "Agent loop smoke task.\n",
            "SOURCE_PATH={source}\n",
            "OUTPUT_PATH={output}\n",
            "EXPECTED_OUTPUT_BASE64={expected}\n\n",
            "Read the source file, then save a filtered copy that keeps only the KEEP: lines."
        ),
        source = workspace.source_path.display(),
        output = workspace.output_path.display(),
        expected = encoded_output,
    )
}

fn register_event_listeners(
    app: &AppHandle,
    observed: Arc<Mutex<ObservedSmokeEvents>>,
) -> Vec<tauri::EventId> {
    let mut listeners = Vec::new();

    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_STATUS, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentSessionStatusEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.statuses.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_APPROVAL_NEEDED, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentApprovalNeededEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.approvals.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_TURN_COMPLETE, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentTurnCompleteEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.completions.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_TOOL_START, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentToolStartEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.tool_starts.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_TOOL_RESULT, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentToolResultEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.tool_results.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_TEXT_DELTA, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentTextDeltaEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.text_deltas.push(payload);
                }
            }
        }));
    }
    {
        let observed = Arc::clone(&observed);
        listeners.push(app.listen_any(E_ERROR, move |event| {
            if let Ok(payload) = serde_json::from_str::<AgentErrorEvent>(event.payload()) {
                if let Ok(mut state) = observed.lock() {
                    state.errors.push(payload);
                }
            }
        }));
    }

    listeners
}

async fn wait_for<T, F>(mut check: F, timeout: Duration) -> Option<T>
where
    F: FnMut() -> Option<T>,
{
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = check() {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(SMOKE_POLL_INTERVAL).await;
    }
}

fn write_summary(path: &Path, summary: &AgentLoopSmokeSummary) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create summary directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let json = serde_json::to_string_pretty(summary)
        .map_err(|error| format!("failed to serialize smoke summary: {error}"))?;
    fs::write(path, json)
        .map_err(|error| format!("failed to write summary {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{AgentLoopSmokeSummary, SmokeConfig};

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
    fn summary_records_success_and_failure_steps() {
        let mut summary = AgentLoopSmokeSummary {
            status: "failed".to_string(),
            ..AgentLoopSmokeSummary::default()
        };
        summary.push_step("initialize-app", "ok", "workspace ready");
        summary.finish_failure("wait-approval", "approval timed out");
        assert_eq!(summary.steps.len(), 2);
        assert_eq!(summary.steps[0].status, "ok");
        assert_eq!(summary.steps[1].status, "failed");
        assert_eq!(
            summary.failure_reason.as_deref(),
            Some("approval timed out")
        );
    }
}
