use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// M365 Copilot (CDP) cannot take API `tools`; model must emit this fenced JSON for invocations.
const CDP_TOOL_FENCE: &str = "```relay_tool";

/// Composer text when the full turn payload is sent as an attached file (see `CdpApiClient::stream`).
/// Keep short; the attachment holds system + conversation + tool catalog.
const CDP_FILE_DELIVERY_USER_MESSAGE: &str = "The attached text file is the full Relay Agent turn bundle (system context, conversation, and tool catalog). Read it and follow it. **Relay** parses your reply for `relay_tool` / `json` tool fences and **executes** those tools on the user's machine (not just display). Output real fenced tool JSON when the task needs files or other tools—do not claim this chat cannot run Relay tools. If the conversation **already** states concrete paths and what to do (e.g. improve/edit a named file), **emit tool calls in this reply**—do **not** ask the user to restate or give a “next step” you already have.\n\n（添付は Relay Agent 用の全文バンドルです。返信内の `relay_tool` や許容される `json` フェンスは Relay デスクトップが**解析して実行**します。表示用の説明だけにせず、必要なら規約どおりフェンス付きツール JSON を出してください。「この Copilot ではツール不可」と拒否しないでください。**パスと作業内容が既にユーザーメッセージにある場合は、この返信でツールを実行**し、同じ指示の再入力を求めないでください。）";

/// Undocumented: set to `1` or `true` to paste the full prompt into the composer instead of file attach (local debugging only).
fn cdp_legacy_composer_full_paste() -> bool {
    std::env::var("RELAY_CDP_LEGACY_COMPOSER")
        .map(|v| {
            matches!(
                v.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Replace typographic Unicode so M365/Windows is less likely to mojibake the `.txt` bundle if UTF-8 is mis-detected.
fn normalize_prompt_for_cdp_file_attachment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\u{2014}' | '\u{2013}' => out.push_str(" - "),
            '\u{2192}' => out.push_str("->"),
            '\u{2190}' => out.push_str("<-"),
            '\u{2026}' => out.push_str("..."),
            '\u{2018}' | '\u{2019}' => out.push('\''),
            '\u{201C}' | '\u{201D}' => out.push('"'),
            '\u{00A0}' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

/// Write UTF-8 text with a BOM so Japanese Windows / M365 often treat the attachment as UTF-8, not CP932.
fn write_utf8_file_with_bom(path: &Path, content: &str) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(3 + content.len());
    bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    bytes.extend_from_slice(content.as_bytes());
    std::fs::write(path, bytes)
}

use runtime::{
    self, assert_path_in_workspace, lexical_normalize, resolve_against_workspace, ApiClient,
    BashConfigCwdGuard,
    ApiRequest, AssistantEvent, ConfigLoader, ContentBlock, ConversationMessage, McpServerManager,
    MessageRole, PermissionMode, PermissionPolicy, PermissionPromptDecision, PermissionPrompter,
    PermissionRequest, RuntimeError, Session as RuntimeSession, TokenUsage, ToolExecutor,
    pull_rust_diagnostics_blocking,
};

use crate::copilot_persistence::{self, PersistedSessionConfig};
use crate::error::AgentLoopError;
use crate::models::{DesktopPermissionSummaryRow, SessionPreset};
use crate::registry::SessionRegistry;
use crate::session_write_undo;
use crate::tauri_bridge;

/// Tools allowed in **Explore** preset (narrow read-only catalog + policy).
const EXPLORE_TOOL_NAMES: &[&str] = &["read_file", "glob_search", "grep_search"];

/// **Build:** read/search tools run freely; workspace writes map to danger tier so the user is
/// prompted (writes, shell, MCP, etc.). **Plan:** host active mode is read-only so mutating tools
/// are denied without prompts (OpenCode-style plan agent); `.claw` permission heuristics for bash
/// still apply in addition. **Explore:** same read-only host as Plan, but every tool outside
/// `EXPLORE_TOOL_NAMES` requires danger tier so only file discovery reads run.
fn desktop_permission_policy(preset: SessionPreset) -> PermissionPolicy {
    let base = match preset {
        SessionPreset::Build => PermissionMode::WorkspaceWrite,
        SessionPreset::Plan | SessionPreset::Explore => PermissionMode::ReadOnly,
    };
    let mut policy = PermissionPolicy::new(base);
    for spec in tools::mvp_tool_specs() {
        let mut required = if spec.required_permission == PermissionMode::WorkspaceWrite {
            PermissionMode::DangerFullAccess
        } else {
            spec.required_permission
        };
        if preset == SessionPreset::Explore && !EXPLORE_TOOL_NAMES.contains(&spec.name) {
            required = PermissionMode::DangerFullAccess;
        }
        policy = policy.with_tool_requirement(spec.name, required);
    }
    policy
}

fn classify_permission_ui_requirement(
    host: PermissionMode,
    required: PermissionMode,
) -> &'static str {
    if host == PermissionMode::Allow || host >= required {
        return "auto_allow";
    }
    if host == PermissionMode::WorkspaceWrite && required == PermissionMode::DangerFullAccess {
        return "require_approval";
    }
    if host == PermissionMode::Prompt {
        return "require_approval";
    }
    "auto_deny"
}

fn permission_row_description(tool: &str, requirement: &str) -> String {
    match requirement {
        "auto_allow" => format!("{tool} runs without a prompt in this session mode."),
        "require_approval" => format!("{tool} may show an approval prompt before running."),
        _ => format!("{tool} is blocked in this session mode."),
    }
}

/// Effective tool gating for the given composer preset (Context → Policy).
pub fn desktop_permission_summary_rows(preset: SessionPreset) -> Vec<DesktopPermissionSummaryRow> {
    let policy = desktop_permission_policy(preset);
    let host = policy.active_mode();
    let host_label = host.as_str().to_string();
    tools::mvp_tool_specs()
        .into_iter()
        .map(|spec| {
            let required = policy.required_mode_for(&spec.name);
            let req_label = required.as_str().to_string();
            let requirement = classify_permission_ui_requirement(host, required).to_string();
            let description = permission_row_description(&spec.name, &requirement);
            DesktopPermissionSummaryRow {
                name: spec.name.to_string(),
                host_mode: host_label.clone(),
                required_mode: req_label,
                requirement,
                description,
            }
        })
        .collect()
}

fn session_preset_system_addon(preset: SessionPreset) -> Option<&'static str> {
    match preset {
        SessionPreset::Build => None,
        SessionPreset::Plan => Some(
            r#"## Session mode: Plan (read-only host)

This session uses **Plan** preset: the host blocks **file writes**, **shell**, **PDF merge/split**, **WebFetch/WebSearch**, and other tools that require more than read-only permission. Use **read_file**, **glob_search**, **grep_search**, and **TodoWrite** to analyze the workspace and return **plans or proposed edits as markdown only**. To apply file or shell changes, start a **new session** with the **Build** preset (Composer → Build).

Project **`.claw`** settings still apply for bash validation and merged instructions when those tools would run."#,
        ),
        SessionPreset::Explore => Some(
            r#"## Session mode: Explore (narrow read-only)

This session uses **Explore** preset: only **read_file**, **glob_search**, and **grep_search** are available—no web, no shell, no MCP, no task list updates, no writes. Map the codebase quickly; for broader read-only analysis (including **TodoWrite**), use **Plan**; to **apply edits**, start a **new session** with **Build**."#,
        ),
    }
}

/// One-line + optional path/command context for the approval UI (no raw tool jargon in the title).
fn human_approval_summary(tool_name: &str, input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or_else(|_| json!({}));
    let path = v.get("path").and_then(|p| p.as_str());
    let notebook_path = v.get("notebook_path").and_then(|p| p.as_str());
    let cmd = v.get("command").and_then(|c| c.as_str());
    let url = v.get("url").and_then(|u| u.as_str());

    match tool_name {
        "read_file" => path.map_or_else(|| "Allow reading a file?".into(), |p| {
            format!("Allow reading this file?\n{p}")
        }),
        "glob_search" => {
            let pat = v.get("pattern").and_then(|x| x.as_str()).unwrap_or("*");
            format!("Search the workspace for files matching “{pat}”?")
        }
        "grep_search" => {
            let pat = v.get("pattern").and_then(|x| x.as_str()).unwrap_or("pattern");
            format!("Search file contents for “{pat}”?")
        }
        "write_file" => path.map_or_else(|| "Create or overwrite a file?".into(), |p| {
            format!("Create or overwrite this file?\n{p}")
        }),
        "edit_file" => path.map_or_else(|| "Edit a file?".into(), |p| format!("Edit this file?\n{p}")),
        "pdf_merge" => {
            let out = v
                .get("output_path")
                .and_then(|x| x.as_str())
                .unwrap_or("(output)");
            let n = v
                .get("input_paths")
                .and_then(|x| x.as_array())
                .map_or(0, Vec::len);
            format!("Merge {n} PDF files into this output?\n{out}")
        }
        "pdf_split" => {
            let inp = v
                .get("input_path")
                .and_then(|x| x.as_str())
                .unwrap_or("(input)");
            let n = v
                .get("segments")
                .and_then(|x| x.as_array())
                .map_or(0, Vec::len);
            format!("Split PDF into {n} output file(s)?\n{inp}")
        }
        "bash" => cmd.map_or_else(
            || "Run a bash command?".into(),
            |c| {
                let preview: String = c.chars().take(120).collect();
                format!("Run this command?\n{preview}")
            },
        ),
        "PowerShell" => cmd.map_or_else(
            || "Run PowerShell (may batch Office COM: Word, Excel, PowerPoint, .msg)?".into(),
            |c| {
                let preview: String = c.chars().take(120).collect();
                format!("Allow this PowerShell command (Office COM possible)?\n{preview}")
            },
        ),
        "WebFetch" => url.map_or_else(|| "Fetch content from a URL?".into(), |u| {
            format!("Fetch content from this URL?\n{u}")
        }),
        "WebSearch" => {
            let q = v.get("query").and_then(|x| x.as_str()).unwrap_or("…");
            format!("Search the web for “{q}”?")
        }
        "git_status" => path.map_or_else(|| "Run git status in the workspace?".into(), |p| {
            format!("Run git status in this folder?\n{p}")
        }),
        "git_diff" => path.map_or_else(|| "Run git diff in the workspace?".into(), |p| {
            format!("Run git diff in this folder?\n{p}")
        }),
        "TodoWrite" => "Update the task list?".to_string(),
        "NotebookEdit" => notebook_path.map_or_else(|| "Edit a notebook?".into(), |p| {
            format!("Edit this notebook?\n{p}")
        }),
        "Config" => {
            let s = v.get("setting").and_then(|x| x.as_str()).unwrap_or("settings");
            format!("Change configuration: {s}?")
        }
        "Agent" => "Run a delegated sub-task?".to_string(),
        "REPL" => "Run code in a REPL?".to_string(),
        "CliRun" => {
            let cli = v.get("cli").and_then(|x| x.as_str()).unwrap_or("program");
            format!("Run external program “{cli}”?")
        }
        "CliRegister" | "CliUnregister" => {
            format!("Change registered CLI tools ({tool_name})?")
        }
        "ElectronLaunch" | "ElectronEval" | "ElectronClick" | "ElectronTypeText" => {
            "Control a desktop app through automation?".to_string()
        }
        name if name.starts_with("mcp__") => format!("Allow connected integration “{name}”?"),
        _ => {
            if let Some(p) = path {
                format!("Allow this action on {p}?")
            } else if let Some(c) = cmd {
                let preview: String = c.chars().take(80).collect();
                format!("Allow this command?\n{preview}")
            } else {
                format!("Allow “{tool_name}”?")
            }
        }
    }
}

fn approval_target_hint(input: &str) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    v.get("path")
        .and_then(|p| p.as_str())
        .map(String::from)
        .or_else(|| {
            v.get("notebook_path")
                .and_then(|p| p.as_str())
                .map(String::from)
        })
        .or_else(|| v.get("url").and_then(|p| p.as_str()).map(String::from))
}

