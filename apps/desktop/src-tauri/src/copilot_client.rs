use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use runtime::{
    ApiClient, ApiRequest, AssistantEvent, ContentBlock, ConversationMessage, RuntimeError,
    TokenUsage,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::models::BrowserAutomationSettings;

/* ── Copilot Chat Provider (M365 Copilot via Edge CDP) ─── */

const DEFAULT_CDP_PORT: u16 = 9222;
const DEFAULT_TIMEOUT_MS: u32 = 120_000;
const DEFAULT_AUTO_LAUNCH_EDGE: bool = true;

/// CopilotChatProvider — wraps M365 Copilot (Edge CDP + Node.js script)
/// to produce `ModelResponse` compatible output.
pub struct CopilotChatProvider {
    settings: BrowserAutomationSettings,
    script_path: Option<PathBuf>,
    retry_limit: usize,
}

impl CopilotChatProvider {
    pub fn new(settings: BrowserAutomationSettings) -> Self {
        Self {
            settings,
            script_path: None,
            retry_limit: 1,
        }
    }

    pub fn with_default_settings() -> Self {
        Self::new(BrowserAutomationSettings {
            cdp_port: DEFAULT_CDP_PORT,
            auto_launch_edge: DEFAULT_AUTO_LAUNCH_EDGE,
            timeout_ms: DEFAULT_TIMEOUT_MS,
        })
    }

    /// Send a prompt to Copilot and parse the response.
    pub fn send_prompt(&self, prompt: &str) -> anyhow::Result<String> {
        let script_path = self.resolve_script_path()?;
        let mut args = vec![
            script_path.display().to_string(),
            "--action".to_string(),
            "send".to_string(),
        ];

        if self.settings.auto_launch_edge {
            args.push("--auto-launch".to_string());
        } else {
            args.push("--cdp-port".to_string());
            args.push(self.settings.cdp_port.to_string());
        }

        args.push("--timeout".to_string());
        args.push(self.settings.timeout_ms.to_string());
        args.push("--prompt".to_string());
        args.push(prompt.to_string());

        let output = Command::new("node")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| anyhow::anyhow!("failed to start copilot-browser.js: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            anyhow::bail!(
                "Copilot browser command failed (exit {:?}): {}\n{}",
                output.status.code(),
                stderr.trim(),
                stdout.trim()
            );
        }

        let mut stdout = String::new();
        std::io::Cursor::new(output.stdout)
            .read_to_string(&mut stdout)
            .map_err(|e| anyhow::anyhow!("failed to read stdout: {e}"))?;

        parse_copilot_output(&stdout)
    }

    fn resolve_script_path(&self) -> anyhow::Result<PathBuf> {
        if let Some(path) = &self.script_path {
            if path.is_file() {
                return Ok(path.clone());
            }
        }

        if let Ok(path) = std::env::var("RELAY_AGENT_COPILOT_SCRIPT") {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        // Search relative to the binary working directory
        let mut candidates = Vec::new();
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("scripts").join("dist").join("copilot-browser.js"));
            candidates.push(
                cwd.join("apps")
                    .join("desktop")
                    .join("scripts")
                    .join("dist")
                    .join("copilot-browser.js"),
            );
        }

        candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "copilot-browser.js not found. Run: pnpm --filter @relay-agent/desktop copilot-browser:build"
                )
            })
    }
}

/* ── Copilot API Client — adapts Copilot to runtime::ApiClient ─── */

/// CopilotApiClient wraps CopilotChatProvider to implement runtime::ApiClient.
/// This is the bridge between ConversationRuntime and M365 Copilot.
///
/// Unlike Anthropic's streaming SSE, Copilot returns a full response in one shot,
/// so we simulate the streaming events post-hoc.
pub struct CopilotApiClient {
    provider: CopilotChatProvider,
    call_count: usize,
}

impl CopilotApiClient {
    pub fn new(provider: CopilotChatProvider) -> Self {
        Self {
            provider,
            call_count: 0,
        }
    }

    pub fn new_with_default_settings() -> Self {
        Self {
            provider: CopilotChatProvider::with_default_settings(),
            call_count: 0,
        }
    }

