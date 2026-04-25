# Relay Agent

Relay Agent is now an **OpenAI-compatible M365 Copilot provider gateway** for
OpenCode/OpenWork. OpenCode/OpenWork owns the primary UX, sessions, tools,
permissions, and workspace execution; Relay connects that provider loop to
M365 Copilot in Edge over CDP.

The historical **Tauri v2 / SolidJS / Rust** desktop shell remains in the repo
for transition, diagnostics, and live Copilot verification, but it is no longer
the target execution or UX source of truth.

## Quick start

**Needs:** Rust 1.80+, Node 22+ (see root `package.json` engines), **pnpm**.

```bash
git clone https://github.com/minimo162/Relay_Agent.git
cd Relay_Agent
pnpm install
```

- **OpenCode provider gateway:** `pnpm start:opencode-provider-gateway`, then
  point OpenCode/OpenWork at `http://127.0.0.1:18180/v1`.
- **Install OpenCode provider config:** `pnpm install:opencode-provider-config -- --workspace /path/to/workspace`.
- **Transition desktop shell:** `pnpm --filter @relay-agent/desktop tauri:dev`
  (Unix prestarts Edge/Copilot helper; see package script).
- **Frontend only (Vite):** `pnpm dev` (same as `vite` in `apps/desktop`; no native shell).

Copilot needs Edge signed in to M365. Provider setup and smoke tests:
[docs/OPENCODE_PROVIDER_GATEWAY.md](docs/OPENCODE_PROVIDER_GATEWAY.md). CDP
defaults and pitfalls: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md)
(Relay / `pnpm relay:edge` / Playwright live CDP tests: default **9360** —
override with `CDP_ENDPOINT`).

## Stack

| Layer | Technology |
|-------|------------|
| Primary UX / execution | OpenCode/OpenWork. It owns chat UX, sessions, tool execution, permissions, MCP/plugins/skills, workspace config, and event state. |
| Provider gateway | Node `copilot_server.js` exposes `/v1/models` and `/v1/chat/completions` as an OpenAI-compatible provider, with bearer auth and streaming SSE. |
| LLM surface | M365 Copilot in Edge over CDP. Relay forwards provider turns to Copilot and normalizes structured tool-call output into OpenAI `tool_calls`; it does not execute tools in provider mode. |
| Transition desktop shell | SolidJS, Vite, TypeScript, Tailwind, Tauri v2, and Rust IPC remain under `apps/desktop/` for diagnostics, compatibility, and live Copilot smoke coverage. |

## What The Gateway Does

- **Provider facade** — OpenCode/OpenWork can call Relay as
  `relay-agent/m365-copilot` through an OpenAI-compatible endpoint.
- **Copilot transport** — Relay manages Edge/CDP lifecycle, Copilot readiness,
  request isolation, streaming, aborts, and diagnostics.
- **Tool-call normalization** — Relay accepts structured Copilot output such as
  `tool_calls`, `tool_uses`, or `relay_tool` and returns OpenAI-compatible
  `tool_calls` for OpenCode/OpenWork to execute.
- **Repair without execution** — When Copilot returns prose/code instead of a
  required tool call, Relay performs one constrained repair retry and records
  artifacts if repair still fails. Relay does not infer or run arbitrary code.

Details: **[docs/OPENCODE_PROVIDER_GATEWAY.md](docs/OPENCODE_PROVIDER_GATEWAY.md)**.

## Transition Desktop Shell

