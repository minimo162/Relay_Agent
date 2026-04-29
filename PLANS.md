# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is now an **OpenAI-compatible M365 Copilot provider gateway** for
OpenCode/OpenWork. The historical Tauri desktop shell remains under
`apps/desktop/` only for provider launch support, diagnostics, and live Copilot
verification.

- Primary UX and execution: OpenCode/OpenWork.
- Provider gateway: `apps/desktop/src-tauri/binaries/copilot_server.js`.
- Frontend: SolidJS + Vite diagnostic desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with `crates/desktop-core` as the
  only active internal crate. Historical `runtime` / `tools` /
  `compat-harness` crates and the unused legacy `api` crate have been
  physically removed as part of the OpenCode/OpenWork hard cut.
- Primary LLM path: M365 Copilot via Edge CDP and the Relay provider gateway.
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
  transcript and runtime behavior. Relay-specific defaults live in the provider
  gateway and diagnostic desktop adapter/config modules.
- `.taskmaster/tasks/tasks.json` must reflect real artifact state, not historical intent.

## Delivery Priorities

- Priority A: keep M365 Copilot via Edge CDP as the primary LLM surface.
- Priority B: keep OpenCode/OpenWork as the external OSS owner for UX,
  sessions, tools, permissions, events, MCP, plugins, skills, and workspace
  runtime behavior.
- Priority C: keep Relay-specific code focused on the OpenAI-compatible
  provider gateway, Copilot CDP transport, tool-call normalization, and
  diagnostics.

## Strategic Reset: OpenCode/OpenWork Provider Gateway

The active architecture direction is a hard cut, not a compatibility migration:
Relay_Agent becomes the adapter between M365 Copilot CDP and OpenCode/OpenWork.
OpenCode/OpenWork owns UX and execution; Copilot owns the LLM surface; Relay
owns the M365 Copilot provider gateway and diagnostics.

Detailed plan: `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`.

Implications:

- Do not add new production features to the Relay-owned Rust execution runtime.
- Do not preserve legacy tool/runtime/session contracts for compatibility.
- Do not reintroduce `office_search` as a model-facing tool.
- Do not treat the Copilot browser thread as the execution source of truth.
- New runtime work should target OpenCode/OpenWork APIs or extension points.

## Completed Task: OpenWork/OpenCode First-Run Bootstrap Feasibility

Goal: check whether Relay can offer a first-run OpenWork/OpenCode download
flow while preserving the provider-only hard cut.

Status 2026-04-26: feasible with guardrails. The selected Windows x64 MVP is a
managed external install/download flow: Relay downloads and verifies OpenWork
Desktop as the UX owner, downloads and verifies the OpenCode CLI for provider
config installation/diagnostics/direct fallback, and keeps Relay limited to the
M365 Copilot OpenAI-compatible provider gateway plus launcher/handoff
diagnostics.

Key findings:

- OpenCode `v1.14.25` has MIT licensing, GitHub release CLI zip assets with
  SHA256 digests, and the `opencode-ai` NPM package with bin `opencode`.
- OpenWork `v0.11.212` has a Windows x64 desktop MSI release asset with a
  SHA256 digest, and `openwork-orchestrator@0.11.212` is a small NPM shim for
  platform binaries.
- OpenWork's root license is MIT outside `/ee`, while `/ee` is separately Fair
  Source licensed; production auto-install needs explicit artifact/license
  review.
- OpenWork currently pins `opencodeVersion` to `v1.4.9`, so the bootstrap
  manifest must pin a tested compatible pair instead of independently floating
  latest OpenWork and latest OpenCode.

Acceptance criteria:

- Upstream OpenCode release, NPM package, Windows asset, digest, and license
  are identified.
- Upstream OpenWork desktop release, orchestrator package, Windows asset,
  digest, and license caveats are identified.
- A first manifest shape and follow-up implementation tasks are documented.
- Relay ownership boundaries stay provider-only; no bundled runtime sidecar or
  Relay-owned execution path is reintroduced.

Detailed plan: `docs/OPENWORK_OPENCODE_BOOTSTRAP_PLAN.md`.

## Completed Task: Pinned OpenWork/OpenCode Bootstrap Manifest

Goal: add the first source-controlled manifest for a managed first-run
OpenWork/OpenCode download path.

Status 2026-04-27: implemented for Windows x64. The manifest pins OpenWork
Desktop `0.11.212` and OpenCode CLI `1.14.25` with exact release URLs, sizes,
SHA256 digests, entrypoints, and license/installation caveats. The provider
check now runs a manifest validation test, and the hard-cut guard requires the
bootstrap manifest while still rejecting bundled runtime sidecar or Relay-owned
tool-execution markers.

Acceptance criteria:

- The manifest pins exact Windows x64 OpenWork Desktop and OpenCode CLI
  artifacts.
- Each artifact includes version, kind, format, URL, SHA256, size, entrypoint,
  and license notes.
- Manifest validation is part of `check:opencode-provider`.
- The hard-cut guard allows the bootstrap manifest but continues to reject
  `opencode-runtime` resource bundling and Relay-owned execution markers.

## Completed Task: Bootstrap Downloader And Verifier

Goal: implement the local download/verify cache for the pinned bootstrap
manifest without installing or launching OpenWork/OpenCode yet.

Status 2026-04-27: implemented in `openwork_bootstrap.rs`. The module loads the
pinned manifest, derives an app-local versioned cache path, reuses existing
verified artifacts, downloads missing artifacts to a temporary file, verifies
size and SHA256, and persists only verified files. It returns structured error
codes for network, HTTP status, checksum, size, filesystem, manifest, unsafe
filename, and unsupported-platform failures.

Acceptance criteria:

- Downloads are stored under app-local data, not under Tauri resources.
- Partial downloads use an atomic temp-file path and are cleaned up on failure.
- Size and SHA256 are verified before an artifact is marked installed.
- Existing verified artifacts are reused.
- Diagnostics distinguish network, checksum, size, filesystem, and unsupported
  platform failures.

