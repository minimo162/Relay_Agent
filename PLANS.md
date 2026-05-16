# Relay_Agent Completion Plan

Date: 2026-05-17

## Product Direction

Relay_Agent has moved from a three-mode utility app into a single local
business-agent workbench:

> **Copilot thinks. Relay executes local tools safely.**

The user-facing product should not ask users to choose between `資料を探す`,
`Officeファイルを編集する`, and `コードを書く`. Those are implementation
capabilities, not primary UX modes. The Workbench should expose one
workspace, one task composer, one agent trace, and one result/approval surface.
M365 Copilot chooses which local tools are needed from the user's natural
language request; Relay validates and executes those tools locally.

The product no longer treats AionUi, OpenCode/OpenWork, Codex app-server,
custom Relay run streams, or Tauri as active product architecture. The active
architecture is a **framework-native Agent Framework + AG-UI workbench**:
Microsoft Agent Framework owns agent turns, tool invocation, sessions,
middleware, approvals, and streaming run lifecycle; AG-UI owns the
Workbench-facing event/state/tool/approval protocol; Relay adds only the
minimum adapters needed for M365 Copilot over Edge CDP, local tool function
bodies, workspace policy, packaging, and diagnostics.

The active product target is a **generic Relay Workbench**:

- natural-language task input;
- Copilot-led step planning and tool selection;
- Relay-owned validation, local function bodies, approval policy/audit,
  backups, diffs, and logs around Agent Framework execution;
- generic local tools such as ripgrep-backed search, file read, OfficeCLI, and
  exact file edits;
- AG-UI-first user experience and event protocol, with a minimal visual surface
  and no diagnostic-first clutter.

Framework adoption rule:

- Prefer official Microsoft Agent Framework and AG-UI concepts before adding
  any Relay-owned protocol, schema, event, tool catalog, or workflow state.
- If Agent Framework or AG-UI already has a concept, Relay must use or adapt
  that concept instead of creating a parallel Relay abstraction.
- If a gap exists because M365 Copilot is only reachable through Edge CDP,
  isolate the gap in the Copilot provider adapter or a narrow middleware layer.
  Do not compensate by building a second agent runtime.
- OpenCode, Codex app-server, GitHub Copilot, Claude Code, and AionUi may be
  used only as comparative prior art. They are not runtime substrates, public
  contracts, or naming authorities for Relay's active architecture.

Plan-coherence rule for older sections in this file:

- Any older task text that names Relay-specific run/event contracts,
  `RunEvent`, `RelayTurnState` as the canonical runtime state, OpenCode-
  compatible contracts, or `rg_files`/`rg_search` as public tool names is
  superseded by the framework-native direction in this section.
- Public Workbench traffic must be AG-UI. Public tool/runtime semantics must be
  Agent Framework function/MCP/client tools plus middleware and approvals.
- Legacy names may remain only as internal provider aliases during migration:
  `rg_files` maps to the Agent Framework `glob` function tool, and
  `rg_search` maps to the Agent Framework `grep` function tool. New plan tasks
  must use the canonical names `glob` and `grep`.

Root prevention guarantees:

- This plan can prevent `local tools unavailable`, unnecessary `ask_user`, and
  premature `final` only if those states are made structurally impossible before
  Copilot is called. Prompt wording alone is not an acceptable control.
- `local tools unavailable` prevention:
  - Agent Framework tool registration is the source of truth for local
    capabilities. Run admission must verify that required function tools or
    approved MCP/client tools are registered, enabled, and policy-allowed before
    the Copilot provider call.
  - If the required tool family is missing or blocked, Relay fails the Agent
    Framework run with an AG-UI error before Copilot can answer. Copilot must
    never be asked to explain that local tools are unavailable as a normal
    final answer.
  - Copilot prompts/tool schemas are generated from the actual Agent Framework
    tool inventory and session metadata, not from hand-written static prompt
    text.
- Unnecessary `ask_user` prevention:
  - `ask_user` is an AG-UI client tool / HITL state, not a backend execution
    fallback and not a globally visible action.
  - Agent Framework admission and middleware may expose `ask_user` only when a
    required field is genuinely missing or the user must make a required
    safety/product choice. Known workspace + known objective + available local
    tools means `ask_user` is absent from the model-facing tool set.
  - If Copilot still emits a clarification request outside an allowed
    clarification state, middleware rejects it as a protocol defect and records
    diagnostics; it must not be shown as normal UX.
- Premature `final` prevention:
  - Final assistant output is allowed only when Agent Framework session state
    says terminal criteria are satisfied: required observations exist, required
    reads were performed, required mutations completed or were rejected, and
    pending approvals/clarifications are resolved.
  - Before terminal eligibility, Copilot can only continue through valid
    Agent Framework tool calls, AG-UI client-tool/HITL requests, or a visible
    protocol error. A final-style response while local work is pending is a
    provider/middleware defect, not a user-facing answer.
  - Prevention-clean tests must assert zero guard repairs for normal local
    search, file read, Office edit, and code edit paths. Guard-hit tests remain
    separate regression fixtures.

## Copilot Choice-Error Reduction Design

Research checked on 2026-05-17:

- Microsoft Agent Framework tool guidance says the framework handles the
  tool-calling loop, while tool names/descriptions and registering only the
  needed tools materially affect whether the model selects the right tool.
  Function tools are the right fit for Relay-owned local business logic that
  needs type safety, local resource access, and testability.
- Agent Framework middleware is the official interception point for agent-run,
  function-call, and chat-call validation. Middleware can terminate early for
  validation/security failures, which is the right place to prevent invalid
  local-work turns before Copilot is called.
- Agent Framework + AG-UI HITL guidance uses
  `ApprovalRequiredAIFunction`, approval middleware, and AG-UI client tool
  calls to keep approvals in the framework run instead of custom Relay state.
- AG-UI capabilities allow dynamic discovery of supported tools, state,
  execution limits, and HITL features. AG-UI events include tool-call,
  state-snapshot, state-delta, text, and run-error events that can drive the
  Workbench without a Relay custom run protocol.
- Pydantic AI's AG-UI example is useful prior art because it mixes backend
  agent tools and AG-UI client tools, and demonstrates tools returning AG-UI
  events as part of the stream.
- Magentic-UI is useful product prior art for keeping agents transparent and
  controllable instead of fully autonomous, especially for action-oriented
  local work.

Reference URLs:

- `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/function-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://docs.ag-ui.com/concepts/capabilities`
- `https://docs.ag-ui.com/sdk/js/core/events`
- `https://pydantic.dev/docs/ai/examples/ag-ui/`
- `https://www.microsoft.com/en-us/research/blog/magentic-ui-an-experimental-human-centered-web-agent/`

Design principle:

Relay should not merely catch wrong Copilot choices after the fact. Before each
Copilot provider call, Relay should derive a small **Admissible Action Envelope
(AAE)** from Agent Framework session state, registered tools, AG-UI
capabilities, workspace readiness, and terminal criteria. The AAE is not a new
runtime or a second tool catalog; it is a projection of Agent Framework and
AG-UI state used to narrow Copilot's prompt/tool surface for exactly one step.

The AAE should contain:

- `phase`: `needs_observation`, `needs_exact_read`, `needs_approval`,
  `needs_mutation`, `can_finalize`, `needs_user_input`, or `failed`.
- `allowedActions`: exact tool names, AG-UI client/HITL actions, or `final`.
- `forbiddenActions`: invalid actions for this phase with a short reason.
- `visibleTools`: Agent Framework function tools exposed to Copilot for this
  step.
- `hiddenTools`: registered tools deliberately hidden for this step.
- `terminalCriteria`: the concrete conditions required before `final`.
- `stateId`: stable hash for prompt dumps, AG-UI state, and test assertions.

Policy:

- The Copilot prompt must show only AAE `visibleTools`, never the whole static
  catalog.
- `final` is not a normal option until AAE phase is `can_finalize`.
- `ask_user` is only visible when AAE phase is `needs_user_input`.
- Mutating tools are visible only after enough read/inspection context exists
  to make an approval meaningful; actual execution still uses Agent Framework
  approval primitives.
- `bash` is hidden by default and appears only for explicit verification,
  build, test, git inspection, or user-requested command tasks.
- If AAE cannot produce a safe next action, fail the Agent Framework run with
  AG-UI `RUN_ERROR` before the Copilot provider call.
- Guard repair remains a last-line defect detector. Normal E2E fixtures must
  fail if guard repair was needed.

### Executable Task Queue: Copilot Choice-Error Reduction

1. **CER01: Add an AAE builder derived from framework state.**
   - Status: complete.
   - Scope:
     - Build AAE from Agent Framework run/session metadata, workspace
       readiness, registered tool descriptors, completed tool results,
       pending approvals, and terminal eligibility.
     - Keep the data structure internal to the Copilot adapter/middleware; do
       not expose it as a new public Relay run protocol.
   - Acceptance: local search, exact read, Office inspect/edit, code edit, and
     file creation each produce deterministic AAE phases and allowed actions.
   - Verification: AAE unit/smoke snapshots; `pnpm check`.

2. **CER02: Filter Copilot tool projection from AAE visible tools.**
   - Status: complete.
   - Scope:
     - Replace static prompt tool listing with AAE-filtered tool listing.
     - Add prompt dump assertions for hidden `ask_user`, hidden `bash`, and
       absent `final` before terminal eligibility.
     - Keep all descriptions sourced from Agent Framework function
       registrations.
   - Acceptance: known-objective search prompts expose only search/read/status
     tools; file creation/edit prompts expose mutation tools only when terminal
     policy and approval policy allow them.
   - Verification: prompt-dump fixture tests; `framework-native-prevention`
     smoke; `pnpm check`.

3. **CER03: Move invalid-action prevention into middleware admission.**
   - Status: complete.
   - Scope:
     - Agent-run/chat middleware must compute AAE before Copilot calls.
     - If no legal action exists, terminate with AG-UI `RUN_ERROR` instead of
       asking Copilot to explain the failure.
     - Function-call middleware must verify that each tool call is still
       allowed by the current AAE.
   - Acceptance: missing local tool families, missing workspace, and
     non-terminal final states fail before Copilot-authored final text.
   - Verification: admission smokes for search, read, Office, code, mutation,
     and missing-tool cases; `pnpm check`.

4. **CER04: Publish AAE-derived diagnostics without adding a second run protocol.**
   - Status: complete.
   - Scope:
     - Keep Workbench execution on the official AG-UI endpoint and event
       stream instead of introducing a Relay-specific run wire protocol.
     - Publish AAE snapshots through prompt dumps and support diagnostics so
       tool-choice failures can be correlated with AG-UI run events.
     - Keep raw AAE details behind diagnostics; the user-facing Workbench
       remains driven by AG-UI run/tool/approval/error events.
   - Acceptance: AG-UI run replay still drives the Workbench, while support
     diagnostics can show the AAE phase, visible tools, hidden tools, and
     terminal criteria for each Copilot step.
   - Verification: prompt-dump AAE fixture; support-bundle metrics;
     AG-UI client-tool smoke; browser E2E; `pnpm check`.

5. **CER05: Tighten tool descriptions and schema minimalism.**
   - Status: complete.
   - Scope:
     - Audit every model-visible tool name, description, and parameter schema
       against Agent Framework guidance: concrete purpose, concrete return,
       no vague overlap, no unnecessary parameters for the current phase.
     - Split or hide overloaded operations when they cause poor selection.
     - Keep OfficeCLI breadth behind semantic operations and registry entries,
       not raw argv.
   - Acceptance: tool descriptions explain when to use the tool, when not to
     use it, required parameters, and returned evidence.
   - Verification: catalog snapshot review; golden tool-selection fixtures;
     `pnpm check`.

6. **CER06: Add zero-repair normal-path regression gates.**
   - Status: complete.
   - Scope:
     - Count AAE hidden-tool violations, guard repairs, invalid final
       attempts, and invalid `ask_user` attempts separately.
     - Normal fixtures must assert zero repairs for search, exact read,
       Office inspect/mutation approval, code edit, file creation, and
       verification command tasks.
     - Explicit adversarial fixtures continue to assert visible rejection.
   - Acceptance: Copilot can still be wrong in adversarial fixtures, but normal
     user-like fixtures fail the build if the adapter had to rescue the run.
   - Verification: prevention-clean suite; support-bundle counters; `pnpm
     check`.

7. **CER07: Run live Copilot choice-quality canaries.**
   - Status: complete.
   - Scope:
     - Live signed-in Copilot E2E for local search, exact read, Office
       inspect, Office mutation approval, file creation, code edit, and
       verification.
     - Save prompt dumps, AAE snapshots, AG-UI event logs, and final answers.
   - Acceptance: live canaries complete with no hidden-tool violations, no
     guard repair, no premature final, and no unnecessary `ask_user`.
   - Verification: `pnpm workbench:live-copilot-e2e` plus task-specific live
     canary logs when Edge CDP is available.

## Immediate Task Queue: Relay Protocol State Machine

The live Copilot E2E runs exposed a root reliability issue: M365 Copilot can
still answer as if local tools are unavailable because it only sees local tools
through Relay's Copilot adapter, not as native Microsoft 365 UI tools. Prompt
wording and one-off repair rules are not enough. The active fix is to make
Agent Framework and AG-UI own the deterministic turn/session/event protocol,
while Relay contributes only the Copilot transport adapter, local function
bodies, policy middleware, and diagnostics. Copilot remains responsible for
reasoning, query expansion, summaries, and choosing among the Agent Framework
tools available for the current session state.

The completed RPSM01-RPSM07 slice added the first state-machine safety net.
That is necessary, but it is not the final design. The product target is
**prevention first**: Relay should shape the Copilot turn so invalid responses
are not natural to produce in the first place. `tools unavailable`, unnecessary
`ask_user`, and premature `final` should be treated as design failures in the
prompt/action contract, not normal outputs that the guard routinely catches.

The guard remains only as a last line of defense. The primary path should be:

1. Agent Framework middleware admits the run before each Copilot provider call.
2. Agent Framework exposes only tools valid for the session state.
3. AG-UI state/capability events expose the same valid next actions to the UI.
4. Relay function tools supply required safe local observations before Copilot
   is asked for a conclusion.
5. If Copilot still violates the contract, Relay fails the Agent Framework run
   visibly and the adapter/tool/middleware contract is fixed; it should not
   silently compensate with an unrelated fallback.

1. **RPSM01: Capture protocol-state baseline and failure taxonomy.**
   - Status: completed 2026-05-17.
   - Goal: define the exact failure classes the state machine must prevent.
   - Changes:
     - Document observed failures such as `tools_unavailable_final`,
       `ask_user_after_known_objective`, `final_before_required_tool`,
       `mutation_final_without_mutation`, `bash_cat_instead_of_read`,
       `directory_keyword_glob`, and `lost_original_request_after_tool`.
     - Map each failure class to an expected Relay state transition and a
       regression test or live E2E artifact.
     - Record the taxonomy in `docs/IMPLEMENTATION.md` and, where useful,
       `docs/AGENT_EVALUATION_CRITERIA.md`.
   - Acceptance: every known live Copilot protocol failure has a named class,
     expected behavior, and planned verification.
   - Verification: `git diff --check`.

2. **RPSM02: Introduce a typed Relay turn-state contract.**
   - Status: completed 2026-05-17.
   - Goal: keep the run objective, local-work intent, tool history, approval
     state, and completion rules outside fragile prompt text.
   - Changes:
     - Add a small sidecar contract such as `RelayTurnState` with original user
       request, workspace, inferred local intent, required next capability,
       completed tool calls, pending approval/mutation state, pending output
       target, and terminal eligibility.
     - Derive initial state from the Workbench/AG-UI run input and update it
       after every Copilot response and local tool observation.
     - Keep the state serializable enough for diagnostics and regression
       fixtures.
   - Acceptance: a tool-result-only continuation still carries the original
     objective and knows whether final output is allowed.
   - Verification: sidecar unit/smoke coverage plus `pnpm check`.

3. **RPSM03: Add a protocol guard for Copilot responses.**
   - Status: completed 2026-05-17.
   - Goal: validate Copilot output against the current turn state before the UI
     or executor sees it.
   - Changes:
     - Reject or repair invalid `final`, `ask_user`, and unsupported tool
       choices according to state.
     - Convert known mechanical mistakes only when deterministic, such as
       `bash cat <file>` to `read` and directory-style keyword glob patterns to
       filename-oriented globs.
     - Surface non-deterministic violations as protocol errors with prompt and
       response dumps, rather than trying unrelated fallback paths.
   - Acceptance: `tools unavailable` cannot reach the user as a final answer
     while a local tool is required.
   - Verification: protocol regression tests plus live Copilot smoke.

4. **RPSM04: Move initial local-tool selection into Relay policy.**
   - Status: completed 2026-05-17.
   - Goal: make the first local action deterministic while still letting
     Copilot reason over observations afterward.
   - Changes:
     - For local file search, Relay starts with bounded `glob`/`rg_files` and
       optional `grep` policy based on the user request and workspace.
     - For exact local files, Relay starts with `read`.
     - For Office edits, Relay starts with OfficeCLI readiness/capability or
       workbook inspection before allowing mutation planning.
     - For code work, Relay starts with workspace status and file discovery
       before edits.
   - Acceptance: local-work runs never depend on Copilot deciding that local
     tools exist on the first turn.
   - Verification: deterministic planner tests and live file-search/code-work
     E2E.

5. **RPSM05: Centralize stateful prompt building.**
   - Status: completed 2026-05-17.
   - Goal: keep Copilot prompts concise but complete on every continuation.
   - Changes:
     - Generate prompt sections from `RelayTurnState`: original request,
       current objective, available local tools for this state, completed tool
       observations, required next action, and terminal criteria.
     - Remove duplicated or stale prompt fragments that can cause Copilot to
       echo the prompt or ignore the active objective.
     - Keep prompt dumps tied to run id and state version for reproducibility.
   - Acceptance: after a tool result, Copilot receives the original request and
     cannot reasonably ask what task it should perform next.
   - Verification: prompt fixture tests and live Copilot continuation E2E.

6. **RPSM06: Add protocol regression and live E2E coverage.**
   - Status: completed 2026-05-17.
   - Goal: make the state machine measurable before removing old guards.
   - Changes:
     - Add non-live tests for invalid finals, invalid asks, unsupported tools,
       mutation-without-approval, search continuation, and exact file read.
     - Promote the useful live file-search scenario from temporary script to a
       tracked smoke script if it can run without leaking user data.
     - Record expected artifacts in `docs/IMPLEMENTATION.md`.
   - Acceptance: `pnpm check` covers the deterministic protocol layer; live
     Copilot E2E covers at least one search and one file-writing workflow.
   - Verification: `pnpm check`; `pnpm workbench:live-copilot-e2e`; tracked
     live search smoke when available.

7. **RPSM07: Remove replaced ad hoc prompt guards.**
   - Status: completed 2026-05-17.
   - Goal: keep the final implementation understandable and prevent two
     competing protocol systems.
   - Changes:
     - Replace scattered regex and prompt-only fixes in the Copilot bridge with
       calls into the state machine, protocol guard, and initial-tool policy.
     - Keep only small deterministic normalizers that have tests and are called
       from the guard layer.
     - Update README/AGENTS/implementation notes if user-visible behavior or
       debugging instructions change.
   - Acceptance: the local-tool protocol is enforced in one obvious place, with
     no hidden fallback runner or duplicated legacy path.
   - Verification: `pnpm check`; live Copilot search and file-writing E2E;
     `git diff --check`.

