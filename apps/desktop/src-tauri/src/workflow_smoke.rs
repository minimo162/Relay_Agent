use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::json;
use tauri::Manager;
use uuid::Uuid;

use crate::{
    models::{
        ApprovalDecision, CopilotTurnResponse, CreateSessionRequest, GenerateRelayPacketRequest,
        PreviewExecutionRequest, RecordStructuredResponseRequest, RelayMode,
        RespondToApprovalRequest, RunExecutionRequest, StartTurnRequest,
    },
    startup::{self, StartupStatus},
};

const WORKFLOW_AUTORUN_ENV: &str = "RELAY_AGENT_AUTORUN_WORKFLOW_SMOKE";
const WORKFLOW_SUMMARY_PATH_ENV: &str = "RELAY_AGENT_WORKFLOW_SMOKE_SUMMARY_PATH";
const WORKFLOW_SCENARIO: &str = "launched-app-workflow-smoke";
const SAMPLE_SESSION_TITLE: &str = "Workflow smoke demo";
const SAMPLE_SESSION_OBJECTIVE: &str =
    "Inspect the sample CSV, preview a safe transform, and write a sanitized copy.";
const SAMPLE_TURN_TITLE: &str = "Workflow smoke approved revenue cleanup";
const SAMPLE_TURN_OBJECTIVE: &str =
    "Keep approved rows, add a review label, preview the diff, approve it, and save a copy.";
const SAMPLE_APPROVAL_NOTE: &str = "Workflow smoke auto-approval";
const EXPECTED_SAMPLE_OUTPUT: &str = concat!(
    "customer_id,region,segment,amount,approved,posted_on,comment,review_label\n",
    "1,East,Retail,42.5,true,2025-01-01,'=needs-review,Retail-approved\n",
    "3,West,Retail,11.25,true,2025-01-03,'+follow-up,Retail-approved\n",
    "4,West,Enterprise,oops,true,2025-01-04,'@vip,Enterprise-approved\n"
);

#[derive(Debug)]
struct WorkflowSmokeConfig {
    summary_path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowSmokeStep {
    id: &'static str,
    status: &'static str,
    summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowSmokeSummary {
    scenario: &'static str,
    status: &'static str,
    startup_status: StartupStatus,
    storage_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_workbook_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_path: Option<String>,
    output_exists: bool,
    output_matches_expected: bool,
    source_unchanged: bool,
    execution_warning_count: usize,
    steps: Vec<WorkflowSmokeStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_reason: Option<String>,
}

pub fn spawn_if_configured(app_handle: tauri::AppHandle) {
    let Some(config) = WorkflowSmokeConfig::from_env() else {
        return;
    };

    std::thread::spawn(move || {
        let summary = run_workflow_smoke(&app_handle);
        if let Err(error) = write_summary(&config.summary_path, &summary) {
            eprintln!(
                "workflow smoke could not write summary to {}: {error}",
                config.summary_path.display()
            );
        }
    });
}

impl WorkflowSmokeConfig {
    fn from_env() -> Option<Self> {
        if !env_truthy(WORKFLOW_AUTORUN_ENV) {
            return None;
        }

        let summary_path = env::var(WORKFLOW_SUMMARY_PATH_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)?;

        Some(Self { summary_path })
    }
}

impl WorkflowSmokeSummary {
    fn new() -> Self {
        Self {
            scenario: WORKFLOW_SCENARIO,
            status: "failed",
            startup_status: StartupStatus::Attention,
            storage_mode: "unknown".to_string(),
            sample_workbook_path: None,
            session_id: None,
            turn_id: None,
            output_path: None,
            output_exists: false,
            output_matches_expected: false,
            source_unchanged: false,
            execution_warning_count: 0,
            steps: Vec::new(),
            failure_reason: None,
        }
    }

    fn push_ok(&mut self, id: &'static str, summary: impl Into<String>) {
        self.steps.push(WorkflowSmokeStep {
            id,
            status: "ok",
            summary: summary.into(),
        });
    }

    fn fail(&mut self, id: &'static str, summary: impl Into<String>) -> String {
        let message = summary.into();
        self.steps.push(WorkflowSmokeStep {
            id,
            status: "failed",
            summary: message.clone(),
        });
        self.failure_reason = Some(message.clone());
        message
    }
}

fn run_workflow_smoke(app_handle: &tauri::AppHandle) -> WorkflowSmokeSummary {
    let mut summary = WorkflowSmokeSummary::new();

    if let Err(error) = run_workflow_smoke_inner(app_handle, &mut summary) {
        if summary.failure_reason.is_none() {
            summary.failure_reason = Some(error);
        }
        return summary;
    }

    summary.status = "ok";
    summary
}

fn run_workflow_smoke_inner(
    app_handle: &tauri::AppHandle,
    summary: &mut WorkflowSmokeSummary,
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
            "Launched workflow smoke could not continue because app storage was not ready.",
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

    let output_path = env::temp_dir().join(format!(
        "relay-agent-workflow-smoke-output-{}.csv",
        Uuid::new_v4()
    ));
    summary.output_path = Some(output_path.display().to_string());

    {
        let mut storage = state.storage.lock().expect("desktop storage poisoned");

        let session = storage
            .create_session(CreateSessionRequest {
                title: SAMPLE_SESSION_TITLE.to_string(),
                objective: SAMPLE_SESSION_OBJECTIVE.to_string(),
                primary_workbook_path: Some(sample_workbook_path.clone()),
            })
            .map_err(|error| summary.fail("create-session", error))?;
        summary.session_id = Some(session.id.clone());
        summary.push_ok(
            "create-session",
            format!("Session `{}` was created.", session.id),
        );

        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: SAMPLE_TURN_TITLE.to_string(),
                objective: SAMPLE_TURN_OBJECTIVE.to_string(),
                mode: RelayMode::Plan,
            })
            .map_err(|error| summary.fail("start-turn", error))?
            .turn;
        summary.turn_id = Some(turn.id.clone());
        summary.push_ok(
            "start-turn",
            format!("Turn `{}` started in `plan` mode.", turn.id),
        );

        let packet = storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .map_err(|error| summary.fail("generate-packet", error))?;
        summary.push_ok(
            "generate-packet",
            format!(
                "Relay packet generated with {} read tool(s) and {} write tool(s).",
                packet.allowed_read_tools.len(),
                packet.allowed_write_tools.len()
            ),
        );

        let raw_response = build_sample_response(&output_path);
        let parsed_response = serde_json::from_str::<CopilotTurnResponse>(&raw_response)
            .map_err(|error| summary.fail("validate-response", error.to_string()))?;
        storage
            .record_structured_response(RecordStructuredResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: Some(raw_response),
                parsed_response,
            })
            .map_err(|error| summary.fail("validate-response", error))?;
        summary.push_ok(
            "validate-response",
            "Bundled sample response was recorded without validation issues.",
        );

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .map_err(|error| summary.fail("preview", error))?;
        if !preview.ready {
            return Err(summary.fail("preview", "Preview did not become ready."));
        }
        if !preview.requires_approval {
            return Err(summary.fail(
                "preview",
                "Workflow smoke expected preview to require approval before save-copy execution.",
            ));
        }
        summary.push_ok(
            "preview",
            format!(
                "Preview is ready for {} target(s) and {} estimated affected row(s).",
                preview.diff_summary.target_count, preview.diff_summary.estimated_affected_rows
            ),
        );

