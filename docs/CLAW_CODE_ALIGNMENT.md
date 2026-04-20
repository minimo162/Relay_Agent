# Claw-code Alignment

Reference: [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) (`rust/` workspace, `USAGE.md`, `PARITY.md`).

## Current Upstream Pin

| Field | Value |
|-------|--------|
| Remote | `https://github.com/ultraworkers/claw-code.git` |
| Branch | `main` |
| Commit (last port batch) | `50e3fa3a834a7a5a603d69c372a2c4c190b7104b` |
| Last verification | 2026-04-20 |

Refresh with:

```bash
git ls-remote https://github.com/ultraworkers/claw-code.git refs/heads/main
```

Record any refreshed SHA in `docs/IMPLEMENTATION.md`.

## Alignment Principle

Relay does **not** try to copy claw’s CLI surface. The alignment target is:

- canonical Rust boundaries
- claw-shaped tool schemas and permission posture
- deterministic parity coverage
- machine-readable diagnostics / recovery behavior
- event-first operation rather than prose-only desktop glue

Relay-specific areas remain:

- Tauri IPC and Solid desktop UI
- M365 Copilot + Edge CDP transport
- Node bridge lifecycle
- desktop diagnostics export and launched-app smoke flows

## Canonical Boundaries

| Area | Relay location | Alignment note |
|------|----------------|----------------|
| Agent loop orchestration | `apps/desktop/src-tauri/src/agent_loop/` | Relay keeps desktop/CDP transport, but retry, permission, prompt, and compaction behavior are kept claw-shaped where practical. |
| Tool execution + schemas | `apps/desktop/src-tauri/crates/{tools,runtime}` | Tool names, JSON shapes, and permission expectations follow claw conventions. |
| Permissions | `apps/desktop/src-tauri/crates/runtime/src/permissions.rs` | Modes and escalation posture mirror claw concepts; desktop approval UI is Relay-specific. |
| Config / instructions | `.claw/`, `CLAW.md`, `CLAW_CONFIG_HOME` | Same config surface, desktop-hosted. |
| Diagnostics / doctor | `apps/desktop/src-tauri/src/doctor.rs`, `relay-agent-doctor` | Relay-specific entrypoint, claw-style operational rigor target. |
| Desktop session harness | `apps/desktop/src-tauri/src/test_support.rs`, `crates/compat-harness` | Deterministic parity layer for Relay’s desktop boundary. |

## Tool Catalog Notes

Relay keeps claw-compatible JSON where possible and documents Relay-only additions explicitly.

- `bash` accepts claw sandbox fields (`namespaceRestrictions`, `isolateNetwork`, `filesystemMode`, `allowedMounts`).
- `Task*` accepts claw-style aliases such as `task_id` and `prompt`.
- `AskUserQuestion` accepts claw’s single `question` + `options` shape and normalizes to Relay’s UI contract.
- `LSP` advertises claw-style actions, but only `diagnostics` is implemented today.
- `EnterPlanMode` / `ExitPlanMode` remain compat-only catalog stubs behind `RELAY_COMPAT_MODE`; normal desktop sessions stay on one standard posture.
- Dynamic `mcp__<server>__<tool>` names remain the primary MCP surface, with meta tools layered on top.

## Deterministic Parity Coverage

Relay vendors claw’s `rust/mock_parity_scenarios.json` manifest at:

- `apps/desktop/src-tauri/crates/compat-harness/fixtures/mock_parity_scenarios.json`

The test `mock_parity_scenario_manifest_matches_claw_canonical_order` keeps scenario name order aligned with upstream.

Relay uses **two** deterministic layers:

- `parity_style`: direct tool / permission / workspace checks
- `full_session_harness`: drives the real desktop session loop through `start_agent_inner`, approvals, `agent:*` events, and final state

### Scenario Map

| claw scenario | Relay harness | Exact test |
|---------------|---------------|------------|
| `streaming_text` | `full_session_harness` | `streaming_text_full_session_harness_matches_desktop_event_flow` |
| `read_file_roundtrip` | `parity_style` | `read_file_roundtrip_under_temp_workspace` |
| `grep_chunk_assembly` | `parity_style` | `grep_search_finds_match_in_workspace_file`; `grep_search_count_mode_finds_expected_matches` |
| `write_file_allowed` | `parity_style` | `write_file_allowed_under_temp_workspace` |
| `write_file_denied` | `parity_style` | `write_file_denied_under_read_only_policy` |
| `multi_tool_turn_roundtrip` | `parity_style` | `multi_tool_read_file_then_grep_in_same_workspace` |
| `bash_stdout_roundtrip` | `parity_style` | `bash_stdout_roundtrip_echo`; `bash_stdout_roundtrip_echo_danger_full_access` |
| `bash_permission_prompt_approved` | `parity_style` | `bash_escalation_prompts_under_workspace_write_policy` |
| `bash_permission_prompt_denied` | `parity_style` | `bash_permission_prompt_denied_under_workspace_write_policy` |
| `plugin_tool_roundtrip` | `parity_style` | `plugin_tool_roundtrip_via_fake_stdio_server` |
| `auto_compact_triggered` | `parity_style` | `auto_compact_triggered_matches_runtime_defaults` |
| `token_cost_reporting` | `parity_style` | `token_cost_reporting_tracks_cumulative_usage` |

Additional Relay-only guards:

- `workspace_boundary_rejects_outside_path`
- `glob_and_read_multi_step_style`
- `bash_read_only_project_rejects_rm_via_execute_tool`
- `bash_hard_denylist_blocks_sudo_even_when_workspace_write`
- `read_file_hard_denylist_blocks_dot_env`

## Parity Checklist

- [x] Workspace containment when session `cwd` is set.
- [x] Large text-read cap and large write cap.
- [x] Binary / NUL-byte rejection for plain-text reads.
- [x] Read-only bash heuristic guard under `.claw` permission mode.
- [x] MCP operator-facing errors and recoverable stdio retry.
- [x] Claw-style MCP meta tool names (`ListMcpResources`, `ReadMcpResource`, `McpAuth`, `MCP`).
- [x] `AskUserQuestion` desktop flow.
- [x] `LSP` diagnostics slice.
- [x] `Task*` in-memory registry surface.
- [x] Session compaction and token accounting parity, with Relay’s canonical defaults defined in `runtime::CompactionConfig::default()` (`preserve_recent_messages = 5`, `max_estimated_tokens = 10000`).
- [x] `PostToolUseFailure` hooks.
- [x] Deterministic desktop full-session harness for streamed text, approval flow, and completed stop reasons.

## Doctor And Operations

claw’s rigor target also applies to operational entrypoints.

- Relay now ships `relay-agent-doctor` and root `pnpm doctor -- --json`.
- Doctor output is machine-readable via `RelayDoctorReport` / `RelayDoctorCheck`.
- Required checks cover workspace `.claw`, runtime assets, Edge/CDP reachability, bridge `/health`, authenticated `/status`, and M365 sign-in state.

## When Porting From Claw

- Refresh the upstream SHA in this file.
- Record the port batch in `docs/IMPLEMENTATION.md`.
- Update the deterministic scenario map if tool behavior or parity coverage changes.
- Keep Relay-only desktop behavior documented instead of silently diverging.
