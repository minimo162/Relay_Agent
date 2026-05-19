# Relay_Agent Completion Plan

Date: 2026-05-18

## 2026-05-19 HTML Tool API Hub Cutover

Relay_Agent is pivoting away from the focused PDF review client. The active
product is now a **Relay API Hub**: a small browser page served by Relay Core
that lets any local HTML tool connect to M365 Copilot through stable localhost
APIs.

The design goal is first-time clarity:

- launch Relay Agent;
- confirm Relay Core is Ready;
- copy or download a starter HTML file;
- build or open any task-specific HTML tool;
- call Relay Core through `/v1/chat/completions`.

The PDF review feature is retired as a default product surface. Future PDF
review, Office editing, file search, coding, proofreading, comparison, or
domain-specific workflows should be implemented as thin HTML tools over the
same API rather than separate Relay modes or separate backend runners.

### Active Architecture

- `apps/workbench/` hosts **Relay API Hub**, not the old generic Workbench and
  not a PDF review client.
- `apps/sidecar/` hosts **Relay Core**, the local API and execution boundary.
- `apps/launcher/` starts Relay Core and opens the API Hub.
- Relay Core owns M365 Copilot CDP connectivity, the OpenAI-compatible API
  adapter, diagnostics, and user-local storage.
- HTML tools are thin clients. They may provide specialized UI, but they must
  not implement their own CDP automation, cache/index storage, or workspace
  governance. Tool execution is client-side when a client chooses to use
  OpenAI-compatible function calling.

### API Contract

Relay Core must expose and smoke-test these stable APIs:

- `GET /health`;
- `GET /v1/models`;
- `GET /v1/relay/manifest`;
- `GET /v1/copilot/session`;
- `POST /v1/chat/completions`;
- `POST /api/support-bundle`.

The API Hub must show the manifest, endpoint list, authentication pattern,
starter HTML, a one-click Copilot connectivity test, and collapsed diagnostics.
It must not expose PDF-specific controls, generic workbench modes, developer
runtime clutter, or stale AionUi/OpenCode/OpenWork/Tauri concepts.

### Distribution

The portable package remains the recommended distribution. The optional
Windows installer remains available for Start Menu and uninstall integration.
`README-FIRST.html` should explain how to start Relay Agent, open the API Hub,
and use the starter HTML. Runtime state remains in the user's local app data
directory and never in shared folders or selected work folders.

### Superseded Plan Text

Older sections below that describe the PDF review HTML client as the active
default product are superseded by this HTML Tool API Hub cutover. PDF/Office/
search/coding should be implemented by external HTML clients through the
OpenAI-compatible API and client-managed tools, not first-party Relay modes or
Relay-side local tool execution.

## 2026-05-19 OpenAI-Compatible Local API Rules

Implementation status: completed in the 2026-05-20 `OPENAIAPI*` slice. The
public product contract is now the OpenAI-compatible Models + Chat
Completions API with client-managed function tools.

The target is to make Relay usable as a **normal
OpenAI-compatible local API** backed by Microsoft 365 Copilot. Anyone should be
able to connect an HTML tool, script, or existing OpenAI-compatible client by
changing only:

- `baseURL` to Relay's local `/v1` endpoint;
- `apiKey` to the Relay launch token;
- `model` to `m365-copilot`.

The product should behave like a small local OpenAI-compatible gateway:

> **Start Relay Agent. Point any OpenAI-compatible client at Relay. Use Copilot.**

The user should not need npm, a build step, a browser extension, an app
registration, OpenAI credentials, or edits to Relay itself to make a new tool.
Creating a new workflow should be as simple as using the standard OpenAI chat
completions shape from a normal `.html` file, script, or low-code tool.

### Compatibility Baseline

Relay targets OpenAI's **Chat Completions** and **Models** shapes, not the
Responses API. This keeps compatibility with existing OpenAI-compatible
clients while avoiding a second stateful API surface that Relay cannot honestly
emulate through the browser-hosted M365 Copilot controller.

Reference shapes:

- OpenAI Chat Completions API:
  `https://platform.openai.com/docs/api-reference/chat/create-chat-completion`
- OpenAI Models API:
  `https://platform.openai.com/docs/api-reference/models/list`

Relay's public API compatibility promise is:

- text chat through `/v1/chat/completions`;
- model discovery through `/v1/models`;
- optional OpenAI-style **client-managed** function tool calling;
- OpenAI-compatible JSON responses and error envelopes;
- no Relay-side local file, Office, shell, patch, AG-UI, or workspace tools in
  the public API contract.

### Public Endpoints

The public OpenAI-compatible endpoints are:

- `GET /v1/models`;
- `OPTIONS /v1/models`;
- `GET /v1/models/{model}`;
- `OPTIONS /v1/models/{model}`;
- `POST /v1/chat/completions`;
- `OPTIONS /v1/chat/completions` for browser CORS preflight.

Support endpoints may remain for Relay status and diagnostics, but they are not
part of the OpenAI-compatible contract:

- `GET /health`;
- `GET /v1/relay/manifest`;
- `GET /v1/copilot/session`;
- `POST /api/support-bundle`.

Endpoints that expose Relay-side tool execution are retired from the public
product:

- `/v1/tools` must not be advertised in the Hub, README, starter HTML, or
  release first-run docs;
- `/agui/relay` must not be advertised as an active product path;
- if existing implementation routes still exist, they are historical
  compatibility until removed and must not receive new product flows.

### Authentication And CORS

Relay should accept the following local authentication styles:

- `Authorization: Bearer <relay-launch-token>`;
- `X-Relay-Token: <relay-launch-token>`;
- `?token=<relay-launch-token>` only for simple browser/file examples.

Authentication behavior:

- missing or invalid token returns HTTP `401` with
  `type: "authentication_error"`;
- a valid token is required for all `/v1/*` requests;
- token values must never be logged in clear text or included in support
  bundles;
- response headers should include a request id such as `x-request-id` for
  support correlation.

CORS behavior:

- allow `file://` callers, which may arrive with `Origin: null`;
- allow `http://localhost:*` and `http://127.0.0.1:*`;
- reject other browser origins by default;
- allow `authorization`, `content-type`, and `x-relay-token` request headers;
- return `application/json; charset=utf-8` for JSON responses.

### Models API Contract

`GET /v1/models` returns a standard list object:

```json
{
  "object": "list",
  "data": [
    {
      "id": "m365-copilot",
      "object": "model",
      "created": 0,
      "owned_by": "relay"
    }
  ]
}
```

`GET /v1/models/m365-copilot` returns the same model object. Unknown models
return HTTP `404` with `type: "invalid_request_error"` and
`code: "model_not_found"`.

The only public model id is `m365-copilot` unless a later plan adds aliases.
Relay must not expose OpenAI model names because it does not call the OpenAI
API and does not require OpenAI credentials.

### Chat Request Contract

`POST /v1/chat/completions` accepts a JSON object.

Required fields:

- `model`: must be `m365-copilot`;
- `messages`: non-empty array.

Supported message roles:

- `system`;
- `developer`;
- `user`;
- `assistant`;
- `tool`.

Supported message fields:

- `role`;
- `content`;
- optional `name` where OpenAI-compatible clients send it;
- assistant `tool_calls` for prior tool-call context;
- tool `tool_call_id` for tool-result continuation.

Supported message content:

- text string content is supported;
- `null` assistant content is accepted when `tool_calls` is present;
- tool message content is text string content in the first target;
- OpenAI-style array content, images, audio, files, and multimodal parts are
  not part of the first compatibility target and should return HTTP `400`
  `code: "unsupported_content"` rather than being silently flattened.

Supported request fields:

- `model`;
- `messages`;
- `stream`;
- `stream_options`;
- `tools`;
- `tool_choice`;
- `parallel_tool_calls`;
- `temperature`;
- `top_p`;
- `frequency_penalty`;
- `presence_penalty`;
- `max_tokens`;
- `max_completion_tokens`;
- `stop`;
- `seed`;
- `service_tier`;
- `response_format`;
- `user`;
- `metadata`.

Compatibility-only request fields:

- harmless generation controls that M365 Copilot cannot honor exactly may be
  accepted for SDK compatibility but are best-effort/no-op;
- accepted no-op fields must be documented and must not cause Relay to pretend
  it can reproduce OpenAI sampling behavior;
- unsupported fields should fail with a standard error rather than being
  accidentally ignored.
- unknown top-level request fields should fail with
  `code: "unsupported_parameter"` until explicitly allowed.

Initial explicit non-goals:

- `n` values other than `1`;
- `logprobs`;
- `top_logprobs`;
- `logit_bias`;
- legacy `functions` and `function_call` request parameters;
- OpenAI custom tool types other than `type: "function"`;
- audio output;
- file upload or attachments through Chat Completions;
- persistent stored completions (`store`, list, retrieve, update, delete).

Deprecated OpenAI fields such as `functions`, `function_call`, and assistant
`function_call` messages should fail with
`code: "unsupported_deprecated_parameter"` in the first target. Do not
silently translate them unless a later task adds a tested compatibility
adapter.

Request limits:

- request body size must be capped and documented;
- message count and total text size must be capped before sending to Copilot;
- rejected oversized requests return HTTP `400` with
  `code: "request_too_large"`;
- limits must be enforced before provider submission so a local HTML tool
  cannot freeze the Copilot bridge with an accidental huge payload.

### Chat Response Contract

Non-streaming success returns:

```json
{
  "id": "chatcmpl-relay-...",
  "object": "chat.completion",
  "created": 0,
  "model": "m365-copilot",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "...",
        "tool_calls": null,
        "function_call": null,
        "refusal": null,
        "annotations": []
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

Response rules:

- `object` is `chat.completion`;
- `id` is unique per request and uses a stable prefix such as
  `chatcmpl-relay-`;
- `created` is a Unix timestamp in seconds;
- `choices` contains exactly one item for the first compatibility target;
- `choices[].message.tool_calls` is `null` unless tool calls are returned;
- deprecated `choices[].message.function_call` is always `null`;
- `choices[].message.refusal` is `null` unless Relay has a real corresponding
  refusal signal;
- `choices[].message.annotations` is an empty array unless Relay has real
  annotations;
- `choices[].logprobs` is always `null` because Relay does not expose token
  log probabilities;
- `finish_reason` may be `stop`, `length`, or `tool_calls`;
- `content_filter` is not used unless Relay has a real corresponding signal;
- `system_fingerprint` may be omitted or `null`;
- `usage` must be present for SDK compatibility, but token counts should be
  `0` when Relay cannot measure them reliably. Do not fabricate nonzero token
  counts.

### Streaming Contract

`stream: false` or omitted must be supported first.

`stream: true` should be implemented as OpenAI-compatible Server-Sent Events
before the API is called complete:

- response content type is `text/event-stream`;
- chunks use `object: "chat.completion.chunk"`;
- chunks include `choices[].delta`;
- assistant text is emitted as `choices[].delta.content`;
- tool-call deltas are emitted as `choices[].delta.tool_calls` when tool
  calling streams;
- the final event is `data: [DONE]`;
- `stream_options.include_usage` may be accepted; if requested and token
  counts are unavailable, the usage chunk must contain zero counts rather than
  fabricated counts;
- provider send/readiness failures during streaming become an SSE error chunk
  when possible, otherwise the HTTP request fails before the stream starts.

If streaming is not implemented in an intermediate build, `stream: true` must
return HTTP `400` `code: "unsupported_parameter"` and the Hub/starter examples
must use `stream: false`.

### Client-Managed Tool Calling Contract

Tool calling is OpenAI-compatible function calling where the **client executes
the tool**. Relay never executes client-supplied tools server-side.

Request support:

- `tools` accepts entries with `type: "function"`;
- `function.name` is required and must be validated as a safe identifier;
- `function.description` is optional;
- `function.parameters` is a JSON Schema object;
- `function.strict` is accepted. If `true`, Relay validates returned arguments
  against the supplied schema subset that Relay can enforce and fails invalid
  output with `provider_invalid_tool_call`; Relay must not claim perfect
  OpenAI Structured Outputs parity;
- omitted `function.parameters` means an empty object schema;
- `tool_choice` accepts `none`, `auto`, `required`, or
  `{ "type": "function", "function": { "name": "..." } }`;
- `parallel_tool_calls: false` means Relay must return at most one tool call;
- OpenAI `custom` tools are not part of the first target and return
  `code: "unsupported_tool_type"`.

Assistant tool-call response:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_...",
      "type": "function",
      "function": {
        "name": "tool_name",
        "arguments": "{\"key\":\"value\"}"
      }
    }
  ]
}
```

Tool-call rules:

- `finish_reason` is `tool_calls` when a tool call is returned;
- `function.arguments` is always a JSON string containing a valid JSON object;
- generated tool names must exactly match one of the supplied tool names;
- if `tool_choice` is `none`, Relay must not return tool calls;
- if `tool_choice` is `required` or a named tool and Copilot does not produce
  a valid matching tool call, Relay must fail fast with HTTP `502`
  `code: "provider_invalid_tool_call"` rather than returning prose;
- if `parallel_tool_calls` is `false` and Copilot returns multiple tool calls,
  Relay must fail validation rather than silently dropping calls.

Tool result continuation:

- clients send tool results as standard messages:
  `{ "role": "tool", "tool_call_id": "call_...", "content": "..." }`;
- Relay passes tool result content back to Copilot as conversation context;
- Relay validates that `tool_call_id` references a prior assistant tool call in
  the supplied conversation when feasible;
- final assistant responses after tool results use normal
  `choices[].message.content`.

### Structured Output And JSON Mode

`response_format` support should be narrow and explicit:

- `{ "type": "text" }` is supported;
- `{ "type": "json_object" }` should ask Copilot for one valid JSON object and
  validate the returned content before success;
- unsupported `json_schema` or future response formats should return HTTP
  `400` `code: "unsupported_parameter"` until implemented and tested.

Invalid JSON from Copilot in JSON mode is a provider validation failure:

- HTTP status: `502`;
- error type: `api_error`;
- error code: `provider_invalid_json`;
- no best-effort prose fallback.

### Error Contract

All errors use the OpenAI-compatible envelope:

```json
{
  "error": {
    "message": "Human readable error",
    "type": "invalid_request_error",
    "param": "messages",
    "code": "invalid_messages"
  }
}
```

Required status mapping:

- `400 invalid_request_error`: malformed JSON, invalid messages, unsupported
  parameter, unsupported content, unsupported model in request body;
- `401 authentication_error`: missing or invalid launch token;
- `404 invalid_request_error`: unknown model or unknown endpoint;
- `408 timeout_error`: bounded local timeout before provider submission or
  provider response;
- `409 conflict_error`: Copilot session busy when concurrent execution is not
  supported;
- `429 rate_limit_error`: Relay-side concurrency or queue limit;
- `500 api_error`: Relay internal error;
- `502 api_error`: Copilot provider failed, returned stale output, invalid
  JSON, invalid tool call, or selector drift;
- `504 timeout_error`: Copilot provider exceeded the response deadline.

Relay must not convert provider errors into generic assistant prose. Failures
remain machine-readable API errors.

Concurrency and timeout rules:

- default request timeout should be bounded and documented;
- if the single Copilot browser session is busy and Relay does not implement a
  queue, return `409 conflict_error`;
- if a bounded queue is implemented, queue overflow returns
  `429 rate_limit_error`;
- cancellation must stop waiting for Copilot and release Relay request state,
  even if the browser tab continues rendering late content.

### SDK And HTML Tool Compatibility

The primary success path is:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: relayLaunchToken,
  baseURL: "http://127.0.0.1:<port>/v1",
  dangerouslyAllowBrowser: true
});

const response = await client.chat.completions.create({
  model: "m365-copilot",
  messages: [{ role: "user", content: "..." }]
});
```

Relay API Hub should generate dependency-free `fetch` examples first, then
optional OpenAI SDK examples for users who already use that SDK.

HTML tool rules:

- any local `.html` file must be able to call Relay Core while Relay Agent is
  running;
- support `file://`, `http://localhost:*`, and `http://127.0.0.1:*` callers;
- users should be able to copy a working OpenAI-compatible snippet and paste it
  into their own HTML;
- users should not need to understand Edge CDP, M365 Copilot selectors,
  AG-UI events, or Relay-specific tool runners.

### API Hub Role

Relay API Hub should become an OpenAI-compatible API connection page, not a
custom SDK page:

- show Relay readiness;
- show the current `baseURL`;
- show/copy the current `apiKey`;
- show the current `model` value: `m365-copilot`;
- offer "OpenAI互換スニペットをコピー";
- offer "スターターHTMLを保存";
- offer "接続テスト";
- include a compact client-managed tool-calling example;
- keep manifest JSON, support bundle, and diagnostics under
  "開発者向け詳細".

The Hub must make it obvious that users can bring their own HTML or existing
OpenAI-compatible client. It should not imply that users must use a
Relay-specific wrapper such as `Relay.ask()` or a built-in PDF/search/Office/
code screen.

### Security And Storage Rules

- Relay Core keeps host validation, origin validation, launch-token/api-key
  protection, diagnostics, and user-local storage.
- HTML tools are untrusted clients. They can request Copilot reasoning, but
  Relay does not execute their tools or perform local file/Office/shell
  mutations for them.
- Shared folders, selected folders, and HTML tool folders must not receive
  Relay caches, indexes, token files, logs, or temp artifacts.
- Generated snippets must avoid exposing more than the current local base URL
  and launch token needed for the running session.
- There is no Relay-side mutation approval flow in the target product because
  Relay-side mutation tools are not exposed. Client-side tools are the
  client's responsibility.

### Acceptance Direction

The next implementation should prove that Relay can be used by an arbitrary
HTML file that is not part of the Relay repo using only an OpenAI-compatible
request. Acceptance requires E2E/API smokes that:

- call `GET /v1/models` and `GET /v1/models/m365-copilot`;
- call `POST /v1/chat/completions` with `Authorization: Bearer <token>`;
- verify the non-streaming `chat.completion` response shape;
- verify OpenAI-compatible errors for missing auth, invalid model, invalid
  messages, unsupported content, and unsupported parameters;
- verify streaming SSE once `stream: true` is implemented, or verify the
  explicit unsupported error before then;
- verify client-managed tool calling: send `tools`, receive `tool_calls`, send
  `role: "tool"` result, then receive a final assistant answer;
- verify that Relay never executes client-supplied tools server-side;
- verify that `/v1/tools` and `/agui/relay` are not advertised as public API
  paths.

## Product Direction

The material below this point is historical planning context unless a newer
2026-05-19 section above explicitly reuses it. The active product direction is
the OpenAI-compatible local API: M365 Copilot behind `/v1/chat/completions`,
client-managed OpenAI tool calling, and no Relay-side local tool execution as
part of the public product contract.

Relay_Agent moved from a three-mode utility app into a single local
business-agent workbench, and is now pivoting again toward a focused PDF review
product backed by the same local Relay Core:

> **Copilot thinks. Relay executes local tools safely.**

The user-facing product should not ask users to choose between `資料を探す`,
`Officeファイルを編集する`, and `コードを書く`. Those are implementation
capabilities, not primary UX modes. The next product surface should expose a
focused PDF review flow backed by one local Relay Core API. M365 Copilot
reasons over bounded, page-anchored review packets; Relay validates,
executes local extraction/alignment, and reports page-cited findings.

The product no longer treats AionUi, OpenWork, custom Relay run streams, or
Tauri as active product architecture. The active backend architecture remains
**framework-native Agent Framework + AG-UI with an OpenCode-compatible local
tool contract**: Microsoft Agent Framework owns agent turns, tool invocation,
sessions, middleware, approvals, and streaming run lifecycle; AG-UI owns the
browser-facing event/state/tool/approval protocol; OpenCode's built-in tool
model is the primary reference for model-visible local workspace tools; Relay
adds only the minimum adapters needed for M365 Copilot over Edge CDP,
OpenCode-compatible local tool function bodies, PDF extraction/alignment,
workspace policy, packaging, and diagnostics.

The current implementation target is a **generic Relay Workbench**:

- natural-language task input;
- Copilot-led step planning and tool selection;
- Relay-owned validation, local function bodies, approval policy/audit,
  backups, diffs, and logs around Agent Framework execution;
- generic local tools such as ripgrep-backed search, file read, OfficeCLI, and
  exact file edits;
- AG-UI-first user experience and event protocol, with a minimal visual surface
  and no diagnostic-first clutter.

The next product target supersedes that generic Workbench with a
**PDF review HTML tool backed by Relay Core API**:

- the current generic Workbench is a migration source, not the long-term
  default UI;
- the default user-facing client becomes a focused HTML tool for PDF typo,
  omission, wording, and cross-document consistency review;
- Relay Core remains the local API and execution host;
- the PDF HTML tool connects to Relay Core instead of embedding Copilot CDP,
  local file execution, approval, or workspace policy logic;
- once the PDF HTML tool and Relay Core API pass their acceptance gates, the
  current generic Workbench should be removed from release artifacts rather
  than kept as a parallel fallback UI.

The next architecture boundary is **Relay Core as a local agent API**:

- Relay Core owns Copilot connectivity, Agent Framework execution, AG-UI run
  streams, local tool governance, approvals, backups, diffs, logs, workspace
  policy, and app-local storage.
- Browser clients are clients of Relay Core, not the place where Copilot CDP,
  tool validation, or tool execution logic should live. The current Workbench
  is transitional; the planned default browser client is the PDF review HTML
  tool.
- Future HTML-based helper tools are thin clients that connect to Relay Core
  over localhost HTTP/WebSocket/AG-UI. They may provide task-specific
  affordances, but they must not implement their own Copilot automation,
  local tool execution, workspace policy, or approval harness.
- CDP selector details, prompt delivery, response extraction, JSON validation,
  retries, and fail-fast diagnostics stay inside Relay Core. Client code only
  sees stable run/session/tool/approval APIs.

Distribution direction:

- The primary user-facing release artifact is a **portable package**, not an
  installer. Windows users should be able to download a zip, extract it to a
  user-writable folder, and launch `Relay Agent.exe` without administrator
  rights, UAC elevation, or a personal Windows password. Compatibility scripts
  such as `Start Relay Agent.cmd` may remain in the package, but docs and
  first-run guidance must point to only `Relay Agent.exe` as the normal Windows
  entrypoint. The raw `Relay.Launcher.exe` name should not be exposed as an
  equal first-run choice in portable packages.
- Linux users should be able to extract the tarball and launch
  `./relay-agent`. Compatibility scripts such as `./start-relay-agent.sh` may
  remain, but should not be the primary first-run path.
- Root-level HTML files in the portable package are guidance documents, not
  launch prerequisites. `README-FIRST.html` should explain the one-click
  launcher, Copilot sign-in, PDF selection, and privacy boundaries; it must not
  be the first required step. The PDF review UI itself is served by Relay Core
  after the launcher starts the local sidecar.
- The Windows NSIS installer remains an optional convenience artifact for Start
  Menu/uninstall integration, but product docs, release notes, and default
  sharing guidance should lead with the portable package.
- Portable packages must still keep Relay state in the user's local application
  data directory. They must not write caches, indexes, logs, or temp artifacts
  into shared work folders or into the extracted portable folder unless the
  user explicitly configures that.

### 2026-05-19 PDF Section Alignment And Simplified UX Plan

The next PDF review refinement removes the manual review-type choice and makes
the product behavior depend on the number of PDFs selected:

- one PDF: review typos, duplicated words, punctuation, wording candidates,
  dates, numbers, and internal consistency in one run;
- two or more PDFs: run the same per-document checks, then split each document
  into chapter/heading sections, build a section correspondence table, and
  compare aligned sections before reporting cross-document differences;
- three or more PDFs: use the first selected PDF as the comparison baseline
  and align each additional PDF to it.

Long PDFs must not be handled by blind independent chunking. Relay should
prefer numbered headings, chapter labels, and short heading-like lines as
section boundaries. If no headings are available, Relay may fall back to
bounded page-range sections, but it must label that limitation in the result.
Every finding still cites document id, page, anchor text, and evidence
snippet. The section correspondence table is a first-class result artifact and
is included in the Markdown report.

The browser UI should stay minimal and first-time friendly:

- one large PDF picker, no review-type tabs or radio buttons;
- selected files list with clear count;
- one primary review button;
- results summarize findings, document count, and section alignment count;
- section correspondence appears as a compact table only after a multi-PDF
  review;
- diagnostics remain collapsed.

Distribution decision for this slice:

- the **portable package remains the primary recommended release artifact**
  because it is easier to share, does not require administrator rights, and
  aligns with the current first-run help;
- the Windows installer remains an optional convenience for Start Menu,
  desktop shortcut, and uninstall integration;
- release notes and README should lead with the Windows portable zip for
  first-time sharing, then list the optional installer.

Framework adoption rule:

- Prefer official Microsoft Agent Framework and AG-UI concepts before adding
  any Relay-owned protocol, schema, event, tool catalog, or workflow state.
- If Agent Framework or AG-UI already has a concept, Relay must use or adapt
  that concept instead of creating a parallel Relay abstraction.
- Prefer OpenCode-compatible local workspace tool names, argument schemas,
  permissions, and result semantics before adding Relay-specific model-visible
  tools. Relay may implement the tool bodies, but the model-facing contract
  should look like an existing agent tool system, not a new Relay invention.
- If a gap exists because M365 Copilot is only reachable through Edge CDP,
  isolate the gap in the Copilot provider adapter or a narrow middleware layer.
  Do not compensate by building a second agent runtime.
- OpenCode is the canonical reference for Relay's model-visible local file and
  shell tools. Codex app-server remains a harness/runtime reference, but is not
  adopted as the active runtime while M365 Copilot is the required controller.
  GitHub Copilot, Claude Code, and AionUi remain comparative UX/runtime prior
  art unless a later plan explicitly adopts one of their public contracts.

Plan-coherence rule for older sections in this file:

- Any older task text that names Relay-specific run/event contracts,
  `RunEvent`, `RelayTurnState` as the canonical runtime state, or
  `rg_files`/`rg_search` as public tool names is superseded by the
  framework-native + OpenCode-compatible direction in this section.
- Public browser-client traffic must be AG-UI. Public tool/runtime semantics
  must be Agent Framework function/MCP/client tools plus middleware and
  approvals. Model-visible local workspace tool semantics must be
  OpenCode-compatible unless a documented gap makes that impossible.
- Legacy names may remain only as internal provider aliases during migration:
  `rg_files` maps to the Agent Framework `glob` function tool, and
  `rg_search` maps to the Agent Framework `grep` function tool. New plan tasks
  must use the canonical names `glob` and `grep`.
- Any older text that treats `patch` as the canonical mutation tool name is
  superseded. The OpenCode-compatible canonical name is `apply_patch`; `patch`
  is only a compatibility alias.
- Any older text that treats the generic Workbench as the permanent default UI
  is superseded by the PDF review HTML tool cutover plan. The generic
  Workbench may be used as migration source only; it must not remain as a
  visible fallback release surface after PDFHTML acceptance passes.

## Active Harness Architecture Plan

This section is the active harness design plan. It exists because recent live
Copilot E2E work showed that aligning only tool names is not enough: the
remaining failures are harness failures around session continuity, approval
resume, tool-result memory, premature final answers, and custom Relay recovery
logic. The fix is not another Relay planner. The fix is to adopt mature harness
semantics from OpenCode and host them through Microsoft Agent Framework.

Reference sources checked for this plan:

- `https://opencode.ai/docs/tools/`
- `https://opencode.ai/docs/agents/`
- `https://arxiv.org/abs/2605.05242`
- `https://github.com/DCI-Agent/DCI-Agent-Lite`
- `https://learn.microsoft.com/en-us/agent-framework/overview/`
- `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://docs.ag-ui.com/introduction`
- `https://docs.ag-ui.com/concepts/events`
- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview`
- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/copilot-apis-overview`

### 2026-05-19 Standard Chatbot UX And Tool Harness Alignment Plan

The next UX target is a first-time-friendly, standard chatbot experience. Relay
should feel like one professional chat app that happens to operate local tools,
not a specialized dashboard with internal runtime terms. The local tool and
harness contract should likewise stay close to mature public patterns:
CopilotKit renders the chat surface, AG-UI carries lifecycle/tool/result/state
events, Microsoft Agent Framework owns the function-tool loop and approval
handoff, and OpenCode remains the reference for model-visible local workspace
tool names and permission semantics.

Reference sources checked for this plan:

- CopilotKit `CopilotChat` is the inline prebuilt chat surface intended for a
  dedicated chat route or pane, with user-facing labels, welcome screens,
  suggestions, and customizable slots:
  `https://docs.showcase.copilotkit.ai/pydantic-ai/prebuilt-components/chat`.
- CopilotKit human-in-the-loop guidance treats approvals as inline tool-call
  pauses where the agent keeps context and the user decides whether to resume:
  `https://docs.showcase.copilotkit.ai/llamaindex/human-in-the-loop`.
- AG-UI defines the standard streaming event vocabulary for runs, messages,
  tool calls, tool results, state, errors, and completion:
  `https://docs.ag-ui.com/sdk/js/core/events`.
- Microsoft Agent Framework handles the model tool-calling loop and supports
  function tools, local MCP tools, and provider-hosted tools. Local function
  tools are appropriate when Relay must enforce local resources, security
  boundaries, and error handling:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`.
- Microsoft Agent Framework approval guidance uses approval-required function
  tools and response content to resume the same session after the user approves
  or rejects the call:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`.
- OpenCode's built-in tool list and permission model remain the reference for
  Relay's model-visible local workspace tools:
  `https://opencode.ai/docs/tools/`.

Implementation plan:

1. **Make the Workbench read as a normal chatbot**
   - Keep a single centered chat column with one workspace picker, one
     CopilotKit chat, and a collapsed diagnostics disclosure.
   - Replace developer-facing copy such as `Workbench` and broad mode language
     with first-time-friendly language: choose a folder, type a request, review
     local changes before they run.
   - Keep starter actions as small suggestions, not mode tabs. PDF helper chips
     remain optional accelerators below the workspace.
   - Add a calm empty state before workspace selection that explains the three
     steps without exposing internal architecture.
   - Keep support JSON collapsed and explicitly labeled as diagnostics.

2. **Keep AG-UI/CopilotKit as the UI contract**
   - Continue to render the main conversation through `CopilotChat`.
   - Continue to render mutation approvals through CopilotKit's
     `useHumanInTheLoop`/AG-UI tool-call flow.
   - Keep tool events concise and standard: exact tool name, status, short
     result. Do not create a separate Relay activity panel or per-feature mode.
   - Add accessibility affordances expected of a normal chat app: visible focus,
     `aria-live` notices for status changes, and `role=alert` errors.

3. **Keep the model-visible tool contract standard**
   - Do not add feature-specific model-visible tools for search, Office,
     coding, or PDF review.
   - Keep the public catalog aligned to OpenCode-style local tools:
     `glob`, `grep`, `read`, `edit`, `write`, `apply_patch`, bounded `bash`,
     plus Relay's documented OfficeCLI extension tools and workspace/diff
     review tools.
   - Keep Microsoft Agent Framework function-tool registration and approval
     semantics as the backend harness contract.
   - Treat custom Relay schemas as execution observations and diagnostics, not
     as a second model-visible tool system.

4. **Add regression gates**
   - Add a Workbench standard-chat smoke that verifies the UI keeps
     `CopilotChat`, `useDefaultRenderTool`, and `useHumanInTheLoop`; avoids
     old mode labels; includes first-time workspace guidance; and keeps errors
     accessible.
   - Keep `agent:tool-catalog-smoke` as the authoritative model-visible tool
     inventory gate.
   - Include the new smoke in `pnpm check`.

5. **Acceptance criteria**
   - First-time users see one chat, one folder picker, obvious starter
     suggestions, and no old mode chooser.
   - Mutations still pause for approval inline in the chat.
   - The model-visible tool names remain OpenCode-compatible, with no revived
     `RelayDocumentSearch*`, AionUi, OpenWork, Tauri, or per-mode runners.
   - `pnpm check`, release inventory, portable packages, and the optional
     Windows user-scope installer pass for the bumped release version.

### 2026-05-19 Copilot Gateway And Relay Core API Decoupling Plan

The next structural improvement is to stop treating the Workbench as the only
consumer of Copilot connectivity. Relay should expose a stable local API
surface that behaves like an app-local Copilot/agent gateway, while keeping all
unsafe or brittle implementation details inside the .NET sidecar. The browser
clients, portable HTML help, and any future HTML task tools should become
clients of this Relay Core API.

This is not a move to standalone HTML-only execution. A `file://` HTML page
cannot safely run ripgrep, OfficeCLI, workspace edits, Edge CDP, backups, diffs,
or approvals. The target is **PDF HTML/browser clients as UI, Relay Core as
localhost agent API**.

Reference sources checked for this plan:

- Microsoft 365 Copilot extensibility now includes Copilot Chat API preview,
  Retrieval/Search APIs, connectors, and API plugins, but these depend on
  organization licensing, consent, and admin availability. Relay should keep a
  provider abstraction so a future official API adapter can replace Edge CDP
  when the tenant permits it:
  `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview`.
- Microsoft 365 Copilot APIs are Graph-based REST APIs under the Copilot
  namespace for retrieval/search/interactions and require Microsoft 365 Copilot
  licensing. They are a future provider option, not an immediate replacement
  for the current signed-in Edge CDP bridge:
  `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/copilot-apis-overview`.
- AG-UI remains the public event protocol for run lifecycle, messages, tool
  calls, tool results, state, interrupts, errors, and completion.
- Microsoft Agent Framework remains the backend runtime for agent sessions,
  tools, middleware, and approvals.
- OpenCode remains the reference for model-visible local workspace tool names
  and permission semantics.

Implementation plan:

1. **Name the boundary explicitly**
   - Treat `apps/sidecar` as Relay Core: the only owner of Copilot provider
     adapters, Agent Framework orchestration, local tool execution, approvals,
     workspace containment, backups, diffs, logs, and diagnostics.
   - Treat `apps/workbench` as a transitional client. The long-term default
     client is a focused PDF review HTML tool that calls Relay Core, not a
     runtime owner.
   - Treat future HTML tools as optional clients. They can be shipped in the
     portable package, but must connect to Relay Core instead of duplicating
     CDP or tool logic.

2. **Define a stable localhost API**
   - Keep `/agui/relay` as the canonical run endpoint for task execution and
     streaming. This is the main contract for Workbench and any advanced HTML
     tool client.
   - Formalize read-only state endpoints:
     - `/health` for sidecar readiness and version;
     - `/v1/copilot/session` for Copilot provider readiness, signed-in Edge
       connection metadata, and fail-fast diagnostics;
     - `/v1/workspace` for current workspace state and folder-picker handoff;
     - `/v1/tools` for the model-visible OpenCode-compatible tool catalog and
       capability metadata.
   - Formalize action endpoints:
     - `/v1/workspace/select` for native folder selection handoff;
     - `/v1/approvals` for approve/reject/resume operations when AG-UI
       client-tool approval needs a direct client action;
     - `/v1/support-bundle` for explicit, redacted diagnostics export.
   - Do not expose raw CDP, raw selector operations, arbitrary OfficeCLI argv,
     or unrestricted shell endpoints.
   - Version the client-facing API under `/v1`, document request/response
     shapes with JSON schemas or an OpenAPI-style reference, and keep
     backward-incompatible changes explicit instead of silently changing HTML
     client behavior.

3. **Make provider adapters swappable without changing clients**
   - Keep the current Edge CDP provider as the default M365 Copilot provider.
   - Put prompt delivery, send timing, response extraction, stale-response
     detection, JSON validation, and fail-fast errors behind a single provider
     interface.
   - Add the planned official-provider seam only as an interface and contract
     placeholder. Do not require Microsoft Graph/Copilot API permissions in the
     current product.
   - If official Copilot Chat API access becomes available later, it replaces
     the provider adapter only. PDF HTML tools, Workbench migration code, tool
     execution, approval, and AG-UI contracts should not change.

4. **Keep client tools thin and safe**
   - The PDF review HTML client and any future HTML helper tools may provide
     task-specific affordances, but each helper should still submit structured
     AG-UI client actions or natural-language review tasks to Relay Core.
   - Do not add per-helper search engines, Office edit runners, code runners,
     or Copilot prompt bridges.
   - All mutation requests must still flow through Relay Core approval,
     backup, diff, and verification.

5. **Security and distribution constraints**
   - Bind public local API traffic to loopback only.
   - Require the existing launch token/session token for browser clients and
     future HTML clients.
   - Keep CORS/origin rules narrow. Portable HTML clients shipped with Relay
     may connect to localhost only after the sidecar is launched.
   - Keep all caches, temp data, logs, backups, and support bundles in
     user-local storage unless the user explicitly chooses another location.
   - Do not write Relay artifacts into searched/shared folders.

6. **Regression gates**
   - Add a Relay Core API contract smoke that verifies `/health`,
     `/v1/copilot/session`, `/v1/workspace`, `/v1/tools`, `/agui/relay`,
     approval resume, and support-bundle redaction.
   - Add schema validation for public API responses consumed by the PDF HTML
     client.
   - Add a thin-client smoke that loads a standalone HTML client fixture
     against a running sidecar and verifies it can read health, start an AG-UI
     run, and receive fail-fast errors without direct CDP access.
   - Keep `pnpm check` as the required acceptance gate.

7. **Acceptance criteria**
   - Copilot connectivity can be tested and diagnosed without opening the old
     generic Workbench UI.
   - Browser clients use only stable Relay Core APIs for session state,
     workspace state, tools, approvals, support bundles, and AG-UI runs.
   - Future HTML helper tools can be added without touching Copilot CDP or
     local tool execution code.
   - No client can access raw CDP, arbitrary shell, arbitrary OfficeCLI argv,
     or unapproved mutation paths.
   - Official Microsoft 365 Copilot APIs remain a future provider adapter
     option, not a current dependency or fallback.

### 2026-05-19 PDF Review HTML Tool And Distributable Relay Core API Plan

The product should pivot from a generic Workbench to a focused PDF review tool:
users open Relay, select one or more PDFs, and Relay checks typos, omissions,
awkward wording, terminology drift, numerical mismatches, and cross-document
inconsistencies. The goal is a tool that can be distributed
simply inside a portable Relay package and used by anyone who has access to
Microsoft 365 Copilot in their signed-in Edge profile.

This plan intentionally removes the current generic Workbench from the
long-term product surface. Search, Office editing, and coding remain possible
future API/tool capabilities, but they are not the default UI. The first
productized client is the PDF review HTML tool.

Product scope:

- **Single PDF proofreading**
  - Detect typographical errors, duplicated words, obvious omissions,
    inconsistent spelling, inconsistent terminology, broken references, and
    suspicious punctuation.
  - Return findings with page number, short evidence excerpt, severity, and
    suggested correction.
- **Single PDF internal consistency review**
  - Detect mismatched headings, section references, table/figure references,
    dates, labels, defined terms, numbers, and repeated statements that drift
    across pages.
