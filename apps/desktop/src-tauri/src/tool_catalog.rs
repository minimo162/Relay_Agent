use std::collections::HashMap;

use serde_json::json;

use crate::models::{McpServerConfig, ToolPhase, ToolRegistration, ToolSource};

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
            "browser.send_to_copilot",
            "Copilot にプロンプト送信",
            "Edge の M365 Copilot にプロンプトを送信し応答を取得",
            ToolPhase::Read,
            false,
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
    use crate::models::{McpTransport, ToolSource};
    use serde_json::json;

    #[test]
    fn registers_builtin_tools_and_supports_enable_toggle() {
        let mut catalog = ToolCatalog::new();
        assert!(catalog.has("file.list"));
        assert!(catalog.has("browser.send_to_copilot"));

        let disabled = catalog
            .set_enabled("file.list", false)
            .expect("tool should toggle");
        assert!(!disabled.enabled);

        assert!(!catalog.list().iter().any(|tool| tool.enabled
            && tool.phase == crate::models::ToolPhase::Read
            && tool.id == "file.list"));
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
            catalog
                .list()
                .into_iter()
                .find(|tool| tool.id == "mcp.demo.echo")
                .map(|tool| tool.source),
            Some(ToolSource::Mcp)
        );
    }
}
