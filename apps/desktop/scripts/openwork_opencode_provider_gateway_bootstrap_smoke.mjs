#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const tempRoot = mkdtempSync(join(tmpdir(), "relay-bootstrap-provider-gateway-"));
let providerPid = null;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return await response.json();
}

try {
  const providerPort = await freePort();
  const tokenFile = join(tempRoot, "provider-token");
  const cacheRoot = join(tempRoot, "cache");
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      resolve(appRoot, "src-tauri/Cargo.toml"),
      "--bin",
      "relay-openwork-bootstrap",
      "--",
      "--cache-root",
      cacheRoot,
      "--provider-port",
      String(providerPort),
      "--provider-token-file",
      tokenFile,
      "--start-provider-gateway",
      "--json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    throw new Error(`bootstrap provider gateway command exited with ${result.status}`);
  }

  const report = JSON.parse(result.stdout);
  providerPid = report.providerGateway?.processId || null;
  if (report.providerGateway?.status !== "started") {
    throw new Error(`provider gateway was not started: ${JSON.stringify(report.providerGateway)}`);
  }
  if (report.providerGateway?.baseUrl !== `http://127.0.0.1:${providerPort}/v1`) {
    throw new Error("provider gateway base URL did not use requested port");
  }

  const health = await fetchJson(`http://127.0.0.1:${providerPort}/health`);
  if (health.status !== "ok") {
    throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
  }

  const token = readFileSync(tokenFile, "utf8").trim();
  const models = await fetchJson(`http://127.0.0.1:${providerPort}/v1/models`, token);
  if (!models.data?.some((model) => model.id === "m365-copilot")) {
    throw new Error(`missing relay model: ${JSON.stringify(models)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      status: "provider_gateway_bootstrap_ok",
      providerPort,
      providerModel: "relay-agent/m365-copilot",
      openAiModel: "m365-copilot",
    }),
  );
} finally {
  if (providerPid) {
    try {
      process.kill(providerPid, "SIGTERM");
    } catch {
      /* process may already be gone */
    }
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
