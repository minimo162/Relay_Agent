use super::*;

impl AppStorage {
    pub fn preview_execution(
        &mut self,
        request: PreviewExecutionRequest,
    ) -> Result<PreviewExecutionResponse, String> {
        self.preview_execution_with_policy(request, ApprovalPolicy::Safe)
    }

    pub fn preview_execution_with_policy(
        &mut self,
        request: PreviewExecutionRequest,
        approval_policy: ApprovalPolicy,
    ) -> Result<PreviewExecutionResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let structured_response = self.resolve_latest_structured_response(&session, &turn)?;

        if !structured_response.validation_issues.is_empty() {
            return Err("cannot preview execution while validation issues remain".to_string());
        }

        let parsed_response = structured_response
            .parsed_response
            .clone()
            .ok_or_else(|| "no parsed Copilot response is available for preview".to_string())?;

        let file_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_file_write_action(action))
            .cloned()
            .collect::<Vec<_>>();
        let diff_summary = build_file_write_diff_summary(&session, &file_write_actions)?;
        let warnings = build_file_write_preview_warnings(&file_write_actions)?;
        let highest_risk = parsed_response
            .actions
            .iter()
            .map(|action| evaluate_risk(&action.tool, &action.args))
            .max()
            .unwrap_or(OperationRisk::Readonly);
        let has_write_actions = parsed_response.actions.iter().any(is_write_action);
        let auto_approved = has_write_actions && should_auto_approve(approval_policy, highest_risk);
        let requires_approval = has_write_actions && !auto_approved;
        let artifacts = build_preview_artifacts(&diff_summary, &file_write_actions)?;
        let preview_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "preview",
            &json!({
                "structuredResponseSource": format!("{:?}", structured_response.source),
                "responseArtifactId": structured_response.artifact_id.clone(),
                "responseCapturedFromHistory": matches!(
                    structured_response.source,
                    StructuredResponseSource::SessionHistory
                ),
                "diffSummary": diff_summary.clone(),
                "requiresApproval": requires_approval,
                "autoApproved": auto_approved,
                "highestRisk": highest_risk,
                "approvalPolicy": approval_policy,
                "warnings": warnings.clone(),
                "fileWriteActions": file_write_actions.clone(),
                "artifacts": artifacts.clone(),
                "rawResponse": structured_response.raw_response.clone(),
                "repairPrompt": structured_response.repair_prompt.clone(),
            }),
            None,
        )?;
        let next_turn = self.update_turn_status(&turn.id, TurnStatus::PreviewReady, 0)?;
        self.previews.insert(
            turn.id.clone(),
            StoredPreview {
                diff_summary: diff_summary.clone(),
                artifacts: artifacts.clone(),
                requires_approval,
                auto_approved,
                highest_risk,
                approval_policy,
                warnings: warnings.clone(),
                created_at: preview_artifact.created_at.clone(),
                artifact_id: preview_artifact.id.clone(),
            },
        );
        self.approvals.remove(&turn.id);
        self.executions.remove(&turn.id);
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&preview_artifact.id),
            "execution-preview-created",
            "Execution preview was generated for the turn.".to_string(),
            Some(json!({
                "previewArtifactId": preview_artifact.id.clone(),
                "requiresApproval": requires_approval,
                "autoApproved": auto_approved,
                "highestRisk": highest_risk,
                "approvalPolicy": approval_policy,
                "warningCount": warnings.len(),
            })),
        )?;

        if auto_approved {
            let approval_artifact = self.record_turn_artifact(
                &session.id,
                &turn.id,
                "approval",
                &json!({
                    "decision": ApprovalDecision::Approved,
                    "note": format!("Auto-approved by {:?} policy at {:?} risk.", approval_policy, highest_risk),
                    "readyForExecution": true,
                    "autoApproved": true,
                    "previewArtifactId": preview_artifact.id.clone(),
                }),
                None,
            )?;
            self.approvals.insert(
                turn.id.clone(),
                StoredApproval {
                    decision: ApprovalDecision::Approved,
                    note: Some(format!("Auto-approved by {:?} policy.", approval_policy)),
                    ready_for_execution: true,
                    auto_approved: true,
                    preview_artifact_id: preview_artifact.id.clone(),
                    created_at: approval_artifact.created_at.clone(),
                    artifact_id: approval_artifact.id.clone(),
                },
            );
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&approval_artifact.id),
                "approval-auto-approved",
                "Preview was auto-approved by the current approval policy.".to_string(),
                Some(json!({
                    "approvalArtifactId": approval_artifact.id,
                    "approvalPolicy": approval_policy,
                    "highestRisk": highest_risk,
                })),
            )?;
        }

        Ok(PreviewExecutionResponse {
            turn: next_turn,
            ready: true,
            requires_approval,
            auto_approved,
            highest_risk,
            approval_policy,
            can_execute: !requires_approval,
            diff_summary,
            artifacts,
            warnings,
            file_write_actions,
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
        let preview_artifact_id = preview.artifact_id.clone();

        let next_status = match request.decision {
            ApprovalDecision::Approved if preview.requires_approval => TurnStatus::Approved,
            ApprovalDecision::Approved => TurnStatus::PreviewReady,
            ApprovalDecision::Rejected => TurnStatus::PreviewReady,
        };
        let ready_for_execution = matches!(request.decision, ApprovalDecision::Approved);
        let approval_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "approval",
            &json!({
                "decision": request.decision,
                "note": request.note.clone(),
                "readyForExecution": ready_for_execution,
                "previewArtifactId": preview_artifact_id.clone(),
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
                ready_for_execution,
                auto_approved: false,
                preview_artifact_id,
                created_at: approval_artifact.created_at.clone(),
                artifact_id: approval_artifact.id.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&approval_artifact.id),
            "approval-recorded",
            "Approval decision recorded for the current preview.".to_string(),
            Some(json!({
                "approvalArtifactId": approval_artifact.id.clone(),
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

    pub fn record_scope_approval(
        &mut self,
        request: RecordScopeApprovalRequest,
    ) -> Result<RecordScopeApprovalResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let response = self.resolve_latest_structured_response(&session, &turn)?;
        if response.parsed_response.is_none() || !response.validation_issues.is_empty() {
            return Err(
                "a validated structured response must exist before scope approval can be recorded"
                    .to_string(),
            );
        }
        let response_artifact_id = response.artifact_id.clone();
        let root_folder = require_text("rootFolder", request.root_folder)?;
        let violations = request
            .violations
            .into_iter()
            .map(|value| require_text("violations[]", value))
            .collect::<Result<Vec<_>, _>>()?;

        if violations.is_empty() {
            return Err("at least one project-scope violation is required".to_string());
        }

        let scope_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "scope-approval",
            &ScopeApprovalArtifactPayload {
                decision: request.decision,
                root_folder: root_folder.clone(),
                violations: violations.clone(),
                source: request.source,
                note: request.note.clone(),
                response_artifact_id: response_artifact_id.clone(),
            },
            None,
        )?;
        self.scope_approvals.insert(
            turn.id.clone(),
            StoredScopeApproval {
                decision: request.decision,
                root_folder: root_folder.clone(),
                violations: violations.clone(),
                source: request.source,
                note: request.note.clone(),
                response_artifact_id: response_artifact_id.clone(),
                created_at: scope_artifact.created_at.clone(),
                artifact_id: scope_artifact.id.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&scope_artifact.id),
            "project-scope-approval-recorded",
            match request.decision {
                ApprovalDecision::Approved => {
                    "Project-scope override approval was recorded for the current response."
                        .to_string()
                }
                ApprovalDecision::Rejected => {
                    "Project-scope override rejection was recorded for the current response."
                        .to_string()
                }
            },
            Some(json!({
                "scopeApprovalArtifactId": scope_artifact.id.clone(),
                "decision": request.decision,
                "rootFolder": root_folder,
                "violationCount": violations.len(),
                "responseArtifactId": response_artifact_id,
                "source": request.source,
            })),
        )?;

        Ok(RecordScopeApprovalResponse {
            turn: turn.clone(),
            decision: request.decision,
            recorded_at: scope_artifact.created_at,
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
            let approval = self
                .approvals
                .get(&turn.id)
                .filter(|approval| approval.preview_artifact_id == preview.artifact_id)
                .ok_or_else(|| {
                    "execution approval is required before running execution".to_string()
                })?;
            if approval.decision != ApprovalDecision::Approved {
                return Err("execution cannot proceed until the preview is approved".to_string());
            }
        }

        let structured_response = self.resolve_latest_structured_response(&session, &turn)?;
        if !structured_response.validation_issues.is_empty() {
            return Err("no validated response is available for execution".to_string());
        }
        let parsed_response = structured_response
            .parsed_response
            .ok_or_else(|| "no parsed response is available for execution".to_string())?;

        let file_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_file_write_action(action))
            .cloned()
            .collect::<Vec<_>>();

        if !file_write_actions.is_empty() {
            let mut warnings = collect_execution_warnings(&preview);
            if let Some(approval) = self
                .approvals
                .get(&turn.id)
                .filter(|approval| approval.preview_artifact_id == preview.artifact_id)
            {
                if let Some(note) = &approval.note {
                    push_unique_string(&mut warnings, format!("Approval note: {note}"));
                }
            }
            if let Some(scope_approval) = self.scope_approvals.get(&turn.id) {
                push_unique_string(
                    &mut warnings,
                    format!(
                        "Project scope override {} for {} path(s).",
                        match scope_approval.decision {
                            ApprovalDecision::Approved => "was approved",
                            ApprovalDecision::Rejected => "was rejected",
                        },
                        scope_approval.violations.len()
                    ),
                );
            }
            let mut output_path = None;
            let mut output_paths = Vec::new();

            if !file_write_actions.is_empty() {
                let file_execution = execute_file_write_actions(&file_write_actions).map_err(
                    |error| {
                        self.record_execution_failure(&session, &turn, &preview, error.clone())
                            .unwrap_or_else(|record_error| {
                                format!(
                                    "{error} (also failed to record execution failure: {record_error})"
                                )
                            })
                    },
                )?;
                for warning in file_execution.warnings {
                    push_unique_string(&mut warnings, warning);
                }
                if output_path.is_none() {
                    output_path = file_execution.output_path;
                }
            }
            if let Some(path) = output_path.clone() {
                output_paths.push(path);
            }
            let artifacts = build_execution_artifacts(
                &session,
                &preview.diff_summary,
                &file_write_actions,
                &output_paths,
            )?;

            let next_turn = self.update_turn_status(
                &turn.id,
                TurnStatus::Executed,
                turn.validation_error_count,
            )?;
            let execution_artifact = self.record_turn_artifact(
                &session.id,
                &turn.id,
                "execution",
                &json!({
                    "executed": true,
                    "outputPath": output_path.clone(),
                    "outputPaths": output_paths.clone(),
                    "artifacts": artifacts.clone(),
                    "warnings": warnings.clone(),
                }),
                output_path.clone(),
            )?;
            self.executions.insert(
                turn.id.clone(),
                StoredExecution {
                    executed: true,
                    output_path: output_path.clone(),
                    output_paths: output_paths.clone(),
                    artifacts: artifacts.clone(),
                    warnings: warnings.clone(),
                    reason: None,
                    created_at: execution_artifact.created_at.clone(),
                    artifact_id: execution_artifact.id.clone(),
                },
            );
            self.touch_session(&session.id)?;
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&execution_artifact.id),
                "execution-recorded",
                "Execution completed the approved write actions for the current turn.".to_string(),
                Some(json!({
                    "executionArtifactId": execution_artifact.id.clone(),
                    "executed": true,
                    "outputPath": output_path.clone(),
                })),
            )?;

            return Ok(RunExecutionResponse {
                turn: next_turn,
                executed: true,
                output_path,
                output_paths,
                artifacts,
                warnings,
                reason: None,
            });
        }

        let next_turn =
            self.update_turn_status(&turn.id, TurnStatus::Executed, turn.validation_error_count)?;
        let execution_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "execution",
            &json!({
                "executed": true,
                "outputPaths": [],
                "artifacts": [],
                "warnings": ["No write actions were present, so execution completed as a no-op."],
            }),
            None,
        )?;
        self.executions.insert(
            turn.id.clone(),
            StoredExecution {
                executed: true,
                output_path: None,
                output_paths: Vec::new(),
                artifacts: Vec::new(),
                warnings: vec![
                    "No write actions were present, so execution completed as a no-op.".to_string(),
                ],
                reason: None,
                created_at: execution_artifact.created_at.clone(),
                artifact_id: execution_artifact.id.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&execution_artifact.id),
            "execution-recorded",
            "Execution completed without write actions.".to_string(),
            Some(json!({
                "executionArtifactId": execution_artifact.id.clone(),
                "executed": true,
            })),
        )?;

        Ok(RunExecutionResponse {
            turn: next_turn,
            executed: true,
            output_path: None,
            output_paths: Vec::new(),
            artifacts: Vec::new(),
            warnings: vec![
                "No write actions were present, so execution completed as a no-op.".to_string(),
            ],
            reason: None,
        })
    }

    fn record_execution_failure(
        &mut self,
        session: &Session,
        turn: &Turn,
        preview: &StoredPreview,
        reason: String,
    ) -> Result<String, String> {
        let mut warnings = collect_execution_warnings(preview);
        if let Some(approval) = self
            .approvals
            .get(&turn.id)
            .filter(|approval| approval.preview_artifact_id == preview.artifact_id)
        {
            if let Some(note) = &approval.note {
                push_unique_string(&mut warnings, format!("Approval note: {note}"));
            }
        }
        if let Some(scope_approval) = self.scope_approvals.get(&turn.id) {
            push_unique_string(
                &mut warnings,
                format!(
                    "Project scope override {} for {} path(s).",
                    match scope_approval.decision {
                        ApprovalDecision::Approved => "was approved",
                        ApprovalDecision::Rejected => "was rejected",
                    },
                    scope_approval.violations.len()
                ),
            );
        }

        let next_turn =
            self.update_turn_status(&turn.id, TurnStatus::Failed, turn.validation_error_count)?;
        let output_path = Some(preview.diff_summary.output_path.clone());
        let output_paths = output_path.clone().into_iter().collect::<Vec<_>>();
        let execution_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "execution",
            &json!({
                "executed": false,
                "outputPath": output_path.clone(),
                "outputPaths": output_paths.clone(),
                "artifacts": preview.artifacts.clone(),
                "warnings": warnings.clone(),
                "reason": reason.clone(),
            }),
            output_path.clone(),
        )?;
        self.executions.insert(
            turn.id.clone(),
            StoredExecution {
                executed: false,
                output_path: output_path.clone(),
                output_paths,
                artifacts: preview.artifacts.clone(),
                warnings: warnings.clone(),
                reason: Some(reason.clone()),
                created_at: execution_artifact.created_at.clone(),
                artifact_id: execution_artifact.id.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&execution_artifact.id),
            "execution-failed",
            "Execution could not write the reviewed copy for the current turn.".to_string(),
            Some(json!({
                "executionArtifactId": execution_artifact.id.clone(),
                "executed": false,
                "outputPath": output_path,
                "reason": reason.clone(),
                "turnStatus": next_turn.status,
            })),
        )?;

        Ok(reason)
    }
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

