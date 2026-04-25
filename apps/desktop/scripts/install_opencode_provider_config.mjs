#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  MODEL_REF,
  mergeOpencodeConfig,
  opencodeProviderConfig,
  providerBaseURL,
  providerPort,
  readOrCreateToken,
  shellExportLine,
} from "./opencode_provider_config.mjs";

const args = process.argv.slice(2);

function usage() {
  return [
    "Usage: pnpm install:opencode-provider-config -- [--workspace <dir>] [--output <file>] [--dry-run]",
    "",
    "Defaults:",
    "  --workspace  current working directory",
    "  --output     <workspace>/opencode.json",
    "",
    "Environment:",
    "  RELAY_OPENCODE_PROVIDER_PORT       Provider HTTP port, default 18180",
    "  RELAY_AGENT_API_KEY                Provider API key; otherwise a stable local token file is used",
    "  RELAY_OPENCODE_PROVIDER_TOKEN_FILE Token file path, default ~/.relay-agent/opencode-provider-token",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    workspace: process.cwd(),
    output: null,
    dryRun: false,
  };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--workspace" || arg === "--dir") {
      parsed.workspace = raw[++index];
      continue;
    }
    if (arg === "--output" || arg === "--file") {
      parsed.output = raw[++index];
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (!arg.startsWith("-") && parsed.workspace === process.cwd()) {
      parsed.workspace = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readExistingConfig(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse existing ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const workspace = resolve(options.workspace);
  const output = resolve(options.output || `${workspace}/opencode.json`);
  const baseURL = providerBaseURL(providerPort());
  const relayConfig = opencodeProviderConfig(baseURL);
  const merged = mergeOpencodeConfig(readExistingConfig(output), relayConfig);
  const { token, source } = readOrCreateToken();
  const content = `${JSON.stringify(merged, null, 2)}\n`;

  if (!options.dryRun) {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, content, "utf8");
  }

  console.log("[relay-opencode-provider] config:", options.dryRun ? "(dry run)" : output);
  console.log("[relay-opencode-provider] baseURL:", baseURL);
  console.log("[relay-opencode-provider] model:", MODEL_REF);
  console.log("[relay-opencode-provider] api key source:", source);
  console.log("");
  console.log("Export this before starting OpenCode/OpenWork:");
  console.log(shellExportLine(token));
  if (options.dryRun) {
    console.log("");
    console.log(content.trimEnd());
  }
}

try {
  main();
} catch (error) {
  console.error("[relay-opencode-provider] install failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
