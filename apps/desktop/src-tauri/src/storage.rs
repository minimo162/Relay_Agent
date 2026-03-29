use std::{collections::HashMap, path::PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::models::{
    ApprovalDecision, CopilotTurnResponse, CreateSessionRequest, DiffSummary,
    GenerateRelayPacketRequest, PreviewExecutionRequest, PreviewExecutionResponse, RelayPacket,
    RelayPacketResponseContract, RespondToApprovalRequest, RespondToApprovalResponse,
    RunExecutionRequest, RunExecutionResponse, Session, SessionDetail, SessionStatus,
    SpreadsheetAction, StartTurnRequest, StartTurnResponse, SubmitCopilotResponseRequest,
    SubmitCopilotResponseResponse, ToolDescriptor, ToolPhase, Turn, TurnStatus, ValidationIssue,
};
use crate::persistence::{self, StorageManifest};
use crate::workbook::{WorkbookEngine, WorkbookSource};

#[derive(Clone, Debug)]
struct StoredResponse {
    parsed_response: Option<CopilotTurnResponse>,
    validation_issues: Vec<ValidationIssue>,
}

#[derive(Clone, Debug)]
struct StoredPreview {
    diff_summary: DiffSummary,
    requires_approval: bool,
    warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct StoredApproval {
    decision: ApprovalDecision,
    note: Option<String>,
}

#[derive(Clone, Debug)]
struct ReadToolArtifact {
    artifact_type: &'static str,
    payload: Value,
    event_type: &'static str,
    message: String,
    warning: String,
}

pub struct AppStorage {
    app_local_data_dir: Option<PathBuf>,
    manifest: Option<StorageManifest>,
    sessions: HashMap<String, Session>,
    turns: HashMap<String, Turn>,
    relay_packets: HashMap<String, RelayPacket>,
    responses: HashMap<String, StoredResponse>,
    previews: HashMap<String, StoredPreview>,
    approvals: HashMap<String, StoredApproval>,
}

impl Default for AppStorage {
    fn default() -> Self {
        Self {
            app_local_data_dir: None,
            manifest: None,
            sessions: HashMap::new(),
            turns: HashMap::new(),
            relay_packets: HashMap::new(),
            responses: HashMap::new(),
            previews: HashMap::new(),
            approvals: HashMap::new(),
        }
    }
}

impl AppStorage {
    pub fn open(app_local_data_dir: PathBuf) -> Result<Self, String> {
        let loaded = persistence::initialize_storage(&app_local_data_dir, &timestamp())?;

        Ok(Self {
            app_local_data_dir: Some(app_local_data_dir),
            manifest: Some(loaded.manifest),
            sessions: loaded.sessions,
            turns: loaded.turns,
            ..Self::default()
        })
    }

    pub fn storage_mode(&self) -> &'static str {
        if self.app_local_data_dir.is_some() {
            "local-json"
        } else {
            "memory"
        }
    }

    pub fn storage_ready(&self) -> bool {
        self.app_local_data_dir.is_some() && self.manifest.is_some()
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn create_session(&mut self, request: CreateSessionRequest) -> Result<Session, String> {
        let title = require_text("title", request.title)?;
        let objective = require_text("objective", request.objective)?;
        let primary_workbook_path = request
            .primary_workbook_path
            .map(|path| require_text("primaryWorkbookPath", path))
            .transpose()?;
        let now = timestamp();

        let session = Session {
            id: Uuid::new_v4().to_string(),
            title,
            objective,
            status: SessionStatus::Draft,
            primary_workbook_path,
            created_at: now.clone(),
            updated_at: now,
            latest_turn_id: None,
            turn_ids: Vec::new(),
        };

        self.sessions.insert(session.id.clone(), session.clone());
        self.persist_session_state(&session.id)?;
        self.append_session_log(
            &session.id,
            "session-created",
            format!("Session `{}` was created.", session.title),
            None,
            Some(json!({
                "status": session.status,
                "primaryWorkbookPath": session.primary_workbook_path.clone(),
            })),
        )?;

        Ok(session)
    }

    pub fn list_sessions(&self) -> Vec<Session> {
        let mut sessions = self.sessions.values().cloned().collect::<Vec<_>>();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }

    pub fn read_session(&self, session_id: &str) -> Result<SessionDetail, String> {
        let session = self
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;

        let mut turns = session
            .turn_ids
            .iter()
            .filter_map(|turn_id| self.turns.get(turn_id).cloned())
            .collect::<Vec<_>>();
        turns.sort_by(|left, right| left.created_at.cmp(&right.created_at));

        Ok(SessionDetail { session, turns })
    }

    pub fn start_turn(&mut self, request: StartTurnRequest) -> Result<StartTurnResponse, String> {
        let title = require_text("title", request.title)?;
        let objective = require_text("objective", request.objective)?;
        let now = timestamp();

        let session = self
            .sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| format!("session `{}` was not found", request.session_id))?;

        let turn = Turn {
            id: Uuid::new_v4().to_string(),
            session_id: session.id.clone(),
            title,
            objective,
            mode: request.mode,
            status: TurnStatus::Draft,
            created_at: now.clone(),
            updated_at: now.clone(),
            item_ids: Vec::new(),
            validation_error_count: 0,
        };

        session.status = SessionStatus::Active;
        session.updated_at = now;
        session.latest_turn_id = Some(turn.id.clone());
        session.turn_ids.push(turn.id.clone());

        let session_snapshot = session.clone();
        self.turns.insert(turn.id.clone(), turn.clone());
        self.persist_session_state(&session_snapshot.id)?;
        self.append_session_log(
            &session_snapshot.id,
            "turn-started",
            format!("Turn `{}` was added to the session.", turn.title),
            None,
            Some(json!({
                "turnId": turn.id.clone(),
                "mode": turn.mode,
                "status": turn.status,
            })),
        )?;
        self.append_turn_log(
            &session_snapshot.id,
            &turn.id,
            None,
            "turn-started",
            format!("Turn `{}` started.", turn.title),
            Some(json!({
                "mode": turn.mode,
                "objective": turn.objective.clone(),
            })),
        )?;

        Ok(StartTurnResponse {
            session: session_snapshot,
            turn,
        })
    }

    pub fn generate_relay_packet(
        &mut self,
        request: GenerateRelayPacketRequest,
    ) -> Result<RelayPacket, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let context = build_packet_context(&session, &turn);
        let packet = RelayPacket {
            version: "1.0",
            session_id: session.id.clone(),
            turn_id: turn.id.clone(),
            mode: turn.mode,
            objective: turn.objective.clone(),
            context,
            allowed_read_tools: read_tool_registry(),
            allowed_write_tools: write_tool_registry(),
            response_contract: RelayPacketResponseContract {
                format: "json",
                expects_actions: true,
                notes: vec![
                    "Return strict JSON only.".to_string(),
                    "Use only the listed tools.".to_string(),
                    "Write actions require preview and approval before execution.".to_string(),
                ],
            },
        };

        self.relay_packets.insert(turn.id.clone(), packet.clone());
        let packet_artifact_id =
            self.record_turn_artifact(&session.id, &turn.id, "relay-packet", &packet, None)?;
        self.update_turn_status(&turn.id, TurnStatus::PacketReady, 0)?;
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&packet_artifact_id),
            "relay-packet-generated",
            "Relay packet generated for the current turn.".to_string(),
            Some(json!({
                "mode": turn.mode,
                "contextCount": packet.context.len(),
            })),
        )?;

        Ok(packet)
    }

    pub fn submit_copilot_response(
        &mut self,
        request: SubmitCopilotResponseRequest,
    ) -> Result<SubmitCopilotResponseResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;

        if !self.relay_packets.contains_key(&turn.id) {
            return Err("relay packet must be generated before submitting a response".to_string());
        }

        let (parsed_response, validation_issues) = parse_copilot_response(&request.raw_response);
        let accepted = validation_issues.is_empty();
        let repair_prompt = if accepted {
            None
        } else {
            Some(build_repair_prompt(&validation_issues))
        };
        let response_artifact_id = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "copilot-response",
            &json!({
                "rawResponse": request.raw_response.clone(),
                "accepted": accepted,
                "parsedResponse": parsed_response.clone(),
            }),
            None,
        )?;
        let validation_artifact_id = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "validation",
            &json!({
                "accepted": accepted,
                "validationIssues": validation_issues.clone(),
                "repairPrompt": repair_prompt.clone(),
            }),
            None,
        )?;

        let next_status = if accepted {
            TurnStatus::Validated
        } else {
            TurnStatus::AwaitingResponse
        };
        let next_turn =
            self.update_turn_status(&turn.id, next_status, validation_issues.len() as u32)?;

        self.responses.insert(
            turn.id.clone(),
            StoredResponse {
                parsed_response: parsed_response.clone(),
                validation_issues: validation_issues.clone(),
            },
        );
        self.previews.remove(&turn.id);
        self.approvals.remove(&turn.id);
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&validation_artifact_id),
            "copilot-response-submitted",
            "Copied model response was stored and validated.".to_string(),
            Some(json!({
                "accepted": accepted,
                "responseArtifactId": response_artifact_id.clone(),
                "validationArtifactId": validation_artifact_id.clone(),
                "validationIssueCount": validation_issues.len(),
            })),
        )?;

        Ok(SubmitCopilotResponseResponse {
            turn: next_turn,
            accepted,
            validation_issues,
            parsed_response,
            repair_prompt,
        })
    }

    pub fn preview_execution(
        &mut self,
        request: PreviewExecutionRequest,
    ) -> Result<PreviewExecutionResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let stored_response = self
            .responses
            .get(&turn.id)
            .ok_or_else(|| "submit a Copilot response before previewing execution".to_string())?;

        if !stored_response.validation_issues.is_empty() {
            return Err("cannot preview execution while validation issues remain".to_string());
        }

        let parsed_response = stored_response
            .parsed_response
            .clone()
            .ok_or_else(|| "no parsed Copilot response is available for preview".to_string())?;

        let engine = WorkbookEngine::default();
        let source = session
            .primary_workbook_path
            .as_deref()
            .map(WorkbookSource::detect)
            .transpose()?;
        let preview = engine.preview_actions(source.as_ref(), &parsed_response.actions)?;
        let mut diff_summary = preview.diff_summary;
        let requires_approval = preview.requires_approval;
        let mut warnings = preview.warnings;
        let read_tool_artifacts = self.collect_read_tool_artifacts(
            &session,
            &turn,
            &parsed_response.actions,
            &diff_summary,
        )?;
        for artifact in read_tool_artifacts {
            let artifact_id = self.record_turn_artifact(
                &session.id,
                &turn.id,
                artifact.artifact_type,
                &artifact.payload,
                None,
            )?;
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&artifact_id),
                artifact.event_type,
                artifact.message,
                Some(json!({
                    "artifactType": artifact.artifact_type,
                })),
            )?;
            diff_summary.warnings.push(artifact.warning.clone());
            warnings.push(artifact.warning);
        }
        let preview_artifact_id = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "preview",
            &json!({
                "diffSummary": diff_summary.clone(),
                "requiresApproval": requires_approval,
                "warnings": warnings.clone(),
            }),
            None,
        )?;
        let next_turn = self.update_turn_status(&turn.id, TurnStatus::PreviewReady, 0)?;
        self.previews.insert(
            turn.id.clone(),
            StoredPreview {
                diff_summary: diff_summary.clone(),
                requires_approval,
                warnings: warnings.clone(),
            },
        );
        self.approvals.remove(&turn.id);
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&preview_artifact_id),
            "execution-preview-created",
            "Execution preview was generated for the turn.".to_string(),
            Some(json!({
                "previewArtifactId": preview_artifact_id.clone(),
                "requiresApproval": requires_approval,
                "warningCount": warnings.len(),
            })),
        )?;

        Ok(PreviewExecutionResponse {
            turn: next_turn,
            ready: true,
            requires_approval,
            can_execute: !requires_approval,
            diff_summary,
            warnings,
        })
    }

    pub fn respond_to_approval(
        &mut self,
        request: RespondToApprovalRequest,
    ) -> Result<RespondToApprovalResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let preview = self.previews.get(&turn.id).ok_or_else(|| {
            "execution preview must exist before approval can be recorded".to_string()
        })?;

        let next_status = match request.decision {
            ApprovalDecision::Approved if preview.requires_approval => TurnStatus::Approved,
            ApprovalDecision::Approved => TurnStatus::PreviewReady,
            ApprovalDecision::Rejected => TurnStatus::PreviewReady,
        };
        let ready_for_execution = matches!(request.decision, ApprovalDecision::Approved);
        let approval_artifact_id = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "approval",
            &json!({
                "decision": request.decision,
                "note": request.note.clone(),
                "readyForExecution": ready_for_execution,
            }),
            None,
        )?;

        let next_turn =
            self.update_turn_status(&turn.id, next_status, turn.validation_error_count)?;
        self.approvals.insert(
            turn.id.clone(),
            StoredApproval {
                decision: request.decision,
                note: request.note.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&approval_artifact_id),
            "approval-recorded",
            "Approval decision recorded for the current preview.".to_string(),
            Some(json!({
                "approvalArtifactId": approval_artifact_id.clone(),
                "decision": request.decision,
                "readyForExecution": ready_for_execution,
            })),
        )?;

        Ok(RespondToApprovalResponse {
            turn: next_turn,
            decision: request.decision,
            ready_for_execution,
        })
    }

    pub fn run_execution(
        &mut self,
        request: RunExecutionRequest,
    ) -> Result<RunExecutionResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let preview =
            self.previews.get(&turn.id).cloned().ok_or_else(|| {
                "execution preview must exist before running execution".to_string()
            })?;

        if preview.requires_approval {
            let approval = self.approvals.get(&turn.id).ok_or_else(|| {
                "execution approval is required before running execution".to_string()
            })?;
            if approval.decision != ApprovalDecision::Approved {
                return Err("execution cannot proceed until the preview is approved".to_string());
            }
        }

        let stored_response = self
            .responses
            .get(&turn.id)
            .ok_or_else(|| "no validated response is available for execution".to_string())?;
        let parsed_response = stored_response
            .parsed_response
            .clone()
            .ok_or_else(|| "no parsed response is available for execution".to_string())?;

        if parsed_response.actions.iter().any(is_write_action) {
            let source = session
                .primary_workbook_path
                .as_deref()
                .ok_or_else(|| {
                    format!(
                        "session `{}` does not have a workbook source path for execution",
                        session.id
                    )
                })
                .and_then(|path| WorkbookSource::detect(path.to_string()))?;
            let engine = WorkbookEngine::default();
            let execution = engine.execute_actions(&source, &parsed_response.actions)?;
            let mut warnings = collect_execution_warnings(&preview);
            if let Some(approval) = self.approvals.get(&turn.id) {
                if let Some(note) = &approval.note {
                    push_unique_string(&mut warnings, format!("Approval note: {note}"));
                }
            }
            for warning in execution.warnings {
                push_unique_string(&mut warnings, warning);
            }

            let output_path = execution.output_path;
            let next_turn = self.update_turn_status(
                &turn.id,
                TurnStatus::Executed,
                turn.validation_error_count,
            )?;
            let execution_artifact_id = self.record_turn_artifact(
                &session.id,
                &turn.id,
                "execution",
                &json!({
                    "executed": true,
                    "outputPath": output_path.clone(),
                    "warnings": warnings.clone(),
                }),
                Some(output_path.clone()),
            )?;
            self.touch_session(&session.id)?;
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&execution_artifact_id),
                "execution-recorded",
                "Execution wrote a save-copy output for the current turn.".to_string(),
                Some(json!({
                    "executionArtifactId": execution_artifact_id.clone(),
                    "executed": true,
                    "outputPath": output_path.clone(),
                })),
            )?;

            return Ok(RunExecutionResponse {
                turn: next_turn,
                executed: true,
                output_path: Some(output_path),
                warnings,
                reason: None,
            });
        }

        let next_turn =
            self.update_turn_status(&turn.id, TurnStatus::Executed, turn.validation_error_count)?;
        let execution_artifact_id = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "execution",
            &json!({
                "executed": true,
                "warnings": ["No write actions were present, so execution completed as a no-op."],
            }),
            None,
        )?;
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&execution_artifact_id),
            "execution-recorded",
            "Execution completed without write actions.".to_string(),
            Some(json!({
                "executionArtifactId": execution_artifact_id.clone(),
                "executed": true,
            })),
        )?;

        Ok(RunExecutionResponse {
            turn: next_turn,
            executed: true,
            output_path: None,
            warnings: vec![
                "No write actions were present, so execution completed as a no-op.".to_string(),
            ],
            reason: None,
        })
    }

    fn get_session_and_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(Session, Turn), String> {
        let session = self
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        if !session.turn_ids.iter().any(|id| id == turn_id) {
            return Err(format!(
                "turn `{turn_id}` does not belong to session `{session_id}`"
            ));
        }
        let turn = self
            .turns
            .get(turn_id)
            .cloned()
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;

        Ok((session, turn))
    }

    fn update_turn_status(
        &mut self,
        turn_id: &str,
        status: TurnStatus,
        validation_error_count: u32,
    ) -> Result<Turn, String> {
        let turn = self
            .turns
            .get_mut(turn_id)
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;
        turn.status = status;
        turn.validation_error_count = validation_error_count;
        turn.updated_at = timestamp();

        Ok(turn.clone())
    }

    fn persist_session_state(&mut self, session_id: &str) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let manifest = self
            .manifest
            .as_mut()
            .ok_or_else(|| "storage manifest was not initialized".to_string())?;

        persistence::persist_session_state(
            app_local_data_dir,
            manifest,
            &self.sessions,
            &self.turns,
            session_id,
            &timestamp(),
        )
    }

    fn record_turn_artifact<T: Serialize>(
        &mut self,
        session_id: &str,
        turn_id: &str,
        artifact_type: &str,
        payload: &T,
        external_output_path: Option<String>,
    ) -> Result<String, String> {
        let artifact_id = Uuid::new_v4().to_string();

        if let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() {
            let meta = persistence::PersistedArtifactMeta {
                id: artifact_id.clone(),
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                artifact_type: artifact_type.to_string(),
                created_at: timestamp(),
                relative_payload_path: format!("artifacts/{artifact_id}/payload.json"),
                external_output_path,
            };
            persistence::persist_artifact(app_local_data_dir, &meta, payload)?;
        }

        let turn = self
            .turns
            .get_mut(turn_id)
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;
        turn.item_ids.push(artifact_id.clone());

        Ok(artifact_id)
    }

    fn collect_read_tool_artifacts(
        &self,
        session: &Session,
        turn: &Turn,
        actions: &[SpreadsheetAction],
        current_diff: &DiffSummary,
    ) -> Result<Vec<ReadToolArtifact>, String> {
        let engine = WorkbookEngine::default();
        let mut artifacts = Vec::new();

        for action in actions {
            match action.tool.as_str() {
                "workbook.inspect" => {
                    let source = self.resolve_workbook_source(
                        session,
                        action.args.get("sourcePath").and_then(Value::as_str),
                    )?;
                    let profile = engine.inspect_workbook(&source)?;
                    artifacts.push(ReadToolArtifact {
                        artifact_type: "workbook-profile",
                        payload: serde_json::to_value(&profile).map_err(|error| {
                            format!("failed to serialize workbook profile: {error}")
                        })?,
                        event_type: "workbook-inspected",
                        message: format!(
                            "Workbook inspection captured {} sheet metadata record(s).",
                            profile.sheet_count
                        ),
                        warning: format!(
                            "Read tool `workbook.inspect` captured {} sheet profile(s).",
                            profile.sheet_count
                        ),
                    });
                }
                "sheet.preview" => {
                    let sheet = action
                        .args
                        .get("sheet")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "sheet.preview requires a sheet argument".to_string())?;
                    let source = self.resolve_workbook_source(session, None)?;
                    let preview = engine.sheet_preview(
                        &source,
                        sheet,
                        action
                            .args
                            .get("limit")
                            .and_then(Value::as_u64)
                            .map(|value| value as usize),
                    )?;
                    artifacts.push(ReadToolArtifact {
                        artifact_type: "sheet-preview",
                        payload: serde_json::to_value(&preview).map_err(|error| {
                            format!("failed to serialize sheet preview: {error}")
                        })?,
                        event_type: "sheet-preview-generated",
                        message: format!(
                            "Sheet preview captured {} row(s) from `{}`.",
                            preview.rows.len(),
                            preview.sheet
                        ),
                        warning: format!(
                            "Read tool `sheet.preview` captured {} preview row(s) from `{}`.",
                            preview.rows.len(),
                            preview.sheet
                        ),
                    });
                }
                "sheet.profile_columns" => {
                    let sheet = action
                        .args
                        .get("sheet")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            "sheet.profile_columns requires a sheet argument".to_string()
                        })?;
                    let source = self.resolve_workbook_source(session, None)?;
                    let profile = engine.profile_sheet_columns(
                        &source,
                        sheet,
                        action
                            .args
                            .get("sampleSize")
                            .and_then(Value::as_u64)
                            .map(|value| value as usize),
                    )?;
                    artifacts.push(ReadToolArtifact {
                        artifact_type: "column-profile",
                        payload: serde_json::to_value(&profile).map_err(|error| {
                            format!("failed to serialize column profile: {error}")
                        })?,
                        event_type: "sheet-columns-profiled",
                        message: format!(
                            "Column profiling ran on `{}` using {} sampled row(s).",
                            profile.sheet, profile.sampled_rows
                        ),
                        warning: format!(
                            "Read tool `sheet.profile_columns` profiled {} column(s) on `{}`.",
                            profile.columns.len(),
                            profile.sheet
                        ),
                    });
                }
                "session.diff_from_base" => {
                    let diff = self.session_diff_from_base(
                        session,
                        turn,
                        action.args.get("artifactId").and_then(Value::as_str),
                        current_diff,
                    )?;
                    artifacts.push(ReadToolArtifact {
                        artifact_type: "diff-summary",
                        payload: serde_json::to_value(&diff)
                            .map_err(|error| format!("failed to serialize diff summary: {error}"))?,
                        event_type: "session-diff-from-base-generated",
                        message: format!(
                            "Diff-from-base resolved {} sheet summary record(s).",
                            diff.sheets.len()
                        ),
                        warning: format!(
                            "Read tool `session.diff_from_base` resolved {} sheet diff summary record(s).",
                            diff.sheets.len()
                        ),
                    });
                }
                _ => {}
            }
        }

        Ok(artifacts)
    }

    fn resolve_workbook_source(
        &self,
        session: &Session,
        override_source_path: Option<&str>,
    ) -> Result<WorkbookSource, String> {
        let source_path = override_source_path
            .or(session.primary_workbook_path.as_deref())
            .ok_or_else(|| {
                format!(
                    "session `{}` does not have a workbook source path for read-side tools",
                    session.id
                )
            })?;

        WorkbookSource::detect(source_path.to_string())
    }

    fn session_diff_from_base(
        &self,
        session: &Session,
        turn: &Turn,
        artifact_id: Option<&str>,
        current_diff: &DiffSummary,
    ) -> Result<DiffSummary, String> {
        if let Some(artifact_id) = artifact_id {
            return self.read_diff_summary_artifact(&session.id, artifact_id);
        }

        for persisted_artifact_id in turn.item_ids.iter().rev() {
            if let Ok(diff) = self.read_diff_summary_artifact(&session.id, persisted_artifact_id) {
                return Ok(diff);
            }
        }

        Ok(current_diff.clone())
    }

    fn read_diff_summary_artifact(
        &self,
        session_id: &str,
        artifact_id: &str,
    ) -> Result<DiffSummary, String> {
        let app_local_data_dir = self
            .app_local_data_dir
            .as_deref()
            .ok_or_else(|| "diff artifacts can only be read from local JSON storage".to_string())?;
        let meta = persistence::read_artifact_meta(app_local_data_dir, session_id, artifact_id)?;

        if !matches!(meta.artifact_type.as_str(), "preview" | "diff-summary") {
            return Err(format!(
                "artifact `{artifact_id}` is `{}` and cannot be used for session.diff_from_base",
                meta.artifact_type
            ));
        }

        let payload: Value =
            persistence::read_artifact_payload(app_local_data_dir, session_id, artifact_id)?;

        match meta.artifact_type.as_str() {
            "preview" => {
                serde_json::from_value(payload.get("diffSummary").cloned().ok_or_else(|| {
                    format!(
                        "preview artifact `{artifact_id}` does not contain a diffSummary payload"
                    )
                })?)
                .map_err(|error| {
                    format!("failed to parse preview diff summary from `{artifact_id}`: {error}")
                })
            }
            "diff-summary" => serde_json::from_value(payload).map_err(|error| {
                format!("failed to parse diff summary artifact `{artifact_id}`: {error}")
            }),
            _ => unreachable!("artifact type was filtered above"),
        }
    }

    fn append_session_log(
        &self,
        session_id: &str,
        event_type: &str,
        message: String,
        artifact_id: Option<&str>,
        details: Option<Value>,
    ) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let entry = persistence::PersistedLogEntry {
            timestamp: timestamp(),
            session_id: session_id.to_string(),
            turn_id: None,
            artifact_id: artifact_id.map(str::to_string),
            event_type: event_type.to_string(),
            message,
            details,
        };

        persistence::append_session_log(app_local_data_dir, &entry)
    }

    fn append_turn_log(
        &self,
        session_id: &str,
        turn_id: &str,
        artifact_id: Option<&str>,
        event_type: &str,
        message: String,
        details: Option<Value>,
    ) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let entry = persistence::PersistedLogEntry {
            timestamp: timestamp(),
            session_id: session_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            artifact_id: artifact_id.map(str::to_string),
            event_type: event_type.to_string(),
            message,
            details,
        };

        persistence::append_turn_log(app_local_data_dir, &entry)
    }

    fn touch_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        session.updated_at = timestamp();
        self.persist_session_state(session_id)
    }
}