fn build_preview_artifacts(
    diff_summary: &DiffSummary,
    actions: &[SpreadsheetAction],
) -> Result<Vec<OutputArtifact>, String> {
    let mut artifacts = Vec::new();

    if !diff_summary.sheets.is_empty() {
        artifacts.push(OutputArtifact {
            id: Uuid::new_v4().to_string(),
            r#type: ArtifactType::SpreadsheetDiff,
            label: format!(
                "{} -> {}",
                display_file_name(&diff_summary.source_path),
                display_file_name(&diff_summary.output_path)
            ),
            source_path: diff_summary.source_path.clone(),
            output_path: diff_summary.output_path.clone(),
            warnings: diff_summary.warnings.clone(),
            content: json!({
                "type": "spreadsheet_diff",
                "diffSummary": diff_summary,
            }),
        });
    }

    if !actions.is_empty() {
        artifacts.push(OutputArtifact {
            id: Uuid::new_v4().to_string(),
            r#type: ArtifactType::FileOperation,
            label: format!("{} file operation(s)", actions.len()),
            source_path: diff_summary.source_path.clone(),
            output_path: diff_summary.output_path.clone(),
            warnings: build_file_write_preview_warnings(actions)?,
            content: json!({
                "type": "file_operation",
                "operations": actions,
            }),
        });

        for action in actions
            .iter()
            .filter(|action| action.tool == "text.replace")
        {
            let preview = file_support::preview_text_replace_detail(&action.args)?;
            let path = preview
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or(&diff_summary.output_path)
                .to_string();
            let match_count = preview
                .get("matchCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let mut warnings = Vec::new();
            if preview
                .get("truncated")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                warnings.push(
                    "Text diff preview was truncated to keep the review UI compact.".to_string(),
                );
            }
            artifacts.push(OutputArtifact {
                id: Uuid::new_v4().to_string(),
                r#type: ArtifactType::TextDiff,
                label: format!("Text diff: {}", display_file_name(&path)),
                source_path: path.clone(),
                output_path: path,
                warnings,
                content: json!({
                    "type": "text_diff",
                    "before": preview.get("before").cloned().unwrap_or_else(|| json!("")),
                    "after": preview.get("after").cloned().unwrap_or_else(|| json!("")),
                    "changeCount": match_count,
                }),
            });
        }
    }

    Ok(artifacts)
}