- **Multi-PDF consistency comparison**
  - Compare two or more documents while preserving page/section correspondence.
  - Use the first selected PDF as the baseline for three-or-more-PDF reviews.
  - Detect mismatched names, dates, amounts, labels, headings, definitions,
    exhibit/table references, and statements that should align.
  - Avoid simple blind chunking that loses document-to-document alignment.
- **Review report**
  - Produce a concise review table in the HTML UI and exportable Markdown/CSV
    report.
  - Every finding must link back to page-level evidence. Copilot may reason,
    but Relay must keep the cited source pages and extracted snippets.
- **Input constraints and explicit limits**
  - Text-layer PDFs are the initial supported path.
  - Scanned/image-only pages must be detected and reported as review gaps
    unless a later OCR dependency is explicitly added to the plan.
  - Password-protected, corrupted, or extraction-blocked PDFs should fail with
    actionable errors before Copilot review starts.
- **Job control**
  - Long reviews must show progress, support cancellation, and preserve
    completed page-level findings when safe.
  - Partial results must be labeled as partial; Relay must not present them as
    full-document conclusions.

Architecture plan:

1. **Make the PDF HTML tool the default client**
   - Replace the current generic Workbench release entry with a focused static
     HTML client served by Relay Core.
   - The client should be understandable on first open: select PDF(s), run
     review, inspect findings and section correspondence, export report.
   - Keep the UI minimal, with a large document selection area, one review
     action, a clear progress region, and a findings table. Avoid developer
     diagnostics unless the user opens support details.
   - Use a native Relay Core file picker or explicit browser file selection.
     Do not require users to manually type paths. If browser file inputs cannot
     provide stable local paths, stage the selected files in user-local Relay
     storage and keep the original filename/display metadata.
   - Do not keep the old Workbench as a visible fallback after cutover.

2. **Keep Relay Core as the custom API/tool package**
   - Relay Core remains the self-contained .NET sidecar distributed with the
     HTML client.
   - The portable package should still launch with one obvious executable, open
     the local PDF HTML tool, and require no administrator rights.
   - Relay Core exposes stable localhost APIs for health, Copilot session,
     PDF selection/upload, page extraction, review job creation, AG-UI progress
     streaming, report export, and redacted support bundles.
   - The API must be easy to reuse by future HTML tools, but the PDF client is
     the first supported client.

3. **Use M365 Copilot as the reasoning layer**
   - Users should not need OpenAI API keys or a separate LLM subscription.
   - The default provider is the signed-in Edge M365 Copilot bridge.
   - Relay should fail fast if Copilot is not signed in, unavailable, blocked
     by tenant policy, or cannot return valid structured results.
   - A future official Microsoft 365 Copilot API adapter may replace Edge CDP
     when tenant permissions allow it, but the current tool must not depend on
     that API.

4. **Design page-aware PDF review instead of naive chunking**
   - Extract page maps with page number, text blocks, headings when available,
     and stable page anchors.
   - For long PDFs, create review windows with overlap and page anchors so
     findings can be traced back.
   - For two-PDF comparison, build an alignment map first: title/heading
     matches, page labels, section numbers, table/figure labels, dates, defined
     terms, and high-similarity passages.
   - Review aligned pairs and unmatched sections separately. Do not simply
     split each PDF independently and ask Copilot to compare unrelated chunks.
   - Keep extraction, alignment, chunk budgeting, and evidence packaging inside
     Relay Core. Copilot receives bounded, page-anchored review packets.
   - Keep a deterministic review ledger: extraction version, page map checksum,
     alignment decisions, Copilot packet IDs, validated findings, rejected
     findings, and final report metadata.

5. **Define finding and report contracts**
   - Use a stable finding schema: `id`, `reviewType`, `severity`, `category`,
     `documentId`, `page`, `anchor`, `evidence`, `issue`, `suggestion`,
     `confidence`, and `status`.
   - Two-PDF comparison findings must include both document references when the
     issue concerns a mismatch.
   - Reports must separate likely typos, consistency mismatches, extraction
     limitations, and items requiring human judgment.
   - The UI should allow users to mark findings as accepted, ignored, or needs
     review without modifying the source PDF.

6. **Keep the API distributable and safe**
   - Bind to loopback only and require the launch/session token for browser
     clients.
   - Store staged files, extracted text, temp files, logs, reports, and backups
     in user-local app storage, not beside the source PDFs and not in shared
     folders.
   - Define a retention policy: job artifacts are removable from the UI, and
     support bundles do not include raw PDF text unless explicitly requested.
   - Redact support bundles by default. Do not include raw PDF text unless the
     user explicitly opts in.
   - Avoid arbitrary local shell or raw CDP exposure from the PDF client.
   - Keep all mutation tools out of the PDF review UI. This product surface is
     read/review/report, not document mutation.

7. **Distribution plan**
   - Keep the portable package as the primary distribution.
   - The launcher opens the PDF review HTML tool by default.
   - Include Relay Core, bundled PDF extraction dependencies, ripgrep only if
     still needed for support/search helpers, app icon, first-run HTML help,
     and a concise README.
   - Users with a Microsoft 365 Copilot contract and a signed-in Edge profile
     should be able to extract and run the package without admin rights.
   - NSIS remains optional convenience only; portable remains the primary
     sharing path.
   - Release notes must say the package is for users who already have access to
     Microsoft 365 Copilot through their organization; Relay does not provide a
     Copilot license or bypass tenant controls.

8. **Decommission plan for the current Workbench**
   - Remove generic Workbench UI from default release artifacts after the PDF
     HTML client has parity with required launch/session/support behavior.
   - Remove Workbench-specific smokes or replace them with PDF HTML client
     smokes.
   - Keep AG-UI and Agent Framework backend contracts. The cutover changes the
     client surface, not the backend execution discipline.
   - Do not keep two visible first-run UIs in the release package.

9. **Regression gates**
   - Add PDF HTML client UX smoke: first open, Copilot readiness, PDF selection
     affordance, one-PDF review, two-PDF comparison, export report, support
     details collapsed.
   - Add PDF extraction/page-map smoke for long PDFs.
   - Add scanned/image-only PDF limitation smoke.
   - Add two-PDF alignment smoke with deliberately mismatched dates, labels,
     amounts, and terminology.
   - Add Copilot structured-output smoke for proofreading findings and
     consistency findings.
   - Add cancellation/partial-result smoke for long jobs.
   - Add packaging smoke proving the launcher opens the PDF HTML tool and the
     old Workbench is not exposed as a competing entrypoint.

10. **Acceptance criteria**
   - A first-time user can run the portable package, select one PDF, and get a
     page-cited typo/consistency report.
   - A first-time user can select two PDFs and get a page-cited consistency
     comparison report with document-to-document correspondence preserved.
   - A scanned/image-only PDF reports an explicit extraction limitation instead
     of producing unsupported claims.
   - Long PDF jobs show progress, support cancellation, and label partial
     results accurately.
   - The user only needs an existing Microsoft 365 Copilot-capable signed-in
     Edge profile; no OpenAI API key, admin install, or extra service account
     is required.
   - Relay Core APIs are documented and reusable by future HTML tools.
   - The current generic Workbench is not part of the default release surface
     after cutover.

### 2026-05-19 Portable One-Click First-Run Plan

The current portable package is functionally usable, but its root folder exposes
too many plausible entrypoints (`Relay.Launcher.exe`, `Relay.Sidecar.exe`,
localized cmd files, HTML guidance). That is technically acceptable but weak for
first-time distribution. The next release should keep the same browser
Workbench + .NET sidecar architecture while making the portable zip read like a
normal consumer app folder: one obvious launcher and optional help.

Implementation plan:

1. **Make the normal launcher obvious**
   - Add `Relay Agent.exe` to the Windows portable root as the primary
     user-facing launcher.
   - Add `relay-agent` to the Linux portable root as the primary launcher.
   - Keep scripts only as compatibility paths for old docs and
     troubleshooting; do not expose raw `Relay.Launcher` as an equal portable
     launcher.

2. **Make HTML guidance secondary**
   - Add `README-FIRST.html` as the help document users open only when they
     need instructions.
   - Keep the existing portable HTML front door as a compatibility alias, but
     change its copy so it clearly says the HTML is a guide, not the launcher.
   - Update portable text guidance to say: extract, double-click
     `Relay Agent.exe`, sign in to Copilot, choose a folder, type a request.

3. **Keep safety and storage boundaries unchanged**
   - Do not move Relay caches, indexes, logs, backups, or temp files into the
     extracted portable folder.
   - Do not require administrator rights, a machine-wide install, or a Windows
     password.
   - Do not change the active AG-UI / Microsoft Agent Framework / CopilotKit
     runtime architecture.

4. **Regression gates**
   - Extend packaging smoke coverage so the release script must contain
     `Relay Agent.exe`, `README-FIRST.html`, and `relay-agent`.
   - Keep `pnpm check` as the acceptance gate before packaging.

5. **Acceptance criteria**
   - The Windows portable zip contains `Relay Agent.exe` at the root.
   - The Linux portable tarball contains `relay-agent` at the root.
   - First-run docs describe one primary launcher and treat HTML as help.
   - Release artifacts are versioned and published with checksums, inventory,
     and SBOM.

### 2026-05-18 Portable-First Distribution Plan

The HTML-only Relay Lite idea is rejected because local command execution,
OfficeCLI mutation, recursive workspace operations, Edge CDP, approval logs,
backups, and diffs cannot be safely implemented from a standalone `file://`
HTML page. The distribution goal is therefore installer-free sharing through a
portable package while keeping the full Relay sidecar architecture.

Implementation plan:

1. **Make portable packages first-class release artifacts**
   - Add explicit archive scripts for `win-x64` and `linux-x64` that turn the
     existing self-contained sidecar package into versioned release artifacts:
     `relay-agent-<version>-win-x64.zip` and
     `relay-agent-<version>-linux-x64.tar.gz`.
   - Keep the current package layout intact: `Relay.Launcher`,
     `Relay.Sidecar`, `wwwroot`, `relay-tools`, `relay-assets`, default config,
     and release contents manifest.

2. **Add user-facing portable launch affordances**
   - Include `README_PORTABLE.txt` in each package.
   - Include `Start Relay Agent.cmd` in the Windows package so nontechnical
     users do not need to identify the launcher executable manually.
   - Include `start-relay-agent.sh` in the Linux package.

3. **Keep installer optional**
   - Continue to build the Windows user-scope NSIS installer for users who want
     Start Menu and uninstall integration.
   - Do not describe the installer as required for normal use.
   - Keep all installer constraints: no admin rights, no HKLM, no Program Files
     default, and no personal Windows password.

4. **Update release automation**
   - GitHub release workflow uploads the Windows portable zip before the
     optional installer.
   - Linux release workflow uploads the versioned Linux portable tarball.
   - Release inventory and SBOM include the current-version portable archives
     when present.

5. **Acceptance criteria**
   - `pnpm sidecar:portable:windows` produces the Windows portable zip.
   - `pnpm sidecar:portable:linux` produces the Linux portable tarball.
   - Package roots contain `README_PORTABLE.txt` and the platform launch helper.
   - `pnpm release:inventory` records the current-version portable archives
     when generated.
   - `pnpm check` remains green.

### 2026-05-19 Portable PDF Review UX Plan

Users should be able to bring local PDFs into the same generic Relay Workbench
conversation for proofreading and cross-document consistency checks. This must
not create a separate document-review mode, a dedicated PDF search engine, or a
parallel runner. PDF review is a high-frequency recipe over the existing
OpenCode-compatible tool catalog: Copilot chooses `glob`, `grep`, and exact
`read`; Relay extracts supported local PDF text and returns AG-UI tool events;
the Workbench stays a normal CopilotKit chat surface.

Reference sources checked for this plan:

- CopilotKit is the frontend stack for agent chat, generative UI, and
  human-in-the-loop workflows, and can connect React apps to arbitrary agent
  frameworks: `https://docs.showcase.copilotkit.ai/`.
- AG-UI defines streaming lifecycle, message, tool-call, tool-result, state,
  and error events, so PDF review should remain on the `/agui/relay` event
  stream: `https://docs.ag-ui.com/sdk/js/core/events`.
- Microsoft Agent Framework handles the model tool-calling loop and emphasizes
  clear tool descriptions, function tools, local MCP tools, and human approval
  for sensitive actions:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools` and
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`.
- OpenCode's built-in model-facing tools remain the local tool contract
  reference: `read`, `grep`, `glob`, `edit`, `write`, `apply_patch`, and
  bounded `bash`: `https://opencode.ai/docs/tools`.
- UI direction follows the internal UI/UX search result for a minimal
  professional document-review workbench: one calm column, restrained
  monochrome/accent palette, large whitespace, clear primary action, no
  diagnostic-first clutter, visible focus, and accessible labels.

Implementation plan:

1. **Keep PDF review as promptable generic work**
   - Add Workbench starter chips for:
     - `PDFを選んで誤字確認`;
     - `2つのPDFを選んで比較`.
   - The chips call a sidecar-owned native PDF picker, then insert a concise
     draft into the CopilotKit composer with the selected exact local PDF
     paths. If the composer cannot be reached, copy the same draft to the
     clipboard.
   - The picker uses the same local sidecar boundary as workspace selection:
     Windows native `FileOpenDialog` with PDF filtering and Linux `zenity` /
     `kdialog` where available. It does not upload PDFs into the browser, write
     picker artifacts into shared folders, or create a separate PDF runner.
   - Drafts instruct Copilot to use exact `read` on the selected PDFs,
     cite only extracted text evidence, list suspected typos or inconsistent
     values, and clearly mark image-only/OCR-required pages as not confirmed.
   - Do not add drag-and-drop file upload unless it can be represented as
     workspace-local paths that Relay can validate; browser-only `File` objects
     remain outside the sidecar tool catalog.

2. **Add an HTML-first portable front door**
   - Include `Relay Agent.html` at the portable package root. It is a
     user-facing start page, not the runtime itself.
   - The HTML explains in a first-run friendly way how to start the local
     launcher, choose a workspace, and use the two PDF picker starters.
   - Windows portable packages also include a Japanese launch helper,
     `Relay Agent を起動.cmd`, alongside `Start Relay Agent.cmd`.
   - The HTML must not imply that a standalone browser page can execute local
     tools without the sidecar.

3. **Harden tool guidance for PDF review**
   - Add Agent Framework prompt guidance for local PDF proofreading and
     two-PDF comparison:
     - use `read` on every exact PDF before finalizing;
     - do not treat filenames as content evidence;
     - mention the current text-layer-only limitation for PDF extraction;
     - cite snippets/sections from extracted content when making findings.
   - Add the same rule to `RelayPromptBuilder` so admissible-action turns do
     not produce premature finals for PDF review tasks.

4. **Keep the GUI minimal**
   - Keep one Workbench, one workspace picker, one chat, one support disclosure.
   - Add the PDF starter row as small chips below the workspace, not as a
     separate mode card.
   - Keep long instructions out of the main UI; starter prompts carry the
     procedural detail inside the composer draft.

5. **Acceptance criteria**
   - Workbench shows the two PDF picker chips after a workspace is selected.
   - Starter chips open the OS PDF picker and insert or copy drafts that
     explicitly mention `read`, exact selected PDF paths, evidence,
     typo/表記ゆれ review, comparison, and OCR/text-layer limits.
   - Sidecar exposes one small PDF picker endpoint; it is a UX attachment
     helper, not a model-facing PDF tool or a separate backend mode.
   - `Relay Agent.html`, `README_PORTABLE.txt`, and platform launch helpers are
     included in portable package roots.
   - Agent/turn prompt text contains PDF proofreading and comparison guidance
     without introducing a PDF-specific backend runner.
   - `pnpm check`, portable package creation, release inventory, and release
     artifact generation pass.

### 2026-05-19 Page-Aware Long PDF Review Plan

Large PDFs can exceed what Copilot can usefully process in one turn. Splitting
them into arbitrary fixed-size chunks would make single-document proofreading
manageable, but it would break two-PDF comparison because page and section
correspondence can drift between the documents. Relay should therefore add
page-aware PDF reads to the existing generic `read` tool instead of creating a
dedicated PDF-review engine.

Reference sources checked for this plan:

- PdfPig is a .NET PDF text extraction library that can open existing PDFs,
  inspect pages, and expose page-level text without native dependencies:
  `https://products.documentprocessing.com/parser/net/pdfpig/`.
- RAPTOR shows why long-document retrieval benefits from hierarchical document
  structure rather than only short contiguous chunks:
  `https://huggingface.co/papers/2401.18059`.
- Late chunking research highlights that chunks lose useful context when they
  are produced before document-level context is considered:
  `https://arxiv.org/abs/2409.04701`.
- AG-UI provides the existing stream of lifecycle, tool-call, tool-result, and
  state events; page-aware PDF reading should stay on the same `/agui/relay`
  stream: `https://docs.ag-ui.com/sdk/js/core/events`.
- Microsoft Agent Framework tool descriptions should expose the new optional
  `read` arguments clearly while keeping the model loop generic:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`.
- OpenCode remains the model-facing tool-contract reference, so this work
  extends `read` rather than adding a Relay-specific `pdf_review` tool:
  `https://opencode.ai/docs/tools/`.

Implementation plan:

1. **Extend `read` with page-aware PDF options**
   - Add optional `mode`, `pageStart`, and `pageEnd` arguments to `read`.
   - For PDF files, `mode=map` returns a compact page map: page number,
     extractable character count, and a short preview.
   - Normal `read` with `pageStart`/`pageEnd` returns only that page range,
     with page markers preserved.
   - Keep plaintext, Office, and code reads unchanged.

2. **Use PdfPig for primary PDF extraction**
   - Use PdfPig for page count and page text extraction in the .NET sidecar.
   - Keep the existing lightweight PDF operator parser as a fallback only when
     PdfPig cannot open a PDF; report the warning explicitly.
   - Preserve the current text-layer-only boundary. Image-only/OCR-needed pages
     remain limitations, not inferred content.

3. **Return a correspondence-preserving PDF projection**
   - Add `RelayPdfReadProjection.v1` inside the existing `read` observation.
   - Include page count, returned page range, suggested page window, page
     previews, chunk-plan suggestions, next-page range, limitations, and
     guidance for two-PDF alignment.
   - For two-PDF comparison, Copilot must read `mode=map` for both PDFs, align
     sections/pages using headings, previews, names, dates, and numbers, then
     read matching `pageStart`/`pageEnd` ranges from both files before reporting
     inconsistencies.
   - Do not compare arbitrary chunk N in file A to arbitrary chunk N in file B
     when maps show different structures.

4. **Update prompts and Workbench PDF drafts**
   - Agent Framework, Copilot projection, and Workbench starter drafts should
     tell Copilot how to use page maps and page ranges.
   - Keep final answers grounded in extracted snippets and page ranges.
   - Fail visibly on missing text extraction instead of inventing OCR results.

5. **Add verification and release coverage**
   - Extend the Office/PDF read smoke with a generated multi-page PDF, `mode=map`
     read, and targeted page-range read.
   - Extend the PDF UX smoke so it guards against losing the page-aware prompt,
     extraction, and observation projection.
   - Update README, portable front-door text, implementation log, package
     version, release inventory, checksums, and GitHub release assets.

Acceptance criteria:

- `read` on a long PDF can return a page map without reading the whole file into
  Copilot context.
- `read` on a PDF can return a selected page range with page markers.
- `read` observations include `RelayPdfReadProjection.v1` for PDFs with page
  count, suggested windows, and alignment guidance.
- Two-PDF comparison prompts preserve document-to-document correspondence by
  mapping both PDFs first and then reading matching ranges.
- No new PDF-specific backend mode, runner, or model-visible tool is added.
- `pnpm check`, portable package creation, optional installer creation,
  release inventory, and GitHub release generation pass.

### 2026-05-18 OpenCode-Style Generic Harness Reset Plan

This plan resets the remaining Relay-specific search behavior. Recent manual
tests showed that files that were previously easy to find can be missed because
Relay still forces a narrow first `glob` pattern and still contains
DCI/search-specific recovery paths. That is the wrong direction for the current
product. Search, Office editing, and coding must be common recipes over the
same generic tool catalog, not separate Relay-owned engines.

Reference sources checked for this plan:

- OpenCode documents a simple built-in tool surface for workspace agents:
  `bash`, `edit`, `write`, `read`, `grep`, `glob`, `apply_patch`, and
  `question`, with permissions layered around those tools rather than a
  separate search runtime: `https://opencode.ai/docs/tools/`.
- OpenCode agents are specialized by prompt, permissions, and tool access, not
  by changing the model-visible local tool substrate:
  `https://opencode.ai/docs/agents/`.
- AG-UI is an event-based agent/frontend protocol for messages, state, tool
  calls, and user interaction, so the Workbench should keep one AG-UI stream
  rather than separate Relay run modes:
  `https://docs.ag-ui.com/introduction` and
  `https://docs.ag-ui.com/concepts/events`.
- CopilotKit's `CopilotChat` examples use a bounded chat container with the
  prebuilt chat surface as the primary UI object:
  `https://docs.showcase.copilotkit.ai/pydantic-ai/prebuilt-components/chat`.
- CopilotKit's AG-UI backend docs confirm that messages, state updates, tool
  calls, and lifecycle events flow through AG-UI events:
  `https://docs.showcase.copilotkit.ai/mastra/backend/ag-ui`.

Goal:

> Make Relay feel like a normal OpenCode-style local agent harness controlled
> by M365 Copilot: Copilot chooses generic tools, Relay validates and executes
> them, and the Workbench renders the AG-UI conversation as a normal chatbot.

Non-goals:

- Do not reintroduce OpenCode/OpenWork as the runtime.
- Do not revive `RelayDocumentSearch*`, SQLite/FTS, vector search, or
  document-search-specific planners.
- Do not add more domain-specific query expansion, DCI recovery, or
  business-term exception tables to fix individual examples.
- Do not make search, Office editing, or coding separate UI modes.

Harness changes:

1. **Remove forced narrow first search**
   - Stop converting a file-search request into an automatic
     `glob **/*{firstToken}*` before Copilot has chosen a tool.
   - Keep automatic first tools only where they are exact, low-risk
     inspection steps: exact file `read`, Office outline/capability
     inspection, and `workspace_status` for code/verification.
   - If Copilot tries to answer before any required local observation, fail
     through the normal Agent Framework/AG-UI error path instead of silently
     injecting a Relay search heuristic.

2. **Simplify model guidance to OpenCode-style loops**
   - Tell Copilot to use `glob` for filename/path discovery, `grep` for
     text search, `read` for exact candidates, `officecli`/`officecli_mutate`
     for Office files, `edit`/`write`/`apply_patch` for file mutation, and
     bounded `bash` only for verification.
   - Remove hidden-retriever, business-concept, guide/glossary, and decoy
     instructions from the primary prompt projection. Copilot should iterate
     from observations, not follow a Relay-owned search recipe.
   - Keep only cross-cutting safety rules: visible tools only, exact paths
     from observations, no invented execution, mutations require tool results
     and approval.

3. **Remove hidden search recovery**
   - Disable protocol-guard repairs that replace premature finals or
     invented reads with DCI-specific `grep` calls.
   - Let invalid finals fail fast when the admissible action envelope does
     not allow final answers.
   - Let malformed or non-existent `read` targets flow through tool validation
     and tool observations where safe, so Copilot can recover using the same
     generic tools instead of Relay choosing a recovery search.

4. **Keep Office and code generic**
   - Office edits remain semantic Relay-owned operations compiled to
     OfficeCLI argv by Relay, because raw argv from Copilot is unsafe.
   - Coding remains OpenCode-style workspace mutation with `read` before
     edit, exact path preservation, approval-gated mutation, and verification
     through generic tools.

5. **Make the UI a conventional AG-UI/CopilotKit chatbot**
   - Keep `CopilotChat` as the dominant surface.
   - Reduce Relay-specific framing around the chat to a compact header,
     status pill, workspace picker, inline approvals, and collapsed support.
   - Use neutral colors, generous but not scattered whitespace, and avoid
     dashboard-like Activity/Result panels or separate modes.

Acceptance:

- No code path forces `bounded_file_discovery_before_final` or
  `fallback_bounded_discovery_before_final`.
- Prompt projection no longer contains `biling_retriever`, vector search
  suggestions, or DCI/domain-specific search examples.
- File search, Office editing, and coding use the same model-visible generic
  catalog through Agent Framework and AG-UI.
- `pnpm check` passes.
- A Windows user-scope installer and archives are produced for the next
  release.

### 2026-05-18 OpenCode Loop Continuation And Office Integrity Plan

This plan addresses the latest live Workbench failures while continuing the
OpenCode-compatible direction instead of reviving a document-search engine or a
Relay-owned Office planner.

Observed failures:

- A search for `繰延ヘッジ損益に関するファイルはある？` ran one `glob`, found
  zero filename candidates, then finalized with a suggestion to run `grep`
  later. In an OpenCode-style harness, a visible tool loop should continue from
  the empty observation and try content search or another visible generic tool
  before terminal output.
- An Office request, `Book2.xlsx のA1セルを赤くして`, reported
  `officecli_mutate` success, but Excel later rejected the workbook as an
  invalid file format. A mutation success must mean the real Office package can
  still be opened, not only that the OfficeCLI process exited successfully.

Reference sources checked for this plan:

- OpenCode exposes `glob`, `grep`, `read`, `edit`, `write`, `apply_patch`,
  `bash`, and `question` as the model-facing local tools, with permissions
  wrapped around the tools rather than separate domain-specific runtimes:
  `https://opencode.ai/docs/tools/`.
- OpenCode agents specialize behavior through prompts, permissions, and tool
  access, while the underlying tool loop stays common:
  `https://opencode.ai/docs/agents/`.
- AG-UI models tool calls as streamed lifecycle events (`ToolCallStart`,
  argument chunks, and `ToolCallEnd`) and lifecycle completion/error events, so
  continuation and failure should be visible in the same run stream:
  `https://docs.ag-ui.com/concepts/events`.
- Microsoft Agent Framework supports human-in-the-loop approval for function
  tools, which matches Relay's approval-gated mutation path:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`.

Goal:

> Keep one generic OpenCode-style agent loop: Copilot chooses visible tools,
> Relay executes them, tool observations update terminal eligibility, and final
> answers are allowed only when the generic loop has enough evidence or has
> actually exhausted the relevant visible tool family.

Harness changes:

1. **Empty-discovery continuation gate**
   - Track successful but empty `glob` and `grep` observations in the generic
     turn ledger.
   - If a local file-search turn has only an empty filename `glob` and no
     content search or `read` attempt, keep the admissible action envelope in
     `NeedsObservation` and keep `final` forbidden.
   - Do not inject a hidden business search. Copilot must choose a visible
     generic next tool (`grep`, broader `glob`, or exact `read`) from the
     normal AG-UI/Agent Framework loop.
   - Permit final output only after at least one follow-up visible search/read
     observation exists, even if that observation is also empty.

2. **Prompt alignment**
   - Strengthen Agent Framework and Copilot projection instructions so
     `glob -> final` after zero candidates is invalid for local file-search
     requests.
   - Keep the instruction generic: no `繰延ヘッジ`, CFS, DCI, or department
     exception tables.
   - Keep `ask_user` forbidden when the objective and workspace are already
     known.

3. **Office package integrity gate**
   - After every approved Office mutation, verify both OfficeCLI `view outline`
     and the actual OpenXML ZIP package structure for `.xlsx`, `.xlsm`,
     `.docx`, and `.pptx`.
   - For Excel packages, require `[Content_Types].xml`, `_rels/.rels`,
     `xl/workbook.xml`, and at least one `xl/worksheets/*.xml` entry.
   - If package verification fails after a mutation, restore the backup before
     returning the tool result and report a failed `officecli_mutate`
     observation. Do not let a corrupt workbook be reported as success.
   - Include the verification result in the tool observation so Copilot can
     explain whether the mutation was applied or rolled back.

4. **Regression coverage**
   - Extend protocol-state smokes so a premature final after an empty filename
     `glob` is rejected by the admissible action envelope.
   - Add Office integrity verification coverage for the package validator path.
   - Keep `pnpm check` as the canonical gate before release.

Acceptance:

- A single zero-candidate `glob` no longer makes `final` admissible for
  file-search turns.
- The prompt projection tells Copilot to continue with visible generic tools
  after empty filename search instead of suggesting that the user ask for
  `grep`.
- Office mutation success requires process success, OfficeCLI outline
  verification, and OpenXML package integrity verification.
- If Office package integrity fails, the original file is restored from backup
  and the AG-UI run receives a failed tool observation.
- `pnpm check` passes and release artifacts are produced for the next version.

### 2026-05-18 CopilotKit Chat Layout Density Plan

This plan refines the CopilotKit chatbot reset after reviewing CopilotKit usage
examples and the current Workbench screenshots. The product direction remains a
normal CopilotKit chatbot, but the first reset left the shell, workspace row,
history chips, chat card, and support block too far apart. The fix is to keep
the official CopilotKit chat surface as the main visual object and make Relay's
surrounding chrome compact, aligned, and secondary.

Reference sources checked for this plan:

- CopilotKit prebuilt chat examples show `CopilotChat` rendered as the primary
  pane inside a bounded container, with little surrounding chrome:
  `https://docs.showcase.copilotkit.ai/pydantic-ai/prebuilt-components/chat`.
- CopilotKit AG-UI docs confirm messages, tool calls, state updates, and run
  lifecycle flow through AG-UI events:
  `https://docs.showcase.copilotkit.ai/mastra/backend/ag-ui`.
- CopilotKit HITL examples keep approval UI inline with the agent interaction
  instead of moving it into a separate dashboard:
  `https://www.mintlify.com/CopilotKit/CopilotKit/examples/human-in-the-loop`.
- CopilotKit v2 component contracts in `@copilotkit/react-core@1.57.1` and
  `@copilotkit/react-ui@1.57.1` confirm that Relay can keep the self-managed
  AG-UI agent and tune layout with container CSS rather than replacing the
  component internals.
- The local `ui-ux-pro-max` design-system search recommends an AI-native,
  minimal single-column chatbot surface with restrained controls, visible focus
  states, and compact context cards.

Goal:

> Keep the CopilotKit-first chatbot, but reduce unnecessary vertical separation
> so the Workbench reads as one cohesive chat application.

Layout decisions:

1. **Compact Relay chrome**
   - Reduce shell top/bottom padding and header spacing.
   - Keep `Relay Agent`, `Chat`, readiness, and workspace selection visible,
     but visually subordinate to the chat.
   - Keep the workspace picker in the normal flow and close to the chat input
     context, not as a large dashboard section.

2. **Remove redundant workspace history noise**
   - Do not render the currently selected workspace as a history chip.
   - Show recent workspaces only when they are genuinely alternate choices.
   - Keep the hidden `#workspace-path` contract for tests and sidecar state.

3. **Give CopilotKit a stable compact chat viewport**
   - Replace oversized `min-height: 76vh` behavior with a bounded chat height
     that fits the visible viewport after header/workspace chrome.
   - Let CopilotKit own message rendering, scrolling, composer placement, and
     HITL cards inside that viewport.
   - Keep tool and approval cards compact enough that they feel like chat
     events rather than separate panels.

4. **Tighten E2E acceptance**
   - Add layout-density assertions for header-to-workspace gap,
     workspace-to-chat gap, chat height, and hidden current-workspace history.
   - Continue asserting no legacy mode labels, no old composer, collapsed
     support diagnostics, and responsive no-overflow behavior.

5. **Acceptance**
   - Desktop screenshots show the chat card above the fold with a compact
     header/workspace area.
   - The selected workspace does not duplicate as a history chip.
   - The Workbench still uses CopilotKit + AG-UI `/agui/relay`; no custom
     transcript or mode-specific UI is reintroduced.
   - `pnpm workbench:ux-e2e` and `pnpm check` pass.

### 2026-05-18 CopilotKit Chatbot UX Reset Plan

This plan resets the Workbench UX from a Relay-specific workbench layout into a
standard chatbot experience built on CopilotKit. The current custom composer,
result panel, activity panel, and approval panel no longer match the desired
product direction. The new surface should feel like a normal professional
assistant: one chat transcript, one input, one workspace selector, and inline
approval when a local mutation needs confirmation.

Reference sources checked for this plan:

- CopilotKit v2 React package contracts in `@copilotkit/react-core@1.57.1`:
  `CopilotKitProvider`, `CopilotChat`, `CopilotChatConfigurationProvider`,
  `selfManagedAgents`, `humanInTheLoop`, and `useHumanInTheLoop`.
- AG-UI client package contract in `@ag-ui/client@0.0.53`: `HttpAgent`,
  `RunAgentInput`, state, context, and forwarded props.
- UI design reference from the local `ui-ux-pro-max` design-system search:
  minimal single-column AI-native chatbot surface, Inter/system typography,
  generous whitespace, subdued controls, visible focus, and no diagnostic-first
  chrome.

Goal:

> Replace the custom Relay Workbench UI with a CopilotKit-first chatbot while
> preserving Relay's existing Agent Framework + AG-UI + M365 Copilot sidecar.

Architecture:

1. **CopilotKit is the Workbench UI layer**
   - Use `@copilotkit/react-core/v2` and CopilotKit v2 styles for the active
     chat surface.
   - Render `CopilotChat` as the primary UI instead of the custom Relay
     composer, summary, activity list, and separate approval panel.
   - Keep the visual shell minimal: title, readiness pill, workspace selector,
     chat, and a collapsed support export.

2. **Relay remains the local execution and governance layer**
   - Do not use CopilotKit Cloud or a separate CopilotKit runtime endpoint.
   - Connect CopilotKit to the existing `/agui/relay` endpoint through
     `selfManagedAgents` and an AG-UI `HttpAgent`.
   - Inject the selected workspace into AG-UI `state`, `context`, and
     `forwardedProps` for every run so the sidecar's Agent Framework runner
     still receives the same local execution boundary.

3. **Approvals move to CopilotKit HITL**
   - Register `request_approval` as a CopilotKit human-in-the-loop tool.
   - Render mutation approval inline in the chat transcript with clear
     "実行する" and "実行しない" actions.
   - Let CopilotKit/AG-UI carry the resume message instead of maintaining a
     parallel custom Relay approval panel.

4. **No legacy UI fallback**
   - Remove the custom run/activity-first Workbench path as the primary user
     experience.
   - Do not reintroduce AionUi, Tauri, OpenWork/OpenCode runtime, or
     document-search-specific UI modes.
   - Keep diagnostics collapsed and exportable; the default surface should be a
     regular chatbot.

5. **Acceptance**
   - The page first reads as a normal chat application, not a diagnostic
     console.
   - Workspace selection remains native and visible before sending local tasks.
   - Readiness remains visible but not dominant.
   - Search, Office editing, and coding requests all enter through the same
     chat input.
   - Local mutations still require explicit approval.
   - `pnpm check` and Workbench UX E2E pass after the reset.

### 2026-05-18 Browser Session Lifecycle And Installer Lock Plan

This plan fixes the remaining installer-lock class of failures at the source.
The `0.3.7` versioned-payload installer prevents a running
`Relay.Sidecar.exe` from blocking package copy, but it does not prevent the old
sidecar process from living indefinitely after the browser Workbench tab is
closed. The historical stable Tauri line avoided many of these locks because
the desktop process owned child lifetime through the Windows process tree/job
relationship. The active browser-hosted architecture needs an explicit browser
session lease instead.

Goal:

> A sidecar launched for the installed Workbench should shut itself down after
> the last Workbench browser tab disappears, while developer/test sidecars stay
> stable unless idle-exit is explicitly enabled.

Architecture:

1. **Workbench session lease**
   - The Workbench creates a per-tab/session `clientId`.
   - It posts an immediate heartbeat and then sends periodic heartbeats while
     the tab is alive.
   - It sends a best-effort `pagehide`/`beforeunload` close beacon when the tab
     closes or navigates away.
   - This is invisible UI plumbing. It must not add new controls or diagnostic
     clutter to the minimal Workbench surface.

2. **Sidecar lifecycle monitor**
   - The sidecar records active Workbench clients, their last heartbeat time,
     active HTTP requests, and recent request activity.
   - When idle-exit is enabled, the sidecar stops itself after:
     - startup grace has elapsed;
     - no fresh Workbench client lease remains;
     - no local request is in flight;
     - the configured quiet period has elapsed.
   - Heartbeat expiry covers browser/process crashes where the close beacon is
     not delivered.

3. **Launcher-owned production policy**
   - The launcher enables idle-exit for installed/browser-launched sessions
     with conservative timeouts.
   - Direct `dotnet run`, smoke tests, and development sessions do not enable
     idle-exit by default. They may opt in with environment variables.
   - This avoids flaky development runs while making normal installed use
     self-cleaning.

4. **No fallback runtime**
   - Do not reintroduce Tauri, AionUi, OpenCode/OpenWork, or a background
     updater just to handle process lifetime.
   - Do not depend on the installer killing processes as the primary lifecycle
     mechanism. Installer preflight remains best-effort cleanup.

Environment contract:

- `RELAY_ENABLE_IDLE_EXIT=1` enables sidecar idle shutdown.
- `RELAY_DISABLE_IDLE_EXIT=1` disables it and wins over enable.
- `RELAY_IDLE_EXIT_MS` controls the post-idle quiet period.
- `RELAY_IDLE_STARTUP_GRACE_MS` controls the initial no-client grace window.
- `RELAY_IDLE_HEARTBEAT_TTL_MS` controls stale client expiry.

Acceptance:

- Closing the browser Workbench tab lets the installed sidecar exit without the
  user needing Task Manager.
- A failed close beacon still exits after heartbeat TTL plus quiet period.
- Existing development and smoke commands do not unexpectedly stop sidecars.
- The Windows installer remains per-user and continues to avoid locked-file
  overwrite failures.
- The behavior is covered by a deterministic sidecar idle-exit smoke test and
  documented in the packaging policy and implementation log.

### 2026-05-18 Tool Projection Harness Remediation Plan

This plan addresses the latest live Workbench results without reviving a
dedicated document-search engine, custom Office-edit mode, AionUi, OpenWork, or
Tauri. The failures are projection-harness failures:

- Copilot suggested an unavailable retriever after local search observations
  instead of staying inside the visible Agent Framework/OpenCode-compatible
  tool catalog.
- Copilot sometimes renders JSON-like output through non-text UI surfaces.
- Office editing produced natural but unsupported semantic arguments
  (`operation=format`, `Sheet1/A1` variants, `fill=red`) that Relay rejected
  after approval instead of normalizing into the supported OfficeCLI `set`
  contract before approval.

Goal:

> Keep the product generic and framework-native: Copilot chooses from the
> current tool catalog, Microsoft Agent Framework/AG-UI carry the tool and
> approval lifecycle, and Relay performs only narrow provider/tool adapters.

Implementation plan:

