# Relay Agent

Relay Agent is a desktop MVP for turning a validated JSON action plan into a safe workbook preview, explicit approval step, and save-copy-only output. The current vertical slice is CSV-first: you can inspect workbook state, preview supported table transforms, approve a write-capable plan, and execute it to a new file without mutating the original input.

## Current MVP Scope

- The app stores sessions in local JSON and shows a short recent-session list on the main page.
- Recent sessions with unfinished work can be resumed from the same page through the `下書きを再開` badge.
- The main workflow is now one guided page with 3 stages: `はじめる`, `Copilot に聞く`, and `確認して保存`.
- All 3 stages stay visible at once; unreached stages are greyed out, and Step 1 collapses into an editable summary after preparation succeeds.
- Step 1 offers a bundled CSV shortcut, objective templates, and an editable task name that auto-fills from the objective.
- The main action is always a single primary button for the current stage, with inline progress when multiple backend commands run in sequence.
- Preparation now runs workbook preflight and workbook inspection so the Copilot handoff includes sheet names, typed column hints, a suggested output path, and a template-specific JSON example.
- Copilot handoff now copies natural-language instructions plus a strict JSON template instead of a raw relay packet.
- Pasted Copilot JSON is auto-fixed for common issues such as markdown fences, `~~~json` fences, BOM, CRLF, trailing commas, smart quotes, full-width spaces, prose-wrapped JSON, and Windows-style path separators before validation.
- Validation failures now show level-specific plain-language guidance plus a ready-to-copy retry prompt.
- Review and save pins a three-point summary above the fold, shows per-sheet row-level before/after samples in the SheetDiff cards, and saves through one `保存する` action while keeping preview-before-write and save-copy-only guardrails.
- The page also includes a settings modal for safety and storage notes plus a `詳細表示` drawer for the raw relay packet, response template, and retry prompt.
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

## Environment Variables

No `.env` file is required to start the Relay Agent desktop app from source.

- `pnpm --filter @relay-agent/desktop tauri:dev` works without copying
  `.env.example`.
- The root [`.env.example`](.env.example) is for optional Task Master and model
  provider integrations, not for the local desktop app workflow described in
  this README.
- If you only want to run the desktop app, you can skip `.env` setup entirely.
- If you also want Task Master AI-assisted parsing or planning features, copy
  `.env.example` to `.env` and set the provider keys that match your
  [`.taskmaster/config.json`](.taskmaster/config.json) model configuration.

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

## Windows Installer Status

- This repository does not currently include a prebuilt Windows installer.
- The first packaged end-user target is Windows 10/11 x64 with an NSIS
  installer, as documented in
  [`docs/PACKAGING_POLICY.md`](docs/PACKAGING_POLICY.md).
- Packaged Windows installers are published to GitHub Releases for tagged
  versions instead of being committed into the repository.
- The source-run path shown above with
  `pnpm --filter @relay-agent/desktop tauri:dev` remains the verified local
  development path.

If you want to build a Windows installer yourself on a Windows machine with the
required Tauri toolchain installed, run:

```bash
pnpm install
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --dir apps/desktop exec tauri build --config src-tauri/tauri.windows.conf.json
```

When that packaging step succeeds, check the generated bundle output under:

```text
target/release/bundle/nsis/
```

Treat that as a locally built packaging artifact. It is not a checked-in
release file in this repository today.

The shared Tauri bundle config also includes
`examples/revenue-workflow-demo.csv` as a packaged resource so installed builds
can discover the bundled walkthrough without requiring a repository checkout.

For maintainers, the repository also includes GitHub Actions release automation
at [`.github/workflows/release-windows-installer.yml`](.github/workflows/release-windows-installer.yml).
Pushing a tag such as `v0.1.0` to GitHub is the intended way to build the
Windows NSIS installer and attach it to a GitHub Release.

Repo checks:

