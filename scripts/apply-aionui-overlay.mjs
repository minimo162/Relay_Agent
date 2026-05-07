#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const manifestPath = resolve(repoRoot, "apps/desktop/src-tauri/bootstrap/aionui-relay.json");
const desktopIconRoot = resolve(repoRoot, "apps/desktop/src-tauri/icons");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function relayBranding() {
  return readJson(manifestPath).branding;
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function replaceLine(input, pattern, replacement) {
  if (!pattern.test(input)) {
    throw new Error(`Could not find branding patch anchor: ${pattern}`);
  }
  return input.replace(pattern, replacement);
}

function replaceYamlScalar(input, key, value) {
  return replaceLine(input, new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
}

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

export function patchPackageJsonContent(input, branding = relayBranding()) {
  const packageJson = JSON.parse(input);
  packageJson.name = branding.packageName;
  packageJson.description = "Relay Agent desktop shell powered by AionUi and Microsoft 365 Copilot.";
  packageJson.author = {
    name: branding.supportName,
  };
  packageJson.productName = branding.productName;
  return ensureTrailingNewline(JSON.stringify(packageJson, null, 2));
}

export function patchElectronBuilderContent(input, branding = relayBranding()) {
  let output = input;
  output = replaceYamlScalar(output, "appId", branding.appId);
  output = replaceYamlScalar(output, "productName", branding.productName);
  output = replaceYamlScalar(output, "executableName", branding.executableName);
  output = replaceYamlScalar(output, "copyright", `Copyright © 2026 ${branding.productName}`);
  output = replaceLine(
    output,
    /^  - name: .+ Protocol$/m,
    `  - name: ${branding.productName} Protocol`,
  );
  output = replaceLine(output, /^      - (aionui|relay-agent)$/m, `      - ${branding.protocol}`);
  output = replaceLine(output, /^  maintainer: .*$/m, `  maintainer: ${branding.packageName}`);
  output = replaceLine(output, /^  vendor: .*$/m, `  vendor: ${branding.supportName}`);
  output = replaceLine(output, /^      Name: .*$/m, `      Name: ${branding.productName}`);
  output = replaceLine(output, /^      Icon: .*$/m, `      Icon: ${branding.packageName}`);
  output = replaceLine(
    output,
    /^      MimeType: x-scheme-handler\/[^;]+;$/m,
    `      MimeType: x-scheme-handler/${branding.protocol};`,
  );
  output = replaceLine(output, /^  owner: .*$/m, `  owner: ${branding.publishOwner}`);
  output = replaceLine(output, /^  repo: .*$/m, `  repo: ${branding.publishRepo}`);
  return output;
}

export function patchDeepLinkContent(input, branding = relayBranding()) {
  let output = input;
  output = replaceLine(
    output,
    /^export const PROTOCOL_SCHEME = '[^']+';$/m,
    `export const PROTOCOL_SCHEME = '${branding.protocol}';`,
  );
  output = output.replaceAll("aionui://", `${branding.protocol}://`);
  output = output.replaceAll(`an ${branding.protocol}://`, `a ${branding.protocol}://`);
  return output;
}

function copyBrandingAssets(targetRoot) {
  const resourcesDir = resolve(targetRoot, "resources");
  const rendererBrandDir = resolve(targetRoot, "src/renderer/assets/logos/brand");
  const publicPwaDir = resolve(targetRoot, "public/pwa");

  mkdirSync(resourcesDir, { recursive: true });
  mkdirSync(rendererBrandDir, { recursive: true });
  mkdirSync(publicPwaDir, { recursive: true });

  const pngIcon = resolve(desktopIconRoot, "icon.png");
  const icoIcon = resolve(desktopIconRoot, "icon.ico");
  const icnsIcon = resolve(desktopIconRoot, "icon.icns");
  const png128Icon = resolve(desktopIconRoot, "128x128.png");

  copyFileSync(icoIcon, resolve(resourcesDir, "app.ico"));
  copyFileSync(icnsIcon, resolve(resourcesDir, "app.icns"));
  copyFileSync(pngIcon, resolve(resourcesDir, "app.png"));
  copyFileSync(pngIcon, resolve(resourcesDir, "icon.png"));
  copyFileSync(pngIcon, resolve(rendererBrandDir, "app.png"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-180.png"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-192.png"));
  copyFileSync(pngIcon, resolve(publicPwaDir, "icon-512.png"));

  return {
    resourcesDir,
    rendererBrandDir,
    publicPwaDir,
  };
}

export function applyAionuiOverlay(aionuiDir) {
  const targetRoot = resolve(aionuiDir);
  const initStoragePath = resolve(targetRoot, "src/process/utils/initStorage.ts");
  if (!existsSync(initStoragePath)) {
    throw new Error(`AionUi initStorage.ts was not found: ${initStoragePath}`);
  }
  const packageJsonPath = resolve(targetRoot, "package.json");
  const electronBuilderPath = resolve(targetRoot, "electron-builder.yml");
  const deepLinkPath = resolve(targetRoot, "src/process/utils/deepLink.ts");
  for (const requiredPath of [packageJsonPath, electronBuilderPath, deepLinkPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`AionUi overlay target was not found: ${requiredPath}`);
    }
  }

  const overlayRoot = resolve(repoRoot, "integrations/aionui/overlay");
  const relaySeedSource = resolve(overlayRoot, "src/process/utils/relaySeed.ts");
  const relaySeedTarget = resolve(targetRoot, "src/process/utils/relaySeed.ts");

  mkdirSync(dirname(relaySeedTarget), { recursive: true });
  copyFileSync(relaySeedSource, relaySeedTarget);

  const patched = patchInitStorageContent(readFileSync(initStoragePath, "utf8"));
  writeFileSync(initStoragePath, patched, "utf8");
  writeFileSync(packageJsonPath, patchPackageJsonContent(readFileSync(packageJsonPath, "utf8")), "utf8");
  writeFileSync(
    electronBuilderPath,
    patchElectronBuilderContent(readFileSync(electronBuilderPath, "utf8")),
    "utf8",
  );
  writeFileSync(deepLinkPath, patchDeepLinkContent(readFileSync(deepLinkPath, "utf8")), "utf8");
  const brandingAssets = copyBrandingAssets(targetRoot);

  return {
    brandingAssets,
    deepLinkPath,
    electronBuilderPath,
    initStoragePath,
    packageJsonPath,
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
    console.log("[relay-aionui-overlay] package:", result.packageJsonPath);
    console.log("[relay-aionui-overlay] electronBuilder:", result.electronBuilderPath);
    console.log("[relay-aionui-overlay] deepLink:", result.deepLinkPath);
    console.log("[relay-aionui-overlay] resources:", result.brandingAssets.resourcesDir);
  } catch (error) {
    console.error("[relay-aionui-overlay] apply failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
