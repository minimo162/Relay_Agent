mod agent_loop;
mod cdp_copilot;
mod copilot_client;
mod models;
mod registry;
mod tauri_bridge;

use std::env;
use std::path::PathBuf;

use tauri::Manager;

use crate::registry::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(SessionRegistry::new());
            let _sample_workbook = discover_sample_workbook_path(&app.handle());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn discover_sample_workbook_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("examples").join("revenue-workflow-demo.csv"));
        candidates.push(resource_dir.join("revenue-workflow-demo.csv"));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        );
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(
        manifest_dir
            .join("../../..")
            .join("examples")
            .join("revenue-workflow-demo.csv"),
    );

    candidates.into_iter().find(|p| p.is_file())
}
