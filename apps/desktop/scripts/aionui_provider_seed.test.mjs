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
  AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS,
  AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES,
  AIONUI_RELAY_BEGINNER_TASK_LABELS,
  AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS,
  AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES,
  AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS,
  AIONUI_RELAY_DEFAULT_ASSISTANTS,
  AIONUI_RELAY_DEFAULT_SKILLS,
  AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS,
  AIONUI_RELAY_GUID_EXAMPLE_PROMPTS,
  AIONUI_RELAY_GUID_REQUIRED_CONTROLS,
  AIONUI_RELAY_GUID_START_ACTION,
  AIONUI_RELAY_HIDDEN_ASSISTANT_PRESET_IDS,
  AIONUI_RELAY_QUERY_PLANNING,
  AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS,
  AIONUI_RELAY_SEARCH_RESULT_BATCHING,
  AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS,
  AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS,
  AIONUI_RELAY_SEARCH_STATE_LABELS,
  AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS,
  AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS,
  AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS,
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
  assert.equal(seed["relay.workspaceSearch.enabled"], true);
  assert.equal(seed["relay.workspaceSearch.surface"], "aionui");
  assert.equal(seed["relay.workspaceSearch.integrationMode"], "skills-first");
  assert.equal(seed["relay.workspaceSearch.rendererPolicy"], "lightweight-aionui-result-renderers");
  assert.deepEqual(
    seed["relay.workspaceSearch.defaultSkillEntrypoints"],
    [...AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS],
  );
  assert.equal(seed["relay.workspaceSearch.legacyDiagnosticShell"], false);
  assert.deepEqual(
    seed["relay.workspaceSearch.hiddenBeginnerTerms"],
    [...AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
  );
  assert.equal(seed["relay.aionuiUx.integrationMode"], "reuse-core-conversation-workspace-preview");
  assert.equal(seed["relay.aionuiUx.primaryEntrypoint"], "guid-page-task-launcher");
  assert.deepEqual(seed["relay.aionuiUx.searchEntrypoints"], [
    ...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS,
  ]);
  assert.deepEqual(seed["relay.aionuiUx.reusedSurfaces"], [
    ...AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES,
  ]);
  assert.equal(seed["relay.aionuiUx.resultPlacement"], "chat-message-plus-preview-panel");
  assert.equal(seed["relay.aionuiUx.noNewSearchShell"], true);
  assert.equal(seed["relay.aionuiUx.noFullAssistantGalleryDefault"], true);
  assert.equal(seed["relay.guidUx.mode"], "curated-task-launcher");
  assert.equal(seed["relay.guidUx.primarySurface"], "GuidPage");
  assert.deepEqual(seed["relay.guidUx.beginnerFlowSteps"], [
    ...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS,
  ]);
  assert.deepEqual(seed["relay.guidUx.requiredControls"], [
    ...AIONUI_RELAY_GUID_REQUIRED_CONTROLS,
  ]);
  assert.deepEqual(seed["relay.guidUx.defaultTaskEntries"], [
    ...AIONUI_RELAY_BEGINNER_TASK_LABELS,
  ]);
  assert.equal(seed["relay.guidUx.primaryCta"], "aionui-normal-send-flow");
  assert.deepEqual(seed["relay.guidUx.startAction"], {
    ...AIONUI_RELAY_GUID_START_ACTION,
  });
  assert.equal(seed["relay.taskMode.required"], true);
  assert.deepEqual(seed["relay.taskMode.allowedModes"], ["document_search", "office_edit"]);
  assert.equal(seed["relay.taskMode.modeByAssistantId"]["relay-workspace-search"], "document_search");
  assert.equal(seed["relay.taskMode.modeByAssistantId"]["relay-office-edit"], "office_edit");
  assert.equal(seed["relay.taskMode.sendWithoutMode"], "blocked");
  assert.equal(seed["relay.taskMode.promptTemplates"].document_search.defaultArguments.maxResults, 120);
  assert.equal(seed["relay.documentSearch.candidateFirst"], true);
  assert.equal(seed["relay.documentSearch.candidateLimit"], 120);
  assert.equal(seed["relay.documentSearch.displayLimit"], 30);
  assert.equal(seed["relay.documentSearch.deferContentExtractionByDefault"], true);
  assert.equal(seed["relay.documentSearch.continuation"], "show-more-results");
  assert.equal(seed["relay.guidUx.noStandaloneSearchStartButton"], true);
  assert.equal(seed["relay.guidUx.examplePromptStrategy"], "task-aware-recent-and-popular");
  assert.deepEqual(seed["relay.guidUx.examplePrompts"], [
    ...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS,
  ]);
  assert.equal(seed["relay.guidUx.allowSkipTutorial"], true);
  assert.equal(seed["relay.guidUx.noForcedTour"], true);
  assert.deepEqual(seed["relay.searchUx.stateLabels"], [
    ...AIONUI_RELAY_SEARCH_STATE_LABELS,
  ]);
  assert.equal(seed["relay.searchUx.noResultsGuidance"], true);
  assert.deepEqual(seed["relay.searchUx.resultCardFields"], [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS,
  ]);
  assert.deepEqual(seed["relay.searchUx.resultCardActions"], [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS,
  ]);
  assert.deepEqual(seed["relay.searchUx.resultBatching"], {
    ...AIONUI_RELAY_SEARCH_RESULT_BATCHING,
  });
  assert.deepEqual(seed["relay.searchUx.emptyStateActions"], [
    ...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS,
  ]);
  assert.equal(seed["relay.searchUx.defaultSearchMode"], "thorough");
  assert.equal(seed["relay.searchUx.quickCandidateMode"], "progress-only");
  assert.equal(seed["relay.searchUx.confirmedResultRequirement"], "content-or-evidence-backed");
  assert.deepEqual(seed["relay.searchUx.queryPlanning"], {
    ...AIONUI_RELAY_QUERY_PLANNING,
  });
  assert.equal(seed["relay.searchUx.autocomplete"], "debounced-suggestions");
  assert.equal(seed["relay.searchUx.progressiveDisclosure"], "status-chip-to-details-drawer");
  assert.equal(seed["relay.searchUx.answerBoundary"], "candidate-until-evidence-backed");
  assert.deepEqual(seed["relay.beginnerUx.visibleSettingsTabs"], [
    ...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS,
  ]);
  assert.deepEqual(seed["relay.beginnerUx.hiddenSettingsTabs"], [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS,
  ]);
  assert.deepEqual(seed["relay.beginnerUx.hiddenSurfaces"], [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES,
  ]);
  assert.ok(seed["relay.beginnerUx.hiddenSurfaces"].includes("assistant-preset-add-button"));
  assert.ok(seed["relay.beginnerUx.hiddenSurfaces"].includes("guid-auto-skills-menu"));
  assert.ok(seed["relay.beginnerUx.hiddenSurfaces"].includes("preset-agent-backend-switcher"));
  assert.equal(seed["relay.beginnerUx.hideSkillsMarketBanner"], true);
  assert.equal(seed["relay.beginnerUx.hideModelAndModeSwitchers"], true);
  assert.equal(seed["relay.beginnerUx.hideExtensionSettings"], true);
  assert.equal(seed["relay.beginnerUx.advancedSurfacesGate"], "relay.advancedSurfaces.enabled");
  assert.equal(seed["skillsMarket.enabled"], false);
  assert.equal(seed["system.autoPreviewOfficeFiles"], true);
  assert.equal(seed["tools.useRipgrep"], true);
  assert.deepEqual(
    seed["relay.defaultAssistantPresetIds"],
    AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
  );
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-docx"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-xlsx"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("officecli-pptx"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("relay-document-search"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("workspace-search"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("find-files"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("read-office-file"));
  assert.ok(seed["relay.defaultEnabledSkills"].includes("summarize-with-evidence"));
  assert.ok(!seed["relay.defaultEnabledSkills"].includes("officecli-financial-model"));
  assert.equal(seed["relay.assistantCatalog.mode"], "curated");
  assert.deepEqual(seed["relay.assistantCatalog.visiblePresetIds"], [
    ...AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS,
  ]);
  assert.ok(seed["relay.assistantCatalog.hiddenPresetIds"].includes("cowork"));
  assert.ok(seed["relay.assistantCatalog.hiddenPresetIds"].includes("openclaw-setup"));
  assert.equal(seed["relay.assistantCatalog.hideUnlistedBuiltinPresets"], true);
  assert.deepEqual(seed["relay.assistantCatalog.beginnerTaskLabels"], [
    ...AIONUI_RELAY_BEGINNER_TASK_LABELS,
  ]);
  assert.equal(seed["relay.assistantCatalog.advancedAccess"], "advanced-only");
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
    AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
  );
  assert.deepEqual(seed.skills.enabledByDefault, [...AIONUI_RELAY_DEFAULT_SKILLS]);
  const workspaceSearchPreset = seed.skills.assistantPresets.find(
    (assistant) => assistant.id === "relay-workspace-search",
  );
  assert.equal(workspaceSearchPreset.assistant.nameI18n["ja-JP"], "資料を探す");
  assert.equal(workspaceSearchPreset.assistant.presetAgentType, "aionrs");
  assert.match(workspaceSearchPreset.assistant.context, /RELAY_TASK_MODE: document_search/);
  assert.deepEqual(workspaceSearchPreset.assistant.enabledSkills, [
    "relay-document-search",
    "workspace-search",
    "find-files",
    "read-office-file",
    "summarize-with-evidence",
  ]);
  const officeEditPreset = seed.skills.assistantPresets.find(
    (assistant) => assistant.id === "relay-office-edit",
  );
  assert.equal(officeEditPreset.assistant.nameI18n["ja-JP"], "Officeファイルを編集する");
  assert.match(officeEditPreset.assistant.context, /RELAY_TASK_MODE: office_edit/);
  assert.deepEqual(officeEditPreset.assistant.enabledSkills, [
    "officecli-docx",
    "officecli-xlsx",
    "officecli-pptx",
  ]);
  assert.equal(
    seed.skills.assistantPresets.some((assistant) => assistant.id === "relay-grounded-summary"),
    false,
  );
  assert.deepEqual(seed.skills.assistantCatalog.visiblePresetIds, [
    ...AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS,
  ]);
  assert.deepEqual(seed.skills.assistantCatalog.hiddenPresetIds, [
    ...AIONUI_RELAY_HIDDEN_ASSISTANT_PRESET_IDS,
  ]);
  assert.equal(seed.skills.assistantCatalog.hideUnlistedBuiltinPresets, true);
  assert.deepEqual(seed.ux.aionUiCore.primaryEntrypoint, "guid-page-task-launcher");
  assert.deepEqual(seed.ux.aionUiCore.searchEntrypoints, [
    ...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS,
  ]);
  assert.deepEqual(seed.ux.guidBeginnerFlow.flowSteps, [
    ...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS,
  ]);
  assert.deepEqual(seed.ux.guidBeginnerFlow.requiredControls, [
    ...AIONUI_RELAY_GUID_REQUIRED_CONTROLS,
  ]);
  assert.deepEqual(seed.ux.guidBeginnerFlow.examplePrompts, [
    ...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS,
  ]);
  assert.deepEqual(seed.ux.taskMode.allowedModes, ["document_search", "office_edit"]);
  assert.equal(seed.ux.taskMode.sendWithoutMode, "blocked");
  assert.equal(seed.ux.taskMode.promptTemplates.document_search.defaultArguments.maxResults, 120);
  assert.deepEqual(seed.ux.search.states, [...AIONUI_RELAY_SEARCH_STATE_LABELS]);
  assert.deepEqual(seed.ux.search.resultCardFields, [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS,
  ]);
  assert.deepEqual(seed.ux.search.resultCardActions, [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS,
  ]);
  assert.deepEqual(seed.ux.search.resultBatching, {
    ...AIONUI_RELAY_SEARCH_RESULT_BATCHING,
  });
  assert.deepEqual(seed.ux.search.emptyStateActions, [
    ...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS,
  ]);
  assert.equal(seed.ux.search.defaultSearchMode, "thorough");
  assert.equal(seed.ux.search.quickCandidateMode, "progress-only");
  assert.equal(seed.ux.search.confirmedResultRequirement, "content-or-evidence-backed");
  assert.equal(seed.ux.search.candidateFirst, true);
  assert.equal(seed.ux.search.candidateLimit, 120);
  assert.equal(seed.ux.search.displayLimit, 30);
  assert.equal(seed.ux.search.deferContentExtractionByDefault, true);
  assert.equal(seed.ux.search.continuation, "show-more-results");
  assert.deepEqual(seed.ux.search.queryPlanning, {
    ...AIONUI_RELAY_QUERY_PLANNING,
  });
  assert.deepEqual(seed.ux.beginnerVisibility.visibleSettingsTabs, [
    ...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS,
  ]);
  assert.deepEqual(seed.ux.beginnerVisibility.hiddenSettingsTabs, [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS,
  ]);
  assert.deepEqual(seed.ux.beginnerVisibility.hiddenSurfaces, [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES,
  ]);
  assert.ok(seed.ux.beginnerVisibility.hiddenSurfaces.includes("assistant-preset-add-button"));
  assert.ok(seed.ux.beginnerVisibility.hiddenSurfaces.includes("preset-agent-backend-switcher"));
  assert.equal(seed.ux.beginnerVisibility.advancedSurfacesGate, "relay.advancedSurfaces.enabled");
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
  assert.equal(applied["relay.workspaceSearch.enabled"], true);
  assert.equal(applied["relay.workspaceSearch.surface"], "aionui");
  assert.equal(applied["relay.workspaceSearch.integrationMode"], "skills-first");
  assert.equal(applied["relay.workspaceSearch.rendererPolicy"], "lightweight-aionui-result-renderers");
  assert.deepEqual(
    applied["relay.workspaceSearch.defaultSkillEntrypoints"],
    [...AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS],
  );
  assert.equal(applied["relay.workspaceSearch.legacyDiagnosticShell"], false);
  assert.deepEqual(
    applied["relay.workspaceSearch.hiddenBeginnerTerms"],
    [...AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
  );
  assert.equal(applied["relay.aionuiUx.integrationMode"], "reuse-core-conversation-workspace-preview");
  assert.deepEqual(applied["relay.aionuiUx.searchEntrypoints"], [
    ...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS,
  ]);
  assert.deepEqual(applied["relay.aionuiUx.reusedSurfaces"], [
    ...AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES,
  ]);
  assert.equal(applied["relay.aionuiUx.noNewSearchShell"], true);
  assert.equal(applied["relay.guidUx.primarySurface"], "GuidPage");
  assert.deepEqual(applied["relay.guidUx.beginnerFlowSteps"], [
    ...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS,
  ]);
  assert.deepEqual(applied["relay.guidUx.requiredControls"], [
    ...AIONUI_RELAY_GUID_REQUIRED_CONTROLS,
  ]);
  assert.deepEqual(applied["relay.guidUx.examplePrompts"], [
    ...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS,
  ]);
  assert.equal(applied["relay.taskMode.required"], true);
  assert.deepEqual(applied["relay.taskMode.allowedModes"], ["document_search", "office_edit"]);
  assert.equal(applied["relay.taskMode.modeByAssistantId"]["relay-workspace-search"], "document_search");
  assert.equal(applied["relay.taskMode.modeByAssistantId"]["relay-office-edit"], "office_edit");
  assert.equal(applied["relay.taskMode.sendWithoutMode"], "blocked");
  assert.equal(applied["relay.documentSearch.candidateFirst"], true);
  assert.equal(applied["relay.documentSearch.candidateLimit"], 120);
  assert.equal(applied["relay.documentSearch.displayLimit"], 30);
  assert.equal(applied["relay.documentSearch.deferContentExtractionByDefault"], true);
  assert.equal(applied["relay.documentSearch.continuation"], "show-more-results");
  assert.deepEqual(applied["relay.searchUx.stateLabels"], [
    ...AIONUI_RELAY_SEARCH_STATE_LABELS,
  ]);
  assert.equal(applied["relay.searchUx.noResultsGuidance"], true);
  assert.deepEqual(applied["relay.searchUx.resultCardFields"], [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS,
  ]);
  assert.deepEqual(applied["relay.searchUx.resultCardActions"], [
    ...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS,
  ]);
  assert.deepEqual(applied["relay.searchUx.resultBatching"], {
    ...AIONUI_RELAY_SEARCH_RESULT_BATCHING,
  });
  assert.deepEqual(applied["relay.searchUx.emptyStateActions"], [
    ...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS,
  ]);
  assert.equal(applied["relay.searchUx.defaultSearchMode"], "thorough");
  assert.equal(applied["relay.searchUx.quickCandidateMode"], "progress-only");
  assert.equal(applied["relay.searchUx.confirmedResultRequirement"], "content-or-evidence-backed");
  assert.deepEqual(applied["relay.searchUx.queryPlanning"], {
    ...AIONUI_RELAY_QUERY_PLANNING,
  });
  assert.deepEqual(applied["relay.beginnerUx.visibleSettingsTabs"], [
    ...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS,
  ]);
  assert.deepEqual(applied["relay.beginnerUx.hiddenSettingsTabs"], [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS,
  ]);
  assert.deepEqual(applied["relay.beginnerUx.hiddenSurfaces"], [
    ...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES,
  ]);
  assert.ok(applied["relay.beginnerUx.hiddenSurfaces"].includes("assistant-preset-add-button"));
  assert.ok(applied["relay.beginnerUx.hiddenSurfaces"].includes("guid-auto-skills-menu"));
  assert.ok(applied["relay.beginnerUx.hiddenSurfaces"].includes("preset-agent-backend-switcher"));
  assert.equal(applied["relay.beginnerUx.hideSkillsMarketBanner"], true);
  assert.equal(applied["relay.beginnerUx.hideModelAndModeSwitchers"], true);
  assert.deepEqual(applied["relay.defaultEnabledSkills"], [...AIONUI_RELAY_DEFAULT_SKILLS]);
  assert.deepEqual(
    applied["relay.defaultAssistantPresetIds"],
    AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
  );
  assert.equal(applied["relay.assistantCatalog.mode"], "curated");
  assert.deepEqual(applied["relay.assistantCatalog.visiblePresetIds"], [
    ...AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS,
  ]);
  assert.ok(applied["relay.assistantCatalog.hiddenPresetIds"].includes("moltbook"));
  assert.equal(applied["relay.assistantCatalog.hideUnlistedBuiltinPresets"], true);
  assert.equal(applied["model.config"][0].id, "relay-agent");
  assert.equal(applied["model.config"][1].id, "other-provider");
  assert.deepEqual(applied["aionrs.defaultModel"], {
    id: "relay-agent",
    useModel: "m365-copilot",
  });
});
