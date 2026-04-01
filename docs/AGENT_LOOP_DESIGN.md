# Agent Loop Design

## 1. Purpose

This document fixes the Phase 2 agent-loop design described in `.taskmaster/docs/prd.txt` section `14` to the current implementation baseline.

Scope:

- multi-turn Copilot exchange in Step 2
- read/write action classification
- write handoff into the existing preview and approval flow
- loop safety guards and operator-visible behavior

Out of scope:

- direct Copilot API access
- automatic execution of write tools
- Windows + M365 manual validation, which remains tracked in `docs/AGENT_LOOP_E2E_VERIFICATION.md`

## 2. Response Contract

`packages/contracts/src/relay.ts` is the schema source of truth.

`CopilotTurnResponse` fields used by the loop:

- `status`: `"thinking" | "ready_to_write" | "done" | "error"`
- `summary`: short user-facing progress text
- `actions`: read and/or write actions
- `message`: optional detail for completion or error reporting
- `followupQuestions`, `warnings`: optional UI-facing metadata

Compatibility rule:

- when `status` is omitted, the schema defaults it to `"ready_to_write"` so the legacy one-shot JSON shape still works

## 3. State Machine

| Copilot status | Meaning | App behavior |
|---|---|---|
| `thinking` | More information is needed before proposing writes | Execute read actions only, build a follow-up prompt, continue to the next turn |
| `ready_to_write` | The model is ready to propose a write plan | Stop the loop, keep the final response, and advance into Step 3 preview/review |
| `done` | The task is complete without further actions | Stop the loop and show completion copy without save execution |
| `error` | The model cannot continue safely | Stop the loop, show the error summary/message, and keep manual fallback available |

UI state transitions:

1. Step 1 prepares the prompt and starts the turn.
2. Step 2 runs the loop and renders per-turn progress.
3. `ready_to_write` transitions to Step 3 automatically.
4. `done`, `error`, timeout, or cancel stay in Step 2 with a readable summary.

## 4. Turn Protocol

Per turn, the frontend loop in `apps/desktop/src/lib/agent-loop.ts` performs this sequence:

1. Send the current prompt to Copilot through `sendToCopilot()`.
2. Parse the returned JSON with `copilotTurnResponseSchema`.
3. Call `executeReadActions()` with `sessionId`, `turnId`, `loopTurn`, `maxTurns`, and `actions`.
4. Execute only read actions in the backend.
5. If a guard stops continuation, surface the guard message and stop.
6. If `status` is `ready_to_write`, `done`, or `error`, stop and keep the final response.
7. If write actions are present, stop and hand the response to the existing preview/review flow.
8. Otherwise, build the next prompt from the read tool results and continue.

The initial prompt is the Step 1 instruction text. Follow-up prompts are built from the original task plus structured tool results from the previous turn.

## 5. Read/Write Classification

Read actions are auto-executable and never require approval:

- `workbook.inspect`
- `sheet.preview`
- `sheet.profile_columns`
- `session.diff_from_base`
- `file.list`
- `file.read_text`
- `file.stat`

Write actions are never auto-executed:

- `table.rename_columns`
- `table.cast_columns`
- `table.filter_rows`
- `table.derive_column`
- `table.group_aggregate`
- `workbook.save_copy`
- future file write tools such as `file.copy`, `file.move`, `file.delete`

Classification rule:

- the backend returns `toolResults` for read actions
- the backend also returns `hasWriteActions` so the frontend can stop the loop and enter review

## 6. Follow-up Prompt Format

The next-turn prompt must contain:

- the original task
- the previous turn number
- the previous summary/message when available
- one JSON block per executed read tool result
- explicit instructions for the next response status:
  - use `thinking` for more read work
  - use `ready_to_write` for a write proposal
  - use `done` when no writes are needed
  - use `error` when the task cannot continue safely

This keeps the loop deterministic and preserves the current JSON-only response contract.

## 7. Safety Guards

Defaults:

- maximum turns: `10`
- per-turn timeout: `120000ms`
- total loop timeout budget: `maxTurns * loopTimeoutMs`

Enforced behavior:

- write actions do not run inside the loop
- write-capable flows still require preview and user approval
- backend max-turn guard returns a readable stop message
- frontend per-turn timeout stops a stalled Copilot turn
- frontend abort support lets the user cancel an active loop
- if Copilot asks for another turn without any executable read action, the loop fails fast instead of spinning

Current implementation note:

- PRD section `14.5` also calls for duplicate read-action detection. The shipped implementation currently relies on max-turn limits, cancel support, and the "no executable read tools" failure path as the active loop protections; a dedicated duplicate-argument warning is not persisted separately yet.

## 8. Handoff to Review and Execution

When the final response contains write actions or `status: "ready_to_write"`:

1. the loop stops in Step 2
2. the final Copilot JSON is kept in the response textarea/state
3. the existing preview command generates `DiffSummary`
4. Step 3 shows the three-point summary and SheetDiff cards
5. the user approves and runs the existing save-copy flow

This preserves the original product guardrails:

- preview before write
- approval before write
- save-copy only
- original inputs remain read-only

## 9. Persistence and Inspection

The loop reuses the existing session and turn model.

- parsed `status` and `message` are stored with the submitted Copilot response
- read-side tool outputs continue to be exposed as turn artifacts
- preview, approval, and execution records remain available in Inspection Details
- loop settings (`agentLoopEnabled`, `maxTurns`, `loopTimeoutMs`) are persisted in the existing browser-automation settings payload

## 10. Verification Boundary

Task `84` is complete when this design document exists and covers PRD section `14`.

Task `95` remains separate and manual. It is complete only after `docs/AGENT_LOOP_E2E_VERIFICATION.md` is executed on Windows Tauri with a real M365 Copilot session and the checklist is filled in.
