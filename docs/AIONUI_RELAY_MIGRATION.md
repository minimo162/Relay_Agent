# AionUi-First Relay Agent Migration

Date: 2026-05-08

This document fixes the implementation direction for rebuilding Relay Agent on
top of AionUi while keeping Relay's M365 Copilot provider gateway and Tool Call
Emulation Layer.

## Decision

Relay Agent should move from the OpenCode Web first-run UX to an
AionUi-first, Relay-branded desktop shell.

This is not a compatibility migration. No public release has shipped, so the
new product path may break the current OpenCode-only bootstrap assumptions.

## Role Split

```text
Relay-branded AionUi shell
  owns the primary UX, conversations, workspace files, skills, approvals,
  OfficeCLI assistants, previews, and normal agent interaction

Relay provider gateway
  starts before the AionUi shell, exposes an OpenAI-compatible local endpoint,
  and presents M365 Copilot as the relay-agent/m365-copilot model

Relay Tool Call Emulation Layer
  treats M365 Copilot as a strict JSON planner or final-answer writer,
  normalizes supported structured output into OpenAI tool calls, and never
  lets M365 Copilot claim local execution

OfficeCLI portable bootstrap
  downloads and verifies a pinned OfficeCLI binary into Relay-managed
  user-local storage with no admin approval

Bundled ripgrep bootstrap
  ships a pinned Windows `rg.exe`, copies it into AionUi's user-local global
  bin cache, and forces AionUi search tools onto ripgrep instead of slow grep
  fallback

Shared-folder search policy
  patches AionCLI file discovery so broad glob searches prefer `rg --files`,
  cap internal and returned candidates, limit per-folder and per-branch
  dominance, and nudge broad content searches toward names-only discovery
  before detailed reads

Workspace Document Search
  is an AionUi skill-led workflow that may use Relay bridge contracts for
  deterministic status, result, and evidence validation. Relay must not become
  a second document-search application. AionUi owns the visible workspace,
  skill invocation UX, preview, history, approvals, file actions, and normal
  search interaction; Relay owns Copilot connection, tool-call normalization,
  status translation, diagnostics, and evidence/redaction boundaries

OpenCode
  is optional future backend capacity, not the first-run UX
```

## Upstream Baseline

The first Relay fork/wrapper target is:

- AionUi `v1.9.25`
  - repository: `https://github.com/iOfficeAI/AionUi`
  - commit: `bbada2a9268060d2b41ddf1d885a9b27ecd2103d`
  - license: Apache-2.0
- OfficeCLI `v1.0.76`
  - repository: `https://github.com/iOfficeAI/OfficeCLI`
  - commit: `958717ea25351b8920a3d8313d46e08b24b9c95b`
  - license: Apache-2.0
  - Windows x64 asset: `officecli-win-x64.exe`

AionUi already supports OpenAI-compatible custom providers. The Relay fork
must seed a provider equivalent to:

```json
{
  "id": "relay-agent",
  "platform": "custom",
  "name": "Relay Agent / M365 Copilot",
  "baseUrl": "http://127.0.0.1:<relay-port>/v1",
  "apiKey": "<local relay token>",
  "model": ["m365-copilot"],
  "useModel": "m365-copilot"
}
```

The user-facing model reference remains `relay-agent/m365-copilot`.

The Relay fork/wrapper must apply these fixed branding values from
`apps/desktop/src-tauri/bootstrap/aionui-relay.json`:

- product name: `Relay Agent`
- executable name: `Relay Agent`
- window title: `Relay Agent`
- protocol: `relay-agent`
- installer artifact prefix: `Relay.Agent`
- icon source: `apps/desktop/src-tauri/icons/source/relay-agent.svg`
- browser/support title: `Relay Agent`

## Product Guardrails

- The installed app name, title, icon, installer, protocol, and browser/web
  labels are `Relay Agent`, not AionUi.
- The current SolidJS/Tauri desktop shell is a legacy OpenCode diagnostic
  console. It must stay diagnostics-only and must not expose Workspace Document
  Search as a normal product surface.
- The first-run path must not ask the user to add a provider, paste an API key,
  choose a backend, install OfficeCLI manually, or open a terminal.
- The beginner first screen is AionUi's `/guid` task launcher, Relay-branded and
  curated for document finding and Office-file editing. Do not
  start beginners from a separate Relay search page or the full upstream
  assistant/gallery surface.
