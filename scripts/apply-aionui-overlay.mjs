#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const manifestPath = resolve(repoRoot, "apps/desktop/src-tauri/bootstrap/aionui-relay.json");
const desktopIconRoot = resolve(repoRoot, "apps/desktop/src-tauri/icons");
const relayJapaneseFontMarker = "/* Relay Agent Japanese UI font override */";
const relayJapaneseUiFontStack =
  '"Yu Gothic UI", "Meiryo UI", "Yu Gothic", Meiryo, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "BIZ UDPGothic", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const relayJapaneseMonoFontStack =
  'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", "Noto Sans Mono CJK JP", monospace';
const relaySharedFolderSearchMarker = "Relay Agent shared-folder search override";
const relaySharedFolderGrepMarker = "Relay Agent shared-folder grep override";
const rendererThemeBaseCandidates = [
  "src/renderer/styles/themes/base.css",
  "src/renderer/styles/base.css",
  "src/renderer/styles/global.css",
  "src/renderer/index.css",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function relayBranding() {
  return readJson(manifestPath).branding;
}

function relayAgentVersion() {
  return readJson(resolve(repoRoot, "apps/desktop/package.json")).version;
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function copyOverlayProcessUtils(overlayRoot, targetRoot) {
  const sourceDir = resolve(overlayRoot, "src/process/utils");
  const targetDir = resolve(targetRoot, "src/process/utils");
  mkdirSync(targetDir, { recursive: true });

  for (const fileName of readdirSync(sourceDir)) {
    if (!fileName.endsWith(".ts")) continue;
    copyFileSync(resolve(sourceDir, fileName), resolve(targetDir, fileName));
  }
}

export function isCliEntrypoint(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(resolve(argv1)).href;
}

function replaceLine(input, pattern, replacement) {
  if (!pattern.test(input)) {
    throw new Error(`Could not find branding patch anchor: ${pattern}`);
  }
  return input.replace(pattern, replacement);
}

function replaceYamlScalar(input, key, value) {
  return replaceLine(input, new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
}

export function patchInitStorageContent(input) {
  let output = input;
  const importLine = "import { applyRelayAssistantSeed, applyRelayProviderSeed } from './relaySeed';";

  if (!output.includes(importLine)) {
    const anchor = "import { migrateFromElectronConfig, importConfigFromFile } from './configMigration';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage configMigration import anchor");
    }
    output = output.replace(anchor, `${anchor}\n${importLine}`);
  }

  const providerMarker = "mark('3.2 relaySeed')";
  if (!output.includes(providerMarker)) {
    const anchor = "    mark('3.1 configMigration');\n  }\n\n  // 4.";
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage provider seed insertion anchor");
    }
    output = output.replace(
      anchor,
      [
        "    mark('3.1 configMigration');",
        "  }",
        "",
        "  await applyRelayProviderSeed(configFile);",
        "  mark('3.2 relaySeed');",
        "",
        "  // 4.",
      ].join("\n"),
    );
  }

  const assistantMarker = "await applyRelayAssistantSeed(configFile);";
  if (!output.includes(assistantMarker)) {
    const anchor = [
      "    if (needsPromptsI18nMigration) {",
      "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
      "    }",
      "    mark('5.2 assistant config + migrations');",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find initStorage assistant seed insertion anchor");
    }
    output = output.replace(
      anchor,
      [
        "    if (needsPromptsI18nMigration) {",
        "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
        "    }",
        "    await applyRelayAssistantSeed(configFile);",
        "    mark('5.2 assistant config + migrations');",
      ].join("\n"),
    );
  }

  return output;
}

export function patchPackageJsonContent(input, branding = relayBranding()) {
  const packageJson = JSON.parse(input);
  packageJson.name = branding.packageName;
  packageJson.version = relayAgentVersion();
  packageJson.description = "Relay Agent desktop shell for Microsoft 365 Copilot and Office workflows.";
  packageJson.author = {
    name: branding.supportName,
  };
  packageJson.productName = branding.productName;
  return ensureTrailingNewline(JSON.stringify(packageJson, null, 2));
}

export function patchIndexContent(input, branding = relayBranding()) {
  let output = input;
  const importLine = "import { startRelayGatewayBeforeShell, type RelayGatewayStartupResult } from './process/utils/relayGateway';";
  const oldImportLine = "import { startRelayGatewayBeforeShell } from './process/utils/relayGateway';";

  if (output.includes(oldImportLine)) {
    output = output.replace(oldImportLine, importLine);
  }

  if (!output.includes(importLine)) {
    const anchor = "import { ProcessConfig } from './process/utils/initStorage';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find index ProcessConfig import anchor");
    }
    output = output.replace(anchor, `${anchor}\n${importLine}`);
  }

  const electronImport = "import { app, BrowserWindow, nativeImage, net, powerMonitor, protocol, screen } from 'electron';";
  const electronImportWithDialog =
    "import { app, BrowserWindow, dialog, nativeImage, net, powerMonitor, protocol, screen } from 'electron';";
  if (output.includes(electronImport)) {
    output = output.replace(electronImport, electronImportWithDialog);
  }

  output = output.replace(
    /(\n\s*height:\s*windowHeight,\n)(\s*title:\s*['"][^'"]+['"],\n)?(\s*show:\s*false,)/u,
    `$1    title: '${branding.windowTitle || branding.productName}',\n$3`,
  );

  const oldGatewayStartupBlock = [
    "  if (!isWebUIMode && !isResetPasswordMode) {",
    "    await startRelayGatewayBeforeShell();",
    "    mark('relayGateway');",
    "  }",
  ].join("\n");
  const gatewayStartupBlock = [
    "  let relayGatewayStartup: RelayGatewayStartupResult | null = null;",
    "  if (!isWebUIMode && !isResetPasswordMode) {",
    "    relayGatewayStartup = await startRelayGatewayBeforeShell();",
    "    mark('relayGateway');",
    "  }",
  ].join("\n");

  if (output.includes(oldGatewayStartupBlock)) {
    output = output.replace(oldGatewayStartupBlock, gatewayStartupBlock);
  } else if (!output.includes("mark('relayGateway')")) {
    const anchor = [
      "  try {",
      "    await initializeProcess();",
      "    mark('initializeProcess');",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find index initializeProcess anchor");
    }
    output = output.replace(
      anchor,
      [
        gatewayStartupBlock,
        "",
        "  try {",
        "    await initializeProcess();",
        "    mark('initializeProcess');",
      ].join("\n"),
    );
  }

  if (!output.includes("relayGatewayStartup?.state === 'needs_attention'")) {
    const anchor = [
      "    createWindow({ showOnReady: showMainWindowOnReady });",
      "    appReadyDone = true;",
      "    mark('createWindow');",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find index createWindow anchor");
    }
    output = output.replace(
      anchor,
      [
        "    createWindow({ showOnReady: showMainWindowOnReady });",
        "    appReadyDone = true;",
        "    mark('createWindow');",
        "",
        "    if (relayGatewayStartup?.state === 'needs_attention') {",
        "      dialog",
        "        .showMessageBox(mainWindow, {",
        "          type: 'warning',",
        "          title: 'Relay Agent setup needs attention',",
        "          message: 'Relay could not start the local Microsoft 365 Copilot gateway.',",
        "          detail:",
        "            'Relay Agent opened, but Copilot requests will not run until the local gateway starts. ' +",
        "            'Close other Relay Agent windows and restart the app. ' +",
        "            `Detail: ${relayGatewayStartup.message || 'No additional detail was reported.'}`,",
        "          buttons: ['OK'],",
        "        })",
        "        .catch((error) => console.error('[RelayGateway] Failed to show setup warning:', error));",
        "    }",
      ].join("\n"),
    );
  }

  return output;
}

export function patchTrayContent(input, branding = relayBranding()) {
  return input.replace(/tray\.setToolTip\(['"][^'"]+['"]\);/u, `tray.setToolTip('${branding.productName}');`);
}

export function patchRendererIndexHtmlContent(input, branding = relayBranding()) {
  let output = input;
  output = output.replace(
    /<meta name="application-name" content="[^"]*" \/>/u,
    `<meta name="application-name" content="${branding.productName}" />`,
  );
  output = output.replace(
    /<meta name="apple-mobile-web-app-title" content="[^"]*" \/>/u,
    `<meta name="apple-mobile-web-app-title" content="${branding.productName}" />`,
  );
  output = output.replace(
    /<link rel="icon"[^>]*\/>/u,
    '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />',
  );
  output = output.replace(/<title>[^<]*<\/title>/u, `<title>${branding.browserTitle || branding.productName}</title>`);
  return output;
}

export function patchRendererThemeBaseContent(input) {
  if (input.includes(relayJapaneseFontMarker)) return ensureTrailingNewline(input);

  const fontOverride = [
    relayJapaneseFontMarker,
    ":root {",
    `  --relay-font-ja-ui: ${relayJapaneseUiFontStack};`,
    `  --relay-font-mono: ${relayJapaneseMonoFontStack};`,
    "}",
    "",
    "html,",
    "body,",
    "#root,",
    ".layout,",
    ".layout-content,",
    ".login-page,",
    ".arco-modal,",
    ".arco-drawer,",
    ".arco-popover,",
    ".arco-tooltip,",
    ".arco-message,",
    ".arco-notification,",
    ".markdown-body,",
    ".markdown-shadow-body {",
    "  font-family: var(--relay-font-ja-ui) !important;",
    "  text-rendering: optimizeLegibility;",
    "}",
    "",
    "button,",
    "input,",
    "textarea,",
    "select,",
    ".arco-btn,",
    ".arco-input,",
    ".arco-input-inner-wrapper,",
    ".arco-textarea,",
    ".arco-select,",
    ".arco-typography {",
    "  font-family: var(--relay-font-ja-ui) !important;",
    "}",
    "",
    "pre,",
    "code,",
    "kbd,",
    "samp,",
    ".monaco-editor,",
    ".cm-editor,",
    ".xterm {",
    "  font-family: var(--relay-font-mono) !important;",
    "}",
    "",
    "/* Relay Agent beginner mode: hide AionUi advanced model/mode controls. */",
    ".guid-config-btn,",
    ".header-model-btn,",
    ".agent-mode-compact-pill,",
    "[data-testid='btn-add-preset'],",
    ".header-settings-btn,",
    ".header-webui-btn,",
    ".feedback-button,",
    ".evaluation-button,",
    ".rating-button,",
    "[class*='guidQuickActions'],",
    ".speech-input-control,",
    ".speech-input-button,",
    ".context-usage-indicator,",
    "[data-testid='skills-indicator'],",
    "[data-testid='btn-settings'],",
    "[data-testid='btn-webui'],",
    "[data-testid='btn-feedback'],",
    "[data-testid='btn-evaluation'],",
    "[aria-label='Settings'],",
    "[aria-label='設定'],",
    "[aria-label='WebUI'] {",
    "  display: none !important;",
    "}",
  ].join("\n");

  return `${fontOverride}\n\n${ensureTrailingNewline(input)}`;
}

