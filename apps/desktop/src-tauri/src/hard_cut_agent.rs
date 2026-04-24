use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::OwnedSemaphorePermit;
use uuid::Uuid;

use crate::agent_projection::{
    AgentErrorEvent, AgentSessionStatusEvent, AgentTextDeltaEvent, AgentToolResultEvent,
    AgentToolStartEvent, AgentTurnCompleteEvent, E_ERROR, E_STATUS, E_TEXT_DELTA, E_TOOL_RESULT,
    E_TOOL_START, E_TURN_COMPLETE,
};
use crate::app_services::AppServices;
use crate::copilot_persistence::{self, PersistedSessionConfig};
use crate::models::{ContinueAgentSessionRequest, StartAgentRequest};
use crate::registry::{SessionHandle, SessionRegistry, SessionState};

const FIXTURE_REPLY_ENV: &str = "RELAY_HARD_CUT_COPILOT_REPLY";
const FIXTURE_FINAL_REPLY_ENV: &str = "RELAY_HARD_CUT_COPILOT_FINAL_REPLY";

pub async fn start_agent<R: Runtime>(
    app: AppHandle<R>,
    services: State<'_, AppServices>,
    request: StartAgentRequest,
) -> Result<String, String> {
    let goal = request.goal.trim().to_string();
    if goal.is_empty() {
        return Err("goal must not be empty".to_string());
    }
    let session_id = format!("session-{}", Uuid::new_v4());
    let cwd = normalize_optional_string(request.cwd.as_deref());
    let opencode_session_id =
        crate::opencode_runtime::create_session(cwd.as_deref(), Some(&goal)).await?;
    crate::opencode_runtime::append_text_message(&opencode_session_id, "user", &goal, None).await?;
    let config = PersistedSessionConfig {
        goal: Some(goal.clone()),
        cwd,
        max_turns: request.max_turns,
        browser_settings: request.browser_settings.clone(),
        opencode_session_id: Some(opencode_session_id),
    };
    let handle = SessionHandle::new(SessionState::new(config.clone()), HashSet::new());
    services
        .registry()
        .insert(session_id.clone(), handle)
        .map_err(|error| error.to_string())?;

    spawn_turn(
        app,
        services,
        session_id.clone(),
        goal,
        config,
        request.browser_settings,
        true,
    )
    .await?;
    Ok(session_id)
}

pub async fn continue_agent_session<R: Runtime>(
    app: AppHandle<R>,
    services: State<'_, AppServices>,
    request: ContinueAgentSessionRequest,
) -> Result<String, String> {
    let message = request.message.trim().to_string();
    if message.is_empty() {
        return Err("message must not be empty".to_string());
    }
    let registry = services.registry();
    let config = ensure_continuable_session(&registry, &request.session_id)?;
    let opencode_session_id = config
        .opencode_session_id
        .as_deref()
        .ok_or_else(|| format!("session `{}` is not linked to OpenCode", request.session_id))?;
    crate::opencode_runtime::append_text_message(opencode_session_id, "user", &message, None)
        .await?;
    registry
        .mutate_session(&request.session_id, |state| {
            state.running = true;
            state.run_state = crate::registry::SessionRunState::Running;
            state
                .cancelled
                .store(false, std::sync::atomic::Ordering::SeqCst);
            state.finished_at = None;
        })
        .map_err(|error| error.to_string())?;

    spawn_turn(
        app,
        services,
        request.session_id.clone(),
        message,
        config.clone(),
        config.browser_settings.clone(),
        false,
    )
    .await?;
    Ok(request.session_id)
}

fn ensure_continuable_session(
    registry: &SessionRegistry,
    session_id: &str,
) -> Result<PersistedSessionConfig, String> {
    if let Some(config) = registry
        .get_session(session_id, |state| state.session_config.clone())
        .map_err(|error| error.to_string())?
    {
        if config
            .opencode_session_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Ok(config);
        }
        return Err(format!("session `{session_id}` is not linked to OpenCode"));
    }

    let loaded = copilot_persistence::load_session(session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("session `{session_id}` not found"))?;
    let config = loaded.config;
    if config
        .opencode_session_id
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err(format!("session `{session_id}` is not linked to OpenCode"));
    }

    registry
        .insert(
            session_id.to_string(),
            SessionHandle::new(SessionState::new(config.clone()), HashSet::new()),
        )
        .map_err(|error| error.to_string())?;
    Ok(config)
}

