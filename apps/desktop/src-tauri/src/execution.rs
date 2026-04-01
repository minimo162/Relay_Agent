use serde::{Deserialize, Serialize};
use tauri::State;

use crate::mcp_client::McpClient;
use crate::models::{
    ApprovePlanRequest, ApprovePlanResponse, ExecuteReadActionsRequest, ExecuteReadActionsResponse,
    InvokeMcpToolRequest, InvokeMcpToolResponse, ListToolsResponse, McpServerConfig,
    PlanProgressRequest, PlanProgressResponse, PreviewExecutionRequest, PreviewExecutionResponse,
    RecordPlanProgressRequest, RecordScopeApprovalRequest, RecordScopeApprovalResponse,
    RespondToApprovalRequest, RespondToApprovalResponse, RunExecutionMultiRequest,
    RunExecutionRequest, RunExecutionResponse, SetToolEnabledRequest, ToolRegistration,
    ToolSource, ValidateOutputQualityRequest,
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
pub fn execute_read_actions(
    state: State<'_, DesktopState>,
    request: ExecuteReadActionsRequest,
) -> Result<ExecuteReadActionsResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.execute_read_actions(request)
}

#[tauri::command]
pub fn approve_plan(
    state: State<'_, DesktopState>,
    request: ApprovePlanRequest,
) -> Result<ApprovePlanResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.approve_plan(request)
}

#[tauri::command]
pub fn get_plan_progress(
    state: State<'_, DesktopState>,
    request: PlanProgressRequest,
) -> Result<PlanProgressResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.get_plan_progress(request)
}

#[tauri::command]
pub fn record_plan_progress(
    state: State<'_, DesktopState>,
    request: RecordPlanProgressRequest,
) -> Result<PlanProgressResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_plan_progress(request)
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
pub fn run_execution_multi(
    state: State<'_, DesktopState>,
    request: RunExecutionMultiRequest,
) -> Result<Vec<RunExecutionResponse>, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.run_execution_multi(request)
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
    use super::{parse_mcp_tool_name, resolve_mcp_invocation_parts};
    use crate::models::{McpTransport, ToolPhase, ToolRegistration, ToolSource};

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
}
