#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-glob-read-path-token";
const port = 17907;
const dataDir = mkdtempSync(join(tmpdir(), "relay-glob-read-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-glob-read-workspace-"));
const targetDir = join(workspace, "shared", "docs");
const targetFile = "車名と技術名称の表記の仕方について.txt";
const targetDisplayPath = `shared/docs/${targetFile}`;

await mkdir(targetDir, { recursive: true });
await writeFile(join(targetDir, targetFile), "車名表記と技術名称の表記ルールを確認する資料です。\n", "utf8");

const responses = [
  JSON.stringify({ action: "tool", tool: "glob", args: { path: "shared", pattern: "**/*車名*", limit: 5 } }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: targetDisplayPath, limit: 8000 } }),
  JSON.stringify({ action: "final", answer: "車名表記の資料を確認しました。" }),
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
  const run = await postAgUi({
    port,
    token,
    workspace,
    runId: "glob-read-path",
    instruction: "車名表記についてのファイルを探して",
  });
  const globCall = collectToolCall(run.events, "glob");
  const readCall = collectToolCall(run.events, "read");
  const globObservation = JSON.parse(globCall.results.at(-1) ?? "{}");
  const readOutput = readCall.results.join("\n");
  if (!Array.isArray(globObservation.data) || !globObservation.data.includes(targetDisplayPath)) {
    throw new Error(`glob did not surface workspace display path: ${JSON.stringify(globObservation)}`);
  }
  if (readOutput.includes("does not exist") || !readOutput.includes("RelayReadObservation.v1")) {
    throw new Error(`read did not consume glob display path cleanly: ${readOutput}`);
  }
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  console.log("[glob-read-path-smoke] ok");
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}