    /// Format an ApiRequest into a prompt for Copilot.
    /// Copilot expects a natural-language prompt with tool definitions.
    fn format_prompt(&self, request: &ApiRequest) -> String {
        let system = request.system_prompt.join("\n\n");
        let messages = request
            .messages
            .iter()
            .map(|msg| match msg.role {
                runtime::MessageRole::User => format!("User: {}", msg.blocks.iter().filter_map(|b| match b {
                    ContentBlock::Text { text } => Some(text.clone()),
                    ContentBlock::ToolResult { output, .. } => Some(output.clone()),
                    _ => None,
                }).collect::<Vec<_>>().join("\n")),
                runtime::MessageRole::Assistant => format!("Assistant: {}", msg.blocks.iter().filter_map(|b| match b {
                    ContentBlock::Text { text } => Some(text.clone()),
                    _ => None,
                }).collect::<Vec<_>>().join("\n")),
                runtime::MessageRole::Tool => format!("[Tool Result] {}", msg.blocks.iter().filter_map(|b| match b {
                    ContentBlock::ToolResult { output, .. } => Some(output.clone()),
                    _ => None,
                }).collect::<Vec<_>>().join("\n")),
                runtime::MessageRole::System => String::new(),
            })
            .collect::<Vec<_>>()
            .join("\n");

        let tools = self.tool_definitions_json();

        format!(
            concat!(
                "You are an autonomous agent running inside a Tauri desktop app.\n",
                "Return your response as a JSON object with this exact schema:\n",
                "{{\n",
                "  \"content\": [\n",
                "    {{ \"type\": \"text\", \"text\": \"your response\" }},\n",
                "    {{ \"type\": \"tool_use\", \"id\": \"call-1\", \"name\": \"tool_name\", \"input\": {{}} }}\n",
                "  ]\n",
                "}}\n\n",
                "System:\n{system}\n\n",
                "Available tools:\n{tools}\n\n",
                "Conversation:\n{messages}\n\n",
                "Respond with a JSON object only. No markdown fences."
            ),
            system = system,
            messages = messages,
            tools = tools,
        )
    }

    fn tool_definitions_json(&self) -> String {
        // These are the tools available in the runtime.
        // For now, Copilot is prompted generically; the actual tool dispatch
        // is handled by runtime::StaticToolExecutor / tools crate.
        serde_json::to_string_pretty(&json!([
            { "name": "bash", "description": "Execute a shell command", "input_schema": { "type": "object", "properties": { "command": { "type": "string" } }, "required": ["command"] }},
            { "name": "read_file", "description": "Read a file", "input_schema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }},
            { "name": "write_file", "description": "Write a file", "input_schema": { "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } }, "required": ["path", "content"] }},
            { "name": "edit_file", "description": "Edit a file", "input_schema": { "type": "object", "properties": { "path": { "type": "string" }, "old_string": { "type": "string" }, "new_string": { "type": "string" } }, "required": ["path", "old_string", "new_string"] }},
            { "name": "glob_search", "description": "Find files by glob pattern", "input_schema": { "type": "object", "properties": { "pattern": { "type": "string" } }, "required": ["pattern"] }},
            { "name": "grep_search", "description": "Search file contents with regex", "input_schema": { "type": "object", "properties": { "pattern": {  "type": "string" } }, "required": ["pattern"] }},
            { "name": "TodoWrite", "description": "Update the task list", "input_schema": { "type": "object", "properties": { "todos": { "type": "array", "items": { "type": "object" } } }, "required": ["todos"] }},
            { "name": "WebSearch", "description": "Search the web", "input_schema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }},
            { "name": "WebFetch", "description": "Fetch a URL", "input_schema": { "type": "object", "properties": { "url": { "type": "string" }, "prompt": { "type": "string" } }, "required": ["url", "prompt"] }},
        ])).unwrap_or_default()
    }
}

impl ApiClient for CopilotApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        self.call_count += 1;
        let prompt = self.format_prompt(&request);

        let raw = self
            .provider
            .send_prompt(&prompt)
            .map_err(|e| RuntimeError::new(format!("Copilot API error: {e}")))?;

        parse_copilot_to_events(&raw).map(|events| {
            // Ensure MessageStop is present
            if !events.iter().any(|e| matches!(e, AssistantEvent::MessageStop)) {
                let mut e = events;
                e.push(AssistantEvent::MessageStop);
                e
            } else {
                events
            }
        })
    }
}

/* ── Response parsing ─── */

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CopilotContent {
    Text {
        #[serde(rename = "type")]
        _type: String,
        text: String,
    },
    ToolUse {
        #[serde(rename = "type")]
        _type: String,
        id: Option<String>,
        name: String,
        input: Value,
    },
}

#[derive(Debug, Deserialize)]
struct CopilotResponse {
    content: Vec<CopilotContent>,
}

fn parse_copilot_output(stdout: &str) -> anyhow::Result<String> {
    // The copilot-browser.js returns a JSON line with status/response
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(obj) = value.as_object() {
                if let Some(status) = obj.get("status").and_then(Value::as_str) {
                    match status {
                        "ok" => {
                            return obj
                                .get("response")
                                .and_then(Value::as_str)
                                .map(|s| s.trim().to_string())
                                .ok_or_else(|| {
                                    anyhow::anyhow!("Copilot response missing `response` field")
                                });
                        }
                        "error" => {
                            let msg = obj
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Copilot returned an error");
                            anyhow::bail!("{msg}");
                        }
                        other => {
                            anyhow::bail!("Unexpected Copilot status: {other}")
                        }
                    }
                }
            }
            // Not a status envelope — might be the raw JSON response
            return Ok(trimmed.to_string());
        }
    }

