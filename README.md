# Relay Agent

Relay Agent is a Windows desktop agent that uses Microsoft 365 Copilot as the
LLM while keeping local file access and Office edits inside a controlled,
Relay-branded AionUi application.

The product is intentionally narrow right now. The beginner UI exposes two
workflows:

- `資料を探す` - find and inspect local or shared-folder documents.
- `Officeファイルを編集する` - edit Word, Excel, and PowerPoint files through
  OfficeCLI-backed tools.

Relay Agent is not a standalone search indexer, not a general-purpose AionUi
distribution, and not a local-code execution runtime. Its main job is to make
M365 Copilot usable as the planning and writing brain for local document work,
while Relay and AionUi own the actual tools, files, state, and safety
boundaries.

## Current Product Shape

The current release path is a Relay-branded AionUi desktop shell:

- AionUi owns the visible app UX, conversations, workspace files, previews,
  tool execution surfaces, and OfficeCLI skill flow.
- Relay owns the local OpenAI-compatible gateway to M365 Copilot, strict
  tool-call emulation, document-search contracts, evidence validation,
  diagnostics, release overlay, and portable tool bootstrap.
- M365 Copilot is treated as a planner or final-answer writer. It does not
  directly read local files, execute shell commands, edit Office files, or
  search Microsoft 365 content on behalf of Relay.
- The old Tauri/SolidJS shell in this repository remains for diagnostics and
  provider-gateway checks. It is not the product UX.
- OpenCode/OpenWork material remains as historical reference and diagnostic
  support. It is not the current first-run product path.

## End-User Workflow

1. Install Relay Agent from the Windows installer published in GitHub Releases.
2. Start Relay Agent from the Start menu or desktop shortcut.
3. Make sure Edge is signed in to Microsoft 365 Copilot.
4. Choose one of the two visible task modes:
   - `資料を探す` for document discovery and evidence-backed summaries.
   - `Officeファイルを編集する` for Office document edits.
5. Select a folder or file when the workflow asks for one, then type a natural
   language request.

The app hides upstream AionUi setup surfaces that are not needed for these two
workflows, including manual provider setup, model pickers, WebUI/channel
controls, feedback buttons, assistant-management controls, and broad creator
presets. Support can re-enable advanced surfaces through the internal
`relay.advancedSurfaces.enabled` setting.

## Document Search

Document search is handled by the high-level `relay_document_search` tool. The
workflow is designed to avoid the common failure mode where Copilot invents
broken `glob` patterns or summarizes filenames without checking the local
workspace.

Search behavior:

- Copilot creates a bounded query plan from the user's natural-language request.
- Relay validates the plan, owns the selected root folder, and executes the
  search locally.
- Broad searches return filename/path candidates quickly before doing expensive
  Office/PDF content extraction.
- Result cards are primary. Copilot prose is secondary and must stay within the
  evidence supplied by Relay.
- Candidate-only results are labelled as candidates. Relay does not call a file
  "latest", "required", "official", or "confirmed" unless the evidence supports
  that claim.
- Results separate direct workpaper/source candidates, supporting evidence,
  disclosure/output files, review/audit files, and backups/archives.
- Large folders use deterministic scan budgets so searches can balance current
  period folders with historical examples instead of scanning only one branch.
- The search substrate uses metadata caches, a filename/path posting index,
  optional SQLite FTS, parsed-document caches, and reciprocal-rank fusion.
- Search indexes and caches are stored under Relay/AionUi user-local storage.
  Searched shared folders are not polluted with `.aionrs` or Relay index files.

Supported document evidence paths include text files, CSV, Office OpenXML files
(`.docx`, `.xlsx`, `.xlsm`, `.pptx`), and text-layer PDFs where the configured
reader can extract text. Binary mutation is not part of document search.

## Office File Editing

Office editing routes through the OfficeCLI skill family:

- Word: `officecli-docx`
- Excel: `officecli-xlsx`
- PowerPoint: `officecli-pptx`

Relay bundles the pinned Windows OfficeCLI executable in the installer and
registers it on the child-process `PATH` before Office tools run. A verified
user-local cache can still be reused as a fallback, but the product path does
not ask users to run upstream install scripts, use admin rights, or paste
terminal commands. Existing Office files should be inspected before edits, and
Excel edits should use sheet-qualified cell/range references when a workbook
already exists.

## Architecture

