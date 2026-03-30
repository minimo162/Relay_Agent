use serde::Deserialize;
use tauri::State;

use crate::startup::{self, InitializeAppResponse};
use crate::state::DesktopState;
use crate::workbook::{preflight_workbook as run_workbook_preflight, WorkbookPreflightReport};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightWorkbookRequest {
    pub workbook_path: String,
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn preflight_workbook(request: PreflightWorkbookRequest) -> WorkbookPreflightReport {
    run_workbook_preflight(request.workbook_path)
}

#[tauri::command]
pub fn initialize_app(state: State<'_, DesktopState>) -> InitializeAppResponse {
    startup::build_initialize_app_response(&state)
}
