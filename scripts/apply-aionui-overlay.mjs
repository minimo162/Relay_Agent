#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const manifestPath = resolve(repoRoot, "apps/desktop/src-tauri/bootstrap/aionui-relay.json");
const desktopIconRoot = resolve(repoRoot, "apps/desktop/src-tauri/icons");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function relayBranding() {
  return readJson(manifestPath).branding;
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
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
  return output;
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
      "  return tab === 'gemini' || tab === 'model' || tab === 'agent' || tab === 'webui';",
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
      "      setActiveTab('tools');",
      "    }",
      "  }, [activeTab, relayAdvancedSurfacesEnabled]);",
      "",
      extensionEffectPrefix,
    ].join("\n"),
  );

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
      "    builtinItems.push({",
      "      key: 'tools',",
      "      label: t('settings.tools'),",
      "      icon: <Toolkit theme='outline' size='20' fill={iconColors.secondary} />,",
      "    });",
      "",
      "    if (isDesktop && relayAdvancedSurfacesEnabled) {",
    ].join("\n"),
  );

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
      "      return <ToolsModalContent />;",
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
  copyFileSync(pngIcon, resolve(resourcesDir, "icon.png"));
  copyFileSync(pngIcon, resolve(rendererBrandDir, "app.png"));
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

export function applyAionuiOverlay(aionuiDir) {
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
  const settingsModalPath = resolve(targetRoot, "src/renderer/components/settings/SettingsModal/index.tsx");
  const webuiModalPath = resolve(
    targetRoot,
    "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx",
  );
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
    settingsModalPath,
    webuiModalPath,
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

  mkdirSync(dirname(relaySeedTarget), { recursive: true });
  copyFileSync(relaySeedSource, relaySeedTarget);
  copyFileSync(relayGatewaySource, relayGatewayTarget);

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
  patchRendererLocaleFiles(targetRoot);
  writeFileSync(settingsModalPath, patchSettingsModalContent(readFileSync(settingsModalPath, "utf8")), "utf8");
  writeFileSync(webuiModalPath, patchWebuiModalContent(readFileSync(webuiModalPath, "utf8")), "utf8");
  const brandingAssets = copyBrandingAssets(targetRoot);
  const relayGatewayResourcesDir = copyRelayGatewayResources(targetRoot);

  return {
    brandingAssets,
    deepLinkPath,
    electronBuilderPath,
    rendererIndexHtmlPath,
    publicManifestPath,
    indexPath,
    initStoragePath,
    packageJsonPath,
    trayPath,
    relayGatewayResourcesDir,
    relayGatewayTarget,
    relaySeedTarget,
    settingsModalPath,
    webuiModalPath,
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
    console.log("[relay-aionui-overlay] settingsModal:", result.settingsModalPath);
    console.log("[relay-aionui-overlay] webuiModal:", result.webuiModalPath);
    console.log("[relay-aionui-overlay] relayGatewayResources:", result.relayGatewayResourcesDir);
    console.log("[relay-aionui-overlay] resources:", result.brandingAssets.resourcesDir);
  } catch (error) {
    console.error("[relay-aionui-overlay] apply failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
