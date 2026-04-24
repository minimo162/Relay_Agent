# Relay_Agent Repository Rules

## Repository State

- This repository contains a working Tauri v2 + SolidJS desktop agent application under `apps/desktop/`.
- Desktop **visual design** is driven by CSS variables in `apps/desktop/src/index.css` (`--ra-*`), aligned with **`apps/desktop/DESIGN.md`** (Cursor Inspiration spec). Light theme uses the warm-token palette now documented in `docs/IMPLEMENTATION.md` (2026-04-14 milestone); dark is the paired warm-charcoal scale. Default theme is **light**. Prefer tokens and `.ra-*` utilities over ad hoc colors.
- Rust backend lives in `apps/desktop/src-tauri/` with active internal crates under `crates/{desktop-core,compat-harness}`. The legacy Relay-owned `api`, `runtime`, `tools`, and `commands` crates are not active workspace members and must not be reintroduced.
- Desktop execution delegates tool behavior to the bundled/external OpenCode runtime. Relay-specific Rust code is limited to desktop UX, Tauri IPC, M365 Copilot CDP adaptation, diagnostics, prompt/tool-call projection, and release packaging glue.
- Desktop **`read`** on `.pdf`, `.docx`, `.xlsx`, and `.pptx` returns extracted plaintext through the OpenCode-shaped adapter path. Office/PDF discovery is model-facing `glob` followed by exact `read`; `office_search` is not a model-facing tool.
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
- OpenCode/OpenWork session state is the canonical source for execution transcript and compaction behavior. Relay-owned defaults live only in the desktop adapter/config modules.

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

- Priority A: keep M365 Copilot via Edge CDP as the primary LLM controller.
- Priority B: keep OpenCode/OpenWork as the execution substrate for tools, permissions, sessions, MCP, plugins, skills, and workspace runtime behavior.
- Priority C: keep Relay-specific code focused on desktop UX, Tauri IPC, Copilot CDP transport, prompt adaptation, and diagnostics.
- Do not reintroduce Relay-owned execution runtime crates or compatibility contracts for removed tool/session paths.
- Do not implement arbitrary code execution, unrestricted shell access, VBA, or uncontrolled external network execution outside agent-managed tools.

## Office / PDF Search Tool Guidance

- Use `glob` to discover Office/PDF candidate paths by filename or extension.
- Use exact `read` when the user names an Office/PDF file or when a candidate path must be inspected for evidence. `read` handles extracted plaintext for `.pdf`, `.docx`, `.xlsx`, and `.pptx`.
- Use `grep` only for plaintext/code content search. It must reject Office/PDF container targets and point the caller toward `glob` then exact `read`.
- Do not add `office_search` back to CDP catalogs, repair prompts, or model-facing tool guidance.

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