- Because AionUi `/guid` renders real preset assistant entries, `資料を探す`
  must be seeded as one Relay-managed preset assistant, not only as a label in
  Relay metadata. Search, content checking, and evidence-backed summary are
  internal stages behind that one entry.
- `/guid` must keep folder selection, prompt examples, file attachment, and
  quick send visible. File search starts with "choose task -> choose folder ->
  type or pick example -> send with AionUi's normal task/message flow." Relay
  must not add a standalone `検索開始` button.
- `/guid` does not have the normal conversation slash-command menu. Beginner
  search starts from curated assistant/task entries, examples, `GuidInputCard`,
  and `GuidActionRow` folder selection; slash commands and `@` file mentions are
  secondary once the conversation view is active.
- `GuidInputCard` is the primary beginner CTA for search and task start. It
  should show task-aware examples, recent workspace suggestions, and popular
  search patterns before exposing advanced assistant management. The visible
  action is the normal AionUi send action, not a new Relay-specific search
  control.
- Relay must not force a tutorial before the user can start a task. Empty
  states, example prompts, no-results suggestions, and support details are the
  preferred onboarding tools.
- Relay starts the local provider gateway before the AionUi shell becomes
  interactive.
- The AionUi model provider list starts with the Relay provider selected.
- First startup imports the Relay seed bundle into AionUi config storage,
  replacing any stale `relay-agent` provider while preserving unrelated user
  settings.
- The seed bundle carries the two-mode beginner policy:
  `relay-workspace-search` (`資料を探す`) and `relay-office-edit`
  (`Officeファイルを編集する`) are the only default visible assistants. The
  legacy `word-creator`, `excel-creator`, and `ppt-creator` presets are hidden
  from beginner mode.
- The Office edit assistant enables `officecli-docx`, `officecli-xlsx`, and
  `officecli-pptx` by default and carries `RELAY_TASK_MODE: office_edit`, so
  Copilot tool planning is constrained to OfficeCLI-backed inspection/editing
  and missing-field clarification.
- The seed bundle carries the document-finding policy: `relay-workspace-search`
  is the single beginner-facing `資料を探す` preset, with
  `relay-document-search`, `workspace-search`, `find-files`,
  `read-office-file`, and `summarize-with-evidence` enabled. If the runtime
  advertises a high-level `relay_document_search`/`relay-document-search` tool,
  Copilot must call that first instead of choosing raw `glob`, `grep`, or
  `read`.
- AionUi's broad upstream assistant catalog is curated before it reaches the
  beginner UI. Relay shows only document-finding and Office-file-editing task
  language by default; niche presets such as Cowork,
  OpenClaw setup, story roleplay, Mermaid, Moltbook, academic paper, dashboard,
  and financial-model helpers are hidden or advanced-only.
- Beginner views hide AionUi surfaces that look like setup or platform
  management: provider/model settings, Gemini setup, agent management, tool
  settings, system/dev settings, WebUI/channel setup, extension settings, Skills
  Market, model switchers, ACP config selectors, permission-mode controls,
  detected-agent selectors, preset assistant edit controls, preset backend
  switchers, and assistant-management entrypoints. These surfaces are
  support-only and require `relay.advancedSurfaces.enabled`.
- The `GuidActionRow` plus menu must not expose the auto-injected skills
  submenu in beginner mode. AionUi still owns skill execution, but beginners
  should choose task presets, files, folders, and normal send actions rather
  than toggling implementation skills.
- OfficeCLI is Relay-managed. Do not use AionUi's upstream `irm ... | iex` or
  `curl ... | bash` auto-install path in the Relay product path.
- OfficeCLI is cached under Relay-managed user-local storage by version,
  verified by size and SHA256, and then prepended to the AionUi child-process
  `PATH`.
- Ripgrep is bundled in the installer and registered into AionUi's user-local
  global bin cache during startup; first-run search must not depend on the user
  installing `rg` or waiting for AionUi's downloader.
- Broad shared-folder search must use representative capped results. The
  default policy is 5,000 internal file candidates, 300 returned files, 25 files
  per folder, 75 files per branch group at depth 3, 500 names-only grep
  matches, and one names-only match per file.
- Workspace Document Search, when enabled, appears as AionUi skills wired
  through Relay bridge contracts, such as `検索`, `ファイル検索`, and
  `根拠つき回答`, with lightweight result renderers in AionUi's existing
  conversation/preview surfaces. It must not open the legacy Relay diagnostic
  shell or show AionUi as a separate product.