1. **Projection prompt hardening**
   - Keep the single compiler prompt shape and the Agent Framework tool list.
   - Require JSON as selectable text in one fenced `json` block; explicitly
     disallow images, cards, canvases, screenshots, or attachments for JSON.
   - Forbid final answers from recommending unavailable local tools or
     hidden retrievers. If a capability is not in the visible `Tools:` list,
     Copilot must not name it as the next step.
   - For local file search, guide Copilot to use OpenCode-style generic tools:
     `glob` for candidate files, `read` for exact Office/PDF/document
     candidates, and `grep` for plaintext/code content. Do not conclude
     "not found" from grep-only evidence when file candidates still exist.
   - For Office cell formatting, guide Copilot to emit semantic
     `officecli_mutate` fields (`operation=set` or `set_cell_fill`, `filePath`,
     `sheet`, `cell`, `fill`) instead of raw argv or unsupported operations.

2. **Protocol/final-answer guard**
   - Preserve Agent Framework final answers as the terminal path.
   - Add a narrow terminal validation rule: a final answer must not advertise
     unavailable local tool names such as retrievers or vector-search tools
     unless those tools are in the visible catalog. This is a harness
     admissibility rule, not a search-ranking rule.
   - Continue to fail fast or route back to an admissible local tool rather
     than silently falling back to a weaker planner.

3. **Semantic OfficeCLI normalization**
   - Keep Copilot away from raw OfficeCLI argv.
   - Normalize common semantic Office requests into OfficeCLI's existing `set`
     operation:
     - `format`, `cell_format`, `set_format`, `format_cell`, and
       `set_cell_format` become `set`.
     - `worksheet`, `worksheetName`, `tab`, `cellAddress`, `rangeAddress`,
       `Sheet1!A1`, and `Sheet1/A1` normalize to OfficeCLI targets such as
       `/Sheet1/A1`.
     - Human color names such as `red`/`赤` normalize to OfficeCLI color hex
       values such as `FF0000`.
     - Object-shaped color properties such as `{ "color": "red" }` normalize
       to scalar `fill=FF0000` where the semantic operation is cell fill or
       formatting.
   - Keep approval before mutation, backups after approval, and verification
     after mutation.

4. **Regression coverage**
   - Extend the OfficeCLI registry smoke so natural Copilot-style formatting
     output pauses for AG-UI approval without leaking raw argv and without
     executing before approval.
   - Extend the choice-error smoke so prompt dumps prove JSON image/canvas
     output and unavailable retriever suggestions are forbidden.
   - Keep `pnpm check` as the release gate.

Acceptance:

- A request such as `"C:\\Users\\...\\Book2.xlsx"のSheet1のA1セルを赤くして`
  produces a single approved `officecli_mutate` proposal using OfficeCLI `set`
  semantics, not unsupported `format`, invalid target paths, or invalid color
  values.
- Search final answers do not recommend hidden tools such as
  `biling_retriever`; they either continue with visible tools or report only
  the evidence gathered from visible tools.
- Copilot JSON projection instructions explicitly require text-only fenced
  JSON and reject image/card/canvas JSON rendering.
- `pnpm check` passes before release.

### 2026-05-18 Installer Defaults, Workspace Picker, And Search Path Contract Plan

This plan fixes the installed-app usability regressions reported against the
browser Workbench path: the installer should default to creating a desktop
shortcut and launching Relay after setup, the Windows launcher must not show a
console window, the workspace chooser should feel modern and support shared
folders, and a path returned by `glob` must be immediately readable by `read`.

Goal:

> A normal Windows user install should leave Relay visible on the desktop,
> launch it at the end of setup, open without a console window, allow shared
> folder selection through a modern picker, and avoid false failed `read`
> events after successful file discovery.

Implementation plan:

1. **Installer defaults**
   - Make the desktop shortcut component selected by default while still
     allowing the user to uncheck it.
   - Add the NSIS finish-page run checkbox and keep it checked by default.
   - Launch the versioned `AppDir` registered during install so the finish page
     starts the same payload as Start Menu and desktop shortcuts.
   - Keep the installer per-user with `RequestExecutionLevel user`; do not add
     admin prompts or machine-wide registry writes.

2. **No launcher console**
   - Build `Relay.Launcher` as a Windows GUI subsystem executable for packaged
     Windows releases.
   - Keep sidecar stdout/stderr redirected and hidden.
   - Preserve Linux/package behavior through the same launcher project rather
     than adding a second launcher runtime.

3. **Modern workspace chooser**
   - On Windows, prefer the native `IFileOpenDialog` folder picker with
     `FOS_PICKFOLDERS`, `FOS_FORCEFILESYSTEM`, and `FOS_PATHMUSTEXIST`.
   - Keep the current workspace as the initial folder when it still exists.
   - Support UNC/network/shared folders through the dialog address bar.
   - Keep the PowerShell picker only as a bounded compatibility fallback when
     the native dialog cannot be created.
   - Keep the Workbench surface minimal: one compact workspace chip and one
     folder-selection action, with recovery after cancellation or timeout.

4. **Search path contract**
   - `glob` must return workspace-relative display paths that are valid inputs
     to `read`, even when `glob` runs from a searched subfolder.
   - `read`/`edit` validation and execution must share the same resolver.
   - Existing files inside the workspace should resolve case-insensitively on
     Windows and should tolerate exact display paths returned by prior tools.
   - If a model supplies a stale absolute-looking path, Relay may perform a
     bounded unique path-tail recovery inside the workspace instead of emitting
     a false first failure.

Acceptance:

- The generated NSIS script contains a default desktop shortcut section and a
  default finish-page run action.
- `Relay.Launcher` packages without a Windows console subsystem.
- Workspace picker smoke continues to pass, and the source uses the native
  Windows folder picker before the compatibility fallback.
- A `glob` result can be passed directly to `read` without producing an
  avoidable `file_path does not exist` event.
- `pnpm check` passes before release.

### 2026-05-18 Installed Workbench Responsiveness Plan

This plan fixes the `0.3.8` installed-app regression where the Workbench can
feel slow to become usable, can remain visually stuck on a stale readiness
state even though `/api/status` is already `ready: true`, and can leave the
workspace picker action disabled while a native picker is hidden or stuck.

The support bundle reported:

```json
{
  "app": "Relay Agent",
  "version": "0.3.8",
  "ready": true,
  "checks": [
    { "name": "ripgrep", "ready": true, "required": true },
    { "name": "officecli", "ready": true, "required": false },
    { "name": "copilot-cdp", "ready": true, "required": true }
  ]
}
```

That means the provider and local tools can be ready while the Workbench chrome
is still stale. The fix belongs in the active Workbench/sidecar path, not in an
installer fallback or a mode-specific runner.

Goal:

> The installed Workbench should paint quickly, automatically become Ready when
> the sidecar does, and always recover the workspace picker button after native
> picker cancellation, hidden-dialog failure, or timeout.

Implementation plan:

1. **Readiness auto-refresh**
   - Keep the manual readiness pill refresh, but add automatic polling while
     readiness is `Checking`, `Connecting`, or any non-ready state.
   - Poll on window focus and when the tab becomes visible.
   - Stop high-frequency polling once `Ready` is reached, but keep a low-cost
     refresh path for manual support inspection.

2. **Fast first status**
   - Make `/api/status` avoid blocking the whole response on optional OfficeCLI
     smoke checks.
   - Run required checks in parallel.
   - Start OfficeCLI readiness in the background and return a non-required
     warming-up check until the result is cached.
   - `ready` should reflect required readiness (`ripgrep` and `copilot-cdp`),
     not optional Office smoke latency.

3. **Workspace picker reliability**
   - On Windows, run the PowerShell folder picker in STA mode when using
     Windows PowerShell.
   - Give the folder dialog a topmost owner form so it does not appear behind
     Edge.
   - Keep the UI button in a clear `選択中...` state while the native picker is
     open.
   - Add a bounded frontend timeout and keep server-side process cancellation
     wired so a hidden or stalled picker cannot leave the button disabled
     indefinitely.

4. **Verification**
   - Extend Workbench UX E2E to assert:
     - readiness auto reaches `Ready`;
     - workspace change button is enabled before selection;
     - workspace picker completes and re-enables the button.
   - Keep `pnpm check` as the release gate.

Acceptance:

- Installed Workbench no longer requires clicking the readiness pill to turn
  `Ready` after Copilot is already connected.
- Workspace selection works from a native file explorer/folder picker and the
  button cannot remain disabled indefinitely.
- Optional OfficeCLI smoke cannot delay the initial `Ready` state.
- No legacy AionUi/Tauri/OpenCode/OpenWork path is reintroduced.

### 2026-05-18 Minimal Professional Workbench UX Plan

This plan defines the visual and interaction direction for the active browser
Workbench. It does not change the architecture decision above: the Workbench
remains one AG-UI-first agent surface over Microsoft Agent Framework and the
OpenCode-compatible local tool catalog. File search, Office work, coding, and
verification are common task recipes over that generic agent surface, not
separate product modes.

Goal:

> Maximize whitespace, remove nonessential controls, and make Relay feel like a
> quiet professional local workbench rather than a diagnostic console or a mode
> picker.

#### Design Principles

1. **One primary surface**
   - The first viewport should contain only the essential work context:
     workspace, task composer, run state, and the current answer/approval area.
   - Do not bring back `資料を探す`, `Officeファイルを編集する`, or
     `コードを書く` as primary mode tabs or cards.

2. **Whitespace as structure**
   - Use generous outer margins, a constrained reading width, and clear
     vertical rhythm instead of dense borders and nested panels.
   - Prefer full-width calm bands and unframed layouts. Use cards only for
     repeated result items, approvals, and compact tool events where framing
     improves scanability.

3. **Progressive disclosure**
   - Final answer, required approval, and the latest meaningful status are
     visible by default.
   - Tool traces, raw AG-UI events, JSON diagnostics, support data, and detailed
     run metadata are collapsed behind explicit detail controls.
   - Diagnostics must never be the default visual impression of a normal run.

4. **AG-UI-native interaction model**
   - Render lifecycle, message, tool, state, interrupt/resume, approval, error,
     and completion events through the `/agui/relay` AG-UI contract.
   - Avoid custom Workbench-only run concepts when AG-UI already has an event or
     interaction pattern that fits.

5. **Professional minimal visual language**
   - Use React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Radix UI +
     `@ag-ui/client` with lucide-react icons.
   - Use a restrained neutral palette with one quiet accent. Avoid decorative
     gradients, orbs, bokeh, one-note purple/blue themes, and marketing-style
     hero composition.
   - Use Inter or the system sans stack. Body copy should stay compact and
     legible; no viewport-scaled typography and no negative letter spacing.

6. **Purposeful controls**
   - Keep only controls needed for the current run: workspace selection, task
     input, send/stop, approval accept/reject, copy/open/diff where applicable,
     and explicit support export.
   - Remove AionUi-era and diagnostic-first controls from the default surface:
     web UI buttons, rating/reaction buttons, globe/star/chat-bubble controls,
     unused settings buttons, mode shortcuts, and always-visible runtime chips.
   - Prefer icon buttons with accessible labels for secondary actions and
     text+icon buttons for primary commands.

7. **Calm run states**
   - Idle, running, waiting for Copilot, awaiting approval, applying changes,
     failed, and complete states must be visually distinct without large blocks
     of explanatory text.
   - Errors should be short, specific, and actionable, with diagnostics available
     only through details/support export.

8. **Approval clarity without clutter**
   - Mutations must show a concise summary, target path, risk, backup/diff
     availability, and clear approve/reject actions.
   - Approval UI may interrupt the flow, but should not become a modal-heavy
     or wizard-like experience.

9. **Responsive and accessible by default**
   - Check 375px, 768px, 1024px, and 1440px layouts.
   - Text must not overlap or overflow controls. Fixed-format UI elements need
     stable dimensions.
   - Preserve visible focus states, keyboard navigation, WCAG contrast, and
     `prefers-reduced-motion`.

#### Implementation Shape

1. Inventory current Workbench chrome and remove/relocate every control that is
   not needed for normal task execution.
2. Define a small Workbench design token layer: spacing, max widths, surface
   colors, borders, focus rings, typography, icon sizes, and state colors.
3. Rebuild the shell around one composer and one run surface:
   workspace selector, task input, primary send/stop action, compact status,
   answer/approval area, and progressive trace details.
4. Convert run output to a compact AG-UI timeline:
   final answer first, then meaningful tool events, approvals, diffs, and
   verification details on demand.
5. Create minimal approval/diff components that can handle file edits,
   OfficeCLI mutations, and bounded bash verification without separate modes.
6. Add visual regression and UX E2E coverage for idle, running, approval,
   error, completion, long trace, and mobile layouts.

#### Acceptance Criteria

- The first viewport presents a single calm workbench, not a dashboard, landing
  page, mode picker, or diagnostic console.
- A user can submit a natural-language task without choosing a feature mode.
- Normal successful runs show the final answer and a short trace summary; raw
  JSON and diagnostics are hidden by default.
- Mutation runs make approval requirements unmistakable without adding extra
  permanent chrome.
- No AionUi-era, OpenCode/OpenWork-era, or old diagnostic buttons are visible in
  the default Workbench.
- `pnpm workbench:ux-e2e` verifies the visible user flows.
- `pnpm check` remains the milestone acceptance gate.

### 2026-05-18 Installed App Startup, Icon, And Readiness Remediation Plan

This plan addresses the installed `0.3.4` regression reported from Windows:

- the previous app icon disappeared;
- the app takes too long to feel ready after launch;
- the Workbench opens with `Not ready`;
- Support shows `copilot-cdp` as required and missing with
  `Set RELAY_COPILOT_CDP_PORT to a signed-in Edge CDP port.`

This is a product-startup regression, not a reason to revive Tauri, AionUi,
OpenCode/OpenWork, or feature-mode UI. The fix is to port the stable parts of
the old desktop Copilot/packaging behavior into the current .NET sidecar and
browser Workbench architecture.

#### Stable Implementation References

Reference points from the older stable line:

- Commit `40622c03d049f89e9b2501a39b88eb796c298912` kept the robust Copilot
  CDP bridge in the old desktop path. It had:
  - dedicated Edge profile management;
  - standard Windows Edge path resolution;
  - CDP port attachment and launch behavior;
  - prompt/composer readiness checks;
  - retry/diagnostic classifications around Copilot UI failures.
- The old Tauri bundle declared app icons in
  `apps/desktop/src-tauri/tauri.conf.json` and shipped icon assets under
  `apps/desktop/src-tauri/icons/`, including `icon.ico` and the source SVG.
- The old stable workspace selector used
  `apps/desktop/src/lib/workspace-picker.ts`, which delegated folder selection
  to the native desktop dialog with `directory: true` and `multiple: false`.
  The useful behavior is the native folder-picking interaction, not the Tauri
  runtime.
- Historical implementation notes around 2026-05-15/2026-05-16 document fixes
  that still matter:
  - reject stale `DevToolsActivePort` files unless `/json/version` responds as
    Microsoft Edge;
  - prefer `https://m365.cloud.microsoft/chat` over DNS-fragile entry points;
  - reject DNS/error pages and upsell/sign-in pages as not usable Copilot;
  - use a dedicated Relay Edge profile and preserve sign-in across launches;
  - avoid opening Edge before the Workbench becomes visible.

Current regression cause:

- `apps/launcher/Relay.Launcher.csproj` has no `ApplicationIcon`, and the NSIS
  script does not set `Icon`, `MUI_ICON`, `MUI_UNICON`, or shortcut icon
  parameters. The launcher therefore shows a generic executable icon.
- `apps/launcher/Program.cs` starts only the sidecar and opens the Workbench.
  It does not start or attach to the Copilot Edge CDP session.
- `CopilotTransportFactory.FromEnvironment()` returns `MissingCopilotTransport`
  unless `RELAY_COPILOT_CDP_PORT` is already set. That is acceptable for
  developer scripts, but not for an installed end-user app.
- `/api/status` exposes this missing developer environment variable directly,
  which makes a normal installed launch look broken.
- `apps/workbench/src/App.tsx` currently asks the user to type the workspace
  path manually. That is fragile on Windows network/share paths and makes the
  first-run experience feel like a developer tool instead of a polished local
  workbench.

#### Product Decision

The installed app must manage Copilot CDP readiness itself.

Relay should not require normal Windows users to set `RELAY_COPILOT_CDP_PORT`.
The launcher/sidecar should auto-attach to a live Relay Edge CDP profile or
start one in the background. The Workbench should paint quickly and show a calm
`Connecting to Copilot` or `Sign in needed` state while warmup proceeds.
`Not ready` should be reserved for hard local execution blockers that the app
cannot resolve or for explicit fail-fast provider errors during a run.

Workspace selection should also be app-managed. Normal users should choose a
folder through the OS file explorer, not type or paste a path. Because the
active shell is a browser Workbench rather than Tauri, the folder picker must be
provided by the .NET sidecar through a narrow local API. The Workbench should
show the selected workspace as a compact path chip with a `Change` action and a
short recent-workspaces list, keeping direct path entry out of the default UI.

#### Remediation Design

1. **Restore app icon without restoring Tauri**
   - Move the old Relay icon assets into an active location such as
     `assets/app-icon/`.
   - Configure `Relay.Launcher.csproj` with `ApplicationIcon` for Windows.
   - Bundle the same `.ico` in the Windows package.
   - Update NSIS to use:
     - `Icon`;
     - `UninstallIcon`;
     - `!define MUI_ICON`;
     - `!define MUI_UNICON`;
     - explicit shortcut icon path for Start Menu and optional Desktop
       shortcuts;
     - uninstall `DisplayIcon` pointing at the launcher or bundled icon.
   - Add a packaging smoke that fails if the icon asset is missing from the
     installer inputs.

2. **Add a sidecar-owned Copilot CDP manager**
   - Introduce a narrow .NET Copilot CDP manager used by
     `CopilotTransportFactory`.
   - Resolution order:
     1. explicit `RELAY_COPILOT_CDP_PORT`, for developer/live E2E override;
     2. live marker file in the Relay Edge profile;
     3. live `DevToolsActivePort` in the Relay Edge profile;
     4. auto-start Microsoft Edge with a Relay-owned profile and remote
        debugging enabled.
   - Use a user-local persistent profile, with compatibility for the legacy
     `RelayAgentEdgeProfile` path so already-signed-in users do not need to
     sign in again unnecessarily.
   - Verify `/json/version` is Microsoft Edge before accepting the port.
   - Reject stale ports and browser error pages.
   - Keep the M365 Copilot provider fail-fast during actual runs: if Copilot is
     unavailable after warmup/sign-in, emit an AG-UI error with diagnostics
     instead of falling back to a weaker planner.

3. **Split first paint from Copilot warmup**
   - The launcher should start the sidecar and open the local Workbench as soon
     as the sidecar URL is ready.
   - Copilot Edge startup/attachment should run in the background.
   - `/api/status` should be quick and cache recent tool readiness results.
   - Optional OfficeCLI smoke should not delay the first visual Workbench paint.
   - Target: Workbench visible within a few seconds on a warm install; Copilot
     readiness may continue asynchronously.

4. **Improve readiness semantics**
   - Replace the single `Ready`/`Limited`/`Not ready` interpretation with
     user-meaningful states while preserving API compatibility:
     - `Ready`: required local tools and usable Copilot are available;
     - `Connecting`: Relay is launching/attaching Edge or checking Copilot;
     - `Sign in needed`: Edge is available but Copilot composer is not usable;
     - `Local tools issue`: ripgrep or another required local executor is
       unavailable;
     - `Provider error`: Copilot failed during an actual run.
   - Do not show developer instructions such as
     `Set RELAY_COPILOT_CDP_PORT...` in the primary Workbench UI.
   - Keep detailed diagnostics in collapsed Support export only.

5. **Keep the UI more minimal, not more explanatory**
   - First viewport: app identity, workspace, composer, send/stop, and a small
     readiness pill only.
   - When Copilot is starting, show one quiet line such as
     `Connecting to Copilot` with no JSON or troubleshooting text.
   - If sign-in is needed, show one sparse action row: `Open Copilot` and
     `Retry`.
   - Move all detailed checks, ports, paths, and raw JSON under Support.
   - Use even more whitespace around the composer and status surfaces; avoid
     adding setup wizards, banners, mode cards, or persistent diagnostics.
   - Apply the design-system direction from the 2026-05-18 UI/UX review:
     Inter typography, restrained neutral surfaces, high contrast, one quiet
     accent, visible focus states, no decorative gradients/orbs, no playful
     chrome, and enough vertical rhythm that the composer feels intentional
     instead of cramped.

6. **Preserve current architecture boundaries**
   - Do not reintroduce the Tauri desktop shell.
   - Do not reintroduce old AionUi/OpenCode/OpenWork fallback paths.
   - Do not make Copilot optional for agent runs that need reasoning.
   - Do not add a local fallback model.
   - Do not require administrator rights or machine-wide install changes.

7. **Replace manual workspace path entry with a native picker**
   - Add a sidecar-owned `/api/workspace/pick` or equivalent endpoint that opens
     a native folder picker and returns an absolute local path.
   - Use the older stable Tauri picker only as interaction reference:
     directory-only, single selection, current workspace as the default path,
     cancel returns no change.
   - Implement platform-specific picker adapters behind one sidecar interface:
     Windows must use a real File Explorer folder dialog; Linux should use an
     available desktop portal/dialog implementation when present and fail with a
     clear app error when the environment cannot show a picker.
   - Keep any recent-workspace history in user-local Relay storage or browser
     local storage. Never write picker state, caches, or indexes into the
     selected workspace.
   - Workbench default surface should show:
     - a single-line workspace chip with the basename and truncated full path;
     - a compact `Change` button with a folder icon;
     - optional recent workspace chips below only when history exists;
     - no permanent raw path text field.
   - Direct path entry, if retained for developer troubleshooting, must live in
     Support/advanced UI and must not be the normal first-run interaction.

#### Verification

Required deterministic checks:

- packaging/icon smoke: active icon files exist, launcher project references
  the icon, NSIS script uses the icon, and release inventory records it;
- sidecar startup smoke with no `RELAY_COPILOT_CDP_PORT`: status should not
  immediately hard-fail with the developer-only missing-env message;
- Copilot CDP manager unit/smoke cases:
  - explicit port;
  - live marker port;
  - stale marker rejection;
  - stale `DevToolsActivePort` rejection;
  - Edge auto-start command construction;
  - no Edge installed;
  - sign-in/composer missing state;
- Workbench UX E2E:
  - first viewport remains minimal;
  - readiness shows connecting/sign-in states cleanly;
  - workspace selection is driven by the picker action, not a required path
    text field;
  - recent workspace chips are compact and do not dominate the composer;
  - Support diagnostics remain collapsed;
  - no old mode labels or diagnostic-first UI returns.

Required release/live checks before publishing a fix release:

- Windows installer build confirms user-scope install and icon wiring.
- Installed-app or packaged-run smoke on Windows:
  - Start Menu shortcut shows the Relay icon;
  - launcher opens the Workbench quickly;
  - with a signed-in Relay Edge profile, readiness becomes `Ready` without
    setting `RELAY_COPILOT_CDP_PORT`;
  - with no sign-in, the UI shows `Sign in needed`, not raw `Not ready`.
- Signed-in live Copilot E2E when Edge/CDP is available.

### 2026-05-18 User-Scope Installer Locked-File Remediation Plan

This plan addresses the Windows install error reported after the `0.3.5`
release:

```text
error opening file for writing
C:\Users\m242054\AppData\Local\Programs\RelayAgent\Relay.Sidecar.exe
```

This is an installer/update regression, not an application runtime design
change. The active architecture remains the browser Workbench plus .NET
sidecar, with a user-scope NSIS installer. Do not reintroduce Tauri, AionUi,
OpenCode/OpenWork, machine-wide install, administrator elevation, or a second
release track to work around this issue.

#### Current Diagnosis

- The path in the error is the legacy no-space install directory
  `%LOCALAPPDATA%\Programs\RelayAgent`, while the current packaging policy uses
  `%LOCALAPPDATA%\Programs\Relay Agent` for new installs.
- NSIS `InstallDirRegKey` can preserve an existing registry `InstallDir`, so an
  upgrade may still target the legacy directory even when the current default
  path has changed.
- `Relay.Sidecar.exe` is a long-running process. If the installed app is open,
  if Edge/workbench startup left the sidecar running, or if a previous launcher
  instance is still alive, NSIS `File /r` cannot overwrite the executable.
- The `0.3.6` installer added a stop-and-lock-check preflight, but real Windows
  upgrades can still leave `Relay.Sidecar.exe` locked. This follows from the
  current browser Workbench architecture: the launcher opens the browser and
  exits, so the sidecar can continue as an orphaned long-running process.
  Stable commit `40622c03d049f89e9b2501a39b88eb796c298912` avoided this class
  in the Tauri line by binding children to the desktop process lifetime through
  a Windows Job Object. The active browser architecture cannot depend on that
  parent lifetime.

#### Product Decision

The installer must be robust for in-place user-scope upgrades.

Fresh installs should use the canonical install directory
`%LOCALAPPDATA%\Programs\Relay Agent`. Upgrades from legacy installs may keep
using `%LOCALAPPDATA%\Programs\RelayAgent` when that is the registered existing
install location, but the installer must make that explicit and safe:

- detect both canonical and legacy install roots;
- best-effort stop current-user Relay processes whose executable path is under
  those roots;
- never overwrite the running `Relay.Sidecar.exe` path during package copy;
- copy each update into a fresh versioned payload directory and repoint
  shortcuts/registry metadata to that payload;
- keep all behavior per-user and avoid UAC/admin prompts.

The user should never have to manually find and kill `Relay.Sidecar.exe` from
Task Manager for a normal update.

#### Remediation Design

1. **Normalize install-root policy**
   - Keep `%LOCALAPPDATA%\Programs\Relay Agent` as the fresh-install canonical
     path in docs and generated NSIS.
   - Treat `%LOCALAPPDATA%\Programs\RelayAgent` as a supported legacy upgrade
     path only when it is already registered or exists with a Relay
     installation.
   - Update packaging docs and release notes to state that upgrades may remain
     in the legacy path, but new installs use the canonical spaced path.
   - Do not put app data, profiles, caches, temp files, or search artifacts in
     either install root.

2. **Add installer preflight stop logic**
   - Generate an NSIS preflight before `File /r` that targets:
     - `$INSTDIR\Relay.Sidecar.exe`;
     - `$INSTDIR\Relay.Launcher.exe`;
     - the canonical install root;
     - the legacy no-space install root.
   - Prefer a graceful stop when possible; if no app-local shutdown endpoint is
     available, use a bounded per-user process stop through PowerShell or
     another Windows built-in mechanism.
   - Scope process termination by executable path under known Relay install
     roots so unrelated processes with similar names are not affected.
   - Avoid administrator rights. Same-user Relay processes should be stopped
     when possible, but package installation must not fail just because a
     sidecar remains locked.

3. **Install into a fresh versioned payload directory**
   - Do not copy files directly over `$INSTDIR\Relay.Sidecar.exe`.
   - At install runtime, create a fresh payload directory such as
     `$INSTDIR\app-<version>-<tick>`.
   - Copy the full package into that payload directory.
   - Repoint Start Menu shortcuts, optional desktop shortcuts, `DisplayIcon`,
     and a Relay-owned `AppDir` registry value to the payload.
   - Keep `InstallDir` as the stable root so uninstall and future upgrades know
     which user-scope root owns the app.
   - Leave locked old binaries in place if they are still running. They can be
     retired by a later cleanup pass after the process exits, but they must not
     block the update.

4. **Keep upgrades atomic enough for user-visible entry points**
   - The successful install criterion is that the new shortcut/registry entry
     points to the new payload. It is acceptable for a previously running old
     sidecar to keep serving an already-open browser tab until the user closes
     it.
   - Preserve user data directories by keeping app data outside the install
     root.

5. **Harden installer smoke tests**
   - Extend release smoke coverage to inspect the generated NSIS script for:
     - `RequestExecutionLevel user`;
     - canonical and legacy install-root handling;
     - preflight stop logic before `File /r`;
     - versioned payload selection before `File /r`;
     - no machine-wide registry writes;
     - icon wiring still present.
   - Add a lightweight generated-script regression fixture so direct overwrite
     of `$INSTDIR\Relay.Sidecar.exe` cannot be reintroduced accidentally.
   - Keep this deterministic on Linux CI/dev environments by testing generated
     script content rather than requiring a Windows install run.

6. **Add Windows manual acceptance before release**
   - On a Windows machine with an existing installed Relay instance:
     1. start Relay Agent so `Relay.Sidecar.exe` is running;
     2. launch the new installer without administrator elevation;
     3. confirm the installer completes without raw file-write errors even if
        the old sidecar remains running;
     4. confirm the installed app starts, icon remains correct, workspace picker
        works, and Copilot readiness reaches the expected state.
   - Record the exact outcome in `docs/IMPLEMENTATION.md` before releasing the
     fix.

#### Acceptance Criteria

- Installing over a running user-scope Relay install no longer touches the
  locked `Relay.Sidecar.exe` path and therefore no longer surfaces the raw
  `error opening file for writing ... Relay.Sidecar.exe` message.
- Fresh installs use `%LOCALAPPDATA%\Programs\Relay Agent`.
- Legacy upgrades from `%LOCALAPPDATA%\Programs\RelayAgent` are handled
  intentionally and do not create a confusing duplicate install unless the user
  explicitly changes the directory page.
- The installer still requires no administrator rights, UAC elevation, or
  personal Windows password.
- `pnpm check`, `pnpm sidecar:publish:windows`,
  `pnpm sidecar:installer:windows`, and the installer policy smoke pass.
- A Windows installed-app upgrade smoke is recorded before the next release.

### 2026-05-17 Direct Corpus Interaction Plan

The arXiv paper "Beyond Semantic Similarity: Rethinking Retrieval for Agentic
Search via Direct Corpus Interaction" strengthens the current Relay direction.
Its core claim is that agentic search suffers when corpus access is compressed
into a fixed top-k retriever. Capable agents do better when they can interact
directly with the raw corpus through composable terminal-style tools such as
`grep`, `rg`, `glob/find`, file reads, and lightweight scripts. The DCI-Agent-
Lite implementation shows this can work without embeddings, vector indexes, or
an offline retriever, as long as the harness controls tool output size and
long-horizon context pressure.

Relay's interpretation:

> Search is not a separate product mode or a Relay-owned retriever. Search is a
> high-frequency recipe over the same Agent Framework session and
> OpenCode-compatible local tool catalog used for coding, Office inspection, and
> verification.

#### Design Decisions

1. **Do not revive `RelayDocumentSearch*`, SQLite/FTS, or a dedicated search
   runner.** DCI argues for higher-resolution raw-corpus interaction, not
   another top-k retrieval abstraction. Relay should improve `glob`, `grep`,
   `read`, and bounded `bash` observations instead.
2. **Agent Framework owns the search loop.** Search planning, tool selection,
   refinement, continuation after tool observations, approval boundaries, and
   terminal answers must stay inside Agent Framework sessions and middleware.
   Relay should not add a second search planner.
3. **OpenCode remains the model-facing tool contract.** DCI uses CLI-style
   corpus interaction, and OpenCode provides the closest mature public shape for
   model-visible local tools. Relay should expose `glob`, `grep`, `read`,
   `bash`, and `apply_patch` with OpenCode-compatible semantics while adding
   Relay policy and Windows/Office support under the hood.
4. **`bash` remains bounded.** DCI's paper uses shell pipelines, but Relay is a
   business app over local and shared folders. Keep unrestricted shell out of
   the default catalog. Add first-class structured `grep`/`glob`/`read`
   capabilities before widening `bash`; any additional text-processing command
   must be narrow, structured, auditable, and approval/policy gated.
5. **Observation quality matters more than ranking.** The previous "Mパーツ"
   failure is a retrieval-interface-resolution problem: filename/entity matches
   were treated as relevance. DCI suggests forcing local context checks and
   conjunctive evidence before promoting a candidate.
6. **Context management is product-critical.** DCI-Agent-Lite uses truncation,
   compaction, and optional summarization for long trajectories. Relay should
   implement deterministic truncation and compaction in Agent Framework
   middleware first. LLM summarization may be added later only if it is
   observable, replayable, and does not hide local evidence.
7. **AG-UI should show the investigation, not just a ranked list.** The
   Workbench should show searches tried, files read, evidence snippets, and
   why the agent refined the query. Candidate lists are secondary to evidence.

#### Required Capability Changes

1. **DCI-grade `grep`**
   - Add structured arguments for `allTerms`, `anyTerms`, `excludeTerms`,
     `fixedStrings`, `caseInsensitive`, `contextLines`, `includeGlobs`,
     `excludeGlobs`, `maxMatchesPerFile`, and result caps.
   - Push filtering into ripgrep wherever possible and always pass `--` before
     user/model patterns.
   - Return structured observations: display path, line number/range, matched
     terms, excerpt, truncation state, and continuation guidance.

2. **Evidence-first `read`**
   - Keep exact text/code reads OpenCode-like.
   - For Office/PDF reads, return stable sheet/page/section/cell anchors where
     extraction supports them.
   - Preserve local full artifacts, but project bounded excerpts plus hashes
     into Copilot context.

3. **Agent Framework DCI middleware**
   - Add deterministic tool-result truncation by tool type.
   - Add compaction that preserves the ordered tool-call skeleton, paths,
     hashes, counts, and latest evidence snippets while replacing older bulky
     observations with replayable artifact references.
   - Enforce final-answer readiness: answers about local files need at least
     one relevant local observation; evidence-backed answers need cited
     `read`/`grep` observations.

4. **OpenCode-compatible search recipes**
   - Add prompt-projection guidance, not a planner, for DCI search behavior:
     search direct terms, combine weak clues, read local context, extract new
     entities/terms, refine, cross-check, and only then summarize.
   - Keep this as framework/middleware/catalog guidance over generic tools, not
     a `document_search` tool.

5. **AG-UI DCI trace UX**
   - Render search trajectories as a compact investigation timeline:
     search terms, inspected files, evidence snippets, refinements, and
     terminal confidence/caveats.
   - Keep the visual surface minimal; advanced diagnostics remain collapsible
     support details.

6. **Verification**
   - Add a deterministic local-corpus DCI golden smoke with sparse clues,
     misleading entity-name matches, and required local context checks.
   - Add Office/PDF DCI smoke cases using `read` extraction anchors.
   - Add a live Copilot DCI E2E only after deterministic smokes pass.

#### DCI Live E2E Design

The live Copilot E2E for DCI must test the paper's actual claim: a capable
agent should solve a local-corpus investigation by directly interacting with
raw files, not by receiving a pre-ranked retrieval answer.

The test should create an isolated temporary corpus with at least these cases:

1. **Sparse clue conjunction**
   - No single filename contains the full answer.
   - The answer requires combining two or more weak clues found in separate
     files or separate regions of the same file.
   - Acceptance requires Copilot to issue multiple `grep`/`read` calls and
     refine the search terms after seeing partial evidence.

2. **Misleading entity-name match**
   - Include files whose names strongly match one query token but whose local
     content proves they are the wrong target.
   - Include a lower-obviousness file where the required concepts co-occur in
     local context.
   - Acceptance requires the final answer to cite the content-confirmed file,
     not the filename-only decoy.

3. **Local context verification**
   - Include a match with nearby negation or a warning such as "not applicable",
     "not sales", or "draft example".
   - Acceptance requires reading surrounding context rather than treating the
     first lexical match as evidence.

4. **Heterogeneous corpus**
   - Include plaintext/Markdown/CSV plus at least one Relay-supported Office
     file fixture after `read` anchors are implemented.
   - Acceptance requires the same generic tools to inspect both code/text and
     Office-derived evidence.

5. **Trajectory and UX artifact**
   - Save AG-UI event logs, framework trace IDs, Copilot prompt/response
     diagnostics, and a redacted final report under `dist/e2e/live-dci/`.
   - The Workbench screenshot should show a compact investigation timeline:
     searches tried, files inspected, evidence snippets, refinements, and
     final caveats.

The live test is not a replacement for deterministic smokes. It is a release
confidence gate that verifies M365 Copilot can follow the DCI recipe through
Relay's Agent Framework/OpenCode tool surface. If Copilot, Edge CDP, or quota
fails, the test must classify the failure as provider/adapter-blocked. It must
not silently pass by falling back to a mock model, a dedicated search engine, or
a local heuristic answer.

### 2026-05-17 DCI File Search Improvement Plan

This plan applies arXiv:2605.05242 specifically to Relay's file-search behavior.
The paper argues that agentic search is bottlenecked when corpus access is
collapsed into one fixed top-k retrieval call. It highlights exact constraints,
sparse clue conjunctions, local context checks, intermediate entity discovery,
and plan revision after partial evidence as first-class search operations.

Relay's file search should therefore become a **direct corpus investigation
recipe over generic tools**, not a hidden search engine:

- no revived `RelayDocumentSearch*`;
- no SQLite/FTS/vector retriever as the default file-search path;
- no fixed file taxonomy or fixed business classification;
- no separate "資料検索 mode" planner;
- no fallback heuristic answer when Copilot or tools fail;
- keep M365 Copilot as the reasoner and Relay as the local tool executor.

#### Target Behavior

When a user gives an ambiguous request such as "この前のアフター系の数字の根拠を探して",
Relay should let Copilot investigate the local corpus through the OpenCode-like
tools:

1. use `glob` for corpus shape and candidate discovery;
2. use `grep` with `allTerms`, `anyTerms`, `excludeTerms`, globs, and context
   lines to combine weak clues;
3. use `read` to inspect local context, including negation, "not evidence",
   prior-period warnings, and Office/PDF extracted anchors;
4. revise search terms from observed content instead of finalizing after the
   first weak match;
5. read exact evidence before final;
6. answer with the evidence path/snippet and why hard negatives were rejected.

#### Search Harness Requirements

1. **Trajectory State, Not Ranked Candidates**
   - Track the ordered investigation trajectory as a first-class Agent
     Framework/AG-UI artifact: query terms, tools, matched paths, read targets,
     evidence snippets, failed terms, and rejected decoys.
   - Do not promote candidates merely because file names match. Promotion
     requires local context evidence from `grep` or `read`.

2. **Evidence Ledger**
   - Maintain a lightweight run-local ledger derived from tool observations:
     `candidate`, `evidence`, `negative`, `guide/glossary`,
     `prior-period`, `generic`, and `not-found`.
   - The ledger is not a second planner and not a retriever. It is an
     observable summary of raw tool results used to prevent premature final
     answers and invented reads.

3. **Search Refinement Readiness**
   - A final answer is not admissible when:
     - the latest `grep` returned zero matches;
     - only guide/glossary documents have been read;
     - the read document explicitly says it is not evidence;
     - all observed matches are hard negatives;
     - a failed `read` was the only attempted evidence inspection.
   - In those states, the next admissible action should be another `grep`,
     `glob`, or exact `read` of an observed candidate.

