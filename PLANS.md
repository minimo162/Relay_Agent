# Relay_Agent Implementation Plan

Date: 2026-03-28

## Planning Baseline

This repository is currently a Task Master planning shell, not an existing application codebase. The audit at `.taskmaster/docs/repo_audit.md` confirmed that the PRD's expected implementation directories do not exist yet.

Practical implication:

- `apps/desktop`, `packages/contracts`, and the Rust/Tauri backend need to be created from scratch.
- `.taskmaster/` should remain the existing planning layer.
- "Preserve existing structure" in the PRD should be interpreted as "do not introduce unnecessary reshaping once the new structure is created," not as "there is already an app scaffold to keep."

## Delivery Principles

- Priority A: get a safe vertical slice working end to end first.
- Priority B: harden validation, diff preview, and file IO after the slice works.
- Priority C: extend workbook handling only if the MVP path is stable.
- Save-copy only is the default write model.
- Original spreadsheet inputs are treated as read-only.
- No arbitrary code execution, shell execution, VBA, or external network access in the product flow.
- Planning and implementation artifacts must be left in files, not only in task status changes.

## Draft Completion Conditions

The MVP should not be treated as complete until all of the following are true:

- `pnpm install` resolves the workspace successfully.
- `pnpm check` passes.
- `pnpm typecheck` passes.
- `pnpm --filter @relay-agent/desktop build` passes.
- `cargo check` passes.
- The UI supports session creation, turn start, relay packet generation, pasted Copilot response validation, and execution preview in one usable flow.
- A diff preview and approval path exist before any write action.
- A minimal CSV end-to-end demo works.
- `README.md` documents startup steps, demo usage, and limitations.

## Milestone 0: Planning Artifacts

### Goal

Create the planning and repository operating artifacts needed before code implementation begins.

### Change Targets

- `PLANS.md`
- `AGENTS.md`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/docs/repo_audit.md`

### Acceptance Criteria

- The repository audit exists and reflects the actual starting state.
- `PLANS.md` defines milestones, acceptance criteria, verification commands, scope exclusions, and risks.
- `AGENTS.md` defines repository-specific execution rules.
- `docs/IMPLEMENTATION.md` exists as the running implementation log.

### Verification Commands

```bash
test -f .taskmaster/docs/repo_audit.md
test -f PLANS.md
test -f AGENTS.md
test -f docs/IMPLEMENTATION.md
```

### Out of Scope

- Any product code.
- Any build-system or package-manager setup.

### Risks and Mitigations

- Risk: planning assumes code already exists.
  Mitigation: use `.taskmaster/docs/repo_audit.md` as the baseline source of truth.
- Risk: future tasks are marked complete without artifacts.
  Mitigation: each planning task must produce a file or a logged verification result.

## Milestone 1: Monorepo and Build Foundation

### Goal

Create a working workspace foundation that can host the desktop app, shared contracts, and Rust/Tauri backend.

### Change Targets

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig*.json`
- `apps/desktop/**`
- `packages/contracts/**`
- Rust/Tauri root files such as `Cargo.toml`, `src-tauri/**`, or equivalent structure chosen for the app

### Acceptance Criteria

- The workspace installs successfully.
- The desktop app structure exists as SvelteKit SPA + Tauri v2.
- The contracts package can be imported by TypeScript consumers.
- Basic JS/TS and Rust checks run without structural failures.

### Verification Commands

