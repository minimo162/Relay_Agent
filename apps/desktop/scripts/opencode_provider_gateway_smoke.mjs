#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildOpenAiCompletionBody,
  createServer,
} from "../src-tauri/binaries/copilot_server.js";

const opencodeRepo = process.env.OPENCODE_REPO || "/root/opencode";
const bunPath = process.env.BUN_BIN || "/root/.bun/bin/bun";
const token = process.env.RELAY_AGENT_API_KEY || "relay-provider-smoke-token";
const expected = "OPEN_CODE_RELAY_SMOKE_OK";
const toolExpected = "OPEN_CODE_RELAY_TOOL_SMOKE_OK";
const toolMarker = "TOOL_ROUNDTRIP_OK";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, Number(process.env.OPENCODE_PROVIDER_SMOKE_TIMEOUT_MS || 120_000));
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function makeMockSession() {
  const progress = new Map();
  const requests = [];
  let toolFixturePath = "";

  function makeCompletion(text, prompt) {
    return {
      status: 200,
      body: buildOpenAiCompletionBody(text, prompt),
    };
  }

  return {
    requests,
    setToolFixturePath(value) {
      toolFixturePath = value;
    },
    async inspectStatus() {
      return { connected: true, loginRequired: false };
    },
    async startOrJoinDescribe(prompt) {
      requests.push(prompt);
      const current = {
        relaySessionId: prompt.relaySessionId,
        relayRequestId: prompt.relayRequestId,
        visibleText: "",
        done: false,
        phase: "waiting",
        updatedAt: Date.now(),
      };
      progress.set(prompt.relayRequestId, current);
      const hasReadTool = prompt.tools.some((tool) => tool.function?.name === "read");
      const isToolRoundtripPrompt = /relay tool roundtrip/i.test(prompt.userPrompt);
      const hasToolResult = prompt.userPrompt.includes(toolMarker);
      const responseText =
        hasToolResult
          ? toolExpected
          : isToolRoundtripPrompt && hasReadTool
            ? JSON.stringify({
                tool_calls: [
                  {
                    id: "call_read_smoke_fixture",
                    function: {
                      name: "read",
                      arguments: JSON.stringify({ filePath: toolFixturePath }),
                    },
                  },
                ],
              })
            : expected;

      current.visibleText = responseText.slice(0, Math.min(9, responseText.length));
      current.updatedAt = Date.now();
      await wait(250);
      current.visibleText = responseText.slice(0, Math.min(15, responseText.length));
      current.updatedAt = Date.now();
      await wait(250);
      current.visibleText = responseText;
      current.done = true;
      current.phase = "completed";
      current.updatedAt = Date.now();
      return makeCompletion(responseText, prompt);
    },
    abortRequest(_relaySessionId, relayRequestId) {
      const current = progress.get(relayRequestId);
      if (!current) return false;
      current.done = true;
      current.phase = "aborted";
      current.updatedAt = Date.now();
      return true;
    },
    getRequestProgress(_relaySessionId, relayRequestId) {
      return progress.get(relayRequestId) || null;
    },
  };
}

