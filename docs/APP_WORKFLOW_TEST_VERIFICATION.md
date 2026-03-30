# App Workflow Test Verification

## Goal

Confirm that Relay Agent can launch the real Tauri desktop app from source in a
headless Linux environment and complete the bundled sample workflow through
preview, approval, and save-copy execution.

## Automated Workflow Test

Run from the repository root:

```bash
pnpm workflow:test
```

Expected result:

- The command exits with status `0`.
- It starts `Xvfb` directly, without relying on `xvfb-run`.
- It launches `pnpm tauri:dev`.
- It prints one JSON summary with:
  - `status: "ok"`
  - `frontendReady: true`
  - `desktopBinaryLaunchDetected: true`
  - `workflowSummaryReceived: true`
- The nested `workflow` summary reports:
  - `status: "ok"`
  - `outputExists: true`
  - `outputMatchesExpected: true`
  - `sourceUnchanged: true`
  - successful steps for `initialize-app`, `locate-sample`, `create-session`,
    `start-turn`, `generate-packet`, `validate-response`, `preview`,
    `approval`, `execution`, `verify-output`, and `verify-source`

## Manual Workflow Check

1. Start the app with:

   ```bash
   pnpm --filter @relay-agent/desktop tauri:dev
   ```

2. In `1. はじめる`, pick the bundled sample shortcut and enter or choose a
   sample objective.
3. Click `始める`.
4. In `2. Copilot に聞く`, click `Copilot 用にコピー`.
5. Paste a valid JSON response and click `変更を確認する`.
6. In `3. 確認して保存`, review the pinned summary strip.
7. Click `コピーを保存する`.
8. Confirm the reviewed copy exists at the previewed `outputPath`.
9. Confirm the original `examples/revenue-workflow-demo.csv` file is unchanged.

## Command Checks

```bash
test -f .taskmaster/docs/prd_app_workflow_launch_test.txt
test -f docs/APP_WORKFLOW_TEST_VERIFICATION.md
pnpm workflow:test
pnpm launch:test
pnpm startup:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 37 and (.id | tonumber) <= 41) | {id, status}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
