use serde::Serialize;
use tauri::State;

use crate::models::RelayMode;
use crate::state::DesktopState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeAppResponse {
    pub app_name: &'static str,
    pub initialized: bool,
    pub storage_ready: bool,
    pub storage_mode: &'static str,
    pub session_count: usize,
    pub supported_relay_modes: Vec<RelayMode>,
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn initialize_app(state: State<'_, DesktopState>) -> InitializeAppResponse {
    let mut initialized = state.initialized.lock().expect("desktop state poisoned");
    let storage = state.storage.lock().expect("desktop storage poisoned");
    *initialized = true;

    InitializeAppResponse {
        app_name: "Relay Agent",
        initialized: *initialized,
        storage_ready: storage.storage_ready(),
        storage_mode: storage.storage_mode(),
        session_count: storage.session_count(),
        supported_relay_modes: vec![
            RelayMode::Discover,
            RelayMode::Plan,
            RelayMode::Repair,
            RelayMode::Followup,
        ],
    }
}
