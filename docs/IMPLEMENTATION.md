# Relay_Agent Implementation Log

## Status

- Current phase: Milestone 5 is complete; the safe CSV-first preview, approval, and save-copy execution slice is now documented, demo-backed, and verification-clean
- Repository state: pnpm workspace, SvelteKit SPA shell, Tauri v2 shell, and shared contracts package are now bootstrapped and verification-clean
- Active source-of-truth documents:
  - `PLANS.md`
  - `AGENTS.md`
  - `docs/IMPLEMENTATION.md`
  - `.taskmaster/docs/repo_audit.md`
- Follow-up planning input: `.taskmaster/docs/prd_non_engineer_ux.txt` captures a post-MVP usability scope focused on making the app easier for non-engineer operators, especially around app startup, distribution/install/update expectations, recovery/diagnostics, data-handling clarity, permission explanations, file readiness, locale and CSV compatibility, early constraint surfacing, resumable work, crash recovery, recent-item access, progress visibility, template-driven starts, output-name safety, duplicate-run prevention, safe defaults, reviewer-friendly summaries, read-only review, inline help, pre-copy sensitivity warnings, local audit history, accessibility baselines, and the preview, approval, and save-copy execution flow
- Follow-up task graph: `.taskmaster/tasks/tasks.json` now breaks that supplemental PRD into Task Master follow-up tasks `11` through `16`, covering startup, data trust, continuity, guided onboarding, review/save simplification, and cross-cutting recovery plus accessibility work

## Milestone Log

### Milestone 0

#### 1.1 Repository audit

Completed.

Artifact:

- `.taskmaster/docs/repo_audit.md`

Outcome:

- Confirmed the repository currently contains Task Master planning scaffolding only.
- Confirmed the PRD assumes application directories and code that do not yet exist.
- Established that implementation must proceed as a greenfield build-out.

#### 1.2 Planning document

Completed.

Artifact:

- `PLANS.md`

Outcome:

- Broke work into Milestones 0 through 5.
- Added milestone goals, change targets, acceptance criteria, verification commands, scope exclusions, and risks.
- Added the MVP draft completion conditions from the PRD.

#### 1.3 Repository operating rules

Completed.

Artifact:

- `AGENTS.md`

Outcome:

- Defined repository-specific execution, scope, verification, and documentation rules.
- Clarified that `.taskmaster/` is the only current scaffold and that implementation should avoid assuming hidden app code exists.

#### 1.4 Implementation log

Completed.

Artifact:

- `docs/IMPLEMENTATION.md`

Outcome:

- Created the persistent location for implementation decisions, progress notes, verification output, and known limitations.

### Milestone 1

#### 2.1-2.4 Monorepo and desktop build foundation

Completed.

Artifacts:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `Cargo.toml`
- `apps/desktop/package.json`
- `apps/desktop/svelte.config.js`
- `apps/desktop/vite.config.ts`
- `apps/desktop/tsconfig.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/icons/icon.png`
- `packages/contracts/package.json`

Outcome:

- Created a pnpm workspace that resolves the desktop app and shared contracts package without manual fixes.
- Aligned the desktop app with SvelteKit SPA mode and Tauri v2 build expectations, including the correct dev port and Tauri icon requirements.
- Allowed the required `esbuild` postinstall script through pnpm's build-script policy so Vite builds succeed non-interactively.
- Installed the Linux system packages needed for `webkit2gtk`, `gtk3`, and related Tauri build dependencies in this environment.
- Verified `pnpm check`, `pnpm typecheck`, `pnpm --filter @relay-agent/desktop build`, and `cargo check` all pass.

### Milestone 2

#### 3.1 Contracts audit

Completed.

Artifacts:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/meta.ts`
- `packages/contracts/src/shared.ts`
- `packages/contracts/src/core.ts`
- `packages/contracts/src/relay.ts`
- `packages/contracts/src/workbook.ts`

Outcome:

- Confirmed the contracts package previously contained only a `projectInfo` stub and none of the PRD-required relay or workbook entities.
- Confirmed there were no real cross-package schema references yet because the desktop app only consumed the stub metadata export.
- Established the concrete schema inventory needed for the next backend and frontend milestones.

#### 3.2-3.4 Shared schema implementation and exports

Completed.

Artifacts:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/meta.ts`
- `packages/contracts/src/shared.ts`
- `packages/contracts/src/core.ts`
- `packages/contracts/src/relay.ts`
- `packages/contracts/src/workbook.ts`

Outcome:

- Added Zod schema and inferred type pairs for `Session`, `Turn`, `Item`, `RelayPacket`, `CopilotTurnResponse`, `ToolDescriptor`, `SpreadsheetAction`, `WorkbookProfile`, and `DiffSummary`.
- Split the contracts package into focused modules and kept `index.ts` as the public export surface.
- Preserved the lightweight `projectInfo` metadata export so the desktop shell continues to compile against the shared package.

### Milestone 3

