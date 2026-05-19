# Relay_Agent Execution Tasks

Date: 2026-05-18

## Current Review Correction

The active direction is the bundled Codex app-server mediation architecture,
not the temporary Agent-Framework-only correction. The current implementation
contains the right early bridge skeleton but still has gaps:

- `CodexAppServerBridgeService`, `/bridge/*`, the fixture app server, and
  `sidecar:app-server-bridge-smoke` exist and should remain active;
- the default browser UI now uses `/bridge/*` instead of calling
  `/v1/chat/completions` directly for normal work;
- the bridge is backed by a pinned redistributable app-server runtime artifact
  manifest and release fetch/package path;
- provider compatibility, generated schemas, upstream app-server tool protocol
  compatibility, broader live E2E, and release-claim hardening are still
  incomplete.

The next active queue is `BRIDGEMAIN*`. It turns the broader `BRIDGEGAP*`
roadmap into the immediate implementation path for making Codex app server the
real primary runtime. `AFAGUI*` was a mistaken correction and must not be
introduced.

## Active Goal

Move Relay to one bundled app-server product path:

```text
Workbench and task-specific HTML tools
  normal chatbot/browser UI, no direct Copilot CDP automation

Relay browser/app-server bridge
  token-protected loopback HTTP/SSE facade for browser clients

Bundled Codex app server
  sessions, turns, items, event stream, tool loop, transcript continuity

Relay Core `/v1` provider
  OpenAI-compatible /v1/responses m365-copilot provider backed by Edge CDP

M365 Copilot over Edge CDP
  primary reasoning controller; no OpenAI API key

Codex app-server native local tool loop
  app-server-owned read/write/search/Office-adjacent/PDF-adjacent/coding work;
  Relay only supervises, forwards approvals, stages attachments, and logs
```

The direct `/v1/responses` API is the lower-level provider API consumed by the
bundled app server. `/v1/chat/completions` remains a developer diagnostic
compatibility endpoint only. Neither path is the primary user-facing HTML tool
path once the bridge is complete. File search, Office
editing, coding, PDF review, and verification are handled by the bundled app
server's native harness, not first-party Relay modes or Relay-owned tool
workers.

The previous public Relay runner surfaces are retired for the active product
path. `/agui/relay`, `/v1/tools`, and `/api/tool-catalog` must not be used as
Workbench runtime, user-facing integration, or acceptance-gate dependencies.
Relay must not implement a replacement local execution worker behind the Codex
app-server bridge. Custom dynamic tools are rejected unless a future plan
explicitly adopts an upstream-compatible MCP/dynamic-tool package.

The completed active queue is `RESPONSIVE*`. It implements the 2026-05-18
Installed Workbench Responsiveness Plan from `PLANS.md`: make installed
Workbench first paint and readiness reflection faster, make readiness
auto-refresh after Copilot connects, and make workspace folder selection
visibly recoverable.

The completed active queue is `LIFECYCLE*`. It implements the 2026-05-18
Browser Session Lifecycle And Installer Lock Plan from `PLANS.md`: make the
browser-launched sidecar shut down after the last Workbench tab closes, while
keeping development/test sidecars stable unless idle-exit is explicitly
enabled.

The completed active queue is `INSTALLLOCK*`. It implements the 2026-05-18
User-Scope Installer Locked-File Remediation Plan from `PLANS.md`: make the
Windows user-scope NSIS installer handle upgrades where `Relay.Sidecar.exe` is
still running or where the previous install lives in the legacy
`%LOCALAPPDATA%\Programs\RelayAgent` directory.

The completed active queues are `DCI2605IR*` and `UXMIN*`.
`DCI2605IR*` incorporates the 2026-05-18 DCI Interface Resolution Follow-up
Plan from `PLANS.md`: increase the resolution of the generic Agent
Framework/OpenCode-compatible corpus interface without reviving a dedicated
search engine. `UXMIN*` implements the 2026-05-18 Minimal Professional
Workbench UX Plan from `PLANS.md`: maximize whitespace, remove nonessential
controls, and make the browser Workbench a single calm AG-UI-first agent
surface instead of a mode picker or diagnostic console.

The completed active queue is `BOOTREADY*`. It implements the 2026-05-18 Installed
App Startup, Icon, And Readiness Remediation Plan from `PLANS.md`: restore the
app icon, remove the installed-app dependency on a manually configured
`RELAY_COPILOT_CDP_PORT`, make Copilot CDP warmup automatic, keep first paint
fast, replace manual workspace path entry with a native folder picker, and show
readiness with minimal user-facing UI.

The completed active queue is `INSTALLUX*`. It implements the 2026-05-18
Installer Defaults, Workspace Picker, And Search Path Contract Plan from
`PLANS.md`: default desktop shortcut and finish-page launch, no Windows
launcher console, modern shared-folder workspace picker, and a reliable
`glob` -> `read` path contract.

The completed active queue is `CKCHAT*`. It implements the 2026-05-18
CopilotKit Chatbot UX Reset Plan from `PLANS.md`: replace the custom Relay
Workbench composer, activity, result, and approval surface with a
CopilotKit-first chatbot backed by the existing AG-UI `/agui/relay`
self-managed agent.

The completed active queue is `CKLAYOUT*`. It implements the 2026-05-18
CopilotKit Chat Layout Density Plan from `PLANS.md`: keep CopilotKit as the
primary chat UI while tightening Relay's surrounding chrome, hiding redundant
current-workspace history, bounding the chat viewport, and adding
layout-density E2E assertions.

The completed active queue is `GENHARNESS*`. It implements the 2026-05-18
OpenCode-Style Generic Harness Reset Plan from `PLANS.md`: remove forced
Relay-owned search heuristics, simplify Copilot projection to OpenCode-style
generic tool loops, keep Office/code as recipes over the same catalog, and
make the Workbench read as a normal CopilotKit/AG-UI chatbot.

The previously active queue `OCLOOP*` is superseded by the PDFHTML/COREAPI
cutover. Its completed harness lessons remain useful, but it should not be
extended as a generic Workbench workstream.

The previously active queue `PORTABLE*` is superseded by the PDFHTML packaging
tasks. Portable-first distribution remains the rule, but the default launch
target changes to the PDF HTML client.

The previously active queue `PDFUX*` is superseded by `PDFHTML*`. PDF review is
no longer a generic Workbench recipe; it is the target default product UI.

The previously active queue `PDFCHUNK*` is superseded by `PDFHTML*`. Its
page-aware and correspondence-preserving requirements remain mandatory inside
Relay Core's PDF review pipeline.

The completed active queue is `STANDARDCHAT*`. It implements the 2026-05-19 Standard
Chatbot UX And Tool Harness Alignment Plan from `PLANS.md`: make the Workbench
read as a first-time-friendly standard chatbot while keeping CopilotKit,
AG-UI, Microsoft Agent Framework approvals, and the OpenCode-compatible local
tool contract as the standard harness surfaces.

The completed active queue is `PORTABLEENTRY*`. It implements the 2026-05-19 Portable
One-Click First-Run Plan from `PLANS.md`: keep the portable package as the
primary distribution, but make the first-run path one obvious launcher
(`Relay Agent.exe` on Windows and `relay-agent` on Linux) while moving HTML to
optional help.

The completed historical queue is `COREAPI*`. It implements the 2026-05-19 Copilot Gateway
And Relay Core API Decoupling Plan from `PLANS.md`: make the .NET sidecar the
stable local agent API boundary for Copilot connectivity, AG-UI runs, local
tools, approvals, workspace policy, diagnostics, and future thin HTML clients,
while keeping browser clients thin rather than runtime owners.

The completed active queue is `PDFHTML*`. It implements the 2026-05-19 PDF Review HTML
Tool And Distributable Relay Core API Plan from `PLANS.md`: retire the current
generic Workbench as the long-term default UI, make a focused HTML client for
one-PDF proofreading and two-PDF consistency comparison, and package Relay Core
so users with a Microsoft 365 Copilot-capable signed-in Edge profile can run it
without admin rights or separate LLM credentials.

The completed active queue is `PDFALIGN*`. It implements the 2026-05-19 PDF Section
Alignment And Simplified UX Plan from `PLANS.md`: remove manual review-type
selection, make PDF count determine the review behavior, split long PDFs by
chapter/heading sections, preserve a section correspondence table for
multi-PDF comparison, and keep the portable package as the primary release
artifact.

The completed historical queue is `HTMLTOOL*`. It superseded the PDFHTML/PDFALIGN
product surface with an API Hub, but that API-Hub-first direction is now
superseded by the bundled Codex app-server bridge direction.

The completed historical queue is `OPENAIAPI*`. It implements the 2026-05-19
OpenAI-Compatible Local API Rules from `PLANS.md`: make the primary product
contract a normal OpenAI-compatible local API backed by M365 Copilot. Any
self-made HTML file, script, or OpenAI-compatible client should be able to
connect by setting `baseURL`, `apiKey`, and `model`, and ordinary
client-managed OpenAI tool calling should work through `/v1/chat/completions`.
Relay-side local tools, `/v1/tools`, and `/agui/relay` are removed from the
target public product contract. That public-product framing is now superseded:
`/v1` remains a lower-level provider/developer diagnostic surface, while the
primary user-facing path becomes Workbench/browser bridge -> bundled app
server -> Relay `/v1` provider.

The completed historical planning/package-root queue is `APPBRIDGE*`. It implements only
the research and release-hardening slice of the 2026-05-20 Codex App Server
Mediation Plan from `PLANS.md`: keep Relay's `/v1` API as the Copilot-backed
provider boundary, record the app-server contract, add protocol fixtures, and
keep portable package roots clean. It does **not** mean the app-server runtime
bridge is shipped. Runtime bridge work continues in `BRIDGEGAP*`: app-server
artifact pinning, sidecar supervision, browser bridge endpoints, chatbot HTML,
native app-server harness verification, attachment staging, approval
roundtrips, packaging inventory, and live Copilot E2E.

Forward implementation should treat `COREAPI*`, `PDFHTML*`, and `PDFALIGN*` as
completed history unless a regression in their shared backend acceptance gates
is found. Older generic Workbench and PDF queues remain historical context.

The completed active queue is `PROJECTIONFIX*`. It implements the 2026-05-18 Tool
Projection Harness Remediation Plan from `PLANS.md`: keep search and Office
editing inside the Agent Framework/AG-UI/OpenCode-compatible generic tool
catalog, prevent hidden retriever/image JSON projection drift, and normalize
natural Office cell-formatting requests into Relay's semantic OfficeCLI
adapter before approval.

The previous `DCI2605*`, `DCIFS*`, and `POSTLIVE*` queues remain completed
history below. They should not be extended unless a regression proves those
acceptance criteria have broken.

## Execution Rules

- Execute tasks in order unless a task explicitly says it can run in parallel.
- Do not add AionUi, OpenCode/OpenWork runtime, Tauri, PDF review mode, or
  API-Hub-first fallback paths.
- Do not remove or bypass the Codex app-server bridge skeleton unless this
  plan is explicitly changed.
- Do not add Relay-side public local-tool endpoints as a new product surface.
  Do not add a Relay-owned model-visible tool catalog behind the bridge either;
  use Codex app-server native tools.
- Do not fix Copilot mistakes by adding broad prompt-only folklore; prefer
  app-server/tool-state constraints, schema validation, and visible recovery.
- Do not create separate first-party modes for file search, Office editing, or
  coding. They are app-server-native workflows.
- Keep `/v1` as a lower-level provider/developer diagnostic path. It should be
  consumed by the bundled app server for normal user-facing work.
- Every completed task must update `docs/IMPLEMENTATION.md` with the artifact
  and verification result.
- Run at least `pnpm check` before marking a milestone complete.
- Do not mark a task complete while the canonical checks still enforce the
  superseded API-Hub-first path.

## Task Queue

### BRIDGENATIVE-01 - Retire Relay-Owned Tool Worker From App-Server Bridge

Status: completed

Scope:

- Remove Relay `RelayToolExecutor` dispatch from `CodexAppServerBridgeService`.
- Stop Relay from executing `glob`, `grep`, `read`, `write`, `patch`,
  OfficeCLI, or custom PDF extraction on behalf of app-server turns.
- Treat official app-server server requests as the only bridge-mediated
  approval surface:
  - `item/commandExecution/requestApproval`;
  - `item/fileChange/requestApproval`;
  - `item/permissions/requestApproval`.
- Send JSON-RPC approval responses back to app-server after the browser
  approves or rejects.
- Reject `item/tool/call` dynamic-tool requests fail-fast so accidental Relay
  custom-tool revival is visible.

Acceptance:

- `CodexAppServerBridgeService` has no `RelayToolExecutor`,
  `RelayToolCall`, or `ToolObservation` dependency.
- `pnpm sidecar:app-server-bridge-smoke` proves command/file approval
  roundtrips and dynamic-tool rejection without writing files from Relay.

### BRIDGENATIVE-02 - Remove OfficeCLI And Custom PDF From Active Release Path

Status: completed

Scope:

- Remove OfficeCLI and custom Office/PDF extraction smokes from `pnpm check`.
- Stop release packaging and inventory from bundling or advertising OfficeCLI.
- Stop `/api/status` from probing Relay-side ripgrep or OfficeCLI readiness.
- Keep old runner files as historical source until a later deletion pass, but
  do not route Workbench, release, or canonical checks through them.

Acceptance:

- `pnpm check` no longer runs `agent:officecli-registry-smoke` or
  `agent:office-pdf-read-smoke`.
- Release package scripts do not copy `relay-tools/officecli`.
- Status readiness reflects Copilot/provider readiness only; app-server health
  is checked through `/bridge/health`.

### BRIDGEMAIN-01 - Pin And Materialize Codex App Server Runtime

Status: completed

Maps to: `BRIDGEGAP-01`, `BRIDGEGAP-13`

Scope:

- Select the exact upstream Codex app-server artifact or source-build input.
- Record:
  - repository/source URL;
  - commit, tag, or release version;
  - platform matrix;
  - build/download command;
  - expected executable name;
  - generated protocol schema version;
  - license and third-party notice files;
  - sha256 hashes.
- Add a Relay-owned artifact manifest, for example
  `tools/codex-app-server/manifest.json`, that release scripts can validate.
- Add a fetch/build script that can populate the expected portable layout under
  `app/app-server` during packaging.
- Keep the fixture app server for deterministic tests, but distinguish it from
  the pinned production artifact.

Acceptance:

- `docs/IMPLEMENTATION.md` records the artifact decision and license evidence.
- Release packaging can verify artifact/schema/license/hash evidence.
- If no redistributable artifact is available, the task must fail with an
  explicit blocker instead of silently falling back to direct `/v1`.

### BRIDGEMAIN-02 - Validate Real App Server Against Relay Provider

Status: completed

Maps to: `BRIDGEGAP-02`

Scope:

- Start the pinned app server against a mock Relay provider.
- Verify provider compatibility for:
  - `GET /v1/models`;
  - `POST /v1/responses`;
  - `Authorization: Bearer <launch token>`;
  - model id `m365-copilot`;
  - normal assistant response;
  - tool-call response;
  - app-server native command execution after a Copilot tool-call response.
- Determine that Chat Completions wire mode is unsupported by the pinned app
  server and switch the generated config to `wire_api = "responses"`.
- Implement `/v1/responses` as the internal provider adapter consumed by the
  app server.

Acceptance:

- `pnpm sidecar:app-server-real-provider-smoke` proves the pinned app server
  can use Relay's mock provider with no OpenAI API key, can receive assistant
  text, and can drive the native app-server command-execution loop.
- The provider mismatch is solved by the `/v1/responses` adapter, not by a
  browser/direct `/v1` fallback.

### BRIDGEMAIN-03 - Generate User-Local App Server Home And Config

Status: completed

Maps to: `BRIDGEGAP-03`

Scope:

- Generate app-server home/config under Relay user-local storage on Windows and
  Linux.
- Write provider config pointing the app server to Relay Core:
  - base URL;
  - launch token or app-server scoped token;
  - `m365-copilot` model id;
  - timeout and request id propagation if supported.
- Prevent unrelated environment OpenAI keys or user shell configuration from
  overriding Relay's bundled provider path.
- Add migration/version markers for app-server state.
- Add cleanup policy for stale sessions, temp files, and exited runtime
  processes.

Acceptance:

- Config smoke proves generated config targets Relay `/v1` and user-local
  storage.
- No app-server config/cache/log/temp files are written into selected work
  folders or shared folders.

### BRIDGEMAIN-04 - Promote Bridge Supervisor From Fixture To Runtime

Status: completed

Maps to: `BRIDGEGAP-04`, `BRIDGEGAP-05`, `BRIDGEGAP-06`, `BRIDGEGAP-07`

Scope:

- Update `CodexAppServerBridgeService` so the default path resolves the pinned
  bundled app server, while tests can still opt into the fixture through an
  explicit environment variable.
- Use generated app-server config/home from `BRIDGEMAIN-03`.
- Validate initialize/initialized against the pinned protocol schema where
  practical.
- Harden startup, shutdown, cancellation, timeout, stderr capture, JSONL parse
  errors, protocol mismatch, and backpressure handling.
- Make `/bridge/health` distinguish:
  - artifact missing;
  - config missing;
  - process starting;
  - initialized;
  - protocol mismatch;
  - provider incompatible;
  - crashed/exited.

Acceptance:

- Runtime bridge smoke starts the pinned app server, initializes it, creates a
  session, starts a turn, streams events, completes the turn, and shuts down
  without locked binaries.
- Missing or incompatible app server produces setup diagnostics, not a direct
  `/v1` fallback.

### BRIDGEMAIN-05 - Implement Default Chatbot Over `/bridge/*`

Status: in_progress

Maps to: `BRIDGEGAP-11`, `BRIDGEGAP-15`

Scope:

- Replace the current status-only Bridge Workbench with a minimal normal
  chatbot client over `/bridge/*`.
- Implement:
  - connection state;
  - message history;
  - composer;
  - work-area picker;
  - attachment tray;
  - event stream rendering;
  - stop/cancel;
  - tool call cards;
  - approval/rejection cards;
  - diff/changed-file summary;
  - collapsed diagnostics/support bundle.
- Ensure normal turns call:
  - `POST /bridge/sessions`;
  - `POST /bridge/sessions/{sessionId}/turns`;
  - `GET /bridge/turns/{turnId}/events`;
  and never call `/v1/chat/completions` directly from the browser.

Acceptance:

- Workbench smoke proves first paint, session create, turn start, event stream,
  assistant output, cancellation, and setup error rendering.
- UI copy presents one path: Workbench -> Relay bridge -> bundled app server ->
  Relay provider -> M365 Copilot.

### BRIDGEMAIN-06 - Add App-Server Tool Worker Read-Only Tools

Status: superseded by `BRIDGENATIVE-01`

Maps to: `BRIDGEGAP-09`

Scope:

- Do not expose Relay-owned read-only tools through the app-server bridge.
- Codex app-server native harness owns local read/search/review behavior.
- Relay's role is supervision, provider adaptation, attachment staging,
  approval forwarding, and diagnostics.

Acceptance:

- `pnpm sidecar:app-server-bridge-smoke` proves Relay rejects custom dynamic
  tool calls instead of reviving a Relay-owned tool worker.
- `pnpm sidecar:app-server-real-provider-smoke` proves real app-server native
  command execution through the pinned runtime.

### BRIDGEMAIN-07 - Add App-Server Mutating Tools With Approval

Status: superseded by `BRIDGENATIVE-01`

Maps to: `BRIDGEGAP-10`

Scope:

- Do not implement Relay-owned mutating tools behind the app-server bridge.
- Forward official app-server command/file/permission approval requests to the
  browser and return the user's approve/reject decision to the app server.
- Do not revive Relay OfficeCLI semantic mutation handling as an active
  app-server path.

Acceptance:

- Bridge smoke covers approval request/response forwarding and fail-fast
  rejection of custom Relay dynamic tool calls.
- Remaining approval polish belongs to app-server native event rendering, not
  Relay-owned mutation execution.

### BRIDGEMAIN-08 - Add Attachment Staging And Resource Mapping

Status: completed

Maps to: `BRIDGEGAP-08`

Scope:

- Add browser attachment staging under user-local Relay storage.
- Track attachment id, original filename, media type, size, checksum, source,
  retention, and extraction state.
- Pass staged attachment metadata to app-server turns as schema-correct
  `mention` input items, not as raw large contents or custom Relay fields.
- Let the app-server native harness decide how to read referenced resources.
- Add cleanup and clear-staged-attachments behavior.

Acceptance:

- Attachment smoke covers upload, metadata-only turn input, oversized
  rejection, unsupported type rejection, cleanup, and support-bundle redaction.
- Bridge and real-provider smokes prove turn-start input uses the app-server
  schema instead of custom Relay attachment fields.

### BRIDGEMAIN-09 - Wire Main-Path Deterministic Acceptance Gate

Status: completed

Maps to: `BRIDGEGAP-12`

Scope:

- Add deterministic smokes for:
  - pinned artifact manifest;
  - schema/license/hash evidence;
  - provider compatibility;
  - app-server config/home;
  - real supervisor initialization;
  - browser session/turn/event stream;
  - read-only tool call;
  - mutating tool approval/rejection;
  - attachment staging;
  - support-bundle redaction;
  - no shared-folder state.
- Wire stable smokes into `pnpm check`.
- Keep lower-level `/v1` provider smokes, but label them as provider tests.

Acceptance:

- `pnpm check` fails if the app-server main path, provider compatibility,
  native command tool-loop, approval forwarding, package evidence, or storage
  boundaries regress.

### BRIDGEMAIN-10 - Bundle App Server In Portable Packages

Status: completed

Maps to: `BRIDGEGAP-13`

Scope:

- Populate `app/app-server` with the pinned runtime, schemas, notices, and
  hashes.
- Update release inventory, SBOM, portable-root smoke, and `README-FIRST.html`.
- Keep package roots quiet:
  - Windows: `Relay Agent.exe`, `README-FIRST.html`, `LICENSES/`, `app/`;
  - Linux: `relay-agent`, `README-FIRST.html`, `LICENSES/`, `app/`.
- Ensure the standard path requires no npm, Python, Cargo, global install, or
  network fetch at first run.
- Verify sidecar idle exit and installer/update behavior do not leave
  app-server binaries locked.

Acceptance:

- Portable package smoke verifies app-server files are under `app/app-server`,
  release inventory/SBOM include version and hashes, and no confusing
  app-server executable appears at package root.
- `pnpm sidecar:portable:linux`, `pnpm sidecar:portable:windows`, and
  `pnpm check` passed with the Codex app-server bundle under `app/app-server`.

### BRIDGEMAIN-11 - Run Live Copilot Bridge E2E

Status: in progress

Maps to: `BRIDGEGAP-14`

Scope:

- Completed on 2026-05-20:
  - refreshed `pnpm workbench:live-copilot-e2e` for the current Bridge
    Workbench selectors and bundled app-server path;
  - verified workspace selection, browser Workbench submission, app-server
    turn creation, Relay `/v1/responses`, signed-in Edge CDP Copilot, and final
    assistant response in one live canary;
  - hardened Responses parsing so valid leading JSON from Copilot remains
    usable when the M365 UI appends suggestion text after the JSON object.
- Remaining broader coverage before treating this task as complete:
  - expand the live suite beyond the canary into representative app-server
    native tool scenarios.
- With signed-in Edge CDP available, run live E2E through the default chatbot
  and bundled app-server bridge.
- Cover:
  - ambiguous local file search;
  - exact file read;
  - multi-file HTML/project creation;
  - second-turn project improvement;
  - attachment read;
  - approval and rejection;
  - cancellation.

Acceptance:

- Live E2E records app-server thread/turn/item ids, Relay provider request ids,
  bridge event ids, and redacted diagnostics.
- A release cannot advertise the bundled app-server runtime unless this passes
  or release notes explicitly state live E2E was unavailable.

### BRIDGEGAP-00 - Correct App-Server Runtime Truth In Planning Docs

Status: completed

Scope:

- Historical planning correction that created the first `BRIDGEGAP*` runtime
  implementation queue.
- Its "API Hub is the current product" wording is now superseded by
  `BRIDGEGAP-00A`; keep this entry only as provenance for the queue.

Acceptance:

- Historical entry remains present, but active implementation follows
  `BRIDGEGAP-00A` and later.

### BRIDGEGAP-00A - Re-Align Implementation Review To Bundled App Server

Status: completed

Scope:

- Treat the existing `CodexAppServerBridgeService`, `/bridge/*` routes,
  fixture app server, and `sidecar:app-server-bridge-smoke` as active starting
  points, not drift to remove.
- Update stale planning/docs/release language that still says:
  - Relay API Hub is the primary product;
  - direct `/v1/chat/completions` is the recommended HTML tool path;
  - tools are client-managed only;
  - Codex app-server bundle is excluded or planned only.
- Rebase `scripts/check-hard-cut-guard.mjs` so it protects the bundled
  app-server direction:
  - requires `/bridge/health`, `/bridge/sessions`, turn start/cancel, and
    event streaming routes;
  - requires `sidecar:app-server-bridge-smoke` in `pnpm check`;
  - allows direct `/v1` only as provider/developer diagnostics;
  - rejects API-Hub-first Workbench copy as the default product surface;
  - rejects release copy that says the app-server bundle is excluded once
    `BRIDGEGAP-01` is complete.
- Update `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`, and
  `scripts/release/package-sidecar.mjs` copy to align with this direction.

Acceptance:

- Active docs state the target runtime chain:
  Workbench -> Relay bridge -> bundled Codex app server -> Relay `/v1`
  provider -> M365 Copilot.
- Guard and release scripts no longer protect the obsolete API-Hub-first
  story.
- `pnpm check` still includes `pnpm sidecar:app-server-bridge-smoke`.
- No app-server runtime completion is claimed before `BRIDGEGAP-01`,
  `BRIDGEGAP-02`, `BRIDGEGAP-12`, `BRIDGEGAP-13`, and `BRIDGEGAP-14` pass.

Verification:

- `pnpm --filter @relay-agent/workbench typecheck`
- `node scripts/check-hard-cut-guard.mjs`
- `node scripts/api-tool-ux-smoke.mjs`
- `node scripts/workbench-standard-chat-smoke.mjs`
- `pnpm build`
- `dotnet build apps/sidecar/Relay.Sidecar.csproj --configuration Release`
- `pnpm sidecar:app-server-bridge-smoke`

### BRIDGEGAP-01 - Pin App-Server Artifact, License, And Generated Schemas

Status: pending

Scope:

- Select the exact upstream app-server repository, commit/tag, release asset,
  or source-build input.
- Verify redistribution terms, license files, NOTICE/third-party notices,
  platform support, runtime dependencies, and checksum strategy.
- Decide one packaging path:
  - use upstream binary;
  - build from source in Relay release CI;
  - vendor a pinned source snapshot;
  - or record a non-bundlable blocker.
- Generate or vendor protocol schemas for the pinned app-server version.
- Replace illustrative JSONL fixtures with schema-backed fixtures where
  possible.
- Record the exact app-server command line and expected file layout under
  `app/app-server`.

Acceptance:

- Implementation docs record the pinned artifact or explicit blocker.
- Schema version, fixture version, binary/source version, and license evidence
  are tied together.
- Packaging cannot claim app-server support unless artifact, schema, license,
  and checksum evidence exist.

### BRIDGEGAP-02 - Validate Relay Provider Compatibility For App Server

Status: pending

Scope:

- Run the pinned app-server against a mock Relay `/v1` provider fixture before
  live Copilot is involved.
- Verify required provider API shapes:
  - `GET /v1/models`;
  - `GET /v1/models/{model}` if required;
  - `POST /v1/chat/completions`;
  - authorization header handling;
  - model id `m365-copilot`;
  - tool-call and tool-result message handling;
  - error and busy-session behavior.
- Determine whether the app server requires streaming Chat Completions,
  Responses-style API, extra model metadata, or provider-specific config.
- If required, define a provider-only compatibility facade. Do not expose it as
  a public task API.

Acceptance:

- A provider compatibility smoke proves the app server can reach Relay's mock
  provider config without OpenAI API credentials.
- Any missing provider surface is documented as a provider-adapter task, not as
  a return to Relay-owned modes or `/v1/tools`.

### BRIDGEGAP-03 - Add App-Server Configuration And User-Local Home Model

Status: pending

Scope:

- Define Relay-owned app-server home paths for Windows and Linux under
  user-local Relay data.
- Generate provider config that points the app server at Relay Core:
  - `baseURL`;
  - launch token or API key;
  - `m365-copilot` model id;
  - timeouts and request-id propagation if supported.
- Isolate environment variables so unrelated OpenAI keys or shell config do
  not override Relay's provider.
- Define migration/version markers and cleanup behavior for app-server state.
- Ensure selected work areas and shared folders never receive app-server
  config, caches, logs, or session data.

Acceptance:

- A config smoke verifies generated config points at Relay `/v1` and uses
  user-local storage.
- A no-shared-folder-state smoke verifies no app-server files are written into
  the selected work area.

