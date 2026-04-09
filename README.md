# Relay Agent

Desktop agent app: **Tauri v2**, **SolidJS**, **Rust**. You send a goal; the agent runs with **M365 Copilot** driven over **CDP** (Edge). Tool runs can require approval. The main window is **always on top**.

## Quick start

**Needs:** Rust 1.80+, Node 22+ (see root `package.json` engines), **pnpm**.

```bash
git clone https://github.com/minimo162/Relay_Agent.git
cd Relay_Agent
pnpm install
```

- **Full desktop (Tauri + Rust):** `pnpm --filter @relay-agent/desktop tauri:dev` (Unix prestarts Edge/Copilot helper; see package script).
- **Frontend only (Vite):** `pnpm dev` (same as `vite` in `apps/desktop`; no native shell).

Copilot needs Edge signed in to M365. CDP defaults and pitfalls: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md) (port **9360**).

## Stack

| Layer | Technology |
|-------|------------|
| UI | SolidJS, Vite, TypeScript, Tailwind — design tokens follow **Cursor-inspired** palette from vendored [`apps/desktop/DESIGN.md`](apps/desktop/DESIGN.md) ([getdesign](https://getdesign.md) `cursor` pack; see `docs/IMPLEMENTATION.md` milestone log) |
| Shell | Tauri v2, `tauri-plugin-shell`, `tauri-plugin-dialog` |
| Agent / tools | Rust (`apps/desktop/src-tauri/`, internal crates) |
| AI surface | M365 Copilot in Edge via **Node** `copilot_server.js` + CDP |

## What the app does

- **Sessions** — Sidebar, history, streaming assistant text, tool activity (optional inline).
- **Approvals** — **Allow once**, **Allow for session**, or **Don’t allow** for gated tools.
- **Workspace** — Header chip + status line for **cwd**; **Settings** (path, **Browse…** folder picker on desktop, `maxTurns`, stored browser hints); **Copy diagnostics**.
- **Context panel** — Files, MCP servers, **Plan** (latest `TodoWrite`), policy hints.
- **Composer** — **Enter** inserts a newline; **Ctrl+Enter** (**⌘+Enter** on macOS) or the **Send** button submits. **Templates** (saved prompts), slash commands (`/help`, `/compact`, …), session mode **Build** / **Plan** / **Explore** (Explore = `read_file` / `glob_search` / `grep_search` only in the Copilot tool list).
- **Undo / Redo** — Header actions reverse the last successful workspace writes from the active session (`write_file`, `edit_file`, `NotebookEdit`, PDF tools), when the agent is idle.
- **Extras** — PDF via LiteParse + bundled Node; Windows Office hybrid read (COM + PDF); MCP over stdio.

Details, limits, and milestone notes: **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)**. Roadmap and guardrails: **[PLANS.md](PLANS.md)**. Repo rules: **[AGENTS.md](AGENTS.md)**. Claw-code selective alignment (upstream pin, parity checklist, tool diff notes): **[docs/CLAW_CODE_ALIGNMENT.md](docs/CLAW_CODE_ALIGNMENT.md)**.

## Architecture (high level)

```
SolidJS (apps/desktop/src)  ←→  Tauri IPC  ←→  Rust (agent_loop, tools, CDP bridge)
                                                      ↓
                                    Edge + M365 Copilot (CDP)
```

Rust entry: `apps/desktop/src-tauri/src/lib.rs`. IPC types: Rust `models.rs` ↔ `apps/desktop/src/lib/ipc.ts`.

## Repository layout

```
Relay_Agent/
├── PLANS.md, AGENTS.md, docs/IMPLEMENTATION.md, docs/CLAW_CODE_ALIGNMENT.md   # planning & log
├── scripts/                     # Linux Edge / CDP helpers
├── apps/desktop/
│   ├── src/                     # SolidJS app (root.tsx, components/, lib/)
│   ├── DESIGN.md                # Cursor-inspired design system (getdesign `cursor`) for UI tokens
│   ├── public/                  # Static assets (e.g. favicon.svg for Vite)
│   ├── src-tauri/               # Tauri + Rust workspace crates
│   ├── scripts/                 # fetch-bundled-node, inspect-copilot-dom, …
│   └── tests/                   # Playwright + Tauri mocks (RELAY_E2E=1 build)
└── Cargo.toml, package.json, pnpm-workspace.yaml
```

**App icons:** Vector source is `apps/desktop/src-tauri/icons/source/relay-agent.svg`. From `apps/desktop/`, run `pnpm exec tauri icon src-tauri/icons/source/relay-agent.svg -o src-tauri/icons` to refresh `icon.ico`, `icon.icns`, and PNGs referenced in `tauri.conf.json`. Details: `docs/IMPLEMENTATION.md` (Milestone Log, 2026-04-09 Relay Agent app icon and favicon).

## IPC (commands you invoke)

| Command | Purpose |
|---------|---------|
| `start_agent` | New session (`goal`, optional `cwd`, `files`, `maxTurns`, `browserSettings`, `sessionPreset`: `build` \| `plan` \| `explore`) |
| `respond_approval` | Approve/deny; optional `rememberForSession` |
| `cancel_agent`, `get_session_history`, `compact_agent_session` | Session control |
| `undo_session_write`, `redo_session_write`, `get_session_write_undo_status` | Per-session file-write undo stack |
| `probe_rust_analyzer` | LSP milestone probe: `rust-analyzer --version` in a folder (`docs/LSP_MILESTONE.md`) |
| `warmup_copilot_bridge`, `get_relay_diagnostics` | Copilot readiness / support bundle |
| `connect_cdp`, `cdp_*`, `disconnect_cdp` | Direct CDP helpers |
| `mcp_*` | MCP server registry |

**Events:** `agent:text_delta`, `agent:tool_start`, `agent:tool_result`, `agent:approval_needed`, `agent:turn_complete`, `agent:error`. Shapes live in `apps/desktop/src/lib/ipc.ts`.

## Configuration

**Rust defaults** (`apps/desktop/src-tauri/src/config.rs`): e.g. `max_turns` (16), concurrency (4), session TTL (30 min). Full table in source.

**Claw-style paths** (instructions + settings): `.claw`, `CLAW.md`, optional `~/.relay-agent/SYSTEM_PROMPT.md` — see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) and runtime crate docs. When `.claw` sets permission mode to **read-only**, the **bash** tool rejects commands that look mutating (e.g. `rm`, `git commit`, shell redirects); use file tools where applicable.

