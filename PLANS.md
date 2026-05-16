# Relay_Agent Completion Plan

Date: 2026-05-16

## Product Direction

Relay_Agent has moved from a three-mode utility app into a single local
business-agent workbench:

> **Copilot thinks. Relay executes local tools safely.**

The user-facing product should not ask users to choose between `資料を探す`,
`Officeファイルを編集する`, and `コードを書く`. Those are implementation
capabilities, not primary UX modes. The Workbench should expose one
workspace, one task composer, one agent trace, and one result/approval surface.
M365 Copilot chooses which local tools are needed from the user's natural
language request; Relay validates and executes those tools locally.

The product no longer treats AionUi, OpenCode/OpenWork, or Tauri as active
product architecture. The active architecture is a browser-hosted local web
workbench served by the Relay sidecar. Linux/Windows parity, repeatable testing
from Linux, and simpler distribution make this the primary and only target
path.

The active product target is a **generic Relay Workbench**:

- natural-language task input;
- Copilot-led step planning and tool selection;
- Relay-owned validation, approvals, execution, backups, diffs, and logs;
- generic local tools such as ripgrep-backed search, file read, OfficeCLI, and
  exact file edits;
- AG-UI-first user experience and event protocol, with a minimal visual surface
  and no diagnostic-first clutter.

## Architecture

- Chosen UI shell: AG-UI-first browser-hosted local web workbench served by the
  Relay sidecar. The final product must not depend on Tauri IPC, WebView
  behavior, or Tauri packaging. Existing Workbench code may be reused only when
  it conforms to the AG-UI client/event model and the AG-UI-inspired visual
  interaction model.
- Backend adoption policy: Microsoft Agent Framework is the target production
  backend agent runtime, not merely a reference design. Relay should use the
  .NET Agent Framework agent, tool, approval, session, middleware, and
  streaming model as the main run harness. The Relay-owned custom runner is a
  transitional implementation detail to be removed, not a parallel workflow
  fallback.
- AG-UI adoption policy: AG-UI is no longer only a reference. It is the target
  external UI contract and UX model for agent runs, streaming messages, tool
  calls, human-in-the-loop approvals, state updates, interrupts/resume, and run
  completion. Prefer Microsoft Agent Framework's official ASP.NET Core AG-UI
  integration, such as `MapAGUI`, for Workbench-facing streams. Relay may add a
  narrow adapter only where M365 Copilot CDP transport or local governance needs
  Relay-specific behavior.
- Frontend adoption policy: use `@ag-ui/client` or the closest official AG-UI
  client primitives as the frontend runtime contract. If the best maintained
  AG-UI/CopilotKit visual components require React, migrate the Workbench
  frontend deliberately to that stack instead of keeping a divergent hand-rolled
  UI. The visual result must remain quiet, professional, spacious, and
  Relay-branded.
- Frontend stack decision: migrate the Workbench to **React + Vite +
  TypeScript + Tailwind CSS + shadcn/ui + Radix UI + `@ag-ui/client`**.
  Next.js is not the default because Relay's .NET sidecar already owns local
  serving, API routes, SSE, auth token validation, and packaging. Chakra UI is
  not the default design system because Relay needs AG-UI-aligned agent
  surfaces, owned component code, low visual overhead, and precise styling
  control.
- Removed shell targets: AionUi, OpenCode/OpenWork web shells, Tauri desktop
  shell, and any diagnostic-first shell are not fallback paths. They must be
  deleted from active product code, release workflows, package resources, and
  runtime launch paths during the cutover.
- Relay sidecar role: host the local web UI, expose local HTTP/WebSocket APIs,
  host the .NET Agent Framework runtime, validate and execute Relay local tools,
  manage app-local storage, and supervise the Copilot CDP bridge. The active
  implementation is the Relay-owned self-contained .NET sidecar with Agent
  Framework as the backend run harness.
- Sidecar Copilot transport: the active sidecar owns the Relay M365 Copilot
  provider adapter. Implement this as `RelayCopilotChatClient` or an equivalent
  Agent Framework-compatible adapter that turns Agent Framework model requests
  into Edge CDP operations against M365 Copilot. A local OpenAI-compatible
  surface may remain as an internal compatibility seam only when it helps wire
  Agent Framework clients; it is not a second runtime. The historical
  Node/Tauri-era bridge is no longer the active product path.
- Browser role: the user opens the Relay Workbench at a localhost URL. This
  browser surface is separate from the controlled Edge/Copilot CDP session.
  If Edge is used for both, Relay must use a separate profile or CDP boundary
  so the workbench does not interfere with Copilot automation.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Agent harness: the production path is Microsoft Agent Framework inside the
  Relay sidecar. Agent Framework owns agent turns, typed tools, session state,
  approvals, streaming updates, and run lifecycle. Relay owns the M365 Copilot
  provider adapter, local tool implementations, validation, approval policy,
  backups, diffs, storage, and diagnostics.
- Copilot transport shape: use the sidecar-owned Agent Framework-compatible
  Copilot adapter. Stable behavior from the historical Node/Tauri bridge may be
  ported into this adapter, but the final product must not keep a separate
  Node/Tauri-era bridge as an alternate runtime path. Copilot transport is
  fail-fast: prompt delivery failure, send failure, response extraction failure,
  schema validation failure, stale response pickup, or DOM selector drift fails
  the run with diagnostics instead of silently falling back to another planner
  or weaker execution path.
- Corporate-approved LLM posture: Relay uses M365 Copilot as the single primary
  reasoning engine. Do not introduce a two-brain UX, OpenAI API dependency,
  Codex authentication dependency, or unapproved third-party agent binary.
  Ollama is out of current release scope; it may be reconsidered only by a
  future ADR that does not create a second user-visible planning path.
- Rebranding policy: user-facing Relay-owned files, docs, labels, generated
  artifacts, and release surfaces should use `Relay` / `relay` naming. Keep
  upstream or integration names such as `Codex app-server`, `codex` CLI
  commands, `CODEX_HOME`, OpenCode/OpenWork compatibility terms, and third-party
  package identifiers unchanged when they refer to the external substrate rather
  than the Relay product brand.
- Compliance-safe packaging policy: Relay must not hide, obfuscate, or
  deceptively rename third-party binaries or metadata to evade internal local
  file checks. If direct use or redistribution of upstream Codex artifacts is
  not acceptable for the corporate environment, the product plan is to remove
  those artifacts from the shipped release or replace them with an approved
  Relay-owned adapter/runtime boundary. Branding cleanup is allowed only for
  Relay-owned files and user-facing product surfaces; third-party dependency
  notices, licenses, and integration names must remain accurate.
- Next agentic direction: Copilot becomes the manager for intent
  understanding, next-step planning, tool choice, observation review, and final
  synthesis. Relay remains the execution harness for validation, permissions,
  local tool execution, backups, diffs, and trace logging.
- Agent loop: fixed one-shot pipelines will be replaced by a bounded
  `Copilot step -> Relay tool -> observation -> Copilot step` loop. The loop
  must be capped, traceable, and schema-validated. Validation failures stop the
  run and surface a visible UI error; there is no fallback execution.
- Agent loop simplicity: the shipped UX should expose one reasoning path:
  Copilot step -> Relay tool -> observation -> Copilot step. No secondary model
  or alternate harness is part of the current product path.
- Tool broker: move from domain-specific high-level tools to a small generic
  tool set. The catalog should support many local business tasks; local file
  search, Office editing, and coding are high-frequency recipes that use the
  same primitives, not separate product modes. Initial target tools are:
  - `rg_files`: enumerate likely files using ripgrep's file listing and glob
    filters;
  - `rg_search`: search plaintext/code content using ripgrep;
  - `read`: read exact files, including Relay-supported plaintext extraction
    for Office/PDF where available;
  - `officecli`: inspect or mutate Office files through validated OfficeCLI
    semantic operations and locally compiled argv;
  - `edit`: exact-string file edits inside the selected workspace;
  - `write`: new file creation or complete rewrite, only after approval;
  - `workspace_status`: inspect repository/workspace state such as dirty files,
    changed paths, tool readiness, and app-local run metadata without mutating
    anything;
  - `diff`: show pending or applied text/Office/code changes in a stable,
    reviewable format;
  - `run_command`: execute bounded verification commands such as build, test,
    lint, typecheck, format-check, or explicit user-approved project commands;
  - `ask_user`: ask for missing information;
  - `final`: end the run with a user-facing answer.
- Tool schema policy: keep the initial Copilot context small. Advertise concise
  tool summaries first and inject detailed schemas only when Copilot selects a
  tool family. Validation failures stop the run and surface a clear UI error.
  Do not silently execute fallback tools when Copilot emits invalid arguments.
- Search direction: do not keep investing in a custom high-level search product
  as the main UX. Search becomes a generic agent capability built on ripgrep
  (`rg_files` and `rg_search`), exact `read`, and Copilot synthesis over
  Relay-provided observations. Relay still owns path constraints, timeout
  budgets, result caps, and evidence packaging.
