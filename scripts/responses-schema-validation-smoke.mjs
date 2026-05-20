#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const token = "relay-responses-schema-smoke-token";
const port = 17963;
const dataDir = mkdtempSync(join(tmpdir(), "relay-responses-schema-smoke-"));

const mockResponses = [
  'prefix {"tool_calls":[{"name":"emit_status","arguments":{"label":"ok","count":1}}]} suffix',
  '{"tool_calls":[{"name":"evil_tool","arguments":{"label":"bad","count":2}}]}',
  '{"tool_calls":[{"name":"emit_status","arguments":{"label":"missing-count"}}]}',
  '{"tool_calls":[{"name":"emit_status","arguments":{"label":"wrong-type","count":"4"}}]}',
  '{"tool_calls":[{"name":"emit_status","arguments":{"label":"extra","count":5,"unexpected":true}}]}',
  '{"tool_calls":[{"name":"emit_status","arguments":{"label":"bad-enum","count":6,"mode":"archive"}}]}',
];

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: root,
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(mockResponses),
    RELAY_WORKBENCH_DIST: join(root, "apps/sidecar/wwwroot"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
sidecar.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  if (stdout.length > 12000) stdout = stdout.slice(-12000);
});
sidecar.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
  if (stderr.length > 12000) stderr = stderr.slice(-12000);
});

try {
  await waitReady();
  const cases = [
    ["extra_text_valid_json", 200, null],
    ["unknown_tool", 502, "unknown tool 'evil_tool'"],
    ["missing_required", 502, "missing required property 'count'"],
    ["wrong_type_integer", 502, "$.count for 'emit_status' must be integer"],
    ["additional_property_false", 502, "unexpected property 'unexpected'"],
    ["enum_mismatch", 502, "$.mode for 'emit_status' must match one of the allowed enum values"],
  ];
  const results = [];
  for (const [name, expectedStatus, expectedMessagePart] of cases) {
    const response = await callResponses();
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Captured below.
    }
    const message = json?.error?.message ?? null;
    const pass =
      response.status === expectedStatus &&
      (expectedMessagePart === null || String(message).includes(expectedMessagePart));
    results.push({
      name,
      expectedStatus,
      actualStatus: response.status,
      pass,
      message,
    });
  }

  const failed = results.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`responses schema validation smoke failed: ${JSON.stringify(results, null, 2)}`);
  }
  console.log(`[responses-schema-validation-smoke] ok ${results.length} cases`);
} finally {
  sidecar.kill("SIGTERM");
}

async function waitReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel to bind.
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stdout=${stdout}; stderr=${stderr}`);
}

async function callResponses() {
  return fetch(`http://127.0.0.1:${port}/v1/responses?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      model: "m365-copilot",
      input: "Call emit_status.",
      tools: [{
        type: "function",
        name: "emit_status",
        description: "status tool",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            count: { type: "integer" },
            mode: { type: "string", enum: ["active", "passive"] },
          },
          required: ["label", "count"],
        },
      }],
      tool_choice: { type: "function", name: "emit_status" },
      parallel_tool_calls: false,
    }),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
