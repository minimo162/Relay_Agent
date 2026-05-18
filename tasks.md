# Relay_Agent Execution Tasks

Date: 2026-05-18

## Active Goal

Move Relay away from a growing Relay-specific tool/runtime design and toward an
OpenCode-compatible local tool contract hosted by Microsoft Agent Framework and
projected through AG-UI.

Relay still uses M365 Copilot through Edge CDP as the reasoning controller.
Relay should not adopt Codex app-server as the runtime in this task queue, but
Codex app-server remains useful prior art for approvals, sessions, tool
results, sandboxing, streaming, and diagnostics.

The completed active queue is `RESPONSIVE*`. It implements the 2026-05-18
Installed Workbench Responsiveness Plan from `PLANS.md`: make installed
Workbench first paint and readiness reflection faster, make readiness
auto-refresh after Copilot connects, and make workspace folder selection
visibly recoverable.

The completed active queue is `LIFECYCLE*`. It implements the 2026-05-18
Browser Session Lifecycle And Installer Lock Plan from `PLANS.md`: make the
browser-launched sidecar shut down after the last Workbench tab closes, while
keeping development/test sidecars stable unless idle-exit is explicitly
enabled.

The completed active queue is `INSTALLLOCK*`. It implements the 2026-05-18
User-Scope Installer Locked-File Remediation Plan from `PLANS.md`: make the
Windows user-scope NSIS installer handle upgrades where `Relay.Sidecar.exe` is
still running or where the previous install lives in the legacy
`%LOCALAPPDATA%\Programs\RelayAgent` directory.

The completed active queues are `DCI2605IR*` and `UXMIN*`.
`DCI2605IR*` incorporates the 2026-05-18 DCI Interface Resolution Follow-up
Plan from `PLANS.md`: increase the resolution of the generic Agent
Framework/OpenCode-compatible corpus interface without reviving a dedicated
search engine. `UXMIN*` implements the 2026-05-18 Minimal Professional
Workbench UX Plan from `PLANS.md`: maximize whitespace, remove nonessential
controls, and make the browser Workbench a single calm AG-UI-first agent
surface instead of a mode picker or diagnostic console.

The completed active queue is `BOOTREADY*`. It implements the 2026-05-18 Installed
App Startup, Icon, And Readiness Remediation Plan from `PLANS.md`: restore the
app icon, remove the installed-app dependency on a manually configured
`RELAY_COPILOT_CDP_PORT`, make Copilot CDP warmup automatic, keep first paint
fast, replace manual workspace path entry with a native folder picker, and show
readiness with minimal user-facing UI.

The completed active queue is `INSTALLUX*`. It implements the 2026-05-18
Installer Defaults, Workspace Picker, And Search Path Contract Plan from
`PLANS.md`: default desktop shortcut and finish-page launch, no Windows
launcher console, modern shared-folder workspace picker, and a reliable
`glob` -> `read` path contract.

The active queue is `PROJECTIONFIX*`. It implements the 2026-05-18 Tool
Projection Harness Remediation Plan from `PLANS.md`: keep search and Office
editing inside the Agent Framework/AG-UI/OpenCode-compatible generic tool
catalog, prevent hidden retriever/image JSON projection drift, and normalize
natural Office cell-formatting requests into Relay's semantic OfficeCLI
adapter before approval.

The previous `DCI2605*`, `DCIFS*`, and `POSTLIVE*` queues remain completed
history below. They should not be extended unless a regression proves those
acceptance criteria have broken.

## Execution Rules

- Execute tasks in order unless a task explicitly says it can run in parallel.
- Do not add new model-visible Relay-specific tool names.
- Do not fix Copilot mistakes by adding broad prompt-only folklore.
- Prefer Agent Framework function/MCP tools and middleware for tool admission,
  approval, terminal eligibility, and tool-result feedback.
- Keep AG-UI as the only frontend run/event/state/approval protocol.
- Every completed task must update `docs/IMPLEMENTATION.md` with the artifact
  and verification result.
- Run at least `pnpm check` before marking a milestone complete.

## Task Queue

### PROJECTIONFIX-01 - Document Harness Remediation Scope

Status: completed

Scope:

- Add the tool projection harness remediation plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan does not revive dedicated document-search engines, AionUi,
  OpenWork/OpenCode runtime paths, Codex app-server, or Tauri.
- The plan frames the fix as Agent Framework/AG-UI/OpenCode-compatible tool
  projection and semantic OfficeCLI normalization.

Verification:

- `git diff --check`

### PROJECTIONFIX-02 - Harden Copilot Projection Instructions

Status: completed

Scope:

- Strengthen the Copilot tool-projection prompt so JSON must be selectable
  text in one fenced `json` block.
- Explicitly forbid image/card/canvas/screenshot/attachment JSON output.
- Forbid final answers from recommending unavailable local tools, including
  hidden retrievers.
- Clarify OpenCode-style local search sequencing and semantic OfficeCLI cell
  formatting arguments.

Artifacts:

- Updated `apps/sidecar/RelayCopilotChatClient.cs`.

Acceptance:

- Prompt dumps include the text-only JSON and no-unavailable-tool rules.
- The visible tool list remains the source of truth for what Copilot may use
  or recommend.

Verification:

- `pnpm agent:choice-error-reduction-smoke`

### PROJECTIONFIX-03 - Normalize OfficeCLI Formatting Semantics

Status: completed

Scope:

- Normalize `format` and common formatting aliases to OfficeCLI `set`.
- Normalize worksheet/sheet/cell/range aliases into `/Sheet/Cell` targets.
- Normalize common color names and object-shaped fill/color properties into
  OfficeCLI scalar color values.
- Keep raw argv rejected and mutation approval-gated.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.

Acceptance:

- Natural Copilot output for "Sheet1 A1 red" becomes an approved
  `officecli_mutate` proposal without executing before approval.
- Invalid raw argv remains rejected.

Verification:

- `pnpm agent:officecli-registry-smoke`

### PROJECTIONFIX-04 - Add Regression Coverage And Verify

Status: completed

Scope:

- Extend existing smoke tests for prompt projection and OfficeCLI semantic
  formatting.
- Run the canonical active acceptance gate.
- Update implementation notes with the remediation and verification result.

Artifacts:

- Updated smoke tests.
- Updated `docs/IMPLEMENTATION.md`.

Acceptance:

- `pnpm check` passes.

Verification:

- `pnpm check`

### PROJECTIONFIX-05 - Version, Commit, Push, And Release

Status: completed

Scope:

- Bump active package versions.
- Build Linux/Windows release packages and the per-user NSIS installer.
- Commit and push to `main`.
- Publish the next GitHub Release with checksums/inventory.

Artifacts:

- Release assets for the next patch version.

Acceptance:

- GitHub Release exists and points at the pushed commit.

Verification:

- `gh release view`

### INSTALLUX-01 - Document Installer, Picker, And Search Path Remediation

Status: completed

Scope:

- Add the installer defaults, no-console launcher, modern shared-folder
  workspace picker, and `glob` -> `read` path contract plan to `PLANS.md`.
- Add this executable task queue to `tasks.md`.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan keeps the browser Workbench + .NET sidecar architecture.
- The plan does not revive Tauri, AionUi, OpenCode/OpenWork, or a dedicated
  document-search engine.

Verification:

- `git diff --check`

### INSTALLUX-02 - Update Installer Defaults And Launcher Subsystem

Status: completed

Scope:

- Make the NSIS desktop shortcut component selected by default.
- Add a default finish-page launch action that starts the registered versioned
  `AppDir` launcher.
- Change the launcher project to a Windows GUI executable so no console window
  appears during normal program execution.
- Extend release smoke checks for those installer and launcher guarantees.

Artifacts:

- Updated `scripts/release/build-windows-installer.mjs`.
- Updated `scripts/release/icon-packaging-smoke.mjs`.
- Updated `apps/launcher/Relay.Launcher.csproj`.

Acceptance:

- Generated installer remains per-user and non-admin.
- Finish-page run, desktop shortcut, Start Menu shortcut, and uninstall icon all
  point at the versioned install payload.

Verification:

- `pnpm release:icon-smoke`
- `dotnet build apps/launcher/Relay.Launcher.csproj --configuration Release`

### INSTALLUX-03 - Replace Windows Workspace Picker Primary Path

Status: completed

Scope:

- Add a native Windows `IFileOpenDialog` folder picker as the first-choice
  workspace selection path.
- Preserve the existing PowerShell picker as a bounded compatibility fallback.
- Keep Workbench workspace UI minimal but make the action clearer.
- Ensure shared folders/UNC paths are accepted when the native picker returns
  them.

Artifacts:

- Updated `apps/sidecar/WorkspacePicker.cs`.
- Updated Workbench workspace copy/styles as needed.

Acceptance:

- Workspace selection uses a modern Windows folder dialog where available.
- The `変更` action is clearer and always re-enables after success,
  cancellation, error, or timeout.

Verification:

- `pnpm sidecar:workspace-picker-smoke`
- `pnpm workbench:ux-e2e`

### INSTALLUX-04 - Normalize Glob Results And Read Paths

Status: completed

Scope:

- Return `glob` results as workspace-relative display paths valid for later
  tool calls.
- Add shared existing-file path resolution for `read` and `edit`.
- Use platform-correct workspace containment comparisons.
- Add a smoke test proving a discovered file can be read by a direct
  subsequent `read`.

Artifacts:

- Updated `apps/sidecar/AgentRunner.cs`.
- Updated or new smoke coverage.

Acceptance:

- A discovered PDF/Office/plaintext path does not produce a false first
  `file_path does not exist` read failure when it is inside the workspace.

Verification:

- `pnpm agent:golden-smoke`
- `pnpm agent:glob-read-path-smoke`
- `pnpm check`

### INSTALLUX-05 - Version, Verify, Commit, And Release

Status: completed

Scope:

- Bump active package versions.
- Update `docs/IMPLEMENTATION.md`.
- Run acceptance checks and release packaging.
- Commit/push to `main`.
- Publish a GitHub Release with installer and package assets.

Artifacts:

- Release assets for the next patch version.

Acceptance:

- `pnpm check` passes.
- GitHub Release is published with checksums and inventory.

Verification:

- `pnpm check`
- `gh release view`

### RESPONSIVE-01 - Document Installed Workbench Responsiveness Contract

Status: completed

Scope:

- Add the installed Workbench responsiveness plan to `PLANS.md`.
- Capture the observed support bundle state: `/api/status` can already be
  `ready: true` while the Workbench chrome remains stale.
- Define acceptance around automatic readiness refresh, non-blocking optional
  OfficeCLI readiness, and workspace picker recovery.

Artifacts:

- Updated `PLANS.md`.
- Updated `tasks.md`.

Acceptance:

- The plan does not revive legacy active paths.
- The plan separates required readiness from optional OfficeCLI smoke latency.

Verification:

- `git diff --check`

### RESPONSIVE-02 - Make Sidecar Status Return Required Readiness Quickly

Status: completed

Scope:

- Update sidecar `ToolReadiness` so ripgrep and Copilot checks run in parallel.
- Make OfficeCLI readiness optional and non-blocking on first status calls:
  return a warming-up optional check while the smoke test runs in the
  background, then cache the result.
- Keep the detailed OfficeCLI result visible in later support status output.

Artifacts:

- Sidecar readiness implementation update.

Acceptance:

- `/api/status` can report `ready: true` as soon as required checks are ready.
- Optional OfficeCLI smoke latency does not delay the initial Ready state.
- OfficeCLI failures remain visible but non-required.

Verification:

- `pnpm sidecar:smoke`
- `pnpm check`

### RESPONSIVE-03 - Add Workbench Readiness Auto-Polling

Status: completed

Scope:

- Add automatic readiness polling while Workbench is not Ready.
- Refresh on tab visibility/focus.
- Preserve the manual readiness pill refresh and the minimal UI.

Artifacts:

- Workbench readiness hook update.

Acceptance:

- When `/api/status` changes to `ready: true`, the Workbench becomes Ready
  without a manual click.
- Polling does not spam the sidecar after Ready.

Verification:

- `pnpm typecheck`
- `pnpm workbench:ux-e2e`

### RESPONSIVE-04 - Harden Workspace Picker Visibility And Recovery

Status: completed

Scope:

- Run Windows PowerShell picker in STA mode where supported.
- Add a topmost owner window for the FolderBrowserDialog so the picker appears
  above Edge.
- Add a bounded Workbench-side timeout and abort handling so the `変更` button
  is always re-enabled after hidden-dialog failure or timeout.
- Keep the native picker as the primary path; do not reintroduce direct manual
  path entry as the normal UX.

Artifacts:

- `WorkspacePicker.cs` update.
- Workbench picker timeout/recovery update.

Acceptance:

- Workspace picker button is enabled before selection.
- While picker is active, the button communicates the pending state.
- After success, cancellation, error, or timeout, the button is enabled again.

Verification:

- `pnpm sidecar:workspace-picker-smoke`
- `pnpm workbench:ux-e2e`

### RESPONSIVE-05 - Package, Commit, And Release

Status: completed

Scope:

- Bump active versions to the next patch release.
- Update implementation log with verification results.
- Run `pnpm check`, build Linux/Windows packages, build Windows installer,
  inventory/SBOM, checksums.
- Commit/push to `main`.
- Publish GitHub Release assets.

Artifacts:

- `Relay.Agent-<version>-win-x64-setup.exe`
- Linux tarball, Windows zip, checksums, inventory, SBOM.

Acceptance:

- `pnpm check` passes.
- Release assets are present on GitHub.

Verification:

- `pnpm check`
- `gh release view`

### LIFECYCLE-01 - Document Browser Session Lifecycle Contract

Status: completed

Scope:

- Add the Workbench heartbeat, close beacon, sidecar idle monitor, and launcher
  enablement contract to `PLANS.md`.
- Keep the plan aligned with the active browser Workbench + .NET sidecar
  architecture.
- Explicitly state that installer process-kill preflight is best-effort cleanup,
  not the primary lifecycle mechanism.

Artifacts:

- `PLANS.md` lifecycle plan.
- `tasks.md` executable queue.

Acceptance:

- The plan explains why the `0.3.7` versioned-payload fix is insufficient by
  itself.