        let approval = storage
            .respond_to_approval(RespondToApprovalRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                decision: ApprovalDecision::Approved,
                note: Some(SAMPLE_APPROVAL_NOTE.to_string()),
            })
            .map_err(|error| summary.fail("approval", error))?;
        if !approval.ready_for_execution {
            return Err(summary.fail(
                "approval",
                "Approval step did not mark the sample preview as ready for execution.",
            ));
        }
        summary.push_ok(
            "approval",
            "Preview approval was recorded before save-copy execution.",
        );

        let execution = storage
            .run_execution(RunExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .map_err(|error| summary.fail("execution", error))?;
        if !execution.executed {
            return Err(summary.fail(
                "execution",
                "Execution returned without writing the reviewed copy.",
            ));
        }
        summary.execution_warning_count = execution.warnings.len();
        summary.push_ok(
            "execution",
            format!(
                "Save-copy execution completed with {} warning(s).",
                execution.warnings.len()
            ),
        );
    }

    let output_path = summary.output_path.clone().ok_or_else(|| {
        summary.fail(
            "verify-output",
            "Workflow smoke did not record an output path.",
        )
    })?;
    let output_contents = fs::read_to_string(&output_path).map_err(|error| {
        summary.fail(
            "verify-output",
            format!("Reviewed copy at `{output_path}` could not be read: {error}"),
        )
    })?;
    summary.output_exists = true;
    summary.output_matches_expected = output_contents == EXPECTED_SAMPLE_OUTPUT;

    if !summary.output_matches_expected {
        return Err(summary.fail(
            "verify-output",
            "Reviewed copy did not match the expected bundled sample output.",
        ));
    }

    let source_after = fs::read_to_string(&sample_workbook_path).map_err(|error| {
        summary.fail(
            "verify-source",
            format!(
                "Bundled sample workbook at `{sample_workbook_path}` could not be re-read: {error}"
            ),
        )
    })?;
    summary.source_unchanged = source_after == original_source;
    if !summary.source_unchanged {
        return Err(summary.fail(
            "verify-source",
            "Bundled sample workbook changed during workflow smoke execution.",
        ));
    }

    summary.push_ok(
        "verify-output",
        "Reviewed copy exists and matches the expected bundled sample output.",
    );
    summary.push_ok(
        "verify-source",
        "Bundled sample source stayed unchanged after save-copy execution.",
    );

    Ok(())
}

fn build_sample_response(output_path: &Path) -> String {
    json!({
        "version": "1.0",
        "summary": "Keep approved rows, add a review label, and write a sanitized CSV copy.",
        "actions": [
            {
                "tool": "table.filter_rows",
                "sheet": "Sheet1",
                "args": {
                    "predicate": "approved = true"
                }
            },
            {
                "tool": "table.derive_column",
                "sheet": "Sheet1",
                "args": {
                    "column": "review_label",
                    "expression": "[segment] + \"-approved\"",
                    "position": "end"
                }
            },
            {
                "tool": "workbook.save_copy",
                "args": {
                    "outputPath": output_path.display().to_string()
                }
            }
        ],
        "followupQuestions": [],
        "warnings": []
    })
    .to_string()
}

fn write_summary(summary_path: &Path, summary: &WorkflowSmokeSummary) -> Result<(), String> {
    if let Some(parent) = summary_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not prepare workflow summary directory: {error}"))?;
    }

    let serialized = serde_json::to_string_pretty(summary)
        .map_err(|error| format!("could not serialize workflow summary: {error}"))?;
    fs::write(summary_path, serialized)
        .map_err(|error| format!("could not persist workflow summary: {error}"))
}

fn env_truthy(key: &str) -> bool {
    matches!(
        env::var(key).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn startup_status_label(status: StartupStatus) -> &'static str {
    match status {
        StartupStatus::Ready => "ready",
        StartupStatus::Attention => "attention",
    }
}
