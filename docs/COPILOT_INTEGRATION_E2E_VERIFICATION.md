# Copilot Integration E2E Verification

## Preconditions

- Tasks `138` through `142` are implemented in the current branch.
- Windows 10/11 with Microsoft Edge and M365 Copilot Chat is available.
- `pnpm --filter @relay-agent/desktop tauri:dev` starts successfully.
- Browser automation is configured and can reach a logged-in Copilot session.
- A sample workbook such as `examples/revenue-workflow-demo.csv` is available.

## Scenario 1: Planning prompt quality

Purpose: confirm that the new planning prompt produces a structured plan with read-first and write-last sequencing.

Steps:
1. Start a delegation or manual planning-enabled run.
2. Use a goal such as `approved が true の行だけ残して別コピーとして保存してください`.
3. Wait for the plan proposal.

Expected result:
- The proposed plan contains a clear read phase before any write phase.
- The plan summary reflects the user goal without unnecessary extra actions.
- The plan remains compatible with the app's execution plan schema.

## Scenario 2: Context compression after several turns

Purpose: confirm that longer agent loops still converge after early turns are compressed.

Steps:
1. Use a task that requires several read turns before a write proposal.
2. Let the loop exceed five turns.
3. Inspect logs or behavior after the compression threshold is crossed.

Expected result:
- The loop continues without obvious context drift.
- Later turns still reference earlier findings correctly.
- No visible failure occurs from context overflow or uncontrolled prompt growth.

## Scenario 3: Invalid JSON retry recovery

Purpose: confirm that malformed Copilot responses trigger structured retry prompts before failing.

Steps:
1. Induce or observe a malformed response case.
2. Let the loop retry automatically.

Expected result:
- Retry attempts are visible in the activity/log output.
- The retry prompt becomes progressively simpler.
- If a later retry succeeds, execution resumes without user re-entry.

## Scenario 4: Manual fallback after repeated failure

Purpose: confirm that repeated response failures do not dead-end the workflow.

Steps:
1. Force repeated malformed or unusable Copilot responses.
2. Wait until automatic retries are exhausted.

Expected result:
- The app stops retrying after the configured limit.
- A manual fallback prompt is available to copy/use.
- The current goal and context are preserved.

## Scenario 5: Conversation history persistence

Purpose: confirm that conversation history survives draft persistence and is available for debugging.

Steps:
1. Start a multi-turn run.
2. Stop after at least one Copilot turn has completed.
3. Restart the app and restore the draft.

Expected result:
- The draft restores the in-progress delegation context.
- The stored session can still reference prior Copilot exchange history for continuation/debugging.
- No crash or schema reset occurs when reloading the persisted history.

## Scenario 6: Single-session safety boundary

Purpose: confirm that the current implementation still operates as a single-session system and does not pretend to support concurrent Copilot threads.

Steps:
1. Read `docs/MULTI_SESSION_COPILOT.md`.
2. Run the normal Copilot workflow with one active Edge/Copilot thread.

Expected result:
- The shipped workflow remains single-session.
- No UI or automation path claims concurrent multi-thread support.
- The documented limitation matches the observed behavior.

## Completion Checklist

- [ ] Scenario 1 passes.
- [ ] Scenario 2 passes.
- [ ] Scenario 3 passes.
- [ ] Scenario 4 passes.
- [ ] Scenario 5 passes.
- [ ] Scenario 6 passes.

## Troubleshooting

- Browser automation logs: DevTools entries with `[copilot-browser]` or `[agent-loop]`.
- Rust-side logs: `RUST_LOG=debug pnpm --filter @relay-agent/desktop tauri:dev`
- If prompt quality regresses, capture the exact prompt/response pair from the persisted draft before retrying.
