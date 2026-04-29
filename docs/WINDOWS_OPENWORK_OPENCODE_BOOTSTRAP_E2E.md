# Windows OpenWork/OpenCode Bootstrap E2E

Date: 2026-04-29

This is the live B12 post-UX-removal verification runbook. It requires a clean
Windows 10/11 x64 environment, network access to GitHub Releases, Microsoft
Edge with M365 Copilot signed in, and an operator who explicitly approves
opening the OpenWork installer.

Relay must remain the OpenWork/OpenCode setup layer and provider gateway only.
Do not use this run to reintroduce Relay-owned OpenCode runtime sidecars, tool
execution, transcript state, or chat UX.

## Preflight

From the Relay_Agent checkout:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm dev
pnpm smoke:openwork-desktop-handoff
pnpm smoke:opencode-bootstrap-config
pnpm live:windows:openwork-bootstrap
```

`pnpm dev` must run the auto bootstrap path, not the Relay desktop frontend.
`pnpm live:windows:openwork-bootstrap` is non-destructive by default: it checks
the post-UX-removal production entrypoint, runs the Rust bootstrap preflight,
and prints the pinned artifact URLs, SHA256 values, expected app-local cache
paths, and provider handoff settings.

On non-Windows CI or local Linux/macOS verification, use this readiness-only
variant to require the same entrypoint/bootstrap checks without pretending the
live Windows acceptance turn has run:

```powershell
$env:RELAY_LIVE_WINDOWS_BOOTSTRAP_REQUIRE_WINDOWS = "0"
pnpm live:windows:openwork-bootstrap
```

Expected status is `ready_for_explicit_download`.

## Download And Verify

Only on Windows, with the operator ready to continue:

```powershell
$env:RELAY_LIVE_WINDOWS_BOOTSTRAP_DOWNLOAD = "1"
pnpm live:windows:openwork-bootstrap
```

Expected pinned artifacts:

- OpenWork Desktop `0.11.212`
  - `openwork-desktop-windows-x64.msi`
  - SHA256 `e52d020a1f6c2073164ed06279c441869844cb07a396bffac0789d63a4b7f486`
- OpenCode CLI `1.14.25`
  - `opencode-windows-x64.zip`
  - SHA256 `8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b`

## Provider Handoff

Run the bootstrap-managed provider handoff from a workspace:

```powershell
Set-Location C:\RelayBootstrapSmoke\workspace
pnpm --dir C:\path\to\Relay_Agent dev
```

Auto bootstrap writes the local provider token into the workspace config, so no
manual `RELAY_AGENT_API_KEY` export should be required for the normal path.
The expected model is:

```text
relay-agent/m365-copilot
```

The expected provider base URL is:

```text
http://127.0.0.1:18180/v1
```

## OpenCode Config

The bootstrap command extracts the verified OpenCode CLI zip, probes the
entrypoint, and installs Relay provider config into the test workspace. For a
non-destructive check before downloading or starting the provider, run:

```powershell
pnpm --dir C:\path\to\Relay_Agent bootstrap:openwork-opencode -- --workspace C:\RelayBootstrapSmoke\workspace --pretty
```

Do not run Relay-owned tool execution. Tool execution must happen in
OpenCode/OpenWork.

## OpenWork Installer

Open the verified MSI only after explicit operator approval. Do not silently
install:

```powershell
Set-Location C:\RelayBootstrapSmoke\workspace
pnpm --dir C:\path\to\Relay_Agent dev
```

Record the installer path, OpenWork version, and any prompts shown to the
operator.

## Live Acceptance

With Edge signed in to M365 Copilot and OpenWork/OpenCode configured for the
Relay provider:

1. Run a plain provider text turn and require `OPEN_CODE_M365_PROVIDER_OK`.
2. Run an OpenCode-owned `read` tool turn against a small fixture file and
   require `OPEN_CODE_M365_TOOL_OK`.
3. Record:
   - Relay commit.
   - Artifact cache paths.
   - Artifact SHA256 values.
   - OpenCode/OpenWork versions.
   - Provider URL and model.
   - Logs or artifact directory.
   - Any manual operator approval steps.

After the run, append the result to `docs/IMPLEMENTATION.md` and mark B06
or B12 complete only if both the provider text and OpenCode-owned `read` turn
pass.