    // No JSON found — return as-is if non-empty
    let non_empty = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if non_empty.is_empty() {
        anyhow::bail!("Copilot returned empty output");
    }

    Ok(non_empty)
}

fn parse_copilot_to_events(raw: &str) -> Result<Vec<AssistantEvent>, RuntimeError> {
    // Try to extract JSON from the raw response
    let json_str = extract_json(raw).ok_or_else(|| {
        RuntimeError::new(format!(
            "Could not parse JSON from Copilot response: {}",
            raw.chars().take(200).collect::<String>()
        ))
    })?;

    let response: CopilotResponse =
        serde_json::from_str(&json_str).map_err(|e| RuntimeError::new(format!("JSON parse error: {e}")))?;

    let mut events = Vec::new();

    for item in response.content {
        match item {
            CopilotContent::Text { text, .. } => {
                if !text.is_empty() {
                    events.push(AssistantEvent::TextDelta(text));
                }
            }
            CopilotContent::ToolUse { id, name, input, .. } => {
                events.push(AssistantEvent::ToolUse {
                    id: id.unwrap_or_else(|| format!("call-{}", uuid::Uuid::new_v4())),
                    name,
                    input: serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string()),
                });
            }
        }
    }

    events.push(AssistantEvent::Usage(TokenUsage {
        input_tokens: 0,  // Copilot doesn't expose token counts
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
    }));

    Ok(events)
}

fn extract_json(raw: &str) -> Option<String> {
    // 1. Try direct parse
    if serde_json::from_str::<Value>(raw.trim()).is_ok() {
        return Some(raw.trim().to_string());
    }

    // 2. Try fenced code blocks
    if let Some(start) = raw.find("```json") {
        let after = &raw[start + 7..];
        if let Some(end) = after.find("```") {
            let block = after[..end].trim();
            if serde_json::from_str::<Value>(block).is_ok() {
                return Some(block.to_string());
            }
        }
    }

    // 3. Try any ``` block
    if let Some(start) = raw.find("```") {
        let after = &raw[start + 3..];
        // Skip language identifier if present
        let after = if let Some(newline) = after.find('\n') {
            &after[newline + 1..]
        } else {
            after
        };
        if let Some(end) = after.find("```") {
            let block = after[..end].trim();
            if serde_json::from_str::<Value>(block).is_ok() {
                return Some(block.to_string());
            }
        }
    }

    // 4. Balanced brace matching
    if let Some(s) = find_balanced_json_object(raw) {
        return Some(s);
    }

    None
}

fn find_balanced_json_object(raw: &str) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (i, ch) in raw.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }

        match ch {
            '\\' if in_string => {
                escaped = true;
            }
            '"' => {
                in_string = !in_string;
            }
            '{' if !in_string => {
                if start.is_none() {
                    start = Some(i);
                }
                depth += 1;
            }
            '}' if !in_string => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    if let Some(begin) = start {
                        let candidate = &raw[begin..=i];
                        if serde_json::from_str::<Value>(candidate).is_ok() {
                            return Some(candidate.to_string());
                        }
                        start = None;
                        continue;
                    }
                }
            }
            _ => {}
        }
    }

    None
}
