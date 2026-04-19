use std::path::PathBuf;

use ts_rs::TS;

use crate::agent_loop::{
    AgentApprovalNeededEvent, AgentErrorEvent, AgentSessionHistoryResponse,
    AgentSessionStatusEvent, AgentTextDeltaEvent, AgentToolResultEvent, AgentToolStartEvent,
    AgentTurnCompleteEvent, AgentUserQuestionNeededEvent, MessageContent, RelayMessage,
};
use crate::models::{
    BrowserAutomationSettings, CancelAgentRequest, ContinueAgentSessionRequest,
    CopilotBridgeFailureInfo, CopilotRepairStageFailureCount, CopilotRepairStageStats,
    GetAgentSessionHistoryRequest, ListWorkspaceSlashCommandsRequest, McpAddServerRequest,
    McpServerInfo, RelayDiagnostics, RespondAgentApprovalRequest, RespondUserQuestionRequest,
    RustAnalyzerProbeRequest, RustAnalyzerProbeResponse, SessionWriteUndoRequest,
    SessionWriteUndoStatusResponse, StartAgentRequest, WorkspaceAllowlistCwdRequest,
    WorkspaceAllowlistEntryRow, WorkspaceAllowlistRemoveToolRequest, WorkspaceAllowlistSnapshot,
    WorkspaceInstructionSurfacesRequest, WorkspaceSlashCommandRow,
};
use crate::tauri_bridge::{
    CdpConnectResult, CdpPromptResult, CdpSendPromptRequest, CompactAgentSessionRequest,
    CompactAgentSessionResponse, ConnectCdpRequest, CopilotWarmupFailureCode, CopilotWarmupResult,
    CopilotWarmupStage,
};
use crate::workspace_surfaces::{InstructionSurface, WorkspaceInstructionSurfaces};

fn decl<T: TS>() -> String {
    T::decl()
}