export function patchGuidPageContent(input) {
  let output = input;

  if (!output.includes("Relay Agent beginner mode: Skills Market hidden")) {
    output = output.replace("import SkillsMarketBanner from './components/SkillsMarketBanner';\n", "");
    const bannerAnchor = "        <SkillsMarketBanner />";
    if (!output.includes(bannerAnchor)) {
      throw new Error("Could not find GuidPage SkillsMarketBanner anchor");
    }
    output = output.replace(
      bannerAnchor,
      "        {/* Relay Agent beginner mode: Skills Market hidden. */}",
    );
  }

  if (!output.includes("Relay Agent beginner mode: quick action buttons hidden")) {
    output = output.replace("import QuickActionButtons from './components/QuickActionButtons';\n", "");
    output = output.replace(
      "import FeedbackReportModal from '@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal';\n",
      "",
    );
    output = output.replace(
      "import { openExternalUrl, resolveExtensionAssetUrl } from '@/renderer/utils/platform';",
      "import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';",
    );

    const quickActionStatePattern =
      /  const \[showFeedbackModal, setShowFeedbackModal\] = useState\(false\);\n\n  \/\/ Open external link\n  const openLink = useCallback\(async \(url: string\) => \{\n    try \{\n      await openExternalUrl\(url\);\n    \} catch \(error\) \{\n      console\.error\('Failed to open external link:', error\);\n    \}\n  \}, \[\]\);\n\n/u;
    output = output.replace(
      quickActionStatePattern,
      "  // Relay Agent beginner mode: quick action buttons hidden.\n\n",
    );

    const quickActionRenderAnchor = [
      "        <QuickActionButtons",
      "          onOpenLink={openLink}",
      "          onOpenBugReport={() => setShowFeedbackModal(true)}",
      "          inactiveBorderColor={inactiveBorderColor}",
      "          activeShadow={activeShadow}",
      "        />",
      "        <FeedbackReportModal visible={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />",
    ].join("\n");
    if (!output.includes(quickActionRenderAnchor)) {
      throw new Error("Could not find GuidPage quick action buttons anchor");
    }
    output = output.replace(
      quickActionRenderAnchor,
      "        {/* Relay Agent beginner mode: quick action buttons hidden. */}",
    );
  }

  if (!output.includes("Relay Agent send path: use guarded sendMessageHandler")) {
    const sendHandlerAnchor = [
      "      onSend={() => {",
      "        send.handleSend().catch((error) => {",
      "          console.error('Failed to send message:', error);",
      "        });",
      "      }}",
    ].join("\n");
    if (!output.includes(sendHandlerAnchor)) {
      throw new Error("Could not find GuidPage send handler anchor");
    }
    output = output.replace(
      sendHandlerAnchor,
      [
        "      // Relay Agent send path: use guarded sendMessageHandler for click and Enter parity.",
        "      onSend={send.sendMessageHandler}",
      ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent beginner mode: assistant edit hidden")) {
    const assistantEditAnchor = [
      "                  <Button",
      "                    size='mini'",
      "                    type='text'",
      "                    icon={<Write theme='outline' size={16} fill='currentColor' />}",
      "                    className={styles.heroTitleEdit}",
      "                    onClick={() => openAssistantDetailsRef.current?.()}",
      "                    aria-label={t('settings.editAssistant', { defaultValue: 'Assistant Details' })}",
      "                  />",
    ].join("\n");
    if (!output.includes(assistantEditAnchor)) {
      throw new Error("Could not find GuidPage assistant edit anchor");
    }
    output = output.replace(
      assistantEditAnchor,
      [
        "                  {false ? (",
        assistantEditAnchor,
        "                  ) : (",
        "                    /* Relay Agent beginner mode: assistant edit hidden. */",
        "                    null",
        "                  )}",
      ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent beginner mode: preset backend switcher hidden")) {
    const presetSwitcherPattern =
      /                <div className=\{styles\.heroHeaderRight\}>[\s\S]*?                  <\/Dropdown>\n                <\/div>/u;
    if (!presetSwitcherPattern.test(output)) {
      throw new Error("Could not find GuidPage preset backend switcher anchor");
    }
    output = output.replace(
      presetSwitcherPattern,
      (match) =>
        [
          "                {false ? (",
          match,
          "                ) : (",
          "                  /* Relay Agent beginner mode: preset backend switcher hidden. */",
          "                  null",
          "                )}",
        ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent beginner mode: detected agent selector hidden")) {
    const agentPillPattern =
      /          \) : agentSelection\.availableAgents === undefined \? \(\n            <AgentPillBarSkeleton \/>\n          \) : agentSelection\.availableAgents\.length > 0 \? \(\n            <AgentPillBar[\s\S]*?            \/>\n          \) : null\}/u;
    if (!agentPillPattern.test(output)) {
      throw new Error("Could not find GuidPage detected agent selector anchor");
    }
    output = output.replace(
      agentPillPattern,
      (match) => {
        const hiddenBranch = match.replace(/^          \) : /u, "").replace(/\}$/u, "");
        const indentedBranch = hiddenBranch
          .split("\n")
          .map((line) => `            ${line}`)
          .join("\n");
        return [
          "          ) : false ? (",
          indentedBranch,
          "          ) : (",
          "            /* Relay Agent beginner mode: detected agent selector hidden. */",
          "            null",
          "          )}",
        ].join("\n");
      },
    );
  }

  return output;
}

export function patchGuidSendContent(input) {
  let output = input;

  if (!output.includes("Relay Agent task mode helpers")) {
    const helperAnchor = [
      "export type GuidSendResult = {",
      "  handleSend: () => Promise<void>;",
      "  sendMessageHandler: () => void;",
      "  isButtonDisabled: boolean;",
      "};",
    ].join("\n");
    if (!output.includes(helperAnchor)) {
      throw new Error("Could not find useGuidSend result type anchor");
    }
    output = output.replace(
      helperAnchor,
      [
        helperAnchor,
        "",
        "// Relay Agent task mode helpers keep beginner workflows on their dedicated tool rails.",
        "type RelayGuidTaskMode = 'document_search' | 'office_edit';",
        "",
        "const RELAY_GUID_TASK_MODE_BY_ASSISTANT_ID: Record<string, RelayGuidTaskMode> = {",
        "  'relay-workspace-search': 'document_search',",
        "  'relay-office-edit': 'office_edit',",
        "};",
        "",
        "const RELAY_GUID_TASK_FIRST_TOOL_BY_MODE: Record<RelayGuidTaskMode, string> = {",
        "  document_search: 'relay_document_search',",
        "  office_edit: 'officecli',",
        "};",
        "",
        "function getRelayGuidTaskMode(presetAssistantId: string | undefined): RelayGuidTaskMode | undefined {",
        "  return presetAssistantId ? RELAY_GUID_TASK_MODE_BY_ASSISTANT_ID[presetAssistantId] : undefined;",
        "}",
        "",
        "function buildRelayGuidTaskInitialInput(input: string, mode: RelayGuidTaskMode, workspace: string): string {",
        "  const firstTool = RELAY_GUID_TASK_FIRST_TOOL_BY_MODE[mode];",
        "  return [",
        "    `RELAY_TASK_MODE: ${mode}`,",
        "    `RELAY_FIRST_TOOL: ${firstTool}`,",
        "    workspace ? `RELAY_WORKSPACE: ${workspace}` : 'RELAY_WORKSPACE: current AionUi workspace',",
        "    'USER_REQUEST:',",
        "    input,",
        "  ].join('\\n');",
        "}",
      ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent task mode selected from preset assistant")) {
    const modeAnchor = [
      "    const agentInfo = selectedAgentInfo;",
      "    const isPreset = isPresetAgent;",
      "    const presetAssistantId = isPreset ? agentInfo?.customAgentId : undefined;",
    ].join("\n");
    if (!output.includes(modeAnchor)) {
      throw new Error("Could not find useGuidSend preset assistant anchor");
    }
    output = output.replace(
      modeAnchor,
      [
        modeAnchor,
        "    // Relay Agent task mode selected from preset assistant.",
        "    const relayTaskMode = getRelayGuidTaskMode(presetAssistantId);",
      ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent task mode validation: fail visibly")) {
    const currentModelAnchor = [
      "      if (!currentModel) {",
      "        Message.warning(t('conversation.noModelConfigured'));",
      "        return;",
      "      }",
    ].join("\n");
    if (!output.includes(currentModelAnchor)) {
      throw new Error("Could not find useGuidSend aionrs model guard anchor");
    }
    output = output.replace(
      currentModelAnchor,
      [
        "      if (!currentModel) {",
        "        if (relayTaskMode) {",
        "          const message = 'Relay Agent model is not configured. Restart Relay Agent or check the Copilot provider settings.';",
        "          Message.error(message);",
        "          throw new Error(message);",
        "        }",
        "        // Relay Agent task mode validation: fail visibly instead of appearing to do nothing.",
        "        Message.warning(t('conversation.noModelConfigured'));",
        "        return;",
        "      }",
      ].join("\n"),
    );
  }

  if (!output.includes("relayTaskMode,")) {
    const extraAnchor = [
      "            presetAssistantId,",
      "            sessionMode: selectedMode,",
    ].join("\n");
    if (!output.includes(extraAnchor)) {
      throw new Error("Could not find useGuidSend aionrs extra anchor");
    }
    output = output.replace(
      extraAnchor,
      [
        "            presetAssistantId,",
        "            relayTaskMode,",
        "            relayTaskFirstTool: relayTaskMode ? RELAY_GUID_TASK_FIRST_TOOL_BY_MODE[relayTaskMode] : undefined,",
        "            sessionMode: selectedMode,",
      ].join("\n"),
    );
  }

  if (!output.includes("Relay Agent task mode message wrapper")) {
    const initialMessageAnchor = [
      "        const initialMessage = {",
      "          input,",
      "          files: files.length > 0 ? files : undefined,",
      "        };",
      "        sessionStorage.setItem(`aionrs_initial_message_${conversation.id}`, JSON.stringify(initialMessage));",
    ].join("\n");
    if (!output.includes(initialMessageAnchor)) {
      throw new Error("Could not find useGuidSend aionrs initial message anchor");
    }
    output = output.replace(
      initialMessageAnchor,
      [
        "        const initialInput = relayTaskMode",
        "          ? buildRelayGuidTaskInitialInput(input, relayTaskMode, finalWorkspace)",
        "          : input;",
        "        // Relay Agent task mode message wrapper.",
        "        const initialMessage = {",
        "          input,",
        "          agentInput: initialInput,",
        "          files: files.length > 0 ? files : undefined,",
        "        };",
        "        sessionStorage.setItem(`aionrs_initial_message_${conversation.id}`, JSON.stringify(initialMessage));",
      ].join("\n"),
    );
  }
  if (output.includes("input: initialInput,") && !output.includes("agentInput: initialInput,")) {
    output = output.replace(
      "          input: initialInput,\n",
      "          input,\n          agentInput: initialInput,\n",
    );
  }

  if (!output.includes("Relay Agent task mode conversation creation failure")) {
    const conversationGuardAnchor = [
      "        if (!conversation || !conversation.id) {",
      "          alert('Failed to create Aion CLI conversation. Please ensure aionrs is installed.');",
      "          return;",
      "        }",
    ].join("\n");
    if (!output.includes(conversationGuardAnchor)) {
      throw new Error("Could not find useGuidSend aionrs conversation guard anchor");
    }
    output = output.replace(
      conversationGuardAnchor,
      [
        "        if (!conversation || !conversation.id) {",
        "          const message = 'Failed to create Relay Agent conversation. Please restart Relay Agent and try again.';",
        "          if (relayTaskMode) {",
        "            // Relay Agent task mode conversation creation failure.",
        "            Message.error(message);",
        "            throw new Error(message);",
        "          }",
        "          alert('Failed to create Aion CLI conversation. Please ensure aionrs is installed.');",
        "          return;",
        "        }",
      ].join("\n"),
    );
  }

  return output;
}

export function patchGuidActionRowContent(input) {
  if (input.includes("Relay Agent beginner mode: auto skill menu hidden")) {
    return input;
  }

  const skillMenuAnchor = "      {builtinAutoSkills.length > 0 && (";
  if (!input.includes(skillMenuAnchor)) {
    throw new Error("Could not find GuidActionRow builtin auto skills menu anchor");
  }
  return input.replace(
    skillMenuAnchor,
    [
      "      {/* Relay Agent beginner mode: auto skill menu hidden. */}",
      "      {false && builtinAutoSkills.length > 0 && (",
    ].join("\n"),
  );
}

export function patchSendBoxContent(input) {
  let output = input;

  if (!output.includes("Relay Agent beginner mode: speech input hidden")) {
    output = output.replace("import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';\n", "");
    output = output.replace("import { appendSpeechTranscript } from '@/renderer/hooks/system/useSpeechInput';\n", "");
    output = output.replace("  const { t, i18n } = useTranslation();", "  const { t } = useTranslation();");

    const speechHandlerAnchor = [
      "  const handleSpeechTranscript = useCallback(",
      "    (transcript: string) => {",
      "      const currentValue = latestInputRef.current;",
      "      setInputRef.current(appendSpeechTranscript(currentValue, transcript));",
      "    },",
      "    [latestInputRef, setInputRef]",
      "  );",
      "  const speechLocale = i18n?.language || 'en-US';",
    ].join("\n");
    if (!output.includes(speechHandlerAnchor)) {
      throw new Error("Could not find SendBox speech transcript anchor");
    }
    output = output.replace(speechHandlerAnchor, "  // Relay Agent beginner mode: speech input hidden.");

    const speechButtonSingleLineAnchor = [
      "              <SpeechInputButton",
      "                disabled={disabled || isLoading || loading || isUploading}",
      "                locale={speechLocale}",
      "                onTranscript={handleSpeechTranscript}",
      "              />",
    ].join("\n");
    if (!output.includes(speechButtonSingleLineAnchor)) {
      throw new Error("Could not find SendBox single-line speech button anchor");
    }
    output = output.replace(
      speechButtonSingleLineAnchor,
      "              {/* Relay Agent beginner mode: speech input hidden. */}",
    );

    const speechButtonMultiLineAnchor = [
      "              <SpeechInputButton",
      "                disabled={disabled || isLoading || loading || isUploading}",
      "                locale={speechLocale}",
      "                onTranscript={handleSpeechTranscript}",
      "              />",
    ].join("\n");
    if (!output.includes(speechButtonMultiLineAnchor)) {
      throw new Error("Could not find SendBox multi-line speech button anchor");
    }
    output = output.replace(
      speechButtonMultiLineAnchor,
      "              {/* Relay Agent beginner mode: speech input hidden. */}",
    );
  }

  if (!output.includes("Relay Agent beginner mode: slash command menu hidden")) {
    const builtinSlashPattern =
      /  const builtinSlashCommands = useMemo<SlashCommandItem\[\]>\(\(\) => \{\n    const commands: SlashCommandItem\[\] = \[\];[\s\S]*?  \}, \[conversationContext\?\.conversationId, enableBtw, onSlashBuiltinCommand, t\]\);/u;
    if (!builtinSlashPattern.test(output)) {
      throw new Error("Could not find SendBox builtin slash command anchor");
    }
    output = output.replace(
      builtinSlashPattern,
      [
        "  const builtinSlashCommands = useMemo<SlashCommandItem[]>(() => {",
        "    // Relay Agent beginner mode: slash command menu hidden.",
        "    return [];",
        "  }, []);",
      ].join("\n"),
    );

    const mergedSlashPattern =
      /  const mergedSlashCommands = useMemo\(\(\) => \{\n    const map = new Map<string, SlashCommandItem>\(\);[\s\S]*?  \}, \[builtinSlashCommands, slashCommands\]\);/u;
    if (!mergedSlashPattern.test(output)) {
      throw new Error("Could not find SendBox merged slash command anchor");
    }
    output = output.replace(
      mergedSlashPattern,
      [
        "  const mergedSlashCommands = useMemo(() => {",
        "    // Relay Agent beginner mode: slash command menu hidden.",
        "    return builtinSlashCommands;",
        "  }, [builtinSlashCommands]);",
      ].join("\n"),
    );

    const commandOpenAnchor = "  const isCommandMenuOpen = conversationExport.isOpen || slashController.isOpen;";
    if (!output.includes(commandOpenAnchor)) {
      throw new Error("Could not find SendBox command menu open anchor");
    }
    output = output.replace(
      commandOpenAnchor,
      [
        "  // Relay Agent beginner mode: slash command menu hidden.",
        "  const isCommandMenuOpen = false;",
      ].join("\n"),
    );

    const overlayKeyDownAnchor = [
      "  const handleOverlayKeyDown = (event: React.KeyboardEvent) => {",
      "    return conversationExport.handleKeyDown(event) || slashController.onKeyDown(event);",
      "  };",
    ].join("\n");
    if (!output.includes(overlayKeyDownAnchor)) {
      throw new Error("Could not find SendBox overlay keydown anchor");
    }
    output = output.replace(
      overlayKeyDownAnchor,
      [
        "  const handleOverlayKeyDown = (_event: React.KeyboardEvent) => {",
        "    // Relay Agent beginner mode: slash command menu hidden.",
        "    return false;",
        "  };",
      ].join("\n"),
    );
  }

  return output;
}

export function patchChatConversationContent(input) {
  let output = input;

  if (!output.includes("Relay Agent beginner mode: skills indicator hidden")) {
    output = output.replace(
      "import ConversationSkillsIndicator from './ConversationSkillsIndicator';\n",
      "",
    );
    const indicatorAnchor = "<ConversationSkillsIndicator conversation={conversation} />";
    if (!output.includes(indicatorAnchor)) {
      throw new Error("Could not find ChatConversation skills indicator anchor");
    }
    output = output.replaceAll(
      indicatorAnchor,
      "{/* Relay Agent beginner mode: skills indicator hidden. */}",
    );
  }

  return output;
}

export function patchAionrsSendBoxContent(input) {
  let output = input;

  if (!output.includes("Relay Agent task mode: split display and agent input")) {
    const executeAnchor =
      "    async ({ input, files }: Pick<ConversationCommandQueueItem, 'input' | 'files'>) => {";
    if (!output.includes(executeAnchor)) {
      throw new Error("Could not find AionrsSendBox executeCommand parameter anchor");
    }
    output = output.replace(
      executeAnchor,
      "    async ({ input, files, agentInput }: Pick<ConversationCommandQueueItem, 'input' | 'files'> & { agentInput?: string }) => {",
    );

    const displayAnchor = "      const displayMessage = buildDisplayMessage(input, files, workspacePath);";
    if (!output.includes(displayAnchor)) {
      throw new Error("Could not find AionrsSendBox display message anchor");
    }
    output = output.replace(
      displayAnchor,
      [
        displayAnchor,
        "      // Relay Agent task mode: split display and agent input.",
        "      const agentMessage = agentInput ? buildDisplayMessage(agentInput, files, workspacePath) : displayMessage;",
      ].join("\n"),
    );

    const invokeAnchor = [
      "          const result = await ipcBridge.conversation.sendMessage.invoke({",
      "            input: displayMessage,",
      "            msg_id,",
      "            conversation_id,",
      "            files,",
      "          });",
    ].join("\n");
    if (!output.includes(invokeAnchor)) {
      throw new Error("Could not find AionrsSendBox conversation send anchor");
    }
    output = output.replace(
      invokeAnchor,
      [
        "          const result = await ipcBridge.conversation.sendMessage.invoke({",
        "            input: agentMessage,",
        "            displayInput: displayMessage,",
        "            msg_id,",
        "            conversation_id,",
        "            files,",
        "          });",
      ].join("\n"),
    );

    const initialAnchor = [
      "        const { input, files: initialFiles } = JSON.parse(storedMessage);",
      "        await executeCommand({ input, files: initialFiles || [] });",
    ].join("\n");
    if (!output.includes(initialAnchor)) {
      throw new Error("Could not find AionrsSendBox initial message anchor");
    }
    output = output.replace(
      initialAnchor,
      [
        "        const { input, agentInput, files: initialFiles } = JSON.parse(storedMessage);",
        "        await executeCommand({ input, agentInput, files: initialFiles || [] });",
      ].join("\n"),
    );
  }

  return output;
}

export function patchConversationBridgeContent(input) {
  let output = input;

  if (!output.includes("displayContent: other.displayInput")) {
    const sendAnchor = [
      "      await task.sendMessage({",
      "        ...other,",
      "        content: other.input,",
      "        files: workspaceFiles,",
      "        agentContent,",
      "      });",
    ].join("\n");
    if (!output.includes(sendAnchor)) {
      throw new Error("Could not find conversationBridge task.sendMessage anchor");
    }
    output = output.replace(
      sendAnchor,
      [
        "      await task.sendMessage({",
        "        ...other,",
        "        content: other.input,",
        "        displayContent: other.displayInput,",
        "        files: workspaceFiles,",
        "        agentContent,",
        "      });",
      ].join("\n"),
    );
  }

  return output;
}

export function patchPublicManifestContent(input, branding = relayBranding()) {
  const manifest = JSON.parse(input);
  manifest.name = branding.productName;
  manifest.short_name = branding.productName;
  manifest.description = `${branding.productName} desktop and browser interface.`;
  return ensureTrailingNewline(JSON.stringify(manifest, null, 2));
}

export function patchAppConfigContent(input, branding = relayBranding()) {
  return input.replace(
    /return appConfig\?\.name \|\| ['"][^'"]+['"];/u,
    `return appConfig?.name || '${branding.productName}';`,
  );
}

export function patchPlatformIndexContent(input, branding = relayBranding()) {
  const devName = `${branding.productName}-Dev`;
  const multiDevName = `${branding.productName}-Dev-2`;
  return input.replace(
    /return isMultiInstance \? ['"][^'"]+['"] : ['"][^'"]+['"];/u,
    `return isMultiInstance ? '${multiDevName}' : '${devName}';`,
  );
}

export function patchNodePlatformServicesContent(input, branding = relayBranding()) {
  const dataDir = `.${branding.packageName}-server`;
  return input
    .replace(/return \{ name: ['"][^'"]+['"], version: ['"]0\.0\.0['"] \};/u, `return { name: '${branding.packageName}', version: '0.0.0' };`)
    .replace(/\.aionui-server/gu, dataDir)
    .replace(/_pkg\.name \?\? ['"][^'"]+['"]/u, `_pkg.name ?? '${branding.packageName}'`);
}

export function patchUpdateBridgeContent(input, branding = relayBranding()) {
  const repo = `${branding.publishOwner}/${branding.publishRepo}`;
  return input
    .replace(/const DEFAULT_REPO = ['"][^'"]+['"];/u, `const DEFAULT_REPO = '${repo}';`)
    .replace(/const DEFAULT_USER_AGENT = ['"][^'"]+['"];/u, `const DEFAULT_USER_AGENT = '${branding.productName}';`)
    .replace(/return base \|\| `[^`]+-update-\$\{Date\.now\(\)\}`;/u, `return base || \`${branding.packageName}-update-\${Date.now()}\`;`);
}

export function patchAboutModalContent(input, branding = relayBranding()) {
  const repoUrl = `https://github.com/${branding.publishOwner}/${branding.publishRepo}`;
  return input
    .replace(/window\.dispatchEvent\(new CustomEvent\('aionui-open-update-modal'/gu, "window.dispatchEvent(new CustomEvent('relay-agent-open-update-modal'")
    .replace(/https:\/\/github\.com\/iOfficeAI\/AionUi\/wiki/gu, `${repoUrl}#readme`)
    .replace(/https:\/\/github\.com\/iOfficeAI\/AionUi\/releases/gu, `${repoUrl}/releases`)
    .replace(/https:\/\/github\.com\/iOfficeAI\/AionUi\/issues/gu, `${repoUrl}/issues`)
    .replace(/https:\/\/github\.com\/iOfficeAI\/AionUi(?![A-Za-z0-9_/-])/gu, repoUrl)
    .replace(/https:\/\/www\.aionui\.com/gu, repoUrl)
    .replace(/>\s*AionUi\s*</u, `>\n              ${branding.productName}\n            <`);
}

export function patchUpdateModalContent(input) {
  return input
    .replace(/window\.addEventListener\('aionui-open-update-modal'/gu, "window.addEventListener('relay-agent-open-update-modal'")
    .replace(/window\.removeEventListener\('aionui-open-update-modal'/gu, "window.removeEventListener('relay-agent-open-update-modal'");
}

export function patchAgentLogoContent(input) {
  return input.replace(
    "import AionLogo from '@/renderer/assets/logos/brand/aion.svg';",
    "import AionLogo from '@/renderer/assets/logos/brand/app.png';",
  );
}

export function patchTitlebarContent(input, branding = relayBranding()) {
  let output = input;
  output = output.replace(
    /const AionLogoMark: React\.FC = \(\) => \([\s\S]*?\n\);\n\n\/\/ Claude-desktop-style/u,
    [
      "const RelayLogoMark: React.FC = () => (",
      "  <svg className='app-titlebar__brand-logo' viewBox='0 0 80 80' fill='none' aria-hidden='true' focusable='false'>",
      "    <path d='M31 34 Q40 25 49 34' stroke='currentColor' strokeWidth='7' strokeLinecap='round' />",
      "    <path d='M31 46 Q40 55 49 46' stroke='currentColor' strokeWidth='7' strokeLinecap='round' />",
      "    <circle cx='22' cy='40' r='12' fill='currentColor' />",
      "    <circle cx='58' cy='40' r='12' fill='currentColor' />",
      "  </svg>",
      ");",
      "",
      "// Claude-desktop-style",
    ].join("\n"),
  );
  output = output.replace(
    /const appTitle = useMemo\(\(\) => ['"][^'"]+['"], \[\]\);/u,
    `const appTitle = useMemo(() => '${branding.productName}', []);`,
  );
  output = output.replace(/<AionLogoMark \/>/gu, "<RelayLogoMark />");
  return output;
}

export function patchLayoutBrandContent(input, branding = relayBranding()) {
  let output = input;
  const relayLogoImport = "import RelayLogo from '@/renderer/assets/logos/brand/app.png';";
  if (!output.includes(relayLogoImport)) {
    const anchor = "import Titlebar from '@/renderer/components/layout/Titlebar';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find layout Titlebar import anchor");
    }
    output = output.replace(anchor, `${anchor}\n${relayLogoImport}`);
  }

  output = output.replace(
    /<svg\s+className=\{classNames\('w-5\.5 h-5\.5 absolute inset-0 m-auto'[\s\S]*?<\/svg>/u,
    [
      "<img",
      "                    src={RelayLogo}",
      `                    alt='${branding.productName}'`,
      "                    className={classNames('w-5.5 h-5.5 absolute inset-0 m-auto object-contain', {",
      "                      ' scale-140': !collapsed,",
      "                    })}",
      "                  />",
    ].join("\n"),
  );
  output = output.replace(
    /<div className='flex-1 text-20px text-1 collapsed-hidden font-bold'>[^<]+<\/div>/u,
    `<div className='flex-1 text-20px text-1 collapsed-hidden font-bold'>${branding.productName}</div>`,
  );
  return output;
}

export function patchLocaleJsonContent(input, branding = relayBranding()) {
  const parsed = JSON.parse(input);
  const replaceBrand = (value) => {
    if (typeof value === "string") {
      return value.replace(/AionUi|AionUI|Aion UI/gu, branding.productName);
    }
    if (Array.isArray(value)) return value.map(replaceBrand);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replaceBrand(nested)]));
    }
    return value;
  };
  return ensureTrailingNewline(JSON.stringify(replaceBrand(parsed), null, 2));
}

export function patchElectronBuilderContent(input, branding = relayBranding()) {
  let output = input;
  output = replaceYamlScalar(output, "appId", branding.appId);
  output = replaceYamlScalar(output, "productName", branding.productName);
  output = replaceYamlScalar(output, "executableName", branding.executableName);
  output = replaceYamlScalar(output, "copyright", `Copyright © 2026 ${branding.productName}`);
  output = replaceLine(
    output,
    /^  - name: .+ Protocol$/m,
    `  - name: ${branding.productName} Protocol`,
  );
  output = replaceLine(output, /^      - (aionui|relay-agent)$/m, `      - ${branding.protocol}`);
  output = replaceLine(output, /^  maintainer: .*$/m, `  maintainer: ${branding.packageName}`);
  output = replaceLine(output, /^  vendor: .*$/m, `  vendor: ${branding.supportName}`);
  output = replaceLine(output, /^      Name: .*$/m, `      Name: ${branding.productName}`);
  output = replaceLine(output, /^      Icon: .*$/m, `      Icon: ${branding.packageName}`);
  output = replaceLine(
    output,
    /^      MimeType: x-scheme-handler\/[^;]+;$/m,
    `      MimeType: x-scheme-handler/${branding.protocol};`,
  );
  output = replaceLine(output, /^  owner: .*$/m, `  owner: ${branding.publishOwner}`);
  output = replaceLine(output, /^  repo: .*$/m, `  repo: ${branding.publishRepo}`);
  if (!output.includes("from: resources/relay-gateway")) {
    const anchor = "extraResources:\n";
    if (!output.includes(anchor)) {
      throw new Error("Could not find electron-builder extraResources anchor");
    }
    output = output.replace(anchor, `${anchor}  - from: resources/relay-gateway\n    to: relay-gateway\n`);
  }
  if (!output.includes("from: resources/relay-tools")) {
    const anchor = "extraResources:\n";
    if (!output.includes(anchor)) {
      throw new Error("Could not find electron-builder extraResources anchor");
    }
    output = output.replace(anchor, `${anchor}  - from: resources/relay-tools\n    to: relay-tools\n`);
  }
  if (!output.includes("out/main/relay-document-search-mcp-stdio.js") && output.includes("asarUnpack:")) {
    const anchor = "  - 'out/main/team-guide-mcp-stdio.js'";
    if (!output.includes(anchor)) {
      throw new Error("Could not find electron-builder MCP asarUnpack anchor");
    }
    output = output.replace(anchor, `${anchor}\n  - 'out/main/relay-document-search-mcp-stdio.js'`);
  }
  return output;
}

export function patchAionCliCoreGlobContent(input) {
  if (input.includes(relaySharedFolderSearchMarker)) return ensureTrailingNewline(input);

  let output = input;
  const importAnchor = "import { resolveToolDeclaration } from './definitions/resolver.js';";
  if (!output.includes(importAnchor)) {
    throw new Error("Could not find AionCLI glob import anchor");
  }
  output = output.replace(
    importAnchor,
    [
      importAnchor,
      "import { ensureRgPath } from './ripGrep.js';",
      "import { execStreaming } from '../utils/shell-utils.js';",
    ].join("\n"),
  );

  const classAnchor = "class GlobToolInvocation extends BaseToolInvocation {";
  if (!output.includes(classAnchor)) {
    throw new Error("Could not find AionCLI GlobToolInvocation anchor");
  }
  const helpers = [
    `// ${relaySharedFolderSearchMarker}`,
    "function relayIntEnv(name, fallback) {",
    "    const value = Number.parseInt(process.env[name] || '', 10);",
    "    return Number.isFinite(value) && value > 0 ? value : fallback;",
    "}",
    "",
    "function relayNormalizeGlobPattern(pattern) {",
    "    let normalized = String(pattern || '').trim().replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
    "    if (!normalized) return normalized;",
    "    if (!/^(?:[a-zA-Z]:\\/|\\/\\/)/u.test(normalized)) {",
    "        normalized = normalized.replace(/^\\/+/, '');",
    "    }",
    "    if (!normalized.startsWith('//')) normalized = normalized.replace(/\\/{2,}/g, '/');",
    "    if (!normalized) return normalized;",
    "    if (normalized === '*' || normalized === '**' || normalized === '**/*') return normalized;",
    "    const parts = normalized.split('/');",
    "    const basename = parts.at(-1) || '';",
    "    const hasSlash = parts.length > 1;",
    "    const basenameHasMagic = relayGlobPatternHasMagic(basename);",
    "    const patternHasMagic = relayGlobPatternHasMagic(normalized);",
    "    const basenameLooksExactFile = relayGlobBasenameLooksExactFile(basename);",
    "    if (!hasSlash) {",
    "        if (!patternHasMagic) return basenameLooksExactFile ? `**/${normalized}` : `**/*${normalized}*`;",
    "        return normalized.startsWith('*') ? `**/${normalized}` : `**/*${normalized}`;",
    "    }",
    "    if (normalized.startsWith('**/') && !basenameHasMagic && !basenameLooksExactFile) {",
    "        const prefix = parts.slice(0, -1).join('/') || '**';",
    "        return `${prefix}/*${basename}*`;",
    "    }",
    "    if (normalized.startsWith('**/') && basenameHasMagic && !basename.startsWith('*') && !basename.startsWith('?')) {",
    "        const prefix = parts.slice(0, -1).join('/') || '**';",
    "        return `${prefix}/*${basename}`;",
    "    }",
    "    return normalized;",
    "}",
    "",
    "function relayGlobPatternHasMagic(pattern) {",
    "    return /[*?[\\]{}]/u.test(String(pattern || ''));",
    "}",
    "",
    "function relayGlobBasenameLooksExactFile(basename) {",
    "    return /\\.[^./*?[\\]{}]{1,12}$/u.test(String(basename || ''));",
    "}",
    "",
    "function relayIsBroadGlobPattern(pattern) {",
    "    const normalized = relayNormalizeGlobPattern(pattern).trim();",
    "    return normalized === '*' || normalized === '**' || normalized === '**/*' || normalized === './**/*';",
    "}",
    "",
    "function relayEntryFullPath(entry) {",
    "    return typeof entry.fullpath === 'function' ? entry.fullpath() : entry.fullpath;",
    "}",
    "",
    "function relayIsInsideDirectory(root, absolutePath) {",
    "    const relative = path.relative(path.resolve(root), absolutePath);",
    "    return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));",
    "}",
    "",
    "function relaySearchRootForEntry(absolutePath, targetDir, searchDirectories) {",
    "    const roots = Array.isArray(searchDirectories) ? searchDirectories : [];",
    "    for (const searchDir of roots) {",
    "        if (relayIsInsideDirectory(searchDir, absolutePath)) return path.resolve(searchDir);",
    "    }",
    "    return path.resolve(targetDir);",
    "}",
    "",
    "function relaySegmentKey(relativePath, depth) {",
    "    const parts = String(relativePath || '').split(/[\\\\/]+/).filter(Boolean).filter((part) => part !== '.');",
    "    if (!parts.length) return '<root>';",
    "    return parts.slice(0, Math.max(1, depth)).join(path.sep);",
    "}",
    "",
    "function relayApplySharedFolderResultCaps(entries, targetDir, searchDirectories = []) {",
    "    const maxResults = relayIntEnv('RELAY_SHARED_SEARCH_MAX_RETURNED_FILES', 300);",
    "    const perFolderLimit = relayIntEnv('RELAY_SHARED_SEARCH_PER_FOLDER_LIMIT', 25);",
    "    const perBranchLimit = relayIntEnv('RELAY_SHARED_SEARCH_PER_BRANCH_LIMIT', 75);",
    "    const branchDepth = relayIntEnv('RELAY_SHARED_SEARCH_BRANCH_DEPTH', 3);",
    "    const byFolder = new Map();",
    "    const byBranch = new Map();",
    "    const selected = [];",
    "    for (const entry of entries) {",
    "        if (selected.length >= maxResults) break;",
    "        const absolutePath = relayEntryFullPath(entry);",
    "        const searchRoot = relaySearchRootForEntry(absolutePath, targetDir, searchDirectories);",
    "        const relativeParent = path.dirname(path.relative(searchRoot, absolutePath));",
    "        const folderKey = relativeParent && relativeParent !== '.' ? relativeParent : '<root>';",
    "        const branchKey = relaySegmentKey(relativeParent, branchDepth);",
    "        const branchUsed = byBranch.get(branchKey) || 0;",
    "        if (branchUsed >= perBranchLimit) continue;",
    "        const used = byFolder.get(folderKey) || 0;",
    "        if (used >= perFolderLimit) continue;",
    "        byBranch.set(branchKey, branchUsed + 1);",
    "        byFolder.set(folderKey, used + 1);",
    "        selected.push(entry);",
    "    }",
    "    return {",
    "        entries: selected,",
    "        limited: selected.length < entries.length,",
    "        maxResults,",
    "        perFolderLimit,",
    "        perBranchLimit,",
    "        branchDepth,",
    "    };",
    "}",
    "",
  ].join("\n");
  output = output.replace(classAnchor, `${helpers}${classAnchor}`);

  const constructorAnchor = [
    "    constructor(config, params, messageBus, _toolName, _toolDisplayName) {",
    "        super(params, messageBus, _toolName, _toolDisplayName);",
    "        this.config = config;",
    "    }",
  ].join("\n");
  if (!output.includes(constructorAnchor)) {
    throw new Error("Could not find AionCLI GlobToolInvocation constructor anchor");
  }
  const method = [
    constructorAnchor,
    "    async performRelayRipgrepFileListing(searchDirectories, signal) {",
    "        const rgPath = await ensureRgPath();",
    "        const fileDiscovery = this.config.getFileService();",
    "        const internalLimit = relayIntEnv('RELAY_SHARED_SEARCH_INTERNAL_FILE_LIMIT', 5000);",
    "        const allEntries = [];",
    "        const normalizedPattern = relayNormalizeGlobPattern(this.params.pattern);",
    "        const includePatterns = relayIsBroadGlobPattern(normalizedPattern) ? [] : [normalizedPattern];",
    "        const globFlag = this.params.case_sensitive ? '--glob' : '--iglob';",
    "        const respectGitIgnore = this.params?.respect_git_ignore ??",
    "            this.config.getFileFilteringOptions().respectGitIgnore ??",
    "            DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore;",
    "        const respectGeminiIgnore = this.params?.respect_gemini_ignore ??",
    "            this.config.getFileFilteringOptions().respectGeminiIgnore ??",
    "            DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore;",
    "",
    "        for (const searchDir of searchDirectories) {",
    "            const rgArgs = ['--files', '--hidden'];",
    "            for (const includePattern of includePatterns) {",
    "                rgArgs.push(globFlag, includePattern);",
    "            }",
    "            if (!respectGitIgnore) {",
    "                rgArgs.push('--no-ignore-vcs', '--no-ignore-exclude');",
    "            }",
    "            for (const exclude of this.config.getFileExclusions().getGlobExcludes()) {",
    "                rgArgs.push('--glob', `!${relayNormalizeGlobPattern(exclude)}`);",
    "            }",
    "            rgArgs.push(searchDir);",
    "",
    "            const generator = execStreaming(rgPath, rgArgs, { signal, allowedExitCodes: [0, 1] });",
    "            for await (const line of generator) {",
    "                const rawPath = line.trim();",
    "                if (!rawPath) continue;",
    "                const absolutePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(searchDir, rawPath);",
    "                const relativeToSearchRoot = path.relative(searchDir, absolutePath);",
    "                if (relativeToSearchRoot === '..' || relativeToSearchRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToSearchRoot)) {",
    "                    continue;",
    "                }",
    "                try {",
    "                    const stat = fs.statSync(absolutePath);",
    "                    if (!stat.isFile()) continue;",
    "                    allEntries.push({",
    "                        fullpath: () => absolutePath,",
    "                        mtimeMs: stat.mtimeMs,",
    "                    });",
    "                }",
    "                catch {",
    "                    continue;",
    "                }",
    "                if (allEntries.length >= internalLimit) break;",
    "            }",
    "            if (allEntries.length >= internalLimit) break;",
    "        }",
    "",
    "        const relativePaths = allEntries.map((entry) => path.relative(this.config.getTargetDir(), relayEntryFullPath(entry)));",
    "        const { filteredPaths, ignoredCount } = fileDiscovery.filterFilesWithReport(relativePaths, {",
    "            respectGitIgnore,",
    "            respectGeminiIgnore,",
    "        });",
    "        const filteredAbsolutePaths = new Set(filteredPaths.map((p) => path.resolve(this.config.getTargetDir(), p)));",
    "        const filteredEntries = allEntries.filter((entry) => filteredAbsolutePaths.has(relayEntryFullPath(entry)));",
    "        return {",
    "            filteredEntries,",
    "            ignoredCount,",
    "            internalTruncated: allEntries.length >= internalLimit,",
    "            backend: 'ripgrep',",
    "        };",
    "    }",
  ].join("\n");
  output = output.replace(constructorAnchor, method);

  const listingBlock = [
    "            // Get centralized file discovery service",
    "            const fileDiscovery = this.config.getFileService();",
    "            // Collect entries from all search directories",
    "            const allEntries = [];",
    "            for (const searchDir of searchDirectories) {",
    "                let pattern = this.params.pattern;",
    "                const fullPath = path.join(searchDir, pattern);",
    "                if (fs.existsSync(fullPath)) {",
    "                    pattern = escape(pattern);",
    "                }",
    "                const entries = (await glob(pattern, {",
    "                    cwd: searchDir,",
    "                    withFileTypes: true,",
    "                    nodir: true,",
    "                    stat: true,",
    "                    nocase: !this.params.case_sensitive,",
    "                    dot: true,",
    "                    ignore: this.config.getFileExclusions().getGlobExcludes(),",
    "                    follow: false,",
    "                    signal,",
    "                }));",
    "                allEntries.push(...entries);",
    "            }",
    "            const relativePaths = allEntries.map((p) => path.relative(this.config.getTargetDir(), p.fullpath()));",
    "            const { filteredPaths, ignoredCount } = fileDiscovery.filterFilesWithReport(relativePaths, {",
    "                respectGitIgnore: this.params?.respect_git_ignore ??",
    "                    this.config.getFileFilteringOptions().respectGitIgnore ??",
    "                    DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,",
    "                respectGeminiIgnore: this.params?.respect_gemini_ignore ??",
    "                    this.config.getFileFilteringOptions().respectGeminiIgnore ??",
    "                    DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore,",
    "            });",
    "            const filteredAbsolutePaths = new Set(filteredPaths.map((p) => path.resolve(this.config.getTargetDir(), p)));",
    "            const filteredEntries = allEntries.filter((entry) => filteredAbsolutePaths.has(entry.fullpath()));",
  ].join("\n");
  if (!output.includes(listingBlock)) {
    throw new Error("Could not find AionCLI glob file listing block");
  }
  const replacementListingBlock = [
    "            let filteredEntries;",
    "            let ignoredCount = 0;",
    "            let relaySearchBackend = 'ripgrep';",
    "            let relayInternalTruncated = false;",
    "            const relayResult = await this.performRelayRipgrepFileListing(searchDirectories, signal).catch((error) => {",
    "                debugLogger.warn('Relay ripgrep glob fallback to JS glob', error);",
    "                return null;",
    "            });",
    "            if (relayResult) {",
    "                filteredEntries = relayResult.filteredEntries;",
    "                ignoredCount = relayResult.ignoredCount;",
    "                relayInternalTruncated = relayResult.internalTruncated;",
    "            }",
    "            else {",
    "                relaySearchBackend = 'glob';",
    "                const fileDiscovery = this.config.getFileService();",
    "                const allEntries = [];",
    "                for (const searchDir of searchDirectories) {",
    "                    let pattern = this.params.pattern;",
    "                    const fullPath = path.join(searchDir, pattern);",
    "                    if (fs.existsSync(fullPath)) {",
    "                        pattern = escape(pattern);",
    "                    }",
    "                    const entries = (await glob(pattern, {",
    "                        cwd: searchDir,",
    "                        withFileTypes: true,",
    "                        nodir: true,",
    "                        stat: true,",
    "                        nocase: !this.params.case_sensitive,",
    "                        dot: true,",
    "                        ignore: this.config.getFileExclusions().getGlobExcludes(),",
    "                        follow: false,",
    "                        signal,",
    "                    }));",
    "                    allEntries.push(...entries);",
    "                }",
    "                const relativePaths = allEntries.map((p) => path.relative(this.config.getTargetDir(), p.fullpath()));",
    "                const report = fileDiscovery.filterFilesWithReport(relativePaths, {",
    "                    respectGitIgnore: this.params?.respect_git_ignore ??",
    "                        this.config.getFileFilteringOptions().respectGitIgnore ??",
    "                        DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,",
    "                    respectGeminiIgnore: this.params?.respect_gemini_ignore ??",
    "                        this.config.getFileFilteringOptions().respectGeminiIgnore ??",
    "                        DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore,",
    "                });",
    "                ignoredCount = report.ignoredCount;",
    "                const filteredAbsolutePaths = new Set(report.filteredPaths.map((p) => path.resolve(this.config.getTargetDir(), p)));",
    "                filteredEntries = allEntries.filter((entry) => filteredAbsolutePaths.has(entry.fullpath()));",
    "            }",
  ].join("\n");
  output = output.replace(listingBlock, replacementListingBlock);

  const resultBlock = [
    "            const sortedEntries = sortFileEntries(filteredEntries, nowTimestamp, oneDayInMs);",
    "            const sortedAbsolutePaths = sortedEntries.map((entry) => entry.fullpath());",
    "            const fileListDescription = sortedAbsolutePaths.join('\\n');",
    "            const fileCount = sortedAbsolutePaths.length;",
    "            let resultMessage = `Found ${fileCount} file(s) matching \"${this.params.pattern}\"`;",
    "            if (searchDirectories.length === 1) {",
    "                resultMessage += ` within ${searchDirectories[0]}`;",
    "            }",
    "            else {",
    "                resultMessage += ` across ${searchDirectories.length} workspace directories`;",
    "            }",
    "            if (ignoredCount > 0) {",
    "                resultMessage += ` (${ignoredCount} additional files were ignored)`;",
    "            }",
    "            resultMessage += `, sorted by modification time (newest first):\\n${fileListDescription}`;",
  ].join("\n");
  if (!output.includes(resultBlock)) {
    throw new Error("Could not find AionCLI glob result block");
  }
  const replacementResultBlock = [
    "            const sortedEntries = sortFileEntries(filteredEntries, nowTimestamp, oneDayInMs);",
    "            const relayLimited = relayApplySharedFolderResultCaps(sortedEntries, this.config.getTargetDir(), searchDirectories);",
    "            const sortedAbsolutePaths = relayLimited.entries.map((entry) => relayEntryFullPath(entry));",
    "            const fileListDescription = sortedAbsolutePaths.join('\\n');",
    "            const fileCount = filteredEntries.length;",
    "            const fileCountLabel = relayInternalTruncated ? `${fileCount}+` : `${fileCount}`;",
    "            let resultMessage = `Found ${fileCountLabel} file(s) matching \"${this.params.pattern}\"`;",
    "            if (searchDirectories.length === 1) {",
    "                resultMessage += ` within ${searchDirectories[0]}`;",
    "            }",
    "            else {",
    "                resultMessage += ` across ${searchDirectories.length} workspace directories`;",
    "            }",
    "            resultMessage += ` using ${relaySearchBackend}`;",
    "            if (ignoredCount > 0) {",
    "                resultMessage += ` (${ignoredCount} additional files were ignored)`;",
    "            }",
    "            if (relayLimited.limited || relayInternalTruncated) {",
    "                resultMessage += `; showing ${sortedAbsolutePaths.length} representative result(s) capped at ${relayLimited.maxResults} total, ${relayLimited.perFolderLimit} per folder, and ${relayLimited.perBranchLimit} per branch group`;",
    "            }",
    "            resultMessage += `, sorted by modification time (newest first):\\n${fileListDescription}`;",
  ].join("\n");
  output = output.replace(resultBlock, replacementResultBlock);

  return ensureTrailingNewline(output);
}

export function patchAionCliCoreRipGrepContent(input) {
  if (input.includes(relaySharedFolderGrepMarker)) return ensureTrailingNewline(input);

  let output = input;
  const functionAnchor = "function getRgCandidateFilenames() {";
  if (!output.includes(functionAnchor)) {
    throw new Error("Could not find AionCLI ripGrep helper anchor");
  }
  output = output.replace(
    functionAnchor,
    [
      `// ${relaySharedFolderGrepMarker}`,
      "function relayIntEnv(name, fallback) {",
      "    const value = Number.parseInt(process.env[name] || '', 10);",
      "    return Number.isFinite(value) && value > 0 ? value : fallback;",
      "}",
      "",
      functionAnchor,
    ].join("\n"),
  );

  const maxAnchor = "            const totalMaxMatches = this.params.total_max_matches ?? DEFAULT_TOTAL_MAX_MATCHES;";
  if (!output.includes(maxAnchor)) {
    throw new Error("Could not find AionCLI ripGrep max matches anchor");
  }
  output = output.replace(
    maxAnchor,
    [
      "            const totalMaxMatches = this.params.total_max_matches ??",
      "                (this.params.names_only ? relayIntEnv('RELAY_SHARED_SEARCH_NAMES_ONLY_MAX_MATCHES', 500) : DEFAULT_TOTAL_MAX_MATCHES);",
      "            const relayMaxMatchesPerFile = this.params.max_matches_per_file ??",
      "                (this.params.names_only ? relayIntEnv('RELAY_SHARED_SEARCH_MAX_MATCHES_PER_FILE', 1) : undefined);",
    ].join("\n"),
  );

  const perFileAnchor = "                    max_matches_per_file: this.params.max_matches_per_file,";
  if (!output.includes(perFileAnchor)) {
    throw new Error("Could not find AionCLI ripGrep per-file max anchor");
  }
  output = output.replace(perFileAnchor, "                    max_matches_per_file: relayMaxMatchesPerFile,");
  return ensureTrailingNewline(output);
}

export function patchAionCliCoreToolDefinitionsContent(input) {
  let output = input;
  const oldGrepDescription = "description: 'Searches for a regular expression pattern within file contents.',";
  const newGrepDescription =
    "description: 'Searches file contents with ripgrep. For broad shared-folder or network-drive searches, first use names_only=true, max_matches_per_file=1, and a focused include glob before reading file content.',";
  output = output.replaceAll(oldGrepDescription, newGrepDescription);
  output = output.replace(
    "description: 'Efficiently finds files matching specific glob patterns",
    "description: 'Efficiently finds files matching specific glob patterns. Relay Agent caps broad shared-folder results and avoids slow full JS glob walks where possible",
  );
  return ensureTrailingNewline(output);
}

export function patchDeepLinkContent(input, branding = relayBranding()) {
  let output = input;
  output = replaceLine(
    output,
    /^export const PROTOCOL_SCHEME = '[^']+';$/m,
    `export const PROTOCOL_SCHEME = '${branding.protocol}';`,
  );
  output = output.replaceAll("aionui://", `${branding.protocol}://`);
  output = output.replaceAll(`an ${branding.protocol}://`, `a ${branding.protocol}://`);
  return output;
}

export function patchSettingsModalContent(input) {
  if (input.includes("RELAY_ADVANCED_SURFACES_KEY")) return input;

  let output = input;
  const ipcImport = "import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';";
  const configImport = "import { ConfigStorage } from '@/common/config/storage';";
  if (!output.includes(ipcImport)) {
    throw new Error("Could not find SettingsModal IPC import anchor");
  }
  output = output.replace(ipcImport, `${ipcImport}\n${configImport}`);

  const keyAnchor = "const RESIZE_DEBOUNCE_DELAY = 150;\n";
  if (!output.includes(keyAnchor)) {
    throw new Error("Could not find SettingsModal advanced-surface key anchor");
  }
  output = output.replace(
    keyAnchor,
    `${keyAnchor}\nconst RELAY_ADVANCED_SURFACES_KEY = 'relay.advancedSurfaces.enabled';\n`,
  );

  const typeAnchor = "export type SettingTab = BuiltinSettingTab | (string & {});\n";
  if (!output.includes(typeAnchor)) {
    throw new Error("Could not find SettingsModal tab type anchor");
  }
  output = output.replace(
    typeAnchor,
    [
      typeAnchor.trimEnd(),
      "",
      "function isRelayAdvancedSurfaceTab(tab: SettingTab): boolean {",
      "  return tab === 'gemini' || tab === 'model' || tab === 'agent' || tab === 'tools' || tab === 'webui' || tab === 'system';",
      "}",
      "",
    ].join("\n"),
  );

  const stateAnchor = "  const [extensionTabs, setExtensionTabs] = useState<IExtensionSettingsTab[]>([]);\n";
  if (!output.includes(stateAnchor)) {
    throw new Error("Could not find SettingsModal extensionTabs state anchor");
  }
  output = output.replace(
    stateAnchor,
    `${stateAnchor}  const [relayAdvancedSurfacesEnabled, setRelayAdvancedSurfacesEnabled] = useState(false);\n`,
  );

  const effectAnchors = [
    [
      "  }, [handleResize]);",
      "",
      "  useEffect(() => {",
      "    extensionsIpc",
    ].join("\n"),
    [
      "  }, [handleResize]);",
      "",
      "  // Fetch extension-contributed settings tabs when modal opens",
      "  useEffect(() => {",
      "    if (!visible) return;",
      "    void extensionsIpc.getSettingsTabs",
    ].join("\n"),
  ];
  const effectAnchor = effectAnchors.find((anchor) => output.includes(anchor));
  if (!effectAnchor) {
    throw new Error("Could not find SettingsModal extension load effect anchor");
  }
  const extensionEffectPrefix = effectAnchor.endsWith("void extensionsIpc.getSettingsTabs")
    ? [
        "  // Fetch extension-contributed settings tabs when modal opens",
        "  useEffect(() => {",
        "    if (!visible) return;",
        "    void extensionsIpc.getSettingsTabs",
      ].join("\n")
    : [
        "  useEffect(() => {",
        "    extensionsIpc",
      ].join("\n");
  output = output.replace(
    effectAnchor,
    [
      "  }, [handleResize]);",
      "",
      "  useEffect(() => {",
      "    if (!visible) return;",
      "    let cancelled = false;",
      "",
      "    ConfigStorage.get(RELAY_ADVANCED_SURFACES_KEY)",
      "      .then((value) => {",
      "        if (!cancelled) setRelayAdvancedSurfacesEnabled(value === true);",
      "      })",
      "      .catch(() => {",
      "        if (!cancelled) setRelayAdvancedSurfacesEnabled(false);",
      "      });",
      "",
      "    return () => {",
      "      cancelled = true;",
      "    };",
      "  }, [visible]);",
      "",
      "  useEffect(() => {",
      "    if (!relayAdvancedSurfacesEnabled && isRelayAdvancedSurfaceTab(activeTab)) {",
      "      setActiveTab('about');",
      "    }",
      "  }, [activeTab, relayAdvancedSurfacesEnabled]);",
      "",
      extensionEffectPrefix,
    ].join("\n"),
  );
  const extensionGuardAnchor = [
    "  useEffect(() => {",
    "    if (!visible) return;",
    "    void extensionsIpc.getSettingsTabs",
  ].join("\n");
  if (output.includes(extensionGuardAnchor)) {
    output = output.replace(
      extensionGuardAnchor,
      [
        "  useEffect(() => {",
        "    if (!visible) return;",
        "    if (!relayAdvancedSurfacesEnabled) {",
        "      setExtensionTabs([]);",
        "      return;",
        "    }",
        "    void extensionsIpc.getSettingsTabs",
      ].join("\n"),
    );
    output = output.replace(
      "  }, [visible]);\n\n  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
      "  }, [visible, relayAdvancedSurfacesEnabled]);\n\n  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
    );
    output = output.replace(
      "  }, [visible]);\n  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
      "  }, [visible, relayAdvancedSurfacesEnabled]);\n  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
    );
  }

  const menuAnchor = [
    "    const builtinItems: MenuItem[] = [",
    "      {",
    "        key: 'gemini',",
    "        label: t('settings.gemini'),",
    "        icon: <Gemini theme='outline' size='20' fill={iconColors.secondary} />,",
    "      },",
    "      {",
    "        key: 'model',",
    "        label: t('settings.model'),",
    "        icon: <LinkCloud theme='outline' size='20' fill={iconColors.secondary} />,",
    "      },",
    "      {",
    "        key: 'tools',",
    "        label: t('settings.tools'),",
    "        icon: <Toolkit theme='outline' size='20' fill={iconColors.secondary} />,",
    "      },",
    "    ];",
    "",
    "    if (isDesktop) {",
  ].join("\n");
  if (!output.includes(menuAnchor)) {
    throw new Error("Could not find SettingsModal built-in menu anchor");
  }
  output = output.replace(
    menuAnchor,
    [
      "    const builtinItems: MenuItem[] = [];",
      "",
      "    if (relayAdvancedSurfacesEnabled) {",
      "      builtinItems.push(",
      "        {",
      "          key: 'gemini',",
      "          label: t('settings.gemini'),",
      "          icon: <Gemini theme='outline' size='20' fill={iconColors.secondary} />,",
      "        },",
      "        {",
      "          key: 'model',",
      "          label: t('settings.model'),",
      "          icon: <LinkCloud theme='outline' size='20' fill={iconColors.secondary} />,",
      "        }",
      "      );",
      "    }",
      "",
      "    if (relayAdvancedSurfacesEnabled) {",
      "      builtinItems.push({",
      "        key: 'tools',",
      "        label: t('settings.tools'),",
      "        icon: <Toolkit theme='outline' size='20' fill={iconColors.secondary} />,",
      "      });",
      "    }",
      "",
      "    if (isDesktop && relayAdvancedSurfacesEnabled) {",
    ].join("\n"),
  );
  const systemAboutAnchor = [
    "    builtinItems.push(",
    "      {",
    "        key: 'system',",
    "        label: t('settings.system'),",
    "        icon: <Computer theme='outline' size='20' fill={iconColors.secondary} />,",
    "      },",
    "      { key: 'about', label: t('settings.about'), icon: <Info theme='outline' size='20' fill={iconColors.secondary} /> }",
    "    );",
  ].join("\n");
  if (output.includes(systemAboutAnchor)) {
    output = output.replace(
      systemAboutAnchor,
      [
        "    if (relayAdvancedSurfacesEnabled) {",
        "      builtinItems.push({",
        "        key: 'system',",
        "        label: t('settings.system'),",
        "        icon: <Computer theme='outline' size='20' fill={iconColors.secondary} />,",
        "      });",
        "    }",
        "",
        "    builtinItems.push({ key: 'about', label: t('settings.about'), icon: <Info theme='outline' size='20' fill={iconColors.secondary} /> });",
      ].join("\n"),
    );
  }

  output = output.replace(
    "  }, [t, isDesktop, extensionTabs, resolveExtTabName]);",
    "  }, [t, isDesktop, extensionTabs, resolveExtTabName, relayAdvancedSurfacesEnabled]);",
  );

  const renderAnchor = [
    "  const renderBuiltinContent = () => {",
    "    switch (activeTab) {",
  ].join("\n");
  if (!output.includes(renderAnchor)) {
    throw new Error("Could not find SettingsModal renderBuiltinContent anchor");
  }
  output = output.replace(
    renderAnchor,
    [
      "  const renderBuiltinContent = () => {",
      "    if (!relayAdvancedSurfacesEnabled && isRelayAdvancedSurfaceTab(activeTab)) {",
      "      return <AboutModalContent />;",
      "    }",
      "",
      "    switch (activeTab) {",
    ].join("\n"),
  );

  return output;
}

export function patchWebuiModalContent(input) {
  if (input.includes("RELAY_ADVANCED_SURFACES_KEY")) return input;

  let output = input;
  const keyAnchor = "const DESKTOP_WEBUI_ALLOW_REMOTE_KEY = 'webui.desktop.allowRemote';\n";
  if (!output.includes(keyAnchor)) {
    throw new Error("Could not find WebuiModalContent advanced-surface key anchor");
  }
  output = output.replace(
    keyAnchor,
    `${keyAnchor}const RELAY_ADVANCED_SURFACES_KEY = 'relay.advancedSurfaces.enabled';\n`,
  );

  const stateAnchor = "  const [activeTab, setActiveTab] = useState<'webui' | 'channels'>('webui');\n";
  if (!output.includes(stateAnchor)) {
    throw new Error("Could not find WebuiModalContent activeTab state anchor");
  }
  output = output.replace(
    stateAnchor,
    `${stateAnchor}  const [relayAdvancedSurfacesEnabled, setRelayAdvancedSurfacesEnabled] = useState(false);\n`,
  );

  const desktopAnchor = [
    "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
    "  const isDesktop = isElectronDesktop();",
    "",
    "  const [status, setStatus] = useState<IWebUIStatus | null>(null);",
  ].join("\n");
  if (!output.includes(desktopAnchor)) {
    throw new Error("Could not find WebuiModalContent desktop state anchor");
  }
  output = output.replace(
    desktopAnchor,
    [
      "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
      "  const isDesktop = isElectronDesktop();",
      "",
      "  useEffect(() => {",
      "    if (!relayAdvancedSurfacesEnabled && activeTab === 'channels') {",
      "      setActiveTab('webui');",
      "    }",
      "  }, [activeTab, relayAdvancedSurfacesEnabled]);",
      "",
      "  const [status, setStatus] = useState<IWebUIStatus | null>(null);",
    ].join("\n"),
  );

  const loadAnchor = [
    "      const [savedEnabled, savedAllowRemote] = await Promise.all([",
    "        ConfigStorage.get(DESKTOP_WEBUI_ENABLED_KEY).catch(() => false),",
    "        ConfigStorage.get(DESKTOP_WEBUI_ALLOW_REMOTE_KEY).catch(() => false),",
    "      ]);",
    "      setWebuiEnabled(savedEnabled === true);",
    "      setAllowRemotePreference(savedAllowRemote === true);",
  ].join("\n");
  if (!output.includes(loadAnchor)) {
    throw new Error("Could not find WebuiModalContent loadStatus preference anchor");
  }
  output = output.replace(
    loadAnchor,
    [
      "      const [savedEnabled, savedAllowRemote, savedRelayAdvancedSurfacesEnabled] = await Promise.all([",
      "        ConfigStorage.get(DESKTOP_WEBUI_ENABLED_KEY).catch(() => false),",
      "        ConfigStorage.get(DESKTOP_WEBUI_ALLOW_REMOTE_KEY).catch(() => false),",
      "        ConfigStorage.get(RELAY_ADVANCED_SURFACES_KEY).catch(() => false),",
      "      ]);",
      "      setWebuiEnabled(savedEnabled === true);",
      "      setAllowRemotePreference(savedAllowRemote === true);",
      "      setRelayAdvancedSurfacesEnabled(savedRelayAdvancedSurfacesEnabled === true);",
    ].join("\n"),
  );

  output = output.replace(
    "              t('settings.webui.allowRemote', { defaultValue: 'Allow Remote Access' }),",
    "              ...(relayAdvancedSurfacesEnabled\n                ? [t('settings.webui.allowRemote', { defaultValue: 'Allow Remote Access' })]\n                : []),",
  );

  const remoteHintAnchor = [
    "          <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>",
    "            <Earth theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />",
    "            <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.webui.featureRemoteDesc')}</div>",
    "          </div>",
  ].join("\n");
  if (!output.includes(remoteHintAnchor)) {
    throw new Error("Could not find WebuiModalContent remote hint anchor");
  }
  output = output.replace(
    remoteHintAnchor,
    [
      "          {relayAdvancedSurfacesEnabled && (",
      "            <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>",
      "              <Earth theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />",
      "              <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.webui.featureRemoteDesc')}</div>",
      "            </div>",
      "          )}",
    ].join("\n"),
  );

  const allowRemoteAnchor = [
    "          <PreferenceRow",
    "            label={t('settings.webui.allowRemote')}",
    "            description={",
    "              <span className='text-t-secondary'>",
    "                {t('settings.webui.allowRemoteDesc')}",
    "                {'  '}",
    "                <button",
    "                  className='text-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-12px'",
    "                  onClick={() =>",
    "                    shell.openExternal",
    "                      .invoke('https://github.com/iOfficeAI/AionUi/wiki/Remote-Internet-Access-Guide')",
    "                      .catch(console.error)",
    "                  }",
    "                >",
    "                  {t('settings.webui.viewGuide')}",
    "                </button>",
    "              </span>",
    "            }",
    "          >",
    "            <Switch checked={allowRemotePreference} onChange={handleAllowRemoteChange} />",
    "          </PreferenceRow>",
  ].join("\n");
  if (!output.includes(allowRemoteAnchor)) {
    throw new Error("Could not find WebuiModalContent allow remote row anchor");
  }
  output = output.replace(
    allowRemoteAnchor,
    [
      "          {relayAdvancedSurfacesEnabled && (",
      "            <PreferenceRow",
      "              label={t('settings.webui.allowRemote')}",
      "              description={",
      "                <span className='text-t-secondary'>",
      "                  {t('settings.webui.allowRemoteDesc')}",
      "                  {'  '}",
      "                  <button",
      "                    className='text-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-12px'",
      "                    onClick={() =>",
      "                      shell.openExternal",
      "                        .invoke('https://github.com/iOfficeAI/AionUi/wiki/Remote-Internet-Access-Guide')",
      "                        .catch(console.error)",
      "                    }",
      "                  >",
      "                    {t('settings.webui.viewGuide')}",
      "                  </button>",
      "                </span>",
      "              }",
      "            >",
      "              <Switch checked={allowRemotePreference} onChange={handleAllowRemoteChange} />",
      "            </PreferenceRow>",
      "          )}",
    ].join("\n"),
  );

  output = output.replace(
    "{status?.running && status.allowRemote && (",
    "{relayAdvancedSurfacesEnabled && status?.running && status.allowRemote && (",
  );

  output = output.replace(
    "        onChange={(key) => setActiveTab((key as 'webui' | 'channels') || 'webui')}",
    "        onChange={(key) => setActiveTab(relayAdvancedSurfacesEnabled ? ((key as 'webui' | 'channels') || 'webui') : 'webui')}",
  );

  const channelsTabAnchor = [
    "        <Tabs.TabPane",
    "          key='channels'",
    "          title={",
    "            <span",
    "              data-webui-tab='channels'",
    "              className={`inline-flex items-center gap-6px transition-colors ${activeTab === 'channels' ? 'text-t-primary font-600' : 'text-t-secondary'}`}",
    "            >",
    "              <Communication theme='outline' size='15' />",
    "              <span>Channels</span>",
    "              <span className='inline-flex items-center gap-4px ml-2px'>",
    "                {CHANNEL_LOGOS.map((item) => (",
    "                  <span",
    "                    key={item.alt}",
    "                    className='inline-flex items-center justify-center w-16px h-16px rd-50% border border-line bg-fill-1'",
    "                    title={item.alt}",
    "                    aria-label={item.alt}",
    "                  >",
    "                    <img src={item.src} alt={item.alt} className='w-14px h-14px object-contain' />",
    "                  </span>",
    "                ))}",
    "              </span>",
    "            </span>",
    "          }",
    "        />",
  ].join("\n");
  if (!output.includes(channelsTabAnchor)) {
    throw new Error("Could not find WebuiModalContent channels tab anchor");
  }
  output = output.replace(
    channelsTabAnchor,
    [
      "        {relayAdvancedSurfacesEnabled && (",
      "          <Tabs.TabPane",
      "            key='channels'",
      "            title={",
      "              <span",
      "                data-webui-tab='channels'",
      "                className={`inline-flex items-center gap-6px transition-colors ${activeTab === 'channels' ? 'text-t-primary font-600' : 'text-t-secondary'}`}",
      "              >",
      "                <Communication theme='outline' size='15' />",
      "                <span>Channels</span>",
      "                <span className='inline-flex items-center gap-4px ml-2px'>",
      "                  {CHANNEL_LOGOS.map((item) => (",
      "                    <span",
      "                      key={item.alt}",
      "                      className='inline-flex items-center justify-center w-16px h-16px rd-50% border border-line bg-fill-1'",
      "                      title={item.alt}",
      "                      aria-label={item.alt}",
      "                    >",
      "                      <img src={item.src} alt={item.alt} className='w-14px h-14px object-contain' />",
      "                    </span>",
      "                  ))}",
      "                </span>",
      "              </span>",
      "            }",
      "          />",
      "        )}",
    ].join("\n"),
  );

  output = output.replace(
    "      {activeTab === 'webui' ? (",
    "      {activeTab === 'webui' || !relayAdvancedSurfacesEnabled ? (",
  );

  return output;
}

function copyBrandingAssets(targetRoot) {
  const resourcesDir = resolve(targetRoot, "resources");
  const rendererBrandDir = resolve(targetRoot, "src/renderer/assets/logos/brand");
  const publicPwaDir = resolve(targetRoot, "public/pwa");

  mkdirSync(resourcesDir, { recursive: true });
  mkdirSync(rendererBrandDir, { recursive: true });
  mkdirSync(publicPwaDir, { recursive: true });

  const pngIcon = resolve(desktopIconRoot, "icon.png");
  const icoIcon = resolve(desktopIconRoot, "icon.ico");
  const icnsIcon = resolve(desktopIconRoot, "icon.icns");
  const png128Icon = resolve(desktopIconRoot, "128x128.png");
  const svgIcon = resolve(desktopIconRoot, "source/relay-agent.svg");
  const faviconSvg = resolve(repoRoot, "apps/desktop/public/favicon.svg");

  copyFileSync(icoIcon, resolve(resourcesDir, "app.ico"));
  copyFileSync(icnsIcon, resolve(resourcesDir, "app.icns"));
  copyFileSync(pngIcon, resolve(resourcesDir, "app.png"));
  copyFileSync(pngIcon, resolve(resourcesDir, "app_dev.png"));
  copyFileSync(pngIcon, resolve(resourcesDir, "icon.png"));
  copyFileSync(pngIcon, resolve(resourcesDir, "aionui_logo_no_border.png"));
  copyFileSync(pngIcon, resolve(rendererBrandDir, "app.png"));
  copyFileSync(svgIcon, resolve(resourcesDir, "aionui_logo_black_bg.svg"));
  copyFileSync(svgIcon, resolve(rendererBrandDir, "aion.svg"));
  copyFileSync(faviconSvg, resolve(targetRoot, "public/favicon.svg"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-180.png"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-192.png"));
  copyFileSync(pngIcon, resolve(publicPwaDir, "icon-512.png"));

  return {
    resourcesDir,
    rendererBrandDir,
    publicPwaDir,
  };
}

function copyRelayGatewayResources(targetRoot) {
  const sourceDir = resolve(repoRoot, "apps/desktop/src-tauri/binaries");
  const resourcesDir = resolve(targetRoot, "resources/relay-gateway");
  const files = [
    "copilot_server.js",
    "copilot_server.mjs",
    "copilot_dom_poll.mjs",
    "copilot_send_timing.mjs",
    "copilot_wait_dom_response.mjs",
  ];

  mkdirSync(resourcesDir, { recursive: true });
  for (const file of files) {
    const sourcePath = resolve(sourceDir, file);
    if (!existsSync(sourcePath)) {
      throw new Error(`Relay gateway resource was not found: ${sourcePath}`);
    }
    copyFileSync(sourcePath, resolve(resourcesDir, file));
  }

  return resourcesDir;
}

function copyRelayToolResources(targetRoot, sources = {}) {
  const ripgrepSourcePath =
    sources.ripgrepSourcePath ??
    resolve(repoRoot, "apps/desktop/src-tauri/binaries/relay-rg-x86_64-pc-windows-msvc.exe");
  if (!existsSync(ripgrepSourcePath)) {
    throw new Error(
      `Bundled ripgrep was not found: ${ripgrepSourcePath}. Run TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc node apps/desktop/scripts/fetch-bundled-ripgrep.mjs before applying the AionUi overlay.`,
    );
  }

  const relayToolsDir = resolve(targetRoot, "resources/relay-tools");
  const ripgrepDir = resolve(relayToolsDir, "ripgrep");
  mkdirSync(ripgrepDir, { recursive: true });
  rmSync(resolve(relayToolsDir, "node"), { recursive: true, force: true });
  rmSync(resolve(relayToolsDir, "liteparse-runner"), { recursive: true, force: true });
  copyFileSync(ripgrepSourcePath, resolve(ripgrepDir, "rg.exe"));
  return relayToolsDir;
}

export function relayDocumentSearchSkillContent() {
  return ensureTrailingNewline(
    [
      "---",
      "name: relay-document-search",
      'description: "Use this skill for beginner-facing document search, local file discovery, Office/text reading, PDF filename discovery, and evidence-backed summaries in Relay Agent."',
      "---",
      "",
      "# Relay Document Search Skill",
      "",
      "This skill is the single beginner-facing `資料を探す` workflow. It covers file discovery, content checks, and evidence-backed summaries. Do not ask the user to choose between separate search and summary modes before starting.",
      "",
      "## Routing",
      "",
      "- Treat requests to find files, search folders, inspect local documents, or summarize local files as one document-finding workflow.",
      "- If the provider tool catalog exposes `relay_document_search`, `relay-document-search`, `workspace_document_search`, `workspace-search`, or `find-files`, call that high-level tool first.",
      "- Do not manually decompose the first step into raw `glob`, `grep`, and `read` calls when a high-level document search tool is available.",
      "- If only low-level tools are available, use broad discovery first, then read exact candidates, then summarize from confirmed evidence only.",
      "",
      "## Search Quality",
      "",
      "- Expand the user's terms with obvious Japanese/English variants, abbreviations, fiscal-period terms, and supporting workpaper terms.",
      "- For finance/CFS work, search direct terms such as `キャッシュフロー`, `CFS`, `CF`, `連結CF`, and `連結CFS`, plus supporting terms such as `精算表`, `設備投資`, `償却`, `有利子負債`, `BS`, and `PL`.",
      "- Treat filing, disclosure, output, review, and backup folders as candidates, not proof that the files are source workpapers.",
      "- If early results are concentrated in one branch, quarter, filing folder, backup folder, or filename family, continue searching sibling folders and alternate terms before finalizing.",
      "",
      "## Evidence",
      "",
      "- Never present a file as required, latest, authoritative, or source-of-truth unless tool results prove it.",
      "- Separate direct source/workpaper candidates, supporting evidence, disclosure/output files, and backups.",
      "- For summaries, cite the available file, page, sheet, cell range, heading, or excerpt anchor. If extraction is unavailable, say so instead of guessing.",
      "- Keep internal terms such as AionUi, Dedoc, Evidence Pack, Query Trace, parser lineage, and reader capabilities out of beginner-facing answers unless the user opens support details.",
    ].join("\n"),
  );
}

function copyRelaySkillResources(targetRoot) {
  const skillDir = resolve(targetRoot, "src/process/resources/skills/relay-document-search");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), relayDocumentSearchSkillContent(), "utf8");
  return skillDir;
}

function patchRendererLocaleFiles(targetRoot) {
  const localeRoot = resolve(targetRoot, "src/renderer/services/i18n/locales");
  if (!existsSync(localeRoot)) return;
  for (const localeDir of readdirSync(localeRoot, { withFileTypes: true })) {
    if (!localeDir.isDirectory()) continue;
    const dirPath = resolve(localeRoot, localeDir.name);
    for (const file of readdirSync(dirPath, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const filePath = resolve(dirPath, file.name);
      writeFileSync(filePath, patchLocaleJsonContent(readFileSync(filePath, "utf8")), "utf8");
    }
  }
}

function patchAionCliCoreSearchFiles(targetRoot) {
  const coreRoot = resolve(targetRoot, "node_modules/@office-ai/aioncli-core/dist/src");
  if (!existsSync(coreRoot)) {
    return null;
  }

  const globPath = resolve(coreRoot, "tools/glob.js");
  const ripGrepPath = resolve(coreRoot, "tools/ripGrep.js");
  const definitionPaths = [
    resolve(coreRoot, "tools/definitions/model-family-sets/default-legacy.js"),
    resolve(coreRoot, "tools/definitions/model-family-sets/gemini-3.js"),
  ];

  for (const requiredPath of [globPath, ripGrepPath, ...definitionPaths]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`AionCLI shared search patch target was not found: ${requiredPath}`);
    }
  }

  writeFileSync(globPath, patchAionCliCoreGlobContent(readFileSync(globPath, "utf8")), "utf8");
  writeFileSync(ripGrepPath, patchAionCliCoreRipGrepContent(readFileSync(ripGrepPath, "utf8")), "utf8");
  for (const definitionPath of definitionPaths) {
    writeFileSync(
      definitionPath,
      patchAionCliCoreToolDefinitionsContent(readFileSync(definitionPath, "utf8")),
      "utf8",
    );
  }

  return {
    coreRoot,
    globPath,
    ripGrepPath,
    definitionPaths,
  };
}

export function patchAionuiBuildMcpServersContent(input) {
  if (input.includes("relay-document-search-mcp-stdio.js")) {
    return input;
  }

  const anchor = [
    "    esbuild.build({",
    "      ...SHARED_OPTIONS,",
    "      entryPoints: [path.join(ROOT, 'src/process/team/mcp/guide/teamGuideMcpStdio.ts')],",
    "      outfile: path.join(ROOT, 'out/main/team-guide-mcp-stdio.js'),",
    "    }),",
  ].join("\n");
  if (!input.includes(anchor)) {
    throw new Error("Could not find build-mcp-servers team-guide entry anchor");
  }
  return input.replace(
    anchor,
    [
      anchor,
      "    esbuild.build({",
      "      ...SHARED_OPTIONS,",
      "      entryPoints: [path.join(ROOT, 'src/process/utils/relayDocumentSearchMcpStdio.ts')],",
      "      outfile: path.join(ROOT, 'out/main/relay-document-search-mcp-stdio.js'),",
      "    }),",
    ].join("\n"),
  );
}

export function patchTeamGuideMcpStdioContent(input) {
  const marker = "Relay Agent document-search fallback on team-guide MCP";
  if (input.includes(marker)) return input;

  let output = input;
  const importAnchor = "import { getCreateTeamToolDescription } from '@process/team/prompts/teamGuidePrompt.ts';";
  if (!output.includes(importAnchor)) {
    throw new Error("Could not find team-guide MCP import anchor");
  }
  output = output.replace(
    importAnchor,
    [
      importAnchor,
      "import {",
      "  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,",
      "  RELAY_DOCUMENT_SEARCH_TOOL_NAME,",
      "} from '@process/utils/relayDocumentSearchContract';",
    ].join("\n"),
  );

  const envAnchor = "const AION_MCP_PORT = parseInt(process.env.AION_MCP_PORT || '0', 10);";
  if (!output.includes(envAnchor)) {
    throw new Error("Could not find team-guide MCP environment anchor");
  }
  output = output.replace(
    envAnchor,
    [
      envAnchor,
      "",
      `// ${marker}.`,
      "const relayDocumentSearchWorkspace = process.env.RELAY_DOCUMENT_SEARCH_WORKSPACE || process.cwd();",
      "const relayDocumentSearchConversationId = process.env.RELAY_DOCUMENT_SEARCH_CONVERSATION_ID || AION_MCP_CONVERSATION_ID || undefined;",
      "const relayDocumentSearchMetadataCacheDir = process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR || undefined;",
      "const relayDocumentSearchFilenameIndexDir = process.env.RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR || undefined;",
      "const relayDocumentSearchIndexDbPath = process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH || undefined;",
      "const relayParsedDocumentCacheDir = process.env.RELAY_PARSED_DOCUMENT_CACHE_DIR || undefined;",
      "const relayDerivedContentIndexDir = process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR || undefined;",
      "const relayIndexCoordinatorDir = process.env.RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_DIR || undefined;",
      "const relayDocumentSearchUserMemoryDir = process.env.RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR || undefined;",
      "const relayDocumentSearchSyncJournalDir = process.env.RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR || undefined;",
      "const relayFailureRegistryDir = process.env.RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_DIR || undefined;",
      "const relayJobStoreDir = process.env.RELAY_DOCUMENT_SEARCH_JOB_STORE_DIR || undefined;",
      "const RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT = 'RelayDocumentSearchAionUiResultFlow.v1' as const;",
    ].join("\n"),
  );

  const helperAnchor = "// ── Main ─────────────────────────────────────────────────────────────────────";
  if (!output.includes(helperAnchor)) {
    throw new Error("Could not find team-guide MCP main anchor");
  }
  const helper = [
    "function normalizeRelayDocumentSearchRoots(roots: unknown): string[] {",
    "  const provided = Array.isArray(roots)",
    "    ? roots.map((root) => String(root || '').trim()).filter(Boolean)",
    "    : [];",
    "  if (provided.length > 0) return provided;",
    "  return relayDocumentSearchWorkspace ? [relayDocumentSearchWorkspace] : [];",
    "}",
    "",
    "function relayDocumentSearchErrorContent(error: unknown): string {",
    "  const message = error instanceof Error ? error.message : String(error);",
    "  return JSON.stringify(",
    "    {",
    "      schemaVersion: RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT,",
    "      toolName: RELAY_DOCUMENT_SEARCH_TOOL_NAME,",
    "      resultContract: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,",
    "      status: 'failed',",
    "      error: {",
    "        code: 'relay_document_search_team_guide_handler_failed',",
    "        message,",
    "      },",
    "    },",
    "    null,",
    "    2,",
    "  );",
    "}",
    "",
    "function createRelayDocumentSearchTool(server: McpServer): void {",
    "  server.tool(",
    "    RELAY_DOCUMENT_SEARCH_TOOL_NAME,",
    "    `Find local workspace documents through Relay Agent. Use this as the first tool for document search, folder search, local file discovery, Office/text lookup, PDF filename discovery, and evidence-backed summaries. Returns ${RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT} with a compact result summary, structured result cards, continuation, selection, and secondary Copilot prose metadata. The full raw ${RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT} stays inside Relay diagnostics instead of being returned to chat.`,",
    "    {",
    "      query: z.string().min(1).max(2000).describe('The user request in their own words.'),",
    "      roots: z",
    "        .array(z.string().min(1))",
    "        .max(16)",
    "        .optional()",
    "        .describe('Workspace roots to search. Omit to use the current AionUi workspace.'),",
    "      intent: z",
    "        .enum(['find_files', 'answer_with_evidence', 'summarize_with_evidence', 'inspect_file', 'similar_documents'])",
    "        .optional()",
    "        .describe('Document workflow intent.'),",
    "      thoroughness: z.enum(['quick', 'thorough']).optional().describe('Search thoroughness.'),",
    "      fileTypes: z",
    "        .array(z.enum(['any', 'txt', 'md', 'csv', 'docx', 'xlsx', 'xlsm', 'pptx', 'pdf']))",
    "        .optional()",
    "        .describe('Optional file-type filters.'),",
    "      maxResults: z.number().int().min(1).max(300).optional().describe('Maximum candidate count.'),",
    "      evidence: z.enum(['none', 'candidate', 'required']).optional().describe('Evidence requirement.'),",
    "      queryPlanHints: z",
    "        .object({",
    "          schemaVersion: z.literal('RelayDocumentSearchCopilotQueryPlan.v1'),",
    "          rawQuery: z.string().min(1).max(2000),",
    "          intent: z.enum(['find_files', 'answer_with_evidence', 'summarize_with_evidence', 'inspect_file', 'similar_documents']),",
    "          evidence: z.enum(['none', 'candidate', 'required']),",
    "          thoroughness: z.enum(['quick', 'thorough']),",
    "          expandedTerms: z.array(z.string().min(1).max(80)).max(40),",
    "          supportTerms: z.array(z.string().min(1).max(80)).max(40),",
    "          demoteTerms: z.array(z.string().min(1).max(80)).max(40),",
    "          fileTypeHints: z.array(z.enum(['any', 'txt', 'md', 'csv', 'docx', 'xlsx', 'xlsm', 'pptx', 'pdf'])).max(10),",
    "          timeScopeIntent: z",
    "            .enum(['latest_first', 'historical_examples', 'balanced', 'explicit_period', 'unknown'])",
    "            .optional(),",
    "          summary: z.string().max(280).optional(),",
    "        })",
    "        .optional()",
    "        .describe('Validated Copilot query-plan hints generated from the natural-language request.'),",
    "    },",
    "    async (args: Record<string, unknown>) => {",
    "      try {",
    "        const { handleRelayDocumentSearchToolCall, relayDocumentSearchBridgeToolDefinition } = await import(",
    "          '@process/utils/relayDocumentSearchBridge'",
    "        );",
    "        const execution = await handleRelayDocumentSearchToolCall(",
    "          {",
    "            id: `relay-document-search-${Date.now().toString(36)}`,",
    "            name: RELAY_DOCUMENT_SEARCH_TOOL_NAME,",
    "            parameters: {",
    "              ...args,",
    "              roots: normalizeRelayDocumentSearchRoots(args.roots),",
    "            },",
    "          },",
    "          {",
    "            advertisedTools: [relayDocumentSearchBridgeToolDefinition],",
    "            aionuiConversationId: relayDocumentSearchConversationId,",
    "            useMetadataCache: true,",
    "            metadataCacheDir: relayDocumentSearchMetadataCacheDir,",
    "            useFilenameIndex: true,",
    "            filenameIndexDir: relayDocumentSearchFilenameIndexDir,",
    "            useIndexDb: true,",
    "            indexDbPath: relayDocumentSearchIndexDbPath,",
    "            indexDbPrimaryMode: 'primary',",
    "            useParsedDocumentCache: true,",
    "            parsedDocumentCacheDir: relayParsedDocumentCacheDir,",
    "            useDerivedContentIndexCache: true,",
    "            derivedContentIndexDir: relayDerivedContentIndexDir,",
    "            useIndexCoordinator: true,",
    "            indexCoordinatorDir: relayIndexCoordinatorDir,",
    "            useFailureRegistry: true,",
    "            failureRegistryDir: relayFailureRegistryDir,",
    "            useJobStore: true,",
    "            jobStoreDir: relayJobStoreDir,",
    "            useUserMemory: true,",
    "            userMemoryDir: relayDocumentSearchUserMemoryDir,",
    "            useSyncJournal: true,",
    "            syncJournalDir: relayDocumentSearchSyncJournalDir,",
    "            source: 'aionui-skill',",
    "          },",
    "        );",
    "",
    "        return {",
    "          content: [{ type: 'text' as const, text: execution.aionuiContent }],",
    "          isError: !execution.ok,",
    "        };",
    "      } catch (error) {",
    "        return {",
    "          content: [{ type: 'text' as const, text: relayDocumentSearchErrorContent(error) }],",
    "          isError: true,",
    "        };",
    "      }",
    "    },",
    "  );",
    "}",
    "",
  ].join("\n");
  output = output.replace(helperAnchor, `${helper}${helperAnchor}`);

  const mainAnchor = "async function main(): Promise<void> {";
  if (!output.includes(mainAnchor)) {
    throw new Error("Could not find team-guide MCP main function anchor");
  }
  output = output.replace(mainAnchor, `createRelayDocumentSearchTool(server);\n\n${mainAnchor}`);

  return ensureTrailingNewline(output);
}

export function patchAionrsAgentContent(input) {
  let output = input;

  output = output.replace(
    "import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';",
    "import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';",
  );
  if (!output.includes("import { homedir } from 'node:os';") && output.includes("from 'node:fs';")) {
    output = output.replace("import { join } from 'node:path';", "import { homedir } from 'node:os';\nimport { join } from 'node:path';");
  }

  const runtimeHelperAnchor = "const AIONRS_PROJECT_CONFIG = '.aionrs.toml';";
  if (output.includes(runtimeHelperAnchor) && !output.includes("RELAY_AIONRS_RUNTIME_ROOT_ENV")) {
    output = output.replace(
      runtimeHelperAnchor,
      [
        runtimeHelperAnchor,
        "const RELAY_AIONRS_RUNTIME_ROOT_ENV = 'RELAY_AIONRS_RUNTIME_ROOT';",
        "",
        "function relayAionrsRuntimeRoot(): string {",
        "  const configured = process.env[RELAY_AIONRS_RUNTIME_ROOT_ENV]?.trim();",
        "  if (configured) return configured;",
        "  return join(process.env.LOCALAPPDATA || process.env.APPDATA || homedir(), 'Relay Agent', 'aionrs');",
        "}",
        "",
        "function relaySafePathSegment(value: string | undefined, fallback: string): string {",
        "  const normalized = (value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96);",
        "  return normalized || fallback;",
        "}",
      ].join("\n"),
    );
  }

  if (!output.includes("awaitedMcpReadyNames")) {
    const readyFieldAnchor = "  private mcpReadyResolve!: () => void;";
    if (!output.includes(readyFieldAnchor)) {
      throw new Error("Could not find AionrsAgent MCP ready field anchor");
    }
    output = output.replace(
      readyFieldAnchor,
      [
        readyFieldAnchor,
        "  private awaitedMcpReadyNames = new Set<string>();",
        "  private seenMcpReadyNames = new Set<string>();",
      ].join("\n"),
    );
  }

  const spawnConfigAnchor = [
    "    const { args, env, projectConfig } = buildSpawnConfig(this.options.model, {",
    "      workspace: this.options.workspace,",
    "      maxTokens: this.options.maxTokens,",
    "      maxTurns: this.options.maxTurns,",
    "      autoApprove: this.options.yoloMode,",
    "      sessionId: this.options.sessionId,",
    "      resume: this.options.resume,",
    "    });",
  ].join("\n");
  if (output.includes(spawnConfigAnchor) && !output.includes("const relayRuntimeWorkspace = this.relayRuntimeWorkspace();")) {
    output = output.replace(
      spawnConfigAnchor,
      [
        spawnConfigAnchor,
        "",
        "    const relayRuntimeWorkspace = this.relayRuntimeWorkspace();",
        "    if (this.options.workspace && !args.includes('--cwd')) {",
        "      args.push('--cwd', this.options.workspace);",
        "    }",
      ].join("\n"),
    );
  }
  output = output.replace(
    "      this.writeProjectConfig(projectConfig);",
    "      this.writeProjectConfig(projectConfig, relayRuntimeWorkspace);",
  );
  output = output.replace("      cwd: this.options.workspace,", "      cwd: relayRuntimeWorkspace,");

  if (!output.includes("private relayRuntimeWorkspace(): string")) {
    const writeConfigAnchor = "  private writeProjectConfig(content: string): void {";
    if (output.includes(writeConfigAnchor)) {
      output = output.replace(
        writeConfigAnchor,
        [
          "  private relayRuntimeWorkspace(): string {",
          "    const sessionSegment = relaySafePathSegment(this.options.sessionId || this.options.resume, 'session');",
          "    const runtimeWorkspace = join(relayAionrsRuntimeRoot(), 'sessions', sessionSegment);",
          "    mkdirSync(runtimeWorkspace, { recursive: true });",
          "    return runtimeWorkspace;",
          "  }",
          "",
          "  private writeProjectConfig(content: string, configDir = this.options.workspace): void {",
        ].join("\n"),
      );
    }
  } else {
    output = output.replace("  private writeProjectConfig(content: string): void {", "  private writeProjectConfig(content: string, configDir = this.options.workspace): void {");
  }
  output = output.replace(
    "    const configPath = join(this.options.workspace, AIONRS_PROJECT_CONFIG);",
    "    const configPath = join(configDir, AIONRS_PROJECT_CONFIG);",
  );

  const setupAnchor = [
    "    const stdioMcpServers = this.options.stdioMcpServers ?? [];",
    "    let awaitAnyReady = false;",
  ].join("\n");
  if (output.includes(setupAnchor)) {
    output = output.replace(
      setupAnchor,
      [
        "    const stdioMcpServers = this.options.stdioMcpServers ?? [];",
        "    this.awaitedMcpReadyNames = new Set(stdioMcpServers.filter((server) => server.awaitReady).map((server) => server.name));",
        "    this.seenMcpReadyNames = new Set();",
        "    this.mcpReadyPromise = new Promise((resolve) => {",
        "      this.mcpReadyResolve = resolve;",
        "    });",
      ].join("\n"),
    );
    output = output.replace("      if (server.awaitReady) awaitAnyReady = true;\n", "");
    output = output.replace("    if (awaitAnyReady) {", "    if (this.awaitedMcpReadyNames.size > 0) {");
  }

  const readyCaseAnchor = [
    "      case 'mcp_ready':",
    "        this.mcpReadyResolve();",
    "        break;",
  ].join("\n");
  if (output.includes(readyCaseAnchor)) {
    output = output.replace(
      readyCaseAnchor,
      [
        "      case 'mcp_ready':",
        "        if (event.name) this.seenMcpReadyNames.add(event.name);",
        "        if (",
        "          this.awaitedMcpReadyNames.size === 0 ||",
        "          [...this.awaitedMcpReadyNames].every((name) => this.seenMcpReadyNames.has(name))",
        "        ) {",
        "          this.mcpReadyResolve();",
        "        }",
        "        break;",
      ].join("\n"),
    );
  }
  return output;
}

export function patchAionrsManagerContent(input) {
  let output = input;
  if (!output.includes("import path from 'path';")) {
    const anchor = "import { ipcBridge } from '@/common';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager import anchor");
    }
    output = output.replace(anchor, `${anchor}\nimport path from 'path';`);
  }
  const mcpScriptDirImport = "import { resolveMcpScriptDir } from '@process/team/mcp/tcpHelpers';";
  if (!output.includes(mcpScriptDirImport)) {
    const anchor = "import path from 'path';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager path import anchor");
    }
    output = output.replace(anchor, `${anchor}\n${mcpScriptDirImport}`);
  }

  if (!output.includes("displayContent?: string")) {
    const signatureAnchor = "  async sendMessage(data: { content: string; msg_id: string; files?: string[] }) {";
    if (output.includes(signatureAnchor)) {
      output = output.replace(
        signatureAnchor,
        "  async sendMessage(data: { content: string; displayContent?: string; msg_id: string; files?: string[] }) {",
      );
    }
  }
  const managerDisplayAnchor = "      content: { content: data.content },";
  if (output.includes(managerDisplayAnchor) && !output.includes("data.displayContent || data.content")) {
    output = output.replace(
      managerDisplayAnchor,
      "      content: { content: data.displayContent || data.content },",
    );
  }

  const injection = [
    "      const relayDocumentSearch = this.buildRelayDocumentSearchMcpStdioConfig(mergedData.workspace);",
    "      if (relayDocumentSearch) stdioMcpServers.push(relayDocumentSearch);",
  ].join("\n");
  const legacyAnchor = [
    "      const teamGuide = await this.buildTeamGuideMcpStdioConfig();",
    "      if (teamGuide) stdioMcpServers.push(teamGuide);",
    "    }",
  ].join("\n");
  output = output.replace(`${legacyAnchor}\n${injection}`, legacyAnchor);
  if (!output.includes(injection)) {
    const anchor = "    const stdioMcpServers: StdioMcpOption[] = [];";
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager stdio MCP list anchor");
    }
    output = output.replace(anchor, `${anchor}\n${injection}`);
  }

  const teamGuideDocumentSearchEnvMarker = "{ name: 'RELAY_DOCUMENT_SEARCH_TEAM_GUIDE_FALLBACK', value: '1' }";
  if (!output.includes(teamGuideDocumentSearchEnvMarker)) {
    const anchor = "        { name: 'AION_MCP_CONVERSATION_ID', value: this.conversation_id },";
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager team-guide env anchor");
    }
    output = output.replace(
      anchor,
      [
        anchor,
        `        ${teamGuideDocumentSearchEnvMarker},`,
        "        { name: 'RELAY_DOCUMENT_SEARCH_WORKSPACE', value: this.workspace || '' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_CONVERSATION_ID', value: this.conversation_id },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'metadata-cache') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'filename-index') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'index-db', 'document-search.sqlite') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_PRIMARY_MODE', value: 'primary' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS', value: '80' },",
        "        { name: 'RELAY_PARSED_DOCUMENT_CACHE', value: '1' },",
        "        { name: 'RELAY_PARSED_DOCUMENT_CACHE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'parsed-document-cache') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'derived-content-index') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'index-coordinator') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'failure-registry') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_JOB_STORE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_JOB_STORE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'jobs') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'user-memory') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'sync-journal') },",
      ].join("\n"),
    );
  }

  const relayDocumentSearchMethod = [
    "  private buildRelayDocumentSearchMcpStdioConfig(workspace?: string): StdioMcpOption | undefined {",
    "    const scriptPath = path.join(resolveMcpScriptDir(), 'relay-document-search-mcp-stdio.js');",
    "    const command = process.env.RELAY_DOCUMENT_SEARCH_MCP_COMMAND || process.execPath || 'node';",
    "    const usesElectronNode = command === process.execPath;",
    "    return {",
    "      name: 'relay-document-search',",
    "      command,",
    "      args: [scriptPath],",
    "      awaitReady: true,",
    "      env: [",
    "        { name: 'ELECTRON_RUN_AS_NODE', value: usesElectronNode ? '1' : (process.env.ELECTRON_RUN_AS_NODE || '') },",
    "        { name: 'RELAY_DOCUMENT_SEARCH_WORKSPACE', value: workspace || '' },",
    "        { name: 'RELAY_DOCUMENT_SEARCH_CONVERSATION_ID', value: this.conversation_id },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'metadata-cache') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'filename-index') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'index-db', 'document-search.sqlite') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_PRIMARY_MODE', value: 'primary' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS', value: '80' },",
        "        { name: 'RELAY_PARSED_DOCUMENT_CACHE', value: '1' },",
        "        { name: 'RELAY_PARSED_DOCUMENT_CACHE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'parsed-document-cache') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'derived-content-index') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'index-coordinator') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'failure-registry') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_JOB_STORE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_JOB_STORE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'jobs') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'user-memory') },",
    "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL', value: '1' },",
    "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'sync-journal') },",
    "      ],",
    "    };",
    "  }",
  ].join("\n");
  if (output.includes("private buildRelayDocumentSearchMcpStdioConfig")) {
    const methodPattern =
      /  private buildRelayDocumentSearchMcpStdioConfig\(workspace\?: string\): StdioMcpOption \| undefined \{[\s\S]*?\n  \}\n\n  async stop\(\) \{/;
    if (!methodPattern.test(output)) {
      throw new Error("Could not replace AionrsManager Relay document-search MCP method");
    }
    output = output.replace(methodPattern, `${relayDocumentSearchMethod}\n\n  async stop() {`);
  } else {
    const anchor = [
      "  }",
      "",
      "  async stop() {",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager stop method anchor");
    }
    output = output.replace(
      anchor,
      [
        "  }",
        "",
        relayDocumentSearchMethod,
        "",
        "  async stop() {",
      ].join("\n"),
    );
  }

  return output;
}

