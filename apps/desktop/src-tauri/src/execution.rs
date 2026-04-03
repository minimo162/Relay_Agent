use std::{path::PathBuf, sync::Arc};

use claw_permissions::{PermissionMode, RuleBasedPolicy};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::mcp_client::McpClient;
use crate::models::{
    ExecuteClawToolRequest, ExecuteClawToolResponse, InvokeMcpToolRequest, InvokeMcpToolResponse,
    ListToolsResponse, McpServerConfig, PreviewExecutionRequest, PreviewExecutionResponse,
    RecordScopeApprovalRequest, RecordScopeApprovalResponse, RecordStructuredResponseRequest,
    RecordStructuredResponseResponse, RespondToApprovalRequest, RespondToApprovalResponse,
    RunExecutionRequest, RunExecutionResponse, SetToolEnabledRequest, ToolRegistration, ToolSource,
    ValidateOutputQualityRequest,
};
use crate::risk_evaluator::ApprovalPolicy;
use crate::state::DesktopState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetApprovalPolicyRequest {
    pub policy: ApprovalPolicy,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicyConfig {
    pub policy: ApprovalPolicy,
    pub updated_at: String,
}

#[tauri::command]
pub fn list_tools(state: State<'_, DesktopState>) -> Result<ListToolsResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    Ok(storage.list_tools())
}

#[tauri::command]
pub fn set_tool_enabled(
    state: State<'_, DesktopState>,
    request: SetToolEnabledRequest,
) -> Result<crate::models::ToolRegistration, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.set_tool_enabled(request)
}

#[tauri::command]
pub async fn execute_claw_tool(
    state: State<'_, DesktopState>,
    request: ExecuteClawToolRequest,
) -> Result<ExecuteClawToolResponse, String> {
    execute_claw_tool_with_registry(Arc::clone(&state.claw_tool_registry), request).await
}

#[tauri::command]
pub async fn connect_mcp_server(
    state: State<'_, DesktopState>,
    request: McpServerConfig,
) -> Result<crate::models::ConnectMcpServerResponse, String> {
    let client = McpClient::new(request.clone());
    let tools = client.list_tools().await?;
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.register_mcp_tools(request, tools)
}

#[tauri::command]
pub async fn invoke_mcp_tool(
    state: State<'_, DesktopState>,
    request: InvokeMcpToolRequest,
) -> Result<InvokeMcpToolResponse, String> {
    let registration = {
        let storage = state.storage.lock().expect("desktop storage poisoned");
        storage
            .list_tools()
            .tools
            .into_iter()
            .find(|tool| tool.id == request.tool_id)
            .ok_or_else(|| format!("unknown tool: {}", request.tool_id))?
    };

    let (server_url, transport, tool_name) =
        resolve_mcp_invocation_parts(&registration, &request.tool_id)?;
    let client = McpClient::new(McpServerConfig {
        url: server_url,
        name: String::new(),
        transport,
    });
    let result = client.call_tool(&tool_name, &request.args).await?;

    Ok(InvokeMcpToolResponse {
        tool_id: request.tool_id,
        result,
        source: ToolSource::Mcp,
    })
}

pub(crate) fn parse_mcp_tool_name(tool_id: &str) -> Result<String, String> {
    let parts = tool_id.splitn(3, '.').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != "mcp" {
        return Err(format!(
            "invalid MCP tool_id '{}': expected format 'mcp.{{server}}.{{tool}}'",
            tool_id
        ));
    }

    Ok(parts[2].to_string())
}

fn resolve_mcp_invocation_parts(
    registration: &ToolRegistration,
    tool_id: &str,
) -> Result<(String, crate::models::McpTransport, String), String> {
    if !registration.enabled {
        return Err(format!("tool `{tool_id}` is disabled"));
    }

    if registration.source != ToolSource::Mcp {
        return Err(format!("tool `{tool_id}` is not an MCP tool"));
    }

    let server_url = registration
        .mcp_server_url
        .clone()
        .ok_or_else(|| format!("tool `{tool_id}` is missing its MCP server URL"))?;
    let transport = registration
        .mcp_transport
        .unwrap_or(crate::models::McpTransport::Sse);
    let tool_name = parse_mcp_tool_name(tool_id)?;

    Ok((server_url, transport, tool_name))
}

async fn execute_claw_tool_with_registry(
    registry: Arc<claw_tools::ToolRegistry>,
    request: ExecuteClawToolRequest,
) -> Result<ExecuteClawToolResponse, String> {
    let tool = registry
        .get(&request.tool_name)
        .cloned()
        .ok_or_else(|| format!("unknown claw tool: {}", request.tool_name))?;
    let cwd = resolve_claw_tool_cwd(request.cwd)?;
    let output = tool
        .execute(
            &claw_tools::ToolContext {
                cwd,
                permissions: Arc::new(RuleBasedPolicy::new(PermissionMode::AutoApprove)),
                session_id: "tauri-command".to_string(),
            },
            request.input,
        )
        .await
        .map_err(|error| format!("claw tool execution failed: {error}"))?;

    Ok(ExecuteClawToolResponse {
        tool_name: request.tool_name,
        content: output.content,
        is_error: output.is_error,
        metadata: output.metadata,
    })
}

