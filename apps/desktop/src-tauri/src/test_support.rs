#![allow(
    clippy::needless_pass_by_value,
    clippy::struct_excessive_bools,
    clippy::too_many_lines
)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Listener, Manager, Runtime};

use crate::agent_loop::{
    AgentApprovalNeededEvent, AgentErrorEvent, AgentSessionStatusEvent, AgentTextDeltaEvent,
    AgentToolResultEvent, AgentToolStartEvent, AgentTurnCompleteEvent, E_APPROVAL_NEEDED, E_ERROR,
    E_STATUS, E_TEXT_DELTA, E_TOOL_RESULT, E_TOOL_START, E_TURN_COMPLETE,
};
use crate::app_services::AppServices;
use crate::models::{RespondAgentApprovalRequest, SessionPreset, StartAgentRequest};
use crate::tauri_bridge::{respond_approval_inner, start_agent_inner};

pub const SMOKE_EVENT_TIMEOUT: Duration = Duration::from_secs(45);
const SMOKE_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeStep {
    pub id: String,
    pub status: String,
    pub detail: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoopSmokeSummary {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub steps: Vec<SmokeStep>,
    pub approval_seen: bool,
    pub completion_seen: bool,
    pub retry_recovered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_stop_reason: Option<String>,
    pub status_sequence: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub output_exists: bool,
    pub output_filtered_only: bool,
    pub source_unchanged: bool,
    pub tool_start_count: usize,
    pub tool_result_count: usize,
    pub text_delta_count: usize,
    pub approval_event_count: usize,
    pub completion_event_count: usize,
    pub error_event_count: usize,
    pub status_event_count: usize,
    pub retry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_stream_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_stream_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_event_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct ObservedSmokeEvents {
    pub statuses: Vec<AgentSessionStatusEvent>,
    pub approvals: Vec<AgentApprovalNeededEvent>,
    pub completions: Vec<AgentTurnCompleteEvent>,
    pub errors: Vec<AgentErrorEvent>,
    pub tool_starts: Vec<AgentToolStartEvent>,
    pub tool_results: Vec<AgentToolResultEvent>,
    pub text_deltas: Vec<AgentTextDeltaEvent>,
    pub first_text_delta_at_ms: Option<u64>,
    pub last_text_delta_at_ms: Option<u64>,
    pub completion_event_at_ms: Option<u64>,
}

fn epoch_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug)]
pub struct SmokeWorkspace {
    pub root: PathBuf,
    pub source_path: PathBuf,
    pub output_path: PathBuf,
    pub source_text: String,
    pub expected_output: String,
}

struct SmokeEnvGuard {
    autorun: Option<String>,
    home: Option<String>,
    userprofile: Option<String>,
    localappdata: Option<String>,
}

impl Drop for SmokeEnvGuard {
    fn drop(&mut self) {
        restore_env_var("RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE", self.autorun.take());
        restore_env_var("HOME", self.home.take());
        #[cfg(windows)]
        {
            restore_env_var("USERPROFILE", self.userprofile.take());
            restore_env_var("LOCALAPPDATA", self.localappdata.take());
        }
    }
}

impl AgentLoopSmokeSummary {
    pub fn push_step(&mut self, id: &str, status: &str, detail: impl Into<String>) {
        self.steps.push(SmokeStep {
            id: id.to_string(),
            status: status.to_string(),
            detail: detail.into(),
        });
    }

    pub fn finish_failure(&mut self, id: &str, detail: impl Into<String>) {
        let detail = detail.into();
        self.push_step(id, "failed", detail.clone());
        self.status = "failed".to_string();
        self.failure_reason = Some(detail);
    }
}

#[must_use]
pub fn create_test_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.manage(AppServices::new());
    app
}

pub fn apply_test_app_local_data_dir_override(dir: &Path) {
    if let Err(error) = fs::create_dir_all(dir) {
        tracing::warn!(
            "[agent-loop-smoke] failed to create test local data dir {}: {error}",
            dir.display()
        );
        return;
    }
    std::env::set_var("HOME", dir);
    #[cfg(windows)]
    {
        std::env::set_var("USERPROFILE", dir);
        std::env::set_var("LOCALAPPDATA", dir);
    }
}