```bash
pnpm install
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

### Out of Scope

- Full UI behavior.
- Workbook transformations.
- End-to-end relay execution.

### Risks and Mitigations

- Risk: greenfield workspace setup drifts into unnecessary architecture work.
  Mitigation: create only the directories and config needed to support the MVP milestones.
- Risk: Tauri and SvelteKit integration fails due to incompatible defaults.
  Mitigation: validate the desktop build immediately after structure creation instead of deferring integration checks.

## Milestone 2: Session, Turn, and Relay Vertical Slice

### Goal

Make the application capable of creating sessions, starting turns, generating relay packets, accepting pasted Copilot output, and validating it through a typed UI-to-backend flow.

### Change Targets

- `packages/contracts/**`
- desktop UI routes, stores, and typed IPC wrapper
- Rust/Tauri commands for app initialization, session lifecycle, relay packet generation, and response submission
- local storage modules for sessions and turns

### Acceptance Criteria

- Shared schemas exist for the core entities defined in the PRD.
- The frontend can create and list sessions.
- A turn can be started from the UI.
- A relay packet can be generated and displayed.
- A pasted Copilot response can be parsed and validated with structured error output.
- Session data persists locally and survives restart.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Launch the desktop app.
2. Create a session.
3. Start a turn.
4. Generate a relay packet.
5. Paste a valid or invalid response sample.
6. Confirm validation results are shown.

### Out of Scope

- Actual workbook mutations.
- Save-copy execution.
- Rich xlsx support.

### Risks and Mitigations

- Risk: contract drift between frontend and backend payloads.
  Mitigation: keep the contracts package as the only schema/type source of truth.
- Risk: session persistence is added late and breaks flow state.
  Mitigation: build local storage during this milestone, not after UI wiring is finished.

## Milestone 3: CSV Inspect and Preview Slice

### Goal

Add workbook inspection and transformation preview capability with CSV as the primary supported format.

### Change Targets

- workbook/CSV engine modules
- read-only workbook tools
- transformation preview logic
- Studio right-pane workbook summary and diff preview UI

### Acceptance Criteria

- CSV inspection works end to end.
- The app can preview sheet structure and column profiles.
- The supported MVP transformations can produce a preview summary.
- `preview_execution` returns target sheet or table context, changed columns, estimated affected rows, and output destination.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Open a CSV example file.
2. Run inspect and preview-related actions.
3. Confirm workbook summary and diff preview render in the UI.

### Out of Scope

- High-fidelity xlsx round-tripping.
- Advanced workbook semantics beyond inspect and save-copy preparation.
- Non-tabular spreadsheet automation.

### Risks and Mitigations

- Risk: xlsx support overwhelms the MVP.
  Mitigation: prioritize CSV and keep xlsx limited to inspect and save-copy-friendly paths.
- Risk: preview data is too vague to support approval.
  Mitigation: standardize the diff summary payload before adding execution.

## Milestone 4: Approval and Save-Copy Execution

### Goal

Execute validated actions safely through preview, approval, and save-copy only output.

### Change Targets

- backend preview and execution modules
- approval flow state and UI
- CSV sanitization logic
- output artifact handling

### Acceptance Criteria

- No write happens before preview and approval.
- Execution writes only to a copy.
- Original files remain unchanged.
- CSV injection safeguards are applied on output.
- Unsafe capabilities from the PRD remain unimplemented and blocked.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Run the CSV flow through preview.
2. Approve execution.
3. Confirm output is written to a new file.
4. Confirm the original file is unchanged.
5. Confirm dangerous CSV-leading characters are sanitized in output.

### Out of Scope

- In-place edits to the original workbook.
- Formula-authoring from model output.
- Any shell, VBA, or network-enabled execution path.

### Risks and Mitigations

- Risk: execution bypasses preview details users need.
  Mitigation: make `preview_execution` a required prerequisite and surface it clearly in the UI.
- Risk: unsafe spreadsheet content is written back out.
  Mitigation: sanitize CSV output and reject unsupported unsafe action types.

## Milestone 5: Documentation, Examples, and Polish

### Goal

Leave the MVP in a demonstrable and understandable state with examples, clear documentation, and explicit limitations.

### Change Targets

- `README.md`
- `examples/**`
- `docs/IMPLEMENTATION.md`
- any final UI or copy cleanup directly tied to the documented demo path

### Acceptance Criteria

- `README.md` includes setup instructions, relay packet example, valid response example, demo flow, and limitations.
- `examples/` includes at least one CSV file for the demo path.
- `docs/IMPLEMENTATION.md` summarizes implementation decisions, verification results, and remaining gaps.
- Known limitations are explicit and accurate.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Follow the README from a clean checkout.
2. Run the documented demo flow.
3. Compare actual behavior against known limitations.

### Out of Scope

- Additional features beyond the MVP relay flow.
- Broad workbook feature expansion not required by the demo path.

### Risks and Mitigations

- Risk: documentation drifts from the implementation.
  Mitigation: update `docs/IMPLEMENTATION.md` at each milestone and validate the README against the example flow.
- Risk: examples do not reflect real supported behavior.
  Mitigation: generate example content from the actual supported CSV path, not hypothetical future capabilities.

## Follow-up Scope Note

Post-MVP usability work aimed at non-engineer operators is captured in `.taskmaster/docs/prd_non_engineer_ux.txt`.
The corresponding Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as follow-up tasks `11` through `16`.
That follow-up set is now implementation-complete, with the shipped verification checklist recorded in `docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md`.
The first packaged end-user release path is now fixed by `docs/PACKAGING_POLICY.md` to Windows 10/11 x64 via an NSIS installer, with manual installer-driven updates until signed updater infrastructure exists.
The current verified source-run startup walkthrough remains in `README.md`; packaged installer behavior stays documented in `docs/PACKAGING_POLICY.md` until installer builds are real and testable.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_workbook_artifact_browser.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `17` through `20`, and that follow-up is now implementation-complete with verification recorded in `docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_turn_lifecycle_details.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `21` through `26`, and that follow-up is now implementation-complete with verification recorded in `docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_startup_test_harness.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `27` through `31`, and that follow-up is now implementation-complete with verification recorded in `docs/STARTUP_TEST_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_app_launch_execution_test.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `32` through `36`, and that follow-up is now implementation-complete with verification recorded in `docs/APP_LAUNCH_TEST_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_app_workflow_launch_test.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `37` through `41`, and that follow-up is now implementation-complete with verification recorded in `docs/APP_WORKFLOW_TEST_VERIFICATION.md`.

That follow-up preserved the current safety model:

- preview before write
- approval before write
- save-copy only
- original workbook read-only

The primary follow-up emphasis should be simplifying app startup for non-engineers, including distribution, installer/update, recovery, diagnostics, data-handling clarity, permission explanations, file preflight, locale and CSV compatibility, early constraint surfacing, resumable work, crash recovery, recent-item access, progress visibility, template-driven starts, output-name safety, duplicate-run prevention, safe defaults, reviewer-friendly summaries, read-only review, inline help, pre-copy sensitivity warnings, local audit history, accessibility baselines, and a clearer completion flow, while also collapsing the user-facing preview, approval, and save-copy stages into a clearer execution flow without relaxing those guardrails.

## Global Scope Exclusions

These items remain outside the MVP unless explicitly pulled in later:

- Generic multi-domain agent support beyond Excel/CSV.
- Arbitrary local code execution or shell tools inside the product workflow.
- VBA/macros.
- External network access during workbook execution.
- Raw Excel formula generation from model output.
- Full workbook fidelity guarantees for xlsx.
- Large-scale data engineering features beyond the listed MVP transformations.

## Recommended Execution Order

1. Finish Milestone 0 planning artifacts.
2. Complete Milestone 1 until the workspace and desktop build are stable.
3. Deliver Milestone 2 as the first user-visible vertical slice.
4. Add Milestone 3 preview capability on top of the validated relay flow.
5. Add Milestone 4 execution only after preview and approval are trustworthy.
6. Finish with Milestone 5 documentation and demo hardening.
