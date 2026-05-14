# Relay-branded AionUi Windows Validation

Use this checklist after a GitHub Actions build from the primary
`release-windows-installer` workflow in
`.github/workflows/release-aionui-windows-installer.yml`.

The target is Windows 10/11 x64 with no administrator rights available.

## Acceptance Matrix

Use one evidence bundle per release candidate. Do not mark a row complete
unless the expected artifact exists and the result is linked from the bundle
manifest. Windows-only rows must stay pending until captured on a clean Windows
host; Linux or CI-preparable rows can be completed before that host is
available.

| Gate | Task | Evidence to collect | Acceptance condition | Bundle location |
| --- | --- | --- | --- | --- |
| Release workflow artifact | `AION02` | GitHub Actions run URL, installer asset name, release tag, workflow inputs, signing mode, SHA256, Relay Agent version, overlay/upstream pins, `aionui-relay.json`, bundled ripgrep manifest facts | Workflow proves the Relay-branded AionUi installer artifact and manifest metadata before any prerelease is accepted | `release-workflow/` |
| Clean Windows bootstrap handoff | `B12` / `AION04` | `live_windows_openwork_opencode_bootstrap_smoke` JSON, OpenCode/OpenWork versions, SHA256 values, provider endpoint/model, explicit installer/browser handoff notes, M365 text/read-tool transcript evidence | Clean Windows run proves the remaining B12 installer/browser handoff without claiming Linux-only readiness is enough | `b12-bootstrap/` |
| Installed first launch | `AION05` | Installer run notes, first-launch screenshots, app name/title/protocol/icon checks, provider-ready or sign-in-required state, default model evidence | The first visible product surface is Relay-branded AionUi, not OpenCode Web/OpenWork, and no API-key/backend setup is required | `installed-first-run/` |
| Provider seed and M365 recovery | `AION05` | Provider settings screenshot or redacted config export, local provider health output, M365 sign-in/recovery notes, model id `relay-agent/m365-copilot` | Relay provider is selected by default and sign-in recovery needs no terminal steps | `provider/` |
| User-local runtime tools | `AION05` | `officecli --version`, `rg --version`, cache paths, no-admin install notes, confirmation that standalone Node/LiteParse are not bundled | OfficeCLI and ripgrep are available to AionUi child processes from user-local or installed resources; PDF text extraction remains optional and not part of the lean installer | `runtime-tools/` |
| Beginner AionUi surface | `AION05` | `/guid` screenshots, curated assistant list, hidden advanced/provider/platform surfaces, advanced flag state | Beginners see only `資料を探す` and `Officeファイルを編集する` without setup/platform management surfaces | `beginner-surface/` |
| Office workflows | `AION05` | OfficeCLI command/result logs, edited `.docx`/`.xlsx`/`.pptx` filenames, Office/preview readability notes, sanitized logs | Office edits run through OfficeCLI-backed tools and do not rely on M365 built-in editing | `office-workflows/` |
| Workspace Document Search UX | `AION06` | Search prompts, selected root, result-card screenshots, preview/open/copy/refine/show-more evidence, partial/no-result/permission states, local draft/Copilot polish state | Search uses structured result cards and local evidence state; filename-only candidates are not presented as confirmed findings | `workspace-search/` |
| Support export and privacy | `AION06` / `AION07` | Support export archive or manifest, redaction notes, Query Trace/support summaries, list of excluded private artifacts | Export contains diagnostics and metadata only; source documents, extracted contents, tokens, cookies, and tenant-private data are excluded or redacted | `support-export/` |
| Release readiness decision | `AION07` | Final readiness note, known limitations, unresolved Windows-only gaps, unsigned/signed status, links to every accepted row | Release decision cites all required evidence and explicitly names any residual limitation | `readiness-decision/` |

## Evidence Bundle Checklist

Create a sanitized bundle index for every release candidate:

```text
docs/evidence/aionui-windows/<release-tag-or-run-id>/MANIFEST.md
```

The manifest is the source-controlled index. Large screenshots, raw workflow
artifacts, private logs, generated Office files, and local transcripts may live
outside the repo or in a CI artifact archive, but the manifest must record
their location, hash when practical, owner task, capture date, and redaction
status.

Minimum manifest fields:

- Release tag or workflow run id.
- Installer asset name and SHA256.
- Windows version and architecture.
- Validation operator and capture date.
- Microsoft 365 sign-in state.
- Bundle row status for each Acceptance Matrix gate.
- Artifact location for each completed row.
- Redaction note for every screenshot, log, support export, and transcript.
- Explicit list of private artifacts that are intentionally not committed.

Do not commit:

- Original customer or test documents when their contents are not already
  public fixtures.
- Extracted document text, snippets, Evidence Pack bodies, or Copilot prompt
  payloads that contain source document content.
