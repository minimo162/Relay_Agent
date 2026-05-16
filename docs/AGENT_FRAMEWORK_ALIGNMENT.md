# Agent Framework Alignment

This document is the acceptance checklist for keeping Relay aligned with
Microsoft Agent Framework and AG-UI without rebuilding a second agent runtime.
The implementation source of truth remains the sidecar and Workbench source;
this file records the architectural decision gates and their verification
artifacts.

## Alignment Matrix

| Axis | Relay decision | Status | Source/artifact | Verification |
| --- | --- | --- | --- | --- |
| Provider adapter | Use M365 Copilot through Relay's Edge CDP chat client as the primary LLM provider. Fail fast on transport or schema instability instead of falling back to another model. | Adopted with Relay policy | `apps/sidecar/CopilotTransport.cs`, `scripts/workbench-live-copilot-e2e.mjs` | `pnpm workbench:live-copilot-e2e` when a signed-in Edge CDP session is available |
| Agent runtime | Use Microsoft Agent Framework for the run loop, chat client boundary, tool registration, approval bridge, and AG-UI hosting. | Adopted | `apps/sidecar/AgentRunner.cs`, `apps/sidecar/Program.cs` | `pnpm agent:golden-smoke`, `pnpm agent:agui-client-tool-smoke`, `pnpm check` |
| Function tools | Keep local capabilities as Agent Framework function tools with stable model-facing names. | Adopted with Relay policy | `RelayAgentToolCatalog` in `apps/sidecar/AgentRunner.cs`, `scripts/agent-tool-catalog-smoke.mjs` | `pnpm agent:tool-catalog-smoke` |
| Tool execution policy | Relay owns workspace containment, approval, redaction, backup behavior, and command bounds. The model can choose tools but cannot bypass policy. | Adopted with Relay policy | `RelayToolExecutor`, `RelayToolProvider`, `AgUiApprovalRequest` in `apps/sidecar/AgentRunner.cs` | `pnpm agent:agui-client-tool-smoke`, `pnpm sidecar:security-smoke` |
| Local file and Office/PDF lookup | Use `glob` and `grep` for discovery, exact `read` for evidence, and Office/PDF extraction only through the read adapter. Do not expose a high-level `office_search` tool. | Adopted | `docs/OPENCODE_TOOL_CONTRACT.md`, `AGENTS.md`, `RelayToolProvider` | `pnpm agent:rg-stream-smoke`, `pnpm agent:office-pdf-read-smoke` |
| Office mutation | Use `officecli_mutate` behind approval for Office writes. Keep read-only `officecli` separate. | Adopted with Relay policy | `ToolResolver`, `ToolReadinessChecks`, `RelayToolProvider` | `pnpm agent:officecli-registry-smoke`, `pnpm check` |
| AG-UI streaming | Workbench must expose ready, running, tool activity, approval wait, failure, cancellation, and completion states without requiring support details. | Adopted | `apps/workbench/src/App.tsx`, `apps/workbench/src/lib/relay-ag-ui.ts`, `scripts/workbench-ux-e2e.mjs` | `pnpm workbench:ux-e2e` |
| Evaluation and tracing | Prefer deterministic smokes, catalog snapshots, redacted support bundles, and run-state screenshots before adding new runtime behavior. | Adopted | `scripts/*smoke.mjs`, `SupportBundle`, `ToolCallAuditSummary` | `pnpm check`, `pnpm sidecar:security-smoke` |
| Declarative workflows | Add only when a business process has stable triggers, deterministic steps, approval points, rollback/backup behavior, and output contracts. | Deferred | Workflow admission gate below | `git diff --check` plus the future workflow-specific E2E |
| Handoff / multi-agent | Do not add by default. Prefer agent-as-tool for bounded specialists; use handoff only when task ownership truly transfers between agents. | Deferred | `PLANS.md` prior-art review | Future plan must satisfy the workflow admission gate |
| Local MCP | Use only for a named, approved standalone capability not already covered by ripgrep, OfficeCLI, filesystem, git, or bounded commands. | Deferred | MCP admission review below | No MCP process is expected in release inventory until a candidate is approved |
| Durable workflow-as-MCP | Treat as future enterprise integration for approved durable workflows, not an MVP local dependency. | Deferred | `PLANS.md` prior-art review | Future proposal must satisfy MCP and workflow gates |
| OpenCode/OpenWork/Codex/AionUi runtimes | Do not reintroduce as active runtime, UI, or tool substrate. Relay may keep historical docs only under archive/context. | Rejected | `scripts/check-hard-cut-guard.mjs`, `AGENTS.md` | `pnpm check` |
| Packaging | Ship Relay sidecar/workbench/launcher plus required tool binaries. Do not require admin rights or personal passwords for installation. | Adopted | release scripts under `scripts/release/` | `pnpm release:inventory`, release workflow |