- Search quality policy: Relay should report evidence states, not overclaim
  relevance. Use `filename_only`, `path_match`, `content_confirmed`,
  `office_text_confirmed`, and `metadata_only` style states so Copilot can
  distinguish candidates from confirmed evidence. For large folders, Relay
  should cap and diversify results, detect obvious folder skew, and let Copilot
  choose follow-up reads/searches through the same generic loop.
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the Workbench.
- Office tool policy: expose OfficeCLI through a broad capability registry,
  not arbitrary argv and not a tiny hand-written allowlist. The registry should
  be generated or validated from pinned OfficeCLI help/schema output where
  available, then normalized into Relay semantic operation families: discovery
  and inspection; Excel workbook/sheet/cell/range/table/formula/style/data
  operations; Word document/text/table/style/review operations; PowerPoint
  slide/shape/text/media/layout operations; and cross-document export,
  convert, render, merge, split, batch, refresh, resident open/close, and
  validation operations when supported by the bundled OfficeCLI version. Copilot
  selects only a semantic operation plus typed arguments. Relay validates paths,
  document type, selectors, sheet/range/property values, safety class, and then
  compiles the operation to OfficeCLI argv. Office mutations must produce a
  backup, approval interrupt, command summary, post-apply verification, and
  rollback note.
- OfficeCLI readiness checks must validate real `view outline --json`
  capability without falsely failing because Relay's own smoke workbook handle
  is still open. Smoke workbooks must be written to a unique app-local path,
  closed before launching OfficeCLI, retried briefly on transient sharing
  violations, and cleaned up after the check.
- OfficeCLI is an optional capability for overall agent readiness. Missing or
  failed OfficeCLI must not put the whole Workbench into `Limited` when
  Copilot and required search/tool execution are ready. Office tasks still fail
  clearly at execution time if OfficeCLI cannot be resolved or pass smoke.
- Code editing: M365 Copilot may inspect through `rg_files`, `rg_search`, and
  `read`, then propose validated exact-string replacements through `edit` or
  new-file writes through `write`. Relay validates workspace-relative paths,
  unique `oldString` matches, file boundaries, and user approval before writing.
  `workspace_status`, `diff`, and `run_command` complete the coding loop by
  making dirty-file state, reviewable changes, and verification output visible
  to the agent. Arbitrary unrestricted shell is not part of the default tool
  catalog.
- Command execution policy: `run_command` is not a general shell. It accepts a
  structured argv array, working directory, timeout, environment allowlist, and
  declared purpose. Relay blocks shell metacharacters, network/package-install
  commands, destructive commands, cross-workspace paths, and secret-reading
  patterns unless the user explicitly approves a narrowly displayed command.
- UX direction: a minimal professional workbench using the existing `--ra-*`
  token system in `apps/workbench/src/styles.css`. Design guidance now belongs
  in Workbench-owned docs/source only; the deleted desktop tree is not a design
  dependency. The UI should maximize whitespace, remove explanatory clutter,
  and show only workspace, task input, concise agent status, result cards,
  approval/diff surfaces, and collapsible details.
- Target release artifact: self-contained Relay sidecar plus static web assets,
  with a Windows user-scope NSIS installer and a Linux archive/launcher that
  open the local workbench URL. The Windows installer packages the sidecar
  Workbench architecture; the Tauri NSIS installer is not a supported release
  path after the cutover.

### Architecture Specification

This specification is added after reviewing current Microsoft Edge DevTools
Protocol, ASP.NET Core, .NET deployment, AG-UI, Microsoft Agent Framework,
OWASP LLM, NSIS, and ripgrep documentation. It is the target contract for the
hard cutover.

- Process topology:
  - `Relay.Launcher` is the user-facing entrypoint on Windows and Linux.
  - `Relay.Sidecar` is the only long-lived backend process. It hosts the
    Workbench static assets, local APIs, Microsoft Agent Framework runtime,
    AG-UI event stream, Copilot CDP provider adapter, Relay tool broker, run
    ledger, and package diagnostics.
  - Microsoft Agent Framework is the sidecar's backend agent runtime. Relay
    integrates with it through typed tools, approval middleware, session/run
    records, and a Copilot provider adapter rather than a separate custom
    workflow runner.
  - The Workbench browser opens the sidecar URL with a per-launch token. It is
    not the same browser automation context as the Copilot CDP tab.
  - Edge/Copilot is started or attached lazily for model turns only. Workbench
    first paint must not wait for Copilot readiness.
- Local HTTP surface:
  - Bind only to loopback using an explicit localhost URL and dynamic or
    conflict-checked port; never bind to `0.0.0.0`, `*`, `+`, or LAN
    interfaces.
  - Every API, SSE stream, and state-changing request requires the launch
    token. Validate `Host` and `Origin`; reject missing or foreign origins.
  - Serve only the built Workbench bundle. Directory browsing must remain
    disabled, and arbitrary workspace files must never be served as static
    assets.
  - Required endpoints: `/` for Workbench, Agent Framework AG-UI run endpoint,
    `/api/status`, `/api/workspace`, `/api/runs`, `/api/runs/{id}`,
    `/api/runs/{id}/approve`, `/api/runs/{id}/cancel`,
    `/api/support-bundle`, and `/api/shutdown`. Legacy custom event endpoints
    may exist only during migration and must not remain Workbench-facing after
    AG-UI adoption.
- Event stream:
  - Use AG-UI as the public run event protocol. Do not keep a competing Relay
    wire protocol for the Workbench once migration is complete.
  - Required AG-UI event coverage: run start/finish, text message
    start/content/end, tool call start/args/result, state snapshot/delta,
    approval interrupt, resume result, error, and cancellation.
  - Every emitted event must be traceable to Relay `runId`, monotonic sequence,
    timestamp, and structured metadata for replay/support export, even when the
    protocol field names come from AG-UI.
  - Relay-internal event records are allowed as persistence details, but
    Workbench-facing APIs must speak AG-UI.
- Run lifecycle:
  - State machine: `created -> preparing -> waiting_copilot -> validating ->
    executing_tool -> waiting_approval -> synthesizing -> completed`.
    Terminal states are `completed`, `cancelled`, and `failed`.
  - Agent Framework is responsible for the run/session lifecycle. Relay policy
    constrains each Copilot step to one validated tool call, `ask_user`, or
    `final`. Relay executes at most one local action before returning an
    observation to the Agent Framework run.
  - Invalid JSON, unknown tool names, invalid arguments, missing capability,
    stale approval, or workspace-scope violation stops the run with a visible
    `failed` state. Do not route to a weaker fallback tool.
  - Bounded retry is allowed only inside the same transport for paste/send
    readiness, response extraction settling, or one JSON repair turn.
- Tool contract:
  - Tool arguments are validated against Relay-owned schemas before execution.
  - Read-only tools may run after validation; mutation tools pause for explicit
    approval with exact target paths, diff/command summary, backup location,
    and rollback/no-rollback note.
  - `rg_files` maps to ripgrep file enumeration with explicit root, include,
    exclude, depth, cap, timeout, and hidden/binary policy.
  - `rg_search` maps to ripgrep content search for plaintext/code only, with
    explicit root, pattern, include/exclude globs, cap, timeout, and encoding
    policy. Office/PDF containers are discovered by filename and inspected by
    exact `read`, not plaintext grep.
  - `read` returns bounded extracted text or structured metadata for exact
    files, including Office/PDF extraction where Relay supports it.
  - `officecli` accepts semantic Office operations compiled by Relay to argv;
    direct arbitrary shell is not exposed.
  - `edit` requires exact old/new replacement validation; `write` requires an
    explicit target and approval.
  - `workspace_status` reports repository/workspace state without mutation,
    including dirty files, changed paths, active approvals, and relevant tool
    readiness.
  - `diff` returns bounded, reviewable diffs for pending and applied
    mutations. It must be available before approval and after execution.
  - `run_command` executes only validated, bounded verification commands. It
    must avoid shell interpretation by default, enforce workspace containment,
    capture stdout/stderr with caps, support cancellation, and require approval
    for non-allowlisted or mutation-capable commands.
- Copilot transport:
  - The sidecar owns the Agent Framework-compatible M365 Copilot provider
    adapter over Edge CDP. Prefer a direct `IChatClient`/Agent Framework
    adapter shape. A Chat-Completions-compatible local surface may remain only
    as internal compatibility for existing tests or Agent Framework clients.
    This is an adapter contract for Relay; it is not a Microsoft 365 product
    API guarantee.
  - DOM selectors, paste/insert behavior, send-button lifecycle detection, and
    response extraction rules must be versioned against saved successful
    Copilot fixtures.
  - Response extraction must reject prompt echoes, sidebar/history text,
    suggestions, empty answers, stale prior answers, and incomplete JSON.
  - Transport errors fail the Agent Framework run. Relay may perform short
    bounded mechanical retries for readiness/settling inside the same CDP
    operation, but it must not silently execute a fallback model, planner,
    runner, or tool path.
- Storage and privacy:
  - Runtime data lives under user-local Relay data directories only.
  - Shared folders and selected workspaces must not receive Relay caches,
    indexes, snapshots, logs, or temp files.
  - Run ledgers store bounded observations and metadata by default. Support
    bundles omit document contents unless the user explicitly opts in.
- Packaging:
  - Publish the sidecar as self-contained, platform-specific artifacts.
  - Windows distribution is a per-user NSIS installer with user execution
    level, current-user install location, Start Menu shortcut, optional desktop
    shortcut, uninstall entry, and no UAC/password requirement.
  - Bundle required runtime tools from sidecar-owned resource directories and
    list them in the release inventory/SBOM-style metadata.

## Current Review Remediation Plan