fn build_packet_context(session: &Session, turn: &Turn) -> Vec<String> {
    let mut context = vec![
        format!("Session objective: {}", session.objective),
        format!("Turn title: {}", turn.title),
        "Safe mode: preview and approval are required before writes.".to_string(),
    ];

    if let Some(path) = &session.primary_workbook_path {
        context.push(format!("Primary workbook path: {path}"));
    }

    context
}

fn collect_execution_warnings(preview: &StoredPreview) -> Vec<String> {
    let mut warnings = preview.warnings.clone();

    for warning in &preview.diff_summary.warnings {
        push_unique_string(&mut warnings, warning.clone());
    }

    for sheet in &preview.diff_summary.sheets {
        for warning in &sheet.warnings {
            push_unique_string(&mut warnings, warning.clone());
        }
    }

    warnings
}

fn push_unique_string(values: &mut Vec<String>, value: String) {
    if values.iter().any(|existing| existing == &value) {
        return;
    }

    values.push(value);
}

fn parse_copilot_response(
    raw_response: &str,
) -> (Option<CopilotTurnResponse>, Vec<ValidationIssue>) {
    let parsed = match serde_json::from_str::<Value>(raw_response) {
        Ok(value) => value,
        Err(error) => {
            return (
                None,
                vec![issue(
                    vec![],
                    format!("Response must be valid JSON: {error}"),
                    "invalid_json",
                )],
            );
        }
    };

    let root = match parsed.as_object() {
        Some(object) => object,
        None => {
            return (
                None,
                vec![issue(
                    vec![],
                    "Response must be a JSON object.".to_string(),
                    "invalid_root",
                )],
            );
        }
    };

    let mut validation_issues = Vec::new();

    let version = optional_string(
        root.get("version"),
        vec![json!("version")],
        &mut validation_issues,
    )
    .unwrap_or_else(|| "1.0".to_string());
    let summary = match required_string(
        root.get("summary"),
        vec![json!("summary")],
        &mut validation_issues,
    ) {
        Some(summary) => summary,
        None => String::new(),
    };
    let follow_up_questions = optional_string_array(
        root.get("followUpQuestions"),
        vec![json!("followUpQuestions")],
        &mut validation_issues,
    )
    .unwrap_or_default();
    let warnings = optional_string_array(
        root.get("warnings"),
        vec![json!("warnings")],
        &mut validation_issues,
    )
    .unwrap_or_default();

    let actions = match root.get("actions") {
        None => Vec::new(),
        Some(value) => parse_actions(value, &mut validation_issues),
    };

    if validation_issues.is_empty() {
        (
            Some(CopilotTurnResponse {
                version,
                summary,
                actions,
                follow_up_questions,
                warnings,
            }),
            validation_issues,
        )
    } else {
        (None, validation_issues)
    }
}

