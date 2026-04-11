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

Copilot needs Edge signed in to M365. CDP defaults and pitfalls: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md) (Relay / `pnpm relay:edge`: **9360**; Playwright CDP tests: default **9333** — override with `CDP_ENDPOINT`).

## Stack

| Layer | Technology |
|-------|------------|
| UI | SolidJS, Vite, TypeScript, Tailwind — **Cursor Inspiration** in [`apps/desktop/src/index.css`](apps/desktop/src/index.css) + [`apps/desktop/DESIGN.md`](apps/desktop/DESIGN.md): Surface scale, oklab borders (including **strong** borders at 55% opacity), cream primary buttons, **`.ra-type-*`** typography utilities, editorial **`cswh`** on serif markdown, mono scale for tools/code. Dark theme uses a paired warm-charcoal scale. **Default theme is light** (`data-theme` + `localStorage` `relay-agent/theme`). Proprietary Cursor fonts are not bundled (system fallbacks). Details: `docs/IMPLEMENTATION.md` (Milestone Log, **2026-04-10** OpenWork second pass + earlier Desktop UI milestones) |
| Shell | Tauri v2, `tauri-plugin-shell`, `tauri-plugin-dialog` |
| Agent / tools | Rust (`apps/desktop/src-tauri/`, internal crates) |
| AI surface | M365 Copilot in Edge via **Node** `copilot_server.js` + CDP; the desktop sends the Relay turn bundle **inline in the prompt body** for the paid-license path, compacting context before the effective **128000-token** ceiling when needed. The host parses tool calls from **` ```relay_tool `** JSON and, if none, from accepted fenced JSON; bounded unfenced tool-shaped object recovery is **retry/repair only**, not the normal protocol. Fallback parser candidates are being migrated to require **`"relay_tool_call": true`** per tool object (observe/warn phase first; enforce via `RELAY_FALLBACK_SENTINEL_POLICY=enforce`) ([`agent_loop.rs`](apps/desktop/src-tauri/src/agent_loop.rs)) |

## What the app does

- **Sessions** — Sidebar, history, streaming assistant text; tool steps always show **inline in chat**.
- **First run** — The initial screen centers a **workspace chooser** and the **first request** composer in the main pane; the right-side **Plan / MCP** panel stays hidden until the first session starts.
- **Approvals** — **Allow once**, **Allow for session**, or **Don’t allow** for gated tools.
- **Workspace** — Header chip (basename / “not set”) opens a small **Workspace** modal: path + **Browse…** + **Done** on desktop. `maxTurns` / browser CDP hints are **not** edited in-app (existing `localStorage` `relay.settings.browser` / `relay.settings.maxTurns` still apply when set). The footer offers **Reconnect Copilot** (uses the same stored browser hints as `start_agent` / `warmup_copilot_bridge`).
- **Context panel** — **Plan** (default): `TodoWrite` timeline + **Tool rules** disclosure; **MCP** servers and workspace instruction surfaces when `cwd` is set. The panel is suppressed on the zero-session first-run screen so the initial task flow stays focused.
- **Composer** — **Enter** inserts a newline; **Ctrl+Enter** (**⌘+Enter** on macOS) or **Send** submits. The inline **Work mode** control uses **Edit files** / **Read-only plan** / **Read and search** labels and shows the active preset summary beside the shortcut hint; slash commands (`/help`, `/compact`, …). Explore = `read_file` / `glob_search` / `grep_search` only in the Copilot tool list.
- **Undo / Redo** — Header actions reverse the last successful workspace writes from the active session (`write_file`, `edit_file`, `NotebookEdit`, PDF tools), when the agent is idle.
- **Extras** — PDF via LiteParse + bundled Node; Windows Office hybrid read (COM + PDF); MCP over stdio.

Details, limits, and milestone notes: **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)**. Roadmap and guardrails: **[PLANS.md](PLANS.md)**. Repo rules: **[AGENTS.md](AGENTS.md)**. Manual criteria for model grounding and tool protocol: **[docs/AGENT_EVALUATION_CRITERIA.md](docs/AGENT_EVALUATION_CRITERIA.md)**. Claw-code selective alignment (upstream pin, parity checklist, `compat-harness` fixture vs full CLI harness, **~47** cataloged tool names on Unix / **48** with Windows `PowerShell`, claw-shaped JSON aliases and plan-mode tool notices): **[docs/CLAW_CODE_ALIGNMENT.md](docs/CLAW_CODE_ALIGNMENT.md)**.

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
│   ├── DESIGN.md                # Cursor Inspiration spec; live tokens + .ra-type-* in src/index.css
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
| `warmup_copilot_bridge` (optional `browserSettings`), `get_relay_diagnostics` | Copilot readiness / support bundle |
| `connect_cdp`, `cdp_*`, `disconnect_cdp` | Direct CDP helpers |
| `mcp_*` | MCP server registry |

**Events:** `agent:text_delta`, `agent:tool_start`, `agent:tool_result`, `agent:approval_needed`, `agent:turn_complete`, `agent:error`. Shapes live in `apps/desktop/src/lib/ipc.ts`.

## Configuration

**Rust defaults** (`apps/desktop/src-tauri/src/config.rs`): e.g. `max_turns` (16), concurrency (4), session TTL (30 min). Full table in source.

**Claw-style paths** (instructions + settings): `.claw`, `CLAW.md`, optional additive `~/.relay-agent/SYSTEM_PROMPT.md` — see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) and runtime crate docs. The local prompt file appends custom guidance but does **not** replace Relay’s core system sections. When `.claw` sets permission mode to **read-only**, the **bash** tool rejects commands that look mutating (e.g. `rm`, `git commit`, shell redirects); use file tools where applicable.

**Diagnostics:** `get_relay_diagnostics` (and related IPC) remain in the backend for tooling; there is **no in-app diagnostics export** in the simplified UI (2026-04-10). Use devtools / future automation if you need a JSON bundle.

**Environment (Copilot):** Default CDP base **9360**. Effective CDP port for the Node bridge and agent: **`browserSettings.cdpPort`** from each `start_agent` / `warmup_copilot_bridge` request (typically from `localStorage` `relay.settings.browser`) **overrides** `RELAY_EDGE_CDP_PORT`, which overrides the default. Changing the port while **more than one** agent session is running returns an error (finish other sessions or restart the app). Integration tests and external tools may still use `CDP_ENDPOINT` (see Playwright configs). Linux: Edge + `DISPLAY`; profile `~/RelayAgentEdgeProfile`. Dedicated Edge is started **without** a trailing Copilot URL; the Node bridge navigates over CDP (`Page.navigate` / tab reuse) so a cold **`Target.createTarget`** race does not open **two** `m365.cloud.microsoft/chat` tabs. Optional: `RELAY_CDP_PROBE_TIMEOUT_MS` (slow Windows CDP), `RELAY_COPILOT_NO_WINDOW_FOCUS=1` (do not raise Edge via CDP), `RELAY_COPILOT_NUDGE_EDGE=1` (Win32 nudge, off by default), **`RELAY_FALLBACK_SENTINEL_POLICY=enforce`** (reject fallback parser candidates that omit `"relay_tool_call": true`; default is observe/warn for compatibility). **Startup tuning:** Windows skips **`--remote-debugging-port=0`** unless **`RELAY_COPILOT_TRY_PORT_ZERO=1`**; **`RELAY_EXISTING_CDP_WAIT_MS`** (default 10s Win / 30s else) waits for CDP after a probe miss; **`RELAY_EDGE_PORT0_CDP_WAIT_MS`** (2–120s, default 12s) limits CDP wait when port=0 is used; **`RELAY_COPILOT_RECLAIM_NETSTAT=1`** enables slow Windows `netstat` fallback during HTTP port reclaim (default off). Stale **`copilot_server`** on **18080+** is reclaimed via `/health` + `bootToken`; **`RELAY_COPILOT_RECLAIM_STALE_HTTP=0`** disables. **CDP prompts** tell Copilot that Relay parses and executes `relay_tool` / accepted fenced JSON from each reply, with bounded unfenced recovery reserved for retry/repair situations. Details: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md).

## Development

```bash
pnpm typecheck
pnpm --filter @relay-agent/desktop build

