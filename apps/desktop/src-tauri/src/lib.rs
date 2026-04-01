mod app;
mod execution;
mod file_ops;
mod models;
mod persistence;
mod relay;
mod session;
mod startup;
mod state;
mod storage;
mod workbook;
mod workflow_smoke;

use std::{env, path::PathBuf};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sample_workbook_path = discover_sample_workbook_path(&app.handle());
            let app_local_data_dir = resolve_app_local_data_dir(&app.handle());
            let desktop_state =
                startup::bootstrap_desktop_state(app_local_data_dir, sample_workbook_path);

            app.manage(desktop_state);
            workflow_smoke::spawn_if_configured(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::ping,
            app::preflight_workbook,
            app::inspect_workbook,
            app::initialize_app,
            session::create_session,
            session::list_sessions,
            session::read_session,
            session::read_turn_artifacts,
            session::start_turn,
            relay::generate_relay_packet,
            relay::assess_copilot_handoff,
            relay::submit_copilot_response,
            execution::execute_read_actions,
            execution::approve_plan,
            execution::get_plan_progress,
            execution::record_plan_progress,
            execution::preview_execution,
            execution::respond_to_approval,
            execution::run_execution
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn discover_sample_workbook_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        );
        candidates.push(resource_dir.join("revenue-workflow-demo.csv"));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        );
    }

    candidates.push(
        manifest_dir
            .join("../../..")
            .join("examples")
            .join("revenue-workflow-demo.csv"),
    );

    startup::discover_sample_workbook_path_from_candidates(candidates)
}

fn resolve_app_local_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match env::var("RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR") {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        Ok(_) => Err(
            "RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR was set but did not contain a usable path."
                .to_string(),
        ),
        Err(_) => app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string()),
    }
}

pub use startup::{
    bootstrap_desktop_state, bootstrap_retry_recovery_state, build_initialize_app_response,
    discover_sample_workbook_path_from_candidates, InitializeAppResponse,
    InitializeAppStartupIssue, StartupRecoveryAction, StartupStatus,
};
