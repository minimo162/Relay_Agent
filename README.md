# Relay Agent

Relay Agent is now the **OpenWork/OpenCode setup layer and OpenAI-compatible
M365 Copilot provider gateway**. OpenWork/OpenCode owns the primary UX,
sessions, tools, permissions, and workspace execution; Relay makes that path
easy to start and connects the provider loop to M365 Copilot in Edge over CDP.

The historical **Tauri v2 / SolidJS / Rust** desktop shell remains in the repo
only for provider launch support, diagnostics, and live Copilot verification.
It is not a product UX or execution fallback.

## Quick start

**Needs:** Rust 1.80+, Node 22+ (see root `package.json` engines), **pnpm**.

```bash
git clone https://github.com/minimo162/Relay_Agent.git
cd Relay_Agent
pnpm install
```

- **Installed desktop first run:** launch Relay Agent. It starts the provider
  gateway, writes the global OpenCode provider config, and on Windows prepares
  OpenWork/OpenCode automatically.
- **One-command repo first run:** `pnpm dev`.
- **Explicit auto bootstrap:** `pnpm bootstrap:openwork-opencode:auto`.
- **Deterministic bootstrap smoke:** `pnpm smoke:openwork-opencode-bootstrap-gateway`.
- **Live M365 provider smoke:** `pnpm live:m365:opencode-provider`
  with Edge signed in to M365.

Copilot needs Edge signed in to M365. Provider setup and smoke tests:
[docs/OPENCODE_PROVIDER_GATEWAY.md](docs/OPENCODE_PROVIDER_GATEWAY.md). CDP
defaults and pitfalls: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md)
(Relay / `pnpm relay:edge` / Playwright live CDP tests: default **9360** —
override with `CDP_ENDPOINT`).

## Stack

| Layer | Technology |
|-------|------------|
| Primary UX / execution | OpenCode/OpenWork. It owns chat UX, sessions, tool execution, permissions, MCP/plugins/skills, workspace config, and event state. |
| Setup + provider gateway | `pnpm dev` runs the OpenWork/OpenCode auto bootstrap. Node `copilot_server.js` exposes `/v1/models` and `/v1/chat/completions` as an OpenAI-compatible provider, with bearer auth and streaming SSE. |
| LLM surface | M365 Copilot in Edge over CDP. Relay forwards provider turns to Copilot and normalizes structured tool-call output into OpenAI `tool_calls`; it does not execute tools in provider mode. |
| Diagnostic desktop shell | SolidJS, Vite, TypeScript, Tailwind, Tauri v2, and Rust IPC remain under `apps/desktop/` for provider launch support, diagnostics, and live Copilot smoke coverage. |

## What Relay Does

- **No-thinking setup** — the installed desktop launch and `pnpm dev` choose
  the normal OpenWork/OpenCode first-run path, start the provider gateway, write
  the provider config, and on Windows download/verify the pinned artifacts
  before the installer handoff.
- **Beginner setup state** — the installed app shows setup as `Preparing`,
  `Sign in to M365`, `Ready`, or `Needs attention`, with a single retry action
  for recovery.
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

## Provider Gateway Operations

The canonical installed first-use path is:

1. Start or sign in to Edge with M365 Copilot available.
2. Launch Relay Agent. It starts the local provider gateway and writes
   `relay-agent/m365-copilot` into the global OpenCode config at
   `~/.config/opencode/opencode.json`.
3. On Windows, Relay downloads/verifies OpenWork/OpenCode and opens the
   verified OpenWork installer handoff for normal Windows approval.
4. Press **Open OpenWork/OpenCode** in Relay. The Copilot provider is already
   configured.

Relay shows setup progress in the installed app. If setup fails, use
**Try Setup Again**; provider ports, tokens, and config files remain support
details, not required setup steps.

The desktop shell is not a supported execution fallback. Diagnostic commands
are grouped under `diag:*` and are kept only to troubleshoot the provider
gateway, CDP transport, and historical Tauri launch surface.

