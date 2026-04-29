import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import process from "node:process";

import {
  fetchFrontendReady,
  findAvailableDisplay,
  startProcess,
  stopProcess
} from "./tauri_smoke_shared.mjs";

const launchTimeoutMs = 120_000;
const stabilityWindowMs = 5_000;
const isWindows = os.platform() === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

async function main() {
  const display = isWindows ? null : findAvailableDisplay();
  const summary = {
    scenario: "tauri-dev-launch",
    status: "failed",
    display,
    frontendReady: false,
    desktopBinaryLaunchDetected: false,
    stabilityWindowMs,
    reason: "",
    launchCommand: "pnpm diag:tauri-dev"
  };

  const xvfb = isWindows
    ? null
    : startProcess("Xvfb", [display, "-screen", "0", "1280x840x24", "-ac"], {
        cwd: process.cwd()
      });

  try {
    if (!isWindows && xvfb) {
      await delay(1_500);

      if (xvfb.child.exitCode !== null) {
        summary.reason = `Xvfb exited early: ${xvfb.readLogs().trim() || "unknown error"}`;
        console.log(JSON.stringify(summary));
        process.exit(1);
      }
    }

    const tauriEnv = { ...process.env };
    if (!isWindows && display) {
      tauriEnv.DISPLAY = display;
    }

    const tauri = startProcess(pnpmCommand, ["diag:tauri-dev"], {
      env: tauriEnv
    });

    const deadline = Date.now() + launchTimeoutMs;

    try {
      while (Date.now() < deadline) {
        if (tauri.child.exitCode !== null) {
          summary.reason = `diag:tauri-dev exited early: ${tauri.readLogs().trim() || "unknown error"}`;
          console.log(JSON.stringify(summary));
          process.exit(1);
        }

        const logs = tauri.readLogs();
        if (!summary.desktopBinaryLaunchDetected) {
          summary.desktopBinaryLaunchDetected =
            /Running .*relay-agent-desktop/.test(logs) ||
            logs.includes("Running `/workspace/relay-agent-main/target/debug/relay-agent-desktop`");
        }

        if (!summary.frontendReady) {
          summary.frontendReady = await fetchFrontendReady();
        }

        if (summary.frontendReady && summary.desktopBinaryLaunchDetected) {
          break;
        }

        await delay(1_000);
      }

      if (!summary.frontendReady) {
        summary.reason = "Frontend dev server never became ready on http://127.0.0.1:1421.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!summary.desktopBinaryLaunchDetected) {
        summary.reason = "Desktop binary launch was not detected in diag:tauri-dev logs.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      await delay(stabilityWindowMs);
      if (tauri.child.exitCode !== null) {
        summary.reason = "Desktop process exited during the stability window.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      summary.status = "ok";
      summary.reason = "";
      console.log(JSON.stringify(summary));
    } finally {
      await stopProcess(tauri.child);
    }
  } finally {
    if (xvfb) {
      await stopProcess(xvfb.child);
    }
  }
}

await main();