#### 4.1 Rust module scaffold

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/session.rs`
- `apps/desktop/src-tauri/src/relay.rs`
- `apps/desktop/src-tauri/src/execution.rs`

Outcome:

- Split the Tauri backend into dedicated `app`, `session`, `relay`, and `execution` modules instead of keeping all commands in one file.
- Added a small shared `DesktopState` and registered it with the Tauri builder so later lifecycle commands have a stable home for state.
- Registered placeholder commands for initialization, session listing, relay packet drafting, and execution preview so the typed IPC surface can grow without another structural refactor.

#### 4.2 Session and turn lifecycle commands

Completed.

Artifacts:

- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/session.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/Cargo.toml`

Outcome:

- Added contracts-side schemas for `initialize_app`, `create_session`, `read_session`, `start_turn`, and session-detail payloads so lifecycle command shapes now have a shared TypeScript source of truth.
- Implemented an in-memory backend storage abstraction for sessions and turns with validation, ID generation, and RFC3339 timestamps.
- Implemented Tauri commands for `initialize_app`, `create_session`, `list_sessions`, `read_session`, and `start_turn`.
- Added a Rust unit test that exercises create, list, read, and start-turn behavior on the storage layer.

#### 4.3 Relay submission, preview, approval, and execution commands

Completed.

Artifacts:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/relay.rs`
- `apps/desktop/src-tauri/src/execution.rs`
- `apps/desktop/src-tauri/src/lib.rs`

Outcome:

- Added shared contracts payloads for relay packet generation, pasted response submission, execution preview, approval response, and execution run commands.
- Replaced the relay and execution stubs with Tauri commands backed by in-memory relay state.
- Implemented a minimal JSON validator for pasted Copilot responses with structured validation issues and a repair prompt.
- Added preview synthesis that converts parsed actions into a provisional `DiffSummary` and enforces approval gating for write-capable actions.
- Implemented a safe execution endpoint that allows no-op completion for read-only action sets and explicitly refuses unsupported write execution while preserving preview and approval state.
- Added Rust tests that cover the packet-to-response-to-preview-to-approval-to-run flow and invalid response handling.

#### 4.4 Typed frontend IPC wrapper

Completed.

Artifacts:

- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src/lib/index.ts`
- `apps/desktop/src/routes/+page.svelte`

Outcome:

- Replaced the ad hoc frontend `invoke` usage with a typed IPC wrapper that validates request and response payloads against the shared contracts package.
- Added typed wrapper functions for app initialization, session lifecycle, relay packet generation, pasted response validation, preview, approval, and execution commands.
- Exported the wrapper as a single frontend command surface and wired the desktop shell to call `initialize_app` through it.
- Updated the landing page to surface typed IPC state such as storage mode, session count, and supported relay modes.

### Milestone 4

#### 5.1 Application data directory layout

Completed.

Artifacts:

- `docs/STORAGE_LAYOUT.md`

Outcome:

- Defined the app-local storage root as `storage-v1` under Tauri's app-local data directory.
- Specified canonical locations for session records, turn records, artifacts, and logs.
- Fixed naming rules around UUID-based filenames, camelCase JSON payloads, RFC3339 timestamps, and NDJSON logs.
- Defined the lookup and recovery contract for `initialize_app`, `list_sessions`, `read_session`, artifact lookup, and later index rebuild behavior.
- Clarified that user-facing save-copy outputs stay at their chosen destination and are referenced from artifact metadata rather than moved into the app data directory.

#### 5.2 Local JSON session persistence and reload

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/models.rs`

Outcome:

- Replaced the desktop runtime's session storage mode with app-local JSON persistence rooted at Tauri's app-local data directory plus `storage-v1`.
- Added manifest and session index management plus canonical `session.json` and `turns/{turnId}.json` writes using a temporary-file-and-rename pattern.
- Reloaded persisted sessions and turns during app startup so `initialize_app`, `list_sessions`, and `read_session` reflect previous runs without rebuilding the UI state manually.
- Kept relay packet, response, preview, and approval caches in memory for now while ensuring session and turn status changes are flushed to disk.
- Added a Rust test that creates persisted records, reopens storage, and confirms `list_sessions` and `read_session` survive a restart boundary.

#### 5.3 Turn-linked artifacts and logs

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`

Outcome:

- Added persisted artifact metadata and payload records under each session's `artifacts/{artifactId}/` directory for relay packets, pasted responses, validation results, previews, approval decisions, and execution results.
- Linked persisted artifact IDs back into `turn.itemIds` so reloaded turn records retain stable references to their on-disk history.
- Added `session.ndjson` and `{turnId}.ndjson` append-only log emission for session creation, turn start, packet generation, response validation, preview creation, approval decisions, and execution attempts.
- Preserved save-copy semantics by recording user-selected output paths in execution artifact metadata without moving those outputs into the app-local storage root.
- Added a Rust test that runs the relay flow, reloads the session, and verifies artifact metadata, payload files, log files, and turn linkage all persist correctly.

#### 5.4 Restart recovery and session list verification

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added restart-focused regression coverage for multiple persisted sessions so the on-disk session index is checked alongside `list_sessions` and `read_session`.
- Verified that reopening app-local storage preserves both draft and active sessions, including `latestTurnId` linkage for the active session.
- Confirmed that the persisted `sessions/index.json` entries match the session IDs returned after reload, so the session list remains aligned with disk state across relaunches.

