use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use claw_core::{ContentBlock, Message, Role};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::approval_store::{StoredApproval, StoredScopeApproval};
use crate::file_support;
use crate::mcp_client::McpClient;
use crate::models::{
    AddInboxFileRequest, AddProjectMemoryRequest, AgentLoopStatus, ApprovalDecision,
    ApprovalInspectionPayload, ArtifactType, CopilotTurnResponse, CreateProjectRequest,
    CreateSessionRequest, DiffSummary, ExecutionArtifactPayload, ExecutionInspectionPayload,
    ExecutionInspectionState, InboxFile, LinkSessionToProjectRequest, ListProjectsResponse,
    OutputArtifact, PreviewArtifactPayload, PreviewExecutionRequest, PreviewExecutionResponse,
    Project, ProjectMemoryEntry, ProjectMemorySource, ReadProjectRequest,
    ReadTurnArtifactsResponse, RecordScopeApprovalRequest, RecordScopeApprovalResponse,
    RecordStructuredResponseRequest, RecordStructuredResponseResponse, RemoveInboxFileRequest,
    RemoveProjectMemoryRequest, RespondToApprovalRequest, RespondToApprovalResponse,
    RunExecutionRequest, RunExecutionResponse, ScopeApprovalArtifactPayload, ScopeApprovalSource,
    ScopeOverrideInspectionRecord, Session, SessionDetail, SetSessionProjectRequest,
    SpreadsheetAction, StartTurnRequest, StartTurnResponse, ToolSettings, Turn, TurnArtifactRecord,
    TurnDetailsViewModel, TurnInspectionSection, TurnInspectionSourceType,
    TurnInspectionUnavailableReason, TurnOverview, TurnOverviewStep, TurnOverviewStepState,
    TurnStatus, UpdateProjectRequest, ValidationInspectionPayload, ValidationIssue,
    ValidationIssueSummary,
};
use crate::persistence::{self, PersistedArtifactMeta, StorageManifest};
use crate::risk_evaluator::{evaluate_risk, should_auto_approve, ApprovalPolicy, OperationRisk};
use crate::session_store::SessionStore;
use crate::tool_catalog::ToolCatalog;
use crate::workbook_state::{StoredExecution, StoredPreview};

#[path = "storage_runtime.rs"]
mod runtime;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StructuredResponseSource {
    PersistedArtifacts,
    SessionHistory,
}

#[derive(Clone, Debug)]
struct ResolvedStructuredResponse {
    source: StructuredResponseSource,
    raw_response: Option<String>,
    parsed_response: Option<CopilotTurnResponse>,
    validation_issues: Vec<ValidationIssue>,
    repair_prompt: Option<String>,
    artifact_id: Option<String>,
}

