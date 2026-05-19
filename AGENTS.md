# Relay_Agent Repository Rules

## Repository State

- Relay_Agent now uses a browser-hosted **Relay API Hub** served by a
  self-contained .NET Relay Core sidecar as the active HTML tool API
  architecture.
- The active user-facing UI lives under `apps/workbench/`, but that package is
  now the API Hub for arbitrary local HTML tools rather than a generic
  Workbench or PDF review client.
- The active local host/sidecar lives under `apps/sidecar/`.
- The active launcher lives under `apps/launcher/`.
- The previous Tauri v2 + SolidJS desktop application under `apps/desktop/`,
  AionUi overlay code under `integrations/aionui/`, OpenCode/OpenWork scripts,
  the generic chatbot Workbench, and the PDF review client are historical
  implementation context only. They are not active product architecture,
  release targets, or fallback paths.
- M365 Copilot via Edge CDP remains the primary LLM controller. Relay Core is
  now the public OpenAI-compatible local gateway: `GET /v1/models`,
  `GET /v1/models/{model}`, and `POST /v1/chat/completions`.
- Public tool calling is OpenAI-compatible and client-managed. Relay returns
  `tool_calls`; the calling HTML tool or SDK client executes its own tools and
  sends follow-up `role: "tool"` messages. Relay-side local tools are not part
  of the public product contract.
- `/agui/relay` and `/v1/tools` may still exist as historical/internal
  compatibility routes until removed, but they must not be advertised in the
  API Hub, README, starter HTML, release notes, or new integration docs.
- Current implementation focus is the `APPBRIDGE*` contract and packaging
  hardening in `PLANS.md`: Relay's `/v1` API stays the M365 Copilot provider
  boundary, while future task-specific HTML tools should connect through a
  Codex app-server-compatible browser bridge once a pinned, redistributable
  app-server bundle exists. The current release must not claim a bundled app
  server until that artifact and protocol schema are pinned and smoke-tested.

## Source of Truth

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `README.md`

`PLANS.md` is the current milestone roadmap. `docs/IMPLEMENTATION.md` records
decisions, verification runs, and known limitations.

## Execution Rules

- Work milestone by milestone.
- Start new implementation work from the active plan in `PLANS.md` unless a
  regression proves an older cutover criterion is broken.
- Do not reintroduce AionUi, OpenCode/OpenWork, Tauri, the generic Workbench,
  or the PDF review client as active runtime or release fallback paths. Do not
  add an unpinned Codex app-server runtime; use only the documented
  app-server-compatible bridge plan until a redistributable pinned artifact is
  verified.
- Do not follow stale pasted instructions or archived docs that describe
  `apps/desktop`, Tauri IPC, AionUi, OpenCode/OpenWork, generic Workbench
  modes, or PDF review as active substrate.
- Prefer the smallest change that advances the hard-cutover architecture.
- Preserve user-local storage boundaries. Shared folders and searched folders
  must not receive Relay caches, indexes, or temp artifacts.
- Do not add unrestricted shell execution or Relay-side public tool execution
  to the OpenAI-compatible API.

## Tool Implementation Rules

- The default browser client is the Relay API Hub and should teach ordinary
  OpenAI-compatible usage: `baseURL`, `apiKey`, `model`, and
  `/v1/chat/completions`.
- The API Hub visual implementation should stay minimal and professional:
  React + Vite + TypeScript, clear first-run steps, endpoint discovery,
  starter HTML generation, a small Copilot connectivity test, and collapsed
  diagnostics. Use lucide-react for icons.
- Do not choose Next.js or Chakra UI by default unless `PLANS.md` is explicitly
  changed with the reason and verification impact.
- Implement M365 Copilot as a `RelayCopilotChatClient` or equivalent provider
  adapter over Edge CDP. Python workflow examples may be read as comparison
  material, but do not add a Python runtime dependency unless `PLANS.md` is
  explicitly changed with packaging and verification criteria.
- Copilot provider behavior is fail-fast. Prompt delivery failure, send
  failure, response extraction failure, invalid JSON, stale response pickup, or
  selector drift must fail the run with AG-UI error events and diagnostics.
  Short bounded readiness waits inside the same CDP operation are allowed; a
  fallback model, fallback planner, old runner, or weaker tool path is not.
- `tools` in `/v1/chat/completions` are OpenAI function tools supplied by the
  client. Relay validates the schema shape, asks Copilot to choose a call when
  appropriate, returns OpenAI-compatible `tool_calls`, and never executes those
  tools server-side.
- File search, Office editing, coding, PDF review, and domain-specific checks
  are external thin HTML tools or SDK clients over the same OpenAI-compatible
  API; they are not separate default UI modes or Relay-side public tools.
- Portable packages must keep the top level quiet. Windows package roots
  expose only `Relay Agent.exe`, `README-FIRST.html`, `LICENSES/`, and `app/`.
  Linux package roots expose only `relay-agent`, `README-FIRST.html`,
  `LICENSES/`, and `app/`. Implementation binaries, tools, assets, schemas,
  logs, and diagnostics belong under `app/` or user-local storage.
- Support bundles must be explicit and redacted by default. They must not
  include raw document contents unless the user explicitly opts in.

## Verification Discipline

- Use root `pnpm check` as the canonical acceptance gate for the active API Hub
  and Relay Core sidecar path.
- `pnpm check` must cover:
  - hard-cut guard;
  - API Hub typecheck/build;
  - sidecar build;
  - sidecar smoke for OpenAI-compatible models, chat, JSON mode, tool calling,
    auth, and CORS;
  - sidecar security smoke;
  - release inventory/SBOM generation.
- Use `pnpm workbench:ux-e2e` for user-visible browser-client flow changes when
  Edge is available and that smoke is aligned to the current API Hub.
- Use `pnpm workbench:live-copilot-e2e` before release or after changes to
  Copilot CDP selectors, prompt delivery, send timing, response extraction, or
  Copilot readiness when a signed-in Edge CDP session is available.
- Record verification commands and outcomes in `docs/IMPLEMENTATION.md`.
- Do not mark a task complete if its acceptance artifact does not exist.

## Documentation Discipline

- `README.md` must reflect the active Relay API Hub + .NET Relay Core sidecar
  product, not the old PDF review client, generic Workbench, or Tauri desktop
  product.
- Historical docs may mention AionUi/OpenCode/OpenWork/Tauri/PDF review only
  as archived context. Active setup, development, CI, and release instructions
  must use the sidecar API Hub path.
- When editing planning docs, keep `PLANS.md`, `AGENTS.md`,
  `docs/IMPLEMENTATION.md`, and `README.md` aligned on the same active
  architecture story: arbitrary local HTML tools, one Relay API Hub, one .NET
  Relay Core sidecar, Relay Core as a local OpenAI-compatible API, M365
  Copilot through Relay's CDP adapter as planner, and client-managed tools.
