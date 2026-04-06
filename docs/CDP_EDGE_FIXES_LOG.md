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

## Remaining Issues

- **Error 577 (VBS)**: Edge launches but CDP may still be unresponsive in some corporate environments. The `--disable-features` flags help but are not guaranteed to work on all policy-managed machines.
- **Two tabs (`about:blank` + Copilot)**: About:blank tab still opens as Edge's startup page. It is not closed because it is the initial tab; it is later replaced by Copilot navigation but may remain open.
- **`disconnect_cdp` cleanup**: Uses `CMDLINE eq *RelayAgentEdgeProfile*` filter which works but is not as precise as tracking the PID directly.

## Key Code Locations

| Component | File |
|-----------|------|
| Auto-connect CDP | `apps/desktop/src-tauri/src/tauri_bridge.rs:ensure_cdp_connected()` |
| Edge launch | `apps/desktop/src-tauri/src/cdp_copilot.rs:launch_dedicated_edge()` |
| WS URL normalization | `apps/desktop/src-tauri/src/cdp_copilot.rs:resolve_ws()`, `resolve_ws_from_port()` |
| Copilot tab creation | `apps/desktop/src-tauri/src/cdp_copilot.rs:connect_copilot_page()` |
| Agent loop entry | `apps/desktop/src-tauri/src/agent_loop.rs:run_agent_loop_impl()` |
