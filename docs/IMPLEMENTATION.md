# Relay_Agent Implementation Log

## Status

- Current phase: the browser automation, agent loop, CDP auto-launch, and autonomous-planning slices through plan approval, plan execution UI, persistence, and settings are implemented in source; **M365 Copilot CDP smoke** (`m365-cdp-chat`) was verified on 2026-04-08 against a live signed-in Edge/Chromium endpoint (see Milestone Log). The **Tauri desktop + CSV + full checklist** items in `docs/*_E2E_VERIFICATION.md` remain manual or environment-specific.
- Repository state: pnpm workspace, SvelteKit SPA shell, Tauri v2 shell, and shared contracts package are now bootstrapped and verification-clean
- Active source-of-truth documents:
  - `PLANS.md`
  - `AGENTS.md`
  - `docs/IMPLEMENTATION.md`
  - `.taskmaster/docs/repo_audit.md`
- Follow-up planning input: `.taskmaster/docs/prd.txt` now acts as the integrated PRD for the UI, browser automation, agent loop, CDP auto-launch, and autonomous-planning follow-ups, while the earlier simplification, startup, launch, workflow, artifact-browser, turn-lifecycle, and signing references remain preserved under `.taskmaster/docs/archive/`
- Follow-up task graph: `.taskmaster/tasks/tasks.json` now covers the completed guided-flow work, the browser automation follow-up (`76` through `83`), the agent-loop follow-up (`84` through `95`), the CDP auto-launch follow-up (`104` through `108`), and the autonomous-planning follow-up (`109` through `123`), with implementation-backed work closed where artifacts exist and manual Windows/M365 verification left pending
- Follow-up packaging policy: `docs/PACKAGING_POLICY.md` now fixes the first packaged end-user release path to Windows 10/11 x64 via NSIS, with manual installer-driven updates and preserved app-local storage across upgrades as the current expectation
- Follow-up implementation status: browser automation source, multi-turn agent-loop source, CDP auto-launch source, and the autonomous execution flow through plan approval, progress tracking, write-step gating, persistence, replan, and settings are in place. Task `84` is backed by `docs/AGENT_LOOP_DESIGN.md`, task `109` is backed by `docs/AUTONOMOUS_EXECUTION_DESIGN.md`, and task `123` is now backed by `docs/AUTONOMOUS_EXECUTION_E2E_VERIFICATION.md` as the remaining manual checklist. **Recorded 2026-04-08:** Playwright `m365-cdp-chat` (six tests, serial) passed against a live CDP endpoint (当時 **9333**; リポ既定は後述のとおり **9360** へ移行) with an existing `m365.cloud.microsoft/chat` tab (Japanese UI). Remaining gap: full desktop-app E2E checklists and Windows-specific packaging walks unless run separately.

## Milestone Log

### 2026-04-09 CDP prompt: same-turn tools (stop “restate task” meta stall)

**Problem:** For concrete user turns (paths plus verbs like improve/edit/fix), M365 Copilot sometimes answered with protocol checklists or “I will follow the rules” prose and asked for a “next concrete step” **without** emitting `relay_tool` / `read_file` in **that** reply. The host parsed **zero** tools and the agent loop stalled despite an already-specific request.

**Fix:** [`agent_loop.rs`](../apps/desktop/src-tauri/src/agent_loop.rs) — `CDP_RELAY_RUNTIME_CATALOG_LEAD` adds **Action in the same turn** (paths + action → fences now, usually `read_file` first; do not ask to restate) and **No meta-only stall** (host needs parsed fences, not compliance-only replies). `cdp_tool_catalog_section` adds **Do not defer concrete requests**. `CDP_FILE_DELIVERY_USER_MESSAGE` (English + Japanese) tells the model to run tools in this reply when paths and task are already in the bundle. Default `build_desktop_system_prompt` **Constraints** require tools in the **first** response when the request is concrete. `catalog_lists_builtin_tools_and_protocol` asserts stable substrings for the new guidance.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*メタ応答で停滞*).

**Verification:** `cargo test -p relay-agent-desktop cdp_copilot_tool`; `cargo check -p relay-agent-desktop` — pass (2026-04-09).

### 2026-04-09 CDP prompt: Relay runtime identity (stop false `relay_tool` refusals)

**Problem:** M365 Copilot sometimes replied that it could not act as Relay Agent or that `relay_tool` blocks do not execute “in this Copilot environment,” contradicting the desktop host which parses the model reply and runs tools.

**Fix:** [`agent_loop.rs`](../apps/desktop/src-tauri/src/agent_loop.rs) — `CDP_RELAY_RUNTIME_CATALOG_LEAD` prepended to `cdp_tool_catalog_section` (CDP session, Relay host parses fences, do not claim tools unavailable); `CDP_FILE_DELIVERY_USER_MESSAGE` states fenced JSON is executed by Relay; default `build_desktop_system_prompt` reminds not to refuse tool fences as “browser Copilot can’t run tools.”

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*Relay デスクトップ: Copilot 応答とツール実行*).

**Verification:** `cargo test -p relay-agent-desktop cdp_copilot_tool` — pass (2026-04-09).

### 2026-04-09 Copilot / Edge: faster cold start (Windows skips port=0, shorter polls, optional netstat)

**Problem:** App startup could spend ~30s in `pollForExistingDedicatedCdp`, ~45s waiting on CDP for a `DevToolsActivePort` after `--remote-debugging-port=0` before fixed-port Edge succeeded quickly; HTTP reclaim always ran a full Windows `netstat` pass after PowerShell.

**Fix:** [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) — on **win32**, skip `tryDedicatedLaunchPortZero` unless **`RELAY_COPILOT_TRY_PORT_ZERO=1`**; **`RELAY_EXISTING_CDP_WAIT_MS`** (default 10s Win / 30s else, clamp 1–120s); **`waitUntilDedicatedCdpResponds(..., timeoutMs)`** with **`RELAY_EDGE_PORT0_CDP_WAIT_MS`** (default 12s, 2–120s) when port=0 is used; fixed-port path keeps 45s. [`copilot_port_reclaim.rs`](../apps/desktop/src-tauri/src/copilot_port_reclaim.rs) — **`RELAY_COPILOT_RECLAIM_NETSTAT=1`** gates the `netstat`/`taskkill` fallback (default off).

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md); [`README.md`](../README.md) Environment (Copilot).

**Verification:** `node --check` on `copilot_server.js`; `cargo check -p relay-agent-desktop` — pass (2026-04-09).

### 2026-04-09 CDP agent loop: parse `relay_tool` fallbacks (`json` fences, unfenced tool JSON)

**Problem:** M365 Copilot often answered with prose plus tool JSON in **` ```json `** or “Plain Text” blocks, or bare `{"name":"read_file","input":{…}}`, instead of **` ```relay_tool `**. The host only parsed `relay_tool`, so **no `ToolUse` events** were emitted and `ConversationRuntime::run_turn` stopped after one assistant message without running tools.

**Fix:** [`agent_loop.rs`](../apps/desktop/src-tauri/src/agent_loop.rs) — `parse_copilot_tool_response`: after the primary `relay_tool` pass, if there are no calls, **`extract_fallback_markdown_fences`** (generic Markdown fences with valid JSON bodies) then **`extract_unfenced_tool_json_candidates`** (bounded `{"name":…}` scan). Fallback calls are **whitelist-filtered** to `tools::mvp_tool_specs()` names only. **`cdp_tool_catalog_section`** documents that prose-only descriptions do not execute tools and that ` ```json ` is accepted.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*Relay デスクトップ: Copilot 応答とツール実行*).

**Verification:** `cargo test -p relay-agent-desktop cdp_copilot_tool` — pass (2026-04-09).

### 2026-04-09 Copilot Edge: kill abandoned port=0 instance before fixed-port fallback

**Problem:** After `tryDedicatedLaunchPortZero`, CDP on `DevToolsActivePort` sometimes never became ready; `launchDedicatedFixedPortScan` then spawned a second `msedge` with the same profile and `COPILOT_URL`, leaving two Copilot tabs/windows. The first spawn used detached `unref()` so nothing terminated it.

**Fix:** [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) — `spawnEdgeForDedicated` / `spawnEdgeDetached` optional `retainChild` for `dedicated-port0`; on fallback failure `terminateEdgeProcessTree` (Windows `taskkill /F /T`, Unix SIGTERM then SIGKILL); success path `child.unref()`. With `RELAY_COPILOT_WIN32_CMD_START=1`, port=0 trial skips cmd start so the child PID stays known.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*Relay デスクトップ: Edge が二重に開く*).

**Verification:** `node --check` on `copilot_server.js` — pass (2026-04-09).

### 2026-04-09 Copilot HTTP port: reclaim stale `copilot_server` listeners

**Problem:** A stray `node copilot_server.js` left on `127.0.0.1:18080` (or the next fallback ports) made `/health` return an old `bootToken` while a newly spawned child failed `listen` with **EADDRINUSE**, forcing the desktop to walk ports (e.g. 18080→18081→18082).

**Fix:** [`copilot_port_reclaim.rs`](../apps/desktop/src-tauri/src/copilot_port_reclaim.rs) — before each spawn, `GET /health` with a short timeout; if `status` is `ok` but `bootToken` is missing or not the session token, kill the listener on that port (Windows: `Get-NetTCPConnection` + `Stop-Process`, fallback `netstat`/`taskkill`; Unix: `fuser -k` or `lsof` + `kill -9`). **`RELAY_COPILOT_RECLAIM_STALE_HTTP=0`** disables reclaim. [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) logs a one-line **EADDRINUSE** hint. Wired from [`copilot_server.rs`](../apps/desktop/src-tauri/src/copilot_server.rs) `CopilotServer::start`.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*Relay デスクトップ* section).

**Verification:** `cargo check -p relay-agent-desktop`; `node --check` on `copilot_server.js` — pass (2026-04-09).

### 2026-04-09 Windows Copilot bridge: CDP probe + no site-isolation flag

**Problem:** With Edge already running, `ensureEdge` could wait 30s then spawn `remote-debugging-port=0`, leaving CDP stuck; Edge warned that `--disable-site-isolation-trials` is unsupported on Windows. Stray Node on HTTP 18080 caused `EADDRINUSE` and bootToken mismatch.

**Fix:** [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) — `RELAY_CDP_PROBE_TIMEOUT_MS` override; longer default probe on `win32`; `cdpDedicatedRelayProfileCdpOk` + `tryReuseDevtoolsPortBeforePortZero` before port-0 spawn; `--disable-site-isolation-trials` only on Linux in `relayEdgeChromiumHardeningArgv`. [`cdp_copilot.rs`](../apps/desktop/src-tauri/src/cdp_copilot.rs) — same site-isolation rule for `launch_dedicated_edge`.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md).

**Verification:** `node --check` on `copilot_server.js`; `cargo check -p relay-agent-desktop` — pass (2026-04-09).

### 2026-04-09 Copilot CDP: background Edge env + Win32 nudge opt-in

**Problem:** Each prompt could raise Microsoft Edge to the foreground (`Page.bringToFront` / `Target.activateTarget` in Node; Rust `send_prompt`; Windows reuse-path nudge via `cmd /c start` on every `connect` when marker reuse hit).

**Fix:** [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) — `RELAY_COPILOT_NO_WINDOW_FOCUS=1` skips `Target.activateTarget` / `Page.bringToFront`; Win32 nudge runs only when `RELAY_COPILOT_NUDGE_EDGE=1` (default off). [`cdp_copilot.rs`](../apps/desktop/src-tauri/src/cdp_copilot.rs) — same env gates `Page.bringToFront` in `send_prompt`.

**Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) (*Relay デスクトップ* section).

**Verification:** `node --check` on `copilot_server.js`; `cargo check -p relay-agent-desktop` — pass (2026-04-09).

### 2026-04-09 Edge duplicate window: wait before second launch

**Problem:** Two Edge windows (Copilot + blank) when the same `RelayAgentEdgeProfile` was reused — a race where `DevToolsActivePort` existed but CDP was not yet responding caused an extra `msedge` spawn (Rust `connect_copilot_page` and/or Node `ensureEdgeDedicated`). Rust also used `about:blank` for auto-launched Edge.

**Fix:** [`cdp_copilot.rs`](../apps/desktop/src-tauri/src/cdp_copilot.rs) — poll `wait_for_cdp_ready` up to 30s on the profile port before `launch_dedicated_edge`; initial tab uses `https://m365.cloud.microsoft/chat/`. [`copilot_server.js`](../apps/desktop/src-tauri/binaries/copilot_server.js) — `pollForExistingDedicatedCdp` after a failed immediate probe; Win32 nudge no longer falls back to `spawnEdgeForDedicated`. **Doc:** [`docs/COPILOT_E2E_CDP_PITFALLS.md`](COPILOT_E2E_CDP_PITFALLS.md) section *Relay デスクトップ: Edge が二重に開く*.

**Verification:** `cargo check -p relay-agent-desktop`; `node --check` on `copilot_server.js` — pass (2026-04-09).

### 2026-04-09 Composer keyboard: Enter newline, Ctrl+Enter send

**Goal:** Make multi-line prompts easy in the Solid composer: **Enter** inserts a newline; **Ctrl+Enter** sends (and **⌘+Enter** on macOS via `metaKey`). Plain **Enter** no longer submits (previous behavior was Enter send / Shift+Enter newline).

**Artifacts:** [`Composer.tsx`](../apps/desktop/src/components/Composer.tsx) (`onKeyDown`); inline hint `⌘/Ctrl+Enter to send · Enter for new line`. Playwright: [`app.e2e.spec.ts`](../apps/desktop/tests/app.e2e.spec.ts) and [`e2e-comprehensive.spec.ts`](../apps/desktop/tests/e2e-comprehensive.spec.ts) use `Control+Enter` for send; `sendPrompt` and related assertions scope user bubbles to `getByRole("main")` so session-list labels do not trip strict-mode duplicate matches.

**Verification:** From `apps/desktop/`, `E2E_SKIP_AUTH_SETUP=1 pnpm exec playwright test app.e2e.spec.ts e2e-comprehensive.spec.ts` — pass (2026-04-09).

### 2026-04-09 Desktop startup: main window after Copilot warmup (no always-on-top)

**Goal:** Stop pinning the main window with `set_always_on_top(true)`; start with the window hidden until `warmupCopilotBridge` finishes (Edge/Copilot cold start), then `show` + `setFocus` so the Relay UI typically ends in front without staying above all other apps.

