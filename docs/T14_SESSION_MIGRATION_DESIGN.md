# T14 Session Migration Design

## Purpose

This document fixes the design boundary for task `T14` in `.taskmaster/tasks/tasks.json`.

`T14` is not a greenfield migration. The repository already moved part of the storage layer onto `claw-core`, but the user-facing guided flow still depends on Relay-era packet and pasted-response contracts. The task here is to define the remaining gap precisely before more code is removed.

Scope:

- Rust-side session, turn, and message ownership
- the boundary between `SessionStore`, `storage.rs`, and `tauri_bridge.rs`
- the remaining Relay-packet coupling that blocks the storage simplification

Out of scope:

- deleting obsolete modules and models by itself
- final TypeScript contract simplification
- manual UI review

Those remain tracked by `T16` through `T19` and `T30`.

## Current State

## 1. What is already migrated

The following `T14` groundwork already exists:

- `SessionStore` owns session CRUD, turn CRUD, and `claw_core::SessionState` message history for each session in [session_store.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/session_store.rs#L17).
- `AppStorage` delegates session creation, reads, turn start, message sync, and persisted session snapshots to `SessionStore` in [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs#L547).
- approval records and workbook preview/execution state were extracted into [approval_store.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/approval_store.rs) and [workbook_state.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook_state.rs).
- the Rust agent loop reads and writes shared storage-backed message history through [tauri_bridge.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tauri_bridge.rs).

Result:

- `storage.rs` is no longer the only owner of message history.
- the live agent runtime is already thin enough that `T14` does not need another loop rewrite.

## 2. What still blocks `T14`

### 2.1 `storage.rs` still owns Relay-era turn lifecycle

`storage.rs` still implements the guided-flow sequence:

1. `start_turn()`
2. `generate_relay_packet()`
3. `submit_copilot_response()`
4. `preview_execution()`
5. `respond_to_approval()`
6. execution

The strongest remaining couplings are:

- `generate_relay_packet()` creates and caches `RelayPacket` in [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs#L746).
- `submit_copilot_response()` requires a prior relay packet and stores parsed response state in [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs#L1079).
- `preview_execution()` reads from the in-memory `responses` map, not from `claw-core` session history, in [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs#L1277).

This means `SessionStore` owns message history, but the product workflow still uses a second lifecycle model for "packet -> pasted response -> validated response".

### 2.2 Contracts still encode the old guided-flow states

The shared contract layer still exposes Relay-era turn status and item kinds:

- `packet-ready`, `awaiting-response`, `validated`, `preview-ready`, `approved` in [core.ts](/workspace/relay-agent-main/packages/contracts/src/core.ts#L20)
- `relay-packet` item kind in [core.ts](/workspace/relay-agent-main/packages/contracts/src/core.ts#L31)
- `GenerateRelayPacket*` and `SubmitCopilotResponse*` IPC types in [ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts#L873)

That is why the Rust layer cannot drop those commands yet without breaking the frontend.

### 2.3 The main Svelte route still drives the old packet flow

The current page still calls:

- `startTurn()` in [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte#L3622)
- `generateRelayPacket()` in [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte#L3631)
- `submitCopilotResponse()` in [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte#L3700)

It also persists packet text and pasted response text in page/local continuity state, so the frontend is not yet consuming the Rust agent session as the primary source of truth for Step 2.

### 2.4 `SessionStore` is storage-backed, but not yet the only session boundary

`SessionStore` currently wraps three things together:

- app-facing `Session`
- app-facing `Turn`
- `claw_core::SessionState`

That is good enough for history persistence, but not yet the final `T14` target because the turn metadata still mirrors the Relay packet workflow rather than the claw-core loop.

## Target State

`T14` should end with this ownership split:

- `SessionStore`
  - owns session index, turn index, and `claw-core` message history
  - exposes the minimum metadata the UI still needs to list sessions and inspect completed turns
- `tauri_bridge.rs`
  - owns active agent-loop orchestration and event emission
  - appends all assistant/tool-result history through `SessionStore`
- `storage.rs`
  - owns only workbook-derived state, approval state, project state, and persisted artifacts
  - does not define a separate packet/response lifecycle for Step 2

Practical rule:

- if data is needed to run or resume a conversation, it belongs with `SessionStore` and `claw-core`
- if data is needed to inspect workbook diffs, approvals, or outputs, it belongs with artifact/workbook/approval storage

## Explicit Non-Goals For `T14`

`T14` should not try to finish all cleanup in one patch.

The following are separate by design:

- `T16`: remove `relay.rs` only after no command path depends on relay packets
- `T17`: delete dead Rust models, commands, and execution leftovers after the new boundary compiles cleanly
- `T18`: simplify `packages/contracts` after the frontend no longer calls packet/response IPC
- `T19`: prune old Cargo dependencies after the code deletion settles

## Migration Plan

## Step 1. Reframe turn progression around agent history, not relay packets

Introduce a storage-facing helper that can derive "latest actionable model output" from one of these sources:

- the latest assistant message in `claw-core` history
- a persisted assistant-response artifact created by the agent loop

Goal:

- `preview_execution()` should no longer require `StoredResponse` from `submit_copilot_response()`
- the preview path should accept the same structured `CopilotTurnResponse` whether it came from the manual pasted-response flow or the Rust agent loop

This is the critical enabling step. Without it, `storage.rs` must keep the old response cache alive.

## Step 2. Move the main UI off `generate_relay_packet()` and `submit_copilot_response()`

The main route should stop treating packet text as the Step 2 source of truth.

Instead:

- Step 1 starts the session/turn and then starts the Rust agent loop
- Step 2 renders live history from `get_session_history`
- if a manual fallback remains, it should submit a structured response artifact directly, not require a relay packet precondition

Until this step lands, `T14` cannot remove the Relay-specific IPC surface.

## Step 3. Narrow `TurnStatus`

The current turn states are workflow-specific:

- `packet-ready`
- `awaiting-response`
- `validated`
- `preview-ready`
- `approved`

After the UI swap, the turn model should only keep states that matter outside the old packet flow, for example:

- draft
- active
- review-ready
- executed
- failed

The exact enum rename can wait for `T18`, but `T14` should stop adding new logic that depends on packet-specific states.

## Step 4. Remove packet/response caches from `storage.rs`

Once preview and inspection can read from artifacts or session history, remove:

- `relay_packets`
- `responses`

from [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs#L176).

Keep:

- previews
- approvals
- scope approvals
- executions
- plan progress

Those remain product-level workflow state, not conversation state.

## Step 5. Reduce session commands to thin metadata accessors

After the packet flow is gone, [session.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/session.rs) should remain only as a thin Tauri wrapper around:

- create/list/read session metadata
- turn metadata lookup where still needed
- artifact inspection entry points

Session conversation reads should go through the agent-history path, not separate packet commands.

## Acceptance Boundary For `T14`

`T14` is complete when all of the following are true:

- `storage.rs` no longer owns a packet-first conversation lifecycle
- preview/approval entry uses structured agent output sourced from artifacts or `claw-core` history
- the primary frontend path no longer calls `generate_relay_packet()` or `submit_copilot_response()`
- `SessionStore` plus `tauri_bridge` are the only owners of conversation state
- `storage.rs` retains workbook, approval, artifact, and project responsibilities only

`T14` is not complete merely because `SessionStore` exists.

## Recommended Execution Order

1. Add a shared "latest structured response" accessor that can read from agent-produced history or artifacts.
2. Switch preview/review to that accessor and cover it with storage tests.
3. Migrate the Svelte page away from relay-packet generation and pasted-response submission as the primary path.
4. Remove `relay_packets` and `responses` from `storage.rs`.
5. Only then proceed with `T16` through `T19`.

## Risks

- The current manual guided flow and the newer Rust agent loop coexist in the same page, so partial deletion can strand continuity state or turn-inspection views.
- `TurnDetailsViewModel` still exposes packet and validation sections; removing packet generation before inspection fallback exists would regress the detail panel.
- The test suite in `storage.rs` is heavily packet-flow oriented, so `T14` should expect test migration work, not just production-code edits.

## Working Decision

For this repository, treat `T14` as a boundary-consolidation task, not as a pure storage refactor.

The blocking design difference is not "SessionStore is missing"; it is "the user-facing workflow still treats relay packet generation and pasted response validation as the primary turn protocol". Until that protocol is replaced, `storage.rs` cannot be reduced to workbook, approval, and artifact concerns only.
