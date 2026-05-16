#!/usr/bin/env node
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const token = "relay-rg-stream-token";
const port = 17895;
const dataDir = mkdtempSync(join(tmpdir(), "relay-rg-stream-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-rg-stream-workspace-"));
const fakeRg = join(dataDir, "fake-rg.mjs");
const sentinel = join(dataDir, "fake-rg-read-too-far.txt");

writeFileSync(fakeRg, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("ripgrep 15.1.0");
  process.exit(0);
}
const sentinel = process.env.RELAY_FAKE_RG_SENTINEL;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
for (let index = 0; index < 200; index += 1) {
  console.log(\`file-\${String(index).padStart(3, "0")}.txt\`);
  if (index === 50 && sentinel) writeFileSync(sentinel, "stream was not capped");
  await sleep(20);
}
`, "utf8");
chmodSync(fakeRg, 0o755);
writeFileSync(join(workspace, "seed.txt"), "seed", "utf8");

const responses = [
  JSON.stringify({ action: "tool", tool: "rg_files", args: { contains: "file-", limit: 5, timeoutMs: 30000 } }),
  JSON.stringify({ action: "final", answer: "rg stream cap ok" }),
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
    RELAY_RIPGREP_PATH: fakeRg,
    RELAY_FAKE_RG_SENTINEL: sentinel,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, {
      headers: { "X-Relay-Token": token },
    });
    if (!response.ok) throw new Error(`run lookup failed: ${response.status}`);
    const run = await response.json();
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await sleep(100);
  }
  throw new Error(`run did not finish: ${runId}`);
}

try {
  await waitForStatus();

  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ instruction: "stream cap smoke", workspace }),
  });
  if (!response.ok) throw new Error(`run failed: ${response.status} ${await response.text()}`);
  const runStart = await response.json();
  const run = await waitForRun(runStart.runId);
  const elapsed = Date.now() - started;

  if (run.status !== "completed") throw new Error(`run did not complete: ${JSON.stringify(run)}`);
  if (elapsed > 2500) throw new Error(`rg stream cap took too long: ${elapsed}ms`);
  if (existsSync(sentinel)) throw new Error("fake rg reached line 50; output was not capped before buffering");
  if (!run.events.some((event) => event.type === "tool_call_completed" && String(event.detail ?? "").includes("truncated at limit"))) {
    throw new Error(`rg_files did not report truncation: ${JSON.stringify(run.events)}`);
  }

  console.log(`[rg-stream-cap-smoke] ok elapsed=${elapsed}ms`);
} finally {
  child.kill("SIGTERM");
}
