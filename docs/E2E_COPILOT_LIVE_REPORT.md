# Copilot Live Integration E2E Test Report

Test date: 2026-04-02
Executor: Codex (Windows)
App version: `relay-agent-desktop 0.1.2`
Tauri environment: `tauri 2.10.3`, `@tauri-apps/cli 2.10.1`, `WebView2 146.0.3856.84`
Edge version: `146.0.3856.84`
M365 Copilot: logged-in session confirmed on the primary Edge profile

---

## Preparation

Commands executed:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm -C apps/desktop exec tauri info
pnpm -C apps/desktop copilot-browser:build
```

Observed result:

- `pnpm typecheck`: passed
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: passed (`104 passed`)
- `pnpm -C apps/desktop exec tauri info`: passed
- `pnpm -C apps/desktop copilot-browser:build`: passed
- Test data prepared under `C:\relay-test\`: `data_a.csv`, `data_b.csv`, `data_c.csv`, `empty.csv`, `pii_test.csv`

Additional live probes:

- Manual Edge launch with full path and `--remote-debugging-port=9333` succeeded
- `http://127.0.0.1:9333/json/version` responded correctly
- CDP page probe confirmed `https://m365.cloud.microsoft/chat` with prompt editor and send button present
- Direct Playwright send probe returned `CDP connection works`

---

## Phase A: CDP Connection and Browser Automation Base

### A-1 Edge auto-launch + CDP connect
- Status: `[x]`
- Notes:
  - Command: `node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch --cdp-port 9333 --timeout 60000`
  - Result: `{"status":"ready","cdpPort":9333}`
  - Progress output showed `既存の Edge に接続中（ポート 9333）…` followed by `接続しました`
  - The Windows Edge path resolution fix removed the previous `spawn msedge.exe ENOENT` failure
  - Limitation: this verification reused the existing live Edge session on `9333`; it did not prove a fresh Edge launch from a fully closed state

### A-2 Manual CDP connect
- Status: `[x]`
- Notes:
  - Edge was launched via `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --remote-debugging-port=9333 https://m365.cloud.microsoft/chat/`
  - `connect --cdp-port 9333` returned `{"status":"ready","cdpPort":9333}`
  - `json/version` endpoint returned a valid `webSocketDebuggerUrl`
  - Page probe confirmed editor, send button, and M365 Copilot page title

### A-3 CDP unavailable handling
- Status: `[x]`
- Notes:
  - Command: `connect --cdp-port 9342`
  - Result: `CDP_UNAVAILABLE`
  - Detail: connection to an unused port failed as expected

### A-4 Not-logged-in handling
- Status: `[x]`
- Notes:
  - Fresh profile probe used port `9334` with `--user-data-dir=C:\relay-test\edge-fresh`
  - After the follow-up fix, `connect --cdp-port 9334` and `send --cdp-port 9334` both returned `NOT_LOGGED_IN`
  - The upgrade / upsell page is no longer treated as a usable Copilot chat state

---

## Phase B: Guided Mode Main Flow

### B-1 Step 1 setup
- Status: `[x]`
- Notes:
  - Executed through the packaged Tauri app via WebDriver with an isolated app-local-data directory
  - Manual mode was selected
  - `C:\relay-test\data_a.csv` was entered successfully
  - The objective `approved が true の行だけ残してください` was entered successfully
  - Step 1 completion enabled the Step 2 auto-send action

### B-2 Step 2 Copilot confirmation
- Status: `[x]`
- Notes:
  - Executed through the packaged Tauri app using the `Copilotに自動送信` action
  - The response textarea was populated automatically
  - Observed response:
    - `version: 1.0`
    - `status: ready_to_write`
    - `table.filter_rows` with predicate `[approved] == true`
    - `workbook.save_copy` with output path `C:/relay-test/data_a.copy.csv`

### B-3 Step 2 invalid JSON handling
- Status: `[x]`
- Notes:
  - Executed in the packaged Tauri app by pasting `{\"invalid\": true}` into the Copilot response field
  - Relay Agent showed a validation card and did not advance to Step 3
  - Observed validation feedback included:
    - missing required fields
    - `version / summary / actions を含めてください`
    - `actions は配列で返してください`
  - No enabled save button was present while the invalid response was shown

