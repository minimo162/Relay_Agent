# Relay_Agent Repository Rules

## Repository State

- Relay_Agent now targets a browser-hosted local web Workbench served by a
  self-contained .NET sidecar and mediated by a bundled Codex app-server
  bridge.
- The active user-facing UI lives under `apps/workbench/` and should present
  the **Relay Bridge Workbench**, not an API-Hub-first page, PDF review client,
  or mode-specific desktop workbench.
- The active local host/sidecar lives under `apps/sidecar/`.
- The active launcher lives under `apps/launcher/`.
- The previous Tauri v2 + SolidJS desktop application under `apps/desktop/`,
  AionUi overlay code under `integrations/aionui/`, OpenCode/OpenWork scripts,
  the API-Hub-first HTML tool surface, the generic chatbot Workbench, and the
  PDF review client are historical implementation context only. They are not
  active product architecture, release targets, or fallback paths.
- M365 Copilot via Edge CDP remains the primary LLM controller. Relay Core's
  OpenAI-compatible `/v1` API is the lower-level `m365-copilot` provider used
  by the bundled app server, not the primary first-time user integration path.
- Relay owns the M365 Copilot provider adapter, app-server supervision,
  browser bridge, native approval forwarding, support bundles, and user-local
  storage. The bundled app server owns sessions, turns, event streaming,
  transcript continuity, and the native local agent/tool loop.
- Current implementation focus is the `BRIDGEMAIN*` queue in `tasks.md`, on
  top of the broader `BRIDGEGAP*` roadmap in `PLANS.md`:
  artifact pinning, license/schema evidence, provider compatibility,
  user-local app-server home/config, hardened supervisor and stdio JSONL
  binding, browser bridge endpoints, native app-server approval forwarding,
  default chatbot HTML client over `/bridge/*`, packaging, and live Copilot
  E2E.

## Source of Truth

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `README.md`

`PLANS.md` is the current milestone roadmap. `docs/IMPLEMENTATION.md` records
decisions, verification runs, and known limitations.

## Execution Rules

- Work milestone by milestone.
- Start new implementation work from the active `BRIDGEMAIN*` queue in
  `tasks.md` unless a regression proves an older acceptance criterion is
  broken.
- Do not reintroduce AionUi, OpenCode/OpenWork, Tauri, the API-Hub-first HTML
  tool path, generic Workbench modes, or PDF review as active runtime or
  release fallback paths.
- Do not remove or bypass `CodexAppServerBridgeService`, `/bridge/*`, the
  fixture app server, or `sidecar:app-server-bridge-smoke`; they are the active
  bridge starting point.
- Do not claim a fully bundled app-server runtime until the pinned artifact,
  license inventory, schema bundle, provider compatibility, tool loop,
  approval flow, package inventory, and live Copilot E2E gates pass.
- Prefer the smallest change that advances the hard-cutover architecture.
- Preserve user-local storage boundaries. Shared folders and searched folders
  must not receive Relay caches, indexes, logs, or temp artifacts.
- Do not add unrestricted shell execution to the default tool catalog.

## Tool Implementation Rules

- Browser clients should use the Relay browser bridge (`/bridge/*`) as their
  normal path. `/v1/responses` is the app server's provider boundary.
  Direct `/v1/chat/completions` is retained only as a lower-level developer
  diagnostic compatibility surface.
- Use the bundled Codex app server as the harness boundary for sessions,
  turns, event streams, transcript continuity, tool-call loops, approvals, and
  diagnostics where possible. Do not rebuild those concepts as independent
  Relay-specific product modes.
- The Workbench visual implementation should be a minimal, professional
  browser bridge surface. The target frontend stack remains React + Vite +
  TypeScript + Tailwind CSS + shadcn/ui/Radix-compatible primitives, with
  lucide-react for icons. Do not choose Next.js or Chakra UI by default unless
  `PLANS.md` is explicitly changed with the reason and verification impact.
- Use Microsoft Agent Framework and AG-UI as reference/compatibility surfaces
  only where they still help existing implementation. They are no longer the
  sole active runtime target.
- Implement M365 Copilot as a `RelayCopilotChatClient` or equivalent provider
  adapter over Edge CDP. Python examples may be read as comparison material,
  but do not add a Python runtime dependency unless `PLANS.md` is explicitly
  changed with packaging and verification criteria.
- Copilot provider behavior is fail-fast. Prompt delivery failure, send
  failure, response extraction failure, invalid JSON, stale response pickup, or
  selector drift must fail the run with structured diagnostics. Short bounded
  readiness waits inside the same CDP operation are allowed; a fallback model,
  fallback planner, old runner, or weaker tool path is not.
- Do not implement a Relay-owned generic local tool worker for app-server
  turns. `glob`, `grep`, `read`, Office/PDF extraction, OfficeCLI, edit/write,
  patch, and shell execution belong to the bundled Codex app-server native
  harness unless a future plan explicitly adopts an upstream-compatible
  dynamic tool/MCP package.
- Relay forwards official app-server approval requests such as command
  execution, file changes, and permission grants. Relay must not transform
  those requests into its own legacy tool protocol or publish Relay tool
  observations.
- Custom `item/tool/call` dynamic tool requests are rejected fail-fast in the
  current architecture so accidental Relay custom-tool revival is visible.
- File search, Office editing, coding, PDF review, and verification are common
  app-server-native workflows, not separate UX modes, separate backend
  runners, or Relay-owned tool recipes.
- Support bundles must be explicit and redacted by default. They must not
  include raw document contents unless the user explicitly opts in.

## Verification Discipline

- Use root `pnpm check` as the canonical acceptance gate for the active
  sidecar/workbench path.
- `pnpm check` must cover:
  - hard-cut guard;
  - Workbench typecheck/build;
  - sidecar build;
  - sidecar smoke for the lower-level OpenAI-compatible provider;
  - Codex app-server bridge smoke;
  - sidecar security smoke;
  - release inventory/SBOM generation.
- Use `pnpm workbench:ux-e2e` for user-visible Workbench flow changes when
  Edge is available and the smoke is aligned to the current Bridge Workbench.
- Use `pnpm workbench:live-copilot-e2e` before release or after changes to
  Copilot CDP selectors, prompt delivery, send timing, response extraction, or
  Copilot readiness when a signed-in Edge CDP session is available.
- Record verification commands and outcomes in `docs/IMPLEMENTATION.md`.
- Do not mark a task complete if its acceptance artifact does not exist.

## Documentation Discipline

- `README.md` must reflect the active browser Bridge Workbench + .NET sidecar
  product, not the old Tauri desktop product, PDF review client, generic
  Workbench, or API-Hub-first product.
- Historical docs may mention AionUi/OpenCode/OpenWork/Tauri/PDF review only
  as archived context. Active setup, development, CI, and release instructions
  must use the sidecar bridge path.
- When editing planning docs, keep `PLANS.md`, `AGENTS.md`,
  `docs/IMPLEMENTATION.md`, and `README.md` aligned on the same active
  architecture story: one browser Bridge Workbench, one .NET sidecar, bundled
  Codex app server as the harness/tool boundary, Relay `/v1` as the
  M365-Copilot-backed provider, and Relay as bridge/supervisor/approval
  forwarding layer.
