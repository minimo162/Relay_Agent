import {
  chmodSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  MODEL_ID,
  PROVIDER_ID,
  providerBaseURL,
  providerPort,
  readOrCreateToken,
} from "./opencode_provider_config.mjs";

export const AIONUI_RELAY_PROVIDER_NAME = "Relay Agent / M365 Copilot";
export const AIONUI_RELAY_PLATFORM = "custom";
export const AIONUI_RELAY_CONTEXT_LIMIT = 128000;
export const AIONUI_RELAY_SEED_SCHEMA_VERSION = 1;
export const AIONUI_RELAY_DEFAULT_SKILLS = Object.freeze([
  "officecli-docx",
  "officecli-xlsx",
  "officecli-pptx",
  "officecli-financial-model",
  "officecli-data-dashboard",
]);
export const AIONUI_RELAY_DEFAULT_ASSISTANTS = Object.freeze([
  {
    id: "word-creator",
    defaultEnabledSkills: ["officecli-docx"],
  },
  {
    id: "excel-creator",
    defaultEnabledSkills: ["officecli-xlsx"],
  },
  {
    id: "ppt-creator",
    defaultEnabledSkills: ["officecli-pptx"],
  },
]);

export function aionuiRelayProviderConfig({
  baseUrl = providerBaseURL(providerPort()),
  apiKey,
} = {}) {
  const resolvedApiKey = apiKey ?? readOrCreateToken().token;
  return {
    id: PROVIDER_ID,
    platform: AIONUI_RELAY_PLATFORM,
    name: AIONUI_RELAY_PROVIDER_NAME,
    baseUrl,
    apiKey: resolvedApiKey,
    model: [MODEL_ID],
    useModel: MODEL_ID,
    enabled: true,
    modelEnabled: {
      [MODEL_ID]: true,
    },
    capabilities: [
      {
        type: "text",
        isUserSelected: true,
      },
      {
        type: "function_calling",
        isUserSelected: true,
      },
    ],
    contextLimit: AIONUI_RELAY_CONTEXT_LIMIT,
  };
}

export function aionuiRelayDefaultModel() {
  return {
    id: PROVIDER_ID,
    useModel: MODEL_ID,
  };
}

export function aionuiRelayConfigSeed({
  baseUrl = providerBaseURL(providerPort()),
  apiKey,
} = {}) {
  const provider = aionuiRelayProviderConfig({ baseUrl, apiKey });
  return {
    "model.config": [provider],
    "aionrs.defaultModel": aionuiRelayDefaultModel(),
    "gemini.defaultModel": aionuiRelayDefaultModel(),
    "webui.desktop.enabled": false,
    "webui.desktop.allowRemote": false,
    "skillsMarket.enabled": false,
    "system.autoPreviewOfficeFiles": true,
    "relay.defaultEnabledSkills": [...AIONUI_RELAY_DEFAULT_SKILLS],
    "relay.defaultAssistantPresetIds": AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
  };
}

export function aionuiRelaySeedBundle({
  baseUrl = providerBaseURL(providerPort()),
  apiKey,
} = {}) {
  return {
    schemaVersion: AIONUI_RELAY_SEED_SCHEMA_VERSION,
    source: "relay-agent",
    provider: aionuiRelayProviderConfig({ baseUrl, apiKey }),
    defaults: aionuiRelayConfigSeed({ baseUrl, apiKey }),
    launch: {
      providerBaseUrl: baseUrl,
      modelRef: `${PROVIDER_ID}/${MODEL_ID}`,
      aionrsBaseUrl: aionrsBaseUrlForRelay(baseUrl),
      gatewayMustStartBeforeShell: true,
    },
    skills: {
      enabledByDefault: [...AIONUI_RELAY_DEFAULT_SKILLS],
      assistantPresets: AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => ({
        id: assistant.id,
        defaultEnabledSkills: [...assistant.defaultEnabledSkills],
      })),
    },
  };
}

export function aionuiProviderSeedFilePath() {
  return (
    process.env.RELAY_AIONUI_PROVIDER_SEED_FILE ||
    join(homedir(), ".relay-agent", "aionui-provider-seed.json")
  );
}

export function writeAionuiProviderSeedFile(seed, filePath = aionuiProviderSeedFilePath()) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return filePath;
}

export function mergeAionuiModelConfig(existingProviders, relayProvider = aionuiRelayProviderConfig()) {
  const existing = Array.isArray(existingProviders) ? existingProviders : [];
  const withoutRelay = existing.filter((provider) => provider?.id !== PROVIDER_ID);
  return [relayProvider, ...withoutRelay];
}

export function applyAionuiRelaySeed(existingConfig, seed = aionuiRelaySeedBundle()) {
  const base =
    existingConfig && typeof existingConfig === "object" && !Array.isArray(existingConfig)
      ? { ...existingConfig }
      : {};
  const provider = seed.provider ?? aionuiRelayProviderConfig();
  const defaults = seed.defaults && typeof seed.defaults === "object" ? seed.defaults : {};

  return {
    ...base,
    ...defaults,
    "model.config": mergeAionuiModelConfig(base["model.config"], provider),
    "aionrs.defaultModel": seed.defaults?.["aionrs.defaultModel"] ?? aionuiRelayDefaultModel(),
    "gemini.defaultModel": seed.defaults?.["gemini.defaultModel"] ?? aionuiRelayDefaultModel(),
    "webui.desktop.enabled": false,
    "webui.desktop.allowRemote": false,
  };
}

export function aionrsBaseUrlForRelay(baseUrl = providerBaseURL(providerPort())) {
  return String(baseUrl).replace(/\/v1\/?$/, "");
}
