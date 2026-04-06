#!/usr/bin/env node
/**
 * E2E: Tauri WebView2 with CDP enabled (RELAY_WEBVIEW2_CDP_PORT), assert app shell text.
 *
 * Uses Playwright `chromium.connectOverCDP` against the HTTP CDP endpoint. The agent-browser
 * CLI (`connect` / `snapshot` / `eval`) routinely hangs or times out against WebView2 in
 * practice; Playwright is the reliable automation path for this host.
 *
 * Prerequisite: app started with `pnpm run tauri:dev:cdp` (default CDP port 9222),
 * unless you pass `--with-app` to spawn it from this script.
 *
 * By default, after a successful run the script stops the spawned Tauri tree (CI-friendly).
 * Use `--keep-app` or RELAY_E2E_KEEP_APP=1 to leave the app running for manual inspection.
 *
 * Default assertion is read-only (innerText check) — the UI will not change. Use `--ui-demo`
 * or RELAY_E2E_UI_DEMO=1 to fill the composer, click Send, and start the Rust agent session
 * (same as a manual send; Copilot/M365 delivery depends on agent config and backend).
 *
 * Env:
 *   RELAY_WEBVIEW2_CDP_PORT   (default 9222)
 *   RELAY_WEBVIEW2_CDP_HTTP   (default http://127.0.0.1:<port>)
 *   RELAY_E2E_PW_ASSERT_MS    Playwright page wait / poll budget (default 60000)
 *   RELAY_E2E_TAURI_LOG       with-app: Tauri/vite/cargo log file (default: temp file)
 *   RELAY_E2E_TAURI_DETACHED  1 = detached spawn (may hide UI; default off)
 *   RELAY_E2E_KEEP_APP        1 = do not taskkill Tauri after success (same as --keep-app)
 *   RELAY_E2E_UI_DEMO         1 = type into composer after pass (same as --ui-demo)
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "..");

const CDP_PORT = process.env.RELAY_WEBVIEW2_CDP_PORT ?? "9222";
const CDP_HTTP = process.env.RELAY_WEBVIEW2_CDP_HTTP ?? `http://127.0.0.1:${CDP_PORT}`;
const DEV_URL_HINT = "1421";

const WITH_APP = process.argv.includes("--with-app");
const KEEP_APP =
  process.argv.includes("--keep-app") || process.env.RELAY_E2E_KEEP_APP === "1";
const UI_DEMO =
  process.argv.includes("--ui-demo") || process.env.RELAY_E2E_UI_DEMO === "1";
const TAURI_DETACHED = process.env.RELAY_E2E_TAURI_DETACHED === "1";

/** Must match `placeholder` on the main composer textarea in `src/root.tsx`. */
const COMPOSER_PLACEHOLDER =
  "What would you like to do? (type / for commands)";
const PW_ASSERT_MS = Number(process.env.RELAY_E2E_PW_ASSERT_MS) || 60_000;

function cdpWaitMs() {
  const raw = process.env.RELAY_E2E_CDP_WAIT_MS;
  if (raw === undefined || raw === "") return WITH_APP ? 900_000 : 45_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return WITH_APP ? 900_000 : 45_000;
  return n;
}

const CDP_WAIT_MS = cdpWaitMs();

function devPageUrlMatch(url) {
  const u = String(url ?? "");
  return (
    u.includes(":1421") ||
    u.includes("localhost:1421") ||
    u.includes("127.0.0.1:1421") ||
    u.includes("[::1]:1421")
  );
}