fn build_execution_artifacts(
    session: &Session,
    diff_summary: &DiffSummary,
    actions: &[SpreadsheetAction],
    output_paths: &[String],
) -> Result<Vec<OutputArtifact>, String> {
    let mut artifacts = build_preview_artifacts(diff_summary, actions)?;
    let mut post_execution = build_output_path_artifacts(session, output_paths)?;
    artifacts.append(&mut post_execution);
    dedupe_artifacts(&mut artifacts);
    Ok(artifacts)
}

fn build_output_path_artifacts(
    session: &Session,
    output_paths: &[String],
) -> Result<Vec<OutputArtifact>, String> {
    let mut artifacts = Vec::new();

    for output_path in output_paths {
        let path = Path::new(output_path);
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if extension == "csv" {
            if let Some(artifact) = build_csv_table_artifact(output_path)? {
                artifacts.push(artifact);
            }
            continue;
        }

        if let Some(artifact) = build_raw_text_artifact(output_path)? {
            artifacts.push(artifact);
            continue;
        }

        artifacts.push(OutputArtifact {
            id: Uuid::new_v4().to_string(),
            r#type: ArtifactType::RawText,
            label: format!("Output file: {}", display_file_name(output_path)),
            source_path: session
                .primary_workbook_path
                .clone()
                .unwrap_or_else(|| output_path.clone()),
            output_path: output_path.clone(),
            warnings: vec!["Binary output cannot be previewed inline.".to_string()],
            content: json!({
                "type": "raw_text",
                "text": format!("Saved output at {}", output_path),
            }),
        });
    }

    Ok(artifacts)
}