### Frontend MVP Flow Foundation

#### 6.1 App shell and primary routes

Completed.

Artifacts:

- `apps/desktop/src/routes/+layout.svelte`
- `apps/desktop/src/routes/+page.svelte`
- `apps/desktop/src/routes/studio/+page.svelte`
- `apps/desktop/src/routes/settings/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a shared desktop route shell with persistent navigation for Home, Studio, and Settings so the frontend no longer hangs off a single landing page.
- Kept the existing typed IPC initialization snapshot on Home while reshaping the page into a route-aware session hub placeholder for the next subtask.
- Added a three-pane Studio placeholder route that reserves stable regions for timeline, workflow controls, and workbook preview work without pulling in session state early.
- Added a Settings route for MVP execution and storage policies so later UI work has a stable location for safety and local-behavior controls.

#### 6.2 Home session list and creation flow

Completed.

Artifacts:

- `apps/desktop/src/routes/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the static Home placeholder with a real session hub that loads persisted sessions through `list_sessions` and surfaces the current typed IPC/storage snapshot.
- Added a create-session form that calls `create_session`, updates the visible session list immediately, and keeps workbook path optional for the current MVP slice.
- Added session cards that expose status, turn count, updated timestamp, persisted workbook path, and a Studio handoff link carrying the `sessionId` in the route query.
- Kept the implementation local to Home so the upcoming Studio state task can layer session detail loading onto a stable session-entry surface instead of rebuilding the route.

#### 6.3 Studio panes and local state model

Completed.

Artifacts:

- `apps/desktop/src/lib/studio-state.ts`
- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the Studio placeholder with a real three-pane workspace for timeline, workflow, and workbook preview responsibilities.
- Added a minimal store-backed Studio state model that tracks the selected `sessionId`, turn draft fields, staged packet text, pasted response text, local validation notes, and preview notes.
- Wired the route query handoff into the store so Home can pass a selected session into Studio before backend detail loading exists.
- Added derived timeline and workbook-preview state so edits in the workflow pane immediately show up in the correct left and right panes without waiting for backend command wiring.

#### 6.4 Studio backend command wiring and validation feedback

Completed.

Artifacts:

- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the Studio route's local-only placeholders with a command-backed flow that loads session detail through `read_session` and surfaces persisted turns in the left pane.
- Wired `start_turn`, `generate_relay_packet`, `submit_copilot_response`, and `preview_execution` through the typed frontend IPC layer so the Studio workflow now advances through the real backend lifecycle.
- Added structured validation rendering for accepted responses, issue lists, and repair prompts, plus preview rendering for output-path, approval-gate, warnings, and per-sheet diff summary data.
- Added an explicit reload note for persisted turns because session history survives restart while in-memory relay caches still need to be regenerated in the current app run.

### Workbook Engine Foundation

#### 8.1 Workbook library selection and module boundaries

Completed.

Artifacts:

- `docs/WORKBOOK_ENGINE.md`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/source.rs`
- `apps/desktop/src-tauri/src/workbook/csv_backend.rs`
- `apps/desktop/src-tauri/src/workbook/xlsx_backend.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`

Outcome:

- Selected `csv` as the CSV-first read/write dependency and `calamine` as the limited xlsx-family read dependency, matching the MVP guardrail that spreadsheet mutation should stay CSV-first and xlsx should stay inspect-oriented.
- Added a dedicated Rust `workbook` module boundary that separates source detection, CSV backend setup, xlsx backend setup, inspect policy, and preview gating instead of continuing to grow workbook logic inside `storage.rs`.
- Added Rust-side workbook model types for `WorkbookFormat`, `WorkbookSheet`, and `WorkbookProfile` so the backend now has a stable shape for the upcoming inspect tools.
- Moved derived save-copy output-path logic behind the new workbook module so preview synthesis already depends on the new engine boundary for source-path handling.

#### 8.2 Read-side workbook tools

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Implemented `workbook.inspect`, `sheet.preview`, and `sheet.profile_columns` for CSV inputs, with limited xlsx read support through the same workbook engine boundary.
- Added typed Rust payloads for sheet preview rows and column profile summaries, including CSV-first type inference for integer, number, boolean, date, and string columns.
- Wired read-side tool execution into `preview_execution` so pasted responses that request inspect tools now produce persisted artifacts and turn-log entries during preview generation.
- Implemented `session.diff_from_base` as a read-side artifact resolver that can return the current diff summary or a persisted preview/diff artifact when an `artifactId` is supplied.

#### 8.3 Core CSV-first write-preview tools

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `docs/WORKBOOK_ENGINE.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the synthetic diff builder in `storage.rs` with a workbook-engine preview path that loads real CSV headers and row data before summarizing mutations.
- Implemented CSV-backed preview behavior for `table.rename_columns`, `table.cast_columns`, `table.filter_rows`, and `table.derive_column`, including sequential table-state updates, duplicate-header rejection, and derived save-copy path handling.
- Added a narrow preview expression and predicate grammar that supports bracketed column references for headers with spaces, basic arithmetic or string concatenation in `derive_column`, and single-comparison `filter_rows` predicates so preview can compute actual affected row counts for the supported MVP slice.
- Added workbook preview unit tests plus storage-level preview regressions that now use real CSV fixtures instead of placeholder workbook paths.