### B-4 Step 3 preview and approve
- Status: `[x]`
- Notes:
  - Executed through the packaged Tauri app after a valid live Copilot response
  - Review and save completed successfully
  - Completion screen showed `保存しました: C:/relay-test/data_a.copy.csv`
  - Output file was created at `C:\relay-test\data_a.copy.csv`
  - Output preview confirmed only rows with `approved=true` remained

---

## Phase C: Auto Send Flow

### C-1 Auto-send happy path
- Status: `[x]`
- Notes:
  - Executed through the packaged Tauri app via WebDriver with isolated app-local-data state
  - Manual mode was kept on, `autoLaunchEdge=false`, `cdpPort=9333`, and `timeoutMs=60000`
  - The in-app `Copilotに自動送信 ▶` button showed `Copilot に送信中…`
  - The Copilot response field was populated automatically with a valid Relay Packet JSON response
  - Observed response matched the live guided-flow path:
    - `status: ready_to_write`
    - `table.filter_rows` with `[approved] == true`
    - `workbook.save_copy` to `C:/relay-test/data_a.copy.csv`

### C-2 Auto-send timeout
- Status: `[ ]`
- Notes:
  - Executed through the packaged Tauri app with controlled timeout reductions
  - With `timeoutMs=1000`, the app surfaced `Edge の CDP 接続を確認できませんでした。` instead of a Copilot response-timeout error
  - With `timeoutMs=5000`, the response textarea was partially filled (about `211` chars) but the app did not surface a timeout error card or friendly timeout message
  - Result: in-app auto-send timeout handling is still not reliable enough to count as passing

### C-3 Copilot error response
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: no controlled Copilot error prompt was run through the app

---

## Phase D: Delegation Mode Agent Loop

### D-1 Planned agent loop
- Status: `[ ]`
- Notes:
  - Executed in the packaged Tauri app with isolated app-local-data state and the live Copilot session on `9333`
  - Relay Agent accepted the delegation goal after a seeded recent-file context and produced a four-step plan:
    - structure / sample inspection
    - `approved=true` filtering
    - `workbook.save_copy`
  - The plan review UI rendered correctly with editable steps and visible `計画を承認する / 再計画する / キャンセル` controls
  - Blocker: approving the visible plan did not advance the app into execution or write-approval state in this packaged-app/WebDriver path
  - Result: planning proposal works, but the planned delegation execution loop is not yet passing end to end

### D-2 No-planning agent loop
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: same as D-1

### D-3 Agent loop cancellation
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: same as D-1

---

## Phase E: Pipeline + Copilot

### E-1 Two-step pipeline happy path
- Status: `[ ]`
- Notes:
  - Executed in the packaged Tauri app through WebDriver with an isolated `RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR`
  - The pipeline workbench accepted a title, input path, and two step goals; the start button became enabled
  - Clicking `実行開始` did not change `PipelineProgress`, create any `data_a.pipeline-step-*.csv` output, or surface a user-visible error
  - Result: the current packaged-app pipeline start path is a no-op under this UI-driven flow

### E-2 Pipeline error handling
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: E-1 never advanced into a running pipeline, so a step-failure scenario could not be reached

### E-3 Pipeline cancellation during Copilot interaction
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: same as E-1

---

## Phase F: Batch + Copilot

### F-1 Three-file batch happy path
- Status: `[ ]`
- Notes:
  - Executed in the packaged Tauri app through WebDriver with three target files: `data_a.csv`, `empty.csv`, and `data_c.csv`
  - The batch goal field accepted input, but the hidden file input did not populate any target cards in the UI
  - `バッチ進行ダッシュボード` stayed at `まだジョブがありません。`, and `C:\relay-test\relay-batch-output` was never created
  - Result: the current packaged-app batch file-selection path is not automatable through this WebDriver flow

### F-2 Batch partial failure
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: F-1 never produced an in-app batch target list, so a partial-failure scenario could not be reached

### F-3 Batch cancellation during Copilot interaction
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: same as F-1

---

## Phase G: Template Library + Copilot

### G-1 Load template and run with Copilot
- Status: `[ ]`
- Notes:
  - Executed in Delegation mode through the packaged Tauri app
  - Selecting the built-in `売上データフィルタ` template successfully switched the automation workbench from `テンプレート` to `パイプライン`
  - The scenario still could not reach a Copilot-backed execution because the downstream pipeline start path stayed blocked as in E-1
  - Result: template selection works, but the template-to-execution flow does not complete end to end

