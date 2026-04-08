# Relay Agent

An AI-powered desktop agent application built with Tauri v2, SolidJS, and Rust.

## Overview

Relay Agent bridges a Tauri desktop application with an AI agent backend. You describe a goal, the agent works autonomously, and you approve or reject actions in real-time — all from a native desktop UI. Uses **M365 Copilot via CDP** (browser automation through Edge).

## Stack

- **Desktop UI:** SolidJS + Vite (TypeScript)
- **Desktop Framework:** Tauri v2 (Rust backend)
- **AI Backend:** M365 Copilot (CDP-driven via Edge browser automation)
- **Language:** Rust + TypeScript
- **Package Manager:** pnpm (monorepo)
- **Testing:** Vitest (frontend tests), Cargo (Rust tests), Playwright (E2E)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Desktop App                              │
│  ┌───────────────────────────────────────────┐  │
│  │  SolidJS Frontend (src/)                  │  │
│  │  - Message feed with text & tool calls    │  │
│  │  - Real-time streaming (text_delta)       │  │
│  │  - Approval overlay for tool permissions  │  │
│  │  - Session sidebar & context panel        │  │
│  │  - Tauri IPC event listeners              │  │
│  └──────────────┬────────────────────────────┘  │
│                 │ Tauri invoke/listen           │
│  ┌──────────────▼────────────────────────────┐  │
│  │  Rust Backend (src-tauri/)                │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Core Modules                       │  │  │
│  │  │  lib.rs            – Tauri setup    │  │  │
│  │  │  tauri_bridge.rs   – IPC commands   │  │  │
│  │  │  agent_loop.rs     – Agent loop     │  │  │
│  │  │  registry.rs       – Session mgmt   │  │  │
│  │  │  cdp_copilot.rs    – CDP automation │  │  │
│  │  │  config.rs         – App config     │  │  │
│  │  │  models.rs         – Shared types   │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Internal Crates                    │  │  │
│  │  │  crates/runtime/   – Session core   │  │  │
│  │  │  crates/tools/     – Tool registry  │  │  │
│  │  │  crates/commands/  – Slash cmds     │  │  │
│  │  │  crates/onyx-concept/ – RAG engine   │  │  │
│  │  │  crates/compat-harness/             │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────┘
                  │ CDP WebSocket
                  ▼
        ┌────────────────┐
        │ M365 Copilot   │
        │ (Edge CDP)     │
        └────────────────┘
```

## Quick Start

### Prerequisites

- **Rust** 1.80+ (with `rustc` and `cargo`)
- **Node.js** 20+ (with `pnpm`)

### Setup

```bash
# Clone the repository
git clone https://github.com/minimo162/Relay_Agent.git
cd Relay_Agent

# Install dependencies
pnpm install

# Run in development mode
npm run dev
```

This launches the Tauri dev environment with hot-reloading for both the SolidJS frontend and Rust backend.

## Project Structure

```
Relay_Agent/
├── Cargo.toml                    # Workspace root
├── package.json                  # Root pnpm workspace config
├── scripts/                      # Linux relay helpers (Edge CDP prestart)
│   ├── relay-copilot-linux.sh
│   └── start-relay-edge-cdp.sh
│
└── apps/desktop/
    ├── src/                      # SolidJS frontend
    │   ├── index.tsx             # Entry point
    │   ├── root.tsx              # Main shell (3-pane layout)
    │   ├── index.css             # Global styles
    │   ├── components/ui.tsx     # Reusable UI components
    │   ├── lib/
    │   │   ├── ipc.ts            # Tauri IPC bridge + event types
    │   │   └── tauri-mock-*.ts   # Mocks for browser development
    │   └── tests/                # E2E tests (Playwright)
    │
    ├── src-tauri/
    │   ├── src/
    │   │   ├── lib.rs            # Tauri app entry + setup
    │   │   ├── tauri_bridge.rs   # IPC commands (8 commands)
    │   │   ├── agent_loop.rs     # Agent execution loop
    │   │   ├── registry.rs       # Session registry (TTL cleanup)
    │   │   ├── cdp_copilot.rs    # M365 Copilot via Edge CDP
    │   │   ├── config.rs         # AgentConfig (defaults, limits)
    │   │   └── models.rs         # Shared Rust types
    │   ├── crates/
    │   │   ├── runtime/          # Session core, permissions, MCP
    │   │   ├── tools/            # Tool registry definitions
    │   │   ├── commands/         # Slash command handling
    │   │   ├── onyx-concept/     # RAG engine (SQLite FTS5, Context Router, MCP)
    │   │   └── compat-harness/   # Upstream manifest extraction
    │   ├── capabilities/         # Tauri v2 capability files
    │   ├── binaries/
    │   │   └── copilot_server.js # M365 Copilot bridge (pure CDP; DOM + network extract)
    │   ├── liteparse-runner/     # Node + @llamaindex/liteparse (PDF text for read_file)
    │   └── tauri.conf.json       # App configuration
    │
    ├── scripts/                  # Desktop dev helpers (Playwright, CDP, bundled Node fetch)
    │   ├── fetch-bundled-node.mjs   # Populates src-tauri/binaries/relay-node-* for tauri build
    │   └── inspect-copilot-dom.mjs  # Dump M365 chat DOM hints over CDP
    │
    └── tests/                    # E2E tests (Playwright)
        ├── app.e2e.spec.ts       # Core UI + agent flow tests
        ├── mock-tauri.ts         # Tauri API mock for browser
        ├── tauri-mock-core.ts    # IPC invoke mock
        └── tauri-mock-event.ts   # Event listen/emit mock
