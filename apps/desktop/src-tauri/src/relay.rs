use tauri::State;

use crate::models::{
    AssessCopilotHandoffRequest, AssessCopilotHandoffResponse, RecordStructuredResponseRequest,
    RecordStructuredResponseResponse,
};
use crate::state::DesktopState;

#[tauri::command]
pub fn record_structured_response(
    state: State<'_, DesktopState>,
    request: RecordStructuredResponseRequest,
) -> Result<RecordStructuredResponseResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.record_structured_response(request)
}

#[tauri::command]
pub fn assess_copilot_handoff(
    state: State<'_, DesktopState>,
    request: AssessCopilotHandoffRequest,
) -> Result<AssessCopilotHandoffResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.assess_copilot_handoff(request)
}