- The plan does not revive Tauri, AionUi, OpenCode/OpenWork, or a background
  updater as an active fallback.

Verification:

- `git diff --check`

### LIFECYCLE-02 - Add Sidecar Idle-Exit Lifecycle Monitor

Status: completed

Scope:

- Add a sidecar lifecycle component that records active Workbench clients,
  heartbeat freshness, active request count, and last request time.
- Add authenticated endpoints:
  - `POST /api/session/heartbeat`
  - `POST /api/session/closed`
  - `GET /api/session/status`
- Add middleware hooks around HTTP requests so the sidecar does not exit while
  a request is active.
- Make idle exit opt-in through `RELAY_ENABLE_IDLE_EXIT=1`, disabled by
  `RELAY_DISABLE_IDLE_EXIT=1`, and configurable with bounded millisecond env
  values.

Artifacts:

- Sidecar lifecycle source.
- Program startup integration.

Acceptance:

- Idle exit is disabled by default for direct development/test sidecar runs.
- When enabled, the sidecar stops itself only after startup grace, no fresh
  client heartbeat, no active requests, and idle quiet-period expiry.
- Session endpoints remain protected by Relay launch token and origin policy.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm sidecar:smoke`

### LIFECYCLE-03 - Add Invisible Workbench Heartbeat And Close Beacon

Status: completed

Scope:

- Create a stable per-tab Workbench `clientId` in session storage.
- Send an immediate heartbeat, periodic heartbeats, and a visible-tab heartbeat
  refresh.
- Send a best-effort close beacon on `pagehide` and `beforeunload`.
- Do not add any new visible Workbench controls or diagnostic-first UI.

Artifacts:

- Workbench lifecycle hook in `apps/workbench/src/App.tsx`.

Acceptance:

- A live Workbench tab keeps an idle-exit-enabled sidecar alive.
- Closing or navigating away from the tab allows the sidecar to exit after the
  configured quiet period.
- The minimal Workbench visual surface is unchanged.

Verification:

- `pnpm typecheck`
- `pnpm workbench:ux-e2e` when browser support is available.

### LIFECYCLE-04 - Enable Idle Exit Only From Launcher

Status: completed

Scope:

- Update the launcher to set `RELAY_ENABLE_IDLE_EXIT=1` for installed
  Workbench launches.
- Set conservative default launcher timeouts so first-load Copilot warmup is
  not killed before the Workbench sends its first heartbeat.
- Keep direct sidecar launches free of idle-exit unless explicitly configured.

Artifacts:

- Launcher environment wiring.

Acceptance:

- Normal installed launches self-clean after the Workbench tab closes.
- Existing smoke/development scripts do not need to race against idle exit.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm check`

### LIFECYCLE-05 - Add Deterministic Idle-Exit Smoke Coverage

Status: completed

Scope:

- Add a Node smoke test that starts the built sidecar with short idle-exit
  values, posts a heartbeat, verifies the process remains alive, posts a close
  event, and verifies the process exits.
- Add the smoke test to root `pnpm check`.

Artifacts:

- `scripts/sidecar-idle-exit-smoke.mjs`
- `package.json` script entries.

Acceptance:

- The smoke fails if the sidecar exits while a fresh client is present.
- The smoke fails if the sidecar does not exit after the client closes.

Verification:

- `pnpm sidecar:idle-exit-smoke`
- `pnpm check`

### LIFECYCLE-06 - Package, Document, Commit, And Release

Status: completed

Scope:

- Bump Workbench, sidecar, and launcher to the next patch version.
- Update packaging policy and implementation log.
- Generate Linux/Windows packages, Windows NSIS installer, release inventory,
  and SHA256 manifest.
- Commit and push to `main`.
- Create a GitHub Release with installer, archives, manifest, and inventory.

Artifacts:

- Updated docs.
- `dist/installer/Relay.Agent-<version>-win-x64-setup.exe`
- `dist/relay-agent-<version>-linux-x64.tar.gz`
- `dist/relay-agent-<version>-win-x64.zip`
- Release inventory and checksums.

Acceptance:

- `pnpm check` passes.
- Release assets are visible on GitHub.

Verification:

- `pnpm check`
- `gh release view`

### INSTALLLOCK-01 - Confirm Install-Root And Lock Failure Contract

Status: completed

Scope:

- Inspect the generated NSIS script and packaging policy for the interaction
  between `InstallDir`, `InstallDirRegKey`, canonical
  `%LOCALAPPDATA%\Programs\Relay Agent`, and legacy
  `%LOCALAPPDATA%\Programs\RelayAgent`.
- Confirm why an upgrade can target the legacy no-space path even after the
  current default path changed.
- Define the exact installer behavior for:
  - fresh install;
  - upgrade in canonical path;
  - upgrade in legacy path;
  - user manually changing the directory page.

Artifacts:

- Updated `docs/IMPLEMENTATION.md` diagnosis entry.
- Installer behavior notes in `docs/PACKAGING_POLICY.md` if needed.

Acceptance:

- The plan explicitly distinguishes lock handling from path migration.
- No implementation task depends on administrator rights or machine-wide
  registry writes.

Verification:

- `git diff --check`

### INSTALLLOCK-02 - Add Per-User Installer Process Stop Preflight

Status: completed

Scope:

- Update `scripts/release/build-windows-installer.mjs` so the generated NSIS
  script runs a preflight before `File /r`.
- Stop only same-user Relay processes whose executable path is under known
  Relay install roots:
  - `$INSTDIR`;
  - `%LOCALAPPDATA%\Programs\Relay Agent`;
  - `%LOCALAPPDATA%\Programs\RelayAgent`.
- Target `Relay.Sidecar.exe` and `Relay.Launcher.exe`.
- Use Windows built-ins available from a user-scope installer, such as
  PowerShell process filtering by executable path.
- Keep the preflight bounded; do not add an infinite wait or background helper.

Artifacts:

- Generated NSIS preflight function or macro.
- Script comments explaining why legacy and canonical roots are both checked.

Acceptance:

- Installing while Relay is open attempts to stop the current user's running
  Relay binaries before copying files.
- The generated NSIS script does not use `RequestExecutionLevel admin`, HKLM,
  machine-wide services, or unrestricted process killing.

Verification:

- installer generated-script smoke
- `pnpm sidecar:installer:windows`

### INSTALLLOCK-03 - Avoid Locked-Binary Overwrite With Versioned Payloads

Status: completed

Scope:

- Do not copy package files directly over `$INSTDIR\Relay.Sidecar.exe`.
- Generate a fresh runtime payload directory under the install root, for
  example `$INSTDIR\app-<version>-<tick>`.
- Copy the package into that payload directory and repoint shortcuts,
  `DisplayIcon`, and Relay's `AppDir` registry value to it.
- Keep the process-stop preflight best-effort only; installation must not fail
  just because a previous sidecar remains locked.

Artifacts:

- Versioned-payload helper in the NSIS generator.
- Deterministic smoke assertions that the versioned payload is selected before
  `File /r` and direct root executable deletion is not reintroduced.

Acceptance:

- A locked installed executable is not overwritten by the installer.
- The installer remains per-user and does not request elevation.

Verification:

- installer generated-script smoke
- `pnpm check`

### INSTALLLOCK-04 - Preserve Canonical Fresh Installs And Legacy Upgrades

Status: completed

Scope:

- Keep the default fresh install location as
  `%LOCALAPPDATA%\Programs\Relay Agent`.
- Preserve existing registered install locations for upgrades, including the
  legacy `%LOCALAPPDATA%\Programs\RelayAgent`, so updates do not create a
  duplicate install without user intent.
- Rewrite uninstall registry metadata, shortcuts, and icon paths after the
  package copy.
- Ensure uninstall removes only the install root and shortcuts, not Relay user
  data, Edge profiles, caches, workspaces, or support bundles.

Artifacts:

- Installer generator updates.
- Packaging policy update explaining canonical-vs-legacy behavior.

Acceptance:

- Fresh install path and legacy upgrade path are both intentional.
- User-local app data remains outside the install root.

Verification:

- installer generated-script smoke
- `pnpm release:inventory`

### INSTALLLOCK-05 - Extend Release And Installer Smokes

Status: completed

Scope:

- Extend `scripts/release/icon-packaging-smoke.mjs` or add a focused installer
  policy smoke to assert:
  - `RequestExecutionLevel user`;
  - no HKLM writes;
  - canonical and legacy install roots are represented;
  - process stop preflight appears before `File /r`;
  - versioned payload directory is selected before `File /r`;
  - root `Relay.Sidecar.exe` deletion/overwrite is not reintroduced;
  - icon wiring remains intact.
- Add the smoke to `pnpm check`.

Artifacts:

- Updated or new release smoke script.
- `package.json` check integration.

Acceptance:

- The installer lock regression cannot be reintroduced without failing the
  canonical check gate.

Verification:

- `pnpm release:icon-smoke` or new installer smoke
- `pnpm check`

### INSTALLLOCK-06 - Verify Windows Upgrade And Prepare Fix Release

Status: completed

Scope:

- Build the Windows package and NSIS installer.
- On Windows, verify at least one installed-app upgrade scenario with the
  previous Relay instance running:
  - current user's running sidecar is stopped when possible, but the installer
    still completes without touching the locked executable if it remains
    running;
  - no administrator elevation or password prompt appears;
  - installed app starts after upgrade;
  - icon, workspace picker, and Copilot readiness remain functional.
- Record verification in `docs/IMPLEMENTATION.md`.

Artifacts:

- Windows upgrade verification note.
- Release notes for the installer-lock fix.

Acceptance:

- The next release should include a Windows upgrade result when a Windows
  desktop is available; Linux release builds must at minimum prove the generated
  installer no longer overwrites the locked executable path.

Verification:

