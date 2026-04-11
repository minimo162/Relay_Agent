# App Launch Test Verification

## Goal

Confirm that Relay Agent can launch the real Tauri desktop app from source in a
headless Linux environment and keep it alive long enough to verify frontend and
desktop startup.

## Automated Launch Test

Run from the repository root:

```bash
pnpm launch:test
```

Expected result:

- The command exits with status `0`.
- It starts `Xvfb` directly, without relying on `xvfb-run`.
- It launches `pnpm tauri:dev`.
- It prints one JSON summary with:
  - `status: "ok"`
  - `frontendReady: true`
  - `desktopBinaryLaunchDetected: true`

## Manual Launch Check

1. Start the app with:

   ```bash
   pnpm --filter @relay-agent/desktop tauri:dev
   ```

2. Confirm the desktop window appears with the `Relay Agent` title.
3. Confirm Home loads instead of exiting early after the frontend dev server is
   ready.
4. Confirm the first-run sample or custom choice still appears on a clean
   profile.
5. Close the app and confirm no orphaned `vite`, `tauri dev`, or desktop binary
   processes remain.

## Command Checks

```bash
test -f .taskmaster/docs/prd_app_launch_execution_test.txt
test -f docs/APP_LAUNCH_TEST_VERIFICATION.md
pnpm launch:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 32 and (.id | tonumber) <= 36) | {id, status}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