async fn spawn_turn<R: Runtime>(
    app: AppHandle<R>,
    services: State<'_, AppServices>,
    session_id: String,
    user_text: String,
    config: PersistedSessionConfig,
    browser_settings: Option<crate::models::BrowserAutomationSettings>,
    fresh_session: bool,
) -> Result<(), String> {
    let permit = services
        .agent_semaphore()
        .acquire_owned()
        .await
        .map_err(|error| format!("agent semaphore closed: {error}"))?;
    let registry = services.registry();
    let bridge = services.copilot_bridge();
    let app_for_task = app.clone();
    tokio::spawn(async move {
        let result = run_turn(
            app_for_task.clone(),
            registry.clone(),
            bridge,
            session_id.clone(),
            user_text,
            config,
            browser_settings,
            fresh_session,
            permit,
        )
        .await;
        if let Err(error) = result {
            emit_error(&app_for_task, &session_id, &error);
            let _ignore = registry.mutate_session(&session_id, |state| {
                state.last_error_summary = Some(error);
                state.mark_finished();
            });
        }
    });
    Ok(())
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn run_turn<R: Runtime>(
    app: AppHandle<R>,
    registry: SessionRegistry,
    bridge: Arc<crate::app_services::CopilotBridgeManager>,
    session_id: String,
    user_text: String,
    config: PersistedSessionConfig,
    browser_settings: Option<crate::models::BrowserAutomationSettings>,
    fresh_session: bool,
    _permit: OwnedSemaphorePermit,
) -> Result<(), String> {
    let opencode_session_id = config
        .opencode_session_id
        .clone()
        .ok_or_else(|| format!("session `{session_id}` is not linked to OpenCode"))?;
    emit_status(&app, &session_id, "running", Some("Asking Copilot"));
    let prompt = build_initial_prompt(&user_text, config.cwd.as_deref());
    let first_reply = copilot_reply(
        bridge.clone(),
        registry.clone(),
        session_id.clone(),
        browser_settings.clone(),
        prompt,
        fresh_session,
        std::env::var(FIXTURE_REPLY_ENV).ok(),
    )
    .await?;
    let (visible_text, calls) = desktop_core::copilot_adapter::parse_copilot_tool_response(
        &first_reply,
        desktop_core::copilot_adapter::CdpToolParseMode::Initial,
    );
    if !visible_text.trim().is_empty() {
        emit_text(&app, &session_id, &visible_text, true);
        let finish = if calls.is_empty() { Some("stop") } else { None };
        crate::opencode_runtime::append_text_message(
            &opencode_session_id,
            "assistant",
            &visible_text,
            finish,
        )
        .await?;
    }

    if calls.is_empty() {
        finish_session(&app, &registry, &session_id, "completed", &visible_text)?;
        return Ok(());
    }

    let mut tool_summaries = Vec::new();
    for (tool_use_id, tool_name, input_json) in calls {
        let input_value: Value = serde_json::from_str(&input_json)
            .map_err(|error| format!("invalid `{tool_name}` input from Copilot: {error}"))?;
        emit_tool_start(
            &app,
            &session_id,
            &tool_use_id,
            &tool_name,
            input_value.clone(),
        );
        let tool_context = crate::opencode_runtime::OpencodeToolExecutionContext {
            cwd: config.cwd.clone(),
            worktree: config.cwd.clone(),
            session_id: Some(opencode_session_id.clone()),
            message_id: None,
            agent: None,
        };
        let tool_name_for_execution = tool_name.clone();
        let input_for_execution = input_value.clone();
        let result = tokio::task::spawn_blocking(move || {
            crate::opencode_runtime::execute_tool_with_context(
                &tool_name_for_execution,
                &input_for_execution,
                &tool_context,
            )
        })
        .await
        .map_err(|error| format!("OpenCode tool task failed for `{tool_name}`: {error}"))?;
        let (tool_output, is_error) = match result {
            Ok(output) => (output, false),
            Err(error) => (error, true),
        };
        emit_tool_result(
            &app,
            &session_id,
            &tool_use_id,
            &tool_name,
            &tool_output,
            is_error,
        );
        crate::opencode_runtime::append_tool_result_message(
            &opencode_session_id,
            &tool_use_id,
            &tool_name,
            input_value,
            &tool_output,
            is_error,
        )
        .await?;
        tool_summaries.push(format!(
            "tool={tool_name}\nid={tool_use_id}\nis_error={is_error}\noutput:\n{tool_output}"
        ));
    }

    emit_status(
        &app,
        &session_id,
        "running",
        Some("Asking Copilot to summarize results"),
    );
    let final_prompt = build_final_prompt(&user_text, &tool_summaries);
    let final_reply = copilot_reply(
        bridge,
        registry.clone(),
        session_id.clone(),
        browser_settings,
        final_prompt,
        false,
        std::env::var(FIXTURE_FINAL_REPLY_ENV).ok(),
    )
    .await?;
    let (final_visible, _ignored_calls) =
        desktop_core::copilot_adapter::parse_copilot_tool_response(
            &final_reply,
            desktop_core::copilot_adapter::CdpToolParseMode::Initial,
        );
    let final_text = if final_visible.trim().is_empty() {
        final_reply
    } else {
        final_visible
    };
    emit_text(&app, &session_id, &final_text, true);
    crate::opencode_runtime::append_text_message(
        &opencode_session_id,
        "assistant",
        &final_text,
        Some("stop"),
    )
    .await?;
    finish_session(&app, &registry, &session_id, "completed", &final_text)?;
    Ok(())
}

async fn copilot_reply(
    bridge: Arc<crate::app_services::CopilotBridgeManager>,
    registry: SessionRegistry,
    session_id: String,
    browser_settings: Option<crate::models::BrowserAutomationSettings>,
    prompt: String,
    new_chat: bool,
    fixture: Option<String>,
) -> Result<String, String> {
    if let Some(fixture) = fixture {
        return Ok(fixture);
    }
    tokio::task::spawn_blocking(move || {
        let cdp = crate::tauri_bridge::effective_cdp_port(browser_settings.as_ref());
        let server =
            crate::tauri_bridge::ensure_copilot_server(cdp, true, bridge, Some(&registry))?;
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("copilot hard-cut runtime: {error}"))?;
        let mut guard = server
            .lock()
            .map_err(|error| format!("copilot server mutex poisoned: {error}"))?;
        let request_id = format!("hard-cut-{}", Uuid::new_v4());
        rt.block_on(
            guard.send_prompt(crate::copilot_server::CopilotSendPromptRequest {
                relay_session_id: &session_id,
                relay_request_id: &request_id,
                relay_request_chain: &request_id,
                relay_request_attempt: 1,
                relay_stage_label: "hard_cut",
                relay_probe_mode: false,
                relay_force_fresh_chat: false,
                system_prompt: "",
                user_prompt: &prompt,
                timeout_secs: 300,
                attachment_paths: &[],
                new_chat,
            }),
        )
        .map_err(|error| format!("Copilot request failed: {error}"))
    })
    .await
    .map_err(|error| format!("copilot hard-cut task failed: {error}"))?
}