struct FileWriteExecutionResult {
    output_path: Option<String>,
    warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct RecordedArtifact {
    id: String,
    created_at: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationArtifactPayload {
    accepted: bool,
    validation_issues: Vec<ValidationIssue>,
    repair_prompt: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotResponseArtifactPayload {
    parsed_response: Option<CopilotTurnResponse>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalArtifactPayload {
    decision: ApprovalDecision,
    note: Option<String>,
    ready_for_execution: bool,
    preview_artifact_id: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeApprovalArtifactRecordPayload {
    decision: ApprovalDecision,
    root_folder: String,
    violations: Vec<String>,
    source: ScopeApprovalSource,
    note: Option<String>,
    response_artifact_id: Option<String>,
}

#[derive(Clone, Debug)]
struct PersistedLifecycleArtifact<T> {
    artifact_id: String,
    created_at: String,
    payload: T,
}

#[derive(Clone, Debug, Default)]
struct PersistedTurnLifecycleArtifacts {
    response: Option<PersistedLifecycleArtifact<CopilotResponseArtifactPayload>>,
    validation: Option<PersistedLifecycleArtifact<ValidationArtifactPayload>>,
    preview: Option<PersistedLifecycleArtifact<PreviewArtifactPayload>>,
    approval: Option<PersistedLifecycleArtifact<ApprovalArtifactPayload>>,
    scope_approval: Option<PersistedLifecycleArtifact<ScopeApprovalArtifactRecordPayload>>,
    execution: Option<PersistedLifecycleArtifact<ExecutionArtifactPayload>>,
}

pub struct AppStorage {
    app_local_data_dir: Option<PathBuf>,
    manifest: Option<StorageManifest>,
    tool_catalog: ToolCatalog,
    tool_settings: ToolSettings,
    tool_restore_warnings: Vec<String>,
    projects: HashMap<String, Project>,
    session_store: SessionStore,
    previews: HashMap<String, StoredPreview>,
    approvals: HashMap<String, StoredApproval>,
    scope_approvals: HashMap<String, StoredScopeApproval>,
    executions: HashMap<String, StoredExecution>,
}

impl Default for AppStorage {
    fn default() -> Self {
        Self {
            app_local_data_dir: None,
            manifest: None,
            tool_catalog: ToolCatalog::new(),
            tool_settings: ToolSettings::default(),
            tool_restore_warnings: Vec::new(),
            projects: HashMap::new(),
            session_store: SessionStore::default(),
            previews: HashMap::new(),
            approvals: HashMap::new(),
            scope_approvals: HashMap::new(),
            executions: HashMap::new(),
        }
    }
}

impl PersistedTurnLifecycleArtifacts {
    fn capture(
        &mut self,
        app_local_data_dir: &std::path::Path,
        session_id: &str,
        meta: &PersistedArtifactMeta,
    ) -> Result<(), String> {
        match meta.artifact_type.as_str() {
            "copilot-response" => {
                let payload: CopilotResponseArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.response = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            "validation" => {
                let payload: ValidationArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.validation = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            "preview" => {
                let payload: PreviewArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.preview = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            "approval" => {
                let payload: ApprovalArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.approval = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            "scope-approval" => {
                let payload: ScopeApprovalArtifactRecordPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.scope_approval = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            "execution" => {
                let payload: ExecutionArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.execution = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
            _ => {}
        }

        Ok(())
    }
}

impl AppStorage {
    pub fn open(app_local_data_dir: PathBuf) -> Result<Self, String> {
        let loaded = persistence::initialize_storage(&app_local_data_dir, &timestamp())?;
        let mut storage = Self {
            app_local_data_dir: Some(app_local_data_dir),
            manifest: Some(loaded.manifest),
            tool_settings: loaded.tool_settings,
            projects: loaded.projects,
            session_store: SessionStore::from_maps(
                loaded.sessions,
                loaded.turns,
                loaded.session_messages,
            ),
            ..Self::default()
        };
        storage.restore_tool_catalog_from_persisted_settings();
        Ok(storage)
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
        self.session_store.session_count()
    }

    pub fn storage_path(&self) -> Option<String> {
        self.app_local_data_dir
            .as_deref()
            .map(|app_local_data_dir| persistence::storage_root(app_local_data_dir))
            .map(|path| path.display().to_string())
    }

    pub fn list_tools(&self) -> crate::models::ListToolsResponse {
        crate::models::ListToolsResponse {
            tools: self.tool_catalog.list(),
            restore_warnings: self.tool_restore_warnings.clone(),
        }
    }

    pub fn set_tool_enabled(
        &mut self,
        request: crate::models::SetToolEnabledRequest,
    ) -> Result<crate::models::ToolRegistration, String> {
        let updated = self
            .tool_catalog
            .set_enabled(&request.tool_id, request.enabled)?;
        self.sync_disabled_tool_settings_from_catalog();
        self.persist_tool_settings_state()?;
        Ok(updated)
    }

    pub fn register_mcp_tools(
        &mut self,
        server: crate::models::McpServerConfig,
        tools: Vec<crate::mcp_client::McpToolDefinition>,
    ) -> Result<crate::models::ConnectMcpServerResponse, String> {
        self.upsert_mcp_server(server.clone());
        let registered_tool_ids = self.tool_catalog.register_mcp_tools(server, tools);
        self.apply_saved_disabled_tool_settings();
        self.persist_tool_settings_state()?;
        Ok(crate::models::ConnectMcpServerResponse {
            registered_tool_ids,
            tools: self.tool_catalog.list(),
        })
    }

    pub fn create_project(&mut self, request: CreateProjectRequest) -> Result<Project, String> {
        let name = require_text("name", request.name)?;
        let root_folder = require_existing_directory("rootFolder", request.root_folder)?;
        let custom_instructions = request.custom_instructions.unwrap_or_default();
        let now = timestamp();

        let project = Project {
            id: Uuid::new_v4().to_string(),
            name,
            root_folder,
            custom_instructions,
            memory: Vec::new(),
            session_ids: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };

        self.projects.insert(project.id.clone(), project.clone());
        self.persist_projects_state()?;
        Ok(project)
    }

    pub fn list_projects(&self) -> ListProjectsResponse {
        let mut projects = self.projects.values().cloned().collect::<Vec<_>>();
        projects.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        ListProjectsResponse { projects }
    }

    pub fn read_project(&self, request: ReadProjectRequest) -> Result<Project, String> {
        self.projects
            .get(&request.project_id)
            .cloned()
            .ok_or_else(|| format!("project `{}` was not found", request.project_id))
    }

    pub fn update_project(&mut self, request: UpdateProjectRequest) -> Result<Project, String> {
        let project = self
            .projects
            .get_mut(&request.project_id)
            .ok_or_else(|| format!("project `{}` was not found", request.project_id))?;

        if let Some(name) = request.name {
            project.name = require_text("name", name)?;
        }
        if let Some(custom_instructions) = request.custom_instructions {
            project.custom_instructions = custom_instructions;
        }
        project.updated_at = timestamp();

        let updated = project.clone();
        self.persist_projects_state()?;
        Ok(updated)
    }

    pub fn add_project_memory(
        &mut self,
        request: AddProjectMemoryRequest,
    ) -> Result<Project, String> {
        let key = require_text("key", request.key)?;
        let project = self
            .projects
            .get_mut(&request.project_id)
            .ok_or_else(|| format!("project `{}` was not found", request.project_id))?;
        project.memory.retain(|entry| entry.key != key);
        project.memory.push(ProjectMemoryEntry {
            key,
            value: request.value,
            learned_at: timestamp(),
            source: request.source.unwrap_or(ProjectMemorySource::User),
        });
        project
            .memory
            .sort_by(|left, right| left.key.to_lowercase().cmp(&right.key.to_lowercase()));
        project.updated_at = timestamp();

        let updated = project.clone();
        self.persist_projects_state()?;
        Ok(updated)
    }

    pub fn remove_project_memory(
        &mut self,
        request: RemoveProjectMemoryRequest,
    ) -> Result<Project, String> {
        let project = self
            .projects
            .get_mut(&request.project_id)
            .ok_or_else(|| format!("project `{}` was not found", request.project_id))?;
        project.memory.retain(|entry| entry.key != request.key);
        project.updated_at = timestamp();

        let updated = project.clone();
        self.persist_projects_state()?;
        Ok(updated)
    }

    pub fn link_session_to_project(
        &mut self,
        request: LinkSessionToProjectRequest,
    ) -> Result<Project, String> {
        if !self.session_store.contains_session(&request.session_id) {
            return Err(format!("session `{}` was not found", request.session_id));
        }

        let project = self
            .projects
            .get_mut(&request.project_id)
            .ok_or_else(|| format!("project `{}` was not found", request.project_id))?;

        if !project
            .session_ids
            .iter()
            .any(|session_id| session_id == &request.session_id)
        {
            project.session_ids.push(request.session_id);
            project.updated_at = timestamp();
        }

        let updated = project.clone();
        self.persist_projects_state()?;
        self.sync_project_inbox_files(&request.project_id)?;
        Ok(updated)
    }

    pub fn set_session_project(
        &mut self,
        request: SetSessionProjectRequest,
    ) -> Result<ListProjectsResponse, String> {
        if !self.session_store.contains_session(&request.session_id) {
            return Err(format!("session `{}` was not found", request.session_id));
        }

        let target_project_id = request.project_id.clone();
        if let Some(project_id) = target_project_id.as_deref() {
            if !self.projects.contains_key(project_id) {
                return Err(format!("project `{project_id}` was not found"));
            }
        }

        let affected_project_ids = self
            .projects
            .values()
            .filter(|project| {
                project
                    .session_ids
                    .iter()
                    .any(|session_id| session_id == &request.session_id)
            })
            .map(|project| project.id.clone())
            .collect::<BTreeSet<_>>();
        let mut changed = false;
        for project in self.projects.values_mut() {
            let before = project.session_ids.len();
            project
                .session_ids
                .retain(|session_id| session_id != &request.session_id);
            if project.session_ids.len() != before {
                project.updated_at = timestamp();
                changed = true;
            }
        }

        let mut affected_project_ids = affected_project_ids;
        if let Some(project_id) = target_project_id {
            let project = self
                .projects
                .get_mut(&project_id)
                .ok_or_else(|| format!("project `{project_id}` was not found"))?;
            if !project
                .session_ids
                .iter()
                .any(|session_id| session_id == &request.session_id)
            {
                project.session_ids.push(request.session_id);
                project.updated_at = timestamp();
                changed = true;
            }
            affected_project_ids.insert(project_id);
        }

        if changed {
            self.persist_projects_state()?;
        }

        for project_id in affected_project_ids {
            self.sync_project_inbox_files(&project_id)?;
        }

        Ok(self.list_projects())
    }

    pub fn create_session(&mut self, request: CreateSessionRequest) -> Result<Session, String> {
        let session = self.session_store.create_session(request, timestamp())?;
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

    pub fn add_inbox_file(&mut self, request: AddInboxFileRequest) -> Result<Session, String> {
        let session_id = request.session_id;
        let path = require_existing_file("path", request.path)?;
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("failed to read file metadata for `{path}`: {error}"))?;
        let inbox_file = InboxFile {
            path: path.clone(),
            size: metadata.len(),
            added_at: timestamp(),
        };
        let updated = self
            .session_store
            .add_inbox_file(&session_id, inbox_file, timestamp())?;
        self.persist_session_state(&session_id)?;
        self.append_session_log(
            &session_id,
            "inbox-file-added",
            format!("Inbox file added: {path}"),
            None,
            Some(json!({ "path": path })),
        )?;

        if let Some(project_id) = self.project_id_for_session(&session_id) {
            self.sync_project_inbox_files(&project_id)?;
            return self.read_session_model(&session_id);
        }

        Ok(updated)
    }

    pub fn remove_inbox_file(
        &mut self,
        request: RemoveInboxFileRequest,
    ) -> Result<Session, String> {
        let session_id = request.session_id;
        let path = require_text("path", request.path)?;
        let updated = self
            .session_store
            .remove_inbox_file(&session_id, &path, timestamp())?;
        self.persist_session_state(&session_id)?;
        self.append_session_log(
            &session_id,
            "inbox-file-removed",
            format!("Inbox file removed: {path}"),
            None,
            Some(json!({ "path": path })),
        )?;

        if let Some(project_id) = self.project_id_for_session(&session_id) {
            self.sync_project_inbox_files(&project_id)?;
            return self.read_session_model(&session_id);
        }

        Ok(updated)
    }

    pub fn list_sessions(&self) -> Vec<Session> {
        self.session_store.list_sessions()
    }

    pub fn read_session(&self, session_id: &str) -> Result<SessionDetail, String> {
        self.session_store.read_session(session_id)
    }

    pub(crate) fn sync_session_messages(
        &mut self,
        session_id: &str,
        messages: Vec<claw_core::Message>,
    ) -> Result<(), String> {
        self.session_store
            .sync_session_messages(session_id, messages)?;
        self.persist_session_state(session_id)
    }

    pub(crate) fn read_session_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<claw_core::Message>, String> {
        self.session_store.read_session_messages(session_id)
    }

    pub(crate) fn read_session_model(&self, session_id: &str) -> Result<Session, String> {
        self.session_store.read_session_model(session_id)
    }

    pub fn read_turn_artifacts(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<ReadTurnArtifactsResponse, String> {
        let (session, turn) = self.get_session_and_turn(session_id, turn_id)?;
        let mut artifacts = Vec::new();
        let mut persisted_lifecycle = PersistedTurnLifecycleArtifacts::default();

        if let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() {
            for artifact_id in &turn.item_ids {
                let meta =
                    persistence::read_artifact_meta(app_local_data_dir, session_id, artifact_id)?;

                if let Some(record) =
                    self.read_supported_turn_artifact(app_local_data_dir, session_id, &meta)?
                {
                    artifacts.push(record);
                }
                persisted_lifecycle.capture(app_local_data_dir, session_id, &meta)?;
            }
        }

        Ok(ReadTurnArtifactsResponse {
            turn: turn.clone(),
            storage_mode: self.storage_mode(),
            artifacts,
            turn_details: self.build_turn_details(&session, &turn, &persisted_lifecycle),
        })
    }

    pub fn start_turn(&mut self, request: StartTurnRequest) -> Result<StartTurnResponse, String> {
        let response = self.session_store.start_turn(request, timestamp())?;
        let session_snapshot = response.session.clone();
        let turn = response.turn.clone();
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

        Ok(response)
    }

    pub fn record_structured_response(
        &mut self,
        request: RecordStructuredResponseRequest,
    ) -> Result<RecordStructuredResponseResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let raw_response = request.raw_response.unwrap_or_else(|| {
            serde_json::to_string_pretty(&request.parsed_response).unwrap_or_else(|_| {
                serde_json::to_string(&request.parsed_response).unwrap_or_default()
            })
        });
        let (parsed_response, validation_issues) = parse_copilot_response(&raw_response);
        if !validation_issues.is_empty() {
            return Err(format!(
                "structured response failed backend validation: {}",
                validation_issues
                    .first()
                    .map(|issue| issue.message.as_str())
                    .unwrap_or("unknown validation error")
            ));
        }

        let parsed_response = parsed_response.ok_or_else(|| {
            "structured response could not be parsed after validation".to_string()
        })?;
        if session.latest_turn_id.as_deref() == Some(turn.id.as_str()) {
            let mut messages = self.read_session_messages(&session.id)?;
            let latest_assistant_matches = latest_assistant_text(&messages)
                .map(|text| text.trim() == raw_response.trim())
                .unwrap_or(false);
            if !latest_assistant_matches {
                messages.push(Message::assistant_text(raw_response.clone()));
                self.sync_session_messages(&session.id, messages)?;
            }
        }
        let auto_learned_memory =
            self.learn_project_memory_from_response(&session.id, Some(&parsed_response))?;
        let response_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "copilot-response",
            &json!({
                "rawResponse": raw_response,
                "accepted": true,
                "parsedResponse": parsed_response.clone(),
            }),
            None,
        )?;
        let validation_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "validation",
            &json!({
                "accepted": true,
                "validationIssues": Vec::<ValidationIssue>::new(),
                "repairPrompt": Value::Null,
            }),
            None,
        )?;
        let next_turn = self.update_turn_status(&turn.id, TurnStatus::Validated, 0)?;

        self.previews.remove(&turn.id);
        self.approvals.remove(&turn.id);
        self.scope_approvals.remove(&turn.id);
        self.executions.remove(&turn.id);
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&validation_artifact.id),
            "structured-response-recorded",
            "Structured agent response was recorded for preview.".to_string(),
            Some(json!({
                "responseArtifactId": response_artifact.id.clone(),
                "validationArtifactId": validation_artifact.id.clone(),
            })),
        )?;
        if !auto_learned_memory.is_empty() {
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&validation_artifact.id),
                "project-memory-learned",
                format!(
                    "Learned {} project preference(s) from the structured agent response.",
                    auto_learned_memory.len()
                ),
                Some(json!({
                    "projectMemory": auto_learned_memory.clone(),
                })),
            )?;
        }

        Ok(RecordStructuredResponseResponse {
            turn: next_turn,
            parsed_response,
            auto_learned_memory,
        })
    }

    fn resolve_latest_structured_response(
        &self,
        session: &Session,
        turn: &Turn,
    ) -> Result<ResolvedStructuredResponse, String> {
        if let Some(response) = self.read_persisted_structured_response(&session.id, turn)? {
            return Ok(response);
        }

        if let Some(response) = self.read_session_history_structured_response(session, turn)? {
            return Ok(response);
        }

        Err("complete an agent turn before previewing execution".to_string())
    }

    fn read_persisted_structured_response(
        &self,
        session_id: &str,
        turn: &Turn,
    ) -> Result<Option<ResolvedStructuredResponse>, String> {
        let mut persisted = PersistedTurnLifecycleArtifacts::default();

        if let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() {
            for artifact_id in &turn.item_ids {
                let meta =
                    persistence::read_artifact_meta(app_local_data_dir, session_id, artifact_id)?;
                persisted.capture(app_local_data_dir, session_id, &meta)?;
            }
        }

        let Some(response) = persisted.response.as_ref() else {
            return Ok(None);
        };

        let validation_issues = persisted
            .validation
            .as_ref()
            .map(|validation| validation.payload.validation_issues.clone())
            .unwrap_or_default();
        let repair_prompt = persisted
            .validation
            .as_ref()
            .and_then(|validation| validation.payload.repair_prompt.clone());
        let artifact_id = persisted
            .validation
            .as_ref()
            .map(|validation| validation.artifact_id.clone())
            .or_else(|| Some(response.artifact_id.clone()));

        Ok(Some(ResolvedStructuredResponse {
            source: StructuredResponseSource::PersistedArtifacts,
            raw_response: None,
            parsed_response: response.payload.parsed_response.clone(),
            validation_issues,
            repair_prompt,
            artifact_id,
        }))
    }

    fn read_session_history_structured_response(
        &self,
        session: &Session,
        turn: &Turn,
    ) -> Result<Option<ResolvedStructuredResponse>, String> {
        if session.latest_turn_id.as_deref() != Some(turn.id.as_str()) {
            return Ok(None);
        }

        let messages = self.read_session_messages(&session.id)?;
        let Some(raw_response) = latest_assistant_text(&messages) else {
            return Ok(None);
        };
        let (parsed_response, validation_issues) = parse_copilot_response(&raw_response);
        let repair_prompt = if validation_issues.is_empty() {
            None
        } else {
            Some(build_repair_prompt(&validation_issues))
        };

        Ok(Some(ResolvedStructuredResponse {
            source: StructuredResponseSource::SessionHistory,
            raw_response: Some(raw_response),
            parsed_response,
            validation_issues,
            repair_prompt,
            artifact_id: None,
        }))
    }

    fn learn_project_memory_from_response(
        &mut self,
        session_id: &str,
        parsed_response: Option<&CopilotTurnResponse>,
    ) -> Result<Vec<ProjectMemoryEntry>, String> {
        let Some(parsed_response) = parsed_response else {
            return Ok(Vec::new());
        };

        let Some(project_id) = self.find_project_id_by_session(session_id) else {
            return Ok(Vec::new());
        };

        let root_folder = self
            .projects
            .get(&project_id)
            .map(|project| project.root_folder.clone())
            .ok_or_else(|| format!("project `{project_id}` was not found"))?;
        let learned_entries = infer_auto_project_memory_entries(parsed_response, &root_folder);

        if learned_entries.is_empty() {
            return Ok(Vec::new());
        }

        let project = self
            .projects
            .get_mut(&project_id)
            .ok_or_else(|| format!("project `{project_id}` was not found"))?;
        for entry in &learned_entries {
            project.memory.retain(|existing| existing.key != entry.key);
            project.memory.push(entry.clone());
        }
        project
            .memory
            .sort_by(|left, right| left.key.to_lowercase().cmp(&right.key.to_lowercase()));
        project.updated_at = timestamp();
        self.persist_projects_state()?;

        Ok(learned_entries)
    }

    fn find_project_id_by_session(&self, session_id: &str) -> Option<String> {
        self.projects
            .values()
            .find(|project| {
                project
                    .session_ids
                    .iter()
                    .any(|existing| existing == session_id)
            })
            .map(|project| project.id.clone())
    }

    fn get_session_and_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(Session, Turn), String> {
        self.session_store.get_session_and_turn(session_id, turn_id)
    }

    fn update_turn_status(
        &mut self,
        turn_id: &str,
        status: TurnStatus,
        validation_error_count: u32,
    ) -> Result<Turn, String> {
        self.session_store
            .update_turn_status(turn_id, status, validation_error_count, timestamp())
    }

    fn project_id_for_session(&self, session_id: &str) -> Option<String> {
        self.projects
            .values()
            .find(|project| {
                project
                    .session_ids
                    .iter()
                    .any(|candidate| candidate == session_id)
            })
            .map(|project| project.id.clone())
    }

    fn sync_project_inbox_files(&mut self, project_id: &str) -> Result<(), String> {
        let Some(project) = self.projects.get(project_id) else {
            return Ok(());
        };
        let session_ids = project.session_ids.clone();
        if session_ids.is_empty() {
            return Ok(());
        }

        let mut merged = HashMap::<String, InboxFile>::new();
        for session_id in &session_ids {
            let session = self.session_store.read_session_model(session_id)?;
            for file in session.inbox_files {
                merged
                    .entry(file.path.clone())
                    .and_modify(|existing| {
                        if existing.added_at < file.added_at {
                            *existing = file.clone();
                        }
                    })
                    .or_insert(file);
            }
        }

        let mut merged_files = merged.into_values().collect::<Vec<_>>();
        merged_files.sort_by(|left, right| {
            left.added_at
                .cmp(&right.added_at)
                .then_with(|| left.path.cmp(&right.path))
        });

        let now = timestamp();
        for session_id in session_ids {
            self.session_store.replace_inbox_files(
                &session_id,
                merged_files.clone(),
                now.clone(),
            )?;
            self.persist_session_state(&session_id)?;
        }

        Ok(())
    }

    fn persist_session_state(&mut self, session_id: &str) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let manifest = self
            .manifest
            .as_mut()
            .ok_or_else(|| "storage manifest was not initialized".to_string())?;
        let view = self.session_store.persisted_session_view(session_id)?;

        persistence::persist_session_state(
            app_local_data_dir,
            manifest,
            view.sessions,
            view.turns,
            session_id,
            view.messages,
            &timestamp(),
        )
    }

    fn persist_projects_state(&mut self) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let manifest = self
            .manifest
            .as_mut()
            .ok_or_else(|| "storage manifest was not initialized".to_string())?;

        persistence::persist_projects_state(
            app_local_data_dir,
            manifest,
            &self.projects,
            &timestamp(),
        )
    }

    fn persist_tool_settings_state(&mut self) -> Result<(), String> {
        let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() else {
            return Ok(());
        };
        let manifest = self
            .manifest
            .as_mut()
            .ok_or_else(|| "storage manifest was not initialized".to_string())?;

        persistence::persist_tool_settings(
            app_local_data_dir,
            manifest,
            &self.tool_settings,
            &timestamp(),
        )
    }

    fn sync_disabled_tool_settings_from_catalog(&mut self) {
        self.tool_settings.disabled_tool_ids = self
            .tool_catalog
            .list()
            .into_iter()
            .filter(|tool| !tool.enabled)
            .map(|tool| tool.id)
            .collect();
    }

    fn upsert_mcp_server(&mut self, server: crate::models::McpServerConfig) {
        self.tool_settings.mcp_servers.retain(|entry| {
            !(entry.name == server.name
                && entry.url == server.url
                && entry.transport == server.transport)
        });
        self.tool_settings.mcp_servers.push(server);
        self.tool_settings
            .mcp_servers
            .sort_by(|left, right| left.name.cmp(&right.name));
    }

    fn apply_saved_disabled_tool_settings(&mut self) {
        for tool_id in self.tool_settings.disabled_tool_ids.clone() {
            let _ = self.tool_catalog.set_enabled(&tool_id, false);
        }
    }

    fn restore_tool_catalog_from_persisted_settings(&mut self) {
        self.tool_restore_warnings.clear();
        for server in self.tool_settings.mcp_servers.clone() {
            let tools =
                match tauri::async_runtime::block_on(McpClient::new(server.clone()).list_tools()) {
                    Ok(tools) => tools,
                    Err(error) => {
                        self.tool_restore_warnings.push(format!(
                            "Saved MCP server `{}` could not be restored: {error}",
                            server.name
                        ));
                        continue;
                    }
                };
            self.tool_catalog.register_mcp_tools(server, tools);
        }

        self.apply_saved_disabled_tool_settings();
    }

    fn record_turn_artifact<T: Serialize>(
        &mut self,
        session_id: &str,
        turn_id: &str,
        artifact_type: &str,
        payload: &T,
        external_output_path: Option<String>,
    ) -> Result<RecordedArtifact, String> {
        let artifact_id = Uuid::new_v4().to_string();
        let created_at = timestamp();

        if let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() {
            let meta = persistence::PersistedArtifactMeta {
                id: artifact_id.clone(),
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                artifact_type: artifact_type.to_string(),
                created_at: created_at.clone(),
                relative_payload_path: format!("artifacts/{artifact_id}/payload.json"),
                external_output_path,
            };
            persistence::persist_artifact(app_local_data_dir, &meta, payload)?;
        }

        self.session_store
            .push_turn_item(turn_id, artifact_id.clone())?;

        Ok(RecordedArtifact {
            id: artifact_id,
            created_at,
        })
    }

    fn available_section<T: Serialize>(
        &self,
        summary: String,
        source_type: TurnInspectionSourceType,
        updated_at: String,
        artifact_id: Option<String>,
        payload: T,
    ) -> TurnInspectionSection<T> {
        TurnInspectionSection {
            available: true,
            summary,
            source_type: Some(source_type),
            updated_at: Some(updated_at),
            artifact_id,
            unavailable_reason: None,
            payload: Some(payload),
        }
    }

    fn unavailable_section<T: Serialize>(
        &self,
        summary: String,
        unavailable_reason: TurnInspectionUnavailableReason,
    ) -> TurnInspectionSection<T> {
        TurnInspectionSection {
            available: false,
            summary,
            source_type: None,
            updated_at: None,
            artifact_id: None,
            unavailable_reason: Some(unavailable_reason),
            payload: None,
        }
    }

    fn build_turn_details(
        &self,
        session: &Session,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
    ) -> TurnDetailsViewModel {
        let validation = self.resolve_validation_section(session, turn, persisted);
        let approval = self.resolve_approval_section(session, turn, persisted);
        let execution = self.resolve_execution_section(turn, persisted);

        TurnDetailsViewModel {
            overview: self.build_turn_overview(turn, persisted, &validation, &approval, &execution),
            validation,
            approval,
            execution,
        }
    }

    fn build_turn_overview(
        &self,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
        validation: &TurnInspectionSection<ValidationInspectionPayload>,
        approval: &TurnInspectionSection<ApprovalInspectionPayload>,
        execution: &TurnInspectionSection<ExecutionInspectionPayload>,
    ) -> TurnOverview {
        let preview_ready = self.previews.contains_key(&turn.id) || persisted.preview.is_some();
        let steps = vec![
            TurnOverviewStep {
                id: "validation".to_string(),
                label: "Validation".to_string(),
                state: if validation.available {
                    if validation
                        .payload
                        .as_ref()
                        .map(|payload| payload.accepted)
                        .unwrap_or(false)
                    {
                        TurnOverviewStepState::Complete
                    } else {
                        TurnOverviewStepState::Failed
                    }
                } else if turn.status == TurnStatus::Draft {
                    TurnOverviewStepState::Current
                } else {
                    TurnOverviewStepState::Pending
                },
                summary: validation.summary.clone(),
            },
            TurnOverviewStep {
                id: "preview".to_string(),
                label: "Preview".to_string(),
                state: if preview_ready {
                    TurnOverviewStepState::Complete
                } else if validation.available
                    && validation
                        .payload
                        .as_ref()
                        .map(|payload| payload.accepted)
                        .unwrap_or(false)
                {
                    TurnOverviewStepState::Current
                } else {
                    TurnOverviewStepState::Pending
                },
                summary: if let Some(preview) = self.previews.get(&turn.id) {
                    if preview.requires_approval {
                        "Preview is ready and still needs a review decision.".to_string()
                    } else {
                        "Preview is ready and does not need approval.".to_string()
                    }
                } else if let Some(preview) = persisted.preview.as_ref() {
                    if preview.payload.requires_approval {
                        "A persisted preview is available and still needs review before save."
                            .to_string()
                    } else {
                        "A persisted preview is available for read-only review.".to_string()
                    }
                } else {
                    "Preview details appear after a structured agent response is recorded."
                        .to_string()
                },
            },
            TurnOverviewStep {
                id: "approval".to_string(),
                label: "Approval".to_string(),
                state: if approval.available {
                    match approval.payload.as_ref() {
                        Some(payload) if !payload.requires_approval => {
                            TurnOverviewStepState::NotRequired
                        }
                        Some(payload) if payload.ready_for_execution => {
                            TurnOverviewStepState::Complete
                        }
                        Some(_) if preview_ready => TurnOverviewStepState::Current,
                        _ => TurnOverviewStepState::Pending,
                    }
                } else if preview_ready {
                    TurnOverviewStepState::Current
                } else {
                    TurnOverviewStepState::Pending
                },
                summary: approval.summary.clone(),
            },
            TurnOverviewStep {
                id: "execution".to_string(),
                label: "Execution".to_string(),
                state: if execution.available {
                    match execution.payload.as_ref().map(|payload| payload.state) {
                        Some(ExecutionInspectionState::Completed) => {
                            TurnOverviewStepState::Complete
                        }
                        Some(ExecutionInspectionState::Failed) => TurnOverviewStepState::Failed,
                        Some(ExecutionInspectionState::NotRequired) => {
                            TurnOverviewStepState::NotRequired
                        }
                        Some(ExecutionInspectionState::NotRun) => TurnOverviewStepState::Current,
                        None => TurnOverviewStepState::Pending,
                    }
                } else if matches!(turn.status, TurnStatus::Approved | TurnStatus::PreviewReady) {
                    TurnOverviewStepState::Current
                } else {
                    TurnOverviewStepState::Pending
                },
                summary: execution.summary.clone(),
            },
        ];

        TurnOverview {
            turn_status: turn.status,
            relay_mode: turn.mode,
            storage_mode: self.storage_mode(),
            current_stage_label: humanize_turn_status(turn.status),
            summary: match self.storage_mode() {
                "memory" => "Turn details are coming from live in-memory state. They stay available only while this app session stays open.".to_string(),
                _ => "Turn details combine the current turn state with any persisted lifecycle records that were saved locally for this turn.".to_string(),
            },
            guardrail_summary: "Relay Agent still requires preview before write, approval before write, and save-copy only output while keeping the original workbook read-only.".to_string(),
            steps,
        }
    }

    fn resolve_validation_section(
        &self,
        session: &Session,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
    ) -> TurnInspectionSection<ValidationInspectionPayload> {
        let preview_artifact_id = self
            .previews
            .get(&turn.id)
            .map(|preview| preview.artifact_id.clone())
            .or_else(|| {
                persisted
                    .preview
                    .as_ref()
                    .map(|preview| preview.artifact_id.clone())
            });

        if let Ok(response) = self.read_session_history_structured_response(session, turn) {
            if let Some(response) = response {
                let accepted = response.validation_issues.is_empty();
                let warning_count = response
                    .parsed_response
                    .as_ref()
                    .map(|payload| payload.warnings.len())
                    .unwrap_or(0);
                let issues = response
                    .validation_issues
                    .iter()
                    .map(|issue| ValidationIssueSummary {
                        path: format_issue_path(&issue.path),
                        message: issue.message.clone(),
                        code: issue.code.clone(),
                    })
                    .collect::<Vec<_>>();
                let summary = if accepted {
                    "Validation passed for the current structured response.".to_string()
                } else {
                    format!(
                        "Validation found {} issue(s) in the current structured response.",
                        response.validation_issues.len()
                    )
                };
                return self.available_section(
                    summary,
                    TurnInspectionSourceType::Live,
                    turn.updated_at.clone(),
                    response.artifact_id.clone(),
                    ValidationInspectionPayload {
                        accepted,
                        can_preview: accepted,
                        issue_count: response.validation_issues.len(),
                        warning_count,
                        headline: if accepted {
                            if warning_count > 0 {
                                "Validation passed with warnings.".to_string()
                            } else {
                                "Validation passed.".to_string()
                            }
                        } else {
                            "Validation needs changes.".to_string()
                        },
                        primary_reason: if let Some(issue) = response.validation_issues.first() {
                            issue.message.clone()
                        } else if warning_count > 0 {
                            "The response passed validation, but it still includes warning notes."
                                .to_string()
                        } else {
                            "The response is safe to send into preview.".to_string()
                        },
                        issues,
                        repair_prompt_available: response.repair_prompt.is_some(),
                        related_preview_artifact_id: preview_artifact_id,
                    },
                );
            }
        }

        if let Some(validation) = persisted.validation.as_ref() {
            let warning_count = persisted
                .response
                .as_ref()
                .and_then(|response| response.payload.parsed_response.as_ref())
                .map(|payload| payload.warnings.len())
                .unwrap_or(0);
            return self.available_section(
                if validation.payload.accepted {
                    "A saved validation result is available for this turn.".to_string()
                } else {
                    format!(
                        "A saved validation result shows {} issue(s).",
                        validation.payload.validation_issues.len()
                    )
                },
                TurnInspectionSourceType::Persisted,
                validation.created_at.clone(),
                Some(validation.artifact_id.clone()),
                ValidationInspectionPayload {
                    accepted: validation.payload.accepted,
                    can_preview: validation.payload.accepted,
                    issue_count: validation.payload.validation_issues.len(),
                    warning_count,
                    headline: if validation.payload.accepted {
                        if warning_count > 0 {
                            "Validation passed with warnings.".to_string()
                        } else {
                            "Validation passed.".to_string()
                        }
                    } else {
                        "Validation needs changes.".to_string()
                    },
                    primary_reason: validation
                        .payload
                        .validation_issues
                        .first()
                        .map(|issue| issue.message.clone())
                        .unwrap_or_else(|| {
                            if warning_count > 0 {
                                "The saved response passed validation, but it still carried warning notes.".to_string()
                            } else {
                                "The saved response was accepted for preview.".to_string()
                            }
                        }),
                    issues: validation
                        .payload
                        .validation_issues
                        .iter()
                        .map(|issue| ValidationIssueSummary {
                            path: format_issue_path(&issue.path),
                            message: issue.message.clone(),
                            code: issue.code.clone(),
                        })
                        .collect(),
                    repair_prompt_available: validation.payload.repair_prompt.is_some(),
                    related_preview_artifact_id: preview_artifact_id,
                },
            );
        }

        if turn.status == TurnStatus::Draft {
            return self.unavailable_section(
                "Validation becomes available after the first structured agent response is recorded."
                    .to_string(),
                TurnInspectionUnavailableReason::StepNotReached,
            );
        }

        self.unavailable_section(
            "Validation details are not available for this turn or this older turn version."
                .to_string(),
            TurnInspectionUnavailableReason::NotSupportedForTurnVersion,
        )
    }

    fn resolve_approval_section(
        &self,
        session: &Session,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
    ) -> TurnInspectionSection<ApprovalInspectionPayload> {
        let live_preview = self.previews.get(&turn.id);
        let persisted_preview = persisted.preview.as_ref();
        let requires_approval = live_preview
            .map(|preview| preview.requires_approval)
            .or_else(|| persisted_preview.map(|preview| preview.payload.requires_approval));
        let auto_approved = live_preview
            .map(|preview| preview.auto_approved)
            .or_else(|| persisted_preview.map(|preview| preview.payload.auto_approved))
            .unwrap_or(false);
        let highest_risk = live_preview
            .map(|preview| preview.highest_risk)
            .or_else(|| persisted_preview.map(|preview| preview.payload.highest_risk))
            .unwrap_or_default();
        let approval_policy = live_preview
            .map(|preview| preview.approval_policy)
            .or_else(|| persisted_preview.map(|preview| preview.payload.approval_policy))
            .unwrap_or_default();
        let preview_artifact_id = live_preview
            .map(|preview| preview.artifact_id.clone())
            .or_else(|| persisted_preview.map(|preview| preview.artifact_id.clone()));
        let current_response_artifact_id = self
            .resolve_latest_structured_response(session, turn)
            .ok()
            .and_then(|response| response.artifact_id)
            .or_else(|| {
                persisted
                    .validation
                    .as_ref()
                    .map(|response| response.artifact_id.clone())
            });
        let scope_override = self
            .scope_approvals
            .get(&turn.id)
            .filter(|scope| scope.response_artifact_id == current_response_artifact_id)
            .map(|scope| ScopeOverrideInspectionRecord {
                decision: scope.decision,
                decided_at: scope.created_at.clone(),
                root_folder: scope.root_folder.clone(),
                violations: scope.violations.clone(),
                source: scope.source,
                note: scope.note.clone(),
                response_artifact_id: scope.response_artifact_id.clone(),
                artifact_id: Some(scope.artifact_id.clone()),
            })
            .or_else(|| {
                persisted
                    .scope_approval
                    .as_ref()
                    .filter(|scope| {
                        scope.payload.response_artifact_id.clone() == current_response_artifact_id
                    })
                    .map(|scope| ScopeOverrideInspectionRecord {
                        decision: scope.payload.decision,
                        decided_at: scope.created_at.clone(),
                        root_folder: scope.payload.root_folder.clone(),
                        violations: scope.payload.violations.clone(),
                        source: scope.payload.source,
                        note: scope.payload.note.clone(),
                        response_artifact_id: scope.payload.response_artifact_id.clone(),
                        artifact_id: Some(scope.artifact_id.clone()),
                    })
            });
        let temporary_mode_note = (self.storage_mode() == "memory").then(|| {
            "Temporary mode keeps this approval detail only for the current app session."
                .to_string()
        });
        let live_approval = self
            .approvals
            .get(&turn.id)
            .filter(|approval| Some(approval.preview_artifact_id.clone()) == preview_artifact_id);
        let persisted_approval = persisted
            .approval
            .as_ref()
            .filter(|approval| approval.payload.preview_artifact_id.clone() == preview_artifact_id);

        if let Some(approval) = live_approval {
            return self.available_section(
                if approval.ready_for_execution {
                    "Approval is recorded and execution is allowed.".to_string()
                } else {
                    "Approval was recorded as not ready for execution.".to_string()
                },
                TurnInspectionSourceType::Live,
                approval.created_at.clone(),
                Some(approval.artifact_id.clone()),
                ApprovalInspectionPayload {
                    decision: Some(approval.decision),
                    ready_for_execution: approval.ready_for_execution,
                    requires_approval: requires_approval.unwrap_or(true),
                    auto_approved: approval.auto_approved || auto_approved,
                    highest_risk,
                    approval_policy,
                    approved_at: Some(approval.created_at.clone()),
                    note: approval.note.clone(),
                    preview_artifact_id,
                    scope_override: scope_override.clone(),
                    original_file_guardrail:
                        "The original workbook stays read-only even after approval.".to_string(),
                    save_copy_guardrail:
                        "Approval only unlocks save-copy execution to a separate output."
                            .to_string(),
                    temporary_mode_note,
                },
            );
        }

        if let Some(approval) = persisted_approval {
            return self.available_section(
                if approval.payload.ready_for_execution {
                    "A saved approval is available for this turn.".to_string()
                } else {
                    "A saved approval record shows this turn was not ready for execution."
                        .to_string()
                },
                TurnInspectionSourceType::Persisted,
                approval.created_at.clone(),
                Some(approval.artifact_id.clone()),
                ApprovalInspectionPayload {
                    decision: Some(approval.payload.decision),
                    ready_for_execution: approval.payload.ready_for_execution,
                    requires_approval: requires_approval.unwrap_or(true),
                    auto_approved,
                    highest_risk,
                    approval_policy,
                    approved_at: Some(approval.created_at.clone()),
                    note: approval.payload.note.clone(),
                    preview_artifact_id,
                    scope_override: scope_override.clone(),
                    original_file_guardrail:
                        "The original workbook stays read-only even after approval.".to_string(),
                    save_copy_guardrail:
                        "Approval only unlocks save-copy execution to a separate output."
                            .to_string(),
                    temporary_mode_note,
                },
            );
        }

        if let Some(requires_approval) = requires_approval {
            let summary = if requires_approval {
                "Approval has not been recorded yet for the current preview.".to_string()
            } else {
                match scope_override.as_ref() {
                    Some(scope) if scope.decision == ApprovalDecision::Approved => {
                        "Project-scope override was approved for the current response. No save approval is required for this preview.".to_string()
                    }
                    Some(_) => {
                        "Project-scope override was reviewed for the current response. No save approval is required for this preview.".to_string()
                    }
                    None => "This preview is read-only, so no approval step is required.".to_string()
                }
            };

            return self.available_section(
                summary,
                if live_preview.is_some() {
                    TurnInspectionSourceType::Live
                } else {
                    TurnInspectionSourceType::Persisted
                },
                live_preview
                    .map(|preview| preview.created_at.clone())
                    .or_else(|| persisted_preview.map(|preview| preview.created_at.clone()))
                    .unwrap_or_else(|| turn.updated_at.clone()),
                preview_artifact_id.clone(),
                ApprovalInspectionPayload {
                    decision: None,
                    ready_for_execution: false,
                    requires_approval,
                    auto_approved,
                    highest_risk,
                    approval_policy,
                    approved_at: None,
                    note: None,
                    preview_artifact_id,
                    scope_override: scope_override.clone(),
                    original_file_guardrail:
                        "The original workbook stays read-only even when review is complete."
                            .to_string(),
                    save_copy_guardrail:
                        "Only a separate reviewed copy can be written after the required review."
                            .to_string(),
                    temporary_mode_note,
                },
            );
        }

        if let Some(scope_override) = scope_override {
            return self.available_section(
                match scope_override.decision {
                    ApprovalDecision::Approved => {
                        "Project-scope override approval is recorded for the current response."
                            .to_string()
                    }
                    ApprovalDecision::Rejected => {
                        "Project-scope override rejection is recorded for the current response."
                            .to_string()
                    }
                },
                if self.scope_approvals.contains_key(&turn.id) {
                    TurnInspectionSourceType::Live
                } else {
                    TurnInspectionSourceType::Persisted
                },
                scope_override.decided_at.clone(),
                scope_override.artifact_id.clone(),
                ApprovalInspectionPayload {
                    decision: None,
                    ready_for_execution: false,
                    requires_approval: false,
                    auto_approved: false,
                    highest_risk,
                    approval_policy,
                    approved_at: None,
                    note: None,
                    preview_artifact_id: None,
                    scope_override: Some(scope_override),
                    original_file_guardrail:
                        "The original workbook stays read-only even when project-scope access is approved.".to_string(),
                    save_copy_guardrail:
                        "A scope override never bypasses the later save-copy preview and approval flow."
                            .to_string(),
                    temporary_mode_note,
                },
            );
        }

        self.unavailable_section(
            "Approval details appear after checked changes are ready for review.".to_string(),
            TurnInspectionUnavailableReason::StepNotReached,
        )
    }

    fn resolve_execution_section(
        &self,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
    ) -> TurnInspectionSection<ExecutionInspectionPayload> {
        if let Some(execution) = self.executions.get(&turn.id) {
            return self.available_section(
                if execution.executed {
                    "Execution finished for this turn.".to_string()
                } else {
                    "Execution recorded a failure for this turn.".to_string()
                },
                TurnInspectionSourceType::Live,
                execution.created_at.clone(),
                Some(execution.artifact_id.clone()),
                ExecutionInspectionPayload {
                    state: if execution.executed {
                        ExecutionInspectionState::Completed
                    } else {
                        ExecutionInspectionState::Failed
                    },
                    output_path: execution.output_path.clone(),
                    executed_at: Some(execution.created_at.clone()),
                    warning_count: execution.warnings.len(),
                    reason_summary: execution.reason.clone().unwrap_or_else(|| {
                        if execution.executed {
                            "Execution completed and kept the original workbook unchanged."
                                .to_string()
                        } else {
                            "Execution did not complete.".to_string()
                        }
                    }),
                    warnings: execution.warnings.clone(),
                    output_artifact_id: Some(execution.artifact_id.clone()),
                },
            );
        }

        if let Some(execution) = persisted.execution.as_ref() {
            return self.available_section(
                if execution.payload.executed {
                    "A saved execution result is available for this turn.".to_string()
                } else {
                    "A saved execution failure is available for this turn.".to_string()
                },
                TurnInspectionSourceType::Persisted,
                execution.created_at.clone(),
                Some(execution.artifact_id.clone()),
                ExecutionInspectionPayload {
                    state: if execution.payload.executed {
                        ExecutionInspectionState::Completed
                    } else {
                        ExecutionInspectionState::Failed
                    },
                    output_path: execution.payload.output_path.clone(),
                    executed_at: Some(execution.created_at.clone()),
                    warning_count: execution.payload.warnings.len(),
                    reason_summary: execution.payload.reason.clone().unwrap_or_else(|| {
                        if execution.payload.executed {
                            "Execution completed and kept the original workbook unchanged."
                                .to_string()
                        } else {
                            "Execution did not complete.".to_string()
                        }
                    }),
                    warnings: execution.payload.warnings.clone(),
                    output_artifact_id: Some(execution.artifact_id.clone()),
                },
            );
        }

        let preview_requires_approval = self
            .previews
            .get(&turn.id)
            .map(|preview| preview.requires_approval)
            .or_else(|| {
                persisted
                    .preview
                    .as_ref()
                    .map(|preview| preview.payload.requires_approval)
            });

        if let Some(requires_approval) = preview_requires_approval {
            let (state, summary) = if !requires_approval {
                (
                    ExecutionInspectionState::NotRequired,
                    "This turn only reviewed workbook state, so no save-copy execution is needed."
                        .to_string(),
                )
            } else if self
                .approvals
                .get(&turn.id)
                .filter(|approval| {
                    self.previews
                        .get(&turn.id)
                        .map(|preview| preview.artifact_id.clone())
                        .or_else(|| {
                            persisted
                                .preview
                                .as_ref()
                                .map(|preview| preview.artifact_id.clone())
                        })
                        .as_ref()
                        == Some(&approval.preview_artifact_id)
                })
                .map(|approval| approval.ready_for_execution)
                .or_else(|| {
                    persisted
                        .approval
                        .as_ref()
                        .filter(|approval| {
                            approval.payload.preview_artifact_id.clone()
                                == self
                                    .previews
                                    .get(&turn.id)
                                    .map(|preview| preview.artifact_id.clone())
                                    .or_else(|| {
                                        persisted
                                            .preview
                                            .as_ref()
                                            .map(|preview| preview.artifact_id.clone())
                                    })
                        })
                        .map(|approval| approval.payload.ready_for_execution)
                })
                .unwrap_or(false)
            {
                (
                    ExecutionInspectionState::NotRun,
                    "Approval is complete. The turn is ready to save a reviewed copy.".to_string(),
                )
            } else {
                (
                    ExecutionInspectionState::NotRun,
                    "Execution stays blocked until the required review is completed.".to_string(),
                )
            };

            return self.available_section(
                summary.clone(),
                if self.previews.contains_key(&turn.id) {
                    TurnInspectionSourceType::Live
                } else {
                    TurnInspectionSourceType::Persisted
                },
                self.previews
                    .get(&turn.id)
                    .map(|preview| preview.created_at.clone())
                    .or_else(|| {
                        persisted
                            .preview
                            .as_ref()
                            .map(|preview| preview.created_at.clone())
                    })
                    .unwrap_or_else(|| turn.updated_at.clone()),
                None,
                ExecutionInspectionPayload {
                    state,
                    output_path: None,
                    executed_at: None,
                    warning_count: 0,
                    reason_summary: summary,
                    warnings: Vec::new(),
                    output_artifact_id: None,
                },
            );
        }

        self.unavailable_section(
            "Execution details appear after preview is ready for this turn.".to_string(),
            TurnInspectionUnavailableReason::StepNotReached,
        )
    }

    fn read_supported_turn_artifact(
        &self,
        app_local_data_dir: &std::path::Path,
        session_id: &str,
        meta: &PersistedArtifactMeta,
    ) -> Result<Option<TurnArtifactRecord>, String> {
        match meta.artifact_type.as_str() {
            "diff-summary" => {
                let payload: DiffSummary =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::DiffSummary {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            "preview" => {
                let payload: PreviewArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::Preview {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            "execution" => {
                let payload: ExecutionArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::Execution {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            "scope-approval" => {
                let payload: ScopeApprovalArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::ScopeApproval {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            _ => Ok(None),
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
        self.session_store.touch_session(session_id, timestamp())?;
        self.persist_session_state(session_id)
    }
}

fn humanize_turn_status(status: TurnStatus) -> String {
    match status {
        TurnStatus::Draft => "Draft".to_string(),
        TurnStatus::Validated => "Validation passed".to_string(),
        TurnStatus::PreviewReady => "Preview ready".to_string(),
        TurnStatus::Approved => "Approved".to_string(),
        TurnStatus::Executed => "Execution completed".to_string(),
        TurnStatus::Failed => "Failed".to_string(),
    }
}

fn format_issue_path(path: &[Value]) -> String {
    format_path(path)
}

fn push_unique_string(values: &mut Vec<String>, value: String) {
    if values.iter().any(|existing| existing == &value) {
        return;
    }

    values.push(value);
}

fn infer_auto_project_memory_entries(
    response: &CopilotTurnResponse,
    root_folder: &str,
) -> Vec<ProjectMemoryEntry> {
    let learned_at = timestamp();
    let mut entries = Vec::new();

    for action in &response.actions {
        if let Some(output_path) = extract_auto_learning_output_path(action) {
            if is_within_project_scope(output_path, root_folder) {
                if let Some(parent) = Path::new(output_path)
                    .parent()
                    .and_then(|value| value.to_str())
                {
                    upsert_project_memory_entry(
                        &mut entries,
                        ProjectMemoryEntry {
                            key: "preferred_output_folder".to_string(),
                            value: parent.to_string(),
                            learned_at: learned_at.clone(),
                            source: ProjectMemorySource::Auto,
                        },
                    );
                }

                if let Some(extension) = Path::new(output_path)
                    .extension()
                    .and_then(|value| value.to_str())
                {
                    let normalized_extension = extension.trim().to_lowercase();
                    if matches!(
                        normalized_extension.as_str(),
                        "csv" | "xlsx" | "xlsm" | "xlsb"
                    ) {
                        upsert_project_memory_entry(
                            &mut entries,
                            ProjectMemoryEntry {
                                key: "preferred_output_format".to_string(),
                                value: normalized_extension,
                                learned_at: learned_at.clone(),
                                source: ProjectMemorySource::Auto,
                            },
                        );
                    }
                }
            }
        }

        if let Some(output_sheet) = action.args.get("outputSheet").and_then(Value::as_str) {
            let normalized_output_sheet = output_sheet.trim();
            if !normalized_output_sheet.is_empty() {
                upsert_project_memory_entry(
                    &mut entries,
                    ProjectMemoryEntry {
                        key: "preferred_output_sheet".to_string(),
                        value: normalized_output_sheet.to_string(),
                        learned_at: learned_at.clone(),
                        source: ProjectMemorySource::Auto,
                    },
                );
            }
        }

        if let Some(create_backup) = action.args.get("createBackup").and_then(Value::as_bool) {
            upsert_project_memory_entry(
                &mut entries,
                ProjectMemoryEntry {
                    key: "create_backup_on_replace".to_string(),
                    value: create_backup.to_string(),
                    learned_at: learned_at.clone(),
                    source: ProjectMemorySource::Auto,
                },
            );
        }

        if let Some(overwrite) = action.args.get("overwrite").and_then(Value::as_bool) {
            upsert_project_memory_entry(
                &mut entries,
                ProjectMemoryEntry {
                    key: "overwrite_existing_files".to_string(),
                    value: overwrite.to_string(),
                    learned_at: learned_at.clone(),
                    source: ProjectMemorySource::Auto,
                },
            );
        }
    }

    let natural_language_context = collect_natural_language_learning_context(response);
    infer_auto_project_memory_entries_from_text(
        &natural_language_context,
        root_folder,
        &learned_at,
        &mut entries,
    );

    entries
}

fn collect_natural_language_learning_context(response: &CopilotTurnResponse) -> String {
    let mut lines = vec![response.summary.clone()];

    if let Some(message) = response.message.as_ref() {
        lines.push(message.clone());
    }
    lines.extend(response.warnings.iter().cloned());
    lines.extend(response.follow_up_questions.iter().cloned());

    lines.join("\n")
}

fn infer_auto_project_memory_entries_from_text(
    text: &str,
    root_folder: &str,
    learned_at: &str,
    entries: &mut Vec<ProjectMemoryEntry>,
) {
    let normalized_text = text.trim();
    if normalized_text.is_empty() {
        return;
    }

    for path_candidate in extract_path_candidates(normalized_text) {
        if !is_within_project_scope(&path_candidate, root_folder) {
            continue;
        }

        if let Some(parent) = Path::new(&path_candidate)
            .parent()
            .and_then(|value| value.to_str())
        {
            upsert_project_memory_entry(
                entries,
                ProjectMemoryEntry {
                    key: "preferred_output_folder".to_string(),
                    value: parent.to_string(),
                    learned_at: learned_at.to_string(),
                    source: ProjectMemorySource::Auto,
                },
            );
        }

        if let Some(extension) = Path::new(&path_candidate)
            .extension()
            .and_then(|value| value.to_str())
        {
            let normalized_extension = extension.trim().to_lowercase();
            if matches!(
                normalized_extension.as_str(),
                "csv" | "xlsx" | "xlsm" | "xlsb"
            ) {
                upsert_project_memory_entry(
                    entries,
                    ProjectMemoryEntry {
                        key: "preferred_output_format".to_string(),
                        value: normalized_extension,
                        learned_at: learned_at.to_string(),
                        source: ProjectMemorySource::Auto,
                    },
                );
            }
        }
    }

    let lowered = normalized_text.to_lowercase();
    if let Some(output_sheet) =
        extract_marker_value(normalized_text, &["output sheet", "出力シート"])
    {
        upsert_project_memory_entry(
            entries,
            ProjectMemoryEntry {
                key: "preferred_output_sheet".to_string(),
                value: output_sheet,
                learned_at: learned_at.to_string(),
                source: ProjectMemorySource::Auto,
            },
        );
    }

    if let Some(create_backup) = infer_boolean_preference(
        &lowered,
        &["without backup", "no backup", "バックアップなし"],
        &["backup", "バックアップ"],
    ) {
        upsert_project_memory_entry(
            entries,
            ProjectMemoryEntry {
                key: "create_backup_on_replace".to_string(),
                value: create_backup.to_string(),
                learned_at: learned_at.to_string(),
                source: ProjectMemorySource::Auto,
            },
        );
    }

    if let Some(overwrite) = infer_boolean_preference(
        &lowered,
        &[
            "do not overwrite",
            "don't overwrite",
            "no overwrite",
            "上書きしない",
            "上書きなし",
        ],
        &["overwrite", "上書き"],
    ) {
        upsert_project_memory_entry(
            entries,
            ProjectMemoryEntry {
                key: "overwrite_existing_files".to_string(),
                value: overwrite.to_string(),
                learned_at: learned_at.to_string(),
                source: ProjectMemorySource::Auto,
            },
        );
    }

    if !entries
        .iter()
        .any(|entry| entry.key == "preferred_output_format")
    {
        for format in ["csv", "xlsx", "xlsm", "xlsb"] {
            if lowered.contains(format) {
                upsert_project_memory_entry(
                    entries,
                    ProjectMemoryEntry {
                        key: "preferred_output_format".to_string(),
                        value: format.to_string(),
                        learned_at: learned_at.to_string(),
                        source: ProjectMemorySource::Auto,
                    },
                );
                break;
            }
        }
    }
}

fn extract_path_candidates(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|segment| {
            segment
                .trim_matches(|character: char| {
                    matches!(
                        character,
                        '`' | '"' | '\'' | ',' | '.' | ';' | ':' | '(' | ')' | '[' | ']'
                    )
                })
                .to_string()
        })
        .filter(|segment| {
            segment.starts_with('/')
                || (segment.len() > 2
                    && segment.as_bytes()[1] == b':'
                    && segment
                        .chars()
                        .next()
                        .map(|character| character.is_ascii_alphabetic())
                        .unwrap_or(false))
        })
        .collect()
}

fn extract_marker_value(text: &str, markers: &[&str]) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        let lowered = trimmed.to_lowercase();
        for marker in markers {
            let marker_lower = marker.to_lowercase();
            if let Some(index) = lowered.find(&marker_lower) {
                let remainder = trimmed[index + marker_lower.len()..]
                    .trim_start_matches([' ', ':', '-', '='])
                    .trim();
                let candidate = remainder
                    .split([' ', ',', ';'])
                    .next()
                    .unwrap_or_default()
                    .trim_matches(['`', '"', '\'']);
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    None
}

fn infer_boolean_preference(
    lowered_text: &str,
    negative_markers: &[&str],
    positive_markers: &[&str],
) -> Option<bool> {
    if negative_markers
        .iter()
        .any(|marker| lowered_text.contains(marker))
    {
        return Some(false);
    }
    if positive_markers
        .iter()
        .any(|marker| lowered_text.contains(marker))
    {
        return Some(true);
    }

    None
}

fn extract_auto_learning_output_path(action: &SpreadsheetAction) -> Option<&str> {
    match action.tool.as_str() {
        "file.copy" | "file.move" => action.args.get("destPath").and_then(Value::as_str),
        _ => None,
    }
}

fn upsert_project_memory_entry(entries: &mut Vec<ProjectMemoryEntry>, entry: ProjectMemoryEntry) {
    entries.retain(|existing| existing.key != entry.key);
    entries.push(entry);
    entries.sort_by(|left, right| left.key.to_lowercase().cmp(&right.key.to_lowercase()));
}

pub(crate) fn is_within_project_scope(file_path: &str, root_folder: &str) -> bool {
    let normalized_file = normalize_scope_path(file_path);
    let normalized_root = normalize_scope_path(root_folder);
    normalized_file == normalized_root
        || normalized_file.starts_with(&format!("{normalized_root}/"))
}

fn normalize_scope_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_lowercase()
}

fn latest_assistant_text(messages: &[claw_core::Message]) -> Option<String> {
    messages.iter().rev().find_map(|message| {
        if !matches!(message.role, Role::Assistant) {
            return None;
        }

        let text = message
            .content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<String>();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
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
    let status = optional_string(
        root.get("status"),
        vec![json!("status")],
        &mut validation_issues,
    )
    .map(|value| parse_agent_loop_status(&value, &mut validation_issues))
    .unwrap_or(AgentLoopStatus::ReadyToWrite);
    let summary = match required_string(
        root.get("summary"),
        vec![json!("summary")],
        &mut validation_issues,
    ) {
        Some(summary) => summary,
        None => String::new(),
    };
    let message = optional_string(
        root.get("message"),
        vec![json!("message")],
        &mut validation_issues,
    );
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
                status,
                summary,
                actions,
                execution_plan: None,
                message,
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
        "file.list" => {
            require_arg_string(args_object, index, "path", validation_issues);
            if let Some(pattern) = args_object.get("pattern") {
                validate_non_empty_string(
                    pattern,
                    path(index, "args", "pattern"),
                    validation_issues,
                );
            }
        }
        "file.read_text" => {
            require_arg_string(args_object, index, "path", validation_issues);
            validate_optional_positive_integer(
                args_object.get("maxBytes"),
                index,
                "maxBytes",
                validation_issues,
            );
        }
        "file.stat" => {
            require_arg_string(args_object, index, "path", validation_issues);
        }
        "file.copy" | "file.move" => {
            require_arg_string(args_object, index, "sourcePath", validation_issues);
            require_arg_string(args_object, index, "destPath", validation_issues);
        }
        "file.delete" => {
            require_arg_string(args_object, index, "path", validation_issues);
        }
        "text.search" => {
            require_arg_string(args_object, index, "path", validation_issues);
            require_arg_string(args_object, index, "pattern", validation_issues);
            validate_optional_positive_integer(
                args_object.get("maxMatches"),
                index,
                "maxMatches",
                validation_issues,
            );
            if let Some(context_lines) = args_object.get("contextLines") {
                validate_nonnegative_integer(
                    context_lines,
                    path(index, "args", "contextLines"),
                    validation_issues,
                );
            }
        }
        "text.replace" => {
            require_arg_string(args_object, index, "path", validation_issues);
            require_arg_string(args_object, index, "pattern", validation_issues);
            if let Some(replacement) = args_object.get("replacement") {
                if !replacement.is_string() {
                    validation_issues.push(issue(
                        path(index, "args", "replacement"),
                        "replacement must be a string.".to_string(),
                        "invalid_replacement",
                    ));
                }
            } else {
                validation_issues.push(issue(
                    path(index, "args", "replacement"),
                    "replacement is required.".to_string(),
                    "missing_replacement",
                ));
            }
        }
        _ => {}
    }
}

fn required_action_arg_string(action: &SpreadsheetAction, key: &str) -> Result<String, String> {
    action
        .args
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{} requires a non-empty `{key}` argument", action.tool))
}

fn validate_nonnegative_integer(
    value: &Value,
    path: Vec<Value>,
    validation_issues: &mut Vec<ValidationIssue>,
) {
    match value.as_i64() {
        Some(number) if number >= 0 => {}
        _ => validation_issues.push(issue(
            path,
            "Expected a non-negative integer.".to_string(),
            "invalid_integer",
        )),
    }
}

fn baseline_diff_summary(session: &Session) -> DiffSummary {
    let source_path = session.primary_workbook_path.clone().unwrap_or_default();

    DiffSummary {
        source_path: source_path.clone(),
        output_path: source_path,
        mode: "preview".to_string(),
        target_count: 0,
        estimated_affected_rows: 0,
        sheets: Vec::new(),
        warnings: Vec::new(),
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

fn parse_agent_loop_status(
    value: &str,
    validation_issues: &mut Vec<ValidationIssue>,
) -> AgentLoopStatus {
    match value {
        "thinking" => AgentLoopStatus::Thinking,
        "ready_to_write" => AgentLoopStatus::ReadyToWrite,
        "done" => AgentLoopStatus::Done,
        "error" => AgentLoopStatus::Error,
        "plan_proposed" => AgentLoopStatus::PlanProposed,
        _ => {
            validation_issues.push(issue(
                vec![json!("status")],
                format!(
                    "status must be one of thinking, ready_to_write, done, error, plan_proposed. Received `{value}`."
                ),
                "invalid_status",
            ));
            AgentLoopStatus::ReadyToWrite
        }
    }
}

fn is_write_action(action: &SpreadsheetAction) -> bool {
    is_file_write_action(action)
}

fn is_file_write_action(action: &SpreadsheetAction) -> bool {
    matches!(
        action.tool.as_str(),
        "file.copy" | "file.move" | "file.delete" | "text.replace"
    )
}

fn is_known_tool(tool: &str) -> bool {
    matches!(
        tool,
        "file.list"
            | "file.read_text"
            | "file.stat"
            | "text.search"
            | "text.replace"
            | "file.copy"
            | "file.move"
            | "file.delete"
    )
}

fn tool_requires_sheet(tool: &str) -> bool {
    let _ = tool;
    false
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

fn require_existing_directory(field: &str, value: String) -> Result<String, String> {
    let trimmed = require_text(field, value)?;
    let path = Path::new(&trimmed);

    if !path.exists() {
        return Err(format!(
            "{field} `{trimmed}` must point to an existing directory"
        ));
    }

    if !path.is_dir() {
        return Err(format!("{field} `{trimmed}` must point to a directory"));
    }

    Ok(trimmed)
}

fn require_existing_file(field: &str, value: String) -> Result<String, String> {
    let trimmed = require_text(field, value)?;
    let path = Path::new(&trimmed);

    if !path.exists() {
        return Err(format!(
            "{field} `{trimmed}` must point to an existing file"
        ));
    }

    if !path.is_file() {
        return Err(format!("{field} `{trimmed}` must point to a file"));
    }

    Ok(trimmed)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, env, fs, path::Path};

    use super::AppStorage;
    use crate::models::{
        AddInboxFileRequest, AddProjectMemoryRequest, AgentLoopStatus, ApprovalDecision,
        CopilotTurnResponse, CreateProjectRequest, CreateSessionRequest,
        LinkSessionToProjectRequest, PreviewExecutionRequest, ProjectMemorySource,
        ReadProjectRequest, ReadSessionRequest, RecordScopeApprovalRequest,
        RecordStructuredResponseRequest, RelayMode, RespondToApprovalRequest, RunExecutionRequest,
        ScopeApprovalSource, SetSessionProjectRequest, SpreadsheetAction, StartTurnRequest,
        TurnArtifactRecord, TurnStatus, UpdateProjectRequest,
    };
    use crate::persistence;
    use serde::{de::DeserializeOwned, Deserialize};
    use serde_json::{json, Value};
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
        let source_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = env::temp_dir()
            .join(format!("relay-agent-run-output-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "File copy".to_string(),
                objective: "Prepare a safe file copy plan".to_string(),
                primary_workbook_path: Some(source_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Draft the copy".to_string(),
                objective: "Plan a reviewed file copy".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let submitted = record_copilot_response(
            &mut storage,
            &session.id,
            &turn.id,
            copilot_response(
                "Create a reviewed output copy.",
                vec![json!({
                    "tool": "file.copy",
                    "args": {
                        "sourcePath": source_path.to_string_lossy(),
                        "destPath": output_path.clone(),
                        "overwrite": true
                    }
                })],
            ),
        );
        assert_eq!(submitted.turn.status, TurnStatus::Validated);

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
            "customer_id,amount\n1,42.5\n2,13.0\n"
        );
        assert_eq!(
            fs::read_to_string(&source_path).expect("source CSV should remain unchanged"),
            "customer_id,amount\n1,42.5\n2,13.0\n"
        );

        fs::remove_file(output_path).expect("executed CSV output should clean up");
        fs::remove_file(source_path).expect("test csv should clean up");
    }

    #[test]
    fn preview_execution_uses_latest_structured_response_from_session_history() {
        let source_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-storage-history-preview-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "History-backed preview".to_string(),
                objective: "Preview should read the latest structured response from history."
                    .to_string(),
                primary_workbook_path: Some(source_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Preview from agent history".to_string(),
                objective: "Use the latest assistant JSON without a manual response submission."
                    .to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        storage
            .sync_session_messages(
                &session.id,
                vec![
                    claw_core::Message::user("Preview the reviewed output."),
                    claw_core::Message::assistant_text(copilot_response(
                        "Copy the reviewed output into a new file.",
                        vec![json!({
                            "tool": "file.copy",
                            "args": {
                                "sourcePath": source_path.to_string_lossy(),
                                "destPath": output_path.clone(),
                                "overwrite": true
                            }
                        })],
                    )),
                ],
            )
            .expect("session history should sync");

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("preview should succeed from session history");

        assert!(preview.ready);
        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 1);
        assert!(preview.diff_summary.sheets.is_empty());

        fs::remove_file(source_path).expect("test csv should clean up");
    }

    #[test]
    fn record_structured_response_enables_preview_without_submit_flow() {
        let source_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-structured-response-preview-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Structured response".to_string(),
                objective: "Record a structured response directly.".to_string(),
                primary_workbook_path: Some(source_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Preview from direct response".to_string(),
                objective: "Use record_structured_response.".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let recorded = storage
            .record_structured_response(RecordStructuredResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: None,
                parsed_response: CopilotTurnResponse {
                    version: "1.0".to_string(),
                    status: AgentLoopStatus::ReadyToWrite,
                    summary: "Copy the reviewed output.".to_string(),
                    actions: vec![SpreadsheetAction {
                        id: None,
                        tool: "file.copy".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({
                            "sourcePath": source_path.to_string_lossy(),
                            "destPath": output_path.clone(),
                            "overwrite": true
                        }),
                    }],
                    execution_plan: None,
                    message: None,
                    follow_up_questions: Vec::new(),
                    warnings: Vec::new(),
                },
            })
            .expect("structured response should record");
        assert_eq!(recorded.turn.status, TurnStatus::Validated);

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("preview should succeed");
        assert!(preview.ready);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 1);

        fs::remove_file(source_path).expect("test csv should clean up");
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

        let invalid_raw_response = r#"{
                  "summary": "",
                  "actions": [{ "tool": "file.copy", "args": {} }]
                }"#
        .to_string();
        let invalid_error = storage
            .record_structured_response(RecordStructuredResponseRequest {
                session_id: session.id,
                turn_id: turn.id,
                raw_response: Some(invalid_raw_response),
                parsed_response: CopilotTurnResponse {
                    version: "1.0".to_string(),
                    status: AgentLoopStatus::ReadyToWrite,
                    summary: "invalid".to_string(),
                    actions: vec![SpreadsheetAction {
                        id: None,
                        tool: "file.copy".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({}),
                    }],
                    execution_plan: None,
                    message: None,
                    follow_up_questions: Vec::new(),
                    warnings: Vec::new(),
                },
            })
            .expect_err("invalid raw response should fail validation");

        assert!(invalid_error.contains("structured response failed backend validation"));
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
            storage
                .sync_session_messages(
                    &session.id,
                    vec![
                        claw_core::Message::user("Persist relay history"),
                        claw_core::Message::assistant_text("History saved"),
                    ],
                )
                .expect("session history should sync");

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
            assert!(storage_root
                .join("sessions")
                .join(&session.id)
                .join("history.json")
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
        let history = reloaded
            .read_session_messages(&session_id)
            .expect("persisted session history should be readable");
        assert_eq!(history.len(), 2);
        assert!(matches!(
            history[1].content.first(),
            Some(claw_core::ContentBlock::Text { text }) if text == "History saved"
        ));

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
    }

    #[test]
    fn persists_scope_override_approval_as_a_turn_artifact() {
        let app_local_data_dir = unique_test_app_data_dir();

        let (session_id, turn_id) = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Scope approval".to_string(),
                    objective: "Persist scope override decisions".to_string(),
                    primary_workbook_path: Some("/tmp/source.csv".to_string()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Record scope override".to_string(),
                    objective: "Keep the scope override as an auditable artifact.".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start")
                .turn;
            record_copilot_response(
                &mut storage,
                &session.id,
                &turn.id,
                copilot_response(
                    "Write a reviewed copy outside the default project root.",
                    vec![json!({
                        "tool": "file.copy",
                        "args": {
                            "sourcePath": "/tmp/source.csv",
                            "destPath": "/tmp/outside-reviewed-copy.csv",
                            "overwrite": true
                        }
                    })],
                ),
            );
            storage
                .record_scope_approval(RecordScopeApprovalRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    decision: ApprovalDecision::Approved,
                    root_folder: "/workspace/projects/revenue".to_string(),
                    violations: vec!["/tmp/outside-reviewed-copy.csv".to_string()],
                    source: ScopeApprovalSource::Manual,
                    note: Some("Allow the export path for this turn.".to_string()),
                })
                .expect("scope approval should be recorded");

            (session.id, turn.id)
        };

        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let artifact_response = reloaded
            .read_turn_artifacts(&session_id, &turn_id)
            .expect("turn artifacts should be readable");

        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::ScopeApproval { .. })));
        assert!(artifact_response.turn_details.approval.available);
        assert_eq!(
            artifact_response
                .turn_details
                .approval
                .payload
                .as_ref()
                .and_then(|payload| payload.scope_override.as_ref())
                .map(|scope| scope.decision),
            Some(ApprovalDecision::Approved)
        );
        assert_eq!(
            artifact_response
                .turn_details
                .approval
                .payload
                .as_ref()
                .and_then(|payload| payload.scope_override.as_ref())
                .map(|scope| scope.root_folder.as_str()),
            Some("/workspace/projects/revenue")
        );

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
    }

    #[test]
    fn persists_tool_settings_and_restores_mcp_tools_after_reload() {
        let app_local_data_dir = unique_test_app_data_dir();
        let script_path = write_stdio_mock_server();
        #[cfg(target_os = "windows")]
        let server_url = format!("node \"{}\"", script_path.display());
        #[cfg(not(target_os = "windows"))]
        let server_url = format!("node {}", script_path.display());

        {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let response = storage
                .register_mcp_tools(
                    crate::models::McpServerConfig {
                        url: server_url.clone(),
                        name: "demo".to_string(),
                        transport: crate::models::McpTransport::Stdio,
                    },
                    vec![crate::mcp_client::McpToolDefinition {
                        name: "echo".to_string(),
                        description: "Echo arguments".to_string(),
                        input_schema: json!({ "type": "object" }),
                    }],
                )
                .expect("mcp tool registration should persist");

            assert_eq!(
                response.registered_tool_ids,
                vec!["mcp.demo.echo".to_string()]
            );

            let updated = storage
                .set_tool_enabled(crate::models::SetToolEnabledRequest {
                    tool_id: "mcp.demo.echo".to_string(),
                    enabled: false,
                })
                .expect("tool toggle should persist");
            assert!(!updated.enabled);
        }

        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let tools = reloaded.list_tools().tools;
        let restored = tools
            .iter()
            .find(|tool| tool.id == "mcp.demo.echo")
            .expect("persisted mcp tool should be restored");
        assert!(!restored.enabled);
        assert_eq!(
            restored.mcp_server_url.as_deref(),
            Some(server_url.as_str())
        );
        assert_eq!(
            restored.mcp_transport,
            Some(crate::models::McpTransport::Stdio)
        );

        let storage_root = persistence::storage_root(&app_local_data_dir);
        let persisted_settings: crate::models::ToolSettings =
            read_json(&storage_root.join("tool-settings.json"))
                .expect("tool settings should be written");
        assert_eq!(
            persisted_settings.disabled_tool_ids,
            vec!["mcp.demo.echo".to_string()]
        );
        assert_eq!(persisted_settings.mcp_servers.len(), 1);
        assert_eq!(persisted_settings.mcp_servers[0].name, "demo");

        fs::remove_file(script_path).expect("mock stdio script should clean up");
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
                    objective: "Validate response, preview, approve, and run.".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should start")
                .turn;
            record_copilot_response(
                &mut storage,
                &session.id,
                &turn.id,
                copilot_response(
                    "Create a reviewed output copy.",
                    vec![json!({
                        "tool": "file.copy",
                        "args": {
                            "sourcePath": csv_path.to_string_lossy(),
                            "destPath": output_path.clone(),
                            "overwrite": true
                        }
                    })],
                ),
            );
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

        assert_eq!(turn.item_ids.len(), 5);
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
                "validation".to_string(),
            ])
        );
        assert_eq!(execution_output_path.as_deref(), Some(output_path.as_str()));

        let artifact_response = reloaded
            .read_turn_artifacts(&session_id, &turn_id)
            .expect("turn artifacts should be readable");
        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::Execution { .. })));
        let execution_artifact = artifact_response
            .artifacts
            .iter()
            .find_map(|artifact| match artifact {
                TurnArtifactRecord::Execution { payload, .. } => Some(payload),
                _ => None,
            })
            .expect("execution artifact payload should exist");
        assert!(execution_artifact.executed);
        assert_eq!(
            execution_artifact.output_path.as_deref(),
            Some(output_path.as_str())
        );
        assert!(!execution_artifact.artifacts.is_empty());

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
                "structured-response-recorded".to_string(),
                "execution-preview-created".to_string(),
                "execution-recorded".to_string(),
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
    fn preview_and_run_execution_support_text_replace_actions() {
        let workspace_dir =
            env::temp_dir().join(format!("relay-agent-write-tools-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_dir).expect("workspace dir should exist");
        let text_path = workspace_dir.join("draft.txt");
        fs::write(&text_path, "hello relay\nhello world\n").expect("text file should be written");
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Write tools".to_string(),
                objective: "Replace text after approval.".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Write turn".to_string(),
                objective: "Run regex replace".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        record_copilot_response(
            &mut storage,
            &session.id,
            &turn.id,
            json!({
                "version": "1.0",
                "status": "ready_to_write",
                "summary": "Replace hello with hi.",
                "actions": [
                    {
                        "tool": "text.replace",
                        "args": {
                            "path": text_path,
                            "pattern": "hello",
                            "replacement": "hi",
                            "createBackup": true
                        }
                    }
                ],
                "followUpQuestions": [],
                "warnings": []
            })
            .to_string(),
        );

        let preview = storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("preview should succeed");
        assert!(preview.requires_approval);
        assert_eq!(preview.file_write_actions.len(), 1);
        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);

        storage
            .respond_to_approval(RespondToApprovalRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                decision: ApprovalDecision::Approved,
                note: None,
            })
            .expect("approval should succeed");

        let execution = storage
            .run_execution(RunExecutionRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("execution should succeed");
        assert!(execution.executed);
        assert_eq!(
            execution.output_path,
            Some(text_path.to_string_lossy().into_owned())
        );
        assert_eq!(
            fs::read_to_string(&text_path).expect("updated file should be readable"),
            "hi relay\nhi world\n"
        );
        assert!(text_path.with_file_name("draft.txt.bak").exists());

        fs::remove_dir_all(workspace_dir).expect("workspace dir should clean up");
    }

    #[test]
    fn project_crud_and_memory_persist_across_reload() {
        let app_local_data_dir = unique_test_app_data_dir();
        let revenue_root = create_test_directory("revenue");
        let finance_root = create_test_directory("finance");
        let mut storage =
            AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

        let created = storage
            .create_project(CreateProjectRequest {
                name: "Revenue Ops".to_string(),
                root_folder: revenue_root.display().to_string(),
                custom_instructions: Some(
                    "Always keep outputs inside the revenue folder.".to_string(),
                ),
            })
            .expect("project should be created");
        assert_eq!(created.name, "Revenue Ops");

        let updated = storage
            .update_project(UpdateProjectRequest {
                project_id: created.id.clone(),
                name: None,
                custom_instructions: Some("Prefer sanitized CSV outputs.".to_string()),
            })
            .expect("project should update");
        assert_eq!(updated.custom_instructions, "Prefer sanitized CSV outputs.");

        let with_memory = storage
            .add_project_memory(AddProjectMemoryRequest {
                project_id: created.id.clone(),
                key: "preferred_output".to_string(),
                value: "CSV".to_string(),
                source: Some(ProjectMemorySource::User),
            })
            .expect("memory should be added");
        assert_eq!(with_memory.memory.len(), 1);

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Revenue cleanup".to_string(),
                objective: "Prepare a safe output".to_string(),
                primary_workbook_path: Some(revenue_root.join("input.csv").display().to_string()),
            })
            .expect("session should be created");
        let linked = storage
            .link_session_to_project(LinkSessionToProjectRequest {
                project_id: created.id.clone(),
                session_id: session.id.clone(),
            })
            .expect("session should be linked");
        assert_eq!(linked.session_ids, vec![session.id.clone()]);

        let second_project = storage
            .create_project(CreateProjectRequest {
                name: "Finance Ops".to_string(),
                root_folder: finance_root.display().to_string(),
                custom_instructions: None,
            })
            .expect("second project should be created");
        let reassigned = storage
            .set_session_project(SetSessionProjectRequest {
                session_id: session.id.clone(),
                project_id: Some(second_project.id.clone()),
            })
            .expect("session should be reassigned");
        let revenue_project = reassigned
            .projects
            .iter()
            .find(|project| project.id == created.id)
            .expect("revenue project should still exist");
        assert!(revenue_project.session_ids.is_empty());
        let finance_project = reassigned
            .projects
            .iter()
            .find(|project| project.id == second_project.id)
            .expect("finance project should exist");
        assert_eq!(finance_project.session_ids, vec![session.id.clone()]);

        let unassigned = storage
            .set_session_project(SetSessionProjectRequest {
                session_id: session.id.clone(),
                project_id: None,
            })
            .expect("session should be unassigned");
        assert!(unassigned.projects.iter().all(|project| !project
            .session_ids
            .iter()
            .any(|session_id| session_id == &session.id)));

        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let project = reloaded
            .read_project(ReadProjectRequest {
                project_id: created.id.clone(),
            })
            .expect("project should reload");
        assert_eq!(project.memory.len(), 1);
        assert_eq!(project.memory[0].key, "preferred_output");
        assert!(project.session_ids.is_empty());

        let list = reloaded.list_projects();
        assert_eq!(list.projects.len(), 2);

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_dir_all(revenue_root).expect("revenue root should clean up");
        fs::remove_dir_all(finance_root).expect("finance root should clean up");
    }

    #[test]
    fn inbox_files_sync_across_sessions_linked_to_same_project() {
        let revenue_root = create_test_directory("revenue-inbox");
        let shared_file = revenue_root.join("shared.csv");
        fs::write(&shared_file, "id,value\n1,ok\n").expect("shared inbox file should be written");

        let mut storage = AppStorage::default();
        let project = storage
            .create_project(CreateProjectRequest {
                name: "Revenue Ops".to_string(),
                root_folder: revenue_root.display().to_string(),
                custom_instructions: None,
            })
            .expect("project should be created");
        let first_session = storage
            .create_session(CreateSessionRequest {
                title: "First".to_string(),
                objective: "Inspect file".to_string(),
                primary_workbook_path: Some(shared_file.display().to_string()),
            })
            .expect("first session should be created");
        let second_session = storage
            .create_session(CreateSessionRequest {
                title: "Second".to_string(),
                objective: "Reuse inbox".to_string(),
                primary_workbook_path: Some(shared_file.display().to_string()),
            })
            .expect("second session should be created");

        storage
            .link_session_to_project(LinkSessionToProjectRequest {
                project_id: project.id.clone(),
                session_id: first_session.id.clone(),
            })
            .expect("first session should link");
        storage
            .link_session_to_project(LinkSessionToProjectRequest {
                project_id: project.id.clone(),
                session_id: second_session.id.clone(),
            })
            .expect("second session should link");

        let updated = storage
            .add_inbox_file(AddInboxFileRequest {
                session_id: first_session.id.clone(),
                path: shared_file.display().to_string(),
            })
            .expect("shared inbox file should be added");
        assert_eq!(updated.inbox_files.len(), 1);

        let reloaded_second = storage
            .read_session(&second_session.id)
            .expect("second session should be readable");
        assert_eq!(reloaded_second.session.inbox_files.len(), 1);
        assert_eq!(
            reloaded_second.session.inbox_files[0].path,
            shared_file.display().to_string()
        );

        fs::remove_dir_all(revenue_root).expect("revenue inbox root should clean up");
    }

    #[test]
    fn create_project_requires_existing_root_folder() {
        let mut storage = AppStorage::default();
        let missing_root =
            env::temp_dir().join(format!("relay-agent-missing-root-{}", Uuid::new_v4()));

        let error = storage
            .create_project(CreateProjectRequest {
                name: "Missing Root".to_string(),
                root_folder: missing_root.display().to_string(),
                custom_instructions: None,
            })
            .expect_err("missing root folder should be rejected");

        assert!(error.contains("must point to an existing directory"));
    }

    #[test]
    fn accepted_response_auto_learns_project_preferences() {
        let mut storage = AppStorage::default();
        let revenue_root = create_test_directory("revenue");
        let project = storage
            .create_project(CreateProjectRequest {
                name: "Revenue Ops".to_string(),
                root_folder: revenue_root.display().to_string(),
                custom_instructions: None,
            })
            .expect("project should be created");
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Revenue cleanup".to_string(),
                objective: "Prepare a safe output".to_string(),
                primary_workbook_path: Some(revenue_root.join("input.csv").display().to_string()),
            })
            .expect("session should be created");
        storage
            .link_session_to_project(LinkSessionToProjectRequest {
                project_id: project.id.clone(),
                session_id: session.id.clone(),
            })
            .expect("session should be linked");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Draft response".to_string(),
                objective: "Preview the output".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;
        let response = record_copilot_response(
            &mut storage,
            &session.id,
            &turn.id,
            copilot_response(
                "Prepare a save-copy output.",
                vec![
                    json!({
                        "tool": "text.replace",
                        "args": {
                            "path": revenue_root.join("exports/notes.txt").display().to_string(),
                            "pattern": "draft",
                            "replacement": "approved",
                            "createBackup": true
                        }
                    }),
                    json!({
                        "tool": "file.copy",
                        "args": {
                            "sourcePath": revenue_root.join("source.csv").display().to_string(),
                            "destPath": revenue_root.join("exports/revenue.cleaned.csv").display().to_string(),
                            "overwrite": true
                        }
                    }),
                ],
            ),
        );

        assert_eq!(response.turn.status, TurnStatus::Validated);
        assert_eq!(response.auto_learned_memory.len(), 4);
        assert_eq!(
            response.auto_learned_memory[0].source,
            ProjectMemorySource::Auto
        );
        assert_eq!(
            response.auto_learned_memory[0].key,
            "create_backup_on_replace"
        );
        assert_eq!(response.auto_learned_memory[0].value, "true");
        assert_eq!(
            response.auto_learned_memory[1].key,
            "overwrite_existing_files"
        );
        assert_eq!(response.auto_learned_memory[1].value, "true");
        assert_eq!(
            response.auto_learned_memory[2].key,
            "preferred_output_folder"
        );
        assert_eq!(
            response.auto_learned_memory[2].value,
            revenue_root.join("exports").display().to_string()
        );
        assert_eq!(
            response.auto_learned_memory[3].key,
            "preferred_output_format"
        );
        assert_eq!(response.auto_learned_memory[3].value, "csv");

        let project = storage
            .read_project(ReadProjectRequest {
                project_id: project.id,
            })
            .expect("project should be readable");
        assert_eq!(project.memory.len(), 4);
        assert!(project
            .memory
            .iter()
            .all(|entry| entry.source == ProjectMemorySource::Auto));

        fs::remove_dir_all(revenue_root).expect("revenue root should clean up");
    }

    #[test]
    fn accepted_response_auto_learns_from_free_form_text() {
        let mut storage = AppStorage::default();
        let revenue_root = create_test_directory("revenue");
        let project = storage
            .create_project(CreateProjectRequest {
                name: "Revenue Ops".to_string(),
                root_folder: revenue_root.display().to_string(),
                custom_instructions: None,
            })
            .expect("project should be created");
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Revenue cleanup".to_string(),
                objective: "Prepare a safe output".to_string(),
                primary_workbook_path: Some(revenue_root.join("input.csv").display().to_string()),
            })
            .expect("session should be created");
        storage
            .link_session_to_project(LinkSessionToProjectRequest {
                project_id: project.id.clone(),
                session_id: session.id.clone(),
            })
            .expect("session should be linked");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Draft response".to_string(),
                objective: "Preview the output".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;
        let response = record_copilot_response(
            &mut storage,
            &session.id,
            &turn.id,
            json!({
                "version": "1.0",
                "status": "ready_to_write",
                "summary": format!(
                    "Save a CSV copy to {} and overwrite existing files.",
                    revenue_root.join("exports/natural.cleaned.csv").display()
                ),
                "message": "Use output sheet: NaturalRows and create a backup.",
                "actions": [],
                "warnings": ["Keep a backup before replacing the original notes."],
                "followUpQuestions": []
            })
            .to_string(),
        );

        assert_eq!(response.auto_learned_memory.len(), 5);
        assert_eq!(
            response.auto_learned_memory[0].key,
            "create_backup_on_replace"
        );
        assert_eq!(response.auto_learned_memory[0].value, "true");
        assert_eq!(
            response.auto_learned_memory[1].key,
            "overwrite_existing_files"
        );
        assert_eq!(response.auto_learned_memory[1].value, "true");
        assert_eq!(
            response.auto_learned_memory[2].key,
            "preferred_output_folder"
        );
        assert_eq!(
            response.auto_learned_memory[2].value,
            revenue_root.join("exports").display().to_string()
        );
        assert_eq!(
            response.auto_learned_memory[3].key,
            "preferred_output_format"
        );
        assert_eq!(response.auto_learned_memory[3].value, "csv");
        assert_eq!(
            response.auto_learned_memory[4].key,
            "preferred_output_sheet"
        );
        assert_eq!(response.auto_learned_memory[4].value, "NaturalRows");

        fs::remove_dir_all(revenue_root).expect("revenue root should clean up");
    }

