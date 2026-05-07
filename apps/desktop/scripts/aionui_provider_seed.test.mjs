import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyAionuiRelaySeed,
  aionrsBaseUrlForRelay,
  aionuiRelaySeedBundle,
  aionuiRelayConfigSeed,
  aionuiRelayDefaultModel,
  aionuiRelayProviderConfig,
  mergeAionuiModelConfig,
  writeAionuiProviderSeedFile,
} from "./aionui_provider_seed.mjs";

test("AionUi provider seed points to Relay's OpenAI-compatible endpoint", () => {
  const provider = aionuiRelayProviderConfig({
    baseUrl: "http://127.0.0.1:18180/v1",
    apiKey: "relay-test-token",
  });

  assert.equal(provider.id, "relay-agent");
  assert.equal(provider.platform, "custom");
  assert.equal(provider.name, "Relay Agent / M365 Copilot");
  assert.equal(provider.baseUrl, "http://127.0.0.1:18180/v1");
  assert.equal(provider.apiKey, "relay-test-token");
  assert.deepEqual(provider.model, ["m365-copilot"]);
  assert.equal(provider.useModel, "m365-copilot");
  assert.equal(provider.enabled, true);
  assert.equal(provider.modelEnabled["m365-copilot"], true);
  assert.equal(provider.contextLimit, 128000);
  assert.deepEqual(
    provider.capabilities.map((capability) => [capability.type, capability.isUserSelected]),
    [
      ["text", true],
      ["function_calling", true],
    ],
  );
});

test("AionUi config seed disables beginner-hostile surfaces by default", () => {
  const seed = aionuiRelayConfigSeed({
    baseUrl: "http://127.0.0.1:18180/v1",
    apiKey: "relay-test-token",
  });

  assert.equal(seed["model.config"].length, 1);
  assert.deepEqual(seed["aionrs.defaultModel"], {
    id: "relay-agent",
    useModel: "m365-copilot",
  });
  assert.deepEqual(seed["gemini.defaultModel"], seed["aionrs.defaultModel"]);
  assert.equal(seed["webui.desktop.enabled"], false);
  assert.equal(seed["webui.desktop.allowRemote"], false);
  assert.equal(seed["relay.advancedSurfaces.enabled"], false);
  assert.equal(seed["relay.channels.enabled"], false);
  assert.equal(seed["relay.providerOnboarding.enabled"], false);
  assert.equal(seed["relay.remoteAccess.enabled"], false);
  assert.equal(seed["skillsMarket.enabled"], false);
  assert.equal(seed["system.autoPreviewOfficeFiles"], true);
  assert.deepEqual(seed["relay.defaultAssistantPresetIds"], [
    "word-creator",
    "excel-creator",
    "ppt-creator",
  ]);
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-docx"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-xlsx"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-pptx"));
});

test("Relay provider merge replaces only the Relay provider", () => {
  const existing = [
    {
      id: "other-provider",
      platform: "custom",
      name: "Other",
      baseUrl: "https://example.test/v1",
      apiKey: "other",
      model: ["other-model"],
    },
    {
      id: "relay-agent",
      platform: "custom",
      name: "Old Relay",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "old",
      model: ["old-model"],
    },
  ];
  const relay = aionuiRelayProviderConfig({
    baseUrl: "http://127.0.0.1:18180/v1",
    apiKey: "new-token",
  });

  const merged = mergeAionuiModelConfig(existing, relay);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "relay-agent");
  assert.equal(merged[0].apiKey, "new-token");
  assert.equal(merged[1].id, "other-provider");
});

test("Aionrs handoff strips trailing /v1 because aionrs appends the chat path", () => {
  assert.equal(aionrsBaseUrlForRelay("http://127.0.0.1:18180/v1"), "http://127.0.0.1:18180");
  assert.equal(aionrsBaseUrlForRelay("http://127.0.0.1:18180/v1/"), "http://127.0.0.1:18180");
  assert.equal(aionrsBaseUrlForRelay("http://127.0.0.1:18180"), "http://127.0.0.1:18180");
});

test("default model uses AionUi provider id plus Relay model id", () => {
  assert.deepEqual(aionuiRelayDefaultModel(), {
    id: "relay-agent",
    useModel: "m365-copilot",
  });
});

test("seed bundle records provider-before-shell lifecycle contract", () => {
  const seed = aionuiRelaySeedBundle({
    baseUrl: "http://127.0.0.1:18180/v1",
    apiKey: "relay-test-token",
  });

  assert.equal(seed.schemaVersion, 1);
  assert.equal(seed.source, "relay-agent");
  assert.equal(seed.provider.id, "relay-agent");
  assert.equal(seed.defaults["model.config"][0].id, "relay-agent");
  assert.equal(seed.launch.providerBaseUrl, "http://127.0.0.1:18180/v1");
  assert.equal(seed.launch.modelRef, "relay-agent/m365-copilot");
  assert.equal(seed.launch.aionrsBaseUrl, "http://127.0.0.1:18180");
  assert.equal(seed.launch.gatewayMustStartBeforeShell, true);
  assert.deepEqual(
    seed.skills.assistantPresets.map((assistant) => assistant.id),
    ["word-creator", "excel-creator", "ppt-creator"],
  );
  assert.ok(seed.skills.enabledByDefault.includes("officecli-financial-model"));
});

test("seed file writer persists a JSON bundle for the AionUi fork to import", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-aionui-seed-"));
  try {
    const file = join(dir, "seed.json");
    const seed = aionuiRelaySeedBundle({
      baseUrl: "http://127.0.0.1:18180/v1",
      apiKey: "relay-test-token",
    });

    const written = writeAionuiProviderSeedFile(seed, file);
    const parsed = JSON.parse(readFileSync(written, "utf8"));

    assert.equal(written, file);
    assert.equal(parsed.provider.id, "relay-agent");
    assert.equal(parsed.launch.gatewayMustStartBeforeShell, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seed applier makes Relay the selected AionUi provider without dropping unrelated settings", () => {
  const seed = aionuiRelaySeedBundle({
    baseUrl: "http://127.0.0.1:18180/v1",
    apiKey: "relay-test-token",
  });
  const existing = {
    language: "ja-JP",
    theme: "dark",
    "webui.desktop.enabled": true,
    "webui.desktop.allowRemote": true,
    "model.config": [
      {
        id: "other-provider",
        platform: "custom",
        name: "Other",
        baseUrl: "https://example.test/v1",
        apiKey: "other",
        model: ["other-model"],
      },
    ],
  };

  const applied = applyAionuiRelaySeed(existing, seed);

  assert.equal(applied.language, "ja-JP");
  assert.equal(applied.theme, "dark");
  assert.equal(applied["webui.desktop.enabled"], false);
  assert.equal(applied["webui.desktop.allowRemote"], false);
  assert.equal(applied["relay.advancedSurfaces.enabled"], false);
  assert.equal(applied["relay.channels.enabled"], false);
  assert.equal(applied["relay.providerOnboarding.enabled"], false);
  assert.equal(applied["relay.remoteAccess.enabled"], false);
  assert.equal(applied["model.config"][0].id, "relay-agent");
  assert.equal(applied["model.config"][1].id, "other-provider");
  assert.deepEqual(applied["aionrs.defaultModel"], {
    id: "relay-agent",
    useModel: "m365-copilot",
  });
});
