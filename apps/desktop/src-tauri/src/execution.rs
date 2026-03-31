use tauri::State;

use crate::models::{
    ExecuteReadActionsRequest, ExecuteReadActionsResponse, PreviewExecutionRequest,
    PreviewExecutionResponse, RespondToApprovalRequest, RespondToApprovalResponse,
    RunExecutionRequest, RunExecutionResponse,
};
use crate::state::DesktopState;

#[tauri::command]
pub fn preview_execution(
    state: State<'_, DesktopState>,
    request: PreviewExecutionRequest,
) -> Result<PreviewExecutionResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.preview_execution(request)
}

#[tauri::command]
pub fn execute_read_actions(
    state: State<'_, DesktopState>,
    request: ExecuteReadActionsRequest,
) -> Result<ExecuteReadActionsResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.execute_read_actions(request)
}

#[tauri::command]
pub fn respond_to_approval(
    state: State<'_, DesktopState>,
    request: RespondToApprovalRequest,
) -> Result<RespondToApprovalResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.respond_to_approval(request)
}

#[tauri::command]
pub fn run_execution(
    state: State<'_, DesktopState>,
    request: RunExecutionRequest,
) -> Result<RunExecutionResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.run_execution(request)
}