### G-2 Save and reuse custom template
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: G-1 never reached a completed template-backed execution, so no custom template could be saved and reused

---

## Phase H: Smart Approval Gate

### H-1 Read-only mode
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: requires in-app approval policy switching plus execution

### H-2 Standard mode
- Status: `[x]`
- Notes:
  - Executed in the packaged Tauri app with isolated app-local-data state
  - `approvalPolicy=standard` was selected in settings before response validation
  - A valid `table.filter_rows + workbook.save_copy` response was pasted into the Copilot response field and validated
  - Relay Agent advanced to Step 3 and showed a visible `保存する` approval gate
  - No completion screen appeared and no output file was written before manual approval
  - Result: `standard` correctly kept this write flow behind explicit approval

### H-3 Fast mode
- Status: `[ ]`
- Notes:
  - Executed in the packaged Tauri app after selecting `approvalPolicy=fast`
  - The same medium-risk response (`table.filter_rows + workbook.save_copy`) was pasted and validated
  - Expected result from `apps/desktop/src-tauri/src/risk_evaluator.rs`: `fast` auto-approves up to `Medium`
  - Actual result: Relay Agent still showed the Step 3 `保存する` approval gate, no completion screen appeared, and no output file was written
  - Result: `fast` auto-approval did not activate for this scenario

### H-4 Policy persistence after restart
- Status: `[ ]`
- Notes:
  - Executed with the same isolated app-local-data directory across two packaged-app launches
  - First run: settings value was changed to `fast`
  - Second run: reopening settings showed `approvalPolicy=safe`
  - Result: approval policy did not persist across restart in this packaged-app path

---

## Phase I: PII Detection

### I-1 PII handoff detection
- Status: `[ ]`
- Notes:
  - Executed in Manual mode with `C:\relay-test\pii_test.csv` containing `name,email,phone,amount`
  - Step 1 completed and advanced into `2. Copilot に聞く`
  - No warning banner, friendly error, or caution text was surfaced before copy even though the workbook and objective clearly referenced direct identifiers
  - Result: no visible PII handoff warning was shown in this user-facing flow

---

## Phase J: Regression Sweep

### J-1 Cross-feature basic flow
- Status: `[~]`
- Notes:
  - Not executed
  - Reason: full cross-feature manual walkthrough was not run

### J-2 Session recovery
- Status: `[ ]`
- Notes:
  - Executed with the same isolated app-local-data directory across two packaged-app launches
  - First run: Manual mode Step 1 completed and advanced to `2. Copilot`
  - The app was then terminated and relaunched with the same `RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR`
  - Second run: the startup view still showed `最近のファイル / まだ履歴がありません。`, no recent-session toggle appeared, and no prior session details were restored
  - Result: session/recent recovery did not surface in this packaged-app restart path

### J-3 Project memory persistence
- Status: `[x]`
- Notes:
  - Executed with a new project `Memory Test` rooted at `C:/relay-test`
  - Added project memory entry `delimiter = comma`, then relaunched the app with the same isolated app-local-data directory
  - After restart, the project option still existed and selecting it showed the persisted `delimiter / comma` memory entry
  - Result: project memory persistence worked in this packaged-app restart path

---

## Summary Table

