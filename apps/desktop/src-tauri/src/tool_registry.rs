use std::collections::HashMap;

use serde_json::{json, Value};

use crate::{
    file_ops,
    models::{
        DiffSummary, McpServerConfig, Session, ToolDescriptor, ToolPhase, ToolRegistration,
        ToolSource, Turn,
    },
    storage::AppStorage,
    workbook::WorkbookEngine,
};

#[derive(Clone, Copy, Debug)]
enum BuiltinToolHandler {
    WorkbookInspect,
    SheetPreview,
    SheetProfileColumns,
    SessionDiffFromBase,
    FileList,
    FileReadText,
    FileStat,
    TextSearch,
    DocumentReadText,
    BrowserSendToCopilot,
    MetadataOnly,
}

#[derive(Clone, Debug)]
enum ToolHandler {
    Builtin(BuiltinToolHandler),
    Mcp,
}

#[derive(Clone, Debug)]
struct ToolEntry {
    registration: ToolRegistration,
    handler: ToolHandler,
}

pub struct ToolRegistry {
    tools: HashMap<String, ToolEntry>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            tools: HashMap::new(),
        };
        registry.register_builtin_tools();
        registry
    }

    pub fn list(&self) -> Vec<ToolRegistration> {
        let mut tools = self
            .tools
            .values()
            .map(|entry| entry.registration.clone())
            .collect::<Vec<_>>();
        tools.sort_by(|left, right| left.id.cmp(&right.id));
        tools
    }

    #[allow(dead_code)]
    pub fn get(&self, tool_id: &str) -> Option<ToolRegistration> {
        self.tools
            .get(tool_id)
            .map(|entry| entry.registration.clone())
    }

    #[cfg(test)]
    pub fn has(&self, tool_id: &str) -> bool {
        self.tools.contains_key(tool_id)
    }

    pub fn set_enabled(
        &mut self,
        tool_id: &str,
        enabled: bool,
    ) -> Result<ToolRegistration, String> {
        let entry = self
            .tools
            .get_mut(tool_id)
            .ok_or_else(|| format!("unknown tool: {tool_id}"))?;
        entry.registration.enabled = enabled;
        Ok(entry.registration.clone())
    }

    pub fn list_descriptors_by_phase(&self, phase: ToolPhase) -> Vec<ToolDescriptor> {
        let mut descriptors = self
            .tools
            .values()
            .filter(|entry| entry.registration.enabled && entry.registration.phase == phase)
            .map(|entry| ToolDescriptor {
                id: entry.registration.id.clone(),
                title: entry.registration.title.clone(),
                description: entry.registration.description.clone(),
                phase: entry.registration.phase,
                requires_approval: entry.registration.requires_approval,
            })
            .collect::<Vec<_>>();
        descriptors.sort_by(|left, right| left.id.cmp(&right.id));
        descriptors
    }

    pub fn invoke(
        &self,
        storage: &AppStorage,
        session: &Session,
        turn: &Turn,
        current_diff: &DiffSummary,
        tool_id: &str,
        args: &Value,
    ) -> Result<Value, String> {
        let entry = self
            .tools
            .get(tool_id)
            .ok_or_else(|| format!("unknown tool: {tool_id}"))?;

        if !entry.registration.enabled {
            return Err(format!("tool `{tool_id}` is disabled"));
        }

        match &entry.handler {
            ToolHandler::Builtin(handler) => {
                invoke_builtin(*handler, storage, session, turn, current_diff, args)
            }
            ToolHandler::Mcp => Err(format!(
                "MCP tool `{tool_id}` must be invoked via invoke_mcp_tool command"
            )),
        }
    }

    pub fn register_mcp_tools(
        &mut self,
        server: McpServerConfig,
        tools: Vec<crate::mcp_client::McpToolDefinition>,
    ) -> Vec<String> {
        let mut registered_ids = Vec::new();

        for tool in tools {
            let tool_id = format!("mcp.{}.{}", server.name, tool.name);
            let registration = ToolRegistration {
                id: tool_id.clone(),
                title: tool.name.clone(),
                description: tool.description,
                phase: ToolPhase::Write,
                requires_approval: true,
                source: ToolSource::Mcp,
                enabled: true,
                parameter_schema: Some(tool.input_schema),
                mcp_server_url: Some(server.url.clone()),
                mcp_transport: Some(server.transport),
            };
            self.tools.insert(
                tool_id.clone(),
                ToolEntry {
                    registration,
                    handler: ToolHandler::Mcp,
                },
            );
            registered_ids.push(tool_id);
        }

        registered_ids
    }

    fn register_builtin(&mut self, registration: ToolRegistration, handler: BuiltinToolHandler) {
        self.tools.insert(
            registration.id.clone(),
            ToolEntry {
                registration,
                handler: ToolHandler::Builtin(handler),
            },
        );
    }

    fn register_builtin_tools(&mut self) {
        self.register_builtin(
            ToolRegistration {
                id: "workbook.inspect".to_string(),
                title: "Inspect workbook".to_string(),
                description: "Read workbook metadata, sheets, and basic summary information."
                    .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::WorkbookInspect,
        );
        self.register_builtin(
            ToolRegistration {
                id: "sheet.preview".to_string(),
                title: "Preview sheet rows".to_string(),
                description: "Read a small sample of rows from a sheet.".to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::SheetPreview,
        );
        self.register_builtin(
            ToolRegistration {
                id: "sheet.profile_columns".to_string(),
                title: "Profile columns".to_string(),
                description: "Inspect inferred types and sample values for sheet columns."
                    .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::SheetProfileColumns,
        );
        self.register_builtin(
            ToolRegistration {
                id: "session.diff_from_base".to_string(),
                title: "Diff from base".to_string(),
                description: "Compare the current session state to the original workbook input."
                    .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::SessionDiffFromBase,
        );
        self.register_builtin(
            ToolRegistration {
                id: "file.list".to_string(),
                title: "List files".to_string(),
                description: "Read file and directory names plus basic metadata.".to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::FileList,
        );
        self.register_builtin(
            ToolRegistration {
                id: "file.read_text".to_string(),
                title: "Read text file".to_string(),
                description: "Read UTF-8 or Shift_JIS text content up to 1MB.".to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::FileReadText,
        );
        self.register_builtin(
            ToolRegistration {
                id: "file.stat".to_string(),
                title: "Inspect file metadata".to_string(),
                description: "Read existence, size, and timestamps for a file or directory."
                    .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::FileStat,
        );
        self.register_builtin(
            ToolRegistration {
                id: "text.search".to_string(),
                title: "Search text".to_string(),
                description:
                    "Search a text file with a regular expression and return context lines."
                        .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::TextSearch,
        );
        self.register_builtin(
            ToolRegistration {
                id: "document.read_text".to_string(),
                title: "Read document text".to_string(),
                description: "Extract text from DOCX, PPTX, PDF, and common plain-text files."
                    .to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: None,
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::DocumentReadText,
        );
        self.register_builtin(
            ToolRegistration {
                id: "browser.send_to_copilot".to_string(),
                title: "Copilot にプロンプト送信".to_string(),
                description: "Edge の M365 Copilot にプロンプトを送信し応答を取得".to_string(),
                phase: ToolPhase::Read,
                requires_approval: false,
                source: ToolSource::Builtin,
                enabled: true,
                parameter_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string" }
                    },
                    "required": ["prompt"]
                })),
                mcp_server_url: None,
                mcp_transport: None,
            },
            BuiltinToolHandler::BrowserSendToCopilot,
        );

        for (id, title, description) in [
            (
                "table.rename_columns",
                "Rename columns",
                "Rename one or more columns in a table or sheet.",
            ),
            (
                "table.cast_columns",
                "Cast columns",
                "Convert one or more columns to new logical types.",
            ),
            (
                "table.filter_rows",
                "Filter rows",
                "Filter table rows into a refined output.",
            ),
            (
                "table.derive_column",
                "Derive column",
                "Create a derived output column from an expression.",
            ),
            (
                "table.group_aggregate",
                "Group aggregate",
                "Group rows and calculate aggregated output columns.",
            ),
            (
                "workbook.save_copy",
                "Save copy",
                "Write the output to a new workbook or CSV copy.",
            ),
            (
                "file.copy",
                "Copy file",
                "Copy a file to a new absolute destination path.",
            ),
            (
                "file.move",
                "Move file",
                "Move or rename a file to a new absolute destination path.",
            ),
            (
                "file.delete",
                "Delete file",
                "Move a file to the recycle bin or permanently delete it.",
            ),
            (
                "text.replace",
                "Replace text",
                "Apply regular-expression search and replace to a text file.",
            ),
        ] {
            self.register_builtin(
                ToolRegistration {
                    id: id.to_string(),
                    title: title.to_string(),
                    description: description.to_string(),
                    phase: ToolPhase::Write,
                    requires_approval: true,
                    source: ToolSource::Builtin,
                    enabled: true,
                    parameter_schema: None,
                    mcp_server_url: None,
                    mcp_transport: None,
                },
                BuiltinToolHandler::MetadataOnly,
            );
        }
    }
}

fn invoke_builtin(
    handler: BuiltinToolHandler,
    storage: &AppStorage,
    session: &Session,
    turn: &Turn,
    current_diff: &DiffSummary,
    args: &Value,
) -> Result<Value, String> {
    match handler {
        BuiltinToolHandler::WorkbookInspect => {
            let source = storage
                .resolve_workbook_source(session, args.get("sourcePath").and_then(Value::as_str))?;
            serde_json::to_value(WorkbookEngine::default().inspect_workbook(&source)?)
                .map_err(|error| format!("failed to serialize workbook profile: {error}"))
        }
        BuiltinToolHandler::SheetPreview => {
            let sheet = required_arg_string(args, "sheet")?;
            let source = storage.resolve_workbook_source(session, None)?;
            let preview = WorkbookEngine::default().sheet_preview(
                &source,
                &sheet,
                args.get("limit")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )?;
            serde_json::to_value(preview)
                .map_err(|error| format!("failed to serialize sheet preview: {error}"))
        }
        BuiltinToolHandler::SheetProfileColumns => {
            let sheet = required_arg_string(args, "sheet")?;
            let source = storage.resolve_workbook_source(session, None)?;
            let profile = WorkbookEngine::default().profile_sheet_columns(
                &source,
                &sheet,
                args.get("sampleSize")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )?;
            serde_json::to_value(profile)
                .map_err(|error| format!("failed to serialize column profile: {error}"))
        }
        BuiltinToolHandler::SessionDiffFromBase => {
            let diff = storage.session_diff_from_base(
                session,
                turn,
                args.get("artifactId").and_then(Value::as_str),
                current_diff,
            )?;
            serde_json::to_value(diff)
                .map_err(|error| format!("failed to serialize diff summary: {error}"))
        }
        BuiltinToolHandler::FileList => file_ops::execute_file_list(args),
        BuiltinToolHandler::FileReadText => file_ops::execute_file_read_text(args),
        BuiltinToolHandler::FileStat => file_ops::execute_file_stat(args),
        BuiltinToolHandler::TextSearch => file_ops::execute_text_search(args),
        BuiltinToolHandler::DocumentReadText => file_ops::execute_document_read_text(args),
        BuiltinToolHandler::BrowserSendToCopilot => {
            Err("browser tools are executed via the desktop browser automation command".to_string())
        }
        BuiltinToolHandler::MetadataOnly => {
            Err("write tools are previewed and executed through the existing workflow".to_string())
        }
    }
}

fn required_arg_string(args: &Value, field: &str) -> Result<String, String> {
    args.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{field} is required"))
}

#[cfg(test)]
mod tests {
    use super::ToolRegistry;
    use crate::{
        models::{CreateSessionRequest, DiffSummary, RelayMode, ToolPhase, ToolSource},
        storage::AppStorage,
    };
    use serde_json::json;

    #[test]
    fn registers_builtin_tools_and_supports_enable_toggle() {
        let mut registry = ToolRegistry::new();
        assert!(registry.has("workbook.inspect"));
        assert!(registry.has("browser.send_to_copilot"));

        let disabled = registry
            .set_enabled("workbook.inspect", false)
            .expect("tool should toggle");
        assert!(!disabled.enabled);

        let read_descriptors = registry.list_descriptors_by_phase(ToolPhase::Read);
        assert!(!read_descriptors
            .iter()
            .any(|descriptor| descriptor.id == "workbook.inspect"));
    }

    #[test]
    fn invokes_builtin_read_tools() {
        let registry = ToolRegistry::new();
        let mut storage = AppStorage::default();
        let session = storage
            .create_session(CreateSessionRequest {
                title: "Tool test".to_string(),
                objective: "List files".to_string(),
                primary_workbook_path: None,
            })
            .expect("session should create");
        let turn = storage
            .start_turn(crate::models::StartTurnRequest {
                session_id: session.id.clone(),
                title: "Tool turn".to_string(),
                objective: "Inspect stat".to_string(),
                mode: RelayMode::Plan,
            })
            .expect("turn should start")
            .turn;
        let result = registry
            .invoke(
                &storage,
                &session,
                &turn,
                &DiffSummary {
                    source_path: "".to_string(),
                    output_path: "".to_string(),
                    mode: "preview".to_string(),
                    target_count: 0,
                    estimated_affected_rows: 0,
                    sheets: Vec::new(),
                    warnings: Vec::new(),
                },
                "file.stat",
                &json!({
                    "path": std::env::current_dir()
                        .expect("cwd should exist")
                        .display()
                        .to_string()
                }),
            )
            .expect("builtin tool should invoke");

        assert_eq!(
            registry.get("file.stat").map(|tool| tool.source),
            Some(ToolSource::Builtin)
        );
        assert!(result.get("exists").is_some());
    }
}