#### 8.4 Aggregation, save-copy support, and CSV demo verification

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Implemented real CSV-backed `table.group_aggregate` preview behavior, including grouped row synthesis, post-aggregation schema diffs, and numeric-aggregation warnings when non-numeric values are ignored.
- Tightened `workbook.save_copy` preview handling so copy-only xlsx plans are accepted, explicit output paths cannot point at the original source workbook, and derived output paths remain available when a write preview omits an explicit save-copy action.
- Added workbook preview regressions plus a storage-level demo regression that verify aggregated CSV output can be rendered from staged table state, inspect-plus-aggregate preview works through `preview_execution`, copy-only xlsx save-copy previews succeed, and the original CSV input remains unchanged after preview generation.
- Left `join_lookup` out of the MVP tool surface for now so the workbook slice stays aligned with the planned safe vertical slice.

#### 9.1 Preview payload and diff summary structure

Completed.

Artifacts:

- `packages/contracts/src/workbook.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Standardized the preview payload around explicit target context by adding a `target` object per diff entry plus top-level `targetCount` and `estimatedAffectedRows` summary fields.
- Kept the existing `sheets` collection name for compatibility while making each entry explicit enough to support later approval UI work for sheet- or table-oriented previews.
- Updated the Rust preview engine and persisted preview artifacts so the richer shape is produced by `preview_execution` rather than being a contracts-only stub.
- Updated the Studio diff pane to consume the new payload fields without widening the UI scope into approval controls ahead of Task `9.3`.

#### 9.2 Backend preview generation from parsed actions

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Kept `preview_execution` backed by the real workbook preview engine so validated action plans continue to produce target-aware diff summaries, affected-row estimates, output-path planning, and warning propagation before any write is allowed.
- Added a storage-level regression that drives parsed CSV write actions through the real session, relay-packet, response-validation, and preview path, then asserts the backend returns concrete column diffs, row estimates, and save-copy output metadata.
- Left Studio approval controls and save-copy execution out of scope for this task so the remaining Milestone 9 work stays focused on UI gating and write-time safeguards.

#### 9.3 Render diff preview and approval flow in the Studio UI

Completed.

Artifacts:

- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Extended the Studio timeline and right-side preview pane to show approval and execution stages alongside the existing preview diff summary.
- Added approval-note entry plus explicit approve/reject controls that call the typed IPC approval command and update execution readiness in the UI from live preview state and refreshed turn status.
- Added execution gating in the Studio preview pane so execution cannot be requested until a write-capable preview has been approved, while still surfacing the backend execution response and warnings for the current turn.

#### 9.4 Enforce save-copy only execution safeguards and CSV sanitization

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added workbook-engine-backed save-copy execution so approved CSV write actions now replay through the same staged transform path used for preview before writing a new output file.
- Replaced the write-execution stub in storage with real execution that keeps the original source workbook read-only, records executed artifacts and logs, and still refuses write runs until preview and approval have completed.
- Added CSV output sanitization that prefixes cells starting with `=`, `+`, `-`, or `@` before save-copy output is written, and covered the behavior with storage regressions for approval gating, executed output generation, source immutability, and dangerous-prefix neutralization.

#### 10.1 Example CSV asset for the MVP demo flow

Completed.

Artifacts:

- `examples/revenue-workflow-demo.csv`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a compact demo CSV under `examples/` that can drive the current MVP inspect, preview, approval, and save-copy workflow without extra setup.
- Chose columns and values that match the implemented tool surface: booleans and dates for inspect and filter flows, numeric plus non-numeric `amount` values for cast or aggregation warnings, and formula-like leading characters in `comment` values so CSV sanitization can be demonstrated on save-copy output.

#### 10.2 README setup, demo flow, and packet or response examples

Completed.

Artifacts:

- `README.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the placeholder README with real setup instructions, desktop run commands, a representative Studio demo flow, and the demo CSV location under `examples/`.
- Added a representative relay packet example plus a valid pasted Copilot response example that matches the implemented contracts and current Studio approval or execution flow.
- Documented the current MVP limitations in README so unsupported workbook paths and execution behaviors are explicit instead of implied.

#### 10.3 Keep `docs/IMPLEMENTATION.md` aligned with milestones and verification results

Completed.

Artifacts:

- `docs/IMPLEMENTATION.md`

Outcome:

- Reconciled the implementation log after the Milestone 5 documentation work so completed tasks, current status, verification notes, known limitations, and next planned work all reflect the real repository state.
- Kept the log focused on shipped behavior by pointing the current phase and next-step sections at the remaining manual walkthrough task instead of the already-finished CSV asset or README updates.

