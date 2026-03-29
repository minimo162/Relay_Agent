# Continuity Verification

This walkthrough verifies the current non-engineer continuity slice from source.
Run the desktop shell with:

```bash
pnpm --filter @relay-agent/desktop tauri:dev
```

Use the bundled sample file at `examples/revenue-workflow-demo.csv` unless noted
otherwise.

## Scenario 1: Restart Resume From Recent Work

1. Create a session from Home and open it in Studio.
2. Start a turn and generate a relay packet.
3. Paste any non-empty response draft into `Pasted response`.
4. Navigate back to Home through in-app navigation and choose `Leave and keep draft`.
5. Confirm Home shows the session under `Recent work`.
6. Reopen that session in Studio.

Expected result:

- Studio restores the local draft, pasted response text, and any saved packet or
  preview summary state for that session.
- Home does not show a crash-recovery prompt because the draft was kept
  intentionally.

## Scenario 2: Abnormal Shutdown Recovery

1. Create or reopen a session in Studio.
2. Leave non-empty draft or response text in place.
3. Close the app without using an in-app keep-or-discard choice.
   On desktop builds, confirm the platform leave prompt if one appears.
4. Start the app again.

Expected result:

- Home shows `Recovery available` before the normal recent-work flow.
- Choosing recovery reopens the affected session in Studio and restores the last
  safe autosaved draft.
- Choosing discard removes the recovery prompt for that session.

## Scenario 3: Intentional Leave With Keep Draft

1. In Studio, stage any local draft change, validation checkpoint, or preview.
2. Trigger an in-app route leave, for example browser back to Home.
3. In the warning dialog, choose `Leave and keep draft`.
4. Reopen the same session from `Recent work`.

Expected result:

- The app leaves Studio without discarding the local draft.
- The same session restores its local continuity state when reopened.

## Scenario 4: Intentional Leave With Discard

1. In Studio, stage any local draft change, validation checkpoint, or preview.
2. Trigger the same in-app route leave.
3. In the warning dialog, choose `Leave and discard draft`.
4. Reopen the same session from Home.

Expected result:

- The app leaves Studio and removes the local draft for that session.
- Reopening the session loads persisted backend session detail only, without the
  discarded local continuity state.

## Scenario 5: Replace Draft Inside Studio

1. In Studio, stage local draft or response work on the current session.
2. Click `Prepare new turn` or select a different turn from the left pane.
3. In the warning dialog, first choose `Keep working on this draft`.
4. Repeat the same action and choose the discard option instead.

Expected result:

- `Keep working on this draft` leaves the current Studio state untouched.
- The discard action clears the current local draft and then continues with the
  requested turn switch or fresh-turn reset.

## Command Checks

Run these repository checks after the walkthrough:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
