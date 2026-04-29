# OpenWork/OpenCode Setup And Provider Gateway

Date: 2026-04-25

This document fixes the setup and provider contract for making OpenWork/OpenCode
easy to start with Relay_Agent's M365 Copilot bridge as a custom provider.

## Role Split

```text
OpenCode/OpenWork
  owns UX, sessions, tools, permissions, workspace execution, and event state

Relay_Agent copilot_server.js
  exposes an OpenAI-compatible provider facade and forwards model turns to
  M365 Copilot over Edge CDP

Relay_Agent bootstrap
  starts the provider gateway, writes global OpenCode provider config,
  downloads/verifies pinned OpenWork/OpenCode artifacts on Windows, and hands
  Windows installer approval to the user

M365 Copilot
  produces assistant text or OpenAI-compatible tool calls
```

Relay_Agent must not be the execution source of truth in this mode. OpenCode
receives `tool_calls`, executes them through its own tool layer, and sends the
next provider turn with tool results in the message history.

## Required Relay Endpoints

Relay's provider facade is served by `apps/desktop/src-tauri/binaries/copilot_server.js`.

Required endpoints:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`

Relay-specific diagnostics remain available:

- `GET /status`
- `POST /v1/chat/abort`
- `GET /v1/chat/progress`

## Authentication

OpenCode sends `options.apiKey` as:

```text
Authorization: Bearer <api key>
```

Relay also accepts the diagnostic desktop bridge header:

```text
X-Relay-Boot-Token: <boot token>
```

For the installed desktop path, Relay writes the current local provider token
directly into the global OpenCode config at
`~/.config/opencode/opencode.json`. The normal repo `pnpm dev` auto bootstrap
does the same for its generated config. Manual provider setup can still use
`{env:RELAY_AGENT_API_KEY}` or an explicit local token.

## Bootstrap First-Run Path

The production first-run entrypoint is installing and launching Relay Agent.
It keeps Relay out of the OpenWork/OpenCode UX path while preparing the
OpenCode provider handoff. The repo development equivalent is:

```bash
pnpm dev
```

The installed desktop launch starts the provider gateway and writes
`relay-agent/m365-copilot` as the default model in the global OpenCode config.
On Windows, the auto path also verifies and downloads the pinned artifacts,
extracts OpenCode, opens the verified OpenWork Desktop MSI for normal Windows
installer approval, and leaves OpenCode/OpenWork ready to call Relay's provider
endpoint. The generated config already contains the local provider token, so
users do not need to export `RELAY_AGENT_API_KEY`. For diagnostics,
`pnpm bootstrap:openwork-opencode -- --pretty` still prints a non-destructive
preflight report.

## Start The Gateway Manually

The older standalone scripts remain low-level diagnostics and manual recovery
tools. Start the provider gateway from the repo root:

```bash
pnpm start:opencode-provider-gateway
```

Defaults:

```text
Provider base URL: http://127.0.0.1:18180/v1
Model: relay-agent/m365-copilot
Edge CDP port: 9360
Token file: ~/.relay-agent/opencode-provider-token
```

The script prints a manual `RELAY_AGENT_API_KEY` export and `opencode.json`
provider block for diagnostic or recovery use. To print the config without
starting Edge or the provider:

```bash
pnpm start:opencode-provider-gateway -- --print-config
```

Useful overrides:

```bash
RELAY_EDGE_CDP_PORT=9360
RELAY_OPENCODE_PROVIDER_PORT=18180
RELAY_AGENT_API_KEY="<explicit local token>"
RELAY_SKIP_PRESTART_EDGE=1
```

## OpenCode Config

The bootstrap command above is the preferred config path. For manual
diagnostics, install or update the provider config in an OpenCode/OpenWork
workspace:

```bash
pnpm install:opencode-provider-config -- --workspace /path/to/workspace
```

The manual installer preserves unrelated `opencode.json` settings, adds
`enabled_providers: ["relay-agent"]`, and replaces only the
`provider.relay-agent` block. It also prints the `RELAY_AGENT_API_KEY` export
for manual environments that use `{env:RELAY_AGENT_API_KEY}`.

Use this config shape in the workspace or OpenCode config file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["relay-agent"],
  "provider": {
    "relay-agent": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Relay Agent / M365 Copilot",
      "options": {
        "baseURL": "http://127.0.0.1:18180/v1",
        "apiKey": "{env:RELAY_AGENT_API_KEY}"
      },
      "models": {
        "m365-copilot": {
          "name": "M365 Copilot",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  }
}
```

Then set:

```bash
export RELAY_AGENT_API_KEY="<same value passed to copilot_server.js --boot-token>"
```

## Provider Behavior

Relay accepts regular OpenAI-compatible chat requests without
`relay_session_id` or `relay_request_id`. If they are absent, Relay derives
transport ids from OpenAI-compatible request fields and keeps the Copilot tab
binding as disposable transport state.

Relay supports:

- non-streaming `chat.completion` responses
- streaming `chat.completion.chunk` SSE responses
- `tools` prompt injection for Copilot
- response normalization from `relay_tool`, `tool_calls`, or `tool_uses` into
  OpenAI `tool_calls`