## Completed Task: OpenCode CLI Config Smoke

Goal: exercise the pinned OpenCode CLI artifact path enough to prove the
manifest and cache contract can support provider config setup before any
OpenWork installer work begins.

Status 2026-04-27: implemented as a CI-safe smoke with a fake bootstrapped
`opencode.exe`. The smoke derives the expected bootstrapped entrypoint path,
probes it with `--version`, passes it to the provider config installer, and
confirms a temp workspace receives the Relay provider config without invoking
any OpenCode-owned tool execution.

Acceptance criteria:

- The bootstrap module can identify the pinned OpenCode CLI artifact from the
  manifest.
- A test or smoke fixture can verify an extracted `opencode.exe` path and run a
  version/config-read probe without requiring a real OpenWork desktop install.
- The provider config installer can target a temp workspace using the
  bootstrapped OpenCode path.
- No OpenCode-owned tool execution is invoked by Relay.

## Completed Task: OpenWork Desktop Install/Launch Smoke

Goal: define and implement a safe first OpenWork Desktop handoff smoke for the
pinned Windows MSI path without silent install or OpenCode tool execution.

Status 2026-04-27: implemented as a CI-safe diagnostic handoff smoke. The smoke
validates the pinned OpenWork Desktop MSI manifest entry, creates a placeholder
at the expected app-local cache path, reports detection state without launching
OpenWork, and emits provider gateway handoff details for a later real Windows
run.

Acceptance criteria:

- The bootstrap layer can identify and verify the pinned OpenWork Desktop MSI.
- The smoke stops before silent installation unless explicitly approved by the
  operator or uses a non-installing launch/detection fixture.
- OpenWork detection/launch status is represented as diagnostics, not as Relay
  owning the UX.
- Provider gateway URL and API-key handoff expectations are recorded for the
  eventual real Windows run.

## Completed Task: Live Windows OpenWork/OpenCode Bootstrap E2E Smoke Preflight

Goal: run the bootstrap path on a clean Windows environment with real
downloaded artifacts and a signed-in M365 Copilot provider session.

Status 2026-04-29: original B06 preflight and runbook were prepared, then
superseded by B12 after the headless bootstrap command, provider gateway
startup, and Relay desktop UX removal landed. The actual live Windows
acceptance run is tracked only by B12 now.

Acceptance criteria:

- Relay downloads and verifies the pinned OpenCode CLI zip and OpenWork Desktop
  MSI using the manifest digests.
- The operator explicitly approves or manually opens the OpenWork installer;
  Relay does not silently install.
- OpenWork/OpenCode receives the Relay provider config and API-key handoff.
- A provider text turn and an OpenCode-owned `read` tool turn pass through
  M365 Copilot.
- The artifact paths, versions, run logs, and any manual operator steps are
  recorded in `docs/IMPLEMENTATION.md` through B12.

## Completed Task: Headless OpenWork/OpenCode Bootstrap Command

Goal: make OpenWork/OpenCode first-run setup runnable without the Relay desktop
chat UX. Relay should behave as a bootstrapper and M365 Copilot provider
gateway only.

Status 2026-04-29: implemented as `relay-openwork-bootstrap`. The command
prints structured JSON diagnostics, supports a non-destructive preflight mode,
and downloads/verifies the pinned artifacts only when `--download` is supplied.
The root `pnpm bootstrap:openwork-opencode` script exposes the command, and the
headless smoke verifies the command without downloading artifacts.

Acceptance criteria:

- A headless bootstrap command downloads and verifies the pinned OpenCode CLI
  zip and OpenWork Desktop MSI from the manifest.
- Verified artifacts are stored under app-local data and reused on later runs.
- OpenCode is extracted, probed with `--version`, and receives Relay's
  OpenAI-compatible provider config for the target workspace.
- OpenWork Desktop MSI handoff remains explicit-user-approved; Relay does not
  silently install it by default.
- The bootstrap returns provider gateway handoff details: base URL, model, and
  API-key environment variable.
- The implementation does not reintroduce Relay-owned chat, session, transcript,
  tool execution, or OpenCode runtime sidecar ownership.

## Completed Task: Automate OpenCode Extraction And Provider Config Handoff

Goal: extend the headless bootstrap path so the verified OpenCode zip is
extracted into the app-local cache, the `opencode.exe` entrypoint is probed,
and Relay's OpenAI-compatible M365 Copilot provider config is installed into
the target OpenCode/OpenWork workspace.

Status 2026-04-29: implemented in the bootstrap layer and
`relay-openwork-bootstrap`. Verified OpenCode zip artifacts can now be safely
extracted with path traversal and symlink rejection, the extracted entrypoint
can be probed with `--version`, and passing `--workspace` writes/merges
Relay's OpenAI-compatible provider config into the target workspace after the
OpenCode probe succeeds.

Acceptance criteria:

- The bootstrap command can extract the verified OpenCode zip without trusting
  unsafe archive paths.
- The extracted `opencode.exe` path is probed with `--version`.
- The target workspace receives Relay's provider config through the existing
  config merge path.
- The smoke remains non-destructive and does not execute OpenCode-owned tools.
- Relay still does not own OpenCode session state, transcript, or tool
  execution.

## Completed Task: Explicit OpenWork Installer Approval Handoff

Goal: extend the headless bootstrap path so the verified OpenWork Desktop MSI
can be opened only after explicit operator approval, while preserving Relay as
a bootstrapper/provider gateway and leaving OpenWork as the UX owner.

Status 2026-04-29: implemented in `relay-openwork-bootstrap`. The command now
reports a dedicated `openworkInstallerHandoff` block with the pinned MSI path,
version, SHA256, install mode, and `msiexec /i` command. The default path is
non-destructive and reports `operator_approval_required`; the installer is only
opened when `--open-openwork-installer` is explicitly supplied and the MSI is
already verified.

Acceptance criteria:

- The bootstrap command reports the verified OpenWork MSI path, version,
  SHA256, and install mode.