fn build_csv_table_artifact(output_path: &str) -> Result<Option<OutputArtifact>, String> {
    let mut reader = match csv::Reader::from_path(output_path) {
        Ok(reader) => reader,
        Err(_) => return Ok(None),
    };
    let headers = reader
        .headers()
        .map_err(|error| format!("failed to read CSV headers from `{output_path}`: {error}"))?
        .iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut total_rows = 0_u64;
    for record in reader.records() {
        let record = record
            .map_err(|error| format!("failed to read CSV rows from `{output_path}`: {error}"))?;
        total_rows += 1;
        if rows.len() < 100 {
            rows.push(record.iter().map(ToOwned::to_owned).collect::<Vec<_>>());
        }
    }

    Ok(Some(OutputArtifact {
        id: Uuid::new_v4().to_string(),
        r#type: ArtifactType::CsvTable,
        label: format!("CSV preview: {}", display_file_name(output_path)),
        source_path: output_path.to_string(),
        output_path: output_path.to_string(),
        warnings: if total_rows > 100 {
            vec!["Showing the first 100 rows of the CSV output.".to_string()]
        } else {
            Vec::new()
        },
        content: json!({
            "type": "csv_table",
            "columns": headers,
            "rows": rows,
            "totalRows": total_rows,
        }),
    }))
}