fn build_initial_prompt(user_text: &str, cwd: Option<&str>) -> String {
    format!(
        r#"You are controlling Relay through OpenCode/OpenWork tools.

Return either a final answer in prose or exactly one JSON tool request.
Use this shape when a tool is needed:

```relay_tool
{{"name":"read","relay_tool_call":true,"input":{{"filePath":"README.md"}}}}
```

Available tools:
- read: read an exact file path. Input: {{"filePath":"relative/or/absolute/path"}}
- glob: discover paths. Input: {{"pattern":"**/*.rs","path":"."}}
- grep: search plaintext/code. Input: {{"pattern":"text","path":"."}}

Workspace: {cwd}
User request:
{user_text}
"#,
        cwd = cwd.unwrap_or("(not set)")
    )
}

fn build_final_prompt(user_text: &str, tool_summaries: &[String]) -> String {
    format!(
        "Use the OpenCode/OpenWork tool results below as the only execution evidence.\n\nUser request:\n{user_text}\n\nTool results:\n{}\n\nReturn the final answer. Do not request another tool in this message.",
        tool_summaries.join("\n\n---\n\n")
    )
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn finish_session<R: Runtime>(
    app: &AppHandle<R>,
    registry: &SessionRegistry,
    session_id: &str,
    stop_reason: &str,
    assistant_message: &str,
) -> Result<(), String> {
    let config = registry
        .mutate_session(session_id, |state| {
            state.last_stop_reason = Some(stop_reason.to_string());
            state.mark_finished();
            state.session_config.clone()
        })
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("session `{session_id}` not found"))?;
    let _ = copilot_persistence::save_session(session_id, config);
    let _ = app.emit(
        E_TURN_COMPLETE,
        AgentTurnCompleteEvent {
            session_id: session_id.to_string(),
            stop_reason: stop_reason.to_string(),
            assistant_message: assistant_message.to_string(),
            message_count: 0,
        },
    );
    emit_status(app, session_id, "idle", Some("Completed"));
    Ok(())
}

