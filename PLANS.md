# Relay_Agent Completion Plan

Date: 2026-05-16

## Product Direction

Relay_Agent is moving from a three-mode utility app into a single local
business-agent workbench:

> **Copilot thinks. Relay executes local tools safely.**

The user-facing product should not ask users to choose between `資料を探す`,
`Officeファイルを編集する`, and `コードを書く`. Those are implementation
capabilities, not primary UX modes. The desktop app should expose one
workspace, one task composer, one agent trace, and one result/approval surface.
M365 Copilot chooses which local tools are needed from the user's natural
language request; Relay validates and executes those tools locally.

The product no longer treats AionUi, OpenCode/OpenWork, or Tauri as active
product architecture. The next architecture target is a **hard cutover** to a
browser-hosted local web workbench served by the Relay sidecar. Linux/Windows
parity, repeatable testing from Linux, and simpler distribution make this the
primary and only target path.

The next architecture target is a **generic Relay Workbench**:

- natural-language task input;
- Copilot-led step planning and tool selection;
- Relay-owned validation, approvals, execution, backups, diffs, and logs;
- generic local tools such as ripgrep-backed search, file read, OfficeCLI, and
  exact file edits;
- minimal UI with large whitespace and no diagnostic-first clutter.

## Architecture

- Chosen UI shell: browser-hosted local web workbench served by the Relay
  sidecar. The final product must not depend on Tauri IPC, WebView behavior, or
  Tauri packaging. Existing SolidJS/Vite UI code may be extracted and reused
  only as static web assets, not as a Tauri application.
- Removed shell targets: AionUi, OpenCode/OpenWork web shells, Tauri desktop
  shell, and any diagnostic-first shell are not fallback paths. They must be
  deleted from active product code, release workflows, package resources, and
  runtime launch paths during the cutover.
- Relay sidecar role: host the local web UI, expose local HTTP/WebSocket APIs,
  run the agent harness, validate and execute tools, manage app-local storage,
  and supervise the Copilot CDP bridge. The active implementation is the
  Relay-owned self-contained .NET sidecar and its bounded agent runner.
- Sidecar Copilot transport: the active sidecar owns the first
  OpenAI-compatible `/v1/chat/completions` surface and routes it through the
  sidecar Copilot transport. The historical Node/Tauri-era bridge is no longer
  the active product path.
- Browser role: the user opens the Relay Workbench at a localhost URL. This
  browser surface is separate from the controlled Edge/Copilot CDP session.
  If Edge is used for both, Relay must use a separate profile or CDP boundary
  so the workbench does not interfere with Copilot automation.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Agent harness: the production path is the Relay-owned sidecar runner. It
  sends bounded structured prompts to M365 Copilot, validates Copilot output,
  executes exactly one approved local tool step at a time, records the
  observation, and asks Copilot for the next step or final answer. Microsoft
  Agent Framework remains a reference design for typed tools, approvals, and
  sessions, not an active dependency or required migration target.
- Copilot transport shape: use the sidecar-owned Chat Completions-compatible
  Copilot transport. Stable behavior from the historical Node/Tauri bridge may
  be ported into the sidecar transport, but the final product must not keep a
  separate Node/Tauri-era bridge as an alternate runtime path.
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
  tool set. Initial target tools are:
  - `rg_files`: enumerate likely files using ripgrep's file listing and glob
    filters;
  - `rg_search`: search plaintext/code content using ripgrep;
  - `read`: read exact files, including Relay-supported plaintext extraction
    for Office/PDF where available;
  - `officecli`: inspect or mutate Office files through validated OfficeCLI
    semantic operations and locally compiled argv;
  - `edit`: exact-string file edits inside the selected workspace;
  - `write`: new file creation or complete rewrite, only after approval;
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
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the desktop UI.
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
  Arbitrary unrestricted shell is not part of the default tool catalog.
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
    Workbench static assets, local APIs, event stream, Copilot CDP transport,
    tool broker, run ledger, and package diagnostics.
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
  - Required endpoints: `/` for Workbench, `/api/status`,
    `/api/workspace`, `/api/runs`, `/api/runs/{id}`,
    `/api/runs/{id}/events`, `/api/runs/{id}/approve`,
    `/api/runs/{id}/cancel`, `/api/support-bundle`, and `/api/shutdown`.
