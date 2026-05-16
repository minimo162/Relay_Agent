export async function postAgUi({ port, token, workspace, runId, instruction, messages }) {
  const response = await fetch(`http://127.0.0.1:${port}/agui/relay?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify(runInput({ workspace, runId, instruction, messages })),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AG-UI endpoint failed: ${response.status} ${text}`);
  }
  return parseSse(text);
}

export function parseSse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    events.push(JSON.parse(line.slice(6)));
  }
  return { text, events };
}

export function collectToolCall(events, expectedName) {
  const calls = collectToolCalls(events);
  for (const call of calls.values()) {
    if (call.name === expectedName) return call;
  }
  throw new Error(`Did not find ${expectedName} tool call: ${JSON.stringify(events)}`);
}

export function collectToolCalls(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "TOOL_CALL_START") {
      calls.set(event.toolCallId, { id: event.toolCallId, name: event.toolCallName, args: "", results: [] });
    } else if (event.type === "TOOL_CALL_ARGS") {
      const call = calls.get(event.toolCallId);
      if (call) call.args += event.delta ?? "";
    } else if (event.type === "TOOL_CALL_RESULT") {
      const call = calls.get(event.toolCallId);
      if (call) call.results.push(event.content ?? "");
    }
  }
  return calls;
}

export function readApprovalRequest(toolCall) {
  const args = JSON.parse(toolCall.args || "{}");
  if (typeof args.request !== "string") {
    throw new Error(`approval request args did not include request JSON string: ${toolCall.args}`);
  }
  const request = JSON.parse(args.request);
  if (!request.approvalId || !request.toolCallId || !request.functionName) {
    throw new Error(`invalid approval request payload: ${JSON.stringify(request)}`);
  }
  return { args, request };
}

export function approvalMessages(runId, userText, approvalToolCall, approved) {
  return [
    { id: `${runId}-user`, role: "user", content: userText },
    {
      id: `${runId}-assistant-approval`,
      role: "assistant",
      toolCalls: [
        {
          id: approvalToolCall.id,
          type: "function",
          function: {
            name: approvalToolCall.name,
            arguments: approvalToolCall.args,
          },
        },
      ],
    },
    {
      id: `${runId}-tool-approval`,
      role: "tool",
      toolCallId: approvalToolCall.id,
      content: JSON.stringify({
        approved,
        reason: approved ? "approved in AG-UI smoke" : "rejected in AG-UI smoke",
      }),
    },
  ];
}

export function assistantText(events) {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => event.delta ?? "")
    .join("");
}

export function hasRunFinished(events) {
  return events.some((event) => event.type === "RUN_FINISHED");
}

function runInput({ workspace, runId, instruction, messages }) {
  return {
    threadId: `thread-${runId}`,
    runId,
    state: { workspace, relay_workspace: workspace },
    messages: messages?.length
      ? messages
      : [{ id: `${runId}-user`, role: "user", content: instruction }],
    tools: [],
    context: [
      { description: "workspace", value: workspace },
      { description: "relay_workspace", value: workspace },
    ],
    forwardedProps: { workspace, relay_workspace: workspace },
    forwardedProperties: { workspace, relay_workspace: workspace },
  };
}
