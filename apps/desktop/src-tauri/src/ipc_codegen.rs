use std::path::PathBuf;

use ts_rs::TS;

use crate::agent_loop::{
    AgentApprovalNeededEvent, AgentErrorEvent, AgentSessionHistoryResponse,
    AgentSessionStatusEvent, AgentTextDeltaEvent, AgentToolResultEvent, AgentToolStartEvent,
    AgentTurnCompleteEvent, AgentUserQuestionNeededEvent, MessageContent, RelayMessage,
};
use crate::models::{
    BrowserAutomationSettings, CancelAgentRequest, ContinueAgentSessionRequest,
    DesktopPermissionSummaryRow, GetAgentSessionHistoryRequest, GetPermissionSummaryRequest,
    ListWorkspaceSlashCommandsRequest, McpAddServerRequest, McpServerInfo, RelayDiagnostics,
    RespondAgentApprovalRequest, RespondUserQuestionRequest, RustAnalyzerProbeRequest,
    RustAnalyzerProbeResponse, SessionPreset, SessionWriteUndoRequest,
    SessionWriteUndoStatusResponse, StartAgentRequest,
    WorkspaceAllowlistCwdRequest, WorkspaceAllowlistEntryRow, WorkspaceAllowlistRemoveToolRequest,
    WorkspaceAllowlistSnapshot, WorkspaceInstructionSurfacesRequest, WorkspaceSlashCommandRow,
};
use crate::tauri_bridge::{
    CdpConnectResult, CdpPromptResult, CdpSendPromptRequest, CompactAgentSessionRequest,
    CompactAgentSessionResponse, ConnectCdpRequest,
};
use crate::workspace_surfaces::{InstructionSurface, WorkspaceInstructionSurfaces};

fn decl<T: TS>() -> String {
    T::decl()
}

pub fn render_ipc_generated_ts() -> String {
    let sections = [
        decl::<BrowserAutomationSettings>(),
        decl::<SessionPreset>(),
        decl::<StartAgentRequest>(),
        decl::<ContinueAgentSessionRequest>(),
        decl::<RespondAgentApprovalRequest>(),
        decl::<RespondUserQuestionRequest>(),
        decl::<RelayDiagnostics>(),
        decl::<CancelAgentRequest>(),
        decl::<GetAgentSessionHistoryRequest>(),
        decl::<SessionWriteUndoRequest>(),
        decl::<SessionWriteUndoStatusResponse>(),
        decl::<RustAnalyzerProbeRequest>(),
        decl::<RustAnalyzerProbeResponse>(),
        decl::<CompactAgentSessionRequest>(),
        decl::<CompactAgentSessionResponse>(),
        decl::<DesktopPermissionSummaryRow>(),
        decl::<GetPermissionSummaryRequest>(),
        decl::<McpServerInfo>(),
        decl::<McpAddServerRequest>(),
        decl::<WorkspaceAllowlistEntryRow>(),
        decl::<WorkspaceAllowlistSnapshot>(),
        decl::<WorkspaceAllowlistRemoveToolRequest>(),
        decl::<WorkspaceAllowlistCwdRequest>(),
        decl::<WorkspaceSlashCommandRow>(),
        decl::<ListWorkspaceSlashCommandsRequest>(),
        decl::<WorkspaceInstructionSurfacesRequest>(),
        decl::<InstructionSurface>(),
        decl::<WorkspaceInstructionSurfaces>(),
        decl::<ConnectCdpRequest>(),
        decl::<CdpSendPromptRequest>(),
        decl::<CdpConnectResult>(),
        decl::<CdpPromptResult>(),
        decl::<AgentToolStartEvent>(),
        decl::<AgentToolResultEvent>(),
        decl::<AgentApprovalNeededEvent>(),
        decl::<AgentTurnCompleteEvent>(),
        decl::<AgentSessionStatusEvent>(),
        decl::<AgentTextDeltaEvent>(),
        decl::<AgentErrorEvent>(),
        decl::<AgentUserQuestionNeededEvent>(),
        decl::<MessageContent>(),
        decl::<RelayMessage>(),
        decl::<AgentSessionHistoryResponse>(),
    ];

    format!(
        "// Generated from Rust IPC source types via ts-rs.\n// Source: apps/desktop/src-tauri/src/models.rs, agent_loop/events, tauri_bridge.rs\n\n{}\n",
        sections.join("\n\n")
    )
}

pub fn generated_ipc_output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/lib")
        .join("ipc.generated.ts")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendered_ipc_bindings_include_core_contracts() {
        let rendered = render_ipc_generated_ts();
        for required in [
            "type SessionPreset",
            "StartAgentRequest",
            "AgentSessionHistoryResponse",
            "AgentSessionStatusEvent",
        ] {
            assert!(
                rendered.contains(required),
                "missing `{required}` in generated bindings"
            );
        }
    }
}