```

## Features

### ✅ Implemented

- **AI Agent Loop** — Send a goal → agent processes autonomously → returns results with tool call details
- **Real-time Streaming** — `agent:text_delta` events for live text output as the agent generates it
- **Tool Approval System** — Approve or reject individual tool executions in real-time
- **Session Management** — Multiple concurrent agent sessions (default: 4) with semaphore-based concurrency control
- **Session History** — Full message history with text and tool call/result blocks
- **Session Compaction** — Compresses long sessions into resumable system summaries (configurable thresholds)
- **Agent Cancellation** — Stop a running agent mid-execution
- **CDP Browser Automation** — Sole AI backend: M365 Copilot via Chrome DevTools Protocol:
  - Auto-launches dedicated Edge instance (separate user data dir)
  - Free port scanning, screenshot, prompt sending, new chat
  - Streaming detection and response wait logic (hot path uses one `Runtime.evaluate` for “generating” + reply text to halve CDP round-trips)
  - Agent loop sends conversation context as text prompts, receives complete responses
  - **`copilot_server.js`** (under `apps/desktop/src-tauri/binaries/`) implements DOM extraction with a **single source of truth**: `copilotDomGeneratingIifeExpression()` and `copilotDomReplyExtractIifeExpression()` build the in-page scripts; `isCopilotGenerating`, `extractAssistantReplyText`, and `pollCopilotGeneratingAndReply` all reuse them. M365 Copilot Web (Fluent) replies are read preferentially from **`[data-testid="copilot-message-reply-div"]`**, with user bubbles excluded via **`fai-UserMessage`** / **`chatQuestion`** heuristics; `stripM365CopilotReplyChrome` removes “Copilot said:” UI chrome from text.
  - **Composer paste:** `waitForComposerPasteSettle` polls visible length until `pasteLooksComplete` (with a short deadline) instead of a single long fixed sleep after kiroku / `execCommand` / CDP insert paths. **Submit:** `getComposerLenAndCopilotGenerating` returns composer length and the generating scan in one `evaluate` after send clicks.
- **PDF reading (`read_file`)** — Text-layer PDFs are parsed with **LiteParse** (spatial text, **OCR off**) via **Node**. For desktop development from `apps/desktop`, run `pnpm run prep:liteparse-runner` once so `src-tauri/liteparse-runner/node_modules` exists; `pnpm tauri build` runs this automatically in `beforeBuildCommand`. Release bundles include a **target-specific Node** sidecar (`relay-node`) fetched by `scripts/fetch-bundled-node.mjs`.
- **MCP Server Integration** — Full support for standard MCP servers via stdio transport:
  - Add/remove/list MCP servers with real-time status monitoring
  - Health check command (`mcp_check_server_status`) with live status reporting
  - Tool discovery and capability reporting per server
  - Persistent registry with atomic state management
- **Slash Commands** — Quick actions via the Composer input:
  - `/help` — List all available slash commands
  - `/clear` — Clear the current chat feed (requires `--confirm`)
  - `/compact` — Compact the agent session to free context
  - `/status` — Show current session status (message count, token estimate)
  - `/cost` — Show estimated session token usage
  - `/memory` — Inspect loaded instruction memory files
  - `/config` — Inspect config sections (env, model)
  - `/init` — Generate starter CLAW.md guidance
  - `/diff` — Show git diff for workspace changes
  - `/export` — Export the conversation to JSON
  - `/session` — List or switch managed sessions
  - `/version` — Show CLI version info
  - `/resume` — Resume a saved session
  - Autocomplete dropdown with keyboard navigation (↑↓/Tab/Enter/Esc)
- **MCP Agent Loop Integration** — Agent automatically routes MCP tool calls through `McpServerManager` during execution:
  - Tools discovered from registered MCP servers are available in the tool index
  - MCP tool calls share a single `tokio::runtime::Runtime` via `block_on()` for efficient async bridging
  - MCP results are formatted into human-readable text for the assistant
- **Context Panel Data Binding** — Fully reactive right panel with live data:
  - **Files** — View, add, and remove context files with size info
  - **MCP Servers** — Server status, tool counts, and management UI
  - **Policy** — Permission policies (approve/deny/allow) with colored badges
- **3-Pane Desktop Layout** — Sidebar (sessions), Main (chat + composer), Right panel (context tabs)
- **Auth Token Resolution** — Reads from `.auth_key`, `.agent_auth_key`, or direct token
- **Config System** — Centralized `AgentConfig` with adjustable parameters
- **CDP Session State** — Connected CopilotPage is cached in shared state for reuse across agent loop runs (no reconnection per turn)
- **Shared Tokio Runtime** — MCP tool execution reuses a single `tokio::runtime::Runtime` instead of creating a new one per call
- **POSIX Shell Escaping** — Secure shell argument escaping for bash tool execution
- **Session TTL Cleanup** — Auto-eviction of completed sessions after configurable TTL (default: 30 min)
- **Traced Logging** — Structured logging via `tracing` crate (warn/error levels) instead of raw `eprintln!`
- **Structured Concurrency** — `tokio::task::spawn_blocking` + semaphore-based concurrency limits for agent sessions
- **Panic Safety** — `catch_unwind` wrapper on the agent loop to prevent silent thread death and stuck sessions
- **Session Search** — Sidebar session filtering with live search input
- **CI Pipeline** — GitHub Actions workflow for `cargo check`, `cargo clippy`, and `pnpm typecheck` on every PR/push
- **Onyx RAG Engine** — Internalized RAG architecture replacing external Docker/Vespa dependencies:
  - `DataSource` trait abstraction for pluggable data connectors
  - SQLite FTS5 hybrid search index for fast full-text retrieval
  - Context Router for intelligent query routing and document ranking
  - MCP Server integration for tool-based data access
  - Built-in connectors for file system and git repositories

### 🚧 Planned / Partially Implemented

- **E2E Test Expansion** — Comprehensive coverage for streaming, approval flows, session lifecycle, slash commands (~51 tests)

## IPC API

### Tauri Commands

| Command | Description |
|---------|-------------|
| `start_agent` | Start a new agent session with goal, optional files, cwd, and browser settings |
| `respond_approval` | Approve or reject a pending tool execution |
| `compact_agent_session` | Compress a long session into a resumable summary |
| `cancel_agent` | Cancel a running agent session |
| `get_session_history` | Load full message history for a session |
| `connect_cdp` | Connect to M365 Copilot via CDP |
| `cdp_send_prompt` | Send a prompt to M365 Copilot |
| `cdp_start_new_chat` | Start a new chat in M365 Copilot |
| `cdp_screenshot` | Capture screenshot of the Copilot browser |
| `disconnect_cdp` | Disconnect from the Copilot browser and clean up resources |
| `mcp_list_servers` | List all registered MCP servers with status |
| `mcp_add_server` | Add a new MCP server to the registry |
| `mcp_remove_server` | Remove an MCP server from the registry |
| `mcp_check_server_status` | Check the live health status of a single MCP server |

### Tauri Events (Rust → Frontend)

| Event | Payload |
|-------|---------|
| `agent:tool_start` | Tool execution started (sessionId, toolUseId, toolName) |
| `agent:tool_result` | Tool execution completed (content, isError) |
| `agent:approval_needed` | User approval required (toolName, description, target, input) |
| `agent:turn_complete` | Agent turn finished (stopReason, assistantMessage) |
| `agent:text_delta` | Streaming text output (text content, sessionId) |
| `agent:error` | Error occurred (error message, cancelled flag) |

## Configuration

Application-level defaults in `config.rs`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_turns` | 16 | Maximum agent turns per session |
| `max_tokens` | 32,000 | Max output tokens per API call |
| `compact_preserve_recent` | 2 | Messages to keep during compaction |
| `compact_max_tokens` | 4,000 | Token threshold for triggering compaction |
| `max_concurrent_sessions` | 4 | Max simultaneous agent sessions |
| `session_cleanup_ttl_minutes` | 30 | TTL for session cleanup |

