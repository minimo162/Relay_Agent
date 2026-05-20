# Relay_Agent Completion Plan

Date: 2026-05-20

## Active Architecture

Relay_Agent now has one active product architecture: the **bundled Codex app-server mediation path**.

```text
Relay Bridge Workbench
  -> Relay /bridge/* browser bridge
  -> bundled Codex app server
  -> Relay /v1/responses m365-copilot provider
  -> M365 Copilot via Edge CDP
  -> Codex app-server native local tool loop
```

Relay owns the browser bridge, sidecar supervision, M365 Copilot provider
adapter, app-server approval forwarding, diagnostics, release packaging, and
user-local storage boundaries. The bundled Codex app server owns sessions,
turns, transcript continuity, event streaming, local tools, file operations,
search, shell behavior, and approvals.

The old AionUi overlay, Tauri desktop, OpenWork/OpenCode bootstrap runtime,
API-Hub-first HTML surface, PDF-review product, RelayDocumentSearch engine,
SQLite/FTS search assets, Relay-owned OfficeCLI/PDF tool worker, and
per-feature mode UI are removed or being removed. They are not active runtime,
release, or fallback paths.

## Non-Negotiables

- No transitional fallback architecture.
- No direct `/v1` fallback for normal Workbench turns.
- No public `/v1/tools` product surface.
- No Relay-owned local tool worker behind the Codex app-server bridge.
- No shared-folder Relay cache, index, log, config, or temp artifacts.
- No release claim that app-server support is bundled unless artifact,
  provider, native approval, packaging, and live Copilot gates pass.

## Current State

Completed:

- Pinned `@openai/codex` `0.131.0` app-server artifacts in
  `tools/codex-app-server/manifest.json`.
- Added release fetch/package scripts that place the app server under
  `app/app-server`.
- Added `/bridge/*` session, turn, event, cancel, attachment, and approval
  endpoints.
- Added Relay `/v1/responses` as the app server's `m365-copilot` provider.
- Switched app-server config to `wire_api = "responses"`.
- Removed the Relay-owned app-server tool worker. Relay forwards native
  app-server approval requests and rejects custom dynamic tool calls.
- Added deterministic app-server artifact, bridge, and real-provider smokes.
- Added a current live Copilot canary through Workbench -> app server ->
  `/v1/responses` -> signed-in Edge CDP Copilot.

## Current Cleanup Plan

The repository contained many tracked files from older product directions.
They made the active architecture hard to understand. The cleanup slice removes
those old assets instead of carrying large archives in the active tree.

Keep:

- `apps/workbench/**`
- `apps/sidecar/**`
- `apps/launcher/**`
- `assets/app-icon/**`
- `docs/IMPLEMENTATION.md`
- `docs/app-server/**`
- `tools/codex-app-server/manifest.json`
- active release, launcher, sidecar, bridge, Copilot CDP, and Workbench scripts

Delete:

- `integrations/aionui/**`
- `apps/desktop/**` if it reappears
- `docs/archive/**`
- root-level old design reports under `docs/*.md`, except
  `docs/IMPLEMENTATION.md`
- retired AG-UI runner, DCI, Relay-owned OfficeCLI/PDF, OpenWork/OpenCode,
  Tauri, grounding-fixture, and old project-live smoke scripts
- old examples and fixtures tied to removed workflows

Add or keep guards so `pnpm check` fails if deleted legacy paths are
reintroduced as active assets.

## Remaining Real Work

1. Maintain the `/v1/responses` provider safety contract: Copilot raw text may
   contain UI prose around JSON, but Relay must execute only the first balanced
   JSON object after allow-list and schema validation. Invalid tool names,
   missing required arguments, wrong primitive types, enum mismatches, and
   `additionalProperties:false` violations must fail fast before reaching the
   bundled app server.
2. Expand live Copilot E2E beyond the current canary into representative
   bundled app-server native tool scenarios.
3. Add generated protocol schema drift checks against the pinned app-server
   artifact.
4. Polish Workbench event, approval, and diagnostic rendering around native
   app-server events.
5. Keep release inventory/SBOM and portable-root smokes aligned with the
   bundled app-server package layout.

## Current Safety Remediation

Completed in this slice:

- Hardened `/v1/responses` tool-call argument validation so Relay checks:
  - tool name allow-list;
  - `required`;
  - primitive `type` including `integer`;
  - nested object and array item schemas;
  - `enum`;
  - `additionalProperties:false`.
- Kept balanced JSON extraction for Copilot UI/prose wrappers, but only the
  validated JSON object is converted into app-server Responses output items.
- Added `sidecar:responses-schema-validation-smoke` to prove malformed
  Copilot tool-call arguments fail with `invalid_responses_output`.

## Verification Gate

Before committing implementation work, run:

```bash
pnpm check
git diff --check
```

For Copilot CDP or provider changes, also run:

```bash
pnpm workbench:live-copilot-e2e
```