cd apps/desktop/src-tauri && cargo check && cargo test -p relay-agent-desktop --lib
```

**Grounding / CDP checks:** `pnpm run test:grounding-fixture`; `pnpm run test:e2e:m365-cdp`; opt-in real Copilot grounding checks: `pnpm run test:e2e:copilot-grounding`.

**Headless launched-app smokes:** `pnpm launch:test` verifies `tauri:dev` launch stability in Linux/Xvfb, and `pnpm agent-loop:test` runs the env-gated Rust autorun smoke that exercises retry recovery, approval handling, emitted `agent:*` events, the pushed `agent:status` phase sequence (`running` → `retrying` → `waiting_approval` → `idle:completed` minimum), and final `stopReason: "completed"` through the real desktop bridge.

**E2E (mock Tauri, browser only):** from `apps/desktop`, `E2E_SKIP_AUTH_SETUP=1 pnpm exec playwright test tests/app.e2e.spec.ts tests/e2e-comprehensive.spec.ts`. Use `CI=1` if `vite preview` might reuse a stale build after changing `tests/tauri-mock-core.ts`.

**Inspect Copilot DOM (real CDP):** `pnpm --filter @relay-agent/desktop inspect:copilot-dom` (signed-in Edge on 9360).

**CI:** see `.github/workflows/` — typically `cargo check`, `clippy`, `pnpm typecheck`, bundled Node fetch for Tauri.

## License

[Apache License 2.0](LICENSE).

## Contributing

Pull requests welcome. Follow **AGENTS.md** and keep **PLANS.md** / **docs/IMPLEMENTATION.md** aligned with behavioral changes.
