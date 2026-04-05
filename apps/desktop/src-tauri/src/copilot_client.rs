use std::sync::Arc;
use std::time::Duration;

use api::{
    read_base_url, AnthropicClient, AuthSource, ContentBlockDelta as ApiContentBlockDelta,
    InputContentBlock, InputMessage, MessageRequest, MessageResponse,
    OutputContentBlock as ApiOutputContentBlock, StreamEvent as ApiStreamEvent, ToolChoice,
    ToolResultContentBlock,
};
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, ContentBlock, MessageRole, RuntimeError, TokenUsage,
    FRONTIER_MODEL_NAME,
};

/* ── Copilot API Client — adapts the Copilot Proxy API to runtime::ApiClient ─── */

/// `CopilotStreamEvent` represents streaming chunks from the API.
#[derive(Clone, Debug)]
pub enum CopilotStreamEvent {
    TextDelta(String),
    MessageStop,
}

/// `CopilotApiClient` adapts the Copilot Proxy API (Anthropic-compatible SSE)
/// to implement `runtime::ApiClient` for the agent loop.
///
/// This is intended to be created inside `spawn_blocking` or a blocking context.
/// It carries a lightweight embedded tokio runtime to bridge async/sync boundaries.
pub struct CopilotApiClient {
    client: AnthropicClient,
    runtime: tokio::runtime::Runtime,
    model: String,
    call_count: usize,
    stream_callback: Option<Arc<dyn Fn(CopilotStreamEvent) + Send + Sync>>,
}

impl CopilotApiClient {
    pub fn new() -> Result<Self, RuntimeError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::new(format!("failed to create tokio runtime: {e}")))?;

        let auth = AuthSource::from_env_or_saved()
            .map_err(|e| RuntimeError::new(format!("failed to resolve auth: {e}")))?;

        Ok(Self {
            client: AnthropicClient::from_auth(auth).with_base_url(read_base_url()),
            runtime,
            model: std::env::var("RELAY_AGENT_MODEL")
                .unwrap_or_else(|_| FRONTIER_MODEL_NAME.to_string()),
            call_count: 0,
            stream_callback: None,
        })
    }

    /// Create a client with default settings (no stream callback).
    ///
    /// Intended for session-persistence contexts where streaming deltas
    /// are not needed. Equivalent to `new()` — provided for explicit
    /// readability at the call-site.
    pub fn with_default_settings() -> Result<Self, RuntimeError> {
        Self::new()
    }

    pub fn with_stream_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(CopilotStreamEvent) + Send + Sync + 'static,
    {
        self.stream_callback = Some(Arc::new(callback));
        self
    }
}

impl CopilotApiClient {
    #[allow(clippy::too_many_lines)]
    fn try_stream(
        &mut self,
        message_request: &MessageRequest,
    ) -> Result<Vec<AssistantEvent>, RuntimeError> {
        self.runtime.block_on(async {
            let mut stream = self
                .client
                .stream_message(message_request)
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
                        push_output_block(
                            start.content_block,
                            &mut events,
                            &mut pending_tool,
                            true,
                        );
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

impl ApiClient for CopilotApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        self.call_count += 1;
        let max_tokens = crate::config::AgentConfig::global().max_tokens as u32;
        let max_retries = crate::config::AgentConfig::global().api_retry_count;
        let message_request = MessageRequest {
            model: self.model.clone(),
            max_tokens,
            messages: convert_messages(&request.messages),
            system: (!request.system_prompt.is_empty()).then(|| request.system_prompt.join("\n\n")),
            tools: Some(tools::tool_definitions_for_copilot()),
            tool_choice: Some(ToolChoice::Auto),
            stream: true,
        };

        let mut last_error = None;
        for attempt in 0..=max_retries {
            if attempt > 0 {
                let delay = 500 * 2u64.pow((attempt - 1) as u32);
                tracing::info!(
                    "[CopilotClient] retrying API call (attempt {}/{}, delay {}ms)",
                    attempt + 1,
                    max_retries + 1,
                    delay
                );
                std::thread::sleep(Duration::from_millis(delay));
            }

            match self.try_stream(&message_request) {
                Ok(events) => return Ok(events),
                Err(e) if is_retryable_error(&e) && attempt < max_retries => {
                    tracing::warn!("[CopilotClient] transient API error (attempt {}): {e}", attempt + 1);
                    last_error = Some(e);
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err(last_error.unwrap_or_else(|| {
            RuntimeError::new("API retry exhausted with no error captured".to_string())
        }))
    }
}

/// Returns `true` for transient errors worth retrying (5xx, network failures).
/// Returns `false` for permanent errors (4xx auth errors, bad requests).
fn is_retryable_error(error: &RuntimeError) -> bool {
    let msg = error.to_string().to_lowercase();
    // 4xx errors are permanent — do not retry
    if msg.contains("400") || msg.contains("401") || msg.contains("403") || msg.contains("404") {
        return false;
    }
    // 5xx, network errors, timeouts, connection resets — retry
    msg.contains("500")
        || msg.contains("502")
        || msg.contains("503")
        || msg.contains("529")
        || msg.contains("timeout")
        || msg.contains("connection")
        || msg.contains("network")
        || msg.contains("dns")
        || msg.contains("reset")
        || msg.contains("eof")
        || msg.contains("overloaded")
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