The sidecar/workbench cutover is active. The next plan is no longer another
architecture migration; it is a hardening pass based on the current
implementation review. Do not reintroduce the old `apps/desktop`, AionUi,
OpenCode/OpenWork, Tauri IPC, or high-level document-search engines while
addressing these items.

Implementation status on 2026-05-16:

- Completed in the current slices: generic `workspace_status`, `diff`, and
  approval-gated bounded `run_command`; `rg_search` `--` hardening; Workbench
  event identity by `runId + sequence`; AG-UI-compatible SSE event mapping;
  Workbench consumption of `/agui-events`; hard-cut guard coverage that blocks
  returning the Workbench to the old `/events` stream; the
  `RelayCopilotChatClient` `IChatClient` adapter; POST-only support-bundle
  export with default redaction; streaming/capped ripgrep output for
  `rg_files` and `rg_search`; exact `read` extraction for `.docx`, `.xlsx`,
  `.xlsm`, `.pptx`, and uncompressed text-layer `.pdf`; broad semantic
  OfficeCLI capability-registry compilation with raw-argv rejection; a
  Microsoft Agent Framework-backed `ChatClientAgent` runner path for Copilot
  turns and per-run sessions; Agent Framework function-tool dispatch through
  `AIFunctionFactory.Create`; Copilot tool projection to
  `FunctionCallContent`; `FunctionInvokingChatClient` observation looping;
  `ApprovalRequiredAIFunction` wrapping for mutating tools; Agent Framework
  approval response resume/session serialization; Workbench approval rendering
  from AG-UI state instead of `RunResponse.pendingApproval`; React + Vite +
  TypeScript + Tailwind CSS + shadcn-style local components + Radix Tooltip
  Workbench migration; `@ag-ui/client`-based Workbench stream consumption; and
  deeper support-bundle redaction fixture coverage; and golden smoke coverage
  for those behaviors.
- Still open for the next slice: richer PDF extraction for filtered streams.

Framework-first revision after current Microsoft documentation review:

- Agent Framework already owns the tool-calling loop. Relay must stop growing
  the custom `RelayAgentPlan -> RelayToolExecutor -> observation` loop and
  instead register Relay capabilities as Agent Framework tools.
- Relay-owned custom code should narrow to:
  - the M365 Copilot Edge/CDP `IChatClient` adapter;
  - local function implementations for `rg`, `read`, `officecli`, `edit`,
    `write`, `workspace_status`, `diff`, `run_command`, and `ask_user`;
  - policy validation inside those functions and middleware;
  - packaging, diagnostics, and support-bundle generation.
- The Copilot adapter is the required seam because M365 Copilot is reached
  through browser automation, not through a native provider API. It must project
  Agent Framework tool schemas into Copilot prompts and convert Copilot's
  selected action back into Microsoft.Extensions.AI tool-call content. This
  adapter is allowed; a second Relay runner is not.
- Prefer Agent Framework primitives before adding Relay code:
  `AIFunctionFactory.Create` for typed function tools,
  `ApprovalRequiredAIFunction` for mutating tools,
  `AgentSession` serialization for run continuity,
  middleware for validation/telemetry,
  and `MapAGUI` / AG-UI middleware for Workbench streaming and approvals.
- Do not use provider-hosted file search or code interpreter for local
  workspaces. Relay's local files and Office documents must stay local, so the
  Agent Framework tools call local Relay functions. Local MCP is a future option
  only if an approved local MCP server already provides a capability better than
  a small in-process function.

### P0: AG-UI Full Adoption

1. Replace the public run stream with AG-UI.
   - Current risk: the Workbench uses a Relay-specific `RunEvent` wire shape,
     which recreates a protocol AG-UI already standardizes.
   - Target: Workbench-facing agent traffic uses AG-UI events for lifecycle,
     text streaming, tool calls, state snapshots/deltas, approval interrupts,
     resume, errors, and completion.
   - Acceptance: no Workbench-facing API requires the old custom `RunEvent`
     union; event consumers can reconstruct a run from AG-UI events alone.

2. Rebuild the Workbench around AG-UI client and visual patterns.
   - Current risk: the current custom UI can drift from the AG-UI ecosystem and
     force Relay to keep inventing agent UI behavior.
   - Target: the Workbench uses React + Vite + TypeScript + Tailwind CSS +
     shadcn/ui + Radix UI + `@ag-ui/client`, and uses AG-UI/CopilotKit-style
     interaction patterns for streaming text, tool activity, approvals, state,
     and final answer cards.
   - Acceptance: browser E2E proves the AG-UI Workbench can submit a task,
     stream progress, render an approval interrupt, resume after approval, and
     show final output without using legacy mode buttons or custom-only event
     fields.

3. Adopt Microsoft Agent Framework as the backend runtime.
   - Current risk: moving to Python only because some AG-UI workflow examples
     are ahead would add packaging and enterprise deployment complexity without
     solving Copilot CDP or local tool governance. Keeping a Relay-owned runner
     would continue the harness reinvention that this migration is meant to
     remove.
   - Target: use .NET Microsoft Agent Framework as the production backend
     runtime. Agent Framework owns the run loop, tool-call detection, typed
     function dispatch, approvals, sessions, streaming, and lifecycle. Relay
     implements only the M365 Copilot provider adapter, local function bodies,
     validation policy, packaging, and diagnostics around that runtime.
   - Acceptance: a .NET Agent Framework smoke run can call Relay's Copilot
     adapter, select a Relay tool, pause/resume an approval, stream AG-UI events,
     and finish through the Workbench. Windows NSIS and Linux archive still ship
     one .NET sidecar product path, with no Python runtime requirement.
   - Current slice: Copilot turns now run through `ChatClientAgent` with an
     Agent Framework session; Relay capabilities are registered as
     `AIFunctionFactory.Create` tools; the Copilot adapter projects
     `ChatOptions.Tools` and converts valid tool choices to
     `FunctionCallContent`; `FunctionInvokingChatClient` owns the normal
     observation loop; mutating functions are wrapped with
     `ApprovalRequiredAIFunction`; approval-required runs now serialize the
     Agent Framework session into the run ledger and resume by feeding
     `ToolApprovalResponseContent` back into the same `ChatClientAgent`
     session. Workbench approval cards are driven by AG-UI
     `USER_CONFIRMATION_REQUEST` state, while `PendingApproval` remains only as
     internal ledger state for `/approve`.
   - Current slice: the Workbench now runs on React + Vite + TypeScript,
     Tailwind CSS, shadcn-style local UI components, Radix Tooltip, lucide
     icons, and a `RelayEventSourceAgent` subclass of `@ag-ui/client`
     `AbstractAgent` for AG-UI stream consumption. The thin Relay event
     normalizer remains only to bridge current sidecar event extensions such as
     `USER_CONFIRMATION_REQUEST` into the visible run trace.
   - Revised remaining slice: keep Relay tool functions small and
     deterministic. They validate workspace scope, execute one local action,
     return structured observations, and never call Copilot themselves.

4. Implement fail-fast Copilot provider behavior inside Agent Framework.
   - Current risk: hidden retries, fallback execution, or stale DOM extraction
     can make Copilot instability look like successful agent behavior.
   - Target: `RelayCopilotChatClient` becomes the only custom model-provider
     seam. It classifies failures as `open`, `composer_ready`,
     `prompt_insert`, `send`, `wait_response`, `extract`, `tool_projection`,
     or `schema_validate`. It may use short bounded mechanical waits inside the
     same operation, but it must not route to a fallback model, fallback
     planner, old runner, or weaker tool.
   - Acceptance: golden and live Copilot E2E tests prove that a valid Copilot
     turn succeeds, while invalid JSON, empty response extraction, prompt echo,
     selector drift, and response timeout all surface as failed Agent Framework
     runs with AG-UI error events and support-bundle diagnostics.

### P1: Tool Correctness And Safety

5. Fix exact `read` for Office/PDF files.
   - Current risk: the active `read` path treats files as bounded UTF-8 text.
     That is correct for plaintext/code, but not enough for `.xlsx`, `.xlsm`,
     `.docx`, `.pptx`, or `.pdf`.
   - Target: `read` returns bounded extracted plaintext or structured metadata
     for supported Office/PDF containers, using sidecar-owned extraction code or
     approved bundled readers.
   - Acceptance: golden tests prove `rg_files -> read -> final` can inspect
     `.xlsx`, `.docx`, `.pptx`, and text-layer `.pdf` fixtures without routing
     back to the deleted document-search engine.

6. Replace open-ended OfficeCLI argv planning with an OfficeCLI capability
   registry.
   - Current risk: Copilot can shape raw `officecli` arguments too directly,
     while a tiny manual allowlist would discard most of OfficeCLI's value.
   - Target: Relay maintains a broad OfficeCLI capability registry, populated
     from pinned OfficeCLI docs/help/schema where possible and normalized into
     typed semantic operations. The registry should cover discovery,
     inspection, validation, Excel workbook/sheet/cell/range/table/formula/
     style/data operations, Word document/text/table/style/review operations,
     PowerPoint slide/shape/text/media/layout operations, and cross-document
     export/convert/render/merge/split/batch/refresh/resident operations when
     the bundled OfficeCLI version supports them. Copilot may select only
     registry operations and typed args; Relay owns path, file type, selector,
     sheet/range/property validation, safety classification, and argv
     compilation.
   - Acceptance: Office tasks can use the broad OfficeCLI surface without
     exposing raw argv. Mutations create backups and approval cards, run
     post-apply verification, and fail closed on unsupported command families,
     ambiguous targets, unsafe paths, invalid schemas, or OfficeCLI version
     drift.

