# Development Notes

## M365 Copilot CDP Integration

### Architecture
- `src/cdp_copilot.rs` — Lightweight CDP client using tokio-tungstenite for direct helper commands
- Connects to running Edge/Chrome via `http://127.0.0.1:9360` (Relay default; override with `RELAY_EDGE_CDP_PORT` / see `start-relay-edge-cdp.sh`)
- No Playwright dependency — raw CDP WebSocket protocol
- Production browser automation path is **Node `copilot_server.js` + CDP**; direct `cdp_*` commands are diagnostics/manual helpers.

### Tauri Commands
- `warmup_copilot_bridge` — Ensures `copilot_server.js` is up, then `GET /status` (Edge via `ensureEdgeConnected`, Copilot tab, login URL detection). Used by the Solid shell on mount; serializes with `describe` in JS via `_describeChain`. **Rust:** the command runs **`ensure_copilot_server`** and the **`warmup_status`** `block_on` inside **`tokio::task::spawn_blocking`** so `ensure_copilot_server`’s temporary runtime is not nested on a Tokio worker (avoids *“Cannot start a runtime from within a runtime”*).
- `connect_cdp` — Connect to browser, find Copilot page
- `cdp_send_prompt` — Send prompt → wait for streaming → return response
- `cdp_start_new_chat` — Navigate to /chat (creates new conversation)
- `cdp_screenshot` — Take PNG screenshot

### How to Use
1. **App path:** Opening the desktop app triggers `warmup_copilot_bridge`, which starts or attaches Edge and reaches Copilot via CDP (**`Page.navigate`**, not a Copilot URL on the Edge command line — avoids duplicate m365 tabs when `Target.getTargets` is briefly empty). Footer may prompt to sign in.
2. **Manual Edge:** Alternatively launch Edge: `pnpm relay:edge` from repo root, or `microsoft-edge --remote-debugging-port=9360 --remote-allow-origins=* …` with `~/RelayAgentEdgeProfile` (legacy **9333**: set `RELAY_EDGE_CDP_PORT=9333`)
3. Sign in to M365 Copilot in the browser if prompted
4. For direct CDP tooling only: frontend can call `connect_cdp()` → then `cdp_send_prompt()`

### E2E Tests
See `tests/m365-copilot-cdp.spec.ts` — Playwright-based CDP tests

### Build
```bash
cd apps/desktop/src-tauri
cargo check
```

## PDF parsing (`read_file`)

- **Runtime:** `crates/runtime` spawns Node with `liteparse-runner/parse.mjs` and `@llamaindex/liteparse` (`ocrEnabled: false`).
- **Dev setup** (from `apps/desktop`): run `pnpm run prep:liteparse-runner` once so `liteparse-runner/node_modules` exists. Optionally `pnpm run prep:bundled-node` to populate `binaries/relay-node-*`; otherwise the host `node` on `PATH` is used when the sidecar is absent.
- **Packaged app:** `lib.rs` `liteparse_env` sets `RELAY_LITEPARSE_RUNNER_ROOT` (bundle resources) and `RELAY_BUNDLED_NODE` (sidecar next to the executable). **`pnpm tauri build`** runs `beforeBuildCommand`: fetch Node for `TAURI_ENV_TARGET_TRIPLE`, `npm ci` in `liteparse-runner`, then Vite build.
- **Tuning:** `RELAY_PDF_PARSE_TIMEOUT_SECS` (default 120), `RELAY_LITEPARSE_MAX_PAGES` (passed to the runner).

## Windows Office hybrid read (COM + temp PDF + `read_file`)

- **Prompts:** `agent_loop` CDP catalog and desktop system prompt describe **one `PowerShell`** command (COM: `Value2`/CSV + `ExportAsFixedFormat`) → stdout JSON with **`pdfPath`** → second tool **`read_file`** on `pdfPath` in the **same** `relay_tool` array.
- **Sample:** `apps/desktop/scripts/office-hybrid-read-sample.ps1` — run on a Windows machine with Office, e.g. `pwsh -File scripts/office-hybrid-read-sample.ps1 -Path C:\path\book.xlsx -Mode Excel`, then `read_file` the printed `pdfPath` inside Relay (requires `prep:liteparse-runner` / bundled Node for PDF).
- **Manual verification:** documented in `docs/FILE_OPS_E2E_VERIFICATION.md` (*Office hybrid read*).
