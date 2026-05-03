# Windows Self-Signed Signing

This guide is for internal Windows smoke testing only. Self-signed
Authenticode certificates do not create public trust, do not build SmartScreen
reputation, and must not be used for formal public GitHub Releases.

Use this when you need to confirm that the installer can be Authenticode-signed
with local tools before a real public CA or Azure Artifact Signing path is
available.

## Prerequisites

- Windows 10/11 test machine
- OpenSSL on `PATH`
- `signtool.exe` from the Windows SDK on `PATH`, or pass `-SignToolPath`
- An unsigned Relay Agent NSIS installer, usually named like
  `Relay.Agent_0.1.0_x64-setup-unsigned.exe`

## Sign an Internal Test Installer

From the repository root on Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-self-sign-installer.ps1 `
  -InstallerPath ".\Relay.Agent_0.1.0_x64-setup-unsigned.exe" `
  -TrustCert
```

The script writes all local signing material under
`artifacts/self-signed-signing/`, including:

- `relay-agent-selfsigned.key`
- `relay-agent-selfsigned.crt`
- `relay-agent-selfsigned.pfx`
- `relay-agent-selfsigned.pfx.password.txt`
- `<installer-name>-selfsigned.exe`

`artifacts/` and certificate/key formats are ignored by git. Do not move these
files into tracked source.

Use `-SkipSignToolVerify` if local `signtool verify` is slow or blocked by
certificate chain checks. The script still reports `Get-AuthenticodeSignature`
status after signing.

## Publish a Self-Signed GitHub Prerelease

The `release-windows-installer` workflow can publish a self-signed internal
prerelease asset when Azure Artifact Signing is not configured. This path is
restricted to manual `workflow_dispatch` runs with a prerelease tag containing
`-`.

From GitHub Actions, run `release-windows-installer` with:

- `release_tag`: for example `v0.1.0-selfsigned.1`
- `release_name`: optional
- `self_signed_prerelease`: `true`

Equivalent GitHub CLI command:

```powershell
gh workflow run release-windows-installer.yml `
  -f release_tag=v0.1.0-selfsigned.1 `
  -f self_signed_prerelease=true
```

The workflow uploads:

- `<installer-name>-selfsigned.exe`
- `relay-agent-selfsigned-public-test-cert.crt`

The `.crt` file is the public certificate only. The workflow does not upload
the private key, PFX, or generated PFX password.

## Reuse the Same Test Certificate

Use `-ReuseCertificate` to sign another build with the same local test
certificate:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-self-sign-installer.ps1 `
  -InstallerPath ".\Relay.Agent_0.1.0_x64-setup-unsigned.exe" `
  -ReuseCertificate `
  -TrustCert
```

## Verify

The script runs both `signtool verify /pa /v` and
`Get-AuthenticodeSignature`. For a self-signed certificate, verification only
returns a trusted status after the certificate is imported into the current
user's `Root` and `TrustedPublisher` stores. The `-TrustCert` switch performs
that import.

Manual verification:

```powershell
signtool verify /pa /v .\artifacts\self-signed-signing\Relay.Agent_0.1.0_x64-setup-unsigned-selfsigned.exe
Get-AuthenticodeSignature .\artifacts\self-signed-signing\Relay.Agent_0.1.0_x64-setup-unsigned-selfsigned.exe | Format-List
```

## Remove Local Trust

After testing, remove the current-user trust entries:

```powershell
Get-ChildItem Cert:\CurrentUser\Root |
  Where-Object Subject -like "*Relay Agent Internal Test*" |
  Remove-Item

Get-ChildItem Cert:\CurrentUser\TrustedPublisher |
  Where-Object Subject -like "*Relay Agent Internal Test*" |
  Remove-Item
```

## Limits

- This is not a Defender bypass. If Windows reports a virus detection, keep
  the file quarantined and inspect the exact detection name from Windows
  Security protection history.
- This does not replace `docs/TRUSTED_SIGNING_SETUP.md`.
- Public releases still need Azure Artifact Signing, an OV/EV code-signing
  certificate, or another public-trust signing route.
