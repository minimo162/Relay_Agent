# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is a **conversation-first Tauri desktop agent** under `apps/desktop/`.

- Frontend: SolidJS + Vite desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with internal crates under `crates/{api,runtime,tools,commands,compat-harness}`.
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
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Acceptance and smoke commands:

```bash
pnpm launch:test
pnpm agent-loop:test
pnpm smoke:windows
pnpm doctor -- --json
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p compat-harness
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

### Phase 4: CI And Acceptance Alignment

Goal: make CI enforce the repo’s actual acceptance criteria on both Linux and Windows.

Change targets:

- `.github/workflows/ci.yml`
- `package.json`
- `apps/desktop/package.json`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Main CI runs on `ubuntu-latest` and `windows-latest`.
- Ubuntu executes bundled-node prep, Tauri system dependencies, `cargo check`, `cargo clippy -- -D warnings`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, `pnpm launch:test`, and `pnpm agent-loop:test`.
- Windows executes bundled-node prep, `cargo check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, and `pnpm smoke:windows`.
- CI also guards the live docs map against stale removed-package or spreadsheet-era references.

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
