# Claw-code alignment (Relay_Agent)

Reference: [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) (`rust/` workspace, `USAGE.md`, `PARITY.md`).

## Current upstream pin

| Field | Value |
|-------|--------|
| Remote | `https://github.com/ultraworkers/claw-code.git` |
| Branch | `main` |
| Commit (last port batch) | `e4c38718824bda32c054664d1a01e591b489f635` |
| Last `ls-remote` verification | 2026-04-09 (unchanged from pin above) |

**Procedure:** On each selective port, update this table and add a line under `docs/IMPLEMENTATION.md` Milestone Log (same SHA). Re-resolve with:

`git ls-remote https://github.com/ultraworkers/claw-code.git refs/heads/main`

## Module boundaries

| Area | Relay location | Notes |
|------|----------------|-------|
| M365 Copilot + CDP | `apps/desktop/src-tauri/src/agent_loop.rs`, `copilot_*.rs` | Not in claw CLI; `relay_tool` fenced protocol and file-attach delivery are Relay-only. |
| Tauri IPC / UI events | `tauri_bridge.rs`, `lib.rs`, Solid app | Desktop shell; claw uses its own CLI/REPL. |
| Tool execution + catalog | `crates/tools`, `crates/runtime` | Shapes aligned with [Claw tool-system](https://claw-code.codes/tool-system); implementation is in-repo. |
| Permissions | `crates/runtime/src/permissions.rs`, `agent_loop` desktop policy | Same concepts as claw (modes, tool requirements, prompt escalation); not a shared crate today. |
| File I/O | `crates/runtime/src/file_ops.rs` | Workspace containment when a session `cwd` is set is enforced at the tool executor (`agent_loop`); see `workspace_path` in runtime. |
| Config / instructions | `.claw/`, `CLAW.md`, `CLAW_CONFIG_HOME` | Matches Relay naming documented in `docs/IMPLEMENTATION.md`. |

## Tool catalog: Relay `mvp_tool_specs` vs claw

claw-code `rust/` exposes on the order of **~40** tools in `mvp_tool_specs()` (per `PARITY.md`). Relay’s [`mvp_tool_specs()`](apps/desktop/src-tauri/crates/tools/src/lib.rs) lists **47** names on Unix targets (includes read-only **`git_status`** / **`git_diff`**, **`EnterPlanMode` / `ExitPlanMode`** catalog stubs, and Relay-only tools below), **48** with Windows-only `PowerShell` (see source for the authoritative list).

**Diff policy:** When adding or renaming tools, cross-check claw `rust/crates/tools` schemas and descriptions so Copilot-facing JSON stays compatible with the [tool-system](https://claw-code.codes/tool-system) model. Relay-only tools (Electron CDP, `pdf_*`, Copilot hints) stay documented in tool descriptions.

**Claw-shaped JSON (compat layer):** `bash` catalog schema includes claw sandbox fields (`namespaceRestrictions`, `isolateNetwork`, `filesystemMode`, `allowedMounts`) — runtime already accepts them via [`BashCommandInput`](apps/desktop/src-tauri/crates/runtime/src/bash.rs). **`Task*`** accept `task_id` as an alias for `id`; `TaskCreate` accepts `prompt`; `TaskUpdate` appends claw `message` into task output. **`AskUserQuestion`** accepts claw single `question` + `options: string[]` (normalized to Relay `questions[]` in [`agent_loop.rs`](apps/desktop/src-tauri/src/agent_loop.rs)). **`LSP`** catalog lists claw actions; only **`diagnostics`** runs (rust-analyzer); other actions error clearly. **`EnterPlanMode` / `ExitPlanMode`** return a success JSON notice that session posture is chosen at session start (`tools::plan_mode_tool_json`, also handled in `TauriToolExecutor`).

### Tools present in claw `mvp_tool_specs` but not in Relay (desktop product policy)

Relay still omits **`Team*`**, **`Cron*`**, **`RemoteTrigger`**, **`Worker*`**, **`RunTaskPacket`**, and similar CLI-oriented specs.

**Recently ported for Copilot/claw name compatibility:** MCP meta-tools (`ListMcpResources`, `ReadMcpResource`, `McpAuth`, unified `MCP` with `list_resources` / `read_resource` / `list_tools` / `call_tool`) — desktop executor only, delegating to session [`McpServerManager`](apps/desktop/src-tauri/crates/runtime/src/mcp_stdio.rs); **`AskUserQuestion`** — UI overlay + `respond_user_question` IPC; **`LSP`** — `pull_diagnostics` via `rust-analyzer` stdio ([`lsp_diagnostics.rs`](apps/desktop/src-tauri/crates/runtime/src/lsp_diagnostics.rs)); in-memory **`TaskCreate` / `TaskGet` / `TaskList` / `TaskStop` / `TaskUpdate` / `TaskOutput`** ([`task_registry.rs`](apps/desktop/src-tauri/crates/runtime/src/task_registry.rs)).

Dynamic **`mcp__<server>__<tool>`** names remain the primary MCP surface alongside the meta tools above. If the model emits a claw-only name Relay still does not register, `execute_tool` / the agent executor returns an error until ported — document new names here when adding stubs.

## Mock parity scenario map (claw harness ↔ Relay)

claw uses scripted scenarios in `rust/mock_parity_scenarios.json` and `rust/crates/rusty-claude-cli/tests/mock_parity_harness.rs` with the **`claw` binary** and **`mock-anthropic-service`** (see claw `PARITY.md`). Relay vendors a copy of the scenario manifest at [`apps/desktop/src-tauri/crates/compat-harness/fixtures/mock_parity_scenarios.json`](apps/desktop/src-tauri/crates/compat-harness/fixtures/mock_parity_scenarios.json); sync instructions are in `fixtures/SYNC.txt`. The test `mock_parity_scenario_manifest_matches_claw_canonical_order` keeps the **scenario name list and order** aligned with upstream.

The `compat-harness` crate no longer parses a legacy Claude Code **TypeScript** upstream (`src/commands.ts` / `src/tools.ts`); that surface does not exist on ultraworkers/claw-code.

Relay [`compat-harness` `parity_style`](apps/desktop/src-tauri/crates/compat-harness/src/lib.rs) exercises **direct `tools::execute_tool` and `PermissionPolicy`** where possible. It does **not** replace the full CLI mock-API harness. Scenarios below marked *not in desktop harness* need a follow-up (subprocess `claw` + mock service, or desktop JSON output parity).

| claw-style scenario | Relay coverage (`compat-harness`) |
|---------------------|-----------------------------------|
| `streaming_text` | *Not in desktop harness* (needs mock Anthropic + agent turn) |
| `read_file_roundtrip` | `read_file_roundtrip_under_temp_workspace` |
| `grep_chunk_assembly` | `grep_search_finds_match_in_workspace_file` (content); `grep_search_count_mode_finds_expected_matches` (count, claw-style fixture text) |
| `write_file_allowed` | `write_file_allowed_under_temp_workspace` |
| `write_file_denied` | `write_file_denied_under_read_only_policy` (policy only; `execute_tool` does not enforce desktop `PermissionEnforcer`) |
| `multi_tool_turn_roundtrip` | `multi_tool_read_file_then_grep_in_same_workspace` (behavioral; not a single model turn) |
| `bash_stdout_roundtrip` | `bash_stdout_roundtrip_echo` (workspace-write); `bash_stdout_roundtrip_echo_danger_full_access` (claw permission string) |
| `bash_permission_prompt_approved` | `bash_escalation_prompts_under_workspace_write_policy` |
| `bash_permission_prompt_denied` | `bash_permission_prompt_denied_under_workspace_write_policy` |
| `plugin_tool_roundtrip` | *Not in desktop harness* |
| `auto_compact_triggered` | *Not in desktop harness* |
| `token_cost_reporting` | *Not in desktop harness* |
| (extra) Workspace path safety | `workspace_boundary_rejects_outside_path` |
| (extra) Glob + read flow | `glob_and_read_multi_step_style` |
| (extra) Read-only bash | `bash_read_only_project_rejects_rm_via_execute_tool` |
| (extra) Hard denylist | `bash_hard_denylist_blocks_sudo_even_when_workspace_write`, `read_file_hard_denylist_blocks_dot_env` |

## Parity-style checklist (from claw `PARITY.md`)

- [x] Workspace boundary for file tools when session `cwd` is set (`runtime::workspace_path`, enforced in `TauriToolExecutor`).
- [x] Large plain-text read capped (`MAX_TEXT_FILE_READ_BYTES` in `file_ops::read_file`).
- [x] Large `write_file` body capped (`MAX_WRITE_FILE_BYTES` in `file_ops::write_file`, aligned with claw `MAX_WRITE_SIZE`).
- [x] NUL-byte rejection for plain-text reads (binary heuristic aligned with claw file-tool notes).
- [x] Bash read-only heuristic guard when `.claw` permission mode is read-only (`bash_validation` + `BashConfigCwdGuard`); not the full claw bash-validation submodule matrix.
- [x] MCP operator-facing errors: clearer `Display` for unknown server/tool and Tauri `mcp_check_server_status` hint; **`McpServerManager::call_tool` retries once** after recoverable stdio `Io` failures (process reset + re-init). Full multi-transport lifecycle remains shared “remaining work” with claw.
- [x] Claw-style MCP meta tool names (`ListMcpResources`, `ReadMcpResource`, `McpAuth`, `MCP` JSON `action`) routed through `TauriToolExecutor` to the session `McpServerManager` (stdio servers from merged `.claw`).
- [x] **`AskUserQuestion`**: `agent:user_question` event + `respond_user_question` + Solid `UserQuestionOverlay`.
- [x] **`LSP`**: first slice = pull diagnostics for a workspace file via `rust-analyzer` stdio (`runtime::pull_rust_diagnostics_blocking`).
- [x] **`Task*`** (in-memory registry; no external worker): `TaskCreate`, `TaskGet`, `TaskList`, `TaskStop`, `TaskUpdate`, `TaskOutput`.
- [x] Session compaction / token counting parity with claw (`should_compact` / re-compact / merged summaries aligned with claw-code `rust/crates/runtime/src/compact.rs` at pin SHA; Relay keeps `CompactionConfig::default().preserve_recent_messages == 5` vs upstream 4 — documented in `IMPLEMENTATION.md` 2026-04-09 batch).

## Upstream revision pin (optional ports)

When porting behavior, record the claw-code `main` commit SHA you diffed against in `docs/IMPLEMENTATION.md` (milestone log) and refresh the **Current upstream pin** table above. No automatic submodule is required.
