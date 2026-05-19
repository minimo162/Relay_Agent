# Codex App Server Compatibility Notes

Date: 2026-05-20

This directory records the protocol contract Relay will use before any
runtime bridge is implemented.

Verified upstream facts from the official Codex app-server README:

- The app server is started through the `codex app-server` command.
- The default supported local transport is `stdio://` JSONL.
- WebSocket transport exists but is experimental and unsupported for
  production use.
- The wire protocol is JSON-RPC 2.0 shaped, but the `jsonrpc` field is omitted.
- A client must send `initialize`, then an `initialized` notification, before
  any other method.
- Conversation state is modeled as `thread` -> `turn` -> `item`.
- `turn/start` returns immediately and progress is streamed through
  notifications such as `turn/started`, `item/*`, and `turn/completed`.
- Protocol schemas are generated for the exact app-server version through
  `codex app-server generate-ts` or `codex app-server generate-json-schema`.

Relay compatibility decisions:

- Relay will keep `/v1/models` and `/v1/chat/completions` as the
  M365-Copilot-backed provider boundary.
- A future browser/app-server bridge must broker browser HTTP/SSE/WebSocket
  requests to app-server stdio. Browser clients must not speak stdio directly.
- A future bundled app-server integration must use a Relay-owned user-local
  home directory. It must not place sessions, config, caches, or logs in a
  selected work area or shared folder.
- Runtime redistribution requires a pinned Codex app-server version, generated
  schemas for that version, Apache-2.0 license/NOTICE inclusion, artifact
  hashes, and package-root inventory coverage.
- Until that pinned app-server bundle exists, Relay releases must not claim
  that the app-server runtime is included.

The JSONL fixtures under `fixtures/` are illustrative contract fixtures for
future bridge tests. They are not generated upstream schemas.
