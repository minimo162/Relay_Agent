# Relay_Agent Repository Rules

## Repository State

- This repository contains a working Tauri v2 + SolidJS desktop agent application under `apps/desktop/`.
- Rust backend lives in `apps/desktop/src-tauri/` with internal crates under `crates/{api,runtime,tools,commands,compat-harness}`.
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

## Cursor Cloud specific instructions

### Services overview

This is a Tauri v2 desktop app (Rust backend + SolidJS frontend). There is one service to run — the Tauri dev server — which bundles both Vite (frontend) and the Rust backend.

### Running the app in dev mode

- `pnpm dev` in the repo root starts the Vite dev server (frontend only) on `http://localhost:1421`.
- `pnpm tauri:dev` in `apps/desktop/` starts the full Tauri app (Rust backend + webview frontend).
- On headless Linux (Cloud Agent VMs), run with a virtual display and software rendering:
  ```
  LIBGL_ALWAYS_SOFTWARE=1 xvfb-run --server-args="-screen 0 1280x1024x24" pnpm tauri:dev
  ```

### Linting and testing

| Check | Command | Notes |
|-------|---------|-------|
| TypeScript typecheck | `pnpm typecheck` | Runs from repo root |
| Rust check | `cargo check` | From repo root |
| Rust clippy | `cargo clippy` | New pedantic lints may appear with Rust updates; `cargo clippy` (without `-D warnings`) shows warnings without failing |
| Rust tests | `cargo test --package commands && cargo test --package runtime && cargo test --package relay-agent-desktop && cargo test --package onyx-concept` | The `tools` crate has Rust-version-sensitive test compilation; test the other crates individually |
| Frontend E2E | `cd apps/desktop && npx playwright test` | Builds with `RELAY_E2E=1`; ~54 mock-based tests pass; ~10 CDP/M365-dependent tests fail without Edge |
| Vite frontend only | `cd apps/desktop && pnpm dev` | Serves on port 1421 |

### System dependencies (Linux)

Required for building: `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libxdo-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`. These are pre-installed in the Cloud Agent environment.

### Known caveats

- The `tools` crate has Rust-edition-sensitive code (type inference changes in newer Rust editions). `cargo test` for the full workspace may fail on the `tools` crate; test other crates individually.
- M365 Copilot / CDP tests require Microsoft Edge and an M365 Copilot subscription — these will always fail in headless Cloud Agent environments.
- Tauri requires a display server; use `xvfb-run` with `LIBGL_ALWAYS_SOFTWARE=1` on headless VMs.
- The Rust toolchain must be updated to stable (1.85+); the default VM may ship an older version. Run `rustup update stable && rustup default stable` if `cargo check` fails with `edition2024` errors.
