# Relay Agent

An AI-powered desktop application powered by Amazon Nova 3, built with Tauri v2, SolidJS, and Rust.

## Overview

Relay Agent bridges a Tauri desktop application with a remote AI agent backend. You describe a goal, the agent works autonomously, and you approve or reject actions that need your input — all from a beautiful native desktop UI.

## Stack

- **Desktop UI:** SolidJS + Vite (TypeScript)
- **Desktop Framework:** Tauri v2 (Rust backend)
- **AI Backend:** Amazon Nova 3 via Copilot Proxy (`api.copilot-proxy.ai`)
- **Language:** Rust + TypeScript
- **Testing:** Vitest (frontend crate tests), Cargo (Rust unit tests)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Desktop App                              │
│  ┌───────────────────────────────────────────┐  │
│  │  SolidJS Frontend (src/)                  │  │
│  │  - Message feed with text & tool calls    │  │
│  │  - Approval overlay for tool permissions  │  │
│  │  - Session sidebar & context panel        │  │
│  │  - Real-time IPC event listeners          │  │
│  └──────────────┬────────────────────────────┘  │
│                 │ Tauri invoke/listen           │
│  ┌──────────────▼────────────────────────────┐  │
│  │  Rust Backend (src-tauri/)                │  │
│  │  - tauri_bridge.rs (IPC commands)         │  │
│  │  - copilot_client.rs (AI API client)      │  │
│  │  - models.rs (shared types)               │  │
│  │                                           │  │
│  │  Internal Crates:                         │  │
│  │  - api/        – Copilot API (SSE stream) │  │
│  │  - runtime/    – Session management       │  │
│  │  - tools/      – Tool registry (bash, read, write, edit)     │  │
│  │  - commands/   – Slash commands (/compact, /help, etc.)    │  │
│  │  - compat/     – Manifest extraction      │  │
│  └──────────────┬────────────────────────────┘  │
└─────────────────┼───────────────────────────────┘
                  │ HTTPS
                  ▼
        ┌───────────────────┐
        │ Copilot Proxy API │
        │ (Amazon Nova 3)   │
        └───────────────────┘
```

## Quick Start

### Prerequisites

- **Rust** 1.80+ (with `rustc` and `cargo`)
- **Node.js** 20+ (with `npm` or `pnpm`)

### Setup

```bash
# Clone the repository
git clone https://github.com/minimo162/Relay_Agent.git
cd Relay_Agent

# Install Node dependencies
npm install

# Run in development mode
npm run dev
```

This launches the Tauri dev environment with hot-reloading for both the SolidJS frontend and Rust backend.

## Project Structure

```
apps/desktop/
├── src/                          # SolidJS frontend
│   ├── index.tsx                 # Entry point
│   ├── root.tsx                  # Main shell (3-pane layout)
│   ├── lib/
│   │   ├── ipc.ts                # Tauri IPC bridge + event types
│   │   └── tauri-mock-*.ts       # Mocks for browser development
│   └── components/
│       └── ui.tsx                # Reusable UI components
│
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                # Tauri app entry + auth setup
│   │   ├── tauri_bridge.rs       # IPC commands (start/respond/cancel/history)
│   │   ├── copilot_client.rs     # Copilot Proxy API client
│   │   └── models.rs             # Shared Rust types
│   └── crates/
│       ├── api/                  # Low-level Copilot API (SSE parsing, OAuth)
│       ├── runtime/              # Session management (compact, bootstrap, config)
│       ├── tools/                # Tool registry (bash, read, write, edit)
│       ├── commands/             # Slash command handling
│       └── compat-harness/       # Upstream manifest extraction
```

## Features

### ✅ Implemented

- **AI Agent Loop** — Send a goal → agent processes autonomously → returns results with tool call details
- **Tool Approval System** — Approve or reject individual tool executions in real-time
- **Session Management** — Multiple concurrent agent sessions with side-panel navigation
- **Session History** — Full message history with text and tool call/result blocks (loaded from Rust storage)
- **Agent Cancellation** — Stop a running agent mid-execution
- **Real-time Events** — Tool start, tool result, approval needed, turn complete, and error events via Tauri event system
- **3-Pane Desktop Layout** — Sidebar (sessions), Main (chat + composer), Right panel (context tabs)
- **OAuth Token Resolution** — Reads auth token from `.auth_key`, `.agent_auth_key`, or falls back to direct token
- **Session Compaction** — Compresses long sessions into resumable system summaries
- **Mock System** — Tauri API mocks allow full frontend development in the browser without Tauri running

### 🚧 Planned

- **MCP Server Integration** — Tool registry and MCP server connection (types defined, types defined, basic MCP client implemented, not yet wired into runtime)
- **Slash Commands** — 22 slash commands parsed (`/help`, `/compact`, `/model`, `/export`, etc.) but /compact is fully implemented, others are scaffolding
- **Context System** — File drop, MCP server list, and policy tabs in the right panel (UI exists, data not populated)
- **Browser Automation** — Browser automation settings in request type (CDP port, auto-launch, timeout) — not implemented on backend
- **Conversation Export** — Export conversation to markdown (stub — `export_conversation_markdown` returns empty string)

## IPC API

### Tauri Commands (Rust → Frontend)

| Command | Description |
|---------|-------------|
| `start_agent` | Start a new agent session with a goal, optional files, and cwd |
| `respond_approval` | Approve or reject a pending tool execution |
| `cancel_agent` | Cancel a running agent session |
| `get_session_history` | Load full message history for a session |

### Tauri Events (Rust → Frontend)

| Event | Payload |
|-------|---------|
| `agent:tool_start` | Tool execution started (sessionId, toolUseId, toolName) |
| `agent:tool_result` | Tool execution completed (content, isError) |
| `agent:approval_needed` | User approval required (toolName, description, target, input) |
| `agent:turn_complete` | Agent turn finished (stopReason, assistantMessage, messageCount) |
| `agent:error` | Error occurred in agent loop (error message, cancelled flag) |

## Development

### Running the Desktop App

```bash
# Development mode (hot-reload, opens native window)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

### Rust Crate Tests

```bash
cargo test --package tools
cargo test --package commands
cargo test --package compat-harness -- --ignored
```

### Frontend Tests

```bash
npx vitest run
```

## Environment

- **Copilot Proxy:** Configured via `.env` (`COPILOT_PROXY_BASE_URL`, defaults to `https://api.copilot-proxy.ai/v1`)
- **Auth Token:** `.auth_key` or `.agent_auth_key` in project root, or provided directly
- **Model:** Amazon Nova 3 (`amazon.nova-3`)

## License

Relay Agent is licensed under the **[Apache License 2.0](LICENSE)**.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
