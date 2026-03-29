# Relay Agent

Relay Agent is a desktop MVP for turning a validated JSON action plan into a safe workbook preview, explicit approval step, and save-copy-only output. The current vertical slice is CSV-first: you can inspect workbook state, preview supported table transforms, approve a write-capable plan, and execute it to a new file without mutating the original input.

## Current MVP Scope

- Home can create and reopen persisted sessions from local JSON storage.
- Home now surfaces a short recent-work list so the last opened sessions and workbook paths are easier to resume.
- Home now keeps first-run setup focused on one choice at a time and offers plain-language objective starters before the first session is created.
- Home now also offers quick-start templates for common spreadsheet tasks and reminds first-time users which safe defaults are already on.
- Home and Studio now expose short in-product help so users can re-check terms and next actions without leaving the app.
- Home now keeps a local `Recent saves` history so reviewers can reopen a saved turn without retracing the full editing flow.
- Studio now exposes `Load demo response` for the bundled sample walkthrough so preview can be reached without copying the README example JSON.
- Studio now collapses the technical preview, approval, and execution steps into a clearer `Review and save` pane with one primary action and a three-point summary.
- Studio now prevents duplicate save runs for turns that already completed and exposes post-save actions for summary sharing and reviewer handoff.
- Studio can start turns, generate relay packets, validate pasted Copilot JSON, request execution preview, record approval, and run save-copy execution.
- Studio now provides a `Copy for Copilot` path that warns first when the workbook path, current objective, or available column names look sensitive.
- Studio now exposes a read-only reviewer mode plus `Copy review summary` so approvers can inspect a saved turn without editing controls.
- Studio now exposes an `Inspection details` browser for the selected turn, pairing read-only `Turn details` lifecycle summaries with saved workbook evidence so packet, validation, approval, execution, and workbook artifacts can be reviewed without opening local JSON files by hand.
- Studio now rewrites validation, preview, and save failures into plain-language guidance with copyable Copilot follow-up prompts.
- Studio now restores local turn drafts, pasted response text, relay packet text, and the last preview summary snapshot after restart.
- Studio now warns before leaving, going back, or switching turns when local draft or preview review state would otherwise be thrown away.
- CSV write execution is supported for `table.rename_columns`, `table.cast_columns`, `table.filter_rows`, `table.derive_column`, `table.group_aggregate`, and `workbook.save_copy`.
- CSV save-copy output is sanitized so cells starting with `=`, `+`, `-`, or `@` are prefixed before the new file is written.
- Xlsx support is currently limited to inspect-oriented flows and save-copy preview planning, not rich write execution.

## Requirements

- Node.js `>= 22`
- `pnpm` `10.x`
- Rust stable toolchain with `cargo`
- The native dependencies required by Tauri for your operating system

## Install

From the repository root:

```bash
pnpm install
```

## Run The Desktop App

Start the Tauri desktop shell:

```bash
pnpm --filter @relay-agent/desktop tauri:dev
```

Optional frontend-only shell:

```bash
pnpm --filter @relay-agent/desktop dev
```

The packaged non-engineer release target is tracked in
[`docs/PACKAGING_POLICY.md`](docs/PACKAGING_POLICY.md). The commands above are still
the current verified way to run the app from source.

Repo checks:

