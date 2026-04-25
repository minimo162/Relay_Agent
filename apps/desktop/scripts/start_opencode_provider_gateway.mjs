#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_REF,
  edgeCdpPort,
  opencodeProviderConfig,
  providerBaseURL,
  providerPort,
  readOrCreateToken,
  shellExportLine,
} from "./opencode_provider_config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const cdpPort = edgeCdpPort();
const httpPort = providerPort();
const args = new Set(process.argv.slice(2));

function usage() {
  return [
    "Usage: pnpm --filter @relay-agent/desktop start:opencode-provider-gateway [--print-config]",
    "",
    "Environment:",
    "  RELAY_EDGE_CDP_PORT                 Edge CDP port, default 9360",
    "  RELAY_OPENCODE_PROVIDER_PORT       Provider HTTP port, default 18180",
    "  RELAY_AGENT_API_KEY                Provider API key; otherwise a stable local token file is used",
    "  RELAY_OPENCODE_PROVIDER_TOKEN_FILE Token file path, default ~/.relay-agent/opencode-provider-token",
    "  RELAY_SKIP_PRESTART_EDGE=1         Skip starting Edge before the provider",
  ].join("\n");
}

function printConfig(token, tokenSource) {
  const baseURL = providerBaseURL(httpPort);
  console.log("[relay-opencode-provider] baseURL:", baseURL);
  console.log("[relay-opencode-provider] model:", MODEL_REF);
  console.log("[relay-opencode-provider] api key source:", tokenSource);
  console.log("");
  console.log("Export this before starting OpenCode/OpenWork:");
  console.log(shellExportLine(token));
  console.log("");
  console.log("opencode.json:");
  console.log(JSON.stringify(opencodeProviderConfig(baseURL), null, 2));
}

function prestartEdge() {
  if (process.env.RELAY_SKIP_PRESTART_EDGE === "1") return;
  if (process.platform === "win32") {
    console.log(
      "[relay-opencode-provider] Windows: start Microsoft Edge with --remote-debugging-port=" +
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
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startProvider(token) {
  const scriptPath = join(appRoot, "src-tauri/binaries/copilot_server.js");
  const child = spawn(
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

  const stop = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

if (args.has("--help") || args.has("-h")) {
  console.log(usage());
  process.exit(0);
}

const { token, source } = readOrCreateToken();
printConfig(token, source);
if (args.has("--print-config")) {
  process.exit(0);
}
prestartEdge();
startProvider(token);
