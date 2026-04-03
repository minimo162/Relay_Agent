use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OperationRisk {
    Readonly,
    Low,
    Medium,
    High,
    Critical,
}

impl Default for OperationRisk {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalPolicy {
    Safe,
    Standard,
    Fast,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self::Safe
    }
}

impl ApprovalPolicy {
    pub fn auto_approves(self, risk: OperationRisk) -> bool {
        match self {
            Self::Safe => false,
            Self::Standard => matches!(risk, OperationRisk::Readonly | OperationRisk::Low),
            Self::Fast => matches!(
                risk,
                OperationRisk::Readonly | OperationRisk::Low | OperationRisk::Medium
            ),
        }
    }
}

pub fn evaluate_risk(tool_name: &str, _args: &Value) -> OperationRisk {
    match tool_name {
        "file.list" | "file.stat" | "file.read_text" | "text.search" => OperationRisk::Readonly,
        "file.copy" | "text.replace" => OperationRisk::Medium,
        "file.move" => OperationRisk::High,
        "file.delete" => OperationRisk::Critical,
        _ => OperationRisk::Medium,
    }
}

pub fn should_auto_approve(policy: ApprovalPolicy, risk: OperationRisk) -> bool {
    if matches!(risk, OperationRisk::Critical | OperationRisk::High) {
        return false;
    }

    policy.auto_approves(risk)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{evaluate_risk, should_auto_approve, ApprovalPolicy, OperationRisk};

    #[test]
    fn standard_policy_auto_approves_readonly_only() {
        assert!(should_auto_approve(
            ApprovalPolicy::Standard,
            OperationRisk::Readonly
        ));
        assert!(should_auto_approve(
            ApprovalPolicy::Standard,
            OperationRisk::Low
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Standard,
            OperationRisk::Medium
        ));
    }

    #[test]
    fn evaluate_risk_maps_unknown_tools_to_medium() {
        assert_eq!(
            evaluate_risk("unknown.tool", &json!({})),
            OperationRisk::Medium
        );
    }

    #[test]
    fn fast_policy_auto_approves_up_to_medium() {
        assert!(should_auto_approve(
            ApprovalPolicy::Fast,
            OperationRisk::Readonly
        ));
        assert!(should_auto_approve(
            ApprovalPolicy::Fast,
            OperationRisk::Low
        ));
        assert!(should_auto_approve(
            ApprovalPolicy::Fast,
            OperationRisk::Medium
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Fast,
            OperationRisk::High
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Fast,
            OperationRisk::Critical
        ));
    }

    #[test]
    fn safe_policy_never_auto_approves() {
        assert!(!should_auto_approve(
            ApprovalPolicy::Safe,
            OperationRisk::Readonly
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Safe,
            OperationRisk::Low
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Safe,
            OperationRisk::Medium
        ));
        assert!(!should_auto_approve(
            ApprovalPolicy::Safe,
            OperationRisk::Critical
        ));
    }

    #[test]
    fn critical_risk_never_auto_approved_by_any_policy() {
        for policy in [
            ApprovalPolicy::Safe,
            ApprovalPolicy::Standard,
            ApprovalPolicy::Fast,
        ] {
            assert!(
                !should_auto_approve(policy, OperationRisk::Critical),
                "{policy:?} must never auto-approve Critical"
            );
        }
    }

    #[test]
    fn file_delete_evaluates_as_critical() {
        assert_eq!(
            evaluate_risk("file.delete", &serde_json::json!({})),
            OperationRisk::Critical
        );
    }

    #[test]
    fn readonly_tools_evaluate_as_readonly() {
        for tool in ["file.list", "file.stat"] {
            assert_eq!(
                evaluate_risk(tool, &serde_json::json!({})),
                OperationRisk::Readonly,
                "{tool} should map to Readonly"
            );
        }
    }

    #[test]
    fn file_copy_and_move_evaluate_as_expected() {
        assert_eq!(
            evaluate_risk("file.copy", &serde_json::json!({})),
            OperationRisk::Medium
        );
        assert_eq!(
            evaluate_risk("file.move", &serde_json::json!({})),
            OperationRisk::High
        );
    }
}
