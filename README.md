# Relay Agent

An AI-powered desktop agent application built with Tauri v2, SolidJS, and Rust.

## Overview

Relay Agent bridges a Tauri desktop application with an AI agent backend. You describe a goal, the agent works autonomously, and you approve or reject actions in real-time — all from a native desktop UI. Supports both **Copilot Proxy API** (Anthropic-compatible backends) and **M365 Copilot via CDP** (browser automation).

## Stack

- **Desktop UI:** SolidJS + Vite (TypeScript)
- **Desktop Framework:** Tauri v2 (Rust backend)
- **AI Backend:** Anthropic Messages-compatible API via Copilot Proxy / M365 Copilot (CDP-driven)
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
│  │  │  copilot_client.rs – API client     │  │  │
│  │  │  cdp_copilot.rs    – CDP automation │  │  │
│  │  │  config.rs         – App config     │  │  │
│  │  │  models.rs         – Shared types   │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Internal Crates                    │  │  │
│  │  │  crates/api/       – Copilot API    │  │  │
│  │  │  crates/runtime/   – Session core   │  │  │
│  │  │  crates/tools/     – Tool registry  │  │  │
│  │  │  crates/commands/  – Slash cmds     │  │  │
│  │  │  crates/onyx-concept/ – RAG engine   │  │  │
│  │  │  crates/compat-harness/             │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS / CDP WebSocket
                  ▼
        ┌──────────────┐    ┌────────────────┐
        │ Copilot Proxy│    │ M365 Copilot   │
        │ (SSE stream) │    │ (Edge CDP)     │
        └──────────────┘    └────────────────┘
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
    │   │   ├── copilot_client.rs # Copilot API client + M365 wrapper
    │   │   ├── cdp_copilot.rs    # M365 Copilot via Edge CDP
    │   │   ├── config.rs         # AgentConfig (defaults, limits)
    │   │   └── models.rs         # Shared Rust types
    │   ├── crates/
    │   │   ├── api/              # Low-level Copilot API (SSE, OAuth)
    │   │   ├── runtime/          # Session core, permissions, MCP
    │   │   ├── tools/            # Tool registry definitions
    │   │   ├── commands/         # Slash command handling
    │   │   ├── onyx-concept/     # RAG engine (SQLite FTS5, Context Router, MCP)
    │   │   └── compat-harness/   # Upstream manifest extraction
    │   ├── capabilities/         # Tauri v2 capability files
    │   └── tauri.conf.json       # App configuration
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
- **CDP Browser Automation** — M365 Copilot integration via Chrome DevTools Protocol:
  - Auto-launches dedicated Edge instance (separate user data dir)
  - Free port scanning, screenshot, prompt sending, new chat
  - Streaming detection and response wait logic
- **MCP Server Integration** — Full support for standard MCP servers via stdio transport:
  - Add/remove/list MCP servers with real-time status monitoring
  - Health check command (`mcp_check_server_status`) with live status reporting
  - Tool discovery and capability reporting per server
  - Persistent registry with atomic state management
- **Slash Commands** — Quick actions via the Composer input:
  - `/help` — List all available slash commands
  - `/clear` — Clear the current chat feed
  - `/compact` — Compact the agent session to free context
  - `/status` — Show current session status and state
  - Autocomplete dropdown with keyboard navigation (↑↓/Tab/Enter/Esc)
- **Context Panel Data Binding** — Fully reactive right panel with live data:
  - **Files** — View, add, and remove context files with size info
  - **MCP Servers** — Server status, tool counts, and management UI
  - **Policy** — Permission policies (approve/deny/allow) with colored badges
- **3-Pane Desktop Layout** — Sidebar (sessions), Main (chat + composer), Right panel (context tabs)
- **Auth Token Resolution** — Reads from `.auth_key`, `.agent_auth_key`, or direct token
- **Config System** — Centralized `AgentConfig` with adjustable parameters
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

- **MCP Agent Loop Integration** — MCP server tools called automatically by the agent during execution
- **Expanded Slash Commands** — 22 total commands in `crates/commands/` — wire remaining commands to the UI
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

## Development

### Code Statistics (as of 2026-04-05)

| Language | Files | Code Lines | Description |
|----------|-------|------------|-------------|
| Rust | 47 | 18,384 | Core backend (Tauri + workspace crates) |
| TypeScript | 21 | 2,620 | SolidJS frontend + mocks + E2E tests |
| TSX | 3 | 1,102 | UI components |
| JSON | 18 | 8,297 | Config, capabilities, test data |
| Markdown | 72 | 6,931* | Documentation + verification checklists |
| YAML | 2 | 1,388 | CI/CD workflows |
| **Total** | **179** | **39,991** | Full project |

*Markdown includes embedded code blocks (928 BASH, 1,793 Rust, 2,052 TypeScript, 1,091 Svelte lines)

### Quality Gates

- **Clippy:** 0 warnings (`-D warnings` enforced)
- **Tests:** 13 unit tests passing
- **TypeScript:** `tsc --noEmit` clean
- **E2E:** 19/21 Playwright tests passing (2 require Windows + Edge CDP)
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

## Environment

- **Copilot Proxy:** Configured via `.env` (`COPILOT_PROXY_BASE_URL`, defaults to `https://api.copilot-proxy.ai/v1`)
- **Auth Token:** `.auth_key` or `.agent_auth_key` in project root, or provided directly
- **M365 Copilot (CDP):** Edge auto-launch on free port, configurable timeout (default: 120s)

## License

Relay Agent is licensed under the **[Apache License 2.0](LICENSE)**.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