| Phase | Scenario | Result | Memo |
|-------|----------|--------|------|
| A-1 | Edge auto-launch + CDP connect | Pass | `connect --auto-launch` now returns `ready`; verified by attaching to the existing Edge session on `9333` |
| A-2 | Manual CDP connect | Pass | Live M365 Copilot page, editor, send button confirmed |
| A-3 | CDP unavailable handling | Pass | Unused port returned `CDP_UNAVAILABLE` |
| A-4 | Not-logged-in handling | Pass | Upgrade / upsell state now returns `NOT_LOGGED_IN` instead of false `ready` |
| B-1 | Guided step 1 setup | Pass | Packaged app accepted `C:\\relay-test\\data_a.csv` and enabled Step 2 |
| B-2 | Guided Copilot confirmation | Pass | Live Copilot response populated valid JSON in-app |
| B-3 | Guided invalid JSON handling | Pass | Validation card blocked unsafe progression |
| B-4 | Preview and approve | Pass | Save-copy output was written and verified |
| C-1 | Auto-send happy path | Pass | In-app auto-send populated a valid response through the live `9333` Copilot session |
| C-2 | Auto-send timeout | Fail | Short timeouts did not produce stable in-app timeout handling |
| C-3 | Copilot error response | Skip | In-app auto-send flow not executed |
| D-1 | Planned agent loop | Fail | Plan proposal rendered, but approving the plan did not advance into execution |
| D-2 | No-planning agent loop | Skip | In-app delegation flow not executed |
| D-3 | Agent loop cancellation | Skip | In-app delegation flow not executed |
| E-1 | Pipeline happy path | Fail | Pipeline inputs were accepted, but `実行開始` was a no-op: no progress update, no outputs, no error |
| E-2 | Pipeline error handling | Skip | E-1 never entered a running pipeline, so the failure path could not be exercised |
| E-3 | Pipeline cancellation | Skip | In-app pipeline flow not executed |
| F-1 | Batch happy path | Fail | Batch goal entry worked, but file selection never populated targets or created any output directory |
| F-2 | Batch partial failure | Skip | F-1 never produced a runnable batch target list |
| F-3 | Batch cancellation | Skip | In-app batch flow not executed |
| G-1 | Template load and run | Fail | Built-in template selection worked, but the template-backed run was blocked by the same pipeline no-op as E-1 |
| G-2 | Custom template reuse | Skip | In-app template flow not executed |
| H-1 | Read-only mode | Skip | Read-only approval scenario not yet executed |
| H-2 | Standard mode | Pass | Manual approval gate remained visible and no output was written before approval |
| H-3 | Fast mode | Fail | `fast` still required manual save approval for a medium-risk write flow |
| H-4 | Policy persistence | Fail | Policy reverted from `fast` to `safe` after restart |
| I-1 | PII detection | Fail | `pii_test.csv` reached Step 2 with no visible warning despite `name/email/phone` identifiers |
| J-1 | Cross-feature basic flow | Skip | Final regression sweep not executed |
| J-2 | Session recovery | Fail | Restarted packaged app showed no recent sessions/files and did not restore the prior in-progress session |
| J-3 | Project memory persistence | Pass | Project `Memory Test` and `delimiter = comma` memory entry persisted across restart |

---

## Findings Summary

- Total scenarios: `30`
- Passed: `11`
- Failed: `9`
- Skipped: `10`

Key findings:

- Live M365 Copilot connectivity now works through direct probes, the packaged guided flow, and the in-app auto-send path.
- The Windows auto-launch regression caused by `msedge.exe` path resolution is fixed well enough for `connect --auto-launch` to return `ready` on this machine.
- Guided mode happy-path execution still works end to end for the tested `approved == true` flow, including save-copy output creation.
- Standard approval mode behaves as expected for the tested write response: the preview is prepared, but execution stays blocked until explicit approval.
- Delegation planning now reaches a concrete proposed plan in-app, but the visible approval control did not transition into execution under packaged-app automation.
- The automation workbench has multiple packaged-app blockers:
  - Pipeline start accepted inputs but did not launch any run or surface an error.
  - Batch file selection did not populate any targets through the current WebDriver path.
  - Template selection works, but the end-to-end template execution is blocked by the same pipeline start failure.
- Two approval-policy issues remain:
  - `fast` did not auto-approve a medium-risk `workbook.save_copy` flow even though `risk_evaluator.rs` says it should.
  - Approval policy did not persist across restart in the packaged-app path.
- In-app auto-send timeout behavior is still inconsistent and needs its own fix before C-2 can pass.
- PII handoff assessment is not visibly surfaced in the tested Manual flow: a file containing `name/email/phone` advanced to Step 2 without any user-facing warning.
- Session continuity is still broken in the tested packaged-app restart path: no recent session or file history reappeared after relaunch.
- Project-scoped memory persistence does work across restart, which narrows the restart problem to session/continuity state rather than all local persistence.

Next actions:

1. Fix the packaged-app pipeline workbench so `実行開始` actually launches a run or surfaces a concrete error.
2. Fix batch target selection under the packaged-app WebDriver path so the file list and dashboard can be exercised.
3. Surface visible PII handoff warnings in Manual mode before the user copies a relay packet into Copilot.
4. Restore session continuity across packaged-app restarts, then resume the remaining delegation / pipeline / batch / template regression scenarios.
