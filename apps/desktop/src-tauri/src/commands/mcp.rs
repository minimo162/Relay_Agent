use crate::models::{McpAddServerRequest, McpServerInfo};

#[tauri::command]
pub fn mcp_list_servers() -> Result<Vec<McpServerInfo>, String> {
    crate::tauri_bridge::mcp_list_servers()
}

#[tauri::command]
pub fn mcp_add_server(request: McpAddServerRequest) -> Result<McpServerInfo, String> {
    crate::tauri_bridge::mcp_add_server(request)
}

#[tauri::command]
pub fn mcp_remove_server(name: String) -> Result<bool, String> {
    crate::tauri_bridge::mcp_remove_server(name)
}

#[tauri::command]
pub fn mcp_check_server_status(name: String) -> Result<McpServerInfo, String> {
    crate::tauri_bridge::mcp_check_server_status(name)
}
