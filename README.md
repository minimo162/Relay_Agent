# Relay Agent

Relay Agent is a local PDF review tool backed by a self-contained .NET Relay
Core sidecar:

> Copilot thinks. Relay executes local work safely.

The active user-facing surface is a **PDF review HTML client** served by Relay
Core. Users select one or more PDFs in the browser and run page-cited checks
for typos, wording issues, internal consistency, or cross-document consistency.
Relay keeps extraction, staging, diagnostics, and support artifacts under the
current user's local application data directory. It does not write caches,
indexes, or temp files into selected PDFs, shared folders, or work folders.

## Architecture

```text
PDF review HTML client
  file selection, progress, section correspondence, page-cited findings, report export

.NET Relay Core sidecar
  serves the HTML client, owns /v1 APIs, AG-UI /agui/relay, Copilot provider
  readiness, local extraction, user-local storage, support bundles, and release
  packaging

M365 Copilot via Edge CDP
  primary reasoning controller for agent runs and future richer review passes

Relay local tools
  ripgrep, exact read with Office/PDF extraction, OfficeCLI, exact edits,
  writes, apply_patch, bounded bash, approvals, logs, and diagnostics
```

The old Tauri desktop shell, AionUi overlay, OpenCode/OpenWork provider paths,
Codex app-server path, and the generic chatbot Workbench are historical
implementation inputs only. They are not active release or fallback paths.

## PDF Review Client

The default browser client is intentionally narrow and first-time friendly:

- select one or more PDFs with the standard browser file picker;
- start one review;
- let Relay infer the review behavior from the number of selected PDFs;
- inspect the section correspondence table for multi-PDF reviews;
- inspect page-cited findings;
- export a Markdown report;
- cancel long work from the browser;
- keep diagnostics collapsed unless support data is needed.

The client does not expose generic search, Office editing, coding, model,
provider, workspace, or runtime controls. Those remain Relay Core capabilities
behind stable local APIs and AG-UI.

Current PDF support is text-layer based. Image-only or scanned pages are
reported as extraction limitations unless OCR is added in a later release.
Long-document handling is page-aware: Relay builds page maps and findings cite
document IDs, page numbers, anchors, and evidence snippets. Long PDFs are
split by numbered headings, chapter labels, and heading-like lines when
available. If no headings are clear, Relay falls back to bounded page-range
sections and labels that limitation. Multi-PDF comparison preserves
document-to-document correspondence through a section alignment table before
reporting date or amount differences.

## Relay Core API

Relay Core binds to `127.0.0.1` and requires a per-run launch token for local
APIs. Important client-facing endpoints include:

- `GET /health` for app readiness;
- `GET /v1/copilot/session` for Copilot provider state;
- `GET /v1/tools` for the OpenCode-style tool catalog snapshot;
- `POST /v1/workspace/select` for native folder selection where needed;
- `GET /v1/pdf/capabilities`;
- `POST /v1/pdf/review` for browser PDF uploads;
- `POST /v1/pdf/review-paths` for local-path tests and native integrations;
- `GET /v1/pdf/jobs/{jobId}`;
- `GET /v1/pdf/jobs/{jobId}/report.md`;
- `DELETE /v1/pdf/jobs/{jobId}`;
- `POST /api/support-bundle` for explicit redacted support bundles;
- `/agui/relay` for Agent Framework AG-UI runs.

Relay does not expose raw CDP, arbitrary shell, arbitrary OfficeCLI argv, or
unapproved mutation endpoints through the PDF client.

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

Build the PDF client and copy it into the sidecar:

```bash
pnpm build
```

Run the active acceptance gate:

```bash
pnpm check
```

`pnpm check` covers the hard-cut guard, PDF client typecheck/build, sidecar
build/smokes, Relay Core API smokes, AG-UI agent/tool approval smokes, ripgrep
and Office/PDF extraction smokes, OfficeCLI policy, sidecar security checks,
and release inventory/SBOM generation.

Start the local sidecar:

```bash
pnpm dev
```

The sidecar prints the localhost URL with the launch token. Opening that URL
shows the PDF review HTML client.

## Packaging

The primary distribution is the portable package. This is the recommended file
to share with first-time users because it does not require administrator
rights:

```bash
pnpm sidecar:portable:linux
pnpm sidecar:portable:windows
```

Windows users should download `relay-agent-<version>-win-x64.zip`, extract it,
and double-click `Relay Agent.exe`. Linux users extract the tarball and run
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
- Relay validates tool arguments before execution.
- Office edits go through OfficeCLI, backups, approval, and verification.
- Code edits use exact replacements, approved writes, or approved patches.
- Shared folders are never used for Relay caches, indexes, logs, or temp state.
- Unrestricted shell is not part of the default tool catalog.