- Microsoft 365 cookies, tokens, tenant identifiers, local API keys, or Edge
  profile data.
- Unredacted screenshots showing account names, tenant names, private paths, or
  document contents.

## Release Asset

- [ ] Download the `Relay.Agent-*-win-x64*.exe` asset from the GitHub Release.
- [ ] Record the SHA256 from the workflow summary and confirm it locally:

```powershell
Get-FileHash ".\Relay.Agent-*-win-x64*.exe" -Algorithm SHA256
```

- [ ] Download `Relay.Agent-AionUi-release-manifest.json` from the same
      GitHub Release.
- [ ] Confirm the release manifest records schema
      `RelayAionUiReleaseArtifactManifest.v1`, overlay version
      `relay-aionui-overlay-v1`, the installer asset name/SHA256, signing
      mode, Relay Agent version, AionUi tag/commit, OfficeCLI version, and
      the bundled ripgrep payload:

```powershell
$manifest = Get-Content ".\Relay.Agent-AionUi-release-manifest.json" -Raw | ConvertFrom-Json
$manifest.schema
$manifest.installer.assetName
$manifest.installer.sha256
$manifest.signing.mode
$manifest.release.relayAgentVersion
$manifest.upstreams.aionUi.tag
$manifest.upstreams.aionUi.commit
$manifest.upstreams.officeCli.version
$manifest.overlay.version
$manifest.bundledPayloads | Format-Table id, installedPath, present
```

- [ ] Check the Authenticode signature:

```powershell
Get-AuthenticodeSignature ".\Relay.Agent-*-win-x64*.exe" | Format-List
```

- [ ] If Windows Security reports a detection, keep the file quarantined and
      record the exact detection name from Protection history. Do not bypass
      Defender for this validation.

## Install And First Launch

- [ ] Run the installer as a standard user.
- [ ] Confirm no administrator approval is required.
- [ ] Confirm the installed app name, window title, taskbar name, protocol, and
      icon are `Relay Agent`.
- [ ] Confirm no console window flickers during launch.
- [ ] Confirm the first visible product surface is the Relay-branded AionUi
      desktop shell, not OpenCode Web and not OpenWork.

## Provider Readiness

- [ ] Confirm Relay starts the local M365 Copilot provider gateway before AionUi
      becomes usable.
- [ ] In AionUi model/provider settings, confirm `Relay Agent / M365 Copilot`
      exists and is selected by default.
- [ ] Confirm the model reference is `relay-agent/m365-copilot`.
- [ ] Confirm the app does not ask the user to paste an API key, choose a
      backend, or manually add a provider during first launch.
- [ ] If Microsoft 365 sign-in is required, sign in through Edge and confirm the
      app recovers without command-line steps.

## OfficeCLI Bootstrap

- [ ] Confirm the bundled OfficeCLI payload exists under the installed app's
      `resources\relay-tools\officecli\officecli.exe`.
- [ ] Confirm Relay uses the bundled OfficeCLI path before attempting any
      user-local fallback cache or network bootstrap.
- [ ] Confirm no OfficeCLI installer or script asks for administrator approval.
- [ ] Confirm OfficeCLI is on the AionUi child-process `PATH`.
- [ ] Confirm `officecli --version` works from an AionUi tool or diagnostic
      shell spawned by the app.

## Search Bootstrap

- [ ] Confirm bundled `rg.exe` is present under the installed app's
      `resources\relay-tools\ripgrep` directory.
- [ ] Confirm Relay copies `rg.exe` into the AionUi global bin cache without
      administrator approval.
- [ ] Confirm `rg --version` works from an AionUi tool or diagnostic shell
      spawned by the app.
- [ ] Confirm workspace file search completes through ripgrep, not slow grep
      fallback.
- [ ] Confirm broad shared-folder glob searches report representative capped
      results instead of dumping every matching file.
- [ ] Confirm the status or logs include the shared search defaults:
      internal file limit, returned file limit, per-folder limit, per-branch
      limit, branch depth, names-only match limit, and names-only per-file
      match limit.

## Beginner Surface Guardrails

- [ ] Confirm channel bot setup is not shown in the default settings flow.
- [ ] Confirm LAN/remote WebUI access setup is not shown in the default settings
      flow.
- [ ] Confirm unrelated provider onboarding is hidden unless
      `relay.advancedSurfaces.enabled` is deliberately enabled for diagnostics.
- [ ] Confirm beginner settings do not show provider/model setup, Gemini setup,
      agent management, tools/system/dev settings, WebUI/channel setup, or
      extension settings. The default visible settings tab should be support or
      About only.
- [ ] Confirm `/guid` does not show the AionUi Skills Market banner, model
      switcher, ACP config selector, permission-mode selector, or assistant
      preset add button by default.
- [ ] Confirm the `/guid` plus menu does not expose the auto-injected skills
      submenu in beginner mode.
