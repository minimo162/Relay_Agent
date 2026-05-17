# OpenCode-Compatible Tool Contract

Date: 2026-05-17

Relay exposes a small OpenCode-compatible local tool surface to M365 Copilot
through Microsoft Agent Framework. Relay implements the local function bodies,
workspace policy, approvals, backups, diagnostics, and packaging, but the
model-visible names and semantics should look like a familiar agent workspace
tool contract rather than a Relay-specific taxonomy.

## Inventory

### Canonical Workspace Tools

| Tool | Provider | Approval | Primary use | Result shape |
| --- | --- | --- | --- | --- |
| `glob` | ripgrep file listing | none | Find candidate files by path/name when the exact file is unknown. | `ToolObservation` with capped path list and truncation metadata. |
| `grep` | ripgrep content search | none | Search plaintext/code content. | `ToolObservation` with capped matching lines. |
| `read` | Relay file reader | none | Read an exact file. Office/PDF text extraction is handled by the reader when supported. | `ToolObservation` with bounded text or extracted document text. |
| `edit` | Relay exact replacement | required | Replace exact text in an existing workspace file. | `ToolObservation` with replacement count and backup path. |
| `write` | Relay file writer | required | Create or overwrite a workspace file with complete content. | `ToolObservation` with written path and optional backup path. |
| `apply_patch` | Relay structured patch engine | required | Apply a structured multi-file patch when patch context is known. | `ToolObservation` with changed files and backups. |
| `bash` | bounded process runner | required | Explicit verification/build/test/lint/typecheck/git/rg commands through structured argv. | `ToolObservation` with capped stdout/stderr and exit status summary. |

### Extension Tools

| Tool | Provider | Approval | Role |
| --- | --- | --- | --- |
| `officecli` | OfficeCLI semantic compiler | none unless the compiled operation mutates | Inspect Office files with Relay-owned semantic operations. |
| `officecli_mutate` | OfficeCLI semantic compiler | required | Mutate Office files after approval, backup, and post-operation verification. |
| `workspace_status` | Relay workspace inspector | none | Review workspace file count and git status before or after work. |
| `diff` | Relay git diff wrapper | none | Inspect changed workspace files before final answers. |
| `ask_user` | AG-UI client tool | client response | Ask only when a critical requirement is genuinely missing. |

### Compatibility Aliases

| Legacy name | Contract status |
| --- | --- |
| `patch` | Accepted only as an internal compatibility alias for `apply_patch`; it must not appear in the model-visible catalog or new prompts. |
| `rg_files` | Historical/publicly removed name. Do not expose it. Existing planning references map conceptually to `glob`. |
| `rg_search` | Historical/publicly removed name. Do not expose it. Existing planning references map conceptually to `grep`. |
| `run_command` | Removed public name. Use bounded `bash` only for explicit verification classes. |
| `office_search` | Removed public name. Use `glob` followed by exact `read` for Office/PDF discovery and evidence. |

## Canonical Tools

### `glob`

- Use when the exact file path is unknown.
- Parameters: `pattern` is required; optional path/filter fields may narrow the
  search root or include/exclude globs.
- Do not use for file content search.
- Failure means the pattern/root is invalid, ripgrep is unavailable, or the
  workspace cannot be searched.

### `grep`

- Use for plaintext/code content search.
- Parameters: `pattern` is required; optional `path`, `glob`, and filters may
  narrow scope.
- Do not use on Office/PDF binary containers; discover with `glob`, then
  inspect exact candidates with `read`.
- Relay passes a `--` separator before user/model patterns so pattern text
  cannot become ripgrep options.

### `read`

- Use when an exact file path is known or after `glob` selected candidates.
- Parameters: `file_path` is preferred; `path` is accepted as a compatibility
  argument.
- For `.pdf`, `.docx`, `.xlsx`, and `.pptx`, Relay returns extracted plaintext
  when supported instead of requiring a separate document-search tool.

### `edit`

- Use for exact replacement in an existing text/code file.
- Parameters: `file_path`, `old_string`, `new_string`, optional
  `replace_all`.
