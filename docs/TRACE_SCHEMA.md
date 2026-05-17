# Relay Framework Trace Schema

Date: 2026-05-17

Relay traces should be compatible with OpenTelemetry-style spans while staying
safe for support bundles. The trace aligns Copilot provider calls, Agent
Framework tool admission, AG-UI events, approvals, and local tool execution.

## Span Fields

| Field | Required | Description |
| --- | --- | --- |
| `schemaVersion` | yes | `RelayFrameworkTraceSpan.v1`. |
| `traceId` | yes | Stable trace identifier for one user-visible run. |
| `spanId` | yes | Unique span identifier. |
| `parentSpanId` | no | Parent span identifier when available. |
| `name` | yes | Short operation name such as `copilot.send`, `tool.execute`, or `approval.resume`. |
| `category` | yes | One of `provider`, `projection`, `admission`, `approval`, `tool`, `terminal`, `ui`, `packaging`. |
| `agUiRunId` | yes | AG-UI run ID for replay correlation. |
| `agentSessionId` | yes | Agent Framework session identifier or hashed session key. |
| `toolCallId` | no | Tool call ID when the span is tool-related. |
| `toolName` | no | Canonical tool name. |
| `status` | yes | `ok`, `error`, `blocked`, or `provider_blocked`. |
| `retryable` | yes | Whether retrying the same operation may succeed. |
| `startedAt` | yes | ISO-8601 timestamp. |
| `endedAt` | no | ISO-8601 timestamp. |
| `attributes` | yes | Redacted structured metadata. |

## Redaction Rules

- Do not include raw prompt text, raw Copilot response text, file contents,
  Office cell values, or command stdout/stderr by default.
- Include artifact IDs, hashes, byte/line counts, capped counts, exit code,
  provider readiness state, tool name, workspace hash, and retryability.
- Prompt dumps and raw response dumps remain opt-in sensitive artifacts and
  must be referenced by artifact ID only.

## Provider Failure Classification

Provider failures must be distinguishable from harness failures:

- `provider_blocked`: Copilot quota, login, tenant, page readiness, or Edge CDP
  availability prevents a model call.
- `blocked`: Relay policy or missing local tool readiness prevents a call
  before Copilot is invoked.
- `error`: tool execution, validation, JSON parsing, or terminal eligibility
  failed after admission.

These statuses must line up with AG-UI `RUN_ERROR` events and support-bundle
summaries.