### BRIDGEGAP-04 - Implement App-Server Supervisor Skeleton

Status: completed

Scope:

- Add a sidecar-owned supervisor service for app-server process lifecycle.
- Resolve installed/portable app-server artifacts from `app/app-server`.
- Start the child process over stdio with generated config and user-local home.
- Capture stdout, stdin, stderr, process id, startup time, and exit state.
- Classify startup errors:
  - binary missing;
  - permission denied;
  - bad config;
  - early exit;
  - timeout;
  - version/schema mismatch.
- Add graceful shutdown and orphan cleanup so installers/upgrades do not leave
  locked app-server binaries.

Acceptance:

- A supervisor smoke can start a fixture app-server process, observe ready or
  failed state, and shut it down without locked files.
- Failure states return setup diagnostics, not assistant messages.

Verification:

- `pnpm sidecar:app-server-bridge-smoke`

### BRIDGEGAP-05 - Implement Typed Stdio JSONL Client Binding

Status: completed

Scope:

- Implement one-message-per-line JSONL framing.
- Implement request id generation, response correlation, notification
  demultiplexing, timeout, cancellation, and bounded event queues.
- Implement the required `initialize` request followed by initialized
  notification.
- Validate inbound/outbound messages against pinned schemas where practical.
- Handle bad JSON, unknown method, protocol error, stream close, and
  backpressure as structured errors.
- Preserve thread, turn, item, provider request, and Relay request correlation
  ids for diagnostics.

Acceptance:

- JSONL client smoke covers initialize success and thread/turn fixture stream.
- The client does not assume a strict JSON-RPC `jsonrpc` field when the pinned
  protocol omits it.
- Bad JSON, timeout, cancellation, and protocol-version edge cases remain in
  the broader `BRIDGEGAP-12` acceptance-smoke task.

Verification:

- `pnpm sidecar:app-server-bridge-smoke`

### BRIDGEGAP-06 - Implement Browser Bridge Session And Turn API

Status: completed

Scope:

- Add loopback-only, launch-token-protected bridge endpoints for:
  - bridge health/readiness;
  - session create/resume;
  - session lookup;
  - turn start;
  - turn cancel;
  - redacted support-bundle export.
- Validate `Host`, `Origin`, token, content type, payload size, session id,
  turn id, and app-server readiness before contacting stdio.
- Translate browser requests into app-server thread/turn calls.
- Return setup/run errors as structured HTTP/SSE errors, not assistant prose.

Acceptance:

- Bridge API smokes prove valid session/turn flow and invalid token/origin
  rejection.
- A browser never receives raw stdio messages or app-server process handles.

Verification:

- `pnpm sidecar:app-server-bridge-smoke`

### BRIDGEGAP-07 - Implement Bridge Event Streaming And Correlation

Status: completed

Scope:

- Stream app-server notifications to the browser using SSE or WebSocket.
- Normalize event names enough for UI rendering while preserving app-server
  ids and raw diagnostic references.
- Carry correlation:
  - browser session id;
  - app-server thread id;
  - app-server turn id;
  - item id;
  - Relay provider request id;
  - Copilot CDP request id when available.
- Implement bounded event replay for page refresh and support-bundle export.
- Handle stream disconnect, reconnect, cancelled turn, failed turn, and
  completed turn.

Acceptance:

- Event smoke proves running, item delta, and completion events reach a
  simulated browser client with app-server turn correlation.
- Tool-call, approval, error, cancel, and support-bundle event coverage remain
  in the broader `BRIDGEGAP-12` acceptance-smoke task.

Verification:

- `pnpm sidecar:app-server-bridge-smoke`

### BRIDGEGAP-08 - Implement Attachment Staging For Browser Turns

Status: completed

Scope:

- Add token-protected attachment upload/staging endpoints under Relay
  user-local storage.
- Support browser-picked files and work-area path references as distinct
  attachment origins.
- Track file name, size, media type, source, checksum, retention, and whether
  content has been read/extracted.
- Pass attachment ids and metadata into app-server turns, not raw large file
  contents.
- Provide cleanup and clear-staged-attachments behavior.
- Enforce max file count, max file size, total staged bytes, and unsupported
  type errors.

Acceptance:

- Attachment smokes cover upload, metadata-only turn input, read through a
  tool, cleanup, oversized rejection, and support-bundle redaction.
- External attachments are not copied into the work area unless the user
  explicitly approves an output copy.

### BRIDGEGAP-09 - Implement Read-Only Local Tool Worker

Status: superseded by `BRIDGENATIVE-01`

Scope:

- Do not implement an app-server-visible Relay read-only worker.
- Use Codex app-server native local tools and harness semantics instead.
- Keep this entry as historical provenance only; new work must not extend it.

Acceptance:

- `BRIDGENATIVE-01`, fixture bridge smoke, and real app-server/provider smoke
  are the active acceptance path.

### BRIDGEGAP-10 - Implement Mutating Tools, Approval, Backup, And Diff

Status: superseded by `BRIDGENATIVE-01`

Scope:

- Do not add Relay mutating tools behind the app-server bridge.
- Relay forwards native app-server approval requests and records diagnostics.
- Backup/diff behavior must come from the app-server native harness or a
  future upstream-compatible extension, not a revived Relay mutation worker.

Acceptance:

- Current bridge smoke covers approval forwarding and custom dynamic tool
  rejection.
- Remaining UI work is rendering native app-server approval/diff events, not
  executing mutations inside Relay.

### BRIDGEGAP-11 - Build Default Chatbot Client On Bridge

Status: in_progress

Scope:

- Replace the API-Hub-first primary UX with a chatbot client after the bridge
  backend is usable.
- Implement:
  - connection checklist;
  - message list;
  - composer;
  - work-area picker;
  - attachment tray;
  - event timeline;
  - inline approvals;
  - changed-file/diff summary;
  - stop/cancel;
  - collapsed support details.
- Keep direct `/v1` examples under developer diagnostics only.
- Preserve the portable first-run rule: one visible launcher and
  `README-FIRST.html`.

Acceptance:

- Current Workbench supports bridge session/turn creation, event streaming,
  cancellation, workspace selection, attachment staging, and inline approval
  cards.
- Remaining acceptance: rejection UX smoke, changed-file/diff summary cards,
  first-run copy polish, and failure-state screenshots.
- Normal turns do not call `/v1/chat/completions` directly from the browser.

### BRIDGEGAP-12 - Add Deterministic Bridge Acceptance Smokes

Status: in_progress

Scope:

- Add deterministic smokes using fixture app-server/provider output:
  - artifact/schema pin;
  - provider compatibility;
  - supervisor start/stop;
  - JSONL initialize;
  - session/turn bridge;
  - event stream;
  - tool-call roundtrip;
  - attachment staging;
  - mutation approval/rejection;
  - support-bundle redaction;
  - no-shared-folder-state.
- Wire stable smokes into `pnpm check`.
- Keep existing `/v1` provider smokes while `/v1` remains the lower-level
  provider surface.

Acceptance:

- `pnpm check` now includes fixture-backed app-server bridge coverage for
  session/turn/event streaming, attachment staging, read-only tool-result
  roundtrip, approval-gated write, packaging inventory, and the retired
  `/agui/relay`/`/v1/tools` public-path guard.
- Remaining acceptance: rejection/resume smoke, real pinned app-server mock
  provider compatibility, and support-bundle redaction coverage for bridge
  attachments/tool events.
- Smoke names clearly separate provider API tests from app-server bridge tests.

### BRIDGEGAP-13 - Bundle App Server In Portable Packages

Status: completed

Scope:

- Populate `app/app-server`, generated schemas, and app-server license/notice
  files only after artifact pinning is complete.
- Update release inventory, SBOM, checksum generation, and portable-root smoke.
- Ensure package roots remain limited:
  - Windows: `Relay Agent.exe`, `README-FIRST.html`, `LICENSES/`, `app/`;
  - Linux: `relay-agent`, `README-FIRST.html`, `LICENSES/`, `app/`.
- Prevent runtime npm/pip/cargo/download requirements for the standard path.
- Ensure app-server binaries are not locked after browser close, sidecar idle
  exit, app shutdown, or installer upgrade.

Acceptance:

- Portable package smokes verify app-server files live under `app/`, start from
  the launcher, and do not appear as confusing top-level executables.
- Release inventory and SBOM include app-server artifact version and hashes.

Verification:

- `pnpm sidecar:portable:linux`
- `pnpm sidecar:portable:windows`
- `pnpm check`

### BRIDGEGAP-14 - Run Live Copilot App-Server Bridge E2E

Status: pending

Scope:

- When a signed-in Edge CDP session is available, run live E2E through the
  chatbot and app-server bridge.
- Cover:
  - ambiguous local file search;
  - creating a small multi-file project;
  - improving the project in a second turn;
  - exact attachment read;
  - an Office/PDF read or Office mutation if available;
  - mutation approval and rejection;
  - cancel/stop.
- Fail fast on Copilot delivery, send, response extraction, invalid JSON, stale
  response pickup, selector drift, app-server protocol mismatch, or tool-loop
  mismatch.

Acceptance:

- Live E2E artifacts record app-server thread/turn/item ids, Relay provider
  request ids, bridge event ids, and redacted diagnostics.
- A release cannot advertise the app-server bridge unless this E2E passes or
  the release notes explicitly say live E2E was unavailable.

### BRIDGEGAP-15 - Promote Chatbot Bridge And Demote Direct API Hub

Status: pending

Scope:

- After `BRIDGEGAP-01` through `BRIDGEGAP-14` pass, make the chatbot bridge the
  first-run default.
- Move direct `/v1` API Hub content into developer diagnostics/reference.
- Keep `/v1` documented as the lower-level provider API used by the app-server
  harness.
- Update README, `README-FIRST.html`, API Hub/chatbot copy,
  `docs/IMPLEMENTATION.md`, and release notes to tell one product story.

Acceptance:

- No public docs advertise `/v1/tools`, `/agui/relay`, old Workbench modes, or
  Codex app-server runtime completion before it is bundled and tested.
- Ordinary users see the chatbot bridge first; developers can still inspect
  `/v1` as a provider diagnostic.

### APPBRIDGE-01 - Verify Codex App Server Contract Against Relay Provider

Status: completed

Scope:

- Inspect the Codex app server contract that Relay would depend on before any
  runtime code is changed.
- Verify the upstream runtime/protocol requirements before choosing an
  implementation strategy:
  - app server is launched through the `codex` binary, not a Python service;
  - Rust/Cargo is a release-build concern only if Relay builds from source,
    never an end-user first-run dependency;
  - stdio JSONL is the default local transport; websocket is experimental and
    unsupported for production use;
  - protocol is JSON-RPC-shaped but omits the `jsonrpc` field on the wire;
  - every connection must perform `initialize` plus initialized notification
    before any other request;
  - the canonical conversation model is `thread` -> `turn` -> `item`, with
    turn/item notifications during execution;
  - protocol schemas are generated for the exact pinned app-server version;
  - state must live under a Relay-owned user-local `CODEX_HOME` or equivalent.
- Verify bundling feasibility:
  - upstream license and redistribution terms;
  - required NOTICE/attribution files;
  - available release binaries/packages/source build path;
  - Windows and Linux support;
  - whether a user-local portable layout is practical;
  - whether first run can avoid npm/pip/cargo install and network fetch.
- Determine whether the app server can consume:
  - OpenAI-compatible Chat Completions;
  - `GET /v1/models`;
  - `Authorization: Bearer <token>`;
  - model id `m365-copilot`;
  - non-streaming provider responses;
  - function/tool-call responses.
- Determine whether it requires Responses API, extra model metadata, server
  tool registration, streaming-only events, or OpenAI-specific auth semantics.
- Record the minimum compatibility surface Relay must provide to be a provider
  for that app server.
- Decide whether Relay needs a small provider adapter facade for the app
  server. If yes, define it as provider compatibility only, not a new HTML tool
  API.
- Decide the bundled artifact strategy:
  - upstream binary;
  - source-built artifact;
  - pinned vendored snapshot;
  - or documented non-bundlable blocker.

Artifacts:

- `docs/IMPLEMENTATION.md` note with the verified app-server contract.
- Updated `PLANS.md` if the verified contract changes the bridge design.

Acceptance:

- The project has a concrete compatibility checklist before adopting the app
  server path.
- The project has a yes/no bundling decision with licensing, artifact, and
  platform evidence.
- The requirements list explicitly proves whether end users need Python, Rust,
  Cargo, Node project setup, npm global install, or runtime downloads. The
  target answer is no.
- No task-specific HTML tool is asked to call Relay `/v1` directly as the
  primary product path.

### APPBRIDGE-01A - Pin App Server Version And Protocol Schema

Status: completed

Scope:

- Choose the exact Codex app-server source version, commit, or binary artifact
  Relay will integrate with.
- Generate and store the matching protocol schema artifacts for that version:
  - TypeScript schema;
  - JSON Schema bundle;
  - representative JSONL fixtures.
- Record the required transport and lifecycle sequence:
  - process start;
  - stdio JSONL framing;
  - `initialize`;
  - initialized notification;
  - `thread/start` or `thread/resume`;
  - `turn/start`;
  - streamed notifications;
  - `turn/completed`;
  - shutdown.
- Add fixture examples for:
  - initialization success;
  - request before initialization failure;
  - thread creation;
  - turn event stream;
  - provider error;
  - protocol version mismatch.
- Decide where generated schema files belong in the repo and release package.

Artifacts:

- Version/schema decision in `docs/IMPLEMENTATION.md`.
- Schema and fixture inventory requirement in `PLANS.md` or this task list.

Acceptance:

- No implementation task depends on a floating upstream protocol.
- Relay has exact fixtures to test its app-server client binding before live
  Copilot or HTML UX work starts.

### APPBRIDGE-02 - Define Relay/App-Server Boundary And Bootstrap Model

Status: completed

Scope:

- Define the target process topology:
  - Relay Core sidecar;
  - Relay browser/app-server bridge;
  - Codex app server-compatible harness;
  - browser API Hub / starter HTML;
  - task-specific HTML tools.
- Define the default process control model:
  - Relay launches the app server as a child process over stdio;
  - Relay owns stdin/stdout/stderr lifecycle, startup timeout, cancellation,
    shutdown, and orphan cleanup;
  - websocket is reserved for diagnostics only unless the plan is explicitly
    changed with production evidence.
- Define who owns:
  - sessions;
  - event streams;
  - tool-call loop;
  - browser-to-stdio transport translation;
  - transcript storage;
  - provider auth;
  - attachment staging;
  - local tool dispatch;
  - support bundles;
  - startup/shutdown;
  - error propagation.
- Treat `thread`, `turn`, and `item` as the canonical app-facing session model.
  Do not flatten the bridge back into stateless chat completions.
- Define how Relay supplies provider config to the app server:
  - `baseURL`;
  - `apiKey` / launch token;
  - `model`;
  - optional timeout and request-id propagation.
- Define how Relay creates a user-local app-server home:
  - no config, indexes, sessions, logs, or auth/account files in searched or
    shared workspaces;
  - per-install version marker and migration/error behavior.
- Define lifecycle behavior so one launcher starts Relay Core and app server
  without admin rights or user JSON editing.

Artifacts:

- Boundary section in `PLANS.md`.
- Implementation note or diagram in `docs/IMPLEMENTATION.md`.

Acceptance:

- The architecture clearly says HTML tools connect to Relay's app-server
  bridge, which brokers to the app server.
- Relay direct `/v1` snippets are diagnostics/developer reference only.
- The plan does not reintroduce `/v1/tools`, `/agui/relay`, or Relay-owned
  public local tools.

### APPBRIDGE-02A - Define Browser/App-Server Bridge Contract

Status: completed

Scope:

- Define the local browser bridge because browser HTML cannot connect to
  app-server stdio directly.
- Define browser-facing endpoints:
  - serve default chatbot HTML/static assets;
  - create/resume app-server thread;
  - start/cancel turn;
  - stream app-server item/turn events;
  - submit approval or tool-result responses where the app-server protocol
    requires client participation;
  - upload/stage attachments;
  - fetch run/session diagnostics.
- Define transport translation:
  - browser HTTP/SSE/WebSocket request enters Relay;
  - Relay validates token, origin, and session;
  - Relay writes app-server JSONL messages over stdio;
  - Relay reads app-server notifications;
  - Relay forwards normalized browser events without inventing a separate
    agent protocol.
- Define security behavior:
  - loopback only;
  - per-launch token required;
  - `Host` and `Origin` validation;
  - no arbitrary static file serving from the work area;
  - no unauthenticated attachment upload;
  - no direct access to Relay `/v1` provider from normal chatbot UI.
- Define failure behavior:
  - app server not started;
  - initialize not completed;
  - protocol version mismatch;
  - stale thread/turn id;
  - bridge/app-server backpressure;
  - cancelled turn.

Artifacts:

- Bridge contract in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Future browser bridge schema fixtures.

Acceptance:

- The plan no longer assumes browser HTML can speak to app-server stdio
  directly.
- The bridge is a transport adapter around the app server, not a new Relay
  agent runtime or public `/v1/tools` surface.

### APPBRIDGE-03 - Design App-Server-Facing Starter HTML UX

Status: completed

Scope:

- Replace the current direct Relay starter concept with an app-server-facing
  chatbot client as the default HTML UX.
- The Hub should show:
  - Relay readiness;
  - Copilot readiness;
  - app-server readiness;
  - app-server bridge readiness;
  - chatbot/app-server bridge URL;
  - provider wiring status: chatbot -> bridge -> app server -> Relay `/v1` ->
    M365 Copilot.
- The default chatbot HTML should call Relay's app-server bridge, not Relay
  `/v1` directly and not app-server stdio directly.
- The chatbot should include:
  - familiar chat message list and composer;
  - attach button, drag/drop affordance where supported, and attachment tray;
  - selected work-area display and native folder picker;
  - compact run/tool timeline;
  - inline approval prompts for mutations;
  - changed-file and diff summary after mutations;
  - collapsed diagnostics for provider/app-server health.
- Use first-time-friendly terminology:
  - "Work area" for the folder where Relay can search, edit, and save;
  - "Files for this request" for attachments the assistant should inspect;
  - avoid raw path inputs, protocol names, and developer labels in the primary
    UI.
- Keep direct Relay `/v1` curl/fetch examples collapsed under developer
  diagnostics.
- Keep UI minimal: one recommended path and no duplicate low-level choices.
- Define first-run copy and examples so a new user understands what to do
  without reading protocol/API docs:
  - clear selected work-area line;
  - one composer placeholder;
  - three or four natural-language examples;
  - one collapsed support/details panel.

Artifacts:

- UX plan in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Updated smoke requirements for the starter path.

Acceptance:

- A first-time user sees one integration path: HTML tool -> Relay app-server
  bridge -> app server.
- The API Hub does not teach users to rebuild an agent loop in each HTML file.
- A first-time user can type a natural-language request in the default chatbot
  without reading API instructions first.

### APPBRIDGE-03A - Clarify Work Area And Attachment UX

Status: completed

Scope:

- Define the primary context model:
  - Work area: persistent folder boundary for search, read, create, edit, save;
  - Files for this request: temporary files to inspect in the current message
    or thread.
- Define the visual layout:
  - one centered chatbot column;
  - compact context bar above the composer;
  - one persistent folder chip for the work area;
  - removable file chips for attachments;
  - diagnostics collapsed under "Support details".
- Define empty and partial states:
  - no work area and no attachments: show three choices, "Choose work area",
    "Attach files", and "Ask a question";
  - attachments only: allow attachment review, but disable search/save/edit
    operations until a work area is chosen;
  - work area only: allow search/edit/save inside that folder;
  - work area plus attachments: attachments are extra context, work area remains
    the save/search boundary.
- Define microcopy:
  - "Work area: where Relay can search and save.";
  - "Files for this request: documents to inspect now.";
  - "Nothing is saved unless you approve it.";
  - "Large files are read in parts.";
  - "Choose a work area first" for search/edit/save without a work area.
- Define interaction rules:
  - no raw path text box in the primary UI;
  - native folder picker for work area;
  - when browser-native directory picking is unavailable, use a Relay bridge
    picker endpoint that opens a platform-native folder dialog;
  - file picker and drag/drop for attachments;
  - attachment chips show file type, size, origin, and read/extracted state;
  - attachments can be removed before send and cleared after the run.
- Define visual design requirements:
  - professional chatbot, not admin dashboard;
  - generous whitespace;
  - high-contrast neutral text;
  - white/off-white surfaces and subtle borders;
  - one restrained accent color;
  - lucide-style icons, no emoji icons;
  - keyboard focus visible and accessible labels for picker/attach controls.

Artifacts:

- Work-area/attachment UX contract in `PLANS.md` or
  `docs/IMPLEMENTATION.md`.
- Future E2E checklist for first-run comprehension and attachment-only flow.

Acceptance:

- A first-time user can tell whether Relay will search a folder, inspect an
  attached file, or save changes.
- Attachment-only review does not force a work area.
- Search/edit/save requests without a work area produce a clear UI prompt, not
  a confusing assistant failure.

### APPBRIDGE-03B - Define First-Run Launch And Onboarding Flow

Status: completed

Scope:

- Define the user-facing launch contract:
  - Windows user starts `Relay Agent.exe`, Start Menu item, or Desktop shortcut;
  - Linux user starts `relay-agent`;
  - no terminal window, manual port selection, JSON editing, or command-line
    setup is required for the standard path.
- Define startup sequence:
  - launcher starts Relay Core;
  - launcher starts bundled app server;
  - launcher opens the chatbot HTML page;
  - chatbot waits for protocol readiness and shows progress in plain language.
- Define first-run checklist states:
  - Starting;
  - Sign in required;
  - Choose work area;
  - Ready;
  - Working;
  - Needs approval;
  - Problem.
- Define Copilot sign-in behavior:
  - if signed-in Edge/Copilot is not reachable, show one action to open Copilot;
  - re-check readiness automatically after sign-in;
  - do not expose CDP port configuration in the primary UI.
- Define work-area onboarding:
  - show no path text box by default;
  - use a native folder picker where available;
  - remember recent work area only in user-local storage;
  - never create hidden state in the chosen workspace.
- Define first-use examples:
  - file search example;
  - attachment review example;
  - file creation/editing example;
  - Office edit example if OfficeCLI is available.
- Define failure UX:
  - primary error should be a short action-oriented message;
  - raw diagnostics go behind a collapsed "Support details" disclosure;
  - setup errors must not appear as assistant chat prose.

Artifacts:

- First-run UX contract in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Future E2E scenario list for first install/portable launch.

Acceptance:

- A first-time user can launch the package, sign in to Copilot if needed,
  choose a work area, and send a useful request without seeing ports, JSON,
  tokens, CDP, `CODEX_HOME`, or app-server transport details.
- The same first-run path works for portable and installed builds.

### APPBRIDGE-03C - Define Chatbot Local File Tool Contract

Status: completed

Scope:

- Define the app-server-visible local file tools for the chatbot path, using
  existing coding-agent/tool conventions wherever practical:
  - `glob`;
  - `grep`;
  - `read`;
  - `write`;
  - `edit` or `patch`;
  - `workspace_status`;
  - `diff`;
  - bounded verification command execution;
  - optional semantic Office/PDF tools when available.
- Keep these tools behind the app-server tool protocol. Do not expose a new
  public Relay `/v1/tools` surface.
- Define the local tool worker boundary:
  - app-server tool call enters Relay through the bridge;
  - Relay validates tool name and arguments;
  - Relay executes the local operation only through the approved worker;
  - Relay returns structured observations to the app-server turn;
  - unsupported tools and invalid arguments fail fast.
- Define read-only versus mutating behavior:
  - work-area-scoped `glob`, `grep`, `read`, status, and diff can execute
    directly when inside the selected work area;
  - write/edit/patch/Office mutation and command execution require explicit
    user approval;
  - every mutation produces backup or diff artifacts and app-server events.
- Define the work-area containment and storage rules:
  - selected work area is the only default file-operation root;
  - Relay/app-server caches and logs remain in user-local storage;
  - searched/shared folders never receive hidden Relay state.
- Define how Copilot receives tool availability:
  - concise tool descriptors;
  - no direct shell folklore;
  - no mode-specific search/Office/coding prompts;
  - fail-fast when Copilot emits unsupported tool calls or invalid arguments.
- Define how tool output is surfaced:
  - tool progress appears as timeline events;
  - read/extraction output is capped and redacted where needed;
  - mutation output includes approval status, backup path, changed paths, and
    diff summary;
  - app-server thread/turn/item ids are preserved for diagnostics.

Artifacts:

- Tool contract section in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Future schema fixtures for tool calls and approvals.

Acceptance:

- Local file operation is possible from natural language through the chatbot,
  app server, and Copilot provider chain.
- The implementation path does not revive Relay-owned public tool endpoints or
  separate search/Office/code modes.

### APPBRIDGE-03D - Define Chatbot File Attachment Contract

Status: completed

Scope:

- Define the attachment UX for the default chatbot:
  - attach button in the composer;
  - drag/drop support when the browser allows it;
  - attachment tray with file name, type, size, origin, and remove action;
  - visible "content read/extracted" state after app-server tools inspect it.
- Define attachment origins:
  - selected work-area file reference;
  - browser-picked file outside the work area;
  - generated output file from a previous turn.
- Define storage behavior:
  - work-area references stay as paths;
  - browser-picked external files are staged into a Relay-owned user-local
    attachment store;
  - staging happens through the app-server bridge before the app-server turn
    receives attachment ids;
  - no attachment cache, copy, or index is written into searched/shared
    workspaces;
  - attachment staging can be cleared by the user and by retention cleanup.
- Define attachment limits and cleanup:
  - maximum files per turn;
  - maximum file size and total staged bytes;
  - supported extraction types;
  - clear unsupported-type messaging;
  - retention duration;
  - manual clear action;
  - support-bundle redaction defaults.
- Define app-server integration:
  - if the pinned app-server protocol supports file/input attachments, use the
    official item shape;
  - otherwise represent attachments as app-server-visible local resources with
    ids and metadata, then let `read`/Office/PDF extraction tools inspect them;
  - do not inject raw large/binary file contents into the initial user prompt.
- Define safety behavior:
  - read/extraction activity appears in the chat timeline;
  - mutating an attached file requires approval and diff/backup artifacts;
  - external attachments default to output-copy edits rather than overwriting
    the original;
  - support bundles include attachment metadata by default and raw contents
    only with explicit opt-in.

Artifacts:

- Attachment contract in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Future schema fixtures for attachment metadata and staged-resource reads.

Acceptance:

- The default chatbot can accept files without bypassing the app-server tool
  loop or writing hidden state into the work area.
- Large or binary attachments are inspected through tools, not pasted directly
  into Copilot prompts.
- Attachment upload/staging is token-protected, user-local, capped, and
  covered by cleanup rules.

### APPBRIDGE-03E - Add Chatbot HTML Acceptance Flow

Status: completed

Scope:

- Specify the default chatbot user flow:
  - launch Relay Agent;
  - app server starts and connects to Relay provider;
  - chatbot opens;
  - user selects work area when the request needs local search/edit/save;
  - optional user attaches one or more files;
  - user sends a natural-language local file request;
  - app server starts/resumes a thread;
  - Copilot chooses app-server tools;
  - read-only tools execute;
  - mutating tools request approval;
  - final answer and changed-file summary render in chat.
- Define minimum UX states:
  - connecting;
  - ready;
  - running;
  - waiting for approval;
  - failed with actionable setup error;
  - done.
- Keep the visual design close to a normal professional chatbot:
  - one central conversation column;
  - minimal chrome;
  - tool activity secondary to the answer;
  - diagnostics collapsed by default.

Artifacts:

- UX acceptance checklist in `docs/IMPLEMENTATION.md`.
- Future E2E script names in this task list.

Acceptance:

- The app-server bridge is validated through the default chatbot path, not only
  through low-level protocol or direct Relay `/v1` tests.

### APPBRIDGE-04 - Plan Packaging And Distribution For The Harness

Status: completed

Scope:

- Make the portable package the primary release artifact. Keep the Windows
  user-scope installer optional for Start Menu/Desktop/uninstall integration,
  not the recommended first download.
- Make bundling the target path, not runtime acquisition.
- Decide exactly how to include the app server in the portable release:
  - fetch pinned upstream binary at build time;
  - build from pinned source at release time;
  - vendor a pinned source/binary snapshot;
  - or implement a clearly documented compatibility wrapper only if upstream
    bundling is blocked.
- Define top-level portable package inventory:
  - Windows package root contains only `Relay Agent.exe`,
    `README-FIRST.html`, `LICENSES/`, and `app/`;
  - Linux package root contains only `relay-agent`, `README-FIRST.html`,
    `LICENSES/`, and `app/`;
  - no raw sidecar executable, app-server executable, DLL, schema, script,
    cache, log, or diagnostic dump appears at the package root.
