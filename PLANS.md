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
  and supervise the Copilot CDP bridge. The preferred implementation is a
  self-contained .NET sidecar using Microsoft Agent Framework.
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
- Candidate agent harness: Microsoft Agent Framework **.NET sidecar**. The
  .NET path has been locally validated against both a mock
  `/v1/chat/completions` endpoint and the live Relay `copilot_server.js` ->
  signed-in Edge/CDP -> M365 Copilot bridge. Prefer .NET over Python if Agent
  Framework is adopted for productization, because it avoids bundling Python
  and fits Windows enterprise deployment better while preserving a Linux path
  through self-contained .NET publishing.
- Agent Framework integration shape: use a Relay-owned Chat
  Completions-compatible Copilot transport. The current `copilot_server.js`
  behavior may be ported, but the final product should not keep a separate
  Node/Tauri-era bridge as an alternate runtime path.
- Corporate-approved LLM posture: because M365 Copilot and Ollama are the only
  approved AI surfaces, Relay should use M365 Copilot as the single primary
  reasoning engine. Do not introduce a two-brain UX or make local Ollama models
  responsible for business reasoning by default.
- Ollama role: treat Ollama as an approved local AI service surface and possible
  utility substrate, not as the primary head of the agent. Ollama may be used
  only where it reduces packaging/compliance risk without creating a second
  user-visible planning path, such as local API compatibility experiments,
  structured-output smoke tests, or an optional adapter for approved future
  harness components. Relay must not depend on OpenAI API keys, OpenAI
  subscriptions, Codex authentication, or unapproved agent binaries.
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
  those artifacts from the shipped installer or replace them with an approved
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
  Copilot step -> Relay tool -> observation -> Copilot step. Any Ollama-related
  component must sit below this line as an implementation utility and must not
  create a second user-facing model choice unless a future compliance decision
  explicitly requires it.
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
- Code editing: M365 Copilot may inspect through `rg_files`, `rg_search`, and
  `read`, then propose validated exact-string replacements through `edit` or
  new-file writes through `write`. Relay validates workspace-relative paths,
  unique `oldString` matches, file boundaries, and user approval before writing.
  Arbitrary unrestricted shell is not part of the default tool catalog.
- UX direction: a minimal professional workbench using the existing `--ra-*`
  token system and `apps/desktop/DESIGN.md`. The UI should maximize whitespace,
  remove explanatory clutter, and show only workspace, task input, concise
  agent status, result cards, approval/diff surfaces, and collapsible details.
- Ollama UX direction: do not expose Ollama as a normal end-user model toggle.
  If an Ollama-backed utility is adopted, surface it only as a concise
  diagnostics/readiness detail, not as a second workflow choice.
- Target release artifact: self-contained Relay sidecar plus static web assets,
  with Windows and Linux launch scripts/installers that open the local
  workbench URL. Do not keep the Tauri NSIS installer as a supported release
  path after the cutover.

## Hard Cutover Rules

- No transitional fallback architecture. The migration is complete only when
  the new browser-hosted workbench and .NET sidecar are the single active
  product path.
- No simplified throwaway MVP. The first implementation slice must be shaped as
  the final architecture: sidecar-hosted UI, local HTTP/WebSocket APIs, Agent
  Framework harness, Copilot bridge, generic tool catalog, approval flow, and
  packaging plan.
- No AionUi, OpenCode/OpenWork, Codex app-server, or Tauri runtime fallback in
  active product code. Historical docs may remain archived, but active source,
  package scripts, workflows, installer resources, runtime launchers, and UI
  code must not depend on those paths.
- No silent fallbacks. If Copilot output, tool arguments, tool availability,
  workspace access, OfficeCLI readiness, or CDP automation fails validation,
  the run stops with a clear user-visible error.
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
Microsoft Agent Framework, AG-UI, ASP.NET Core, and established agent tools.

### Agent UI protocol

- Prefer AG-UI-style event streaming for the workbench/agent boundary instead
  of inventing an ad hoc event protocol. Microsoft Agent Framework documents
  AG-UI integration for web clients, real-time streaming, session management,
  human-in-the-loop approvals, and custom UI rendering. If the .NET package
  path is practical, expose the agent run through AG-UI-compatible HTTP/SSE
  endpoints.
