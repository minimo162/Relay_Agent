#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function exists(path) {
  return existsSync(resolve(root, path));
}

function isDirectory(path) {
  const absolute = resolve(root, path);
  return existsSync(absolute) && statSync(absolute).isDirectory();
}

const plans = read("PLANS.md");
const hardCutPlan = read("docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md");
const providerGatewayDoc = read("docs/OPENCODE_PROVIDER_GATEWAY.md");
const windowsBootstrapE2eDoc = read("docs/WINDOWS_OPENWORK_OPENCODE_BOOTSTRAP_E2E.md");

const required = [
  {
    path: "PLANS.md",
    text: "Relay_Agent makes OpenWork/OpenCode easy to use with M365 Copilot",
  },
  {
    path: "PLANS.md",
    text: "Do not add new production features to the Relay-owned Rust execution runtime.",
  },
  {
    path: "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md",
    text: "This is a hard cut.",
  },
  {
    path: "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md",
    text: "OpenCode/OpenWork session state.",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "OpenCode/OpenWork\n  owns UX, sessions, tools, permissions, workspace execution, and event state",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "Relay_Agent copilot_server.js\n  exposes an OpenAI-compatible provider facade",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "pnpm --filter @relay-agent/desktop smoke:opencode-provider",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "pnpm --filter @relay-agent/desktop live:m365:opencode-provider",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "pnpm dev",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "On Windows, the auto path also verifies and downloads the pinned artifacts",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "preserves unrelated `opencode.json` settings",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "Provider base URL: http://127.0.0.1:18180/v1",
  },
  {
    path: "docs/OPENCODE_PROVIDER_GATEWAY.md",
    text: "~/.relay-agent/opencode-provider-token",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:opencode-provider\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"start:opencode-provider-gateway\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"install:opencode-provider-config\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"check:opencode-provider\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"live:m365:opencode-provider\"",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "What happens next",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Advanced diagnostics",
  },
  {
    path: "package.json",
    text: "\"smoke:opencode-provider\"",
  },
  {
    path: "package.json",
    text: "\"start:opencode-provider-gateway\"",
  },
  {
    path: "package.json",
    text: "\"install:opencode-provider-config\"",
  },
  {
    path: "package.json",
    text: "\"check:opencode-provider\"",
  },
  {
    path: "package.json",
    text: "\"live:m365:opencode-provider\"",
  },
  {
    path: "package.json",
    text: "\"diag:desktop-launch\"",
  },
  {
    path: "package.json",
    text: "\"diag:windows-smoke\"",
  },
  {
    path: "package.json",
    text: "\"dev\": \"pnpm bootstrap:openwork-opencode:auto\"",
  },
  {
    path: "package.json",
    text: "\"bootstrap:openwork-opencode:auto\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"bootstrap:openwork-opencode:auto\"",
  },
  {
    path: "package.json",
    text: "\"diag:frontend\"",
  },
  {
    path: "package.json",
    text: "\"diag:tauri-dev\"",
  },
  {
    path: "package.json",
    text: "\"diag:tauri-dev:cdp\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:frontend\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:tauri-dev\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:tauri-dev:cdp\"",
  },
  {
    path: "apps/desktop/src-tauri/binaries/copilot_server.js",
    text: "function buildOpenAiCompletionBody",
  },
  {
    path: "apps/desktop/src-tauri/binaries/copilot_server.js",
    text: "function writeOpenAiChatCompletionLiveStream",
  },
  {
    path: "apps/desktop/src-tauri/binaries/copilot_server.js",
    text: "GET\" && reqUrl.pathname === \"/v1/models\"",
  },
  {
    path: "apps/desktop/scripts/opencode_provider_gateway_smoke.mjs",
    text: "OPEN_CODE_RELAY_TOOL_SMOKE_OK",
  },
  {
    path: "apps/desktop/scripts/live_m365_opencode_provider_smoke.mjs",
    text: "OPEN_CODE_M365_PROVIDER_OK",
  },
  {
    path: "apps/desktop/scripts/start_opencode_provider_gateway.mjs",
    text: "opencode-provider-token",
  },
  {
    path: "apps/desktop/scripts/start_opencode_provider_gateway.mjs",
    text: "start:opencode-provider-gateway",
  },
  {
    path: "apps/desktop/scripts/install_opencode_provider_config.mjs",
    text: "mergeOpencodeConfig",
  },
  {
    path: "apps/desktop/scripts/opencode_provider_config.mjs",
    text: "export function opencodeProviderConfig",
  },
  {
    path: "apps/desktop/src-tauri/bootstrap/openwork-opencode.json",
    text: "Relay downloads and verifies external OpenWork/OpenCode artifacts only.",
  },
  {
    path: "apps/desktop/src-tauri/bootstrap/openwork-opencode.json",
    text: "Relay must not execute tools, own transcripts, or restore bundled runtime sidecars",
  },
  {
    path: "apps/desktop/scripts/openwork_opencode_bootstrap_manifest.test.mjs",
    text: "preserves provider-only boundary",
  },
  {
    path: "apps/desktop/scripts/opencode_cli_bootstrap_config_smoke.mjs",
    text: "fake opencode only supports --version in bootstrap smoke",
  },
  {
    path: "apps/desktop/scripts/openwork_desktop_handoff_smoke.mjs",
    text: "diagnostic_handoff_only",
  },
  {
    path: "apps/desktop/scripts/openwork_desktop_handoff_smoke.mjs",
    text: "explicit-user-approved-installer",
  },
  {
    path: "apps/desktop/scripts/live_windows_openwork_opencode_bootstrap_smoke.mjs",
    text: "B12 requires a clean Windows host with M365 Copilot sign-in",
  },
  {
    path: "apps/desktop/scripts/live_windows_openwork_opencode_bootstrap_smoke.mjs",
    text: "productionEntrypoint",
  },
  {
    path: "apps/desktop/scripts/live_windows_openwork_opencode_bootstrap_smoke.mjs",
    text: "desktop_tauri_dev_still_primary",
  },
  {
    path: "docs/WINDOWS_OPENWORK_OPENCODE_BOOTSTRAP_E2E.md",
    text: "live B12 post-UX-removal verification runbook",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "Relay is the OpenWork/OpenCode setup layer and provider gateway",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_bootstrap.rs",
    text: "pub fn extract_zip_artifact",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_bootstrap.rs",
    text: "pub fn probe_opencode_entrypoint",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "fn write_opencode_provider_config",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "--open-openwork-installer",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "operator_approval_required_use_--open-openwork-installer",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "--start-provider-gateway",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "use_--start-provider-gateway",
  },
  {
    path: "apps/desktop/scripts/openwork_opencode_headless_bootstrap_smoke.mjs",
    text: "headless bootstrap smoke must not download artifacts",
  },
  {
    path: "apps/desktop/scripts/openwork_opencode_headless_bootstrap_smoke.mjs",
    text: "OpenWork installer handoff must require explicit operator approval",
  },
  {
    path: "apps/desktop/scripts/openwork_opencode_provider_gateway_bootstrap_smoke.mjs",
    text: "provider_gateway_bootstrap_ok",
  },
  {
    path: "apps/desktop/scripts/openwork_opencode_auto_bootstrap_smoke.mjs",
    text: "auto_bootstrap_ok",
  },
  {
    path: "README.md",
    text: "**Installed desktop first run:** launch Relay Agent.",
  },
  {
    path: "README.md",
    text: "`~/.config/opencode/opencode.json`",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "openwork_autostart::spawn",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_autostart.rs",
    text: "RELAY_OPENWORK_AUTOSTART=0",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_autostart.rs",
    text: "relay-agent/m365-copilot",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/models.rs",
    text: "OpenWorkSetupSnapshot",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/diagnostics.rs",
    text: "retry_openwork_setup",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Try Setup Again",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Refresh Setup",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Open OpenWork/OpenCode",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/diagnostics.rs",
    text: "open_openwork_or_opencode",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_autostart.rs",
    text: "find_openwork_windows_shortcut",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_autostart.rs",
    text: "Start Menu",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Sign in to Microsoft 365",
  },
  {
    path: "README.md",
    text: "**Try Setup Again**",
  },
  {
    path: "README.md",
    text: "**Open OpenWork/OpenCode**",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_bootstrap.rs",
    text: "default_global_opencode_config_path",
  },
  {
    path: "apps/desktop/src-tauri/src/openwork_bootstrap.rs",
    text: "\"model\"",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "Advanced details are only needed",
  },
  {
    path: "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs",
    text: "--auto",
  },
  {
    path: "docs/WINDOWS_OPENWORK_OPENCODE_BOOTSTRAP_E2E.md",
    text: "Relay must remain the OpenWork/OpenCode setup layer and provider gateway only.",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:opencode-bootstrap-config\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:openwork-desktop-handoff\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"live:windows:openwork-bootstrap\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"bootstrap:openwork-opencode\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:openwork-opencode-bootstrap-headless\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:openwork-opencode-bootstrap-auto\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:openwork-opencode-bootstrap-gateway\"",
  },
  {
    path: "package.json",
    text: "\"smoke:opencode-bootstrap-config\"",
  },
  {
    path: "package.json",
    text: "\"smoke:openwork-desktop-handoff\"",
  },
  {
    path: "package.json",
    text: "\"live:windows:openwork-bootstrap\"",
  },
  {
    path: "package.json",
    text: "\"bootstrap:openwork-opencode\"",
  },
  {
    path: "package.json",
    text: "\"smoke:openwork-opencode-bootstrap-headless\"",
  },
  {
    path: "package.json",
    text: "\"smoke:openwork-opencode-bootstrap-auto\"",
  },
  {
    path: "package.json",
    text: "\"smoke:openwork-opencode-bootstrap-gateway\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs",
    text: "pub const RELAY_MAX_TEXT_FILE_READ_BYTES",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod opencode_tools;",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub mod catalog",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub fn desktop_tool_permission_requirements",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub fn cdp_json_fence_tool_names",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub struct CdpPromptToolSpec",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "const MVP_TOOL_NAMES",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "const CDP_TOOL_NAMES",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "pub struct DesktopCoreError",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs",
    text: "pub const RELAY_MAX_TEXT_FILE_READ_BYTES",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "use crate::opencode_tools::catalog",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "pub struct OpencodeRuntimeSnapshot",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "pub fn external_runtime_url",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "OpenCode/OpenWork execution is expected to run outside Relay",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "pub struct CdpPromptRequest",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "pub struct ConversationMessage",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "pub enum ContentBlock",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "pub struct DesktopPermissionPolicy",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub enum OpencodeToolPermissionMode",
  },
];