7. Make support bundle export explicit and redacted by default.
   - Current risk: a simple support-bundle endpoint can package run ledgers and
     event logs that include prompts, local paths, snippets, and tool output.
   - Target: support export is a state-changing `POST` or approval-gated UI
     action. Default bundles redact local paths and omit document contents.
     Full-content export requires explicit opt-in.
   - Acceptance: security smoke proves unauthenticated support export fails and
     default bundle output does not contain raw workspace document contents.
   - Current slice: complete. Default support bundles now run JSON-aware
     recursive redaction before free-text redaction. The security smoke seeds a
     fixture run ledger with local paths, instructions, document contents,
     stdout/stderr-like details, email addresses, tokens, and backup paths,
     then extracts the generated ZIP and proves default output contains only
     redaction markers.

8. Add generic verification and review tools for agentic coding and business
   tasks.
   - Current risk: `edit` and `write` can change files, but a generic agent also
     needs workspace state, diff review, and validation output to close the loop
     without falling back to an unrestricted shell.
   - Target: add `workspace_status`, `diff`, and bounded `run_command` tools.
     `run_command` supports build/test/lint/typecheck/format-check and explicit
     user-approved project commands through structured argv, timeout, output
     caps, cancellation, workspace containment, and deny rules for destructive,
     network, package-install, secret-reading, or cross-workspace behavior.
   - Acceptance: golden tests prove a coding task can inspect files, propose an
     exact edit, show a diff before approval, apply after approval, run a
     verification command, and feed the result back to Agent Framework for a
     final answer or next fix.

### P2: Search Performance And Argument Handling

9. Stream and cap ripgrep output before buffering.
   - Current risk: `rg_files` and process helpers can read all stdout before
     applying Relay caps, which can stall on very large shared folders.
   - Target: pass include/exclude/depth filters into ripgrep where possible,
     stream stdout, stop after the result cap, and kill the process on timeout
     or cancellation.
   - Acceptance: large-tree smoke fixture proves `rg_files` returns capped
     results within budget and cancellation stops the process.

10. Harden `rg_search` argv construction.
   - Current risk: search patterns that begin with `-` can be interpreted as
     ripgrep options.
   - Target: always pass a `--` separator before the user/model pattern and
     validate includes/excludes separately from the pattern.
   - Acceptance: regression test covers a pattern beginning with `-` and
     confirms it is treated as a pattern, not an option.

### P3: UX Trace Reliability

11. Deduplicate Workbench events by run sequence, not display text.
   - Current risk: repeated legitimate status messages can disappear if the UI
     deduplicates on message/detail text.
   - Target: event identity is `runId + sequence`; text-level dedupe is only a
     rendering convenience after sequence processing.
   - Acceptance: UX E2E fixture with repeated status messages shows all ordered
     events in the details trace and no duplicate final cards.

### Documentation And Plan Hygiene

- `AGENTS.md` in this repository already reflects the sidecar/workbench
  architecture. Any older pasted rule set that references `apps/desktop`,
  Tauri as active, or OpenCode/OpenWork as substrate is obsolete and must not
  steer implementation.
- `PLANS.md`, `README.md`, and `docs/IMPLEMENTATION.md` must keep the same
  active architecture story: one browser Workbench, one .NET sidecar,
  Microsoft Agent Framework as backend runtime, M365 Copilot through Relay's
  CDP adapter as planner, and Relay as local tool governance/execution layer.
- Completed migration tasks may remain as historical context below, but new
  implementation work should prioritize the P0/P1/P2/P3 remediation items
  above before expanding the tool catalog.

## Hard Cutover Rules

- No transitional fallback architecture. The migration is complete only when
  the new browser-hosted workbench and .NET sidecar are the single active
  product path.
- No simplified throwaway MVP. The first implementation slice must be shaped as
  the final architecture: sidecar-hosted UI, local HTTP/WebSocket APIs,
  Microsoft Agent Framework runtime, Relay Copilot adapter, generic tool
  catalog, approval flow, and packaging plan.
- No AionUi, OpenCode/OpenWork, Codex app-server, or Tauri runtime fallback in
  active product code. Historical docs may remain archived, but active source,
  package scripts, workflows, release resources, runtime launchers, and UI
  code must not depend on those paths.
- No silent fallback runtimes. If Copilot output, tool arguments, tool
  availability, workspace access, OfficeCLI readiness, or CDP automation fails
  validation, the run stops with a clear user-visible error. Bounded retries
  inside the same Copilot transport, such as paste retry, response candidate
  scoring, or one JSON repair turn, are allowed when they are logged and do not
  switch to an alternate runtime or weaker tool path.
- No hidden compatibility shims. Compatibility code is allowed only as a
  temporary migration aid inside a single branch while replacing callers; it
  must be removed before the cutover is marked complete.
- No old high-level workflow runners as backup paths. Search, Office editing,
  and code editing must run through the common agent runner and generic tools.
- Cutover completion requires deletion evidence: source search and release
  inventory must prove that active AionUi/OpenCode/OpenWork/Tauri paths are
  gone or archived-only.

## Prior-Art-Informed Additions

The browser-hosted sidecar design should adopt AG-UI as the Workbench-facing
protocol and UX contract, while incorporating lessons from Microsoft Agent
Framework, ASP.NET Core, and established agent tools without making Python or a
second agent runtime mandatory.

### Agent UI protocol

- Use AG-UI, not an unstructured ad hoc log stream, for the workbench/agent
  boundary. Relay should expose one AG-UI run stream and remove the current
  custom Workbench event protocol as a public API.
- Adopt AG-UI human-in-the-loop semantics for Office/code approvals. Approval
  cards are AG-UI interrupts; approve/reject is AG-UI resume input; Relay still
  enforces whether the operation is allowed.
- Use AG-UI state snapshot/delta events for workspace, selected files,
  pending approval, changed artifacts, and final answer state instead of
  inventing parallel state synchronization messages.
- Keep plain local HTTP APIs for non-agent app operations such as workspace
  selection, app status, logs export, static file serving, and shutdown.
- Use SignalR or raw WebSockets only if SSE cannot satisfy a specific future
  requirement. Do not maintain parallel event protocols for the same run
  lifecycle.

### AG-UI frontend and visual adoption

- The Workbench visual layer should be rebuilt around the AG-UI frontend
  ecosystem rather than a custom event renderer. The target implementation
  stack is React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Radix UI +
  `@ag-ui/client`.
- Study the official AG-UI Dojo and CopilotKit AG-UI examples as the visual
  baseline for chat, streaming answer, tool activity, shared state, and
  human-in-the-loop approval surfaces. Adopt the interaction patterns, not
  their marketing chrome.
- Use shadcn/ui and Radix UI for accessible primitives and owned component
  source. Tailwind CSS provides the styling layer and design tokens. Do not use
  Chakra UI as the default design system, and do not introduce Next.js unless a
  later requirement needs a real Next server or static-export-only benefit that
  Vite cannot provide.
- Relay visual constraints remain: one workspace, one composer, large
  whitespace, subdued borders, no mode buttons, no model/provider controls,
  no decorative gradients, and diagnostics collapsed by default.
- AG-UI component adoption must not weaken Relay policy. Tool execution,
  approval requirements, workspace containment, and support-bundle privacy stay
  in the sidecar governance layer.

### Local web app security

- Bind the workbench server to `127.0.0.1` by default. Do not listen on LAN
  interfaces unless a future explicit setting and security review adds it.
- Use a random per-run local access token in the launch URL and require it on
  every state-changing API request and event stream.
- Validate `Origin` / `Host` headers for browser requests. Reject cross-origin
  requests that do not match the launched workbench origin.
- Do not rely on browser cookies alone for local authentication. Localhost apps
  are still web apps and must guard against CSRF-style requests.
- Disable directory listing for static assets and expose only the built
  workbench bundle.
- Treat file paths, tool observations, and logs as sensitive local data. Never
  expose them through unauthenticated endpoints.

### Run lifecycle and state

- Implement an append-only run ledger in user-local Relay data:
  user message, Copilot steps, tool calls, observations, approvals, errors,
  final answer, and artifact paths.
- Support cancellation and clear terminal states (`completed`, `cancelled`,
  `failed`). A cancelled run must stop further tool execution.
- Add single-instance and port management: lock file, selected port record,
  stale process cleanup, browser-open retry, and graceful shutdown.
- On restart, show incomplete runs as recoverable history, not as active
  hidden background work.

### Observability and supportability

- Add first-class run IDs and trace IDs. Every Copilot request, tool call,
  approval, validation failure, and file mutation should be tied to the same
  run ID.
- Capture Relay traces in an OpenTelemetry-compatible shape where practical,
  while keeping the user UI minimal. The visible UI shows only concise
  progress; detailed traces live behind a collapsed details panel and
  support-log export.
- Add a local support bundle export that redacts or clearly flags sensitive
  file paths and does not include document contents unless the user explicitly
  chooses to include them.
- Add readiness probes for Copilot CDP, ripgrep, OfficeCLI, workspace access,
  static asset integrity, and tool catalog load. Startup should show a concise
  not-ready state rather than accepting tasks that cannot run.

### Change provenance and recovery