- Keep plain local HTTP APIs for non-agent app operations such as workspace
  selection, app status, logs export, static file serving, and shutdown.
- Use SignalR or raw WebSockets only for gaps AG-UI/SSE does not cover. Do not
  maintain parallel event protocols for the same run lifecycle.

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
- Capture Agent Framework / Relay traces in an OpenTelemetry-compatible shape
  where practical, while keeping the user UI minimal. The visible UI shows only
  concise progress; detailed traces live behind a collapsed details panel and
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
- Produce a release inventory/SBOM-style artifact listing bundled binaries,
  licenses, hashes, and removed legacy components.
- Package ripgrep and OfficeCLI explicitly where licensing and platform support
  allow; otherwise fail readiness visibly with installation guidance. Do not
  silently fall back to slower or weaker implementations.

## 2026-05-16 Web-Researched Requirements Addendum

The following requirements are added after reviewing current Microsoft Agent
Framework, AG-UI, Edge DevTools Protocol, MCP, OWASP LLM security, and SBOM
guidance. These are product requirements, not optional polish.

Reference anchors:

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
- OpenAI prompt-injection safety overview:
  `https://openai.com/safety/prompt-injections/`
- NIST SBOM guidance:
  `https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-security-supply-chains-software-1`

### Agent harness and event protocol requirements

- Adopt Microsoft Agent Framework in the .NET sidecar as the production harness
  for the generic agent loop. The sidecar may keep its
  `/v1/chat/completions` Copilot transport, but the run lifecycle should be
  owned by Agent Framework sessions, tools, middleware, and approvals rather
  than by one-off HTTP handlers.
- Implement the human-in-the-loop contract as a loop, not as a single callback:
  after each agent run, Relay must inspect whether the framework returned a
  user-input / approval request; if so, the UI must pause the run, present the
  approval, and resume the same session only after approve/reject.
- Use AG-UI-compatible Server-Sent Events for the Workbench run stream unless
  a specific .NET support gap blocks it. Required event classes:
  `run_started`, `text_delta`, `tool_call_started`, `tool_call_completed`,
  `approval_requested`, `approval_resolved`, `artifact_created`, `error`,
  `cancelled`, and `completed`.
- Keep the visible UI minimal, but preserve enough typed event metadata for
  replay, support export, and evaluation. Do not create a second proprietary
  event stream for the same run.
- Treat MAF durable execution as an architectural reference, not an Azure
  dependency. Relay should implement local durable-equivalent behavior first:
  append-only run ledger, checkpointed session state, pause/resume,
  cancellation, terminal states, and retention/TTL cleanup in user-local data.

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
- Microsoft Agent Framework adoption, if implemented, should use the .NET
  sidecar path unless a later review finds a stronger reason to use Python.
- The installed application must be able to run without bundled Codex
  app-server, bundled OpenAI clients that require external credentials, or
  hidden third-party agent binaries.
- Ollama is not a release gate unless a specific adopted utility requires it.
  If used, Relay must record the Ollama version/API capability and fail visibly
  when the optional utility is unavailable.
- Write actions for Office and code require explicit user approval in the UI.
- Runtime errors must be visible in the UI. Silent stalls are release blockers.
- Installer generation must not use the AionUi release workflow.

## Historical Work And Deletion Context

The items below describe work already present in the repository. They are not
permission to keep the old architecture. Anything tied to AionUi,
OpenCode/OpenWork, Tauri IPC, Tauri packaging, or old per-mode workflow runners
must be deleted or archived when the hard cutover reaches parity.

- Relay dedicated SolidJS workbench replaces the legacy diagnostic-first shell.
- Startup no longer autostarts the legacy OpenCode/AionUi path by default.
- `run_relay_document_search` Tauri IPC executes the Relay document-search
  engine from the Relay desktop UI and stores caches under app-local data.
- `inspect_office_file` and `execute_officecli_command` Tauri IPC expose
  OfficeCLI inspection/execution with backup support.
- Tauri packaging prepares a document-search runtime bundle and includes
  OfficeCLI as a resource.
- The primary Windows release workflow now builds the Relay Tauri installer.
- The AionUi Windows release workflow has been removed.
- Document search IPC now runs through an async Tauri boundary, exposes visible
  loading/error states in the Relay UI, fixes search mode to detailed search,
  and automatically prunes app-local job snapshots and orphan temp files.
