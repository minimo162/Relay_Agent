# Framework-Native Cutover Baseline

Last updated: 2026-05-17.

Relay keeps Microsoft 365 Copilot as the reasoning controller and uses
Microsoft Agent Framework plus AG-UI as the run, tool, approval, and event
protocol. Relay-owned code is limited to the Copilot browser adapter, local tool
function bodies, safety policy, packaging, diagnostics, and UI presentation.

## Active Protocol Inventory

| Area | Active path | Decision | Prevention responsibility | Acceptance artifact |
| --- | --- | --- | --- | --- |
| Run endpoint | `Program.cs` maps `/agui/relay` with `MapAGUI` | keep | AG-UI is the only Workbench run/event transport | `scripts/check-hard-cut-guard.mjs` |
| Model provider | `RelayCopilotChatClient` | adapter-only | Converts Agent Framework chat/tool options into strict Copilot JSON projection | `scripts/protocol-state-smoke.mjs` |
| Tool loop | `ChatClientAgent` + `UseFunctionInvocation` | keep | Tool execution is Agent Framework function invocation, not a Relay scheduler | `scripts/agent-golden-smoke.mjs` |
| Tool inventory | `RelayAgentToolCatalog.All` + `AIFunctionFactory.Create` | keep as the single descriptor source | Catalog snapshot, prompt projection, and tool metadata must stay aligned | `scripts/agent-tool-catalog-smoke.mjs` |
| Search tools | `glob`, `grep` backed by ripgrep | keep | File search uses bounded local tools instead of Copilot prose | `scripts/rg-stream-cap-smoke.mjs` |
| Read tool | `read` with Office/PDF plaintext extraction | keep | Office/PDF discovery remains `glob` then exact `read` | `scripts/office-pdf-read-smoke.mjs` |
| Office tools | `officecli`, `officecli_mutate` | keep | Read-only operations are separate from approved mutations | `scripts/officecli-registry-smoke.mjs` |
| Mutations | `edit`, `write`, `apply_patch`, `officecli_mutate`, bounded `bash` | keep through Agent Framework approval | Mutations must produce `ToolApprovalRequestContent` and AG-UI approval requests | `scripts/agui-client-tool-smoke.mjs` |
| User questions | `ask_user` catalog metadata as AG-UI client/state-scoped | replace backend-global behavior | Hidden from known-objective prompts; guarded if Copilot still asks unnecessarily | `scripts/framework-native-prevention-smoke.mjs` |
| Terminal policy | `RelayTurnState`, `RelayProtocolGuard`, `RelayInitialToolPolicy` | adapter policy | Reject or repair invalid Copilot JSON before user-visible completion | `scripts/protocol-state-smoke.mjs` and `scripts/framework-native-prevention-smoke.mjs` |
| Workbench stream | `@ag-ui/client` consuming `/agui/relay` | keep | UI state derives from AG-UI events, with Relay `RunEvent` only as view-model mapping | `scripts/check-hard-cut-guard.mjs` |
| Legacy run routes | `/api/runs`, `/events`, `/agui-events` custom routes | remove | Must not exist in active sidecar/workbench paths | `scripts/check-hard-cut-guard.mjs` |
| Legacy tool aliases | `rg_files`, `rg_search`, `run_command`, `office_search` | remove | Must not be model-facing or packaged as active contracts | `scripts/agent-tool-catalog-smoke.mjs` |

## Failure Classes And Structural Blocks

| Failure class | Root cause | Structural block | Regression signal |
| --- | --- | --- | --- |
| `local tools unavailable` final | Copilot treats the web chat as lacking local tools | Tool projection explicitly describes Relay tools; `RelayProtocolGuard.ValidateFinal` replaces premature final with deterministic first local tool when possible | `protocol-state-smoke`, `framework-native-prevention-smoke` |
| Unnecessary `ask_user` | Clarification tool is globally visible for known objective/scope | Prompt projection hides `ask_user` unless `RelayTurnState.CanAskUser`; guard rejects or replaces any stray call | `framework-native-prevention-smoke` |
| Premature `final` | Copilot finalizes before local observation/mutation/approval | Terminal guard rejects final before required local tool or mutation success | `protocol-state-smoke`, `framework-native-prevention-smoke` |
| Unsupported tool drift | Copilot emits a stale Relay/OpenCode/Codex alias | Catalog snapshot forbids legacy aliases and provider drift | `agent-tool-catalog-smoke` |
| Mutation without approval | Model requests write/edit/Office mutation as a normal function result | Mutating tools are `ApprovalRequiredAIFunction` and projected through AG-UI approval bridge | `agui-client-tool-smoke` |

## Framework-Native Prevention Task State

| Task | Implemented artifact | Status |
| --- | --- | --- |
| FNP00 baseline | This document | complete |
| FNP01 run admission | `RelayTurnStateFactory`, `RelayProtocolGuard`, missing-tool/final rejection smokes | complete for MVP local-work admission |
| FNP02 single catalog | `RelayAgentToolCatalog.All`, `/api/tool-catalog`, catalog snapshot smoke | complete |
| FNP03 state-scoped `ask_user` | `ask_user` metadata is `Client`/`state_scoped`; prompt projection hides it for known objectives | complete for known-objective prevention |
| FNP04 terminal eligibility | `RequiresLocalToolBeforeFinal`, `RequiresMutationBeforeFinal`, AG-UI error smokes | complete |
| FNP05 AG-UI state/capabilities | Workbench consumes `/agui/relay` through `@ag-ui/client`; hard-cut guard forbids old streams | complete |
| FNP06 approvals | Agent Framework approval primitive projected to AG-UI `request_approval` | complete |
| FNP07 function observations | Local tools return typed function results through Agent Framework invocation | complete |
| FNP08 workflow admission | No fixed workflow is active; open-ended Agent Framework runs remain canonical | complete |
| FNP09 prevention-clean tests | `framework-native-prevention-smoke` plus existing protocol/catalog/approval smokes | complete |
| FNP10 live Copilot E2E | `workbench:live-copilot-e2e` remains the manual/live gate; not run in headless CI | documented manual gate |
| FNP11 superseded paths | Hard-cut guard quarantines old routes, tool aliases, and active source references | complete |

## Residual Relay-Owned Code

These pieces remain intentionally Relay-owned because Agent Framework and AG-UI
do not provide Relay-specific policy:

- M365 Copilot Edge CDP transport and send/readiness diagnostics.
- Strict JSON projection and validation for Copilot responses.
- Workspace containment, path normalization, output caps, and redaction.
- Ripgrep and OfficeCLI executable resolution.
- Office/PDF plaintext extraction through exact `read`.
- Backup, diff, and verification side effects for mutating tools.
- Minimal Workbench view-model mapping from AG-UI events to visible activity.

Any future feature must either use Agent Framework/AG-UI primitives directly or
add a narrow adapter entry here with a verification artifact.
