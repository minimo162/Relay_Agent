# CDP/Edge/M365 Copilot Fixes Log

## Problem

After deploying Relay Agent to Windows, M365 Copilot would not launch or connect. Edge would open but show stray tabs (`http://0.0.36.6/`, `about:blank`) instead of Copilot, and the agent loop would hang then timeout.

## Root Causes and Fixes (chronological)

### Fix 1: `connect_cdp` never called from UI

Symptom: `start_agent` called `get_cdp_page()` but `CdpSessionState.page` was always `None` because no UI element invoked `connect_cdp`.

Fix: Added `ensure_cdp_connected()` in `tauri_bridge.rs` — a new public function that auto-connects CDP when the agent loop starts, with a fast-path that returns an existing page if `connect_cdp` was called beforehand. `run_agent_loop_impl` was updated to call this instead of `get_cdp_page()`.

Files: `tauri_bridge.rs`, `agent_loop.rs`
Commit: `3dcf68c`

### Fix 2: Edge `--no-startup-window` on Windows

Symptom: `launch_dedicated_edge` passed `--no-startup-window` to Edge on Windows, preventing any initial window from being created. Copilot URL navigation failed silently.

Fix: Removed `--no-startup-window` from Windows launch args when passing a URL. Later, removed the URL entirely and navigated via CDP after launch.

Files: `cdp_copilot.rs`
Commit: `a9c275a`, then `6be1e3f`

### Fix 3: `0.0.36.6` WebSocket URL

Symptom: Windows Edge CDP returns `webSocketDebuggerUrl` as `ws://0.0.36.6:PORT/...`. `0.0.36.6` is the IPv4-mapped representation of IPv6 `::1` (loopback). WebSocket connections to this address failed silently.

Fix: Added `0.0.36.6` normalization in `resolve_ws()` and `resolve_ws_from_port()` to replace it with `127.0.0.1`.

Files: `cdp_copilot.rs`
Commit: `8e986a3`

### Fix 4: Existing browser conflict on port 9222

Symptom: User's everyday Edge/Chrome was already listening on port 9222 for devtools. `try_existing()` found the existing browser and tried to use it, but that browser had `ws://0.0.36.6/` URLs and no Copilot tab.

Fix: When `auto_launch` is true (the default), skip `try_existing()` on the default URL entirely. Always launch a new dedicated Edge on a free port. Changed base port from 9222 to 9240 to avoid default devtools conflicts.

Files: `cdp_copilot.rs`, `tauri_bridge.rs`
Commit: `683a9c9`, `d2b8a34`

### Fix 5: `--user-data-dir` path treated as URL

Symptom: Edge interpreted `--user-data-dir` and the profile path as separate arguments, opening `file:///C:/Users/m242054/RelayAgentEdgeProfile/` as a browser tab.

Fix: Changed to `--user-data-dir=<path>` format (`=` instead of space).

Files: `cdp_copilot.rs`
Commit: `42a8f7b`

### Fix 6: Missing `Ctx::one_shot()` and `SplitSink` type

Symptom: `Ctx::one_shot()` method was missing, and `futures_util::sink::SplitSink` did not exist in the crate. Persistent WebSocket connection pattern replaced the original one-shot pattern.

Fix: Added `futures` crate with `sink` feature, changed `WsWriter` type to `futures_util::stream::SplitSink`, implemented persistent WebSocket `Ctx` with multiplexed pending requests via oneshot channels, and added back the `one_shot` static method.

Files: `cdp_copilot.rs`, `Cargo.toml`
Commit: `3dcf68c`

### Fix 7: `0.0.36.6` stray tab persists

Symptom: Even with a dedicated Edge, two tabs opened: `http://0.0.36.6/` and `about:blank`. The `0.0.36.6` tab is Edge's default startup page in CDP mode.

Fix: After launch, close any non-Copilot tabs via `Target.closeTarget`, then create the Copilot tab via `Target.createTarget`. If that fails, navigate an existing tab via `Page.navigate`. Added `info!` logging at each step.

