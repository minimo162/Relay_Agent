# Relay Agent Trusted Signing Setup

This page is the repo-specific setup guide for adding Azure Trusted Signing
(now surfaced by Microsoft as Artifact Signing) to the Windows installer release
workflow.

## What this repo expects

The release workflow at `.github/workflows/release-windows-installer.yml` now
supports three states:

- `trusted-signing`: all required GitHub and Azure configuration is present, so
  the workflow signs the NSIS installer before release upload
- `unsigned-prerelease`: none of the Trusted Signing inputs are configured, and
  the workflow was manually dispatched for a prerelease tag containing `-`; the
  workflow publishes an unsigned installer asset marked with `-unsigned.exe`
- `partial-config`: some Trusted Signing values are present and some are
  missing, so the workflow fails fast instead of publishing an ambiguous asset

Formal pushed `v*` release tags fail when Trusted Signing is not configured.

## GitHub secrets

These are required for OIDC-based Azure login from GitHub Actions:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

These values come from the Microsoft Entra app registration or service
principal that GitHub Actions will use for release signing.

## GitHub repository variables

These values are not secrets, so the workflow reads them from repository
variables instead of secrets:

- `AZURE_CODESIGN_ENDPOINT`
  Example: `https://jpe.codesigning.azure.net/`
- `AZURE_CODESIGN_ACCOUNT_NAME`
  Example: `relayagentsigning`
- `AZURE_CODESIGN_CERT_PROFILE_NAME`
  Example: `relayagent-publictrust`

## Azure resources and settings

1. Register the resource provider:
   `Microsoft.CodeSigning`
2. Create an Artifact Signing account in the target region.
3. Complete identity validation in Azure portal.
4. Create a certificate profile, usually `PublicTrust` for Windows
   installer distribution.
5. Create or choose a Microsoft Entra app registration for GitHub Actions OIDC.
6. Add a federated credential for this GitHub repository and the branch, tag,
   or environment that is allowed to publish releases.
7. Assign `Artifact Signing Certificate Profile Signer` to the GitHub Actions
   principal on the certificate profile or signing account scope.
8. Assign `Artifact Signing Identity Verifier` to the human operator who must
   complete identity validation in Azure portal.

## Azure CLI quickstart shape

The exact tenant and resource names are environment-specific, but the minimum
shape is:

```bash
az provider register --namespace Microsoft.CodeSigning
az extension add --name artifact-signing

az group create --name RelayAgentSigning --location japaneast
az artifact-signing create -n relayagentsigning -l japaneast -g RelayAgentSigning --sku Basic
az artifact-signing certificate-profile create \
  -g RelayAgentSigning \
  --account-name relayagentsigning \
  -n relayagent-publictrust \
  --profile-type PublicTrust \
  --identity-validation-id <identity-validation-id>
```

After identity validation completes in the portal, create a certificate profile
and assign the signer role to the GitHub Actions principal.

## Workflow behavior

The workflow uses:

- `azure/login@v2` for GitHub OIDC authentication
- `azure/artifact-signing-action@v1` for signing the generated NSIS installer
- `Get-AuthenticodeSignature` to verify the signed asset before upload
- `gh release upload --clobber` to replace an existing asset on the same tag

## First signed release checklist

1. Confirm all three GitHub secrets exist.
2. Confirm all three GitHub repository variables exist.
3. Confirm the federated credential is scoped to the GitHub repo and release
   workflow trigger you actually use.
4. Confirm the GitHub principal has
   `Artifact Signing Certificate Profile Signer`.
5. Run the workflow manually with a test tag or the next release tag.
6. Confirm the workflow summary says `Signing mode: trusted-signing`.
7. Confirm the workflow summary reports `Authenticode status: Valid`.
8. Download the published installer and confirm the signature locally:

```powershell
Get-AuthenticodeSignature .\Relay.Agent_0.1.0_x64-setup.exe
```

## Expected limitations

- Trusted Signing reduces trust friction but does not guarantee zero
  SmartScreen warnings on the very first signed release.
- Public Trust availability and identity validation requirements depend on the
  Microsoft eligibility rules for your region and entity type.
- Until Azure setup is complete, formal pushed `v*` releases will fail instead
  of publishing unsigned installers. Use a manually dispatched prerelease tag
  containing `-` only for internal unsigned validation builds.

## Official references

- Azure Artifact Signing quickstart:
  `https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart`
- Azure Artifact Signing action:
  `https://github.com/Azure/artifact-signing-action`
- GitHub Actions OIDC for Azure:
  `https://docs.github.com/ja/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure`