fn emit_status<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    phase: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        E_STATUS,
        AgentSessionStatusEvent {
            session_id: session_id.to_string(),
            phase: phase.to_string(),
            attempt: None,
            message: message.map(ToString::to_string),
            next_retry_at_ms: None,
            tool_name: None,
            stop_reason: None,
        },
    );
}

fn emit_text<R: Runtime>(app: &AppHandle<R>, session_id: &str, text: &str, complete: bool) {
    let _ = app.emit(
        E_TEXT_DELTA,
        AgentTextDeltaEvent {
            session_id: session_id.to_string(),
            text: text.to_string(),
            is_complete: complete,
            replace_existing: false,
        },
    );
}

fn emit_tool_start<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    tool_use_id: &str,
    tool_name: &str,
    input: Value,
) {
    let _ = app.emit(
        E_TOOL_START,
        AgentToolStartEvent {
            session_id: session_id.to_string(),
            tool_use_id: tool_use_id.to_string(),
            tool_name: tool_name.to_string(),
            input,
        },
    );
}

fn emit_tool_result<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    tool_use_id: &str,
    tool_name: &str,
    content: &str,
    is_error: bool,
) {
    let _ = app.emit(
        E_TOOL_RESULT,
        AgentToolResultEvent {
            session_id: session_id.to_string(),
            tool_use_id: tool_use_id.to_string(),
            tool_name: tool_name.to_string(),
            content: content.to_string(),
            is_error,
        },
    );
}

