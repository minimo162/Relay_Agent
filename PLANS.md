# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is now an **OpenAI-compatible M365 Copilot provider gateway** for
OpenCode/OpenWork. The historical Tauri desktop shell remains under
`apps/desktop/` only for provider launch support, diagnostics, and live Copilot
verification.

- Primary UX and execution: OpenCode/OpenWork.
- Provider gateway: `apps/desktop/src-tauri/binaries/copilot_server.js`.
- Frontend: SolidJS + Vite diagnostic desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with `crates/desktop-core` as the
  only active internal crate. Historical `runtime` / `tools` /
  `compat-harness` crates and the unused legacy `api` crate have been
  physically removed as part of the OpenCode/OpenWork hard cut.
- Primary LLM path: M365 Copilot via Edge CDP and the Relay provider gateway.
- Contract source of truth: Rust IPC types and command signatures; generated frontend bindings live in `apps/desktop/src/lib/ipc.generated.ts`, with `apps/desktop/src/lib/ipc.ts` kept thin.
- UI direction: warm-token light theme and paired warm-charcoal dark theme from `apps/desktop/DESIGN.md`.
- PDF reads: LiteParse via bundled `relay-node`.

Historical workbook / CSV planning artifacts are no longer completion gates for this repository. Older implementation log entries remain preserved in `docs/IMPLEMENTATION.md` as history only.

## Source Of Truth

Planning and implementation references are ordered as follows:

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `docs/CLAW_CODE_ALIGNMENT.md`

Additional rules:

- Rust crate types and IPC signatures in `apps/desktop/src-tauri/` are canonical.
- OpenCode/OpenWork session state is the canonical source for execution
  transcript and runtime behavior. Relay-specific defaults live in the provider
  gateway and diagnostic desktop adapter/config modules.
- `.taskmaster/tasks/tasks.json` must reflect real artifact state, not historical intent.

## Delivery Priorities

- Priority A: keep M365 Copilot via Edge CDP as the primary LLM surface.
- Priority B: keep OpenCode/OpenWork as the external OSS owner for UX,
  sessions, tools, permissions, events, MCP, plugins, skills, and workspace
  runtime behavior.
- Priority C: keep Relay-specific code focused on the OpenAI-compatible
  provider gateway, Copilot CDP transport, tool-call normalization, and
  diagnostics.

## Strategic Reset: OpenCode/OpenWork Provider Gateway

The active architecture direction is a hard cut, not a compatibility migration:
Relay_Agent becomes the adapter between M365 Copilot CDP and OpenCode/OpenWork.
OpenCode/OpenWork owns UX and execution; Copilot owns the LLM surface; Relay
owns the M365 Copilot provider gateway and diagnostics.

Detailed plan: `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`.

Implications:

- Do not add new production features to the Relay-owned Rust execution runtime.
- Do not preserve legacy tool/runtime/session contracts for compatibility.
- Do not reintroduce `office_search` as a model-facing tool.
- Do not treat the Copilot browser thread as the execution source of truth.
- New runtime work should target OpenCode/OpenWork APIs or extension points.

## Completed Task: Provider-Only Hard Cut

Goal: remove remaining compatibility posture now that the OpenAI-compatible
OpenCode provider gateway has landed. Relay's desktop-owned UX and execution
surface should stop being treated as a product path; Relay should keep only
provider gateway startup, OpenCode/OpenWork config support, M365 Copilot CDP
transport, and diagnostics.

Status 2026-04-25: implemented for live docs, root/package scripts, CI naming,
doctor diagnostics, task graph, and hard-cut guard enforcement.

Compatibility policy:

- Do not preserve legacy Relay desktop chat/session behavior.
- Do not preserve hidden compatibility tools such as `office_search`.
- Do not preserve Relay-owned tool execution, repair strategy, or transcript
  state as a fallback path.
- Do not keep migration shims unless they are strictly needed to launch or
  diagnose the OpenCode/OpenWork provider gateway.

Change targets:

- `README.md`
- `PLANS.md`
- `.taskmaster/tasks/tasks.json`
- `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`
- `docs/IMPLEMENTATION.md`
- `apps/desktop/package.json`
- `package.json`
- `apps/desktop/src-tauri/src/doctor.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/binaries/copilot_server.js`

Acceptance criteria:

