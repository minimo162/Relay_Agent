use std::{
    env,
    io::Read,
    path::PathBuf,
    pin::Pin,
    process::{Command, Stdio},
};

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use claw_provider::{
    ModelProvider, ModelRequest, ModelResponse, ResponseContent, StopReason, StreamEvent, Usage,
};
use futures::{stream, Stream};
use serde::Deserialize;
use serde_json::Value;
use tauri::async_runtime;
use uuid::Uuid;

use crate::models::BrowserAutomationSettings;

const DEFAULT_CDP_PORT: u16 = 9222;
const DEFAULT_TIMEOUT_MS: u32 = 120_000;
const DEFAULT_AUTO_LAUNCH_EDGE: bool = true;

#[derive(Clone, Debug)]
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

    #[cfg(test)]
    fn with_script_path(mut self, script_path: PathBuf) -> Self {
        self.script_path = Some(script_path);
        self
    }

    fn format_for_copilot(&self, request: &ModelRequest) -> Result<String> {
        let tools = request.tools.as_deref().unwrap_or(&[]);
        let tools_json = serde_json::to_string_pretty(tools)?;
        let messages_json = serde_json::to_string_pretty(&request.messages)?;
        let system_prompt = request.system.as_deref().unwrap_or("").trim();

        Ok(format!(
            concat!(
                "You are the model backend for a local agent runtime.\n",
                "Return exactly one JSON object and no markdown fences.\n\n",
                "Response schema:\n",
                "{{\n",
                "  \"assistantMessage\": \"string\",\n",
                "  \"toolUses\": [\n",
                "    {{ \"id\": \"toolu_1\", \"name\": \"tool_name\", \"input\": {{}} }}\n",
                "  ]\n",
                "}}\n\n",
                "Rules:\n",
                "- Use exact tool names from the provided tool list.\n",
                "- Return `toolUses: []` when no tool is needed.\n",
                "- `assistantMessage` should contain the user-visible answer or next-step note.\n",
                "- Do not add fields outside the schema.\n\n",
                "Model: {model}\n",
                "Max tokens: {max_tokens}\n\n",
                "System prompt:\n",
                "{system_prompt}\n\n",
                "Available tools:\n",
                "{tools_json}\n\n",
                "Conversation:\n",
                "{messages_json}\n"
            ),
            model = request.model,
            max_tokens = request.max_tokens,
            system_prompt = system_prompt,
            tools_json = tools_json,
            messages_json = messages_json,
        ))
    }

    async fn send_prompt(&self, prompt: String) -> Result<String> {
        let runner = self.clone();
        async_runtime::spawn_blocking(move || runner.send_prompt_blocking(&prompt))
            .await
            .map_err(|error| anyhow!("Copilot browser task failed: {error}"))?
    }

    fn send_prompt_blocking(&self, prompt: &str) -> Result<String> {
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
            .context("failed to start the Copilot browser automation command")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            bail!(
                "Copilot browser command failed with exit code {:?}: {}{}",
                output.status.code(),
                stderr,
                if stdout.is_empty() {
                    String::new()
                } else {
                    format!(" {stdout}")
                }
            );
        }

        let mut stdout = String::new();
        std::io::Cursor::new(output.stdout)
            .read_to_string(&mut stdout)
            .context("failed to read Copilot browser stdout")?;

        parse_send_response(&stdout)
    }

    fn resolve_script_path(&self) -> Result<PathBuf> {
        if let Some(path) = self.script_path.as_ref() {
            if path.is_file() {
                return Ok(path.clone());
            }
            bail!(
                "Configured Copilot browser script does not exist: {}",
                path.display()
            );
        }

        if let Ok(path) = env::var("RELAY_AGENT_TEST_COPILOT_SCRIPT_PATH") {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut candidates = Vec::new();

        if let Ok(current_dir) = env::current_dir() {
            candidates.push(
                current_dir
                    .join("apps")
                    .join("desktop")
                    .join("scripts")
                    .join("dist")
                    .join("copilot-browser.js"),
            );
        }

        candidates.push(
            manifest_dir
                .join("..")
                .join("scripts")
                .join("dist")
                .join("copilot-browser.js"),
        );

        candidates
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| {
                anyhow!(
                    "Could not resolve copilot-browser.js. Run `pnpm --filter @relay-agent/desktop copilot-browser:build` first."
                )
            })
    }

    fn parse_copilot_response(&self, raw_response: &str) -> Result<ModelResponse> {
        match parse_structured_response(raw_response)? {
            Some(structured) => Ok(structured),
            None => Ok(ModelResponse {
                id: format!("copilot-{}", Uuid::new_v4()),
                content: vec![ResponseContent::Text(raw_response.trim().to_string())],
                stop_reason: Some(StopReason::EndTurn),
                usage: Usage::default(),
            }),
        }
    }

    fn build_repair_prompt(
        &self,
        request: &ModelRequest,
        raw_response: &str,
        error: &str,
    ) -> Result<String> {
        Ok(format!(
            concat!(
                "{}\n\n",
                "The previous response was not valid for the required schema.\n",
                "Validation error: {}\n\n",
                "Previous response:\n",
                "{}\n\n",
                "Resend only a valid JSON object that matches the schema."
            ),
            self.format_for_copilot(request)?,
            error,
            raw_response
        ))
    }
}