fn parse_actions(
    value: &Value,
    validation_issues: &mut Vec<ValidationIssue>,
) -> Vec<SpreadsheetAction> {
    let Some(action_values) = value.as_array() else {
        validation_issues.push(issue(
            vec![json!("actions")],
            "actions must be an array.".to_string(),
            "invalid_actions",
        ));
        return Vec::new();
    };

    let mut actions = Vec::new();

    for (index, action_value) in action_values.iter().enumerate() {
        let action_path = vec![json!("actions"), json!(index)];
        let Some(action_object) = action_value.as_object() else {
            validation_issues.push(issue(
                action_path,
                "Each action must be an object.".to_string(),
                "invalid_action",
            ));
            continue;
        };

        let tool = match required_string(
            action_object.get("tool"),
            vec![json!("actions"), json!(index), json!("tool")],
            validation_issues,
        ) {
            Some(tool) => tool,
            None => continue,
        };

        if !is_known_tool(&tool) {
            validation_issues.push(issue(
                vec![json!("actions"), json!(index), json!("tool")],
                format!("Unsupported tool `{tool}`."),
                "unknown_tool",
            ));
            continue;
        }

        let id = optional_string(
            action_object.get("id"),
            vec![json!("actions"), json!(index), json!("id")],
            validation_issues,
        );
        let rationale = optional_string(
            action_object.get("rationale"),
            vec![json!("actions"), json!(index), json!("rationale")],
            validation_issues,
        );
        let sheet = optional_string(
            action_object.get("sheet"),
            vec![json!("actions"), json!(index), json!("sheet")],
            validation_issues,
        );
        let args_path = vec![json!("actions"), json!(index), json!("args")];
        let args = match action_object.get("args") {
            Some(args) if args.is_object() => args.clone(),
            Some(_) => {
                validation_issues.push(issue(
                    args_path,
                    "args must be an object.".to_string(),
                    "invalid_args",
                ));
                continue;
            }
            None => {
                validation_issues.push(issue(
                    args_path,
                    "args is required.".to_string(),
                    "missing_args",
                ));
                continue;
            }
        };

        validate_action_shape(&tool, sheet.as_deref(), &args, index, validation_issues);

        actions.push(SpreadsheetAction {
            id,
            tool,
            rationale,
            sheet,
            args,
        });
    }

    actions
}