/* ── Event name constants ─── */

pub(crate) const E_TOOL_START: &str = "agent:tool_start";
pub(crate) const E_TOOL_RESULT: &str = "agent:tool_result";
pub(crate) const E_APPROVAL_NEEDED: &str = "agent:approval_needed";
pub(crate) const E_USER_QUESTION: &str = "agent:user_question";
pub(crate) const E_TURN_COMPLETE: &str = "agent:turn_complete";
pub(crate) const E_ERROR: &str = "agent:error";
pub(crate) const E_TEXT_DELTA: &str = "agent:text_delta";

/// Remove M365 Copilot bracketed markers such as `【richwebanswer-…】` from visible prose.
fn strip_richwebanswer_spans(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '【' {
            out.push(c);
            continue;
        }
        let mut inner = String::new();
        inner.push(c);
        let mut closed = false;
        while let Some(c2) = chars.next() {
            inner.push(c2);
            if c2 == '】' {
                closed = true;
                break;
            }
        }
        if closed && inner.contains("richwebanswer") {
            continue;
        }
        out.push_str(&inner);
    }
    out
}

/// Drop consecutive duplicate paragraphs (Copilot sometimes pastes the same block many times).
fn dedupe_consecutive_paragraphs(s: &str) -> String {
    let parts: Vec<&str> = s.split("\n\n").collect();
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        let t = p.trim();
        if t.is_empty() {
            continue;
        }
        if out.last().is_some_and(|prev| prev.as_str() == t) {
            continue;
        }
        out.push(t.to_string());
    }
    out.join("\n\n")
}

/// Normalize Copilot assistant-visible text before persisting and before UI emission.
fn sanitize_copilot_visible_text(s: &str) -> String {
    let s = strip_richwebanswer_spans(s);
    dedupe_consecutive_paragraphs(&s)
}

const COPILOT_UI_TEXT_CHUNK: usize = 320;

fn emit_copilot_text_deltas_for_ui(app: &AppHandle, session_id: &str, visible_text: &str) {
    let v = visible_text.trim();
    if v.is_empty() {
        return;
    }
    let mut start = 0usize;
    for (i, _) in v.char_indices() {
        if i > start && (i - start) >= COPILOT_UI_TEXT_CHUNK {
            let evt = AgentTextDeltaEvent {
                session_id: session_id.to_string(),
                text: v[start..i].to_string(),
                is_complete: false,
            };
            if let Err(e) = app.emit(E_TEXT_DELTA, &evt) {
                tracing::warn!("[RelayAgent] emit failed ({E_TEXT_DELTA}): {e}");
            }
            start = i;
        }
    }
    let evt = AgentTextDeltaEvent {
        session_id: session_id.to_string(),
        text: v[start..].to_string(),
        is_complete: true,
    };
    if let Err(e) = app.emit(E_TEXT_DELTA, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_TEXT_DELTA}): {e}");
    }
}

fn collect_all_assistant_text_for_ui(session: &RuntimeSession) -> String {
    session
        .messages
        .iter()
        .filter(|m| m.role == MessageRole::Assistant)
        .flat_map(|m| m.blocks.iter())
        .filter_map(|b| match b {
            ContentBlock::Text { text } => {
                let t = text.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(text.clone())
                }
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/* ── POSIX shell escaping ─── */

/// POSIX-compliant shell escaping for use in `sh -c` contexts.
/// Wraps the string in single quotes, escaping embedded single quotes as `'\''`.
/// Rejects null bytes and control characters (except tab 0x09).
pub(crate) fn posix_shell_escape(s: &str) -> Result<String, String> {
    if s.bytes()
        .any(|b| b == 0 || (b < 0x20 && b != 0x09) || b == 0x7F)
    {
        return Err("working directory path contains control characters".to_string());
    }
    Ok(s.replace('\'', "'\\''"))
}

/* ── Agent loop ─── */

#[allow(clippy::needless_pass_by_value)]
pub fn run_agent_loop_impl(
    app: &AppHandle,
    registry: &SessionRegistry,
    session_id: &str,
    goal: String,
    cwd: Option<String>,
    max_turns: Option<usize>,
    session_preset: SessionPreset,
    cancelled: Arc<AtomicBool>,
) -> Result<(), AgentLoopError> {
    let server = tauri_bridge::ensure_copilot_server()
        .map_err(AgentLoopError::InitializationError)?;
    let api_client = CdpApiClient::new(
        server,
        session_preset,
        Some((app.clone(), session_id.to_string())),
    );

    let tool_executor = build_tool_executor(app, session_id, cwd.clone(), registry.clone());
    let permission_policy = desktop_permission_policy(session_preset);
    let system_prompt = build_desktop_system_prompt(&goal, cwd.as_deref(), session_preset);
    let config = crate::config::AgentConfig::global();
    let max_turns = max_turns.unwrap_or(config.max_turns);

    let mut runtime_session = runtime::ConversationRuntime::new(
        RuntimeSession::new(),
        api_client,
        tool_executor,
        permission_policy,
        system_prompt,
    );
    runtime_session = runtime_session.with_max_iterations(max_turns);

    let mut prompter = TauriApprovalPrompter {
        app: app.clone(),
        session_id: session_id.to_string(),
        registry: registry.clone(),
    };

    let mut final_summary = None;

    for turn in 0..max_turns {
        if cancelled.load(Ordering::SeqCst) {
            break;
        }

        let turn_input = if turn == 0 { goal.as_str() } else { "Continue." };
        let summary = match runtime_session.run_turn(turn_input, Some(&mut prompter)) {
            Ok(summary) => summary,
            Err(error) => {
                emit_error(app, session_id, &format!("agent loop failed: {error}"), false);
                break;
            }
        };

        persist_turn(
            app,
            registry,
            &runtime_session,
            session_id,
            &goal,
            cwd.as_ref(),
            max_turns,
            session_preset,
        )?;

        let needs_more_turns = summary.assistant_messages.last().is_some_and(|message| {
            message
                .blocks
                .iter()
                .any(|block| matches!(block, ContentBlock::ToolUse { .. }))
        });

        final_summary = Some(summary);

        if !needs_more_turns {
            break;
        }
    }

    if let Some(summary) = &final_summary {
        // Clear `running` before emitting so `get_session_history` matches the UI; otherwise the
        // frontend reload after `turn_complete` can see `running: true` until `mark_finished` runs
        // after persistence and re-enable the "thinking" indicator.
        let _ignore = registry.mutate_session(session_id, |entry| {
            entry.running = false;
        });
        emit_turn_complete(app, session_id, summary, &runtime_session, &cancelled);
    }

    let session = runtime_session.into_session();
    copilot_persistence::save_session(
        session_id,
        &session,
        PersistedSessionConfig {
            goal: Some(goal),
            cwd,
            max_turns: Some(max_turns),
            session_preset: Some(session_preset),
        },
    )
    .map_err(|error| AgentLoopError::PersistenceError(error.to_string()))?;
    let _ignore = registry.mutate_session(session_id, |entry| {
        entry.session = session;
    });

    Ok(())
}

/* ── CDP-based API client ─── */

/// Sends prompts to M365 Copilot via the bundled `copilot_server.js` (Node + CDP).
pub struct CdpApiClient {
    server: std::sync::Arc<std::sync::Mutex<crate::copilot_server::CopilotServer>>,
    response_timeout_secs: u64,
    session_preset: SessionPreset,
    /// When set, each Copilot reply emits `agent:text_delta` so the UI updates during tool loops.
    progress_emit: Option<(AppHandle, String)>,
}

impl CdpApiClient {
    fn new(
        server: std::sync::Arc<std::sync::Mutex<crate::copilot_server::CopilotServer>>,
        session_preset: SessionPreset,
        progress_emit: Option<(AppHandle, String)>,
    ) -> Self {
        Self {
            server,
            response_timeout_secs: 120,
            session_preset,
            progress_emit,
        }
    }
}

impl ApiClient for CdpApiClient {
    fn stream(&mut self, request: &ApiRequest<'_>) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let prompt = normalize_prompt_for_cdp_file_attachment(&build_cdp_prompt(
            request,
            self.session_preset,
        ));

        let legacy_composer = cdp_legacy_composer_full_paste();
        if legacy_composer {
            tracing::info!(
                "[CdpApiClient] RELAY_CDP_LEGACY_COMPOSER: full composer paste ({} chars)",
                prompt.len()
            );
        } else {
            tracing::info!(
                "[CdpApiClient] sending prompt via file attachment ({} chars)",
                prompt.len()
            );
        }

        let mut temp_prompt_file: Option<PathBuf> = None;
        let (user_message, attachment_paths): (&str, Vec<String>) = if legacy_composer {
            (prompt.as_str(), vec![])
        } else {
            let path = std::env::temp_dir().join(format!(
                "relay-cdp-prompt-{}.txt",
                Uuid::new_v4()
            ));
            write_utf8_file_with_bom(&path, prompt.as_str()).map_err(|e| {
                RuntimeError::new(format!("failed to write temp Copilot prompt file: {e}"))
            })?;
            let path_for_attach = path
                .canonicalize()
                .unwrap_or_else(|_| path.clone())
                .to_string_lossy()
                .into_owned();
            temp_prompt_file = Some(path);
            (CDP_FILE_DELIVERY_USER_MESSAGE, vec![path_for_attach])
        };

        let t0 = Instant::now();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::new(format!("tokio runtime: {e}")))?;

        let response_text = {
            let mut srv = self
                .server
                .lock()
                .map_err(|e| RuntimeError::new(format!("copilot server lock poisoned: {e}")))?;
            rt.block_on(async {
                srv
                    .send_prompt(
                        "",
                        user_message,
                        self.response_timeout_secs,
                        &attachment_paths,
                    )
                    .await
            })
            .map_err(|e| RuntimeError::new(format!("Copilot request failed: {e}")))?
        };

        if let Some(path) = temp_prompt_file {
            if let Err(e) = std::fs::remove_file(&path) {
                tracing::debug!(path = %path.display(), error = %e, "temp Copilot prompt file cleanup");
            }
        }

        tracing::info!(
            "[CdpApiClient] response {} chars in {:?}",
            response_text.len(),
            t0.elapsed()
        );

        let (mut visible_text, tool_calls) = parse_copilot_tool_response(&response_text);
        if visible_text.trim().is_empty() && !response_text.trim().is_empty() {
            // Copilot may return prose that ends up empty after relay_tool stripping (or odd fences).
            visible_text = response_text.trim().to_string();
        }
        let visible_text = sanitize_copilot_visible_text(&visible_text);

        if let Some((app, sid)) = &self.progress_emit {
            emit_copilot_text_deltas_for_ui(app, sid, &visible_text);
        }

        let mut events = Vec::new();
        if !visible_text.is_empty() {
            // Chunk the response into TextDelta events for the runtime transcript (tests / parity).
            const RUNTIME_TEXT_CHUNK: usize = 200;
            let mut start = 0;
            for (i, _) in visible_text.char_indices() {
                if i > start && (i - start) >= RUNTIME_TEXT_CHUNK {
                    events.push(AssistantEvent::TextDelta(visible_text[start..i].to_string()));
                    start = i;
                }
            }
            if start < visible_text.len() {
                events.push(AssistantEvent::TextDelta(visible_text[start..].to_string()));
            }
        }

        for (id, name, input) in tool_calls {
            events.push(AssistantEvent::ToolUse { id, name, input });
        }

        events.push(AssistantEvent::Usage(TokenUsage {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }));
        events.push(AssistantEvent::MessageStop);
        Ok(events)
    }
}