### Runtime and workspace files (`.claw`)

The Rust `runtime` crate loads **Claw-style** settings and merges **workspace instructions** into the system prompt. Paths use **`.claw`** only (not `.claude`).

| Location | Role |
|----------|------|
| `CLAW_CONFIG_HOME` | Optional override for the user config directory (default: `$HOME/.claw`, or a relative `.claw` directory if `HOME` is unset) |
| `~/.claw/settings.json` | User-level settings |
| `~/.claw.json` | Optional legacy JSON next to the home directory (same merge rules as before; invalid JSON is skipped) |
| `<project>/.claw.json` | Project-level settings |
| `<project>/.claw/settings.json` | Project settings |
| `<project>/.claw/settings.local.json` | Machine-local project overrides |
| `CLAW.md` / `CLAW.local.md` | Per-directory instruction files (ancestor chain from session `cwd`) |
| `<dir>/.claw/CLAW.md` / `instructions.md` | Nested instruction files under `.claw` |
| `~/.relay-agent/SYSTEM_PROMPT.md` | Optional full system prompt override for the desktop agent (`{goal}` placeholder supported) |

OAuth credential storage uses the same config home as `CLAW_CONFIG_HOME` / `~/.claw`.

## Development

### Code Statistics (as of 2026-04-06)