- **Chats** — The sidebar tracks chats, not one-shot runs. Sending while the active chat is idle continues that chat; **New chat** starts a separate one. Tool steps, approvals, and user-question prompts stay **inline in chat**.
- **First run** — The app now opens in the same chat shell used later. The empty conversation surface shows a compact setup card for **Project** and **Copilot**, while `Chats`, `Context`, and `Settings` stay visible from the start. You can type the first request immediately; if setup is still missing, Relay keeps the draft in place and shows inline actions to finish setup before sending.
- **Approvals** — **Allow once**, **Always allow in this conversation**, or **Always allow in this folder** for gated tools. Technical payloads are tucked under **Advanced details**.
- **Inline prompts** — Approval requests and `AskUserQuestion` follow-ups stay inside the conversation flow instead of switching to a separate mode or modal-first workflow.
- **Settings** — The Settings modal keeps **Project** and **Copilot** in the Basic section, with browser/troubleshooting controls under collapsed Advanced details.
- **Context panel** — **Activity** shows `TodoWrite` snapshots when Relay writes a checklist and otherwise stays minimal; **Integrations** shows MCP servers and workspace instruction surfaces when `cwd` is set. The panel stays hidden on first run.
- **Composer** — **Enter** inserts a newline; **Ctrl+Enter** (**⌘+Enter** on macOS) or **Send** submits. Relay uses one standard conversation surface: it inspects first, answers directly for review/explanation requests, and asks for approval only when a risky tool run is needed. Assistant text streams live, and rewritten Copilot drafts replace the active bubble cleanly instead of duplicating text.
- **Undo / Redo** — Header actions reverse the last successful workspace writes from the active session (`write`, `edit`, `NotebookEdit`, PDF tools), when the agent is idle.
- **Audit readability** — Tool rows prefer human labels and per-tool summaries (`Read file`, `Search file contents`, PDF actions, file writes) instead of raw internal tool ids.
- **Extras** — PDF via LiteParse through the bundled `relay-node` sidecar; rg-backed local search through the bundled `relay-rg` sidecar; Windows Office hybrid read (COM + PDF); MCP over stdio.

Details, limits, and milestone notes: **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)**. Roadmap and guardrails: **[PLANS.md](PLANS.md)**. Repo rules: **[AGENTS.md](AGENTS.md)**. Manual criteria for model grounding and tool protocol: **[docs/AGENT_EVALUATION_CRITERIA.md](docs/AGENT_EVALUATION_CRITERIA.md)**. Claw-code selective alignment (upstream pin, tool-shape notes, `compat-harness` parity-style tests, and deterministic full-session harness coverage): **[docs/CLAW_CODE_ALIGNMENT.md](docs/CLAW_CODE_ALIGNMENT.md)**.

## Architecture (high level)

```
OpenCode/OpenWork UX + execution
  |
  | OpenAI-compatible provider API
  v
Relay copilot_server.js provider gateway
  |
  | Edge CDP
  v
M365 Copilot
```

