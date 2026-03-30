# Startup Test Verification

## Goal

Confirm that Relay Agent now has a deterministic source-run startup test command
plus a short manual checklist for the real desktop window launch.

## Automated Startup Test

Run from the repository root:

```bash
pnpm startup:test
```

Expected result:

- The command exits with status `0`.
- It prints three startup smoke summaries:
  - `ready`
  - `retry-recovery`
  - `attention`
- It then runs the Rust `startup::tests` suite successfully.

## Manual GUI Startup Check

1. Start the app with:

   ```bash
   pnpm --filter @relay-agent/desktop tauri:dev
   ```

2. Confirm Home opens without requiring a `.env` file.
3. Confirm the first visible surface is one unified guided form rather than a
   sample/custom split.
4. Confirm the status card shows the current startup status and storage mode.
5. Confirm the bundled sample shortcut appears inside the file selector area
   when the sample CSV is discoverable in the current source checkout.
6. Open Settings and confirm the storage path is visible when local storage is
   available.

Expected result:

- The desktop window launches successfully from source.
- Home reflects the same startup contract used by the automated startup smoke
  command.
- The verified startup path still does not require `.env.example`.

## Command Checks

```bash
test -f .taskmaster/docs/prd_startup_test_harness.txt
test -f docs/STARTUP_TEST_VERIFICATION.md
pnpm startup:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 27 and (.id | tonumber) <= 31) | {id, status}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
