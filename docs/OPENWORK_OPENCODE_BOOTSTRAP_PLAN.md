# OpenWork / OpenCode First-Run Bootstrap Plan

Date: 2026-04-26

## Decision

Relay_Agent can support a first-run download flow for OpenWork/OpenCode without
returning to Relay-owned UX or tool execution.

The preferred Windows x64 MVP is a managed external install:

1. Relay downloads and verifies the OpenWork Desktop installer.
2. Relay downloads and verifies the OpenCode CLI archive for provider-config
   installation, diagnostics, and direct fallback.
3. Relay starts or opens OpenWork as the UX owner and keeps only the M365
   Copilot OpenAI-compatible provider gateway plus connection diagnostics.

Relay must not reintroduce bundled OpenCode runtime execution, transcript
ownership, permission handling, MCP execution, or chat/session UX.

## Upstream Snapshot

Checked on 2026-04-26.

### OpenCode

- Repository: `https://github.com/anomalyco/opencode`
- License: MIT.
- Latest checked release: `v1.14.25`, published 2026-04-25.
- Installation paths documented upstream:
  - `curl -fsSL https://opencode.ai/install | bash`
  - `npm i -g opencode-ai@latest`
  - Windows package managers: Scoop and Chocolatey.
  - Direct desktop release assets.
- Relevant Windows x64 release assets:
  - CLI archive:
    `https://github.com/anomalyco/opencode/releases/download/v1.14.25/opencode-windows-x64.zip`
    - size: `53772841`
    - digest:
      `sha256:8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b`
  - CLI baseline archive:
    `https://github.com/anomalyco/opencode/releases/download/v1.14.25/opencode-windows-x64-baseline.zip`
    - size: `53772841`
    - digest:
      `sha256:f8ccddf01078eb5f98586b23d48894615df4a97ac3d9aab64db49df4a660ce4b`
  - OpenCode desktop installer:
    `https://github.com/anomalyco/opencode/releases/download/v1.14.25/opencode-desktop-windows-x64.exe`
    - size: `47526072`
    - digest:
      `sha256:35682959b769c1880800ab9253dbabc8d7b4dec756865a7598b136c1f47cb6d2`
- NPM package:
  - `opencode-ai@1.14.25`
  - license: MIT
  - bin: `opencode`
  - tarball:
    `https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.14.25.tgz`
  - integrity:
    `sha512-xlcuGQWsaN/BZ1Bo9+Pk7X7zMYz2BMnzkKFzZMn/Q9D7SEvdVx+ycjK5Wf8Wq/7niv0t1nFkAQZ85T3tCRWVxg==`

### OpenWork

- Repository: `https://github.com/different-ai/openwork`
- License surface:
  - Root license states most content is MIT.
  - `/ee` is separately licensed under the license in `ee/LICENSE` (Fair
    Source License).
  - Before an automated production downloader ships, confirm whether the
    released desktop/orchestrator artifacts include `/ee` code or other
    non-MIT distribution constraints.
- Latest checked desktop release: `v0.11.212`, published 2026-04-21.
- README states:
  - OpenWork is powered by OpenCode.
  - Host mode runs OpenCode locally.
  - Client mode can connect to an existing OpenCode server by URL.
  - Windows access is currently described as paid-support-plan handled, even
    though a public Windows MSI exists on GitHub Releases. Treat this as a
    commercial/support signal that needs owner confirmation before silent or
    automatic installation.
- Relevant Windows x64 desktop asset:
  - `https://github.com/different-ai/openwork/releases/download/v0.11.212/openwork-desktop-windows-x64.msi`
  - size: `218517504`
  - digest:
    `sha256:e52d020a1f6c2073164ed06279c441869844cb07a396bffac0789d63a4b7f486`
- OpenWork constants:
  - `constants.json` on `dev` currently pins `opencodeVersion` to `v1.4.9`.
  - This is older than the checked OpenCode latest `v1.14.25`; Relay should not
    assume the OpenWork-pinned OpenCode version and the latest OpenCode CLI are
    interchangeable without a compatibility smoke.
- NPM package:
  - `openwork-orchestrator@0.11.212`
  - license: MIT
  - bin: `openwork`, `openwork-orchestrator`
  - tarball:
    `https://registry.npmjs.org/openwork-orchestrator/-/openwork-orchestrator-0.11.212.tgz`
  - integrity:
    `sha512-rvLRc/MZorXM/SN5IF4rgjf7/EtHx8XycMTu6Ppz7nKQAte34z+szQLF7pIPvHcN8s4nr/ftMv6220/YqNpx4Q==`
  - The package is a small shim that resolves a platform binary package or
    downloads a fallback binary from
    `https://github.com/different-ai/openwork/releases/download/openwork-orchestrator-v0.11.212/`.
- Relevant orchestrator release assets:
  - `openwork-bun-windows-x64.exe`
    - size: `118631936`
    - digest:
      `sha256:8db2b985e31dc961c74cff44f6249cdd05118553665f896dca38e9380e8fafb0`
  - `openwork-server-windows-x64.exe`
    - size: `113881088`
    - digest:
      `sha256:bda3fcd2805dbc501e1d85b3fa29dff04c48ae87f6122539f52873077d9b4c32`
  - `opencode-router-windows-x64.exe`
    - size: `113914880`
    - digest:
      `sha256:b883d5aec763dd59e876fada7810c1e3109377b5982b73384a7d619f37543f98`

## Feasibility

### Feasible Now

- Downloading fixed GitHub release assets is feasible because GitHub exposes
  stable release URLs and SHA256 digests for the checked OpenCode and OpenWork
  artifacts.
- Downloading fixed NPM tarballs is feasible because NPM exposes immutable
  tarball URLs and integrity strings for `opencode-ai` and
  `openwork-orchestrator`.