Files: `cdp_copilot.rs`
Commit: `33575a5`, `3807498`

### Fix 8: VBS/Code Integrity error 577

Symptom: `LoadEnclaveImageW failed, error code 577` — Windows Virtualization-Based Security blocks the Edge VBS Enclave feature in corporate environments. Edge launches but may hang or fail to respond to CDP.

Fix: Added `--disable-features=EdgeEnclave,VbsEnclave`, `--disable-gpu`, and `--disable-gpu-compositing` to Edge launch args.

Files: `cdp_copilot.rs`
Commit: `d2b8a34`

### Fix 9: No logging visible in terminal

Symptom: Tracing logs were not appearing in the terminal, making it impossible to identify which step was failing.

Fix: Added `tracing-subscriber` crate with `Level::INFO` initialization in `lib.rs`.

Files: `lib.rs`, `Cargo.toml`
Commit: `7b99b9d`

### Fix 10: CDP port conflict and tab discovery improvements (from kiroku reference)

Symptom: Even after moving the base port from 9222 to 9240, existing browser devtools ports still conflicted. Tab discovery right after Edge launch sometimes found zero pages because Edge registers tabs asynchronously.

Fix:
- Changed default CDP base port from 9240 to 9333 (matching kiroku's `kiroku` configuration)
- Increased `find_free_port` max_attempts from 20 to 50
- Added 3-retry loop for `list_pages` after Edge launch with 2-second waits between attempts
- Extended Copilot navigation wait from 5 to 10 seconds
- Made `list_pages` calls more resilient using `unwrap_or_default` instead of hard failure
- Added `Target.createTarget` result logging for troubleshooting
- Added final fallback: navigate any available page to Copilot URL if no Copilot-specific tab is found
- Removed unsupported `--no-sandbox` flag from Edge launch args (Edge does not support this flag)

Note: This fix improved connection robustness but did NOT resolve the VBS error 577 that completely blocks Edge in the target corporate environment.

Files: `cdp_copilot.rs`, `tauri_bridge.rs`
Commit: `8cae2ed`, `abceb01`, then reverted `--no-sandbox`

### Fix 11: VBS Error 577 — Direct Edge launch is completely blocked; switch to Playwright proxy

Symptom: `LoadEnclaveImageW failed, error code 577` persisted despite all VBS-related `--disable-features` flags (`EdgeEnclave`, `VbsEnclave`, `RendererCodeIntegrity`) and `--no-sandbox`, `--disable-site-isolation-trials`, `--disable-breakpad`, `--disable-crashpad`. The corporate GroupPolicy forces VBS enclave loading for Edge processes, preventing the browser from responding to CDP. Edge appears to start but remains unresponsive on the debug port for 30+ seconds until timeout.

Root cause: Windows VBS (Virtualization-Based Security) GroupPolicy in the corporate environment (`m242054` machine) enforces Code Integrity policies that cannot be disabled via command-line flags. Edge's `edge_ess\vbs_encoder.cc` fails with error 577 when loaded from an external process (Rust `std::process::Command`), preventing CDP from becoming available.

Decision: The kiroku project (`https://github.com/minimo162/kiroku`) uses the same M365 Copilot integration and works in this environment. It uses a fundamentally different architecture:
- **Relay_Agent original**: Rust → tokio-tungstenite WebSocket → Direct CDP → Edge (blocked by VBS)
- **Kiroku**: Rust → HTTP → copilot_server.js (Node.js) → Playwright → chromium.connectOverCDP() → Edge

Playwright's `chromium.connectOverCDP()` connects to an already-running Edge instance differently than our direct `Command::new(edge_path).spawn()` approach. The copilot_server.js also handles Edge lifecycle (detection, launch, port scanning) internally with better compatibility.

Fix:
- Copied `copilot_server.js` from kiroku to `src-tauri/binaries/copilot_server.js`
- Created `copilot_server.rs` module to launch and manage the Node.js copilot server process
- Changed `agent_loop.rs` to use `CopilotServer` (HTTP client) instead of `CdpApiClient(page)` (direct WebSocket)
- Added `copilot_start`, `copilot_stop`, `copilot_status` Tauri commands
- Added copilot server auto-start when agent loop begins via `ensure_copilot_server()`
- Existing direct CDP commands (`connect_cdp`, `cdp_send_prompt`, etc.) are preserved for manual UI use

Architecture:
```
┌─────────────────┐
│   UI (Frontend) │
└────────┬────────┘
         │
┌────────▼──────────────────────────────────────┐
│  Tauri / Rust Backend                         │
│  ┌────────────────────┐  ┌──────────────────┐ │
│  │  copilot_server.rs │  │  cdp_copilot.rs  │ │
│  │  (HTTP → Node.js)  │  │  (WebSocket CDP) │ │
│  └────────┬───────────┘  └────────┬─────────┘ │
│           │                       │            │
│  ┌────────▼───────────┐  ┌────────▼─────────┐ │
│  │  agent_loop.rs     │  │  cdp_send_prompt │ │
│  │  (CopilotServer)   │  │  (manual use)    │ │
│  └────────────────────┘  └──────────────────┘ │
└────────────────────────┬──────────────────────┘
                         │
┌────────────────────────▼──────────────────────┐
│  copilot_server.js (Node.js, port 18080)       │
│  ┌──────────────────────────────────────────┐  │
│  │  Playwright chromium.connectOverCDP()    │  │
│  │  ↓                                       │  │
│  │  Edge (CDP port 9333)                    │  │
│  │  ↓                                       │  │
│  │  M365 Copilot (m365.cloud.microsoft/chat)│  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Endpoints:                                    │
│  GET  /health                                  │
│  GET  /status                                  │
│  POST /v1/chat/completions (OpenAI-compatible) │
└────────────────────────────────────────────────┘
```

Files: `copilot_server.rs` (new), `agent_loop.rs`, `tauri_bridge.rs`, `lib.rs`, `binaries/copilot_server.js`
Commit: `0471218`

## Remaining Issues

- **Edge detection in copilot_server.js**: Only supports Windows (`process.platform !== "win32"` returns `null`). macOS/Linux support could be added via a new `--edge-path` CLI flag from the Rust wrapper.
- **Two tabs (`about:blank` + Copilot)**: Direct CDP codebase still has this issue (preserved for potential manual use). The copilot_server.js handles this internally via Playwright's browser context management.
- **Playwright browser install**: `pnpm exec playwright install chromium` may be needed on fresh machines before copilot_server.js can launch Edge.
- **copilot_server.js dependencies**: Requires `playwright` npm package already installed (currently in devDependencies).

## Key Code Locations

| Component | File |
|-----------|------|
| Agent loop entry (via CopilotServer) | `apps/desktop/src-tauri/src/agent_loop.rs:run_agent_loop_impl()` |
| Copilot server Rust wrapper | `apps/desktop/src-tauri/src/copilot_server.rs` |
| Copilot server JS (Playwright) | `apps/desktop/src-tauri/binaries/copilot_server.js` |
| Copilot server Tauri commands | `apps/desktop/src-tauri/src/tauri_bridge.rs:copilot_*` |
| Direct CDP (manual use) | `apps/desktop/src-tauri/src/cdp_copilot.rs` |
| Direct CDP Tauri commands | `apps/desktop/src-tauri/src/tauri_bridge.rs:connect_cdp`, `cdp_send_prompt` |
| Tauri command registration | `apps/desktop/src-tauri/src/lib.rs:run()` |
| Session management | `apps/desktop/src-tauri/src/tauri_bridge.rs:CdpSessionState`, `COPILOT_SERVER` |
| Edge launch (direct CDP) | `apps/desktop/src-tauri/src/cdp_copilot.rs:launch_dedicated_edge()` |
