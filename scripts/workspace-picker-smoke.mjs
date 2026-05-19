#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-workspace-picker-smoke-token";
const port = 17897;
const dataDir = mkdtempSync(join(tmpdir(), "relay-workspace-picker-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-workspace-picker-target-"));
const workspacePickerSource = readFileSync(join(process.cwd(), "apps/sidecar/WorkspacePicker.cs"), "utf8");
for (const needle of [
  "IFileOpenDialog",
  "FosPickFolders",
  "FosForceFileSystem",
  "SHCreateItemFromParsingName",
  "FolderBrowserDialog",
]) {
  if (!workspacePickerSource.includes(needle)) {
    throw new Error(`workspace picker source is missing ${needle}`);
  }
}
for (const forbidden of ["RELAY_PDF_PICKER_MOCK_PATH", "/api/pdf/pick", "PdfPickResponse"]) {
  if (workspacePickerSource.includes(forbidden)) {
    throw new Error(`workspace picker source still contains retired PDF picker code: ${forbidden}`);
  }
}

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "workspace picker smoke" }),
    RELAY_WORKSPACE_PICKER_MOCK_PATH: workspace,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForStatus();
  const selected = await postPick();
  if (selected.cancelled !== false || selected.path !== workspace || selected.exists !== true) {
    throw new Error(`unexpected picker response: ${JSON.stringify(selected)}`);
  }

  process.env.RELAY_WORKSPACE_PICKER_MOCK_PATH = "__CANCEL__";
  console.log("[workspace-picker-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

async function waitForStatus() {
  const url = `http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

async function postPick() {
  const response = await fetch(`http://127.0.0.1:${port}/api/workspace/pick?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ currentPath: "" }),
  });
  if (!response.ok) throw new Error(`workspace picker endpoint failed: ${response.status}`);
  return response.json();
}