### Framework-Native Prevention Queue

These tasks correct the design direction after RPSM01-RPSM07. They should be
implemented before adding more feature breadth. The goal is to make invalid
Copilot actions unlikely by construction, not merely intercepted after the
fact.

Research checked on 2026-05-17:

- Microsoft Agent Framework workflows distinguish LLM-driven agents from
  explicitly defined workflows, and support typed executors, conditional
  routing, events, checkpointing, and HITL.
- Microsoft Agent Framework tools expose explicit function schemas, can hide
  runtime-only context from model-visible parameters, and support
  declaration-only tools when execution is supplied by the application.
- Microsoft Agent Framework middleware provides the official interception
  points for run-level, function-call, and chat-call validation, telemetry, and
  policy.
- The Agent Framework + AG-UI HITL pattern routes sensitive actions through
  approval events instead of letting the model directly execute them.
- AG-UI defines streaming lifecycle, state, activity, and tool-call events, and
  its capabilities model lets the UI adapt to the tools and state an agent
  actually supports at runtime.
- Microsoft's Agent Framework samples and DevUI examples structure advanced
  features as agents, tools, RAG/file-search, workflows, tracing/evaluation,
  and DevUI-compatible entities rather than a separate app-specific run
  protocol.
- Prior AG-UI integrations such as Pydantic AI demonstrate the same pattern:
  keep the backend agent/framework-specific, then expose it through AG-UI
  events and tools for the frontend.

Reference URLs:

- `https://learn.microsoft.com/en-us/agent-framework/workflows/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/function-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/`
- `https://github.com/microsoft/Agent-Framework-Samples`
- `https://learn.microsoft.com/en-us/agent-framework/devui/samples`
- `https://docs.ag-ui.com/concepts/events`
- `https://docs.ag-ui.com/concepts/tools`
- `https://docs.ag-ui.com/concepts/capabilities`
- `https://docs.ag-ui.com/concepts/state`
- `https://docs.ag-ui.com/concepts/middleware`
- `https://pydantic.dev/docs/ai/examples/ag-ui/`

Design correction from that research:

- Relay should stop growing a Relay-owned run protocol. The canonical run
  lifecycle should be Agent Framework `Agent` / `AgentSession` /
  tool-middleware state projected to AG-UI lifecycle, tool, state, approval,
  and error events.
- Local work should be represented as Agent Framework functions, approval
  wrappers, middleware, and, only when the sequence is truly fixed, Workflow
  executors/edges. Relay-specific state should be a projection/cache of that
  canonical framework state, not the authority.
- Copilot remains the reasoning controller through a custom Agent
  Framework-compatible chat provider. That provider is the only place where
  Relay compensates for M365 Copilot's non-API browser transport.
- AG-UI state/capability events should describe valid next actions to the UI;
  the model-facing tools should come from the same Agent Framework tool set and
  middleware decisions, not from a parallel prompt-only catalog.
- The prompt guard remains a last-line invariant. Guard hits in normal
  scenarios are bugs in the Agent Framework tool registration, middleware,
  AG-UI projection, or Copilot provider adapter.

1. **PFP01: Move run admission into Agent Framework middleware.**
   - Status: complete.
   - Goal: prevent generic Copilot chat turns without introducing a parallel
     Relay runtime.
   - Changes:
     - Implement admission as Agent Framework run/chat middleware that validates
       workspace, objective, session, available tools, and policy before the
       Copilot provider is called.
     - Store admission metadata in Agent Framework session/context metadata and
       AG-UI state snapshots, not in a separate Relay-only run-state authority.
     - Fail the Agent Framework run with an AG-UI error event if admission
       cannot determine a safe local-work context.
   - Acceptance: every local-work prompt dump and AG-UI state snapshot has the
     same Agent Framework session/run identity; no prompt is emitted outside an
     admitted Agent Framework run; missing local tools fail before Copilot is
     called and never become a Copilot-authored final answer.
   - Verification: middleware fixture tests for search, exact read, Office
     edit, code edit, missing workspace, and ambiguous destructive intent;
     `pnpm check`.

2. **PFP02: Use Agent Framework tools as the single model-facing catalog.**
   - Status: complete.
   - Goal: remove Relay's separate action schema as a competing tool system.
   - Changes:
     - Register local capabilities as Agent Framework function tools or
       approved MCP tools with typed schemas and descriptions.
     - Use Agent Framework middleware to filter or terminate unavailable tools
       by session state instead of maintaining an independent Relay
       prompt-only catalog.
     - Use AG-UI client tools only for user-facing interaction such as approval
       or clarification, following the AG-UI tool/HITL pattern.
     - Keep any Copilot JSON repair limited to adapting browser text into
       Agent Framework-compatible tool calls; it must not define a second
       product contract.
   - Acceptance: there is one exported tool inventory, derived from Agent
     Framework registrations and AG-UI client tools; prompt dumps cannot name a
     tool absent from that inventory; `ask_user` is absent unless the admitted
     state explicitly requires clarification.
   - Verification: Agent Framework tool inventory snapshots; AG-UI capability
     snapshots; live Copilot search/code E2E.

3. **PFP03: Project Agent Framework state to AG-UI state/capabilities.**
   - Status: complete.
   - Goal: make UI state and model state share the same source of truth.
   - Changes:
     - Emit AG-UI `STATE_SNAPSHOT` and `STATE_DELTA` from Agent Framework
       session/run metadata, tool observations, pending approvals, artifacts,
       and terminal state.
     - Use AG-UI capabilities to expose supported tool families, HITL support,
       streaming support, and state support to the Workbench.
     - Remove Workbench dependencies on Relay-only run-state fields where an
       AG-UI event/state field can express the same fact.
   - Acceptance: the main Workbench UI can be reconstructed from AG-UI
     lifecycle/text/tool/state/error events plus capabilities, without a Relay
     custom run event union; the UI can determine whether the run is
     non-terminal, waiting for HITL, failed, or final from AG-UI state alone.
   - Verification: AG-UI replay fixture; browser E2E from recorded AG-UI
     events; `pnpm check`.

4. **PFP04: Use Agent Framework approval primitives for mutations.**
   - Status: complete.
   - Goal: remove custom approval state machines from normal mutation flow.
   - Changes:
     - Wrap write/edit/apply-patch/Office mutation functions with Agent
       Framework approval primitives such as `ApprovalRequiredAIFunction` or
       `approval_mode="always_require"` where applicable.
     - Convert approval requests to AG-UI client-tool or HITL events using the
       official Agent Framework AG-UI integration path where available.
     - Resume the same Agent Framework session with the approval response.
       Relay may persist an audit copy, but that copy is not the runtime source
       of truth.
   - Acceptance: a mutation can pause, render approval, approve/reject, resume,
     and complete using Agent Framework + AG-UI approval flow without the old
     Relay approval stream.
   - Verification: approval smoke for exact text edit and OfficeCLI mutation;
     `pnpm check`.

5. **PFP05: Express deterministic local sequences as workflows only when real.**
   - Status: complete.
   - Goal: use Agent Framework workflows for fixed business processes without
     turning every task into a custom Relay planner.
   - Changes:
     - Keep open-ended work as Agent Framework agents with tools.
     - Use Workflow executors/edges only for fixed sequences such as
       `inspect Office file -> propose mutation -> approval -> execute ->
       verify`, or `discover files -> read selected evidence -> summarize`.
     - Document each workflow's entry condition, exit condition, approval
       point, and emitted AG-UI state before implementation.
   - Acceptance: no new Relay scheduler or mini-workflow engine is added; fixed
     local sequences are either Agent Framework workflows or ordinary
     agent+tool runs.
   - Verification: workflow admission matrix; workflow smoke if a workflow is
     implemented; `pnpm check`.

6. **PFP06: Move prevention checks into middleware and tests.**
   - Status: complete.
   - Goal: turn `tools unavailable`, premature `final`, and unnecessary
     `ask_user` into framework-level test failures instead of prompt folklore.
   - Changes:
     - Implement run/chat/function middleware that records tool availability,
       local-observation requirements, approval requirements, and terminal
       eligibility.
     - Fail prevention-clean tests if the Copilot provider emits a response
       that bypasses required Agent Framework tool/approval flow.
     - Keep prompt repair only as a compatibility adapter for M365 Copilot's
     browser transport, with counters proving it is not the normal path.
   - Acceptance: deterministic smokes assert zero guard replacements for normal
     local search, file creation, Office inspect, and code edit paths; explicit
     fixtures prove `local_tools_unavailable_final`, unnecessary `ask_user`,
     and premature `final` are rejected before user-visible completion.
   - Verification: Agent Framework middleware tests; AG-UI replay tests;
     `pnpm check`.

7. **PFP07: Add live Copilot framework-native acceptance.**
   - Status: complete.
   - Goal: prove the official-framework path works with real signed-in M365
     Copilot.
   - Changes:
     - Store prompt/response dumps and AG-UI event logs for live local search,
       exact read, Office inspect/mutation approval, and file-creation canaries.
     - Assert each live run uses Agent Framework session/tool/approval flow and
       emits replayable AG-UI events.
     - Treat missing official-framework projection, Copilot transport drift,
       or invalid schema as a failing run requiring code changes.
   - Acceptance: live Copilot can complete the local-work canaries through the
     Agent Framework + AG-UI path without falling back to a Relay custom run
     protocol.
   - Verification: `pnpm workbench:live-copilot-e2e` plus tracked live
     local-work E2E when signed-in Edge CDP is available.

### Executable Task Queue: Framework-Native Prevention Cutover

This is the implementation breakdown for the framework-native prevention plan
above. Execute in order unless a task explicitly states that it can run in
parallel. Each task must leave an artifact and a verification entry in
`docs/IMPLEMENTATION.md` before it can be marked complete.

1. **FNP00: Capture the current framework/protocol baseline.**
   - Status: complete.
   - Goal: make the migration measurable before code changes.
   - Scope:
     - Inventory the active Agent Framework registrations, local tool function
       names, AG-UI event endpoints, Relay-only run/event fields, Copilot prompt
       builders, and guard/repair counters.
     - Mark each item as `keep`, `replace-with-framework`, `adapter-only`, or
       `remove`.
   - Artifact: `docs/FRAMEWORK_NATIVE_CUTOVER.md` with the baseline matrix.
   - Acceptance: the matrix identifies every active path that can still emit
     `local tools unavailable`, unnecessary `ask_user`, or premature `final`.
   - Verification: `git diff --check`; `pnpm check` if code fixtures are added.

2. **FNP01: Add Agent Framework run-admission middleware.**
   - Status: complete.
   - Goal: stop invalid local-work runs before the Copilot provider is called.
   - Scope:
     - Add middleware that validates workspace, user objective, session id,
       enabled tool families, policy scope, and whether a local observation or
       approval is required.
     - Persist admission state in Agent Framework session/context metadata and
       project it to AG-UI state.
     - If required local tools are missing, fail with an AG-UI error before
       calling Copilot.
   - Acceptance: missing `glob`/`grep`/`read`/OfficeCLI/edit tools cannot become
     a Copilot-authored final answer.
   - Verification: admission unit tests for search, exact read, Office edit,
     code edit, missing workspace, and missing tool family; `pnpm check`.

3. **FNP02: Make Agent Framework tool registration the single catalog.**
   - Status: complete.
   - Goal: remove the separate Relay prompt-only tool catalog as a source of
     truth.
   - Scope:
     - Export one tool inventory from Agent Framework function tools plus AG-UI
       client tools.
     - Ensure prompt projection, support bundles, AG-UI capabilities, and tests
       all read from that inventory.
     - Keep legacy provider names only behind descriptors; public names are
       `glob`, `grep`, `read`, `officecli`, `officecli_mutate`, `edit`,
       `write`, `apply_patch`, `workspace_status`, `diff`, `bash`, and AG-UI
       `ask_user`.
   - Acceptance: no prompt or AG-UI capability can mention a tool absent from
     Agent Framework registration.
   - Verification: tool inventory snapshot test; AG-UI capability snapshot
     test; `pnpm check`.

4. **FNP03: Convert `ask_user` into a state-scoped AG-UI client tool.**
   - Status: complete.
   - Goal: make unnecessary clarification structurally unavailable.
   - Scope:
     - Remove `ask_user` from the global backend tool set.
     - Expose it only as an AG-UI client/HITL tool when admission middleware
       marks required clarification as valid.
     - Add middleware rejection for clarification attempts outside that state.
   - Acceptance: known workspace + known objective + available local tools
     produces no model-visible `ask_user`.
   - Verification: prompt/tool snapshot tests for search, Office edit, code
     edit, and missing-workspace clarification; `pnpm check`.

5. **FNP04: Add terminal-eligibility middleware.**
   - Status: complete.
   - Goal: prevent premature final answers while local work is pending.
   - Scope:
     - Track required observations, required exact reads, pending approvals,
       mutation completion/rejection, and tool errors in Agent Framework session
       metadata.
     - Reject final-style Copilot responses until terminal criteria are true.
     - Emit AG-UI state updates for `non_terminal`, `waiting_for_tool`,
       `waiting_for_approval`, `failed`, and `terminal`.
   - Acceptance: a final answer cannot reach the Workbench before required
     local observations or approval outcomes exist.
   - Verification: middleware tests for file search, exact read, Office
     mutation, code edit, and failed tool preflight; AG-UI replay test;
     `pnpm check`.

6. **FNP05: Project Agent Framework state to AG-UI state and capabilities.**
   - Status: complete.
   - Goal: remove Relay-only state from the main Workbench path.
   - Scope:
     - Emit `STATE_SNAPSHOT` / `STATE_DELTA` from Agent Framework session/run
       metadata and tool observations.
     - Emit AG-UI capabilities for streaming, tools, state, HITL, and supported
       local tool families.
     - Update Workbench rendering to use AG-UI state/capability data for main
       status, tool activity, approval state, and final output.
   - Acceptance: a recorded AG-UI event stream can replay the visible run
     without custom Relay run-event fields.
   - Verification: AG-UI replay fixture; browser E2E from recorded events;
     `pnpm check`.

7. **FNP06: Cut mutating tools to Agent Framework approval primitives.**
   - Status: complete.
   - Goal: remove the custom approval stream from normal mutation flow.
   - Scope:
     - Wrap `edit`, `write`, `apply_patch`, and `officecli_mutate` using Agent
       Framework approval primitives.
     - Project approval requests to AG-UI HITL/client-tool events.
     - Resume the same Agent Framework session with approve/reject responses and
       keep Relay backups/diffs/audit records as side effects.
   - Acceptance: approve/reject for text edit and Office mutation works without
     the old Relay custom approval path.
   - Verification: approval smoke for text edit; approval smoke for
     OfficeCLI mutation; AG-UI event replay; `pnpm check`.

8. **FNP07: Convert remaining local-tool observations to Agent Framework
   function results.**
   - Status: complete.
   - Goal: make local observations part of the framework run, not a separate
     Relay continuation system.
   - Scope:
     - Ensure `glob`, `grep`, `read`, `officecli`, `workspace_status`, `diff`,
       and bounded `bash` return typed Agent Framework function results.
     - Keep output caps, path redaction, evidence states, and artifact ids in
       result payloads and AG-UI state.
     - Remove any remaining Workbench dependency on a Relay-only observation
       channel for these tools.
   - Acceptance: Copilot continuation receives observations through Agent
     Framework tool results, and the UI receives them through AG-UI events/state.
   - Verification: golden smokes for `glob -> read`, `grep -> read`,
     `read -> edit -> diff`, Office inspect, and bounded test command;
     `pnpm check`.

9. **FNP08: Define workflow admission criteria and implement only proven
   workflows.**
   - Status: complete.
   - Goal: use Agent Framework workflows where sequences are fixed, without
     inventing a Relay scheduler.
   - Scope:
     - Add a workflow admission matrix for open-ended agent runs vs fixed
       workflows.
     - Define entry/exit/approval/state emissions for any implemented workflow.
     - Start with at most two fixed workflows if justified by current usage:
       Office mutation flow and evidence-backed file summary flow.
   - Acceptance: no new workflow can be added without documented entry/exit
     criteria and AG-UI state emissions.
   - Verification: workflow admission matrix in
     `docs/FRAMEWORK_NATIVE_CUTOVER.md`; workflow smoke only if implemented;
     `pnpm check`.

10. **FNP09: Add prevention-clean and guard-regression test suites.**
    - Status: complete.
    - Goal: prove the three failure classes are structurally blocked.
    - Scope:
      - Create prevention-clean fixtures that must produce zero guard repairs
        for normal search, exact read, Office edit, code edit, and file
        creation.
      - Create explicit guard-regression fixtures for
        `local_tools_unavailable_final`, unnecessary `ask_user`, premature
        `final`, unsupported tool, and final-before-approval.
      - Add counters to support bundles and test output.
    - Acceptance: normal paths fail the test if they require guard repair;
      regression paths fail before user-visible completion.
    - Verification: prevention-clean suite; guard-regression suite;
      `pnpm check`.

11. **FNP10: Run live Copilot framework-native E2E.**
    - Status: complete.
    - Goal: verify the design against real M365 Copilot, not only fixtures.
    - Scope:
      - Run live canaries for local file search, exact file read, Office
        inspect/mutation approval, and file creation/code edit.
      - Save prompt dumps, Copilot response dumps, Agent Framework session/tool
        logs, AG-UI event logs, and screenshots where applicable.
      - Treat any `local tools unavailable`, unnecessary `ask_user`, premature
        `final`, schema drift, send failure, or response extraction failure as a
        blocking defect.
    - Acceptance: live canaries complete through Agent Framework + AG-UI with
      zero prevention-clean guard repairs.
    - Verification: `pnpm workbench:live-copilot-e2e`; tracked live local-work
      E2E artifacts; `git diff --check`.

12. **FNP11: Remove superseded Relay-only protocol paths and update docs.**
    - Status: complete.
    - Goal: prevent future contributors from reusing old custom paths.
    - Scope:
      - Remove or clearly quarantine Relay-only run streams, custom approval
        paths, stale prompt-only catalogs, and old protocol guard entry points
        superseded by Agent Framework/AG-UI.
      - Update `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`,
        `docs/AGENT_EVALUATION_CRITERIA.md`, and support-bundle documentation.
      - Keep the hard-cut guard aligned with the new canonical architecture.
    - Acceptance: docs and active code agree that Agent Framework + AG-UI is
      the only run/event/tool protocol, with Relay-specific code limited to the
      Copilot adapter, local function bodies, policy, packaging, and diagnostics.
    - Verification: `node scripts/check-hard-cut-guard.mjs`; `pnpm check`;
      `git diff --check`.

## UI/UX Direction

The Workbench must feel like a focused professional work surface, not a
general chat demo, dashboard, or diagnostics console. The visual goal is:

> **A spacious, quiet agent workbench where the user sees only the next useful
> action, the current agent state, and the evidence needed to trust a result.**

Design principles:

- **Maximize whitespace as structure.** Use generous page margins, vertical
  rhythm, and a narrow reading/composition width before adding borders, cards,
  or explanatory panels. Empty space is the primary grouping tool.
- **One primary path.** Keep one workspace selector, one task composer, one
  visible run state, one result area, and one approval/diff surface. Do not
  reintroduce separate `資料を探す`, `Officeファイルを編集する`, or `コードを書く`
  modes as top-level UX.
- **Progressive disclosure only.** Diagnostics, raw AG-UI payloads, support
  bundle facts, tool JSON, and implementation detail belong behind collapsed
  `Details` or support export surfaces. They must not compete with the main
  work area.
- **Concise state over explanatory copy.** Prefer short labels such as
  `Ready`, `Running`, `Waiting`, `Done`, `Failed`, and `Stopped` plus visible
  activity rows. Avoid permanent instructional text that explains the product
  instead of helping the current task.
- **Beautiful minimalism, not sparse incompleteness.** The UI may be quiet, but
  it must still show agent progress, tool calls, approvals, errors, final
  answers, and diff/backup consequences clearly.
- **Trust through restraint.** Use a professional warm-light default theme,
  subtle borders, restrained shadows, Inter typography, and the existing
  `--ra-*` token system in `apps/workbench/src/styles.css`. Avoid playful
  visuals, emoji icons, AI purple/pink gradients, marketing hero layouts,
  decorative blobs, and card-heavy dashboard chrome.
- **Stable interaction.** Buttons, inputs, approvals, and result rows must have
  fixed dimensions or responsive constraints so text, loading states, hover
  states, and icons do not shift layout.
- **Accessibility is part of the aesthetic.** Inputs need real labels, dynamic
  run updates need `aria-live`, keyboard focus must remain visible, and reduced
  motion must be respected. Minimal UI is not allowed to hide focus, status, or
  errors.

Surface budget:

| Surface | Visible by default | Hidden by default |
| --- | --- | --- |
| Header | Product mark/name and compact readiness pill | version/build diagnostics |
| Composer | Workspace path, task input, send/stop action | provider internals |
| Activity | short agent/tool/status rows | raw payload, full traces |
| Result | final answer or error summary | support-only metadata |
| Approval | action summary, target, approve/reject | raw tool arguments |
| Details | collapsed entry point | raw AG-UI events, status JSON |

Acceptance criteria for future UI work:

- First paint shows a calm Workbench, not a setup/debug screen, when the sidecar
  is reachable.
- A new user can identify the workspace, write a task, and send it without
  reading explanatory blocks.
- During a run, the user can distinguish thinking/executing, waiting for
  approval, failed, stopped, and completed states without opening details.
- Result and approval surfaces preserve enough evidence to trust the action
  while keeping raw JSON and local diagnostics out of the primary view.
- The layout remains polished at 375px, 768px, 1024px, and 1440px without
  horizontal scroll, overlapping text, or layout jumps.
- Every UI change that affects the primary flow should update
  `scripts/workbench-ux-e2e.mjs` or an equivalent visual/behavioral check.

### Executable Task Queue: Workbench UI/UX Refinement

These tasks convert the UI/UX direction into implementable work. They should be
done in order because each task narrows the visible surface before the next one
polishes interaction detail. Do not add new product modes or diagnostic-first
surfaces while executing this queue.

1. **WBUX01: Capture the current Workbench UX baseline.**
   - Status: completed 2026-05-16.
   - Goal: make the current state measurable before visual changes.
   - Changes:
     - Run the existing Workbench UX E2E flow and keep the generated
       screenshots as the comparison baseline.
     - Add a short baseline note to `docs/IMPLEMENTATION.md` covering first
       paint, composer, activity, result, approval, details, and mobile risk.
     - Identify any visible explanatory or diagnostic text that should move
       behind disclosure in later tasks.
   - Acceptance: baseline screenshots and notes exist before style changes.
   - Verification: `pnpm workbench:ux-e2e`; `git diff --check`.

2. **WBUX02: Refine visual tokens and whitespace layout.**
   - Status: completed 2026-05-16.
   - Goal: make the Workbench spacious, quiet, and professional at the token
     and layout level.
   - Changes:
     - Update `apps/workbench/src/styles.css` spacing, shell width, section
       rhythm, typography scale, border strength, and shadow usage through
       `--ra-*` tokens and local utilities.
     - Reduce dense card framing; keep cards only where they frame an actual
       tool surface such as composer, result, approval, activity, or details.
     - Preserve warm-light default theme and avoid decorative gradients, blobs,
       emoji icons, and dashboard-like chrome.
   - Acceptance: first paint reads as a calm work surface with clear hierarchy
     and no crowded panels.
   - Verification: `pnpm workbench:ux-e2e`; screenshots at desktop and mobile
     widths; `pnpm check`.

3. **WBUX03: Simplify composer and first-run surface.**
   - Status: completed 2026-05-16.
   - Goal: keep only the minimum visible controls needed to start work.
   - Changes:
     - Review `apps/workbench/src/App.tsx` composer/header copy and remove
       permanent explanatory text that is not needed for the current action.
     - Keep workspace, task input, readiness, refresh, and send/stop controls.
     - Keep workspace history compact and non-dominant.
     - Ensure first-run/limited states show concise errors without exposing raw
       provider internals by default.
   - Acceptance: a new user can choose or confirm workspace, type a task, and
     send without reading instructions.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

4. **WBUX04: Improve activity and result hierarchy.**
   - Status: completed 2026-05-16.
   - Goal: make agent progress and final output obvious without turning the UI
     into a log viewer.
   - Changes:
     - Rework activity rows so status, tool calls, approval waits, failures,
       cancellation, and completion have short, scannable labels.
     - Keep final answer/error summary visually above raw activity details.
     - Move raw AG-UI payloads and verbose traces behind the existing collapsed
       details surface.
   - Acceptance: users can distinguish `Running`, `Waiting`, `Failed`,
     `Stopped`, and `Done` without opening details.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

5. **WBUX05: Refine approval, diff, and evidence surfaces.**
   - Status: completed 2026-05-16.
   - Goal: make risky actions understandable without showing raw tool JSON by
     default.
   - Changes:
     - Improve the approval card hierarchy for operation, target, consequence,
       backup/diff pointers when available, and approve/reject controls.
     - Keep raw arguments collapsed.
     - Ensure mutating actions never execute before approval and that rejection
       is visibly non-destructive.
   - Acceptance: the user can understand what will change and can reject it
     confidently from the primary surface.
   - Verification: `pnpm workbench:ux-e2e`; approval/rejection assertions;
     `pnpm check`.

6. **WBUX06: Complete responsive and accessibility pass.**
   - Status: completed 2026-05-16.
   - Goal: make the minimal UI usable and polished across desktop and mobile.
   - Changes:
     - Verify layout at 375px, 768px, 1024px, and 1440px.
     - Ensure labels use `htmlFor`, dynamic updates use `aria-live`, keyboard
       focus is visible, click targets are stable, and reduced motion is
       respected.
     - Prevent horizontal scroll, overlapping text, layout shifts, and
       truncated critical labels.
   - Acceptance: primary task execution remains comfortable on small and large
     screens with keyboard and screen-reader basics intact.
   - Verification: `pnpm workbench:ux-e2e`; targeted accessibility assertions
     or documented manual checks; `pnpm check`.