- `pnpm check`
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`
- Windows installed-app upgrade smoke when a Windows desktop is available; this
  cannot run in the Linux build environment, so the release gate relies on the
  generated NSIS policy smoke plus Windows package/installer builds here.

### BOOTREADY-01 - Restore Active App Icon Assets

Status: completed

Scope:

- Copy the previous Relay icon assets from the historical Tauri path into an
  active non-Tauri location, for example `assets/app-icon/`.
- Include at least the source SVG, Windows `.ico`, and PNG sizes needed for
  packaging/tests.
- Keep the old `apps/desktop/src-tauri/icons/` path historical only; do not
  make the release path depend on Tauri directories.

Artifacts:

- Active icon asset directory.
- Inventory note in `docs/IMPLEMENTATION.md` identifying the source commit and
  active destination.

Acceptance:

- Icon assets are available to launcher, installer, release inventory, and any
  future Linux desktop metadata without referencing `apps/desktop`.
- No active Tauri build/config path is reintroduced.

Verification:

- icon asset smoke
- `git diff --check`

### BOOTREADY-02 - Wire Icon Through Launcher And NSIS Installer

Status: completed

Scope:

- Add Windows `ApplicationIcon` metadata to `Relay.Launcher.csproj`.
- Update the Windows package/installer flow so the active `.ico` is available
  in `dist/relay-agent-win-x64`.
- Update the generated NSIS script to set installer, uninstaller, Start Menu,
  optional desktop shortcut, and uninstall entry icons.
- Keep `RequestExecutionLevel user` and per-user install paths unchanged.

Artifacts:

- Launcher project icon reference.
- Installer script generator icon support.
- Packaging smoke that verifies the NSIS script and package inputs.

Acceptance:

- Installed shortcut and uninstall entry no longer show a generic executable
  icon.
- The installer still requires no administrator rights or personal Windows
  password.

Verification:

- packaging/icon smoke
- `pnpm sidecar:publish:windows`
- `pnpm sidecar:installer:windows`

### BOOTREADY-03 - Add Sidecar Copilot CDP Manager

Status: completed

Scope:

- Replace the missing-env-only Copilot transport construction with a sidecar
  CDP manager that can resolve or start Copilot Edge CDP.
- Resolution order:
  1. explicit `RELAY_COPILOT_CDP_PORT`;
  2. Relay profile marker file;
  3. live `DevToolsActivePort`;
  4. auto-start Microsoft Edge with the Relay profile.
- Reuse the older stable CDP behavior from commit
  `40622c03d049f89e9b2501a39b88eb796c298912` where it still applies:
  standard Windows Edge locations, dedicated profile, stale-port rejection,
  Edge `/json/version` validation, and Copilot page/composer validation.

Artifacts:

- `EdgeCdpManager` or equivalent sidecar component.
- Unit/smoke coverage for explicit port, marker port, stale marker, stale
  DevToolsActivePort, auto-start command construction, and missing Edge.

Acceptance:

- Installed app startup does not require users to set
  `RELAY_COPILOT_CDP_PORT`.
- Explicit env override remains available for development and live E2E.
- No fallback model or weaker local planner is introduced.

Verification:

- new Copilot CDP manager smoke
- `pnpm sidecar:build`
- `pnpm check`

### BOOTREADY-04 - Preserve Legacy Signed-In Edge Profile Continuity

Status: completed

Scope:

- Detect and reuse the legacy Relay Edge profile location used by the older
  stable desktop line when it exists and has a live or reusable CDP profile.
- Prefer a user-local app-data Relay profile for new installs.
- Respect `RELAY_EDGE_PROFILE` for advanced troubleshooting and live E2E.
- Store any new marker file under user-local Relay data, never in shared
  workspaces.

Artifacts:

- Profile resolution helper.
- Smoke tests for legacy profile preference, new profile fallback, and env
  override.

Acceptance:

- Users who were already signed in through the previous Relay Edge profile have
  the best chance of staying signed in after the architecture cutover.
- New users get a user-local Relay-owned profile.
- No searched/shared folder receives profile, cache, or temp artifacts.

Verification:

- profile resolution smoke
- `pnpm sidecar:security-smoke`

### BOOTREADY-05 - Make First Paint Fast And Warm Copilot In Background

Status: completed

Scope:

- Keep launcher behavior focused on starting the sidecar and opening the local
  Workbench quickly.
- Move Edge/Copilot startup or attach work into background sidecar warmup.
- Add readiness caching/TTL so `/api/status` is quick and does not rerun slow
  OfficeCLI smoke on every UI poll.
- Keep OfficeCLI optional readiness deferred enough that it cannot make the
  first viewport feel stuck.

Artifacts:

- Background Copilot warmup path.
- Cached readiness result model.
- Startup timing smoke.

Acceptance:

- Workbench appears quickly even when Copilot warmup is still in progress.
- The UI can show `Connecting to Copilot` without blocking the page.
- Required local tool failures still fail clearly.

Verification:

- startup timing smoke
- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-06 - Replace Raw Not Ready With Minimal Readiness States

Status: completed

Scope:

- Extend status projection so the Workbench can distinguish:
  `Ready`, `Connecting`, `Sign in needed`, `Local tools issue`,
  and `Provider error`.
- Hide developer-only messages such as
  `Set RELAY_COPILOT_CDP_PORT...` from the primary UI.
- Keep raw details available only in collapsed Support/export.
- Add a sparse sign-in recovery row with `Open Copilot` and `Retry` when the
  Copilot page is reachable but the composer is not usable.

Artifacts:

- Status response projection update.
- Workbench readiness UI update.
- UX E2E fixtures for connecting, sign-in-needed, local-tools issue, and ready
  states.

Acceptance:

- Normal installed launch never presents the missing-env message as the primary
  experience.
- Sign-in-required is understandable without a diagnostic console.
- The first viewport remains minimal with generous whitespace.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-07 - Add Native Workspace Picker And Minimal Workspace Chrome

Status: completed

Scope:

- Replace the default manual workspace path text field with a sidecar-owned
  native folder picker surfaced as a compact `Change` action in the Workbench.
- Use the old stable `apps/desktop/src/lib/workspace-picker.ts` behavior only
  as interaction reference: directory-only, single selection, current workspace
  as default path, cancel leaves the current workspace unchanged.
- Add a narrow sidecar API such as `/api/workspace/pick` that returns an
  absolute path selected through the OS file explorer.
- Implement platform adapters behind one interface:
  - Windows: real File Explorer folder dialog suitable for installed users;
  - Linux: desktop portal/dialog command when available, with a clear app error
    if no graphical picker can be shown.
- Keep workspace history user-local. Do not write picker state, caches, indexes,
  or temp files into selected/shared workspaces.
- Update the Workbench layout so the first viewport shows only:
  Relay identity, compact readiness, selected workspace chip, `Change`, task
  composer, send/stop, answer/approval area, and collapsed Support.
- Apply the minimal professional design direction: generous whitespace, Inter,
  neutral surfaces, one quiet accent, visible focus states, no decorative
  gradients/orbs, no diagnostic-first chrome.

Artifacts:

- Sidecar workspace picker endpoint and platform adapter tests.
- Workbench workspace selector component with folder icon action and compact
  recent-workspace chips.
- UX E2E fixtures for picker success, picker cancel, picker failure, and recent
  workspace display.
- Implementation log entry referencing the old stable picker commit and the
  active non-Tauri replacement.

Acceptance:

- A normal user can set or change the workspace without typing a path.
- Cancelling the picker leaves the previous workspace untouched.
- The selected path is visible enough to verify, but does not dominate the
  composer.
- Direct path entry is not part of the default UI; any developer override is
  hidden under Support/advanced diagnostics.
- No Tauri runtime, Tauri IPC, or AionUi/OpenCode/OpenWork path is revived.

Verification:

- workspace picker unit/smoke tests
- `pnpm workbench:ux-e2e`
- `pnpm check`

### BOOTREADY-08 - Add Installed-App Startup And Icon E2E Gates

Status: completed

Scope:

- Add deterministic launcher/package startup smokes that run without
  `RELAY_COPILOT_CDP_PORT`.
- Add a Windows packaging/install smoke where available:
  Start Menu shortcut icon, user-scope install path, Workbench first paint, and
  Copilot readiness transition.
- Add a Linux packaged-run smoke for the archive path.
- Keep signed-in live Copilot E2E optional when the environment is not
  available, but required before publishing a release that changes CDP
  selectors or startup behavior.

Artifacts:

- Startup E2E scripts.
- Icon/package assertions.
- Implementation log entries with timings and screenshots.

Acceptance:

- The regression is caught before release: no icon loss, no developer-env-only
  Copilot readiness, no raw Not ready on normal installed start.
- The default Workbench path uses native picker selection, not required manual
  path typing.
- Live failures are classified as environment/sign-in/provider issues, not
  generic app failure.

Verification:

- startup/icon/workspace-picker E2E smoke
- `pnpm workbench:live-copilot-e2e` when signed-in Edge CDP is available
- `pnpm check`

### BOOTREADY-09 - Rebuild Release Notes And Documentation

Status: completed

Scope:

- Update `README.md`, `docs/IMPLEMENTATION.md`,
  `docs/PACKAGING_POLICY.md`, `PLANS.md`, and `tasks.md` after implementation.
- Document the installed-app behavior:
  Relay starts/attaches Copilot Edge CDP automatically, uses user-local profile
  storage, and does not require manual `RELAY_COPILOT_CDP_PORT`.
- Document the remaining developer override and support bundle diagnostics.
- Prepare release notes that call out icon restoration and startup/readiness
  repair.
- Document that normal users choose a workspace through the file explorer, with
  direct path entry only as hidden troubleshooting/developer behavior if it is
  retained at all.

Artifacts:

- Updated docs and implementation log.
- Release-note checklist for the fix release.

Acceptance:

- Docs no longer imply normal installed users must configure a CDP port.
- Packaging docs mention icon wiring and user-local Edge profile behavior.
- User docs no longer tell users to type workspace paths as the primary flow.
- Historical desktop/Tauri notes remain archived context only.

Verification:

- `git diff --check`
- `pnpm check`

### UXMIN-01 - Inventory And Remove Visual Noise

Status: completed

Scope:

- Audit `apps/workbench/` for visible controls, panels, badges, diagnostics,
  mode selectors, and AionUi-era or historical runtime affordances.
- Remove default-surface controls that are not required for normal task
  execution: rating/reaction buttons, globe/web UI buttons, always-visible
  runtime chips, unused settings, legacy feature-mode shortcuts, and raw
  diagnostic panels.
- Keep only essentials visible by default: workspace, task composer, send/stop,
  run state, answer, approvals, and explicit support export.

Artifacts:

- Workbench UI inventory recorded in `docs/IMPLEMENTATION.md`.
- Removed or relocated chrome in Workbench components.

Acceptance:

- The first viewport no longer reads as a dashboard, landing page, mode picker,
  or diagnostic console.
- Search, Office editing, coding, and verification remain available as natural
  language tasks through the same composer.
- No hidden fallback to old AionUi/OpenCode/OpenWork/Tauri UI paths is added.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-02 - Define Minimal Design Tokens And Layout Primitives

Status: completed

Scope:

- Define Workbench-level Tailwind/shadcn/Radix primitives for spacing,
  max-widths, surface colors, border radii, focus rings, typography, icon
  sizing, and state colors.
- Use a restrained neutral palette with one quiet accent. Avoid decorative
  gradients, orbs, bokeh, one-note purple/blue themes, and marketing-style
  composition.
- Add stable responsive constraints for composer, timeline, approval, diff, and
  result surfaces so text and controls do not shift or overlap.

Artifacts:

- Updated Workbench styling primitives and shared components.
- Visual notes in `docs/IMPLEMENTATION.md` explaining the token choices.

Acceptance:

- The UI has a consistent professional visual rhythm across idle, running,
  approval, error, and complete states.
- Text fits inside controls at 375px, 768px, 1024px, and 1440px.
- Keyboard focus and contrast remain visible.

Verification:

- Workbench typecheck/build through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-03 - Rebuild The Shell Around One Composer

Status: completed

Scope:

- Restructure the Workbench shell around a single natural-language task
  composer and one run surface.
- Keep workspace selection visible but quiet; it should support the task, not
  dominate the screen.
- Replace feature-mode framing with concise placeholder/help text inside the
  composer only when the run is idle.

Artifacts:

- Updated shell/composer components in `apps/workbench/`.
- E2E fixture covering a generic task start from the idle state.

Acceptance:

- Users do not need to choose `資料を探す`, `Officeファイルを編集する`, or
  `コードを書く` before submitting a task.
- The primary action is visually clear and the page has no competing CTAs.
- The idle state contains no long explanatory copy.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-04 - Render Runs As A Progressive AG-UI Timeline

Status: completed

Scope:

- Use `/agui/relay` events as the canonical Workbench run model.
- Render final answer and current run state first, then a compact timeline of
  meaningful tool calls, approvals, diffs, verification results, and errors.
- Collapse raw AG-UI events, JSON payloads, and long diagnostics behind
  explicit detail controls.

Artifacts:

- AG-UI timeline components and state mapping.
- Golden UX fixture with long search/read/edit/verify trajectories.

Acceptance:

- A normal run is understandable without reading raw event payloads.
- Advanced diagnostics are available but never dominate the default surface.
- Interrupt/resume and approval events remain visible enough to act on.

Verification:

- official AG-UI replay/golden smoke through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-05 - Build Minimal Approval And Diff Surfaces

Status: completed

Scope:

- Create one approval surface that covers code edits, OfficeCLI mutations,
  file writes, patches, and bounded verification commands.
- Show concise summary, target path, risk, backup state, diff availability, and
  approve/reject actions.
- Keep mutation approval unmistakable without adding persistent sidebars or
  modal-heavy flow.

Artifacts:

- Shared approval/diff components for AG-UI client-tool approvals.
- Approval/rejection UX E2E fixture.

Acceptance:

- Mutations cannot proceed without explicit user approval.
- Rejection and resume are clear and leave an auditable run trace.
- The same approval surface works across common file, Office, and code tasks.

Verification:

- official AG-UI client-tool approval smoke through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-06 - Polish Loading, Error, And Completion States

Status: completed

Scope:

- Design calm states for idle, connecting to Copilot, running, waiting for
  approval, applying changes, failed, cancelled, and complete.
- Keep failure messages short and specific. Move raw diagnostics to details and
  explicit redacted support bundle export.
- Ensure long-running operations look alive without excessive animation or
  noisy status text.

Artifacts:

- Updated state components and error detail components.
- UX fixtures for provider failure, tool failure, invalid output, and success.

Acceptance:

- The UI never appears frozen while an AG-UI run is active.
- Fail-fast Copilot/provider errors are understandable without exposing raw
  implementation details by default.
- Completion clearly distinguishes final answer, changed files, and next
  available actions.

Verification:

- provider/tool failure smokes through `pnpm check`
- `pnpm workbench:ux-e2e`

### UXMIN-07 - Add Responsive Accessibility And Visual Regression Gates

Status: completed

Scope:

- Extend Workbench UX E2E coverage for 375px, 768px, 1024px, and 1440px
  viewports.
- Check keyboard navigation, focus order, contrast, reduced-motion behavior,
  text overflow, and stable dimensions for fixed-format controls.
- Add screenshot or DOM assertions that catch reintroduced visual noise.

Artifacts:

- Updated `pnpm workbench:ux-e2e` coverage.
- Accessibility and viewport notes in `docs/IMPLEMENTATION.md`.

Acceptance:

- No incoherent overlap or clipped text in supported viewports.
- The composer, timeline, approval, and error surfaces remain usable with a
  keyboard.
- Reintroduced legacy chrome or always-visible diagnostics fails the UX gate.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### UXMIN-08 - Align Product Documentation With The Minimal Workbench

Status: completed

Scope:

- Update `README.md`, `docs/IMPLEMENTATION.md`, `PLANS.md`, and `tasks.md`
  after implementation so they describe the single minimal AG-UI Workbench.
- Remove active-architecture wording that implies separate search, Office, or
  coding product modes.
- Keep historical AionUi/OpenCode/OpenWork/Tauri references clearly archived.

Artifacts:

- Documentation updates aligned with the implemented UX.
- Verification log entries for UX and check commands.

Acceptance:

- Documentation describes one browser Workbench over Microsoft Agent Framework,
  AG-UI, M365 Copilot CDP, and Relay-governed local tools.
- No user-facing docs instruct users to choose old feature modes.
- Release notes can be produced without contradicting the active architecture.

Verification:

- `git diff --check`
- `pnpm check`

### DCI2605IR-01 - Add DCI Phase And Hypothesis Ledger

Status: completed

Scope:

- Extend `RelayDciTrajectory.v1` with phase tags:
  `explore`, `refine`, `inspect`, `verify`, and `answer_ready`.
- Add a compact hypothesis ledger derived from tool observations:
  candidate claim, supporting paths, refuting paths, unresolved terms,
  rejection reason, and latest next action.
- Keep the ledger diagnostic/AG-UI state only. Do not expose a model-visible
  retriever or hidden planner.

Artifacts:

- Updated trajectory builder/helper.
- Metric fixture covering phase transitions and hypothesis support/refutation.
- Implementation log entry describing the replay/privacy boundary.

Acceptance:

- A trajectory can explain why a candidate moved from unknown to supported or
  rejected.
- The ledger can be reconstructed from AG-UI/tool events.
- No searched/shared folder receives Relay cache/index/temp files.

Verification:

- new DCI trajectory phase smoke
- `pnpm agent:dci-metrics-smoke`
- `pnpm check`

### DCI2605IR-02 - Add Context-Window Grep Evidence

Status: completed

Scope:

- Add bounded context-window conjunction support to `grep` observations so
  sparse clues can satisfy `allTerms` across nearby lines or sections.
- Return match groups with `scope=line|context_window|file_sample`, required
  and optional term hits, excluded terms encountered nearby, snippets, and
  continuation guidance.
- Preserve ripgrep-first execution, result caps, cancellation, workspace
  containment, and the `--` separator before user/model patterns.

Artifacts:

- `RelayGrepObservation.v1` schema extension.
- Deterministic sparse-clue/context-window corpus.
- Regression for terms that are near each other versus far-apart false
  positives.

Acceptance:

- A single-line exact phrase is not required when the local context window
  provides the evidence.
- Far-apart or unrelated terms do not pass as conjunctive evidence.
- Existing line-level grep behavior remains compatible.

Verification:

- new DCI context-window grep smoke
- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-03 - Enforce Observation-Driven Refinement Gates

Status: completed

Scope:

- Add Agent Framework middleware/final-readiness checks for trajectories that
  contain only guide/glossary, zero-match, hard-negative, generic,
  prior-period, or no-evidence observations.
- Repair premature finals to the next safe observable local tool action when
  possible; otherwise fail fast with a protocol error.
- Require at least one observed-term refinement when a read observation
  introduces new vocabulary for an ambiguous user request.

Artifacts:

- Protocol/middleware refinement gate.
- Regression smokes for guide-only, zero-match-only, hard-negative-only,
  generic-only, prior-period-only, and no-evidence-only finals.

Acceptance:

- Copilot cannot finish a local evidence task using only weak or refuting
  observations.
- Repairs are visible as tool calls; Relay does not synthesize local answers.
- Provider/tool/protocol failures remain distinguishable.

Verification:

- updated `pnpm agent:dci-golden-smoke`
- new DCI final-refinement smoke
- `pnpm check`

### DCI2605IR-04 - Strengthen Structured Office/CSV/PDF Read Evidence

Status: completed

Scope:

- Extend supported `read` projections for CSV, xlsx/xlsm, docx, pptx, and PDF
  to expose bounded row/sheet/cell/page/section anchors where extraction
  supports them.
- Include extraction limitations in observations:
  unsupported binary Office formats, PDF without text layer, hidden sheets,
  truncated tables, cached formula limits, and extraction warnings.
- Keep this as exact read/evidence projection. Do not add a separate
  Office/PDF search engine.

Artifacts:

- Structured read observation updates.
- CSV row, xlsx sheet/cell, docx/pptx text, and PDF text-layer DCI fixtures.

Acceptance:

- Copilot can cite exact anchors for heterogeneous local evidence.
- Unsupported or partial extraction is explicit and cannot be mistaken for
  confirmed content.
- Full document contents stay out of default support bundles.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- new DCI heterogeneous-read smoke
- `pnpm check`

### DCI2605IR-05 - Add Deterministic Context Management Metrics

Status: completed

Scope:

- Extend DCI compaction artifacts with raw output bytes, projected bytes,
  kept anchors, dropped excerpts, retained hashes, and replay sufficiency.
- Keep deterministic truncation/compaction as the evidence source of truth.
- Keep model-generated summarization disabled by default.

Artifacts:

- Compaction metric projection in trajectory/support artifacts.
- Long-trajectory smoke that proves replay data survives compaction.

Acceptance:

- Long DCI runs stay within bounded Copilot context without losing the
  evidence skeleton.
- The support artifact can prove what was retained and what was dropped.
- No hidden lossy LLM summary is treated as evidence.

Verification:

- `pnpm agent:dci-context-smoke`
- new DCI compaction-metrics smoke
- `pnpm check`

### DCI2605IR-06 - Build Adversarial DCI Corpus Generator

Status: completed

Scope:

- Add a deterministic fixture generator for large local corpora with nested
  folders, misleading filenames, entity-name traps, prior-period copies,
  negated snippets, generic memos, guide/glossary files, and non-obvious
  evidence filenames.
- Include Markdown/text/CSV plus at least one supported Office/PDF fixture.
- Parameterize corpus size and distractor count so tests can exercise caps and
  continuation behavior without relying on shared folders.

Artifacts:

- Corpus generator script/helper.
- Generated-fixture tests for sparse clues, false positives, and
  heterogeneous evidence.

Acceptance:

- One exact filename match or one exact phrase search cannot pass the corpus.
- The gold evidence is findable only through observed local context and
  refinement.
- Test fixtures are deterministic and do not depend on external files.

Verification:

- new adversarial corpus smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-07 - Expand DCI Interface-Resolution Metrics

Status: completed

Scope:

- Extend `RelayDciTrajectoryMetrics.v1` with refinement depth, operator
  diversity, context-window conjunction, observation-to-next-action
  dependency, candidate rejection count, hard-negative read count,
  evidence-anchor locality, and accidental-answer prevention.
- Use the same metric helper for deterministic smokes and live E2E.

Artifacts:

- Updated metric helper and unit smoke.
- Failure messages that explain which DCI interface-resolution criterion
  failed.

Acceptance:

- A right final string without the required trajectory fails.
- Metric failures are diagnosable without reading raw Copilot logs.
- Existing DCI metric consumers remain compatible or get explicit schema
  version handling.

Verification:

- `pnpm agent:dci-metrics-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605IR-08 - Upgrade Live Copilot DCI Hard Scenario

