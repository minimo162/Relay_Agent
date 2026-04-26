use crate::app_services::AppServices;
use crate::models::RelayDiagnostics;
use tauri::State;

#[tauri::command]
pub async fn get_relay_diagnostics(
    services: State<'_, AppServices>,
) -> Result<RelayDiagnostics, String> {
    Ok(crate::doctor::get_relay_diagnostics_from_state(services).await)
}

#[tauri::command]
pub fn write_text_export(path: String, contents: String) -> Result<(), String> {
    crate::tauri_bridge::write_text_export(path, contents)
}
