# Relay Agent Full Improvement Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all 31 issues across security, error handling, code quality, architecture, frontend, and lints.

**Architecture:** Tauri v2 desktop app with SolidJS frontend, Rust backend with workspace crates (api, runtime, tools, commands).

**Tech Stack:** Rust 2021, SolidJS, Tauri v2, TypeScript

---

## Phase 1: Critical Security Fixes (S1-S3)

### Task 1: Fix shell injection in CWD escaping

**Objective:** Replace unsafe shell escaping with proper approach using environment variables instead of string interpolation.

**Files:**
- Modify: `apps/desktop/src-tauri/crates/tools/src/lib.rs` — `TauriToolExecutor::execute_bash` method
- Modify: `apps/desktop/src-tauri/src/tauri_bridge.rs` — `build_tool_executor`

**Steps:**
1. In `tools/src/lib.rs`, find `TauriToolExecutor::execute_bash`. Instead of:
   ```rust
   let cmd = format!("cd '{}' && ( {} )", escaped_cwd, command);
   ```
   Pass cwd as an environment variable or use a dedicated working directory parameter if the shell command API supports it. If using tauri-plugin-shell, use `Command::new("bash").args(["-c", command]).current_dir(&cwd)`.
2. In `tauri_bridge.rs`, `build_tool_executor` should pass the cwd as a proper path, not string-interpolated into shell commands.
3. If the shell plugin doesn't support `current_dir`, use `shell-escape` crate or implement proper POSIX shell escaping covering: `'`, `"`, `\`, `$`, `` ` ``, `!`, `;`, `|`, `&`, `>`, `<`, `(`, `)`, `{`, `}`, `[`, `]`, `*`, `?`, `#`, `~`, `=`.

### Task 2: Sanitize session_id for filesystem use

**Objective:** Validate session_id before using as filename component.

**Files:**
- Modify: `apps/desktop/src-tauri/src/copilot_client.rs` — `save_session`, `load_session`

**Steps:**
1. Add a validation function:
   ```rust
   fn validate_session_id(id: &str) -> Result<(), String> {
       if !id.matches(|c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_').count() == id.len() {
           return Err(format!("invalid session_id format: {id}"));
       }
       if id.len() > 128 {
           return Err("session_id too long".into());
       }
       Ok(())
   }
   ```
2. Call this before any filesystem operation using session_id.

### Task 3: Replace std::thread with tokio task + concurrency limit

**Objective:** Use tokio::task::spawn_blocking instead of std::thread::spawn with a semaphore for concurrency control.

**Files:**
- Modify: `apps/desktop/src-tauri/src/tauri_bridge.rs` — `start_agent`

**Steps:**
1. Add a global semaphore: `static AGENT_SEMAPHORE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();`
2. In `start_agent`, instead of `std::thread::spawn`, use `tokio::task::spawn_blocking`.
3. Acquire semaphore permit before starting the agent loop.

---

## Phase 2: Critical Error Handling (E1-E4)

### Task 4: Replace all .lock().expect() with graceful error handling

**Objective:** Replace all 6+ `expect("registry poisoned")` calls with `map_err` to propagate errors gracefully.

**Files:**
- Modify: `apps/desktop/src-tauri/src/tauri_bridge.rs` — lines 95-96, 141, 148-149, 178, 219, 242

**Steps:**
1. Replace all `.lock().expect("...")` with `.lock().map_err(|e| format!("lock poisoned: {e}"))?` in functions returning Result.
2. For non-Result contexts, use `.lock().unwrap_or_else(|e| { eprintln!("poisoned: {e}"); /* recover */ })`.

### Task 5: Add catch_unwind to agent thread

**Objective:** Catch panics in the agent loop and emit proper error events.

**Files:**
- Modify: `apps/desktop/src-tauri/src/tauri_bridge.rs` — `start_agent` thread body (lines 103-130)

**Steps:**
1. Wrap the `run_agent_loop_impl` call in `std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ...))`.
2. On panic, emit `agent:error` event with `cancelled: false` and the panic message.
3. Always set `running = false` in cleanup, even on panic.

### Task 6: Fix dead ok variable in stream callback

**Objective:** Remove the unused `ok` variable or log the failure.

**Files:**
- Modify: `apps/desktop/src-tauri/src/tauri_bridge.rs` — lines 294-307

