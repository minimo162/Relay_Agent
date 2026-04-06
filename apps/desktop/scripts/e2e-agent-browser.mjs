#!/usr/bin/env node
/**
 * E2E against the running Tauri WebView2 via CDP using agent-browser.
 *
 * Prerequisite: app started with `pnpm run tauri:dev:cdp` (default CDP port 9222),
 * unless you pass `--with-app` to spawn it from this script.
 *
 * Env:
 *   RELAY_WEBVIEW2_CDP_PORT  (default 9222)
 *   RELAY_WEBVIEW2_CDP_HTTP  (default http://127.0.0.1:<port>)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const AGENT_BROWSER_CLI = path.join(
  DESKTOP_ROOT,
  "node_modules",
  "agent-browser",
  "bin",
  "agent-browser.js",
);

const CDP_PORT = process.env.RELAY_WEBVIEW2_CDP_PORT ?? "9222";
const CDP_HTTP = process.env.RELAY_WEBVIEW2_CDP_HTTP ?? `http://127.0.0.1:${CDP_PORT}`;
const DEV_URL_HINT = "1421";

const WITH_APP = process.argv.includes("--with-app");

function cdpWaitMs() {
  const raw = process.env.RELAY_E2E_CDP_WAIT_MS;
  if (raw === undefined || raw === "") return WITH_APP ? 300_000 : 45_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return WITH_APP ? 300_000 : 45_000;
  return n;
}

const CDP_WAIT_MS = cdpWaitMs();

/** Avoid inherited AGENT_BROWSER_* (e.g. stray CDP port) overriding CLI flags. */
function agentBrowserEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if (k.startsWith("AGENT_BROWSER_")) delete e[k];
  }
  return e;
}

/**
 * Run agent-browser via its Node wrapper + pinned local install.
 * Use `connect <port>` first (not `--cdp`): on Windows, `--cdp 9222` is misrouted to a stale
 * default port in this CLI version; the connect subcommand attaches correctly.
 */
function runAgentBrowserCli(argv) {
  if (!existsSync(AGENT_BROWSER_CLI)) {
    throw new Error(
      "agent-browser is not installed. Run: pnpm add -D agent-browser (from apps/desktop)",
    );
  }
  return spawnSync(process.execPath, [AGENT_BROWSER_CLI, ...argv], {
    cwd: DESKTOP_ROOT,
    encoding: "utf-8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
    env: agentBrowserEnv(),
  });
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CDP_HTTP}/json/version`);
      if (res.ok) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function parseJsonStdout(stdout) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* continue */
    }
  }
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

/** Wait until CDP reports the Vite dev page (WebView2 tab API is unreliable here). */
async function waitForDevPageInCdpList(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CDP_HTTP}/json/list`);
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
      const dev = pages.find((t) => {
        const u = String(t.url ?? "");
        return (
          u.includes(`localhost:${DEV_URL_HINT}`) ||
          u.includes(`127.0.0.1:${DEV_URL_HINT}`)
        );
      });
      if (dev) {
        console.log("[e2e-agent-browser] CDP page:", dev.url);
        return;
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

function assertSuccess(parsed, label) {
  if (!parsed || parsed.success !== true) {
    const err = parsed?.error ?? JSON.stringify(parsed);
    throw new Error(`${label} failed: ${err}`);
  }
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

async function main() {
  if (process.platform !== "win32") {
    console.error("This E2E targets WebView2 on Windows.");
    process.exit(1);
  }

  let appChild = null;
  if (WITH_APP) {
    console.log("[e2e-agent-browser] starting Tauri (tauri:dev:cdp)…");
    // Single shell line avoids Windows spawn EINVAL with pnpm.cmd + shell:false.
    appChild = spawn("pnpm run tauri:dev:cdp", {
      cwd: DESKTOP_ROOT,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    appChild.on("error", (e) => console.error("[e2e-agent-browser] spawn error:", e));
  }

  try {
    const ok = await waitForCdp(CDP_WAIT_MS);
    if (!ok) {
      throw new Error(
        `CDP not reachable at ${CDP_HTTP}. Run: cd apps/desktop && pnpm run tauri:dev:cdp`,
      );
    }

    await waitForDevPageInCdpList(120_000);
    await new Promise((r) => setTimeout(r, 3000));

    const connectR = runAgentBrowserCli(["--json", "connect", CDP_PORT]);
    const conn = parseJsonStdout(connectR.stdout ?? "");
    assertSuccess(conn, `connect ${CDP_PORT}`);

    const snapR = runAgentBrowserCli(["--json", "snapshot", "-i"]);
    if (snapR.status !== 0) {
      throw new Error(
        `agent-browser exit ${snapR.status}\nstdout: ${snapR.stdout?.slice(0, 2000)}\nstderr: ${snapR.stderr}`,
      );
    }
    const snap = parseJsonStdout(snapR.stdout ?? "");
    assertSuccess(snap, "snapshot -i");

    const evalR = runAgentBrowserCli([
      "--json",
      "eval",
      "document.body.innerText.slice(0, 8000)",
    ]);
    const ev = parseJsonStdout(evalR.stdout ?? "");
    assertSuccess(ev, "eval innerText");
    const bodyText = String(
      ev.data?.result ?? ev.data?.value ?? ev.data ?? "",
    );
    if (!bodyText.includes("Relay Agent")) {
      throw new Error(
        `page text missing "Relay Agent" (snapshot excerpt: ${String(snap.data?.snapshot ?? snap.data).slice(0, 400)})`,
      );
    }
    if (!bodyText.includes("Sessions")) {
      throw new Error('page text missing "Sessions"');
    }

    console.log("[e2e-agent-browser] OK (eval innerText: Relay Agent + Sessions)");

    runAgentBrowserCli(["--json", "close"]);
  } finally {
    if (appChild?.pid) {
      console.log("[e2e-agent-browser] stopping Tauri tree…");
      killProcessTree(appChild.pid);
    }
  }
}

main().catch((e) => {
  console.error("[e2e-agent-browser]", e.message ?? e);
  process.exit(1);
});