7. **WBUX07: Lock the refined UX with acceptance artifacts.**
   - Status: completed 2026-05-16.
   - Goal: prevent regressions back to cluttered or diagnostic-first UI.
   - Changes:
     - Update `scripts/workbench-ux-e2e.mjs` assertions for first paint,
       visible surface budget, run-state clarity, approval clarity, collapsed
       details, and responsive screenshots.
     - Record the final screenshots and verification commands in
       `docs/IMPLEMENTATION.md`.
     - Add any necessary guard text to `PLANS.md` if implementation reveals a
       recurring anti-pattern.
   - Acceptance: future UI regressions fail automated checks or have an
     explicit documented reason.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`; `git diff --check`.

## Architecture

- Chosen UI shell: AG-UI-first browser-hosted local web workbench served by the
  Relay sidecar. The final product must not depend on Tauri IPC, WebView
  behavior, or Tauri packaging. Existing Workbench code may be reused only when
  it conforms to the AG-UI client/event model and the AG-UI-inspired visual
  interaction model.
- Backend adoption policy: Microsoft Agent Framework is the target production
  backend agent runtime, not merely a reference design. Relay should use the
  .NET Agent Framework agent, tool, approval, session, middleware, and
  streaming model as the main run harness. The Relay-owned custom runner is a
  transitional implementation detail to be removed, not a parallel workflow
  fallback.
- AG-UI adoption policy: AG-UI is no longer only a reference. It is the target
  external UI contract and UX model for agent runs, streaming messages, tool
  calls, human-in-the-loop approvals, state updates, interrupts/resume, and run
  completion. Prefer Microsoft Agent Framework's official ASP.NET Core AG-UI
  integration, such as `MapAGUI`, for Workbench-facing streams. Relay may add a
  narrow adapter only where M365 Copilot CDP transport or local governance needs
  Relay-specific behavior.
- Frontend adoption policy: use `@ag-ui/client` or the closest official AG-UI
  client primitives as the frontend runtime contract. If the best maintained
  AG-UI/CopilotKit visual components require React, migrate the Workbench
  frontend deliberately to that stack instead of keeping a divergent hand-rolled
  UI. The visual result must remain quiet, professional, spacious, and
  Relay-branded.
- Frontend stack decision: migrate the Workbench to **React + Vite +
  TypeScript + Tailwind CSS + shadcn/ui + Radix UI + `@ag-ui/client`**.
  Next.js is not the default because Relay's .NET sidecar already owns local
  serving, API routes, SSE, auth token validation, and packaging. Chakra UI is
  not the default design system because Relay needs AG-UI-aligned agent
  surfaces, owned component code, low visual overhead, and precise styling
  control.
- Removed shell targets: AionUi, OpenCode/OpenWork web shells, Tauri desktop
  shell, and any diagnostic-first shell are not fallback paths. They must be
  deleted from active product code, release workflows, package resources, and
  runtime launch paths during the cutover.
- Relay sidecar role: host the local web UI, expose local HTTP/WebSocket APIs,
  host the .NET Agent Framework runtime, validate and execute Relay local tools,
  manage app-local storage, and supervise the Copilot CDP bridge. The active
  implementation is the Relay-owned self-contained .NET sidecar with Agent
  Framework as the backend run harness.
- Sidecar Copilot transport: the active sidecar owns the Relay M365 Copilot
  provider adapter. Implement this as `RelayCopilotChatClient` or an equivalent
  Agent Framework-compatible adapter that turns Agent Framework model requests
  into Edge CDP operations against M365 Copilot. A local OpenAI-compatible
  surface may remain as an internal compatibility seam only when it helps wire
  Agent Framework clients; it is not a second runtime. The historical
  Node/Tauri-era bridge is no longer the active product path.
- Browser role: the user opens the Relay Workbench at a localhost URL. This
  browser surface is separate from the controlled Edge/Copilot CDP session.
  If Edge is used for both, Relay must use a separate profile or CDP boundary
  so the workbench does not interfere with Copilot automation.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Agent harness: the production path is Microsoft Agent Framework inside the
  Relay sidecar. Agent Framework owns agent turns, typed tools, session state,
  approvals, streaming updates, and run lifecycle. Relay owns the M365 Copilot
  provider adapter, local tool implementations, validation, approval policy,
  backups, diffs, storage, and diagnostics.
- Copilot transport shape: use the sidecar-owned Agent Framework-compatible
  Copilot adapter. Stable behavior from the historical Node/Tauri bridge may be
  ported into this adapter, but the final product must not keep a separate
  Node/Tauri-era bridge as an alternate runtime path. Copilot transport is
  fail-fast: prompt delivery failure, send failure, response extraction failure,
  schema validation failure, stale response pickup, or DOM selector drift fails
  the run with diagnostics instead of silently falling back to another planner
  or weaker execution path.
- Corporate-approved LLM posture: Relay uses M365 Copilot as the single primary
  reasoning engine. Do not introduce a two-brain UX, OpenAI API dependency,
  Codex authentication dependency, or unapproved third-party agent binary.
  Ollama is out of current release scope; it may be reconsidered only by a
  future ADR that does not create a second user-visible planning path.
- Rebranding policy: user-facing Relay-owned files, docs, labels, generated
  artifacts, and release surfaces should use `Relay` / `relay` naming. Keep
  upstream or integration names such as `Codex app-server`, `codex` CLI
  commands, `CODEX_HOME`, OpenCode/OpenWork compatibility terms, and third-party
  package identifiers unchanged when they refer to the external substrate rather
  than the Relay product brand.
- Compliance-safe packaging policy: Relay must not hide, obfuscate, or
  deceptively rename third-party binaries or metadata to evade internal local
  file checks. If direct use or redistribution of upstream Codex artifacts is
  not acceptable for the corporate environment, the product plan is to remove
  those artifacts from the shipped release or replace them with an approved
  Relay-owned adapter/runtime boundary. Branding cleanup is allowed only for
  Relay-owned files and user-facing product surfaces; third-party dependency
  notices, licenses, and integration names must remain accurate.
- Next agentic direction: Copilot becomes the reasoning source for intent
  understanding, next-step planning, tool choice, observation review, and final
  synthesis, but the **run loop is Agent Framework**. Relay is the function
  body/policy layer for validation, permissions, local execution, backups,
  diffs, and trace logging.
- Agent loop: fixed one-shot pipelines will be replaced by a bounded Agent
  Framework run loop: `Copilot provider response -> Agent Framework tool call
  -> Relay function body -> Agent Framework observation -> Copilot provider
  response`. The loop must be capped, traceable, and schema-validated.
  Validation failures stop the Agent Framework run and surface an AG-UI error;
  there is no fallback execution.
- Agent loop simplicity: the shipped UX should expose one reasoning path backed
  by Agent Framework and AG-UI. No secondary model, alternate run stream, or
  Relay-specific planner is part of the current product path.
- Tool broker: move from domain-specific high-level tools to a small generic
  Agent Framework tool set. The catalog should support many local business
  tasks; local file search, Office editing, and coding are high-frequency
  recipes that use the same primitives, not separate product modes. Initial
  target tools are:
  - `glob`: enumerate likely files using ripgrep's file listing and glob
    filters;
  - `grep`: search plaintext/code content using ripgrep;
  - `read`: read exact files, including Relay-supported plaintext extraction
    for Office/PDF where available;
  - `officecli`: inspect or mutate Office files through validated OfficeCLI
    semantic operations and locally compiled argv;
  - `edit`: exact-string file edits inside the selected workspace;
  - `write`: new file creation or complete rewrite, only after approval;
  - `workspace_status`: inspect repository/workspace state such as dirty files,
    changed paths, tool readiness, and app-local run metadata without mutating
    anything;
  - `diff`: show pending or applied text/Office/code changes in a stable,
    reviewable format;
  - `bash` or `run_command`: execute bounded verification commands such as
    build, test, lint, typecheck, format-check, or explicit user-approved
    project commands;
  - `ask_user`: AG-UI client tool for missing information;
  - final answer: normal Agent Framework assistant output, not a Relay backend
    tool.
- Tool schema policy: keep the initial Copilot context small by relying on
  Agent Framework tool schemas, middleware, and session context. Validation
  failures stop the Agent Framework run and surface a clear AG-UI error. Do
  not silently execute fallback tools when Copilot emits invalid arguments.
- Search direction: do not keep investing in a custom high-level search product
  as the main UX. Search becomes a generic Agent Framework capability built on
  ripgrep-backed `glob`/`grep`, exact `read`, and Copilot synthesis over
  Agent Framework tool observations. Relay still owns path constraints, timeout
  budgets, result caps, and evidence packaging.
- Search quality policy: Relay should report evidence states, not overclaim
  relevance. Use `filename_only`, `path_match`, `content_confirmed`,
  `office_text_confirmed`, and `metadata_only` style states so Copilot can
  distinguish candidates from confirmed evidence. For large folders, Relay
  should cap and diversify results, detect obvious folder skew, and let Copilot
  choose follow-up reads/searches through the same generic loop.
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the Workbench.
- Office tool policy: expose OfficeCLI through a broad capability registry,
  not arbitrary argv and not a tiny hand-written allowlist. The registry should
  be generated or validated from pinned OfficeCLI help/schema output where
  available, then normalized into Relay semantic operation families: discovery
  and inspection; Excel workbook/sheet/cell/range/table/formula/style/data
  operations; Word document/text/table/style/review operations; PowerPoint
  slide/shape/text/media/layout operations; and cross-document export,
  convert, render, merge, split, batch, refresh, resident open/close, and
  validation operations when supported by the bundled OfficeCLI version. Copilot
  selects only a semantic operation plus typed arguments. Relay validates paths,
  document type, selectors, sheet/range/property values, safety class, and then
  compiles the operation to OfficeCLI argv. Office mutations must produce a
  backup, approval interrupt, command summary, post-apply verification, and
  rollback note.
- OfficeCLI readiness checks must validate real `view outline --json`
  capability without falsely failing because Relay's own smoke workbook handle
  is still open. Smoke workbooks must be written to a unique app-local path,
  closed before launching OfficeCLI, retried briefly on transient sharing
  violations, and cleaned up after the check.
- OfficeCLI is an optional capability for overall agent readiness. Missing or
  failed OfficeCLI must not put the whole Workbench into `Limited` when
  Copilot and required search/tool execution are ready. Office tasks still fail
  clearly at execution time if OfficeCLI cannot be resolved or pass smoke.
- Code editing: M365 Copilot may inspect through `rg_files`, `rg_search`, and
  `read`, then propose validated exact-string replacements through `edit` or
  new-file writes through `write`. Relay validates workspace-relative paths,
  unique `oldString` matches, file boundaries, and user approval before writing.
  `workspace_status`, `diff`, and `run_command` complete the coding loop by
  making dirty-file state, reviewable changes, and verification output visible
  to the agent. Arbitrary unrestricted shell is not part of the default tool
  catalog.
- Command execution policy: `run_command` is not a general shell. It accepts a
  structured argv array, working directory, timeout, environment allowlist, and
  declared purpose. Relay blocks shell metacharacters, network/package-install
  commands, destructive commands, cross-workspace paths, and secret-reading
  patterns unless the user explicitly approves a narrowly displayed command.
- UX direction: follow the dedicated **UI/UX Direction** section above. Design
  guidance belongs in Workbench-owned docs/source only; the deleted desktop
  tree is not a design dependency.
- Target release artifact: self-contained Relay sidecar plus static web assets,
  with a Windows user-scope NSIS installer and a Linux archive/launcher that
  open the local workbench URL. The Windows installer packages the sidecar
  Workbench architecture; the Tauri NSIS installer is not a supported release
  path after the cutover.

### Architecture Specification

This specification is added after reviewing current Microsoft Edge DevTools
Protocol, ASP.NET Core, .NET deployment, AG-UI, Microsoft Agent Framework,
OWASP LLM, NSIS, and ripgrep documentation. It is the target contract for the
hard cutover.

- Process topology:
  - `Relay.Launcher` is the user-facing entrypoint on Windows and Linux.
  - `Relay.Sidecar` is the only long-lived backend process. It hosts the
    Workbench static assets, local APIs, Microsoft Agent Framework runtime,
    AG-UI event stream, Copilot CDP provider adapter, Relay tool broker, run
    ledger, and package diagnostics.
  - Microsoft Agent Framework is the sidecar's backend agent runtime. Relay
    integrates with it through typed tools, approval middleware, session/run
    records, and a Copilot provider adapter rather than a separate custom
    workflow runner.
  - The Workbench browser opens the sidecar URL with a per-launch token. It is
    not the same browser automation context as the Copilot CDP tab.
  - Edge/Copilot is started or attached lazily for model turns only. Workbench
    first paint must not wait for Copilot readiness.
- Local HTTP surface:
  - Bind only to loopback using an explicit localhost URL and dynamic or
    conflict-checked port; never bind to `0.0.0.0`, `*`, `+`, or LAN
    interfaces.
  - Every API, SSE stream, and state-changing request requires the launch
    token. Validate `Host` and `Origin`; reject missing or foreign origins.
  - Serve only the built Workbench bundle. Directory browsing must remain
    disabled, and arbitrary workspace files must never be served as static
    assets.
  - Required endpoints: `/` for Workbench, Agent Framework AG-UI run endpoint,
    `/api/status`, `/api/workspace`, `/api/runs`, `/api/runs/{id}`,
    `/api/runs/{id}/approve`, `/api/runs/{id}/cancel`,
    `/api/support-bundle`, and `/api/shutdown`. Legacy custom event endpoints
    may exist only during migration and must not remain Workbench-facing after
    AG-UI adoption.
- Event stream:
  - Use AG-UI as the public run event protocol. Do not keep a competing Relay
    wire protocol for the Workbench once migration is complete.
  - Required AG-UI event coverage: run start/finish, text message
    start/content/end, tool call start/args/result, state snapshot/delta,
    approval interrupt, resume result, error, and cancellation.
  - Every emitted event must be traceable to Relay `runId`, monotonic sequence,
    timestamp, and structured metadata for replay/support export, even when the
    protocol field names come from AG-UI.
  - Relay-internal event records are allowed as persistence details, but
    Workbench-facing APIs must speak AG-UI.
- Run lifecycle:
  - State machine: `created -> preparing -> waiting_copilot -> validating ->
    executing_tool -> waiting_approval -> synthesizing -> completed`.
    Terminal states are `completed`, `cancelled`, and `failed`.
  - Agent Framework is responsible for the run/session lifecycle. Relay policy
    constrains each Copilot step to one validated tool call, `ask_user`, or
    `final`. Relay executes at most one local action before returning an
    observation to the Agent Framework run.
  - Invalid JSON, unknown tool names, invalid arguments, missing capability,
    stale approval, or workspace-scope violation stops the run with a visible
    `failed` state. Do not route to a weaker fallback tool.
  - Bounded retry is allowed only inside the same transport for paste/send
    readiness, response extraction settling, or one JSON repair turn.
- Tool contract:
  - Tool arguments are validated against Relay-owned schemas before execution.
  - Read-only tools may run after validation; mutation tools pause for explicit
    approval with exact target paths, diff/command summary, backup location,
    and rollback/no-rollback note.
  - `rg_files` maps to ripgrep file enumeration with explicit root, include,
    exclude, depth, cap, timeout, and hidden/binary policy.
  - `rg_search` maps to ripgrep content search for plaintext/code only, with
    explicit root, pattern, include/exclude globs, cap, timeout, and encoding
    policy. Office/PDF containers are discovered by filename and inspected by
    exact `read`, not plaintext grep.
  - `read` returns bounded extracted text or structured metadata for exact
    files, including Office/PDF extraction where Relay supports it.
  - `officecli` accepts semantic Office operations compiled by Relay to argv;
    direct arbitrary shell is not exposed.
  - `edit` requires exact old/new replacement validation; `write` requires an
    explicit target and approval.
  - `workspace_status` reports repository/workspace state without mutation,
    including dirty files, changed paths, active approvals, and relevant tool
    readiness.
  - `diff` returns bounded, reviewable diffs for pending and applied
    mutations. It must be available before approval and after execution.
  - `run_command` executes only validated, bounded verification commands. It
    must avoid shell interpretation by default, enforce workspace containment,
    capture stdout/stderr with caps, support cancellation, and require approval
    for non-allowlisted or mutation-capable commands.
- Copilot transport:
  - The sidecar owns the Agent Framework-compatible M365 Copilot provider
    adapter over Edge CDP. Prefer a direct `IChatClient`/Agent Framework
    adapter shape. A Chat-Completions-compatible local surface may remain only
    as internal compatibility for existing tests or Agent Framework clients.
    This is an adapter contract for Relay; it is not a Microsoft 365 product
    API guarantee.
  - DOM selectors, paste/insert behavior, send-button lifecycle detection, and
    response extraction rules must be versioned against saved successful
    Copilot fixtures.
  - Response extraction must reject prompt echoes, sidebar/history text,
    suggestions, empty answers, stale prior answers, and incomplete JSON.
  - Transport errors fail the Agent Framework run. Relay may perform short
    bounded mechanical retries for readiness/settling inside the same CDP
    operation, but it must not silently execute a fallback model, planner,
    runner, or tool path.
- Storage and privacy:
  - Runtime data lives under user-local Relay data directories only.
  - Shared folders and selected workspaces must not receive Relay caches,
    indexes, snapshots, logs, or temp files.
  - Run ledgers store bounded observations and metadata by default. Support
    bundles omit document contents unless the user explicitly opts in.
- Packaging:
  - Publish the sidecar as self-contained, platform-specific artifacts.
  - Windows distribution is a per-user NSIS installer with user execution
    level, current-user install location, Start Menu shortcut, optional desktop
    shortcut, uninstall entry, and no UAC/password requirement.
  - Bundle required runtime tools from sidecar-owned resource directories and
    list them in the release inventory/SBOM-style metadata.

## Current Review Remediation Plan

The sidecar/workbench cutover is active. The next plan is no longer another
architecture migration; it is a hardening pass based on the current
implementation review. Do not reintroduce the old `apps/desktop`, AionUi,
OpenCode/OpenWork, Tauri IPC, or high-level document-search engines while
addressing these items.

Implementation status on 2026-05-16:

- Completed in the current slices: generic `workspace_status`, `diff`, and
  approval-gated bounded `run_command`; `rg_search` `--` hardening; Workbench
  event identity by `runId + sequence`; official AG-UI SSE event mapping;
  Workbench consumption of `/agui/relay`; hard-cut guard coverage that blocks
  returning the Workbench to the old `/events` stream; the
  `RelayCopilotChatClient` `IChatClient` adapter; POST-only support-bundle
  export with default redaction; streaming/capped ripgrep output for
  `rg_files` and `rg_search`; exact `read` extraction for `.docx`, `.xlsx`,
  `.xlsm`, `.pptx`, and text-layer `.pdf` including common filtered streams;
  broad semantic OfficeCLI capability-registry compilation with raw-argv
  rejection; a
  Microsoft Agent Framework-backed `ChatClientAgent` runner path for Copilot
  turns and per-run sessions; Agent Framework function-tool dispatch through
  `AIFunctionFactory.Create`; Copilot tool projection to
  `FunctionCallContent`; `FunctionInvokingChatClient` observation looping;
  `ApprovalRequiredAIFunction` wrapping for mutating tools; Agent Framework
  approval response resume/session serialization; Workbench approval rendering
  from AG-UI state instead of `RunResponse.pendingApproval`; React + Vite +
  TypeScript + Tailwind CSS + shadcn-style local components + Radix Tooltip
  Workbench migration; official `/agui/relay` execution through
  `@ag-ui/client`; removal of legacy `/api/runs` product routes, run ledger,
  and compatibility approval protocol; deeper support-bundle redaction fixture
  coverage; golden smoke coverage for those behaviors; and filtered PDF stream
  extraction coverage.
- The official Agent Framework AG-UI ASP.NET Core hosting package is now
  registered and exposed at `/agui/relay`. That endpoint is smoke-tested for
  framework-native AG-UI lifecycle SSE while still using `RelayCopilotChatClient`
  as the only model adapter and the same Relay tool functions.
- The legacy Workbench-facing custom `/api/runs` product path has been removed.
  Mutating-tool approval now flows through Agent Framework
  `ApprovalRequiredAIFunction`, the Relay AG-UI approval bridge, and AG-UI
  `request_approval` client-tool result messages.
- Workbench event mapping consumes standard AG-UI lifecycle, text, reasoning,
  tool-call, state, error, and completion events without depending on the
  Relay-only `relayType` field.
- Next scheduled slice: add official-path acceptance coverage and documentation
  around the now-current Agent Framework + AG-UI product path.

#### Next Task: Agent Framework + AG-UI Native Approval Cutover

Research sources checked on 2026-05-16:

- Microsoft Agent Framework AG-UI human-in-the-loop documentation:
  <https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop>
- AG-UI event protocol documentation:
  <https://docs.ag-ui.com/concepts/events>
- AG-UI client/server communication documentation:
  <https://docs.ag-ui.com/concepts/client-server-communication>

Goal: make Microsoft Agent Framework and AG-UI own the run protocol, tool-call
projection, user confirmation, resume, streaming lifecycle, and shared state as
much as their current .NET APIs allow. Relay should keep only the M365 Copilot
CDP `IChatClient` adapter, small local tool implementations, validation and
backup policy, diagnostics, packaging, and Workbench visual composition.

Implementation plan:

Current completed tasks:

- **AFAGUI01: Prove Agent Framework approval projection over AG-UI.** This is
  the first blocker for the cutover because it verifies that `MapAGUI` plus a
  narrow Agent Framework middleware can carry a mutating local function to the
  Workbench for approve/reject without relying on Relay's custom run stream.
- **AFAGUI02: Refactor Relay tool registration around Agent Framework
  primitives.** Relay now has an explicit Agent Framework tool catalog split
  between read-only automatic functions and mutating
  `ApprovalRequiredAIFunction` tools projected to AG-UI `request_approval`.
- **AFAGUI03: Move Workbench primary execution to official AG-UI transport.**
  Workbench now starts and resumes runs through the official `/agui/relay`
  HTTP/SSE endpoint with `@ag-ui/client` `HttpAgent`, derives approval cards
  from AG-UI `request_approval` client-tool calls, and no longer uses legacy
  `/api/runs` routes as its product execution path.
- **AFAGUI04: Remove legacy run stream and approval compatibility routes.**
  The sidecar no longer maps legacy `/api/runs` product routes, `RunManager`
  has been removed, Workbench types no longer expose `RunResponse`, and smoke
  scripts now drive runs through the official `/agui/relay` endpoint.
- **AFAGUI05: Add official-path acceptance coverage and documentation.**
  The official AG-UI path is covered by `pnpm check` smokes, the browser-level
  `pnpm workbench:ux-e2e` flow, release inventory/installer policy checks, and
  aligned README/AGENTS/implementation documentation.

Next task after this checkpoint:

- No remaining `agent_framework_agui_native_cutover` task is scheduled. Stale
  historical AionUi acceptance tasks `AION04` through `AION07` were retired as
  obsolete in Task Master on 2026-05-16 because AionUi is no longer an active
  product or release path.

1. Add a proof slice for AG-UI client-tool approvals.
   - Confirm the current Agent Framework AG-UI package surface. If a future
     package exposes a dedicated helper, use it; in the current package,
     implement only the missing projection middleware rather than a second run
     stream.
   - Build a minimal test agent that registers one read-only function and one
     mutating function through Agent Framework, applies
     `UseFunctionInvocation()` plus the approval projection middleware, and
     exposes the agent with `MapAGUI`.
   - Connect the Workbench with `@ag-ui/client` to that endpoint and prove the
     mutating function arrives as an AG-UI `request_approval` client tool call
     that the UI can approve or reject.
   - Fail fast if the official middleware cannot project the action. Do not add
     a new Relay fallback stream to mask the gap.

2. Refactor Relay tools around Agent Framework primitives.
   - Keep read-only functions (`rg_files`, `rg_search`, `read`,
     `workspace_status`, `diff`) as normal Agent Framework tools that may run
     automatically inside the selected workspace.
   - Register mutating functions (`officecli` mutations, `edit`, `write`, and
     any future bounded command operation) as Agent Framework
     `ApprovalRequiredAIFunction` tools, then project their approval requests to
     AG-UI client-tool calls so the UI owns explicit approval before Relay
     executes the local operation.
   - Keep tool bodies small and deterministic: validate scope, validate typed
     args, create backups/diffs when applicable, execute one local action, and
     return a structured observation. Do not rebuild a Relay planner or
     observation loop around them.

3. Move Workbench primary execution to the official AG-UI transport.
   - Replace `RelayEventSourceAgent` and `/api/runs/{runId}/agui-events` as the
     product path with the official AG-UI HTTP/SSE run flow.
   - Consume standard AG-UI lifecycle, text, tool-call, state, error, and
     completion events directly. Relay-only event fields may remain only in
     support diagnostics until callers are removed.
   - Render approval cards from AG-UI client-tool action state, not from
     `RunResponse.pendingApproval` or the old ledger approval route.

4. Move run/session state to Agent Framework and AG-UI identities.
   - Use `AgentSession` plus AG-UI thread/run identifiers as the source of
     truth for run continuity.
   - Keep the Relay run ledger as an append-only audit/support artifact only.
     It must not be required for normal approval/resume once the official AG-UI
     path works.
   - Remove `PendingApproval`, `/api/runs/{runId}/approve`, and legacy resume
     protocol from the product path after the Workbench and tests no longer use
     them.

5. Delete replaced compatibility code in the same milestone.
   - Remove the old Workbench `RunEvent` primary stream, approval route,
     compatibility normalizer, and any tests that assert Relay-only event
     fields as product behavior.
   - Keep plain local HTTP APIs for non-agent app operations only: workspace
     selection, readiness, support bundle, static assets, and shutdown.
   - Do not leave a hidden compatibility mode or fallback setting. If official
     AG-UI projection breaks, the run should fail visibly with diagnostics.

6. Add acceptance coverage for the official path.
   - Sidecar smoke: `MapAGUI` plus the approval projection middleware can
     stream a run, call a read-only function, request a mutating tool
     confirmation, reject without side effects, approve with a backup/diff or
     Office manifest, resume, and complete.
   - Workbench E2E: the browser UI submits one generic task, sees streamed
     reasoning/text/tool activity, approves one mutation, rejects one mutation,
     cancels a run, and sees clear error output for invalid Copilot JSON.
   - Regression gate: active Workbench code no longer imports or depends on the
     custom `/api/runs/{runId}/agui-events` product stream.
   - Standard gates: `pnpm check`, sidecar security smoke, support-bundle
     redaction smoke, release inventory, and installer policy checks.

Guardrails for this task:

- No Python runtime and no second agent runner.
- No reintroduction of AionUi, OpenCode/OpenWork, Codex app-server, Tauri, or
  the removed high-level document-search workflow.
- No unrestricted shell tool. Future command execution must remain a typed,
  bounded Agent Framework tool with Relay validation and approval.
- No prompt-only safety. Copilot may choose tools, but Relay validates every
  argument and owns local execution.
- No silent fallback. Missing AG-UI middleware, Copilot transport drift,
  invalid JSON, OfficeCLI/ripgrep absence, or unsupported tool args stop the
  run with a user-visible error and support details.

Framework-first revision after current Microsoft documentation review:

- Agent Framework already owns the tool-calling loop. Relay must stop growing
  the custom `RelayAgentPlan -> RelayToolExecutor -> observation` loop and
  instead register Relay capabilities as Agent Framework tools.
- Relay-owned custom code should narrow to:
  - the M365 Copilot Edge/CDP `IChatClient` adapter;
  - tool policy, workspace containment, approval, backup, redaction, and audit
    middleware;
  - thin local provider adapters only where an approved existing tool substrate
    does not already provide the capability;
  - packaging, diagnostics, and support-bundle generation.
- The Copilot adapter is the required seam because M365 Copilot is reached
  through browser automation, not through a native provider API. It must project
  Agent Framework tool schemas into Copilot prompts and convert Copilot's
  selected action back into Microsoft.Extensions.AI tool-call content. This
  adapter is allowed; a second Relay runner is not.
- Prefer Agent Framework primitives before adding Relay code:
  `AIFunctionFactory.Create` for typed function tools,
  `ApprovalRequiredAIFunction` for mutation tools,
  narrow Agent Framework middleware for `ToolApprovalRequestContent` to AG-UI
  `request_approval` projection and resume,
  `AgentSession` serialization for run continuity,
  middleware for validation/telemetry,
  and `MapAGUI` / AG-UI middleware for Workbench streaming and approvals.
- Do not use provider-hosted file search or code interpreter for local
  workspaces. Relay's local files and Office documents must stay local, so tool
  execution must remain local and auditable. Prefer existing local tool
  substrates in this order:
  1. Agent Framework tool primitives and approval/session middleware.
  2. Approved local MCP servers or provider bridges that expose real existing
     tools and can be wrapped by Relay policy.
  3. Existing CLI/library tools such as ripgrep and OfficeCLI behind typed
     schemas.
  4. Relay-owned in-process functions only for the remaining gaps.

#### Microsoft Agent Framework Prior-Art Review

Updated 2026-05-16 after reviewing current Microsoft Agent Framework docs,
official samples, and Microsoft blog case studies:

- **Official sample taxonomy:** `microsoft/Agent-Framework-Samples` organizes
  examples around foundations, first agents, provider exploration, tools
  (vision/code interpreter/custom tools/file search), providers and MCP,
  RAG/file search, planning, multi-agent workflows, evaluation/tracing, DevUI,
  and real-world cases
  (`https://github.com/microsoft/Agent-Framework-Samples`). Relay should keep
  its plan and verification matrix aligned to those same axes: provider,
  tools, workflow/orchestration, UI streaming, evaluation/tracing, and
  packaging.
- **Agent vs workflow boundary:** Microsoft guidance says to use an agent for
  open-ended conversational work and autonomous tool use, and a workflow when
  steps are well-defined; it also says that if a function can handle the task,
  use a function instead of an AI agent
  (`https://learn.microsoft.com/en-us/agent-framework/overview/`). Relay should
  therefore stay with one Copilot-controlled manager plus local tools for
  coding, Office edits, and local file lookup. Do not split into multiple
  agents just to make simple file/search/edit operations look more agentic.
- **Tool type pattern:** Agent Framework's tool docs list function tools,
  approval, code interpreter, file search, web search, hosted MCP, local MCP,
  and Foundry toolboxes
  (`https://learn.microsoft.com/agent-framework/agents/tools/`). Local MCP
  tools are broadly compatible with providers that support function tools, but
  provider-native approval is not universal. Relay must keep approval and
  workspace policy as Relay-owned AG-UI/client-tool behavior instead of
  assuming the Copilot provider can enforce approval natively.
- **AG-UI product pattern:** Microsoft's AG-UI + Agent Framework workflow demo
  frames the UI problem clearly: users need to see which agent is active, why
  the system is waiting, and what sensitive action needs approval
  (`https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/`).
  Relay should continue the minimal Workbench direction, but the visible run
  stream must always show active status, tool calls, approval waits, errors,
  and completion without hiding them in support-only logs. The demo notes that
  C# support for MAF + AG-UI was still in development at publication time, so
  Relay must keep preview-package drift guarded by `pnpm check` and live E2E.