#[cfg(windows)]
fn cdp_windows_office_catalog_addon() -> &'static str {
    r#"

## Windows desktop Office and .msg (PowerShell + COM)

On **Windows**, for **desktop Word, Excel, PowerPoint**, and **`.msg`**, use the **`PowerShell` tool** with COM (`Word.Application`, `Excel.Application`, `PowerPoint.Application`; `.msg` via `Outlook.Application` when Outlook is installed). Prefer COM over using `read_file`/`write_file`/`edit_file` on those binary formats unless the user has exported plain text or CSV.

### Hybrid read (data + layout)

When the user needs **accurate numbers/tables** and **layout-oriented text** for the model:

1. In **one `PowerShell` `command`**: open the Office file (read-only where possible); set `$excel.DisplayAlerts = $false` / `$word.DisplayAlerts = $false` (and `$ppt` equivalent); `$excel.ScreenUpdating = $false` in `try`/`finally` for Excel.
2. **Structured data (source of truth for Excel):** batch-read **`Range.Value2`** into a PowerShell array and emit **`ConvertTo-Json -Compress`** (or `Export-Csv` for a defined range to a temp path). **Never** per-cell COM loops.
3. **Layout PDF:** COM **`ExportAsFixedFormat`** (Excel/Word) or the presentation export equivalent for PowerPoint; use **`OpenAfterPublish=$false`** / **`OpenAfterExport=$false`**. Write to a **unique path** under **`$env:TEMP\RelayAgent\office-layout\`** (create the folder; use a new GUID in the filename). **`Quit()`** hosts in `finally`.
4. Print **one JSON object** to stdout with at least **`structured`** (or embed 2D data inline) and **`pdfPath`** (absolute path to the temp PDF). Optionally **`csvPath`** if you exported CSV.
5. In the **same** `relay_tool` fence, include a second tool: **`read_file`** with **`path`** = `pdfPath` (and optional `pages` for large PDFs). **Two tools in one array** is intentional; still avoid splitting **one workbook** across many separate PowerShell invocations in one turn.
6. **Excel:** treat **LiteParse text from the PDF** as **layout hints only**; **numeric truth** is **`Value2` / CSV**. Scope PDF export to **one sheet or a defined print area** when workbooks are large (PDF parse timeouts and size limits apply).
7. After use, you may **`Remove-Item`** the temp PDF (and CSV) if policy allows; otherwise rely on `%TEMP%` cleanup.

**Copilot latency:** Each model turn is expensive. Prefer **one `PowerShell` invocation** per batch: open → extract + export PDF → `Quit()` in a **single** `command` string. Avoid many small `PowerShell` calls for one spreadsheet or document in the same turn.

**Excel:** **Never** loop COM cell-by-cell. Use **2D arrays** with `Range.Value2`, block `Range` writes, CSV import, or similar batch APIs. Use `$excel.ScreenUpdating = $false` in `try`/`finally` when appropriate.

**Word / PowerPoint:** Prefer batch Find/Replace and range-level edits; avoid unnecessary `Select`/`Activate`.

**.msg / Outlook:** Trust Center or policy may block programmatic access; if COM fails, explain and ask the user to adjust policy or provide an export.

Prefer **`ConvertTo-Json -Compress`** on stdout for structured results. The host prepends UTF-8 console setup to PowerShell unless `RELAY_POWERSHELL_NO_UTF8_PREAMBLE` is set.
"#
}

#[cfg(not(windows))]
fn cdp_windows_office_catalog_addon() -> &'static str {
    ""
}

/// Prepended to every CDP prompt so the model does not confuse this session with consumer Copilot chat (no tools).
const CDP_RELAY_RUNTIME_CATALOG_LEAD: &str = r#"## CDP session: you are Relay Agent's model

- User messages are sent from the **Relay Agent** Tauri desktop app through Microsoft Edge (M365 Copilot over CDP). Your reply returns to that same Relay session.
- **Relay host execution:** Tool calls here are **not** Microsoft first-party Copilot action plugins. The Relay desktop **parses** tool-shaped JSON from your message (` ```relay_tool `, accepted ` ```json ` fences, and bounded inline fallbacks) and runs the real tools (`read_file`, `write_file`, …) under session permissions and user approvals where configured.
- **Do not** tell the user that `relay_tool` "only works in the desktop" so you cannot use it in this chat, or that you "cannot execute tools in this Copilot environment"—**that is wrong for this session.** When the task needs a tool, output the prescribed fences.
- **Do** emit fenced tool JSON when needed; **prose-only** refusals block the agent loop.
- **Action in the same turn:** If the **latest user message** already says what to do (e.g. file **paths**, verbs like improve/fix/edit/refactor, or clear targets), **output the necessary tool fences in this reply**—usually **`read_file` first** before edits. Do **not** ask the user to “provide the concrete next step” or **restate** a task they already gave.
- **No meta-only stall:** When the work clearly needs tools, do **not** answer with only protocol checklists or promises; the host needs **parsed fences** in this message.
- **Single copy of prose:** Do **not** repeat the same paragraph, checklist, or “了解しました” block multiple times in one reply. One clear statement is enough.
- **No Copilot chrome in prose:** Do **not** paste internal UI markers, search preambles, or bracketed IDs (e.g. `【richwebanswer-…】`) into the user-visible answer—omit them entirely.
- **This turn, not “next message”:** Do **not** defer all tools to a follow-up assistant message when the current turn can already run `read_file` / `write_file` / `edit_file`. If you must wait for tool output, say so **once** briefly—do not duplicate the same “next turn” plan many times.

"#;

/// Serialize built-in tool specs for the Copilot text prompt.
fn cdp_tool_catalog_section(preset: SessionPreset) -> String {
    let explore_only = preset == SessionPreset::Explore;
    let catalog: Vec<Value> = tools::mvp_tool_specs()
        .iter()
        .filter(|s| !explore_only || EXPLORE_TOOL_NAMES.contains(&s.name))
        .map(|s| {
            json!({
                "name": s.name,
                "description": s.description,
                "input_schema": s.input_schema.clone(),
            })
        })
        .collect();
    let json_pretty = serde_json::to_string_pretty(&catalog).unwrap_or_else(|_| "[]".to_string());
    let win_addon = cdp_windows_office_catalog_addon();
    let mode_note = if explore_only {
        "\n\n**Session mode:** This list is **Explore-only**—you may invoke **only** `read_file`, `glob_search`, and `grep_search`. Do not assume any other tools exist.\n"
    } else {
        ""
    };
    format!(
        r#"{lead}## Relay Agent tools

The JSON array below lists every tool you may invoke. Each entry has `name`, `description`, and `input_schema` (JSON Schema for the tool's `input` object).
{mode_note}
```json
{json_pretty}
```

## Tool invocation protocol

When you need to call one or more tools, you may write a short user-facing explanation, then append a Markdown fenced block whose **info string is exactly** `relay_tool` (three backticks, then `relay_tool`, then a newline). Inside the fence put **only** JSON — no markdown, no commentary.

- **Parsed fences run on the user's machine:** The Relay desktop executes tools **only** when it successfully parses the prescribed fences **from this reply**. Explaining JSON in prose without a fence does **not** run tools—emit a real `relay_tool` block or a normal ` ```json ` code block with the tool JSON.
- **Copilot UI:** The chat UI may label your code block as “Plain Text” or similar; still use **` ```relay_tool `** as the fence opener (or put the same JSON object inside **` ```json `**—the host accepts that too).
- **Prefer a clean fence body:** Put **only** tool JSON (object or array) inside each tool fence when you can—do not interleave Copilot UI disclaimer lines with the JSON (Relay can still extract embedded tool objects from mixed “Plain Text” blocks, but a single JSON payload is most reliable).
- **Do not defer concrete requests:** If the user already named files and an action, **call tools now** in this turn; asking them to repeat the instruction wastes a turn and blocks the agent.

- **Single tool:** one JSON object: `{{ "name": "<tool_name>", "input": {{ ... }} }}`
- **Optional:** `"id": "<string>"` — omit if unsure; the host will assign one.
- **Multiple tools:** prefer **one** `relay_tool` fence with a JSON **array** of tool objects. Use multiple fences only when unavoidable. Repeating the same tool with identical `input` across fences wastes user approvals (the host dedupes, but you should not rely on it).
- **File I/O:** use `read_file`, `write_file`, and `edit_file` for local files. Do **not** use `bash`, `PowerShell`, or `REPL` to read or write files when a file tool applies—prose Python/shell examples are not executed and encourage duplicate `relay_tool` calls. This matches the explicit, permission-gated tool model described at https://claw-code.codes/tool-system
- **Windows Office exception:** For **`.docx` / `.xlsx` / `.pptx` / `.msg`**, do **not** use `read_file` on the Office file itself. For **layout text**, you may use **`PowerShell` + COM** to write a **temporary `.pdf`**, then **`read_file` on that PDF** (LiteParse). See **Hybrid read** under the Windows desktop Office section below; put `PowerShell` and `read_file` in **one** `relay_tool` JSON **array** when both are needed in the same turn.
{win_addon}
Example:

```relay_tool
{{"name":"read_file","input":{{"path":"README.md"}}}}
```
"#,
        lead = CDP_RELAY_RUNTIME_CATALOG_LEAD,
        mode_note = mode_note,
        json_pretty = json_pretty,
        win_addon = win_addon,
    )
}

fn mvp_tool_names_whitelist() -> HashSet<String> {
    tools::mvp_tool_specs()
        .into_iter()
        .map(|s| s.name.to_string())
        .collect()
}

/// Strip `relay_tool` fences and parse tool calls. Returns `(visible_text, Vec<(id, name, input_json)>)`.
///
/// M365 Copilot often emits tool JSON in ` ```json ` or bare ` ``` ` fences instead of ` ```relay_tool `;
/// when the primary parse yields no calls, we run conservative fallbacks (whitelist MVP tool names only).
fn parse_copilot_tool_response(raw: &str) -> (String, Vec<(String, String, String)>) {
    let whitelist = mvp_tool_names_whitelist();
    let (stripped, payloads) = extract_relay_tool_fences(raw);
    let mut calls = parse_tool_payloads(&payloads);
    let mut display = stripped;
    if calls.is_empty() {
        let (d, fb_payloads) = extract_fallback_markdown_fences(&display, &whitelist);
        display = d;
        calls.extend(filter_whitelisted_tool_calls(
            parse_tool_payloads(&fb_payloads),
            &whitelist,
        ));
    }
    if calls.is_empty() {
        let (d, uf_payloads) = extract_unfenced_tool_json_candidates(&display, &whitelist);
        display = d;
        calls.extend(filter_whitelisted_tool_calls(
            parse_tool_payloads(&uf_payloads),
            &whitelist,
        ));
    }
    (display.trim().to_string(), dedupe_relay_tool_calls(calls))
}

