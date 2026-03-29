# Workbook Artifact Browser Verification

## Goal

Confirm that Studio exposes persisted workbook inspection artifacts for the
selected turn in both editable Studio and read-only reviewer mode.

## Preconditions

- Run the app from source with `pnpm --filter @relay-agent/desktop tauri:dev`.
- Use a local profile with writable app-local storage.
- Use the sample workbook at `examples/revenue-workflow-demo.csv` or another CSV
  path you can inspect safely.

## Scenario 1: Create persisted workbook artifacts

1. Open Home and create or reopen a session that points at the sample CSV.
2. Open the session in Studio.
3. Start a turn with an objective that asks for workbook inspection plus a safe
   save-copy plan.
4. Generate the relay packet.
5. Paste a valid Copilot response that includes these read tools before the
   save-copy step:
   - `workbook.inspect`
   - `sheet.preview`
   - `sheet.profile_columns`
   - `session.diff_from_base`
6. Run `Validate response`.
7. Run `Check changes`.

Expected result:

- Validation succeeds.
- Preview succeeds.
- The selected turn now has persisted workbook artifacts behind the scenes.

## Scenario 2: Review inspection details in editable Studio

1. Stay on the same turn after preview finishes.
2. Scroll to the `Inspection details` section in the center pane.
3. Switch between the available artifact entries.

Expected result:

- The artifact list shows saved entries such as `Workbook profile`,
  `Sheet preview`, `Column profile`, and either `Diff from base` or
  `Checked changes snapshot`.
- `Workbook profile` shows source path, format, sheet count, and per-sheet
  row or column summaries.
- `Sheet preview` shows sampled rows in a readable table and indicates whether
  the preview was truncated.
- `Column profile` shows inferred type, non-empty count, blank count, and
  sample values for each column.
- Diff or preview artifacts show source path, output path, target count,
  estimated affected rows, changed columns, and warnings.

## Scenario 3: Review the same artifacts in reviewer mode

1. Save the reviewed copy for the same turn, or use a turn that already has a
   saved review.
2. Click `Open reviewer view`.
3. Confirm the reviewer URL still points at the same session and turn.
4. Open `Inspection details` in reviewer mode.

Expected result:

- Reviewer mode still shows the same artifact browser and artifact details.
- Editing, Copilot handoff, approval, and save controls remain hidden.
- The artifact browser stays read-only.

## Scenario 4: Confirm empty-state behavior

1. Open a turn that has never run workbook read tools, or reopen the app in
   temporary mode and inspect any turn.
2. Scroll to `Inspection details`.

Expected result:

- Studio shows `No saved inspection details yet`.
- The empty state explains that read tools such as `workbook.inspect`,
  `sheet.preview`, `sheet.profile_columns`, and `session.diff_from_base`
  create these artifacts.
- The message also explains that temporary mode does not keep local artifact
  history across restart.

## Command Checks

```bash
test -f .taskmaster/docs/prd_workbook_artifact_browser.txt
test -f docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 17 and (.id | tonumber) <= 20) | {id, status}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