fn build_raw_text_artifact(output_path: &str) -> Result<Option<OutputArtifact>, String> {
    let text = match fs::read_to_string(output_path) {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };
    let char_count = text.chars().count();
    let truncated = if char_count > 8_000 {
        let head = text.chars().take(8_000).collect::<String>();
        format!("{head}\n\n...[truncated]")
    } else {
        text
    };

    Ok(Some(OutputArtifact {
        id: Uuid::new_v4().to_string(),
        r#type: ArtifactType::RawText,
        label: format!("Text output: {}", display_file_name(output_path)),
        source_path: output_path.to_string(),
        output_path: output_path.to_string(),
        warnings: if char_count > 8_000 {
            vec!["Showing the first 8,000 characters of the output.".to_string()]
        } else {
            Vec::new()
        },
        content: json!({
            "type": "raw_text",
            "text": truncated,
        }),
    }))
}

fn dedupe_artifacts(artifacts: &mut Vec<OutputArtifact>) {
    let mut seen = Vec::<(ArtifactType, String, String)>::new();
    artifacts.retain(|artifact| {
        let key = (
            artifact.r#type,
            artifact.label.clone(),
            artifact.output_path.clone(),
        );
        if seen.iter().any(|existing| existing == &key) {
            return false;
        }
        seen.push(key);
        true
    });
}