#### 10.4 Run the documented demo flow and reconcile docs with reality

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `README.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a storage-level regression that exercises the README demo path against the real example CSV: create session, start turn, generate packet, validate the documented response shape, preview, approve, execute, and assert the save-copy output plus source-file immutability.
- Tightened the README walkthrough by making the `workbook.save_copy` example path explicitly operator-supplied and writable, and by documenting the concrete bundled-sample outcome of 3 approved output rows with 3 sanitized `comment` cells.
- Reconciled the implementation log so the milestone status, known limitations, and next-step section reflect that the documented demo flow has now been verified instead of remaining a pending manual task.

## Decisions

- Treat the repository as greenfield apart from `.taskmaster/`.
- Keep Task Master task state aligned with real artifacts, not only intent.
- Finish planning artifacts before creating application code.
- Use CSV-first delivery as the MVP center of gravity once implementation begins.
- Allow `esbuild` as an approved pnpm build dependency so installs remain reproducible and non-interactive.
- Use SvelteKit `kit.alias` instead of tsconfig `paths` for app-local aliasing to avoid drift against the generated `.svelte-kit/tsconfig.json`.
- Keep `packages/contracts` source-first and modular until a compiled distribution artifact is actually needed.
- Keep the workbook stack limited to `csv` plus `calamine` until the CSV-first inspect and preview slice proves a heavier engine is necessary.
- Keep write-preview expression parsing intentionally narrow until save-copy execution exists: bracketed column references for spaced headers, one comparison in `filter_rows`, and basic arithmetic or string concatenation in `derive_column`.
- Capture non-engineer UX simplification as a separate follow-up PRD instead of retroactively widening the completed MVP milestone set, with startup simplicity, distribution/recovery/diagnostics UX, data-handling clarity, permission/constraint clarity, locale/csv compatibility, resumable-work UX, crash recovery, progress visibility, template starts, output-name safety, duplicate-run prevention, safe defaults, reviewer-friendly summaries, read-only review, inline help, pre-copy sensitivity warnings, local audit history, accessibility baselines, and execution-phase simplification called out as the primary next planning targets.
- Decompose that follow-up PRD into Task Master tasks `11` through `16` so the post-MVP scope can be worked milestone by milestone instead of remaining a narrative-only planning artifact.

## Verification Log

### 2026-03-28

Repository audit verification:

```bash
find /workspace/Relay_Agent -maxdepth 4 -type f | sort
```

Observed result:

- Only planning files and Task Master scaffolding were present.

Task graph verification:

```bash
jq empty .taskmaster/tasks/tasks.json
task-master validate-dependencies
task-master list --with-subtasks --json
```

Observed result:

- Task graph JSON is valid.
- Task Master dependency validation passed.
- Parent tasks and subtasks are recognized by Task Master.

Planning artifact verification:

```bash
test -f .taskmaster/docs/repo_audit.md
test -f PLANS.md
test -f AGENTS.md
test -f docs/IMPLEMENTATION.md
rg -n "^## Milestone|^### Goal|^### Change Targets|^### Acceptance Criteria|^### Verification Commands|^### Out of Scope|^### Risks and Mitigations|^## Draft Completion Conditions|^## Global Scope Exclusions" PLANS.md
```

Observed result:

- All planning files exist.
- `PLANS.md` contains the required milestone and planning sections.

Milestone 1 foundation verification:

```bash
pnpm install
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check
```

Observed result:

- The pnpm workspace resolves all three packages and runs the required install-time scripts successfully.
- SvelteKit check and typecheck pass for the desktop app and contracts package.
- The desktop production build succeeds and writes the SPA output to `apps/desktop/build`.
- `cargo check` succeeds for the Tauri workspace after installing the required Linux dependencies and adding a valid RGBA icon asset.

Milestone 2 contracts verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check
```

Observed result:

- The expanded contracts package compiles cleanly and remains consumable from the desktop app through the workspace package boundary.
- Desktop build and Rust check still pass after replacing the contracts stub with the shared schema surface.

Milestone 3 Rust scaffold verification:

```bash
. "$HOME/.cargo/env" && cargo check
pnpm check
pnpm typecheck
```

Observed result:

- The refactored Tauri module layout compiles and the command registration paths resolve correctly.
- Workspace JS and Svelte type checks still pass after the backend module split.

Milestone 3 lifecycle verification:

```bash
. "$HOME/.cargo/env" && cargo check
. "$HOME/.cargo/env" && cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust lifecycle commands compile successfully with the new in-memory storage abstraction and shared payload models.
- The storage-layer unit test passes for create-session, start-turn, and read-session behavior.
- The contracts package changes remain compatible with the desktop workspace typecheck and production build.

Milestone 3 relay command verification:

```bash
. "$HOME/.cargo/env" && cargo check
. "$HOME/.cargo/env" && cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The backend command surface for packet generation, response submission, preview, approval, and execution compiles and remains registered with Tauri.
- Rust tests pass for valid relay flow and invalid pasted-response validation cases.
- Workspace JS and Svelte checks still pass, and the desktop production build remains green after the contracts and backend relay changes.

Milestone 3 frontend IPC verification:

