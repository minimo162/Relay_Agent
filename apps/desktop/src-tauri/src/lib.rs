mod agent_loop;
mod cdp_copilot;
mod config;
mod copilot_client;
mod models;
mod registry;
mod tauri_bridge;

use tauri::Manager;

use crate::registry::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            _app.manage(SessionRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_bridge::start_agent,
            tauri_bridge::respond_approval,
            tauri_bridge::cancel_agent,
            tauri_bridge::get_session_history,
            tauri_bridge::compact_agent_session,
            tauri_bridge::connect_cdp,
            tauri_bridge::cdp_send_prompt,
            tauri_bridge::cdp_start_new_chat,
            tauri_bridge::cdp_screenshot,
            tauri_bridge::mcp_list_servers,
            tauri_bridge::mcp_add_server,
            tauri_bridge::mcp_remove_server,
            tauri_bridge::mcp_check_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
