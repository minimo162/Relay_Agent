import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  fetchFrontendReady,
  findAvailableDisplay,
  startProcess,
  stopProcess,
  waitForJsonFile
} from "./tauri_smoke_shared.mjs";

const launchTimeoutMs = 120_000;
const smokeTimeoutMs = 120_000;
const isWindows = os.platform() === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function safeRemoveFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Ignore cleanup races.
  }
}

function safeRemoveDir(dirPath) {
  if (!dirPath) {
    return;
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup races.
  }
}

async function main() {
  const display = isWindows ? null : findAvailableDisplay();
  const appDataDir = makeTempDir("relay-agent-agent-loop-app-data");
  const summaryDir = makeTempDir("relay-agent-agent-loop-summary");
  const summaryPath = path.join(summaryDir, "agent-loop-summary.json");
  const summary = {
    scenario: "tauri-dev-agent-loop",
    status: "failed",
    display,
    frontendReady: false,
    desktopBinaryLaunchDetected: false,
    smokeSummaryReceived: false,
    launchCommand: "pnpm tauri:dev",
    smokeCommand: "pnpm agent-loop:test",
    appDataDir,
    summaryPath,
    smoke: null,
    reason: ""
  };

  const xvfb = isWindows
    ? null
    : startProcess("Xvfb", [display, "-screen", "0", "1280x840x24", "-ac"], {
        cwd: process.cwd()
      });

  let smokeOutputPath = null;

  try {
    if (!isWindows && xvfb) {
      await delay(1_500);

      if (xvfb.child.exitCode !== null) {
        summary.reason = `Xvfb exited early: ${xvfb.readLogs().trim() || "unknown error"}`;
        console.log(JSON.stringify(summary));
        process.exit(1);
      }
    }

    const tauriEnv = {
      ...process.env,
      RELAY_AGENT_AUTORUN_AGENT_LOOP_SMOKE: "1",
      RELAY_AGENT_AGENT_LOOP_SMOKE_SUMMARY_PATH: summaryPath,
      RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR: appDataDir
    };
    if (!isWindows && display) {
      tauriEnv.DISPLAY = display;
    }

    const tauri = startProcess(pnpmCommand, ["tauri:dev"], {
      env: tauriEnv
    });

    try {
      const launchDeadline = Date.now() + launchTimeoutMs;

      while (Date.now() < launchDeadline) {
        if (tauri.child.exitCode !== null) {
          summary.reason = `tauri:dev exited early: ${tauri.readLogs().trim() || "unknown error"}`;
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
        summary.reason = "Desktop binary launch was not detected in tauri:dev logs.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      const smokeDeadline = Date.now() + smokeTimeoutMs;
      const smokeSummary = await waitForJsonFile(summaryPath, smokeDeadline);

      if (!smokeSummary) {
        summary.reason = "Agent loop smoke summary file was never produced before timeout.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      summary.smokeSummaryReceived = true;
      summary.smoke = smokeSummary;
      smokeOutputPath = smokeSummary.outputPath ?? null;

      const expectedStepIds = [
        "initialize-app",
        "locate-sample",
        "start-agent",
        "wait-approval",
        "respond-approval",
        "wait-complete",
        "verify-events",
        "verify-output",
        "verify-source"
      ];
      const okSteps = new Set(
        Array.isArray(smokeSummary.steps)
          ? smokeSummary.steps.filter((step) => step.status === "ok").map((step) => step.id)
          : []
      );

      if (smokeSummary.status !== "ok") {
        summary.reason = `Agent loop smoke failed: ${smokeSummary.failureReason || "unknown failure"}`;
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!expectedStepIds.every((stepId) => okSteps.has(stepId))) {
        summary.reason = "Agent loop smoke summary was missing one or more required successful steps.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!smokeSummary.approvalSeen || !smokeSummary.completionSeen) {
        summary.reason = "Agent loop smoke did not observe approval and completion events.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!smokeSummary.outputExists || !smokeSummary.outputFilteredOnly) {
        summary.reason = "Agent loop smoke did not produce the expected filtered save-copy output.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!smokeSummary.sourceUnchanged) {
        summary.reason = "Agent loop smoke reported that the bundled sample source changed.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!smokeOutputPath || !fs.existsSync(smokeOutputPath)) {
        summary.reason = "Agent loop smoke summary reported success but the output file is missing.";
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
    safeRemoveFile(smokeOutputPath);
    safeRemoveFile(summaryPath);
    safeRemoveDir(summaryDir);
    safeRemoveDir(appDataDir);
  }
}

await main();