4. **Query Expansion Without Fixed Domain Rules**
   - Do not hard-code business-specific exceptions such as `Mパーツ`.
   - Use Copilot to infer expansions from the user's wording and observed
     content.
   - Relay should provide tool affordances and guardrails:
     `allTerms`, `anyTerms`, `excludeTerms`, context lines, result caps,
     exact-display-path reads, and failure feedback.

5. **Local Context And Hard Negative Handling**
   - `grep` observations should identify when a match appears with negation or
     exclusion language, for example "not evidence", "reference only",
     "prior year", "generic memo", or Japanese equivalents.
   - `read` observations should make anchors and excerpts clear enough that
     Copilot can reject false positives without needing hidden ranking.

6. **No Invented Reads**
   - `read` should be restricted to explicit user paths or paths observed in
     prior `glob`/`grep`/`read` results during the same run, except for
     exact workspace paths that actually exist.
   - If Copilot invents a plausible filename, Relay should return a normal
     tool observation or guard rejection that instructs Copilot to use observed
     paths, not crash the run.

7. **Metrics-Driven E2E**
   - Live and deterministic E2E should record DCI trajectory metrics:
     raw-tool-only path, weak-clue conjunction, query expansion, coverage,
     evidence localization, hard-negative rejection, failed-tool count,
     invented-read count, and final evidence citation.
   - A run that gets the final answer right by chance but misses local context
     checks should fail the DCI quality gate.

8. **AG-UI Search UX**
   - The Workbench should show a compact investigation trail, not a ranked
     search-result page:
     searches tried, files surfaced, files read, evidence snippets, rejected
     decoys, and final answer.
   - Keep diagnostics collapsible. The default UI remains minimal.

#### Milestone Outcome

After this plan, file search should feel less like "find the highest-ranked
candidate" and more like "Copilot conducts a local investigation with safe,
auditable tools." The system should be stronger on ambiguous business language,
sparse clues, misleading company/file names, prior-period copies, and documents
whose relevance depends on nearby context.

### 2026-05-17 DCI Code And Test Revision Plan

This plan converts the DCI direction from a successful file-search E2E into a
more durable code and test contract. It is based on arXiv:2605.05242's central
claim: fixed top-k retrieval hides the exact lexical constraints, sparse clue
conjunctions, local context checks, intermediate entity discovery, and
multi-step hypothesis revisions that agentic search needs. Relay should
therefore strengthen the generic local tool loop rather than add a hidden
retriever, vector index, or document-search subsystem.

#### Scope

- Keep the active architecture: Microsoft Agent Framework session, M365
  Copilot over Relay's Edge CDP adapter, AG-UI events, and OpenCode-compatible
  `glob`, `grep`, and `read` tools.
- Treat file search as a high-frequency recipe over the generic tool catalog.
  Do not add or revive `RelayDocumentSearch*`, SQLite/FTS, vector search,
  fixed business taxonomies, or a separate document-search mode.
- Move DCI correctness from prompt guidance and one live E2E into explicit
  code contracts, deterministic smokes, and live artifact gates.

#### Code Changes

1. **Explicit DCI trajectory contract**
   - Add a compact `RelayDciTrajectory.v1` diagnostic shape derived from
     Agent Framework tool observations. It should record tool order, searched
     terms, matched paths, zero-match states, read targets, anchors, excerpts,
     failed reads, hard-negative labels, and final cited evidence.
   - The trajectory is a replay/support artifact and AG-UI state aid, not a
     model-visible `document_search` tool and not a second planner.
   - It must be reconstructable from AG-UI events and must not persist caches
     or indexes inside searched/shared folders.

2. **Generic read-admission and recovery**
   - Keep the current rule that `read` is admissible only for explicit user
     paths, observed candidate paths, or exact existing workspace paths.
   - Replace any domain-specific recovery heuristics with generic query-term
     extraction from the user request, failed read target, and previous
     `glob`/`grep` observations.
   - When Copilot invents a path after a zero-match `grep`, Relay should emit
     an observable `grep` recovery or failed observation that points back to
     observed candidates and usable terms. It must not crash the run or
     silently synthesize a local answer.

3. **Higher-resolution `grep` observations**
   - Preserve structured arguments (`allTerms`, `anyTerms`, `excludeTerms`,
     globs, context lines, caps) and push filters into ripgrep.
   - Return match groups with nearby context, matched required/optional terms,
     context labels, truncation state, and continuation guidance.
   - Add deterministic context labels for generic evidence behavior:
     possible evidence, negative/negated context, guide/glossary, prior-period,
     generic memo, and no-evidence. These labels must remain transparent and
     should not encode company-specific exceptions.

4. **Evidence-first `read`**
   - Keep exact text/code reads OpenCode-like.
   - For Office/PDF/CSV-supported reads, expose stable anchors and bounded
     excerpts so Copilot can verify local context instead of relying on file
     names.
   - Record text hashes and anchors in the trajectory so a final answer can be
     audited without copying entire local documents into support artifacts.

5. **DCI context compaction**
   - Add deterministic compaction for long investigations that preserves the
     ordered skeleton: terms tried, counts, matched paths, read anchors,
     hashes, rejected decoys, and current hypotheses.
   - Do not use LLM summarization as a hidden source of truth. If LLM
     summarization is introduced later, it must be observable and replayable.

6. **AG-UI investigation trace**
   - Render the trajectory as a compact investigation timeline: searches
     tried, files surfaced, files read, evidence snippets, rejected decoys, and
     final cited file.
   - Keep the default UI minimal. Raw observations and support bundle details
     remain collapsed.

#### Test Changes

1. **Deterministic DCI metric unit tests**
   - Add direct unit coverage for `RelayDciTrajectoryMetrics.v1` so live and
     mock E2E share the same definitions for raw-tool-only behavior, weak-clue
     conjunction, query expansion, coverage, localization, hard-negative
     rejection, failed tools, and invented reads.

2. **Multi-hop local corpus smokes**
   - Add a corpus where the first useful file is only a guide/glossary that
     reveals vocabulary needed to find the true evidence.
   - Include entity-name decoys, prior-period references, generic memos,
     negated contexts, and a gold evidence file whose filename does not expose
     the full answer.
   - Require at least one refinement after observing local content.

3. **Invented-read and zero-match regressions**
   - Add tests where Copilot tries a plausible but nonexistent filename after
     a zero-match `grep`.
   - The run should continue with an observable recovery or fail with a clear
     protocol error; it must not terminate with a streaming exception.

4. **Office/PDF/CSV DCI fixtures**
   - Extend DCI tests beyond Markdown/plaintext once read anchors are stable:
     a workbook sheet/cell evidence case, a CSV row evidence case, and a PDF
     text-layer evidence case.
   - The same generic `glob`/`grep`/`read` recipe should drive these cases
     where possible; Office/PDF content search should remain bounded by what
     Relay can safely extract.

5. **Live Copilot DCI release gate**
   - Keep `pnpm workbench:live-dci-e2e` as the signed-in Copilot confidence
     gate.
   - The test must save AG-UI events, trajectory metrics, final result,
     prompt/response diagnostics, and failure classification under
     `dist/e2e/live-dci/`.
   - A live run that reaches the right final file by chance but misses local
     context checks should fail the DCI metric gate.

#### Acceptance Criteria

- No dedicated retriever, hidden ranking engine, or revived
  `RelayDocumentSearch*` path is added.
- File search runs over `glob`, `grep`, and exact `read`, with optional bounded
  verification tools only when explicitly justified.
- A final answer about a local file must be backed by local observations and
  exact evidence reads when the request asks for evidence, content, or context.
- Hard negatives and guide-only matches cannot satisfy the final readiness
  gate by themselves.
- All DCI tests fail clearly as tool/protocol/provider errors; no mock model,
  heuristic local answer, or fallback search engine is allowed to pass a test.

### 2026-05-18 DCI Interface Resolution Follow-up Plan

This follow-up applies arXiv:2605.05242 more aggressively after the completed
`DCI2605*` hardening. The paper's useful product lesson is not merely "use
grep." Its deeper claim is that retrieval quality for stronger agents depends
on the **resolution of the corpus interface**: exact lexical constraints,
sparse clue conjunctions, local context checks, intermediate entity discovery,
and hypothesis revision must remain available as first-class actions. A single
top-k retrieval abstraction, even if fast, hides too much state and can discard
evidence before reasoning starts.

Relay should therefore improve the generic Agent Framework/OpenCode-compatible
tool loop in ways that increase observable search resolution without adding a
hidden retriever, vector index, fixed taxonomy, or `RelayDocumentSearch*`
subsystem.

#### Scope

- Keep M365 Copilot as the reasoning controller, Microsoft Agent Framework as
  the agent runtime, AG-UI as the Workbench protocol, and OpenCode-compatible
  tools as the model-facing local interface.
- Keep file search, Office inspection, and coding as recipes over the same
  generic tools. Do not reintroduce product modes or a search-specific backend.
- Treat DCI as a tool-loop and evidence-discipline upgrade, not a new local
  answer engine. Relay may validate, repair, cap, and audit, but Relay must not
  synthesize answers from local files behind Copilot's back.

#### Feature Revisions

1. **DCI phase and hypothesis ledger**
   - Extend `RelayDciTrajectory.v1` with explicit phase tags:
     `explore`, `refine`, `inspect`, `verify`, and `answer_ready`.
   - Add a compact hypothesis ledger derived from tool observations:
     candidate claim, supporting paths, refuting paths, unresolved terms,
     reason for rejection, and latest next action.
   - Keep the ledger diagnostic/AG-UI state only. It is not a model-visible
     retriever and not a hidden planner.

2. **Higher-resolution grep semantics**
   - Add context-window conjunction support so weak clues can satisfy
     `allTerms` across a bounded nearby line window, not only on one line.
   - Return match groups with `scope=line|context_window|file_sample`,
     matched required terms, optional terms, excluded terms encountered nearby,
     before/after snippets, and continuation guidance.
   - Keep all filtering pushed into ripgrep where possible and preserve the
     `--` separator before user/model patterns.

3. **Observation-driven refinement gates**
   - Add Agent Framework middleware/final-readiness checks that detect when a
     search trajectory has only guide/glossary, zero-match, hard-negative,
     generic, prior-period, or no-evidence observations.
   - In those states, final answers should be repaired to the next observable
     local tool action when a safe action exists, or fail fast with a protocol
     error. Do not rely only on prompt wording.
   - Require at least one observed-term refinement when the user request is
     ambiguous and a read observation introduces new vocabulary.

4. **Structured Office/CSV/PDF evidence projections**
   - Strengthen `read` so supported Office/CSV/PDF files expose bounded table,
     row, sheet, page, and cell/page anchors where extraction supports them.
   - Add content projection that Copilot can search/refine over after exact
     `read` without adding a separate Office/PDF search engine.
   - Track extraction limitations explicitly in observations, e.g. unsupported
     binary Office formats, PDF without text layer, hidden sheets, truncated
     tables, and formula/cache limitations.

5. **Minimal lightweight analysis without unrestricted shell**
   - DCI uses shell commands and lightweight scripts, but Relay's default
     business setting cannot expose unrestricted shell.
   - Prefer first-class structured `glob`, `grep`, `read`, `diff`, and
     bounded `bash` verification. Where lightweight analysis is needed, add
     narrow argv-based operations under existing tools rather than new
     Relay-specific model-visible names.
   - Any widened command path must remain workspace-contained, capped,
     cancellable, auditable, and approval/policy gated.

6. **Deterministic context management policy**
   - Keep deterministic truncation and compaction as the source of truth.
   - Add compaction metrics: raw output bytes, projected bytes, kept anchors,
     dropped excerpts, retained hashes, and replay sufficiency.
   - Model-generated summarization remains disabled by default. It may be
     added later only if observable, replayable, and clearly marked as a
     lossy assistant summary rather than evidence.

7. **Interface-resolution metrics**
   - Extend `RelayDciTrajectoryMetrics.v1` with:
     refinement depth, operator diversity, context-window conjunction,
     observation-to-next-action dependency, candidate rejection count,
     hard-negative read count, evidence-anchor locality, and accidental-answer
     prevention.
   - A final answer should fail the DCI gate when it cites the right file
     without enough observed local evidence or without rejecting obvious decoys
     in the trajectory.

8. **Workbench hypothesis/evidence UX**
   - Keep the minimal professional Workbench surface, but show a compact DCI
     investigation trail when present:
     searches tried, terms learned, candidates inspected, hypotheses rejected,
     exact evidence anchors, and final caveats.
   - Avoid ranked-result-page UX. The UI should explain why a file was selected
     or rejected, not just list candidates.

#### Test Revisions

1. **Adversarial DCI corpus generator**
   - Generate deterministic corpora with many distractors, nested folders,
     misleading filenames, entity-name traps, prior-period copies, negated
     snippets, generic memos, guide/glossary files, and non-obvious evidence
     filenames.
   - Include Markdown/text/CSV and at least one supported Office/PDF fixture
     when extraction is available.

2. **Sparse clue and context-window tests**
   - Add cases where required terms occur on nearby lines, in adjacent table
     cells, or across a small document section rather than one exact line.
   - The passing trajectory must show local context-window evidence and an
     exact read anchor before final.

3. **Trajectory-quality unit tests**
   - Add direct tests for the expanded trajectory and metrics:
     phase transitions, hypothesis support/refutation, context-window matches,
     decoy rejection, zero-match recovery, no-evidence repair, and accidental
     final prevention.

4. **Heterogeneous evidence smokes**
   - Add deterministic smokes for CSV row evidence, xlsx sheet/cell evidence,
     docx/pptx text evidence, and PDF text-layer evidence using the same
     generic tool loop.
   - Tests must verify anchors, hashes, limitations, and final citation
     behavior.

5. **Harder live Copilot DCI E2E**
   - Upgrade `pnpm workbench:live-dci-e2e` or add a second live scenario where
     the correct answer requires at least:
     one exploratory search, one guide/context read, one refined search,
     one decoy read/rejection, and one exact evidence read.
   - Save AG-UI events, trajectory, metrics, prompt/response diagnostics,
     screenshots when available, and failure classification under
     `dist/e2e/live-dci/`.
   - Fail if Copilot reaches the correct final string by chance without the
     required trajectory evidence.

#### Acceptance Criteria

- No `RelayDocumentSearch*`, SQLite/FTS, vector search, hidden ranking engine,
  fixed business taxonomy, or separate search mode is introduced.
- DCI behavior is observable through Agent Framework tool calls and AG-UI
  events, not hidden Relay inference.
- A local evidence answer can be replayed from trajectory artifacts:
  terms tried, files surfaced, files read, anchors, hashes, rejected decoys,
  and final citation.
- Tests cover both deterministic model behavior and a signed-in live M365
  Copilot trajectory.
- `pnpm check` includes the deterministic DCI additions; live DCI remains a
  release-confidence gate with provider/tool/protocol failure classification.

### 2026-05-17 Reinvention Review

This review re-checks the active direction against the current public
documentation for Microsoft Agent Framework, AG-UI, and OpenCode. The answer is:

> Relay is not fully reinventing the wheel yet, but it is still too close to
> doing so in the harness layer.

The current implementation is correctly using Agent Framework and AG-UI at the
outer boundary, and it has moved the model-facing tools toward OpenCode names.
However, several Relay-owned abstractions still overlap with concepts that the
frameworks already provide:

1. **Turn/session state**: `RelayTurnState` and run-keyed state are useful as
   transition scaffolding, but Agent Framework `AgentSession` is the correct
   long-lived continuity authority. Keeping both as first-class authorities
   risks duplicated memory, stale tool results, and follow-up run leakage.
2. **Admissible action envelope**: `RelayAdmissibleActionEnvelope` prevents bad
   Copilot choices today, but the durable version should be Agent Framework
   middleware plus tool-registry filtering. Relay can still derive a compact
   Copilot prompt projection from that framework state; it should not maintain
   a parallel planner.
3. **Approval flow**: AG-UI integration documents native HITL behavior through
   approval-required functions/client tool calls. Relay approval cards,
   ledgers, and resume logic should become thin render/audit adapters over
   Agent Framework approval primitives, not an independent approval protocol.
4. **AG-UI events/state**: AG-UI defines run, tool-call, result, state
   snapshot/delta, message snapshot, activity, and reasoning events. Workbench
   state should be replayable from these standard events. Any Relay-only event
   union should be diagnostics-only or removed.
5. **OpenCode tool shape**: the tool names are mostly aligned, but argument
   shapes are not fully aligned. In particular OpenCode documents
   `apply_patch` with patch text under `patchText`; Relay currently projects
   `patch`. Relay should migrate the model-facing shape to `patchText` while
   accepting `patch` only as a compatibility alias.
6. **Tool coverage**: OpenCode includes `list`, `todowrite`, and `todoread` in
   addition to `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, `bash`,
   and `question`. Relay should not copy every tool blindly, but it should make
   an explicit keep/defer/adopt decision for each OpenCode built-in so gaps are
   deliberate rather than accidental.
7. **MCP reuse**: Agent Framework supports local MCP tools, and the docs call
   out MCP when a prebuilt server already provides a capability. Relay should
   evaluate local MCP reuse for generic filesystem/git/sqlite-style tools
   before growing more local function bodies. Security, Windows share behavior,
   and approval policy may still justify Relay-owned function tools, but that
   decision must be documented per tool family.
8. **Observability**: Agent Framework guidance highlights AG-UI plus
   OpenTelemetry-style observability. Relay's support bundles and prompt dumps
   are useful, but they should be normalized into framework-native traces and
   replayable AG-UI event logs.

Evidence from the latest docs:

- Agent Framework's AG-UI integration maps `AIAgent`, streaming agent runs,
  function tools, approval-required functions, `AgentSession`, and structured
  state directly to AG-UI concepts.
- Agent Framework tool guidance says the application/framework parses tool
  calls, executes functions, and feeds results back; it also recommends MCP
  tools when an existing MCP server already provides the needed capability.
- AG-UI defines standard event types for text, tool calls, tool results, state
  snapshots/deltas, message snapshots, activity snapshots/deltas, and reasoning.
- OpenCode defines a compact built-in tool set and permission classes where
  `edit` gates `write`, `edit`, and `apply_patch`; `question` is a tool, not
  free-form prose.

### 2026-05-17 Live E2E Reinvention Guardrail Update

The latest live Copilot rerun changed the diagnosis:

- The lightweight signed-in Copilot canary passed, so the previous hourly
  request-limit block appears to have cleared.
- The multi-file project E2E still failed after reaching real Copilot:
  - one attempt produced a malformed `apply_patch` payload, then recovered with
    a second patch but timed out waiting for the final Copilot continuation;
  - the retry created the required files, then failed on the improvement turn
    because the Copilot composer visible text differed from Relay's prompt by
    one character before submit.

This must not be fixed by adding another Relay planner, another tool taxonomy,
or more broad prompt folklore. The failure sits at the adapter boundaries:

1. **OpenCode-compatible tool conformance**: `apply_patch` must be validated as
   an OpenCode-shaped tool call before approval/execution. Invalid patch grammar
   should become a structured tool observation in the same Agent Framework
   session, not a harness crash or a prompt-only repair rule.
2. **Agent Framework continuation**: after a tool observation, the same
   `AgentSession` must continue until middleware permits a final answer or
   returns a structured blocked state. Relay must not own an independent
   timeout/final heuristic outside framework state.
3. **AG-UI replayability**: the user-visible run, including the malformed patch,
   tool observation, continuation attempt, and terminal error, must replay from
   standard AG-UI events plus framework trace IDs.
4. **Copilot CDP provider adapter only**: prompt insertion, composer
   normalization, readiness checks, response extraction, and diagnostics remain
   Relay-owned only because M365 Copilot is accessed through Edge CDP. This
   adapter must not decide tool eligibility, approval semantics, or final
   eligibility.

Reference sources rechecked for this update:

- Microsoft Agent Framework documentation:
  `https://learn.microsoft.com/en-us/agent-framework/`
- Agent Framework tool guidance:
  `https://learn.microsoft.com/en-us/agent-framework/get-started/add-tools`
- Agent Framework tools overview:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/`
- Agent Framework workflows:
  `https://learn.microsoft.com/en-us/agent-framework/workflows/`
- Agent Framework DevUI:
  `https://learn.microsoft.com/en-us/agent-framework/devui/`
- AG-UI architecture and events:
  `https://docs.ag-ui.com/concepts/architecture`
  and `https://docs.ag-ui.com/concepts/events`
- OpenCode tools and CLI/agent permissions:
  `https://opencode.ai/docs/tools/`
  and `https://opencode.ai/docs/cli/`

#### Boundary Decisions

- **Do not adopt a new Relay runner.** Keep Agent Framework as the run/session
  owner and AG-UI as the UI protocol.
- **Do not embed OpenCode as a runtime in this milestone.** OpenCode remains
  the public local-tool contract reference: tool names, permission grouping,
  argument shape, patch semantics, and result expectations. Relay can implement
  function bodies only where policy and packaging require it.
- **Do not compensate with hidden fallbacks.** If Copilot CDP insertion,
  provider readiness, tool registry projection, or session continuation fails,
  stop with a structured blocked result and diagnostic artifact.
- **Do not add task-specific local search/Office/code modes.** Search, Office,
  and code remain common use cases over one generic workbench and one
  OpenCode-compatible local tool surface.

#### Required Fix Direction

1. **OpenCode conformance harness**
   - Generate the model-visible catalog from Agent Framework tool metadata.
   - Keep canonical OpenCode names and shapes, especially
     `apply_patch(req:patchText)`.
   - Add golden invalid/valid `apply_patch` cases, including multi-file adds,
     updates, and malformed add-file lines.
   - Pre-approval validation should reject malformed `patchText` as a tool
     observation and continue the same session.

2. **Copilot CDP transport hardening without new planning logic**
   - Canonicalize composer verification with deterministic normalization
     (`CRLF/LF`, trailing newline, Unicode normalization, zero-width characters,
     and Copilot UI markdown transformations) before declaring corruption.
   - Save a minimal prompt-diff artifact when visible text differs from the
     intended payload.
   - Submit only after the normalized composer text matches the intended
     payload or fails with a provider-adapter diagnostic.
   - Keep insertion/submission/reply extraction inside the Copilot provider
     adapter; all tool/final decisions remain framework middleware decisions.

3. **Tool observation compaction and continuation**
   - Keep exact files as artifacts with hashes and bounded excerpts in the
     tool observation sent back to Copilot.
   - Avoid injecting large raw tool payloads into the Copilot composer when an
     artifact ID plus excerpt is enough for the next action.
   - Preserve enough content for edit tasks, but make the compaction rule
     deterministic and testable instead of ad hoc.

4. **Agent Framework terminal middleware**
   - Continue the same `AgentSession` after tool observations.
   - Final is allowed only when required artifacts, approvals, and verification
     gates are satisfied.
   - `question` is visible only after framework middleware marks the run
     genuinely user-blocked.
   - Timeout must classify where it occurred: provider response, framework
     continuation, approval wait, or tool execution.

5. **AG-UI acceptance artifacts**
   - Save AG-UI event logs for live canary and multi-step project E2E.
   - Replay must reconstruct: run lifecycle, tool call args, tool result,
     approval state if any, final/blocked state, and selected artifacts.
   - A failed live run is acceptable only when the replay plus trace proves the
     failure is provider-blocked or a named adapter defect.

### 2026-05-17 Post-LIVEFIX E2E Plan

The latest live E2E after `LIVEFIX*` changed the remaining problem again:

- The signed-in Copilot canary passes through the current Edge CDP adapter.
- Multi-file project creation can complete through the Agent Framework +
  AG-UI + OpenCode-compatible `apply_patch(req:patchText)` path.
- The project-improvement turn can still stop after a `read` observation with
  `provider_response_timeout`. This is now a structured provider-blocked
  state, but it is not yet a good user experience for multi-step local work.

The next fixes must avoid another Relay planner. The goal is to let Agent
Framework and OpenCode semantics carry the multi-step loop more directly:

1. **Keep tool-validation failures out of approval and run crashes.**
   OpenCode-shaped validation failures such as malformed `apply_patch` should
   be caught before Agent Framework's approval wrapper surfaces them to the
   user. Copilot gets one strict provider-adapter repair pass for the JSON tool
   projection; execution-time validation failures remain normal framework tool
   observations. Invalid mutations must not reach user approval, and AG-UI
   `RUN_ERROR` remains reserved for provider, framework, or executor health
   failures that cannot safely continue.
2. **Make `read` observations OpenCode-style and artifact-backed.**
   Relay should stop projecting raw file bodies as large prompt payloads.
   The model-facing observation should include file path, size, hash, a bounded
   excerpt, and a clear instruction to call `read` again with `offset`/`limit`
   when exact context is needed. Full content remains available locally and in
   AG-UI/support artifacts.
3. **Use Agent Framework continuation as the retry boundary.**
   If M365 Copilot times out after a tool result, Relay should keep the
   `AgentSession` and AG-UI run resumable. A provider retry, if used, must be a
   named provider-adapter policy with trace events, not a hidden planner
   fallback or a new user-level run.
4. **Keep Copilot-specific patch repair in the provider/adapter boundary.**
   Markdown Add File `+` repair is a deterministic Copilot projection repair,
   not a change to OpenCode patch semantics. The repaired patch must be
   revalidated before approval and should be traceable in diagnostics.
5. **Split live E2E acceptance into framework facts.**
   The acceptance surface should separately prove:
   - canary prompt send/receive works;
   - project creation completes;
   - read -> mutation -> final improvement completes or reaches a named
     provider-blocked state;
   - the AG-UI event log and framework trace explain the outcome without raw
     Relay-only state.

Non-goals for this queue:

- Do not add `project_edit`, `search_files`, or other Relay-specific
  task-mode tools.
- Do not embed OpenCode runtime binaries. OpenCode remains the model-facing
  tool-contract reference for this queue.
- Do not use broad prompt folklore to paper over invalid tool choices. Prefer
  tool schema, framework middleware, structured observations, and replayable
  traces.

### Reinvention-Reduction Target Architecture

The target architecture must make every nontrivial Relay-owned component answer
one question:

> Is this an adapter around Agent Framework, AG-UI, OpenCode semantics, or a
> local policy/tool body that no approved reusable component provides?

If the answer is "no", the component should be deleted, folded into framework
middleware, or demoted to diagnostics.

#### Keep As Relay-Owned

- **M365 Copilot CDP provider adapter**: required because the approved LLM
  controller is Microsoft 365 Copilot through an already-signed-in Edge session.
  This is the main unavoidable custom layer.
- **Workspace policy and local safety**: path containment, Windows share
  handling, backup location, redaction, no-admin packaging, and organization
  constraints are local product requirements.
- **Approved local function bodies**: OfficeCLI semantic operations,
  Office/PDF plaintext extraction, ripgrep invocation, and filesystem mutation
  bodies may remain local when a prebuilt MCP/tool cannot satisfy policy.
- **Diagnostics bridge**: prompt dumps, support bundles, quota/provider
  diagnostics, and release packaging remain Relay-owned, but should emit
  framework-compatible traces where possible.

#### Move To Framework/Protocol Ownership

- **Session continuity**: Agent Framework `AgentSession` owns transcript and
  continuation state. Relay run IDs are UI correlation IDs only.
- **Tool admission and final eligibility**: Agent Framework middleware owns
  which tools are visible and whether final/question is allowed. The Copilot
  prompt receives a projection of this state; it is not the source of truth.
- **Approval**: `ApprovalRequiredAIFunction` or equivalent Agent Framework
  approval primitives own pause/resume. AG-UI HITL events own the client
  interaction shape.
- **UI event model**: Workbench renders AG-UI events and state snapshots/deltas.
  Relay-specific raw events are support diagnostics only.
- **Tool contract**: OpenCode-compatible names and argument schemas are the
  public model-facing surface. Relay aliases are executor-only compatibility.

### Improvement Plan

1. **Create a delete/adapt/keep matrix for every harness component.**
   Inventory `RelayTurnState`, `RelayAdmissibleActionEnvelope`,
   `RelayProtocolGuard`, approval bridge code, `RelayToolObservation`, tool
   registry/projection, Workbench event handling, and Copilot transport. For
   each item, name the official primitive it should map to, or justify why it
   must remain Relay-owned.
2. **Cut over session continuity first.**
   Make Agent Framework `AgentSession` and the AG-UI thread the durable
   transcript boundary. Keep `RelayTurnState` only as a derived, per-call
   diagnostic/projection object until it can be removed.
3. **Cut over approvals next.**
   Wrap mutating functions as approval-required Agent Framework tools and map
   them through AG-UI HITL. Delete any approval resume path that can execute
   outside the pending function call.
4. **Replace AAE with middleware-derived projection.**
   Keep the behavior that prevents local-tools-unavailable, unnecessary
   `ask_user`, and premature `final`, but implement it as admission/final
   eligibility middleware. The prompt projection should be generated from the
   framework registry and middleware decision.
5. **Align OpenCode tool shapes, not only names.**
   Migrate `apply_patch` to the OpenCode-style `patchText` model-facing
   argument. Accept `patch` only as executor compatibility. Evaluate `list`,
   `todoread`, and `todowrite` explicitly; adopt only if they reduce prompt
   state or improve long-horizon work without adding a Relay-only taxonomy.
6. **Evaluate MCP reuse before adding more local function bodies.**
   For filesystem, git/status/diff, sqlite/index, and future app integrations,
   compare Agent Framework local MCP tools against Relay-owned functions.
   Adopt MCP only when it preserves workspace policy, approval behavior, audit
   logs, and Windows/Linux packaging. The current decision matrix lives in
   `docs/MCP_REUSE_DECISION.md`.
7. **Make AG-UI replay the acceptance artifact.**
   Every live/manual E2E should save a standard AG-UI event log that can replay
   run lifecycle, tool calls, approvals, state snapshots, and final output.
   Raw Relay diagnostics can be attached, but cannot be required to understand
   the user-visible run.
8. **Normalize observability.**
   Add an OpenTelemetry-compatible trace shape for provider calls, model
   projections, tool calls, approvals, and local execution. Keep prompt dumps as
   sensitive support artifacts, not as the primary debugging model.
9. **Use live Copilot canaries only after structural smokes pass.**
   Because M365 Copilot quota can block tests, local deterministic smokes must
   validate Agent Framework/AG-UI/OpenCode conformance first. Live Copilot E2E
   remains required for release readiness, but quota failures should be
   structured provider-blocked results, not harness failures.

### Acceptance Bar For "Not Reinventing The Wheel"

Relay can be considered safely aligned when all of the following are true:

- Every Workbench-visible event is standard AG-UI or a documented AG-UI
  activity/state payload.
- Approval-required tools use Agent Framework approval primitives and resume
  the same `AgentSession`.
- Model-visible local tool names and argument schemas match OpenCode, except
  for documented extensions such as `officecli`.
- Tool availability and final eligibility are enforced by middleware, not by
  prompt instructions alone.
- Any Relay-owned tool body has a written reason why an existing MCP/tool
  implementation was not adopted.
- A saved AG-UI event log plus framework trace is enough to debug an E2E
  failure without reading ad hoc Relay-only state.

### Harness Principle

Relay should not own an independent agent harness. Relay should own adapters.

The target harness is:

1. **M365 Copilot provider adapter**: Edge CDP transport, Copilot readiness,
   prompt insertion/submission, response extraction, JSON normalization, and
   diagnostics. It must not own task planning, tool state, approval state, or
   final eligibility.
2. **Microsoft Agent Framework runtime**: the canonical agent run loop,
   `AgentSession`, function/MCP tools, middleware chain, human approval
   handling, and tool-result feedback loop.
3. **OpenCode-compatible local tool contract**: the model-visible local
   workspace tools and permission semantics should match OpenCode as closely as
   possible. Relay may implement tool bodies, but the contract should not be a
   Relay invention.
4. **AG-UI projection**: the only Workbench-facing run/event/state/approval
   protocol. Relay UI should render Agent Framework state through AG-UI events
   rather than a custom run stream.

### OpenCode Semantics to Adopt

OpenCode is the model-facing behavior reference for local workspace work:

- Canonical local tools: `read`, `glob`, `grep`, `edit`, `write`,
  `apply_patch`, bounded `bash`, and extension tools such as `officecli`.
- `glob` discovers files by path/name; `grep` searches plaintext/code content;
  exact `read` inspects files and returns bounded content; Office/PDF content
  inspection remains exact `read` after discovery.
- File mutations are under the edit permission class: `edit`, `write`, and
  `apply_patch` are treated as write actions. Prefer `apply_patch` for
  multi-file project creation and coherent edits because it preserves one
  approval surface and one tool observation for a change set.
- `bash` is an execution tool, not a generic fallback for search/read/write.
  Use it for bounded verification, build/test commands, git inspection, and
  explicit shell tasks.
- `question`/ask-user behavior is a permissioned tool, not free text. It should
  be visible only when the harness has decided that the task is blocked by a
  user decision.
- Permissions are policy, not prompt folklore: `allow`, `ask`, and `deny`
  should be applied by middleware before tool execution and should work for
  built-in, extension, and MCP tools.
- A tool call must always produce a structured tool observation or a structured
  refusal/error. Copilot must never be left to infer whether a local operation
  happened.

Relay will use the OpenCode names and semantics. It will not copy OpenCode
internals unless a later policy decision explicitly allows bundling OpenCode as
a runtime dependency.

### Microsoft Agent Framework Mapping

Agent Framework is the harness implementation surface:

- Register every model-visible local capability as an Agent Framework function
  tool or imported local MCP tool. The tool registry is the source of truth for
  both Copilot prompt projection and executor dispatch.
- Use `AgentSession` as the canonical continuity boundary. Approval responses,
  follow-up user messages, and tool observations must resume the same session.
  `runId` is only a UI/diagnostic identifier.
- Use agent-run middleware for admission control, session initialization,
  terminal eligibility, compaction boundaries, and AG-UI event projection.
- Use function-calling middleware for permission checks, approval conversion,
  path policy, workspace boundary checks, tool-result normalization, and audit
  logging.
- Use `IChatClient` middleware around the Copilot CDP adapter for provider
  readiness, prompt/response validation, retries that preserve session state,
  and provider diagnostics.
- Use Agent Framework approval primitives for side-effect tools. For .NET this
  means wrapping approval-required functions and resuming the same session with
  the approval response. The AG-UI HITL bridge should translate approval
  requests/responses; Relay should not invent a second approval protocol.
- Use workflows only for genuinely fixed business processes. The generic
  Workbench remains an agent, because local coding/search/Office tasks are
  open-ended and tool-choice driven.

### Harness State Machine

The harness must have a deterministic state machine outside Copilot prose:

1. `idle`: no active session work.
2. `admitting`: workspace, policy, provider readiness, and tool registry are
   checked before the model sees the task.
3. `running`: Agent Framework sends messages plus the current tool registry to
   Copilot through the CDP-backed `IChatClient`.
4. `tool_requested`: model output contains one or more tool calls accepted by
   Agent Framework.
5. `approval_required`: a side-effect tool is paused and surfaced through
   Agent Framework approval content and AG-UI HITL events.
6. `tool_executing`: Relay executes the approved function tool or MCP tool.
7. `observing`: structured tool results are appended to the same
   `AgentSession`; large outputs are summarized with stable artifact IDs and
   hashes.
8. `continuing`: the same session returns to the model with tool observations.
9. `final_candidate`: a final answer is present, but terminal middleware must
   check pending tools, approvals, required artifacts, and failure state.
10. `finished`: final answer is emitted only after terminal eligibility passes.
11. `blocked`: provider/tool/policy failure that requires a developer or user
    action. Do not silently fallback to a different harness path.

### Terminal Eligibility Rules

Premature final answers, unnecessary `ask_user`, and "local tools unavailable"
messages must be prevented structurally:

- Before each model call, the tool registry projection must be non-empty for
  tasks that require local action. If local tools are unavailable, stop in
  `blocked` before sending to Copilot.
- If the current task has required artifacts, pending approvals, pending tool
  observations, or failed verifications, middleware must reject a plain final
  answer and continue with the appropriate tool surface.
- `question`/ask-user is unavailable unless middleware marks the run as
  genuinely blocked by missing user intent, missing path, missing credentials,
  or an approval decision.
- A final answer may summarize only tool-observed facts. It may propose next
  steps only after the requested local operation either completed or failed
  with a structured error.

### Transcript and Compaction

OpenCode/OpenWork session behavior is the reference for transcript quality:

- Store each turn as user message, assistant tool call, approval request,
  approval response, tool observation, assistant continuation, and final answer.
- Keep stable artifact IDs for created/edited files, command outputs, diffs,
  Office backups, and search result sets.
- Compact only through a deterministic summarizer that preserves objective,
  workspace, completed tool calls, created artifacts, current failures,
  pending approvals, and next required action.
- Never replace the tool transcript with a natural-language summary before the
  agent has finished the task.

### AG-UI Projection

AG-UI is the only UI protocol:

- Agent run lifecycle maps to AG-UI run events.
- Tool calls map to AG-UI tool-call start/args/end/result events.
- Session state maps to AG-UI state snapshots and deltas.
- Approval pauses map to AG-UI human-in-the-loop events.
- Relay-specific diagnostics are support details, not the primary protocol.

### Diagnostics and Evaluation

Every harness defect must be diagnosable from artifacts:

- prompt projection dump generated from the live Agent Framework tool registry;
- provider readiness trace for Edge/Copilot CDP;
- AgentSession transcript export;
- tool registry snapshot;
- permission/approval audit log;
- AG-UI event replay fixture;
- live Copilot E2E canaries for:
  - multi-file project creation;
  - project improvement after creation;
  - local file discovery with `glob`/`grep`/exact `read`;
  - Office file inspect/mutate/verify through `officecli`;
  - approval resume across at least one side-effect tool.

### Non-Goals

- Do not adopt Codex app-server, OpenCode runtime binaries, or OpenAI API
  dependencies in this milestone.
- Do not reintroduce Relay-owned runtime crates, custom run streams, or custom
  tool taxonomies.
- Do not solve Copilot mistakes by adding broad prompt-only recovery rules.
- Do not add fallback paths that hide harness defects. If provider readiness,
  tool registry projection, approval resume, or tool execution is broken, fail
  loudly with a diagnostic artifact.

### Acceptance Gates

The harness redesign is not complete until:

- live Copilot E2E can create a multi-file project and then improve it in the
  same session without duplicate first-step loops;
- side-effect tools pause through Agent Framework approval and resume the same
  `AgentSession`;
- local-action tasks never reach Copilot with an empty/invalid tool registry;
- `ask_user` appears only when terminal middleware marks a true user-blocked
  state;
- `final` is emitted only after terminal eligibility passes;
- AG-UI event replay reconstructs the visible run state; and
- `docs/IMPLEMENTATION.md` records verification commands and results.

## OpenCode-Compatible Tool Contract Migration Plan