fn emit_error<R: Runtime>(app: &AppHandle<R>, session_id: &str, error: &str) {
    let _ = app.emit(
        E_ERROR,
        AgentErrorEvent {
            session_id: session_id.to_string(),
            error: error.to_string(),
            cancelled: false,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    #[test]
    fn initial_prompt_exposes_only_low_level_opencode_tools() {
        let prompt = build_initial_prompt("README を読んで", Some("/tmp/work"));
        assert!(!prompt.contains("M365 Copilot"));
        assert!(prompt.contains("OpenCode/OpenWork tools"));
        assert!(prompt.contains("- read:"));
        assert!(prompt.contains("\"filePath\""));
        assert!(prompt.contains("- glob:"));
        assert!(prompt.contains("- grep:"));
        assert!(!prompt.contains("office_search"));
        assert!(!prompt.contains("Relay Rust runtime"));
    }

    #[test]
    fn final_prompt_keeps_tool_results_as_execution_evidence() {
        let prompt = build_final_prompt(
            "Summarize README",
            &[String::from(
                "tool=read\nid=tool-1\nis_error=false\noutput:\nHello",
            )],
        );
        assert!(prompt.contains("OpenCode/OpenWork tool results"));
        assert!(prompt.contains("only execution evidence"));
        assert!(prompt.contains("Do not request another tool"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn smoke_uses_bundled_opencode_runtime_and_fixture_copilot() {
        let _env_lock = test_env_lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::write(
            workspace.join("README.md"),
            "Relay smoke marker: OpenCode owns tool execution.\n",
        )
        .expect("write readme");

        let runtime = BundledRuntimeProcess::start();
        let _env = EnvGuard::set([
            ("RELAY_OPENCODE_TOOL_RUNTIME_URL", Some(runtime.url.clone())),
            (
                "RELAY_HARD_CUT_COPILOT_REPLY",
                Some(
                    r#"```relay_tool
{"id":"call-readme","name":"read","relay_tool_call":true,"input":{"filePath":"README.md"}}
```"#
                        .to_string(),
                ),
            ),
            (
                "RELAY_HARD_CUT_COPILOT_FINAL_REPLY",
                Some("Final answer from fixture using OpenCode evidence.".to_string()),
            ),
            (
                "RELAY_OPENCODE_TOOL_RUNTIME_TIMEOUT_MS",
                Some("30000".to_string()),
            ),
        ]);

        let mut app = Some(crate::test_support::create_test_app());
        let request = StartAgentRequest {
            goal: "Read README through OpenCode".to_string(),
            files: Vec::new(),
            cwd: Some(workspace.to_string_lossy().into_owned()),
            browser_settings: None,
            max_turns: Some(2),
        };
        let app_ref = app.as_ref().expect("app");
        let session_id = start_agent(
            app_ref.handle().clone(),
            app_ref.state::<AppServices>(),
            request,
        )
        .await
        .expect("start hard-cut agent");

        wait_for_finished(app_ref, &session_id).await;
        let services = app_ref.state::<AppServices>();
        let (stop_reason, last_error, opencode_session_id) = services
            .registry()
            .get_session(&session_id, |state| {
                (
                    state.last_stop_reason.clone(),
                    state.last_error_summary.clone(),
                    state.session_config.opencode_session_id.clone(),
                )
            })
            .expect("registry read")
            .expect("session exists");
        assert_eq!(
            stop_reason.as_deref(),
            Some("completed"),
            "last error: {last_error:?}"
        );
        let opencode_session_id = opencode_session_id.expect("opencode session id");

        let messages = crate::opencode_runtime::session_messages(&opencode_session_id)
            .await
            .expect("opencode messages");
        let relay_messages = crate::opencode_runtime::messages_to_relay(&messages);
        assert!(relay_messages.iter().any(|message| message.role == "user"
            && message.content.iter().any(|content| matches!(
                content,
                crate::agent_projection::MessageContent::Text { text }
                    if text.contains("Read README through OpenCode")
            ))));
        assert!(relay_messages
            .iter()
            .any(|message| message.role == "assistant"
                && message.content.iter().any(|content| matches!(
                    content,
                    crate::agent_projection::MessageContent::ToolResult { tool_use_id, content, is_error }
                        if tool_use_id == "call-readme"
                            && content.contains("OpenCode owns tool execution")
                            && !is_error
                ))));
        assert!(relay_messages
            .iter()
            .any(|message| message.role == "assistant"
                && message.content.iter().any(|content| matches!(
                        content,
                        crate::agent_projection::MessageContent::Text { text }
                        if text.contains("Final answer from fixture")
                ))));
        let history = crate::tauri_bridge::get_session_history(
            app_ref.state::<AppServices>(),
            crate::models::GetAgentSessionHistoryRequest {
                session_id: session_id.clone(),
            },
        )
        .await
        .expect("session history from OpenCode transcript");
        assert_eq!(history.session_id, session_id);
        assert!(
            history
                .messages
                .iter()
                .any(|message| message.role == "assistant"
                    && message.content.iter().any(|content| matches!(
                        content,
                        crate::agent_projection::MessageContent::ToolResult { tool_use_id, content, is_error }
                            if tool_use_id == "call-readme"
                                && content.contains("OpenCode owns tool execution")
                                && !is_error
                    ))),
            "history should be projected from OpenCode transcript"
        );
        assert!(services
            .registry()
            .get_handle(&session_id)
            .expect("registry read")
            .is_some());
        let app = app.take().expect("app");
        tokio::task::spawn_blocking(move || drop(app))
            .await
            .expect("drop mock app");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn continue_restores_missing_registry_from_saved_opencode_session() {
        let _env_lock = test_env_lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let workspace = temp.path().join("workspace");
        std::fs::create_dir_all(&home).expect("home");
        std::fs::create_dir_all(&workspace).expect("workspace");

        let runtime = BundledRuntimeProcess::start();
        let _env = EnvGuard::set([
            ("HOME", Some(home.to_string_lossy().into_owned())),
            ("USERPROFILE", None),
            ("RELAY_OPENCODE_TOOL_RUNTIME_URL", Some(runtime.url.clone())),
            (
                "RELAY_HARD_CUT_COPILOT_REPLY",
                Some("Continued final from fixture.".to_string()),
            ),
            ("RELAY_HARD_CUT_COPILOT_FINAL_REPLY", None),
        ]);

        let opencode_session_id = crate::opencode_runtime::create_session(
            Some(workspace.to_str().unwrap()),
            Some("Saved session"),
        )
        .await
        .expect("create opencode session");
        crate::opencode_runtime::append_text_message(
            &opencode_session_id,
            "user",
            "Original OpenCode transcript request",
            None,
        )
        .await
        .expect("append original transcript");

        let session_id = "session-saved-opencode-continue";
        let config = PersistedSessionConfig {
            goal: Some("Original OpenCode transcript request".to_string()),
            cwd: Some(workspace.to_string_lossy().into_owned()),
            max_turns: Some(2),
            browser_settings: None,
            opencode_session_id: Some(opencode_session_id.clone()),
        };
        copilot_persistence::save_session(session_id, config).expect("save relay metadata");
        let saved_path = home
            .join(".relay-agent")
            .join("sessions")
            .join(format!("{session_id}.json"));
        let mut saved_json: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&saved_path).expect("read saved metadata"),
        )
        .expect("saved metadata json");
        saved_json["messages"] = serde_json::json!([
            {
                "role": "user",
                "blocks": [
                    {
                        "type": "text",
                        "text": "legacy relay saved message should not be restored"
                    }
                ]
            }
        ]);
        std::fs::write(
            &saved_path,
            serde_json::to_string_pretty(&saved_json).expect("legacy saved metadata json"),
        )
        .expect("write legacy saved metadata");

        let mut app = Some(crate::test_support::create_test_app());
        let app_ref = app.as_ref().expect("app");
        assert!(app_ref
            .state::<AppServices>()
            .registry()
            .get_handle(session_id)
            .expect("registry read")
            .is_none());

        continue_agent_session(
            app_ref.handle().clone(),
            app_ref.state::<AppServices>(),
            ContinueAgentSessionRequest {
                session_id: session_id.to_string(),
                message: "Continue from saved metadata".to_string(),
            },
        )
        .await
        .expect("continue saved OpenCode session");

        wait_for_finished(app_ref, session_id).await;
        assert!(app_ref
            .state::<AppServices>()
            .registry()
            .get_handle(session_id)
            .expect("registry read")
            .is_some());

        let history = crate::tauri_bridge::get_session_history(
            app_ref.state::<AppServices>(),
            crate::models::GetAgentSessionHistoryRequest {
                session_id: session_id.to_string(),
            },
        )
        .await
        .expect("history from OpenCode");
        assert!(history
            .messages
            .iter()
            .any(|message| message.content.iter().any(|content| matches!(
                content,
                crate::agent_projection::MessageContent::Text { text }
                    if text.contains("Original OpenCode transcript request")
            ))));
        assert!(history
            .messages
            .iter()
            .any(|message| message.content.iter().any(|content| matches!(
                content,
                crate::agent_projection::MessageContent::Text { text }
                    if text.contains("Continue from saved metadata")
            ))));
        assert!(
            !history
                .messages
                .iter()
                .any(|message| message.content.iter().any(|content| matches!(
                    content,
                    crate::agent_projection::MessageContent::Text { text }
                        if text.contains("legacy relay saved message should not be restored")
                ))),
            "history must be projected from OpenCode, not saved Relay messages"
        );

        let app = app.take().expect("app");
        tokio::task::spawn_blocking(move || drop(app))
            .await
            .expect("drop mock app");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn continue_rejects_saved_relay_only_session() {
        let _env_lock = test_env_lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let home = temp.path().join("home");
        std::fs::create_dir_all(&home).expect("home");
        let _env = EnvGuard::set([
            ("HOME", Some(home.to_string_lossy().into_owned())),
            ("USERPROFILE", None),
        ]);

        let session_id = "session-saved-relay-only-continue";
        let config = PersistedSessionConfig {
            goal: Some("Relay-only saved session".to_string()),
            cwd: None,
            max_turns: Some(2),
            browser_settings: None,
            opencode_session_id: None,
        };
        copilot_persistence::save_session(session_id, config).expect("save relay-only session");

        let mut app = Some(crate::test_support::create_test_app());
        let app_ref = app.as_ref().expect("app");
        let error = continue_agent_session(
            app_ref.handle().clone(),
            app_ref.state::<AppServices>(),
            ContinueAgentSessionRequest {
                session_id: session_id.to_string(),
                message: "Continue".to_string(),
            },
        )
        .await
        .expect_err("Relay-only saved sessions must not continue");
        assert!(
            error.contains("not linked to OpenCode"),
            "unexpected error: {error}"
        );
        assert!(app_ref
            .state::<AppServices>()
            .registry()
            .get_handle(session_id)
            .expect("registry read")
            .is_none());

        let app = app.take().expect("app");
        tokio::task::spawn_blocking(move || drop(app))
            .await
            .expect("drop mock app");
    }

    async fn wait_for_finished<R: Runtime>(app: &tauri::App<R>, session_id: &str) {
        let started = Instant::now();
        loop {
            let done = app
                .state::<AppServices>()
                .registry()
                .get_session(session_id, |state| !state.running)
                .expect("registry read")
                .unwrap_or(false);
            if done {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(60),
                "timed out waiting for hard-cut smoke session"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn test_env_lock() -> tokio::sync::OwnedMutexGuard<()> {
        static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
            std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
            .clone()
            .lock_owned()
            .await
    }

    struct EnvGuard {
        previous: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn set<const N: usize>(values: [(&'static str, Option<String>); N]) -> Self {
            let previous = values
                .iter()
                .map(|(key, _)| (*key, std::env::var(key).ok()))
                .collect::<Vec<_>>();
            for (key, value) in values {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
            Self { previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.previous.drain(..).rev() {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    struct BundledRuntimeProcess {
        child: Child,
        url: String,
    }

    impl BundledRuntimeProcess {
        fn start() -> Self {
            let runtime_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/opencode-runtime");
            let bun = runtime_dir.join(if cfg!(windows) { "bun.exe" } else { "bun" });
            let server = runtime_dir.join("server.js");
            let mut child = Command::new(&bun)
                .arg(&server)
                .arg("--hostname")
                .arg("127.0.0.1")
                .arg("--port")
                .arg("0")
                .current_dir(&runtime_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap_or_else(|error| panic!("failed to start {}: {error}", bun.display()));
            let stdout = child.stdout.take().expect("runtime stdout");
            let mut reader = BufReader::new(stdout);
            let started = Instant::now();
            let mut line = String::new();
            loop {
                line.clear();
                let read = reader.read_line(&mut line).expect("read runtime stdout");
                assert!(read > 0, "opencode runtime exited before ready");
                if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                    if value.get("type").and_then(Value::as_str) == Some("relay-runtime-ready") {
                        let url = value
                            .get("url")
                            .and_then(Value::as_str)
                            .expect("ready url")
                            .to_string();
                        return Self { child, url };
                    }
                }
                assert!(
                    started.elapsed() < Duration::from_secs(20),
                    "timed out waiting for opencode runtime"
                );
            }
        }
    }

    impl Drop for BundledRuntimeProcess {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