Status: completed

Scope:

- Upgrade `pnpm workbench:live-dci-e2e` or add a second live scenario that
  requires one exploratory search, one guide/context read, one refined search,
  one decoy read/rejection, and one exact evidence read.
- Save AG-UI events, trajectory, metrics, prompt/response diagnostics,
  screenshots when available, and failure classification under
  `dist/e2e/live-dci/`.
- Fail when Copilot reaches the right final file by chance without enough
  local observations.

Artifacts:

- Live DCI hard scenario runner/report.
- Failure classification update for provider, protocol, tool, and DCI-quality
  failures.

Acceptance:

- A signed-in Copilot run can solve the hard corpus through raw local tools.
- Provider/CDP/quota failures are classified separately from DCI logic
  failures.
- No mock model or fallback retriever can pass the live gate.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI2605IR-09 - Refine Workbench Hypothesis/Evidence Trace

Status: completed

Scope:

- Render the expanded DCI trajectory as a compact AG-UI-driven timeline:
  searches tried, terms learned, hypotheses supported/rejected, files read,
  evidence anchors, and final caveats.
- Keep raw JSON collapsed and avoid a ranked-result-page UX.
- Preserve the single generic Workbench surface; do not reintroduce search,
  Office, or code modes.

Artifacts:

- Workbench DCI timeline UI update.
- UX E2E assertion or screenshot artifact.

Acceptance:

- A user can see why a file was selected or rejected without inspecting raw
  JSON.
- The trace remains minimal and does not clutter non-DCI tasks.
- The UI is replayable from AG-UI events/state.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI2605IR-10 - Document Source Alignment And Release Gate

Status: completed

Scope:

- Update `docs/IMPLEMENTATION.md` with completed DCI interface-resolution
  changes, verification commands, known limitations, and live E2E outcome.
- Keep `PLANS.md`, `tasks.md`, `AGENTS.md`, and `README.md` aligned if public
  behavior changes.
- Reconfirm that active code does not revive `RelayDocumentSearch*`,
  SQLite/FTS, vector search, AionUi, OpenCode/OpenWork runtime, or Tauri.

Artifacts:

- Implementation log update.
- Hard-cut/source-of-truth consistency check.

Acceptance:

- Planning docs and implementation docs describe the same active DCI
  direction.
- Completed tasks have concrete verification artifacts.

Verification:

- `git diff --check`
- `pnpm check`

### DCI2605-01 - Add Explicit DCI Trajectory Contract

Status: completed

Scope:

- Define a compact `RelayDciTrajectory.v1` diagnostic shape derived from Agent
  Framework tool observations.
- Include tool order, searched terms, matched paths, zero-match states, read
  targets, anchors, excerpts/hashes, failed reads, context labels, rejected
  decoys, and final cited evidence.
- Keep the trajectory as AG-UI/support diagnostic state, not a model-visible
  `document_search` tool or hidden retriever.

Artifacts:

- Sidecar trajectory builder or event-to-trajectory helper.
- Redacted support/AG-UI artifact projection.
- Implementation log entry describing the privacy boundary.

Acceptance:

- A DCI trajectory can be reconstructed from AG-UI/tool events.
- No Relay cache/index/temp file is written into searched or shared folders.
- Failed reads and zero-match grep calls are represented as failed/empty
  observations, not evidence.

Verification:

- new trajectory smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI2605-02 - Replace Domain-Specific Read Recovery With Generic Recovery

Status: completed

Scope:

- Keep read admission restricted to explicit user paths, observed candidate
  paths, or exact existing workspace paths.
- Replace domain-specific recovery terms with generic extraction from:
  - original user request;
  - failed read target;
  - previous `glob`/`grep` terms;
  - previous matched paths and excerpts.
- When Copilot invents a plausible filename, repair to an observable `grep`
  refinement or return a clear protocol failure. Do not crash the run.

Artifacts:

- Generic read-admission recovery implementation.
- Invented-read regression smoke.

Acceptance:

- No hard-coded business/entity exception is needed for examples such as
  company-name false positives.
- Invented read targets are counted by DCI metrics and do not produce streaming
  exceptions.

Verification:

- new invented-read recovery smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-03 - Increase Grep Observation Resolution

Status: completed

Scope:

- Extend `grep` observations to carry grouped match context, required/optional
  term hits, context labels, truncation state, and continuation guidance.
- Keep filters pushed into ripgrep and keep `--` before user/model patterns.
- Keep labels deterministic and transparent: possible evidence, negative
  context, guide/glossary, prior-period, generic memo, and no-evidence.

Artifacts:

- `RelayGrepObservation.v1` schema update.
- Regression cases for Japanese and English negation, prior period, guide,
  generic memo, and evidence snippets.

Acceptance:

- Copilot can distinguish filename/entity hits from local content evidence.
- A single weak lexical match is insufficient to satisfy DCI final readiness.

Verification:

- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-04 - Harden Evidence-First Read Observations

Status: completed

Scope:

- Ensure `read` returns stable anchors, bounded excerpts, text hashes,
  context labels, truncation state, and continuation guidance.
- Extend DCI coverage to supported Office/PDF/CSV reads without adding a
  separate Office/PDF search engine.
- Keep full local document contents out of default support bundles unless the
  user explicitly opts in.

Artifacts:

- `RelayReadObservation.v1` anchor/hash/context audit.
- Office/PDF/CSV DCI fixture or smoke updates.

Acceptance:

- Final answers can cite exact observed file anchors.
- Office/PDF/CSV reads use the same generic DCI recipe where extraction is
  supported.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- new CSV/Office DCI smoke when fixture is added
- `pnpm check`

### DCI2605-05 - Add Deterministic DCI Context Compaction

Status: completed

Scope:

- Add deterministic compaction for long DCI investigations.
- Preserve the ordered skeleton: terms tried, match counts, candidate paths,
  read anchors, hashes, rejected decoys, and current hypotheses.
- Do not use hidden LLM summarization as a source of truth.

Artifacts:

- Agent Framework middleware or sidecar helper for DCI compaction.
- Long-trajectory smoke that proves bulky excerpts are compacted while audit
  data remains replayable.

Acceptance:

- Long local investigations do not flood Copilot context.
- Compacted state remains sufficient for final-readiness and support replay.

Verification:

- `pnpm agent:dci-context-smoke`
- new long-trajectory DCI smoke
- `pnpm check`

### DCI2605-06 - Expand DCI Golden Corpus

Status: completed

Scope:

- Add deterministic corpora that require:
  - guide/glossary vocabulary discovery;
  - sparse clue conjunction;
  - misleading entity-name rejection;
  - prior-period rejection;
  - generic memo rejection;
  - negated local-context rejection;
  - exact evidence read of a non-obvious filename.
- Include at least one CSV/Office/PDF fixture once read-anchor behavior is
  stable.

Artifacts:

- Fixture generator or inline test corpus.
- Updated deterministic DCI golden smoke.

Acceptance:

- A single filename match or one exact phrase search cannot pass.
- Gold evidence is found only after local context is observed and terms are
  refined.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-07 - Add DCI Metric Unit Tests

Status: completed

Scope:

- Add direct tests for `RelayDciTrajectoryMetrics.v1` definitions.
- Cover raw-tool-only behavior, weak-clue conjunction, query expansion,
  coverage, exact read localization, hard-negative rejection, failed tools,
  invented read targets, and final citation.
- Ensure deterministic and live E2E use the same metric helper.

Artifacts:

- DCI metric unit smoke.
- Shared fixture cases for successful and failing trajectories.

Acceptance:

- Metric failures are explainable without reading live Copilot logs.
- Live and mock E2E cannot silently diverge in what "DCI pass" means.

Verification:

- new DCI metric smoke
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCI2605-08 - Refine AG-UI DCI Investigation Trace

Status: completed

Scope:

- Render the DCI trajectory as a compact investigation timeline:
  searches tried, files surfaced, files inspected, evidence snippets, rejected
  decoys, and final cited file.
- Keep the default Workbench surface minimal and keep raw observations
  collapsed.
- Ensure the UI is driven by AG-UI events/state, not custom hidden routes.

Artifacts:

- Workbench timeline refinement.
- UX E2E assertion or screenshot update.

Acceptance:

- A user can see why the final file was selected without opening raw JSON.
- The UI does not reintroduce separate search/Office/code modes.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI2605-09 - Strengthen Live Copilot DCI Release Gate

Status: completed

Scope:

- Keep `pnpm workbench:live-dci-e2e` as the signed-in Copilot gate.
- Save AG-UI events, DCI trajectory metrics, final result,
  prompt/response diagnostics, screenshots where available, and failure
  classification under `dist/e2e/live-dci/`.
- Fail when the right final file is reached by chance without local context
  checks.

Artifacts:

- Updated live DCI E2E runner and report schema.
- Implementation log entry template for pass/fail classification.

Acceptance:

- Provider/CDP/quota failures are clearly classified.
- DCI logic failures are distinguishable from Copilot/Edge environment
  failures.
- No mock model, heuristic local answer, or fallback search engine can pass the
  live DCI gate.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI2605-10 - Record Implementation And Source Alignment

Status: completed

Scope:

- Update `docs/IMPLEMENTATION.md` with the completed code/test changes,
  verification commands, and known limitations.
- Keep `PLANS.md`, `tasks.md`, `AGENTS.md`, and `README.md` aligned if any
  public behavior changes.
- Reconfirm that active code does not revive `RelayDocumentSearch*`,
  SQLite/FTS, vector search, AionUi, OpenCode/OpenWork runtime, or Tauri.

Artifacts:

- Implementation log update.
- Hard-cut / source-of-truth consistency check.

Acceptance:

- The plan, tasks, implementation log, and active code describe the same DCI
  direction.
- Completed tasks have concrete verification artifacts.

Verification:

- `git diff --check`
- `pnpm check`

### DCIFS01 - Add Search Trajectory Ledger

Status: completed

Scope:

- Build a run-local search trajectory ledger from Agent Framework tool
  observations.