- README first-run guidance starts with OpenCode/OpenWork plus
  `pnpm start:opencode-provider-gateway`, not the diagnostic desktop shell.
- Package scripts clearly separate canonical provider commands from diagnostic
  desktop checks; compatibility-era launch paths are not presented as primary.
- Doctor output names Relay as an OpenAI-compatible M365 provider gateway and
  treats desktop-shell checks as diagnostics only.
- No live documentation claims Relay owns the primary UX, sessions, tools,
  permissions, transcript, or execution loop.
- `office_search` is marked as a non-goal/unsupported leftover until moved into
  an OpenCode/OpenWork extension point or deleted.
- `pnpm check`, `pnpm check:opencode-provider`, and `git diff --check` pass.

## Completed Task: Diagnostic Shell Minimization

Goal: physically shrink the remaining Relay desktop shell so it can no longer
look like a product UX or execution fallback. The shell should remain only for
provider gateway launch support, doctor output, CDP/M365 diagnostics, and
targeted regression harnesses.

Status 2026-04-25: implemented for the normal desktop UI path. `Shell.tsx` now
renders a provider gateway diagnostic console and the hard-cut guard rejects
reintroducing `startAgent`, `continueAgentSession`, Composer, MessageFeed,
Sidebar, or inline approval imports into the normal shell.

Non-goals:

- Do not preserve `start_agent` / `continue_agent_session` as primary product
  APIs.
- Do not keep Relay-owned chat/session UI behavior for compatibility.
- Do not keep Relay-owned approval, write-undo, slash-command, MCP, or
  workspace permission flows as product surfaces.
- Do not move execution back into Relay to keep old desktop smokes passing.

Change targets:

- `apps/desktop/src/shell/**`
- `apps/desktop/src/components/**`
- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src-tauri/src/commands/agent.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/tests/**`
- `README.md`
- `PLANS.md`
- `.taskmaster/tasks/tasks.json`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- The desktop first screen is diagnostic/provider-oriented, not a chat-first
  agent workspace.
- `start_agent` and `continue_agent_session` are removed from the desktop UI
  path.
- Chat/session stores, approval UI, write undo UI, and session transcript
  rendering are either removed or explicitly isolated under diagnostic test
  harnesses.
- Root provider checks remain unchanged: `pnpm check`,
  `pnpm check:opencode-provider`, and `pnpm smoke:opencode-provider`.
- Diagnostic launch checks still pass under their `diag:*` names or are
  intentionally retired with CI/docs updated in the same change.

## Completed Task: Legacy Agent IPC Retirement

Goal: remove legacy Relay chat/session execution commands from the public Tauri
WebView invoke surface and frontend IPC bridge. Internal Rust diagnostic
harnesses may still call the old controller directly while the remaining
backend deletion proceeds, but the desktop app can no longer invoke those paths
as product APIs.

Status 2026-04-25: implemented for the Tauri `generate_handler!` command list,
frontend `ipc.ts`, and hard-cut guard enforcement.

Retired public commands:

- `start_agent`
- `continue_agent_session`
- `respond_approval`
- `respond_user_question`
- `cancel_agent`
- `get_session_history`
- `compact_agent_session`
- `undo_session_write`
- `redo_session_write`
- `get_session_write_undo_status`

Acceptance criteria:

- The normal WebView invoke handler exposes provider diagnostics, CDP helpers,
  doctor, OpenCode/OpenWork config support, MCP diagnostics, and workspace
  inspection only.
- `apps/desktop/src/lib/ipc.ts` no longer exports frontend wrappers for retired
  legacy agent commands.
- `scripts/check-hard-cut-guard.mjs` fails if retired commands return to the
  public invoke handler or frontend IPC bridge.
- `pnpm check`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  and `git diff --check` pass.

## Completed Task: Legacy Agent Event And Type Retirement

Goal: remove the remaining Relay-owned agent event and session-history IPC
projection surface after public commands, command wrappers, dev-control routes,
and the hard-cut wrapper were deleted.

Status 2026-04-25: implemented for Rust IPC models, generated frontend
bindings, the frontend event subscription bridge, OpenCode transcript mapping
shims, and hard-cut guard enforcement.

Retired surfaces:

- `apps/desktop/src-tauri/src/agent_projection.rs`
- Relay-owned `agent:*` event payload types and frontend `onAgentEvent`
  listener bridge.
- Legacy agent request/response structs in `desktop-core/src/models.rs`.
- OpenCode session-history-to-Relay-message projection helpers.
- Unsupported Relay session history, approval, question, cancel, compact, undo,
  and redo entrypoints from `tauri_bridge.rs`.

Acceptance criteria:

- Generated frontend IPC bindings contain only diagnostic/provider-support
  contracts.
- `ipc.ts` does not listen for Relay-owned `agent:*` events.
- The hard-cut guard rejects restoring the deleted event/type projection
  module and event listener bridge.

## Completed Task: Legacy Session Registry And Persistence Retirement

Goal: remove the remaining Relay-owned in-memory session registry and metadata
persistence now that desktop execution commands, events, and projection IPC have
been retired. OpenCode/OpenWork remains the only session source of truth.

Status 2026-04-26: implemented by deleting the desktop-core session registry
and Copilot session persistence module, removing the app-level registry
re-export, and simplifying provider diagnostics to use only the Copilot bridge
manager.

Retired surfaces:

- `apps/desktop/src-tauri/crates/desktop-core/src/registry.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs`
- `apps/desktop/src-tauri/src/registry.rs`
- `AppServices.registry`
- Dev-control session snapshots from `GET /state`
- Copilot CDP port-change blocking based on Relay-owned running sessions

Acceptance criteria:

- Relay desktop code no longer exports or constructs `SessionRegistry`.
- `dev_control.rs` exposes provider diagnostics and stored automation config,
  not Relay-owned session state.
- `ensure_copilot_server` manages only Copilot bridge lifecycle and CDP port
  changes; it does not consult Relay session concurrency.
- The hard-cut guard rejects restoring the deleted registry/persistence files
  or their module declarations.

## Completed Task: Legacy Error Taxonomy Retirement

Goal: remove the leftover Relay-owned execution error taxonomy and stale
agent-loop wording after the registry and persistence modules were deleted.
`desktop-core` should expose provider/diagnostic helpers, not unused
session-loop error variants.

Status 2026-04-26: implemented by deleting the unused `AgentLoopError` enum,
keeping only `DesktopCoreError`, and updating remaining CDP adapter comments
and logs to describe provider diagnostics rather than `start_agent` or an
agent loop.

Retired surfaces:

- `AgentLoopError`
- `SessionNotFound`
- `RegistryLockPoisoned`
- `PersistenceError`
- Agent-loop wording in Copilot adapter comments.
- `start_agent` wording in CDP auto-connect logs.

Acceptance criteria:

- `desktop-core/src/error.rs` contains only active provider/diagnostic error
  types.
- Live Rust source does not mention `AgentLoopError`, the removed registry
  lock error, or persistence/session variants.
- The hard-cut guard rejects restoring the obsolete error taxonomy and stale
  CDP adapter/log wording.

## Completed Task: Agent Command Module Retirement

Goal: delete the now-unreachable Tauri command wrapper module for legacy Relay
chat/session execution. After the public invoke handler and frontend IPC bridge
were retired, `commands/agent.rs` only preserved obsolete Tauri command symbols.

Status 2026-04-25: implemented by removing `commands/agent.rs`, removing the
`pub mod agent;` declaration from `commands/mod.rs`, and strengthening the
hard-cut guard so the module cannot return.

Acceptance criteria:

- `apps/desktop/src-tauri/src/commands/agent.rs` no longer exists.
- `apps/desktop/src-tauri/src/commands/mod.rs` no longer declares the agent
  command module.
- `scripts/check-hard-cut-guard.mjs` fails if the deleted module or module
  declaration returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `pnpm check`, and `git diff --check` pass.

## Completed Task: Dev-Control Agent Route Retirement

Goal: remove debug-only localhost controls that could still start, continue, or
approve Relay-owned agent execution from the desktop process. Dev-control now
stays limited to local health, state, and diagnostic configuration support.

Status 2026-04-25: implemented by deleting `/start-agent`, `/first-run-send`,
direct `/approve`, approve/reject event routes, and all `hard_cut_agent` calls
from `dev_control.rs`. Old desktop live harness package aliases were removed in
favor of `live:m365:opencode-provider` and the Copilot response probe.

Acceptance criteria:

- `apps/desktop/src-tauri/src/dev_control.rs` no longer calls
  `hard_cut_agent::start_agent`, `hard_cut_agent::continue_agent_session`, or
  `respond_approval_inner`.
- Debug localhost routes no longer expose `/start-agent`, `/first-run-send`, or
  direct `/approve` execution controls.
- Root and desktop package scripts no longer advertise old `diag:m365:*`
  desktop execution harnesses.
- `scripts/check-hard-cut-guard.mjs` fails if those routes or script aliases
  return.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `pnpm check`, and `git diff --check` pass.

## Completed Task: Orphan Desktop Live Harness Retirement

Goal: physically remove old desktop-owned live automation helpers after their
package entry points and dev-control execution routes were retired. Relay's live
M365 verification surface now stays on the OpenAI-compatible provider smoke and
Copilot response probe.

Status 2026-04-25: implemented by deleting the stale dev-control helper
scripts and old `live_m365_*` desktop execution harnesses from
`apps/desktop/scripts/`, then extending the hard-cut guard so those files cannot
return.

Acceptance criteria:

- `apps/desktop/scripts/dev-first-run-send.mjs`,
  `dev-approve-latest*.mjs`, and `dev-reject-latest.mjs` no longer exist.
- Old desktop execution harnesses such as
  `live_m365_desktop_smoke.mjs`, `live_m365_tetris_html_smoke.mjs`,
  grounding/path/workspace/continuity/heterogeneous live smokes no longer
  exist.
- Provider live verification remains available through
  `live:m365:opencode-provider` and `live:m365:copilot-response-probe`.
- `scripts/check-hard-cut-guard.mjs` fails if any retired helper or harness
  file is recreated.
- `node scripts/check-hard-cut-guard.mjs`, `pnpm check`, and
  `git diff --check` pass.

## Completed Task: Compat Harness Crate Retirement

Goal: remove the remaining standalone compatibility fixture crate after the old
Relay runtime/tools parity harness was already deleted. The crate only kept a
historical claw-code mock parity manifest readable and was no longer an active
provider gateway verification surface.

Status 2026-04-25: implemented by deleting
`apps/desktop/src-tauri/crates/compat-harness/`, removing it from the root
Cargo workspace, updating current docs that advertised it as active coverage,
and extending the hard-cut guard so the crate cannot return.

Acceptance criteria:

- `apps/desktop/src-tauri/crates/compat-harness/` no longer exists.
- Root `Cargo.toml` no longer lists `compat-harness` as a workspace member.
- README / AGENTS / current plan wording no longer presents `compat-harness` as
  active coverage.
- `scripts/check-hard-cut-guard.mjs` fails if the crate directory or workspace
  member returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace
  --exclude relay-agent-desktop`, `pnpm check`, and `git diff --check` pass.

## Completed Task: Hard-Cut Agent Wrapper Retirement

Goal: delete the last internal wrapper that could run Relay-owned desktop agent
turns against the bundled OpenCode runtime. Provider-mode execution belongs to
OpenCode/OpenWork and reaches Relay only through the OpenAI-compatible M365
Copilot provider gateway.

Status 2026-04-25: implemented by deleting `hard_cut_agent.rs`, removing the
module declaration, and deleting the now-unused Relay agent-loop config and
semaphore plumbing from `AppServices`.

Acceptance criteria:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs` no longer exists.
- `apps/desktop/src-tauri/src/config.rs` no longer exists.
- `apps/desktop/src-tauri/src/lib.rs` no longer declares `mod hard_cut_agent`
  or `mod config`.
- `AppServices` only retains diagnostic registry and Copilot bridge state.
- `scripts/check-hard-cut-guard.mjs` fails if the deleted wrapper or config
  returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace
  --exclude relay-agent-desktop`, `cargo test --manifest-path
  apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and
  `git diff --check` pass.

## Guardrails

- Do not widen scope without updating this file and recording the reason in `docs/IMPLEMENTATION.md`.
- Preserve Copilot CDP product focus, but do not preserve Relay's bespoke
  execution runtime or treat Relay's diagnostic desktop shell as the target UX.
- Keep Relay-specific code focused on the OpenAI-compatible provider facade,
  M365 Copilot, CDP orchestration, prompt adaptation, and diagnostics.
- Tool shapes, permission posture, session state, plugins, MCP, skills, and
  workspace config should come from OpenCode/OpenWork wherever practical.
- Do not implement arbitrary code execution, unrestricted shell access, VBA, or uncontrolled external network execution outside agent-managed tools.

## Verification Policy

Canonical repo verification commands:

```bash
pnpm check
pnpm check:opencode-provider
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli
```

Provider-gateway acceptance and smoke commands:

```bash
pnpm smoke:opencode-provider
pnpm start:opencode-provider-gateway -- --print-config
pnpm install:opencode-provider-config -- --workspace /path/to/workspace --dry-run
```

Diagnostic desktop checks:

```bash
pnpm diag:desktop-launch
pnpm diag:windows-smoke
pnpm doctor -- --json
```

Rules:

- `pnpm check` is the canonical frontend acceptance gate.
- `pnpm check` includes the CI-safe provider contract check.
- `pnpm check:opencode-provider` validates provider scripts and OpenAI facade
  tests without requiring Bun, OpenCode, Edge, or live M365.
- `pnpm smoke:opencode-provider` is the canonical deterministic
  OpenCode/OpenWork provider contract gate.
- `pnpm typecheck` remains the fast local frontend-only check.
- Every completed milestone must leave a concrete artifact or logged verification result in `docs/IMPLEMENTATION.md`.
- CI must enforce the documented acceptance path instead of a smaller substitute.

## Current Hardening Track

### Phase 1: Repository Truth Cleanup

Goal: eliminate conflicting defaults and stale repo guidance.

Change targets:

- `Cargo.toml`
- `pnpm-workspace.yaml`
- `package.json`
- `README.md`
- `PLANS.md`
- `AGENTS.md`
- `docs/CLAW_CODE_ALIGNMENT.md`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Acceptance criteria:

- Workspace license metadata matches `LICENSE`.
- The workspace manifest no longer points at removed packages.
- Live docs all describe the same current desktop product.
- Active runtime behavior is documented as OpenCode/OpenWork-owned rather than
  Relay runtime-owned.
- Root `pnpm check` is the documented frontend gate.

### Phase 2: Headless Doctor

Goal: add a machine-readable diagnostic entrypoint for workspace, runtime assets, CDP, bridge health, and M365 readiness.

Change targets:

- `apps/desktop/src-tauri/src/doctor.rs`
- `apps/desktop/src-tauri/src/bin/relay-agent-doctor.rs`
- `apps/desktop/src-tauri/src/commands/{copilot,diagnostics}.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `package.json`
- `README.md`

Acceptance criteria:

- `relay-agent-doctor` supports `--json`, `--workspace`, `--cdp-port`, `--timeout-ms`, and `--no-auto-launch-edge`.
- Doctor JSON uses stable `RelayDoctorReport` / `RelayDoctorCheck` structures.
- Existing IPC warmup/diagnostics commands delegate to the shared doctor service.
- Integration tests cover ready, login-required, auth-failure, missing-workspace, and missing-runtime-asset paths.

### Phase 3: Deterministic Provider And Diagnostic Coverage

Goal: keep deterministic provider and diagnostic tests without preserving a
Relay-owned desktop execution wrapper.

Change targets:

- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `docs/CLAW_CODE_ALIGNMENT.md`

Acceptance criteria:

- Provider and diagnostic checks verify gateway, doctor, CDP, and runtime
  health surfaces without routing tasks through Relay-owned desktop execution.
- Deterministic tests cover the active OpenCode-backed hard-cut adapter path;
  old runtime-level parity scenarios are not compatibility requirements.
- Alignment docs name the exact test covering each claw-style scenario.
- Copilot tool-call parser tolerance is widened from mutation-only to any MVP-whitelisted tool for unfenced sentinel-bearing JSON on Initial parse (see `docs/IMPLEMENTATION.md` 2026-04-18 milestone).

### Phase 4: CI And Acceptance Alignment

Goal: make CI enforce the repo’s actual acceptance criteria on both Linux and Windows.

Change targets:

- `.github/workflows/ci.yml`
- `package.json`
- `apps/desktop/package.json`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Main CI runs on `ubuntu-latest` and `windows-latest`.
- Ubuntu executes bundled-node prep, Tauri system dependencies, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:desktop-launch`.
- Windows executes bundled-node prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:windows-smoke`.
- The `pnpm check` CI step includes the CI-safe OpenCode provider contract
  check. Full `pnpm smoke:opencode-provider` remains a local/ops smoke because
  it requires a real OpenCode checkout and Bun.
- CI also guards the live docs map against stale removed-package or spreadsheet-era references.

Status 2026-04-25:

- Implemented on `main` for `push`, `pull_request`, and manual dispatch.
- Latest verified push run: `24913551591`, commit `6e56068`, passed Ubuntu
  Acceptance and Windows Acceptance.

### Phase 5: First-Use UI Simplification

Goal: keep the desktop shell easy to understand by using one standard conversation surface instead of mode-based UX.

Change targets:

- `apps/desktop/src/components/{FirstRunPanel,Composer,SettingsModal,ShellHeader,Sidebar,MessageFeed,ContextPanel,StatusBar}.tsx`
- `apps/desktop/src/shell/{Shell,useCopilotWarmup}.ts*`
- `apps/desktop/src/index.css`
- `apps/desktop/tests/{app.e2e.spec.ts,e2e-comprehensive.spec.ts}`
- `README.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- First run is a single three-step flow: project, Copilot, first request.
- The first request stays disabled until project selection and Copilot readiness are satisfied.
- The app keeps one standard session posture for all chats; review and explanation requests are handled by intent, not by mode switches.
- User-facing labels prefer `Project`, `Chats`, `Needs your approval`, `Activity`, and `Integrations`.
- Risky actions are explained through inline approval requests instead of a separate mode or permission matrix.
- Root `pnpm check` passes and Playwright coverage confirms first-run gating plus the simplified shell labels.

### Phase 6: Opencode-Like Office/PDF Glob-Read Flow

Goal: keep Office/PDF shared-document search as a Relay capability while moving
the model-facing tool surface back toward opencode's simple `read` / `glob` /
`grep` shape. Office/PDF files are not searched through a hidden `grep`
content backend; the model discovers candidate paths with `glob` and inspects
exact documents with `read`.

Change targets:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/OPENCODE_ALIGNMENT_PLAN.md`
- `docs/OFFICE_SEARCH_DESIGN.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `grep` searches plaintext/code files only and rejects `.docx`, `.xlsx`,
  `.xlsm`, `.pptx`, and `.pdf` targets with guidance to use `glob` then `read`.
- `read` is the model-facing path for exact Office/PDF files and returns
  extracted plaintext.
- `office_search` is hidden from CDP catalogs and repair prompts; retaining it
  as a Relay compatibility helper is not a goal.
- Local lookup repair generates only active model-facing tools: `read`, `glob`,
  and `grep`.
- Office/PDF filename discovery stays a `glob` responsibility; candidate
  filenames are not treated as content evidence until `read` inspects a file.
- Root verification follows the repository acceptance policy, with focused
  desktop-core parser, OpenCode runtime delegate, and hard-cut adapter
  regressions covering plaintext-only grep, glob-read Office/PDF repair, and
  no `office_search` repair.

Status 2026-04-23:

- Implemented for the CDP adapter path. `grep` now rejects Office/PDF container
  targets, CDP local-search catalogs expose only `read` / `glob` / `grep`, and
  local lookup repair no longer generates `office_search`.
- Office/PDF evidence lookup repair now starts with `glob`; if Copilot tries to
  summarize a `glob` candidate as evidence, the loop continues with a targeted
  `read` of the top Office/PDF candidate.
- Any remaining `office_search` code is an unsupported leftover and should move
  into an OpenCode/OpenWork extension point or be deleted.

### Cross-Cutting Hardening: Workspace Approval Persistence

Goal: make persisted "Allow for this workspace" approvals resilient to interrupted writes and visible when the store is damaged.

Change targets:

- `apps/desktop/src-tauri/src/workspace_allowlist.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/models.rs`
- `apps/desktop/src/components/SettingsModal.tsx`
- `apps/desktop/src/lib/ipc.generated.ts`
- `apps/desktop/tests/{app.e2e.spec.ts,relay-e2e-harness.ts,tauri-mock-*.ts,simple.spec.ts}`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Workspace allowlist writes use a temp file plus locked replace instead of direct `fs::write`.
- Corrupt or unreadable allowlist stores surface warnings through the IPC snapshot and Settings UI.
- Mutating the allowlist refuses to overwrite a corrupt store.
- Rust regression tests cover corrupt-store warning and non-destructive failure handling.

### Cross-Cutting Hardening: Bash Policy And Legacy Loop Removal

Goal: reduce reliance on regex-only shell blocking and keep the old desktop
orchestrator removed.

Change targets:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Bash deny decisions use shell-fragment/token inspection before regex fallback.
- Wrapper forms such as `env ...`, `command ...`, `nice ...`, and mixed-case blocked verbs are covered by regression tests.
- OpenCode-backed adapter regression coverage verifies that Relay does not
  reintroduce the old shell policy engine.
- The deleted desktop `agent_loop/**` tree, hard-cut wrapper, and legacy
  `agent_projection.rs` event/type surface are not reintroduced; diagnostic IPC
  payloads stay in `models.rs`/`tauri_bridge.rs`, and deterministic
  parser/prompt helpers stay in `desktop-core`.

### Cross-Cutting Feature: Office File Search

Goal: implement `docs/OFFICE_SEARCH_DESIGN.md` Phase A so the agent can extract and search Office/PDF plaintext without embeddings.

Change targets:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `AGENTS.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `.docx`, `.xlsx`, `.xlsm`, and `.pptx` `read` calls return extracted plaintext through stable line serialization.
- `.pdf` search uses `pdf_liteparse` payload-only extraction so the LiteParse banner is not indexed.
- Relay does not reintroduce `office_search`; CDP-facing tool catalog and
  Copilot prompt guidance expose Office/PDF handling through OpenCode-style
  `glob` / `read` instead.
- Office/PDF extraction behavior belongs in OpenCode/OpenWork or its extension
  points, not in a Relay-owned Rust execution crate.

### Cross-Cutting Feature: Agentic Workspace Search

Goal: add a Relay-only read-only orchestration layer above `glob`, `grep`, and
`read` style evidence expansion so
vague local lookup requests start with ranked candidates, snippets, searched
scope, and truncation state instead of relying on the model to manually chain
low-level tools.

Change targets:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- The active search surface stays close to opencode-style low-level tools:
  `glob` for path discovery, `grep` for plaintext/code content, and `read` for
  exact file inspection including extracted Office/PDF text.
- Standard ignore directories such as `.git`, `node_modules`, and `target`,
  plus `.gitignore` patterns, are skipped by default, and
  large/plainly unreadable/binary files do not bloat results.
- `glob` and `grep` emit baseline search telemetry for counts, elapsed time,
  truncation, and failure surfaces; `office_search` is not part of the target
  provider surface.
- Search roots are constrained to the current workspace; paths or symlink
  resolutions that escape the workspace are not read.
- CDP prompt guidance prefers concrete `glob`, `grep`, or `read` calls for
  implementation, related-file, and evidence lookup requests.
- Important conclusions, reviews, edits, comparisons, and recommendations must
  expand relevant search candidates with `read`; search snippets are
  candidate evidence, not a substitute for full-file inspection.
- Deterministic provider/desktop-core coverage verifies low-level search
  behavior.

## Forward-Looking Designs (Not Yet Scheduled)

- `docs/OFFICE_SEARCH_DESIGN.md` — Phase A has source implementation in progress/landed under the Office File Search track above. Future Phase B remains semantic retrieval on top of the extraction cache.

## Out Of Scope

- Broad backend decomposition unrelated to doctor sharing or deterministic harness support.
- Reintroducing upstream claw crates as direct Rust dependencies.
- Reviving workbook / spreadsheet-specific MVP gates.
- Formal installer signing credential setup and public distribution operations.
  The separate Windows installer release workflow exists for unsigned
  prerelease smoke builds and for future Trusted Signing configuration.

## Risks And Mitigations

- Risk: docs drift faster than code changes.
  Mitigation: keep `README.md`, `PLANS.md`, `AGENTS.md`, and `docs/CLAW_CODE_ALIGNMENT.md` synchronized in the same PR as behavior changes.

- Risk: CDP and Edge instability makes parity coverage flaky.
  Mitigation: keep deterministic harnesses local and fixture-driven; reserve launched-app smokes for separate acceptance checks.

- Risk: CI passes while the repo’s documented acceptance path is still broken.
  Mitigation: have CI run the same root commands that the docs prescribe.

- Risk: historical task graphs stay marked complete for removed architecture.
  Mitigation: rewrite `.taskmaster/tasks/tasks.json` around the current product and verification artifacts.
