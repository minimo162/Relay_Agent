#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-golden-token";
const port = 17892;
const dataDir = mkdtempSync(join(tmpdir(), "relay-agent-golden-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-agent-golden-workspace-"));
const responses = [
  `${JSON.stringify({ action: "tool", tool: "rg_files", args: { contains: "seed", limit: 5 } })}\n\nSure.`,
  `${JSON.stringify({ action: "final", answer: "検索は rg_files を使いました。" })}\n\nDone.`,
  JSON.stringify({ action: "tool", tool: "write", args: { path: "approval.txt", content: "approved write" } }),
  JSON.stringify({ action: "final", answer: "承認済みの書き込みを実行しました。" }),
  JSON.stringify({ action: "tool", tool: "workspace_status", args: { limit: 100 } }),
  JSON.stringify({ action: "tool", tool: "diff", args: {} }),
  JSON.stringify({ action: "tool", tool: "run_command", args: { argv: ["node", "--version"], timeoutMs: 30000 } }),
  JSON.stringify({ action: "final", answer: "状態確認と検証を完了しました。" }),
];

await import("node:fs/promises").then(({ writeFile }) => writeFile(join(workspace, "seed.txt"), "部品売上 seed"));

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

async function postRun(instruction) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ instruction, workspace }),
  });
  if (!response.ok) throw new Error(`run failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForRun(runId, expectedStatuses = ["completed", "failed", "approval_required", "cancelled"]) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, {
      headers: { "X-Relay-Token": token },
    });
    if (!response.ok) throw new Error(`run lookup failed: ${response.status}`);
    const runJson = await response.json();
    if (expectedStatuses.includes(runJson.status)) return runJson;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`run did not reach ${expectedStatuses.join(",")}: ${runId}`);
}

async function readAgUiEvents(runId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}/agui-events?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) throw new Error(`AG-UI stream failed: ${response.status}`);
  const text = await response.text();
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    events.push(JSON.parse(line.slice(6)));
  }
  return { text, events };
}

function latestApprovalFromAgUi(events) {
  let approval = null;
  for (const event of events) {
    if (event.type === "USER_CONFIRMATION_REQUEST") approval = event.state?.approval ?? null;
    if (event.type === "USER_CONFIRMATION_RESULT" || event.type === "RUN_FINISHED" || event.type === "RUN_CANCELLED" || event.type === "RUN_ERROR") {
      approval = null;
    }
  }
  return approval;
}

try {
  await waitForStatus();

  const searchStart = await postRun("seed を探して");
  const searchRun = await waitForRun(searchStart.runId, ["completed", "failed", "cancelled"]);
  if (searchRun.status !== "completed") throw new Error(`search run did not complete: ${JSON.stringify(searchRun)}`);
  if (!searchRun.events.some((event) => event.type === "status" && event.message === "Microsoft Agent Framework セッションを開始しました")) {
    throw new Error(`search run did not start through Microsoft Agent Framework: ${JSON.stringify(searchRun)}`);
  }
  if (!searchRun.events.some((event) => event.type === "tool_call_started" && event.message === "rg_files")) {
    throw new Error(`search run did not execute rg_files: ${JSON.stringify(searchRun)}`);
  }
  if (!searchRun.events.some((event) => event.type === "completed" && event.detail === "検索は rg_files を使いました。")) {
    throw new Error(`search run final answer mismatch: ${JSON.stringify(searchRun)}`);
  }
  const { text: aguiText } = await readAgUiEvents(searchRun.runId);
  if (!aguiText.includes("event: ag-ui-event") || !aguiText.includes("RUN_FINISHED")) {
    throw new Error(`AG-UI stream did not expose mapped events: ${aguiText}`);
  }

  const writeStart = await postRun("approval.txt を作って");
  const writeRun = await waitForRun(writeStart.runId, ["approval_required", "completed", "failed", "cancelled"]);
  if (writeRun.status !== "approval_required") {
    throw new Error(`write run did not pause for approval: ${JSON.stringify(writeRun)}`);
  }
  if ("pendingApproval" in writeRun) {
    throw new Error(`RunResponse should not expose PendingApproval: ${JSON.stringify(writeRun)}`);
  }
  const writeAgUi = await readAgUiEvents(writeRun.runId);
  const writeApproval = latestApprovalFromAgUi(writeAgUi.events);
  if (writeApproval?.toolCall?.tool !== "write") {
    throw new Error(`AG-UI approval state did not expose write tool call: ${JSON.stringify(writeAgUi.events)}`);
  }
  if (existsSync(join(workspace, "approval.txt"))) {
    throw new Error("write tool executed before approval");
  }

  const approval = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(writeRun.runId)}/approve?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
  });
  if (!approval.ok) throw new Error(`approval failed: ${approval.status} ${await approval.text()}`);
  const approvalStart = await approval.json();
  const approvedRun = await waitForRun(approvalStart.runId, ["completed", "failed", "cancelled"]);
  if (approvedRun.status !== "completed") throw new Error(`approved run did not complete: ${JSON.stringify(approvedRun)}`);
  if (readFileSync(join(workspace, "approval.txt"), "utf8") !== "approved write") {
    throw new Error("approved write output mismatch");
  }
  if (!approvedRun.events.some((event) => event.type === "status" && event.detail?.includes("ToolApprovalResponseContent"))) {
    throw new Error(`approved run did not resume with Agent Framework approval response: ${JSON.stringify(approvedRun)}`);
  }

  const verificationStart = await postRun("ワークスペース状態と差分を確認し、node のバージョンで検証して");
  const verificationRun = await waitForRun(verificationStart.runId, ["approval_required", "completed", "failed", "cancelled"]);
  if (verificationRun.status !== "approval_required") {
    throw new Error(`verification run did not pause before run_command: ${JSON.stringify(verificationRun)}`);
  }
  const verificationAgUi = await readAgUiEvents(verificationRun.runId);
  const verificationApproval = latestApprovalFromAgUi(verificationAgUi.events);
  if (verificationApproval?.toolCall?.tool !== "run_command") {
    throw new Error(`AG-UI approval state did not expose run_command: ${JSON.stringify(verificationAgUi.events)}`);
  }
  if (!verificationRun.events.some((event) => event.type === "tool_call_started" && event.message === "workspace_status")) {
    throw new Error(`verification run did not inspect workspace_status: ${JSON.stringify(verificationRun)}`);
  }
  if (!verificationRun.events.some((event) => event.type === "tool_call_started" && event.message === "diff")) {
    throw new Error(`verification run did not inspect diff: ${JSON.stringify(verificationRun)}`);
  }
  const verificationApprovalResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(verificationRun.runId)}/approve?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
  });
  if (!verificationApprovalResponse.ok) throw new Error(`verification approval failed: ${verificationApprovalResponse.status} ${await verificationApprovalResponse.text()}`);
  const verificationApprovalStart = await verificationApprovalResponse.json();
  const approvedVerificationRun = await waitForRun(verificationApprovalStart.runId, ["completed", "failed", "cancelled"]);
  if (approvedVerificationRun.status !== "completed") {
    throw new Error(`verification run did not complete: ${JSON.stringify(approvedVerificationRun)}`);
  }
  if (!approvedVerificationRun.events.some((event) => event.type === "completed" && event.detail === "状態確認と検証を完了しました。")) {
    throw new Error(`verification run final answer mismatch: ${JSON.stringify(approvedVerificationRun)}`);
  }

  console.log("[agent-golden-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
