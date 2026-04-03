use crate::{
    models::DiffSummary,
    risk_evaluator::{ApprovalPolicy, OperationRisk},
};

#[derive(Clone, Debug)]
pub(crate) struct StoredPreview {
    pub(crate) diff_summary: DiffSummary,
    pub(crate) artifacts: Vec<crate::models::OutputArtifact>,
    pub(crate) requires_approval: bool,
    pub(crate) auto_approved: bool,
    pub(crate) highest_risk: OperationRisk,
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) warnings: Vec<String>,
    pub(crate) created_at: String,
    pub(crate) artifact_id: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct StoredExecution {
    pub(crate) executed: bool,
    pub(crate) output_path: Option<String>,
    pub(crate) output_paths: Vec<String>,
    pub(crate) artifacts: Vec<crate::models::OutputArtifact>,
    pub(crate) warnings: Vec<String>,
    pub(crate) reason: Option<String>,
    pub(crate) created_at: String,
    pub(crate) artifact_id: String,
}
