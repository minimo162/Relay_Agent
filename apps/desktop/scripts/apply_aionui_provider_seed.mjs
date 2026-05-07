#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aionuiProviderSeedFilePath,
  applyAionuiRelaySeed,
} from "./aionui_provider_seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

function usage() {
  return [
    "Usage: node apps/desktop/scripts/apply_aionui_provider_seed.mjs --config <json-file> [--seed <json-file>] [--dry-run]",
    "",
    "This is a CI-safe adapter for the Relay-branded AionUi fork. The fork should",
    "call the same merge logic through ProcessConfig on first startup.",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    config: null,
    seed: aionuiProviderSeedFilePath(),
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--config") {
      parsed.config = raw[++index];
      continue;
    }
    if (arg === "--seed") {
      parsed.seed = raw[++index];
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.config) {
    throw new Error("--config is required");
  }

  const configPath = resolve(repoRoot, options.config);
  const seedPath = resolve(repoRoot, options.seed);
  const existing = readJsonIfExists(configPath, {});
  const seed = readJsonIfExists(seedPath, null);
  if (!seed) {
    throw new Error(`AionUi provider seed file was not found or empty: ${seedPath}`);
  }

  const applied = applyAionuiRelaySeed(existing, seed);
  const output = `${JSON.stringify(applied, null, 2)}\n`;

  if (options.dryRun) {
    console.log(output.trimEnd());
    return;
  }

  writeFileSync(configPath, output, "utf8");
  console.log("[relay-aionui-seed] config:", configPath);
  console.log("[relay-aionui-seed] provider:", applied["model.config"]?.[0]?.id ?? "unknown");
  console.log("[relay-aionui-seed] model:", applied["aionrs.defaultModel"]?.useModel ?? "unknown");
}

try {
  main();
} catch (error) {
  console.error("[relay-aionui-seed] apply failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