```bash
pnpm check
pnpm typecheck
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Home Startup Behavior

- On a clean profile with no saved sessions, Home shows a first-run welcome with
  `Try the sample flow` and `Use my own file`.
- `Try the sample flow` preloads the bundled demo objective and
  `examples/revenue-workflow-demo.csv` when that sample path is discoverable in
  the current build.
- `Use my own file` keeps the flow manual and explains why Windows may later ask
  for access to the chosen workbook or save destination.
- On first run, the create-session panel stays gated until you choose sample or
  custom start, then it shows plain-language example goals instead of requiring
  technical wording.
- After that choice, Home also offers quick-start templates such as rename,
  type cleanup, filtering, and totals so the first draft can start from a
  familiar spreadsheet task.
- Home and Studio both expose short `Show help` panels that explain the current
  step in plain language instead of sending first-time users to the README.
- Home now runs a file check before session creation when a workbook path is
  present, surfacing unreadable files, unsupported separators, and locale- or
  CSV-specific compatibility notes in plain language.
- Home now keeps a visible `File safety` note on the create-session path so the
  original workbook protection is always stated in plain language.
- Home also surfaces recent sessions and recent workbook paths that were used in
  the last local runs so the next Studio handoff is quicker.
- Home now also surfaces recent reviewed saves so approvers can jump directly
  into reviewer mode for the latest saved turn.
- If the previous app run ended unexpectedly while a draft was still autosaved,
  Home shows a recovery prompt so you can restore that work in Studio or discard
  it.
- If local storage cannot be opened at startup, Home shows a plain-language
  startup issue and offers `Retry startup checks` or `Continue in temporary
  mode`. Temporary mode is for short-lived testing only and does not survive
  restart.

## Continuity Behavior

- Studio keeps a local resumable draft per session, including the turn title,
  turn objective, workbook path, pasted response text, relay packet text, and
  the last preview summary snapshot.
- When you reopen that session in Studio, the draft is restored automatically
  and the UI tells you when a preview snapshot came from a previous run.
- If the app did not close cleanly, Home offers that same draft as recovery
  work before you even enter Studio.
- If you try to leave Studio or switch turns while draft or preview review work
  is still staged, Studio asks whether to keep that draft for later or discard
  it deliberately before continuing.
- Preview and approval runtime state are still not executable after restart, so
  request preview again before approval or execution.
- Recent reviewed saves can be reopened in a read-only reviewer mode that hides
  editing and save controls while still showing summary, output path, and
  warnings.

## Review Recovery

- When validation, preview, approval, or save cannot continue, Studio now shows
  plain-language `problem`, `reason`, and `next steps` guidance instead of only
  backend wording.
- Those failure states also provide a copyable Copilot follow-up prompt so a
  non-engineer operator can ask for a safer retry without writing the repair
  request from scratch.

## Inspection Details

- Studio now keeps a read-only `Inspection details` section for the selected
  turn so operators and reviewers can inspect lifecycle summaries and workbook
  evidence without browsing the local storage folder directly.
- `Turn details` now covers a read-only overview plus `Packet`,
  `Validation`, `Approval`, and `Execution` tabs for the selected turn.
- Those lifecycle summaries resolve from live in-memory state for the current
  turn and from persisted local artifacts after reload, so temporary mode still
  shows meaningful current-turn details while the app stays open.
- `Workbook evidence` continues to show persisted `workbook-profile`,
  `sheet-preview`, `column-profile`, `diff-summary`, and `preview` artifacts.
- Reviewer mode shows the same `Turn details` and `Workbook evidence` surfaces
  while still hiding editing, Copilot handoff, approval, and save controls.
- If a step has not been reached yet, belongs to an older unsupported turn, or
  temporary-mode evidence is only live for the current app session, Studio now
  shows an explicit unavailable-state reason instead of a blank panel.

## Demo Asset

Use the sample CSV at [examples/revenue-workflow-demo.csv](examples/revenue-workflow-demo.csv).

It was chosen to exercise the implemented workflow:

- `amount` includes one non-numeric value so cast or aggregation warnings can be demonstrated.
- `approved` and `posted_on` support filter and inspect scenarios.
- `comment` includes `=`, `+`, and `@` prefixes so save-copy sanitization can be observed on execution output.

For Studio, prefer an absolute workbook path:

```bash
pwd
```

Then use:

```text
<repo-root>/examples/revenue-workflow-demo.csv
```

## Demo Flow

1. Start the app with `pnpm --filter @relay-agent/desktop tauri:dev`.
2. On a clean profile, either:
   - click `Try the sample flow` to preload the session draft, or
   - click `Use my own file` and fill the form manually with the values below.
3. If you are filling the form manually, create a session with:
   Title: `Revenue workflow demo`
   Objective: `Inspect the sample CSV, preview a safe transform, and write a sanitized copy.`
   Primary workbook path: `<repo-root>/examples/revenue-workflow-demo.csv`
4. Click `Check this file` and confirm Home reports the sample CSV as ready.
5. Open that session in Studio.
6. Start a turn, for example:
   Title: `Approved revenue cleanup`
   Objective: `Keep approved rows, add a review label, preview the diff, approve it, and save a copy.`
   Relay mode: `plan`
7. Click `Generate packet`.
8. Either click `Load demo response` for the bundled sample walkthrough, or paste the valid response example below, then click `Validate response`.
9. Click `Check changes` and review the summary, output path, warnings, and `Inspection details` in Studio.
10. If the plan changes the workbook, add an optional review note, click `Confirm review`, then click `Save reviewed copy`.
11. After save, use `Copy review summary` or `Open reviewer view` if you want a read-only confirmation path with the same inspection details.
12. Confirm the output file exists at the configured `outputPath`.
13. Confirm the original file under `examples/` is unchanged.

The full follow-up verification checklist for the non-engineer usability scope is
tracked in [`docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md`](docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md).
The workbook artifact browser verification checklist is tracked in
[`docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md`](docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md).
The turn lifecycle inspection verification checklist is tracked in
[`docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md`](docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md).

With the response example below, the output copy should contain only rows where `approved = true`, add a derived `review_label` column, and prefix any dangerous `comment` values before writing the new CSV. On the bundled sample CSV, that produces 3 output rows and sanitizes 3 `comment` cells.

## Relay Packet Example

The generated relay packet is the payload you would hand to Copilot. The exact `sessionId`, `turnId`, and `objective` values will differ per run, but the shape is stable.

```json
{
  "version": "1.0",
  "sessionId": "<session-id>",
  "turnId": "<turn-id>",
  "mode": "plan",
  "objective": "Keep approved rows, add a review label, preview the diff, approve it, and save a copy.",
  "context": [
    "Session objective: Inspect the sample CSV, preview a safe transform, and write a sanitized copy.",
    "Turn title: Approved revenue cleanup",
    "Safe mode: preview and approval are required before writes.",
    "Primary workbook path: <repo-root>/examples/revenue-workflow-demo.csv"
  ],
  "allowedReadTools": [
    {
      "id": "workbook.inspect",
      "title": "Inspect workbook",
      "description": "Read workbook metadata, sheets, and basic summary information.",
      "phase": "read",
      "requiresApproval": false
    },
    {
      "id": "sheet.preview",
      "title": "Preview sheet rows",
      "description": "Read a small sample of rows from a sheet.",
      "phase": "read",
      "requiresApproval": false
    },
    {
      "id": "sheet.profile_columns",
      "title": "Profile columns",
      "description": "Inspect inferred types and sample values for sheet columns.",
      "phase": "read",
      "requiresApproval": false
    },
    {
      "id": "session.diff_from_base",
      "title": "Diff from base",
      "description": "Compare the current session state to the original workbook input.",
      "phase": "read",
      "requiresApproval": false
    }
  ],
  "allowedWriteTools": [
    {
      "id": "table.rename_columns",
      "title": "Rename columns",
      "description": "Rename one or more columns in a table or sheet.",
      "phase": "write",
      "requiresApproval": true
    },
    {
      "id": "table.cast_columns",
      "title": "Cast columns",
      "description": "Convert one or more columns to new logical types.",
      "phase": "write",
      "requiresApproval": true
    },
    {
      "id": "table.filter_rows",
      "title": "Filter rows",
      "description": "Filter table rows into a refined output.",
      "phase": "write",
      "requiresApproval": true
    },
    {
      "id": "table.derive_column",
      "title": "Derive column",
      "description": "Create a derived output column from an expression.",
      "phase": "write",
      "requiresApproval": true
    },
    {
      "id": "table.group_aggregate",
      "title": "Group aggregate",
      "description": "Group rows and calculate aggregated output columns.",
      "phase": "write",
      "requiresApproval": true
    },
    {
      "id": "workbook.save_copy",
      "title": "Save copy",
      "description": "Write the staged workbook changes to a new output path.",
      "phase": "write",
      "requiresApproval": true
    }
  ],
  "responseContract": {
    "format": "json",
    "expectsActions": true,
    "notes": [
      "Return strict JSON only.",
      "Write actions require preview and approval before execution."
    ]
  }
}
```

## Valid Copilot Response Example

Replace `outputPath` with a writable absolute path for your operating system, then paste strict JSON only into the Studio response box:

```json
{
  "version": "1.0",
  "summary": "Keep approved rows, add a review label, and write a sanitized CSV copy.",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": {
        "predicate": "approved = true"
      }
    },
    {
      "tool": "table.derive_column",
      "sheet": "Sheet1",
      "args": {
        "column": "review_label",
        "expression": "[segment] + \"-approved\"",
        "position": "end"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "/absolute/path/to/revenue-workflow-demo.cleaned.csv"
      }
    }
  ],
  "followupQuestions": [],
  "warnings": []
}
```

## Supported Write Tools

- `table.rename_columns`
- `table.cast_columns`
- `table.filter_rows`
- `table.derive_column`
- `table.group_aggregate`
- `workbook.save_copy`

## Limitations

- Save-copy only: execution never writes back to the original workbook path.
- CSV is the only format with real write execution today.
- Xlsx support is currently inspect-and-preview oriented; richer write execution is not implemented.
- `join_lookup` is not part of the current MVP tool surface.
- `derive_column` rejects raw Excel-style formulas from model output.
- Preview predicates and expressions intentionally support a narrow grammar:
  - one comparison in `table.filter_rows`
  - bracketed column references for spaced headers
  - basic arithmetic or string concatenation in `table.derive_column`
- Runtime preview, approval, and execution work are still not resumable after restart even though sessions, lifecycle summaries, workbook artifacts, and logs persist to disk.
- `Inspection details` are intentionally read-only. They explain packet, validation, approval, execution, and workbook evidence, but they do not add restart, retry, or guardrail-bypass actions.
- Temporary mode can show current-turn lifecycle details from live state, but those details disappear when the app closes, and older turns without saved lifecycle artifacts fall back to explicit unavailable-state messaging.
- The product workflow does not implement shell access, arbitrary code execution, VBA execution, or external network execution.

## Repository Layout

- `apps/desktop`: SvelteKit + Tauri desktop shell
- `packages/contracts`: shared Zod contracts and TypeScript types
- `examples`: demo input files
- `docs/IMPLEMENTATION.md`: running implementation log and verification history
- `PLANS.md`: MVP milestone plan