This section is the active execution plan after the complex live Copilot E2E
showed that Relay was drifting back into a custom tool/runtime design. The
lesson is explicit: do not keep inventing Relay-specific tool semantics,
recovery rules, or planner state for file/code work. Mature agents have already
converged on a small workspace tool surface. Relay should adopt that surface
and spend engineering effort on Copilot transport, Agent Framework integration,
AG-UI UX, approvals, packaging, and diagnostics.

Reference systems checked for this direction:

- OpenCode built-in tools: `read`, `grep`, `glob`, `bash`, `edit`, `write`,
  `apply_patch`, and MCP extension. This is the closest fit to Relay's required
  local workspace work.
- Codex app-server: useful reference for threads, approvals, sandboxing,
  streaming diffs, MCP integration, and long-lived runtime state. It is a
  complete harness around Codex, not a drop-in runtime while M365 Copilot must
  remain the reasoning controller.
- Microsoft Agent Framework: the active run loop, function tool registration,
  middleware, approvals, and MCP integration layer for Relay.
- AG-UI: the active frontend event/state/tool/approval protocol.

Reference URLs:

- `https://opencode.ai/docs/tools/`
- `https://opencode.ai/docs/mcp-servers/`
- `https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md`
- `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- `https://learn.microsoft.com/en-us/agent-framework/user-guide/agents/agent-tools`
- `https://learn.microsoft.com/en-us/agent-framework/user-guide/model-context-protocol/using-mcp-tools`

Design decisions:

- **Adopt OpenCode-compatible local tools as the model-facing contract.**
  Canonical names are `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`,
  and bounded `bash`. `patch` may remain as a temporary compatibility alias
  only where an older Relay path still emits it, but new model-facing prompts,
  docs, tests, and UX should use OpenCode's `apply_patch` name.
- **Do not build a Relay tool taxonomy.** Relay-specific helpers may exist
  behind the contract, but Copilot should not see Relay-only tool families for
  ordinary file/code work.
- **Use Agent Framework as the tool host.** OpenCode-compatible tools are
  registered as Agent Framework function tools or imported MCP tools. Agent
  Framework middleware handles admission, tool filtering, approval, and
  terminal eligibility.
- **Use AG-UI as the only frontend protocol.** Tool calls, approvals, state,
  errors, and final output are projected through AG-UI events and state.
- **Keep OfficeCLI as an extension tool, not a second planner.** Office work
  should follow the same contract style: inspect/read first, then an approved
  mutation. OfficeCLI can be exposed as a semantic Agent Framework tool or MCP
  server, but it must not create a parallel Office-only planning harness.
- **Prefer existing mechanisms over prompt folklore.** Patch failures,
  repeated reads, early final answers, and unnecessary clarification should be
  addressed by standard tool results, Agent Framework session state, and
  approval/terminal middleware, not by growing ad hoc prompt rules.

Non-goals for this migration:

- Do not adopt Codex app-server as the runtime in this milestone. M365 Copilot
  remains the controller, and Relay cannot require OpenAI API/subscription
  access.
- Do not remove Agent Framework or AG-UI. They are the active run loop and UI
  protocol.
- Do not add new broad Relay-owned tools before the OpenCode-compatible tool
  contract is documented, tested, and used by live E2E.
- Do not silently fallback to unrelated tools when the contract is violated.
  Fail visibly, record diagnostics, and fix the contract.

Migration strategy:

1. Freeze further expansion of Relay-specific model-visible tools and prompt
   recovery rules.
2. Produce an explicit OpenCode-compatible tool contract spec for Relay:
   tool name, description, parameters, result shape, permission class,
   approval behavior, and failure semantics. The active contract artifact is
   `docs/OPENCODE_TOOL_CONTRACT.md`.
3. Rename or alias existing tools to the contract:
   - `rg_files` -> internal alias of `glob`;
   - `rg_search` -> internal alias of `grep`;
   - `patch` -> temporary alias of `apply_patch`;
   - existing exact text replace remains `edit`;
   - file create/replace remains `write`;
   - shell verification remains bounded `bash`.
4. Refactor prompt/tool projection to emit only contract tools from Agent
   Framework registrations.
5. Refactor tests and live E2E to assert OpenCode-compatible behavior instead
   of Relay-specific recovery behavior.
6. Only after the contract is stable, evaluate whether any existing MCP server
   or OpenCode-compatible tool implementation can replace Relay's internal
   implementation bodies.

Acceptance criteria for this plan:

- A model-visible tool inventory dump contains only OpenCode-compatible local
  tools plus documented extension tools such as OfficeCLI.
- Normal code/file E2E completes through `read`/`glob`/`grep`/`edit`/`write`/
  `apply_patch`/`bash` semantics without adding new Relay-only action names.
- `patch` remains accepted only as a compatibility alias and is absent from
  new prompts where OpenCode-compatible `apply_patch` is available.
- Complex project creation and improvement live E2E either succeeds through the
  standard contract or fails with a clear contract/tool-result error; it must
  not trigger new ad hoc Relay planner features.
- Documentation and tests make it clear where Relay implements tool bodies and
  where it merely exposes an existing tool contract through Agent Framework.

Root prevention guarantees:

- This plan can prevent `local tools unavailable`, unnecessary `ask_user`, and
  premature `final` only if those states are made structurally impossible before
  Copilot is called. Prompt wording alone is not an acceptable control.
- `local tools unavailable` prevention:
  - Agent Framework tool registration is the source of truth for local
    capabilities. Run admission must verify that required function tools or
    approved MCP/client tools are registered, enabled, and policy-allowed before
    the Copilot provider call.
  - If the required tool family is missing or blocked, Relay fails the Agent
    Framework run with an AG-UI error before Copilot can answer. Copilot must
    never be asked to explain that local tools are unavailable as a normal
    final answer.
  - Copilot prompts/tool schemas are generated from the actual Agent Framework
    tool inventory and session metadata, not from hand-written static prompt
    text.
- Unnecessary `ask_user` prevention:
  - `ask_user` is an AG-UI client tool / HITL state, not a backend execution
    fallback and not a globally visible action.
  - Agent Framework admission and middleware may expose `ask_user` only when a
    required field is genuinely missing or the user must make a required
    safety/product choice. Known workspace + known objective + available local
    tools means `ask_user` is absent from the model-facing tool set.
  - If Copilot still emits a clarification request outside an allowed
    clarification state, middleware rejects it as a protocol defect and records
    diagnostics; it must not be shown as normal UX.
- Premature `final` prevention:
  - Final assistant output is allowed only when Agent Framework session state
    says terminal criteria are satisfied: required observations exist, required
    reads were performed, required mutations completed or were rejected, and
    pending approvals/clarifications are resolved.
  - Before terminal eligibility, Copilot can only continue through valid
    Agent Framework tool calls, AG-UI client-tool/HITL requests, or a visible
    protocol error. A final-style response while local work is pending is a
    provider/middleware defect, not a user-facing answer.
  - Prevention-clean tests must assert zero guard repairs for normal local
    search, file read, Office edit, and code edit paths. Guard-hit tests remain
    separate regression fixtures.

## Copilot Choice-Error Reduction Design

Research checked on 2026-05-17:

- Microsoft Agent Framework tool guidance says the framework handles the
  tool-calling loop, while tool names/descriptions and registering only the
  needed tools materially affect whether the model selects the right tool.
  Function tools are the right fit for Relay-owned local business logic that
  needs type safety, local resource access, and testability.
- Agent Framework middleware is the official interception point for agent-run,
  function-call, and chat-call validation. Middleware can terminate early for
  validation/security failures, which is the right place to prevent invalid
  local-work turns before Copilot is called.
- Agent Framework + AG-UI HITL guidance uses
  `ApprovalRequiredAIFunction`, approval middleware, and AG-UI client tool
  calls to keep approvals in the framework run instead of custom Relay state.
- AG-UI capabilities allow dynamic discovery of supported tools, state,
  execution limits, and HITL features. AG-UI events include tool-call,
  state-snapshot, state-delta, text, and run-error events that can drive the
  Workbench without a Relay custom run protocol.
- Pydantic AI's AG-UI example is useful prior art because it mixes backend
  agent tools and AG-UI client tools, and demonstrates tools returning AG-UI
  events as part of the stream.
- Magentic-UI is useful product prior art for keeping agents transparent and
  controllable instead of fully autonomous, especially for action-oriented
  local work.

Reference URLs:

- `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/function-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://docs.ag-ui.com/concepts/capabilities`
- `https://docs.ag-ui.com/sdk/js/core/events`
- `https://pydantic.dev/docs/ai/examples/ag-ui/`
- `https://www.microsoft.com/en-us/research/blog/magentic-ui-an-experimental-human-centered-web-agent/`

Design principle:

Relay should not merely catch wrong Copilot choices after the fact. Before each
Copilot provider call, Relay should derive a small **Admissible Action Envelope
(AAE)** from Agent Framework session state, registered tools, AG-UI
capabilities, workspace readiness, and terminal criteria. The AAE is not a new
runtime or a second tool catalog; it is a projection of Agent Framework and
AG-UI state used to narrow Copilot's prompt/tool surface for exactly one step.

The AAE should contain:

- `phase`: `needs_observation`, `needs_exact_read`, `needs_approval`,
  `needs_mutation`, `can_finalize`, `needs_user_input`, or `failed`.
- `allowedActions`: exact tool names, AG-UI client/HITL actions, or `final`.
- `forbiddenActions`: invalid actions for this phase with a short reason.
- `visibleTools`: Agent Framework function tools exposed to Copilot for this
  step.
- `hiddenTools`: registered tools deliberately hidden for this step.
- `terminalCriteria`: the concrete conditions required before `final`.
- `stateId`: stable hash for prompt dumps, AG-UI state, and test assertions.

Policy:

- The Copilot prompt must show only AAE `visibleTools`, never the whole static
  catalog.
- `final` is not a normal option until AAE phase is `can_finalize`.
- `ask_user` is only visible when AAE phase is `needs_user_input`.
- Mutating tools are visible only after enough read/inspection context exists
  to make an approval meaningful; actual execution still uses Agent Framework
  approval primitives.
- `bash` is hidden by default and appears only for explicit verification,
  build, test, git inspection, or user-requested command tasks.
- If AAE cannot produce a safe next action, fail the Agent Framework run with
  AG-UI `RUN_ERROR` before the Copilot provider call.
- Guard repair remains a last-line defect detector. Normal E2E fixtures must
  fail if guard repair was needed.

### Executable Task Queue: Copilot Choice-Error Reduction

1. **CER01: Add an AAE builder derived from framework state.**
   - Status: complete.
   - Scope:
     - Build AAE from Agent Framework run/session metadata, workspace
       readiness, registered tool descriptors, completed tool results,
       pending approvals, and terminal eligibility.
     - Keep the data structure internal to the Copilot adapter/middleware; do
       not expose it as a new public Relay run protocol.
   - Acceptance: local search, exact read, Office inspect/edit, code edit, and
     file creation each produce deterministic AAE phases and allowed actions.
   - Verification: AAE unit/smoke snapshots; `pnpm check`.

2. **CER02: Filter Copilot tool projection from AAE visible tools.**
   - Status: complete.
   - Scope:
     - Replace static prompt tool listing with AAE-filtered tool listing.
     - Add prompt dump assertions for hidden `ask_user`, hidden `bash`, and
       absent `final` before terminal eligibility.
     - Keep all descriptions sourced from Agent Framework function
       registrations.
   - Acceptance: known-objective search prompts expose only search/read/status
     tools; file creation/edit prompts expose mutation tools only when terminal
     policy and approval policy allow them.
   - Verification: prompt-dump fixture tests; `framework-native-prevention`
     smoke; `pnpm check`.

3. **CER03: Move invalid-action prevention into middleware admission.**
   - Status: complete.
   - Scope:
     - Agent-run/chat middleware must compute AAE before Copilot calls.
     - If no legal action exists, terminate with AG-UI `RUN_ERROR` instead of
       asking Copilot to explain the failure.
     - Function-call middleware must verify that each tool call is still
       allowed by the current AAE.
   - Acceptance: missing local tool families, missing workspace, and
     non-terminal final states fail before Copilot-authored final text.
   - Verification: admission smokes for search, read, Office, code, mutation,
     and missing-tool cases; `pnpm check`.

4. **CER04: Publish AAE-derived diagnostics without adding a second run protocol.**
   - Status: complete.
   - Scope:
     - Keep Workbench execution on the official AG-UI endpoint and event
       stream instead of introducing a Relay-specific run wire protocol.
     - Publish AAE snapshots through prompt dumps and support diagnostics so
       tool-choice failures can be correlated with AG-UI run events.
     - Keep raw AAE details behind diagnostics; the user-facing Workbench
       remains driven by AG-UI run/tool/approval/error events.
   - Acceptance: AG-UI run replay still drives the Workbench, while support
     diagnostics can show the AAE phase, visible tools, hidden tools, and
     terminal criteria for each Copilot step.
   - Verification: prompt-dump AAE fixture; support-bundle metrics;
     AG-UI client-tool smoke; browser E2E; `pnpm check`.

5. **CER05: Tighten tool descriptions and schema minimalism.**
   - Status: complete.
   - Scope:
     - Audit every model-visible tool name, description, and parameter schema
       against Agent Framework guidance: concrete purpose, concrete return,
       no vague overlap, no unnecessary parameters for the current phase.
     - Split or hide overloaded operations when they cause poor selection.
     - Keep OfficeCLI breadth behind semantic operations and registry entries,
       not raw argv.
   - Acceptance: tool descriptions explain when to use the tool, when not to
     use it, required parameters, and returned evidence.
   - Verification: catalog snapshot review; golden tool-selection fixtures;
     `pnpm check`.

6. **CER06: Add zero-repair normal-path regression gates.**
   - Status: complete.
   - Scope:
     - Count AAE hidden-tool violations, guard repairs, invalid final
       attempts, and invalid `ask_user` attempts separately.
     - Normal fixtures must assert zero repairs for search, exact read,
       Office inspect/mutation approval, code edit, file creation, and
       verification command tasks.
     - Explicit adversarial fixtures continue to assert visible rejection.
   - Acceptance: Copilot can still be wrong in adversarial fixtures, but normal
     user-like fixtures fail the build if the adapter had to rescue the run.
   - Verification: prevention-clean suite; support-bundle counters; `pnpm
     check`.

7. **CER07: Run live Copilot choice-quality canaries.**
   - Status: complete.
   - Scope:
     - Live signed-in Copilot E2E for local search, exact read, Office
       inspect, Office mutation approval, file creation, code edit, and
       verification.
     - Save prompt dumps, AAE snapshots, AG-UI event logs, and final answers.
   - Acceptance: live canaries complete with no hidden-tool violations, no
     guard repair, no premature final, and no unnecessary `ask_user`.
   - Verification: `pnpm workbench:live-copilot-e2e` plus task-specific live
     canary logs when Edge CDP is available.

## Immediate Task Queue: Relay Protocol State Machine

The live Copilot E2E runs exposed a root reliability issue: M365 Copilot can
still answer as if local tools are unavailable because it only sees local tools
through Relay's Copilot adapter, not as native Microsoft 365 UI tools. Prompt
wording and one-off repair rules are not enough. The active fix is to make
Agent Framework and AG-UI own the deterministic turn/session/event protocol,
while Relay contributes only the Copilot transport adapter, local function
bodies, policy middleware, and diagnostics. Copilot remains responsible for
reasoning, query expansion, summaries, and choosing among the Agent Framework
tools available for the current session state.

The completed RPSM01-RPSM07 slice added the first state-machine safety net.
That is necessary, but it is not the final design. The product target is
**prevention first**: Relay should shape the Copilot turn so invalid responses
are not natural to produce in the first place. `tools unavailable`, unnecessary
`ask_user`, and premature `final` should be treated as design failures in the
prompt/action contract, not normal outputs that the guard routinely catches.

The guard remains only as a last line of defense. The primary path should be:

1. Agent Framework middleware admits the run before each Copilot provider call.
2. Agent Framework exposes only tools valid for the session state.
3. AG-UI state/capability events expose the same valid next actions to the UI.
4. Relay function tools supply required safe local observations before Copilot
   is asked for a conclusion.
5. If Copilot still violates the contract, Relay fails the Agent Framework run
   visibly and the adapter/tool/middleware contract is fixed; it should not
   silently compensate with an unrelated fallback.

1. **RPSM01: Capture protocol-state baseline and failure taxonomy.**
   - Status: completed 2026-05-17.
   - Goal: define the exact failure classes the state machine must prevent.
   - Changes:
     - Document observed failures such as `tools_unavailable_final`,
       `ask_user_after_known_objective`, `final_before_required_tool`,
       `mutation_final_without_mutation`, `bash_cat_instead_of_read`,
       `directory_keyword_glob`, and `lost_original_request_after_tool`.
     - Map each failure class to an expected Relay state transition and a
       regression test or live E2E artifact.
     - Record the taxonomy in `docs/IMPLEMENTATION.md` and, where useful,
       `docs/AGENT_EVALUATION_CRITERIA.md`.
   - Acceptance: every known live Copilot protocol failure has a named class,
     expected behavior, and planned verification.
   - Verification: `git diff --check`.

2. **RPSM02: Introduce a typed Relay turn-state contract.**
   - Status: completed 2026-05-17.
   - Goal: keep the run objective, local-work intent, tool history, approval
     state, and completion rules outside fragile prompt text.
   - Changes:
     - Add a small sidecar contract such as `RelayTurnState` with original user
       request, workspace, inferred local intent, required next capability,
       completed tool calls, pending approval/mutation state, pending output
       target, and terminal eligibility.
     - Derive initial state from the Workbench/AG-UI run input and update it
       after every Copilot response and local tool observation.
     - Keep the state serializable enough for diagnostics and regression
       fixtures.
   - Acceptance: a tool-result-only continuation still carries the original
     objective and knows whether final output is allowed.
   - Verification: sidecar unit/smoke coverage plus `pnpm check`.

3. **RPSM03: Add a protocol guard for Copilot responses.**
   - Status: completed 2026-05-17.
   - Goal: validate Copilot output against the current turn state before the UI
     or executor sees it.
   - Changes:
     - Reject or repair invalid `final`, `ask_user`, and unsupported tool
       choices according to state.
     - Convert known mechanical mistakes only when deterministic, such as
       `bash cat <file>` to `read` and directory-style keyword glob patterns to
       filename-oriented globs.
     - Surface non-deterministic violations as protocol errors with prompt and
       response dumps, rather than trying unrelated fallback paths.
   - Acceptance: `tools unavailable` cannot reach the user as a final answer
     while a local tool is required.
   - Verification: protocol regression tests plus live Copilot smoke.

4. **RPSM04: Move initial local-tool selection into Relay policy.**
   - Status: completed 2026-05-17.
   - Goal: make the first local action deterministic while still letting
     Copilot reason over observations afterward.
   - Changes:
     - For local file search, Relay starts with bounded `glob`/`rg_files` and
       optional `grep` policy based on the user request and workspace.
     - For exact local files, Relay starts with `read`.
     - For Office edits, Relay starts with OfficeCLI readiness/capability or
       workbook inspection before allowing mutation planning.
     - For code work, Relay starts with workspace status and file discovery
       before edits.
   - Acceptance: local-work runs never depend on Copilot deciding that local
     tools exist on the first turn.
   - Verification: deterministic planner tests and live file-search/code-work
     E2E.

5. **RPSM05: Centralize stateful prompt building.**
   - Status: completed 2026-05-17.
   - Goal: keep Copilot prompts concise but complete on every continuation.
   - Changes:
     - Generate prompt sections from `RelayTurnState`: original request,
       current objective, available local tools for this state, completed tool
       observations, required next action, and terminal criteria.
     - Remove duplicated or stale prompt fragments that can cause Copilot to
       echo the prompt or ignore the active objective.
     - Keep prompt dumps tied to run id and state version for reproducibility.
   - Acceptance: after a tool result, Copilot receives the original request and
     cannot reasonably ask what task it should perform next.
   - Verification: prompt fixture tests and live Copilot continuation E2E.

6. **RPSM06: Add protocol regression and live E2E coverage.**
   - Status: completed 2026-05-17.
   - Goal: make the state machine measurable before removing old guards.
   - Changes:
     - Add non-live tests for invalid finals, invalid asks, unsupported tools,
       mutation-without-approval, search continuation, and exact file read.
     - Promote the useful live file-search scenario from temporary script to a
       tracked smoke script if it can run without leaking user data.
     - Record expected artifacts in `docs/IMPLEMENTATION.md`.
   - Acceptance: `pnpm check` covers the deterministic protocol layer; live
     Copilot E2E covers at least one search and one file-writing workflow.
   - Verification: `pnpm check`; `pnpm workbench:live-copilot-e2e`; tracked
     live search smoke when available.

7. **RPSM07: Remove replaced ad hoc prompt guards.**
   - Status: completed 2026-05-17.
   - Goal: keep the final implementation understandable and prevent two
     competing protocol systems.
   - Changes:
     - Replace scattered regex and prompt-only fixes in the Copilot bridge with
       calls into the state machine, protocol guard, and initial-tool policy.
     - Keep only small deterministic normalizers that have tests and are called
       from the guard layer.
     - Update README/AGENTS/implementation notes if user-visible behavior or
       debugging instructions change.
   - Acceptance: the local-tool protocol is enforced in one obvious place, with
     no hidden fallback runner or duplicated legacy path.
   - Verification: `pnpm check`; live Copilot search and file-writing E2E;
     `git diff --check`.

### Framework-Native Prevention Queue

These tasks correct the design direction after RPSM01-RPSM07. They should be
implemented before adding more feature breadth. The goal is to make invalid
Copilot actions unlikely by construction, not merely intercepted after the
fact.

Research checked on 2026-05-17:

- Microsoft Agent Framework workflows distinguish LLM-driven agents from
  explicitly defined workflows, and support typed executors, conditional
  routing, events, checkpointing, and HITL.
- Microsoft Agent Framework tools expose explicit function schemas, can hide
  runtime-only context from model-visible parameters, and support
  declaration-only tools when execution is supplied by the application.
- Microsoft Agent Framework middleware provides the official interception
  points for run-level, function-call, and chat-call validation, telemetry, and
  policy.
- The Agent Framework + AG-UI HITL pattern routes sensitive actions through
  approval events instead of letting the model directly execute them.
- AG-UI defines streaming lifecycle, state, activity, and tool-call events, and
  its capabilities model lets the UI adapt to the tools and state an agent
  actually supports at runtime.
- Microsoft's Agent Framework samples and DevUI examples structure advanced
  features as agents, tools, RAG/file-search, workflows, tracing/evaluation,
  and DevUI-compatible entities rather than a separate app-specific run
  protocol.
- Prior AG-UI integrations such as Pydantic AI demonstrate the same pattern:
  keep the backend agent/framework-specific, then expose it through AG-UI
  events and tools for the frontend.

Reference URLs:

- `https://learn.microsoft.com/en-us/agent-framework/workflows/`
- `https://learn.microsoft.com/en-us/agent-framework/agents/tools/function-tools`
- `https://learn.microsoft.com/en-us/agent-framework/agents/middleware/`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop`
- `https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/`
- `https://github.com/microsoft/Agent-Framework-Samples`
- `https://learn.microsoft.com/en-us/agent-framework/devui/samples`
- `https://docs.ag-ui.com/concepts/events`
- `https://docs.ag-ui.com/concepts/tools`
- `https://docs.ag-ui.com/concepts/capabilities`
- `https://docs.ag-ui.com/concepts/state`
- `https://docs.ag-ui.com/concepts/middleware`
- `https://pydantic.dev/docs/ai/examples/ag-ui/`

Design correction from that research:

- Relay should stop growing a Relay-owned run protocol. The canonical run
  lifecycle should be Agent Framework `Agent` / `AgentSession` /
  tool-middleware state projected to AG-UI lifecycle, tool, state, approval,
  and error events.
- Local work should be represented as Agent Framework functions, approval
  wrappers, middleware, and, only when the sequence is truly fixed, Workflow
  executors/edges. Relay-specific state should be a projection/cache of that
  canonical framework state, not the authority.
- Copilot remains the reasoning controller through a custom Agent
  Framework-compatible chat provider. That provider is the only place where
  Relay compensates for M365 Copilot's non-API browser transport.
- AG-UI state/capability events should describe valid next actions to the UI;
  the model-facing tools should come from the same Agent Framework tool set and
  middleware decisions, not from a parallel prompt-only catalog.
- The prompt guard remains a last-line invariant. Guard hits in normal
  scenarios are bugs in the Agent Framework tool registration, middleware,
  AG-UI projection, or Copilot provider adapter.

1. **PFP01: Move run admission into Agent Framework middleware.**
   - Status: complete.
   - Goal: prevent generic Copilot chat turns without introducing a parallel
     Relay runtime.
   - Changes:
     - Implement admission as Agent Framework run/chat middleware that validates
       workspace, objective, session, available tools, and policy before the
       Copilot provider is called.
     - Store admission metadata in Agent Framework session/context metadata and
       AG-UI state snapshots, not in a separate Relay-only run-state authority.
     - Fail the Agent Framework run with an AG-UI error event if admission
       cannot determine a safe local-work context.
   - Acceptance: every local-work prompt dump and AG-UI state snapshot has the
     same Agent Framework session/run identity; no prompt is emitted outside an
     admitted Agent Framework run; missing local tools fail before Copilot is
     called and never become a Copilot-authored final answer.
   - Verification: middleware fixture tests for search, exact read, Office
     edit, code edit, missing workspace, and ambiguous destructive intent;
     `pnpm check`.

2. **PFP02: Use Agent Framework tools as the single model-facing catalog.**
   - Status: complete.
   - Goal: remove Relay's separate action schema as a competing tool system.
   - Changes:
     - Register local capabilities as Agent Framework function tools or
       approved MCP tools with typed schemas and descriptions.
     - Use Agent Framework middleware to filter or terminate unavailable tools
       by session state instead of maintaining an independent Relay
       prompt-only catalog.
     - Use AG-UI client tools only for user-facing interaction such as approval
       or clarification, following the AG-UI tool/HITL pattern.
     - Keep any Copilot JSON repair limited to adapting browser text into
       Agent Framework-compatible tool calls; it must not define a second
       product contract.
   - Acceptance: there is one exported tool inventory, derived from Agent
     Framework registrations and AG-UI client tools; prompt dumps cannot name a
     tool absent from that inventory; `ask_user` is absent unless the admitted
     state explicitly requires clarification.
   - Verification: Agent Framework tool inventory snapshots; AG-UI capability
     snapshots; live Copilot search/code E2E.

3. **PFP03: Project Agent Framework state to AG-UI state/capabilities.**
   - Status: complete.
   - Goal: make UI state and model state share the same source of truth.
   - Changes:
     - Emit AG-UI `STATE_SNAPSHOT` and `STATE_DELTA` from Agent Framework
       session/run metadata, tool observations, pending approvals, artifacts,
       and terminal state.
     - Use AG-UI capabilities to expose supported tool families, HITL support,
       streaming support, and state support to the Workbench.
     - Remove Workbench dependencies on Relay-only run-state fields where an
       AG-UI event/state field can express the same fact.
   - Acceptance: the main Workbench UI can be reconstructed from AG-UI
     lifecycle/text/tool/state/error events plus capabilities, without a Relay
     custom run event union; the UI can determine whether the run is
     non-terminal, waiting for HITL, failed, or final from AG-UI state alone.
   - Verification: AG-UI replay fixture; browser E2E from recorded AG-UI
     events; `pnpm check`.

4. **PFP04: Use Agent Framework approval primitives for mutations.**
   - Status: complete.
   - Goal: remove custom approval state machines from normal mutation flow.
   - Changes:
     - Wrap write/edit/apply-patch/Office mutation functions with Agent
       Framework approval primitives such as `ApprovalRequiredAIFunction` or
       `approval_mode="always_require"` where applicable.
     - Convert approval requests to AG-UI client-tool or HITL events using the
       official Agent Framework AG-UI integration path where available.
     - Resume the same Agent Framework session with the approval response.
       Relay may persist an audit copy, but that copy is not the runtime source
       of truth.
   - Acceptance: a mutation can pause, render approval, approve/reject, resume,
     and complete using Agent Framework + AG-UI approval flow without the old
     Relay approval stream.
   - Verification: approval smoke for exact text edit and OfficeCLI mutation;
     `pnpm check`.

5. **PFP05: Express deterministic local sequences as workflows only when real.**
   - Status: complete.
   - Goal: use Agent Framework workflows for fixed business processes without
     turning every task into a custom Relay planner.
   - Changes:
     - Keep open-ended work as Agent Framework agents with tools.
     - Use Workflow executors/edges only for fixed sequences such as
       `inspect Office file -> propose mutation -> approval -> execute ->
       verify`, or `discover files -> read selected evidence -> summarize`.
     - Document each workflow's entry condition, exit condition, approval
       point, and emitted AG-UI state before implementation.
   - Acceptance: no new Relay scheduler or mini-workflow engine is added; fixed
     local sequences are either Agent Framework workflows or ordinary
     agent+tool runs.
   - Verification: workflow admission matrix; workflow smoke if a workflow is
     implemented; `pnpm check`.

6. **PFP06: Move prevention checks into middleware and tests.**
   - Status: complete.
   - Goal: turn `tools unavailable`, premature `final`, and unnecessary
     `ask_user` into framework-level test failures instead of prompt folklore.
   - Changes:
     - Implement run/chat/function middleware that records tool availability,
       local-observation requirements, approval requirements, and terminal
       eligibility.
     - Fail prevention-clean tests if the Copilot provider emits a response
       that bypasses required Agent Framework tool/approval flow.
     - Keep prompt repair only as a compatibility adapter for M365 Copilot's
     browser transport, with counters proving it is not the normal path.
   - Acceptance: deterministic smokes assert zero guard replacements for normal
     local search, file creation, Office inspect, and code edit paths; explicit
     fixtures prove `local_tools_unavailable_final`, unnecessary `ask_user`,
     and premature `final` are rejected before user-visible completion.
   - Verification: Agent Framework middleware tests; AG-UI replay tests;
     `pnpm check`.

7. **PFP07: Add live Copilot framework-native acceptance.**
   - Status: complete.
   - Goal: prove the official-framework path works with real signed-in M365
     Copilot.
   - Changes:
     - Store prompt/response dumps and AG-UI event logs for live local search,
       exact read, Office inspect/mutation approval, and file-creation canaries.
     - Assert each live run uses Agent Framework session/tool/approval flow and
       emits replayable AG-UI events.
     - Treat missing official-framework projection, Copilot transport drift,
       or invalid schema as a failing run requiring code changes.
   - Acceptance: live Copilot can complete the local-work canaries through the
     Agent Framework + AG-UI path without falling back to a Relay custom run
     protocol.
   - Verification: `pnpm workbench:live-copilot-e2e` plus tracked live
     local-work E2E when signed-in Edge CDP is available.

### Executable Task Queue: Framework-Native Prevention Cutover

This is the implementation breakdown for the framework-native prevention plan
above. Execute in order unless a task explicitly states that it can run in
parallel. Each task must leave an artifact and a verification entry in
`docs/IMPLEMENTATION.md` before it can be marked complete.

1. **FNP00: Capture the current framework/protocol baseline.**
   - Status: complete.
   - Goal: make the migration measurable before code changes.
   - Scope:
     - Inventory the active Agent Framework registrations, local tool function
       names, AG-UI event endpoints, Relay-only run/event fields, Copilot prompt
       builders, and guard/repair counters.
     - Mark each item as `keep`, `replace-with-framework`, `adapter-only`, or
       `remove`.
   - Artifact: `docs/FRAMEWORK_NATIVE_CUTOVER.md` with the baseline matrix.
   - Acceptance: the matrix identifies every active path that can still emit
     `local tools unavailable`, unnecessary `ask_user`, or premature `final`.
   - Verification: `git diff --check`; `pnpm check` if code fixtures are added.

2. **FNP01: Add Agent Framework run-admission middleware.**
   - Status: complete.
   - Goal: stop invalid local-work runs before the Copilot provider is called.
   - Scope:
     - Add middleware that validates workspace, user objective, session id,
       enabled tool families, policy scope, and whether a local observation or
       approval is required.
     - Persist admission state in Agent Framework session/context metadata and
       project it to AG-UI state.
     - If required local tools are missing, fail with an AG-UI error before
       calling Copilot.
   - Acceptance: missing `glob`/`grep`/`read`/OfficeCLI/edit tools cannot become
     a Copilot-authored final answer.
   - Verification: admission unit tests for search, exact read, Office edit,
     code edit, missing workspace, and missing tool family; `pnpm check`.

3. **FNP02: Make Agent Framework tool registration the single catalog.**
   - Status: complete.
   - Goal: remove the separate Relay prompt-only tool catalog as a source of
     truth.
   - Scope:
     - Export one tool inventory from Agent Framework function tools plus AG-UI
       client tools.
     - Ensure prompt projection, support bundles, AG-UI capabilities, and tests
       all read from that inventory.
     - Keep legacy provider names only behind descriptors; public names are
       `glob`, `grep`, `read`, `officecli`, `officecli_mutate`, `edit`,
       `write`, `apply_patch`, `workspace_status`, `diff`, `bash`, and AG-UI
       `ask_user`.
   - Acceptance: no prompt or AG-UI capability can mention a tool absent from
     Agent Framework registration.
   - Verification: tool inventory snapshot test; AG-UI capability snapshot
     test; `pnpm check`.

4. **FNP03: Convert `ask_user` into a state-scoped AG-UI client tool.**
   - Status: complete.
   - Goal: make unnecessary clarification structurally unavailable.
   - Scope:
     - Remove `ask_user` from the global backend tool set.
     - Expose it only as an AG-UI client/HITL tool when admission middleware
       marks required clarification as valid.
     - Add middleware rejection for clarification attempts outside that state.
   - Acceptance: known workspace + known objective + available local tools
     produces no model-visible `ask_user`.
   - Verification: prompt/tool snapshot tests for search, Office edit, code
     edit, and missing-workspace clarification; `pnpm check`.

5. **FNP04: Add terminal-eligibility middleware.**
   - Status: complete.
   - Goal: prevent premature final answers while local work is pending.
   - Scope:
     - Track required observations, required exact reads, pending approvals,
       mutation completion/rejection, and tool errors in Agent Framework session
       metadata.
     - Reject final-style Copilot responses until terminal criteria are true.
     - Emit AG-UI state updates for `non_terminal`, `waiting_for_tool`,
       `waiting_for_approval`, `failed`, and `terminal`.
   - Acceptance: a final answer cannot reach the Workbench before required
     local observations or approval outcomes exist.
   - Verification: middleware tests for file search, exact read, Office
     mutation, code edit, and failed tool preflight; AG-UI replay test;
     `pnpm check`.

6. **FNP05: Project Agent Framework state to AG-UI state and capabilities.**
   - Status: complete.
   - Goal: remove Relay-only state from the main Workbench path.
   - Scope:
     - Emit `STATE_SNAPSHOT` / `STATE_DELTA` from Agent Framework session/run
       metadata and tool observations.
     - Emit AG-UI capabilities for streaming, tools, state, HITL, and supported
       local tool families.
     - Update Workbench rendering to use AG-UI state/capability data for main
       status, tool activity, approval state, and final output.
   - Acceptance: a recorded AG-UI event stream can replay the visible run
     without custom Relay run-event fields.
   - Verification: AG-UI replay fixture; browser E2E from recorded events;
     `pnpm check`.

7. **FNP06: Cut mutating tools to Agent Framework approval primitives.**
   - Status: complete.
   - Goal: remove the custom approval stream from normal mutation flow.
   - Scope:
     - Wrap `edit`, `write`, `apply_patch`, and `officecli_mutate` using Agent
       Framework approval primitives.
     - Project approval requests to AG-UI HITL/client-tool events.
     - Resume the same Agent Framework session with approve/reject responses and
       keep Relay backups/diffs/audit records as side effects.
   - Acceptance: approve/reject for text edit and Office mutation works without
     the old Relay custom approval path.
   - Verification: approval smoke for text edit; approval smoke for
     OfficeCLI mutation; AG-UI event replay; `pnpm check`.

8. **FNP07: Convert remaining local-tool observations to Agent Framework
   function results.**
   - Status: complete.
   - Goal: make local observations part of the framework run, not a separate
     Relay continuation system.
   - Scope:
     - Ensure `glob`, `grep`, `read`, `officecli`, `workspace_status`, `diff`,
       and bounded `bash` return typed Agent Framework function results.
     - Keep output caps, path redaction, evidence states, and artifact ids in
       result payloads and AG-UI state.
     - Remove any remaining Workbench dependency on a Relay-only observation
       channel for these tools.
   - Acceptance: Copilot continuation receives observations through Agent
     Framework tool results, and the UI receives them through AG-UI events/state.
   - Verification: golden smokes for `glob -> read`, `grep -> read`,
     `read -> edit -> diff`, Office inspect, and bounded test command;
     `pnpm check`.

9. **FNP08: Define workflow admission criteria and implement only proven
   workflows.**
   - Status: complete.
   - Goal: use Agent Framework workflows where sequences are fixed, without
     inventing a Relay scheduler.
   - Scope:
     - Add a workflow admission matrix for open-ended agent runs vs fixed
       workflows.
     - Define entry/exit/approval/state emissions for any implemented workflow.
     - Start with at most two fixed workflows if justified by current usage:
       Office mutation flow and evidence-backed file summary flow.
   - Acceptance: no new workflow can be added without documented entry/exit
     criteria and AG-UI state emissions.
   - Verification: workflow admission matrix in
     `docs/FRAMEWORK_NATIVE_CUTOVER.md`; workflow smoke only if implemented;
     `pnpm check`.

10. **FNP09: Add prevention-clean and guard-regression test suites.**
    - Status: complete.
    - Goal: prove the three failure classes are structurally blocked.
    - Scope:
      - Create prevention-clean fixtures that must produce zero guard repairs
        for normal search, exact read, Office edit, code edit, and file
        creation.
      - Create explicit guard-regression fixtures for
        `local_tools_unavailable_final`, unnecessary `ask_user`, premature
        `final`, unsupported tool, and final-before-approval.
      - Add counters to support bundles and test output.
    - Acceptance: normal paths fail the test if they require guard repair;
      regression paths fail before user-visible completion.
    - Verification: prevention-clean suite; guard-regression suite;
      `pnpm check`.

11. **FNP10: Run live Copilot framework-native E2E.**
    - Status: complete.
    - Goal: verify the design against real M365 Copilot, not only fixtures.
    - Scope:
      - Run live canaries for local file search, exact file read, Office
        inspect/mutation approval, and file creation/code edit.
      - Save prompt dumps, Copilot response dumps, Agent Framework session/tool
        logs, AG-UI event logs, and screenshots where applicable.
      - Treat any `local tools unavailable`, unnecessary `ask_user`, premature
        `final`, schema drift, send failure, or response extraction failure as a
        blocking defect.
    - Acceptance: live canaries complete through Agent Framework + AG-UI with
      zero prevention-clean guard repairs.
    - Verification: `pnpm workbench:live-copilot-e2e`; tracked live local-work
      E2E artifacts; `git diff --check`.

