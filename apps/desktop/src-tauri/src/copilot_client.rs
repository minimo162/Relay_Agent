use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use api::{
    read_base_url, AnthropicClient, AuthSource, ContentBlockDelta as ApiContentBlockDelta,
    InputContentBlock, InputMessage, MessageRequest, MessageResponse,
    OutputContentBlock as ApiOutputContentBlock, StreamEvent as ApiStreamEvent, ToolChoice, ToolResultContentBlock,
};
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, ContentBlock, MessageRole, RuntimeError, Session,
    TokenUsage, FRONTIER_MODEL_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/* ── Copilot API Client — adapts the Copilot Proxy API to runtime::ApiClient ─── */

/// CopilotApiClient adapts the Copilot Proxy API (Anthropic-compatible SSE)
/// to implement runtime::ApiClient for the agent loop.
pub struct CopilotApiClient {
    client: AnthropicClient,
    runtime: tokio::runtime::Runtime,
    model: String,
    call_count: usize,
    stream_callback: Option<Arc<dyn Fn(CopilotStreamEvent) + Send + Sync>>,
}

#[derive(Clone, Debug)]
pub enum CopilotStreamEvent {
    TextDelta(String),
    MessageStop,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct LoadedSession {
    pub session: Session,
    pub config: PersistedSessionConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSessionRecord {
    pub session_id: String,
    pub version: u32,
    pub messages: Vec<PersistedMessage>,
    #[serde(default)]
    pub config: PersistedSessionConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMessage {
    pub role: String,
    pub blocks: Vec<PersistedContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<PersistedTokenUsage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PersistedContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: String,
    },
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        output: String,
        is_error: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_creation_input_tokens: u32,
    pub cache_read_input_tokens: u32,
}

impl CopilotApiClient {
    pub fn new() -> Self {
        Self {
            client: AnthropicClient::from_auth(AuthSource::None).with_base_url(read_base_url()),
            runtime: tokio::runtime::Runtime::new()
                .expect("failed to create tokio runtime for CopilotApiClient"),
            model: std::env::var("RELAY_AGENT_MODEL")
                .unwrap_or_else(|_| FRONTIER_MODEL_NAME.to_string()),
            call_count: 0,
            stream_callback: None,
        }
    }

    pub fn new_with_default_settings() -> Self {
        Self::new()
    }

    pub fn with_stream_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(CopilotStreamEvent) + Send + Sync + 'static,
    {
        self.stream_callback = Some(Arc::new(callback));
        self
    }

    pub fn save_session(
        &self,
        session_id: &str,
        session: &Session,
        config: PersistedSessionConfig,
    ) -> Result<(), RuntimeError> {
        validate_session_id(session_id).map_err(|e| RuntimeError::new(format!("invalid session_id: {e}")))?;
        let dir = session_storage_dir()?;
        fs::create_dir_all(&dir).map_err(io_error)?;
        let path = dir.join(format!("{session_id}.json"));
        let record = PersistedSessionRecord {
            session_id: session_id.to_string(),
            version: session.version,
            messages: session
                .messages
                .iter()
                .map(PersistedMessage::from_runtime)
                .collect(),
            config,
        };
        let json = serde_json::to_string_pretty(&record)
            .map_err(|error| RuntimeError::new(format!("failed to serialize session: {error}")))?;
        fs::write(path, json).map_err(io_error)
    }

    pub fn load_session(&self, session_id: &str) -> Result<Option<LoadedSession>, RuntimeError> {
        validate_session_id(session_id).map_err(|e| RuntimeError::new(format!("invalid session_id: {e}")))?;
        let path = session_storage_dir()?.join(format!("{session_id}.json"));
        if !path.is_file() {
            return Ok(None);
        }

        let contents = fs::read_to_string(&path).map_err(io_error)?;
        let record: PersistedSessionRecord = serde_json::from_str(&contents)
            .map_err(|error| RuntimeError::new(format!("failed to parse saved session: {error}")))?;

        let messages = record
            .messages
            .into_iter()
            .map(PersistedMessage::into_runtime)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Some(LoadedSession {
            session: Session {
                version: record.version,
                messages,
            },
            config: record.config,
        }))
    }
}

impl ApiClient for CopilotApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        self.call_count += 1;
        let message_request = MessageRequest {
            model: self.model.clone(),
            max_tokens: 32_000,
            messages: convert_messages(&request.messages),
            system: (!request.system_prompt.is_empty()).then(|| request.system_prompt.join("\n\n")),
            tools: Some(tools::tool_definitions_for_copilot()),
            tool_choice: Some(ToolChoice::Auto),
            stream: true,
        };