Transition desktop shell entry: `apps/desktop/src-tauri/src/lib.rs`. IPC
source types live in Rust (`models.rs`, `agent_projection.rs`) and generate
`apps/desktop/src/lib/ipc.generated.ts`; `apps/desktop/src/lib/ipc.ts` stays as
the thin invoke/listen wrapper plus UI helpers.

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
│   ├── scripts/                 # fetch-bundled-node/ripgrep, inspect-copilot-dom, …
│   └── tests/                   # Playwright + Tauri mocks (RELAY_E2E=1 build)
└── Cargo.toml, package.json, pnpm-workspace.yaml
```

**App icons:** Vector source is `apps/desktop/src-tauri/icons/source/relay-agent.svg`. From `apps/desktop/`, run `pnpm exec tauri icon src-tauri/icons/source/relay-agent.svg -o src-tauri/icons` to refresh `icon.ico`, `icon.icns`, and PNGs referenced in `tauri.conf.json`. Details: `docs/IMPLEMENTATION.md` (Milestone Log, 2026-04-09 Relay Agent app icon and favicon).

**Bundled runtime assets:** `apps/desktop/src-tauri/tauri.conf.json` packages the `relay-node` and `relay-rg` external binaries plus the `liteparse-runner/` resource directory. The production desktop path uses those bundled assets for the Copilot bridge, PDF parsing, and rg-backed local search in release builds.
Bundle prerequisites are prepared explicitly with `pnpm --filter @relay-agent/desktop prep:tauri-bundle` (also run by `tauri:build` and release CI); the Tauri build hook itself only runs the frontend build.

**OpenCode provider assets:** provider startup, config installation, and smoke
coverage live under `apps/desktop/scripts/`:
`start_opencode_provider_gateway.mjs`, `install_opencode_provider_config.mjs`,
`opencode_provider_gateway_smoke.mjs`, and
`live_m365_opencode_provider_smoke.mjs`.

## IPC (commands you invoke)

| Command | Purpose |
|---------|---------|
| `start_agent` | Start a new conversation (`goal`, optional `cwd`, `files`, `maxTurns`, `browserSettings`) |
| `continue_agent_session` | Continue an existing idle conversation (`sessionId`, `message`) |
| `respond_approval`, `respond_user_question` | Resolve inline approval and user-question prompts |
| `cancel_agent`, `get_session_history`, `compact_agent_session` | Session control |
| `undo_session_write`, `redo_session_write`, `get_session_write_undo_status` | Per-session file-write undo stack |
| `probe_rust_analyzer` | LSP milestone probe: `rust-analyzer --version` in a folder (`docs/LSP_MILESTONE.md`) |
| `warmup_copilot_bridge` (optional `browserSettings`), `get_relay_diagnostics`, `write_text_export` | Copilot readiness and support-bundle export |
| `workspace_instruction_surfaces`, `get_workspace_allowlist`, `remove_workspace_allowlist_tool`, `clear_workspace_allowlist`, `list_workspace_slash_commands` | Workspace instruction and allowlist surfaces for the current folder |
| `connect_cdp`, `cdp_*`, `disconnect_cdp` | Direct CDP helpers |
| `mcp_*` | MCP server registry |

**Events:** `agent:text_delta`, `agent:tool_start`, `agent:tool_result`, `agent:approval_needed`, `agent:user_question`, `agent:status`, `agent:turn_complete`, `agent:error`. Shapes are generated into `apps/desktop/src/lib/ipc.generated.ts` and consumed via `apps/desktop/src/lib/ipc.ts`. `agent:text_delta` can append or replace the in-flight assistant bubble when Copilot rewrites streamed text.

## Configuration

**Rust defaults** (`apps/desktop/src-tauri/src/config.rs`): e.g. `max_turns` (16), concurrency (4), and session TTL (30 min). Execution transcript state lives in the linked OpenCode session; Relay-specific defaults live in the desktop adapter/config modules.

**Claw-style paths** (instructions + settings): `.claw`, `CLAW.md`, optional additive `~/.relay-agent/SYSTEM_PROMPT.md` — see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). The local prompt file appends custom guidance but does **not** replace Relay’s core system sections. Runtime behavior should come from OpenCode/OpenWork wherever practical.

**Diagnostics:** `get_relay_diagnostics` still exists in IPC, the Settings modal exposes **Export diagnostics** for a text bundle, and the repo now ships a headless doctor entrypoint: `pnpm doctor -- --json`.

**OpenCode provider config:** `pnpm start:opencode-provider-gateway -- --print-config`
prints the provider block and token export. `pnpm install:opencode-provider-config -- --workspace /path/to/workspace`
merges that provider into a workspace `opencode.json` while preserving unrelated
settings.

**Environment (Copilot):** Default CDP base **9360**. Effective CDP port for the Node bridge and agent: **`browserSettings.cdpPort`** from each `start_agent` / `warmup_copilot_bridge` request (typically from `localStorage` `relay.settings.browser`) **overrides** `RELAY_EDGE_CDP_PORT`, which overrides the default. Changing the port while **more than one** agent session is running returns an error (finish other sessions or restart the app). Integration tests and external tools may still use `CDP_ENDPOINT` (see Playwright configs). Linux: Edge + `DISPLAY`; profile `~/RelayAgentEdgeProfile`. Dedicated Edge is started **without** a trailing Copilot URL; the Node bridge navigates over CDP (`Page.navigate` / tab reuse) so a cold **`Target.createTarget`** race does not open **two** `m365.cloud.microsoft/chat` tabs. The Node bridge now binds Copilot tabs **per Relay session** and requires **`relay_session_id` + `relay_request_id`** on `POST /v1/chat/completions`; retries reuse the same `request_id`, and `POST /v1/chat/abort` cancels by that request id only. Anonymous `GET /health` returns only a non-secret Relay fingerprint (`status`, `service`, `instanceId`) so Rust can confirm the spawned bridge without exposing the boot token over HTTP. Mutable bridge endpoints (`GET /status`, `POST /v1/chat/completions`, `POST /v1/chat/abort`) require **`X-Relay-Boot-Token`**; the token is shared out-of-band at spawn time and is **not** returned by `/health`. Direct `connect_cdp` / `cdp_*` attach only to the Relay-dedicated Edge profile and `disconnect_cdp` kills only the tracked browser PID. Optional: `RELAY_CDP_PROBE_TIMEOUT_MS` (slow Windows CDP), `RELAY_COPILOT_NO_WINDOW_FOCUS=1` (do not raise Edge via CDP), `RELAY_COPILOT_NUDGE_EDGE=1` (Win32 nudge, off by default), **`RELAY_FALLBACK_SENTINEL_POLICY=observe`** (compatibility opt-out; the default now rejects fallback parser candidates that omit `"relay_tool_call": true`). **Startup tuning:** Windows skips **`--remote-debugging-port=0`** unless **`RELAY_COPILOT_TRY_PORT_ZERO=1`**; **`RELAY_EXISTING_CDP_WAIT_MS`** (default 10s Win / 30s else) waits for CDP after a probe miss; **`RELAY_EDGE_PORT0_CDP_WAIT_MS`** (2–120s, default 12s) limits CDP wait when port=0 is used; **`RELAY_COPILOT_RECLAIM_NETSTAT=1`** enables slow Windows `netstat` fallback during HTTP port reclaim (default off). Stale **Relay-owned** `copilot_server` listeners on **18080+** are reclaimed only when `/health` returns the Relay service fingerprint with a different `instanceId`; listeners without that fingerprint are treated as foreign and left alone. **`RELAY_COPILOT_RECLAIM_STALE_HTTP=0`** disables reclaim. In provider-gateway mode, Relay returns normalized OpenAI `tool_calls` and OpenCode/OpenWork executes them; legacy desktop CDP prompts may still describe `relay_tool` parsing for transition coverage. Details: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md).

## Development

```bash
pnpm check

cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli
```

Fast local frontend-only check: `pnpm typecheck`.

`pnpm check` runs the hard-cut truth guard, the lightweight OpenCode provider
contract check, TypeScript typecheck, and the desktop frontend build. The
provider contract check is intentionally CI-safe: it validates provider scripts
and the OpenAI-compatible facade tests without requiring a local OpenCode
checkout, Bun, Edge, or a live M365 session.

`cargo check` / `cargo test` may still print non-fatal `ts-rs` warnings for ignored serde hints such as `skip_serializing_if = "Option::is_none"` while generating TypeScript bindings.

### Canonical Provider Checks

These are the current acceptance checks for the OpenCode/OpenWork direction.

**OpenCode provider smoke:** `pnpm smoke:opencode-provider` verifies the
OpenAI-compatible provider contract with deterministic Copilot stubs, including
an OpenCode-owned `read` tool roundtrip.

**Live M365 OpenCode provider smoke:** `pnpm live:m365:opencode-provider`
starts the gateway against a signed-in M365 Copilot tab and verifies both a
plain provider response and an OpenCode-owned `read` tool loop.

**Provider setup smoke:** `pnpm start:opencode-provider-gateway -- --print-config`
prints the provider config without starting Edge, and
`pnpm install:opencode-provider-config -- --workspace /path/to/workspace --dry-run`
checks the workspace merge path.

### Transition Desktop Diagnostics

These checks keep the legacy Tauri shell, CDP transport, and diagnostic tooling
observable while OpenCode/OpenWork takes over the primary UX and execution path.

**Headless doctor:** `pnpm doctor -- --json` probes workspace `.claw`, bundled runtime assets (`relay-node`, LiteParse runner), CDP reachability, bridge `/health`, authenticated `/status`, and M365 sign-in state. Exit codes: `0` = `ok`, `1` = `warn`, `2` = `fail`.

**Grounding / CDP checks:** `pnpm run test:grounding-fixture`; `pnpm run test:e2e:m365-cdp`; opt-in real Copilot grounding checks: `pnpm run test:e2e:copilot-grounding`.

**Live repair probe (signed-in Edge):**

```bash
RELAY_EDGE_CDP_PORT=9360 bash scripts/start-relay-edge-cdp.sh
RELAY_LIVE_REPAIR_TIMEOUT_SECS=90 RELAY_LIVE_REPAIR_STAGE_TIMEOUT_SECS=90 \
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  loop_controller_tests::live_repair_probe_streams_original_and_both_repair_prompts \
  -- --ignored --nocapture
