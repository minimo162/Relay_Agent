import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS } from "./aionui_provider_seed.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(scriptDir, "../src-tauri/bootstrap/aionui-relay.json");

function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

test("AionUi Relay manifest pins exact upstream source baselines", () => {
  const manifest = loadManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.selectedTrack, "windows-x64-aionui-relay-officecli");
  assert.match(manifest.ownershipBoundary, /Relay-branded AionUi owns UX/);
  assert.match(manifest.ownershipBoundary, /lightweight Workspace Document Search result presentation/);
  assert.match(manifest.ownershipBoundary, /AionUi seed\/bridge contracts/);
  assert.match(manifest.ownershipBoundary, /status translation/);
  assert.match(manifest.ownershipBoundary, /evidence validation boundaries/);

  assert.equal(manifest.upstreams.aionUi.repository, "https://github.com/iOfficeAI/AionUi");
  assert.equal(manifest.upstreams.aionUi.version, "1.9.25");
  assert.equal(manifest.upstreams.aionUi.tag, "v1.9.25");
  assert.equal(manifest.upstreams.aionUi.commit, "bbada2a9268060d2b41ddf1d885a9b27ecd2103d");
  assert.equal(manifest.upstreams.aionUi.license, "Apache-2.0");

  assert.equal(manifest.upstreams.officeCli.repository, "https://github.com/iOfficeAI/OfficeCLI");
  assert.equal(manifest.upstreams.officeCli.version, "1.0.76");
  assert.equal(manifest.upstreams.officeCli.tag, "v1.0.76");
  assert.equal(manifest.upstreams.officeCli.commit, "958717ea25351b8920a3d8313d46e08b24b9c95b");
  assert.equal(manifest.upstreams.officeCli.license, "Apache-2.0");
});

test("AionUi Relay manifest pins admin-free OfficeCLI Windows artifact", () => {
  const manifest = loadManifest();
  const officeCli = manifest.upstreams.officeCli;
  const artifact = officeCli.artifacts["windows-x64"];

  assert.equal(officeCli.installMode, "relay-managed-portable-user-local");
  assert.equal(artifact.name, "officecli-win-x64.exe");
  assert.equal(artifact.kind, "binary");
  assert.equal(artifact.format, "exe");
  assert.equal(
    artifact.url,
    "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.76/officecli-win-x64.exe",
  );
  assert.equal(artifact.sha256, "f9e4895505858ab813e133d4d1f9f01004c7b4b08397408487f534caf9e2ec58");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.size, 30433916);
  assert.equal(artifact.entrypoint, "officecli.exe");
});

test("AionUi Relay manifest fixes Relay provider seed and disabled defaults", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.providerSeed, {
    id: "relay-agent",
    platform: "custom",
    name: "Relay Agent / M365 Copilot",
    baseUrlTemplate: "http://127.0.0.1:${port}/v1",
    apiKeySource: "Relay local provider token",
    model: "m365-copilot",
    displayModelRef: "relay-agent/m365-copilot",
    capabilities: ["text", "function_calling"],
    contextLimit: 128000,
  });

  assert.ok(manifest.disabledByDefault.includes("remote access"));
  assert.ok(manifest.disabledByDefault.includes("channel bots"));
  assert.ok(manifest.disabledByDefault.includes("manual provider onboarding"));
  assert.ok(manifest.disabledByDefault.includes("OpenWork handoff"));
  assert.ok(manifest.disabledByDefault.includes("OpenCode Web first-run launcher"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-docx"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-xlsx"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-pptx"));
  assert.ok(manifest.enabledByDefaultSkills.includes("relay-document-search"));
  assert.ok(manifest.enabledByDefaultSkills.includes("workspace-search"));
  assert.ok(manifest.enabledByDefaultSkills.includes("find-files"));
  assert.ok(manifest.enabledByDefaultSkills.includes("read-office-file"));
  assert.ok(manifest.enabledByDefaultSkills.includes("summarize-with-evidence"));
  assert.ok(!manifest.enabledByDefaultSkills.includes("officecli-financial-model"));
  assert.ok(!manifest.enabledByDefaultSkills.includes("officecli-data-dashboard"));
});