- Opening the installer requires an explicit flag or operator action.
- The default path remains non-silent install handoff.
- Diagnostics record the operator-approved handoff without marking Relay as the
  OpenWork UX or installer owner.
- CI smoke remains non-destructive.

## Completed Task: Start Relay Provider Gateway From Bootstrap

Goal: add a bootstrap-managed provider gateway startup path so first-run setup
can return live provider endpoint details without requiring the Relay desktop
UX.

Status 2026-04-29: implemented in `relay-openwork-bootstrap`. The command now
creates or locates the Relay provider token, reports provider gateway state,
and starts `copilot_server.js` when `--start-provider-gateway` is explicitly
supplied. The smoke starts the gateway on a random local port, verifies
`/health` and authenticated `/v1/models`, and terminates the process.

Acceptance criteria:

- The bootstrap command can create or locate the Relay API key.
- The OpenAI-compatible provider gateway can be started or verified as running.
- The report returns base URL, model, and API-key handoff details.
- The gateway path remains provider-only and does not own OpenCode/OpenWork
  sessions, transcripts, tools, or execution.

## Completed Task: Remove Relay Desktop UX From Production Path

Goal: remove or isolate the remaining Relay desktop chat shell so production
first-run starts with headless OpenWork/OpenCode bootstrap plus provider
gateway handoff.

Status 2026-04-29: implemented. Root `pnpm dev` now runs the headless
bootstrap preflight instead of the desktop frontend. Tauri/Solid launch scripts
are exposed only as `diag:*` commands, the diagnostic shell displays
bootstrap-first commands, and docs/hard-cut guards reject returning the Relay
desktop UX to the primary product path.

Acceptance criteria:

- Production guidance starts with `bootstrap:openwork-opencode` and
  OpenWork/OpenCode, not Relay desktop chat.
- The Solid/Tauri shell is removed from the production path or retained only
  behind diagnostic commands.
- Packaging and hard-cut guards reject reintroducing Relay-owned chat/session
  UX.
- OpenWork/OpenCode remains the UX, session, tool, permission, and execution
  owner.

## Next Task: Run Post-UX-Removal Windows Bootstrap E2E

Goal: run the clean Windows bootstrap path after Relay desktop UX isolation.
Confirm the bootstrap downloads/verifies OpenCode/OpenWork, writes the Relay
provider config, starts the provider gateway, hands off the OpenWork installer
only after explicit approval, and completes provider text plus OpenCode-owned
read-tool turns through M365 Copilot.

Acceptance criteria:

- The run starts from `pnpm bootstrap:openwork-opencode`, not the Relay
  diagnostic desktop shell.
- Verified OpenCode/OpenWork artifact paths, versions, and SHA256 values are
  recorded.
- The provider endpoint, model, and API-key handoff are recorded.
- OpenCode/OpenWork owns the live UX and tool execution during the acceptance
  turns.
- Results are appended to `docs/IMPLEMENTATION.md`.

Status 2026-04-29: readiness gate implemented locally. The
`live:windows:openwork-bootstrap` preflight now verifies the post-UX-removal
entrypoint, confirms `pnpm dev` is bootstrap-first, confirms desktop
`tauri:dev` has not returned as a primary script, and runs the Rust bootstrap
preflight. The live Windows/M365 acceptance run remains pending on a clean
Windows host.

## Completed Task: Packaged Desktop Diagnostic Build Verification

Goal: verify that the desktop diagnostic shell still builds as a packaged Tauri
app after removing the bundled OpenCode runtime sidecar. The package should
retain provider/diagnostic resources and sidecars while omitting
`opencode-runtime`.

Status 2026-04-26: passed on Linux. `pnpm --filter @relay-agent/desktop
tauri:build` produced `.deb`, `.rpm`, and `.AppImage` bundles. Inspection of
the `.deb` found no `opencode-runtime` entries and confirmed the expected
LiteParse runner, sample CSV, `relay-node`, and `relay-rg` assets.

Acceptance criteria:

- `pnpm --filter @relay-agent/desktop tauri:build` completes successfully.
- The generated `.deb` does not include `opencode-runtime`.
- The generated `.deb` still includes LiteParse runner files, the bundled
  sample CSV, and Tauri external binaries `relay-node` / `relay-rg`.
- The result is recorded in `docs/IMPLEMENTATION.md`.

## Completed Task: Windows Installer Release Workflow Smoke

Goal: verify the GitHub-hosted Windows installer release workflow can build and
publish the NSIS installer through the unsigned prerelease smoke path after the
OpenCode/OpenWork hard cut.

Status 2026-04-26: passed. Workflow run `24952036759` built the Windows NSIS
installer from `main` at `d340b56b7a283c311cfee54b68c12accd23dfce9`, skipped
Trusted Signing as expected for `unsigned-prerelease`, and published
`Relay.Agent_0.1.0_x64-setup-unsigned.exe` to the prerelease
`v0.0.0-release-smoke-20260426081655`.

Acceptance criteria:

- `release-windows-installer.yml` can be dispatched manually from `main` with a
  prerelease smoke tag.
- The Windows job passes typecheck, Rust tests, doctor CLI tests, and NSIS
  bundle generation.
- Trusted Signing steps are skipped only because the dispatch uses the
  unsigned prerelease path.
- GitHub Releases contains the uploaded installer asset and workflow summary
  includes the installer SHA256.
- The result is recorded in `docs/IMPLEMENTATION.md`.

## Completed Task: Live M365 OpenCode Provider Smoke

Goal: verify the current hard-cut product path against a real M365 Copilot CDP
session after Relay stopped owning desktop UX and execution. The validation
must pass through OpenCode/OpenWork using Relay only as the OpenAI-compatible
M365 Copilot provider gateway.

Status 2026-04-26: passed with artifact directory
`/tmp/relay-live-m365-opencode-provider-f22aLj`. The smoke confirmed provider
status was connected with `loginRequired: false`, OpenCode received
`OPEN_CODE_M365_PROVIDER_OK` for a plain text request, and OpenCode completed a
`read` tool turn before returning `OPEN_CODE_M365_TOOL_OK`.