- For code work inside a git repository, record pre-run `git status`, planned
  edits, applied edits, post-run `git diff`, and dirty-file warnings. Relay
  should not auto-commit by default, but it should make review and undo
  straightforward.
- For non-git workspaces, record file hashes before mutation and keep explicit
  backup files in user-local Relay data or a user-approved backup location.
- For Office mutations, keep the current backup-before-apply policy and add an
  operation manifest that records the OfficeCLI command, target file, backup
  path, timestamp, and result.
- Provide a visible `元に戻す` path only when Relay has enough backup/diff
  evidence to restore safely. Do not fake undo for operations that are not
  reversible.

### Sandbox and command policy

- Keep unrestricted shell out of the default tool catalog. Prior agent systems
  distinguish isolated/container runtimes from direct process execution because
  direct local execution can read/write anything the user account can access.
- If shell execution is ever added, it must be a separate milestone with an
  explicit sandbox strategy, workspace mount policy, command allow/deny policy,
  and UI approval model. It must not appear as a hidden capability of the
  initial generic runner.
- Treat OfficeCLI and ripgrep as named tools with bounded argv validation, not
  as a generic shell escape hatch.

### Tool and approval policy

- Follow the proven pattern from coding agents: read-only inspection may run
  automatically inside the selected workspace; any mutation requires explicit
  approval.
- Do not add a broad user-facing auto-approve settings panel. It increases
  complexity and risk. Start with fixed policy: reads allowed, writes require
  approval, shell absent by default.
- Approval cards must show the exact operation, target path, backup/diff
  outcome where applicable, and the consequence of applying it.
- Tool policies are enforced by Relay, not trusted to Copilot prompts.

### Packaging and supply chain

- Use self-contained .NET publish targets for Windows and Linux so end users do
  not need to install .NET separately.
- Include static web assets in the sidecar package or alongside it with
  integrity checks.
- Windows distribution should use a user-scope NSIS installer for the sidecar
  Workbench. The installer must not require administrator rights, elevation,
  or the user's personal password.
- Produce a release inventory/SBOM-style artifact listing bundled binaries,
  licenses, hashes, and removed legacy components.
- Package ripgrep and OfficeCLI explicitly where licensing and platform support
  allow; otherwise fail readiness visibly with installation guidance. Do not
  silently fall back to slower or weaker implementations.

## 2026-05-16 Web-Researched Requirements Addendum

The following requirements are added after reviewing current Microsoft Agent
Framework, AG-UI, Edge DevTools Protocol, MCP, OWASP LLM security, and SBOM
guidance. These are product requirements where they describe Relay-owned
behavior; third-party framework adoption remains optional unless a later ADR
promotes it.

Reference anchors:

- ASP.NET Core Minimal APIs and localhost URL binding:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis`
- ASP.NET Core static files and directory browsing behavior:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files`
- .NET self-contained deployment:
  `https://learn.microsoft.com/en-us/dotnet/core/deploying/`
- Microsoft Agent Framework human-in-the-loop approval docs:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`
- Microsoft Agent Framework tool calling docs:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- Microsoft Agent Framework 1.0 announcement:
  `https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/`
- Microsoft Agent Framework durable execution docs:
  `https://learn.microsoft.com/en-us/azure/durable-task/sdks/durable-agents-microsoft-agent-framework`
- Microsoft Agent Framework + AG-UI demo:
  `https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/`
- AG-UI protocol overview:
  `https://docs.ag-ui.com/introduction`
- AG-UI event model:
  `https://docs.ag-ui.com/sdk/js/core/events`
- AG-UI events concept docs:
  `https://docs.ag-ui.com/concepts/events`
- Microsoft Edge DevTools Protocol docs:
  `https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/`
- ASP.NET Core host filtering docs:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering`
- Microsoft Agent Framework MCP guidance:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools`
- Claude Code settings and permission model reference:
  `https://code.claude.com/docs/en/settings`
- MCP client/security best-practice docs:
  `https://modelcontextprotocol.io/docs/develop/clients/client-best-practices`
  and
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- OWASP LLM06 Excessive Agency:
  `https://genai.owasp.org/llmrisk/llm062025-excessive-agency/`
- OWASP Top 10 for LLM Applications project:
  `https://owasp.org/www-project-top-10-for-large-language-model-applications/`
- OpenAI prompt-injection safety overview:
  `https://openai.com/safety/prompt-injections/`
- ripgrep user guide:
  `https://ripgrep.dev/docs/guide/`
- NSIS `RequestExecutionLevel` docs:
  `https://nsis.sourceforge.io/Reference/RequestExecutionLevel`
- NSIS `MultiUser.nsh` per-user installation docs:
  `https://nsis.sourceforge.io/Docs/MultiUser/Readme.html`
- NIST SBOM guidance:
  `https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-security-supply-chains-software-1`

### Agent harness and event protocol requirements

- Use Microsoft Agent Framework in the .NET sidecar as the production harness
  for the generic agent loop. Its responsibilities are agent turns, tool-call
  detection, typed function dispatch, sessions, middleware, approval
  pause/resume, streaming updates, durable run state, and final answer
  synthesis.
- Relay remains the local governance layer around Agent Framework, not a
  competing orchestrator. Relay owns the M365 Copilot CDP provider adapter,
  workspace containment, local function bodies, backups, diffs, support
  bundles, and packaging.
- Implement tools as Agent Framework function tools first. Use
  `AIFunctionFactory.Create` with typed parameters and descriptions for
  in-process tools. Use `ApprovalRequiredAIFunction` for write/mutation tools.
  Add Relay middleware only for policy checks, logging, diagnostics, and
  Copilot transport adaptation.
- Do not add a parallel Relay-owned workflow runner, Python runner, OpenCode
  runner, or direct ad hoc AG-UI runner as a fallback. If Agent Framework cannot
  express a required Relay behavior, add a narrow adapter or middleware around
  Agent Framework and document the gap.
- Copilot transport failures are product failures, not alternate-route
  triggers. Prompt delivery failure, send failure, response extraction failure,
  invalid JSON, stale response pickup, or selector drift must fail the run with
  AG-UI error events and diagnostics so developers can fix the adapter.
- Implement human-in-the-loop approval as a loop, not as a single callback:
  when Agent Framework emits an approval request for a mutation function, the
  UI pauses the same run, presents the approval through AG-UI, and resumes only
  after approve/reject.
- Use AG-UI events for the Workbench run stream. Required event coverage
  includes run lifecycle, text message streaming, tool call start/args/result,
  state snapshot/delta, approval interrupt/resume, artifact creation, errors,
  cancellation, and completion.
- Keep the visible UI minimal, but preserve enough typed event metadata for
  replay, support export, and evaluation. Do not create a second event stream
  for the same run.
- Implement local durable-equivalent behavior: append-only run ledger,
  checkpointed observations, pause/resume, cancellation, terminal states, and
  retention/TTL cleanup in user-local data.

### Governance, security, and prompt-injection requirements

- Enforce action-layer governance before every tool execution. Relay must
  evaluate tool name, arguments, workspace scope, write/mutation status,
  approval state, rate limits, and policy before execution. Copilot prompts are
  not a security boundary.
- Minimize agency by default:
  - expose only the generic tools required for the task;
  - keep unrestricted shell absent from the default catalog;
  - require explicit approval for all writes, Office mutations, external
    network access, and future shell execution;
  - fail closed when tool selection or arguments are invalid.
- Treat all file contents, tool outputs, MCP/tool descriptions, and Copilot
  responses as untrusted data. They may be summarized or inspected, but they
  must never be allowed to change Relay policy, enable tools, bypass approval,
  change workspace scope, or alter system instructions.
- Add an explicit prompt-injection test corpus:
  local documents that instruct the agent to ignore policy, leak paths, enable
  shell, edit unrelated files, or exfiltrate content must not change Relay's
  execution policy.
- Add sensitive-data controls:
  support bundles redact or clearly flag local paths and omit document content
  by default; logs store tool metadata and bounded snippets only unless the
  user explicitly opts into full-content export.
- Strengthen localhost web security:
  keep loopback binding; require the launch token on APIs and event streams;
  validate `Host` and `Origin`; reject unauthenticated API calls; disable
  directory listing; and serve only the built static bundle.

### Tool discovery, MCP, and external tool requirements

- Keep the initial production catalog small but complete enough for a generic
  local agent: `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
  `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
- Add progressive tool discovery only when the catalog grows beyond the small
  always-on set. If adopted, expose a stable meta-tool such as `search_tools`
  and inject full schemas only for selected tool families. Do not churn the
  whole tool list every turn.
- MCP is not part of the first production tool surface. If later adopted:
  - allow only trusted, local, explicitly configured MCP servers by default;
  - never auto-install or auto-connect remote MCP servers;
  - log and audit every server, tool list, schema change, and tool call;
  - treat sessions as state handles, not authentication;
  - apply the same Relay approval and workspace policy to MCP tool calls as to
    built-in tools.
- Do not expose programmatic/code-mode tool calling until Relay has a sandbox
  design. The MCP guidance shows why code-mode can reduce token usage, but it
  requires a real sandbox and must not become an implicit unrestricted shell.

### Generic agent recipe requirements

These are not separate modes. They are common recipes that prove the generic
Agent Framework + Relay tool model is capable enough for real work.

