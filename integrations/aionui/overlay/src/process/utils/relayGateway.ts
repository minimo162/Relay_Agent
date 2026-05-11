/**
 * Relay Agent gateway bootstrap for the Relay-branded AionUi shell.
 *
 * AionUi must see the Relay provider seed before initStorage() runs. This
 * module starts the bundled M365 Copilot gateway first, reads the dynamic
 * localhost port selected by the OS, writes the seed file, and points
 * RELAY_AIONUI_PROVIDER_SEED_FILE at that seed.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { app } from 'electron';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

const RELAY_PROVIDER_ID = 'relay-agent';
const RELAY_MODEL_ID = 'm365-copilot';
const RELAY_PROVIDER_NAME = 'Relay Agent / M365 Copilot';
const RELAY_CONTEXT_LIMIT = 128000;
const RELAY_SEED_FILE_ENV = 'RELAY_AIONUI_PROVIDER_SEED_FILE';
const RELAY_OFFICECLI_PATH_ENV = 'RELAY_OFFICECLI_PATH';
const RELAY_OFFICECLI_EXPECTED_PATH_ENV = 'RELAY_OFFICECLI_EXPECTED_PATH';
const RELAY_RIPGREP_PATH_ENV = 'RELAY_RIPGREP_PATH';
const RELAY_BUNDLED_RIPGREP_PATH_ENV = 'RELAY_BUNDLED_RIPGREP';
const RELAY_BUNDLED_NODE_ENV = 'RELAY_BUNDLED_NODE';
const RELAY_LITEPARSE_RUNNER_ROOT_ENV = 'RELAY_LITEPARSE_RUNNER_ROOT';
const RELAY_OFFICECLI_VERSION = '1.0.76';
const RELAY_OFFICECLI_URL = 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.76/officecli-win-x64.exe';
const RELAY_OFFICECLI_SHA256 = 'f9e4895505858ab813e133d4d1f9f01004c7b4b08397408487f534caf9e2ec58';
const RELAY_OFFICECLI_SIZE = 30433916;
const RELAY_OFFICECLI_ENTRYPOINT = 'officecli.exe';
const DEFAULT_RELAY_EDGE_CDP_PORT = 9360;
const RELAY_DEFAULT_SKILLS = [
  'officecli-docx',
  'officecli-xlsx',
  'officecli-pptx',
  'relay-document-search',
  'workspace-search',
  'find-files',
  'read-office-file',
  'summarize-with-evidence',
];
const RELAY_OFFICE_ASSISTANTS = [
  {
    id: 'word-creator',
    defaultEnabledSkills: ['officecli-docx'],
  },
  {
    id: 'excel-creator',
    defaultEnabledSkills: ['officecli-xlsx'],
  },
  {
    id: 'ppt-creator',
    defaultEnabledSkills: ['officecli-pptx'],
  },
];
const RELAY_TASK_ASSISTANTS = [
  {
    id: 'relay-workspace-search',
    defaultEnabledSkills: [
      'relay-document-search',
      'workspace-search',
      'find-files',
      'read-office-file',
      'summarize-with-evidence',
    ],
    assistant: {
      id: 'relay-workspace-search',
      name: 'Find Materials',
      nameI18n: {
        'en-US': 'Find Materials',
        'ja-JP': '資料を探す',
      },
      description: 'Find local files, check their contents when needed, and summarize them with evidence.',
      descriptionI18n: {
        'en-US': 'Find local files, check their contents when needed, and summarize them with evidence.',
        'ja-JP': 'フォルダやファイルから必要な資料を探し、必要なら中身を読んで出典つきで要約します。',
      },
      avatar: '🔎',
      enabled: true,
      isPreset: true,
      isBuiltin: false,
      presetAgentType: 'aionrs',
      context:
        "You are Relay Agent's document finding assistant. Use AionUi workspace context and Relay workspace-search skills first, then read files and summarize with evidence only when the user asks for understanding, review, or summary. Ask for a folder only when no workspace is selected. Treat early filename hits as candidates until Relay marks them confirmed.",
      contextI18n: {
        'ja-JP':
          'Relay Agentの資料検索アシスタントです。まずAionUIのWorkspaceとRelayの検索スキルを使い、ユーザーが理解・確認・要約を求めた場合だけファイルを読んで出典つきで要約します。Workspaceが未選択の場合だけフォルダ指定を促してください。Relayが確認済みにするまで、ファイル名だけの一致は候補として扱ってください。',
      },
      promptsI18n: {
        'en-US': [
          'Find files related to cash flow statement preparation in this folder',
          'Find related files first, then summarize only confirmed evidence',
          'Find the latest report in this workspace',
          'Summarize this PDF with evidence',
        ],
        'ja-JP': [
          'このフォルダからキャッシュフロー計算書に関係するファイルを探して',
          '関係するファイルを探してから、確認済みの根拠だけで要約して',
          'このフォルダの最新の報告書を探して',
          'このPDFを根拠つきで要約して',
        ],
      },
    },
  },
];
const RELAY_DEFAULT_ASSISTANTS = [...RELAY_OFFICE_ASSISTANTS, ...RELAY_TASK_ASSISTANTS];
const RELAY_VISIBLE_ASSISTANT_PRESET_IDS = RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id);
const RELAY_HIDDEN_ASSISTANT_PRESET_IDS = [
  'relay-grounded-summary',
  'academic-paper',
  'morph-ppt',
  'morph-ppt-3d',
  'cowork',
  'openclaw-setup',
  'star-office-helper',
  'story-roleplay',
  'moltbook',
  'beautiful-mermaid',
  'word-form-creator',
  'pitch-deck-creator',
  'dashboard-creator',
  'financial-model-creator',
  'game-3d',
  'ui-ux-pro-max',
  'planning-with-files',
  'human-3-coach',
  'social-job-publisher',
  'x-recruiter',
  'xiaohongshu-recruiter',
];
const RELAY_BEGINNER_TASK_LABELS = [
  'Word文書を作る',
  'Excelを編集',
  'PowerPointを作る',
  '資料を探す',
];
const RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS = [
  'AionUi',
  'Dedoc',
  'ParsedDocument',
  'DocumentContent',
  'DocumentMetadata',
  'TreeNode',
  'LineMetadata',
  'TableMetadata',
  'CellWithMeta',
  'Annotation',
  'IR',
  'Evidence Pack',
  'Query Trace',
  'parser lineage',
  'reader capabilities',
  'structure profile',
  'pattern set',
];
const RELAY_WORKSPACE_SEARCH_SKILLS = [
  'relay-document-search',
  'workspace-search',
  'find-files',
  'read-office-file',
  'summarize-with-evidence',
];
const RELAY_DOCUMENT_SEARCH_HIGH_LEVEL_TOOL = {
  name: 'relay_document_search',
  requestContract: 'RelayDocumentSearchRequest.v1',
  resultContract: 'RelayDocumentSearchResult.v1',
  jobContract: 'RelayDocumentSearchJob.v1',
  contractModule: 'src/process/utils/relayDocumentSearchContract.ts',
  executorModule: 'src/process/utils/relayDocumentSearchExecutor.ts',
  queryPlanModule: 'src/process/utils/relayDocumentSearchQueryPlan.ts',
  queryPlanContract: 'RelayDocumentSearchQueryPlan.v1',
  queryNormalizerVersion: 'relay-query-normalizer-v1',
  indexReportModule: 'src/process/utils/relayDocumentSearchIndexReport.ts',
  indexReportContract: 'RelayDocumentSearchIndexReport.v1',
  resultGroupingModule: 'src/process/utils/relayDocumentSearchResultGrouping.ts',
  resultGroupingContract: 'RelayDocumentSearchResultGrouping.v1',
  productResultModule: 'src/process/utils/relayDocumentSearchProductResult.ts',
  productResultContract: 'RelayDocumentSearchProductResult.v1',
  folderRolesModule: 'src/process/utils/relayDocumentSearchFolderRoles.ts',
  folderRolesContract: 'RelayDocumentSearchFolderRoles.v1',
  userMemoryModule: 'src/process/utils/relayDocumentSearchUserMemory.ts',
  userMemoryContract: 'RelayDocumentSearchUserMemory.v1',
  cacheActionsModule: 'src/process/utils/relayDocumentSearchCacheActions.ts',
  cacheActionsContract: 'RelayDocumentSearchCacheActions.v1',
  syncJournalModule: 'src/process/utils/relayDocumentSearchSyncJournal.ts',
  syncJournalContract: 'RelayDocumentSearchSyncJournal.v1',
  schedulerReportModule: 'src/process/utils/relayDocumentSearchSchedulerReport.ts',
  schedulerReportContract: 'RelayDocumentSearchSchedulerReport.v1',
  backgroundSchedulerModule: 'src/process/utils/relayDocumentSearchBackgroundScheduler.ts',
  backgroundSchedulerContract: 'RelayDocumentSearchBackgroundScheduler.v1',
  syncProducerModule: 'src/process/utils/relayDocumentSearchSyncProducer.ts',
  syncProducerContract: 'RelayDocumentSearchSyncProducer.v1',
  indexMaintenanceModule: 'src/process/utils/relayDocumentSearchIndexMaintenance.ts',
  indexMaintenanceContract: 'RelayDocumentSearchIndexMaintenance.v1',
  qualityModule: 'src/process/utils/relayDocumentSearchQualityGates.ts',
  qualityContract: 'RelayDocumentSearchQuality.v1',
  queryTraceModule: 'src/process/utils/relayDocumentSearchQueryTrace.ts',
  queryTraceContract: 'RelayDocumentSearchQueryTrace.v1',
  evidenceRedactionModule: 'src/process/utils/relayDocumentSearchEvidenceRedaction.ts',
  evidenceRedactionContract: 'RelayDocumentSearchEvidenceRedaction.v1',
  evidencePackModule: 'src/process/utils/relayDocumentSearchEvidencePack.ts',
  evidencePackContract: 'RelayDocumentSearchEvidencePack.v1',
  localDraftModule: 'src/process/utils/relayDocumentSearchLocalDraft.ts',
  localDraftContract: 'RelayDocumentSearchLocalDraft.v1',
  polishRequestModule: 'src/process/utils/relayDocumentSearchPolishRequest.ts',
  polishRequestContract: 'RelayDocumentSearchPolishRequest.v1',
  polishProviderModule: 'src/process/utils/relayDocumentSearchPolishProvider.ts',
  polishProviderContract: 'RelayDocumentSearchPolishProvider.v1',
  polishValidationModule: 'src/process/utils/relayDocumentSearchPolishValidation.ts',
  polishValidationContract: 'RelayDocumentSearchPolishValidation.v1',
  polishedAnswerContract: 'RelayDocumentSearchPolishedAnswer.v1',
  answerModule: 'src/process/utils/relayDocumentSearchAnswer.ts',
  answerContract: 'RelayDocumentSearchAnswer.v1',
  copilotStateModule: 'src/process/utils/relayDocumentSearchCopilotState.ts',
  copilotStateContract: 'RelayDocumentSearchCopilotState.v1',
  freshnessModule: 'src/process/utils/relayDocumentSearchFreshness.ts',
  freshnessContract: 'RelayDocumentSearchFreshness.v1',
  metadataCacheModule: 'src/process/utils/relayDocumentSearchMetadataCache.ts',
  metadataCacheContract: 'RelayDocumentSearchMetadataCache.v1',
  filenameIndexModule: 'src/process/utils/relayDocumentSearchFilenameIndex.ts',
  filenameIndexContract: 'RelayDocumentSearchFilenameIndex.v1',
  indexCoordinatorModule: 'src/process/utils/relayDocumentSearchIndexCoordinator.ts',
  indexCoordinatorContract: 'RelayDocumentSearchIndexCoordinator.v1',
  indexLockContract: 'RelayDocumentSearchIndexLock.v1',
  indexHealthEventContract: 'RelayDocumentSearchIndexHealthEvent.v1',
  parsedDocumentCacheModule: 'src/process/utils/relayParsedDocumentCache.ts',
  parsedDocumentCacheContract: 'RelayParsedDocumentCache.v1',
  parsedDocumentIrModule: 'src/process/utils/relayParsedDocumentIr.ts',
  parsedDocumentIrContract: 'RelayParsedDocumentIR.v1',
  parsedDocumentIrVersion: 'relay-ir-v1',
  officeOpenXmlReaderVersion: 'relay-office-openxml-reader-v1',
  derivedContentIndexModule: 'src/process/utils/relayDocumentSearchDerivedContentIndex.ts',
  derivedContentIndexContract: 'RelayDocumentSearchDerivedContentIndex.v1',
  previewAnchorContract: 'RelayDocumentSearchPreviewAnchor.v1',
  jobLifecycleModule: 'src/process/utils/relayDocumentSearchJobLifecycle.ts',
  jobLifecycleContract: 'RelayDocumentSearchJobLifecycle.v1',
  jobLifecycleRunnerExport: 'runRelayDocumentSearchJob',
  jobStoreModule: 'src/process/utils/relayDocumentSearchJobStore.ts',
  jobStoreContract: 'RelayDocumentSearchJobStore.v1',
  bridgeModule: 'src/process/utils/relayDocumentSearchBridge.ts',
  displayModule: 'src/process/utils/relayDocumentSearchDisplay.ts',
  displayContract: 'RelayDocumentSearchDisplay.v1',
  resultFlowContract: 'RelayDocumentSearchResultFlow.v1',
  aionuiResultFlowContract: 'RelayDocumentSearchAionUiResultFlow.v1',
  displayAdapterExport: 'relayDocumentSearchResultToDisplayModel',
  aionuiResultFlowExport: 'relayDocumentSearchExecutionToAionUiResultFlow',
  mcpServerModule: 'src/process/utils/relayDocumentSearchMcpStdio.ts',
  mcpServerOutfile: 'out/main/relay-document-search-mcp-stdio.js',
  openAiToolSchemaExport: 'relayDocumentSearchOpenAiToolSchema',
  bridgeToolDefinitionExport: 'relayDocumentSearchBridgeToolDefinition',
  bridgeHandlerExport: 'handleRelayDocumentSearchToolCall',
  resultFlowPolicy: {
    rendererOwner: 'AionUi',
    structuredResultCardsPrimary: true,
    copilotProseSecondary: true,
    continuationAction: 'show-more-results',
    stableSelectionKeyField: 'ui_state.stableSelectionKey',
  },
  approvedAliases: [
    'relay_document_search',
    'relay-document-search',
    'workspace_document_search',
    'workspace-search',
    'find-files',
  ],
};
const RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS = [
  'guid-page-assistant-selection',
  'guid-page-input-card',
  'guid-page-workspace-folder-select',
  'conversation-preset-assistant-menu',
  'sendbox-slash-command-menu',
  'sendbox-at-file-mentions',
  'workspace-toolbar-search',
];
const RELAY_AIONUI_UX_REUSED_SURFACES = [
  'GuidPage',
  'AssistantSelectionArea',
  'GuidInputCard',
  'GuidActionRow',
  'ConversationTabs',
  'SendBox',
  'AtFileMenu',
  'SlashCommandMenu',
  'Workspace',
  'PreviewPanel',
  'ConversationSkillsIndicator',
];
const RELAY_GUID_BEGINNER_FLOW_STEPS = [
  'choose-curated-task',
  'select-folder-or-use-recent-workspace',
  'use-example-prompt-or-type-request',
  'start-conversation',
  'review-chat-results',
  'open-preview-or-refine',
];
const RELAY_GUID_REQUIRED_CONTROLS = [
  'AssistantSelectionArea',
  'GuidInputCard',
  'GuidActionRow',
  'WorkspaceFolderSelect',
  'QuickActionButtons',
];
const RELAY_GUID_START_ACTION = {
  owner: 'aionui',
  trigger: 'normal-send-flow',
  controls: ['GuidInputCard submit', 'GuidActionRow send', 'SendBox send'],
  noStandaloneSearchStartButton: true,
};
const RELAY_GUID_EXAMPLE_PROMPTS = [
  'このフォルダからキャッシュフロー計算書に関係するファイルを探して',
  'このPDFを根拠つきで要約して',
  'このExcelファイルの指定セルを編集して',
  'このフォルダの最新の報告書を探して',
  'この資料を開いて要点と根拠ページをまとめて',
];
const RELAY_SEARCH_STATE_LABELS = [
  'フォルダ未選択',
  '準備中',
  '候補を表示中',
  'ファイルの中身まで確認中',
  '確認済みの結果',
  '結果なし',
  '一部のみ検索',
  '権限なし',
  '失敗',
];
const RELAY_SEARCH_RESULT_CARD_FIELDS = [
  'fileType',
  'title',
  'path',
  'modifiedTime',
  'snippet',
  'matchReason',
  'matchMode',
  'evidenceState',
  'indexState',
  'warningState',
];
const RELAY_SEARCH_RESULT_CARD_ACTIONS = [
  'preview',
  'open-containing-folder',
  'open-file',
  'copy-path',
  'pin-result',
  'hide-result',
  'use-as-evidence',
  'refine-search',
  'show-more-results',
  'retry-rebuild',
];
const RELAY_SEARCH_RESULT_BATCHING = {
  strategy: 'capped-batches',
  initialBatchSize: 20,
  continuationAction: 'show-more-results',
  preserveSelectionAcrossRefresh: true,
  stableSelectionKeyField: 'ui_state.stableSelectionKey',
  resultFlowContract: 'RelayDocumentSearchResultFlow.v1',
  copilotProse: 'secondary',
};
const RELAY_QUERY_PLANNING = {
  owner: 'relay',
  copilotRole: 'suggestions-only',
  acceptedSuggestionTypes: [
    'related-terms',
    'abbreviations',
    'file-type-hints',
    'clarification-questions',
  ],
  immutableWithoutRelayValidation: [
    'roots',
    'budgets',
    'confirmation-policy',
    'coverage-reporting',
  ],
};
const RELAY_SEARCH_EMPTY_STATE_ACTIONS = [
  'select-or-change-folder',
  'broaden-keywords',
  'try-related-terms',
  'clear-extension-filters',
  'show-index-status',
];
const RELAY_BEGINNER_VISIBLE_SETTINGS_TABS = [
  'about',
];
const RELAY_BEGINNER_HIDDEN_SETTINGS_TABS = [
  'gemini',
  'model',
  'agent',
  'tools',
  'webui',
  'system',
  'extension-settings',
];
const RELAY_BEGINNER_HIDDEN_SURFACES = [
  'skills-market-banner',
  'full-assistant-gallery',
  'provider-onboarding',
  'model-provider-settings',
  'agent-management',
  'tools-settings',
  'system-dev-settings',
  'remote-webui-settings',
  'channel-bot-settings',
  'extension-settings-tabs',
  'model-switcher',
  'agent-permission-mode-switcher',
  'acp-config-selector',
  'guid-auto-skills-menu',
  'assistant-preset-add-button',
  'guid-detected-agent-selector',
  'preset-assistant-edit-button',
  'preset-agent-backend-switcher',
  'assistant-edit-drawer-entrypoint',
];
const RELAY_SHARED_SEARCH_DEFAULTS = {
  RELAY_SHARED_SEARCH_INTERNAL_FILE_LIMIT: '5000',
  RELAY_SHARED_SEARCH_MAX_RETURNED_FILES: '300',
  RELAY_SHARED_SEARCH_PER_FOLDER_LIMIT: '25',
  RELAY_SHARED_SEARCH_PER_BRANCH_LIMIT: '75',
  RELAY_SHARED_SEARCH_BRANCH_DEPTH: '3',
  RELAY_SHARED_SEARCH_NAMES_ONLY_MAX_MATCHES: '500',
  RELAY_SHARED_SEARCH_MAX_MATCHES_PER_FILE: '1',
};
const GATEWAY_FILES = [
  'copilot_server.js',
  'copilot_server.mjs',
  'copilot_dom_poll.mjs',
  'copilot_send_timing.mjs',
  'copilot_wait_dom_response.mjs',
];

type RelayGatewayStartupState = 'ready' | 'needs_attention' | 'disabled';
type OfficeCliStatusState = 'ready-env' | 'ready-reused' | 'ready-downloaded' | 'skipped' | 'needs_attention';
type RipgrepStatusState = 'ready-env' | 'ready-copied' | 'ready-reused' | 'skipped' | 'needs_attention';
type PdfReaderStatusState = 'ready-env' | 'ready-bundled' | 'skipped' | 'needs_attention';

type OfficeCliStatus = {
  state: OfficeCliStatusState;
  path: string;
  reason?: string;
  message?: string;
  sha256?: string;
  size?: number;
};

type RipgrepStatus = {
  state: RipgrepStatusState;
  path: string;
  source?: string;
  reason?: string;
  message?: string;
};

type PdfReaderStatus = {
  state: PdfReaderStatusState;
  nodePath?: string;
  runnerRoot?: string;
  reason?: string;
  message?: string;
};

type SharedSearchStatus = {
  state: 'ready';
  defaults: Record<string, string>;
};

export type RelayGatewayStartupResult = {
  state: RelayGatewayStartupState;
  baseUrl?: string;
  seedFile?: string;
  statusFile?: string;
  message?: string;
};

let relayGatewayProcess: ChildProcess | null = null;
let relayGatewayResult: RelayGatewayStartupResult | null = null;
let quitHandlerRegistered = false;
let relayGatewayPrewarmStarted = false;

function relayDataDir(): string {
  const dir = join(app.getPath('userData'), 'relay');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function relaySeedFilePath(): string {
  return join(relayDataDir(), 'aionui-provider-seed.json');
}

function relayStatusFilePath(): string {
  return join(relayDataDir(), 'relay-gateway-status.json');
}

function relayTokenFilePath(): string {
  return join(relayDataDir(), 'provider-token');
}

function officeCliCacheRoot(): string {
  const envPath = process.env.RELAY_OFFICECLI_CACHE_DIR?.trim();
  return envPath || join(app.getPath('userData'), 'tools', 'officecli');
}

function officeCliCachedPath(): string {
  return join(officeCliCacheRoot(), RELAY_OFFICECLI_VERSION, RELAY_OFFICECLI_ENTRYPOINT);
}

function ripgrepExecutableName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

function aionCliGlobalBinDir(): string {
  const home = process.env.GEMINI_CLI_HOME?.trim() || homedir() || app.getPath('home');
  return join(home || app.getPath('userData'), '.gemini', 'tmp', 'bin');
}

function aionCliRipgrepPath(): string {
  return join(aionCliGlobalBinDir(), ripgrepExecutableName());
}

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function verifyOfficeCliArtifactBuffer(buffer: Buffer): { size: number; sha256: string } {
  if (buffer.length !== RELAY_OFFICECLI_SIZE) {
    throw new Error(`OfficeCLI size mismatch: expected ${RELAY_OFFICECLI_SIZE}, actual ${buffer.length}`);
  }
  const actual = sha256Buffer(buffer);
  if (actual !== RELAY_OFFICECLI_SHA256) {
    throw new Error(`OfficeCLI sha256 mismatch: expected ${RELAY_OFFICECLI_SHA256}, actual ${actual}`);
  }
  return {
    size: buffer.length,
    sha256: actual,
  };
}

function verifyOfficeCliArtifactFile(path: string): { size: number; sha256: string } {
  const stat = statSync(path);
  if (stat.size !== RELAY_OFFICECLI_SIZE) {
    throw new Error(`OfficeCLI size mismatch: expected ${RELAY_OFFICECLI_SIZE}, actual ${stat.size}`);
  }
  const actual = sha256Buffer(readFileSync(path));
  if (actual !== RELAY_OFFICECLI_SHA256) {
    throw new Error(`OfficeCLI sha256 mismatch: expected ${RELAY_OFFICECLI_SHA256}, actual ${actual}`);
  }
  return {
    size: stat.size,
    sha256: actual,
  };
}

function prependProcessPath(dir: string): void {
  const separator = process.platform === 'win32' ? ';' : ':';
  const current = process.env.PATH || '';
  const parts = current.split(separator).filter(Boolean);
  const normalizedDir = process.platform === 'win32' ? dir.toLowerCase() : dir;
  const alreadyPresent = parts.some((part) => (process.platform === 'win32' ? part.toLowerCase() : part) === normalizedDir);
  if (!alreadyPresent) process.env.PATH = [dir, ...parts].join(separator);
}

function registerOfficeCliPath(path: string): void {
  process.env[RELAY_OFFICECLI_PATH_ENV] = path;
  process.env[RELAY_OFFICECLI_EXPECTED_PATH_ENV] = path;
  prependProcessPath(dirname(path));
}

function registerRipgrepPath(path: string): void {
  process.env[RELAY_RIPGREP_PATH_ENV] = path;
  process.env[RELAY_BUNDLED_RIPGREP_PATH_ENV] = path;
  prependProcessPath(dirname(path));
}

function applySharedSearchDefaults(): SharedSearchStatus {
  for (const [key, value] of Object.entries(RELAY_SHARED_SEARCH_DEFAULTS)) {
    process.env[key] ||= value;
  }
  return {
    state: 'ready',
    defaults: Object.fromEntries(
      Object.keys(RELAY_SHARED_SEARCH_DEFAULTS).map((key) => [
        key,
        process.env[key] || RELAY_SHARED_SEARCH_DEFAULTS[key as keyof typeof RELAY_SHARED_SEARCH_DEFAULTS],
      ]),
    ),
  };
}

function bundledRipgrepCandidates(): string[] {
  const resourcesPath = process.resourcesPath || '';
  const appPath = app.getAppPath();
  const executable = ripgrepExecutableName();
  return [
    process.env[RELAY_RIPGREP_PATH_ENV] || '',
    process.env[RELAY_BUNDLED_RIPGREP_PATH_ENV] || '',
    resourcesPath ? join(resourcesPath, 'relay-tools', 'ripgrep', executable) : '',
    appPath ? join(dirname(appPath), 'relay-tools', 'ripgrep', executable) : '',
    appPath ? join(appPath, 'resources', 'relay-tools', 'ripgrep', executable) : '',
    join(process.cwd(), 'resources', 'relay-tools', 'ripgrep', executable),
  ].filter(Boolean);
}

function resolveBundledRipgrepPath(): string | null {
  for (const candidate of bundledRipgrepCandidates()) {
    const candidatePath = resolve(candidate);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return null;
}

function bundledNodeExecutableName(): string {
  return process.platform === 'win32' ? 'relay-node.exe' : 'relay-node';
}

function bundledRelayToolCandidates(...parts: string[]): string[] {
  const resourcesPath = process.resourcesPath || '';
  const appPath = app.getAppPath();
  return [
    resourcesPath ? join(resourcesPath, 'relay-tools', ...parts) : '',
    appPath ? join(dirname(appPath), 'relay-tools', ...parts) : '',
    appPath ? join(appPath, 'resources', 'relay-tools', ...parts) : '',
    join(process.cwd(), 'resources', 'relay-tools', ...parts),
  ].filter(Boolean);
}

function resolveBundledNodePath(): string | null {
  const explicit = process.env[RELAY_BUNDLED_NODE_ENV]?.trim();
  const candidates = [
    explicit || '',
    ...bundledRelayToolCandidates('node', bundledNodeExecutableName()),
  ];
  for (const candidate of candidates) {
    const candidatePath = resolve(candidate);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return null;
}

function resolveBundledLiteparseRunnerRoot(): string | null {
  const explicit = process.env[RELAY_LITEPARSE_RUNNER_ROOT_ENV]?.trim();
  const candidates = [
    explicit || '',
    ...bundledRelayToolCandidates('liteparse-runner'),
  ];
  for (const candidate of candidates) {
    const candidatePath = resolve(candidate);
    if (existsSync(join(candidatePath, 'parse.mjs'))) return candidatePath;
  }
  return null;
}

function registerPdfReader(nodePath: string, runnerRoot: string): void {
  process.env[RELAY_BUNDLED_NODE_ENV] = nodePath;
  process.env[RELAY_LITEPARSE_RUNNER_ROOT_ENV] = runnerRoot;
}

function preparePdfReader(): PdfReaderStatus {
  if (process.env.RELAY_SKIP_LITEPARSE_BOOTSTRAP === '1') {
    return {
      state: 'skipped',
      reason: 'disabled',
    };
  }
  const explicitNode = process.env[RELAY_BUNDLED_NODE_ENV]?.trim();
  const explicitRunner = process.env[RELAY_LITEPARSE_RUNNER_ROOT_ENV]?.trim();
  if (explicitNode && explicitRunner && existsSync(explicitNode) && existsSync(join(explicitRunner, 'parse.mjs'))) {
    registerPdfReader(resolve(explicitNode), resolve(explicitRunner));
    return {
      state: 'ready-env',
      nodePath: resolve(explicitNode),
      runnerRoot: resolve(explicitRunner),
    };
  }

  const nodePath = resolveBundledNodePath();
  const runnerRoot = resolveBundledLiteparseRunnerRoot();
  if (!nodePath || !runnerRoot) {
    return {
      state: 'needs_attention',
      nodePath: nodePath ?? undefined,
      runnerRoot: runnerRoot ?? undefined,
      message: 'Bundled Node or LiteParse runner was not found; PDF text evidence will remain filename-only.',
    };
  }
  registerPdfReader(nodePath, runnerRoot);
  return {
    state: 'ready-bundled',
    nodePath,
    runnerRoot,
  };
}

function prepareRipgrep(): RipgrepStatus {
  const targetPath = aionCliRipgrepPath();
  if (process.env.RELAY_SKIP_RIPGREP_BOOTSTRAP === '1') {
    return {
      state: 'skipped',
      path: targetPath,
      reason: 'disabled',
    };
  }

  const bundledPath = resolveBundledRipgrepPath();
  if (!bundledPath) {
    if (existsSync(targetPath)) {
      registerRipgrepPath(targetPath);
      return {
        state: 'ready-reused',
        path: targetPath,
        reason: 'existing-aioncli-cache',
      };
    }
    return {
      state: 'needs_attention',
      path: targetPath,
      message: 'Bundled ripgrep was not found; AionUi may fall back to downloading rg or slower grep search.',
    };
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  if (resolve(bundledPath) !== resolve(targetPath)) {
    copyFileSync(bundledPath, targetPath);
  }
  try {
    chmodSync(targetPath, 0o755);
  } catch {
    // Best effort on Windows.
  }
  registerRipgrepPath(targetPath);
  return {
    state: resolve(bundledPath) === resolve(targetPath) ? 'ready-env' : 'ready-copied',
    path: targetPath,
    source: bundledPath,
  };
}

async function downloadOfficeCliArtifact(outputPath: string): Promise<OfficeCliStatus> {
  if (existsSync(outputPath)) {
    const verified = verifyOfficeCliArtifactFile(outputPath);
    registerOfficeCliPath(outputPath);
    return {
      state: 'ready-reused',
      path: outputPath,
      ...verified,
    };
  }
  if (typeof fetch !== 'function') {
    throw new Error('fetch is unavailable; Electron Node runtime is required for OfficeCLI bootstrap');
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.download`;
  rmSync(tempPath, { force: true });

  try {
    const response = await fetch(RELAY_OFFICECLI_URL);
    if (!response.ok) {
      throw new Error(`OfficeCLI download failed with HTTP ${response.status} for ${RELAY_OFFICECLI_URL}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    verifyOfficeCliArtifactBuffer(buffer);
    writeFileSync(tempPath, buffer, { mode: 0o755 });
    const verified = verifyOfficeCliArtifactFile(tempPath);
    renameSync(tempPath, outputPath);
    try {
      chmodSync(outputPath, 0o755);
    } catch {
      // Best effort on Windows.
    }
    registerOfficeCliPath(outputPath);
    return {
      state: 'ready-downloaded',
      path: outputPath,
      ...verified,
    };
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

async function prepareOfficeCli(): Promise<OfficeCliStatus> {
  const expectedPath = officeCliCachedPath();
  process.env[RELAY_OFFICECLI_EXPECTED_PATH_ENV] = expectedPath;

  if (process.env.RELAY_SKIP_OFFICECLI_BOOTSTRAP === '1') {
    return {
      state: 'skipped',
      path: expectedPath,
      reason: 'disabled',
    };
  }

  const explicitPath = process.env[RELAY_OFFICECLI_PATH_ENV]?.trim();
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`RELAY_OFFICECLI_PATH was set but OfficeCLI was not found: ${explicitPath}`);
    }
    registerOfficeCliPath(explicitPath);
    return {
      state: 'ready-env',
      path: explicitPath,
    };
  }

  if (process.platform !== 'win32' && process.env.RELAY_OFFICECLI_BOOTSTRAP_NON_WINDOWS !== '1') {
    return {
      state: 'skipped',
      path: expectedPath,
      reason: 'non-windows-host',
    };
  }

  return downloadOfficeCliArtifact(expectedPath);
}

function readOrCreateToken(): string {
  const envToken = process.env.RELAY_AGENT_API_KEY?.trim();
  if (envToken) return envToken;

  const filePath = relayTokenFilePath();
  if (existsSync(filePath)) {
    const existingToken = readFileSync(filePath, 'utf8').trim();
    if (existingToken) return existingToken;
  }

  const token = randomUUID();
  writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return token;
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function relayGatewayCandidates(): string[] {
  const resourcesPath = process.resourcesPath || '';
  const appPath = app.getAppPath();
  return [
    process.env.RELAY_GATEWAY_DIR || '',
    resourcesPath ? join(resourcesPath, 'relay-gateway') : '',
    appPath ? join(dirname(appPath), 'relay-gateway') : '',
    appPath ? join(appPath, 'resources', 'relay-gateway') : '',
    join(process.cwd(), 'resources', 'relay-gateway'),
    join(process.cwd(), 'apps/desktop/src-tauri/binaries'),
  ].filter(Boolean);
}

function resolveRelayGatewayDir(): string | null {
  for (const candidate of relayGatewayCandidates()) {
    const dir = resolve(candidate);
    if (!existsSync(join(dir, 'copilot_server.js'))) continue;
    const missing = GATEWAY_FILES.filter((file) => !existsSync(join(dir, file)));
    if (missing.length === 0) return dir;
  }
  return null;
}

function writeStatus(status: Record<string, unknown>): string {
  const statusFile = relayStatusFilePath();
  writeFileSync(statusFile, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...status }, null, 2)}\n`, {
    encoding: 'utf8',
  });
  return statusFile;
}

function appendGatewayLog(line: string): void {
  try {
    appendFileSync(join(relayDataDir(), 'relay-gateway.log'), line, 'utf8');
  } catch {
    // Logging must not block app startup.
  }
}

function providerBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

function aionrsBaseUrlForRelay(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

function relayReadyStatus({
  baseUrl,
  seedFile,
  cdpPort,
  gatewayDir,
  officeCli,
  ripgrep,
  pdfReader,
  sharedSearch,
  prewarm,
}: {
  baseUrl: string;
  seedFile: string;
  cdpPort: number;
  gatewayDir: string;
  officeCli?: OfficeCliStatus;
  ripgrep?: RipgrepStatus;
  pdfReader?: PdfReaderStatus;
  sharedSearch?: SharedSearchStatus;
  prewarm?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    state: 'ready',
    baseUrl,
    seedFile,
    cdpPort,
    gatewayDir,
    ...(officeCli ? { officeCli } : {}),
    ...(ripgrep ? { ripgrep } : {}),
    ...(pdfReader ? { pdfReader } : {}),
    ...(sharedSearch ? { sharedSearch } : {}),
    ...(prewarm ? { prewarm } : {}),
  };
}

function relayDefaultModel(): { id: string; useModel: string } {
  return {
    id: RELAY_PROVIDER_ID,
    useModel: RELAY_MODEL_ID,
  };
}

function relayProviderConfig(baseUrl: string, apiKey: string): Record<string, unknown> {
  return {
    id: RELAY_PROVIDER_ID,
    platform: 'custom',
    name: RELAY_PROVIDER_NAME,
    baseUrl,
    apiKey,
    model: [RELAY_MODEL_ID],
    useModel: RELAY_MODEL_ID,
    enabled: true,
    modelEnabled: {
      [RELAY_MODEL_ID]: true,
    },
    capabilities: [
      {
        type: 'text',
        isUserSelected: true,
      },
      {
        type: 'function_calling',
        isUserSelected: true,
      },
    ],
    contextLimit: RELAY_CONTEXT_LIMIT,
  };
}

function relayAssistantCatalog(): Record<string, unknown> {
  return {
    mode: 'curated',
    visiblePresetIds: [...RELAY_VISIBLE_ASSISTANT_PRESET_IDS],
    hiddenPresetIds: [...RELAY_HIDDEN_ASSISTANT_PRESET_IDS],
    hideUnlistedBuiltinPresets: true,
    beginnerTaskLabels: [...RELAY_BEGINNER_TASK_LABELS],
    advancedAccess: 'advanced-only',
  };
}

function relaySeedBundle(baseUrl: string, apiKey: string): Record<string, unknown> {
  const provider = relayProviderConfig(baseUrl, apiKey);
  const assistantCatalog = relayAssistantCatalog();
  const defaults = {
    'model.config': [provider],
    'aionrs.defaultModel': relayDefaultModel(),
    'gemini.defaultModel': relayDefaultModel(),
    'webui.desktop.enabled': false,
    'webui.desktop.allowRemote': false,
    'relay.advancedSurfaces.enabled': false,
    'relay.channels.enabled': false,
    'relay.providerOnboarding.enabled': false,
    'relay.remoteAccess.enabled': false,
    'relay.workspaceSearch.enabled': true,
    'relay.workspaceSearch.surface': 'aionui',
    'relay.workspaceSearch.integrationMode': 'skills-first',
    'relay.workspaceSearch.rendererPolicy': 'lightweight-aionui-result-renderers',
    'relay.workspaceSearch.defaultSkillEntrypoints': [...RELAY_WORKSPACE_SEARCH_SKILLS],
    'relay.workspaceSearch.highLevelTool': { ...RELAY_DOCUMENT_SEARCH_HIGH_LEVEL_TOOL },
    'relay.workspaceSearch.legacyDiagnosticShell': false,
    'relay.workspaceSearch.hiddenBeginnerTerms': [...RELAY_WORKSPACE_SEARCH_HIDDEN_TERMS],
    'relay.aionuiUx.integrationMode': 'reuse-core-conversation-workspace-preview',
    'relay.aionuiUx.primaryEntrypoint': 'guid-page-task-launcher',
    'relay.aionuiUx.searchEntrypoints': [...RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS],
    'relay.aionuiUx.reusedSurfaces': [...RELAY_AIONUI_UX_REUSED_SURFACES],
    'relay.aionuiUx.resultPlacement': 'chat-message-plus-preview-panel',
    'relay.aionuiUx.noNewSearchShell': true,
    'relay.aionuiUx.noFullAssistantGalleryDefault': true,
    'relay.guidUx.mode': 'curated-task-launcher',
    'relay.guidUx.primarySurface': 'GuidPage',
    'relay.guidUx.beginnerFlowSteps': [...RELAY_GUID_BEGINNER_FLOW_STEPS],
    'relay.guidUx.requiredControls': [...RELAY_GUID_REQUIRED_CONTROLS],
    'relay.guidUx.defaultTaskEntries': [...RELAY_BEGINNER_TASK_LABELS],
    'relay.guidUx.primaryCta': 'aionui-normal-send-flow',
    'relay.guidUx.startAction': { ...RELAY_GUID_START_ACTION },
    'relay.guidUx.noStandaloneSearchStartButton': true,
    'relay.guidUx.examplePromptStrategy': 'task-aware-recent-and-popular',
    'relay.guidUx.examplePrompts': [...RELAY_GUID_EXAMPLE_PROMPTS],
    'relay.guidUx.allowSkipTutorial': true,
    'relay.guidUx.noForcedTour': true,
    'relay.searchUx.stateLabels': [...RELAY_SEARCH_STATE_LABELS],
    'relay.searchUx.noResultsGuidance': true,
    'relay.searchUx.resultCardFields': [...RELAY_SEARCH_RESULT_CARD_FIELDS],
    'relay.searchUx.resultCardActions': [...RELAY_SEARCH_RESULT_CARD_ACTIONS],
    'relay.searchUx.resultBatching': { ...RELAY_SEARCH_RESULT_BATCHING },
    'relay.searchUx.emptyStateActions': [...RELAY_SEARCH_EMPTY_STATE_ACTIONS],
    'relay.searchUx.defaultSearchMode': 'thorough',
    'relay.searchUx.quickCandidateMode': 'progress-only',
    'relay.searchUx.confirmedResultRequirement': 'content-or-evidence-backed',
    'relay.searchUx.queryPlanning': { ...RELAY_QUERY_PLANNING },
    'relay.searchUx.autocomplete': 'debounced-suggestions',
    'relay.searchUx.progressiveDisclosure': 'status-chip-to-details-drawer',
    'relay.searchUx.answerBoundary': 'candidate-until-evidence-backed',
    'relay.beginnerUx.visibleSettingsTabs': [...RELAY_BEGINNER_VISIBLE_SETTINGS_TABS],
    'relay.beginnerUx.hiddenSettingsTabs': [...RELAY_BEGINNER_HIDDEN_SETTINGS_TABS],
    'relay.beginnerUx.hiddenSurfaces': [...RELAY_BEGINNER_HIDDEN_SURFACES],
    'relay.beginnerUx.hideSkillsMarketBanner': true,
    'relay.beginnerUx.hideModelAndModeSwitchers': true,
    'relay.beginnerUx.hideExtensionSettings': true,
    'relay.beginnerUx.advancedSurfacesGate': 'relay.advancedSurfaces.enabled',
    'skillsMarket.enabled': false,
    'system.autoPreviewOfficeFiles': true,
    'tools.useRipgrep': true,
    'relay.defaultEnabledSkills': [...RELAY_DEFAULT_SKILLS],
    'relay.defaultAssistantPresetIds': RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
    'relay.assistantCatalog.mode': assistantCatalog.mode,
    'relay.assistantCatalog.visiblePresetIds': assistantCatalog.visiblePresetIds,
    'relay.assistantCatalog.hiddenPresetIds': assistantCatalog.hiddenPresetIds,
    'relay.assistantCatalog.hideUnlistedBuiltinPresets': assistantCatalog.hideUnlistedBuiltinPresets,
    'relay.assistantCatalog.beginnerTaskLabels': assistantCatalog.beginnerTaskLabels,
    'relay.assistantCatalog.advancedAccess': assistantCatalog.advancedAccess,
  };

  return {
    schemaVersion: 1,
    source: RELAY_PROVIDER_ID,
    provider,
    defaults,
    launch: {
      providerBaseUrl: baseUrl,
      modelRef: `${RELAY_PROVIDER_ID}/${RELAY_MODEL_ID}`,
      aionrsBaseUrl: aionrsBaseUrlForRelay(baseUrl),
      gatewayMustStartBeforeShell: true,
    },
    skills: {
      enabledByDefault: [...RELAY_DEFAULT_SKILLS],
      assistantPresets: RELAY_DEFAULT_ASSISTANTS.map((assistant) => {
        const preset: Record<string, unknown> = {
          id: assistant.id,
          defaultEnabledSkills: [...assistant.defaultEnabledSkills],
        };
        if ('assistant' in assistant && assistant.assistant) {
          preset.assistant = {
            ...assistant.assistant,
            enabledSkills: [...assistant.defaultEnabledSkills],
          };
        }
        return preset;
      }),
      assistantCatalog,
    },
    ux: {
      aionUiCore: {
        primaryEntrypoint: 'guid-page-task-launcher',
        searchEntrypoints: [...RELAY_AIONUI_UX_SEARCH_ENTRYPOINTS],
        reusedSurfaces: [...RELAY_AIONUI_UX_REUSED_SURFACES],
      },
      guidBeginnerFlow: {
        mode: 'curated-task-launcher',
        primarySurface: 'GuidPage',
        flowSteps: [...RELAY_GUID_BEGINNER_FLOW_STEPS],
        requiredControls: [...RELAY_GUID_REQUIRED_CONTROLS],
        primaryCta: 'aionui-normal-send-flow',
        startAction: { ...RELAY_GUID_START_ACTION },
        examplePrompts: [...RELAY_GUID_EXAMPLE_PROMPTS],
      },
      search: {
        states: [...RELAY_SEARCH_STATE_LABELS],
        resultCardFields: [...RELAY_SEARCH_RESULT_CARD_FIELDS],
        resultCardActions: [...RELAY_SEARCH_RESULT_CARD_ACTIONS],
        resultBatching: { ...RELAY_SEARCH_RESULT_BATCHING },
        emptyStateActions: [...RELAY_SEARCH_EMPTY_STATE_ACTIONS],
        defaultSearchMode: 'thorough',
        quickCandidateMode: 'progress-only',
        confirmedResultRequirement: 'content-or-evidence-backed',
        queryPlanning: { ...RELAY_QUERY_PLANNING },
      },
      beginnerVisibility: {
        visibleSettingsTabs: [...RELAY_BEGINNER_VISIBLE_SETTINGS_TABS],
        hiddenSettingsTabs: [...RELAY_BEGINNER_HIDDEN_SETTINGS_TABS],
        hiddenSurfaces: [...RELAY_BEGINNER_HIDDEN_SURFACES],
        advancedSurfacesGate: 'relay.advancedSurfaces.enabled',
      },
    },
  };
}

function writeRelaySeed(baseUrl: string, apiKey: string): string {
  const seedFile = relaySeedFilePath();
  writeFileSync(seedFile, `${JSON.stringify(relaySeedBundle(baseUrl, apiKey), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    chmodSync(seedFile, 0o600);
  } catch {
    // Best effort on Windows.
  }
  process.env[RELAY_SEED_FILE_ENV] = seedFile;
  return seedFile;
}

function waitForGatewayPort(portFile: string, child: ChildProcess, timeoutMs = 20000): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const stderrTail: string[] = [];
    let interval: ReturnType<typeof setInterval>;
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = (): void => {
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('error', onError);
      child.stderr?.off('data', onStderr);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const succeed = (port: number): void => {
      if (settled) return;
      cleanup();
      resolvePromise(port);
    };

    const readPort = (): void => {
      if (!existsSync(portFile)) return;
      const value = Number.parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isFinite(value) && value > 0) succeed(value);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      fail(new Error(`copilot server exited before writing a port (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    };
    const onError = (error: Error): void => {
      fail(error);
    };
    const onStderr = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      appendGatewayLog(text);
      stderrTail.push(text.trim());
      while (stderrTail.length > 20) stderrTail.shift();
    };

    child.once('exit', onExit);
    child.once('error', onError);
    child.stderr?.on('data', onStderr);

    interval = setInterval(readPort, 100);
    timeout = setTimeout(() => {
      fail(
        new Error(
          `copilot server did not report a listening port within ${timeoutMs} ms` +
            (stderrTail.length ? `; stderr: ${stderrTail.join(' | ')}` : ''),
        ),
      );
    }, timeoutMs);

    readPort();
  });
}

function registerQuitHandler(): void {
  if (quitHandlerRegistered) return;
  quitHandlerRegistered = true;
  app.on('before-quit', stopRelayGateway);
}

export function stopRelayGateway(): void {
  if (!relayGatewayProcess || relayGatewayProcess.killed) return;
  relayGatewayProcess.kill('SIGTERM');
}

async function fetchRelayPrewarm(baseUrl: string, token: string): Promise<Record<string, unknown>> {
  const timeoutMs = intEnv('RELAY_COPILOT_PREWARM_TIMEOUT_MS', 120000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${aionrsBaseUrlForRelay(baseUrl)}/prewarm`;
  try {
    const response = await fetch(url, {
      headers: {
        'X-Relay-Boot-Token': token,
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `prewarm HTTP ${response.status}` +
          (typeof body.message === 'string' ? `: ${body.message}` : ''),
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function startRelayGatewayPrewarm({
  baseUrl,
  seedFile,
  cdpPort,
  gatewayDir,
  token,
  officeCli,
  ripgrep,
  pdfReader,
  sharedSearch,
}: {
  baseUrl: string;
  seedFile: string;
  cdpPort: number;
  gatewayDir: string;
  token: string;
  officeCli?: OfficeCliStatus;
  ripgrep?: RipgrepStatus;
  pdfReader?: PdfReaderStatus;
  sharedSearch?: SharedSearchStatus;
}): void {
  if (relayGatewayPrewarmStarted) return;
  relayGatewayPrewarmStarted = true;
  if (process.env.RELAY_AIONUI_DISABLE_COPILOT_PREWARM === '1') {
    writeStatus(
      relayReadyStatus({
        baseUrl,
        seedFile,
        cdpPort,
        gatewayDir,
        officeCli,
        ripgrep,
        pdfReader,
        sharedSearch,
        prewarm: { state: 'disabled', message: 'Copilot background prewarm disabled by environment.' },
      }),
    );
    return;
  }

  writeStatus(
    relayReadyStatus({
      baseUrl,
      seedFile,
      cdpPort,
      gatewayDir,
      officeCli,
      ripgrep,
      pdfReader,
      sharedSearch,
      prewarm: { state: 'starting', message: 'Opening Microsoft 365 Copilot in the background.' },
    }),
  );

  void fetchRelayPrewarm(baseUrl, token)
    .then((status) => {
      const connected = status.connected === true;
      const prewarmed = status.prewarmed === true;
      const loginRequired = status.loginRequired === true;
      const url = typeof status.url === 'string' ? status.url : null;
      const message =
        typeof status.error === 'string'
          ? status.error
          : loginRequired
            ? 'Microsoft 365 sign-in is required before Relay can use Copilot.'
            : prewarmed
              ? 'Microsoft 365 Copilot is ready for the first request.'
              : connected
                ? 'Microsoft 365 Copilot is open; first request may still prepare a new chat.'
                : 'Microsoft 365 Copilot did not report ready.';
      writeStatus(
        relayReadyStatus({
          baseUrl,
          seedFile,
          cdpPort,
          gatewayDir,
          officeCli,
          ripgrep,
          pdfReader,
          sharedSearch,
          prewarm: {
            state: loginRequired ? 'needs_sign_in' : prewarmed ? 'ready' : connected ? 'page_ready' : 'needs_attention',
            message,
            connected,
            prewarmed,
            loginRequired,
            ...(url ? { url } : {}),
          },
        }),
      );
      appendGatewayLog(`[RelayGateway] Copilot prewarm: ${message}\n`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeStatus(
        relayReadyStatus({
          baseUrl,
          seedFile,
          cdpPort,
          gatewayDir,
          officeCli,
          ripgrep,
          pdfReader,
          sharedSearch,
          prewarm: {
            state: 'needs_attention',
            message,
            connected: false,
            prewarmed: false,
            loginRequired: false,
          },
        }),
      );
      appendGatewayLog(`[RelayGateway] Copilot prewarm failed: ${message}\n`);
    });
}

export async function startRelayGatewayBeforeShell(): Promise<RelayGatewayStartupResult> {
  if (process.env.RELAY_AIONUI_DISABLE_GATEWAY_AUTOSTART === '1') {
    relayGatewayResult = {
      state: 'disabled',
      statusFile: writeStatus({ state: 'disabled', message: 'Relay gateway autostart disabled by environment.' }),
    };
    return relayGatewayResult;
  }

  if (relayGatewayResult?.state === 'ready') return relayGatewayResult;

  registerQuitHandler();
  const statusFile = writeStatus({ state: 'starting', message: 'Starting Relay local M365 Copilot gateway.' });
  const gatewayDir = resolveRelayGatewayDir();
  if (!gatewayDir) {
    relayGatewayResult = {
      state: 'needs_attention',
      statusFile,
      message: 'Bundled Relay gateway files were not found.',
    };
    writeStatus({ state: 'needs_attention', message: relayGatewayResult.message });
    return relayGatewayResult;
  }

  let officeCli: OfficeCliStatus | undefined;
  let ripgrep: RipgrepStatus | undefined;
  let pdfReader: PdfReaderStatus | undefined;
  const sharedSearch = applySharedSearchDefaults();
  try {
    writeStatus({ state: 'starting', message: 'Preparing bundled ripgrep for fast shared-folder search.', gatewayDir, sharedSearch });
    ripgrep = prepareRipgrep();
    appendGatewayLog(
      `[RelayGateway] ripgrep ${ripgrep.state}: ${ripgrep.path}${ripgrep.reason ? ` (${ripgrep.reason})` : ''}\n`,
    );
    appendGatewayLog(`[RelayGateway] shared search defaults: ${JSON.stringify(sharedSearch.defaults)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ripgrep = {
      state: 'needs_attention',
      path: aionCliRipgrepPath(),
      message,
    };
    appendGatewayLog(`[RelayGateway] ripgrep bootstrap failed: ${message}\n`);
  }

  try {
    writeStatus({ state: 'starting', message: 'Preparing LiteParse PDF reader for document search.', gatewayDir, ripgrep, sharedSearch });
    pdfReader = preparePdfReader();
    appendGatewayLog(
      `[RelayGateway] PDF reader ${pdfReader.state}: node=${pdfReader.nodePath ?? 'none'} runner=${pdfReader.runnerRoot ?? 'none'}${pdfReader.reason ? ` (${pdfReader.reason})` : ''}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pdfReader = {
      state: 'needs_attention',
      message,
    };
    appendGatewayLog(`[RelayGateway] PDF reader bootstrap failed: ${message}\n`);
  }

  try {
    writeStatus({ state: 'starting', message: 'Preparing OfficeCLI for Office file tools.', gatewayDir, ripgrep, pdfReader, sharedSearch });
    officeCli = await prepareOfficeCli();
    appendGatewayLog(`[RelayGateway] OfficeCLI ${officeCli.state}: ${officeCli.path}${officeCli.reason ? ` (${officeCli.reason})` : ''}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    officeCli = {
      state: 'needs_attention',
      path: officeCliCachedPath(),
      message,
    };
    appendGatewayLog(`[RelayGateway] OfficeCLI bootstrap failed: ${message}\n`);
  }
  writeStatus({ state: 'starting', message: 'Starting Relay local M365 Copilot gateway.', gatewayDir, officeCli, ripgrep, pdfReader, sharedSearch });

  const token = readOrCreateToken();
  const cdpPort = intEnv('RELAY_EDGE_CDP_PORT', DEFAULT_RELAY_EDGE_CDP_PORT);
  const instanceId = randomUUID();
  const portFile = join(relayDataDir(), `provider-port-${instanceId}.txt`);
  try {
    rmSync(portFile, { force: true });
  } catch {
    // Ignore stale file cleanup failures; port wait will fail if it cannot be overwritten.
  }

  const scriptPath = join(gatewayDir, 'copilot_server.js');
  relayGatewayProcess = spawn(process.execPath, [
    '--no-warnings',
    scriptPath,
    '--port',
    '0',
    '--cdp-port',
    String(cdpPort),
    '--boot-token',
    token,
    '--instance-id',
    instanceId,
    '--port-file',
    portFile,
  ], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      RELAY_AGENT_API_KEY: token,
      RELAY_EDGE_CDP_PORT: String(cdpPort),
      RELAY_COPILOT_NO_WINDOW_FOCUS: process.env.RELAY_COPILOT_NO_WINDOW_FOCUS || '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  relayGatewayProcess.on('exit', (code, signal) => {
    appendGatewayLog(`[RelayGateway] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    if (relayGatewayResult?.state === 'ready') {
      writeStatus({ state: 'needs_attention', message: 'Relay gateway stopped.', code, signal });
    }
  });

  try {
    const port = await waitForGatewayPort(portFile, relayGatewayProcess);
    const baseUrl = providerBaseUrl(port);
    const seedFile = writeRelaySeed(baseUrl, token);
    relayGatewayResult = {
      state: 'ready',
      baseUrl,
      seedFile,
      statusFile,
    };
    writeStatus(relayReadyStatus({ baseUrl, seedFile, cdpPort, gatewayDir, officeCli, ripgrep, pdfReader, sharedSearch }));
    startRelayGatewayPrewarm({ baseUrl, seedFile, cdpPort, gatewayDir, token, officeCli, ripgrep, pdfReader, sharedSearch });
    return relayGatewayResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stopRelayGateway();
    relayGatewayResult = {
      state: 'needs_attention',
      statusFile,
      message,
    };
    writeStatus({ state: 'needs_attention', message, gatewayDir, officeCli, ripgrep, pdfReader, sharedSearch });
    return relayGatewayResult;
  }
}
