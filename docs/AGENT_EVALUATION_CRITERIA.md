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

## Implementation reference

- System prompt addition: `apps/desktop/src-tauri/crates/runtime/src/prompt.rs` — `get_simple_doing_tasks_section`, bullet on **grounded assertions** (next to “Report outcomes faithfully…”).

## Fixture (optional smoke)

- `tests/fixtures/tetris_canvas.html` — single-file Canvas Tetris (UTF-8, `←/→` in hints). Used for offline checks; not part of the default test suite.
- Quick syntax check (extract `<script>` body, then): `node --check <extracted.js>`