12. **FNP11: Remove superseded Relay-only protocol paths and update docs.**
    - Status: complete.
    - Goal: prevent future contributors from reusing old custom paths.
    - Scope:
      - Remove or clearly quarantine Relay-only run streams, custom approval
        paths, stale prompt-only catalogs, and old protocol guard entry points
        superseded by Agent Framework/AG-UI.
      - Update `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`,
        `docs/AGENT_EVALUATION_CRITERIA.md`, and support-bundle documentation.
      - Keep the hard-cut guard aligned with the new canonical architecture.
    - Acceptance: docs and active code agree that Agent Framework + AG-UI is
      the only run/event/tool protocol, with Relay-specific code limited to the
      Copilot adapter, local function bodies, policy, packaging, and diagnostics.
    - Verification: `node scripts/check-hard-cut-guard.mjs`; `pnpm check`;
      `git diff --check`.

## UI/UX Direction

The Workbench must feel like a focused professional work surface, not a
general chat demo, dashboard, or diagnostics console. The visual goal is:

> **A spacious, quiet agent workbench where the user sees only the next useful
> action, the current agent state, and the evidence needed to trust a result.**

Design principles:

- **Maximize whitespace as structure.** Use generous page margins, vertical
  rhythm, and a narrow reading/composition width before adding borders, cards,
  or explanatory panels. Empty space is the primary grouping tool.
- **One primary path.** Keep one workspace selector, one task composer, one
  visible run state, one result area, and one approval/diff surface. Do not
  reintroduce separate `資料を探す`, `Officeファイルを編集する`, or `コードを書く`
  modes as top-level UX.
- **Progressive disclosure only.** Diagnostics, raw AG-UI payloads, support
  bundle facts, tool JSON, and implementation detail belong behind collapsed
  `Details` or support export surfaces. They must not compete with the main
  work area.
- **Concise state over explanatory copy.** Prefer short labels such as
  `Ready`, `Running`, `Waiting`, `Done`, `Failed`, and `Stopped` plus visible
  activity rows. Avoid permanent instructional text that explains the product
  instead of helping the current task.
- **Beautiful minimalism, not sparse incompleteness.** The UI may be quiet, but
  it must still show agent progress, tool calls, approvals, errors, final
  answers, and diff/backup consequences clearly.
- **Trust through restraint.** Use a professional warm-light default theme,
  subtle borders, restrained shadows, Inter typography, and the existing
  `--ra-*` token system in `apps/workbench/src/styles.css`. Avoid playful
  visuals, emoji icons, AI purple/pink gradients, marketing hero layouts,
  decorative blobs, and card-heavy dashboard chrome.
- **Stable interaction.** Buttons, inputs, approvals, and result rows must have
  fixed dimensions or responsive constraints so text, loading states, hover
  states, and icons do not shift layout.
- **Accessibility is part of the aesthetic.** Inputs need real labels, dynamic
  run updates need `aria-live`, keyboard focus must remain visible, and reduced
  motion must be respected. Minimal UI is not allowed to hide focus, status, or
  errors.

Surface budget:

| Surface | Visible by default | Hidden by default |
| --- | --- | --- |
| Header | Product mark/name and compact readiness pill | version/build diagnostics |
| Composer | Workspace path, task input, send/stop action | provider internals |
| Activity | short agent/tool/status rows | raw payload, full traces |
| Result | final answer or error summary | support-only metadata |
| Approval | action summary, target, approve/reject | raw tool arguments |
| Details | collapsed entry point | raw AG-UI events, status JSON |

Acceptance criteria for future UI work:

- First paint shows a calm Workbench, not a setup/debug screen, when the sidecar
  is reachable.
- A new user can identify the workspace, write a task, and send it without
  reading explanatory blocks.
- During a run, the user can distinguish thinking/executing, waiting for
  approval, failed, stopped, and completed states without opening details.
- Result and approval surfaces preserve enough evidence to trust the action
  while keeping raw JSON and local diagnostics out of the primary view.
- The layout remains polished at 375px, 768px, 1024px, and 1440px without
  horizontal scroll, overlapping text, or layout jumps.
- Every UI change that affects the primary flow should update
  `scripts/workbench-ux-e2e.mjs` or an equivalent visual/behavioral check.

### Executable Task Queue: Workbench UI/UX Refinement

These tasks convert the UI/UX direction into implementable work. They should be
done in order because each task narrows the visible surface before the next one
polishes interaction detail. Do not add new product modes or diagnostic-first
surfaces while executing this queue.

1. **WBUX01: Capture the current Workbench UX baseline.**
   - Status: completed 2026-05-16.
   - Goal: make the current state measurable before visual changes.
   - Changes:
     - Run the existing Workbench UX E2E flow and keep the generated
       screenshots as the comparison baseline.
     - Add a short baseline note to `docs/IMPLEMENTATION.md` covering first
       paint, composer, activity, result, approval, details, and mobile risk.
     - Identify any visible explanatory or diagnostic text that should move
       behind disclosure in later tasks.
   - Acceptance: baseline screenshots and notes exist before style changes.
   - Verification: `pnpm workbench:ux-e2e`; `git diff --check`.

2. **WBUX02: Refine visual tokens and whitespace layout.**
   - Status: completed 2026-05-16.
   - Goal: make the Workbench spacious, quiet, and professional at the token
     and layout level.
   - Changes:
     - Update `apps/workbench/src/styles.css` spacing, shell width, section
       rhythm, typography scale, border strength, and shadow usage through
       `--ra-*` tokens and local utilities.
     - Reduce dense card framing; keep cards only where they frame an actual
       tool surface such as composer, result, approval, activity, or details.
     - Preserve warm-light default theme and avoid decorative gradients, blobs,
       emoji icons, and dashboard-like chrome.
   - Acceptance: first paint reads as a calm work surface with clear hierarchy
     and no crowded panels.
   - Verification: `pnpm workbench:ux-e2e`; screenshots at desktop and mobile
     widths; `pnpm check`.

3. **WBUX03: Simplify composer and first-run surface.**
   - Status: completed 2026-05-16.
   - Goal: keep only the minimum visible controls needed to start work.
   - Changes:
     - Review `apps/workbench/src/App.tsx` composer/header copy and remove
       permanent explanatory text that is not needed for the current action.
     - Keep workspace, task input, readiness, refresh, and send/stop controls.
     - Keep workspace history compact and non-dominant.
     - Ensure first-run/limited states show concise errors without exposing raw
       provider internals by default.
   - Acceptance: a new user can choose or confirm workspace, type a task, and
     send without reading instructions.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

4. **WBUX04: Improve activity and result hierarchy.**
   - Status: completed 2026-05-16.
   - Goal: make agent progress and final output obvious without turning the UI
     into a log viewer.
   - Changes:
     - Rework activity rows so status, tool calls, approval waits, failures,
       cancellation, and completion have short, scannable labels.
     - Keep final answer/error summary visually above raw activity details.
     - Move raw AG-UI payloads and verbose traces behind the existing collapsed
       details surface.
   - Acceptance: users can distinguish `Running`, `Waiting`, `Failed`,
     `Stopped`, and `Done` without opening details.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

5. **WBUX05: Refine approval, diff, and evidence surfaces.**
   - Status: completed 2026-05-16.
   - Goal: make risky actions understandable without showing raw tool JSON by
     default.
   - Changes:
     - Improve the approval card hierarchy for operation, target, consequence,
       backup/diff pointers when available, and approve/reject controls.
     - Keep raw arguments collapsed.
     - Ensure mutating actions never execute before approval and that rejection
       is visibly non-destructive.
   - Acceptance: the user can understand what will change and can reject it
     confidently from the primary surface.
   - Verification: `pnpm workbench:ux-e2e`; approval/rejection assertions;
     `pnpm check`.

6. **WBUX06: Complete responsive and accessibility pass.**
   - Status: completed 2026-05-16.
   - Goal: make the minimal UI usable and polished across desktop and mobile.
   - Changes:
     - Verify layout at 375px, 768px, 1024px, and 1440px.
     - Ensure labels use `htmlFor`, dynamic updates use `aria-live`, keyboard
       focus is visible, click targets are stable, and reduced motion is
       respected.
     - Prevent horizontal scroll, overlapping text, layout shifts, and
       truncated critical labels.
   - Acceptance: primary task execution remains comfortable on small and large
     screens with keyboard and screen-reader basics intact.
   - Verification: `pnpm workbench:ux-e2e`; targeted accessibility assertions
     or documented manual checks; `pnpm check`.

7. **WBUX07: Lock the refined UX with acceptance artifacts.**
   - Status: completed 2026-05-16.
   - Goal: prevent regressions back to cluttered or diagnostic-first UI.
   - Changes:
     - Update `scripts/workbench-ux-e2e.mjs` assertions for first paint,
       visible surface budget, run-state clarity, approval clarity, collapsed
       details, and responsive screenshots.
     - Record the final screenshots and verification commands in
       `docs/IMPLEMENTATION.md`.
     - Add any necessary guard text to `PLANS.md` if implementation reveals a
       recurring anti-pattern.
   - Acceptance: future UI regressions fail automated checks or have an
     explicit documented reason.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`; `git diff --check`.

## Architecture

- Chosen UI shell: AG-UI-first browser-hosted local web workbench served by the
  Relay sidecar. The final product must not depend on Tauri IPC, WebView
  behavior, or Tauri packaging. Existing Workbench code may be reused only when
  it conforms to the AG-UI client/event model and the AG-UI-inspired visual
  interaction model.
- Backend adoption policy: Microsoft Agent Framework is the target production
  backend agent runtime, not merely a reference design. Relay should use the
  .NET Agent Framework agent, tool, approval, session, middleware, and
  streaming model as the main run harness. The Relay-owned custom runner is a
  transitional implementation detail to be removed, not a parallel workflow
  fallback.
- AG-UI adoption policy: AG-UI is no longer only a reference. It is the target
  external UI contract and UX model for agent runs, streaming messages, tool
  calls, human-in-the-loop approvals, state updates, interrupts/resume, and run
  completion. Prefer Microsoft Agent Framework's official ASP.NET Core AG-UI
  integration, such as `MapAGUI`, for Workbench-facing streams. Relay may add a
  narrow adapter only where M365 Copilot CDP transport or local governance needs
  Relay-specific behavior.
- Frontend adoption policy: use `@ag-ui/client` or the closest official AG-UI
  client primitives as the frontend runtime contract. If the best maintained
  AG-UI/CopilotKit visual components require React, migrate the Workbench
  frontend deliberately to that stack instead of keeping a divergent hand-rolled
  UI. The visual result must remain quiet, professional, spacious, and
  Relay-branded.
- Frontend stack decision: migrate the Workbench to **React + Vite +
  TypeScript + Tailwind CSS + shadcn/ui + Radix UI + `@ag-ui/client`**.
  Next.js is not the default because Relay's .NET sidecar already owns local
  serving, API routes, SSE, auth token validation, and packaging. Chakra UI is
  not the default design system because Relay needs AG-UI-aligned agent
  surfaces, owned component code, low visual overhead, and precise styling
  control.
- Removed shell targets: AionUi, OpenCode/OpenWork web shells, Tauri desktop
  shell, and any diagnostic-first shell are not fallback paths. They must be
  deleted from active product code, release workflows, package resources, and
  runtime launch paths during the cutover.
- Relay sidecar role: host the local web UI, expose local HTTP/WebSocket APIs,
  host the .NET Agent Framework runtime, validate and execute Relay local tools,
  manage app-local storage, and supervise the Copilot CDP bridge. The active
  implementation is the Relay-owned self-contained .NET sidecar with Agent
  Framework as the backend run harness.
- Sidecar Copilot transport: the active sidecar owns the Relay M365 Copilot
  provider adapter. Implement this as `RelayCopilotChatClient` or an equivalent
  Agent Framework-compatible adapter that turns Agent Framework model requests
  into Edge CDP operations against M365 Copilot. A local OpenAI-compatible
  surface may remain as an internal compatibility seam only when it helps wire
  Agent Framework clients; it is not a second runtime. The historical
  Node/Tauri-era bridge is no longer the active product path.
- Browser role: the user opens the Relay Workbench at a localhost URL. This
  browser surface is separate from the controlled Edge/Copilot CDP session.
  If Edge is used for both, Relay must use a separate profile or CDP boundary
  so the workbench does not interfere with Copilot automation.
- Primary LLM controller: M365 Copilot via Edge CDP, started on demand rather
  than during first paint.
- Agent harness: the production path is Microsoft Agent Framework inside the
  Relay sidecar. Agent Framework owns agent turns, typed tools, session state,
  approvals, streaming updates, and run lifecycle. Relay owns the M365 Copilot
  provider adapter, local tool implementations, validation, approval policy,
  backups, diffs, storage, and diagnostics.
- Copilot transport shape: use the sidecar-owned Agent Framework-compatible
  Copilot adapter. Stable behavior from the historical Node/Tauri bridge may be
  ported into this adapter, but the final product must not keep a separate
  Node/Tauri-era bridge as an alternate runtime path. Copilot transport is
  fail-fast: prompt delivery failure, send failure, response extraction failure,
  schema validation failure, stale response pickup, or DOM selector drift fails
  the run with diagnostics instead of silently falling back to another planner
  or weaker execution path.
- Corporate-approved LLM posture: Relay uses M365 Copilot as the single primary
  reasoning engine. Do not introduce a two-brain UX, OpenAI API dependency,
  Codex authentication dependency, or unapproved third-party agent binary.
  Ollama is out of current release scope; it may be reconsidered only by a
  future ADR that does not create a second user-visible planning path.
- Rebranding policy: user-facing Relay-owned files, docs, labels, generated
  artifacts, and release surfaces should use `Relay` / `relay` naming. Keep
  upstream or integration names such as `Codex app-server`, `codex` CLI
  commands, `CODEX_HOME`, OpenCode/OpenWork compatibility terms, and third-party
  package identifiers unchanged when they refer to the external substrate rather
  than the Relay product brand.
- Compliance-safe packaging policy: Relay must not hide, obfuscate, or
  deceptively rename third-party binaries or metadata to evade internal local
  file checks. If direct use or redistribution of upstream Codex artifacts is
  not acceptable for the corporate environment, the product plan is to remove
  those artifacts from the shipped release or replace them with an approved
  Relay-owned adapter/runtime boundary. Branding cleanup is allowed only for
  Relay-owned files and user-facing product surfaces; third-party dependency
  notices, licenses, and integration names must remain accurate.
- Next agentic direction: Copilot becomes the reasoning source for intent
  understanding, next-step planning, tool choice, observation review, and final
  synthesis, but the **run loop is Agent Framework**. Relay is the function
  body/policy layer for validation, permissions, local execution, backups,
  diffs, and trace logging.
- Agent loop: fixed one-shot pipelines will be replaced by a bounded Agent
  Framework run loop: `Copilot provider response -> Agent Framework tool call
  -> Relay function body -> Agent Framework observation -> Copilot provider
  response`. The loop must be capped, traceable, and schema-validated.
  Validation failures stop the Agent Framework run and surface an AG-UI error;
  there is no fallback execution.
- Agent loop simplicity: the shipped UX should expose one reasoning path backed
  by Agent Framework and AG-UI. No secondary model, alternate run stream, or
  Relay-specific planner is part of the current product path.
- Tool broker: move from domain-specific high-level tools to a small generic
  Agent Framework tool set. The catalog should support many local business
  tasks; local file search, Office editing, and coding are high-frequency
  recipes that use the same primitives, not separate product modes. Initial
  target tools are:
  - `glob`: enumerate likely files using ripgrep's file listing and glob
    filters;
  - `grep`: search plaintext/code content using ripgrep;
  - `read`: read exact files, including Relay-supported plaintext extraction
    for Office/PDF where available;
  - `officecli`: inspect or mutate Office files through validated OfficeCLI
    semantic operations and locally compiled argv;
  - `edit`: exact-string file edits inside the selected workspace;
  - `write`: new file creation or complete rewrite, only after approval;
  - `workspace_status`: inspect repository/workspace state such as dirty files,
    changed paths, tool readiness, and app-local run metadata without mutating
    anything;
  - `diff`: show pending or applied text/Office/code changes in a stable,
    reviewable format;
  - `bash` or `run_command`: execute bounded verification commands such as
    build, test, lint, typecheck, format-check, or explicit user-approved
    project commands;
  - `ask_user`: AG-UI client tool for missing information;
  - final answer: normal Agent Framework assistant output, not a Relay backend
    tool.
- Tool schema policy: keep the initial Copilot context small by relying on
  Agent Framework tool schemas, middleware, and session context. Validation
  failures stop the Agent Framework run and surface a clear AG-UI error. Do
  not silently execute fallback tools when Copilot emits invalid arguments.
- Search direction: do not keep investing in a custom high-level search product
  as the main UX. Search becomes a generic Agent Framework capability built on
  ripgrep-backed `glob`/`grep`, exact `read`, and Copilot synthesis over
  Agent Framework tool observations. Relay still owns path constraints, timeout
  budgets, result caps, and evidence packaging.
- Search quality policy: Relay should report evidence states, not overclaim
  relevance. Use `filename_only`, `path_match`, `content_confirmed`,
  `office_text_confirmed`, and `metadata_only` style states so Copilot can
  distinguish candidates from confirmed evidence. For large folders, Relay
  should cap and diversify results, detect obvious folder skew, and let Copilot
  choose follow-up reads/searches through the same generic loop.
- Search storage: user-local Relay app data only. Shared folders and searched
  folders must not receive `.aionrs`, index databases, or cache artifacts.
- Office editing: OfficeCLI-backed inspection and mutation only. Relay creates
  backups before executing OfficeCLI mutations from the Workbench.
- Office tool policy: expose OfficeCLI through a broad capability registry,
  not arbitrary argv and not a tiny hand-written allowlist. The registry should
  be generated or validated from pinned OfficeCLI help/schema output where
  available, then normalized into Relay semantic operation families: discovery
  and inspection; Excel workbook/sheet/cell/range/table/formula/style/data
  operations; Word document/text/table/style/review operations; PowerPoint
  slide/shape/text/media/layout operations; and cross-document export,
  convert, render, merge, split, batch, refresh, resident open/close, and
  validation operations when supported by the bundled OfficeCLI version. Copilot
  selects only a semantic operation plus typed arguments. Relay validates paths,
  document type, selectors, sheet/range/property values, safety class, and then
  compiles the operation to OfficeCLI argv. Office mutations must produce a
  backup, approval interrupt, command summary, post-apply verification, and
  rollback note.
- OfficeCLI readiness checks must validate real `view outline --json`
  capability without falsely failing because Relay's own smoke workbook handle
  is still open. Smoke workbooks must be written to a unique app-local path,
  closed before launching OfficeCLI, retried briefly on transient sharing
  violations, and cleaned up after the check.
- OfficeCLI is an optional capability for overall agent readiness. Missing or
  failed OfficeCLI must not put the whole Workbench into `Limited` when
  Copilot and required search/tool execution are ready. Office tasks still fail
  clearly at execution time if OfficeCLI cannot be resolved or pass smoke.
- Code editing: M365 Copilot may inspect through `rg_files`, `rg_search`, and
  `read`, then propose validated exact-string replacements through `edit` or
  new-file writes through `write`. Relay validates workspace-relative paths,
  unique `oldString` matches, file boundaries, and user approval before writing.
  `workspace_status`, `diff`, and `run_command` complete the coding loop by
  making dirty-file state, reviewable changes, and verification output visible
  to the agent. Arbitrary unrestricted shell is not part of the default tool
  catalog.
- Command execution policy: `run_command` is not a general shell. It accepts a
  structured argv array, working directory, timeout, environment allowlist, and
  declared purpose. Relay blocks shell metacharacters, network/package-install
  commands, destructive commands, cross-workspace paths, and secret-reading
  patterns unless the user explicitly approves a narrowly displayed command.
- UX direction: follow the dedicated **UI/UX Direction** section above. Design
  guidance belongs in Workbench-owned docs/source only; the deleted desktop
  tree is not a design dependency.
- Target release artifact: self-contained Relay sidecar plus static web assets,
  with a Windows user-scope NSIS installer and a Linux archive/launcher that
  open the local workbench URL. The Windows installer packages the sidecar
  Workbench architecture; the Tauri NSIS installer is not a supported release
  path after the cutover.

### Architecture Specification

This specification is added after reviewing current Microsoft Edge DevTools
Protocol, ASP.NET Core, .NET deployment, AG-UI, Microsoft Agent Framework,
OWASP LLM, NSIS, and ripgrep documentation. It is the target contract for the
hard cutover.

- Process topology:
  - `Relay.Launcher` is the user-facing entrypoint on Windows and Linux.
  - `Relay.Sidecar` is the only long-lived backend process. It hosts the
    Workbench static assets, local APIs, Microsoft Agent Framework runtime,
    AG-UI event stream, Copilot CDP provider adapter, Relay tool broker, run
    ledger, and package diagnostics.
  - Microsoft Agent Framework is the sidecar's backend agent runtime. Relay
    integrates with it through typed tools, approval middleware, session/run
    records, and a Copilot provider adapter rather than a separate custom
    workflow runner.
  - The Workbench browser opens the sidecar URL with a per-launch token. It is
    not the same browser automation context as the Copilot CDP tab.
  - Edge/Copilot is started or attached lazily for model turns only. Workbench
    first paint must not wait for Copilot readiness.
- Local HTTP surface:
  - Bind only to loopback using an explicit localhost URL and dynamic or
    conflict-checked port; never bind to `0.0.0.0`, `*`, `+`, or LAN
    interfaces.
  - Every API, SSE stream, and state-changing request requires the launch
    token. Validate `Host` and `Origin`; reject missing or foreign origins.
  - Serve only the built Workbench bundle. Directory browsing must remain
    disabled, and arbitrary workspace files must never be served as static
    assets.
  - Required endpoints: `/` for Workbench, Agent Framework AG-UI run endpoint,
    `/api/status`, `/api/workspace`, `/api/runs`, `/api/runs/{id}`,
    `/api/runs/{id}/approve`, `/api/runs/{id}/cancel`,
    `/api/support-bundle`, and `/api/shutdown`. Legacy custom event endpoints
    may exist only during migration and must not remain Workbench-facing after
    AG-UI adoption.
- Event stream:
  - Use AG-UI as the public run event protocol. Do not keep a competing Relay
    wire protocol for the Workbench once migration is complete.
  - Required AG-UI event coverage: run start/finish, text message
    start/content/end, tool call start/args/result, state snapshot/delta,
    approval interrupt, resume result, error, and cancellation.
  - Every emitted event must be traceable to Relay `runId`, monotonic sequence,
    timestamp, and structured metadata for replay/support export, even when the
    protocol field names come from AG-UI.
  - Relay-internal event records are allowed as persistence details, but
    Workbench-facing APIs must speak AG-UI.
- Run lifecycle:
  - State machine: `created -> preparing -> waiting_copilot -> validating ->
    executing_tool -> waiting_approval -> synthesizing -> completed`.
    Terminal states are `completed`, `cancelled`, and `failed`.
  - Agent Framework is responsible for the run/session lifecycle. Relay policy
    constrains each Copilot step to one validated tool call, `ask_user`, or
    `final`. Relay executes at most one local action before returning an
    observation to the Agent Framework run.
  - Invalid JSON, unknown tool names, invalid arguments, missing capability,
    stale approval, or workspace-scope violation stops the run with a visible
    `failed` state. Do not route to a weaker fallback tool.
  - Bounded retry is allowed only inside the same transport for paste/send
    readiness, response extraction settling, or one JSON repair turn.
- Tool contract:
  - Tool arguments are validated against Relay-owned schemas before execution.
  - Read-only tools may run after validation; mutation tools pause for explicit
    approval with exact target paths, diff/command summary, backup location,
    and rollback/no-rollback note.
  - `rg_files` maps to ripgrep file enumeration with explicit root, include,
    exclude, depth, cap, timeout, and hidden/binary policy.
  - `rg_search` maps to ripgrep content search for plaintext/code only, with
    explicit root, pattern, include/exclude globs, cap, timeout, and encoding
    policy. Office/PDF containers are discovered by filename and inspected by
    exact `read`, not plaintext grep.
  - `read` returns bounded extracted text or structured metadata for exact
    files, including Office/PDF extraction where Relay supports it.
  - `officecli` accepts semantic Office operations compiled by Relay to argv;
    direct arbitrary shell is not exposed.
  - `edit` requires exact old/new replacement validation; `write` requires an
    explicit target and approval.
  - `workspace_status` reports repository/workspace state without mutation,
    including dirty files, changed paths, active approvals, and relevant tool
    readiness.
  - `diff` returns bounded, reviewable diffs for pending and applied
    mutations. It must be available before approval and after execution.
  - `run_command` executes only validated, bounded verification commands. It
    must avoid shell interpretation by default, enforce workspace containment,
    capture stdout/stderr with caps, support cancellation, and require approval
    for non-allowlisted or mutation-capable commands.
- Copilot transport:
  - The sidecar owns the Agent Framework-compatible M365 Copilot provider
    adapter over Edge CDP. Prefer a direct `IChatClient`/Agent Framework
    adapter shape. A Chat-Completions-compatible local surface may remain only
    as internal compatibility for existing tests or Agent Framework clients.
    This is an adapter contract for Relay; it is not a Microsoft 365 product
    API guarantee.
  - DOM selectors, paste/insert behavior, send-button lifecycle detection, and
    response extraction rules must be versioned against saved successful
    Copilot fixtures.
  - Response extraction must reject prompt echoes, sidebar/history text,
    suggestions, empty answers, stale prior answers, and incomplete JSON.
  - Transport errors fail the Agent Framework run. Relay may perform short
    bounded mechanical retries for readiness/settling inside the same CDP
    operation, but it must not silently execute a fallback model, planner,
    runner, or tool path.
- Storage and privacy:
  - Runtime data lives under user-local Relay data directories only.
  - Shared folders and selected workspaces must not receive Relay caches,
    indexes, snapshots, logs, or temp files.
  - Run ledgers store bounded observations and metadata by default. Support
    bundles omit document contents unless the user explicitly opts in.
- Packaging:
  - Publish the sidecar as self-contained, platform-specific artifacts.
  - Windows distribution is a per-user NSIS installer with user execution
    level, current-user install location, Start Menu shortcut, optional desktop
    shortcut, uninstall entry, and no UAC/password requirement.
  - Bundle required runtime tools from sidecar-owned resource directories and
    list them in the release inventory/SBOM-style metadata.

## Current Review Remediation Plan

The sidecar/workbench cutover is active. The next plan is no longer another
architecture migration; it is a hardening pass based on the current
implementation review. Do not reintroduce the old `apps/desktop`, AionUi,
OpenCode/OpenWork, Tauri IPC, or high-level document-search engines while
addressing these items.

Implementation status on 2026-05-16:

- Completed in the current slices: generic `workspace_status`, `diff`, and
  approval-gated bounded `run_command`; `rg_search` `--` hardening; Workbench
  event identity by `runId + sequence`; official AG-UI SSE event mapping;
  Workbench consumption of `/agui/relay`; hard-cut guard coverage that blocks
  returning the Workbench to the old `/events` stream; the
  `RelayCopilotChatClient` `IChatClient` adapter; POST-only support-bundle
  export with default redaction; streaming/capped ripgrep output for
  `rg_files` and `rg_search`; exact `read` extraction for `.docx`, `.xlsx`,
  `.xlsm`, `.pptx`, and text-layer `.pdf` including common filtered streams;
  broad semantic OfficeCLI capability-registry compilation with raw-argv
  rejection; a
  Microsoft Agent Framework-backed `ChatClientAgent` runner path for Copilot
  turns and per-run sessions; Agent Framework function-tool dispatch through
  `AIFunctionFactory.Create`; Copilot tool projection to
  `FunctionCallContent`; `FunctionInvokingChatClient` observation looping;
  `ApprovalRequiredAIFunction` wrapping for mutating tools; Agent Framework
  approval response resume/session serialization; Workbench approval rendering
  from AG-UI state instead of `RunResponse.pendingApproval`; React + Vite +
  TypeScript + Tailwind CSS + shadcn-style local components + Radix Tooltip
  Workbench migration; official `/agui/relay` execution through
  `@ag-ui/client`; removal of legacy `/api/runs` product routes, run ledger,
  and compatibility approval protocol; deeper support-bundle redaction fixture
  coverage; golden smoke coverage for those behaviors; and filtered PDF stream
  extraction coverage.
- The official Agent Framework AG-UI ASP.NET Core hosting package is now
  registered and exposed at `/agui/relay`. That endpoint is smoke-tested for
  framework-native AG-UI lifecycle SSE while still using `RelayCopilotChatClient`
  as the only model adapter and the same Relay tool functions.
- The legacy Workbench-facing custom `/api/runs` product path has been removed.
  Mutating-tool approval now flows through Agent Framework
  `ApprovalRequiredAIFunction`, the Relay AG-UI approval bridge, and AG-UI
  `request_approval` client-tool result messages.
- Workbench event mapping consumes standard AG-UI lifecycle, text, reasoning,
  tool-call, state, error, and completion events without depending on the
  Relay-only `relayType` field.
- Next scheduled slice: add official-path acceptance coverage and documentation
  around the now-current Agent Framework + AG-UI product path.

#### Next Task: Agent Framework + AG-UI Native Approval Cutover

Research sources checked on 2026-05-16:

- Microsoft Agent Framework AG-UI human-in-the-loop documentation:
  <https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop>
- AG-UI event protocol documentation:
  <https://docs.ag-ui.com/concepts/events>
- AG-UI client/server communication documentation:
  <https://docs.ag-ui.com/concepts/client-server-communication>

Goal: make Microsoft Agent Framework and AG-UI own the run protocol, tool-call
projection, user confirmation, resume, streaming lifecycle, and shared state as
much as their current .NET APIs allow. Relay should keep only the M365 Copilot
CDP `IChatClient` adapter, small local tool implementations, validation and
backup policy, diagnostics, packaging, and Workbench visual composition.

Implementation plan:

Current completed tasks:

- **AFAGUI01: Prove Agent Framework approval projection over AG-UI.** This is
  the first blocker for the cutover because it verifies that `MapAGUI` plus a
  narrow Agent Framework middleware can carry a mutating local function to the
  Workbench for approve/reject without relying on Relay's custom run stream.
- **AFAGUI02: Refactor Relay tool registration around Agent Framework
  primitives.** Relay now has an explicit Agent Framework tool catalog split
  between read-only automatic functions and mutating
  `ApprovalRequiredAIFunction` tools projected to AG-UI `request_approval`.
- **AFAGUI03: Move Workbench primary execution to official AG-UI transport.**
  Workbench now starts and resumes runs through the official `/agui/relay`
  HTTP/SSE endpoint with `@ag-ui/client` `HttpAgent`, derives approval cards
  from AG-UI `request_approval` client-tool calls, and no longer uses legacy
  `/api/runs` routes as its product execution path.
- **AFAGUI04: Remove legacy run stream and approval compatibility routes.**
  The sidecar no longer maps legacy `/api/runs` product routes, `RunManager`
  has been removed, Workbench types no longer expose `RunResponse`, and smoke
  scripts now drive runs through the official `/agui/relay` endpoint.
- **AFAGUI05: Add official-path acceptance coverage and documentation.**
  The official AG-UI path is covered by `pnpm check` smokes, the browser-level
  `pnpm workbench:ux-e2e` flow, release inventory/installer policy checks, and
  aligned README/AGENTS/implementation documentation.

Next task after this checkpoint:

- No remaining `agent_framework_agui_native_cutover` task is scheduled. Stale
  historical AionUi acceptance tasks `AION04` through `AION07` were retired as
  obsolete in Task Master on 2026-05-16 because AionUi is no longer an active
  product or release path.

1. Add a proof slice for AG-UI client-tool approvals.
   - Confirm the current Agent Framework AG-UI package surface. If a future
     package exposes a dedicated helper, use it; in the current package,
     implement only the missing projection middleware rather than a second run
     stream.
   - Build a minimal test agent that registers one read-only function and one
     mutating function through Agent Framework, applies
     `UseFunctionInvocation()` plus the approval projection middleware, and
     exposes the agent with `MapAGUI`.
   - Connect the Workbench with `@ag-ui/client` to that endpoint and prove the
     mutating function arrives as an AG-UI `request_approval` client tool call
     that the UI can approve or reject.
   - Fail fast if the official middleware cannot project the action. Do not add
     a new Relay fallback stream to mask the gap.

2. Refactor Relay tools around Agent Framework primitives.
   - Keep read-only functions (`rg_files`, `rg_search`, `read`,
     `workspace_status`, `diff`) as normal Agent Framework tools that may run
     automatically inside the selected workspace.
   - Register mutating functions (`officecli` mutations, `edit`, `write`, and
     any future bounded command operation) as Agent Framework
     `ApprovalRequiredAIFunction` tools, then project their approval requests to
     AG-UI client-tool calls so the UI owns explicit approval before Relay
     executes the local operation.
   - Keep tool bodies small and deterministic: validate scope, validate typed
     args, create backups/diffs when applicable, execute one local action, and
     return a structured observation. Do not rebuild a Relay planner or
     observation loop around them.

3. Move Workbench primary execution to the official AG-UI transport.
   - Replace `RelayEventSourceAgent` and `/api/runs/{runId}/agui-events` as the
     product path with the official AG-UI HTTP/SSE run flow.
   - Consume standard AG-UI lifecycle, text, tool-call, state, error, and
     completion events directly. Relay-only event fields may remain only in
     support diagnostics until callers are removed.
   - Render approval cards from AG-UI client-tool action state, not from
     `RunResponse.pendingApproval` or the old ledger approval route.

4. Move run/session state to Agent Framework and AG-UI identities.
   - Use `AgentSession` plus AG-UI thread/run identifiers as the source of
     truth for run continuity.
   - Keep the Relay run ledger as an append-only audit/support artifact only.
     It must not be required for normal approval/resume once the official AG-UI
     path works.
   - Remove `PendingApproval`, `/api/runs/{runId}/approve`, and legacy resume
     protocol from the product path after the Workbench and tests no longer use
     them.

5. Delete replaced compatibility code in the same milestone.
   - Remove the old Workbench `RunEvent` primary stream, approval route,
     compatibility normalizer, and any tests that assert Relay-only event
     fields as product behavior.
   - Keep plain local HTTP APIs for non-agent app operations only: workspace
     selection, readiness, support bundle, static assets, and shutdown.
   - Do not leave a hidden compatibility mode or fallback setting. If official
     AG-UI projection breaks, the run should fail visibly with diagnostics.

6. Add acceptance coverage for the official path.
   - Sidecar smoke: `MapAGUI` plus the approval projection middleware can
     stream a run, call a read-only function, request a mutating tool
     confirmation, reject without side effects, approve with a backup/diff or
     Office manifest, resume, and complete.
   - Workbench E2E: the browser UI submits one generic task, sees streamed
     reasoning/text/tool activity, approves one mutation, rejects one mutation,
     cancels a run, and sees clear error output for invalid Copilot JSON.
   - Regression gate: active Workbench code no longer imports or depends on the
     custom `/api/runs/{runId}/agui-events` product stream.
   - Standard gates: `pnpm check`, sidecar security smoke, support-bundle
     redaction smoke, release inventory, and installer policy checks.

Guardrails for this task:

- No Python runtime and no second agent runner.
- No reintroduction of AionUi, OpenCode/OpenWork, Codex app-server, Tauri, or
  the removed high-level document-search workflow.
- No unrestricted shell tool. Future command execution must remain a typed,
  bounded Agent Framework tool with Relay validation and approval.
- No prompt-only safety. Copilot may choose tools, but Relay validates every
  argument and owns local execution.
- No silent fallback. Missing AG-UI middleware, Copilot transport drift,
  invalid JSON, OfficeCLI/ripgrep absence, or unsupported tool args stop the
  run with a user-visible error and support details.

Framework-first revision after current Microsoft documentation review:

- Agent Framework already owns the tool-calling loop. Relay must stop growing
  the custom `RelayAgentPlan -> RelayToolExecutor -> observation` loop and
  instead register Relay capabilities as Agent Framework tools.
- Relay-owned custom code should narrow to:
  - the M365 Copilot Edge/CDP `IChatClient` adapter;
  - tool policy, workspace containment, approval, backup, redaction, and audit
    middleware;
  - thin local provider adapters only where an approved existing tool substrate
    does not already provide the capability;
  - packaging, diagnostics, and support-bundle generation.
- The Copilot adapter is the required seam because M365 Copilot is reached
  through browser automation, not through a native provider API. It must project
  Agent Framework tool schemas into Copilot prompts and convert Copilot's
  selected action back into Microsoft.Extensions.AI tool-call content. This
  adapter is allowed; a second Relay runner is not.
- Prefer Agent Framework primitives before adding Relay code:
  `AIFunctionFactory.Create` for typed function tools,
  `ApprovalRequiredAIFunction` for mutation tools,
  narrow Agent Framework middleware for `ToolApprovalRequestContent` to AG-UI
  `request_approval` projection and resume,
  `AgentSession` serialization for run continuity,
  middleware for validation/telemetry,
  and `MapAGUI` / AG-UI middleware for Workbench streaming and approvals.
- Do not use provider-hosted file search or code interpreter for local
  workspaces. Relay's local files and Office documents must stay local, so tool
  execution must remain local and auditable. Prefer existing local tool
  substrates in this order:
  1. Agent Framework tool primitives and approval/session middleware.
  2. Approved local MCP servers or provider bridges that expose real existing
     tools and can be wrapped by Relay policy.
  3. Existing CLI/library tools such as ripgrep and OfficeCLI behind typed
     schemas.
  4. Relay-owned in-process functions only for the remaining gaps.

#### Microsoft Agent Framework Prior-Art Review

Updated 2026-05-16 after reviewing current Microsoft Agent Framework docs,
official samples, and Microsoft blog case studies:

- **Official sample taxonomy:** `microsoft/Agent-Framework-Samples` organizes
  examples around foundations, first agents, provider exploration, tools
  (vision/code interpreter/custom tools/file search), providers and MCP,
  RAG/file search, planning, multi-agent workflows, evaluation/tracing, DevUI,
  and real-world cases
  (`https://github.com/microsoft/Agent-Framework-Samples`). Relay should keep
  its plan and verification matrix aligned to those same axes: provider,
  tools, workflow/orchestration, UI streaming, evaluation/tracing, and
  packaging.
- **Agent vs workflow boundary:** Microsoft guidance says to use an agent for
  open-ended conversational work and autonomous tool use, and a workflow when
  steps are well-defined; it also says that if a function can handle the task,
  use a function instead of an AI agent
  (`https://learn.microsoft.com/en-us/agent-framework/overview/`). Relay should
  therefore stay with one Copilot-controlled manager plus local tools for
  coding, Office edits, and local file lookup. Do not split into multiple
  agents just to make simple file/search/edit operations look more agentic.
