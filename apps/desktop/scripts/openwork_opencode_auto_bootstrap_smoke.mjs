#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const tempRoot = mkdtempSync(join(tmpdir(), "relay-auto-bootstrap-"));
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

try {
  const providerPort = await freePort();
  const cacheRoot = join(tempRoot, "cache");
  const workspace = join(tempRoot, "workspace");
  const tokenFile = join(tempRoot, "provider-token");
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
      "--auto",
      "--workspace",
      workspace,
      "--cache-root",
      cacheRoot,
      "--provider-port",
      String(providerPort),
      "--provider-token-file",
      tokenFile,
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
    throw new Error(`auto bootstrap command exited with ${result.status}`);
  }

  const report = JSON.parse(result.stdout);
  providerPid = report.providerGateway?.processId || null;

  if (!report.ok) {
    throw new Error(`auto bootstrap report was not ok: ${JSON.stringify(report)}`);
  }
  if (report.providerGateway?.status !== "started") {
    throw new Error(`auto bootstrap did not start provider gateway: ${JSON.stringify(report.providerGateway)}`);
  }
  if (report.providerGateway?.baseUrl !== `http://127.0.0.1:${providerPort}/v1`) {
    throw new Error("auto bootstrap provider gateway did not use requested port");
  }
  if (report.providerConfig?.workspace !== workspace) {
    throw new Error(`auto bootstrap did not default to the requested workspace: ${JSON.stringify(report.providerConfig)}`);
  }
  if (process.platform !== "win32" && report.mode !== "preflight") {
    throw new Error(`non-Windows auto bootstrap must stay non-downloading; mode=${report.mode}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      status: "auto_bootstrap_ok",
      providerPort,
      workspace,
      mode: report.mode,
      providerGatewayStatus: report.providerGateway.status,
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
