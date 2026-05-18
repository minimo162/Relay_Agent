# Relay Agent Packaging Policy

Date: 2026-05-16

## Purpose

This document defines the active packaging target for the hard-cutover Relay
Workbench architecture. It replaces the older Windows/Tauri/NSIS packaging
policy. Portable archives are the primary sharing format. The Windows installer
remains NSIS-based as an optional convenience artifact, but it packages the
sidecar Workbench architecture rather than the removed Tauri shell.

## Decision Summary

- Active product shape: browser-hosted Relay Workbench served by the
  self-contained .NET sidecar.
- Supported release artifacts for the current cutover:
  - Windows x64 portable zip for the sidecar Workbench.
  - Linux x64 portable self-contained sidecar archive plus launcher.
  - Optional Windows x64 user-scope NSIS installer for users who want Start
    Menu shortcuts and an uninstall entry.
- Unsupported active release paths:
  - Tauri NSIS installer for the old desktop shell.
  - AionUi overlay installer.
  - OpenCode/OpenWork bundled runtime.
  - Codex app-server or upstream Codex CLI bundle.
- The Windows installer must not require administrator rights, UAC elevation,
  machine-wide installation, or the user's personal Windows password.

## Update Policy

- The current Windows release track uses a GitHub Release portable zip as the
  primary artifact. The zip contains the sidecar Workbench, launcher, required
  runtime tools, portable README, and launch helper. The optional NSIS
  installer contains the same app payload plus shortcut/uninstall integration.
- Fresh Windows installs use `%LOCALAPPDATA%\Programs\Relay Agent`. Upgrades
  from older user-scope installs may continue to use the registered legacy
  `%LOCALAPPDATA%\Programs\RelayAgent` path so the installer updates the
  existing app instead of silently creating a duplicate install.
- Before copying package files, the Windows installer should attempt to stop
  same-user `Relay.Sidecar.exe` and `Relay.Launcher.exe` processes whose
  executable paths are under known Relay install roots. The installer must not
  depend on that stop succeeding: package files are copied into a fresh
  versioned payload directory under the install root, and shortcuts/registry
  metadata are repointed to that payload. This avoids overwriting a running
  `Relay.Sidecar.exe` and prevents raw NSIS `error opening file for writing`
  prompts during normal upgrades.
- The current Linux release track uses a GitHub Release archive plus launcher
  and the same release inventory/SBOM-style metadata.
- In-app auto-update is out of scope for this phase.
- Release notes must call out any version that changes storage layout, ledger
  format, cache retention, or launcher behavior.

## Data Retention Expectations

- App data, run ledgers, traces, backups, temp files, and support bundles live
  under user-local Relay data directories.
- Windows installs must target a user-writable location such as
  `%LOCALAPPDATA%\Programs\Relay Agent`; app data should live under a separate
  user-local Relay data directory such as `%LOCALAPPDATA%\Relay Agent`.
- Shared folders and searched folders must not receive Relay caches, indexes,
  or temp artifacts.
- Upgrade installs or archive replacements should preserve user-local Relay
  data. Uninstall/delete of the application bundle should not be treated as the
  primary data-deletion workflow unless the user explicitly opts into removing
  local data.

## Packaging Config Mapping

- Required publish commands after the packaging milestone:
  - `pnpm sidecar:portable:windows`
  - `pnpm sidecar:portable:linux`
  - `pnpm sidecar:installer:windows` for the optional Windows installer
  - `pnpm release:inventory`
- The active Windows release workflow should publish the sidecar Workbench
  portable zip first and the optional NSIS installer second.
- The active Linux release workflow should publish a versioned portable
  sidecar archive and launcher, not an installer.
- Runtime resources such as ripgrep and OfficeCLI must be bundled from
  sidecar-owned `tools/` or `third_party/` locations, not from
  `apps/desktop/src-tauri`.
- The Windows portable bundle and optional installer payload must include,
  where licensing and platform support allow, `Relay.Sidecar.exe`, Workbench
  static assets, `rg.exe`, `officecli.exe`, launcher files, active Relay app
  icons under `relay-assets/`, default config, license/notice files, portable
  README, release inventory, and SBOM-style metadata.
- The installer must create Start Menu shortcuts, optional desktop shortcuts,
  an uninstall entry with Relay icons, and per-user registry/app metadata only.
  It must not write machine-wide registry keys or require Program Files
  installation.
- Release inventory must list bundled files, hashes, versions, source/license
  notes, intentionally excluded legacy runtimes, and installer configuration
  proving user-scope installation.
- The installed app must not require normal users to set
  `RELAY_COPILOT_CDP_PORT`; Edge CDP attachment/startup and profile storage are
  app-managed under user-local Relay data. Diagnostic overrides may remain
  available for development and live E2E.
- The installed launcher enables sidecar idle-exit for browser Workbench
  sessions. The Workbench sends session heartbeats and a close beacon; after the
  last tab closes or heartbeats expire, the sidecar stops itself after the
  configured quiet period. This is the primary way to prevent lingering
  `Relay.Sidecar.exe` processes during normal use. Installer process-stop
  preflight remains best-effort cleanup, not the main lifecycle mechanism.
- Workspace selection is part of the active app UX. Normal users choose a
  workspace through the OS file explorer. Direct path entry is not the primary
  installed flow, and no picker state may be written into the selected/shared
  workspace.

## Deferred

- MSI/MSIX enterprise rollout.
- macOS packaged distribution.
- In-app updater channels and background update UX.
- Formal code-signing and enterprise trust distribution for the Windows
  installer.