- The first-run document-finding entry is `builtin` Office presets plus the
  Relay-managed non-builtin preset assistant (`relay-workspace-search`). This
  matches AionUi's actual
  `AssistantSelectionArea` model and avoids a metadata-only task that never
  appears on screen.
- Relay's role in Workspace Document Search is bridge-first: provider
  connectivity, tool-call normalization, skill/result schemas, status
  translation, diagnostics, evidence validation, and redaction. Search UX,
  normal file actions, conversation state, and skill execution surfaces belong
  to AionUi.
- A release that claims Workspace Document Search support must ship AionUi
  overlay snapshots for skill invocation, folder-add, candidates-visible,
  checking-file-contents, confirmed-results, result-list rendering,
  preview/open, no-results, and advanced-drawer states.
- The first visible search workflow is `フォルダを追加` -> scan progress and
  early candidates -> file-content/evidence confirmation -> confirmed results
  -> preview/open -> optional grounded answer. Early filename hits are progress,
  not final findings.
- File discovery and document parsing are not duplicate scanners:
  FileRecord/FileMetadata owns root/path/access/freshness and filename cache
  state, while Dedoc-style DocumentMetadata lives inside ParsedDocument and is
  produced only for FileRecords selected by the scheduler.
- AionUi conversation/history entries may store references to search result and
  evidence ids produced through Relay contracts, but the product source of truth
  for user-visible search interaction remains AionUi's workspace/skill flow.
- Search UX must expose state transitions in beginner language:
  `フォルダ未選択`, `準備中`, `候補を表示中`,
  `ファイルの中身まで確認中`, `確認済みの結果`, `結果なし`,
  `一部のみ検索`, `権限なし`, and `失敗`.
- `結果なし` and `一部のみ検索` are recoverable states. The UI should suggest
  broader keywords, related terms, folder changes, extension filters, or waiting
  for content indexing, and the advanced drawer should explain skipped/failed
  paths.
- Search results are actionable cards, not raw tool logs. Each card should show
  title, path, modified time, match reason, match mode, index state, and warning
  state, with actions for preview, open file, copy path, use as evidence, and
  refine search.
- Relay result flow is structured-card-first. AionUi consumes
  `RelayDocumentSearchAionUiResultFlow.v1`, which carries the raw
  `RelayDocumentSearchResult.v1`, renderer-neutral
  `RelayDocumentSearchDisplay.v1`, and `RelayDocumentSearchResultFlow.v1`
  batch/selection metadata. Copilot prose is secondary and must not be the only
  place where continuation, selection, preview/open, partial, or index state is
  represented.
- The default broad search mode is thorough. Answer text must use candidate
  language until Relay validates current Evidence Pack items. Filename-only or
  partial-index results must not be described as confirmed evidence.
- Query construction is Relay-owned. Copilot may suggest synonyms, abbreviations,
  file-type hints, or clarification questions, but Relay validates all
  suggestions before they affect the QueryPlan, searched roots, budgets,
  confirmation policy, or coverage reporting.
- Internal terms such as `ParsedDocument`, `Evidence Pack`, `Query Trace`,
  parser lineage, and reader capabilities are hidden by default and exposed only
  in advanced/support views.
- The Relay seed and AionUi overlay both force the Workspace Document Search
  UX guard keys, including hidden beginner terms, so a migrated AionUi profile
  cannot keep stale upstream defaults that expose implementation language.
- The collision boundary is explicit: AionUi owns visible routes, panels,
  conversation history, approvals, preview/open controls, context menus, skill
  selection, skill invocation UX, and normal file/search interaction; Relay owns
  the Copilot provider bridge, tool-call normalization, AionUi seed/defaults,
  skill/result contracts, status translation, evidence validation, diagnostics,
  and local privacy/redaction boundaries.
- AionUi must render contracted result/status state instead of re-deriving
  evidence state from filenames, snippets, or Copilot answer text.
- Relay must not introduce a competing navigation shell, preview control,
  approval prompt, Office edit flow, or conversation store for Workspace
  Document Search.
- Relay should avoid large custom AionUi UX rewrites. Prefer AionUi skills,
  assistant presets, command entries, and small result renderer hooks before
  adding any new page-level surface.
- The AionUi v1.9.25 core UX must be treated as the product frame: conversation
  tabs create task-specific sessions, the SendBox owns `@` file mentions and
  `/` command selection, the right Workspace panel owns folder/file tree search
  and file operations, the Preview panel owns file/document viewing, and the
  loaded-skills indicator shows active skill state. Relay bridge contracts must
  plug into those surfaces instead of adding a standalone search page.
