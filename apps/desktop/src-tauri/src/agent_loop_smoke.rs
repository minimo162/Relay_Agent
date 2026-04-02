use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{stream, Stream};
use serde::Serialize;
use tauri::{Listener, Manager};
use uuid::Uuid;

use crate::{
    models::{
        BrowserAutomationSettings, GetAgentSessionHistoryRequest, RespondAgentApprovalRequest,
        StartAgentRequest,
    },
    startup::{self, StartupStatus},
    tauri_bridge::{self, AgentSessionHistoryResponse},
};

const AGENT_LOOP_AUTORUN_ENV: &str = "RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE";
const AGENT_LOOP_SUMMARY_PATH_ENV: &str = "RELAY_AGENT_AGENT_LOOP_SMOKE_SUMMARY_PATH";
const AGENT_LOOP_SCENARIO: &str = "launched-app-agent-loop-smoke";
const EVENT_TOOL_START: &str = "agent:tool_start";
const EVENT_TOOL_RESULT: &str = "agent:tool_result";
const EVENT_APPROVAL_NEEDED: &str = "agent:approval_needed";
const EVENT_TURN_COMPLETE: &str = "agent:turn_complete";
const EVENT_ERROR: &str = "agent:error";

#[derive(Debug)]
struct AgentLoopSmokeConfig {
    summary_path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLoopSmokeStep {
    id: &'static str,
    status: &'static str,
    summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLoopSmokeSummary {
    scenario: &'static str,
    status: &'static str,
    startup_status: StartupStatus,
    storage_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_workbook_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_path: Option<String>,
    output_exists: bool,
    output_filtered_only: bool,
    source_unchanged: bool,
    approval_seen: bool,
    completion_seen: bool,
    tool_event_count: usize,
    events: Vec<String>,
    steps: Vec<AgentLoopSmokeStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_reason: Option<String>,
}

#[derive(Clone)]
struct SequenceProvider {
    responses: Arc<Mutex<Vec<claw_provider::ModelResponse>>>,
}

#[async_trait]
impl claw_provider::ModelProvider for SequenceProvider {
    async fn complete(
        &self,
        _request: claw_provider::ModelRequest,
    ) -> Result<claw_provider::ModelResponse> {
        let mut responses = self.responses.lock().expect("smoke provider mutex poisoned");
        if responses.is_empty() {
            return Err(anyhow!("agent loop smoke provider ran out of responses"));
        }

        Ok(responses.remove(0))
    }

    async fn stream(
        &self,
        _request: claw_provider::ModelRequest,
    ) -> Result<
        std::pin::Pin<Box<dyn Stream<Item = Result<claw_provider::StreamEvent>> + Send>>,
    > {
        Ok(Box::pin(stream::empty()))
    }

    fn name(&self) -> &str {
        "agent-loop-smoke"
    }
}

pub fn spawn_if_configured(app_handle: tauri::AppHandle) {
    let Some(config) = AgentLoopSmokeConfig::from_env() else {
        return;
    };

    thread::spawn(move || {
        let summary = run_agent_loop_smoke(&app_handle);
        if let Err(error) = write_summary(&config.summary_path, &summary) {
            eprintln!(
                "agent loop smoke could not write summary to {}: {error}",
                config.summary_path.display()
            );
        }
    });
}

impl AgentLoopSmokeConfig {
    fn from_env() -> Option<Self> {
        if !env_truthy(AGENT_LOOP_AUTORUN_ENV) {
            return None;
        }

        let summary_path = env::var(AGENT_LOOP_SUMMARY_PATH_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)?;

        Some(Self { summary_path })
    }
}

impl AgentLoopSmokeSummary {
    fn new() -> Self {
        Self {
            scenario: AGENT_LOOP_SCENARIO,
            status: "failed",
            startup_status: StartupStatus::Attention,
            storage_mode: "unknown".to_string(),
            sample_workbook_path: None,
            session_id: None,
            output_path: None,
            output_exists: false,
            output_filtered_only: false,
            source_unchanged: false,
            approval_seen: false,
            completion_seen: false,
            tool_event_count: 0,
            events: Vec::new(),
            steps: Vec::new(),
            failure_reason: None,
        }
    }

    fn push_ok(&mut self, id: &'static str, summary: impl Into<String>) {
        self.steps.push(AgentLoopSmokeStep {
            id,
            status: "ok",
            summary: summary.into(),
        });
    }

    fn fail(&mut self, id: &'static str, summary: impl Into<String>) -> String {
        let message = summary.into();
        self.steps.push(AgentLoopSmokeStep {
            id,
            status: "failed",
            summary: message.clone(),
        });
        self.failure_reason = Some(message.clone());
        message
    }
}

fn run_agent_loop_smoke(app_handle: &tauri::AppHandle) -> AgentLoopSmokeSummary {
    let mut summary = AgentLoopSmokeSummary::new();

    if let Err(error) = run_agent_loop_smoke_inner(app_handle, &mut summary) {
        if summary.failure_reason.is_none() {
            summary.failure_reason = Some(error);
        }
        return summary;
    }

    summary.status = "ok";
    summary
}

fn run_agent_loop_smoke_inner(
    app_handle: &tauri::AppHandle,
    summary: &mut AgentLoopSmokeSummary,
) -> Result<(), String> {
    let state = app_handle.state::<crate::state::DesktopState>();
    let init = startup::build_initialize_app_response(&state);

    summary.startup_status = init.startup_status;
    summary.storage_mode = init.storage_mode.to_string();
    summary.sample_workbook_path = init.sample_workbook_path.clone();
    summary.push_ok(
        "initialize-app",
        format!(
            "Startup finished with `{}` storage and status `{}`.",
            init.storage_mode,
            startup_status_label(init.startup_status)
        ),
    );

    if !init.storage_ready {
        return Err(summary.fail(
            "initialize-app",
            "Agent loop smoke could not continue because app storage was not ready.",
        ));
    }

    let sample_workbook_path = init.sample_workbook_path.clone().ok_or_else(|| {
        summary.fail(
            "locate-sample",
            "Bundled sample workbook path was not available.",
        )
    })?;
    let original_source = fs::read_to_string(&sample_workbook_path).map_err(|error| {
        summary.fail(
            "locate-sample",
            format!(
                "Bundled sample workbook at `{sample_workbook_path}` could not be read: {error}"
            ),
        )
    })?;
    summary.push_ok(
        "locate-sample",
        format!("Bundled sample workbook resolved to `{sample_workbook_path}`."),
    );

    let event_log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut listener_ids = Vec::new();
    for event_name in [
        EVENT_TOOL_START,
        EVENT_TOOL_RESULT,
        EVENT_APPROVAL_NEEDED,
        EVENT_TURN_COMPLETE,
        EVENT_ERROR,
    ] {
        let events = Arc::clone(&event_log);
        let id = app_handle.listen(event_name, move |_| {
            events
                .lock()
                .expect("agent loop smoke event log poisoned")
                .push(event_name.to_string());
        });
        listener_ids.push(id);
    }

    let output_path = env::temp_dir().join(format!(
        "relay-agent-agent-loop-smoke-output-{}.csv",
        Uuid::new_v4()
    ));
    summary.output_path = Some(output_path.display().to_string());

    let provider = Arc::new(SequenceProvider {
        responses: Arc::new(Mutex::new(vec![
            model_response(vec![claw_provider::ResponseContent::ToolUse {
                id: "inspect-1".to_string(),
                name: "workbook.inspect".to_string(),
                input: serde_json::json!({}),
            }], claw_provider::StopReason::ToolUse),
            model_response(vec![claw_provider::ResponseContent::ToolUse {
                id: "filter-1".to_string(),
                name: "table.filter_rows".to_string(),
                input: serde_json::json!({
                    "predicate": "approved = true",
                    "outputPath": output_path.to_string_lossy().to_string()
                }),
            }], claw_provider::StopReason::ToolUse),
            model_response(vec![claw_provider::ResponseContent::Text(
                "Agent smoke completed".to_string(),
            )], claw_provider::StopReason::EndTurn),
        ])),
    });

    let session_id = tauri_bridge::start_agent_with_provider(
        app_handle.clone(),
        state.inner(),
        StartAgentRequest {
            goal: "Keep approved rows and save a reviewed copy.".to_string(),
            files: vec![sample_workbook_path.clone()],
            cwd: None,
            browser_settings: Some(BrowserAutomationSettings {
                cdp_port: 9333,
                auto_launch_edge: false,
                timeout_ms: 5_000,
            }),
            max_turns: Some(6),
        },
        provider,
    )
    .map_err(|error| summary.fail("start-agent", error))?;
    summary.session_id = Some(session_id.clone());
    summary.push_ok("start-agent", format!("Agent session `{session_id}` started."));

    let deadline = Instant::now() + Duration::from_secs(20);
    let approval_id = loop {
        let pending = state.agent_runtime.pending_approval_ids(&session_id);
        if let Some(approval_id) = pending.into_iter().next() {
            break approval_id;
        }

        let history = tauri::async_runtime::block_on(tauri_bridge::get_session_history(
            app_handle.state::<crate::state::DesktopState>(),
            GetAgentSessionHistoryRequest {
                session_id: session_id.clone(),
            },
        ))
        .map_err(|error| summary.fail("wait-approval", error))?;

        if !history.running {
            return Err(summary.fail(
                "wait-approval",
                "Agent loop finished before emitting a write approval.",
            ));
        }

        if Instant::now() >= deadline {
            return Err(summary.fail(
                "wait-approval",
                "Timed out waiting for an approval request.",
            ));
        }

        thread::sleep(Duration::from_millis(100));
    };
    summary.approval_seen = true;
    summary.push_ok(
        "wait-approval",
        format!("Write approval `{approval_id}` was emitted."),
    );

    tauri::async_runtime::block_on(tauri_bridge::respond_approval(
        app_handle.state::<crate::state::DesktopState>(),
        RespondAgentApprovalRequest {
            session_id: session_id.clone(),
            approval_id: approval_id.clone(),
            approved: true,
        },
    ))
    .map_err(|error| summary.fail("respond-approval", error))?;
    summary.push_ok(
        "respond-approval",
        format!("Approval `{approval_id}` was accepted."),
    );

    let history = wait_for_completion(app_handle, &session_id, summary)?;
    summary.completion_seen = true;
    summary.push_ok(
        "wait-complete",
        format!(
            "Agent session completed with {} message(s).",
            history.messages.len()
        ),
    );

    let events = event_log
        .lock()
        .expect("agent loop smoke event log poisoned")
        .clone();
    summary.tool_event_count = events
        .iter()
        .filter(|event| event.as_str() == EVENT_TOOL_START || event.as_str() == EVENT_TOOL_RESULT)
        .count();
    summary.events = events.clone();

    let required_events = [
        EVENT_TOOL_START,
        EVENT_TOOL_RESULT,
        EVENT_APPROVAL_NEEDED,
        EVENT_TURN_COMPLETE,
    ];
    if !required_events
        .iter()
        .all(|event_name| events.iter().any(|event| event == event_name))
    {
        return Err(summary.fail(
            "verify-events",
            format!("Missing expected agent event(s): {events:?}"),
        ));
    }
    summary.push_ok(
        "verify-events",
        format!("Observed agent events: {}.", events.join(", ")),
    );

    for id in listener_ids {
        app_handle.unlisten(id);
    }

    let written = fs::read_to_string(&output_path).map_err(|error| {
        summary.fail(
            "verify-output",
            format!("Agent loop output at `{}` could not be read: {error}", output_path.display()),
        )
    })?;
    summary.output_exists = output_path.exists();
    summary.output_filtered_only = written.contains("true") && !written.contains("false");
    if !summary.output_exists || !summary.output_filtered_only {
        return Err(summary.fail(
            "verify-output",
            "Agent loop did not write the expected filtered copy.",
        ));
    }
    summary.push_ok(
        "verify-output",
        format!("Agent loop wrote a filtered save-copy to `{}`.", output_path.display()),
    );

    let source_unchanged = fs::read_to_string(&sample_workbook_path)
        .map(|value| value == original_source)
        .unwrap_or(false);
    summary.source_unchanged = source_unchanged;
    if !source_unchanged {
        return Err(summary.fail(
            "verify-source",
            "Bundled sample workbook changed during agent loop smoke execution.",
        ));
    }
    summary.push_ok(
        "verify-source",
        "Bundled sample workbook remained unchanged during smoke execution.",
    );

    Ok(())
}

fn wait_for_completion(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    summary: &mut AgentLoopSmokeSummary,
) -> Result<AgentSessionHistoryResponse, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let history = tauri::async_runtime::block_on(tauri_bridge::get_session_history(
            app_handle.state::<crate::state::DesktopState>(),
            GetAgentSessionHistoryRequest {
                session_id: session_id.to_string(),
            },
        ))
        .map_err(|error| summary.fail("wait-complete", error))?;

        if !history.running {
            return Ok(history);
        }

        if Instant::now() >= deadline {
            return Err(summary.fail(
                "wait-complete",
                "Timed out waiting for the agent loop to finish.",
            ));
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn model_response(
    content: Vec<claw_provider::ResponseContent>,
    stop_reason: claw_provider::StopReason,
) -> claw_provider::ModelResponse {
    claw_provider::ModelResponse {
        id: Uuid::new_v4().to_string(),
        content,
        stop_reason: Some(stop_reason),
        usage: claw_provider::Usage::default(),
    }
}

fn startup_status_label(status: StartupStatus) -> &'static str {
    match status {
        StartupStatus::Ready => "ready",
        StartupStatus::Attention => "attention",
    }
}

fn env_truthy(key: &str) -> bool {
    matches!(
        env::var(key).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn write_summary(path: &Path, summary: &AgentLoopSmokeSummary) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let serialized =
        serde_json::to_string_pretty(summary).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}