const forbidden = [
  {
    path: "package.json",
    text: "\"dev\": \"pnpm --filter @relay-agent/desktop dev\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"tauri:dev\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"tauri:dev:cdp\"",
  },
  {
    path: "PLANS.md",
    text: "Preserve the current desktop architecture; avoid broad backend decomposition",
  },
  {
    path: "PLANS.md",
    text: "keep the agent loop, Copilot bridge, and M365 Copilot via CDP working end to end",
  },
  {
    path: "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md",
    text: "RELAY_EXECUTION_BACKEND",
  },
  {
    path: "docs/IMPLEMENTATION.md",
    text: "RELAY_EXECUTION_BACKEND",
  },
  {
    path: "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md",
    text: "Relay-owned code is concentrated in desktop UX",
  },
  {
    path: "docs/IMPLEMENTATION.md",
    text: "Relay is the desktop UX",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "Relay is the desktop UX",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "Relay is the desktop UX",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "Copilot controls the turn; OpenCode/OpenWork owns tool execution state",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "Copilot controls the turn; OpenCode/OpenWork owns tool execution state",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/mod.rs",
    text: "pub mod agent;",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "RELAY_EXECUTION_BACKEND",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "/experimental/tool/execute",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "/experimental/relay/session",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "RELAY_OPENCODE_RUNTIME_DIR",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "RELAY_OPENCODE_BUN",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "RELAY_OPENCODE_RUNTIME_NO_WARMUP",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "relay-runtime-ready",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "opencode_runtime::start",
  },
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    text: "resources/opencode-runtime/",
  },
  {
    path: "apps/desktop/src-tauri/bootstrap/openwork-opencode.json",
    text: "resources/opencode-runtime/",
  },
  {
    path: "apps/desktop/src-tauri/bootstrap/openwork-opencode.json",
    text: "/experimental/tool/execute",
  },
  {
    path: "apps/desktop/src-tauri/bootstrap/openwork-opencode.json",
    text: "OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "agent_loop_smoke::spawn_if_configured",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "agent_loop_smoke::apply_test_app_local_data_dir_override",
  },
  {
    path: "package.json",
    text: "\"agent-loop:test\"",
  },
  {
    path: "package.json",
    text: "\"launch:test\"",
  },
  {
    path: "package.json",
    text: "\"smoke:windows\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"launch:test\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"smoke:windows\"",
  },
  {
    path: ".github/workflows/ci.yml",
    text: "pnpm launch:test",
  },
  {
    path: ".github/workflows/ci.yml",
    text: "pnpm smoke:windows",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"agent-loop:test\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"tauri:dev:send\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"tauri:dev:approve\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:desktop-smoke\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:tetris-html\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:grounding-approval-multiturn\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:path-resolution-same-session\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:workspace-search\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:long-continuity\"",
  },
  {
    path: "apps/desktop/package.json",
    text: "\"diag:m365:heterogeneous-tools\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:desktop-smoke\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:tetris-html\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:grounding-approval-multiturn\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:path-resolution-same-session\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:workspace-search\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:long-continuity\"",
  },
  {
    path: "package.json",
    text: "\"diag:m365:heterogeneous-tools\"",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "startAgent",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "continueAgentSession",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "respondApproval",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "../components/Composer",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "../components/MessageFeed",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "../components/Sidebar",
  },
  {
    path: "apps/desktop/src/shell/Shell.tsx",
    text: "../components/InlineApprovalCard",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::start_agent",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::continue_agent_session",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::respond_approval",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::respond_user_question",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::cancel_agent",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::get_session_history",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::compact_agent_session",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::undo_session_write",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::redo_session_write",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::agent::get_session_write_undo_status",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub async fn cancel_agent",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub async fn get_session_history",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub async fn respond_approval",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub async fn respond_user_question",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub async fn compact_agent_session",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub fn undo_session_write",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "pub fn redo_session_write",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function startAgent",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function continueAgentSession",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function respondApproval",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function respondUserQuestion",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function cancelAgent",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export function onAgentEvent",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function getSessionHistory",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function undoSessionWrite",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function redoSessionWrite",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function getSessionWriteUndoStatus",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "export async function compactAgentSession",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "AgentSessionPhase",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "AgentStopReason",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "UiChunk",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "friendlyToolActivityLabel",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "office_search",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "office_search",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod workspace_allowlist;",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/diagnostics.rs",
    text: "get_workspace_allowlist",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "getWorkspaceAllowlist",
  },
  {
    path: "apps/desktop/src/components/SettingsModal.tsx",
    text: "data-ra-permissions",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod workspace_skills;",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod workspace_slash_commands;",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/diagnostics.rs",
    text: "list_workspace_skills",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/mod.rs",
    text: "pub mod mcp;",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "commands::mcp::",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "MCP_SERVER_REGISTRY",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod lsp_probe;",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod workspace_surfaces;",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/diagnostics.rs",
    text: "probe_rust_analyzer",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "probeRustAnalyzer",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "fetchWorkspaceInstructionSurfaces",
  },
  {
    path: "apps/desktop/src/lib/ipc.ts",
    text: "listWorkspaceSkills",
  },
  {
    path: "apps/desktop/src/components/SettingsModal.tsx",
    text: "data-ra-skills",
  },
  {
    path: ".github/workflows/ci.yml",
    text: "pnpm agent-loop:test",
  },
  {
    path: "apps/desktop/src-tauri/src/ipc_codegen.rs",
    text: "src/agent_loop/events.rs",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "crate::agent_loop::events",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "crate::agent_loop::",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "\"/start-agent\"",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "\"/first-run-send\"",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "\"/approve\"",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "hard_cut_agent::start_agent",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "hard_cut_agent::continue_agent_session",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "respond_approval_inner",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "crate::agent_loop::msg_to_relay",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "use crate::agent_projection::msg_to_relay",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "return Ok(history);",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "loaded.session.messages",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod agent_loop;",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod agent_loop;",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "summarize_session_messages",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "msg_to_relay",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "handle_slash_command",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "CompactionConfig",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "with_write_undo",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "WriteUndoStacks",
  },
  {
    path: "Cargo.toml",
    text: "apps/desktop/src-tauri/crates/commands",
  },
  {
    path: "Cargo.toml",
    text: "apps/desktop/src-tauri/crates/runtime",
  },
  {
    path: "Cargo.toml",
    text: "apps/desktop/src-tauri/crates/tools",
  },
  {
    path: "Cargo.toml",
    text: "apps/desktop/src-tauri/crates/api",
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    text: "relay_commands",
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    text: "package = \"commands\"",
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    text: "runtime = { path = \"crates/runtime\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/Cargo.toml",
    text: "runtime = { path = \"../runtime\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod relay_runtime;",
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    text: "tools = { path = \"crates/tools\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/Cargo.toml",
    text: "tools = { path = \"../tools\"",
  },
  {
    path: "Cargo.toml",
    text: "compat-harness",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "tools::ToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "\n    let _ = tools::execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: " tools::mvp_tool_specs",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: " tools::required_permission_for_surface",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: " tools::cdp_prompt_tool_specs",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: " tools::cdp_tool_specs_for_visibility",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "Vec<tools::CdpPromptToolSpec>",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub type CdpPromptToolSpec = tools::CdpPromptToolSpec",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "Vec<tools::CdpPromptToolSpec>",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "tools::",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "impl From<OpencodeToolExecutionContext> for tools::ToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub mod execution",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "use crate::opencode_tools::{",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "desktop_core::opencode_tools::execution",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "desktop_core::opencode_tools::execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "desktop_core::opencode_tools::OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs",
    text: "runtime::ConfigLoader",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs",
    text: "runtime::resolve_liteparse_paths",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs",
    text: "relay_runtime",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "RuntimeError",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "pub required_permission: runtime::PermissionMode",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "ApiRequest",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "relay_runtime::PermissionPolicy",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "use crate::relay_runtime::{PermissionMode, PermissionPolicy",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs",
    text: "use crate::relay_runtime::PermissionMode",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "use runtime",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "runtime::ConfigLoader",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "runtime::resolve_liteparse_paths",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "use runtime",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "runtime::MAX_TEXT_FILE_READ_BYTES",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod session_write_undo;",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod registry;",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod copilot_persistence;",
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod registry;",
  },
  {
    path: "apps/desktop/src-tauri/src/app_services.rs",
    text: "SessionRegistry",
  },
  {
    path: "apps/desktop/src-tauri/src/app_services.rs",
    text: "pub fn registry",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "DevSessionState",
  },
  {
    path: "apps/desktop/src-tauri/src/dev_control.rs",
    text: "latest_session_id",
  },
  {
    path: "apps/desktop/src-tauri/src/doctor.rs",
    text: "SessionRegistry",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "SessionRegistry",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "running_session_count",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "block_port_change_on_concurrent_sessions",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "AgentLoopError",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "SessionNotFound",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "RegistryLockPoisoned",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "PersistenceError",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/error.rs",
    text: "agent loop failed",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "session registry",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs",
    text: "block the agent loop",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "start_agent",
  },
  {
    path: "apps/desktop/src-tauri/src/tauri_bridge.rs",
    text: "agent loop use",
  },
  {
    path: "apps/desktop/tests/relay-e2e-harness.ts",
    text: "start_agent",
  },
  {
    path: "apps/desktop/tests/relay-e2e-harness.ts",
    text: "agent:",
  },
  {
    path: "apps/desktop/tests/tauri-mock-core.ts",
    text: "start_agent",
  },
  {
    path: "apps/desktop/tests/tauri-mock-core.ts",
    text: "get_session_history",
  },
];

