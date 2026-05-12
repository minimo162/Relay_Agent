# Relay_Agent Implementation Plan

Date: 2026-04-14

## Current Product Baseline

Relay_Agent is moving to an **AionUi-first Relay-branded desktop shell** while
keeping the existing OpenAI-compatible M365 Copilot provider gateway and Tool
Call Emulation Layer. The current OpenCode Web path remains implementation
history and diagnostic reference until the AionUi shell takes over first run.

- Target primary UX and execution: Relay-branded AionUi with OfficeCLI skills.
- Current primary UX and execution until the cutover lands: OpenCode Web.
- Setup + provider gateway: `apps/desktop/src-tauri/binaries/copilot_server.js`
  exposes the OpenAI-compatible provider endpoint. The current `pnpm dev`
  still runs the OpenCode auto bootstrap; the target path starts the provider
  before the Relay-branded AionUi shell.
- Frontend: SolidJS + Vite diagnostic desktop shell.
- Backend: Rust in `apps/desktop/src-tauri/`, with `crates/desktop-core` as the
  only active internal crate. Historical `runtime` / `tools` /
  `compat-harness` crates and the unused legacy `api` crate have been
  physically removed as part of the OpenCode hard cut.
- Primary LLM path: M365 Copilot via Edge CDP and the Relay provider gateway.
- Contract source of truth: Rust IPC types and command signatures; generated frontend bindings live in `apps/desktop/src/lib/ipc.generated.ts`, with `apps/desktop/src/lib/ipc.ts` kept thin.
- UI direction: warm-token light theme and paired warm-charcoal dark theme from `apps/desktop/DESIGN.md`.
- PDF reads: LiteParse via bundled `relay-node`.

Historical workbook / CSV planning artifacts and the OpenCode-only product path
are no longer completion gates for the target product. Older implementation log
entries remain preserved in `docs/IMPLEMENTATION.md` as history only.

## Source Of Truth

Planning and implementation references are ordered as follows:

1. `PLANS.md`
2. `AGENTS.md`
3. `docs/IMPLEMENTATION.md`
4. `docs/CLAW_CODE_ALIGNMENT.md`

Additional rules:

- Rust crate types and IPC signatures in `apps/desktop/src-tauri/` are canonical.
- AionUi session state is the target canonical source for execution transcript
  and workspace behavior. Until the cutover lands, OpenCode session state
  remains the current implementation's source of truth. Relay-specific defaults
  live in the provider gateway and seed/bootstrap modules.
- `.taskmaster/tasks/tasks.json` must reflect real artifact state, not historical intent.

## Delivery Priorities

- Priority A: keep M365 Copilot via Edge CDP as the primary LLM surface.
- Priority B: move product UX to AionUi and use AionUi/OfficeCLI for sessions,
  tools, approvals, skills, Office previews, and workspace behavior.
- Priority C: keep Relay-specific code focused on the OpenAI-compatible
  provider gateway, Copilot CDP transport, tool-call normalization, diagnostics,
  AionUi provider seeding, and user-local OfficeCLI bootstrap.

## Strategic Reset: AionUi-First Relay Agent

The active architecture direction is now an AionUi-first rebuild, not another
OpenCode Web iteration. Relay_Agent makes AionUi easy to use with M365 Copilot
and OfficeCLI while keeping M365 Copilot behind Relay's provider gateway and
Tool Call Emulation Layer.

Detailed plan: `docs/AIONUI_RELAY_MIGRATION.md`.

Implications:

- Relay-branded AionUi owns the first-run product UX.
- The first-run product UX starts from AionUi's Relay-branded `/guid` task
  launcher, not a standalone Relay search page. Beginners choose a curated task,
  select a folder when needed, use an example or typed prompt, then continue in
  AionUi's normal conversation/workspace/preview flow.
- Relay seeds the M365 Copilot provider automatically.
- Relay manages portable OfficeCLI without admin approval.
- Workspace Document Search must show recoverable beginner states such as
  `フォルダ未選択`, `候補を表示中`, `ファイルの中身まで確認中`,
  `確認済みの結果`, `結果なし`, `一部のみ検索`, `権限なし`, and
  `失敗`; advanced Dedoc/Docufinder terms stay in support details.
- The `/guid` input is the primary search/task CTA. It should show task-aware
  example prompts and recent/popular suggestions before exposing advanced
  assistant controls.
- Beginner-facing AionUi chrome must hide setup/platform surfaces that do not
  help the first task: provider/model settings, Gemini setup, agent management,
  tools/system/dev settings, WebUI/channel setup, extension settings, Skills
  Market, model switchers, ACP config selectors, permission-mode controls,
  detected-agent selectors, preset assistant edit controls, preset backend
  switchers, settings/WebUI buttons, feedback/evaluation/rating buttons, and
  assistant-management entrypoints. Support can re-enable them through
  `relay.advancedSurfaces.enabled`.
- Beginner execution is now a required two-mode choice: `資料を探す` routes to
  candidate-first `relay_document_search`, and `Officeファイルを編集する` routes
  to OfficeCLI-backed inspection/editing. The old Word/Excel/PowerPoint creator
  chips are not beginner-facing product modes.
- Search results must render as actionable cards with title, path, match
  reason, index/warning state, preview/open/copy/refine actions, and careful
  wording that distinguishes candidates from evidence-backed findings.
- Result cards should follow the Docufinder-style content-first pattern:
  first batch capped, `さらに表示` for continuation, stable selection across
  refresh, and AI prose secondary to title/path/snippet/status/actions.
- Default broad search is candidate-first: early filename/path hits are returned
  quickly with broad query expansion and continuation, while Office/PDF content
  extraction waits for summary, inspection, comparison, selected-file, or
  evidence-backed requests.
- OpenWork remains removed.
- OpenCode Web is demoted to optional future backend capacity.
- Do not add new production features to the Relay-owned Rust execution runtime.

## Strategic Reset: OpenCode Provider Gateway

The previous architecture direction was a hard cut, not a compatibility migration:
Relay_Agent makes OpenCode easy to use with M365 Copilot while staying out of UX
and execution ownership. OpenCode owns UX and execution;
Copilot owns the LLM surface; Relay owns the setup path, M365 Copilot provider
gateway, and diagnostics.

Detailed plan: `docs/COPILOT_OPENCODE_HARD_CUT_PLAN.md`.

This remains valuable as the provider-gateway reference and because
Relay_Agent makes OpenCode easy to use with M365 Copilot in the current
implementation. It is no longer the target first-run product UX.

Implications:

- Do not add new production features to the Relay-owned Rust execution runtime.
- Do not preserve legacy tool/runtime/session contracts for compatibility.
- Do not reintroduce `office_search` as a model-facing tool.
- Do not treat the Copilot browser thread as the execution source of truth.
- New runtime work should target OpenCode APIs or extension points.

## Completed Task: OpenCode-only Web Bootstrap

Goal: drop the OpenWork optional installer handoff and make the first-run path
portable OpenCode plus OpenCode Web only.

Status 2026-05-07: implemented. The bootstrap manifest now pins only the
Windows x64 OpenCode CLI zip, the installed desktop setup downloads/verifies
and extracts portable OpenCode without admin approval, and the launch action
starts `opencode web` on loopback with the Relay M365 Copilot provider already
configured.

Acceptance criteria:

- No OpenWork MSI or desktop handoff artifact is part of the current manifest.
- The desktop launch action is **Open OpenCode Web**.
- Relay remains setup, provider gateway, and diagnostics only; OpenCode owns
  chat UX, sessions, tools, permissions, MCP, plugins, skills, and execution.

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

Status 2026-05-11: readiness-only preflight rerun passed on Linux with
`RELAY_LIVE_WINDOWS_BOOTSTRAP_REQUIRE_WINDOWS=0`. The report confirmed
`pnpm dev` still points to `bootstrap:openwork-opencode:auto`, desktop
`tauri:dev` remains absent as a primary script, the provider handoff is
`http://127.0.0.1:18180/v1` / `relay-agent/m365-copilot`, and the pinned
OpenCode Windows x64 artifact is version `1.14.25` with SHA256
`8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b`.
The explicit artifact verification path was also run from Linux with
`RELAY_LIVE_WINDOWS_BOOTSTRAP_DOWNLOAD=1` and reported `download_verified` for
the cached Windows x64 OpenCode CLI zip with matching size and SHA256.
Follow-up M365 live acceptance also passed on Linux with
`pnpm live:m365:opencode-provider`: the provider text turn returned
`OPEN_CODE_M365_PROVIDER_OK`, and the OpenCode-owned `read` tool turn completed
and returned `OPEN_CODE_M365_TOOL_OK` with artifacts at
`/tmp/relay-live-m365-opencode-provider-LVhfPR`. The local headless bootstrap,
provider-gateway bootstrap, and auto-bootstrap smokes also passed. The Windows
installer/browser handoff remains pending on a clean Windows host.