- Event stream:
  - Use one Relay typed SSE stream per run, modeled on AG-UI event classes but
    owned by Relay. Do not maintain a second UI event protocol.
  - Required event classes: `run_started`, `status`, `copilot_turn_started`,
    `copilot_turn_completed`, `tool_call_started`, `tool_call_completed`,
    `approval_requested`, `approval_resolved`, `artifact_created`, `error`,
    `cancelled`, and `completed`.
  - Every event includes `runId`, monotonic `sequence`, timestamp, concise
    user-facing message, and structured metadata for replay/support export.
- Run lifecycle:
  - State machine: `created -> preparing -> waiting_copilot -> validating ->
    executing_tool -> waiting_approval -> synthesizing -> completed`.
    Terminal states are `completed`, `cancelled`, and `failed`.
  - Each Copilot step may emit exactly one validated tool call, `ask_user`, or
    `final`. Relay executes at most one local action before returning an
    observation to Copilot.
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
- Copilot transport:
  - The sidecar owns the Chat-Completions-compatible adapter over Edge CDP.
    This is an adapter contract for Relay; it is not a Microsoft 365 product
    API guarantee.
  - DOM selectors, paste/insert behavior, send-button lifecycle detection, and
    response extraction rules must be versioned against saved successful
    Copilot fixtures.
  - Response extraction must reject prompt echoes, sidebar/history text,
    suggestions, empty answers, stale prior answers, and incomplete JSON.
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

## Hard Cutover Rules

- No transitional fallback architecture. The migration is complete only when
  the new browser-hosted workbench and .NET sidecar are the single active
  product path.
- No simplified throwaway MVP. The first implementation slice must be shaped as
  the final architecture: sidecar-hosted UI, local HTTP/WebSocket APIs, Agent
  runner, Copilot bridge, generic tool catalog, approval flow, and
  packaging plan.
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

The browser-hosted sidecar design should incorporate the following lessons from
Microsoft Agent Framework, AG-UI, ASP.NET Core, and established agent tools,
without adopting those frameworks as mandatory runtime dependencies.

### Agent UI protocol

- Prefer a typed Server-Sent Events stream for the workbench/agent boundary
  instead of an unstructured ad hoc log stream. AG-UI event naming and
  human-in-the-loop patterns are useful references, but Relay keeps one
  sidecar-owned run event protocol unless a later ADR explicitly adopts AG-UI.
- Keep plain local HTTP APIs for non-agent app operations such as workspace
  selection, app status, logs export, static file serving, and shutdown.
- Use SignalR or raw WebSockets only if SSE cannot satisfy a specific future
  requirement. Do not maintain parallel event protocols for the same run
  lifecycle.

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
- Microsoft Edge DevTools Protocol docs:
  `https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/`
- ASP.NET Core host filtering docs:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering`
- Microsoft Agent Framework MCP guidance:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools`
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

- Use the Relay sidecar runner as the production harness for the generic agent
  loop. Its responsibilities are bounded Copilot turns, schema validation,
  local tool governance, approval pause/resume, durable run records, and final
  answer synthesis.
- Treat Microsoft Agent Framework as a reference for tool approvals, typed
  tools, sessions, and middleware. Do not add it as a second runner or runtime
  dependency without a focused ADR that explains why the sidecar runner should
  be replaced.
- Implement human-in-the-loop approval as a loop, not as a single callback:
  when Relay reaches a mutation step, the UI pauses the same run, presents the
  approval, and resumes only after approve/reject.
- Use typed Server-Sent Events for the Workbench run stream. Required event
  classes are `run_started`, `status`, `tool_call_started`,
  `tool_call_completed`, `approval_requested`, `approval_resolved`,
  `artifact_created`, `error`, `cancelled`, and `completed`.
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

- Keep the initial production catalog small: `rg_files`, `rg_search`, `read`,
  `officecli`, `edit`, `write`, `ask_user`, and `final`.
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
    Microsoft 365 built-in search;
  - Office inspection uses `officecli view` and Office mutation pauses for
    approval before execution;
  - code editing reads relevant files and proposes exact validated edits;
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

