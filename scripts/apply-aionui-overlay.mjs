#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  packageJson.description = "Relay Agent desktop shell powered by AionUi and Microsoft 365 Copilot.";
  packageJson.author = {
    name: branding.supportName,
  };
  packageJson.productName = branding.productName;
  return ensureTrailingNewline(JSON.stringify(packageJson, null, 2));
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

  copyFileSync(icoIcon, resolve(resourcesDir, "app.ico"));
  copyFileSync(icnsIcon, resolve(resourcesDir, "app.icns"));
  copyFileSync(pngIcon, resolve(resourcesDir, "app.png"));
  copyFileSync(pngIcon, resolve(resourcesDir, "icon.png"));
  copyFileSync(pngIcon, resolve(rendererBrandDir, "app.png"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-180.png"));
  copyFileSync(png128Icon, resolve(publicPwaDir, "icon-192.png"));
  copyFileSync(pngIcon, resolve(publicPwaDir, "icon-512.png"));

  return {
    resourcesDir,
    rendererBrandDir,
    publicPwaDir,
  };
}

export function applyAionuiOverlay(aionuiDir) {
  const targetRoot = resolve(aionuiDir);
  const initStoragePath = resolve(targetRoot, "src/process/utils/initStorage.ts");
  if (!existsSync(initStoragePath)) {
    throw new Error(`AionUi initStorage.ts was not found: ${initStoragePath}`);
  }
  const packageJsonPath = resolve(targetRoot, "package.json");
  const electronBuilderPath = resolve(targetRoot, "electron-builder.yml");
  const deepLinkPath = resolve(targetRoot, "src/process/utils/deepLink.ts");
  const settingsModalPath = resolve(targetRoot, "src/renderer/components/settings/SettingsModal/index.tsx");
  const webuiModalPath = resolve(
    targetRoot,
    "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx",
  );
  for (const requiredPath of [packageJsonPath, electronBuilderPath, deepLinkPath, settingsModalPath, webuiModalPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`AionUi overlay target was not found: ${requiredPath}`);
    }
  }

  const overlayRoot = resolve(repoRoot, "integrations/aionui/overlay");
  const relaySeedSource = resolve(overlayRoot, "src/process/utils/relaySeed.ts");
  const relaySeedTarget = resolve(targetRoot, "src/process/utils/relaySeed.ts");

  mkdirSync(dirname(relaySeedTarget), { recursive: true });
  copyFileSync(relaySeedSource, relaySeedTarget);

  const patched = patchInitStorageContent(readFileSync(initStoragePath, "utf8"));
  writeFileSync(initStoragePath, patched, "utf8");
  writeFileSync(packageJsonPath, patchPackageJsonContent(readFileSync(packageJsonPath, "utf8")), "utf8");
  writeFileSync(
    electronBuilderPath,
    patchElectronBuilderContent(readFileSync(electronBuilderPath, "utf8")),
    "utf8",
  );
  writeFileSync(deepLinkPath, patchDeepLinkContent(readFileSync(deepLinkPath, "utf8")), "utf8");
  writeFileSync(settingsModalPath, patchSettingsModalContent(readFileSync(settingsModalPath, "utf8")), "utf8");
  writeFileSync(webuiModalPath, patchWebuiModalContent(readFileSync(webuiModalPath, "utf8")), "utf8");
  const brandingAssets = copyBrandingAssets(targetRoot);

  return {
    brandingAssets,
    deepLinkPath,
    electronBuilderPath,
    initStoragePath,
    packageJsonPath,
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
    console.log("[relay-aionui-overlay] initStorage:", result.initStoragePath);
    console.log("[relay-aionui-overlay] relaySeed:", result.relaySeedTarget);
    console.log("[relay-aionui-overlay] package:", result.packageJsonPath);
    console.log("[relay-aionui-overlay] electronBuilder:", result.electronBuilderPath);
    console.log("[relay-aionui-overlay] deepLink:", result.deepLinkPath);
    console.log("[relay-aionui-overlay] settingsModal:", result.settingsModalPath);
    console.log("[relay-aionui-overlay] webuiModal:", result.webuiModalPath);
    console.log("[relay-aionui-overlay] resources:", result.brandingAssets.resourcesDir);
  } catch (error) {
    console.error("[relay-aionui-overlay] apply failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