Status 2026-05-12: the Linux-accessible B12 gates were rerun. Readiness-only
preflight again passed with `status: ready_for_explicit_download`, and explicit
Windows x64 OpenCode artifact verification again reported
`status: download_verified` for the cached `1.14.25` zip with SHA256
`8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b`.
The headless, provider-gateway, and auto-bootstrap smokes passed. The first
M365 live provider run passed the text turn but failed the read-tool turn
because Copilot did not return structured `tool_calls` after repair; a single
retry passed both the provider text turn and OpenCode-owned `read` tool turn
with artifacts at `/tmp/relay-live-m365-opencode-provider-YDGjaV`. B12 remains
pending only for the clean-Windows installer/browser handoff.

## New Task List: AionUi Release Acceptance And Windows Sign-off

Goal: move the completed WDS/AionUi contract work into a releasable
Relay-branded AionUi Windows acceptance bundle while keeping the remaining B12
clean-Windows bootstrap handoff as an explicit gate.

Status 2026-05-12: created in `.taskmaster/tasks/tasks.json` as
`aionui_release_acceptance`. The list separates Linux-preparable release gates
from clean-Windows acceptance tasks so work can continue while B12 waits for a
Windows host.

Status 2026-05-12 AION01: completed. `docs/AIONUI_WINDOWS_VALIDATION.md` now
defines the installed-app acceptance matrix and evidence-bundle checklist,
including task-to-evidence mapping for release workflow artifacts, B12
handoff, provider seeding, OfficeCLI/ripgrep/Node/LiteParse, beginner AionUi
surfaces, Office workflows, Workspace Document Search UX, support export, and
release readiness. `docs/AIONUI_RELAY_MIGRATION.md` now points release
acceptance at that installed-app validation boundary.

Status 2026-05-12 AION02: completed. The AionUi release workflow now validates
`RelayAionUiReleaseArtifactManifest.v1` before publishing any release asset.
The gate asserts the Relay-branded installer asset name and SHA256, signing
mode rules for formal releases versus prereleases, manifest upstream pins,
overlay branding/provider/result-flow metadata, and bundled ripgrep,
`relay-node`, and LiteParse payloads. The generated release manifest is
uploaded alongside the installer and is listed in release notes and workflow
summary output. `aionui-relay.json` now records the release artifact manifest
contract that the workflow enforces.

Status 2026-05-12 AION03: completed. `scripts/apply-aionui-overlay.test.mjs`
now includes a pinned AionUi fixture application smoke. The smoke applies the
Relay overlay to an AionUi `v1.9.25` fixture carrying the pinned tag/commit
metadata, injects test portable tool payloads, and verifies that provider seed
hooks, Relay branding, beginner chrome hiding, `/guid` action hiding,
document-search skill/result-flow files, MCP injection, and bundled
ripgrep/`relay-node`/LiteParse resources survive full overlay application.
`applyAionuiOverlay` still defaults to the production payload locations, but
accepts explicit test payload paths so CI can validate overlay behavior without
requiring downloaded Windows binaries in the repo.

Implementation order:

1. `AION01` Create the installed-app Windows acceptance matrix and
   evidence-bundle checklist. Completed 2026-05-12.
2. `AION02` Harden the AionUi release workflow artifact/manifest gate.
   Completed 2026-05-12.
3. `AION03` Add a pinned AionUi overlay application smoke. Completed
   2026-05-12.
4. `AION04` Import the clean-Windows B12 handoff evidence after B12 is
   complete.
5. `AION05` Run the installed Relay-branded AionUi first-run provider smoke on
   Windows.
6. `AION06` Run installed Workspace Document Search UX acceptance on Windows.
7. `AION07` Publish the AionUi release readiness decision with evidence links
   and known limitations.

Acceptance criteria:

- Task Master has a dedicated `aionui_release_acceptance` phase with AION01
  through AION03 completed and AION04 through AION07 tracked as pending tasks.
- Linux-preparable checks do not claim the Windows installer/browser handoff is
  complete.
- B12 remains the source task for clean-Windows bootstrap handoff evidence.
- The release readiness decision is not marked complete until workflow,
  overlay, B12, installed first-run, and installed WDS acceptance artifacts are
  linked from the validation docs.

## Completed Task: No-Thinking OpenWork/OpenCode Auto Bootstrap

Goal: make the normal user entrypoint choose the safe defaults automatically so
users do not need to know about download, workspace config, provider gateway,
or installer handoff flags.

Status 2026-04-29: implemented. Root `pnpm dev` now calls
`bootstrap:openwork-opencode:auto`. The `--auto` mode starts the provider
gateway, defaults the workspace to the current directory, and on Windows also
downloads/verifies the pinned OpenWork/OpenCode artifacts and opens the
verified OpenWork installer handoff. Non-Windows auto runs remain
non-downloading so CI and Linux development do not try to execute Windows
artifacts.

Acceptance criteria:

- A user can run `pnpm dev` as the no-thinking first-run command.
- Windows auto mode downloads/verifies artifacts, prepares OpenCode provider
  config, starts the Relay provider gateway, and opens only the normal
  operator-approved installer handoff.
- Non-Windows auto smoke verifies the entrypoint without downloading Windows
  artifacts.
- The diagnostic shell and docs point to the no-thinking command first.

## Completed Task: Installed Relay Auto-Configures OpenWork/OpenCode

Goal: make the installed Relay app prepare OpenWork/OpenCode automatically so
users do not need to know about provider ports, tokens, config files, downloads,
or bootstrap flags.

Status 2026-04-29: implemented. Tauri setup now starts an app-managed provider
gateway on `127.0.0.1:18180`, writes the global OpenCode config at
`~/.config/opencode/opencode.json`, and sets `relay-agent/m365-copilot` as the
default model when no model is already configured. On Windows, the background
setup downloads/verifies the pinned OpenWork/OpenCode artifacts, extracts and
probes OpenCode, and opens the verified OpenWork MSI handoff once per pinned
version.

Acceptance criteria:

- Launching installed Relay starts the provider gateway without a separate
  command.
- OpenCode/OpenWork can discover the Relay provider from global config without
  a workspace-specific setup step.
- The generated config contains the current local provider token and default
  Relay model.
- Windows setup keeps OpenWork/OpenCode as the UX/execution owner and uses the
  normal Windows installer approval prompt.
- `RELAY_OPENWORK_AUTOSTART=0` disables the behavior for diagnostics.

## Completed Task: Beginner Setup Status And Retry

Goal: make the installed app understandable for beginners by reducing setup
state to a few visible outcomes and giving them a retry button instead of
requiring config, token, or port knowledge.

Status 2026-04-30: implemented. The desktop shell now shows the OpenWork/OpenCode
setup state as `Setting things up`, `Sign in to Microsoft 365`,
`Ready to start`, or `Setup needs attention`
based on the app-managed setup snapshot and Copilot warmup state. The setup
snapshot is stored in `AppServices`, updated by `openwork_autostart`, included
in `get_relay_diagnostics`, and exposed to the frontend through generated IPC
types. The shell exposes `Try Setup Again` for failed setup, `Refresh Setup` for
normal rechecks, and `Open OpenWork/OpenCode` as the clear start action. The
default view hides provider URLs, CDP ports, workspace paths, and raw diagnostic
lines behind `Advanced diagnostics`.

Acceptance criteria:

- Beginners can see whether setup is still preparing, ready, blocked on M365
  sign-in, or needs attention.
- The retry action restarts OpenWork/OpenCode setup without requiring command
  line usage.
- The launch action gives beginners one obvious way to open OpenWork/OpenCode
  after setup is ready.
- Windows launch detection checks Start Menu shortcuts before common executable
  install paths.
- Diagnostics still expose provider URL/config path for support, but they are
  collapsed by default and are not required to start using OpenWork/OpenCode.

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
must pass through OpenCode/OpenWork using Relay only for setup, diagnostics,
and the OpenAI-compatible M365 Copilot provider gateway.

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

### Cross-Cutting Feature: Workspace Document Search

Goal: add a Docufinder/Dedoc-informed document-search workflow without changing
Relay Agent's essence. Relay remains the bridge between M365 Copilot and the
Relay-branded AionUi shell. Broad shared-folder lookup should start from AionUi
skills, AionUi workspace/preview UX, progress-visible filename candidates,
thorough content/evidence confirmation, and structured result/evidence
contracts instead of relying on M365 Copilot to manually chain low-level
`glob`, `grep`, and `read` tools correctly.

Detailed plan: `docs/WORKSPACE_DOCUMENT_SEARCH_PLAN.md`.

Implementation order:

1. Define the source-controlled `RelayDocumentSearchRequest.v1` /
   `RelayDocumentSearchResult.v1` schemas, validators, TypeScript types, and
   OpenAI-compatible model-facing tool schema. Internal fields such as job ids,
   cache ids, parser versions, and redaction policy stay Relay-controlled. The
   contract module is the single source of truth for OpenAI tool schema, AionUi
   manifest metadata, runtime validation, fixtures, and generated skill/tool
   instructions.
   Copilot prompt templates are versioned alongside the contract so tool-call,
   repair, query-suggestion, answer-polish, and polish-repair behavior can be
   regression-tested.
2. Advertise `relay_document_search` from the Relay/AionUi provider bridge and
   accept aliases such as `workspace-search` / `find-files` only when the
   advertised schema or `resultContract` matches the Relay high-level contract.
3. Route document-search and grounded-summary intents through that high-level
   tool whenever it is advertised. Copilot can provide the user's wording and
   optional suggestions, but raw `glob`, `grep`, `read`, `bash`, and parser
   tools are implementation details behind the executor, not first-step
   planner choices.
4. Implement the initial executor as a Relay-owned job lifecycle wrapper over
   existing capabilities: root validation, metadata scan, ripgrep/filename
   search, Phase -1 Office/PDF/text read support, evidence packaging, coverage
   reporting, process/store locking, safe external command spawning,
   cache/privacy/quota/at-rest-protection enforcement, upgrade/rollback
   handling, enterprise/local-only policy enforcement, local observability and
   support export, golden-query release gates, feature-flag promotion, Windows
   long-path/sync-provider handling, warning-copy mapping, and deterministic
   result-card output.
5. Wire AionUi progress, cancel, retry, duplicate-submit attachment, timeout,
   partial-result, and result rendering to the executor result contract so
   beginners see status and evidence without waiting for Copilot final prose.
6. Add Copilot integration guards: correlation ids from AionUi message through
   Relay job, Copilot request, Evidence Pack, local draft, and accepted polish;
   explicit Copilot session states for warming, sign-in, capture failure,
   timeout, rate limit, tenant restriction, and policy disablement; and
   citation-bound polish validation that can replace the local draft at most
   once.
7. Replace live workspace-search smoke coverage that expects model-visible
   `glob_search` / `grep_search` first calls with high-level
   `relay_document_search` smoke coverage.
8. Keep the current low-level tool safety shim only as a degraded fallback and
   test harness, with a visible warning when used.
9. Then proceed into Docufinder-style metadata/filename indexing and
   Dedoc-style ParsedDocument IR so search becomes faster and more complete
   without changing the high-level product contract.

Current implementation status:

- Implemented the Relay document-search contract, validators,
  OpenAI-compatible tool schema, approved-alias policy, and prompt-template ids.
- Implemented provider/manifest seed metadata and Copilot gateway routing so
  `relay_document_search` is preferred and uncontracted aliases fall back to
  guarded low-level handling instead of masquerading as the high-level workflow.
- Implemented a conservative filename/FileMetadata-only executor and a
  Relay-owned job lifecycle coordinator for progress callbacks, cancellation,
  timeout-to-partial results, retry tokens, and duplicate-submit attachment.
- Extended the initial executor with bounded `.txt` / `.md` / `.csv` content
  confirmation so safe text matches can produce `content_confirmed` anchors and
  Evidence Pack items without overlapping future Office/PDF structured parsing.
- Added a durable Docufinder-style metadata cache for path/name/type/size/mtime
  discovery state. AionUi MCP sessions enable it by default, while extracted
  text, Office/PDF contents, ParsedDocument IR, previews, and embeddings remain
  out of this cache.
- Added an atomic cache-write path with a stale-recoverable single-writer lock
  so multiple Relay/AionUi sessions do not corrupt the metadata cache.
- Added the first Dedoc-compatible ParsedDocument IR module with
  `ReaderOutput`, `NormalizedDocument`, `ParsedDocument`, `DocumentContent`,
  `TreeNode`, table/cell records, reader capabilities, parser profile metadata,
  and text/CSV readers. Existing `.txt` / `.md` / `.csv` content confirmation
  now produces evidence anchors from this IR instead of ad hoc line scans.
- Added explicit reader-capability reporting for Phase -1 candidates. When a
  request requires evidence but only Office/PDF filename candidates are
  available, the executor now returns `partial` with `content_reader_unavailable`
  warnings instead of silently treating the result as confirmed.
- Added a deterministic QueryPlan module with shared CJK/NFKC normalization,
  accounting synonym expansion, period/quarter hints, file-type hints, and
  content-required confirmation policy. The executor now consumes that plan
  instead of keeping query expansion as ad hoc inline logic.
- Added the first optional PDF text reader on the same ParsedDocument IR. When
  a LiteParse-compatible runner is available, `.pdf` files can produce
  document-level text evidence; when it is missing or fails, PDF results remain
  explicit `content_reader_unavailable` candidates rather than speculative
  evidence.
- Extended the AionUi release/overlay path so the Relay-branded AionUi package
  prepares and bundles the Windows Node sidecar plus `liteparse-runner`, and
  the startup gateway registers `RELAY_BUNDLED_NODE` /
  `RELAY_LITEPARSE_RUNNER_ROOT` for PDF evidence extraction.
- Added an optional durable ParsedDocument IR cache keyed by source
  FileMetadata version, parser version, IR version, capability registry,
  pattern set, and parser parameters. It is separate from the metadata cache
  because it contains extracted document content, and it is only used when
  explicitly enabled through executor options or environment policy.
- Added a lightweight Office Open XML reader for `.docx`, `.xlsx`, `.xlsm`,
  and `.pptx` on the same ParsedDocument IR. Word paragraphs, PowerPoint slide
  text, and Excel sheet rows/cells can now become `content_confirmed` evidence
  without launching Office, while hidden-sheet and missing cached-formula states
  are surfaced as parser warnings.
- Added the first ParsedDocument cache quota policy. The content-bearing IR
  cache now has deterministic entry/byte limits, invalid-record cleanup,
  oldest-first eviction, environment/option overrides, and quota summaries in
  executor diagnostics without exposing document contents.
- Added an explicit ParsedDocument cache at-rest policy gate. If policy
  requires protection and no external/OS protection is declared, Relay still
  parses the file for the current search but refuses to read or write
  content-bearing cache records and reports the policy state in diagnostics.
- Added richer Evidence Pack anchors for parsed documents. Spreadsheet/CSV
  matches now prefer `cell_excerpt` anchors with table id, sheet, cell address,
  row/column, hidden state, and cached-formula state, while PDF/text anchors
  expose parser name, page anchor availability, extraction method, and anchor
  confidence.
- Added the first advisory document-search index coordinator. It creates a
  single-writer lock, records lock owner/heartbeat/active job ids, recovers
  stale locks, emits health events, and reports coordinator state in executor
  diagnostics without changing the AionUi beginner workflow.
- Added a search quality gate report. The executor now classifies coverage,
  evidence, and freshness confidence, marks candidate-only or incomplete
  searches, and exposes whether the Evidence Pack is safe to send to Copilot for
  final wording.
- Added directory diversity to broad filename ranking so one deep folder cannot
  consume the whole first result batch when other matching folders exist.
- Added Query Trace diagnostics for document search. Relay now records the
  request, query normalization, index coordination, metadata/content scan,
  ranking, quality gate, and redaction decisions without relying on Copilot
  prose to explain search state.
- Added the first Evidence Pack redaction boundary. Evidence is local-only by
  default; optional Copilot polish can only receive bounded redacted snippets
  when policy is explicitly `snippets_allowed` and the quality gate permits it.
- Added a durable document-search job store. With `useJobStore` enabled, a
  second Relay/AionUi process can attach to an already running equivalent search
  instead of starting a duplicate scan, and stale active jobs are downgraded to
  `abandoned` before a new scan starts.
- Added a Docufinder-style filename/path index contract. The executor now builds
  an in-memory index from FileMetadata for ranking and diagnostics, and AionUi
  MCP sessions persist a metadata-backed filename index by default without
  storing extracted document contents.
- Added a per-root document-search index report. Results now carry a local-only
  diagnostic summary of scanned files, metadata-ready files, filename-searchable
  files, content-ready files, inaccessible paths, extension filtering, and cache
  state so support can explain incomplete shared-folder searches.
- Added result grouping for backup/copy/version variants. Broad searches now
  collapse clear variant families under a representative result, expose the
  grouped member count to AionUi display cards, and keep normal period/date
  differences visible instead of hiding them.
- Added metadata-only folder role classification. Search results now identify
  likely filing, output, audit, backup, work, source, and review folders from
  path segments, expose beginner-safe labels in the display model, and report
  role counts in diagnostics.
- Added the first Product Search Result contract. Each executor result now
  carries `RelayDocumentSearchProductResult.v1` fields for match/evidence/index
  state, score breakdown, anchors, preview/open state, action descriptors,
  stable selection keys, and Copilot-independent preview/open/citation flags.
  The display adapter now exposes preview/open labels and capped-result
  continuation metadata for `さらに表示`.
