# Agent Loop E2E Verification

## Preconditions

- Tasks 85 through 92 are implemented in the current branch.
- Microsoft Edge is running with CDP enabled on port `9222`.
- M365 Copilot Chat is signed in and reachable from the same Edge profile.
- `pnpm --filter @relay-agent/desktop tauri:dev` launches successfully.
- `examples/revenue-workflow-demo.csv` is available.

## Scenario 1: Read-only loop

Purpose: confirm that the agent loop can finish with `status: "done"` without producing write actions.

Steps:
1. Launch the desktop app and open `examples/revenue-workflow-demo.csv`.
2. Enter `このCSVの内容と列の型を教えてください` as the objective.
3. Complete Step 1 and open Step 2.
4. Enable `エージェントループモード`.
5. Click `Copilotで自動ループ開始 ▶`.

Expected result:
- The loop log shows `workbook.inspect`, `sheet.preview`, and `sheet.profile_columns`.
- Each read tool ends with `✓`.
- Copilot returns `status: "done"` within 3 turns.
- No Step 3 save flow is triggered.
- The source file remains unchanged.

## Scenario 2: Multi-turn loop to write handoff

Purpose: confirm that read turns can end in `ready_to_write` and flow directly into the existing Step 3 approval path.

Steps:
1. Open `examples/revenue-workflow-demo.csv`.
2. Enter `approved が true の行だけ残し、amount の合計を追加列として保存してください`.
3. Complete Step 1.
4. Enable `エージェントループモード`.
5. Click `Copilotで自動ループ開始 ▶`.

Expected result:
- Turn 1 executes read tools automatically.
- Copilot returns `thinking` first, then `ready_to_write` within 2 to 3 turns.
- The app fills the Copilot response box with the final JSON.
- The app advances into Step 3 automatically.
- The SheetDiff cards render, `保存する` succeeds, and a save-copy output file is created.
- The source file remains unchanged.

## Scenario 3: Cancel

Purpose: confirm that the user can stop the loop safely.

Steps:
1. Start the agent loop from Step 2.
2. While the loop is running, click `キャンセル`.

Expected result:
- The loop stops immediately.
- The UI becomes interactive again.
- A cancel summary is shown instead of a fatal error.
- Manual paste flow remains available.
- No output file is created.

## Scenario 4: Max turns reached

Purpose: confirm that the max-turn guard is surfaced to the user.

Steps:
1. Open the settings modal.
2. Set `最大ターン数` to `2`.
3. Start a task that requires more than one read round.

Expected result:
- The loop stops after turn 2.
- The UI shows `最大ターン数（2）に達しました` or equivalent.
- `手動入力に切り替え` remains available.

## Scenario 5: CDP unavailable

Purpose: confirm that browser automation failures fall back cleanly.

Steps:
1. Close Edge or relaunch it without `--remote-debugging-port`.
2. Start the agent loop.

Expected result:
- The UI shows the existing CDP error message.
- The loop stops.
- Manual paste flow remains available.

## Completion Checklist

- [ ] Scenario 1 passes.
- [ ] Scenario 2 passes.
- [ ] Scenario 3 passes.
- [ ] Scenario 4 passes.
- [ ] Scenario 5 passes.
- [ ] All scenarios preserve the original workbook input.

## Troubleshooting

- Browser-side logs: DevTools console entries with `[copilot-browser]` or `[agent-loop]`.
- Rust-side logs: `RUST_LOG=debug pnpm --filter @relay-agent/desktop tauri:dev`
- If the loop stops early, inspect the final JSON captured in the Copilot response textarea.