```bash
pnpm check
pnpm typecheck
pnpm startup:test
pnpm launch:test
pnpm workflow:test
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Startup Test

Run the dedicated source-run startup smoke command from the repository root:

```bash
pnpm startup:test
```

This command does not open the desktop window. It validates the shared startup
path for:

- normal ready startup
- retry-recovery startup
- attention startup with temporary memory fallback

The matching manual GUI checklist lives in
[`docs/STARTUP_TEST_VERIFICATION.md`](docs/STARTUP_TEST_VERIFICATION.md).

## App Launch Test

Run the real launch smoke command from the repository root:

```bash
pnpm launch:test
```

This command starts `Xvfb` directly, launches `pnpm tauri:dev`, waits for the
frontend dev server, confirms the desktop binary started, and checks that the
app stays alive for a short stability window before cleanup.

The matching verification checklist lives in
[`docs/APP_LAUNCH_TEST_VERIFICATION.md`](docs/APP_LAUNCH_TEST_VERIFICATION.md).

## App Workflow Test

Run the launched-app workflow smoke command from the repository root:

```bash
pnpm workflow:test
```

This command starts `Xvfb`, launches `pnpm tauri:dev`, waits for the frontend
and desktop shell to come up, then asks the launched app to run the bundled
sample workflow through:

- session creation
- turn start
- relay packet generation
- response validation
- preview
- approval
- save-copy execution

It uses an isolated test app-data directory, writes a workflow summary JSON,
confirms the reviewed copy matches the expected bundled sample output, and
checks that the original sample CSV stays unchanged.

The matching verification checklist lives in
[`docs/APP_WORKFLOW_TEST_VERIFICATION.md`](docs/APP_WORKFLOW_TEST_VERIFICATION.md).

## Guided Workflow Behavior

- On startup, the app opens to the same one-page guided workflow used for the
  full session.
- Step 1 shows the bundled `examples/revenue-workflow-demo.csv` shortcut when
  that sample path is discoverable in the current build.
- Step 1 runs a workbook preflight before creating the session and then reads
  workbook structure so the next Copilot handoff can reference real sheet and
  column names.
- After preparation succeeds, Step 1 collapses to a compact summary with an
  `編集する` button, while Steps 2 and 3 stay visible below it.
- If local storage cannot be opened at startup, the page shows a plain-language
  startup issue card instead of failing silently.

## Draft Resume Behavior

- The app keeps a local resumable draft per session, including the turn title,
  turn objective, workbook path, pasted response text, relay packet text, and
  the last preview summary snapshot.
- In the recent-session list, unfinished drafts are marked with
  `下書きを再開`.
- Clicking that recent session restores the Step 1 inputs and, when a draft is
  present, restores the Step 2 Copilot text plus the last preview summary.
- Preview and approval runtime state are still not executable after restart, so
  request preview again before approval or execution.

## Error Handling

- Validation, preview, and save problems are shown inline inside the current
  step instead of only surfacing raw backend wording.
- Validation failures provide a copyable retry prompt whose wording changes by
  error level: JSON syntax, schema shape, or unsupported tool name.

## Demo Asset

Use the sample CSV at [examples/revenue-workflow-demo.csv](examples/revenue-workflow-demo.csv).

It was chosen to exercise the implemented workflow:

- `amount` includes one non-numeric value so cast or aggregation warnings can be demonstrated.
- `approved` and `posted_on` support filter and inspect scenarios.
- `comment` includes `=`, `+`, and `@` prefixes so save-copy sanitization can be observed on execution output.

For the guided page, prefer an absolute workbook path:

```bash
pwd
```

Then use:

```text
<repo-root>/examples/revenue-workflow-demo.csv
```

## Demo Flow

1. Start the app with `pnpm --filter @relay-agent/desktop tauri:dev`.
2. In `1. はじめる`, set the file path to `<repo-root>/examples/revenue-workflow-demo.csv`
   or use the bundled sample shortcut when it is shown.
3. Choose or enter an objective such as:
   `approved が true の行だけ残して、結果を説明し、別コピーとして保存する`
4. Confirm the task name auto-fills, then click `準備する`.
5. In `2. Copilot に聞く`, click `依頼をコピー`.
6. Paste a valid JSON response into the response box, then click `確認する`.
7. In `3. 確認して保存`, review the pinned summary strip plus any detailed changes.
8. Click `保存する`.
9. Confirm the output file exists at the configured `outputPath`.
10. Confirm the original file under `examples/` is unchanged.

The current guided workflow verification checklist is tracked in
[`docs/GUIDED_FLOW_VERIFICATION.md`](docs/GUIDED_FLOW_VERIFICATION.md).

With the response example below, the output copy should contain only rows where
`approved == true`, add a derived `review_label` column, and prefix any
dangerous `comment` values before writing the new CSV. On the bundled sample
CSV, that produces 3 output rows and sanitizes 3 `comment` cells.

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

Replace `outputPath` with a writable absolute path for your operating system,
then paste strict JSON only into the Step 2 response box:

```json
{
  "version": "1.0",
  "summary": "Keep approved rows, add a review label, and write a sanitized CSV copy.",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": {
        "predicate": "[approved] == true"
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
        "outputPath": "/absolute/path/to/revenue-workflow-demo.copy.csv"
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
- The product workflow does not implement shell access, arbitrary code execution, VBA execution, or external network execution.

## Repository Layout

- `apps/desktop`: SvelteKit + Tauri desktop shell
- `packages/contracts`: shared Zod contracts and TypeScript types
- `examples`: demo input files
- `docs/IMPLEMENTATION.md`: running implementation log and verification history
- `PLANS.md`: MVP milestone plan
