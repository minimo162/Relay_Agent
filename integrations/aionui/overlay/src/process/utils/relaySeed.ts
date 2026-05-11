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

type RelayAssistantCatalog = {
  mode?: string;
  visiblePresetIds?: string[];
  hiddenPresetIds?: string[];
  hideUnlistedBuiltinPresets?: boolean;
  beginnerTaskLabels?: string[];
  advancedAccess?: string;
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
      assistant?: Record<string, any>;
    }>;
    assistantCatalog?: RelayAssistantCatalog;
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
    'relay.advancedSurfaces.enabled',
    'relay.channels.enabled',
    'relay.providerOnboarding.enabled',
    'relay.remoteAccess.enabled',
    'relay.workspaceSearch.enabled',
    'relay.workspaceSearch.surface',
    'relay.workspaceSearch.integrationMode',
    'relay.workspaceSearch.rendererPolicy',
    'relay.workspaceSearch.defaultSkillEntrypoints',
    'relay.workspaceSearch.highLevelTool',
    'relay.workspaceSearch.legacyDiagnosticShell',
    'relay.workspaceSearch.hiddenBeginnerTerms',
    'relay.aionuiUx.integrationMode',
    'relay.aionuiUx.primaryEntrypoint',
    'relay.aionuiUx.searchEntrypoints',
    'relay.aionuiUx.reusedSurfaces',
    'relay.aionuiUx.resultPlacement',
    'relay.aionuiUx.noNewSearchShell',
    'relay.aionuiUx.noFullAssistantGalleryDefault',
    'relay.guidUx.mode',
    'relay.guidUx.primarySurface',
    'relay.guidUx.beginnerFlowSteps',
    'relay.guidUx.requiredControls',
    'relay.guidUx.defaultTaskEntries',
    'relay.guidUx.primaryCta',
    'relay.guidUx.startAction',
    'relay.guidUx.noStandaloneSearchStartButton',
    'relay.guidUx.examplePromptStrategy',
    'relay.guidUx.examplePrompts',
    'relay.guidUx.allowSkipTutorial',
    'relay.guidUx.noForcedTour',
    'relay.searchUx.stateLabels',
    'relay.searchUx.noResultsGuidance',
    'relay.searchUx.resultCardFields',
    'relay.searchUx.resultCardActions',
    'relay.searchUx.resultBatching',
    'relay.searchUx.emptyStateActions',
    'relay.searchUx.defaultSearchMode',
    'relay.searchUx.quickCandidateMode',
    'relay.searchUx.confirmedResultRequirement',
    'relay.searchUx.queryPlanning',
    'relay.searchUx.autocomplete',
    'relay.searchUx.progressiveDisclosure',
    'relay.searchUx.answerBoundary',
    'relay.beginnerUx.visibleSettingsTabs',
    'relay.beginnerUx.hiddenSettingsTabs',
    'relay.beginnerUx.hiddenSurfaces',
    'relay.beginnerUx.hideSkillsMarketBanner',
    'relay.beginnerUx.hideModelAndModeSwitchers',
    'relay.beginnerUx.hideExtensionSettings',
    'relay.beginnerUx.advancedSurfacesGate',
    'skillsMarket.enabled',
    'system.autoPreviewOfficeFiles',
    'tools.useRipgrep',
    'relay.defaultEnabledSkills',
    'relay.defaultAssistantPresetIds',
    'relay.assistantCatalog.mode',
    'relay.assistantCatalog.visiblePresetIds',
    'relay.assistantCatalog.hiddenPresetIds',
    'relay.assistantCatalog.hideUnlistedBuiltinPresets',
    'relay.assistantCatalog.beginnerTaskLabels',
    'relay.assistantCatalog.advancedAccess',
  ];

  for (const key of keysToForce) {
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      await configFile.set(key, defaults[key]);
    }
  }

  await configFile.set('migration.relayProviderSeedApplied', seed.schemaVersion ?? 1);
}