fn resolve_claw_tool_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    match cwd {
        Some(path) if !path.trim().is_empty() => Ok(PathBuf::from(path)),
        Some(_) => Err("cwd must not be empty when provided".to_string()),
        None => std::env::current_dir().map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub fn preview_execution(
    state: State<'_, DesktopState>,
    request: PreviewExecutionRequest,
) -> Result<PreviewExecutionResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    let approval_policy = *state
        .approval_policy
        .lock()
        .expect("approval policy poisoned");
    storage.preview_execution_with_policy(request, approval_policy)
}

#[tauri::command]
pub fn record_structured_response(
    state: State<'_, DesktopState>,
    request: RecordStructuredResponseRequest,
) -> Result<RecordStructuredResponseResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_structured_response(request)
}

#[tauri::command]
pub fn respond_to_approval(
    state: State<'_, DesktopState>,
    request: RespondToApprovalRequest,
) -> Result<RespondToApprovalResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.respond_to_approval(request)
}

#[tauri::command]
pub fn record_scope_approval(
    state: State<'_, DesktopState>,
    request: RecordScopeApprovalRequest,
) -> Result<RecordScopeApprovalResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_scope_approval(request)
}

#[tauri::command]
pub fn run_execution(
    state: State<'_, DesktopState>,
    request: RunExecutionRequest,
) -> Result<RunExecutionResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.run_execution(request)
}

#[tauri::command]
pub fn validate_output_quality(
    request: ValidateOutputQualityRequest,
) -> Result<crate::models::QualityCheckResult, String> {
    crate::quality_validator::validate_output_quality(&request.source_path, &request.output_path)
}

#[tauri::command]
pub fn get_approval_policy(state: State<'_, DesktopState>) -> ApprovalPolicyConfig {
    let policy = *state
        .approval_policy
        .lock()
        .expect("approval policy poisoned");
    ApprovalPolicyConfig {
        policy,
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[tauri::command]
pub fn set_approval_policy(
    state: State<'_, DesktopState>,
    request: SetApprovalPolicyRequest,
) -> ApprovalPolicyConfig {
    let mut approval_policy = state
        .approval_policy
        .lock()
        .expect("approval policy poisoned");
    *approval_policy = request.policy;
    ApprovalPolicyConfig {
        policy: *approval_policy,
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::{
        execute_claw_tool_with_registry, parse_mcp_tool_name, resolve_claw_tool_cwd,
        resolve_mcp_invocation_parts,
    };
    use crate::models::{McpTransport, ToolPhase, ToolRegistration, ToolSource};
    use crate::state::DesktopState;
    use serde_json::json;

    #[test]
    fn parse_mcp_tool_name_accepts_expected_format() {
        assert_eq!(
            parse_mcp_tool_name("mcp.demo.echo").expect("tool id should parse"),
            "echo"
        );
    }

    #[test]
    fn parse_mcp_tool_name_rejects_invalid_format() {
        let error = parse_mcp_tool_name("demo.echo").expect_err("tool id should be rejected");
        assert!(error.contains("invalid MCP tool_id"));
    }

    #[test]
    fn resolve_claw_tool_cwd_rejects_blank_value() {
        let error = resolve_claw_tool_cwd(Some("  ".to_string())).expect_err("blank cwd");
        assert!(error.contains("cwd must not be empty"));
    }

    #[test]
    fn resolve_mcp_invocation_parts_rejects_disabled_tools() {
        let error = resolve_mcp_invocation_parts(
            &ToolRegistration {
                id: "mcp.demo.echo".to_string(),
                title: "echo".to_string(),
                description: "echo".to_string(),
                phase: ToolPhase::Write,
                requires_approval: true,
                source: ToolSource::Mcp,
                enabled: false,
                parameter_schema: None,
                mcp_server_url: Some("http://localhost:3100/mcp".to_string()),
                mcp_transport: Some(McpTransport::Sse),
            },
            "mcp.demo.echo",
        )
        .expect_err("disabled tool should be rejected");

        assert!(error.contains("disabled"));
    }

    #[test]
    fn resolve_mcp_invocation_parts_rejects_invalid_tool_ids() {
        let error = resolve_mcp_invocation_parts(
            &ToolRegistration {
                id: "bad-id".to_string(),
                title: "echo".to_string(),
                description: "echo".to_string(),
                phase: ToolPhase::Write,
                requires_approval: true,
                source: ToolSource::Mcp,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: Some("http://localhost:3100/mcp".to_string()),
                mcp_transport: Some(McpTransport::Sse),
            },
            "bad-id",
        )
        .expect_err("invalid tool id should be rejected");

        assert!(error.contains("invalid MCP tool_id"));
    }

    #[tokio::test]
    async fn execute_claw_tool_reads_file_from_registered_builtin_registry() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let file_path = temp_dir.path().join("sample.txt");
        std::fs::write(&file_path, "alpha\nbeta\n").expect("sample file should be written");

        let state = DesktopState::default();
        let response = execute_claw_tool_with_registry(
            state.claw_tool_registry,
            crate::models::ExecuteClawToolRequest {
                tool_name: "file_read".to_string(),
                input: json!({
                    "path": file_path.to_string_lossy().to_string()
                }),
                cwd: Some(temp_dir.path().to_string_lossy().to_string()),
            },
        )
        .await
        .expect("file_read should execute");

        assert_eq!(response.tool_name, "file_read");
        assert!(!response.is_error);
        assert!(response.content.contains("alpha"));
        assert!(response.content.contains("beta"));
    }
}
