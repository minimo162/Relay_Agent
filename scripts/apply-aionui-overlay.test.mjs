import assert from "node:assert/strict";
import test from "node:test";

import { patchInitStorageContent } from "./apply-aionui-overlay.mjs";

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