- **Handoff vs agent-as-tool:** Handoff orchestration is for cases where
  specialized agents transfer control and task ownership; agent-as-tool keeps a
  primary agent responsible while delegating bounded subtasks
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff`).
  If Relay later adds specialist agents, prefer agent-as-tool for bounded
  specialists such as "Office reviewer" or "code verifier"; reserve handoff for
  real domain ownership transfer with explicit routing rules and shared
  context requirements.
- **Workflow orchestration options:** Agent Framework documents sequential,
  concurrent, handoff, group chat, and magentic orchestration patterns
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/`).
  Relay should not adopt these until a user workflow is repeatable enough to
  justify explicit topology. The current generic Workbench should remain a
  single agent run loop, while future deterministic recipes can become
  workflows only after their entry/exit states and approval points are known.
- **Declarative workflow and MCP examples:** Declarative workflow docs include
  `InvokeFunctionTool`, `InvokeMcpTool`, `FunctionTools`, `ToolApproval`,
  `CustomerSupport`, and `DeepResearch` samples
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/declarative`).
  This supports Relay's current decision: model local capabilities as typed
  tools first; use MCP only for approved standalone providers; do not invent a
  Relay scheduler when Agent Framework workflows can represent deterministic
  processes later.
- **Durable workflow as MCP:** The .NET durable workflow example shows Azure
  Functions exposing registered workflows as remote MCP tools at a runtime
  webhook endpoint
  (`https://devblogs.microsoft.com/dotnet/durable-workflows-in-microsoft-agent-framework/`).
  For Relay, this is future prior art for exposing durable, non-local,
  enterprise-approved workflows as MCP tools. It is not a reason to add a local
  arbitrary MCP server or cloud dependency to the MVP.
- **Enterprise production signals:** Microsoft's Foundry introduction cites
  Agent Framework use cases such as audit testing/documentation, customer
  support, vehicle telemetry analysis, integration services, and marketing
  content workflows, emphasizing governance, observability, durability, and
  human-in-the-loop operation
  (`https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/`).
  Relay's matching product requirement is not more bespoke tool code; it is
  stronger traceability: redacted support bundles, tool-call audit records,
  approval artifacts, reproducible smokes, and release inventory.

Resulting Relay design adjustments:

- Keep the current **single Copilot manager + Agent Framework tools** as the
  default architecture.
- Treat multi-agent/handoff workflows as future features with a named business
  need, not as a default replacement for the generic Workbench.
- Keep **AG-UI as the user-visible execution protocol**, with approval and
  waiting states promoted in the UI rather than hidden.
- Keep **Relay-owned policy and approval** around all local tools because M365
  Copilot is reached through a custom CDP adapter and provider-native approval
  cannot be assumed.
- Prefer future **declarative workflows or MCP-wrapped durable workflows** only
  when a repeatable process has stable steps, inputs, approval points, and
  output contracts.
- Add future improvements under verification/evaluation/tracing rather than
  expanding the tool catalog first.

#### Executable Task Queue: Agent Framework Prior-Art Alignment

These tasks convert the prior-art review into implementable work. They are
ordered so each step leaves a concrete artifact and does not require a second
agent runtime, AionUi, OpenCode/OpenWork, Codex app-server, or unrestricted
shell.

1. **MAFPR01: Add an Agent Framework alignment matrix.**
   - Status: completed 2026-05-16.
   - Goal: turn the prior-art review into a maintained engineering checklist.
   - Changes:
     - Add `docs/AGENT_FRAMEWORK_ALIGNMENT.md`.
     - Map each Agent Framework prior-art axis to Relay's current decision:
       provider adapter, function tools, local MCP admission, approval,
       AG-UI streaming, workflow orchestration, evaluation/tracing, and
       packaging.
     - Mark each axis as `adopted`, `adopted with Relay policy`,
       `deferred`, or `rejected`.
   - Acceptance: the doc has no implementation claims without a current source
     file or verification command reference.
   - Verification: `git diff --check`.

2. **MAFPR02: Add a model-facing tool catalog snapshot gate.**
   - Status: completed 2026-05-16.
   - Goal: make Agent Framework tool schema drift visible before Copilot sees
     it.
   - Changes:
     - Add a smoke script that starts the sidecar in mock mode, reads the
       registered Agent Framework tool names/schemas or an exported catalog
       endpoint, and writes/compares a stable JSON snapshot.
     - Assert that prompt-facing names remain `glob`, `grep`, `read`,
       `officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
       `workspace_status`, `diff`, `bash`, and `ask_user`.
     - Reject `rg_files`, `rg_search`, and `run_command` in active catalog
       output.
   - Acceptance: a catalog change fails a targeted smoke with a readable diff.
   - Verification: new catalog smoke; `pnpm check`.

3. **MAFPR03: Add an AG-UI run-state acceptance matrix.**
   - Status: completed 2026-05-16.
   - Goal: align Workbench UX with Agent Framework/AG-UI examples that expose
     active status, waits, approvals, errors, and completion.
   - Changes:
     - Add a small Workbench E2E matrix covering: ready state, running state,
       tool-call visible state, approval-required state, rejection, failure,
       cancellation, and completed state.
     - Keep screenshots under the existing E2E artifact location.
     - Update user-facing copy only if a state is ambiguous.
   - Acceptance: users can tell whether Relay is thinking, waiting for
     approval, executing a tool, failed, cancelled, or done without opening
     support details.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

4. **MAFPR04: Add tool-call audit and evaluation artifacts.**
   - Status: completed 2026-05-16.
   - Goal: follow Agent Framework production guidance by improving
     observability before adding more tool behavior.
   - Changes:
     - Extend support-bundle or run-ledger output with a redacted tool-call
       audit summary: tool name, argument classification, approval status,
       duration, success/failure, output truncation, and backup/diff pointers.
     - Add a deterministic smoke that verifies sensitive fields and document
       contents remain redacted.
   - Acceptance: a failed run can be diagnosed from redacted metadata without
     exposing raw documents, tokens, cookies, or prompt payloads.
   - Verification: sidecar security/support-bundle smoke; `pnpm check`.

5. **MAFPR05: Define the workflow admission gate.**
   - Status: completed 2026-05-16.
   - Goal: prevent premature multi-agent or workflow adoption while keeping a
     clear path for repeatable business processes.
   - Changes:
     - Add a doc section or file that defines when Relay may use:
       single-agent tools, agent-as-tool, handoff, declarative workflow,
       local MCP, or durable workflow-as-MCP.
     - Include required fields for any future workflow proposal: trigger,
       inputs, deterministic steps, approval points, rollback/backup behavior,
       output contract, E2E test, and support-bundle evidence.
   - Acceptance: no new workflow/multi-agent feature can be scheduled without
     satisfying this gate.
   - Verification: `git diff --check`; hard-cut guard if new forbidden paths
     are added.

6. **MAFPR06: Harden live Copilot provider acceptance.**
   - Status: completed 2026-05-16.
   - Goal: keep the custom M365 Copilot CDP adapter compatible with Agent
     Framework tool-calling expectations.
   - Changes:
     - Add or update live E2E criteria for prompt delivery, tool JSON
       projection, AG-UI streaming, approval resume, final answer extraction,
       and fail-fast invalid JSON.
     - Keep this as an optional live gate unless a signed-in Edge CDP session
       is available.
   - Acceptance: live failures are classified as environment, prompt delivery,
     response extraction, schema validation, or tool execution failures.
   - Verification: `pnpm workbench:live-copilot-e2e` when available; otherwise
     documented skip with reason.

7. **MAFPR07: Review local MCP candidates before adding MCP runtime.**
   - Status: completed 2026-05-16.
   - Goal: avoid adding a toy MCP fixture or arbitrary server while preserving
     the Agent Framework extension path.
   - Changes:
     - Evaluate candidate local MCP servers only if they provide a real
       capability not already covered by ripgrep, OfficeCLI, filesystem, git,
       or bounded command tools.
     - Document packaging, security, approval, workspace containment,
       redaction, and Windows/Linux behavior for each candidate.
   - Acceptance: either choose a named approved MCP candidate with a concrete
     follow-up task, or record that no MCP server should be added yet.
   - Verification: documentation review; no runtime change unless a candidate
     is explicitly approved.

#### Tool Substrate Reduction Plan

Current state: the active tool surface is descriptor-driven Agent Framework
function tools. `RelayAgentFunctionSet` now exposes `glob`, `grep`, `read`,
`officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
`workspace_status`, `diff`, bounded `bash`, and `ask_user` through
`AIFunctionFactory.Create`, while `RelayToolExecutor` uses a provider registry
for validation, descriptions, approval requirements, and execution. Some tools
delegate to established executables such as ripgrep and OfficeCLI. The next
architectural step is not another rename; it is reducing the remaining
Relay-owned provider code only where Agent Framework primitives, approved MCP
providers, or existing CLI/library substrates can replace it without losing
local policy, auditability, or packaging control.

Design target:

- Keep **M365 Copilot as the only reasoning/controller model** and Microsoft
  Agent Framework as the run loop.
- Keep **Relay as the policy boundary** for local paths, approvals, backups,
  destructive-action classification, logging, redaction, and fail-fast errors.
- Move tool declarations to a **descriptor-driven provider registry** so Relay
  does not need one bespoke method and one bespoke switch branch for every
  tool.
- Reuse existing tool schemas, local MCP tools, and CLI/library
  implementations whenever they can run locally, be packaged legally, and pass
  Relay policy.
- **Decision after 2026-05-16 investigation:** do not adopt OpenCode, Codex
  app-server, or Codex MCP server as Relay runtime or provider substrate.
  - OpenCode is useful as a compatibility reference for generic tool names and
    permission categories (`glob`, `grep`, `read`, `edit`, `write`,
    `apply_patch`, bounded `bash`), but Relay must not launch or embed the
    OpenCode runtime.
  - Codex app-server is rejected for Relay's production path. It is designed to
    control Codex threads, turns, accounts, models, approvals, and events; it
    also has version-specific generated schemas and auth surfaces. That would
    duplicate Agent Framework, compete with M365 Copilot as the controller, and
    reintroduce Codex branding/runtime dependency.
  - Codex MCP server is also rejected as a tool substrate. Its documented
    interface controls a local Codex engine and is explicitly experimental; it
    is not a stable standalone local-tool bundle for Relay.
  - The only concrete adoption path is **Agent Framework local MCP consumption
    of standalone tool servers**, plus direct CLI/library providers for
    ripgrep and OfficeCLI. OpenCode/Codex documentation may inform schema
    naming and tests, but no OpenCode/Codex process, package, generated schema,
    or auth flow is part of the active product.

Framework-native tool contract target:

- **Primary anchor: Microsoft Agent Framework function/MCP/client tool model.**
  Relay's model-facing and runtime-facing tools should be Agent Framework
  function tools, approved Agent Framework MCP tools, or AG-UI client tools.
  Do not maintain a separate Relay or OpenCode tool contract as the product
  source of truth.
- **Function tools by default.** Local file search, exact read, text/code edit,
  OfficeCLI operations, workspace status, diff, and bounded build/test/lint
  commands are Agent Framework function tools with typed parameters,
  descriptions, runtime-only context, middleware validation, and explicit output
  contracts.
- **Approval through Agent Framework, display through AG-UI.** Mutating
  functions are wrapped with Agent Framework approval primitives and projected
  to AG-UI HITL/client-tool events. Relay stores audit records, backups, and
  diffs, but it does not own a second approval protocol.
- **MCP only when it reduces Relay code.** If an approved standalone local MCP
  server provides a capability with acceptable licensing, packaging, offline
  behavior, and policy hooks, consume it through Agent Framework's MCP bridge.
  MCP is not a replacement for workspace policy or approval middleware.
- **AG-UI client tools only for user interaction.** `ask_user`, approvals, and
  any future UI-only choices are AG-UI client tools/HITL states, not backend
  local execution tools.
- **Prior-art tools are references, not contracts.** OpenCode, Codex
  app-server, GitHub Copilot custom agents, Claude Code, and AionUi can inform
  naming familiarity and test scenarios, but Relay must not import their tool
  protocols, generated schemas, runtime assumptions, or permission systems as
  active architecture.
- **Names stay plain, authority moves to Agent Framework.** Familiar names such
  as `glob`, `grep`, `read`, `edit`, `write`, `apply_patch`, and `bash` may be
  retained because they are concise and model-friendly, but their schema,
  availability, approval, execution, and telemetry are defined by Agent
  Framework tool registration and middleware.
- **Keep Relay-owned residue explicit and minimal.** Relay-owned code is
  limited to local function bodies, workspace containment, mutation
  classification, backups, diffs, redaction, Office/PDF extraction helpers,
  OfficeCLI semantic validation, packaging, and fail-fast diagnostics.

Mapping target:

| Current Relay tool | Desired substrate | Relay-owned residue |
| --- | --- | --- |
| `rg_files` / `glob` | Agent Framework function tool backed by ripgrep file listing, or approved local MCP file discovery tool | workspace scope, ignore rules, result caps, ranking hints |
| `rg_search` / `grep` | Agent Framework function tool backed by ripgrep content search, or approved local MCP search tool | binary/Office rejection policy, output caps, sensitive-path redaction |
| `read` | Agent Framework function tool for exact reads plus approved parsers for Office/PDF extraction | Office/PDF extraction fallback, snippet caps, redaction |
| `edit` / `write` / `apply_patch` | Agent Framework function tools wrapped in approval for mutations | backups, approval metadata, exact-match validation, diff generation |
| `officecli` / `officecli_mutate` | Agent Framework function tools around bundled OfficeCLI; mutation tools require approval | semantic operation registry, argv compilation, backup, post-check |
| `workspace_status` / `diff` | Agent Framework function tool or approved local MCP git/status tool | dirty-worktree policy, path filtering, output caps |
| `run_command` / `bash` | Agent Framework function tool for bounded build/test/lint command families only | allowlist, timeout, cancellation, destructive-command denial |
| `ask_user` | AG-UI client tool / Agent Framework human-in-the-loop request | request wording, run ledger persistence |

Implementation status (2026-05-16):

