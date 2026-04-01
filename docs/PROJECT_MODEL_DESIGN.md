# Project Model Design

## Purpose

Prompt 16 introduces a persistent "project" concept for the desktop app so related sessions can share:

- a named workspace boundary
- a root folder used as a file-access scope
- custom Copilot instructions that should always apply
- learned key/value memory that can be reused across sessions

The design goal is to keep project context lightweight and local-first while preserving the existing MVP safety model.

## Data Model

`Project` is stored as a first-class persisted object alongside sessions.

```ts
type ProjectMemorySource = "user" | "auto";

type ProjectMemoryEntry = {
  key: string;
  value: string;
  learnedAt: string;
  source: ProjectMemorySource;
};

type Project = {
  id: string;
  name: string;
  rootFolder: string;
  customInstructions: string;
  memory: ProjectMemoryEntry[];
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

Field intent:

- `id`: stable identifier used by IPC and persistence.
- `name`: user-visible label in the selector UI.
- `rootFolder`: absolute path that defines the project scope boundary.
- `customInstructions`: durable operating rules appended to Copilot prompts.
- `memory`: project-level learned settings such as output conventions or encoding choices.
- `sessionIds`: session IDs that were explicitly created under the project and linked for continuity.
- `createdAt` / `updatedAt`: local persistence metadata.

## Persistence Model

Projects are persisted separately from sessions in the desktop storage directory:

- `projects/index.json`: ordered metadata index for available projects
- `projects/<project-id>.json`: full project record

This mirrors the existing session persistence model and keeps project CRUD independent from turn artifacts.

## IPC Surface

The contracts and Tauri backend expose these operations:

- `create_project`
- `list_projects`
- `read_project`
- `update_project`
- `add_project_memory`
- `remove_project_memory`
- `link_session_to_project`

These are intentionally minimal CRUD-style commands. Prompt 16 does not add destructive project deletion or project/session migration flows.

## Prompt Injection Model

Project context is rendered into a plain-text prompt section before the active task instructions:

- custom instructions appear under a dedicated project heading
- memory entries are rendered as `key: value` pairs
- planning, follow-up, continuation, and step-execution prompts all reuse the same project-context builder

This keeps project behavior consistent across direct turns, autonomous planning, and resumed plan execution.

Accepted manual Copilot responses can also auto-learn a small set of durable preferences when the session is linked to a project:

- `preferred_output_folder`
- `preferred_output_format`
- `preferred_output_sheet`
- `create_backup_on_replace`
- `overwrite_existing_files`

These entries are stored as `source: "auto"` and remain user-visible in the project panel.

## UI Model

The desktop UI adds a `ProjectSelector` strip near the top of the main page.

Supported actions:

- select an existing project
- create a new project with `name`, `rootFolder`, and optional `customInstructions`
- inspect current instructions and learned memory
- add or remove memory entries
- see how many sessions are currently linked to the project
- browse linked sessions from the project panel
- attach an existing session to the selected project, even if it needs to be reassigned from another project
- detach a session from the selected project

The current selection is persisted in continuity storage as `selectedProjectId` so the app restores the same project across reloads.

When a new session is created while a project is selected, the frontend links that session into the project so `sessionIds` is used as a real continuity field rather than a placeholder.

## Scope Guard

When a project is active, file-oriented actions are checked against `rootFolder` before read execution or preview preparation.

Scope behavior after the approval UI follow-up:

- setup blocks if the chosen workbook is outside the selected project root
- pasted/manual Copilot responses pause before preview when they reference out-of-scope paths and require an explicit override approval
- autonomous loop turns pause and emit a scope approval event if Copilot proposes out-of-scope file access
- approved overrides continue into the existing preview/save approval flow instead of silently bypassing it
- approved overrides are persisted as dedicated turn artifacts and inspection records tied to the current response for auditability

The guard applies to common path-bearing args such as `path`, `sourcePath`, `destPath`, and `outputPath`.

## Safety Notes

- Projects do not relax the existing save-copy-only write model.
- Project memory is explicit key/value state, not arbitrary hidden prompt accumulation.
- Scope enforcement is a frontend guard for the current MVP path; it warns and blocks rather than silently rewriting model output.
- Original workbook safety constraints remain unchanged.

## Known Limits

- Project/session management is still intentionally embedded in the main workspace rather than split into a separate dedicated dashboard screen, but the project strip now supports search plus bulk attach/detach for the currently filtered sessions.
- Auto-learning is still heuristic, but it now combines structured action args with free-form `summary` / `message` / `warnings` / `followUpQuestions` text when inferring durable preferences.
- Scope override approvals now appear in both a current-turn approval history panel and a project-scoped cross-session report, but the reporting surface is still local and read-only rather than an exportable or shared audit report.
