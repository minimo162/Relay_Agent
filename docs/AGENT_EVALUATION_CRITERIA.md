# Agent evaluation criteria (manual / regression)

Use this checklist when validating **Relay + model** behavior (e.g. M365 Copilot over CDP). It is **independent of any single user task** (sample scenario: “improve a local HTML file”).

## Grounding and honesty

- **No invented facts:** The assistant must not name bugs, identifiers, line-level errors, file paths, tool outcomes, or numbers that do **not** appear in tool results, user messages, or files the model has read. Applies to **code and any other domain**.
- **Explicit uncertainty:** If verification was not run, the assistant must say so (aligned with `# Doing tasks` in `runtime::claw_style_discipline_sections`).
- **Faithful tool narration:** Any “what we fixed” list must be checkable against **actual** `read_file` / diff / tool output—not generic templates.

## Tool protocol (Relay)

- When the user already gave a **concrete path** and action (read / improve / edit), the **first** substantive reply should include **`relay_tool`** (or accepted JSON fence) as required by the session bundle—not only prose.
- **No duplicate prose blocks** repeating the same “next steps” (per CDP session rules in the bundle).

## Failure examples (treat as regression signals)

- Listing fixes that reference symbols **absent** from the retrieved file (e.g. `x_size`, `bag.length0` when not in source).
- Claiming a file was written or a command succeeded **without** a successful tool result in the session log.
- Repeating the same assistant paragraph many times before emitting tools when the task already specified path and goal.

## Example: contradiction with Tool Result (not a host read failure)

Sometimes the model claims **fatal syntax errors** or **missing HTML structure** (e.g. “`<head>` / `<style>` / `<body>` undefined”, “`x_size` / `y_size` undefined”) while the **`read_file` Tool Result in the same session** already contains a complete `<!DOCTYPE html>`, `<head>`, `<style>`, `<body>`, and working script—**without** those identifiers.

In that situation:

- **Relay host `read_file`** (`crates/runtime/src/file_ops.rs`) returns UTF-8 bytes faithfully; it does not rewrite identifiers or strip tags. A successful tool result means the model **received** that text in context.
- The mismatch is therefore a **grounding / narration** failure (template-style “fix lists”), not evidence that **Relay failed to read the file**.

**Quick check:** Search the tool result `content` for identifiers the assistant cited. If they appear **only** in the assistant’s prose and **not** in `content`, flag the response as a regression.

### “Not reading the attachment” — two meanings

| | Meaning |
|---|--------|
| **A.** Input not delivered | The bundle or tool payload is dropped or corrupted **before** the model sees it. |
| **B.** Delivered but not used | The text is in context, but the model does not ground its explanation in it (attention, length, template pressure). |

When the session log still contains the full **`read_file` Tool Result** with `file.content`, treating the problem as **A (Relay host failed to read)** is usually **weak**: the host returns UTF-8 faithfully (`file_ops.rs`), and a successful JSON payload implies that string was produced for the session. **B** (grounding / weak attention on long bundles) fits typical failure modes better. Proving **A** on the Copilot side would require Microsoft-internal visibility (tokenization / compression), which this repo cannot provide.

**Practical triage:** If `<head>` appears in `content` but the assistant says it is missing, or if `x_size` appears only in prose, classify as **B**, not attachment read failure.

## Copilot thread vs Relay session (context continuity)

M365 Copilot in the browser **does not** automatically carry your **Relay workspace session** when you open a **new Copilot chat** or paste into a fresh thread: each Copilot thread has its own UI history, while Relay persists **session JSON** (messages, tool results) on the host. For **continuous** file/task context, prefer **multiple turns in the same Relay session** (same desktop session) so each CDP turn’s inline prompt bundle includes prior `read_file` / tool results. Starting a **new** Copilot-only chat each time makes “grounding” harder for the model because prior tool evidence is not in that thread unless Relay sends it again in the prompt.

**Implementation note:** The Node `copilot_server.js` path (HTTP `/v1/chat/completions`) now isolates **one Copilot tab/thread per Relay session**. Requests must carry `relay_session_id` and `relay_request_id`; the bridge reuses the same Copilot tab for later turns in that Relay session and forces **new chat only on first use / recovery** for that session. `relay_new_chat: true` and `RELAY_COPILOT_NEW_CHAT_EACH_TURN=1` still exist for explicit resets, but the default is no longer “one global current thread for every session”.

**Cancel:** Desktop `cancel_agent` triggers `POST /v1/chat/abort` with the active `relay_session_id` and `relay_request_id`, so only that in-flight Node wait loop exits with `relay_copilot_aborted` instead of blocking until the Copilot timeout.

## Implementation reference

