# Relay Agent Packaging Policy

Date: 2026-05-16

## Purpose

This document defines the active packaging target for the hard-cutover Relay
Workbench architecture. It replaces the older Windows/Tauri/NSIS packaging
policy. The Windows installer remains NSIS-based, but it packages the sidecar
Workbench architecture rather than the removed Tauri shell.

## Decision Summary

- Active product shape: browser-hosted Relay Workbench served by the
  self-contained .NET sidecar.
- Supported release artifacts for the current cutover:
  - Windows x64 user-scope NSIS installer for the sidecar Workbench.
  - Linux x64 self-contained sidecar archive plus launcher.
- Unsupported active release paths:
  - Tauri NSIS installer for the old desktop shell.
  - AionUi overlay installer.
  - OpenCode/OpenWork bundled runtime.
  - Codex app-server or upstream Codex CLI bundle.
- The Windows installer must not require administrator rights, UAC elevation,
  machine-wide installation, or the user's personal Windows password.

## Update Policy

- The current Windows release track uses a GitHub Release NSIS installer asset
  containing the sidecar Workbench, required runtime tools, and
  release inventory/SBOM-style metadata.
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
  - `pnpm sidecar:publish:windows`
  - `pnpm sidecar:publish:linux`
  - `pnpm sidecar:installer:windows`
  - `pnpm release:inventory`
- The active Windows release workflow should publish the sidecar Workbench NSIS
  installer and should keep installer terminology because it builds an actual
  installer.
- The active Linux release workflow should publish a sidecar archive and
  launcher, not an installer.
- Runtime resources such as ripgrep and OfficeCLI must be bundled from
  sidecar-owned `tools/` or `third_party/` locations, not from
  `apps/desktop/src-tauri`.
- The Windows installer bundle must include, where licensing and platform
  support allow, `Relay.Sidecar.exe`, Workbench static assets, `rg.exe`,
  `officecli.exe`, launcher files, default config, license/notice files,
  release inventory, and SBOM-style metadata.
- The installer must create Start Menu shortcuts, optional desktop shortcuts,
  an uninstall entry, and per-user registry/app metadata only. It must not
  write machine-wide registry keys or require Program Files installation.
- Release inventory must list bundled files, hashes, versions, source/license
  notes, intentionally excluded legacy runtimes, and installer configuration
  proving user-scope installation.

## Deferred

- MSI/MSIX enterprise rollout.
- macOS packaged distribution.
- In-app updater channels and background update UX.
- Formal code-signing and enterprise trust distribution for the Windows
  installer.
