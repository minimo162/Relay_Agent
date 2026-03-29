# Relay Agent

Relay Agent is a desktop MVP for turning a validated JSON action plan into a safe workbook preview, explicit approval step, and save-copy-only output. The current vertical slice is CSV-first: you can inspect workbook state, preview supported table transforms, approve a write-capable plan, and execute it to a new file without mutating the original input.

## Current MVP Scope

- Home can create and reopen persisted sessions from local JSON storage.
- Studio can start turns, generate relay packets, validate pasted Copilot JSON, request execution preview, record approval, and run save-copy execution.
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

Repo checks:

```bash
pnpm check
pnpm typecheck
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

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
2. On Home, create a session with:
   Title: `Revenue workflow demo`
   Objective: `Inspect the sample CSV, preview a safe transform, and write a sanitized copy.`
   Primary workbook path: `<repo-root>/examples/revenue-workflow-demo.csv`
3. Open that session in Studio.
4. Start a turn, for example:
   Title: `Approved revenue cleanup`
   Objective: `Keep approved rows, add a review label, preview the diff, approve it, and save a copy.`
   Relay mode: `plan`
5. Click `Generate packet`.
6. Paste the valid response example below and click `Validate response`.
7. Click `Request preview` and review the diff summary, output path, and warnings in the right pane.
8. Add an optional approval note, click `Approve preview`, then click `Request execution`.
9. Confirm the output file exists at the configured `outputPath`.
10. Confirm the original file under `examples/` is unchanged.

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
- Runtime preview, approval, and validation caches are not resumable after restart even though sessions, turns, artifacts, and logs persist to disk.
- The Studio UI does not yet expose dedicated workbook-profile, sheet-preview, or column-profile artifact panels.
- The product workflow does not implement shell access, arbitrary code execution, VBA execution, or external network execution.

## Repository Layout

- `apps/desktop`: SvelteKit + Tauri desktop shell
- `packages/contracts`: shared Zod contracts and TypeScript types
- `examples`: demo input files
- `docs/IMPLEMENTATION.md`: running implementation log and verification history
- `PLANS.md`: MVP milestone plan
