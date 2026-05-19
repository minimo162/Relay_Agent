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
- M365 Copilot via Edge CDP remains the primary LLM controller. Microsoft Agent
  Framework is the backend agent runtime inside the .NET sidecar. Relay owns
  the M365 Copilot provider adapter, local tool validation, execution,
  approvals, backups, diffs, logs, and app storage.
- The active generic tool catalog is `glob`, `grep`, `read`, `officecli`,
  `officecli_mutate`, `edit`, `write`, `patch`, `workspace_status`, `diff`,
  `bash`, and `ask_user`. Final answers are normal Agent Framework assistant
  responses, not a Relay tool.
- Current implementation focus is the HTMLTOOL/COREAPI cutover in `PLANS.md`:
  Relay Core exposes stable localhost APIs for arbitrary HTML tools, including
  `/v1/relay/manifest`, `/v1/chat/completions`, `/agui/relay`, `/v1/tools`,
  `/v1/copilot/session`, `/health`, and explicit redacted support bundles.

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
- Do not reintroduce AionUi, OpenCode/OpenWork, Codex app-server, Tauri, the
  generic Workbench, or the PDF review client as active runtime or release
  fallback paths.
- Do not follow stale pasted instructions or archived docs that describe
  `apps/desktop`, Tauri IPC, AionUi, OpenCode/OpenWork, generic Workbench
  modes, or PDF review as active substrate.
- Prefer the smallest change that advances the hard-cutover architecture.
- Preserve user-local storage boundaries. Shared folders and searched folders
  must not receive Relay caches, indexes, or temp artifacts.
- Any mutation to Office or code must go through Relay validation and explicit
  user approval.
- Do not add unrestricted shell execution to the default tool catalog.

## Tool Implementation Rules

- AG-UI remains the backend run/event/approval protocol through `/agui/relay`.
  The default browser client is the Relay API Hub and should call stable Relay
  Core APIs rather than owning tool execution or CDP logic.
- The API Hub visual implementation should stay minimal and professional:
  React + Vite + TypeScript, clear first-run steps, endpoint discovery,
  starter HTML generation, a small Copilot connectivity test, and collapsed
  diagnostics. Use lucide-react for icons.
- Do not choose Next.js or Chakra UI by default unless `PLANS.md` is explicitly
  changed with the reason and verification impact.
- Use Microsoft Agent Framework in the .NET sidecar as the production backend
  agent runtime while adopting AG-UI. Implement M365 Copilot as a
  `RelayCopilotChatClient` or equivalent Agent Framework-compatible provider
  adapter over Edge CDP. Python workflow examples may be read as comparison
  material, but do not add a Python runtime dependency unless `PLANS.md` is
  explicitly changed with packaging and verification criteria.
- Copilot provider behavior is fail-fast. Prompt delivery failure, send
  failure, response extraction failure, invalid JSON, stale response pickup, or
  selector drift must fail the run with AG-UI error events and diagnostics.
  Short bounded readiness waits inside the same CDP operation are allowed; a
  fallback model, fallback planner, old runner, or weaker tool path is not.
- `glob` and `grep` are generic local exploration tools backed by ripgrep.
  Push filters into ripgrep where possible, stream/cap output before buffering,
  and keep workspace containment, timeout, cancellation, and result caps
  enforced by Relay.
- `grep` must pass a `--` separator before the pattern so user/model patterns
  beginning with `-` cannot become ripgrep options.
- `read` must support exact file reads for plaintext/code and Relay-supported
  Office/PDF extraction. Do not revive `RelayDocumentSearch*`, SQLite/FTS, or
  per-mode document-search engines to satisfy Office/PDF reads.
- `officecli` must be exposed through Relay-owned semantic operations compiled
  to argv by Relay. Do not let Copilot provide arbitrary OfficeCLI command
  arrays directly. Office mutations need backup, approval, and post-apply
  verification.
- `edit`, `write`, and `patch` must stay workspace-scoped, approval-gated for
  mutations, and auditable through run events and backup/diff artifacts.
- `workspace_status` and `diff` are generic read-only review tools. Use them to
  expose dirty state, changed paths, pending mutations, and applied changes
  before final answers.
- `bash` is a bounded verification permission category, not unrestricted shell.
  It must use structured argv, workspace containment, timeout/output caps,
  cancellation, and deny rules for destructive, network, package-install,
  secret-reading, or cross-workspace behavior unless the user explicitly
  approves a narrowly displayed command.
- File search, Office editing, coding, PDF review, and domain-specific checks
  are thin HTML tools or recipes over the same generic API and tool catalog;
  they are not separate default UI modes in Relay.
- Support bundles must be explicit and redacted by default. They must not
  include raw document contents unless the user explicitly opts in.

## Verification Discipline

- Use root `pnpm check` as the canonical acceptance gate for the active API Hub
  and Relay Core sidecar path.
- `pnpm check` must cover:
  - hard-cut guard;
  - API Hub typecheck/build;
  - sidecar build;
  - sidecar smoke;
  - official AG-UI agent golden smoke for search, Office, coding, generic
    verification, approvals, and fail-fast invalid output;
  - official AG-UI client-tool approval smoke for read-only execution,
    mutation approval, rejection, and resume;
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
  Relay Core sidecar, Microsoft Agent Framework as backend runtime, M365
  Copilot through Relay's CDP adapter as planner, and Relay as local tool
  governance/execution layer.
