use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use tauri::{AppHandle, Emitter, Runtime};
use ts_rs::TS;

use crate::agent_loop::retry::LoopStopReason;
use crate::agent_loop::state::{
    mark_terminal_status_emitted, set_session_run_state, AgentSessionPhase, AgentStatusOptions,
    LoopEpochGuard,
};
use crate::registry::{SessionRegistry, SessionRunState};

pub(crate) const E_TOOL_START: &str = "agent:tool_start";
pub(crate) const E_TOOL_RESULT: &str = "agent:tool_result";
pub(crate) const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
pub(crate) const E_USER_QUESTION: &str = "agent:user_question";
pub(crate) const E_TURN_COMPLETE: &str = "agent:turn_complete";
pub(crate) const E_ERROR: &str = "agent:error";
pub(crate) const E_TEXT_DELTA: &str = "agent:text_delta";
pub(crate) const E_STATUS: &str = "agent:status";

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStartEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    #[ts(type = "unknown")]
    pub input: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResultEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserQuestionNeededEvent {
    pub session_id: String,
    pub question_id: String,
    /// Plain text prompt (questions and optional option labels).
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct AgentApprovalNeededEvent {
    pub session_id: String,
    pub approval_id: String,
    pub tool_name: String,
    pub description: String,
    pub target: Option<String>,
    #[ts(type = "unknown")]
    pub input: serde_json::Value,
    /// True when the session was started with a non-empty workspace `cwd` (enables "allow for workspace").
    pub workspace_cwd_configured: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnCompleteEvent {
    pub session_id: String,
    pub stop_reason: String,
    pub assistant_message: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[skip_serializing_none]
pub struct AgentSessionStatusEvent {
    pub session_id: String,
    pub phase: String,
    pub attempt: Option<usize>,
    pub message: Option<String>,
    pub next_retry_at_ms: Option<u64>,
    pub tool_name: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorEvent {
    pub session_id: String,
    pub error: String,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTextDeltaEvent {
    pub session_id: String,
    pub text: String,
    pub is_complete: bool,
    #[serde(default)]
    pub replace_existing: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RelayMessage {
    pub role: String,
    pub content: Vec<MessageContent>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageContent {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        #[ts(type = "unknown")]
        input: serde_json::Value,
    },
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: String,
        #[serde(rename = "isError")]
        is_error: bool,
    },
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<RelayMessage>,
}

const COPILOT_UI_TEXT_CHUNK: usize = 48;

fn epoch_ms_now() -> u64 {
    #[allow(clippy::cast_possible_truncation)]
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    ms
}

fn collapse_inline_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_for_log(text: &str, max_chars: usize) -> String {
    let collapsed = collapse_inline_whitespace(text);
    let truncated = collapsed.chars().take(max_chars).collect::<String>();
    if collapsed.chars().count() > max_chars {
        format!("{truncated}...")
    } else {
        truncated
    }
}

pub(crate) fn emit_text_delta_event<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    text: &str,
    is_complete: bool,
    replace_existing: bool,
) {
    let evt = AgentTextDeltaEvent {
        session_id: session_id.to_string(),
        text: text.to_string(),
        is_complete,
        replace_existing,
    };
    if let Err(e) = app.emit(E_TEXT_DELTA, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_TEXT_DELTA}): {e}");
    }
}

fn record_stream_metrics(
    registry: &SessionRegistry,
    session_id: &str,
    emitted_chunks: usize,
    preview_text: &str,
) {
    let preview = collapse_inline_whitespace(preview_text);
    let preview = (!preview.is_empty()).then(|| truncate_for_log(&preview, 240));
    let now_ms = epoch_ms_now();
    let _ignore = registry.mutate_session(session_id, |entry| {
        if emitted_chunks > 0 {
            entry.stream_delta_count += emitted_chunks;
            if entry.first_stream_at_ms.is_none() {
                entry.first_stream_at_ms = Some(now_ms);
            }
            entry.last_stream_at_ms = Some(now_ms);
        } else if preview.is_some() {
            entry.last_stream_at_ms = Some(now_ms);
        }
        if let Some(preview) = preview.clone() {
            entry.stream_preview_text = Some(preview);
        }
    });
}

pub(crate) fn append_only_suffix<'a>(previous_text: &str, next_text: &'a str) -> Option<&'a str> {
    let prev = previous_text.trim();
    let next = next_text.trim();
    if prev.is_empty() {
        return Some(next);
    }
    next.strip_prefix(prev)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StreamTextUpdate {
    NoChange,
    Append(String),
    Replace(String),
}

pub(crate) fn classify_stream_text_update(
    previous_text: &str,
    next_text: &str,
) -> StreamTextUpdate {
    let next = next_text.trim();
    if next.is_empty() {
        return StreamTextUpdate::NoChange;
    }
    if let Some(suffix) = append_only_suffix(previous_text, next_text) {
        if suffix.is_empty() {
            return StreamTextUpdate::NoChange;
        }
        return StreamTextUpdate::Append(suffix.to_string());
    }
    StreamTextUpdate::Replace(next.to_string())
}

pub(crate) fn emit_copilot_text_suffix_for_ui<R: Runtime>(
    app: &AppHandle<R>,
    registry: &SessionRegistry,
    session_id: &str,
    previous_text: &str,
    next_text: &str,
    mark_complete: bool,
) {
    let next = next_text.trim();
    let mut emitted_chunks = 0usize;
    match classify_stream_text_update(previous_text, next_text) {
        StreamTextUpdate::NoChange => {}
        StreamTextUpdate::Append(suffix) => {
            let mut start = 0usize;
            for (i, _) in suffix.char_indices() {
                if i > start && (i - start) >= COPILOT_UI_TEXT_CHUNK {
                    emit_text_delta_event(app, session_id, &suffix[start..i], false, false);
                    emitted_chunks += 1;
                    start = i;
                }
            }
            if start < suffix.len() {
                emit_text_delta_event(app, session_id, &suffix[start..], false, false);
                emitted_chunks += 1;
            }
        }
        StreamTextUpdate::Replace(replacement) => {
            tracing::debug!(
                "[RelayAgent] replacing streaming snapshot for session {} (prev_len={}, next_len={})",
                session_id,
                previous_text.trim().len(),
                replacement.len()
            );
            let mut start = 0usize;
            let mut first_chunk = true;
            for (i, _) in replacement.char_indices() {
                if i > start && (i - start) >= COPILOT_UI_TEXT_CHUNK {
                    emit_text_delta_event(
                        app,
                        session_id,
                        &replacement[start..i],
                        false,
                        first_chunk,
                    );
                    emitted_chunks += 1;
                    first_chunk = false;
                    start = i;
                }
            }
            if start < replacement.len() {
                emit_text_delta_event(app, session_id, &replacement[start..], false, first_chunk);
                emitted_chunks += 1;
            }
        }
    }
    if mark_complete {
        emit_text_delta_event(app, session_id, "", true, false);
    }
    if emitted_chunks > 0 || !next.is_empty() {
        record_stream_metrics(registry, session_id, emitted_chunks, next);
    }
}

pub(crate) fn emit_copilot_text_deltas_for_ui<R: Runtime>(
    app: &AppHandle<R>,
    registry: &SessionRegistry,
    session_id: &str,
    visible_text: &str,
) {
    emit_copilot_text_suffix_for_ui(app, registry, session_id, "", visible_text, true);
}

pub(crate) fn emit_status_event<R: Runtime>(
    app: &AppHandle<R>,
    guard: &LoopEpochGuard,
    phase: AgentSessionPhase,
    options: AgentStatusOptions,
) {
    if !guard.is_current() {
        return;
    }
    if phase == AgentSessionPhase::Idle && !mark_terminal_status_emitted(guard) {
        return;
    }
    let evt = AgentSessionStatusEvent {
        session_id: guard.session_id.clone(),
        phase: phase.as_str().to_string(),
        attempt: options.attempt,
        message: options.message,
        next_retry_at_ms: options.next_retry_at_ms,
        tool_name: options.tool_name,
        stop_reason: options
            .stop_reason
            .map(|reason| reason.as_str().to_string()),
    };
    if let Err(e) = app.emit(E_STATUS, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_STATUS}): {e}");
    }
}

pub(crate) fn transition_session_state<R: Runtime>(
    app: &AppHandle<R>,
    guard: &LoopEpochGuard,
    run_state: SessionRunState,
    phase: AgentSessionPhase,
    options: AgentStatusOptions,
) {
    set_session_run_state(guard, run_state);
    emit_status_event(app, guard, phase, options);
}

pub(crate) fn emit_turn_complete<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    stop_reason: LoopStopReason,
    message_count: usize,
    assistant_message: &str,
) {
    if let Err(e) = app.emit(
        E_TURN_COMPLETE,
        AgentTurnCompleteEvent {
            session_id: session_id.to_string(),
            stop_reason: stop_reason.as_str().into(),
            assistant_message: assistant_message.to_string(),
            message_count,
        },
    ) {
        tracing::warn!("[RelayAgent] emit failed ({E_TURN_COMPLETE}): {e}");
    }
}

pub(crate) fn emit_error<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    error: &str,
    cancelled: bool,
) {
    let evt = AgentErrorEvent {
        session_id: session_id.to_string(),
        error: error.to_string(),
        cancelled,
    };
    if let Err(e) = app.emit(E_ERROR, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
    }
}
