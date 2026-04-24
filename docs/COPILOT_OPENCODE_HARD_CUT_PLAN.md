# Copilot-Controlled OpenCode/OpenWork Hard-Cut Plan

Date: 2026-04-24

## Decision

Relay_Agent will keep M365 Copilot over Edge CDP as the primary LLM control
path. Relay will stop treating its Rust agent runtime as the execution source
of truth. OpenCode/OpenWork will become the execution substrate for sessions,
tools, permissions, events, and workspace runtime behavior.

This is a hard cut. Compatibility with the current Relay tool runtime,
`relay_tool` schema details, legacy session history, and hidden compatibility
tools is not a goal.

Target role split:

```text
M365 Copilot CDP
  LLM controller. Produces tool requests and final responses.

OpenCode/OpenWork
  Execution substrate. Owns sessions, tools, permissions, MCP, plugins,
  workspace config, events, and tool result state.

Relay_Agent
  Desktop UX and adapter. Connects Copilot CDP to OpenCode/OpenWork, renders
  session state, and owns Copilot-specific diagnostics.
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
Relay Desktop UI
  |
  v
Relay Session Adapter
  - maps UI actions to OpenCode/OpenWork session operations
  - maps OpenCode/OpenWork events to Relay transcript UI
  - stores Copilot tab bindings as transport metadata only
  |
  +--> Copilot Transport Adapter
  |     - Edge/CDP lifecycle
  |     - prompt bundle assembly from OpenCode session state
  |     - Copilot send/wait/extract
  |     - structured tool-call extraction and validation
  |
  +--> OpenCode/OpenWork Execution Adapter
        - session create/continue
        - tool execution
        - permission request/reply
        - SSE/event subscription
        - workspace runtime health
```

Canonical source of truth:

1. OpenCode/OpenWork session state.
2. Relay UI projection of that state.
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
- Desktop UX, settings, diagnostics, and live Copilot smoke coverage.

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

- Relay's production execution path uses OpenCode/OpenWork for tools,
  permissions, sessions, and events.
- M365 Copilot CDP remains the primary LLM controller.
- Relay-owned code is concentrated in desktop UX, Copilot transport, prompt
  adaptation, and diagnostics.
- The largest existing sources of bespoke runtime complexity are deleted or
  quarantined from production.