fn validate_action_shape(
    tool: &str,
    sheet: Option<&str>,
    args: &Value,
    index: usize,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    if tool_requires_sheet(tool) && sheet.is_none() {
        validation_issues.push(issue(
            vec![json!("actions"), json!(index), json!("sheet")],
            format!("Action `{tool}` requires a sheet."),
            "missing_sheet",
        ));
    }

    let Some(args_object) = args.as_object() else {
        return;
    };

    match tool {
        "workbook.inspect" => {
            if let Some(source_path) = args_object.get("sourcePath") {
                validate_non_empty_string(
                    source_path,
                    path(index, "args", "sourcePath"),
                    validation_issues,
                );
            }
        }
        "sheet.preview" => {
            require_arg_string(args_object, index, "sheet", validation_issues);
            validate_optional_positive_integer(
                args_object.get("limit"),
                index,
                "limit",
                validation_issues,
            );
        }
        "sheet.profile_columns" => {
            require_arg_string(args_object, index, "sheet", validation_issues);
            validate_optional_positive_integer(
                args_object.get("sampleSize"),
                index,
                "sampleSize",
                validation_issues,
            );
        }
        "session.diff_from_base" => {
            if let Some(artifact_id) = args_object.get("artifactId") {
                validate_non_empty_string(
                    artifact_id,
                    path(index, "args", "artifactId"),
                    validation_issues,
                );
            }
        }
        "table.rename_columns" => {
            validate_rename_columns(args_object, index, validation_issues);
        }
        "table.cast_columns" => {
            validate_cast_columns(args_object, index, validation_issues);
        }
        "table.filter_rows" => {
            require_arg_string(args_object, index, "predicate", validation_issues);
            if let Some(output_sheet) = args_object.get("outputSheet") {
                validate_non_empty_string(
                    output_sheet,
                    path(index, "args", "outputSheet"),
                    validation_issues,
                );
            }
        }
        "table.derive_column" => {
            require_arg_string(args_object, index, "column", validation_issues);
            require_arg_string(args_object, index, "expression", validation_issues);
            if let Some(position) = args_object.get("position") {
                validate_enum(
                    position,
                    path(index, "args", "position"),
                    &["start", "end", "after"],
                    validation_issues,
                );
            }
            if let Some(after_column) = args_object.get("afterColumn") {
                validate_non_empty_string(
                    after_column,
                    path(index, "args", "afterColumn"),
                    validation_issues,
                );
            }
        }
        "table.group_aggregate" => {
            validate_group_aggregate(args_object, index, validation_issues);
        }
        "workbook.save_copy" => {
            require_arg_string(args_object, index, "outputPath", validation_issues);
        }
        _ => {}
    }
}

fn validate_rename_columns(
    args_object: &serde_json::Map<String, Value>,
    index: usize,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    let Some(renames) = args_object.get("renames").and_then(Value::as_array) else {
        validation_issues.push(issue(
            path(index, "args", "renames"),
            "renames must be a non-empty array.".to_string(),
            "missing_renames",
        ));
        return;
    };

    if renames.is_empty() {
        validation_issues.push(issue(
            path(index, "args", "renames"),
            "renames must be a non-empty array.".to_string(),
            "empty_renames",
        ));
    }

    for (rename_index, rename) in renames.iter().enumerate() {
        let Some(rename_object) = rename.as_object() else {
            validation_issues.push(issue(
                vec![
                    json!("actions"),
                    json!(index),
                    json!("args"),
                    json!("renames"),
                    json!(rename_index),
                ],
                "Each rename must be an object.".to_string(),
                "invalid_rename",
            ));
            continue;
        };
        validate_non_empty_string(
            rename_object.get("from").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("renames"),
                json!(rename_index),
                json!("from"),
            ],
            validation_issues,
        );
        validate_non_empty_string(
            rename_object.get("to").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("renames"),
                json!(rename_index),
                json!("to"),
            ],
            validation_issues,
        );
    }
}

fn validate_cast_columns(
    args_object: &serde_json::Map<String, Value>,
    index: usize,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    let Some(casts) = args_object.get("casts").and_then(Value::as_array) else {
        validation_issues.push(issue(
            path(index, "args", "casts"),
            "casts must be a non-empty array.".to_string(),
            "missing_casts",
        ));
        return;
    };

    if casts.is_empty() {
        validation_issues.push(issue(
            path(index, "args", "casts"),
            "casts must be a non-empty array.".to_string(),
            "empty_casts",
        ));
    }

    for (cast_index, cast) in casts.iter().enumerate() {
        let Some(cast_object) = cast.as_object() else {
            validation_issues.push(issue(
                vec![
                    json!("actions"),
                    json!(index),
                    json!("args"),
                    json!("casts"),
                    json!(cast_index),
                ],
                "Each cast must be an object.".to_string(),
                "invalid_cast",
            ));
            continue;
        };
        validate_non_empty_string(
            cast_object.get("column").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("casts"),
                json!(cast_index),
                json!("column"),
            ],
            validation_issues,
        );
        validate_enum(
            cast_object.get("toType").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("casts"),
                json!(cast_index),
                json!("toType"),
            ],
            &["string", "number", "integer", "boolean", "date"],
            validation_issues,
        );
    }
}

fn validate_group_aggregate(
    args_object: &serde_json::Map<String, Value>,
    index: usize,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    validate_non_empty_string_array(
        args_object.get("groupBy"),
        path(index, "args", "groupBy"),
        validation_issues,
    );

    let Some(measures) = args_object.get("measures").and_then(Value::as_array) else {
        validation_issues.push(issue(
            path(index, "args", "measures"),
            "measures must be a non-empty array.".to_string(),
            "missing_measures",
        ));
        return;
    };

    if measures.is_empty() {
        validation_issues.push(issue(
            path(index, "args", "measures"),
            "measures must be a non-empty array.".to_string(),
            "empty_measures",
        ));
    }

    for (measure_index, measure) in measures.iter().enumerate() {
        let Some(measure_object) = measure.as_object() else {
            validation_issues.push(issue(
                vec![
                    json!("actions"),
                    json!(index),
                    json!("args"),
                    json!("measures"),
                    json!(measure_index),
                ],
                "Each measure must be an object.".to_string(),
                "invalid_measure",
            ));
            continue;
        };

        validate_non_empty_string(
            measure_object.get("column").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("measures"),
                json!(measure_index),
                json!("column"),
            ],
            validation_issues,
        );
        validate_enum(
            measure_object.get("op").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("measures"),
                json!(measure_index),
                json!("op"),
            ],
            &["sum", "avg", "count", "min", "max"],
            validation_issues,
        );
        validate_non_empty_string(
            measure_object.get("as").unwrap_or(&Value::Null),
            vec![
                json!("actions"),
                json!(index),
                json!("args"),
                json!("measures"),
                json!(measure_index),
                json!("as"),
            ],
            validation_issues,
        );
    }

    if let Some(output_sheet) = args_object.get("outputSheet") {
        validate_non_empty_string(
            output_sheet,
            path(index, "args", "outputSheet"),
            validation_issues,
        );
    }
}

fn build_repair_prompt(validation_issues: &[ValidationIssue]) -> String {
    let mut lines = vec![
        "The pasted JSON did not validate against the expected response contract.".to_string(),
        "Please resend strict JSON only and fix these issues:".to_string(),
    ];

    for issue in validation_issues.iter().take(5) {
        lines.push(format!(
            "- {} ({})",
            format_path(&issue.path),
            issue.message
        ));
    }

    lines.join("\n")
}