- System prompt addition: `apps/desktop/src-tauri/crates/runtime/src/prompt.rs` — `get_simple_doing_tasks_section`, bullets on **grounded assertions**, **authoritative file text** (read_file / Tool Result / bundle as source of truth; traceable claims), and **partial reads** (state when only a slice was seen; use `offset`/`limit` before asserting unseen regions).
- CDP prompt assembly: `apps/desktop/src-tauri/src/agent_loop.rs` — `build_cdp_prompt` plus inline pre-send compaction. The grounding paragraph forbids generic “fatal syntax / missing HTML / drawBlock” checklists unless those issues appear in the prompt bundle; concrete claims must stay traceable to `read_file` content.
- Node CDP bridge: `apps/desktop/src-tauri/binaries/copilot_server.js` — production path. Requires `relay_session_id` / `relay_request_id`, keeps one Copilot tab/thread per Relay session, accepts optional `relay_new_chat`, and scopes `POST /v1/chat/abort` to the matching request id. Anonymous `/health` exposes only `status`, `service`, and `instanceId`; mutable endpoints require `X-Relay-Boot-Token`.
- CDP bundle prefix: `apps/desktop/src-tauri/src/agent_loop.rs` — `build_cdp_prompt` prepends `CDP_BUNDLE_GROUNDING_BLOCK` (identifiers must appear in Tool Result; quote or line numbers).

## Fixture (optional smoke)

- `tests/fixtures/tetris_canvas.html` — single-file Canvas Tetris (UTF-8, `←/→` in hints). Used for offline checks; not part of the default test suite.
- Quick syntax check (extract `<script>` body, then): `node --check <extracted.js>`
- **Identifier spot-check:** `rg 'x_size|y_size' tests/fixtures/tetris_canvas.html` — expect **no matches** (confirms the fixture does not contain symbols sometimes hallucinated as “fixes”).
- `tests/fixtures/tetris_grounding.html` — **smaller** Tetris sample for grounding checks: intentionally **does not** include common hallucinated typo tokens (`x_size`, `y_size`, `bag.length0`). Static check: `pnpm run test:grounding-fixture` (or `bash scripts/verify-grounding-fixture.sh`). Rust: `cargo test -p relay-agent-desktop --lib tetris_grounding_fixture` and `build_cdp_prompt_includes_grounding`.
- `tests/fixtures/tetris.html` — alternate minimal “テトリス” single-file sample for the **improve-this-source** grounding E2E (`07`); same forbidden-token rules and covered by `test:grounding-fixture`. Rust: `tetris_html_fixture_has_no_common_hallucination_tokens`.

### Manual check via app (Copilot)

1. Copy `tests/fixtures/tetris_grounding.html` into your Relay workspace (any path).
2. Build preset, goal such as: read that file and suggest minimal readability edits without inventing bugs.
3. After `read_file` appears in the session, inspect the assistant reply: any concrete bug name or identifier (e.g. `x_size`, `bag.length0`) must **appear in the Tool Result**—if it appears only in prose, treat as a grounding regression (same as **Quick check** above).

**Automated (Edge + CDP, opt-in):** Start **`node apps/desktop/src-tauri/binaries/copilot_server.js`** with **`--cdp-port`** matching Edge’s CDP port (same as `CDP_ENDPOINT`, e.g. `9333`). Default HTTP is `COPILOT_SERVER_URL=http://127.0.0.1:18080` — `GET /status` requires `X-Relay-Boot-Token` if the bridge was started with `--boot-token`, and Playwright helpers accept `COPILOT_SERVER_BOOT_TOKEN` for that header. `/health` no longer returns the boot token. With Edge running and signed in to M365 Copilot on `CDP_ENDPOINT` (Playwright default `http://127.0.0.1:9333`; Relay アプリ既定は 9360 — 必要なら `CDP_ENDPOINT` で指定), from `apps/desktop`: `RELAY_GROUNDING_E2E=1 pnpm run test:e2e:copilot-grounding` — Playwright **`06 — tetris_grounding`** and **`07 — tetris.html`** embed `tests/fixtures/tetris_grounding.html` and `tests/fixtures/tetris.html` via **`POST /v1/chat/completions`** (same entry as the desktop app) with `relay_new_chat: true` and per-request ids. **`07`** asks for **improvement suggestions** and asserts neither the HTTP `assistantText` nor the visible page text contains `x_size`, `y_size`, or `bag.length0` ( **`06`** checks the page tail). Flaky if Copilot mentions those tokens in unrelated prose. The describe block uses `test.setTimeout(360_000)` and 300s HTTP timeouts where needed. Paste, submit, and completion wait run inside **`copilot_server.js`** (not duplicated in Playwright).