        self.runtime.block_on(async {
            let mut stream = self
                .client
                .stream_message(&message_request)
                .await
                .map_err(|error| RuntimeError::new(format!("Copilot API error: {error}")))?;
            let mut events = Vec::new();
            let mut pending_tool: Option<(String, String, String)> = None;
            let mut saw_stop = false;

            while let Some(event) = stream
                .next_event()
                .await
                .map_err(|error| RuntimeError::new(format!("Copilot API error: {error}")))?
            {
                match event {
                    ApiStreamEvent::MessageStart(start) => {
                        for block in start.message.content {
                            push_output_block(block, &mut events, &mut pending_tool, true);
                        }
                    }
                    ApiStreamEvent::ContentBlockStart(start) => {
                        push_output_block(start.content_block, &mut events, &mut pending_tool, true);
                    }
                    ApiStreamEvent::ContentBlockDelta(delta) => match delta.delta {
                        ApiContentBlockDelta::TextDelta { text } => {
                            if !text.is_empty() {
                                if let Some(callback) = &self.stream_callback {
                                    callback(CopilotStreamEvent::TextDelta(text.clone()));
                                }
                                events.push(AssistantEvent::TextDelta(text));
                            }
                        }
                        ApiContentBlockDelta::InputJsonDelta { partial_json } => {
                            if let Some((_, _, input)) = &mut pending_tool {
                                input.push_str(&partial_json);
                            }
                        }
                    },
                    ApiStreamEvent::ContentBlockStop(_) => {
                        if let Some((id, name, input)) = pending_tool.take() {
                            events.push(AssistantEvent::ToolUse { id, name, input });
                        }
                    }
                    ApiStreamEvent::MessageDelta(delta) => {
                        events.push(AssistantEvent::Usage(TokenUsage {
                            input_tokens: delta.usage.input_tokens,
                            output_tokens: delta.usage.output_tokens,
                            cache_creation_input_tokens: delta.usage.cache_creation_input_tokens,
                            cache_read_input_tokens: delta.usage.cache_read_input_tokens,
                        }));
                    }
                    ApiStreamEvent::MessageStop(_) => {
                        saw_stop = true;
                        if let Some(callback) = &self.stream_callback {
                            callback(CopilotStreamEvent::MessageStop);
                        }
                        events.push(AssistantEvent::MessageStop);
                    }
                }
            }

            if !saw_stop
                && events.iter().any(|event| {
                    matches!(event, AssistantEvent::TextDelta(text) if !text.is_empty())
                        || matches!(event, AssistantEvent::ToolUse { .. })
                })
            {
                if let Some(callback) = &self.stream_callback {
                    callback(CopilotStreamEvent::MessageStop);
                }
                events.push(AssistantEvent::MessageStop);
            }

            if events
                .iter()
                .any(|event| matches!(event, AssistantEvent::MessageStop))
            {
                return Ok(events);
            }

            let response = self
                .client
                .send_message(&MessageRequest {
                    stream: false,
                    ..message_request.clone()
                })
                .await
                .map_err(|error| RuntimeError::new(format!("Copilot API error: {error}")))?;
            Ok(response_to_events(response))
        })
    }
}

fn convert_messages(messages: &[runtime::ConversationMessage]) -> Vec<InputMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let role = match message.role {
                MessageRole::System | MessageRole::User | MessageRole::Tool => "user",
                MessageRole::Assistant => "assistant",
            };
            let content = message
                .blocks
                .iter()
                .map(|block| match block {
                    ContentBlock::Text { text } => InputContentBlock::Text { text: text.clone() },
                    ContentBlock::ToolUse { id, name, input } => InputContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: serde_json::from_str(input)
                            .unwrap_or_else(|_| serde_json::json!({ "raw": input })),
                    },
                    ContentBlock::ToolResult {
                        tool_use_id,
                        output,
                        is_error,
                        ..
                    } => InputContentBlock::ToolResult {
                        tool_use_id: tool_use_id.clone(),
                        content: vec![ToolResultContentBlock::Text {
                            text: output.clone(),
                        }],
                        is_error: *is_error,
                    },
                })
                .collect::<Vec<_>>();
            (!content.is_empty()).then(|| InputMessage {
                role: role.to_string(),
                content,
            })
        })
        .collect()
}

fn push_output_block(
    block: ApiOutputContentBlock,
    events: &mut Vec<AssistantEvent>,
    pending_tool: &mut Option<(String, String, String)>,
    streaming_tool_input: bool,
) {
    match block {
        ApiOutputContentBlock::Text { text } => {
            if !text.is_empty() {
                events.push(AssistantEvent::TextDelta(text));
            }
        }
        ApiOutputContentBlock::ToolUse { id, name, input } => {
            let initial_input = if streaming_tool_input
                && input.is_object()
                && input.as_object().is_some_and(serde_json::Map::is_empty)
            {
                String::new()
            } else {
                input.to_string()
            };
            *pending_tool = Some((id, name, initial_input));
        }
    }
}