- Define user-local install/storage layout for:
  - Relay Core;
  - browser/app-server bridge routes and static chatbot assets;
  - app server files;
  - license/NOTICE files;
  - generated provider config;
  - generated app-server protocol schema/fixtures for the pinned version;
  - default chatbot HTML client;
  - optional lower-level API Hub/starter examples;
  - app-server session/log data;
  - support bundles.
- Keep the no-admin distribution constraint.
- Keep shared folders free of Relay/app-server caches, indexes, tokens, logs,
  and temporary artifacts.
- Define update behavior so app-server binaries are not locked indefinitely and
  can be replaced by a future installer/portable update.
- Define release inventory/SBOM entries for the app server:
  - source URL or commit;
  - artifact hash;
  - license;
  - build/fetch command;
  - supported runtime ids.
- Define first-download guidance:
  - GitHub Release highlights the portable zip/tarball first;
  - primary Windows asset is named
    `relay-agent-<version>-win-x64-portable.zip`;
  - primary Linux asset is named
    `relay-agent-<version>-linux-x64-portable.tar.gz`;
  - optional Windows installer is named
    `Relay.Agent-<version>-win-x64-setup.exe`;
  - installer is labeled optional;
  - `README-FIRST.html` explains "start this one file" before any technical
    details.

Artifacts:

- Packaging plan in `PLANS.md`.
- Release inventory requirements.

Acceptance:

- The app-server bridge can be distributed without requiring npm, Python,
  Rust/Cargo, Node project setup, OpenAI credentials, network download, or
  admin rights from the end user.
- A first-time user opening the portable package root sees one obvious launcher
  and one short help file, not implementation internals.

### APPBRIDGE-04A - Define Bundled App Server Startup Contract

Status: completed

Scope:

- Define launcher responsibilities for bundled app-server startup:
  - start Relay Core;
  - start/enable the browser bridge inside Relay Core;
  - launch app server over stdio JSONL by default;
  - choose ports only for Relay Core and any optional diagnostic listener;
  - generate provider config pointing app server to Relay `/v1`;
  - pass Relay launch token as provider API key;
  - send app-server `initialize` and initialized notification;
  - verify app-server protocol readiness, not just process liveness;
  - open the chatbot HTML client only after both Relay and app server are
    known;
  - shut down app server when the Relay session ends.
- Define failure states:
  - app server missing from bundle;
  - app server failed readiness;
  - `initialize` rejected or times out;
  - app server cannot reach Relay provider;
  - Copilot provider not ready;
  - app-server protocol version mismatch.
- Ensure failures are shown as setup errors, not as assistant prose.

Artifacts:

- Startup contract in `PLANS.md` or `docs/IMPLEMENTATION.md`.
- Future smoke requirements.

Acceptance:

- A packaged Relay build has a deterministic local startup story for the
  bundled app server.
- The user does not need to manually start or configure the app server.

### APPBRIDGE-04B - Add Portable Root Inventory Smoke

Status: completed

Scope:

- Add or update the release smoke so each portable package root is inspected.
- Assert allowed root entries by platform:
  - Windows: `Relay Agent.exe`, `README-FIRST.html`, `LICENSES/`, `app/`;
  - Linux: `relay-agent`, `README-FIRST.html`, `LICENSES/`, `app/`.
- Assert disallowed root entries:
  - raw `Relay.Sidecar` binary;
  - raw app-server or `codex` binary;
  - DLL/shared library clutter;
  - schemas/fixtures;
  - scripts;
  - logs/caches/temp files;
  - diagnostics/support bundles.
- Assert all implementation files are under `app/` or generated at runtime in
  user-local app data.
- Assert `README-FIRST.html` names the exact visible launcher for the platform.
- Assert GitHub Release naming and labeling:
  - portable Windows zip and Linux tarball are marked recommended;
  - optional installer is clearly labeled optional;
  - checksums/inventory/SBOM are support assets, not first-run choices.

Artifacts:

- Portable root inventory smoke plan.
- Release inventory field for root entries.

Acceptance:

- Future release packaging cannot accidentally expose implementation internals
  at the top level without failing the release gate.
- GitHub Release assets make the portable package the obvious primary download.

### APPBRIDGE-05 - Add Bridge Acceptance Smokes

Status: completed

Scope:

- Add planned smokes for the eventual implementation:
  - start Relay Core with mock Copilot;
  - start or connect to the app server;
  - complete stdio `initialize` and initialized notification;
  - configure app server provider to Relay `/v1`;
  - run the default chatbot HTML client against the Relay app-server bridge;
  - verify the bridge translates the browser turn to app-server stdio messages;
  - confirm the request reaches Relay `/v1/chat/completions`;
  - confirm the answer returns to the chatbot through the app server and
    bridge.
- Add a second planned smoke for tool-loop value:
  - app-server thread starts or resumes;
  - turn starts;
  - item/turn events stream to the client;
  - assistant emits a tool call;
  - client/app-server returns a tool result;
  - assistant continues in the same thread/turn context;
  - turn completes;
  - diagnostics include app-server session id and Relay request id.
- Add a third planned smoke for natural-language local file work:
  - user asks the chatbot to find a file in a fixture workspace;
  - app server uses `glob`/`grep`/`read` tools;
  - answer cites the selected local path from tool observations;
  - no Relay cache/config file appears in the workspace.
- Add an attachment smoke:
  - user attaches a text/PDF/Office fixture file;
  - browser uploads/stages the attachment through the bridge with a launch
    token;
  - initial app-server input contains attachment metadata/id, not full content;
  - app server reads/extracts the attachment through the tool loop;
  - answer references extracted evidence from the attached file;
  - staged attachment data is user-local and can be cleared.
- Add a fourth planned smoke for approved mutation:
  - user asks the chatbot to create or edit a file;
  - app server requests approval before mutation;
  - rejection stops the mutation cleanly;
  - approval applies the change, records diff/backup, and returns a final
    changed-file summary.
- Add a packaging smoke:
  - packaged Relay starts without Python, Rust/Cargo, Node project setup, npm
    global install, or runtime network download;
  - browser bridge is loopback-only and launch-token protected;
  - app-server state is created under Relay user-local storage;
  - searched/shared workspaces receive no app-server cache or config files.

Artifacts:

- Smoke specification in `tasks.md`.
- Future script names and acceptance criteria.

Acceptance:

- Future implementation cannot be marked complete by only proving direct Relay
  `/v1` calls.
- The app server must demonstrate session/tool-loop behavior that direct
  stateless HTML fetch examples do not provide.

### HTMLTOOL-01 - Document HTML Tool API Hub Cutover

Status: completed

Scope:

- Update `PLANS.md`, `tasks.md`, `AGENTS.md`, `README.md`, and
  `docs/IMPLEMENTATION.md` so the active product is Relay API Hub.
- State that the PDF review client is retired as the default product surface.
- State that arbitrary HTML tools call Relay Core over localhost. The
  historical `/agui/relay` and `/v1/tools` parts of that queue are superseded
  by `OPENAIAPI*`; new public integrations use `/v1/chat/completions`.

Artifacts:

- Updated planning and product docs.

Acceptance:

- Active docs describe HTML Tool API Hub, not PDF review, as the current
  release surface.

### HTMLTOOL-02 - Replace PDF Client With API Hub

Status: completed

Scope:

- Replace the default React browser client with a minimal API Hub.
- Provide first-time steps, endpoint discovery, starter HTML generation, copy
  and download actions, a Copilot connectivity test, and collapsed diagnostics.
- Remove PDF-specific UI copy, PDF routes, PDF picker routes, and PDF review
  service from active code.
- Keep visual design calm and professional with generous whitespace, clear
  labels, visible focus, and `aria-live` status updates.

Artifacts:

- Updated `apps/workbench/`.
- Removed `PdfReviewService`.
- Updated sidecar routes and CORS handling.

Acceptance:

- Workbench typecheck and sidecar build pass.
- API Hub smoke verifies the active UX and forbids retired PDF controls.

### HTMLTOOL-03 - Update Smokes, Packaging Help, And Acceptance Gate

Status: completed

Scope:

- Replace PDF UX smoke with API Hub smoke.
- Update sidecar smoke to verify `/v1/relay/manifest` and local HTML CORS
  preflight behavior.
- Update hard-cut guard, standard client smoke, sidecar asset metadata, release
  inventory metadata, and portable `README-FIRST.html` copy.
- Keep `pnpm check` as the canonical gate.

Artifacts:

- Updated scripts under `scripts/`.
- Version `0.3.23` package metadata.

Acceptance:

- `pnpm check` passes.

### OPENAIAPI-01 - Lock Public OpenAI-Compatible Surface

Status: completed

Scope:

- Define the only public OpenAI-compatible endpoints:
  - `GET /v1/models`;
  - `OPTIONS /v1/models`;
  - `GET /v1/models/{model}`;
  - `OPTIONS /v1/models/{model}`;
  - `POST /v1/chat/completions`;
  - `OPTIONS /v1/chat/completions`.
- Define status/support endpoints as non-OpenAI diagnostic APIs only:
  - `GET /health`;
  - `GET /v1/relay/manifest`;
  - `GET /v1/copilot/session`;
  - `POST /api/support-bundle`.
- Mark `/v1/tools` and `/agui/relay` as retired public-product surfaces.
- Confirm the only model id is `m365-copilot`.
- State explicitly that Relay targets Chat Completions + Models, not the
  Responses API.

Artifacts:

- Updated API design notes.
- Updated endpoint inventory in implementation docs.

Acceptance:

- A developer can understand the complete public surface without learning
  Relay-specific tools or AG-UI.

### OPENAIAPI-02 - Implement Auth, CORS, And Models Compatibility

Status: completed

Scope:

- Support `Authorization: Bearer <token>`, `X-Relay-Token`, and `?token=` for
  local examples.
- Require auth for every `/v1/*` request.
- Return OpenAI-compatible `401 authentication_error` for missing or invalid
  tokens.
- Support browser CORS for:
  - `Origin: null` from `file://`;
  - `http://localhost:*`;
  - `http://127.0.0.1:*`.
- Reject non-local origins by default.
- Implement `GET /v1/models` with an OpenAI-compatible list object.
- Implement `GET /v1/models/m365-copilot`.
- Return `404 model_not_found` for unknown model ids.
- Add request id response headers for support correlation without leaking
  tokens.

Artifacts:

- Updated sidecar API/auth/CORS code.
- Updated tests for models/auth/CORS.

Acceptance:

- OpenAI-compatible clients can discover `m365-copilot`.
- Browser `file://` examples can call Relay after passing the launch token.

### OPENAIAPI-03 - Implement Non-Streaming Chat Completions Core

Status: completed

Scope:

- Validate `POST /v1/chat/completions` request JSON.
- Require `model: "m365-copilot"` and non-empty `messages`.
- Accept roles: `system`, `developer`, `user`, `assistant`, and `tool`.
- Accept optional message `name` where OpenAI-compatible clients send it.
- Support text string message content.
- Accept `assistant` messages with `content: null` when `tool_calls` exists.
- Accept assistant `tool_calls` and tool `tool_call_id` for prior tool-call
  context.
- Support tool message text string content.
- Reject multimodal content arrays, images, audio, files, and direct
  Chat-Completions attachments with `400 unsupported_content`. Attachment
  support is planned only for the app-server chatbot path, where attachments
  are represented by metadata/resource ids and inspected through tools.
- Support or safely validate these request fields:
  - `stream`;
  - `stream_options`;
  - `temperature`;
  - `top_p`;
  - `frequency_penalty`;
  - `presence_penalty`;
  - `max_tokens`;
  - `max_completion_tokens`;
  - `stop`;
  - `seed`;
  - `service_tier`;
  - `response_format`;
  - `user`;
  - `metadata`.
- Reject first-cut non-goals with clear errors:
  - `n` other than `1`;
  - `logprobs`;
  - `top_logprobs`;
  - `logit_bias`;
  - legacy `functions` and `function_call`;
  - custom tool types other than function tools;
  - audio output;
  - stored completion operations.
- Reject unknown top-level request fields with `unsupported_parameter` until
  explicitly allowed.
- Enforce documented request body, message count, and total text-size limits
  before provider submission; return `request_too_large` on overflow.
- Return a standard `chat.completion` object with:
  - `id`;
  - `object`;
  - `created`;
  - `model`;
  - one `choices[]` item;
  - `choices[0].message`;
  - `choices[0].finish_reason`;
  - `choices[0].logprobs: null`;
  - `choices[0].message.tool_calls: null` unless tool calls are returned;
  - `choices[0].message.function_call: null`;
  - optional/nullable `system_fingerprint`;
  - `usage` with zero counts when token counts are unavailable.

Artifacts:

- Updated chat completion request validator.
- Updated Copilot adapter response normalization.
- API golden fixtures for success and rejected request shapes.

Acceptance:

- A standard OpenAI SDK chat completion call succeeds with `baseURL`,
  `apiKey`, `model`, and `messages`.

### OPENAIAPI-04 - Implement OpenAI-Compatible Error Contract

Status: completed

Scope:

- Use the envelope:
  `{ "error": { "message": "...", "type": "...", "param": "...", "code": "..." } }`.
- Map failures to stable HTTP status and codes:
  - `400 invalid_request_error`;
  - `401 authentication_error`;
  - `404 invalid_request_error`;
  - `408 timeout_error`;
  - `409 conflict_error`;
  - `429 rate_limit_error`;
  - `500 api_error`;
  - `502 api_error`;
  - `504 timeout_error`.
- Treat Copilot send failure, selector drift, stale response pickup, invalid
  JSON, and invalid tool call as machine-readable API failures.
- Do not turn provider failures into assistant prose.
- Define single-session concurrency behavior:
  - return `409 conflict_error` when Copilot is busy and no queue exists;
  - return `429 rate_limit_error` when a bounded queue overflows;
  - ensure cancellation releases Relay request state.

Artifacts:

- Centralized OpenAI-compatible error mapper.
- Negative API tests.
- Timeout/concurrency tests.

Acceptance:

- SDK users receive structured errors instead of HTML, plaintext, or Relay
  internal exception text.

### OPENAIAPI-05 - Implement Client-Managed Tool Calling

Status: completed

Scope:

- Accept OpenAI-style `tools` entries with `type: "function"`.
- Validate:
  - `function.name`;
  - optional `function.description`;
  - JSON Schema object `function.parameters`.
- Accept `function.strict`; if true, validate returned arguments against the
  enforceable schema subset and fail invalid output with
  `provider_invalid_tool_call`.
- Treat omitted `function.parameters` as an empty object schema.
- Reject OpenAI `custom` tools with `unsupported_tool_type`.
- Support `tool_choice` values:
  - `none`;
  - `auto`;
  - `required`;
  - named function choice.
- Support `parallel_tool_calls`.
- Return standard assistant `tool_calls` with:
  - generated `call_...` ids;
  - `type: "function"`;
  - exact function name;
  - `function.arguments` as a valid JSON string.
- Return `finish_reason: "tool_calls"` for tool-call responses.
- Accept follow-up messages with `role: "tool"` and `tool_call_id`.
- Validate tool result continuity when feasible.
- Relay must never execute client-supplied tools server-side.
- If `tool_choice` requires a tool and Copilot returns prose or an invalid
  tool call, return `502 provider_invalid_tool_call`.
- If `parallel_tool_calls: false` and Copilot returns more than one tool call,
  fail validation instead of dropping calls.

Artifacts:

- Tool-call prompt compiler for M365 Copilot.
- Tool-call response validator.
- Tool-result continuation tests.

Acceptance:

- A standalone HTML/OpenAI SDK client can define a function, receive a tool
  call, execute the function locally, send `role: "tool"`, and get a final
  assistant response.
- No Relay-side local tool execution occurs during the flow.

### OPENAIAPI-06 - Implement JSON Mode And Structured Output Limits

Status: completed

Scope:

- Support `response_format: { "type": "text" }`.
- Support `response_format: { "type": "json_object" }` by asking Copilot for
  one JSON object and validating the final assistant content.
- Reject unsupported `json_schema` or future formats with
  `400 unsupported_parameter` until implemented.
- Return `502 provider_invalid_json` when Copilot produces invalid JSON in JSON
  mode.
- Do not repair invalid JSON with hidden fallback prose.

Artifacts:

- JSON mode prompt/validator.
- JSON mode positive and negative tests.

Acceptance:

- Valid JSON mode returns assistant content that parses as one JSON object.
- Invalid provider output fails as an API error.

### OPENAIAPI-07 - Implement Streaming SSE Compatibility

Status: completed

Scope:

- Implement `stream: true` as OpenAI-compatible SSE.
- Emit chunks with:
  - `object: "chat.completion.chunk"`;
  - `choices[].delta.content` for assistant text;
  - `choices[].delta.tool_calls` for tool-call deltas when available;
  - final `data: [DONE]`.
- Accept `stream_options.include_usage`; if usage is emitted and token counts
  are unavailable, emit zero counts rather than fabricated values.
- If streaming is not ready in an intermediate build, return
  `400 unsupported_parameter` for `stream: true` and ensure examples use
  `stream: false`.
- Add cancellation/timeout behavior that does not leave orphaned Copilot
  browser operations.

Artifacts:

- Streaming response implementation or explicit unsupported guard.
- SSE parser smoke tests.

Acceptance:

- Either streaming works with OpenAI-compatible chunk shape, or it fails
  explicitly and predictably before public docs advertise it.

### OPENAIAPI-08 - Update API Hub And Starter HTML

Status: completed

Scope:

- Make the Hub a concise OpenAI-compatible connection page.
- Show copyable:
  - `baseURL`;
  - `apiKey`;
  - `model: m365-copilot`.
- Provide:
  - fetch snippet;
  - curl snippet;
  - optional OpenAI JavaScript SDK snippet;
  - compact client-managed tool-calling example.
- Generate a dependency-free starter HTML file that uses
  `POST /v1/chat/completions`.
- Keep diagnostics, manifest JSON, and support bundle under developer details.
- Do not show `/v1/tools`, `/agui/relay`, Relay-side tool names, or built-in
  PDF/search/Office/code modes.

Artifacts:

- Updated `apps/workbench/` Hub UI and styles.
- Updated starter HTML generator.

Acceptance:

- A first-time user sees one rule: configure `baseURL`, `apiKey`, and `model`.
- The generated HTML can be saved outside the repo and call Relay.

### OPENAIAPI-09 - Add OpenAI-Compatible SDK And Standalone E2E Smokes

Status: completed

Scope:

- Add smokes for:
  - `GET /v1/models`;
  - `GET /v1/models/m365-copilot`;
  - non-streaming `POST /v1/chat/completions`;
  - auth failure;
  - invalid model;
  - invalid messages;
  - unsupported content;
  - unsupported parameters;
  - deprecated `functions` / `function_call`;
  - unsupported custom tool types;
  - JSON mode success/failure;
  - client-managed tool calling;
  - strict tool schema success/failure;
  - `stream: true` success or explicit unsupported error;
  - request-size limit behavior;
  - concurrency/busy-session behavior.
- Add a smoke that writes a temporary standalone HTML file outside the Relay
  repo and calls Relay with mock Copilot enabled.
- Add an OpenAI JavaScript SDK compatibility smoke when dependency impact is
  acceptable; otherwise add a generated SDK-style sample validation.
- Add guard checks that fail if Hub/docs advertise `/v1/tools`, `/agui/relay`,
  or Relay-side local tool execution.

Artifacts:

- Updated smoke scripts.
- Updated `pnpm check` gate.

Acceptance:

- `pnpm check` fails if ordinary OpenAI-compatible usage regresses.

### OPENAIAPI-10 - Update Product Docs And Release Guidance

Status: completed

Scope:

- Update `README.md`, `README-FIRST.html`, and `docs/IMPLEMENTATION.md`.
- Teach first-time usage:
  - start Relay Agent;
  - copy `baseURL`, `apiKey`, and `model`;
  - use any OpenAI-compatible client or self-made HTML tool.
- Document supported origins: `file://`, `localhost`, `127.0.0.1`.
- Document client-managed tool calling and state that clients execute tools.
- Document request size, message count, timeout, and concurrency limits.
- Document unsupported surfaces:
  - no Responses API;
  - no file/audio/image Chat Completions content;
  - no legacy `functions` / `function_call` first-target support;
  - no OpenAI custom tool types first-target support;
  - no Relay-side public local tools;
  - no `/v1/tools` or `/agui/relay` public integration path.
- Document accepted no-op generation fields, error codes, concurrency behavior,
  and streaming status.

Artifacts:

- Updated product docs and release packaging help.

Acceptance:

- Documentation clearly teaches ordinary OpenAI-compatible usage without
  Relay-specific wrappers.

### PDFHTML-01 - Document PDF HTML Product Cutover

Status: completed

Scope:

- Update product documentation so the long-term default UI is the PDF review
  HTML tool rather than the current generic Workbench.
- Document that the current Workbench is a migration source and must not remain
  as a visible fallback after cutover.
- Document the user-facing product scope:
  - single-PDF typo/omission/wording review;
  - single-PDF internal consistency review;
  - two-PDF consistency comparison;
  - page-cited review report export.
- Document that users need a Microsoft 365 Copilot-capable signed-in Edge
  profile, not OpenAI API keys or extra service accounts.

Artifacts:

- Updated `README.md`.
- Updated `docs/IMPLEMENTATION.md`.
- Optional dedicated product spec under `docs/`.

Acceptance:

- Docs clearly say the PDF HTML tool is the target default client.
- Docs clearly say the generic Workbench is removed from the default release
  surface after cutover.
- Docs clearly state the Copilot subscription/sign-in requirement and the
  no-admin portable distribution target.

### PDFALIGN-01 - Add Section-Aware PDF Review Contract

Status: completed

Scope:

- Extend PDF review output with document sections and section alignments.
- Treat `auto` as the default review type.
- Allow one to eight PDFs in a single review request.
- For one PDF, run typo, wording, and internal consistency checks together.
- For two or more PDFs, use the first PDF as the baseline and align every
  other PDF to it before cross-document comparison.

Artifacts:

- Updated `PdfReviewService` contracts.
- Updated `/v1/pdf/capabilities` response.

Acceptance:

- Response JSON includes `documents[].sections` and `sectionAlignments`.
- Multi-PDF findings are based on aligned sections where possible.
- Fallback page-range sections are explicitly labeled as limitations.

### PDFALIGN-02 - Simplify PDF Review UX

Status: completed

Scope:

- Remove manual `誤字・表記`, `文書内整合`, and `2つのPDF比較` choices.
- Use a single multi-file PDF picker.
- Explain the count-based behavior in one short paragraph.
- Show selected files, one primary run button, page-cited findings, and a
  compact section correspondence table after multi-PDF runs.
- Keep diagnostics collapsed.

Artifacts:

- Updated React PDF client.
- Updated CSS and UX smoke.

Acceptance:

- A first-time user can infer the flow by selecting PDFs only.
- No review-type buttons remain in the default client.
- Multi-PDF results show section alignment count and table.

### PDFALIGN-03 - Update Packaging And Release Guidance

Status: completed

Scope:

- Update README, implementation log, and portable `README-FIRST.html` copy.
- Lead release guidance with the portable zip as the primary artifact.
- Keep the Windows installer as optional.
- Bump version and release artifacts.

Artifacts:

- Updated docs and packaging help.
- Version `0.3.22` artifacts.

Acceptance:

- README and release notes make the first-time path clear.
- `pnpm check` passes.
- Windows/Linux portable packages and optional Windows installer are created.

### PDFHTML-02 - Specify Relay Core PDF Review API

Status: completed

Scope:

- Extend the Relay Core API contract from `COREAPI*` with PDF-review endpoints
  and AG-UI run semantics.
- Specify APIs for:
  - PDF file selection or upload handoff;
  - user-local file staging when a browser selection cannot preserve a stable
    local path;
  - PDF extraction/page-map status;
  - one-PDF proofreading run creation;
  - one-PDF consistency run creation;
  - two-PDF comparison run creation;
  - AG-UI progress streaming;
  - cancellation;
  - job artifact deletion/retention;
  - report export;
  - redacted support bundle.
- Keep raw PDF text, page extraction internals, CDP, and local tool execution
  hidden behind Relay Core.

Artifacts:

- API contract documentation.
- Smoke-test plan for the PDF API surface.

Acceptance:

- Each PDF API has purpose, method, request/response shape, token behavior,
  failure behavior, and storage/redaction behavior specified.
- The API contract states where staged files and extracted text are stored and
  how users delete them.
- The contract does not expose raw CDP, arbitrary shell, arbitrary OfficeCLI,
  or mutation endpoints through the PDF HTML client.

### PDFHTML-03 - Design The First-Time PDF HTML UX

Status: completed

Scope:

- Design the static HTML client around first-time use:
  - large PDF selection area;
  - clear one-PDF and two-PDF review choices;
  - one primary run button;
  - progress state;
  - page-cited findings table;
  - export report action;
  - cancellation action for long jobs;
  - explicit extraction-limitation state for scanned/image-only PDFs;
  - collapsed support details.
- Keep visual design minimal and professional with generous whitespace.
- Avoid generic chat/workbench terminology in the default product surface.
- Keep diagnostics and API details out of the main flow.

Artifacts:

- UX spec and UI state inventory.
- Accessibility checklist for keyboard, focus, `aria-live`, and error states.

Acceptance:

- A first-time user can infer the flow without reading architecture notes.
- The design does not expose multiple product modes, generic tool catalogs, or
  developer diagnostics by default.
- The design can be implemented as a static HTML client served by Relay Core.
- Users never need to manually type PDF paths.

### PDFHTML-04 - Implement Page-Aware Extraction And Alignment Plan

Status: completed

Scope:

- Build on existing PDF `read` extraction direction, but specify the final
  page-aware review pipeline before code changes:
  - page maps with page numbers and stable anchors;
  - heading/label extraction when available;
  - bounded review packets with overlap;
  - page-map checksums and review packet IDs;
  - finding evidence snippets tied to page anchors.
- Specify two-PDF alignment before comparison:
  - match headings, page labels, section numbers, table/figure labels, dates,
    defined terms, and high-similarity passages;
  - review aligned pairs and unmatched sections separately;
  - preserve document-to-document correspondence across long documents.

Artifacts:

- Pipeline specification.
- Fixture design for long PDF and two-PDF mismatch tests.

Acceptance:

- Long PDFs are not handled by blind independent chunking.
- Two-PDF comparison preserves correspondence before Copilot review.
- Findings can always cite the source document, page, and snippet.
- Image-only/scanned pages are detected and reported as extraction limitations
  unless OCR is explicitly added in a later plan.

### PDFHTML-05 - Define Copilot Review Harness For PDF Findings

Status: completed

Scope:

- Define structured Copilot prompts and validation contracts for:
  - typo/omission findings;
  - internal consistency findings;
  - two-document mismatch findings.
- Keep Copilot bounded to page-anchored review packets prepared by Relay Core.
- Require valid structured output and fail fast on invalid JSON, stale
  response, missing evidence, or unsupported claims.
- Ensure Copilot cannot claim content evidence without Relay-provided page
  snippets.
- Define the final finding schema: `id`, `reviewType`, `severity`, `category`,
  `documentId`, `page`, `anchor`, `evidence`, `issue`, `suggestion`,
  `confidence`, and `status`.
- Define report sections for likely typos, consistency mismatches, extraction
  limitations, and human-judgment items.

Artifacts:

- Prompt contract documentation.
- Validation schema plan.
- Fail-fast diagnostics plan.

Acceptance:

- Every finding has page-level evidence supplied by Relay Core.
- Two-PDF mismatch findings cite both documents when applicable.
- Copilot cannot invent file/page references outside the packet.
- Invalid Copilot output is an error to fix, not a silent fallback.

### PDFHTML-06 - Define Job State, Retention, And Cancellation

Status: completed

Scope:

- Define review job states: created, extracting, aligning, reviewing,
  validating, completed, partial, cancelled, failed, and expired.
- Define how progress is streamed through AG-UI and how the HTML client renders
  long-running work.
- Define cancellation behavior for extraction, alignment, Copilot review, and
  report generation.
- Define retention and deletion for staged PDFs, extracted text, page maps,
  review packets, reports, logs, and support bundles.
- Ensure partial results are labeled and cannot be mistaken for a complete
  review.

Artifacts:

- Job-state contract documentation.
- Retention/deletion policy.
- Cancellation smoke-test plan.

Acceptance:

- Users can cancel a long review from the PDF HTML client.
- Cancelled and partial jobs never present incomplete findings as complete.
- Staged files and extracted text are removable from user-local storage.
- Support bundles remain redacted unless the user explicitly opts into raw
  document content.

### PDFHTML-07 - Package Relay Core As A Reusable Local API Tool

Status: completed

Scope:

- Specify packaging so the portable artifact includes:
  - one obvious launcher;
  - Relay Core sidecar;
  - the PDF HTML client;
  - PDF extraction dependencies;
  - app icon;
  - concise first-run help;
  - support bundle tooling.
- Keep runtime state under user-local app data.
- Keep selected PDFs and shared folders free of Relay caches, indexes, logs,
  and temp files.
- Keep NSIS optional convenience only.
- Make release notes clear that Relay requires the user's own Microsoft 365
  Copilot access and does not provide or bypass licensing.

