/**
 * Relay Agent integration overlay for AionUi.
 *
 * This file is copied into a Relay-branded AionUi fork. It imports the seed
 * bundle written by Relay before shell startup and applies it to AionUi's
 * ProcessConfig storage.
 */

import { existsSync, readFileSync } from 'fs';

type ConfigStore = {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<any>;
};

type RelaySeedProvider = {
  id: string;
  platform: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  useModel: string;
  enabled?: boolean;
  modelEnabled?: Record<string, boolean>;
  capabilities?: Array<{ type: string; isUserSelected?: boolean }>;
  contextLimit?: number;
};

type RelaySeed = {
  schemaVersion?: number;
  source?: string;
  provider?: RelaySeedProvider;
  defaults?: Record<string, any>;
  skills?: {
    enabledByDefault?: string[];
    assistantPresets?: Array<{
      id: string;
      defaultEnabledSkills?: string[];
    }>;
  };
};

const RELAY_SEED_FILE_ENV = 'RELAY_AIONUI_PROVIDER_SEED_FILE';
const RELAY_PROVIDER_ID = 'relay-agent';

function readRelaySeed(): RelaySeed | null {
  const seedPath = process.env[RELAY_SEED_FILE_ENV]?.trim();
  if (!seedPath || !existsSync(seedPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(seedPath, 'utf8')) as RelaySeed;
    if (parsed?.source !== RELAY_PROVIDER_ID || !parsed.provider?.id) return null;
    return parsed;
  } catch (error) {
    console.warn('[RelaySeed] Failed to read Relay provider seed:', error);
    return null;
  }
}

function mergeRelayProvider(existingProviders: unknown, relayProvider: RelaySeedProvider): RelaySeedProvider[] {
  const existing = Array.isArray(existingProviders) ? existingProviders : [];
  return [
    relayProvider,
    ...existing.filter((provider) => {
      if (!provider || typeof provider !== 'object') return false;
      return (provider as { id?: unknown }).id !== relayProvider.id;
    }),
  ];
}

export async function applyRelayProviderSeed(configFile: ConfigStore): Promise<void> {
  const seed = readRelaySeed();
  if (!seed?.provider) return;

  const existingProviders = await configFile.get('model.config').catch(() => []);
  await configFile.set('model.config', mergeRelayProvider(existingProviders, seed.provider));

  const defaults = seed.defaults && typeof seed.defaults === 'object' ? seed.defaults : {};
  const keysToForce = [
    'aionrs.defaultModel',
    'gemini.defaultModel',
    'webui.desktop.enabled',
    'webui.desktop.allowRemote',
    'skillsMarket.enabled',
    'system.autoPreviewOfficeFiles',
  ];

  for (const key of keysToForce) {
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      await configFile.set(key, defaults[key]);
    }
  }

  await configFile.set('migration.relayProviderSeedApplied', seed.schemaVersion ?? 1);
}

export async function applyRelayAssistantSeed(configFile: ConfigStore): Promise<void> {
  const seed = readRelaySeed();
  const assistantPresets = seed?.skills?.assistantPresets;
  if (!assistantPresets?.length) return;

  const assistants = (await configFile.get('assistants').catch(() => [])) || [];
  if (!Array.isArray(assistants) || assistants.length === 0) return;

  const presetById = new Map(assistantPresets.map((preset) => [`builtin-${preset.id}`, preset]));
  let changed = false;
  const updated = assistants.map((assistant) => {
    const preset = presetById.get(assistant?.id);
    if (!preset) return assistant;

    const next = {
      ...assistant,
      enabled: true,
      presetAgentType: assistant.presetAgentType ?? 'aionrs',
      enabledSkills:
        preset.defaultEnabledSkills && preset.defaultEnabledSkills.length > 0
          ? preset.defaultEnabledSkills
          : assistant.enabledSkills,
    };

    if (JSON.stringify(next) !== JSON.stringify(assistant)) changed = true;
    return next;
  });

  if (changed) {
    await configFile.set('assistants', updated);
  }
  await configFile.set('migration.relayAssistantSeedApplied', seed.schemaVersion ?? 1);
}