**Diagnostics:** Settings → Copy diagnostics includes `get_relay_diagnostics` (ports, `processCwd`, Claw config home hint, `maxTextFileReadBytes`, `doctorHints`).

**Environment (Copilot):** Default CDP base **9360**; overrides `CDP_ENDPOINT`, `RELAY_EDGE_CDP_PORT`. Linux: Edge + `DISPLAY`; profile `~/RelayAgentEdgeProfile`. Optional: `RELAY_CDP_PROBE_TIMEOUT_MS` (slow Windows CDP), `RELAY_COPILOT_NO_WINDOW_FOCUS=1` (do not raise Edge via CDP), `RELAY_COPILOT_NUDGE_EDGE=1` (Win32 nudge, off by default). Stale **`copilot_server`** on **18080+** (orphan `node`, `EADDRINUSE`) is cleared automatically before spawn via `/health` + `bootToken` mismatch; set **`RELAY_COPILOT_RECLAIM_STALE_HTTP=0`** to disable. Details: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md).

## Development

```bash
pnpm typecheck
pnpm --filter @relay-agent/desktop build

cd apps/desktop/src-tauri && cargo check && cargo test -p relay-agent-desktop --lib
```

**E2E (mock Tauri, browser only):** from `apps/desktop`, `E2E_SKIP_AUTH_SETUP=1 pnpm exec playwright test app.e2e.spec.ts`.

**Inspect Copilot DOM (real CDP):** `pnpm --filter @relay-agent/desktop inspect:copilot-dom` (signed-in Edge on 9360).

**CI:** see `.github/workflows/` — typically `cargo check`, `clippy`, `pnpm typecheck`, bundled Node fetch for Tauri.

## License

[Apache License 2.0](LICENSE).

## Contributing

Pull requests welcome. Follow **AGENTS.md** and keep **PLANS.md** / **docs/IMPLEMENTATION.md** aligned with behavioral changes.