#[async_trait]
impl ModelProvider for CopilotChatProvider {
    async fn complete(&self, request: ModelRequest) -> Result<ModelResponse> {
        let prompt = self.format_for_copilot(&request)?;
        let mut attempts = 0;
        let mut current_prompt = prompt;

        loop {
            let raw_response = self.send_prompt(current_prompt.clone()).await?;
            match self.parse_copilot_response(&raw_response) {
                Ok(response) => return Ok(response),
                Err(error) if attempts < self.retry_limit => {
                    attempts += 1;
                    current_prompt =
                        self.build_repair_prompt(&request, &raw_response, &error.to_string())?;
                }
                Err(error) => return Err(error),
            }
        }
    }

    async fn stream(
        &self,
        request: ModelRequest,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        let response = self.complete(request).await?;
        Ok(Box::pin(stream::iter(response_to_stream_events(response))))
    }

    fn name(&self) -> &str {
        "copilot-chat"
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotEnvelope {
    #[serde(
        default,
        alias = "assistant_message",
        alias = "assistantText",
        alias = "message",
        alias = "text",
        alias = "summary",
        alias = "response"
    )]
    assistant_message: Option<String>,
    #[serde(
        default,
        alias = "tool_uses",
        alias = "toolCalls",
        alias = "tool_calls"
    )]
    tool_uses: Vec<CopilotToolUse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotToolUse {
    #[serde(default)]
    id: Option<String>,
    name: String,
    #[serde(default = "empty_object")]
    input: Value,
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
}

fn parse_send_response(stdout: &str) -> Result<String> {
    let payload = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
        .ok_or_else(|| anyhow!("Copilot browser script did not return JSON"))?;

    let record = payload
        .as_object()
        .ok_or_else(|| anyhow!("Copilot browser JSON response must be an object"))?;

    match record.get("status").and_then(Value::as_str) {
        Some("ok") => record
            .get("response")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .ok_or_else(|| anyhow!("Copilot browser response was missing `response` text")),
        Some("error") => bail!(
            "{}",
            record
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Copilot browser command returned an unknown error")
        ),
        Some(status) => bail!("Unsupported Copilot browser status: {status}"),
        None => bail!("Copilot browser JSON response was missing `status`"),
    }
}

fn parse_structured_response(raw_response: &str) -> Result<Option<ModelResponse>> {
    let candidates = json_candidates(raw_response);
    let mut saw_json_candidate = false;

    for candidate in &candidates {
        let value = match serde_json::from_str::<Value>(candidate) {
            Ok(value) => {
                saw_json_candidate = true;
                value
            }
            Err(_) => continue,
        };

        if let Some(response) = parse_envelope_value(&value)? {
            return Ok(Some(response));
        }
    }

    let tool_uses = extract_tool_use_blocks(&candidates)?;
    if !tool_uses.is_empty() {
        let text = strip_fenced_code_blocks(raw_response).trim().to_string();
        let mut content = Vec::new();
        if !text.is_empty() {
            content.push(ResponseContent::Text(text));
        }
        content.extend(tool_uses);
        return Ok(Some(ModelResponse {
            id: format!("copilot-{}", Uuid::new_v4()),
            content,
            stop_reason: Some(StopReason::ToolUse),
            usage: Usage::default(),
        }));
    }

    if saw_json_candidate {
        bail!("Copilot returned JSON but not in the expected assistantMessage/toolUses schema");
    }

    Ok(None)
}