```text
Relay-branded AionUi desktop shell
  owns UX, conversations, workspace files, previews, and tool surfaces

Relay gateway and overlay
  starts local /v1 OpenAI-compatible provider endpoint
  seeds AionUi with relay-agent/m365-copilot
  constrains Copilot into tool planning or final-answer writing
  validates document-search and Office-edit boundaries

Microsoft 365 Copilot in Edge
  supplies planning and language generation over CDP
  does not execute local tools

Local tools
  relay_document_search, OfficeCLI, bundled ripgrep, AionUi/AionCLI execution
```

## Repository Layout

```text
Relay_Agent/
├── apps/desktop/
│   ├── src-tauri/binaries/copilot_server.mjs     # M365 Copilot provider gateway
│   ├── src-tauri/bootstrap/aionui-relay.json     # product manifest and release contract
│   ├── scripts/                                  # provider, OfficeCLI, and AionUi launch helpers
│   └── src/                                      # legacy diagnostic SolidJS shell
├── integrations/aionui/overlay/                  # Relay files copied into the AionUi release build
├── scripts/
│   ├── apply-aionui-overlay.mjs                  # patches upstream AionUi into Relay Agent
│   └── relay-document-search-*.mjs               # document-search tests and utilities
├── docs/
│   ├── IMPLEMENTATION.md                         # implementation log and verification notes
│   ├── AIONUI_RELAY_MIGRATION.md                 # AionUi-first architecture decision
│   └── PACKAGING_POLICY.md                       # Windows installer policy
├── .github/workflows/release-aionui-windows-installer.yml
├── PLANS.md
└── AGENTS.md
```

## Development Setup

Requirements:

- Node.js 22 or newer
- pnpm 10.x
- Rust 1.80 or newer for legacy diagnostics and bootstrap binaries
- Edge signed in to Microsoft 365 Copilot for live provider tests

Install dependencies:

```bash
pnpm install
```

Run the main acceptance gate:

```bash
pnpm check
```

Fast checks:

```bash
pnpm typecheck
pnpm check:aionui-relay
pnpm --filter @relay-agent/desktop check:aionui-relay
node --test scripts/apply-aionui-overlay.test.mjs
node --test apps/desktop/src-tauri/binaries/copilot_server.test.mjs
```

Apply the Relay overlay to an AionUi checkout:

```bash
node scripts/apply-aionui-overlay.mjs --aionui-dir /path/to/aionui
```

Start only the Relay provider gateway for diagnostics:

```bash
pnpm start:aionui-relay-gateway
```

Run a live M365 provider smoke test:

```bash
pnpm live:m365:opencode-provider
```

That live test requires an Edge profile already signed in to Microsoft 365
Copilot. The default CDP port is `9360`; use `RELAY_EDGE_CDP_PORT` when a
different port is needed.

## Release Path

The supported end-user package is a Windows 10/11 x64 installer built from the
Relay-branded AionUi workflow:

```text
.github/workflows/release-aionui-windows-installer.yml
```

The release workflow:

1. Checks out the pinned AionUi baseline.
2. Applies `scripts/apply-aionui-overlay.mjs`.
3. Verifies Relay branding, provider seeding, document-search MCP wiring,
   OfficeCLI bootstrap metadata, and bundled ripgrep.
4. Ensures lean installer constraints: no standalone Node bundle and no
   LiteParse runner bundle in the AionUi installer.
5. Builds the Windows installer.
6. Publishes the installer and
   `Relay.Agent-AionUi-release-manifest.json` to GitHub Releases.

Formal releases require trusted signing. Internal prerelease builds may be
self-signed or unsigned when explicitly marked by the workflow inputs.

## Important Boundaries

- Do not add `office_search` back as a model-facing tool. Office/PDF discovery
  starts with filename/path discovery and exact file reads or the high-level
  document-search tool.
- Do not reintroduce Relay-owned execution runtime crates for the removed
  legacy tool/session paths.
- Do not route arbitrary shell execution, VBA, or uncontrolled network mutation
  through Relay product workflows.
- Do not store search indexes inside user-selected shared folders.
- Keep beginner-facing UI focused on document search and Office editing until
  the product scope changes.

## Documentation

- Implementation log: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- Active plan and guardrails: [PLANS.md](PLANS.md)
- Repository rules: [AGENTS.md](AGENTS.md)
- AionUi migration decision: [docs/AIONUI_RELAY_MIGRATION.md](docs/AIONUI_RELAY_MIGRATION.md)
- Packaging policy: [docs/PACKAGING_POLICY.md](docs/PACKAGING_POLICY.md)
- Copilot CDP notes: [docs/COPILOT_E2E_CDP_PITFALLS.md](docs/COPILOT_E2E_CDP_PITFALLS.md)