- Local file search recipe:
  - Copilot chooses discovery terms and whether filename search, content search,
    or exact reads are needed.
  - Relay executes `rg_files`, `rg_search`, and `read` with caps, workspace
    containment, and evidence states.
  - Copilot synthesizes only from Relay observations. It must separate
    confirmed evidence from candidates and ask for follow-up search/read when
    the result set is skewed or weak.
- Office file editing recipe:
  - Copilot inspects the target Office file through `read` or registry-backed
    OfficeCLI inspection operations.
  - Relay compiles typed Office capability-registry operations to OfficeCLI
    argv, creates a backup, emits an AG-UI approval interrupt, applies only
    after approval, and verifies with a post-apply OfficeCLI view/read/render
    where available.
  - The Office registry must be broad enough to use OfficeCLI's agent-facing
    surface for Word, Excel, PowerPoint, and cross-document workflows, while
    still fail-closing on unknown command families, unsupported properties,
    ambiguous targets, unsafe paths, or OfficeCLI version drift.
  - Invalid sheet names, ambiguous ranges, missing OfficeCLI, and smoke failures
    fail the Office task clearly without degrading unrelated agent tasks.
- Coding recipe:
  - Copilot explores with `rg_files`, `rg_search`, `read`, and
    `workspace_status`.
  - Relay applies only validated `edit`/`write` mutations after approval and
    shows `diff` before and after mutation.
  - Copilot may request `run_command` for bounded verification, then iterate on
    failures through the same Agent Framework loop.
- General task recipe:
  - When a task does not fit search, Office, or coding, Copilot should still use
    the same generic inspect, mutate, verify, ask, and final-answer tools. Do
    not add a new mode unless a reusable tool family is genuinely missing.

### Copilot CDP reliability requirements

- Treat Edge CDP as a browser automation transport, not a stable Microsoft 365
  Copilot product API. Every release must include a live canary or manually
  recorded validation showing:
  - Copilot tab discovery or creation;
  - prompt paste reaches the composer;
  - send action succeeds;
  - stop/send button lifecycle or feed update is observed;
  - response extraction returns only the assistant answer, not sidebar/history
    chrome.
- Add DOM-contract regression fixtures from successful live sessions. The
  sidecar should keep selector candidates versioned and tested against saved
  feed/composer snippets so future Copilot DOM changes fail in CI before
  release when possible.
- Add visible CDP failure classes:
  `edge_not_running`, `cdp_unreachable`, `copilot_not_signed_in`,
  `composer_not_ready`, `prompt_not_pasted`, `send_unavailable`,
  `response_timeout`, and `response_parse_failed`.
- Start Edge/Copilot lazily and independently from Workbench first paint, but
  prewarm as soon as the user focuses the composer or starts a run. The UI must
  show `Copilot 接続中` rather than appearing frozen.

### Evaluation and release-readiness requirements

- Add a golden evaluation suite for the unified agent runner. Minimum cases:
  - file search chooses `rg_files`/`rg_search`/`read` and does not use
    Microsoft 365 built-in search; results distinguish filename candidates from
    content-confirmed evidence;
  - Office inspection uses `read` or semantic `officecli` view operations and
    Office mutation pauses for approval before execution, creates a backup, and
    verifies after apply;
  - code editing reads relevant files, proposes exact validated edits, shows a
    diff, applies only after approval, runs a bounded verification command when
    appropriate, and either fixes failures or reports them clearly;
  - a non-search/non-Office/non-code task can still use the generic inspect,
    mutate, verify, ask, and final tools without introducing a new UX mode;
  - invalid tool names or invalid arguments stop visibly;
  - prompt-injected file content cannot change policy;
  - repeated Copilot answer text does not cause stale response extraction.
- Evaluate tool calls on correctness, argument validity, intent alignment,
  dependency ordering, failure handling, and traceability. These criteria must
  be captured in machine-readable test output, not only manual notes.
- Add release canaries:
  - mock Copilot path for deterministic CI;
  - live signed-in Copilot CDP path when a signed-in Edge session is available;
  - OfficeCLI smoke on each packaged platform where OfficeCLI is supported;
  - ripgrep smoke from packaged resources and PATH.
- Generate a release SBOM or SBOM-style inventory in addition to the current
  release inventory. It must include direct dependencies, bundled binaries,
  hashes, versions, license/source notes, and an explicit list of intentionally
  excluded legacy runtimes.
- Make `docs/IMPLEMENTATION.md` record each requirement-level verification
  command and result. A task is not complete until the artifact or test output
  exists.

## AG-UI Workbench UX Plan

The integrated UX should be AG-UI-first and should feel like a quiet
professional workbench, not a developer console and not a wizard. AG-UI is the
source of truth for agent interaction structure; Relay's visual layer should
apply that structure with restrained enterprise styling.

Target frontend stack:

- React + Vite + TypeScript.
- Tailwind CSS for layout, spacing, typography, and design tokens.
- shadcn/ui for owned, editable component source.
- Radix UI for accessible primitives and focus/keyboard behavior.
- `@ag-ui/client` for the agent protocol runtime.
- lucide-react for icons.
- No Next.js by default; no Chakra UI by default.

### Layout

- Top bar: Relay mark, current workspace, compact Copilot/agent readiness.
- Main canvas: centered single column, `960-1040px` max width on desktop.
- AG-UI message thread: streaming assistant output, tool activity, and run
  status rendered from AG-UI events.
- Composer: one large natural-language input with one primary send action,
  connected to the AG-UI client runtime.
- Tool activity: concise AG-UI tool-call timeline, collapsed by default after
  completion.
- Approvals: AG-UI interrupt cards visible only when a local write/mutation is
  pending.
- State/results: AG-UI state snapshot/delta renders selected files, artifacts,
  changed paths, Office operation results, and final answer cards.
- Details: raw AG-UI event stream, observations, diagnostics, and logs are
  collapsed by default.

### Spacing and visual rules

- Use AG-UI/CopilotKit/Dojo agent UI patterns as the visual interaction
  reference, then strip them down to Relay's professional local-workbench
  surface.
- Use generous page margins: at least `32px`, and `56-80px` on wide displays.
- Use subdued panels and borders rather than heavy shadows.
- Keep cards at 8px radius or less.
- Keep result rows scannable; do not pack every metadata field into the first
  view.
- Prefer small section labels and restrained typography over large marketing
  headings.
- Use Relay design tokens for brand and spacing only where they do not conflict
  with AG-UI component structure. Do not fork AG-UI behavior to preserve old
  CSS.
- Avoid AI-purple gradients, decorative blobs, emoji icons, and tutorial copy.

### Interaction model

Initial state:

```text
Workspace: .../160連結

何をしますか？
[ 部品売上に関するファイルを探して                    ][送信]
```

During execution:

```text
assistant message stream
tool_call: rg_files
tool_result: candidates found
tool_call: read
state_delta: candidate evidence updated
```

Before a write:

```text
実行前に確認してください

Book2.xlsx
Sheet1 / A1 の塗りつぶしを赤に変更

[実行] [キャンセル]
```

Completed:

- Show the final answer first.
- Show result cards, changed files, or Office edit outcome below.
- Keep trace/details collapsed unless the user expands them.
- The visible result must be reconstructable from AG-UI messages, tool events,
  state events, and interrupts/resume events.

### Smooth UX acceptance requirements

The Workbench must be validated as a user-facing product, not only as a
backend agent API.

- First paint and entry route:
  - the launch URL `/` with the relay token must render the Workbench, not a
    404, browser error page, Edge Copilot page, or diagnostic console;
  - the first visible surface must be usable without opening details or logs;
  - static asset directory listing must remain blocked while the root route
    still serves the app.
- Readiness:
  - readiness must not collapse all tool checks into one misleading
    `Not ready` state;
  - use `Ready` when all checked tools are available, `Limited` when Copilot
    is available but optional tool checks fail, and `Not ready` only when the
    agent cannot accept tasks;
  - the composer remains understandable in `Limited` state and the detailed
    missing-tool reasons stay in collapsed details.
- Task flow:
  - a read-only task submitted from the composer must visibly progress to a
    final answer without mode selection;
  - a write/mutation task must pause before mutation, show one concise approval
    AG-UI interrupt card, and never create or modify a file before approval;
  - after approval, the approval card must disappear and the completed result
    must be visible without requiring the user to inspect raw JSON.
- AG-UI behavior:
  - run lifecycle, message streaming, tool activity, approval interrupts,
    resume, errors, cancellation, and final output must render from AG-UI
    events;
  - no Workbench-only custom event field may be required to show the main user
    experience;
  - raw Relay run ledger data may exist only behind diagnostics/support export.
- Visual behavior:
  - legacy mode labels such as `資料を探す`, `Officeファイルを編集する`, and
    `コードを書く` must not appear in the unified Workbench;
  - details, raw observations, and diagnostics remain collapsed by default;
  - the focused work area should stay within roughly `960-1040px` on desktop
    and preserve generous whitespace.
- Responsiveness:
  - deterministic mock E2E should complete read-only final-answer display and
    approval-card display within `6s` each;
  - the test must save screenshots for empty, completed, and approval states
    so spacing regressions can be inspected.
- Regression gate:
  - `pnpm workbench:ux-e2e` is the browser-level UX smoke gate. It launches
    the sidecar, opens Microsoft Edge through CDP, performs a real DOM-driven
    submit/approval flow, and writes screenshots under `dist/e2e/`.
  - `pnpm check` remains the non-browser acceptance gate; UX E2E is run when
    verifying user-visible flow changes or release readiness on machines with
    Edge available.