- client disconnect cancellation mapped to Relay abort
- OpenAI-shaped error bodies

## Smoke Checklist

With `copilot_server.js` running and Edge signed in to M365 Copilot:

```bash
curl -sS http://127.0.0.1:18180/health

curl -sS \
  -H "Authorization: Bearer $RELAY_AGENT_API_KEY" \
  http://127.0.0.1:18180/v1/models

curl -sS \
  -H "Authorization: Bearer $RELAY_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"m365-copilot","messages":[{"role":"user","content":"Reply with OK."}]}' \
  http://127.0.0.1:18180/v1/chat/completions
```

Streaming smoke:

```bash
curl -N \
  -H "Authorization: Bearer $RELAY_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"m365-copilot","stream":true,"messages":[{"role":"user","content":"Reply with OK."}]}' \
  http://127.0.0.1:18180/v1/chat/completions
```

Expected:

- `/v1/models` returns `m365-copilot`
- non-streaming returns `object: "chat.completion"`
- streaming returns `data:` SSE chunks and `[DONE]`
- tool-producing replies return `finish_reason: "tool_calls"` with OpenAI
  `tool_calls`
- cancelling the OpenCode request closes the Relay request instead of leaving a
  Copilot turn running indefinitely

## Automated OpenCode Contract Smoke

For a deterministic check of the OpenCode custom provider path without a live
Copilot session, run:

```bash
pnpm --filter @relay-agent/desktop smoke:opencode-provider
```

The smoke starts a mock Relay provider, writes a temporary OpenCode workspace
config, and runs:

```bash
bun dev run --pure --format json --model relay-agent/m365-copilot --dir <tmp-workspace> ...
```

It passes only if OpenCode reaches Relay through the configured
`@ai-sdk/openai-compatible` provider, uses `m365-copilot`, streams the request,
receives the expected assistant text, receives an OpenAI `tool_calls` response
for the `read` tool, executes that tool in OpenCode, and sends the tool result
back to Relay in the follow-up provider turn.

For the bootstrap-managed first-run path, also run:

```bash
pnpm smoke:openwork-opencode-bootstrap-headless
pnpm smoke:openwork-opencode-bootstrap-gateway
```

## Live M365 OpenCode Smoke

For the end-to-end path through a signed-in M365 Copilot tab, run:

```bash
pnpm --filter @relay-agent/desktop live:m365:opencode-provider
```

The live smoke starts Edge with Relay's CDP profile, starts
`copilot_server.js` as an OpenAI-compatible provider, writes a temporary
OpenCode workspace config, and runs OpenCode against
`relay-agent/m365-copilot`. It verifies both a plain text provider response and
an OpenCode-owned `read` tool roundtrip:

- OpenCode sends a tool-capable prompt through Relay's OpenAI-compatible
  provider facade.
- Relay gets M365 Copilot to produce an OpenAI `tool_calls` response, using the
  constrained repair/normalization path when required.
- OpenCode executes the `read` tool against the temporary workspace fixture.
- OpenCode sends the tool result back through the provider loop and receives the
  final expected answer.

Useful overrides:

```bash
RELAY_EDGE_CDP_PORT=9360
RELAY_OPENCODE_PROVIDER_PORT=18180
RELAY_OPENCODE_LIVE_TIMEOUT_MS=300000
RELAY_OPENCODE_LIVE_TOOL_TIMEOUT_MS=720000
RELAY_OPENCODE_LIVE_EXPECTED=OPEN_CODE_M365_PROVIDER_OK
RELAY_OPENCODE_LIVE_TOOL_EXPECTED=OPEN_CODE_M365_TOOL_OK
RELAY_KEEP_OPENCODE_LIVE_SMOKE_DIR=1
```

The test fails before invoking OpenCode if Relay reports that M365 Copilot
requires sign-in.

## Tool-Call Repair Artifacts

If M365 Copilot returns prose or code when OpenCode has requested a tool call,
Relay performs one compact same-thread repair retry that asks for OpenAI
`tool_calls` JSON. Relay does not execute or infer arbitrary code snippets as
tools.

When that repair retry still fails, Relay writes an inspection artifact:

```bash
~/.relay-agent/opencode-provider-artifacts/*.json
```

Override the destination when running the gateway:

```bash
RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR=/tmp/relay-tool-artifacts \
  pnpm start:opencode-provider-gateway
```

Each artifact includes the original M365 response, the repair response, the
compact repair prompt, selected tool schemas, and parsed tool-call counts. Use
it to decide whether the live M365 response is safely normalizable into
OpenAI-compatible `tool_calls`.

Relay currently normalizes only structured tool-call evidence from these repair
responses:

- valid OpenAI `tool_calls`, `tool_uses`, or Relay `relay_tool` JSON;
- embedded or repeated JSON objects that contain OpenAI-compatible
  `tool_calls`;
- OpenAI `tool_calls` JSON whose `function.arguments` string contains an
  unescaped nested JSON object.

Relay still does not convert arbitrary prose or code snippets into tool calls.
