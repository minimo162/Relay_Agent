# OpenCode/OpenWork Provider Hard-Cut Plan

Date: 2026-04-24

## Decision

Relay_Agent will keep M365 Copilot over Edge CDP as the primary LLM surface, but
will expose it to OpenCode/OpenWork as an OpenAI-compatible provider gateway.
Relay will stop treating its Rust agent runtime or desktop shell as the source
of truth. OpenCode/OpenWork will own UX, sessions, tools, permissions, events,
and workspace runtime behavior.

This is a hard cut. Compatibility with the current Relay tool runtime,
`relay_tool` schema details, legacy session history, and hidden compatibility
tools is not a goal.

Target role split:

```text
M365 Copilot CDP
  LLM surface. Produces assistant text and structured tool-call candidates.

OpenCode/OpenWork
  Product UX and execution substrate. Owns sessions, tools, permissions, MCP,
  plugins, workspace config, events, and tool result state.

Relay_Agent
  OpenAI-compatible provider gateway. Connects OpenCode/OpenWork provider
  requests to M365 Copilot over CDP, normalizes tool calls, and owns
  Copilot-specific diagnostics.
```

## Non-Negotiable Constraints

- Copilot CDP remains the product's primary LLM path.
- OpenCode/OpenWork is used as external OSS execution infrastructure, not
  copied into Relay as another custom runtime.
- Relay does not preserve old runtime contracts for the sake of compatibility.
- Relay does not keep parallel execution sources of truth.
- New behavior must be testable without a live Copilot session wherever the
  failure mode is adapter logic rather than Microsoft UI behavior.

## Target Architecture

```text
OpenCode/OpenWork UX
  |
  v
OpenCode/OpenWork Provider Loop
  - owns session state, tools, permissions, events, and execution
  - sends OpenAI-compatible chat requests to Relay
  - executes returned tool_calls through OpenCode/OpenWork
  |
  v
Relay OpenAI-Compatible Provider Gateway
  - Edge/CDP lifecycle
  - Copilot send/wait/extract
  - structured tool-call extraction and validation
  - constrained repair for malformed required tool turns
  - Copilot-specific diagnostics
  |
  v
M365 Copilot
```

Canonical source of truth:

1. OpenCode/OpenWork session state.
2. OpenCode/OpenWork UX projection of that state.
3. Copilot thread/tab binding as disposable transport state.

Copilot thread history is never the authoritative execution history. If a
Copilot tab is reset or a new chat is opened, Relay reconstructs the next
prompt from OpenCode/OpenWork session state.

## Deletion Targets

The hard cut should remove or quarantine these Relay-owned implementations:

- `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs` as the central
  execution loop.
- `apps/desktop/src-tauri/src/agent_loop/retry.rs` as strategy-level repair.
- Relay-owned file/search/bash/edit execution in `crates/runtime` (deleted).
- Relay-owned tool catalog and metadata in `crates/tools/src/lib.rs` (deleted).
- `office_search` as any model-facing or compatibility execution path.
- Relay-owned permission decision engine, except UI rendering and reply
  forwarding.
- Relay-owned transcript/session source of truth.

The retained Relay-specific code should be:

- Copilot CDP bridge and DOM interaction.
- Copilot response extraction and transport diagnostics.
- Prompt adapter that asks Copilot for OpenCode/OpenWork-compatible tool calls.
- OpenAI-compatible provider facade, diagnostics, and live Copilot smoke
  coverage.
- Transition desktop shell only where still needed for provider launch support
  and diagnostics. Compatibility with the old desktop-owned UX is no longer a
  goal.

## Completed Task: Provider-Only Hard Cut

Implemented on 2026-04-25: removed the remaining compatibility posture around
the diagnostic desktop shell. The OpenAI-compatible provider gateway is now the
product path; Relay desktop behavior is support glue for that path, not a
second UX or execution runtime.

Tasks:

- Make README and package scripts present OpenCode/OpenWork plus
  `start:opencode-provider-gateway` as the first-use route.
- Move desktop launch and smoke commands under `diag:*` diagnostics wording.
- Remove or quarantine old Relay desktop chat/session/execution claims from
  live docs.
- Treat `office_search`, Relay-owned repair strategy, and Relay-owned
  transcript/tool execution as unsupported compatibility leftovers unless they
  are moved into OpenCode/OpenWork extension points.
- Update doctor wording so provider readiness is the canonical health check and
  desktop-shell checks are diagnostic.

Acceptance:

- A new contributor can follow docs without starting the diagnostic desktop
  shell as the main product.
- No production-facing path routes execution through Relay-owned tools,
  permissions, or transcript state.