- Relay already has provider config installation code for OpenCode workspaces.
  The bootstrap flow can reuse that boundary after installing or discovering
  the OpenCode/OpenWork location.
- Relay can keep the hard-cut ownership boundary by treating all downloaded
  assets as external processes or installers.

### Feasible With Guardrails

- OpenWork Desktop MSI first-run download is feasible, but the UX should be
  explicit: "Download and open installer" or "Install OpenWork" rather than a
  silent background install.
- OpenWork Windows support wording and the `/ee` license split must be reviewed
  before a production auto-installer ships.
- OpenWork's pinned `opencodeVersion` can lag latest OpenCode. The manifest
  should pin a known compatible pair, not independently float latest versions.
- Provider config injection must target OpenCode/OpenWork-supported config
  locations and avoid mutating user config without backup or explicit consent.

### Not Selected For MVP

- Vendoring OpenWork/OpenCode inside the Relay installer.
- Rebuilding OpenWork/OpenCode from source during Relay first run.
- Running OpenWork desktop binaries out of Relay's app resource directory.
- Replacing OpenWork UX with Relay desktop UI.

## Bootstrap Manifest Shape

The first implementation should use a committed manifest with exact versions,
URLs, sizes, digests, entrypoints, and license notes.

```json
{
  "schemaVersion": 1,
  "selectedTrack": "windows-x64-openwork-desktop-plus-opencode-cli",
  "artifacts": {
    "openworkDesktop": {
      "version": "0.11.212",
      "platform": "windows-x64",
      "kind": "installer",
      "url": "https://github.com/different-ai/openwork/releases/download/v0.11.212/openwork-desktop-windows-x64.msi",
      "sha256": "e52d020a1f6c2073164ed06279c441869844cb07a396bffac0789d63a4b7f486",
      "size": 218517504,
      "entrypoint": "msiexec"
    },
    "opencodeCli": {
      "version": "1.14.25",
      "platform": "windows-x64",
      "kind": "zip",
      "url": "https://github.com/anomalyco/opencode/releases/download/v1.14.25/opencode-windows-x64.zip",
      "sha256": "8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b",
      "size": 53772841,
      "entrypoint": "opencode.exe"
    }
  }
}
```

The manifest should later support an `openworkOrchestrator` track for users who
want OpenWork host/server without installing the desktop MSI.

## Implementation Track

### B02: Bootstrap Manifest

- Add a source-controlled manifest for Windows x64 OpenWork Desktop and
  OpenCode CLI.
- Add schema validation tests.
- Add a hard-cut guard that rejects reintroducing `opencode-runtime` bundle
  resources while allowing a bootstrap manifest.

### B03: Downloader And Verifier

- Store downloads under app-local data, not under Tauri resources.
- Use atomic partial downloads.
- Verify size and SHA256 before install/extract.
- Keep one active version and preserve old versions until a new version passes
  verification.
- Emit structured diagnostics for network, checksum, extraction, and install
  failures.

### B04: OpenCode CLI Config Smoke

- Extract the OpenCode CLI archive.
- Run `opencode --version`.
- Install Relay provider config into a temp workspace.
- Confirm OpenCode can read the generated provider config.

### B05: OpenWork Desktop Install/Launch Smoke

- Download and verify the OpenWork MSI.
- Open the installer explicitly or run an approved per-user install mode if
  available.
- Detect installed OpenWork.
- Launch OpenWork with the selected workspace or provide handoff instructions.
- Confirm Relay provider gateway remains a provider-only process.

### B06: Live End-To-End Smoke

- Clean Windows VM.
- Relay installer install.
- First-run OpenWork/OpenCode bootstrap.
- Relay provider gateway start.
- OpenWork/OpenCode configured for Relay's provider.
- M365 Copilot plain text turn.
- OpenCode-owned `read` tool turn.
- Runbook: `docs/WINDOWS_OPENWORK_OPENCODE_BOOTSTRAP_E2E.md`.
- Preflight command: `pnpm live:windows:openwork-bootstrap`.

## Open Questions

- Does the public OpenWork Windows MSI include `/ee` code or any distribution
  constraints beyond the root MIT sections?
- Is automated Windows MSI installation acceptable, or should Relay only
  download and open the installer for the user?
- What OpenCode version should be paired with OpenWork `v0.11.212`: OpenWork's
  pinned `v1.4.9` or the current OpenCode `v1.14.25`?
- Can OpenWork Desktop accept a provider config path or OpenCode server URL
  from command-line flags, or must Relay write global/project `opencode.json`?
- Should Relay support the lighter `openwork-orchestrator` track before or
  after OpenWork Desktop MSI bootstrap?

## Verification Commands Used

```bash
gh api repos/anomalyco/opencode/releases/latest --jq '{tag_name, name, published_at, assets: [.assets[] | {name, size, browser_download_url}]}'
gh api repos/different-ai/openwork/releases/latest --jq '{tag_name, name, published_at, assets: [.assets[] | {name, size, browser_download_url}]}'
npm view opencode-ai version license bin dist.tarball dist.integrity --json
npm view openwork-orchestrator version license bin dist.tarball dist.integrity --json
gh api repos/different-ai/openwork/releases/tags/openwork-orchestrator-v0.11.212 --jq '{tag_name, name, published_at, assets: [.assets[] | {name,size,digest,browser_download_url}]}'
npm pack openwork-orchestrator@0.11.212 --dry-run --json
gh api repos/anomalyco/opencode/contents/LICENSE?ref=dev --jq '.content' | base64 -d
gh api repos/different-ai/openwork/contents/LICENSE?ref=dev --jq '.content' | base64 -d
```