- The desktop UI now asks M365 Copilot only for strict JSON search/Office
  plans, validates those plans in Relay, and then executes local ripgrep-backed
  document search or OfficeCLI operations itself.
- Document search receives the bundled/user-local ripgrep path explicitly and
  fails visibly if ripgrep is unavailable instead of falling back to a silent
  slow scan.
- Search and Office editing no longer depend on the historical OpenCode
  provider-gateway warmup path. The current UI prewarms the dedicated Node
  Copilot bridge and sends planning prompts through that bridge so Relay uses
  the robust Copilot submit/wait/failure-classification harness instead of the
  lightweight diagnostic CDP send path.
- The Office workflow now separates file inspection from edit execution and
  presents the two user actions as `変更内容を確認` and
  `バックアップを作成して適用`.
- Document search now uses Copilot twice through strict JSON contracts: first
  to expand the natural-language query into validated search terms, then after
  local search to summarize and dynamically categorize only the returned
  evidence pack/candidate facts.
- Compound business searches now distinguish direct concept evidence from
  loose hybrid matches. For example, `部品売上` requires direct phrases such
  as `部品売上` / `部品他売上` / `パーツ売上` or equivalent content evidence
  before a candidate is treated as concept-confirmed; company/entity-name
  matches remain recall candidates and are not allowed to overrank confirmed
  business-concept files.
- OfficeCLI resolution now checks packaged resources, sidecar locations,
  user-local caches, dev caches, and PATH separately, and reports whether the
  tool is missing or present but not runnable instead of collapsing both cases
  into a generic not-found error.
- The search UI shows one fixed snapshot per search. It does not stream partial
  result lists or silently update displayed results after Copilot result
  organization completes. Additional exploration is an explicit
  `さらに詳しく調べる` action that replaces the snapshot.
- The desktop search execution path disables durable metadata caches,
  persistent filename indexes, SQLite/FTS, parsed-document caches,
  derived-content caches, background/index coordinators, job-store snapshots,
  sync journals, and user-memory writes. Search work stays in-memory plus
  bounded temp files under Relay app-local data.
- Copilot result organization no longer returns local Windows paths. Relay
  sends stable candidate IDs to Copilot, validates returned IDs, and maps them
  back to paths locally. If Copilot result organization fails, the already
  completed local search snapshot remains visible with a warning instead of
  being treated as a search failure.
- Compound business queries such as `部品売上` now use Relay-owned semantic
  gating: direct aliases rank highest, component matches must include both the
  parts concept and the sales concept, and support/workflow terms can only
  boost already relevant candidates.
- Copilot prompt delivery now tolerates Microsoft 365 composer DOM changes:
  Relay reads prompt text from nested textbox/value/lexical candidates, waits
  longer before submit, and proceeds when the send button is ready even if the
  composer text cannot be read back through CDP.
- Compound document-search evidence now distinguishes concept-confirmed,
  partial-content, generic-content, and filename-only states so business
  concepts such as `部品売上` rank direct parts-sales workbooks above generic
  sales files.
- OfficeCLI packaging now pins the current Windows x64 artifact and validates
  real `view outline --json` capability with a small workbook smoke test, not
  just `--version`, before enabling Office workflows.
- The desktop UI now includes `コードを書く`. Relay collects a bounded set of
  local code files, sends only that context to Copilot, validates a strict
  `RelayCodePatchPlan.v3` JSON response, and applies only unique exact-string
  replacements inside the workspace.
- The frontend planner module now defines and validates `RelayAgentStep.v1`.
  Copilot can describe the next step only through a mode-scoped JSON contract,
  and Relay rejects tools outside the selected UI mode.
- The desktop workbench shows a concise Flow trace for Copilot planning and
  Relay execution steps across search, Office, and code workflows.
- OfficeCLI smoke readiness now writes the test workbook to a unique app-local
  `.xlsx` path, closes the file before invoking OfficeCLI, retries transient
  sharing violations, cleans stale smoke files, and classifies remaining lock
  failures as readiness/smoke failures rather than missing-tool errors.
- The desktop UI has been tightened around a whitespace-forward workbench and
  the Office actions have been simplified to `変更を確認` and `変更を適用`;
  backups remain automatic during mutation execution.
- The document-search TypeScript implementation has been copied into
  `apps/desktop/document-search-src/`, and the desktop bundle builder plus
  test module loader now use that Relay-owned source path.
