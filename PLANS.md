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
- Search engine: Relay document search with metadata cache, filename index,
  SQLite/FTS, parsed-document cache, result grouping, evidence packs, and
  deterministic folder-budget allocation.
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

## Remaining Hardening Tasks

1. Port the document-search TypeScript sources from the historical
   `integrations/aionui/overlay` path into a Relay-owned source path without
   changing behavior.
2. Add Copilot query-plan generation as an optional strict JSON step before
   search, with Relay validation and no silent fallback.
3. Add Copilot Office edit-plan generation as an optional strict JSON step
   before OfficeCLI execution, with Relay validation and user confirmation.
4. Add Playwright screenshots for the Relay desktop workbench at desktop and
   narrow widths.
5. Add Windows installed-app validation evidence for startup, search, Office
   inspect/edit, installer size, and uninstall behavior.
6. Remove or archive remaining AionUi overlay scripts/tests once search source
   ownership has moved.

## Verification Gates

- `pnpm --filter @relay-agent/desktop typecheck`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm check`
- `pnpm --filter @relay-agent/desktop prep:tauri-bundle`
- Windows release workflow: `.github/workflows/release-windows-installer.yml`
