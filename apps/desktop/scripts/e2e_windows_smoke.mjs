import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  desktopDir,
  fetchFrontendReady,
  startProcess,
  stopProcess
} from "./tauri_smoke_shared.mjs";

const isWindows = os.platform() === "win32";
const useBuild = process.env.RELAY_USE_BUILD === "1";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const launchTimeoutMs = 10_000;
const stabilityWindowMs = 5_000;

function resolveReleaseBinary() {
  const candidates = [
    path.resolve(desktopDir, "../../target/release/relay-agent-desktop.exe"),
    path.resolve(desktopDir, "../../target/release/relay-agent.exe")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function main() {
  const summary = {
    scenario: "windows-smoke",
    status: "failed",
    platform: process.platform,
    frontendReady: false,
    launchMode: useBuild ? "release-binary" : "diag-tauri-dev",
    reason: ""
  };

  if (!isWindows) {
    summary.status = "passed";
    summary.reason = "Skipped on non-Windows platform.";
    console.log(JSON.stringify(summary));
    process.exit(0);
  }

  let launched = null;

  try {
    if (useBuild) {
      const binaryPath = resolveReleaseBinary();
      if (!binaryPath) {
        throw new Error(
          "RELAY_USE_BUILD=1 was set but no release desktop binary was found under target/release."
        );
      }

      launched = startProcess(binaryPath, []);
    } else {
      launched = startProcess(pnpmCommand, ["diag:tauri-dev"]);
    }

    const deadline = Date.now() + launchTimeoutMs;
    while (Date.now() < deadline) {
      if (launched.child.exitCode !== null) {
        throw new Error(launched.readLogs().trim() || "desktop process exited during startup");
      }

      if (useBuild) {
        summary.frontendReady = true;
        break;
      }

      summary.frontendReady = await fetchFrontendReady();
      if (summary.frontendReady) {
        break;
      }

      await delay(500);
    }

    if (!summary.frontendReady) {
      throw new Error("Frontend readiness check did not succeed within 10 seconds.");
    }

    await delay(stabilityWindowMs);
    if (launched.child.exitCode !== null) {
      throw new Error("Desktop process exited during the 5 second stability window.");
    }

    summary.status = "passed";
  } catch (error) {
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    if (launched) {
      await stopProcess(launched.child);
    }
  }

  console.log(JSON.stringify(summary));
  process.exit(summary.status === "passed" ? 0 : 1);
}

await main();
