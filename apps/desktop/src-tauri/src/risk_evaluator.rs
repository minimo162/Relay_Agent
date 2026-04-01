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
        "file.list"
        | "file.stat"
        | "workbook.inspect"
        | "sheet.preview"
        | "sheet.profile_columns"
        | "session.diff_from_base" => OperationRisk::Readonly,
        "table.rename_columns" | "table.filter_rows" => OperationRisk::Low,
        "table.cast_columns"
        | "table.derive_column"
        | "table.group_aggregate"
        | "workbook.save_copy"
        | "file.copy" => OperationRisk::Medium,
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
        assert!(should_auto_approve(ApprovalPolicy::Standard, OperationRisk::Low));
        assert!(!should_auto_approve(
            ApprovalPolicy::Standard,
            OperationRisk::Medium
        ));
    }

    #[test]
    fn evaluate_risk_maps_unknown_tools_to_medium() {
        assert_eq!(evaluate_risk("unknown.tool", &json!({})), OperationRisk::Medium);
    }
}