- **Tool type pattern:** Agent Framework's tool docs list function tools,
  approval, code interpreter, file search, web search, hosted MCP, local MCP,
  and Foundry toolboxes
  (`https://learn.microsoft.com/agent-framework/agents/tools/`). Local MCP
  tools are broadly compatible with providers that support function tools, but
  provider-native approval is not universal. Relay must keep approval and
  workspace policy as Relay-owned AG-UI/client-tool behavior instead of
  assuming the Copilot provider can enforce approval natively.
- **AG-UI product pattern:** Microsoft's AG-UI + Agent Framework workflow demo
  frames the UI problem clearly: users need to see which agent is active, why
  the system is waiting, and what sensitive action needs approval
  (`https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/`).
  Relay should continue the minimal Workbench direction, but the visible run
  stream must always show active status, tool calls, approval waits, errors,
  and completion without hiding them in support-only logs. The demo notes that
  C# support for MAF + AG-UI was still in development at publication time, so
  Relay must keep preview-package drift guarded by `pnpm check` and live E2E.
- **Handoff vs agent-as-tool:** Handoff orchestration is for cases where
  specialized agents transfer control and task ownership; agent-as-tool keeps a
  primary agent responsible while delegating bounded subtasks
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff`).
  If Relay later adds specialist agents, prefer agent-as-tool for bounded
  specialists such as "Office reviewer" or "code verifier"; reserve handoff for
  real domain ownership transfer with explicit routing rules and shared
  context requirements.
- **Workflow orchestration options:** Agent Framework documents sequential,
  concurrent, handoff, group chat, and magentic orchestration patterns
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/`).
  Relay should not adopt these until a user workflow is repeatable enough to
  justify explicit topology. The current generic Workbench should remain a
  single agent run loop, while future deterministic recipes can become
  workflows only after their entry/exit states and approval points are known.
- **Declarative workflow and MCP examples:** Declarative workflow docs include
  `InvokeFunctionTool`, `InvokeMcpTool`, `FunctionTools`, `ToolApproval`,
  `CustomerSupport`, and `DeepResearch` samples
  (`https://learn.microsoft.com/en-us/agent-framework/workflows/declarative`).
  This supports Relay's current decision: model local capabilities as typed
  tools first; use MCP only for approved standalone providers; do not invent a
  Relay scheduler when Agent Framework workflows can represent deterministic
  processes later.
- **Durable workflow as MCP:** The .NET durable workflow example shows Azure
  Functions exposing registered workflows as remote MCP tools at a runtime
  webhook endpoint
  (`https://devblogs.microsoft.com/dotnet/durable-workflows-in-microsoft-agent-framework/`).
  For Relay, this is future prior art for exposing durable, non-local,
  enterprise-approved workflows as MCP tools. It is not a reason to add a local
  arbitrary MCP server or cloud dependency to the MVP.
- **Enterprise production signals:** Microsoft's Foundry introduction cites
  Agent Framework use cases such as audit testing/documentation, customer
  support, vehicle telemetry analysis, integration services, and marketing
  content workflows, emphasizing governance, observability, durability, and
  human-in-the-loop operation
  (`https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/`).
  Relay's matching product requirement is not more bespoke tool code; it is
  stronger traceability: redacted support bundles, tool-call audit records,
  approval artifacts, reproducible smokes, and release inventory.

Resulting Relay design adjustments:

- Keep the current **single Copilot manager + Agent Framework tools** as the
  default architecture.
- Treat multi-agent/handoff workflows as future features with a named business
  need, not as a default replacement for the generic Workbench.
- Keep **AG-UI as the user-visible execution protocol**, with approval and
  waiting states promoted in the UI rather than hidden.
- Keep **Relay-owned policy and approval** around all local tools because M365
  Copilot is reached through a custom CDP adapter and provider-native approval
  cannot be assumed.
- Prefer future **declarative workflows or MCP-wrapped durable workflows** only
  when a repeatable process has stable steps, inputs, approval points, and
  output contracts.
- Add future improvements under verification/evaluation/tracing rather than
  expanding the tool catalog first.

#### Executable Task Queue: Agent Framework Prior-Art Alignment

These tasks convert the prior-art review into implementable work. They are
ordered so each step leaves a concrete artifact and does not require a second
agent runtime, AionUi, OpenCode/OpenWork, Codex app-server, or unrestricted
shell.

1. **MAFPR01: Add an Agent Framework alignment matrix.**
   - Status: completed 2026-05-16.
   - Goal: turn the prior-art review into a maintained engineering checklist.
   - Changes:
     - Add `docs/AGENT_FRAMEWORK_ALIGNMENT.md`.
     - Map each Agent Framework prior-art axis to Relay's current decision:
       provider adapter, function tools, local MCP admission, approval,
       AG-UI streaming, workflow orchestration, evaluation/tracing, and
       packaging.
     - Mark each axis as `adopted`, `adopted with Relay policy`,
       `deferred`, or `rejected`.
   - Acceptance: the doc has no implementation claims without a current source
     file or verification command reference.
   - Verification: `git diff --check`.

2. **MAFPR02: Add a model-facing tool catalog snapshot gate.**
   - Status: completed 2026-05-16.
   - Goal: make Agent Framework tool schema drift visible before Copilot sees
     it.
   - Changes:
     - Add a smoke script that starts the sidecar in mock mode, reads the
       registered Agent Framework tool names/schemas or an exported catalog
       endpoint, and writes/compares a stable JSON snapshot.
     - Assert that prompt-facing names remain `glob`, `grep`, `read`,
       `officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
       `workspace_status`, `diff`, `bash`, and `ask_user`.
     - Reject `rg_files`, `rg_search`, and `run_command` in active catalog
       output.
   - Acceptance: a catalog change fails a targeted smoke with a readable diff.
   - Verification: new catalog smoke; `pnpm check`.

3. **MAFPR03: Add an AG-UI run-state acceptance matrix.**
   - Status: completed 2026-05-16.
   - Goal: align Workbench UX with Agent Framework/AG-UI examples that expose
     active status, waits, approvals, errors, and completion.
   - Changes:
     - Add a small Workbench E2E matrix covering: ready state, running state,
       tool-call visible state, approval-required state, rejection, failure,
       cancellation, and completed state.
     - Keep screenshots under the existing E2E artifact location.
     - Update user-facing copy only if a state is ambiguous.
   - Acceptance: users can tell whether Relay is thinking, waiting for
     approval, executing a tool, failed, cancelled, or done without opening
     support details.
   - Verification: `pnpm workbench:ux-e2e`; `pnpm check`.

4. **MAFPR04: Add tool-call audit and evaluation artifacts.**
   - Status: completed 2026-05-16.
   - Goal: follow Agent Framework production guidance by improving
     observability before adding more tool behavior.
   - Changes:
     - Extend support-bundle or run-ledger output with a redacted tool-call
       audit summary: tool name, argument classification, approval status,
       duration, success/failure, output truncation, and backup/diff pointers.
     - Add a deterministic smoke that verifies sensitive fields and document
       contents remain redacted.
   - Acceptance: a failed run can be diagnosed from redacted metadata without
     exposing raw documents, tokens, cookies, or prompt payloads.
   - Verification: sidecar security/support-bundle smoke; `pnpm check`.

5. **MAFPR05: Define the workflow admission gate.**
   - Status: completed 2026-05-16.
   - Goal: prevent premature multi-agent or workflow adoption while keeping a
     clear path for repeatable business processes.
   - Changes:
     - Add a doc section or file that defines when Relay may use:
       single-agent tools, agent-as-tool, handoff, declarative workflow,
       local MCP, or durable workflow-as-MCP.
     - Include required fields for any future workflow proposal: trigger,
       inputs, deterministic steps, approval points, rollback/backup behavior,
       output contract, E2E test, and support-bundle evidence.
   - Acceptance: no new workflow/multi-agent feature can be scheduled without
     satisfying this gate.
   - Verification: `git diff --check`; hard-cut guard if new forbidden paths
     are added.

6. **MAFPR06: Harden live Copilot provider acceptance.**
   - Status: completed 2026-05-16.
   - Goal: keep the custom M365 Copilot CDP adapter compatible with Agent
     Framework tool-calling expectations.
   - Changes:
     - Add or update live E2E criteria for prompt delivery, tool JSON
       projection, AG-UI streaming, approval resume, final answer extraction,
       and fail-fast invalid JSON.
     - Keep this as an optional live gate unless a signed-in Edge CDP session
       is available.
   - Acceptance: live failures are classified as environment, prompt delivery,
     response extraction, schema validation, or tool execution failures.
   - Verification: `pnpm workbench:live-copilot-e2e` when available; otherwise
     documented skip with reason.

7. **MAFPR07: Review local MCP candidates before adding MCP runtime.**
   - Status: completed 2026-05-16.
   - Goal: avoid adding a toy MCP fixture or arbitrary server while preserving
     the Agent Framework extension path.
   - Changes:
     - Evaluate candidate local MCP servers only if they provide a real
       capability not already covered by ripgrep, OfficeCLI, filesystem, git,
       or bounded command tools.
     - Document packaging, security, approval, workspace containment,
       redaction, and Windows/Linux behavior for each candidate.
   - Acceptance: either choose a named approved MCP candidate with a concrete
     follow-up task, or record that no MCP server should be added yet.
   - Verification: documentation review; no runtime change unless a candidate
     is explicitly approved.

#### Tool Substrate Reduction Plan

Current state: the active tool surface is descriptor-driven Agent Framework
function tools. `RelayAgentFunctionSet` now exposes `glob`, `grep`, `read`,
`officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
`workspace_status`, `diff`, bounded `bash`, and `ask_user` through
`AIFunctionFactory.Create`, while `RelayToolExecutor` uses a provider registry
for validation, descriptions, approval requirements, and execution. Some tools
delegate to established executables such as ripgrep and OfficeCLI. The next
architectural step is not another rename; it is reducing the remaining
Relay-owned provider code only where Agent Framework primitives, approved MCP
providers, or existing CLI/library substrates can replace it without losing
local policy, auditability, or packaging control.

Design target:

- Keep **M365 Copilot as the only reasoning/controller model** and Microsoft
  Agent Framework as the run loop.
- Keep **Relay as the policy boundary** for local paths, approvals, backups,
  destructive-action classification, logging, redaction, and fail-fast errors.
- Move tool declarations to a **descriptor-driven provider registry** so Relay
  does not need one bespoke method and one bespoke switch branch for every
  tool.
- Reuse existing tool schemas, local MCP tools, and CLI/library
  implementations whenever they can run locally, be packaged legally, and pass
  Relay policy.
- **Decision after 2026-05-16 investigation:** do not adopt OpenCode, Codex
  app-server, or Codex MCP server as Relay runtime or provider substrate.
  - OpenCode is useful as a compatibility reference for generic tool names and
    permission categories (`glob`, `grep`, `read`, `edit`, `write`,
    `apply_patch`, bounded `bash`), but Relay must not launch or embed the
    OpenCode runtime.
  - Codex app-server is rejected for Relay's production path. It is designed to
    control Codex threads, turns, accounts, models, approvals, and events; it
    also has version-specific generated schemas and auth surfaces. That would
    duplicate Agent Framework, compete with M365 Copilot as the controller, and
    reintroduce Codex branding/runtime dependency.
  - Codex MCP server is also rejected as a tool substrate. Its documented
    interface controls a local Codex engine and is explicitly experimental; it
    is not a stable standalone local-tool bundle for Relay.
  - The only concrete adoption path is **Agent Framework local MCP consumption
    of standalone tool servers**, plus direct CLI/library providers for
    ripgrep and OfficeCLI. OpenCode/Codex documentation may inform schema
    naming and tests, but no OpenCode/Codex process, package, generated schema,
    or auth flow is part of the active product.

Framework-native tool contract target:

- **Primary anchor: Microsoft Agent Framework function/MCP/client tool model.**
  Relay's model-facing and runtime-facing tools should be Agent Framework
  function tools, approved Agent Framework MCP tools, or AG-UI client tools.
  Do not maintain a separate Relay or OpenCode tool contract as the product
  source of truth.
- **Function tools by default.** Local file search, exact read, text/code edit,
  OfficeCLI operations, workspace status, diff, and bounded build/test/lint
  commands are Agent Framework function tools with typed parameters,
  descriptions, runtime-only context, middleware validation, and explicit output
  contracts.
- **Approval through Agent Framework, display through AG-UI.** Mutating
  functions are wrapped with Agent Framework approval primitives and projected
  to AG-UI HITL/client-tool events. Relay stores audit records, backups, and
  diffs, but it does not own a second approval protocol.
- **MCP only when it reduces Relay code.** If an approved standalone local MCP
  server provides a capability with acceptable licensing, packaging, offline
  behavior, and policy hooks, consume it through Agent Framework's MCP bridge.
  MCP is not a replacement for workspace policy or approval middleware.
- **AG-UI client tools only for user interaction.** `ask_user`, approvals, and
  any future UI-only choices are AG-UI client tools/HITL states, not backend
  local execution tools.
- **Prior-art tools are references, not contracts.** OpenCode, Codex
  app-server, GitHub Copilot custom agents, Claude Code, and AionUi can inform
  naming familiarity and test scenarios, but Relay must not import their tool
  protocols, generated schemas, runtime assumptions, or permission systems as
  active architecture.
- **Names stay plain, authority moves to Agent Framework.** Familiar names such
  as `glob`, `grep`, `read`, `edit`, `write`, `apply_patch`, and `bash` may be
  retained because they are concise and model-friendly, but their schema,
  availability, approval, execution, and telemetry are defined by Agent
  Framework tool registration and middleware.
- **Keep Relay-owned residue explicit and minimal.** Relay-owned code is
  limited to local function bodies, workspace containment, mutation
  classification, backups, diffs, redaction, Office/PDF extraction helpers,
  OfficeCLI semantic validation, packaging, and fail-fast diagnostics.

Mapping target:

| Current Relay tool | Desired substrate | Relay-owned residue |
| --- | --- | --- |
| `rg_files` / `glob` | Agent Framework function tool backed by ripgrep file listing, or approved local MCP file discovery tool | workspace scope, ignore rules, result caps, ranking hints |
| `rg_search` / `grep` | Agent Framework function tool backed by ripgrep content search, or approved local MCP search tool | binary/Office rejection policy, output caps, sensitive-path redaction |
| `read` | Agent Framework function tool for exact reads plus approved parsers for Office/PDF extraction | Office/PDF extraction fallback, snippet caps, redaction |
| `edit` / `write` / `apply_patch` | Agent Framework function tools wrapped in approval for mutations | backups, approval metadata, exact-match validation, diff generation |
| `officecli` / `officecli_mutate` | Agent Framework function tools around bundled OfficeCLI; mutation tools require approval | semantic operation registry, argv compilation, backup, post-check |
| `workspace_status` / `diff` | Agent Framework function tool or approved local MCP git/status tool | dirty-worktree policy, path filtering, output caps |
| `run_command` / `bash` | Agent Framework function tool for bounded build/test/lint command families only | allowlist, timeout, cancellation, destructive-command denial |
| `ask_user` | AG-UI client tool / Agent Framework human-in-the-loop request | request wording, run ledger persistence |

Implementation status (2026-05-16):

- TOOLSUB00-07 and TOOLSUB09-10 are implemented in the active
  sidecar/workbench path. The model-facing catalog is now `glob`, `grep`,
  `read`, `officecli`, `officecli_mutate`, `edit`, `write`, `apply_patch`,
  `workspace_status`, `diff`, `bash`, and `ask_user`.
- 2026-05-17 correction: these tool names are no longer treated as an
  OpenCode-compatible product contract. They are plain Agent Framework function
  tool names, with availability, approval, execution, telemetry, and AG-UI
  projection owned by Agent Framework registrations and middleware.
- TOOLSUB08 is closed as a descriptor-boundary decision rather than a new
  runtime dependency: the catalog now models `RelayFrameworkToolType.LocalMcp`
  for future approved standalone MCP tools, but this milestone does not add a
  production or test MCP server because no approved reusable local MCP substrate
  has been selected. Future MCP adoption must be a separate plan with a named
  server, threat model, packaging impact, and acceptance smoke.
- Verification for this cutover is recorded in `docs/IMPLEMENTATION.md` under
  "2026-05-16: OpenCode-Compatible Tool Contract Cutover".

Executable task queue:

1. **TOOLSUB00: Capture current tool baseline.**
   - Scope: documentation and tests only.
   - Changes:
     - Add `docs/TOOL_SUBSTRATE_MATRIX.md` with the current active catalog:
       `rg_files`, `rg_search`, `read`, `officecli`, `officecli_mutate`,
       `edit`, `write`, `workspace_status`, `diff`, `run_command`, and
       `ask_user`.
     - Record current prompt-facing names, JSON arguments, approval behavior,
       output shape, implementation method, external executable dependency, and
       current tests.
   - Artifact: `docs/TOOL_SUBSTRATE_MATRIX.md`.
   - Acceptance: no runtime behavior changes; the matrix clearly marks
     OpenCode runtime, Codex app-server, and Codex MCP server as rejected.
   - Verification: `git diff --check`; `node scripts/check-hard-cut-guard.mjs`.

2. **TOOLSUB01: Define the Agent Framework-native descriptor model.**
   - Scope: sidecar metadata only; no tool behavior changes.
   - Changes:
     - Add descriptor types for `frameworkToolType`, `capabilityFamily`,
       `providerKey`, `mutationClass`, `approvalPolicy`, `outputContract`,
       `promptVisibility`, JSON schema, output cap, and audit labels.
     - Model the current tools with descriptors while keeping the existing
       public tool names for this task.
   - Suggested files: `apps/sidecar/ToolDescriptors.cs`,
     `apps/sidecar/AgentRunner.cs`, sidecar tests/smokes.
   - Acceptance: current tools still register and execute exactly as before;
     descriptor snapshots prove the catalog is stable.
   - Verification: `pnpm sidecar:build`; `pnpm agent:golden-smoke`;
     `pnpm check`.

3. **TOOLSUB02: Generate Agent Framework tools from descriptors.**
   - Scope: registration path only; execution still uses existing handlers.
   - Changes:
     - Replace hand-written read-only/mutating registration lists with
       descriptor-driven `AITool` generation.
     - Keep `ApprovalRequiredAIFunction` wrapping driven by descriptor
       `approvalPolicy`.
     - Add a catalog snapshot smoke that fails if prompt-facing schemas drift
       unexpectedly.
   - Suggested files: `apps/sidecar/AgentRunner.cs`,
     `apps/sidecar/ToolDescriptors.cs`, smoke scripts under `apps/sidecar` or
     `scripts/`.
   - Acceptance: no public name/schema changes yet; all approvals and AG-UI
     approval cards still work.
   - Verification: `pnpm agent:agui-client-tool-smoke`;
     `pnpm agent:golden-smoke`; `pnpm check`.

4. **TOOLSUB03: Split execution into provider classes.**
   - Scope: internal dispatch boundary only.
   - Changes:
     - Replace the central `RelayToolExecutor` switch with providers:
       `RipgrepProvider`, `FileReadProvider`, `FileMutationProvider`,
       `OfficeCliProvider`, `WorkspaceProvider`, `CommandProvider`, and
       `HumanInputProvider`.
     - Providers receive validated typed args and return the existing
       `ToolObservation` contract.
     - Keep Relay policy, path containment, approval, backup, output caps, and
       redaction outside provider internals.
   - Suggested files: split from `apps/sidecar/AgentRunner.cs` into
     `apps/sidecar/Tools/*.cs`.
   - Acceptance: behavior and prompt-facing catalog remain unchanged; missing
     ripgrep/OfficeCLI, unsafe path, and mutation-without-approval failures
     still fail closed.
   - Verification: `pnpm agent:rg-stream-smoke`;
     `pnpm agent:officecli-registry-smoke`;
     `pnpm agent:office-pdf-read-smoke`; `pnpm check`.

5. **TOOLSUB04: Write the Agent Framework tool contract spec.**
   - Scope: docs and golden fixtures first; no runtime cutover yet.
   - Changes:
     - Add `docs/AGENT_FRAMEWORK_TOOL_CONTRACT.md` defining Relay's supported
       Agent Framework function/client/MCP tool model for `glob`, `grep`,
       `read`, `edit`, `write`, `apply_patch`, OfficeCLI operations, AG-UI
       client tools, and bounded command execution.
     - Include typed argument schemas, behavior semantics, output summaries,
       error classes, approval policy, middleware checks, AG-UI projections,
       Relay-owned residue, and examples.
     - Add golden fixture expectations for:
       `glob -> read`, `grep -> read`, `read -> edit -> diff`,
       `apply_patch -> diff`, Office `read -> officecli`, and bounded
       build/test/lint command flow.
   - Artifact: `docs/AGENT_FRAMEWORK_TOOL_CONTRACT.md` plus golden fixture
     files.
   - Acceptance: the spec states that Agent Framework registrations,
     middleware, approval primitives, and AG-UI projection are the contract;
     prior-art tool names are not a separate contract.
   - Verification: `git diff --check`; catalog/golden fixture smoke if present.

6. **TOOLSUB05: Cut over read-only file tools to `glob`, `grep`, and `read`.**
   - Scope: prompt-facing read-only workspace tools.
   - Changes:
     - Replace prompt-facing `rg_files` with `glob`.
     - Replace prompt-facing `rg_search` with `grep`.
     - Normalize `read` to the Agent Framework exact-read function schema:
       `file_path`, optional `offset`, optional `limit`, with runtime-only
       workspace/session context injected by middleware.
     - Update Copilot prompt projection, repair/validation, AG-UI labels,
       support-bundle labels, golden tests, and docs.
     - Do not expose prompt-visible dual names after the task is complete.
       Internal provider names may remain `RipgrepProvider`.
   - Acceptance: Copilot chooses `glob`/`grep`/`read` naturally; old
     `rg_files`/`rg_search` names are absent from the model-facing catalog.
   - Verification: `pnpm agent:golden-smoke`; `pnpm agent:rg-stream-smoke`;
     `pnpm agent:office-pdf-read-smoke`; `pnpm check`.

7. **TOOLSUB06: Cut over mutation tools to `edit`, `write`, and `apply_patch`.**
   - Scope: text/code mutation tools.
   - Changes:
     - Normalize `edit` to exact replacement args:
       `file_path`, `old_string`, `new_string`, optional `replace_all`.
     - Normalize `write` to `file_path`, `content`.
     - Add `apply_patch` as the preferred multi-hunk text/code edit tool with
       the established patch grammar.
     - Keep mutation approval, backup creation, diff generation, and
       post-write verification mandatory.
   - Acceptance: no mutation can run without approval; ambiguous `edit`
     matches fail unless `replace_all` is true; `apply_patch` produces a
     reviewable diff.
   - Verification: approval smoke; mutation golden smoke; `pnpm check`.

8. **TOOLSUB07: Map command execution to a bounded Agent Framework function
   tool without exposing unrestricted shell.**
   - Scope: command tool naming and policy.
   - Changes:
     - Keep the executable behavior bounded to structured build/test/lint argv.
     - Keep `bash` only as a familiar tool name if needed; the authoritative
       contract is an Agent Framework function schema with allowed command
       family, argv, cwd/workspace, timeout, and approval policy.
     - Do not expose raw arbitrary shell strings in the default catalog.
     - Update denial messages so the user sees "bounded command execution" and
       support details explain why unrestricted shell is unavailable.
   - Acceptance: build/test/lint commands still run; destructive or arbitrary
     commands fail before execution.
   - Verification: bounded command smoke; security smoke; `pnpm check`.

9. **TOOLSUB08: Close MCP bridge as descriptor-ready, no runtime dependency.**
   - Scope: MCP integration proof boundary only.
   - Changes:
     - Keep `RelayFrameworkToolType.LocalMcp` in the descriptor model so
       approved standalone MCP tools can be represented later.
     - Do not add a bundled/test MCP server in this milestone. A fixture that
       does not represent an approved real provider would add misleading
       complexity and would not reduce Relay-owned execution code.
     - Do not add any OpenCode/Codex MCP server.
   - Acceptance: the descriptor registry has a LocalMcp type and the substrate
     matrix documents MCP as conditional; active runtime and release inventory
     do not add MCP processes.
   - Verification: `pnpm agent:agui-client-tool-smoke`; `pnpm check`.

10. **TOOLSUB09: Remove superseded custom catalog code.**
    - Scope: cleanup after TOOLSUB05-08 pass.
    - Changes:
      - Remove obsolete `rg_files`/`rg_search` prompt projection, repair logic,
        tests, labels, and docs.
      - Remove any method-per-tool registration code superseded by descriptors.
      - Keep only Relay-owned providers and policy middleware required for
        workspace containment, approval, backups, audit, redaction, Office/PDF
        exact-read extraction, OfficeCLI semantic safety, and diagnostics.
    - Acceptance: release inventory shows no active AionUi/OpenCode/OpenWork/
      Codex app-server runtime fallback and no prompt-facing `rg_files` or
      `rg_search`.
    - Verification: `pnpm check`; `pnpm workbench:ux-e2e`;
      release inventory.

11. **TOOLSUB10: Documentation and support-bundle alignment.**
    - Scope: user/developer docs and diagnostics.
    - Changes:
      - Update `README.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`,
        `docs/AGENT_EVALUATION_CRITERIA.md`, and support-bundle notes to
        describe the Agent Framework tool model, middleware policy, AG-UI
        projection, and local workspace contract.
      - Document that OpenCode/Codex processes are not bundled or launched.
    - Acceptance: docs match the active catalog and packaging inventory.
    - Verification: `node scripts/check-hard-cut-guard.mjs`; `pnpm check`.

### P0: AG-UI Full Adoption

1. Replace the public run stream with AG-UI.
   - Current risk: the Workbench uses a Relay-specific `RunEvent` wire shape,
     which recreates a protocol AG-UI already standardizes.
   - Target: Workbench-facing agent traffic uses AG-UI events for lifecycle,
     text streaming, tool calls, state snapshots/deltas, approval interrupts,
     resume, errors, and completion.
   - Acceptance: no Workbench-facing API requires the old custom `RunEvent`
     union; event consumers can reconstruct a run from AG-UI events alone.

2. Rebuild the Workbench around AG-UI client and visual patterns.
   - Current risk: the current custom UI can drift from the AG-UI ecosystem and
     force Relay to keep inventing agent UI behavior.
   - Target: the Workbench uses React + Vite + TypeScript + Tailwind CSS +
     shadcn/ui + Radix UI + `@ag-ui/client`, and uses AG-UI/CopilotKit-style
     interaction patterns for streaming text, tool activity, approvals, state,
     and final answer cards.
   - Acceptance: browser E2E proves the AG-UI Workbench can submit a task,
     stream progress, render an approval interrupt, resume after approval, and
     show final output without using legacy mode buttons or custom-only event
     fields.

3. Adopt Microsoft Agent Framework as the backend runtime.
   - Current risk: moving to Python only because some AG-UI workflow examples
     are ahead would add packaging and enterprise deployment complexity without
     solving Copilot CDP or local tool governance. Keeping a Relay-owned runner
     would continue the harness reinvention that this migration is meant to
     remove.
   - Target: use .NET Microsoft Agent Framework as the production backend
     runtime. Agent Framework owns the run loop, tool-call detection, typed
     function dispatch, approvals, sessions, streaming, and lifecycle. Relay
     implements only the M365 Copilot provider adapter, local function bodies,
     validation policy, packaging, and diagnostics around that runtime.
   - Acceptance: a .NET Agent Framework smoke run can call Relay's Copilot
     adapter, select a Relay tool, pause/resume an approval, stream AG-UI events,
     and finish through the Workbench. Windows NSIS and Linux archive still ship
     one .NET sidecar product path, with no Python runtime requirement.
   - Current slice: Copilot turns now run through `ChatClientAgent` with an
     Agent Framework session; Relay capabilities are registered as
     `AIFunctionFactory.Create` tools; the Copilot adapter projects
     `ChatOptions.Tools` and converts valid tool choices to
     `FunctionCallContent`; `FunctionInvokingChatClient` owns the normal
     observation loop; mutating functions are wrapped with
     `ApprovalRequiredAIFunction`; approval-required runs now serialize the
     Agent Framework session into the run ledger and resume by feeding
     `ToolApprovalResponseContent` back into the same `ChatClientAgent`
     session. Workbench approval cards are driven by AG-UI
     `USER_CONFIRMATION_REQUEST` state, while `PendingApproval` remains only as
     internal ledger state for `/approve`.
   - Current slice: the Workbench now runs on React + Vite + TypeScript,
     Tailwind CSS, shadcn-style local UI components, Radix Tooltip, lucide
     icons, and a `RelayEventSourceAgent` subclass of `@ag-ui/client`
     `AbstractAgent` for AG-UI stream consumption. The thin Relay event
     normalizer remains only to bridge current sidecar event extensions such as
     `USER_CONFIRMATION_REQUEST` into the visible run trace.
   - Revised remaining slice: keep Relay tool functions small and
     deterministic. They validate workspace scope, execute one local action,
     return structured observations, and never call Copilot themselves.

4. Implement fail-fast Copilot provider behavior inside Agent Framework.
   - Current risk: hidden retries, fallback execution, or stale DOM extraction
     can make Copilot instability look like successful agent behavior.
   - Target: `RelayCopilotChatClient` becomes the only custom model-provider
     seam. It classifies failures as `open`, `composer_ready`,
     `prompt_insert`, `send`, `wait_response`, `extract`, `tool_projection`,
     or `schema_validate`. It may use short bounded mechanical waits inside the
     same operation, but it must not route to a fallback model, fallback
     planner, old runner, or weaker tool.
   - Acceptance: golden and live Copilot E2E tests prove that a valid Copilot
     turn succeeds, while invalid JSON, empty response extraction, prompt echo,
     selector drift, and response timeout all surface as failed Agent Framework
     runs with AG-UI error events and support-bundle diagnostics.

### P1: Tool Correctness And Safety

5. Fix exact `read` for Office/PDF files.
   - Current risk: the active `read` path treats files as bounded UTF-8 text.
     That is correct for plaintext/code, but not enough for `.xlsx`, `.xlsm`,
     `.docx`, `.pptx`, or `.pdf`.
   - Target: `read` returns bounded extracted plaintext or structured metadata
     for supported Office/PDF containers, using sidecar-owned extraction code or
     approved bundled readers.
   - Acceptance: golden tests prove `rg_files -> read -> final` can inspect
     `.xlsx`, `.docx`, `.pptx`, and text-layer `.pdf` fixtures, including a
     FlateDecode filtered PDF stream, without routing back to the deleted
     document-search engine.

6. Replace open-ended OfficeCLI argv planning with an OfficeCLI capability
   registry.
   - Current risk: Copilot can shape raw `officecli` arguments too directly,
     while a tiny manual allowlist would discard most of OfficeCLI's value.
   - Target: Relay maintains a broad OfficeCLI capability registry, populated
     from pinned OfficeCLI docs/help/schema where possible and normalized into
     typed semantic operations. The registry should cover discovery,
     inspection, validation, Excel workbook/sheet/cell/range/table/formula/
     style/data operations, Word document/text/table/style/review operations,
     PowerPoint slide/shape/text/media/layout operations, and cross-document
     export/convert/render/merge/split/batch/refresh/resident operations when
     the bundled OfficeCLI version supports them. Copilot may select only
     registry operations and typed args; Relay owns path, file type, selector,
     sheet/range/property validation, safety classification, and argv
     compilation.
   - Acceptance: Office tasks can use the broad OfficeCLI surface without
     exposing raw argv. Mutations create backups and approval cards, run
     post-apply verification, and fail closed on unsupported command families,
     ambiguous targets, unsafe paths, invalid schemas, or OfficeCLI version
     drift.

7. Make support bundle export explicit and redacted by default.
   - Current risk: a simple support-bundle endpoint can package run ledgers and
     event logs that include prompts, local paths, snippets, and tool output.
   - Target: support export is a state-changing `POST` or approval-gated UI
     action. Default bundles redact local paths and omit document contents.
     Full-content export requires explicit opt-in.
   - Acceptance: security smoke proves unauthenticated support export fails and
     default bundle output does not contain raw workspace document contents.
   - Current slice: complete. Default support bundles now run JSON-aware
     recursive redaction before free-text redaction. The security smoke seeds a
     fixture run ledger with local paths, instructions, document contents,
     stdout/stderr-like details, email addresses, tokens, and backup paths,
     then extracts the generated ZIP and proves default output contains only
     redaction markers.

8. Add generic verification and review tools for agentic coding and business
   tasks.
   - Current risk: `edit` and `write` can change files, but a generic agent also
     needs workspace state, diff review, and validation output to close the loop
     without falling back to an unrestricted shell.
   - Target: add `workspace_status`, `diff`, and bounded `run_command` tools.
     `run_command` supports build/test/lint/typecheck/format-check and explicit
     user-approved project commands through structured argv, timeout, output
     caps, cancellation, workspace containment, and deny rules for destructive,
     network, package-install, secret-reading, or cross-workspace behavior.
   - Acceptance: golden tests prove a coding task can inspect files, propose an
     exact edit, show a diff before approval, apply after approval, run a
     verification command, and feed the result back to Agent Framework for a
     final answer or next fix.

### P2: Search Performance And Argument Handling

9. Stream and cap ripgrep output before buffering.
   - Current risk: `rg_files` and process helpers can read all stdout before
     applying Relay caps, which can stall on very large shared folders.
   - Target: pass include/exclude/depth filters into ripgrep where possible,
     stream stdout, stop after the result cap, and kill the process on timeout
     or cancellation.
   - Acceptance: large-tree smoke fixture proves `rg_files` returns capped
     results within budget and cancellation stops the process.

10. Harden `rg_search` argv construction.
   - Current risk: search patterns that begin with `-` can be interpreted as
     ripgrep options.
   - Target: always pass a `--` separator before the user/model pattern and
     validate includes/excludes separately from the pattern.
   - Acceptance: regression test covers a pattern beginning with `-` and
     confirms it is treated as a pattern, not an option.

### P3: UX Trace Reliability

11. Deduplicate Workbench events by run sequence, not display text.
   - Current risk: repeated legitimate status messages can disappear if the UI
     deduplicates on message/detail text.
   - Target: event identity is `runId + sequence`; text-level dedupe is only a
     rendering convenience after sequence processing.
   - Acceptance: UX E2E fixture with repeated status messages shows all ordered
     events in the details trace and no duplicate final cards.

### Documentation And Plan Hygiene

- `AGENTS.md` in this repository already reflects the sidecar/workbench
  architecture. Any older pasted rule set that references `apps/desktop`,
  Tauri as active, or OpenCode/OpenWork as substrate is obsolete and must not
  steer implementation.
- `PLANS.md`, `README.md`, and `docs/IMPLEMENTATION.md` must keep the same
  active architecture story: one browser Workbench, one .NET sidecar,
  Microsoft Agent Framework as backend runtime, M365 Copilot through Relay's
  CDP adapter as planner, and Relay as local tool governance/execution layer.
- Completed migration tasks may remain as historical context below, but new
  implementation work should prioritize the P0/P1/P2/P3 remediation items
  above before expanding the tool catalog.

## Hard Cutover Rules

- No transitional fallback architecture. The migration is complete only when
  the new browser-hosted workbench and .NET sidecar are the single active
  product path.
- No simplified throwaway MVP. The first implementation slice must be shaped as
  the final architecture: sidecar-hosted UI, local HTTP/WebSocket APIs,
  Microsoft Agent Framework runtime, Relay Copilot adapter, generic tool
  catalog, approval flow, and packaging plan.
- No AionUi, OpenCode/OpenWork, Codex app-server, or Tauri runtime fallback in
  active product code. Historical docs may remain archived, but active source,
  package scripts, workflows, release resources, runtime launchers, and UI
  code must not depend on those paths.
- No silent fallback runtimes. If Copilot output, tool arguments, tool
  availability, workspace access, OfficeCLI readiness, or CDP automation fails
  validation, the run stops with a clear user-visible error. Bounded retries
  inside the same Copilot transport, such as paste retry, response candidate
  scoring, or one JSON repair turn, are allowed when they are logged and do not
  switch to an alternate runtime or weaker tool path.
- No hidden compatibility shims. Compatibility code is allowed only as a
  temporary migration aid inside a single branch while replacing callers; it
  must be removed before the cutover is marked complete.
- No old high-level workflow runners as backup paths. Search, Office editing,
  and code editing must run through the common agent runner and generic tools.
- Cutover completion requires deletion evidence: source search and release
  inventory must prove that active AionUi/OpenCode/OpenWork/Tauri paths are
  gone or archived-only.

## Prior-Art-Informed Additions

The browser-hosted sidecar design should adopt AG-UI as the Workbench-facing
protocol and UX contract, while incorporating lessons from Microsoft Agent
Framework, ASP.NET Core, and established agent tools without making Python or a
second agent runtime mandatory.

### Agent UI protocol

- Use AG-UI, not an unstructured ad hoc log stream, for the workbench/agent
  boundary. Relay should expose one AG-UI run stream and remove the current
  custom Workbench event protocol as a public API.
- Adopt AG-UI human-in-the-loop semantics for Office/code approvals. Approval
  cards are AG-UI interrupts; approve/reject is AG-UI resume input; Relay still
  enforces whether the operation is allowed.
- Use AG-UI state snapshot/delta events for workspace, selected files,
  pending approval, changed artifacts, and final answer state instead of
  inventing parallel state synchronization messages.
- Keep plain local HTTP APIs for non-agent app operations such as workspace
  selection, app status, logs export, static file serving, and shutdown.
- Use SignalR or raw WebSockets only if SSE cannot satisfy a specific future
  requirement. Do not maintain parallel event protocols for the same run
  lifecycle.

### AG-UI frontend and visual adoption

- The Workbench visual layer should be rebuilt around the AG-UI frontend
  ecosystem rather than a custom event renderer. The target implementation
  stack is React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Radix UI +
  `@ag-ui/client`.
- Study the official AG-UI Dojo and CopilotKit AG-UI examples as the visual
  baseline for chat, streaming answer, tool activity, shared state, and
  human-in-the-loop approval surfaces. Adopt the interaction patterns, not
  their marketing chrome.
- Use shadcn/ui and Radix UI for accessible primitives and owned component
  source. Tailwind CSS provides the styling layer and design tokens. Do not use
  Chakra UI as the default design system, and do not introduce Next.js unless a
  later requirement needs a real Next server or static-export-only benefit that
  Vite cannot provide.
- Relay visual constraints remain: one workspace, one composer, large
  whitespace, subdued borders, no mode buttons, no model/provider controls,
  no decorative gradients, and diagnostics collapsed by default.
- AG-UI component adoption must not weaken Relay policy. Tool execution,
  approval requirements, workspace containment, and support-bundle privacy stay
  in the sidecar governance layer.

### Local web app security

