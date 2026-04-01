use tauri::State;

use crate::models::{
    ApprovePlanRequest, ApprovePlanResponse, ExecuteReadActionsRequest, ExecuteReadActionsResponse,
    PlanProgressRequest, PlanProgressResponse, PreviewExecutionRequest, PreviewExecutionResponse,
    RecordPlanProgressRequest, RecordScopeApprovalRequest, RecordScopeApprovalResponse,
    RespondToApprovalRequest, RespondToApprovalResponse, RunExecutionRequest,
    RunExecutionResponse,
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
pub fn approve_plan(
    state: State<'_, DesktopState>,
    request: ApprovePlanRequest,
) -> Result<ApprovePlanResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.approve_plan(request)
}

#[tauri::command]
pub fn get_plan_progress(
    state: State<'_, DesktopState>,
    request: PlanProgressRequest,
) -> Result<PlanProgressResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.get_plan_progress(request)
}

#[tauri::command]
pub fn record_plan_progress(
    state: State<'_, DesktopState>,
    request: RecordPlanProgressRequest,
) -> Result<PlanProgressResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_plan_progress(request)
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
pub fn record_scope_approval(
    state: State<'_, DesktopState>,
    request: RecordScopeApprovalRequest,
) -> Result<RecordScopeApprovalResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_scope_approval(request)
}

#[tauri::command]
pub fn run_execution(
    state: State<'_, DesktopState>,
    request: RunExecutionRequest,
) -> Result<RunExecutionResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.run_execution(request)
}
