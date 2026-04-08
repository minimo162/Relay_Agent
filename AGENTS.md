# Relay_Agent Repository Rules

## Repository State

- This repository contains a working Tauri v2 + SolidJS desktop agent application under `apps/desktop/`.
- Rust backend lives in `apps/desktop/src-tauri/` with internal crates under `crates/{api,runtime,tools,commands,compat-harness}`.
- Desktop **`read_file`** on `.pdf` uses **LiteParse** (`liteparse-runner/`, OCR off) via **Node**; release bundles include a **Tauri `externalBin`** sidecar (`relay-node`). See `README.md`, `PLANS.md` (PDF reading), and `docs/IMPLEMENTATION.md` (2026-04-08 milestone).
- The legacy `packages/contracts` directory has been removed; contracts are now defined inline within the Rust crates.
- Use `PLANS.md` for the milestone roadmap and `docs/IMPLEMENTATION.md` for implementation notes.

## Source of Truth

- Planning order for this MVP:
  1. `PLANS.md`
  2. `AGENTS.md`
  3. `docs/IMPLEMENTATION.md`
- The Rust crate types and IPC command signatures in `src-tauri/` are the source of truth for contracts.
- The frontend types in `src/lib/ipc.ts` must stay in sync with the Rust IPC layer.

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

- Priority A: make the agent loop work end to end with Copilot Proxy API and M365 Copilot via CDP.
- Priority B: harden MCP server integration, tool approval, and session management.
- Priority C: expand CDP browser automation and context-aware execution.
- Do not implement arbitrary code execution, shell access, VBA, or external network execution outside agent-controlled tools.
- Bash tool runs in a sandboxed context with approval gating for risky operations.

## Documentation Discipline

- `PLANS.md` holds the implementation plan.
- `docs/IMPLEMENTATION.md` holds progress notes, decisions, verification runs, and known limitations.
- `README.md` should reflect the current implemented behavior and setup instructions.
- Archived planning docs (`docs/archive/`) contain historical CODEX_PROMPT files from early development.

## Task Master Usage

- Keep `.taskmaster/tasks/tasks.json` aligned with real artifact state.
- When a task is completed, confirm the related file or verification result exists first.
- If a task was advanced without a real output, reopen it, create the missing artifact, and only then close it.