fn display_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string())
}

fn build_file_write_diff_summary(
    session: &Session,
    actions: &[SpreadsheetAction],
) -> Result<DiffSummary, String> {
    let mut diff_summary = baseline_diff_summary(session);
    diff_summary.target_count = actions.len() as u32;
    diff_summary.output_path = actions
        .iter()
        .rev()
        .find_map(preview_output_path_for_action)
        .unwrap_or_else(|| diff_summary.output_path.clone());
    diff_summary.estimated_affected_rows =
        actions
            .iter()
            .try_fold(0_u32, |count, action| -> Result<u32, String> {
                match action.tool.as_str() {
                    "text.replace" => {
                        let preview = file_support::preview_text_replace(&action.args)?;
                        Ok(count
                            + preview
                                .get("matchCount")
                                .and_then(Value::as_u64)
                                .unwrap_or(0) as u32)
                    }
                    "file.copy" | "file.move" | "file.delete" => Ok(count + 1),
                    _ => Ok(count),
                }
            })?;
    diff_summary.warnings = build_file_write_preview_warnings(actions)?;
    Ok(diff_summary)
}

fn build_file_write_preview_warnings(actions: &[SpreadsheetAction]) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();

    for action in actions {
        match action.tool.as_str() {
            "file.delete" => {
                let path = required_action_arg_string(action, "path")?;
                if action
                    .args
                    .get("toRecycleBin")
                    .and_then(Value::as_bool)
                    .unwrap_or(true)
                {
                    push_unique_string(
                        &mut warnings,
                        format!("`{path}` will be moved to the recycle bin."),
                    );
                } else {
                    push_unique_string(
                        &mut warnings,
                        format!("`{path}` will be permanently deleted."),
                    );
                }
            }
            "text.replace" => {
                let path = required_action_arg_string(action, "path")?;
                let preview = file_support::preview_text_replace(&action.args)?;
                let match_count = preview
                    .get("matchCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let backup_enabled = action
                    .args
                    .get("createBackup")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let backup_note = if backup_enabled {
                    "A .bak backup will be created."
                } else {
                    "No backup will be created."
                };
                push_unique_string(
                    &mut warnings,
                    format!(
                        "`{path}` will apply {match_count} regex replacement(s). {backup_note}"
                    ),
                );
            }
            _ => {}
        }
    }

    Ok(warnings)
}

fn preview_output_path_for_action(action: &SpreadsheetAction) -> Option<String> {
    match action.tool.as_str() {
        "file.copy" | "file.move" => action
            .args
            .get("destPath")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "text.replace" => action
            .args
            .get("path")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        _ => None,
    }
}

fn execute_file_write_actions(
    actions: &[SpreadsheetAction],
) -> Result<FileWriteExecutionResult, String> {
    let mut output_path = None;
    let mut warnings = Vec::new();

    for action in actions {
        let result = match action.tool.as_str() {
            "file.copy" => file_support::execute_file_copy(&action.args)?,
            "file.move" => file_support::execute_file_move(&action.args)?,
            "file.delete" => file_support::execute_file_delete(&action.args)?,
            "text.replace" => file_support::execute_text_replace(&action.args)?,
            _ => continue,
        };

        if let Some(path) = result
            .get("destPath")
            .or_else(|| result.get("path"))
            .and_then(Value::as_str)
        {
            output_path = Some(path.to_string());
        }

        if action.tool == "text.replace" {
            let change_count = result
                .get("changeCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let target_path = result
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            push_unique_string(
                &mut warnings,
                format!("Updated {change_count} match(es) in `{target_path}`."),
            );
        }
    }

    Ok(FileWriteExecutionResult {
        output_path,
        warnings,
    })
}