async function runOpenCode(workspace, xdg, prompt) {
  return await run(
    bunPath,
    [
      "dev",
      "run",
      "--pure",
      "--print-logs",
      "--log-level",
      "DEBUG",
      "--format",
      "json",
      "--model",
      "relay-agent/m365-copilot",
      "--dangerously-skip-permissions",
      "--dir",
      workspace,
      prompt,
    ],
    {
      cwd: opencodeRepo,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${path.dirname(bunPath)}:${process.env.PATH || ""}`,
        RELAY_AGENT_API_KEY: token,
        XDG_CONFIG_HOME: xdg.config,
        XDG_DATA_HOME: xdg.data,
        XDG_STATE_HOME: xdg.state,
        XDG_CACHE_HOME: xdg.cache,
        OPENCODE_DISABLE_UPDATE_CHECK: "1",
      },
    },
  );
}

function requestSummary(request) {
  return {
    model: request.model,
    stream: request.stream,
    relaySessionId: request.relaySessionId,
    relayRequestId: request.relayRequestId,
    tools: request.tools.map((tool) => tool.function.name).sort(),
    userPromptPreview: request.userPrompt.slice(0, 240),
  };
}

async function main() {
  await fs.access(bunPath);
  await fs.access(path.join(opencodeRepo, "package.json"));

  const session = makeMockSession();
  const server = createServer(session, { bootToken: token });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "relay-opencode-provider-"));
  const workspace = path.join(tempRoot, "workspace");
  const xdgConfig = path.join(tempRoot, "xdg-config");
  const xdgData = path.join(tempRoot, "xdg-data");
  const xdgState = path.join(tempRoot, "xdg-state");
  const xdgCache = path.join(tempRoot, "xdg-cache");

  try {
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(xdgConfig, { recursive: true });
    await fs.mkdir(xdgData, { recursive: true });
    await fs.mkdir(xdgState, { recursive: true });
    await fs.mkdir(xdgCache, { recursive: true });
    const fixturePath = path.join(workspace, "relay_tool_fixture.txt");
    await fs.writeFile(fixturePath, `${toolMarker}\n`);
    session.setToolFixturePath(fixturePath);
    await fs.writeFile(
      path.join(workspace, "opencode.json"),
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          enabled_providers: ["relay-agent"],
          provider: {
            "relay-agent": {
              npm: "@ai-sdk/openai-compatible",
              name: "Relay Agent / M365 Copilot",
              options: {
                baseURL,
                apiKey: "{env:RELAY_AGENT_API_KEY}",
              },
              models: {
                "m365-copilot": {
                  name: "M365 Copilot",
                  limit: {
                    context: 128000,
                    output: 8192,
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const xdg = {
      config: xdgConfig,
      data: xdgData,
      state: xdgState,
      cache: xdgCache,
    };
    const result = await runOpenCode(
      workspace,
      xdg,
      "Reply exactly OPEN_CODE_RELAY_SMOKE_OK.",
    );
    const toolResult = await runOpenCode(
      workspace,
      xdg,
      `Relay tool roundtrip smoke: use the read tool to read ${fixturePath}, then reply exactly ${toolExpected}.`,
    );

    const combined = `${result.stdout}\n${result.stderr}`;
    const toolCombined = `${toolResult.stdout}\n${toolResult.stderr}`;
    const request = session.requests.find(
      (item) =>
        item.model === "m365-copilot" &&
        item.stream === true &&
        item.userPrompt.includes(expected) &&
        !/Generate a title/i.test(item.userPrompt),
    );
    const toolRequest = session.requests.find(
      (item) => /relay tool roundtrip/i.test(item.userPrompt) && item.tools.some((tool) => tool.function.name === "read"),
    );
    const toolFollowupRequest = session.requests.find((item) => item.userPrompt.includes(toolMarker));
    const ok =
      result.code === 0 &&
      toolResult.code === 0 &&
      combined.includes(expected) &&
      toolCombined.includes(toolExpected) &&
      request &&
      request.model === "m365-copilot" &&
      request.stream === true &&
      toolRequest &&
      toolFollowupRequest;
    if (!ok) {
      console.error("[opencode-provider-smoke] failed");
      console.error("exit:", result.code, "signal:", result.signal);
      console.error("toolExit:", toolResult.code, "toolSignal:", toolResult.signal);
      console.error("baseURL:", baseURL);
      console.error("capturedRequests:", JSON.stringify(session.requests.map(requestSummary), null, 2));
      console.error("stdout:", result.stdout.slice(-4000));
      console.error("stderr:", result.stderr.slice(-4000));
      console.error("toolStdout:", toolResult.stdout.slice(-4000));
      console.error("toolStderr:", toolResult.stderr.slice(-4000));
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          opencodeRepo,
          workspace,
          providerBaseURL: baseURL,
          request: requestSummary(request),
          toolRequest: requestSummary(toolRequest),
          toolFollowupRequest: requestSummary(toolFollowupRequest),
        },
        null,
        2,
      ),
    );
  } finally {
    await close(server);
    if (process.env.RELAY_KEEP_OPENCODE_PROVIDER_SMOKE_DIR !== "1") {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("[opencode-provider-smoke] fatal:", error);
  process.exit(1);
});
