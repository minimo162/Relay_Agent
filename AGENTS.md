# Relay_Agent Repository Rules

## Repository Reality

- This repository is currently greenfield apart from `.taskmaster/` planning assets.
- Do not assume existing `apps/desktop`, `packages/contracts`, or Rust/Tauri implementation directories already exist.
- Use `.taskmaster/docs/repo_audit.md` and `PLANS.md` as the baseline references before changing scope.

## Source of Truth

- Planning order for this MVP:
  1. `PLANS.md`
  2. `AGENTS.md`
  3. `docs/IMPLEMENTATION.md`
- Contracts should become the source of truth only after `packages/contracts` is created.
- Until then, the PRD and planning docs are the current source of truth.

## Execution Rules

- Work milestone by milestone.
- Do not widen scope without updating `PLANS.md` and documenting the reason in `docs/IMPLEMENTATION.md`.
- Prefer the smallest change that advances the MVP vertical slice.
- Preserve established structure once it exists; avoid churny renames and directory reshuffles.
- Leave a concrete artifact or a verification log entry for every completed planning or implementation task.

## Verification Discipline

- Run the milestone verification commands at the end of each milestone.
- If verification fails, fix the issue before moving to the next milestone.
- Record verification commands and outcomes in `docs/IMPLEMENTATION.md`.
- Do not mark a task complete if its acceptance artifact does not exist.

## MVP Guardrails

- Priority A: make the safe vertical slice work end to end.
- Priority B: harden validation, diff preview, and file IO.
- Priority C: extend workbook handling only after the MVP path is stable.
- Save-copy only is the default write behavior.
- Treat original workbook inputs as read-only.
- Do not implement arbitrary code execution, shell access, VBA, or external network execution in the product workflow.
- Do not accept raw Excel formulas directly from model output.

## Documentation Discipline

- `PLANS.md` holds the implementation plan.
- `docs/IMPLEMENTATION.md` holds progress notes, decisions, verification runs, and known limitations.
- `README.md` should be updated only when behavior or setup instructions become real and testable.

## Task Master Usage

- Keep `.taskmaster/tasks/tasks.json` aligned with real artifact state.
- When a task is completed, confirm the related file or verification result exists first.
- If a task was advanced without a real output, reopen it, create the missing artifact, and only then close it.
