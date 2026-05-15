# Relay_Agent Completion Plan

Date: 2026-05-14

## Product Direction

Relay_Agent is a dedicated Windows desktop application for two production
workflows:

1. document search across local and shared folders;
2. Office file inspection/editing through OfficeCLI.

The product no longer treats AionUi as the user-facing shell. AionUi overlay
and AionUi release work are historical implementation references only. The
active application shell is the Tauri v2 + SolidJS Relay desktop UI under
`apps/desktop/`.

## Architecture

- Desktop shell: Tauri v2 + SolidJS.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Search engine: Relay document search with ripgrep-backed enumeration,
  in-memory filename/path/metadata ranking, bounded on-demand content evidence,
  and deterministic folder-budget allocation. SQLite/FTS, semantic indexes,
  background indexes, and persistent filename indexes are not part of the active
  desktop product path.
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the desktop UI.
- Release artifact: Relay Agent Tauri Windows NSIS installer. Release version
  is the Relay Agent package version from `apps/desktop/package.json`.

## Non-Negotiable Completion Criteria

- The first visible product surface is the Relay desktop UI, not Edge,
  OpenCode Web, or AionUi.
- The user must choose one of the two task modes: `資料を探す` or
  `Officeファイルを編集する`.
- Document search must execute through Relay's high-level search runner, not a
  low-level Copilot glob/grep chain.
- Office workflows must execute through OfficeCLI, not Microsoft 365 built-in
  editing or ad hoc shell scripts.
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

## Remaining Hardening Tasks

1. Port the document-search TypeScript sources from the historical
   `integrations/aionui/overlay` path into a Relay-owned source path without
   changing behavior.
2. Add Playwright screenshots for the Relay desktop workbench at desktop and
   narrow widths.
3. Add Windows installed-app validation evidence for startup, search, Office
   inspect/edit, installer size, and uninstall behavior.
4. Remove or archive remaining AionUi overlay scripts/tests once search source
   ownership has moved.

## Verification Gates

- `pnpm --filter @relay-agent/desktop typecheck`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm check`
- `pnpm --filter @relay-agent/desktop prep:tauri-bundle`
- Windows release workflow: `.github/workflows/release-windows-installer.yml`
