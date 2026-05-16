#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-officecli-registry-token";
const port = 17897;
const dataDir = mkdtempSync(join(tmpdir(), "relay-officecli-registry-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-officecli-registry-workspace-"));

writeFileSync(join(workspace, "Book2.xlsx"), "placeholder workbook");

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "officecli",
    args: {
      filePath: "Book2.xlsx",
      operation: "set_cell_fill",
      sheet: "Sheet1",
      cell: "A1",
      color: "FF0000",
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
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForStatus();

  const semanticStart = await postRun("Sheet1 A1 を赤くして");
  const semanticRun = await waitForRun(semanticStart.runId, ["approval_required", "failed", "cancelled"]);
  if (semanticRun.status !== "approval_required") {
    throw new Error(`semantic OfficeCLI operation did not pause for approval: ${JSON.stringify(semanticRun)}`);
  }
  if ("pendingApproval" in semanticRun) {
    throw new Error(`RunResponse should not expose PendingApproval: ${JSON.stringify(semanticRun)}`);
  }
  const approval = await latestApprovalFromAgUi(semanticRun.runId);
  if (approval?.toolCall?.tool !== "officecli") {
    throw new Error(`semantic OfficeCLI AG-UI approval missing tool call: ${JSON.stringify(approval)}`);
  }
  if (approval.toolCall.args.argv) {
    throw new Error(`semantic OfficeCLI approval leaked raw argv: ${JSON.stringify(approval)}`);
  }
  if (existsSync(join(dataDir, "backups"))) {
    throw new Error("OfficeCLI mutation created a backup before approval");
  }

  const rawStart = await postRun("raw argv は拒否する");
  const rawRun = await waitForRun(rawStart.runId, ["failed", "approval_required", "completed", "cancelled"]);
  if (rawRun.status !== "failed") {
    throw new Error(`raw OfficeCLI argv was not rejected: ${JSON.stringify(rawRun)}`);
  }
  if (!rawRun.events.some((event) =>
    event.type === "error" &&
    String(event.detail ?? "").includes("raw argv is not allowed"))) {
    throw new Error(`raw OfficeCLI argv failure did not explain the policy: ${JSON.stringify(rawRun.events)}`);
  }

  console.log("[officecli-registry-smoke] ok");
} finally {
  child.kill("SIGTERM");
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

async function postRun(instruction) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ instruction, workspace }),
  });
  if (!response.ok) throw new Error(`run failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForRun(runId, expectedStatuses) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, {
      headers: { "X-Relay-Token": token },
    });
    if (!response.ok) throw new Error(`run lookup failed: ${response.status}`);
    const run = await response.json();
    if (expectedStatuses.includes(run.status)) return run;
    await sleep(100);
  }
  throw new Error(`run did not finish: ${runId}`);
}

async function latestApprovalFromAgUi(runId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}/agui-events?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) throw new Error(`AG-UI stream failed: ${response.status}`);
  const text = await response.text();
  let approval = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "USER_CONFIRMATION_REQUEST") approval = event.state?.approval ?? null;
    if (event.type === "USER_CONFIRMATION_RESULT" || event.type === "RUN_FINISHED" || event.type === "RUN_CANCELLED" || event.type === "RUN_ERROR") {
      approval = null;
    }
  }
  return approval;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
