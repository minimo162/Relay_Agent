# Delegation UI E2E Verification

## Preconditions

- Tasks `124` through `136` are implemented in the current branch.
- Windows 10/11 with Microsoft Edge and M365 Copilot Chat is available.
- `pnpm --filter @relay-agent/desktop tauri:dev` starts successfully.
- Browser automation is configured, or manual fallback can be exercised from the same machine.
- A sample workbook such as `examples/revenue-workflow-demo.csv` is available.

## Scenario 1: Goal-first delegation start

Purpose: confirm that delegation mode is the default and a natural-language goal starts the agent flow without the manual three-step wizard.

Steps:
1. Launch the desktop app.
2. Confirm the page opens in `Delegation` mode.
3. Enter `revenue-workflow-demo.csv の approved が true の行だけ残して保存してください`.
4. Attach the sample file if it is not auto-detected.
5. Submit with `Enter` or the send button.

Expected result:
- The activity feed records the goal and attached file.
- Planning or execution starts immediately.
- The manual copy/paste Step 2 UI is not shown in delegation mode.

## Scenario 2: Plan review and write approval intervention

Purpose: confirm that delegation mode only interrupts the user when review or approval is needed.

Steps:
1. Start a planning-enabled delegation run.
2. Wait for a proposed plan to appear.
3. Review the intervention panel and approve the plan.
4. Let the run proceed until a write step is reached.

Expected result:
- The intervention panel shows the proposed plan with reorder/remove controls.
- After approval, execution continues automatically through read steps.
- The intervention panel switches to write approval with preview details before save-copy execution.

## Scenario 3: Browser automation failure fallback

Purpose: confirm that a failed Copilot automation path still gives the user a recovery path inside delegation mode.

Steps:
1. Launch the app with browser automation unavailable, or disconnect Edge CDP during a run.
2. Submit a delegation goal.

Expected result:
- The activity feed shows the automation failure clearly.
- A manual fallback path is visible without switching to manual mode.
- The error does not discard the current goal or attached files.

## Scenario 4: Cancellation and keyboard shortcuts

Purpose: confirm that delegation mode keyboard shortcuts work and cancellation is safe.

Steps:
1. Start a delegation run.
2. Press `Escape` while the run is active.
3. Start another run that reaches a plan-review or write-approval gate.
4. Press `Ctrl+Enter` to approve the current intervention.

Expected result:
- `Escape` cancels the active run cleanly.
- `Ctrl+Enter` approves the currently active intervention.
- The activity feed reflects both actions.

## Scenario 5: Draft and mode persistence

Purpose: confirm that delegation drafts and the selected UI mode survive reload/restart.

Steps:
1. In delegation mode, enter a goal and attach at least one file.
2. Close and reopen the app before completing the run.
3. Confirm the draft is restored.
4. Switch to `Manual` mode, close the app, and reopen it again.

Expected result:
- The draft goal, attached files, activity feed snapshot, and current delegation state are restored.
- The selected UI mode is restored on reopen.
- Returning to delegation mode still shows the previous in-progress context unless it was explicitly reset.

## Scenario 6: Responsive intervention layout

Purpose: confirm that the intervention panel adapts on narrower windows without blocking the main feed.

Steps:
1. Start a delegation run that reaches plan review or write approval.
2. Narrow the app window below the desktop breakpoint.

Expected result:
- The activity feed remains readable at full width.
- The intervention panel moves below the main feed rather than breaking the layout.
- The chat composer remains reachable at the bottom.

## Completion Checklist

- [ ] Scenario 1 passes.
- [ ] Scenario 2 passes.
- [ ] Scenario 3 passes.
- [ ] Scenario 4 passes.
- [ ] Scenario 5 passes.
- [ ] Scenario 6 passes.
- [ ] The original input workbook remains unchanged in every write scenario.

## Troubleshooting

- Browser automation logs: DevTools entries with `[copilot-browser]` or `[agent-loop]`.
- Rust-side logs: `RUST_LOG=debug pnpm --filter @relay-agent/desktop tauri:dev`
- If the delegation draft looks stale, inspect the latest continuity JSON in the app storage directory.
