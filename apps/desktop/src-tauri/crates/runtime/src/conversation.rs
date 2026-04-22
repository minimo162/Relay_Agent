use std::collections::{BTreeMap, HashSet};
use std::fmt::{Display, Formatter};

use serde_json::Value;

use crate::compact::{
    compact_session, estimate_session_tokens, CompactionConfig, CompactionResult,
};
use crate::config::RuntimeFeatureConfig;
use crate::hooks::{HookRunResult, HookRunner};
use crate::permissions::{PermissionOutcome, PermissionPolicy, PermissionPrompter};
use crate::session::{ContentBlock, ConversationMessage, Session};
use crate::usage::{TokenUsage, UsageTracker};

const DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD: u32 = 200_000;
const AUTO_COMPACTION_THRESHOLD_ENV_VAR: &str = "CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiRequest<'a> {
    pub system_prompt: &'a [String],
    pub messages: &'a [ConversationMessage],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssistantEvent {
    TextDelta(String),
    ToolUse {
        id: String,
        name: String,
        input: String,
    },
    Usage(TokenUsage),
    MessageStop,
}

pub trait ApiClient {
    fn stream(&mut self, request: &ApiRequest<'_>) -> Result<Vec<AssistantEvent>, RuntimeError>;
}

pub trait ToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    message: String,
}

impl ToolError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for ToolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ToolError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RuntimeError {}

