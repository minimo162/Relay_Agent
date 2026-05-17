#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturePath = join(process.cwd(), "scripts/fixtures/agui-replay-sample.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const standardTypes = new Set([
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "STEP_STARTED",
  "STEP_FINISHED",
  "REASONING_START",
  "REASONING_END",
  "REASONING_MESSAGE_CONTENT",
  "THINKING_START",
  "THINKING_END",
  "THINKING_TEXT_MESSAGE_CONTENT",
]);

if (fixture.schemaVersion !== "RelayAgUiReplayFixture.v1") {
  throw new Error(`unexpected schemaVersion: ${fixture.schemaVersion}`);
}
if (!Array.isArray(fixture.events) || fixture.events.length === 0) {
  throw new Error("fixture must contain events");
}

const replay = {
  started: false,
  finished: false,
  state: {},
  toolCalls: new Map(),
  toolResults: new Map(),
  approvals: [],
  finalText: "",
};

let previousSequence = 0;
for (const event of fixture.events) {
  if (!standardTypes.has(event.type)) {
    throw new Error(`non-standard AG-UI event type in primary replay fixture: ${event.type}`);
  }
  if (typeof event.sequence !== "number" || event.sequence <= previousSequence) {
    throw new Error(`event sequence must be strictly increasing: ${JSON.stringify(event)}`);
  }
  previousSequence = event.sequence;

  switch (event.type) {
    case "RUN_STARTED":
      replay.started = true;
      break;
    case "STATE_SNAPSHOT":
      replay.state = event.snapshot ?? {};
      break;
    case "STATE_DELTA":
      for (const op of event.delta ?? []) {
        if (op.op === "replace" && typeof op.path === "string" && op.path.startsWith("/")) {
          replay.state[op.path.slice(1)] = op.value;
        }
      }
      break;
    case "TOOL_CALL_START":
      replay.toolCalls.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolCallName,
        args: "",
      });
      break;
    case "TOOL_CALL_ARGS": {
      const call = replay.toolCalls.get(event.toolCallId);
      if (!call) throw new Error(`TOOL_CALL_ARGS without start: ${event.toolCallId}`);
      call.args += event.delta ?? "";
      break;
    }
    case "TOOL_CALL_END": {
      const call = replay.toolCalls.get(event.toolCallId);
      if (!call) throw new Error(`TOOL_CALL_END without start: ${event.toolCallId}`);
      if (call.name === "request_approval") {
        const parsed = JSON.parse(call.args);
        const request = typeof parsed.request === "string" ? JSON.parse(parsed.request) : parsed.request;
        if (!request?.approvalId || !request?.functionName) {
          throw new Error(`invalid approval request: ${call.args}`);
        }
        replay.approvals.push(request);
      } else {
        JSON.parse(call.args);
      }
      break;
    }
    case "TOOL_CALL_RESULT":
      replay.toolResults.set(event.toolCallId, event.content ?? "");
      break;
    case "TEXT_MESSAGE_CONTENT":
      replay.finalText += event.delta ?? "";
      break;
    case "RUN_FINISHED":
      replay.finished = true;
      break;
  }
}

if (!replay.started || !replay.finished) throw new Error("run lifecycle was not replayable");
if (replay.approvals.length !== 1) throw new Error(`expected one approval, got ${replay.approvals.length}`);
if (!replay.toolCalls.has("tool-write-001")) throw new Error("write tool call missing");
if (!replay.toolResults.has("tool-write-001")) throw new Error("write tool result missing");
if (replay.state.status !== "completed") throw new Error(`state replay failed: ${JSON.stringify(replay.state)}`);
if (!replay.finalText.includes("demo.txt")) throw new Error(`final text replay failed: ${replay.finalText}`);

console.log("[agui-replay-smoke] ok");
