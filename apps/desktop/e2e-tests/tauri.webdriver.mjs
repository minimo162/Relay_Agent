import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import { expect } from "chai";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const isWindows = os.platform() === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const tauriDriverPort = 4444;
const startupTimeoutMs = 240_000;

let driver;
let tauriDriver;
let tauriDriverExitExpected = false;

function resolveFromPath(command) {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const entry of pathEntries) {
    for (const ext of extensions) {
      const candidate = path.join(entry, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveTauriDriverPath() {
  return (
    resolveFromPath("tauri-driver") ??
    path.join(os.homedir(), ".cargo", "bin", isWindows ? "tauri-driver.exe" : "tauri-driver")
  );
}

function resolveNativeDriverPath() {
  const candidates = [
    process.env.MSEDGEDRIVER_PATH,
    path.join(repoRoot, "msedgedriver.exe"),
    resolveFromPath("msedgedriver"),
    path.join(os.homedir(), ".cargo", "bin", "msedgedriver.exe")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Microsoft Edge Driver was not found. Install it and set MSEDGEDRIVER_PATH if needed."
  );
}

function resolveApplicationPath() {
  const candidates = [
    path.join(desktopDir, "src-tauri", "target", "release", "relay-agent-desktop.exe"),
    path.join(repoRoot, "target", "release", "relay-agent-desktop.exe"),
    path.join(desktopDir, "src-tauri", "target", "debug", "relay-agent-desktop.exe"),
    path.join(repoRoot, "target", "debug", "relay-agent-desktop.exe")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate Relay Agent desktop binary. Checked: ${candidates.join(", ")}`
  );
}

function runBuild() {
  const result = spawnSync(pnpmCommand, ["exec", "tauri", "build", "--no-bundle"], {
    cwd: desktopDir,
    stdio: "inherit",
    shell: isWindows
  });

  if (result.status !== 0) {
    throw new Error(`pnpm exec tauri build --no-bundle failed with exit code ${result.status}`);
  }
}

async function startDriverSession() {
  const tauriDriverPath = resolveTauriDriverPath();
  const nativeDriverPath = resolveNativeDriverPath();

  const tauriDriverEnv = {
    ...process.env,
    PATH: `${path.dirname(nativeDriverPath)}${path.delimiter}${process.env.PATH ?? ""}`
  };

  tauriDriver = spawn(
    tauriDriverPath,
    ["--native-driver", nativeDriverPath, "--port", String(tauriDriverPort)],
    {
      env: tauriDriverEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );

  let logs = "";
  tauriDriver.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  tauriDriver.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });

  tauriDriver.on("exit", (code) => {
    if (!tauriDriverExitExpected) {
      console.error(logs);
      throw new Error(`tauri-driver exited unexpectedly with code ${code}`);
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

async function stopDriverSession() {
  tauriDriverExitExpected = true;

  try {
    await driver?.quit();
  } catch {
    // Ignore session cleanup races.
  }

  if (tauriDriver && tauriDriver.exitCode === null) {
    tauriDriver.kill();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function waitForVisible(locator, timeoutMs = startupTimeoutMs) {
  const element = await driver.wait(until.elementLocated(locator), timeoutMs);
  await driver.wait(until.elementIsVisible(element), timeoutMs);
  return element;
}

async function dismissWelcomeOverlayIfPresent() {
  const overlays = await driver.findElements(By.css(".welcome-overlay"));
  if (overlays.length === 0) {
    return;
  }

  const startButton = await waitForVisible(By.css(".welcome-btn"));
  await startButton.click();
  await driver.wait(
    async () => (await driver.findElements(By.css(".welcome-overlay"))).length === 0,
    15_000
  );
}

async function switchToManualMode() {
  const manualButton = await waitForVisible(
    By.xpath("//button[contains(@class,'mode-toggle-btn') and normalize-space()='Manual']")
  );
  await manualButton.click();
  await driver.wait(
    async () => {
      const classes = await manualButton.getAttribute("class");
      return classes.includes("mode-toggle-active");
    },
    15_000
  );
}

describe("Relay Agent Tauri WebDriver smoke", function () {
  this.timeout(startupTimeoutMs);

  before(async function () {
    runBuild();
    await startDriverSession();

    const application = resolveApplicationPath();
    const capabilities = new Capabilities();
    capabilities.setBrowserName("wry");
    capabilities.set("tauri:options", { application });

    driver = await new Builder()
      .withCapabilities(capabilities)
      .usingServer(`http://127.0.0.1:${tauriDriverPort}`)
      .build();
  });

  after(async function () {
    await stopDriverSession();
  });

  it("launches the desktop app and shows the main guided flow", async function () {
    const appTitle = await waitForVisible(
      By.xpath("//*[contains(@class,'header-title') and normalize-space()='Relay Agent']")
    );
    expect(await appTitle.getText()).to.equal("Relay Agent");

    await dismissWelcomeOverlayIfPresent();
    await switchToManualMode();

    const guidedFlow = await waitForVisible(By.css('section[aria-label="guided workflow"]'));
    const filePathInput = await waitForVisible(By.css("#goal-input-file-path"));
    const objectiveInput = await waitForVisible(By.css("#goal-input-objective"));
    const settingsButton = await waitForVisible(By.css('button[aria-label="設定を開く"]'));

    expect(await guidedFlow.getAttribute("class")).to.include("step-progress-bar");
    expect(await filePathInput.getAttribute("placeholder")).to.include("C:/Users");
    expect(await objectiveInput.getAttribute("rows")).to.equal("3");
    expect(await settingsButton.isDisplayed()).to.equal(true);
  });

  it("opens the settings modal from the desktop shell", async function () {
    await dismissWelcomeOverlayIfPresent();

    const settingsButton = await waitForVisible(By.css('button[aria-label="設定を開く"]'));
    await settingsButton.click();

    const approvalPolicy = await waitForVisible(By.css("#settings-approval-policy"));
    const timeoutInput = await waitForVisible(By.css("#settings-timeout"));
    const edgeToggle = await waitForVisible(
      By.css('button[role="switch"][aria-label="Edge 自動起動を切り替える"]')
    );

    expect(await approvalPolicy.getTagName()).to.equal("select");
    expect(await timeoutInput.getAttribute("type")).to.equal("number");
    expect(await edgeToggle.getAttribute("aria-checked")).to.match(/true|false/);
  });
});