fn filter_whitelisted_tool_calls(
    calls: Vec<(String, String, String)>,
    whitelist: &HashSet<String>,
) -> Vec<(String, String, String)> {
    calls
        .into_iter()
        .filter(|(_, name, _)| {
            if whitelist.contains(name) {
                true
            } else {
                tracing::debug!(
                    name = %name,
                    "[CdpApiClient] skipped fallback tool call: not in MVP catalog"
                );
                false
            }
        })
        .collect()
}

/// After ` ``` `, find end of inner content (index in `body` before the closing fence).
fn find_generic_markdown_fence_inner_end(body: &str) -> Option<usize> {
    if let Some(i) = body.find("\n```") {
        return Some(i);
    }
    if body.starts_with("```") {
        return Some(0);
    }
    body.rfind("```")
}

fn skip_json_whitespace(s: &str, mut i: usize) -> usize {
    let bytes = s.as_bytes();
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// True if `s[brace_idx..]` starts with `{` and the first JSON key (after whitespace) is `"name"`.
fn brace_open_followed_by_name_key(s: &str, brace_idx: usize) -> bool {
    let bytes = s.as_bytes();
    if brace_idx >= bytes.len() || bytes[brace_idx] != b'{' {
        return false;
    }
    let after = skip_json_whitespace(s, brace_idx + 1);
    s.get(after..).is_some_and(|t| t.starts_with("\"name\""))
}

/// Scan `text` for balanced `{…}` objects whose first key is `"name"` and that pass MVP tool validation.
fn extract_mvp_tool_object_spans(
    text: &str,
    whitelist: &HashSet<String>,
) -> Vec<(usize, usize, String)> {
    const MAX_OBJECT_LEN: usize = 32_768;
    const MAX_MATCHES: usize = 12;
    let mut out = Vec::new();
    let mut search_start = 0usize;

    while search_start < text.len() && out.len() < MAX_MATCHES {
        let Some(rel) = text[search_start..].find('{') else {
            break;
        };
        let abs = search_start + rel;
        if !brace_open_followed_by_name_key(text, abs) {
            search_start = abs + 1;
            continue;
        }
        let Some(sub) = extract_balanced_json_object(text, abs) else {
            search_start = abs + 1;
            continue;
        };
        if sub.len() > MAX_OBJECT_LEN {
            search_start = abs + 1;
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(sub) else {
            search_start = abs + 1;
            continue;
        };
        let Some(obj) = v.as_object() else {
            search_start = abs + 1;
            continue;
        };
        let Some(name) = obj.get("name").and_then(|x| x.as_str()) else {
            search_start = abs + 1;
            continue;
        };
        if !whitelist.contains(name) {
            search_start = abs + 1;
            continue;
        }
        if !obj.get("input").map_or(true, Value::is_object) {
            search_start = abs + 1;
            continue;
        }
        if parse_one_tool_call(&v).is_none() {
            search_start = abs + 1;
            continue;
        }
        let end = abs + sub.len();
        out.push((abs, end, sub.to_string()));
        search_start = end;
    }
    out
}

/// Strip normal Markdown code fences and return JSON bodies that may contain tool calls.
/// Skips `relay_tool` fences (payloads already taken by [`extract_relay_tool_fences`]); strips them from display.
fn extract_fallback_markdown_fences(text: &str, whitelist: &HashSet<String>) -> (String, Vec<String>) {
    const OPEN: &str = "```";
    let mut display = String::new();
    let mut payloads = Vec::new();
    let mut rest = text;

    while let Some(idx) = rest.find(OPEN) {
        display.push_str(&rest[..idx]);
        let after_ticks = &rest[idx + OPEN.len()..];

        let (info, body_start) = match after_ticks.find('\n') {
            Some(nl) => {
                let fl = after_ticks[..nl].trim();
                if fl.starts_with('{') {
                    ("", 0usize)
                } else {
                    (fl, nl + 1)
                }
            }
            None => {
                if after_ticks.starts_with('{') {
                    ("", 0usize)
                } else {
                    display.push_str(OPEN);
                    display.push_str(after_ticks);
                    rest = "";
                    break;
                }
            }
        };

        let body_region = &after_ticks[body_start..];
        let Some(inner_end) = find_generic_markdown_fence_inner_end(body_region) else {
            display.push_str(OPEN);
            display.push_str(after_ticks);
            rest = "";
            break;
        };
        let inner = body_region[..inner_end].trim();
        let after_inner = &body_region[inner_end..];
        let rest_after_fence = if let Some(tail) = after_inner.strip_prefix("\n```") {
            tail
        } else if let Some(tail) = after_inner.strip_prefix("\r\n```") {
            tail
        } else if let Some(tail) = after_inner.strip_prefix("```") {
            tail
        } else {
            display.push_str(OPEN);
            display.push_str(after_ticks);
            rest = "";
            break;
        };
        let rest_after_fence = rest_after_fence
            .strip_prefix('\n')
            .or_else(|| rest_after_fence.strip_prefix("\r\n"))
            .unwrap_or(rest_after_fence);

        if info == "relay_tool" {
            rest = rest_after_fence;
            continue;
        }

        if !inner.is_empty() {
            if serde_json::from_str::<Value>(inner).is_ok() {
                payloads.push(inner.to_string());
            } else {
                for (_, _, p) in extract_mvp_tool_object_spans(inner, whitelist) {
                    payloads.push(p);
                }
            }
        }

        rest = rest_after_fence;
    }
    display.push_str(rest);
    (display, payloads)
}

/// Pull `{"name":"…","input":{…}}` objects from prose (Copilot "Plain Text" without fences, or pretty-printed `{` + newline + `"name"`). Bounded scan.
fn extract_unfenced_tool_json_candidates(text: &str, whitelist: &HashSet<String>) -> (String, Vec<String>) {
    let spans = extract_mvp_tool_object_spans(text, whitelist);
    let mut ranges = Vec::with_capacity(spans.len());
    let mut payloads = Vec::with_capacity(spans.len());
    for (a, b, p) in spans {
        ranges.push((a, b));
        payloads.push(p);
    }

    ranges.sort_by_key(|(a, _)| *a);
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, b) in ranges {
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }

    let mut display = String::with_capacity(text.len());
    let mut cursor = 0usize;
    for (a, b) in merged {
        if a > cursor {
            display.push_str(&text[cursor..a]);
        }
        cursor = b;
    }
    display.push_str(&text[cursor..]);
    (display, payloads)
}

fn extract_balanced_json_object(s: &str, start: usize) -> Option<&str> {
    let slice = s.get(start..)?;
    if !slice.starts_with('{') {
        return None;
    }
    let mut depth = 0u32;
    let mut in_str = false;
    let mut escape = false;
    for (i, ch) in slice.char_indices() {
        if in_str {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&slice[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Recursively sort JSON object keys so equivalent objects produce one dedupe key.
fn sort_json_value_for_dedup(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for k in keys {
                if let Some(val) = map.get(&k) {
                    out.insert(k, sort_json_value_for_dedup(val.clone()));
                }
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_json_value_for_dedup).collect()),
        other => other,
    }
}

/// Clone of tool `input` used only for duplicate detection (does not change executed payloads).
fn normalize_tool_input_for_dedup_key(tool_name: &str, input: &Value) -> Value {
    let mut v = input.clone();
    if tool_name == "read_file" {
        if let Some(obj) = v.as_object_mut() {
            let merged_path = obj
                .get("path")
                .cloned()
                .or_else(|| obj.get("file_path").cloned());
            if let Some(p) = merged_path {
                obj.remove("file_path");
                obj.insert("path".to_string(), p);
            }
        }
    }
    sort_json_value_for_dedup(v)
}

/// Drop repeated tool calls that would trigger redundant approvals (same tool + same normalized input).
fn dedupe_relay_tool_calls(calls: Vec<(String, String, String)>) -> Vec<(String, String, String)> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(calls.len());
    for (id, name, input_str) in calls {
        let key = if let Ok(input_val) = serde_json::from_str::<Value>(&input_str) {
            let key_val = normalize_tool_input_for_dedup_key(&name, &input_val);
            format!(
                "{}|{}",
                name,
                serde_json::to_string(&key_val).unwrap_or_default()
            )
        } else {
            out.push((id, name, input_str));
            continue;
        };
        if seen.insert(key) {
            out.push((id, name, input_str));
        } else {
            tracing::info!(
                "[CdpApiClient] dropped duplicate relay_tool call: {name} (same normalized input)"
            );
        }
    }
    out
}

fn extract_relay_tool_fences(text: &str) -> (String, Vec<String>) {
    let mut display = String::new();
    let mut payloads = Vec::new();
    let mut rest = text;

    loop {
        if let Some(idx) = rest.find(CDP_TOOL_FENCE) {
            display.push_str(&rest[..idx]);
            rest = &rest[idx + CDP_TOOL_FENCE.len()..];
            for prefix in ["\r\n", "\n"] {
                if let Some(s) = rest.strip_prefix(prefix) {
                    rest = s;
                    break;
                }
            }
            if let Some(end_inner) = find_relay_tool_fence_end(rest) {
                let inner = rest[..end_inner].trim();
                if !inner.is_empty() {
                    payloads.push(inner.to_string());
                }
                rest = &rest[end_inner..];
                if let Some(after) = rest.strip_prefix("\r\n```") {
                    rest = after;
                } else if let Some(after) = rest.strip_prefix("\n```") {
                    rest = after;
                } else {
                    rest = rest.strip_prefix("```").unwrap_or(rest);
                }
                if let Some(s) = rest.strip_prefix("\r\n") {
                    rest = s;
                } else if let Some(s) = rest.strip_prefix('\n') {
                    rest = s;
                }
            } else {
                display.push_str(CDP_TOOL_FENCE);
                display.push_str(rest);
                break;
            }
        } else {
            display.push_str(rest);
            break;
        }
    }

    (display.trim().to_string(), payloads)
}

/// Byte offset in `rest` where inner content ends (before `\n``` ` or a trailing ` ``` `).
fn find_relay_tool_fence_end(rest: &str) -> Option<usize> {
    if let Some(idx) = rest.find("\n```") {
        return Some(idx);
    }
    rest.rfind("```")
}

fn parse_tool_payloads(payloads: &[String]) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for p in payloads {
        let v: Value = match serde_json::from_str(p) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("[CdpApiClient] skip invalid relay_tool JSON: {e}");
                continue;
            }
        };
        match v {
            Value::Array(arr) => {
                for item in arr {
                    if let Some(t) = parse_one_tool_call(&item) {
                        out.push(t);
                    }
                }
            }
            Value::Object(_) => {
                if let Some(t) = parse_one_tool_call(&v) {
                    out.push(t);
                }
            }
            _ => tracing::warn!("[CdpApiClient] relay_tool JSON must be object or array"),
        }
    }
    out
}

fn parse_one_tool_call(v: &Value) -> Option<(String, String, String)> {
    let obj = v.as_object()?;
    let name = obj.get("name")?.as_str()?.to_string();
    let id = obj
        .get("id")
        .and_then(|x| x.as_str())
        .map(String::from)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let input = obj
        .get("input")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let input_str = serde_json::to_string(&input).ok()?;
    Some((id, name, input_str))
}

