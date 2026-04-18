use runtime::{PermissionMode, PermissionPolicy};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionToolPermissionRow {
    pub(crate) name: String,
    pub(crate) host_mode: PermissionMode,
    pub(crate) required_mode: PermissionMode,
    pub(crate) requirement: &'static str,
    pub(crate) reason: String,
}

pub(crate) fn desktop_permission_policy() -> PermissionPolicy {
    let mut policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite);
    for spec in tools::mvp_tool_specs() {
        let required = tools::required_permission_for_surface(&spec);
        policy = policy.with_tool_requirement(spec.name, required);
    }
    policy
}

fn describe_permission_reason(
    tool: &str,
    host: PermissionMode,
    required: PermissionMode,
    requirement: &str,
) -> String {
    match requirement {
        "auto_allow" => format!(
            "{tool} is allowed because host mode ({}) satisfies required mode ({}).",
            host.as_str(),
            required.as_str()
        ),
        "require_approval" => format!(
            "{tool} requires approval to escalate from host mode ({}) to required mode ({}).",
            host.as_str(),
            required.as_str()
        ),
        _ => format!(
            "{tool} is blocked because required mode ({}) exceeds host mode ({}).",
            required.as_str(),
            host.as_str()
        ),
    }
}

fn classify_permission_ui_requirement(
    host: PermissionMode,
    required: PermissionMode,
) -> &'static str {
    if host == PermissionMode::Allow || host >= required {
        return "auto_allow";
    }
    if host == PermissionMode::WorkspaceWrite && required == PermissionMode::DangerFullAccess {
        return "require_approval";
    }
    if host == PermissionMode::Prompt {
        return "require_approval";
    }
    "auto_deny"
}

pub(crate) fn tool_permissions() -> Vec<SessionToolPermissionRow> {
    let policy = desktop_permission_policy();
    let host = policy.active_mode();
    tools::mvp_tool_specs()
        .into_iter()
        .map(|spec| {
            let required = policy.required_mode_for(spec.name);
            let requirement = classify_permission_ui_requirement(host, required);
            let reason = describe_permission_reason(spec.name, host, required, requirement);
            SessionToolPermissionRow {
                name: spec.name.to_string(),
                host_mode: host,
                required_mode: required,
                requirement,
                reason,
            }
        })
        .collect()
}
