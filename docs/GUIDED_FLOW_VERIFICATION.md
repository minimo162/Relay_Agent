# Guided Flow Verification

This walkthrough verifies that a first-time user can move through the unified
3-step guided flow using in-product guidance only.

Start the desktop shell from the repo root:

```bash
pnpm --filter @relay-agent/desktop tauri:dev
```

## Bundled Sample Walkthrough

1. Launch the app on a clean profile.
2. In `1. はじめる`, choose the bundled sample shortcut.
3. Pick a plain-language objective starter such as `必要な行だけ抽出`.
4. Confirm the task name auto-fills and remains editable.
5. Click `始める`.
6. In `2. Copilot に聞く`, click `Copilot 用にコピー`.
7. Paste a valid JSON response.
8. Confirm the expected response shape block is visible beside the textarea.
9. Click `変更を確認する`.
10. In `3. 確認して保存`, confirm the 3-point summary strip stays visible above the fold.

Expected result:

- The first-run flow stays inside the app and does not require branching between
  sample and custom entry modes.
- The primary action is always a single button for the current stage.
- The sample walkthrough reaches preview review without any demo-response button.

## Real-File Guided Entry Check

1. Return to Home.
2. Replace the file path with a real workbook path.
3. Pick a quick-start template such as `列名を変更` or `条件で行を絞り込む`.
4. Confirm the task name updates from the objective text.
5. Click `始める`.

Expected result:

- The same start form is used for bundled and custom files.
- The UI keeps plain-language labels and does not expose sample/custom branch
  jargon.
- Safe defaults remain visible before any write action.

## Command Checks

Run these repository checks after the walkthrough:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