Details, limits, and milestone notes: **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)**. Roadmap and guardrails: **[PLANS.md](PLANS.md)**. Repo rules: **[AGENTS.md](AGENTS.md)**. Manual criteria for model grounding and tool protocol: **[docs/AGENT_EVALUATION_CRITERIA.md](docs/AGENT_EVALUATION_CRITERIA.md)**. Claw-code selective alignment history is preserved in **[docs/CLAW_CODE_ALIGNMENT.md](docs/CLAW_CODE_ALIGNMENT.md)**, but it is no longer an active execution-compatibility gate.

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

Diagnostic desktop shell entry: `apps/desktop/src-tauri/src/lib.rs`. IPC source
types live in Rust (`models.rs` and diagnostic structs in `tauri_bridge.rs`) and
generate `apps/desktop/src/lib/ipc.generated.ts`; `apps/desktop/src/lib/ipc.ts`
stays as the thin invoke wrapper plus UI helpers for diagnostics.

## Repository layout

```
Relay_Agent/
├── PLANS.md, AGENTS.md, docs/IMPLEMENTATION.md, docs/CLAW_CODE_ALIGNMENT.md   # planning & log
├── scripts/                     # Linux Edge / CDP helpers
├── apps/desktop/
│   ├── src/                     # SolidJS diagnostic shell (root.tsx, components/, lib/)
│   ├── DESIGN.md                # Cursor Inspiration spec; live tokens + .ra-type-* in src/index.css
│   ├── public/                  # Static assets (e.g. favicon.svg for Vite)
│   ├── src-tauri/               # Tauri + Rust workspace crates
│   ├── scripts/                 # fetch-bundled-node/ripgrep, inspect-copilot-dom, …
│   └── tests/                   # Playwright + Tauri mocks (RELAY_E2E=1 build)
└── Cargo.toml, package.json, pnpm-workspace.yaml
```

**App icons:** Vector source is `apps/desktop/src-tauri/icons/source/relay-agent.svg`. From `apps/desktop/`, run `pnpm exec tauri icon src-tauri/icons/source/relay-agent.svg -o src-tauri/icons` to refresh `icon.ico`, `icon.icns`, and PNGs referenced in `tauri.conf.json`. Details: `docs/IMPLEMENTATION.md` (Milestone Log, 2026-04-09 Relay Agent app icon and favicon).

**Bundled diagnostic assets:** `apps/desktop/src-tauri/tauri.conf.json` packages the `relay-node` and `relay-rg` external binaries plus the `liteparse-runner/` resource directory for the diagnostic desktop shell.
Bundle prerequisites are prepared explicitly with `pnpm --filter @relay-agent/desktop prep:tauri-bundle` (also run by `tauri:build` and release CI); the Tauri build hook itself only runs the frontend build.

**OpenCode provider assets:** provider startup, config installation, and smoke
coverage live under `apps/desktop/scripts/`:
`start_opencode_provider_gateway.mjs`, `install_opencode_provider_config.mjs`,
`opencode_provider_gateway_smoke.mjs`, and
`live_m365_opencode_provider_smoke.mjs`.

## Diagnostic IPC

The Tauri IPC surface remains for doctor, CDP inspection, warmup, and support
bundles. It is not the provider-mode
execution contract. In provider mode, OpenCode/OpenWork calls
`/v1/chat/completions`, receives OpenAI-compatible assistant messages or
`tool_calls`, executes tools itself, and sends tool results back in the next
provider request.

## Configuration

**Runtime defaults:** provider-mode execution, turn limits, permissions, and
transcript state live in OpenCode/OpenWork. Relay keeps only provider gateway
and diagnostic configuration.

**Claw-style paths** (instructions + settings): `.claw`, `CLAW.md`, optional additive `~/.relay-agent/SYSTEM_PROMPT.md` — see [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). The local prompt file appends custom guidance but does **not** replace Relay’s core system sections. Runtime behavior should come from OpenCode/OpenWork wherever practical.

**Diagnostics:** `get_relay_diagnostics` still exists in IPC, the Settings modal exposes **Export diagnostics** for a text bundle, and the repo ships a headless provider/transport doctor entrypoint: `pnpm doctor -- --json`.

