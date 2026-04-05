use runtime::{compact_session, estimate_session_tokens, CompactionConfig, Session};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandManifestEntry {
    pub name: String,
    pub source: CommandSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandSource {
    Builtin,
    InternalOnly,
    FeatureGated,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandRegistry {
    entries: Vec<CommandManifestEntry>,
}

impl CommandRegistry {
    #[must_use]
    pub fn new(entries: Vec<CommandManifestEntry>) -> Self {
        Self { entries }
    }

    #[must_use]
    pub fn entries(&self) -> &[CommandManifestEntry] {
        &self.entries
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlashCommandSpec {
    pub name: &'static str,
    pub summary: &'static str,
    pub argument_hint: Option<&'static str>,
    pub resume_supported: bool,
}

const SLASH_COMMAND_SPECS: &[SlashCommandSpec] = &[
    SlashCommandSpec {
        name: "help",
        summary: "Show available slash commands",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "status",
        summary: "Show current session status",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "compact",
        summary: "Compact local session history",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "model",
        summary: "Show or switch the active model",
        argument_hint: Some("[model]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "permissions",
        summary: "Show or switch the active permission mode",
        argument_hint: Some("[read-only|workspace-write|danger-full-access]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "clear",
        summary: "Start a fresh local session",
        argument_hint: Some("[--confirm]"),
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "cost",
        summary: "Show cumulative token usage for this session",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "resume",
        summary: "Load a saved session into the REPL",
        argument_hint: Some("<session-path>"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "config",
        summary: "Inspect Claude config files or merged sections",
        argument_hint: Some("[env|hooks|model]"),
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "memory",
        summary: "Inspect loaded Claude instruction memory files",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "init",
        summary: "Create a starter CLAUDE.md for this repo",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "diff",
        summary: "Show git diff for current workspace changes",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "version",
        summary: "Show CLI version and build information",
        argument_hint: None,
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "bughunter",
        summary: "Inspect the codebase for likely bugs",
        argument_hint: Some("[scope]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "commit",
        summary: "Generate a commit message and create a git commit",
        argument_hint: None,
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "pr",
        summary: "Draft or create a pull request from the conversation",
        argument_hint: Some("[context]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "issue",
        summary: "Draft or create a GitHub issue from the conversation",
        argument_hint: Some("[context]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "ultraplan",
        summary: "Run a deep planning prompt with multi-step reasoning",
        argument_hint: Some("[task]"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "teleport",
        summary: "Jump to a file or symbol by searching the workspace",
        argument_hint: Some("<symbol-or-path>"),
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "debug-tool-call",
        summary: "Replay the last tool call with debug details",
        argument_hint: None,
        resume_supported: false,
    },
    SlashCommandSpec {
        name: "export",
        summary: "Export the current conversation to a file",
        argument_hint: Some("[file]"),
        resume_supported: true,
    },
    SlashCommandSpec {
        name: "session",
        summary: "List or switch managed local sessions",
        argument_hint: Some("[list|switch <session-id>]"),
        resume_supported: false,
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlashCommand {
    Help,
    Status,
    Compact,
    Bughunter {
        scope: Option<String>,
    },
    Commit,
    Pr {
        context: Option<String>,
    },
    Issue {
        context: Option<String>,
    },
    Ultraplan {
        task: Option<String>,
    },
    Teleport {
        target: Option<String>,
    },
    DebugToolCall,
    Model {
        model: Option<String>,
    },
    Permissions {
        mode: Option<String>,
    },
    Clear {
        confirm: bool,
    },
    Cost,
    Resume {
        session_path: Option<String>,
    },
    Config {
        section: Option<String>,
    },
    Memory,
    Init,
    Diff,
    Version,
    Export {
        path: Option<String>,
    },
    Session {
        action: Option<String>,
        target: Option<String>,
    },
    Unknown(String),
}

impl SlashCommand {
    #[must_use]
    pub fn parse(input: &str) -> Option<Self> {
        let trimmed = input.trim();
        if !trimmed.starts_with('/') {
            return None;
        }

        let mut parts = trimmed.trim_start_matches('/').split_whitespace();
        let command = parts.next().unwrap_or_default();
        Some(match command {
            "help" => Self::Help,
            "status" => Self::Status,
            "compact" => Self::Compact,
            "bughunter" => Self::Bughunter {
                scope: remainder_after_command(trimmed, command),
            },
            "commit" => Self::Commit,
            "pr" => Self::Pr {
                context: remainder_after_command(trimmed, command),
            },
            "issue" => Self::Issue {
                context: remainder_after_command(trimmed, command),
            },
            "ultraplan" => Self::Ultraplan {
                task: remainder_after_command(trimmed, command),
            },
            "teleport" => Self::Teleport {
                target: remainder_after_command(trimmed, command),
            },
            "debug-tool-call" => Self::DebugToolCall,
            "model" => Self::Model {
                model: parts.next().map(ToOwned::to_owned),
            },
            "permissions" => Self::Permissions {
                mode: parts.next().map(ToOwned::to_owned),
            },
            "clear" => Self::Clear {
                confirm: parts.next() == Some("--confirm"),
            },
            "cost" => Self::Cost,
            "resume" => Self::Resume {
                session_path: parts.next().map(ToOwned::to_owned),
            },
            "config" => Self::Config {
                section: parts.next().map(ToOwned::to_owned),
            },
            "memory" => Self::Memory,
            "init" => Self::Init,
            "diff" => Self::Diff,
            "version" => Self::Version,
            "export" => Self::Export {
                path: parts.next().map(ToOwned::to_owned),
            },
            "session" => Self::Session {
                action: parts.next().map(ToOwned::to_owned),
                target: parts.next().map(ToOwned::to_owned),
            },
            other => Self::Unknown(other.to_string()),
        })
    }
}

fn remainder_after_command(input: &str, command: &str) -> Option<String> {
    input
        .trim()
        .strip_prefix(&format!("/{command}"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[must_use]
pub fn slash_command_specs() -> &'static [SlashCommandSpec] {
    SLASH_COMMAND_SPECS
}

#[must_use]
pub fn resume_supported_slash_commands() -> Vec<&'static SlashCommandSpec> {
    slash_command_specs()
        .iter()
        .filter(|spec| spec.resume_supported)
        .collect()
}

#[must_use]
pub fn render_slash_command_help() -> String {
    let mut lines = vec![
        "Slash commands".to_string(),
        "  [resume] means the command also works with --resume SESSION.json".to_string(),
    ];
    for spec in slash_command_specs() {
        let name = match spec.argument_hint {
            Some(argument_hint) => format!("/{} {}", spec.name, argument_hint),
            None => format!("/{}", spec.name),
        };
        let resume = if spec.resume_supported {
            " [resume]"
        } else {
            ""
        };
        lines.push(format!("  {name:<20} {}{}", spec.summary, resume));
    }
    lines.join("\n")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlashCommandResult {
    pub message: String,
    pub session: Session,
}

#[must_use]
pub fn handle_slash_command(
    input: &str,
    session: &Session,
    compaction: CompactionConfig,
) -> Option<SlashCommandResult> {
    match SlashCommand::parse(input)? {
        SlashCommand::Compact => Some(handle_compact(session, compaction)),
        SlashCommand::Help => Some(handle_help(session)),
        SlashCommand::Status => Some(handle_status(session)),
        SlashCommand::Cost => Some(handle_cost(session)),
        SlashCommand::Memory => Some(handle_memory(session)),
        SlashCommand::Config { section } => Some(handle_config(section.as_deref(), session)),
        SlashCommand::Init => Some(handle_init(session)),
        SlashCommand::Diff => Some(handle_diff(session)),
        SlashCommand::Export { path } => Some(handle_export(path, session)),
        SlashCommand::Session { action, target } => Some(handle_session(action.as_deref(), target.as_deref(), session)),
        SlashCommand::Version => Some(handle_version(session)),
        SlashCommand::Clear { confirm } => Some(handle_clear(confirm, session)),
        SlashCommand::Resume { session_path } => Some(handle_resume(session_path, session)),
        SlashCommand::Bughunter { .. }
        | SlashCommand::Commit
        | SlashCommand::Pr { .. }
        | SlashCommand::Issue { .. }
        | SlashCommand::Ultraplan { .. }
        | SlashCommand::Teleport { .. }
        | SlashCommand::DebugToolCall
        | SlashCommand::Model { .. }
        | SlashCommand::Permissions { .. }
        | SlashCommand::Unknown(_) => None,
    }
}

fn handle_compact(session: &Session, compaction: CompactionConfig) -> SlashCommandResult {
    let result = compact_session(session, compaction);
    let message = if result.removed_message_count == 0 {
        "Compaction skipped: session is below the compaction threshold.".to_string()
    } else {
        format!(
            "Compacted {} messages into a resumable system summary.",
            result.removed_message_count
        )
    };
    SlashCommandResult {
        message,
        session: result.compacted_session,
    }
}

fn handle_help(session: &Session) -> SlashCommandResult {
    SlashCommandResult {
        message: render_slash_command_help(),
        session: session.clone(),
    }
}

fn handle_status(session: &Session) -> SlashCommandResult {
    let msg_count = session.messages.len();
    let token_estimate = estimate_session_tokens(session);
    let message = format!(
        "Session status:\n  Messages: {msg_count}\n  Estimated tokens: ~{token_estimate}"
    );
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_cost(session: &Session) -> SlashCommandResult {
    let token_estimate = estimate_session_tokens(session);
    let message = format!(
        "Estimated session tokens: ~{token_estimate}\n\
         (Actual costs depend on model and provider pricing)"
    );
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_memory(session: &Session) -> SlashCommandResult {
    let message = "Memory inspection is available via AGENTS.md, CLAUDE.md, \
        and .claude/ files in the workspace root."
        .to_string();
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_config(section: Option<&str>, session: &Session) -> SlashCommandResult {
    let message = match section {
        Some("env") => format!(
            "Environment variables:\n  RELAY_AGENT_MODEL={}\n  CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS={}",
            std::env::var("RELAY_AGENT_MODEL").unwrap_or_else(|_| "(not set)".into()),
            std::env::var("CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS").unwrap_or_else(|_| "(not set)".into()),
        ),
        Some("model") => format!(
            "Active model: {}",
            std::env::var("RELAY_AGENT_MODEL").unwrap_or_else(|_| "claude-sonnet-4-20250514".into()),
        ),
        _ => "Use /config env, /config model, or /config hooks to inspect specific sections.".to_string(),
    };
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_init(session: &Session) -> SlashCommandResult {
    let message = concat!(
        "To create a CLAUDE.md for this repo, write a file at the workspace root\n",
        "describing: project structure, key conventions, testing commands, and\n",
        "any AI-assistant-specific guidance."
    )
    .to_string();
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_diff(session: &Session) -> SlashCommandResult {
    let message =
        "Run `git diff` in the workspace terminal to see current changes.".to_string();
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_export(path: Option<String>, session: &Session) -> SlashCommandResult {
    let message = if let Some(output_path) = path {
        format!(
            "To export this session ({msg} messages), save it via the \
             persistence API to: {output_path}",
            msg = session.messages.len(),
        )
    } else {
        "Usage: /export <file-path> — exports the current conversation as JSON.".to_string()
    };
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_session(
    action: Option<&str>,
    target: Option<&str>,
    session: &Session,
) -> SlashCommandResult {
    let message = match (action, target) {
        (Some("list"), _) => {
            "Session listing is available through the desktop UI session panel.".to_string()
        }
        (Some("switch"), Some(id)) => {
            format!("To switch session, restart with the desired session ID: {id}")
        }
        _ => "Usage: /session list or /session switch <session-id>".to_string(),
    };
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_version(session: &Session) -> SlashCommandResult {
    let message = format!(
        "Relay Agent — version info:\n  Built with Rust {} / Tauri v2",
        std::env!("CARGO_PKG_VERSION"),
    );
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

fn handle_clear(confirm: bool, session: &Session) -> SlashCommandResult {
    let new_session = if confirm {
        Session::new()
    } else {
        session.clone()
    };
    let message = if confirm {
        "Session cleared. A fresh conversation context is now active.".to_string()
    } else {
        "To clear the session, use /clear --confirm".to_string()
    };
    SlashCommandResult {
        message,
        session: new_session,
    }
}

fn handle_resume(
    session_path: Option<String>,
    session: &Session,
) -> SlashCommandResult {
    let message = if let Some(path) = session_path {
        format!("To resume session `{path}`, restart the agent with --resume {path}")
    } else {
        "Usage: /resume <session-path> — resume a saved session.".to_string()
    };
    SlashCommandResult {
        message,
        session: session.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        handle_slash_command, render_slash_command_help, resume_supported_slash_commands,
        slash_command_specs, SlashCommand,
    };
    use runtime::{CompactionConfig, ContentBlock, ConversationMessage, MessageRole, Session};

    #[test]
    fn parses_supported_slash_commands() {
        assert_eq!(SlashCommand::parse("/help"), Some(SlashCommand::Help));
        assert_eq!(SlashCommand::parse(" /status "), Some(SlashCommand::Status));
        assert_eq!(
            SlashCommand::parse("/bughunter runtime"),
            Some(SlashCommand::Bughunter {
                scope: Some("runtime".to_string())
            })
        );
        assert_eq!(SlashCommand::parse("/commit"), Some(SlashCommand::Commit));
        assert_eq!(
            SlashCommand::parse("/pr ready for review"),
            Some(SlashCommand::Pr {
                context: Some("ready for review".to_string())
            })
        );
        assert_eq!(
            SlashCommand::parse("/issue flaky test"),
            Some(SlashCommand::Issue {
                context: Some("flaky test".to_string())
            })
        );
        assert_eq!(
            SlashCommand::parse("/ultraplan ship both features"),
            Some(SlashCommand::Ultraplan {
                task: Some("ship both features".to_string())
            })
        );
        assert_eq!(
            SlashCommand::parse("/teleport conversation.rs"),
            Some(SlashCommand::Teleport {
                target: Some("conversation.rs".to_string())
            })
        );
        assert_eq!(
            SlashCommand::parse("/debug-tool-call"),
            Some(SlashCommand::DebugToolCall)
        );
        assert_eq!(
            SlashCommand::parse("/model claude-opus"),
            Some(SlashCommand::Model {
                model: Some("claude-opus".to_string()),
            })
        );
        assert_eq!(
            SlashCommand::parse("/model"),
            Some(SlashCommand::Model { model: None })
        );
        assert_eq!(
            SlashCommand::parse("/permissions read-only"),
            Some(SlashCommand::Permissions {
                mode: Some("read-only".to_string()),
            })
        );
        assert_eq!(
            SlashCommand::parse("/clear"),
            Some(SlashCommand::Clear { confirm: false })
        );
        assert_eq!(
            SlashCommand::parse("/clear --confirm"),
            Some(SlashCommand::Clear { confirm: true })
        );
        assert_eq!(SlashCommand::parse("/cost"), Some(SlashCommand::Cost));
        assert_eq!(
            SlashCommand::parse("/resume session.json"),
            Some(SlashCommand::Resume {
                session_path: Some("session.json".to_string()),
            })
        );
        assert_eq!(
            SlashCommand::parse("/config"),
            Some(SlashCommand::Config { section: None })
        );
        assert_eq!(
            SlashCommand::parse("/config env"),
            Some(SlashCommand::Config {
                section: Some("env".to_string())
            })
        );
        assert_eq!(SlashCommand::parse("/memory"), Some(SlashCommand::Memory));
        assert_eq!(SlashCommand::parse("/init"), Some(SlashCommand::Init));
        assert_eq!(SlashCommand::parse("/diff"), Some(SlashCommand::Diff));
        assert_eq!(SlashCommand::parse("/version"), Some(SlashCommand::Version));
        assert_eq!(
            SlashCommand::parse("/export notes.txt"),
            Some(SlashCommand::Export {
                path: Some("notes.txt".to_string())
            })
        );
        assert_eq!(
            SlashCommand::parse("/session switch abc123"),
            Some(SlashCommand::Session {
                action: Some("switch".to_string()),
                target: Some("abc123".to_string())
            })
        );
    }

    #[test]
    fn renders_help_from_shared_specs() {
        let help = render_slash_command_help();
        assert!(help.contains("works with --resume SESSION.json"));
        assert!(help.contains("/help"));
        assert!(help.contains("/status"));
        assert!(help.contains("/compact"));
        assert!(help.contains("/bughunter [scope]"));
        assert!(help.contains("/commit"));
        assert!(help.contains("/pr [context]"));
        assert!(help.contains("/issue [context]"));
        assert!(help.contains("/ultraplan [task]"));
        assert!(help.contains("/teleport <symbol-or-path>"));
        assert!(help.contains("/debug-tool-call"));
        assert!(help.contains("/model [model]"));
        assert!(help.contains("/permissions [read-only|workspace-write|danger-full-access]"));
        assert!(help.contains("/clear [--confirm]"));
        assert!(help.contains("/cost"));
        assert!(help.contains("/resume <session-path>"));
        assert!(help.contains("/config [env|hooks|model]"));
        assert!(help.contains("/memory"));
        assert!(help.contains("/init"));
        assert!(help.contains("/diff"));
        assert!(help.contains("/version"));
        assert!(help.contains("/export [file]"));
        assert!(help.contains("/session [list|switch <session-id>]"));
        assert_eq!(slash_command_specs().len(), 22);
        assert_eq!(resume_supported_slash_commands().len(), 11);
    }

    #[test]
    fn compacts_sessions_via_slash_command() {
        let session = Session {
            version: 1,
            messages: vec![
                ConversationMessage::user_text("a ".repeat(200)),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "b ".repeat(200),
                }]),
                ConversationMessage::tool_result("1", "bash", "ok ".repeat(200), false),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "recent".to_string(),
                }]),
            ],
        };

        let result = handle_slash_command(
            "/compact",
            &session,
            CompactionConfig {
                preserve_recent_messages: 2,
                max_estimated_tokens: 1,
            },
        )
        .expect("slash command should be handled");

        assert!(result.message.contains("Compacted 2 messages"));
        assert_eq!(result.session.messages[0].role, MessageRole::System);
    }

    #[test]
    fn help_command_is_non_mutating() {
        let session = Session::new();
        let result = handle_slash_command("/help", &session, CompactionConfig::default())
            .expect("help command should be handled");
        assert_eq!(result.session, session);
        assert!(result.message.contains("Slash commands"));
    }

    #[test]
    fn handles_status_command() {
        let session = Session {
            version: 1,
            messages: vec![
                ConversationMessage::user_text("hello"),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "hi".to_string(),
                }]),
            ],
        };
        let result =
            handle_slash_command("/status", &session, CompactionConfig::default())
                .expect("status should be handled");
        assert!(result.message.contains("Messages: 2"));
        assert!(result.message.contains("Estimated tokens"));
        assert_eq!(result.session.messages.len(), 2);
    }

    #[test]
    fn handles_cost_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/cost", &session, CompactionConfig::default())
                .expect("cost should be handled");
        assert!(result.message.contains("Estimated session tokens"));
    }

    #[test]
    fn handles_memory_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/memory", &session, CompactionConfig::default())
                .expect("memory should be handled");
        assert!(result.message.contains("Memory"));
    }

    #[test]
    fn handles_config_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/config", &session, CompactionConfig::default())
                .expect("config should be handled");
        assert!(result.message.contains("/config"));
    }

    #[test]
    fn handles_init_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/init", &session, CompactionConfig::default())
                .expect("init should be handled");
        assert!(result.message.contains("CLAUDE.md"));
    }

    #[test]
    fn handles_diff_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/diff", &session, CompactionConfig::default())
                .expect("diff should be handled");
        assert!(result.message.contains("git diff"));
    }

    #[test]
    fn handles_export_command() {
        let session = Session::new();
        let result = handle_slash_command(
            "/export notes.json",
            &session,
            CompactionConfig::default(),
        )
        .expect("export should be handled");
        assert!(result.message.contains("export"));
    }

    #[test]
    fn handles_session_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/session list", &session, CompactionConfig::default())
                .expect("session should be handled");
        assert!(result.message.contains("session"));
    }

    #[test]
    fn handles_version_command() {
        let session = Session::new();
        let result =
            handle_slash_command("/version", &session, CompactionConfig::default())
                .expect("version should be handled");
        assert!(result.message.contains("Relay Agent"));
    }

    #[test]
    fn handles_clear_command_without_confirm() {
        let session = Session {
            version: 1,
            messages: vec![ConversationMessage::user_text("hello")],
        };
        let result =
            handle_slash_command("/clear", &session, CompactionConfig::default())
                .expect("clear should be handled");
        assert!(result.message.contains("--confirm"));
        assert_eq!(result.session.messages.len(), 1);
    }

    #[test]
    fn handles_clear_command_with_confirm() {
        let session = Session {
            version: 1,
            messages: vec![ConversationMessage::user_text("hello")],
        };
        let result = handle_slash_command(
            "/clear --confirm",
            &session,
            CompactionConfig::default(),
        )
        .expect("clear should be handled");
        assert!(result.message.contains("cleared"));
        assert_eq!(result.session.messages.len(), 0);
    }

    #[test]
    fn handles_resume_command() {
        let session = Session::new();
        let result = handle_slash_command(
            "/resume session.json",
            &session,
            CompactionConfig::default(),
        )
        .expect("resume should be handled");
        assert!(result.message.contains("resume"));
    }

    #[test]
    fn ignores_unhandled_slash_commands() {
        let session = Session::new();
        assert!(handle_slash_command("/unknown", &session, CompactionConfig::default()).is_none());
        assert!(
            handle_slash_command("/bughunter", &session, CompactionConfig::default()).is_none()
        );
        assert!(handle_slash_command("/commit", &session, CompactionConfig::default()).is_none());
        assert!(handle_slash_command("/pr", &session, CompactionConfig::default()).is_none());
        assert!(handle_slash_command("/issue", &session, CompactionConfig::default()).is_none());
        assert!(
            handle_slash_command("/ultraplan", &session, CompactionConfig::default()).is_none()
        );
        assert!(
            handle_slash_command("/teleport foo", &session, CompactionConfig::default()).is_none()
        );
        assert!(
            handle_slash_command("/debug-tool-call", &session, CompactionConfig::default())
                .is_none()
        );
        assert!(
            handle_slash_command("/model claude", &session, CompactionConfig::default()).is_none()
        );
        assert!(handle_slash_command(
            "/permissions read-only",
            &session,
            CompactionConfig::default()
        )
        .is_none());
    }
}
