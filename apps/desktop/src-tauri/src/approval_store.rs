use crate::models::{ApprovalDecision, ScopeApprovalSource};

#[derive(Clone, Debug)]
pub(crate) struct StoredApproval {
    pub(crate) decision: ApprovalDecision,
    pub(crate) note: Option<String>,
    pub(crate) ready_for_execution: bool,
    pub(crate) auto_approved: bool,
    pub(crate) preview_artifact_id: String,
    pub(crate) created_at: String,
    pub(crate) artifact_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StoredScopeApproval {
    pub(crate) decision: ApprovalDecision,
    pub(crate) root_folder: String,
    pub(crate) violations: Vec<String>,
    pub(crate) source: ScopeApprovalSource,
    pub(crate) note: Option<String>,
    pub(crate) response_artifact_id: Option<String>,
    pub(crate) created_at: String,
    pub(crate) artifact_id: String,
}
