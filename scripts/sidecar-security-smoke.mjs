#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-security-token";
const port = 17893;
const dataDir = mkdtempSync(join(tmpdir(), "relay-sidecar-security-"));

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "ok" }),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function request(path, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers,
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const status = await request(`/api/status?token=${encodeURIComponent(token)}`, { "X-Relay-Token": token });
      if (status === 200) return;
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

try {
  await waitForStatus();

  const noToken = await request("/api/status");
  if (noToken !== 401) throw new Error(`expected 401 without token, got ${noToken}`);

  const badHost = await request(`/api/status?token=${encodeURIComponent(token)}`, {
    "X-Relay-Token": token,
    Host: "relay.invalid",
  });
  if (badHost !== 403) throw new Error(`expected 403 for bad host, got ${badHost}`);

  const badOrigin = await request(`/api/runs?token=${encodeURIComponent(token)}`, {
    "X-Relay-Token": token,
    "Content-Type": "application/json",
    Origin: "http://evil.invalid",
  }, "POST");
  if (badOrigin !== 403) throw new Error(`expected 403 for bad origin, got ${badOrigin}`);

  const directoryListing = await request(`/assets/?token=${encodeURIComponent(token)}`, { "X-Relay-Token": token });
  if (directoryListing === 200) throw new Error("static asset directory listing is reachable");

  console.log("[sidecar-security-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
