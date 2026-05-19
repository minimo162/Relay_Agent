#!/usr/bin/env node
import readline from "node:readline";
import { appendFileSync } from "node:fs";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});

let initialized = false;
let threadSeq = 0;
let turnSeq = 0;
const pendingApprovals = new Map();
const pendingDynamicToolRequests = new Map();
const tracePath = process.env.RELAY_APP_SERVER_FIXTURE_TRACE;

function trace(message) {
  if (!tracePath) return;
  appendFileSync(tracePath, `${message}\n`, "utf8");
}

function send(message) {
  trace(`send ${JSON.stringify(message)}`);
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function error(id, code, message) {
  send({ id, error: { code, message } });
}

function notify(method, params = {}) {
  send({ method, params });
}

function completeTurn(turn, text) {
  notify("item/agentMessage/delta", {
    turnId: turn.id,
    itemId: `item-${turn.id}-message`,
    delta: text,
  });
  notify("item/completed", {
    turnId: turn.id,
    item: {
      id: `item-${turn.id}-message`,
      type: "agent_message",
      text,
    },
  });
  notify("turn/completed", {
    turnId: turn.id,
    turn: { ...turn, status: "completed" },
  });
}

function fixtureInputText(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return String(input ?? "");
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (Array.isArray(item.content)) {
        return item.content
          .map((part) => part && typeof part === "object" && typeof part.text === "string" ? part.text : "")
          .filter(Boolean)
          .join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  trace(`recv ${line}`);

  let message;
  try {
    message = JSON.parse(line);
  } catch (reason) {
    notify("protocol/error", { message: "invalid json", detail: String(reason) });
    return;
  }

  const { id, method, params = {} } = message;

  if (method !== "initialize" && method !== "initialized" && !initialized) {
    error(id, -32002, "Not initialized");
    return;
  }

  switch (method) {
    case "initialize":
      send({
        id,
        result: {
          userAgent: "relay-codex-app-server-fixture/1.0",
          codexHome: process.env.CODEX_HOME ?? null,
          platformFamily: process.platform === "win32" ? "windows" : "unix",
          platformOs: process.platform,
          protocolVersion: "fixture",
        },
      });
      break;

    case "initialized":
      initialized = true;
      notify("server/initialized", { ready: true });
      break;

    case "thread/start": {
      const threadId = `thread-fixture-${++threadSeq}`;
      const thread = {
        id: threadId,
        status: "ready",
        path: null,
        ephemeral: params.ephemeral !== false,
      };
      send({ id, result: { thread } });
      notify("thread/started", { thread });
      break;
    }

    case "turn/start": {
      const turnId = `turn-fixture-${++turnSeq}`;
      const threadId = params.threadId ?? "thread-fixture-unknown";
      const inputText = fixtureInputText(params.input);
      const turn = { id: turnId, threadId, status: "running" };
      send({ id, result: { turn } });
      setTimeout(() => {
        notify("turn/started", { turnId, turn });
        if (inputText.includes("fixture-command-approval")) {
          const requestId = 9000 + turnSeq;
          pendingApprovals.set(requestId, { turn, kind: "command" });
          send({
            id: requestId,
            method: "item/commandExecution/requestApproval",
            params: {
              itemId: `item-${turnSeq}-command`,
              threadId,
              turnId,
              startedAtMs: Date.now(),
              cwd: params.cwd ?? null,
              command: "node --version",
              reason: "Fixture command approval",
            },
          });
          return;
        }
        if (inputText.includes("fixture-file-approval")) {
          const requestId = 9100 + turnSeq;
          pendingApprovals.set(requestId, { turn, kind: "file" });
          send({
            id: requestId,
            method: "item/fileChange/requestApproval",
            params: {
              itemId: `item-${turnSeq}-file`,
              threadId,
              turnId,
              startedAtMs: Date.now(),
              grantRoot: params.cwd ?? null,
              reason: "Fixture file-change approval",
            },
          });
          return;
        }
        if (inputText.includes("fixture-dynamic-tool")) {
          const requestId = 9200 + turnSeq;
          pendingDynamicToolRequests.set(requestId, { turn });
          send({
            id: requestId,
            method: "item/tool/call",
            params: {
              threadId,
              turnId,
              callId: `tool-fixture-${turnSeq}-dynamic`,
              tool: "relay_custom_tool",
              arguments: { value: "should be rejected" },
            },
          });
          return;
        }
        completeTurn(turn, `Fixture response for: ${inputText}`);
      }, 10);
      break;
    }

    case "turn/interrupt": {
      const turnId = params.turnId ?? "turn-fixture-unknown";
      send({ id, result: { interrupted: true, turnId } });
      notify("turn/completed", {
        turnId,
        turn: { id: turnId, status: "cancelled" },
      });
      break;
    }

    default:
      if (pendingApprovals.has(id)) {
        const pending = pendingApprovals.get(id);
        pendingApprovals.delete(id);
        const decision = params?.decision ?? message.result?.decision ?? "unknown";
        completeTurn(pending.turn, `Approval ${pending.kind} resolved: ${decision}`);
      } else if (pendingDynamicToolRequests.has(id)) {
        const pending = pendingDynamicToolRequests.get(id);
        pendingDynamicToolRequests.delete(id);
        if (!message.error) {
          error(id, -32603, "Dynamic tool request should have been rejected by Relay");
          return;
        }
        completeTurn(pending.turn, `Dynamic tool rejected: ${message.error.message}`);
      } else {
        error(id, -32601, `Unknown method: ${method}`);
      }
      break;
  }
});

rl.on("close", () => {
  process.exit(0);
});