Artifacts:

- Packaging spec updates.
- Release inventory expectations.
- Smoke-test plan for package contents and default launch target.

Acceptance:

- The portable package can be shared without admin rights.
- A user with a Copilot-capable signed-in Edge profile can run it without
  OpenAI API keys or tenant app registration.
- The launcher opens the PDF HTML tool by default, not the generic Workbench.

### PDFHTML-08 - Replace Workbench Gates With PDF HTML Client Gates

Status: completed

Scope:

- Plan the removal of Workbench-specific smokes from the release gate after the
  PDF HTML client is implemented.
- Add replacement gates for:
  - first open and readiness;
  - PDF selection;
  - one-PDF typo review;
  - one-PDF consistency review;
  - two-PDF comparison;
  - scanned/image-only extraction limitation;
  - long-job cancellation and partial-result labeling;
  - report export;
  - support details collapsed and redacted;
  - old generic Workbench not exposed as competing entrypoint.

Artifacts:

- Updated test plan.
- `pnpm check` integration plan.

Acceptance:

- Release gates verify the PDF HTML product surface, not the old generic
  Workbench.
- The old Workbench cannot reappear in release packaging unnoticed.

### PDFHTML-09 - Decommission Generic Workbench After Cutover

Status: completed

Scope:

- Once the PDF HTML client and Relay Core API pass acceptance, remove the
  generic Workbench from active release artifacts.
- Remove or archive Workbench-only code paths that are not needed by the PDF
  HTML client.
- Keep shared AG-UI, Agent Framework, Copilot provider, and Relay Core API
  contracts.
- Do not keep a parallel fallback UI.

Artifacts:

- Decommission checklist.
- Release packaging update plan.
- Documentation update plan.

Acceptance:

- Default release exposes one product UI: the PDF review HTML tool.
- No stale docs describe the generic Workbench as the active product.
- No AionUi/OpenWork/Tauri/generic Workbench fallback path is reintroduced.

### COREAPI-01 - Document Relay Core API Boundary

Status: completed

Scope:

- Treat `apps/sidecar` as Relay Core: the owner of Copilot provider adapters,
  Agent Framework execution, local tools, approvals, workspace policy, backups,
  diffs, logs, and diagnostics.
- Treat `apps/workbench` as a transitional CopilotKit/AG-UI client, not the
  owner of Copilot CDP or tool execution logic.
- Treat the planned PDF HTML client and future HTML helper tools as thin
  clients that connect to Relay Core over localhost HTTP/WebSocket/AG-UI.
- Keep standalone HTML-only execution explicitly out of scope because local
  tools, CDP, approvals, backups, and diffs require the sidecar.

Artifacts:

- Updated architecture docs in `docs/IMPLEMENTATION.md` and README.
- Endpoint ownership notes for sidecar/workbench boundaries.

Acceptance:

- Docs clearly state that browser clients, including the planned PDF HTML
  client, use Relay Core APIs.
- Docs clearly state that clients must not duplicate CDP, tool execution,
  approval, or workspace policy logic.
- No runtime code changes are made in this documentation-only task.

### COREAPI-02 - Specify Stable Local API Contract

Status: completed

Scope:

- Inventory the current sidecar endpoints and map them to the stable Relay Core
  API contract.
- Keep `/agui/relay` as the canonical run stream for task execution.
- Specify read-only endpoints:
  - `/health`;
  - `/v1/copilot/session`;
  - `/v1/workspace`;
  - `/v1/tools`.
- Specify action endpoints:
  - `/v1/workspace/select`;
  - `/v1/approvals`;
  - `/v1/support-bundle`.
- Explicitly reject raw CDP endpoints, arbitrary shell endpoints, arbitrary
  OfficeCLI argv endpoints, and unapproved mutation paths.

Artifacts:

- API contract section in `docs/IMPLEMENTATION.md` or a dedicated docs file.
- Updated smoke-test plan in `PLANS.md` if endpoint names need adjustment.
- JSON schema or OpenAPI-style reference for client-facing `/v1` responses.

Acceptance:

- Each endpoint has purpose, method, request/response shape, auth/token
  requirements, and failure behavior defined before implementation starts.
- Client-facing response shapes are versioned and schema-validated.
- The contract reuses AG-UI, Microsoft Agent Framework, and OpenCode-style tool
  concepts rather than inventing another Relay-specific run protocol.

### COREAPI-03 - Extract Copilot Provider Behind Relay Core Interface

Status: completed

Scope:

- Define a provider boundary for Copilot prompt delivery, send timing, response
  extraction, stale-response detection, JSON validation, and fail-fast errors.
- Keep Edge CDP as the default provider.
- Add only an interface seam for future official Microsoft 365 Copilot Chat API
  or Graph-based Copilot API adapters. Do not require those permissions in the
  current product.
- Ensure browser clients cannot see CDP selectors or invoke CDP operations
  directly.

Artifacts:

- Sidecar provider interface and adapter naming plan.
- Provider diagnostics contract for `/v1/copilot/session`.
- Targeted provider smoke plan.

Acceptance:

- Client-facing APIs remain unchanged if the provider implementation changes.
- CDP failures surface as fail-fast AG-UI/API errors with diagnostics.
- There is no fallback model, weaker planner, or prompt-only recovery path.

### COREAPI-04 - Make Browser Clients Thin Relay Core Clients

Status: completed

Scope:

- Route client session state, workspace state, tool catalog display,
  approvals, support-bundle export, and run execution through the stable Relay
  Core API contract.
- Keep CopilotKit/AG-UI as the UI protocol.
- Remove any remaining client assumptions that the browser owns runtime
  decisions or direct Copilot connection behavior.

Artifacts:

- Browser client API cleanup plan.
- Updated client smokes for API-driven state.

Acceptance:

- Browser clients do not contain CDP selector logic, local tool execution
  logic, or mutation policy logic.
- The generic Workbench can be replaced by the PDF HTML client without
  changing Relay Core.
- Existing client UX stays minimal and first-time friendly until cutover.

### COREAPI-05 - Add Thin HTML Client Fixture

Status: completed

Scope:

- Add a small static HTML fixture that demonstrates how a future task-specific
  HTML helper connects to Relay Core.
- The fixture may check health, display Copilot/session readiness, submit an
  AG-UI task, and show fail-fast errors.
- The fixture must not execute local tools, automate Copilot, or implement its
  own approval harness.

Artifacts:

- Static fixture under tests or docs assets.
- Thin-client smoke script.

Acceptance:

- The fixture works only when the sidecar is running.
- The fixture uses Relay Core APIs and AG-UI events, not raw CDP or direct tool
  execution.
- The smoke proves future HTML helper tools can be built without duplicating
  the Workbench runtime.

### COREAPI-06 - Add Relay Core API Regression Gates

Status: completed

Scope:

- Add contract smokes for `/health`, `/v1/copilot/session`, `/v1/workspace`,
  `/v1/tools`, `/agui/relay`, approval resume, and support-bundle redaction.
- Include the new gates in `pnpm check`.
- Update `docs/IMPLEMENTATION.md` with verification outcomes when implemented.

Artifacts:

- New or updated smoke scripts.
- `pnpm check` integration.
- Implementation log entry.

Acceptance:

- `pnpm check` fails if a client-visible API disappears, exposes unsafe raw
  operations, bypasses approval, or emits unredacted support data.
- Existing Workbench, packaging, and tool-catalog gates still pass.

### PORTABLEENTRY-01 - Document One-Click Portable Direction

Status: completed

Scope:

- Add the portable one-click first-run plan to `PLANS.md`.
- Add this executable `PORTABLEENTRY*` queue to `tasks.md`.
- Update README packaging guidance so initial users see one launcher, not a
  list of equivalent files.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.
- Updated `README.md`.

Acceptance:

- Windows portable guidance names `Relay Agent.exe` as the normal entrypoint.
- Linux portable guidance names `relay-agent` as the normal entrypoint.
- HTML is documented as help only, not as the launch path.

### PORTABLEENTRY-02 - Add Portable Root Launchers And Help Alias

Status: completed

Scope:

- Update the sidecar package script to rename the published launcher to
  `Relay Agent.exe` for Windows packages.
- Update the Linux package to include `relay-agent`.
- Add `README-FIRST.html` while keeping the existing HTML help file as a
  compatibility alias.
- Point compatibility cmd/shell scripts at the new primary launcher where
  possible.

Artifacts:

- Updated `scripts/release/package-sidecar.mjs`.

Acceptance:

- Windows portable packages include root `Relay Agent.exe`.
- Linux portable packages include root executable `relay-agent`.
- Portable text/HTML guidance presents only one primary launch path.

### PORTABLEENTRY-03 - Extend Packaging Guards

Status: completed

Scope:

- Extend release/package smoke coverage so future releases cannot drop the
  primary portable launchers or first-run help file.
- Keep the change inside existing packaging smokes instead of adding a new
  runtime path.

Artifacts:

- Updated release smoke scripts.

Acceptance:

- `pnpm check` validates the new portable launcher/help contract.

### PORTABLEENTRY-04 - Verify, Commit, Push, And Release

Status: completed

Scope:

- Bump release version.
- Run the acceptance gate and package release artifacts.
- Commit to `main`, push, and create the GitHub Release.

Artifacts:

- Passing `pnpm check`.
- Windows/Linux portable packages.
- Optional Windows installer.
- Release inventory, SBOM, checksum file.
- Git commit and GitHub Release.

Acceptance:

- `pnpm check` passes.
- `pnpm sidecar:portable:windows`, `pnpm sidecar:portable:linux`, and
  `pnpm sidecar:installer:windows` pass.
- `dist/relay-agent-win-x64` exposes `Relay Agent.exe` as the primary launcher
  and does not expose `Relay.Launcher.exe` as a competing root entrypoint.
- `dist/relay-agent-linux-x64` exposes `relay-agent` as the primary launcher
  and does not expose `Relay.Launcher` as a competing root entrypoint.
- Release artifacts are generated for the bumped version.
- The release is published on GitHub.

### STANDARDCHAT-01 - Document Standard Chatbot Direction

Status: completed

Scope:

- Add the standard chatbot UX and tool harness alignment plan to `PLANS.md`.
- Add this executable `STANDARDCHAT*` queue to `tasks.md`.
- Ground the plan in CopilotKit, AG-UI, Microsoft Agent Framework, and
  OpenCode references rather than Relay-specific UI/runtime invention.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan explicitly keeps search, Office, coding, and PDF review as recipes
  over one generic chat and tool catalog.
- The plan rejects separate visible modes and separate model-visible
  feature-specific tools.

### STANDARDCHAT-02 - Polish Workbench Into A Normal Chatbot

Status: completed

Scope:

- Update Workbench copy, empty state, workspace guidance, starter suggestions,
  tool rendering, approval copy, and diagnostics labeling so first-time users
  understand the app without seeing internal runtime jargon.
- Preserve the existing CopilotKit chat component and AG-UI connection.
- Add `role=alert` and `aria-live` affordances for user-visible errors and
  status notices.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/styles.css`.

Acceptance:

- The main surface is one chat with one folder picker.
- Workspace selection guidance explains the flow in three short steps.
- Tool and approval cards remain inline and concise.
- No old visible mode labels such as `資料を探す`, `Officeファイルを編集する`,
  or `コードを書く` are reintroduced.

### STANDARDCHAT-03 - Add Standard Chat UX Smoke

Status: completed

Scope:

- Add a static smoke test that enforces the standard chat surface and harness
  boundaries.
- Include the smoke in `pnpm check`.

Artifacts:

- `scripts/workbench-standard-chat-smoke.mjs`.
- Updated `package.json`.

Acceptance:

- The smoke verifies `CopilotChat`, `useDefaultRenderTool`, and
  `useHumanInTheLoop` remain wired.
- The smoke verifies first-time workspace guidance and accessible error/status
  affordances exist.
- The smoke fails if old mode labels or dedicated document-search mode names
  return to the Workbench.

### STANDARDCHAT-04 - Update Docs, Versions, And Verification Log

Status: completed

Scope:

- Update README and `docs/IMPLEMENTATION.md` to reflect the standard chatbot
  UX and unchanged standard tool/harness contract.
- Bump Workbench, sidecar, and launcher versions for the release.

Artifacts:

- Updated `README.md`.
- Updated `docs/IMPLEMENTATION.md`.
- Updated version fields in Workbench, sidecar, and launcher manifests.

Acceptance:

- Documentation describes Relay as one standard chat over local tools.
- Verification commands and release artifacts are recorded.

### STANDARDCHAT-05 - Verify, Commit, Push, And Release

Status: completed

Scope:

- Run the acceptance gate and package release artifacts.
- Commit to `main`, push, and create the GitHub Release.

Artifacts:

- Passing `pnpm check`.
- Windows/Linux portable packages.
- Optional Windows installer.
- Release inventory, SBOM, checksum file.
- Git commit and GitHub Release.

Acceptance:

- `pnpm check` passes.
- Release artifacts are generated for the bumped version.
- The release is published on GitHub.

### PORTABLE-01 - Create First-Class Portable Archive Script

Status: completed

Scope:

- Add a release script that creates versioned portable archives from
  `dist/relay-agent-win-x64` and `dist/relay-agent-linux-x64`.
- Use zip for Windows and tar.gz for Linux.
- Keep package contents self-contained and do not require an installer.

Artifacts:

- `scripts/release/archive-sidecar.mjs`.
- `package.json` portable/archive scripts.

Acceptance:

- `pnpm sidecar:archive:windows` writes
  `dist/relay-agent-<version>-win-x64.zip`.
- `pnpm sidecar:archive:linux` writes
  `dist/relay-agent-<version>-linux-x64.tar.gz`.

### PDFUX-01 - Document Portable PDF Review Plan

Status: completed

Scope:

- Add the portable PDF review UX plan to `PLANS.md`.
- Add this executable `PDFUX*` queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan keeps PDF review as a generic tool recipe, not a new backend mode.
- The plan includes HTML-first portable UX, typo review, two-PDF comparison,
  and text-layer/OCR limitations.

### PDFUX-02 - Add Workbench PDF Starter Chips

Status: completed

Scope:

- Add two compact starter chips to the CopilotKit Workbench after a workspace
  is selected:
  - `PDFの誤字を探す`;
  - `2つのPDFを比較`.
- Insert starter drafts into the CopilotKit composer when possible, and copy
  to the clipboard if the composer cannot be found.
- Keep the UI minimal and avoid a separate PDF mode.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/styles.css`.

Acceptance:

- Starter drafts instruct Copilot to use exact `read`, evidence-based findings,
  and OCR/text-layer caveats.
- The Workbench remains a single chatbot-style surface.

### PDFUX-03 - Add Portable HTML Front Door

Status: completed

Scope:

- Include a self-contained `Relay Agent.html` in portable package roots.
- Include a Japanese Windows launch helper alongside the existing English
  helper.
- Explain startup, workspace selection, PDF proofreading, and PDF comparison
  without implying standalone HTML can execute local tools.

Artifacts:

- Updated `scripts/release/package-sidecar.mjs`.

Acceptance:

- Windows and Linux package roots contain `Relay Agent.html`.
- Windows package roots contain both `Start Relay Agent.cmd` and
  `Relay Agent を起動.cmd`.

### PDFUX-04 - Harden PDF Review Tool Guidance

Status: completed

Scope:

- Add Agent Framework and turn-state prompt guidance for PDF proofreading and
  comparison.
- Keep guidance focused on generic `read`/`glob`/`grep` tools and current
  PDF text extraction limits.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Updated `apps/sidecar/RelayPromptBuilder.cs`.

Acceptance:

- Prompts require exact PDF reads before final answers.
- Prompts do not introduce Relay-specific PDF engines or hidden fallback
  tools.

### PDFUX-05 - Add Smoke Coverage And Release

Status: completed

Scope:

- Add a smoke script for the PDF starter prompts and portable HTML packaging.
- Add it to `pnpm check`.
- Build portable packages and optional installer.
- Publish the release assets.

Artifacts:

- `scripts/pdf-review-ux-smoke.mjs`.
- Updated `package.json`.
- Release artifacts for the current version.

Acceptance:

- `pnpm check` passes.
- Portable package creation and release inventory pass.
- GitHub release contains portable archives, optional installer, inventory,
  SBOM, and SHA-256 checksums.

### PDFUX-06 - Add Native PDF Attachment Picker

Status: completed

Scope:

- Add a small sidecar API for selecting a local PDF with the OS file picker.
- Reuse the existing workspace picker boundary and keep the picker as a UX
  helper, not a model-facing PDF tool.
- Update Workbench PDF starter chips so first-time users choose PDFs from the
  GUI and receive a draft prompt with exact selected paths.
- Update portable HTML and docs to describe PDF selection rather than manual
  path entry.

Artifacts:

- Updated `apps/sidecar/WorkspacePicker.cs`.
- Updated `apps/sidecar/Program.cs`.
- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/types.ts`.
- Updated `scripts/pdf-review-ux-smoke.mjs`.
- Updated docs and release packaging text.

Acceptance:

- `/api/pdf/pick` returns a selected local PDF path, cancel state, or explicit
  error without writing artifacts into the selected/shared folder.
- Workbench PDF starters open the picker and create exact-path prompts for
  proofreading and comparison.
- `pnpm check`, portable package creation, installer creation, release
  inventory, commit, push, and GitHub release complete.

### PDFCHUNK-01 - Document Page-Aware Long PDF Review Plan

Status: completed

Scope:

- Add the long-PDF page-aware review plan to `PLANS.md`.
- Add this executable `PDFCHUNK*` queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan explains why arbitrary PDF chunking is unsafe for two-document
  consistency review.
- The plan keeps PDF review on the generic `read` tool rather than a dedicated
  PDF backend mode.

### PDFCHUNK-02 - Add Page-Aware PDF Read Extraction

Status: completed

Scope:

- Add PdfPig-backed page extraction to the sidecar.
- Extend `read` with optional `mode`, `pageStart`, and `pageEnd` arguments.
- Preserve existing plaintext, Office, and code read behavior.

Artifacts:

- Updated `apps/sidecar/Relay.Sidecar.csproj`.
- Updated `apps/sidecar/DocumentTextExtractor.cs`.
- Updated `apps/sidecar/AgentRunner.cs`.

Acceptance:

- `read` with `mode=map` on a PDF returns a compact page map.
- `read` with `pageStart`/`pageEnd` returns only the selected PDF pages.
- Image-only/OCR-needed pages are reported as limitations.

### PDFCHUNK-03 - Add PDF Correspondence Projection And Prompts

Status: completed

Scope:

- Add `RelayPdfReadProjection.v1` to PDF `read` observations.
- Include suggested page windows, chunk-plan suggestions, next page range, and
  two-PDF alignment guidance.
- Update Copilot, Agent Framework, and Workbench starter prompts to map both
  PDFs before comparing long documents.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Updated `apps/sidecar/RelayCopilotChatClient.cs`.
- Updated `apps/sidecar/RelayPromptBuilder.cs`.
- Updated `apps/workbench/src/App.tsx`.

Acceptance:

- Two-PDF prompts instruct Copilot to preserve cross-document correspondence by
  mapping both PDFs and then reading matching page ranges.
- Final-answer guidance stays evidence-based and does not infer OCR content.

### PDFCHUNK-04 - Add Verification, Docs, And Release Assets

Status: completed

Scope:

- Extend smoke tests for long PDF maps and targeted page-range reads.
- Update README, portable front door, implementation log, version numbers,
  release inventory, checksums, and GitHub release assets.

Artifacts:

- Updated `scripts/office-pdf-read-smoke.mjs`.
- Updated `scripts/pdf-review-ux-smoke.mjs`.
- Updated `README.md`.
- Updated `scripts/release/package-sidecar.mjs`.
- Updated `docs/IMPLEMENTATION.md`.
- Release artifacts for the current version.

Acceptance:

- `pnpm check` passes.
- Portable package creation, optional installer creation, release inventory,
  commit, push, and GitHub release complete.

### PORTABLE-02 - Add Portable Launch Helpers And README

Status: completed

Scope:

- Add `README_PORTABLE.txt` to each packaged root.
- Add `Start Relay Agent.cmd` to the Windows package.
- Add executable `start-relay-agent.sh` to the Linux package.

Artifacts:

- Updated `scripts/release/package-sidecar.mjs`.

Acceptance:

- Package roots contain the relevant launch helper and portable README after
  `pnpm sidecar:publish:*`.
- The README states that admin rights are not required and that runtime data
  stays in user-local storage.

### PORTABLE-03 - Make Release Workflow Upload Portable Assets

Status: completed

Scope:

- Update the release workflow so Windows uploads the portable zip as the first
  Windows artifact and still uploads the optional installer.
- Update Linux release output to use the same versioned tarball naming as local
  packaging.

Artifacts:

- Updated `.github/workflows/release-windows-installer.yml`.

Acceptance:

- Workflow references `pnpm sidecar:archive:windows` and
  `pnpm sidecar:archive:linux`.
- Workflow uploads `relay-agent-<version>-win-x64.zip` and
  `relay-agent-<version>-linux-x64.tar.gz`.

### PORTABLE-04 - Document Portable As Primary Distribution

Status: completed

Scope:

- Update `README.md`, `PLANS.md`, and release inventory behavior to make
  portable zip/tarball the primary sharing route.
- Keep installer guidance as optional only.

Artifacts:

- Updated `README.md`.
- Updated `PLANS.md`.
- Updated `scripts/release/collect-inventory.mjs`.

Acceptance:

- Documentation no longer implies that Windows users must install Relay Agent
  to use it.
- Installer constraints remain documented for users who choose the installer.

### OCLOOP-01 - Document OpenCode Loop Continuation Plan

Status: completed

Scope:

- Add the OpenCode loop-continuation and Office integrity plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan explicitly keeps one generic tool loop rather than reintroducing a
  dedicated document-search engine.
- The plan treats empty filename search continuation as generic harness
  terminal eligibility, not a domain-specific search heuristic.
- The plan requires real Office package integrity after Office mutation.

Verification:

- `git diff --check -- . ':(exclude)apps/sidecar/wwwroot/assets/*'`

### OCLOOP-02 - Track Empty Search Observations

Status: completed

Scope:

- Record successful-but-empty `glob` and `grep` observations in the generic
  completed-tool ledger.
- Add turn-state flags for empty filename discovery and follow-up search/read
  attempts.

Artifacts:

- Updated `apps/sidecar/RelayCopilotChatClient.cs`.
- Updated `apps/sidecar/RelayProtocolState.cs`.

Acceptance:

- A zero-candidate `glob` is visible in `RELAY_TURN_STATE` diagnostics.
- A later `grep`, broader `glob`, or `read` attempt is visible as the generic
  follow-up observation.

Verification:

- `pnpm agent:protocol-state-smoke`

### OCLOOP-03 - Forbid Final After Single Empty Glob

Status: completed

Scope:

- Keep the admissible action envelope in `NeedsObservation` when a file-search
  turn has only an empty filename `glob` and no content search or read attempt.
- Strengthen Agent Framework and Copilot projection prompts to continue with
  visible generic tools after empty filename discovery.

Artifacts:

- Updated `apps/sidecar/RelayAdmissibleActionEnvelope.cs`.
- Updated `apps/sidecar/RelayProtocolGuard.cs`.
- Updated `apps/sidecar/AgentRunner.cs`.
- Updated `apps/sidecar/RelayCopilotChatClient.cs`.
- Updated protocol-state smoke coverage.

Acceptance:

- A premature `final` after a single zero-candidate `glob` is rejected by the
  admissible action envelope.
- The harness does not inject hidden domain-specific search; Copilot must
  choose a visible generic continuation tool.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`

### OCLOOP-04 - Verify Office Package Integrity After Mutation

Status: completed

Scope:

- Add an OpenXML package verifier for `.xlsx`, `.xlsm`, `.docx`, and `.pptx`.
- Run package verification after approved Office mutations, after OfficeCLI
  outline verification.
- Restore the backup and return a failed tool observation if the package is
  invalid after mutation.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Added or updated Office integrity smoke coverage.

Acceptance:

- `officecli_mutate` success requires process success, OfficeCLI outline
  verification, and OpenXML package integrity verification.
- Corrupt post-mutation Office packages are rolled back before Relay returns
  the tool result.

Verification:

- `pnpm agent:officecli-registry-smoke`
- `pnpm agent:office-pdf-read-smoke`

### OCLOOP-05 - Version, Verify, Commit, Release

Status: completed

Scope:

- Bump Relay Agent to the next patch version.
- Record implementation notes and verification commands.
- Run the canonical verification gate.
- Commit, push `main`, and publish a GitHub Release with the Windows
  user-scope installer and archives.

Artifacts:

- Updated version files.
- Updated `docs/IMPLEMENTATION.md`.
- Git commit on `main`.
- GitHub Release assets.

Acceptance:

- `pnpm check` passes.
- Release artifacts include the Windows installer, Windows archive, Linux
  archive, release inventory/SBOM, and SHA256 file.

Verification:

