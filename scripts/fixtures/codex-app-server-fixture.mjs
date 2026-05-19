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
      const turn = { id: turnId, threadId, status: "running" };
      send({ id, result: { turn } });
      setTimeout(() => {
        notify("turn/started", { turnId, turn });
        notify("item/agentMessage/delta", {
          turnId,
          itemId: `item-${turnSeq}-message`,
          delta: `Fixture response for: ${params.input ?? ""}`,
        });
        notify("item/completed", {
          turnId,
          item: {
            id: `item-${turnSeq}-message`,
            type: "agent_message",
            text: `Fixture response for: ${params.input ?? ""}`,
          },
        });
        notify("turn/completed", {
          turnId,
          turn: { ...turn, status: "completed" },
        });
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
      error(id, -32601, `Unknown method: ${method}`);
      break;
  }
});

rl.on("close", () => {
  process.exit(0);
});