/// Convert an `ApiRequest` into a human-readable text prompt for CDP.
fn build_cdp_prompt(request: &ApiRequest<'_>, preset: SessionPreset) -> String {
    let mut parts = Vec::new();

    if !request.system_prompt.is_empty() {
        parts.push(request.system_prompt.join("\n\n"));
    }

    for msg in request.messages {
        let role = match msg.role {
            runtime::MessageRole::System | runtime::MessageRole::User => "User",
            runtime::MessageRole::Assistant => "Assistant",
            runtime::MessageRole::Tool => "Tool Result",
        };

        let text: Vec<String> = msg
            .blocks
            .iter()
            .map(|b| match b {
                ContentBlock::Text { text } => text.clone(),
                ContentBlock::ToolUse { name, input, .. } => {
                    format!("[Tool Call: {name}] {input}")
                }
                ContentBlock::ToolResult {
                    output, is_error, ..
                } => {
                    if *is_error {
                        format!("[Error] {output}")
                    } else {
                        output.clone()
                    }
                }
            })
            .collect();

        parts.push(format!("{role}:\n{}", text.join("\n")));
    }

    let mut out = parts.join("\n\n");
    out.push_str("\n\n");
    out.push_str(&cdp_tool_catalog_section(preset));
    out
}

/// Persist the session state after a turn: update registry + save to disk.
fn persist_turn(
    _app: &AppHandle,
    registry: &SessionRegistry,
    runtime_session: &runtime::ConversationRuntime<CdpApiClient, TauriToolExecutor>,
    session_id: &str,
    goal: &str,
    cwd: Option<&String>,
    max_turns: usize,
    session_preset: SessionPreset,
) -> Result<(), AgentLoopError> {
    let _ignore = registry.mutate_session(session_id, |entry| {
        entry.session = runtime_session.session().clone();
    });
    copilot_persistence::save_session(
        session_id,
        runtime_session.session(),
        PersistedSessionConfig {
            goal: Some(goal.to_string()),
            cwd: cwd.cloned(),
            max_turns: Some(max_turns),
            session_preset: Some(session_preset),
        },
    )
    .map_err(|error| {
        tracing::error!("[RelayAgent] failed to persist session {session_id}: {error}");
        AgentLoopError::PersistenceError(error.to_string())
    })
}

/// Emit the `turn_complete` event with the final assistant text and message count.
fn emit_turn_complete(
    app: &AppHandle,
    session_id: &str,
    _summary: &runtime::TurnSummary,
    runtime_session: &runtime::ConversationRuntime<CdpApiClient, TauriToolExecutor>,
    cancelled: &AtomicBool,
) {
    let last_text = collect_all_assistant_text_for_ui(runtime_session.session());

    if !cancelled.load(Ordering::SeqCst) {
        if let Err(e) = app.emit(
            E_TURN_COMPLETE,
            AgentTurnCompleteEvent {
                session_id: session_id.to_string(),
                stop_reason: "end_turn".into(),
                assistant_message: last_text,
                message_count: runtime_session.session().messages.len(),
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_TURN_COMPLETE}): {e}");
        }
    }
}

/// Emit an error event to the frontend.
fn emit_error(app: &AppHandle, session_id: &str, error: &str, cancelled: bool) {
    let evt = AgentErrorEvent {
        session_id: session_id.to_string(),
        error: error.to_string(),
        cancelled,
    };
    if let Err(e) = app.emit(E_ERROR, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_ERROR}): {e}");
    }
}

/* ── Approval prompter with real channel wiring ─── */
/* Fix #3: restructured to avoid nested registry + approvals lock */

pub struct TauriApprovalPrompter {
    pub app: AppHandle,
    pub session_id: String,
    pub registry: SessionRegistry,
}

impl PermissionPrompter for TauriApprovalPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        // Step 1 — check cancelled (short, independent lock)
        let cancelled = {
            match self.registry.data.lock() {
                Ok(data) => data
                    .get(&self.session_id)
                    .is_some_and(|entry| entry.cancelled.load(Ordering::SeqCst)),
                Err(e) => {
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during permission check: {e}"
                    );
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            }
        };

        if cancelled {
            return PermissionPromptDecision::Deny {
                reason: "session was cancelled".into(),
            };
        }

        // User chose "allow for this session" for this tool earlier in the same session.
        let session_allows_tool = match self.registry.data.lock() {
            Ok(data) => data
                .get(&self.session_id)
                .and_then(|entry| {
                    entry
                        .auto_allowed_tools
                        .lock()
                        .ok()
                        .map(|set| set.contains(&request.tool_name))
                })
                .unwrap_or(false),
            Err(e) => {
                tracing::error!(
                    "[RelayAgent] registry lock poisoned during auto-allow check: {e}"
                );
                return PermissionPromptDecision::Deny {
                    reason: "registry lock poisoned".into(),
                };
            }
        };
        if session_allows_tool {
            return PermissionPromptDecision::Allow;
        }

        let approval_id = Uuid::new_v4().to_string();

        let description = human_approval_summary(&request.tool_name, &request.input);
        let target = approval_target_hint(&request.input);

        // Parse input for the event
        let input_obj = serde_json::from_str(&request.input).unwrap_or(serde_json::json!({}));

        let workspace_cwd_configured = match self.registry.data.lock() {
            Ok(data) => data
                .get(&self.session_id)
                .and_then(|e| e.workspace_cwd.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_some(),
            Err(_) => false,
        };

        if let Err(e) = self.app.emit(
            E_APPROVAL_NEEDED,
            AgentApprovalNeededEvent {
                session_id: self.session_id.clone(),
                approval_id: approval_id.clone(),
                tool_name: request.tool_name.clone(),
                description,
                target,
                input: input_obj,
                workspace_cwd_configured,
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_APPROVAL_NEEDED}): {e}");
        }

        // Create oneshot channel
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        {
            let mut data = match self.registry.data.lock() {
                Ok(d) => d,
                Err(e) => {
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during approval registration: {e}"
                    );
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            };
            if let Some(entry) = data.get_mut(&self.session_id) {
                let mut approvals = entry.approvals.lock().unwrap_or_else(|e| {
                    tracing::error!("[RelayAgent] approvals lock poisoned: {e}");
                    e.into_inner()
                });
                approvals.insert(
                    approval_id.clone(),
                    crate::registry::PendingApproval {
                        tx,
                        tool_name: request.tool_name.clone(),
                    },
                );
            }
            drop(data);
        }

        // Block until the user responds via respond_approval
        match rx.recv() {
            Ok(true) => PermissionPromptDecision::Allow,
            Ok(false) => PermissionPromptDecision::Deny {
                reason: "user rejected the tool execution".into(),
            },
            Err(_) => PermissionPromptDecision::Deny {
                reason: "approval channel was closed (session ended or was cancelled)".into(),
            },
        }
    }
}

/* ── Tool executor ─── */

/// When a session workspace (`cwd`) is set, require file-tool paths to resolve inside it
/// (claw-code PARITY-style workspace boundary).
fn enforce_workspace_tool_paths(
    tool_name: &str,
    input: &mut Value,
    workspace: &std::path::Path,
) -> Result<(), runtime::ToolError> {
    let normalize_key =
        |obj: &mut serde_json::Map<String, Value>, key: &str| -> Result<(), runtime::ToolError> {
            let Some(Value::String(s)) = obj.get(key) else {
                return Ok(());
            };
            let joined = resolve_against_workspace(s, workspace);
            let norm = lexical_normalize(joined);
            assert_path_in_workspace(&norm, workspace)
                .map_err(|e| runtime::ToolError::new(e.to_string()))?;
            obj.insert(
                key.to_string(),
                Value::String(norm.to_string_lossy().into_owned()),
            );
            Ok(())
        };

    let Some(obj) = input.as_object_mut() else {
        return Ok(());
    };

    match tool_name {
        "read_file" => {
            for key in ["path", "file_path"] {
                normalize_key(obj, key)?;
            }
        }
        "write_file" | "edit_file" => {
            normalize_key(obj, "path")?;
        }
        "glob_search" | "grep_search" | "git_status" | "git_diff" => {
            let has_path = obj
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            if !has_path {
                let root = workspace
                    .canonicalize()
                    .map_err(|e| runtime::ToolError::new(e.to_string()))?;
                obj.insert(
                    "path".to_string(),
                    Value::String(root.to_string_lossy().into_owned()),
                );
            }
            normalize_key(obj, "path")?;
        }
        "pdf_merge" => {
            normalize_key(obj, "output_path")?;
            if let Some(Value::Array(paths)) = obj.get_mut("input_paths") {
                for p in paths.iter_mut() {
                    if let Value::String(s) = p {
                        let joined = resolve_against_workspace(s, workspace);
                        let norm = lexical_normalize(joined);
                        assert_path_in_workspace(&norm, workspace)
                            .map_err(|e| runtime::ToolError::new(e.to_string()))?;
                        *p = Value::String(norm.to_string_lossy().into_owned());
                    }
                }
            }
        }
        "pdf_split" => {
            normalize_key(obj, "input_path")?;
            if let Some(Value::Array(segs)) = obj.get_mut("segments") {
                for seg in segs.iter_mut() {
                    if let Some(om) = seg.as_object_mut() {
                        normalize_key(om, "output_path")?;
                    }
                }
            }
        }
        "NotebookEdit" => {
            normalize_key(obj, "notebook_path")?;
        }
        "LSP" => {
            normalize_key(obj, "path")?;
        }
        _ => {}
    }
    Ok(())
}

pub fn build_tool_executor(
    app: &AppHandle,
    session_id: &str,
    cwd: Option<String>,
    registry: SessionRegistry,
) -> TauriToolExecutor {
    let tokio_runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime for tool executor");

    let cwd_path = cwd
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let mut mcp_manager = match ConfigLoader::default_for(&cwd_path).load() {
        Ok(cfg) => McpServerManager::from_runtime_config(&cfg),
        Err(e) => {
            tracing::warn!("[RelayAgent] merged .claw load for MCP skipped: {e}");
            McpServerManager::from_servers(&BTreeMap::new())
        }
    };

    if let Err(e) = tokio_runtime.block_on(mcp_manager.discover_tools()) {
        tracing::warn!("[RelayAgent] MCP discover_tools: {e}");
    }

    TauriToolExecutor {
        app: app.clone(),
        session_id: session_id.to_string(),
        cwd,
        registry,
        mcp_manager,
        runtime: tokio_runtime,
    }
}

pub struct TauriToolExecutor {
    app: AppHandle,
    session_id: String,
    cwd: Option<String>,
    registry: SessionRegistry,
    mcp_manager: McpServerManager,
    runtime: tokio::runtime::Runtime,
}

impl ToolExecutor for TauriToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, runtime::ToolError> {
        if let Some(r) = try_execute_mcp_meta_tool(&mut self.mcp_manager, &self.runtime, tool_name, input)
        {
            return r;
        }

        if tool_name == "AskUserQuestion" {
            return execute_ask_user_question_tool(&self.app, &self.registry, &self.session_id, input);
        }

