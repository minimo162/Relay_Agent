use std::collections::HashMap;

use serde_json::json;

use crate::models::{
    McpServerConfig, ToolDescriptor, ToolPhase, ToolRegistration, ToolSource,
};

pub struct ToolCatalog {
    tools: HashMap<String, ToolRegistration>,
}

impl ToolCatalog {
    pub fn new() -> Self {
        let mut catalog = Self {
            tools: HashMap::new(),
        };
        catalog.register_builtin_tools();
        catalog
    }

    pub fn list(&self) -> Vec<ToolRegistration> {
        let mut tools = self.tools.values().cloned().collect::<Vec<_>>();
        tools.sort_by(|left, right| left.id.cmp(&right.id));
        tools
    }

    pub fn get(&self, tool_id: &str) -> Option<ToolRegistration> {
        self.tools.get(tool_id).cloned()
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
        let tool = self
            .tools
            .get_mut(tool_id)
            .ok_or_else(|| format!("unknown tool: {tool_id}"))?;
        tool.enabled = enabled;
        Ok(tool.clone())
    }

    pub fn list_descriptors_by_phase(&self, phase: ToolPhase) -> Vec<ToolDescriptor> {
        let mut descriptors = self
            .tools
            .values()
            .filter(|tool| tool.enabled && tool.phase == phase)
            .map(|tool| ToolDescriptor {
                id: tool.id.clone(),
                title: tool.title.clone(),
                description: tool.description.clone(),
                phase: tool.phase,
                requires_approval: tool.requires_approval,
            })
            .collect::<Vec<_>>();
        descriptors.sort_by(|left, right| left.id.cmp(&right.id));
        descriptors
    }

    pub fn register_mcp_tools(
        &mut self,
        server: McpServerConfig,
        tools: Vec<crate::mcp_client::McpToolDefinition>,
    ) -> Vec<String> {
        let mut registered_ids = Vec::new();

        for tool in tools {
            let tool_id = format!("mcp.{}.{}", server.name, tool.name);
            self.tools.insert(
                tool_id.clone(),
                ToolRegistration {
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
                },
            );
            registered_ids.push(tool_id);
        }

        registered_ids
    }

    fn register_builtin_tools(&mut self) {
        for tool in builtin_tools() {
            self.tools.insert(tool.id.clone(), tool);
        }
    }
}

impl Default for ToolCatalog {
    fn default() -> Self {
        Self::new()
    }
}

fn builtin_tools() -> Vec<ToolRegistration> {
    let mut tools = vec![
        registration(
            "workbook.inspect",
            "Inspect workbook",
            "Read workbook metadata, sheets, and basic summary information.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "sheet.preview",
            "Preview sheet rows",
            "Read a small sample of rows from a sheet.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "sheet.profile_columns",
            "Profile columns",
            "Inspect inferred types and sample values for sheet columns.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "session.diff_from_base",
            "Diff from base",
            "Compare the current session state to the original workbook input.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "file.list",
            "List files",
            "Read file and directory names plus basic metadata.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "file.read_text",
            "Read text file",
            "Read UTF-8 or Shift_JIS text content up to 1MB.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "file.stat",
            "Inspect file metadata",
            "Read existence, size, and timestamps for a file or directory.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "text.search",
            "Search text",
            "Search a text file with a regular expression and return context lines.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "document.read_text",
            "Read document text",
            "Extract text from DOCX, PPTX, PDF, and common plain-text files.",
            ToolPhase::Read,
            false,
        ),
        registration(
            "browser.send_to_copilot",
            "Copilot にプロンプト送信",
            "Edge の M365 Copilot にプロンプトを送信し応答を取得",
            ToolPhase::Read,
            false,
        ),
        registration(
            "table.rename_columns",
            "Rename columns",
            "Rename one or more columns in a table or sheet.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "table.cast_columns",
            "Cast columns",
            "Convert one or more columns to new logical types.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "table.filter_rows",
            "Filter rows",
            "Filter table rows into a refined output.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "table.derive_column",
            "Derive column",
            "Create a derived output column from an expression.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "table.group_aggregate",
            "Group aggregate",
            "Group rows and calculate aggregated output columns.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "workbook.save_copy",
            "Save copy",
            "Write the output to a new workbook or CSV copy.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "file.copy",
            "Copy file",
            "Copy a file to a new absolute destination path.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "file.move",
            "Move file",
            "Move or rename a file to a new absolute destination path.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "file.delete",
            "Delete file",
            "Move a file to the recycle bin or permanently delete it.",
            ToolPhase::Write,
            true,
        ),
        registration(
            "text.replace",
            "Replace text",
            "Apply regular-expression search and replace to a text file.",
            ToolPhase::Write,
            true,
        ),
    ];

    if let Some(browser_tool) = tools
        .iter_mut()
        .find(|tool| tool.id == "browser.send_to_copilot")
    {
        browser_tool.parameter_schema = Some(json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string" }
            },
            "required": ["prompt"]
        }));
    }

    tools
}

fn registration(
    id: &str,
    title: &str,
    description: &str,
    phase: ToolPhase,
    requires_approval: bool,
) -> ToolRegistration {
    ToolRegistration {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        phase,
        requires_approval,
        source: ToolSource::Builtin,
        enabled: true,
        parameter_schema: None,
        mcp_server_url: None,
        mcp_transport: None,
    }
}

#[cfg(test)]
mod tests {
    use super::ToolCatalog;
    use crate::models::{McpTransport, ToolPhase, ToolSource};
    use serde_json::json;

    #[test]
    fn registers_builtin_tools_and_supports_enable_toggle() {
        let mut catalog = ToolCatalog::new();
        assert!(catalog.has("workbook.inspect"));
        assert!(catalog.has("browser.send_to_copilot"));

        let disabled = catalog
            .set_enabled("workbook.inspect", false)
            .expect("tool should toggle");
        assert!(!disabled.enabled);

        let read_descriptors = catalog.list_descriptors_by_phase(ToolPhase::Read);
        assert!(!read_descriptors
            .iter()
            .any(|descriptor| descriptor.id == "workbook.inspect"));
    }

    #[test]
    fn register_mcp_tools_marks_source_and_schema() {
        let mut catalog = ToolCatalog::new();
        let registered_tool_ids = catalog.register_mcp_tools(
            crate::models::McpServerConfig {
                url: "http://localhost:3100/mcp".to_string(),
                name: "demo".to_string(),
                transport: McpTransport::Sse,
            },
            vec![crate::mcp_client::McpToolDefinition {
                name: "echo".to_string(),
                description: "Echo arguments".to_string(),
                input_schema: json!({ "type": "object" }),
            }],
        );

        assert_eq!(registered_tool_ids, vec!["mcp.demo.echo".to_string()]);
        assert_eq!(
            catalog.get("mcp.demo.echo").map(|tool| tool.source),
            Some(ToolSource::Mcp)
        );
    }
}
