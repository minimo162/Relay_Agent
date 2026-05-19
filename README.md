# Relay Agent

Relay Agent is a local **HTML tool API hub** for Microsoft 365 Copilot:

> Copilot thinks. Relay exposes a local API and executes local work safely.

The active user-facing surface is the browser-hosted **Relay API Hub** served by
a self-contained .NET Relay Core sidecar. The hub is intentionally simple for
first-time users: start Relay Agent, confirm it is Ready, copy or download the
starter HTML, and connect any local HTML tool to Relay's localhost API.

The retired PDF review client is no longer the active product surface. PDF,
Office, file search, coding, and other workflows should now be built as thin
HTML tools over the same Relay Core APIs instead of becoming separate Relay
Workbench modes.

## Architecture

```text
Any local HTML tool
  lightweight UI, task-specific controls, no Copilot CDP or local execution code

Relay API Hub
  first-run guidance, API manifest, starter HTML, test prompt, diagnostics

.NET Relay Core sidecar
  localhost OpenAI-compatible API, M365 Copilot CDP adapter, token/CORS
  boundaries, support bundles, and user-local storage

M365 Copilot via Edge CDP
  primary reasoning controller; no OpenAI API key is required
```

The old Tauri desktop shell, AionUi overlay, OpenCode/OpenWork provider paths,
Codex app-server path, generic chatbot Workbench, and PDF review client are
historical implementation inputs only. They are not active release or fallback
paths.

## Relay Core API

Relay Core binds to `127.0.0.1` and requires a per-run launch token. HTML tools
can discover the current contract through:

- `GET /health` for readiness;
- `GET /v1/relay/manifest` for endpoint, auth, and CORS discovery;
- `GET /v1/copilot/session` for Copilot provider state;
- `GET /v1/models` and `GET /v1/models/{model}` for model discovery;
- `POST /v1/chat/completions` for an OpenAI-compatible chat shape backed by
  M365 Copilot;
- `POST /api/support-bundle` for explicit redacted diagnostics bundles.

Local HTML files are supported through a narrow CORS policy for `null`,
`localhost`, and `127.0.0.1` origins. The launch token must be supplied either
as `?token=...`, `X-Relay-Token`, or `Authorization: Bearer ...`.

Relay does not execute client-side tools. When an HTML app uses OpenAI function
tools, Relay returns normal OpenAI-compatible `tool_calls`; the HTML app owns
tool execution, approvals, and follow-up tool messages.

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
`RELAY_ALLOW_MOCK_COPILOT=1` and `RELAY_COPILOT_MOCK_RESPONSE` are set.

## Development

Install dependencies:

```bash
pnpm install
```

Build the API Hub and copy it into the sidecar:

```bash
pnpm build
```

Run the active acceptance gate:

```bash
pnpm check
```

`pnpm check` covers the hard-cut guard, API Hub typecheck/build, sidecar
build/smokes, Relay Core API smokes, sidecar security checks, and release
inventory/SBOM generation.

Start the local sidecar:

```bash
pnpm dev
```

The sidecar prints the localhost URL with the launch token. Opening that URL
shows Relay API Hub.

## Packaging

The primary distribution is the portable package. It does not require
administrator rights:

```bash
pnpm sidecar:portable:linux
pnpm sidecar:portable:windows
```

Windows users download `relay-agent-<version>-win-x64.zip`, extract it, and
double-click `Relay Agent.exe`. Linux users extract the tarball and run
`./relay-agent`. `README-FIRST.html` is included as first-run help, not as the
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

- M365 Copilot may plan and synthesize; Relay executes local work.
- HTML tools are thin clients. They must not implement their own Copilot CDP,
  local execution, approval harness, or workspace policy.
- Relay validates tool arguments before execution.
- Office edits go through OfficeCLI, backups, approval, and verification.
- Code edits use exact replacements, approved writes, or approved patches.
- Shared folders are never used for Relay caches, indexes, logs, or temp state.
- Unrestricted shell is not part of the default tool catalog.