test("AionUi Relay manifest curates noisy upstream assistant presets", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.assistantCatalog.visiblePresetIds, [
    "relay-workspace-search",
    "relay-office-edit",
  ]);
  assert.deepEqual(manifest.assistantCatalog.relayManagedPresetIds, [
    "relay-workspace-search",
    "relay-office-edit",
  ]);
  assert.equal(manifest.assistantCatalog.mode, "curated");
  assert.equal(manifest.assistantCatalog.hideUnlistedBuiltinPresets, true);
  assert.equal(manifest.assistantCatalog.advancedAccess, "advanced-only");
  assert.deepEqual(manifest.assistantCatalog.beginnerTaskLabels, [
    "資料を探す",
    "Officeファイルを編集する",
  ]);
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("word-creator"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("excel-creator"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("ppt-creator"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("relay-grounded-summary"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("cowork"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("openclaw-setup"));
  assert.ok(manifest.assistantCatalog.hiddenPresetIds.includes("moltbook"));
});

test("AionUi Relay manifest requires one of two beginner task modes", () => {
  const manifest = loadManifest();

  assert.equal(manifest.taskMode.required, true);
  assert.deepEqual(manifest.taskMode.allowedModes, ["document_search", "office_edit"]);
  assert.equal(manifest.taskMode.modeByAssistantId["relay-workspace-search"], "document_search");
  assert.equal(manifest.taskMode.modeByAssistantId["relay-office-edit"], "office_edit");
  assert.equal(manifest.taskMode.sendWithoutMode, "blocked");
  assert.equal(manifest.taskMode.promptTemplates.document_search.firstTool, "relay_document_search");
  assert.equal(manifest.taskMode.promptTemplates.document_search.defaultArguments.maxResults, 120);
  assert.equal(manifest.taskMode.promptTemplates.office_edit.firstTool, "officecli");
});

test("AionUi Relay manifest prevents Workspace Search UX ownership conflicts", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.workspaceSearch, {
    integrationMode: "aionui-skills-relay-bridge-contracts",
    surfaceOwner: "AionUi",
    skillRuntimeOwner: "AionUi",
    bridgeOwner: "Relay",
    contractOwner: "Relay",
    entrypointOwner: "AionUi skills",
    rendererPolicy: "reuse-aionui-chat-preview-history-with-light-result-renderers",
    relayScope: "copilot-provider-bridge-tool-normalization-status-translation-evidence-validation",
    skillEntrypoints: [
      "relay-document-search",
      "workspace-search",
      "find-files",
      "read-office-file",
      "summarize-with-evidence",
    ],
    highLevelTool: {
      name: "relay_document_search",
      approvedAliases: [
        "relay_document_search",
        "relay-document-search",
        "workspace_document_search",
        "workspace-search",
        "find-files",
      ],
      requestContract: "RelayDocumentSearchRequest.v1",
      resultContract: "RelayDocumentSearchResult.v1",
      contractModule: "src/process/utils/relayDocumentSearchContract.ts",
      executorModule: "src/process/utils/relayDocumentSearchExecutor.ts",
      queryPlanModule: "src/process/utils/relayDocumentSearchQueryPlan.ts",
      queryPlanContract: "RelayDocumentSearchQueryPlan.v1",
      queryNormalizerVersion: "relay-query-normalizer-v1",
      metadataCacheModule: "src/process/utils/relayDocumentSearchMetadataCache.ts",
      metadataCacheContract: "RelayDocumentSearchMetadataCache.v1",
      parsedDocumentIrModule: "src/process/utils/relayParsedDocumentIr.ts",
      parsedDocumentIrContract: "RelayParsedDocumentIR.v1",
      parsedDocumentIrVersion: "relay-ir-v1",
      jobLifecycleModule: "src/process/utils/relayDocumentSearchJobLifecycle.ts",
      jobLifecycleContract: "RelayDocumentSearchJobLifecycle.v1",
      jobLifecycleRunnerExport: "runRelayDocumentSearchJob",
      bridgeModule: "src/process/utils/relayDocumentSearchBridge.ts",
      displayModule: "src/process/utils/relayDocumentSearchDisplay.ts",
      displayContract: "RelayDocumentSearchDisplay.v1",
      resultFlowContract: "RelayDocumentSearchResultFlow.v1",
      aionuiResultFlowContract: "RelayDocumentSearchAionUiResultFlow.v1",
      displayAdapterExport: "relayDocumentSearchResultToDisplayModel",
      aionuiResultFlowExport: "relayDocumentSearchExecutionToAionUiResultFlow",
      mcpServerModule: "src/process/utils/relayDocumentSearchMcpStdio.ts",
      mcpServerOutfile: "out/main/relay-document-search-mcp-stdio.js",
      openAiToolSchemaExport: "relayDocumentSearchOpenAiToolSchema",
      bridgeToolDefinitionExport: "relayDocumentSearchBridgeToolDefinition",
      bridgeHandlerExport: "handleRelayDocumentSearchToolCall",
      resultFlowPolicy: {
        rendererOwner: "AionUi",
        structuredResultCardsPrimary: true,
        copilotProseSecondary: true,
        continuationAction: "show-more-results",
        stableSelectionKeyField: "ui_state.stableSelectionKey",
      },
      requiredForBeginnerEntry: true,
      fallbackPolicy: "guarded-low-level-with-visible-warning",
      lowLevelFirstCallPolicy: "reject-before-execution",
      aliasPolicy: "schema-or-result-contract-match-required",
      catalogOwner: "relay-provider-gateway",
      executorOwner: "relay-document-search-executor",
      rendererOwner: "aionui-result-renderer",
      jobContract: "RelayDocumentSearchJob.v1",
      supports: [
        "progress",
        "cancel",
        "retry",
        "duplicate-submit-attachment",
        "timeout-to-partial",
        "cache-delete-on-root-removal",
        "single-writer-store-lock",
        "stale-lock-recovery",
        "shell-free-subprocess-spawn",
        "cache-quota-and-at-rest-protection",
        "schema-upgrade-rollback",
        "windows-long-path-and-sync-provider-policy",
        "warning-code-japanese-copy-map",
        "enterprise-local-only-policy",
        "redacted-local-observability",
        "golden-query-release-gate",
        "feature-flag-promotion-rollback",
        "folder-root-consent",
        "copilot-prompt-template-versioning",
        "copilot-correlation-ids",
        "copilot-session-state-downgrade",
        "citation-bound-polish-validation",
        "single-commit-final-answer",
      ],
    },
    visibleBeginnerLabels: ["検索", "ファイル検索", "根拠つき回答"],
    hiddenBeginnerTerms: [...AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
    legacyDiagnosticShell: "not-production",
  });
});

test("AionUi Relay manifest reuses AionUi core conversation UX", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.aionUiCoreUx, {
    integrationMode: "reuse-core-conversation-workspace-preview",
    primaryEntrypoint: "guid-page-task-launcher",
    searchEntrypoints: [
      "guid-page-assistant-selection",
      "guid-page-input-card",
      "guid-page-workspace-folder-select",
      "conversation-preset-assistant-menu",
      "sendbox-slash-command-menu",
      "sendbox-at-file-mentions",
      "workspace-toolbar-search",
    ],
    reusedSurfaces: [
      "GuidPage",
      "AssistantSelectionArea",
      "GuidInputCard",
      "GuidActionRow",
      "ConversationTabs",
      "SendBox",
      "AtFileMenu",
      "SlashCommandMenu",
      "Workspace",
      "PreviewPanel",
      "ConversationSkillsIndicator",
    ],
    resultPlacement: "chat-message-plus-preview-panel",
    rules: [
      "Do not create a separate Relay document-search page for beginner use.",
      "Use AionUi GuidPage as the beginner task launcher before the conversation view.",
      "Expose search as curated assistant/skill entries, GuidPage input/workspace controls, slash commands, workspace quick filter/status, and preview-linked results.",
      "Keep AionUi GuidPage, conversation tabs, workspace panel, file mentions, command menu, preview panel, and skills indicator as the primary user-facing controls.",
      "Start search through AionUi's normal send flow; do not add a standalone Search Start button.",
      "Treat the Workspace toolbar search as a quick tree/filename filter and compact status affordance, not the broad document-search result surface.",
    ],
  });
});