        if tool_name == "LSP" {
            let mut input_value: Value =
                serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));
            if let Some(ref cwd) = self.cwd {
                let trimmed = cwd.trim();
                if !trimmed.is_empty() {
                    enforce_workspace_tool_paths(
                        "LSP",
                        &mut input_value,
                        std::path::Path::new(trimmed),
                    )?;
                }
            }
            let ws = self
                .cwd
                .as_ref()
                .map(|s| PathBuf::from(s.trim()))
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            let path_str = input_value
                .get("path")
                .and_then(|p| p.as_str())
                .ok_or_else(|| runtime::ToolError::new("LSP requires path".to_string()))?;
            let file = PathBuf::from(path_str);
            return pull_rust_diagnostics_blocking(&ws, &file).map_err(runtime::ToolError::new);
        }

        // Phase 1: Route MCP tool calls (prefixed with `mcp__`) to the MCP server manager
        if let Some(mcp_result) =
            try_execute_mcp_tool(&mut self.mcp_manager, &self.runtime, tool_name, input)
        {
            return mcp_result;
        }

        let tool_use_id = Uuid::new_v4().to_string();
        if let Err(e) = self.app.emit(
            E_TOOL_START,
            AgentToolStartEvent {
                session_id: self.session_id.clone(),
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.to_string(),
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_TOOL_START}): {e}");
        }

        let mut input_value: Value =
            serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));

        let _bash_config_cwd = if tool_name == "bash" {
            let root = self
                .cwd
                .as_ref()
                .map(|s| PathBuf::from(s.trim()))
                .filter(|p| !p.as_os_str().is_empty());
            Some(BashConfigCwdGuard::set(root))
        } else {
            None
        };

        // Fix #2 — prevent AI from disabling the sandbox via input JSON
        if tool_name == "bash" {
            if let Some(obj) = input_value.as_object_mut() {
                obj.remove("dangerouslyDisableSandbox");
                obj.remove("dangerously_disable_sandbox");
            }
            // Fix #4 — prepend cwd to bash commands instead of mutating process-global CWD
            if let Some(ref cwd) = self.cwd {
                if let Some(cmd) = input_value.get("command").and_then(|v| v.as_str()) {
                    let escaped = posix_shell_escape(cwd)
                        .map_err(runtime::ToolError::new)?;
                    let prefixed = format!("cd '{escaped}' && ( {cmd} )");
                    input_value["command"] = Value::String(prefixed);
                }
            }
        }

        if let Some(ref cwd) = self.cwd {
            let trimmed = cwd.trim();
            if !trimmed.is_empty() {
                enforce_workspace_tool_paths(tool_name, &mut input_value, std::path::Path::new(trimmed))?;
            }
        }

        let undo_snap = match tool_name {
            "write_file" | "edit_file" | "NotebookEdit" | "pdf_merge" | "pdf_split" => {
                session_write_undo::snapshots_before_mutation(tool_name, &input_value)
            }
            _ => None,
        };

        let result =
            tools::execute_tool(tool_name, &input_value).map_err(runtime::ToolError::new)?;

        if let Some(ops) = undo_snap {
            let _ignore = self.registry.mutate_session(&self.session_id, |entry| {
                if let Ok(mut g) = entry.write_undo.lock() {
                    g.push_mutation(ops);
                }
            });
        }

        if let Err(e) = self.app.emit(
            E_TOOL_RESULT,
            AgentToolResultEvent {
                session_id: self.session_id.clone(),
                tool_use_id,
                tool_name: tool_name.to_string(),
                content: result.clone(),
                is_error: false,
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_TOOL_RESULT}): {e}");
        }

        Ok(result)
    }
}

fn mcp_meta_server_filter(input: &Value) -> Option<&str> {
    input
        .get("server")
        .or_else(|| input.get("serverName"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn resolve_mcp_server_for_read(
    mcp_manager: &McpServerManager,
    input: &Value,
) -> Result<String, runtime::ToolError> {
    if let Some(s) = mcp_meta_server_filter(input) {
        return Ok(s.to_string());
    }
    let names = mcp_manager.stdio_server_names();
    match names.len() {
        0 => Err(runtime::ToolError::new(
            "no stdio MCP servers configured in merged .claw settings",
        )),
        1 => Ok(names[0].clone()),
        _ => Err(runtime::ToolError::new(format!(
            "ReadMcpResource requires `server` when multiple MCP servers exist ({})",
            names.len()
        ))),
    }
}

fn try_execute_mcp_meta_tool(
    mcp_manager: &mut McpServerManager,
    runtime: &tokio::runtime::Runtime,
    tool_name: &str,
    input: &str,
) -> Option<Result<String, runtime::ToolError>> {
    let v: Value = serde_json::from_str(input).unwrap_or_else(|_| json!({}));
    match tool_name {
        "ListMcpResources" => {
            let filter = mcp_meta_server_filter(&v);
            Some(
                runtime
                    .block_on(mcp_manager.list_resources_all_servers(filter))
                    .map_err(|e| runtime::ToolError::new(e.to_string()))
                    .and_then(|j| {
                        serde_json::to_string_pretty(&j)
                            .map_err(|e| runtime::ToolError::new(e.to_string()))
                    }),
            )
        }
        "ReadMcpResource" => {
            let Some(uri) = v.get("uri").and_then(|u| u.as_str()) else {
                return Some(Err(runtime::ToolError::new(
                    "ReadMcpResource requires uri",
                )));
            };
            let server = match resolve_mcp_server_for_read(mcp_manager, &v) {
                Ok(s) => s,
                Err(e) => return Some(Err(e)),
            };
            Some(
                runtime
                    .block_on(mcp_manager.read_resource_for_server(&server, uri))
                    .map_err(|e| runtime::ToolError::new(e.to_string()))
                    .and_then(|resp| {
                        if let Some(err) = resp.error {
                            return Err(runtime::ToolError::new(format!(
                                "MCP resources/read error: {} ({})",
                                err.message, err.code
                            )));
                        }
                        let Some(result) = resp.result else {
                            return Err(runtime::ToolError::new(
                                "MCP resources/read missing result",
                            ));
                        };
                        serde_json::to_string_pretty(&result)
                            .map_err(|e| runtime::ToolError::new(e.to_string()))
                    }),
            )
        }
        "McpAuth" => {
            let target = mcp_meta_server_filter(&v);
            let unsupported: Vec<Value> = mcp_manager
                .unsupported_servers()
                .iter()
                .map(|u| {
                    json!({
                        "server": u.server_name,
                        "transport": format!("{:?}", u.transport),
                        "reason": u.reason,
                    })
                })
                .collect();
            let body = json!({
                "message": "Relay does not run browser OAuth from this tool. Configure MCP servers in merged .claw (stdio command/env or remote URLs).",
                "requestedServer": target,
                "stdioServers": mcp_manager.stdio_server_names(),
                "unsupportedServers": unsupported,
            });
            Some(
                serde_json::to_string_pretty(&body)
                    .map_err(|e| runtime::ToolError::new(e.to_string())),
            )
        }
        "MCP" => {
            let action = v
                .get("action")
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .trim();
            let result = match action {
                "list_resources" => {
                    let filter = mcp_meta_server_filter(&v);
                    runtime
                        .block_on(mcp_manager.list_resources_all_servers(filter))
                        .map_err(|e| runtime::ToolError::new(e.to_string()))
                        .and_then(|j| {
                            serde_json::to_string_pretty(&j)
                                .map_err(|e| runtime::ToolError::new(e.to_string()))
                        })
                }
                "read_resource" => {
                    let Some(uri) = v.get("uri").and_then(|u| u.as_str()) else {
                        return Some(Err(runtime::ToolError::new(
                            "read_resource requires uri",
                        )));
                    };
                    let server = match resolve_mcp_server_for_read(mcp_manager, &v) {
                        Ok(s) => s,
                        Err(e) => return Some(Err(e)),
                    };
                    runtime
                        .block_on(mcp_manager.read_resource_for_server(&server, uri))
                        .map_err(|e| runtime::ToolError::new(e.to_string()))
                        .and_then(|resp| {
                            if let Some(err) = resp.error {
                                return Err(runtime::ToolError::new(format!(
                                    "resources/read: {} ({})",
                                    err.message, err.code
                                )));
                            }
                            let Some(result) = resp.result else {
                                return Err(runtime::ToolError::new(
                                    "resources/read missing result",
                                ));
                            };
                            serde_json::to_string_pretty(&result)
                                .map_err(|e| runtime::ToolError::new(e.to_string()))
                        })
                }
                "list_tools" => {
                    let mut names: Vec<String> =
                        mcp_manager.tool_index().keys().cloned().collect();
                    names.sort();
                    serde_json::to_string_pretty(&json!({ "qualifiedToolNames": names }))
                        .map_err(|e| runtime::ToolError::new(e.to_string()))
                }
                "call_tool" => {
                    let Some(qualified) = v.get("name").and_then(|n| n.as_str()) else {
                        return Some(Err(runtime::ToolError::new(
                            "call_tool requires name (qualified tool)",
                        )));
                    };
                    let args = v.get("arguments").cloned().or_else(|| v.get("input").cloned());
                    runtime
                        .block_on(mcp_manager.call_tool(qualified, args))
                        .map_err(|e| runtime::ToolError::new(e.to_string()))
                        .and_then(|resp| {
                            if let Some(err) = resp.error {
                                return Err(runtime::ToolError::new(format!(
                                    "tools/call: {} ({})",
                                    err.message, err.code
                                )));
                            }
                            let Some(result_data) = resp.result else {
                                return Err(runtime::ToolError::new(
                                    "tools/call missing result",
                                ));
                            };
                            Ok(format_mcp_tool_call_result(&result_data))
                        })
                }
                _ => Err(runtime::ToolError::new(format!(
                    "unknown MCP action `{action}` (use list_resources, read_resource, list_tools, call_tool)"
                ))),
            };
            Some(result)
        }
        _ => None,
    }
}

fn execute_ask_user_question_tool(
    app: &AppHandle,
    registry: &SessionRegistry,
    session_id: &str,
    input: &str,
) -> Result<String, runtime::ToolError> {
    let v: Value = serde_json::from_str(input).unwrap_or_else(|_| json!({}));
    let Some(qarr) = v.get("questions").and_then(|q| q.as_array()) else {
        return Err(runtime::ToolError::new(
            "AskUserQuestion requires a questions array",
        ));
    };
    if qarr.is_empty() {
        return Err(runtime::ToolError::new(
            "AskUserQuestion.questions must be non-empty",
        ));
    }
    let mut lines: Vec<String> = Vec::new();
    for (i, q) in qarr.iter().enumerate() {
        let text = q
            .get("question")
            .or_else(|| q.get("header"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        lines.push(format!("{}. {}", i + 1, text.trim()));
        if let Some(opts) = q.get("options").and_then(|o| o.as_array()) {
            for o in opts {
                let label = o.get("label").and_then(|l| l.as_str()).unwrap_or("");
                lines.push(format!("   • {label}"));
            }
        }
    }
    let prompt = lines.join("\n");
    if prompt.len() > 12_000 {
        return Err(runtime::ToolError::new(
            "AskUserQuestion prompt exceeds 12KB",
        ));
    }

    let question_id = Uuid::new_v4().to_string();
    let (tx, rx) = std::sync::mpsc::channel::<String>();

    {
        let mut data = registry
            .data
            .lock()
            .map_err(|e| runtime::ToolError::new(format!("registry lock poisoned: {e}")))?;
        let Some(entry) = data.get_mut(session_id) else {
            return Err(runtime::ToolError::new(format!(
                "session `{session_id}` not found for AskUserQuestion"
            )));
        };
        let mut qs = entry
            .user_questions
            .lock()
            .map_err(|e| runtime::ToolError::new(format!("user_questions lock poisoned: {e}")))?;
        qs.insert(
            question_id.clone(),
            crate::registry::PendingUserQuestion { tx },
        );
    }

    let evt = AgentUserQuestionNeededEvent {
        session_id: session_id.to_string(),
        question_id: question_id.clone(),
        prompt: prompt.clone(),
    };
    if let Err(e) = app.emit(E_USER_QUESTION, &evt) {
        tracing::warn!("[RelayAgent] emit failed ({E_USER_QUESTION}): {e}");
    }

    match rx.recv() {
        Ok(answer) => {
            if answer.trim().is_empty() {
                return Err(runtime::ToolError::new(
                    "user cancelled or submitted an empty answer",
                ));
            }
            serde_json::to_string_pretty(&json!({ "answer": answer }))
                .map_err(|e| runtime::ToolError::new(e.to_string()))
        }
        Err(_) => Err(runtime::ToolError::new(
            "user question channel closed",
        )),
    }
}

/// Phase 1: Attempt to execute an MCP tool call.
///
/// Returns `Some(Ok(result))` if the tool was successfully executed,
/// `Some(Err(error))` if it was an MCP tool but execution failed,
/// or `None` if the tool name doesn't match any MCP tool (fall back to built-in tools).
fn try_execute_mcp_tool(
    mcp_manager: &mut McpServerManager,
    runtime: &tokio::runtime::Runtime,
    tool_name: &str,
    input: &str,
) -> Option<Result<String, runtime::ToolError>> {
    // Check if this tool name maps to an MCP tool
    let route = mcp_manager.tool_index().get(tool_name).cloned()?;

    let input_value: serde_json::Value =
        serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));

    tracing::info!(
        "[RelayAgent] MCP tool call: {} → {} ({})",
        tool_name,
        route.server_name,
        route.raw_name
    );

    // Execute the MCP tool call via the shared async runtime
    let result: Result<runtime::JsonRpcResponse<runtime::McpToolCallResult>, runtime::ToolError> =
        runtime
            .block_on(async { mcp_manager.call_tool(tool_name, Some(input_value)).await })
            .map_err(|e| runtime::ToolError::new(e.to_string()));

    match result {
        Ok(response) => {
            if let Some(error) = response.error {
                Some(Err(runtime::ToolError::new(format!(
                    "MCP tool `{tool_name}` returned error: {} ({})",
                    error.message, error.code
                ))))
            } else if let Some(result_data) = response.result {
                let formatted = format_mcp_tool_call_result(&result_data);
                Some(Ok(formatted))
            } else {
                Some(Err(runtime::ToolError::new(format!(
                    "MCP tool `{tool_name}` returned empty response"
                ))))
            }
        }
        Err(e) => Some(Err(e)),
    }
}

/// Format MCP tool call result content into a human-readable string.
fn format_mcp_tool_call_result(result: &runtime::McpToolCallResult) -> String {
    if result.content.is_empty() && result.structured_content.is_none() {
        return String::new();
    }

    let mut parts = Vec::new();

    for content in &result.content {
        match content.kind.as_str() {
            "text" => {
                if let Some(text) = content.data.get("text").and_then(|v| v.as_str()) {
                    parts.push(text.to_string());
                }
            }
            "image" => {
                parts.push("[image content]".to_string());
            }
            "resource" => {
                if let Some(resource) = content.data.get("resource") {
                    if let Some(text) = resource.get("text").and_then(|v| v.as_str()) {
                        parts.push(text.to_string());
                    } else if let Some(uri) = resource.get("uri").and_then(|v| v.as_str()) {
                        parts.push(format!("[resource: {uri}]"));
                    }
                }
            }
            other => {
                parts.push(format!("[{other} content]"));
            }
        }
    }

    if let Some(structured) = &result.structured_content {
        if parts.is_empty() {
            parts.push(
                serde_json::to_string_pretty(structured)
                    .unwrap_or_else(|_| format!("{structured:?}")),
            );
        }
    }

    let output = parts.join("\n\n");
    if let Some(true) = result.is_error {
        format!("Error: {output}")
    } else {
        output
    }
}

/* ── Helpers ─── */

pub fn msg_to_relay(msg: &ConversationMessage) -> RelayMessage {
    let content = msg
        .blocks
        .iter()
        .map(|block| match block {
            ContentBlock::Text { text } => MessageContent::Text { text: text.clone() },
            ContentBlock::ToolUse { id, name, input } => MessageContent::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({})),
            },
            ContentBlock::ToolResult {
                tool_use_id,
                output,
                is_error,
                ..
            } => MessageContent::ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: output.clone(),
                is_error: *is_error,
            },
        })
        .collect();

    let role = match msg.role {
        runtime::MessageRole::User | runtime::MessageRole::Tool => "user".to_string(),
        runtime::MessageRole::Assistant => "assistant".to_string(),
        runtime::MessageRole::System => "system".to_string(),
    };

    RelayMessage { role, content }
}