- `pnpm check`
- `pnpm sidecar:publish:linux`
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`
- `pnpm release:inventory`

### GENHARNESS-01 - Document Generic Harness Reset

Status: completed

Scope:

- Add the OpenCode-style generic harness reset plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan explicitly keeps M365 Copilot, Microsoft Agent Framework, AG-UI,
  and the .NET sidecar as the active architecture.
- The plan treats OpenCode as the model-visible tool-contract reference, not
  the active runtime.
- The plan rejects a revived dedicated document-search engine.

Verification:

- `git diff --check -- . ':(exclude)apps/sidecar/wwwroot/assets/*'`

### GENHARNESS-02 - Remove Forced Search Heuristics

Status: completed

Scope:

- Stop `RelayInitialToolPolicy` from forcing first-token `glob` searches for
  file-search and unknown local-work intents.
- Remove fallback hidden `glob **/*` injection for generic local work.
- Keep exact inspection first tools only for exact file read, Office
  inspection/mutation planning, code workspace status, and verification.

Artifacts:

- Updated `apps/sidecar/RelayInitialToolPolicy.cs`.

Acceptance:

- `bounded_file_discovery_before_final` and
  `fallback_bounded_discovery_before_final` are gone from source.
- File search is driven by Copilot choosing visible generic tools, not by a
  Relay-owned query builder.

Verification:

- `rg -n "bounded_file_discovery|fallback_bounded|BuildSearchPattern" apps/sidecar`

### GENHARNESS-03 - Simplify Copilot Harness Prompts

Status: completed

Scope:

- Replace DCI/search-specific Agent Framework instructions with generic
  OpenCode-style tool loops.
- Replace tool-projection search guidance with visible-tool-only,
  observation-driven `glob`/`grep`/`read` rules.
- Remove hidden retriever and domain-specific examples from prompt text.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Updated `apps/sidecar/RelayCopilotChatClient.cs`.
- Updated model-visible tool descriptions where needed.

Acceptance:

- Prompt projection no longer includes `biling_retriever`, vector-search
  suggestions, or `部品売上`-specific examples.
- Prompt projection still requires selectable fenced JSON and rejects images,
  cards, canvas output, attachments, and unknown tools.

Verification:

- `pnpm agent:choice-error-reduction-smoke`

### GENHARNESS-04 - Remove Hidden Search Recovery Paths

Status: completed

Scope:

- Disable protocol-guard repairs that inject DCI-specific `grep` after a read
  or after a premature final.
- Stop converting non-admissible file-search reads into Relay-generated
  recovery grep calls.
- Keep hard failures for unavailable tools, invalid `ask_user`, invalid final,
  and missing required mutations.

Artifacts:

- Updated `apps/sidecar/RelayProtocolGuard.cs`.
- Updated or retired smokes that asserted hidden DCI recovery instead of
  model-visible generic tool behavior.

Acceptance:

- No protocol decision reason starts with `grep_refinement_before_final`,
  `guide_scoped_grep_widened`, `read_target_not_observed_or_existing`, or
  `cited_evidence_read_before_final`.
- Invalid final remains fail-fast when AG-UI/AAE does not allow final.

Verification:

- `pnpm check`

### GENHARNESS-05 - Refresh Chatbot Layout

Status: completed

Scope:

- Refine `apps/workbench` so the CopilotKit chat is the primary object.
- Use a compact header, status pill, workspace picker, inline approval cards,
  and collapsed support details.
- Remove excess Relay dashboard framing and keep the visual style neutral,
  minimal, and professional.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/styles.css`.

Acceptance:

- The Workbench reads as a normal chatbot with workspace context rather than a
  multi-panel task console.
- Text remains readable and controls remain reachable at desktop/mobile sizes.

Verification:

- `pnpm --filter @relay-agent/workbench typecheck`
- `pnpm workbench:ux-e2e`

### GENHARNESS-06 - Version, Verify, Commit, Release

Status: completed

Scope:

- Bump the product version for the release.
- Update implementation notes with verification results.
- Run the canonical verification gate.
- Commit, push `main`, and create the GitHub Release with installer and
  archives.

Artifacts:

- Updated version files.
- Updated `docs/IMPLEMENTATION.md`.
- Git commit on `main`.
- GitHub Release artifacts.

Acceptance:

- `pnpm check` passes.
- Release artifacts include Windows user-scope NSIS installer and platform
  archives with checksums.

Verification:

- `pnpm check`
- Release inventory/SBOM command used by the repo.

### CKLAYOUT-01 - Document CopilotKit Layout Density Plan

Status: completed

Scope:

- Add the CopilotKit layout-density plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan keeps CopilotKit, AG-UI, the .NET sidecar, and M365 Copilot CDP as
  the active runtime/UI architecture.
- The plan fixes spacing through container/layout refinement, not by
  reintroducing custom Relay transcript UI.

Verification:

- `git diff --check -- . ':(exclude)apps/sidecar/wwwroot/assets/*'`

### CKLAYOUT-02 - Tighten Chat Shell And Workspace Context

Status: completed

Scope:

- Compact the shell, header, workspace row, chat gap, support block, tool card,
  and approval card spacing.
- Bound the CopilotKit chat viewport so it stays visually connected to the
  workspace row and does not create excessive empty vertical space.
- Hide the currently selected workspace from the recent-workspace chip list.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/styles.css`.

Acceptance:

- The selected workspace appears only in the workspace row, not again as a
  history chip.
- The chat card starts close to the workspace row and remains above the fold in
  desktop screenshots.
- CopilotKit still owns the transcript, composer, tool rendering, and HITL
  approval placement.

Verification:

- `pnpm --filter @relay-agent/workbench typecheck`
- `pnpm workbench:ux-e2e`

Result:

- Shell, header, workspace row, chat gap, tool cards, approval cards, and
  mobile spacing were tightened.
- CopilotKit remains the transcript/composer/tool/approval owner.
- The selected workspace is filtered out of the recent-workspace chips.
- `pnpm --filter @relay-agent/workbench typecheck` passed.
- `pnpm workbench:ux-e2e` passed.

### CKLAYOUT-03 - Add Layout Density E2E Checks

Status: completed

Scope:

- Extend Workbench UX E2E with explicit layout-density assertions.
- Capture updated desktop/mobile screenshots after the compact layout.

Artifacts:

- Updated `scripts/workbench-ux-e2e.mjs`.

Acceptance:

- E2E fails if header/workspace/chat gaps regress to the previous oversized
  layout.
- E2E continues checking no legacy modes, no old composer, collapsed support,
  approval resume, and responsive no-overflow.

Verification:

- `pnpm workbench:ux-e2e`

Result:

- Added desktop gap, chat top, chat height, chat bottom, and selected-workspace
  history assertions.
- `pnpm workbench:ux-e2e` passed and refreshed desktop/mobile screenshots.

### CKLAYOUT-04 - Version, Verify, Commit, Push, And Release

Status: completed

Scope:

- Bump active package versions for the next patch release.
- Update `README.md` and `docs/IMPLEMENTATION.md` with the compact CopilotKit
  layout change and verification results.
- Run the canonical checks.
- Build release packages and installer.
- Commit and push to `main`.
- Publish the next GitHub Release with generated assets.

Artifacts:

- Next patch release on GitHub.

Acceptance:

- Release exists, points at the pushed commit, and includes installer,
  archives, checksums, release inventory, and SBOM.

Verification:

- `pnpm check`
- `pnpm sidecar:publish:linux`
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`
- `pnpm release:inventory`
- `gh release view`

Result:

- Version bumped to `0.3.13` for the Workbench, sidecar, and launcher.
- `README.md` and `docs/IMPLEMENTATION.md` now document the compact
  CopilotKit layout change, references, and verification results.
- `pnpm check`, release publishes, installer generation, and release inventory
  generation passed locally.
- Release artifacts generated:
  `Relay.Agent-0.3.13-win-x64-setup.exe`,
  `relay-agent-0.3.13-win-x64.zip`,
  `relay-agent-0.3.13-linux-x64.tar.gz`,
  `relay-agent-0.3.13-sha256.txt`, release inventory, and SBOM.

### CKCHAT-01 - Document CopilotKit Chatbot Reset

Status: completed

Scope:

- Add the CopilotKit chatbot reset plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan keeps the .NET sidecar, Microsoft Agent Framework, AG-UI transport,
  and M365 Copilot CDP provider as the active backend architecture.
- The plan treats CopilotKit as the Workbench UI layer, not a replacement LLM
  runtime or cloud dependency.

Verification:

- `git diff --check`

### CKCHAT-02 - Adopt CopilotKit Chat Surface

Status: completed

Scope:

- Replace the custom Workbench composer/result/activity layout with
  `CopilotKitProvider`, `CopilotChatConfigurationProvider`, and `CopilotChat`.
- Use `selfManagedAgents` to connect CopilotKit to the existing `/agui/relay`
  AG-UI endpoint.
- Keep a minimal header with readiness and native workspace picker.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.
- Updated `apps/workbench/src/main.tsx`.
- Updated Workbench package dependencies and lockfile.

Acceptance:

- The primary page is a normal chatbot with one input and transcript.
- There are no visible legacy mode labels or diagnostic-first activity panels.
- The selected workspace is injected into each AG-UI run.

Verification:

- `pnpm --filter @relay-agent/workbench typecheck`
- `pnpm --filter @relay-agent/workbench build`

### CKCHAT-03 - Move Mutation Approval To CopilotKit HITL

Status: completed

Scope:

- Register `request_approval` through CopilotKit human-in-the-loop support.
- Render an inline approval card with target, operation, approve, and reject
  actions.
- Remove the custom Relay approval panel from the primary UI.

Artifacts:

- Updated `apps/workbench/src/App.tsx`.

Acceptance:

- Mutation requests pause in chat and do not execute until the user approves.
- Rejection resumes the AG-UI run without creating local mutation artifacts.

Verification:

- `pnpm workbench:ux-e2e`

### CKCHAT-04 - Restyle Workbench As Minimal Chatbot

Status: completed

Scope:

- Import CopilotKit v2 styles.
- Replace Relay-specific panel CSS with focused chatbot layout overrides.
- Preserve generous whitespace, professional typography, visible focus states,
  responsive behavior, and collapsed support diagnostics.

Artifacts:

- Updated `apps/workbench/src/styles.css`.

Acceptance:

- Desktop and mobile screenshots show a minimal chatbot rather than a
  workbench dashboard.
- The UI has no horizontal overflow across tested viewport sizes.

Verification:

- `pnpm workbench:ux-e2e`

### CKCHAT-05 - Update E2E, Docs, And Verification Log

Status: completed

Scope:

- Update Workbench UX E2E selectors and assertions for the CopilotKit chatbot.
- Update `README.md`, `docs/IMPLEMENTATION.md`, and active architecture notes
  where they describe the Workbench surface.
- Run the canonical active check.

Artifacts:

- Updated `scripts/workbench-ux-e2e.mjs`.
- Updated docs.

Acceptance:

- `pnpm check` passes.
- Verification outcomes are recorded in `docs/IMPLEMENTATION.md`.

Verification:

- `pnpm check`

### CKCHAT-06 - Version, Commit, Push, And Release

Status: completed

Scope:

- Bump active package versions for the next patch release.
- Build release packages and installer.
- Commit and push to `main`.
- Publish the next GitHub Release with generated assets.

Artifacts:

- `dist/installer/Relay.Agent-0.3.12-win-x64-setup.exe`.
- `dist/relay-agent-0.3.12-win-x64.zip`.
- `dist/relay-agent-0.3.12-linux-x64.tar.gz`.
- `dist/release/relay-agent-0.3.12-sha256.txt`.
- Next patch release on GitHub.

Acceptance:

- Release exists, points at the pushed commit, and includes installer and
  checksums.

Verification:

- `pnpm sidecar:publish:linux`
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`
- `pnpm release:inventory`
- `gh release view`

### PROJECTIONFIX-01 - Document Harness Remediation Scope

Status: completed

Scope:

- Add the tool projection harness remediation plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan does not revive dedicated document-search engines, AionUi,
  OpenWork/OpenCode runtime paths, Codex app-server, or Tauri.
- The plan frames the fix as Agent Framework/AG-UI/OpenCode-compatible tool
  projection and semantic OfficeCLI normalization.

Verification:

- `git diff --check`

### PROJECTIONFIX-02 - Harden Copilot Projection Instructions

Status: completed

Scope:

- Strengthen the Copilot tool-projection prompt so JSON must be selectable
  text in one fenced `json` block.
- Explicitly forbid image/card/canvas/screenshot/attachment JSON output.
- Forbid final answers from recommending unavailable local tools, including
  hidden retrievers.
- Clarify OpenCode-style local search sequencing and semantic OfficeCLI cell
  formatting arguments.

Artifacts:

- Updated `apps/sidecar/RelayCopilotChatClient.cs`.

Acceptance:

- Prompt dumps include the text-only JSON and no-unavailable-tool rules.
- The visible tool list remains the source of truth for what Copilot may use
  or recommend.

Verification:

- `pnpm agent:choice-error-reduction-smoke`

### PROJECTIONFIX-03 - Normalize OfficeCLI Formatting Semantics

Status: completed

Scope:

- Normalize `format` and common formatting aliases to OfficeCLI `set`.
- Normalize worksheet/sheet/cell/range aliases into `/Sheet/Cell` targets.
- Normalize common color names and object-shaped fill/color properties into
  OfficeCLI scalar color values.
- Keep raw argv rejected and mutation approval-gated.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.

Acceptance:

- Natural Copilot output for "Sheet1 A1 red" becomes an approved
  `officecli_mutate` proposal without executing before approval.
- Invalid raw argv remains rejected.

Verification:

- `pnpm agent:officecli-registry-smoke`

### PROJECTIONFIX-04 - Add Regression Coverage And Verify

Status: completed

Scope:

- Extend existing smoke tests for prompt projection and OfficeCLI semantic
  formatting.
- Run the canonical active acceptance gate.
- Update implementation notes with the remediation and verification result.

Artifacts:

- Updated smoke tests.
- Updated `docs/IMPLEMENTATION.md`.

Acceptance:

- `pnpm check` passes.

Verification:

- `pnpm check`

### PROJECTIONFIX-05 - Version, Commit, Push, And Release

Status: completed

Scope:

- Bump active package versions.
- Build Linux/Windows release packages and the per-user NSIS installer.
- Commit and push to `main`.
- Publish the next GitHub Release with checksums/inventory.

Artifacts:

- Release assets for the next patch version.

Acceptance:

- GitHub Release exists and points at the pushed commit.

Verification:

- `gh release view`

### INSTALLUX-01 - Document Installer, Picker, And Search Path Remediation

Status: completed

Scope:

- Add the installer defaults, no-console launcher, modern shared-folder
  workspace picker, and `glob` -> `read` path contract plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan keeps the browser Workbench + .NET sidecar architecture.
- The plan does not revive Tauri, AionUi, OpenCode/OpenWork, or a dedicated
  document-search engine.

Verification:

- `git diff --check`

### INSTALLUX-02 - Update Installer Defaults And Launcher Subsystem

Status: completed

Scope:

- Make the NSIS desktop shortcut component selected by default.
- Add a default finish-page launch action that starts the registered versioned
  `AppDir` launcher.
- Change the launcher project to a Windows GUI executable so no console window
  appears during normal program execution.
- Extend release smoke checks for those installer and launcher guarantees.

Artifacts:

- Updated `scripts/release/build-windows-installer.mjs`.
- Updated `scripts/release/icon-packaging-smoke.mjs`.
- Updated `apps/launcher/Relay.Launcher.csproj`.

Acceptance:

- Generated installer remains per-user and non-admin.
- Finish-page run, desktop shortcut, Start Menu shortcut, and uninstall icon all
  point at the versioned install payload.

Verification:

- `pnpm release:icon-smoke`
- `dotnet build apps/launcher/Relay.Launcher.csproj --configuration Release`

### INSTALLUX-03 - Replace Windows Workspace Picker Primary Path

Status: completed

Scope:

- Add a native Windows `IFileOpenDialog` folder picker as the first-choice
  workspace selection path.
- Preserve the existing PowerShell picker as a bounded compatibility fallback.
- Keep Workbench workspace UI minimal but make the action clearer.
- Ensure shared folders/UNC paths are accepted when the native picker returns
  them.

Artifacts:

- Updated `apps/sidecar/WorkspacePicker.cs`.
- Updated Workbench workspace copy/styles as needed.

Acceptance:

- Workspace selection uses a modern Windows folder dialog where available.
- The `変更` action is clearer and always re-enables after success,
  cancellation, error, or timeout.

Verification:

- `pnpm sidecar:workspace-picker-smoke`
- `pnpm workbench:ux-e2e`

### INSTALLUX-04 - Normalize Glob Results And Read Paths

Status: completed

Scope:

- Return `glob` results as workspace-relative display paths valid for later
  tool calls.
- Add shared existing-file path resolution for `read` and `edit`.
- Use platform-correct workspace containment comparisons.
- Add a smoke test proving a discovered file can be read by a direct
  subsequent `read`.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Updated or new smoke coverage.

Acceptance:

- A discovered PDF/Office/plaintext path does not produce a false first
  `file_path does not exist` read failure when it is inside the workspace.

Verification:

- `pnpm agent:golden-smoke`
- `pnpm agent:glob-read-path-smoke`
- `pnpm check`

### INSTALLUX-05 - Version, Verify, Commit, And Release

Status: completed

Scope:

- Bump active package versions.
- Update `docs/IMPLEMENTATION.md`.
- Run acceptance checks and release packaging.
- Commit/push to `main`.
- Publish a GitHub Release with installer and package assets.

Artifacts:

- Release assets for the next patch version.

Acceptance:

- `pnpm check` passes.
- GitHub Release is published with checksums and inventory.

Verification:

- `pnpm check`
- `gh release view`

### RESPONSIVE-01 - Document Installed Workbench Responsiveness Contract

Status: completed

Scope:

- Add the installed Workbench responsiveness plan to `PLANS.md`.
- Capture the observed support bundle state: `/api/status` can already be
  `ready: true` while the Workbench chrome remains stale.
- Define acceptance around automatic readiness refresh, non-blocking optional
  OfficeCLI readiness, and workspace picker recovery.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan does not revive legacy active paths.
- The plan separates required readiness from optional OfficeCLI smoke latency.

Verification:

- `git diff --check`

### RESPONSIVE-02 - Make Sidecar Status Return Required Readiness Quickly

Status: completed

Scope:

- Update sidecar `ToolReadiness` so ripgrep and Copilot checks run in parallel.
- Make OfficeCLI readiness optional and non-blocking on first status calls:
  return a warming-up optional check while the smoke test runs in the
  background, then cache the result.
- Keep the detailed OfficeCLI result visible in later support status output.

Artifacts:

- Sidecar readiness implementation update.

Acceptance:

- `/api/status` can report `ready: true` as soon as required checks are ready.
- Optional OfficeCLI smoke latency does not delay the initial Ready state.
- OfficeCLI failures remain visible but non-required.

Verification:

- `pnpm sidecar:smoke`
- `pnpm check`

### RESPONSIVE-03 - Add Workbench Readiness Auto-Polling

Status: completed

Scope:

- Add automatic readiness polling while Workbench is not Ready.
- Refresh on tab visibility/focus.
- Preserve the manual readiness pill refresh and the minimal UI.

Artifacts:

- Workbench readiness hook update.

Acceptance:

- When `/api/status` changes to `ready: true`, the Workbench becomes Ready
  without a manual click.
- Polling does not spam the sidecar after Ready.

Verification:

- `pnpm typecheck`
- `pnpm workbench:ux-e2e`

### RESPONSIVE-04 - Harden Workspace Picker Visibility And Recovery

Status: completed

Scope:

- Run Windows PowerShell picker in STA mode where supported.
- Add a topmost owner window for the FolderBrowserDialog so the picker appears
  above Edge.
- Add a bounded Workbench-side timeout and abort handling so the `変更` button
  is always re-enabled after hidden-dialog failure or timeout.
- Keep the native picker as the primary path; do not reintroduce direct manual
  path entry as the normal UX.

Artifacts:

- `WorkspacePicker.cs` update.
- Workbench picker timeout/recovery update.

Acceptance:

- Workspace picker button is enabled before selection.
- While picker is active, the button communicates the pending state.
- After success, cancellation, error, or timeout, the button is enabled again.

Verification:

- `pnpm sidecar:workspace-picker-smoke`
- `pnpm workbench:ux-e2e`

### RESPONSIVE-05 - Package, Commit, And Release

Status: completed

Scope:

- Bump active versions to the next patch release.
- Update implementation log with verification results.
- Run `pnpm check`, build Linux/Windows packages, build Windows installer,
  inventory/SBOM, checksums.
- Commit/push to `main`.
- Publish GitHub Release assets.

Artifacts:

- `Relay.Agent-<version>-win-x64-setup.exe`
- Linux tarball, Windows zip, checksums, inventory, SBOM.

Acceptance:

- `pnpm check` passes.
- Release assets are present on GitHub.

Verification:

- `pnpm check`
- `gh release view`

### LIFECYCLE-01 - Document Browser Session Lifecycle Contract

Status: completed

Scope:

- Add the Workbench heartbeat, close beacon, sidecar idle monitor, and launcher
  enablement contract to `PLANS.md`.
- Keep the plan aligned with the active browser Workbench + .NET sidecar
  architecture.
- Explicitly state that installer process-kill preflight is best-effort cleanup,
  not the primary lifecycle mechanism.

Artifacts:

- `PLANS.md` lifecycle plan.
- `tasks.md` executable queue.

Acceptance:

- The plan explains why the `0.3.7` versioned-payload fix is insufficient by
  itself.
- The plan does not revive Tauri, AionUi, OpenCode/OpenWork, or a background
  updater as an active fallback.

Verification:

- `git diff --check`

### LIFECYCLE-02 - Add Sidecar Idle-Exit Lifecycle Monitor

Status: completed

Scope:

- Add a sidecar lifecycle component that records active Workbench clients,
  heartbeat freshness, active request count, and last request time.
- Add authenticated endpoints:
  - `POST /api/session/heartbeat`
  - `POST /api/session/closed`
  - `GET /api/session/status`
- Add middleware hooks around HTTP requests so the sidecar does not exit while
  a request is active.
- Make idle exit opt-in through `RELAY_ENABLE_IDLE_EXIT=1`, disabled by
  `RELAY_DISABLE_IDLE_EXIT=1`, and configurable with bounded millisecond env
  values.

Artifacts:

- Sidecar lifecycle source.
- Program startup integration.

Acceptance:

- Idle exit is disabled by default for direct development/test sidecar runs.
- When enabled, the sidecar stops itself only after startup grace, no fresh
  client heartbeat, no active requests, and idle quiet-period expiry.
- Session endpoints remain protected by Relay launch token and origin policy.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm sidecar:smoke`

### LIFECYCLE-03 - Add Invisible Workbench Heartbeat And Close Beacon

Status: completed

Scope:

- Create a stable per-tab Workbench `clientId` in session storage.
- Send an immediate heartbeat, periodic heartbeats, and a visible-tab heartbeat
  refresh.
- Send a best-effort close beacon on `pagehide` and `beforeunload`.
- Do not add any new visible Workbench controls or diagnostic-first UI.

Artifacts:

- Workbench lifecycle hook in `apps/workbench/src/App.tsx`.

Acceptance:

- A live Workbench tab keeps an idle-exit-enabled sidecar alive.
- Closing or navigating away from the tab allows the sidecar to exit after the
  configured quiet period.
- The minimal Workbench visual surface is unchanged.

Verification:

- `pnpm typecheck`
- `pnpm workbench:ux-e2e` when browser support is available.

### LIFECYCLE-04 - Enable Idle Exit Only From Launcher

Status: completed

Scope:

- Update the launcher to set `RELAY_ENABLE_IDLE_EXIT=1` for installed
  Workbench launches.
- Set conservative default launcher timeouts so first-load Copilot warmup is
  not killed before the Workbench sends its first heartbeat.
- Keep direct sidecar launches free of idle-exit unless explicitly configured.

Artifacts:

- Launcher environment wiring.

Acceptance:

- Normal installed launches self-clean after the Workbench tab closes.
- Existing smoke/development scripts do not need to race against idle exit.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm check`

### LIFECYCLE-05 - Add Deterministic Idle-Exit Smoke Coverage

Status: completed

Scope:

- Add a Node smoke test that starts the built sidecar with short idle-exit
  values, posts a heartbeat, verifies the process remains alive, posts a close
  event, and verifies the process exits.
- Add the smoke test to root `pnpm check`.

Artifacts:

- `scripts/sidecar-idle-exit-smoke.mjs`
- `package.json` script entries.

Acceptance:

- The smoke fails if the sidecar exits while a fresh client is present.
- The smoke fails if the sidecar does not exit after the client closes.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm check`

### LIFECYCLE-06 - Package, Document, Commit, And Release

Status: completed

Scope:

- Bump Workbench, sidecar, and launcher to the next patch version.
- Update packaging policy and implementation log.
- Generate Linux/Windows packages, Windows NSIS installer, release inventory,
  and SHA256 manifest.
- Commit and push to `main`.
- Create a GitHub Release with installer, archives, manifest, and inventory.

Artifacts:

- Updated docs.
- `dist/installer/Relay.Agent-<version>-win-x64-setup.exe`
- `dist/relay-agent-<version>-linux-x64.tar.gz`
- `dist/relay-agent-<version>-win-x64.zip`
- Release inventory and checksums.

Acceptance:

- `pnpm check` passes.
- Release assets are visible on GitHub.

Verification:

- `pnpm check`
- `gh release view`

### INSTALLLOCK-01 - Confirm Install-Root And Lock Failure Contract

Status: completed

Scope:

- Inspect the generated NSIS script and packaging policy for the interaction
  between `InstallDir`, `InstallDirRegKey`, canonical
  `%LOCALAPPDATA%\Programs\Relay Agent`, and legacy
  `%LOCALAPPDATA%\Programs\RelayAgent`.
- Confirm why an upgrade can target the legacy no-space path even after the
  current default path changed.
- Define the exact installer behavior for:
  - fresh install;
  - upgrade in canonical path;
  - upgrade in legacy path;
  - user manually changing the directory page.

Artifacts:

- Updated `docs/IMPLEMENTATION.md` diagnosis entry.
- Installer behavior notes in `docs/PACKAGING_POLICY.md` if needed.

Acceptance:

- The plan explicitly distinguishes lock handling from path migration.
- No implementation task depends on administrator rights or machine-wide
  registry writes.

Verification:

- `git diff --check`

### INSTALLLOCK-02 - Add Per-User Installer Process Stop Preflight

Status: completed

Scope:

- Update `scripts/release/build-windows-installer.mjs` so the generated NSIS
  script runs a preflight before `File /r`.
- Stop only same-user Relay processes whose executable path is under known
  Relay install roots:
  - `$INSTDIR`;
  - `%LOCALAPPDATA%\Programs\Relay Agent`;
  - `%LOCALAPPDATA%\Programs\RelayAgent`.
- Target `Relay.Sidecar.exe` and `Relay.Launcher.exe`.
- Use Windows built-ins available from a user-scope installer, such as
  PowerShell process filtering by executable path.
- Keep the preflight bounded; do not add an infinite wait or background helper.

Artifacts:

- Generated NSIS preflight function or macro.
- Script comments explaining why legacy and canonical roots are both checked.

Acceptance:

- Installing while Relay is open attempts to stop the current user's running
  Relay binaries before copying files.
- The generated NSIS script does not use `RequestExecutionLevel admin`, HKLM,
  machine-wide services, or unrestricted process killing.

Verification:

- installer generated-script smoke
- `pnpm sidecar:installer:windows`

### INSTALLLOCK-03 - Avoid Locked-Binary Overwrite With Versioned Payloads

Status: completed

Scope:

- Do not copy package files directly over `$INSTDIR\Relay.Sidecar.exe`.
- Generate a fresh runtime payload directory under the install root, for
  example `$INSTDIR\app-<version>-<tick>`.
- Copy the package into that payload directory and repoint shortcuts,
  `DisplayIcon`, and Relay's `AppDir` registry value to it.
- Keep the process-stop preflight best-effort only; installation must not fail
  just because a previous sidecar remains locked.

Artifacts:

- Versioned-payload helper in the NSIS generator.
- Deterministic smoke assertions that the versioned payload is selected before
  `File /r` and direct root executable deletion is not reintroduced.

Acceptance:

- A locked installed executable is not overwritten by the installer.
- The installer remains per-user and does not request elevation.

Verification:

- installer generated-script smoke
- `pnpm check`

### INSTALLLOCK-04 - Preserve Canonical Fresh Installs And Legacy Upgrades

Status: completed

Scope:

- Keep the default fresh install location as
  `%LOCALAPPDATA%\Programs\Relay Agent`.
- Preserve existing registered install locations for upgrades, including the
  legacy `%LOCALAPPDATA%\Programs\RelayAgent`, so updates do not create a
  duplicate install without user intent.
- Rewrite uninstall registry metadata, shortcuts, and icon paths after the
  package copy.
- Ensure uninstall removes only the install root and shortcuts, not Relay user
  data, Edge profiles, caches, workspaces, or support bundles.

Artifacts:

- Installer generator updates.
- Packaging policy update explaining canonical-vs-legacy behavior.

Acceptance:

- Fresh install path and legacy upgrade path are both intentional.
- User-local app data remains outside the install root.

Verification:

- installer generated-script smoke
- `pnpm release:inventory`

### INSTALLLOCK-05 - Extend Release And Installer Smokes

Status: completed

Scope:

- Extend `scripts/release/icon-packaging-smoke.mjs` or add a focused installer
  policy smoke to assert:
  - `RequestExecutionLevel user`;
  - no HKLM writes;
  - canonical and legacy install roots are represented;
  - process stop preflight appears before `File /r`;
  - versioned payload directory is selected before `File /r`;
  - root `Relay.Sidecar.exe` deletion/overwrite is not reintroduced;
  - icon wiring remains intact.
- Add the smoke to `pnpm check`.

Artifacts:

- Updated or new release smoke script.
- `package.json` check integration.

Acceptance:

- The installer lock regression cannot be reintroduced without failing the
  canonical check gate.

Verification:

- `pnpm release:icon-smoke` or new installer smoke
- `pnpm check`

### INSTALLLOCK-06 - Verify Windows Upgrade And Prepare Fix Release

Status: completed

Scope:

- Build the Windows package and NSIS installer.
- On Windows, verify at least one installed-app upgrade scenario with the
  previous Relay instance running:
  - current user's running sidecar is stopped when possible, but the installer
    still completes without touching the locked executable if it remains
    running;
  - no administrator elevation or password prompt appears;
  - installed app starts after upgrade;
  - icon, workspace picker, and Copilot readiness remain functional.
- Record verification in `docs/IMPLEMENTATION.md`.

Artifacts:

- Windows upgrade verification note.
- Release notes for the installer-lock fix.

Acceptance:

- The next release should include a Windows upgrade result when a Windows
  desktop is available; Linux release builds must at minimum prove the generated
  installer no longer overwrites the locked executable path.

Verification:

- `pnpm check`
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`
- Windows installed-app upgrade smoke when a Windows desktop is available; this
  cannot run in the Linux build environment, so the release gate relies on the
  generated NSIS policy smoke plus Windows package/installer builds here.

### BOOTREADY-01 - Restore Active App Icon Assets

Status: completed

Scope:

- Copy the previous Relay icon assets from the historical Tauri path into an
  active non-Tauri location, for example `assets/app-icon/`.
- Include at least the source SVG, Windows `.ico`, and PNG sizes needed for
  packaging/tests.
- Keep the old `apps/desktop/src-tauri/icons/` path historical only; do not
  make the release path depend on Tauri directories.

Artifacts:

- Active icon asset directory.
- Inventory note in `docs/IMPLEMENTATION.md` identifying the source commit and
  active destination.

Acceptance:

- Icon assets are available to launcher, installer, release inventory, and any
  future Linux desktop metadata without referencing `apps/desktop`.
- No active Tauri build/config path is reintroduced.

Verification:

- icon asset smoke
- `git diff --check`

### BOOTREADY-02 - Wire Icon Through Launcher And NSIS Installer

Status: completed

Scope:

- Add Windows `ApplicationIcon` metadata to `Relay.Launcher.csproj`.
- Update the Windows package/installer flow so the active `.ico` is available
  in `dist/relay-agent-win-x64`.
- Update the generated NSIS script to set installer, uninstaller, Start Menu,
  optional desktop shortcut, and uninstall entry icons.
- Keep `RequestExecutionLevel user` and per-user install paths unchanged.

Artifacts:

- Launcher project icon reference.
- Installer script generator icon support.
- Packaging smoke that verifies the NSIS script and package inputs.

Acceptance:

- Installed shortcut and uninstall entry no longer show a generic executable
  icon.
- The installer still requires no administrator rights or personal Windows
  password.

Verification:

- packaging/icon smoke
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`

### BOOTREADY-03 - Add Sidecar Copilot CDP Manager

Status: completed

Scope:

- Replace the missing-env-only Copilot transport construction with a sidecar
  CDP manager that can resolve or start Copilot Edge CDP.
- Resolution order:
  1. explicit `RELAY_COPILOT_CDP_PORT`;
  2. Relay profile marker file;
  3. live `DevToolsActivePort`;
  4. auto-start Microsoft Edge with the Relay profile.
- Reuse the older stable CDP behavior from commit
  `40622c03d049f89e9b2501a39b88eb796c298912` where it still applies:
  standard Windows Edge locations, dedicated profile, stale-port rejection,
  Edge `/json/version` validation, and Copilot page/composer validation.

Artifacts:

- `EdgeCdpManager` or equivalent sidecar component.
- Unit/smoke coverage for explicit port, marker port, stale marker, stale
  DevToolsActivePort, auto-start command construction, and missing Edge.

Acceptance:

- Installed app startup does not require users to set
  `RELAY_COPILOT_CDP_PORT`.
- Explicit env override remains available for development and live E2E.
- No fallback model or weaker local planner is introduced.

Verification:

- new Copilot CDP manager smoke
- `pnpm sidecar:build`
- `pnpm check`

### BOOTREADY-04 - Preserve Legacy Signed-In Edge Profile Continuity

Status: completed

Scope:

- Detect and reuse the legacy Relay Edge profile location used by the older
  stable desktop line when it exists and has a live or reusable CDP profile.
- Prefer a user-local app-data Relay profile for new installs.
- Respect `RELAY_EDGE_PROFILE` for advanced troubleshooting and live E2E.
- Store any new marker file under user-local Relay data, never in shared
  workspaces.

Artifacts:

- Profile resolution helper.
- Smoke tests for legacy profile preference, new profile fallback, and env
  override.

Acceptance:

- Users who were already signed in through the previous Relay Edge profile have
  the best chance of staying signed in after the architecture cutover.
- New users get a user-local Relay-owned profile.
- No searched/shared folder receives profile, cache, or temp artifacts.

Verification:

- profile resolution smoke
- `pnpm sidecar:security-smoke`

### BOOTREADY-05 - Make First Paint Fast And Warm Copilot In Background

Status: completed

Scope:

- Keep launcher behavior focused on starting the sidecar and opening the local
  Workbench quickly.
- Move Edge/Copilot startup or attach work into background sidecar warmup.
- Add readiness caching/TTL so `/api/status` is quick and does not rerun slow
  OfficeCLI smoke on every UI poll.
- Keep OfficeCLI optional readiness deferred enough that it cannot make the
  first viewport feel stuck.

Artifacts:

- Background Copilot warmup path.
- Cached readiness result model.
- Startup timing smoke.

Acceptance:

- Workbench appears quickly even when Copilot warmup is still in progress.
- The UI can show `Connecting to Copilot` without blocking the page.
- Required local tool failures still fail clearly.

Verification:

- startup timing smoke
- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-06 - Replace Raw Not Ready With Minimal Readiness States

Status: completed

Scope:

- Extend status projection so the Workbench can distinguish:
  `Ready`, `Connecting`, `Sign in needed`, `Local tools issue`,
  and `Provider error`.
- Hide developer-only messages such as
  `Set RELAY_COPILOT_CDP_PORT...` from the primary UI.
- Keep raw details available only in collapsed Support/export.
- Add a sparse sign-in recovery row with `Open Copilot` and `Retry` when the
  Copilot page is reachable but the composer is not usable.

Artifacts:

- Status response projection update.
- Workbench readiness UI update.
- UX E2E fixtures for connecting, sign-in-needed, local-tools issue, and ready
  states.

Acceptance:

- Normal installed launch never presents the missing-env message as the primary
  experience.
- Sign-in-required is understandable without a diagnostic console.
- The first viewport remains minimal with generous whitespace.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-07 - Add Native Workspace Picker And Minimal Workspace Chrome

Status: completed

Scope:

- Replace the default manual workspace path text field with a sidecar-owned
  native folder picker surfaced as a compact `Change` action in the Workbench.
- Use the old stable `apps/desktop/src/lib/workspace-picker.ts` behavior only
  as interaction reference: directory-only, single selection, current workspace
  as default path, cancel leaves the current workspace unchanged.
- Add a narrow sidecar API such as `/api/workspace/pick` that returns an
  absolute path selected through the OS file explorer.
- Implement platform adapters behind one interface:
  - Windows: real File Explorer folder dialog suitable for installed users;
  - Linux: desktop portal/dialog command when available, with a clear app error
    if no graphical picker can be shown.
- Keep workspace history user-local. Do not write picker state, caches, indexes,
  or temp files into selected/shared workspaces.
- Update the Workbench layout so the first viewport shows only:
  Relay identity, compact readiness, selected workspace chip, `Change`, task
  composer, send/stop, answer/approval area, and collapsed Support.
- Apply the minimal professional design direction: generous whitespace, Inter,
  neutral surfaces, one quiet accent, visible focus states, no decorative
  gradients/orbs, no diagnostic-first chrome.

Artifacts:

- Sidecar workspace picker endpoint and platform adapter tests.
- Workbench workspace selector component with folder icon action and compact
  recent-workspace chips.
- UX E2E fixtures for picker success, picker cancel, picker failure, and recent
  workspace display.
- Implementation log entry referencing the old stable picker commit and the
  active non-Tauri replacement.

Acceptance:

- A normal user can set or change the workspace without typing a path.
- Cancelling the picker leaves the previous workspace untouched.
- The selected path is visible enough to verify, but does not dominate the
  composer.
- Direct path entry is not part of the default UI; any developer override is
  hidden under Support/advanced diagnostics.
- No Tauri runtime, Tauri IPC, or AionUi/OpenCode/OpenWork path is revived.

Verification:

- workspace picker unit/smoke tests
- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-08 - Add Installed-App Startup And Icon E2E Gates

Status: completed

Scope:

- Add deterministic launcher/package startup smokes that run without
  `RELAY_COPILOT_CDP_PORT`.
- Add a Windows packaging/install smoke where available:
  Start Menu shortcut icon, user-scope install path, Workbench first paint, and
  Copilot readiness transition.
- Add a Linux packaged-run smoke for the archive path.
- Keep signed-in live Copilot E2E optional when the environment is not
  available, but required before publishing a release that changes CDP
  selectors or startup behavior.

Artifacts:

- Startup E2E scripts.
- Icon/package assertions.
- Implementation log entries with timings and screenshots.

Acceptance:

- The regression is caught before release: no icon loss, no developer-env-only
  Copilot readiness, no raw Not ready on normal installed start.
- The default Workbench path uses native picker selection, not required manual
  path typing.
- Live failures are classified as environment/sign-in/provider issues, not
  generic app failure.

Verification:

- startup/icon/workspace-picker E2E smoke
- `pnpm workbench:live-copilot-e2e` when signed-in Edge CDP is available
- `pnpm check`

### BOOTREADY-09 - Rebuild Release Notes And Documentation

Status: completed

Scope:

- Update `README.md`, `docs/IMPLEMENTATION.md`,
  `docs/PACKAGING_POLICY.md`, `PLANS.md`, and `tasks.md` after implementation.
- Document the installed-app behavior:
  Relay starts/attaches Copilot Edge CDP automatically, uses user-local profile
  storage, and does not require manual `RELAY_COPILOT_CDP_PORT`.
- Document the remaining developer override and support bundle diagnostics.
- Prepare release notes that call out icon restoration and startup/readiness
  repair.
- Document that normal users choose a workspace through the file explorer, with
  direct path entry only as hidden troubleshooting/developer behavior if it is
  retained at all.

Artifacts:

- Updated docs and implementation log.
- Release-note checklist for the fix release.

Acceptance:

- Docs no longer imply normal installed users must configure a CDP port.
- Packaging docs mention icon wiring and user-local Edge profile behavior.
- User docs no longer tell users to type workspace paths as the primary flow.
- Historical desktop/Tauri notes remain archived context only.

Verification:

- `git diff --check`
- `pnpm check`

### UXMIN-01 - Inventory And Remove Visual Noise

Status: completed

Scope:

- Audit `apps/workbench/` for visible controls, panels, badges, diagnostics,
  mode selectors, and AionUi-era or historical runtime affordances.
- Remove default-surface controls that are not required for normal task
  execution: rating/reaction buttons, globe/web UI buttons, always-visible
  runtime chips, unused settings, legacy feature-mode shortcuts, and raw
  diagnostic panels.
- Keep only essentials visible by default: workspace, task composer, send/stop,
  run state, answer, approvals, and explicit support export.

Artifacts:

- Workbench UI inventory recorded in `docs/IMPLEMENTATION.md`.
- Removed or relocated chrome in Workbench components.

Acceptance:

- The first viewport no longer reads as a dashboard, landing page, mode picker,
  or diagnostic console.
- Search, Office editing, coding, and verification remain available as natural
  language tasks through the same composer.
- No hidden fallback to old AionUi/OpenCode/OpenWork/Tauri UI paths is added.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-02 - Define Minimal Design Tokens And Layout Primitives

Status: completed

Scope:

- Define Workbench-level Tailwind/shadcn/Radix primitives for spacing,
  max-widths, surface colors, border radii, focus rings, typography, icon
  sizing, and state colors.
- Use a restrained neutral palette with one quiet accent. Avoid decorative
  gradients, orbs, bokeh, one-note purple/blue themes, and marketing-style
  composition.
- Add stable responsive constraints for composer, timeline, approval, diff, and
  result surfaces so text and controls do not shift or overlap.

Artifacts:

- Updated Workbench styling primitives and shared components.
- Visual notes in `docs/IMPLEMENTATION.md` explaining the token choices.

Acceptance:

- The UI has a consistent professional visual rhythm across idle, running,
  approval, error, and complete states.
- Text fits inside controls at 375px, 768px, 1024px, and 1440px.
- Keyboard focus and contrast remain visible.

Verification:

- Workbench typecheck/build through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-03 - Rebuild The Shell Around One Composer

Status: completed

Scope:

- Restructure the Workbench shell around a single natural-language task
  composer and one run surface.
- Keep workspace selection visible but quiet; it should support the task, not
  dominate the screen.
- Replace feature-mode framing with concise placeholder/help text inside the
  composer only when the run is idle.

Artifacts:

- Updated shell/composer components in `apps/workbench/`.
- E2E fixture covering a generic task start from the idle state.

Acceptance:

- Users do not need to choose `資料を探す`, `Officeファイルを編集する`, or
  `コードを書く` before submitting a task.
- The primary action is visually clear and the page has no competing CTAs.
- The idle state contains no long explanatory copy.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-04 - Render Runs As A Progressive AG-UI Timeline

Status: completed

Scope:

- Use `/agui/relay` events as the canonical Workbench run model.
- Render final answer and current run state first, then a compact timeline of
  meaningful tool calls, approvals, diffs, verification results, and errors.
- Collapse raw AG-UI events, JSON payloads, and long diagnostics behind
  explicit detail controls.

Artifacts:

- AG-UI timeline components and state mapping.
- Golden UX fixture with long search/read/edit/verify trajectories.

Acceptance:

- A normal run is understandable without reading raw event payloads.
- Advanced diagnostics are available but never dominate the default surface.
- Interrupt/resume and approval events remain visible enough to act on.

Verification:

- official AG-UI replay/golden smoke through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-05 - Build Minimal Approval And Diff Surfaces

Status: completed

Scope:

- Create one approval surface that covers code edits, OfficeCLI mutations,
  file writes, patches, and bounded verification commands.
- Show concise summary, target path, risk, backup state, diff availability, and
  approve/reject actions.
- Keep mutation approval unmistakable without adding persistent sidebars or
  modal-heavy flow.

Artifacts:

- Shared approval/diff components for AG-UI client-tool approvals.
- Approval/rejection UX E2E fixture.

Acceptance:

- Mutations cannot proceed without explicit user approval.
- Rejection and resume are clear and leave an auditable run trace.
- The same approval surface works across common file, Office, and code tasks.

Verification:

- official AG-UI client-tool approval smoke through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-06 - Polish Loading, Error, And Completion States

Status: completed

Scope:

- Design calm states for idle, connecting to Copilot, running, waiting for
  approval, applying changes, failed, cancelled, and complete.
- Keep failure messages short and specific. Move raw diagnostics to details and
  explicit redacted support bundle export.
- Ensure long-running operations look alive without excessive animation or
  noisy status text.

Artifacts:

- Updated state components and error detail components.
- UX fixtures for provider failure, tool failure, invalid output, and success.

Acceptance:

- The UI never appears frozen while an AG-UI run is active.
- Fail-fast Copilot/provider errors are understandable without exposing raw
  implementation details by default.
- Completion clearly distinguishes final answer, changed files, and next
  available actions.

Verification:

- provider/tool failure smokes through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-07 - Add Responsive Accessibility And Visual Regression Gates

Status: completed

Scope:

- Extend Workbench UX E2E coverage for 375px, 768px, 1024px, and 1440px
  viewports.
- Check keyboard navigation, focus order, contrast, reduced-motion behavior,
  text overflow, and stable dimensions for fixed-format controls.
- Add screenshot or DOM assertions that catch reintroduced visual noise.

Artifacts:

- Updated `pnpm workbench:ux-e2e` coverage.
- Accessibility and viewport notes in `docs/IMPLEMENTATION.md`.

Acceptance:

- No incoherent overlap or clipped text in supported viewports.
- The composer, timeline, approval, and error surfaces remain usable with a
  keyboard.
- Reintroduced legacy chrome or always-visible diagnostics fails the UX gate.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-08 - Align Product Documentation With The Minimal Workbench

Status: completed

Scope:

- Update `README.md`, `docs/IMPLEMENTATION.md`, `PLANS.md`, and `tasks.md`
  after implementation so they describe the single minimal AG-UI Workbench.
- Remove active-architecture wording that implies separate search, Office, or
  coding product modes.
- Keep historical AionUi/OpenCode/OpenWork/Tauri references clearly archived.

Artifacts:

- Documentation updates aligned with the implemented UX.
- Verification log entries for UX and check commands.

Acceptance:

- Documentation describes one browser Workbench over Microsoft Agent Framework,
  AG-UI, M365 Copilot CDP, and Relay-governed local tools.
- No user-facing docs instruct users to choose old feature modes.
- Release notes can be produced without contradicting the active architecture.

Verification:

- `git diff --check`
- `pnpm check`

### DCI2605IR-01 - Add DCI Phase And Hypothesis Ledger

Status: completed

Scope:

- Extend `RelayDciTrajectory.v1` with phase tags:
  `explore`, `refine`, `inspect`, `verify`, and `answer_ready`.
- Add a compact hypothesis ledger derived from tool observations:
  candidate claim, supporting paths, refuting paths, unresolved terms,
  rejection reason, and latest next action.
- Keep the ledger diagnostic/AG-UI state only. Do not expose a model-visible
  retriever or hidden planner.

Artifacts:

- Updated trajectory builder/helper.
- Metric fixture covering phase transitions and hypothesis support/refutation.
- Implementation log entry describing the replay/privacy boundary.

Acceptance:

- A trajectory can explain why a candidate moved from unknown to supported or
  rejected.
- The ledger can be reconstructed from AG-UI/tool events.
- No searched/shared folder receives Relay cache/index/temp files.

Verification:

- new DCI trajectory phase smoke
- `pnpm agent:dci-metrics-smoke`
- `pnpm check`

### DCI2605IR-02 - Add Context-Window Grep Evidence

Status: completed

Scope:

- Add bounded context-window conjunction support to `grep` observations so
  sparse clues can satisfy `allTerms` across nearby lines or sections.
- Return match groups with `scope=line|context_window|file_sample`, required
  and optional term hits, excluded terms encountered nearby, snippets, and
  continuation guidance.
- Preserve ripgrep-first execution, result caps, cancellation, workspace
  containment, and the `--` separator before user/model patterns.

Artifacts:

- `RelayGrepObservation.v1` schema extension.
- Deterministic sparse-clue/context-window corpus.
- Regression for terms that are near each other versus far-apart false
  positives.

Acceptance:

- A single-line exact phrase is not required when the local context window
  provides the evidence.
- Far-apart or unrelated terms do not pass as conjunctive evidence.
- Existing line-level grep behavior remains compatible.

Verification:

- new DCI context-window grep smoke
- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-03 - Enforce Observation-Driven Refinement Gates

Status: completed

Scope:

- Add Agent Framework middleware/final-readiness checks for trajectories that
  contain only guide/glossary, zero-match, hard-negative, generic,
  prior-period, or no-evidence observations.
- Repair premature finals to the next safe observable local tool action when
  possible; otherwise fail fast with a protocol error.
- Require at least one observed-term refinement when a read observation
  introduces new vocabulary for an ambiguous user request.

Artifacts:

- Protocol/middleware refinement gate.
- Regression smokes for guide-only, zero-match-only, hard-negative-only,
  generic-only, prior-period-only, and no-evidence-only finals.

Acceptance:

- Copilot cannot finish a local evidence task using only weak or refuting
  observations.
- Repairs are visible as tool calls; Relay does not synthesize local answers.
- Provider/tool/protocol failures remain distinguishable.

Verification:

- updated `pnpm agent:dci-golden-smoke`
- new DCI final-refinement smoke
- `pnpm check`

### DCI2605IR-04 - Strengthen Structured Office/CSV/PDF Read Evidence

Status: completed

Scope:

- Extend supported `read` projections for CSV, xlsx/xlsm, docx, pptx, and PDF
  to expose bounded row/sheet/cell/page/section anchors where extraction
  supports them.
- Include extraction limitations in observations:
  unsupported binary Office formats, PDF without text layer, hidden sheets,
  truncated tables, cached formula limits, and extraction warnings.
- Keep this as exact read/evidence projection. Do not add a separate
  Office/PDF search engine.

Artifacts:

- Structured read observation updates.
- CSV row, xlsx sheet/cell, docx/pptx text, and PDF text-layer DCI fixtures.

Acceptance:

- Copilot can cite exact anchors for heterogeneous local evidence.
- Unsupported or partial extraction is explicit and cannot be mistaken for
  confirmed content.
- Full document contents stay out of default support bundles.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- new DCI heterogeneous-read smoke
- `pnpm check`

### DCI2605IR-05 - Add Deterministic Context Management Metrics

Status: completed

Scope:

- Extend DCI compaction artifacts with raw output bytes, projected bytes,
  kept anchors, dropped excerpts, retained hashes, and replay sufficiency.
- Keep deterministic truncation/compaction as the evidence source of truth.
- Keep model-generated summarization disabled by default.

Artifacts:

- Compaction metric projection in trajectory/support artifacts.
- Long-trajectory smoke that proves replay data survives compaction.

Acceptance:

- Long DCI runs stay within bounded Copilot context without losing the
  evidence skeleton.
- The support artifact can prove what was retained and what was dropped.
- No hidden lossy LLM summary is treated as evidence.

Verification:

- `pnpm agent:dci-context-smoke`
- new DCI compaction-metrics smoke
- `pnpm check`

### DCI2605IR-06 - Build Adversarial DCI Corpus Generator

Status: completed

Scope:

- Add a deterministic fixture generator for large local corpora with nested
  folders, misleading filenames, entity-name traps, prior-period copies,
  negated snippets, generic memos, guide/glossary files, and non-obvious
  evidence filenames.
- Include Markdown/text/CSV plus at least one supported Office/PDF fixture.
- Parameterize corpus size and distractor count so tests can exercise caps and
  continuation behavior without relying on shared folders.

Artifacts:

- Corpus generator script/helper.
- Generated-fixture tests for sparse clues, false positives, and
  heterogeneous evidence.

Acceptance:

- One exact filename match or one exact phrase search cannot pass the corpus.
- The gold evidence is findable only through observed local context and
  refinement.
- Test fixtures are deterministic and do not depend on external files.

Verification:

- new adversarial corpus smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-07 - Expand DCI Interface-Resolution Metrics

Status: completed

Scope:

- Extend `RelayDciTrajectoryMetrics.v1` with refinement depth, operator
  diversity, context-window conjunction, observation-to-next-action
  dependency, candidate rejection count, hard-negative read count,
  evidence-anchor locality, and accidental-answer prevention.
- Use the same metric helper for deterministic smokes and live E2E.

Artifacts:

- Updated metric helper and unit smoke.
- Failure messages that explain which DCI interface-resolution criterion
  failed.

Acceptance:

- A right final string without the required trajectory fails.
- Metric failures are diagnosable without reading raw Copilot logs.
- Existing DCI metric consumers remain compatible or get explicit schema
  version handling.

Verification:

- `pnpm agent:dci-metrics-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-08 - Upgrade Live Copilot DCI Hard Scenario

Status: completed

Scope:

- Upgrade `pnpm workbench:live-dci-e2e` or add a second live scenario that
  requires one exploratory search, one guide/context read, one refined search,
  one decoy read/rejection, and one exact evidence read.
- Save AG-UI events, trajectory, metrics, prompt/response diagnostics,
  screenshots when available, and failure classification under
  `dist/e2e/live-dci/`.
- Fail when Copilot reaches the right final file by chance without enough
  local observations.

Artifacts:

- Live DCI hard scenario runner/report.
- Failure classification update for provider, protocol, tool, and DCI-quality
  failures.

Acceptance:

- A signed-in Copilot run can solve the hard corpus through raw local tools.
- Provider/CDP/quota failures are classified separately from DCI logic
  failures.
- No mock model or fallback retriever can pass the live gate.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI2605IR-09 - Refine Workbench Hypothesis/Evidence Trace

Status: completed

Scope:

- Render the expanded DCI trajectory as a compact AG-UI-driven timeline:
  searches tried, terms learned, hypotheses supported/rejected, files read,
  evidence anchors, and final caveats.
- Keep raw JSON collapsed and avoid a ranked-result-page UX.
- Preserve the single generic Workbench surface; do not reintroduce search,
  Office, or code modes.

Artifacts:

- Workbench DCI timeline UI update.
- UX E2E assertion or screenshot artifact.

Acceptance:

- A user can see why a file was selected or rejected without inspecting raw
  JSON.
- The trace remains minimal and does not clutter non-DCI tasks.
- The UI is replayable from AG-UI events/state.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI2605IR-10 - Document Source Alignment And Release Gate

Status: completed

Scope:

- Update `docs/IMPLEMENTATION.md` with completed DCI interface-resolution
  changes, verification commands, known limitations, and live E2E outcome.
- Keep `PLANS.md`, `tasks.md`, `AGENTS.md`, and `README.md` aligned if public
  behavior changes.
- Reconfirm that active code does not revive `RelayDocumentSearch*`,
  SQLite/FTS, vector search, AionUi, OpenCode/OpenWork runtime, or Tauri.

Artifacts:

- Implementation log update.
- Hard-cut/source-of-truth consistency check.

Acceptance:

- Planning docs and implementation docs describe the same active DCI
  direction.
- Completed tasks have concrete verification artifacts.

Verification:

- `git diff --check`
- `pnpm check`

### DCI2605-01 - Add Explicit DCI Trajectory Contract

Status: completed

Scope:

- Define a compact `RelayDciTrajectory.v1` diagnostic shape derived from Agent
  Framework tool observations.
- Include tool order, searched terms, matched paths, zero-match states, read
  targets, anchors, excerpts/hashes, failed reads, context labels, rejected
  decoys, and final cited evidence.
- Keep the trajectory as AG-UI/support diagnostic state, not a model-visible
  `document_search` tool or hidden retriever.

Artifacts:

- Sidecar trajectory builder or event-to-trajectory helper.
- Redacted support/AG-UI artifact projection.
- Implementation log entry describing the privacy boundary.

Acceptance:

- A DCI trajectory can be reconstructed from AG-UI/tool events.
- No Relay cache/index/temp file is written into searched or shared folders.
- Failed reads and zero-match grep calls are represented as failed/empty
  observations, not evidence.

Verification:

- new trajectory smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI2605-02 - Replace Domain-Specific Read Recovery With Generic Recovery

Status: completed

Scope:

- Keep read admission restricted to explicit user paths, observed candidate
  paths, or exact existing workspace paths.
- Replace domain-specific recovery terms with generic extraction from:
  - original user request;
  - failed read target;
  - previous `glob`/`grep` terms;
  - previous matched paths and excerpts.
- When Copilot invents a plausible filename, repair to an observable `grep`
  refinement or return a clear protocol failure. Do not crash the run.

Artifacts:

- Generic read-admission recovery implementation.
- Invented-read regression smoke.

Acceptance:

- No hard-coded business/entity exception is needed for examples such as
  company-name false positives.
- Invented read targets are counted by DCI metrics and do not produce streaming
  exceptions.

Verification:

- new invented-read recovery smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-03 - Increase Grep Observation Resolution

Status: completed

Scope:

- Extend `grep` observations to carry grouped match context, required/optional
  term hits, context labels, truncation state, and continuation guidance.
- Keep filters pushed into ripgrep and keep `--` before user/model patterns.
- Keep labels deterministic and transparent: possible evidence, negative
  context, guide/glossary, prior-period, generic memo, and no-evidence.

Artifacts:

- `RelayGrepObservation.v1` schema update.
- Regression cases for Japanese and English negation, prior period, guide,
  generic memo, and evidence snippets.

Acceptance:

- Copilot can distinguish filename/entity hits from local content evidence.
- A single weak lexical match is insufficient to satisfy DCI final readiness.

Verification:

- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-04 - Harden Evidence-First Read Observations

Status: completed

Scope:

- Ensure `read` returns stable anchors, bounded excerpts, text hashes,
  context labels, truncation state, and continuation guidance.
- Extend DCI coverage to supported Office/PDF/CSV reads without adding a
  separate Office/PDF search engine.
- Keep full local document contents out of default support bundles unless the
  user explicitly opts in.

Artifacts:

- `RelayReadObservation.v1` anchor/hash/context audit.
- Office/PDF/CSV DCI fixture or smoke updates.

Acceptance:

- Final answers can cite exact observed file anchors.
- Office/PDF/CSV reads use the same generic DCI recipe where extraction is
  supported.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- new CSV/Office DCI smoke when fixture is added
- `pnpm check`

### DCI2605-05 - Add Deterministic DCI Context Compaction

Status: completed

Scope:

- Add deterministic compaction for long DCI investigations.
- Preserve the ordered skeleton: terms tried, match counts, candidate paths,
  read anchors, hashes, rejected decoys, and current hypotheses.
- Do not use hidden LLM summarization as a source of truth.

Artifacts:

- Agent Framework middleware or sidecar helper for DCI compaction.
- Long-trajectory smoke that proves bulky excerpts are compacted while audit
  data remains replayable.

Acceptance:

- Long local investigations do not flood Copilot context.
- Compacted state remains sufficient for final-readiness and support replay.

Verification:

- `pnpm agent:dci-context-smoke`
- new long-trajectory DCI smoke
- `pnpm check`

### DCI2605-06 - Expand DCI Golden Corpus

Status: completed

Scope:

- Add deterministic corpora that require:
  - guide/glossary vocabulary discovery;
  - sparse clue conjunction;
  - misleading entity-name rejection;
  - prior-period rejection;
  - generic memo rejection;
  - negated local-context rejection;
  - exact evidence read of a non-obvious filename.
- Include at least one CSV/Office/PDF fixture once read-anchor behavior is
  stable.

Artifacts:

- Fixture generator or inline test corpus.
- Updated deterministic DCI golden smoke.

Acceptance:

- A single filename match or one exact phrase search cannot pass.
- Gold evidence is found only after local context is observed and terms are
  refined.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-07 - Add DCI Metric Unit Tests

Status: completed

Scope:

- Add direct tests for `RelayDciTrajectoryMetrics.v1` definitions.
- Cover raw-tool-only behavior, weak-clue conjunction, query expansion,
  coverage, exact read localization, hard-negative rejection, failed tools,
  invented read targets, and final citation.
- Ensure deterministic and live E2E use the same metric helper.

Artifacts:

- DCI metric unit smoke.
- Shared fixture cases for successful and failing trajectories.

Acceptance:

- Metric failures are explainable without reading live Copilot logs.
- Live and mock E2E cannot silently diverge in what "DCI pass" means.

Verification:

- new DCI metric smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-08 - Refine AG-UI DCI Investigation Trace

Status: completed

Scope:

- Render the DCI trajectory as a compact investigation timeline:
  searches tried, files surfaced, files inspected, evidence snippets, rejected
  decoys, and final cited file.
- Keep the default Workbench surface minimal and keep raw observations
  collapsed.
- Ensure the UI is driven by AG-UI events/state, not custom hidden routes.

Artifacts:

- Workbench timeline refinement.
- UX E2E assertion or screenshot update.

Acceptance:

- A user can see why the final file was selected without opening raw JSON.
- The UI does not reintroduce separate search/Office/code modes.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI2605-09 - Strengthen Live Copilot DCI Release Gate

Status: completed

Scope:

- Keep `pnpm workbench:live-dci-e2e` as the signed-in Copilot gate.
- Save AG-UI events, DCI trajectory metrics, final result,
  prompt/response diagnostics, screenshots where available, and failure
  classification under `dist/e2e/live-dci/`.
- Fail when the right final file is reached by chance without local context
  checks.

Artifacts:

- Updated live DCI E2E runner and report schema.
- Implementation log entry template for pass/fail classification.

Acceptance:

- Provider/CDP/quota failures are clearly classified.
- DCI logic failures are distinguishable from Copilot/Edge environment
  failures.
- No mock model, heuristic local answer, or fallback search engine can pass the
  live DCI gate.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI2605-10 - Record Implementation And Source Alignment

Status: completed

Scope:

- Update `docs/IMPLEMENTATION.md` with the completed code/test changes,
  verification commands, and known limitations.
- Keep `PLANS.md`, `tasks.md`, `AGENTS.md`, and `README.md` aligned if any
  public behavior changes.
- Reconfirm that active code does not revive `RelayDocumentSearch*`,
  SQLite/FTS, vector search, AionUi, OpenCode/OpenWork runtime, or Tauri.

Artifacts:

- Implementation log update.
- Hard-cut / source-of-truth consistency check.

Acceptance:

- The plan, tasks, implementation log, and active code describe the same DCI
  direction.
- Completed tasks have concrete verification artifacts.

Verification:

- `git diff --check`
- `pnpm check`

### DCIFS01 - Add Search Trajectory Ledger

Status: completed

Scope:

- Build a run-local search trajectory ledger from Agent Framework tool
  observations.
- Record, at minimum:
  - `glob` patterns and surfaced paths;
  - `grep` terms, allTerms/anyTerms/excludeTerms, matched paths, zero-match
    states, and matched terms;
  - `read` targets, anchors, evidenceState, excerpts/hashes, and failures;
  - candidate/evidence/negative/guide/prior-period/generic/not-found labels
    derived from observed tool results.
- Keep the ledger internal/diagnostic. Do not expose a new model-visible
  `document_search` tool.

Artifacts:

- Sidecar trajectory ledger implementation.
- AG-UI trace payload or support artifact containing the ledger.
- Implementation log entry describing the ledger schema and privacy boundary.

Acceptance:

- The ledger is reconstructable from raw AG-UI/tool events.
- Failed reads and zero-match greps are represented as failed/empty evidence,
  not as completed evidence.
- No shared-folder cache/index files are created.

Verification:

- new ledger smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCIFS02 - Enforce Evidence Readiness From The Ledger

Status: completed

Scope:

- Replace prompt-only "do not finalize too early" behavior with ledger-backed
  final readiness checks.
- Block or repair final answers when:
  - no local file observation exists;
  - the latest useful search has zero matches;
  - only guide/glossary documents were read;
  - all observed candidates are negative/prior-period/generic;
  - the only `read` attempts failed;
  - no exact evidence read exists for the final cited file.
- Prefer another `grep`, `glob`, or exact `read` of an observed path over
  allowing a premature final.

Artifacts:

- Protocol guard / Agent Framework middleware update.
- Regression smoke covering guide-only, zero-match, failed-read, and
  hard-negative-only trajectories.

Acceptance:

- "local tools unavailable", invented no-match, and guide-only final answers
  do not pass when more local search is possible.
- The repair path remains tool-based and observable; no hidden local answer is
  generated by Relay.

Verification:

- new final-readiness ledger smoke
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS03 - Harden Read Target Admission

Status: completed

Scope:

- Restrict `read` in search trajectories to:
  - explicit user-provided paths;
  - paths surfaced by prior `glob`, `grep`, or `read` observations in the same
    run;
  - exact workspace paths that currently exist.
- If Copilot invents a plausible filename, return a normal tool observation or
  protocol correction that points back to observed candidates.
- Do not crash the run on invented read targets.

Artifacts:

- Read admission guard.
- Smoke covering invented README/fake-report reads after a zero-match grep.

Acceptance:

- Invented paths are counted in DCI metrics and blocked or converted to an
  actionable observation.
- Existing legitimate explicit path reads still work.

Verification:

- new invented-read smoke
- `pnpm agent:golden-smoke`
- `pnpm check`

### DCIFS04 - Improve Grep Observation Semantics

Status: completed

Scope:

- Extend `grep` observations with lightweight context labels derived from
  excerpts:
  - `possible_evidence`;
  - `negative_context`;
  - `guide_or_glossary`;
  - `prior_period`;
  - `generic_context`.
- Keep labels deterministic and transparent. Do not hard-code company-specific
  exceptions.
- Include enough excerpt/context information for Copilot to refine terms.

Artifacts:

- Grep observation schema update.
- Grep smoke with Japanese/English negation, prior-period, guide, and generic
  examples.

Acceptance:

- A filename/entity match with local negation is clearly distinguishable from
  content evidence.
- Labels improve Copilot behavior but do not replace `read` for final
  evidence.

Verification:

- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS05 - Add DCI Trajectory Metrics To Deterministic Smokes

Status: completed

Scope:

- Move the live-only `RelayDciTrajectoryMetrics.v1` checks into deterministic
  mock Copilot smokes.
- Cover:
  - raw-tool-only investigation;
  - weak-clue conjunction;
  - query expansion;
  - coverage of the gold file in grep observations;
  - exact evidence localization by read;
  - hard-negative rejection;
  - failed-tool and invented-read counts.

Artifacts:

- Shared DCI metric helper for live and deterministic tests.
- Updated `dci-golden-smoke` and replay fixture if needed.

Acceptance:

- DCI quality can be tested without live Copilot quota.
- The live E2E and deterministic smoke use the same metric definitions.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCIFS06 - Add Multi-Hop File Search Corpus

Status: completed

Scope:

- Add a deterministic corpus where the first useful file only reveals the
  vocabulary needed to find the true evidence file.
- Include:
  - a glossary/guide that is not evidence;
  - an entity-name decoy;
  - a prior-period reference;
  - a generic memo;
  - a gold evidence file with non-obvious filename;
  - optional CSV/Office fixture once anchor extraction is stable.
- Require at least one refinement after observing local content.

Artifacts:

- Fixture generator or inline test corpus.
- DCI golden smoke scenario.

Acceptance:

- A single exact search or filename match cannot pass.
- The gold file can be found only by using terms learned from local context.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS07 - Expose DCI Investigation Timeline In AG-UI

Status: completed

Scope:

- Render the trajectory ledger in the Workbench as a compact investigation
  trail:
  - searched terms;
  - surfaced files;
  - inspected files;
  - evidence snippets;
  - rejected decoys;
  - final cited evidence.
- Keep the default surface minimal. Raw JSON and support details stay
  collapsed.

Artifacts:

- Workbench UI update.
- UX E2E assertion or screenshot update.

Acceptance:

- Users can see why a file was selected without reading raw tool JSON.
- The UI does not reintroduce separate search/Office/code modes.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCIFS08 - Run And Record Live DCI File Search E2E

Status: completed

Scope:

- Run `pnpm workbench:live-dci-e2e` after DCIFS01-DCIFS07 pass.
- Confirm live Copilot can complete an ambiguous file-search investigation
  using raw local tools only.
- Save:
  - AG-UI events;
  - DCI trajectory metrics;
  - final result;
  - provider/CDP diagnostics;
  - failure classification if blocked.

Artifacts:

- `dist/e2e/live-dci/` run output.
- `docs/IMPLEMENTATION.md` entry with command and result.

Acceptance:

- Live run passes the DCI trajectory metric gate, not just final-answer text.
- Provider/CDP/quota failures are classified without fallback answers.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI01 - Document The DCI Tool Contract Boundary

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a DCI section that explains how
  `glob`, `grep`, `read`, bounded `bash`, and `apply_patch` compose into raw
  corpus interaction.
- Explicitly state that Relay will not revive `RelayDocumentSearch*`,
  SQLite/FTS, or a dedicated search mode for this milestone.
- Map DCI paper concepts to Relay ownership:
  - Agent Framework: session, continuation, middleware, tool loop;
  - OpenCode: model-facing local tool shape;
  - Relay: policy, Office/PDF extraction, Windows/shared-folder safety,
    diagnostics, packaging;
  - AG-UI: investigation trace and approvals.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Implementation log entry with the paper/repo references.

Acceptance:

- The doc makes it clear that DCI is a generic agent recipe over existing
  tools, not a new retrieval subsystem.
- The doc lists which DCI capabilities are implemented as first-class tools
  and which are intentionally blocked or bounded.

Verification:

- `git diff --check`

### DCI02 - Add DCI-Grade Structured Grep

Status: completed

Scope:

- Extend the Agent Framework `grep` function signature with structured
  arguments for:
  - `allTerms`;
  - `anyTerms`;
  - `excludeTerms`;
  - `fixedStrings`;
  - `caseInsensitive`;
  - `contextLines`;
  - `includeGlobs`;
  - `excludeGlobs`;
  - `maxMatchesPerFile`;
  - `limit`;
  - `timeoutMs`.
- Keep the existing `pattern` and `glob` arguments as OpenCode-compatible
  simple paths.
- Compile structured filters to safe ripgrep argv. Always put `--` before
  model/user patterns.
- Return structured observations with path, displayPath, line number, excerpt,
  matched terms, truncation, and continuation guidance.
- Do not route Office/PDF containers through `grep`; keep exact `read` for
  those.

Artifacts:

- Sidecar grep implementation update.
- Tool catalog snapshot update.
- Grep smoke covering conjunctive terms, exclusion terms, context lines,
  caps, and a pattern starting with `-`.

Acceptance:

- A request such as "部品売上" can require both concept terms to appear in the
  same file/context before a candidate is promoted.
- Misleading entity-name-only matches can be demoted by requiring contextual
  evidence instead of relying on filename rank.
- Existing simple `grep(pattern, glob)` behavior remains compatible.

Verification:

- new DCI grep smoke
- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:rg-stream-smoke`
- `pnpm check`

### DCI03 - Improve Read Observations For Evidence Anchors

Status: completed

Scope:

- Extend `read` observations with stable evidence anchors:
  - text/code: line ranges and offset/limit continuation;
  - Excel/CSV: sheet/table/cell/range hints when available;
  - Word/PDF/PPT: page/section/slide anchors when available.
- Keep full local artifacts in Relay storage/support bundles, but project
  bounded excerpts and hashes to Copilot.
- Add `evidenceState` values that distinguish filename/path candidates,
  generic content hits, conjunctive concept hits, and exact local evidence.

Artifacts:

- Sidecar read observation update.
- Office/PDF extraction smoke updates.
- Updated AG-UI replay fixture if event payload shape changes.

Acceptance:

- Copilot can cite or reason from exact local observations without receiving
  entire large files.
- Office/PDF candidate promotion can depend on actual extracted content when
  available.
- Local full artifacts remain user-controlled and redacted by default in
  support bundles.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI04 - Add Agent Framework DCI Context Middleware

Status: completed

Scope:

- Implement deterministic tool-result truncation by tool type in the Agent
  Framework middleware/projection layer.
- Add compaction that preserves the ordered trajectory skeleton:
  tool name, args summary, paths, hashes, counts, latest evidence snippets,
  and artifact IDs.
- Keep the most recent turns intact and compact older bulky observations when
  accumulated tool output crosses a threshold.
- Do not add LLM summarization in this task. Summarization can be considered
  later only if replayable and observable.

Artifacts:

- Middleware/projection update.
- Context compaction smoke with repeated `grep`/`read` observations.
- Implementation note describing thresholds and artifact retention.

Acceptance:

- Long DCI investigations do not flood Copilot with raw tool output.
- The AG-UI replay/support bundle can reconstruct what was searched and read.
- Compaction cannot hide a mutation or approval event.

Verification:

- new context compaction smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI05 - Add DCI Search Recipe To Framework Guidance

Status: completed

Scope:

- Add concise Agent Framework instruction/projection guidance for DCI behavior:
  search direct terms, combine weak clues, inspect local context, extract new
  terms/entities, refine, cross-check, and answer only after relevant
  observations exist.
- Keep this guidance generic across local file search, codebase exploration,
  Office review, and evidence-backed Q&A.
- Do not add a `document_search` tool, a fixed taxonomy, or a task-specific
  planner.

Artifacts:

- Agent instructions/tool projection update.
- Golden smoke where a misleading filename/entity candidate must not win over
  a lower-ranked file with conjunctive local evidence.

Acceptance:

- The model has enough guidance to use DCI-style iterative exploration without
  being forced into a brittle fixed query plan.
- `final` is blocked or corrected when local evidence was required but no
  local observation exists.

Verification:

- new DCI golden smoke
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### DCI06 - Render AG-UI Investigation Timeline

Status: completed

Scope:

- Update Workbench run rendering so DCI-style runs show:
  - search terms tried;
  - files inspected;
  - evidence snippets/anchors;
  - refinements;
  - caveats and terminal confidence.
- Keep the default surface minimal and professional. Diagnostics and raw JSON
  stay collapsed under support details.
- Ensure approvals and mutations remain visually distinct from read-only
  investigation events.

Artifacts:

- Workbench timeline UI update.
- UX E2E snapshot or Playwright assertion.

Acceptance:

- Users can understand why a candidate was selected without reading raw
  Copilot/tool JSON.
- The UI does not reintroduce separate "file search / Office / code" modes.
- The trace remains AG-UI-event driven.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI07 - Add Local Corpus Golden Benchmarks

Status: completed

Scope:

- Create deterministic local corpora under test fixtures:
  - sparse clue conjunction;
  - misleading entity-name match;
  - exact phrase with nearby negation;
  - Office/Excel content evidence;
  - codebase symbol lookup and edit verification.
- Run them through the Agent Framework mock Copilot path so the acceptance does
  not depend on live Copilot quota.
- Save sanitized AG-UI event logs as replay fixtures.

Artifacts:

- DCI golden smoke script.
- Fixture corpus.
- Replay fixtures.

Acceptance:

- The benchmark proves DCI behavior over raw local files, not retriever rank.
- The same generic tools handle search, Office inspection, and codebase
  exploration.

Verification:

- new DCI golden smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI08 - Build Live DCI E2E Corpus And Runner

Status: completed

Scope:

- Add a live E2E runner, e.g. `scripts/workbench-live-dci-e2e.mjs`, that uses
  the real signed-in M365 Copilot provider through Edge CDP.
- The runner must create an isolated temporary corpus with:
  - sparse clue conjunction;
  - misleading entity-name/filename decoys;
  - local context negation;
  - text/Markdown/CSV files;
  - Office fixtures once DCI03 anchors are available.
- The user task should be natural language and should not reveal the exact file
  names that contain the answer.
- The runner must require actual Relay tools through AG-UI/Agent Framework:
  `glob`, `grep`, `read`, and, where appropriate, bounded `bash`.
- The runner must fail if the final answer appears before required local tool
  observations exist.

Artifacts:

- Live DCI E2E script.
- Temporary-corpus fixture generator.
- Acceptance assertions for tool sequence, evidence file, final answer, and
  decoy rejection.
- Run output under `dist/e2e/live-dci/`.

Acceptance:

- The script can run independently from the older live project E2E.
- It verifies the DCI pattern from the paper: iterative raw-corpus interaction,
  local context reads, and refined search.
- It does not use `RelayDocumentSearch*`, SQLite/FTS, a mock model, or a
  fallback heuristic answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command when Edge/Copilot is available
- `pnpm check`

### DCI09 - Add Live DCI E2E Classification And Artifacts

Status: completed

Scope:

- Classify live DCI failures as:
  - provider quota/rate limit;
  - Edge CDP readiness or selector drift;
  - Copilot prompt delivery/response extraction;
  - Agent Framework continuation/session state;
  - OpenCode tool contract violation;
  - AG-UI replay/state rendering;
  - DCI logic failure.
- Save sanitized artifacts:
  - AG-UI event log;
  - framework trace IDs;
  - tool-call trajectory summary;
  - evidence snippets/anchors;
  - decoy rejection evidence;
  - provider diagnostics;
  - Workbench screenshot.
- Redact raw document contents by default. Include enough excerpts to prove
  acceptance without exposing unnecessary local data.

Artifacts:

- Updated live DCI E2E report schema.
- Implementation log entry template for live DCI runs.
- Optional AG-UI replay fixture derived from a sanitized successful run.

Acceptance:

- A failed live DCI run is actionable without reading raw Copilot logs.
- A successful run proves the paper-style DCI behavior, not just Copilot
  connectivity.
- Release notes can distinguish provider-blocked, framework-blocked, and
  DCI-logic failures.

Verification:

- live DCI E2E command
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI10 - Run Live Copilot DCI E2E And Record Result

Status: completed (live attempt environment-blocked)

Scope:

- After DCI01-DCI09 pass, run a signed-in live Copilot E2E that performs a
  realistic local-corpus investigation.
- Use the DCI08 fixture that requires iterative search, decoy rejection, and
  local context checks.
- Classify failures as provider/CDP, framework continuation, tool contract,
  AG-UI replay, or DCI logic.
- Record the outcome in `docs/IMPLEMENTATION.md` with artifact paths and the
  exact command.

Artifacts:

- `dist/e2e/live-dci/` run artifacts.
- Implementation log entry with command, result, and failure/success class.

Acceptance:

- Live Copilot can complete at least one DCI investigation without relying on a
  dedicated document-search mode.
- The run demonstrates at least two search/refinement steps and at least one
  local context `read` before final answer.
- The final answer identifies evidence-backed files/snippets and rejects the
  decoy candidate.
- If Copilot or Edge fails, the run ends with a structured provider/adapter
  diagnostic, not a fallback answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command, e.g. `pnpm workbench:live-dci-e2e`
- `pnpm check`

### POSTLIVE01 - Keep Tool Validation Failures Out Of Approval

Status: completed

Scope:

- Audit current validation paths that throw before Agent Framework can feed a
  tool result back into the same session, starting with `apply_patch_invalid`.
- Keep invalid mutations away from user approval.
- Repair malformed Copilot JSON tool projections once in the M365 provider
  adapter before they can become approval requests; execution-time validation
  failures remain Agent Framework tool observations.
- Preserve hard AG-UI `RUN_ERROR` only for provider, framework, or executor
  health failures that cannot safely continue.

Artifacts:

- Sidecar adapter path for validation repair before approval plus normal
  framework observation feedback after tool execution starts.
- Regression smoke covering invalid patch -> correction -> valid patch in the
  same session.
- Implementation note explaining why this is Agent Framework continuation
  rather than a Relay retry planner.

Acceptance:

- Malformed `apply_patch` does not ask the user for approval.
- Copilot receives one strict repair prompt and may return a corrected
  OpenCode-shaped tool call without a new user run.
- AG-UI replay shows only the corrected tool call or a structured blocked
  state; the invalid mutating call never reaches approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### POSTLIVE02 - Define OpenCode-Style Read Observation Projection

Status: completed

Scope:

- Replace raw file-body prompt projection with an OpenCode-style read
  observation contract: path, size, hash, excerpt, tail, omitted count, and
  explicit `read` continuation guidance for exact context.
- Keep full local content in AG-UI/support artifacts and local tool results.
- Ensure `read(offset, limit)` remains the way to request exact follow-up
  context instead of injecting entire files into every Copilot turn.
- Cover HTML/JS/CSS/Markdown reads because live project E2E times out after
  read observations.

Artifacts:

- Prompt-safe read observation projector.
- Fixture or smoke showing a large `read` result projected without raw body
  echo.
- Documentation update in `docs/OPENCODE_TOOL_CONTRACT.md` if the public
  read-result semantics are clarified.

Acceptance:

- Copilot prompt payload after `read` is bounded and deterministic.
- Follow-up edits still have a clear path to exact context through `read`
  offset/limit.
- AG-UI replay/support bundles still include enough data to debug the full
  file read.

Verification:

- read observation projection smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### POSTLIVE03 - Make Provider Timeout A Resumable Framework State

Status: completed

Scope:

- Keep the same Agent Framework `AgentSession` and AG-UI thread when the M365
  Copilot provider times out after a tool observation.
- Add a named provider-adapter retry/resume policy only at the Copilot CDP
  boundary. It must be visible in framework trace/AG-UI diagnostics and must
  not fabricate a tool/final decision.
- Surface a user-visible blocked state only after retry policy is exhausted.
- Ensure timeout classification distinguishes provider response timeout from
  framework continuation timeout, approval wait, and tool execution timeout.

Artifacts:

- Provider timeout state/trace update.
- Resume or retry smoke using mock Copilot timeout followed by success.
- Updated live E2E classification assertions.

Acceptance:

- A provider timeout after a tool result does not lose session context.
- A retry, when performed, is recorded as provider-adapter behavior.
- If still blocked, AG-UI replay shows a named provider-blocked terminal state.

Verification:

- provider timeout continuation smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE04 - Centralize Copilot Patch Projection Repair Diagnostics

Status: completed

Scope:

- Treat Markdown Add File leading-`+` repair as Copilot projection repair, not
  as relaxed OpenCode patch grammar.
- Move repair notes into trace/support diagnostics and approval metadata so
  users can see that the approved patch is the revalidated OpenCode form.
- Add negative cases showing non-Markdown malformed Add File bodies still fail.

Artifacts:

- Repair metadata in framework trace or tool projection diagnostics.
- Smoke fixture covering repairable Markdown and non-repairable malformed
  patch.

Acceptance:

- The model-facing contract remains strict OpenCode `patchText`.
- Repair is deterministic, narrow, and observable.
- Non-repairable malformed patches remain blocked before approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE05 - Reduce Relay AAE Authority To Middleware Projection

Status: completed

Scope:

- Review remaining `RelayAdmissibleActionEnvelope` authority after LIVEFIX.
- Move any remaining durable final/tool/question eligibility into Agent
  Framework middleware/session state.
- Keep the envelope only as a Copilot prompt projection and diagnostic
  serialization, or document the remaining deletion blocker.

Artifacts:

- Middleware/projection refactor or explicit blocker note.
- Updated `docs/HARNESS_ARCHITECTURE.md` delete/adapt/keep matrix.

Acceptance:

- The framework registry and middleware are the source of tool availability.
- Prompt text cannot be the only enforcement point for `final`, `ask_user`, or
  mutation requirements.
- No new Relay-specific planner state is introduced.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### POSTLIVE06 - Split Live E2E Acceptance By Framework Capability

Status: completed

Scope:

- Split live E2E reporting into canary, project creation, project improvement,
  and provider-blocked continuation outcomes.
- Save AG-UI event logs and framework traces for each stage.
- Make project improvement the release-readiness gate once provider availability
  is sufficient; provider-blocked remains acceptable for development runs only
  when clearly classified.

Artifacts:

- Updated live E2E script/reporting.
- AG-UI replay fixture or assertion for project creation and read-continuation
  provider-blocked outcomes.
- Implementation log entry.

Acceptance:

- A create-pass/improve-provider-timeout run is reported as exactly that, not
  as generic failure or full success.
- The same script can prove a full create -> improve -> render pass when
  Copilot responds.
- Release readiness cannot silently ignore project-improvement failure.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

### LIVEFIX01 - Capture Live E2E Baseline And Failure Classes

Status: completed

Scope:

- Record the latest live canary and multi-file project E2E results in
  `docs/IMPLEMENTATION.md`.
- Classify failures as:
  - provider quota;
  - Copilot CDP prompt insertion/composer normalization;
  - OpenCode tool contract validation;
  - Agent Framework continuation/final eligibility;
  - AG-UI replay/artifact export.
- Link the concrete artifacts under `dist/e2e/live-copilot/` and
  `dist/e2e/live-project/` without committing sensitive prompt dumps.

Artifacts:

- Implementation log entry with command, result, and classification.
- Optional sanitized excerpt or fixture when it is safe to commit.

Acceptance:

- The passing lightweight canary and failing project E2E are recorded as
  different outcomes.
- A failed project run is not described as quota-limited when Copilot was
  available.
- The next fix task can start from a named failure class, not a vague
  "Copilot unstable" bucket.

Verification:

- `git diff --check`

### LIVEFIX02 - Add OpenCode `apply_patch` Conformance Gate

Status: completed

Scope:

- Keep `apply_patch(req:patchText)` as the only model-visible patch shape.
- Validate `patchText` grammar before approval and execution.
- Return malformed patches as structured tool observations in the same Agent
  Framework session.
- Add golden cases for:
  - valid multi-file add;
  - valid update;
  - malformed add-file body missing leading `+`;
  - duplicate Begin/End envelopes;
  - legacy executor-only `patch` compatibility.

Artifacts:

- Sidecar conformance validator or existing validator integration.
- Regression smoke/fixture for malformed patch observations.
- Updated `docs/OPENCODE_TOOL_CONTRACT.md` only if the public contract changes.

Acceptance:

- A malformed patch never reaches approval as a side-effect action.
- Copilot receives a structured observation that tells it exactly why the patch
  failed and can continue in the same `AgentSession`.
- No new Relay-specific patch tool or argument name is introduced.

Verification:

- `pnpm agent:tool-catalog-smoke`
- patch conformance smoke
- `pnpm check`

### LIVEFIX03 - Harden Copilot CDP Composer Normalization

Status: completed

Scope:

- Keep prompt insertion, submission, and response extraction inside the M365
  Copilot CDP provider adapter.
- Normalize both intended and visible composer text before corruption checks:
  line endings, trailing newline, Unicode normalization, zero-width
  characters, and Copilot markdown/code-fence rendering transformations.
- Save a small redacted prompt-diff artifact when normalized verification
  still fails.
- Do not submit when normalized verification fails; return a provider-adapter
  blocked error with diagnostics.

Artifacts:

- Provider adapter normalization helper.
- Unit/smoke coverage for one-character composer differences.
- Redacted diagnostic fixture.

Acceptance:

- Benign one-character UI normalization differences do not fail live E2E.
- Real prompt corruption fails before submit and points to the exact
  normalized diff.
- The adapter does not make tool/final eligibility decisions.

Verification:

- Copilot prompt insertion smoke
- `pnpm workbench:live-copilot-e2e` when quota allows
- `pnpm check`

### LIVEFIX04 - Compact Tool Observations Through Framework State

Status: completed

Scope:

- Make tool observations deterministic, bounded, and artifact-backed before
  they are projected into Copilot prompts.
- For `read` and large command outputs, send hash, size, artifact ID, concise
  summary, and bounded excerpt by default.
- Preserve exact full content as a local artifact for diagnostics and follow-up
  tool use.
- Ensure compaction rules are middleware/framework state rules, not
  task-specific prompt folklore.

Artifacts:

- Observation compaction implementation or documented wiring to existing
  framework state.
- Fixture showing compacted `read` observation for HTML/JS/CSS files.
- Implementation log entry.

Acceptance:

- Follow-up edit tasks still have enough context to act correctly.
- Copilot composer payloads are smaller and less prone to CDP insertion
  corruption.
- AG-UI replay and support bundles still expose artifact IDs needed for debug.

Verification:

- transcript/observation smoke
- AG-UI replay smoke
- `pnpm check`

### LIVEFIX05 - Make Agent Framework Continuation The Terminal Authority

Status: completed

Scope:

- Audit timeout/final/continuation logic after tool observations.
- Ensure the same `AgentSession` owns continuation after tool result feedback.
- Move any remaining Relay-only final eligibility or continuation timers into
  framework middleware or a thin framework-adapter policy.
- Classify timeout source as provider response, framework continuation,
  approval wait, or tool execution.

Artifacts:

- Continuation/final eligibility refactor.
- Session continuation smoke covering: tool error -> retry, successful
  mutation -> final, and read -> mutation.
- Implementation log entry.

Acceptance:

- A successful tool call followed by a missing final does not become an
  unclassified `StreamingError`.
- A malformed patch observation can continue to a corrected patch or a
  structured blocked state.
- `final` and `question` remain middleware decisions.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### LIVEFIX06 - Make AG-UI Replay The Live E2E Acceptance Surface

Status: completed

Scope:

- Save AG-UI event logs for lightweight canary and multi-step project E2E.
- Make the replay smoke validate:
  - run lifecycle;
  - tool call args and results;
  - malformed tool observation;
  - final or structured blocked state;
  - artifact references.
- Keep raw Relay support dumps as attachments, not the primary acceptance
  format.

Artifacts:

- Live E2E AG-UI event log export.
- Replay fixture or test update.
- Implementation log entry.

Acceptance:

- A live E2E failure can be explained from AG-UI replay plus framework trace.
- Workbench-visible state does not require parsing Relay-only raw event text.

Verification:

- `pnpm agent:agui-replay-smoke`
- live project E2E artifact inspection
- `pnpm check`

### LIVEFIX07 - Rerun Live Copilot Project E2E

Status: completed

Scope:

- After LIVEFIX02 through LIVEFIX06 pass deterministic checks, rerun:
  - lightweight signed-in Copilot canary;
  - multi-file project creation;
  - follow-up project improvement.
- Treat provider quota as provider-blocked.
- Treat prompt corruption, malformed patch loops, or unclassified streaming
  errors as harness failures.

Artifacts:

- Ignored live E2E artifacts under `dist/e2e/`.
- Implementation log entry with commands and outcome.

Acceptance:

- If Copilot is available, the project E2E reaches final output after creation
  and after improvement.
- If Copilot is unavailable, the result is a structured provider-blocked state.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

The completed `REUSE*` queue below is retained as the foundation for the new
`LIVEFIX*` queue. It reduced wheel-reinvention risk by forcing every
Relay-owned harness component to map to Microsoft Agent Framework, AG-UI,
OpenCode, MCP, or a documented Relay-only local policy/tool-body need.

### REUSE01 - Build Delete/Adapt/Keep Matrix

Status: completed

Scope:

- Inventory every active harness-facing component in `apps/sidecar` and
  Workbench code, including:
  - `RelayTurnState`;
  - `RelayAdmissibleActionEnvelope`;
  - `RelayProtocolGuard`;
  - approval bridge/resume code;
  - tool registry/projection code;
  - `RelayToolObservation`;
  - Copilot CDP transport;
  - Workbench event/state rendering.
- For each component, classify it as:
  - `delete`: replaced by Agent Framework / AG-UI / OpenCode / MCP;
  - `adapt`: thin adapter over a framework primitive;
  - `keep`: Relay-owned because of M365 Copilot CDP, workspace policy,
    packaging, OfficeCLI, or local safety.
- Add the matrix to `docs/HARNESS_ARCHITECTURE.md`.

Artifacts:

- Updated `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- No active component remains in an uncategorized "Relay harness" bucket.
- Every `keep` item has a concrete reason tied to Copilot CDP, local policy,
  approved local function bodies, packaging, or diagnostics.
- Every `delete`/`adapt` item names the exact replacement primitive.

Verification:

- `rg -n "delete|adapt|keep|RelayTurnState|RelayAdmissibleActionEnvelope|ApprovalRequired|AG-UI|OpenCode|MCP" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

### REUSE02 - Align `apply_patch` Argument Shape With OpenCode

Status: completed

Scope:

- Change the model-facing `apply_patch` argument from Relay-specific `patch`
  to OpenCode-compatible `patchText`.
- Keep executor compatibility for legacy `patch`, but hide it from prompts,
  catalog snapshots, and new tests.
- Update the tool catalog smoke, protocol-state smoke, golden smoke, and live
  project E2E script.
- Update `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Sidecar tool registration/projection update.
- Updated smoke fixtures.
- Implementation note.

Acceptance:

- New prompts and catalog snapshots show `apply_patch(req:patchText)`.
- Executor still accepts old `patch` only as compatibility.
- No new model-visible Relay-only patch argument remains.

Verification:

- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE03 - Decide OpenCode Built-In Coverage

Status: completed

Scope:

- Compare Relay's model-facing tools with OpenCode built-ins:
  `bash`, `edit`, `write`, `read`, `grep`, `glob`, `list`, `apply_patch`,
  `skill`, `todoread`, `todowrite`, `webfetch`, `websearch`, and `question`.
- For each tool, decide `adopt now`, `defer`, `deny`, or `extension`.
- Specifically evaluate:
  - `list` as a read-only directory overview tool;
  - `todoread`/`todowrite` as session-scoped planning artifacts for complex
    work;
  - `skill` as future packaged guidance, not ad hoc prompt text;
  - `webfetch`/`websearch` as denied unless policy later allows them.
- Record the decision in `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Optional tool-catalog fixture update only if a tool is adopted.

Acceptance:

- Every OpenCode built-in has an explicit decision.
- If a tool is not adopted, the reason is policy, scope, or user value, not
  oversight.
- No Relay-specific replacement is proposed when an OpenCode tool is the right
  fit.

Verification:

- `rg -n "list|todoread|todowrite|skill|webfetch|websearch|question" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

### REUSE04 - Evaluate Local MCP Reuse Before More Tool Bodies

Status: completed

Scope:

- Review Agent Framework local MCP support against Relay's current local
  function tools.
- Evaluate local MCP candidates for:
  - filesystem read/list/search;
  - git status/diff;
  - sqlite/index access;
  - future app integrations.
- For each candidate, decide whether to:
  - use Agent Framework local MCP;
  - keep Relay function body;
  - expose a Relay tool as local MCP later;
  - reject due to data/security/packaging policy.

Artifacts:

- Add `docs/MCP_REUSE_DECISION.md`.
- Link the decision from `PLANS.md` and `docs/HARNESS_ARCHITECTURE.md`.

Acceptance:

- No future generic local tool can be added without referencing the MCP reuse
  decision.
- Decisions include security, Windows share behavior, approval policy, audit,
  packaging, and offline usability.

Verification:

- `rg -n "filesystem|git|sqlite|MCP|approval|packaging|security" docs/MCP_REUSE_DECISION.md`
- `git diff --check`

### REUSE05 - Move Session Continuity To Agent Framework First

Status: completed

Scope:

- Audit all state keyed by run ID, request ID, thread ID, and Relay-specific
  state IDs.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Keep run IDs only as AG-UI/UI correlation IDs.
- Demote `RelayTurnState` to a derived projection object, then document the
  remaining deletion path.

Artifacts:

- Sidecar state refactor.
- Session continuity smoke.
- Implementation note.

Acceptance:

- Follow-up user turns and approval responses resume the same Agent Framework
  session.
- Completed tool results from an old run cannot satisfy a new run.
- `RelayTurnState` is no longer a durable source of truth.

Verification:

- Add/update session continuity smoke.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE06 - Replace Approval Ledger With Native HITL

Status: completed

Scope:

- Wrap mutating tools with Agent Framework approval-required primitives such as
  `ApprovalRequiredAIFunction` or the current .NET equivalent.
- Project approval requests/responses through AG-UI human-in-the-loop events.
- Keep Relay's backup/diff/audit data as metadata on the approved function
  result, not as a separate approval protocol.
- Delete or quarantine any path that can execute a mutation outside the pending
  approved function call.

Artifacts:

- Approval cutover implementation.
- AG-UI approval replay fixture.
- Approval audit fixture.

Acceptance:

- Approve resumes the exact pending function call.
- Reject records a structured denied observation and does not retry through
  another mutation path.
- Workbench approval UI can replay from AG-UI events alone.

Verification:

- `pnpm agent:agui-client-tool-smoke`
- approval replay smoke
- `pnpm check`

### REUSE07 - Replace AAE With Middleware-Derived Projection

Status: completed

Scope:

- Keep the useful behavior of `RelayAdmissibleActionEnvelope`, but make Agent
  Framework middleware/tool registry filtering the source of truth.
- Generate the Copilot prompt's visible tool list from the framework registry
  and middleware decision.
- Ensure final/question/tool availability is enforced before and after Copilot
  output, not by prompt instructions alone.
- Add hard assertions that local-action tasks cannot reach Copilot with an
  empty tool registry.

Artifacts:

- Middleware-derived projection implementation.
- Prompt dump fixture.
- Protocol guard regression tests.

Acceptance:

- `RelayAdmissibleActionEnvelope` is either deleted or explicitly reduced to a
  diagnostic serialization of framework state.
- `local tools unavailable`, unnecessary `ask_user`, and premature `final` are
  blocked structurally.
- Prompt text is a projection, not a policy engine.

Verification:

- `pnpm agent:framework-native-prevention-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### REUSE08 - Make AG-UI Replay The Primary E2E Artifact

Status: completed

Scope:

- Save standard AG-UI event logs for deterministic and live E2E runs.
- Add a replay smoke that reconstructs:
  - run lifecycle;
  - tool call start/args/end/result;
  - approval request/response;
  - state snapshot/delta;
  - final output.
- Ensure Workbench UI can render from replayed AG-UI events without depending
  on Relay-only raw state.

Artifacts:

- AG-UI event log fixture.
- Replay smoke script.
- Implementation note.

Acceptance:

- A failed E2E can be debugged from AG-UI events plus framework trace.
- Relay-specific raw dumps are support attachments only.
- No primary Workbench state depends on a custom run-event union.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### REUSE09 - Add Framework-Compatible Observability

Status: completed

Scope:

- Define an OpenTelemetry-compatible trace shape for:
  - Copilot provider readiness and send/receive;
  - prompt projection;
  - tool call admission;
  - approval pause/resume;
  - local tool execution;
  - final eligibility.
- Export traces in support bundles while redacting sensitive prompt/file data.
- Keep prompt dumps as opt-in sensitive artifacts.

Artifacts:

- Trace schema or implementation.
- Support bundle update.
- Redaction test.

Acceptance:

- Provider failures such as Copilot quota are distinguishable from harness
  failures.
- Tool failures include call ID, tool name, workspace, artifact IDs, and
  retryability without leaking file contents by default.
- Traces line up with AG-UI event IDs.

Verification:

- support bundle smoke
- `pnpm check`

### REUSE10 - Rerun Live Copilot Canaries After Structural Smokes

Status: completed

Scope:

- After REUSE02 through REUSE09 pass deterministic checks, rerun live Copilot
  E2E canaries:
  - multi-file project creation;
  - follow-up project improvement;
  - file search/discovery;
  - Office inspect/edit/verify.
- Treat Copilot quota as provider-blocked, not as pass or harness failure.

Artifacts:

- Live E2E artifacts under ignored diagnostics paths.
- `docs/IMPLEMENTATION.md` entry with command, date, environment, and result.

Acceptance:

- If Copilot is available, the canaries complete without local-tools-unavailable
  prose, unnecessary `ask_user`, premature `final`, or duplicated mutation.
- If Copilot quota blocks the run, the app emits structured
  `copilot_quota_limited` and the E2E is marked provider-blocked.

Verification:

- `pnpm workbench:live-project-e2e`
- `pnpm workbench:live-copilot-e2e`
- `pnpm check`

The `HARN*` and `OCT*` queues below remain as historical context. Their useful
intent has been folded into the completed `REUSE*` queue above; any older
pending marker below should not be scheduled without first reconciling it
against `PLANS.md`, `docs/HARNESS_ARCHITECTURE.md`, and the OpenCode-compatible
tool contract.

### HARN01 - Write Harness Architecture ADR

Status: completed

Scope:

- Create `docs/HARNESS_ARCHITECTURE.md`.
- Map OpenCode semantics to Microsoft Agent Framework constructs:
  - tools and permissions;
  - session continuity;
  - approval pause/resume;
  - tool observations;
  - compaction;
  - final eligibility;
  - AG-UI projection.
- Record why Relay is not adopting Codex app-server or OpenCode runtime
  binaries in this milestone.
- Record the hard boundary: Relay owns adapters and local tool bodies, not a
  second agent harness.

Artifacts:

- `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The ADR names the canonical owner for each concern: Copilot adapter, Agent
  Framework, OpenCode-compatible tool contract, AG-UI, or Relay packaging.
- No concern is assigned to a vague "Relay harness" bucket.
- The ADR cites the official/prior-art URLs listed in `PLANS.md`.

Verification:

- `rg -n "OpenCode|Agent Framework|AgentSession|AG-UI|approval|middleware" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

Completion artifact:

- `docs/HARNESS_ARCHITECTURE.md`
- `docs/IMPLEMENTATION.md` entry "OpenCode-Compatible Harness Alignment"

### HARN02 - Build Tool Contract Parity Matrix

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a parity matrix.
- For each canonical tool, document:
  - OpenCode-compatible name;
  - Agent Framework registration type;
  - permission class;
  - result shape;
  - approval behavior;
  - AG-UI event projection;
  - known Relay-specific implementation gap.
- Include `officecli` as an extension tool, not a separate planning mode.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Tool registry snapshot fixture or documented command.

Acceptance:

- `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, bounded `bash`,
  `question`, and `officecli` have explicit mappings.
- `rg_files`, `rg_search`, and `patch` alias behavior is documented as
  compatibility only.
- The matrix is specific enough to drive implementation without inventing new
  model-visible Relay tool names.

Verification:

- `rg -n "read|glob|grep|edit|write|apply_patch|bash|question|officecli" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

Completion artifact:

- `docs/OPENCODE_TOOL_CONTRACT.md`
- `scripts/fixtures/agent-tool-catalog-snapshot.json`
- `pnpm agent:tool-catalog-smoke`

### HARN03 - Make AgentSession the State Authority

Status: superseded by `OPENAIAPI*`

Scope:

- Audit sidecar state that is keyed by run ID, request ID, or Relay-specific
  protocol state.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Ensure approval responses and follow-up user turns resume the same session.
- Keep run IDs only for UI correlation and diagnostics.

Artifacts:

- Sidecar state refactor.
- Session continuity regression test.
- Implementation note describing removed or demoted Relay state.

Acceptance:

- Approval resume does not create a fresh task from the original prompt.
- The same session contains user message, assistant tool call, approval request,
  approval response, tool observation, continuation, and final answer.
- No tool loop depends on frontend-only state.

Verification:

- Add/update a session continuity smoke test.
- `pnpm check`

### HARN04 - Replace Custom Approval Handling with Agent Framework HITL

Status: superseded by `OPENAIAPI*`

Scope:

- Register side-effect tools through Agent Framework approval-required function
  wrappers or equivalent approval metadata.
- Convert approval requests/responses through the Agent Framework + AG-UI HITL
  bridge.
- Batch approvals for coherent multi-file `apply_patch` operations.
- Remove custom approval replay messages that bypass Agent Framework approval
  content.

Artifacts:

- Approval middleware/update.
- AG-UI approval fixture.
- Approval audit log fixture.

Acceptance:

- `write`, `edit`, `apply_patch`, bounded `bash` with side effects, and
  `officecli` mutations pause before execution when policy is `ask`.
- Approving resumes the exact pending function call.
- Denying records a structured denied observation and does not fallback to an
  alternate mutation path.

Verification:

- Add/update approval smoke.
- `pnpm check`

### HARN05 - Add Terminal Eligibility Middleware

Status: completed

Scope:

- Implement middleware that decides whether a model final answer is allowed.
- Track pending required artifacts, pending tool calls, pending approvals,
  failed verifications, and unresolved blocked states.
- Hide or deny `question`/ask-user unless middleware marks the run as
  user-blocked.
- Stop before Copilot if a local-action task has an empty or invalid tool
  registry.

Artifacts:

- Terminal eligibility middleware.
- Protocol-state tests covering:
  - no local tools available;
  - premature final;
  - unnecessary ask-user;
  - genuine user-blocked state.

Acceptance:

- "local tools unavailable" never comes from Copilot prose. It is a pre-model
  `blocked` state with diagnostics.
- A final answer is rejected while required local artifacts are missing.
- `question` appears only after a deterministic user-blocked decision.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm check`

Completion artifact:

- `RelayAdmissibleActionEnvelope` and protocol guard updates in
  `apps/sidecar/`
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### HARN06 - Normalize Tool Observations and Transcript Storage

Status: superseded by `OPENAIAPI*`

Scope:

- Define one structured observation envelope for all tool results.
- Include tool name, call ID, status, concise summary, artifact IDs, warnings,
  stdout/stderr summaries, diff summaries, hashes, and retryability.
- Add deterministic transcript export for live E2E debugging.
- Add compaction rules that preserve objective, workspace, completed tool
  calls, artifacts, failures, approvals, and next action.

Artifacts:

- Transcript/observation schema in code or docs.
- Transcript export fixture.
- Compaction fixture.

Acceptance:

- Large tool outputs are summarized without dropping artifact references.
- Copilot receives enough structured observation data to continue after each
  tool call.
- E2E failures can be debugged from exported transcript plus AG-UI replay.

Verification:

- Transcript export smoke.
- `pnpm check`

Progress artifact:

- `RelayToolObservation.v1` metadata and artifact extraction are implemented in
  `apps/sidecar/AgentRunner.cs`.
- Live E2E prompt/raw-event artifacts are written under the ignored
  `dist/e2e/live-project/` diagnostics path.

Remaining:

- Add a deterministic transcript export smoke and compaction fixture.

### HARN07 - Rework Multi-File Project Creation Around `apply_patch`

Status: superseded by `OPENAIAPI*`

Scope:

- Make `apply_patch` the preferred coherent mutation tool for multi-file
  project creation and improvements.
- Keep `write` for single-file creation/overwrite.
- Ensure one multi-file patch can be reviewed and approved as one change set.
- Prevent repeated one-file approval loops when Copilot can produce a patch.

Artifacts:

- Prompt/tool projection update derived from the tool registry.
- Multi-file patch E2E fixture.
- Diff/approval UI fixture.

Acceptance:

- A request to create a small project produces either one coherent
  `apply_patch` call or a clearly justified small sequence.
- The first write/patch is not duplicated after approval.
- Follow-up improvement reads existing project state before patching.

Verification:

- Live or recorded project-create E2E.
- `pnpm check`

Progress artifact:

- `apply_patch` is canonical in prompt/tool projection and tool-catalog smoke.
- The patch parser now accepts multi-hunk OpenCode-style updates.
- `scripts/workbench-live-project-e2e.mjs` covers multi-file project creation
  plus follow-up improvement.

Blocker:

- Real Copilot project E2E currently stops at Microsoft 365 Copilot's hourly
  request limit (`copilot_quota_limited`) before tool execution can complete.

### HARN08 - Project Agent Framework Runs Through AG-UI Only

Status: superseded by `OPENAIAPI*`

Scope:

- Ensure frontend run state is derived from AG-UI events and state snapshots.
- Map Agent Framework run lifecycle, tool calls, tool results, approvals,
  errors, and final output to AG-UI events.
- Remove or quarantine custom Relay run/event streams from Workbench UI.
- Add replay fixtures for normal, approval, blocked, and failed runs.

Artifacts:

- AG-UI projection code/update.
- Replay fixtures.
- Minimal Workbench UI rendering path.

Acceptance:

- Workbench can replay a saved run from AG-UI events.
- Diagnostic details remain available but are not the primary UI protocol.
- No UI path depends on legacy Relay custom run-stream contracts.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### HARN09 - Live Copilot Harness E2E Suite

Status: superseded by `OPENAIAPI*`

Scope:

- Add or update live E2E tests that use actual M365 Copilot through Edge CDP.
- Cover:
  - multi-file HTML/CSS/JS project creation;
  - follow-up project improvement in the same session;
  - local file discovery with `glob`, `grep`, and exact `read`;
  - Office file inspect/edit/verify through `officecli`;
  - side-effect approval resume.
- Assert absence of:
  - empty tool catalog;
  - "local tools unavailable" as Copilot prose;
  - unnecessary `ask_user`;
  - premature final;
  - duplicated first mutation after approval.

Artifacts:

- Live E2E scripts.
- Saved transcripts and AG-UI event logs under an ignored diagnostics location.
- Implementation note with command, date, environment, and result.

Acceptance:

- The suite passes against a logged-in Edge/Copilot profile, or fails with a
  structured harness/provider defect and reproducible artifacts.
- No failure is hidden by a fallback harness path.

Verification:

- Live E2E command documented in `docs/IMPLEMENTATION.md`.
- `pnpm check`

Progress artifact:

- `scripts/workbench-live-project-e2e.mjs` exists and records prompts, raw AG-UI
  events, screenshots, sidecar stderr, and workspace path.
- The latest run reached real Copilot and failed with a structured
  `copilot_quota_limited` provider error, documented in
  `docs/IMPLEMENTATION.md`.

Remaining:

- Re-run the live suite after the Microsoft 365 Copilot request quota resets.

### HARN10 - Remove Superseded Relay Harness Paths

Status: superseded by `OPENAIAPI*`

Scope:

- Delete or quarantine Relay-specific harness code that duplicates Agent
  Framework responsibilities.
- Keep only:
  - Copilot CDP adapter;
  - local tool function bodies;
  - policy configuration;
  - diagnostics/export;
  - AG-UI projection glue;
  - packaging.
- Update docs to remove historical claims that conflict with the active design.

Artifacts:

- Code cleanup.
- Updated `README.md`, `AGENTS.md` if needed, `docs/IMPLEMENTATION.md`.

Acceptance:

- No active path treats Relay-specific protocol state as the canonical run
  state.
- The tool registry and Agent Framework middleware are the only active
  execution control surface.
- Historical docs are either updated or clearly archived.

Verification:

- `rg -n "RelayTurnState|RunEvent|rg_files|rg_search|custom run stream|local tools unavailable" apps docs`
- `pnpm check`

### HARN11 - Release Readiness Gate for Harness Migration

Status: superseded by `OPENAIAPI*`

Scope:

- Run all verification gates required by the harness migration.
- Confirm installer packaging includes required local tool binaries and excludes
  obsolete runtime assets.
- Confirm Windows no-admin install behavior remains intact.
- Confirm Linux/Windows shared Workbench path remains documented.

Artifacts:

- `docs/IMPLEMENTATION.md` release-readiness entry.
- Packaging verification log.

Acceptance:

- `pnpm check` passes.
- Live E2E artifacts exist for the current commit.
- Installer/tool-binary readiness is verified before any release.

Verification:

- `pnpm check`
- Packaging command documented in `docs/IMPLEMENTATION.md`

## Historical Tool-Contract Queue

### OCT01 - Inventory Current Model-Visible Tools

Status: completed

Scope:

- Inspect all model-visible tool registrations and prompt projections in
  `apps/sidecar`.
- List canonical tool names, aliases, parameters, result shapes, approval
  requirements, and current descriptions.
- Identify Relay-specific names that should become aliases or disappear from
  prompts.

Artifacts:

- Add `docs/OPENCODE_TOOL_CONTRACT.md` with an inventory section.
- Add an implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The inventory clearly separates canonical OpenCode-compatible tools,
  compatibility aliases, and Relay/Office extension tools.
- `rg_files`, `rg_search`, and `apply_patch` are explicitly classified.

Verification:

- `rg -n "rg_files|rg_search|apply_patch|workspace_status|officecli" apps/sidecar`
- `git diff --check`

### OCT02 - Define the OpenCode-Compatible Tool Contract

Status: completed

Scope:

- Complete `docs/OPENCODE_TOOL_CONTRACT.md`.
- Define canonical tools:
  - `read`
  - `glob`
  - `grep`
  - `edit`
  - `write`
  - `patch`
  - bounded `bash`
- For each tool, define:
  - when to use it;
  - when not to use it;
  - parameters;
  - result shape;
  - permission/approval class;
  - failure semantics;
  - aliases accepted during migration.

Artifacts:

- `docs/OPENCODE_TOOL_CONTRACT.md`.
- Updated references from `PLANS.md` and `docs/IMPLEMENTATION.md`.

Acceptance:

- The contract can be implemented without inventing new model-visible Relay
  action names for ordinary file/code work.
- OfficeCLI is documented as an extension tool, not a parallel planner.

Verification:

- Documentation review.
- `git diff --check`

### OCT03 - Centralize Tool Registration Around the Contract

Status: completed

Scope:

- Create or refactor a single tool registry/source of truth in the sidecar.
- Register canonical contract tools from that registry into Agent Framework.
- Keep compatibility aliases internal:
  - `rg_files` -> `glob`;
  - `rg_search` -> `grep`;
  - `patch` -> `apply_patch`.
- Ensure aliases are accepted by the executor only where required for backward
  compatibility and are not preferred in new prompts.

Artifacts:

- Sidecar registry code.
- Tool inventory snapshot or smoke output.
- Implementation note.

Acceptance:

- Prompt/tool projection no longer builds an independent static Relay catalog.
- A model-visible inventory dump shows canonical OpenCode-compatible tools.

Verification:

- Add/update a tool-inventory smoke.
- `pnpm check`

### OCT04 - Project Only Contract Tools to Copilot

Status: completed

Scope:

- Refactor Copilot prompt/tool projection to derive visible tools from the
  Agent Framework registry and current middleware state.
- Use canonical names in prompts.
- Hide aliases unless a legacy continuation requires them.
- Remove or quarantine prompt lines that implement broad Relay-specific
  recovery rules instead of contract semantics.

Artifacts:

- Updated Copilot adapter/prompt projection.
- Prompt dump fixtures showing canonical tool names.

Acceptance:

- New prompts prefer `apply_patch`, not `patch`, when patching is visible.
- No prompt exposes `rg_files` or `rg_search`.
- No prompt introduces new Relay-only local file/code tools.

Verification:

- Prompt-dump fixture.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### OCT05 - Align Executor Behavior and Results

Status: completed

Scope:

- Ensure executor implementations match the contract result shapes.
- Implement `apply_patch` as the canonical mutation tool.
- Keep `patch` as an alias only if existing tests or continuations need it.
- Ensure `bash` remains bounded to explicit verification/build/test/git/rg
  command use and cannot become arbitrary shell execution.

Artifacts:

- Executor changes.
- Contract-result smoke tests.

Acceptance:

- Tool results are consistent enough that Copilot can recover from normal tool
  errors without custom Relay planner state.
- Patch context failure returns a clear standard tool failure result.

Verification:

- Tool executor smoke tests.
- `pnpm check`

### OCT06 - Reframe OfficeCLI as a Contract Extension

Status: completed

Scope:

- Keep OfficeCLI available, but expose it as a documented extension tool
  aligned with the same inspect-before-mutate and approval semantics.
- Remove Office-specific planner assumptions that duplicate the general
  Agent Framework tool loop.
- Ensure Office mutation uses Agent Framework approval and AG-UI HITL.

Artifacts:

- Updated Office tool docs in `docs/OPENCODE_TOOL_CONTRACT.md`.
- OfficeCLI readiness and mutation smoke results.

Acceptance:

- Natural-language Office work follows the same run loop as code/file work:
  inspect/read -> approved mutation -> result/verification.
- No separate Office-only prompt harness is required for normal operation.

Verification:

- `pnpm agent:officecli-registry-smoke`
- Office approval smoke.
- `pnpm check`

### OCT07 - Remove or Quarantine Relay-Specific Recovery Rules

Status: completed

Scope:

- Audit Copilot adapter, protocol guard, and prompt builder for ad hoc rules
  added to handle repeated reads, early finals, patch failures, or local-tools
  unavailable outputs.
- Keep only narrow compatibility normalizers that are backed by tests and do
  not define a second tool system.
- Move prevention into Agent Framework middleware/session state where possible.

Artifacts:

- Cleanup diff.
- Implementation note explaining what was removed, retained, and why.

Acceptance:

- Normal E2E does not depend on hidden guard repair or broad prompt folklore.
- Contract violations fail visibly with diagnostics instead of silently
  creating new fallback behavior.

Verification:

- Choice-error reduction smoke.
- Protocol-state smoke.
- `pnpm check`

### OCT08 - Update Regression Tests to the Contract

Status: completed

Scope:

- Update existing smokes and fixtures to use canonical tool names and contract
  result shapes.
- Add alias tests proving legacy names still map internally but are not shown
  in new prompts.
- Add a no-new-Relay-tool-name assertion for the model-visible catalog.

Artifacts:

- Updated smoke scripts.
- Tool inventory snapshot.

Acceptance:

- Tests enforce OpenCode-compatible naming and semantics.
- Tests fail if a new model-visible Relay-specific tool is added without
  updating the contract.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### OCT09 - Live Copilot E2E: Complex Project Create and Improve

Status: completed

Scope:

- Re-run a real signed-in Copilot E2E where Relay creates a hierarchical
  project and then improves it.
- The test must exercise:
  - project creation with multiple files/directories;
  - reading existing files;
  - improving the project through canonical contract tools;
  - browser/runtime verification of the generated app.
- If the run fails, classify it as:
  - Copilot transport issue;
  - Agent Framework/tool contract issue;
  - executor implementation issue;
  - generated app quality issue.
- Do not add new ad hoc Relay planner features to make one scenario pass.

Artifacts:

- E2E logs under `dist/e2e/...`.
- Browser screenshot or validation output.
- Implementation note.

Acceptance:

- The run succeeds through the OpenCode-compatible contract, or fails with a
  clear contract/tool-result error and a follow-up task.

Verification:

- Live Copilot E2E script.
- Generated app smoke/browser check.
- `pnpm check`

### OCT10 - Documentation and Cleanup

Status: completed

Scope:

- Update `README.md`, `AGENTS.md` if needed, `PLANS.md`, and
  `docs/IMPLEMENTATION.md` to describe the new contract.
- Remove or archive obsolete references that imply Relay owns a custom local
  tool taxonomy.
- Ensure release/packaging notes do not mention removed modes or old tool names
  as public behavior.

Artifacts:

- Documentation updates.
- Final verification log.

Acceptance:

- A new contributor can understand that Relay is:
  - M365 Copilot controller;
  - Agent Framework run loop;
  - AG-UI frontend protocol;
  - OpenCode-compatible local tool contract;
  - Relay implementation glue, policy, packaging, and diagnostics.

Verification:

- `pnpm check`
- `git diff --check`

## Milestone Definition of Done

The OpenCode-compatible tool contract migration is complete when:

- `docs/OPENCODE_TOOL_CONTRACT.md` exists and matches implementation.
- The model-visible inventory uses canonical OpenCode-compatible local tool
  names plus documented extension tools only.
- Existing Relay-specific tool names are internal aliases or removed.
- Agent Framework remains the run loop and AG-UI remains the UI protocol.
- Live Copilot can create and improve a non-trivial project without requiring
  new Relay-specific planner rules.
