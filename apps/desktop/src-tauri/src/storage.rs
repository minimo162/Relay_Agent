use std::{
    collections::{BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::approval_store::{StoredApproval, StoredScopeApproval};
use crate::file_support;
use crate::mcp_client::McpClient;
use crate::models::{
    AddProjectMemoryRequest, AgentLoopStatus, ApprovalDecision, ApprovalInspectionPayload,
    ApprovePlanRequest, ApprovePlanResponse, ArtifactType, AssessCopilotHandoffRequest,
    AssessCopilotHandoffResponse, CopilotHandoffReason, CopilotHandoffReasonSource,
    CopilotHandoffStatus, CopilotTurnResponse, CreateProjectRequest, CreateSessionRequest,
    DiffSummary, ExecuteReadActionsRequest, ExecuteReadActionsResponse, ExecutionArtifactPayload,
    ExecutionInspectionPayload, ExecutionInspectionState, ExecutionPlan,
    GenerateRelayPacketRequest, LinkSessionToProjectRequest, ListProjectsResponse, OutputArtifact,
    OutputFormat, OutputSpec, PacketInspectionPayload, PlanProgressRequest, PlanProgressResponse,
    PlanStepState, PlanStepStatus, PlanningContext, PlanningContextToolGroups,
    PreviewArtifactPayload, PreviewExecutionRequest, PreviewExecutionResponse, Project,
    ProjectMemoryEntry, ProjectMemorySource, ReadProjectRequest, ReadTurnArtifactsResponse,
    RecordPlanProgressRequest, RecordScopeApprovalRequest, RecordScopeApprovalResponse,
    RelayPacket, RelayPacketResponseContract, RemoveProjectMemoryRequest, RespondToApprovalRequest,
    RespondToApprovalResponse, RunExecutionMultiRequest, RunExecutionRequest, RunExecutionResponse,
    ScopeApprovalArtifactPayload, ScopeApprovalSource, ScopeOverrideInspectionRecord, Session,
    SessionDetail, SetSessionProjectRequest, SpreadsheetAction, StartTurnRequest, StartTurnResponse,
    SubmitCopilotResponseRequest, SubmitCopilotResponseResponse, ToolDescriptor,
    ToolExecutionResult, ToolPhase, ToolSettings, Turn, TurnArtifactRecord, TurnDetailsViewModel,
    TurnInspectionSection, TurnInspectionSourceType, TurnInspectionUnavailableReason, TurnOverview,
    TurnOverviewStep, TurnOverviewStepState, TurnStatus, UpdateProjectRequest,
    ValidationInspectionPayload, ValidationIssue, ValidationIssueSummary,
};
use crate::persistence::{self, PersistedArtifactMeta, StorageManifest};
use crate::read_action_executor;
use crate::risk_evaluator::{evaluate_risk, should_auto_approve, ApprovalPolicy, OperationRisk};
use crate::session_store::SessionStore;
use crate::tool_catalog::ToolCatalog;
use crate::workbook::{SheetColumnProfile, SheetPreview, WorkbookEngine, WorkbookSource};
use crate::workbook_state::{StoredExecution, StoredPlanProgress, StoredPreview};

#[derive(Clone, Debug)]
struct StoredRelayPacket {
    packet: RelayPacket,
    created_at: String,
    artifact_id: String,
}

#[derive(Clone, Debug)]
struct StoredResponse {
    parsed_response: Option<CopilotTurnResponse>,
    validation_issues: Vec<ValidationIssue>,
    repair_prompt: Option<String>,
    created_at: String,
    artifact_id: String,
}

#[derive(Clone, Debug)]
struct ReadToolArtifact {
    artifact_type: &'static str,
    payload: Value,
    event_type: &'static str,
    message: String,
    warning: String,
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
struct RelayPacketResponseContractArtifactPayload {
    notes: Vec<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayPacketArtifactPayload {
    mode: crate::models::RelayMode,
    objective: String,
    context: Vec<String>,
    allowed_read_tools: Vec<ToolDescriptor>,
    allowed_write_tools: Vec<ToolDescriptor>,
    response_contract: RelayPacketResponseContractArtifactPayload,
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

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionPlanArtifactPayload {
    plan: ExecutionPlan,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanProgressArtifactPayload {
    current_step_id: Option<String>,
    completed_count: u32,
    total_count: u32,
    step_statuses: Vec<PlanStepStatus>,
}

#[derive(Clone, Debug)]
struct PersistedLifecycleArtifact<T> {
    artifact_id: String,
    created_at: String,
    payload: T,
}

#[derive(Clone, Debug, Default)]
struct PersistedTurnLifecycleArtifacts {
    packet: Option<PersistedLifecycleArtifact<RelayPacketArtifactPayload>>,
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
    relay_packets: HashMap<String, StoredRelayPacket>,
    responses: HashMap<String, StoredResponse>,
    previews: HashMap<String, StoredPreview>,
    approvals: HashMap<String, StoredApproval>,
    scope_approvals: HashMap<String, StoredScopeApproval>,
    executions: HashMap<String, StoredExecution>,
    plan_progress: HashMap<String, StoredPlanProgress>,
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
            relay_packets: HashMap::new(),
            responses: HashMap::new(),
            previews: HashMap::new(),
            approvals: HashMap::new(),
            scope_approvals: HashMap::new(),
            executions: HashMap::new(),
            plan_progress: HashMap::new(),
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
            "relay-packet" => {
                let payload: RelayPacketArtifactPayload =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                self.packet = Some(PersistedLifecycleArtifact {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                });
            }
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
        }

        if changed {
            self.persist_projects_state()?;
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
        self.session_store.sync_session_messages(session_id, messages)?;
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

    pub(crate) fn read_latest_turn_model(&self, session_id: &str) -> Result<Turn, String> {
        self.session_store.read_latest_turn_model(session_id)
    }

    pub(crate) fn resolve_workbook_source_for_session(
        &self,
        session_id: &str,
        source_path: Option<&str>,
    ) -> Result<WorkbookSource, String> {
        let session = self.read_session_model(session_id)?;
        self.resolve_workbook_source(&session, source_path)
    }

    pub(crate) fn session_diff_from_base_for_session(
        &self,
        session_id: &str,
        artifact_id: Option<&str>,
    ) -> Result<DiffSummary, String> {
        let session = self.read_session_model(session_id)?;
        let turn = self.read_latest_turn_model(session_id)?;
        self.session_diff_from_base(
            &session,
            &turn,
            artifact_id,
            &DiffSummary {
                source_path: session.primary_workbook_path.clone().unwrap_or_default(),
                output_path: String::new(),
                mode: "preview".to_string(),
                target_count: 0,
                estimated_affected_rows: 0,
                sheets: Vec::new(),
                warnings: Vec::new(),
            },
        )
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
            allowed_read_tools: self
                .tool_catalog
                .list_descriptors_by_phase(ToolPhase::Read),
            allowed_write_tools: self
                .tool_catalog
                .list_descriptors_by_phase(ToolPhase::Write),
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

        let packet_artifact =
            self.record_turn_artifact(&session.id, &turn.id, "relay-packet", &packet, None)?;
        self.relay_packets.insert(
            turn.id.clone(),
            StoredRelayPacket {
                packet: packet.clone(),
                created_at: packet_artifact.created_at.clone(),
                artifact_id: packet_artifact.id.clone(),
            },
        );
        self.update_turn_status(&turn.id, TurnStatus::PacketReady, 0)?;
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&packet_artifact.id),
            "relay-packet-generated",
            "Relay packet generated for the current turn.".to_string(),
            Some(json!({
                "mode": turn.mode,
                "contextCount": packet.context.len(),
            })),
        )?;

        Ok(packet)
    }

    pub fn assess_copilot_handoff(
        &self,
        request: AssessCopilotHandoffRequest,
    ) -> Result<AssessCopilotHandoffResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let mut reasons = Vec::new();

        if let Some(path) = session.primary_workbook_path.as_deref() {
            collect_sensitivity_reasons(
                path,
                CopilotHandoffReasonSource::Path,
                Some(path),
                &mut reasons,
            );

            if let Ok(source) = WorkbookSource::detect(path.to_string()) {
                if let Ok(profile) = WorkbookEngine::default().inspect_workbook(&source) {
                    for sheet in profile.sheets {
                        for column in sheet.columns {
                            collect_sensitivity_reasons(
                                &column,
                                CopilotHandoffReasonSource::Column,
                                Some(&column),
                                &mut reasons,
                            );
                        }
                    }
                }
            }
        }

        collect_sensitivity_reasons(
            &session.objective,
            CopilotHandoffReasonSource::Objective,
            None,
            &mut reasons,
        );
        collect_sensitivity_reasons(
            &turn.title,
            CopilotHandoffReasonSource::Objective,
            None,
            &mut reasons,
        );
        collect_sensitivity_reasons(
            &turn.objective,
            CopilotHandoffReasonSource::Objective,
            None,
            &mut reasons,
        );

        if reasons.is_empty() {
            return Ok(AssessCopilotHandoffResponse {
                status: CopilotHandoffStatus::Clear,
                headline: "No obvious sensitive signals were found before copy.".to_string(),
                summary: "Relay Agent did not detect common personal-data, identifier, or confidentiality keywords from the workbook path, current objectives, or available column names.".to_string(),
                reasons,
                suggested_actions: vec![
                    "Share only the minimum schema, prompt text, or sample rows that Copilot needs.".to_string(),
                ],
                planning_context: Some(self.build_planning_context(&session)),
            });
        }

        Ok(AssessCopilotHandoffResponse {
            status: CopilotHandoffStatus::Caution,
            headline: "This relay packet may describe sensitive data.".to_string(),
            summary: "Before you copy the packet into Copilot, confirm that you really need to share any personal, customer, employee, account, or confidential context it may reference.".to_string(),
            reasons,
            suggested_actions: vec![
                "Remove direct identifiers such as names, email addresses, phone numbers, account numbers, and customer IDs unless Copilot truly needs them.".to_string(),
                "If you only need structural help, share column names and the intended transform instead of raw rows.".to_string(),
                "Keep the copied content to the minimum sample that still explains the task.".to_string(),
            ],
            planning_context: Some(self.build_planning_context(&session)),
        })
    }

    pub fn approve_plan(
        &mut self,
        request: ApprovePlanRequest,
    ) -> Result<ApprovePlanResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let approved_steps = request
            .modified_steps
            .into_iter()
            .filter(|step| {
                request
                    .approved_step_ids
                    .iter()
                    .any(|approved| approved == &step.id)
            })
            .collect::<Vec<_>>();

        if approved_steps.is_empty() {
            return Err("at least one approved plan step is required".to_string());
        }

        let plan = ExecutionPlan {
            summary: format!("Approved plan for `{}`", turn.title),
            total_estimated_steps: approved_steps.len() as u32,
            steps: approved_steps,
        };
        let step_statuses = plan
            .steps
            .iter()
            .map(|step| PlanStepStatus {
                step_id: step.id.clone(),
                state: PlanStepState::Pending,
                result: None,
                error: None,
            })
            .collect::<Vec<_>>();
        let plan_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "execution-plan",
            &ExecutionPlanArtifactPayload { plan: plan.clone() },
            None,
        )?;
        let initial_progress = PlanProgressResponse {
            current_step_id: None,
            completed_count: 0,
            total_count: step_statuses.len() as u32,
            step_statuses,
        };
        let progress_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "plan-progress",
            &PlanProgressArtifactPayload {
                current_step_id: initial_progress.current_step_id.clone(),
                completed_count: initial_progress.completed_count,
                total_count: initial_progress.total_count,
                step_statuses: initial_progress.step_statuses.clone(),
            },
            None,
        )?;

        self.plan_progress.insert(
            turn.id.clone(),
            StoredPlanProgress {
                progress: initial_progress.clone(),
            },
        );
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&plan_artifact.id),
            "execution-plan-approved",
            "Approved autonomous execution plan recorded for the turn.".to_string(),
            Some(json!({
                "planArtifactId": plan_artifact.id,
                "progressArtifactId": progress_artifact.id,
                "approvedStepCount": initial_progress.total_count,
            })),
        )?;

        Ok(ApprovePlanResponse {
            approved: true,
            plan,
        })
    }

    pub fn get_plan_progress(
        &self,
        request: PlanProgressRequest,
    ) -> Result<PlanProgressResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;

        if let Some(progress) = self.plan_progress.get(&turn.id) {
            return Ok(progress.progress.clone());
        }

        if let Some(app_local_data_dir) = self.app_local_data_dir.as_deref() {
            let mut persisted_progress: Option<PlanProgressResponse> = None;
            let mut persisted_plan: Option<ExecutionPlan> = None;

            for artifact_id in turn.item_ids.iter().rev() {
                let meta =
                    persistence::read_artifact_meta(app_local_data_dir, &session.id, artifact_id)?;
                match meta.artifact_type.as_str() {
                    "plan-progress" if persisted_progress.is_none() => {
                        let payload: PlanProgressArtifactPayload =
                            persistence::read_artifact_payload(
                                app_local_data_dir,
                                &session.id,
                                &meta.id,
                            )?;
                        persisted_progress = Some(PlanProgressResponse {
                            current_step_id: payload.current_step_id,
                            completed_count: payload.completed_count,
                            total_count: payload.total_count,
                            step_statuses: payload.step_statuses,
                        });
                    }
                    "execution-plan" if persisted_plan.is_none() => {
                        let payload: ExecutionPlanArtifactPayload =
                            persistence::read_artifact_payload(
                                app_local_data_dir,
                                &session.id,
                                &meta.id,
                            )?;
                        persisted_plan = Some(payload.plan);
                    }
                    _ => {}
                }
            }

            if let Some(progress) = persisted_progress {
                return Ok(progress);
            }

            if let Some(plan) = persisted_plan {
                let step_statuses = plan
                    .steps
                    .iter()
                    .map(|step| PlanStepStatus {
                        step_id: step.id.clone(),
                        state: PlanStepState::Pending,
                        result: None,
                        error: None,
                    })
                    .collect::<Vec<_>>();

                return Ok(PlanProgressResponse {
                    current_step_id: None,
                    completed_count: 0,
                    total_count: step_statuses.len() as u32,
                    step_statuses,
                });
            }
        }

        Ok(PlanProgressResponse {
            current_step_id: None,
            completed_count: 0,
            total_count: 0,
            step_statuses: Vec::new(),
        })
    }

    pub fn record_plan_progress(
        &mut self,
        request: RecordPlanProgressRequest,
    ) -> Result<PlanProgressResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
        let response = PlanProgressResponse {
            current_step_id: request.current_step_id,
            completed_count: request.completed_count,
            total_count: request.total_count,
            step_statuses: request.step_statuses,
        };
        self.record_turn_artifact(
            &session.id,
            &turn.id,
            "plan-progress",
            &PlanProgressArtifactPayload {
                current_step_id: response.current_step_id.clone(),
                completed_count: response.completed_count,
                total_count: response.total_count,
                step_statuses: response.step_statuses.clone(),
            },
            None,
        )?;
        self.plan_progress.insert(
            turn.id.clone(),
            StoredPlanProgress {
                progress: response.clone(),
            },
        );
        self.touch_session(&session.id)?;

        Ok(response)
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
        let auto_learned_memory = if accepted {
            self.learn_project_memory_from_response(&session.id, parsed_response.as_ref())?
        } else {
            Vec::new()
        };
        let response_artifact = self.record_turn_artifact(
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
        let validation_artifact = self.record_turn_artifact(
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
                repair_prompt: repair_prompt.clone(),
                created_at: validation_artifact.created_at.clone(),
                artifact_id: validation_artifact.id.clone(),
            },
        );
        self.previews.remove(&turn.id);
        self.approvals.remove(&turn.id);
        self.scope_approvals.remove(&turn.id);
        self.executions.remove(&turn.id);
        self.touch_session(&session.id)?;
        self.append_turn_log(
            &session.id,
            &turn.id,
            Some(&validation_artifact.id),
            "copilot-response-submitted",
            "Copied model response was stored and validated.".to_string(),
            Some(json!({
                "accepted": accepted,
                "responseArtifactId": response_artifact.id.clone(),
                "validationArtifactId": validation_artifact.id.clone(),
                "validationIssueCount": validation_issues.len(),
            })),
        )?;
        if !auto_learned_memory.is_empty() {
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&validation_artifact.id),
                "project-memory-learned",
                format!(
                    "Learned {} project preference(s) from the accepted model response.",
                    auto_learned_memory.len()
                ),
                Some(json!({
                    "projectMemory": auto_learned_memory.clone(),
                })),
            )?;
        }

        Ok(SubmitCopilotResponseResponse {
            turn: next_turn,
            accepted,
            validation_issues,
            parsed_response,
            repair_prompt,
            auto_learned_memory,
        })
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

    pub fn execute_read_actions(
        &mut self,
        request: ExecuteReadActionsRequest,
    ) -> Result<ExecuteReadActionsResponse, String> {
        let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;

        if request.loop_turn > request.max_turns {
            return Ok(ExecuteReadActionsResponse {
                should_continue: false,
                tool_results: Vec::new(),
                has_write_actions: request.actions.iter().any(is_write_action),
                guard_message: Some(format!(
                    "最大ターン数（{}）に達しました。手動入力に切り替えてください。",
                    request.max_turns
                )),
            });
        }

        let current_diff = self
            .previews
            .get(&turn.id)
            .map(|preview| preview.diff_summary.clone())
            .unwrap_or_else(|| baseline_diff_summary(&session));
        let tool_results = request
            .actions
            .iter()
            .filter(|action| is_read_action(action))
            .map(|action| self.execute_single_read_action(&session, &turn, action, &current_diff))
            .collect::<Vec<_>>();

        Ok(ExecuteReadActionsResponse {
            should_continue: true,
            tool_results,
            has_write_actions: request.actions.iter().any(is_write_action),
            guard_message: None,
        })
    }

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

        let workbook_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_spreadsheet_write_action(action))
            .cloned()
            .collect::<Vec<_>>();
        let file_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_file_write_action(action))
            .cloned()
            .collect::<Vec<_>>();
        let source = session
            .primary_workbook_path
            .as_deref()
            .map(WorkbookSource::detect)
            .transpose()?;
        let (mut diff_summary, mut warnings) = if workbook_write_actions.is_empty() {
            (
                build_file_write_diff_summary(&session, &file_write_actions)?,
                build_file_write_preview_warnings(&file_write_actions)?,
            )
        } else {
            let preview = WorkbookEngine::default()
                .preview_actions(source.as_ref(), &workbook_write_actions)?;
            (preview.diff_summary, preview.warnings)
        };
        let highest_risk = parsed_response
            .actions
            .iter()
            .map(|action| evaluate_risk(&action.tool, &action.args))
            .max()
            .unwrap_or(OperationRisk::Readonly);
        let has_write_actions =
            !file_write_actions.is_empty() || parsed_response.actions.iter().any(is_write_action);
        let auto_approved = has_write_actions && should_auto_approve(approval_policy, highest_risk);
        let requires_approval = has_write_actions && !auto_approved;
        let read_tool_artifacts = self.collect_read_tool_artifacts(
            &session,
            &turn,
            &parsed_response.actions,
            &diff_summary,
        )?;
        for read_tool_artifact in read_tool_artifacts {
            let recorded_artifact = self.record_turn_artifact(
                &session.id,
                &turn.id,
                read_tool_artifact.artifact_type,
                &read_tool_artifact.payload,
                None,
            )?;
            self.append_turn_log(
                &session.id,
                &turn.id,
                Some(&recorded_artifact.id),
                read_tool_artifact.event_type,
                read_tool_artifact.message,
                Some(json!({
                    "artifactType": read_tool_artifact.artifact_type,
                })),
            )?;
            diff_summary
                .warnings
                .push(read_tool_artifact.warning.clone());
            warnings.push(read_tool_artifact.warning);
        }
        let artifacts = build_preview_artifacts(&diff_summary, &file_write_actions)?;
        let preview_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "preview",
            &json!({
                "diffSummary": diff_summary.clone(),
                "requiresApproval": requires_approval,
                "autoApproved": auto_approved,
                "highestRisk": highest_risk,
                "approvalPolicy": approval_policy,
                "warnings": warnings.clone(),
                "fileWriteActions": file_write_actions.clone(),
                "artifacts": artifacts.clone(),
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
        let response = self.responses.get(&turn.id).ok_or_else(|| {
            "a validated Copilot response must exist before scope approval can be recorded"
                .to_string()
        })?;
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
                response_artifact_id: Some(response_artifact_id.clone()),
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

        let stored_response = self
            .responses
            .get(&turn.id)
            .ok_or_else(|| "no validated response is available for execution".to_string())?;
        let parsed_response = stored_response
            .parsed_response
            .clone()
            .ok_or_else(|| "no parsed response is available for execution".to_string())?;

        let workbook_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_spreadsheet_write_action(action))
            .cloned()
            .collect::<Vec<_>>();
        let file_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_file_write_action(action))
            .cloned()
            .collect::<Vec<_>>();

        if !workbook_write_actions.is_empty() || !file_write_actions.is_empty() {
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

            if !workbook_write_actions.is_empty() {
                let source = session
                    .primary_workbook_path
                    .as_deref()
                    .ok_or_else(|| {
                        format!(
                            "session `{}` does not have a workbook source path for execution",
                            session.id
                        )
                    })
                    .and_then(|path| WorkbookSource::detect(path.to_string()))
                    .map_err(|error| {
                        self.record_execution_failure(&session, &turn, &preview, error.clone())
                            .unwrap_or_else(|record_error| {
                                format!(
                                    "{error} (also failed to record execution failure: {record_error})"
                                )
                            })
                    })?;
                let execution = WorkbookEngine::default()
                    .execute_actions(&source, &workbook_write_actions)
                    .map_err(|error| {
                        self.record_execution_failure(&session, &turn, &preview, error.clone())
                            .unwrap_or_else(|record_error| {
                                format!(
                                    "{error} (also failed to record execution failure: {record_error})"
                                )
                            })
                    })?;

                for warning in execution.warnings {
                    push_unique_string(&mut warnings, warning);
                }
                output_path = Some(execution.output_path);
            }

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

    pub fn run_execution_multi(
        &mut self,
        request: RunExecutionMultiRequest,
    ) -> Result<Vec<RunExecutionResponse>, String> {
        if request.output_specs.is_empty() {
            return Err("run_execution_multi requires at least one output spec".to_string());
        }
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

        let stored_response = self
            .responses
            .get(&turn.id)
            .ok_or_else(|| "no validated response is available for execution".to_string())?;
        let parsed_response = stored_response
            .parsed_response
            .clone()
            .ok_or_else(|| "no parsed response is available for execution".to_string())?;

        let workbook_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_spreadsheet_write_action(action))
            .cloned()
            .collect::<Vec<_>>();
        let file_write_actions = parsed_response
            .actions
            .iter()
            .filter(|action| is_file_write_action(action))
            .cloned()
            .collect::<Vec<_>>();

        if !file_write_actions.is_empty() {
            return Err(
                "run_execution_multi currently supports workbook save-copy responses only"
                    .to_string(),
            );
        }

        if workbook_write_actions.is_empty() {
            return Ok(vec![RunExecutionResponse {
                turn: turn.clone(),
                executed: true,
                output_path: None,
                output_paths: Vec::new(),
                artifacts: Vec::new(),
                warnings: vec![
                    "No workbook write actions were present, so multi-output execution completed as a no-op."
                        .to_string(),
                ],
                reason: None,
            }]);
        }

        ensure_unique_output_specs(&request.output_specs)?;

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

        let mut results = Vec::new();
        let base_warnings = collect_execution_warnings(&preview);
        let mut aggregate_warnings = base_warnings.clone();
        let mut aggregate_artifacts = Vec::new();
        let mut aggregate_output_paths = Vec::new();

        for spec in &request.output_specs {
            let (output_path, spec_warnings) =
                execute_output_spec(&source, &workbook_write_actions, spec).map_err(|error| {
                    self.record_execution_failure(&session, &turn, &preview, error.clone())
                        .unwrap_or_else(|record_error| {
                            format!(
                                "{error} (also failed to record execution failure: {record_error})"
                            )
                        })
                })?;
            let artifacts =
                build_output_path_artifacts(&session, std::slice::from_ref(&output_path))?;
            let warnings = merge_string_lists(base_warnings.clone(), spec_warnings);
            aggregate_output_paths.push(output_path.clone());
            aggregate_artifacts.extend(artifacts.clone());
            aggregate_warnings = merge_string_lists(aggregate_warnings, warnings.clone());

            results.push(RunExecutionResponse {
                turn: turn.clone(),
                executed: true,
                output_path: Some(output_path.clone()),
                output_paths: vec![output_path],
                artifacts,
                warnings,
                reason: None,
            });
        }

        dedupe_artifacts(&mut aggregate_artifacts);
        let next_turn =
            self.update_turn_status(&turn.id, TurnStatus::Executed, turn.validation_error_count)?;
        let primary_output_path = aggregate_output_paths.first().cloned();
        let execution_artifact = self.record_turn_artifact(
            &session.id,
            &turn.id,
            "execution",
            &json!({
                "executed": true,
                "outputPath": primary_output_path.clone(),
                "outputPaths": aggregate_output_paths.clone(),
                "artifacts": aggregate_artifacts.clone(),
                "warnings": aggregate_warnings.clone(),
            }),
            primary_output_path.clone(),
        )?;
        self.executions.insert(
            turn.id.clone(),
            StoredExecution {
                executed: true,
                output_path: primary_output_path.clone(),
                output_paths: aggregate_output_paths.clone(),
                artifacts: aggregate_artifacts.clone(),
                warnings: aggregate_warnings.clone(),
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
            format!(
                "Execution completed {} requested output(s) for the current turn.",
                aggregate_output_paths.len()
            ),
            Some(json!({
                "executionArtifactId": execution_artifact.id.clone(),
                "executed": true,
                "outputPaths": aggregate_output_paths,
            })),
        )?;

        for result in &mut results {
            result.turn = next_turn.clone();
        }

        Ok(results)
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
        let packet = self.resolve_packet_section(session, turn, persisted);
        let validation = self.resolve_validation_section(turn, persisted);
        let approval = self.resolve_approval_section(turn, persisted);
        let execution = self.resolve_execution_section(turn, persisted);

        TurnDetailsViewModel {
            overview: self.build_turn_overview(
                turn,
                persisted,
                &packet,
                &validation,
                &approval,
                &execution,
            ),
            packet,
            validation,
            approval,
            execution,
        }
    }

    fn build_turn_overview(
        &self,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
        packet: &TurnInspectionSection<PacketInspectionPayload>,
        validation: &TurnInspectionSection<ValidationInspectionPayload>,
        approval: &TurnInspectionSection<ApprovalInspectionPayload>,
        execution: &TurnInspectionSection<ExecutionInspectionPayload>,
    ) -> TurnOverview {
        let preview_ready = self.previews.contains_key(&turn.id) || persisted.preview.is_some();
        let steps = vec![
            TurnOverviewStep {
                id: "packet".to_string(),
                label: "Packet".to_string(),
                state: if packet.available {
                    TurnOverviewStepState::Complete
                } else if turn.status == TurnStatus::Draft {
                    TurnOverviewStepState::Current
                } else {
                    TurnOverviewStepState::Pending
                },
                summary: packet.summary.clone(),
            },
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
                } else if matches!(
                    turn.status,
                    TurnStatus::PacketReady | TurnStatus::AwaitingResponse
                ) {
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
                } else if matches!(turn.status, TurnStatus::Validated) {
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
                    "Preview details appear after checked changes are generated.".to_string()
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

    fn resolve_packet_section(
        &self,
        session: &Session,
        turn: &Turn,
        persisted: &PersistedTurnLifecycleArtifacts,
    ) -> TurnInspectionSection<PacketInspectionPayload> {
        if let Some(packet) = self.relay_packets.get(&turn.id) {
            return self.available_section(
                "Relay packet is ready for this turn.".to_string(),
                TurnInspectionSourceType::Live,
                packet.created_at.clone(),
                Some(packet.artifact_id.clone()),
                PacketInspectionPayload {
                    session_title: session.title.clone(),
                    turn_title: turn.title.clone(),
                    source_path: session.primary_workbook_path.clone(),
                    relay_mode: packet.packet.mode,
                    objective: packet.packet.objective.clone(),
                    context_lines: packet.packet.context.clone(),
                    allowed_read_tool_count: packet.packet.allowed_read_tools.len(),
                    allowed_write_tool_count: packet.packet.allowed_write_tools.len(),
                    response_notes: packet.packet.response_contract.notes.clone(),
                },
            );
        }

        if let Some(packet) = persisted.packet.as_ref() {
            return self.available_section(
                "A saved relay packet is available for this turn.".to_string(),
                TurnInspectionSourceType::Persisted,
                packet.created_at.clone(),
                Some(packet.artifact_id.clone()),
                PacketInspectionPayload {
                    session_title: session.title.clone(),
                    turn_title: turn.title.clone(),
                    source_path: session.primary_workbook_path.clone(),
                    relay_mode: packet.payload.mode,
                    objective: packet.payload.objective.clone(),
                    context_lines: packet.payload.context.clone(),
                    allowed_read_tool_count: packet.payload.allowed_read_tools.len(),
                    allowed_write_tool_count: packet.payload.allowed_write_tools.len(),
                    response_notes: packet.payload.response_contract.notes.clone(),
                },
            );
        }

        if turn.status == TurnStatus::Draft {
            return self.unavailable_section(
                "Packet details appear after a relay packet is generated for this turn."
                    .to_string(),
                TurnInspectionUnavailableReason::NotGeneratedYet,
            );
        }

        self.unavailable_section(
            "Packet details are not available for this turn or this older turn version."
                .to_string(),
            TurnInspectionUnavailableReason::NotSupportedForTurnVersion,
        )
    }

    fn resolve_validation_section(
        &self,
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

        if let Some(response) = self.responses.get(&turn.id) {
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
            return self.available_section(
                if accepted {
                    "Validation passed for the current response.".to_string()
                } else {
                    format!(
                        "Validation found {} issue(s) in the current response.",
                        response.validation_issues.len()
                    )
                },
                TurnInspectionSourceType::Live,
                response.created_at.clone(),
                Some(response.artifact_id.clone()),
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
                "Validation becomes available after a packet is generated and a Copilot response is pasted back into Studio.".to_string(),
                TurnInspectionUnavailableReason::StepNotReached,
            );
        }

        if turn.status == TurnStatus::PacketReady {
            return self.unavailable_section(
                "A Copilot response has not been validated for this turn yet.".to_string(),
                TurnInspectionUnavailableReason::NotGeneratedYet,
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
            .responses
            .get(&turn.id)
            .map(|response| response.artifact_id.clone())
            .or_else(|| {
                persisted
                    .validation
                    .as_ref()
                    .map(|response| response.artifact_id.clone())
            });
        let scope_override = self
            .scope_approvals
            .get(&turn.id)
            .filter(|scope| {
                Some(scope.response_artifact_id.clone()) == current_response_artifact_id
            })
            .map(|scope| ScopeOverrideInspectionRecord {
                decision: scope.decision,
                decided_at: scope.created_at.clone(),
                root_folder: scope.root_folder.clone(),
                violations: scope.violations.clone(),
                source: scope.source,
                note: scope.note.clone(),
                response_artifact_id: Some(scope.response_artifact_id.clone()),
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

    fn execute_single_read_action(
        &self,
        session: &Session,
        turn: &Turn,
        action: &SpreadsheetAction,
        current_diff: &DiffSummary,
    ) -> ToolExecutionResult {
        if is_write_action(action) {
            return ToolExecutionResult {
                tool: action.tool.clone(),
                args: action.args.clone(),
                ok: false,
                result: None,
                error: Some(format!(
                    "`{}` is a write tool and cannot be executed in read mode",
                    action.tool
                )),
            };
        }

        match self.tool_catalog.get(&action.tool) {
            Some(tool) if !tool.enabled => ToolExecutionResult {
                tool: action.tool.clone(),
                args: action.args.clone(),
                ok: false,
                result: None,
                error: Some(format!("tool `{}` is disabled", action.tool)),
            },
            Some(_) => {
                read_action_executor::execute_read_action(self, session, turn, action, current_diff)
            }
            None => ToolExecutionResult {
                tool: action.tool.clone(),
                args: action.args.clone(),
                ok: false,
                result: None,
                error: Some(format!("unknown tool: {}", action.tool)),
            },
        }
    }

    pub(crate) fn resolve_workbook_source(
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

    pub(crate) fn session_diff_from_base(
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

    fn read_supported_turn_artifact(
        &self,
        app_local_data_dir: &std::path::Path,
        session_id: &str,
        meta: &PersistedArtifactMeta,
    ) -> Result<Option<TurnArtifactRecord>, String> {
        match meta.artifact_type.as_str() {
            "workbook-profile" => {
                let payload: crate::models::WorkbookProfile =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::WorkbookProfile {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            "sheet-preview" => {
                let payload: SheetPreview =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::SheetPreview {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
            "column-profile" => {
                let payload: SheetColumnProfile =
                    persistence::read_artifact_payload(app_local_data_dir, session_id, &meta.id)?;
                Ok(Some(TurnArtifactRecord::ColumnProfile {
                    artifact_id: meta.id.clone(),
                    created_at: meta.created_at.clone(),
                    payload,
                }))
            }
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
        self.session_store.touch_session(session_id, timestamp())?;
        self.persist_session_state(session_id)
    }

    fn build_planning_context(&self, session: &Session) -> PlanningContext {
        let workbook_summary = if let Some(path) = session.primary_workbook_path.as_deref() {
            match WorkbookSource::detect(path.to_string())
                .and_then(|source| WorkbookEngine::default().inspect_workbook(&source))
            {
                Ok(profile) => {
                    let sheets = profile
                        .sheets
                        .iter()
                        .map(|sheet| {
                            format!(
                                "{} ({} rows; columns: {})",
                                sheet.name,
                                sheet.row_count,
                                sheet.columns.join(", ")
                            )
                        })
                        .collect::<Vec<_>>();
                    format!("File: {path}\n{}", sheets.join("\n"))
                }
                Err(_) => format!("File: {path}\nWorkbook summary is not available yet."),
            }
        } else {
            "Workbook path is not available yet.".to_string()
        };

        PlanningContext {
            workbook_summary,
            available_tools: PlanningContextToolGroups {
                read: self
                    .tool_catalog
                    .list_descriptors_by_phase(ToolPhase::Read)
                    .into_iter()
                    .map(|tool| tool.id)
                    .collect(),
                write: self
                    .tool_catalog
                    .list_descriptors_by_phase(ToolPhase::Write)
                    .into_iter()
                    .map(|tool| tool.id)
                    .collect(),
            },
            suggested_approach: vec![
                "Start with read tools to confirm workbook structure and column names.".to_string(),
                "Only propose write steps after the necessary context is collected.".to_string(),
                "Keep all output in a separate save-copy destination.".to_string(),
            ],
        }
    }
}

fn humanize_turn_status(status: TurnStatus) -> String {
    match status {
        TurnStatus::Draft => "Draft".to_string(),
        TurnStatus::PacketReady => "Packet ready".to_string(),
        TurnStatus::AwaitingResponse => "Awaiting a corrected response".to_string(),
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

#[derive(Clone, Copy)]
struct SensitivityKeyword {
    needle: &'static str,
    label: &'static str,
}

const SENSITIVITY_KEYWORDS: &[SensitivityKeyword] = &[
    SensitivityKeyword {
        needle: "email",
        label: "email addresses",
    },
    SensitivityKeyword {
        needle: "phone",
        label: "phone numbers",
    },
    SensitivityKeyword {
        needle: "address",
        label: "street or mailing addresses",
    },
    SensitivityKeyword {
        needle: "name",
        label: "personal names",
    },
    SensitivityKeyword {
        needle: "customer",
        label: "customer identifiers or customer records",
    },
    SensitivityKeyword {
        needle: "employee",
        label: "employee records",
    },
    SensitivityKeyword {
        needle: "payroll",
        label: "payroll information",
    },
    SensitivityKeyword {
        needle: "salary",
        label: "salary or compensation data",
    },
    SensitivityKeyword {
        needle: "ssn",
        label: "government or personal identifiers",
    },
    SensitivityKeyword {
        needle: "social security",
        label: "government or personal identifiers",
    },
    SensitivityKeyword {
        needle: "dob",
        label: "dates of birth",
    },
    SensitivityKeyword {
        needle: "birth",
        label: "dates of birth",
    },
    SensitivityKeyword {
        needle: "account",
        label: "account numbers or account records",
    },
    SensitivityKeyword {
        needle: "routing",
        label: "bank routing data",
    },
    SensitivityKeyword {
        needle: "iban",
        label: "bank account details",
    },
    SensitivityKeyword {
        needle: "card",
        label: "payment card details",
    },
    SensitivityKeyword {
        needle: "tax",
        label: "tax identifiers",
    },
    SensitivityKeyword {
        needle: "passport",
        label: "passport details",
    },
    SensitivityKeyword {
        needle: "confidential",
        label: "confidential material",
    },
    SensitivityKeyword {
        needle: "private",
        label: "private material",
    },
    SensitivityKeyword {
        needle: "internal",
        label: "internal-only material",
    },
];

fn collect_sensitivity_reasons(
    text: &str,
    source: CopilotHandoffReasonSource,
    context_label: Option<&str>,
    reasons: &mut Vec<CopilotHandoffReason>,
) {
    let normalized_text = text.to_ascii_lowercase();

    for keyword in SENSITIVITY_KEYWORDS {
        if !normalized_text.contains(keyword.needle) {
            continue;
        }

        let label = match source {
            CopilotHandoffReasonSource::Path => "Workbook path looks sensitive",
            CopilotHandoffReasonSource::Column => "A column name looks sensitive",
            CopilotHandoffReasonSource::Objective => {
                "The current objective mentions sensitive context"
            }
        };
        let context = context_label.unwrap_or(text);
        let detail = match source {
            CopilotHandoffReasonSource::Path => format!(
                "`{context}` includes `{}`, which often signals {}.",
                keyword.needle, keyword.label
            ),
            CopilotHandoffReasonSource::Column => format!(
                "Column `{context}` looks like it may contain {}.",
                keyword.label
            ),
            CopilotHandoffReasonSource::Objective => format!(
                "The current task text mentions `{}`, which can imply {}.",
                keyword.needle, keyword.label
            ),
        };

        push_unique_handoff_reason(
            reasons,
            CopilotHandoffReason {
                source,
                label: label.to_string(),
                detail,
            },
        );
    }
}

fn push_unique_handoff_reason(
    reasons: &mut Vec<CopilotHandoffReason>,
    reason: CopilotHandoffReason,
) {
    if reasons
        .iter()
        .any(|existing| existing.detail == reason.detail)
    {
        return;
    }

    if reasons.len() >= 6 {
        return;
    }

    reasons.push(reason);
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

fn output_format_label(format: OutputFormat) -> &'static str {
    match format {
        OutputFormat::Csv => "CSV",
        OutputFormat::Xlsx => "XLSX",
        OutputFormat::Text => "text",
        OutputFormat::Json => "JSON",
    }
}

fn ensure_unique_output_specs(specs: &[OutputSpec]) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for spec in specs {
        if !seen.insert(spec.output_path.clone()) {
            return Err(format!(
                "run_execution_multi received duplicate outputPath values: `{}`",
                spec.output_path
            ));
        }
    }

    Ok(())
}

fn execute_output_spec(
    source: &WorkbookSource,
    workbook_actions: &[SpreadsheetAction],
    spec: &OutputSpec,
) -> Result<(String, Vec<String>), String> {
    match spec.format {
        OutputFormat::Csv => execute_native_workbook_output(source, workbook_actions, spec),
        OutputFormat::Xlsx => execute_native_workbook_output(source, workbook_actions, spec),
        OutputFormat::Json => execute_derived_csv_output(source, workbook_actions, spec, "json"),
        OutputFormat::Text => execute_derived_csv_output(source, workbook_actions, spec, "text"),
    }
}

fn execute_native_workbook_output(
    source: &WorkbookSource,
    workbook_actions: &[SpreadsheetAction],
    spec: &OutputSpec,
) -> Result<(String, Vec<String>), String> {
    match spec.format {
        OutputFormat::Csv => {
            if source.format() != crate::models::WorkbookFormat::Csv {
                return Err("CSV multi-output currently requires a CSV workbook source".to_string());
            }
        }
        OutputFormat::Xlsx => {
            if source.format() != crate::models::WorkbookFormat::Xlsx {
                return Err(
                    "XLSX multi-output currently requires an XLSX workbook source".to_string(),
                );
            }
            if workbook_actions_require_csv_replay(workbook_actions) {
                return Err(
                    "XLSX multi-output is only supported for copy-only workbook responses"
                        .to_string(),
                );
            }
        }
        OutputFormat::Text | OutputFormat::Json => {}
    }

    let actions = override_save_copy_output_path(workbook_actions, &spec.output_path);
    let execution = WorkbookEngine::default().execute_actions(source, &actions)?;
    Ok((execution.output_path, execution.warnings))
}

fn execute_derived_csv_output(
    source: &WorkbookSource,
    workbook_actions: &[SpreadsheetAction],
    spec: &OutputSpec,
    target_kind: &str,
) -> Result<(String, Vec<String>), String> {
    if source.format() != crate::models::WorkbookFormat::Csv {
        return Err(format!(
            "{} multi-output currently requires a CSV workbook source",
            output_format_label(spec.format)
        ));
    }

    let temp_csv_path = env_temp_output_path("relay-agent-multi-output", "csv");
    let actions = override_save_copy_output_path(workbook_actions, &temp_csv_path);
    let execution = WorkbookEngine::default().execute_actions(source, &actions)?;
    let render_result = match target_kind {
        "json" => render_csv_as_json(&temp_csv_path, &spec.output_path),
        "text" => render_csv_as_text_report(&temp_csv_path, &spec.output_path),
        _ => Err(format!("unsupported derived output kind `{target_kind}`")),
    };
    let cleanup_result = fs::remove_file(&temp_csv_path);

    render_result?;
    if let Err(error) = cleanup_result {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(format!(
                "derived output succeeded but failed to clean up `{temp_csv_path}`: {error}"
            ));
        }
    }

    Ok((spec.output_path.clone(), execution.warnings))
}

fn override_save_copy_output_path(
    workbook_actions: &[SpreadsheetAction],
    output_path: &str,
) -> Vec<SpreadsheetAction> {
    let mut saw_save_copy = false;
    let mut actions = workbook_actions
        .iter()
        .cloned()
        .map(|mut action| {
            if action.tool == "workbook.save_copy" {
                action.args = json!({ "outputPath": output_path });
                saw_save_copy = true;
            }
            action
        })
        .collect::<Vec<_>>();

    if !saw_save_copy {
        actions.push(SpreadsheetAction {
            id: None,
            tool: "workbook.save_copy".to_string(),
            rationale: Some("Derived by run_execution_multi".to_string()),
            sheet: None,
            args: json!({ "outputPath": output_path }),
        });
    }

    actions
}

fn workbook_actions_require_csv_replay(actions: &[SpreadsheetAction]) -> bool {
    actions.iter().any(|action| {
        matches!(
            action.tool.as_str(),
            "table.rename_columns"
                | "table.cast_columns"
                | "table.filter_rows"
                | "table.derive_column"
                | "table.group_aggregate"
        )
    })
}

fn render_csv_as_json(csv_path: &str, output_path: &str) -> Result<(), String> {
    let source_path = Path::new(csv_path);
    if !source_path.is_file() {
        return Err(format!(
            "derived CSV `{}` does not exist for JSON export",
            source_path.display()
        ));
    }
    let destination = Path::new(output_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create JSON output directory `{}`: {error}",
                parent.display()
            )
        })?;
    }
    let mut reader = csv::Reader::from_path(source_path).map_err(|error| {
        format!(
            "JSON multi-output currently expects CSV-compatible input `{}`: {error}",
            source_path.display()
        )
    })?;
    let headers = reader
        .headers()
        .map_err(|error| {
            format!(
                "failed to read CSV headers from `{}`: {error}",
                source_path.display()
            )
        })?
        .iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| {
            format!(
                "failed to read CSV rows from `{}`: {error}",
                source_path.display()
            )
        })?;
        let mut object = serde_json::Map::new();
        for (index, value) in record.iter().enumerate() {
            let key = headers
                .get(index)
                .cloned()
                .unwrap_or_else(|| format!("column{}", index + 1));
            object.insert(key, json!(value));
        }
        rows.push(Value::Object(object));
    }
    let rendered = serde_json::to_string_pretty(&rows)
        .map_err(|error| format!("failed to render JSON output: {error}"))?;
    fs::write(destination, rendered).map_err(|error| {
        format!(
            "failed to write JSON output `{}`: {error}",
            destination.display()
        )
    })?;

    Ok(())
}

fn render_csv_as_text_report(csv_path: &str, output_path: &str) -> Result<(), String> {
    let source_path = Path::new(csv_path);
    let destination = Path::new(output_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create text output directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let mut reader = csv::Reader::from_path(source_path).map_err(|error| {
        format!(
            "text multi-output currently expects CSV-compatible input `{}`: {error}",
            source_path.display()
        )
    })?;
    let headers = reader
        .headers()
        .map_err(|error| {
            format!(
                "failed to read CSV headers from `{}`: {error}",
                source_path.display()
            )
        })?
        .iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut row_count = 0_u64;
    let mut sample_rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| {
            format!(
                "failed to read CSV rows from `{}`: {error}",
                source_path.display()
            )
        })?;
        row_count += 1;
        if sample_rows.len() < 5 {
            let summary = headers
                .iter()
                .zip(record.iter())
                .map(|(column, value)| format!("{column}={value}"))
                .collect::<Vec<_>>()
                .join(", ");
            sample_rows.push(format!("- row {}: {}", row_count, summary));
        }
    }

    let rendered = format!(
        "Relay Agent Output Report\n\nRows: {row_count}\nColumns: {}\n\nSample rows:\n{}\n",
        headers.join(", "),
        if sample_rows.is_empty() {
            "- no rows".to_string()
        } else {
            sample_rows.join("\n")
        }
    );
    fs::write(destination, rendered).map_err(|error| {
        format!(
            "failed to write text output `{}`: {error}",
            destination.display()
        )
    })?;

    Ok(())
}

fn env_temp_output_path(prefix: &str, extension: &str) -> String {
    env::temp_dir()
        .join(format!("{prefix}-{}.{}", Uuid::new_v4(), extension))
        .to_string_lossy()
        .into_owned()
}

fn merge_string_lists(mut left: Vec<String>, right: Vec<String>) -> Vec<String> {
    for value in right {
        push_unique_string(&mut left, value);
    }
    left
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
        "workbook.save_copy" => action
            .args
            .get("path")
            .or_else(|| action.args.get("outputPath"))
            .and_then(Value::as_str),
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
        "document.read_text" => {
            require_arg_string(args_object, index, "path", validation_issues);
            validate_optional_positive_integer(
                args_object.get("maxChars"),
                index,
                "maxChars",
                validation_issues,
            );
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
    is_spreadsheet_write_action(action) || is_file_write_action(action)
}

fn is_spreadsheet_write_action(action: &SpreadsheetAction) -> bool {
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

fn is_file_write_action(action: &SpreadsheetAction) -> bool {
    matches!(
        action.tool.as_str(),
        "file.copy" | "file.move" | "file.delete" | "text.replace"
    )
}

fn is_read_action(action: &SpreadsheetAction) -> bool {
    !is_write_action(action)
}

fn is_known_tool(tool: &str) -> bool {
    matches!(
        tool,
        "workbook.inspect"
            | "sheet.preview"
            | "sheet.profile_columns"
            | "session.diff_from_base"
            | "file.list"
            | "file.read_text"
            | "file.stat"
            | "text.search"
            | "text.replace"
            | "document.read_text"
            | "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
            | "workbook.save_copy"
            | "file.copy"
            | "file.move"
            | "file.delete"
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

#[allow(dead_code)]
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
        ToolDescriptor {
            id: "file.list".to_string(),
            title: "List files".to_string(),
            description: "Read file and directory names plus basic metadata.".to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "file.read_text".to_string(),
            title: "Read text file".to_string(),
            description: "Read UTF-8 or Shift_JIS text content up to 1MB.".to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "file.stat".to_string(),
            title: "Inspect file metadata".to_string(),
            description: "Read existence, size, and timestamps for a file or directory."
                .to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "text.search".to_string(),
            title: "Search text".to_string(),
            description: "Search a text file with a regular expression and return context lines."
                .to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
        ToolDescriptor {
            id: "document.read_text".to_string(),
            title: "Read document text".to_string(),
            description: "Extract text from DOCX, PPTX, PDF, and common plain-text files."
                .to_string(),
            phase: ToolPhase::Read,
            requires_approval: false,
        },
    ]
}

#[allow(dead_code)]
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
        ToolDescriptor {
            id: "file.copy".to_string(),
            title: "Copy file".to_string(),
            description: "Copy a file to a new absolute destination path.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "file.move".to_string(),
            title: "Move file".to_string(),
            description: "Move or rename a file to a new absolute destination path.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "file.delete".to_string(),
            title: "Delete file".to_string(),
            description: "Move a file to the recycle bin or permanently delete it.".to_string(),
            phase: ToolPhase::Write,
            requires_approval: true,
        },
        ToolDescriptor {
            id: "text.replace".to_string(),
            title: "Replace text".to_string(),
            description: "Apply a regex replacement to a text file after approval.".to_string(),
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

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, env, fs, path::Path};

    use super::AppStorage;
    use crate::models::{
        AddProjectMemoryRequest, ApprovalDecision, AssessCopilotHandoffRequest,
        CopilotHandoffStatus, CreateProjectRequest, CreateSessionRequest,
        ExecuteReadActionsRequest, ExecutionInspectionState, GenerateRelayPacketRequest,
        LinkSessionToProjectRequest, OutputFormat, OutputSpec, PreviewExecutionRequest,
        ProjectMemorySource, ReadProjectRequest, ReadSessionRequest, RecordScopeApprovalRequest,
        RelayMode, RespondToApprovalRequest, RunExecutionMultiRequest, RunExecutionRequest,
        ScopeApprovalSource, SetSessionProjectRequest, SpreadsheetAction, StartTurnRequest,
        SubmitCopilotResponseRequest, TurnArtifactRecord, TurnInspectionSourceType, TurnStatus,
        UpdateProjectRequest,
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
        assert_eq!(packet.allowed_write_tools.len(), 10);

        let submitted = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: copilot_response(
                    "Create a normalized output copy.",
                    vec![
                        json!({
                            "tool": "table.derive_column",
                            "sheet": "Sheet1",
                            "args": {
                                "column": "normalized_total",
                                "expression": "amount",
                                "position": "end"
                            }
                        }),
                        json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": output_path.clone()
                            }
                        }),
                    ],
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
    fn cautions_before_copy_when_columns_look_sensitive() {
        let csv_path = write_test_csv("customer_id,email,amount\nC-1,pat@example.com,42.5\n");
        let mut storage = AppStorage::default();

        let session = storage
            .create_session(CreateSessionRequest {
                title: "Customer export".to_string(),
                objective: "Prepare a packet for customer cleanup".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Share with Copilot".to_string(),
                objective: "Review customer identifiers before generating the transform"
                    .to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let assessment = storage
            .assess_copilot_handoff(AssessCopilotHandoffRequest {
                session_id: session.id,
                turn_id: turn.id,
            })
            .expect("handoff assessment should succeed");

        assert_eq!(assessment.status, CopilotHandoffStatus::Caution);
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.source == crate::models::CopilotHandoffReasonSource::Column));
        assert!(assessment
            .suggested_actions
            .iter()
            .any(|action| action.contains("minimum")));

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
                raw_response: copilot_response(
                    "Preview a normalized output copy.",
                    vec![
                        json!({
                            "tool": "table.rename_columns",
                            "sheet": "Sheet1",
                            "args": {
                                "renames": [
                                    { "from": "amount", "to": "net_amount" }
                                ]
                            }
                        }),
                        json!({
                            "tool": "table.cast_columns",
                            "sheet": "Sheet1",
                            "args": {
                                "casts": [
                                    { "column": "net_amount", "toType": "number" }
                                ]
                            }
                        }),
                        json!({
                            "tool": "table.filter_rows",
                            "sheet": "Sheet1",
                            "args": {
                                "predicate": "approved = true"
                            }
                        }),
                        json!({
                            "tool": "table.derive_column",
                            "sheet": "Sheet1",
                            "args": {
                                "column": "gross_amount",
                                "expression": "[net_amount] + 10",
                                "position": "after",
                                "afterColumn": "net_amount"
                            }
                        }),
                        json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": output_path.clone()
                            }
                        }),
                    ],
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
                raw_response: copilot_response(
                    "Write a sanitized CSV save-copy output.",
                    vec![
                        json!({
                            "tool": "table.derive_column",
                            "sheet": "Sheet1",
                            "args": {
                                "column": "review_flag",
                                "expression": "\"=needs-review\"",
                                "position": "end"
                            }
                        }),
                        json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": output_path.clone()
                            }
                        }),
                    ],
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
            assert_eq!(packet.allowed_read_tools.len(), 10);
            assert!(packet
                .allowed_read_tools
                .iter()
                .any(|tool| tool.id == "file.read_text"));
            assert!(packet
                .allowed_read_tools
                .iter()
                .any(|tool| tool.id == "browser.send_to_copilot"));
            assert_eq!(packet.allowed_write_tools.len(), 10);
            assert!(packet.context.iter().any(|line| line
                == &format!(
                    "Primary workbook path: {}",
                    example_csv_path.to_string_lossy()
                )));

            let submission = storage
                .submit_copilot_response(SubmitCopilotResponseRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                    raw_response: copilot_response(
                        "Keep approved rows, add a review label, and write a sanitized CSV copy.",
                        vec![
                            json!({
                                "tool": "table.filter_rows",
                                "sheet": "Sheet1",
                                "args": {
                                    "predicate": "approved = true"
                                }
                            }),
                            json!({
                                "tool": "table.derive_column",
                                "sheet": "Sheet1",
                                "args": {
                                    "column": "review_label",
                                    "expression": "[segment] + \"-approved\"",
                                    "position": "end"
                                }
                            }),
                            json!({
                                "tool": "workbook.save_copy",
                                "args": {
                                    "outputPath": output_path.clone()
                                }
                            }),
                        ],
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
                    raw_response: copilot_response(
                        "Write a reviewed copy outside the default project root.",
                        vec![json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": "/tmp/outside-reviewed-copy.csv"
                            }
                        })],
                    ),
                })
                .expect("response should parse");
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
                    raw_response: copilot_response(
                        "Create a normalized output copy.",
                        vec![
                            json!({
                                "tool": "table.derive_column",
                                "sheet": "Sheet1",
                                "args": {
                                    "column": "normalized_total",
                                    "expression": "amount",
                                    "position": "end"
                                }
                            }),
                            json!({
                                "tool": "workbook.save_copy",
                                "args": {
                                    "outputPath": output_path.clone()
                                }
                            }),
                        ],
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
                    raw_response: copilot_response(
                        "Inspect the workbook and stage a rename preview.",
                        vec![
                            json!({
                                "tool": "workbook.inspect",
                                "args": {}
                            }),
                            json!({
                                "tool": "sheet.preview",
                                "args": {
                                    "sheet": "Sheet1",
                                    "limit": 2
                                }
                            }),
                            json!({
                                "tool": "sheet.profile_columns",
                                "args": {
                                    "sheet": "Sheet1",
                                    "sampleSize": 2
                                }
                            }),
                            json!({
                                "tool": "session.diff_from_base",
                                "args": {}
                            }),
                            json!({
                                "tool": "table.rename_columns",
                                "sheet": "Sheet1",
                                "args": {
                                    "renames": [
                                        {
                                            "from": "amount",
                                            "to": "normalized_amount"
                                        }
                                    ]
                                }
                            }),
                            json!({
                                "tool": "workbook.save_copy",
                                "args": {
                                    "outputPath": output_path.clone()
                                }
                            }),
                        ],
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
        let artifact_response = reloaded
            .read_turn_artifacts(&session_id, &turn_id)
            .expect("turn artifacts should be readable");
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
        assert_eq!(artifact_response.turn.id, turn_id);
        assert_eq!(artifact_response.artifacts.len(), 5);
        assert!(matches!(
            artifact_response.artifacts.first(),
            Some(TurnArtifactRecord::WorkbookProfile { .. })
        ));
        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::SheetPreview { .. })));
        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::ColumnProfile { .. })));
        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::DiffSummary { .. })));
        assert!(artifact_response
            .artifacts
            .iter()
            .any(|artifact| matches!(artifact, TurnArtifactRecord::Preview { .. })));
        assert_eq!(artifact_response.storage_mode, "local-json");
        assert_eq!(
            artifact_response.turn_details.overview.storage_mode,
            "local-json"
        );
        assert!(artifact_response.turn_details.packet.available);
        assert_eq!(
            artifact_response.turn_details.packet.source_type,
            Some(TurnInspectionSourceType::Persisted)
        );
        assert!(artifact_response.turn_details.validation.available);
        assert_eq!(
            artifact_response
                .turn_details
                .validation
                .payload
                .as_ref()
                .map(|payload| payload.accepted),
            Some(true)
        );
        assert!(artifact_response.turn_details.approval.available);
        assert_eq!(
            artifact_response
                .turn_details
                .approval
                .payload
                .as_ref()
                .and_then(|payload| payload.decision),
            None
        );
        assert_eq!(
            artifact_response
                .turn_details
                .execution
                .payload
                .as_ref()
                .map(|payload| payload.state),
            Some(ExecutionInspectionState::NotRun)
        );

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn read_turn_artifacts_persist_failed_execution_details_after_save_error() {
        let app_local_data_dir = unique_test_app_data_dir();
        let csv_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n");
        let output_path = csv_path
            .join("reviewed-copy.csv")
            .to_string_lossy()
            .into_owned();

        let (session_id, turn_id) = {
            let mut storage =
                AppStorage::open(app_local_data_dir.clone()).expect("storage should initialize");

            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Execution failure details".to_string(),
                    objective: "Capture failed execution evidence for inspection.".to_string(),
                    primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
                })
                .expect("session should be created");
            let turn = storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Blocked output path".to_string(),
                    objective: "Try to save a reviewed copy into a path that cannot be created."
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
                    raw_response: copilot_response(
                        "Rename a column and attempt to save a reviewed copy.",
                        vec![
                            json!({
                                "tool": "table.rename_columns",
                                "sheet": "Sheet1",
                                "args": {
                                    "renames": [
                                        {
                                            "from": "amount",
                                            "to": "normalized_amount"
                                        }
                                    ]
                                }
                            }),
                            json!({
                                "tool": "workbook.save_copy",
                                "args": {
                                    "outputPath": output_path.clone()
                                }
                            }),
                        ],
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
                    note: Some("Capture the failure details".to_string()),
                })
                .expect("approval should be recorded");

            let execution_error = storage
                .run_execution(RunExecutionRequest {
                    session_id: session.id.clone(),
                    turn_id: turn.id.clone(),
                })
                .expect_err("execution should fail when the output parent is a file path");
            assert!(execution_error.contains("failed to create output directory"));

            let live_artifact_response = storage
                .read_turn_artifacts(&session.id, &turn.id)
                .expect("live turn details should be readable");
            assert_eq!(
                live_artifact_response.turn_details.execution.source_type,
                Some(TurnInspectionSourceType::Live)
            );
            assert_eq!(
                live_artifact_response
                    .turn_details
                    .execution
                    .payload
                    .as_ref()
                    .map(|payload| payload.state),
                Some(ExecutionInspectionState::Failed)
            );
            assert_eq!(
                live_artifact_response
                    .turn_details
                    .execution
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.output_path.as_deref()),
                Some(output_path.as_str())
            );
            assert!(live_artifact_response
                .turn_details
                .execution
                .payload
                .as_ref()
                .map(|payload| payload
                    .reason_summary
                    .contains("failed to create output directory"))
                .unwrap_or(false));

            let detail = storage
                .read_session(&session.id)
                .expect("session should be readable after the failure");
            let failed_turn = detail
                .turns
                .iter()
                .find(|candidate| candidate.id == turn.id)
                .expect("turn should still exist");
            assert_eq!(failed_turn.status, TurnStatus::Failed);

            (session.id, turn.id)
        };

        let reloaded = AppStorage::open(app_local_data_dir.clone()).expect("storage should reload");
        let detail = reloaded
            .read_session(&session_id)
            .expect("persisted session should be readable");
        let failed_turn = detail
            .turns
            .iter()
            .find(|turn| turn.id == turn_id)
            .expect("turn should still exist after reload");
        let artifact_response = reloaded
            .read_turn_artifacts(&session_id, &turn_id)
            .expect("persisted turn details should be readable");

        assert_eq!(failed_turn.status, TurnStatus::Failed);
        assert_eq!(artifact_response.storage_mode, "local-json");
        assert_eq!(
            artifact_response.turn_details.execution.source_type,
            Some(TurnInspectionSourceType::Persisted)
        );
        assert_eq!(
            artifact_response
                .turn_details
                .execution
                .payload
                .as_ref()
                .map(|payload| payload.state),
            Some(ExecutionInspectionState::Failed)
        );
        assert_eq!(
            artifact_response
                .turn_details
                .execution
                .payload
                .as_ref()
                .and_then(|payload| payload.output_path.as_deref()),
            Some(output_path.as_str())
        );
        assert!(artifact_response
            .turn_details
            .execution
            .payload
            .as_ref()
            .map(|payload| payload
                .reason_summary
                .contains("failed to create output directory"))
            .unwrap_or(false));

        fs::remove_dir_all(app_local_data_dir).expect("test storage should clean up");
        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn read_turn_artifacts_returns_live_turn_details_in_memory_mode() {
        let csv_path = write_test_csv(
            "customer_id,amount,posted_on,approved\n1,42.5,2025-01-01,true\n2,13.0,2025-01-02,false\n",
        );
        let output_path = env::temp_dir()
            .join(format!(
                "relay-agent-memory-turn-details-{}.csv",
                Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();

        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Memory mode details".to_string(),
                objective: "Inspect details without local persistence".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Current turn details".to_string(),
                objective: "Generate a packet, validate it, and preview it in memory mode."
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
                raw_response: copilot_response(
                    "Filter approved rows and stage a save-copy preview.",
                    vec![
                        json!({
                            "tool": "table.filter_rows",
                            "sheet": "Sheet1",
                            "args": {
                                "predicate": "approved = true"
                            }
                        }),
                        json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": output_path.clone()
                            }
                        }),
                    ],
                ),
            })
            .expect("response should parse");
        storage
            .preview_execution(PreviewExecutionRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("preview should succeed");

        let artifact_response = storage
            .read_turn_artifacts(&session.id, &turn.id)
            .expect("turn details should still resolve");

        assert_eq!(artifact_response.storage_mode, "memory");
        assert!(artifact_response.artifacts.is_empty());
        assert_eq!(
            artifact_response.turn_details.overview.storage_mode,
            "memory"
        );
        assert_eq!(
            artifact_response.turn_details.packet.source_type,
            Some(TurnInspectionSourceType::Live)
        );
        assert_eq!(
            artifact_response.turn_details.validation.source_type,
            Some(TurnInspectionSourceType::Live)
        );
        assert_eq!(
            artifact_response.turn_details.approval.source_type,
            Some(TurnInspectionSourceType::Live)
        );
        assert_eq!(
            artifact_response.turn_details.execution.source_type,
            Some(TurnInspectionSourceType::Live)
        );
        assert_eq!(
            artifact_response
                .turn_details
                .execution
                .payload
                .as_ref()
                .map(|payload| payload.state),
            Some(ExecutionInspectionState::NotRun)
        );
        assert!(artifact_response
            .turn_details
            .overview
            .summary
            .contains("in-memory"));

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
                    raw_response: copilot_response(
                        "Inspect the workbook and preview an aggregated save-copy output.",
                        vec![
                            json!({
                                "tool": "workbook.inspect",
                                "args": {}
                            }),
                            json!({
                                "tool": "table.group_aggregate",
                                "sheet": "Sheet1",
                                "args": {
                                    "groupBy": ["region"],
                                    "measures": [
                                        {
                                            "column": "amount",
                                            "op": "sum",
                                            "as": "total_amount"
                                        },
                                        {
                                            "column": "units",
                                            "op": "avg",
                                            "as": "average_units"
                                        },
                                        {
                                            "column": "segment",
                                            "op": "count",
                                            "as": "row_count"
                                        }
                                    ]
                                }
                            }),
                            json!({
                                "tool": "workbook.save_copy",
                                "args": {
                                    "outputPath": output_path.clone()
                                }
                            }),
                        ],
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

    #[test]
    fn execute_read_actions_stops_when_loop_guard_is_hit() {
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Guard test".to_string(),
                objective: "Stop when max turns are exceeded.".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Guard turn".to_string(),
                objective: "Loop guard".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let response = storage
            .execute_read_actions(ExecuteReadActionsRequest {
                session_id: session.id,
                turn_id: turn.id,
                loop_turn: 11,
                max_turns: 10,
                actions: vec![],
            })
            .expect("guard response should return");

        assert!(!response.should_continue);
        assert!(response.tool_results.is_empty());
        assert!(response
            .guard_message
            .as_deref()
            .unwrap_or_default()
            .contains("最大ターン数"));
    }

    #[test]
    fn execute_read_actions_flags_write_actions_without_executing_them() {
        let csv_path = write_test_csv("id,amount\n1,42\n");
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Write action gate".to_string(),
                objective: "Do not auto-run writes.".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Write turn".to_string(),
                objective: "Only detect writes".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let response = storage
            .execute_read_actions(ExecuteReadActionsRequest {
                session_id: session.id,
                turn_id: turn.id,
                loop_turn: 1,
                max_turns: 10,
                actions: vec![SpreadsheetAction {
                    id: None,
                    tool: "workbook.save_copy".to_string(),
                    rationale: None,
                    sheet: None,
                    args: json!({ "outputPath": "/tmp/output.csv" }),
                }],
            })
            .expect("response should return");

        assert!(response.should_continue);
        assert!(response.has_write_actions);
        assert!(response.tool_results.is_empty());

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn execute_read_actions_supports_file_tools_and_blocks_traversal() {
        let workspace_dir =
            env::temp_dir().join(format!("relay-agent-file-tools-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_dir).expect("workspace dir should exist");
        let text_path = workspace_dir.join("notes.txt");
        fs::write(&text_path, "hello\nworld\n").expect("text file should be written");
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "File tools".to_string(),
                objective: "Read supporting text files.".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "File read turn".to_string(),
                objective: "Inspect helper files".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let response = storage
            .execute_read_actions(ExecuteReadActionsRequest {
                session_id: session.id,
                turn_id: turn.id,
                loop_turn: 1,
                max_turns: 10,
                actions: vec![
                    SpreadsheetAction {
                        id: None,
                        tool: "file.list".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({ "path": workspace_dir, "recursive": false }),
                    },
                    SpreadsheetAction {
                        id: None,
                        tool: "file.read_text".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({ "path": text_path, "maxBytes": 1024 }),
                    },
                    SpreadsheetAction {
                        id: None,
                        tool: "file.stat".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({ "path": text_path }),
                    },
                    SpreadsheetAction {
                        id: None,
                        tool: "file.stat".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({
                            "path": workspace_dir.join("nested").join("..").join("notes.txt")
                        }),
                    },
                ],
            })
            .expect("file tool response should return");

        assert_eq!(response.tool_results.len(), 4);
        assert!(response.tool_results[0].ok);
        assert!(response.tool_results[1].ok);
        assert!(response.tool_results[2].ok);
        assert!(!response.tool_results[3].ok);
        assert!(response.tool_results[3]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("traversal"));

        fs::remove_dir_all(workspace_dir).expect("workspace dir should clean up");
    }

    #[test]
    fn execute_read_actions_supports_text_search_and_document_read_text() {
        let workspace_dir =
            env::temp_dir().join(format!("relay-agent-text-tools-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_dir).expect("workspace dir should exist");
        let text_path = workspace_dir.join("notes.txt");
        fs::write(&text_path, "alpha\nbeta\nalpha beta\n").expect("text file should be written");
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Text tools".to_string(),
                objective: "Search and extract text.".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Text read turn".to_string(),
                objective: "Search helper files".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let response = storage
            .execute_read_actions(ExecuteReadActionsRequest {
                session_id: session.id,
                turn_id: turn.id,
                loop_turn: 1,
                max_turns: 10,
                actions: vec![
                    SpreadsheetAction {
                        id: None,
                        tool: "text.search".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({
                            "path": text_path,
                            "pattern": "alpha",
                            "maxMatches": 10,
                            "contextLines": 1
                        }),
                    },
                    SpreadsheetAction {
                        id: None,
                        tool: "document.read_text".to_string(),
                        rationale: None,
                        sheet: None,
                        args: json!({ "path": text_path, "maxChars": 500 }),
                    },
                ],
            })
            .expect("text tool response should return");

        assert_eq!(response.tool_results.len(), 2);
        assert!(response.tool_results[0].ok);
        assert!(response.tool_results[1].ok);
        assert_eq!(
            response.tool_results[0]
                .result
                .as_ref()
                .and_then(|value| value.get("matchCount")),
            Some(&json!(2))
        );
        assert_eq!(
            response.tool_results[1]
                .result
                .as_ref()
                .and_then(|value| value.get("format")),
            Some(&json!("txt"))
        );

        fs::remove_dir_all(workspace_dir).expect("workspace dir should clean up");
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
                raw_response: json!({
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
                    ]
                })
                .to_string(),
            })
            .expect("response should parse");

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
    fn run_execution_multi_uses_requested_output_specs_without_creating_default_output() {
        let csv_path =
            write_test_csv("customer_id,amount,approved\n1,42.5,true\n2,13.0,false\n3,77.0,true\n");
        let default_output_path = env::temp_dir()
            .join(format!("relay-agent-multi-default-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let json_output_path = env::temp_dir()
            .join(format!("relay-agent-multi-{}.json", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let text_output_path = env::temp_dir()
            .join(format!("relay-agent-multi-{}.txt", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();

        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Multi output".to_string(),
                objective: "Filter approved rows and emit JSON plus text".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().into_owned()),
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "JSON and text outputs".to_string(),
                objective: "Generate multiple artifact outputs".to_string(),
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
                raw_response: copilot_response(
                    "Filter approved rows and prepare multiple outputs.",
                    vec![
                        json!({
                            "tool": "table.filter_rows",
                            "sheet": "Sheet1",
                            "args": {
                                "predicate": "approved = true"
                            }
                        }),
                        json!({
                            "tool": "workbook.save_copy",
                            "args": {
                                "outputPath": default_output_path.clone()
                            }
                        }),
                    ],
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
                note: None,
            })
            .expect("approval should succeed");

        let results = storage
            .run_execution_multi(RunExecutionMultiRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                output_specs: vec![
                    OutputSpec {
                        format: OutputFormat::Json,
                        output_path: json_output_path.clone(),
                    },
                    OutputSpec {
                        format: OutputFormat::Text,
                        output_path: text_output_path.clone(),
                    },
                ],
            })
            .expect("multi-output execution should succeed");

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|result| result.executed));
        assert!(!Path::new(&default_output_path).exists());

        let json_output: Vec<Value> =
            read_json(Path::new(&json_output_path)).expect("json output should parse");
        assert_eq!(json_output.len(), 2);
        assert_eq!(json_output[0]["customer_id"], "1");
        assert_eq!(json_output[1]["customer_id"], "3");

        let text_output =
            fs::read_to_string(&text_output_path).expect("text report should be readable");
        assert!(text_output.contains("Rows: 2"));
        assert!(text_output.contains("customer_id, amount, approved"));

        fs::remove_file(csv_path).expect("source csv should clean up");
        fs::remove_file(json_output_path).expect("json output should clean up");
        fs::remove_file(text_output_path).expect("text output should clean up");
    }

    #[test]
    fn file_read_text_rejects_files_larger_than_one_megabyte() {
        let large_path =
            env::temp_dir().join(format!("relay-agent-large-file-{}.txt", Uuid::new_v4()));
        fs::write(&large_path, vec![b'a'; 1_048_577]).expect("large file should be written");
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Large file".to_string(),
                objective: "Reject oversized reads.".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should be created");
        let turn = storage
            .start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Large file turn".to_string(),
                objective: "Read size guard".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;

        let response = storage
            .execute_read_actions(ExecuteReadActionsRequest {
                session_id: session.id,
                turn_id: turn.id,
                loop_turn: 1,
                max_turns: 10,
                actions: vec![SpreadsheetAction {
                    id: None,
                    tool: "file.read_text".to_string(),
                    rationale: None,
                    sheet: None,
                    args: json!({ "path": large_path, "maxBytes": 1024 }),
                }],
            })
            .expect("oversized read should still return a tool result");

        assert_eq!(response.tool_results.len(), 1);
        assert!(!response.tool_results[0].ok);
        assert!(response.tool_results[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("1MB"));

        fs::remove_file(large_path).expect("large file should clean up");
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
        storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("relay packet should be created");

        let response = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: copilot_response(
                    "Prepare a save-copy output.",
                    vec![
                        json!({
                            "tool": "table.filter_rows",
                            "sheet": "Sheet1",
                            "args": {
                                "predicate": "[approved] == true",
                                "outputSheet": "ApprovedRows"
                            }
                        }),
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
                        })
                    ],
                ),
            })
            .expect("response should be accepted");

        assert!(response.accepted);
        assert_eq!(response.auto_learned_memory.len(), 5);
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
        assert_eq!(
            response.auto_learned_memory[4].key,
            "preferred_output_sheet"
        );
        assert_eq!(response.auto_learned_memory[4].value, "ApprovedRows");

        let project = storage
            .read_project(ReadProjectRequest {
                project_id: project.id,
            })
            .expect("project should be readable");
        assert_eq!(project.memory.len(), 5);
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
        storage
            .generate_relay_packet(GenerateRelayPacketRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
            })
            .expect("relay packet should be created");

        let response = storage
            .submit_copilot_response(SubmitCopilotResponseRequest {
                session_id: session.id.clone(),
                turn_id: turn.id.clone(),
                raw_response: json!({
                    "version": "1.0",
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
            })
            .expect("response should be accepted");

        assert!(response.accepted);
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
            "summary": summary,
            "actions": actions,
            "followUpQuestions": [],
            "warnings": []
        })
        .to_string()
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
