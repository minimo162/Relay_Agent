mod copilot_client;
mod models;
mod tauri_bridge;

use std::env;
use std::path::PathBuf;

use tauri::Manager;

use crate::tauri_bridge::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Register session registry as Tauri state
            app.manage(SessionRegistry::new());

            // Bootstrap (minimal — no storage needed for now)
            let _sample_workbook = discover_sample_workbook_path(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_bridge::start_agent,
            tauri_bridge::respond_approval,
            tauri_bridge::cancel_agent,
            tauri_bridge::get_session_history,
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
