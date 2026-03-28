use tauri::State;

use crate::models::{
    GenerateRelayPacketRequest, RelayPacket, SubmitCopilotResponseRequest,
    SubmitCopilotResponseResponse,
};
use crate::state::DesktopState;

#[tauri::command]
pub fn generate_relay_packet(
    state: State<'_, DesktopState>,
    request: GenerateRelayPacketRequest,
) -> Result<RelayPacket, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.generate_relay_packet(request)
}

#[tauri::command]
pub fn submit_copilot_response(
    state: State<'_, DesktopState>,
    request: SubmitCopilotResponseRequest,
) -> Result<SubmitCopilotResponseResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.submit_copilot_response(request)
}