### Live Copilot UX requirements

Mock E2E is not enough for release confidence. Relay must also prove that the
same Workbench flow can drive a signed-in M365 Copilot session.

- Live gate:
  - `pnpm workbench:live-copilot-e2e` is the signed-in Copilot UX gate.
  - It must run with mock Copilot disabled and `RELAY_COPILOT_CDP_PORT`
    pointing at a real signed-in Microsoft Edge CDP session.
  - The Workbench browser and the Copilot browser must use separate CDP ports
    and profiles so user-facing UI automation cannot disturb the controlled
    Copilot tab.
- What it must prove:
  - `/api/status` reports Copilot CDP reachable before accepting the run;
  - the Workbench readiness pill reaches `Ready` or `Limited`, not a frozen
    `Checking` state;
  - the user can submit a task from the single composer;
  - Relay can paste the prompt into Copilot, submit it, wait for completion,
    extract the assistant response, and display the final event in the
    Workbench;
  - diagnostics/details remain collapsed by default after completion;
  - a screenshot of the completed live Copilot run is captured under
    `dist/e2e/`.
- Smoothness target:
  - for a short exact-response prompt, live Copilot final-answer display should
    complete within `15s` on a signed-in warm Edge session;
  - `15-30s` is acceptable but should be flagged as degraded;
  - over `30s`, prompt delivery failure, stale response extraction, or
    completion detection must be treated as a UX regression unless Microsoft
    365 service latency is clearly isolated.
- Failure requirements:
  - if the CDP port is unreachable, the run fails with a clear `Copilot CDP is
    not reachable` message;
  - if Copilot is signed out, blocked by tenant policy, or the composer cannot
    be found, the UI must show a visible actionable error and must not silently
    retry forever;
  - invalid Copilot output may fail the run, but the user must see whether the
    failure was prompt delivery, send button, response timeout, JSON/action
    validation, or tool validation.
- Prompt and JSON robustness:
  - Copilot prompts must not include copyable placeholder answers such as
    `"Japanese answer"` that can be mistaken for valid output;
  - Relay must parse the first complete JSON object from a Copilot response so
    harmless trailing text does not break an otherwise valid action;
  - if multiple JSON objects or trailing prose appear, Relay uses only the
    first complete object and still validates action/tool/args before
    execution.
- Release policy:
  - deterministic mock UX E2E remains suitable for CI;
  - live Copilot E2E is required before release or after any change touching
    Copilot CDP selectors, prompt delivery, response extraction, readiness, or
    Workbench run rendering.

## Non-Negotiable Completion Criteria

- The first visible product surface is the Relay Workbench, not Edge Copilot,
  OpenCode Web, AionUi, Tauri shell, or a diagnostic console.
- The Workbench shell is browser-hosted local web UI served by Relay's sidecar.
  Tauri is not an optional wrapper or fallback in the final product.
- The user should be able to submit a natural-language task from a single
  composer without selecting a mode first.
- Copilot may choose local tools, but Relay is the only component that executes
  tools.
- File search must execute through Relay-owned local tools, primarily
  ripgrep-backed `rg_files` / `rg_search` plus exact `read`, not Microsoft 365
  built-in search, SharePoint search, or Copilot's own browsing.
- Office workflows must execute through OfficeCLI, not Microsoft 365 built-in
  editing or ad hoc shell scripts.
- Relay may introspect OfficeCLI help/schema output to keep the semantic
  operation registry aligned with the bundled OfficeCLI version, but Copilot
  must never emit or directly execute raw OfficeCLI argv.
- OfficeCLI availability must not be marked failed when the failure is caused
  by Relay's own smoke-test file locking. File-sharing violations during smoke
  checks are release blockers until the smoke harness is corrected.
- Code workflows must apply only validated exact-string patches inside the
  selected workspace, show diffs, and run only bounded verification commands.
  Copilot may not execute tools or edit files directly.
- Agentic workflows must keep Copilot's authority limited to structured
  planning and synthesis. Relay is the only component that executes tools.
- The installed application must be able to run without bundled Codex
  app-server, bundled OpenAI clients that require external credentials, or
  hidden third-party agent binaries.
- Ollama is out of current release scope. It must not appear as a readiness
  gate, model picker, hidden reasoning path, or fallback harness.
- Write actions for Office and code require explicit user approval in the UI.
- Runtime errors must be visible in the UI. Silent stalls are release blockers.
- Installer generation must not use the AionUi release workflow.

## Historical Work And Deletion Context

The repository previously contained active Tauri/AionUi/OpenCode/OpenWork and
document-search-specific code. Those implementations have been removed from the
active source path; remaining references in historical docs are archival only
and are not a source of product direction.

Active cutover facts:

- `apps/workbench/` is the active browser Workbench UI.
- `apps/sidecar/` is the active .NET sidecar, Copilot transport, run manager,
  and local tool executor.
- The active runtime exposes one generic agent loop and a small generic tool
  catalog. Search, Office editing, and code editing are capabilities within
  that loop, not separate product modes.
- Stable Copilot bridge behavior may be ported from old commits only when it
  improves the current sidecar transport. Do not revive the old Node/Tauri
  bridge, AionUi shell, per-mode prompt contracts, or document-search engine.

Historical material that must not remain on the active path:

- Tauri IPC commands, Tauri resource packaging, and Tauri release workflows.
- AionUi overlays, AionUi provider configuration, and OpenCode/OpenWork gateway
  scripts.
- `RelayDocumentSearch*` high-level engines, SQLite/FTS/index coordinators,
  reflection prompts, and search-specific ranking/classification contracts.
- UI mode runners for `資料を探す`, `Officeファイルを編集する`, and `コードを書く`.
- Archive prompt files or historical design docs that are not required at
  runtime.

The only search-related behavior to preserve in the active plan is the generic
principle: Copilot may plan local exploration, Relay executes `rg_files`,
`rg_search`, and exact `read`, and Relay returns structured evidence-state
observations for Copilot to synthesize.

## Cutover Implementation Tasks

This checklist records the cutover contract and regression criteria. Many
items have already been implemented in the active sidecar/workbench path; do
not restart from item 1 by reintroducing deleted architecture. New work should
start from the **Current Review Remediation Plan** unless a regression proves a
cutover criterion below is no longer satisfied.

1. Freeze and inventory old paths before coding:
   - Inventory all active references to AionUi, OpenCode, OpenWork, Codex
     app-server, Tauri, Tauri IPC, Tauri resources, and release workflows.
   - Classify each reference as `active product`, `test`, `archived historical
     doc`, or `third-party factual reference`.
   - Strengthen the hard-cut guard so it scans active source, workflows,
     scripts, release inputs, and packaged assets, not only root package
     scripts.
   - Update `AGENTS.md` and any source-of-truth docs that still instruct Relay
     to keep OpenCode/OpenWork or Tauri as active substrate.
2. Build the final Relay sidecar foundation, not a temporary prototype:
   - Create a self-contained .NET sidecar as the primary process.
   - Host the static Relay Workbench web UI from the sidecar.
   - Expose local HTTP/WebSocket APIs for sessions, tools, approvals, status,
     logs, workspace selection, and shutdown.
   - Port or replace the Copilot Edge/CDP bridge inside the sidecar boundary so
     there is one Copilot transport path.
   - Use Microsoft Agent Framework in the sidecar as the active agent harness.
     The old Relay-owned runner must not remain as a fallback once the
     migration is complete.
   - Move required runtime resources such as OfficeCLI or ripgrep bundles out
     of `apps/desktop/src-tauri` into a sidecar-owned `tools/` or
     `third_party/` location before deleting the desktop tree.
3. Build the final browser-hosted Workbench UI:
   - One natural-language composer, no visible task-mode buttons.
   - Workspace selector.
   - Concise agent status and trace.
   - Result cards for files, Office operations, and code changes.
   - Approval cards for every write/mutation.
   - Collapsed diagnostics/details only.
   - No AionUi, OpenCode, Tauri, provider, model, runtime, feedback, or debug
     chrome.
   - Keep reusable design guidance in `apps/workbench/` or `docs/`; do not
     depend on deleted desktop design files.
4. Implement the generic progressive tool catalog:
   - `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
     `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
   - Validate every argument before execution.
   - Implement path containment, size/time limits, cancellation, and structured
     observations.
   - Stop on validation failure; do not route to old search, Office, or code
     runners as fallback.
5. Implement the Agent Framework runtime, approval loop, and governance layer:
   - Replace any one-shot or per-mode flow with a bounded Agent Framework run
     loop that uses the Relay Copilot provider adapter.
   - Add sidecar tool wrappers for the generic Relay tools.
   - Add middleware/policy checks for allowed tools, workspace scope, mutation
     approval, rate limits, and audit logging.
   - Implement approval handling as a pause/resume flow in the same run
     session.
   - Stream run events to the Workbench through AG-UI.
6. Add durable local run state:
   - Append every user message, Copilot step, tool call, observation,
     approval, artifact, error, and final answer to a run ledger under
     user-local Relay data.
   - Support cancellation and terminal states.
   - On restart, display incomplete runs as recoverable history, not active
     hidden work.
   - Add retention/TTL cleanup for stale ledgers, temp files, and support
     bundles.
