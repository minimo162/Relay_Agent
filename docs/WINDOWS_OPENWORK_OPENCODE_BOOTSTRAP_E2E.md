# Windows OpenWork/OpenCode Bootstrap E2E

Date: 2026-04-27

This is the live B06 verification runbook. It requires a clean Windows 10/11
x64 environment, network access to GitHub Releases, Microsoft Edge with M365
Copilot signed in, and an operator who explicitly approves opening the
OpenWork installer.

Relay must remain a provider gateway only. Do not use this run to reintroduce
Relay-owned OpenCode runtime sidecars, tool execution, transcript state, or
chat UX.

## Preflight

From the Relay_Agent checkout:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm smoke:openwork-desktop-handoff
pnpm smoke:opencode-bootstrap-config
pnpm live:windows:openwork-bootstrap
```

The last command is non-destructive by default. It prints the pinned artifact
URLs, SHA256 values, expected app-local cache paths, and provider handoff
settings.

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

Start the Relay provider gateway:

```powershell
pnpm start:opencode-provider-gateway
```

Keep the printed `RELAY_AGENT_API_KEY` export available for OpenCode/OpenWork.
The expected model is:

```text
relay-agent/m365-copilot
```

The expected provider base URL is:

```text
http://127.0.0.1:18180/v1
```

## OpenCode Config

Extract the verified OpenCode CLI zip and install Relay provider config into
the test workspace:

```powershell
pnpm install:opencode-provider-config -- --workspace C:\RelayBootstrapSmoke\workspace --opencode-bin <path-to-extracted-opencode.exe>
```

Do not run Relay-owned tool execution. Tool execution must happen in
OpenCode/OpenWork.

## OpenWork Installer

Open the verified MSI only after explicit operator approval. Do not silently
install:

```powershell
msiexec /i <path-to-openwork-desktop-windows-x64.msi>
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
complete only if both the provider text and OpenCode-owned `read` turn pass.