- Added result-level source provenance to Product Search Results. Executor
  results now expose `source_indexes` and `primary_source_index` so AionUi can
  distinguish metadata, filename index, fallback filename matching,
  ParsedDocument IR, derived content index, table/cell matches, preview anchors,
  and user-memory boosts without relying on Copilot prose.
- Added deterministic warning-aware ranking. Search now records base/final
  scores, applies explicit penalties for filename-only or unconfirmed-content
  candidates, uses stable tie-breakers, and reports warning-penalty diagnostics
  through Query Trace.
- Added the first Evidence Pack contract. Executor results now include
  `RelayDocumentSearchEvidencePack.v1` with candidate files, content evidence,
  minimal document metadata, parser identity, coverage, query-plan facts,
  warnings, and an explicit local-first AI boundary for future Copilot polish
  validation.
- Added the first deterministic local-draft contract. Executor results now
  include `RelayDocumentSearchLocalDraft.v1`, generated only from the Evidence
  Pack and Quality Gate, with citation ids, caveats, next actions, and a
  strict rule that Copilot may replace it only after evidence-citation
  validation.
- Added the first citation-bound Copilot polish validation contract. Executor
  diagnostics now include `RelayDocumentSearchPolishValidation.v1`, which
  accepts only `RelayDocumentSearchPolishedAnswer.v1` candidates tied to the
  current Evidence Pack/local draft citations, requests at most one strict
  repair, records prompt template ids plus Relay/AionUi/Copilot correlation
  fields, and otherwise keeps the deterministic local draft.
- Added the first Copilot polish request contract. Executor results now include
  `RelayDocumentSearchPolishRequest.v1`, which builds a
  `relay_answer_polish_prompt.v1` payload only from redacted Evidence Pack
  snippets and records why local-only or low-quality states cannot be sent.
- Added the first optional Copilot polish provider invocation boundary.
  Executor runs a `RelayDocumentSearchPolishProvider.v1` handoff only when an
  injected runner or `RELAY_DOCUMENT_SEARCH_COPILOT_POLISH=1` enables it,
  sends the prepared prompt to an OpenAI-compatible provider without tools or
  original files, and still accepts output only through the existing
  citation-bound polish validation.
- Added the first final-answer selection contract. Executor results now include
  `RelayDocumentSearchAnswer.v1`, which commits the validated local draft first
  and replaces it at most once only when citation-bound Copilot polish is
  accepted.
- Added the first optional Copilot state contract. Executor diagnostics now
  include `RelayDocumentSearchCopilotState.v1`, making warming, sign-in,
  disconnected, capture, timeout, rate-limit, tenant, policy-disabled,
  skipped, rejected, and accepted polish states visible while explicitly
  keeping local search results, local drafts, preview/open, cancel, and retry
  independent from Copilot availability.
- Started Phase 5 freshness sync with a metadata-only freshness contract.
  Executor diagnostics now include `RelayDocumentSearchFreshness.v1` reports
  when an expired metadata cache is refreshed, comparing previous and current
  size/mtime/source metadata versions and marking changed, created, or deleted
  file metadata as `content_stale` without storing extracted contents.
- Added first-pass high-confidence move freshness. `RelayDocumentSearchFreshness.v1`
  now collapses unique size/mtime/extension delete-create pairs into `moved`
  changes, preserves the previous stable file id for that event, and records
  tombstones for deleted or moved paths without migrating content evidence.
- Added first-pass ACL/access freshness. Metadata records can carry separate
  metadata/content/preview/open access snapshots, freshness reports now mark
  access changes as stale/unavailable evidence, and result cards downgrade
  preview/open/citation state when current-user access is denied, offline,
  locked, missing, or policy-blocked.
- Added first-pass high-confidence move migration for user memory. Pins and
  recent-search result paths/file ids are remapped only from
  `RelayDocumentSearchFreshness.v1` `moved` events with `move_confidence: high`,
  before ranking applies user-memory boosts. Derived-index ownership migration
  remains a separate future step.
- Added first-pass Dedoc-style progressive disclosure to the display contract.
  Result cards keep the default view simple while detail/support sections carry
  evidence locations, table/cell or structure anchors, attachment warnings, and
  Query Trace facts for AionUi drawers or support views.
- Completed the first-pass Phase 1.7 state-label surface. AionUi display cards
  now have beginner-safe labels for filename-only, content-backed,
  table-backed, stale, failed, skipped, metadata/content/table index, preview,
  and open states.
- Started Phase 3 with a rebuildable derived content index contract. Executor
  content evidence now comes from `RelayDocumentSearchDerivedContentIndex.v1`
  entries built from `ParsedDocument` IR, with `RelayDocumentSearchPreviewAnchor.v1`
  anchors for text and table/cell matches.
- Added first-pass preview spans for derived content matches.
  `RelayDocumentSearchPreviewSpan.v1` now carries compact snippets,
  matched terms, and deterministic highlight ranges alongside preview anchors
  so AionUi preview/details surfaces can highlight evidence without Copilot
  restating local document content.
- Added first-pass durable derived-content-index caching. The cache records
  source metadata/parser lineage, commits through temp-file staging plus atomic
  rename, rejects stale source metadata, and participates in
  `clear-derived-caches` / `rebuild-derived-indexes` maintenance.
- Added first-pass durable derived search-store materialization.
  `RelayDocumentSearchDerivedSearchStore.v1` is stored with derived-content
  cache records and carries normalized keyword rows plus preview span seeds, so
  cached documents can be searched from durable local artifacts without
  rebuilding the full ParsedDocument-derived entry list.
- Added first-pass SQLite/FTS readiness hardening.
  `RelayDocumentSearchIndexDbHealth.v1` now makes the active JSON-store backend,
  future SQLite/FTS required tables, content-bearing tables, DB-only
  maintenance actions, and unsupported/not-enabled state explicit in index
  maintenance results.
- Added first-pass optional SQLite/FTS backend initialization.
  `RelayDocumentSearchIndexDb.v1` creates the local SQLite schema and FTS5
  tables when explicitly enabled, while index maintenance can run real WAL
  checkpoint and compact actions against that backend without adding a package
  dependency.
- Added first-pass SQLite/FTS write/search helpers.
  `RelayDocumentSearchIndexDb.v1` can mirror cached file metadata and
  `RelayDocumentSearchDerivedSearchStore.v1` rows into local SQLite FTS tables
  and run bounded content/table FTS searches. The executor still uses the
  JSON-backed derived search store by default; runtime cutover, migration, and
  ranking integration remain future work.
- Added optional executor-side SQLite/FTS mirroring.
  When `useIndexDb` or `RELAY_DOCUMENT_SEARCH_INDEX_DB=1` enables the backend,
  the executor writes filtered FileMetadata and derived search-store rows into
  SQLite/FTS, runs a bounded FTS probe, and reports content-free diagnostics.
  Product ranking and evidence anchors still come from the JSON-backed derived
  store until the later cutover.
- Added first-pass SQLite/FTS ranking integration for content-confirmed
  results. Enabled executor runs now add a `sqlite_fts_index` source index and
  a bounded `sqlite_fts` score component only when the same file already has
  JSON-derived evidence anchors.
- Added guarded SQLite/FTS evidence-anchor promotion.
  `RelayDocumentSearchIndexDb.v1` search rows now carry preview/source
  metadata and serialized anchor JSON, with best-effort migrations for existing
  preview-span tables. The executor can promote SQLite/FTS-only hits to
  content-confirmed evidence only when source metadata is fresh and anchor plus
  preview data are present; stale or incomplete rows are counted but not
  promoted.
- Added first-pass SQLite/FTS schema migration hardening.
  `RelayDocumentSearchIndexDb.v1` now reports schema revision `2`, creates an
  `index_schema_migrations` audit table, records preview-span expansion
  migrations, sets SQLite `user_version`, and exposes migration state through
  index maintenance health.
- Added first-pass SQLite/FTS cutover diagnostics.
  Runtime metadata writes, derived-store writes, and FTS searches now propagate
  schema revision and migration state into `diagnostics.indexDb`, so enabled
  executor runs can be evaluated for cutover readiness without consulting only
  maintenance reports.
- Added first-pass SQLite/FTS cutover readiness summary.
  Enabled executor runs now include `diagnostics.indexDb.cutoverReadiness` with
  status/reason codes plus schema, migration, write, search, and evidence
  promotion readiness booleans for UI/support consumption. Backend write/search
  report errors also participate in the readiness status and reasons.
- Added first-pass SQLite/FTS result-usage diagnostics.
  Enabled executor runs now include `diagnostics.indexDb.resultUsage`, separating
  FTS-scored candidate/result counts from FTS-promoted evidence counts and total
  returned SQLite score.
- Added first-pass SQLite/FTS sync-journal cutover telemetry.
  Metadata-only search completion events now record index DB enablement,
  readiness status/reasons, matched-file count, scored-result count, and
  promoted-result count without storing extracted content.
