# Relay_Agent Execution Tasks

Date: 2026-05-20

## Active Goal

Relay_Agent has one active path:

```text
Relay Bridge Workbench
  -> Relay /bridge/*
  -> bundled Codex app server
  -> Relay /v1/responses m365-copilot provider
  -> M365 Copilot over Edge CDP
```

The bundled app server owns the local agent loop and native tools. Relay owns
only the bridge, provider adapter, supervision, approvals, diagnostics,
packaging, and user-local storage boundaries.

## Current Queue

### REPOCLEAN-01 - Inventory Tracked Legacy Assets

Status: completed

Result:

- Confirmed tracked legacy assets in `integrations/aionui/**`,
  `docs/archive/**`, root-level old design reports, retired AG-UI/DCI/Office
  smoke scripts, old examples, and old test fixtures.
- Confirmed active app-server and Workbench assets that must remain:
  `apps/workbench/**`, `apps/sidecar/**`, `apps/launcher/**`,
  `assets/app-icon/**`, `docs/app-server/**`, and
  `tools/codex-app-server/manifest.json`.

### REPOCLEAN-02 - Remove Active References To Retired Assets

Status: completed

Result:

- Replaced the oversized historical `PLANS.md` and `tasks.md` with concise
  active-source documents.
- Renamed current Workbench smokes away from old `agent:*` naming:
  - `scripts/api-tool-ux-smoke.mjs` -> `scripts/bridge-workbench-surface-smoke.mjs`
  - `scripts/workbench-standard-chat-smoke.mjs` -> `scripts/bridge-workbench-chat-smoke.mjs`
- Removed package scripts for retired AG-UI runner, DCI, Relay-owned
  OfficeCLI/PDF, tool-catalog, grounding-fixture, and stale live project
  smokes.

### REPOCLEAN-03 - Delete Retired Source, Reports, And Smokes

Status: completed

Deleted:

- `integrations/aionui/**`
- `docs/archive/**`
- root-level `docs/*.md` except `docs/IMPLEMENTATION.md`
- retired AG-UI runner, DCI, Relay-owned OfficeCLI/PDF, tool-catalog,
  grounding-fixture, and stale project-live smoke scripts
- old examples and Tetris grounding fixtures tied to removed workflows

Kept:

- active Workbench, sidecar, launcher, release scripts, app icon assets,
  app-server docs/fixtures, and pinned app-server manifest

### REPOCLEAN-04 - Add Stale Asset Guard

Status: completed

Result:

- Extended the hard-cut guard so `pnpm check` fails if tracked legacy asset
  paths are reintroduced:
  - `integrations/aionui/**`
  - `apps/desktop/**`
  - `docs/archive/**`
  - root-level docs other than `docs/IMPLEMENTATION.md`
  - retired OfficeCLI/PDF, AG-UI runner, DCI, OpenWork/OpenCode bootstrap,
    and Tauri smoke assets
- Kept concise historical mentions allowed in `docs/IMPLEMENTATION.md`.

### REPOCLEAN-05 - Verify Cleanup And Record Outcome

Status: completed

Required verification:

```bash
pnpm check
git diff --check
git ls-files 'integrations/**' 'apps/desktop/**' 'docs/archive/**'
git ls-files docs | rg '^docs/[^/]+\\.md$'
git ls-files | rg -i 'aion|tauri|openwork|opencode|relaydocumentsearch|sqlite|fts|officecli|pdf'
```

Acceptance:

- Only active architecture assets remain tracked.
- root-level docs list only `docs/IMPLEMENTATION.md`; app-server docs live
  under `docs/app-server/**`.
- `pnpm check` passes.

## Remaining Product Tasks

### BRIDGEMAIN-11 - Broaden Live Copilot Bridge E2E

Status: in progress

Completed:

- Live canary passed through Workbench, selected workspace, bundled app server,
  `/v1/responses`, signed-in Edge CDP Copilot, and final assistant response.

Remaining:

- Add representative live app-server native file/search/project/approval
  scenarios after the cleanup is complete.

### BRIDGEMAIN-12 - Add App-Server Protocol Drift Checks

Status: pending

Scope:

- Compare Relay's bridge assumptions against the pinned app-server protocol
  artifact.
- Fail `pnpm check` if critical event or request names drift.

### BRIDGEMAIN-13 - Polish Native App-Server Event Rendering

Status: pending

Scope:

- Improve Workbench rendering for native app-server tool, approval, file
  change, error, cancel, and completion events without adding Relay-owned tool
  modes.
