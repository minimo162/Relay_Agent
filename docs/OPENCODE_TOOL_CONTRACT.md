# OpenCode-Compatible Tool Contract

Relay does not embed or launch OpenCode. This document defines the low-level
local workspace tool contract Relay exposes inside Microsoft Agent Framework
tool descriptors. The goal is compatibility with the common OpenCode-style
agent vocabulary, not dependency on OpenCode implementation code.

## Layering

Relay tools are described in two layers:

1. **Agent Framework layer**: function/local MCP/client/provider-hosted tool
   type, capability family, provider key, mutation class, approval policy,
   output contract, and telemetry labels.
2. **Local workspace contract layer**: model-facing tool names and argument
   shapes for local file discovery, content search, exact read, text mutation,
   patch application, Office operations, and bounded verification commands.

## Tools

### `glob`

Purpose: discover files by name/path.

Arguments:

- `pattern` string, required. Glob pattern such as `**/*.cs` or
  `**/*売上*.xlsx`.
- `path` string, optional. Directory under the selected workspace to search.
- `limit` integer, optional. Relay clamps to a safe range.
- `timeoutMs` integer, optional. Relay clamps to a safe range.

Behavior:

- Returns files only, not directories.
- Uses Relay's ripgrep provider.
- Applies workspace containment before execution.
- Returns capped deterministic path candidates.

### `grep`

Purpose: search plaintext/code content.

Arguments:

- `pattern` string, required.
- `path` string, optional. Directory under the selected workspace to search.
- `glob` string, optional. Include filter.
- `case_insensitive` boolean, optional.
- `limit` integer, optional.
- `timeoutMs` integer, optional.

Behavior:

- Uses ripgrep with the pattern after `--`.
- Rejects Office/PDF container targets; use `glob` then exact `read`.
- Returns capped line matches.

### `read`

Purpose: read an exact file.

Arguments:

- `file_path` string, required.
- `offset` integer, optional.
- `limit` integer, optional.

Behavior:

- Requires an exact path under the selected workspace.
- Reads bounded plaintext/code.
- Extracts bounded text/metadata for supported `.docx`, `.xlsx`, `.xlsm`,
  `.pptx`, and text-layer `.pdf` files.

### `edit`

Purpose: exact string replacement.

Arguments:

- `file_path` string, required.
- `old_string` string, required.
- `new_string` string, required.
- `replace_all` boolean, optional.

Behavior:

- Requires approval.
- Creates a backup before writing.
- Fails if `old_string` is absent.
- Fails on multiple matches unless `replace_all` is true.

### `write`

Purpose: create or overwrite a text/code file.

Arguments:

- `file_path` string, required.
- `content` string, required.

Behavior:

- Requires approval.
- Creates parent directories as needed.
- Creates a backup when overwriting an existing file.

### `apply_patch`

Purpose: apply a structured multi-file patch.

Arguments:

- `patch` string, required. Patch text using the established begin/end patch
  grammar.

Behavior:

- Requires approval.
- Validates workspace containment for every changed path.
- Creates backups for touched existing files.
- Applies add/update/delete hunks and returns changed paths.

### Bounded command execution

Purpose: run build/test/lint/typecheck/git-inspection commands.

Arguments:

- `argv` string array, required.
- `cwd` string, optional.
- `timeoutMs` integer, optional.

Behavior:

- Uses OpenCode-compatible `bash` permission grouping, but does not expose raw
  unrestricted shell.
- Requires approval.
- Allows only bounded verification command families.
- Denies destructive, package-management, network mutation, and arbitrary shell
  behavior before execution.

## Error Classes

Relay should use stable, user-visible error classes:

- unknown tool;
- invalid arguments;
- path outside workspace;
- missing file;
- unsupported binary/container for `grep`;
- multiple edit matches;
- timeout/output cap;
- missing executable;
- denied or approval-required mutation;
- repeated-call guard;
- provider drift or unsupported capability.

## Relay Deviations

Relay intentionally differs from a plain OpenCode implementation in these
areas:

- M365 Copilot is the only controller model.
- Microsoft Agent Framework owns the run loop.
- Relay enforces workspace containment, approval, backups, audit logs,
  redaction, and support-bundle policy.
- Office/PDF extraction is available only through exact `read`.
- OfficeCLI is exposed through semantic operations, not raw argv.
- Raw unrestricted shell is not exposed in the default tool catalog.