function findRendererThemeBasePath(targetRoot) {
  for (const candidate of rendererThemeBaseCandidates) {
    const candidatePath = resolve(targetRoot, candidate);
    if (existsSync(candidatePath)) return candidatePath;
  }
  throw new Error(
    `AionUi renderer base stylesheet was not found. Tried: ${rendererThemeBaseCandidates.join(", ")}`,
  );
}

export function applyAionuiOverlay(aionuiDir, options = {}) {
  const targetRoot = resolve(aionuiDir);
  const indexPath = resolve(targetRoot, "src/index.ts");
  const initStoragePath = resolve(targetRoot, "src/process/utils/initStorage.ts");
  if (!existsSync(initStoragePath)) {
    throw new Error(`AionUi initStorage.ts was not found: ${initStoragePath}`);
  }
  const packageJsonPath = resolve(targetRoot, "package.json");
  const electronBuilderPath = resolve(targetRoot, "electron-builder.yml");
  const deepLinkPath = resolve(targetRoot, "src/process/utils/deepLink.ts");
  const trayPath = resolve(targetRoot, "src/process/utils/tray.ts");
  const rendererIndexHtmlPath = resolve(targetRoot, "src/renderer/index.html");
  const publicManifestPath = resolve(targetRoot, "public/manifest.webmanifest");
  const appConfigPath = resolve(targetRoot, "src/common/utils/appConfig.ts");
  const platformIndexPath = resolve(targetRoot, "src/common/platform/index.ts");
  const nodePlatformServicesPath = resolve(targetRoot, "src/common/platform/NodePlatformServices.ts");
  const aboutModalPath = resolve(targetRoot, "src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx");
  const updateModalPath = resolve(targetRoot, "src/renderer/components/settings/UpdateModal.tsx");
  const updateBridgePath = resolve(targetRoot, "src/process/bridge/updateBridge.ts");
  const agentLogoPath = resolve(targetRoot, "src/renderer/utils/model/agentLogo.ts");
  const titlebarPath = resolve(targetRoot, "src/renderer/components/layout/Titlebar/index.tsx");
  const layoutPath = resolve(targetRoot, "src/renderer/components/layout/Layout.tsx");
  const guidPagePath = resolve(targetRoot, "src/renderer/pages/guid/GuidPage.tsx");
  const guidActionRowPath = resolve(targetRoot, "src/renderer/pages/guid/components/GuidActionRow.tsx");
  const guidSendPath = resolve(targetRoot, "src/renderer/pages/guid/hooks/useGuidSend.ts");
  const sendBoxPath = resolve(targetRoot, "src/renderer/components/chat/sendbox.tsx");
  const aionrsSendBoxPath = resolve(targetRoot, "src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx");
  const chatConversationPath = resolve(targetRoot, "src/renderer/pages/conversation/components/ChatConversation.tsx");
  const rendererThemeBasePath = findRendererThemeBasePath(targetRoot);
  const settingsModalPath = resolve(targetRoot, "src/renderer/components/settings/SettingsModal/index.tsx");
  const webuiModalPath = resolve(
    targetRoot,
    "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx",
  );
  const buildMcpServersPath = resolve(targetRoot, "scripts/build-mcp-servers.js");
  const aionrsAgentPath = resolve(targetRoot, "src/process/agent/aionrs/index.ts");
  const aionrsManagerPath = resolve(targetRoot, "src/process/task/AionrsManager.ts");
  const conversationBridgePath = resolve(targetRoot, "src/process/bridge/conversationBridge.ts");
  const teamGuideMcpStdioPath = resolve(targetRoot, "src/process/team/mcp/guide/teamGuideMcpStdio.ts");
  for (const requiredPath of [
    indexPath,
    packageJsonPath,
    electronBuilderPath,
    deepLinkPath,
    trayPath,
    rendererIndexHtmlPath,
    publicManifestPath,
    appConfigPath,
    platformIndexPath,
    nodePlatformServicesPath,
    aboutModalPath,
    updateModalPath,
    updateBridgePath,
    agentLogoPath,
    titlebarPath,
    layoutPath,
    guidPagePath,
    guidActionRowPath,
    guidSendPath,
    sendBoxPath,
    aionrsSendBoxPath,
    chatConversationPath,
    rendererThemeBasePath,
    settingsModalPath,
    webuiModalPath,
    buildMcpServersPath,
    aionrsAgentPath,
    aionrsManagerPath,
    conversationBridgePath,
    teamGuideMcpStdioPath,
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`AionUi overlay target was not found: ${requiredPath}`);
    }
  }

  const overlayRoot = resolve(repoRoot, "integrations/aionui/overlay");
  const relaySeedSource = resolve(overlayRoot, "src/process/utils/relaySeed.ts");
  const relaySeedTarget = resolve(targetRoot, "src/process/utils/relaySeed.ts");
  const relayGatewaySource = resolve(overlayRoot, "src/process/utils/relayGateway.ts");
  const relayGatewayTarget = resolve(targetRoot, "src/process/utils/relayGateway.ts");
  const relayDocumentSearchContractSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchContract.ts",
  );
  const relayDocumentSearchContractTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchContract.ts",
  );
  const relayDocumentSearchExecutorSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchExecutor.ts",
  );
  const relayDocumentSearchExecutorTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchExecutor.ts",
  );
  const relayDocumentSearchQueryPlanSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchQueryPlan.ts",
  );
  const relayDocumentSearchQueryPlanTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchQueryPlan.ts",
  );
  const relayDocumentSearchIndexReportSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchIndexReport.ts",
  );
  const relayDocumentSearchIndexReportTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchIndexReport.ts",
  );
  const relayDocumentSearchResultGroupingSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchResultGrouping.ts",
  );
  const relayDocumentSearchResultGroupingTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchResultGrouping.ts",
  );
  const relayDocumentSearchProductResultSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchProductResult.ts",
  );
  const relayDocumentSearchProductResultTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchProductResult.ts",
  );
  const relayDocumentSearchFolderRolesSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchFolderRoles.ts",
  );
  const relayDocumentSearchFolderRolesTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchFolderRoles.ts",
  );
  const relayDocumentSearchUserMemorySource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchUserMemory.ts",
  );
  const relayDocumentSearchUserMemoryTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchUserMemory.ts",
  );
  const relayDocumentSearchCacheActionsSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchCacheActions.ts",
  );
  const relayDocumentSearchCacheActionsTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchCacheActions.ts",
  );
  const relayDocumentSearchSyncJournalSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchSyncJournal.ts",
  );
  const relayDocumentSearchSyncJournalTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchSyncJournal.ts",
  );
  const relayDocumentSearchSchedulerReportSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchSchedulerReport.ts",
  );
  const relayDocumentSearchSchedulerReportTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchSchedulerReport.ts",
  );
  const relayDocumentSearchIndexMaintenanceSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchIndexMaintenance.ts",
  );
  const relayDocumentSearchIndexMaintenanceTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchIndexMaintenance.ts",
  );
  const relayDocumentSearchQualityGatesSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchQualityGates.ts",
  );
  const relayDocumentSearchQualityGatesTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchQualityGates.ts",
  );
  const relayDocumentSearchQueryTraceSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchQueryTrace.ts",
  );
  const relayDocumentSearchQueryTraceTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchQueryTrace.ts",
  );
  const relayDocumentSearchEvidenceRedactionSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchEvidenceRedaction.ts",
  );
  const relayDocumentSearchEvidenceRedactionTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchEvidenceRedaction.ts",
  );
  const relayDocumentSearchEvidencePackSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchEvidencePack.ts",
  );
  const relayDocumentSearchEvidencePackTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchEvidencePack.ts",
  );
  const relayDocumentSearchLocalDraftSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchLocalDraft.ts",
  );
  const relayDocumentSearchLocalDraftTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchLocalDraft.ts",
  );
  const relayDocumentSearchPolishRequestSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchPolishRequest.ts",
  );
  const relayDocumentSearchPolishRequestTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchPolishRequest.ts",
  );
  const relayDocumentSearchPolishProviderSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchPolishProvider.ts",
  );
  const relayDocumentSearchPolishProviderTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchPolishProvider.ts",
  );
  const relayDocumentSearchPolishValidationSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchPolishValidation.ts",
  );
  const relayDocumentSearchPolishValidationTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchPolishValidation.ts",
  );
  const relayDocumentSearchAnswerSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchAnswer.ts",
  );
  const relayDocumentSearchAnswerTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchAnswer.ts",
  );
  const relayDocumentSearchCopilotStateSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchCopilotState.ts",
  );
  const relayDocumentSearchCopilotStateTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchCopilotState.ts",
  );
  const relayDocumentSearchFreshnessSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchFreshness.ts",
  );
  const relayDocumentSearchFreshnessTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchFreshness.ts",
  );
  const relayDocumentSearchMetadataCacheSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchMetadataCache.ts",
  );
  const relayDocumentSearchMetadataCacheTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchMetadataCache.ts",
  );
  const relayDocumentSearchFilenameIndexSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchFilenameIndex.ts",
  );
  const relayDocumentSearchFilenameIndexTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchFilenameIndex.ts",
  );
  const relayDocumentSearchIndexCoordinatorSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchIndexCoordinator.ts",
  );
  const relayDocumentSearchIndexCoordinatorTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchIndexCoordinator.ts",
  );
  const relayDocumentSearchIndexDbSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchIndexDb.ts",
  );
  const relayDocumentSearchIndexDbTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchIndexDb.ts",
  );
  const relayParsedDocumentCacheSource = resolve(
    overlayRoot,
    "src/process/utils/relayParsedDocumentCache.ts",
  );
  const relayParsedDocumentCacheTarget = resolve(
    targetRoot,
    "src/process/utils/relayParsedDocumentCache.ts",
  );
  const relayParsedDocumentIrSource = resolve(
    overlayRoot,
    "src/process/utils/relayParsedDocumentIr.ts",
  );
  const relayParsedDocumentIrTarget = resolve(
    targetRoot,
    "src/process/utils/relayParsedDocumentIr.ts",
  );
  const relayDocumentSearchDerivedContentIndexSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
  );
  const relayDocumentSearchDerivedContentIndexTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
  );
  const relayDocumentSearchJobLifecycleSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchJobLifecycle.ts",
  );
  const relayDocumentSearchJobLifecycleTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchJobLifecycle.ts",
  );
  const relayDocumentSearchJobStoreSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchJobStore.ts",
  );
  const relayDocumentSearchJobStoreTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchJobStore.ts",
  );
  const relayDocumentSearchBridgeSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchBridge.ts",
  );
  const relayDocumentSearchBridgeTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchBridge.ts",
  );
  const relayDocumentSearchDisplaySource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchDisplay.ts",
  );
  const relayDocumentSearchDisplayTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchDisplay.ts",
  );
  const relayDocumentSearchSupportExportSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchSupportExport.ts",
  );
  const relayDocumentSearchSupportExportTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchSupportExport.ts",
  );
  const relayDocumentSearchMcpSource = resolve(
    overlayRoot,
    "src/process/utils/relayDocumentSearchMcpStdio.ts",
  );
  const relayDocumentSearchMcpTarget = resolve(
    targetRoot,
    "src/process/utils/relayDocumentSearchMcpStdio.ts",
  );

  mkdirSync(dirname(relaySeedTarget), { recursive: true });
  copyOverlayProcessUtils(overlayRoot, targetRoot);
  copyFileSync(relaySeedSource, relaySeedTarget);
  copyFileSync(relayGatewaySource, relayGatewayTarget);
  copyFileSync(relayDocumentSearchContractSource, relayDocumentSearchContractTarget);
  copyFileSync(relayDocumentSearchExecutorSource, relayDocumentSearchExecutorTarget);
  copyFileSync(relayDocumentSearchQueryPlanSource, relayDocumentSearchQueryPlanTarget);
  copyFileSync(relayDocumentSearchIndexReportSource, relayDocumentSearchIndexReportTarget);
  copyFileSync(relayDocumentSearchResultGroupingSource, relayDocumentSearchResultGroupingTarget);
  copyFileSync(relayDocumentSearchProductResultSource, relayDocumentSearchProductResultTarget);
  copyFileSync(relayDocumentSearchFolderRolesSource, relayDocumentSearchFolderRolesTarget);
  copyFileSync(relayDocumentSearchUserMemorySource, relayDocumentSearchUserMemoryTarget);
  copyFileSync(relayDocumentSearchCacheActionsSource, relayDocumentSearchCacheActionsTarget);
  copyFileSync(relayDocumentSearchSyncJournalSource, relayDocumentSearchSyncJournalTarget);
  copyFileSync(relayDocumentSearchSchedulerReportSource, relayDocumentSearchSchedulerReportTarget);
  copyFileSync(relayDocumentSearchIndexMaintenanceSource, relayDocumentSearchIndexMaintenanceTarget);
  copyFileSync(relayDocumentSearchQualityGatesSource, relayDocumentSearchQualityGatesTarget);
  copyFileSync(relayDocumentSearchQueryTraceSource, relayDocumentSearchQueryTraceTarget);
  copyFileSync(relayDocumentSearchEvidenceRedactionSource, relayDocumentSearchEvidenceRedactionTarget);
  copyFileSync(relayDocumentSearchEvidencePackSource, relayDocumentSearchEvidencePackTarget);
  copyFileSync(relayDocumentSearchLocalDraftSource, relayDocumentSearchLocalDraftTarget);
  copyFileSync(relayDocumentSearchPolishRequestSource, relayDocumentSearchPolishRequestTarget);
  copyFileSync(relayDocumentSearchPolishProviderSource, relayDocumentSearchPolishProviderTarget);
  copyFileSync(relayDocumentSearchPolishValidationSource, relayDocumentSearchPolishValidationTarget);
  copyFileSync(relayDocumentSearchAnswerSource, relayDocumentSearchAnswerTarget);
  copyFileSync(relayDocumentSearchCopilotStateSource, relayDocumentSearchCopilotStateTarget);
  copyFileSync(relayDocumentSearchFreshnessSource, relayDocumentSearchFreshnessTarget);
  copyFileSync(relayDocumentSearchMetadataCacheSource, relayDocumentSearchMetadataCacheTarget);
  copyFileSync(relayDocumentSearchFilenameIndexSource, relayDocumentSearchFilenameIndexTarget);
  copyFileSync(relayDocumentSearchIndexCoordinatorSource, relayDocumentSearchIndexCoordinatorTarget);
  copyFileSync(relayDocumentSearchIndexDbSource, relayDocumentSearchIndexDbTarget);
  copyFileSync(relayParsedDocumentCacheSource, relayParsedDocumentCacheTarget);
  copyFileSync(relayParsedDocumentIrSource, relayParsedDocumentIrTarget);
  copyFileSync(relayDocumentSearchDerivedContentIndexSource, relayDocumentSearchDerivedContentIndexTarget);
  copyFileSync(relayDocumentSearchJobLifecycleSource, relayDocumentSearchJobLifecycleTarget);
  copyFileSync(relayDocumentSearchJobStoreSource, relayDocumentSearchJobStoreTarget);
  copyFileSync(relayDocumentSearchBridgeSource, relayDocumentSearchBridgeTarget);
  copyFileSync(relayDocumentSearchDisplaySource, relayDocumentSearchDisplayTarget);
  copyFileSync(relayDocumentSearchSupportExportSource, relayDocumentSearchSupportExportTarget);
  copyFileSync(relayDocumentSearchMcpSource, relayDocumentSearchMcpTarget);

  const patched = patchInitStorageContent(readFileSync(initStoragePath, "utf8"));
  writeFileSync(indexPath, patchIndexContent(readFileSync(indexPath, "utf8")), "utf8");
  writeFileSync(initStoragePath, patched, "utf8");
  writeFileSync(packageJsonPath, patchPackageJsonContent(readFileSync(packageJsonPath, "utf8")), "utf8");
  writeFileSync(
    electronBuilderPath,
    patchElectronBuilderContent(readFileSync(electronBuilderPath, "utf8")),
    "utf8",
  );
  writeFileSync(deepLinkPath, patchDeepLinkContent(readFileSync(deepLinkPath, "utf8")), "utf8");
  writeFileSync(trayPath, patchTrayContent(readFileSync(trayPath, "utf8")), "utf8");
  writeFileSync(rendererIndexHtmlPath, patchRendererIndexHtmlContent(readFileSync(rendererIndexHtmlPath, "utf8")), "utf8");
  writeFileSync(publicManifestPath, patchPublicManifestContent(readFileSync(publicManifestPath, "utf8")), "utf8");
  writeFileSync(appConfigPath, patchAppConfigContent(readFileSync(appConfigPath, "utf8")), "utf8");
  writeFileSync(platformIndexPath, patchPlatformIndexContent(readFileSync(platformIndexPath, "utf8")), "utf8");
  writeFileSync(
    nodePlatformServicesPath,
    patchNodePlatformServicesContent(readFileSync(nodePlatformServicesPath, "utf8")),
    "utf8",
  );
  writeFileSync(aboutModalPath, patchAboutModalContent(readFileSync(aboutModalPath, "utf8")), "utf8");
  writeFileSync(updateModalPath, patchUpdateModalContent(readFileSync(updateModalPath, "utf8")), "utf8");
  writeFileSync(updateBridgePath, patchUpdateBridgeContent(readFileSync(updateBridgePath, "utf8")), "utf8");
  writeFileSync(agentLogoPath, patchAgentLogoContent(readFileSync(agentLogoPath, "utf8")), "utf8");
  writeFileSync(titlebarPath, patchTitlebarContent(readFileSync(titlebarPath, "utf8")), "utf8");
  writeFileSync(layoutPath, patchLayoutBrandContent(readFileSync(layoutPath, "utf8")), "utf8");
  writeFileSync(guidPagePath, patchGuidPageContent(readFileSync(guidPagePath, "utf8")), "utf8");
  writeFileSync(guidActionRowPath, patchGuidActionRowContent(readFileSync(guidActionRowPath, "utf8")), "utf8");
  writeFileSync(guidSendPath, patchGuidSendContent(readFileSync(guidSendPath, "utf8")), "utf8");
  writeFileSync(sendBoxPath, patchSendBoxContent(readFileSync(sendBoxPath, "utf8")), "utf8");
  writeFileSync(aionrsSendBoxPath, patchAionrsSendBoxContent(readFileSync(aionrsSendBoxPath, "utf8")), "utf8");
  writeFileSync(chatConversationPath, patchChatConversationContent(readFileSync(chatConversationPath, "utf8")), "utf8");
  writeFileSync(rendererThemeBasePath, patchRendererThemeBaseContent(readFileSync(rendererThemeBasePath, "utf8")), "utf8");
  patchRendererLocaleFiles(targetRoot);
  writeFileSync(settingsModalPath, patchSettingsModalContent(readFileSync(settingsModalPath, "utf8")), "utf8");
  writeFileSync(webuiModalPath, patchWebuiModalContent(readFileSync(webuiModalPath, "utf8")), "utf8");
  writeFileSync(buildMcpServersPath, patchAionuiBuildMcpServersContent(readFileSync(buildMcpServersPath, "utf8")), "utf8");
  writeFileSync(
    teamGuideMcpStdioPath,
    patchTeamGuideMcpStdioContent(readFileSync(teamGuideMcpStdioPath, "utf8")),
    "utf8",
  );
  writeFileSync(aionrsAgentPath, patchAionrsAgentContent(readFileSync(aionrsAgentPath, "utf8")), "utf8");
  writeFileSync(aionrsManagerPath, patchAionrsManagerContent(readFileSync(aionrsManagerPath, "utf8")), "utf8");
  writeFileSync(conversationBridgePath, patchConversationBridgeContent(readFileSync(conversationBridgePath, "utf8")), "utf8");
  const aionCliCoreSearchPatch = patchAionCliCoreSearchFiles(targetRoot);
  const brandingAssets = copyBrandingAssets(targetRoot);
  const relayGatewayResourcesDir = copyRelayGatewayResources(targetRoot);
  const relayToolsResourcesDir = copyRelayToolResources(targetRoot, options.relayToolSources);
  const relayDocumentSearchSkillDir = copyRelaySkillResources(targetRoot);

  return {
    brandingAssets,
    deepLinkPath,
    electronBuilderPath,
    rendererIndexHtmlPath,
    publicManifestPath,
    guidPagePath,
    rendererThemeBasePath,
    indexPath,
    initStoragePath,
    packageJsonPath,
    trayPath,
    relayGatewayResourcesDir,
    relayToolsResourcesDir,
    relayDocumentSearchSkillDir,
    relayDocumentSearchContractTarget,
    relayDocumentSearchExecutorTarget,
    relayDocumentSearchQueryPlanTarget,
    relayDocumentSearchIndexReportTarget,
    relayDocumentSearchResultGroupingTarget,
    relayDocumentSearchProductResultTarget,
    relayDocumentSearchFolderRolesTarget,
    relayDocumentSearchUserMemoryTarget,
    relayDocumentSearchCacheActionsTarget,
    relayDocumentSearchSyncJournalTarget,
    relayDocumentSearchSchedulerReportTarget,
    relayDocumentSearchIndexMaintenanceTarget,
    relayDocumentSearchQualityGatesTarget,
    relayDocumentSearchQueryTraceTarget,
    relayDocumentSearchEvidenceRedactionTarget,
    relayDocumentSearchEvidencePackTarget,
    relayDocumentSearchLocalDraftTarget,
    relayDocumentSearchPolishRequestTarget,
    relayDocumentSearchPolishProviderTarget,
    relayDocumentSearchPolishValidationTarget,
    relayDocumentSearchAnswerTarget,
    relayDocumentSearchCopilotStateTarget,
    relayDocumentSearchFreshnessTarget,
    relayDocumentSearchMetadataCacheTarget,
    relayDocumentSearchFilenameIndexTarget,
    relayDocumentSearchIndexCoordinatorTarget,
    relayDocumentSearchIndexDbTarget,
    relayParsedDocumentCacheTarget,
    relayParsedDocumentIrTarget,
    relayDocumentSearchJobLifecycleTarget,
    relayDocumentSearchJobStoreTarget,
    relayDocumentSearchBridgeTarget,
    relayDocumentSearchDisplayTarget,
    relayDocumentSearchSupportExportTarget,
    relayDocumentSearchMcpTarget,
    relayGatewayTarget,
    relaySeedTarget,
    aionCliCoreSearchPatch,
    settingsModalPath,
    webuiModalPath,
    buildMcpServersPath,
    aionrsManagerPath,
  };
}

