# MCP Reuse Decision

Date: 2026-05-17

Relay uses Microsoft Agent Framework as the tool host. Before adding any new
generic local function body, the implementation must check whether a local MCP
server can provide the same capability while preserving Relay's workspace
policy, approval behavior, audit logs, Windows/Linux packaging, and offline
usability.

## Decision Matrix

| Capability family | MCP decision | Reason |
| --- | --- | --- |
| Filesystem read/write/search | keep Relay function bodies for now | Relay needs strict workspace containment, backups, Office/PDF plaintext extraction on exact `read`, Windows share handling, and no-admin packaging. A generic filesystem MCP server would still need Relay policy wrappers. |
| `glob` / filename discovery | keep Relay function body | The current implementation uses bundled or PATH ripgrep with controlled arguments and truncation. This keeps search offline and auditable. |
| `grep` / plaintext search | keep Relay function body | Relay rejects Office/PDF container search and injects safe ripgrep separators. A generic MCP grep tool would need the same guard layer. |
| Git status / diff | keep Relay function body, revisit as MCP | `workspace_status` and `diff` are narrow, read-only, and already policy-contained. A future local git MCP server is reasonable if it preserves workspace boundaries and output caps. |
| SQLite / indexing | reject until product need returns | The active direction removed dedicated search/index products in favor of generic agent tools. Do not add sqlite/index MCP until a concrete agent workflow requires it. |
| Office operations | keep OfficeCLI function body | Office edits require semantic operation compilation, backup, verification, and bundled OfficeCLI readiness checks. A future Office MCP wrapper may expose the same semantics, but raw Office mutation MCP is not acceptable. |
| Shell / command execution | keep bounded Relay `bash` | Relay's command policy rejects raw shell strings, destructive operations, package installation, and unrestricted network mutation. Generic command MCP is too broad without equivalent policy. |
| Skills / packaged guidance | defer MCP | Use repository docs and future OpenCode-compatible `skill` semantics before creating a custom skill MCP surface. |
| External app integrations | evaluate case by case | Agent Framework MCP import is preferred when an approved app/server already exists and can run locally with explicit permission/audit boundaries. |

## Acceptance Rule

New local capabilities must answer these questions before implementation:

1. Does an approved local MCP server already provide the capability?
2. Can it enforce Relay workspace containment on Windows shares and Linux paths?
3. Can it participate in Agent Framework approval-required execution?
4. Can it produce AG-UI-visible tool events and Relay support-bundle traces?
5. Can it be packaged without administrator rights or personal passwords?
6. Does it work offline for local files?

If any answer is "no", Relay may keep or add a local function body, but the
reason must be recorded here or in `docs/IMPLEMENTATION.md`.
