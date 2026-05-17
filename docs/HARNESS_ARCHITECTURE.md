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

## Acceptance

The harness migration is complete only when live Copilot E2E proves:

- multi-file project creation through `apply_patch`;
- follow-up project improvement in the same session;
- file discovery through `glob`/`grep`/exact `read`;
- Office inspect/mutate/verify through `officecli`;
- side-effect approval resume through Agent Framework approval content;
- no empty tool registry, unnecessary `ask_user`, premature final, or
  Copilot-authored "local tools unavailable" response.