- [ ] Confirm OpenCode Web is not the first-run product screen.
- [ ] Confirm the first beginner task screen is the Relay-branded AionUi
      `/guid` surface, with only `資料を探す` and
      `Officeファイルを編集する` as beginner task choices.
- [ ] Confirm `資料を探す` is one real preset assistant entry that can be
      selected from `/guid`, not separate metadata-only search and summary
      labels.
- [ ] Confirm the `/guid` screen shows folder selection, prompt examples, file
      attachment, and a normal send/start action without forcing a tutorial or
      opening advanced assistant management.
- [ ] Confirm the `/guid` input behaves as the primary search/task CTA and
      shows task-aware examples or recent/popular suggestions before advanced
      assistant controls.
- [ ] Confirm Workspace Document Search is exposed through beginner-facing
      skill/command labels such as `検索`, `ファイル検索`, and `根拠つき回答`,
      while internal terms such as AionUi, Dedoc, ParsedDocument, TreeNode,
      Annotation, Evidence Pack, Query Trace, parser lineage, reader
      capabilities, structure profile, and pattern set are hidden unless an
      advanced/support view is opened.
- [ ] Confirm `資料を探す` loads the `relay-document-search` skill and, when a
      high-level document-search tool is advertised, Copilot routes the first
      call there instead of starting with raw `glob`, `grep`, or `read`.
- [ ] Confirm the default assistant/skill picker is curated: only
      `資料を探す` and `Officeファイルを編集する` are visible, while
      the legacy Word/Excel/PowerPoint creator presets and
      unrelated upstream AionUi presets such as Cowork, OpenClaw setup,
      roleplay, Moltbook, Mermaid, academic paper, dashboard, and
      financial-model helpers are hidden or advanced-only.
- [ ] Confirm file-search entrypoints reuse AionUi's core UX: the conversation
      `+` assistant menu, SendBox `/` command menu, SendBox `@` file mentions,
      right Workspace quick tree/filename filter and refresh/status area, chat
      result cards, PreviewPanel, and loaded-skills indicator. There should be
      no separate Relay search page in the beginner path.
- [ ] Confirm `/guid` beginner mode does not show AionUi detected-agent pill
      bars, preset assistant edit/details buttons, preset backend switchers, or
      assistant-management drawers unless support advanced surfaces are
      explicitly enabled.
- [ ] Confirm file search shows clear beginner states for folder-not-selected,
      preparing, candidates-visible, checking-file-contents, confirmed-results,
      no-results, partial-results, permission-denied, and failed states.
- [ ] Confirm the default broad search does not stop at filename candidates:
      candidates are shown as progress while Relay continues into file-content
      or evidence confirmation unless the user explicitly selects quick
      filename search.
- [ ] Confirm query construction is Relay-owned: Copilot may suggest related
      terms, abbreviations, file-type hints, or clarification questions, but
      cannot change searched roots, budgets, confirmation policy, or coverage
      reporting without Relay validation.
- [ ] Confirm a no-results search suggests next actions such as changing the
      folder, broadening keywords, trying related terms, removing extension
      filters, or waiting for content indexing.
- [ ] Confirm each search result appears as an actionable card with title/path,
      modified time or freshness, match reason, index/warning state, preview,
      open file, copy path, use-as-evidence, and refine-search actions.
- [ ] Confirm filename-only or partial-index results are worded as candidates,
      while confirmed statements are only shown for content-backed or
      evidence-backed results.

## Office Workflows

Create a test workspace, for example `C:\relay-aionui-test`, and run these from
Relay Agent:

- [ ] Use `Officeファイルを編集する` to inspect or edit a `.docx` file in the
      workspace through OfficeCLI.
- [ ] Use `Officeファイルを編集する` to inspect sheets and edit a `.xlsx` file in
      the workspace through OfficeCLI.
- [ ] Use `Officeファイルを編集する` to inspect or edit a `.pptx` file in the
      workspace through OfficeCLI.
- [ ] Open each changed output in Microsoft Office or the configured preview
      path and confirm the file is readable.
- [ ] Ask Relay Agent to search the workspace for the created Office files and
      confirm the returned paths are correct.
- [ ] Ask Relay Agent to search a large nested folder for a broad term and
      confirm results are not dominated by a single subfolder or one deep
      branch such as a filing/output tree.

## Result Record

Record:

- Relay Agent release tag
- Installer asset name
- Installer SHA256
- Signing mode and Authenticode status
- Release manifest schema
- Release manifest overlay version
- Windows version
- Microsoft 365 sign-in status
- OfficeCLI version
- Defender or SmartScreen message, if any
- Office workflow pass/fail notes
- Evidence bundle manifest path
- AionUi acceptance row statuses
- Known limitations or blocked Windows-only gates
