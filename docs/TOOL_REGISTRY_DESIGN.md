# Tool Registry Design

## Goal

Unify built-in workbook/file tools, browser automation metadata, and optional MCP tools behind one registry so Relay packets, agent-loop execution, and settings UI all read from the same source of truth.

## Core Model

- `ToolRegistration`
  - Stable tool id such as `workbook.inspect`, `file.copy`, or `mcp.server_name.tool_name`
  - Human-facing title and description
  - `phase`: `read` or `write`
  - `requiresApproval`: always `true` for write tools and all MCP tools
  - `source`: `builtin` or `mcp`
  - `enabled`: runtime toggle used by Relay packet generation and invocation guardrails
  - Optional JSON-schema-like `parameterSchema`
  - Optional `mcpServerUrl` for discovered MCP tools

- `ToolRegistry`
  - Registers built-in tools during storage bootstrap
  - Stores MCP server registrations discovered at runtime
  - Lists all tools or tools filtered by phase
  - Returns Relay-packet `ToolDescriptor` views for enabled tools only
  - Invokes built-in tools directly
  - Proxies MCP tool calls through `McpClient`

## Lifecycle

1. App storage boots and creates a `ToolRegistry`.
2. Built-in tool metadata is registered immediately.
3. Browser automation is registered as a built-in read tool and executed through a dedicated desktop command surface.
4. The settings UI can toggle `enabled` on any registered tool.
5. The settings UI can connect to an MCP server and discover tools.
6. Discovered MCP tools are added as `source: "mcp"` and `requiresApproval: true`.
7. Relay packet generation pulls allowed read/write tools from the registry instead of hard-coded lists.
8. Agent-loop read execution resolves tools through the registry, which either executes built-ins or proxies MCP calls.

## MCP Integration

Current MVP transport:

- `sse`/HTTP JSON-RPC is implemented.
- `stdio` is implemented as a reusable line-delimited JSON-RPC session with reconnect-on-disconnect behavior.

Flow:

1. User provides MCP server name and URL in Settings.
2. Frontend calls `connect_mcp_server`.
3. Backend `McpClient` sends `tools/list`.
4. Each discovered tool becomes `mcp.{serverName}.{toolName}` in the registry.
5. When an MCP tool is invoked, backend sends `tools/call` with the raw tool name and arguments.

## Security Model

- Built-in write tools continue to require preview and explicit approval.
- MCP tools are always marked `requiresApproval: true`, even if they are classified as `read`.
- Disabled tools are omitted from Relay packets and rejected on invocation.
- Browser automation executes through a backend desktop command and is surfaced to the UI through the same registry-facing tool id in both the manual send flow and the agent loop.
- Project-scope enforcement remains in the existing approval and execution paths; the tool registry does not bypass those guards.

## Migration Scope

- `generate_relay_packet` now reads allowed tools from the registry.
- `execute_read_actions` now invokes tools through the registry.
- Existing workbook/file preview and write execution helpers remain in place for this milestone.
- Read-tool artifact capture remains explicit in `storage.rs` for known built-in workbook tools.

## Known Limits

- Persisted MCP server configs are restored on startup with best-effort reconnects, but the restore path still reports failures as a generic settings warning rather than a dedicated per-server recovery workflow.
- Browser automation still shells out to the packaged Node/Playwright helper script behind the Rust command surface instead of reimplementing CDP control natively in Rust.
