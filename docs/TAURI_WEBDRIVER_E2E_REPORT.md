# Tauri WebDriver E2E Report

Date: 2026-04-02

## Scope

This report covers the Windows investigation and stabilization work for Tauri WebDriver smoke coverage in the desktop app.

## Problem Summary

- The desktop app could be launched through `tauri-driver`, but post-session WebDriver commands often hung.
- The UI sometimes appeared as a blank or frozen window during automated runs.
- The initial failure mode looked like a generic Tauri or WebView2 problem, but that hypothesis was too weak because the official Tauri WebDriver example still needed to be checked in the same environment.

## Investigation Result

- The official Tauri WebDriver approach works in this Windows environment when pointed at a valid packaged binary.
- The Relay Agent-specific failure was narrowed to frontend behavior rather than the `tauri-driver` / `msedgedriver` stack itself.
- The blocking behavior came from `ActivityFeed.svelte`, where `afterUpdate` always awaited `tick()` and then forced `scrollTop` on every update.
- That auto-scroll loop interfered with stable DOM interaction over WebDriver and produced the observed hangs.

## Changes Made

- Added a packaged-app WebDriver smoke suite at `apps/desktop/e2e-tests/tauri.webdriver.mjs`.
- Added `e2e:webdriver` plus the required test dependencies to `apps/desktop/package.json`.
- Updated `ActivityFeed.svelte` so auto-scroll only runs when the feed tail changes, using a single microtask instead of `afterUpdate + tick` on every render.
- Removed temporary probe-only instrumentation after the root cause was identified.

## Verification

Commands run on 2026-04-02:

```bash
pnpm -C apps/desktop check
pnpm -C apps/desktop e2e:webdriver
```

Observed result:

- `pnpm -C apps/desktop check`: passed with `0 errors` and `0 warnings`
- `pnpm -C apps/desktop e2e:webdriver`: passed with `2 passing`

Validated behaviors:

- The packaged Tauri desktop app launches through `tauri-driver`
- The welcome overlay can be dismissed
- Manual mode can be selected
- The main guided workflow shell is reachable
- The settings modal opens from the desktop shell

## Residual Notes

- Vite still emits dynamic/static import chunk warnings during the build step used by the smoke test. They are non-blocking and did not affect WebDriver pass/fail behavior in this run.
- `msedgedriver.exe` is still a local test dependency in the workspace and was not added to Git.
