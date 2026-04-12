use tauri::{AppHandle, State};

use crate::app_services::AppServices;
use crate::models::{
    CancelAgentRequest, ContinueAgentSessionRequest, GetAgentSessionHistoryRequest,
    RespondAgentApprovalRequest, RespondUserQuestionRequest, SessionWriteUndoRequest,
    StartAgentRequest,
};
use crate::tauri_bridge::{
    self, AgentSessionHistoryResponse, CompactAgentSessionRequest, CompactAgentSessionResponse,
};

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    services: State<'_, AppServices>,
    request: StartAgentRequest,
) -> Result<String, String> {
    tauri_bridge::start_agent_inner(
        app,
        services.registry(),
        services.agent_semaphore(),
        services.config().clone(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn continue_agent_session(
    app: AppHandle,
    services: State<'_, AppServices>,
    request: ContinueAgentSessionRequest,
) -> Result<String, String> {
    tauri_bridge::continue_agent_session_inner(
        app,
        services.registry(),
        services.agent_semaphore(),
        services.config().clone(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn respond_approval(
    _app: AppHandle,
    services: State<'_, AppServices>,
    request: RespondAgentApprovalRequest,
) -> Result<(), String> {
    tauri_bridge::respond_approval_inner(services.registry(), request)
}

#[tauri::command]
pub async fn respond_user_question(
    services: State<'_, AppServices>,
    request: RespondUserQuestionRequest,
) -> Result<(), String> {
    tauri_bridge::respond_user_question(services, request).await
}

#[tauri::command]
pub async fn compact_agent_session(
    services: State<'_, AppServices>,
    request: CompactAgentSessionRequest,
) -> Result<CompactAgentSessionResponse, String> {
    tauri_bridge::compact_agent_session(services, request).await
}

#[tauri::command]
pub async fn cancel_agent(
    app: AppHandle,
    services: State<'_, AppServices>,
    request: CancelAgentRequest,
) -> Result<(), String> {
    tauri_bridge::cancel_agent(app, services, request).await
}

#[tauri::command]
pub async fn get_session_history(
    services: State<'_, AppServices>,
    request: GetAgentSessionHistoryRequest,
) -> Result<AgentSessionHistoryResponse, String> {
    tauri_bridge::get_session_history(services, request).await
}

#[tauri::command]
pub fn undo_session_write(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<(), String> {
    tauri_bridge::undo_session_write(services, request)
}

#[tauri::command]
pub fn redo_session_write(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<(), String> {
    tauri_bridge::redo_session_write(services, request)
}

#[tauri::command]
pub fn get_session_write_undo_status(
    services: State<'_, AppServices>,
    request: SessionWriteUndoRequest,
) -> Result<crate::models::SessionWriteUndoStatusResponse, String> {
    tauri_bridge::get_session_write_undo_status(services, request)
}
