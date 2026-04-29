use crate::app_services::AppServices;
use crate::models::RelayDiagnostics;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_relay_diagnostics(
    services: State<'_, AppServices>,
) -> Result<RelayDiagnostics, String> {
    Ok(crate::doctor::get_relay_diagnostics_from_state(services).await)
}

#[tauri::command]
pub fn retry_openwork_setup(
    app: AppHandle,
    services: State<'_, AppServices>,
) -> Result<(), String> {
    crate::openwork_autostart::spawn(
        app,
        services.opencode_provider_bridge(),
        services.openwork_setup_store(),
    );
    Ok(())
}

#[tauri::command]
pub fn write_text_export(path: String, contents: String) -> Result<(), String> {
    crate::tauri_bridge::write_text_export(path, contents)
}
