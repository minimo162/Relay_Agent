import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const desktopDir = path.resolve(import.meta.dirname, "..");
export const frontendUrl = "http://127.0.0.1:1420";

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    ...options
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    readLogs() {
      return stripAnsi(`${stdout}\n${stderr}`);
    }
  };
}

export function findAvailableDisplay() {
  for (let value = 99; value < 130; value += 1) {
    if (!fs.existsSync(`/tmp/.X${value}-lock`)) {
      return `:${value}`;
    }
  }

  throw new Error("No free Xvfb display was found between :99 and :129.");
}

function killProcessGroup(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // Ignore cleanup races.
  }
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  killProcessGroup(child, "SIGTERM");
  await delay(1_500);

  if (child.exitCode === null) {
    killProcessGroup(child, "SIGKILL");
    await delay(500);
  }
}

export async function fetchFrontendReady(url = frontendUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.text();
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForJsonFile(filePath, deadlineMs) {
  while (Date.now() < deadlineMs) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        // Keep polling while the writer finishes.
      }
    }

    await delay(500);
  }

  return null;
}
