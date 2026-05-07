import assert from "node:assert/strict";
import test from "node:test";

import {
  patchDeepLinkContent,
  patchElectronBuilderContent,
  patchInitStorageContent,
  patchPackageJsonContent,
} from "./apply-aionui-overlay.mjs";

const branding = {
  packageName: "relay-agent-aionui",
  appId: "com.relayagent.app",
  productName: "Relay Agent",
  executableName: "Relay Agent",
  protocol: "relay-agent",
  publishOwner: "minimo162",
  publishRepo: "Relay_Agent",
  supportName: "Relay Agent",
};

const fixture = [
  "import { migrateFromElectronConfig, importConfigFromFile } from './configMigration';",
  "",
  "const initStorage = async () => {",
  "  if (!hasElectronAppPath()) {",
  "    mark('3.1 configMigration');",
  "  }",
  "",
  "  // 4. 初始化 MCP 配置（为所有用户提供默认配置）",
  "",
  "    if (needsPromptsI18nMigration) {",
  "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
  "    }",
  "    mark('5.2 assistant config + migrations');",
  "};",
].join("\n");

test("patchInitStorageContent imports and applies Relay provider and assistant seed once", () => {
  const once = patchInitStorageContent(fixture);
  const twice = patchInitStorageContent(once);

  assert.equal(twice, once);
  assert.match(once, /applyRelayAssistantSeed, applyRelayProviderSeed/);
  assert.match(once, /await applyRelayProviderSeed\(configFile\);/);
  assert.match(once, /mark\('3.2 relaySeed'\);/);
  assert.match(once, /await applyRelayAssistantSeed\(configFile\);/);
});

test("patchPackageJsonContent rebrands the AionUi package metadata", () => {
  const patched = JSON.parse(
    patchPackageJsonContent(
      JSON.stringify({
        name: "AionUi",
        description: "upstream",
        author: { name: "AionUi", email: "service@aionui.com" },
        productName: "AionUi",
      }),
      branding,
    ),
  );

  assert.equal(patched.name, "relay-agent-aionui");
  assert.equal(patched.productName, "Relay Agent");
  assert.equal(patched.author.name, "Relay Agent");
  assert.equal(patched.author.email, undefined);
  assert.match(patched.description, /Microsoft 365 Copilot/);
});

test("patchElectronBuilderContent rebrands installer metadata, protocol, and update target", () => {
  const fixture = [
    "appId: com.aionui.app",
    "productName: AionUi",
    "executableName: AionUi",
    "copyright: Copyright © 2024 AionUi",
    "protocols:",
    "  - name: AionUi Protocol",
    "    schemes:",
    "      - aionui",
    "linux:",
    "  maintainer: aionui",
    "  vendor: aionui",
    "  desktop:",
    "    entry:",
    "      Name: AionUi",
    "      Icon: aionui",
    "      MimeType: x-scheme-handler/aionui;",
    "publish:",
    "  owner: iOfficeAI",
    "  repo: AionUi",
  ].join("\n");

  const patched = patchElectronBuilderContent(fixture, branding);

  assert.match(patched, /^appId: com\.relayagent\.app$/m);
  assert.match(patched, /^productName: Relay Agent$/m);
  assert.match(patched, /^executableName: Relay Agent$/m);
  assert.match(patched, /^  - name: Relay Agent Protocol$/m);
  assert.match(patched, /^      - relay-agent$/m);
  assert.match(patched, /^      MimeType: x-scheme-handler\/relay-agent;$/m);
  assert.match(patched, /^  owner: minimo162$/m);
  assert.match(patched, /^  repo: Relay_Agent$/m);
  assert.doesNotMatch(patched, /AionUi Protocol|x-scheme-handler\/aionui|owner: iOfficeAI/);
});

test("patchDeepLinkContent switches the registered deep-link scheme", () => {
  const patched = patchDeepLinkContent(
    [
      "export const PROTOCOL_SCHEME = 'aionui';",
      " *   1. aionui://add-provider?baseUrl=xxx&apiKey=xxx",
    ].join("\n"),
    branding,
  );

  assert.match(patched, /PROTOCOL_SCHEME = 'relay-agent'/);
  assert.match(patched, /relay-agent:\/\/add-provider/);
  assert.doesNotMatch(patched, /aionui:\/\//);
  assert.doesNotMatch(patched, /an relay-agent:\/\//);
});