- Added first-pass SQLite/FTS Query Trace cutover facts.
  `RelayDocumentSearchQueryTrace.v1` now includes an `index_db` support stage
  with enablement, readiness, result-usage, stale-row, and backend error
  counters without storing extracted content.
- Added first-pass SQLite/FTS support display cutover facts.
  AionUi support detail items now surface Query Trace `index_db` readiness,
  result-usage, stale-row, and error counters while omitting DB paths and
  document content.
- Added first-pass metadata-only document-search support export.
  `RelayDocumentSearchSupportExport.v1` summarizes coverage, result metadata,
  selected diagnostics, and SQLite/FTS cutover state without original files,
  raw DB paths, or extracted text by default. Evidence snippets require an
  explicit selected-snippet mode.
- Added first-pass support-export cache quota/protection summary.
  Support exports now summarize ParsedDocument cache protection policy, quota
  pressure, eviction counts by reason, and derived-index cache activity without
  exposing cache directories or evicted record paths.
- Added first-pass SQLite/FTS stale-row reason diagnostics.
  SQLite/FTS rows that cannot be promoted to evidence now record reason counts
  such as source-metadata mismatch, missing parsed-document uid, missing
  preview text, or missing anchor data. Executor diagnostics, Query Trace,
  support display details, and metadata-only support export all expose the
  counts without DB paths or document content.
- Added first-pass SQLite/FTS search-limit diagnostics.
  Bounded FTS searches now report max rows, raw row counts, dropped row counts,
  and truncation state. Query Trace, sync-journal telemetry, and support
  details mark result-limit truncation as a degraded cutover condition without
  exposing raw FTS rows or document text.
- Added first-pass SQLite/FTS outside-scan diagnostics.
  FTS rows returned for file ids outside the current filtered scan set are now
  counted separately, excluded from evidence promotion, surfaced through Query
  Trace, sync-journal metadata, support details, and metadata-only support
  export, and treated as a degraded cutover condition without exporting raw
  rows or document text.
- Added first-pass SQLite/FTS current-scan coverage diagnostics.
  FTS rows returned for file ids inside the current filtered scan set are now
  counted separately from outside-scan rows and surfaced through Query Trace,
  sync-journal metadata, support details, and metadata-only support export
  without exporting raw rows or document text.
- Added first-pass SQLite/FTS fresh-row scoring hardening.
  SQLite/FTS ranking now scores only current-scan rows that pass source
  metadata, ParsedDocument uid, preview text, and anchor validation. Stale or
  incomplete current rows are diagnosed but no longer boost ranked results or
  count as fresh cutover evidence.
- Added first-pass SQLite/FTS matched-file usage split.
  `diagnostics.indexDb.resultUsage` now separates raw FTS matched files from
  current-scan, fresh-current-scan, and outside-current-scan matched files, and
  surfaces that split through Query Trace, support details, and metadata-only
  support export.
- Added first-pass SQLite/FTS stale current-scan diagnostics.
  Stale/incomplete FTS rows that belong to the current filtered scan set are
  now counted as stale current-scan rows/files and surfaced through Query
  Trace, sync-journal metadata, support details, and metadata-only support
  export.
- Added first-pass SQLite/FTS stale matched-file usage split.
  `diagnostics.indexDb.resultUsage` now includes
  `staleCurrentScanMatchedFileCount` alongside raw, current, fresh, and
  outside matched-file counts so support surfaces can identify stale current
  SQLite/FTS matches without raw rows or document text.
- Added first-pass SQLite/FTS sync-journal matched-file split.
  Metadata-only `search_completed` details now record current, fresh, stale
  current, and outside SQLite/FTS matched-file counts alongside the raw FTS
  matched-file count without raw rows or document text.
- Added first-pass SQLite/FTS sync-journal stale reason summary.
  Metadata-only `search_completed` details now record stale SQLite/FTS row
  counts and compact `reason=count` summaries without raw rows, DB paths, or
  document text.
- Added first-pass SQLite/FTS sync-journal readiness breakdown.
  Metadata-only `search_completed` details now record schema, migration, write,
  search, and evidence-promotion readiness booleans alongside cutover status
  and reason codes without raw rows, DB paths, or document text.
- Added first-pass SQLite/FTS Query Trace readiness breakdown.
  Query Trace `index_db` facts, support details, and metadata-only support
  export now carry schema, migration, write, search, and evidence-promotion
  readiness booleans without raw rows, DB paths, or document text.
- Added first-pass SQLite/FTS support export normalization.
  Metadata-only support export now allowlists cutover readiness and
  result-usage fields so unexpected diagnostics cannot leak DB paths, raw rows,
  or document text through `diagnostics.indexDb` or Query Trace `index_db`
  facts.
- Added first-pass SQLite/FTS candidate score telemetry.
  `resultUsage` now separates candidate score totals/max scores from
  returned-result score totals/max scores, and surfaces the split through Query
  Trace, support details, metadata-only support export, and sync-journal
  search completion metadata without raw rows, DB paths, or document text.
- Added first-pass SQLite/FTS non-returned candidate telemetry.
  `resultUsage` now records scored/promoted candidates and SQLite/FTS score
  totals that did not survive into the returned result set, while sync-journal
  completion metadata records scored/promoted candidate counts alongside
  result counts without raw rows, DB paths, or document text.
- Added first-pass SQLite/FTS title/location ranking boost.
  Fresh SQLite/FTS rows now receive small title and location-label boosts on
  top of the existing text/table base score and cap, so preview-span metadata
  can affect deterministic ranking without raw rows, DB paths, or document
  text in diagnostics.
- Added first-pass SQLite/FTS metadata-boost diagnostics.
  Executor diagnostics now count fresh SQLite/FTS rows and files that received
  title/location ranking boosts, and surface those counts through Query Trace,
  support details, metadata-only support export, and sync-journal completion
  metadata without raw rows, DB paths, or document text.
- Added first-pass SQLite/FTS metadata-boost split diagnostics.
  The same support surfaces now split fresh SQLite/FTS metadata boosts into
  title-derived and location-label-derived row/file counts, while preserving
  the combined counters for compatibility and avoiding raw rows, DB paths, or
  document text.
- Added first-pass SQLite/FTS score-cap diagnostics.
  Result usage now records candidate/returned uncapped score totals, score-cap
  loss totals, and capped candidate/result counts so ranking saturation is
  visible in Query Trace, support details, metadata-only support export, and
  sync-journal completion metadata without changing capped ranking behavior or
  exposing raw rows, DB paths, or document text.
- Added first-pass index health event surfacing.
  Index maintenance actions can now record metadata-only health events for
  completed/failed repairs, and executor runs carry recent health event
  summaries into Query Trace, AionUi support details, and metadata-only support
  export without exposing DB paths or document text. Index DB health now also
  reports missing required tables and pending required migrations as explicit
  metadata-only readiness facts, incomplete ParsedDocument staging counts, plus
  WAL/SHM sidecar sizes and whether a WAL checkpoint is recommended.
- Added first-pass derived-index move ownership diagnostics.
  `RelayDocumentSearchDerivedIndexOwnership.v1` records high-confidence moves as
  transfer-on-rebuild events owned by the current file id/source metadata while
  explicitly blocking implicit cache reuse when path or metadata lineage
  changes.
- Added optional high-confidence move migration for ParsedDocument caches.
  `RelayParsedDocumentCacheMoveMigration.v1` rewrites an existing content cache
  record to the current file id/path/source metadata only after freshness has
  identified a high-confidence move with matching size and modified time.
- Added first-pass watcher/periodic sync reconciliation diagnostics.
  `RelayDocumentSearchSyncReconciliation.v1` summarizes watcher event freshness
  and periodic-scan due state from the metadata-only sync journal, giving
  support surfaces an explainable fallback path for mapped/network folders and
  watcher-missed events without persisting document contents.
- Added local user-memory support for pinned files/folders and recent searches.
  The executor applies small ranking boosts for user-confirmed files/folders,
  records recent searches in the AionUi MCP path, and keeps this store separate
  from metadata, filename indexes, and content-bearing ParsedDocument caches.
- Added safe cache maintenance actions for document search. The default
  `clear-derived-caches` repair removes only rebuildable filename and
  ParsedDocument caches while preserving metadata, job snapshots, pins, and
  search history.
- Added a metadata-only document-search sync journal. AionUi MCP sessions now
  enable it by default so local diagnostics can explain recent search starts,
  metadata scans, content scans, inaccessible paths, truncation, cancellation,
  timeout, and future filesystem freshness events without persisting extracted
  document contents.
- Added the first scheduler/backpressure report for document search. Results
  now expose inline executor queue depth, promoted content-inspection count,
  throttled roots, pause/busy/throttle reasons, per-root concurrency, writer
  busy state, and scan/content budgets so support can explain waits and partial
  results.