fn parse_envelope_value(value: &Value) -> Result<Option<ModelResponse>> {
    let object = match value.as_object() {
        Some(object) => object,
        None => return Ok(None),
    };

    if !object.contains_key("assistantMessage")
        && !object.contains_key("assistant_message")
        && !object.contains_key("assistantText")
        && !object.contains_key("message")
        && !object.contains_key("text")
        && !object.contains_key("summary")
        && !object.contains_key("response")
        && !object.contains_key("toolUses")
        && !object.contains_key("tool_uses")
        && !object.contains_key("toolCalls")
        && !object.contains_key("tool_calls")
    {
        return Ok(None);
    }

    let envelope: CopilotEnvelope = serde_json::from_value(value.clone())
        .context("failed to deserialize Copilot JSON envelope")?;
    let mut content = Vec::new();

    if let Some(message) = envelope
        .assistant_message
        .map(|value| value.trim().to_string())
    {
        if !message.is_empty() {
            content.push(ResponseContent::Text(message));
        }
    }

    for tool_use in envelope.tool_uses {
        content.push(ResponseContent::ToolUse {
            id: tool_use
                .id
                .unwrap_or_else(|| format!("toolu_{}", Uuid::new_v4())),
            name: tool_use.name,
            input: tool_use.input,
        });
    }

    let stop_reason = if content
        .iter()
        .any(|item| matches!(item, ResponseContent::ToolUse { .. }))
    {
        Some(StopReason::ToolUse)
    } else {
        Some(StopReason::EndTurn)
    };

    Ok(Some(ModelResponse {
        id: format!("copilot-{}", Uuid::new_v4()),
        content,
        stop_reason,
        usage: Usage::default(),
    }))
}

fn extract_tool_use_blocks(candidates: &[String]) -> Result<Vec<ResponseContent>> {
    let mut tool_uses = Vec::new();

    for candidate in candidates {
        let Ok(value) = serde_json::from_str::<Value>(candidate) else {
            continue;
        };

        let Some(object) = value.as_object() else {
            continue;
        };

        let is_tool_use = object
            .get("type")
            .and_then(Value::as_str)
            .map(|value| value == "tool_use")
            .unwrap_or(false)
            || (object.contains_key("name")
                && object.contains_key("input")
                && !object.contains_key("assistantMessage")
                && !object.contains_key("toolUses"));

        if !is_tool_use {
            continue;
        }

        let tool_use: CopilotToolUse = serde_json::from_value(value)
            .context("failed to deserialize Copilot tool_use block")?;
        tool_uses.push(ResponseContent::ToolUse {
            id: tool_use
                .id
                .unwrap_or_else(|| format!("toolu_{}", Uuid::new_v4())),
            name: tool_use.name,
            input: tool_use.input,
        });
    }

    Ok(tool_uses)
}

fn response_to_stream_events(response: ModelResponse) -> Vec<Result<StreamEvent>> {
    let mut events = Vec::new();

    for (index, block) in response.content.iter().enumerate() {
        match block {
            ResponseContent::Text(text) => {
                if !text.is_empty() {
                    events.push(Ok(StreamEvent::TextDelta {
                        index,
                        text: text.clone(),
                    }));
                }
            }
            ResponseContent::ToolUse { id, name, input } => {
                events.push(Ok(StreamEvent::ContentBlockStart {
                    index,
                    content: ResponseContent::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    },
                }));
                events.push(Ok(StreamEvent::InputJsonDelta {
                    index,
                    partial_json: serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string()),
                }));
                events.push(Ok(StreamEvent::ContentBlockStop { index }));
            }
        }
    }

    events.push(Ok(StreamEvent::MessageDone { response }));
    events
}

fn json_candidates(raw_response: &str) -> Vec<String> {
    let trimmed = raw_response.trim();
    let mut candidates = Vec::new();

    if !trimmed.is_empty() {
        candidates.push(trimmed.to_string());
    }

    candidates.extend(extract_fenced_code_blocks(raw_response));

    if let Some(candidate) = extract_balanced_json_object(raw_response) {
        if !candidates.iter().any(|item| item == &candidate) {
            candidates.push(candidate);
        }
    }

    candidates
}

fn extract_fenced_code_blocks(raw_response: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut inside_block = false;
    let mut current = Vec::new();

    for line in raw_response.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if inside_block {
                let block = current.join("\n").trim().to_string();
                if !block.is_empty() {
                    blocks.push(block);
                }
                current.clear();
            }
            inside_block = !inside_block;
            continue;
        }

        if inside_block {
            current.push(line.to_string());
        }
    }

    blocks
}

