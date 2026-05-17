# Relay_Agent Execution Tasks

Date: 2026-05-17

## Active Goal

Move Relay away from a growing Relay-specific tool/runtime design and toward an
OpenCode-compatible local tool contract hosted by Microsoft Agent Framework and
projected through AG-UI.

Relay still uses M365 Copilot through Edge CDP as the reasoning controller.
Relay should not adopt Codex app-server as the runtime in this task queue, but
Codex app-server remains useful prior art for approvals, sessions, tool
results, sandboxing, streaming, and diagnostics.

## Execution Rules

- Execute tasks in order unless a task explicitly says it can run in parallel.
- Do not add new model-visible Relay-specific tool names.
- Do not fix Copilot mistakes by adding broad prompt-only folklore.
- Prefer Agent Framework function/MCP tools and middleware for tool admission,
  approval, terminal eligibility, and tool-result feedback.
- Keep AG-UI as the only frontend run/event/state/approval protocol.
- Every completed task must update `docs/IMPLEMENTATION.md` with the artifact
  and verification result.
- Run at least `pnpm check` before marking a milestone complete.

## Task Queue

The `HARN*` queue below is now the active task queue. The older `OCT*` queue
remains as historical context for completed tool-contract work, but it is
superseded where live Copilot E2E later exposed harness-level defects. In
particular, any old completion marker that implies complex live E2E is solved
must be treated as historical until `HARN09` passes.

### HARN01 - Write Harness Architecture ADR

Status: completed

Scope:

- Create `docs/HARNESS_ARCHITECTURE.md`.
- Map OpenCode semantics to Microsoft Agent Framework constructs:
  - tools and permissions;
  - session continuity;
  - approval pause/resume;
  - tool observations;
  - compaction;
  - final eligibility;
  - AG-UI projection.
- Record why Relay is not adopting Codex app-server or OpenCode runtime
  binaries in this milestone.
- Record the hard boundary: Relay owns adapters and local tool bodies, not a
  second agent harness.

Artifacts:

- `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The ADR names the canonical owner for each concern: Copilot adapter, Agent
  Framework, OpenCode-compatible tool contract, AG-UI, or Relay packaging.
- No concern is assigned to a vague "Relay harness" bucket.
- The ADR cites the official/prior-art URLs listed in `PLANS.md`.

Verification:

- `rg -n "OpenCode|Agent Framework|AgentSession|AG-UI|approval|middleware" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

Completion artifact:

- `docs/HARNESS_ARCHITECTURE.md`
- `docs/IMPLEMENTATION.md` entry "OpenCode-Compatible Harness Alignment"

### HARN02 - Build Tool Contract Parity Matrix

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a parity matrix.
- For each canonical tool, document:
  - OpenCode-compatible name;
  - Agent Framework registration type;
  - permission class;
  - result shape;
  - approval behavior;
  - AG-UI event projection;
  - known Relay-specific implementation gap.
- Include `officecli` as an extension tool, not a separate planning mode.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Tool registry snapshot fixture or documented command.

Acceptance:

- `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, bounded `bash`,
  `question`, and `officecli` have explicit mappings.
- `rg_files`, `rg_search`, and `patch` alias behavior is documented as
  compatibility only.
- The matrix is specific enough to drive implementation without inventing new
  model-visible Relay tool names.

Verification:

- `rg -n "read|glob|grep|edit|write|apply_patch|bash|question|officecli" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

Completion artifact:

- `docs/OPENCODE_TOOL_CONTRACT.md`
- `scripts/fixtures/agent-tool-catalog-snapshot.json`
- `pnpm agent:tool-catalog-smoke`

### HARN03 - Make AgentSession the State Authority

Status: pending

Scope:

- Audit sidecar state that is keyed by run ID, request ID, or Relay-specific
  protocol state.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Ensure approval responses and follow-up user turns resume the same session.
- Keep run IDs only for UI correlation and diagnostics.

Artifacts:

- Sidecar state refactor.
- Session continuity regression test.
- Implementation note describing removed or demoted Relay state.

Acceptance:

- Approval resume does not create a fresh task from the original prompt.
- The same session contains user message, assistant tool call, approval request,
  approval response, tool observation, continuation, and final answer.