- Added first-pass background scheduler execution for document search.
  `RelayDocumentSearchBackgroundScheduler.v1` provides an in-process bounded
  queue with pause/resume, cancellation, foreground promotion, global
  concurrency, and per-root concurrency so foreground query-related work can
  run ahead of idle indexing without creating unbounded background work.
- Added first-pass watcher/periodic producer wiring for the background
  scheduler. `RelayDocumentSearchSyncProducer.v1` starts filesystem watcher
  handles and periodic scan timers, records metadata-only sync journal events,
  and feeds `watcher_sync` / `periodic_sync` work into
  `RelayDocumentSearchBackgroundScheduler.v1`.
- Added startup/root-registration wiring and bounded recursive watcher
  hardening for the sync producer. The MCP stdio entry can opt in with
  `RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER=1`, uses the current AionUi workspace
  root, and the producer expands watchers across subdirectories with explicit
  depth/count/exclude limits before feeding scheduler work.
- Added first-pass production watcher policy defaults. Network-share-looking
  roots now default to periodic-only sync instead of starting filesystem
  watchers, while local roots keep watcher plus periodic coverage and the
  policy reason is exposed per root in sync producer snapshots.
- Added first-pass index maintenance actions. Relay can now run metadata-only
  integrity checks over local document-search JSON stores and trigger a safe
  rebuild of derived filename/ParsedDocument caches; DB-only operations report
  `not_applicable` until a persistent index DB exists.
- Implemented an AionUi-facing bridge that validates tool calls, rejects
  untrusted aliases, invokes the job lifecycle runner, and emits
  `RelayDocumentSearchResult.v1` tool results.
- Implemented a Relay document-search stdio MCP entry and AionUi overlay patch
  so aionrs sessions receive the high-level `relay_document_search` tool with
  the current AionUi workspace root.
- Implemented a renderer-neutral display adapter that converts
  `RelayDocumentSearchResult.v1` into beginner-safe result cards/status copy for
  AionUi chat and preview surfaces.
- Phase 1.5, Phase 1.6, and the first-pass Phase 1.7 product result/display
  contracts are implemented. Phase 4 now has first-pass Evidence Pack,
  redaction, local draft, Copilot polish request, polish-validation,
  final-answer selection, and optional Copilot state boundaries. Phase 5 has a
  metadata freshness report with move tombstones, ACL/access-change freshness,
  user-memory/content-cache migration for high-confidence moves, sync
  reconciliation diagnostics, first-pass background scheduler execution,
  watcher/periodic scheduler producers, opt-in MCP startup wiring, bounded
  recursive watcher coverage, optional SQLite/FTS schema initialization, and an
  optional provider invocation boundary for prepared polish requests. Recent
  index health events, missing-table/pending-migration health facts, and
  incomplete-staging/WAL-checkpoint recommendations now reach Query
  Trace/support export paths where applicable. Preview rebuild,
  scheduler-backed index maintenance, full rescan, root rebuild, and
  retry-failed-files are now first-pass concrete actions. Retry-failed-files
  also records/selects metadata-only failed-file retry candidates and
  invalidates only matching content caches plus SQLite FTS rows when candidates
  exist. SQLite/FTS cutover diagnostics now also flag FTS rows outside the
  current filtered scan set, report current-scan FTS coverage, and prevent
  stale/incomplete FTS rows from contributing SQLite ranking score. Result
  usage now splits raw, current, fresh, stale current, and outside matched-file
  counts, and stale current-scan row/file counts are explicit support
  diagnostics. Sync-journal events now carry the same matched-file split plus
  compact stale reason summaries and readiness booleans; Query Trace and
  support surfaces now preserve the same readiness breakdown, with support
  export allowlisting readiness and result-usage fields to avoid unexpected
  diagnostic leakage. Result usage now also separates candidate and returned
  score totals/max scores for cutover tuning, and identifies scored/promoted
  SQLite/FTS candidates that did not survive into returned results. Fresh
  SQLite/FTS rows now also apply small title/location metadata boosts within
  the existing score cap, with combined and title/location-split metadata-only
  boost row/file counts available in support surfaces. Result usage also now
  reports uncapped SQLite/FTS score totals, cap-loss totals, and capped
  candidate/result counts for score-saturation tuning. The abstract broader
  SQLite/FTS cutover tuning bucket is now closed for the MVP diagnostics slice;
  remaining work is split into the follow-up tasks below.

Follow-up tasks after MVP diagnostics:

- WDS01: Completed local SQLite/FTS search-quality evaluation.
  `docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_EVALUATION.md` records the
  repository-local docs baseline, privacy boundary, expected-hit outcomes,
  stale-row/cap-loss diagnostics, and score-weight recommendation. The run
  found SQLite/FTS usable as advisory data but not ready for primary cutover:
  all four probes reported degraded index DB state from bounded FTS truncation,
  and only one of four cases returned an expected file.
- WDS02: Completed primary-path SQLite/FTS cutover gate.
  The executor now supports `disabled`, `shadow`, `primary`, and `rollback`
  primary modes through Relay-controlled options/environment flags. SQLite/FTS
  becomes the active primary path only when readiness is `ready`, the FTS probe
  is not truncated, stale/outside-scan rows are absent, write/search errors are
  absent, and fresh current-scan FTS evidence exists. Otherwise the gate records
  rollback to the filename/content path in Query Trace, support export, display
  support details, and sync-journal metadata.
- WDS03: Completed synthetic large-folder SQLite/FTS performance tuning.
  `docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_PERFORMANCE.md` records synthetic
  600-file / 1,800-row write, search, DB-size, WAL/SHM, checkpoint, and
  scheduler-backpressure measurements. The executor now separates the FTS probe
  cap from citation anchors: candidate scoring defaults to 20 FTS rows, is
  configurable through Relay-controlled options/environment, and remains
  bounded at 100 rows while evidence anchors stay capped at 3.
- WDS04: Completed user-facing Workspace Search index status UX.
  The display adapter now exposes beginner-safe index status, active path
  labels, partial-result explanations, and retry/rebuild/status actions without
  DB paths, raw FTS rows, or document text. Product result action models also
  add retry/rebuild affordances for stale or failed index states.

New follow-up task list after WDS01-WDS04:

- WDS05: Completed cache quota, retention, and at-rest protection gate.
  ParsedDocument IR cache policy/quota diagnostics now extend to the
  content-bearing derived-content-index cache. The executor accepts
  Relay-controlled derived-cache quota/protection options, records policy,
  quota, eviction, and write-error diagnostics, and forwards metadata-only
  summaries through the index report and support export without raw paths,
  snippets, raw DB rows, or document text. Metadata, filename, user memory,
  ParsedDocument IR, derived search/preview indexes, and SQLite FTS remain
  separate stores for retention and cleanup policy.
- WDS06: Completed scoped root removal and derived-cache cleanup.
  A confirmed `remove-root` maintenance path now deletes only the selected
  root's metadata, parsed payload cache records, derived-content-index cache
  records, SQLite FTS rows, parsed-document rows, and preview spans. It
  preserves unrelated roots, jobs, user memory, pins, and search-history policy;
  the current implementation has no separate short-lived root-scoped result
  cache outside those stores.
- WDS07: Completed transactional content-index commit semantics.
  ParsedDocument and derived-content-index writes now stage records before
  promotion, SQLite derived FTS/table/preview rows are written in one
  transaction, and the index coordinator atomically swaps an active content
  pointer only after required artifacts are complete. Failed staging, DB writes,
  or promotion attempts keep any previous pointer usable while marking it
  stale, with metadata-only commit diagnostics and health events.
- WDS08: Completed schema migration and rebuild recovery gates.
  Metadata cache and ParsedDocument cache now expose version inspection records;
  newer durable/content-bearing records are preserved read-only instead of being
  overwritten. SQLite/FTS detects newer `user_version` stores and returns a
  read-only downgrade report without running schema SQL or migrations. Index
  maintenance now reports a metadata-only schema migration gate across
  metadata, query analyzer, parser pipeline, ParsedDocument cache, derived
  indexes, SQLite/FTS, Evidence Pack, result contract, and preserved user
  state, with Query Trace, support export, and health events carrying only
  counts/statuses.
- WDS09: Completed golden-query search quality regression gate.
  `scripts/relay-document-search-golden-query-gate.mjs` now creates a
  synthetic Markdown corpus and fails on expected top-k misses, folder skew,
  forbidden false positives, unsupported final-answer policy, missing warning
  codes, or latency budget regression. The committed
  `docs/WORKSPACE_DOCUMENT_SEARCH_GOLDEN_QUERIES.md` report records only
  aggregate counts, warning codes, and synthetic labels; the quality gate and
  Query Trace can also carry a metadata-only `golden_query_regression` blocker
  when release promotion is blocked.
