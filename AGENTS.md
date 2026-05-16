# Relay_Agent Repository Rules

## Repository State

- Relay_Agent now uses a browser-hosted local web workbench served by a
  self-contained .NET sidecar as the active product architecture.
- The active user-facing UI lives under `apps/workbench/`.
- The active local host/sidecar lives under `apps/sidecar/`.
- The active launcher lives under `apps/launcher/`.
- The previous Tauri v2 + SolidJS desktop application under `apps/desktop/`,
  AionUi overlay code under `integrations/aionui/`, and OpenCode/OpenWork
  scripts are historical implementation context only. They are not active
  product architecture, release targets, or fallback paths.
- M365 Copilot via Edge CDP remains the primary LLM controller. Microsoft Agent
  Framework is the target backend agent runtime inside the .NET sidecar. Relay
  owns the M365 Copilot provider adapter, local tool validation, execution,
  approvals, backups, diffs, logs, and app storage.
- The active generic tool catalog is `rg_files`, `rg_search`, `read`,
  `officecli`, `edit`, `write`, `workspace_status`, `diff`, `run_command`,
  and `ask_user`. Final answers are normal Agent Framework assistant responses,
  not a Relay tool.
- Current implementation focus is the review remediation plan in `PLANS.md`:
  Microsoft Agent Framework backend adoption, AG-UI full adoption for the
  Workbench-facing UX/event contract, fail-fast Copilot provider behavior,
  Office/PDF `read` extraction, semantic OfficeCLI operations, generic
  workspace/diff/verification tools, explicit redacted support-bundle export,
  ripgrep streaming/capping, `rg_search` argument hardening, and Workbench
  official `/agui/relay` execution with AG-UI client-tool approvals.

## Source of Truth

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `README.md`

`PLANS.md` is the current milestone roadmap. `docs/IMPLEMENTATION.md` records
decisions, verification runs, and known limitations.

## Execution Rules

- Work milestone by milestone.
- Start new implementation work from the **Current Review Remediation Plan** in
  `PLANS.md` unless a regression proves an older cutover criterion is broken.
- Do not reintroduce AionUi, OpenCode/OpenWork, Codex app-server, or Tauri as
  active runtime or release fallback paths.
- Do not follow stale pasted instructions or archived docs that describe
  `apps/desktop`, Tauri IPC, AionUi, or OpenCode/OpenWork as active substrate.
- Prefer the smallest change that advances the hard-cutover architecture.
- Preserve user-local storage boundaries. Shared folders and searched folders
  must not receive Relay caches, indexes, or temp artifacts.
- Any mutation to Office or code must go through Relay validation and explicit
  user approval.
- Do not add unrestricted shell execution to the default tool catalog.

## Tool Implementation Rules

- AG-UI is the target Workbench-facing protocol and UX model. New run UI work
  should emit/consume AG-UI lifecycle, message, tool, state, interrupt/resume,
  error, and completion events through `/agui/relay` instead of extending or
  reviving the custom Relay run routes.
- The Workbench visual implementation should follow AG-UI/CopilotKit/Dojo
  agent UI interaction patterns while preserving Relay's minimal professional
  surface. The target frontend stack is React + Vite + TypeScript + Tailwind
  CSS + shadcn/ui + Radix UI + `@ag-ui/client`, with lucide-react for icons.
  Do not choose Next.js or Chakra UI by default unless `PLANS.md` is explicitly
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
- `rg_files` and `rg_search` are generic local exploration tools. Push filters
  into ripgrep where possible, stream/cap output before buffering, and keep
  workspace containment, timeout, cancellation, and result caps enforced by
  Relay.
- `rg_search` must pass a `--` separator before the pattern so user/model
  patterns beginning with `-` cannot become ripgrep options.
- `read` must support exact file reads for plaintext/code and Relay-supported
  Office/PDF extraction. Do not revive `RelayDocumentSearch*`, SQLite/FTS, or
  per-mode document-search engines to satisfy Office/PDF reads.
- `officecli` must be exposed through Relay-owned semantic operations compiled
  to argv by Relay. Do not let Copilot provide arbitrary OfficeCLI command
  arrays directly. Office mutations need backup, approval, and post-apply
  verification.
- `edit` and `write` must stay workspace-scoped, approval-gated for mutations,
  and auditable through run events and backup/diff artifacts.
- `workspace_status` and `diff` are generic read-only review tools. Use them to
  expose dirty state, changed paths, pending mutations, and applied changes
  before final answers.
- `run_command` is a bounded verification tool, not unrestricted shell. It must
  use structured argv, workspace containment, timeout/output caps,
  cancellation, and deny rules for destructive, network, package-install,
  secret-reading, or cross-workspace behavior unless the user explicitly
  approves a narrowly displayed command.
- File search, Office editing, and coding are common recipes over the generic
  tool catalog, not separate UX modes or separate backend runners.
- Support bundles must be explicit and redacted by default. They must not
  include raw document contents unless the user explicitly opts in.

## Verification Discipline

- Use root `pnpm check` as the canonical acceptance gate for the active
  sidecar/workbench path.
- `pnpm check` must cover:
  - hard-cut guard;
  - Workbench typecheck/build;
  - sidecar build;
  - sidecar smoke;
  - official AG-UI agent golden smoke for search, Office, coding, generic
    verification, approvals, and fail-fast invalid output;
  - official AG-UI client-tool approval smoke for read-only execution,
    mutation approval, rejection, and resume;
  - sidecar security smoke;
  - release inventory/SBOM generation.
- Use `pnpm workbench:ux-e2e` for user-visible Workbench flow changes when
  Edge is available.
- Use `pnpm workbench:live-copilot-e2e` before release or after changes to
  Copilot CDP selectors, prompt delivery, send timing, response extraction, or
  Copilot readiness when a signed-in Edge CDP session is available.
- Record verification commands and outcomes in `docs/IMPLEMENTATION.md`.
- Do not mark a task complete if its acceptance artifact does not exist.

## Documentation Discipline

- `README.md` must reflect the active browser Workbench + .NET sidecar product,
  not the old Tauri desktop product.
- Historical docs may mention AionUi/OpenCode/OpenWork/Tauri only as archived
  context. Active setup, development, CI, and release instructions must use the
  sidecar workbench path.
- When editing planning docs, keep `PLANS.md`, `AGENTS.md`,
  `docs/IMPLEMENTATION.md`, and `README.md` aligned on the same active
  architecture story: one browser Workbench, one .NET sidecar, Microsoft Agent
  Framework as backend runtime, M365 Copilot through Relay's CDP adapter as
  planner, and Relay as local tool governance/execution layer.
