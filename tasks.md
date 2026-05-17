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
  - `apply_patch` -> `patch`.
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

- New prompts prefer `patch`, not `apply_patch`, when patching is visible.
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
- Implement `patch` as the canonical mutation tool.
- Keep `apply_patch` as an alias only if existing tests or continuations need
  it.
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
