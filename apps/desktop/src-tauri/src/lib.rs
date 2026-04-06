mod agent_loop;
mod cdp_copilot;
mod config;
mod copilot_persistence;
mod copilot_server;
mod error;
mod models;
mod registry;
mod tauri_bridge;

use tauri::Manager;

use crate::registry::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(SessionRegistry::new());
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
            tauri_bridge::disconnect_cdp,
            tauri_bridge::copilot_start,
            tauri_bridge::copilot_stop,
            tauri_bridge::copilot_status,
            tauri_bridge::mcp_list_servers,
            tauri_bridge::mcp_add_server,
            tauri_bridge::mcp_remove_server,
            tauri_bridge::mcp_check_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