- Record, at minimum:
  - `glob` patterns and surfaced paths;
  - `grep` terms, allTerms/anyTerms/excludeTerms, matched paths, zero-match
    states, and matched terms;
  - `read` targets, anchors, evidenceState, excerpts/hashes, and failures;
  - candidate/evidence/negative/guide/prior-period/generic/not-found labels
    derived from observed tool results.
- Keep the ledger internal/diagnostic. Do not expose a new model-visible
  `document_search` tool.

Artifacts:

- Sidecar trajectory ledger implementation.
- AG-UI trace payload or support artifact containing the ledger.
- Implementation log entry describing the ledger schema and privacy boundary.

Acceptance:

- The ledger is reconstructable from raw AG-UI/tool events.
- Failed reads and zero-match greps are represented as failed/empty evidence,
  not as completed evidence.
- No shared-folder cache/index files are created.

Verification:

- new ledger smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCIFS02 - Enforce Evidence Readiness From The Ledger

Status: completed

Scope:

- Replace prompt-only "do not finalize too early" behavior with ledger-backed
  final readiness checks.
- Block or repair final answers when:
  - no local file observation exists;
  - the latest useful search has zero matches;
  - only guide/glossary documents were read;
  - all observed candidates are negative/prior-period/generic;
  - the only `read` attempts failed;
  - no exact evidence read exists for the final cited file.
- Prefer another `grep`, `glob`, or exact `read` of an observed path over
  allowing a premature final.

Artifacts:

- Protocol guard / Agent Framework middleware update.
- Regression smoke covering guide-only, zero-match, failed-read, and
  hard-negative-only trajectories.

Acceptance:

- "local tools unavailable", invented no-match, and guide-only final answers
  do not pass when more local search is possible.
- The repair path remains tool-based and observable; no hidden local answer is
  generated by Relay.

Verification:

- new final-readiness ledger smoke
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS03 - Harden Read Target Admission

Status: completed

Scope:

- Restrict `read` in search trajectories to:
  - explicit user-provided paths;
  - paths surfaced by prior `glob`, `grep`, or `read` observations in the same
    run;
  - exact workspace paths that currently exist.
- If Copilot invents a plausible filename, return a normal tool observation or
  protocol correction that points back to observed candidates.
- Do not crash the run on invented read targets.

Artifacts:

- Read admission guard.
- Smoke covering invented README/fake-report reads after a zero-match grep.

Acceptance:

- Invented paths are counted in DCI metrics and blocked or converted to an
  actionable observation.
- Existing legitimate explicit path reads still work.

Verification:

- new invented-read smoke
- `pnpm agent:golden-smoke`
- `pnpm check`

### DCIFS04 - Improve Grep Observation Semantics

Status: completed

Scope:

- Extend `grep` observations with lightweight context labels derived from
  excerpts:
  - `possible_evidence`;
  - `negative_context`;
  - `guide_or_glossary`;
  - `prior_period`;
  - `generic_context`.
- Keep labels deterministic and transparent. Do not hard-code company-specific
  exceptions.
- Include enough excerpt/context information for Copilot to refine terms.

Artifacts:

- Grep observation schema update.
- Grep smoke with Japanese/English negation, prior-period, guide, and generic
  examples.

Acceptance:

- A filename/entity match with local negation is clearly distinguishable from
  content evidence.
- Labels improve Copilot behavior but do not replace `read` for final
  evidence.

Verification:

- `pnpm agent:dci-grep-smoke`
- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS05 - Add DCI Trajectory Metrics To Deterministic Smokes

Status: completed

Scope:

- Move the live-only `RelayDciTrajectoryMetrics.v1` checks into deterministic
  mock Copilot smokes.
- Cover:
  - raw-tool-only investigation;
  - weak-clue conjunction;
  - query expansion;
  - coverage of the gold file in grep observations;
  - exact evidence localization by read;
  - hard-negative rejection;
  - failed-tool and invented-read counts.

Artifacts:

- Shared DCI metric helper for live and deterministic tests.
- Updated `dci-golden-smoke` and replay fixture if needed.

Acceptance:

- DCI quality can be tested without live Copilot quota.
- The live E2E and deterministic smoke use the same metric definitions.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCIFS06 - Add Multi-Hop File Search Corpus

Status: completed

Scope:

- Add a deterministic corpus where the first useful file only reveals the
  vocabulary needed to find the true evidence file.
- Include:
  - a glossary/guide that is not evidence;
  - an entity-name decoy;
  - a prior-period reference;
  - a generic memo;
  - a gold evidence file with non-obvious filename;
  - optional CSV/Office fixture once anchor extraction is stable.
- Require at least one refinement after observing local content.

Artifacts:

- Fixture generator or inline test corpus.
- DCI golden smoke scenario.

Acceptance:

- A single exact search or filename match cannot pass.
- The gold file can be found only by using terms learned from local context.

Verification:

- `pnpm agent:dci-golden-smoke`
- `pnpm check`

### DCIFS07 - Expose DCI Investigation Timeline In AG-UI

Status: completed

Scope:

- Render the trajectory ledger in the Workbench as a compact investigation
  trail:
  - searched terms;
  - surfaced files;
  - inspected files;
  - evidence snippets;
  - rejected decoys;
  - final cited evidence.
- Keep the default surface minimal. Raw JSON and support details stay
  collapsed.

Artifacts:

- Workbench UI update.
- UX E2E assertion or screenshot update.

Acceptance:

- Users can see why a file was selected without reading raw tool JSON.
- The UI does not reintroduce separate search/Office/code modes.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCIFS08 - Run And Record Live DCI File Search E2E

Status: completed

Scope:

- Run `pnpm workbench:live-dci-e2e` after DCIFS01-DCIFS07 pass.
- Confirm live Copilot can complete an ambiguous file-search investigation
  using raw local tools only.
- Save:
  - AG-UI events;
  - DCI trajectory metrics;
  - final result;
  - provider/CDP diagnostics;
  - failure classification if blocked.

Artifacts:

- `dist/e2e/live-dci/` run output.
- `docs/IMPLEMENTATION.md` entry with command and result.

Acceptance:

- Live run passes the DCI trajectory metric gate, not just final-answer text.
- Provider/CDP/quota failures are classified without fallback answers.

Verification:

- `pnpm workbench:live-dci-e2e`
- `pnpm check`

### DCI01 - Document The DCI Tool Contract Boundary

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a DCI section that explains how
  `glob`, `grep`, `read`, bounded `bash`, and `apply_patch` compose into raw
  corpus interaction.
- Explicitly state that Relay will not revive `RelayDocumentSearch*`,
  SQLite/FTS, or a dedicated search mode for this milestone.
- Map DCI paper concepts to Relay ownership:
  - Agent Framework: session, continuation, middleware, tool loop;
  - OpenCode: model-facing local tool shape;
  - Relay: policy, Office/PDF extraction, Windows/shared-folder safety,
    diagnostics, packaging;
  - AG-UI: investigation trace and approvals.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Implementation log entry with the paper/repo references.

Acceptance:

- The doc makes it clear that DCI is a generic agent recipe over existing
  tools, not a new retrieval subsystem.
- The doc lists which DCI capabilities are implemented as first-class tools
  and which are intentionally blocked or bounded.

Verification:

- `git diff --check`

### DCI02 - Add DCI-Grade Structured Grep

Status: completed

Scope:

- Extend the Agent Framework `grep` function signature with structured
  arguments for:
  - `allTerms`;
  - `anyTerms`;
  - `excludeTerms`;
  - `fixedStrings`;
  - `caseInsensitive`;
  - `contextLines`;
  - `includeGlobs`;
  - `excludeGlobs`;
  - `maxMatchesPerFile`;
  - `limit`;
  - `timeoutMs`.
- Keep the existing `pattern` and `glob` arguments as OpenCode-compatible
  simple paths.
- Compile structured filters to safe ripgrep argv. Always put `--` before
  model/user patterns.
- Return structured observations with path, displayPath, line number, excerpt,
  matched terms, truncation, and continuation guidance.
- Do not route Office/PDF containers through `grep`; keep exact `read` for
  those.

Artifacts:

- Sidecar grep implementation update.
- Tool catalog snapshot update.
- Grep smoke covering conjunctive terms, exclusion terms, context lines,
  caps, and a pattern starting with `-`.

Acceptance:

- A request such as "部品売上" can require both concept terms to appear in the
  same file/context before a candidate is promoted.
- Misleading entity-name-only matches can be demoted by requiring contextual
  evidence instead of relying on filename rank.
- Existing simple `grep(pattern, glob)` behavior remains compatible.

Verification:

- new DCI grep smoke
- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:rg-stream-smoke`
- `pnpm check`

### DCI03 - Improve Read Observations For Evidence Anchors

Status: completed

Scope:

- Extend `read` observations with stable evidence anchors:
  - text/code: line ranges and offset/limit continuation;
  - Excel/CSV: sheet/table/cell/range hints when available;
  - Word/PDF/PPT: page/section/slide anchors when available.
- Keep full local artifacts in Relay storage/support bundles, but project
  bounded excerpts and hashes to Copilot.
- Add `evidenceState` values that distinguish filename/path candidates,
  generic content hits, conjunctive concept hits, and exact local evidence.

Artifacts:

- Sidecar read observation update.
- Office/PDF extraction smoke updates.
- Updated AG-UI replay fixture if event payload shape changes.

Acceptance:

- Copilot can cite or reason from exact local observations without receiving
  entire large files.
- Office/PDF candidate promotion can depend on actual extracted content when
  available.
- Local full artifacts remain user-controlled and redacted by default in
  support bundles.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI04 - Add Agent Framework DCI Context Middleware

Status: completed

Scope:

- Implement deterministic tool-result truncation by tool type in the Agent
  Framework middleware/projection layer.
- Add compaction that preserves the ordered trajectory skeleton:
  tool name, args summary, paths, hashes, counts, latest evidence snippets,
  and artifact IDs.
- Keep the most recent turns intact and compact older bulky observations when
  accumulated tool output crosses a threshold.
- Do not add LLM summarization in this task. Summarization can be considered
  later only if replayable and observable.

Artifacts:

- Middleware/projection update.
- Context compaction smoke with repeated `grep`/`read` observations.
- Implementation note describing thresholds and artifact retention.

Acceptance:

- Long DCI investigations do not flood Copilot with raw tool output.
- The AG-UI replay/support bundle can reconstruct what was searched and read.
- Compaction cannot hide a mutation or approval event.

Verification:

- new context compaction smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI05 - Add DCI Search Recipe To Framework Guidance

Status: completed

Scope:

- Add concise Agent Framework instruction/projection guidance for DCI behavior:
  search direct terms, combine weak clues, inspect local context, extract new
  terms/entities, refine, cross-check, and answer only after relevant
  observations exist.
- Keep this guidance generic across local file search, codebase exploration,
  Office review, and evidence-backed Q&A.
- Do not add a `document_search` tool, a fixed taxonomy, or a task-specific
  planner.

Artifacts:

- Agent instructions/tool projection update.
- Golden smoke where a misleading filename/entity candidate must not win over
  a lower-ranked file with conjunctive local evidence.

Acceptance:

- The model has enough guidance to use DCI-style iterative exploration without
  being forced into a brittle fixed query plan.
- `final` is blocked or corrected when local evidence was required but no
  local observation exists.

Verification:

- new DCI golden smoke
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### DCI06 - Render AG-UI Investigation Timeline

Status: completed

Scope:

- Update Workbench run rendering so DCI-style runs show:
  - search terms tried;
  - files inspected;
  - evidence snippets/anchors;
  - refinements;
  - caveats and terminal confidence.
- Keep the default surface minimal and professional. Diagnostics and raw JSON
  stay collapsed under support details.
- Ensure approvals and mutations remain visually distinct from read-only
  investigation events.

Artifacts:

- Workbench timeline UI update.
- UX E2E snapshot or Playwright assertion.

Acceptance:

- Users can understand why a candidate was selected without reading raw
  Copilot/tool JSON.
- The UI does not reintroduce separate "file search / Office / code" modes.
- The trace remains AG-UI-event driven.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI07 - Add Local Corpus Golden Benchmarks

Status: completed

Scope:

- Create deterministic local corpora under test fixtures:
  - sparse clue conjunction;
  - misleading entity-name match;
  - exact phrase with nearby negation;
  - Office/Excel content evidence;
  - codebase symbol lookup and edit verification.
- Run them through the Agent Framework mock Copilot path so the acceptance does
  not depend on live Copilot quota.
- Save sanitized AG-UI event logs as replay fixtures.

Artifacts:

- DCI golden smoke script.
- Fixture corpus.
- Replay fixtures.

Acceptance:

- The benchmark proves DCI behavior over raw local files, not retriever rank.
- The same generic tools handle search, Office inspection, and codebase
  exploration.

Verification:

- new DCI golden smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI08 - Build Live DCI E2E Corpus And Runner

Status: completed

Scope:

- Add a live E2E runner, e.g. `scripts/workbench-live-dci-e2e.mjs`, that uses
  the real signed-in M365 Copilot provider through Edge CDP.
- The runner must create an isolated temporary corpus with:
  - sparse clue conjunction;
  - misleading entity-name/filename decoys;
  - local context negation;
  - text/Markdown/CSV files;
  - Office fixtures once DCI03 anchors are available.
- The user task should be natural language and should not reveal the exact file
  names that contain the answer.
- The runner must require actual Relay tools through AG-UI/Agent Framework:
  `glob`, `grep`, `read`, and, where appropriate, bounded `bash`.
- The runner must fail if the final answer appears before required local tool
  observations exist.

Artifacts:

- Live DCI E2E script.
- Temporary-corpus fixture generator.
- Acceptance assertions for tool sequence, evidence file, final answer, and
  decoy rejection.
- Run output under `dist/e2e/live-dci/`.

Acceptance:

- The script can run independently from the older live project E2E.
- It verifies the DCI pattern from the paper: iterative raw-corpus interaction,
  local context reads, and refined search.
- It does not use `RelayDocumentSearch*`, SQLite/FTS, a mock model, or a
  fallback heuristic answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command when Edge/Copilot is available
- `pnpm check`

### DCI09 - Add Live DCI E2E Classification And Artifacts

Status: completed

Scope:

- Classify live DCI failures as:
  - provider quota/rate limit;
  - Edge CDP readiness or selector drift;
  - Copilot prompt delivery/response extraction;
  - Agent Framework continuation/session state;
  - OpenCode tool contract violation;
  - AG-UI replay/state rendering;
  - DCI logic failure.
- Save sanitized artifacts:
  - AG-UI event log;
  - framework trace IDs;
  - tool-call trajectory summary;
  - evidence snippets/anchors;
  - decoy rejection evidence;
  - provider diagnostics;
  - Workbench screenshot.
- Redact raw document contents by default. Include enough excerpts to prove
  acceptance without exposing unnecessary local data.

Artifacts:

- Updated live DCI E2E report schema.
- Implementation log entry template for live DCI runs.
- Optional AG-UI replay fixture derived from a sanitized successful run.

Acceptance:

- A failed live DCI run is actionable without reading raw Copilot logs.
- A successful run proves the paper-style DCI behavior, not just Copilot
  connectivity.
- Release notes can distinguish provider-blocked, framework-blocked, and
  DCI-logic failures.

Verification:

- live DCI E2E command
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI10 - Run Live Copilot DCI E2E And Record Result

Status: completed (live attempt environment-blocked)

Scope:

- After DCI01-DCI09 pass, run a signed-in live Copilot E2E that performs a
  realistic local-corpus investigation.
- Use the DCI08 fixture that requires iterative search, decoy rejection, and
  local context checks.
- Classify failures as provider/CDP, framework continuation, tool contract,
  AG-UI replay, or DCI logic.
- Record the outcome in `docs/IMPLEMENTATION.md` with artifact paths and the
  exact command.

Artifacts:

- `dist/e2e/live-dci/` run artifacts.
- Implementation log entry with command, result, and failure/success class.

Acceptance:

- Live Copilot can complete at least one DCI investigation without relying on a
  dedicated document-search mode.
- The run demonstrates at least two search/refinement steps and at least one
  local context `read` before final answer.
- The final answer identifies evidence-backed files/snippets and rejects the
  decoy candidate.
- If Copilot or Edge fails, the run ends with a structured provider/adapter
  diagnostic, not a fallback answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command, e.g. `pnpm workbench:live-dci-e2e`
- `pnpm check`

### POSTLIVE01 - Keep Tool Validation Failures Out Of Approval

Status: completed

Scope:

- Audit current validation paths that throw before Agent Framework can feed a
  tool result back into the same session, starting with `apply_patch_invalid`.
- Keep invalid mutations away from user approval.
- Repair malformed Copilot JSON tool projections once in the M365 provider
  adapter before they can become approval requests; execution-time validation
  failures remain Agent Framework tool observations.
- Preserve hard AG-UI `RUN_ERROR` only for provider, framework, or executor
  health failures that cannot safely continue.

Artifacts:

- Sidecar adapter path for validation repair before approval plus normal
  framework observation feedback after tool execution starts.
- Regression smoke covering invalid patch -> correction -> valid patch in the
  same session.
- Implementation note explaining why this is Agent Framework continuation
  rather than a Relay retry planner.

Acceptance:

- Malformed `apply_patch` does not ask the user for approval.
- Copilot receives one strict repair prompt and may return a corrected
  OpenCode-shaped tool call without a new user run.
- AG-UI replay shows only the corrected tool call or a structured blocked
  state; the invalid mutating call never reaches approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### POSTLIVE02 - Define OpenCode-Style Read Observation Projection

Status: completed

Scope:

- Replace raw file-body prompt projection with an OpenCode-style read
  observation contract: path, size, hash, excerpt, tail, omitted count, and
  explicit `read` continuation guidance for exact context.
- Keep full local content in AG-UI/support artifacts and local tool results.
- Ensure `read(offset, limit)` remains the way to request exact follow-up
  context instead of injecting entire files into every Copilot turn.
- Cover HTML/JS/CSS/Markdown reads because live project E2E times out after
  read observations.

Artifacts:

- Prompt-safe read observation projector.
- Fixture or smoke showing a large `read` result projected without raw body
  echo.
- Documentation update in `docs/OPENCODE_TOOL_CONTRACT.md` if the public
  read-result semantics are clarified.

Acceptance:

- Copilot prompt payload after `read` is bounded and deterministic.
- Follow-up edits still have a clear path to exact context through `read`
  offset/limit.
- AG-UI replay/support bundles still include enough data to debug the full
  file read.

Verification:

- read observation projection smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### POSTLIVE03 - Make Provider Timeout A Resumable Framework State

Status: completed

Scope:

- Keep the same Agent Framework `AgentSession` and AG-UI thread when the M365
  Copilot provider times out after a tool observation.
- Add a named provider-adapter retry/resume policy only at the Copilot CDP
  boundary. It must be visible in framework trace/AG-UI diagnostics and must
  not fabricate a tool/final decision.
- Surface a user-visible blocked state only after retry policy is exhausted.
- Ensure timeout classification distinguishes provider response timeout from
  framework continuation timeout, approval wait, and tool execution timeout.

Artifacts:

- Provider timeout state/trace update.
- Resume or retry smoke using mock Copilot timeout followed by success.
- Updated live E2E classification assertions.

Acceptance:

- A provider timeout after a tool result does not lose session context.
- A retry, when performed, is recorded as provider-adapter behavior.
- If still blocked, AG-UI replay shows a named provider-blocked terminal state.

Verification:

- provider timeout continuation smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE04 - Centralize Copilot Patch Projection Repair Diagnostics

Status: completed

Scope:

- Treat Markdown Add File leading-`+` repair as Copilot projection repair, not
  as relaxed OpenCode patch grammar.
- Move repair notes into trace/support diagnostics and approval metadata so
  users can see that the approved patch is the revalidated OpenCode form.
- Add negative cases showing non-Markdown malformed Add File bodies still fail.

Artifacts:

- Repair metadata in framework trace or tool projection diagnostics.
- Smoke fixture covering repairable Markdown and non-repairable malformed
  patch.

Acceptance:

- The model-facing contract remains strict OpenCode `patchText`.
- Repair is deterministic, narrow, and observable.
- Non-repairable malformed patches remain blocked before approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE05 - Reduce Relay AAE Authority To Middleware Projection

Status: completed

Scope:

- Review remaining `RelayAdmissibleActionEnvelope` authority after LIVEFIX.
- Move any remaining durable final/tool/question eligibility into Agent
  Framework middleware/session state.
- Keep the envelope only as a Copilot prompt projection and diagnostic
  serialization, or document the remaining deletion blocker.

Artifacts:

- Middleware/projection refactor or explicit blocker note.
- Updated `docs/HARNESS_ARCHITECTURE.md` delete/adapt/keep matrix.

Acceptance:

- The framework registry and middleware are the source of tool availability.
- Prompt text cannot be the only enforcement point for `final`, `ask_user`, or
  mutation requirements.
- No new Relay-specific planner state is introduced.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### POSTLIVE06 - Split Live E2E Acceptance By Framework Capability

Status: completed

Scope:

- Split live E2E reporting into canary, project creation, project improvement,
  and provider-blocked continuation outcomes.
- Save AG-UI event logs and framework traces for each stage.
- Make project improvement the release-readiness gate once provider availability
  is sufficient; provider-blocked remains acceptable for development runs only
  when clearly classified.

Artifacts:

- Updated live E2E script/reporting.
- AG-UI replay fixture or assertion for project creation and read-continuation
  provider-blocked outcomes.
- Implementation log entry.

Acceptance:

- A create-pass/improve-provider-timeout run is reported as exactly that, not
  as generic failure or full success.
- The same script can prove a full create -> improve -> render pass when
  Copilot responds.
- Release readiness cannot silently ignore project-improvement failure.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

### LIVEFIX01 - Capture Live E2E Baseline And Failure Classes

Status: completed

Scope:

- Record the latest live canary and multi-file project E2E results in
  `docs/IMPLEMENTATION.md`.
- Classify failures as:
  - provider quota;
  - Copilot CDP prompt insertion/composer normalization;
  - OpenCode tool contract validation;
  - Agent Framework continuation/final eligibility;
  - AG-UI replay/artifact export.
- Link the concrete artifacts under `dist/e2e/live-copilot/` and
  `dist/e2e/live-project/` without committing sensitive prompt dumps.

Artifacts:

- Implementation log entry with command, result, and classification.
- Optional sanitized excerpt or fixture when it is safe to commit.

Acceptance:

- The passing lightweight canary and failing project E2E are recorded as
  different outcomes.
- A failed project run is not described as quota-limited when Copilot was
  available.
- The next fix task can start from a named failure class, not a vague
  "Copilot unstable" bucket.

Verification:

- `git diff --check`

### LIVEFIX02 - Add OpenCode `apply_patch` Conformance Gate

Status: completed

Scope:

- Keep `apply_patch(req:patchText)` as the only model-visible patch shape.
- Validate `patchText` grammar before approval and execution.
- Return malformed patches as structured tool observations in the same Agent
  Framework session.
- Add golden cases for:
  - valid multi-file add;
  - valid update;
  - malformed add-file body missing leading `+`;
  - duplicate Begin/End envelopes;
  - legacy executor-only `patch` compatibility.

Artifacts:

- Sidecar conformance validator or existing validator integration.
- Regression smoke/fixture for malformed patch observations.
- Updated `docs/OPENCODE_TOOL_CONTRACT.md` only if the public contract changes.

Acceptance:

- A malformed patch never reaches approval as a side-effect action.
- Copilot receives a structured observation that tells it exactly why the patch
  failed and can continue in the same `AgentSession`.
- No new Relay-specific patch tool or argument name is introduced.

Verification:

- `pnpm agent:tool-catalog-smoke`
- patch conformance smoke
- `pnpm check`

### LIVEFIX03 - Harden Copilot CDP Composer Normalization

Status: completed

Scope:

- Keep prompt insertion, submission, and response extraction inside the M365
  Copilot CDP provider adapter.
- Normalize both intended and visible composer text before corruption checks:
  line endings, trailing newline, Unicode normalization, zero-width
  characters, and Copilot markdown/code-fence rendering transformations.
- Save a small redacted prompt-diff artifact when normalized verification
  still fails.
- Do not submit when normalized verification fails; return a provider-adapter
  blocked error with diagnostics.

Artifacts:

- Provider adapter normalization helper.
- Unit/smoke coverage for one-character composer differences.
- Redacted diagnostic fixture.

Acceptance:

- Benign one-character UI normalization differences do not fail live E2E.
- Real prompt corruption fails before submit and points to the exact
  normalized diff.
- The adapter does not make tool/final eligibility decisions.

Verification:

- Copilot prompt insertion smoke
- `pnpm workbench:live-copilot-e2e` when quota allows
- `pnpm check`

### LIVEFIX04 - Compact Tool Observations Through Framework State

Status: completed

Scope:

- Make tool observations deterministic, bounded, and artifact-backed before
  they are projected into Copilot prompts.
- For `read` and large command outputs, send hash, size, artifact ID, concise
  summary, and bounded excerpt by default.
- Preserve exact full content as a local artifact for diagnostics and follow-up
  tool use.
- Ensure compaction rules are middleware/framework state rules, not
  task-specific prompt folklore.

Artifacts:

- Observation compaction implementation or documented wiring to existing
  framework state.
- Fixture showing compacted `read` observation for HTML/JS/CSS files.
- Implementation log entry.

Acceptance:

- Follow-up edit tasks still have enough context to act correctly.
- Copilot composer payloads are smaller and less prone to CDP insertion
  corruption.
- AG-UI replay and support bundles still expose artifact IDs needed for debug.

Verification:

- transcript/observation smoke
- AG-UI replay smoke
- `pnpm check`

### LIVEFIX05 - Make Agent Framework Continuation The Terminal Authority

Status: completed

Scope:

- Audit timeout/final/continuation logic after tool observations.
- Ensure the same `AgentSession` owns continuation after tool result feedback.
- Move any remaining Relay-only final eligibility or continuation timers into
  framework middleware or a thin framework-adapter policy.
- Classify timeout source as provider response, framework continuation,
  approval wait, or tool execution.

Artifacts:

- Continuation/final eligibility refactor.
- Session continuation smoke covering: tool error -> retry, successful
  mutation -> final, and read -> mutation.
- Implementation log entry.

Acceptance:

- A successful tool call followed by a missing final does not become an
  unclassified `StreamingError`.
- A malformed patch observation can continue to a corrected patch or a
  structured blocked state.
- `final` and `question` remain middleware decisions.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### LIVEFIX06 - Make AG-UI Replay The Live E2E Acceptance Surface

Status: completed

Scope:

- Save AG-UI event logs for lightweight canary and multi-step project E2E.
- Make the replay smoke validate:
  - run lifecycle;
  - tool call args and results;
  - malformed tool observation;
  - final or structured blocked state;
  - artifact references.
- Keep raw Relay support dumps as attachments, not the primary acceptance
  format.

Artifacts:

- Live E2E AG-UI event log export.
- Replay fixture or test update.
- Implementation log entry.

Acceptance:

- A live E2E failure can be explained from AG-UI replay plus framework trace.
- Workbench-visible state does not require parsing Relay-only raw event text.

Verification:

- `pnpm agent:agui-replay-smoke`
- live project E2E artifact inspection
- `pnpm check`

### LIVEFIX07 - Rerun Live Copilot Project E2E

Status: completed

Scope:

- After LIVEFIX02 through LIVEFIX06 pass deterministic checks, rerun:
  - lightweight signed-in Copilot canary;
  - multi-file project creation;
  - follow-up project improvement.
- Treat provider quota as provider-blocked.
- Treat prompt corruption, malformed patch loops, or unclassified streaming
  errors as harness failures.

Artifacts:

- Ignored live E2E artifacts under `dist/e2e/`.
- Implementation log entry with commands and outcome.

Acceptance:

- If Copilot is available, the project E2E reaches final output after creation
  and after improvement.
- If Copilot is unavailable, the result is a structured provider-blocked state.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

The completed `REUSE*` queue below is retained as the foundation for the new
`LIVEFIX*` queue. It reduced wheel-reinvention risk by forcing every
Relay-owned harness component to map to Microsoft Agent Framework, AG-UI,
OpenCode, MCP, or a documented Relay-only local policy/tool-body need.

### REUSE01 - Build Delete/Adapt/Keep Matrix

Status: completed

Scope:

- Inventory every active harness-facing component in `apps/sidecar` and
  Workbench code, including:
  - `RelayTurnState`;
  - `RelayAdmissibleActionEnvelope`;
  - `RelayProtocolGuard`;
  - approval bridge/resume code;
  - tool registry/projection code;
  - `RelayToolObservation`;
  - Copilot CDP transport;
  - Workbench event/state rendering.
- For each component, classify it as:
  - `delete`: replaced by Agent Framework / AG-UI / OpenCode / MCP;
  - `adapt`: thin adapter over a framework primitive;
  - `keep`: Relay-owned because of M365 Copilot CDP, workspace policy,
    packaging, OfficeCLI, or local safety.
- Add the matrix to `docs/HARNESS_ARCHITECTURE.md`.

Artifacts:

- Updated `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- No active component remains in an uncategorized "Relay harness" bucket.
- Every `keep` item has a concrete reason tied to Copilot CDP, local policy,
  approved local function bodies, packaging, or diagnostics.