- Copilot structured-response waiting now treats complete Relay schema JSON as
  a strong completion signal and promotes the Copilot composer Stop -> Send
  button lifecycle to an explicit completion path. This restores the useful
  AionUi-era button-state signal without reintroducing AionUi.
- Document search now has a bounded reflection step before showing the fixed
  snapshot. When the first local result set is dominated by weak
  entity/context candidates, Copilot may return a validated
  `RelayDocumentSearchReflection.v1` refinement and Relay runs one additional
  local search with stricter concept terms.
- Office editing uses `RelayOfficeEditPlan.v3`: Copilot returns only safe
  semantic operations, while Relay injects the selected file path and compiles
  OfficeCLI argv locally. Legacy Copilot-returned paths/argv are rejected.
- Code patch planning uses `RelayCodePatchPlan.v3` and no longer asks Copilot
  to echo the workspace path or raw instruction. Relay supplies the workspace
  locally and validates edits only against collected context files.
- Code context collection no longer includes README/docs merely because they
  are project metadata. README/docs are included only when the instruction or
  explicit target asks for documentation context.
- Document search query planning now uses `RelayDocumentSearchCopilotQueryPlan.v3`.
  Copilot may define core concepts, required term groups, and entity-risk terms,
  but Relay validates the JSON and owns all search execution, scoring, and
  entity-context demotion. This keeps compound concepts such as `部品売上`
  anchored to both dimensions instead of overranking company-name or folder-name
  matches such as `Mパーツ`.
- Document-search reflection and result organization consume the v3 concept
  hints and candidate IDs only. Copilot can refine or group the local evidence
  pack, but it cannot introduce paths, files, or unsupported classifications.
- Office editing now accepts `RelayOfficeEditPlan.v3`, including explicit
  ambiguity notes. The UI presents semantic operations instead of raw OfficeCLI
  argv, and Relay still compiles and executes the concrete OfficeCLI command
  locally only after user approval.
- Code editing now accepts `RelayCodePatchPlan.v3`, including done criteria
  for the user-visible review. Relay still applies only validated exact-string
  patches inside the workspace.
- Search, Office, and Code workflows now share a simple agent phase model
  (`understanding`, `planning`, `executing`, `observing`, `reflecting`,
  `finalizing`, `failed`) so the UI can show one concise workflow state without
  exposing internal harness noise.
- Microsoft Agent Framework feasibility was checked:
  - Python SDK confirmed the framework can perform function-tool loops and
    approval requests against Relay's Chat Completions bridge.
  - .NET SDK 8.0 was locally installed under `/tmp/relay-dotnet/sdk` for
    verification.
  - `Microsoft.Agents.AI.OpenAI` 1.6.1 wrapped `OpenAI.Chat.ChatClient` with
    `AsAIAgent` and succeeded against both a local mock and the live
    `copilot_server.js` -> Edge CDP -> M365 Copilot path.
  - Productization preference is .NET sidecar over Python sidecar.
- The active .NET sidecar now includes an initial Copilot CDP transport and
  sidecar-owned `/v1/models` / `/v1/chat/completions` endpoints. Smoke tests
  cover this path with an explicit mock transport; live signed-in Copilot CDP
  validation remains a release-readiness gate.

## Cutover Implementation Tasks

1. Freeze and inventory old paths before coding:
   - Inventory all active references to AionUi, OpenCode, OpenWork, Codex
     app-server, Tauri, Tauri IPC, Tauri resources, and release workflows.
   - Classify each reference as `active product`, `test`, `archived historical
     doc`, or `third-party factual reference`.
   - Update `AGENTS.md` and any source-of-truth docs that still instruct Relay
     to keep OpenCode/OpenWork or Tauri as active substrate.
2. Build the final Relay sidecar foundation, not a temporary prototype:
   - Create a self-contained .NET sidecar as the primary process.
   - Host the static Relay Workbench web UI from the sidecar.
   - Expose local HTTP/WebSocket APIs for sessions, tools, approvals, status,
     logs, workspace selection, and shutdown.
   - Port or replace the Copilot Edge/CDP bridge inside the sidecar boundary so
     there is one Copilot transport path.
   - Integrate Microsoft Agent Framework as the agent harness.
