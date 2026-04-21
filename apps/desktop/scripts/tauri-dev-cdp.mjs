#!/usr/bin/env node
/**
 * Cross-platform: sets RELAY_WEBVIEW2_CDP_PORT before spawning `tauri dev`
 * so WebView2 exposes Chrome DevTools Protocol (see lib.rs).
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

import { prepareTauriDevSidecarsOrExit } from "./prepare-tauri-dev-sidecars.mjs";

if (!process.env.RELAY_WEBVIEW2_CDP_PORT) {
  process.env.RELAY_WEBVIEW2_CDP_PORT = "9222";
}

prepareTauriDevSidecarsOrExit();

const r = spawnSync("pnpm", ["exec", "tauri", "dev"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});
process.exit(r.status ?? 1);
