# Relay Agent Packaging Policy

Date: 2026-03-29

## Purpose

This document is the concrete artifact for Task Master subtask `11.1`:
define the first end-user packaging target, installer type, update path, and
data-retention expectations for non-engineer operators.

## Decision Summary

- First supported packaged end-user OS: Windows 10/11 x64
- First official build target: `x86_64-pc-windows-msvc`
- First official installer type: NSIS
- Official user launch story: install the packaged desktop app, then open it
  from the Windows Start menu or desktop shortcut
- Developer-only startup paths such as `pnpm` or `tauri dev` remain outside the
  supported end-user workflow

## Update Policy

- The first non-engineer release track uses manual installer-driven updates
- In-app auto-update is out of scope for this phase
- Windows installer assets should be distributed from GitHub Releases rather
  than committed into the repository
- Users should download the newer signed Windows installer from GitHub Releases
  and run it over the existing install
- Release notes must call out any version that changes storage layout or
  requires a migration step

## Data Retention Expectations

- Upgrade installs must preserve Relay Agent's app-local storage so sessions,
  turns, local artifacts, and logs remain available after an update
- This expectation depends on keeping the existing Tauri app identifier
  `com.relayagent.desktop`
- Save-copy outputs remain in the user-selected destination and are not moved
  into app-local storage
- Uninstall should not be treated as the primary data-deletion workflow; future
  explicit reset or deletion UX will handle operator-facing cleanup

## Packaging Config Mapping

- Base cross-platform development config remains in
  `apps/desktop/src-tauri/tauri.conf.json`
- Windows-specific packaging expectations are defined in
  `apps/desktop/src-tauri/tauri.windows.conf.json`
- The Windows override narrows the bundle target to `nsis` so the release path
  matches the first supported non-engineer distribution story
- GitHub Actions release automation for Windows installer publication lives in
  `.github/workflows/release-windows-installer.yml`

## Deferred

- macOS packaged distribution
- Linux packaged distribution for end users
- MSI-based enterprise rollout
- In-app updater channels, signing automation, and background update UX
