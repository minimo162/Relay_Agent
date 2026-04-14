use crate::app_services::AppServices;
use crate::models::{
    GetPermissionSummaryRequest, ListWorkspaceSlashCommandsRequest, RelayDiagnostics,
    RustAnalyzerProbeRequest, RustAnalyzerProbeResponse, WorkspaceAllowlistCwdRequest,
    WorkspaceAllowlistRemoveToolRequest, WorkspaceAllowlistSnapshot,
    WorkspaceInstructionSurfacesRequest, WorkspaceSlashCommandRow,
};
use tauri::State;

#[tauri::command]
pub fn probe_rust_analyzer(request: RustAnalyzerProbeRequest) -> RustAnalyzerProbeResponse {
    crate::tauri_bridge::probe_rust_analyzer(request)
}

#[tauri::command]
pub async fn get_relay_diagnostics(
    services: State<'_, AppServices>,
) -> Result<RelayDiagnostics, String> {
    Ok(crate::doctor::get_relay_diagnostics_from_state(services).await)
}

#[tauri::command]
pub fn write_text_export(path: String, contents: String) -> Result<(), String> {
    crate::tauri_bridge::write_text_export(path, contents)
}

#[tauri::command]
pub fn workspace_instruction_surfaces(
    request: WorkspaceInstructionSurfacesRequest,
) -> crate::workspace_surfaces::WorkspaceInstructionSurfaces {
    crate::tauri_bridge::workspace_instruction_surfaces(request)
}

#[tauri::command]
pub fn get_desktop_permission_summary(
    request: GetPermissionSummaryRequest,
) -> Vec<crate::models::DesktopPermissionSummaryRow> {
    crate::tauri_bridge::get_desktop_permission_summary(request)
}

#[tauri::command]
pub fn get_workspace_allowlist() -> Result<WorkspaceAllowlistSnapshot, String> {
    crate::tauri_bridge::get_workspace_allowlist()
}

#[tauri::command]
pub fn remove_workspace_allowlist_tool(
    request: WorkspaceAllowlistRemoveToolRequest,
) -> Result<(), String> {
    crate::tauri_bridge::remove_workspace_allowlist_tool(request)
}

#[tauri::command]
pub fn clear_workspace_allowlist(request: WorkspaceAllowlistCwdRequest) -> Result<(), String> {
    crate::tauri_bridge::clear_workspace_allowlist(request)
}

#[tauri::command]
pub fn list_workspace_slash_commands(
    request: ListWorkspaceSlashCommandsRequest,
) -> Result<Vec<WorkspaceSlashCommandRow>, String> {
    crate::tauri_bridge::list_workspace_slash_commands(request)
}
