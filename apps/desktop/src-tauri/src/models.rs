use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RelayMode {
    Discover,
    Plan,
    Repair,
    Followup,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Draft,
    Active,
    Archived,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum TurnStatus {
    Draft,
    PacketReady,
    AwaitingResponse,
    Validated,
    PreviewReady,
    Approved,
    Executed,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ToolPhase {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ToolSource {
    Builtin,
    Mcp,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkbookFormat {
    Csv,
    Xlsx,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ColumnType {
    String,
    Number,
    Integer,
    Boolean,
    Date,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Approved,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ScopeApprovalSource {
    Manual,
    AgentLoop,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CopilotHandoffStatus {
    Clear,
    Caution,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CopilotHandoffReasonSource {
    Path,
    Column,
    Objective,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectMemorySource {
    User,
    Auto,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryEntry {
    pub key: String,
    pub value: String,
    pub learned_at: String,
    pub source: ProjectMemorySource,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_folder: String,
    pub custom_instructions: String,
    pub memory: Vec<ProjectMemoryEntry>,
    pub session_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub status: SessionStatus,
    pub primary_workbook_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub latest_turn_id: Option<String>,
    pub turn_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub objective: String,
    pub mode: RelayMode,
    pub status: TurnStatus,
    pub created_at: String,
    pub updated_at: String,
    pub item_ids: Vec<String>,
    pub validation_error_count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub id: String,
    pub title: String,
    pub description: String,
    pub phase: ToolPhase,
    pub requires_approval: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRegistration {
    pub id: String,
    pub title: String,
    pub description: String,
    pub phase: ToolPhase,
    pub requires_approval: bool,
    pub source: ToolSource,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_transport: Option<McpTransport>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSettings {
    pub disabled_tool_ids: Vec<String>,
    pub mcp_servers: Vec<McpServerConfig>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPacketResponseContract {
    pub format: &'static str,
    pub expects_actions: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPacket {
    pub version: &'static str,
    pub session_id: String,
    pub turn_id: String,
    pub mode: RelayMode,
    pub objective: String,
    pub context: Vec<String>,
    pub allowed_read_tools: Vec<ToolDescriptor>,
    pub allowed_write_tools: Vec<ToolDescriptor>,
    pub response_contract: RelayPacketResponseContract,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: Vec<Value>,
    pub message: String,
    pub code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetAction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotTurnResponse {
    pub version: String,
    pub status: AgentLoopStatus,
    pub summary: String,
    pub actions: Vec<SpreadsheetAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_plan: Option<ExecutionPlan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub follow_up_questions: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentLoopStatus {
    Thinking,
    ReadyToWrite,
    Done,
    Error,
    PlanProposed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepPhase {
    Read,
    Write,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub tool: String,
    pub description: String,
    pub phase: PlanStepPhase,
    #[serde(default)]
    pub args: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_effect: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    pub summary: String,
    pub total_estimated_steps: u32,
    pub steps: Vec<PlanStep>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTarget {
    pub kind: PreviewTargetKind,
    pub sheet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    pub label: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewTargetKind {
    Sheet,
    Table,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RowDiffKind {
    Changed,
    Added,
    Removed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDiffSample {
    pub kind: RowDiffKind,
    pub row_number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDiff {
    pub target: PreviewTarget,
    pub estimated_affected_rows: u32,
    pub added_columns: Vec<String>,
    pub changed_columns: Vec<String>,
    pub removed_columns: Vec<String>,
    pub row_samples: Vec<RowDiffSample>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub source_path: String,
    pub output_path: String,
    pub mode: String,
    pub target_count: u32,
    pub estimated_affected_rows: u32,
    pub sheets: Vec<SheetDiff>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactType {
    SpreadsheetDiff,
    FileOperation,
    TextDiff,
    TextExtraction,
    CsvTable,
    RawText,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputArtifact {
    pub id: String,
    pub r#type: ArtifactType,
    pub label: String,
    pub source_path: String,
    pub output_path: String,
    pub warnings: Vec<String>,
    pub content: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheck {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckResult {
    pub passed: bool,
    pub checks: Vec<QualityCheck>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Csv,
    Xlsx,
    Text,
    Json,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub format: OutputFormat,
    pub output_path: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSheet {
    pub name: String,
    pub row_count: u32,
    pub column_count: u32,
    pub columns: Vec<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookProfile {
    pub source_path: String,
    pub format: WorkbookFormat,
    pub sheet_count: u32,
    pub sheets: Vec<WorkbookSheet>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewArtifactPayload {
    pub diff_summary: DiffSummary,
    pub requires_approval: bool,
    pub warnings: Vec<String>,
    pub file_write_actions: Vec<SpreadsheetAction>,
    #[serde(default)]
    pub artifacts: Vec<OutputArtifact>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TurnInspectionSourceType {
    Live,
    Persisted,
    Mixed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TurnInspectionUnavailableReason {
    NotGeneratedYet,
    StepNotReached,
    TemporaryLiveOnly,
    NotSupportedForTurnVersion,
    GenerationFailed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TurnOverviewStepState {
    Complete,
    Current,
    Pending,
    Failed,
    NotRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionInspectionState {
    NotRun,
    Completed,
    Failed,
    NotRequired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOverviewStep {
    pub id: String,
    pub label: String,
    pub state: TurnOverviewStepState,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOverview {
    pub turn_status: TurnStatus,
    pub relay_mode: RelayMode,
    pub storage_mode: &'static str,
    pub current_stage_label: String,
    pub summary: String,
    pub guardrail_summary: String,
    pub steps: Vec<TurnOverviewStep>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketInspectionPayload {
    pub session_title: String,
    pub turn_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    pub relay_mode: RelayMode,
    pub objective: String,
    pub context_lines: Vec<String>,
    pub allowed_read_tool_count: usize,
    pub allowed_write_tool_count: usize,
    pub response_notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssueSummary {
    pub path: String,
    pub message: String,
    pub code: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationInspectionPayload {
    pub accepted: bool,
    pub can_preview: bool,
    pub issue_count: usize,
    pub warning_count: usize,
    pub headline: String,
    pub primary_reason: String,
    pub issues: Vec<ValidationIssueSummary>,
    pub repair_prompt_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_preview_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeOverrideInspectionRecord {
    pub decision: ApprovalDecision,
    pub decided_at: String,
    pub root_folder: String,
    pub violations: Vec<String>,
    pub source: ScopeApprovalSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalInspectionPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<ApprovalDecision>,
    pub ready_for_execution: bool,
    pub requires_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_override: Option<ScopeOverrideInspectionRecord>,
    pub original_file_guardrail: String,
    pub save_copy_guardrail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temporary_mode_note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionInspectionPayload {
    pub state: ExecutionInspectionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_at: Option<String>,
    pub warning_count: usize,
    pub reason_summary: String,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInspectionSection<T: Serialize> {
    pub available: bool,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<TurnInspectionSourceType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<TurnInspectionUnavailableReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<T>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDetailsViewModel {
    pub overview: TurnOverview,
    pub packet: TurnInspectionSection<PacketInspectionPayload>,
    pub validation: TurnInspectionSection<ValidationInspectionPayload>,
    pub approval: TurnInspectionSection<ApprovalInspectionPayload>,
    pub execution: TurnInspectionSection<ExecutionInspectionPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub objective: String,
    pub primary_workbook_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub root_folder: String,
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectRequest {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub project_id: String,
    pub name: Option<String>,
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectMemoryRequest {
    pub project_id: String,
    pub key: String,
    pub value: String,
    pub source: Option<ProjectMemorySource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectMemoryRequest {
    pub project_id: String,
    pub key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSessionToProjectRequest {
    pub project_id: String,
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionProjectRequest {
    pub session_id: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetToolEnabledRequest {
    pub tool_id: String,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Sse,
    Stdio,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub url: String,
    pub name: String,
    pub transport: McpTransport,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationSettings {
    pub cdp_port: u16,
    pub auto_launch_edge: bool,
    pub timeout_ms: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsResponse {
    pub projects: Vec<Project>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListToolsResponse {
    pub tools: Vec<ToolRegistration>,
    pub restore_warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCopilotPromptRequest {
    pub prompt: String,
    pub settings: BrowserAutomationSettings,
    pub progress_event_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCopilotConnectionRequest {
    pub settings: BrowserAutomationSettings,
    pub progress_event_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CopilotBrowserErrorCode {
    CdpUnavailable,
    NotLoggedIn,
    ResponseTimeout,
    CopilotError,
    SendFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum CopilotBrowserResult {
    #[serde(rename = "ok")]
    Ok {
        response: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cdp_port: Option<u16>,
    },
    #[serde(rename = "error")]
    Error {
        error_code: CopilotBrowserErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cdp_port: Option<u16>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum CopilotConnectResult {
    #[serde(rename = "ready")]
    Ready { cdp_port: u16 },
    #[serde(rename = "error")]
    Error {
        error_code: CopilotBrowserErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cdp_port: Option<u16>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotBrowserProgressEvent {
    pub request_id: String,
    pub step: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectMcpServerResponse {
    pub registered_tool_ids: Vec<String>,
    pub tools: Vec<ToolRegistration>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeMcpToolRequest {
    pub tool_id: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeMcpToolResponse {
    pub tool_id: String,
    pub result: Value,
    pub source: ToolSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTurnArtifactsRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTurnRequest {
    pub session_id: String,
    pub title: String,
    pub objective: String,
    pub mode: RelayMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRelayPacketRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitCopilotResponseRequest {
    pub session_id: String,
    pub turn_id: String,
    pub raw_response: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessCopilotHandoffRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewExecutionRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateOutputQualityRequest {
    pub source_path: String,
    pub output_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteReadActionsRequest {
    pub session_id: String,
    pub turn_id: String,
    pub loop_turn: u32,
    pub max_turns: u32,
    pub actions: Vec<SpreadsheetAction>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondToApprovalRequest {
    pub session_id: String,
    pub turn_id: String,
    pub decision: ApprovalDecision,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordScopeApprovalRequest {
    pub session_id: String,
    pub turn_id: String,
    pub decision: ApprovalDecision,
    pub root_folder: String,
    pub violations: Vec<String>,
    pub source: ScopeApprovalSource,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExecutionRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExecutionMultiRequest {
    pub session_id: String,
    pub turn_id: String,
    pub output_specs: Vec<OutputSpec>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStepStatus {
    pub step_id: String,
    pub state: PlanStepState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepState {
    Pending,
    Running,
    Completed,
    Skipped,
    Failed,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovePlanRequest {
    pub session_id: String,
    pub turn_id: String,
    pub approved_step_ids: Vec<String>,
    pub modified_steps: Vec<PlanStep>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProgressRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPlanProgressRequest {
    pub session_id: String,
    pub turn_id: String,
    pub current_step_id: Option<String>,
    pub completed_count: u32,
    pub total_count: u32,
    pub step_statuses: Vec<PlanStepStatus>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: Session,
    pub turns: Vec<Turn>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "artifactType", rename_all = "kebab-case")]
pub enum TurnArtifactRecord {
    WorkbookProfile {
        artifact_id: String,
        created_at: String,
        payload: WorkbookProfile,
    },
    SheetPreview {
        artifact_id: String,
        created_at: String,
        payload: crate::workbook::SheetPreview,
    },
    ColumnProfile {
        artifact_id: String,
        created_at: String,
        payload: crate::workbook::SheetColumnProfile,
    },
    DiffSummary {
        artifact_id: String,
        created_at: String,
        payload: DiffSummary,
    },
    Preview {
        artifact_id: String,
        created_at: String,
        payload: PreviewArtifactPayload,
    },
    ScopeApproval {
        artifact_id: String,
        created_at: String,
        payload: ScopeApprovalArtifactPayload,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTurnArtifactsResponse {
    pub turn: Turn,
    pub storage_mode: &'static str,
    pub artifacts: Vec<TurnArtifactRecord>,
    pub turn_details: TurnDetailsViewModel,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTurnResponse {
    pub session: Session,
    pub turn: Turn,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitCopilotResponseResponse {
    pub turn: Turn,
    pub accepted: bool,
    pub validation_issues: Vec<ValidationIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_response: Option<CopilotTurnResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repair_prompt: Option<String>,
    pub auto_learned_memory: Vec<ProjectMemoryEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotHandoffReason {
    pub source: CopilotHandoffReasonSource,
    pub label: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessCopilotHandoffResponse {
    pub status: CopilotHandoffStatus,
    pub headline: String,
    pub summary: String,
    pub reasons: Vec<CopilotHandoffReason>,
    pub suggested_actions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_context: Option<PlanningContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningContextToolGroups {
    pub read: Vec<String>,
    pub write: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningContext {
    pub workbook_summary: String,
    pub available_tools: PlanningContextToolGroups,
    pub suggested_approach: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewExecutionResponse {
    pub turn: Turn,
    pub ready: bool,
    pub requires_approval: bool,
    pub can_execute: bool,
    pub diff_summary: DiffSummary,
    pub artifacts: Vec<OutputArtifact>,
    pub warnings: Vec<String>,
    pub file_write_actions: Vec<SpreadsheetAction>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondToApprovalResponse {
    pub turn: Turn,
    pub decision: ApprovalDecision,
    pub ready_for_execution: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeApprovalArtifactPayload {
    pub decision: ApprovalDecision,
    pub root_folder: String,
    pub violations: Vec<String>,
    pub source: ScopeApprovalSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordScopeApprovalResponse {
    pub turn: Turn,
    pub decision: ApprovalDecision,
    pub recorded_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovePlanResponse {
    pub approved: bool,
    pub plan: ExecutionPlan,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    pub tool: String,
    pub args: Value,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteReadActionsResponse {
    pub should_continue: bool,
    pub tool_results: Vec<ToolExecutionResult>,
    pub has_write_actions: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProgressResponse {
    pub current_step_id: Option<String>,
    pub completed_count: u32,
    pub total_count: u32,
    pub step_statuses: Vec<PlanStepStatus>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExecutionResponse {
    pub turn: Turn,
    pub executed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub output_paths: Vec<String>,
    pub artifacts: Vec<OutputArtifact>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