async function fetchWithTimeout(url, ms = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function waitForCdp(timeoutMs) {
  const start = Date.now();
  let lastLog = 0;
  const heartbeatMs = 8000;
  console.log(
    `[e2e-agent-browser] waiting for CDP at ${CDP_HTTP}/json/version (max ${Math.round(timeoutMs / 1000)}s)…`,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`${CDP_HTTP}/json/version`, 4000);
      if (res.ok) {
        console.log(
          `[e2e-agent-browser] CDP is up after ${Math.round((Date.now() - start) / 1000)}s`,
        );
        return true;
      }
    } catch {
      /* ignore */
    }
    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= heartbeatMs) {
      console.log(
        `[e2e-agent-browser] …still waiting for CDP (${Math.round(elapsed / 1000)}s / ${Math.round(timeoutMs / 1000)}s)`,
      );
      lastLog = elapsed;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function waitForDevPageInCdpList(timeoutMs) {
  const start = Date.now();
  let lastLog = 0;
  const heartbeatMs = 8000;
  console.log(
    `[e2e-agent-browser] waiting for dev URL (port ${DEV_URL_HINT}) in ${CDP_HTTP}/json/list (max ${Math.round(timeoutMs / 1000)}s)…`,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`${CDP_HTTP}/json/list`, 8000);
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const list = await res.json();
      if (!Array.isArray(list)) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const pages = list.filter((t) => t.type === "page");
      const dev = pages.find((t) => devPageUrlMatch(t.url));
      if (dev) {
        console.log("[e2e-agent-browser] CDP page:", dev.url);
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed - lastLog >= heartbeatMs) {
        const urls = pages.map((p) => p.url).filter(Boolean);
        console.log(
          `[e2e-agent-browser] …still waiting for :${DEV_URL_HINT} (${Math.round(elapsed / 1000)}s); CDP pages: ${urls.length ? urls.join(" | ") : "(none)"}`,
        );
        lastLog = elapsed;
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Timeout: no page with :${DEV_URL_HINT} in ${CDP_HTTP}/json/list (is Vite up?)`,
  );
}

function killProcessTree(pid) {
  if (!pid || process.platform !== "win32") return;
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
  } catch {
    /* ignore */
  }
}

async function assertShellViaPlaywright() {
  console.log(
    "[e2e-agent-browser] Playwright connectOverCDP → assert shell (agent-browser CLI unreliable on WebView2)",
  );
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(CDP_HTTP);
  try {
    const pollDeadline = Date.now() + PW_ASSERT_MS;
    /** @type {import("playwright").Page | undefined} */
    let page;
    while (Date.now() < pollDeadline) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      page = pages.find((p) => devPageUrlMatch(p.url())) ?? pages[0];
      if (page && devPageUrlMatch(page.url())) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!page) {
      throw new Error("No CDP page found after connectOverCDP");
    }
    await page.waitForLoadState("domcontentloaded", { timeout: PW_ASSERT_MS });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 8000));
    if (!text.includes("Relay Agent")) {
      throw new Error('page missing "Relay Agent"');
    }
    if (!text.includes("Sessions")) {
      throw new Error('page missing "Sessions"');
    }
    console.log("[e2e-agent-browser] OK (Playwright: Relay Agent + Sessions)");

    if (UI_DEMO) {
      const demoMsg = "E2E CDP demo — safe to delete";
      console.log(
        "[e2e-agent-browser] ui-demo: fill composer + click Send (starts startAgent / IPC)…",
      );
      const ta = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
      await ta.click({ timeout: PW_ASSERT_MS });
      await ta.fill(demoMsg);
      const sendBtn = page.getByRole("button", { name: "Send" });
      await sendBtn.waitFor({ state: "visible", timeout: 15_000 });
      await sendBtn.click();
      console.log(
        "[e2e-agent-browser] ui-demo: Send clicked — agent session starting (M365 Copilot only if that backend path is configured)",
      );
      try {
        await page
          .getByText("E2E CDP demo", { exact: false })
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
        console.log("[e2e-agent-browser] ui-demo: user message visible in feed");
      } catch {
        console.log(
          "[e2e-agent-browser] ui-demo: user bubble not seen in 10s (composer may be disabled if a run was already in progress)",
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.log(
        "[e2e-agent-browser] tip: read-only check — UI looks unchanged. For fill+Send: --ui-demo (often with --keep-app)",
      );
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.error("This E2E targets WebView2 on Windows.");
    process.exit(1);
  }

  let appChild = null;
  /** @type {number | null} */
  let tauriLogFd = null;
  if (WITH_APP) {
    console.log("[e2e-agent-browser] starting Tauri (tauri:dev:cdp)…");
    console.log(
      `[e2e-agent-browser] note: first run can take many minutes while Cargo builds; script polls CDP for up to ${Math.round(CDP_WAIT_MS / 1000)}s.`,
    );
    const logPath =
      process.env.RELAY_E2E_TAURI_LOG ??
      path.join(os.tmpdir(), `relay-e2e-tauri-${process.pid}.log`);
    tauriLogFd = openSync(logPath, "a");
    console.log(`[e2e-agent-browser] Tauri stdout/stderr → ${logPath}`);
    if (TAURI_DETACHED) {
      console.log(
        "[e2e-agent-browser] RELAY_E2E_TAURI_DETACHED=1: UI may not appear; do not Ctrl+C this window.",
      );
    } else {
      console.log(
        "[e2e-agent-browser] Tauri should show a window. Avoid Ctrl+C here. Detach: RELAY_E2E_TAURI_DETACHED=1",
      );
    }
    const spawnOpts = {
      cwd: DESKTOP_ROOT,
      stdio: ["ignore", tauriLogFd, tauriLogFd],
      detached: TAURI_DETACHED,
      shell: false,
      env: process.env,
    };
    const shell = process.env.ComSpec || "cmd.exe";
    appChild = spawn(shell, ["/d", "/c", "pnpm run tauri:dev:cdp"], spawnOpts);
    appChild.on("error", (e) => console.error("[e2e-agent-browser] spawn error:", e));
  }

  try {
    const ok = await waitForCdp(CDP_WAIT_MS);
    if (!ok) {
      throw new Error(
        `CDP not reachable at ${CDP_HTTP}. Run: cd apps/desktop && pnpm run tauri:dev:cdp`,
      );
    }

    await waitForDevPageInCdpList(180_000);
    await new Promise((r) => setTimeout(r, 2000));
    await assertShellViaPlaywright();
    if (WITH_APP && !KEEP_APP) {
      console.log(
        "[e2e-agent-browser] pass — stopping spawned Tauri (use --keep-app to leave the window open)",
      );
    } else if (WITH_APP && KEEP_APP) {
      console.log(
        "[e2e-agent-browser] pass — leaving Tauri running (--keep-app). Close the app or end relay-agent-desktop / node processes when done.",
      );
    }
  } finally {
    if (appChild?.pid && WITH_APP && !KEEP_APP) {
      console.log("[e2e-agent-browser] stopping Tauri tree…");
      killProcessTree(appChild.pid);
    }
    if (tauriLogFd !== null) {
      try {
        closeSync(tauriLogFd);
      } catch {
        /* ignore */
      }
      tauriLogFd = null;
    }
  }
}

main().catch((e) => {
  console.error("[e2e-agent-browser]", e.message ?? e);
  process.exit(1);
});