const forbiddenPaths = [
  "apps/desktop/src-tauri/src/agent_loop",
  "apps/desktop/src-tauri/src/agent_loop_smoke.rs",
  "apps/desktop/src-tauri/resources/opencode-runtime",
  "apps/desktop/scripts/launch_agent_loop_smoke.mjs",
  "apps/desktop/src-tauri/src/error.rs",
  "apps/desktop/src-tauri/Cargo.lock",
  "apps/desktop/src-tauri/crates/desktop-core/src/agent_loop.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/relay_runtime.rs",
  "apps/desktop/src-tauri/src/session_write_undo.rs",
  "apps/desktop/src-tauri/src/workspace_allowlist.rs",
  "apps/desktop/src-tauri/src/commands/mcp.rs",
  "apps/desktop/src-tauri/src/lsp_probe.rs",
  "apps/desktop/src-tauri/src/workspace_surfaces.rs",
  "apps/desktop/src-tauri/src/workspace_skills.rs",
  "apps/desktop/src-tauri/src/workspace_slash_commands.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/session_write_undo.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/workspace_skills.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/workspace_slash_commands.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/workspace_surfaces.rs",
  "apps/desktop/src/lib/skills.ts",
  "apps/desktop/src-tauri/crates/commands",
  "apps/desktop/src-tauri/crates/api",
  "apps/desktop/src-tauri/crates/runtime",
  "apps/desktop/src-tauri/crates/tools",
  "apps/desktop/src-tauri/crates/compat-harness",
  "apps/desktop/src-tauri/src/config.rs",
  "apps/desktop/src-tauri/src/hard_cut_agent.rs",
  "apps/desktop/src-tauri/src/commands/agent.rs",
  "apps/desktop/src-tauri/src/agent_projection.rs",
  "apps/desktop/src-tauri/src/registry.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
  "apps/desktop/src/shell/useAgentEvents.ts",
  "apps/desktop/src/shell/sessionStore.ts",
  "apps/desktop/src/shell/approvalStore.ts",
  "apps/desktop/src/components/ApprovalOverlay.tsx",
  "apps/desktop/src/components/CommandPalette.tsx",
  "apps/desktop/src/components/Composer.tsx",
  "apps/desktop/src/components/FeedCrumb.tsx",
  "apps/desktop/src/components/InlineApprovalCard.tsx",
  "apps/desktop/src/components/InlineQuestionCard.tsx",
  "apps/desktop/src/components/MessageBubble.tsx",
  "apps/desktop/src/components/MessageFeed.tsx",
  "apps/desktop/src/components/RailPanel.tsx",
  "apps/desktop/src/components/Sidebar.tsx",
  "apps/desktop/src/components/StatusBar.tsx",
  "apps/desktop/src/components/ToolCallRow.tsx",
  "apps/desktop/src/components/UserQuestionOverlay.tsx",
  "apps/desktop/src/components/shell-types.ts",
  "apps/desktop/src/context/todo-write-parse.ts",
  "apps/desktop/src/lib/assistant-markdown.ts",
  "apps/desktop/src/lib/slash-commands.ts",
  "apps/desktop/src/lib/tool-timeline.ts",
  "apps/desktop/src/session/session-display.ts",
  "apps/desktop/tests/mock-tauri.ts",
  "apps/desktop/tests/tauri-mock-api",
  "apps/desktop/tests/tauri-mock-preload.ts",
  "apps/desktop/tests/simple.spec.ts",
  "apps/desktop/tests/debug.spec.ts",
  "apps/desktop/tests/deep-debug.spec.ts",
  "apps/desktop/tests/diagnose.spec.ts",
  "apps/desktop/tests/diagnose2.spec.ts",
  "apps/desktop/scripts/dev-approve-latest-session.mjs",
  "apps/desktop/scripts/dev-approve-latest-workspace.mjs",
  "apps/desktop/scripts/dev-approve-latest.mjs",
  "apps/desktop/scripts/dev-first-run-send.mjs",
  "apps/desktop/scripts/dev-reject-latest.mjs",
  "apps/desktop/scripts/live_m365_desktop_smoke.mjs",
  "apps/desktop/scripts/live_m365_heterogeneous_tools_smoke.mjs",
  "apps/desktop/scripts/live_m365_long_continuity_smoke.mjs",
  "apps/desktop/scripts/live_m365_multiturn_grounding_approval.mjs",
  "apps/desktop/scripts/live_m365_same_session_path_resolution.mjs",
  "apps/desktop/scripts/live_m365_tetris_html_smoke.mjs",
  "apps/desktop/scripts/live_m365_workspace_search_smoke.mjs",
];

