# Relay_Agent Implementation Plan

Date: 2026-04-06

## Planning Baseline

The repository now contains a **working Tauri v2 + SolidJS desktop application** under `apps/desktop/`, with the Rust backend in `apps/desktop/src-tauri/` and internal crates under `apps/desktop/src-tauri/crates/` (including `runtime`, `tools`, `commands`, and `compat-harness`; see `AGENTS.md` and the workspace manifests). The experimental **`onyx-concept`** SQLite FTS5 crate was removed in favor of agent-driven workspace search via **`glob_search`** / **`grep_search`** until a future indexed-retrieval milestone is justified.

Practical implication:

- **Greenfield planning below is historical:** Milestones 0–1 (and much of the relay/session vertical slice) are implemented in source; treat earlier “directories do not exist” wording in `.taskmaster/docs/repo_audit.md` as superseded unless the audit file is explicitly refreshed.
- The legacy **`packages/contracts` workspace package has been removed**; IPC source shapes live in Rust and generate `apps/desktop/src/lib/ipc.generated.ts`, while `apps/desktop/src/lib/ipc.ts` stays a thin wrapper layer (see `AGENTS.md` — Rust IPC is the source of truth).
- `.taskmaster/` remains the planning and task-graph layer alongside `PLANS.md` and `docs/IMPLEMENTATION.md`.
- “Preserve existing structure” means: avoid unnecessary reshaping of the **current** app layout; prefer incremental milestones over churny renames.

## Delivery Principles

MVP guardrails (authoritative summary: `AGENTS.md`):

- **Priority A:** Agent loop end to end with Copilot Proxy API and M365 Copilot via CDP.
- **Priority B:** Harden MCP server integration, tool approval, and session management.
- **Priority C:** Expand CDP browser automation and context-aware execution.

### PDF reading (LiteParse + bundled Node)

- **Scope:** `read_file` on `.pdf` uses **`@llamaindex/liteparse`** with **OCR disabled**, spawned by **Node** (bundled per target via Tauri `externalBin` as `relay-node`, or system `node` in dev). Runner assets live under `apps/desktop/src-tauri/liteparse-runner/` and are copied into the app bundle as resources. **Builders** run `npm ci --omit=dev` in that folder on the **same OS/arch** as the installer being produced (native modules). **Scanned PDFs** are out of scope while OCR remains off.
- **Docs / verification:** See `docs/IMPLEMENTATION.md` milestone **2026-04-08 PDF read_file via LiteParse + bundled Node**.
- **Merge / split:** Dedicated tools **`pdf_merge`** and **`pdf_split`** in the `tools` crate call **`runtime::pdf_manip`** (`lopdf` 0.35): concatenate PDFs in order, or write segment outputs with **1-based `pages`** strings matching `read_file` grammar. Limits, encryption stance, and verification commands are logged under **`docs/IMPLEMENTATION.md`** (PDF manip milestone).

### Windows desktop Office automation (PowerShell + COM)

