# Project-scoped slash commands and prompt templates (design)

**Status:** design only — OpenCode-style `/command` and reusable prompts, aligned with Relay’s Solid composer and `slash-commands.ts`.

## Goals

- Let a **workspace** ship **named slash commands** and **prompt templates** next to Claw config (`.claw/`, `CLAW.md`) without rebuilding the app.
- Keep **trust boundaries** clear: only the user’s chosen workspace path is read; no arbitrary URL loading.

## Option A — Tauri IPC read at startup / on demand (recommended first step)

1. **Discovery:** When the user sets `cwd` or starts a session, the Rust host (or a dedicated `load_workspace_prompt_assets` command) reads:
   - `.relay/commands/*.md` or `.relay/commands.json` — body = expanded text after `/name `.
   - `.relay/templates/*.md` — frontmatter `title:` + body, merged into the composer Templates list.
2. **IPC:** New invoke e.g. `list_workspace_slash_commands` / `list_workspace_templates` taking `cwd`; returns `{ name, description?, body }[]`.
3. **UI:** Composer merges **built-in** slash commands with **workspace** entries (workspace wins on name conflict, or prefix `ws/`).
4. **Pros:** Works in packaged Tauri; respects OS file permissions; easy to cap file size (e.g. 64 KiB per file).
5. **Cons:** Small IPC surface to maintain; must handle missing `cwd`.

## Option B — Vite-only / dev server `import.meta.glob` (not sufficient alone)

- Vite can bundle `../../workspace/.relay/**` only if paths are inside the project and known at build time — **fails** for arbitrary user workspace folders.
- Use only as a **dev convenience** for the repo’s own `.relay/` samples, not as the main product path.

## Option C — Watch + cache (later)

- Use `notify` in Rust to reload when `.relay/` changes; debounce and re-emit a frontend event `workspace:prompt_assets_changed`.
- Defer until Option A proves useful.

## Security notes

- Normalize paths under `cwd`; reject `..` traversal.
- Limit count and bytes of files read per request.
- Treat file content as **untrusted prompt text** (same as pasted user input); do not execute.

## Recommendation

Implement **Option A** first with a minimal schema:

```json
// .relay/commands.json (example)
[
  { "name": "changelog", "description": "Draft a changelog entry", "body": "Review git diff and propose…" }
]
```

Markdown-only alternative: `.relay/commands/changelog.md` where the file stem is the command name and the file body is the template.

**Verification (when implemented):** document commands in `docs/IMPLEMENTATION.md`; `pnpm typecheck` + `cargo test` for path sandbox tests.