| Language | Files | Code Lines | Description |
|----------|-------|------------|-------------|
| Rust | 47 | 20,804 | Core backend (Tauri + workspace crates) |
| TypeScript + TSX | 26 | 5,289 | SolidJS frontend + mocks + E2E tests |
| JSON | 24 | 9,362 | Config, capabilities, test data |
| Markdown | 80 | 21,821* | Documentation + verification checklists |
| YAML | 2 | 2,067 | CI/CD workflows |
| CSS/HTML | — | 376 | Styling |
| **Total** | **179** | **59,719** | Full project |

*Markdown includes embedded code blocks from plans and verification documents

### Quality Gates

- **Clippy:** 0 warnings (`-D warnings` enforced)
- **Tests:** 26 passed; 1 known failure (skill local prompt test)
- **TypeScript:** `tsc --noEmit` clean
- **E2E:** 72 tests across 11 spec files (mix of mock-based and CDP-dependent)
- **CI:** GitHub Actions (cargo check, cargo clippy, pnpm typecheck)

### Desktop App

```bash
# Development mode (hot-reload)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

### Rust Tests

```bash
cargo test --package tools
cargo test --package commands
cargo test --package compat-harness -- --ignored
```

### Frontend Tests

```bash
npx vitest run
```

### E2E Tests (Playwright)

```bash
npx playwright test
```

### Inspect M365 Copilot DOM over CDP (Playwright)

**Reminder (このリポ／開発環境):** `connectOverCDP` や下記スモークは、**既に M365 にサインイン済みの Edge**（Relay 用プロファイル例: `~/RelayAgentEdgeProfile`、CDP 既定: **9360**；旧環境や手動は **9333** も可）に繋ぐ前提です。未ログインだとログイン画面だけが取れ、DOM 調査・`m365-cdp-chat` テストは意味がありません。  
**いつでも同じ条件で使う手順**（固定ポート・固定プロファイル・Linux `pnpm relay:edge`・Windows ショートカット例・自動起動のヒント）は [`docs/COPILOT_E2E_CDP_PITFALLS.md` の「Always-on CDP」節](docs/COPILOT_E2E_CDP_PITFALLS.md#always-on-cdp-signed-in-copilot-browser)を参照してください。

Use this when tuning selectors or debugging extract/wait behavior. Start Edge with remote debugging (e.g. port **9360**, or **9333** if you still use that), open **M365 Chat** (signed in), then:

```bash
cd apps/desktop
pnpm inspect:copilot-dom
# or: pnpm exec node scripts/inspect-copilot-dom.mjs
# optional CDP URL: CDP_HTTP=http://127.0.0.1:9360 pnpm inspect:copilot-dom
```

From the monorepo root:

```bash
pnpm --filter @relay-agent/desktop inspect:copilot-dom
```

The script connects with Playwright `connectOverCDP`, walks **all frames**, reports `data-testid` hints, per-frame **`copilot-message-reply-div`** counts, plus **`copilotMessageReplyDivTotal`** / **`lastCopilotReplySampleFromBestFrame`** (picks the frame with the most reply nodes). It dumps an **ARIA snapshot** string (`page.ariaSnapshot()` on Playwright 1.59+). Align changes with **`copilot_server.js`** (same reply-div-first strategy).

Authenticated Copilot smoke (Enter / Ctrl+Enter first, same composer selectors as production):

```bash
cd apps/desktop
CDP_ENDPOINT=http://127.0.0.1:9360 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat
```

## Environment

- **M365 Copilot (CDP):** Sole AI backend. Edge auto-launches with isolated profile; runtime CDP port may be **OS-assigned** (`DevToolsActivePort`) or chosen in a scan range and recorded in **`.relay-agent-cdp-port`** under `~/RelayAgentEdgeProfile`. **Relay 既定 CDP は 9360**（YakuLingo 等の **9333** と衝突回避）。`CDP_ENDPOINT` / `RELAY_EDGE_CDP_PORT` / `pnpm relay:edge` で上書き可。`start-relay-edge-cdp.sh` は **`DevToolsActivePort` が生きていれば**（例: 既存 Edge が 9333）**二重起動しない**。Tauri **attach 系 IPC**はマーカー／`DevToolsActivePort` を優先し、無ければ **9360** にフォールバック。Configurable timeout (default: 120s). Login via browser UI on first use. **手動で CDP に繋ぐ検証**は、その Edge プロファイルで **M365 にサインイン済み**であることが前提（セッション切れ時はブラウザで再ログイン）。
- **`RELAY_COPILOT_DEBUG_POLL=1`:** When set, `copilot_server.js` logs a `[copilot:response] poll` diagnostic every ~10s during `waitForDomResponse` (off by default to reduce noise).

### Linux / ヘッドレス（Copilot 接続の進め方）

1. **Microsoft Edge for Linux** を入れる（`microsoft-edge-stable` が `PATH` にあること）。
2. **`DISPLAY` が必要** — Edge はウィンドウを開きます。Xvfb + 軽量 WM なら例: `export DISPLAY=:1`（先に Xvfb / fluxbox を起動）。
3. **専用プロファイル** `~/RelayAgentEdgeProfile` — アプリと同梱の `copilot_server.js` がここで Edge を起動します。**noVNC 用 Chromium の `~/chrome-m365-profile` とは別**です。初回はこの Edge で **M365 にサインイン**してください。
4. 開発起動の補助: リポジトリ直下で  
   `chmod +x scripts/relay-copilot-linux.sh && ./scripts/relay-copilot-linux.sh`  
   （`$HOME/novnc-m365/start-x11-desktop.sh` があれば `DISPLAY` 未設定時に自動実行します。パスは `RELAY_START_X11` で変更可）  
   既定で **`scripts/start-relay-edge-cdp.sh`** により Edge（CDP 既定 **9360**）を先起動します。無効化: `RELAY_PRESTART_EDGE=0`  
   手動だけ先に Edge を立てる場合: `pnpm relay:edge`（`DISPLAY` 必須）  
   **`apps/desktop` で `pnpm tauri:dev` だけ** でも、Unix では同じ先起動スクリプトが自動実行されます（`RELAY_SKIP_PRESTART_EDGE=1` で省略。Windows は手動 Edge 起動の案内のみ）。
5. **Relay 用 Edge を noVNC で表示**する（Chromium 版 noVNC とは別）:  
   `~/novnc-m365/start-novnc-relay.sh`  
   同じ **~/RelayAgentEdgeProfile** と **CDP（既定 9360、スクリプトに合わせる）** で起動するため、アプリ／`copilot_server` と画面が一致します。

## License

Relay Agent is licensed under the **[Apache License 2.0](LICENSE)**.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
