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

const required = [
  {
    path: "PLANS.md",
    text: "Relay_Agent becomes the adapter between M365 Copilot CDP and OpenCode/OpenWork.",
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
    path: "apps/desktop/src-tauri/src/lib.rs",
    text: "mod agent_projection;",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "fn ensure_continuable_session",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "SessionState::new(config.clone())",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "message_count: 0",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "pub fn save_session(",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "#[serde(default, skip_serializing)]",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "pub struct LoadedSessionMetadata",
  },
  {
    path: "apps/desktop/src-tauri/src/agent_projection.rs",
    text: "pub struct RelayMessage",
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
    path: "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs",
    text: "The old Relay-owned runtime parity harness has been removed.",
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
    text: "pub struct OpencodeToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "pub fn execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "/experimental/tool/execute",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "crate::opencode_runtime::execute_tool_with_context",
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
    path: "apps/desktop/src-tauri/src/commands/agent.rs",
    text: "start_agent_inner",
  },
  {
    path: "apps/desktop/src-tauri/src/commands/agent.rs",
    text: "continue_agent_session_inner",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "RELAY_EXECUTION_BACKEND",
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
    path: "apps/desktop/package.json",
    text: "\"agent-loop:test\"",
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
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "crate::agent_loop::events",
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
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "desktop_core::agent_loop",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "loaded.session",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: ".messages.push",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "ConversationMessage::",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "ContentBlock::",
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
    path: "apps/desktop/src-tauri/crates/compat-harness/Cargo.toml",
    text: "runtime = { path = \"../runtime\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/compat-harness/Cargo.toml",
    text: "tools = { path = \"../tools\"",
  },
  {
    path: "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs",
    text: "use runtime",
  },
  {
    path: "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs",
    text: "runtime::",
  },
  {
    path: "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs",
    text: "use tools",
  },
  {
    path: "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs",
    text: "tools::",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "tools::ToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/opencode_runtime.rs",
    text: "tools::ToolExecutionContext",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "\n            tools::execute_tool_with_context",
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
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "desktop_core::opencode_tools::execute_tool_with_context",
  },
  {
    path: "apps/desktop/src-tauri/src/hard_cut_agent.rs",
    text: "desktop_core::opencode_tools::OpencodeToolExecutionContext",
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
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "use runtime::RuntimeError",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "RuntimeError",
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
    path: "apps/desktop/src-tauri/src/agent_projection.rs",
    text: "runtime::ConversationMessage",
  },
  {
    path: "apps/desktop/src-tauri/src/agent_projection.rs",
    text: "runtime::ContentBlock",
  },
  {
    path: "apps/desktop/src-tauri/src/agent_projection.rs",
    text: "runtime::MessageRole",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs",
    text: "pub mod session_write_undo;",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs",
    text: "pub session:",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs",
    text: "RuntimeSession",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs",
    text: "with_write_undo",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs",
    text: "WriteUndoStacks",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "pub session:",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "pub struct LoadedSession {",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "messages: Vec<PersistedMessage>",
  },
  {
    path: "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs",
    text: "PersistedContentBlock",
  },
];

const forbiddenPaths = [
  "apps/desktop/src-tauri/src/agent_loop",
  "apps/desktop/src-tauri/src/agent_loop_smoke.rs",
  "apps/desktop/scripts/launch_agent_loop_smoke.mjs",
  "apps/desktop/src-tauri/src/error.rs",
  "apps/desktop/src-tauri/Cargo.lock",
  "apps/desktop/src-tauri/crates/desktop-core/src/agent_loop.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/relay_runtime.rs",
  "apps/desktop/src-tauri/src/session_write_undo.rs",
  "apps/desktop/src-tauri/crates/desktop-core/src/session_write_undo.rs",
  "apps/desktop/src-tauri/crates/commands",
  "apps/desktop/src-tauri/crates/api",
  "apps/desktop/src-tauri/crates/runtime",
  "apps/desktop/src-tauri/crates/tools",
];

const byPath = {
  "PLANS.md": plans,
  "Cargo.toml": read("Cargo.toml"),
  "docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md": hardCutPlan,
  "docs/IMPLEMENTATION.md": read("docs/IMPLEMENTATION.md"),
  "apps/desktop/src-tauri/src/commands/agent.rs": read("apps/desktop/src-tauri/src/commands/agent.rs"),
  "apps/desktop/src-tauri/src/opencode_runtime.rs": read("apps/desktop/src-tauri/src/opencode_runtime.rs"),
  "apps/desktop/src-tauri/src/lib.rs": read("apps/desktop/src-tauri/src/lib.rs"),
  "apps/desktop/src-tauri/src/ipc_codegen.rs": read("apps/desktop/src-tauri/src/ipc_codegen.rs"),
  "apps/desktop/src-tauri/src/agent_projection.rs": read("apps/desktop/src-tauri/src/agent_projection.rs"),
  "apps/desktop/src-tauri/src/hard_cut_agent.rs": read("apps/desktop/src-tauri/src/hard_cut_agent.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/lib.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/lib.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/Cargo.toml": read("apps/desktop/src-tauri/crates/desktop-core/Cargo.toml"),
  "apps/desktop/src-tauri/crates/compat-harness/Cargo.toml": read("apps/desktop/src-tauri/crates/compat-harness/Cargo.toml"),
  "apps/desktop/src-tauri/crates/compat-harness/src/lib.rs": read("apps/desktop/src-tauri/crates/compat-harness/src/lib.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/error.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/error.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/opencode_tools.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/doctor.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/registry.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/registry.rs"),
  "apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs": read("apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs"),
  "apps/desktop/src-tauri/src/dev_control.rs": read("apps/desktop/src-tauri/src/dev_control.rs"),
  "apps/desktop/src-tauri/src/doctor.rs": read("apps/desktop/src-tauri/src/doctor.rs"),
  "apps/desktop/src-tauri/src/tauri_bridge.rs": read("apps/desktop/src-tauri/src/tauri_bridge.rs"),
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
