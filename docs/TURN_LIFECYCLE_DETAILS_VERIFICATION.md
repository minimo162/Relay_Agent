# Turn Lifecycle Details Verification

## Goal

Confirm that Studio `Inspection details` now exposes read-only turn lifecycle
summaries for packet, validation, approval, and execution alongside the
existing workbook evidence browser.

## Preconditions

- Run the app from source with `pnpm --filter @relay-agent/desktop tauri:dev`.
- Use a local profile with writable app-local storage for persisted-turn checks.
- Use the sample workbook at `examples/revenue-workflow-demo.csv` or another CSV
  file you can safely preview and save-copy.

## Scenario 1: Review current turn lifecycle details in editable Studio

1. Open Home and create or reopen a session that points at a CSV source.
2. Open the session in Studio and start a turn.
3. Generate the relay packet.
4. Paste a valid Copilot response with at least one save-capable action and
   `workbook.save_copy`.
5. Run `Validate response` and then `Check changes`.
6. Scroll to `Inspection details` and open `Turn details`.
7. Switch between `Overview`, `Packet`, `Validation`, `Approval`, and
   `Execution`.

Expected result:

- `Overview` shows the lifecycle timeline, current stage label, relay mode, and
  storage mode.
- `Packet` shows the source file, objective, context lines, allowed tool counts,
  and whether the detail is coming from live state or a saved artifact.
- `Validation` shows pass or fail status, primary reason, issue count, warning
  count, and whether preview can proceed.
- `Approval` shows either the required-review state or an explicit `Not required`
  summary for read-only previews.
- `Execution` shows `Ready to save`, `Blocked`, or `Not required` before any
  save runs.

## Scenario 2: Confirm temporary mode still shows live turn details

1. Force Home into `Continue in temporary mode`.
2. Create a session, open Studio, start a turn, generate a relay packet, and
   run `Validate response` plus `Check changes`.
3. Open `Inspection details` for that turn.

Expected result:

- `Turn details` still renders for the current turn even though local artifact
  persistence is unavailable.
- The overview summary explains that the details are coming from live in-memory
  state.
- Steps that have not happened yet show explicit unavailable-state messaging
  instead of a blank panel.
- `Workbook evidence` may still be empty in temporary mode, but that empty state
  does not hide the lifecycle details above it.

## Scenario 3: Persist and reopen turn lifecycle details

1. Use a saved-local session and complete a turn through preview plus approval.
2. Save the reviewed copy, or leave it ready for save without executing.
3. Close and reopen the app.
4. Reopen the same session and turn, then open `Inspection details`.

Expected result:

- `Turn details` still load after restart from persisted local artifacts.
- `Packet`, `Validation`, `Approval`, and `Execution` show saved summaries rather
  than reverting to empty-state messaging.
- `Workbook evidence` still shows the persisted workbook artifacts for the same
  turn.

## Scenario 4: Review the same lifecycle details in reviewer mode

1. From a saved turn, click `Open reviewer view`.
2. Confirm the reviewer URL still points at the same session and turn.
3. Open `Inspection details`.

Expected result:

- Reviewer mode shows the same `Turn details` and `Workbook evidence`.
- Editing, Copilot handoff, approval, and save controls remain hidden.
- The lifecycle browser remains read-only.

## Scenario 5: Confirm execution failure details are captured

1. Run a save-capable turn where `workbook.save_copy` targets a path that cannot
   be created or written.
2. Let `Save reviewed copy` fail.
3. Reopen `Inspection details` for the same turn.

Expected result:

- `Execution` shows a failed state instead of silently returning to a blank or
  pending panel.
- The failure summary includes the reason in plain language and, when available,
  the intended save-copy destination.
- Reopening the same turn after restart still shows the failed execution summary
  from persisted local artifacts.

## Command Checks

```bash
test -f .taskmaster/docs/prd_turn_lifecycle_details.txt
test -f docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md
pnpm --filter @relay-agent/contracts typecheck
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 21 and (.id | tonumber) <= 26) | {id, status}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
