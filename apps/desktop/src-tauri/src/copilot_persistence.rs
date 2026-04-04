use std::env;
use std::fs;
use std::path::PathBuf;

use runtime::{ContentBlock, ConversationMessage, RuntimeError, Session, TokenUsage};
use serde::{Deserialize, Serialize};

/* ── Session persistence types ─── */

/// Configuration for a persisted session (goal, cwd, `max_turns`).
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

/// A session loaded from disk with its configuration.
#[derive(Clone, Debug)]
pub struct LoadedSession {
    pub session: Session,
    pub config: PersistedSessionConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSessionRecord {
    session_id: String,
    version: u32,
    messages: Vec<PersistedMessage>,
    #[serde(default)]
    config: PersistedSessionConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMessage {
    role: String,
    blocks: Vec<PersistedContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<PersistedTokenUsage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PersistedContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: String },
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        output: String,
        is_error: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
struct PersistedTokenUsage {
    input_tokens: u32,
    output_tokens: u32,
    cache_creation_input_tokens: u32,
    cache_read_input_tokens: u32,
}

/* ── Public API ─── */

/// Save a session to disk.
pub fn save_session(
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

/// Load a session from disk, if it exists.
pub fn load_session(session_id: &str) -> Result<Option<LoadedSession>, RuntimeError> {
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

/* ── Persistence internals ─── */

fn session_storage_dir() -> Result<PathBuf, RuntimeError> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| RuntimeError::new("unable to resolve the home directory for session storage"))?;
    Ok(home.join(".relay-agent").join("sessions"))
}

/// Validates a `session_id` for safe use in filesystem paths.
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
                "session_id contains invalid character '{ch}' (only alphanumeric, hyphens, and underscores are allowed)"
            ));
        }
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
fn io_error(error: std::io::Error) -> RuntimeError {
    RuntimeError::new(format!("session persistence failed: {error}"))
}

impl PersistedMessage {
    fn from_runtime(message: &ConversationMessage) -> Self {
        use runtime::MessageRole;

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

    fn into_runtime(self) -> Result<ConversationMessage, RuntimeError> {
        use runtime::MessageRole;

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

        Ok(ConversationMessage {
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
