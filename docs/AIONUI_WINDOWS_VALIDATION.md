# Relay-branded AionUi Windows Validation

Use this checklist after a GitHub Actions build from the primary
`release-windows-installer` workflow in
`.github/workflows/release-aionui-windows-installer.yml`.

The target is Windows 10/11 x64 with no administrator rights available.

## Release Asset

- [ ] Download the `Relay Agent-*-win-x64.exe` asset from the GitHub Release.
- [ ] Record the SHA256 from the workflow summary and confirm it locally:

```powershell
Get-FileHash ".\Relay Agent-*-win-x64.exe" -Algorithm SHA256
```

- [ ] Check the Authenticode signature:

```powershell
Get-AuthenticodeSignature ".\Relay Agent-*-win-x64.exe" | Format-List
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

- [ ] Confirm OfficeCLI downloads into a user-local Relay-managed cache.
- [ ] Confirm no OfficeCLI installer or script asks for administrator approval.
- [ ] Confirm OfficeCLI is on the AionUi child-process `PATH`.
- [ ] Confirm `officecli --version` works from an AionUi tool or diagnostic
      shell spawned by the app.

## Beginner Surface Guardrails

- [ ] Confirm channel bot setup is not shown in the default settings flow.
- [ ] Confirm LAN/remote WebUI access setup is not shown in the default settings
      flow.
- [ ] Confirm unrelated provider onboarding is hidden unless
      `relay.advancedSurfaces.enabled` is deliberately enabled for diagnostics.
- [ ] Confirm OpenCode Web is not the first-run product screen.

## Office Workflows

Create a test workspace, for example `C:\relay-aionui-test`, and run these from
Relay Agent:

- [ ] Ask Word assistant to create a `.docx` summary file in the workspace.
- [ ] Ask Excel assistant to create a `.xlsx` table file in the workspace.
- [ ] Ask PowerPoint assistant to create a small `.pptx` deck in the workspace.
- [ ] Open each output in Microsoft Office or the configured preview path and
      confirm the file is readable.
- [ ] Ask Relay Agent to search the workspace for the created Office files and
      confirm the returned paths are correct.

## Result Record

Record:

- Relay Agent release tag
- Installer asset name
- Installer SHA256
- Signing mode and Authenticode status
- Windows version
- Microsoft 365 sign-in status
- OfficeCLI version
- Defender or SmartScreen message, if any
- Office workflow pass/fail notes
