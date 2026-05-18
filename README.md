# Relay Agent

Relay Agent is a local business-agent workbench:

> Copilot thinks. Relay executes local tools safely.

The active product is a browser-hosted local web workbench served by a
self-contained .NET sidecar. The user works from one workspace and one standard
CopilotKit chat. Search, PDF review, Office editing, and code editing are
internal tool capabilities rather than separate visible modes.

## Current Architecture

```text
Browser Workbench
  standard CopilotKit chatbot, file-explorer workspace picker, concise
  readiness, inline tool rendering, and human-in-the-loop approval

.NET Relay Sidecar
  serves the Workbench, exposes the official AG-UI run endpoint,
  validates local tool calls, checks readiness, owns app-local data,
  and gates local execution

M365 Copilot via Edge CDP
  primary reasoning controller for planning, tool choice, and synthesis

Relay local tools
  ripgrep, exact read, OfficeCLI, exact edits, writes, patches, approvals, logs
```

The old Tauri desktop shell, AionUi overlay, and OpenCode/OpenWork provider
paths are historical implementation inputs only. They are not active release or
fallback paths.

## Workbench

The Workbench is intentionally minimal and should feel like a normal chatbot:

- one workspace selected through the OS file explorer;
- one compact CopilotKit chat transcript as the primary surface;
- first-time guidance that explains: choose a folder, type a request, approve
  local mutations before they run;
- small PDF attachment chips for common proofreading and PDF comparison
  requests;
- one chat input and send action;
- concise readiness and run status;
- inline tool summaries and approvals only when relevant;
- support diagnostics collapsed by default with explicit export.

The UI does not expose separate search, PDF, Office, code, model, provider, or
runtime controls. Those are implementation details behind the sidecar and the
generic local tool catalog.

For local PDFs, use the same chat. The PDF starter chips open the OS file
picker, place the selected PDF paths into a draft prompt, and then Relay reads
the exact files through the generic `read` tool. Users can ask for typo checks,
notation checks, or comparison between two PDFs. Image-only PDFs and pages
requiring OCR are reported as limitations rather than inferred content.
For long PDFs, Relay can ask `read` for a page map first, then inspect only
selected `pageStart`/`pageEnd` ranges. For two-PDF comparisons, the prompts and
tool result projection preserve correspondence by mapping both PDFs before
reading matching page ranges, so the comparison does not rely on arbitrary
chunk order.

Normal users do not type workspace paths. Use `変更` / `Change` to choose a
folder from the OS file explorer. Recent workspaces are stored user-locally and
Relay does not write caches, indexes, or picker state into selected/shared
folders.

The Relay chrome around the chat is deliberately compact: the selected
workspace stays close to the chat, duplicate current-workspace history chips
are hidden, and the chat pane is bounded to keep the transcript, tools, and
approvals visible without turning the Workbench into a dashboard. Model-visible
tool names remain close to established local-agent tools such as `glob`,
`grep`, `read`, `edit`, `write`, `apply_patch`, and bounded `bash`; OfficeCLI
is exposed as a documented extension with the same approval and audit rules.

## Sidecar

The sidecar binds to `127.0.0.1` by default and requires a per-run launch token
for state-changing APIs. Agent execution is served through `/agui/relay` using
Microsoft Agent Framework AG-UI hosting. Relay also exposes a small
OpenAI-compatible `/v1/chat/completions` endpoint for local compatibility
checks; it uses the same sidecar Copilot transport rather than the old
Node/Tauri-era bridge.

Readiness checks currently cover:

- ripgrep (`rg`);
- OfficeCLI (`officecli`);
- M365 Copilot CDP configuration.

If a required capability is missing, Relay stops visibly. It does not silently
fall back to a weaker search/edit path.

For installed/live Copilot use, Relay starts or attaches to a user-local
Microsoft Edge profile with remote debugging enabled. Signed-in users should not
need to set `RELAY_COPILOT_CDP_PORT`. Developers may still set
`RELAY_COPILOT_CDP_PORT`, `RELAY_EDGE_PROFILE`, or `RELAY_EDGE_PATH` as explicit
diagnostic overrides.

Tests may use the explicit mock transport only when
`RELAY_ALLOW_MOCK_COPILOT=1` and `RELAY_COPILOT_MOCK_RESPONSE` are set.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 10.x
- .NET SDK 8 or newer
- Edge signed in to Microsoft 365 Copilot for live Copilot checks

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

`pnpm check` is the non-browser acceptance gate. It covers the hard-cut guard,
Workbench typecheck/build, sidecar build/smoke, official AG-UI tool/approval
smokes, ripgrep and Office/PDF read smokes, OfficeCLI semantic registry policy,
security checks, and release inventory generation.

When Microsoft Edge is available on the host, run the browser-level Workbench
UX smoke:

```bash
pnpm workbench:ux-e2e
```

Before a release that changes Copilot CDP selectors, prompt delivery, send
timing, or response extraction, run the signed-in live Copilot E2E with an Edge
remote-debugging session available:

```bash
pnpm workbench:live-copilot-e2e
```

For a fuller live local-work regression that creates a nested project, approves
local mutations, improves existing files after `read`, and renders the generated
HTML in Edge:

```bash
pnpm workbench:live-project-e2e
```

Start the local sidecar:

```bash
pnpm dev
```

The sidecar prints the localhost Workbench URL with the launch token.

## Packaging

The active release workflow publishes the .NET sidecar and static Workbench
assets. The primary distribution is now a portable package: Windows users can
download the zip, extract it anywhere they can write, and open
`Relay Agent.html`, `Relay Agent を起動.cmd`, `Start Relay Agent.cmd`, or
`Relay.Launcher.exe`; Linux users can extract the tarball, open
`Relay Agent.html`, and run `./start-relay-agent.sh` or `./Relay.Launcher`. The Windows
NSIS installer remains available for users who prefer Start Menu shortcuts and
an uninstall entry, but it is not required to use Relay Agent. Tauri NSIS
packaging is no longer the supported release path.

Local publish commands:

```bash
pnpm sidecar:portable:linux
pnpm sidecar:portable:windows

# Optional Windows installer
pnpm sidecar:installer:windows
pnpm release:inventory
```

Portable packages and the optional Windows installer are designed to run without
administrator rights, UAC elevation, or a personal Windows password. Runtime
state is stored under the current user's local application data directory, not
inside the selected work folder or a shared folder.

The release inventory lists active bundled assets and explicitly records that
AionUi, OpenCode/OpenWork, Tauri runtime, and old per-mode runners are excluded
from the active release path.

## Boundaries

- M365 Copilot may plan and synthesize, but Relay executes tools.
- Relay validates every tool argument before execution.
- Office edits go through OfficeCLI and backup/approval.
- Code edits use exact replacements, approved writes, or approved structured
  patches inside the selected workspace.
- Shared folders are never used for Relay caches, indexes, or temp state.
- Unrestricted shell is not part of the default tool catalog.
