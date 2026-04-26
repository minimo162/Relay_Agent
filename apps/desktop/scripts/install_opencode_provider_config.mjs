#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
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
    "Usage: pnpm install:opencode-provider-config -- [--workspace <dir>] [--output <file>] [--opencode-bin <path>] [--dry-run]",
    "",
    "Defaults:",
    "  --workspace  current working directory",
    "  --output     <workspace>/opencode.json",
    "",
    "Environment:",
    "  RELAY_OPENCODE_PROVIDER_PORT       Provider HTTP port, default 18180",
    "  RELAY_AGENT_API_KEY                Provider API key; otherwise a stable local token file is used",
    "  RELAY_OPENCODE_PROVIDER_TOKEN_FILE Token file path, default ~/.relay-agent/opencode-provider-token",
    "  RELAY_BOOTSTRAPPED_OPENCODE_BIN    Optional bootstrapped OpenCode CLI path to probe with --version",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    workspace: process.cwd(),
    output: null,
    dryRun: false,
    opencodeBin: process.env.RELAY_BOOTSTRAPPED_OPENCODE_BIN || null,
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
    if (arg === "--opencode-bin") {
      parsed.opencodeBin = raw[++index];
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

function probeOpencodeBin(path) {
  if (!path) return null;
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new Error(`Bootstrapped OpenCode CLI was not found: ${absolute}`);
  }
  const result = spawnSync(absolute, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`Could not run bootstrapped OpenCode CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Bootstrapped OpenCode CLI version probe failed with exit ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return {
    path: absolute,
    version: `${result.stdout || result.stderr}`.trim(),
  };
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
  const opencodeProbe = probeOpencodeBin(options.opencodeBin);

  if (!options.dryRun) {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, content, "utf8");
  }

  console.log("[relay-opencode-provider] config:", options.dryRun ? "(dry run)" : output);
  console.log("[relay-opencode-provider] baseURL:", baseURL);
  console.log("[relay-opencode-provider] model:", MODEL_REF);
  console.log("[relay-opencode-provider] api key source:", source);
  if (opencodeProbe) {
    console.log("[relay-opencode-provider] opencode bin:", opencodeProbe.path);
    console.log("[relay-opencode-provider] opencode version:", opencodeProbe.version);
  }
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