**Artifacts:** [`apps/desktop/src-tauri/tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json) (`visible: false` on `main`); [`apps/desktop/src-tauri/src/lib.rs`](../apps/desktop/src-tauri/src/lib.rs) (removed always-on-top setup); [`apps/desktop/src-tauri/capabilities/default.json`](../apps/desktop/src-tauri/capabilities/default.json) (`core:window:allow-show`, `core:window:allow-set-focus`); [`apps/desktop/src/shell/Shell.tsx`](../apps/desktop/src/shell/Shell.tsx) (`getCurrentWindow().show()` / `setFocus()` in `warmupCopilotBridge` `finally` when `isTauri()`).

**Verification:** `pnpm exec tsc --noEmit` and `cargo check` from `apps/desktop/` and `apps/desktop/src-tauri/` respectively — pass (2026-04-09). Full `tauri dev` UI smoke is environment-specific (Wayland focus policies may vary).

### 2026-04-09 Tool hard denylist (bash + sensitive file paths)

**Goal:** Block a fixed set of high-risk shell commands **regardless of** `.claw` permission mode, and block `read_file` / `write_file` / `edit_file` (plus PDF merge/split outputs and `NotebookEdit` targets) for secret-like filenames.

**Rust:** [`crates/runtime/src/tool_hard_denylist.rs`](../apps/desktop/src-tauri/crates/runtime/src/tool_hard_denylist.rs) — `validate_bash_hard_deny` (called from [`bash.rs`](../apps/desktop/src-tauri/crates/runtime/src/bash.rs) before read-only validation) and `reject_sensitive_file_path` (called from [`file_ops.rs`](../apps/desktop/src-tauri/crates/runtime/src/file_ops.rs)). **Bash rules include:** any `sudo`; `rmdir`; `rm` with destructive short flags (`-r`/`-R`/`-f`/`rf`/etc.) or `--recursive`/`--force`; `find` with `-delete` or `-exec rm`; `xargs` … `rm`; `git config` / `git push` / `git commit` / `git reset` / `git rebase`; `brew install`; `chmod` with token `777`. **Path rules (case-insensitive basename/extension):** names starting with `.env` or `id_rsa`; extensions `.key` / `.pem`. **Tools crate:** [`tools/src/lib.rs`](../apps/desktop/src-tauri/crates/tools/src/lib.rs) applies the same path check to `pdf_merge` output, `pdf_split` segment outputs, and `NotebookEdit` notebook path.

**Not in scope:** Windows `PowerShell` tool does not yet mirror this list (documented here for operators).

**Verification:** `cargo test -p runtime --lib`, `cargo test -p tools --lib`, `cargo test -p compat-harness --lib` from `apps/desktop/src-tauri/` — pass (2026-04-09).

### 2026-04-09 Copilot warmup: nested Tokio runtime panic (Windows / Tauri worker)

**Problem:** The async Tauri command **`warmup_copilot_bridge`** called **`ensure_copilot_server()`** on the **Tokio async worker** before **`spawn_blocking`**. **`ensure_copilot_server`** builds a temporary **`current_thread`** runtime and uses **`block_on`** for **`CopilotServer::start`** and **`health_check`**. Running that from inside another runtime’s worker thread triggers Tokio’s panic: *“Cannot start a runtime from within a runtime”* (seen on Windows when the shell mounts and prewarms the bridge).

**Fix:** Run **`ensure_copilot_server`** and the **`warmup_status`** **`block_on`** entirely inside **`tokio::task::spawn_blocking`**, so nested runtimes are created only on the **blocking thread pool**. **`run_agent_loop_impl`** already invoked **`ensure_copilot_server`** from **`spawn_blocking`** and did not need a change.

**Artifacts:** [`apps/desktop/src-tauri/src/tauri_bridge.rs`](../apps/desktop/src-tauri/src/tauri_bridge.rs) (`warmup_copilot_bridge`).

**Verification:** `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass.

### 2026-04-09 Copilot reply capture + assistant markdown UI

**Problem:** M365 DOM `innerText` often appends streaming placeholders (e.g. Japanese **「応答を生成しています」**) while the Stop-button heuristic still reports idle, so [`waitForDomResponse`](apps/desktop/src-tauri/binaries/copilot_server.js) could settle early and return truncated prose. The shell showed Copilot markdown as plain text (`**` literals).

**Node bridge:** Added [`replyEndsWithStreamingPlaceholder`](apps/desktop/src-tauri/binaries/copilot_server.js) / [`stripStreamingPlaceholderTail`](apps/desktop/src-tauri/binaries/copilot_server.js) (locale-aware last-line tails). Completion uses `generating = streamingPlaceholderTail || (generatingRaw && !ignorePhantomStop)`; [`lengthOkForDone`](apps/desktop/src-tauri/binaries/copilot_server.js) requires `!streamingPlaceholderTail`; post-stable path refuses candidates that still end with a placeholder. [`wire`](apps/desktop/src-tauri/binaries/copilot_server.js) and [`resolveAssistantReplyForReturn`](apps/desktop/src-tauri/binaries/copilot_server.js) strip tails before/after network merge.

**Desktop UI:** [`assistant-markdown.ts`](apps/desktop/src/lib/assistant-markdown.ts) — `marked` (GFM + breaks) + `DOMPurify` whitelist; [`MessageBubble.tsx`](apps/desktop/src/components/MessageBubble.tsx) renders **assistant** bubbles as sanitized HTML, user bubbles unchanged. Styles in [`index.css`](apps/desktop/src/index.css) (`.ra-md-assistant`).

**Verification:** `node --check` on `copilot_server.js`; `pnpm run typecheck` and `pnpm run build` in `apps/desktop/` — pass.

### 2026-04-09 Desktop UI: Cursor-inspired tokens (`DESIGN.md`)

**Source:** `npx getdesign@latest add cursor` → [`apps/desktop/DESIGN.md`](../apps/desktop/DESIGN.md) (see [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) / [getdesign.md Cursor](https://getdesign.md/cursor/design-md)).

**Implementation:** [`apps/desktop/src/index.css`](../apps/desktop/src/index.css) maps `--ra-*` to the Cursor palette. **Dark (default):** warm dark surfaces (`#131210`, `#1e1d1a`), cream-toned text (`#f2f1ed`), **Cursor Orange** accent `#f54e00`, `--ra-accent-gradient` for filled CTAs, semantic success `#1f8a65` and error `#cf2d56`, warm focus (no blue ring). **Light:** cream page/elevated surfaces (`#f2f1ed`, `#e6e5e0`, `#ebeae5`) and `rgba(38, 37, 30, …)` borders per the marketing-site extraction; modal shadows use the documented `oklab` ring where supported. **Typography:** system-ui / mono stacks per DESIGN.md fallbacks (proprietary display fonts not bundled).

**UI code:** `.ra-fill-accent` for gradient + white text on user bubbles, composer accent rows, and `.ra-button-primary` / `.ra-composer-send`. [`StatusBar.tsx`](../apps/desktop/src/components/StatusBar.tsx) Copilot hint uses `--ra-accent` for readability on light cream.

**Verification:** `npm run typecheck` and `npm run build` in `apps/desktop/` — pass (2026-04-09).

### 2026-04-09 Claw tool parity (MCP meta, AskUserQuestion, LSP diagnostics, Task*)

**MCP (claw-style names):** `ListMcpResources`, `ReadMcpResource`, `McpAuth`, and unified `MCP` (`action`: `list_resources`, `read_resource`, `list_tools`, `call_tool`) dispatch from `TauriToolExecutor` to the session `McpServerManager` (merged `.claw` stdio servers). `McpAuth` returns a JSON status payload (no in-tool browser OAuth).

**AskUserQuestion:** `execute_ask_user_question_tool` emits `agent:user_question`; IPC `respond_user_question` unblocks the tool. UI: `UserQuestionOverlay` + `shell/Shell.tsx` handler; cancel sends an empty answer and the tool errors (agent continues with that result).

**LSP:** `runtime::lsp_diagnostics` — stdio JSON-RPC to `rust-analyzer` for `textDocument/diagnostic` pull; `LSP` tool `action: diagnostics` with workspace path checks in `agent_loop`.

**Task*:** In-memory registry in `runtime::task_registry` (`TaskCreate` / `Get` / `List` / `Stop` / `Update` / `Output`); `execute_tool` + catalog entries.

**Deps / fixes:** `uuid` added to `crates/runtime` for task ids. `agent_loop`: `let`-`else` terminator for AskUserQuestion; avoid `?` on `Result` inside `try_execute_mcp_meta_tool` (`Option` return); drop ambiguous `.into()` on string literals for `ToolError::new`.

**Verification:** `cargo test --workspace` from `apps/desktop/src-tauri/` — pass (2026-04-09). `pnpm exec tsc --noEmit` from `apps/desktop/` — pass (2026-04-09).

### 2026-04-09 E2E / Vite: `plugin-dialog` mock exports `save`

**Problem:** [`SettingsModal.tsx`](apps/desktop/src/components/SettingsModal.tsx) imports `open` and `save` from `@tauri-apps/plugin-dialog`. The desktop Vite config aliases that package to [`tests/tauri-mock-dialog.ts`](apps/desktop/tests/tauri-mock-dialog.ts) for browser builds and Playwright’s `webServer` pipeline; the mock only exported `open`, so `vite build` failed with “save is not exported”.

**Fix:** Export an async `save` stub (returns `null`, same contract as `open` for non-Tauri runs).

**Verification:** `pnpm run build` from `apps/desktop/` — pass (2026-04-09).

### 2026-04-09 Claw-code alignment implementation batch

**Upstream pin:** `git ls-remote https://github.com/ultraworkers/claw-code.git refs/heads/main` → **`e4c38718824bda32c054664d1a01e591b489f635`** (matches `docs/CLAW_CODE_ALIGNMENT.md`; no drift on this date).

**Compaction:** `runtime::compact` now matches claw-code `compact.rs` at that pin for `should_compact` (token budget applies only after an optional leading compaction system message), merged summaries on second compaction, and `extract_existing_compacted_summary` / `merge_compact_summaries` behavior. Relay retains **`preserve_recent_messages: 5`** in `CompactionConfig::default()` (claw default remains 4).

**Sandbox:** Linux namespace support uses **`unshare_user_namespace_works()`** (probe `unshare --user --map-root-user true`) instead of binary presence only — same approach as claw `sandbox.rs` at the pin.

**MCP:** `McpServerManager::call_tool` performs **one reconnect retry** after a recoverable stdio transport `Io` failure (process reset + re-init).

**Harness:** `compat-harness` parity-style tests added for `write_file` success, `grep_search` content hit, and `bash` stdout roundtrip (when policy allows).

**Docs:** `docs/CLAW_CODE_ALIGNMENT.md` — tool-surface policy for omitted claw tools; compaction checklist updated; last `ls-remote` verification row.

**Verification:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace` — pass (2026-04-09). `pnpm typecheck` — pass (2026-04-09).

### 2026-04-09 OpenWork plan implementation (allowlist UI, predictability notes, `.relay/commands`, shell layout)

**Workspace allowlist UI:** IPC `get_workspace_allowlist`, `remove_workspace_allowlist_tool`, `clear_workspace_allowlist` (`workspace_allowlist.rs`); Settings lists persisted tools per normalized folder, **Remove** per tool, **Clear all for path above**, **Copy / Save allow list JSON**. Replaces hand-editing `~/.relay-agent/workspace_allowed_tools.json` as the only revocation path.

**Predictability:** `RelayDiagnostics.predictability_notes` from `get_relay_diagnostics` plus a short **How connections use your settings** block in Settings (cwd vs process, CDP port, allow-list file path).

**`.relay/commands`:** New `workspace_slash_commands.rs`, command `list_workspace_slash_commands`; composer loads workspace commands when `cwd` changes (`shell/Shell.tsx` + `setWorkspaceSlashCommands`). Slash autocomplete fixed (`Composer` used to double the `/` prefix).

**Frontend domains:** `shell/Shell.tsx` (main app), `session/session-display.ts`, `context/todo-write-parse.ts`; `root.tsx` re-exports the shell.

**`relay.workspace.json` (proposed, not loaded yet):** Optional file at the workspace root. Example shape for future implementation:

```json
{
  "sessionPresetDefault": "plan",
  "browserAutomation": { "cdpPort": 9360, "autoLaunchEdge": true, "timeoutMs": 30000 },
  "maxTurns": 32
}
```

**Precedence:** Settings UI and `start_agent` fields override keys present in this file when both are set.

**Verification:** `pnpm typecheck` — pass. `cargo test -p relay-agent-desktop` — pass (includes `workspace_slash_commands::tests::md_and_json_merge_md_wins_on_name`).

### 2026-04-09 OpenWork round-two (instruction surfaces, live Policy summary, session JSON export, workspace allowlist, sidebar sort)

**PLANS.md:** OpenWork-style UX bullet updated for **Plan timeline**, **Save diagnostics**, and **Allow for this workspace**.

**Workspace instructions (read-only):** IPC `workspace_instruction_surfaces` lists `CLAW.md`, `.claw/`, nested instruction files, and settings JSON under the configured workspace `cwd` with existence flags (OpenWork-style skills/instructions visibility).

**Policy tab:** Replaces illustrative defaults with **`get_desktop_permission_summary`** rows derived from `desktop_permission_policy` for the current **session preset** (Build / Plan / Explore).

**Debug:** **Save session JSON…** in Settings writes `get_session_history` for the active session via `write_text_export`.

**Approvals:** **`remember_for_workspace`** on `respond_approval` persists tool names in `~/.relay-agent/workspace_allowed_tools.json` (normalized cwd keys); new sessions preload into `auto_allowed_tools`. **Allow for this workspace** button in the approval overlay (only when workspace `cwd` was set for the session).

**Sidebar:** Session list sorted **newest first** by `createdAt` (search unchanged).

**Workspace allowlist (Allow for this workspace):** Stored at `~/.relay-agent/workspace_allowed_tools.json` (or `%USERPROFILE%\.relay-agent\` on Windows). Keys are normalized workspace roots. Revoke via **Settings → Workspace tool allow list** (2026-04-09 batch) or by editing/deleting that file.

**Verification:** `pnpm typecheck` — pass. `cargo check` / `cargo test -p relay-agent-desktop --lib` — pass (recorded with this batch).

### 2026-04-09 OpenWork reference batch (plan timeline, diagnostics export, MCP copy, audit summary)

**Plan timeline:** Each successful `TodoWrite` appends a snapshot per session (`PlanTimelineEntry`: `toolUseId`, `atMs`, `todos`). Loading history rebuilds the timeline from `chunksFromHistory` via `buildPlanTimelineFromUiChunks` (`apps/desktop/src/context/todo-write-parse.ts`). **Context → Plan** shows newest-first collapsible sections (`apps/desktop/src/components/ContextPanel.tsx`); state in `apps/desktop/src/shell/Shell.tsx`.

**Diagnostics export:** `write_text_export` Tauri command (`apps/desktop/src-tauri/src/tauri_bridge.rs`) + `writeTextExport` in `ipc.ts`. **Settings → Debug:** **Save diagnostics…** uses `@tauri-apps/plugin-dialog` `save` then writes JSON (bundle includes `activeSessionId` when set). **Copy diagnostics** unchanged aside from bundle field rename `exportedAt` / `activeSessionId`.

**MCP / extensions copy:** Context tab label **MCP** (was Servers); intro text references `.claw`, `CLAW.md`, and OpenWork-style skills analogy; empty state clarified.

**Session audit:** `formatSessionAuditSummary` in `ipc.ts`; **Copy session audit** in Settings copies a compact tool/text timeline from `get_session_history` for the active session (requires sidebar selection).

**Verification:** `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit` — pass (2026-04-09). `cargo check` from `apps/desktop/src-tauri/` — pass (2026-04-09).

### 2026-04-09 Relay Agent app icon and favicon

**Problem:** The bundled `apps/desktop/src-tauri/icons/icon.png` was a minimal 32×32 placeholder (~100 bytes), so the window/taskbar icon often appeared as a flat dark square when scaled.

**Source:** [`apps/desktop/src-tauri/icons/source/relay-agent.svg`](apps/desktop/src-tauri/icons/source/relay-agent.svg) — original flat “relay” mark (two nodes + dual arc), accent `#2563eb` aligned with `--ra-accent` (dark theme). Visual tone follows the style of [developer-icons](https://github.com/xandemon/developer-icons) (MIT); no third-party paths were copied.

**Generation:** From `apps/desktop`, `pnpm exec tauri icon src-tauri/icons/source/relay-agent.svg -o src-tauri/icons` regenerates `icon.icns`, `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` (512×512), plus Store/Android/iOS assets under `icons/`.

**Bundle config:** [`apps/desktop/src-tauri/tauri.conf.json`](apps/desktop/src-tauri/tauri.conf.json) `bundle.icon` lists the [Tauri v2 recommended](https://v2.tauri.app/develop/icons) desktop set: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`.

**Web:** [`apps/desktop/public/favicon.svg`](apps/desktop/public/favicon.svg) and [`apps/desktop/index.html`](apps/desktop/index.html) `<link rel="icon" …>` for the Vite dev server tab.

**Verification:** `cargo check` from `apps/desktop/src-tauri/` — pass (2026-04-09).

### 2026-04-09 OpenCode plan implementation batch (Explore, undo, git, LSP probe)

**Explore preset:** [`SessionPreset::Explore`](apps/desktop/src-tauri/src/models.rs) — read-only host with only `read_file` / `glob_search` / `grep_search` in [`cdp_tool_catalog_section`](apps/desktop/src-tauri/src/agent_loop.rs) and in [`desktop_permission_policy`](apps/desktop/src-tauri/src/agent_loop.rs) (`EXPLORE_TOOL_NAMES`). UI: third composer segment + [`MessageFeed`](apps/desktop/src/components/MessageFeed.tsx) empty-state copy; [`ipc.ts`](apps/desktop/src/lib/ipc.ts) `SessionPreset` + `readStoredSessionPreset`.

**Undo / redo:** [`WriteUndoStacks`](apps/desktop/src-tauri/src/session_write_undo.rs) on [`SessionEntry`](apps/desktop/src-tauri/src/registry.rs); snapshots before `write_file` / `edit_file` / `NotebookEdit` / `pdf_merge` / `pdf_split` in [`TauriToolExecutor`](apps/desktop/src-tauri/src/agent_loop.rs). IPC: `undo_session_write`, `redo_session_write`, `get_session_write_undo_status`. UI: **Undo** / **Redo** in [`ShellHeader`](apps/desktop/src/components/ShellHeader.tsx).

**Git tools:** [`git_status`](apps/desktop/src-tauri/crates/tools/src/lib.rs), [`git_diff`](apps/desktop/src-tauri/crates/tools/src/lib.rs) (read-only, output cap ~256 KiB, `git` on PATH).

**Compaction default:** [`CompactionConfig::default().preserve_recent_messages`](apps/desktop/src-tauri/crates/runtime/src/compact.rs) is **5** (was 4); [`auto_compacts_when_cumulative_input_threshold_is_crossed`](apps/desktop/src-tauri/crates/runtime/src/conversation.rs) expectation updated.

**LSP milestone:** Design [`docs/LSP_MILESTONE.md`](LSP_MILESTONE.md); minimal IPC [`probe_rust_analyzer`](apps/desktop/src-tauri/src/tauri_bridge.rs) + [`lsp_probe.rs`](apps/desktop/src-tauri/src/lsp_probe.rs); frontend [`probeRustAnalyzer`](apps/desktop/src/lib/ipc.ts).

**Custom slash/templates:** Design only [`docs/CUSTOM_SLASH_AND_TEMPLATES.md`](CUSTOM_SLASH_AND_TEMPLATES.md).

**Verification:** `pnpm --filter @relay-agent/desktop exec tsc --noEmit` — pass. `cargo test --workspace` from `apps/desktop/src-tauri/` — pass (2026-04-09).

### 2026-04-09 OpenCode-inspired improvements (session presets, config DX, planning artifacts)

**Session presets (Plan / Build):** [`SessionPreset`](apps/desktop/src-tauri/src/models.rs) on [`StartAgentRequest`](apps/desktop/src-tauri/src/models.rs) maps to [`desktop_permission_policy(preset)`](apps/desktop/src-tauri/src/agent_loop.rs): **Build** = existing `WorkspaceWrite` base with danger-tier prompts for mutating tools; **Plan** = `ReadOnly` base so mutating tools are denied without prompts (OpenCode-style plan agent). [`build_desktop_system_prompt`](apps/desktop/src-tauri/src/agent_loop.rs) appends a Plan-mode instruction block. **UI:** [`Composer`](apps/desktop/src/components/Composer.tsx) Build/Plan toggle (persists `relay.sessionPreset.v1`); [`startAgent`](apps/desktop/src/lib/ipc.ts) sends `sessionPreset`. **Persistence:** [`PersistedSessionConfig.session_preset`](apps/desktop/src-tauri/src/copilot_persistence.rs) records the choice in saved session JSON.

**`.claw`:** Plan preset is a per-session host overlay; merged `.claw` still applies to bash validation and instructions when those paths run.

**Claw settings DX:** [`read_optional_json_object`](apps/desktop/src-tauri/crates/runtime/src/config.rs) and [`expect_object`](apps/desktop/src-tauri/crates/runtime/src/config.rs) now emit clearer parse errors (file path, JSON syntax hints, pointer to partial schema). **Partial JSON Schema:** [`docs/schemas/claw-settings.schema.json`](schemas/claw-settings.schema.json) documents a subset of merged settings keys for editors and humans; the runtime merger remains authoritative and allows unknown keys.

**Session write undo / redo:** Implemented in the **2026-04-09 OpenCode plan implementation batch** entry above (per-tool snapshot stack + IPC + header UI). The bullets below were the original design notes:

- **Unit of undo:** One logical **write** outcome: successful `write_file`, `edit_file`, `NotebookEdit`, `pdf_merge` / `pdf_split`, and similar workspace-mutating tools (not reads, not `TodoWrite`).
- **Stack:** Per `session_id`, push `{ tool, input_summary, revert_ops }` after successful apply; `revert_ops` might be `restore_previous_bytes` (if captured before write) or `delete_if_created` for new files.
- **Alignment with approvals:** Prefer **one undo step per user-approved batch** when multiple tools ran under a single approval flow, or **one step per successful mutating tool** — product choice; document in UI copy (`Undo last change` vs `Undo last batch`).
- **Scope:** File-backed workspace paths only first; Git `checkout` fallback is optional and policy-sensitive.
- **IPC:** e.g. `undo_last_session_write` / `redo...` commands + UI affordance; gated behind explicit milestone in `PLANS.md`.

**LSP milestone gate:** Subprocess/security design + minimal `rust-analyzer` probe landed in **`docs/LSP_MILESTONE.md`** and `probe_rust_analyzer` (see batch entry above). Full JSON-RPC LSP integration remains future work.

**Verification:** `pnpm --filter @relay-agent/desktop typecheck` — pass (2026-04-09). `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace` — pass (2026-04-09).

### 2026-04-09 Claw-code alignment baseline (docs + integration stance)

**Source of truth (current tree):** The desktop crate [`apps/desktop/src-tauri/Cargo.toml`](apps/desktop/src-tauri/Cargo.toml) has **no** `claw-*` git/path dependencies. The agent loop is [`apps/desktop/src-tauri/src/agent_loop.rs`](apps/desktop/src-tauri/src/agent_loop.rs) plus internal crates [`runtime`](apps/desktop/src-tauri/crates/runtime), [`tools`](apps/desktop/src-tauri/crates/tools), [`commands`](apps/desktop/src-tauri/crates/commands). Session/history types are **in-repo** (e.g. [`storage.rs`](apps/desktop/src-tauri/src/storage.rs), [`registry.rs`](apps/desktop/src-tauri/src/registry.rs)); they are **not** `claw_core::SessionState`.

**Historical note:** Older log entries below that mention `claw-core`, `claw_tools::ToolRegistry`, or pins to `claw-cli/claw-code-rust` describe a **superseded or unmerged experiment**. Treat them as archive context unless a future milestone reintroduces those crates and updates this baseline.

**Integration decision (see `PLANS.md` — Claw-code integration):** Continue **in-repo** agent/runtime/tools aligned with [Claw Code](https://github.com/ultraworkers/claw-code) behavior and [tool-system](https://claw-code.codes/tool-system) docs; use **ultraworkers/claw-code** `rust/` as the reference for parity and selective ports. **Optional later:** add a `git` dependency on upstream crates if API stability and license review allow. Relay-specific layers stay: M365 Copilot + CDP bridge (`copilot_*`, `agent_loop` CDP client), Tauri IPC, LiteParse/Office/PDF desktop glue.

**Artifacts this milestone:** `PLANS.md` (integration subsection), `docs/IMPLEMENTATION.md` (this entry), `docs/CLAW_CODE_ALIGNMENT.md` (module boundaries + parity checklist), `runtime` workspace path policy + read size cap, extended `RelayDiagnostics` / `get_relay_diagnostics`, `compat-harness` parity-style tests.

**Verification:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace` — pass (2026-04-09). `pnpm --filter @relay-agent/desktop typecheck` — pass (2026-04-09).

### 2026-04-10 claw-code reference adoption (selective port)

**Upstream pin:** [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) `main` at **`e4c38718824bda32c054664d1a01e591b489f635`** (recorded when porting this batch; refresh on future diffs).

**Bash (read-only guard):** Added [`runtime/src/bash_validation.rs`](apps/desktop/src-tauri/crates/runtime/src/bash_validation.rs) — when merged `.claw` settings resolve to **read-only**, shell commands that *appear* mutating (`rm`, `cp`, `git commit`, `> ` redirects, etc.) are rejected before spawn. Session workspace for config discovery uses [`BashConfigCwdGuard`](apps/desktop/src-tauri/crates/runtime/src/bash_validation.rs) set from [`TauriToolExecutor`](apps/desktop/src-tauri/src/agent_loop.rs) during `bash` tool calls (not process CWD). Subset of claw PARITY bash-validation intent, not the full upstream matrix.

**MCP messages:** Clearer user-facing strings for [`McpServerManagerError`](apps/desktop/src-tauri/crates/runtime/src/mcp_stdio.rs) (`Display`) and [`mcp_check_server_status`](apps/desktop/src-tauri/src/tauri_bridge.rs) when a server name is missing.

**Tool catalog copy:** [`bash`](apps/desktop/src-tauri/crates/tools/src/lib.rs) tool description documents read-only rejection and file-tool preference.

**Compaction (design only this milestone):** claw `PARITY.md` still lists session compaction / token accuracy as open parity items. Relay keeps [`CompactionConfig`](apps/desktop/src-tauri/crates/runtime/src/compact.rs) defaults (`preserve_recent_messages: 4`, `max_estimated_tokens: 10_000`) and auto-compaction env `CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS`. **Next implementation step (when prioritized):** diff claw `rust/` compaction triggers and summary shape, then adjust thresholds or formatting behind a single config surface; avoid changing Copilot CDP message packaging without an explicit milestone.

**Docs:** [`docs/CLAW_CODE_ALIGNMENT.md`](docs/CLAW_CODE_ALIGNMENT.md) — upstream pin procedure, Relay vs claw tool list, mock-parity scenario map.

**Verification:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace` — pass (2026-04-10).

### 2026-04-08 Workspace display + native folder picker

**Outcome:** Centralized path formatting in **`apps/desktop/src/lib/workspace-display.ts`** (`workspaceBasename`, `ellipsisPath`). **`ShellHeader`** shows a clickable workspace chip (`data-ra-workspace-chip`) with basename or “Workspace not set”. **`StatusBar`** always shows workspace status: ellipsis path + **Copy** when set, otherwise a short hint to use Settings (`data-ra-workspace-label`). **`MessageFeed`** empty state uses the configured path in eyebrow/subtitle or prompts for Settings. **`tauri-plugin-dialog`** + **`@tauri-apps/plugin-dialog`** with **`dialog:default`** in **`capabilities/default.json`**; **Settings** workspace row includes **Browse…** when `isTauri()` (hidden in Vite/Playwright). Choosing a folder saves cwd immediately and refreshes the shell label via **`onSaved`**.

**Verification:** `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass. `pnpm --filter @relay-agent/desktop typecheck` / `build` — pass. `E2E_SKIP_AUTH_SETUP=1 playwright test app.e2e.spec.ts` (from `apps/desktop/`) — pass. Native folder dialog: manual `pnpm --filter @relay-agent/desktop tauri:dev`.

### 2026-04-08 OpenWork-inspired shell UX

**Outcome:** Brought several [openwork](https://github.com/different-ai/openwork)-style product surfaces into the Solid shell without changing the Copilot CDP agent core. **Settings** (header) edits workspace path (`cwd` passed to `start_agent`), `maxTurns`, and stored `BrowserAutomationSettings` (persistence only until the loop consumes them beyond defaults), and **Copy diagnostics** builds a JSON blob from `get_relay_diagnostics` plus those local fields. **Approvals:** `RespondAgentApprovalRequest.remember_for_session` + `SessionEntry.auto_allowed_tools` + `PendingApproval` let the user allow a tool once or for the rest of the session (`TauriApprovalPrompter` short-circuits before emitting `agent:approval_needed`). **Plan** tab parses `TodoWrite` tool results (`newTodos`) into a task list per session. **Templates** in the composer save/load prompt snippets via `relay.promptTemplates.v1` in `localStorage`. **Status bar** shows the configured workspace path when set.

**Artifacts:** `apps/desktop/src/components/SettingsModal.tsx`, `ShellHeader.tsx`, `ApprovalOverlay.tsx`, `ContextPanel.tsx`, `StatusBar.tsx`, `Composer.tsx`, `root.tsx`, `lib/ipc.ts`, `lib/settings-storage.ts`, `lib/todo-write-parse.ts`, `lib/prompt-templates-store.ts`, `apps/desktop/src-tauri/src/models.rs` (`RelayDiagnostics`, `remember_for_session`), `registry.rs` (`PendingApproval`, `auto_allowed_tools`), `tauri_bridge.rs` (`get_relay_diagnostics`, `respond_approval`), `agent_loop.rs`, `lib.rs` (invoke handler), Playwright mocks for `get_relay_diagnostics`, `PLANS.md`.

**Verification:** `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass. `pnpm --filter @relay-agent/desktop typecheck` — pass. `pnpm --filter @relay-agent/desktop build` — run as follow-up in CI/local.

**Gap audit (Policy vs approval):** Context **Policy** tab remains illustrative defaults (`require_approval` / `auto_allow` / `auto_deny`); runtime gating is `PermissionPolicy` in Rust plus interactive approvals. `TodoWrite` events are `agent:tool_start` / `agent:tool_result` with tool name `TodoWrite`; the Plan tab listens on `tool_result` content JSON.

### 2026-04-08 Remove `onyx-concept` workspace crate

**Outcome:** Deleted the unused **`apps/desktop/src-tauri/crates/onyx-concept`** package (SQLite FTS5 knowledge index prototype). It was never a dependency of `relay-agent-desktop` or other workspace members. Workspace retrieval remains **`glob_search`**, **`grep_search`**, and **`read_file`** in the agent tool loop.

**Artifacts:** Root `Cargo.toml` (workspace members), `README.md`, `PLANS.md`, `Cargo.lock`

**Verification:** `cargo check --workspace` (repo root) — pass.

### 2026-04-08 Main window always-on-top (`lib.rs` setup)

**Outcome:** On startup, the **`main`** [`WebviewWindow`](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html) calls **`set_always_on_top(true)`** once. Missing window or platform errors are **`tracing::warn!`** only; the app still runs. Actual z-order stacking depends on the OS/window manager and is not asserted in CI.

**Artifacts:** `apps/desktop/src-tauri/src/lib.rs`, `README.md` (one-line user note)

**Verification:** `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass.

### 2026-04-08 Copilot bridge startup prewarm (`warmup_copilot_bridge`)

**Outcome:** On shell mount, the UI calls **`warmup_copilot_bridge`**, which runs **`ensure_copilot_server`** then Node **`GET /status`** with a **120s** per-request timeout (`CopilotServer::warmup_status`). That path already launches Edge, ensures a Copilot tab, and sets **`loginRequired`** when the URL is a login page. **`inspectStatus`** in **`copilot_server.js`** now queues on the same **`_describeChain`** as **`describe`** to avoid CDP races with the first chat completion. Footer **`StatusBar`** shows a short hint when login is required or warmup fails. E2E mocks implement **`warmup_copilot_bridge`**. **2026-04-09 follow-up:** `warmup_copilot_bridge` must run **`ensure_copilot_server`** on **`spawn_blocking`** so Tokio does not nest runtimes on the async worker (see Milestone Log entry *Copilot warmup: nested Tokio runtime panic*).

**Verification:** `cargo test -p relay-agent-desktop --lib` — pass. `pnpm typecheck` (repo root) — pass. `E2E_SKIP_AUTH_SETUP=1 npx playwright test app.e2e.spec.ts` (from `apps/desktop/`) — 14 passed.

### 2026-04-08 PDF merge/split (`lopdf` + `pdf_merge` / `pdf_split`)

**Outcome:** Added **`runtime::pdf_manip`** (`merge_pdfs`, `split_pdf`, `PdfSplitSegment`) using **`lopdf` 0.35**. **Merge** follows the object-renumber + rebuilt catalog/pages pattern from the upstream `lopdf` merge example (no bookmarks in merged output). **Split** loads the input once per segment, selects pages via the same **1-based comma/range grammar** as `read_file` PDF `pages`, deletes other pages, prunes, renumbers, compresses, and saves. **Tools** `pdf_merge` / `pdf_split` are **`WorkspaceWrite`** (desktop policy still escalates writes to danger approval). **`human_approval_summary`** covers both tools. System prompt **Constraints** remind the model to use these tools instead of **bash** for PDF merge/split. **v1:** encrypted PDFs are rejected if **`/Encrypt`** is present in the trailer after load; no guarantee for forms-heavy or annotation-heavy fidelity (focus on page content).

**Artifacts:** `apps/desktop/src-tauri/crates/runtime/Cargo.toml` (`lopdf`), `crates/runtime/src/pdf_manip.rs`, `crates/runtime/src/lib.rs`, `crates/runtime/src/file_ops.rs` (`pub(crate)` path normalizers for reuse), `crates/tools/src/lib.rs`, `apps/desktop/src-tauri/src/agent_loop.rs`, `PLANS.md`

**Limits (constants in `pdf_manip.rs`):** max **32** merge inputs; max **16** split segments; max **64** total page selections across segments (each page counted per segment); max **200 MiB** combined input file size per operation; duplicate `output_path` values in one `pdf_split` call are rejected.

**Risks:** Some real-world PDFs may trigger viewer warnings after merge; see [lopdf#424](https://github.com/J-F-Liu/lopdf/issues/424). Splitting complex PDFs may drop non-page objects; errors from `lopdf` are surfaced as tool failures.

**Verification (2026-04-08):** `cargo test -p runtime` — pass. `cargo test -p tools` — pass. `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass.

**Manual smoke:** Merge two known PDFs with `pdf_merge`, split one with `pdf_split` and open outputs in a viewer; optional: `read_file` on outputs to confirm LiteParse still returns text for simple pages.

### 2026-04-08 PDF `read_file` via LiteParse + bundled Node

**Outcome:** Replaced Rust `lopdf` PDF text extraction with **`@llamaindex/liteparse`** (OCR off) invoked by a **Node** subprocess. Added `apps/desktop/src-tauri/liteparse-runner/` (`parse.mjs`, `package-lock.json`). **Tauri** `bundle.externalBin` embeds **`relay-node`** (official Node 20.x per target triple; downloaded by `apps/desktop/scripts/fetch-bundled-node.mjs`). **`bundle.resources`** ships `liteparse-runner/` (including `node_modules` from `npm ci --omit=dev` on the build host). **`liteparse_env`** sets `RELAY_LITEPARSE_RUNNER_ROOT` and `RELAY_BUNDLED_NODE` at app startup; `runtime::pdf_liteparse` falls back to PATH `node` and compile-time `liteparse-runner` path for dev/tests. Limits: `RELAY_PDF_PARSE_TIMEOUT_SECS` (default 120), 16 MiB stdout cap. **`agent_loop`** system copy updated so PDF parsing is described accurately.

**Artifacts:** `apps/desktop/src-tauri/crates/runtime/src/pdf_liteparse.rs`, `liteparse-runner/`, `scripts/fetch-bundled-node.mjs`, `tauri.conf.json`, `src-tauri/.gitignore`, `liteparse_env.rs`, `package.json` prep scripts

**Verification:** `cargo test -p runtime` — pass (88 tests). `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass.

**Build note:** `pnpm tauri build` runs `beforeBuildCommand` (fetch Node for `TAURI_ENV_TARGET_TRIPLE`, `npm ci` in `liteparse-runner`, Vite build). For **`tauri dev`**, run once: `pnpm run prep:liteparse-runner` (and optionally `pnpm run prep:bundled-node` if not using system Node). Native addons in `liteparse-runner/node_modules` must be installed on the OS/arch that produces the bundle.

### 2026-04-08 Windows Office hybrid read (COM data + temp PDF + `read_file` / LiteParse)

**Outcome:** Documented agent workflow on **Windows + Office**: **one `PowerShell` COM command** batch-extracts **structured data** (`Range.Value2` → JSON or `Export-Csv`) and **`ExportAsFixedFormat`** to a **unique PDF** under `%TEMP%\RelayAgent\office-layout\` with **`OpenAfterPublish`/`OpenAfterExport` false** and **`Quit()` in `finally`**. Stdout contract: **one JSON** including **`pdfPath`**. The model then uses **`read_file` on that `.pdf`** (same `relay_tool` JSON **array** as `PowerShell`) for **LiteParse layout text**. **Excel:** PDF text is **layout hints only**; **numbers** come from **Value2/CSV**. **Tool catalog** adds a **Windows Office exception** to the generic “no shell for file I/O” rule for this pattern only. **`PowerShell` tool description** updated in `crates/tools`. **Template script:** `apps/desktop/scripts/office-hybrid-read-sample.ps1` (`-Mode Excel|Word|Ppt`, optional `-SheetName`, `-RangeAddress`).

**Artifacts:** `apps/desktop/src-tauri/src/agent_loop.rs`, `apps/desktop/src-tauri/crates/tools/src/lib.rs`, `apps/desktop/scripts/office-hybrid-read-sample.ps1`

**Verification:** `cargo test -p relay-agent-desktop --lib`, `cargo check -p relay-agent-desktop` — pass (Linux). **Manual (Windows + Office):** see `docs/FILE_OPS_E2E_VERIFICATION.md` row *Office hybrid read*.

### 2026-04-08 Relay default CDP base **9360** (YakuLingo coexistence)

**Outcome:** Relay の既定 CDP 基底を **9333 → 9360** に変更（**YakuLingo** は **9333** 固定のため衝突回避）。`copilot_server.js` は基底から 20 ポートをスキャン（**9360–9379**）。`scripts/start-relay-edge-cdp.sh` は既定 **9360** とし、**`DevToolsActivePort` が `/json/version` で生きていれば**（例: 既存 Edge が **9333**）**二重起動しない**。レガシー運用は **`RELAY_EDGE_CDP_PORT=9333`** / **`CDP_ENDPOINT`**。Rust・Node・Playwright・IPC JSDoc・E2E モックを同期。

**Verification:** `cargo test -p relay-agent-desktop --lib` — pass (42 tests). `cargo check -p relay-agent-desktop` — pass. `pnpm typecheck`（repo root）— pass.

### 2026-04-08 Hybrid CDP: attach IPC resolves marker / DevToolsActivePort

**Outcome:** Added `cdp_copilot::resolve_cdp_attachment_port(preferred)` — probes **`.relay-agent-cdp-port`** then **`DevToolsActivePort`** under `relay_agent_edge_profile_dir()` with `/json/version`, else returns **`preferred`**（現在の既定 **9360**）。Wired into **`cdp_send_prompt`**, **`cdp_screenshot`**, and **`connect_cdp` / `cdp_start_new_chat`** when **`auto_launch` is false** and **`base_port` is omitted**. Explicit **`base_port`** still wins. Unit tests for marker and `DevToolsActivePort` file parsing. Documented hybrid model in **`docs/COPILOT_E2E_CDP_PITFALLS.md`** and **`README.md`**.

**Verification:** `cargo test -p relay-agent-desktop --lib` — pass (42 tests).

### 2026-04-08 Always-on CDP workflow wired into dev + IPC defaults

**Outcome:** Unified **M365 Copilot CDP default port 9360** across Tauri IPC (`connect_cdp`, `cdp_send_prompt`, `cdp_start_new_chat`, `cdp_screenshot`), `cdp_copilot` parse fallbacks, `playwright-cdp.config.ts`, and `m365-copilot-capabilities-v2.spec.ts`. **`pnpm tauri:dev`** (`apps/desktop`) runs **`prestart-relay-edge.mjs`** on Unix to invoke `scripts/start-relay-edge-cdp.sh` first (skip: `RELAY_SKIP_PRESTART_EDGE=1`; Windows prints manual hint). Documented in `README.md`, `docs/COPILOT_E2E_CDP_PITFALLS.md`, `DEV_NOTES.md`.

**Verification:** `cargo check -p relay-agent-desktop`, `pnpm typecheck` — pass.

### 2026-04-08 M365 Copilot CDP smoke (`m365-cdp-chat`)

**Outcome:** Ran the **logged-in Copilot + CDP** Playwright suite against a live browser (`connectOverCDP`). Confirms composer visibility, Japanese prompt send (CDP `Input.dispatchKeyEvent` and shell-click fallback on turn 2), streaming completion via stop button, and multi-turn body growth. Documents that this slice does **not** require the Tauri app or CSV workbook path.

**Artifacts:** `docs/IMPLEMENTATION.md`, `docs/COPILOT_E2E_CDP_PITFALLS.md` (dated verification row)

**Verification:**

- Preconditions: live CDP（例: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9360/json/version` → `200`；レガシー **9333** ならその URL）; Edge/Chromium with M365 Copilot signed in on `m365.cloud.microsoft/chat`.
- `CDP_ENDPOINT=http://127.0.0.1:9360 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat` (from `apps/desktop/`) — **6 passed** (~1.6 min)（当時のログは **9333** 向け）。
- `pnpm typecheck` (repo root) — pass
- `cargo test -p relay-agent-desktop --lib` (from `apps/desktop/src-tauri/`) — pass (38 tests)
- `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass
- `pnpm check` (repo root) — **no `check` script** on `@relay-agent/desktop` (command exits non-zero); not used for this milestone.

### 2026-04-08 Windows Office COM guidance + PowerShell UTF-8 preamble

**Outcome:** Narrowed **Windows** agent guidance for **Word, Excel, PowerPoint, and `.msg`**: `PowerShell` tool description documents COM-first automation, batch Excel rules (no per-cell loops, `Range.Value2` / block writes), one-invocation-per-batch to reduce Copilot round-trips, and `ConvertTo-Json` on stdout. **`prepend_powershell_utf8_console_setup`** in `crates/tools` prepends `chcp 65001` and `[Console]::OutputEncoding` / `$OutputEncoding` to every PowerShell `-Command` (foreground and background) unless **`RELAY_POWERSHELL_NO_UTF8_PREAMBLE`** is set. **`agent_loop`**: `#[cfg(windows)]` blocks add the same policy to `build_desktop_system_prompt` and `cdp_tool_catalog_section`; PowerShell approval copy mentions possible Office COM. **`PLANS.md`**: new subsection documents scope, performance, and UTF-8 preamble.

**Artifacts:** `apps/desktop/src-tauri/crates/tools/src/lib.rs`, `apps/desktop/src-tauri/src/agent_loop.rs`, `PLANS.md`, `docs/IMPLEMENTATION.md`

**Verification:**

- `cargo test -p tools` (from `apps/desktop/src-tauri/`) — pass
- `cargo test -p relay-agent-desktop --lib` (from `apps/desktop/src-tauri/`) — pass
- `cargo check -p relay-agent-desktop` (from `apps/desktop/src-tauri/`) — pass
- `pnpm typecheck` (repo root) — pass

### 2026-04-07 OpenWork-inspired desktop UI (Solid) + E2E stability

**Outcome:** Refreshed the Tauri+Vite **Solid** shell toward an OpenWork-style pro layout: semantic `--ra-color-*` aliases and shell/session/tab/composer primitives in `index.css`; split UI into `Sidebar`, `MessageFeed`, `Composer`, `ContextPanel`, `ApprovalOverlay`, `ShellHeader`, `StatusBar`, etc.; soft session selection, segmented context tabs, tool status dots, empty state copy, modal-style approval, header tool-activity switch. **Bugfix:** `trackToolResult` now replaces the tool-call chunk immutably so Solid `For` re-renders and inline tool results (e.g. E2E `"Found 3 files"`) appear. **E2E:** `tests/tauri-mock-core.ts` auto-emits `agent:turn_complete` when `__RELAY_E2E_AUTOCOMPLETE !== false`; comprehensive specs use `injectMock(autoComplete)` accordingly. **Playwright:** default `workers: 1` to avoid flaky parallel runs against a single `vite preview` instance (override with `--workers=N` if needed).

**Artifacts:** `apps/desktop/src/index.css`, `apps/desktop/src/root.tsx`, `apps/desktop/src/components/*.tsx`, `apps/desktop/src/lib/ui-tokens.ts`, `apps/desktop/tests/tauri-mock-core.ts`, `apps/desktop/tests/e2e-comprehensive.spec.ts`, `apps/desktop/tests/app.e2e.spec.ts`, `apps/desktop/playwright.config.ts`

**Verification:**

- `pnpm --filter @relay-agent/desktop typecheck` — pass
- `pnpm --filter @relay-agent/desktop build` — pass
- `E2E_SKIP_AUTH_SETUP=1 npx playwright test tests/app.e2e.spec.ts tests/e2e-comprehensive.spec.ts` (from `apps/desktop/`) — 54 passed

### 2026-04-07 Claw-style agent tools (read_file / schemas / Windows PowerShell)

**Outcome:** Brought built-in tools closer to the [Claw Code tool-system](https://claw-code.codes/tool-system) shape: `read_file` supports `file_path`, optional PDF `pages` (later migrated to LiteParse via Node; see 2026-04-08 PDF milestone), `.ipynb` text rendering, image metadata; `edit_file` rejects non-unique `old_string` when `replace_all` is false; `NotebookEdit` accepts Claw `command` + `index`; `Config` accepts `key`/`action`; `StructuredOutput` accepts `data` plus extra keys; `TodoWrite` todos may include `id`/`priority`; `Agent` documents `run_in_background` / `isolation` with explicit unsupported errors; `bash` schema documents `dangerously_disable_sandbox` (alias on `BashCommandInput`; still stripped in `agent_loop`); `PowerShell` is registered and implemented only on Windows.

**Artifacts:** `apps/desktop/src-tauri/crates/runtime/src/file_ops.rs`, `apps/desktop/src-tauri/crates/runtime/Cargo.toml`, `apps/desktop/src-tauri/crates/tools/src/lib.rs`, `apps/desktop/src-tauri/crates/runtime/src/bash.rs`, `apps/desktop/src-tauri/src/agent_loop.rs`

**Verification (Linux):**

- `cargo test -p runtime` — pass (88 tests)
- `cargo test -p tools` — pass (28 tests)
- `cargo check -p relay-agent-desktop` — pass

### 2026-04-07 M365 Copilot Chathub WebSocket (assistant text)

**Finding:** M365 BizChat streams assistant `messages[].text` (author `bot`, `contentOrigin` e.g. `DeepLeo`) over **SignalR** on  
`wss://substrate.office.com/m365Copilot/Chathub/...` (frames use ASCII RS `\\u001e` record separators). HTTP XHR allowlist alone misses this channel.

**Implementation:** `createCopilotNetworkCapture` subscribes to CDP `Network.webSocketCreated` / `Network.webSocketFrameReceived` for that URL pattern, parses frames, and prefers extracted bot text in `pickBestOver`, `pickBestShortAssistant`, and `resolveAssistantReplyForReturn`.

**Security:** HAR/WebSocket URLs may contain `access_token` query params — never commit or paste raw; redact before sharing.

**Artifacts:** `apps/desktop/src-tauri/binaries/copilot_server.js`

### 2026-04-07 Copilot network capture: allowlist-first policy

**Problem:** `copilot_server.js` captured every response under broad Copilot-related hosts, then tried to reject bad bodies with growing string heuristics (JWT, Pacman telemetry, UUIDs, HTML shell, etc.). That does not scale: new endpoints kept leaking into “assistant text.”

**Policy (default):** Only buffer CDP `Network` responses whose URL matches **positive path patterns** for plausible chat/completions/messages traffic (`isAllowedChatNetworkUrl` in `copilot_server.js`). A shared **`NON_CHAT_NETWORK_PATH_RE`** blocks known telemetry/asset shapes regardless.

**Debug:** Set `RELAY_COPILOT_LEGACY_BROAD_NETWORK=1` on the Node process to restore the older “broad host + denylist” capture for comparison when recording HARs.

**Operational note:** When M365 changes API routes, capture DevTools → Network (XHR/fetch) during a real reply and **add regexes** to `isAllowedChatNetworkUrl` rather than new one-off string filters.

**Artifacts:** `apps/desktop/src-tauri/binaries/copilot_server.js`

### 2026-04-07 M365 Copilot: multiple approvals for one file-write intent

**Finding:** In Microsoft Copilot (agent / tool-approval UX), a single instruction—for example, write `テスト` to `C:\Users\...\Downloads\テスト.txt`—can require **several separate approvals**. Typical assistant output mixes: (1) comments plus Python `path = ...`, (2) a `with open(..., "w")` block (surfaced as **code execution**), (3) `print("written")`, (4) `pass` / `# noop` and an inline switch from Python to the **`write_file` tool**, (5) a JSON-style `write_file` payload (**dedicated tool call**). The model often **self-corrects** from “write in Python” to “use the file tool”; the host then treats each executable fragment or tool invocation as its own approval card.

**Why it happens:** Agent UIs usually gate **different risk surfaces** separately (e.g. code run vs. file tool). **Streaming / parsing** can also finalize partial output as multiple actionable steps. Non-ASCII paths are not the primary cause but can correlate with longer, more fragmented replies.

**Mitigation (prompting):** Specify a **single mechanism** (e.g. “use `write_file` only; do not use Python”) and keep the task to **one step** (path, content, encoding in one line of instruction; avoid extra `print` / `pass`).

**Relay_Agent:** This is governed by **how the Copilot client maps streamed model output into approval UI**, not something diagnosable as a Relay defect from a pasted trace alone. Reducing **Relay’s** approval prompts is a separate concern: see `apps/desktop/src-tauri/src/agent_loop.rs` and smart-approval notes elsewhere in this log. Changing **Copilot’s** approval granularity is product-side or CDP-drive scope, to be scoped as its own milestone if needed.

**Artifacts:** operational note (this entry); no code change required for the observation itself.

### 2026-04-07 CDP `relay_tool` dedupe and catalog prompt tightening

**Outcome:** `parse_copilot_tool_response` now drops duplicate tool invocations that share the same tool name and normalized input (sorted JSON keys; `read_file` treats `path` and `file_path` as the same for comparison only—executed payloads are unchanged). This prevents repeated user approvals when Copilot emits the same `write_file` (or other) call across multiple `relay_tool` fences or twice in one array. The CDP tool-catalog section documents a single-fence + array preference, no shell/REPL for file I/O when file tools apply, and points to [Claw Code tool-system](https://claw-code.codes/tool-system) as the conceptual model. The default system prompt reinforced file tools over shell for file access (later expanded; see “Desktop system prompt” entry below).

**Artifacts:** `apps/desktop/src-tauri/src/agent_loop.rs`

**Verification:**

- `cargo test -p relay-agent-desktop cdp_copilot_tool` — pass (13 tests)

### 2026-04-07 Desktop system prompt (Claw-style harness)

**Outcome:** Replaced monolithic `build_system_prompt` with `build_desktop_system_prompt(goal, cwd)` returning multiple sections: Relay/Tauri identity (including URL caution aligned with upstream harness wording), `runtime::claw_style_discipline_sections()` (`# System`, `# Doing tasks`, `# Executing actions with care`), goal/constraints, and when `cwd` is set, `ProjectContext::discover_with_git` plus `render_project_context` / `render_instruction_files`. Instruction discovery uses `CLAW.md` / `CLAW.local.md` at each ancestor and `.claw/CLAW.md` / `.claw/instructions.md` only (Relay naming; settings still live under `.claw/`). Runtime settings load from `CLAW_CONFIG_HOME` (default `~/.claw`), project `.claw.json`, and `.claw/settings.json` / `.claw/settings.local.json`. `SYSTEM_PROMPT.md` override behavior unchanged (single block).

**Artifacts:** `apps/desktop/src-tauri/src/agent_loop.rs`, `apps/desktop/src-tauri/crates/runtime/src/prompt.rs`, `apps/desktop/src-tauri/crates/runtime/src/lib.rs`

### 2026-04-07 Consolidate config and instructions under `.claw`

**Outcome:** Removed `.claude/` paths and `CLAUDE_CONFIG_HOME` from Relay: user config dir is `~/.claw` (override with `CLAW_CONFIG_HOME`), project settings under `.claw/` and optional `.claw.json`; OAuth credentials follow the same home. Instruction file discovery no longer checks `.claude/`.

**Artifacts:** `apps/desktop/src-tauri/crates/runtime/src/config.rs`, `oauth.rs`, `prompt.rs`, `apps/desktop/src-tauri/crates/tools/src/lib.rs`, `apps/desktop/src-tauri/crates/api/src/client.rs`, `apps/desktop/src-tauri/crates/commands/src/lib.rs`

**Verification:** `cargo test -p runtime`, `cargo test -p tools`, `cargo test -p commands`, `cargo test -p relay-agent-desktop` (the `api` crate shares `CLAW_CONFIG_HOME` in tests but is not a workspace member; run with `--manifest-path` if needed).

### 2026-04-07 Instruction files: `CLAW.md` instead of `CLAUDE.md`

**Outcome:** Workspace instruction discovery now uses `CLAW.md`, `CLAW.local.md`, `.claw/CLAW.md`, and `.claw/instructions.md` only (no `CLAUDE*.md`). Slash `/init` and `/memory` help text updated accordingly.

**Artifacts:** `apps/desktop/src-tauri/crates/runtime/src/prompt.rs`, `apps/desktop/src-tauri/crates/commands/src/lib.rs`, `README.md`

**Verification:** `cargo test -p runtime`, `cargo test -p commands`

**Verification:**

- `cargo test -p runtime` — pass (89 tests)
- `cargo check -p relay-agent-desktop` — pass

### 2026-04-06 Edge CDP connection hardening

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/cdp_copilot.rs`
- `apps/desktop/scripts/copilot-browser.ts`

Outcome:

- Fixed `resolve_ws` so `/json/version` is fetched with a full `http://…` base URL (the previous `127.0.0.1:port/json/version` form is not a valid URL for `reqwest`, which broke WebSocket URL resolution after connecting to an existing Edge session).
- Added `--remote-allow-origins=*` to the Rust auto-launch path and the `copilot-browser` script so Chromium 111+ CDP/WebSocket clients can attach (aligned with `copilot_server.js`).
- Normalized `ws://0.0.36.6:port/…` as well as host-only `0.0.36.6` URLs on Windows.
- Expanded Edge discovery: Windows Beta/Dev paths; Linux `microsoft-edge-beta` and `msedge` via `which`.

Verification:

Commands run:

- `cargo test` / `cargo check` (blocked in this agent image: registry dependency `toml_parser` requires Cargo `edition2024` support; newer toolchain resolves).

### 2026-04-04 Agent loop and streaming fixes

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/src/copilot_client.rs`
- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src/root.tsx`

Outcome:

- Fixed Tauri tool event correlation so `tool_start` and `tool_result` now share one `toolUseId`.
- Passed `cwd` and `maxTurns` through the bridge, replaced cross-thread cancellation with `Arc<AtomicBool>`, and saved session state after each loop iteration.
- Added disk-backed session persistence under `~/.relay-agent/sessions/` and allowed session history fallback loading from saved JSON.
- Switched the backend client path to streamed SSE handling through the `api` crate, emitting live `agent:text_delta` events into the Tauri bridge.
- Updated the Solid frontend IPC and root shell so partial assistant text renders live and tool rows update in place by `toolUseId`.
- Added support for a user-provided `~/.relay-agent/SYSTEM_PROMPT.md` override with `{goal}` placeholder substitution or appended-goal fallback.

Verification:

Commands run:

- `cargo check --manifest-path /tmp/Relay_Agent/apps/desktop/src-tauri/Cargo.toml`
- `cargo check --manifest-path /tmp/Relay_Agent/apps/desktop/src-tauri/Cargo.toml`
- `cargo check --manifest-path /tmp/Relay_Agent/apps/desktop/src-tauri/Cargo.toml`
- `cargo check --manifest-path /tmp/Relay_Agent/apps/desktop/src-tauri/Cargo.toml`
- `cargo check --manifest-path /tmp/Relay_Agent/apps/desktop/src-tauri/Cargo.toml`
- `npx tsc --noEmit`
- `npm run typecheck`

Result:

- All required Rust `cargo check` runs passed after each Rust change.
- `npx tsc --noEmit` was blocked by sandbox network resolution because `npx` attempted to reach `registry.npmjs.org`.
- `npm run typecheck` was blocked because `tsc` is not installed in the current workspace environment (`node_modules` / local TypeScript binary unavailable).

### Phase 7 Follow-up

#### Task T28 Inbox panel persistence slice

Completed.

Artifacts:

- `apps/desktop/src/lib/components/InboxPanel.svelte`
- `apps/desktop/src/lib/components/ContextPanel.svelte`
- `apps/desktop/src/routes/+page.svelte`
- `apps/desktop/src/lib/ipc.ts`
- `packages/contracts/src/core.ts`
- `packages/contracts/src/ipc.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/session.rs`
- `apps/desktop/src-tauri/src/session_store.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/tauri_bridge.rs`

Outcome:

- Extracted the FILES tab into `InboxPanel.svelte` with drag-and-drop, picker-based add, hover remove, and file size plus added-at metadata.
- Added persisted `inboxFiles` session state plus `add_inbox_file` and `remove_inbox_file` IPC commands, and synchronized shared inbox state across sessions linked to the same project.
- Updated session creation, recoverable-draft restore, and `start_agent` session bootstrap so inbox files flow into stored session context and the agent system prompt automatically includes them.

Verification:

Commands run:

- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml inbox_files`

Result:

- Passed in the current environment.
- `pnpm typecheck` and the desktop build still emit the pre-existing Svelte SSR warning in `apps/desktop/src/lib/components/AppSidebar.svelte` about a nested `<button>`; no new inbox-related errors were reported.

### Phase 4 Follow-up

#### Task T14 session-migration design diff

In progress.

Artifacts:

- `docs/T14_SESSION_MIGRATION_DESIGN.md`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/relay.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src/lib/ipc.ts`
- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/routes/+page.svelte`

Outcome:

- Documented the current migration baseline for `T14`: `SessionStore` already owns session CRUD, turn CRUD, and `claw-core` message history, while `storage.rs` still owns the Relay-era packet and pasted-response lifecycle.
- Fixed the remaining blocker boundary explicitly: the main guided flow and shared contracts still depend on `generate_relay_packet`, `submit_copilot_response`, packet-specific turn statuses, and `relay-packet` inspection items.
- Split the work boundary between `T14` and follow-up cleanup tasks so the next implementation step is clear: move preview/review to structured agent output from history or artifacts first, then remove the packet-first storage path.
- Added a shared latest-structured-response accessor in `storage.rs` that resolves a `CopilotTurnResponse` from the live response cache first, then persisted response/validation artifacts, then the latest assistant JSON stored in `claw-core` session history for the latest turn.
- Updated `preview_execution()` to use that accessor, which means Rust agent sessions can now enter preview/review without going through `submit_copilot_response()` first as long as the latest assistant message contains a valid structured response.
- Added a regression that drives preview generation from session history only, plus a second regression confirming the existing manual pasted-response preview flow still passes.
- Added `record_structured_response` as a new backend/frontend IPC path for the primary agent-loop flow, so a validated `CopilotTurnResponse` can now be recorded directly without generating a relay packet or going through pasted-response submission.
- Updated the main page so setup no longer generates a relay packet for the active turn; instruction text and planning fallback now derive from the enabled tool list plus workbook context instead of `relayPacket`.
- Updated the auto agent-loop ready-to-write path so it records the final structured response through the new IPC, then opens preview/review directly from backend state instead of re-entering the old pasted-response flow.
- Removed the remaining manual pasted-response entry point and its backend command: the desktop route no longer keeps relay-packet or pasted-response continuity state, scope-approval resume now reuses the pending structured response directly, and `submit_copilot_response` has been deleted in favor of `record_structured_response`.
- Removed the public `generate_relay_packet` and `submit_copilot_response` IPC wrappers, updated recoverable studio drafts to persist only the current session/preview/execution state, and migrated Rust smoke/integration tests to record structured responses directly instead of using the deleted submit flow.

Verification:

Commands run:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview_execution_uses_latest_structured_response_from_session_history -- --nocapture`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml record_structured_response_enables_preview_without_submit_flow -- --nocapture`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview_execution_summarizes_parsed_csv_write_actions -- --nocapture`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm --filter @relay-agent/desktop typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run`

Result:

- Passed in the current environment.

#### Task T15 claw-permissions approval-policy integration

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/tauri_bridge.rs`
- `apps/desktop/src-tauri/src/risk_evaluator.rs`

Outcome:

- Updated the bridge-owned `PermissionPolicy` so agent tool execution now wraps `risk_evaluator` instead of always prompting for every write-capable tool.
- Readonly tools are allowed immediately, shell execution still requires explicit approval, and `ApprovalPolicy::Standard` / `Fast` now auto-allow eligible low or medium-risk known tool runs inside the agent loop.
- Added agent-loop regressions covering the existing manual-approval path and the new fast-policy auto-approval path for `workbook.save_copy`.

Verification:

Commands run:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent_loop_`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result:

- Passed in the current environment.

### Phase 7 Follow-up

#### Task T29 design-token cleanup for remaining components

Completed.

Artifacts:

- `apps/desktop/src/lib/components/CompletionCard.svelte`
- `apps/desktop/src/lib/components/SheetDiffCard.svelte`
- `apps/desktop/src/lib/components/FileOpPreview.svelte`
- `apps/desktop/src/lib/components/PipelineBuilder.svelte`
- `apps/desktop/src/lib/components/BatchDashboard.svelte`
- `apps/desktop/src/lib/components/TemplateBrowser.svelte`
- `apps/desktop/src/lib/components/Toast.svelte`

Outcome:

- Moved the remaining completion, diff, file-operation, pipeline, batch, template, and toast surfaces onto the current cool-neutral token set instead of the older mixed hard-coded styling.
- Standardized larger card radii, badge treatment, section labeling, progress surfaces, and code-pill presentation so these components now match the openwork-inspired shell introduced earlier.
- Swapped the template category pills to the shared `SegmentedControl` component and kept all affected buttons on the global pill-shaped button treatment.

Verification:

Commands run:

- `pnpm --filter @relay-agent/desktop typecheck`
- `pnpm --filter @relay-agent/desktop build`

Result:

- Passed in the current environment with `svelte-check found 0 errors and 0 warnings`.

### Cowork Follow-up

#### Tasks 164-169 Pipeline workflow slice

Completed.

Artifacts:

- `docs/PIPELINE_DESIGN.md`
- `docs/PIPELINE_VERIFICATION.md`
- `packages/contracts/src/pipeline.ts`
- `apps/desktop/src-tauri/src/pipeline.rs`
- `apps/desktop/src/lib/components/PipelineBuilder.svelte`
- `apps/desktop/src/lib/components/PipelineProgress.svelte`

Outcome:

- Added shared pipeline contracts plus backend orchestration state and `pipeline:step_update` events.
- Added a delegation-mode pipeline workbench with step editing, execution start, progress rendering, and stop action.
- Implemented save-copy handoff between sequential step outputs without mutating the original workbook.

#### Tasks 170-174 Batch processing slice

Completed.

Artifacts:

- `docs/BATCH_DESIGN.md`
- `docs/BATCH_VERIFICATION.md`
- `packages/contracts/src/batch.ts`
- `apps/desktop/src-tauri/src/batch.rs`
- `apps/desktop/src/lib/components/BatchTargetSelector.svelte`
- `apps/desktop/src/lib/components/BatchDashboard.svelte`

Outcome:

- Added sequential batch job contracts and backend job runner with `batch:target_update` events.
- Added folder or multi-file target selection, per-target status rendering, output-folder open action, and manual skip control.
- Kept batch outputs in a derived `relay-batch-output` directory using save-copy only semantics.

#### Tasks 175-179 Template library slice

Completed.

Artifacts:

- `docs/TEMPLATE_LIBRARY_DESIGN.md`
- `docs/TEMPLATE_LIBRARY_VERIFICATION.md`
- `packages/contracts/src/template.ts`
- `apps/desktop/src-tauri/src/template.rs`
- `apps/desktop/src-tauri/assets/templates/*.json`
- `apps/desktop/src/lib/components/TemplateBrowser.svelte`

Outcome:

- Added bundled and custom workflow template storage with CRUD commands.
- Added a template browser tab with category filtering, keyword search, apply-to-goal behavior, and custom delete support.
- Added completion-time template capture through `template_from_session`.

#### Tasks 180-183 Smart approval slice

Completed.

Artifacts:

- `docs/SMART_APPROVAL_DESIGN.md`
- `docs/SMART_APPROVAL_VERIFICATION.md`
- `packages/contracts/src/approval.ts`
- `apps/desktop/src-tauri/src/risk_evaluator.rs`
- `apps/desktop/src/lib/components/SettingsModal.svelte`
- `apps/desktop/src/lib/components/ActivityFeed.svelte`

Outcome:

- Added approval policy contracts and backend risk evaluation.
- Extended preview responses with `autoApproved`, `highestRisk`, and `approvalPolicy`.
- Added approval policy persistence in frontend continuity storage and surfaced auto-approved operations in the activity feed.

#### Verification

Commands run:

- `pnpm check`
- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result:

- Passed on 2026-04-02 in the current environment.

### Milestone 0

#### 1.1 Repository audit

Completed.

Artifact:

- `.taskmaster/docs/repo_audit.md`

Outcome:

- Confirmed the repository currently contains Task Master planning scaffolding only.
- Confirmed the PRD assumes application directories and code that do not yet exist.
- Established that implementation must proceed as a greenfield build-out.

#### 1.2 Planning document

Completed.

Artifact:

- `PLANS.md`

Outcome:

- Broke work into Milestones 0 through 5.
- Added milestone goals, change targets, acceptance criteria, verification commands, scope exclusions, and risks.
- Added the MVP draft completion conditions from the PRD.

#### 1.3 Repository operating rules

Completed.

Artifact:

- `AGENTS.md`

Outcome:

- Defined repository-specific execution, scope, verification, and documentation rules.
- Clarified that `.taskmaster/` is the only current scaffold and that implementation should avoid assuming hidden app code exists.

#### 1.4 Implementation log

Completed.

Artifact:

- `docs/IMPLEMENTATION.md`

Outcome:

- Created the persistent location for implementation decisions, progress notes, verification output, and known limitations.

### Milestone 1

#### 2.1-2.4 Monorepo and desktop build foundation

Completed.

Artifacts:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `Cargo.toml`
- `apps/desktop/package.json`
- `apps/desktop/svelte.config.js`
- `apps/desktop/vite.config.ts`
- `apps/desktop/tsconfig.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/icons/icon.png`
- `packages/contracts/package.json`

Outcome:

- Created a pnpm workspace that resolves the desktop app and shared contracts package without manual fixes.
- Aligned the desktop app with SvelteKit SPA mode and Tauri v2 build expectations, including the correct dev port and Tauri icon requirements.
- Allowed the required `esbuild` postinstall script through pnpm's build-script policy so Vite builds succeed non-interactively.
- Installed the Linux system packages needed for `webkit2gtk`, `gtk3`, and related Tauri build dependencies in this environment.
- Verified `pnpm check`, `pnpm typecheck`, `pnpm --filter @relay-agent/desktop build`, and `cargo check` all pass.

### Milestone 2

#### 3.1 Contracts audit

Completed.

Artifacts:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/meta.ts`
- `packages/contracts/src/shared.ts`
- `packages/contracts/src/core.ts`
- `packages/contracts/src/relay.ts`
- `packages/contracts/src/workbook.ts`

Outcome:

- Confirmed the contracts package previously contained only a `projectInfo` stub and none of the PRD-required relay or workbook entities.
- Confirmed there were no real cross-package schema references yet because the desktop app only consumed the stub metadata export.
- Established the concrete schema inventory needed for the next backend and frontend milestones.

#### 3.2-3.4 Shared schema implementation and exports

Completed.

Artifacts:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/meta.ts`
- `packages/contracts/src/shared.ts`
- `packages/contracts/src/core.ts`
- `packages/contracts/src/relay.ts`
- `packages/contracts/src/workbook.ts`

Outcome:

- Added Zod schema and inferred type pairs for `Session`, `Turn`, `Item`, `RelayPacket`, `CopilotTurnResponse`, `ToolDescriptor`, `SpreadsheetAction`, `WorkbookProfile`, and `DiffSummary`.
- Split the contracts package into focused modules and kept `index.ts` as the public export surface.
- Preserved the lightweight `projectInfo` metadata export so the desktop shell continues to compile against the shared package.

### Milestone 3

#### 4.1 Rust module scaffold

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/session.rs`
- `apps/desktop/src-tauri/src/relay.rs`
- `apps/desktop/src-tauri/src/execution.rs`

Outcome:

- Split the Tauri backend into dedicated `app`, `session`, `relay`, and `execution` modules instead of keeping all commands in one file.
- Added a small shared `DesktopState` and registered it with the Tauri builder so later lifecycle commands have a stable home for state.
- Registered placeholder commands for initialization, session listing, relay packet drafting, and execution preview so the typed IPC surface can grow without another structural refactor.

#### 4.2 Session and turn lifecycle commands

Completed.

Artifacts:

- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/session.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/Cargo.toml`

Outcome:

- Added contracts-side schemas for `initialize_app`, `create_session`, `read_session`, `start_turn`, and session-detail payloads so lifecycle command shapes now have a shared TypeScript source of truth.
- Implemented an in-memory backend storage abstraction for sessions and turns with validation, ID generation, and RFC3339 timestamps.
- Implemented Tauri commands for `initialize_app`, `create_session`, `list_sessions`, `read_session`, and `start_turn`.
- Added a Rust unit test that exercises create, list, read, and start-turn behavior on the storage layer.

#### 4.3 Relay submission, preview, approval, and execution commands

Completed.

Artifacts:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/relay.rs`
- `apps/desktop/src-tauri/src/execution.rs`
- `apps/desktop/src-tauri/src/lib.rs`

Outcome:

- Added shared contracts payloads for relay packet generation, pasted response submission, execution preview, approval response, and execution run commands.
- Replaced the relay and execution stubs with Tauri commands backed by in-memory relay state.
- Implemented a minimal JSON validator for pasted Copilot responses with structured validation issues and a repair prompt.
- Added preview synthesis that converts parsed actions into a provisional `DiffSummary` and enforces approval gating for write-capable actions.
- Implemented a safe execution endpoint that allows no-op completion for read-only action sets and explicitly refuses unsupported write execution while preserving preview and approval state.
- Added Rust tests that cover the packet-to-response-to-preview-to-approval-to-run flow and invalid response handling.

#### 4.4 Typed frontend IPC wrapper

Completed.

Artifacts:

- `apps/desktop/src/lib/ipc.ts`
- `apps/desktop/src/lib/index.ts`
- `apps/desktop/src/routes/+page.svelte`

Outcome:

- Replaced the ad hoc frontend `invoke` usage with a typed IPC wrapper that validates request and response payloads against the shared contracts package.
- Added typed wrapper functions for app initialization, session lifecycle, relay packet generation, pasted response validation, preview, approval, and execution commands.
- Exported the wrapper as a single frontend command surface and wired the desktop shell to call `initialize_app` through it.
- Updated the landing page to surface typed IPC state such as storage mode, session count, and supported relay modes.

### Milestone 4

#### 5.1 Application data directory layout

Completed.

Artifacts:

- `docs/STORAGE_LAYOUT.md`

Outcome:

- Defined the app-local storage root as `storage-v1` under Tauri's app-local data directory.
- Specified canonical locations for session records, turn records, artifacts, and logs.
- Fixed naming rules around UUID-based filenames, camelCase JSON payloads, RFC3339 timestamps, and NDJSON logs.
- Defined the lookup and recovery contract for `initialize_app`, `list_sessions`, `read_session`, artifact lookup, and later index rebuild behavior.
- Clarified that user-facing save-copy outputs stay at their chosen destination and are referenced from artifact metadata rather than moved into the app data directory.

#### 5.2 Local JSON session persistence and reload

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/models.rs`

Outcome:

- Replaced the desktop runtime's session storage mode with app-local JSON persistence rooted at Tauri's app-local data directory plus `storage-v1`.
- Added manifest and session index management plus canonical `session.json` and `turns/{turnId}.json` writes using a temporary-file-and-rename pattern.
- Reloaded persisted sessions and turns during app startup so `initialize_app`, `list_sessions`, and `read_session` reflect previous runs without rebuilding the UI state manually.
- Kept relay packet, response, preview, and approval caches in memory for now while ensuring session and turn status changes are flushed to disk.
- Added a Rust test that creates persisted records, reopens storage, and confirms `list_sessions` and `read_session` survive a restart boundary.

#### 5.3 Turn-linked artifacts and logs

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`

Outcome:

- Added persisted artifact metadata and payload records under each session's `artifacts/{artifactId}/` directory for relay packets, pasted responses, validation results, previews, approval decisions, and execution results.
- Linked persisted artifact IDs back into `turn.itemIds` so reloaded turn records retain stable references to their on-disk history.
- Added `session.ndjson` and `{turnId}.ndjson` append-only log emission for session creation, turn start, packet generation, response validation, preview creation, approval decisions, and execution attempts.
- Preserved save-copy semantics by recording user-selected output paths in execution artifact metadata without moving those outputs into the app-local storage root.
- Added a Rust test that runs the relay flow, reloads the session, and verifies artifact metadata, payload files, log files, and turn linkage all persist correctly.

#### 5.4 Restart recovery and session list verification

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added restart-focused regression coverage for multiple persisted sessions so the on-disk session index is checked alongside `list_sessions` and `read_session`.
- Verified that reopening app-local storage preserves both draft and active sessions, including `latestTurnId` linkage for the active session.
- Confirmed that the persisted `sessions/index.json` entries match the session IDs returned after reload, so the session list remains aligned with disk state across relaunches.

### Frontend MVP Flow Foundation

#### 6.1 App shell and primary routes

Completed.

Artifacts:

- `apps/desktop/src/routes/+layout.svelte`
- `apps/desktop/src/routes/+page.svelte`
- `apps/desktop/src/routes/studio/+page.svelte`
- `apps/desktop/src/routes/settings/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a shared desktop route shell with persistent navigation for Home, Studio, and Settings so the frontend no longer hangs off a single landing page.
- Kept the existing typed IPC initialization snapshot on Home while reshaping the page into a route-aware session hub placeholder for the next subtask.
- Added a three-pane Studio placeholder route that reserves stable regions for timeline, workflow controls, and workbook preview work without pulling in session state early.
- Added a Settings route for MVP execution and storage policies so later UI work has a stable location for safety and local-behavior controls.

#### 6.2 Home session list and creation flow

Completed.

Artifacts:

- `apps/desktop/src/routes/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the static Home placeholder with a real session hub that loads persisted sessions through `list_sessions` and surfaces the current typed IPC/storage snapshot.
- Added a create-session form that calls `create_session`, updates the visible session list immediately, and keeps workbook path optional for the current MVP slice.
- Added session cards that expose status, turn count, updated timestamp, persisted workbook path, and a Studio handoff link carrying the `sessionId` in the route query.
- Kept the implementation local to Home so the upcoming Studio state task can layer session detail loading onto a stable session-entry surface instead of rebuilding the route.

#### 6.3 Studio panes and local state model

Completed.

Artifacts:

- `apps/desktop/src/lib/studio-state.ts`
- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the Studio placeholder with a real three-pane workspace for timeline, workflow, and workbook preview responsibilities.
- Added a minimal store-backed Studio state model that tracks the selected `sessionId`, turn draft fields, staged packet text, pasted response text, local validation notes, and preview notes.
- Wired the route query handoff into the store so Home can pass a selected session into Studio before backend detail loading exists.
- Added derived timeline and workbook-preview state so edits in the workflow pane immediately show up in the correct left and right panes without waiting for backend command wiring.

#### 6.4 Studio backend command wiring and validation feedback

Completed.

Artifacts:

- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the Studio route's local-only placeholders with a command-backed flow that loads session detail through `read_session` and surfaces persisted turns in the left pane.
- Wired `start_turn`, `generate_relay_packet`, `submit_copilot_response`, and `preview_execution` through the typed frontend IPC layer so the Studio workflow now advances through the real backend lifecycle.
- Added structured validation rendering for accepted responses, issue lists, and repair prompts, plus preview rendering for output-path, approval-gate, warnings, and per-sheet diff summary data.
- Added an explicit reload note for persisted turns because session history survives restart while in-memory relay caches still need to be regenerated in the current app run.

### Workbook Engine Foundation

#### 8.1 Workbook library selection and module boundaries

Completed.

Artifacts:

- `docs/WORKBOOK_ENGINE.md`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/source.rs`
- `apps/desktop/src-tauri/src/workbook/csv_backend.rs`
- `apps/desktop/src-tauri/src/workbook/xlsx_backend.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`

Outcome:

- Selected `csv` as the CSV-first read/write dependency and `calamine` as the limited xlsx-family read dependency, matching the MVP guardrail that spreadsheet mutation should stay CSV-first and xlsx should stay inspect-oriented.
- Added a dedicated Rust `workbook` module boundary that separates source detection, CSV backend setup, xlsx backend setup, inspect policy, and preview gating instead of continuing to grow workbook logic inside `storage.rs`.
- Added Rust-side workbook model types for `WorkbookFormat`, `WorkbookSheet`, and `WorkbookProfile` so the backend now has a stable shape for the upcoming inspect tools.
- Moved derived save-copy output-path logic behind the new workbook module so preview synthesis already depends on the new engine boundary for source-path handling.

#### 8.2 Read-side workbook tools

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/persistence.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Implemented `workbook.inspect`, `sheet.preview`, and `sheet.profile_columns` for CSV inputs, with limited xlsx read support through the same workbook engine boundary.
- Added typed Rust payloads for sheet preview rows and column profile summaries, including CSV-first type inference for integer, number, boolean, date, and string columns.
- Wired read-side tool execution into `preview_execution` so pasted responses that request inspect tools now produce persisted artifacts and turn-log entries during preview generation.
- Implemented `session.diff_from_base` as a read-side artifact resolver that can return the current diff summary or a persisted preview/diff artifact when an `artifactId` is supplied.

#### 8.3 Core CSV-first write-preview tools

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
- `apps/desktop/src-tauri/src/workbook/mod.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `docs/WORKBOOK_ENGINE.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the synthetic diff builder in `storage.rs` with a workbook-engine preview path that loads real CSV headers and row data before summarizing mutations.
- Implemented CSV-backed preview behavior for `table.rename_columns`, `table.cast_columns`, `table.filter_rows`, and `table.derive_column`, including sequential table-state updates, duplicate-header rejection, and derived save-copy path handling.
- Added a narrow preview expression and predicate grammar that supports bracketed column references for headers with spaces, basic arithmetic or string concatenation in `derive_column`, and single-comparison `filter_rows` predicates so preview can compute actual affected row counts for the supported MVP slice.
- Added workbook preview unit tests plus storage-level preview regressions that now use real CSV fixtures instead of placeholder workbook paths.

#### 8.4 Aggregation, save-copy support, and CSV demo verification

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Implemented real CSV-backed `table.group_aggregate` preview behavior, including grouped row synthesis, post-aggregation schema diffs, and numeric-aggregation warnings when non-numeric values are ignored.
- Tightened `workbook.save_copy` preview handling so copy-only xlsx plans are accepted, explicit output paths cannot point at the original source workbook, and derived output paths remain available when a write preview omits an explicit save-copy action.
- Added workbook preview regressions plus a storage-level demo regression that verify aggregated CSV output can be rendered from staged table state, inspect-plus-aggregate preview works through `preview_execution`, copy-only xlsx save-copy previews succeed, and the original CSV input remains unchanged after preview generation.
- Left `join_lookup` out of the MVP tool surface for now so the workbook slice stays aligned with the planned safe vertical slice.

#### 9.1 Preview payload and diff summary structure

Completed.

Artifacts:

- `packages/contracts/src/workbook.ts`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Standardized the preview payload around explicit target context by adding a `target` object per diff entry plus top-level `targetCount` and `estimatedAffectedRows` summary fields.
- Kept the existing `sheets` collection name for compatibility while making each entry explicit enough to support later approval UI work for sheet- or table-oriented previews.
- Updated the Rust preview engine and persisted preview artifacts so the richer shape is produced by `preview_execution` rather than being a contracts-only stub.
- Updated the Studio diff pane to consume the new payload fields without widening the UI scope into approval controls ahead of Task `9.3`.

#### 9.2 Backend preview generation from parsed actions

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Kept `preview_execution` backed by the real workbook preview engine so validated action plans continue to produce target-aware diff summaries, affected-row estimates, output-path planning, and warning propagation before any write is allowed.
- Added a storage-level regression that drives parsed CSV write actions through the real session, relay-packet, response-validation, and preview path, then asserts the backend returns concrete column diffs, row estimates, and save-copy output metadata.
- Left Studio approval controls and save-copy execution out of scope for this task so the remaining Milestone 9 work stays focused on UI gating and write-time safeguards.

#### 9.3 Render diff preview and approval flow in the Studio UI

Completed.

Artifacts:

- `apps/desktop/src/routes/studio/+page.svelte`
- `docs/IMPLEMENTATION.md`

Outcome:

- Extended the Studio timeline and right-side preview pane to show approval and execution stages alongside the existing preview diff summary.
- Added approval-note entry plus explicit approve/reject controls that call the typed IPC approval command and update execution readiness in the UI from live preview state and refreshed turn status.
- Added execution gating in the Studio preview pane so execution cannot be requested until a write-capable preview has been approved, while still surfacing the backend execution response and warnings for the current turn.

#### 9.4 Enforce save-copy only execution safeguards and CSV sanitization

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/workbook/preview.rs`
- `apps/desktop/src-tauri/src/workbook/engine.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added workbook-engine-backed save-copy execution so approved CSV write actions now replay through the same staged transform path used for preview before writing a new output file.
- Replaced the write-execution stub in storage with real execution that keeps the original source workbook read-only, records executed artifacts and logs, and still refuses write runs until preview and approval have completed.
- Added CSV output sanitization that prefixes cells starting with `=`, `+`, `-`, or `@` before save-copy output is written, and covered the behavior with storage regressions for approval gating, executed output generation, source immutability, and dangerous-prefix neutralization.

#### 10.1 Example CSV asset for the MVP demo flow

Completed.

Artifacts:

- `examples/revenue-workflow-demo.csv`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a compact demo CSV under `examples/` that can drive the current MVP inspect, preview, approval, and save-copy workflow without extra setup.
- Chose columns and values that match the implemented tool surface: booleans and dates for inspect and filter flows, numeric plus non-numeric `amount` values for cast or aggregation warnings, and formula-like leading characters in `comment` values so CSV sanitization can be demonstrated on save-copy output.

#### 10.2 README setup, demo flow, and packet or response examples

Completed.

Artifacts:

- `README.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Replaced the placeholder README with real setup instructions, desktop run commands, a representative Studio demo flow, and the demo CSV location under `examples/`.
- Added a representative relay packet example plus a valid pasted Copilot response example that matches the implemented contracts and current Studio approval or execution flow.
- Documented the current MVP limitations in README so unsupported workbook paths and execution behaviors are explicit instead of implied.

#### 10.3 Keep `docs/IMPLEMENTATION.md` aligned with milestones and verification results

Completed.

Artifacts:

- `docs/IMPLEMENTATION.md`

Outcome:

- Reconciled the implementation log after the Milestone 5 documentation work so completed tasks, current status, verification notes, known limitations, and next planned work all reflect the real repository state.
- Kept the log focused on shipped behavior by pointing the current phase and next-step sections at the remaining manual walkthrough task instead of the already-finished CSV asset or README updates.

#### 10.4 Run the documented demo flow and reconcile docs with reality

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/storage.rs`
- `README.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Added a storage-level regression that exercises the README demo path against the real example CSV: create session, start turn, generate packet, validate the documented response shape, preview, approve, execute, and assert the save-copy output plus source-file immutability.
- Tightened the README walkthrough by making the `workbook.save_copy` example path explicitly operator-supplied and writable, and by documenting the concrete bundled-sample outcome of 3 approved output rows with 3 sanitized `comment` cells.
- Reconciled the implementation log so the milestone status, known limitations, and next-step section reflect that the documented demo flow has now been verified instead of remaining a pending manual task.

### Follow-up Milestone 11

#### 11.1 Define packaging, installer, and update policy for the first supported OS

Completed.

Artifacts:

- `docs/PACKAGING_POLICY.md`
- `apps/desktop/src-tauri/tauri.windows.conf.json`
- `PLANS.md`
- `docs/IMPLEMENTATION.md`

Outcome:

- Fixed the first packaged end-user release path to Windows 10/11 x64 using the `x86_64-pc-windows-msvc` target and an NSIS installer.
- Kept the base Tauri config cross-platform for development while adding a Windows-specific override that narrows bundle output to `nsis`.
- Chose manual installer-driven updates for the first non-engineer release track and documented that upgrade installs are expected to preserve app-local storage under the existing app identifier.
- Left macOS, Linux end-user packaging, MSI rollout, and in-app updater infrastructure deferred instead of implying they are already supported.

#### 11.2 Implement startup preflight, friendly failure states, and self-recovery

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src-tauri/src/storage.rs`
- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/routes/+page.svelte`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Outcome:

- Changed Tauri startup so storage initialization failure no longer aborts the desktop app; the shell now falls back to temporary in-memory mode and records a recoverable startup preflight issue.
- Extended `initialize_app` to return `startupStatus` plus a plain-language `startupIssue` containing the problem, reason, next steps, recovery actions, and storage path when available.
- Added retry-based storage recovery inside `initialize_app`, so Home can re-run startup checks and switch back to local JSON storage if the underlying storage issue is cleared.
- Updated Home to show the startup warning state, offer retry or temporary-mode continuation, and block persisted session creation until the user either resolves the issue or explicitly continues in temporary mode.
- Added Rust unit coverage for startup recovery and path-unavailable fallback behavior.

#### 11.3 Build first-run welcome, sample/custom entry, and permission rationale

Completed.

Artifacts:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/routes/+page.svelte`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Outcome:

- Added startup metadata for a best-effort sample workbook path so Home can offer a real sample-start CTA when the bundled demo CSV is discoverable.
- Added a first-run welcome surface on Home that emphasizes save-copy safety, offers `Try the sample flow` and `Use my own file` entry points, and prioritizes those choices before the normal session list.
- Wired the sample CTA to preload the bundled demo path plus a safe starter objective, while the custom CTA focuses the workbook-path field and keeps the session draft in business-language wording.
- Added a pre-permission rationale card and inline note that explain why Windows may ask for file or destination access before any system dialog appears.

#### 11.4 Align packaged-startup docs and verification with the implemented flow

Completed.

Artifacts:

- `README.md`
- `PLANS.md`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Outcome:

- Updated the README to document the currently testable startup behavior from source, including the first-run sample/custom choice, startup recovery behavior, and the distinction between verified source-run instructions and the future packaged installer path.
- Clarified in planning docs that `docs/PACKAGING_POLICY.md` is the source for packaged end-user policy, while `README.md` stays limited to verified source-run behavior until installer builds are testable.
- Kept the follow-up implementation log and Task Master graph aligned with the current startup flow instead of leaving the README on the older manual-only Home walkthrough.
- Added a support-facing `Copy startup details` action on the Home startup-warning surface so non-engineer users can share the current startup summary without using the terminal.

### Follow-up Milestone 12

#### 12.1 Explain local-only storage, retention, and deletion behavior

Completed.

Artifacts:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src-tauri/src/storage.rs`
- `apps/desktop/src-tauri/src/app.rs`
- `apps/desktop/src/routes/+page.svelte`
- `apps/desktop/src/routes/settings/+page.svelte`
- `docs/IMPLEMENTATION.md`
- `.taskmaster/tasks/tasks.json`

Outcome:

- Extended `initialize_app` to return the current `storagePath`, letting the UI show the actual `storage-v1` location when local storage is available.
- Added a Home trust panel that explains which records stay local, that nothing is auto-sent externally, and that saved work can currently be removed by deleting the shown storage folder after closing the app.
- Reworked Settings into a live policy page that explains local-only retention, clarifies that save-copy outputs stay in the user-selected destination, and shows the current deletion path or fallback state when storage is unavailable.
- Kept the explanation user-facing and operational, so non-engineers do not need to read `docs/STORAGE_LAYOUT.md` to understand what stays on-device and how to clear it today.

## Decisions

- Treat the repository as greenfield apart from `.taskmaster/`.
- Keep Task Master task state aligned with real artifacts, not only intent.
- Finish planning artifacts before creating application code.
- Use CSV-first delivery as the MVP center of gravity once implementation begins.
- Allow `esbuild` as an approved pnpm build dependency so installs remain reproducible and non-interactive.
- Use SvelteKit `kit.alias` instead of tsconfig `paths` for app-local aliasing to avoid drift against the generated `.svelte-kit/tsconfig.json`.
- Keep `packages/contracts` source-first and modular until a compiled distribution artifact is actually needed.
- Keep the workbook stack limited to `csv` plus `calamine` until the CSV-first inspect and preview slice proves a heavier engine is necessary.
- Keep write-preview expression parsing intentionally narrow until save-copy execution exists: bracketed column references for spaced headers, one comparison in `filter_rows`, and basic arithmetic or string concatenation in `derive_column`.
- Capture non-engineer UX simplification as a separate follow-up PRD instead of retroactively widening the completed MVP milestone set, with startup simplicity, distribution/recovery/diagnostics UX, data-handling clarity, permission/constraint clarity, locale/csv compatibility, resumable-work UX, crash recovery, progress visibility, template starts, output-name safety, duplicate-run prevention, safe defaults, reviewer-friendly summaries, read-only review, inline help, pre-copy sensitivity warnings, local audit history, accessibility baselines, and execution-phase simplification called out as the primary next planning targets.
- Decompose that follow-up PRD into Task Master tasks `11` through `16` so the post-MVP scope can be worked milestone by milestone instead of remaining a narrative-only planning artifact.
- Treat Windows 10/11 x64 plus an NSIS installer as the first official end-user packaging target, keep updates manual until signing and updater infrastructure exist, and require upgrade installs to preserve app-local storage.
- Let the desktop shell continue launching when local storage startup fails, but surface that failure as a plain-language preflight issue and keep retry-driven recovery inside `initialize_app` instead of crashing the app at boot.
- Use Home as the first-run onboarding surface for now, with sample/custom entry choices and pre-permission guidance driven by `initialize_app` metadata instead of waiting for a separate onboarding route.
- Keep `README.md` limited to behavior that can be run and verified from source today, and point packaged end-user policy at `docs/PACKAGING_POLICY.md` until installer builds are actually testable.
- Expose the actual `storage-v1` path through `initialize_app` so Home and Settings can explain deletion and retention behavior with the real current location instead of generic wording.

## Verification Log

### 2026-03-28

Repository audit verification:

```bash
find /workspace/Relay_Agent -maxdepth 4 -type f | sort
```

Observed result:

- Only planning files and Task Master scaffolding were present.

Task graph verification:

```bash
jq empty .taskmaster/tasks/tasks.json
task-master validate-dependencies
task-master list --with-subtasks --json
```

Observed result:

- Task graph JSON is valid.
- Task Master dependency validation passed.
- Parent tasks and subtasks are recognized by Task Master.

Planning artifact verification:

```bash
test -f .taskmaster/docs/repo_audit.md
test -f PLANS.md
test -f AGENTS.md
test -f docs/IMPLEMENTATION.md
rg -n "^## Milestone|^### Goal|^### Change Targets|^### Acceptance Criteria|^### Verification Commands|^### Out of Scope|^### Risks and Mitigations|^## Draft Completion Conditions|^## Global Scope Exclusions" PLANS.md
```

Observed result:

- All planning files exist.
- `PLANS.md` contains the required milestone and planning sections.

Milestone 1 foundation verification:

```bash
pnpm install
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check
```

Observed result:

- The pnpm workspace resolves all three packages and runs the required install-time scripts successfully.
- SvelteKit check and typecheck pass for the desktop app and contracts package.
- The desktop production build succeeds and writes the SPA output to `apps/desktop/build`.
- `cargo check` succeeds for the Tauri workspace after installing the required Linux dependencies and adding a valid RGBA icon asset.

Milestone 2 contracts verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check
```

Observed result:

- The expanded contracts package compiles cleanly and remains consumable from the desktop app through the workspace package boundary.
- Desktop build and Rust check still pass after replacing the contracts stub with the shared schema surface.

Milestone 3 Rust scaffold verification:

```bash
. "$HOME/.cargo/env" && cargo check
pnpm check
pnpm typecheck
```

Observed result:

- The refactored Tauri module layout compiles and the command registration paths resolve correctly.
- Workspace JS and Svelte type checks still pass after the backend module split.

Milestone 3 lifecycle verification:

```bash
. "$HOME/.cargo/env" && cargo check
. "$HOME/.cargo/env" && cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust lifecycle commands compile successfully with the new in-memory storage abstraction and shared payload models.
- The storage-layer unit test passes for create-session, start-turn, and read-session behavior.
- The contracts package changes remain compatible with the desktop workspace typecheck and production build.

Milestone 3 relay command verification:

```bash
. "$HOME/.cargo/env" && cargo check
. "$HOME/.cargo/env" && cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The backend command surface for packet generation, response submission, preview, approval, and execution compiles and remains registered with Tauri.
- Rust tests pass for valid relay flow and invalid pasted-response validation cases.
- Workspace JS and Svelte checks still pass, and the desktop production build remains green after the contracts and backend relay changes.

Milestone 3 frontend IPC verification:

```bash
. "$HOME/.cargo/env" && cargo check
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The frontend IPC wrapper compiles cleanly against the shared contracts package and the existing Tauri command names.
- Svelte check and workspace typecheck pass with the updated desktop shell consuming `initialize_app` through the typed wrapper.
- The desktop production build still succeeds after the IPC wrapper and page integration changes.

Milestone 4 storage layout verification:

```bash
test -f docs/STORAGE_LAYOUT.md
rg -n "^## Root Layout|^## Record Roles|^## Naming Conventions|^## Lookup and Reload|^## Write Rules|^## Deferred To Later Tasks" docs/STORAGE_LAYOUT.md
```

Observed result:

- The storage layout document exists.
- The layout definition covers sessions, turns, artifacts, logs, naming rules, reload behavior, and deferred implementation boundaries without ambiguity.

Milestone 4 local JSON persistence verification:

```bash
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- The Tauri desktop crate compiles with the new app-local JSON storage bootstrap and persistence helpers.
- Rust tests pass for the existing relay flow coverage plus restart-safe session and turn reload behavior.
- Workspace typecheck, Svelte check, and the desktop production build remain green after switching the runtime storage mode from memory to local JSON.

Milestone 4 artifact and log persistence verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting succeeds now that `rustfmt` is installed in the active toolchain.
- The desktop crate compiles after adding persisted artifact metadata, payload writes, and NDJSON log append helpers.
- Rust tests pass for both restart-safe session reload and persisted turn artifact and log linkage.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the storage layer started writing artifact and log records.

Milestone 4 restart recovery verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting still succeeds after adding the restart recovery regression coverage.
- The desktop crate compiles and the storage test suite now covers multiple-session restart recovery plus persisted session index consistency.
- Workspace typecheck, Svelte check, and the desktop production build remain green after closing the persistence milestone acceptance checks.

Frontend route shell verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte route compilation passes with the new shared layout and the added Home, Studio, and Settings pages.
- Workspace typecheck remains green after introducing the route shell and shared UI utility styles.
- The desktop production build succeeds and emits the new route entries without navigation or bundling errors.

Home session flow verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Home page now invoking `initialize_app`, `list_sessions`, and `create_session` through the typed IPC wrapper.
- Workspace typecheck remains green after adding the Home session form, optimistic list update, and persisted session card rendering.
- The desktop production build succeeds with the new Home route UI and Studio handoff links.
- Interactive desktop click-through for create-and-open was not run in this headless environment, so that last acceptance check remains a manual confirmation step.

Studio pane state verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Studio route consuming a shared local state store and route query handoff.
- Workspace typecheck remains green after introducing the store-backed timeline, workflow, and workbook preview models.
- The desktop production build succeeds with the larger Studio route and its new `$lib/studio-state.ts` module.
- Interactive route walkthrough for typing into each pane and confirming updates visually remains a manual verification step in a real desktop session.

Studio backend wiring verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Svelte check passes with the Studio route now invoking `read_session`, `start_turn`, `generate_relay_packet`, `submit_copilot_response`, and `preview_execution`.
- Workspace typecheck remains green after adding backend response rendering, validation issue formatting, and preview diff summary panels to the Studio route.
- The desktop production build succeeds with the command-backed Studio workflow and the expanded mobile-safe layout styles.
- Full desktop click-through for starting a turn, pasting a valid or invalid response, and requesting preview still needs to be confirmed manually in a real Tauri session.

Workbook engine boundary verification:

```bash
cargo fmt --all
cargo check
cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- Rust formatting succeeds after adding the dedicated workbook module tree and the new Cargo dependencies.
- `cargo check` succeeds with `csv` and `calamine` resolved into the desktop crate and the preview layer consuming the new save-copy path helper from `workbook::source`.
- `cargo test` passes for the new workbook boundary coverage, including source-format detection, derived save-copy paths, and CSV-versus-xlsx preview strategy selection.
- Workspace typecheck, Svelte check, and the desktop production build remain green after adding the Rust workbook foundation files and workbook-related model types.

Read-side workbook tool verification:

```bash
cargo fmt --all
cargo check
cargo test
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo check` succeeds with the workbook engine now compiling real `workbook.inspect`, `sheet.preview`, `sheet.profile_columns`, and `session.diff_from_base` implementations.
- `cargo test` passes for the new CSV inspection coverage plus the preview-flow regression that verifies read-side tool artifacts are persisted during preview generation.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the Rust preview flow started recording workbook-profile, sheet-preview, column-profile, and diff-summary artifacts.
- Manual desktop verification for rendering these new read-side artifacts in the Studio right pane is still pending because the current UI only reads preview summary data.

Core CSV write-preview verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo fmt`, `cargo check`, and `cargo test` all pass after moving write-preview synthesis into `workbook::preview` and delegating `preview_execution` to the workbook engine.
- Rust tests now cover real CSV-backed rename, cast, filter, and derive preview behavior, including bracketed column references for spaced headers and end-to-end preview or approval storage flow with actual CSV fixtures.
- Workspace typecheck, Svelte check, and the desktop production build remain green after the preview path stopped relying on the synthetic diff builder.
- This environment did not have Rust or the required Tauri GTK/WebKit development libraries preinstalled, so verification also included installing the stable Rust toolchain plus Debian `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `zlib1g-dev`.

Aggregation and save-copy preview verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` now covers real CSV `table.group_aggregate` preview behavior, copy-only xlsx save-copy planning, save-copy target-path rejection, source-file immutability, and a storage-level CSV demo flow that runs inspect plus aggregation through `preview_execution`.
- `cargo check`, workspace `pnpm check`, `pnpm typecheck`, and the desktop production build all pass after the aggregation and save-copy preview changes.

Preview payload structure verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with the updated `DiffSummary` shape, including preview regressions that now assert `targetCount`, `estimatedAffectedRows`, and explicit sheet target metadata.
- `cargo check` succeeds after aligning the Rust preview models, workbook preview generation, and storage-layer preview assertions to the new payload fields.
- `pnpm check`, `pnpm typecheck`, and the desktop production build all pass after the Studio UI switched from ad hoc `sheet` or `estimatedRows` fields to the standardized preview target structure.

Backend preview generation verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with a storage-level regression that submits parsed CSV write actions and verifies `preview_execution` returns concrete changed-column, added-column, affected-row, and output-path summary data before any run step.
- `cargo check` succeeds with backend preview generation still routed through the workbook engine rather than placeholder diff synthesis.
- `pnpm check`, `pnpm typecheck`, and the desktop production build continue to pass with no additional frontend scope added for Task `9.2`.

Studio approval flow verification:

```bash
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `pnpm check` and `pnpm typecheck` pass with the Studio route now wiring approval decisions, execution gating, and backend execution-result rendering into the preview pane without Svelte diagnostics.
- The desktop production build succeeds after adding preview-side approval note entry, approve/reject actions, and execution readiness messaging on top of the existing diff UI.
- `cargo check` remains green after the UI changes, confirming the frontend stayed aligned with the existing Rust approval and execution IPC surface.

Save-copy execution and sanitization verification:

```bash
cargo fmt --all
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `cargo test` passes with 23 tests, including storage regressions that confirm write execution stays blocked before approval, approved CSV actions write to a save-copy output, the original CSV input remains unchanged, persisted execution artifacts keep their output path metadata, and dangerous CSV-leading prefixes are sanitized in the written copy.
- `cargo check` succeeds after routing `run_execution` through the workbook engine instead of the previous write stub.
- `pnpm check`, `pnpm typecheck`, and the desktop production build remain green after the Studio approval and execution UI starts consuming successful execution responses from the backend.

Example CSV asset verification:

```bash
node -e "const fs=require('fs'); const path='examples/revenue-workflow-demo.csv'; const text=fs.readFileSync(path,'utf8').trim(); const rows=text.split(/\\r?\\n/); const header=rows[0].split(','); if (rows.length !== 6) throw new Error(`expected 6 rows including header, found ${rows.length}`); if (!header.includes('amount') || !header.includes('approved') || !header.includes('comment')) throw new Error('demo CSV is missing required workflow columns'); if (!rows.some((row) => /,oops,/.test(row))) throw new Error('demo CSV should include a non-numeric amount example'); if (!rows.some((row) => /,(=|\\+|@)/.test(row))) throw new Error('demo CSV should include formula-like prefixes for sanitization demos'); console.log('demo csv ok');"
```

Observed result:

- The example CSV exists under `examples/`, has the expected six-line shape including header plus five sample rows, exposes the `amount`, `approved`, and `comment` columns needed by the current workflow, includes one non-numeric amount for warning scenarios, and includes formula-like leading characters for save-copy sanitization demos.

README coverage verification:

```bash
node - <<'NODE'
const fs = require('fs');
const readme = fs.readFileSync('README.md', 'utf8');
const requiredSections = [
  '## Requirements',
  '## Demo Flow',
  '## Relay Packet Example',
  '## Valid Copilot Response Example',
  '## Limitations'
];
for (const section of requiredSections) {
  if (!readme.includes(section)) {
    throw new Error(`README is missing required section: ${section}`);
  }
}
if (!readme.includes('examples/revenue-workflow-demo.csv')) {
  throw new Error('README does not reference the demo CSV asset');
}
const responseMatch = readme.match(
  /## Valid Copilot Response Example[\s\S]*?```json\n([\s\S]*?)\n```/
);
if (!responseMatch) {
  throw new Error('README does not contain the valid response JSON block');
}
const response = JSON.parse(responseMatch[1]);
if (!Array.isArray(response.actions) || response.actions.length === 0) {
  throw new Error('README response example does not include any actions');
}
if (response.actions.at(-1).tool !== 'workbook.save_copy') {
  throw new Error('README response example must end with workbook.save_copy');
}
console.log('readme ok');
NODE

jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- README now includes setup instructions, demo usage, a relay packet example, a valid pasted response example, and explicit limitations aligned with the current CSV-first MVP.
- The response example JSON parses successfully and ends in `workbook.save_copy`, matching the implemented save-copy approval flow.

Implementation log alignment verification:

```bash
rg -n '^## Status|^#### 10\.1|^#### 10\.2|^#### 10\.3|^#### 10\.4|^## Known Limitations|^## Next Step' docs/IMPLEMENTATION.md
jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- `docs/IMPLEMENTATION.md` includes the full Milestone 5 task set through `10.4`, an up-to-date status summary, explicit known limitations, and a next-step note that the current MVP plan has no remaining tasks.
- Task Master JSON remains valid after syncing the implementation-log task state.

Documented demo flow verification:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml readme_demo_flow_matches_documented_example_csv_workflow
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq empty .taskmaster/tasks/tasks.json
```

Observed result:

- The new regression passes against `examples/revenue-workflow-demo.csv`, confirming the README flow can create a session, start a plan-mode turn, validate the documented response shape, require approval, execute a save-copy output, sanitize the three dangerous `comment` cells, and leave the bundled source CSV unchanged.
- `pnpm check`, `pnpm typecheck`, and `pnpm --filter @relay-agent/desktop build` remain green after the README clarifications and storage-level walkthrough coverage.
- `cargo check` and `cargo test` pass with 24 total Rust tests, so Milestone 5 now ends with the documented demo path verified alongside the broader backend suite.
- Task Master JSON remains valid after closing the final Milestone 5 task.

### 2026-03-29

Non-engineer UX follow-up PRD verification:

```bash
test -f .taskmaster/docs/prd_non_engineer_ux.txt
rg -n '^# 非エンジニア向けUX強化PRD|^## Problem Statement|^## Development Roadmap|^## Acceptance Criteria|^### Capability: Easy Launch and First Run|^### Capability: Data Trust and File Readiness|^### Capability: Session Continuity|^### Capability: Guided Templates and Safe Defaults|^### Capability: Progress Visibility|^### Capability: Accessibility Baseline|権限|未保存|制約|承認者|アクセシビリティ|地域設定|CSV|二重実行|読み取り専用|ヘルプ|やり直し|破棄|異常終了|復旧|機密|個人情報|監査|操作履歴' .taskmaster/docs/prd_non_engineer_ux.txt
rg -n '^## Follow-up Scope Note' PLANS.md
jq '.master.tasks[] | select((.id | tonumber) >= 11 and (.id | tonumber) <= 16) | {id, title, status, dependencies}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The new supplemental PRD exists under `.taskmaster/docs/` and records a concrete post-MVP usability scope for non-engineer operators.
- The document now explicitly includes startup simplicity for non-engineers, including packaged-app-first launch expectations, first-run guidance, installer/update expectations, recovery guidance, and diagnostic-export behavior.
- The document now also covers data-handling clarity, file preflight checks, resumable drafts, recent-work access, and post-run next actions needed for everyday non-engineer operation.
- The document also adds progress visibility, template-driven starts, output-name collision avoidance, shareable completion paths, and safe-default behavior as explicit non-engineer requirements.
- The document now further covers permission-request explanations, unsaved-work warnings, early constraint surfacing, reviewer-friendly summaries, and accessibility baselines for non-engineer operation.
- The document now also covers locale or CSV compatibility guidance, duplicate-run prevention, read-only review mode, inline help, and clearer retry or discard choices for non-engineer operation.
- The document now also covers crash recovery after abnormal shutdown, pre-copy sensitivity warnings for confidential or personal data, and local audit history for later review or support handoff.
- The supplemental PRD is now decomposed in Task Master as follow-up tasks `11` through `16`, covering startup, data trust, continuity, onboarding, review/save simplification, and cross-cutting recovery plus accessibility work.
- The document continues to center execution-path simplification by collapsing the user-facing preview, approval, and save-copy flow into a clearer "review and save" experience while preserving the existing backend guardrails.
- `PLANS.md` now points future scope expansion at this follow-up PRD instead of silently widening the completed MVP milestone set.
- Task Master JSON remains valid and now includes the follow-up task breakdown for the supplemental non-engineer UX PRD.
- The updated planning artifacts also pass `git diff --check`, so the new task breakdown did not introduce whitespace or patch-format issues.

Packaging policy verification:

```bash
test -f docs/PACKAGING_POLICY.md
jq empty apps/desktop/src-tauri/tauri.windows.conf.json
rg -n 'Windows 10/11 x64|NSIS|manual installer|preserve app-local storage' docs/PACKAGING_POLICY.md PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "11") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `docs/PACKAGING_POLICY.md` now records a concrete first-release packaging policy for non-engineer distribution instead of leaving the installer and update path implicit.
- A Windows-specific Tauri override now narrows bundle output to `nsis` without changing the base cross-platform development config.
- `PLANS.md` and the implementation log now point at the same first-release decision: Windows 10/11 x64, NSIS installer, manual installer-driven updates, and preserved app-local storage across upgrades.
- Task Master subtask `11.1` is now marked done while parent task `11` remains pending for the later startup UX implementation subtasks.
- The updated docs and task graph continue to pass JSON validation and `git diff --check`.

Startup preflight recovery verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'startupStatus|startupIssue|retryInit|continueTemporaryMode' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/app.rs apps/desktop/src-tauri/src/state.rs apps/desktop/src/routes/+page.svelte
jq '.master.tasks[] | select(.id == "11") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Workspace typecheck passes after extending the IPC contract and Home route with startup preflight metadata.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes with 26 tests, including the new startup recovery coverage in `state.rs`.
- The shared contracts, Tauri command layer, startup state, and Home route now all reference the same `startupStatus` or `startupIssue` shape plus `retryInit` and `continueTemporaryMode` recovery actions.
- Task Master subtask `11.2` is now marked done while parent task `11` remains pending for first-run welcome and startup-doc alignment work.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Turn lifecycle details PRD verification:

```bash
test -f .taskmaster/docs/prd_turn_lifecycle_details.txt
rg -n '^# Turn Lifecycle Details PRD|^## Summary|^## Problem|^## Goals|^## Non-goals|^## Target Users|^## User Stories|^## UX Principles|^## Functional Requirements|^## Acceptance Criteria|^## Risks and Mitigations|^## Suggested Implementation Phases|Turn details|temporary mode|reviewer mode|TurnDetailsViewModel' .taskmaster/docs/prd_turn_lifecycle_details.txt
rg -n 'prd_turn_lifecycle_details|tasks `21` through `26`|planning-only' PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select((.id | tonumber) >= 21 and (.id | tonumber) <= 26) | {id, title, status, dependencies, priority}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_turn_lifecycle_details.txt` now captures the next scoped follow-up for extending `Inspection details` from workbook-only artifacts to turn lifecycle summaries covering packet, validation, approval, and execution.
- The PRD keeps the scope inspection-only and explicitly excludes restart-safe resume, portable review bundle export, raw JSON editing, richer xlsx execution, and any weakening of the current write guardrails.
- `PLANS.md` now points future scope expansion at this new PRD and records that Task Master tasks `21` through `26` are planning artifacts only until implementation work begins.
- Task Master now contains a six-task breakdown for the turn-lifecycle inspection follow-up, with contract, backend emission, resolver, UI shell, category renderers, and reviewer-history-doc integration split into dependency-ordered work items.
- Task Master JSON remains valid, and the planning-only artifact updates continue to pass `git diff --check`.

First-run welcome and permission-rationale verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'sampleWorkbookPath|Try the sample flow|Use my own file|Before Windows asks|permission' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/app.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/routes/+page.svelte
jq '.master.tasks[] | select(.id == "11") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Workspace typecheck still passes after extending startup metadata with an optional sample workbook path and wiring the Home route to first-run onboarding controls.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 26 tests after adding sample-path discovery in the Tauri startup layer.
- The contracts, Tauri startup path, and Home route all now reference the same sample-start and permission-rationale surfaces needed for the first-run welcome flow.
- Task Master subtask `11.3` is now marked done while parent task `11` remains pending for startup-doc alignment.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Startup docs-alignment verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Home Startup Behavior|Try the sample flow|Continue in temporary mode|PACKAGING_POLICY' README.md PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "11") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The README now documents the implemented Home startup behavior instead of the older manual-only startup flow.
- `PLANS.md` and `docs/IMPLEMENTATION.md` now clearly separate packaged end-user policy from the currently verified source-run path.
- Typecheck and Rust tests still pass after the documentation updates, so the docs remain aligned with the current implementation rather than describing aspirational behavior.
- Task Master subtask `11.4` is now marked done and parent task `11` is now closed because the startup slice also exposes a support-facing startup-detail copy action.
- The updated docs and task graph continue to pass JSON validation and `git diff --check`.

Startup milestone completion verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Copy startup details|startup summary|Try the sample flow|Use my own file|Continue in temporary mode' apps/desktop/src/routes/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "11") | {id, status, updatedAt, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The Home route now exposes a copyable startup summary alongside retry, temporary-mode, and settings actions, covering the diagnostic support path for startup issues.
- README, planning docs, and the implementation log now describe the same startup slice: first-run welcome, sample/custom entry, permission rationale, startup recovery, and support-friendly startup details.
- Task Master task `11` is now marked done, and the next pending follow-up work starts at task `12`.
- The updated code, docs, and task graph continue to pass workspace verification and `git diff --check`.

Local-only storage guidance verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'storagePath|Data stays on this device|What stays local|Nothing is auto-sent|delete the folder' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/app.rs apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/settings/+page.svelte docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "12") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `initialize_app` now exposes `storagePath`, and both Home and Settings render local-only storage, no-auto-send behavior, and the current manual deletion path from that live value.
- Workspace typecheck and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still pass after the IPC, Home, and Settings changes.
- Task Master subtask `12.1` is now marked done while parent task `12` remains pending for file-readiness and safe-handoff work.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

File preflight and locale-guidance verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'preflight_workbook|csv-delimiter|locale-ambiguous-date|Check this file|Current guidance coverage' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/app.rs apps/desktop/src-tauri/src/workbook/preflight.rs apps/desktop/src/routes/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "12") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The typed IPC surface now exposes `preflight_workbook`, and Home uses it before session creation to surface plain-language file readiness, early constraint messages, and locale or CSV compatibility hints.
- The backend preflight covers unreadable paths, Excel lock files, unsupported extensions, CSV encoding and delimiter mismatches, CSV header-shape problems, locale-like number and date patterns, large-file warnings, and Excel inspect-only guidance.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` now passes with 29 tests including the new preflight coverage.
- README and Home now describe the same verified behavior: run a workbook check first, then continue once the file is ready.
- Task Master subtask `12.2` is now marked done while parent task `12` remains pending for copy-time sensitivity work.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Copy-time sensitivity warning verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'assess_copilot_handoff|Copy for Copilot|Copy anyway|sensitive' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/relay.rs apps/desktop/src-tauri/src/storage.rs apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "12") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The typed IPC surface now exposes `assess_copilot_handoff`, and Studio uses it before copying a relay packet to clipboard.
- The backend assessment checks workbook path keywords, current objective text, and available workbook column names for common personal-data, customer, employee, account, payroll, and confidentiality signals.
- Studio now shows a short caution with concrete reasons and "Copy anyway" only when those signals are present; otherwise the relay packet copies immediately.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` now passes with 30 tests including the new handoff-sensitivity coverage.
- README and Studio now describe the same verified behavior for the supported copy path.
- Task Master subtask `12.3` is now marked done while parent task `12` remains pending for the broader risky-input and handoff verification pass.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Risky-input and handoff verification coverage:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'preflight_workbook|csv-delimiter|locale-ambiguous-date|assess_copilot_handoff|Copy for Copilot|Copy anyway' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/app.rs apps/desktop/src-tauri/src/relay.rs apps/desktop/src-tauri/src/workbook/preflight.rs apps/desktop/src-tauri/src/storage.rs apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md
jq '.master.tasks[] | select(.id == "12") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Workspace typecheck still passes with the combined preflight and handoff-warning surface in place.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` now passes with 30 tests, covering blocked delimiter mismatches, locale-sensitive CSV hints, and copy-time sensitivity assessment against workbook column names.
- The codebase now surfaces unsupported files and locale or CSV mismatches before session creation, and it surfaces sensitivity cautions before packet copy rather than after preview or execution.
- README, Home, Studio, and the implementation log all describe the same supported verification path.
- Task Master subtask `12.4` is now marked done, and parent task `12` is now complete.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Resumable draft and recent-work verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'continuity|Recent work|Restored local draft|snapshot restored' apps/desktop/src/lib/continuity.ts apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "13") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The frontend now persists per-session Studio drafts in local storage, including turn title, turn objective, workbook path, pasted response text, relay packet text, execution summaries, and the last preview summary snapshot.
- Home now surfaces recent sessions and recent workbook paths from that same continuity layer so users can re-enter Studio without searching for the last file or session again.
- Studio now restores local draft state automatically when the matching session is reopened and makes it explicit when preview information came from a previous run rather than a fresh backend preview.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the continuity-layer changes.
- Task Master subtask `13.1` is now marked done while parent task `13` remains pending for abnormal-shutdown recovery and leave warnings.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Abnormal-shutdown recovery verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'listRecoverableStudioDrafts|Recovery available|restore that work|markStudioDraftClean' apps/desktop/src/lib/continuity.ts apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "13") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The continuity layer now flags drafts that were autosaved without a clean shutdown and exposes them as recoverable local work on the next launch.
- Home now shows a recovery prompt before first-run or normal recent-work flows so users can restore the autosaved session in Studio or discard it explicitly.
- Opening the affected session in Studio acknowledges that recovery state and restores the local draft, while normal route leave and normal unload now mark the draft as closed cleanly.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the recovery-prompt additions.
- Task Master subtask `13.2` is now marked done while parent task `13` remains pending for leave warnings and the final continuity verification pass.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Intentional-exit continuity verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Leave warning|Leave and keep draft|Leave and discard draft|Discard draft and switch turns|beforeNavigate' apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "13") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Studio now computes leave-risk state from local draft edits, staged response text, validation checkpoints, preview review state, and execution-ready previews before allowing route leave or destructive turn resets.
- In-app route leave and same-session replacement flows now stop on a plain-language dialog that distinguishes `Leave and keep draft`, `Leave and discard draft`, `Keep working on this draft`, and discard-and-continue actions.
- Browser or window close now falls back to the platform-native `beforeunload` prompt when risky continuity state is present, so the next launch can still recover that draft if the user leaves anyway.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the leave-warning additions.
- Task Master subtask `13.3` is now marked done while parent task `13` remains pending for the final continuity verification pass in `13.4`.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Continuity walkthrough artifact:

```bash
test -f docs/CONTINUITY_VERIFICATION.md
rg -n 'Scenario 1|Scenario 2|Scenario 3|Scenario 4|Scenario 5|Command Checks' docs/CONTINUITY_VERIFICATION.md
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select(.id == "13") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `docs/CONTINUITY_VERIFICATION.md` now captures a stable manual verification walkthrough for restart resume, abnormal-shutdown recovery, intentional keep-draft leave, intentional discard leave, and in-Studio draft replacement.
- The walkthrough keeps verification grounded in the current source-run build instead of assuming packaged-app automation or a frontend e2e runner that does not exist yet in this repo.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after adding the walkthrough artifact and closing task `13`.
- Task Master task `13` and subtask `13.4` are now marked done, while the next pending follow-up work shifts to task `14.1`.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Guided first-run onboarding verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Start your first task|First-time steps|What do you want done|Show changes first|Check my file safely' apps/desktop/src/routes/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "14") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Home first-run creation now stays focused on one clear choice first, then opens the session form only after the user chooses either the bundled sample path or their own file path.
- The create-session form now uses plainer labels such as `Task name`, `What do you want done?`, and `File to inspect`, plus short helper copy that keeps the wording in business language.
- Objective starter cards now let first-time users seed common goals without having to write internal workflow vocabulary on their own.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the onboarding copy and gating changes.
- Task Master subtask `14.1` is now marked done while parent task `14` remains pending for templates, inline help, and guided-flow verification.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Template-driven start verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Quick-start templates|Safe defaults already on|Rename columns|Change data types|Summarize totals' apps/desktop/src/routes/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "14") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Home now exposes quick-start templates for common spreadsheet tasks, including rename, type cleanup, filtering, and totals-style starts, so first-time users can prefill both task name and objective without writing the entire request from scratch.
- The create-session form now also shows an explicit `Safe defaults already on` note that keeps save-copy, review-first, and source-file protection visible without opening a separate settings surface.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the template and defaults changes.
- Task Master subtask `14.2` is now marked done while parent task `14` remains pending for inline help and the guided-flow verification pass.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Inline help verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Need help\\?|Quick help for this step|Need help with this step\\?|Show help|Hide help' apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "14") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Home now exposes a short first-run and create-step help panel that explains start choices, task wording, and file checks in plain language behind a `Show help` toggle.
- Studio now exposes a matching step help panel that updates its glossary cues for turn setup, packet handoff, pasted response, preview, approval, and save-copy stages.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after adding the inline help surfaces.
- Task Master subtask `14.3` is now marked done while parent task `14` remains pending only for the guided-flow verification pass.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Guided-flow walkthrough artifact:

```bash
test -f docs/GUIDED_FLOW_VERIFICATION.md
rg -n 'First-Run Sample Walkthrough|Load demo response|Real-File Guided Entry Check|Command Checks' docs/GUIDED_FLOW_VERIFICATION.md README.md apps/desktop/src/routes/studio/+page.svelte
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select(.id == "14") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `docs/GUIDED_FLOW_VERIFICATION.md` now captures a first-run sample walkthrough and a real-file entry check that rely on the in-product guidance, templates, help panels, and the new `Load demo response` path instead of the README.
- Studio now exposes `Load demo response` for the bundled sample workbook so a first-time user can validate and preview the sample flow without copying example JSON from documentation.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after closing the guided-flow loop.
- Task Master task `14` and subtask `14.4` are now marked done; the next pending follow-up work shifts to task `15.1`.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Review-and-save UX verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Review and save|Check changes|Save reviewed copy|Confirm review|Waiting for valid response' apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "15") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Studio now collapses the user-facing execution flow into `Prepare request`, `Bring back Copilot response`, and `Review and save`, while the backend preview and approval gates remain unchanged behind the scenes.
- The review pane now leads with one primary action that changes from `Check changes` to `Confirm review` to `Save reviewed copy`, so operators no longer have to understand backend stage names to continue.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the review-and-save wording changes.
- Task Master subtask `15.1` is now marked done while parent task `15` remains pending for review summary, reviewer-safe surfaces, and audit history.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Three-point review summary verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'What will change|How many rows|Where the new copy goes|Checking changes|Saving reviewed copy' apps/desktop/src/routes/studio/+page.svelte README.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select(.id == "15") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The review pane now surfaces a three-point summary for what will change, how many rows are affected, and where the reviewed copy will go before the save action is available.
- Review progress is now shown in plain language while Relay Agent is checking changes, confirming review, or saving the reviewed copy, rather than leaving the user with only button-spinner feedback.
- The reviewed-copy location now includes a plain-language safety note that explains why the original file remains protected.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after the summary and progress additions.
- Task Master subtask `15.2` is now marked done while parent task `15` remains pending for duplicate-run prevention, reviewer mode, and local audit history.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Reviewer mode and audit history verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'Recent saves|Read-only review mode|Copy review summary|Open reviewer view|Reviewed copy already saved' apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md
jq '.master.tasks[] | select(.id == "15") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Home now records recent reviewed saves with input, output, timestamp, and summary, and each save links directly into a read-only Studio reviewer view for the same turn.
- Studio now blocks duplicate save actions for already executed turns, exposes `Copy review summary`, and offers explicit post-save actions such as opening reviewer mode, returning Home, or starting another turn.
- Reviewer mode now hides editing, Copilot handoff, and save controls while still surfacing the summary cards, output path, warnings, and saved-turn status.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after closing task `15`.
- Task Master task `15` plus subtasks `15.3` and `15.4` are now marked done, while the next pending follow-up work shifts to task `16.1`.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Plain-language recovery, trust messaging, and accessibility verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
rg -n 'File safety|Copy follow-up prompt|could not trust this response yet|could not save a reviewed copy yet|aria-current|Read-only review mode' apps/desktop/src/routes/+page.svelte apps/desktop/src/routes/studio/+page.svelte README.md docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md
jq '.master.tasks[] | select(.id == "16") | {id, status, subtasks: [.subtasks[] | {id, status}]}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Validation, preview, approval, and save failures now render as stable `problem`, `reason`, and `next steps` guidance in Studio instead of raw backend-only wording.
- Each repairable failure state now exposes a copyable Copilot follow-up prompt so a non-engineer can request a safer retry without composing new instructions from scratch.
- Home and Studio now keep file-safety messaging visible in plain language, reinforcing that the original workbook remains read-only and writes go only to a separate reviewed copy.
- Accessibility baselines are now explicitly reinforced through readable default control text sizing, stronger keyboard focus outlines, and `aria-current` markers on selected turns and the active timeline step so status does not rely on color alone.
- `docs/NON_ENGINEER_FOLLOWUP_VERIFICATION.md` now records the final manual verification checklist for the non-engineer follow-up set instead of leaving the acceptance pass implicit.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after closing task `16`.
- Task Master task `16` and subtasks `16.1` through `16.4` are now marked done, completing the current non-engineer follow-up task set.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Workbook artifact browser follow-up verification:

```bash
test -f .taskmaster/docs/prd_workbook_artifact_browser.txt
test -f docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md
rg -n 'read_turn_artifacts|Inspection details|Workbook profile|Sheet preview|Column profile|Checked changes snapshot|No saved inspection details yet' packages/contracts/src/ipc.ts apps/desktop/src-tauri/src/session.rs apps/desktop/src-tauri/src/storage.rs apps/desktop/src/routes/studio/+page.svelte README.md docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 17 and (.id | tonumber) <= 20) | {id, status, updatedAt}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_workbook_artifact_browser.txt` now captures the scoped follow-up for surfacing persisted workbook evidence inside Studio instead of relying on manual JSON inspection.
- The contracts package, frontend IPC wrapper, Tauri command layer, and storage layer now expose a typed read-only `read_turn_artifacts` flow for persisted `workbook-profile`, `sheet-preview`, `column-profile`, `diff-summary`, and `preview` artifacts.
- Studio now renders those persisted artifacts under `Inspection details`, including workbook structure cards, sampled row tables, column inference summaries, and diff or preview evidence, while keeping the surface read-only in both editable Studio and reviewer mode.
- The new browser now explains empty-state conditions in plain language, including turns that never created persisted workbook artifacts and temporary-mode runs that do not keep local artifact history across restart.
- `README.md`, `PLANS.md`, and this implementation log now describe the same shipped follow-up behavior, and `docs/WORKBOOK_ARTIFACT_BROWSER_VERIFICATION.md` records a stable manual verification checklist for the browser.
- Workspace typecheck still passes, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 30 tests after closing the artifact-browser follow-up.
- Task Master tasks `17` through `20` are now marked done, completing the current scoped follow-up set through the workbook artifact browser.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

Turn lifecycle details follow-up verification:

```bash
test -f .taskmaster/docs/prd_turn_lifecycle_details.txt
test -f docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md
rg -n 'turnDetailsViewModelSchema|turnOverviewSchema|packetInspectionSectionSchema|validationInspectionSectionSchema|approvalInspectionSectionSchema|executionInspectionSectionSchema' packages/contracts/src/ipc.ts
rg -n 'record_execution_failure|build_turn_details|read_turn_artifacts_persist_failed_execution_details_after_save_error|read_turn_artifacts_returns_live_turn_details_in_memory_mode' apps/desktop/src-tauri/src/storage.rs
rg -n 'Turn details|Workbook evidence|Packet details unavailable|Validation details unavailable|Approval state|Execution state' apps/desktop/src/routes/studio/+page.svelte README.md docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md
pnpm --filter @relay-agent/contracts typecheck
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 21 and (.id | tonumber) <= 26) | {id, status, updatedAt}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The shared contracts now define summary-first turn lifecycle inspection schemas for overview, packet, validation, approval, and execution, and `read_turn_artifacts` now returns a typed `turnDetails` payload alongside workbook artifacts.
- The Tauri storage layer now resolves turn details from both live runtime state and persisted local artifacts, so current turns, temporary mode, restarted sessions, and execution failures all have explicit read-only inspection output instead of falling back to workbook-only evidence.
- Execution failures are now recorded as lifecycle evidence rather than disappearing after an error toast. The new failure path persists an `execution` summary with the intended output path, reason summary, and warnings, and the selected turn moves to `Failed` without weakening any write guardrail.
- Studio `Inspection details` now renders a `Turn details` surface with `Overview`, `Packet`, `Validation`, `Approval`, and `Execution` tabs above the existing `Workbook evidence` browser, and reviewer mode continues to expose the same surface read-only.
- `README.md`, `PLANS.md`, and `docs/TURN_LIFECYCLE_DETAILS_VERIFICATION.md` now all describe the same shipped behavior, so the turn lifecycle follow-up is documented from PRD through verification artifact.
- `pnpm --filter @relay-agent/contracts typecheck`, workspace `pnpm typecheck`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` all pass after closing the follow-up. Rust test coverage now includes 32 passing tests, including live-memory and persisted execution-failure lifecycle inspection cases.
- Task Master tasks `21` through `26` are now marked done, completing the current turn-lifecycle inspection follow-up set.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

README lifecycle doc sync verification:

```bash
rg -n 'Turn details|Workbook evidence|Execution tab keeps the failed state|Check changes' README.md
git diff --check
```

Observed result:

- `README.md` now explicitly calls out that `Inspection details > Execution` keeps failed save-copy state, intended output path, and a plain-language reason summary so operators and reviewers know failure evidence survives reload.
- The demo flow wording now points readers at both `Turn details` and `Workbook evidence`, matching the shipped Studio IA instead of the earlier workbook-browser-only framing.
- The docs-only follow-up continues to pass `git diff --check`.

README and environment-template alignment verification:

```bash
rg -n '## Environment Variables|No `.env` file is required|Task Master and provider integration environment variables|NOT required to run the Relay Agent desktop app' README.md .env.example docs/IMPLEMENTATION.md
git diff --check
```

Observed result:

- `README.md` now states explicitly that the desktop app can start from source without copying `.env.example`, so the verified launch path and the environment setup guidance no longer conflict.
- `.env.example` now describes itself as a Task Master or provider integration template instead of a prerequisite for the local Tauri app.
- The comments in `.env.example` now line up with the current `.taskmaster/config.json` defaults by calling out Anthropic for main or fallback and Perplexity for research rather than implying every key is part of the normal app startup path.
- The docs-only alignment change continues to pass `git diff --check`.

Startup testing follow-up PRD verification:

```bash
test -f .taskmaster/docs/prd_startup_test_harness.txt
rg -n '^# Startup Test Harness PRD|^## Summary|^## Problem|^## Goals|^## Non-goals|^## Target Users|^## User Stories|^## UX Principles|^## Functional Requirements|^## Acceptance Criteria|^## Risks and Mitigations|^## Suggested Implementation Phases|startup smoke|retry-recovery|attention startup' .taskmaster/docs/prd_startup_test_harness.txt
rg -n 'prd_startup_test_harness|tasks `27` through `31`|planning-only' PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select((.id | tonumber) >= 27 and (.id | tonumber) <= 31) | {id, title, status, dependencies, priority}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_startup_test_harness.txt` now scopes the next follow-up around deterministic source-run startup testing rather than broader installer E2E or screenshot-based UI automation.
- The PRD fixes the acceptance target to a small startup-test surface: shared bootstrap helpers, a non-interactive smoke command, and a manual GUI verification artifact.
- `PLANS.md` now points the next planned scope at this new PRD, and Task Master now contains tasks `27` through `31` for shared startup helpers, a smoke command, verification docs, and final sync work.
- Task Master JSON remains valid, and the planning artifact updates continue to pass `git diff --check`.

Startup testing follow-up verification:

```bash
test -f .taskmaster/docs/prd_startup_test_harness.txt
test -f docs/STARTUP_TEST_VERIFICATION.md
rg -n 'startup:test|startup:smoke|startup_smoke|bootstrap_desktop_state|bootstrap_retry_recovery_state|build_initialize_app_response' package.json apps/desktop/package.json apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/startup.rs apps/desktop/src-tauri/src/bin/startup_smoke.rs README.md docs/STARTUP_TEST_VERIFICATION.md
pnpm startup:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 27 and (.id | tonumber) <= 31) | {id, status, updatedAt}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- The desktop Tauri shell now routes startup bootstrapping and `initialize_app` response generation through shared helpers in `startup.rs`, so the production startup path, Rust unit tests, and the new smoke binary all exercise the same logic.
- `apps/desktop/src-tauri/src/bin/startup_smoke.rs` now runs deterministic `ready`, `retry-recovery`, and `attention` startup scenarios without opening the desktop window, and `pnpm startup:test` wraps that smoke command plus the dedicated `startup::tests` suite.
- The automated startup smoke command confirms local-json startup, retry-based recovery back to ready, bundled sample workbook discovery, and attention-state fallback to temporary memory mode with the expected recovery actions.
- `README.md`, `PLANS.md`, and `docs/STARTUP_TEST_VERIFICATION.md` now all describe the same startup-test surface, and the new verification artifact adds a short real-window launch checklist alongside the automated command.
- `pnpm startup:test`, workspace `pnpm typecheck`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` all pass after closing the startup-testing follow-up.
- Task Master tasks `27` through `31` are now marked done, completing the current startup-testing follow-up set.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

App launch execution test PRD verification:

```bash
test -f .taskmaster/docs/prd_app_launch_execution_test.txt
rg -n '^# App Launch Execution Test PRD|^## Summary|^## Problem|^## Goals|^## Non-goals|^## Target Users|^## User Stories|^## UX Principles|^## Functional Requirements|^## Acceptance Criteria|^## Risks and Mitigations|^## Suggested Implementation Phases|Xvfb|tauri:dev|desktop binary launch' .taskmaster/docs/prd_app_launch_execution_test.txt
rg -n 'prd_app_launch_execution_test|tasks `32` through `36`|planning-only' PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select((.id | tonumber) >= 32 and (.id | tonumber) <= 36) | {id, title, status, dependencies, priority}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_app_launch_execution_test.txt` now scopes the next follow-up around actual `tauri:dev` launch coverage instead of startup-state-only smoke or packaged installer E2E.
- The PRD fixes the acceptance target to an Xvfb-backed launch harness that verifies frontend readiness, desktop binary launch, and short process stability using the same documented source-run path.
- `PLANS.md` now points the next planned scope at this new PRD, and Task Master now contains tasks `32` through `36` for launch-contract fixes, an Xvfb harness, verification docs, and final sync work.
- Task Master JSON remains valid, and the planning artifact updates continue to pass `git diff --check`.

App launch execution follow-up verification:

```bash
test -f .taskmaster/docs/prd_app_launch_execution_test.txt
test -f docs/APP_LAUNCH_TEST_VERIFICATION.md
rg -n 'default-run = \"relay-agent-desktop\"|beforeDevCommand|beforeBuildCommand|launch:test|launch_tauri_smoke|Xvfb' apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json package.json apps/desktop/package.json apps/desktop/scripts/launch_tauri_smoke.mjs README.md docs/APP_LAUNCH_TEST_VERIFICATION.md
pnpm launch:test
pnpm startup:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 32 and (.id | tonumber) <= 36) | {id, status, updatedAt}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `tauri.conf.json` now uses `pnpm dev` and `pnpm build` directly for the current desktop package working directory, so the documented source-run launch path no longer fails by jumping to the wrong folder.
- `Cargo.toml` now fixes `default-run = "relay-agent-desktop"`, preventing the additional `startup_smoke` binary from breaking `tauri:dev` with ambiguous `cargo run` resolution.
- `apps/desktop/scripts/launch_tauri_smoke.mjs` now launches `Xvfb` directly, starts the real `pnpm tauri:dev` flow, polls frontend readiness on `http://127.0.0.1:1420`, detects the desktop binary launch from the Tauri logs, enforces a short stability window, and then cleans up the spawned process tree.
- `pnpm launch:test` now passes in the current Linux headless environment and prints a JSON summary showing `frontendReady: true` and `desktopBinaryLaunchDetected: true`.
- `README.md`, `PLANS.md`, and `docs/APP_LAUNCH_TEST_VERIFICATION.md` now describe the same launch-test surface, and the new verification artifact adds a short manual desktop-window checklist alongside the automated launch harness.
- `pnpm launch:test`, `pnpm startup:test`, workspace `pnpm typecheck`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` all pass after closing the launch-testing follow-up.
- Task Master tasks `32` through `36` are now marked done, completing the current app-launch testing follow-up set.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

App workflow launch test PRD verification:

```bash
test -f .taskmaster/docs/prd_app_workflow_launch_test.txt
rg -n '^# App Workflow Launch Test PRD|^## Summary|^## Problem|^## Goals|^## Non-goals|^## Target Users|^## User Stories|^## UX Principles|^## Functional Requirements|^## Acceptance Criteria|^## Risks and Mitigations|^## Suggested Implementation Phases|workflow:test|save-copy execution|isolated test state' .taskmaster/docs/prd_app_workflow_launch_test.txt
rg -n 'prd_app_workflow_launch_test|tasks `37` through `41`|launched-app workflow smoke' PLANS.md docs/IMPLEMENTATION.md
jq '.master.tasks[] | select((.id | tonumber) >= 37 and (.id | tonumber) <= 41) | {id, title, status, dependencies, priority}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_app_workflow_launch_test.txt` now scopes the next follow-up around launching the real app and completing the bundled sample workflow, without broadening into GUI click automation or packaged installer E2E.
- The PRD fixes the acceptance target to a test-only autorun runner inside the launched app, isolated test storage, an output summary JSON, and an Xvfb-backed harness that waits for workflow completion.
- `PLANS.md` now points the next planned scope at this new PRD, and Task Master now contains tasks `37` through `41` for the autorun runner, launched-workflow harness, verification docs, and final sync work.
- Task Master JSON remains valid, and the planning artifact updates continue to pass `git diff --check`.

App workflow launch follow-up verification:

```bash
test -f .taskmaster/docs/prd_app_workflow_launch_test.txt
test -f docs/APP_WORKFLOW_TEST_VERIFICATION.md
rg -n 'workflow:test|launch_workflow_smoke|RELAY_AGENT_AUTORUN_WORKFLOW_SMOKE|RELAY_AGENT_WORKFLOW_SMOKE_SUMMARY_PATH|RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR|spawn_if_configured|EXPECTED_SAMPLE_OUTPUT' package.json apps/desktop/package.json apps/desktop/scripts/launch_workflow_smoke.mjs apps/desktop/scripts/tauri_smoke_shared.mjs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/workflow_smoke.rs README.md docs/APP_WORKFLOW_TEST_VERIFICATION.md
pnpm workflow:test
pnpm launch:test
pnpm startup:test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
jq '.master.tasks[] | select((.id | tonumber) >= 37 and (.id | tonumber) <= 41) | {id, status, updatedAt}' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/workflow_smoke.rs` now adds a test-only launched-app runner that uses the managed desktop state, runs the bundled sample session-turn-preview-approval-save flow, verifies the reviewed copy content, verifies the source CSV stayed unchanged, and writes a structured JSON summary.
- `apps/desktop/src-tauri/src/lib.rs` now supports a test-only `RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR` override and starts the workflow smoke runner only when the explicit autorun env vars are set, so normal app usage stays unchanged.
- `apps/desktop/scripts/tauri_smoke_shared.mjs` now holds the shared Xvfb and process helpers, while `apps/desktop/scripts/launch_workflow_smoke.mjs` launches `pnpm tauri:dev`, waits for frontend and desktop readiness, polls the workflow summary file, validates the expected steps and reviewed-copy checks, and cleans up the test output plus isolated app-data directory.
- `pnpm workflow:test` now passes in the current Linux headless environment and prints a JSON summary showing launch readiness plus nested workflow success with `outputExists: true`, `outputMatchesExpected: true`, and `sourceUnchanged: true`.
- `README.md`, `PLANS.md`, and `docs/APP_WORKFLOW_TEST_VERIFICATION.md` now describe the same launched-workflow test surface, and the new verification artifact adds a short manual sample-flow checklist alongside the automated harness.
- `pnpm workflow:test`, `pnpm launch:test`, `pnpm startup:test`, workspace `pnpm typecheck`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` all pass after closing the launched-workflow testing follow-up.
- Task Master tasks `37` through `41` are now marked done, completing the current launched-app workflow testing follow-up set.
- The updated code, docs, and task graph continue to pass JSON validation and `git diff --check`.

README Windows installer doc sync verification:

```bash
rg -n '## Windows Installer Status|prebuilt Windows installer|tauri:build|target/release/bundle/nsis' README.md docs/PACKAGING_POLICY.md apps/desktop/package.json
git diff --check
```

Observed result:

- `README.md` now states explicitly that the repository does not currently ship a prebuilt Windows installer, so the source-run path and the packaging policy are no longer easy to confuse.
- The README now points Windows readers at the existing NSIS packaging policy, the local `pnpm --filter @relay-agent/desktop tauri:build` command, and the expected `target/release/bundle/nsis/` output directory for locally built artifacts.
- This remains a docs-only clarification: the currently verified runtime path is still source-run, while the Windows installer guidance is now clearly framed as a local build path rather than a checked-in release artifact.
- The docs-only change continues to pass `git diff --check`.

GitHub Releases Windows installer automation verification:

```bash
test -f .github/workflows/release-windows-installer.yml
rg -n 'release-windows-installer|workflow_dispatch|v\\*|tauri-apps/tauri-action@v1|releaseAssetNamePattern|contents: write' .github/workflows/release-windows-installer.yml
rg -n 'GitHub Releases|release-windows-installer.yml|not committed binary files' README.md docs/PACKAGING_POLICY.md PLANS.md
git diff --check
```

Observed result:

- `.github/workflows/release-windows-installer.yml` now adds a Windows-only GitHub Actions workflow that triggers on `v*` tags or manual dispatch, installs the workspace toolchain, runs `pnpm typecheck` plus desktop Rust tests, builds the NSIS installer with `tauri-apps/tauri-action`, and publishes the installer asset to GitHub Releases.
- The workflow uses GitHub Releases as the distribution channel for packaged Windows installers, which keeps binary artifacts out of git history while preserving the existing manual installer-driven update policy.
- `README.md`, `docs/PACKAGING_POLICY.md`, and `PLANS.md` now all point at the same release story: source-run remains the current verified local path, while packaged Windows installers are meant to be built on GitHub and attached to Releases.
- This change cannot be fully executed from the current local environment because GitHub Actions and release publishing require a GitHub-hosted run with repository `contents: write` permission, so local verification is limited to file presence, workflow shape, and documentation alignment.
- The workflow and docs changes continue to pass `git diff --check`.

GitHub Releases workflow hotfix verification:

```bash
gh run view 23722130376
rg -n 'tauri-apps/tauri-action@action-v0.6.0' .github/workflows/release-windows-installer.yml docs/IMPLEMENTATION.md
git diff --check
```

Observed result:

- The first tag-triggered run for `v0.1.0` failed immediately because `tauri-apps/tauri-action@v1` does not currently resolve on GitHub Actions for this repository.
- `.github/workflows/release-windows-installer.yml` now pins the Tauri release action to the concrete published ref `tauri-apps/tauri-action@action-v0.6.0`, which avoids the missing-major-tag failure and keeps the workflow on a resolvable upstream release.
- After this hotfix, the intended retry path is `workflow_dispatch` with `release_tag: v0.1.0`, because the original tag-push run has already failed and pushing the same tag again would not retrigger the workflow automatically.
- The hotfix continues to pass `git diff --check`.

Windows release icon hotfix verification:

```bash
gh run view 23722159737 --log-failed
file apps/desktop/src-tauri/icons/icon.ico
git diff --check
```

Observed result:

- The first manually dispatched retry for `v0.1.0` got past workflow setup and package checks, then failed in the Windows Rust test build because `tauri-build` requires `apps/desktop/src-tauri/icons/icon.ico` when generating the Windows resource file.
- `apps/desktop/src-tauri/icons/icon.ico` now exists as a real Windows icon generated from the existing `icon.png`, which closes the missing-resource gap that only surfaced on the Windows runner.
- After this hotfix, the intended retry path remains `workflow_dispatch` with `release_tag: v0.1.0`, now against the updated `main` branch that includes both the fixed Tauri action ref and the required `.ico` asset.
- The icon hotfix continues to pass `git diff --check`.

Windows release path portability hotfix verification:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- The next Windows release retry (`23722255820`) got through toolchain setup and the desktop build, then failed in Rust tests because several storage fixtures embedded `outputPath` strings directly into raw JSON snippets. Windows temp paths contain backslashes, so those fixtures produced invalid or misread JSON and made validation fail before preview.
- The storage tests now build Copilot response fixtures with `serde_json::json!` via a shared `copilot_response(...)` helper, which keeps `outputPath` values JSON-safe on both Windows and Unix-like runners without changing the actual product contract.
- `apps/desktop/src-tauri/src/workbook/source.rs` now derives save-copy defaults with `Path::with_file_name(...)`, and the corresponding unit test now asserts on parent/file-name components instead of a POSIX-only string literal. This removes the mixed-separator expectation that only broke on Windows.
- Local regression coverage now passes again with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` showing 35 Rust tests green, including the previously failing storage and workbook source cases.
- The intended next step after this hotfix is another `workflow_dispatch` run for `release_tag: v0.1.0` so the GitHub-hosted Windows job can confirm the release workflow end to end.

GitHub Releases publication verification:

```bash
gh workflow run release-windows-installer.yml -f release_tag=v0.1.0
gh run view 23722491821 --json status,conclusion,jobs,url
gh release view v0.1.0 --json tagName,name,assets,url
```

Observed result:

- The retried Windows release run `23722491821` completed successfully end to end after the portability hotfixes landed on `main`.
- The `publish-windows-installer` job passed every step, including `Run desktop Rust tests` on Windows and `Build Windows installer and upload to GitHub Releases`.
- GitHub Releases now contains `v0.1.0` as `Relay Agent v0.1.0` with the uploaded NSIS installer asset `Relay.Agent_0.1.0_x64-setup.exe`.
- This confirms the repository's intended installer distribution path is now real, verified, and backed by a successful GitHub-hosted Windows publication run.

Trusted Signing follow-up planning and repo wiring verification:

```bash
test -f .taskmaster/docs/prd_windows_trusted_signing.txt
test -f docs/TRUSTED_SIGNING_SETUP.md
rg -n 'id-token: write|Resolve Trusted Signing mode|azure/login@v2|azure/artifact-signing-action@v1|Get-AuthenticodeSignature|gh release upload' .github/workflows/release-windows-installer.yml
rg -n 'prd_windows_trusted_signing|Trusted Signing|docs/TRUSTED_SIGNING_SETUP.md|tasks `42` through `45`' PLANS.md docs/PACKAGING_POLICY.md docs/IMPLEMENTATION.md .taskmaster/docs/prd_windows_trusted_signing.txt
pnpm --dir apps/desktop exec tauri build --help | rg -- '--config'
gh release upload --help | rg -- '--clobber'
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- `.taskmaster/docs/prd_windows_trusted_signing.txt` now defines the next packaging hardening follow-up around Azure Trusted Signing / Artifact Signing for the Windows NSIS release path.
- `.taskmaster/tasks/tasks.json` now contains tasks `42` through `45`. The repo-side planning, setup runbook, workflow rewrite, and documentation sync tasks are marked done, while the first fully signed release is now treated as an operational prerequisite outside Task Master because it depends on external Azure provisioning.
- `docs/TRUSTED_SIGNING_SETUP.md` now acts as the single setup page for GitHub secrets, repository variables, Azure resources, required roles, OIDC expectations, and the first signed release checklist.
- `.github/workflows/release-windows-installer.yml` now uses a build -> locate -> optional sign -> verify -> upload flow. It keeps unsigned fallback when no Trusted Signing settings exist, fails fast on partial configuration, requests `id-token: write`, signs with `azure/artifact-signing-action`, verifies Authenticode status with `Get-AuthenticodeSignature`, and uploads the installer with `gh release upload --clobber`.
- `docs/PACKAGING_POLICY.md` and `PLANS.md` now point at the Trusted Signing runbook and follow-up task set, while `README.md` was intentionally left unchanged because the signed publication path is not yet testable in this local environment.
- Local verification confirms the Task Master JSON still parses, the workflow file contains the intended signing and upload shape, the local Tauri CLI supports the `--config` flag used by the rewritten workflow, GitHub CLI supports the `--clobber` upload mode used for release asset replacement, and the repo still passes `git diff --check`.
- Full end-to-end signed release verification is still pending because this environment does not have the required Azure Artifact Signing account, identity validation, OIDC app registration, repository secrets, or repository variables configured.

Trusted Signing Task Master scope trim verification:

```bash
rg -n '"id": "46"|tasks `42` through `46`|first fully signed Windows release' .taskmaster/tasks/tasks.json PLANS.md docs/IMPLEMENTATION.md .taskmaster/docs/prd_windows_trusted_signing.txt
jq '.master.metadata, [.master.tasks[] | select((.id|tonumber) >= 42)]' .taskmaster/tasks/tasks.json
jq empty .taskmaster/tasks/tasks.json
git diff --check
```

Observed result:

- Task Master task `46` has been removed so the Trusted Signing follow-up now ends at tasks `42` through `45`.
- The remaining real-Azure signed release work is still documented, but it is now framed as an operational prerequisite outside Task Master rather than as a pending repo task.
- `PLANS.md`, `.taskmaster/docs/prd_windows_trusted_signing.txt`, and this implementation log now all describe the same trimmed scope.
- Task Master metadata now reports `taskCount: 45` and `completedCount: 45`, and the JSON plus worktree formatting checks continue to pass.

Packaged sample workbook hotfix verification:

```bash
pnpm check
pnpm typecheck
cargo check
pnpm --filter @relay-agent/desktop build
pnpm --filter @relay-agent/desktop exec tauri build --debug --no-bundle --ci
pnpm --filter @relay-agent/desktop exec tauri build --debug --bundles deb --no-sign --ci
dpkg-deb -c 'target/debug/bundle/deb/Relay Agent_0.1.0_amd64.deb' | rg 'revenue-workflow-demo\.csv|usr/lib/Relay Agent/examples'
```

Observed result:

- `apps/desktop/src-tauri/tauri.conf.json` now bundles `../../../examples/revenue-workflow-demo.csv` into the packaged app as `examples/revenue-workflow-demo.csv`, which matches the Home startup discovery path under `resource_dir/examples/`.
- `pnpm check`, `pnpm typecheck`, `cargo check`, and `pnpm --filter @relay-agent/desktop build` all still pass after the Tauri bundle configuration change.
- `pnpm --filter @relay-agent/desktop exec tauri build --debug --no-bundle --ci` passes, confirming the updated Tauri config is accepted by the desktop build path.
- A real Linux `.deb` bundle now builds successfully, and `dpkg-deb -c` shows the bundled sample workbook at `usr/lib/Relay Agent/examples/revenue-workflow-demo.csv`.
- Inference: because the resource mapping lives in the shared `apps/desktop/src-tauri/tauri.conf.json` bundle config rather than a Linux-only override, Windows NSIS builds should now ship the same sample workbook resource and re-enable Home's `Try the sample flow` button in newly built installers.

Release 0.1.1 version alignment verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json` now both report `0.1.1`, so the Rust package metadata, Tauri bundle metadata, release tag, and generated installer filename can stay aligned for the next Windows release.
- `pnpm typecheck` still passes after the version bump.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 35 Rust tests green after the version bump.
- `git diff --check` still passes after updating the release metadata.

Session creation contract hotfix verification:

```bash
pnpm check
pnpm dlx tsx -e "import { sessionSchema } from './packages/contracts/src/core.ts'; const parsed = sessionSchema.parse({ id: 'session-1', title: 'Bundled sample walkthrough', objective: 'Open the bundled sample CSV.', status: 'draft', primaryWorkbookPath: null, createdAt: '2026-03-30T03:00:00Z', updatedAt: '2026-03-30T03:00:00Z', latestTurnId: null, turnIds: [] }); if (parsed.primaryWorkbookPath !== undefined || parsed.latestTurnId !== undefined) throw new Error('expected null fields to normalize to undefined'); console.log('session schema accepts null optionals');"
```

Observed result:

- `packages/contracts/src/core.ts` now accepts backend `null` values for `Session.primaryWorkbookPath`, `Session.latestTurnId`, and `Item.turnId`, and normalizes them back to `undefined` for TypeScript consumers.
- This closes the first-session packaged-app failure where the Rust backend successfully created a session but returned `latestTurnId: null`, causing frontend Zod parsing to fail and surface the generic `Failed to invoke \`create_session\`.` message.
- `apps/desktop/src/lib/ipc.ts` now includes the underlying invoke or schema error detail in `RelayAgentIpcError`, so future command failures no longer collapse into the same opaque message.
- `pnpm check` still passes after the contract and IPC error-handling changes.
- The direct `sessionSchema` runtime check now passes for a backend-shaped payload containing `primaryWorkbookPath: null` and `latestTurnId: null`.

Release 0.1.2 version alignment verification:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json` now both report `0.1.2`, so the next Windows installer can include the session-creation contract hotfix while keeping the bundle metadata, release tag, and installer filename aligned.
- `Cargo.lock` now tracks `relay-agent-desktop` at `0.1.2`, matching the package metadata used by the release workflow.
- `pnpm typecheck` still passes after the version bump.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` still passes with 35 Rust tests green after the version bump.
- `git diff --check` still passes after updating the release metadata.

Persistent sample-flow entry verification:

```bash
pnpm check
git diff --check
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` still uses the first-run welcome for the initial sample/custom choice, but Home now also shows a smaller bundled-sample switcher inside the create-session panel whenever the packaged sample path is available.
- This keeps `Use bundled sample` reachable after saved sessions exist, which closes the UX gap where `Try the sample flow` disappeared permanently after the first session was created.
- When sample mode is active, the same create-session surface now also exposes `Switch to my own file`, so operators can move back to a real workbook path without resetting Home state.
- `README.md` now documents that the bundled sample walkthrough remains available after first run through the create-session panel.
- `pnpm check` and `git diff --check` still pass after the Home route and documentation update.

Revert persistent sample-flow entry verification:

```bash
pnpm check
pnpm startup:test
git diff --check
```

Observed result:

- Removed the post-first-run `Bundled walkthrough` card from `apps/desktop/src/routes/+page.svelte`, so the sample choice is once again limited to the clean-profile first-run welcome.
- Restored the README startup behavior notes to describe the sample path as a first-run-only entry point instead of a persistent create-session switcher.
- `pnpm startup:test` still reports a `ready` startup smoke scenario with a discoverable `sample_workbook_path`, which means a clean profile should still enable the first-run `Try the sample flow` CTA.
- Inference: with `sampleWorkbookPath` still present during startup smoke and `showFirstRunWelcome` still driven by `sessions.length === 0`, a clean install should land on the first-run welcome and expose `Try the sample flow` when the bundled sample ships correctly.
- `pnpm check`, `pnpm startup:test`, and `git diff --check` pass after removing the persistent sample entry.

## Known Limitations

- Frontend continuity now restores local draft text and preview summaries across restart, but backend preview, approval, and execution runtime state still have to be regenerated before execution can continue safely.
- Browser or window close still relies on the platform-native confirmation dialog, so explicit keep-vs-discard choices are currently available only for in-app navigation and draft-replacement flows.
- `Inspection details` are read-only by design. They now explain lifecycle and workbook evidence, but they do not provide restart, retry, export, or bypass controls from the inspection surface.
- Temporary mode can reconstruct the current turn lifecycle from live state, but that evidence disappears when the app closes, and older turns without saved lifecycle artifacts still fall back to explicit unavailable-state messaging.
- `pnpm startup:test` currently covers source-run startup smoke scenarios and shared startup helper tests; it does not replace packaged-installer E2E or screenshot-driven UI automation.
- `pnpm launch:test` currently targets the Linux headless path with `Xvfb`; it does not yet provide cross-platform GUI automation or packaged-app launch coverage.
- `pnpm workflow:test` now proves that a launched app can complete the bundled sample flow in a Linux headless environment, but it still uses a test-only autorun runner instead of real GUI click automation or cross-platform packaged-app coverage.
- The Windows release workflow now supports Azure Trusted Signing, but the repo has not yet completed the first fully signed publication because the required Azure account, certificate profile, OIDC principal, and GitHub configuration are still operational prerequisites.
- Reviewer mode currently depends on local audit history and the same device profile; it is a safe local review surface, not a shared remote approval link.
- Preview predicates and derive expressions intentionally support a narrow grammar for now: bracketed column references for spaced headers, one comparison in `filter_rows`, and basic arithmetic or string concatenation in `derive_column`.
- Limited xlsx support is still inspect-and-copy oriented; current test coverage still centers on CSV execution plus xlsx preview planning rather than richer xlsx write flows.
- Task Master native AI PRD parsing is still blocked unless provider API keys are configured.

Single-page UI reliability follow-up verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
pnpm dlx tsx --test apps/desktop/src/lib/auto-fix.test.ts
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now renders Steps 1 through 3 at all times, greys out unreached steps with `aria-disabled` plus disabled controls, and collapses Step 1 into an editable compact summary after preparation succeeds.
- The Step 1 preparation path now calls a new typed `inspect_workbook` IPC surface, captures workbook sheet and typed column context, and injects that metadata into the Copilot instruction text alongside a `.copy`-style suggested `outputPath`.
- Copilot handoff guidance now switches the example JSON by template intent, and the retry prompt text now varies by validation level so syntax, schema, and tool-name failures no longer get the same generic repair message.
- `apps/desktop/src/lib/auto-fix.ts` now also normalizes smart quotes, full-width spaces, `~~~json` fences, and prose-wrapped JSON blocks, with nine passing test cases in `apps/desktop/src/lib/auto-fix.test.ts`.
- `pnpm check` passes.
- `pnpm typecheck` passes.
- `pnpm --filter @relay-agent/desktop build` passes.
- `pnpm dlx tsx --test apps/desktop/src/lib/auto-fix.test.ts` passes with 9 tests green.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes after adding the new `inspect_workbook` command.

## Next Step

Next planned work:

- Complete task `68` with a real Windows Tauri walkthrough for the current one-page UI, including the new row-level diff detail in Step 3.

Guided workflow simplification PRD verification:

```bash
test -f .taskmaster/docs/prd_guided_workflow_simplification.txt
test -f docs/GUIDED_WORKFLOW_SIMPLIFICATION_PRD.md
rg -n '^# Guided Workflow Simplification PRD|^## Summary|^## Problem|^## Goals|^## Non-goals|^## Target Users|^## Success Metrics|^## UX Principles|^## User Stories|^## Key Flows|^## Functional Requirements|^## Acceptance Criteria|^## Risks and Mitigations|^## Suggested Implementation Phases|Guided mode|Copy for Copilot|Use demo response|Confirm and save copy|preview before write|approval before write|save-copy only' .taskmaster/docs/prd_guided_workflow_simplification.txt
rg -n 'prd_guided_workflow_simplification|workflow-UX simplification scope|planning-only' PLANS.md docs/GUIDED_WORKFLOW_SIMPLIFICATION_PRD.md
```

Observed result:

- Added `.taskmaster/docs/prd_guided_workflow_simplification.txt` as a new follow-up PRD focused on reducing user-visible steps in the sample/custom flow, clarifying Copilot relay, improving preview visibility, and separating guided mode from expert details.
- The new PRD is intentionally scoped as a UX simplification layer over the existing safe backend lifecycle rather than a guardrail rollback; it explicitly preserves preview before write, approval before write, save-copy only, and original-workbook read-only behavior.
- `docs/GUIDED_WORKFLOW_SIMPLIFICATION_PRD.md` now mirrors the planning reference at the repo docs level so future planning references do not imply implementation already ships.
- `PLANS.md` now names the guided workflow simplification PRD as the next planning-only workflow UX scope instead of silently widening the completed follow-up sets.
- This PRD was prompted by direct manual walkthrough friction in the current sample flow, especially the number of visible steps, the need to understand `session` / `turn` / `packet`, the hidden preview location, and the fragility of Copilot JSON relay on Windows paths.

Documentation alignment verification:

```bash
test -f .taskmaster/docs/repo_audit.md
rg -n 'tasks `11` through `64`|tasks `65` through `68`|task `64` complete|prd_ui_redesign_v2|archive/prd_guided_workflow_simplification' PLANS.md docs/IMPLEMENTATION.md .taskmaster/docs/INDEX.md
git diff --check
```

Observed result:

- Restored `.taskmaster/docs/repo_audit.md` so the baseline path referenced by `AGENTS.md`, `PLANS.md`, and this implementation log exists again.
- `PLANS.md` now reflects the completed guided-workflow simplification follow-up at tasks `46` through `63` and the active UI redesign follow-up at tasks `64` through `68`.
- The implementation-log status summary now matches the Task Master graph: tasks `11` through `64` complete, tasks `65` through `68` pending.
- `git diff --check` passes after the documentation-only synchronization.

Step 3 SheetDiff card verification:

```bash
pnpm --filter @relay-agent/desktop check
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now keeps `previewExecution().diffSummary.sheets` in component state instead of flattening everything into text-only detail lines.
- Step 3 now renders one card per sheet below the summary grid, showing the sheet label, estimated affected rows, and colored badge groups for added, changed, and removed columns.
- `pnpm --filter @relay-agent/desktop check` passes with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passes after the Step 3 UI change, so task `65` is now complete and the remaining pending tasks start at `66`.

Recent-session resume implementation verification:

```bash
pnpm --filter @relay-agent/desktop check
pnpm --filter @relay-agent/desktop build
rg -n 'handleRecentSessionClick|listRecoverableStudioDrafts|saveStudioDraft|markStudioDraftClean|recent-badge' apps/desktop/src/routes/+page.svelte
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now autosaves the current guided-flow state into the existing continuity layer once a session exists, including the workbook path, turn title and objective, relay packet text, pasted Copilot response, and preview snapshot summary.
- The recent-session list is now clickable, and sessions with an unfinished local draft are labeled `下書きを再開`.
- Clicking a recent session now restores the file path for Step 1, and when a recoverable continuity draft exists it restores `sessionId`, `turnId`, relay packet text, Copilot response text, and derived instruction text so the user can resume from Step 2.
- `pnpm --filter @relay-agent/desktop check` and `pnpm --filter @relay-agent/desktop build` both pass after the continuity wiring change.
- Task `66` was implemented in code and left open pending the requested manual restart-and-resume walkthrough.

Recent-session resume manual verification:

- User confirmed the manual walkthrough on Windows Tauri: create a new guided-flow draft, reach Step 2, leave a pasted response, close or reload the app, reopen it, open `最近の作業`, confirm the `下書きを再開` badge, click the recent session, and verify that the file path, `sessionId`, `turnId`, Step 2 state, pasted Copilot response, and relay-packet-derived Copilot instruction text are all restored.
- Based on that acceptance run, task `66` is now complete and the remaining pending tasks start at `67`.

Row-level SheetDiff verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `packages/contracts/src/workbook.ts` now extends `SheetDiff` with `rowSamples`, and the Tauri-side models plus `previewExecution` payload now carry row-level before/after samples through the existing IPC path.
- `apps/desktop/src-tauri/src/workbook/preview.rs` now snapshots the original and transformed CSV preview tables, computes up to three row-level diff samples per sheet, and serializes them as `changed`, `added`, or `removed` records with before/after cell maps.
- `apps/desktop/src/routes/+page.svelte` now renders those row samples inside each Step 3 SheetDiff card, showing side-by-side `変更前` and `変更後` values when available.
- `pnpm check` passes.
- `pnpm typecheck` passes.
- `pnpm --filter @relay-agent/desktop build` passes.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes with 35 tests green.
- Task `67` is now complete. The only remaining pending task is `68`, the Windows Tauri end-to-end walkthrough.

Unified guided-flow verification:

```bash
pnpm check
pnpm typecheck
pnpm --filter @relay-agent/desktop build
pnpm dlx tsx --test apps/desktop/src/lib/auto-fix.test.ts
rg -n 'Load demo response|Try the sample flow|Use my own file|entryMode|startSampleFlow|startCustomFlow|showGuidedStartGate' apps/desktop/src
git diff --check
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now presents one guided 3-step flow with a unified start form, auto-generated editable task name, a single primary action per stage, inline multi-command progress, a sticky step banner, a sticky 3-point review summary, and a closed-by-default `詳細表示` surface for raw packet details.
- The Copilot handoff now copies natural-language instructions plus an inline JSON template, and the bundled `revenue-workflow-demo.csv` path adds a concrete response example using the real sample columns.
- `apps/desktop/src/lib/auto-fix.ts` now reports whitespace, BOM, CRLF, trailing-comma, and Windows-path repairs, and `apps/desktop/src/lib/auto-fix.test.ts` covers the expected repair cases plus the combined-input path.
- Validation failures now surface tiered plain-language guidance with a copyable retry prompt instead of relying on the removed demo-response shortcut.
- `README.md`, `docs/GUIDED_FLOW_VERIFICATION.md`, `docs/STARTUP_TEST_VERIFICATION.md`, and `docs/APP_WORKFLOW_TEST_VERIFICATION.md` now describe the unified guided flow instead of the older sample/custom split and `Load demo response` path.
- `pnpm check`, `pnpm typecheck`, the desktop production build, the new auto-fix tests, and `git diff --check` all pass after the guided-flow refresh.

Browser automation implementation verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop copilot-browser:build
node apps/desktop/scripts/dist/copilot-browser.js --action connect
pnpm --filter @relay-agent/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/scripts/copilot-browser.ts` now implements both `--action connect` and `--action send`, with placeholder Copilot selectors, CDP connection, login detection, network-response capture, DOM fallback polling, citation stripping, and retry handling.
- `docs/BROWSER_AUTOMATION.md` now records the current placeholder selectors, API pattern, CLI contract, error codes, and the exact live M365 confirmation checklist that still needs to be run.
- `apps/desktop/package.json` now builds that script with esbuild in ESM mode and externalized Node packages so Playwright can run correctly under the app's `"type": "module"` package boundary.
- `apps/desktop/src/lib/copilot-browser.ts`, `packages/contracts/src/ipc.ts`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/capabilities/default.json`, and `apps/desktop/src-tauri/tauri.conf.json` now wire the built script into Tauri through `@tauri-apps/plugin-shell`, typed stdout parsing, bundled resource resolution, and persisted CDP settings.
- `apps/desktop/src/routes/+page.svelte` now adds the Step 2 `Copilotに自動送信 ▶` action, inline Japanese error handling with `手動入力に切り替え`, and a settings-modal section for CDP port, timeout, and Edge launch-command copying.
- `pnpm --filter @relay-agent/contracts typecheck` passes.
- `pnpm --filter @relay-agent/desktop typecheck` passes with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop copilot-browser:build` passes and emits `apps/desktop/scripts/dist/copilot-browser.js`.
- `node apps/desktop/scripts/dist/copilot-browser.js --action connect` returns structured JSON with `errorCode: "CDP_UNAVAILABLE"` in this environment, confirming the CLI path and error schema.
- `pnpm --filter @relay-agent/desktop build` passes.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes.
- Task Master was updated to mark only the implementation-backed subtasks under `77`, `78`, `79`, `80`, `81`, and `82` as done; the parent tasks plus `76` and `83` remain open until the M365-dependent manual verification artifacts exist.

Contracts schema extension verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop check
pnpm dlx tsx -e "import { copilotTurnResponseSchema, fileActionSchema } from './packages/contracts/src/index.ts'; const parsed = copilotTurnResponseSchema.parse({ summary: 'ok', actions: [] }); const fileList = fileActionSchema.parse({ tool: 'file.list', args: { path: '/tmp' } }); const fileDelete = fileActionSchema.parse({ tool: 'file.delete', args: { path: '/tmp/test.txt' } }); console.log(JSON.stringify({ status: parsed.status, fileListRecursive: fileList.args.recursive, fileDeleteRecycle: fileDelete.args.toRecycleBin }));"
```

Observed result:

- `packages/contracts/src/relay.ts` now defines `agentLoopStatusSchema` with `thinking`, `ready_to_write`, `done`, and `error`, and `copilotTurnResponseSchema` now includes `status` plus optional `message`.
- Omitting `status` from `copilotTurnResponseSchema` still parses successfully and resolves to `ready_to_write`, preserving the existing one-shot response shape.
- `packages/contracts/src/file.ts` now defines `file.list`, `file.read_text`, `file.stat`, `file.copy`, `file.move`, and `file.delete`, plus `fileActionSchema` as the discriminated union over those tools.
- `packages/contracts/src/index.ts` now exports the new file schemas and `agentLoopStatusSchema` / `AgentLoopStatus`.
- `pnpm --filter @relay-agent/contracts typecheck` passes.
- `pnpm --filter @relay-agent/desktop check` passes with `svelte-check found 0 errors and 0 warnings`, confirming the contracts change does not break the desktop consumer.
- `pnpm dlx tsx ...` returns `{"status":"ready_to_write","fileListRecursive":false,"fileDeleteRecycle":true}`, confirming the default `status` behavior and representative file-action defaults.
- Task Master now records tasks `85` and `93` as implemented, and task `93` explicitly notes that `relayActionSchema` integration remains deferred to the later backend-aligned phase.

Agent loop implementation verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop check
pnpm --filter @relay-agent/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @relay-agent/desktop tauri:build
git diff --check
```

Observed result:

- `packages/contracts/src/relay.ts` now accepts both spreadsheet and file actions in `copilotTurnResponseSchema.actions` via `relayActionSchema`, so multi-turn Copilot responses can carry `file.list`, `file.read_text`, and `file.stat` without schema rejection.
- `packages/contracts/src/ipc.ts` now defines `executeReadActionsRequestSchema`, `executeReadActionsResponseSchema`, and `toolExecutionResultSchema`, and `apps/desktop/src/lib/ipc.ts` now exposes the typed `executeReadActions()` wrapper to the desktop UI.
- `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/execution.rs`, `apps/desktop/src-tauri/src/lib.rs`, and `apps/desktop/src-tauri/src/storage.rs` now implement the backend agent-loop read path: `execute_read_actions`, max-turn guard handling, read/write classification, `file.list` / `file.read_text` / `file.stat`, Shift_JIS fallback decoding, and path-traversal blocking for file tools.
- `apps/desktop/src-tauri/src/storage.rs` now parses `CopilotTurnResponse.status` and `message`, and the allowed read-tool registry exposed in relay packets now includes the new file read tools.
- `apps/desktop/src/lib/agent-loop.ts` now implements `runAgentLoop()` and `buildFollowUpPrompt()`, using `sendToCopilot()` plus `executeReadActions()` to drive multi-turn loop execution until `ready_to_write`, `done`, or `error`.
- `apps/desktop/src/lib/continuity.ts` now persists `agentLoopEnabled`, `maxTurns`, and `loopTimeoutMs` alongside the existing browser automation settings.
- `apps/desktop/src/routes/+page.svelte` now supports both the existing one-shot send and the new loop mode, including Step 2 loop toggles, per-turn log rendering, cancellation, automatic handoff into Step 3 when `ready_to_write` is reached, and loop-related settings in the modal.
- `docs/AGENT_LOOP_E2E_VERIFICATION.md` now records the five manual verification scenarios for task `95`; the task remains pending until those Windows + M365 checks are actually executed and recorded.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes with 39 tests green, including new coverage for the loop guard, write-action gating, file read tools, traversal blocking, and the 1MB file-size limit.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop check`, `pnpm --filter @relay-agent/desktop build`, `pnpm --filter @relay-agent/desktop tauri:build`, and `git diff --check` all pass after the agent-loop implementation.
- Task Master now records tasks `86`, `87`, `88`, `89`, `90`, `91`, `92`, and `94` as implemented, while task `95` remains open pending manual E2E execution against a real M365 Copilot session.

Agent loop design artifact verification:

```bash
test -f docs/AGENT_LOOP_DESIGN.md
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('.taskmaster/tasks/tasks.json','utf8')); const task84=data.master.tasks.find((task)=>task.id==='84'); const task95=data.master.tasks.find((task)=>task.id==='95'); console.log(JSON.stringify({task84: task84?.status, task95: task95?.status}, null, 2));"
```

Observed result:

- `docs/AGENT_LOOP_DESIGN.md` now captures the PRD section `14` loop contract, state machine, read/write classification, safety guards, UI transitions, and the manual-verification boundary for task `95`.
- `.taskmaster/tasks/tasks.json` now marks task `84` as done and keeps task `95` pending.
- The design note explicitly documents the current guard baseline and calls out that duplicate read-action warnings are still weaker than the aspirational PRD wording, so the manual verification task stays meaningful.

UI / UX milestone verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop check
pnpm --filter @relay-agent/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @relay-agent/desktop tauri:build
git diff --check
```

Observed result:

- `apps/desktop/src/lib/welcome.ts` now persists a first-run welcome flag, and `apps/desktop/src/routes/+page.svelte` now renders a first-launch welcome overlay with the 3-step flow before exposing the main UI.
- `apps/desktop/src/lib/error-messages.ts` now maps common runtime failures such as CDP connection refusal, timeout, max-turn guard hits, schema failures, and cancellation into Japanese user-facing error copy with hints, and `+page.svelte` now uses that presentation across setup, loop, and save errors.
- `apps/desktop/src/routes/+page.svelte` now replaces the old step cards with a compact progress bar, adds a large Step 1 dropzone + preset objective chips, adds a CDP setup guide and localhost connection test inside the settings modal, converts the loop-mode settings into a toggle card with animated options, converts the loop progress panel into a timeline with durations and expandable JSON detail, and replaces the inline success state with a completion screen that includes file stats and an open-output action.
- `apps/desktop/src-tauri/capabilities/default.json` now includes `shell:allow-open` so the completion screen can request opening the generated output file through the existing shell plugin.
- `pnpm --filter @relay-agent/contracts typecheck` passes.
- `pnpm --filter @relay-agent/desktop check` passes with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passes after the UI refresh.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes after the capability update.
- `git diff --check` passes.
- `pnpm --filter @relay-agent/desktop tauri:build` reaches the release build and bundle steps successfully, but fails at the final Linux packaging stage with `failed to bundle project 'failed to run linuxdeploy'`. The app binary and intermediate bundles are still produced; the remaining failure is packaging-environment-specific rather than a TypeScript or Rust compile regression.
- Task Master now records tasks `96` through `103` as implemented based on the new welcome helper, error helper, updated Step 1/2/3 UI, and successful desktop `check` / `build` verification.

CDP auto-launch / port-scan verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop check
pnpm --filter @relay-agent/desktop copilot-browser:build
pnpm --filter @relay-agent/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
node apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch
git diff --check
```

Observed result:

- `apps/desktop/scripts/copilot-browser.ts` now scans `9333-9342`, detects an already-running CDP Edge, auto-launches `msedge.exe` on a free port when needed, waits for `/json/version`, and emits stdout progress events plus the resolved `cdpPort` in the final JSON result. *(Later: Relay default base moved to **9360**; `copilot_server.js` scans **9360–9379**; `--auto-launch` path prefers **DevToolsActivePort**.)*
- `apps/desktop/src/lib/copilot-browser.ts` now passes `--auto-launch` when `autoLaunchEdge` is enabled, filters progress JSON lines from stdout, forwards progress callbacks to the UI, and logs the resolved CDP port from the script result.
- `apps/desktop/src/lib/continuity.ts` now persists `autoLaunchEdge: true` by default and keeps manual-port mode available with the new `9333` default port. *(Current repo default CDP hint: **9360**.)*
- `apps/desktop/src/lib/agent-loop.ts` and `apps/desktop/src/routes/+page.svelte` now surface browser progress messages during both one-shot sends and agent-loop sends, add the new auto-launch toggle in settings, hide the manual port input when auto-launch is enabled, and update the in-app Edge launch guide to the current command.
- `apps/desktop/src/lib/error-messages.ts` now adds friendly messages for the all-ports-in-use case, Edge launch timeout, and missing `msedge.exe`, while keeping the generic CDP-unavailable path aligned with the new auto-launch flow.
- `docs/BROWSER_AUTOMATION.md` and `docs/BROWSER_AUTOMATION_VERIFICATION.md` now describe the `--auto-launch` workflow, the `9333-9342` scan range, and the revised manual verification expectations. *(See current docs for **9360–9379** / **9360** default.)*
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop check`, `pnpm --filter @relay-agent/desktop copilot-browser:build`, `pnpm --filter @relay-agent/desktop build`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after the CDP auto-launch changes.
- `node apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch` now emits progress JSON lines and then returns `{"status":"error","errorCode":"CDP_UNAVAILABLE","message":"Failed to launch Edge: spawn msedge.exe ENOENT"}` in this Linux environment, which confirms the new auto-launch path and the missing-Edge error handling without requiring a Windows Edge install.
- Task Master now records tasks `104` through `108` as implemented; the remaining browser-automation manual M365 verification tasks stay open separately.

Autonomous planning contracts and frontend foundation verification:

```bash
test -f docs/AUTONOMOUS_EXECUTION_DESIGN.md
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
pnpm dlx tsx -e "import { copilotTurnResponseSchema, executionPlanSchema, approvePlanRequestSchema, planProgressResponseSchema } from './packages/contracts/src/index.ts'; const legacy = copilotTurnResponseSchema.parse({ summary: 'ok', actions: [] }); const planned = copilotTurnResponseSchema.parse({ status: 'plan_proposed', summary: 'plan', actions: [], executionPlan: { summary: '3 steps', totalEstimatedSteps: 3, steps: [{ id: 'step-1', description: 'inspect', tool: 'workbook.inspect', phase: 'read' }] } }); const approve = approvePlanRequestSchema.parse({ sessionId: 'session-1', turnId: 'turn-1', approvedStepIds: ['step-1'] }); const progress = planProgressResponseSchema.parse({ currentStepId: null, completedCount: 0, totalCount: 1, stepStatuses: [{ stepId: 'step-1', state: 'pending' }] }); console.log(JSON.stringify({ legacyStatus: legacy.status, plannedStatus: planned.status, planSteps: executionPlanSchema.parse(planned.executionPlan).steps.length, approvedCount: approve.approvedStepIds.length, progressCount: progress.stepStatuses.length }));"
git diff --check -- docs/AUTONOMOUS_EXECUTION_DESIGN.md packages/contracts/src/relay.ts packages/contracts/src/ipc.ts apps/desktop/src/lib/agent-loop.ts apps/desktop/src/lib/agent-loop-prompts.ts apps/desktop/src/lib/agent-loop-prompts.test.ts apps/desktop/src/routes/+page.svelte .taskmaster/tasks/tasks.json PLANS.md docs/IMPLEMENTATION.md
```

Observed result:

- `docs/AUTONOMOUS_EXECUTION_DESIGN.md` now captures the planning-first state machine, planning prompt contract, `ExecutionPlan` schema, approval semantics, and guardrails for tasks `109` through `113`.
- `packages/contracts/src/relay.ts` now adds `plan_proposed`, `planStepSchema`, `executionPlanSchema`, and optional `executionPlan` on `copilotTurnResponseSchema` while preserving backward compatibility for legacy one-shot responses.
- `packages/contracts/src/ipc.ts` now defines the plan approval and plan progress schemas needed by later backend/UI tasks: `planStepStatusSchema`, `approvePlanRequestSchema`, `approvePlanResponseSchema`, `planProgressRequestSchema`, and `planProgressResponseSchema`.
- `apps/desktop/src/lib/agent-loop.ts` now supports `planningEnabled`, stops with `awaiting_plan_approval` when a `plan_proposed` response is returned, and adds `resumeAgentLoopWithPlan()` for stepwise execution until a write step is reached.
- `apps/desktop/src/lib/agent-loop-prompts.ts` now holds the pure planning and step-execution prompt builders, and `apps/desktop/src/lib/agent-loop-prompts.test.ts` passes under `node:test`.
- The schema probe returns `{"legacyStatus":"ready_to_write","plannedStatus":"plan_proposed","planSteps":1,"approvedCount":1,"progressCount":1}`, confirming backward compatibility plus the new planning payload shapes.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, the prompt unit test, and `git diff --check` all pass after the autonomous-planning changes.
- Task Master now records tasks `109` through `113` as implemented. Tasks `114` and later remain open because backend approval IPC commands, plan review UI, progress UI, and execution-state persistence are not part of this slice yet.

Autonomous execution approval / UI / persistence verification:

```bash
test -f docs/AUTONOMOUS_EXECUTION_E2E_VERIFICATION.md
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `packages/contracts/src/ipc.ts` now extends the autonomous-planning contract with `planningContext`, the plan approval / progress request-response schemas, and the persisted plan-progress write schema used by the desktop UI.
- `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/execution.rs`, `apps/desktop/src-tauri/src/lib.rs`, and `apps/desktop/src-tauri/src/storage.rs` now implement `approve_plan`, `get_plan_progress`, and `record_plan_progress`, persist `execution-plan` plus `plan-progress` artifacts, and expose planning context from `assess_copilot_handoff`.
- `apps/desktop/src/lib/ipc.ts`, `apps/desktop/src/lib/continuity.ts`, `apps/desktop/src/lib/agent-loop.ts`, and `apps/desktop/src/lib/agent-loop-prompts.ts` now wire the new IPC commands, persist autonomous settings, support write-step handoff inside `resumeAgentLoopWithPlan()`, and allow step-by-step pausing before the next plan step.
- `apps/desktop/src/routes/+page.svelte` now shows a plan review panel with step deletion and reorder controls, supports feedback-driven replanning, renders autonomous execution progress and pause/resume controls, routes write steps into the existing preview/save gate, and resumes the remaining approved plan after save-copy execution.
- `docs/AUTONOMOUS_EXECUTION_E2E_VERIFICATION.md` now captures the manual Windows + M365 validation checklist for task `123`.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, the prompt unit test, `cargo check`, `cargo test`, and `git diff --check` all pass after the autonomous execution follow-up.
- Task Master now records tasks `114` through `122` as implemented. Task `123` remains pending because the manual Windows + M365 E2E checklist has not been executed in this environment.

Delegation UI implementation verification:

```bash
test -f docs/DELEGATION_UI_DESIGN.md
test -f docs/DELEGATION_UI_E2E_VERIFICATION.md
pnpm check
pnpm typecheck
pnpm workflow:test
cd apps/desktop && pnpm dlx tsx --test src/lib/stores/delegation.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
git diff --check
```

Observed result:

- `docs/DELEGATION_UI_DESIGN.md` now defines the delegation-first component tree, state model, activity event contract, coexistence strategy with manual mode, responsive layout rules, and migration boundaries for tasks `124` through `136`.
- `apps/desktop/src/lib/components/` now contains extracted UI primitives for the existing manual flow and the new delegation flow: `RecentSessions`, `GoalInput`, `AgentActivityFeed`, `SheetDiffCard`, `ApprovalGate`, `SettingsModal`, `ChatComposer`, `ActivityFeed`, `InterventionPanel`, and `CompletionTimeline`.
- `apps/desktop/src/lib/stores/delegation.ts` now implements the delegation state machine plus timestamped activity-feed storage, and `apps/desktop/src/lib/stores/delegation.test.ts` covers the goal-to-approval lifecycle and feed append behavior.
- `apps/desktop/src/lib/continuity.ts` now persists `uiMode` plus delegation drafts, including the goal, attached files, activity feed snapshot, plan snapshot, and normalized execution state for restoration.
- `apps/desktop/src/routes/+page.svelte` now defaults to delegation mode, keeps the existing three-step workflow intact behind a manual-mode toggle, auto-starts the agent loop from the delegation composer, emits live activity-feed entries during planning/execution, routes plan/write interventions into the delegation sidebar, persists drafts, and adds the delegation keyboard shortcuts.
- `docs/DELEGATION_UI_E2E_VERIFICATION.md` now captures the Windows + M365 manual checklist for task `137`, covering goal-first execution, plan/write interventions, automation fallback, keyboard shortcuts, persistence, and responsive layout.
- `pnpm check`, `pnpm typecheck`, `pnpm workflow:test`, both `tsx --test` runs, and `git diff --check` all pass after the delegation UI follow-up.
- Task Master now records tasks `124` through `136` as implemented. Task `137` remains pending because the manual Windows + M365 E2E checklist has not been executed in this environment.

Copilot integration enhancement verification:

```bash
test -f docs/MULTI_SESSION_COPILOT.md
test -f docs/COPILOT_INTEGRATION_E2E_VERIFICATION.md
pnpm --filter @relay-agent/desktop typecheck
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/prompt-templates.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-core.test.ts
git diff --check
```

Observed result:

- `apps/desktop/src/lib/prompt-templates.ts` now provides the stronger planning prompt, compressed-context builder, turn summarizer, step follow-up prompt, and structured error-recovery prompts required by tasks `138` through `140`.
- `apps/desktop/src/lib/agent-loop.ts` now applies those templates during both direct loop execution and approved-plan execution, carries `conversationHistory` through the result contract, retries malformed/timeout Copilot turns before falling back, and preserves compressed turn summaries for longer loops.
- `apps/desktop/src/lib/agent-loop-core.ts` now isolates the retry/manual-fallback request path so the malformed-JSON recovery flow can be unit-tested without the full desktop runtime.
- `apps/desktop/src/lib/continuity.ts` and `apps/desktop/src/routes/+page.svelte` now persist and restore delegation conversation history snapshots, and reuse that history when resuming post-plan execution.
- `docs/MULTI_SESSION_COPILOT.md` now records the feasibility assessment for multiple Copilot sessions and explicitly keeps the shipped workflow single-session.
- `docs/COPILOT_INTEGRATION_E2E_VERIFICATION.md` now captures the Windows + M365 manual checklist for task `143`, covering prompt quality, context compression, retry/fallback behavior, persisted history, and the single-session safety boundary.
- `pnpm --filter @relay-agent/desktop typecheck`, the three `tsx --test` runs, and `git diff --check` all pass after the Copilot enhancement follow-up.
- Task Master now records tasks `138` through `142` as implemented. Task `143` remains pending because the manual Windows + M365 E2E checklist has not been executed in this environment.

Implementation quality fixes verification:

```bash
pnpm -C packages/contracts build
pnpm check
pnpm typecheck
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-core.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/prompt-templates.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/stores/delegation.test.ts
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/models.rs` now defines typed `ExecutionPlan`, `PlanStep`, `PlanStepPhase`, and `PlanStepState`, so the backend no longer treats autonomous plan payloads as unvalidated raw JSON blobs during approval/progress handling.
- `apps/desktop/src-tauri/src/storage.rs` now filters approved steps and reconstructs default plan progress from typed Rust structs instead of `Value::get(...)` access, while preserving the existing camelCase IPC JSON shape.
- `apps/desktop/src/lib/agent-loop-core.ts` now trims `conversationHistory` to a bounded size and removes abort listeners when the wrapped promise settles, avoiding unbounded history growth and per-turn abort-listener accumulation.
- `apps/desktop/src/lib/prompt-templates.ts` now returns an explicit manual-fallback message for retry level `3`, which keeps the fallback prompt self-contained instead of relying on an empty-string sentinel.
- `apps/desktop/src/lib/components/ChatComposer.svelte` now extracts file basenames from both `/` and `\\` path separators, so Windows-native Tauri file paths render correctly in the delegation composer.
- `apps/desktop/src/lib/stores/delegation.ts` now caps the activity feed to the most recent `200` events, and the refreshed store tests cover lifecycle, hydrate/error handling, and feed trimming.
- `pnpm -C packages/contracts build`, `pnpm check`, `pnpm typecheck`, the updated `tsx --test` suites, `cargo build`, `cargo test`, and `git diff --check` all pass after these implementation fixes.
- This prompt did not correspond to a separate Task Master milestone, so `.taskmaster/tasks/tasks.json` was left unchanged.

Generic file operations verification:

```bash
test -f docs/FILE_OPS_E2E_VERIFICATION.md
pnpm -C packages/contracts build
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-core.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/prompt-templates.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/stores/delegation.test.ts
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `packages/contracts/src/file.ts` now defines `text.search`, `text.replace`, and `document.read_text`, and `packages/contracts/src/ipc.ts` now exposes them through the relay and preview IPC contracts, including persisted `fileWriteActions` for approval UI rendering.
- `apps/desktop/src-tauri/src/file_ops.rs` now implements safe absolute-path file reads, copy/move/delete writes, regex search/replace with backup support, and plain-text extraction for DOCX, PPTX, PDF, and common text formats.
- `apps/desktop/src-tauri/src/storage.rs` now routes the new read tools through `execute_read_actions`, previews non-spreadsheet write actions without forcing them through the workbook engine, records file-write previews in the preview artifact, and executes approved file/text writes in `run_execution`.
- `apps/desktop/src-tauri/src/storage.rs` test coverage now includes `text.search`, `document.read_text`, and `text.replace` preview-to-execution flow, while existing packet/approval tests were updated for the expanded tool registry.
- `apps/desktop/src/lib/components/FileOpPreview.svelte`, `apps/desktop/src/lib/components/InterventionPanel.svelte`, `apps/desktop/src/routes/+page.svelte`, and `apps/desktop/src/lib/continuity.ts` now render and persist file-operation approval previews alongside the existing sheet diff experience.
- `docs/FILE_OPS_E2E_VERIFICATION.md` now captures the manual Windows + M365 validation checklist for task `149`.
- `pnpm -C packages/contracts build`, `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, the four `tsx --test` suites, `cargo build`, `cargo test`, and `git diff --check` all pass after the file-operations follow-up.
- Task Master now records tasks `144` through `148` as implemented. Task `149` remains pending because the manual Windows + M365 E2E checklist has not been executed in this environment.

Project model and memory verification:

```bash
test -f docs/PROJECT_MODEL_DESIGN.md
pnpm -C packages/contracts build
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cd apps/desktop && pnpm dlx tsx --test src/lib/prompt-templates.test.ts
cd apps/desktop && pnpm dlx tsx --test src/lib/agent-loop-prompts.test.ts
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `docs/PROJECT_MODEL_DESIGN.md` now defines the project object model, persistence layout, prompt-injection rules, selector UX, and scope-guard behavior for tasks `150` through `154`.
- `packages/contracts/src/project.ts`, `packages/contracts/src/index.ts`, and `packages/contracts/src/ipc.ts` now expose typed `Project` / `ProjectMemoryEntry` contracts plus the create/read/update/list and memory CRUD IPC request schemas.
- `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/persistence.rs`, `apps/desktop/src-tauri/src/storage.rs`, and `apps/desktop/src-tauri/src/project.rs` now persist project records in local JSON storage and serve project CRUD through registered Tauri commands.
- `apps/desktop/src/lib/ipc.ts` and `apps/desktop/src/lib/continuity.ts` now provide frontend project IPC wrappers and persisted `selectedProjectId` continuity.
- `apps/desktop/src/lib/prompt-templates.ts`, `apps/desktop/src/lib/agent-loop-prompts.ts`, and `apps/desktop/src/lib/agent-loop.ts` now inject project instructions/memory into planning and execution prompts, and block out-of-scope file actions during manual preview or autonomous execution.
- `apps/desktop/src/lib/components/ProjectSelector.svelte` and `apps/desktop/src/routes/+page.svelte` now add project creation, selection, memory editing, and active-project context display to the desktop UI.
- The updated prompt-template tests plus backend storage test coverage pass, including the new project persistence regression in `storage.rs`.
- `pnpm -C packages/contracts build`, both typecheck runs, `pnpm check`, the prompt-template tests, `cargo build`, `cargo test`, and `git diff --check` all pass after the project-memory follow-up.
- Task Master now records tasks `150` through `154` as implemented.

Project linkage and auto-learning follow-up verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/project.rs`, `apps/desktop/src-tauri/src/storage.rs`, and `apps/desktop/src/lib/ipc.ts` now expose `link_session_to_project`, so `sessionIds` is persisted as a real project/session association instead of remaining unused.
- `apps/desktop/src/routes/+page.svelte` now links a newly created session into the active project and refreshes the project strip so the association is visible immediately.
- `apps/desktop/src-tauri/src/storage.rs` now auto-learns `preferred_output_folder` and `preferred_output_format` from accepted manual Copilot responses when the session is linked to a project, and returns those learned entries through `submit_copilot_response`.
- `apps/desktop/src/lib/components/ProjectSelector.svelte` now shows linked session counts and project-level informational feedback when a session link or auto-learning event occurs.
- Backend regression coverage now includes persisted `sessionIds` linkage and `source: auto` project memory extraction.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test`, and `git diff --check` all pass after closing these Prompt 16 implementation gaps.

Project session-management and broader auto-learning verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `packages/contracts/src/ipc.ts`, `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/project.rs`, and `apps/desktop/src/lib/ipc.ts` now expose `set_session_project`, which removes a session from prior projects before attaching it to a new one or leaving it unassigned.
- `apps/desktop/src/routes/+page.svelte` now loads `listSessions()` into project UI state and derives linked vs. available sessions for the selected project.
- `apps/desktop/src/lib/components/ProjectSelector.svelte` now renders a project-centric session panel with linked-session browsing, open/detach actions, and an assign-existing-session control that also works as reassignment when the session already belongs to another project.
- `apps/desktop/src-tauri/src/storage.rs` now broadens `source: auto` learning beyond output path/format to also infer `preferred_output_sheet`, `create_backup_on_replace`, and `overwrite_existing_files` from accepted structured actions.
- Rust regression coverage now verifies project reassignment/unassignment persistence and the expanded auto-learned memory set.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Project filtering, bulk actions, and free-form auto-learning verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src/lib/components/ProjectSelector.svelte` now adds session search plus bulk attach/detach actions that operate on the currently filtered project session lists.
- `apps/desktop/src/routes/+page.svelte` now derives filtered linked/available session sets from the search query and reuses `set_session_project` for bulk reassignment without introducing a separate project screen.
- `apps/desktop/src-tauri/src/storage.rs` now learns project preferences from free-form accepted Copilot text in addition to structured action args, using `summary`, `message`, `warnings`, and `followUpQuestions` as heuristic signals.
- Rust regression coverage now includes `accepted_response_auto_learns_from_free_form_text`, which verifies output path, output format, output sheet, backup preference, and overwrite preference extraction from natural-language response content.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Project scope approval UI verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src/lib/agent-loop.ts` now surfaces project-scope warnings as structured approval payloads that include the raw Copilot response and all violating paths, so the UI can continue from the blocked turn instead of only failing.
- `apps/desktop/src/routes/+page.svelte` now opens a dedicated scope-override approval state for both pasted/manual responses and autonomous Copilot turns, and an approved override flows into the existing preview/save approval path instead of bypassing it.
- Plan execution no longer marks the current write step failed when the only issue is a pending scope override; approving the override prepares the current response for preview and then resumes the remaining plan steps after save.
- `apps/desktop/src/lib/components/InterventionPanel.svelte` and `apps/desktop/src/lib/components/ApprovalGate.svelte` now render a dedicated project-scope approval card in delegation mode while reusing the same approval control for the manual Studio flow.
- `docs/PROJECT_MODEL_DESIGN.md` and `PLANS.md` now reflect that the previously missing scope-override approval UI is implemented, with the remaining limitation reduced to persistence/audit depth rather than the absence of the approval step itself.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Persisted scope approval audit verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `packages/contracts/src/ipc.ts`, `apps/desktop/src/lib/ipc.ts`, `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/execution.rs`, and `apps/desktop/src-tauri/src/lib.rs` now expose `record_scope_approval`, a dedicated IPC path for persisting project-scope override decisions.
- `apps/desktop/src-tauri/src/storage.rs` now writes `scope-approval` artifacts, records matching turn-log events, and ties each scope override to the current response artifact so stale approvals are not reused after a later response submission.
- The approval inspection payload now includes an optional `scopeOverride` record, and write approvals are also tied to the current preview artifact so persisted turn details stay aligned with the latest preview/response pair.
- `apps/desktop/src/routes/+page.svelte` now records the approved project-scope override before continuing into preview generation, so the override is no longer a frontend-only state transition.
- Rust regression coverage now includes `persists_scope_override_approval_as_a_turn_artifact`, which verifies that the saved artifact and turn-inspection payload survive reload.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Dedicated approval history panel verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now loads `read_turn_artifacts` into a dedicated expert-side approval history panel for the current turn instead of leaving scope-override records visible only through indirect inspection payloads.
- The new panel shows the latest write-approval state plus the full list of persisted `scope-approval` artifacts for the current turn, including decision, source, root folder, violating paths, timestamp, note, and artifact id.
- The inspection view refreshes after setup, response submission, preview generation, scope-override approval, and save execution so the audit panel tracks the latest persisted turn state without a restart.
- `docs/PROJECT_MODEL_DESIGN.md` and `PLANS.md` now describe the dedicated current-turn approval history panel as implemented, leaving only the cross-session reporting view out of scope.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Cross-session approval reporting verification:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now builds a project-scoped cross-session approval report by combining `read_session` and `read_turn_artifacts` for the linked sessions of the selected project, without widening the backend command surface.
- The project strip now renders a dedicated `横断承認レポート` card that shows the latest turn per linked session, including write-approval state, scope-override count, latest scope decision and source, turn status, timestamps, output path, and a direct jump back into the session.
- The report respects the existing session search query, refreshes after project/session linkage changes and after turn lifecycle changes in the active session, and guards against stale async results when the selected project changes mid-load.
- `docs/PROJECT_MODEL_DESIGN.md` and `PLANS.md` now reflect that both current-turn and cross-session approval audit views are implemented, reducing the remaining limitation to local-only reporting rather than missing visibility.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm check`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` all pass after this follow-up.

Project scope hardening follow-up:

```bash
pnpm --filter @relay-agent/desktop typecheck
cd apps/desktop && pnpm dlx tsx --test src/lib/project-scope.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/storage.rs` now requires `create_project.rootFolder` to point to an existing directory, which keeps project-scope guards anchored to a real local root without adding a custom length cap to `customInstructions`.
- `apps/desktop/src/lib/project-scope.ts` now holds the shared path-scope helpers, and `apps/desktop/src/routes/+page.svelte` consumes `validateProjectScopeActions(...)` instead of keeping the check as an untested local closure.
- `apps/desktop/src/lib/project-scope.test.ts` covers Windows-style path normalization, supported file-path argument extraction, and duplicate out-of-scope path collapse.
- `pnpm --filter @relay-agent/desktop typecheck`, `cd apps/desktop && pnpm dlx tsx --test src/lib/project-scope.test.ts`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` pass after this follow-up.

Tool registry and MCP integration follow-up:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
git diff --check
```

Observed result:

- `docs/TOOL_REGISTRY_DESIGN.md` now documents the shared tool-registration model, MCP discovery/call flow, security posture, and the desktop-command-backed browser automation path.
- `packages/contracts/src/relay.ts` and `packages/contracts/src/ipc.ts` now define `ToolRegistration`, MCP server config/request shapes, tool-enable IPC payloads, and MCP connect/invoke responses.
- `apps/desktop/src-tauri/src/tool_registry.rs` now registers built-in workbook/file/text/browser tool metadata, filters enabled tools into Relay packets, and routes read-tool execution through one registry path instead of hard-coded packet lists.
- `apps/desktop/src-tauri/src/mcp_client.rs` now discovers and invokes MCP tools over HTTP JSON-RPC and stdio, and `apps/desktop/src-tauri/src/execution.rs` exposes `list_tools`, `set_tool_enabled`, `connect_mcp_server`, and `invoke_mcp_tool`.
- `apps/desktop/src/lib/components/SettingsModal.svelte`, `apps/desktop/src/routes/+page.svelte`, `apps/desktop/src/lib/ipc.ts`, and `apps/desktop/src/lib/continuity.ts` now provide built-in tool toggles, MCP server transport selection, discovered-tool display, and continuity-backed restoration of disabled tools and known MCP servers.
- `apps/desktop/src/lib/tool-runtime.ts`, `apps/desktop/src/lib/agent-loop.ts`, and `apps/desktop/src/routes/+page.svelte` now run `browser.send_to_copilot` through a concrete registry-compatible desktop tool runtime instead of treating it as metadata-only.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, and `git diff --check` pass after this follow-up.

Tool registry persistence follow-up:

```bash
pnpm --filter @relay-agent/desktop typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/persistence.rs` now persists `tool-settings.json` alongside the existing manifest/session/project state, and `apps/desktop/src-tauri/src/storage.rs` restores disabled tool ids plus saved MCP server configs during `AppStorage::open(...)`.
- Saved MCP servers now reconnect on startup with best-effort discovery, while `set_tool_enabled` and `connect_mcp_server` persist their backend state immediately instead of relying only on frontend continuity.
- `apps/desktop/src/routes/+page.svelte` now treats backend local-json storage as the source of truth for tool restore, surfaces backend restore warnings in the settings area, and keeps the previous continuity-based reapply flow as the fallback for memory mode.
- `apps/desktop/src-tauri/src/storage.rs` now includes regression coverage for persisting a stdio MCP server plus a disabled MCP tool across reload.
- `pnpm --filter @relay-agent/desktop typecheck`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, and `git diff --check` pass after this follow-up.

Tool registry boundary-removal follow-up:

```bash
pnpm --filter @relay-agent/contracts typecheck
pnpm --filter @relay-agent/desktop typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/browser_automation.rs`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/models.rs`, `packages/contracts/src/ipc.ts`, and `apps/desktop/src/lib/ipc.ts` now move Copilot browser execution behind Tauri commands, including progress-event relay from the backend to the frontend UI.
- `apps/desktop/src/lib/copilot-browser.ts` is now an IPC/event bridge instead of a direct shell/path runner, so `browser.send_to_copilot` no longer keeps its execution engine in the frontend layer.
- `apps/desktop/src-tauri/src/mcp_client.rs` now keeps reusable stdio MCP sessions alive across multiple requests and reconnects on disconnect, and regression coverage includes a persistent-session test instead of only request-per-process behavior.
- `docs/TOOL_REGISTRY_DESIGN.md`, `docs/BROWSER_AUTOMATION.md`, and `PLANS.md` now describe browser automation as backend-executed and stdio MCP as session-based instead of command-style-only.
- `pnpm --filter @relay-agent/contracts typecheck`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, and `git diff --check` pass after this follow-up.

Tool registry and MCP safety-fix follow-up:

```bash
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm -C packages/contracts build
pnpm --filter @relay-agent/desktop typecheck
pnpm dlx tsx --test src/lib/tool-runtime.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/tool_registry.rs` no longer calls `tauri::async_runtime::block_on(...)` for MCP tools from the synchronous registry path, and instead returns an explicit error directing callers to `invoke_mcp_tool`.
- `apps/desktop/src-tauri/src/execution.rs` now rejects disabled MCP tools, rejects malformed `mcp.{server}.{tool}` ids via `parse_mcp_tool_name(...)`, and covers both failure paths with unit tests.
- `apps/desktop/src/lib/tool-runtime.ts` now validates MCP registration metadata before IPC, rejects disabled tools on the client side, and wraps MCP invocation with a 30-second timeout.
- `apps/desktop/src/lib/tool-runtime.test.ts` now covers missing `mcpServerUrl`, disabled MCP tools, unknown builtin ids, propagated MCP errors, and timeout behavior in addition to the existing success-path tests.
- This follow-up is a correctness fix for the existing task `155–159` surface rather than a new Task Master milestone, so `.taskmaster/tasks/tasks.json` was left unchanged.

Artifact-first output follow-up:

```bash
pnpm -C packages/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check
git diff --check
```

Observed result:

- `docs/ARTIFACT_OUTPUT_DESIGN.md` now documents the artifact-first preview/save pipeline, output artifact model, quality-validation boundary, and the compatibility rule that keeps `diffSummary` alive while the UI migrates to `artifacts`.
- `packages/contracts/src/relay.ts` and `packages/contracts/src/ipc.ts` now define `artifactType`, `outputArtifact`, `outputSpec`, `qualityCheckResult`, preview/execution artifact payloads, `run_execution_multi`, and `validate_output_quality`.
- `apps/desktop/src-tauri/src/models.rs`, `apps/desktop/src-tauri/src/storage.rs`, `apps/desktop/src-tauri/src/execution.rs`, and `apps/desktop/src-tauri/src/quality_validator.rs` now emit artifact arrays for preview/execution, support derived multi-output exports, and validate saved output quality with row-count, empty-value, encoding, and CSV-injection checks.
- `apps/desktop/src/lib/components/ArtifactPreview.svelte`, `apps/desktop/src/lib/components/InterventionPanel.svelte`, `apps/desktop/src/routes/+page.svelte`, `apps/desktop/src/lib/ipc.ts`, and `apps/desktop/src/lib/continuity.ts` now render generic artifacts in the approval flow, persist artifact snapshots across draft restore, and push post-save quality results into the activity feed.
- `pnpm -C packages/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm check`, and `git diff --check` all pass after this milestone.

Artifact multi-output follow-up:

```bash
pnpm --filter @relay-agent/desktop typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/storage.rs` no longer makes `run_execution_multi` depend on an implicit default `run_execution` save-copy side effect. Requested `outputSpecs` now drive workbook execution directly.
- Multi-output workbook execution now refuses fake format conversions: native `csv` and copy-only `xlsx` stay format-correct, while derived `json` and `text` outputs are rendered from a temporary transformed CSV and cleaned up afterward.
- Text multi-output is now a summary report instead of a raw file copy, which makes the `text` format match the “filtered CSV + text report” intent from the artifact-output prompt.
- Regression coverage now includes `run_execution_multi_uses_requested_output_specs_without_creating_default_output`, proving that custom JSON and text outputs are produced without leaving behind the Copilot-proposed default save-copy path.
- `pnpm --filter @relay-agent/desktop typecheck`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `git diff --check` pass after this refinement.

Artifact output fix follow-up:

```bash
pnpm -C packages/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Observed result:

- `apps/desktop/src-tauri/src/quality_validator.rs` now parses sampled CSV rows with a quoted-field-aware `split_csv_line(...)` helper instead of naive `split(',')`, so empty-value checks and CSV-injection detection no longer mis-handle `"a,b"` style fields.
- The quality validator now samples up to 10 MB per file, adds a warning when only the leading sample was inspected, and includes regression coverage for quoted commas and large-file sampling.
- `packages/contracts/src/ipc.ts`, `apps/desktop/src-tauri/src/models.rs`, and `apps/desktop/src-tauri/src/storage.rs` now expose persisted `execution` artifacts through `read_turn_artifacts`, including their `OutputArtifact[]` payload.
- `apps/desktop/src/routes/+page.svelte` now renders a dedicated expert-side `出力アーティファクト` inspection section that uses `ArtifactPreview` for the latest execution artifacts and falls back to the stored artifact id only when content is unavailable.
- This follow-up is a correctness fix for the existing task `160–163` surface rather than a new Task Master milestone, so `.taskmaster/tasks/tasks.json` was left unchanged.

Windows E2E fixes follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm -C packages/contracts build
pnpm -C apps/desktop exec node scripts/e2e_windows_smoke.mjs
pnpm -C apps/desktop launch:test
pnpm -C apps/desktop workflow:test
```

Observed result:

- `apps/desktop/src-tauri/src/mcp_client.rs` no longer runs Windows stdio MCP commands through POSIX-style backslash parsing. Windows command lines are now split without consuming path separators, and the stdio MCP regression tests plus persisted MCP tool reload test pass again on Windows.
- `apps/desktop/scripts/tauri_smoke_shared.mjs`, `apps/desktop/scripts/launch_tauri_smoke.mjs`, and `apps/desktop/scripts/launch_workflow_smoke.mjs` now branch correctly for Windows: they skip `Xvfb`, use the real Vite dev URL `http://127.0.0.1:1421`, and stop spawned processes with Windows-compatible cleanup.
- `apps/desktop/scripts/e2e_windows_smoke.mjs`, `apps/desktop/src-tauri/src/integration_tests.rs`, and `docs/E2E_WINDOWS_MANUAL_CHECKLIST.md` were added to satisfy the missing Windows E2E artifacts from `docs/CODEX_PROMPT_E2E_WINDOWS.md`, and `apps/desktop/package.json` plus `apps/desktop/src-tauri/Cargo.toml` were updated to wire them in.
- The fix prompt expected a ToolRegistry count of 21 built-ins, but the current product implementation exposes 10 built-in tools. The new integration coverage therefore locks to the current registry surface instead of inventing 11 new tools outside this milestone.
- All listed verification commands now pass on this Windows workspace, including `cargo test` with 79 passing tests, the contracts build, the new Windows smoke script, and the existing `launch:test` / `workflow:test` smoke flows.

Tauri WebDriver smoke follow-up:

```bash
pnpm -C apps/desktop check
pnpm -C apps/desktop e2e:webdriver
```

Observed result:

- `apps/desktop/e2e-tests/tauri.webdriver.mjs` now provides packaged-app smoke coverage through `tauri-driver` and `msedgedriver`, including launch, welcome dismissal, Manual mode selection, guided workflow presence, and settings modal access.
- `apps/desktop/package.json` and `pnpm-lock.yaml` now wire in the dedicated `e2e:webdriver` script plus `mocha`, `chai`, and `selenium-webdriver`.
- `apps/desktop/src/lib/components/ActivityFeed.svelte` no longer forces `afterUpdate + tick` scrolling on every render. Auto-scroll now only runs when the event tail changes, which removed the WebDriver hang seen during desktop automation.
- The temporary probe-only instrumentation used during root-cause isolation was removed before verification, and the final report artifact is recorded in `docs/TAURI_WEBDRIVER_E2E_REPORT.md`.
- `pnpm -C apps/desktop check` passed with zero Svelte diagnostics, and `pnpm -C apps/desktop e2e:webdriver` passed with 2 passing tests on this Windows workspace.

Copilot live E2E follow-up:

```bash
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm -C apps/desktop exec tauri info
pnpm -C apps/desktop copilot-browser:build
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch --cdp-port 9333 --timeout 60000
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --cdp-port 9333 --timeout 60000
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --cdp-port 9342 --timeout 60000
```

Observed result:

- `pnpm typecheck` passed, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with `104` tests.
- `pnpm -C apps/desktop exec tauri info` confirmed Windows 10.0.26100, WebView2 `146.0.3856.84`, Node `24.13.1`, pnpm `10.33.0`, Rust `1.93.1`, and Tauri `2.10.3`.
- `pnpm -C apps/desktop copilot-browser:build` succeeded and rebuilt `apps/desktop/scripts/dist/copilot-browser.js`.
- Live CDP connection worked when Edge was launched manually by full executable path on port `9333`; the M365 Copilot page, prompt editor, and send button were present, and a direct Playwright probe returned `CDP connection works`.
- Auto-launch still failed on Windows in this workspace because `copilot-browser.js` shells out to `msedge.exe` and assumes it is on `PATH`; the live run returned `CDP_UNAVAILABLE` with `spawn msedge.exe ENOENT`.
- A fresh-profile probe on port `9334` showed an upgrade/upsell page while the current readiness check still reported `ready`, which means the live readiness heuristic is too weak for non-usable Copilot states.
- The detailed live execution record is stored in `docs/E2E_COPILOT_LIVE_REPORT.md`. Only Phase `A-2` and `A-3` were fully verified in this session; later app-driven phases remain explicitly unexecuted.

Copilot account-state clarity follow-up:

```bash
pnpm -C apps/desktop check
pnpm -C apps/desktop copilot-browser:build
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --cdp-port 9333 --timeout 60000
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action send --cdp-port 9333 --timeout 60000 --prompt "Reply with exactly OK and nothing else."
node apps/desktop/scripts/dist/copilot-browser.js --action send --cdp-port 9334 --timeout 60000 --prompt "Reply with ok"
```

Observed result:

- `apps/desktop/scripts/copilot-browser.ts` now resolves the Edge executable from standard Windows install paths before falling back to `msedge.exe` on `PATH`.
- The Copilot readiness check now requires a usable prompt UI and explicitly rejects upgrade / upsell pages as `NOT_LOGGED_IN` instead of reporting a false `ready` state.
- The send flow now treats network-response capture as opportunistic and falls back to DOM polling if the network hook fails, which avoids surfacing spurious internal browser errors to the user.
- `apps/desktop/src/lib/copilot-browser.ts` now shows clearer user-facing guidance: sign in with the account that can actually use M365 Copilot, rather than only saying "not logged in."
- `pnpm -C apps/desktop check` and `pnpm -C apps/desktop copilot-browser:build` passed after the change.
- Live verification passed on the usable profile at port `9333`: `connect` returned `ready`, and `send` returned `{"status":"ok","response":"OK"}`.
- The non-usable profile at port `9334` now fails the send path with `NOT_LOGGED_IN`, which matches the intended single-account UX better than silently treating the page as ready.

Guided flow live E2E follow-up:

```bash
pnpm -C apps/desktop exec tauri build --no-bundle
```

Observed result:

- The packaged Tauri app was driven through WebDriver with isolated `RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR` values so that manual-flow checks did not depend on existing local continuity state.
- Step 1 setup passed in Manual mode: entering `C:\relay-test\data_a.csv` plus the objective `approved が true の行だけ残してください` enabled the Step 2 Copilot flow.
- Step 2 live Copilot execution passed: the app-populated response JSON proposed `table.filter_rows` with `[approved] == true` and `workbook.save_copy` to `C:/relay-test/data_a.copy.csv`.
- Invalid JSON handling passed: pasting `{"invalid": true}` produced a validation card and did not expose any enabled save button.
- Step 3 review/save passed: Relay Agent completed the save-copy flow and wrote `C:\relay-test\data_a.copy.csv`, whose contents contained only `approved=true` rows.
- `docs/E2E_COPILOT_LIVE_REPORT.md` was updated to reflect the newly verified `A-4`, `B-1`, `B-2`, `B-3`, and `B-4` scenarios.

Copilot live E2E follow-up 2:

```bash
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch --cdp-port 9333 --timeout 60000
node --dns-result-order=ipv4first apps/desktop/scripts/dist/copilot-browser.js --action send --cdp-port 9333 --timeout 5000 --prompt "Reply with exactly OK and nothing else."
pnpm -C apps/desktop exec tauri build --no-bundle
# plus inline selenium-webdriver packaged-app probes with isolated
# RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR values under C:\relay-test\
```

Observed result:

- `connect --auto-launch` now returns `{"status":"ready","cdpPort":9333}` on this Windows machine instead of failing with `spawn msedge.exe ENOENT`. This run attached to the existing Edge session on `9333`, so it proves the Windows path fix but not a cold-start Edge launch from zero state.
- `send --timeout 5000` now reproduces `RESPONSE_TIMEOUT` in the standalone browser tool, which gives a stable lower bound for timeout-focused app checks.
- Packaged-app WebDriver probing now verifies `C-1` end to end: Manual mode + `cdpPort=9333` + `timeoutMs=60000` successfully populates the in-app Copilot response field after `Copilotに自動送信 ▶`.
- Packaged-app timeout probing still exposes a product gap for `C-2`: `timeoutMs=1000` fails early with a CDP error, while `timeoutMs=5000` can leave a partially populated response without surfacing a reliable timeout error card.
- Smart approval probing now verifies `H-2`: with `approvalPolicy=standard`, a valid `table.filter_rows + workbook.save_copy` response reaches Step 3, shows the `保存する` gate, and does not write an output before approval.
- Smart approval probing found two regressions:
  - `H-3`: with `approvalPolicy=fast`, the same medium-risk save-copy response still stops at the manual `保存する` gate and does not auto-execute, even though `apps/desktop/src-tauri/src/risk_evaluator.rs` says `Fast` should auto-approve `Medium`.
  - `H-4`: setting `approvalPolicy=fast` in an isolated packaged-app profile does not persist across restart; reopening settings shows `safe`.
- `docs/E2E_COPILOT_LIVE_REPORT.md` was updated again to record the new `A-1`, `C-1`, `C-2`, `H-2`, `H-3`, and `H-4` results.

Copilot live E2E follow-up 3:

```bash
# plus inline selenium-webdriver packaged-app probes with isolated
# RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR values under C:\relay-test\
# for Delegation mode planning approval
```

Observed result:

- Delegation-mode probing now reaches a real in-app plan proposal against the live `9333` Copilot session after seeding `recentFiles` through the Manual flow.
- The packaged app rendered a four-step proposed plan with editable steps and visible `計画を承認する / 再計画する / キャンセル` controls, which is enough to mark the planning half of `D-1` as exercised.
- The current blocker is the approval transition itself: under packaged-app WebDriver, clicking the visible `計画を承認する` control did not move the app into execution, write approval, or completion.
- `docs/E2E_COPILOT_LIVE_REPORT.md` was updated again to mark `D-1` as a concrete failure instead of an unexecuted scenario.

Browser automation inspect mode follow-up:

```bash
pnpm -C apps/desktop copilot-browser:build
node apps/desktop/scripts/dist/copilot-browser.js --action inspect --timeout 1000
```

Observed result:

- `apps/desktop/scripts/copilot-browser.ts` now supports `--action inspect`, which collects selector probes, DOM fallback candidate probes, and observed response URL metadata in one JSON payload.
- The send path now records which selector actually drove new-chat, editor, send-button, and DOM-response capture, so task `76` no longer depends entirely on ad hoc DevTools notes before a source update can be prepared.
- `docs/BROWSER_AUTOMATION.md` and `docs/BROWSER_AUTOMATION_VERIFICATION.md` now document the inspect workflow and how to transfer its output into the remaining manual verification checklist.
- `pnpm -C apps/desktop copilot-browser:build` passes after the change.
- `node apps/desktop/scripts/dist/copilot-browser.js --action inspect --timeout 1000` returns a structured `CDP_UNAVAILABLE` error in this Linux environment, which confirms the new action is wired into the CLI even though live Edge/M365 validation still requires Windows.

Copilot live E2E follow-up 4:

```bash
# plus inline selenium-webdriver packaged-app probes with isolated
# RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR values under C:\relay-test\
# for pipeline, batch, template, PII, session recovery, and project-memory persistence
```

Observed result:

- The automation-workbench blockers are now explicit in the packaged app:
  - `E-1`: the pipeline builder accepted a title, input path, and two goals, and `実行開始` became enabled, but clicking it did not update `PipelineProgress`, create any `data_a.pipeline-step-*.csv` outputs, or surface a visible error.
  - `F-1`: the batch goal field accepted input, but the file-selection path did not populate any target cards in the UI, `バッチ進行ダッシュボード` stayed at `まだジョブがありません。`, and no `relay-batch-output` directory was created.
  - `G-1`: built-in template selection did work and switched the workbench from `テンプレート` to `パイプライン`, but the end-to-end template execution remained blocked by the same pipeline no-op as `E-1`.
- `I-1` is now exercised and failing: a `pii_test.csv` containing `name,email,phone,amount` advanced from Step 1 into `2. Copilot に聞く` without any visible warning banner, friendly error, or caution text before copy.
- `J-2` is now exercised and failing in the packaged-app restart path: after completing Manual-mode Step 1 and relaunching with the same isolated app-local-data directory, the startup view still showed `最近のファイル / まだ履歴がありません。` and did not expose any recent-session recovery UI.
- `J-3` is now exercised and passing: a project named `Memory Test` plus project-memory entry `delimiter = comma` persisted across a packaged-app restart and remained visible after reselecting the project.
- `docs/E2E_COPILOT_LIVE_REPORT.md` was updated again to record the new `E-1`, `F-1`, `G-1`, `I-1`, `J-2`, and `J-3` results.

Phase 1 claw-code integration follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml copilot_provider
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/Cargo.toml` now pins `claw-core`, `claw-tools`, `claw-provider`, `claw-permissions`, and `claw-compact` to `claw-cli/claw-code-rust` commit `33e5883d7909afd0c55b00b49c3034e21e33f440`.
- `apps/desktop/src-tauri/src/copilot_provider.rs` now implements `CopilotChatProvider` for `claw_provider::ModelProvider`, including prompt formatting, Copilot browser script execution, response parsing into `ModelResponse`, fenced `tool_use` JSON extraction, parse-retry handling, and pseudo-stream conversion for `claw_core::query()`.
- `apps/desktop/src-tauri/src/lib.rs` now exports `CopilotChatProvider` so later Tauri bridge work can compose it without another module refactor.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml copilot_provider` passed with 4 tests covering JSON envelope parsing, fenced tool-use extraction, pseudo-stream emission, and `claw_core::query()` integration.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after adding the claw crates.
- Task note: `T01` remains pending because no repository fork was created in this workspace. The implementation used the currently reachable upstream `claw-cli/claw-code-rust` directly so Phase 1 code work could proceed without blocking on GitHub ownership operations.

Phase 2 claw-tools builtins follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml execute_claw_tool_reads_file_from_registered_builtin_registry
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml claw_tool_registry_registers_expected_builtins
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/state.rs` now constructs a dedicated `claw_tools::ToolRegistry`, registers the 6 built-in tools (`bash`, `file_read`, `file_write`, `file_edit`, `glob`, `grep`), and stores it on `DesktopState`.
- `apps/desktop/src-tauri/src/execution.rs` now exposes `execute_claw_tool` as a Tauri command and routes a single built-in invocation through the shared claw registry with an auto-approve permission policy.
- `apps/desktop/src-tauri/src/models.rs` now includes `ExecuteClawToolRequest` and `ExecuteClawToolResponse` for the new command surface.
- `apps/desktop/src-tauri/src/lib.rs` now registers `execution::execute_claw_tool` in the Tauri invoke handler.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml execute_claw_tool_reads_file_from_registered_builtin_registry` passed, verifying that `file_read` can be executed through the registered claw built-ins.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml claw_tool_registry_registers_expected_builtins` passed, confirming that all 6 built-ins are present in the stored registry.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after wiring the new registry and command.

Phase 2 relay tool wrappers follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml registers_all_relay_tools
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml workbook_inspect_tool_reads_session_workbook
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml table_filter_rows_tool_writes_save_copy_output
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/relay_tools.rs` now registers thin `claw_tools::Tool` wrappers for `workbook.inspect`, `sheet.preview`, `sheet.profile_columns`, `session.diff_from_base`, `table.rename_columns`, `table.cast_columns`, `table.filter_rows`, `table.derive_column`, `table.group_aggregate`, `workbook.save_copy`, and `document.read_text`.
- The Relay wrappers reuse the existing workbook engine and file/document readers instead of reimplementing transform logic. Write-side wrappers execute through `WorkbookEngine::execute_actions`, which preserves the existing save-copy-only behavior and derives an output path when one is not supplied.
- `apps/desktop/src-tauri/src/state.rs` now builds the claw registry with both the 6 built-ins and the Relay-specific tools, and `DesktopState.storage` is shared as `Arc<Mutex<AppStorage>>` so relay wrappers can resolve session workbook paths and diff artifacts.
- `apps/desktop/src-tauri/src/storage.rs` now exposes helper methods for reading the current session model, latest turn, resolving a workbook source from session context, and reading the latest diff summary for `session.diff_from_base`.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml registers_all_relay_tools` passed, confirming all 11 Relay tools are present in the claw registry.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml workbook_inspect_tool_reads_session_workbook` passed, confirming `workbook.inspect` can resolve the workbook source from `session_id` context.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml table_filter_rows_tool_writes_save_copy_output` passed, confirming a Relay write tool can execute through the claw wrapper and still produce a filtered save-copy CSV.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the Relay tool integration.

Phase 2 legacy tool module removal follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tool_catalog
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml execute_read_actions_supports_file_tools_and_blocks_traversal
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml execute_read_actions_supports_text_search_and_document_read_text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview_and_run_execution_support_text_replace_actions
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tool_registry_lists_current_builtin_tools
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml disabled_tool_returns_error
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp_tool_returns_delegation_error
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/tool_registry.rs` was removed and replaced with `apps/desktop/src-tauri/src/tool_catalog.rs`, which keeps tool metadata, enable/disable state, and MCP registration without owning execution logic.
- `apps/desktop/src-tauri/src/file_ops.rs` was removed and replaced with `apps/desktop/src-tauri/src/file_support.rs`, preserving the file/document helper behavior needed by the current preview and execution flow while eliminating the old module dependency.
- `apps/desktop/src-tauri/src/read_action_executor.rs` now owns read-tool dispatch for `storage.rs`, so read execution no longer routes through the deleted custom registry implementation.
- `apps/desktop/src-tauri/src/storage.rs`, `apps/desktop/src-tauri/src/relay_tools.rs`, `apps/desktop/src-tauri/src/integration_tests.rs`, and `apps/desktop/src-tauri/src/lib.rs` were updated to reference the new modules and keep MCP restore, tool settings persistence, and text/file preview flows intact.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with 114 tests after the module removal, confirming the replacement wiring preserved the existing backend behavior.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after deleting the legacy module filenames and updating the import graph.

Phase 2 tool migration E2E follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml claw_tool_registry_executes_builtin_tools_end_to_end
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml claw_tool_registry_executes_relay_tools_end_to_end
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml claw_tool_registry_supports_csv_inspect_filter_save_copy_flow
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/state.rs` now includes claw-registry-backed integration tests that execute all 6 built-in tools (`bash`, `file_read`, `file_write`, `file_edit`, `glob`, `grep`) through the shared `DesktopState.claw_tool_registry` instead of via direct module calls.
- The same test module now executes all 11 Relay tools through the shared claw registry, covering workbook inspection, sheet preview, column profiling, session diff reads, the 6 save-copy workbook writes, and `document.read_text`.
- A dedicated registry-flow regression now drives a CSV file through `workbook.inspect` -> `table.filter_rows` -> `workbook.save_copy`, then asserts the reviewed copy contains only filtered rows and the original CSV input remains unchanged.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with 117 tests after adding the three registry E2E regressions.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the new E2E coverage was added.

Phase 3 Tauri bridge follow-up:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/tauri_bridge.rs` now implements the Rust-side agent bridge for the Tauri frontend, including `start_agent`, `respond_approval`, `cancel_agent`, and `get_session_history`.
- The bridge runs a thin `claw-core` session loop around `SessionState`, `ModelProvider`, and the shared `claw_tools::ToolRegistry`, emits `agent:tool_start`, `agent:tool_result`, `agent:approval_needed`, `agent:turn_complete`, and `agent:error`, and maintains in-memory session history for later fetches.
- Write-capable tools now pass through a bridge-owned approval gate that emits `approval_needed` and waits on `respond_approval` before execution continues. Cancellation interrupts the loop, releases pending approvals, and surfaces a cancellation error event.
- `apps/desktop/src-tauri/src/state.rs` now stores shared `AgentRuntimeState`, and `apps/desktop/src-tauri/src/lib.rs` now registers the new bridge module and commands in the Tauri invoke handler.
- `apps/desktop/src-tauri/src/models.rs` now exposes the request types needed by the bridge command surface, and `apps/desktop/src-tauri/Cargo.toml` now promotes `tokio` to a normal dependency because the bridge uses runtime synchronization primitives in library code.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted tests covering tool-event emission, approval-wait behavior for mutating tools, and runtime cancellation state.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with 120 tests after the bridge module was wired into the crate.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the Tauri bridge integration.

Phase 3 frontend agent-ui follow-up:

```bash
pnpm -C apps/desktop exec tsx --test src/lib/agent-ui.test.ts
pnpm -C apps/desktop check
```

Observed result:

- `apps/desktop/src/lib/agent-ui.ts` now provides the frontend bridge layer for the new Rust agent loop, with `feedStore`, `approvalStore`, and `sessionStore` backed by Tauri `agent:*` event listeners.
- The module now exposes `startAgent`, `respondApproval`, `cancelAgent`, `refreshSessionHistory`, `bindAgentUi`, `disposeAgentUi`, and `resetAgentUi`, and invokes the new Rust commands `start_agent`, `respond_approval`, `cancel_agent`, and `get_session_history`.
- Store updates are event-driven: `tool_start` and `tool_result` append feed entries, `approval_needed` populates the pending-approval store, `turn_complete` marks the session completed, and `agent:error` marks the session failed or cancelled.
- `apps/desktop/src/lib/index.ts` now exports `agent-ui` so later UI wiring can consume the new API without deep relative imports.
- `apps/desktop/src/lib/agent-ui.test.ts` now covers session bootstrap/history hydration and approval/completion event handling using injected mock `listen` and `invoke` dependencies.
- `pnpm -C apps/desktop exec tsx --test src/lib/agent-ui.test.ts` passed with 2 tests.
- `pnpm -C apps/desktop check` passed with 0 errors and 0 warnings after adding the new frontend bridge module.

Phase 3 legacy agent-loop module removal follow-up:

```bash
pnpm -C apps/desktop exec tsx --test src/lib/copilot-turn.test.ts src/lib/agent-ui.test.ts
pnpm -C apps/desktop check
```

Observed result:

- The legacy frontend module filenames are now gone: `apps/desktop/src/lib/agent-loop.ts`, `apps/desktop/src/lib/agent-loop-core.ts`, `apps/desktop/src/lib/agent-loop-prompts.ts`, `apps/desktop/src/lib/tool-runtime.ts`, and `apps/desktop/src/lib/copilot-browser.ts` were removed.
- Their remaining responsibilities were moved under non-legacy module names: `apps/desktop/src/lib/copilot-agent.ts` now holds the pre-existing loop orchestration API used by the current page, `apps/desktop/src/lib/copilot-turn.ts` now holds turn retry/timeout helpers, and `apps/desktop/src/lib/browser-automation-ui.ts` now holds the browser automation helper exports including `sendPromptViaBrowserTool`.
- `apps/desktop/src/lib/index.ts` now re-exports the renamed modules, so the current route can keep importing from `$lib` without depending on the deleted legacy file names.
- `apps/desktop/src/lib/ipc.ts` no longer exports the unused `invokeMcpTool` helper after `tool-runtime.ts` removal; the remaining browser automation IPC helpers stay in place because the current frontend still uses them through `browser-automation-ui.ts`.
- The deleted legacy tests `agent-loop-prompts.test.ts` and `tool-runtime.test.ts` were dropped with their modules, and the reusable loop-helper coverage was preserved by moving `agent-loop-core.test.ts` to `apps/desktop/src/lib/copilot-turn.test.ts`.
- `pnpm -C apps/desktop exec tsx --test src/lib/copilot-turn.test.ts src/lib/agent-ui.test.ts` passed with 13 tests.
- `pnpm -C apps/desktop check` passed with 0 errors and 0 warnings after the legacy module removal.

Phase 3 Svelte delegation UI rewiring follow-up:

```bash
pnpm -C apps/desktop exec tsx --test src/lib/agent-ui.test.ts src/lib/copilot-turn.test.ts
pnpm -C apps/desktop check
```

Observed result:

- `apps/desktop/src/routes/+page.svelte` now binds the new Rust-backed `agent-ui` module on mount and disposes its listeners on teardown.
- The delegation-mode shell in `+page.svelte` now uses `TaskInput`, `UnifiedFeed`, `ApprovalCard`, and `CompletionCard` with the new `feedStore`, `approvalStore`, and `sessionStore` instead of the old delegation activity/intervention composer stack.
- Delegation submissions now call the Rust bridge through `startAgent`, approval actions now call `respondApproval`, and reset/cancel flows now call `cancelAgent` plus `resetAgentUi`.
- The existing manual-mode workbook/Copilot flow remains in place, so this change narrows the new event-driven UI wiring to delegation mode without widening scope into the manual workflow.
- `pnpm -C apps/desktop exec tsx --test src/lib/agent-ui.test.ts src/lib/copilot-turn.test.ts` passed with 13 tests.
- `pnpm -C apps/desktop check` passed with 0 errors and 0 warnings after wiring the new delegation UI components.

Phase 3 agent-loop migration E2E follow-up:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
pnpm -C apps/desktop agent-loop:test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Observed result:

- `apps/desktop/src-tauri/src/tauri_bridge.rs` now creates a backing Relay storage session and turn before the Rust agent loop starts, so Relay workbook tools invoked through the claw registry resolve the same `session_id` context that the rest of the app expects.
- `apps/desktop/src-tauri/src/agent_loop_smoke.rs` now adds a launched-app smoke runner that starts the real Tauri desktop shell, injects a deterministic mock provider sequence (`workbook.inspect` -> `table.filter_rows` -> final text), waits for a write approval, responds through the bridge, and verifies both emitted `agent:*` events and save-copy output behavior.
- `apps/desktop/scripts/launch_agent_loop_smoke.mjs` now launches `pnpm tauri:dev`, waits for frontend and desktop readiness, polls the smoke summary JSON, and fails unless approval, completion, filtered output, and source immutability checks all succeed.
- `apps/desktop/package.json` now exposes that launched-app flow as `pnpm -C apps/desktop agent-loop:test`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after wiring the smoke runner and bridge session fix.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted bridge tests.
- `pnpm -C apps/desktop agent-loop:test` passed. The smoke summary reported `approvalSeen: true`, `completionSeen: true`, the expected `agent:tool_start` / `agent:tool_result` / `agent:approval_needed` / `agent:turn_complete` events, an existing filtered output file, and an unchanged bundled sample source workbook.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with 120 tests after the agent-loop launched-app smoke flow was added.

Phase 4 storage split groundwork:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/approval_store.rs` now holds the live approval record types that `storage.rs` was previously defining inline.
- `apps/desktop/src-tauri/src/workbook_state.rs` now holds the live preview / execution / plan-progress record types that back workbook save-copy and execution inspection flows.
- `apps/desktop/src-tauri/src/storage.rs` now imports those state record types instead of defining them inline, reducing the first layer of storage-specific responsibility before the larger `claw-core` session migration.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the record-type split.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted tests after the split, confirming the Rust agent bridge still behaves the same.

Phase 4 session-store extraction follow-up:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml creates_reads_and_starts_turns -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/session_store.rs` now owns session and turn CRUD concerns, including session creation, turn start, latest-turn lookup, session detail reads, turn-status updates, and turn artifact linkage.
- `apps/desktop/src-tauri/src/storage.rs` now delegates its session-facing helpers to `SessionStore` instead of mutating `sessions` and `turns` maps directly, which narrows the next `claw-core` migration surface to one internal store boundary.
- Persistence behavior stays unchanged in this step: `storage.rs` still persists the same session and turn JSON payloads through `persistence::persist_session_state`, but now reads those maps from the extracted store.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the session-store extraction.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml creates_reads_and_starts_turns -- --nocapture` passed with the targeted storage CRUD regression.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted bridge tests after the extraction.

Phase 4 claw-core history sync groundwork:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml session_store::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/session_store.rs` now keeps a companion `claw_core::SessionState` per Relay session, seeded from the current session metadata and primary workbook path.
- The extracted session store now exposes `sync_session_messages` and `read_session_messages`, so `claw-core` message history can be updated independently of the UI runtime state.
- `apps/desktop/src-tauri/src/tauri_bridge.rs` now syncs the initial user goal and every subsequent assistant/tool-result history update back into `AppStorage`, which means the Rust agent loop no longer keeps the only copy of message history in its in-memory runtime wrapper.
- `get_session_history` now falls back to storage-backed `claw-core` history when the live agent runtime entry is unavailable.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the history-sync wiring.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml session_store::tests -- --nocapture` passed with the new `SessionStore` history roundtrip test.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted bridge regressions after the storage sync changes.

Phase 4 agent-runtime history deduplication follow-up:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml session_store::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/tauri_bridge.rs` no longer keeps a second copy of message history inside `AgentSessionRuntime`; the runtime now only tracks running/cancel/pending-approval state.
- Agent-loop history reads now come from storage-backed `SessionStore` / `claw-core::SessionState`, both for live-turn updates during the loop and for `get_session_history` responses.
- The bridge tests now assert history through `AppStorage::read_session_messages`, which confirms the shared storage-backed history is the only message source after a turn executes.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after removing the runtime-owned history copy.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml session_store::tests -- --nocapture` passed with the `SessionStore` core-history roundtrip regression.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted bridge regressions after the history deduplication change.

Phase 4 persisted session-history follow-up:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_sessions_and_turns_across_reloads -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/persistence.rs` now loads and saves a per-session `history.json` file alongside `session.json`, so the `claw-core` message history attached to each Relay session survives reloads.
- `apps/desktop/src-tauri/src/session_store.rs` now hydrates `claw_core::SessionState` from those persisted messages when storage is reopened instead of recreating empty history-only shells.
- `apps/desktop/src-tauri/src/storage.rs` now flushes session-history updates through `persist_session_state`, which means `sync_session_messages` updates both in-memory `SessionStore` state and local-json storage.
- The existing reload regression now verifies `history.json` exists and that a persisted assistant message is readable after reopening storage.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after adding persisted session history.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_sessions_and_turns_across_reloads -- --nocapture` passed with the extended reload/history regression.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 3 targeted bridge regressions after the persisted-history change.

Phase 4 session-store persistence boundary follow-up:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_sessions_and_turns_across_reloads -- --nocapture
```

Observed result:

- `apps/desktop/src-tauri/src/session_store.rs` now exposes a `PersistedSessionView` so `storage.rs` no longer needs to separately pull session maps, turn maps, and message history when persisting session state.
- `apps/desktop/src-tauri/src/tauri_bridge.rs` now removes finished agent runtimes from `AgentRuntimeState`, which avoids keeping stale in-memory runtime entries after storage-backed history has already been persisted.
- A targeted bridge regression now confirms `AgentRuntimeState::remove_session` drops the runtime entry as expected.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the persistence-boundary cleanup and runtime removal change.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tauri_bridge::tests -- --nocapture` passed with 4 targeted bridge regressions after adding runtime removal coverage.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_sessions_and_turns_across_reloads -- --nocapture` passed after the persistence-boundary cleanup, confirming reload behavior still works.

Phase 4 T14 completion:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview_execution_uses_latest_structured_response_from_session_history -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml validates_preview_and_approval_flow -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_turn_artifacts_and_logs_with_session_linkage -- --nocapture
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `apps/desktop/src-tauri/src/storage.rs` no longer owns a packet-first live lifecycle: the in-memory `relay_packets` / `responses` caches were removed, preview/approval/execution now resolve the latest structured response from persisted artifacts or `SessionStore`-backed `claw-core` history, and scope approvals now bind to that structured-response source.
- Turn inspection now treats relay packets as legacy persisted artifacts only. New turns no longer create relay-packet artifacts or packet-generated turn-log events, and the overview/inspection copy now points users at structured agent history as the active source of truth.
- The remaining `generate_relay_packet()` helper in `storage.rs` is now a pure legacy packet builder with no storage side effects. It no longer mutates turn status, appends logs, or records artifacts, which keeps old packet-shape tests available without reintroducing ownership of the conversation lifecycle.
- Storage regressions were updated to assert the new artifact/log set: `structured-response-recorded` replaces the old submit-flow event, and persisted turn artifacts now cover response, validation, preview, approval, and execution only.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the storage-boundary cleanup.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview_execution_uses_latest_structured_response_from_session_history -- --nocapture` passed with the session-history preview path.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml validates_preview_and_approval_flow -- --nocapture` passed with the structured-response preview/approval path.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml persists_turn_artifacts_and_logs_with_session_linkage -- --nocapture` passed with the new artifact and turn-log expectations.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passed with the static desktop bundle output.

Phase 4 T16 relay module removal:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
```

Observed result:

- `apps/desktop/src-tauri/src/relay.rs` was deleted. Its two thin Tauri command wrappers, `assess_copilot_handoff` and `record_structured_response`, now live in [execution.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/execution.rs).
- [lib.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/lib.rs) no longer declares `mod relay;`, and the invoke handler now binds those commands directly from `execution::...`.
- No frontend or contract surface changed: the invoke command names stay `assess_copilot_handoff` and `record_structured_response`, so the module deletion is internal cleanup only.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after removing the module.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed, confirming the remaining Rust test targets compile without `relay.rs`.

Phase 6 T17 dead Rust cleanup:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
pnpm --filter @relay-agent/desktop typecheck
```

Observed result:

- `apps/desktop/src-tauri/src/models.rs` no longer defines the unused Rust-side packet request/response types `GenerateRelayPacketRequest`, `RelayPacket`, and `RelayPacketResponseContract`.
- `apps/desktop/src-tauri/src/storage.rs` no longer exposes the legacy `generate_relay_packet()` helper or `build_packet_context()`. Rust-side tests now record structured responses directly after `start_turn()` instead of simulating the removed packet handoff.
- `apps/desktop/src-tauri/src/workflow_smoke.rs` and `apps/desktop/src-tauri/src/integration_tests.rs` were updated to match the current primary path, which starts a turn and records a structured response without a relay-packet pre-step.
- The legacy packet inspection payload reader remains in `storage.rs` so persisted old artifacts can still be inspected. Contract-level packet schema cleanup is deferred to `T18`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after the Rust cleanup.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed, confirming the Rust test targets compile after the helper/type removals.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.

Phase 6 T18 contracts simplification:

```bash
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- `packages/contracts/src/core.ts` no longer exposes the unused `Item` / `ItemKind` contract or the legacy turn-status values `packet-ready` and `awaiting-response`.
- `packages/contracts/src/relay.ts` no longer defines `RelayPacket`. The structured model response contract was renamed from `CopilotTurnResponse` to `AgentTurnResponse`, and the file now also exports typed `AgentEvent` / `AgentEventName` schemas for the Tauri bridge event stream.
- `packages/contracts/src/ipc.ts` now uses `agentTurnResponseSchema` for `recordStructuredResponse` request/response validation.
- `apps/desktop/src/lib/copilot-agent.ts`, `apps/desktop/src/lib/copilot-turn.ts`, and [ +page.svelte ](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) were updated to consume `AgentTurnResponse` instead of the old Copilot-specific contract name.
- `apps/desktop/src/lib/agent-ui.ts` now imports bridge event payload types from `@relay-agent/contracts`, so the event payload contract lives in one place instead of being duplicated locally.
- `pnpm --filter @relay-agent/contracts build` passed after the contract cleanup.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passed with the static desktop bundle output.

Phase 6 T19 Cargo dependency cleanup:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
```

Observed result:

- `apps/desktop/src-tauri/Cargo.toml` no longer declares `quick-xml` as a direct dependency. The current Rust code paths use `reqwest`, `shell-words`, `trash`, `csv`, `regex`, `zip`, and `calamine` directly (PDF text uses Node + LiteParse, not `lopdf`), but there is no in-repo `quick_xml::...` usage left after the relay-flow cleanup.
- `Cargo.lock` was refreshed accordingly, so `quick-xml` remains only as a transitive dependency from other crates, not as a direct dependency of `relay-agent-desktop`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed after removing the direct dependency.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed, confirming the Rust test targets still compile after the dependency prune.

Phase 6 T20 final verification run:

```bash
pnpm check
pnpm startup:test
pnpm launch:test
pnpm workflow:test
pnpm --filter @relay-agent/desktop agent-loop:test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
find apps/desktop/src-tauri/src -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
wc -c apps/desktop/src/lib/copilot-agent.ts apps/desktop/src/lib/copilot-turn.ts apps/desktop/src/lib/agent-ui.ts
rg -n '\buiMode\b|GuidedStage|manual mode|manual workflow|generateRelayPacket|submitCopilotResponse' apps/desktop/src -g'*.ts' -g'*.svelte'
```

Observed result:

- `pnpm check` passed.
- `pnpm startup:test` passed. The startup smoke binary reported `ready`, `retry-recovery`, and `attention` scenarios, and the targeted Rust startup tests passed.
- `pnpm launch:test` passed. The `tauri-dev-launch` smoke detected both the frontend and desktop binary and survived the stability window.
- `pnpm workflow:test` passed after updating the smoke harness to stop expecting the removed `generate-packet` step. The workflow smoke completed with output verification and source immutability intact.
- `pnpm --filter @relay-agent/desktop agent-loop:test` passed. The smoke observed approval + completion events and verified the filtered save-copy output while preserving the source file.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed with 127 Rust tests after updating remaining fixture/inspection expectations to the structured-response flow.
- The manual-mode removal check returned no matches for `uiMode`, `GuidedStage`, `generateRelayPacket`, or `submitCopilotResponse` in `apps/desktop/src`, which confirms the old guided/manual UI path is no longer present in the current frontend sources.

Acceptance snapshot:

- Criterion 3 passed: the full Rust test suite and smoke runs still cover the claw builtins path, including registry execution coverage in `state::tests` and the launched agent-loop smoke.
- Criterion 4 passed: Relay-specific tools remain exercised through `relay_tools::tests`, `workflow:test`, and `agent-loop:test`.
- Criterion 5 passed: the launched app agent-loop smoke completed end to end through Copilot-style structured responses, approval, and save-copy output.
- Criterion 6 passed: approval gating was observed in the launched agent-loop smoke and the Rust bridge tests.
- Criterion 7 passed: batch / pipeline / template Rust tests continued to pass inside the full `cargo test` run.
- Criterion 8 passed: the old manual/guided UI mode is absent from the current frontend source.
- Criterion 1 failed: authored Rust source under `apps/desktop/src-tauri/src` currently totals `853556` bytes (`833.6 KiB`), which is far above the PRD target of `80 KiB`.
- Criterion 2 failed: TypeScript agent-loop code still exists. `apps/desktop/src/lib/copilot-agent.ts`, `apps/desktop/src/lib/copilot-turn.ts`, and `apps/desktop/src/lib/agent-ui.ts` total `33148` bytes, so the PRD target of `0` is not yet met.

Task status note:

- `T20` remains pending after this verification run because the size/migration acceptance criteria are still unmet even though the automated functional checks now pass.

Implementation direction update:

- We are no longer preserving compatibility with earlier internal relay/packet/manual-era flows. This app has not been distributed yet, so dead transition paths should be deleted rather than maintained.
- The intended architecture is now explicit again: claw-code owns the agent behavior and session/runtime flow, openwork remains the UI/UX reference, and custom Relay code should be limited to M365 Copilot interop plus workbook-specific tools that claw-code does not provide.
- The next reduction target is the remaining TypeScript agent-loop path (`copilot-agent.ts`, `copilot-turn.ts`, and the `runAgentLoop` / `resumeAgentLoopWithPlan` branches in `+page.svelte`). That path still represents custom Copilot orchestration outside the Rust claw bridge and blocks the PRD migration criteria.

TS loop settings reduction:

```bash
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
```

Observed result:

- [continuity.ts](/workspace/relay-agent-main/apps/desktop/src/lib/continuity.ts) no longer persists the TypeScript loop-era browser automation flags (`agentLoopEnabled`, `loopTimeoutMs`, `planningEnabled`, `autoApproveReadSteps`, `pauseBetweenSteps`). The stored settings surface is now limited to the values still used by the Rust bridge path: `cdpPort`, `autoLaunchEdge`, `timeoutMs`, and `maxTurns`.
- [SettingsModal.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/SettingsModal.svelte) no longer renders the old agent-loop toggle card or its related per-step planning controls. The settings UI now exposes only the Copilot browser connection controls and `maxTurns`, which maps directly to `start_agent`.
- [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) now loads and saves only the reduced browser automation settings surface when wiring the active desktop-agent flow.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passed.

TS agent-loop removal:

```bash
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
rg -n "copilot-agent|copilot-turn|runAgentLoop|resumeAgentLoopWithPlan|requestCopilotTurn" apps/desktop/src
```

Observed result:

- [copilot-agent.ts](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-agent.ts) and [copilot-turn.ts](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-turn.ts) were deleted, along with [copilot-turn.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-turn.test.ts).
- [index.ts](/workspace/relay-agent-main/apps/desktop/src/lib/index.ts) no longer re-exports the deleted TS loop modules.
- [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) no longer imports or calls `runAgentLoop()` / `resumeAgentLoopWithPlan()`, and the unreachable planning / retry / staged setup branches that depended on those functions were removed.
- The source-tree grep returned no matches for `copilot-agent`, `copilot-turn`, `runAgentLoop`, `resumeAgentLoopWithPlan`, or `requestCopilotTurn` under `apps/desktop/src`.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passed.

Delegation draft/store cleanup:

```bash
pnpm --filter @relay-agent/desktop typecheck
pnpm -C apps/desktop exec tsx --test src/lib/stores/delegation.test.ts
pnpm --filter @relay-agent/desktop build
```

Observed result:

- [delegation.ts](/workspace/relay-agent-main/apps/desktop/src/lib/stores/delegation.ts) no longer keeps the plan-era fields `plan` and `currentStepIndex`, and its state machine no longer includes `plan_review`. The remaining store states align with the current desktop-agent path: `idle`, `goal_entered`, `planning`, `executing`, `awaiting_approval`, `completed`, and `error`.
- [continuity.ts](/workspace/relay-agent-main/apps/desktop/src/lib/continuity.ts) no longer persists or normalizes the legacy delegation draft fields `planSnapshot`, `conversationHistorySnapshot`, and `currentStepIndex`. The delegation draft shape is now limited to `goal`, `attachedFiles`, `activityFeedSnapshot`, `delegationState`, and `lastUpdatedAt`.
- [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) now saves and hydrates only that reduced delegation draft shape.
- [delegation.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/stores/delegation.test.ts) was updated to cover the reduced store lifecycle instead of the removed plan-review/step-index path.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm -C apps/desktop exec tsx --test src/lib/stores/delegation.test.ts` passed with 6 tests.
- `pnpm --filter @relay-agent/desktop build` passed.

Plan-era prompt and IPC cleanup:

```bash
pnpm --filter @relay-agent/desktop typecheck
pnpm -C apps/desktop exec tsx --test src/lib/prompt-templates.test.ts
pnpm --filter @relay-agent/desktop build
rg -n "buildPlanningPrompt|buildPlanningPromptV2|buildFollowUpPromptV2|buildLoopContinuationPrompt|buildStepExecutionPrompt|approvePlan\\(|getPlanProgress\\(|recordPlanProgress\\(" apps/desktop/src
```

Observed result:

- [prompt-templates.ts](/workspace/relay-agent-main/apps/desktop/src/lib/prompt-templates.ts) was reduced to the only remaining runtime helper, `buildProjectContext()`. The plan-era prompt builders and continuation helpers were removed.
- [prompt-templates.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/prompt-templates.test.ts) now covers only `buildProjectContext()` instead of the removed planning/continuation prompt functions.
- [ipc.ts](/workspace/relay-agent-main/apps/desktop/src/lib/ipc.ts) no longer exports the unused frontend wrappers `approvePlan()`, `getPlanProgress()`, or `recordPlanProgress()`, and the related request/response schema imports were removed.
- The grep returned no matches for the removed plan-era prompt helpers or frontend plan-progress IPC wrappers under `apps/desktop/src`.
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm -C apps/desktop exec tsx --test src/lib/prompt-templates.test.ts` passed with 1 test.
- `pnpm --filter @relay-agent/desktop build` passed.

Frontend bridge reduction:

```bash
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
rg -n "agent-ui|feedStore|approvalStore|sessionStore|bindAgentUi|disposeAgentUi|getActiveSessionState|startDesktopAgent|respondDesktopAgentApproval|cancelDesktopAgent|refreshDesktopAgentSessionHistory|resetAgentUi" apps/desktop/src
```

Observed result:

- [agent-ui.ts](/workspace/relay-agent-main/apps/desktop/src/lib/agent-ui.ts) and [agent-ui.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/agent-ui.test.ts) were deleted. The dedicated frontend controller/store layer around `start_agent`, `respond_approval`, `cancel_agent`, and `get_session_history` is no longer present.
- [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) now binds the `agent:*` Tauri events directly, keeps the session/approval/feed state locally, and invokes the Rust commands directly. This leaves the page on the minimal UI-only side of the bridge instead of routing through a second custom TypeScript orchestration layer.
- [index.ts](/workspace/relay-agent-main/apps/desktop/src/lib/index.ts) no longer re-exports `agent-ui`.
- The grep returned no matches for the removed `agent-ui` exports/imports or the old wrapper names under `apps/desktop/src`.
- Deleted dedicated frontend bridge/test bytes: `16682` (`agent-ui.ts` `12910` + `agent-ui.test.ts` `3556` + `index.ts` export shrink).
- `pnpm --filter @relay-agent/desktop typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
- `pnpm --filter @relay-agent/desktop build` passed.

Workbook context removal slice:

```bash
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
rg -n "preflight_workbook|inspect_workbook|PreflightWorkbookResponse|InspectWorkbookResponse|preflightWorkbook\\(|inspectWorkbook\\(" apps/desktop/src apps/desktop/src-tauri/src packages/contracts/src -g '!**/*test*'
```

Observed result:

- `PLANS.md` now explicitly treats the in-repo workbook engine, workbook-context inspection, and workbook-shaped prompt construction as removal targets. The intended direction is upstream `claw-code` / `claw-code-parity` for behavior, `openwork` for UI direction, and custom Relay code limited to M365 Copilot interop.
- [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts) and [apps/desktop/src/lib/ipc.ts](/workspace/relay-agent-main/apps/desktop/src/lib/ipc.ts) no longer expose the custom `preflight_workbook` / `inspect_workbook` surface.
- [app.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/app.rs) and [lib.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/lib.rs) no longer register or implement those two Tauri commands, and [preflight.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook/preflight.rs) was deleted.
- [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) no longer fetches workbook metadata to shape the Copilot prompt. The prompt now stays generic: goal, attached file paths, enabled tool list, and the minimal response schema. This removes the custom workbook-introspection dependency from the M365 handoff path.
- File pickers in [TaskInput.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/TaskInput.svelte), [InboxPanel.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/InboxPanel.svelte), [ChatComposer.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/ChatComposer.svelte), and [BatchTargetSelector.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/BatchTargetSelector.svelte) no longer advertise workbook-specific extension filters.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped from `853556` bytes to `822292` bytes after removing the preflight module and related bridge surface.
- The remaining internal `inspect_workbook` references are confined to the still-unreduced custom workbook runtime (`storage.rs`, `read_action_executor.rs`, `relay_tools.rs`, `workbook/inspect.rs`, `workbook/engine.rs`). No public frontend or public IPC path still calls `inspect_workbook` / `preflight_workbook`.
- `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm --filter @relay-agent/desktop build`, and `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed.

Workbook read-runtime removal slice:

```bash
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
rg -n "workbook\\.inspect|sheet\\.preview|sheet\\.profile_columns|session\\.diff_from_base|TurnArtifactRecord::WorkbookProfile|TurnArtifactRecord::SheetPreview|TurnArtifactRecord::ColumnProfile|session_diff_from_base|read_diff_summary_artifact" apps/desktop/src-tauri/src apps/desktop/src packages/contracts/src
```

Observed result:

- [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs), [relay_tools.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/relay_tools.rs), [read_action_executor.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/read_action_executor.rs), and [workbook/inspect.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook/inspect.rs) no longer implement or reference the custom read-side workbook tools `workbook.inspect`, `sheet.preview`, `sheet.profile_columns`, or `session.diff_from_base`.
- [tool_catalog.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tool_catalog.rs), [risk_evaluator.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/risk_evaluator.rs), [agent_loop_smoke.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/agent_loop_smoke.rs), [integration_tests.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/integration_tests.rs), and the storage tests were aligned to the current file/table/save-copy flow instead of the removed workbook inspect flow.
- [packages/contracts/src/workbook.ts](/workspace/relay-agent-main/packages/contracts/src/workbook.ts) and [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts) dropped the dead workbook profile / sheet preview / column profile schemas and the related read-action contract surface.
- [models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs) no longer carries the dead `WorkbookSheet` / `WorkbookProfile` inspection payload structs, and [workbook/preview.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook/preview.rs) no longer contains no-op handling for the removed read-side workbook tools.
- The grep returned no matches for the removed read-side workbook tools or their deleted artifact variants under `apps/desktop/src-tauri/src`, `apps/desktop/src`, or `packages/contracts/src`.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped further from `822292` bytes to `767973` bytes after this slice.
- `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.
- Remaining warnings are limited to the pre-existing dead-code warning on `read_latest_turn_model()` in [session_store.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/session_store.rs) and [storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs).

Unused packet / handoff surface removal:

```bash
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
rg -n "AssessCopilotHandoff|CopilotHandoff|PlanningContext|packetInspectionPayloadSchema|packetInspectionSectionSchema|PacketInspectionPayload|relay-packet|turn_details\\.packet|turnInspectionDetails\\.packet|SettingsPage|agentLoopEnabled|loopTimeoutMs|planningEnabled|autoApproveReadSteps|pauseBetweenSteps|agentLoopAbortController|handoffCaution|PacketReady|AwaitingResponse" apps/desktop/src-tauri/src apps/desktop/src packages/contracts/src
```

Observed result:

- [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts), [apps/desktop/src/lib/ipc.ts](/workspace/relay-agent-main/apps/desktop/src/lib/ipc.ts), [apps/desktop/src-tauri/src/execution.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/execution.rs), [apps/desktop/src-tauri/src/lib.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/lib.rs), [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs), and [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) no longer expose or implement the unused `assess_copilot_handoff` IPC surface or its `PlanningContext` / handoff reason payload types.
- Legacy packet-inspection support was removed from [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts), [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs), and [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs). Turn inspection now reports only validation, preview, approval, and execution sections.
- The dead packet-era turn statuses `PacketReady` and `AwaitingResponse` were removed from [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs), and the storage-side stage labels/tests were updated away from packet-era wording.
- [apps/desktop/src/routes/+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) no longer keeps unused `sampleWorkbookPath` assignment, `handoffCaution`, or the dead loop/planning state fields `agentLoopEnabled`, `loopTimeoutMs`, `planningEnabled`, `autoApproveReadSteps`, `pauseBetweenSteps`, and `agentLoopAbortController`.
- [apps/desktop/src/lib/components/SettingsPage.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/SettingsPage.svelte) was deleted because it was no longer imported anywhere after the SettingsModal-based flow replaced it.
- [apps/desktop/src-tauri/src/session_store.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/session_store.rs), [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs), and [apps/desktop/src-tauri/src/tool_catalog.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tool_catalog.rs) were trimmed to remove the last dead helper/warning paths introduced by earlier cleanup.
- The grep returned no matches for the removed handoff surface, packet-inspection surface, deleted loop/planning state variables, or packet-era status names under `apps/desktop/src-tauri/src`, `apps/desktop/src`, or `packages/contracts/src`.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped from `767973` bytes to `750834` bytes after this slice.
- `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.

Plan-progress surface removal:

```bash
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
rg -n "approve_plan|get_plan_progress|record_plan_progress|ApprovePlanRequest|ApprovePlanResponse|PlanProgressRequest|PlanProgressResponse|RecordPlanProgressRequest|plan-progress|execution-plan-approved|ExecutionPlanArtifactPayload|PlanProgressArtifactPayload|StoredPlanProgress|PlanStepStatus|PlanStepState" apps/desktop/src-tauri/src apps/desktop/src packages/contracts/src
```

Observed result:

- [apps/desktop/src-tauri/src/execution.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/execution.rs), [apps/desktop/src-tauri/src/lib.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/lib.rs), [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts), and [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs) no longer expose the unused `approve_plan`, `get_plan_progress`, or `record_plan_progress` command surface or their request/response payload types.
- [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) no longer keeps `plan_progress` in-memory state, the `approve_plan()` / `get_plan_progress()` / `record_plan_progress()` methods, or the `execution-plan` / `plan-progress` artifact payload helpers that existed only for that unused API family.
- [apps/desktop/src-tauri/src/workbook_state.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook_state.rs) no longer carries `StoredPlanProgress`, because preview/approval/execution are the only remaining live turn-side runtime caches.
- The grep returned no matches for the removed plan-progress command surface, payload types, or artifact helper names under `apps/desktop/src-tauri/src`, `apps/desktop/src`, or `packages/contracts/src`.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped from `750834` bytes to `740077` bytes after this slice.
- `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.

Storage runtime split:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
wc -c apps/desktop/src-tauri/src/storage.rs apps/desktop/src-tauri/src/storage_runtime.rs
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
```

Observed result:

- [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) now keeps session/persistence/inspection responsibilities, while preview generation, approval recording, execution, and output-artifact helpers moved into the new child module [apps/desktop/src-tauri/src/storage_runtime.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage_runtime.rs).
- The split uses `#[path = "storage_runtime.rs"] mod runtime;` inside `storage.rs`, so the extracted runtime code can keep using private storage helpers and state without widening visibility across the crate.
- [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) dropped to `239581` bytes, and the extracted runtime module is `56687` bytes.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped from `740077` bytes to `739732` bytes after this slice. The total barely moved because this change was primarily a responsibility split to make the next removals safer, not a behavior cut.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml`, `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.

T20 acceptance revision and reassessment:

```bash
rg -n "80KB|80 KiB|Relay 固有ツール|TypeScript のエージェントループコードが 0|成功基準" .taskmaster/docs/prd.txt PLANS.md .taskmaster/tasks/tasks.json
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
find apps/desktop/src-tauri/src/workbook -type f -name '*.rs' -print0 | xargs -0 wc -c
wc -c apps/desktop/src-tauri/src/copilot_provider.rs apps/desktop/src-tauri/src/tauri_bridge.rs apps/desktop/src-tauri/src/storage.rs apps/desktop/src-tauri/src/storage_runtime.rs apps/desktop/src/routes/+page.svelte
rg -n "start_agent|respond_approval|cancel_agent|get_session_history|listen\\(|agent:" apps/desktop/src/routes/+page.svelte apps/desktop/src/lib/ipc.ts apps/desktop/src/lib/continuity.ts
rg -n "WorkbookEngine|relay_tools|read_action_executor|workbook\\.save_copy|table\\.|document\\.read_text" apps/desktop/src-tauri/src apps/desktop/src/routes/+page.svelte
```

Observed result:

- The PRD, `PLANS.md`, and Task Master now use an architectural reduction gate for `T20` instead of the old raw `80 KiB` hard fail. The new gate is: no TypeScript agent-loop/orchestration, no in-repo workbook or relay-tool runtime, and remaining custom Rust limited to M365 Copilot interop plus thin desktop glue.
- `T20` in [.taskmaster/tasks/tasks.json](/workspace/relay-agent-main/.taskmaster/tasks/tasks.json) was updated to match that new acceptance definition, while keeping byte counts as telemetry to be recorded during final verification.
- The frontend part of the revised gate is now materially closer to complete: the current route only invokes `start_agent`, `respond_approval`, `cancel_agent`, and `get_session_history`, and listens to `agent:*` events from the Rust bridge. The earlier dedicated TypeScript loop modules are already gone.
- The backend part still fails the revised gate today. Custom workbook / relay runtime is still present in [apps/desktop/src-tauri/src/workbook/preview.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook/preview.rs), [apps/desktop/src-tauri/src/workbook/engine.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workbook/engine.rs), [apps/desktop/src-tauri/src/relay_tools.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/relay_tools.rs), [apps/desktop/src-tauri/src/read_action_executor.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/read_action_executor.rs), and the validation / tool-catalog surface in [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) plus [apps/desktop/src-tauri/src/storage_runtime.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage_runtime.rs).
- Current telemetry after the criterion revision is: authored Rust under `apps/desktop/src-tauri/src` = `739732` bytes; `workbook/` alone = `73831` bytes; [apps/desktop/src-tauri/src/copilot_provider.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/copilot_provider.rs) = `23898` bytes; [apps/desktop/src-tauri/src/tauri_bridge.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tauri_bridge.rs) = `41978` bytes; [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) = `239581` bytes; [apps/desktop/src-tauri/src/storage_runtime.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage_runtime.rs) = `56687` bytes; [+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) = `110926` bytes.
- Based on that reassessment, `T20` remains `pending`. The acceptance gate is now better aligned with the intended architecture, but the codebase still carries the disallowed workbook / relay runtime that the revised gate explicitly forbids.

Workbook/runtime removal follow-up:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @relay-agent/contracts build
pnpm --filter @relay-agent/desktop typecheck
pnpm --filter @relay-agent/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
rg -n "workbook\\.save_copy|table\\.(rename_columns|cast_columns|filter_rows|derive_column|group_aggregate)|document\\.read_text|run_execution_multi|RunExecutionMultiRequest|OutputSpec|OutputFormat" apps/desktop/src-tauri/src apps/desktop/src packages/contracts/src
```

Observed result:

- [apps/desktop/src-tauri/src/lib.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/lib.rs), [apps/desktop/src-tauri/src/execution.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/execution.rs), [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs), [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs), [apps/desktop/src/lib/ipc.ts](/workspace/relay-agent-main/apps/desktop/src/lib/ipc.ts), [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts), and [packages/contracts/src/relay.ts](/workspace/relay-agent-main/packages/contracts/src/relay.ts) no longer expose `run_execution_multi`, `OutputSpec`, or `OutputFormat`. Multi-output was a leftover workbook-era surface and is now gone.
- [packages/contracts/src/workbook.ts](/workspace/relay-agent-main/packages/contracts/src/workbook.ts) was reduced to diff/preview display types only. Workbook action schemas were removed, and [packages/contracts/src/file.ts](/workspace/relay-agent-main/packages/contracts/src/file.ts) no longer includes `document.read_text`.
- [apps/desktop/src-tauri/src/file_support.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/file_support.rs) no longer contains the document extraction path (`docx`/`pptx`/`pdf`) for `document.read_text`.
- [apps/desktop/src-tauri/src/risk_evaluator.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/risk_evaluator.rs), [apps/desktop/src-tauri/src/workflow_smoke.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/workflow_smoke.rs), [apps/desktop/src-tauri/src/agent_loop_smoke.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/agent_loop_smoke.rs), [apps/desktop/src-tauri/src/tauri_bridge.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tauri_bridge.rs), [apps/desktop/src-tauri/src/template.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/template.rs), [apps/desktop/src-tauri/assets/templates/sales_filter.json](/workspace/relay-agent-main/apps/desktop/src-tauri/assets/templates/sales_filter.json), [apps/desktop/src-tauri/assets/templates/monthly_rollup.json](/workspace/relay-agent-main/apps/desktop/src-tauri/assets/templates/monthly_rollup.json), [apps/desktop/src-tauri/assets/templates/normalize_columns.json](/workspace/relay-agent-main/apps/desktop/src-tauri/assets/templates/normalize_columns.json), [apps/desktop/src-tauri/assets/templates/remove_duplicates.json](/workspace/relay-agent-main/apps/desktop/src-tauri/assets/templates/remove_duplicates.json), and [apps/desktop/src-tauri/assets/templates/invoice_cleanup.json](/workspace/relay-agent-main/apps/desktop/src-tauri/assets/templates/invoice_cleanup.json) were updated so tests, smoke flows, and template metadata no longer advertise workbook/table tools that were removed from the runtime.
- [apps/desktop/src-tauri/src/storage.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/storage.rs) test coverage was rewritten around file-copy/text-replace flows, and workbook-era tests were deleted. The remaining storage-side memory-learning coverage now asserts only file-based preferences.
- [apps/desktop/src/lib/auto-fix.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/auto-fix.test.ts), [apps/desktop/src/lib/project-scope.test.ts](/workspace/relay-agent-main/apps/desktop/src/lib/project-scope.test.ts), and [apps/desktop/src/lib/components/ApprovalCard.svelte](/workspace/relay-agent-main/apps/desktop/src/lib/components/ApprovalCard.svelte) were aligned with the reduced tool set so frontend examples and labels no longer mention workbook/table tools.
- The grep returned no matches for workbook/table tool names, `document.read_text`, or `run_execution_multi` under `apps/desktop/src-tauri/src`, `apps/desktop/src`, or `packages/contracts/src`.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped again from `739732` bytes to `530980` bytes after this slice.
- `pnpm --filter @relay-agent/contracts build`, `pnpm --filter @relay-agent/desktop typecheck`, `pnpm --filter @relay-agent/desktop build`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.
- `T20` still remains `pending`. The workbook/relay runtime removal moved substantially closer to the revised gate, but custom file-support/read-side helpers and other thin desktop glue are still present, so the “custom Rust limited to M365 Copilot interop + minimal desktop glue” end-state has not been reached yet.

Read-side helper cleanup:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
find apps/desktop/src-tauri/src -type f -name '*.rs' -print0 | xargs -0 wc -c | tail -n 1
```

Observed result:

- [apps/desktop/src-tauri/src/file_support.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/file_support.rs) no longer contains the unused read-side helpers `execute_file_list`, `execute_file_read_text`, `execute_file_stat`, or `execute_text_search`, nor the directory listing / byte truncation helpers that existed only to support them.
- [apps/desktop/src-tauri/src/models.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/models.rs) no longer defines the unused Rust-side `ToolDescriptor`.
- [apps/desktop/src-tauri/src/tool_catalog.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/tool_catalog.rs) no longer exposes the test-only `get()` / `list_descriptors_by_phase()` helpers; tests now assert through `list()` instead.
- [apps/desktop/src-tauri/src/integration_tests.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/integration_tests.rs) dropped the read-side `text.search` helper coverage and now only keeps file mutation / project / MCP coverage that still exists in the current runtime.
- Authored Rust source under `apps/desktop/src-tauri/src` dropped from `530980` bytes to `522347` bytes after this slice.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run` passed.