function builtinPresetId(assistant: unknown): string | null {
  if (!assistant || typeof assistant !== 'object') return null;
  const id = (assistant as { id?: unknown }).id;
  if (typeof id !== 'string' || !id.startsWith('builtin-')) return null;
  return id.slice('builtin-'.length);
}

export async function applyRelayAssistantSeed(configFile: ConfigStore): Promise<void> {
  const seed = readRelaySeed();
  const assistantPresets = seed?.skills?.assistantPresets;
  if (!assistantPresets?.length) return;

  const assistants = (await configFile.get('assistants').catch(() => [])) || [];
  if (!Array.isArray(assistants)) return;

  const assistantCatalog = seed.skills?.assistantCatalog;
  const visiblePresetIds = new Set(
    assistantCatalog?.visiblePresetIds?.length
      ? assistantCatalog.visiblePresetIds
      : assistantPresets.map((preset) => preset.id),
  );
  const hiddenPresetIds = new Set(assistantCatalog?.hiddenPresetIds ?? []);
  const hideUnlistedBuiltinPresets = assistantCatalog?.hideUnlistedBuiltinPresets === true;
  const presetById = new Map<string, (typeof assistantPresets)[number]>();
  for (const preset of assistantPresets) {
    presetById.set(`builtin-${preset.id}`, preset);
    if (preset.assistant?.id && typeof preset.assistant.id === 'string') {
      presetById.set(preset.assistant.id, preset);
    }
  }
  let changed = false;
  const updated = assistants.map((assistant) => {
    const preset = presetById.get(assistant?.id);
    if (!preset) {
      const assistantId = typeof assistant?.id === 'string' ? assistant.id : null;
      if (assistantId && hiddenPresetIds.has(assistantId)) {
        const next = {
          ...assistant,
          enabled: false,
        };
        if (JSON.stringify(next) !== JSON.stringify(assistant)) changed = true;
        return next;
      }

      const presetId = builtinPresetId(assistant);
      if (
        !presetId ||
        (!hiddenPresetIds.has(presetId) && (!hideUnlistedBuiltinPresets || visiblePresetIds.has(presetId)))
      ) {
        return assistant;
      }

      const next = {
        ...assistant,
        enabled: false,
      };
      if (JSON.stringify(next) !== JSON.stringify(assistant)) changed = true;
      return next;
    }

    const next = {
      ...assistant,
      ...(preset.assistant ?? {}),
      enabled: true,
      isPreset: preset.assistant?.isPreset ?? assistant.isPreset ?? true,
      isBuiltin: preset.assistant?.isBuiltin ?? assistant.isBuiltin,
      presetAgentType: assistant.presetAgentType ?? preset.assistant?.presetAgentType ?? 'aionrs',
      enabledSkills:
        preset.defaultEnabledSkills && preset.defaultEnabledSkills.length > 0
          ? preset.defaultEnabledSkills
          : assistant.enabledSkills,
    };

    if (JSON.stringify(next) !== JSON.stringify(assistant)) changed = true;
    return next;
  });

  const existingIds = new Set(updated.map((assistant) => assistant?.id).filter((id) => typeof id === 'string'));
  for (const preset of assistantPresets) {
    if (!preset.assistant?.id || typeof preset.assistant.id !== 'string') continue;
    if (existingIds.has(preset.assistant.id)) continue;
    updated.push({
      ...preset.assistant,
      enabled: true,
      isPreset: preset.assistant.isPreset ?? true,
      isBuiltin: preset.assistant.isBuiltin ?? false,
      presetAgentType: preset.assistant.presetAgentType ?? 'aionrs',
      enabledSkills:
        preset.defaultEnabledSkills && preset.defaultEnabledSkills.length > 0
          ? preset.defaultEnabledSkills
          : preset.assistant.enabledSkills,
    });
    existingIds.add(preset.assistant.id);
    changed = true;
  }

  if (changed) {
    await configFile.set('assistants', updated);
  }
  await configFile.set('migration.relayAssistantSeedApplied', seed.schemaVersion ?? 1);
}
