# Relay Harness Architecture

Date: 2026-05-17

## Decision

Relay does not own a second agent harness. Relay uses Microsoft Agent Framework
as the run loop and session authority, exposes OpenCode-compatible local
workspace tools as Agent Framework tools, and projects the run to the Workbench
through AG-UI.

Relay-owned code is limited to:

- M365 Copilot over Edge CDP as an `IChatClient` provider adapter;
- OpenCode-compatible local function bodies where no approved reusable runtime
  is bundled;
- workspace/path policy, backups, diagnostics, and packaging;
- AG-UI projection glue and support-bundle export.

## References

- `https://opencode.ai/docs/tools/`
- `https://opencode.ai/docs/agents/`
- `https://learn.microsoft.com/en-us/agent-framework/overview/`
- `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://docs.ag-ui.com/introduction`
- `https://docs.ag-ui.com/concepts/events`

## Responsibility Map

| Concern | Owner | Relay implementation rule |
| --- | --- | --- |
| Model reasoning | M365 Copilot | Access only through Edge CDP provider adapter. |
| Tool-calling loop | Microsoft Agent Framework | Do not duplicate with Relay run-loop code. |
| Session continuity | `AgentSession` | Approval/follow-up turns resume the same session; run IDs are diagnostic only. |
| Tool registry | Agent Framework tools | Registry is the source for prompt projection and executor dispatch. |
| Tool semantics | OpenCode-compatible contract | Prefer `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, bounded `bash`, `question`. |
| Approval | Agent Framework approval content | Mutating tools are approval-required function tools and surface through AG-UI HITL. |
| UI/run stream | AG-UI | Workbench renders lifecycle, tool, state, approval, and final events from AG-UI. |
| Diagnostics | Relay adapter layer | Prompt dumps, transcript export, audit logs, support bundles, and E2E artifacts. |

## Delete / Adapt / Keep Matrix

Every active harness-facing component must map to a framework/protocol
primitive or to a narrow Relay-owned adapter responsibility. This matrix is the
implementation gate for future harness work.

| Component | Current file(s) | Decision | Replacement / owner | Rationale |
| --- | --- | --- | --- | --- |
| Copilot CDP transport | `RelayCopilotChatClient.cs` | keep | Relay provider adapter over Edge CDP | M365 Copilot is the required controller and is only reachable through an already signed-in Edge session. |
| Copilot readiness/send/receive diagnostics | `RelayCopilotChatClient.cs` | adapt | `IChatClient` middleware + trace spans | Provider quirks are Relay-owned, but traces must line up with Agent Framework and AG-UI run IDs. |
| Agent run loop | `AgentRunner.cs` | adapt | Microsoft Agent Framework `ChatClientAgent` / `AIAgent` | Relay may compose the agent, but must not create a second runtime loop. |
| `RelayTurnState` | `RelayTurnState.cs`, `RelayPromptBuilder.cs` | adapt, then delete | Agent Framework `AgentSession` plus middleware-derived projection | It can remain as a derived diagnostic/projection object while continuity moves to `AgentSession`; it must not be durable state. |
| `RelayAdmissibleActionEnvelope` | `RelayAdmissibleActionEnvelope.cs` | adapt, then delete | Agent Framework tool registry filtering and terminal/admission middleware | The behavior is required, but the source of truth should be middleware, not a parallel planner. |
| `RelayProtocolGuard` | `RelayProtocolGuard.cs` | adapt | terminal/admission middleware assertions | Keep the hard guards, but express them as middleware policies and regression tests. |
| Tool registry/projection | `AgentRunner.cs`, `RelayCopilotChatClient.cs` | adapt | Agent Framework function/MCP registry projected to Copilot | Registry is framework-owned; Relay only compacts it for the Copilot JSON compiler prompt. |
| Local tool function bodies | `AgentRunner.cs`, Office/PDF helpers | keep | OpenCode-compatible function tools | Relay owns these bodies because workspace policy, Windows share behavior, backups, OfficeCLI, and packaging are product requirements. |
| `RelayToolObservation` / `ToolObservation` | `AgentRunner.cs` | adapt | Agent Framework function result + AG-UI tool result metadata | Keep the structured payload, but it must be the result body of framework tool execution rather than a separate protocol. |
| Approval bridge | `AgentRunner.cs`, Workbench approval UI | adapt | Agent Framework approval-required functions + AG-UI HITL | Approval cards and audit remain Relay UI/diagnostics; pause/resume authority belongs to the framework. |
| Approval ledger / resume safety | sidecar approval flow | delete as authority | pending Agent Framework approval request | No mutation path may execute outside the exact pending approved function call. |
| Workbench `RunEvent` union | `apps/workbench/src/types.ts` | adapt, then delete | Standard AG-UI events/state snapshots | It may remain as a presentation view model during migration, but replay and E2E artifacts must be standard AG-UI. |
| AG-UI transport | `relay-ag-ui.ts`, `Program.cs` | adapt | AG-UI `HttpAgent` and `MapAGUI` | Keep only mapping/glue needed for the Workbench and support replay. |
| OpenCode compatibility aliases | executor dispatch | delete from model surface | executor-only compatibility | `patch`, `rg_files`, `rg_search`, `run_command`, and `office_search` cannot appear in prompts/catalogs. |
| MCP extension decision | docs / future registry | adapt | Agent Framework local MCP import when approved | Evaluate MCP before growing new generic Relay function bodies. |
| Release packaging | scripts/release | keep | Relay-owned packaging glue | No-admin Windows packaging and bundled local tools are product-specific. |
| Support bundles | scripts/dist diagnostics | adapt | framework-compatible trace + AG-UI replay log | Relay can collect artifacts, but their primary shape should be framework trace and AG-UI events. |

## OpenCode Semantics

Relay follows OpenCode's compact local workspace tool model:

- `glob` discovers files.
- `grep` searches plaintext/code.
- `read` inspects exact paths and extracts supported Office/PDF text.
- `edit`, `write`, and `apply_patch` are write-class mutations.
- `bash` is a bounded verification command tool.
- `question`/`ask_user` is a state-scoped user-input tool, not free-form prose.

`apply_patch` is the canonical multi-file mutation name. `patch` is accepted
only as a compatibility alias while older Relay paths are removed.

## Agent Framework Mapping

Relay registers local tools as Agent Framework function tools:

- read-only tools are normal function tools;
- side-effect tools are wrapped as approval-required functions;
- tool execution is routed through one local executor with workspace policy;
- tool results return `RelayToolObservation.v1`.

Middleware responsibilities:

- run admission before Copilot sees the task;
- tool filtering from the current admissible action envelope;
- approval policy and conversion;
- terminal eligibility checks;
- support diagnostics and transcript export.

### POSTLIVE05 Authority Note

`RelayAdmissibleActionEnvelope` remains a derived prompt projection and
diagnostic object in this milestone, not durable run state. The durable
execution boundary is still Agent Framework tool registration, approval-required
function handling, Relay executor validation, and AG-UI approval resume. The
remaining deletion blocker is that M365 Copilot does not consume Agent
Framework tool declarations directly; Relay still needs a compact JSON compiler
projection over the current framework-visible tools so Copilot does not choose
`final`, `ask_user`, or mutation tools outside the active phase. Future work
should reduce the envelope to middleware output only, but should not remove the
executor-side validation or approval gates.

## Terminal Eligibility

Final answers are allowed only when terminal middleware confirms:

- no required local tool is pending;
- no approval is pending;
- no required mutation artifact is missing;
- no required verification failed;
- the current task is not blocked by provider/tool readiness.

If a local-action task has no valid local tools, Relay enters a structured
blocked state before calling Copilot. Copilot should never be asked to explain
that local tools are unavailable.

## Transcript and Observation Model

Each session records:

1. user message;
2. assistant tool call;
3. approval request when needed;
4. approval response;
5. tool observation;
6. assistant continuation;
7. final answer.

`ToolObservation` carries status, summary, artifact IDs, warnings, retryability,
and a data hash. Large outputs are capped in the model prompt and recoverable
through exact `read` or support artifacts.

## AG-UI Projection

Relay maps Agent Framework runs into AG-UI:

- run lifecycle -> run events;
- tool calls -> tool-call start/args/end/result events;
- approval -> human-in-the-loop client tool events;
- transcript state -> state snapshots and deltas;
- final answer -> text message events.

The Workbench must be able to replay a run from AG-UI events without relying on
legacy Relay run streams.

## Non-Adoptions

Relay does not adopt Codex app-server or OpenCode runtime binaries in this
milestone because M365 Copilot must remain the reasoning controller and OpenAI
API/subscription access cannot be assumed. Their public harness/tool semantics
remain design references.

## Related Decisions

- `docs/OPENCODE_TOOL_CONTRACT.md` defines the model-visible tool names,
  argument shapes, and OpenCode built-in coverage decisions.
- `docs/MCP_REUSE_DECISION.md` defines when Agent Framework local MCP reuse is
  preferred over adding or expanding Relay local function bodies.

## Acceptance

The harness migration is complete only when live Copilot E2E proves:

- multi-file project creation through `apply_patch`;
- follow-up project improvement in the same session;
- file discovery through `glob`/`grep`/exact `read`;
- Office inspect/mutate/verify through `officecli`;
- side-effect approval resume through Agent Framework approval content;
- no empty tool registry, unnecessary `ask_user`, premature final, or
  Copilot-authored "local tools unavailable" response.
