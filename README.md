# Relay Agent

Relay Agent is a Windows desktop application for three focused workflows:

- find documents in local or shared folders;
- inspect and edit Office files through OfficeCLI;
- make bounded code edits inside a selected workspace.

The app uses Microsoft 365 Copilot as the planning and language layer when
needed, but local file discovery, OfficeCLI execution, code patch validation,
cache placement, and safety checks are owned by Relay Agent.

## Current Product

Relay Agent now ships as a dedicated Tauri + SolidJS desktop app. AionUi is no
longer the user-facing shell or release target.

The first visible screen is the Relay workbench with three task modes:

- `資料を探す` — run Relay document search against a selected workspace folder.
- `Officeファイルを編集する` — inspect or execute OfficeCLI operations against a
  selected Office file.
- `コードを書く` — collect bounded local code context, ask Copilot for a strict
  patch plan, and apply only validated exact-string replacements.

The app does not open Edge or legacy OpenCode/AionUi surfaces during first
paint. Copilot is connected directly through Edge CDP, on demand, when a search
Office edit, or code edit needs a planning step.

## Document Search

Document search is handled by Relay's high-level document-search runner. The UI
does not ask Copilot to compose low-level `glob` or `grep` patterns.

Search features:

- strict Copilot query-plan JSON for natural-language expansion, validated by
  Relay with no silent fallback;
- ripgrep-backed local file enumeration before Relay ranking and evidence work;
- two-layer search: filename/path/metadata candidates first, then bounded
  content evidence for the candidates that need confirmation;
- no SQLite/FTS, semantic index, background index, or searched-folder index
  artifacts in the desktop product path;
- deterministic large-folder scan budgeting across fiscal-year or period
  folders;
- one stable result snapshot per search. Results are not silently updated after
  they are shown;
- strict Copilot result-summary JSON after the local search completes, used only
  to summarize and dynamically group the already-returned candidates;
- candidate/evidence labels so the UI does not overstate unverified files.

Relay Agent does not write `.aionrs`, SQLite databases, or index files into the
searched shared folder.

## Office File Editing

Office operations are executed through OfficeCLI. Relay Agent resolves the
bundled OfficeCLI executable first and falls back to PATH only when needed.

The desktop UI supports:

- Office file selection;
- structure inspection through `officecli view <file> outline --json`;
- strict Copilot Office-edit JSON plans for natural-language instructions;
- reviewed OfficeCLI argv execution;
- app-local backup creation before execution.

The UI separates the Office flow into two explicit actions: first confirm the
planned change, then create a backup and apply it.

Relay Agent does not mutate binary Office files through text tools, VBA, or
Microsoft 365 built-in editing.

## Code Writing

Code edits are intentionally narrow. Relay Agent gathers a small set of
workspace files, sends only those snippets to Copilot, and requires a
`RelayCodePatchPlan.v1` JSON response.

The desktop UI supports:

- local code context collection from the selected workspace;
- strict Copilot patch JSON with workspace-relative paths;
- exact `oldString` / `newString` replacements only;
- validation that each `oldString` matches exactly once before writing;
- changed-file and git diff display after applying.

Relay Agent does not let Copilot run shell commands or edit files directly in
this mode.

## Architecture

```text
Tauri + SolidJS desktop UI
  owns the Relay workbench, workspace selection, result cards, Office and code steps

Rust IPC commands
  expose document search, OfficeCLI inspection/execution, code patching, diagnostics

Relay document-search runner
  owns local search, ranking, bounded evidence packaging, and candidate facts

OfficeCLI
  owns Word / Excel / PowerPoint inspection and mutation

Relay code patcher
  owns bounded code context collection and exact-string patch application

M365 Copilot via Edge CDP
  optional planning and language layer; started on demand
```

## Repository Layout

```text
Relay_Agent/
├── apps/desktop/
│   ├── src/                         # SolidJS Relay desktop UI
│   ├── src-tauri/                   # Tauri app, Rust IPC, packaging config
│   └── scripts/                     # bundle prep and tool bootstrap scripts
├── integrations/aionui/overlay/     # historical location of search modules;
│                                     # migration to Relay-owned source path is tracked
├── scripts/                         # document-search tests and utilities
├── docs/
│   └── IMPLEMENTATION.md            # implementation log
├── PLANS.md                         # active completion plan
└── AGENTS.md                        # repository rules
```

## Development

Requirements:

- Node.js 22 or newer
- pnpm 10.x
- Rust stable
- Edge signed in to Microsoft 365 Copilot for live Copilot checks

Install dependencies:

```bash
pnpm install
```

Run the main acceptance gate:

```bash
pnpm check
```

Useful focused checks:

```bash
pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @relay-agent/desktop prep:tauri-bundle
node --test scripts/relay-document-search-executor.test.mjs
```

Start the desktop app in development:

```bash
pnpm diag:tauri-dev
```

## Packaging

The Windows installer is built by:

```text
.github/workflows/release-windows-installer.yml
```

The release tag must match `apps/desktop/package.json`, for example:

```text
v0.2.0
```

Before `tauri build`, the desktop package prepares required sidecars/resources:

- bundled Node for the Copilot CDP gateway;
- bundled ripgrep;
- bundled OfficeCLI;
- generated Relay document-search runtime bundle.

## Boundaries

- Do not reintroduce AionUi as the product shell.
- Do not add `office_search` as a model-facing tool.
- Do not use arbitrary shell execution for Office mutation.
- Do not store search caches in user-selected folders.
- Keep the visible product focused on document search, Office file editing, and
  bounded code edits.