- Every `delete`/`adapt` item names the exact replacement primitive.

Verification:

- `rg -n "delete|adapt|keep|RelayTurnState|RelayAdmissibleActionEnvelope|ApprovalRequired|AG-UI|OpenCode|MCP" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

### REUSE02 - Align `apply_patch` Argument Shape With OpenCode

Status: completed

Scope:

- Change the model-facing `apply_patch` argument from Relay-specific `patch`
  to OpenCode-compatible `patchText`.
- Keep executor compatibility for legacy `patch`, but hide it from prompts,
  catalog snapshots, and new tests.
- Update the tool catalog smoke, protocol-state smoke, golden smoke, and live
  project E2E script.
- Update `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Sidecar tool registration/projection update.
- Updated smoke fixtures.
- Implementation note.

Acceptance:

- New prompts and catalog snapshots show `apply_patch(req:patchText)`.
- Executor still accepts old `patch` only as compatibility.
- No new model-visible Relay-only patch argument remains.

Verification:

- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE03 - Decide OpenCode Built-In Coverage

Status: completed

Scope:

- Compare Relay's model-facing tools with OpenCode built-ins:
  `bash`, `edit`, `write`, `read`, `grep`, `glob`, `list`, `apply_patch`,
  `skill`, `todoread`, `todowrite`, `webfetch`, `websearch`, and `question`.
- For each tool, decide `adopt now`, `defer`, `deny`, or `extension`.
- Specifically evaluate:
  - `list` as a read-only directory overview tool;
  - `todoread`/`todowrite` as session-scoped planning artifacts for complex
    work;
  - `skill` as future packaged guidance, not ad hoc prompt text;
  - `webfetch`/`websearch` as denied unless policy later allows them.
- Record the decision in `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Optional tool-catalog fixture update only if a tool is adopted.

Acceptance:

- Every OpenCode built-in has an explicit decision.
- If a tool is not adopted, the reason is policy, scope, or user value, not
  oversight.
- No Relay-specific replacement is proposed when an OpenCode tool is the right
  fit.

Verification:

- `rg -n "list|todoread|todowrite|skill|webfetch|websearch|question" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

### REUSE04 - Evaluate Local MCP Reuse Before More Tool Bodies

Status: completed

Scope:

- Review Agent Framework local MCP support against Relay's current local
  function tools.
- Evaluate local MCP candidates for:
  - filesystem read/list/search;
  - git status/diff;
  - sqlite/index access;
  - future app integrations.
- For each candidate, decide whether to:
  - use Agent Framework local MCP;
  - keep Relay function body;
  - expose a Relay tool as local MCP later;
  - reject due to data/security/packaging policy.

Artifacts:

- Add `docs/MCP_REUSE_DECISION.md`.
- Link the decision from `PLANS.md` and `docs/HARNESS_ARCHITECTURE.md`.

Acceptance:

- No future generic local tool can be added without referencing the MCP reuse
  decision.
- Decisions include security, Windows share behavior, approval policy, audit,
  packaging, and offline usability.

Verification:

- `rg -n "filesystem|git|sqlite|MCP|approval|packaging|security" docs/MCP_REUSE_DECISION.md`
- `git diff --check`

### REUSE05 - Move Session Continuity To Agent Framework First

Status: completed

Scope:

- Audit all state keyed by run ID, request ID, thread ID, and Relay-specific
  state IDs.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Keep run IDs only as AG-UI/UI correlation IDs.
- Demote `RelayTurnState` to a derived projection object, then document the
  remaining deletion path.

Artifacts:

- Sidecar state refactor.
- Session continuity smoke.
- Implementation note.

Acceptance:

- Follow-up user turns and approval responses resume the same Agent Framework
  session.
- Completed tool results from an old run cannot satisfy a new run.
- `RelayTurnState` is no longer a durable source of truth.

Verification:

- Add/update session continuity smoke.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE06 - Replace Approval Ledger With Native HITL

Status: completed

Scope:

- Wrap mutating tools with Agent Framework approval-required primitives such as
  `ApprovalRequiredAIFunction` or the current .NET equivalent.
- Project approval requests/responses through AG-UI human-in-the-loop events.
- Keep Relay's backup/diff/audit data as metadata on the approved function
  result, not as a separate approval protocol.
- Delete or quarantine any path that can execute a mutation outside the pending
  approved function call.

Artifacts:

- Approval cutover implementation.
- AG-UI approval replay fixture.
- Approval audit fixture.

Acceptance:

- Approve resumes the exact pending function call.
- Reject records a structured denied observation and does not retry through
  another mutation path.
- Workbench approval UI can replay from AG-UI events alone.

Verification:

- `pnpm agent:agui-client-tool-smoke`
- approval replay smoke
- `pnpm check`

### REUSE07 - Replace AAE With Middleware-Derived Projection

Status: completed

Scope:

- Keep the useful behavior of `RelayAdmissibleActionEnvelope`, but make Agent
  Framework middleware/tool registry filtering the source of truth.
- Generate the Copilot prompt's visible tool list from the framework registry
  and middleware decision.
- Ensure final/question/tool availability is enforced before and after Copilot
  output, not by prompt instructions alone.
- Add hard assertions that local-action tasks cannot reach Copilot with an
  empty tool registry.

Artifacts:

- Middleware-derived projection implementation.
- Prompt dump fixture.
- Protocol guard regression tests.

Acceptance:

- `RelayAdmissibleActionEnvelope` is either deleted or explicitly reduced to a
  diagnostic serialization of framework state.
- `local tools unavailable`, unnecessary `ask_user`, and premature `final` are
  blocked structurally.
- Prompt text is a projection, not a policy engine.

Verification:

- `pnpm agent:framework-native-prevention-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### REUSE08 - Make AG-UI Replay The Primary E2E Artifact

Status: completed

Scope:

- Save standard AG-UI event logs for deterministic and live E2E runs.
- Add a replay smoke that reconstructs:
  - run lifecycle;
  - tool call start/args/end/result;
  - approval request/response;
  - state snapshot/delta;
  - final output.
- Ensure Workbench UI can render from replayed AG-UI events without depending
  on Relay-only raw state.

Artifacts:

- AG-UI event log fixture.
- Replay smoke script.
- Implementation note.

Acceptance:

- A failed E2E can be debugged from AG-UI events plus framework trace.
- Relay-specific raw dumps are support attachments only.
- No primary Workbench state depends on a custom run-event union.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### REUSE09 - Add Framework-Compatible Observability

Status: completed

Scope:

- Define an OpenTelemetry-compatible trace shape for:
  - Copilot provider readiness and send/receive;
  - prompt projection;
  - tool call admission;
  - approval pause/resume;
  - local tool execution;
  - final eligibility.
- Export traces in support bundles while redacting sensitive prompt/file data.
- Keep prompt dumps as opt-in sensitive artifacts.

Artifacts:

- Trace schema or implementation.
- Support bundle update.
- Redaction test.

Acceptance:

- Provider failures such as Copilot quota are distinguishable from harness
  failures.
- Tool failures include call ID, tool name, workspace, artifact IDs, and
  retryability without leaking file contents by default.
- Traces line up with AG-UI event IDs.

Verification:

- support bundle smoke
- `pnpm check`

### REUSE10 - Rerun Live Copilot Canaries After Structural Smokes

Status: completed

Scope:

- After REUSE02 through REUSE09 pass deterministic checks, rerun live Copilot
  E2E canaries:
  - multi-file project creation;
  - follow-up project improvement;
  - file search/discovery;
  - Office inspect/edit/verify.
- Treat Copilot quota as provider-blocked, not as pass or harness failure.

Artifacts:

- Live E2E artifacts under ignored diagnostics paths.
- `docs/IMPLEMENTATION.md` entry with command, date, environment, and result.

Acceptance:

- If Copilot is available, the canaries complete without local-tools-unavailable
  prose, unnecessary `ask_user`, premature `final`, or duplicated mutation.
- If Copilot quota blocks the run, the app emits structured
  `copilot_quota_limited` and the E2E is marked provider-blocked.

Verification:

- `pnpm workbench:live-project-e2e`
- `pnpm workbench:live-copilot-e2e`
- `pnpm check`

The `HARN*` and `OCT*` queues below remain as historical context. Their useful
intent has been folded into the completed `REUSE*` queue above; any older
pending marker below should not be scheduled without first reconciling it
against `PLANS.md`, `docs/HARNESS_ARCHITECTURE.md`, and the OpenCode-compatible
tool contract.

### HARN01 - Write Harness Architecture ADR

Status: completed

Scope:

- Create `docs/HARNESS_ARCHITECTURE.md`.
- Map OpenCode semantics to Microsoft Agent Framework constructs:
  - tools and permissions;
  - session continuity;
  - approval pause/resume;
  - tool observations;
  - compaction;
  - final eligibility;
  - AG-UI projection.
- Record why Relay is not adopting Codex app-server or OpenCode runtime
  binaries in this milestone.
- Record the hard boundary: Relay owns adapters and local tool bodies, not a
  second agent harness.

Artifacts:

- `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The ADR names the canonical owner for each concern: Copilot adapter, Agent
  Framework, OpenCode-compatible tool contract, AG-UI, or Relay packaging.
- No concern is assigned to a vague "Relay harness" bucket.
- The ADR cites the official/prior-art URLs listed in `PLANS.md`.

Verification:

- `rg -n "OpenCode|Agent Framework|AgentSession|AG-UI|approval|middleware" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

Completion artifact:

- `docs/HARNESS_ARCHITECTURE.md`
- `docs/IMPLEMENTATION.md` entry "OpenCode-Compatible Harness Alignment"

### HARN02 - Build Tool Contract Parity Matrix

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a parity matrix.
- For each canonical tool, document:
  - OpenCode-compatible name;
  - Agent Framework registration type;
  - permission class;
  - result shape;
  - approval behavior;
  - AG-UI event projection;
  - known Relay-specific implementation gap.
- Include `officecli` as an extension tool, not a separate planning mode.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Tool registry snapshot fixture or documented command.

Acceptance:

- `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, bounded `bash`,
  `question`, and `officecli` have explicit mappings.
- `rg_files`, `rg_search`, and `patch` alias behavior is documented as
  compatibility only.
- The matrix is specific enough to drive implementation without inventing new
  model-visible Relay tool names.

Verification:

- `rg -n "read|glob|grep|edit|write|apply_patch|bash|question|officecli" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

Completion artifact:

- `docs/OPENCODE_TOOL_CONTRACT.md`
- `scripts/fixtures/agent-tool-catalog-snapshot.json`
- `pnpm agent:tool-catalog-smoke`

### HARN03 - Make AgentSession the State Authority

Status: pending

Scope:

- Audit sidecar state that is keyed by run ID, request ID, or Relay-specific
  protocol state.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Ensure approval responses and follow-up user turns resume the same session.
- Keep run IDs only for UI correlation and diagnostics.

Artifacts:

- Sidecar state refactor.
- Session continuity regression test.
- Implementation note describing removed or demoted Relay state.

Acceptance:

- Approval resume does not create a fresh task from the original prompt.
- The same session contains user message, assistant tool call, approval request,
  approval response, tool observation, continuation, and final answer.
- No tool loop depends on frontend-only state.

Verification:

- Add/update a session continuity smoke test.
- `pnpm check`

### HARN04 - Replace Custom Approval Handling with Agent Framework HITL

Status: pending

Scope:

- Register side-effect tools through Agent Framework approval-required function
  wrappers or equivalent approval metadata.
- Convert approval requests/responses through the Agent Framework + AG-UI HITL
  bridge.
- Batch approvals for coherent multi-file `apply_patch` operations.
- Remove custom approval replay messages that bypass Agent Framework approval
  content.

Artifacts:

- Approval middleware/update.
- AG-UI approval fixture.
- Approval audit log fixture.

Acceptance:

- `write`, `edit`, `apply_patch`, bounded `bash` with side effects, and
  `officecli` mutations pause before execution when policy is `ask`.
- Approving resumes the exact pending function call.
- Denying records a structured denied observation and does not fallback to an
  alternate mutation path.

Verification:

- Add/update approval smoke.
- `pnpm check`

### HARN05 - Add Terminal Eligibility Middleware

Status: completed

Scope:

- Implement middleware that decides whether a model final answer is allowed.
- Track pending required artifacts, pending tool calls, pending approvals,
  failed verifications, and unresolved blocked states.
- Hide or deny `question`/ask-user unless middleware marks the run as
  user-blocked.
- Stop before Copilot if a local-action task has an empty or invalid tool
  registry.

Artifacts:

- Terminal eligibility middleware.
- Protocol-state tests covering:
  - no local tools available;
  - premature final;
  - unnecessary ask-user;
  - genuine user-blocked state.

Acceptance:

- "local tools unavailable" never comes from Copilot prose. It is a pre-model
  `blocked` state with diagnostics.
- A final answer is rejected while required local artifacts are missing.
- `question` appears only after a deterministic user-blocked decision.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm check`

Completion artifact:

- `RelayAdmissibleActionEnvelope` and protocol guard updates in
  `apps/sidecar/`
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### HARN06 - Normalize Tool Observations and Transcript Storage

Status: partial

Scope:

- Define one structured observation envelope for all tool results.
- Include tool name, call ID, status, concise summary, artifact IDs, warnings,
  stdout/stderr summaries, diff summaries, hashes, and retryability.