test("AionUi Relay manifest defines the GuidPage beginner search flow", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.guidBeginnerUx, {
    mode: "curated-task-launcher",
    primarySurface: "GuidPage",
    flow: [
      "choose-curated-task",
      "select-folder-or-use-recent-workspace",
      "use-example-prompt-or-type-request",
      "start-conversation",
      "review-chat-results",
      "open-preview-or-refine",
    ],
    requiredControls: [
      "AssistantSelectionArea",
      "GuidInputCard",
      "GuidActionRow",
      "WorkspaceFolderSelect",
      "QuickActionButtons",
    ],
    primaryCta: "aionui-normal-send-flow",
    startAction: {
      owner: "aionui",
      trigger: "normal-send-flow",
      controls: ["GuidInputCard submit", "GuidActionRow send", "SendBox send"],
      noStandaloneSearchStartButton: true,
    },
    examplePromptStrategy: "task-aware-recent-and-popular",
    examplePrompts: [
      "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
      "報告書ファイルを探して、元資料候補と出力候補に分けて",
      "このExcelファイルの指定セルを編集して",
      "このフォルダの最新の報告書を探して",
      "この資料を開いて要点と根拠ページをまとめて",
    ],
    searchStateLabels: [
      "フォルダ未選択",
      "準備中",
      "候補を表示中",
      "ファイルの中身まで確認中",
      "確認済みの結果",
      "結果なし",
      "一部のみ検索",
      "権限なし",
      "失敗",
    ],
    searchResultCard: {
      fields: [
        "fileType",
        "title",
        "path",
        "modifiedTime",
        "snippet",
        "matchReason",
        "matchMode",
        "evidenceState",
        "indexState",
        "warningState",
      ],
      actions: [
        "preview",
        "open-containing-folder",
        "open-file",
        "copy-path",
        "pin-result",
        "hide-result",
        "use-as-evidence",
        "refine-search",
        "show-more-results",
        "retry-rebuild",
      ],
      batching: {
        strategy: "capped-batches",
        initialBatchSize: 20,
        continuationAction: "show-more-results",
        preserveSelectionAcrossRefresh: true,
        stableSelectionKeyField: "ui_state.stableSelectionKey",
        resultFlowContract: "RelayDocumentSearchResultFlow.v1",
        copilotProse: "secondary",
      },
    },
    emptyStateActions: [
      "select-or-change-folder",
      "broaden-keywords",
      "try-related-terms",
      "clear-extension-filters",
      "show-index-status",
    ],
    answerBoundary: "candidate-until-evidence-backed",
    defaultSearchMode: "thorough",
    quickCandidateMode: "progress-only",
    confirmedResultRequirement: "content-or-evidence-backed",
    candidateFirst: true,
    candidateLimit: 120,
    displayLimit: 30,
    deferContentExtractionByDefault: true,
    continuation: "show-more-results",
    queryPlanning: {
      owner: "relay",
      copilotRole: "suggestions-only",
      acceptedSuggestionTypes: [
        "related-terms",
        "abbreviations",
        "file-type-hints",
        "clarification-questions",
      ],
      immutableWithoutRelayValidation: [
        "roots",
        "budgets",
        "confirmation-policy",
        "coverage-reporting",
      ],
    },
    beginnerVisibility: {
      visibleSettingsTabs: ["about"],
      hiddenSettingsTabs: [
        "gemini",
        "model",
        "agent",
        "tools",
        "webui",
        "system",
        "extension-settings",
      ],
      hiddenSurfaces: [
        "skills-market-banner",
        "full-assistant-gallery",
        "provider-onboarding",
        "model-provider-settings",
        "agent-management",
        "tools-settings",
        "system-dev-settings",
        "remote-webui-settings",
        "channel-bot-settings",
        "extension-settings-tabs",
        "model-switcher",
        "agent-permission-mode-switcher",
        "acp-config-selector",
        "guid-auto-skills-menu",
        "assistant-preset-add-button",
        "settings-button",
        "webui-button",
        "feedback-button",
        "evaluation-button",
        "rating-button",
        "provider-model-selector",
        "assistant-management",
        "skills-market",
        "permission-mode-control",
        "advanced-dev-menus",
        "guid-detected-agent-selector",
        "preset-assistant-edit-button",
        "preset-agent-backend-switcher",
        "assistant-edit-drawer-entrypoint",
      ],
      advancedSurfacesGate: "relay.advancedSurfaces.enabled",
    },
    rules: [
      "Do not force a tutorial before the user can start a task.",
      "Show curated task entries and example prompts before advanced assistant management.",
      "Folder selection is a visible first-class control for file search tasks.",
      "Treat the GuidInputCard and AionUi send action as the primary task start control for beginner workflows.",
      "Show Relay-managed document finding as one real AionUi preset assistant entry, not separate metadata-only search and summary labels.",
      "When a high-level Relay document search tool is advertised, route document search and summary intents there before raw glob, grep, or read tools.",
      "Search results render as actionable cards with preview, open, copy path, evidence, and refine actions.",
      "No-results and partial-results states must suggest next actions instead of ending silently.",
      "Use candidate language until an answer is backed by current Evidence Pack items.",
      "Hide provider/model setup, tool settings, WebUI/channel setup, extension settings, Skills Market, model switchers, permission-mode controls, detected-agent selectors, preset edit controls, backend switchers, and assistant-management entrypoints from beginner views.",
      "Beginner send flow requires selecting either 資料を探す or Officeファイルを編集する before execution.",
      "Expose hidden AionUi surfaces only when relay.advancedSurfaces.enabled is deliberately enabled for support.",
      "Advanced parser, Evidence Pack, and Query Trace terms stay in support details only.",
    ],
  });
});