- TOOLSUB00-07 and TOOLSUB09-10 are implemented in the active
  sidecar/workbench path. The model-facing catalog is now `glob`, `grep`,
  `read`, `officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
  `workspace_status`, `diff`, `bash`, and `ask_user`.
- 2026-05-17 correction: these tool names are no longer treated as an
  OpenCode-compatible product contract. They are plain Agent Framework function
  tool names, with availability, approval, execution, telemetry, and AG-UI
  projection owned by Agent Framework registrations and middleware.
- TOOLSUB08 is closed as a descriptor-boundary decision rather than a new
  runtime dependency: the catalog now models `RelayFrameworkToolType.LocalMcp`
  for future approved standalone MCP tools, but this milestone does not add a
  production or test MCP server because no approved reusable local MCP substrate
  has been selected. Future MCP adoption must be a separate plan with a named
  server, threat model, packaging impact, and acceptance smoke.
- Verification for this cutover is recorded in `docs/IMPLEMENTATION.md` under
  "2026-05-16: OpenCode-Compatible Tool Contract Cutover".

Executable task queue:

1. **TOOLSUB00: Capture current tool baseline.**
   - Scope: documentation and tests only.
   - Changes:
     - Add `docs/TOOL_SUBSTRATE_MATRIX.md` with the current active catalog:
       `rg_files`, `rg_search`, `read`, `officecli`, `officecli_mutate`,
       `edit`, `write`, `workspace_status`, `diff`, `run_command`, and
       `ask_user`.
     - Record current prompt-facing names, JSON arguments, approval behavior,
       output shape, implementation method, external executable dependency, and
       current tests.
   - Artifact: `docs/TOOL_SUBSTRATE_MATRIX.md`.
   - Acceptance: no runtime behavior changes; the matrix clearly marks
     OpenCode runtime, Codex app-server, and Codex MCP server as rejected.
   - Verification: `git diff --check`; `node scripts/check-hard-cut-guard.mjs`.

2. **TOOLSUB01: Define the Agent Framework-native descriptor model.**
   - Scope: sidecar metadata only; no tool behavior changes.
   - Changes:
     - Add descriptor types for `frameworkToolType`, `capabilityFamily`,
       `providerKey`, `mutationClass`, `approvalPolicy`, `outputContract`,
       `promptVisibility`, JSON schema, output cap, and audit labels.
     - Model the current tools with descriptors while keeping the existing
       public tool names for this task.
   - Suggested files: `apps/sidecar/ToolDescriptors.cs`,
     `apps/sidecar/AgentRunner.cs`, sidecar tests/smokes.
   - Acceptance: current tools still register and execute exactly as before;
     descriptor snapshots prove the catalog is stable.
   - Verification: `pnpm sidecar:build`; `pnpm agent:golden-smoke`;
     `pnpm check`.

3. **TOOLSUB02: Generate Agent Framework tools from descriptors.**
   - Scope: registration path only; execution still uses existing handlers.
   - Changes:
     - Replace hand-written read-only/mutating registration lists with
       descriptor-driven `AITool` generation.
     - Keep `ApprovalRequiredAIFunction` wrapping driven by descriptor
       `approvalPolicy`.
     - Add a catalog snapshot smoke that fails if prompt-facing schemas drift
       unexpectedly.
   - Suggested files: `apps/sidecar/AgentRunner.cs`,
     `apps/sidecar/ToolDescriptors.cs`, smoke scripts under `apps/sidecar` or
     `scripts/`.
   - Acceptance: no public name/schema changes yet; all approvals and AG-UI
     approval cards still work.
   - Verification: `pnpm agent:agui-client-tool-smoke`;
     `pnpm agent:golden-smoke`; `pnpm check`.

4. **TOOLSUB03: Split execution into provider classes.**
   - Scope: internal dispatch boundary only.
   - Changes:
     - Replace the central `RelayToolExecutor` switch with providers:
       `RipgrepProvider`, `FileReadProvider`, `FileMutationProvider`,
       `OfficeCliProvider`, `WorkspaceProvider`, `CommandProvider`, and
       `HumanInputProvider`.
     - Providers receive validated typed args and return the existing
       `ToolObservation` contract.
     - Keep Relay policy, path containment, approval, backup, output caps, and
       redaction outside provider internals.
   - Suggested files: split from `apps/sidecar/AgentRunner.cs` into
     `apps/sidecar/Tools/*.cs`.
   - Acceptance: behavior and prompt-facing catalog remain unchanged; missing
     ripgrep/OfficeCLI, unsafe path, and mutation-without-approval failures
     still fail closed.
   - Verification: `pnpm agent:rg-stream-smoke`;
     `pnpm agent:officecli-registry-smoke`;
     `pnpm agent:office-pdf-read-smoke`; `pnpm check`.

5. **TOOLSUB04: Write the Agent Framework tool contract spec.**
   - Scope: docs and golden fixtures first; no runtime cutover yet.
   - Changes:
     - Add `docs/AGENT_FRAMEWORK_TOOL_CONTRACT.md` defining Relay's supported
       Agent Framework function/client/MCP tool model for `glob`, `grep`,
       `read`, `edit`, `write`, `apply_patch`, OfficeCLI operations, AG-UI
       client tools, and bounded command execution.
     - Include typed argument schemas, behavior semantics, output summaries,
       error classes, approval policy, middleware checks, AG-UI projections,
       Relay-owned residue, and examples.
     - Add golden fixture expectations for:
       `glob -> read`, `grep -> read`, `read -> edit -> diff`,
       `apply_patch -> diff`, Office `read -> officecli`, and bounded
       build/test/lint command flow.
   - Artifact: `docs/AGENT_FRAMEWORK_TOOL_CONTRACT.md` plus golden fixture
     files.
   - Acceptance: the spec states that Agent Framework registrations,
     middleware, approval primitives, and AG-UI projection are the contract;
     prior-art tool names are not a separate contract.
   - Verification: `git diff --check`; catalog/golden fixture smoke if present.

6. **TOOLSUB05: Cut over read-only file tools to `glob`, `grep`, and `read`.**
   - Scope: prompt-facing read-only workspace tools.
   - Changes:
     - Replace prompt-facing `rg_files` with `glob`.
     - Replace prompt-facing `rg_search` with `grep`.
     - Normalize `read` to the Agent Framework exact-read function schema:
       `file_path`, optional `offset`, optional `limit`, with runtime-only
       workspace/session context injected by middleware.
     - Update Copilot prompt projection, repair/validation, AG-UI labels,
       support-bundle labels, golden tests, and docs.
     - Do not expose prompt-visible dual names after the task is complete.
       Internal provider names may remain `RipgrepProvider`.
   - Acceptance: Copilot chooses `glob`/`grep`/`read` naturally; old
     `rg_files`/`rg_search` names are absent from the model-facing catalog.
   - Verification: `pnpm agent:golden-smoke`; `pnpm agent:rg-stream-smoke`;
     `pnpm agent:office-pdf-read-smoke`; `pnpm check`.

7. **TOOLSUB06: Cut over mutation tools to `edit`, `write`, and `apply_patch`.**
   - Scope: text/code mutation tools.
   - Changes:
     - Normalize `edit` to exact replacement args:
       `file_path`, `old_string`, `new_string`, optional `replace_all`.
     - Normalize `write` to `file_path`, `content`.
     - Add `apply_patch` as the preferred multi-hunk text/code edit tool with
       the established patch grammar.
     - Keep mutation approval, backup creation, diff generation, and
       post-write verification mandatory.
   - Acceptance: no mutation can run without approval; ambiguous `edit`
     matches fail unless `replace_all` is true; `apply_patch` produces a
     reviewable diff.
   - Verification: approval smoke; mutation golden smoke; `pnpm check`.

8. **TOOLSUB07: Map command execution to a bounded Agent Framework function
   tool without exposing unrestricted shell.**
   - Scope: command tool naming and policy.
   - Changes:
     - Keep the executable behavior bounded to structured build/test/lint argv.
     - Keep `bash` only as a familiar tool name if needed; the authoritative
       contract is an Agent Framework function schema with allowed command
       family, argv, cwd/workspace, timeout, and approval policy.
     - Do not expose raw arbitrary shell strings in the default catalog.
     - Update denial messages so the user sees "bounded command execution" and
       support details explain why unrestricted shell is unavailable.
   - Acceptance: build/test/lint commands still run; destructive or arbitrary
     commands fail before execution.
   - Verification: bounded command smoke; security smoke; `pnpm check`.

9. **TOOLSUB08: Close MCP bridge as descriptor-ready, no runtime dependency.**
   - Scope: MCP integration proof boundary only.
   - Changes:
     - Keep `RelayFrameworkToolType.LocalMcp` in the descriptor model so
       approved standalone MCP tools can be represented later.
     - Do not add a bundled/test MCP server in this milestone. A fixture that
       does not represent an approved real provider would add misleading
       complexity and would not reduce Relay-owned execution code.
     - Do not add any OpenCode/Codex MCP server.
   - Acceptance: the descriptor registry has a LocalMcp type and the substrate
     matrix documents MCP as conditional; active runtime and release inventory
     do not add MCP processes.
   - Verification: `pnpm agent:agui-client-tool-smoke`; `pnpm check`.

10. **TOOLSUB09: Remove superseded custom catalog code.**
    - Scope: cleanup after TOOLSUB05-08 pass.
    - Changes:
      - Remove obsolete `rg_files`/`rg_search` prompt projection, repair logic,
        tests, labels, and docs.
      - Remove any method-per-tool registration code superseded by descriptors.
      - Keep only Relay-owned providers and policy middleware required for
        workspace containment, approval, backups, audit, redaction, Office/PDF
        exact-read extraction, OfficeCLI semantic safety, and diagnostics.
    - Acceptance: release inventory shows no active AionUi/OpenCode/OpenWork/
      Codex app-server runtime fallback and no prompt-facing `rg_files` or
      `rg_search`.
    - Verification: `pnpm check`; `pnpm workbench:ux-e2e`;
      release inventory.

11. **TOOLSUB10: Documentation and support-bundle alignment.**
    - Scope: user/developer docs and diagnostics.
    - Changes:
      - Update `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`,
        `docs/AGENT_EVALUATION_CRITERIA.md`, and support-bundle notes to
        describe the Agent Framework tool model, middleware policy, AG-UI
        projection, and local workspace contract.
      - Document that OpenCode/Codex processes are not bundled or launched.
    - Acceptance: docs match the active catalog and packaging inventory.
    - Verification: `node scripts/check-hard-cut-guard.mjs`; `pnpm check`.

### P0: AG-UI Full Adoption

1. Replace the public run stream with AG-UI.
   - Current risk: the Workbench uses a Relay-specific `RunEvent` wire shape,
     which recreates a protocol AG-UI already standardizes.
   - Target: Workbench-facing agent traffic uses AG-UI events for lifecycle,
     text streaming, tool calls, state snapshots/deltas, approval interrupts,
     resume, errors, and completion.
   - Acceptance: no Workbench-facing API requires the old custom `RunEvent`
     union; event consumers can reconstruct a run from AG-UI events alone.

2. Rebuild the Workbench around AG-UI client and visual patterns.
   - Current risk: the current custom UI can drift from the AG-UI ecosystem and
     force Relay to keep inventing agent UI behavior.
   - Target: the Workbench uses React + Vite + TypeScript + Tailwind CSS +
     shadcn/ui + Radix UI + `@ag-ui/client`, and uses AG-UI/CopilotKit-style
     interaction patterns for streaming text, tool activity, approvals, state,
     and final answer cards.
   - Acceptance: browser E2E proves the AG-UI Workbench can submit a task,
     stream progress, render an approval interrupt, resume after approval, and
     show final output without using legacy mode buttons or custom-only event
     fields.

3. Adopt Microsoft Agent Framework as the backend runtime.
   - Current risk: moving to Python only because some AG-UI workflow examples
     are ahead would add packaging and enterprise deployment complexity without
     solving Copilot CDP or local tool governance. Keeping a Relay-owned runner
     would continue the harness reinvention that this migration is meant to
     remove.
   - Target: use .NET Microsoft Agent Framework as the production backend
     runtime. Agent Framework owns the run loop, tool-call detection, typed
     function dispatch, approvals, sessions, streaming, and lifecycle. Relay
     implements only the M365 Copilot provider adapter, local function bodies,
     validation policy, packaging, and diagnostics around that runtime.
   - Acceptance: a .NET Agent Framework smoke run can call Relay's Copilot
     adapter, select a Relay tool, pause/resume an approval, stream AG-UI events,
     and finish through the Workbench. Windows NSIS and Linux archive still ship
     one .NET sidecar product path, with no Python runtime requirement.
   - Current slice: Copilot turns now run through `ChatClientAgent` with an
     Agent Framework session; Relay capabilities are registered as
     `AIFunctionFactory.Create` tools; the Copilot adapter projects
     `ChatOptions.Tools` and converts valid tool choices to
     `FunctionCallContent`; `FunctionInvokingChatClient` owns the normal
     observation loop; mutating functions are wrapped with
     `ApprovalRequiredAIFunction`; approval-required runs now serialize the
     Agent Framework session into the run ledger and resume by feeding
     `ToolApprovalResponseContent` back into the same `ChatClientAgent`
     session. Workbench approval cards are driven by AG-UI
     `USER_CONFIRMATION_REQUEST` state, while `PendingApproval` remains only as
     internal ledger state for `/approve`.
   - Current slice: the Workbench now runs on React + Vite + TypeScript,
     Tailwind CSS, shadcn-style local UI components, Radix Tooltip, lucide
     icons, and a `RelayEventSourceAgent` subclass of `@ag-ui/client`
     `AbstractAgent` for AG-UI stream consumption. The thin Relay event
     normalizer remains only to bridge current sidecar event extensions such as
     `USER_CONFIRMATION_REQUEST` into the visible run trace.
   - Revised remaining slice: keep Relay tool functions small and
     deterministic. They validate workspace scope, execute one local action,
     return structured observations, and never call Copilot themselves.

4. Implement fail-fast Copilot provider behavior inside Agent Framework.
   - Current risk: hidden retries, fallback execution, or stale DOM extraction
     can make Copilot instability look like successful agent behavior.
   - Target: `RelayCopilotChatClient` becomes the only custom model-provider
     seam. It classifies failures as `open`, `composer_ready`,
     `prompt_insert`, `send`, `wait_response`, `extract`, `tool_projection`,
     or `schema_validate`. It may use short bounded mechanical waits inside the
     same operation, but it must not route to a fallback model, fallback
     planner, old runner, or weaker tool.
   - Acceptance: golden and live Copilot E2E tests prove that a valid Copilot
     turn succeeds, while invalid JSON, empty response extraction, prompt echo,
     selector drift, and response timeout all surface as failed Agent Framework
     runs with AG-UI error events and support-bundle diagnostics.

### P1: Tool Correctness And Safety

5. Fix exact `read` for Office/PDF files.
   - Current risk: the active `read` path treats files as bounded UTF-8 text.
     That is correct for plaintext/code, but not enough for `.xlsx`, `.xlsm`,
     `.docx`, `.pptx`, or `.pdf`.
   - Target: `read` returns bounded extracted plaintext or structured metadata
     for supported Office/PDF containers, using sidecar-owned extraction code or
     approved bundled readers.
   - Acceptance: golden tests prove `rg_files -> read -> final` can inspect
     `.xlsx`, `.docx`, `.pptx`, and text-layer `.pdf` fixtures, including a
     FlateDecode filtered PDF stream, without routing back to the deleted
     document-search engine.

6. Replace open-ended OfficeCLI argv planning with an OfficeCLI capability
   registry.
   - Current risk: Copilot can shape raw `officecli` arguments too directly,
     while a tiny manual allowlist would discard most of OfficeCLI's value.
   - Target: Relay maintains a broad OfficeCLI capability registry, populated
     from pinned OfficeCLI docs/help/schema where possible and normalized into
     typed semantic operations. The registry should cover discovery,
     inspection, validation, Excel workbook/sheet/cell/range/table/formula/
     style/data operations, Word document/text/table/style/review operations,
     PowerPoint slide/shape/text/media/layout operations, and cross-document
     export/convert/render/merge/split/batch/refresh/resident operations when
     the bundled OfficeCLI version supports them. Copilot may select only
     registry operations and typed args; Relay owns path, file type, selector,
     sheet/range/property validation, safety classification, and argv
     compilation.
   - Acceptance: Office tasks can use the broad OfficeCLI surface without
     exposing raw argv. Mutations create backups and approval cards, run
     post-apply verification, and fail closed on unsupported command families,
     ambiguous targets, unsafe paths, invalid schemas, or OfficeCLI version
     drift.

7. Make support bundle export explicit and redacted by default.
   - Current risk: a simple support-bundle endpoint can package run ledgers and
     event logs that include prompts, local paths, snippets, and tool output.
   - Target: support export is a state-changing `POST` or approval-gated UI
     action. Default bundles redact local paths and omit document contents.
     Full-content export requires explicit opt-in.
   - Acceptance: security smoke proves unauthenticated support export fails and
     default bundle output does not contain raw workspace document contents.
   - Current slice: complete. Default support bundles now run JSON-aware
     recursive redaction before free-text redaction. The security smoke seeds a
     fixture run ledger with local paths, instructions, document contents,
     stdout/stderr-like details, email addresses, tokens, and backup paths,
     then extracts the generated ZIP and proves default output contains only
     redaction markers.

8. Add generic verification and review tools for agentic coding and business
   tasks.
   - Current risk: `edit` and `write` can change files, but a generic agent also
     needs workspace state, diff review, and validation output to close the loop
     without falling back to an unrestricted shell.
   - Target: add `workspace_status`, `diff`, and bounded `run_command` tools.
     `run_command` supports build/test/lint/typecheck/format-check and explicit
     user-approved project commands through structured argv, timeout, output
     caps, cancellation, workspace containment, and deny rules for destructive,
     network, package-install, secret-reading, or cross-workspace behavior.
   - Acceptance: golden tests prove a coding task can inspect files, propose an
     exact edit, show a diff before approval, apply after approval, run a
     verification command, and feed the result back to Agent Framework for a
     final answer or next fix.

### P2: Search Performance And Argument Handling

9. Stream and cap ripgrep output before buffering.
   - Current risk: `rg_files` and process helpers can read all stdout before
     applying Relay caps, which can stall on very large shared folders.
   - Target: pass include/exclude/depth filters into ripgrep where possible,
     stream stdout, stop after the result cap, and kill the process on timeout
     or cancellation.
   - Acceptance: large-tree smoke fixture proves `rg_files` returns capped
     results within budget and cancellation stops the process.

10. Harden `rg_search` argv construction.
   - Current risk: search patterns that begin with `-` can be interpreted as
     ripgrep options.
   - Target: always pass a `--` separator before the user/model pattern and
     validate includes/excludes separately from the pattern.
   - Acceptance: regression test covers a pattern beginning with `-` and
     confirms it is treated as a pattern, not an option.

### P3: UX Trace Reliability

11. Deduplicate Workbench events by run sequence, not display text.
   - Current risk: repeated legitimate status messages can disappear if the UI
     deduplicates on message/detail text.
   - Target: event identity is `runId + sequence`; text-level dedupe is only a
     rendering convenience after sequence processing.
   - Acceptance: UX E2E fixture with repeated status messages shows all ordered
     events in the details trace and no duplicate final cards.

### Documentation And Plan Hygiene

- `AGENTS.md` in this repository already reflects the sidecar/workbench
  architecture. Any older pasted rule set that references `apps/desktop`,
  Tauri as active, or OpenCode/OpenWork as substrate is obsolete and must not
  steer implementation.
- `PLANS.md`, `README.md`, and `docs/IMPLEMENTATION.md` must keep the same
  active architecture story: one browser Workbench, one .NET sidecar,
  Microsoft Agent Framework as backend runtime, M365 Copilot through Relay's
  CDP adapter as planner, and Relay as local tool governance/execution layer.
- Completed migration tasks may remain as historical context below, but new
  implementation work should prioritize the P0/P1/P2/P3 remediation items
  above before expanding the tool catalog.

## Hard Cutover Rules

- No transitional fallback architecture. The migration is complete only when
  the new browser-hosted workbench and .NET sidecar are the single active
  product path.
- No simplified throwaway MVP. The first implementation slice must be shaped as
  the final architecture: sidecar-hosted UI, local HTTP/WebSocket APIs,
  Microsoft Agent Framework runtime, Relay Copilot adapter, generic tool
  catalog, approval flow, and packaging plan.
- No AionUi, OpenCode/OpenWork, Codex app-server, or Tauri runtime fallback in
  active product code. Historical docs may remain archived, but active source,
  package scripts, workflows, release resources, runtime launchers, and UI
  code must not depend on those paths.
- No silent fallback runtimes. If Copilot output, tool arguments, tool
  availability, workspace access, OfficeCLI readiness, or CDP automation fails
  validation, the run stops with a clear user-visible error. Bounded retries
  inside the same Copilot transport, such as paste retry, response candidate
  scoring, or one JSON repair turn, are allowed when they are logged and do not
  switch to an alternate runtime or weaker tool path.
- No hidden compatibility shims. Compatibility code is allowed only as a
  temporary migration aid inside a single branch while replacing callers; it
  must be removed before the cutover is marked complete.
- No old high-level workflow runners as backup paths. Search, Office editing,
  and code editing must run through the common agent runner and generic tools.
- Cutover completion requires deletion evidence: source search and release
  inventory must prove that active AionUi/OpenCode/OpenWork/Tauri paths are
  gone or archived-only.

## Prior-Art-Informed Additions

The browser-hosted sidecar design should adopt AG-UI as the Workbench-facing
protocol and UX contract, while incorporating lessons from Microsoft Agent
Framework, ASP.NET Core, and established agent tools without making Python or a
second agent runtime mandatory.

### Agent UI protocol

- Use AG-UI, not an unstructured ad hoc log stream, for the workbench/agent
  boundary. Relay should expose one AG-UI run stream and remove the current
  custom Workbench event protocol as a public API.
- Adopt AG-UI human-in-the-loop semantics for Office/code approvals. Approval
  cards are AG-UI interrupts; approve/reject is AG-UI resume input; Relay still
  enforces whether the operation is allowed.
- Use AG-UI state snapshot/delta events for workspace, selected files,
  pending approval, changed artifacts, and final answer state instead of
  inventing parallel state synchronization messages.
- Keep plain local HTTP APIs for non-agent app operations such as workspace
  selection, app status, logs export, static file serving, and shutdown.
- Use SignalR or raw WebSockets only if SSE cannot satisfy a specific future
  requirement. Do not maintain parallel event protocols for the same run
  lifecycle.

### AG-UI frontend and visual adoption

- The Workbench visual layer should be rebuilt around the AG-UI frontend
  ecosystem rather than a custom event renderer. The target implementation
  stack is React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Radix UI +
  `@ag-ui/client`.
- Study the official AG-UI Dojo and CopilotKit AG-UI examples as the visual
  baseline for chat, streaming answer, tool activity, shared state, and
  human-in-the-loop approval surfaces. Adopt the interaction patterns, not
  their marketing chrome.
- Use shadcn/ui and Radix UI for accessible primitives and owned component
  source. Tailwind CSS provides the styling layer and design tokens. Do not use
  Chakra UI as the default design system, and do not introduce Next.js unless a
  later requirement needs a real Next server or static-export-only benefit that
  Vite cannot provide.
- Relay visual constraints remain: one workspace, one composer, large
  whitespace, subdued borders, no mode buttons, no model/provider controls,
  no decorative gradients, and diagnostics collapsed by default.
- AG-UI component adoption must not weaken Relay policy. Tool execution,
  approval requirements, workspace containment, and support-bundle privacy stay
  in the sidecar governance layer.

### Local web app security

- Bind the workbench server to `127.0.0.1` by default. Do not listen on LAN
  interfaces unless a future explicit setting and security review adds it.
- Use a random per-run local access token in the launch URL and require it on
  every state-changing API request and event stream.
- Validate `Origin` / `Host` headers for browser requests. Reject cross-origin
  requests that do not match the launched workbench origin.
- Do not rely on browser cookies alone for local authentication. Localhost apps
  are still web apps and must guard against CSRF-style requests.
- Disable directory listing for static assets and expose only the built
  workbench bundle.
- Treat file paths, tool observations, and logs as sensitive local data. Never
  expose them through unauthenticated endpoints.

### Run lifecycle and state

- Implement an append-only run ledger in user-local Relay data:
  user message, Copilot steps, tool calls, observations, approvals, errors,
  final answer, and artifact paths.
- Support cancellation and clear terminal states (`completed`, `cancelled`,
  `failed`). A cancelled run must stop further tool execution.
- Add single-instance and port management: lock file, selected port record,
  stale process cleanup, browser-open retry, and graceful shutdown.
- On restart, show incomplete runs as recoverable history, not as active
  hidden background work.

### Observability and supportability

- Add first-class run IDs and trace IDs. Every Copilot request, tool call,
  approval, validation failure, and file mutation should be tied to the same
  run ID.
- Capture Relay traces in an OpenTelemetry-compatible shape where practical,
  while keeping the user UI minimal. The visible UI shows only concise
  progress; detailed traces live behind a collapsed details panel and
  support-log export.
- Add a local support bundle export that redacts or clearly flags sensitive
  file paths and does not include document contents unless the user explicitly
  chooses to include them.
- Add readiness probes for Copilot CDP, ripgrep, OfficeCLI, workspace access,
  static asset integrity, and tool catalog load. Startup should show a concise
  not-ready state rather than accepting tasks that cannot run.

### Change provenance and recovery

- For code work inside a git repository, record pre-run `git status`, planned
  edits, applied edits, post-run `git diff`, and dirty-file warnings. Relay
  should not auto-commit by default, but it should make review and undo
  straightforward.
- For non-git workspaces, record file hashes before mutation and keep explicit
  backup files in user-local Relay data or a user-approved backup location.
- For Office mutations, keep the current backup-before-apply policy and add an
  operation manifest that records the OfficeCLI command, target file, backup
  path, timestamp, and result.
- Provide a visible `元に戻す` path only when Relay has enough backup/diff
  evidence to restore safely. Do not fake undo for operations that are not
  reversible.

### Sandbox and command policy

- Keep unrestricted shell out of the default tool catalog. Prior agent systems
  distinguish isolated/container runtimes from direct process execution because
  direct local execution can read/write anything the user account can access.
- If shell execution is ever added, it must be a separate milestone with an
  explicit sandbox strategy, workspace mount policy, command allow/deny policy,
  and UI approval model. It must not appear as a hidden capability of the
  initial generic runner.
- Treat OfficeCLI and ripgrep as named tools with bounded argv validation, not
  as a generic shell escape hatch.

### Tool and approval policy

- Follow the proven pattern from coding agents: read-only inspection may run
  automatically inside the selected workspace; any mutation requires explicit
  approval.
- Do not add a broad user-facing auto-approve settings panel. It increases
  complexity and risk. Start with fixed policy: reads allowed, writes require
  approval, shell absent by default.
- Approval cards must show the exact operation, target path, backup/diff
  outcome where applicable, and the consequence of applying it.
- Tool policies are enforced by Relay, not trusted to Copilot prompts.

### Packaging and supply chain

- Use self-contained .NET publish targets for Windows and Linux so end users do
  not need to install .NET separately.
- Include static web assets in the sidecar package or alongside it with
  integrity checks.
- Windows distribution should use a user-scope NSIS installer for the sidecar
  Workbench. The installer must not require administrator rights, elevation,
  or the user's personal password.
- Produce a release inventory/SBOM-style artifact listing bundled binaries,
  licenses, hashes, and removed legacy components.
- Package ripgrep and OfficeCLI explicitly where licensing and platform support
  allow; otherwise fail readiness visibly with installation guidance. Do not
  silently fall back to slower or weaker implementations.

## 2026-05-16 Web-Researched Requirements Addendum

The following requirements are added after reviewing current Microsoft Agent
Framework, AG-UI, Edge DevTools Protocol, MCP, OWASP LLM security, and SBOM
guidance. These are product requirements where they describe Relay-owned
behavior; third-party framework adoption remains optional unless a later ADR
promotes it.

Reference anchors:

- ASP.NET Core Minimal APIs and localhost URL binding:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis`
- ASP.NET Core static files and directory browsing behavior:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files`
- .NET self-contained deployment:
  `https://learn.microsoft.com/en-us/dotnet/core/deploying/`
- Microsoft Agent Framework human-in-the-loop approval docs:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`
- Microsoft Agent Framework tool calling docs:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- Microsoft Agent Framework 1.0 announcement:
  `https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/`
- Microsoft Agent Framework durable execution docs:
  `https://learn.microsoft.com/en-us/azure/durable-task/sdks/durable-agents-microsoft-agent-framework`
- Microsoft Agent Framework + AG-UI demo:
  `https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/`
- AG-UI protocol overview:
  `https://docs.ag-ui.com/introduction`
- AG-UI event model:
  `https://docs.ag-ui.com/sdk/js/core/events`
- AG-UI events concept docs:
  `https://docs.ag-ui.com/concepts/events`
- Microsoft Edge DevTools Protocol docs:
  `https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/`
- ASP.NET Core host filtering docs:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering`
- Microsoft Agent Framework MCP guidance:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools`
- Claude Code settings and permission model reference:
  `https://code.claude.com/docs/en/settings`
- MCP client/security best-practice docs:
  `https://modelcontextprotocol.io/docs/develop/clients/client-best-practices`
  and
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- OWASP LLM06 Excessive Agency:
  `https://genai.owasp.org/llmrisk/llm062025-excessive-agency/`
- OWASP Top 10 for LLM Applications project:
  `https://owasp.org/www-project-top-10-for-large-language-model-applications/`
- OpenAI prompt-injection safety overview:
  `https://openai.com/safety/prompt-injections/`
- ripgrep user guide:
  `https://ripgrep.dev/docs/guide/`
- NSIS `RequestExecutionLevel` docs:
  `https://nsis.sourceforge.io/Reference/RequestExecutionLevel`
- NSIS `MultiUser.nsh` per-user installation docs:
  `https://nsis.sourceforge.io/Docs/MultiUser/Readme.html`
- NIST SBOM guidance:
  `https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-security-supply-chains-software-1`

### Agent harness and event protocol requirements

- Use Microsoft Agent Framework in the .NET sidecar as the production harness
  for the generic agent loop. Its responsibilities are agent turns, tool-call
  detection, typed function dispatch, sessions, middleware, approval
  pause/resume, streaming updates, durable run state, and final answer
  synthesis.
- Relay remains the local governance layer around Agent Framework, not a
  competing orchestrator. Relay owns the M365 Copilot CDP provider adapter,
  workspace containment, local function bodies, backups, diffs, support
  bundles, and packaging.
- Implement tools as Agent Framework function tools first. Use
  `AIFunctionFactory.Create` with typed parameters and descriptions for
  in-process tools. Use `ApprovalRequiredAIFunction` for write/mutation tools.
  Add Relay middleware only for policy checks, logging, diagnostics, and
  Copilot transport adaptation.
- Do not add a parallel Relay-owned workflow runner, Python runner, OpenCode
  runner, or direct ad hoc AG-UI runner as a fallback. If Agent Framework cannot
  express a required Relay behavior, add a narrow adapter or middleware around
  Agent Framework and document the gap.
- Copilot transport failures are product failures, not alternate-route
  triggers. Prompt delivery failure, send failure, response extraction failure,
  invalid JSON, stale response pickup, or selector drift must fail the run with
  AG-UI error events and diagnostics so developers can fix the adapter.
- Implement human-in-the-loop approval as a loop, not as a single callback:
  when Agent Framework emits an approval request for a mutation function, the
  UI pauses the same run, presents the approval through AG-UI, and resumes only
  after approve/reject.
- Use AG-UI events for the Workbench run stream. Required event coverage
  includes run lifecycle, text message streaming, tool call start/args/result,
  state snapshot/delta, approval interrupt/resume, artifact creation, errors,
  cancellation, and completion.
- Keep the visible UI minimal, but preserve enough typed event metadata for
  replay, support export, and evaluation. Do not create a second event stream
  for the same run.
- Implement local durable-equivalent behavior: append-only run ledger,
  checkpointed observations, pause/resume, cancellation, terminal states, and
  retention/TTL cleanup in user-local data.

### Governance, security, and prompt-injection requirements

- Enforce action-layer governance before every tool execution. Relay must
  evaluate tool name, arguments, workspace scope, write/mutation status,
  approval state, rate limits, and policy before execution. Copilot prompts are
  not a security boundary.
- Minimize agency by default:
  - expose only the generic tools required for the task;
  - keep unrestricted shell absent from the default catalog;
  - require explicit approval for all writes, Office mutations, external
    network access, and future shell execution;
  - fail closed when tool selection or arguments are invalid.
- Treat all file contents, tool outputs, MCP/tool descriptions, and Copilot
  responses as untrusted data. They may be summarized or inspected, but they
  must never be allowed to change Relay policy, enable tools, bypass approval,
  change workspace scope, or alter system instructions.
- Add an explicit prompt-injection test corpus:
  local documents that instruct the agent to ignore policy, leak paths, enable
  shell, edit unrelated files, or exfiltrate content must not change Relay's
  execution policy.
- Add sensitive-data controls:
  support bundles redact or clearly flag local paths and omit document content
  by default; logs store tool metadata and bounded snippets only unless the
  user explicitly opts into full-content export.
- Strengthen localhost web security:
  keep loopback binding; require the launch token on APIs and event streams;
  validate `Host` and `Origin`; reject unauthenticated API calls; disable
  directory listing; and serve only the built static bundle.

### Tool discovery, MCP, and external tool requirements

- Keep the initial production catalog small but complete enough for a generic
  local agent: `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
  `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
- Add progressive tool discovery only when the catalog grows beyond the small
  always-on set. If adopted, expose a stable meta-tool such as `search_tools`
  and inject full schemas only for selected tool families. Do not churn the
  whole tool list every turn.
- MCP is not part of the first production tool surface. If later adopted:
  - allow only trusted, local, explicitly configured MCP servers by default;
  - never auto-install or auto-connect remote MCP servers;
  - log and audit every server, tool list, schema change, and tool call;
  - treat sessions as state handles, not authentication;
  - apply the same Relay approval and workspace policy to MCP tool calls as to
    built-in tools.
- Do not expose programmatic/code-mode tool calling until Relay has a sandbox
  design. The MCP guidance shows why code-mode can reduce token usage, but it
  requires a real sandbox and must not become an implicit unrestricted shell.

### Generic agent recipe requirements

These are not separate modes. They are common recipes that prove the generic
Agent Framework + Relay tool model is capable enough for real work.

- Local file search recipe:
  - Copilot chooses discovery terms and whether filename search, content search,
    or exact reads are needed.
  - Relay executes `rg_files`, `rg_search`, and `read` with caps, workspace
    containment, and evidence states.
  - Copilot synthesizes only from Relay observations. It must separate
    confirmed evidence from candidates and ask for follow-up search/read when
    the result set is skewed or weak.
- Office file editing recipe:
  - Copilot inspects the target Office file through `read` or registry-backed
    OfficeCLI inspection operations.
  - Relay compiles typed Office capability-registry operations to OfficeCLI
    argv, creates a backup, emits an AG-UI approval interrupt, applies only
    after approval, and verifies with a post-apply OfficeCLI view/read/render
    where available.
  - The Office registry must be broad enough to use OfficeCLI's agent-facing
    surface for Word, Excel, PowerPoint, and cross-document workflows, while
    still fail-closing on unknown command families, unsupported properties,
    ambiguous targets, unsafe paths, or OfficeCLI version drift.
  - Invalid sheet names, ambiguous ranges, missing OfficeCLI, and smoke failures
    fail the Office task clearly without degrading unrelated agent tasks.
- Coding recipe:
  - Copilot explores with `rg_files`, `rg_search`, `read`, and
    `workspace_status`.
  - Relay applies only validated `edit`/`write` mutations after approval and
    shows `diff` before and after mutation.
  - Copilot may request `run_command` for bounded verification, then iterate on
    failures through the same Agent Framework loop.
- General task recipe:
  - When a task does not fit search, Office, or coding, Copilot should still use
    the same generic inspect, mutate, verify, ask, and final-answer tools. Do
    not add a new mode unless a reusable tool family is genuinely missing.

### Copilot CDP reliability requirements

- Treat Edge CDP as a browser automation transport, not a stable Microsoft 365
  Copilot product API. Every release must include a live canary or manually
  recorded validation showing:
  - Copilot tab discovery or creation;
  - prompt paste reaches the composer;
  - send action succeeds;
  - stop/send button lifecycle or feed update is observed;
  - response extraction returns only the assistant answer, not sidebar/history
    chrome.
- Add DOM-contract regression fixtures from successful live sessions. The
  sidecar should keep selector candidates versioned and tested against saved
  feed/composer snippets so future Copilot DOM changes fail in CI before
  release when possible.
- Add visible CDP failure classes:
  `edge_not_running`, `cdp_unreachable`, `copilot_not_signed_in`,
  `composer_not_ready`, `prompt_not_pasted`, `send_unavailable`,
  `response_timeout`, and `response_parse_failed`.
- Start Edge/Copilot lazily and independently from Workbench first paint, but
  prewarm as soon as the user focuses the composer or starts a run. The UI must
  show `Copilot 接続中` rather than appearing frozen.

### Evaluation and release-readiness requirements

- Add a golden evaluation suite for the unified agent runner. Minimum cases:
  - file search chooses `rg_files`/`rg_search`/`read` and does not use
    Microsoft 365 built-in search; results distinguish filename candidates from
    content-confirmed evidence;
  - Office inspection uses `read` or semantic `officecli` view operations and
    Office mutation pauses for approval before execution, creates a backup, and
    verifies after apply;
  - code editing reads relevant files, proposes exact validated edits, shows a
    diff, applies only after approval, runs a bounded verification command when
    appropriate, and either fixes failures or reports them clearly;
  - a non-search/non-Office/non-code task can still use the generic inspect,
    mutate, verify, ask, and final tools without introducing a new UX mode;
  - invalid tool names or invalid arguments stop visibly;
  - prompt-injected file content cannot change policy;
  - repeated Copilot answer text does not cause stale response extraction.
- Evaluate tool calls on correctness, argument validity, intent alignment,
  dependency ordering, failure handling, and traceability. These criteria must
  be captured in machine-readable test output, not only manual notes.
- Add release canaries:
  - mock Copilot path for deterministic CI;
  - live signed-in Copilot CDP path when a signed-in Edge session is available;
  - OfficeCLI smoke on each packaged platform where OfficeCLI is supported;
  - ripgrep smoke from packaged resources and PATH.
- Generate a release SBOM or SBOM-style inventory in addition to the current
  release inventory. It must include direct dependencies, bundled binaries,
  hashes, versions, license/source notes, and an explicit list of intentionally
  excluded legacy runtimes.
- Make `docs/IMPLEMENTATION.md` record each requirement-level verification
  command and result. A task is not complete until the artifact or test output
  exists.

## AG-UI Workbench UX Plan

The integrated UX should be AG-UI-first and should feel like a quiet
professional workbench, not a developer console and not a wizard. AG-UI is the
source of truth for agent interaction structure; Relay's visual layer should
apply that structure with restrained enterprise styling.

Target frontend stack:

- React + Vite + TypeScript.
- Tailwind CSS for layout, spacing, typography, and design tokens.
- shadcn/ui for owned, editable component source.
- Radix UI for accessible primitives and focus/keyboard behavior.
- `@ag-ui/client` for the agent protocol runtime.
- lucide-react for icons.
- No Next.js by default; no Chakra UI by default.

### Layout

- Top bar: Relay mark, current workspace, compact Copilot/agent readiness.
- Main canvas: centered single column, `960-1040px` max width on desktop.
- AG-UI message thread: streaming assistant output, tool activity, and run
  status rendered from AG-UI events.
- Composer: one large natural-language input with one primary send action,
  connected to the AG-UI client runtime.
- Tool activity: concise AG-UI tool-call timeline, collapsed by default after
  completion.
- Approvals: AG-UI interrupt cards visible only when a local write/mutation is
  pending.
- State/results: AG-UI state snapshot/delta renders selected files, artifacts,
  changed paths, Office operation results, and final answer cards.
- Details: raw AG-UI event stream, observations, diagnostics, and logs are
  collapsed by default.

### Spacing and visual rules

- Use AG-UI/CopilotKit/Dojo agent UI patterns as the visual interaction
  reference, then strip them down to Relay's professional local-workbench
  surface.
- Use generous page margins: at least `32px`, and `56-80px` on wide displays.
- Use subdued panels and borders rather than heavy shadows.
- Keep cards at 8px radius or less.
- Keep result rows scannable; do not pack every metadata field into the first
  view.
- Prefer small section labels and restrained typography over large marketing
  headings.
- Use Relay design tokens for brand and spacing only where they do not conflict
  with AG-UI component structure. Do not fork AG-UI behavior to preserve old
  CSS.
- Avoid AI-purple gradients, decorative blobs, emoji icons, and tutorial copy.

### Interaction model

Initial state:

```text
Workspace: .../160連結

何をしますか？
[ 部品売上に関するファイルを探して                    ][送信]
```

During execution:

```text
assistant message stream
tool_call: rg_files
tool_result: candidates found
tool_call: read
state_delta: candidate evidence updated
```

Before a write:

```text
実行前に確認してください

Book2.xlsx
Sheet1 / A1 の塗りつぶしを赤に変更

[実行] [キャンセル]
```

Completed:

- Show the final answer first.
- Show result cards, changed files, or Office edit outcome below.
- Keep trace/details collapsed unless the user expands them.
- The visible result must be reconstructable from AG-UI messages, tool events,
  state events, and interrupts/resume events.

### Smooth UX acceptance requirements

The Workbench must be validated as a user-facing product, not only as a
backend agent API.

- First paint and entry route:
  - the launch URL `/` with the relay token must render the Workbench, not a
    404, browser error page, Edge Copilot page, or diagnostic console;
  - the first visible surface must be usable without opening details or logs;
  - static asset directory listing must remain blocked while the root route
    still serves the app.
- Readiness:
  - readiness must not collapse all tool checks into one misleading
    `Not ready` state;
  - use `Ready` when all checked tools are available, `Limited` when Copilot
    is available but optional tool checks fail, and `Not ready` only when the
    agent cannot accept tasks;
  - the composer remains understandable in `Limited` state and the detailed
    missing-tool reasons stay in collapsed details.
- Task flow:
  - a read-only task submitted from the composer must visibly progress to a
    final answer without mode selection;
  - a write/mutation task must pause before mutation, show one concise approval
    AG-UI interrupt card, and never create or modify a file before approval;
  - after approval, the approval card must disappear and the completed result
    must be visible without requiring the user to inspect raw JSON.
- AG-UI behavior:
  - run lifecycle, message streaming, tool activity, approval interrupts,
    resume, errors, cancellation, and final output must render from AG-UI
    events;
  - no Workbench-only custom event field may be required to show the main user
    experience;
  - raw Relay run ledger data may exist only behind diagnostics/support export.
- Visual behavior:
  - legacy mode labels such as `資料を探す`, `Officeファイルを編集する`, and
    `コードを書く` must not appear in the unified Workbench;
  - details, raw observations, and diagnostics remain collapsed by default;
  - the focused work area should stay within roughly `960-1040px` on desktop
    and preserve generous whitespace.
- Responsiveness:
  - deterministic mock E2E should complete read-only final-answer display and
    approval-card display within `6s` each;
  - the test must save screenshots for empty, completed, and approval states
    so spacing regressions can be inspected.
- Regression gate:
  - `pnpm workbench:ux-e2e` is the browser-level UX smoke gate. It launches
    the sidecar, opens Microsoft Edge through CDP, performs a real DOM-driven
    submit/approval flow, and writes screenshots under `dist/e2e/`.
  - `pnpm check` remains the non-browser acceptance gate; UX E2E is run when
    verifying user-visible flow changes or release readiness on machines with
    Edge available.

### Live Copilot UX requirements

Mock E2E is not enough for release confidence. Relay must also prove that the
same Workbench flow can drive a signed-in M365 Copilot session.

- Live gate:
  - `pnpm workbench:live-copilot-e2e` is the signed-in Copilot UX gate.
  - It must run with mock Copilot disabled and `RELAY_COPILOT_CDP_PORT`
    pointing at a real signed-in Microsoft Edge CDP session.
  - The Workbench browser and the Copilot browser must use separate CDP ports
    and profiles so user-facing UI automation cannot disturb the controlled
    Copilot tab.
- What it must prove:
  - `/api/status` reports Copilot CDP reachable before accepting the run;
  - the Workbench readiness pill reaches `Ready` or `Limited`, not a frozen
    `Checking` state;
  - the user can submit a task from the single composer;
  - Relay can paste the prompt into Copilot, submit it, wait for completion,
    extract the assistant response, and display the final event in the
    Workbench;
  - diagnostics/details remain collapsed by default after completion;
  - a screenshot of the completed live Copilot run is captured under
    `dist/e2e/`.
- Smoothness target:
  - for a short exact-response prompt, live Copilot final-answer display should
    complete within `15s` on a signed-in warm Edge session;
  - `15-30s` is acceptable but should be flagged as degraded;
  - over `30s`, prompt delivery failure, stale response extraction, or
    completion detection must be treated as a UX regression unless Microsoft
    365 service latency is clearly isolated.
- Failure requirements:
  - if the CDP port is unreachable, the run fails with a clear `Copilot CDP is
    not reachable` message;
  - if Copilot is signed out, blocked by tenant policy, or the composer cannot
    be found, the UI must show a visible actionable error and must not silently
    retry forever;
  - invalid Copilot output may fail the run, but the user must see whether the
    failure was prompt delivery, send button, response timeout, JSON/action
    validation, or tool validation.
- Prompt and JSON robustness:
  - Copilot prompts must not include copyable placeholder answers such as
    `"Japanese answer"` that can be mistaken for valid output;
  - Relay must parse the first complete JSON object from a Copilot response so
    harmless trailing text does not break an otherwise valid action;
  - if multiple JSON objects or trailing prose appear, Relay uses only the
    first complete object and still validates action/tool/args before
    execution.
- Release policy:
  - deterministic mock UX E2E remains suitable for CI;
  - live Copilot E2E is required before release or after any change touching
    Copilot CDP selectors, prompt delivery, response extraction, readiness, or
    Workbench run rendering.

## Non-Negotiable Completion Criteria

- The first visible product surface is the Relay Workbench, not Edge Copilot,
  OpenCode Web, AionUi, Tauri shell, or a diagnostic console.
- The Workbench shell is browser-hosted local web UI served by Relay's sidecar.
  Tauri is not an optional wrapper or fallback in the final product.
- The user should be able to submit a natural-language task from a single
  composer without selecting a mode first.
- Copilot may choose local tools, but Relay is the only component that executes
  tools.
- File search must execute through Relay-owned local tools, primarily
  ripgrep-backed `rg_files` / `rg_search` plus exact `read`, not Microsoft 365
  built-in search, SharePoint search, or Copilot's own browsing.
- Office workflows must execute through OfficeCLI, not Microsoft 365 built-in
  editing or ad hoc shell scripts.
- Relay may introspect OfficeCLI help/schema output to keep the semantic
  operation registry aligned with the bundled OfficeCLI version, but Copilot
  must never emit or directly execute raw OfficeCLI argv.
- OfficeCLI availability must not be marked failed when the failure is caused
  by Relay's own smoke-test file locking. File-sharing violations during smoke
  checks are release blockers until the smoke harness is corrected.
- Code workflows must apply only validated exact-string patches inside the
  selected workspace, show diffs, and run only bounded verification commands.
  Copilot may not execute tools or edit files directly.
- Agentic workflows must keep Copilot's authority limited to structured
  planning and synthesis. Relay is the only component that executes tools.
- The installed application must be able to run without bundled Codex
  app-server, bundled OpenAI clients that require external credentials, or
  hidden third-party agent binaries.
- Ollama is out of current release scope. It must not appear as a readiness
  gate, model picker, hidden reasoning path, or fallback harness.
- Write actions for Office and code require explicit user approval in the UI.
- Runtime errors must be visible in the UI. Silent stalls are release blockers.
- Installer generation must not use the AionUi release workflow.

## Historical Work And Deletion Context

The repository previously contained active Tauri/AionUi/OpenCode/OpenWork and
document-search-specific code. Those implementations have been removed from the
active source path; remaining references in historical docs are archival only
and are not a source of product direction.

Active cutover facts:

- `apps/workbench/` is the active browser Workbench UI.
- `apps/sidecar/` is the active .NET sidecar, Copilot transport, run manager,
  and local tool executor.
- The active runtime exposes one generic agent loop and a small generic tool
  catalog. Search, Office editing, and code editing are capabilities within
  that loop, not separate product modes.
- Stable Copilot bridge behavior may be ported from old commits only when it
  improves the current sidecar transport. Do not revive the old Node/Tauri
  bridge, AionUi shell, per-mode prompt contracts, or document-search engine.

Historical material that must not remain on the active path:

- Tauri IPC commands, Tauri resource packaging, and Tauri release workflows.
- AionUi overlays, AionUi provider configuration, and OpenCode/OpenWork gateway
  scripts.
- `RelayDocumentSearch*` high-level engines, SQLite/FTS/index coordinators,
  reflection prompts, and search-specific ranking/classification contracts.
- UI mode runners for `資料を探す`, `Officeファイルを編集する`, and `コードを書く`.
- Archive prompt files or historical design docs that are not required at
  runtime.

The only search-related behavior to preserve in the active plan is the generic
principle: Copilot may plan local exploration, Relay executes `rg_files`,
`rg_search`, and exact `read`, and Relay returns structured evidence-state
observations for Copilot to synthesize.

## Cutover Implementation Tasks

This checklist records the cutover contract and regression criteria. Many
items have already been implemented in the active sidecar/workbench path; do
not restart from item 1 by reintroducing deleted architecture. New work should
start from the **Current Review Remediation Plan** unless a regression proves a
cutover criterion below is no longer satisfied.

1. Freeze and inventory old paths before coding:
   - Inventory all active references to AionUi, OpenCode, OpenWork, Codex
     app-server, Tauri, Tauri IPC, Tauri resources, and release workflows.
   - Classify each reference as `active product`, `test`, `archived historical
     doc`, or `third-party factual reference`.
   - Strengthen the hard-cut guard so it scans active source, workflows,
     scripts, release inputs, and packaged assets, not only root package
     scripts.
   - Update `AGENTS.md` and any source-of-truth docs that still instruct Relay
     to keep OpenCode/OpenWork or Tauri as active substrate.
2. Build the final Relay sidecar foundation, not a temporary prototype:
   - Create a self-contained .NET sidecar as the primary process.
   - Host the static Relay Workbench web UI from the sidecar.
   - Expose local HTTP/WebSocket APIs for sessions, tools, approvals, status,
     logs, workspace selection, and shutdown.
   - Port or replace the Copilot Edge/CDP bridge inside the sidecar boundary so
     there is one Copilot transport path.
   - Use Microsoft Agent Framework in the sidecar as the active agent harness.
     The old Relay-owned runner must not remain as a fallback once the
     migration is complete.
   - Move required runtime resources such as OfficeCLI or ripgrep bundles out
     of `apps/desktop/src-tauri` into a sidecar-owned `tools/` or
     `third_party/` location before deleting the desktop tree.
3. Build the final browser-hosted Workbench UI:
   - One natural-language composer, no visible task-mode buttons.
   - Workspace selector.
   - Concise agent status and trace.
   - Result cards for files, Office operations, and code changes.
   - Approval cards for every write/mutation.
   - Collapsed diagnostics/details only.
   - No AionUi, OpenCode, Tauri, provider, model, runtime, feedback, or debug
     chrome.
   - Keep reusable design guidance in `apps/workbench/` or `docs/`; do not
     depend on deleted desktop design files.
4. Implement the generic progressive tool catalog:
   - `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
     `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
   - Validate every argument before execution.
   - Implement path containment, size/time limits, cancellation, and structured
     observations.
   - Stop on validation failure; do not route to old search, Office, or code
     runners as fallback.
5. Implement the Agent Framework runtime, approval loop, and governance layer:
   - Replace any one-shot or per-mode flow with a bounded Agent Framework run
     loop that uses the Relay Copilot provider adapter.
   - Add sidecar tool wrappers for the generic Relay tools.
   - Add middleware/policy checks for allowed tools, workspace scope, mutation
     approval, rate limits, and audit logging.
   - Implement approval handling as a pause/resume flow in the same run
     session.
   - Stream run events to the Workbench through AG-UI.
6. Add durable local run state:
   - Append every user message, Copilot step, tool call, observation,
     approval, artifact, error, and final answer to a run ledger under
     user-local Relay data.
   - Support cancellation and terminal states.
   - On restart, display incomplete runs as recoverable history, not active
     hidden work.
   - Add retention/TTL cleanup for stale ledgers, temp files, and support
     bundles.
7. Migrate all capabilities onto the common agent runner:
   - File discovery/search through `rg_files`, `rg_search`, and `read`.
   - Office inspection/editing through `officecli` semantic operations and
     Relay-compiled commands.
   - Code inspection/editing through `rg_*`, `read`, `edit`, and `write`.
   - Remove the old per-mode runners after parity, not leave them callable.
8. Add Copilot CDP reliability hardening:
   - Version and test composer/feed selectors against saved DOM fixtures.
   - Add failure classes for Edge/CDP/Copilot readiness and prompt delivery.
   - Keep live signed-in CDP canary scripts for release validation.
   - Ensure response extraction never returns sidebar, history, suggestion, or
     empty assistant-turn text as the model answer.
9. Add security and prompt-injection regression tests:
   - Add fixture documents that attempt to override Relay policy.
   - Prove untrusted file/tool output cannot enable tools, bypass approvals,
     expand workspace scope, or alter system instructions.
   - Prove support bundle export redacts or omits sensitive content by default.
10. Replace packaging:
   - Remove Tauri release workflow as an active release path.
   - Package the .NET sidecar and static web assets for Windows as a
     user-scope NSIS installer. The installer must install under a user-writable
     location such as `%LOCALAPPDATA%\Programs\Relay Agent`, must not require
     administrator rights or UAC elevation, and must not ask for the user's
     personal Windows password.
   - Package Linux as a self-contained archive plus launcher.
   - Provide a Windows launcher that starts the sidecar, starts or checks the
     signed-in Edge CDP session, opens the localhost workbench, and shuts down
     cleanly.
   - Bundle required Windows runtime tools in the installer where licensing and
     platform support allow: `Relay.Sidecar.exe`, Workbench static assets,
     `rg.exe`, `officecli.exe`, launcher files, default config, license/notice
     files, release inventory, and SBOM-style metadata.
   - Add a dedicated packaging command such as
     `pnpm sidecar:installer:windows` and a GitHub Release workflow that uses
     that command instead of any Tauri installer workflow.
   - The installer must create Start Menu and optional desktop shortcuts, an
     uninstall entry, and per-user registry/app metadata only. It must not write
     machine-wide registry keys or require Program Files installation.
   - Keep all app data, cache, logs, and temp files in user-local Relay
     directories.
   - Generate SBOM/SBOM-style release inventory with hashes, versions,
     licenses/source notes, and intentionally excluded legacy runtimes.
11. Delete active obsolete code:
   - Remove AionUi overlay code, OpenCode/OpenWork provider gateway code,
     Tauri shell/IPC/resources/workflows, and old high-level workflow runners
     once the new path is wired.
   - Remove `apps/desktop/document-search-src` and any active
     `RelayDocumentSearch*` code after confirming the generic `rg_*`/`read`
     tools cover the active search path.
   - Archive historical docs only when useful; do not keep active package
     scripts or tests that exercise removed runtime paths.
12. Verify the hard cutover:
   - Playwright screenshots for the browser-hosted workbench at desktop and
     narrow widths: empty, running, result, approval, error.
   - Linux and Windows E2E for startup, browser launch, Copilot connection,
     tool choice, approvals, search, Office inspect/edit where supported, code
     edit, shutdown, and uninstall.
   - E2E for security boundaries: localhost binding, launch token required,
     Origin/Host rejection, static asset directory listing disabled, and
     unauthenticated API rejection.
   - E2E for run lifecycle: cancellation stops tools, restart shows incomplete
     runs as history, and support bundle export works without leaking document
     contents by default.
   - E2E for change provenance: code diff capture, Office backup manifest,
     reversible undo where supported, and clear no-undo messaging where not
     supported.
   - Source and release inventory proving active AionUi/OpenCode/OpenWork/Tauri
     paths are removed.
   - Failure-path tests proving invalid Copilot/tool output stops with visible
     errors and does not invoke fallback execution.
   - Golden agent evaluations for tool choice correctness, argument validity,
     intent alignment, dependency ordering, failure handling, traceability, and
     prompt-injection resistance.
13. Complete the Relay rebranding cleanup:
   - Rename Relay-owned archive prompt files currently named
     `docs/archive/CODEX_PROMPT_*.md` / `docs/archive/codex_*.md` to
     `RELAY_PROMPT_*.md` / `relay_*.md`, preserving history in Git rather than
     deleting the files.
   - Update internal links and references that point to those renamed archive
     files.
   - Replace user-facing prose that says `Codex` when it means the Relay
     product, Relay implementation agent, or historical Relay prompt artifact.
   - Do not rename or rewrite references where `Codex` is an upstream
     dependency or required configuration surface, including `Codex app-server`,
     `codex` CLI commands, `CODEX_HOME`, external docs, and compatibility notes
     about third-party behavior.
   - Add a verification note showing the remaining `codex` / `Codex` matches
     are only upstream references or intentionally archived historical wording.
14. Add a corporate-compliance packaging review:
   - Inventory every release resource, executable, npm package, generated
     file, config directory, environment variable, and runtime process name that
     contains `codex`, `Codex`, OpenAI, OpenCode, or OpenWork terminology.
   - Classify each match as `Relay-owned branding`, `upstream dependency`,
     `developer-only artifact`, `archived historical doc`, or `runtime-required
     integration name`.
   - Remove developer-only and archived prompt artifacts from release bundles
     unless they are explicitly needed at runtime.
   - Do not bundle upstream `codex` CLI/app-server, OpenCode, or OpenWork in
     the release.
   - Implement Relay/Copilot integration through Microsoft Agent Framework in
     the Relay sidecar instead of hidden third-party agent artifacts.
   - Add a release verification artifact that lists remaining matches and their
     classification, plus the reason each one is acceptable for installation.
15. Keep out-of-scope model/harness options outside the cutover:
   - Microsoft Agent Framework is the approved backend harness. Do not add
     Ollama, MCP, unrestricted shell execution, Python workflow wrappers, or a
     second agent harness to the current release scope.
   - If one of those options is reconsidered later, require a separate ADR with
     threat model, packaging impact, UX impact, verification gates, and removal
     criteria for any replaced code path.
   - The current cutover completes only when Microsoft Agent Framework in the
     Relay sidecar, the M365 Copilot adapter, generic local tools, and browser
     Workbench are the single active product path.

## Verification Gates

- `pnpm check`
- `pnpm release:inventory`
- AG-UI adoption gates:
  - Workbench-facing run stream emits AG-UI events, not the old custom
    `RunEvent` wire union;
  - AG-UI message/tool/state/interrupt/resume/completion events can replay a
    run from start to final answer;
  - browser E2E proves the AG-UI Workbench renders streaming output, tool
    activity, approval interrupt, resume, cancellation/error, and final answer;
  - screenshots prove the AG-UI-based visual surface keeps Relay's minimal,
    spacious, professional UX.
- Workbench visual smoke: browser-hosted local UI screenshots for empty,
  running, approval, completed, and error states.
- Sidecar security smoke:
  - loopback-only binding;
  - launch token required;
  - Host/Origin rejection;
  - unauthenticated API/event-stream rejection;
  - static directory listing unavailable.
- Agent runner golden evaluations:
  - correct tool family chosen;
  - arguments valid and workspace-scoped;
  - mutation pauses for approval;
  - file search separates candidates from confirmed evidence;
  - Office edits create backups, apply semantic operations, and verify after
    mutation;
  - coding tasks expose workspace status, diff, bounded command verification,
    and follow-up repair when verification fails;
  - invalid Copilot output stops visibly;
  - prompt-injected file/tool content cannot change policy.
- CDP reliability gates:
  - mock Copilot path for CI;
  - live signed-in Edge/CDP exact-response canary when available;
  - saved DOM fixture tests for composer/feed extraction.
- Tool readiness gates:
  - packaged ripgrep smoke;
  - OfficeCLI `view outline --json` smoke where OfficeCLI is supported;
  - OfficeCLI smoke file cleanup and retry on transient sharing violations.
- Release supply-chain gates:
  - sidecar Windows/Linux self-contained publish;
  - Windows user-scope NSIS installer build;
  - installer smoke proving no administrator rights, UAC elevation, personal
    password prompt, Program Files install, or machine-wide registry writes;
  - release inventory;
  - SBOM/SBOM-style dependency and binary inventory;
  - legacy runtime exclusion inventory.
- Agent Framework sidecar smoke:
  - local mock Copilot adapter returns expected Agent Framework response;
  - Agent Framework function tools are registered from typed Relay functions,
    and the run fails if Copilot tool projection cannot produce valid
    Microsoft.Extensions.AI tool-call content;
  - current bridge smoke proves mutating function tools use
    `ApprovalRequiredAIFunction` and do not execute before approval;
  - final approval cutover smoke proves AG-UI approval requests resume through
    Agent Framework approval response content and no longer use Relay's custom
    `PendingApproval` wire protocol;
  - final session smoke proves Agent Framework `AgentSession` state is
    persisted enough to resume an approval and to keep tool observations
    attached to the same run;
  - live Edge CDP -> M365 Copilot exact-response canary passes when a signed-in
    session is available;
  - generic tool-choice smoke covers `rg_files`/`rg_search`/`read`,
    `officecli`, `edit`/`write`, `workspace_status`, `diff`, `run_command`,
    and approval behavior.
- Sidecar release workflow: Windows publishes the user-scope NSIS installer;
  Linux publishes the sidecar archive/launcher. Neither path may package the
  removed Tauri/AionUi/OpenCode/OpenWork runtime.