```bash
. "$HOME/.cargo/env" && cargo check
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The frontend IPC wrapper compiles cleanly against the shared contracts package and the existing Tauri command names.
- Svelte check and workspace typecheck pass with the updated desktop shell consuming `initialize_app` through the typed wrapper.
- The desktop production build still succeeds after the IPC wrapper and page integration changes.

Milestone 4 storage layout verification:

```bash
test -f docs/STORAGE_LAYOUT.md
rg -n "^## Root Layout|^## Record Roles|^## Naming Conventions|^## Lookup and Reload|^## Write Rules|^## Deferred To Later Tasks" docs/STORAGE_LAYOUT.md
```

Observed result:

- The storage layout document exists.
- The layout definition covers sessions, turns, artifacts, logs, naming rules, reload behavior, and deferred implementation boundaries without ambiguity.

Milestone 4 local JSON persistence verification:

```bash
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The Tauri desktop crate compiles with the new app-local JSON storage bootstrap and persistence helpers.
- Rust tests pass for the existing relay flow coverage plus restart-safe session and turn reload behavior.
- Workspace typecheck, Svelte check, and the desktop production build remain green after switching the runtime storage mode from memory to local JSON.

Milestone 4 artifact and log persistence verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting succeeds now that `rustfmt` is installed in the active toolchain.
- The desktop crate compiles after adding persisted artifact metadata, payload writes, and NDJSON log append helpers.
- Rust tests pass for both restart-safe session reload and persisted turn artifact and log linkage.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the storage layer started writing artifact and log records.

Milestone 4 restart recovery verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting still succeeds after adding the restart recovery regression coverage.
- The desktop crate compiles and the storage test suite now covers multiple-session restart recovery plus persisted session index consistency.
- Workspace typecheck, Svelte check, and the desktop production build remain green after closing the persistence milestone acceptance checks.

Frontend route shell verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte route compilation passes with the new shared layout and the added Home, Studio, and Settings pages.
- Workspace typecheck remains green after introducing the route shell and shared UI utility styles.
- The desktop production build succeeds and emits the new route entries without navigation or bundling errors.

Home session flow verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Home page now invoking `initialize_app`, `list_sessions`, and `create_session` through the typed IPC wrapper.
- Workspace typecheck remains green after adding the Home session form, optimistic list update, and persisted session card rendering.
- The desktop production build succeeds with the new Home route UI and Studio handoff links.
- Interactive desktop click-through for create-and-open was not run in this headless environment, so that last acceptance check remains a manual confirmation step.

Studio pane state verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Studio route consuming a shared local state store and route query handoff.
- Workspace typecheck remains green after introducing the store-backed timeline, workflow, and workbook preview models.
- The desktop production build succeeds with the larger Studio route and its new `$lib/studio-state.ts` module.
- Interactive route walkthrough for typing into each pane and confirming updates visually remains a manual verification step in a real desktop session.

Studio backend wiring verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Studio route now invoking `read_session`, `start_turn`, `generate_relay_packet`, `submit_copilot_response`, and `preview_execution`.
- Workspace typecheck remains green after adding backend response rendering, validation issue formatting, and preview diff summary panels to the Studio route.
- The desktop production build succeeds with the command-backed Studio workflow and the expanded mobile-safe layout styles.
- Full desktop click-through for starting a turn, pasting a valid or invalid response, and requesting preview still needs to be confirmed manually in a real Tauri session.

Workbook engine boundary verification:

```bash
cargo fmt --all
cargo check
cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting succeeds after adding the dedicated workbook module tree and the new Cargo dependencies.
- `cargo check` succeeds with `csv` and `calamine` resolved into the desktop crate and the preview layer consuming the new save-copy path helper from `workbook::source`.
- `cargo test` passes for the new workbook boundary coverage, including source-format detection, derived save-copy paths, and CSV-versus-xlsx preview strategy selection.
- Workspace typecheck, Svelte check, and the desktop production build remain green after adding the Rust workbook foundation files and workbook-related model types.

Read-side workbook tool verification:

```bash
cargo fmt --all
cargo check
cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo check` succeeds with the workbook engine now compiling real `workbook.inspect`, `sheet.preview`, `sheet.profile_columns`, and `session.diff_from_base` implementations.
- `cargo test` passes for the new CSV inspection coverage plus the preview-flow regression that verifies read-side tool artifacts are persisted during preview generation.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the Rust preview flow started recording workbook-profile, sheet-preview, column-profile, and diff-summary artifacts.
- Manual desktop verification for rendering these new read-side artifacts in the Studio right pane is still pending because the current UI only reads preview summary data.

Core CSV write-preview verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo fmt`, `cargo check`, and `cargo test` all pass after moving write-preview synthesis into `workbook::preview` and delegating `preview_execution` to the workbook engine.
- Rust tests now cover real CSV-backed rename, cast, filter, and derive preview behavior, including bracketed column references for spaced headers and end-to-end preview or approval storage flow with actual CSV fixtures.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the preview path stopped relying on the synthetic diff builder.
- This environment did not have Rust or the required Tauri GTK/WebKit development libraries preinstalled, so verification also included installing the stable Rust toolchain plus Debian `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `zlib1g-dev`.

Aggregation and save-copy preview verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` now covers real CSV `table.group_aggregate` preview behavior, copy-only xlsx save-copy planning, save-copy target-path rejection, source-file immutability, and a storage-level CSV demo flow that runs inspect plus aggregation through `preview_execution`.
- `cargo check`, workspace `pnpm check`, `pnpm typecheck`, and the desktop production build all pass after the aggregation and save-copy preview changes.

