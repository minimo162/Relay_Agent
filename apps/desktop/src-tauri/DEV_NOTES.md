# Development Notes

## M365 Copilot CDP Integration

### Architecture
- `src/cdp_copilot.rs` — Lightweight CDP client using tokio-tungstenite
- Connects to running Edge/Chrome via `http://127.0.0.1:9333` (Relay default; see `start-relay-edge-cdp.sh`)
- No Playwright dependency — raw CDP WebSocket protocol

### Tauri Commands
- `connect_cdp` — Connect to browser, find Copilot page
- `cdp_send_prompt` — Send prompt → wait for streaming → return response
- `cdp_start_new_chat` — Navigate to /chat (creates new conversation)
- `cdp_screenshot` — Take PNG screenshot

### How to Use
1. Launch Edge: `pnpm relay:edge` from repo root, or `microsoft-edge --remote-debugging-port=9333 --remote-allow-origins=* …` with `~/RelayAgentEdgeProfile`
2. Sign in to M365 Copilot
3. Frontend calls `connect_cdp()` → then `cdp_send_prompt()`

### E2E Tests
See `tests/m365-copilot-cdp.spec.ts` — Playwright-based CDP tests

### Build
```bash
cd apps/desktop/src-tauri
cargo check
```