fn is_write_action(action: &SpreadsheetAction) -> bool {
    matches!(
        action.tool.as_str(),
        "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
            | "workbook.save_copy"
    )
}

fn is_known_tool(tool: &str) -> bool {
    matches!(
        tool,
        "workbook.inspect"
            | "sheet.preview"
            | "sheet.profile_columns"
            | "session.diff_from_base"
            | "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
            | "workbook.save_copy"
    )
}

fn tool_requires_sheet(tool: &str) -> bool {
    matches!(
        tool,
        "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
    )
}

fn read_tool_registry() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            id: "workbook.inspect".to_string(),
            title: "Inspect workbook".to_string(),
            description: "Read workbook metadata, sheets, and basic summary information."
                .to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "sheet.preview".to_string(),
            title: "Preview sheet rows".to_string(),
            description: "Read a small sample of rows from a sheet.".to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "sheet.profile_columns".to_string(),
            title: "Profile columns".to_string(),
            description: "Inspect inferred types and sample values for sheet columns.".to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "session.diff_from_base".to_string(),
            title: "Diff from base".to_string(),
            description: "Compare the current session state to the original workbook input."
                .to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
    ]
}

fn write_tool_registry() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            id: "table.rename_columns".to_string(),
            title: "Rename columns".to_string(),
            description: "Rename one or more columns in a table or sheet.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "table.cast_columns".to_string(),
            title: "Cast columns".to_string(),
            description: "Convert one or more columns to new logical types.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "table.filter_rows".to_string(),
            title: "Filter rows".to_string(),
            description: "Filter table rows into a refined output.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "table.derive_column".to_string(),
            title: "Derive column".to_string(),
            description: "Create a derived output column from an expression.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "table.group_aggregate".to_string(),
            title: "Group aggregate".to_string(),
            description: "Group rows and calculate aggregated output columns.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "workbook.save_copy".to_string(),
            title: "Save copy".to_string(),
            description: "Write the output to a new workbook or CSV copy.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
    ]
}

fn issue(path: Vec<Value>, message: String, code: &str) -> ValidationIssue {
    ValidationIssue {
        path,
        message,
        code: code.to_string(),
    }
}

fn path(index: usize, segment1: &str, segment2: &str) -> Vec<Value> {
    vec![
        json!("actions"),
        json!(index),
        json!(segment1),
        json!(segment2),
    ]
}

fn required_string(
    value: Option<&Value>,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) -> Option<String> {
    match value {
        Some(value) => match value.as_str() {
            Some(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            _ => {
                validation_issues.push(issue(
                    path,
                    "Expected a non-empty string.".to_string(),
                    "invalid_string",
                ));
                None
            }
        },
        None => {
            validation_issues.push(issue(
                path,
                "Field is required.".to_string(),
                "missing_field",
            ));
            None
        }
    }
}

fn optional_string(
    value: Option<&Value>,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) -> Option<String> {
    match value {
        None | Some(Value::Null) => None,
        Some(value) => match value.as_str() {
            Some(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            _ => {
                validation_issues.push(issue(
                    path,
                    "Expected a non-empty string.".to_string(),
                    "invalid_string",
                ));
                None
            }
        },
    }
}

fn optional_string_array(
    value: Option<&Value>,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) -> Option<Vec<String>> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::Array(items)) => {
            let mut values = Vec::new();
            for (index, item) in items.iter().enumerate() {
                if let Some(text) = item.as_str() {
                    if text.trim().is_empty() {
                        validation_issues.push(issue(
                            [path.clone(), vec![json!(index)]].concat(),
                            "Expected a non-empty string.".to_string(),
                            "invalid_string",
                        ));
                    } else {
                        values.push(text.trim().to_string());
                    }
                } else {
                    validation_issues.push(issue(
                        [path.clone(), vec![json!(index)]].concat(),
                        "Expected a string.".to_string(),
                        "invalid_string",
                    ));
                }
            }
            Some(values)
        }
        Some(_) => {
            validation_issues.push(issue(
                path,
                "Expected an array of strings.".to_string(),
                "invalid_array",
            ));
            None
        }
    }
}

fn require_arg_string(
    args_object: &serde_json::Map<String, Value>,
    index: usize,
    key: &str,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    validate_non_empty_string(
        args_object.get(key).unwrap_or(&Value::Null),
        path(index, "args", key),
        validation_issues,
    );
}

fn validate_non_empty_string(
    value: &Value,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    if !value.as_str().is_some_and(|text| !text.trim().is_empty()) {
        validation_issues.push(issue(
            path,
            "Expected a non-empty string.".to_string(),
            "invalid_string",
        ));
    }
}

fn validate_non_empty_string_array(
    value: Option<&Value>,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    let Some(items) = value.and_then(Value::as_array) else {
        validation_issues.push(issue(
            path,
            "Expected a non-empty array of strings.".to_string(),
            "invalid_array",
        ));
        return;
    };

    if items.is_empty() {
        validation_issues.push(issue(
            path,
            "Expected a non-empty array of strings.".to_string(),
            "empty_array",
        ));
        return;
    }

    for (index, item) in items.iter().enumerate() {
        let mut item_path = path.clone();
        item_path.push(json!(index));
        validate_non_empty_string(item, item_path, validation_issues);
    }
}

fn validate_optional_positive_integer(
    value: Option<&Value>,
    index: usize,
    key: &str,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    if let Some(value) = value {
        match value.as_u64() {
            Some(number) if number > 0 => {}
            _ => validation_issues.push(issue(
                path(index, "args", key),
                "Expected a positive integer.".to_string(),
                "invalid_number",
            )),
        }
    }
}

fn validate_enum(
    value: &Value,
    path: Vec<Value>,
    allowed: &[&str],
    validation_issues: &mut Vec<ValidationIssue>,
) {
    let Some(candidate) = value.as_str() else {
        validation_issues.push(issue(
            path,
            format!("Expected one of: {}.", allowed.join(", ")),
            "invalid_enum",
        ));
        return;
    };

    if !allowed
        .iter()
        .any(|allowed_value| *allowed_value == candidate)
    {
        validation_issues.push(issue(
            path,
            format!("Expected one of: {}.", allowed.join(", ")),
            "invalid_enum",
        ));
    }
}

fn format_path(path: &[Value]) -> String {
    let mut output = String::new();

    for segment in path {
        match segment {
            Value::String(text) => {
                if output.is_empty() {
                    output.push_str(text);
                } else {
                    output.push('.');
                    output.push_str(text);
                }
            }
            Value::Number(number) => {
                output.push('[');
                output.push_str(&number.to_string());
                output.push(']');
            }
            _ => {}
        }
    }

    output
}

