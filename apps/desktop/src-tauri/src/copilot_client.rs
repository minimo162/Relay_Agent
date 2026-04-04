use std::sync::Arc;

use api::{
    read_base_url, AnthropicClient, AuthSource, ContentBlockDelta as ApiContentBlockDelta,
    InputContentBlock, InputMessage, MessageRequest, MessageResponse,
    OutputContentBlock as ApiOutputContentBlock, StreamEvent as ApiStreamEvent, ToolChoice, ToolResultContentBlock,
};
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, ContentBlock, MessageRole, RuntimeError,
    TokenUsage, FRONTIER_MODEL_NAME,
};

pub use crate::copilot_persistence::{PersistedSessionConfig, LoadedSession, load_session, save_session};

/* ── Copilot API Client — adapts the Copilot Proxy API to runtime::ApiClient ─── */

/// `CopilotStreamEvent` represents streaming chunks from the API.
#[derive(Clone, Debug)]
pub enum CopilotStreamEvent {
    TextDelta(String),
    MessageStop,
}

/// `CopilotApiClient` adapts the Copilot Proxy API (Anthropic-compatible SSE)
/// to implement `runtime::ApiClient` for the agent loop.
pub struct CopilotApiClient {
    client: AnthropicClient,
    runtime: tokio::runtime::Runtime,
    model: String,
    call_count: usize,
    stream_callback: Option<Arc<dyn Fn(CopilotStreamEvent) + Send + Sync>>,
}

impl CopilotApiClient {
    pub fn new() -> Result<Self, RuntimeError> {
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| RuntimeError::new(format!("failed to create tokio runtime: {e}")))?;
        Ok(Self {
            client: AnthropicClient::from_auth(AuthSource::None).with_base_url(read_base_url()),
            runtime,
            model: std::env::var("RELAY_AGENT_MODEL")
                .unwrap_or_else(|_| FRONTIER_MODEL_NAME.to_string()),
            call_count: 0,
            stream_callback: None,
        })
    }

    pub fn new_with_default_settings() -> Result<Self, RuntimeError> {
        Self::new()
    }

    pub fn with_stream_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(CopilotStreamEvent) + Send + Sync + 'static,
    {
        self.stream_callback = Some(Arc::new(callback));
        self
    }

    /// Save a session to disk.
    pub fn save_session(
        &self,
        session_id: &str,
        session: &runtime::Session,
        config: PersistedSessionConfig,
    ) -> Result<(), RuntimeError> {
        save_session(session_id, session, config)
    }

    /// Load a session from disk.
    pub fn load_session(&self, session_id: &str) -> Result<Option<LoadedSession>, RuntimeError> {
        load_session(session_id)
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
