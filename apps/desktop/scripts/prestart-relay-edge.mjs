#!/usr/bin/env node
/**
 * Before `tauri dev`, try to start Edge with CDP on RELAY_EDGE_CDP_PORT (default 9360)
 * and RelayAgentEdgeProfile — same as `scripts/start-relay-edge-cdp.sh` at repo root.
 *
 * Skip entirely: RELAY_SKIP_PRESTART_EDGE=1
 * Windows: no-op with a hint (use shortcut from docs/COPILOT_E2E_CDP_PITFALLS.md)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.RELAY_SKIP_PRESTART_EDGE === "1") {
  process.exit(0);
}

if (process.platform === "win32") {
  console.log(
    "[prestart-relay-edge] Windows: start msedge with --remote-debugging-port=9360 (or 9333 if legacy) and RelayAgentEdgeProfile (see docs/COPILOT_E2E_CDP_PITFALLS.md).",
  );
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Monorepo root `Relay_Agent/` (`apps/desktop/scripts` → up 3 levels). */
const repoRoot = path.resolve(__dirname, "../../..");
const sh = path.join(repoRoot, "scripts/start-relay-edge-cdp.sh");

if (!fs.existsSync(sh)) {
  console.warn("[prestart-relay-edge] missing:", sh);
  process.exit(0);
}

const r = spawnSync("bash", [sh], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (r.status !== 0) {
  console.warn(
    "[prestart-relay-edge] Edge prestart exited non-zero; continuing tauri dev (DISPLAY / Edge missing?). Set RELAY_SKIP_PRESTART_EDGE=1 to silence.",
  );
}

process.exit(0);
