# Guided Flow Verification

This walkthrough verifies that a first-time user can move through onboarding,
task entry, Copilot handoff, and preview review using in-product guidance only.

Start the desktop shell from the repo root:

```bash
pnpm --filter @relay-agent/desktop tauri:dev
```

## First-Run Sample Walkthrough

1. Launch the app on a clean profile so Home shows the first-run welcome.
2. Choose `Try the sample flow`.
3. In Home, use either:
   - a plain-language objective starter, or
   - a quick-start template such as `Filter rows`.
4. Open `Show help` and confirm the current step explains:
   - what the sample flow does,
   - how to describe the task in plain language,
   - when to run `Check this file`.
5. Run `Check this file`.
6. Create the session.
7. Open the new session in Studio.
8. In Studio, open `Show help` and confirm the current step explains the next action.
9. Start a turn if needed, then click `Generate packet`.
10. Use `Copy for Copilot` or, for the bundled sample walkthrough, click `Load demo response`.
11. Click `Validate response`.
12. Click `Request preview`.

Expected result:

- The first-run flow stays inside the app and does not require the README for the
  sample walkthrough.
- Home help explains the start choice, task wording, and file check.
- Studio help explains packet handoff, pasted response, preview, and approval in
  short in-product terms.
- The sample walkthrough can reach preview review with `Load demo response`
  instead of relying on the README example JSON.

## Real-File Guided Entry Check

1. Return to Home.
2. Choose `Use my own file`.
3. Open `Show help`.
4. Pick a quick-start template such as `Rename columns` or `Change data types`.
5. Replace the file path with a real workbook path and run `Check this file`.

Expected result:

- The form still uses plain-language labels and helper copy.
- The template and help surfaces explain the next action without exposing low-level
  workflow jargon.
- Safe defaults remain visible before the session is created.

## Command Checks

Run these repository checks after the walkthrough:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq empty .taskmaster/tasks/tasks.json
git diff --check
```