```

Use the signed-in `RelayAgentEdgeProfile` on the same CDP port. A good run logs `original`, `repair1`, and `repair2` stage sends/replies. If it fails, the panic/log output now includes typed bridge metadata such as `failureClass`, `stageLabel`, and `requestChain`. Detailed prerequisites and failure meanings: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md).

**Headless launched-app smoke:** `pnpm launch:test` verifies the transition
`tauri:dev` shell can still launch under Linux/Xvfb. It is a launch diagnostic,
not the canonical provider-gateway acceptance path.

**Live desktop smoke:** `pnpm live:m365:desktop-smoke` drives the transition
desktop app against signed-in M365 Copilot and validates app launch plus
desktop/Copilot bridge behavior for regression diagnosis.

**Live same-session grounding / approval smoke:** `pnpm live:m365:grounding-approval-multiturn` drives three transition-desktop turns against signed-in M365 Copilot, checks Turn 1 grounding on `tests/fixtures/tetris_grounding.html`, verifies `Always allow in this conversation` reuse on Turn 3, and writes JSON artifacts under `/tmp/relay-live-m365-grounding-approval-*`.

**Live same-session path-resolution smoke:** `pnpm live:m365:path-resolution-same-session` drives three read-only transition-desktop turns against signed-in M365 Copilot, verifies absolute / workspace-relative / workspace-root-relative `read` resolution in one Relay session, and writes JSON artifacts under `/tmp/relay-live-m365-path-resolution-*`.

**Live local-search smoke:** `pnpm live:m365:workspace-search` drives read-only transition-desktop turns against signed-in M365 Copilot, prepares a disposable `tests/live_search_fixture` folder under the workspace, verifies low-level `glob` / `grep` lookup behavior, covers honest no-evidence behavior plus generated-directory ignore fixtures, forbids mutation tools, and writes JSON artifacts under `/tmp/relay-live-m365-workspace-search-*`. Office/PDF fixture coverage follows the CDP-facing `glob` candidate discovery plus exact `read` extraction flow when the local fixture set includes those document types.

**Live Tetris smoke:** `pnpm live:m365:tetris-html` remains a transition
desktop regression harness for the old local-file creation flow. Provider-mode
tool execution should be validated with `pnpm live:m365:opencode-provider`.

**Headless desktop coverage:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop` runs the workspace tests without invoking the Windows-hostile Tauri lib test binary. Headless desktop logic and its unit tests now live in `apps/desktop/src-tauri/crates/desktop-core`.

**Doctor CLI integration:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli` covers doctor report shape and CLI-facing status handling.

**Deterministic fixture harness:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p compat-harness` checks that the vendored historical mock parity manifest remains readable. It no longer links the old Relay runtime/tools parity harness.

**E2E (mock Tauri, browser only):** from `apps/desktop`, `E2E_SKIP_AUTH_SETUP=1 pnpm exec playwright test tests/app.e2e.spec.ts tests/e2e-comprehensive.spec.ts`. Use `CI=1` if `vite preview` might reuse a stale build after changing `tests/tauri-mock-core.ts`.

**Inspect Copilot DOM (real CDP):** `pnpm --filter @relay-agent/desktop inspect:copilot-dom` (signed-in Edge on 9360).

**Live Copilot response probe (real CDP):** `pnpm --filter @relay-agent/desktop live:m365:copilot-response-probe -- --prompt "<prompt>" [--prompt "<prompt 2>"]` sends prompts through Playwright `connectOverCDP`, saves screenshots plus DOM/transcript artifacts under a temp directory, and records Relay-style DOM extracts next to the visible Copilot reply for mismatch analysis.

**CI:** see `.github/workflows/` — main CI now runs a matrix: `ubuntu-latest` executes pnpm lockfile policy guard, bundled runtime prep (`relay-node`, `relay-rg`, LiteParse runner), Linux Tauri deps, docs truth guards, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm launch:test`; `windows-latest` runs the same lockfile/runtime prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm smoke:windows`. The `pnpm check` step includes the CI-safe OpenCode provider contract check; full OpenCode/Bun and live M365 provider smokes remain explicit opt-in commands.

## License

[Apache License 2.0](LICENSE).

## Contributing

Pull requests welcome. Follow **AGENTS.md** and keep **PLANS.md** / **docs/IMPLEMENTATION.md** aligned with behavioral changes.
