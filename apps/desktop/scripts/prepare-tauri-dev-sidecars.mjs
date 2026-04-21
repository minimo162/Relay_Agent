#!/usr/bin/env node
/**
 * Prepare Tauri externalBin sidecars before `tauri dev`.
 *
 * Tauri validates and copies every configured externalBin during dev builds.
 * Downloaded sidecars are intentionally gitignored, so a fresh checkout can be
 * missing the host-specific relay-node or relay-rg binary.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cleanupTauriDebugSidecars } from "./cleanup-tauri-debug-sidecars.mjs";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const binDir = path.join(desktopRoot, "src-tauri", "binaries");

function hostTripleFromRustc() {
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      "rustc -vV failed; install Rust or set TAURI_ENV_TARGET_TRIPLE",
    );
  }

  const match = result.stdout.match(/host: (\S+)/);
  if (!match) {
    throw new Error("could not parse host triple from rustc -vV");
  }
  return match[1];
}

function sidecarNames(triple) {
  const windows = triple.endsWith("-pc-windows-msvc");
  return {
    node: `relay-node-${triple}${windows ? ".exe" : ""}`,
    ripgrep: `relay-rg-${triple}${windows ? ".exe" : ""}`,
  };
}

function runFetch(scriptName, triple) {
  const scriptPath = path.join(desktopRoot, "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_ENV_TARGET_TRIPLE: triple,
    },
  });

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with ${result.status ?? "unknown"}`);
  }
}

export function prepareTauriDevSidecars() {
  cleanupTauriDebugSidecars();

  const triple = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || hostTripleFromRustc();
  const names = sidecarNames(triple);
  const missing = [
    {
      label: "relay-node",
      file: path.join(binDir, names.node),
      fetchScript: "fetch-bundled-node.mjs",
    },
    {
      label: "relay-rg",
      file: path.join(binDir, names.ripgrep),
      fetchScript: "fetch-bundled-ripgrep.mjs",
    },
  ].filter((sidecar) => !existsSync(sidecar.file));

  if (missing.length === 0) {
    return;
  }

  console.log(
    `[prepare-tauri-dev-sidecars] missing ${missing
      .map((sidecar) => sidecar.label)
      .join(", ")} for ${triple}; downloading before tauri dev`,
  );

  for (const sidecar of missing) {
    runFetch(sidecar.fetchScript, triple);
  }
}

export function prepareTauriDevSidecarsOrExit() {
  try {
    prepareTauriDevSidecars();
  } catch (error) {
    console.error(
      `[prepare-tauri-dev-sidecars] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareTauriDevSidecarsOrExit();
}