const byPath = {
  "PLANS.md": plans,
  "Cargo.toml": read("Cargo.toml"),
  "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md": hardCutPlan,
  "docs/OPENCODE_PROVIDER_GATEWAY.md": providerGatewayDoc,
  "docs/WINDOWS_OPENWORK_OPENCODE_BOOTSTRAP_E2E.md": windowsBootstrapE2eDoc,
  "docs/IMPLEMENTATION.md": read("docs/IMPLEMENTATION.md"),
  "README.md": read("README.md"),
  "apps/desktop/src-tauri/src/commands/mod.rs": read("apps/desktop/src-tauri/src/commands/mod.rs"),
  "apps/desktop/src-tauri/src/commands/diagnostics.rs": read("apps/desktop/src-tauri/src/commands/diagnostics.rs"),
  "apps/desktop/src-tauri/src/app_services.rs": read("apps/desktop/src-tauri/src/app_services.rs"),
  "apps/desktop/src-tauri/src/opencode_runtime.rs": read("apps/desktop/src-tauri/src/opencode_runtime.rs"),
  "apps/desktop/src-tauri/tauri.conf.json": read("apps/desktop/src-tauri/tauri.conf.json"),
  "apps/desktop/src-tauri/src/lib.rs": read("apps/desktop/src-tauri/src/lib.rs"),
  "apps/desktop/src-tauri/src/ipc_codegen.rs": read("apps/desktop/src-tauri/src/ipc_codegen.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/lib.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/models.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/models.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/Cargo.toml": read("apps/desktop/src-tauri/crates/desktop-core/Cargo.toml"),
  "apps/desktop/src-tauri/crates/desktop-core/src/error.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/error.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs"),
  "apps/desktop/src-tauri/src/dev_control.rs": read("apps/desktop/src-tauri/src/dev_control.rs"),
  "apps/desktop/src-tauri/src/doctor.rs": read("apps/desktop/src-tauri/src/doctor.rs"),
  "apps/desktop/src-tauri/src/tauri_bridge.rs": read("apps/desktop/src-tauri/src/tauri_bridge.rs"),
  "apps/desktop/src/shell/Shell.tsx": read("apps/desktop/src/shell/Shell.tsx"),
  "apps/desktop/src/lib/ipc.ts": read("apps/desktop/src/lib/ipc.ts"),
  "apps/desktop/src/components/SettingsModal.tsx": read("apps/desktop/src/components/SettingsModal.tsx"),
  "apps/desktop/tests/relay-e2e-harness.ts": read("apps/desktop/tests/relay-e2e-harness.ts"),
  "apps/desktop/tests/tauri-mock-core.ts": read("apps/desktop/tests/tauri-mock-core.ts"),
  "apps/desktop/src-tauri/binaries/copilot_server.js": read("apps/desktop/src-tauri/binaries/copilot_server.js"),
  "apps/desktop/scripts/opencode_provider_gateway_smoke.mjs": read("apps/desktop/scripts/opencode_provider_gateway_smoke.mjs"),
  "apps/desktop/scripts/live_m365_opencode_provider_smoke.mjs": read("apps/desktop/scripts/live_m365_opencode_provider_smoke.mjs"),
  "apps/desktop/scripts/start_opencode_provider_gateway.mjs": read("apps/desktop/scripts/start_opencode_provider_gateway.mjs"),
  "apps/desktop/scripts/install_opencode_provider_config.mjs": read("apps/desktop/scripts/install_opencode_provider_config.mjs"),
  "apps/desktop/scripts/opencode_provider_config.mjs": read("apps/desktop/scripts/opencode_provider_config.mjs"),
  "apps/desktop/scripts/openwork_opencode_bootstrap_manifest.test.mjs": read("apps/desktop/scripts/openwork_opencode_bootstrap_manifest.test.mjs"),
  "apps/desktop/scripts/opencode_cli_bootstrap_config_smoke.mjs": read("apps/desktop/scripts/opencode_cli_bootstrap_config_smoke.mjs"),
  "apps/desktop/scripts/openwork_desktop_handoff_smoke.mjs": read("apps/desktop/scripts/openwork_desktop_handoff_smoke.mjs"),
  "apps/desktop/scripts/live_windows_openwork_opencode_bootstrap_smoke.mjs": read("apps/desktop/scripts/live_windows_openwork_opencode_bootstrap_smoke.mjs"),
  "apps/desktop/scripts/openwork_opencode_auto_bootstrap_smoke.mjs": read("apps/desktop/scripts/openwork_opencode_auto_bootstrap_smoke.mjs"),
  "apps/desktop/scripts/openwork_opencode_headless_bootstrap_smoke.mjs": read("apps/desktop/scripts/openwork_opencode_headless_bootstrap_smoke.mjs"),
  "apps/desktop/scripts/openwork_opencode_provider_gateway_bootstrap_smoke.mjs": read("apps/desktop/scripts/openwork_opencode_provider_gateway_bootstrap_smoke.mjs"),
  "apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs": read("apps/desktop/src-tauri/src/bin/relay-openwork-bootstrap.rs"),
  "apps/desktop/src-tauri/src/openwork_autostart.rs": read("apps/desktop/src-tauri/src/openwork_autostart.rs"),
  "apps/desktop/src-tauri/src/openwork_bootstrap.rs": read("apps/desktop/src-tauri/src/openwork_bootstrap.rs"),
  "apps/desktop/src-tauri/bootstrap/openwork-opencode.json": read("apps/desktop/src-tauri/bootstrap/openwork-opencode.json"),
  "package.json": read("package.json"),
  "apps/desktop/package.json": read("apps/desktop/package.json"),
  "apps/desktop/src-tauri/Cargo.toml": read("apps/desktop/src-tauri/Cargo.toml"),
  ".github/workflows/ci.yml": read(".github/workflows/ci.yml"),
};

const failures = [];

for (const check of required) {
  if (!byPath[check.path].includes(check.text)) {
    failures.push(`${check.path} is missing required hard-cut text: ${check.text}`);
  }
}

for (const check of forbidden) {
  if (byPath[check.path].includes(check.text)) {
    failures.push(`${check.path} contains obsolete runtime-preservation text: ${check.text}`);
  }
}

for (const path of forbiddenPaths) {
  if (isDirectory(path)) {
    failures.push(`${path} must not exist as a legacy agent-loop directory`);
  } else if (exists(path)) {
    failures.push(`${path} must not exist as a legacy agent-loop artifact`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
