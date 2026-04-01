use serde::Deserialize;
use tauri::State;

use crate::models::WorkbookProfile;
use crate::startup::{self, InitializeAppResponse};
use crate::state::DesktopState;
use crate::workbook::{
    preflight_workbook as run_workbook_preflight, SheetColumnProfile, WorkbookEngine,
    WorkbookPreflightReport, WorkbookSource,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightWorkbookRequest {
    pub workbook_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectWorkbookRequest {
    pub workbook_path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectWorkbookResponse {
    pub profile: WorkbookProfile,
    pub column_profiles: Vec<SheetColumnProfile>,
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
pub fn inspect_workbook(
    request: InspectWorkbookRequest,
) -> Result<InspectWorkbookResponse, String> {
    let source = WorkbookSource::detect(&request.workbook_path)?;
    let engine = WorkbookEngine::default();
    let profile = engine.inspect_workbook(&source)?;
    let column_profiles = profile
        .sheets
        .iter()
        .map(|sheet| engine.profile_sheet_columns(&source, &sheet.name, None))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(InspectWorkbookResponse {
        profile,
        column_profiles,
    })
}

#[tauri::command]
pub fn initialize_app(state: State<'_, DesktopState>) -> InitializeAppResponse {
    startup::build_initialize_app_response(&state)
}