3. Build the final browser-hosted Workbench UI:
   - One natural-language composer, no visible task-mode buttons.
   - Workspace selector.
   - Concise agent status and trace.
   - Result cards for files, Office operations, and code changes.
   - Approval cards for every write/mutation.
   - Collapsed diagnostics/details only.
   - No AionUi, OpenCode, Tauri, provider, model, runtime, feedback, or debug
     chrome.
4. Implement the generic progressive tool catalog:
   - `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
     `ask_user`, and `final`.
   - Validate every argument before execution.
   - Implement path containment, size/time limits, cancellation, and structured
     observations.
   - Stop on validation failure; do not route to old search, Office, or code
     runners as fallback.
5. Implement the Agent Framework runner, approval loop, and governance layer:
   - Replace the current one-shot `/api/runs` placeholder flow with a bounded
     Agent Framework session loop that uses the sidecar Copilot transport.
   - Add Agent Framework tool wrappers for the generic Relay tools.
   - Add middleware/policy checks for allowed tools, workspace scope, mutation
     approval, rate limits, and audit logging.
   - Implement framework approval-request handling as a pause/resume flow in
     the same run session.
   - Stream run events to the Workbench through the AG-UI-compatible event
     envelope.
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
   - Package the .NET sidecar and static web assets for Windows and Linux.
   - Provide launchers that start the sidecar, open the localhost workbench,
     and shut down cleanly.
   - Keep all app data, cache, logs, and temp files in user-local Relay
     directories.
   - Generate SBOM/SBOM-style release inventory with hashes, versions,
     licenses/source notes, and intentionally excluded legacy runtimes.
11. Delete active obsolete code:
   - Remove AionUi overlay code, OpenCode/OpenWork provider gateway code,
     Tauri shell/IPC/resources/workflows, and old high-level workflow runners
     once the new path is wired.
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
   - Inventory every installer resource, executable, npm package, generated
     file, config directory, environment variable, and runtime process name that
     contains `codex`, `Codex`, OpenAI, OpenCode, or OpenWork terminology.
   - Classify each match as `Relay-owned branding`, `upstream dependency`,
     `developer-only artifact`, `archived historical doc`, or `runtime-required
     integration name`.
   - Remove developer-only and archived prompt artifacts from release bundles
     unless they are explicitly needed at runtime.
   - Do not bundle upstream `codex` CLI/app-server, OpenCode, or OpenWork in
     the release.
   - Implement Relay/Copilot integration through the approved Relay sidecar and
     Microsoft Agent Framework path instead of hidden third-party agent
     artifacts.
   - Add a release verification artifact that lists remaining matches and their
     classification, plus the reason each one is acceptable for installation.
15. Evaluate Ollama as an optional approved local utility, without making it a
   second agent brain:
   - Confirm which Ollama capabilities are approved for use in the corporate
     environment: local REST API, OpenAI-compatible endpoints, structured
     outputs, tool calling, model management, and any bundled/adjacent harness
     components.
   - Treat Ollama itself as a local model server/API surface. Do not assume it
     provides a full agent harness; Relay remains the harness unless a specific
     approved Ollama-adjacent component is identified and reviewed.
   - Prototype only non-user-visible utility uses first: capability detection,
     schema/JSON smoke testing, local mock-provider compatibility, or internal
     adapter tests.
   - Do not route production business reasoning, file search planning, Office
     edit planning, or code patch planning to Ollama by default. Those remain
     M365 Copilot responsibilities.
   - If an Ollama utility is adopted, keep the UI simple: one Copilot-led agent
     path, with Ollama status shown only in diagnostics.
   - Add a compliance note explaining why the adopted Ollama component is
     permitted and what it does not do.

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
  - release inventory;
  - SBOM/SBOM-style dependency and binary inventory;
  - legacy runtime exclusion inventory.
- .NET Agent Framework sidecar smoke, if adopted:
  - local mock `/v1/chat/completions` returns expected agent response;
  - live `copilot_server.js` -> Edge CDP -> M365 Copilot returns expected
    response;
  - generic tool-choice smoke covers `rg_files`/`rg_search`, `officecli`, and
    `edit` approval.
- Optional Ollama utility smoke, only if adopted: local or mock Ollama service
  responds and the specific utility contract passes without becoming the
  user-facing reasoning path.
- Windows release workflow: `.github/workflows/release-windows-installer.yml`