**Steps:**
1. Remove `let mut ok = false;` and `let _ = ok;`.
2. The emit error is already printed via `eprintln!`, which is sufficient.

---

## Phase 3: Code Quality (C1-C6)

### Task 7: Modularize models.rs

**Objective:** Split the 986-line models.rs into domain-specific modules and remove/feature-gate dead types.

**Files:**
- Create: `apps/desktop/src-tauri/src/models/session.rs`
- Create: `apps/desktop/src-tauri/src/models/events.rs`
- Create: `apps/desktop/src-tauri/src/models/requests.rs`
- Create: `apps/desktop/src-tauri/src/models/mod.rs`
- Delete/Replace: `apps/desktop/src-tauri/src/models.rs`

**Steps:**
1. Extract session-related types (StartAgentRequest, CancelAgentRequest, etc.) into `requests.rs`.
2. Extract event types (AgentErrorEvent, AgentTextDeltaEvent, etc.) into `events.rs`.
3. Extract session state types into `session.rs`.
4. Remove or `#[allow(dead_code)]` unused types: SpreadsheetAction, SheetDiff, RowDiffSample, DiffSummary, OperationRisk, ApprovalPolicy, Turn, Project, etc.
5. Create `mod.rs` with `pub use` re-exports.

### Task 8: Consolidate tool definitions into single source

**Objective:** Define tool schemas once in the tools crate, generate JSON for Copilot from single source.

**Files:**
- Modify: `apps/desktop/src-tauri/crates/tools/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/copilot_client.rs`

**Steps:**
1. Add a method to the tools crate that generates the tool definitions JSON from the `ToolSpec` list.
2. In `copilot_client.rs`, call this method instead of duplicating the schema.
3. Remove the hardcoded `tool_definitions_json` and `tool_definitions` from `copilot_client.rs`.

### Task 9: Add clippy deny lints and fix warnings incrementally

**Objective:** Enable strict clippy lints and fix the most impactful warnings.

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` — workspace lints section

**Steps:**
1. Add to workspace lints:
   ```toml
   [workspace.lints.rust]
   unsafe_code = "forbid"
   unused = "warn"
   dead_code = "warn"
   
   [workspace.lints.clippy]
   all = { level = "warn", priority = -1 }
   pedantic = { level = "warn", priority = -1 }
   ```
2. Add `#![warn(unused)]` to crate roots.

---

## Phase 4: Architecture (A1-A4)

### Task 10: Split tauri_bridge.rs into focused modules

**Objective:** Break the 972-line tauri_bridge.rs into focused modules.

**Files:**
- Create: `apps/desktop/src-tauri/src/registry.rs`
- Create: `apps/desktop/src-tauri/src/agent_loop.rs`
- Create: `apps/desktop/src-tauri/src/prompter.rs`
- Create: `apps/desktop/src-tauri/src/events.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Reduce: `apps/desktop/src-tauri/src/tauri_bridge.rs` → thin shim that re-exports

**Steps:**
1. Move `SessionRegistry`, `SessionEntry`, and related code to `registry.rs`.
2. Move `run_agent_loop_impl`, `build_tool_executor`, `build_system_prompt` to `agent_loop.rs`.
3. Move `TauriApprovalPrompter` to `prompter.rs`.
4. Move event constants and event structs to `events.rs`.
5. Keep only the `#[tauri::command]` functions in `tauri_bridge.rs` as a thin routing layer.
6. Update imports in `lib.rs`.

### Task 11: Extract config from magic numbers

**Objective:** Move hardcoded values (max_turns=16, preserve_recent_messages=2, max_tokens=32000) into a config struct.

**Files:**
- Create: `apps/desktop/src-tauri/src/config.rs`
- Modify: `apps/desktop/src-tauri/src/agent_loop.rs` (or `tauri_bridge.rs` after Task 10)

**Steps:**
1. Create `AgentConfig` struct with sensible defaults:
   ```rust
   #[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
   pub struct AgentConfig {
       pub max_turns: usize,
       pub compact_preserve_recent: usize,
       pub compact_max_tokens: usize,
   }
   impl Default for AgentConfig {
       fn default() -> Self {
           Self { max_turns: 16, compact_preserve_recent: 2, compact_max_tokens: 4000 }
       }
   }
   ```
2. Replace hardcoded values with config references.

### Task 12: Add session lifecycle management (cleanup completed sessions)

