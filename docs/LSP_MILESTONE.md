# LSP milestone (Priority C) — design and minimal probe

This document implements the planning gate from `PLANS.md` (deferred LSP milestone) and records subprocess/security rules before full Language Server Protocol integration.

## Goals (full milestone, not all implemented yet)

- Feed **definitions / references / diagnostics** (pick one first, likely **diagnostics** or **hover**) into Copilot context as **text**, not raw LSP JSON in the composer.
- Support **Rust** and **TypeScript** first, opt-in per workspace.

## Security and process model

1. **Spawn boundary:** LSP servers run as **child processes** of the Relay desktop app, started only when a workspace session requests them (no global always-on fleet).
2. **Roots:** `initialize` `rootUri` / `rootPath` must be **the session `cwd`** or a **single subdirectory** chosen by the user; reject `..` and paths outside the workspace (same policy as file tools).
3. **Binary resolution:** Prefer explicit config (e.g. merged `.claw` or future `relay.json` key `lsp.servers.rust-analyzer.command`) with safe fallbacks (`rust-analyzer` on `PATH`). Never execute arbitrary shell strings—**argv array only**.
4. **Timeouts:** Requests (e.g. `textDocument/documentSymbol`) get a hard timeout; on timeout, return a structured “LSP timeout” string to the model and log at `WARN`.
5. **Data to Copilot:** Only **serialized snippets** (e.g. formatted diagnostics list, trimmed hover text) go into CDP prompts; cap bytes similarly to `read_file` discipline.
6. **Shutdown:** On session end or workspace change, send `shutdown`/`exit` and `wait` with timeout; kill if hung.

## Minimal implementation shipped in-tree

- **IPC command** `probe_rust_analyzer` (see `tauri_bridge.rs`): runs `rust-analyzer --version` with `current_dir` set to the requested workspace path to verify PATH and subprocess spawn. **Not** a full LSP session.

## Next implementation steps

1. Add a small **LSP JSON-RPC multiplexer** (stdio) in a new Rust module with unit tests against a fake server.
2. Wire **one** capability (e.g. `textDocument/publishDiagnostics` pull via `textDocument/diagnostic` where supported, or sync after `didOpen`).
3. Expose a tool e.g. `lsp_diagnostics` (ReadOnly) that returns capped text for the Copilot catalog.

## Verification

- After changes: `cargo test -p relay-agent-desktop`, `cargo test -p runtime`, and `pnpm --filter @relay-agent/desktop typecheck`.
- Manual: Settings → Copy diagnostics may later include `rust-analyzer` probe output when that UX is added.