    fn unique_test_app_data_dir() -> std::path::PathBuf {
        env::temp_dir().join(format!("relay-agent-storage-test-{}", Uuid::new_v4()))
    }

    fn create_test_directory(prefix: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    fn write_test_csv(contents: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-storage-test-{}.csv", Uuid::new_v4()));
        fs::write(&path, contents).expect("test csv should be written");
        path
    }

    fn write_stdio_mock_server() -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-mcp-{}.cjs", Uuid::new_v4()));
        fs::write(
            &path,
            r#"const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line.trim());
  let result = null;
  if (request.method === "tools/list") {
    result = {
      tools: [{ name: "echo", description: "Echo arguments", inputSchema: { type: "object" } }]
    };
  } else if (request.method === "tools/call") {
    result = { ok: true, arguments: request.params.arguments };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result }) + "\n");
});"#,
        )
        .expect("mock stdio server should be written");
        path
    }

    fn copilot_response(summary: &str, actions: Vec<Value>) -> String {
        json!({
            "version": "1.0",
            "status": "ready_to_write",
            "summary": summary,
            "actions": actions,
            "followUpQuestions": [],
            "warnings": []
        })
        .to_string()
    }

    fn record_copilot_response(
        storage: &mut AppStorage,
        session_id: &str,
        turn_id: &str,
        raw_response: String,
    ) -> crate::models::RecordStructuredResponseResponse {
        let parsed_response = serde_json::from_str::<CopilotTurnResponse>(&raw_response)
            .expect("test response should deserialize");
        storage
            .record_structured_response(RecordStructuredResponseRequest {
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                raw_response: Some(raw_response),
                parsed_response,
            })
            .expect("structured response should record")
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
