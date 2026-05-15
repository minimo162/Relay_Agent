# Relay_Agent Completion Plan

Date: 2026-05-14

## Product Direction

Relay_Agent is a dedicated Windows desktop application for three production
workflows:

1. document search across local and shared folders;
2. Office file inspection/editing through OfficeCLI;
3. bounded code edits inside the selected workspace.

The product no longer treats AionUi as the user-facing shell. AionUi overlay
and AionUi release work are historical implementation references only. The
active application shell is the Tauri v2 + SolidJS Relay desktop UI under
`apps/desktop/`.

## Architecture

- Desktop shell: Tauri v2 + SolidJS.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Next agentic direction: Copilot becomes the manager for intent
  understanding, next-step planning, tool choice, observation review, and final
  synthesis. Relay remains the execution harness for validation, permissions,
  local tool execution, backups, diffs, and trace logging.
- Agent loop: fixed one-shot pipelines will be replaced by a bounded
  `Copilot step -> Relay tool -> observation -> Copilot step` loop. The loop
  must be capped, traceable, and schema-validated. Validation failures stop the
  run and surface a visible UI error; there is no fallback execution.
- Tool broker: Relay exposes a small progressive tool catalog first, then
  injects detailed schemas only for the selected tool. Initial tools are
  `document.search`, `document.inspect`, `office.inspect`,
  `office.plan_edit`, `office.apply_edit`, `code.collect_context`,
  `code.apply_patch`, `ask_user`, and `final`.
- Search engine: Relay document search with ripgrep-backed enumeration,
  in-memory filename/path/metadata ranking, bounded on-demand content evidence,
  and deterministic folder-budget allocation. SQLite/FTS, semantic indexes,
  background indexes, and persistent filename indexes are not part of the active
  desktop product path.
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the desktop UI.
- OfficeCLI readiness checks must validate real `view outline --json`
  capability without falsely failing because Relay's own smoke workbook handle
  is still open. Smoke workbooks must be written to a unique app-local path,
  closed before launching OfficeCLI, retried briefly on transient sharing
  violations, and cleaned up after the check.
- Code editing: M365 Copilot proposes strict JSON exact-string replacements
  against Relay-provided local context. Relay validates workspace-relative
  paths, unique `oldString` matches, and file boundaries before writing. The
  desktop UI does not expose arbitrary shell execution for code tasks.
- UX direction: a minimal professional workbench using the existing
  `--ra-*` token system and `apps/desktop/DESIGN.md`. The UI should maximize
  whitespace, remove explanatory clutter, keep one primary action visible, and
  show only the current mode, workspace, task input, approval/diff surface, and
  concise agent status.
- Release artifact: Relay Agent Tauri Windows NSIS installer. Release version
  is the Relay Agent package version from `apps/desktop/package.json`.

## Non-Negotiable Completion Criteria

- The first visible product surface is the Relay desktop UI, not Edge,
  OpenCode Web, or AionUi.
- The user must choose one of the task modes: `資料を探す`,
  `Officeファイルを編集する`, or `コードを書く`.
- Document search must execute through Relay's high-level search runner, not a
  low-level Copilot glob/grep chain.
- Office workflows must execute through OfficeCLI, not Microsoft 365 built-in
  editing or ad hoc shell scripts.
- OfficeCLI availability must not be marked failed when the failure is caused
  by Relay's own smoke-test file locking. File-sharing violations during smoke
  checks are release blockers until the smoke harness is corrected.
- Code workflows must apply only validated exact-string patches inside the
  selected workspace. Copilot may not execute tools or edit files directly.
- Agentic workflows must keep Copilot's authority limited to structured
  planning and synthesis. Relay is the only component that executes tools.
- Write actions for Office and code require explicit user approval in the UI.
- Runtime errors must be visible in the UI. Silent stalls are release blockers.
- Installer generation must not use the AionUi release workflow.

## Completed In This Direction

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
  `RelayCodePatchPlan.v1` JSON response, and applies only unique exact-string
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

## Remaining Hardening Tasks

1. Promote the current bounded per-workflow pipelines into a single reusable
   multi-step agent runner once the mode-specific contracts have soaked.
2. Add the progressive tool catalog and tool-detail injection path. Keep the
   initial Copilot context small and load detailed schemas only for the chosen
   tool.
3. Move document search, Office edit, and code edit onto the common runner
   without weakening current safety boundaries.
4. Add Playwright screenshots for the Relay desktop workbench at desktop and
   narrow widths, including the new minimal agent UI states.
5. Add Windows installed-app validation evidence for startup, search, Office
   inspect/edit, code edit, OfficeCLI smoke readiness, installer size, and
   uninstall behavior.
6. Remove or archive remaining AionUi overlay scripts/tests once search source
   ownership has moved.

## Verification Gates

- `pnpm --filter @relay-agent/desktop typecheck`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm check`
- `pnpm --filter @relay-agent/desktop prep:tauri-bundle`
- Windows release workflow: `.github/workflows/release-windows-installer.yml`