7. Migrate all capabilities onto the common agent runner:
   - File discovery/search through `rg_files`, `rg_search`, and `read`.
   - Office inspection/editing through `officecli` semantic operations and
     Relay-compiled commands.
   - Code inspection/editing through `rg_*`, `read`, `edit`, and `write`.
   - Remove the old per-mode runners after parity, not leave them callable.
8. Add Copilot CDP reliability hardening:
   - Version and test composer/feed selectors against saved DOM fixtures.
   - Add failure classes for Edge/CDP/Copilot readiness and prompt delivery.
   - Keep live signed-in CDP canary scripts for release validation.
   - Ensure response extraction never returns sidebar, history, suggestion, or
     empty assistant-turn text as the model answer.
9. Add security and prompt-injection regression tests:
   - Add fixture documents that attempt to override Relay policy.
   - Prove untrusted file/tool output cannot enable tools, bypass approvals,
     expand workspace scope, or alter system instructions.
   - Prove support bundle export redacts or omits sensitive content by default.
10. Replace packaging:
   - Remove Tauri release workflow as an active release path.
   - Package the .NET sidecar and static web assets for Windows as a
     user-scope NSIS installer. The installer must install under a user-writable
     location such as `%LOCALAPPDATA%\Programs\Relay Agent`, must not require
     administrator rights or UAC elevation, and must not ask for the user's
     personal Windows password.
   - Package Linux as a self-contained archive plus launcher.
   - Provide a Windows launcher that starts the sidecar, starts or checks the
     signed-in Edge CDP session, opens the localhost workbench, and shuts down
     cleanly.
   - Bundle required Windows runtime tools in the installer where licensing and
     platform support allow: `Relay.Sidecar.exe`, Workbench static assets,
     `rg.exe`, `officecli.exe`, launcher files, default config, license/notice
     files, release inventory, and SBOM-style metadata.
   - Add a dedicated packaging command such as
     `pnpm sidecar:installer:windows` and a GitHub Release workflow that uses
     that command instead of any Tauri installer workflow.
   - The installer must create Start Menu and optional desktop shortcuts, an
     uninstall entry, and per-user registry/app metadata only. It must not write
     machine-wide registry keys or require Program Files installation.
   - Keep all app data, cache, logs, and temp files in user-local Relay
     directories.
   - Generate SBOM/SBOM-style release inventory with hashes, versions,
     licenses/source notes, and intentionally excluded legacy runtimes.
11. Delete active obsolete code:
   - Remove AionUi overlay code, OpenCode/OpenWork provider gateway code,
     Tauri shell/IPC/resources/workflows, and old high-level workflow runners
     once the new path is wired.
   - Remove `apps/desktop/document-search-src` and any active
     `RelayDocumentSearch*` code after confirming the generic `rg_*`/`read`
     tools cover the active search path.
   - Archive historical docs only when useful; do not keep active package
     scripts or tests that exercise removed runtime paths.
12. Verify the hard cutover:
   - Playwright screenshots for the browser-hosted workbench at desktop and
     narrow widths: empty, running, result, approval, error.
   - Linux and Windows E2E for startup, browser launch, Copilot connection,
     tool choice, approvals, search, Office inspect/edit where supported, code
     edit, shutdown, and uninstall.
   - E2E for security boundaries: localhost binding, launch token required,
     Origin/Host rejection, static asset directory listing disabled, and
     unauthenticated API rejection.
   - E2E for run lifecycle: cancellation stops tools, restart shows incomplete
     runs as history, and support bundle export works without leaking document
     contents by default.
   - E2E for change provenance: code diff capture, Office backup manifest,
     reversible undo where supported, and clear no-undo messaging where not
     supported.
   - Source and release inventory proving active AionUi/OpenCode/OpenWork/Tauri
     paths are removed.
   - Failure-path tests proving invalid Copilot/tool output stops with visible
     errors and does not invoke fallback execution.
   - Golden agent evaluations for tool choice correctness, argument validity,
     intent alignment, dependency ordering, failure handling, traceability, and
     prompt-injection resistance.
13. Complete the Relay rebranding cleanup:
   - Rename Relay-owned archive prompt files currently named
     `docs/archive/CODEX_PROMPT_*.md` / `docs/archive/codex_*.md` to
     `RELAY_PROMPT_*.md` / `relay_*.md`, preserving history in Git rather than
     deleting the files.
   - Update internal links and references that point to those renamed archive
     files.
   - Replace user-facing prose that says `Codex` when it means the Relay
     product, Relay implementation agent, or historical Relay prompt artifact.
   - Do not rename or rewrite references where `Codex` is an upstream
     dependency or required configuration surface, including `Codex app-server`,
     `codex` CLI commands, `CODEX_HOME`, external docs, and compatibility notes
     about third-party behavior.
   - Add a verification note showing the remaining `codex` / `Codex` matches
     are only upstream references or intentionally archived historical wording.
14. Add a corporate-compliance packaging review:
   - Inventory every release resource, executable, npm package, generated
     file, config directory, environment variable, and runtime process name that
     contains `codex`, `Codex`, OpenAI, OpenCode, or OpenWork terminology.
   - Classify each match as `Relay-owned branding`, `upstream dependency`,
     `developer-only artifact`, `archived historical doc`, or `runtime-required
     integration name`.
   - Remove developer-only and archived prompt artifacts from release bundles
     unless they are explicitly needed at runtime.
   - Do not bundle upstream `codex` CLI/app-server, OpenCode, or OpenWork in
     the release.
   - Implement Relay/Copilot integration through Microsoft Agent Framework in
     the Relay sidecar instead of hidden third-party agent artifacts.
   - Add a release verification artifact that lists remaining matches and their
     classification, plus the reason each one is acceptable for installation.
15. Keep out-of-scope model/harness options outside the cutover:
   - Microsoft Agent Framework is the approved backend harness. Do not add
     Ollama, MCP, unrestricted shell execution, Python workflow wrappers, or a
     second agent harness to the current release scope.
   - If one of those options is reconsidered later, require a separate ADR with
     threat model, packaging impact, UX impact, verification gates, and removal
     criteria for any replaced code path.
   - The current cutover completes only when Microsoft Agent Framework in the
     Relay sidecar, the M365 Copilot adapter, generic local tools, and browser
     Workbench are the single active product path.

## Verification Gates

- `pnpm check`
- `pnpm release:inventory`
- AG-UI adoption gates:
  - Workbench-facing run stream emits AG-UI events, not the old custom
    `RunEvent` wire union;
  - AG-UI message/tool/state/interrupt/resume/completion events can replay a
    run from start to final answer;
  - browser E2E proves the AG-UI Workbench renders streaming output, tool
    activity, approval interrupt, resume, cancellation/error, and final answer;
  - screenshots prove the AG-UI-based visual surface keeps Relay's minimal,
    spacious, professional UX.
- Workbench visual smoke: browser-hosted local UI screenshots for empty,
  running, approval, completed, and error states.
- Sidecar security smoke:
  - loopback-only binding;
  - launch token required;
  - Host/Origin rejection;
  - unauthenticated API/event-stream rejection;
  - static directory listing unavailable.
- Agent runner golden evaluations:
  - correct tool family chosen;
  - arguments valid and workspace-scoped;
  - mutation pauses for approval;
  - file search separates candidates from confirmed evidence;
  - Office edits create backups, apply semantic operations, and verify after
    mutation;
  - coding tasks expose workspace status, diff, bounded command verification,
    and follow-up repair when verification fails;
  - invalid Copilot output stops visibly;
  - prompt-injected file/tool content cannot change policy.
- CDP reliability gates:
  - mock Copilot path for CI;
  - live signed-in Edge/CDP exact-response canary when available;
  - saved DOM fixture tests for composer/feed extraction.
- Tool readiness gates:
  - packaged ripgrep smoke;
  - OfficeCLI `view outline --json` smoke where OfficeCLI is supported;
  - OfficeCLI smoke file cleanup and retry on transient sharing violations.
- Release supply-chain gates:
  - sidecar Windows/Linux self-contained publish;
  - Windows user-scope NSIS installer build;
  - installer smoke proving no administrator rights, UAC elevation, personal
    password prompt, Program Files install, or machine-wide registry writes;
  - release inventory;
  - SBOM/SBOM-style dependency and binary inventory;
  - legacy runtime exclusion inventory.
- Agent Framework sidecar smoke:
  - local mock Copilot adapter returns expected Agent Framework response;
  - Agent Framework function tools are registered from typed Relay functions,
    and the run fails if Copilot tool projection cannot produce valid
    Microsoft.Extensions.AI tool-call content;
  - current bridge smoke proves mutating function tools use
    `ApprovalRequiredAIFunction` and do not execute before approval;
  - final approval cutover smoke proves AG-UI approval requests resume through
    Agent Framework approval response content and no longer use Relay's custom
    `PendingApproval` wire protocol;
  - final session smoke proves Agent Framework `AgentSession` state is
    persisted enough to resume an approval and to keep tool observations
    attached to the same run;
  - live Edge CDP -> M365 Copilot exact-response canary passes when a signed-in
    session is available;
  - generic tool-choice smoke covers `rg_files`/`rg_search`/`read`,
    `officecli`, `edit`/`write`, `workspace_status`, `diff`, `run_command`,
    and approval behavior.
- Sidecar release workflow: Windows publishes the user-scope NSIS installer;
  Linux publishes the sidecar archive/launcher. Neither path may package the
  removed Tauri/AionUi/OpenCode/OpenWork runtime.
