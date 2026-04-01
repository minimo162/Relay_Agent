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
const workflowTimeoutMs = 120_000;
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
  const appDataDir = makeTempDir("relay-agent-workflow-app-data");
  const summaryDir = makeTempDir("relay-agent-workflow-summary");
  const summaryPath = path.join(summaryDir, "workflow-summary.json");
  const summary = {
    scenario: "tauri-dev-workflow",
    status: "failed",
    display,
    frontendReady: false,
    desktopBinaryLaunchDetected: false,
    workflowSummaryReceived: false,
    launchCommand: "pnpm tauri:dev",
    workflowCommand: "pnpm workflow:test",
    appDataDir,
    summaryPath,
    workflow: null,
    reason: ""
  };

  const xvfb = isWindows
    ? null
    : startProcess("Xvfb", [display, "-screen", "0", "1280x840x24", "-ac"], {
        cwd: process.cwd()
      });

  let workflowOutputPath = null;

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
      RELAY_AGENT_AUTORUN_WORKFLOW_SMOKE: "1",
      RELAY_AGENT_WORKFLOW_SMOKE_SUMMARY_PATH: summaryPath,
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

      const workflowDeadline = Date.now() + workflowTimeoutMs;
      const workflowSummary = await waitForJsonFile(summaryPath, workflowDeadline);

      if (!workflowSummary) {
        summary.reason = "Workflow smoke summary file was never produced before timeout.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      summary.workflowSummaryReceived = true;
      summary.workflow = workflowSummary;
      workflowOutputPath = workflowSummary.outputPath ?? null;

      const expectedStepIds = [
        "initialize-app",
        "locate-sample",
        "create-session",
        "start-turn",
        "generate-packet",
        "validate-response",
        "preview",
        "approval",
        "execution",
        "verify-output",
        "verify-source"
      ];
      const okSteps = new Set(
        Array.isArray(workflowSummary.steps)
          ? workflowSummary.steps.filter((step) => step.status === "ok").map((step) => step.id)
          : []
      );

      if (workflowSummary.status !== "ok") {
        summary.reason = `Workflow smoke failed: ${workflowSummary.failureReason || "unknown failure"}`;
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!expectedStepIds.every((stepId) => okSteps.has(stepId))) {
        summary.reason = "Workflow smoke summary was missing one or more required successful steps.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!workflowSummary.outputExists || !workflowSummary.outputMatchesExpected) {
        summary.reason = "Workflow smoke did not produce the expected reviewed copy output.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!workflowSummary.sourceUnchanged) {
        summary.reason = "Workflow smoke reported that the bundled sample source changed.";
        console.log(JSON.stringify(summary));
        process.exit(1);
      }

      if (!workflowOutputPath || !fs.existsSync(workflowOutputPath)) {
        summary.reason = "Workflow smoke summary reported success but the reviewed copy is missing.";
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
    safeRemoveFile(workflowOutputPath);
    safeRemoveFile(summaryPath);
    safeRemoveDir(summaryDir);
    safeRemoveDir(appDataDir);
  }
}

await main();