- The right Workspace panel's existing search input is a tree/filename quick
  filter, not the full document-search product. Broad search results should
  appear through skills and structured result cards, with workspace status
  augmenting the panel.
- The loaded-skills indicator must not route beginners into hidden capability
  settings unless `relay.advancedSurfaces.enabled` is enabled.
- The `/guid` beginner view must not expose AionUi's detected-agent selector,
  selected-assistant edit button, preset backend switcher, or assistant
  management drawer unless `relay.advancedSurfaces.enabled` is enabled.
- Remote access, channel bots, and unrelated provider marketplace features are
  hidden or advanced-only in the Relay fork.
- OpenWork is not part of this path. It was removed because its installer
  needs admin approval in the target environment.
- OpenCode Web is demoted to an optional future backend. It is not the product
  first screen.

## Installed-App Acceptance Boundary

`docs/AIONUI_WINDOWS_VALIDATION.md` is the installed-app acceptance checklist
for the Relay-branded AionUi release path. It defines the evidence matrix for
release workflow artifacts, B12 clean-Windows bootstrap handoff, installed
first launch, provider seed, OfficeCLI/ripgrep/Node/LiteParse availability,
beginner AionUi surfaces, Office workflows, Workspace Document Search UX,
support export/privacy, and the final readiness decision.

Implementation-only gates can prepare artifacts, but they do not replace the
clean-Windows acceptance rows. A release readiness decision must link the
validation evidence bundle and must leave any Windows-only gap explicit instead
of treating Linux readiness or M365 live-provider retries as a substitute for
installed-app evidence.

## Implementation Phases

1. Add a source-controlled AionUi/OfficeCLI manifest and provider seed helpers.
2. Apply the Relay AionUi overlay to a fork or checkout. The overlay copies
   `relaySeed.ts` into AionUi and patches `initStorage.ts` so the Relay seed is
   imported during startup.
3. Fork or vendor AionUi under a separated source directory and apply Relay
   branding.
4. Add a Relay bootstrap step that starts the provider gateway, writes the
   AionUi provider seed, and launches the Relay-branded AionUi shell.
5. Replace AionUi's OfficeCLI auto-install bridge with the Relay-managed
   portable OfficeCLI cache.
6. Bundle ripgrep into the AionUi installer and seed AionUi search defaults to
   use it.
7. Enable only the curated beginner assistant catalog by default: Word, Excel,
   PowerPoint, and one Workspace Document Search entrypoint that can also read
   and summarize documents with evidence.
8. Define and advertise the Relay-owned high-level document-search tool
   contract: `relay_document_search` plus approved aliases, backed by
   `RelayDocumentSearchRequest.v1`, `RelayDocumentSearchResult.v1`, schema
   validators, and a small OpenAI-compatible model-facing tool schema.
9. Implement the first `relay_document_search` executor as a wrapper over
   AionUi/OpenCode primitives and Relay local capabilities: root validation,
   metadata scan, bundled ripgrep/filename search, Office/PDF read where
   available, evidence packaging, progress, coverage, result cards, and
   failure states. The executor owns `RelayDocumentSearchJob.v1` lifecycle
   state: progress, cancel, retry, duplicate-submit attachment, timeout to
   partial, and cache deletion when a workspace root is removed.
10. Enforce tool-call routing so document-search and grounded-summary intents
    use the high-level tool before raw `glob`, `grep`, `read`, `bash`, or
    parser tools when the high-level tool is advertised. Aliases such as
    `workspace-search` and `find-files` count as high-level only when their
    advertised schema or result contract matches the Relay document-search
    contract.
11. Hide or demote unrelated AionUi builtin assistant presets, settings tabs,
    Skills Market, provider/model switchers, detected-agent selectors, preset
    assistant edit controls, preset backend switchers, agent permission-mode
    controls, and extension surfaces unless explicitly enabled from
    advanced/support settings.
12. Wire the `/guid` beginner task launcher to the curated assistant/search
   entrypoints first, then continue Workspace Document Search inside AionUi's
   existing ConversationTabs, SendBox slash menu, SendBox `@` file mention
   menu, Workspace quick filter/status area, PreviewPanel, and
   ConversationSkillsIndicator before considering any dedicated result surface.
13. Hide remote/channel/provider onboarding surfaces unless explicitly enabled
   for diagnostics.
