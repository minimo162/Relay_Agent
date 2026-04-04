# Development Notes

## M365 Copilot CDP Integration

### Architecture
- `src/cdp_copilot.rs` — Lightweight CDP client using tokio-tungstenite
- Connects to running Edge/Chrome via `http://127.0.0.1:9222`
- No Playwright dependency — raw CDP WebSocket protocol

### Tauri Commands
- `connect_cdp` — Connect to browser, find Copilot page
- `cdp_send_prompt` — Send prompt → wait for streaming → return response
- `cdp_start_new_chat` — Navigate to /chat (creates new conversation)
- `cdp_screenshot` — Take PNG screenshot

### How to Use
1. Launch Edge/Chrome: `chrome --remote-debugging-port=9222 "https://m365.cloud.microsoft/chat"`
2. Sign in to M365 Copilot
3. Frontend calls `connect_cdp()` → then `cdp_send_prompt()`

### E2E Tests
See `tests/m365-copilot-cdp.spec.ts` — Playwright-based CDP tests

### Build
```bash
cd apps/desktop/src-tauri
cargo check
```
