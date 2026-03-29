# Non-Engineer Follow-Up Verification

This checklist covers the post-MVP usability follow-up shipped through Task Master tasks `11` to `16`.

## Startup and Trust

1. Launch the desktop app and confirm Home shows the first-run choice between `Try the sample flow` and `Use my own file`.
2. Confirm Home keeps a visible `File safety` note that says the original workbook stays read-only and Relay Agent writes a separate copy.
3. If startup storage is unavailable, confirm Home shows `problem`, `reason`, and `next steps`, plus `Retry startup checks`, `Continue in temporary mode`, and `Copy startup details`.

## Guided Start and Continuity

1. Choose either sample or custom start and confirm the create-session form uses plain-language labels.
2. Use `Check this file` and confirm file-readiness guidance appears before session creation.
3. Create a session, open Studio, enter draft content, then reload or close the app unexpectedly.
4. Reopen Home and confirm the recovery prompt and recent work list both appear.

## Review and Save

1. In Studio, confirm the timeline shows `Prepare request`, `Bring back Copilot response`, and `Review and save`.
2. Validate a response and confirm the review pane surfaces `What will change`, `How many rows`, and `Where the new copy goes`.
3. Complete review and save, then confirm the action path changes to `Check changes`, `Confirm review`, and `Save reviewed copy`.
4. After save completes, confirm `Copy review summary`, `Open reviewer view`, and `Return Home` are available.
5. Return to Home and confirm the saved run appears under `Recent saves` with summary, timestamp, source path, and output path.

## Reviewer Mode and Recovery Prompts

1. Open a recent save from Home and confirm Studio opens in `Read-only review mode`.
2. Confirm reviewer mode hides editing, Copilot handoff, and save controls while still showing summary, output path, warnings, and completion actions.
3. Trigger a validation, preview, or save failure and confirm Studio shows plain-language `problem`, `reason`, and `next steps`.
4. Confirm each failure state exposes a copyable `Copilot follow-up prompt`.

## Accessibility Baseline

1. Tab through Home and Studio and confirm focus outlines stay visible on cards, form fields, buttons, and reviewer links.
2. Confirm active timeline steps and selected turns expose non-color cues through text plus `aria-current`.
3. Confirm form controls use readable default text sizing and that status messages are announced through `aria-live`.