- Provider gateway checks remain in `pnpm check`.
- Deterministic and live provider smokes remain the acceptance path for the
  M365 Copilot to OpenCode/OpenWork contract.

## Completed Task: Diagnostic Shell Minimization

Implemented on 2026-04-25: shrank the remaining desktop shell to provider
launch support and diagnostics. This was a deletion and isolation task, not a
UX redesign. OpenCode/OpenWork is the product UX; Relay's normal shell no
longer carries parallel chat, session, permission, and tool-result product
surfaces.

Tasks:

- Replace the chat-first desktop landing posture with provider gateway,
  doctor, CDP, M365 sign-in, and OpenCode/OpenWork config status.
- Remove or isolate desktop chat/session stores from the normal UI path.
- Remove or isolate approval cards, write-undo controls, slash-command surfaces,
  MCP registry UI, and transcript rendering from the normal UI path.
- Treat `start_agent` and `continue_agent_session` as diagnostic-only until
  they are deleted.
- Keep provider gateway startup, config installation, doctor, and CDP/M365
  inspection reachable.

Acceptance:

- A user opening the desktop shell sees a provider/diagnostic console, not an
  agent chat app.
- Provider-mode execution continues to happen only through OpenCode/OpenWork.
- Diagnostic commands use `diag:*` names and remain visibly separate from the
  provider acceptance path.
- `pnpm check`, `pnpm check:opencode-provider`, and doctor CLI tests pass.

## Completed Task: Legacy Agent IPC Retirement

Implemented on 2026-04-25: removed legacy Relay chat/session execution commands
from the public Tauri WebView invoke surface and frontend IPC bridge. The Rust
controller modules remain only as internal diagnostic/deletion targets while
the provider gateway path continues through OpenCode/OpenWork.

Retired from public invoke/frontend IPC:

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

Acceptance:

- The desktop WebView cannot invoke Relay-owned chat/session execution as a
  product API.
- Diagnostic shell status, doctor, CDP helpers, provider gateway config, and
  MCP/workspace inspection remain available.
- The hard-cut guard rejects reintroducing retired agent commands to
  `generate_handler!` or `ipc.ts`.

## Completed Task: Agent Command Module Retirement

Implemented on 2026-04-25: deleted the unreachable Tauri wrapper module for
legacy Relay chat/session execution commands. The remaining diagnostic backend
tests and dev-control paths call their internal helpers directly while the
provider gateway path remains OpenCode/OpenWork-owned.

Deleted from the normal command tree:

- `apps/desktop/src-tauri/src/commands/agent.rs`
- `pub mod agent;` in `apps/desktop/src-tauri/src/commands/mod.rs`

Acceptance:

- No Tauri command module can be re-exported for legacy agent execution.
- The public command tree contains diagnostics, CDP, MCP, and workspace support
  only.
- The hard-cut guard rejects recreating the deleted module or module
  declaration.

## Completed Task: Dev-Control Agent Route Retirement

Implemented on 2026-04-25: removed debug-only localhost controls that still
started, continued, or approved Relay-owned agent execution from the desktop
process. Dev-control is now health/state/configuration support only; live
execution validation belongs to the OpenAI-compatible provider smoke.

Retired dev-control routes:

- `POST /start-agent`
- `POST /first-run-send`
- `POST /approve`
- `POST /approve-latest`
- `POST /approve-latest-session`
- `POST /approve-latest-workspace`
- `POST /reject-latest`

Acceptance:

- `dev_control.rs` has no direct `hard_cut_agent` start/continue calls.
- Old desktop live harness package aliases are removed from root and desktop
  `package.json`.
- The hard-cut guard rejects restoring those localhost agent controls or aliases.

## Completed Task: Orphan Desktop Live Harness Retirement

Implemented on 2026-04-25: deleted the old dev-control helper scripts and
desktop-owned M365 live execution harnesses that no longer had package entry
points after the hard cut. Live validation now stays on the provider gateway
smoke and Copilot response probe.

Retired script families:

- `dev-first-run-send.mjs`, `dev-approve-latest*.mjs`, and
  `dev-reject-latest.mjs`.
- `live_m365_desktop_smoke.mjs` and the old Tetris, grounding approval,
  same-session path, workspace search, long-continuity, and heterogeneous-tool
  desktop live smokes.

Acceptance:

- The retired helper and harness files no longer exist under
  `apps/desktop/scripts/`.
- The hard-cut guard rejects recreating those files.
- Provider live commands remain `live:m365:opencode-provider` and
  `live:m365:copilot-response-probe`.

## Milestones

### Phase 0: Hard-Cut Branch Setup

Goal: make it explicit that this track is replacing the current runtime rather
than adding a compatibility layer.

Tasks:

