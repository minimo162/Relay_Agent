#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const cacheRoot = mkdtempSync(join(tmpdir(), "relay-headless-openwork-opencode-bootstrap-"));

try {
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
    throw new Error(`headless bootstrap command exited with ${result.status}`);
  }

  const report = JSON.parse(result.stdout);
  if (!report.ok || report.mode !== "preflight" || report.status !== "ready_for_download") {
    throw new Error(`unexpected bootstrap report status: ${JSON.stringify(report)}`);
  }
  if (report.providerHandoff?.model !== "relay-agent/m365-copilot") {
    throw new Error("missing provider handoff model");
  }
  if (!report.relayBoundary?.includes("provider gateway only")) {
    throw new Error("missing provider-only Relay boundary");
  }
  if (report.openworkInstallerHandoff?.requested !== false) {
    throw new Error("headless bootstrap smoke must not request OpenWork installer handoff");
  }
  if (!report.openworkInstallerHandoff?.skippedReason?.includes("operator_approval_required")) {
    throw new Error("OpenWork installer handoff must require explicit operator approval");
  }

  const artifacts = new Map(report.artifacts.map((artifact) => [artifact.artifact, artifact]));
  for (const key of ["opencode-cli", "openwork-desktop"]) {
    const artifact = artifacts.get(key);
    if (!artifact) throw new Error(`missing artifact report: ${key}`);
    if (artifact.status !== "missing") {
      throw new Error(`headless bootstrap smoke must not download artifacts; ${key}=${artifact.status}`);
    }
    if (!artifact.expectedPath?.startsWith(cacheRoot)) {
      throw new Error(`artifact path is outside smoke cache: ${artifact.expectedPath}`);
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      status: "headless_bootstrap_preflight_ok",
      cacheRoot,
      artifacts: [...artifacts.keys()],
    }),
  );
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}