function usage() {
  return [
    "Usage: node scripts/apply-aionui-overlay.mjs --aionui-dir <path>",
    "",
    "Applies the Relay Agent provider/assistant seed overlay to an AionUi checkout.",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    aionuiDir: process.env.AIONUI_DIR || "",
    help: false,
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--aionui-dir") {
      parsed.aionuiDir = raw[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!options.aionuiDir) {
      throw new Error("--aionui-dir is required");
    }
    const result = applyAionuiOverlay(options.aionuiDir);
    console.log("[relay-aionui-overlay] index:", result.indexPath);
    console.log("[relay-aionui-overlay] initStorage:", result.initStoragePath);
    console.log("[relay-aionui-overlay] relayGateway:", result.relayGatewayTarget);
    console.log("[relay-aionui-overlay] relaySeed:", result.relaySeedTarget);
    console.log("[relay-aionui-overlay] package:", result.packageJsonPath);
    console.log("[relay-aionui-overlay] electronBuilder:", result.electronBuilderPath);
    console.log("[relay-aionui-overlay] deepLink:", result.deepLinkPath);
    console.log("[relay-aionui-overlay] rendererThemeBase:", result.rendererThemeBasePath);
    console.log("[relay-aionui-overlay] settingsModal:", result.settingsModalPath);
    console.log("[relay-aionui-overlay] webuiModal:", result.webuiModalPath);
    console.log("[relay-aionui-overlay] relayGatewayResources:", result.relayGatewayResourcesDir);
    console.log("[relay-aionui-overlay] resources:", result.brandingAssets.resourcesDir);
  } catch (error) {
    console.error("[relay-aionui-overlay] apply failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
