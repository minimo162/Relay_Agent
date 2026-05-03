#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,

  [string] $OutputDirectory = "artifacts/self-signed-signing",
  [string] $OpenSslPath = "openssl",
  [string] $SignToolPath,
  [string] $Country = "JP",
  [string] $Organization = "Relay Agent Dev",
  [string] $CommonName = "Relay Agent Internal Test",
  [int] $Days = 365,
  [string] $PfxPassword,
  [switch] $ReuseCertificate,
  [switch] $TrustCert,
  [string] $TimestampUrl,
  [string] $Description = "Relay Agent internal test installer",
  [string] $DescriptionUrl = "https://github.com/minimo162/Relay_Agent",
  [switch] $SkipSignToolVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function Resolve-OutputDirectory {
  param([string] $Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return (Join-Path (Resolve-RepoRoot) $Path)
}

function Resolve-Executable {
  param(
    [string] $Name,
    [string] $ExplicitPath
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    $command = Get-Command $ExplicitPath -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }

    if (Test-Path -LiteralPath $ExplicitPath) {
      return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    throw "$Name was not found at '$ExplicitPath'."
  }

  $pathCommand = Get-Command $Name -ErrorAction SilentlyContinue
  if ($pathCommand) {
    return $pathCommand.Source
  }

  if ($Name -ieq "signtool.exe") {
    $kitRoots = @()
    if (${env:ProgramFiles(x86)}) {
      $kitRoots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin")
      $kitRoots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\8.1\bin")
    }
    if ($env:ProgramFiles) {
      $kitRoots += (Join-Path $env:ProgramFiles "Windows Kits\10\bin")
      $kitRoots += (Join-Path $env:ProgramFiles "Windows Kits\8.1\bin")
    }

    foreach ($root in $kitRoots) {
      if (-not (Test-Path -LiteralPath $root)) {
        continue
      }

      $candidate = Get-ChildItem -Path (Join-Path $root "*\x64\signtool.exe") -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    }
  }

  throw "$Name was not found. Put it on PATH or pass the explicit path."
}

function Invoke-External {
  param(
    [string] $FilePath,
    [string[]] $Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "'$FilePath' failed with exit code $LASTEXITCODE."
  }
}

function New-RandomPassword {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return ([BitConverter]::ToString($bytes)).Replace("-", "")
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "This script signs Windows installers and must run on Windows."
}

$resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$outputDirectoryPath = Resolve-OutputDirectory $OutputDirectory
New-Item -ItemType Directory -Force -Path $outputDirectoryPath | Out-Null

$openSslExe = Resolve-Executable -Name "openssl" -ExplicitPath $OpenSslPath
$resolvedSignToolPath = Resolve-Executable -Name "signtool.exe" -ExplicitPath $SignToolPath

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedInstallerPath)
$extension = [System.IO.Path]::GetExtension($resolvedInstallerPath)
$signedInstallerPath = Join-Path $outputDirectoryPath "$baseName-selfsigned$extension"
$openSslConfigPath = Join-Path $outputDirectoryPath "relay-agent-selfsigned-openssl.cnf"
$keyPath = Join-Path $outputDirectoryPath "relay-agent-selfsigned.key"
$certPath = Join-Path $outputDirectoryPath "relay-agent-selfsigned.crt"
$pfxPath = Join-Path $outputDirectoryPath "relay-agent-selfsigned.pfx"
$passwordPath = Join-Path $outputDirectoryPath "relay-agent-selfsigned.pfx.password.txt"

if ([string]::IsNullOrWhiteSpace($PfxPassword)) {
  if ($ReuseCertificate -and (Test-Path -LiteralPath $passwordPath)) {
    $PfxPassword = (Get-Content -LiteralPath $passwordPath -Raw).TrimEnd("`r", "`n")
  } else {
    $PfxPassword = New-RandomPassword
    Set-Content -LiteralPath $passwordPath -Value $PfxPassword -Encoding ASCII -NoNewline
  }
}

$shouldCreateCertificate = -not $ReuseCertificate -or
  -not (Test-Path -LiteralPath $keyPath) -or
  -not (Test-Path -LiteralPath $certPath) -or
  -not (Test-Path -LiteralPath $pfxPath)

if ($shouldCreateCertificate) {
  Write-Host "Creating self-signed code signing certificate with OpenSSL..."
  @"
[ req ]
default_bits = 3072
default_md = sha256
prompt = no
distinguished_name = dn
x509_extensions = v3_codesign
string_mask = utf8only

[ dn ]
C = $Country
O = $Organization
CN = $CommonName

[ v3_codesign ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
"@ | Set-Content -LiteralPath $openSslConfigPath -Encoding ASCII

  Invoke-External -FilePath $openSslExe -Arguments @(
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-sha256",
    "-nodes",
    "-days",
    $Days.ToString(),
    "-keyout",
    $keyPath,
    "-out",
    $certPath,
    "-config",
    $openSslConfigPath
  )

  Write-Host "Exporting self-signed certificate to PFX..."
  Invoke-External -FilePath $openSslExe -Arguments @(
    "pkcs12",
    "-export",
    "-inkey",
    $keyPath,
    "-in",
    $certPath,
    "-out",
    $pfxPath,
    "-passout",
    "pass:$PfxPassword",
    "-name",
    $CommonName
  )
}

if ($TrustCert) {
  Write-Host "Importing self-signed certificate into CurrentUser trust stores..."
  Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
}

Copy-Item -LiteralPath $resolvedInstallerPath -Destination $signedInstallerPath -Force

$signArgs = @(
  "sign",
  "/fd",
  "SHA256",
  "/f",
  $pfxPath,
  "/p",
  $PfxPassword,
  "/d",
  $Description,
  "/du",
  $DescriptionUrl
)

if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
  $signArgs += @("/td", "SHA256", "/tr", $TimestampUrl)
}

$signArgs += $signedInstallerPath
Write-Host "Signing copied installer with signtool.exe..."
Invoke-External -FilePath $resolvedSignToolPath -Arguments $signArgs

if ($SkipSignToolVerify) {
  Write-Host "Skipping signtool verify because -SkipSignToolVerify was set."
} else {
  Write-Host "Verifying Authenticode signature with signtool.exe..."
  & $resolvedSignToolPath @("verify", "/pa", "/v", $signedInstallerPath)
  $verifyExitCode = $LASTEXITCODE
  if ($verifyExitCode -ne 0) {
    Write-Warning "signtool verify returned $verifyExitCode. For self-signed certs this is expected unless -TrustCert imported the test cert for the current user."
  }
}

Write-Host "Reading Authenticode signature status..."
$signature = Get-AuthenticodeSignature -LiteralPath $signedInstallerPath

[pscustomobject]@{
  SignedInstaller = $signedInstallerPath
  Certificate = $certPath
  Pfx = $pfxPath
  PasswordFile = $passwordPath
  CertificateSubject = $signature.SignerCertificate.Subject
  AuthenticodeStatus = $signature.Status
  TrustedForCurrentUser = [bool] $TrustCert
  PublicDistribution = $false
} | Format-List
