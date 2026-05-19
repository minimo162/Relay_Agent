#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-smoke-token";
const port = 17891;
const dataDir = mkdtempSync(join(tmpdir(), "relay-sidecar-smoke-"));
const env = {
  ...process.env,
  RELAY_PORT: String(port),
  RELAY_LAUNCH_TOKEN: token,
  RELAY_DATA_DIR: dataDir,
  RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
  RELAY_ALLOW_MOCK_COPILOT: "1",
  RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify([
    "mock Copilot response from sidecar transport",
    "{\"ok\":true}",
    "{\"tool_calls\":[{\"name\":\"find_file\",\"arguments\":{\"query\":\"車名\"}}]}",
    "not json",
  ]),
};

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForStatus() {
  const url = `http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return response.json();
    } catch {
      // Wait for Kestrel to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

try {
  const status = await waitForStatus();
  if (status.app !== "Relay Agent") throw new Error(`unexpected status app: ${status.app}`);
  if (status.ready !== true) throw new Error(`required readiness was not green: ${JSON.stringify(status)}`);
  if (!status.checks.some((check) => check.name === "copilot-cdp" && check.ready === true)) {
    throw new Error(`mock Copilot readiness was not reported: ${JSON.stringify(status)}`);
  }
  if (status.checks.some((check) => check.name === "officecli" || check.name === "ripgrep")) {
    throw new Error(`Relay Core readiness must not check retired Relay-side tool bundles: ${JSON.stringify(status)}`);
  }

  const models = await fetch(`http://127.0.0.1:${port}/v1/models?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!models.ok) throw new Error(`models endpoint failed: ${models.status}`);
  const modelsJson = await models.json();
  if (!modelsJson.data?.some((model) => model.id === "m365-copilot")) {
    throw new Error(`models endpoint did not return m365-copilot: ${JSON.stringify(modelsJson)}`);
  }

  const model = await fetch(`http://127.0.0.1:${port}/v1/models/m365-copilot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!model.ok) throw new Error(`single model endpoint failed with bearer auth: ${model.status}`);

  const health = await fetch(`http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!health.ok) throw new Error(`health endpoint failed: ${health.status}`);
  const healthJson = await health.json();
  if (healthJson.schemaVersion !== "RelayCoreHealth.v1") {
    throw new Error(`unexpected health contract: ${JSON.stringify(healthJson)}`);
  }

  const session = await fetch(`http://127.0.0.1:${port}/v1/copilot/session?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!session.ok) throw new Error(`copilot session endpoint failed: ${session.status}`);

  const completion = await chat({
    model: "m365-copilot",
    messages: [{ role: "user", content: "ping" }],
  });
  if (!completion.ok) throw new Error(`completion endpoint failed: ${completion.status}`);
  const completionJson = await completion.json();
  if (completionJson.choices?.[0]?.message?.content !== "mock Copilot response from sidecar transport") {
    throw new Error(`unexpected completion response: ${JSON.stringify(completionJson)}`);
  }

  const jsonMode = await chat({
    model: "m365-copilot",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: "return json" }],
  });
  if (!jsonMode.ok) throw new Error(`json mode endpoint failed: ${jsonMode.status} ${await jsonMode.text()}`);
  const jsonModeJson = await jsonMode.json();
  if (JSON.parse(jsonModeJson.choices?.[0]?.message?.content ?? "{}").ok !== true) {
    throw new Error(`unexpected json mode response: ${JSON.stringify(jsonModeJson)}`);
  }

  const toolCall = await chat({
    model: "m365-copilot",
    messages: [{ role: "user", content: "find 車名" }],
    tools: [{
      type: "function",
      function: {
        name: "find_file",
        description: "Find a local file in the client.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        strict: true,
      },
    }],
    tool_choice: "required",
    parallel_tool_calls: false,
  });
  if (!toolCall.ok) throw new Error(`tool call endpoint failed: ${toolCall.status} ${await toolCall.text()}`);
  const toolCallJson = await toolCall.json();
  const returnedTool = toolCallJson.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCallJson.choices?.[0]?.finish_reason !== "tool_calls" || returnedTool?.function?.name !== "find_file") {
    throw new Error(`unexpected tool call response: ${JSON.stringify(toolCallJson)}`);
  }
  if (JSON.parse(returnedTool.function.arguments).query !== "車名") {
    throw new Error(`unexpected tool arguments: ${JSON.stringify(toolCallJson)}`);
  }

  const invalidJsonMode = await chat({
    model: "m365-copilot",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: "return invalid json" }],
  });
  if (invalidJsonMode.status !== 502) {
    throw new Error(`invalid JSON mode should fail with 502, got ${invalidJsonMode.status}: ${await invalidJsonMode.text()}`);
  }

  const invalidModel = await chat({
    model: "gpt-4o",
    messages: [{ role: "user", content: "ping" }],
  });
  if (invalidModel.status !== 404) {
    throw new Error(`invalid model should fail with 404, got ${invalidModel.status}: ${await invalidModel.text()}`);
  }

  const unsupportedStream = await chat({
    model: "m365-copilot",
    stream: true,
    messages: [{ role: "user", content: "ping" }],
  });
  if (unsupportedStream.status !== 400) {
    throw new Error(`stream=true should fail with 400, got ${unsupportedStream.status}: ${await unsupportedStream.text()}`);
  }

  async function chat(body) {
    return fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify(body),
  });
  }

  const manifest = await fetch(`http://127.0.0.1:${port}/v1/relay/manifest?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!manifest.ok) throw new Error(`manifest endpoint failed: ${manifest.status}`);
  const manifestJson = await manifest.json();
  if (manifestJson.schemaVersion !== "RelayHtmlToolManifest.v1") {
    throw new Error(`unexpected manifest contract: ${JSON.stringify(manifestJson)}`);
  }
  if (!manifestJson.endpoints?.some((endpoint) => endpoint.path === "/v1/chat/completions")) {
    throw new Error(`manifest did not advertise chat completions: ${JSON.stringify(manifestJson)}`);
  }
  if (!manifestJson.endpoints?.some((endpoint) => endpoint.path === "/v1/models")) {
    throw new Error(`manifest did not advertise models: ${JSON.stringify(manifestJson)}`);
  }
  if (manifestJson.endpoints?.some((endpoint) => endpoint.path === "/agui/relay" || endpoint.path === "/v1/tools")) {
    throw new Error(`manifest must not advertise retired local runner endpoints: ${JSON.stringify(manifestJson)}`);
  }

  const preflight = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "OPTIONS",
    headers: {
      Origin: "null",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  if (preflight.status !== 204) throw new Error(`HTML tool CORS preflight failed: ${preflight.status}`);
  if (preflight.headers.get("access-control-allow-origin") !== "null") {
    throw new Error(`HTML tool CORS origin was not echoed: ${preflight.headers.get("access-control-allow-origin")}`);
  }
  if (!preflight.headers.get("access-control-allow-headers")?.toLowerCase().includes("authorization")) {
    throw new Error(`HTML tool CORS did not allow Authorization: ${preflight.headers.get("access-control-allow-headers")}`);
  }

  console.log("[sidecar-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