- No tool loop depends on frontend-only state.

Verification:

- Add/update a session continuity smoke test.
- `pnpm check`

### HARN04 - Replace Custom Approval Handling with Agent Framework HITL

Status: pending

Scope:

- Register side-effect tools through Agent Framework approval-required function
  wrappers or equivalent approval metadata.
- Convert approval requests/responses through the Agent Framework + AG-UI HITL
  bridge.
- Batch approvals for coherent multi-file `apply_patch` operations.
- Remove custom approval replay messages that bypass Agent Framework approval
  content.

Artifacts:

- Approval middleware/update.
- AG-UI approval fixture.
- Approval audit log fixture.

Acceptance:

- `write`, `edit`, `apply_patch`, bounded `bash` with side effects, and
  `officecli` mutations pause before execution when policy is `ask`.
- Approving resumes the exact pending function call.
- Denying records a structured denied observation and does not fallback to an
  alternate mutation path.

Verification:

- Add/update approval smoke.
- `pnpm check`

### HARN05 - Add Terminal Eligibility Middleware

Status: completed

Scope:

- Implement middleware that decides whether a model final answer is allowed.
- Track pending required artifacts, pending tool calls, pending approvals,
  failed verifications, and unresolved blocked states.
- Hide or deny `question`/ask-user unless middleware marks the run as
  user-blocked.
- Stop before Copilot if a local-action task has an empty or invalid tool
  registry.

Artifacts:

- Terminal eligibility middleware.
- Protocol-state tests covering:
  - no local tools available;
  - premature final;
  - unnecessary ask-user;
  - genuine user-blocked state.

Acceptance:

- "local tools unavailable" never comes from Copilot prose. It is a pre-model
  `blocked` state with diagnostics.