- WDS10: Completed deterministic ranking and grouping score breakdown.
  Product results now carry `RelayDocumentSearchScoreBreakdown.v1` inside
  `score_breakdown`, preserving legacy numeric keys while exposing component
  contributions for filename, path, keyword, SQLite/FTS, content, table/cell,
  recency tie-breaks, pin/history, grouping, warning penalties, and hybrid
  merge totals. Result grouping, Query Trace, display cards, and support export
  expose metadata-only score summaries without document contents.
- WDS11: Completed parser structure-profile validation gates.
  ParsedDocument IR now records `RelayParsedDocumentStructureProfile.v1`
  summaries for the selected parser profile, validates tree nodes, tables,
  cells, annotations, metadata, warnings, and attachments as separate fields,
  downgrades lossy or unsupported reader output with parser warnings, rejects
  flattened text-only parser output, and carries metadata-only profile
  summaries through the ParsedDocument cache, derived-content index, Evidence
  Pack, executor diagnostics, and tests.
- WDS12: Completed AionUi result-flow continuation and stable selection.
  `RelayDocumentSearchDisplay.v1` now carries
  `RelayDocumentSearchResultFlow.v1` with capped batches, show-more/refine
  actions, stable selection-key state, visible partial/index states, and
  Copilot prose marked secondary to structured result cards. Bridge/MCP
  responses expose a Relay-branded AionUi result-flow envelope while OpenAI tool
  messages keep the raw search result contract.

Change targets:

