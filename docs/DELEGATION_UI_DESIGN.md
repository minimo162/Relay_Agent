# Delegation UI Design

## Goal

Replace the current default 3-step wizard entry experience with a delegation-style workspace while preserving the existing manual workflow as a fallback mode.

The delegation flow is:

1. User enters a goal in natural language and optionally attaches a file.
2. Relay Agent plans and executes autonomously through the existing browser automation path.
3. The center feed shows activity in real time.
4. The right intervention panel appears only when user approval or recovery is required.
5. Completion renders as a read-only result timeline with the final artifact highlighted.

## Component Tree

### Shared shell

- `+page.svelte`
- `SettingsModal.svelte`
- `RecentSessions.svelte`

### Manual mode

- `GoalInput.svelte`
- `AgentActivityFeed.svelte`
- `SheetDiffCard.svelte`
- `ApprovalGate.svelte`

### Delegation mode

- `ChatComposer.svelte`
- `ActivityFeed.svelte`
- `InterventionPanel.svelte`
- `CompletionTimeline.svelte`
- Existing plan review and write approval content reused inside `InterventionPanel.svelte`

## State Management

Delegation mode uses a dedicated Svelte store module:

- `delegationStore`
- `activityFeedStore`

### Delegation state machine

- `idle`
- `goal_entered`
- `planning`
- `plan_review`
- `executing`
- `awaiting_approval`
- `completed`
- `error`

### Store responsibilities

- `delegationStore`
  - current delegation state
  - goal text
  - attached files
  - latest approved or proposed plan
  - current step index
  - recoverable error string
- `activityFeedStore`
  - append-only activity log for visible user feedback
  - event cards for Copilot turns, tool executions, approvals, and completion

### Ownership rules

- `+page.svelte` remains the orchestration layer for IPC, browser automation, and side effects.
- Components stay presentational and communicate via props and DOM events.
- The store is only used for delegation mode state and feed rendering, not as a global replacement for all existing page state.

## Manual and Delegation Coexistence

- UI mode is persisted in continuity as `uiMode: "delegation" | "manual"`.
- Default mode is `delegation`.
- Manual mode keeps the existing staged flow and remains the compatibility path for workflow smoke coverage.
- Delegation mode reuses the same backend contracts, preview-before-write guardrails, approval-before-write guardrails, and save-copy-only execution path.

### Switching rules

- Switching from delegation to manual keeps file path, objective, and current session identifiers where possible.
- Switching from manual to delegation seeds the composer from the current objective and workbook path when available.
- Errors in delegation mode should surface a manual fallback path rather than removing the existing manual workflow.

## Activity Feed Event Types

- `goal_set`
- `file_attached`
- `copilot_turn`
- `tool_executed`
- `plan_proposed`
- `plan_approved`
- `write_approval_requested`
- `write_approved`
- `step_completed`
- `error`
- `completed`

### Rendering rules

- Every event has a timestamped card in chronological order.
- Error and approval events are visually highlighted.
- Large payloads render as expandable details.
- The feed auto-scrolls to the newest event.
- Completion does not clear the feed; it becomes the final read-only execution timeline.

## Layout Specification

Desktop layout uses three zones:

- Top header: app title, settings, mode toggle
- Main body:
  - left rail: recent sessions / compact context
  - center: activity feed or manual content
  - right: intervention panel
- Bottom: chat composer in delegation mode

Mobile and narrow windows collapse the right intervention panel below the activity feed as a sheet-like section while keeping the composer pinned to the bottom.

## Migration Strategy

1. Extract reusable manual-mode components from `+page.svelte` without changing behavior.
2. Add delegation stores and continuity persistence.
3. Introduce a mode toggle and make delegation the default rendering path.
4. Reuse existing plan review, progress, and write approval logic inside the new intervention panel.
5. Keep manual mode intact for smoke tests and fallback operation.

## Guardrails

- All write operations still go through preview before execution.
- All workbook writes remain save-copy only.
- Original inputs remain read-only.
- Delegation mode removes copy/paste from the happy path, but manual mode remains available as fallback when browser automation fails.