- A final answer is rejected while required local artifacts are missing.
- `question` appears only after a deterministic user-blocked decision.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm check`

Completion artifact:

- `RelayAdmissibleActionEnvelope` and protocol guard updates in
  `apps/sidecar/`
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### HARN06 - Normalize Tool Observations and Transcript Storage

Status: partial

Scope:

- Define one structured observation envelope for all tool results.
- Include tool name, call ID, status, concise summary, artifact IDs, warnings,
  stdout/stderr summaries, diff summaries, hashes, and retryability.
- Add deterministic transcript export for live E2E debugging.
- Add compaction rules that preserve objective, workspace, completed tool
  calls, artifacts, failures, approvals, and next action.

Artifacts:

- Transcript/observation schema in code or docs.
- Transcript export fixture.
- Compaction fixture.

Acceptance:

- Large tool outputs are summarized without dropping artifact references.
- Copilot receives enough structured observation data to continue after each
  tool call.
- E2E failures can be debugged from exported transcript plus AG-UI replay.

Verification:

- Transcript export smoke.
- `pnpm check`

Progress artifact:

- `RelayToolObservation.v1` metadata and artifact extraction are implemented in
  `apps/sidecar/AgentRunner.cs`.
- Live E2E prompt/raw-event artifacts are written under the ignored
  `dist/e2e/live-project/` diagnostics path.

Remaining:

- Add a deterministic transcript export smoke and compaction fixture.

### HARN07 - Rework Multi-File Project Creation Around `apply_patch`

Status: blocked by provider quota

Scope:

- Make `apply_patch` the preferred coherent mutation tool for multi-file
  project creation and improvements.
- Keep `write` for single-file creation/overwrite.
- Ensure one multi-file patch can be reviewed and approved as one change set.
- Prevent repeated one-file approval loops when Copilot can produce a patch.

Artifacts:

- Prompt/tool projection update derived from the tool registry.
- Multi-file patch E2E fixture.
- Diff/approval UI fixture.

Acceptance:

- A request to create a small project produces either one coherent
  `apply_patch` call or a clearly justified small sequence.
- The first write/patch is not duplicated after approval.
- Follow-up improvement reads existing project state before patching.

Verification:

- Live or recorded project-create E2E.
- `pnpm check`

Progress artifact:

- `apply_patch` is canonical in prompt/tool projection and tool-catalog smoke.
- The patch parser now accepts multi-hunk OpenCode-style updates.
- `scripts/workbench-live-project-e2e.mjs` covers multi-file project creation
  plus follow-up improvement.

Blocker:

- Real Copilot project E2E currently stops at Microsoft 365 Copilot's hourly
  request limit (`copilot_quota_limited`) before tool execution can complete.

### HARN08 - Project Agent Framework Runs Through AG-UI Only

Status: pending

Scope:

- Ensure frontend run state is derived from AG-UI events and state snapshots.
- Map Agent Framework run lifecycle, tool calls, tool results, approvals,
  errors, and final output to AG-UI events.
- Remove or quarantine custom Relay run/event streams from Workbench UI.
- Add replay fixtures for normal, approval, blocked, and failed runs.

Artifacts:

- AG-UI projection code/update.
- Replay fixtures.
- Minimal Workbench UI rendering path.

Acceptance:

- Workbench can replay a saved run from AG-UI events.
- Diagnostic details remain available but are not the primary UI protocol.
- No UI path depends on legacy Relay custom run-stream contracts.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### HARN09 - Live Copilot Harness E2E Suite

Status: blocked by provider quota

Scope:

- Add or update live E2E tests that use actual M365 Copilot through Edge CDP.
- Cover:
  - multi-file HTML/CSS/JS project creation;
  - follow-up project improvement in the same session;
  - local file discovery with `glob`, `grep`, and exact `read`;
  - Office file inspect/edit/verify through `officecli`;
  - side-effect approval resume.
- Assert absence of:
  - empty tool catalog;
  - "local tools unavailable" as Copilot prose;
  - unnecessary `ask_user`;
  - premature final;
  - duplicated first mutation after approval.

Artifacts:

- Live E2E scripts.
- Saved transcripts and AG-UI event logs under an ignored diagnostics location.
- Implementation note with command, date, environment, and result.

Acceptance:

- The suite passes against a logged-in Edge/Copilot profile, or fails with a
  structured harness/provider defect and reproducible artifacts.
- No failure is hidden by a fallback harness path.

Verification:

- Live E2E command documented in `docs/IMPLEMENTATION.md`.
- `pnpm check`

Progress artifact:

- `scripts/workbench-live-project-e2e.mjs` exists and records prompts, raw AG-UI
  events, screenshots, sidecar stderr, and workspace path.
- The latest run reached real Copilot and failed with a structured
  `copilot_quota_limited` provider error, documented in
  `docs/IMPLEMENTATION.md`.

Remaining:

- Re-run the live suite after the Microsoft 365 Copilot request quota resets.

### HARN10 - Remove Superseded Relay Harness Paths

Status: pending

Scope:

- Delete or quarantine Relay-specific harness code that duplicates Agent
  Framework responsibilities.
- Keep only:
  - Copilot CDP adapter;
  - local tool function bodies;
  - policy configuration;
  - diagnostics/export;
  - AG-UI projection glue;
  - packaging.
- Update docs to remove historical claims that conflict with the active design.

Artifacts:

- Code cleanup.
- Updated `README.md`, `AGENTS.md` if needed, `docs/IMPLEMENTATION.md`.

Acceptance:

- No active path treats Relay-specific protocol state as the canonical run
  state.
- The tool registry and Agent Framework middleware are the only active
  execution control surface.
- Historical docs are either updated or clearly archived.

Verification:

- `rg -n "RelayTurnState|RunEvent|rg_files|rg_search|custom run stream|local tools unavailable" apps docs`
- `pnpm check`

### HARN11 - Release Readiness Gate for Harness Migration

Status: pending

Scope:

- Run all verification gates required by the harness migration.
- Confirm installer packaging includes required local tool binaries and excludes
  obsolete runtime assets.
- Confirm Windows no-admin install behavior remains intact.
- Confirm Linux/Windows shared Workbench path remains documented.

Artifacts:

- `docs/IMPLEMENTATION.md` release-readiness entry.
- Packaging verification log.

Acceptance:

- `pnpm check` passes.
- Live E2E artifacts exist for the current commit.
- Installer/tool-binary readiness is verified before any release.

Verification:

- `pnpm check`
- Packaging command documented in `docs/IMPLEMENTATION.md`

## Historical Tool-Contract Queue

### OCT01 - Inventory Current Model-Visible Tools

Status: completed

Scope:

- Inspect all model-visible tool registrations and prompt projections in
  `apps/sidecar`.
- List canonical tool names, aliases, parameters, result shapes, approval
  requirements, and current descriptions.
- Identify Relay-specific names that should become aliases or disappear from
  prompts.

Artifacts:

- Add `docs/OPENCODE_TOOL_CONTRACT.md` with an inventory section.
- Add an implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The inventory clearly separates canonical OpenCode-compatible tools,
  compatibility aliases, and Relay/Office extension tools.
- `rg_files`, `rg_search`, and `apply_patch` are explicitly classified.

Verification:

- `rg -n "rg_files|rg_search|apply_patch|workspace_status|officecli" apps/sidecar`
- `git diff --check`

### OCT02 - Define the OpenCode-Compatible Tool Contract

Status: completed

Scope:

- Complete `docs/OPENCODE_TOOL_CONTRACT.md`.
- Define canonical tools:
  - `read`
  - `glob`
  - `grep`
  - `edit`
  - `write`
  - `patch`
  - bounded `bash`
- For each tool, define:
  - when to use it;
  - when not to use it;
  - parameters;
  - result shape;
  - permission/approval class;
  - failure semantics;
  - aliases accepted during migration.

Artifacts:

- `docs/OPENCODE_TOOL_CONTRACT.md`.
- Updated references from `PLANS.md` and `docs/IMPLEMENTATION.md`.

Acceptance:

- The contract can be implemented without inventing new model-visible Relay
  action names for ordinary file/code work.
- OfficeCLI is documented as an extension tool, not a parallel planner.

Verification:

- Documentation review.
- `git diff --check`

### OCT03 - Centralize Tool Registration Around the Contract

Status: completed

Scope:

- Create or refactor a single tool registry/source of truth in the sidecar.
- Register canonical contract tools from that registry into Agent Framework.
- Keep compatibility aliases internal:
  - `rg_files` -> `glob`;
  - `rg_search` -> `grep`;
  - `patch` -> `apply_patch`.
- Ensure aliases are accepted by the executor only where required for backward
  compatibility and are not preferred in new prompts.

Artifacts:

- Sidecar registry code.
- Tool inventory snapshot or smoke output.
- Implementation note.

Acceptance:

- Prompt/tool projection no longer builds an independent static Relay catalog.
- A model-visible inventory dump shows canonical OpenCode-compatible tools.

Verification:

- Add/update a tool-inventory smoke.
- `pnpm check`

### OCT04 - Project Only Contract Tools to Copilot

Status: completed

Scope:

- Refactor Copilot prompt/tool projection to derive visible tools from the
  Agent Framework registry and current middleware state.
- Use canonical names in prompts.
- Hide aliases unless a legacy continuation requires them.
- Remove or quarantine prompt lines that implement broad Relay-specific
  recovery rules instead of contract semantics.

Artifacts:

- Updated Copilot adapter/prompt projection.
- Prompt dump fixtures showing canonical tool names.

Acceptance:

- New prompts prefer `apply_patch`, not `patch`, when patching is visible.
- No prompt exposes `rg_files` or `rg_search`.
- No prompt introduces new Relay-only local file/code tools.

Verification:

- Prompt-dump fixture.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### OCT05 - Align Executor Behavior and Results

Status: completed

Scope:

- Ensure executor implementations match the contract result shapes.
- Implement `apply_patch` as the canonical mutation tool.
- Keep `patch` as an alias only if existing tests or continuations need it.
- Ensure `bash` remains bounded to explicit verification/build/test/git/rg
  command use and cannot become arbitrary shell execution.

Artifacts:

- Executor changes.
- Contract-result smoke tests.

Acceptance:

- Tool results are consistent enough that Copilot can recover from normal tool
  errors without custom Relay planner state.
- Patch context failure returns a clear standard tool failure result.

Verification:

- Tool executor smoke tests.
- `pnpm check`

### OCT06 - Reframe OfficeCLI as a Contract Extension

Status: completed

Scope:

- Keep OfficeCLI available, but expose it as a documented extension tool
  aligned with the same inspect-before-mutate and approval semantics.
- Remove Office-specific planner assumptions that duplicate the general
  Agent Framework tool loop.
- Ensure Office mutation uses Agent Framework approval and AG-UI HITL.

Artifacts:

- Updated Office tool docs in `docs/OPENCODE_TOOL_CONTRACT.md`.
- OfficeCLI readiness and mutation smoke results.

Acceptance:

- Natural-language Office work follows the same run loop as code/file work:
  inspect/read -> approved mutation -> result/verification.
- No separate Office-only prompt harness is required for normal operation.

Verification:

- `pnpm agent:officecli-registry-smoke`
- Office approval smoke.
- `pnpm check`

### OCT07 - Remove or Quarantine Relay-Specific Recovery Rules

Status: completed

Scope:

- Audit Copilot adapter, protocol guard, and prompt builder for ad hoc rules
  added to handle repeated reads, early finals, patch failures, or local-tools
  unavailable outputs.
- Keep only narrow compatibility normalizers that are backed by tests and do
  not define a second tool system.
- Move prevention into Agent Framework middleware/session state where possible.

Artifacts:

- Cleanup diff.
- Implementation note explaining what was removed, retained, and why.

Acceptance:

- Normal E2E does not depend on hidden guard repair or broad prompt folklore.
- Contract violations fail visibly with diagnostics instead of silently
  creating new fallback behavior.

Verification:

- Choice-error reduction smoke.
- Protocol-state smoke.
- `pnpm check`

### OCT08 - Update Regression Tests to the Contract

Status: completed

Scope:

- Update existing smokes and fixtures to use canonical tool names and contract
  result shapes.
- Add alias tests proving legacy names still map internally but are not shown
  in new prompts.
- Add a no-new-Relay-tool-name assertion for the model-visible catalog.

Artifacts:

- Updated smoke scripts.
- Tool inventory snapshot.

Acceptance:

- Tests enforce OpenCode-compatible naming and semantics.
- Tests fail if a new model-visible Relay-specific tool is added without
  updating the contract.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### OCT09 - Live Copilot E2E: Complex Project Create and Improve

Status: completed

Scope:

- Re-run a real signed-in Copilot E2E where Relay creates a hierarchical
  project and then improves it.
- The test must exercise:
  - project creation with multiple files/directories;
  - reading existing files;
  - improving the project through canonical contract tools;
  - browser/runtime verification of the generated app.
- If the run fails, classify it as:
  - Copilot transport issue;
  - Agent Framework/tool contract issue;
  - executor implementation issue;
  - generated app quality issue.
- Do not add new ad hoc Relay planner features to make one scenario pass.

Artifacts:

- E2E logs under `dist/e2e/...`.
- Browser screenshot or validation output.
- Implementation note.

Acceptance:

- The run succeeds through the OpenCode-compatible contract, or fails with a
  clear contract/tool-result error and a follow-up task.

Verification:

- Live Copilot E2E script.
- Generated app smoke/browser check.
- `pnpm check`

### OCT10 - Documentation and Cleanup

Status: completed

Scope:

- Update `README.md`, `AGENTS.md` if needed, `PLANS.md`, and
  `docs/IMPLEMENTATION.md` to describe the new contract.
- Remove or archive obsolete references that imply Relay owns a custom local
  tool taxonomy.
- Ensure release/packaging notes do not mention removed modes or old tool names
  as public behavior.

Artifacts:

- Documentation updates.
- Final verification log.

Acceptance:

- A new contributor can understand that Relay is:
  - M365 Copilot controller;
  - Agent Framework run loop;
  - AG-UI frontend protocol;
  - OpenCode-compatible local tool contract;
  - Relay implementation glue, policy, packaging, and diagnostics.

Verification:

- `pnpm check`
- `git diff --check`

## Milestone Definition of Done

The OpenCode-compatible tool contract migration is complete when:

- `docs/OPENCODE_TOOL_CONTRACT.md` exists and matches implementation.
- The model-visible inventory uses canonical OpenCode-compatible local tool
  names plus documented extension tools only.
- Existing Relay-specific tool names are internal aliases or removed.
- Agent Framework remains the run loop and AG-UI remains the UI protocol.
- Live Copilot can create and improve a non-trivial project without requiring
  new Relay-specific planner rules.
