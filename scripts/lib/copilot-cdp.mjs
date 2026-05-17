import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export async function ensureCopilotCdp({ preferredPort = 9360, artifactDir, profile } = {}) {
  const edgeProfile = profile ?? process.env.RELAY_EDGE_PROFILE ?? join(homedir(), "RelayAgentEdgeProfile");
  const diagnostics = {
    preferredPort,
    profile: edgeProfile,
    started: false,
    selectedPort: null,
    attempts: [],
  };

  const preferred = await probePort(preferredPort);
  diagnostics.attempts.push({ kind: "preferred", port: preferredPort, ok: preferred.ok, detail: preferred.detail });
  if (preferred.ok) {
    diagnostics.selectedPort = preferredPort;
    writeDiagnostics(artifactDir, diagnostics);
    return { port: preferredPort, cleanup: () => {}, diagnostics };
  }

  const devToolsPort = readDevToolsPort(edgeProfile);
  if (devToolsPort && devToolsPort !== preferredPort) {
    const existing = await probePort(devToolsPort);
    diagnostics.attempts.push({ kind: "devtools-active-port", port: devToolsPort, ok: existing.ok, detail: existing.detail });
    if (existing.ok) {
      diagnostics.selectedPort = devToolsPort;
      writeDiagnostics(artifactDir, diagnostics);
      return { port: devToolsPort, cleanup: () => {}, diagnostics };
    }
  }

  if (process.env.RELAY_LIVE_AUTO_START_EDGE_CDP === "0") {
    writeDiagnostics(artifactDir, diagnostics);
    throw new Error(`Copilot Edge CDP is not reachable on ${preferredPort}; auto-start is disabled.`);
  }

  const edgePath = findEdgePath();
  if (!edgePath) {
    writeDiagnostics(artifactDir, diagnostics);
    throw new Error("Microsoft Edge was not found in PATH.");
  }

  mkdirSync(edgeProfile, { recursive: true });
  const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const args = [
    `--user-data-dir=${edgeProfile}`,
    `--remote-debugging-port=${preferredPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-restore-session-state",
    "--disable-gpu",
    "--disable-gpu-compositing",
  ];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-dev-shm-usage");
  if (headless) args.push("--headless=new");

  const child = spawn(edgePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  diagnostics.started = true;
  diagnostics.edgePath = edgePath;
  diagnostics.headless = headless;
  diagnostics.pid = child.pid;

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1000);
    const started = await probePort(preferredPort);
    diagnostics.attempts.push({ kind: "started", attempt: attempt + 1, port: preferredPort, ok: started.ok, detail: started.detail });
    if (started.ok) {
      diagnostics.selectedPort = preferredPort;
      writeDiagnostics(artifactDir, diagnostics);
      return {
        port: preferredPort,
        cleanup: () => {
          if (!child.killed) child.kill("SIGTERM");
        },
        diagnostics,
      };
    }
    if (child.exitCode !== null) break;
  }

  diagnostics.stderr = stderr;
  diagnostics.exitCode = child.exitCode;
  writeDiagnostics(artifactDir, diagnostics);
  if (!child.killed) child.kill("SIGTERM");
  throw new Error(`Copilot Edge CDP did not become reachable on ${preferredPort}; Edge exitCode=${child.exitCode}; stderr=${stderr.slice(-1200)}`);
}

export async function assertCopilotCdp(port) {
  const probe = await probePort(port);
  if (!probe.ok) throw new Error(`Copilot Edge CDP is not reachable on ${port}: ${probe.detail}`);
}

async function probePort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const version = await response.json();
    if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
      return { ok: false, detail: `not Edge: ${JSON.stringify(version)}` };
    }
    return { ok: true, detail: version.Browser ?? "Edge" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function readDevToolsPort(profile) {
  const file = join(profile, "DevToolsActivePort");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim();
  const port = Number(text);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function findEdgePath() {
  for (const candidate of [
    process.env.RELAY_E2E_EDGE,
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge",
    "microsoft-edge-stable",
    "microsoft-edge",
  ]) {
    if (!candidate) continue;
    if (candidate.includes("/") && existsSync(candidate)) return candidate;
    if (!candidate.includes("/")) return candidate;
  }
  return null;
}

function writeDiagnostics(artifactDir, diagnostics) {
  if (!artifactDir) return;
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "copilot-cdp.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