Acceptance criteria:

- `RELAY_KEEP_OPENCODE_LIVE_SMOKE_DIR=1 pnpm live:m365:opencode-provider`
  passes against signed-in M365 Copilot.
- The smoke exercises both plain provider text and an OpenCode-owned `read`
  tool turn.
- The artifact directory and result are recorded in `docs/IMPLEMENTATION.md`.

## Completed Task: Provider-Only Hard Cut

Goal: remove remaining compatibility posture now that the OpenAI-compatible
OpenCode provider gateway has landed. Relay's desktop-owned UX and execution
surface should stop being treated as a product path; Relay should keep only
provider gateway startup, OpenCode/OpenWork config support, M365 Copilot CDP
transport, and diagnostics.

Status 2026-04-25: implemented for live docs, root/package scripts, CI naming,
doctor diagnostics, task graph, and hard-cut guard enforcement.

Compatibility policy:

- Do not preserve legacy Relay desktop chat/session behavior.
- Do not preserve hidden compatibility tools such as `office_search`.
- Do not preserve Relay-owned tool execution, repair strategy, or transcript
  state as a fallback path.
- Do not keep migration shims unless they are strictly needed to launch or
  diagnose the OpenCode/OpenWork provider gateway.

Change targets:

- `README.md`
- `PLANS.md`
- `.taskmaster/tasks/tasks.json`
- `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`
- `docs/IMPLEMENTATION.md`
- `apps/desktop/package.json`
- `package.json`
- `apps/desktop/src-tauri/src/doctor.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/binaries/copilot_server.js`

Acceptance criteria:

- README first-run guidance starts with OpenCode/OpenWork plus
  `pnpm start:opencode-provider-gateway`, not the diagnostic desktop shell.
- Package scripts clearly separate canonical provider commands from diagnostic
  desktop checks; compatibility-era launch paths are not presented as primary.
- Doctor output names Relay as an OpenAI-compatible M365 provider gateway and
  treats desktop-shell checks as diagnostics only.
- No live documentation claims Relay owns the primary UX, sessions, tools,
  permissions, transcript, or execution loop.
- `office_search` is marked as a non-goal/unsupported leftover until moved into
  an OpenCode/OpenWork extension point or deleted.
- `pnpm check`, `pnpm check:opencode-provider`, and `git diff --check` pass.

## Completed Task: Bundled OpenCode Runtime Retirement

Goal: remove the packaged OpenCode runtime sidecar from the Relay desktop
process. OpenCode/OpenWork is the external OSS owner for UX, sessions, tools,
transcript, and execution; Relay should not spawn, warm up, or call a bundled
tool runtime.

Status 2026-04-26: implemented by shrinking `opencode_runtime.rs` to an
external runtime URL diagnostic probe, removing Tauri startup of the bundled
runtime, dropping the `opencode-runtime` bundle resource, deleting the vendored
runtime resource directory, and extending the hard-cut guard so Relay cannot
restore tool execution or sidecar startup paths.

Acceptance criteria:

- `apps/desktop/src-tauri/src/opencode_runtime.rs` no longer exposes
  `OpencodeToolExecutionContext`, `execute_tool_with_context`, transcript
  append helpers, bundled runtime startup, Bun resolution, or warmup behavior.
- Tauri setup no longer calls `opencode_runtime::start` or manages a bundled
  runtime child process.
- `apps/desktop/src-tauri/tauri.conf.json` no longer bundles
  `resources/opencode-runtime/`.
- `apps/desktop/src-tauri/resources/opencode-runtime/` no longer exists.
- The hard-cut guard rejects restoring the bundled sidecar, tool execution
  endpoint, transcript relay endpoint, or old runtime env knobs.

## Completed Task: Diagnostic Shell Minimization

Goal: physically shrink the remaining Relay desktop shell so it can no longer
look like a product UX or execution fallback. The shell should remain only for
provider gateway launch support, doctor output, CDP/M365 diagnostics, and
targeted regression harnesses.

Status 2026-04-25: implemented for the normal desktop UI path. `Shell.tsx` now
renders a provider gateway diagnostic console and the hard-cut guard rejects
reintroducing `startAgent`, `continueAgentSession`, Composer, MessageFeed,
Sidebar, or inline approval imports into the normal shell.

Non-goals:

- Do not preserve `start_agent` / `continue_agent_session` as primary product
  APIs.
- Do not keep Relay-owned chat/session UI behavior for compatibility.
- Do not keep Relay-owned approval, write-undo, slash-command, MCP, or
  workspace permission flows as product surfaces.
- Do not move execution back into Relay to keep old desktop smokes passing.

Change targets:

- `apps/desktop/src/shell/**`
- `apps/desktop/src/components/**`
- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src-tauri/src/commands/agent.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/tests/**`
- `README.md`
- `PLANS.md`
- `.taskmaster/tasks/tasks.json`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- The desktop first screen is diagnostic/provider-oriented, not a chat-first
  agent workspace.
- `start_agent` and `continue_agent_session` are removed from the desktop UI
  path.
- Chat/session stores, approval UI, write undo UI, and session transcript
  rendering are either removed or explicitly isolated under diagnostic test
  harnesses.
- Root provider checks remain unchanged: `pnpm check`,
  `pnpm check:opencode-provider`, and `pnpm smoke:opencode-provider`.
- Diagnostic launch checks still pass under their `diag:*` names or are
  intentionally retired with CI/docs updated in the same change.

## Completed Task: Legacy Agent IPC Retirement

Goal: remove legacy Relay chat/session execution commands from the public Tauri
WebView invoke surface and frontend IPC bridge. Internal Rust diagnostic
harnesses may still call the old controller directly while the remaining
backend deletion proceeds, but the desktop app can no longer invoke those paths
as product APIs.

Status 2026-04-25: implemented for the Tauri `generate_handler!` command list,
frontend `ipc.ts`, and hard-cut guard enforcement.

Retired public commands:

- `start_agent`
- `continue_agent_session`
- `respond_approval`
- `respond_user_question`
- `cancel_agent`
- `get_session_history`
- `compact_agent_session`
- `undo_session_write`
- `redo_session_write`
- `get_session_write_undo_status`

Acceptance criteria:

- The normal WebView invoke handler exposes provider diagnostics, CDP helpers,
  doctor, OpenCode/OpenWork config support, MCP diagnostics, and workspace
  inspection only.
- `apps/desktop/src/lib/ipc.ts` no longer exports frontend wrappers for retired
  legacy agent commands.
- `scripts/check-hard-cut-guard.mjs` fails if retired commands return to the
  public invoke handler or frontend IPC bridge.
- `pnpm check`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  and `git diff --check` pass.

## Completed Task: Legacy Agent Event And Type Retirement

Goal: remove the remaining Relay-owned agent event and session-history IPC
projection surface after public commands, command wrappers, dev-control routes,
and the hard-cut wrapper were deleted.

Status 2026-04-25: implemented for Rust IPC models, generated frontend
bindings, the frontend event subscription bridge, OpenCode transcript mapping
shims, and hard-cut guard enforcement.

Retired surfaces:

- `apps/desktop/src-tauri/src/agent_projection.rs`
- Relay-owned `agent:*` event payload types and frontend `onAgentEvent`
  listener bridge.
- Legacy agent request/response structs in `desktop-core/src/models.rs`.
- OpenCode session-history-to-Relay-message projection helpers.
- Unsupported Relay session history, approval, question, cancel, compact, undo,
  and redo entrypoints from `tauri_bridge.rs`.

Acceptance criteria:

- Generated frontend IPC bindings contain only diagnostic/provider-support
  contracts.
- `ipc.ts` does not listen for Relay-owned `agent:*` events.
- The hard-cut guard rejects restoring the deleted event/type projection
  module and event listener bridge.

## Completed Task: Legacy Session Registry And Persistence Retirement

Goal: remove the remaining Relay-owned in-memory session registry and metadata
persistence now that desktop execution commands, events, and projection IPC have
been retired. OpenCode/OpenWork remains the only session source of truth.

Status 2026-04-26: implemented by deleting the desktop-core session registry
and Copilot session persistence module, removing the app-level registry
re-export, and simplifying provider diagnostics to use only the Copilot bridge
manager.

Retired surfaces:

- `apps/desktop/src-tauri/crates/desktop-core/src/registry.rs`
- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_persistence.rs`
- `apps/desktop/src-tauri/src/registry.rs`
- `AppServices.registry`
- Dev-control session snapshots from `GET /state`
- Copilot CDP port-change blocking based on Relay-owned running sessions

Acceptance criteria:

- Relay desktop code no longer exports or constructs `SessionRegistry`.
- `dev_control.rs` exposes provider diagnostics and stored automation config,
  not Relay-owned session state.
- `ensure_copilot_server` manages only Copilot bridge lifecycle and CDP port
  changes; it does not consult Relay session concurrency.
- The hard-cut guard rejects restoring the deleted registry/persistence files
  or their module declarations.

## Completed Task: Legacy Error Taxonomy Retirement

Goal: remove the leftover Relay-owned execution error taxonomy and stale
agent-loop wording after the registry and persistence modules were deleted.
`desktop-core` should expose provider/diagnostic helpers, not unused
session-loop error variants.

Status 2026-04-26: implemented by deleting the unused `AgentLoopError` enum,
keeping only `DesktopCoreError`, and updating remaining CDP adapter comments
and logs to describe provider diagnostics rather than `start_agent` or an
agent loop.

Retired surfaces:

- `AgentLoopError`
- `SessionNotFound`
- `RegistryLockPoisoned`
- `PersistenceError`
- Agent-loop wording in Copilot adapter comments.
- `start_agent` wording in CDP auto-connect logs.

Acceptance criteria:

- `desktop-core/src/error.rs` contains only active provider/diagnostic error
  types.
- Live Rust source does not mention `AgentLoopError`, the removed registry
  lock error, or persistence/session variants.
- The hard-cut guard rejects restoring the obsolete error taxonomy and stale
  CDP adapter/log wording.

## Completed Task: Orphan Desktop Chat UI Retirement

Goal: delete the leftover SolidJS chat/session UI modules and browser-test
mocks after the diagnostic shell became the only desktop surface. The frontend
should no longer carry unused Composer, feed, approval, session list, or agent
event test harness code.

Status 2026-04-26: implemented by deleting the orphan chat UI components,
session/approval stores, tool timeline helpers, slash-command composer helper,
assistant markdown renderer, and obsolete Playwright debug/mock files. The
remaining E2E mock now covers provider diagnostics only.

Retired surfaces:

- `Composer`, `MessageFeed`, `Sidebar`, `CommandPalette`, approval/question
  overlays, rail/status/feed components, and their dependent helper modules.
- `sessionStore`, `approvalStore`, `session-display`, `shell-types`,
  `tool-timeline`, `slash-commands`, and `assistant-markdown`.
- Browser E2E mocks that still implemented `start_agent`,
  `continue_agent_session`, session history, compact, approval, or `agent:*`
  events.

Acceptance criteria:

- The normal frontend source tree contains only the diagnostic shell and active
  settings/provider-support components.
- E2E mocks do not expose legacy agent chat/session commands.
- `ipc.ts` no longer exports legacy UI chunk/session phase helpers or
  `office_search` activity labels.
- The hard-cut guard rejects restoring the deleted chat UI and obsolete mocks.

## Completed Task: OpenCode Bash Preflight Hardening

Goal: keep Bash execution delegated to OpenCode/OpenWork while adding a small
Relay-side adapter preflight for obvious destructive command roots before a
`bash` tool request is forwarded to the external runtime.

Status 2026-04-26: implemented in `opencode_runtime.rs` by tokenizing shell
fragments, stripping wrapper commands such as `env`, `command`, `nice`,
`nohup`, and `time`, and rejecting destructive root commands case-insensitively
before the OpenCode tool request is sent.

Acceptance criteria:

- Relay no longer relies on broad regex matching for the adapter-side Bash
  preflight.
- Wrapper forms such as `env ... rm`, `command rm`, `nice -n 10 rm`, and
  `nohup rm` are covered by regression tests.
- Mixed-case Windows destructive verbs such as `DeL`, `ICACLS`, and
  `FORMAT.EXE` are covered by regression tests.
- The old desktop `agent_loop/**` tree remains deleted; Bash policy hardening
  does not reintroduce Relay-owned tool execution.

## Completed Task: `office_search` Adapter Fixture Retirement

Goal: remove the last live Rust adapter test fixture that still named the
retired `office_search` tool. Unsupported-tool parser coverage should use a
neutral unsupported name instead of preserving old model-facing vocabulary.

Status 2026-04-26: implemented by replacing the stale fixture in
`copilot_adapter.rs` and extending the hard-cut guard so `office_search` cannot
return to the Copilot adapter source.

Acceptance criteria:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs` no longer
  mentions `office_search`.
- Unsupported-tool parser regression coverage still verifies that unsupported
  tools are filtered while supported tools in the same array are retained.
- The hard-cut guard rejects future `office_search` references in
  `copilot_adapter.rs`.

## Completed Task: Workspace Approval Allowlist Diagnostics Retirement

Goal: remove the leftover Relay-owned remembered workspace approval surface.
Provider-mode tool permission state belongs to OpenCode/OpenWork, so Relay
should not expose an allowlist store, Settings management UI, or diagnostic IPC
for tool approvals.

Status 2026-04-26: implemented by deleting the workspace allowlist backend
module, removing the public Tauri commands and frontend IPC wrappers, dropping
the generated IPC types, removing the Settings Permissions section and stale
mock handlers, and updating diagnostic wording to say Relay does not expose a
workspace approval allowlist.

Acceptance criteria:

- `apps/desktop/src-tauri/src/workspace_allowlist.rs` no longer exists.
- Public invoke commands no longer include `get_workspace_allowlist`,
  `remove_workspace_allowlist_tool`, or `clear_workspace_allowlist`.
- Frontend IPC and Settings no longer expose remembered workspace approvals.
- E2E mocks no longer implement workspace allowlist commands.
- The hard-cut guard rejects restoring the deleted allowlist module, commands,
  and Settings surface.

## Completed Task: Workspace Skills And Slash-Command Diagnostics Retirement

Goal: remove the leftover Relay-owned `.relay/skills` and `.relay/commands`
discovery surfaces. Provider-mode skills and slash commands belong to
OpenCode/OpenWork, not the Relay diagnostic desktop shell.

Status 2026-04-26: implemented by deleting the frontend skill parser, the Rust
workspace skills/slash-command discovery modules, generated IPC types, public
Tauri commands, Settings Skills UI, stale mock handlers, and desktop-core
exports/tests. The hard-cut guard now rejects restoring these diagnostics.

Acceptance criteria:

- `apps/desktop/src/lib/skills.ts` no longer exists.
- `workspace_skills.rs` and `workspace_slash_commands.rs` no longer exist in
  the desktop shell or `desktop-core`.
- Public invoke commands no longer include `list_workspace_skills` or
  `list_workspace_slash_commands`.
- Frontend IPC and Settings no longer expose Relay-owned skills/slash-command
  discovery.
- The hard-cut guard rejects restoring the retired modules, commands, and
  Settings Skills surface.

## Completed Task: MCP Registry Diagnostics Retirement

Goal: remove the leftover Relay-owned in-memory MCP registry diagnostics.
Provider-mode MCP configuration and execution belong to OpenCode/OpenWork, so
Relay should not expose add/list/remove/check MCP registry commands through the
desktop WebView.

Status 2026-04-26: implemented by deleting `commands/mcp.rs`, removing MCP
commands from the public invoke handler, deleting the in-memory registry from
`tauri_bridge.rs`, removing MCP IPC models from Rust and generated TypeScript,
and extending the hard-cut guard.

Acceptance criteria:

- `apps/desktop/src-tauri/src/commands/mcp.rs` no longer exists.
- Public invoke commands no longer include `mcp_list_servers`,
  `mcp_add_server`, `mcp_remove_server`, or `mcp_check_server_status`.
- `tauri_bridge.rs` no longer owns an MCP registry.
- Generated frontend IPC no longer exports MCP registry request/response
  types.
- The hard-cut guard rejects restoring the retired MCP diagnostics.

## Completed Task: LSP And Workspace Instruction Diagnostics Retirement

Goal: remove orphan Relay-owned diagnostic IPC for `rust-analyzer` probing and
workspace instruction file discovery. Provider-mode LSP/workspace config
behavior belongs to OpenCode/OpenWork; the remaining desktop shell should keep
provider/CDP diagnostics only.

Status 2026-04-26: implemented by deleting `lsp_probe.rs`,
`workspace_surfaces.rs`, their `desktop-core` models/exports, public Tauri
commands, frontend IPC wrappers, generated TypeScript types, and stale browser
mock handlers. The OpenCode tool catalog can still advertise `lsp` as an
OpenCode-owned tool.

Acceptance criteria:

- `apps/desktop/src-tauri/src/lsp_probe.rs` and workspace surface modules no
  longer exist.
- Public invoke commands no longer include `probe_rust_analyzer` or
  `workspace_instruction_surfaces`.
- Frontend IPC no longer exports `probeRustAnalyzer` or
  `fetchWorkspaceInstructionSurfaces`.
- The hard-cut guard rejects restoring these orphan diagnostic surfaces.

## Completed Task: Agent Command Module Retirement

Goal: delete the now-unreachable Tauri command wrapper module for legacy Relay
chat/session execution. After the public invoke handler and frontend IPC bridge
were retired, `commands/agent.rs` only preserved obsolete Tauri command symbols.

Status 2026-04-25: implemented by removing `commands/agent.rs`, removing the
`pub mod agent;` declaration from `commands/mod.rs`, and strengthening the
hard-cut guard so the module cannot return.

Acceptance criteria:

- `apps/desktop/src-tauri/src/commands/agent.rs` no longer exists.
- `apps/desktop/src-tauri/src/commands/mod.rs` no longer declares the agent
  command module.
- `scripts/check-hard-cut-guard.mjs` fails if the deleted module or module
  declaration returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `pnpm check`, and `git diff --check` pass.

## Completed Task: Dev-Control Agent Route Retirement

Goal: remove debug-only localhost controls that could still start, continue, or
approve Relay-owned agent execution from the desktop process. Dev-control now
stays limited to local health, state, and diagnostic configuration support.

Status 2026-04-25: implemented by deleting `/start-agent`, `/first-run-send`,
direct `/approve`, approve/reject event routes, and all `hard_cut_agent` calls
from `dev_control.rs`. Old desktop live harness package aliases were removed in
favor of `live:m365:opencode-provider` and the Copilot response probe.

Acceptance criteria:

- `apps/desktop/src-tauri/src/dev_control.rs` no longer calls
  `hard_cut_agent::start_agent`, `hard_cut_agent::continue_agent_session`, or
  `respond_approval_inner`.
- Debug localhost routes no longer expose `/start-agent`, `/first-run-send`, or
  direct `/approve` execution controls.
- Root and desktop package scripts no longer advertise old `diag:m365:*`
  desktop execution harnesses.
- `scripts/check-hard-cut-guard.mjs` fails if those routes or script aliases
  return.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `pnpm check`, and `git diff --check` pass.

## Completed Task: Orphan Desktop Live Harness Retirement

Goal: physically remove old desktop-owned live automation helpers after their
package entry points and dev-control execution routes were retired. Relay's live
M365 verification surface now stays on the OpenAI-compatible provider smoke and
Copilot response probe.

Status 2026-04-25: implemented by deleting the stale dev-control helper
scripts and old `live_m365_*` desktop execution harnesses from
`apps/desktop/scripts/`, then extending the hard-cut guard so those files cannot
return.

Acceptance criteria:

- `apps/desktop/scripts/dev-first-run-send.mjs`,
  `dev-approve-latest*.mjs`, and `dev-reject-latest.mjs` no longer exist.
- Old desktop execution harnesses such as
  `live_m365_desktop_smoke.mjs`, `live_m365_tetris_html_smoke.mjs`,
  grounding/path/workspace/continuity/heterogeneous live smokes no longer
  exist.
- Provider live verification remains available through
  `live:m365:opencode-provider` and `live:m365:copilot-response-probe`.
- `scripts/check-hard-cut-guard.mjs` fails if any retired helper or harness
  file is recreated.
- `node scripts/check-hard-cut-guard.mjs`, `pnpm check`, and
  `git diff --check` pass.

## Completed Task: Compat Harness Crate Retirement

Goal: remove the remaining standalone compatibility fixture crate after the old
Relay runtime/tools parity harness was already deleted. The crate only kept a
historical claw-code mock parity manifest readable and was no longer an active
provider gateway verification surface.

Status 2026-04-25: implemented by deleting
`apps/desktop/src-tauri/crates/compat-harness/`, removing it from the root
Cargo workspace, updating current docs that advertised it as active coverage,
and extending the hard-cut guard so the crate cannot return.

Acceptance criteria:

- `apps/desktop/src-tauri/crates/compat-harness/` no longer exists.
- Root `Cargo.toml` no longer lists `compat-harness` as a workspace member.
- README / AGENTS / current plan wording no longer presents `compat-harness` as
  active coverage.
- `scripts/check-hard-cut-guard.mjs` fails if the crate directory or workspace
  member returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace
  --exclude relay-agent-desktop`, `pnpm check`, and `git diff --check` pass.

## Completed Task: Hard-Cut Agent Wrapper Retirement

Goal: delete the last internal wrapper that could run Relay-owned desktop agent
turns against the bundled OpenCode runtime. Provider-mode execution belongs to
OpenCode/OpenWork and reaches Relay only through the OpenAI-compatible M365
Copilot provider gateway.

Status 2026-04-25: implemented by deleting `hard_cut_agent.rs`, removing the
module declaration, and deleting the now-unused Relay agent-loop config and
semaphore plumbing from `AppServices`.

Acceptance criteria:

- `apps/desktop/src-tauri/src/hard_cut_agent.rs` no longer exists.
- `apps/desktop/src-tauri/src/config.rs` no longer exists.
- `apps/desktop/src-tauri/src/lib.rs` no longer declares `mod hard_cut_agent`
  or `mod config`.
- `AppServices` only retains diagnostic registry and Copilot bridge state.
- `scripts/check-hard-cut-guard.mjs` fails if the deleted wrapper or config
  returns.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace
  --exclude relay-agent-desktop`, `cargo test --manifest-path
  apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and
  `git diff --check` pass.

## Guardrails

- Do not widen scope without updating this file and recording the reason in `docs/IMPLEMENTATION.md`.
- Preserve Copilot CDP product focus, but do not preserve Relay's bespoke
  execution runtime or treat Relay's diagnostic desktop shell as the target UX.
- Keep Relay-specific code focused on the OpenAI-compatible provider facade,
  M365 Copilot, CDP orchestration, prompt adaptation, and diagnostics.
- Tool shapes, permission posture, session state, plugins, MCP, skills, and
  workspace config should come from OpenCode/OpenWork wherever practical.
- Do not implement arbitrary code execution, unrestricted shell access, VBA, or uncontrolled external network execution outside agent-managed tools.

## Verification Policy

Canonical repo verification commands:

```bash
pnpm check
pnpm check:opencode-provider
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli
```

Provider-gateway acceptance and smoke commands:

```bash
pnpm smoke:opencode-provider
pnpm start:opencode-provider-gateway -- --print-config
pnpm install:opencode-provider-config -- --workspace /path/to/workspace --dry-run
```

Diagnostic desktop checks:

```bash
pnpm diag:desktop-launch
pnpm diag:windows-smoke
pnpm doctor -- --json
```

Rules:

- `pnpm check` is the canonical frontend acceptance gate.
- `pnpm check` includes the CI-safe provider contract check.
- `pnpm check:opencode-provider` validates provider scripts and OpenAI facade
  tests without requiring Bun, OpenCode, Edge, or live M365.
- `pnpm smoke:opencode-provider` is the canonical deterministic
  OpenCode/OpenWork provider contract gate.
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

### Phase 3: Deterministic Provider And Diagnostic Coverage

Goal: keep deterministic provider and diagnostic tests without preserving a
Relay-owned desktop execution wrapper.

Change targets:

- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `docs/CLAW_CODE_ALIGNMENT.md`

Acceptance criteria:

- Provider and diagnostic checks verify gateway, doctor, CDP, and runtime
  health surfaces without routing tasks through Relay-owned desktop execution.
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
- Ubuntu executes bundled-node prep, Tauri system dependencies, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:desktop-launch`.
- Windows executes bundled-node prep, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test doctor_cli`, `pnpm check`, and `pnpm diag:windows-smoke`.
- The `pnpm check` CI step includes the CI-safe OpenCode provider contract
  check. Full `pnpm smoke:opencode-provider` remains a local/ops smoke because
  it requires a real OpenCode checkout and Bun.
- CI also guards the live docs map against stale removed-package or spreadsheet-era references.

Status 2026-04-25:

- Implemented on `main` for `push`, `pull_request`, and manual dispatch.
- Latest verified push run: `24913551591`, commit `6e56068`, passed Ubuntu
  Acceptance and Windows Acceptance.

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
- `office_search` is hidden from CDP catalogs and repair prompts; retaining it
  as a Relay compatibility helper is not a goal.
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
- Any remaining `office_search` code is an unsupported leftover and should move
  into an OpenCode/OpenWork extension point or be deleted.

### Cross-Cutting Hardening: Workspace Approval Persistence

Status 2026-04-26: superseded by hard-cut deletion. The earlier persistence
hardening shipped on 2026-04-18, but the provider-only architecture no longer
keeps Relay-owned remembered workspace approvals. OpenCode/OpenWork owns tool
permission state.

Historical goal: make persisted "Allow for this workspace" approvals resilient to interrupted writes and visible when the store is damaged.

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

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- Bash deny decisions use shell-fragment/token inspection before regex fallback.
- Wrapper forms such as `env ...`, `command ...`, `nice ...`, and mixed-case blocked verbs are covered by regression tests.
- OpenCode-backed adapter regression coverage verifies that Relay does not
  reintroduce the old shell policy engine.
- The deleted desktop `agent_loop/**` tree, hard-cut wrapper, and legacy
  `agent_projection.rs` event/type surface are not reintroduced; diagnostic IPC
  payloads stay in `models.rs`/`tauri_bridge.rs`, and deterministic
  parser/prompt helpers stay in `desktop-core`.

Status 2026-04-26:

- Implemented the Relay-side Bash preflight for OpenCode tool forwarding.
- Old desktop loop deletion remains enforced by `scripts/check-hard-cut-guard.mjs`.

### Cross-Cutting Feature: Office File Search

Goal: implement `docs/OFFICE_SEARCH_DESIGN.md` Phase A so the agent can extract and search Office/PDF plaintext without embeddings.

Change targets:

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

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- The active search surface stays close to opencode-style low-level tools:
  `glob` for path discovery, `grep` for plaintext/code content, and `read` for
  exact file inspection including extracted Office/PDF text.
- Standard ignore directories such as `.git`, `node_modules`, and `target`,
  plus `.gitignore` patterns, are skipped by default, and
  large/plainly unreadable/binary files do not bloat results.
- `glob` and `grep` emit baseline search telemetry for counts, elapsed time,
  truncation, and failure surfaces; `office_search` is not part of the target
  provider surface.
- Search roots are constrained to the current workspace; paths or symlink
  resolutions that escape the workspace are not read.
- CDP prompt guidance prefers concrete `glob`, `grep`, or `read` calls for
  implementation, related-file, and evidence lookup requests.
- Important conclusions, reviews, edits, comparisons, and recommendations must
  expand relevant search candidates with `read`; search snippets are
  candidate evidence, not a substitute for full-file inspection.
- Deterministic provider/desktop-core coverage verifies low-level search
  behavior.

## Forward-Looking Designs (Not Yet Scheduled)

- `docs/OFFICE_SEARCH_DESIGN.md` — Phase A has source implementation in progress/landed under the Office File Search track above. Future Phase B remains semantic retrieval on top of the extraction cache.

## Out Of Scope

- Broad backend decomposition unrelated to doctor sharing or deterministic harness support.
- Reintroducing upstream claw crates as direct Rust dependencies.
- Reviving workbook / spreadsheet-specific MVP gates.
- Formal installer signing credential setup and public distribution operations.
  The separate Windows installer release workflow exists for unsigned
  prerelease smoke builds and for future Trusted Signing configuration.

## Risks And Mitigations

- Risk: docs drift faster than code changes.
  Mitigation: keep `README.md`, `PLANS.md`, `AGENTS.md`, and `docs/CLAW_CODE_ALIGNMENT.md` synchronized in the same PR as behavior changes.

- Risk: CDP and Edge instability makes parity coverage flaky.
  Mitigation: keep deterministic harnesses local and fixture-driven; reserve launched-app smokes for separate acceptance checks.

- Risk: CI passes while the repo’s documented acceptance path is still broken.
  Mitigation: have CI run the same root commands that the docs prescribe.

- Risk: historical task graphs stay marked complete for removed architecture.
  Mitigation: rewrite `.taskmaster/tasks/tasks.json` around the current product and verification artifacts.