- Add deterministic transcript export for live E2E debugging.
- Add compaction rules that preserve objective, workspace, completed tool
  calls, artifacts, failures, approvals, and next action.

Artifacts:

- Transcript/observation schema in code or docs.
- Transcript export fixture.
- Compaction fixture.

Acceptance:

- Large tool outputs are summarized without dropping artifact references.
- Copilot receives enough structured observation data to continue after each
  tool call.
- E2E failures can be debugged from exported transcript plus AG-UI replay.

Verification:

- Transcript export smoke.
- `pnpm check`

Progress artifact:

- `RelayToolObservation.v1` metadata and artifact extraction are implemented in
  `apps/sidecar/AgentRunner.cs`.
- Live E2E prompt/raw-event artifacts are written under the ignored
  `dist/e2e/live-project/` diagnostics path.

Remaining:

- Add a deterministic transcript export smoke and compaction fixture.

### HARN07 - Rework Multi-File Project Creation Around `apply_patch`

Status: blocked by provider quota

Scope:

- Make `apply_patch` the preferred coherent mutation tool for multi-file
  project creation and improvements.
- Keep `write` for single-file creation/overwrite.
- Ensure one multi-file patch can be reviewed and approved as one change set.
- Prevent repeated one-file approval loops when Copilot can produce a patch.

Artifacts:

- Prompt/tool projection update derived from the tool registry.
- Multi-file patch E2E fixture.
- Diff/approval UI fixture.

Acceptance:

- A request to create a small project produces either one coherent
  `apply_patch` call or a clearly justified small sequence.
- The first write/patch is not duplicated after approval.
- Follow-up improvement reads existing project state before patching.

Verification:

- Live or recorded project-create E2E.
- `pnpm check`

Progress artifact:

- `apply_patch` is canonical in prompt/tool projection and tool-catalog smoke.
- The patch parser now accepts multi-hunk OpenCode-style updates.
- `scripts/workbench-live-project-e2e.mjs` covers multi-file project creation
  plus follow-up improvement.

Blocker:

- Real Copilot project E2E currently stops at Microsoft 365 Copilot's hourly
  request limit (`copilot_quota_limited`) before tool execution can complete.

### HARN08 - Project Agent Framework Runs Through AG-UI Only

Status: pending

Scope:

- Ensure frontend run state is derived from AG-UI events and state snapshots.
- Map Agent Framework run lifecycle, tool calls, tool results, approvals,
  errors, and final output to AG-UI events.
- Remove or quarantine custom Relay run/event streams from Workbench UI.
- Add replay fixtures for normal, approval, blocked, and failed runs.

Artifacts:

- AG-UI projection code/update.
- Replay fixtures.
- Minimal Workbench UI rendering path.

Acceptance:

- Workbench can replay a saved run from AG-UI events.
- Diagnostic details remain available but are not the primary UI protocol.
- No UI path depends on legacy Relay custom run-stream contracts.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### HARN09 - Live Copilot Harness E2E Suite

Status: blocked by provider quota

Scope:

- Add or update live E2E tests that use actual M365 Copilot through Edge CDP.
- Cover:
  - multi-file HTML/CSS/JS project creation;
  - follow-up project improvement in the same session;
  - local file discovery with `glob`, `grep`, and exact `read`;
  - Office file inspect/edit/verify through `officecli`;
  - side-effect approval resume.
- Assert absence of:
  - empty tool catalog;
  - "local tools unavailable" as Copilot prose;
  - unnecessary `ask_user`;
  - premature final;
  - duplicated first mutation after approval.

Artifacts:

- Live E2E scripts.
- Saved transcripts and AG-UI event logs under an ignored diagnostics location.
- Implementation note with command, date, environment, and result.

Acceptance:

- The suite passes against a logged-in Edge/Copilot profile, or fails with a
  structured harness/provider defect and reproducible artifacts.
- No failure is hidden by a fallback harness path.

Verification:

- Live E2E command documented in `docs/IMPLEMENTATION.md`.
- `pnpm check`

Progress artifact:

- `scripts/workbench-live-project-e2e.mjs` exists and records prompts, raw AG-UI
  events, screenshots, sidecar stderr, and workspace path.
- The latest run reached real Copilot and failed with a structured
  `copilot_quota_limited` provider error, documented in
  `docs/IMPLEMENTATION.md`.

Remaining:

- Re-run the live suite after the Microsoft 365 Copilot request quota resets.

### HARN10 - Remove Superseded Relay Harness Paths

Status: pending

Scope:

- Delete or quarantine Relay-specific harness code that duplicates Agent
  Framework responsibilities.
- Keep only:
  - Copilot CDP adapter;
  - local tool function bodies;
  - policy configuration;
  - diagnostics/export;
  - AG-UI projection glue;
  - packaging.
- Update docs to remove historical claims that conflict with the active design.

Artifacts:

- Code cleanup.
- Updated `README.md`, `AGENTS.md` if needed, `docs/IMPLEMENTATION.md`.

Acceptance:

- No active path treats Relay-specific protocol state as the canonical run
  state.
- The tool registry and Agent Framework middleware are the only active
  execution control surface.
- Historical docs are either updated or clearly archived.

Verification:

- `rg -n "RelayTurnState|RunEvent|rg_files|rg_search|custom run stream|local tools unavailable" apps docs`
- `pnpm check`

### HARN11 - Release Readiness Gate for Harness Migration

Status: pending

Scope:

- Run all verification gates required by the harness migration.
- Confirm installer packaging includes required local tool binaries and excludes
  obsolete runtime assets.
- Confirm Windows no-admin install behavior remains intact.
- Confirm Linux/Windows shared Workbench path remains documented.

Artifacts:

- `docs/IMPLEMENTATION.md` release-readiness entry.
- Packaging verification log.

Acceptance:

- `pnpm check` passes.
- Live E2E artifacts exist for the current commit.
- Installer/tool-binary readiness is verified before any release.

Verification:

- `pnpm check`
- Packaging command documented in `docs/IMPLEMENTATION.md`

## Historical Tool-Contract Queue

### OCT01 - Inventory Current Model-Visible Tools

Status: completed

Scope:

- Inspect all model-visible tool registrations and prompt projections in
  `apps/sidecar`.
- List canonical tool names, aliases, parameters, result shapes, approval
  requirements, and current descriptions.
- Identify Relay-specific names that should become aliases or disappear from
  prompts.

Artifacts:

- Add `docs/OPENCODE_TOOL_CONTRACT.md` with an inventory section.
- Add an implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The inventory clearly separates canonical OpenCode-compatible tools,
  compatibility aliases, and Relay/Office extension tools.
- `rg_files`, `rg_search`, and `apply_patch` are explicitly classified.

Verification:

- `rg -n "rg_files|rg_search|apply_patch|workspace_status|officecli" apps/sidecar`
- `git diff --check`

### OCT02 - Define the OpenCode-Compatible Tool Contract

Status: completed

Scope:

- Complete `docs/OPENCODE_TOOL_CONTRACT.md`.
- Define canonical tools:
  - `read`
  - `glob`
  - `grep`
  - `edit`
  - `write`
  - `patch`
  - bounded `bash`
- For each tool, define:
  - when to use it;
  - when not to use it;
  - parameters;
  - result shape;
  - permission/approval class;
  - failure semantics;
  - aliases accepted during migration.

Artifacts:

- `docs/OPENCODE_TOOL_CONTRACT.md`.
- Updated references from `PLANS.md` and `docs/IMPLEMENTATION.md`.

Acceptance:

- The contract can be implemented without inventing new model-visible Relay
  action names for ordinary file/code work.
- OfficeCLI is documented as an extension tool, not a parallel planner.

Verification:

- Documentation review.
- `git diff --check`

### OCT03 - Centralize Tool Registration Around the Contract

Status: completed

Scope:

- Create or refactor a single tool registry/source of truth in the sidecar.
- Register canonical contract tools from that registry into Agent Framework.
- Keep compatibility aliases internal:
  - `rg_files` -> `glob`;
  - `rg_search` -> `grep`;
  - `patch` -> `apply_patch`.
- Ensure aliases are accepted by the executor only where required for backward
  compatibility and are not preferred in new prompts.

Artifacts:

- Sidecar registry code.
- Tool inventory snapshot or smoke output.
- Implementation note.

Acceptance:

- Prompt/tool projection no longer builds an independent static Relay catalog.
- A model-visible inventory dump shows canonical OpenCode-compatible tools.

Verification:

- Add/update a tool-inventory smoke.
- `pnpm check`

### OCT04 - Project Only Contract Tools to Copilot

Status: completed

Scope:

- Refactor Copilot prompt/tool projection to derive visible tools from the
  Agent Framework registry and current middleware state.
- Use canonical names in prompts.
- Hide aliases unless a legacy continuation requires them.
- Remove or quarantine prompt lines that implement broad Relay-specific
  recovery rules instead of contract semantics.

Artifacts:

- Updated Copilot adapter/prompt projection.
- Prompt dump fixtures showing canonical tool names.

Acceptance:

- New prompts prefer `apply_patch`, not `patch`, when patching is visible.
- No prompt exposes `rg_files` or `rg_search`.
- No prompt introduces new Relay-only local file/code tools.

Verification:

- Prompt-dump fixture.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### OCT05 - Align Executor Behavior and Results

Status: completed

Scope:

- Ensure executor implementations match the contract result shapes.
- Implement `apply_patch` as the canonical mutation tool.
- Keep `patch` as an alias only if existing tests or continuations need it.
- Ensure `bash` remains bounded to explicit verification/build/test/git/rg
  command use and cannot become arbitrary shell execution.

Artifacts:

- Executor changes.
- Contract-result smoke tests.

Acceptance:

- Tool results are consistent enough that Copilot can recover from normal tool
  errors without custom Relay planner state.
- Patch context failure returns a clear standard tool failure result.

Verification:

- Tool executor smoke tests.
- `pnpm check`

### OCT06 - Reframe OfficeCLI as a Contract Extension

Status: completed

Scope:

- Keep OfficeCLI available, but expose it as a documented extension tool
  aligned with the same inspect-before-mutate and approval semantics.
- Remove Office-specific planner assumptions that duplicate the general
  Agent Framework tool loop.
- Ensure Office mutation uses Agent Framework approval and AG-UI HITL.

Artifacts:

- Updated Office tool docs in `docs/OPENCODE_TOOL_CONTRACT.md`.
- OfficeCLI readiness and mutation smoke results.

Acceptance:

- Natural-language Office work follows the same run loop as code/file work:
  inspect/read -> approved mutation -> result/verification.
- No separate Office-only prompt harness is required for normal operation.

Verification:

- `pnpm agent:officecli-registry-smoke`
- Office approval smoke.
- `pnpm check`

### OCT07 - Remove or Quarantine Relay-Specific Recovery Rules

Status: completed

Scope:

- Audit Copilot adapter, protocol guard, and prompt builder for ad hoc rules
  added to handle repeated reads, early finals, patch failures, or local-tools
  unavailable outputs.
- Keep only narrow compatibility normalizers that are backed by tests and do
  not define a second tool system.
- Move prevention into Agent Framework middleware/session state where possible.

Artifacts:

- Cleanup diff.
- Implementation note explaining what was removed, retained, and why.

Acceptance:

- Normal E2E does not depend on hidden guard repair or broad prompt folklore.
- Contract violations fail visibly with diagnostics instead of silently
  creating new fallback behavior.

Verification:

- Choice-error reduction smoke.
- Protocol-state smoke.
- `pnpm check`

### OCT08 - Update Regression Tests to the Contract

Status: completed

Scope:

- Update existing smokes and fixtures to use canonical tool names and contract
  result shapes.
- Add alias tests proving legacy names still map internally but are not shown
  in new prompts.
- Add a no-new-Relay-tool-name assertion for the model-visible catalog.

Artifacts:

- Updated smoke scripts.
- Tool inventory snapshot.

Acceptance:

- Tests enforce OpenCode-compatible naming and semantics.
- Tests fail if a new model-visible Relay-specific tool is added without
  updating the contract.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### OCT09 - Live Copilot E2E: Complex Project Create and Improve

Status: completed

Scope:

- Re-run a real signed-in Copilot E2E where Relay creates a hierarchical
  project and then improves it.
- The test must exercise:
  - project creation with multiple files/directories;
  - reading existing files;
  - improving the project through canonical contract tools;
  - browser/runtime verification of the generated app.
- If the run fails, classify it as:
  - Copilot transport issue;
  - Agent Framework/tool contract issue;
  - executor implementation issue;
  - generated app quality issue.
- Do not add new ad hoc Relay planner features to make one scenario pass.

Artifacts:

- E2E logs under `dist/e2e/...`.
- Browser screenshot or validation output.
- Implementation note.

Acceptance:

- The run succeeds through the OpenCode-compatible contract, or fails with a
  clear contract/tool-result error and a follow-up task.

Verification:

- Live Copilot E2E script.
- Generated app smoke/browser check.
- `pnpm check`

### OCT10 - Documentation and Cleanup

Status: completed

Scope:

- Update `README.md`, `AGENTS.md` if needed, `PLANS.md`, and
  `docs/IMPLEMENTATION.md` to describe the new contract.
- Remove or archive obsolete references that imply Relay owns a custom local
  tool taxonomy.
- Ensure release/packaging notes do not mention removed modes or old tool names
  as public behavior.

Artifacts:

- Documentation updates.
- Final verification log.

Acceptance:

- A new contributor can understand that Relay is:
  - M365 Copilot controller;
  - Agent Framework run loop;
  - AG-UI frontend protocol;
  - OpenCode-compatible local tool contract;
  - Relay implementation glue, policy, packaging, and diagnostics.

Verification:

- `pnpm check`
- `git diff --check`

## Milestone Definition of Done

The OpenCode-compatible tool contract migration is complete when:

- `docs/OPENCODE_TOOL_CONTRACT.md` exists and matches implementation.
- The model-visible inventory uses canonical OpenCode-compatible local tool
  names plus documented extension tools only.
- Existing Relay-specific tool names are internal aliases or removed.
- Agent Framework remains the run loop and AG-UI remains the UI protocol.
- Live Copilot can create and improve a non-trivial project without requiring
  new Relay-specific planner rules.