fn require_text(field: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed.to_string())
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, env, fs, path::Path};

    use super::AppStorage;
    use crate::models::{
        ApprovalDecision, CreateSessionRequest, GenerateRelayPacketRequest,
        PreviewExecutionRequest, ReadSessionRequest, RelayMode, RespondToApprovalRequest,
        RunExecutionRequest, StartTurnRequest, SubmitCopilotResponseRequest, TurnStatus,
    };
    use crate::persistence;
    use serde::{de::DeserializeOwned, Deserialize};
    use serde_json::Value;
    use uuid::Uuid;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PersistedSessionIndexEntry {
        id: String,
        latest_turn_id: Option<String>,
    }

    #[test]
    fn creates_reads_and_starts_turns() {
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Quarterly cleanup".to_string(),
                objective: "Normalize the CSV import".to_string(),
                primary_workbook_path: Some("/tmp/input.csv".to_string()),
            })
            .expect("session should be created");

        assert_eq!(storage.session_count(), 1);
        assert_eq!(storage.list_sessions().len(), 1);

        let started = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Initial pass".to_string(),
                objective: "Profile columns".to_string(),
                mode: RelayMode::Discover,
            })
            .expect("turn should start");

        assert_eq!(
            started.session.latest_turn_id,
            Some(started.turn.id.clone())
        );
        assert_eq!(started.session.turn_ids, vec![started.turn.id.clone()]);

        let detail = storage
            .read_session(
                &ReadSessionRequest {
                    session_id: session.id,
                }
                .session_id,
            )
            .expect("session should be readable");

        assert_eq!(detail.turns.len(), 1);
        assert_eq!(detail.turns[0].title, "Initial pass");
    }

    #[test]
    fn validates_preview_and_approval_flow() {
        let csv_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = env::temp_dir()
            .join(format!("relay-agent-run-output-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Revenue cleanup".to_string(),
                objective: "Prepare a safe save-copy plan".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Draft the packet".to_string(),
                objective: "Plan a derived column and save-copy".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let packet = storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("packet should generate");
        assert_eq!(packet.allowed_write_tools.len(), 6);

        let submitted = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: format!(
                    r#"{{
                  "summary": "Create a normalized output copy.",
                  "actions": [
                    {{
                      "tool": "table.derive_column",
                      "sheet": "Sheet1",
                      "args": {{
                        "column": "normalized_total",
                        "expression": "amount",
                        "position": "end"
                      }}
                    }},
                    {{
                      "tool": "workbook.save_copy",
                      "args": {{
                        "outputPath": "{}"
                      }}
                    }}
                  ]
                }}"#,
                    output_path
                ),
            })
            .expect("response should parse");
        assert!(submitted.accepted);

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("preview should succeed");
        assert!(preview.ready);
        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.output_path, output_path);

        let approval_error = storage
            .run_execution(RunExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect_err("execution should stay blocked until approval");
        assert!(approval_error.contains("approval"));

        let approval = storage
            .respond_to_approval(RespondToApprovalRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                decision: ApprovalDecision::Approved,
                note: Some("Looks safe".to_string()),
            })
            .expect("approval should be recorded");
        assert!(approval.ready_for_execution);

        let execution = storage
            .run_execution(RunExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("execution response should return");
        assert!(execution.executed);
        assert!(execution.reason.is_none());
        assert_eq!(execution.output_path.as_deref(), Some(output_path.as_str()));
        assert_eq!(
            fs::read_to_string(&output_path).expect("executed CSV output should exist"),
            "customer_id,amount,normalized_total\n1,42.5,42.5\n2,13.0,13.0\n"
        );
        assert_eq!(
            fs::read_to_string(&csv_path).expect("source CSV should remain unchanged"),
            "customer_id,amount\n1,42.5\n2,13.0\n"
        );

        fs::remove_file(output_path).expect("executed CSV output should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn preview_execution_summarizes_parsed_csv_write_actions() {
        let csv_path = write_test_csv(
            "customer_id,amount,approved\n1,42.5,true\n2,oops,false\n3,11.25,true\n",
        );
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-storage-preview-summary-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Revenue cleanup".to_string(),
                objective: "Summarize parsed write actions before execution".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Generate preview summary".to_string(),
                objective: "Preview rename, cast, filter, derive, and save-copy actions."
                    .to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("packet should generate");
        let submitted = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: format!(
                    r#"{{
                      "summary": "Preview a normalized output copy.",
                      "actions": [
                        {{
                          "tool": "table.rename_columns",
                          "sheet": "Sheet1",
                          "args": {{
                            "renames": [
                              {{ "from": "amount", "to": "net_amount" }}
                            ]
                          }}
                        }},
                        {{
                          "tool": "table.cast_columns",
                          "sheet": "Sheet1",
                          "args": {{
                            "casts": [
                              {{ "column": "net_amount", "toType": "number" }}
                            ]
                          }}
                        }},
                        {{
                          "tool": "table.filter_rows",
                          "sheet": "Sheet1",
                          "args": {{
                            "predicate": "approved = true"
                          }}
                        }},
                        {{
                          "tool": "table.derive_column",
                          "sheet": "Sheet1",
                          "args": {{
                            "column": "gross_amount",
                            "expression": "[net_amount] + 10",
                            "position": "after",
                            "afterColumn": "net_amount"
                          }}
                        }},
                        {{
                          "tool": "workbook.save_copy",
                          "args": {{
                            "outputPath": "{}"
                          }}
                        }}
                      ]
                    }}"#,
                    output_path
                ),
            })
            .expect("response should parse");
        assert!(submitted.accepted);

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("preview should succeed");

        assert!(preview.ready);
        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets.len(), 1);
        assert_eq!(preview.diff_summary.sheets[0].target.label, "Sheet1");
        assert_eq!(preview.diff_summary.sheets[0].target.sheet, "Sheet1");
        assert_eq!(
            preview.diff_summary.sheets[0].changed_columns,
            vec!["net_amount".to_string()]
        );
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec!["gross_amount".to_string()]
        );
        assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 2);
        assert!(preview.diff_summary.sheets[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("do not match `number`")));
        assert!(!Path::new(&output_path).exists());

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn execution_sanitizes_formula_like_csv_cells_on_save_copy() {
        let original_csv = "customer_id,comment,balance\n1,=SUM(A1:A2),-5\n2,@mention,+4\n";
        let csv_path = write_test_csv(original_csv);
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-sanitized-output-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Sanitize CSV output".to_string(),
                objective: "Neutralize formula-like prefixes in save-copy execution".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Create safe CSV copy".to_string(),
                objective: "Preview and execute a sanitized CSV output.".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("packet should generate");
        storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: format!(
                    r#"{{
                      "summary": "Write a sanitized CSV save-copy output.",
                      "actions": [
                        {{
                          "tool": "table.derive_column",
                          "sheet": "Sheet1",
                          "args": {{
                            "column": "review_flag",
                            "expression": "\"=needs-review\"",
                            "position": "end"
                          }}
                        }},
                        {{
                          "tool": "workbook.save_copy",
                          "args": {{
                            "outputPath": "{}"
                          }}
                        }}
                      ]
                    }}"#,
                    output_path
                ),
            })
            .expect("response should parse");
        storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("preview should succeed");
        storage
            .respond_to_approval(RespondToApprovalRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                decision: ApprovalDecision::Approved,
                note: Some("Sanitize dangerous prefixes".to_string()),
            })
            .expect("approval should be recorded");

        let execution = storage
            .run_execution(RunExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("execution should write a sanitized copy");

        assert!(execution.executed);
        assert_eq!(execution.output_path.as_deref(), Some(output_path.as_str()));
        assert!(execution
            .warnings
            .iter()
            .any(|warning| warning.contains("CSV output sanitization prefixed 6 cell(s)")));
        assert_eq!(
            fs::read_to_string(&output_path).expect("sanitized CSV output should exist"),
            "customer_id,comment,balance,review_flag\n1,'=SUM(A1:A2),'-5,'=needs-review\n2,'@mention,'+4,'=needs-review\n"
        );
        assert_eq!(
            fs::read_to_string(&csv_path).expect("source CSV should remain unchanged"),
            original_csv
        );

        fs::remove_file(output_path).expect("sanitized CSV output should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn readme_demo_flow_matches_documented_example_csv_workflow() {
        let app_local_data_dir = unique_test_app_data_dir();
        let example_csv_path = fs::canonicalize(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        )
        .expect("README demo CSV should exist");
        let original_csv =
            fs::read_to_string(&example_csv_path).expect("README demo CSV should be readable");
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-readme-demo-output-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();

        let execution = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Revenue workflow demo".to_string(),
                    objective:
                        "Inspect the sample CSV, preview a safe transform, and write a sanitized copy."
                            .to_string(),
                    primary_workbook_path: Some(example_csv_path.to_string_lossy().into_owned()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Approved revenue cleanup".to_string(),
                    objective:
                        "Keep approved rows, add a review label, preview the diff, approve it, and save a copy."
                            .to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start")
                .turn;

            let packet = storage
                .generate_relay_packet(GenerateRelayPacketRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("packet should generate");
            assert_eq!(packet.mode, RelayMode::Plan);
            assert_eq!(packet.allowed_read_tools.len(), 4);
            assert_eq!(packet.allowed_write_tools.len(), 6);
            assert!(packet.context.iter().any(|line| line
                == &format!(
                    "Primary workbook path: {}",
                    example_csv_path.to_string_lossy()
                )));

            let submission = storage
                .submit_copilot_response(SubmitCopilotResponseRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    raw_response: format!(
                        r#"{{
                          "version": "1.0",
                          "summary": "Keep approved rows, add a review label, and write a sanitized CSV copy.",
                          "actions": [
                            {{
                              "tool": "table.filter_rows",
                              "sheet": "Sheet1",
                              "args": {{
                                "predicate": "approved = true"
                              }}
                            }},
                            {{
                              "tool": "table.derive_column",
                              "sheet": "Sheet1",
                              "args": {{
                                "column": "review_label",
                                "expression": "[segment] + \"-approved\"",
                                "position": "end"
                              }}
                            }},
                            {{
                              "tool": "workbook.save_copy",
                              "args": {{
                                "outputPath": "{}"
                              }}
                            }}
                          ],
                          "followupQuestions": [],
                          "warnings": []
                        }}"#,
                        output_path
                    ),
                })
                .expect("README response example should parse");
            assert!(submission.accepted);
            assert_eq!(
                submission
                    .parsed_response
                    .as_ref()
                    .map(|response| response.actions.len()),
                Some(3)
            );

            let preview = storage
                .preview_execution(PreviewExecutionRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("preview should succeed");
            assert!(preview.ready);
            assert!(preview.requires_approval);
            assert_eq!(preview.diff_summary.output_path, output_path);
            assert_eq!(preview.diff_summary.target_count, 1);
            assert_eq!(preview.diff_summary.estimated_affected_rows, 3);
            assert!(preview.warnings.is_empty());
            assert_eq!(preview.diff_summary.sheets.len(), 1);
            assert_eq!(preview.diff_summary.sheets[0].target.sheet, "Sheet1");
            assert_eq!(
                preview.diff_summary.sheets[0].added_columns,
                vec!["review_label".to_string()]
            );
            assert!(preview.diff_summary.sheets[0].changed_columns.is_empty());
            assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 3);
            assert!(preview.diff_summary.sheets[0].warnings.is_empty());

            let approval = storage
                .respond_to_approval(RespondToApprovalRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    decision: ApprovalDecision::Approved,
                    note: Some("README demo approval".to_string()),
                })
                .expect("approval should be recorded");
            assert!(approval.ready_for_execution);

            storage
                .run_execution(RunExecutionRequest {
                    session_id: session.id,
                    turn_id: turn.id,
                })
                .expect("execution should write the documented output")
        };

        assert!(execution.executed);
        assert_eq!(execution.output_path.as_deref(), Some(output_path.as_str()));
        assert!(execution
            .warnings
            .iter()
            .any(|warning| warning == "Approval note: README demo approval"));
        assert!(execution
            .warnings
            .iter()
            .any(|warning| warning.contains("CSV output sanitization prefixed 3 cell(s)")));
        assert_eq!(
            fs::read_to_string(&output_path).expect("README demo output should exist"),
            concat!(
                "customer_id,region,segment,amount,approved,posted_on,comment,review_label\n",
                "1,East,Retail,42.5,true,2025-01-01,'=needs-review,Retail-approved\n",
                "3,West,Retail,11.25,true,2025-01-03,'+follow-up,Retail-approved\n",
                "4,West,Enterprise,oops,true,2025-01-04,'@vip,Enterprise-approved\n"
            )
        );
        assert_eq!(
            fs::read_to_string(&example_csv_path)
                .expect("README demo source should stay unchanged"),
            original_csv
        );

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(output_path).expect("README demo output should clean up");
    }

    #[test]
    fn invalid_responses_return_validation_issues() {
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Bad payload".to_string(),
                objective: "Check validation".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Validate bad input".to_string(),
                objective: "Expect validation issues".to_string(),
                mode: RelayMode::Repair,
            })
            .expect("turn should start")
            .turn;

        storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("packet should generate");

        let submitted = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id,
                turn_id: turn.id,
                raw_response: r#"{
                  "summary": "",
                  "actions": [{ "tool": "table.derive_column", "args": {} }]
                }"#
                .to_string(),
            })
            .expect("submission should return validation issues");

        assert!(!submitted.accepted);
        assert!(!submitted.validation_issues.is_empty());
        assert!(submitted.repair_prompt.is_some());
    }

    #[test]
    fn persists_sessions_and_turns_across_reloads() {
        let app_local_data_dir = unique_test_app_data_dir();

        let session_id = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Persistence check".to_string(),
                    objective: "Reload sessions from disk".to_string(),
                    primary_workbook_path: Some("/tmp/persist.csv".to_string()),
                })
                .expect("session should be created");
            let started = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Reload me".to_string(),
                    objective: "Confirm turn data survives restart".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start");

            let storage_root = persistence::storage_root(&app_local_data_dir);
            assert!(storage_root.join("manifest.json").is_file());
            assert!(storage_root.join("sessions/index.json").is_file());
            assert!(storage_root
                .join("sessions")
                .join(&session.id)
                .join("session.json")
                .is_file());
            assert!(storage_root
                .join("sessions")
                .join(&session.id)
                .join("turns")
                .join(format!("{}.json", started.turn.id))
                .is_file());

            session.id
        };

        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let sessions = reloaded.list_sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, session_id);
        assert_eq!(
            sessions[0].latest_turn_id.as_deref(),
            sessions[0].turn_ids.last().map(String::as_str)
        );

        let detail = reloaded
            .read_session(&session_id)
            .expect("persisted session should be readable");
        assert_eq!(detail.turns.len(), 1);
        assert_eq!(detail.turns[0].title, "Reload me");
        assert_eq!(detail.turns[0].session_id, session_id);

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
    }

    #[test]
    fn reloads_session_index_and_lists_all_persisted_sessions_after_restart() {
        let app_local_data_dir = unique_test_app_data_dir();

        let (draft_session_id, active_session_id, active_turn_id) = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let draft_session = storage
                .create_session(CreateSessionRequest {
                    title: "Draft session".to_string(),
                    objective: "Remain visible after restart".to_string(),
                    primary_workbook_path: None,
                })
                .expect("draft session should be created");
            let active_session = storage
                .create_session(CreateSessionRequest {
                    title: "Active session".to_string(),
                    objective: "Retain list and detail visibility after restart".to_string(),
                    primary_workbook_path: Some("/tmp/restart-check.csv".to_string()),
                })
                .expect("active session should be created");
            let active_turn = storage
                .start_turn(StartTurnRequest {
                    session_id: active_session.id.clone(),
                    title: "Resume after relaunch".to_string(),
                    objective: "Confirm the session index matches persisted records".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("active turn should start")
                .turn;

            let storage_root = persistence::storage_root(&app_local_data_dir);
            let persisted_index: Vec<PersistedSessionIndexEntry> =
                read_json(&storage_root.join("sessions").join("index.json"))
                    .expect("session index should parse");
            let persisted_ids = persisted_index
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<BTreeSet<_>>();

            assert_eq!(persisted_index.len(), 2);
            assert_eq!(
                persisted_ids,
                BTreeSet::from([draft_session.id.clone(), active_session.id.clone()])
            );
            assert_eq!(
                persisted_index
                    .iter()
                    .find(|entry| entry.id == active_session.id)
                    .and_then(|entry| entry.latest_turn_id.as_deref()),
                Some(active_turn.id.as_str())
            );
            assert_eq!(
                persisted_index
                    .iter()
                    .find(|entry| entry.id == draft_session.id)
                    .and_then(|entry| entry.latest_turn_id.as_deref()),
                None
            );

            (draft_session.id, active_session.id, active_turn.id)
        };

        let storage_root = persistence::storage_root(&app_local_data_dir);
        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let persisted_index: Vec<PersistedSessionIndexEntry> =
            read_json(&storage_root.join("sessions").join("index.json"))
                .expect("reloaded session index should parse");

        assert_eq!(reloaded.session_count(), 2);

        let listed_ids = reloaded
            .list_sessions()
            .into_iter()
            .map(|session| session.id)
            .collect::<BTreeSet<_>>();
        let persisted_ids = persisted_index
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<BTreeSet<_>>();

        assert_eq!(listed_ids, persisted_ids);
        assert_eq!(
            persisted_index
                .iter()
                .find(|entry| entry.id == active_session_id)
                .and_then(|entry| entry.latest_turn_id.as_deref()),
            Some(active_turn_id.as_str())
        );

        let draft_detail = reloaded
            .read_session(&draft_session_id)
            .expect("draft session should still be readable");
        assert!(draft_detail.turns.is_empty());
        assert_eq!(draft_detail.session.latest_turn_id, None);

        let active_detail = reloaded
            .read_session(&active_session_id)
            .expect("active session should still be readable");
        assert_eq!(active_detail.turns.len(), 1);
        assert_eq!(active_detail.turns[0].id, active_turn_id);
        assert_eq!(
            active_detail.session.latest_turn_id.as_deref(),
            Some(active_turn_id.as_str())
        );

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
    }

    #[test]
    fn persists_turn_artifacts_and_logs_with_session_linkage() {
        let app_local_data_dir = unique_test_app_data_dir();
        let csv_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-artifact-output-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let (session_id, turn_id) = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Artifact check".to_string(),
                    objective: "Persist relay history".to_string(),
                    primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Persist every step".to_string(),
                    objective: "Generate packet, validate response, preview, approve, and run."
                        .to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start")
                .turn;

            storage
                .generate_relay_packet(GenerateRelayPacketRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("packet should generate");
            storage
                .submit_copilot_response(SubmitCopilotResponseRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    raw_response: format!(
                        r#"{{
                      "summary": "Create a normalized output copy.",
                      "actions": [
                        {{
                          "tool": "table.derive_column",
                          "sheet": "Sheet1",
                          "args": {{
                            "column": "normalized_total",
                            "expression": "amount",
                            "position": "end"
                          }}
                        }},
                        {{
                          "tool": "workbook.save_copy",
                          "args": {{
                            "outputPath": "{}"
                          }}
                        }}
                      ]
                    }}"#,
                        output_path
                    ),
                })
                .expect("response should parse");
            storage
                .preview_execution(PreviewExecutionRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("preview should succeed");
            storage
                .respond_to_approval(RespondToApprovalRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    decision: ApprovalDecision::Approved,
                    note: Some("Persist this decision".to_string()),
                })
                .expect("approval should be recorded");
            storage
                .run_execution(RunExecutionRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("execution response should return");

            (session.id, turn.id)
        };

        let storage_root = persistence::storage_root(&app_local_data_dir);
        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let detail = reloaded
            .read_session(&session_id)
            .expect("persisted session should be readable");
        let turn = detail
            .turns
            .iter()
            .find(|turn| turn.id == turn_id)
            .expect("turn should be present after reload");

        assert_eq!(turn.item_ids.len(), 6);
        assert_eq!(turn.status, TurnStatus::Executed);

        let mut artifact_types = BTreeSet::new();
        let mut execution_output_path = None;
        for artifact_id in &turn.item_ids {
            let artifact_dir = storage_root
                .join("sessions")
                .join(&session_id)
                .join("artifacts")
                .join(artifact_id);
            let meta: persistence::PersistedArtifactMeta = serde_json::from_slice(
                &fs::read(artifact_dir.join("meta.json")).expect("meta should exist"),
            )
            .expect("meta should parse");
            let payload: Value = serde_json::from_slice(
                &fs::read(artifact_dir.join("payload.json")).expect("payload should exist"),
            )
            .expect("payload should parse");

            assert_eq!(meta.session_id, session_id);
            assert_eq!(meta.turn_id, turn_id);
            assert_eq!(
                meta.relative_payload_path,
                format!("artifacts/{artifact_id}/payload.json")
            );
            assert!(payload.is_object());

            if meta.artifact_type == "execution" {
                execution_output_path = meta.external_output_path.clone();
            }

            artifact_types.insert(meta.artifact_type);
        }

        assert_eq!(
            artifact_types,
            BTreeSet::from([
                "approval".to_string(),
                "copilot-response".to_string(),
                "execution".to_string(),
                "preview".to_string(),
                "relay-packet".to_string(),
                "validation".to_string(),
            ])
        );
        assert_eq!(execution_output_path.as_deref(), Some(output_path.as_str()));

        let session_log = storage_root
            .join("sessions")
            .join(&session_id)
            .join("logs")
            .join("session.ndjson");
        let turn_log = storage_root
            .join("sessions")
            .join(&session_id)
            .join("logs")
            .join(format!("{turn_id}.ndjson"));
        let session_events: Vec<persistence::PersistedLogEntry> =
            read_ndjson(&session_log).expect("session log should parse");
        let turn_events: Vec<persistence::PersistedLogEntry> =
            read_ndjson(&turn_log).expect("turn log should parse");

        assert!(session_events
            .iter()
            .any(|entry| entry.event_type == "session-created"));
        assert!(session_events
            .iter()
            .any(|entry| entry.event_type == "turn-started"));

        let turn_event_types = turn_events
            .iter()
            .map(|entry| entry.event_type.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            turn_event_types,
            BTreeSet::from([
                "approval-recorded".to_string(),
                "copilot-response-submitted".to_string(),
                "execution-preview-created".to_string(),
                "execution-recorded".to_string(),
                "relay-packet-generated".to_string(),
                "turn-started".to_string(),
            ])
        );
        assert!(turn_events
            .iter()
            .all(|entry| entry.session_id == session_id));
        assert!(turn_events
            .iter()
            .all(|entry| entry.turn_id.as_deref() == Some(turn_id.as_str())));

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(output_path).expect("artifact output should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn preview_executes_read_side_workbook_tools_against_csv_inputs() {
        let app_local_data_dir = unique_test_app_data_dir();
        let csv_path = write_test_csv(
            "customer_id,amount,posted_on,approved\n1,42.5,2025-01-01,true\n2,13.0,2025-01-02,false\n3,11.25,2025-01-03,true\n",
        );
        let output_path = env::temp_dir()
            .join(format!("relay-agent-read-tools-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();

        let (session_id, turn_id, preview_warnings) = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Read-side workbook tools".to_string(),
                    objective: "Inspect and preview CSV state".to_string(),
                    primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Inspect source".to_string(),
                    objective: "Run read-only workbook tools before preview.".to_string(),
                    mode: RelayMode::Discover,
                })
                .expect("turn should start")
                .turn;

            storage
                .generate_relay_packet(GenerateRelayPacketRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("packet should generate");
            storage
                .submit_copilot_response(SubmitCopilotResponseRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    raw_response: format!(
                        r#"{{
                          "summary": "Inspect the workbook and stage a rename preview.",
                          "actions": [
                            {{
                              "tool": "workbook.inspect",
                              "args": {{}}
                            }},
                            {{
                              "tool": "sheet.preview",
                              "args": {{
                                "sheet": "Sheet1",
                                "limit": 2
                              }}
                            }},
                            {{
                              "tool": "sheet.profile_columns",
                              "args": {{
                                "sheet": "Sheet1",
                                "sampleSize": 2
                              }}
                            }},
                            {{
                              "tool": "session.diff_from_base",
                              "args": {{}}
                            }},
                            {{
                              "tool": "table.rename_columns",
                              "sheet": "Sheet1",
                              "args": {{
                                "renames": [
                                  {{
                                    "from": "amount",
                                    "to": "normalized_amount"
                                  }}
                                ]
                              }}
                            }},
                            {{
                              "tool": "workbook.save_copy",
                              "args": {{
                                "outputPath": "{}"
                              }}
                            }}
                          ]
                        }}"#,
                        output_path
                    ),
                })
                .expect("response should parse");
            let preview = storage
                .preview_execution(PreviewExecutionRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("preview should succeed");

            (session.id, turn.id, preview.warnings)
        };

        let storage_root = persistence::storage_root(&app_local_data_dir);
        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let detail = reloaded
            .read_session(&session_id)
            .expect("persisted session should be readable");
        let turn = detail
            .turns
            .iter()
            .find(|turn| turn.id == turn_id)
            .expect("turn should be present after reload");

        assert!(preview_warnings
            .iter()
            .any(|warning| warning.contains("workbook.inspect")));
        assert!(preview_warnings
            .iter()
            .any(|warning| warning.contains("sheet.preview")));
        assert!(preview_warnings
            .iter()
            .any(|warning| warning.contains("sheet.profile_columns")));
        assert!(preview_warnings
            .iter()
            .any(|warning| warning.contains("session.diff_from_base")));

        let mut artifact_types = BTreeSet::new();
        let mut workbook_profile_found = false;
        let mut sheet_preview_found = false;
        let mut column_profile_found = false;
        let mut diff_summary_found = false;

        for artifact_id in &turn.item_ids {
            let meta: persistence::PersistedArtifactMeta = read_json(
                &storage_root
                    .join("sessions")
                    .join(&session_id)
                    .join("artifacts")
                    .join(artifact_id)
                    .join("meta.json"),
            )
            .expect("artifact meta should parse");
            let payload: Value = read_json(
                &storage_root
                    .join("sessions")
                    .join(&session_id)
                    .join("artifacts")
                    .join(artifact_id)
                    .join("payload.json"),
            )
            .expect("artifact payload should parse");

            artifact_types.insert(meta.artifact_type.clone());

            match meta.artifact_type.as_str() {
                "workbook-profile" => {
                    workbook_profile_found = true;
                    assert_eq!(payload["sheetCount"], 1);
                    assert_eq!(payload["sheets"][0]["columns"][0], "customer_id");
                }
                "sheet-preview" => {
                    sheet_preview_found = true;
                    assert_eq!(payload["rows"].as_array().map(Vec::len), Some(2));
                    assert_eq!(payload["rows"][0]["values"][1], "42.5");
                }
                "column-profile" => {
                    column_profile_found = true;
                    assert_eq!(payload["columns"][0]["inferredType"], "integer");
                    assert_eq!(payload["columns"][1]["inferredType"], "number");
                    assert_eq!(payload["columns"][2]["inferredType"], "date");
                    assert_eq!(payload["columns"][3]["inferredType"], "boolean");
                }
                "diff-summary" => {
                    diff_summary_found = true;
                    assert_eq!(payload["targetCount"], 1);
                    assert_eq!(payload["estimatedAffectedRows"], 3);
                    assert_eq!(payload["sheets"][0]["target"]["sheet"], "Sheet1");
                    assert_eq!(
                        payload["sheets"][0]["changedColumns"][0],
                        "normalized_amount"
                    );
                    assert_eq!(payload["outputPath"], output_path);
                }
                _ => {}
            }
        }

        assert!(workbook_profile_found);
        assert!(sheet_preview_found);
        assert!(column_profile_found);
        assert!(diff_summary_found);
        assert!(artifact_types.contains("preview"));

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn preview_runs_group_aggregate_through_the_storage_flow_without_writing_files() {
        let app_local_data_dir = unique_test_app_data_dir();
        let original_csv =
            "region,segment,amount,units\nEast,Retail,10,1\nEast,SMB,15,2\nWest,Retail,3,1\nWest,SMB,oops,4\n";
        let csv_path = write_test_csv(original_csv);
        let output_path = env::temp_dir()
            .join(format!("relay-agent-demo-aggregate-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();

        let preview = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "CSV demo aggregation".to_string(),
                    objective: "Inspect and aggregate the source workbook".to_string(),
                    primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Summarize revenue by region".to_string(),
                    objective: "Inspect the CSV and preview grouped totals.".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start")
                .turn;

            storage
                .generate_relay_packet(GenerateRelayPacketRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect("packet should generate");
            storage
                .submit_copilot_response(SubmitCopilotResponseRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    raw_response: format!(
                        r#"{{
                          "summary": "Inspect the workbook and preview an aggregated save-copy output.",
                          "actions": [
                            {{
                              "tool": "workbook.inspect",
                              "args": {{}}
                            }},
                            {{
                              "tool": "table.group_aggregate",
                              "sheet": "Sheet1",
                              "args": {{
                                "groupBy": ["region"],
                                "measures": [
                                  {{
                                    "column": "amount",
                                    "op": "sum",
                                    "as": "total_amount"
                                  }},
                                  {{
                                    "column": "units",
                                    "op": "avg",
                                    "as": "average_units"
                                  }},
                                  {{
                                    "column": "segment",
                                    "op": "count",
                                    "as": "row_count"
                                  }}
                                ]
                              }}
                            }},
                            {{
                              "tool": "workbook.save_copy",
                              "args": {{
                                "outputPath": "{}"
                              }}
                            }}
                          ]
                        }}"#,
                        output_path
                    ),
                })
                .expect("response should parse");

            storage
                .preview_execution(PreviewExecutionRequest {
                    session_id: session.id,
                    turn_id: turn.id,
                })
                .expect("preview should succeed")
        };

        assert!(preview.ready);
        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets.len(), 1);
        assert_eq!(preview.diff_summary.sheets[0].target.sheet, "Sheet1");
        assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 2);
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec![
                "total_amount".to_string(),
                "average_units".to_string(),
                "row_count".to_string()
            ]
        );
        assert_eq!(
            preview.diff_summary.sheets[0].removed_columns,
            vec![
                "segment".to_string(),
                "amount".to_string(),
                "units".to_string()
            ]
        );
        assert!(preview
            .diff_summary
            .warnings
            .iter()
            .any(|warning| warning.contains("workbook.inspect")));
        assert!(preview.diff_summary.sheets[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("ignored 1 non-numeric value")));
        assert_eq!(
            fs::read_to_string(&csv_path).expect("source CSV should still exist"),
            original_csv
        );
        assert!(!Path::new(&output_path).exists());

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    fn unique_test_app_data_dir() -> std::path::PathBuf {
        env::temp_dir().join(format!("relay-agent-storage-test-{}", Uuid::new_v4()))
    }

    fn write_test_csv(contents: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-storage-test-{}.csv", Uuid::new_v4()));
        fs::write(&path, contents).expect("test csv should be written");
        path
    }

    fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
        let contents = fs::read(path)
            .map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;

        serde_json::from_slice(&contents)
            .map_err(|error| format!("failed to parse `{}`: {error}", path.display()))
    }

    fn read_ndjson<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
        let contents = fs::read_to_string(path)
            .map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;

        contents
            .lines()
            .map(|line| {
                serde_json::from_str(line)
                    .map_err(|error| format!("failed to parse `{}` line: {error}", path.display()))
            })
            .collect()
    }
}
