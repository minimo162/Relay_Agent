#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_REF,
  edgeCdpPort,
  providerBaseURL,
  providerPort,
  readOrCreateToken,
  shellExportLine,
} from "./opencode_provider_config.mjs";
import {
  aionuiProviderSeedFilePath,
  aionuiRelaySeedBundle,
  writeAionuiProviderSeedFile,
} from "./aionui_provider_seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function usage() {
  return [
    "Usage: pnpm --filter @relay-agent/desktop start:aionui-relay-gateway [--print-seed] [--aionui-bin <path>]",
    "",
    "Starts Relay's local M365 Copilot provider gateway before launching the",
    "Relay-branded AionUi shell. In the future product path, the AionUi fork",
    "imports the written seed file on startup.",
    "",
    "Environment:",
    "  RELAY_EDGE_CDP_PORT                 Edge CDP port, default 9360",
    "  RELAY_OPENCODE_PROVIDER_PORT       Provider HTTP port, default 18180",
    "  RELAY_AGENT_API_KEY                Provider API key; otherwise a stable local token file is used",
    "  RELAY_AIONUI_PROVIDER_SEED_FILE    Seed JSON path, default ~/.relay-agent/aionui-provider-seed.json",
    "  RELAY_SKIP_PRESTART_EDGE=1         Skip starting Edge before the provider",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    printSeed: false,
    aionuiBin: null,
    help: false,
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--print-seed") {
      parsed.printSeed = true;
      continue;
    }
    if (arg === "--aionui-bin") {
      parsed.aionuiBin = raw[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function prestartEdge(cdpPort) {
  if (process.env.RELAY_SKIP_PRESTART_EDGE === "1") return;
  if (process.platform === "win32") {
    console.log(
      "[relay-aionui-provider] Windows: start Microsoft Edge with --remote-debugging-port=" +
        cdpPort +
        " and the RelayAgentEdgeProfile before using the provider.",
    );
    return;
  }
  const script = join(repoRoot, "scripts/start-relay-edge-cdp.sh");
  const result = spawnSync("bash", [script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RELAY_EDGE_CDP_PORT: String(cdpPort),
    },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function startProvider({ token, cdpPort, httpPort }) {
  const scriptPath = join(appRoot, "src-tauri/binaries/copilot_server.js");
  return spawn(
    process.execPath,
    [
      "--no-warnings",
      scriptPath,
      "--port",
      String(httpPort),
      "--cdp-port",
      String(cdpPort),
      "--boot-token",
      token,
      "--instance-id",
      randomUUID(),
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RELAY_EDGE_CDP_PORT: String(cdpPort),
      },
      stdio: "inherit",
    },
  );
}

function startAionuiShell(aionuiBin, seedFile) {
  if (!aionuiBin) return null;
  const absolute = resolve(aionuiBin);
  if (!existsSync(absolute)) {
    throw new Error(`AionUi shell executable was not found: ${absolute}`);
  }
  return spawn(absolute, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RELAY_AIONUI_PROVIDER_SEED_FILE: seedFile,
    },
    stdio: "inherit",
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const cdpPort = edgeCdpPort();
  const httpPort = providerPort();
  const baseUrl = providerBaseURL(httpPort);
  const { token, source } = readOrCreateToken();
  const seed = aionuiRelaySeedBundle({ baseUrl, apiKey: token });
  const seedFile = writeAionuiProviderSeedFile(seed, aionuiProviderSeedFilePath());

  console.log("[relay-aionui-provider] baseURL:", baseUrl);
  console.log("[relay-aionui-provider] model:", MODEL_REF);
  console.log("[relay-aionui-provider] seed:", seedFile);
  console.log("[relay-aionui-provider] api key source:", source);
  console.log("[relay-aionui-provider] lifecycle: provider gateway starts before AionUi shell");
  console.log("");
  console.log("Diagnostic API key export:");
  console.log(shellExportLine(token));

  if (options.printSeed) {
    console.log("");
    console.log(JSON.stringify(seed, null, 2));
    return;
  }

  prestartEdge(cdpPort);
  const provider = startProvider({ token, cdpPort, httpPort });
  const shell = startAionuiShell(options.aionuiBin, seedFile);

  const stop = (signal) => {
    if (!provider.killed) provider.kill(signal);
    if (shell && !shell.killed) shell.kill(signal);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  provider.on("exit", (code, signal) => {
    if (shell && !shell.killed) shell.kill("SIGTERM");
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  shell?.on("exit", () => {
    if (!provider.killed) provider.kill("SIGTERM");
  });
}

try {
  main();
} catch (error) {
  console.error("[relay-aionui-provider] start failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