#[cfg(windows)]
fn windows_desktop_office_system_prompt_addon() -> &'static str {
    r#"## Windows: desktop Office and .msg (PowerShell + COM)

Use the **PowerShell** tool for **Word, Excel, PowerPoint**, and **`.msg`** (via `Outlook.Application` when Outlook is installed). Prefer COM for those formats over `read_file`/`write_file`/`edit_file` unless the user provided plain text or CSV.

**Hybrid read (data + layout):** For **`.xlsx`/`.docx`/`.pptx`**, combine (a) **COM batch extraction** (`Range.Value2` → JSON, or `Export-Csv`) as the **numeric/table source of truth** for Excel, with (b) **COM `ExportAsFixedFormat`** to a **unique file under `%TEMP%\RelayAgent\office-layout\`**, then **`read_file` on that `.pdf`** in the **same** turn (same `relay_tool` JSON **array**: `PowerShell` then `read_file`). PowerShell stdout should be **one JSON** including **`pdfPath`**. PDF/LiteParse text is **layout hints** for Excel, not authoritative numbers. Use `OpenAfterPublish`/`OpenAfterExport` `$false`; `Quit()` in `finally`. Optional: `Remove-Item` temp files after.

**Speed:** Copilot turns are slow—prefer **one PowerShell `command`** that does open → work → save → `Quit()` instead of splitting across many tool calls in one turn.

**Excel:** Do **not** use per-cell COM loops. Assign **2D arrays** to `Range.Value2`, use block ranges or CSV import, etc. Use `$excel.ScreenUpdating = $false` with `try`/`finally` to restore.

**Word / PowerPoint:** Batch edits (e.g. Find/Replace, range operations); avoid unnecessary `Select`/`Activate`.

**.msg:** May fail if Trust Center blocks automation; ask the user to change policy or export if needed.

Return structured output with **`ConvertTo-Json -Compress`** on stdout when helpful. The host prepends UTF-8 console setup (`chcp 65001`, output encodings) unless `RELAY_POWERSHELL_NO_UTF8_PREAMBLE` is set.
"#
}

/// System prompt sections for the desktop agent loop: Relay identity, Claw-style discipline
/// blocks, goal/constraints, and optional workspace context when `cwd` is set.
pub fn build_desktop_system_prompt(
    goal: &str,
    cwd: Option<&str>,
    session_preset: SessionPreset,
) -> Vec<String> {
    if let Some(path) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .map(|home| home.join(".relay-agent").join("SYSTEM_PROMPT.md"))
    {
        if let Ok(contents) = std::fs::read_to_string(path) {
            let custom = contents.trim();
            if !custom.is_empty() {
                let mut block = if custom.contains("{goal}") {
                    custom.replace("{goal}", goal)
                } else {
                    format!("{custom}\n\nGoal:\n{goal}")
                };
                if let Some(addon) = session_preset_system_addon(session_preset) {
                    block.push_str("\n\n");
                    block.push_str(addon);
                }
                return vec![block];
            }
        }
    }

    let mut sections = Vec::new();
    sections.push(
        concat!(
            "You are Relay Agent running inside a Tauri desktop app.\n",
            "Use only the registered tools.\n",
            "Read state first, then write only when necessary.\n",
            "For file access use read_file / write_file / edit_file; for PDF merge or split in the workspace use pdf_merge / pdf_split (not bash). Do not substitute shell or REPL for file I/O when those tools apply.\n\n",
            "When the model is M365 Copilot in Edge (CDP), the appended message includes the tool catalog and `relay_tool` protocol. ",
            "Do not refuse to output fenced tool JSON by claiming browser Copilot cannot run tools—Relay executes parsed tool calls from your reply.\n\n",
            "IMPORTANT: Do not generate or guess URLs unless they clearly help with the user's programming task. ",
            "You may use URLs the user provided or that appear in local files.",
        )
        .to_string(),
    );
    if let Some(addon) = session_preset_system_addon(session_preset) {
        sections.push(addon.to_string());
    }
    sections.extend(runtime::claw_style_discipline_sections());
    #[cfg(windows)]
    sections.push(windows_desktop_office_system_prompt_addon().to_string());
    sections.push(format!(
        concat!(
            "Goal:\n{goal}\n\n",
            "Constraints:\n",
            "- Prefer read-only tools before mutating tools.\n",
            "- When modifying files, prefer saving copies.\n",
            "- Local files: read_file, glob_search, and grep_search accept absolute paths on this machine (e.g. Windows C:\\Users\\...\\file.pdf) wherever the OS user can read them. Do not tell the user the app lacks permission to their user profile; call read_file and surface the tool's error if access fails.\n",
            "- read_file returns UTF-8 text. `.pdf` files are parsed via LiteParse (spatial text, OCR off). Other binary types are not decoded; if the tool errors or output is unusable, ask for extracted text or a converted .txt/.md file.\n",
            "- If the user's request is already concrete (paths, files, stated action), use tools in your **first** response; do not ask them to rephrase unless something essential is missing (no path, no goal, or true ambiguity).\n",
            "- To combine or split PDF files, use pdf_merge / pdf_split (workspace write); do not use bash for that."
        ),
        goal = goal,
    ));

    if let Some(cwd) = cwd {
        if !cwd.is_empty() {
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();
            let path = std::path::PathBuf::from(cwd);
            if let Ok(ctx) = runtime::ProjectContext::discover_with_git(path, date) {
                sections.push(runtime::render_project_context(&ctx));
                if !ctx.instruction_files.is_empty() {
                    sections.push(runtime::render_instruction_files(&ctx.instruction_files));
                }
            }
        }
    }

    sections
}

/* ── Event types ─── */

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStartEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResultEvent {
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserQuestionNeededEvent {
    pub session_id: String,
    pub question_id: String,
    /// Plain text prompt (questions and optional option labels).
    pub prompt: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalNeededEvent {
    pub session_id: String,
    pub approval_id: String,
    pub tool_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub input: serde_json::Value,
    /// True when the session was started with a non-empty workspace `cwd` (enables "allow for workspace").
    pub workspace_cwd_configured: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnCompleteEvent {
    pub session_id: String,
    pub stop_reason: String,
    pub assistant_message: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorEvent {
    pub session_id: String,
    pub error: String,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTextDeltaEvent {
    pub session_id: String,
    pub text: String,
    pub is_complete: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayMessage {
    pub role: String,
    pub content: Vec<MessageContent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageContent {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHistoryResponse {
    pub session_id: String,
    pub running: bool,
    pub messages: Vec<RelayMessage>,
}

#[cfg(test)]
mod cdp_copilot_tool_tests {
    use super::*;
    use crate::models::SessionPreset;

    #[test]
    fn catalog_lists_builtin_tools_and_protocol() {
        let s = cdp_tool_catalog_section(SessionPreset::Build);
        assert!(s.contains("read_file"));
        assert!(s.contains("relay_tool"));
        assert!(s.contains("input_schema"));
        assert!(s.contains("CDP session: you are Relay Agent"));
        assert!(s.contains("Relay host execution"));
        assert!(s.contains("wrong for this session"));
        assert!(s.contains("Parsed fences run on the user's machine"));
        assert!(s.contains("Copilot UI"));
        assert!(s.contains("Action in the same turn"));
        assert!(s.contains("No meta-only stall"));
        assert!(s.contains("Do not defer concrete requests"));
        assert!(s.contains("Prefer a clean fence body"));
        assert!(s.contains("Single copy of prose"));
        assert!(s.contains("No Copilot chrome in prose"));
    }

    #[test]
    fn sanitize_strips_richwebanswer_markers() {
        let raw = "Hello 【richwebanswer-ac461e】 world";
        let s = sanitize_copilot_visible_text(raw);
        assert!(!s.to_lowercase().contains("richwebanswer"));
        assert!(s.contains("Hello"));
        assert!(s.contains("world"));
    }

    #[test]
    fn sanitize_dedupes_consecutive_paragraphs() {
        let raw = "A\n\nB\n\nB\n\nB\n\nC";
        let s = sanitize_copilot_visible_text(raw);
        assert_eq!(s, "A\n\nB\n\nC");
    }

    #[test]
    fn normalize_cdp_prompt_replaces_typographic_punctuation() {
        let s = normalize_prompt_for_cdp_file_attachment(
            "a — b – c → d ← e … f ‘g’ “h”\u{00A0}i",
        );
        assert!(s.contains(" - "));
        assert!(!s.contains('—'));
        assert!(!s.contains('–'));
        assert!(s.contains("->"));
        assert!(s.contains("<-"));
        assert!(s.contains("..."));
        assert!(s.contains("'g'"));
        assert!(s.contains("\"h\""));
        assert!(s.contains(" i"));
    }

    #[test]
    fn write_utf8_file_with_bom_starts_with_ef_bb_bf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("relay-cdp-prompt-test.txt");
        write_utf8_file_with_bom(&path, "テスト").expect("write");
        let raw = std::fs::read(&path).expect("read");
        assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(std::str::from_utf8(&raw[3..]).expect("utf8"), "テスト");
    }

    #[test]
    fn explore_catalog_lists_only_workspace_read_tools() {
        let s = cdp_tool_catalog_section(SessionPreset::Explore);
        assert!(s.contains("read_file"));
        assert!(s.contains("glob_search"));
        assert!(s.contains("grep_search"));
        assert!(s.contains("Explore-only"));
        assert!(!s.contains("\"name\": \"write_file\""));
        assert!(!s.contains("\"name\": \"bash\""));
    }

    #[cfg(windows)]
    #[test]
    fn catalog_includes_windows_office_powershell_guidance() {
        let s = cdp_tool_catalog_section(SessionPreset::Build);
        assert!(s.contains("Windows desktop Office"));
        assert!(s.contains("PowerShell"));
        assert!(s.contains("Range.Value2"));
        assert!(s.contains("Hybrid read"));
        assert!(s.contains("pdfPath"));
    }

    #[test]
    fn parse_plain_text_no_tools() {
        let (vis, tools) = parse_copilot_tool_response("Hello, no tools here.");
        assert_eq!(vis, "Hello, no tools here.");
        assert!(tools.is_empty());
    }

    #[test]
    fn fallback_json_fence_read_file() {
        let raw = r#"了解。read-only で確認します。

```json
{"name":"read_file","input":{"path":"C:\\Users\\x\\Downloads\\テトリス.html"}}
```
"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
        assert!(tools[0].2.contains("テトリス.html"));
        assert!(!vis.contains("read_file"));
        assert!(!vis.contains("```json"));
    }

    #[test]
    fn fallback_plain_triple_backtick_fence() {
        let raw = r#"x
```
{"name":"glob_search","input":{"pattern":"*.toml"}}
```
y"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "glob_search");
        assert!(vis.contains('x'));
        assert!(vis.contains('y'));
    }

    #[test]
    fn fallback_after_invalid_relay_fence() {
        let raw = r#"Text
```relay_tool
not json
```
```json
{"name":"read_file","input":{"path":"C:\\a.html"}}
```
Tail"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
        assert!(vis.contains("Text"));
        assert!(vis.contains("Tail"));
    }

    #[test]
    fn fallback_drops_unknown_tool_name() {
        let raw = r#"```json
{"name":"relay_absurd_tool_name_zz","input":{}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert!(tools.is_empty());
    }

    #[test]
    fn fallback_duplicate_json_fences_deduped() {
        let raw = r#"```json
{"name":"read_file","input":{"path":"same.txt"}}
```
```json
{"name":"read_file","input":{"path":"same.txt"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
    }

    #[test]
    fn unfenced_tool_json_in_prose() {
        let raw = "了解。\n\n{\"name\":\"read_file\",\"input\":{\"path\":\"C:\\\\x\\\\y.txt\"}}\n";
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
        assert!(!vis.contains("read_file"));
    }

    #[test]
    fn unfenced_pretty_printed_read_file() {
        let raw = r#"了解。

{
  "name": "read_file",
  "input": {
    "path": "C:\\Users\\x\\Downloads\\テトリス.html"
  }
}
"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
        assert!(tools[0].2.contains("テトリス.html"));
        assert!(!vis.contains("\"name\""));
    }

    #[test]
    fn fallback_plain_text_labeled_fence_mixed_inner() {
        let raw = r#"了解。以下で読みます。

```Plain Text
relay_tool は完全にはサポートされていません。
{
  "name": "read_file",
  "input": {
    "path": "C:\\Users\\m242054\\Downloads\\テトリス.html"
  }
}
```

次に編集します。"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
        assert!(tools[0].2.contains("テトリス.html"));
        assert!(vis.contains("了解"));
        assert!(vis.contains("次に編集"));
        assert!(!vis.contains("```Plain Text"));
    }

    #[test]
    fn fallback_text_fence_mixed_inner() {
        let raw = r#"pre
```text
Note line.
{
  "name": "glob_search",
  "input": { "pattern": "*.rs" }
}
```
post"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "glob_search");
        assert!(vis.contains("pre"));
        assert!(vis.contains("post"));
    }

    #[test]
    fn parse_single_object_fence() {
        let raw = r#"Done.

```relay_tool
{"name":"glob_search","input":{"pattern":"*.rs"}}
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.contains("Done."));
        assert!(!vis.contains("relay_tool"));
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "glob_search");
        assert!(tools[0].2.contains("*.rs"));
    }

    #[test]
    fn parse_array_inside_one_fence() {
        let raw = r#"```relay_tool
[{"name":"read_file","input":{"path":"a.txt"}},{"name":"read_file","input":{"path":"b.txt"}}]
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].1, "read_file");
        assert_eq!(tools[1].1, "read_file");
    }

    #[test]
    fn parse_two_fences() {
        let raw = r#"```relay_tool
{"name":"read_file","input":{"path":"x"}}
```
```relay_tool
{"name":"read_file","input":{"path":"y"}}
```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn parse_preserves_explicit_id() {
        let raw = r#"```relay_tool
{"id":"my-id","name":"read_file","input":{"path":"p"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].0, "my-id");
    }

    #[test]
    fn parse_invalid_json_skipped_but_fence_stripped() {
        let raw = "Text\n```relay_tool\nnot json\n```\nTail";
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.contains("Text"));
        assert!(vis.contains("Tail"));
        assert!(!vis.contains("not json"));
        assert!(tools.is_empty());
    }

    #[test]
    fn closing_fence_without_leading_newline() {
        let raw = r#"```relay_tool
{"name":"read_file","input":{"path":"z"}}```"#;
        let (vis, tools) = parse_copilot_tool_response(raw);
        assert!(vis.is_empty());
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "read_file");
    }

    #[test]
    fn parse_dedupes_repeated_write_file_fences() {
        let raw = r#"```relay_tool
{"name":"write_file","input":{"path":"C:\\a.txt","content":"x"}}
```
```relay_tool
{"name":"write_file","input":{"path":"C:\\a.txt","content":"x"}}
```
```relay_tool
{"name":"write_file","input":{"path":"C:\\a.txt","content":"x"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].1, "write_file");
    }

    #[test]
    fn parse_keeps_distinct_write_file_content() {
        let raw = r#"```relay_tool
{"name":"write_file","input":{"path":"p","content":"a"}}
```
```relay_tool
{"name":"write_file","input":{"path":"p","content":"b"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn parse_dedupes_read_file_path_aliases() {
        let raw = r#"```relay_tool
{"name":"read_file","input":{"path":"README.md"}}
```
```relay_tool
{"name":"read_file","input":{"file_path":"README.md"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
    }

    #[test]
    fn parse_dedupes_duplicate_tools_inside_one_array_fence() {
        let raw = r#"```relay_tool
[{"name":"read_file","input":{"path":"a.txt"}},{"name":"read_file","input":{"path":"a.txt"}}]
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
    }

    #[test]
    fn parse_dedupes_identical_calls_key_order_differs() {
        let raw = r#"```relay_tool
{"name":"write_file","input":{"content":"z","path":"p"}}
```
```relay_tool
{"name":"write_file","input":{"path":"p","content":"z"}}
```"#;
        let (_vis, tools) = parse_copilot_tool_response(raw);
        assert_eq!(tools.len(), 1);
    }
}

#[cfg(test)]
mod desktop_permission_tests {
    use super::{desktop_permission_policy, SessionPreset};
    use runtime::{
        PermissionOutcome, PermissionPromptDecision, PermissionPrompter, PermissionRequest,
    };

    struct AllowPrompter;

    impl PermissionPrompter for AllowPrompter {
        fn decide(&mut self, _request: &PermissionRequest) -> PermissionPromptDecision {
            PermissionPromptDecision::Allow
        }
    }

    #[test]
    fn allows_read_tools_without_prompt() {
        let p = desktop_permission_policy(SessionPreset::Build);
        assert_eq!(
            p.authorize("read_file", r#"{"path":"a.txt"}"#, None),
            PermissionOutcome::Allow
        );
        assert_eq!(
            p.authorize("glob_search", r#"{"pattern":"*.rs"}"#, None),
            PermissionOutcome::Allow
        );
    }

    #[test]
    fn write_requires_prompter_or_denies() {
        let p = desktop_permission_policy(SessionPreset::Build);
        let out = p.authorize("write_file", r#"{"path":"x","content":"y"}"#, None);
        assert!(matches!(out, PermissionOutcome::Deny { .. }));

        let mut pr = AllowPrompter;
        let out2 = p.authorize("write_file", r#"{"path":"x","content":"y"}"#, Some(&mut pr));
        assert_eq!(out2, PermissionOutcome::Allow);
    }

    #[test]
    fn bash_prompts_until_allowed() {
        let p = desktop_permission_policy(SessionPreset::Build);
        assert!(matches!(
            p.authorize("bash", r#"{"command":"echo hi"}"#, None),
            PermissionOutcome::Deny { .. }
        ));
        let mut pr = AllowPrompter;
        assert_eq!(
            p.authorize("bash", r#"{"command":"echo hi"}"#, Some(&mut pr)),
            PermissionOutcome::Allow
        );
    }

    #[test]
    fn plan_preset_denies_writes_even_with_prompter() {
        let p = desktop_permission_policy(SessionPreset::Plan);
        let mut pr = AllowPrompter;
        let out = p.authorize("write_file", r#"{"path":"x","content":"y"}"#, Some(&mut pr));
        assert!(matches!(out, PermissionOutcome::Deny { reason } if reason.contains("read-only")));
    }

    #[test]
    fn explore_preset_denies_web_even_though_readonly_spec() {
        let p = desktop_permission_policy(SessionPreset::Explore);
        assert_eq!(
            p.authorize("read_file", r#"{"path":"a.txt"}"#, None),
            PermissionOutcome::Allow
        );
        let mut pr = AllowPrompter;
        let out = p.authorize(
            "WebFetch",
            r#"{"url":"https://example.com","prompt":"x"}"#,
            Some(&mut pr),
        );
        assert!(matches!(out, PermissionOutcome::Deny { .. }));
    }
}