- **Scope:** On Windows builds, **Word, Excel, PowerPoint**, and **`.msg`** are driven primarily via the **`PowerShell` tool** and **COM** (`.msg` through `Outlook.Application` when Outlook is installed). Live Outlook inbox automation is out of scope for this slice.
- **Hybrid read (data + layout):** **COM** emits **structured** table/cell data and a **temp PDF** under `%TEMP%\RelayAgent\office-layout\`; **`read_file` on that PDF** supplies **LiteParse** layout text in the **same** tool batch. See `docs/IMPLEMENTATION.md` milestone **2026-04-08 Windows Office hybrid read** and `apps/desktop/scripts/office-hybrid-read-sample.ps1`.
- **Performance:** Copilot turns are expensive—prefer **one PowerShell `command` per batch** (open → work → save → `Quit()`). **Excel:** no per-cell COM loops; use **2D array / `Range.Value2`**, block ranges, CSV import, etc.; `ScreenUpdating` off in try/finally when appropriate.
- **Console UTF-8:** The `tools` crate prepends `chcp 65001` and output-encoding setup to every PowerShell invocation unless **`RELAY_POWERSHELL_NO_UTF8_PREAMBLE`** is set (`1`/`true`/`yes`/`on`), so the host’s UTF-8-oriented decoding is less likely to mojibake Japanese output on CP932 consoles.
- **Prompts:** `agent_loop` adds Windows-only system and CDP catalog sections describing the above; the `PowerShell` tool description documents the contract.

Additional product principles (spreadsheet-era PRD and reduction goals):
- Minimize custom implementation. Prefer claw-code for behavior and system flow, and preserve custom code only where Relay must mediate M365 Copilot.
- **Claw-code integration (2026-04-09):** The desktop app **does not** currently depend on external `claw-*` Rust crates (`apps/desktop/src-tauri/Cargo.toml`). Behavior stays aligned with [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) `rust/` and [PARITY.md](https://github.com/ultraworkers/claw-code/blob/main/PARITY.md) via **selective porting** and shared conventions (`.claw` config, tool shapes, prompt discipline). The **`compat-harness`** crate vendors `rust/mock_parity_scenarios.json`, asserts scenario name order against that manifest, and runs `parity_style` tests mapped in `docs/CLAW_CODE_ALIGNMENT.md` (not the full `claw` CLI + mock-Anthropic harness). Reintroducing upstream crates as libraries is optional and must be recorded here and in `docs/IMPLEMENTATION.md` when done. Module boundaries are summarized in `docs/CLAW_CODE_ALIGNMENT.md`.
- Current reduction rule: treat the in-repo workbook engine, workbook context inspection, and workbook-specific prompt shaping as removal targets. The desired end state is upstream `claw-code` / `claw-code-parity` for behavior and `openwork` for UI direction, with custom Relay code limited to M365 Copilot interop.
- Final reduction acceptance is architectural, not a raw byte cap: `T20` is satisfied only when no TypeScript agent-loop/orchestration remains, no in-repo workbook or relay-tool runtime remains, and the remaining custom Rust is limited to M365 Copilot interop plus thin desktop glue. Byte counts are still recorded as telemetry, but they are no longer the primary gate.
- Preserve the openwork-inspired **layout** (three-pane shell, composer, context panel), but do not keep compatibility shims just to protect earlier internal flows. **Visual tokens (2026-04-09):** CSS `--ra-*` and **`.ra-type-*`** utilities in `apps/desktop/src/index.css` follow **Cursor-inspired** typography and palette from `apps/desktop/DESIGN.md` (getdesign `cursor` pack); see `docs/IMPLEMENTATION.md` milestones **2026-04-09 Desktop UI: Cursor alignment (type scale, borders, editorial)** and **2026-04-09 Desktop UI: Cursor Inspiration tokens (light spec + paired dark)**.
- **OpenWork-style UX (current):** Three-pane shell; **workspace** = header chip → modal (path + Browse + Done). **Plan | MCP** context tabs; tool **policy summary** folds under Plan. Tool steps **always** inline in chat. **Session mode** in composer disclosure; **no** in-app prompt template library (removed 2026-04-10). **`get_relay_diagnostics`** remains in IPC — not exposed in the minimal settings UI. Approvals: **Allow once** / **Allow for session** / optional **Allow for this workspace**. **Ctrl+Enter** (**⌘+Enter**) sends; **Enter** newline. Milestone log: `docs/IMPLEMENTATION.md` **2026-04-10 Desktop UI: OpenWork-style UI second pass (minimal chrome)** (and historical **2026-04-09** / **2026-04-08** entries).
- **Workspace UI + folder picker (2026-04-08):** Header workspace chip, status-bar path (ellipsis + copy), `MessageFeed` empty-state copy tied to cwd, **Browse…** in Settings via **`tauri-plugin-dialog`** (`dialog:default` capability). Details: `docs/IMPLEMENTATION.md` milestone **2026-04-08 Workspace display + native folder picker**. *(2026-04-09: status bar defers path to header chip + tooltip; see simplification milestone.)*
- Compatibility is not a release requirement for the current pre-distribution phase. Prefer deleting obsolete paths over maintaining dual flows.
- Save-copy only is the default write model.
- Original spreadsheet inputs are treated as read-only.
- No arbitrary code execution, shell execution, VBA, or external network access in the product flow.
- Planning and implementation artifacts must be left in files, not only in task status changes.

## OpenWork-derived follow-through (2026-04-09)

### Workspace descriptor (`relay.workspace.json`)

**Status:** Documented only (host does not read the file yet).

**Goal:** Optional JSON at the workspace root for documented defaults (e.g. suggested session preset, browser hints) without duplicating Settings.

**Precedence (when implemented):** Values from Settings and the `start_agent` request override any keys from `relay.workspace.json`. The file applies only for keys the user has not set in the UI for that run.

**Artifacts:** Schema sketch in `docs/IMPLEMENTATION.md` (milestone log); future merge point: `start_agent` / config loader in `apps/desktop/src-tauri/`.

### Project-scoped slash commands (`.relay/commands`)

**Status:** Implemented (Option A in `docs/CUSTOM_SLASH_AND_TEMPLATES.md`).

**Discovery:** Under the configured workspace `cwd`, read `.relay/commands/commands.json` (array of `{ name, description?, body }`) and `.relay/commands/*.md` (stem = command name, body = template). Same-named `.md` overrides JSON.

**Limits:** 64 KiB per file, up to 64 markdown files; paths must stay under canonical `cwd`.

**IPC / UI:** `list_workspace_slash_commands`; Solid composer merges with built-in slash commands (workspace wins on name conflict).

**Verification:** `pnpm typecheck`, `cargo test -p relay-agent-desktop workspace_slash`, manual check with a sample `.relay/commands/foo.md`.

## Draft Completion Conditions

The **spreadsheet-centric demo bar** below remains the reference for CSV/save-copy MVP completeness. The **currently shipped vertical slice** also includes the agent loop, streaming UI, tool events, CDP-driven M365 Copilot, and related follow-ups documented in `docs/IMPLEMENTATION.md` and the Task Master graph.

The MVP should not be treated as complete until all of the following are true:

- `pnpm install` resolves the workspace successfully.
- `pnpm check` passes.
- `pnpm typecheck` passes.
- `pnpm --filter @relay-agent/desktop build` passes.
- `cargo check` passes (from `apps/desktop/src-tauri/` or workspace root as documented in `README.md`).
- The UI supports session creation, agent turns, structured response / execution preview, and validation in a usable flow (relay-packet-first flows may be legacy; see `docs/IMPLEMENTATION.md`).
- A diff preview and approval path exist before any write action.
- A minimal CSV end-to-end demo works.
- `README.md` documents startup steps, demo usage, and limitations.

## Milestone 0: Planning Artifacts

**Status:** Complete (baseline artifacts exist; refresh `repo_audit.md` if a new baseline audit is needed).

### Goal

Create the planning and repository operating artifacts needed before code implementation begins.

### Change Targets

- `PLANS.md`
- `AGENTS.md`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/docs/repo_audit.md`

### Acceptance Criteria

- The repository audit exists and reflects the actual starting state.
- `PLANS.md` defines milestones, acceptance criteria, verification commands, scope exclusions, and risks.
- `AGENTS.md` defines repository-specific execution rules.
- `docs/IMPLEMENTATION.md` exists as the running implementation log.

### Verification Commands

```bash
test -f .taskmaster/docs/repo_audit.md
test -f PLANS.md
test -f AGENTS.md
test -f docs/IMPLEMENTATION.md
```

### Out of Scope

- Any product code.
- Any build-system or package-manager setup.

### Risks and Mitigations

- Risk: planning assumes code already exists.
  Mitigation: use `.taskmaster/docs/repo_audit.md` as the baseline source of truth.
- Risk: future tasks are marked complete without artifacts.
  Mitigation: each planning task must produce a file or a logged verification result.

## Milestone 1: Monorepo and Build Foundation

**Status:** Complete in source (pnpm workspace + SolidJS/Vite desktop + Tauri v2).

### Goal

Create a working workspace foundation that can host the desktop app and Rust/Tauri backend, with typed IPC between frontend and backend.

### Change Targets

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig*.json`
- `apps/desktop/**` (SolidJS + Vite frontend, `src-tauri/` Rust backend)
- Workspace `Cargo.toml` and `apps/desktop/src-tauri/**`

### Acceptance Criteria

- The workspace installs successfully.
- The desktop app structure exists as **SolidJS + Vite SPA + Tauri v2** (not SvelteKit).
- TypeScript IPC types are generated from Rust source models into `apps/desktop/src/lib/ipc.generated.ts`, with `apps/desktop/src/lib/ipc.ts` limited to invoke/listen wrappers and UI helpers.
- Basic JS/TS and Rust checks run without structural failures.

### Verification Commands

```bash
pnpm install
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

### Out of Scope

- Full UI behavior.
- Workbook transformations.
- End-to-end relay execution.

### Risks and Mitigations

- Risk: greenfield workspace setup drifts into unnecessary architecture work.
  Mitigation: create only the directories and config needed to support the MVP milestones.
- Risk: Tauri and Vite/Solid integration fails due to incompatible defaults.
  Mitigation: validate the desktop build immediately after structure creation instead of deferring integration checks.

## Milestone 2: Session, Turn, and Relay Vertical Slice

**Status:** Largely superseded in source by the **agent loop + structured responses + CDP Copilot** path; relay-packet-first UX may remain only in history/docs. See `docs/IMPLEMENTATION.md` for the current session and turn model.

### Goal

Make the application capable of creating sessions, starting turns, and moving Copilot/agent output through a typed UI-to-backend flow (historically: relay packets and pasted responses; currently: structured recording, streaming, and registry-backed tools).

### Change Targets

- Rust models and Tauri IPC (`models.rs`, `tauri_bridge.rs`, internal crates)
- Desktop UI shell and typed IPC wrapper (`apps/desktop/src/lib/ipc.ts`, `root.tsx`, components)
- Rust/Tauri commands for app initialization, session lifecycle, agent loop, and response/artifact handling
- Local storage modules for sessions and turns

### Acceptance Criteria

- Shared shapes exist for core entities (Rust + mirrored TS IPC types).
- The frontend can create and list sessions.
- A turn / agent run can be started from the UI.
- Copilot or proxy responses flow through validation/preview paths as implemented (relay packet display is not required if replaced by structured flow).
- Session data persists locally and survives restart.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Launch the desktop app.
2. Create a session.
3. Start a turn or agent run.
4. Exercise the current primary flow (e.g. goal → agent loop → tool/streaming events → structured response / preview as applicable).
5. Confirm validation or error output matches the implemented path.

### Out of Scope

- Actual workbook mutations.
- Save-copy execution.
- Rich xlsx support.

### Risks and Mitigations

- Risk: contract drift between frontend and backend payloads.
  Mitigation: treat Rust IPC as source of truth; update generated bindings and the thin `ipc.ts` wrapper in the same change as command/event shape changes.
- Risk: session persistence is added late and breaks flow state.
  Mitigation: build local storage during this milestone, not after UI wiring is finished.

## Milestone 2A: Core / Client / IPC Boundary Refactor

**Status:** Complete in source (2026-04-12).

### Goal

Reduce desktop change cost by moving orchestration and contracts behind clearer backend boundaries while preserving the existing Tauri commands, `agent:*` events, session presets, and UX.

### Change Targets

- `apps/desktop/src-tauri/src/app_services.rs`, `registry.rs`, `lib.rs`, `tauri_bridge.rs`
- `apps/desktop/src-tauri/src/agent_loop/**`
- `apps/desktop/src-tauri/src/commands/**`
- `apps/desktop/src-tauri/src/ipc_codegen.rs`, `models.rs`, `workspace_surfaces.rs`
- `apps/desktop/src/lib/ipc.generated.ts`, `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src/shell/Shell.tsx`, `apps/desktop/src/shell/{sessionStore,approvalStore,useAgentEvents,useCopilotWarmup}.ts`
- `.github/workflows/ci.yml`, `README.md`, `docs/IMPLEMENTATION.md`

### Acceptance Criteria

- Tauri app state is centralized under `AppServices`, including config-derived session semaphore and Copilot bridge state.
- The session registry uses per-session handles instead of one central mutex for approvals, questions, undo stacks, and run state.
- `agent_loop` is a module boundary with orchestration, prompt, permission, retry, compaction, executor, and transport slices instead of a single top-level file.
- Rust IPC source models generate `apps/desktop/src/lib/ipc.generated.ts`; `ipc.ts` remains a thin wrapper/helper layer.
- `Shell.tsx` is reduced to composition, with event handling, warmup, session state, and approval state split into stores/hooks.
- CI runs `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` in addition to the existing checks.
- README and implementation notes describe the generated IPC boundary and the new backend/client split.

### Verification Commands

```bash
node apps/desktop/scripts/fetch-bundled-node.mjs
corepack pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

### Notes

- PR CI now enforces `cargo test`; mock Playwright remains a follow-up instead of a required PR gate in this milestone.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` now passes for the desktop crate; remaining Rust verification noise is limited to non-fatal `ts-rs` serde-attribute warnings tracked in `docs/IMPLEMENTATION.md`.

## Milestone 3: CSV Inspect and Preview Slice

### Goal

Add workbook inspection and transformation preview capability with CSV as the primary supported format.

### Change Targets

- workbook/CSV engine modules
- read-only workbook tools
- transformation preview logic
- Studio right-pane workbook summary and diff preview UI

### Acceptance Criteria

- CSV inspection works end to end.
- The app can preview sheet structure and column profiles.
- The supported MVP transformations can produce a preview summary.
- `preview_execution` returns target sheet or table context, changed columns, estimated affected rows, and output destination.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Open a CSV example file.
2. Run inspect and preview-related actions.
3. Confirm workbook summary and diff preview render in the UI.

### Out of Scope

- High-fidelity xlsx round-tripping.
- Advanced workbook semantics beyond inspect and save-copy preparation.
- Non-tabular spreadsheet automation.

### Risks and Mitigations

- Risk: xlsx support overwhelms the MVP.
  Mitigation: prioritize CSV and keep xlsx limited to inspect and save-copy-friendly paths.
- Risk: preview data is too vague to support approval.
  Mitigation: standardize the diff summary payload before adding execution.

## Milestone 4: Approval and Save-Copy Execution

### Goal

Execute validated actions safely through preview, approval, and save-copy only output.

### Change Targets

- backend preview and execution modules
- approval flow state and UI
- CSV sanitization logic
- output artifact handling

### Acceptance Criteria

- No write happens before preview and approval.
- Execution writes only to a copy.
- Original files remain unchanged.
- CSV injection safeguards are applied on output.
- Unsafe capabilities from the PRD remain unimplemented and blocked.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Run the CSV flow through preview.
2. Approve execution.
3. Confirm output is written to a new file.
4. Confirm the original file is unchanged.
5. Confirm dangerous CSV-leading characters are sanitized in output.

### Out of Scope

- In-place edits to the original workbook.
- Formula-authoring from model output.
- Any shell, VBA, or network-enabled execution path.

### Risks and Mitigations

- Risk: execution bypasses preview details users need.
  Mitigation: make `preview_execution` a required prerequisite and surface it clearly in the UI.
- Risk: unsafe spreadsheet content is written back out.
  Mitigation: sanitize CSV output and reject unsupported unsafe action types.

## Milestone 5: Documentation, Examples, and Polish

### Goal

Leave the MVP in a demonstrable and understandable state with examples, clear documentation, and explicit limitations.

### Change Targets

- `README.md`
- `examples/**`
- `docs/IMPLEMENTATION.md`
- any final UI or copy cleanup directly tied to the documented demo path

### Acceptance Criteria

- `README.md` includes setup instructions, relay packet example, valid response example, demo flow, and limitations.
- `examples/` includes at least one CSV file for the demo path.
- `docs/IMPLEMENTATION.md` summarizes implementation decisions, verification results, and remaining gaps.
- Known limitations are explicit and accurate.

### Verification Commands

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo check
```

Manual verification:

1. Follow the README from a clean checkout.
2. Run the documented demo flow.
3. Compare actual behavior against known limitations.

### Out of Scope

- Additional features beyond the MVP relay flow.
- Broad workbook feature expansion not required by the demo path.

### Risks and Mitigations

- Risk: documentation drifts from the implementation.
  Mitigation: update `docs/IMPLEMENTATION.md` at each milestone and validate the README against the example flow.
- Risk: examples do not reflect real supported behavior.
  Mitigation: generate example content from the actual supported CSV path, not hypothetical future capabilities.

## Follow-up Scope Note

Post-MVP usability work aimed at non-engineer operators is captured in `.taskmaster/docs/prd_non_engineer_ux.txt`.
The corresponding Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as follow-up tasks `11` through `16`.
That follow-up set is now implementation-complete, with the shipped verification checklist recorded in `docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md`.
The first packaged end-user release path is now fixed by `docs/PACKAGING_POLICY.md` to Windows 10/11 x64 via an NSIS installer, with manual installer-driven updates until signed updater infrastructure exists.
The current verified source-run startup walkthrough remains in `README.md`; packaged installer behavior stays documented in `docs/PACKAGING_POLICY.md` until installer builds are real and testable.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_workbook_artifact_browser.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `17` through `20`, and that follow-up is now implementation-complete with verification recorded in `docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_turn_lifecycle_details.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `21` through `26`, and that follow-up is now implementation-complete with verification recorded in `docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_startup_test_harness.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `27` through `31`, and that follow-up is now implementation-complete with verification recorded in `docs/STARTUP_TEST_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_app_launch_execution_test.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `32` through `36`, and that follow-up is now implementation-complete with verification recorded in `docs/APP_LAUNCH_TEST_VERIFICATION.md`.
The next shipped follow-up scope is captured in `.taskmaster/docs/prd_app_workflow_launch_test.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `37` through `41`, and that follow-up is now implementation-complete with verification recorded in `docs/APP_WORKFLOW_TEST_VERIFICATION.md`.
Windows installer distribution now also has a concrete release channel: `.github/workflows/release-windows-installer.yml` builds the NSIS installer on Windows and publishes it to GitHub Releases instead of committing binary installers into the repository.
The next packaging hardening follow-up is captured in `.taskmaster/docs/prd_windows_trusted_signing.txt`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `42` through `45`, covering the repo-side Trusted Signing workflow rewrite and Azure/GitHub setup runbook. The first fully signed Windows release remains an operational prerequisite rather than a Task Master task because it depends on external Azure provisioning.
The guided workflow simplification scope from `.taskmaster/docs/archive/prd_guided_workflow_simplification.txt` is now implementation-complete as tasks `46` through `63`.
The current active UI follow-up is captured in `.taskmaster/docs/prd.txt` sections `3` and `4`.
Its Task Master breakdown now lives in `.taskmaster/tasks/tasks.json` as tasks `64` through `75`, with tasks `64` through `67` and `69` through `75` implemented, and task `68` still pending for the manual Windows Tauri walkthrough.

The next follow-up scope is captured in `.taskmaster/docs/prd.txt` section `14`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `84` through `95`. The implementation-backed work for tasks `85` through `94` is in place, task `84` is satisfied by `docs/AGENT_LOOP_DESIGN.md`, and task `95` remains pending until the Windows + M365 manual checklist in `docs/AGENT_LOOP_E2E_VERIFICATION.md` is executed and recorded.

The latest browser-automation hardening scope is captured in `.taskmaster/docs/prd.txt` section `17`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `104` through `108`, which are implementation-complete in source. The earlier browser-automation verification backlog under tasks `76` through `83` still requires live selector confirmation and Windows/M365 manual validation before it should be treated as fully closed.

The next planning-first autonomous execution scope is captured in `.taskmaster/docs/prd.txt` section `18`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `109` through `123`. The design and frontend/contracts foundation in tasks `109` through `113` plus the plan approval / execution UI, persistence, and settings work in tasks `114` through `122` are now implemented in source. The remaining closure item is task `123`, which still depends on the Windows + M365 manual checklist in `docs/AUTONOMOUS_EXECUTION_E2E_VERIFICATION.md`.

The next delegation-first UI scope is captured in `.taskmaster/docs/prd.txt` section `19`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `124` through `137`. The delegation design, component extraction, delegation state store, goal-first composer, activity feed, intervention panel, completion timeline, mode persistence, responsive layout, and keyboard shortcuts in tasks `124` through `136` are now implemented in source. The remaining closure item is task `137`, which still depends on the Windows + M365 manual checklist in `docs/DELEGATION_UI_E2E_VERIFICATION.md`.

The next Copilot-integration hardening scope is captured in `.taskmaster/docs/prd.txt` section `20`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `138` through `143`. The prompt-template refresh, context compression, structured retry/manual fallback behavior, conversation-history persistence, and multi-session feasibility write-up in tasks `138` through `142` are now implemented in source or documentation. The remaining closure item is task `143`, which still depends on the Windows + M365 manual checklist in `docs/COPILOT_INTEGRATION_E2E_VERIFICATION.md`.

The next generic file-operations scope is captured in `docs/CODEX_PROMPT_15_FILE_OPERATIONS.md`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `144` through `149`. The contracts, Rust backend file/text/document tools, approval-preview UI, and regression coverage in tasks `144` through `148` are now implemented in source. The remaining closure item is task `149`, which still depends on the Windows + M365 manual checklist in `docs/FILE_OPS_E2E_VERIFICATION.md`.

The next project-memory and scoped-context follow-up is captured in `docs/CODEX_PROMPT_16_PROJECT_MEMORY.md`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `150` through `154`. The project model design, contracts and backend CRUD, project selector UI, prompt-context injection, continuity persistence, project/session linkage through `sessionIds`, project-centric session browse/reassign/filter/bulk flows, accepted-response auto-learning of durable output preferences from both structured and free-form response content, project-scope file-access guards, the scope-override approval UI that feeds back into the existing preview/save gate, persisted response-linked scope-override audit artifacts, a dedicated current-turn approval history panel, and a project-scoped cross-session approval report are now implemented in source and documented in `docs/PROJECT_MODEL_DESIGN.md`.

The next tool-integration follow-up is captured in `docs/CODEX_PROMPT_17_TOOL_MCP.md`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `155` through `159`. The tool registry design, runtime registry-backed Relay packet generation, built-in read-tool invocation through the registry, optional MCP discovery/invocation over HTTP JSON-RPC plus reusable stdio sessions, settings-side tool management UI with transport selection, backend-persisted MCP/tool settings with startup restore, continuity-backed memory-mode fallback, and backend-executed browser automation behind the registry-compatible browser tool runtime are now implemented in source and documented in `docs/TOOL_REGISTRY_DESIGN.md`.

The next artifact-first output follow-up is captured in `docs/CODEX_PROMPT_18_ARTIFACT_OUTPUT.md`.
Its Task Master breakdown lives in `.taskmaster/tasks/tasks.json` as tasks `160` through `163`. The artifact output design, contract and IPC extensions for `OutputArtifact` and quality checks, generic `ArtifactPreview` UI, preview/execution artifact emission, multi-output execution command support, and post-save output quality validation are now implemented in source and documented in `docs/ARTIFACT_OUTPUT_DESIGN.md`.

That UI follow-up preserves the current safety model:

- preview before write
- approval before write
- save-copy only
- original workbook read-only

The remaining UI follow-up emphasis is on the Windows Tauri walkthrough verification, while the shipped UI scope now includes always-visible guided steps, compact Step 1 editing, workbook-column-aware Copilot instructions, dynamic save-copy path guidance, template-specific examples, stronger auto-fix handling, and level-specific retry prompts without relaxing those guardrails.

## Milestone: OpenCode-style session presets (Plan / Build)

**Status:** Implemented (2026-04-09).

**2026-04-11 follow-up scope:** backend-first hardening, launched-app verification recovery, the next loop-control slice, the runtime/host contract cleanup, and prompt-surface hardening only. Current follow-up work under this milestone is limited to Rust-side loop control, retry/compaction handling, internal session run-state tracking, env-gated `agent-loop:test` smoke coverage, a thin pushed status stream (`agent:status`) with minimal shell consumption, doom-loop stopping, compaction replay, explicit runtime terminal outcomes, separated outer/inner iteration limits, safe batched-tool short-circuiting, synthetic control-input handling that stays out of user transcript, shared-builder-based desktop prompts, additive local prompt customization, budgeted git context, and retry-only unfenced JSON recovery; it does **not** widen UI workflow scope beyond that minimal status wiring or change the Copilot/CDP prompt contract.

### Goal

Offer an [OpenCode](https://github.com/anomalyco/opencode)-style **Build** vs **Plan** posture at session start without replacing the Copilot/CDP stack: **Build** keeps the existing desktop permission ladder (read tools auto-allow; workspace writes and shell escalate to approval). **Plan** sets the host `PermissionPolicy` active mode to **read-only** so mutating tools are **rejected without prompts**; the model is instructed to analyze and propose changes in prose/markdown only.

### Change targets

- `apps/desktop/src-tauri/src/models.rs` — `SessionPreset`, `StartAgentRequest.session_preset`
- `apps/desktop/src-tauri/src/agent_loop.rs` — `desktop_permission_policy(preset)`, `build_desktop_system_prompt(..., preset)`, `run_agent_loop_impl` threading
- `apps/desktop/src-tauri/src/tauri_bridge.rs` — pass preset into the agent loop
- `apps/desktop/src-tauri/src/copilot_persistence.rs` — optional `session_preset` on `PersistedSessionConfig`
- `apps/desktop/src/lib/ipc.ts`, `apps/desktop/src/components/Composer.tsx`, `apps/desktop/src/root.tsx` — UI segmented control + IPC

### `.claw` interaction

- **Plan** does not rewrite files on disk; it is a **per-session host policy** layered on top of merged `.claw` settings.
- **Bash** still uses `ConfigLoader` + `bash_validation` for read-only heuristics when bash would run; in Plan mode most mutating tools never reach execution because `authorize` denies first.
- To **apply** file changes after planning, the user starts a **Build** session (or adjusts project permissions and uses Build).

### Acceptance criteria

- `start_agent` accepts optional `sessionPreset` (`build` | `plan`, default `build`); Plan denies `write_file` / `bash` / etc. without approval prompts (regression test in `agent_loop` tests).
- Composer exposes **Build** / **Plan** toggle; choice is persisted in `localStorage` (`relay.sessionPreset.v1`).
- Saved session JSON may include `sessionPreset` for support/debug continuity.

### Verification commands

```bash
pnpm --filter @relay-agent/desktop typecheck
cd apps/desktop/src-tauri && cargo test --workspace
```

---

## Milestone (deferred): LSP-backed code intelligence

**Status:** Planned only — **not** part of MVP completion gates.

### Goal

Optional **Language Server Protocol** integration (definitions/references or diagnostics) to complement `glob_search` / `grep_search`, inspired by OpenCode’s LSP emphasis.

### Scope guardrails

- **Separate milestone** from Priority A/B: no Copilot/CDP behavior change required to close this.
- Start with **one or two** languages (e.g. Rust + TypeScript) or opt-in configuration; process lifecycle, binary discovery, and tool approval policy must be specified before implementation.
- Security: LSP subprocesses run with workspace-scoped roots; document data sent to language servers.

### Outcome of planning gate

This file records the **decision** to track LSP as **Priority C / future indexed-retrieval class work**, not as a current vertical-slice requirement. Implementation starts only after an explicit milestone update here and a design note in `docs/IMPLEMENTATION.md`.

---

## Global Scope Exclusions

These items remain outside the MVP unless explicitly pulled in later:

- Generic multi-domain agent support beyond Excel/CSV.
- Arbitrary local code execution or shell tools inside the product workflow.
- VBA/macros.
- External network access during workbook execution.
- Raw Excel formula generation from model output.
- Full workbook fidelity guarantees for xlsx.
- Large-scale data engineering features beyond the listed MVP transformations.

## Recommended Execution Order

1. Keep planning artifacts (`PLANS.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`) aligned with the code that exists (Milestones 0–1 are done).
2. Drive **Priority A–C** in `AGENTS.md` (agent loop + Copilot/CDP, MCP/tools/session hardening, CDP depth).
3. For the **spreadsheet demo path**, use Milestones 3–5: preview (M3), save-copy execution (M4), docs/examples (M5).
4. Use `.taskmaster/tasks/tasks.json` and the follow-up notes in this file for ordered closure of verification checklists (especially Windows + M365 manual runs).

Historical linear order (for context only): Milestone 0 → 1 → 2 → 3 → 4 → 5 as originally written; steps 0–2 are substantially implemented, with Milestone 2’s relay-first wording superseded by the agent-loop architecture.
