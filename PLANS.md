# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is a **conversation-first Tauri desktop agent** under `apps/desktop/`.

- Frontend: SolidJS + Vite desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with internal crates under `crates/{api,desktop-core,runtime,tools,commands,compat-harness}`.
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
- `runtime::CompactionConfig::default()` is the canonical source for compaction defaults.
- `.taskmaster/tasks/tasks.json` must reflect real artifact state, not historical intent.

## Delivery Priorities

- Priority A: keep the agent loop, Copilot bridge, and M365 Copilot via CDP working end to end.
- Priority B: harden MCP integration, approval flow, diagnostics, deterministic parity coverage, and session management.
- Priority C: expand browser automation and context-aware execution without weakening the boundary between Relay-specific code and claw-aligned behavior.

## Guardrails

- Do not widen scope without updating this file and recording the reason in `docs/IMPLEMENTATION.md`.
- Preserve the current desktop architecture; avoid broad backend decomposition unless required for a concrete milestone.
- Keep Relay-specific code focused on desktop UI, Tauri IPC, M365 Copilot, and CDP orchestration.
- Tool shapes, permission posture, `.claw` config handling, docs map, and parity coverage should stay aligned with claw-code where practical.
- Do not implement arbitrary code execution, unrestricted shell access, VBA, or uncontrolled external network execution outside agent-managed tools.

## Verification Policy

Canonical repo verification commands:

```bash
pnpm check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p compat-harness
```

Acceptance and smoke commands:

```bash
pnpm launch:test
pnpm agent-loop:test
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
- Compaction defaults are documented only from `runtime::CompactionConfig::default()`.
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

### Phase 3: Deterministic Parity And Session Harness

Goal: keep parity-style tool tests and add deterministic full-session desktop coverage for the remaining claw scenarios.

Change targets:

- `apps/desktop/src-tauri/src/test_support.rs`
- `apps/desktop/src-tauri/src/agent_loop_smoke.rs`
- `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/crates/compat-harness/**`
- `docs/CLAW_CODE_ALIGNMENT.md`

Acceptance criteria:

- `agent_loop_smoke.rs` is a thin wrapper over shared desktop harness support.
- `compat-harness` reuses desktop test support rather than a separate smoke-only path.
- Deterministic tests cover `streaming_text`, `plugin_tool_roundtrip`, `auto_compact_triggered`, and `token_cost_reporting`.
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
- Ubuntu executes bundled-node prep, Tauri system dependencies, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p compat-harness`, `pnpm check`, `pnpm launch:test`, and `pnpm agent-loop:test`.
- Windows executes bundled-node prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p compat-harness`, `pnpm check`, and `pnpm smoke:windows`.
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

### Cross-Cutting Hardening: Bash Policy And Agent-Loop Maintainability

Goal: reduce reliance on regex-only shell blocking and trim one self-contained responsibility out of the desktop orchestrator.

Change targets:

- `apps/desktop/src-tauri/crates/runtime/src/tool_hard_denylist.rs`
- `apps/desktop/src-tauri/crates/runtime/Cargo.toml`
- `apps/desktop/src-tauri/src/agent_loop/{orchestrator.rs,permission.rs}`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Bash deny decisions use shell-fragment/token inspection before regex fallback.
- Wrapper forms such as `env ...`, `command ...`, `nice ...`, and mixed-case blocked verbs are covered by regression tests.
- Runtime regression coverage includes property-style tests for blocked bash mutations and allowed git inspection commands.
- Desktop agent-loop permission explanation helpers, approval prompting, prompt/path-repair helpers, CDP prompt-bundle/message rendering helpers, retry/repair helpers, success/error-decision application, doom-loop guard application, session-state helpers, event payload/emission helpers, and unfenced/fenced tool-JSON fallback parsing live outside the main `orchestrator.rs` turn loop.

### Cross-Cutting Feature: Office File Search

Goal: implement `docs/OFFICE_SEARCH_DESIGN.md` Phase A so the agent can extract and search Office/PDF plaintext without embeddings.

Change targets:

- `apps/desktop/src-tauri/crates/runtime/src/office/**`
- `apps/desktop/src-tauri/crates/runtime/src/{file_ops,pdf_liteparse,lib}.rs`
- `apps/desktop/src-tauri/crates/runtime/Cargo.toml`
- `apps/desktop/src-tauri/crates/tools/src/lib.rs`
- `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs`
- `AGENTS.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `.docx`, `.xlsx`, and `.pptx` `read_file` calls return extracted plaintext through stable line serialization.
- `.pdf` search uses `pdf_liteparse` payload-only extraction so the LiteParse banner is not indexed.
- `office_search` accepts concrete paths or globs, validates `include_ext`, silently drops sensitive-path rejects, returns per-anchor hits, and reports parse failures in `errors`.
- Extraction cache records are path-indexed, content-hash invalidated, schema-versioned, and store OS-native path bytes.
- Office extraction enforces zip/XML/output limits, xlsx snapshot preflight, per-file timeout, per-path in-flight guarding, and a process-wide extraction cap.
- Tool catalog and Copilot prompt guidance advertise `office_search` and remove the old blanket Office `read_file` exception.

### Cross-Cutting Feature: Agentic Workspace Search

Goal: add a Relay-only read-only orchestration layer above `glob_search`,
`grep_search`, `office_search`, and `read_file` style evidence expansion so
vague local lookup requests start with ranked candidates, snippets, searched
scope, and truncation state instead of relying on the model to manually chain
low-level tools.

Change targets:

- `apps/desktop/src-tauri/crates/runtime/src/{file_ops,lib}.rs`
- `apps/desktop/src-tauri/crates/tools/src/lib.rs`
- `apps/desktop/src-tauri/src/agent_loop/{orchestrator,prompt,retry}.rs`
- `apps/desktop/src-tauri/crates/compat-harness/src/lib.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- `workspace_search` is Relay-only and leaves claw-compatible
  `glob_search` / `grep_search` schemas unchanged.
- `workspace_search` returns ranked candidate files, evidence snippets,
  searched/skipped file and byte counts, structured skip reasons, truncation
  state, and an honest not-found / needs-clarification signal.
- Standard ignore directories such as `.git`, `node_modules`, and `target`,
  plus `.gitignore` patterns, are skipped by default, and
  large/plainly unreadable/binary files do not bloat results.
- Existing `glob_search`, `grep_search`, and `office_search` emit baseline
  search telemetry for counts, elapsed time, truncation, and failure surfaces.
- Search roots are constrained to the current workspace; paths or symlink
  resolutions that escape the workspace are not read.
- CDP prompt guidance prefers `workspace_search` for vague implementation,
  related-file, and evidence lookup requests before lower-level follow-up
  searches.
- Deterministic runtime and compat-harness coverage verifies the higher-level
  agentic search scenario.

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