Preview payload structure verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with the updated `DiffSummary` shape, including preview regressions that now assert `targetCount`, `estimatedAffectedRows`, and explicit sheet target metadata.
- `cargo check` succeeds after aligning the Rust preview models, workbook preview generation, and storage-layer preview assertions to the new payload fields.
- `pnpm check`, `pnpm typecheck`, and the desktop production build all pass after the Studio UI switched from ad hoc `sheet` or `estimatedRows` fields to the standardized preview target structure.

Backend preview generation verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with a storage-level regression that submits parsed CSV write actions and verifies `preview_execution` returns concrete changed-column, added-column, affected-row, and output-path summary data before any run step.
- `cargo check` succeeds with backend preview generation still routed through the workbook engine rather than placeholder diff synthesis.
- `pnpm check`, `pnpm typecheck`, and the desktop production build continue to pass with no additional frontend scope added for Task `9.2`.

Studio approval flow verification:

```bash
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `pnpm check` and `pnpm typecheck` pass with the Studio route now wiring approval decisions, execution gating, and backend execution-result rendering into the preview pane without Svelte diagnostics.
- The desktop production build succeeds after adding preview-side approval note entry, approve/reject actions, and execution readiness messaging on top of the existing diff UI.
- `cargo check` remains green after the UI changes, confirming the frontend stayed aligned with the existing Rust approval and execution IPC surface.

Save-copy execution and sanitization verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with 23 tests, including storage regressions that confirm write execution stays blocked before approval, approved CSV actions write to a save-copy output, the original CSV input remains unchanged, persisted execution artifacts keep their output path metadata, and dangerous CSV-leading prefixes are sanitized in the written copy.
- `cargo check` succeeds after routing `run_execution` through the workbook engine instead of the previous write stub.
- `pnpm check`, `pnpm typecheck`, and the desktop production build remain green after the Studio approval and execution UI starts consuming successful execution responses from the backend.

Example CSV asset verification:

```bash
node -e "const fs=require('fs'); const path='examples/revenue-workflow-demo.csv'; const text=fs.readFileSync(path,'utf8').trim(); const rows=text.split(/\\r?\\n/); const header=rows[0].split(','); if (rows.length !== 6) throw new Error(`expected 6 rows including header, found ${rows.length}`); if (!header.includes('amount') || !header.includes('approved') || !header.includes('comment')) throw new Error('demo CSV is missing required workflow columns'); if (!rows.some((row) => /,oops,/.test(row))) throw new Error('demo CSV should include a non-numeric amount example'); if (!rows.some((row) => /,(=|\\+|@)/.test(row))) throw new Error('demo CSV should include formula-like prefixes for sanitization demos'); console.log('demo csv ok');"
```

Observed result:

- The example CSV exists under `examples/`, has the expected six-line shape including header plus five sample rows, exposes the `amount`, `approved`, and `comment` columns needed by the current workflow, includes one non-numeric amount for warning scenarios, and includes formula-like leading characters for save-copy sanitization demos.

README coverage verification:

```bash
node - <<'NODE'
const fs = require('fs');
const readme = fs.readFileSync('README.md', 'utf8');
const requiredSections = [
  '## Requirements',
  '## Demo Flow',
  '## Relay Packet Example',
  '## Valid Copilot Response Example',
  '## Limitations'
];
for (const section of requiredSections) {
  if (!readme.includes(section)) {
    throw new Error(`README is missing required section: ${section}`);
  }
}
if (!readme.includes('examples/revenue-workflow-demo.csv')) {
  throw new Error('README does not reference the demo CSV asset');
}
const responseMatch = readme.match(
  /## Valid Copilot Response Example[\s\S]*?```json\n([\s\S]*?)\n```/
);
if (!responseMatch) {
  throw new Error('README does not contain the valid response JSON block');
}
const response = JSON.parse(responseMatch[1]);
if (!Array.isArray(response.actions) || response.actions.length === 0) {
  throw new Error('README response example does not include any actions');
}
if (response.actions.at(-1).tool !== 'workbook.save_copy') {
  throw new Error('README response example must end with workbook.save_copy');
}
console.log('readme ok');
NODE

jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- README now includes setup instructions, demo usage, a relay packet example, a valid pasted response example, and explicit limitations aligned with the current CSV-first MVP.
- The response example JSON parses successfully and ends in `workbook.save_copy`, matching the implemented save-copy approval flow.

Implementation log alignment verification:

