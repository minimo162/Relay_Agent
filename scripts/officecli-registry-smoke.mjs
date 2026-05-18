#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, postAgUi, readApprovalRequest } from "./lib/agui-smoke.mjs";

const token = "relay-officecli-registry-token";
const port = 17897;
const dataDir = mkdtempSync(join(tmpdir(), "relay-officecli-registry-data-"));
const promptDumpDir = mkdtempSync(join(tmpdir(), "relay-officecli-registry-prompts-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-officecli-registry-workspace-"));

writeFileSync(join(workspace, "Book2.xlsx"), "placeholder workbook");

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "officecli",
    args: {
      filePath: "Book2.xlsx",
      operation: "format",
      worksheet: "Sheet1",
      cellAddress: "A1",
      properties: { fill: { color: "red" } },
    },
  }),
  JSON.stringify({
    action: "tool",
    tool: "officecli",
    args: {
      filePath: "Book2.xlsx",
      argv: ["set", "Book2.xlsx", "/Sheet1/A1", "--prop", "fill=FF0000"],
    },
  }),
];

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(responses),
    RELAY_COPILOT_PROMPT_DUMP_DIR: promptDumpDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForStatus();

  const semanticRun = await postAgUi({
    port,
    token,
    workspace,
    runId: "officecli-semantic",
    instruction: "Sheet1 A1 を赤くして",
  });
  const approvalCall = collectToolCall(semanticRun.events, "request_approval");
  const approval = readApprovalRequest(approvalCall).request;
  if (approval.functionName !== "officecli_mutate") {
    throw new Error(`semantic OfficeCLI operation did not pause for approval: ${JSON.stringify(approval)}`);
  }
  const args = typeof approval.functionArguments === "string"
    ? JSON.parse(approval.functionArguments || "{}")
    : (approval.functionArguments ?? {});
  if (args.argv) {
    throw new Error(`semantic OfficeCLI approval leaked raw argv: ${JSON.stringify(args)}`);
  }
  if (args.operation !== "format" || args.worksheet !== "Sheet1" || args.cellAddress !== "A1") {
    throw new Error(`semantic OfficeCLI aliases were not preserved for registry normalization: ${JSON.stringify(args)}`);
  }
  if (args.properties?.fill?.color !== "red") {
    throw new Error(`semantic OfficeCLI color object was not preserved for registry normalization: ${JSON.stringify(args)}`);
  }
  if (existsSync(join(dataDir, "backups"))) {
    throw new Error("OfficeCLI mutation created a backup before approval");
  }
  assertPromptProjection();

  const rawRun = await postAgUi({
    port,
    token,
    workspace,
    runId: "officecli-raw-argv",
    instruction: "raw argv は拒否する",
  });
  if (!rawRun.events.some((event) => event.type === "RUN_ERROR")) {
    throw new Error(`raw OfficeCLI argv was not rejected: ${JSON.stringify(rawRun.events)}`);
  }
  if (!JSON.stringify(rawRun.events).includes("raw argv is not allowed")) {
    throw new Error(`raw OfficeCLI argv failure did not explain the policy: ${JSON.stringify(rawRun.events)}`);
  }

  console.log("[officecli-registry-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

function assertPromptProjection() {
  const prompts = readdirSync(promptDumpDir)
    .filter((name) => name.includes("-prompt-"))
    .map((name) => readFileSync(join(promptDumpDir, name), "utf8"))
    .filter((text) => text.includes("RELAY_TOOL_JSON_ONLY"));
  if (prompts.length === 0) {
    throw new Error("expected Relay tool projection prompt dump");
  }
  const combined = prompts.join("\n---prompt---\n");
  for (const required of ["operation set or set_cell_fill", "fill as six hex digits", "Do not use operation format", "sheet", "cell"]) {
    if (!combined.includes(required)) {
      throw new Error(`OfficeCLI prompt projection is missing ${required}`);
    }
  }
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