fn response_to_events(response: MessageResponse) -> Vec<AssistantEvent> {
    let mut events = Vec::new();
    let mut pending_tool = None;

    for block in response.content {
        push_output_block(block, &mut events, &mut pending_tool, false);
        if let Some((id, name, input)) = pending_tool.take() {
            events.push(AssistantEvent::ToolUse { id, name, input });
        }
    }

    events.push(AssistantEvent::Usage(TokenUsage {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
    }));
    events.push(AssistantEvent::MessageStop);
    events
}

fn session_storage_dir() -> Result<PathBuf, RuntimeError> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| RuntimeError::new("unable to resolve the home directory for session storage"))?;
    Ok(home.join(".relay-agent").join("sessions"))
}

/// Validates a session_id for safe use in filesystem paths.
/// Ensures it contains only alphanumeric characters, hyphens, and underscores,
/// rejects path traversal sequences, and limits length to 128 characters.
fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if id.len() > 128 {
        return Err(format!(
            "session_id exceeds maximum length of 128 characters (got {})",
            id.len()
        ));
    }
    for ch in id.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_' {
            return Err(format!(
                "session_id contains invalid character '{}' (only alphanumeric, hyphens, and underscores are allowed)",
                ch
            ));
        }
    }
    Ok(())
}

fn io_error(error: std::io::Error) -> RuntimeError {
    RuntimeError::new(format!("session persistence failed: {error}"))
}

impl PersistedMessage {
    fn from_runtime(message: &runtime::ConversationMessage) -> Self {
        Self {
            role: match message.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
            }
            .to_string(),
            blocks: message
                .blocks
                .iter()
                .map(PersistedContentBlock::from_runtime)
                .collect(),
            usage: message.usage.map(Into::into),
        }
    }

    fn into_runtime(self) -> Result<runtime::ConversationMessage, RuntimeError> {
        let role = match self.role.as_str() {
            "system" => MessageRole::System,
            "user" => MessageRole::User,
            "assistant" => MessageRole::Assistant,
            "tool" => MessageRole::Tool,
            other => {
                return Err(RuntimeError::new(format!(
                    "unsupported saved message role `{other}`"
                )))
            }
        };

        Ok(runtime::ConversationMessage {
            role,
            blocks: self
                .blocks
                .into_iter()
                .map(PersistedContentBlock::into_runtime)
                .collect(),
            usage: self.usage.map(Into::into),
        })
    }
}

impl PersistedContentBlock {
    fn from_runtime(block: &ContentBlock) -> Self {
        match block {
            ContentBlock::Text { text } => Self::Text { text: text.clone() },
            ContentBlock::ToolUse { id, name, input } => Self::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            },
            ContentBlock::ToolResult {
                tool_use_id,
                tool_name,
                output,
                is_error,
            } => Self::ToolResult {
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.clone(),
                output: output.clone(),
                is_error: *is_error,
            },
        }
    }

    fn into_runtime(self) -> ContentBlock {
        match self {
            Self::Text { text } => ContentBlock::Text { text },
            Self::ToolUse { id, name, input } => ContentBlock::ToolUse { id, name, input },
            Self::ToolResult {
                tool_use_id,
                tool_name,
                output,
                is_error,
            } => ContentBlock::ToolResult {
                tool_use_id,
                tool_name,
                output,
                is_error,
            },
        }
    }
}

impl From<TokenUsage> for PersistedTokenUsage {
    fn from(value: TokenUsage) -> Self {
        Self {
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            cache_creation_input_tokens: value.cache_creation_input_tokens,
            cache_read_input_tokens: value.cache_read_input_tokens,
        }
    }
}

impl From<PersistedTokenUsage> for TokenUsage {
    fn from(value: PersistedTokenUsage) -> Self {
        Self {
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            cache_creation_input_tokens: value.cache_creation_input_tokens,
            cache_read_input_tokens: value.cache_read_input_tokens,
        }
    }
}

/* ── Response parsing ─── */

#[derive(Debug, Deserialize)]
#[serde(untagged)]
// Node.js browser bridge — dead code awaiting removal.
// These parse the output of a Node.js script that talks to Copilot via CDP.
// The canonical path now uses the Anthropic API client directly (stream method).
// Remove this entire block once the CDP Copilot browser integration is re-architected.

#[allow(dead_code)]
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
#[allow(dead_code)]
struct CopilotResponse {
    content: Vec<CopilotContent>,
}

// Node.js browser bridge helper functions — dead code.
// Used only by send_copilot_prompt_via_browser which itself is never called.
// The canonical path is the Anthropic API client (stream method above).
#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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
