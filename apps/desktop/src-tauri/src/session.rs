use tauri::State;

use crate::models::{
    CreateSessionRequest, ReadSessionRequest, ReadTurnArtifactsRequest, ReadTurnArtifactsResponse,
    Session, SessionDetail, StartTurnRequest, StartTurnResponse,
};
use crate::state::DesktopState;

#[tauri::command]
pub fn create_session(
    state: State<'_, DesktopState>,
    request: CreateSessionRequest,
) -> Result<Session, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.create_session(request)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, DesktopState>) -> Vec<Session> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.list_sessions()
}

#[tauri::command]
pub fn read_session(
    state: State<'_, DesktopState>,
    request: ReadSessionRequest,
) -> Result<SessionDetail, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.read_session(&request.session_id)
}

#[tauri::command]
pub fn read_turn_artifacts(
    state: State<'_, DesktopState>,
    request: ReadTurnArtifactsRequest,
) -> Result<ReadTurnArtifactsResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.read_turn_artifacts(&request.session_id, &request.turn_id)
}

#[tauri::command]
pub fn start_turn(
    state: State<'_, DesktopState>,
    request: StartTurnRequest,
) -> Result<StartTurnResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.start_turn(request)
}
