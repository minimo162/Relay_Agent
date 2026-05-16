#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalMessages,
  assistantText,
  collectToolCall,
  hasRunFinished,
  postAgUi,
  readApprovalRequest,
} from "./lib/agui-smoke.mjs";

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

await writeFile(join(workspace, "seed.txt"), "部品売上 seed");

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

try {
  await waitForStatus();

  const search = await postAgUi({
    port,
    token,
    workspace,
    runId: "golden-search",
    instruction: "seed を探して",
  });
  collectToolCall(search.events, "rg_files");
  if (!hasRunFinished(search.events)) throw new Error(`search run did not finish: ${JSON.stringify(search.events)}`);
  if (assistantText(search.events) !== "検索は rg_files を使いました。") {
    throw new Error(`search run final answer mismatch: ${assistantText(search.events)}`);
  }

  const writePrompt = "approval.txt を作って";
  const writeStart = await postAgUi({
    port,
    token,
    workspace,
    runId: "golden-write-start",
    instruction: writePrompt,
  });
  const writeApprovalCall = collectToolCall(writeStart.events, "request_approval");
  const writeApproval = readApprovalRequest(writeApprovalCall).request;
  if (writeApproval.functionName !== "write") {
    throw new Error(`write run did not pause for write approval: ${JSON.stringify(writeApproval)}`);
  }
  if (existsSync(join(workspace, "approval.txt"))) {
    throw new Error("write tool executed before approval");
  }
  const approvedWrite = await postAgUi({
    port,
    token,
    workspace,
    runId: "golden-write-approved",
    instruction: writePrompt,
    messages: approvalMessages("golden-write-approved", writePrompt, writeApprovalCall, true),
  });
  if (!hasRunFinished(approvedWrite.events)) {
    throw new Error(`approved write run did not finish: ${JSON.stringify(approvedWrite.events)}`);
  }
  if (readFileSync(join(workspace, "approval.txt"), "utf8") !== "approved write") {
    throw new Error("approved write output mismatch");
  }

  const verificationPrompt = "ワークスペース状態と差分を確認し、node のバージョンで検証して";
  const verificationStart = await postAgUi({
    port,
    token,
    workspace,
    runId: "golden-verification-start",
    instruction: verificationPrompt,
  });
  collectToolCall(verificationStart.events, "workspace_status");
  collectToolCall(verificationStart.events, "diff");
  const commandApprovalCall = collectToolCall(verificationStart.events, "request_approval");
  const commandApproval = readApprovalRequest(commandApprovalCall).request;
  if (commandApproval.functionName !== "run_command") {
    throw new Error(`verification run did not pause for run_command approval: ${JSON.stringify(commandApproval)}`);
  }
  const approvedVerification = await postAgUi({
    port,
    token,
    workspace,
    runId: "golden-verification-approved",
    instruction: verificationPrompt,
    messages: approvalMessages("golden-verification-approved", verificationPrompt, commandApprovalCall, true),
  });
  if (!hasRunFinished(approvedVerification.events)) {
    throw new Error(`verification run did not finish: ${JSON.stringify(approvedVerification.events)}`);
  }
  if (assistantText(approvedVerification.events) !== "状態確認と検証を完了しました。") {
    throw new Error(`verification final answer mismatch: ${assistantText(approvedVerification.events)}`);
  }

  console.log("[agent-golden-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
