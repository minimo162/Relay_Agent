# Relay_Agent Repository Rules

## Repository State

- Relay_Agent is migrating through a hard cutover to a browser-hosted local web
  workbench served by a self-contained .NET sidecar.
- The active user-facing UI lives under `apps/workbench/`.
- The active local host/sidecar lives under `apps/sidecar/`.
- The previous Tauri v2 + SolidJS desktop application under `apps/desktop/`,
  AionUi overlay code under `integrations/aionui/`, and OpenCode/OpenWork
  scripts are historical implementation inputs only. They are not active
  product architecture, release targets, or fallback paths.
- M365 Copilot via Edge CDP remains the primary LLM controller. Relay owns
  local tool validation, execution, approvals, backups, diffs, logs, and app
  storage.
- The generic active tool direction is `rg_files`, `rg_search`, `read`,
  `officecli`, `edit`, `write`, `ask_user`, and `final`.

## Source of Truth

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `README.md`

`PLANS.md` is the current milestone roadmap. `docs/IMPLEMENTATION.md` records
decisions, verification runs, and known limitations.

## Execution Rules

- Work milestone by milestone.
- Do not reintroduce AionUi, OpenCode/OpenWork, Codex app-server, or Tauri as
  active runtime or release fallback paths.
- Prefer the smallest change that advances the hard-cutover architecture.
- Preserve user-local storage boundaries. Shared folders and searched folders
  must not receive Relay caches, indexes, or temp artifacts.
- Any mutation to Office or code must go through Relay validation and explicit
  user approval.
- Do not add unrestricted shell execution to the default tool catalog.

## Verification Discipline

- Use root `pnpm check` as the canonical acceptance gate for the active
  hard-cutover path.
- `pnpm check` must cover:
  - hard-cut guard;
  - Workbench typecheck/build;
  - sidecar build.
- Record verification commands and outcomes in `docs/IMPLEMENTATION.md`.
- Do not mark a task complete if its acceptance artifact does not exist.

## Documentation Discipline

- `README.md` must reflect the active browser Workbench + .NET sidecar product,
  not the old Tauri desktop product.
- Historical docs may mention AionUi/OpenCode/OpenWork/Tauri only as archived
  context. Active setup, development, CI, and release instructions must use the
  sidecar workbench path.