pub fn render_ipc_generated_ts() -> String {
    let sections = [
        decl::<BrowserAutomationSettings>(),
        decl::<StartAgentRequest>(),
        decl::<ContinueAgentSessionRequest>(),
        decl::<RespondAgentApprovalRequest>(),
        decl::<RespondUserQuestionRequest>(),
        decl::<CopilotBridgeFailureInfo>(),
        decl::<CopilotRepairStageFailureCount>(),
        decl::<CopilotRepairStageStats>(),
        decl::<RelayDiagnostics>(),
        decl::<CancelAgentRequest>(),
        decl::<GetAgentSessionHistoryRequest>(),
        decl::<SessionWriteUndoRequest>(),
        decl::<SessionWriteUndoStatusResponse>(),
        decl::<RustAnalyzerProbeRequest>(),
        decl::<RustAnalyzerProbeResponse>(),
        decl::<CompactAgentSessionRequest>(),
        decl::<CompactAgentSessionResponse>(),
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
        decl::<CopilotWarmupStage>(),
        decl::<CopilotWarmupFailureCode>(),
        decl::<CopilotWarmupResult>(),
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
    use std::collections::BTreeSet;
    use std::fs;

    #[test]
    fn rendered_ipc_bindings_include_core_contracts() {
        let rendered = render_ipc_generated_ts();
        for required in [
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

    /// Fails when a Rust type gains `#[derive(..., TS, ...)]` in a canonical IPC source file
    /// but is not referenced by `render_ipc_generated_ts`. Without this guard, a new IPC type
    /// silently skips the generated bindings and the frontend loses its typed contract.
    #[test]
    fn every_ts_deriving_ipc_type_is_rendered() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let ipc_source_files = [
            manifest_dir.join("src/tauri_bridge.rs"),
            manifest_dir.join("src/agent_loop/events.rs"),
            manifest_dir.join("crates/desktop-core/src/models.rs"),
            manifest_dir.join("crates/desktop-core/src/workspace_surfaces.rs"),
        ];

        let mut discovered: BTreeSet<String> = BTreeSet::new();
        for path in &ipc_source_files {
            let contents =
                fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
            discovered.extend(extract_ts_deriving_type_names(&contents));
        }

        assert!(
            !discovered.is_empty(),
            "no TS-deriving types found — regex likely broken"
        );

        let rendered = render_ipc_generated_ts();
        // ts-rs emits each type as `export interface Name ...`, `export type Name = ...`, or
        // `export enum Name ...`. Match the prefix and require a non-identifier character
        // after the name so `Foo` does not satisfy a check for `Fo`.
        let mut missing: Vec<String> = Vec::new();
        for name in &discovered {
            if !rendered_declares(&rendered, name) {
                missing.push(name.clone());
            }
        }

        assert!(
            missing.is_empty(),
            "these TS-deriving IPC types are not referenced by render_ipc_generated_ts \
             (add them to `sections` in ipc_codegen.rs): {missing:?}"
        );
    }

    /// Very lightweight scanner for `#[derive(..., TS, ...)]` followed (possibly after other
    /// attributes) by a `pub struct`/`pub enum` declaration. Good enough for our own source
    /// files; not a general-purpose Rust parser.
    fn extract_ts_deriving_type_names(source: &str) -> Vec<String> {
        let mut out = Vec::new();
        let lines: Vec<&str> = source.lines().collect();
        let mut i = 0;
        while i < lines.len() {
            let line = lines[i].trim_start();
            if line.starts_with("#[derive(") && derive_line_includes_ts(line) {
                // Walk forward past any additional attributes to find the item declaration.
                let mut j = i + 1;
                while j < lines.len() {
                    let next = lines[j].trim_start();
                    if next.starts_with("#[") {
                        j += 1;
                        continue;
                    }
                    if let Some(name) = type_name_from_decl(next) {
                        out.push(name);
                    }
                    break;
                }
            }
            i += 1;
        }
        out
    }

    fn derive_line_includes_ts(line: &str) -> bool {
        // Accept the derive list spanning a single line; our canonical source files keep the
        // attribute on one line, so we do not need a multi-line join.
        line.split(&['(', ')', ','][..])
            .map(|tok| tok.trim())
            .any(|tok| tok == "TS" || tok == "ts_rs::TS")
    }

    fn rendered_declares(rendered: &str, name: &str) -> bool {
        // ts-rs emits `type Name = ...;`, `interface Name { ... }`, or `enum Name { ... }`,
        // optionally prefixed by `export `. Cover both shapes so the test keeps working if
        // the emitter is ever switched to emit `export` declarations.
        for keyword in [
            "interface ",
            "type ",
            "enum ",
            "export interface ",
            "export type ",
            "export enum ",
        ] {
            let prefix = format!("{keyword}{name}");
            let mut scan_from = 0usize;
            while let Some(hit) = rendered[scan_from..].find(&prefix) {
                let absolute = scan_from + hit;
                // Ensure the keyword is at a token boundary (otherwise `type Foo` could match
                // inside `mytype Foo` — unlikely but cheap to check).
                let boundary_ok = absolute == 0
                    || rendered.as_bytes()[absolute - 1] == b'\n'
                    || rendered.as_bytes()[absolute - 1] == b' ';
                let after = absolute + prefix.len();
                let next = rendered[after..].chars().next();
                let name_bounded = !matches!(next, Some(c) if c.is_alphanumeric() || c == '_');
                if boundary_ok && name_bounded {
                    return true;
                }
                scan_from = after;
            }
        }
        false
    }

    fn type_name_from_decl(decl_line: &str) -> Option<String> {
        let stripped = decl_line.trim_start();
        let rest = stripped
            .strip_prefix("pub struct ")
            .or_else(|| stripped.strip_prefix("pub enum "))
            .or_else(|| stripped.strip_prefix("pub(crate) struct "))
            .or_else(|| stripped.strip_prefix("pub(crate) enum "))?;
        let name: String = rest
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    }
}