- `apps/desktop/src-tauri/crates/desktop-core/src/copilot_adapter.rs`
- `apps/desktop/src-tauri/src/opencode_runtime.rs`
- Relay bridge/status/evidence contract modules introduced by the plan
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchExecutor.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexCoordinator.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidenceRedaction.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchQualityGates.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryTrace.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobLifecycle.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchBridge.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchDisplay.ts`
- `integrations/aionui/overlay/src/process/utils/relayDocumentSearchMcpStdio.ts`
- `integrations/aionui/overlay/src/process/utils/relayGateway.ts`
- `apps/desktop/src-tauri/binaries/copilot_server.mjs`
- `apps/desktop/src/**` legacy diagnostic surfaces only when needed for
  compatibility checks
- Relay-branded AionUi overlay/fork skill entries and lightweight result
  renderers introduced by
  `docs/AIONUI_RELAY_MIGRATION.md`
- `apps/desktop/src-tauri/bootstrap/aionui-relay.json`
- `scripts/apply-aionui-overlay.mjs`
- `docs/WORKSPACE_DOCUMENT_SEARCH_PLAN.md`
- `docs/AIONUI_RELAY_MIGRATION.md`
- `docs/IMPLEMENTATION.md`

Acceptance criteria:

- A registered workspace root starts a metadata scan immediately and remains
  able to show filename candidates from an in-memory filename cache before
  content indexing completes; those candidates are progress, not final findings.
- Search UX and file actions work through AionUi without Copilot and without
  network access for already available local/shared-folder data.
- Copilot integration never becomes the search source of truth: local results
  and local drafts render when Copilot is unavailable, prompt versions and
  correlation ids are recorded, and unsupported/duplicated/truncated Copilot
  polish is rejected instead of displayed.
- Workspace, metadata, filename, content, parser/index, result, and evidence
  responsibilities are separated behind AionUi skills or extension points, with
  Relay defining only the bridge contracts needed for Copilot/AionUi handoff.
- Sync journal and product search-result objects expose created/modified/deleted
  events, preview/open actions, match mode, evidence state, index state, score
  breakdown, anchors, and warnings.
- Workspace Document Search is implemented as AionUi skills plus lightweight
  result renderers inside the Relay-branded AionUi shell; AionUi owns the shell,
  navigation, conversations, skill invocation UX, approvals, preview surfaces,
  file actions, search interaction, and history while Relay owns provider
  connectivity, tool-call normalization, status translation, skill/result
  contracts, diagnostics, and evidence validation/redaction boundaries.
- Current UX recheck keeps the SolidJS/Tauri shell as a legacy diagnostics-only
  surface. It cannot expose Workspace Document Search as the normal product path
  or be used as evidence that the beginner AionUi search UX is ready.
- The AionUi provider seed and copied overlay force Workspace Document Search
  guard keys, including hidden beginner terms, so upgraded profiles cannot
  preserve stale AionUi defaults that conflict with the Relay UX contract.
- The AionUi provider seed and copied overlay also force a curated assistant
  catalog: `資料を探す` and `Officeファイルを編集する` are the beginner-facing
  choices; legacy Word/Excel/PowerPoint creators and unrelated upstream builtin
  presets are hidden or advanced-only.
- The AionUi / Docufinder / Dedoc collision boundary has one owner per concern:
  AionUi owns visible routes, panels, preview/open controls, approvals,
  conversation storage, skill selection, skill invocation UX, normal file/search
  interaction, and result rendering; Relay owns the Copilot provider bridge,
  tool-call normalization, seed/defaults, skill/result schemas, status
  translation, evidence validation, diagnostics, and privacy/redaction
  boundaries.
- The legacy Relay SolidJS desktop shell remains diagnostic-only and is not a
  second production document-search UI.
- UX follows a Docufinder-style local search information architecture expressed
  through concrete AionUi primitives: `/guid` curated task entries,
  `GuidInputCard`, `GuidActionRow` folder selection, SendBox slash commands,
  `@` file mentions, existing workspace controls, structured result renderer,
  preview/evidence details, optional answer content, and advanced drawer for
  diagnostics.
- AionUi's `/guid` task chips come from actual preset assistant records. Relay
  therefore seeds `relay-workspace-search` as one Relay-managed AionUi preset
  assistant named `資料を探す` instead of relying on metadata-only labels or
  splitting search and summary into two beginner-facing choices.
- `資料を探す` is backed by a high-level document-search contract. When AionUi
  or the execution backend advertises `relay_document_search`,
  `relay-document-search`, `workspace_document_search`, `workspace-search`, or
  `find-files`, Relay routes Copilot to that tool before raw `glob`, `grep`,
  or `read`, so Copilot supplies intent and query context while Relay/AionUi own
  search planning, coverage, skew checks, reading, and evidence packaging.
- The high-level contract is not just prompt guidance: AionUi/OpenCode must
  advertise `relay_document_search` or an approved alias in the tool catalog,
  and Relay must provide an executor that returns
  `RelayDocumentSearchResult.v1` with status, progress, coverage, results,
  evidence, display, and diagnostics fields.
- The high-level contract includes concrete schema/validator files, a
  model-facing OpenAI tool schema, alias validation, executor ownership, and a
  job lifecycle for progress, cancel, retry, duplicate-submit handling,
  timeouts, and partial results.
- The implementation also includes single-writer store locks, stale-lock
  recovery, shell-free subprocess execution, cache quota and at-rest protection
  policy, schema upgrade/rollback behavior, Windows long-path/DFS/OneDrive
  handling, enterprise/local-only policy, local log/support-export redaction,
  golden-query release gates, feature-flag promotion/rollback, and a
  warning-code-to-Japanese-copy map.
- Low-level `glob`, `grep`, `read`, `bash`, and parser calls are allowed only
  inside the executor or in advanced/support flows. If Copilot tries to use
  them as the first step for a beginner document-search request while the
  high-level tool is advertised, Relay rejects the call before execution.
- Search starts through AionUi's normal send flow (`GuidInputCard`,
  `GuidActionRow`, or `SendBox` send). Do not add a standalone Relay
  `検索開始` button or a separate search form.
- AionUi's default assistant/skill picker behaves as a curated task launcher,
  not a full upstream gallery, so beginner search and Office tasks stay visible
  without requiring users to understand AionUi's broader built-in preset set.
- AionUi `/guid` beginner mode hides detected-agent pill bars, preset edit
  entrypoints, preset backend switchers, provider/model switchers, and the
  assistant-management drawer unless `relay.advancedSurfaces.enabled` is
  deliberately enabled for support. The `GuidActionRow` plus menu also hides
  the auto-injected skills submenu in beginner mode, while keeping file/folder
  actions visible.
- AionUi core UX is reused rather than replaced: ConversationTabs creates
  task-specific sessions, SendBox owns `/` commands and `@` file mentions, the
  right Workspace panel owns folder/file search and operations, PreviewPanel
  owns evidence preview, and ConversationSkillsIndicator shows loaded skills.
- The existing Workspace toolbar search is treated as a quick tree/filename
  filter plus compact status surface, not as the full document-search product.
  Broad document search remains an AionUi skill/result-card flow.
- ConversationSkillsIndicator must be passive in beginner mode or route only
  when `relay.advancedSurfaces.enabled` is enabled, so it does not become a
  hidden path into advanced capability settings.
- Beginner UX uses Japanese-first task language, a one-action folder-add first
  run, visible scan/candidate progress, thorough-by-default confirmation,
  simple mode labels, no-results recovery guidance, and collapsed advanced
  details.
- Dedoc-derived structure is progressively disclosed: friendly snippets and
  anchors first, document structure/tables/attachments/warnings in details, and
  Dedoc-compatible fields plus Query Trace only in advanced/support views.
- Search mode contracts distinguish filename, keyword, hybrid, semantic,
  evidence, and similar-document behavior; mode fallthrough is visible rather
  than silent.
- Query construction is Relay-owned: Relay builds, validates, and executes the
  `QueryPlan`; Copilot may suggest related terms, abbreviations, file-type
  hints, or clarification questions, but suggestions cannot change roots,
  budgets, confirmation policy, or searched coverage without Relay validation.
- Shared query normalization covers Japanese/CJK search, NFKC, punctuation,
  C/F/CF/CFS-style synonyms, period/quarter aliases, and extension handling.
- Versioned analyzer strategies cover path, filename, content, table, heading,
  and query analysis, with dependent indexes rebuilt or marked stale when an
  analyzer changes.
- The indexing ladder makes folders useful before full indexing by separating
  discovery, metadata, filename cache, text extraction, ParsedDocument IR,
  keyword/table/preview indexes, and optional semantic/OCR indexes.
- Docufinder-style discovery metadata and Dedoc-style document metadata are
  separate artifacts: `FileRecord`/`FileMetadata` owns root/path/access/freshness
  and filename cache state, while `DocumentMetadata` lives inside
  `ParsedDocument` and is produced only by parser/reader stages for a supplied
  FileRecord snapshot.
- The indexer scheduler/backpressure contract supports foreground query
  promotion, idle/background indexing, per-root concurrency, network-drive
  throttling, pause/resume, cancellation, restart resume, and explicit CPU,
  disk, battery, and network budgets.
- Indexing and rebuilds are idempotent and staging-based, preserving the
  previous searchable state when parser or index generation fails.
- Delete/move/rename semantics preserve stable file identity only when
  confidence is high, keep tombstones for old paths, migrate pins/history only
  for high-confidence moves, and keep historical Evidence Packs stale rather
  than silently rewritten.
- Path security boundaries canonicalize local, mapped-drive, and UNC paths,
  block traversal and escaping symlink/junction/reparse-point targets, and
  apply denylist plus hidden/system-folder policy before read, parse, index,
  preview, open, or support export.
- Permission/ACL freshness records current-user metadata/content/preview/open
  access separately, marks denied or offline content stale/unavailable, and
  never reuses previously indexed denied content as fresh evidence.
- Document parsing follows a Dedoc-style pipeline with strict ParsedDocument IR
  versioning, DocumentMetadata, TreeNode structure, tables, annotations,
  warnings, recursive attachments, parser confidence, source freshness, and
  configurable structure profiles.
- The parser, Dedoc adapter, and optional converters never walk workspace roots
  or start independent discovery. They consume FileRecord queues owned by the
  scheduler and include the source FileMetadata version in parser cache keys.
- Dedoc compatibility is field-level: `ParsedDocument`, `DocumentContent`,
  `DocumentMetadata`, `TreeNode`, `LineMetadata`, `Table`, `TableMetadata`,
  `CellWithMeta`, and `Annotation` keep their own branches instead of being
  flattened into parser text.
- Structure profiles use Dedoc-style pattern sets: reader tags, formatting,
  regex, and table patterns are versioned, diagnosable, and cache-key inputs.
- Converter lineage records source file, converter output, reader input,
  parser/profile/parameters, cleanup state, and stage-specific warnings so
  conversion and reader failures are separately diagnosable.
- Reader Capability Registry records table, annotation, attachment,
  page-anchor, cell-anchor, cached-formula, OCR, hidden-state, and safety-budget
  support so search and Evidence Packs cannot claim unsupported evidence.
- Parser parameters and budgets are explicit cache-key inputs so profile,
  document type, structure pattern version, attachment, PDF policy, OCR,
  page/sheet filter, hidden-sheet policy, and safety-budget changes cannot
  reuse incompatible ParsedDocument payloads.
- Attachment policy bounds recursive child documents by depth, count, bytes,
  timeout, archive path canonicalization, and archive-bomb safeguards while
  preserving parent-child provenance and stable anchors.
- Optional feature packs make OCR, semantic/vector, converter, archive/email,
  and Dedoc-adapter capabilities explicit; disabled or unhealthy packs change
  mode availability and warnings without breaking core filename/keyword/IR
  search.
- Dedoc-style intermediate stages separate ReaderOutput, NormalizedDocument,
  ParsedDocument, and DerivedIndex so parser and structure-construction failures
  are diagnosable.
- Metadata, analyzer, parser pipeline, structure profile, ParsedDocument,
  derived index, Evidence Pack, and Search Result schema versions evolve
  independently with explicit invalidation/rebuild rules.
- The format strategy matrix keeps unsupported formats filename-searchable while
  content indexing reports normalized warnings instead of hiding them.
- Relay-specific parser extensions preserve the Dedoc-compatible top-level
  `ParsedDocument` shape and normalize parser/search warnings through a shared
  warning taxonomy.
- The AI Boundary Contract keeps Copilot as an optional Evidence Pack consumer,
  not the local search or coverage authority.
- A local privacy/data-flow contract documents which artifacts stay local and
  which selected Evidence Pack snippets may be sent for optional Copilot polish.
- Evidence Pack redaction and Query Trace records make optional Copilot polish
  auditable without sending original files or full ParsedDocument payloads.
- SQLite/FTS-backed local stores keep metadata, ParsedDocument payloads,
  warnings, content nodes, table cells, previews, pins, and search history
  rebuildable without copying original files.
- Index DB health and repair supports integrity checks, WAL checkpoint, compact,
  derived-index rebuild, preview-cache rebuild, one-root rebuild, full rescan,
  and non-destructive repair that preserves roots, pins, history, and scan
  policy. Cache-backed repair actions honor cancellation before destructive
  work, and maintenance actions can be queued through the document-search
  background scheduler as `index_maintenance` work. Full rescan clears
  metadata and rebuildable indexes while preserving user memory and job state;
  root rebuild clears one root's metadata/filename index and optional SQLite
  FTS rows while preserving other roots and user state. Retry-failed-files uses
  the metadata-only failure registry for root-scoped candidate selection,
  applies per-file content-cache and SQLite FTS invalidation when candidates
  exist, and falls back to the root-scoped invalidation path only for an empty
  registry.
- Preview/open/evidence UX keeps result preview state, open state, retry/rebuild
  actions, and answer anchors tied to the same Search Result object without
  requiring Copilot.
- AionUi conversation/history state can reference result/evidence anchors after
  restart without duplicating file actions or creating Copilot-only search
  paths.
- AionUi renders contracted result/status state and never re-derives evidence
  state from filenames, snippets, or Copilot answer text.
- A release that advertises Workspace Document Search includes AionUi overlay
  snapshots for folder add, candidates-visible progress,
  checking-file-contents, confirmed results, preview/open, no-results,
  advanced drawer, and Copilot-unavailable states.
- UI accessibility covers keyboard navigation, visible focus, ARIA status and
  progress labels, color-not-only status badges, reduced motion, capped
  result batches with explicit continuation, stable selection, and Japanese font
  fallback.
- Broad lookup answers include searched roots, coverage, skipped/failed/stale
  counts, candidate/evidence status, and truncation state.
- Filename-only matches are never treated as document-content evidence.
- Important conclusions, comparisons, recommendations, and "necessary file"
  claims require exact-file reads or indexed IR evidence.
- Copilot may polish a Relay draft only after validation against the Evidence
  Pack; it cannot introduce files, searched paths, or claims outside the pack.
- `office_search` is not reintroduced as an unrestricted model-facing tool.
- Deterministic coverage verifies query planning, metadata scanning, filename
  cache rebuild, filename search, ParsedDocument IR schema, warning-driven
  downgrade, Evidence Pack validation, index consistency, scheduler
  backpressure, delete/move/rename tombstones, path security boundaries, reader
  capabilities, permission/ACL freshness, converter lineage, attachment
  limits/provenance, optional feature packs, index DB repair, preview/open UX,
  AionUi workspace integration, AionUi/Docufinder/Dedoc collision avoidance,
  current UX recheck, beginner UX, progressive Dedoc detail disclosure,
  accessibility, parser parameter cache keys, query normalization, golden-query
  relevance, local privacy/data flow, analyzer versioning, query trace,
  redaction policy, schema evolution, optional-adapter adoption criteria, index
  status reporting, evaluation-corpus relevance, and search quality metrics.

## Forward-Looking Designs (Not Yet Scheduled)

- `docs/OFFICE_SEARCH_DESIGN.md` — Phase A has source implementation in progress/landed under the Office File Search track above. Future Phase B remains semantic retrieval on top of the extraction cache.
- `docs/WORKSPACE_DOCUMENT_SEARCH_PLAN.md` — Docufinder/Dedoc-aligned
  workspace search plan. This is the target direction for broad shared-folder
  lookup and should supersede ad-hoc model-only chaining for document search.

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