- Remove backend selection from the agent IPC entrypoints. The only supported
  execution backend is OpenCode/OpenWork.
- Keep any old Relay loop helpers out of production routing while they await
  deletion or test rewrite.
- Mark legacy runtime modules with `legacy_runtime` module boundaries so new
  code cannot accidentally import them.
- Add docs truth guards that reject new references to model-facing
  `office_search`, legacy `RelayLegacyBackend`, or "primary execution path:
  Relay Rust runtime".

Acceptance:

- The planned production path has one execution backend: OpenCode/OpenWork.
- No environment variable can route `start_agent` or `continue_agent_session`
  back to Relay's old execution loop.
- Any remaining legacy runtime code is isolated and scheduled for deletion.

### Phase 1: OpenCode/OpenWork Runtime Bootstrap

Goal: Relay can start or attach to OpenCode/OpenWork for the selected workspace
without starting the Relay agent loop.

Tasks:

- Add an OpenCode/OpenWork runtime manager in Tauri.
- Resolve workspace root, runtime base URL, auth token, and server health.
- Prefer OpenWork server as the local execution facade when available.
- Allow a direct OpenCode server fallback only during development if OpenWork
  bootstrapping is not yet ready.
- Expose runtime status to Settings and doctor.

Implementation targets:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/config.rs`
- new `apps/desktop/src-tauri/src/opencode_runtime/**`
- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src/components/SettingsModal.tsx`

Acceptance:

- Selecting a project starts or attaches to an OpenCode/OpenWork runtime.
- Relay can list/create an OpenCode/OpenWork session for that workspace.
- Doctor reports OpenCode/OpenWork health separately from Copilot health.

### Phase 2: OpenCode Session As Source Of Truth

Goal: Relay UI sessions become projections of OpenCode/OpenWork sessions.

Tasks:

- Replace Relay session creation with OpenCode/OpenWork session creation.
- Store only UI selection state and Copilot transport metadata in Relay.
- Subscribe to OpenCode/OpenWork events and render transcript, todos, tool
  parts, status, and permission requests from those events.
- Remove Relay event generation for tool start/result as a source of truth.

Implementation targets:

- `apps/desktop/src/shell/sessionStore.ts`
- `apps/desktop/src/shell/useAgentEvents.ts`
- `apps/desktop/src/components/MessageFeed.tsx`
- `apps/desktop/src/components/ToolCallRow.tsx`
- `apps/desktop/src/components/InlineApprovalCard.tsx`

Acceptance:

- Reloading the app reconstructs the transcript from OpenCode/OpenWork state.
- Copilot tab state loss does not lose tool results or session history.
- The UI does not depend on Relay-owned tool result structs.

### Phase 3: Copilot Prompt And Tool Protocol Rewrite

Goal: Copilot emits OpenCode/OpenWork-compatible tool calls, not Relay runtime
commands.

Tasks:

- Generate Copilot-visible tool catalog from OpenCode/OpenWork tool metadata or
  a small local mirror of that metadata.
- Keep a fenced transport wrapper if needed, but make the payload schema
  OpenCode/OpenWork-shaped.
- Remove `office_search`, Relay-specific repair examples, and domain-specific
  search expansions from prompts.
- Require structured JSON validation before execution.
- Treat unsupported tools as adapter errors, not repair opportunities.

Implementation targets:

- `apps/desktop/src-tauri/src/agent_loop/prompt.rs`
- `apps/desktop/src-tauri/src/agent_loop/response_parser.rs`
- `apps/desktop/src-tauri/binaries/copilot_server.js`

Acceptance:

- A Copilot response can request `read`, `glob`, `grep`, `bash`, or `edit` in
  OpenCode/OpenWork-compatible form.
- The parsed request can be passed to OpenCode/OpenWork without Relay runtime
  execution.
- Parser tests cover valid calls, malformed JSON, unsupported tools, and
  duplicate exact calls.

### Phase 4: Tool Execution Delegation

Goal: Relay stops executing tools itself.

Tasks:

- Forward parsed Copilot tool requests to OpenCode/OpenWork.
- Forward permission requests from OpenCode/OpenWork to Relay UI.
- Forward approval replies back to OpenCode/OpenWork.
- Convert OpenCode/OpenWork tool result parts into the next Copilot prompt
  bundle.
- Delete Relay-owned execution paths for `read`, `glob`, `grep`, `bash`,
  `edit`, and MCP from the new path.

Implementation targets:

- new `apps/desktop/src-tauri/src/opencode_runtime/tool_call.rs`
- `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs` replacement module
- `apps/desktop/src-tauri/crates/runtime/**` deletion
- `apps/desktop/src-tauri/crates/tools/**` deletion

Acceptance:

- End-to-end deterministic test: Copilot fixture emits `read`; OpenCode/OpenWork
  executes it; Relay renders the tool result; next Copilot prompt includes the
  result.
- No new-path code calls Relay `runtime::file_ops`, Relay bash executor, or
  Relay tool registry.

### Phase 5: Copilot Turn Controller Simplification

Goal: Replace Relay's agent loop with a small transport controller.

Tasks:

- Implement a controller with this state machine:

```text
idle
  -> build_prompt_from_opencode_session
  -> send_to_copilot
  -> parse_copilot_reply
  -> if tool_call: execute_via_opencode, append result, continue
  -> if final: append final response, idle
  -> if transport_error: recover Copilot tab, retry same OpenCode-backed prompt
```

- Limit retries to transport/protocol errors:
  malformed JSON, no tool call where one is structurally required, unsupported
  tool, duplicate exact call, Copilot tab failure.
- Remove strategy-level local search repair and Office/PDF repair.
- Remove prompt mutations that try to make Copilot compensate for Relay runtime
  limitations.

Implementation targets:

- Replace most of `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs`.
- Delete or reduce `apps/desktop/src-tauri/src/agent_loop/retry.rs`.
- Keep only transport-oriented tests under `agent_loop`.

Acceptance:

- The turn controller is small enough to audit.
- Strategy and tool execution live in OpenCode/OpenWork, not Relay.
- Duplicate exact tool calls stop with a clear adapter error instead of
  recursive repair.

### Phase 6: OpenCode/OpenWork Feature Surface

Goal: Relay-specific advanced capabilities become OpenCode/OpenWork primitives
instead of runtime patches.

Tasks:

- Move Office/PDF extraction to an OpenCode plugin, OpenWork server feature, or
  MCP server. Do not expose `office_search`.
- Move slash commands, skills, MCP configuration, and workspace config writes
  through OpenWork server APIs.
- Treat PDF/Office support as an extension capability advertised by
  OpenCode/OpenWork, not hard-coded in the Copilot prompt.

Acceptance:

- Relay can show available capabilities from OpenCode/OpenWork.
- Adding/removing skills, plugins, MCP, and Office/PDF support does not require
  changing the Copilot adapter core.

### Phase 7: Legacy Deletion

Goal: remove the old execution system after the hard-cut path is passing.

Delete or archive:

- `apps/desktop/src-tauri/crates/runtime` (deleted)
- `apps/desktop/src-tauri/crates/tools` (deleted)
- Relay-owned `compat-harness` tests that assert old runtime behavior.
- Agent-loop repair tests that only exist for Relay-owned execution quirks.
- Docs that describe Relay's Rust runtime as the primary execution path.

Keep:

- Copilot CDP bridge tests.
- Adapter protocol tests.
- OpenCode/OpenWork runtime health tests.
- UI rendering tests against OpenCode/OpenWork event fixtures.
- Live M365 smoke tests.

Acceptance:

- Root verification passes without Relay runtime crates.
- README states that Relay is a Copilot-to-OpenCode/OpenWork desktop adapter.
- No model-facing compatibility path names `office_search`.

## First Vertical Slice

Build this before deleting large modules:

1. Start or attach to OpenCode/OpenWork for the selected workspace.
2. Create an OpenCode/OpenWork session.
3. Build a Copilot prompt with a minimal `read` tool catalog.
4. Use a deterministic Copilot fixture response that requests `read`.
5. Execute `read` through OpenCode/OpenWork.
6. Render the tool result in Relay UI.
7. Build the next Copilot prompt from OpenCode/OpenWork session state.

This proves the core adapter loop without needing broad tool coverage or a live
M365 session.

## Verification Strategy

Deterministic:

- OpenCode/OpenWork runtime bootstrap unit tests.
- Prompt catalog generation tests.
- Copilot response parser tests.
- Tool forwarding tests with fake OpenCode/OpenWork server.
- UI transcript rendering from OpenCode/OpenWork event fixtures.

Live/opt-in:

- Edge CDP readiness.
- Copilot send/wait/extract.
- Copilot-driven `read` round trip.
- Copilot-driven permission request and approval round trip.

Repository gates:

```bash
pnpm check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
pnpm doctor -- --json
```

## Success Criteria

- OpenCode/OpenWork owns the primary UX, tools, permissions, sessions, events,
  and workspace execution state.
- M365 Copilot remains the LLM behind Relay's OpenAI-compatible provider
  gateway.
- Relay-owned code is concentrated in Copilot transport, OpenAI-compatible
  provider adaptation, diagnostics, and launch/support glue.
- The largest existing sources of bespoke runtime complexity are deleted or
  quarantined from production.
