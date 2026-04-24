# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is a **conversation-first Tauri desktop agent** under `apps/desktop/`.

- Frontend: SolidJS + Vite desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with active internal crates under
  `crates/{desktop-core,compat-harness}`. Historical `runtime` / `tools` crates
  and the unused legacy `api` crate have been physically removed as part of the
  OpenCode/OpenWork hard cut.
- Primary execution path: M365 Copilot via Edge CDP and the Relay Node bridge.
- Contract source of truth: Rust IPC types and command signatures; generated frontend bindings live in `apps/desktop/src/lib/ipc.generated.ts`, with `apps/desktop/src/lib/ipc.ts` kept thin.
- UI direction: warm-token light theme and paired warm-charcoal dark theme from `apps/desktop/DESIGN.md`.
- PDF reads: LiteParse via bundled `relay-node`.

Historical workbook / CSV planning artifacts are no longer completion gates for this repository. Older implementation log entries remain preserved in `docs/IMPLEMENTATION.md` as history only.

## Source Of Truth

Planning and implementation references are ordered as follows:

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `docs/CLAW_CODE_ALIGNMENT.md`

Additional rules:

- Rust crate types and IPC signatures in `apps/desktop/src-tauri/` are canonical.
- OpenCode/OpenWork session state is the canonical source for execution
  transcript and runtime behavior. Relay-specific defaults live in the desktop
  adapter/config modules.
- `.taskmaster/tasks/tasks.json` must reflect real artifact state, not historical intent.

## Delivery Priorities

- Priority A: keep M365 Copilot via Edge CDP as the primary LLM controller.
- Priority B: replace Relay's bespoke execution runtime with OpenCode/OpenWork
  as the external OSS execution substrate for sessions, tools, permissions,
  events, MCP, plugins, skills, and workspace runtime behavior.
- Priority C: keep Relay-specific code focused on desktop UX, Copilot CDP
  transport, prompt adaptation, and diagnostics.

## Strategic Reset: Copilot-Controlled OpenCode/OpenWork Execution

The active architecture direction is a hard cut, not a compatibility migration:
Relay_Agent becomes the adapter between M365 Copilot CDP and OpenCode/OpenWork.
OpenCode/OpenWork owns execution; Copilot owns LLM control; Relay owns the
desktop UX and transport bridge.

Detailed plan: `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`.

Implications:

- Do not add new production features to the Relay-owned Rust execution runtime.
- Do not preserve legacy tool/runtime/session contracts for compatibility.
- Do not reintroduce `office_search` as a model-facing tool.
- Do not treat the Copilot browser thread as the execution source of truth.
- New runtime work should target OpenCode/OpenWork APIs or extension points.

## Guardrails

- Do not widen scope without updating this file and recording the reason in `docs/IMPLEMENTATION.md`.
- Preserve the desktop UX and Copilot CDP product focus, but do not preserve
  Relay's bespoke execution runtime.
- Keep Relay-specific code focused on desktop UI, Tauri IPC, M365 Copilot,
  CDP orchestration, prompt adaptation, and diagnostics.
- Tool shapes, permission posture, session state, plugins, MCP, skills, and
  workspace config should come from OpenCode/OpenWork wherever practical.
- Do not implement arbitrary code execution, unrestricted shell access, VBA, or uncontrolled external network execution outside agent-managed tools.

## Verification Policy

Canonical repo verification commands:

```bash
pnpm check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli
```

Acceptance and smoke commands:

```bash
pnpm launch:test
pnpm smoke:windows
pnpm doctor -- --json
```

Rules:

- `pnpm check` is the canonical frontend acceptance gate.
- `pnpm typecheck` remains the fast local frontend-only check.
- Every completed milestone must leave a concrete artifact or logged verification result in `docs/IMPLEMENTATION.md`.
- CI must enforce the documented acceptance path instead of a smaller substitute.

## Current Hardening Track

### Phase 1: Repository Truth Cleanup

Goal: eliminate conflicting defaults and stale repo guidance.

Change targets:

- `Cargo.toml`
- `pnpm-workspace.yaml`
- `package.json`
- `README.md`
- `PLANS.md`
- `AGENTS.md`
- `docs/CLAW_CODE_ALIGNMENT.md`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Acceptance criteria:

- Workspace license metadata matches `LICENSE`.
- The workspace manifest no longer points at removed packages.
- Live docs all describe the same current desktop product.
- Active runtime behavior is documented as OpenCode/OpenWork-owned rather than
  Relay runtime-owned.
- Root `pnpm check` is the documented frontend gate.

### Phase 2: Headless Doctor

Goal: add a machine-readable diagnostic entrypoint for workspace, runtime assets, CDP, bridge health, and M365 readiness.

Change targets:

- `apps/desktop/src-tauri/src/doctor.rs`
- `apps/desktop/src-tauri/src/bin/relay-agent-doctor.rs`
- `apps/desktop/src-tauri/src/commands/{copilot,diagnostics}.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `package.json`
- `README.md`

Acceptance criteria:

- `relay-agent-doctor` supports `--json`, `--workspace`, `--cdp-port`, `--timeout-ms`, and `--no-auto-launch-edge`.
- Doctor JSON uses stable `RelayDoctorReport` / `RelayDoctorCheck` structures.
- Existing IPC warmup/diagnostics commands delegate to the shared doctor service.
- Integration tests cover ready, login-required, auth-failure, missing-workspace, and missing-runtime-asset paths.

### Phase 3: Deterministic Parity And OpenCode Session Harness

Goal: keep parity-style tool tests and verify full-session execution through the OpenCode-backed hard-cut path.

Change targets:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/crates/compat-harness/**`
- `docs/CLAW_CODE_ALIGNMENT.md`

Acceptance criteria:

- The hard-cut smoke starts the bundled OpenCode runtime and verifies linked
  OpenCode transcript writes.
- `compat-harness` remains a lightweight fixture manifest check and does not
  link the old Relay runtime/tools crates or desktop smoke helpers.
- Deterministic tests cover the active OpenCode-backed hard-cut adapter path;
  old runtime-level parity scenarios are not compatibility requirements.
- Alignment docs name the exact test covering each claw-style scenario.
- Copilot tool-call parser tolerance is widened from mutation-only to any MVP-whitelisted tool for unfenced sentinel-bearing JSON on Initial parse (see `docs/IMPLEMENTATION.md` 2026-04-18 milestone).

### Phase 4: CI And Acceptance Alignment

Goal: make CI enforce the repo’s actual acceptance criteria on both Linux and Windows.

Change targets:

- `.github/workflows/ci.yml`
- `package.json`
- `apps/desktop/package.json`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Main CI runs on `ubuntu-latest` and `windows-latest`.
- Ubuntu executes bundled-node prep, Tauri system dependencies, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm launch:test`.
- Windows executes bundled-node prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm smoke:windows`.
- CI also guards the live docs map against stale removed-package or spreadsheet-era references.

### Phase 5: First-Use UI Simplification

Goal: keep the desktop shell easy to understand by using one standard conversation surface instead of mode-based UX.

Change targets:

- `apps/desktop/src/components/{FirstRunPanel,Composer,SettingsModal,ShellHeader,Sidebar,MessageFeed,ContextPanel,StatusBar}.tsx`
- `apps/desktop/src/shell/{Shell,useCopilotWarmup}.ts*`
- `apps/desktop/src/index.css`
- `apps/desktop/tests/{app.e2e.spec.ts,e2e-comprehensive.spec.ts}`
- `README.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- First run is a single three-step flow: project, Copilot, first request.
- The first request stays disabled until project selection and Copilot readiness are satisfied.
- The app keeps one standard session posture for all chats; review and explanation requests are handled by intent, not by mode switches.
- User-facing labels prefer `Project`, `Chats`, `Needs your approval`, `Activity`, and `Integrations`.
- Risky actions are explained through inline approval requests instead of a separate mode or permission matrix.
- Root `pnpm check` passes and Playwright coverage confirms first-run gating plus the simplified shell labels.

### Phase 6: Opencode-Like Office/PDF Glob-Read Flow

Goal: keep Office/PDF shared-document search as a Relay capability while moving
the model-facing tool surface back toward opencode's simple `read` / `glob` /
`grep` shape. Office/PDF files are not searched through a hidden `grep`
content backend; the model discovers candidate paths with `glob` and inspects
exact documents with `read`.

Change targets:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/OPENCODE_ALIGNMENT_PLAN.md`
- `docs/OFFICE_SEARCH_DESIGN.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `grep` searches plaintext/code files only and rejects `.docx`, `.xlsx`,
  `.xlsm`, `.pptx`, and `.pdf` targets with guidance to use `glob` then `read`.
- `read` is the model-facing path for exact Office/PDF files and returns
  extracted plaintext.
- `office_search` is hidden from CDP catalogs and repair prompts; it remains
  only as an internal compatibility helper until callers are migrated.
- Local lookup repair generates only active model-facing tools: `read`, `glob`,
  and `grep`.
- Office/PDF filename discovery stays a `glob` responsibility; candidate
  filenames are not treated as content evidence until `read` inspects a file.
- Root verification follows the repository acceptance policy, with focused
  desktop-core parser, OpenCode runtime delegate, and hard-cut adapter
  regressions covering plaintext-only grep, glob-read Office/PDF repair, and
  no `office_search` repair.

Status 2026-04-23:

- Implemented for the CDP adapter path. `grep` now rejects Office/PDF container
  targets, CDP local-search catalogs expose only `read` / `glob` / `grep`, and
  local lookup repair no longer generates `office_search`.
- Office/PDF evidence lookup repair now starts with `glob`; if Copilot tries to
  summarize a `glob` candidate as evidence, the loop continues with a targeted
  `read` of the top Office/PDF candidate.
- `office_search` remains present as a hidden compatibility/internal execution
  path until all non-CDP callers and legacy transcript handling are migrated.

### Cross-Cutting Hardening: Workspace Approval Persistence

Goal: make persisted "Allow for this workspace" approvals resilient to interrupted writes and visible when the store is damaged.

Change targets:

- `apps/desktop/src-tauri/src/workspace_allowlist.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/models.rs`
- `apps/desktop/src/components/SettingsModal.tsx`
- `apps/desktop/src/lib/ipc.generated.ts`
- `apps/desktop/tests/{app.e2e.spec.ts,relay-e2e-harness.ts,tauri-mock-*.ts,simple.spec.ts}`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Workspace allowlist writes use a temp file plus locked replace instead of direct `fs::write`.
- Corrupt or unreadable allowlist stores surface warnings through the IPC snapshot and Settings UI.
- Mutating the allowlist refuses to overwrite a corrupt store.
- Rust regression tests cover corrupt-store warning and non-destructive failure handling.

### Cross-Cutting Hardening: Bash Policy And Legacy Loop Removal

Goal: reduce reliance on regex-only shell blocking and keep the old desktop
orchestrator removed.

Change targets:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Bash deny decisions use shell-fragment/token inspection before regex fallback.
- Wrapper forms such as `env ...`, `command ...`, `nice ...`, and mixed-case blocked verbs are covered by regression tests.
- OpenCode-backed adapter regression coverage verifies that Relay does not
  reintroduce the old shell policy engine.
- The deleted desktop `agent_loop/**` tree is not reintroduced; adapter logic
  stays in `hard_cut_agent.rs`, UI/IPC payloads stay in `agent_projection.rs`,
  and deterministic parser/prompt helpers stay in `desktop-core`.

### Cross-Cutting Feature: Office File Search

Goal: implement `docs/OFFICE_SEARCH_DESIGN.md` Phase A so the agent can extract and search Office/PDF plaintext without embeddings.

Change targets:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `AGENTS.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `.docx`, `.xlsx`, `.xlsm`, and `.pptx` `read` calls return extracted plaintext through stable line serialization.
- `.pdf` search uses `pdf_liteparse` payload-only extraction so the LiteParse banner is not indexed.
- Relay does not reintroduce `office_search`; CDP-facing tool catalog and
  Copilot prompt guidance expose Office/PDF handling through OpenCode-style
  `glob` / `read` instead.
- Office/PDF extraction behavior belongs in OpenCode/OpenWork or its extension
  points, not in a Relay-owned Rust execution crate.

### Cross-Cutting Feature: Agentic Workspace Search

Goal: add a Relay-only read-only orchestration layer above `glob`, `grep`, and
`read` style evidence expansion so
vague local lookup requests start with ranked candidates, snippets, searched
scope, and truncation state instead of relying on the model to manually chain
low-level tools.

Change targets:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `apps/desktop/src-tauri/crates/compat-harness/src/lib.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- The active search surface stays close to opencode-style low-level tools:
  `glob` for path discovery, `grep` for plaintext/code content, and `read` for
  exact file inspection including extracted Office/PDF text.
- Standard ignore directories such as `.git`, `node_modules`, and `target`,
  plus `.gitignore` patterns, are skipped by default, and
  large/plainly unreadable/binary files do not bloat results.
- `glob`, `grep`, and hidden compatibility `office_search` emit baseline
  search telemetry for counts, elapsed time, truncation, and failure surfaces.
- Search roots are constrained to the current workspace; paths or symlink
  resolutions that escape the workspace are not read.
- CDP prompt guidance prefers concrete `glob`, `grep`, or `read` calls for
  implementation, related-file, and evidence lookup requests.
- Important conclusions, reviews, edits, comparisons, and recommendations must
  expand relevant search candidates with `read`; search snippets are
  candidate evidence, not a substitute for full-file inspection.
- Deterministic runtime and compat-harness coverage verifies low-level search
  behavior.

## Forward-Looking Designs (Not Yet Scheduled)

- `docs/OFFICE_SEARCH_DESIGN.md` — Phase A has source implementation in progress/landed under the Office File Search track above. Future Phase B remains semantic retrieval on top of the extraction cache.

## Out Of Scope

- Broad backend decomposition unrelated to doctor sharing or deterministic harness support.
- Reintroducing upstream claw crates as direct Rust dependencies.
- Reviving workbook / spreadsheet-specific MVP gates.
- Release-installer signing or distribution workflows beyond keeping them separate from main CI.

## Risks And Mitigations

- Risk: docs drift faster than code changes.
  Mitigation: keep `README.md`, `PLANS.md`, `AGENTS.md`, and `docs/CLAW_CODE_ALIGNMENT.md` synchronized in the same PR as behavior changes.

- Risk: CDP and Edge instability makes parity coverage flaky.
  Mitigation: keep deterministic harnesses local and fixture-driven; reserve launched-app smokes for separate acceptance checks.

- Risk: CI passes while the repo’s documented acceptance path is still broken.
  Mitigation: have CI run the same root commands that the docs prescribe.

- Risk: historical task graphs stay marked complete for removed architecture.
  Mitigation: rewrite `.taskmaster/tasks/tasks.json` around the current product and verification artifacts.