**Objective:** Implement TTL-based cleanup for completed/cancelled sessions to prevent memory leaks.

**Files:**
- Modify: `apps/desktop/src-tauri/src/registry.rs` (or `tauri_bridge.rs` before Task 10)

**Steps:**
1. Add a `completed_at: Option<chrono::DateTime<chrono::Utc>>` field to `SessionEntry`.
2. Set this timestamp when a session completes or is cancelled.
3. Add a `cleanup_stale_sessions(&mut self, ttl_seconds: u64)` method that removes entries older than TTL.
4. Call cleanup periodically or on `get_session_history`.

---

## Phase 5: Frontend (F1-F5)

### Task 13: Wire up sidebar search input

**Objective:** Make the "Search sessions..." input functional.

**Files:**
- Modify: `apps/desktop/src/root.tsx`

**Steps:**
1. Add a search signal: `const [searchQuery, setSearchQuery] = createSignal("");`
2. Wire the Input: `onInput={(e) => setSearchQuery(e.currentTarget.value)}`
3. Filter sessions: `const filteredSessions = createMemo(() => sessions.filter(s => s.id.includes(searchQuery())));`
4. Use `filteredSessions` in the sidebar rendering.

### Task 14: Remove eslint-disable and fix unused vars

**Objective:** Remove blanket `/* eslint-disable @typescript-eslint/no-unused-vars */` and fix violations.

**Files:**
- Modify: `apps/desktop/src/root.tsx`

**Steps:**
1. Remove the top-level eslint-disable comment.
2. Run `npm run lint` to find violations.
3. Prefix unused variables with `_` or remove them.

### Task 15: Fix error state persistence across session switches

**Objective:** Clear sessionError when switching sessions.

**Files:**
- Modify: `apps/desktop/src/root.tsx` — `selectSession` function

**Steps:**
1. In `selectSession`, add `setSessionError(null);` before loading the new session.

---

## Phase 6: Dead Code Cleanup (L1-L5)

### Task 16: Feature-gate or remove Node.js copilot bridge code

**Objective:** Clean up dead parsing functions for the Node.js copilot output path.

**Files:**
- Modify: `apps/desktop/src-tauri/src/copilot_client.rs`

**Steps:**
1. Either remove `parse_copilot_output`, `parse_copilot_to_events`, `extract_json`, `find_balanced_json_object`, `CopilotContent`, `CopilotResponse` (lines ~778-893) or feature-gate them.
2. If you're unsure whether they're used, wrap with `#[cfg(feature = "copilot-nodejs")]`.

### Task 17: Fix unused imports and types in root.tsx

**Objective:** Clean up TypeScript unused imports.

**Files:**
- Modify: `apps/desktop/src/root.tsx`

**Steps:**
1. Identify all unused imports (they were hidden by the eslint-disable).
2. Remove or prefix with `_`.

### Task 18: Standardize error types across crates

**Objective:** Use consistent error types instead of mixing String, anyhow::Error, RuntimeError.

**Files:**
- Modify: Multiple — across crate boundaries where `Result<_, String>` is used

**Steps:**
1. In crate boundaries, define specific error enums using `thiserror`.
2. For internal functions, use the crate's error type.
3. For Tauri commands (which return `Result<_, String>`), convert at the boundary.

---

## Execution Order

1. Task 1 (shell injection) — SECURITY
2. Task 2 (session_id validation) — SECURITY
3. Task 4 (mutex expect → map_err) — ERROR HANDLING
4. Task 5 (catch_unwind) — ERROR HANDLING
5. Task 6 (dead ok variable) — LOW HANGING FRUIT
6. Task 3 (tokio tasks) — SCALABILITY
7. Task 8 (tool definition consolidation) — DRY
8. Task 16 (dead code removal) — CLEANUP
9. Task 7 (modularize models) — CODE QUALITY
10. Task 10 (split tauri_bridge) — ARCHITECTURE
11. Task 11 (extract config) — CONFIG
12. Task 12 (session lifecycle) — LIFECYCLE
13. Task 13 (sidebar search) — FRONTEND
14. Task 15 (error state fix) — FRONTEND
15. Task 14 (eslint-disable removal) — FRONTEND LINTS
16. Task 9 (clippy lints) — LINTS
17. Task 17 (unused imports) — LINTS
18. Task 18 (error type standardization) — ERROR CONSISTENCY