14. Remove or demote the OpenCode Web launcher and OpenWork/OpenCode naming from
   the installed first-run UI.
15. Add Windows validation for first install, M365 sign-in, provider readiness,
   OfficeCLI download, Office document creation/editing, shared-folder
   document search through `relay_document_search`, Copilot low-level tool
   misrouting, and Defender behavior.

## Release Workflow Boundary

- `.github/workflows/release-aionui-windows-installer.yml` owns the primary
  `release-windows-installer` workflow. It builds the Relay-branded AionUi
  installer from the pinned AionUi baseline after applying the Relay overlay.
- `.github/workflows/release-windows-installer.yml` is retained only as a
  manual legacy Tauri/OpenCode diagnostic release path. It has no tag push
  trigger and requires explicit `confirm_legacy_tauri_release=true`.

## Compatibility Position

The current OpenCode-only implementation remains useful as a reference for the
provider gateway and tool-call emulation. It should not constrain the AionUi
product surface.

Code that belongs in Relay:

- M365 Copilot CDP transport
- OpenAI-compatible provider gateway
- tool-call JSON extraction and normalization
- local provider token management
- gateway diagnostics
- Workspace Document Search bridge contracts: skill/result schemas, status
  translation, evidence validation, redaction policy, support diagnostics, and
  any minimal local adapters needed to connect AionUi skills to Copilot safely
- OfficeCLI portable artifact bootstrap
- AionUi provider/default-model seeding

Code that should live in AionUi or upstream extension points:

- conversation UX
- workspace navigation
- session history
- approvals
- skill selection
- Office document preview/edit workflows
- Workspace Document Search skill execution and presentation: task entries,
  examples, structured result renderer, preview/evidence details, answer
  content, index/search adapters where feasible, and advanced drawer wired to
  Relay bridge/status/evidence contracts
- optional ACP/OpenCode backends

## Verification Gates

Linux/CI-safe gates:

- AionUi/OfficeCLI manifest parses and pins exact upstream references.
- Relay provider seed has a valid AionUi provider shape.
- Provider seed preserves unrelated existing providers while replacing the
  Relay provider deterministically.
- Relay writes a seed bundle before shell startup that records the provider
  base URL, selected model, Aionrs base URL, and the provider-before-shell
  lifecycle requirement.
- `node scripts/apply-aionui-overlay.mjs --aionui-dir <checkout>` copies
  Relay's `relaySeed.ts` into AionUi and patches AionUi startup to apply the
  provider seed before MCP/model initialization and the assistant seed after
  built-in assistants are created.
- OfficeCLI bootstrap derives a user-local cache path from the pinned manifest,
  verifies size/SHA256, and produces a PATH value without requiring admin
  approval.
- The provider base URL keeps the `/v1` suffix for AionUi's OpenAI SDK path.
- Aionrs handoff can strip `/v1` when it appends `/v1/chat/completions`.
- Workspace Document Search contracts compile and expose result, status, and
  evidence ids through AionUi skill flows without requiring Copilot sign-in.
- The AionUi/OpenAI-compatible tool catalog advertises `relay_document_search`
  with the expected model-facing schema, and alias handling rejects
  `workspace-search` / `find-files` unless the schema or result contract
  matches `RelayDocumentSearchResult.v1`.
- Copilot prompt templates for tool-call, repair, query suggestion, answer
  polish, and polish repair are versioned, fixture-tested, and recorded in
  Query Trace.
- The document-search executor lifecycle exposes `job_id`, progress, cancel,
  retry, duplicate-submit attachment, timeout-to-partial, and deterministic
  result ids through the Relay/AionUi bridge.
- Correlation ids connect the AionUi conversation/message, Relay job/query,
  Copilot session/request/turn, Evidence Pack, local draft, and accepted polish
  in diagnostics and support export.
- Copilot warming, sign-in required, disconnected, capture-unhealthy, timeout,
  rate-limited, tenant-restricted, and policy-disabled states downgrade to
  local result/local draft rendering without blocking cancel, retry,
  preview/open, or support export.
- Citation-bound polish validation rejects unsupported, duplicated, truncated,
  or unstructured Copilot output after at most one strict repair; rejected
  polish is not displayed as the search result.
- The document-search store uses a single-writer lock with stale-lock recovery,
  second-window attachment to active jobs, and abandoned-job downgrade after a
  crash.