fn extract_mutation_text_fields(tool_name: &str, input: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(input) else {
        return Vec::new();
    };
    let Some(obj) = value.as_object() else {
        return Vec::new();
    };
    match tool_name {
        "write" => obj
            .get("content")
            .and_then(Value::as_str)
            .map(|text| vec![text.to_string()])
            .unwrap_or_default(),
        "edit" => ["old_string", "new_string", "replace", "with", "content"]
            .into_iter()
            .filter_map(|key| obj.get(key).and_then(Value::as_str))
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn looks_like_unresolved_local_file_placeholder(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.contains("<full file content here>")
        || lower.contains("<first sentence>")
        || lower.contains("summary: <")
        || text.contains("<最初の文>")
    {
        return true;
    }

    let mut cursor = 0usize;
    while let Some(open_rel) = text[cursor..].find('<') {
        let open = cursor + open_rel;
        let Some(close_rel) = text[open + 1..].find('>') else {
            break;
        };
        let close = open + 1 + close_rel;
        let inner = text[open + 1..close].trim();
        if !inner.is_empty()
            && inner.len() <= 160
            && (inner.contains("最初の文")
                || inner.contains("README.md")
                || inner.to_ascii_lowercase().contains("first sentence")
                || inner.to_ascii_lowercase().contains("placeholder"))
        {
            return true;
        }
        cursor = close + 1;
    }

    false
}

fn invalid_local_file_mutation_reason(tool_name: &str, input: &str) -> Option<String> {
    if !matches!(tool_name, "write" | "edit") {
        return None;
    }
    if extract_mutation_text_fields(tool_name, input)
        .into_iter()
        .any(|field| looks_like_unresolved_local_file_placeholder(&field))
    {
        return Some(format!(
            "{tool_name} input contains an unresolved placeholder marker. Read the source file first and send the final concrete file content instead of angle-bracket placeholders."
        ));
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnSummary {
    pub assistant_messages: Vec<ConversationMessage>,
    pub tool_results: Vec<ConversationMessage>,
    pub iterations: usize,
    pub usage: TokenUsage,
    pub auto_compaction: Option<AutoCompactionEvent>,
    pub outcome: TurnOutcome,
    pub terminal_assistant_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoCompactionEvent {
    pub removed_message_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnOutcome {
    Completed,
    PermissionDenied { message: String },
    ToolError { message: String },
}

impl TurnOutcome {
    #[must_use]
    pub fn error_message(&self) -> Option<&str> {
        match self {
            Self::Completed => None,
            Self::PermissionDenied { message } | Self::ToolError { message } => Some(message),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnInput {
    User(String),
    Synthetic(String),
}

pub struct ConversationRuntime<C, T> {
    session: Session,
    api_client: C,
    tool_executor: T,
    permission_policy: PermissionPolicy,
    system_prompt: Vec<String>,
    max_iterations: usize,
    usage_tracker: UsageTracker,
    hook_runner: HookRunner,
    auto_compaction_input_tokens_threshold: u32,
}

impl<C, T> ConversationRuntime<C, T>
where
    C: ApiClient,
    T: ToolExecutor,
{
    #[must_use]
    pub fn new(
        session: Session,
        api_client: C,
        tool_executor: T,
        permission_policy: PermissionPolicy,
        system_prompt: Vec<String>,
    ) -> Self {
        Self::new_with_features(
            session,
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
            &RuntimeFeatureConfig::default(),
        )
    }

    #[must_use]
    pub fn new_with_features(
        session: Session,
        api_client: C,
        tool_executor: T,
        permission_policy: PermissionPolicy,
        system_prompt: Vec<String>,
        feature_config: &RuntimeFeatureConfig,
    ) -> Self {
        let usage_tracker = UsageTracker::from_session(&session);
        Self {
            session,
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
            max_iterations: usize::MAX,
            usage_tracker,
            hook_runner: HookRunner::from_feature_config(feature_config),
            auto_compaction_input_tokens_threshold: auto_compaction_threshold_from_env(),
        }
    }

    #[must_use]
    pub fn with_max_iterations(mut self, max_iterations: usize) -> Self {
        self.max_iterations = max_iterations;
        self
    }

    #[must_use]
    pub fn with_auto_compaction_input_tokens_threshold(mut self, threshold: u32) -> Self {
        self.auto_compaction_input_tokens_threshold = threshold;
        self
    }

    pub fn run_turn(
        &mut self,
        user_input: impl Into<String>,
        prompter: Option<&mut dyn PermissionPrompter>,
    ) -> Result<TurnSummary, RuntimeError> {
        self.run_turn_with_input(TurnInput::User(user_input.into()), prompter)
    }

    pub fn run_turn_with_input(
        &mut self,
        turn_input: TurnInput,
        mut prompter: Option<&mut dyn PermissionPrompter>,
    ) -> Result<TurnSummary, RuntimeError> {
        let (input_text, persists_in_session) = match turn_input {
            TurnInput::User(text) => (text, true),
            TurnInput::Synthetic(text) => (text, false),
        };
        let inserted_input_index = self.session.messages.len();
        self.session
            .messages
            .push(ConversationMessage::user_text(input_text));

        let mut assistant_messages = Vec::new();
        let mut tool_results = Vec::new();
        let mut iterations = 0;
        let mut last_batch_outcome: Option<TurnOutcome> = None;
        let mut executed_tool_dedup_keys: HashSet<String> = HashSet::new();
        let mut duplicate_tool_hits: usize = 0;
        let mut local_search_tool_calls: usize = 0;
        let mut turn_guard_stop: Option<String> = None;

        loop {
            iterations += 1;
            if iterations > self.max_iterations {
                self.cleanup_turn_input(inserted_input_index, persists_in_session);
                return Err(RuntimeError::new(
                    "conversation loop exceeded the maximum number of iterations",
                ));
            }

            let request = ApiRequest {
                system_prompt: &self.system_prompt,
                messages: &self.session.messages,
            };
            let events = self.api_client.stream(&request)?;
            let (assistant_message, usage) = build_assistant_message(events)?;
            if let Some(usage) = usage {
                self.usage_tracker.record(usage);
            }
            let pending_tool_uses = pending_tool_uses_from_message(&assistant_message);

            self.session.messages.push(assistant_message.clone());
            assistant_messages.push(assistant_message);

            if pending_tool_uses.is_empty() {
                break;
            }

            last_batch_outcome = self.execute_pending_tool_uses(
                pending_tool_uses,
                &mut prompter,
                &mut tool_results,
                &mut executed_tool_dedup_keys,
                &mut duplicate_tool_hits,
                &mut local_search_tool_calls,
                &mut turn_guard_stop,
            );
            if let Some(message) = turn_guard_stop.take() {
                tracing::info!("[runtime] stopping turn: {message}");
                last_batch_outcome = Some(TurnOutcome::ToolError { message });
                break;
            }
            if duplicate_tool_hits >= TURN_TOOL_DUPLICATE_LIMIT {
                tracing::info!(
                    "[runtime] aborting turn after {duplicate_tool_hits} duplicate tool calls within the turn"
                );
                last_batch_outcome = Some(TurnOutcome::ToolError {
                    message: format!(
                        "Turn aborted: the assistant repeated an identical tool call {duplicate_tool_hits} times without progress."
                    ),
                });
                break;
            }
        }

        let terminal_assistant_text = assistant_messages
            .last()
            .map(assistant_message_text)
            .unwrap_or_default();
        let outcome = determine_turn_outcome(last_batch_outcome, &terminal_assistant_text);
        self.cleanup_turn_input(inserted_input_index, persists_in_session);
        let auto_compaction = self.maybe_auto_compact();

        Ok(TurnSummary {
            assistant_messages,
            tool_results,
            iterations,
            usage: self.usage_tracker.cumulative_usage(),
            auto_compaction,
            outcome,
            terminal_assistant_text,
        })
    }

    #[must_use]
    pub fn compact(&self, config: CompactionConfig) -> CompactionResult {
        compact_session(&self.session, config)
    }

    #[must_use]
    pub fn estimated_tokens(&self) -> usize {
        estimate_session_tokens(&self.session)
    }

    #[must_use]
    pub fn usage(&self) -> &UsageTracker {
        &self.usage_tracker
    }

    #[must_use]
    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn replace_session(&mut self, session: Session) {
        self.usage_tracker = UsageTracker::from_session(&session);
        self.session = session;
    }

    pub fn force_compact(&mut self, config: CompactionConfig) -> CompactionResult {
        let result = compact_session(&self.session, config);
        if result.removed_message_count > 0 {
            self.replace_session(result.compacted_session.clone());
        }
        result
    }

    #[must_use]
    pub fn into_session(self) -> Session {
        self.session
    }

    fn cleanup_turn_input(&mut self, inserted_input_index: usize, persists_in_session: bool) {
        if persists_in_session {
            return;
        }
        if inserted_input_index < self.session.messages.len() {
            self.session.messages.remove(inserted_input_index);
        }
    }

    fn execute_pending_tool_uses(
        &mut self,
        pending_tool_uses: Vec<(String, String, String)>,
        prompter: &mut Option<&mut dyn PermissionPrompter>,
        tool_results: &mut Vec<ConversationMessage>,
        executed_dedup_keys: &mut HashSet<String>,
        duplicate_tool_hits: &mut usize,
        local_search_tool_calls: &mut usize,
        turn_guard_stop: &mut Option<String>,
    ) -> Option<TurnOutcome> {
        let mut batch_outcome = None;
        for (tool_use_id, tool_name, input) in pending_tool_uses {
            if is_turn_level_local_search_tool(&tool_name) {
                if *local_search_tool_calls >= TURN_LOCAL_SEARCH_TOOL_LIMIT {
                    let notice = format!(
                        "Search tool budget reached: Relay already executed {TURN_LOCAL_SEARCH_TOOL_LIMIT} local search calls in this turn. The prior tool outputs remain in the transcript above. Do not issue more `glob`, `grep`, or `office_search` calls for this request; summarize the existing findings for the user."
                    );
                    tracing::info!(
                        "[runtime] synthesized no-op for search budget on {tool_name} (limit={TURN_LOCAL_SEARCH_TOOL_LIMIT})"
                    );
                    let synthetic = ConversationMessage::tool_result(
                        tool_use_id,
                        tool_name,
                        notice.clone(),
                        false,
                    );
                    self.session.messages.push(synthetic.clone());
                    tool_results.push(synthetic);
                    *turn_guard_stop = Some(format!(
                        "Turn stopped: the assistant exceeded the local search tool budget ({TURN_LOCAL_SEARCH_TOOL_LIMIT}) without summarizing results."
                    ));
                    break;
                }
                *local_search_tool_calls += 1;
            }
            if let Some(key) = turn_level_tool_dedup_key(&tool_name, &input) {
                if !executed_dedup_keys.insert(key) {
                    *duplicate_tool_hits += 1;
                    tracing::info!(
                        "[runtime] synthesized no-op for duplicate tool call {tool_name} (turn-level dedup, hits={duplicate_tool_hits})"
                    );
                    let notice = format!(
                        "Duplicate tool call suppressed: this `{tool_name}` call was already executed earlier in this turn with the same input. The prior tool output remains in the transcript above. Do not repeat this call. Either summarize the existing findings for the user, or issue a different tool call (for example, narrow or broaden the pattern, change the target path, or switch tools)."
                    );
                    let synthetic =
                        ConversationMessage::tool_result(tool_use_id, tool_name, notice, false);
                    self.session.messages.push(synthetic.clone());
                    tool_results.push(synthetic);
                    if *duplicate_tool_hits >= TURN_TOOL_DUPLICATE_LIMIT {
                        break;
                    }
                    continue;
                }
            }
            let (result_message, result_outcome) =
                self.build_tool_result_message(tool_use_id, tool_name, &input, prompter);
            self.session.messages.push(result_message.clone());
            tool_results.push(result_message);
            if result_outcome.is_some() {
                batch_outcome = result_outcome;
                break;
            }
        }
        batch_outcome
    }

    fn build_tool_result_message(
        &mut self,
        tool_use_id: String,
        tool_name: String,
        input: &str,
        prompter: &mut Option<&mut dyn PermissionPrompter>,
    ) -> (ConversationMessage, Option<TurnOutcome>) {
        if let Some(reason) = invalid_local_file_mutation_reason(&tool_name, input) {
            return (
                ConversationMessage::tool_result(tool_use_id, tool_name, reason.clone(), true),
                Some(TurnOutcome::ToolError { message: reason }),
            );
        }

        let permission_outcome = if let Some(prompt) = prompter.as_mut() {
            self.permission_policy
                .authorize(&tool_name, input, Some(*prompt))
        } else {
            self.permission_policy.authorize(&tool_name, input, None)
        };

        match permission_outcome {
            PermissionOutcome::Allow => {
                let pre_hook_result = self.hook_runner.run_pre_tool_use(&tool_name, input);
                if pre_hook_result.is_denied() {
                    let deny_message = format!("PreToolUse hook denied tool `{tool_name}`");
                    let output = format_hook_message(&pre_hook_result, &deny_message);
                    return (
                        ConversationMessage::tool_result(
                            tool_use_id,
                            tool_name,
                            output.clone(),
                            true,
                        ),
                        Some(TurnOutcome::ToolError { message: output }),
                    );
                }

                let (mut output, mut is_error) = match self.tool_executor.execute(&tool_name, input)
                {
                    Ok(output) => (output, false),
                    Err(error) => (error.to_string(), true),
                };
                output = merge_hook_feedback(pre_hook_result.messages(), output, false);

                let post_hook_result = if is_error {
                    self.hook_runner
                        .run_post_tool_use_failure(&tool_name, input, &output)
                } else {
                    self.hook_runner
                        .run_post_tool_use(&tool_name, input, &output, false)
                };
                if post_hook_result.is_denied() {
                    is_error = true;
                }
                output = merge_hook_feedback(
                    post_hook_result.messages(),
                    output,
                    post_hook_result.is_denied(),
                );

                let outcome = if is_error {
                    Some(TurnOutcome::ToolError {
                        message: output.clone(),
                    })
                } else {
                    None
                };
                (
                    ConversationMessage::tool_result(tool_use_id, tool_name, output, is_error),
                    outcome,
                )
            }
            PermissionOutcome::Deny { reason } => (
                ConversationMessage::tool_result(tool_use_id, tool_name, reason.clone(), true),
                Some(TurnOutcome::PermissionDenied { message: reason }),
            ),
        }
    }

    fn maybe_auto_compact(&mut self) -> Option<AutoCompactionEvent> {
        if self.usage_tracker.cumulative_usage().input_tokens
            < self.auto_compaction_input_tokens_threshold
        {
            return None;
        }

        let result = compact_session(
            &self.session,
            CompactionConfig {
                max_estimated_tokens: 0,
                ..CompactionConfig::default()
            },
        );

        if result.removed_message_count == 0 {
            return None;
        }

        self.session = result.compacted_session;
        Some(AutoCompactionEvent {
            removed_message_count: result.removed_message_count,
        })
    }
}

fn assistant_message_text(message: &ConversationMessage) -> String {
    message
        .blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn unrecovered_error_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    [
        "could not",
        "couldn't",
        "cannot",
        "can't",
        "unable",
        "blocked",
        "denied",
        "permission",
        "failed",
        "error",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn determine_turn_outcome(
    last_batch_outcome: Option<TurnOutcome>,
    terminal_assistant_text: &str,
) -> TurnOutcome {
    match last_batch_outcome {
        Some(outcome) if unrecovered_error_text(terminal_assistant_text) => outcome,
        _ => TurnOutcome::Completed,
    }
}

#[must_use]
pub fn auto_compaction_threshold_from_env() -> u32 {
    parse_auto_compaction_threshold(
        std::env::var(AUTO_COMPACTION_THRESHOLD_ENV_VAR)
            .ok()
            .as_deref(),
    )
}

#[must_use]
fn parse_auto_compaction_threshold(value: Option<&str>) -> u32 {
    value
        .and_then(|raw| raw.trim().parse::<u32>().ok())
        .filter(|threshold| *threshold > 0)
        .unwrap_or(DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD)
}

fn sort_json_value_in_place(v: &mut Value) {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> =
                map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            map.clear();
            for (k, mut val) in entries {
                sort_json_value_in_place(&mut val);
                map.insert(k, val);
            }
        }
        Value::Array(arr) => {
            for val in arr {
                sort_json_value_in_place(val);
            }
        }
        _ => {}
    }
}

/// Produce a stable dedup key for (tool_name, input) so that duplicate tool
/// calls can be detected across iterations within a single turn.
///
/// Mirrors the normalization in the orchestrator's per-response dedup
/// (`normalize_tool_input_for_dedup_key`) so that a call parsed there maps to
/// the same key here.
fn turn_level_tool_dedup_key(tool_name: &str, input: &str) -> Option<String> {
    let mut value: Value = serde_json::from_str(input).ok()?;
    if matches!(tool_name, "read" | "write" | "edit") {
        if let Some(obj) = value.as_object_mut() {
            let path = obj
                .remove("filePath")
                .or_else(|| obj.remove("path"))
                .or_else(|| obj.remove("file_path"));
            if let Some(path) = path {
                obj.entry("path".to_string()).or_insert(path);
            }
            if let Some(old) = obj.remove("old_string") {
                obj.entry("oldString".to_string()).or_insert(old);
            }
            if let Some(new) = obj.remove("new_string") {
                obj.entry("newString".to_string()).or_insert(new);
            }
            if let Some(replace_all) = obj.remove("replace_all") {
                obj.entry("replaceAll".to_string()).or_insert(replace_all);
            }
        }
    }
    sort_json_value_in_place(&mut value);
    Some(format!("{tool_name}|{}", value))
}

const TURN_TOOL_DUPLICATE_LIMIT: usize = 3;
const TURN_LOCAL_SEARCH_TOOL_LIMIT: usize = 6;

fn is_turn_level_local_search_tool(tool_name: &str) -> bool {
    matches!(tool_name, "glob" | "grep" | "office_search")
}

fn pending_tool_uses_from_message(msg: &ConversationMessage) -> Vec<(String, String, String)> {
    msg.blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::ToolUse { id, name, input } => {
                Some((id.clone(), name.clone(), input.clone()))
            }
            _ => None,
        })
        .collect()
}

fn build_assistant_message(
    events: Vec<AssistantEvent>,
) -> Result<(ConversationMessage, Option<TokenUsage>), RuntimeError> {
    let mut text = String::new();
    let mut blocks = Vec::new();
    let mut finished = false;
    let mut usage = None;

    for event in events {
        match event {
            AssistantEvent::TextDelta(delta) => text.push_str(&delta),
            AssistantEvent::ToolUse { id, name, input } => {
                flush_text_block(&mut text, &mut blocks);
                blocks.push(ContentBlock::ToolUse { id, name, input });
            }
            AssistantEvent::Usage(value) => usage = Some(value),
            AssistantEvent::MessageStop => {
                finished = true;
            }
        }
    }

    flush_text_block(&mut text, &mut blocks);

    if !finished {
        return Err(RuntimeError::new(
            "assistant stream ended without a message stop event",
        ));
    }
    if blocks.is_empty() {
        return Err(RuntimeError::new("assistant stream produced no content"));
    }

    Ok((
        ConversationMessage::assistant_with_usage(blocks, usage),
        usage,
    ))
}

fn flush_text_block(text: &mut String, blocks: &mut Vec<ContentBlock>) {
    if !text.is_empty() {
        blocks.push(ContentBlock::Text {
            text: std::mem::take(text),
        });
    }
}

fn format_hook_message(result: &HookRunResult, fallback: &str) -> String {
    if result.messages().is_empty() {
        fallback.to_string()
    } else {
        result.messages().join("\n")
    }
}

fn merge_hook_feedback(messages: &[String], output: String, denied: bool) -> String {
    if messages.is_empty() {
        return output;
    }

    let mut sections = Vec::new();
    if !output.trim().is_empty() {
        sections.push(output);
    }
    let label = if denied {
        "Hook feedback (denied)"
    } else {
        "Hook feedback"
    };
    sections.push(format!("{label}:\n{}", messages.join("\n")));
    sections.join("\n\n")
}

type ToolHandler = Box<dyn FnMut(&str) -> Result<String, ToolError>>;

#[derive(Default)]
pub struct StaticToolExecutor {
    handlers: BTreeMap<String, ToolHandler>,
}

impl StaticToolExecutor {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn register(
        mut self,
        tool_name: impl Into<String>,
        handler: impl FnMut(&str) -> Result<String, ToolError> + 'static,
    ) -> Self {
        self.handlers.insert(tool_name.into(), Box::new(handler));
        self
    }
}

impl ToolExecutor for StaticToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        self.handlers
            .get_mut(tool_name)
            .ok_or_else(|| ToolError::new(format!("unknown tool: {tool_name}")))?(input)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_auto_compaction_threshold, ApiClient, ApiRequest, AssistantEvent,
        AutoCompactionEvent, ConversationRuntime, RuntimeError, StaticToolExecutor, ToolError,
        TurnInput, TurnOutcome, DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD,
    };
    use crate::compact::CompactionConfig;
    use crate::config::{RuntimeFeatureConfig, RuntimeHookConfig};
    use crate::permissions::{
        PermissionMode, PermissionPolicy, PermissionPromptDecision, PermissionPrompter,
        PermissionRequest,
    };
    use crate::prompt::{ProjectContext, SystemPromptBuilder};
    use crate::session::{ContentBlock, MessageRole, Session};
    use crate::usage::TokenUsage;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct ScriptedApiClient {
        call_count: usize,
    }

    impl ApiClient for ScriptedApiClient {
        fn stream(
            &mut self,
            request: &ApiRequest<'_>,
        ) -> Result<Vec<AssistantEvent>, RuntimeError> {
            self.call_count += 1;
            match self.call_count {
                1 => {
                    assert!(request
                        .messages
                        .iter()
                        .any(|message| message.role == MessageRole::User));
                    Ok(vec![
                        AssistantEvent::TextDelta("Let me calculate that.".to_string()),
                        AssistantEvent::ToolUse {
                            id: "tool-1".to_string(),
                            name: "add".to_string(),
                            input: "2,2".to_string(),
                        },
                        AssistantEvent::Usage(TokenUsage {
                            input_tokens: 20,
                            output_tokens: 6,
                            cache_creation_input_tokens: 1,
                            cache_read_input_tokens: 2,
                        }),
                        AssistantEvent::MessageStop,
                    ])
                }
                2 => {
                    let last_message = request
                        .messages
                        .last()
                        .expect("tool result should be present");
                    assert_eq!(last_message.role, MessageRole::Tool);
                    Ok(vec![
                        AssistantEvent::TextDelta("The answer is 4.".to_string()),
                        AssistantEvent::Usage(TokenUsage {
                            input_tokens: 24,
                            output_tokens: 4,
                            cache_creation_input_tokens: 1,
                            cache_read_input_tokens: 3,
                        }),
                        AssistantEvent::MessageStop,
                    ])
                }
                _ => Err(RuntimeError::new("unexpected extra API call")),
            }
        }
    }

    struct PromptAllowOnce;

    impl PermissionPrompter for PromptAllowOnce {
        fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
            assert_eq!(request.tool_name, "add");
            PermissionPromptDecision::Allow
        }
    }

    struct PromptMustNotRun;

    impl PermissionPrompter for PromptMustNotRun {
        fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
            panic!("permission prompt should not run for {}", request.tool_name);
        }
    }

    #[test]
    fn runs_user_to_tool_to_result_loop_end_to_end_and_tracks_usage() {
        let api_client = ScriptedApiClient { call_count: 0 };
        let tool_executor = StaticToolExecutor::new().register("add", |input| {
            let total = input
                .split(',')
                .map(|part| part.parse::<i32>().expect("input must be valid integer"))
                .sum::<i32>();
            Ok(total.to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite);
        let system_prompt = SystemPromptBuilder::new()
            .with_project_context(ProjectContext {
                cwd: PathBuf::from("/tmp/project"),
                current_date: "2026-03-31".to_string(),
                git_status: None,
                git_diff: None,
                instruction_files: Vec::new(),
            })
            .with_os("linux", "6.8")
            .build();
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
        );

        let summary = runtime
            .run_turn("what is 2 + 2?", Some(&mut PromptAllowOnce))
            .expect("conversation loop should succeed");

        assert_eq!(summary.iterations, 2);
        assert_eq!(summary.assistant_messages.len(), 2);
        assert_eq!(summary.tool_results.len(), 1);
        assert_eq!(runtime.session().messages.len(), 4);
        assert_eq!(summary.usage.output_tokens, 10);
        assert_eq!(summary.auto_compaction, None);
        assert!(matches!(
            runtime.session().messages[1].blocks[1],
            ContentBlock::ToolUse { .. }
        ));
        assert!(matches!(
            runtime.session().messages[2].blocks[0],
            ContentBlock::ToolResult {
                is_error: false,
                ..
            }
        ));
        assert_eq!(summary.outcome, TurnOutcome::Completed);
        assert_eq!(summary.terminal_assistant_text, "The answer is 4.");
    }

    #[test]
    fn unresolved_write_placeholder_is_rejected_before_permission_prompt() {
        let tool_calls = Arc::new(AtomicUsize::new(0));
        let executor_calls = Arc::clone(&tool_calls);
        let tool_executor = StaticToolExecutor::new().register("write", move |_input| {
            executor_calls.fetch_add(1, Ordering::SeqCst);
            Ok("should not execute".to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("write", PermissionMode::WorkspaceWrite);
        let system_prompt = vec!["system".to_string()];
        let api_client = ScriptedApiClient { call_count: 0 };
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
        );
        let mut prompter = PromptMustNotRun;
        let mut prompt = Some(&mut prompter as &mut dyn PermissionPrompter);

        let (message, outcome) = runtime.build_tool_result_message(
            "tool-1".to_string(),
            "write".to_string(),
            r#"{"path":"out.txt","content":"source: README.md\nsummary: <最初の文>"}"#,
            &mut prompt,
        );

        assert_eq!(tool_calls.load(Ordering::SeqCst), 0);
        let Some(TurnOutcome::ToolError {
            message: error_message,
        }) = outcome
        else {
            panic!("expected unresolved placeholder to produce a tool error");
        };
        assert!(error_message.contains("unresolved placeholder marker"));
        match &message.blocks[0] {
            ContentBlock::ToolResult {
                is_error, output, ..
            } => {
                assert!(*is_error);
                assert!(output.contains("unresolved placeholder marker"));
            }
            other => panic!("expected tool result block, got {other:?}"),
        }
    }

    #[test]
    fn html_write_content_is_not_treated_as_placeholder() {
        let tool_calls = Arc::new(AtomicUsize::new(0));
        let executor_calls = Arc::clone(&tool_calls);
        let tool_executor = StaticToolExecutor::new().register("write", move |_input| {
            executor_calls.fetch_add(1, Ordering::SeqCst);
            Ok("ok".to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("write", PermissionMode::WorkspaceWrite);
        let system_prompt = vec!["system".to_string()];
        let api_client = ScriptedApiClient { call_count: 0 };
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
        );

        let (message, outcome) = runtime.build_tool_result_message(
            "tool-1".to_string(),
            "write".to_string(),
            r#"{"path":"index.html","content":"<!doctype html>\n<html><body>Hello</body></html>"}"#,
            &mut None,
        );

        assert_eq!(tool_calls.load(Ordering::SeqCst), 1);
        assert!(outcome.is_none());
        match &message.blocks[0] {
            ContentBlock::ToolResult {
                is_error, output, ..
            } => {
                assert!(!is_error);
                assert_eq!(output, "ok");
            }
            other => panic!("expected tool result block, got {other:?}"),
        }
    }

    #[test]
    fn one_tool_turn_succeeds_when_inner_iterations_exceed_outer_turn_limit() {
        let outer_max_turns = 1;
        let inner_max_iterations = 8;
        assert!(inner_max_iterations > outer_max_turns);

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            ScriptedApiClient { call_count: 0 },
            StaticToolExecutor::new().register("add", |input| {
                let total = input
                    .split(',')
                    .map(|part| part.parse::<i32>().expect("input must be valid integer"))
                    .sum::<i32>();
                Ok(total.to_string())
            }),
            PermissionPolicy::new(PermissionMode::WorkspaceWrite),
            vec!["system".to_string()],
        )
        .with_max_iterations(inner_max_iterations);

        let summary = runtime
            .run_turn("what is 2 + 2?", Some(&mut PromptAllowOnce))
            .expect("one-tool turn should succeed");

        assert_eq!(summary.iterations, 2);
        assert_eq!(summary.outcome, TurnOutcome::Completed);
    }

    #[test]
    fn records_denied_tool_results_when_prompt_rejects() {
        struct RejectPrompter;
        impl PermissionPrompter for RejectPrompter {
            fn decide(&mut self, _request: &PermissionRequest) -> PermissionPromptDecision {
                PermissionPromptDecision::Deny {
                    reason: "not now".to_string(),
                }
            }
        }

        struct SingleCallApiClient;
        impl ApiClient for SingleCallApiClient {
            fn stream(
                &mut self,
                request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                if request
                    .messages
                    .iter()
                    .any(|message| message.role == MessageRole::Tool)
                {
                    return Ok(vec![
                        AssistantEvent::TextDelta("I could not use the tool.".to_string()),
                        AssistantEvent::MessageStop,
                    ]);
                }
                Ok(vec![
                    AssistantEvent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "blocked".to_string(),
                        input: "secret".to_string(),
                    },
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SingleCallApiClient,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::WorkspaceWrite),
            vec!["system".to_string()],
        );

        let summary = runtime
            .run_turn("use the tool", Some(&mut RejectPrompter))
            .expect("conversation should continue after denied tool");

        assert_eq!(summary.tool_results.len(), 1);
        assert_eq!(
            summary.outcome,
            TurnOutcome::PermissionDenied {
                message: "not now".to_string(),
            }
        );
        assert_eq!(summary.terminal_assistant_text, "I could not use the tool.");
        assert!(matches!(
            &summary.tool_results[0].blocks[0],
            ContentBlock::ToolResult { is_error: true, output, .. } if output == "not now"
        ));
    }

    // Relies on a POSIX `printf 'blocked by hook'; exit 2` hook snippet that
    // Windows `cmd.exe` cannot execute as-is (no native `printf`). The hook
    // layer's own test is also gated to non-Windows; match it here.
    #[cfg(not(windows))]
    #[test]
    fn denies_tool_use_when_pre_tool_hook_blocks() {
        struct SingleCallApiClient;
        impl ApiClient for SingleCallApiClient {
            fn stream(
                &mut self,
                request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                if request
                    .messages
                    .iter()
                    .any(|message| message.role == MessageRole::Tool)
                {
                    return Ok(vec![
                        AssistantEvent::TextDelta("blocked".to_string()),
                        AssistantEvent::MessageStop,
                    ]);
                }
                Ok(vec![
                    AssistantEvent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "blocked".to_string(),
                        input: r#"{"path":"secret.txt"}"#.to_string(),
                    },
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new_with_features(
            Session::new(),
            SingleCallApiClient,
            StaticToolExecutor::new().register("blocked", |_input| {
                panic!("tool should not execute when hook denies")
            }),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
            &RuntimeFeatureConfig::default().with_hooks(RuntimeHookConfig::new(
                vec![shell_snippet("printf 'blocked by hook'; exit 2")],
                Vec::new(),
            )),
        );

        let summary = runtime
            .run_turn("use the tool", None)
            .expect("conversation should continue after hook denial");

        assert_eq!(summary.tool_results.len(), 1);
        let ContentBlock::ToolResult {
            is_error, output, ..
        } = &summary.tool_results[0].blocks[0]
        else {
            panic!("expected tool result block");
        };
        assert!(
            *is_error,
            "hook denial should produce an error result: {output}"
        );
        assert!(
            output.contains("denied tool") || output.contains("blocked by hook"),
            "unexpected hook denial output: {output:?}"
        );
    }

    #[test]
    fn appends_post_tool_hook_feedback_to_tool_result() {
        struct TwoCallApiClient {
            calls: usize,
        }

        impl ApiClient for TwoCallApiClient {
            fn stream(
                &mut self,
                request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                self.calls += 1;
                match self.calls {
                    1 => Ok(vec![
                        AssistantEvent::ToolUse {
                            id: "tool-1".to_string(),
                            name: "add".to_string(),
                            input: r#"{"lhs":2,"rhs":2}"#.to_string(),
                        },
                        AssistantEvent::MessageStop,
                    ]),
                    2 => {
                        assert!(request
                            .messages
                            .iter()
                            .any(|message| message.role == MessageRole::Tool));
                        Ok(vec![
                            AssistantEvent::TextDelta("done".to_string()),
                            AssistantEvent::MessageStop,
                        ])
                    }
                    _ => Err(RuntimeError::new("unexpected extra API call")),
                }
            }
        }

        let mut runtime = ConversationRuntime::new_with_features(
            Session::new(),
            TwoCallApiClient { calls: 0 },
            StaticToolExecutor::new().register("add", |_input| Ok("4".to_string())),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
            &RuntimeFeatureConfig::default().with_hooks(RuntimeHookConfig::new(
                vec![shell_snippet("printf 'pre hook ran'")],
                vec![shell_snippet("printf 'post hook ran'")],
            )),
        );

        let summary = runtime
            .run_turn("use add", None)
            .expect("tool loop succeeds");

        assert_eq!(summary.tool_results.len(), 1);
        let ContentBlock::ToolResult {
            is_error, output, ..
        } = &summary.tool_results[0].blocks[0]
        else {
            panic!("expected tool result block");
        };
        assert!(
            !*is_error,
            "post hook should preserve non-error result: {output:?}"
        );
        assert!(
            output.contains('4'),
            "tool output missing value: {output:?}"
        );
        assert!(
            output.contains("pre hook ran"),
            "tool output missing pre hook feedback: {output:?}"
        );
        assert!(
            output.contains("post hook ran"),
            "tool output missing post hook feedback: {output:?}"
        );
    }

    #[test]
    fn appends_post_tool_use_failure_hook_feedback_on_executor_error() {
        struct TwoCallApiClient {
            calls: usize,
        }

        impl ApiClient for TwoCallApiClient {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                self.calls += 1;
                match self.calls {
                    1 => Ok(vec![
                        AssistantEvent::ToolUse {
                            id: "tool-1".to_string(),
                            name: "fail".to_string(),
                            input: "{}".to_string(),
                        },
                        AssistantEvent::MessageStop,
                    ]),
                    2 => Ok(vec![
                        AssistantEvent::TextDelta("handled".to_string()),
                        AssistantEvent::MessageStop,
                    ]),
                    _ => Err(RuntimeError::new("unexpected extra API call")),
                }
            }
        }

        let mut runtime = ConversationRuntime::new_with_features(
            Session::new(),
            TwoCallApiClient { calls: 0 },
            StaticToolExecutor::new().register("fail", |_input| {
                Err(ToolError::new("tool failed as expected"))
            }),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
            &RuntimeFeatureConfig::default().with_hooks(
                RuntimeHookConfig::new(Vec::new(), vec![shell_snippet("printf 'post-success'")])
                    .with_post_tool_use_failure(vec![shell_snippet("printf 'post-failure'")]),
            ),
        );

        let summary = runtime
            .run_turn("invoke fail", None)
            .expect("turn completes");

        assert_eq!(summary.tool_results.len(), 1);
        assert_eq!(summary.outcome, TurnOutcome::Completed);
        assert_eq!(summary.terminal_assistant_text, "handled");
        let ContentBlock::ToolResult {
            is_error, output, ..
        } = &summary.tool_results[0].blocks[0]
        else {
            panic!("expected tool result block");
        };
        assert!(*is_error, "executor error should mark tool result as error");
        assert!(
            output.contains("tool failed as expected"),
            "missing tool error text: {output:?}"
        );
        assert!(
            output.contains("post-failure"),
            "PostToolUseFailure hook should run (claw-code parity): {output:?}"
        );
        assert!(
            !output.contains("post-success"),
            "PostToolUse should not run on executor error: {output:?}"
        );
    }

    #[test]
    fn stops_batched_tools_after_first_failure() {
        struct BatchedApiClient {
            calls: usize,
        }

        impl ApiClient for BatchedApiClient {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                self.calls += 1;
                match self.calls {
                    1 => Ok(vec![
                        AssistantEvent::ToolUse {
                            id: "tool-1".to_string(),
                            name: "fail".to_string(),
                            input: "{}".to_string(),
                        },
                        AssistantEvent::ToolUse {
                            id: "tool-2".to_string(),
                            name: "never".to_string(),
                            input: "{}".to_string(),
                        },
                        AssistantEvent::MessageStop,
                    ]),
                    2 => Ok(vec![
                        AssistantEvent::TextDelta("handled".to_string()),
                        AssistantEvent::MessageStop,
                    ]),
                    _ => Err(RuntimeError::new("unexpected extra API call")),
                }
            }
        }

        let never_calls = Arc::new(AtomicUsize::new(0));
        let never_calls_check = Arc::clone(&never_calls);
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            BatchedApiClient { calls: 0 },
            StaticToolExecutor::new()
                .register("fail", |_input| Err(ToolError::new("first tool failed")))
                .register("never", move |_input| {
                    never_calls_check.fetch_add(1, Ordering::SeqCst);
                    Ok("should not execute".to_string())
                }),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        );

        let summary = runtime.run_turn("batch", None).expect("turn completes");

        assert_eq!(summary.tool_results.len(), 1);
        assert_eq!(summary.outcome, TurnOutcome::Completed);
        assert_eq!(never_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn synthetic_turn_input_is_not_persisted_in_session() {
        struct SyntheticApiClient {
            calls: usize,
        }

        impl ApiClient for SyntheticApiClient {
            fn stream(
                &mut self,
                request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                self.calls += 1;
                assert!(
                    request.messages.iter().any(|message| {
                        message.role == MessageRole::User
                            && matches!(
                                message.blocks.first(),
                                Some(ContentBlock::Text { text }) if text == "Continue."
                            )
                    }),
                    "synthetic input should be present in the request",
                );
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SyntheticApiClient { calls: 0 },
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        );

        let summary = runtime
            .run_turn_with_input(TurnInput::Synthetic("Continue.".to_string()), None)
            .expect("synthetic turn completes");

        assert_eq!(summary.outcome, TurnOutcome::Completed);
        assert_eq!(runtime.session().messages.len(), 1);
        assert!(matches!(
            runtime.session().messages[0].role,
            MessageRole::Assistant
        ));
    }

    #[test]
    fn reconstructs_usage_tracker_from_restored_session() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut session = Session::new();
        session
            .messages
            .push(crate::session::ConversationMessage::assistant_with_usage(
                vec![ContentBlock::Text {
                    text: "earlier".to_string(),
                }],
                Some(TokenUsage {
                    input_tokens: 11,
                    output_tokens: 7,
                    cache_creation_input_tokens: 2,
                    cache_read_input_tokens: 1,
                }),
            ));

        let runtime = ConversationRuntime::new(
            session,
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        );

        assert_eq!(runtime.usage().turns(), 1);
        assert_eq!(runtime.usage().cumulative_usage().total_tokens(), 21);
    }

    #[test]
    fn compacts_session_after_turns() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        );
        runtime.run_turn("a", None).expect("turn a");
        runtime.run_turn("b", None).expect("turn b");
        runtime.run_turn("c", None).expect("turn c");

        let result = runtime.compact(CompactionConfig {
            preserve_recent_messages: 2,
            max_estimated_tokens: 1,
        });
        assert!(result.summary.contains("Conversation summary"));
        assert_eq!(
            result.compacted_session.messages[0].role,
            MessageRole::System
        );
    }

    #[cfg(windows)]
    fn shell_snippet(script: &str) -> String {
        script.replace('\'', "\"")
    }

    #[cfg(not(windows))]
    fn shell_snippet(script: &str) -> String {
        script.to_string()
    }

    #[test]
    fn auto_compacts_when_cumulative_input_threshold_is_crossed() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::Usage(TokenUsage {
                        input_tokens: 120_000,
                        output_tokens: 4,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                    }),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let session = Session {
            version: 1,
            messages: vec![
                crate::session::ConversationMessage::user_text("one"),
                crate::session::ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "two".to_string(),
                }]),
                crate::session::ConversationMessage::user_text("three"),
                crate::session::ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "four".to_string(),
                }]),
            ],
        };

        let mut runtime = ConversationRuntime::new(
            session,
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        )
        .with_auto_compaction_input_tokens_threshold(100_000);

        let summary = runtime
            .run_turn("trigger", None)
            .expect("turn should succeed");

        assert_eq!(
            summary.auto_compaction,
            Some(AutoCompactionEvent {
                // `CompactionConfig::default().preserve_recent_messages` is 5; with four turns worth of
                // history this removes one block versus two when preserve was 4.
                removed_message_count: 1,
            })
        );
        assert_eq!(runtime.session().messages[0].role, MessageRole::System);
    }

    #[test]
    fn skips_auto_compaction_below_threshold() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::Usage(TokenUsage {
                        input_tokens: 99_999,
                        output_tokens: 4,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                    }),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        )
        .with_auto_compaction_input_tokens_threshold(100_000);

        let summary = runtime
            .run_turn("trigger", None)
            .expect("turn should succeed");
        assert_eq!(summary.auto_compaction, None);
        assert_eq!(runtime.session().messages.len(), 2);
    }

    #[test]
    fn auto_compaction_threshold_defaults_and_parses_values() {
        assert_eq!(
            parse_auto_compaction_threshold(None),
            DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD
        );
        assert_eq!(parse_auto_compaction_threshold(Some("4321")), 4321);
        assert_eq!(
            parse_auto_compaction_threshold(Some("not-a-number")),
            DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD
        );
    }

    struct RepeatingSearchClient {
        call_count: usize,
    }

    impl ApiClient for RepeatingSearchClient {
        fn stream(
            &mut self,
            _request: &ApiRequest<'_>,
        ) -> Result<Vec<AssistantEvent>, RuntimeError> {
            self.call_count += 1;
            if self.call_count > 8 {
                return Err(RuntimeError::new(
                    "RepeatingSearchClient called more times than expected",
                ));
            }
            let tool_id = format!("tool-{}", self.call_count);
            Ok(vec![
                AssistantEvent::ToolUse {
                    id: tool_id,
                    name: "glob".to_string(),
                    input: r#"{"pattern":"**/*cash*flow*"}"#.to_string(),
                },
                AssistantEvent::MessageStop,
            ])
        }
    }

    #[test]
    fn repeating_identical_tool_call_is_suppressed_and_turn_terminates() {
        let runs = Arc::new(AtomicUsize::new(0));
        let run_counter = Arc::clone(&runs);
        let tool_executor = StaticToolExecutor::new().register("glob", move |_input| {
            run_counter.fetch_add(1, Ordering::SeqCst);
            Ok("[]".to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("glob", PermissionMode::ReadOnly);
        let system_prompt = vec!["system".to_string()];
        let api_client = RepeatingSearchClient { call_count: 0 };
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
        );

        let summary = runtime
            .run_turn(
                "search for cashflow files",
                None::<&mut dyn PermissionPrompter>,
            )
            .expect("loop should terminate via duplicate-hit guard, not an error");

        assert_eq!(
            runs.load(Ordering::SeqCst),
            1,
            "the executor should run glob exactly once; repeats must be suppressed",
        );

        let synthetic_notices = summary
            .tool_results
            .iter()
            .filter(|message| {
                message.blocks.iter().any(|block| match block {
                    ContentBlock::ToolResult { output, .. } => {
                        output.contains("Duplicate tool call suppressed")
                    }
                    _ => false,
                })
            })
            .count();
        assert!(
            synthetic_notices >= 1,
            "expected at least one synthesized 'duplicate suppressed' tool result"
        );
        assert!(
            matches!(summary.outcome, TurnOutcome::ToolError { .. }),
            "duplicate-hit guard should report a ToolError outcome, got {:?}",
            summary.outcome,
        );
    }

    #[test]
    fn turn_level_dedup_key_treats_read_path_and_file_path_as_equal() {
        let key_a = super::turn_level_tool_dedup_key("read", r#"{"path":"a.txt"}"#);
        let key_b = super::turn_level_tool_dedup_key("read", r#"{"file_path":"a.txt"}"#);
        let key_c = super::turn_level_tool_dedup_key("read", r#"{"filePath":"a.txt"}"#);
        assert!(key_a.is_some());
        assert_eq!(key_a, key_b);
        assert_eq!(key_a, key_c);
    }

    #[test]
    fn turn_level_dedup_key_treats_edit_aliases_as_equal() {
        let key_a = super::turn_level_tool_dedup_key(
            "edit",
            r#"{"path":"a.txt","old_string":"a","new_string":"b","replace_all":true}"#,
        );
        let key_b = super::turn_level_tool_dedup_key(
            "edit",
            r#"{"filePath":"a.txt","oldString":"a","newString":"b","replaceAll":true}"#,
        );
        assert!(key_a.is_some());
        assert_eq!(key_a, key_b);
    }

    struct VaryingSearchClient {
        call_count: usize,
    }

    impl ApiClient for VaryingSearchClient {
        fn stream(
            &mut self,
            _request: &ApiRequest<'_>,
        ) -> Result<Vec<AssistantEvent>, RuntimeError> {
            self.call_count += 1;
            if self.call_count > 10 {
                return Err(RuntimeError::new(
                    "VaryingSearchClient called more times than expected",
                ));
            }
            Ok(vec![
                AssistantEvent::ToolUse {
                    id: format!("search-{}", self.call_count),
                    name: "glob".to_string(),
                    input: format!(
                        r#"{{"path":"H:\\shr1","pattern":"**/*cash*flow*{}"}}"#,
                        self.call_count
                    ),
                },
                AssistantEvent::MessageStop,
            ])
        }
    }

    #[test]
    fn varying_search_loop_stops_at_turn_search_budget() {
        let runs = Arc::new(AtomicUsize::new(0));
        let run_counter = Arc::clone(&runs);
        let tool_executor = StaticToolExecutor::new().register("glob", move |_input| {
            run_counter.fetch_add(1, Ordering::SeqCst);
            Ok("[]".to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("glob", PermissionMode::ReadOnly);
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            VaryingSearchClient { call_count: 0 },
            tool_executor,
            permission_policy,
            vec!["system".to_string()],
        );

        let summary = runtime
            .run_turn(
                "search for cashflow files",
                None::<&mut dyn PermissionPrompter>,
            )
            .expect("loop should terminate via local-search budget guard");

        assert_eq!(
            runs.load(Ordering::SeqCst),
            super::TURN_LOCAL_SEARCH_TOOL_LIMIT,
            "the executor should stop after the turn-level local search budget",
        );
        assert!(summary.tool_results.iter().any(|message| {
            message.blocks.iter().any(|block| match block {
                ContentBlock::ToolResult { output, .. } => {
                    output.contains("Search tool budget reached")
                }
                _ => false,
            })
        }));
        assert!(
            matches!(summary.outcome, TurnOutcome::ToolError { .. }),
            "search-budget guard should report a ToolError outcome, got {:?}",
            summary.outcome,
        );
    }

    #[test]
    fn local_search_tools_count_toward_turn_search_budget() {
        assert!(super::is_turn_level_local_search_tool("glob"));
        assert!(super::is_turn_level_local_search_tool("grep"));
        assert!(super::is_turn_level_local_search_tool("office_search"));
        assert!(!super::is_turn_level_local_search_tool("workspace"));
    }

    #[test]
    fn turn_level_dedup_key_is_insensitive_to_object_key_order() {
        let key_a =
            super::turn_level_tool_dedup_key("glob", r#"{"pattern":"**/*","path":"src"}"#);
        let key_b =
            super::turn_level_tool_dedup_key("glob", r#"{"path":"src","pattern":"**/*"}"#);
        assert_eq!(key_a, key_b);
    }
}