fn extract_balanced_json_object(raw_response: &str) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw_response.char_indices() {
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
                    start = Some(index);
                }
                depth += 1;
            }
            '}' if !in_string => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(begin) = start {
                        return Some(raw_response[begin..=index].to_string());
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn strip_fenced_code_blocks(raw_response: &str) -> String {
    let mut output = Vec::new();
    let mut inside_block = false;

    for line in raw_response.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            inside_block = !inside_block;
            continue;
        }
        if !inside_block {
            output.push(line);
        }
    }

    output.join("\n")
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Arc,
    };

    use claw_core::{query, Message, SessionConfig, SessionState};
    use claw_provider::ToolDefinition;
    use claw_tools::{ToolOrchestrator, ToolRegistry};
    use futures::StreamExt;
    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    fn write_mock_script(dir: &Path, body: &str) -> PathBuf {
        let script_path = dir.join("mock-copilot.js");
        fs::write(&script_path, body).expect("mock script should be written");
        script_path
    }

    #[test]
    fn parse_copilot_response_reads_json_envelope() {
        let provider = CopilotChatProvider::with_default_settings();
        let response = provider
            .parse_copilot_response(
                r#"{"assistantMessage":"Need a tool","toolUses":[{"id":"call-1","name":"glob","input":{"pattern":"src/**/*.ts"}}]}"#,
            )
            .expect("response should parse");

        assert_eq!(response.stop_reason, Some(StopReason::ToolUse));
        assert_eq!(response.content.len(), 2);
        assert!(matches!(response.content[0], ResponseContent::Text(_)));
        assert!(matches!(
            response.content[1],
            ResponseContent::ToolUse { .. }
        ));
    }

    #[test]
    fn parse_copilot_response_extracts_tool_use_block_from_fence() {
        let provider = CopilotChatProvider::with_default_settings();
        let response = provider
            .parse_copilot_response(
                "I'll inspect the workspace first.\n```json\n{\"type\":\"tool_use\",\"name\":\"glob\",\"input\":{\"pattern\":\"src/**/*.rs\"}}\n```",
            )
            .expect("fenced tool use should parse");

        assert_eq!(response.stop_reason, Some(StopReason::ToolUse));
        assert_eq!(response.content.len(), 2);
        assert!(matches!(response.content[0], ResponseContent::Text(_)));
        assert!(matches!(
            response.content[1],
            ResponseContent::ToolUse { .. }
        ));
    }

    #[tokio::test]
    async fn stream_wraps_complete_response_into_single_pass_events() {
        let temp_dir = tempdir().expect("temp dir");
        let script_path = write_mock_script(
            temp_dir.path(),
            r#"console.log(JSON.stringify({status:"ok",response:'{"assistantMessage":"hello","toolUses":[{"id":"call-1","name":"glob","input":{"pattern":"src/**/*.rs"}}]}' }));"#,
        );
        let provider = CopilotChatProvider::with_default_settings().with_script_path(script_path);
        let request = ModelRequest {
            model: "copilot".to_string(),
            system: Some("test".to_string()),
            messages: vec![],
            max_tokens: 512,
            tools: Some(vec![ToolDefinition {
                name: "glob".to_string(),
                description: "glob".to_string(),
                input_schema: json!({"type":"object"}),
            }]),
            temperature: None,
        };

        let mut stream = provider.stream(request).await.expect("stream should start");
        let mut events = Vec::new();
        while let Some(event) = stream.next().await {
            events.push(event.expect("stream event should succeed"));
        }

        assert!(events
            .iter()
            .any(|event| matches!(event, StreamEvent::TextDelta { text, .. } if text == "hello")));
        assert!(events
            .iter()
            .any(|event| matches!(event, StreamEvent::ContentBlockStart { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, StreamEvent::MessageDone { .. })));
    }

    #[tokio::test]
    async fn query_works_with_copilot_chat_provider() {
        let temp_dir = tempdir().expect("temp dir");
        let script_path = write_mock_script(
            temp_dir.path(),
            r#"console.log(JSON.stringify({status:"ok",response:'{"assistantMessage":"Relay slice complete","toolUses":[]}' }));"#,
        );
        let provider = CopilotChatProvider::with_default_settings().with_script_path(script_path);
        let registry = Arc::new(ToolRegistry::new());
        let orchestrator = ToolOrchestrator::new(Arc::clone(&registry));
        let mut session =
            SessionState::new(SessionConfig::default(), temp_dir.path().to_path_buf());
        session.push_message(Message::user("say hi"));

        query(&mut session, &provider, registry, &orchestrator, None)
            .await
            .expect("query should complete");

        let last_message = session.messages.last().expect("assistant message");
        assert!(
            matches!(last_message.content.first(), Some(claw_core::ContentBlock::Text { text }) if text == "Relay slice complete")
        );
    }
}
