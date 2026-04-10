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

M365 Copilot in the browser **does not** automatically carry your **Relay workspace session** when you open a **new Copilot chat** or paste into a fresh thread: each Copilot thread has its own UI history, while Relay persists **session JSON** (messages, tool results) on the host. For **continuous** file/task context, prefer **multiple turns in the same Relay session** (same desktop session) so each CDP turn’s attached bundle includes prior `read_file` / tool results. Starting a **new** Copilot-only chat each time makes “grounding” harder for the model because prior tool evidence is not in that thread unless Relay sends it again in the bundle.

## Implementation reference

- System prompt addition: `apps/desktop/src-tauri/crates/runtime/src/prompt.rs` — `get_simple_doing_tasks_section`, bullets on **grounded assertions**, **authoritative file text** (read_file / Tool Result / bundle as source of truth; traceable claims), and **partial reads** (state when only a slice was seen; use `offset`/`limit` before asserting unseen regions).
- CDP composer hint (file-attach path): `apps/desktop/src-tauri/src/agent_loop.rs` — `CDP_FILE_DELIVERY_USER_MESSAGE`, **grounding** paragraph: forbid generic “fatal syntax / missing HTML / drawBlock” checklists unless those issues appear in the attached bundle; require traceability to `read_file` content.

## Fixture (optional smoke)

- `tests/fixtures/tetris_canvas.html` — single-file Canvas Tetris (UTF-8, `←/→` in hints). Used for offline checks; not part of the default test suite.
- Quick syntax check (extract `<script>` body, then): `node --check <extracted.js>`
- **Identifier spot-check:** `rg 'x_size|y_size' tests/fixtures/tetris_canvas.html` — expect **no matches** (confirms the fixture does not contain symbols sometimes hallucinated as “fixes”).