- Requires approval. Relay creates a backup before writing.
- Failure must be explicit when `old_string` is absent or ambiguous.

### `write`

- Use to create a new file or replace a whole file with complete content.
- Parameters: `file_path`, `content`.
- Requires approval. Relay backs up existing files before overwrite.
- For generated markup, Relay normalizes escaped HTML/XML content that Copilot
  may emit to avoid UI rendering damage.

### `apply_patch`

- Use for structured multi-file changes when context is known.
- Parameters: `patch` using Relay's `*** Begin Patch` / `*** End Patch`
  grammar.
- Requires approval. Relay validates all target paths inside the workspace and
  creates backups before destructive updates.
- Failure examples: invalid grammar, unsafe path, add target exists, delete or
  update target missing, patch context not found.

### `bash`

- Use only for explicit verification/build/test/lint/typecheck/git/rg classes.
- Parameters: `argv` as a string array; optional `cwd` inside the workspace and
  bounded `timeoutMs`.
- Do not use shell strings, `sh -lc`, heredocs, pipes, package installation,
  network mutation, or destructive git/file operations.

## OfficeCLI Extension

Office work follows the same inspect-before-mutate contract as file/code work:

1. inspect with `officecli` or exact `read`;
2. request approval for `officecli_mutate`;
3. execute the semantic OfficeCLI operation;
4. verify by reading/inspecting the changed file.

Copilot must not provide raw OfficeCLI argv. Relay compiles semantic operation
fields into argv locally so Office edits stay auditable and policy-controlled.

## Projection Rules

- The Agent Framework registry is the source of truth for model-visible tools.
- Copilot prompts must derive visible tools from the current admissible action
  envelope and registry, not from a separate static Relay prompt catalog.
- Prompt-visible tools use canonical names. `patch`, `rg_files`, and
  `rg_search` are not shown in new prompts.
- Contract violations fail visibly with diagnostics instead of introducing
  fallback planners or new Relay-only tool names.

## Agent Framework / AG-UI Parity Matrix

| Tool | Agent Framework mapping | Permission class | Approval behavior | AG-UI projection | Current Relay body |
| --- | --- | --- | --- | --- | --- |
| `glob` | Function tool | `glob: allow` | none | tool call/result events | ripgrep `--files` plus `-g` filters |
| `grep` | Function tool | `grep: allow` | none | tool call/result events | ripgrep content search with plaintext guard |
| `read` | Function tool | `read: allow` | none | tool call/result events | file reader plus Office/PDF text extraction |
| `edit` | Approval-required function tool | `edit: ask` | Agent Framework approval pause/resume | AG-UI human-in-the-loop approval then tool result | exact string replacement with backup |
| `write` | Approval-required function tool | `edit: ask` | Agent Framework approval pause/resume | AG-UI human-in-the-loop approval then tool result | complete file create/overwrite with backup |
| `apply_patch` | Approval-required function tool | `edit: ask` | Agent Framework approval pause/resume | AG-UI human-in-the-loop approval then tool result | structured patch parser/executor with backups |
| `bash` | Approval-required function tool | `bash: ask` | Agent Framework approval pause/resume | AG-UI human-in-the-loop approval then tool result | bounded argv runner for verification classes |
| `question` / `ask_user` | Client tool through AG-UI | `question: allow only when state-blocked` | user response required | AG-UI client tool | no local execution |
| `officecli` | Function tool | `read: allow` or Office read policy | none for read-only operations | tool call/result events | semantic OfficeCLI compiler |
| `officecli_mutate` | Approval-required function tool | `edit: ask` | Agent Framework approval pause/resume | AG-UI human-in-the-loop approval then tool result | semantic OfficeCLI compiler, backup, verify |

`ToolObservation` is the canonical result envelope for Relay local function
bodies. It includes `schemaVersion`, `toolCallId`, `tool`, `success`, `status`,
`summary`, `data`, `artifactIds`, `warnings`, `retryable`, and `dataHash`.
Large output must be capped or summarized, with exact files recoverable through
artifact IDs and later `read` calls.
