#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

export function patchInitStorageContent(input) {
  let output = input;
  const importLine = "import { applyRelayAssistantSeed, applyRelayProviderSeed } from './relaySeed';";

  if (!output.includes(importLine)) {
    const anchor = "import { migrateFromElectronConfig, importConfigFromFile } from './configMigration';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage configMigration import anchor");
    }
    output = output.replace(anchor, `${anchor}\n${importLine}`);
  }

  const providerMarker = "mark('3.2 relaySeed')";
  if (!output.includes(providerMarker)) {
    const anchor = "    mark('3.1 configMigration');\n  }\n\n  // 4.";
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage provider seed insertion anchor");
    }
    output = output.replace(
      anchor,
      [
        "    mark('3.1 configMigration');",
        "  }",
        "",
        "  await applyRelayProviderSeed(configFile);",
        "  mark('3.2 relaySeed');",
        "",
        "  // 4.",
      ].join("\n"),
    );
  }

  const assistantMarker = "await applyRelayAssistantSeed(configFile);";
  if (!output.includes(assistantMarker)) {
    const anchor = [
      "    if (needsPromptsI18nMigration) {",
      "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
      "    }",
      "    mark('5.2 assistant config + migrations');",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage assistant seed insertion anchor");
    }
    output = output.replace(
      anchor,
      [
        "    if (needsPromptsI18nMigration) {",
        "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
        "    }",
        "    await applyRelayAssistantSeed(configFile);",
        "    mark('5.2 assistant config + migrations');",
      ].join("\n"),
    );
  }

  return output;
}

export function applyAionuiOverlay(aionuiDir) {
  const targetRoot = resolve(aionuiDir);
  const initStoragePath = resolve(targetRoot, "src/process/utils/initStorage.ts");
  if (!existsSync(initStoragePath)) {
    throw new Error(`AionUi initStorage.ts was not found: ${initStoragePath}`);
  }

  const overlayRoot = resolve(repoRoot, "integrations/aionui/overlay");
  const relaySeedSource = resolve(overlayRoot, "src/process/utils/relaySeed.ts");
  const relaySeedTarget = resolve(targetRoot, "src/process/utils/relaySeed.ts");

  mkdirSync(dirname(relaySeedTarget), { recursive: true });
  copyFileSync(relaySeedSource, relaySeedTarget);

  const patched = patchInitStorageContent(readFileSync(initStoragePath, "utf8"));
  writeFileSync(initStoragePath, patched, "utf8");

  return {
    initStoragePath,
    relaySeedTarget,
  };
}

function usage() {
  return [
    "Usage: node scripts/apply-aionui-overlay.mjs --aionui-dir <path>",
    "",
    "Applies the Relay Agent provider/assistant seed overlay to an AionUi checkout.",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    aionuiDir: process.env.AIONUI_DIR || "",
    help: false,
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--aionui-dir") {
      parsed.aionuiDir = raw[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!options.aionuiDir) {
      throw new Error("--aionui-dir is required");
    }
    const result = applyAionuiOverlay(options.aionuiDir);
    console.log("[relay-aionui-overlay] initStorage:", result.initStoragePath);
    console.log("[relay-aionui-overlay] relaySeed:", result.relaySeedTarget);
  } catch (error) {
    console.error("[relay-aionui-overlay] apply failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