test("AionUi Relay manifest fixes Relay product branding", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.branding, {
    packageName: "relay-agent-aionui",
    appId: "com.relayagent.app",
    productName: "Relay Agent",
    executableName: "Relay Agent",
    windowTitle: "Relay Agent",
    protocol: "relay-agent",
    installerArtifactPrefix: "Relay.Agent",
    iconSource: "apps/desktop/src-tauri/icons/source/relay-agent.svg",
    publishOwner: "minimo162",
    publishRepo: "Relay_Agent",
    browserTitle: "Relay Agent",
    supportName: "Relay Agent",
  });
});

test("AionUi Relay manifest defines release artifact gate metadata", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.releaseArtifactManifest, {
    schema: "RelayAionUiReleaseArtifactManifest.v1",
    workflow: ".github/workflows/release-aionui-windows-installer.yml",
    overlayVersion: "relay-aionui-overlay-v1",
    primaryArtifactPattern: "Relay.Agent-*-win-x64*.exe",
    manifestAssetName: "Relay.Agent-AionUi-release-manifest.json",
    evidenceBundleRow: "release-workflow",
    allowedSigningModes: [
      "trusted-signing",
      "self-signed-prerelease",
      "unsigned-prerelease",
    ],
    formalReleaseSigningMode: "trusted-signing",
    prereleaseSigningModes: [
      "trusted-signing",
      "self-signed-prerelease",
      "unsigned-prerelease",
    ],
    requiredBundledPayloads: [
      {
        id: "ripgrep",
        installedPath: "resources/relay-tools/ripgrep/rg.exe",
        requiredFor: "workspace-file-search",
      },
    ],
    requiredOverlayAssertions: [
      "relay-branding",
      "relay-agent-protocol",
      "relay-provider-seed",
      "workspace-search-result-flow",
      "beginner-surface-curation",
      "portable-search-tool-bundle",
    ],
    requiredReleaseMetadata: [
      "releaseTag",
      "releaseName",
      "installerAssetName",
      "installerSha256",
      "signingMode",
      "authenticodeStatus",
      "aionUiTag",
      "aionUiCommit",
      "relayAgentVersion",
      "officeCliVersion",
      "overlayVersion",
      "bundledPayloads",
      "manifestSchema",
    ],
  });
});