- Bind the workbench server to `127.0.0.1` by default. Do not listen on LAN
  interfaces unless a future explicit setting and security review adds it.
- Use a random per-run local access token in the launch URL and require it on
  every state-changing API request and event stream.
- Validate `Origin` / `Host` headers for browser requests. Reject cross-origin
  requests that do not match the launched workbench origin.
- Do not rely on browser cookies alone for local authentication. Localhost apps
  are still web apps and must guard against CSRF-style requests.
- Disable directory listing for static assets and expose only the built
  workbench bundle.
- Treat file paths, tool observations, and logs as sensitive local data. Never
  expose them through unauthenticated endpoints.

### Run lifecycle and state

- Implement an append-only run ledger in user-local Relay data:
  user message, Copilot steps, tool calls, observations, approvals, errors,
  final answer, and artifact paths.
- Support cancellation and clear terminal states (`completed`, `cancelled`,
  `failed`). A cancelled run must stop further tool execution.
- Add single-instance and port management: lock file, selected port record,
  stale process cleanup, browser-open retry, and graceful shutdown.
- On restart, show incomplete runs as recoverable history, not as active
  hidden background work.

### Observability and supportability

- Add first-class run IDs and trace IDs. Every Copilot request, tool call,
  approval, validation failure, and file mutation should be tied to the same
  run ID.
- Capture Relay traces in an OpenTelemetry-compatible shape where practical,
  while keeping the user UI minimal. The visible UI shows only concise
  progress; detailed traces live behind a collapsed details panel and
  support-log export.
- Add a local support bundle export that redacts or clearly flags sensitive
  file paths and does not include document contents unless the user explicitly
  chooses to include them.
- Add readiness probes for Copilot CDP, ripgrep, OfficeCLI, workspace access,
  static asset integrity, and tool catalog load. Startup should show a concise
  not-ready state rather than accepting tasks that cannot run.

### Change provenance and recovery

- For code work inside a git repository, record pre-run `git status`, planned
  edits, applied edits, post-run `git diff`, and dirty-file warnings. Relay
  should not auto-commit by default, but it should make review and undo
  straightforward.
- For non-git workspaces, record file hashes before mutation and keep explicit
  backup files in user-local Relay data or a user-approved backup location.
- For Office mutations, keep the current backup-before-apply policy and add an
  operation manifest that records the OfficeCLI command, target file, backup
  path, timestamp, and result.
- Provide a visible `元に戻す` path only when Relay has enough backup/diff
  evidence to restore safely. Do not fake undo for operations that are not
  reversible.

### Sandbox and command policy

- Keep unrestricted shell out of the default tool catalog. Prior agent systems
  distinguish isolated/container runtimes from direct process execution because
  direct local execution can read/write anything the user account can access.
- If shell execution is ever added, it must be a separate milestone with an
  explicit sandbox strategy, workspace mount policy, command allow/deny policy,
  and UI approval model. It must not appear as a hidden capability of the
  initial generic runner.
- Treat OfficeCLI and ripgrep as named tools with bounded argv validation, not
  as a generic shell escape hatch.

### Tool and approval policy

- Follow the proven pattern from coding agents: read-only inspection may run
  automatically inside the selected workspace; any mutation requires explicit
  approval.
- Do not add a broad user-facing auto-approve settings panel. It increases
  complexity and risk. Start with fixed policy: reads allowed, writes require
  approval, shell absent by default.
- Approval cards must show the exact operation, target path, backup/diff
  outcome where applicable, and the consequence of applying it.
- Tool policies are enforced by Relay, not trusted to Copilot prompts.

### Packaging and supply chain

- Use self-contained .NET publish targets for Windows and Linux so end users do
  not need to install .NET separately.
- Include static web assets in the sidecar package or alongside it with
  integrity checks.
- Windows distribution should use a user-scope NSIS installer for the sidecar
  Workbench. The installer must not require administrator rights, elevation,
  or the user's personal password.
- Produce a release inventory/SBOM-style artifact listing bundled binaries,
  licenses, hashes, and removed legacy components.
- Package ripgrep and OfficeCLI explicitly where licensing and platform support
  allow; otherwise fail readiness visibly with installation guidance. Do not
  silently fall back to slower or weaker implementations.

## 2026-05-16 Web-Researched Requirements Addendum

The following requirements are added after reviewing current Microsoft Agent
Framework, AG-UI, Edge DevTools Protocol, MCP, OWASP LLM security, and SBOM
guidance. These are product requirements where they describe Relay-owned
behavior; third-party framework adoption remains optional unless a later ADR
promotes it.

Reference anchors:

- ASP.NET Core Minimal APIs and localhost URL binding:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis`
- ASP.NET Core static files and directory browsing behavior:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files`
- .NET self-contained deployment:
  `https://learn.microsoft.com/en-us/dotnet/core/deploying/`
- Microsoft Agent Framework human-in-the-loop approval docs:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval`
- Microsoft Agent Framework tool calling docs:
  `https://learn.microsoft.com/en-us/agent-framework/journey/adding-tools`
- Microsoft Agent Framework 1.0 announcement:
  `https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/`
- Microsoft Agent Framework durable execution docs:
  `https://learn.microsoft.com/en-us/azure/durable-task/sdks/durable-agents-microsoft-agent-framework`
- Microsoft Agent Framework + AG-UI demo:
  `https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/`
- AG-UI protocol overview:
  `https://docs.ag-ui.com/introduction`
- AG-UI event model:
  `https://docs.ag-ui.com/sdk/js/core/events`
- AG-UI events concept docs:
  `https://docs.ag-ui.com/concepts/events`
- Microsoft Edge DevTools Protocol docs:
  `https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/`
- ASP.NET Core host filtering docs:
  `https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering`
- Microsoft Agent Framework MCP guidance:
  `https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools`
- Claude Code settings and permission model reference:
  `https://code.claude.com/docs/en/settings`
- MCP client/security best-practice docs:
  `https://modelcontextprotocol.io/docs/develop/clients/client-best-practices`
  and
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- OWASP LLM06 Excessive Agency:
  `https://genai.owasp.org/llmrisk/llm062025-excessive-agency/`
- OWASP Top 10 for LLM Applications project:
  `https://owasp.org/www-project-top-10-for-large-language-model-applications/`
- OpenAI prompt-injection safety overview:
  `https://openai.com/safety/prompt-injections/`
- ripgrep user guide:
  `https://ripgrep.dev/docs/guide/`
- NSIS `RequestExecutionLevel` docs:
  `https://nsis.sourceforge.io/Reference/RequestExecutionLevel`
- NSIS `MultiUser.nsh` per-user installation docs:
  `https://nsis.sourceforge.io/Docs/MultiUser/Readme.html`
- NIST SBOM guidance:
  `https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-security-supply-chains-software-1`

### Agent harness and event protocol requirements

- Use Microsoft Agent Framework in the .NET sidecar as the production harness
  for the generic agent loop. Its responsibilities are agent turns, tool-call
  detection, typed function dispatch, sessions, middleware, approval
  pause/resume, streaming updates, durable run state, and final answer
  synthesis.
- Relay remains the local governance layer around Agent Framework, not a
  competing orchestrator. Relay owns the M365 Copilot CDP provider adapter,
  workspace containment, local function bodies, backups, diffs, support
  bundles, and packaging.
- Implement tools as Agent Framework function tools first. Use
  `AIFunctionFactory.Create` with typed parameters and descriptions for
  in-process tools. Use `ApprovalRequiredAIFunction` for write/mutation tools.
  Add Relay middleware only for policy checks, logging, diagnostics, and
  Copilot transport adaptation.
- Do not add a parallel Relay-owned workflow runner, Python runner, OpenCode
  runner, or direct ad hoc AG-UI runner as a fallback. If Agent Framework cannot
  express a required Relay behavior, add a narrow adapter or middleware around
  Agent Framework and document the gap.
- Copilot transport failures are product failures, not alternate-route
  triggers. Prompt delivery failure, send failure, response extraction failure,
  invalid JSON, stale response pickup, or selector drift must fail the run with
  AG-UI error events and diagnostics so developers can fix the adapter.
- Implement human-in-the-loop approval as a loop, not as a single callback:
  when Agent Framework emits an approval request for a mutation function, the
  UI pauses the same run, presents the approval through AG-UI, and resumes only
  after approve/reject.
- Use AG-UI events for the Workbench run stream. Required event coverage
  includes run lifecycle, text message streaming, tool call start/args/result,
  state snapshot/delta, approval interrupt/resume, artifact creation, errors,
  cancellation, and completion.
- Keep the visible UI minimal, but preserve enough typed event metadata for
  replay, support export, and evaluation. Do not create a second event stream
  for the same run.
- Implement local durable-equivalent behavior: append-only run ledger,
  checkpointed observations, pause/resume, cancellation, terminal states, and
  retention/TTL cleanup in user-local data.

### Governance, security, and prompt-injection requirements

- Enforce action-layer governance before every tool execution. Relay must
  evaluate tool name, arguments, workspace scope, write/mutation status,
  approval state, rate limits, and policy before execution. Copilot prompts are
  not a security boundary.
- Minimize agency by default:
  - expose only the generic tools required for the task;
  - keep unrestricted shell absent from the default catalog;
  - require explicit approval for all writes, Office mutations, external
    network access, and future shell execution;
  - fail closed when tool selection or arguments are invalid.
- Treat all file contents, tool outputs, MCP/tool descriptions, and Copilot
  responses as untrusted data. They may be summarized or inspected, but they
  must never be allowed to change Relay policy, enable tools, bypass approval,
  change workspace scope, or alter system instructions.
- Add an explicit prompt-injection test corpus:
  local documents that instruct the agent to ignore policy, leak paths, enable
  shell, edit unrelated files, or exfiltrate content must not change Relay's
  execution policy.
- Add sensitive-data controls:
  support bundles redact or clearly flag local paths and omit document content
  by default; logs store tool metadata and bounded snippets only unless the
  user explicitly opts into full-content export.
- Strengthen localhost web security:
  keep loopback binding; require the launch token on APIs and event streams;
  validate `Host` and `Origin`; reject unauthenticated API calls; disable
  directory listing; and serve only the built static bundle.

### Tool discovery, MCP, and external tool requirements

- Keep the initial production catalog small but complete enough for a generic
  local agent: `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
  `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
- Add progressive tool discovery only when the catalog grows beyond the small
  always-on set. If adopted, expose a stable meta-tool such as `search_tools`
  and inject full schemas only for selected tool families. Do not churn the
  whole tool list every turn.
- MCP is not part of the first production tool surface. If later adopted:
  - allow only trusted, local, explicitly configured MCP servers by default;
  - never auto-install or auto-connect remote MCP servers;
  - log and audit every server, tool list, schema change, and tool call;
  - treat sessions as state handles, not authentication;
  - apply the same Relay approval and workspace policy to MCP tool calls as to
    built-in tools.
- Do not expose programmatic/code-mode tool calling until Relay has a sandbox
  design. The MCP guidance shows why code-mode can reduce token usage, but it
  requires a real sandbox and must not become an implicit unrestricted shell.

### Generic agent recipe requirements

These are not separate modes. They are common recipes that prove the generic
Agent Framework + Relay tool model is capable enough for real work.

- Local file search recipe:
  - Copilot chooses discovery terms and whether filename search, content search,
    or exact reads are needed.
  - Relay executes `rg_files`, `rg_search`, and `read` with caps, workspace
    containment, and evidence states.
  - Copilot synthesizes only from Relay observations. It must separate
    confirmed evidence from candidates and ask for follow-up search/read when
    the result set is skewed or weak.
- Office file editing recipe:
  - Copilot inspects the target Office file through `read` or registry-backed
    OfficeCLI inspection operations.
  - Relay compiles typed Office capability-registry operations to OfficeCLI
    argv, creates a backup, emits an AG-UI approval interrupt, applies only
    after approval, and verifies with a post-apply OfficeCLI view/read/render
    where available.
  - The Office registry must be broad enough to use OfficeCLI's agent-facing
    surface for Word, Excel, PowerPoint, and cross-document workflows, while
    still fail-closing on unknown command families, unsupported properties,
    ambiguous targets, unsafe paths, or OfficeCLI version drift.
  - Invalid sheet names, ambiguous ranges, missing OfficeCLI, and smoke failures
    fail the Office task clearly without degrading unrelated agent tasks.
- Coding recipe:
  - Copilot explores with `rg_files`, `rg_search`, `read`, and
    `workspace_status`.
  - Relay applies only validated `edit`/`write` mutations after approval and
    shows `diff` before and after mutation.
  - Copilot may request `run_command` for bounded verification, then iterate on
    failures through the same Agent Framework loop.
- General task recipe:
  - When a task does not fit search, Office, or coding, Copilot should still use
    the same generic inspect, mutate, verify, ask, and final-answer tools. Do
    not add a new mode unless a reusable tool family is genuinely missing.

### Copilot CDP reliability requirements

- Treat Edge CDP as a browser automation transport, not a stable Microsoft 365
  Copilot product API. Every release must include a live canary or manually
  recorded validation showing:
  - Copilot tab discovery or creation;
  - prompt paste reaches the composer;
  - send action succeeds;
  - stop/send button lifecycle or feed update is observed;
  - response extraction returns only the assistant answer, not sidebar/history
    chrome.
- Add DOM-contract regression fixtures from successful live sessions. The
  sidecar should keep selector candidates versioned and tested against saved
  feed/composer snippets so future Copilot DOM changes fail in CI before
  release when possible.
- Add visible CDP failure classes:
  `edge_not_running`, `cdp_unreachable`, `copilot_not_signed_in`,
  `composer_not_ready`, `prompt_not_pasted`, `send_unavailable`,
  `response_timeout`, and `response_parse_failed`.
- Start Edge/Copilot lazily and independently from Workbench first paint, but
  prewarm as soon as the user focuses the composer or starts a run. The UI must
  show `Copilot 接続中` rather than appearing frozen.

### Evaluation and release-readiness requirements

- Add a golden evaluation suite for the unified agent runner. Minimum cases:
  - file search chooses `rg_files`/`rg_search`/`read` and does not use
    Microsoft 365 built-in search; results distinguish filename candidates from
    content-confirmed evidence;
  - Office inspection uses `read` or semantic `officecli` view operations and
    Office mutation pauses for approval before execution, creates a backup, and
    verifies after apply;
  - code editing reads relevant files, proposes exact validated edits, shows a
    diff, applies only after approval, runs a bounded verification command when
    appropriate, and either fixes failures or reports them clearly;
  - a non-search/non-Office/non-code task can still use the generic inspect,
    mutate, verify, ask, and final tools without introducing a new UX mode;
  - invalid tool names or invalid arguments stop visibly;
  - prompt-injected file content cannot change policy;
  - repeated Copilot answer text does not cause stale response extraction.
- Evaluate tool calls on correctness, argument validity, intent alignment,
  dependency ordering, failure handling, and traceability. These criteria must
  be captured in machine-readable test output, not only manual notes.
- Add release canaries:
  - mock Copilot path for deterministic CI;
  - live signed-in Copilot CDP path when a signed-in Edge session is available;
  - OfficeCLI smoke on each packaged platform where OfficeCLI is supported;
  - ripgrep smoke from packaged resources and PATH.
- Generate a release SBOM or SBOM-style inventory in addition to the current
  release inventory. It must include direct dependencies, bundled binaries,
  hashes, versions, license/source notes, and an explicit list of intentionally
  excluded legacy runtimes.
- Make `docs/IMPLEMENTATION.md` record each requirement-level verification
  command and result. A task is not complete until the artifact or test output
  exists.

## AG-UI Workbench UX Plan

The integrated UX should be AG-UI-first and should feel like a quiet
professional workbench, not a developer console and not a wizard. AG-UI is the
source of truth for agent interaction structure; Relay's visual layer should
apply that structure with restrained enterprise styling.

Target frontend stack:

- React + Vite + TypeScript.
- Tailwind CSS for layout, spacing, typography, and design tokens.
- shadcn/ui for owned, editable component source.
- Radix UI for accessible primitives and focus/keyboard behavior.
- `@ag-ui/client` for the agent protocol runtime.
- lucide-react for icons.
- No Next.js by default; no Chakra UI by default.

### Layout

- Top bar: Relay mark, current workspace, compact Copilot/agent readiness.
- Main canvas: centered single column, `960-1040px` max width on desktop.
- AG-UI message thread: streaming assistant output, tool activity, and run
  status rendered from AG-UI events.
- Composer: one large natural-language input with one primary send action,
  connected to the AG-UI client runtime.
- Tool activity: concise AG-UI tool-call timeline, collapsed by default after
  completion.
- Approvals: AG-UI interrupt cards visible only when a local write/mutation is
  pending.
- State/results: AG-UI state snapshot/delta renders selected files, artifacts,
  changed paths, Office operation results, and final answer cards.
- Details: raw AG-UI event stream, observations, diagnostics, and logs are
  collapsed by default.

### Spacing and visual rules

- Use AG-UI/CopilotKit/Dojo agent UI patterns as the visual interaction
  reference, then strip them down to Relay's professional local-workbench
  surface.
- Use generous page margins: at least `32px`, and `56-80px` on wide displays.
- Use subdued panels and borders rather than heavy shadows.
- Keep cards at 8px radius or less.
- Keep result rows scannable; do not pack every metadata field into the first
  view.
- Prefer small section labels and restrained typography over large marketing
  headings.
- Use Relay design tokens for brand and spacing only where they do not conflict
  with AG-UI component structure. Do not fork AG-UI behavior to preserve old
  CSS.
- Avoid AI-purple gradients, decorative blobs, emoji icons, and tutorial copy.

### Interaction model

Initial state:

```text
Workspace: .../160連結

何をしますか？
[ 部品売上に関するファイルを探して                    ][送信]
```

During execution:

```text
assistant message stream
tool_call: rg_files
tool_result: candidates found
tool_call: read
state_delta: candidate evidence updated
```

Before a write:

```text
実行前に確認してください

Book2.xlsx
Sheet1 / A1 の塗りつぶしを赤に変更

[実行] [キャンセル]
```

Completed:

- Show the final answer first.
- Show result cards, changed files, or Office edit outcome below.
- Keep trace/details collapsed unless the user expands them.
- The visible result must be reconstructable from AG-UI messages, tool events,
  state events, and interrupts/resume events.

### Smooth UX acceptance requirements

The Workbench must be validated as a user-facing product, not only as a
backend agent API.

- First paint and entry route:
  - the launch URL `/` with the relay token must render the Workbench, not a
    404, browser error page, Edge Copilot page, or diagnostic console;
  - the first visible surface must be usable without opening details or logs;
  - static asset directory listing must remain blocked while the root route
    still serves the app.
- Readiness:
  - readiness must not collapse all tool checks into one misleading
    `Not ready` state;
  - use `Ready` when all checked tools are available, `Limited` when Copilot
    is available but optional tool checks fail, and `Not ready` only when the
    agent cannot accept tasks;
  - the composer remains understandable in `Limited` state and the detailed
    missing-tool reasons stay in collapsed details.
- Task flow:
  - a read-only task submitted from the composer must visibly progress to a
    final answer without mode selection;
  - a write/mutation task must pause before mutation, show one concise approval
    AG-UI interrupt card, and never create or modify a file before approval;
  - after approval, the approval card must disappear and the completed result
    must be visible without requiring the user to inspect raw JSON.
- AG-UI behavior:
  - run lifecycle, message streaming, tool activity, approval interrupts,
    resume, errors, cancellation, and final output must render from AG-UI
    events;
  - no Workbench-only custom event field may be required to show the main user
    experience;
  - raw Relay run ledger data may exist only behind diagnostics/support export.
- Visual behavior:
  - legacy mode labels such as `資料を探す`, `Officeファイルを編集する`, and
    `コードを書く` must not appear in the unified Workbench;
  - details, raw observations, and diagnostics remain collapsed by default;
  - the focused work area should stay within roughly `960-1040px` on desktop
    and preserve generous whitespace.
- Responsiveness:
  - deterministic mock E2E should complete read-only final-answer display and
    approval-card display within `6s` each;
  - the test must save screenshots for empty, completed, and approval states
    so spacing regressions can be inspected.
- Regression gate:
  - `pnpm workbench:ux-e2e` is the browser-level UX smoke gate. It launches
    the sidecar, opens Microsoft Edge through CDP, performs a real DOM-driven
    submit/approval flow, and writes screenshots under `dist/e2e/`.
  - `pnpm check` remains the non-browser acceptance gate; UX E2E is run when
    verifying user-visible flow changes or release readiness on machines with
    Edge available.

### Live Copilot UX requirements

Mock E2E is not enough for release confidence. Relay must also prove that the
same Workbench flow can drive a signed-in M365 Copilot session.

- Live gate:
  - `pnpm workbench:live-copilot-e2e` is the signed-in Copilot UX gate.
  - It must run with mock Copilot disabled and `RELAY_COPILOT_CDP_PORT`
    pointing at a real signed-in Microsoft Edge CDP session.
  - The Workbench browser and the Copilot browser must use separate CDP ports
    and profiles so user-facing UI automation cannot disturb the controlled
    Copilot tab.
- What it must prove:
  - `/api/status` reports Copilot CDP reachable before accepting the run;
  - the Workbench readiness pill reaches `Ready` or `Limited`, not a frozen
    `Checking` state;
  - the user can submit a task from the single composer;
  - Relay can paste the prompt into Copilot, submit it, wait for completion,
    extract the assistant response, and display the final event in the
    Workbench;
  - diagnostics/details remain collapsed by default after completion;
  - a screenshot of the completed live Copilot run is captured under
    `dist/e2e/`.
- Smoothness target:
  - for a short exact-response prompt, live Copilot final-answer display should
    complete within `15s` on a signed-in warm Edge session;
  - `15-30s` is acceptable but should be flagged as degraded;
  - over `30s`, prompt delivery failure, stale response extraction, or
    completion detection must be treated as a UX regression unless Microsoft
    365 service latency is clearly isolated.
- Failure requirements:
  - if the CDP port is unreachable, the run fails with a clear `Copilot CDP is
    not reachable` message;
  - if Copilot is signed out, blocked by tenant policy, or the composer cannot
    be found, the UI must show a visible actionable error and must not silently
    retry forever;
  - invalid Copilot output may fail the run, but the user must see whether the
    failure was prompt delivery, send button, response timeout, JSON/action
    validation, or tool validation.
- Prompt and JSON robustness:
  - Copilot prompts must not include copyable placeholder answers such as
    `"Japanese answer"` that can be mistaken for valid output;
  - Relay must parse the first complete JSON object from a Copilot response so
    harmless trailing text does not break an otherwise valid action;
  - if multiple JSON objects or trailing prose appear, Relay uses only the
    first complete object and still validates action/tool/args before
    execution.
- Release policy:
  - deterministic mock UX E2E remains suitable for CI;
  - live Copilot E2E is required before release or after any change touching
    Copilot CDP selectors, prompt delivery, response extraction, readiness, or
    Workbench run rendering.

## Non-Negotiable Completion Criteria

- The first visible product surface is the Relay Workbench, not Edge Copilot,
  OpenCode Web, AionUi, Tauri shell, or a diagnostic console.
- The Workbench shell is browser-hosted local web UI served by Relay's sidecar.
  Tauri is not an optional wrapper or fallback in the final product.
- The user should be able to submit a natural-language task from a single
  composer without selecting a mode first.
- Copilot may choose local tools, but Relay is the only component that executes
  tools.
- File search must execute through Relay-owned local tools, primarily
  ripgrep-backed `rg_files` / `rg_search` plus exact `read`, not Microsoft 365
  built-in search, SharePoint search, or Copilot's own browsing.
- Office workflows must execute through OfficeCLI, not Microsoft 365 built-in
  editing or ad hoc shell scripts.
- Relay may introspect OfficeCLI help/schema output to keep the semantic
  operation registry aligned with the bundled OfficeCLI version, but Copilot
  must never emit or directly execute raw OfficeCLI argv.
- OfficeCLI availability must not be marked failed when the failure is caused
  by Relay's own smoke-test file locking. File-sharing violations during smoke
  checks are release blockers until the smoke harness is corrected.
- Code workflows must apply only validated exact-string patches inside the
  selected workspace, show diffs, and run only bounded verification commands.
  Copilot may not execute tools or edit files directly.
- Agentic workflows must keep Copilot's authority limited to structured
  planning and synthesis. Relay is the only component that executes tools.
- The installed application must be able to run without bundled Codex
  app-server, bundled OpenAI clients that require external credentials, or
  hidden third-party agent binaries.
- Ollama is out of current release scope. It must not appear as a readiness
  gate, model picker, hidden reasoning path, or fallback harness.
- Write actions for Office and code require explicit user approval in the UI.
- Runtime errors must be visible in the UI. Silent stalls are release blockers.
- Installer generation must not use the AionUi release workflow.

## Historical Work And Deletion Context

The repository previously contained active Tauri/AionUi/OpenCode/OpenWork and
document-search-specific code. Those implementations have been removed from the
active source path; remaining references in historical docs are archival only
and are not a source of product direction.

Active cutover facts:

- `apps/workbench/` is the active browser Workbench UI.
- `apps/sidecar/` is the active .NET sidecar, Copilot transport, run manager,
  and local tool executor.
- The active runtime exposes one generic agent loop and a small generic tool
  catalog. Search, Office editing, and code editing are capabilities within
  that loop, not separate product modes.
- Stable Copilot bridge behavior may be ported from old commits only when it
  improves the current sidecar transport. Do not revive the old Node/Tauri
  bridge, AionUi shell, per-mode prompt contracts, or document-search engine.

Historical material that must not remain on the active path:

- Tauri IPC commands, Tauri resource packaging, and Tauri release workflows.
- AionUi overlays, AionUi provider configuration, and OpenCode/OpenWork gateway
  scripts.
- `RelayDocumentSearch*` high-level engines, SQLite/FTS/index coordinators,
  reflection prompts, and search-specific ranking/classification contracts.
- UI mode runners for `資料を探す`, `Officeファイルを編集する`, and `コードを書く`.
- Archive prompt files or historical design docs that are not required at
  runtime.

The only search-related behavior to preserve in the active plan is the generic
principle: Copilot may plan local exploration, Relay executes `rg_files`,
`rg_search`, and exact `read`, and Relay returns structured evidence-state
observations for Copilot to synthesize.

## Cutover Implementation Tasks

This checklist records the cutover contract and regression criteria. Many
items have already been implemented in the active sidecar/workbench path; do
not restart from item 1 by reintroducing deleted architecture. New work should
start from the **Current Review Remediation Plan** unless a regression proves a
cutover criterion below is no longer satisfied.

1. Freeze and inventory old paths before coding:
   - Inventory all active references to AionUi, OpenCode, OpenWork, Codex
     app-server, Tauri, Tauri IPC, Tauri resources, and release workflows.
   - Classify each reference as `active product`, `test`, `archived historical
     doc`, or `third-party factual reference`.
   - Strengthen the hard-cut guard so it scans active source, workflows,
     scripts, release inputs, and packaged assets, not only root package
     scripts.
   - Update `AGENTS.md` and any source-of-truth docs that still instruct Relay
     to keep OpenCode/OpenWork or Tauri as active substrate.
2. Build the final Relay sidecar foundation, not a temporary prototype:
   - Create a self-contained .NET sidecar as the primary process.
   - Host the static Relay Workbench web UI from the sidecar.
   - Expose local HTTP/WebSocket APIs for sessions, tools, approvals, status,
     logs, workspace selection, and shutdown.
   - Port or replace the Copilot Edge/CDP bridge inside the sidecar boundary so
     there is one Copilot transport path.
   - Use Microsoft Agent Framework in the sidecar as the active agent harness.
     The old Relay-owned runner must not remain as a fallback once the
     migration is complete.
   - Move required runtime resources such as OfficeCLI or ripgrep bundles out
     of `apps/desktop/src-tauri` into a sidecar-owned `tools/` or
     `third_party/` location before deleting the desktop tree.
3. Build the final browser-hosted Workbench UI:
   - One natural-language composer, no visible task-mode buttons.
   - Workspace selector.
   - Concise agent status and trace.
   - Result cards for files, Office operations, and code changes.
   - Approval cards for every write/mutation.
   - Collapsed diagnostics/details only.
   - No AionUi, OpenCode, Tauri, provider, model, runtime, feedback, or debug
     chrome.
   - Keep reusable design guidance in `apps/workbench/` or `docs/`; do not
     depend on deleted desktop design files.
4. Implement the generic progressive tool catalog:
   - `rg_files`, `rg_search`, `read`, `officecli`, `edit`, `write`,
     `workspace_status`, `diff`, `run_command`, `ask_user`, and `final`.
   - Validate every argument before execution.
   - Implement path containment, size/time limits, cancellation, and structured
     observations.
   - Stop on validation failure; do not route to old search, Office, or code
     runners as fallback.
5. Implement the Agent Framework runtime, approval loop, and governance layer:
   - Replace any one-shot or per-mode flow with a bounded Agent Framework run
     loop that uses the Relay Copilot provider adapter.
   - Add sidecar tool wrappers for the generic Relay tools.
   - Add middleware/policy checks for allowed tools, workspace scope, mutation
     approval, rate limits, and audit logging.
   - Implement approval handling as a pause/resume flow in the same run
     session.
   - Stream run events to the Workbench through AG-UI.
6. Add durable local run state:
   - Append every user message, Copilot step, tool call, observation,
     approval, artifact, error, and final answer to a run ledger under
     user-local Relay data.
   - Support cancellation and terminal states.
   - On restart, display incomplete runs as recoverable history, not active
     hidden work.
   - Add retention/TTL cleanup for stale ledgers, temp files, and support
     bundles.
7. Migrate all capabilities onto the common agent runner:
   - File discovery/search through `rg_files`, `rg_search`, and `read`.
   - Office inspection/editing through `officecli` semantic operations and
     Relay-compiled commands.
   - Code inspection/editing through `rg_*`, `read`, `edit`, and `write`.
   - Remove the old per-mode runners after parity, not leave them callable.
8. Add Copilot CDP reliability hardening:
   - Version and test composer/feed selectors against saved DOM fixtures.
   - Add failure classes for Edge/CDP/Copilot readiness and prompt delivery.
   - Keep live signed-in CDP canary scripts for release validation.
   - Ensure response extraction never returns sidebar, history, suggestion, or
     empty assistant-turn text as the model answer.
9. Add security and prompt-injection regression tests:
   - Add fixture documents that attempt to override Relay policy.
   - Prove untrusted file/tool output cannot enable tools, bypass approvals,
     expand workspace scope, or alter system instructions.
   - Prove support bundle export redacts or omits sensitive content by default.
10. Replace packaging:
   - Remove Tauri release workflow as an active release path.
   - Package the .NET sidecar and static web assets for Windows as a
     user-scope NSIS installer. The installer must install under a user-writable
     location such as `%LOCALAPPDATA%\Programs\Relay Agent`, must not require
     administrator rights or UAC elevation, and must not ask for the user's
     personal Windows password.
   - Package Linux as a self-contained archive plus launcher.
   - Provide a Windows launcher that starts the sidecar, starts or checks the
     signed-in Edge CDP session, opens the localhost workbench, and shuts down
     cleanly.
   - Bundle required Windows runtime tools in the installer where licensing and
     platform support allow: `Relay.Sidecar.exe`, Workbench static assets,
     `rg.exe`, `officecli.exe`, launcher files, default config, license/notice
     files, release inventory, and SBOM-style metadata.
   - Add a dedicated packaging command such as
     `pnpm sidecar:installer:windows` and a GitHub Release workflow that uses
     that command instead of any Tauri installer workflow.
   - The installer must create Start Menu and optional desktop shortcuts, an
     uninstall entry, and per-user registry/app metadata only. It must not write
     machine-wide registry keys or require Program Files installation.
   - Keep all app data, cache, logs, and temp files in user-local Relay
     directories.
   - Generate SBOM/SBOM-style release inventory with hashes, versions,
     licenses/source notes, and intentionally excluded legacy runtimes.
11. Delete active obsolete code:
   - Remove AionUi overlay code, OpenCode/OpenWork provider gateway code,
     Tauri shell/IPC/resources/workflows, and old high-level workflow runners
     once the new path is wired.
   - Remove `apps/desktop/document-search-src` and any active
     `RelayDocumentSearch*` code after confirming the generic `rg_*`/`read`
     tools cover the active search path.
   - Archive historical docs only when useful; do not keep active package
     scripts or tests that exercise removed runtime paths.
12. Verify the hard cutover:
   - Playwright screenshots for the browser-hosted workbench at desktop and
     narrow widths: empty, running, result, approval, error.
   - Linux and Windows E2E for startup, browser launch, Copilot connection,
     tool choice, approvals, search, Office inspect/edit where supported, code
     edit, shutdown, and uninstall.
   - E2E for security boundaries: localhost binding, launch token required,
     Origin/Host rejection, static asset directory listing disabled, and
     unauthenticated API rejection.
   - E2E for run lifecycle: cancellation stops tools, restart shows incomplete
     runs as history, and support bundle export works without leaking document
     contents by default.
   - E2E for change provenance: code diff capture, Office backup manifest,
     reversible undo where supported, and clear no-undo messaging where not
     supported.
   - Source and release inventory proving active AionUi/OpenCode/OpenWork/Tauri
     paths are removed.
   - Failure-path tests proving invalid Copilot/tool output stops with visible
     errors and does not invoke fallback execution.
   - Golden agent evaluations for tool choice correctness, argument validity,
     intent alignment, dependency ordering, failure handling, traceability, and
     prompt-injection resistance.
13. Complete the Relay rebranding cleanup:
   - Rename Relay-owned archive prompt files currently named
     `docs/archive/CODEX_PROMPT_*.md` / `docs/archive/codex_*.md` to
     `RELAY_PROMPT_*.md` / `relay_*.md`, preserving history in Git rather than
     deleting the files.
   - Update internal links and references that point to those renamed archive
     files.
   - Replace user-facing prose that says `Codex` when it means the Relay
     product, Relay implementation agent, or historical Relay prompt artifact.
   - Do not rename or rewrite references where `Codex` is an upstream
     dependency or required configuration surface, including `Codex app-server`,
     `codex` CLI commands, `CODEX_HOME`, external docs, and compatibility notes
     about third-party behavior.
   - Add a verification note showing the remaining `codex` / `Codex` matches
     are only upstream references or intentionally archived historical wording.
14. Add a corporate-compliance packaging review:
   - Inventory every release resource, executable, npm package, generated
     file, config directory, environment variable, and runtime process name that
     contains `codex`, `Codex`, OpenAI, OpenCode, or OpenWork terminology.
   - Classify each match as `Relay-owned branding`, `upstream dependency`,
     `developer-only artifact`, `archived historical doc`, or `runtime-required
     integration name`.
   - Remove developer-only and archived prompt artifacts from release bundles
     unless they are explicitly needed at runtime.
   - Do not bundle upstream `codex` CLI/app-server, OpenCode, or OpenWork in
     the release.
   - Implement Relay/Copilot integration through Microsoft Agent Framework in
     the Relay sidecar instead of hidden third-party agent artifacts.
   - Add a release verification artifact that lists remaining matches and their
     classification, plus the reason each one is acceptable for installation.
15. Keep out-of-scope model/harness options outside the cutover:
   - Microsoft Agent Framework is the approved backend harness. Do not add
     Ollama, MCP, unrestricted shell execution, Python workflow wrappers, or a
     second agent harness to the current release scope.
   - If one of those options is reconsidered later, require a separate ADR with
     threat model, packaging impact, UX impact, verification gates, and removal
     criteria for any replaced code path.
   - The current cutover completes only when Microsoft Agent Framework in the
     Relay sidecar, the M365 Copilot adapter, generic local tools, and browser
     Workbench are the single active product path.

## Verification Gates

- `pnpm check`
- `pnpm release:inventory`
- AG-UI adoption gates:
  - Workbench-facing run stream emits AG-UI events, not the old custom
    `RunEvent` wire union;
  - AG-UI message/tool/state/interrupt/resume/completion events can replay a
    run from start to final answer;
  - browser E2E proves the AG-UI Workbench renders streaming output, tool
    activity, approval interrupt, resume, cancellation/error, and final answer;
  - screenshots prove the AG-UI-based visual surface keeps Relay's minimal,
    spacious, professional UX.
- Workbench visual smoke: browser-hosted local UI screenshots for empty,
  running, approval, completed, and error states.
- Sidecar security smoke:
  - loopback-only binding;
  - launch token required;
  - Host/Origin rejection;
  - unauthenticated API/event-stream rejection;
  - static directory listing unavailable.
- Agent runner golden evaluations:
  - correct tool family chosen;
  - arguments valid and workspace-scoped;
  - mutation pauses for approval;
  - file search separates candidates from confirmed evidence;
  - Office edits create backups, apply semantic operations, and verify after
    mutation;
  - coding tasks expose workspace status, diff, bounded command verification,
    and follow-up repair when verification fails;
  - invalid Copilot output stops visibly;
  - prompt-injected file/tool content cannot change policy.
- CDP reliability gates:
  - mock Copilot path for CI;
  - live signed-in Edge/CDP exact-response canary when available;
  - saved DOM fixture tests for composer/feed extraction.
- Tool readiness gates:
  - packaged ripgrep smoke;
  - OfficeCLI `view outline --json` smoke where OfficeCLI is supported;
  - OfficeCLI smoke file cleanup and retry on transient sharing violations.
- Release supply-chain gates:
  - sidecar Windows/Linux self-contained publish;
  - Windows user-scope NSIS installer build;
  - installer smoke proving no administrator rights, UAC elevation, personal
    password prompt, Program Files install, or machine-wide registry writes;
  - release inventory;
  - SBOM/SBOM-style dependency and binary inventory;
  - legacy runtime exclusion inventory.
- Agent Framework sidecar smoke:
  - local mock Copilot adapter returns expected Agent Framework response;
  - Agent Framework function tools are registered from typed Relay functions,
    and the run fails if Copilot tool projection cannot produce valid
    Microsoft.Extensions.AI tool-call content;
  - current bridge smoke proves mutating function tools use
    `ApprovalRequiredAIFunction` and do not execute before approval;
  - final approval cutover smoke proves AG-UI approval requests resume through
    Agent Framework approval response content and no longer use Relay's custom
    `PendingApproval` wire protocol;
  - final session smoke proves Agent Framework `AgentSession` state is
    persisted enough to resume an approval and to keep tool observations
    attached to the same run;
  - live Edge CDP -> M365 Copilot exact-response canary passes when a signed-in
    session is available;
  - generic tool-choice smoke covers `rg_files`/`rg_search`/`read`,
    `officecli`, `edit`/`write`, `workspace_status`, `diff`, `run_command`,
    and approval behavior.
- Sidecar release workflow: Windows publishes the user-scope NSIS installer;
  Linux publishes the sidecar archive/launcher. Neither path may package the
  removed Tauri/AionUi/OpenCode/OpenWork runtime.
