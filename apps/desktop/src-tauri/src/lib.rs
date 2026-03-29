mod app;
mod execution;
mod models;
mod persistence;
mod relay;
mod session;
mod state;
mod storage;
mod workbook;

use std::io::Error;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_local_data_dir = app.path().app_local_data_dir()?;
            let storage = storage::AppStorage::open(app_local_data_dir).map_err(Error::other)?;
            app.manage(state::DesktopState::new(storage));
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
