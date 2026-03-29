mod app;
mod execution;
mod models;
mod persistence;
mod relay;
mod session;
mod state;
mod storage;
mod workbook;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let (storage, startup_preflight) = match app.path().app_local_data_dir() {
                Ok(app_local_data_dir) => {
                    match storage::AppStorage::open(app_local_data_dir.clone()) {
                        Ok(storage) => (
                            storage,
                            state::StartupPreflight::ready(Some(app_local_data_dir)),
                        ),
                        Err(error) => (
                            storage::AppStorage::default(),
                            state::StartupPreflight::storage_unavailable(app_local_data_dir, error),
                        ),
                    }
                }
                Err(error) => (
                    storage::AppStorage::default(),
                    state::StartupPreflight::path_unavailable(error.to_string()),
                ),
            };

            app.manage(state::DesktopState::new(storage, startup_preflight));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::ping,
            app::initialize_app,
            session::create_session,
            session::list_sessions,
            session::read_session,
            session::start_turn,
            relay::generate_relay_packet,
            relay::submit_copilot_response,
            execution::preview_execution,
            execution::respond_to_approval,
            execution::run_execution
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
