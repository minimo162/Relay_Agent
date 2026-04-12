use tauri::{AppHandle, State};

use crate::app_services::AppServices;
use crate::models::BrowserAutomationSettings;

#[tauri::command]
pub async fn warmup_copilot_bridge(
    services: State<'_, AppServices>,
    browser_settings: Option<BrowserAutomationSettings>,
) -> Result<crate::tauri_bridge::CopilotWarmupResult, String> {
    crate::tauri_bridge::warmup_copilot_bridge(services, browser_settings).await
}

#[tauri::command]
pub async fn connect_cdp(
    app: AppHandle,
    request: crate::tauri_bridge::ConnectCdpRequest,
) -> Result<crate::tauri_bridge::CdpConnectResult, String> {
    crate::tauri_bridge::connect_cdp(app, request).await
}

#[tauri::command]
pub async fn cdp_send_prompt(
    app: AppHandle,
    request: crate::tauri_bridge::CdpSendPromptRequest,
) -> Result<crate::tauri_bridge::CdpPromptResult, String> {
    crate::tauri_bridge::cdp_send_prompt(app, request).await
}

#[tauri::command]
pub async fn cdp_start_new_chat(
    app: AppHandle,
    request: crate::tauri_bridge::ConnectCdpRequest,
) -> Result<crate::tauri_bridge::CdpConnectResult, String> {
    crate::tauri_bridge::cdp_start_new_chat(app, request).await
}

#[tauri::command]
pub async fn disconnect_cdp(app: AppHandle) -> Result<(), String> {
    crate::tauri_bridge::disconnect_cdp(app).await
}

#[tauri::command]
pub async fn cdp_screenshot(app: AppHandle) -> Result<serde_json::Value, String> {
    crate::tauri_bridge::cdp_screenshot(app).await
}
