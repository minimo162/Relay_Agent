mod bash;
mod bash_validation;
mod bootstrap;
mod compact;
mod config;
mod conversation;
mod file_ops;
mod hooks;
mod json;
mod lsp_diagnostics;
mod mcp;
mod mcp_client;
mod mcp_registry;
mod mcp_stdio;
mod oauth;
mod office;
mod pdf_liteparse;
mod pdf_manip;
mod permissions;
mod prompt;
mod remote;
mod search;
pub mod sandbox;
mod session;
mod task_registry;
mod tool_hard_denylist;
mod usage;
mod workspace_path;

pub use bash::{
    execute_bash, read_background_task_output, BackgroundTaskOutputInput, BashCommandInput,
    BashCommandOutput,
};
pub use bash_validation::BashConfigCwdGuard;
pub use bootstrap::{BootstrapPhase, BootstrapPlan};
pub use compact::{
    compact_session, estimate_session_tokens, format_compact_summary,
    get_compact_continuation_message, should_compact, CompactionConfig, CompactionResult,
};
pub use config::{
    ConfigEntry, ConfigError, ConfigLoader, ConfigSource, McpClaudeAiProxyServerConfig,
    McpConfigCollection, McpOAuthConfig, McpRemoteServerConfig, McpSdkServerConfig,
    McpServerConfig, McpStdioServerConfig, McpTransport, McpWebSocketServerConfig, OAuthConfig,
    ResolvedPermissionMode, RuntimeConfig, RuntimeFeatureConfig, RuntimeHookConfig,
    ScopedMcpServerConfig, CLAUDE_CODE_SETTINGS_SCHEMA_NAME,
};
pub use conversation::{
    auto_compaction_threshold_from_env, ApiClient, ApiRequest, AssistantEvent, AutoCompactionEvent,
    ConversationRuntime, RuntimeError, StaticToolExecutor, ToolError, ToolExecutor, TurnInput,
    TurnOutcome, TurnSummary,
};
pub use file_ops::{
    edit_file, glob_search, grep_search, read_file, write_file, EditFileOutput, GlobSearchOutput,
    GrepSearchInput, GrepSearchOutput, ReadFileOutput, StructuredPatchHunk, TextFilePayload,
    WriteFileOutput, MAX_TEXT_FILE_READ_BYTES, MAX_WRITE_FILE_BYTES,
};
pub use hooks::{HookEvent, HookRunResult, HookRunner};
pub use lsp_diagnostics::pull_rust_diagnostics_blocking;
pub use mcp::{
    mcp_server_signature, mcp_tool_name, mcp_tool_prefix, normalize_name_for_mcp,
    scoped_mcp_config_hash, unwrap_ccr_proxy_url,
};
pub use mcp_client::{
    McpClaudeAiProxyTransport, McpClientAuth, McpClientBootstrap, McpClientTransport,
    McpRemoteTransport, McpSdkTransport, McpStdioTransport,
};
pub use mcp_stdio::{
    spawn_mcp_stdio_process, JsonRpcError, JsonRpcId, JsonRpcRequest, JsonRpcResponse,
    ManagedMcpTool, McpInitializeClientInfo, McpInitializeParams, McpInitializeResult,
    McpInitializeServerInfo, McpListResourcesParams, McpListResourcesResult, McpListToolsParams,
    McpListToolsResult, McpReadResourceParams, McpReadResourceResult, McpResource,
    McpResourceContents, McpServerManager, McpServerManagerError, McpStdioProcess, McpTool,
    McpToolCallContent, McpToolCallParams, McpToolCallResult, ToolRoute, UnsupportedMcpServer,
};
pub use oauth::{
    clear_oauth_credentials, code_challenge_s256, credentials_path, generate_pkce_pair,
    generate_state, load_oauth_credentials, loopback_redirect_uri, parse_oauth_callback_query,
    parse_oauth_callback_request_target, save_oauth_credentials, OAuthAuthorizationRequest,
    OAuthCallbackParams, OAuthRefreshRequest, OAuthTokenExchangeRequest, OAuthTokenSet,
    PkceChallengeMethod, PkceCodePair,
};
pub use office::{
    extract as extract_office_document, office_search, OfficeSearchError, OfficeSearchHit,
    OfficeSearchInput, OfficeSearchOutput,
};
pub use pdf_liteparse::{resolve_liteparse_paths, LiteparsePaths};
pub use pdf_manip::{merge_pdfs, split_pdf, PdfSplitSegment};
pub use permissions::{
    PermissionMode, PermissionOutcome, PermissionPolicy, PermissionPromptDecision,
    PermissionPrompter, PermissionRequest,
};
pub use prompt::{
    claw_style_discipline_sections, load_system_prompt, prepend_bullets, render_instruction_files,
    render_project_context, ContextFile, ProjectContext, PromptBuildError, SystemPromptBuilder,
    FRONTIER_MODEL_NAME, SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
};
pub use remote::{
    inherited_upstream_proxy_env, no_proxy_list, read_token, upstream_proxy_ws_url,
    RemoteSessionContext, UpstreamProxyBootstrap, UpstreamProxyState, DEFAULT_REMOTE_BASE_URL,
    DEFAULT_SESSION_TOKEN_PATH, DEFAULT_SYSTEM_CA_BUNDLE, NO_PROXY_HOSTS, UPSTREAM_PROXY_ENV_KEYS,
};
pub use search::{
    workspace_search, WorkspaceSearchCandidate, WorkspaceSearchInput, WorkspaceSearchLimits,
    WorkspaceSearchOutput, WorkspaceSearchSkipped, WorkspaceSearchSnippet,
};
pub use session::{ContentBlock, ConversationMessage, MessageRole, Session, SessionError};
pub use task_registry::{task_create, task_get, task_list, task_output, task_stop, task_update};
pub use tool_hard_denylist::{reject_sensitive_file_path, validate_bash_hard_deny};
pub use usage::{
    format_usd, pricing_for_model, ModelPricing, TokenUsage, UsageCostEstimate, UsageTracker,
};
pub use workspace_path::{assert_path_in_workspace, lexical_normalize, resolve_against_workspace};

#[cfg(test)]
pub(crate) fn test_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