## Unified Workbench UX Plan

The integrated UX should feel like a quiet professional workbench, not a
developer console and not a wizard.

### Layout

- Top bar: Relay mark, current workspace, compact Copilot/agent readiness.
- Main canvas: centered single column, `960-1040px` max width on desktop.
- Composer: one large natural-language input with one primary send action.
- Results: visible only after a run starts or completes.
- Approvals: visible only when a local write/mutation is pending.
- Details: trace, raw observations, diagnostics, and logs are collapsed by
  default.

### Spacing and visual rules

- Use generous page margins: at least `32px`, and `56-80px` on wide displays.
- Use subdued panels and borders rather than heavy shadows.
- Keep cards at 8px radius or less.
- Keep result rows scannable; do not pack every metadata field into the first
  view.
- Prefer small section labels and restrained typography over large marketing
  headings.
- Use `--ra-*` CSS variables and existing warm/cool operational palette.
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
考えています
必要なツールを選択しています
rg_files で候補を探しています
read で候補を確認しています
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
    card, and never create or modify a file before approval;
  - after approval, the approval card must disappear and the completed result
    must be visible without requiring the user to inspect raw JSON.
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
- OfficeCLI availability must not be marked failed when the failure is caused
  by Relay's own smoke-test file locking. File-sharing violations during smoke
  checks are release blockers until the smoke harness is corrected.
- Code workflows must apply only validated exact-string patches inside the
  selected workspace. Copilot may not execute tools or edit files directly.
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

The repository still contains historical Tauri/AionUi/OpenCode/OpenWork and
document-search-specific code. These artifacts are inputs for deletion and
archival only; they are not a source of product direction.

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
`rg_search`, and exact `read`, and Relay returns structured observations for
Copilot to synthesize.

## Cutover Implementation Tasks

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
   - Keep the Relay-owned sidecar runner as the only active agent harness unless
     a future ADR explicitly replaces it.
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
     `ask_user`, and `final`.
   - Validate every argument before execution.
   - Implement path containment, size/time limits, cancellation, and structured
     observations.
   - Stop on validation failure; do not route to old search, Office, or code
     runners as fallback.
5. Implement the sidecar runner, approval loop, and governance layer:
   - Replace any one-shot or per-mode flow with a bounded sidecar session loop
     that uses the sidecar Copilot transport.
   - Add sidecar tool wrappers for the generic Relay tools.
   - Add middleware/policy checks for allowed tools, workspace scope, mutation
     approval, rate limits, and audit logging.
   - Implement approval handling as a pause/resume flow in the same run
     session.
   - Stream run events to the Workbench through the Relay typed SSE envelope.
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
   - Implement Relay/Copilot integration through the approved Relay sidecar
     runner instead of hidden third-party agent artifacts.
   - Add a release verification artifact that lists remaining matches and their
     classification, plus the reason each one is acceptable for installation.
15. Keep out-of-scope model/harness options outside the cutover:
   - Do not add Ollama, Microsoft Agent Framework, MCP, shell execution, or a
     second agent harness to the current release scope.
   - If one of those options is reconsidered later, require a separate ADR with
     threat model, packaging impact, UX impact, verification gates, and removal
     criteria for any replaced code path.
   - The current cutover completes only when the Relay sidecar runner, M365
     Copilot transport, generic local tools, and browser Workbench are the
     single active product path.

## Verification Gates

- `pnpm check`
- `pnpm release:inventory`
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
- Sidecar runner smoke:
  - local mock `/v1/chat/completions` returns expected agent response;
  - live Edge CDP -> M365 Copilot exact-response canary passes when a signed-in
    session is available;
  - generic tool-choice smoke covers `rg_files`/`rg_search`, `officecli`, and
    `edit` approval.
- Sidecar release workflow: Windows publishes the user-scope NSIS installer;
  Linux publishes the sidecar archive/launcher. Neither path may package the
  removed Tauri/AionUi/OpenCode/OpenWork runtime.