pub async fn run_agent_loop_smoke<R: Runtime>(
    app: AppHandle<R>,
    local_data_root: Option<PathBuf>,
) -> AgentLoopSmokeSummary {
    let mut summary = AgentLoopSmokeSummary {
        status: "failed".to_string(),
        ..AgentLoopSmokeSummary::default()
    };

    let workspace_root = local_data_root.unwrap_or_else(std::env::temp_dir);
    let workspace = match initialize_workspace(&workspace_root) {
        Ok(workspace) => workspace,
        Err(error) => {
            summary.finish_failure("initialize-app", error);
            return summary;
        }
    };

    let _env_lock = smoke_env_lock().await;
    let _env_guard = configure_smoke_env(&workspace.root);

    let services = app.state::<AppServices>();
    let registry = services.registry();
    let agent_semaphore = services.agent_semaphore();
    let agent_config = services.config().clone();
    let observed = Arc::new(Mutex::new(ObservedSmokeEvents::default()));
    let listeners = register_event_listeners(&app, Arc::clone(&observed));

    let result = async {
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

        let request = StartAgentRequest {
            goal: build_smoke_goal(&workspace),
            files: Vec::new(),
            cwd: Some(workspace.root.to_string_lossy().into_owned()),
            browser_settings: None,
            max_turns: Some(4),
            session_preset: SessionPreset::Build,
        };

        let session_id = start_agent_inner(
            app.clone(),
            registry.clone(),
            agent_semaphore,
            agent_config,
            request,
        )
        .await?;
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
        summary.first_stream_at_ms = observed_state.first_text_delta_at_ms;
        summary.last_stream_at_ms = observed_state.last_text_delta_at_ms;
        summary.completion_event_at_ms = observed_state.completion_event_at_ms;
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
        if summary.text_delta_count <= 1 {
            return Err(format!(
                "smoke run observed too few text delta events: {}",
                summary.text_delta_count
            ));
        }
        if let (Some(first_stream_at_ms), Some(completion_event_at_ms)) =
            (summary.first_stream_at_ms, summary.completion_event_at_ms)
        {
            if first_stream_at_ms >= completion_event_at_ms {
                return Err(format!(
                    "first stream timestamp {first_stream_at_ms} was not earlier than completion event {completion_event_at_ms}"
                ));
            }
        } else {
            return Err("smoke run did not capture stream/completion timestamps".to_string());
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

async fn smoke_env_lock() -> tokio::sync::OwnedMutexGuard<()> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
        .lock_owned()
        .await
}

fn configure_smoke_env(root: &Path) -> SmokeEnvGuard {
    let previous_autorun = std::env::var("RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE").ok();
    let previous_home = std::env::var("HOME").ok();
    let previous_userprofile = std::env::var("USERPROFILE").ok();
    let previous_localappdata = std::env::var("LOCALAPPDATA").ok();
    std::env::set_var("RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE", "1");
    apply_test_app_local_data_dir_override(root);
    SmokeEnvGuard {
        autorun: previous_autorun,
        home: previous_home,
        userprofile: previous_userprofile,
        localappdata: previous_localappdata,
    }
}

fn restore_env_var(key: &str, value: Option<String>) {
    if let Some(value) = value {
        std::env::set_var(key, value);
    } else {
        std::env::remove_var(key);
    }
}

pub fn initialize_workspace(root: &Path) -> Result<SmokeWorkspace, String> {
    let root = root.join("agent-loop-smoke");
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

#[must_use]
pub fn build_smoke_goal(workspace: &SmokeWorkspace) -> String {
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

pub fn register_event_listeners<R: Runtime>(
    app: &AppHandle<R>,
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
                    state.completion_event_at_ms = Some(epoch_ms_now());
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
                    let now_ms = epoch_ms_now();
                    state.text_deltas.push(payload);
                    if state.first_text_delta_at_ms.is_none() {
                        state.first_text_delta_at_ms = Some(now_ms);
                    }
                    state.last_text_delta_at_ms = Some(now_ms);
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

pub async fn wait_for<T, F>(mut check: F, timeout: Duration) -> Option<T>
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

pub fn write_summary(path: &Path, summary: &AgentLoopSmokeSummary) -> Result<(), String> {
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
    use super::AgentLoopSmokeSummary;

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
