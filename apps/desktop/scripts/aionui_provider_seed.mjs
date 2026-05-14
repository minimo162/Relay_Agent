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
  "relay-document-search",
  "workspace-search",
  "find-files",
  "read-office-file",
  "summarize-with-evidence",
]);
export const AIONUI_RELAY_TASK_MODE_IDS = Object.freeze(["document_search", "office_edit"]);
export const AIONUI_RELAY_TASK_MODE_BY_ASSISTANT_ID = Object.freeze({
  "relay-workspace-search": "document_search",
  "relay-office-edit": "office_edit",
});
export const AIONUI_RELAY_TASK_MODE_PROMPT_TEMPLATES = Object.freeze({
  document_search: {
    selectedModeMarker: "RELAY_TASK_MODE: document_search",
    firstTool: "relay_document_search",
    executionPath: "relay-direct-first",
    requiredToolPolicy:
      "Relay runtime executes the high-level document search directly first. Preserve the user request in query, pass the selected workspace root, and do not narrow roots, fileTypes, or keywords unless the user explicitly asked for that filter.",
    defaultArguments: {
      intent: "find_files",
      evidence: "candidate",
      thoroughness: "quick",
      maxResults: 120,
    },
    responsePolicy:
      "Return candidate files quickly first. Defer Office/text content extraction until evidence, summary, inspection, or a selected file requires it. Treat PDFs as filename/path candidates unless an optional PDF text reader is explicitly configured.",
  },
  office_edit: {
    selectedModeMarker: "RELAY_TASK_MODE: office_edit",
    firstTool: "officecli",
    executionPath: "relay-preflight-then-copilot-officecli",
    requiredToolPolicy:
      "Relay runtime must verify workspace, target Office file, and bundled OfficeCLI readiness before Copilot compiles any OfficeCLI step. Use OfficeCLI-backed tools only for Office document inspection and edits. Do not use Microsoft 365 built-in editing, shell prose, or text-file edit tools for binary Office files.",
    missingFieldsPolicy:
      "If the file path, target sheet/range/object, or requested edit is missing, ask for the missing field instead of guessing. For existing workbooks, inspect sheets before using a sheet-qualified range when the sheet is not known.",
    responsePolicy:
      "Compile the user request into the smallest safe OfficeCLI execution or inspection step, add --json to OfficeCLI commands, and claim completion only after a tool result exists.",
  },
});
export const AIONUI_RELAY_TASK_ASSISTANTS = Object.freeze([
  {
    id: "relay-workspace-search",
    defaultEnabledSkills: [
      "relay-document-search",
      "workspace-search",
      "find-files",
      "read-office-file",
      "summarize-with-evidence",
    ],
    assistant: {
      id: "relay-workspace-search",
      name: "Find Materials",
      nameI18n: {
        "en-US": "Find Materials",
        "ja-JP": "資料を探す",
      },
      description: "Find local files, check their contents when needed, and summarize them with evidence.",
      descriptionI18n: {
        "en-US": "Find local files, check their contents when needed, and summarize them with evidence.",
        "ja-JP": "フォルダやファイルから必要な資料を探し、必要なら中身を読んで出典つきで要約します。",
      },
      avatar: "🔎",
      enabled: true,
      isPreset: true,
      isBuiltin: false,
      presetAgentType: "aionrs",
      context:
        "RELAY_TASK_MODE: document_search\nYou are Relay Agent's document finding assistant. Use AionUi workspace context and the high-level Relay document search tool first; do not decompose the first step into raw glob/grep/read when relay_document_search is advertised. Preserve the user's request as the query, keep the selected workspace root broad, and avoid adding file type or folder filters unless the user explicitly asked for them. Return candidate files quickly first; read files and summarize with evidence only when the user asks for understanding, review, or summary. Ask for a folder only when no workspace is selected. Treat early filename hits as candidates until Relay marks them confirmed.",
      contextI18n: {
        "ja-JP":
          "RELAY_TASK_MODE: document_search\nRelay Agentの資料検索アシスタントです。まずAionUIのWorkspaceとRelayの高レベル資料検索ツールを使い、relay_document_search が利用できる場合は raw glob/grep/read に分解しないでください。ユーザーの依頼文をqueryとして保ち、選択中Workspace rootを広く使い、ユーザーが明示した場合以外はファイル種別やフォルダで絞らないでください。最初は候補ファイルを高速に返し、ユーザーが理解・確認・要約を求めた場合だけファイルを読んで出典つきで要約します。Workspaceが未選択の場合だけフォルダ指定を促してください。Relayが確認済みにするまで、ファイル名だけの一致は候補として扱ってください。",
      },
      promptsI18n: {
        "en-US": [
          "Find files related to cash flow statement preparation in this folder",
          "Find related files first, then summarize only confirmed evidence",
          "Find the latest report in this workspace",
          "Find report files and group the likely source and output candidates",
        ],
        "ja-JP": [
          "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
          "関係するファイルを探してから、確認済みの根拠だけで要約して",
          "このフォルダの最新の報告書を探して",
          "報告書ファイルを探して、元資料候補と出力候補に分けて",
        ],
      },
    },
  },
  {
    id: "relay-office-edit",
    defaultEnabledSkills: ["officecli-docx", "officecli-xlsx", "officecli-pptx"],
    assistant: {
      id: "relay-office-edit",
      name: "Edit Office Files",
      nameI18n: {
        "en-US": "Edit Office Files",
        "ja-JP": "Officeファイルを編集する",
      },
      description: "Inspect and edit local Word, Excel, and PowerPoint files through OfficeCLI-backed tools.",
      descriptionI18n: {
        "en-US": "Inspect and edit local Word, Excel, and PowerPoint files through OfficeCLI-backed tools.",
        "ja-JP": "OfficeCLIベースのツールでローカルのWord、Excel、PowerPointを確認・編集します。",
      },
      avatar: "📝",
      enabled: true,
      isPreset: true,
      isBuiltin: false,
      presetAgentType: "aionrs",
      context:
        "RELAY_TASK_MODE: office_edit\nYou are Relay Agent's Office file editing assistant. Use OfficeCLI-backed tools for Word, Excel, and PowerPoint inspection and edits. Do not use Microsoft 365 built-in editing, web search, or text edit tools for binary Office files. If the file path, target sheet/range/object, or requested edit is missing, ask for the missing field instead of guessing. For existing workbooks, inspect sheets with OfficeCLI before using a sheet-qualified range when the sheet is not known. Add --json to OfficeCLI commands and claim completion only after an executor result exists.",
      contextI18n: {
        "ja-JP":
          "RELAY_TASK_MODE: office_edit\nRelay AgentのOfficeファイル編集アシスタントです。Word、Excel、PowerPointの確認・編集にはOfficeCLIベースのツールを使ってください。Microsoft 365の組み込み編集、Web検索、バイナリOfficeファイルへのテキスト編集ツールは使わないでください。ファイルパス、対象シート・範囲・オブジェクト、編集内容が不足している場合は推測せず不足項目を確認してください。既存ブックでシート名が不明な場合は、シート修飾範囲を使う前にOfficeCLIでシートを確認してください。OfficeCLIコマンドには--jsonを付け、実行結果が返るまで完了を主張しないでください。",
      },
      promptsI18n: {
        "en-US": [
          "Change the specified Excel cell formatting in this workbook",
          "Inspect the sheets in this workbook before editing",
          "Update the specified paragraph in this Word file",
          "Edit the selected PowerPoint slide title",
        ],
        "ja-JP": [
          "このExcelファイルの指定セルを編集して",
          "このブックのシートを確認してから編集して",
          "このWordファイルの指定箇所を更新して",
          "このPowerPointの指定スライドのタイトルを編集して",
        ],
      },
    },
  },
]);
export const AIONUI_RELAY_DEFAULT_ASSISTANTS = Object.freeze([
  ...AIONUI_RELAY_TASK_ASSISTANTS,
]);
export const AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS = Object.freeze(
  AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
);
export const AIONUI_RELAY_HIDDEN_ASSISTANT_PRESET_IDS = Object.freeze([
  "word-creator",
  "excel-creator",
  "ppt-creator",
  "relay-grounded-summary",
  "academic-paper",
  "morph-ppt",
  "morph-ppt-3d",
  "cowork",
  "openclaw-setup",
  "star-office-helper",
  "story-roleplay",
  "moltbook",
  "beautiful-mermaid",
  "word-form-creator",
  "pitch-deck-creator",
  "dashboard-creator",
  "financial-model-creator",
  "game-3d",
  "ui-ux-pro-max",
  "planning-with-files",
  "human-3-coach",
  "social-job-publisher",
  "x-recruiter",
  "xiaohongshu-recruiter",
]);
export const AIONUI_RELAY_BEGINNER_TASK_LABELS = Object.freeze([
  "資料を探す",
  "Officeファイルを編集する",
]);
export const AIONUI_RELAY_ADVANCED_SURFACES_ENABLED = false;
export const AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS = Object.freeze([
  "AionUi",
  "Dedoc",
  "ParsedDocument",
  "DocumentContent",
  "DocumentMetadata",
  "TreeNode",
  "LineMetadata",
  "TableMetadata",
  "CellWithMeta",
  "Annotation",
  "IR",
  "Evidence Pack",
  "Query Trace",
  "parser lineage",
  "reader capabilities",
  "structure profile",
  "pattern set",
]);
export const AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS = Object.freeze([
  "relay-document-search",
  "workspace-search",
  "find-files",
  "read-office-file",
  "summarize-with-evidence",
]);
export const AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS = Object.freeze([
  "guid-page-assistant-selection",
  "guid-page-input-card",
  "guid-page-workspace-folder-select",
  "conversation-preset-assistant-menu",
  "sendbox-at-file-mentions",
  "workspace-toolbar-search",
]);
export const AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES = Object.freeze([
  "GuidPage",
  "AssistantSelectionArea",
  "GuidInputCard",
  "GuidActionRow",
  "ConversationTabs",
  "SendBox",
  "AtFileMenu",
  "Workspace",
  "PreviewPanel",
]);
export const AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS = Object.freeze([
  "choose-curated-task",
  "select-folder-or-use-recent-workspace",
  "use-example-prompt-or-type-request",
  "start-conversation",
  "review-chat-results",
  "open-preview-or-refine",
]);
export const AIONUI_RELAY_GUID_REQUIRED_CONTROLS = Object.freeze([
  "AssistantSelectionArea",
  "GuidInputCard",
  "GuidActionRow",
  "WorkspaceFolderSelect",
]);
export const AIONUI_RELAY_GUID_START_ACTION = Object.freeze({
  owner: "aionui",
  trigger: "normal-send-flow",
  controls: ["GuidInputCard submit", "GuidActionRow send", "SendBox send"],
  noStandaloneSearchStartButton: true,
});
export const AIONUI_RELAY_GUID_EXAMPLE_PROMPTS = Object.freeze([
  "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
  "報告書ファイルを探して、元資料候補と出力候補に分けて",
  "このExcelファイルの指定セルを編集して",
  "このフォルダの最新の報告書を探して",
  "この資料を開いて要点と根拠ページをまとめて",
]);
export const AIONUI_RELAY_SEARCH_STATE_LABELS = Object.freeze([
  "フォルダ未選択",
  "準備中",
  "候補を表示中",
  "ファイルの中身まで確認中",
  "確認済みの結果",
  "結果なし",
  "一部のみ検索",
  "権限なし",
  "失敗",
]);
export const AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS = Object.freeze([
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
]);
export const AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS = Object.freeze([
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
]);
export const AIONUI_RELAY_SEARCH_RESULT_BATCHING = Object.freeze({
  strategy: "capped-batches",
  initialBatchSize: 20,
  continuationAction: "show-more-results",
  preserveSelectionAcrossRefresh: true,
  stableSelectionKeyField: "ui_state.stableSelectionKey",
  resultFlowContract: "RelayDocumentSearchResultFlow.v1",
  copilotProse: "secondary",
});
export const AIONUI_RELAY_QUERY_PLANNING = Object.freeze({
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
});
export const AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS = Object.freeze([
  "select-or-change-folder",
  "broaden-keywords",
  "try-related-terms",
  "clear-extension-filters",
  "show-index-status",
]);
export const AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS = Object.freeze([
  "about",
]);
export const AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS = Object.freeze([
  "gemini",
  "model",
  "agent",
  "tools",
  "webui",
  "system",
  "extension-settings",
]);
export const AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES = Object.freeze([
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
  "guid-quick-action-buttons",
  "feedback-report-modal",
  "sendbox-speech-input",
  "sendbox-slash-command-menu",
  "conversation-skills-indicator",
  "context-usage-indicator",
  "conversation-export-command",
  "side-question-command",
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

export function aionuiRelayAssistantCatalogSeed() {
  return {
    mode: "curated",
    visiblePresetIds: [...AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS],
    hiddenPresetIds: [...AIONUI_RELAY_HIDDEN_ASSISTANT_PRESET_IDS],
    hideUnlistedBuiltinPresets: true,
    beginnerTaskLabels: [...AIONUI_RELAY_BEGINNER_TASK_LABELS],
    advancedAccess: "advanced-only",
  };
}

export function aionuiRelayConfigSeed({
  baseUrl = providerBaseURL(providerPort()),
  apiKey,
} = {}) {
  const provider = aionuiRelayProviderConfig({ baseUrl, apiKey });
  const assistantCatalog = aionuiRelayAssistantCatalogSeed();
  return {
    "model.config": [provider],
    "aionrs.defaultModel": aionuiRelayDefaultModel(),
    "gemini.defaultModel": aionuiRelayDefaultModel(),
    "webui.desktop.enabled": false,
    "webui.desktop.allowRemote": false,
    "relay.advancedSurfaces.enabled": AIONUI_RELAY_ADVANCED_SURFACES_ENABLED,
    "relay.channels.enabled": false,
    "relay.providerOnboarding.enabled": false,
    "relay.remoteAccess.enabled": false,
    "relay.workspaceSearch.enabled": true,
    "relay.workspaceSearch.surface": "aionui",
    "relay.workspaceSearch.integrationMode": "skills-first",
    "relay.workspaceSearch.rendererPolicy": "lightweight-aionui-result-renderers",
    "relay.workspaceSearch.defaultSkillEntrypoints": [...AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS],
    "relay.workspaceSearch.legacyDiagnosticShell": false,
    "relay.workspaceSearch.hiddenBeginnerTerms": [...AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
    "relay.aionuiUx.integrationMode": "reuse-core-conversation-workspace-preview",
    "relay.aionuiUx.primaryEntrypoint": "guid-page-task-launcher",
    "relay.aionuiUx.searchEntrypoints": [...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS],
    "relay.aionuiUx.reusedSurfaces": [...AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES],
    "relay.aionuiUx.resultPlacement": "chat-message-plus-preview-panel",
    "relay.aionuiUx.noNewSearchShell": true,
    "relay.aionuiUx.noFullAssistantGalleryDefault": true,
    "relay.guidUx.mode": "curated-task-launcher",
    "relay.guidUx.primarySurface": "GuidPage",
    "relay.guidUx.beginnerFlowSteps": [...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS],
    "relay.guidUx.requiredControls": [...AIONUI_RELAY_GUID_REQUIRED_CONTROLS],
    "relay.guidUx.defaultTaskEntries": [...AIONUI_RELAY_BEGINNER_TASK_LABELS],
    "relay.guidUx.primaryCta": "aionui-normal-send-flow",
    "relay.guidUx.startAction": { ...AIONUI_RELAY_GUID_START_ACTION },
    "relay.taskMode.required": true,
    "relay.taskMode.allowedModes": [...AIONUI_RELAY_TASK_MODE_IDS],
    "relay.taskMode.modeByAssistantId": { ...AIONUI_RELAY_TASK_MODE_BY_ASSISTANT_ID },
    "relay.taskMode.sendWithoutMode": "blocked",
    "relay.taskMode.promptTemplates": { ...AIONUI_RELAY_TASK_MODE_PROMPT_TEMPLATES },
    "relay.documentSearch.candidateFirst": true,
    "relay.documentSearch.preserveQueryExpansion": true,
    "relay.documentSearch.deferContentExtractionByDefault": true,
    "relay.documentSearch.candidateLimit": 120,
    "relay.documentSearch.displayLimit": 30,
    "relay.documentSearch.continuation": "show-more-results",
    "relay.guidUx.noStandaloneSearchStartButton": true,
    "relay.guidUx.examplePromptStrategy": "task-aware-recent-and-popular",
    "relay.guidUx.examplePrompts": [...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS],
    "relay.guidUx.allowSkipTutorial": true,
    "relay.guidUx.noForcedTour": true,
    "relay.searchUx.stateLabels": [...AIONUI_RELAY_SEARCH_STATE_LABELS],
    "relay.searchUx.noResultsGuidance": true,
    "relay.searchUx.resultCardFields": [...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS],
    "relay.searchUx.resultCardActions": [...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS],
    "relay.searchUx.resultBatching": { ...AIONUI_RELAY_SEARCH_RESULT_BATCHING },
    "relay.searchUx.emptyStateActions": [...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS],
    "relay.searchUx.defaultSearchMode": "thorough",
    "relay.searchUx.quickCandidateMode": "progress-only",
    "relay.searchUx.confirmedResultRequirement": "content-or-evidence-backed",
    "relay.searchUx.queryPlanning": { ...AIONUI_RELAY_QUERY_PLANNING },
    "relay.searchUx.autocomplete": "debounced-suggestions",
    "relay.searchUx.progressiveDisclosure": "status-chip-to-details-drawer",
    "relay.searchUx.answerBoundary": "candidate-until-evidence-backed",
    "relay.beginnerUx.visibleSettingsTabs": [...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS],
    "relay.beginnerUx.hiddenSettingsTabs": [...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS],
    "relay.beginnerUx.hiddenSurfaces": [...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES],
    "relay.beginnerUx.hideSkillsMarketBanner": true,
    "relay.beginnerUx.hideModelAndModeSwitchers": true,
    "relay.beginnerUx.hideExtensionSettings": true,
    "relay.beginnerUx.advancedSurfacesGate": "relay.advancedSurfaces.enabled",
    "skillsMarket.enabled": false,
    "system.autoPreviewOfficeFiles": true,
    "tools.useRipgrep": true,
    "relay.defaultEnabledSkills": [...AIONUI_RELAY_DEFAULT_SKILLS],
    "relay.defaultAssistantPresetIds": AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
    "relay.assistantCatalog.mode": assistantCatalog.mode,
    "relay.assistantCatalog.visiblePresetIds": [...assistantCatalog.visiblePresetIds],
    "relay.assistantCatalog.hiddenPresetIds": [...assistantCatalog.hiddenPresetIds],
    "relay.assistantCatalog.hideUnlistedBuiltinPresets": assistantCatalog.hideUnlistedBuiltinPresets,
    "relay.assistantCatalog.beginnerTaskLabels": [...assistantCatalog.beginnerTaskLabels],
    "relay.assistantCatalog.advancedAccess": assistantCatalog.advancedAccess,
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
      assistantPresets: AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => {
        const preset = {
          id: assistant.id,
          defaultEnabledSkills: [...assistant.defaultEnabledSkills],
        };
        if (assistant.assistant) {
          preset.assistant = {
            ...assistant.assistant,
            enabledSkills: [...assistant.defaultEnabledSkills],
          };
        }
        return preset;
      }),
      assistantCatalog: aionuiRelayAssistantCatalogSeed(),
    },
    ux: {
      aionUiCore: {
        primaryEntrypoint: "guid-page-task-launcher",
        searchEntrypoints: [...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS],
        reusedSurfaces: [...AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES],
      },
      guidBeginnerFlow: {
        mode: "curated-task-launcher",
        primarySurface: "GuidPage",
        flowSteps: [...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS],
        requiredControls: [...AIONUI_RELAY_GUID_REQUIRED_CONTROLS],
        primaryCta: "aionui-normal-send-flow",
        startAction: { ...AIONUI_RELAY_GUID_START_ACTION },
        examplePrompts: [...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS],
      },
      taskMode: {
        required: true,
        allowedModes: [...AIONUI_RELAY_TASK_MODE_IDS],
        modeByAssistantId: { ...AIONUI_RELAY_TASK_MODE_BY_ASSISTANT_ID },
        sendWithoutMode: "blocked",
        promptTemplates: { ...AIONUI_RELAY_TASK_MODE_PROMPT_TEMPLATES },
      },
      search: {
        states: [...AIONUI_RELAY_SEARCH_STATE_LABELS],
        resultCardFields: [...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS],
        resultCardActions: [...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS],
        resultBatching: { ...AIONUI_RELAY_SEARCH_RESULT_BATCHING },
        emptyStateActions: [...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS],
        defaultSearchMode: "thorough",
        quickCandidateMode: "progress-only",
        confirmedResultRequirement: "content-or-evidence-backed",
        queryPlanning: { ...AIONUI_RELAY_QUERY_PLANNING },
        candidateFirst: true,
        candidateLimit: 120,
        displayLimit: 30,
        deferContentExtractionByDefault: true,
        continuation: "show-more-results",
      },
      beginnerVisibility: {
        visibleSettingsTabs: [...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS],
        hiddenSettingsTabs: [...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS],
        hiddenSurfaces: [...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES],
        advancedSurfacesGate: "relay.advancedSurfaces.enabled",
      },
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
    "relay.advancedSurfaces.enabled": AIONUI_RELAY_ADVANCED_SURFACES_ENABLED,
    "relay.channels.enabled": false,
    "relay.providerOnboarding.enabled": false,
    "relay.remoteAccess.enabled": false,
    "relay.workspaceSearch.enabled": true,
    "relay.workspaceSearch.surface": "aionui",
    "relay.workspaceSearch.integrationMode": "skills-first",
    "relay.workspaceSearch.rendererPolicy": "lightweight-aionui-result-renderers",
    "relay.workspaceSearch.defaultSkillEntrypoints": [...AIONUI_RELAY_WORKSPACE_SEARCH_SKILLS],
    "relay.workspaceSearch.legacyDiagnosticShell": false,
    "relay.workspaceSearch.hiddenBeginnerTerms": [...AIONUI_RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
    "relay.aionuiUx.integrationMode": "reuse-core-conversation-workspace-preview",
    "relay.aionuiUx.primaryEntrypoint": "guid-page-task-launcher",
    "relay.aionuiUx.searchEntrypoints": [...AIONUI_RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS],
    "relay.aionuiUx.reusedSurfaces": [...AIONUI_RELAY_AIONUI_UX_REUSED_SURFACES],
    "relay.aionuiUx.resultPlacement": "chat-message-plus-preview-panel",
    "relay.aionuiUx.noNewSearchShell": true,
    "relay.aionuiUx.noFullAssistantGalleryDefault": true,
    "relay.guidUx.mode": "curated-task-launcher",
    "relay.guidUx.primarySurface": "GuidPage",
    "relay.guidUx.beginnerFlowSteps": [...AIONUI_RELAY_GUID_BEGINNER_FLOW_STEPS],
    "relay.guidUx.requiredControls": [...AIONUI_RELAY_GUID_REQUIRED_CONTROLS],
    "relay.guidUx.defaultTaskEntries": [...AIONUI_RELAY_BEGINNER_TASK_LABELS],
    "relay.guidUx.primaryCta": "aionui-normal-send-flow",
    "relay.guidUx.startAction": { ...AIONUI_RELAY_GUID_START_ACTION },
    "relay.taskMode.required": true,
    "relay.taskMode.allowedModes": [...AIONUI_RELAY_TASK_MODE_IDS],
    "relay.taskMode.modeByAssistantId": { ...AIONUI_RELAY_TASK_MODE_BY_ASSISTANT_ID },
    "relay.taskMode.sendWithoutMode": "blocked",
    "relay.taskMode.promptTemplates": { ...AIONUI_RELAY_TASK_MODE_PROMPT_TEMPLATES },
    "relay.documentSearch.candidateFirst": true,
    "relay.documentSearch.preserveQueryExpansion": true,
    "relay.documentSearch.deferContentExtractionByDefault": true,
    "relay.documentSearch.candidateLimit": 120,
    "relay.documentSearch.displayLimit": 30,
    "relay.documentSearch.continuation": "show-more-results",
    "relay.guidUx.noStandaloneSearchStartButton": true,
    "relay.guidUx.examplePromptStrategy": "task-aware-recent-and-popular",
    "relay.guidUx.examplePrompts": [...AIONUI_RELAY_GUID_EXAMPLE_PROMPTS],
    "relay.guidUx.allowSkipTutorial": true,
    "relay.guidUx.noForcedTour": true,
    "relay.searchUx.stateLabels": [...AIONUI_RELAY_SEARCH_STATE_LABELS],
    "relay.searchUx.noResultsGuidance": true,
    "relay.searchUx.resultCardFields": [...AIONUI_RELAY_SEARCH_RESULT_CARD_FIELDS],
    "relay.searchUx.resultCardActions": [...AIONUI_RELAY_SEARCH_RESULT_CARD_ACTIONS],
    "relay.searchUx.resultBatching": { ...AIONUI_RELAY_SEARCH_RESULT_BATCHING },
    "relay.searchUx.emptyStateActions": [...AIONUI_RELAY_SEARCH_EMPTY_STATE_ACTIONS],
    "relay.searchUx.defaultSearchMode": "thorough",
    "relay.searchUx.quickCandidateMode": "progress-only",
    "relay.searchUx.confirmedResultRequirement": "content-or-evidence-backed",
    "relay.searchUx.queryPlanning": { ...AIONUI_RELAY_QUERY_PLANNING },
    "relay.searchUx.autocomplete": "debounced-suggestions",
    "relay.searchUx.progressiveDisclosure": "status-chip-to-details-drawer",
    "relay.searchUx.answerBoundary": "candidate-until-evidence-backed",
    "relay.beginnerUx.visibleSettingsTabs": [...AIONUI_RELAY_BEGINNER_VISIBLE_SETTINGS_TABS],
    "relay.beginnerUx.hiddenSettingsTabs": [...AIONUI_RELAY_BEGINNER_HIDDEN_SETTINGS_TABS],
    "relay.beginnerUx.hiddenSurfaces": [...AIONUI_RELAY_BEGINNER_HIDDEN_SURFACES],
    "relay.beginnerUx.hideSkillsMarketBanner": true,
    "relay.beginnerUx.hideModelAndModeSwitchers": true,
    "relay.beginnerUx.hideExtensionSettings": true,
    "relay.beginnerUx.advancedSurfacesGate": "relay.advancedSurfaces.enabled",
    "skillsMarket.enabled": false,
    "system.autoPreviewOfficeFiles": true,
    "tools.useRipgrep": true,
    "relay.defaultEnabledSkills": [...AIONUI_RELAY_DEFAULT_SKILLS],
    "relay.defaultAssistantPresetIds": AIONUI_RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
    "relay.assistantCatalog.mode": "curated",
    "relay.assistantCatalog.visiblePresetIds": [...AIONUI_RELAY_VISIBLE_ASSISTANT_PRESET_IDS],
    "relay.assistantCatalog.hiddenPresetIds": [...AIONUI_RELAY_HIDDEN_ASSISTANT_PRESET_IDS],
    "relay.assistantCatalog.hideUnlistedBuiltinPresets": true,
    "relay.assistantCatalog.beginnerTaskLabels": [...AIONUI_RELAY_BEGINNER_TASK_LABELS],
    "relay.assistantCatalog.advancedAccess": "advanced-only",
  };
}

export function aionrsBaseUrlForRelay(baseUrl = providerBaseURL(providerPort())) {
  return String(baseUrl).replace(/\/v1\/?$/, "");
}
