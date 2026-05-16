# Tool Substrate Matrix

This matrix is the executable baseline for the Agent Framework tool-substrate
cutover. Relay keeps Microsoft 365 Copilot as the reasoning controller and
Microsoft Agent Framework as the run loop. Tool implementations may use local
CLI/library providers or approved standalone MCP servers, but OpenCode, Codex
app-server, and Codex MCP server are not active runtime or provider
dependencies.

## Substrate Decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| Microsoft Agent Framework | Adopt as run-loop and tool taxonomy anchor | Provides function tools, MCP tools, approval, sessions, middleware, streaming, and telemetry. |
| Agent Framework local MCP tools | Conditional adoption | Use only for approved standalone local tool servers wrapped by Relay policy. |
| OpenCode runtime | Reject | Would introduce a second runtime/controller. Only its low-level tool contract is used as a compatibility target. |
| Codex app-server | Reject | Controls Codex threads, turns, auth/account, models, approvals, and event streams; conflicts with Copilot as controller. |
| Codex MCP server | Reject | Invokes a local Codex engine and is not a stable standalone local business-tool substrate. |
| GitHub Copilot custom agents | Category reference only | Useful categories, but no concrete Relay-compatible filesystem/edit schema. |
| AionUi | Historical only | Removed runtime/UX path; not a tool-contract target. |
| ripgrep | Adopt as CLI provider | Fast local file/content search. |
| OfficeCLI | Adopt as CLI provider | Broad Office inspect/edit surface behind Relay semantic registry. |

## Baseline-To-Target Matrix

The baseline names below describe the pre-cutover catalog. The active
model-facing catalog now uses the target names.

| Current prompt name | Target prompt name | Framework tool type | Capability family | Provider key | Mutation class | Approval policy | Output contract | Prompt visibility | Implementation owner | External dependency | Current acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rg_files` | `glob` | `function` | `workspace.search` | `ripgrep` | read | none | capped path list | migrate to `glob` only | Relay provider | ripgrep | `agent:rg-stream-smoke` |
| `rg_search` | `grep` | `function` | `workspace.search` | `ripgrep` | read | none | capped match lines | migrate to `grep` only | Relay provider | ripgrep | `agent:rg-stream-smoke` |
| `read` | `read` | `function` | `workspace.read` | `file_read` | read | none | text/document extract | visible | Relay provider | filesystem, document extractor | `agent:office-pdf-read-smoke` |
| `officecli` | `officecli` | `function` | `office.inspect` | `officecli` | read | none for read-only operations | OfficeCLI JSON/text observation | visible | Relay provider | OfficeCLI | `agent:officecli-registry-smoke` |
| `officecli_mutate` | `officecli_mutate` | `function` | `office.mutate` | `officecli` | write | required | OfficeCLI output + backup + verification | visible for mutating Office operations | Relay provider | OfficeCLI | `agent:officecli-registry-smoke` |
| `edit` | `edit` | `function` | `workspace.mutate` | `file_mutation` | write | required | replacement summary + backup | visible | Relay provider | filesystem | `agent:agui-client-tool-smoke` |
| `write` | `write` | `function` | `workspace.mutate` | `file_mutation` | write | required | write summary + backup if overwrite | visible | Relay provider | filesystem | `agent:agui-client-tool-smoke` |
| none | `apply_patch` | `function` | `workspace.mutate` | `file_mutation` | write | required | patch summary + backup/diff | add | Relay provider | filesystem | new golden/mutation smoke |
| `workspace_status` | `workspace_status` | `function` | `workspace.verify` | `workspace` | read | none | workspace/git summary | visible | Relay provider | filesystem, git optional | `agent:golden-smoke` |
| `diff` | `diff` | `function` | `workspace.verify` | `workspace` | read | none | git diff text | visible | Relay provider | git | `agent:golden-smoke` |
| `run_command` | `bash` permission category with bounded command args | `function` | `workspace.verify` | `command` | side-effect | required | bounded command output | visible as bounded command tool | Relay provider | allowed local executables | `agent:golden-smoke` |
| `ask_user` | `ask_user` | `client` | `agent.ask` | `ag-ui` | read | user interaction | question/answer event | visible | AG-UI/Relay bridge | browser client | AG-UI approval/client-tool smoke |

## Relay-Owned Residue

Relay intentionally keeps these responsibilities even when a tool is backed by
an external CLI, library, or MCP server:

- workspace containment and external-directory denial;
- mutation classification and approval;
- backup creation before writes;
- post-write verification and diff capture;
- output caps and deterministic truncation;
- redaction and support-bundle policy;
- Office/PDF extraction through exact `read`;
- OfficeCLI semantic operation validation and argv compilation;
- fail-fast diagnostics for invalid tool names, invalid arguments, missing
  executables, prompt projection failures, and unsupported provider drift.

## Migration Acceptance

The migration is complete when:

- the model-facing catalog no longer exposes `rg_files` or `rg_search`;
- the model-facing catalog no longer exposes `run_command`;
- Copilot golden tests select `glob`, `grep`, `read`, `edit`, `write`,
  `apply_patch`, `officecli`, and bounded command tools without Relay-specific
  aliases;
- OpenCode/Codex binaries, generated schemas, auth flows, and runtime processes
  are not bundled or launched;
- root `pnpm check`, Workbench E2E, release inventory, and support-bundle
  redaction smoke pass.
