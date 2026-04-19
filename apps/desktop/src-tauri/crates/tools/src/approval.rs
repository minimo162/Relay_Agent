use serde_json::{json, Value};

use crate::{
    tool_spec, ApprovalTargetExtractor, RedactionRule, ToolApprovalDisplay, ToolSpec,
};

#[must_use]
pub fn approval_display_for_tool(tool_name: &str, input: &str) -> ToolApprovalDisplay {
    let input_json: Value = serde_json::from_str(input).unwrap_or_else(|_| json!({}));
    if let Some((_, integration, tool)) = parse_mcp_qualified_name(tool_name) {
        let display_tool = humanize_mcp_segment(tool);
        let display_integration = humanize_mcp_segment(integration);
        return ToolApprovalDisplay {
            approval_title: format!("Call MCP integration tool “{display_tool}”?"),
            approval_target_hint: Some(format!("mcp__{display_integration}__{display_tool}")),
            important_args: summarize_important_args(
                &input_json,
                &["arguments", "server", "serverName"],
                &[RedactionRule { field: "arguments" }],
            ),
        };
    }

    let spec = tool_spec(tool_name);
    let title = spec
        .and_then(ToolSpec::approval_title)
        .map_or_else(|| format!("Allow “{tool_name}”?"), ToString::to_string);
    let target = extract_approval_target(
        tool_name,
        &input_json,
        spec.map_or(ApprovalTargetExtractor::None, ToolSpec::target_extractor),
    );
    let important_args = summarize_important_args(
        &input_json,
        spec.map_or(&[], ToolSpec::risky_fields),
        spec.map_or(&[], ToolSpec::redaction_rules),
    );
    ToolApprovalDisplay {
        approval_title: title,
        approval_target_hint: target,
        important_args,
    }
}

fn extract_approval_target(
    tool_name: &str,
    input: &Value,
    extractor: ApprovalTargetExtractor,
) -> Option<String> {
    match extractor {
        ApprovalTargetExtractor::None => None,
        ApprovalTargetExtractor::PathLike => input
            .get("path")
            .or_else(|| input.get("file_path"))
            .or_else(|| input.get("notebook_path"))
            .or_else(|| input.get("input_path"))
            .or_else(|| input.get("output_path"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        ApprovalTargetExtractor::UrlLike => input
            .get("url")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        ApprovalTargetExtractor::CliRun => {
            let cli = input.get("cli").and_then(Value::as_str).unwrap_or("(cli)");
            let cwd = input
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or("(workspace)");
            Some(format!("{cli} @ {cwd}"))
        }
        ApprovalTargetExtractor::ElectronApp => input
            .get("app")
            .and_then(Value::as_str)
            .map(|app| format!("Electron app: {app}")),
        ApprovalTargetExtractor::McpQualifiedTool => input
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| Some(tool_name).filter(|name| name.starts_with("mcp__")))
            .map(ToString::to_string),
    }
}

fn summarize_important_args(
    input: &Value,
    risky_fields: &[&str],
    redactions: &[RedactionRule],
) -> Vec<String> {
    let mut summaries = Vec::new();
    for field in risky_fields {
        if let Some(value) = input.get(field) {
            let redact = redactions.iter().any(|rule| rule.field == *field);
            let rendered = if redact {
                "<redacted>".to_string()
            } else {
                summarize_value(value)
            };
            summaries.push(format!("{field}={rendered}"));
        }
    }
    summaries
}

fn summarize_value(value: &Value) -> String {
    match value {
        Value::String(s) => {
            let mut preview: String = s.chars().take(96).collect();
            if s.chars().count() > 96 {
                preview.push('…');
            }
            preview
        }
        Value::Array(items) => {
            if items.is_empty() {
                "[]".to_string()
            } else {
                format!("[{} item(s)]", items.len())
            }
        }
        Value::Object(map) => format!("{{{} key(s)}}", map.len()),
        _ => value.to_string(),
    }
}

fn parse_mcp_qualified_name(name: &str) -> Option<(&str, &str, &str)> {
    if !name.starts_with("mcp__") {
        return None;
    }
    let mut parts = name.splitn(3, "__");
    let prefix = parts.next()?;
    let integration = parts.next()?;
    let tool = parts.next()?;
    if prefix == "mcp" && !integration.is_empty() && !tool.is_empty() {
        Some((prefix, integration, tool))
    } else {
        None
    }
}

fn humanize_mcp_segment(segment: &str) -> String {
    let Some((base, hash)) = segment.rsplit_once('_') else {
        return segment.to_string();
    };
    let hash_len = hash.len();
    if (6..=8).contains(&hash_len) && hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        base.to_string()
    } else {
        segment.to_string()
    }
}