```bash
rg -n '^## Status|^#### 10\.1|^#### 10\.2|^#### 10\.3|^#### 10\.4|^## Known Limitations|^## Next Step' docs/IMPLEMENTATION.md
jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- `docs/IMPLEMENTATION.md` includes the full Milestone 5 task set through `10.4`, an up-to-date status summary, explicit known limitations, and a next-step note that the current MVP plan has no remaining tasks.
- Task Master JSON remains valid after syncing the implementation-log task state.

Documented demo flow verification:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml readme_demo_flow_matches_documented_example_csv_workflow
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- The new regression passes against `examples/revenue-workflow-demo.csv`, confirming the README flow can create a session, start a plan-mode turn, validate the documented response shape, require approval, execute a save-copy output, sanitize the three dangerous `comment` cells, and leave the bundled source CSV unchanged.
- `pnpm check`, `pnpm typecheck`, and `pnpm --filter @relay-agent/desktop build` remain green after the README clarifications and storage-level walkthrough coverage.
- `cargo check` and `cargo test` pass with 24 total Rust tests, so Milestone 5 now ends with the documented demo path verified alongside the broader backend suite.
- Task Master JSON remains valid after closing the final Milestone 5 task.

### 2026-03-29

Non-engineer UX follow-up PRD verification:

```bash
test -f .taskmaster/docs/prd_non_engineer_ux.txt
rg -n '^# 非エンジニア向けUX強化PRD|^## Problem Statement|^## Development Roadmap|^## Acceptance Criteria|^### Capability: Easy Launch and First Run|^### Capability: Data Trust and File Readiness|^### Capability: Session Continuity|^### Capability: Guided Templates and Safe Defaults|^### Capability: Progress Visibility|^### Capability: Accessibility Baseline|権限|未保存|制約|承認者|アクセシビリティ|地域設定|CSV|二重実行|読み取り専用|ヘルプ|やり直し|破棄|異常終了|復旧|機密|個人情報|監査|操作履歴' .taskmaster/docs/prd_non_engineer_ux.txt
rg -n '^## Follow-up Scope Note' PLANS.md
jq '.master.tasks[] | select((.id | tonumber) >= 11 and (.id | tonumber) <= 16) | {id, title, status, dependencies}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The new supplemental PRD exists under `.taskmaster/docs/` and records a concrete post-MVP usability scope for non-engineer operators.
- The document now explicitly includes startup simplicity for non-engineers, including packaged-app-first launch expectations, first-run guidance, installer/update expectations, recovery guidance, and diagnostic-export behavior.
- The document now also covers data-handling clarity, file preflight checks, resumable drafts, recent-work access, and post-run next actions needed for everyday non-engineer operation.
- The document also adds progress visibility, template-driven starts, output-name collision avoidance, shareable completion paths, and safe-default behavior as explicit non-engineer requirements.
- The document now further covers permission-request explanations, unsaved-work warnings, early constraint surfacing, reviewer-friendly summaries, and accessibility baselines for non-engineer operation.
- The document now also covers locale or CSV compatibility guidance, duplicate-run prevention, read-only review mode, inline help, and clearer retry or discard choices for non-engineer operation.
- The document now also covers crash recovery after abnormal shutdown, pre-copy sensitivity warnings for confidential or personal data, and local audit history for later review or support handoff.
- The supplemental PRD is now decomposed in Task Master as follow-up tasks `11` through `16`, covering startup, data trust, continuity, onboarding, review/save simplification, and cross-cutting recovery plus accessibility work.
- The document continues to center execution-path simplification by collapsing the user-facing preview, approval, and save-copy flow into a clearer "review and save" experience while preserving the existing backend guardrails.
- `PLANS.md` now points future scope expansion at this follow-up PRD instead of silently widening the completed MVP milestone set.
- Task Master JSON remains valid and now includes the follow-up task breakdown for the supplemental non-engineer UX PRD.
- The updated planning artifacts also pass `git diff --check`, so the new task breakdown did not introduce whitespace or patch-format issues.

## Known Limitations

- The desktop UI now supports session listing, turn start, relay packet generation, response validation, preview requests, approval decisions, and save-copy execution in Studio, but dedicated artifact browsers for workbook profiles and diffs are still not surfaced.
- Persisted artifact and log files are not yet rehydrated into active in-memory relay caches on startup, so restart preserves history linkage but not resumable packet, validation, preview, or approval runtime state.
- The workbook pane still renders preview summaries from backend metadata only; the newly persisted workbook-profile, sheet-preview, and column-profile artifacts are not yet surfaced in dedicated UI panels.
- Preview predicates and derive expressions intentionally support a narrow grammar for now: bracketed column references for spaced headers, one comparison in `filter_rows`, and basic arithmetic or string concatenation in `derive_column`.
- Limited xlsx support is still inspect-and-copy oriented; current test coverage still centers on CSV execution plus xlsx preview planning rather than richer xlsx write flows.
- Task Master native AI PRD parsing is still blocked unless provider API keys are configured.

## Next Step

Next planned work:

- No remaining tasks are pending in the current MVP plan; future work should start from a new planned milestone or follow-up scope update.
