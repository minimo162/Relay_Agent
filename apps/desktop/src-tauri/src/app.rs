use tauri::State;

use crate::startup::{self, InitializeAppResponse};
use crate::state::DesktopState;

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn initialize_app(state: State<'_, DesktopState>) -> InitializeAppResponse {
    startup::build_initialize_app_response(&state)
}