**OpenWork/OpenCode bootstrap:** installed Relay starts the provider gateway
and writes the global OpenCode config at `~/.config/opencode/opencode.json` on
app launch. `pnpm dev` runs the repo no-thinking auto path. On Windows the auto
path downloads and verifies pinned artifacts, extracts OpenCode, opens the
OpenWork installer handoff, and writes the local provider token into config.
For diagnostics, `pnpm bootstrap:openwork-opencode -- --pretty` still prints a
non-destructive preflight report.

**Environment (Copilot):** Default CDP base **9360**. Provider startup uses `RELAY_EDGE_CDP_PORT` unless overridden by script flags. Linux requires Edge + `DISPLAY`; the Relay Edge profile lives at `~/RelayAgentEdgeProfile`. Anonymous `GET /health` returns only a non-secret Relay fingerprint (`status`, `service`, `instanceId`). OpenAI-compatible provider requests should use `Authorization: Bearer $RELAY_AGENT_API_KEY`; diagnostic desktop bridge endpoints may also use the boot token header. In provider-gateway mode, Relay returns normalized OpenAI `tool_calls` and OpenCode/OpenWork executes them. Details: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md).

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

**Provider setup smoke:** `pnpm smoke:openwork-opencode-bootstrap-headless`
checks the non-destructive bootstrap report, and
`pnpm smoke:openwork-opencode-bootstrap-gateway` starts the bootstrap-managed
provider gateway against deterministic local checks.

### Diagnostic Desktop Checks

These checks keep the Tauri shell, CDP transport, and diagnostic tooling
observable. They are not provider-gateway acceptance checks.

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

**Headless launched-app smoke:** `pnpm diag:desktop-launch` verifies the
diagnostic `diag:tauri-dev` shell can still launch under Linux/Xvfb.

**Live M365 provider smoke:** `pnpm live:m365:opencode-provider` validates the
OpenAI-compatible provider path against signed-in M365 Copilot. This is the live
execution smoke for OpenCode/OpenWork provider mode.

**Live Copilot response probe:** `pnpm --filter @relay-agent/desktop live:m365:copilot-response-probe -- --prompt "<prompt>"` drives the signed-in Copilot web UI over CDP and records response artifacts without invoking Relay-owned desktop execution.

**Headless desktop coverage:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop` runs the workspace tests without invoking the Windows-hostile Tauri lib test binary. Headless desktop logic and its unit tests now live in `apps/desktop/src-tauri/crates/desktop-core`.

**Doctor CLI integration:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli` covers doctor report shape and CLI-facing status handling.

**E2E (mock Tauri, browser only):** from `apps/desktop`, `E2E_SKIP_AUTH_SETUP=1 pnpm exec playwright test tests/app.e2e.spec.ts tests/e2e-comprehensive.spec.ts`. Use `CI=1` if `vite preview` might reuse a stale build after changing `tests/tauri-mock-core.ts`.

**Inspect Copilot DOM (real CDP):** `pnpm --filter @relay-agent/desktop inspect:copilot-dom` (signed-in Edge on 9360).

**Live Copilot response probe (real CDP):** `pnpm --filter @relay-agent/desktop live:m365:copilot-response-probe -- --prompt "<prompt>" [--prompt "<prompt 2>"]` sends prompts through Playwright `connectOverCDP`, saves screenshots plus DOM/transcript artifacts under a temp directory, and records Relay-style DOM extracts next to the visible Copilot reply for mismatch analysis.

**CI:** see `.github/workflows/` — main CI now runs a matrix: `ubuntu-latest` executes pnpm lockfile policy guard, bundled runtime prep (`relay-node`, `relay-rg`, LiteParse runner), Linux Tauri deps, docs truth guards, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:desktop-launch`; `windows-latest` runs the same lockfile/runtime prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:windows-smoke`. The `pnpm check` step includes the CI-safe OpenCode provider contract check; full OpenCode/Bun and live M365 provider smokes remain explicit opt-in commands.

## License

[Apache License 2.0](LICENSE).

## Contributing

Pull requests welcome. Follow **AGENTS.md** and keep **PLANS.md** / **docs/IMPLEMENTATION.md** aligned with behavioral changes.
