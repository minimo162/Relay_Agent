# Claw-code alignment (Relay_Agent)

Reference: [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) (`rust/` workspace, `USAGE.md`, `PARITY.md`).

## Current upstream pin

| Field | Value |
|-------|--------|
| Remote | `https://github.com/ultraworkers/claw-code.git` |
| Branch | `main` |
| Commit (last port batch) | `e4c38718824bda32c054664d1a01e591b489f635` |

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

claw-code `rust/` exposes on the order of **~40** tools in `mvp_tool_specs()` (per `PARITY.md`). Relay’s [`mvp_tool_specs()`](apps/desktop/src-tauri/crates/tools/src/lib.rs) is smaller: **31** names on Unix targets, **32** with Windows-only `PowerShell` (see source for the authoritative list).

**Diff policy:** When adding or renaming tools, cross-check claw `rust/crates/tools` schemas and descriptions so Copilot-facing JSON stays compatible with the [tool-system](https://claw-code.codes/tool-system) model. Relay-only tools (Electron CDP, `pdf_*`, Copilot hints) stay documented in tool descriptions.

## Mock parity scenario map (claw harness ↔ Relay)

claw uses scripted scenarios in `rust/mock_parity_scenarios.json` and `mock_parity_harness.rs` (see claw `PARITY.md`). Relay [`compat-harness` `parity_style`](apps/desktop/src-tauri/crates/compat-harness/src/lib.rs) tests are intentionally smaller but map as follows:

| claw-style scenario | Relay test (compat-harness) |
|---------------------|----------------------------|
| `read_file_roundtrip` | `read_file_roundtrip_under_temp_workspace` |
| `write_file_denied` (permission) | `write_file_denied_under_read_only_policy` |
| `bash_permission_prompt_*` (escalation) | `bash_escalation_prompts_under_workspace_write_policy` |
| Workspace path safety | `workspace_boundary_rejects_outside_path` |
| Multi-tool / search flow (partial) | `glob_and_read_multi_step_style` |
| Read-only bash rejection (Relay + claw intent) | `bash_read_only_project_rejects_rm_via_execute_tool` |

## Parity-style checklist (from claw `PARITY.md`)

- [x] Workspace boundary for file tools when session `cwd` is set (`runtime::workspace_path`, enforced in `TauriToolExecutor`).
- [x] Large plain-text read capped (`MAX_TEXT_FILE_READ_BYTES` in `file_ops::read_file`).
- [x] NUL-byte rejection for plain-text reads (binary heuristic aligned with claw file-tool notes).
- [x] Bash read-only heuristic guard when `.claw` permission mode is read-only (`bash_validation` + `BashConfigCwdGuard`); not the full claw bash-validation submodule matrix.
- [x] MCP operator-facing errors: clearer `Display` for unknown server/tool and Tauri `mcp_check_server_status` hint (full multi-transport lifecycle still shared “remaining work” with claw).
- [ ] Session compaction / token counting parity with claw (tracked in claw `PARITY.md` “Still open”; Relay `compact.rs` defaults documented in `IMPLEMENTATION.md` 2026-04-10).

## Upstream revision pin (optional ports)

When porting behavior, record the claw-code `main` commit SHA you diffed against in `docs/IMPLEMENTATION.md` (milestone log) and refresh the **Current upstream pin** table above. No automatic submodule is required.
