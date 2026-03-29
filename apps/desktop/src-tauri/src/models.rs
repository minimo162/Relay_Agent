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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub id: String,
    pub title: String,
    pub description: String,
    pub phase: ToolPhase,
    pub requires_approval: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPacketResponseContract {
    pub format: &'static str,
    pub expects_actions: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: Vec<Value>,
    pub message: String,
    pub code: String,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotTurnResponse {
    pub version: String,
    pub summary: String,
    pub actions: Vec<SpreadsheetAction>,
    pub follow_up_questions: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDiff {
    pub sheet: String,
    pub estimated_rows: u32,
    pub added_columns: Vec<String>,
    pub changed_columns: Vec<String>,
    pub removed_columns: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub source_path: String,
    pub output_path: String,
    pub mode: String,
    pub sheets: Vec<SheetDiff>,
    pub warnings: Vec<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub objective: String,
    pub primary_workbook_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionRequest {
    pub session_id: String,
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
pub struct PreviewExecutionRequest {
    pub session_id: String,
    pub turn_id: String,
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
pub struct RunExecutionRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: Session,
    pub turns: Vec<Turn>,
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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewExecutionResponse {
    pub turn: Turn,
    pub ready: bool,
    pub requires_approval: bool,
    pub can_execute: bool,
    pub diff_summary: DiffSummary,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondToApprovalResponse {
    pub turn: Turn,
    pub decision: ApprovalDecision,
    pub ready_for_execution: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExecutionResponse {
    pub turn: Turn,
    pub executed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
