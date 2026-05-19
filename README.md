# Relay Agent

Relay Agent is a local **Codex app-server bridge** for Microsoft 365 Copilot:

> Copilot thinks. The bundled app server runs the agent loop. Relay governs
> local execution.

The active product direction is a browser-hosted **Relay Bridge Workbench**
served by a self-contained .NET sidecar. The Workbench talks to Relay's
`/bridge/*` endpoints. Those endpoints supervise a pinned, redistributable
Codex app server and connect it to Relay Core's Copilot-backed provider API.

The old API-Hub-first product, PDF review client, Tauri desktop shell, AionUi
overlay, OpenCode/OpenWork provider paths, and separate mode-based Workbench
are historical implementation inputs only. They are not active release or
fallback paths.

## Architecture

```text
Workbench / task-specific browser tools
  normal browser UI; no Edge CDP automation and no local tool execution code

Relay browser bridge
  launch-token protected /bridge/* HTTP and SSE facade

Bundled Codex app server
  sessions, turns, event stream, transcript continuity, tool loop, approvals

Relay Core provider
  OpenAI-compatible /v1/models and /v1/chat/completions for m365-copilot

M365 Copilot via Edge CDP
  primary reasoning controller; no OpenAI API key is required
```

Relay owns the parts that are unique to this project: the M365 Copilot CDP
provider adapter, local tool validation, approvals, backups, diffs, logs,
support bundles, and user-local storage boundaries.

The direct `/v1` API remains available as the lower-level provider and
developer diagnostic surface. It is not the recommended first-time HTML tool
integration path once the bundled app-server bridge gates are complete.

## Current Bridge Contract

The active bridge surface is:

- `GET /health` for Relay Core readiness;
- `GET /bridge/health` for app-server bridge readiness;
- `POST /bridge/sessions` to create an app-server-backed session;
- `POST /bridge/sessions/{sessionId}/turns` to start a turn;
- `GET /bridge/turns/{turnId}/events` to stream turn events;
- `POST /bridge/turns/{turnId}/cancel` to cancel a turn;
- `GET /v1/models` and `POST /v1/chat/completions` as the app server's
  `m365-copilot` provider.

The bridge implementation currently includes a sidecar supervisor skeleton,
stdio JSONL fixture smoke, browser bridge endpoints, and release guards. The
runtime must not be advertised as fully bundled until the app-server artifact,
license inventory, generated schemas, provider compatibility, tool loop,
approval flow, packaging, and live Copilot E2E gates pass.

## Requirements

Development:

- Node.js 22 or newer
- pnpm 10.x
- .NET SDK 8 or newer

Live Copilot use:

- Microsoft Edge signed in to a Microsoft 365 Copilot-capable account
- no OpenAI API key
- no extra tenant app registration

Tests may use the explicit mock transport only when
`RELAY_ALLOW_MOCK_COPILOT=1` and `RELAY_COPILOT_MOCK_RESPONSE` or
`RELAY_COPILOT_MOCK_RESPONSES_JSON` is set.

## Development

Install dependencies:

```bash
pnpm install
```

Build the Workbench and copy it into the sidecar:

```bash
pnpm build
```

Run the active acceptance gate:

```bash
pnpm check
```

`pnpm check` covers the hard-cut guard, Workbench typecheck/build, sidecar
build/smokes, Codex app-server bridge smoke, Relay Core API smokes, security
smokes, and release inventory/SBOM generation.

Start the local sidecar:

```bash
pnpm dev
```

The sidecar prints a localhost URL with the launch token. Opening that URL
shows Relay Bridge Workbench.

## Packaging

The primary distribution remains the portable package. It does not require
administrator rights:

```bash
pnpm sidecar:portable:linux
pnpm sidecar:portable:windows
```

Windows users download `relay-agent-<version>-win-x64-portable.zip`, extract
it, and double-click the top-level `Relay Agent.exe`. Linux users download
`relay-agent-<version>-linux-x64-portable.tar.gz`, extract it, and run the
top-level `./relay-agent`. `README-FIRST.html` is included as first-run help,
not as the launcher.

Portable package roots are intentionally quiet:

```text
Relay Agent/
  Relay Agent.exe or relay-agent
  README-FIRST.html
  LICENSES/
  app/
```

Implementation files, tools, assets, sidecar binaries, schemas, and bundled
runtime payloads live under `app/`. They should not appear beside the primary
launcher.

The Windows NSIS installer is optional convenience for Start Menu, desktop
shortcut, and uninstall integration:

```bash
pnpm sidecar:installer:windows
pnpm release:inventory
```

Portable packages and the optional installer are designed to run without
administrator rights, UAC elevation, or a personal Windows password. Runtime
state is stored under the current user's local application data directory.

## Boundaries

- M365 Copilot may plan and synthesize; Relay executes local work only through
  validated bridge/tool contracts.
- Browser clients must not implement their own Copilot CDP automation,
  app-server process management, cache/index storage, or workspace policy.
- Mutating local tools require explicit approval, backups, verification, and
  auditable events.
- Shared folders are never used for Relay caches, indexes, logs, or temp
  state.
- Unrestricted shell is not part of the default tool catalog.
