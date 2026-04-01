# Autonomous Execution E2E Verification

## Preconditions

- Tasks `114` through `122` are implemented in the current branch.
- Windows 10/11 with Microsoft Edge and M365 Copilot Chat is available.
- Edge can be launched with CDP enabled, or the app can auto-launch it.
- `pnpm --filter @relay-agent/desktop tauri:dev` starts successfully.
- `examples/revenue-workflow-demo.csv` is available.

## Scenario 1: Plan proposal and approval

Purpose: confirm that a planning-enabled agent loop proposes a multi-step plan and waits for approval.

Steps:
1. Launch the desktop app and open `examples/revenue-workflow-demo.csv`.
2. Enter `approved が true の行だけ残し、結果を別コピーとして保存してください`.
3. Complete Step 1 and open Step 2.
4. Enable `エージェントループモード` and keep `計画フェーズを有効にする` on.
5. Click `Copilotで自動ループ開始 ▶`.

Expected result:
- A plan review panel appears instead of immediate write execution.
- The plan lists read and write steps separately.
- A step can be deleted and moved up/down before approval.
- `計画を承認して実行する` starts autonomous execution.

## Scenario 2: Read steps auto-run, write step pauses for review

Purpose: confirm that approved read steps run automatically and write steps reuse the existing preview-before-write flow.

Steps:
1. Approve a plan that contains at least one read step and one write step.
2. Wait for the autonomous execution progress panel to advance through the read step(s).
3. Confirm the app stops at the write step and opens Step 3 review.

Expected result:
- The progress panel marks read steps as complete.
- The current write step shows a waiting/review state.
- Step 3 renders preview details, warnings, and the save-copy destination.
- The original workbook stays unchanged.

## Scenario 3: Save and resume remaining plan

Purpose: confirm that write approval completes the current step and resumes the remaining approved plan.

Steps:
1. Use a plan with more than one step after the first write gate.
2. In Step 3, click `保存する`.
3. Observe whether execution continues automatically.

Expected result:
- The write step becomes completed after save-copy execution.
- If additional approved steps remain, the app resumes the remaining plan automatically.
- Final completion appears only after the last remaining step finishes.

## Scenario 4: Pause, resume, and cancel

Purpose: confirm that the user can safely pause between steps or cancel the autonomous run.

Steps:
1. Start an approved autonomous plan.
2. Click `一時停止` while a step is running.
3. After the current step finishes, confirm the app waits before the next step.
4. Click `再開`.
5. Start another plan and click `キャンセル`.

Expected result:
- Pause takes effect between steps, not mid-step.
- Resume continues from the next pending step.
- Cancel stops the autonomous run cleanly.
- Manual review/input remains available after cancellation.

## Scenario 5: Replan with feedback

Purpose: confirm that the user can reject a plan and request a revised one with feedback.

Steps:
1. Start a planning-enabled loop and wait for a proposed plan.
2. Click `再計画する`.
3. Enter feedback such as `先に列名を確認してからフィルタしてください`.
4. Submit the replanning request.

Expected result:
- A new planning loop runs with the feedback included.
- A revised plan is shown.
- The previous plan is replaced rather than merged.

## Scenario 6: Autonomous settings persistence

Purpose: confirm that planning and pause-related settings persist and affect behavior.

Steps:
1. Open Settings.
2. Toggle `計画フェーズを有効にする`, `読み取りステップを自動実行する`, and `各ステップの前で一時停止する`.
3. Close and reopen the app.
4. Start the loop again with the updated settings.

Expected result:
- The toggles retain their last saved values.
- `計画フェーズを有効にする = off` restores the older direct loop behavior.
- `読み取りステップを自動実行する = off` pauses before read steps.
- `各ステップの前で一時停止する = on` pauses before every step.

## Completion Checklist

- [ ] Scenario 1 passes.
- [ ] Scenario 2 passes.
- [ ] Scenario 3 passes.
- [ ] Scenario 4 passes.
- [ ] Scenario 5 passes.
- [ ] Scenario 6 passes.
- [ ] All scenarios preserve the original workbook input and save-copy guardrail.

## Troubleshooting

- Browser automation logs: DevTools console entries with `[copilot-browser]` or `[agent-loop]`.
- Rust-side logs: `RUST_LOG=debug pnpm --filter @relay-agent/desktop tauri:dev`
- If progress looks stale, inspect the latest `plan-progress` artifact under the session storage directory.
