# Relay_Agent Repository Rules

## Repository State

- This repository contains a working Tauri v2 + SolidJS desktop agent application under `apps/desktop/`.
- Desktop **visual design** is driven by CSS variables in `apps/desktop/src/index.css` (`--ra-*`), aligned with **`apps/desktop/DESIGN.md`** (Cursor Inspiration spec). Light theme uses the warm-token palette now documented in `docs/IMPLEMENTATION.md` (2026-04-14 milestone); dark is the paired warm-charcoal scale. Default theme is **light**. Prefer tokens and `.ra-*` utilities over ad hoc colors.
- Rust backend lives in `apps/desktop/src-tauri/` with internal crates under `crates/{api,desktop-core,runtime,tools,commands,compat-harness}`.
- Desktop **`read_file`** on `.pdf` uses **LiteParse** (`liteparse-runner/`, OCR off) via **Node**; release bundles include a **Tauri `externalBin`** sidecar (`relay-node`). See `README.md`, `PLANS.md` (PDF reading), and `docs/IMPLEMENTATION.md` (2026-04-08 milestone).
- The legacy shared TypeScript contracts package has been removed; contracts are now defined inline within the Rust crates.
- Use `PLANS.md` for the milestone roadmap and `docs/IMPLEMENTATION.md` for implementation notes.

## Source of Truth

- Planning order for this MVP:
  1. `PLANS.md`
  2. `AGENTS.md`
  3. `docs/IMPLEMENTATION.md`
  4. `docs/CLAW_CODE_ALIGNMENT.md` (claw-code reference pin, parity checklist, tool-catalog notes — optional for features unrelated to that alignment)
- The Rust crate types and IPC command signatures in `src-tauri/` are the source of truth for contracts.
- The frontend types in `src/lib/ipc.ts` must stay in sync with the Rust IPC layer.
- `runtime::CompactionConfig::default()` is the canonical source for compaction defaults.

## Execution Rules

- Work milestone by milestone.
- Do not widen scope without updating `PLANS.md` and documenting the reason in `docs/IMPLEMENTATION.md`.
- Prefer the smallest change that advances the MVP vertical slice.
- Preserve established structure once it exists; avoid churny renames and directory reshuffles.
- Leave a concrete artifact or a verification log entry for every completed planning or implementation task.

## Verification Discipline

- Run the milestone verification commands at the end of each milestone.
- Use root `pnpm check` as the canonical frontend acceptance gate; `pnpm typecheck` is the fast local-only check.
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
- `docs/AGENT_EVALUATION_CRITERIA.md` holds manual/regression criteria for model grounding and Relay tool protocol (independent of a specific user task).
- `README.md` should reflect the current implemented behavior and setup instructions.
- Archived planning docs (`docs/archive/`) contain historical CODEX/Codex prompt files from early development; runtime prompt behavior is defined in the Rust source, not those archived artifacts.

## Task Master Usage

- Keep `.taskmaster/tasks/tasks.json` aligned with real artifact state.
- When a task is completed, confirm the related file or verification result exists first.
- If a task was advanced without a real output, reopen it, create the missing artifact, and only then close it.