## Workflow Admission Gate

New workflows, specialist agents, handoffs, local MCP providers, or durable
workflow integrations must include a proposal with these fields before any task
is scheduled:

- **Trigger:** the user intent or explicit UI action that starts the workflow.
- **Inputs:** required files, workspace, parameters, credentials, and optional
  context.
- **Deterministic steps:** which steps are fixed and which are model-selected.
- **Tool surface:** function tool, agent-as-tool, handoff, declarative workflow,
  local MCP, or durable workflow-as-MCP.
- **Approval points:** every file mutation, Office mutation, command, network
  call, or other side effect that requires user consent.
- **Rollback/backup behavior:** what is copied, diffed, or recoverable before a
  mutation runs.
- **Output contract:** final answer shape, artifact path, event stream, and
  support-bundle evidence.
- **Evaluation:** smoke, Workbench E2E, live Copilot E2E when relevant, and
  manual acceptance criteria.
- **Security:** workspace containment, path redaction, sensitive-field redaction,
  and Windows/Linux packaging behavior.

Default decision order:

1. Use the current single Copilot manager plus function tools.
2. Use agent-as-tool only for a bounded specialist with a typed input/output
   contract and no ownership transfer.
3. Use handoff only when ownership must transfer and routing rules are explicit.
4. Use declarative workflow only for repeatable business processes with stable
   deterministic steps.
5. Use local MCP only for an approved standalone local provider.
6. Use durable workflow-as-MCP only for approved enterprise workflow endpoints.

## MCP Admission Review

No local MCP runtime is approved for the current product surface.

Current capability coverage:

- File discovery/content search: `glob` and `grep` backed by ripgrep.
- Exact file evidence: `read`, including bounded Office/PDF extraction.
- Office inspection/mutation: OfficeCLI-backed `officecli` and
  `officecli_mutate`.
- Code/text mutation: `edit`, `write`, and `apply_patch`.
- Workspace verification: `workspace_status`, `diff`, and bounded `bash`.

Candidate MCP servers must be rejected unless they provide a real additional
capability, can be packaged for Windows and Linux, expose stable typed schemas,
respect workspace containment, preserve Relay approval, and generate redacted
support-bundle evidence. A toy filesystem/search MCP server is not a valid
candidate because it duplicates the current providers while adding packaging
and security risk.

The current decision is therefore **no MCP server should be added yet**. The
approved extension point is descriptor readiness in the tool catalog, not a
runtime process.

## AG-UI Run-State Acceptance Matrix

| State | User-visible requirement | Automated coverage |
| --- | --- | --- |
| Ready | `#readiness` shows `Ready` or `Limited` and the primary input is usable. | `scripts/workbench-ux-e2e.mjs` initial UX check |
| Running | `#run-state` changes to `Running` or a visible accepted event appears within two seconds. | `scripts/workbench-ux-e2e.mjs` running-progress wait |
| Tool activity | The activity stream shows tool preparation/result events for tool-using runs. | `scripts/workbench-ux-e2e.mjs` event trace count and final answer check |
| Approval required | `#approval` is visible, run state is `Waiting`, and both approve/reject actions are visible. | `scripts/workbench-ux-e2e.mjs` approval panel check |
| Approval approved | The side effect does not occur before approval and does occur after approval. | `scripts/workbench-ux-e2e.mjs` approved file assertion |
| Approval rejected | Rejection resumes through AG-UI approval messages and leaves the run stopped/failed without executing the original mutation. | covered by AG-UI client-tool smoke; add browser E2E before changing rejection UI |
| Failure | AG-UI stream errors become visible `Failed` state and event details. | sidecar/client smokes plus Workbench error path |
| Cancellation | User cancellation appends a visible `Stopped` event and aborts the active run. | Workbench implementation; add browser E2E before changing cancellation UI |
| Completed | Final answer is visible above activity and run state shows `Done`. | `scripts/workbench-ux-e2e.mjs` completed check |

## Live Copilot Provider Acceptance

`pnpm workbench:live-copilot-e2e` is optional unless a signed-in Edge CDP
session is available, but failures must be classified before fixing code:

- **Environment:** Edge CDP is unreachable, not Microsoft Edge, not signed in,
  blocked by policy, or Copilot service unavailable.
- **Prompt delivery:** the Relay prompt does not reach the Copilot composer or
  the visible input length is unexpectedly zero.
- **Response extraction:** Copilot visibly answers but the bridge cannot detect
  completion or extract the final answer.
- **Schema validation:** Copilot answers but violates the expected JSON/tool
  contract.
- **Tool execution:** Relay receives a valid tool plan but the local provider
  fails readiness, approval, execution, or redaction checks.

The acceptance target is not silent fallback. A failed live provider path must
surface a classified error so the next task fixes the actual layer.