- The executor invokes ripgrep, OfficeCLI, PDF readers, and parser adapters
  without shell strings, using pinned tool paths, argument arrays, timeouts,
  output caps, cancellation, and redacted diagnostics.
- Parser adapters, Dedoc adapters, and converters consume scheduler-owned
  FileRecord queues and source FileMetadata versions; they do not walk roots,
  expand globs, mutate access snapshots, or maintain separate file-discovery
  state.
- Search cache policy covers quota, eviction order, Windows at-rest protection
  or explicit content-cache downgrade, root removal cleanup, uninstall cleanup
  discoverability, and support-export redaction.
- Schema upgrade/rollback/downgrade behavior is tested before release so a
  failed migration cannot silently mix stale content indexes with fresh
  metadata.
- Every Phase -1 warning code has beginner Japanese copy, support copy,
  severity, retryability, result-state effect, and answer-downgrade behavior.
- Workspace Document Search remains feature-flagged until schema/catalog,
  executor lifecycle, local-only mode, enterprise policy, cache/privacy,
  warning-copy, golden-query quality, redacted support export, and Windows smoke
  gates pass.
- Managed policy can disable content indexing, Copilot polish, support export,
  network roots, or unprotected content caches without exposing raw fallback
  tools.
- Diagnostics are local and redacted by default; support export is
  user-initiated and previewable before saving.
- Legacy SolidJS shell snapshots show diagnostics-only copy and no normal
  Workspace Document Search entrypoint.
- AionUi overlay snapshots show search skill invocation through the Relay
  bridge and the lightweight result renderer, and do not expose AionUi,
  ParsedDocument, Evidence Pack, or Query Trace terminology in beginner views.
- AionUi overlay snapshots show the `/guid` beginner task launcher with curated
  task choices, visible folder selection, prompt examples, file attachment, no
  forced tutorial, and transition into the normal conversation view.
- Search UX snapshots cover `フォルダ未選択`, `候補を表示中`,
  `ファイルの中身まで確認中`, `確認済みの結果`, no-results guidance,
  permission-denied, and support-details states.
- Search result snapshots cover result cards with preview/open/copy/refine
  actions, capped first batches, `さらに表示` continuation, stable selection
  across background index refresh and continuation batches, match reason, index
  state, warning state, and candidate-versus-evidence-backed answer wording.
- Live workspace-search smoke no longer treats model-visible `glob_search` or
  `grep_search` first calls as success for broad document lookup; success means
  `relay_document_search` is the first model-visible call and low-level search
  appears only inside executor diagnostics.
- Collision tests prove Relay has not become a competing search app: there is
  no duplicate search shell, preview/open action, approval prompt, Office edit
  path, skill invocation flow, or conversation store between AionUi and Relay.

Windows gates:

- Installer launches without console flicker.
- First launch starts the provider gateway and opens the Relay-branded AionUi
  shell.
- M365 Copilot sign-in state is visible and recoverable.
- OfficeCLI downloads into a user-local Relay directory, verifies SHA256, and
  runs `officecli --version`.
- `Officeファイルを編集する` can inspect/edit Word, Excel, and PowerPoint files in
  the selected workspace through OfficeCLI.
- Workspace Document Search can add a folder, show candidates-visible progress,
  continue into file-content/evidence confirmation, return confirmed results or
  clearly marked candidates, open/preview a result, and keep result anchors
  after restarting the Relay-branded AionUi shell.
- A 100k-file warmed metadata cache shows first progress within 1 second, first
  filename candidates within 10 seconds, cancel acknowledgement within 2
  seconds, and timeout as a visible partial-result state rather than a silent
  hang.
- Japanese paths, mapped drives, UNC shares, access-denied files, locked files,
  and unsupported Office formats produce structured warnings rather than
  Copilot prose-only answers.
- Windows extended-length paths, DFS shares, OneDrive/SharePoint placeholders,
  offline cloud files, and hydrated cloud files produce explicit metadata,
  content-evidence, or warning states.
- First-run `/guid` can start a file-search task without opening settings,
  provider setup, advanced assistant management, or a separate Relay search
  shell.
- Local-only mode can search, render result cards, preview/open files, and show
  a validated local draft with Copilot signed out or policy-disabled.
- Copilot abnormal-state smoke covers sign-in required, disconnected,
  capture-unhealthy, timeout, rate-limit, and tenant-restricted cases; all keep
  the local search result usable and visible.
- Defender/SmartScreen result is recorded for the signed installer.
