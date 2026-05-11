import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  applyAionuiOverlay,
  isCliEntrypoint,
  patchAionrsManagerContent,
  patchAionCliCoreGlobContent,
  patchAionCliCoreRipGrepContent,
  patchAionCliCoreToolDefinitionsContent,
  patchAionuiBuildMcpServersContent,
  patchAboutModalContent,
  patchAgentLogoContent,
  patchAppConfigContent,
  patchDeepLinkContent,
  patchElectronBuilderContent,
  patchGuidActionRowContent,
  patchIndexContent,
  patchInitStorageContent,
  patchGuidPageContent,
  patchLocaleJsonContent,
  patchLayoutBrandContent,
  patchNodePlatformServicesContent,
  patchPackageJsonContent,
  patchPlatformIndexContent,
  patchPublicManifestContent,
  patchRendererIndexHtmlContent,
  patchRendererThemeBaseContent,
  patchSettingsModalContent,
  patchTitlebarContent,
  patchTrayContent,
  patchUpdateBridgeContent,
  patchUpdateModalContent,
  patchWebuiModalContent,
  relayDocumentSearchSkillContent,
} from "./apply-aionui-overlay.mjs";

const branding = {
  packageName: "relay-agent-aionui",
  appId: "com.relayagent.app",
  productName: "Relay Agent",
  executableName: "Relay Agent",
  windowTitle: "Relay Agent",
  protocol: "relay-agent",
  publishOwner: "minimo162",
  publishRepo: "Relay_Agent",
  browserTitle: "Relay Agent",
  supportName: "Relay Agent",
};

const relayManifest = JSON.parse(readFileSync("apps/desktop/src-tauri/bootstrap/aionui-relay.json", "utf8"));

function writeFixture(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readFixture(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function createRelayToolFixtureSources(root) {
  const liteparseSourceDir = join(root, "liteparse-runner");
  mkdirSync(join(liteparseSourceDir, "node_modules"), { recursive: true });
  writeFileSync(join(root, "rg.exe"), "relay-rg-fixture", "utf8");
  writeFileSync(join(root, "relay-node.exe"), "relay-node-fixture", "utf8");
  writeFileSync(join(liteparseSourceDir, "parse.mjs"), "export const fixture = true;\n", "utf8");
  writeFileSync(join(liteparseSourceDir, "node_modules/.keep"), "", "utf8");
  return {
    ripgrepSourcePath: join(root, "rg.exe"),
    nodeSourcePath: join(root, "relay-node.exe"),
    liteparseSourceDir,
  };
}

function createPinnedAionUiFixture(root) {
  writeFixture(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "AionUi",
        version: relayManifest.upstreams.aionUi.version,
        productName: "AionUi",
        description: "upstream",
        relayFixturePinnedTag: relayManifest.upstreams.aionUi.tag,
        relayFixturePinnedCommit: relayManifest.upstreams.aionUi.commit,
        author: { name: "AionUi", email: "service@aionui.com" },
      },
      null,
      2,
    ),
  );
  writeFixture(
    root,
    "electron-builder.yml",
    [
      "appId: com.aionui.app",
      "productName: AionUi",
      "executableName: AionUi",
      "copyright: Copyright © 2024 AionUi",
      "protocols:",
      "  - name: AionUi Protocol",
      "    schemes:",
      "      - aionui",
      "linux:",
      "  maintainer: aionui",
      "  vendor: aionui",
      "  desktop:",
      "    entry:",
      "      Name: AionUi",
      "      Icon: aionui",
      "      MimeType: x-scheme-handler/aionui;",
      "publish:",
      "  owner: iOfficeAI",
      "  repo: AionUi",
      "extraResources:",
      "  - from: public",
      "    to: .",
    ].join("\n"),
  );
  writeFixture(
    root,
    "src/index.ts",
    [
      "import { app, BrowserWindow, nativeImage, net, powerMonitor, protocol, screen } from 'electron';",
      "import { ProcessConfig } from './process/utils/initStorage';",
      "const isWebUIMode = hasSwitch('webui');",
      "const isResetPasswordMode = hasCommand('--resetpass');",
      "function createWindow() {",
      "  mainWindow = new BrowserWindow({",
      "    width: windowWidth,",
      "    height: windowHeight,",
      "    show: false,",
      "  });",
      "}",
      "async function handleAppReady() {",
      "  try {",
      "    await initializeProcess();",
      "    mark('initializeProcess');",
      "  } catch (error) {",
      "    app.exit(1);",
      "  }",
      "    createWindow({ showOnReady: showMainWindowOnReady });",
      "    appReadyDone = true;",
      "    mark('createWindow');",
      "}",
    ].join("\n"),
  );
  writeFixture(root, "src/process/utils/initStorage.ts", fixture);
  writeFixture(root, "src/process/utils/deepLink.ts", "export const PROTOCOL_SCHEME = 'aionui';\n *   1. aionui://add-provider?baseUrl=xxx&apiKey=xxx\n");
  writeFixture(root, "src/process/utils/tray.ts", "tray.setToolTip('AionUi');\n");
  writeFixture(
    root,
    "src/renderer/index.html",
    [
      '<meta name="application-name" content="AionUi" />',
      '<meta name="apple-mobile-web-app-title" content="AionUi" />',
      '<link rel="icon" type="image/png" href="./pwa/icon-192.png" />',
      "<title>AionUi</title>",
    ].join("\n"),
  );
  writeFixture(root, "public/manifest.webmanifest", JSON.stringify({ name: "AionUi", short_name: "AionUi", description: "AionUi WebUI" }));
  writeFixture(root, "src/common/utils/appConfig.ts", "return appConfig?.name || 'AionUi';\n");
  writeFixture(root, "src/common/platform/index.ts", "return isMultiInstance ? 'AionUi-Dev-2' : 'AionUi-Dev';\n");
  writeFixture(root, "src/common/platform/NodePlatformServices.ts", "return { name: 'aionui', version: '0.0.0' };\n'.aionui-server'\n_pkg.name ?? 'aionui'\n");
  writeFixture(
    root,
    "src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
    [
      "window.dispatchEvent(new CustomEvent('aionui-open-update-modal', { detail: { source: 'about' } }));",
      "url: 'https://github.com/iOfficeAI/AionUi/wiki',",
      "url: 'https://github.com/iOfficeAI/AionUi/releases',",
      "url: 'https://github.com/iOfficeAI/AionUi/issues',",
      "url: 'https://www.aionui.com',",
      "<Typography.Title>",
      "              AionUi",
      "            </Typography.Title>",
    ].join("\n"),
  );
  writeFixture(root, "src/renderer/components/settings/UpdateModal.tsx", "window.addEventListener('aionui-open-update-modal', handleOpenUpdateModal);\nwindow.removeEventListener('aionui-open-update-modal', handleOpenUpdateModal);\n");
  writeFixture(root, "src/process/bridge/updateBridge.ts", "const DEFAULT_REPO = 'iOfficeAI/AionUi';\nconst DEFAULT_USER_AGENT = 'AionUi';\n  return base || `AionUi-update-${Date.now()}`;\n");
  writeFixture(root, "src/renderer/utils/model/agentLogo.ts", "import AionLogo from '@/renderer/assets/logos/brand/aion.svg';\n");
  writeFixture(
    root,
    "src/renderer/components/layout/Titlebar/index.tsx",
    [
      "const AionLogoMark: React.FC = () => (",
      "  <svg className='app-titlebar__brand-logo' viewBox='0 0 80 80' fill='none' aria-hidden='true' focusable='false'>",
      "    <path d='M40 20 Q38 22 25 40 Q23 42 26 42 L30 42 Q32 40 40 30 Q48 40 50 42 L54 42 Q57 42 55 40 Q42 22 40 20' fill='currentColor'></path>",
      "  </svg>",
      ");",
      "",
      "// Claude-desktop-style sidebar toggle icon",
      "const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {",
      "  const appTitle = useMemo(() => 'AionUi', []);",
      "  return <AionLogoMark />;",
      "};",
    ].join("\n"),
  );
  writeFixture(
    root,
    "src/renderer/components/layout/Layout.tsx",
    [
      "import Titlebar from '@/renderer/components/layout/Titlebar';",
      "import { Layout as ArcoLayout } from '@arco-design/web-react';",
      "<svg",
      "                    className={classNames('w-5.5 h-5.5 absolute inset-0 m-auto', {",
      "                      ' scale-140': !collapsed,",
      "                    })}",
      "                    viewBox='0 0 80 80'",
      "                    fill='none'",
      "                  >",
      "                    <path key='logo-path-1' d='M40 20 Q38 22 25 40 Q23 42 26 42 L30 42 Q32 40 40 30 Q48 40 50 42 L54 42 Q57 42 55 40 Q42 22 40 20' fill='white'></path>",
      "                  </svg>",
      "<div className='flex-1 text-20px text-1 collapsed-hidden font-bold'>AionUi</div>",
    ].join("\n"),
  );
  writeFixture(root, "src/renderer/styles/themes/base.css", "/* Base styles - theme-independent */\n\n:root {\n  --app-min-width: 360px;\n}\n");
  writeFixture(
    root,
    "src/renderer/pages/guid/GuidPage.tsx",
    [
      "import AssistantSelectionArea from './components/AssistantSelectionArea';",
      "import SkillsMarketBanner from './components/SkillsMarketBanner';",
      "",
      "const GuidPage = () => {",
      "  return (",
      "    <div>",
      "        <SkillsMarketBanner />",
      "                  <Button",
      "                    size='mini'",
      "                    type='text'",
      "                    icon={<Write theme='outline' size={16} fill='currentColor' />}",
      "                    className={styles.heroTitleEdit}",
      "                    onClick={() => openAssistantDetailsRef.current?.()}",
      "                    aria-label={t('settings.editAssistant', { defaultValue: 'Assistant Details' })}",
      "                  />",
      "                <div className={styles.heroHeaderRight}>",
      "                  <Dropdown",
      "                    trigger='click'",
      "                    position='bl'",
      "                    droplist={<Menu />}",
      "                  >",
      "                    <Button size='mini' type='text' className={styles.heroAgentSwitchButton} />",
      "                  </Dropdown>",
      "                </div>",
      "          ) : agentSelection.availableAgents === undefined ? (",
      "            <AgentPillBarSkeleton />",
      "          ) : agentSelection.availableAgents.length > 0 ? (",
      "            <AgentPillBar",
      "              availableAgents={agentSelection.availableAgents}",
      "              selectedAgentKey={agentSelection.selectedAgentKey}",
      "            />",
      "          ) : null}",
      "        <AssistantSelectionArea />",
      "    </div>",
      "  );",
      "};",
    ].join("\n"),
  );
  writeFixture(
    root,
    "src/renderer/pages/guid/components/GuidActionRow.tsx",
    [
      "const menuContent = (",
      "    <Menu>",
      "      {builtinAutoSkills.length > 0 && (",
      "        <Menu.SubMenu key='skills'>",
      "          {builtinAutoSkills.map((skill) => (",
      "            <Menu.Item key={`skill-${skill.name}`}>{skill.name}</Menu.Item>",
      "          ))}",
      "        </Menu.SubMenu>",
      "      )}",
      "    </Menu>",
      ");",
    ].join("\n"),
  );
  writeFixture(
    root,
    "src/renderer/components/settings/SettingsModal/index.tsx",
    [
      "import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';",
      "const RESIZE_DEBOUNCE_DELAY = 150;",
      "export type SettingTab = BuiltinSettingTab | (string & {});",
      "const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onCancel, defaultTab = 'gemini' }) => {",
      "  const [activeTab, setActiveTab] = useState<SettingTab>(defaultTab);",
      "  const [extensionTabs, setExtensionTabs] = useState<IExtensionSettingsTab[]>([]);",
      "  useEffect(() => {",
      "    handleResize();",
      "  }, [handleResize]);",
      "",
      "  // Fetch extension-contributed settings tabs when modal opens",
      "  useEffect(() => {",
      "    if (!visible) return;",
      "    void extensionsIpc.getSettingsTabs",
      "      .invoke()",
      "      .then((tabs) => {",
      "        setExtensionTabs(tabs ?? []);",
      "      });",
      "  }, [visible]);",
      "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
      "  const isDesktop = isElectronDesktop();",
      "  const menuItems = useMemo((): Array<{ key: SettingTab; label: string; icon: React.ReactNode }> => {",
      "    type MenuItem = { key: string; label: string; icon: React.ReactNode };",
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
      "      builtinItems.push({",
      "        key: 'webui',",
      "        label: t('settings.webui'),",
      "        icon: <Earth theme='outline' size='20' fill={iconColors.secondary} />,",
      "      });",
      "    }",
      "    builtinItems.push(",
      "      {",
      "        key: 'system',",
      "        label: t('settings.system'),",
      "        icon: <Computer theme='outline' size='20' fill={iconColors.secondary} />,",
      "      },",
      "      { key: 'about', label: t('settings.about'), icon: <Info theme='outline' size='20' fill={iconColors.secondary} /> }",
      "    );",
      "    return builtinItems;",
      "  }, [t, isDesktop, extensionTabs, resolveExtTabName]);",
      "  const renderBuiltinContent = () => {",
      "    switch (activeTab) {",
      "      case 'tools':",
      "        return <ToolsModalContent />;",
      "      case 'about':",
      "        return <AboutModalContent />;",
      "    }",
      "  };",
      "};",
    ].join("\n"),
  );
  writeFixture(
    root,
    "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx",
    [
      "const DESKTOP_WEBUI_ALLOW_REMOTE_KEY = 'webui.desktop.allowRemote';",
      "const WebuiModalContent: React.FC = () => {",
      "  const [activeTab, setActiveTab] = useState<'webui' | 'channels'>('webui');",
      "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
      "  const isDesktop = isElectronDesktop();",
      "",
      "  const [status, setStatus] = useState<IWebUIStatus | null>(null);",
      "  const loadStatus = useCallback(async () => {",
      "      const [savedEnabled, savedAllowRemote] = await Promise.all([",
      "        ConfigStorage.get(DESKTOP_WEBUI_ENABLED_KEY).catch(() => false),",
      "        ConfigStorage.get(DESKTOP_WEBUI_ALLOW_REMOTE_KEY).catch(() => false),",
      "      ]);",
      "      setWebuiEnabled(savedEnabled === true);",
      "      setAllowRemotePreference(savedAllowRemote === true);",
      "  }, []);",
      "            {[",
      "              t('settings.webui.enable', { defaultValue: 'Enable WebUI' }),",
      "              t('settings.webui.accessUrl', { defaultValue: 'Access URL' }),",
      "              t('settings.webui.allowRemote', { defaultValue: 'Allow Remote Access' }),",
      "            ].map((stepLabel, idx) => (",
      "              <div key={stepLabel}>{idx}</div>",
      "            ))}",
      "          <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>",
      "            <Earth theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />",
      "            <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.webui.featureRemoteDesc')}</div>",
      "          </div>",
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
      "          {status?.running && status.allowRemote && (",
      "            <div>qr</div>",
      "          )}",
      "        onChange={(key) => setActiveTab((key as 'webui' | 'channels') || 'webui')}",
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
      "      {activeTab === 'webui' ? (",
      "        webuiPanel",
      "      ) : (",
      "        <ChannelModalContentLazy />",
      "      )}",
      "};",
    ].join("\n"),
  );
  writeFixture(root, "scripts/build-mcp-servers.js", "async function main() {\n  await Promise.all([\n    esbuild.build({\n      ...SHARED_OPTIONS,\n      entryPoints: [path.join(ROOT, 'src/process/team/mcp/guide/teamGuideMcpStdio.ts')],\n      outfile: path.join(ROOT, 'out/main/team-guide-mcp-stdio.js'),\n    }),\n  ]);\n}\n");
  writeFixture(root, "src/process/task/AionrsManager.ts", "import { ipcBridge } from '@/common';\nexport class AionrsManager {\n  conversation_id = 'conversation-1';\n  async start() {\n    const mergedData = { workspace: '/workspace' };\n    const stdioMcpServers: StdioMcpOption[] = [];\n    if (mergedData.teamMcpStdioConfig) {\n      stdioMcpServers.push({ ...mergedData.teamMcpStdioConfig, awaitReady: true });\n    } else {\n      const teamGuide = await this.buildTeamGuideMcpStdioConfig();\n      if (teamGuide) stdioMcpServers.push(teamGuide);\n    }\n  }\n  private async buildTeamGuideMcpStdioConfig(): Promise<StdioMcpOption | undefined> {\n    return undefined;\n  }\n\n  async stop() {\n  }\n}\n");
}

const fixture = [
  "import { migrateFromElectronConfig, importConfigFromFile } from './configMigration';",
  "",
  "const initStorage = async () => {",
  "  if (!hasElectronAppPath()) {",
  "    mark('3.1 configMigration');",
  "  }",
  "",
  "  // 4. 初始化 MCP 配置（为所有用户提供默认配置）",
  "",
  "    if (needsPromptsI18nMigration) {",
  "      await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);",
  "    }",
  "    mark('5.2 assistant config + migrations');",
  "};",
].join("\n");

test("isCliEntrypoint recognizes pathToFileURL argv paths", () => {
  const scriptPath = resolve("scripts/apply-aionui-overlay.mjs");
  assert.equal(isCliEntrypoint(pathToFileURL(scriptPath).href, scriptPath), true);
  assert.equal(isCliEntrypoint(pathToFileURL(scriptPath).href, ""), false);
});

test("patchInitStorageContent imports and applies Relay provider and assistant seed once", () => {
  const once = patchInitStorageContent(fixture);
  const twice = patchInitStorageContent(once);

  assert.equal(twice, once);
  assert.match(once, /applyRelayAssistantSeed, applyRelayProviderSeed/);
  assert.match(once, /await applyRelayProviderSeed\(configFile\);/);
  assert.match(once, /mark\('3.2 relaySeed'\);/);
  assert.match(once, /await applyRelayAssistantSeed\(configFile\);/);
});

test("patchPackageJsonContent rebrands the AionUi package metadata", () => {
  const patched = JSON.parse(
    patchPackageJsonContent(
      JSON.stringify({
        name: "AionUi",
        description: "upstream",
        author: { name: "AionUi", email: "service@aionui.com" },
        productName: "AionUi",
      }),
      branding,
    ),
  );

  assert.equal(patched.name, "relay-agent-aionui");
  assert.equal(patched.productName, "Relay Agent");
  assert.equal(patched.author.name, "Relay Agent");
  assert.equal(patched.author.email, undefined);
  assert.match(patched.description, /Microsoft 365 Copilot/);
});

test("patchIndexContent starts the Relay gateway before AionUi storage initialization", () => {
  const fixture = [
    "import { app, BrowserWindow, nativeImage, net, powerMonitor, protocol, screen } from 'electron';",
    "import { ProcessConfig } from './process/utils/initStorage';",
    "const isWebUIMode = hasSwitch('webui');",
    "const isResetPasswordMode = hasCommand('--resetpass');",
    "function createWindow() {",
    "  mainWindow = new BrowserWindow({",
    "    width: windowWidth,",
    "    height: windowHeight,",
    "    show: false,",
    "  });",
    "}",
    "async function handleAppReady() {",
    "  try {",
    "    await initializeProcess();",
    "    mark('initializeProcess');",
    "  } catch (error) {",
    "    app.exit(1);",
    "  }",
    "    createWindow({ showOnReady: showMainWindowOnReady });",
    "    appReadyDone = true;",
    "    mark('createWindow');",
    "}",
  ].join("\n");

  const once = patchIndexContent(fixture);
  const twice = patchIndexContent(once);

  assert.equal(twice, once);
  assert.match(once, /startRelayGatewayBeforeShell/);
  assert.ok(
    once.indexOf("await startRelayGatewayBeforeShell();") < once.indexOf("await initializeProcess();"),
    "gateway should start before initStorage consumes the Relay provider seed",
  );
  assert.match(once, /dialog, nativeImage/);
  assert.match(once, /RelayGatewayStartupResult/);
  assert.match(once, /title: 'Relay Agent'/);
  assert.match(once, /relayGatewayStartup = await startRelayGatewayBeforeShell\(\);/);
  assert.match(once, /if \(!isWebUIMode && !isResetPasswordMode\)/);
  assert.match(once, /mark\('relayGateway'\);/);
  assert.match(once, /relayGatewayStartup\?\.state === 'needs_attention'/);
  assert.match(once, /Relay could not start the local Microsoft 365 Copilot gateway/);
});

test("patchElectronBuilderContent rebrands installer metadata, protocol, update target, and bundled gateway", () => {
  const fixture = [
    "appId: com.aionui.app",
    "productName: AionUi",
    "executableName: AionUi",
    "copyright: Copyright © 2024 AionUi",
    "protocols:",
    "  - name: AionUi Protocol",
    "    schemes:",
    "      - aionui",
    "linux:",
    "  maintainer: aionui",
    "  vendor: aionui",
    "  desktop:",
    "    entry:",
    "      Name: AionUi",
    "      Icon: aionui",
    "      MimeType: x-scheme-handler/aionui;",
    "publish:",
    "  owner: iOfficeAI",
    "  repo: AionUi",
    "extraResources:",
    "  - from: public",
    "    to: .",
  ].join("\n");

  const patched = patchElectronBuilderContent(fixture, branding);

  assert.match(patched, /^appId: com\.relayagent\.app$/m);
  assert.match(patched, /^productName: Relay Agent$/m);
  assert.match(patched, /^executableName: Relay Agent$/m);
  assert.match(patched, /^  - name: Relay Agent Protocol$/m);
  assert.match(patched, /^      - relay-agent$/m);
  assert.match(patched, /^      MimeType: x-scheme-handler\/relay-agent;$/m);
  assert.match(patched, /^  owner: minimo162$/m);
  assert.match(patched, /^  repo: Relay_Agent$/m);
  assert.match(patched, /^  - from: resources\/relay-gateway$/m);
  assert.match(patched, /^    to: relay-gateway$/m);
  assert.match(patched, /^  - from: resources\/relay-tools$/m);
  assert.match(patched, /^    to: relay-tools$/m);
  assert.doesNotMatch(patched, /AionUi Protocol|x-scheme-handler\/aionui|owner: iOfficeAI/);
});

test("AionCLI core search patches prefer ripgrep and cap broad shared-folder results", () => {
  const globFixture = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { glob, escape } from 'glob';",
    "import { DEFAULT_FILE_FILTERING_OPTIONS } from '../config/constants.js';",
    "import { debugLogger } from '../utils/debugLogger.js';",
    "import { resolveToolDeclaration } from './definitions/resolver.js';",
    "class GlobToolInvocation extends BaseToolInvocation {",
    "    config;",
    "    constructor(config, params, messageBus, _toolName, _toolDisplayName) {",
    "        super(params, messageBus, _toolName, _toolDisplayName);",
    "        this.config = config;",
    "    }",
    "    async execute(signal) {",
    "        try {",
    "            let searchDirectories;",
    "            if (this.params.dir_path) {",
    "                searchDirectories = [this.params.dir_path];",
    "            }",
    "            else {",
    "                searchDirectories = workspaceDirectories;",
    "            }",
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
    "            const oneDayInMs = 24 * 60 * 60 * 1000;",
    "            const nowTimestamp = new Date().getTime();",
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
    "        }",
    "        catch (error) {",
    "            debugLogger.warn(`GlobLogic execute Error`, error);",
    "        }",
    "    }",
    "}",
  ].join("\n");

  const patchedGlob = patchAionCliCoreGlobContent(globFixture);
  const patchedGlobTwice = patchAionCliCoreGlobContent(patchedGlob);
  assert.equal(patchedGlobTwice, patchedGlob);
  assert.match(patchedGlob, /Relay Agent shared-folder search override/);
  assert.match(patchedGlob, /ensureRgPath/);
  assert.match(patchedGlob, /execStreaming/);
  assert.match(patchedGlob, /performRelayRipgrepFileListing/);
  assert.match(patchedGlob, /RELAY_SHARED_SEARCH_INTERNAL_FILE_LIMIT/);
  assert.match(patchedGlob, /RELAY_SHARED_SEARCH_MAX_RETURNED_FILES/);
  assert.match(patchedGlob, /RELAY_SHARED_SEARCH_PER_FOLDER_LIMIT/);
  assert.match(patchedGlob, /RELAY_SHARED_SEARCH_PER_BRANCH_LIMIT/);
  assert.match(patchedGlob, /RELAY_SHARED_SEARCH_BRANCH_DEPTH/);
  assert.match(patchedGlob, /showing \$\{sortedAbsolutePaths\.length\} representative result/);
  assert.match(patchedGlob, /per branch group/);
  assert.match(patchedGlob, /fallback to JS glob/);

  const ripGrepFixture = [
    "import { DEFAULT_TOTAL_MAX_MATCHES } from './constants.js';",
    "function getRgCandidateFilenames() {",
    "    return process.platform === 'win32' ? ['rg.exe', 'rg'] : ['rg'];",
    "}",
    "class GrepToolInvocation extends BaseToolInvocation {",
    "    async execute(signal) {",
    "            const totalMaxMatches = this.params.total_max_matches ?? DEFAULT_TOTAL_MAX_MATCHES;",
    "            allMatches = await this.performRipgrepSearch({",
    "                    max_matches_per_file: this.params.max_matches_per_file,",
    "            });",
    "    }",
    "}",
  ].join("\n");
  const patchedRipGrep = patchAionCliCoreRipGrepContent(ripGrepFixture);
  assert.match(patchedRipGrep, /Relay Agent shared-folder grep override/);
  assert.match(patchedRipGrep, /RELAY_SHARED_SEARCH_NAMES_ONLY_MAX_MATCHES', 500/);
  assert.match(patchedRipGrep, /RELAY_SHARED_SEARCH_MAX_MATCHES_PER_FILE', 1/);
  assert.match(patchedRipGrep, /max_matches_per_file: relayMaxMatchesPerFile/);

  const definitions = patchAionCliCoreToolDefinitionsContent(
    [
      "grep_search_ripgrep: {",
      "description: 'Searches for a regular expression pattern within file contents.',",
      "},",
      "glob: {",
      "description: 'Efficiently finds files matching specific glob patterns (e.g., `src/**/*.ts`)',",
      "},",
    ].join("\n"),
  );
  assert.match(definitions, /broad shared-folder or network-drive searches/);
  assert.match(definitions, /names_only=true/);
  assert.match(definitions, /Relay Agent caps broad shared-folder results/);
});

test("patchDeepLinkContent switches the registered deep-link scheme", () => {
  const patched = patchDeepLinkContent(
    [
      "export const PROTOCOL_SCHEME = 'aionui';",
      " *   1. aionui://add-provider?baseUrl=xxx&apiKey=xxx",
    ].join("\n"),
    branding,
  );

  assert.match(patched, /PROTOCOL_SCHEME = 'relay-agent'/);
  assert.match(patched, /relay-agent:\/\/add-provider/);
  assert.doesNotMatch(patched, /aionui:\/\//);
  assert.doesNotMatch(patched, /an relay-agent:\/\//);
});

test("user-facing AionUi shell branding is replaced with Relay Agent", () => {
  assert.match(
    patchTrayContent("tray.setToolTip('AionUi');", branding),
    /tray\.setToolTip\('Relay Agent'\)/,
  );

  const html = patchRendererIndexHtmlContent(
    [
      '<meta name="application-name" content="AionUi" />',
      '<meta name="apple-mobile-web-app-title" content="AionUi" />',
      '<link rel="icon" type="image/png" href="./pwa/icon-192.png" />',
      "<title>AionUi</title>",
    ].join("\n"),
    branding,
  );
  assert.match(html, /content="Relay Agent"/);
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(html, /<title>Relay Agent<\/title>/);

  const manifest = JSON.parse(
    patchPublicManifestContent(
      JSON.stringify({ name: "AionUi", short_name: "AionUi", description: "AionUi WebUI" }),
      branding,
    ),
  );
  assert.equal(manifest.name, "Relay Agent");
  assert.equal(manifest.short_name, "Relay Agent");
  assert.match(manifest.description, /Relay Agent/);

  assert.match(
    patchAppConfigContent("return appConfig?.name || 'AionUi';", branding),
    /'Relay Agent'/,
  );
  assert.match(
    patchPlatformIndexContent("return isMultiInstance ? 'AionUi-Dev-2' : 'AionUi-Dev';", branding),
    /Relay Agent-Dev-2.*Relay Agent-Dev/,
  );
  assert.match(
    patchNodePlatformServicesContent("return { name: 'aionui', version: '0.0.0' };\n'.aionui-server'\n_pkg.name ?? 'aionui'", branding),
    /relay-agent-aionui/,
  );
});

test("renderer base stylesheet uses Japanese UI fonts for Relay Agent", () => {
  const fixture = [
    "/* Base styles - theme-independent */",
    "",
    ":root {",
    "  --app-min-width: 360px;",
    "}",
  ].join("\n");

  const once = patchRendererThemeBaseContent(fixture);
  const twice = patchRendererThemeBaseContent(once);

  assert.equal(twice, once);
  assert.match(once, /Relay Agent Japanese UI font override/);
  assert.match(once, /--relay-font-ja-ui: "Yu Gothic UI", "Meiryo UI", "Yu Gothic", Meiryo/);
  assert.match(once, /"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP"/);
  assert.match(once, /\.login-page,/);
  assert.match(once, /\.arco-modal,/);
  assert.match(once, /\.markdown-shadow-body \{/);
  assert.match(once, /font-family: var\(--relay-font-ja-ui\) !important;/);
  assert.match(once, /pre,\ncode,\nkbd,\nsamp,/);
  assert.match(once, /font-family: var\(--relay-font-mono\) !important;/);
  assert.match(once, /Relay Agent beginner mode: hide AionUi advanced model\/mode controls/);
  assert.match(once, /\.guid-config-btn,/);
  assert.match(once, /\.header-model-btn,/);
  assert.match(once, /\.agent-mode-compact-pill,/);
  assert.match(once, /\[data-testid='btn-add-preset'\] \{/);
  assert.match(once, /display: none !important;/);
});

test("patchGuidPageContent hides confusing AionUi beginner surfaces", () => {
  const fixture = [
    "import AssistantSelectionArea from './components/AssistantSelectionArea';",
    "import SkillsMarketBanner from './components/SkillsMarketBanner';",
    "",
    "const GuidPage = () => {",
    "  return (",
    "    <div>",
    "        <SkillsMarketBanner />",
    "                  <Button",
    "                    size='mini'",
    "                    type='text'",
    "                    icon={<Write theme='outline' size={16} fill='currentColor' />}",
    "                    className={styles.heroTitleEdit}",
    "                    onClick={() => openAssistantDetailsRef.current?.()}",
    "                    aria-label={t('settings.editAssistant', { defaultValue: 'Assistant Details' })}",
    "                  />",
    "                <div className={styles.heroHeaderRight}>",
    "                  <Dropdown",
    "                    trigger='click'",
    "                    position='bl'",
    "                    droplist={<Menu />}",
    "                  >",
    "                    <Button size='mini' type='text' className={styles.heroAgentSwitchButton} />",
    "                  </Dropdown>",
    "                </div>",
    "          ) : agentSelection.availableAgents === undefined ? (",
    "            <AgentPillBarSkeleton />",
    "          ) : agentSelection.availableAgents.length > 0 ? (",
    "            <AgentPillBar",
    "              availableAgents={agentSelection.availableAgents}",
    "              selectedAgentKey={agentSelection.selectedAgentKey}",
    "            />",
    "          ) : null}",
    "        <AssistantSelectionArea />",
    "    </div>",
    "  );",
    "};",
  ].join("\n");

  const once = patchGuidPageContent(fixture);
  const twice = patchGuidPageContent(once);

  assert.equal(twice, once);
  assert.doesNotMatch(once, /import SkillsMarketBanner/);
  assert.doesNotMatch(once, /<SkillsMarketBanner \/>/);
  assert.match(once, /Relay Agent beginner mode: Skills Market hidden/);
  assert.match(once, /Relay Agent beginner mode: assistant edit hidden/);
  assert.match(once, /Relay Agent beginner mode: preset backend switcher hidden/);
  assert.match(once, /Relay Agent beginner mode: detected agent selector hidden/);
  assert.match(once, /\{false \? \(\n\s+<Button/);
  assert.match(once, /\{false \? \(\n\s+<div className=\{styles\.heroHeaderRight\}>/);
  assert.match(once, /\) : false \? \(\n\s+agentSelection\.availableAgents === undefined/);
});

test("patchGuidActionRowContent hides the auto skills menu from beginner plus actions", () => {
  const fixture = [
    "const menuContent = (",
    "    <Menu>",
    "      {builtinAutoSkills.length > 0 && (",
    "        <Menu.SubMenu",
    "          key='skills'",
    "          title={<span>{t('settings.autoInjectedSkills')}</span>}",
    "        >",
    "          {builtinAutoSkills.map((skill) => (",
    "            <Menu.Item key={`skill-${skill.name}`}>{skill.name}</Menu.Item>",
    "          ))}",
    "        </Menu.SubMenu>",
    "      )}",
    "    </Menu>",
    ");",
  ].join("\n");

  const once = patchGuidActionRowContent(fixture);
  const twice = patchGuidActionRowContent(once);

  assert.equal(twice, once);
  assert.match(once, /Relay Agent beginner mode: auto skill menu hidden/);
  assert.match(once, /\{false && builtinAutoSkills\.length > 0 && \(/);
});

test("relayDocumentSearchSkillContent defines one beginner document finding workflow", () => {
  const content = relayDocumentSearchSkillContent();

  assert.match(content, /name: relay-document-search/);
  assert.match(content, /single beginner-facing `資料を探す` workflow/);
  assert.match(content, /relay_document_search/);
  assert.match(content, /Do not manually decompose the first step into raw `glob`, `grep`, and `read`/);
  assert.match(content, /confirmed evidence only|tool results prove/);
});

test("pinned AionUi overlay application smoke preserves release-critical Relay surfaces", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "relay-aionui-fixture-"));
  const toolRoot = mkdtempSync(join(tmpdir(), "relay-aionui-tools-"));

  try {
    createPinnedAionUiFixture(fixtureRoot);
    const toolSources = createRelayToolFixtureSources(toolRoot);
    const result = applyAionuiOverlay(fixtureRoot, { relayToolSources: toolSources });

    const packageJson = JSON.parse(readFixture(fixtureRoot, "package.json"));
    assert.equal(packageJson.name, relayManifest.branding.packageName);
    assert.equal(packageJson.productName, relayManifest.branding.productName);
    assert.equal(packageJson.version, relayManifest.upstreams.aionUi.version);
    assert.equal(packageJson.relayFixturePinnedTag, relayManifest.upstreams.aionUi.tag);
    assert.equal(packageJson.relayFixturePinnedCommit, relayManifest.upstreams.aionUi.commit);

    assert.match(readFixture(fixtureRoot, "electron-builder.yml"), /productName: Relay Agent/);
    assert.match(readFixture(fixtureRoot, "electron-builder.yml"), /from: resources\/relay-tools/);
    assert.match(readFixture(fixtureRoot, "src/index.ts"), /startRelayGatewayBeforeShell/);
    assert.match(readFixture(fixtureRoot, "src/index.ts"), /title: 'Relay Agent'/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/initStorage.ts"), /applyRelayProviderSeed/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/initStorage.ts"), /applyRelayAssistantSeed/);

    assert.equal(
      readFixture(fixtureRoot, "src/process/utils/relaySeed.ts"),
      readFileSync("integrations/aionui/overlay/src/process/utils/relaySeed.ts", "utf8"),
    );
    assert.match(readFixture(fixtureRoot, "src/process/utils/relaySeed.ts"), /relay\.defaultAssistantPresetIds/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/relaySeed.ts"), /relay\.workspaceSearch\.highLevelTool/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/relayGateway.ts"), /RelayDocumentSearchResultFlow\.v1/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/relayDocumentSearchBridge.ts"), /RelayDocumentSearchAionUiResultFlow\.v1/);
    assert.match(readFixture(fixtureRoot, "src/process/utils/relayDocumentSearchDisplay.ts"), /stableSelectionKey/);
    assert.match(readFixture(fixtureRoot, "src/process/resources/skills/relay-document-search/SKILL.md"), /資料を探す/);
    assert.match(readFixture(fixtureRoot, "src/process/resources/skills/relay-document-search/SKILL.md"), /relay_document_search/);

    assert.match(readFixture(fixtureRoot, "src/renderer/pages/guid/GuidPage.tsx"), /Skills Market hidden/);
    assert.match(readFixture(fixtureRoot, "src/renderer/pages/guid/GuidPage.tsx"), /assistant edit hidden/);
    assert.match(readFixture(fixtureRoot, "src/renderer/pages/guid/components/GuidActionRow.tsx"), /false && builtinAutoSkills/);
    assert.match(readFixture(fixtureRoot, "src/renderer/styles/themes/base.css"), /guid-config-btn/);
    assert.match(readFixture(fixtureRoot, "src/renderer/styles/themes/base.css"), /agent-mode-compact-pill/);
    assert.match(readFixture(fixtureRoot, "src/renderer/components/settings/SettingsModal/index.tsx"), /relay\.advancedSurfaces\.enabled/);
    assert.match(readFixture(fixtureRoot, "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx"), /relayAdvancedSurfacesEnabled/);

    assert.match(readFixture(fixtureRoot, "scripts/build-mcp-servers.js"), /relay-document-search-mcp-stdio\.js/);
    assert.match(readFixture(fixtureRoot, "src/process/task/AionrsManager.ts"), /buildRelayDocumentSearchMcpStdioConfig/);
    assert.ok(existsSync(join(fixtureRoot, "resources/relay-gateway/copilot_server.mjs")));
    assert.ok(existsSync(join(fixtureRoot, "resources/relay-tools/ripgrep/rg.exe")));
    assert.ok(existsSync(join(fixtureRoot, "resources/relay-tools/node/relay-node.exe")));
    assert.ok(existsSync(join(fixtureRoot, "resources/relay-tools/liteparse-runner/parse.mjs")));
    assert.equal(result.relayToolsResourcesDir, join(fixtureRoot, "resources/relay-tools"));
    assert.equal(result.relayDocumentSearchSkillDir, join(fixtureRoot, "src/process/resources/skills/relay-document-search"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(toolRoot, { recursive: true, force: true });
  }
});

test("Relay document search contract is copied into the AionUi overlay", () => {
  const overlayScript = readFileSync("scripts/apply-aionui-overlay.mjs", "utf8");
  const contract = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
    "utf8",
  );
  const executor = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchExecutor.ts",
    "utf8",
  );
  const queryPlan = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
    "utf8",
  );
  const indexReport = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexReport.ts",
    "utf8",
  );
  const resultGrouping = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchResultGrouping.ts",
    "utf8",
  );
  const productResult = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchProductResult.ts",
    "utf8",
  );
  const folderRoles = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFolderRoles.ts",
    "utf8",
  );
  const userMemory = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchUserMemory.ts",
    "utf8",
  );
  const cacheActions = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCacheActions.ts",
    "utf8",
  );
  const syncJournal = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSyncJournal.ts",
    "utf8",
  );
  const schedulerReport = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSchedulerReport.ts",
    "utf8",
  );
  const indexMaintenance = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexMaintenance.ts",
    "utf8",
  );
  const qualityGates = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQualityGates.ts",
    "utf8",
  );
  const queryTrace = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryTrace.ts",
    "utf8",
  );
  const evidenceRedaction = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidenceRedaction.ts",
    "utf8",
  );
  const evidencePack = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidencePack.ts",
    "utf8",
  );
  const localDraft = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchLocalDraft.ts",
    "utf8",
  );
  const polishRequest = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishRequest.ts",
    "utf8",
  );
  const polishProvider = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishProvider.ts",
    "utf8",
  );
  const polishValidation = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishValidation.ts",
    "utf8",
  );
  const answer = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchAnswer.ts",
    "utf8",
  );
  const copilotState = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCopilotState.ts",
    "utf8",
  );
  const freshness = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFreshness.ts",
    "utf8",
  );
  const metadataCache = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
    "utf8",
  );
  const filenameIndex = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFilenameIndex.ts",
    "utf8",
  );
  const indexCoordinator = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexCoordinator.ts",
    "utf8",
  );
  const indexDb = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexDb.ts",
    "utf8",
  );
  const parsedDocumentCache = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayParsedDocumentCache.ts",
    "utf8",
  );
  const parsedDocumentIr = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
    "utf8",
  );
  const derivedContentIndex = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
    "utf8",
  );
  const bridge = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchBridge.ts",
    "utf8",
  );
  const jobLifecycle = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobLifecycle.ts",
    "utf8",
  );
  const jobStore = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts",
    "utf8",
  );
  const display = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDisplay.ts",
    "utf8",
  );
  const supportExport = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSupportExport.ts",
    "utf8",
  );
  const mcp = readFileSync(
    "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMcpStdio.ts",
    "utf8",
  );

  assert.match(overlayScript, /relayDocumentSearchContractSource/);
  assert.match(overlayScript, /relayDocumentSearchContractTarget/);
  assert.match(overlayScript, /relayDocumentSearchExecutorSource/);
  assert.match(overlayScript, /relayDocumentSearchExecutorTarget/);
  assert.match(overlayScript, /relayDocumentSearchQueryPlanSource/);
  assert.match(overlayScript, /relayDocumentSearchQueryPlanTarget/);
  assert.match(overlayScript, /relayDocumentSearchIndexReportSource/);
  assert.match(overlayScript, /relayDocumentSearchIndexReportTarget/);
  assert.match(overlayScript, /relayDocumentSearchResultGroupingSource/);
  assert.match(overlayScript, /relayDocumentSearchResultGroupingTarget/);
  assert.match(overlayScript, /relayDocumentSearchProductResultSource/);
  assert.match(overlayScript, /relayDocumentSearchProductResultTarget/);
  assert.match(overlayScript, /relayDocumentSearchFolderRolesSource/);
  assert.match(overlayScript, /relayDocumentSearchFolderRolesTarget/);
  assert.match(overlayScript, /relayDocumentSearchUserMemorySource/);
  assert.match(overlayScript, /relayDocumentSearchUserMemoryTarget/);
  assert.match(overlayScript, /relayDocumentSearchCacheActionsSource/);
  assert.match(overlayScript, /relayDocumentSearchCacheActionsTarget/);
  assert.match(overlayScript, /relayDocumentSearchSyncJournalSource/);
  assert.match(overlayScript, /relayDocumentSearchSyncJournalTarget/);
  assert.match(overlayScript, /relayDocumentSearchSchedulerReportSource/);
  assert.match(overlayScript, /relayDocumentSearchSchedulerReportTarget/);
  assert.match(overlayScript, /relayDocumentSearchIndexMaintenanceSource/);
  assert.match(overlayScript, /relayDocumentSearchIndexMaintenanceTarget/);
  assert.match(overlayScript, /relayDocumentSearchQualityGatesSource/);
  assert.match(overlayScript, /relayDocumentSearchQualityGatesTarget/);
  assert.match(overlayScript, /relayDocumentSearchQueryTraceSource/);
  assert.match(overlayScript, /relayDocumentSearchQueryTraceTarget/);
  assert.match(overlayScript, /relayDocumentSearchEvidenceRedactionSource/);
  assert.match(overlayScript, /relayDocumentSearchEvidenceRedactionTarget/);
  assert.match(overlayScript, /relayDocumentSearchEvidencePackSource/);
  assert.match(overlayScript, /relayDocumentSearchEvidencePackTarget/);
  assert.match(overlayScript, /relayDocumentSearchLocalDraftSource/);
  assert.match(overlayScript, /relayDocumentSearchLocalDraftTarget/);
  assert.match(overlayScript, /relayDocumentSearchPolishRequestSource/);
  assert.match(overlayScript, /relayDocumentSearchPolishRequestTarget/);
  assert.match(overlayScript, /relayDocumentSearchPolishProviderSource/);
  assert.match(overlayScript, /relayDocumentSearchPolishProviderTarget/);
  assert.match(overlayScript, /relayDocumentSearchPolishValidationSource/);
  assert.match(overlayScript, /relayDocumentSearchPolishValidationTarget/);
  assert.match(overlayScript, /relayDocumentSearchAnswerSource/);
  assert.match(overlayScript, /relayDocumentSearchAnswerTarget/);
  assert.match(overlayScript, /relayDocumentSearchCopilotStateSource/);
  assert.match(overlayScript, /relayDocumentSearchCopilotStateTarget/);
  assert.match(overlayScript, /relayDocumentSearchFreshnessSource/);
  assert.match(overlayScript, /relayDocumentSearchFreshnessTarget/);
  assert.match(overlayScript, /relayDocumentSearchMetadataCacheSource/);
  assert.match(overlayScript, /relayDocumentSearchMetadataCacheTarget/);
  assert.match(overlayScript, /relayDocumentSearchFilenameIndexSource/);
  assert.match(overlayScript, /relayDocumentSearchFilenameIndexTarget/);
  assert.match(overlayScript, /relayDocumentSearchIndexCoordinatorSource/);
  assert.match(overlayScript, /relayDocumentSearchIndexCoordinatorTarget/);
  assert.match(overlayScript, /relayDocumentSearchIndexDbSource/);
  assert.match(overlayScript, /relayDocumentSearchIndexDbTarget/);
  assert.match(overlayScript, /relayParsedDocumentCacheSource/);
  assert.match(overlayScript, /relayParsedDocumentCacheTarget/);
  assert.match(overlayScript, /relayParsedDocumentIrSource/);
  assert.match(overlayScript, /relayParsedDocumentIrTarget/);
  assert.match(overlayScript, /relayDocumentSearchDerivedContentIndexSource/);
  assert.match(overlayScript, /relayDocumentSearchDerivedContentIndexTarget/);
  assert.match(overlayScript, /relayDocumentSearchJobLifecycleSource/);
  assert.match(overlayScript, /relayDocumentSearchJobLifecycleTarget/);
  assert.match(overlayScript, /relayDocumentSearchJobStoreSource/);
  assert.match(overlayScript, /relayDocumentSearchJobStoreTarget/);
  assert.match(overlayScript, /relayDocumentSearchBridgeSource/);
  assert.match(overlayScript, /relayDocumentSearchBridgeTarget/);
  assert.match(overlayScript, /relayDocumentSearchDisplaySource/);
  assert.match(overlayScript, /relayDocumentSearchDisplayTarget/);
  assert.match(overlayScript, /relayDocumentSearchSupportExportSource/);
  assert.match(overlayScript, /relayDocumentSearchSupportExportTarget/);
  assert.match(overlayScript, /relayDocumentSearchMcpSource/);
  assert.match(overlayScript, /relayDocumentSearchMcpTarget/);
  assert.match(overlayScript, /RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL/);
  assert.match(overlayScript, /RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR/);
  assert.match(overlayScript, /relay-node-x86_64-pc-windows-msvc\.exe/);
  assert.match(overlayScript, /liteparse-runner/);
  assert.match(contract, /RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT/);
  assert.match(contract, /relayDocumentSearchOpenAiToolSchema/);
  assert.match(contract, /validateRelayDocumentSearchRequest/);
  assert.match(contract, /validateRelayDocumentSearchResult/);
  assert.match(contract, /acceptsRelayDocumentSearchAlias/);
  assert.match(contract, /RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES/);
  assert.match(executor, /executeRelayDocumentSearch/);
  assert.match(executor, /filename_only/);
  assert.match(executor, /content_confirmed/);
  assert.match(executor, /readTextFileAsRelayParsedDocument/);
  assert.match(executor, /readRelayParsedDocumentCache/);
  assert.match(executor, /stageRelayParsedDocumentCache/);
  assert.match(executor, /stageRelayDocumentSearchDerivedContentIndexCache/);
  assert.match(executor, /commitRelayDocumentSearchContentIndexActivePointer/);
  assert.match(executor, /cell_excerpt/);
  assert.match(executor, /page_anchors_available/);
  assert.match(executor, /FileMetadata/);
  assert.match(executor, /noDuplicateDedocScan/);
  assert.match(queryPlan, /RelayDocumentSearchQueryPlan\.v1/);
  assert.match(queryPlan, /buildRelayDocumentSearchQueryPlan/);
  assert.match(queryPlan, /normalizeRelaySearchText/);
  assert.match(queryPlan, /relay-query-normalizer-v1/);
  assert.match(indexReport, /RelayDocumentSearchIndexReport\.v1/);
  assert.match(indexReport, /buildRelayDocumentSearchIndexReport/);
  assert.match(indexReport, /filenameSearchableFiles/);
  assert.match(resultGrouping, /RelayDocumentSearchResultGrouping\.v1/);
  assert.match(resultGrouping, /groupRelayDocumentSearchCandidates/);
  assert.match(resultGrouping, /collapsedCandidateCount/);
  assert.match(contract, /RelayDocumentSearchProductResult\.v1/);
  assert.match(productResult, /RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT/);
  assert.match(productResult, /preview_state/);
  assert.match(productResult, /open_action/);
  assert.match(productResult, /action_models/);
  assert.match(folderRoles, /RelayDocumentSearchFolderRoles\.v1/);
  assert.match(folderRoles, /classifyRelayDocumentSearchFolderRoles/);
  assert.match(folderRoles, /filing/);
  assert.match(folderRoles, /backup/);
  assert.match(userMemory, /RelayDocumentSearchUserMemory\.v1/);
  assert.match(userMemory, /relayDocumentSearchUserMemoryBoostForFile/);
  assert.match(userMemory, /withRelayDocumentSearchRecentSearch/);
  assert.match(cacheActions, /RelayDocumentSearchCacheActions\.v1/);
  assert.match(cacheActions, /clear-derived-caches/);
  assert.match(cacheActions, /metadata_user_memory_and_jobs_preserved/);
  assert.match(syncJournal, /RelayDocumentSearchSyncJournal\.v1/);
  assert.match(syncJournal, /appendRelayDocumentSearchSyncJournalEvents/);
  assert.match(syncJournal, /created/);
  assert.match(syncJournal, /modified/);
  assert.match(syncJournal, /deleted/);
  assert.match(syncJournal, /moved/);
  assert.match(schedulerReport, /RelayDocumentSearchSchedulerReport\.v1/);
  assert.match(schedulerReport, /queueDepth/);
  assert.match(schedulerReport, /throttledRoots/);
  assert.match(schedulerReport, /content_inspection_budget_reached/);
  assert.match(indexMaintenance, /RelayDocumentSearchIndexMaintenance\.v1/);
  assert.match(indexMaintenance, /integrity-check/);
  assert.match(indexMaintenance, /wal-checkpoint/);
  assert.match(indexMaintenance, /rebuild-derived-indexes/);
  assert.match(qualityGates, /RelayDocumentSearchQuality\.v1/);
  assert.match(qualityGates, /canAskCopilotForFinalAnswer/);
  assert.match(qualityGates, /partial_or_incomplete/);
  assert.match(queryTrace, /RelayDocumentSearchQueryTrace\.v1/);
  assert.match(queryTrace, /plannerOwner: 'relay'/);
  assert.match(queryTrace, /quality_gate/);
  assert.match(supportExport, /RelayDocumentSearchSupportExport\.v1/);
  assert.match(supportExport, /metadata_only/);
  assert.match(supportExport, /include_selected_evidence_snippets/);
  assert.match(supportExport, /contentIndexCommitSummary/);
  assert.match(evidenceRedaction, /RelayDocumentSearchEvidenceRedaction\.v1/);
  assert.match(evidenceRedaction, /snippets_allowed/);
  assert.match(evidenceRedaction, /canSendToCopilot/);
  assert.match(metadataCache, /RelayDocumentSearchMetadataCache\.v1/);
  assert.match(metadataCache, /readRelayDocumentSearchMetadataCache/);
  assert.match(metadataCache, /writeRelayDocumentSearchMetadataCache/);
  assert.match(metadataCache, /RelayDocumentSearchMetadataCacheLock\.v1/);
  assert.match(filenameIndex, /RelayDocumentSearchFilenameIndex\.v1/);
  assert.match(filenameIndex, /buildRelayDocumentSearchFilenameIndex/);
  assert.match(filenameIndex, /searchRelayDocumentSearchFilenameIndex/);
  assert.match(filenameIndex, /writeRelayDocumentSearchFilenameIndex/);
  assert.match(indexCoordinator, /RelayDocumentSearchIndexCoordinator\.v1/);
  assert.match(indexCoordinator, /stale_lock_recovered/);
  assert.match(indexCoordinator, /readRelayDocumentSearchIndexHealthEvents/);
  assert.match(indexCoordinator, /RelayDocumentSearchContentIndexActivePointer\.v1/);
  assert.match(indexCoordinator, /content_index_committed/);
  assert.match(indexDb, /RelayDocumentSearchIndexDb\.v1/);
  assert.match(indexDb, /BEGIN IMMEDIATE/);
  assert.match(indexDb, /COMMIT/);
  assert.match(parsedDocumentCache, /RelayParsedDocumentCache\.v1/);
  assert.match(parsedDocumentCache, /RelayParsedDocumentCacheStage\.v1/);
  assert.match(parsedDocumentCache, /stageRelayParsedDocumentCache/);
  assert.match(parsedDocumentCache, /RelayParsedDocumentCachePolicy\.v1/);
  assert.match(parsedDocumentCache, /relayParsedDocumentCachePolicy/);
  assert.match(parsedDocumentCache, /relayParsedDocumentCacheKey/);
  assert.match(parsedDocumentCache, /enforceRelayParsedDocumentCacheQuota/);
  assert.match(parsedDocumentCache, /sourceMetadataVersion/);
  assert.match(parsedDocumentIr, /RelayParsedDocumentIR\.v1/);
  assert.match(parsedDocumentIr, /parseTextToRelayParsedDocument/);
  assert.match(parsedDocumentIr, /readPdfFileAsRelayParsedDocument/);
  assert.match(parsedDocumentIr, /readOfficeOpenXmlFileAsRelayParsedDocument/);
  assert.match(parsedDocumentIr, /relay-pdf-liteparse-reader-v1/);
  assert.match(parsedDocumentIr, /relay-office-openxml-reader-v1/);
  assert.match(parsedDocumentIr, /ReaderOutput/);
  assert.match(parsedDocumentIr, /NormalizedDocument/);
  assert.match(parsedDocumentIr, /DocumentContent|content: \{/);
  assert.match(derivedContentIndex, /RelayDocumentSearchDerivedContentIndex\.v1/);
  assert.match(derivedContentIndex, /RelayDocumentSearchPreviewAnchor\.v1/);
  assert.match(derivedContentIndex, /RelayDocumentSearchDerivedContentIndexCache\.v1/);
  assert.match(derivedContentIndex, /RelayDocumentSearchDerivedContentIndexCacheStage\.v1/);
  assert.match(derivedContentIndex, /writeRelayDocumentSearchDerivedContentIndexCache/);
  assert.match(derivedContentIndex, /stageRelayDocumentSearchDerivedContentIndexCache/);
  assert.match(derivedContentIndex, /buildRelayDocumentSearchDerivedContentIndex/);
  assert.match(derivedContentIndex, /searchRelayDocumentSearchDerivedContentIndex/);
  assert.match(evidencePack, /RelayDocumentSearchEvidencePack\.v1/);
  assert.match(evidencePack, /buildRelayDocumentSearchEvidencePack/);
  assert.match(evidencePack, /copilotMayUseOnlyEvidencePack/);
  assert.match(localDraft, /RelayDocumentSearchLocalDraft\.v1/);
  assert.match(localDraft, /buildRelayDocumentSearchLocalDraft/);
  assert.match(localDraft, /copilotPolishRequiresCitationValidation/);
  assert.match(polishRequest, /RelayDocumentSearchPolishRequest\.v1/);
  assert.match(polishRequest, /buildRelayDocumentSearchPolishRequest/);
  assert.match(polishRequest, /answerPolish/);
  assert.match(polishRequest, /fullPathsIncluded: false/);
  assert.match(polishProvider, /RelayDocumentSearchPolishProvider\.v1/);
  assert.match(polishProvider, /invokeRelayDocumentSearchPolishProvider/);
  assert.match(polishProvider, /RELAY_AIONUI_PROVIDER_SEED_FILE/);
  assert.match(polishProvider, /document_search_polish/);
  assert.match(polishProvider, /local_search_blocked: false/);
  assert.match(polishValidation, /RelayDocumentSearchPolishValidation\.v1/);
  assert.match(polishValidation, /RelayDocumentSearchPolishedAnswer\.v1/);
  assert.match(polishValidation, /RelayDocumentSearchPolishCorrelation/);
  assert.match(polishValidation, /validateRelayDocumentSearchCopilotPolish/);
  assert.match(polishValidation, /prompt_template_ids/);
  assert.match(polishValidation, /repairAtMostOnce/);
  assert.match(answer, /RelayDocumentSearchAnswer\.v1/);
  assert.match(answer, /buildRelayDocumentSearchAnswer/);
  assert.match(answer, /replacementAtMostOnce/);
  assert.match(copilotState, /RelayDocumentSearchCopilotState\.v1/);
  assert.match(copilotState, /buildRelayDocumentSearchCopilotStateReport/);
  assert.match(copilotState, /copilot_sign_in_required/);
  assert.match(copilotState, /local_search_blocked: false/);
  assert.match(freshness, /RelayDocumentSearchFreshness\.v1/);
  assert.match(freshness, /buildRelayDocumentSearchFreshnessReport/);
  assert.match(freshness, /content_stale_file_count/);
  assert.match(freshness, /extractedContentIncluded: false/);
  assert.match(jobLifecycle, /RelayDocumentSearchJobRegistry/);
  assert.match(jobLifecycle, /runRelayDocumentSearchJob/);
  assert.match(jobLifecycle, /duplicate_submit_attached/);
  assert.match(jobLifecycle, /AbortController/);
  assert.match(jobStore, /RelayDocumentSearchJobStore\.v1/);
  assert.match(jobStore, /findActiveRelayDocumentSearchJobByFingerprint/);
  assert.match(jobStore, /abandoned/);
  assert.match(bridge, /handleRelayDocumentSearchToolCall/);
  assert.match(bridge, /relayDocumentSearchBridgeToolDefinition/);
  assert.match(bridge, /runRelayDocumentSearchJob/);
  assert.match(bridge, /RelayDocumentSearchAionUiResultFlow\.v1/);
  assert.match(bridge, /relayDocumentSearchExecutionToAionUiResultFlow/);
  assert.match(bridge, /aionuiContent/);
  assert.match(bridge, /untrusted_tool_alias/);
  assert.match(bridge, /relayDocumentSearchExecutionToOpenAiToolMessage/);
  assert.match(display, /RelayDocumentSearchDisplay\.v1/);
  assert.match(display, /RelayDocumentSearchResultFlow\.v1/);
  assert.match(display, /stableSelectionKey/);
  assert.match(display, /structured-result-cards-primary/);
  assert.match(display, /relayDocumentSearchResultToDisplayModel/);
  assert.match(display, /detailSections/);
  assert.match(display, /サポート用の実行記録/);
  assert.match(display, /ファイル名・パスに一致/);
  assert.match(mcp, /new McpServer/);
  assert.match(mcp, /RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT/);
  assert.match(mcp, /execution\.aionuiContent/);
  assert.match(mcp, /relayDocumentSearchBridgeToolDefinition/);
  assert.match(mcp, /RELAY_DOCUMENT_SEARCH_WORKSPACE/);
  assert.match(mcp, /RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR/);
  assert.match(mcp, /RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR/);
});

test("Relay document search MCP entry is built and injected into aionrs sessions", () => {
  const buildScript = [
    "async function main() {",
    "  await Promise.all([",
    "    esbuild.build({",
    "      ...SHARED_OPTIONS,",
    "      entryPoints: [path.join(ROOT, 'src/process/resources/builtinMcp/imageGenServer.ts')],",
    "      outfile: path.join(ROOT, 'out/main/builtin-mcp-image-gen.js'),",
    "    }),",
    "    esbuild.build({",
    "      ...SHARED_OPTIONS,",
    "      entryPoints: [path.join(ROOT, 'src/process/team/mcp/guide/teamGuideMcpStdio.ts')],",
    "      outfile: path.join(ROOT, 'out/main/team-guide-mcp-stdio.js'),",
    "    }),",
    "  ]);",
    "}",
  ].join("\n");
  const patchedBuild = patchAionuiBuildMcpServersContent(buildScript);
  assert.match(patchedBuild, /relayDocumentSearchMcpStdio\.ts/);
  assert.match(patchedBuild, /relay-document-search-mcp-stdio\.js/);
  assert.equal(patchAionuiBuildMcpServersContent(patchedBuild), patchedBuild);

  const manager = [
    "import { ipcBridge } from '@/common';",
    "export class AionrsManager {",
    "  conversation_id = 'conversation-1';",
    "  async start() {",
    "    const mergedData = { workspace: '/workspace' };",
    "    const stdioMcpServers: StdioMcpOption[] = [];",
    "    if (mergedData.teamMcpStdioConfig) {",
    "      stdioMcpServers.push({ ...mergedData.teamMcpStdioConfig, awaitReady: true });",
    "    } else {",
    "      const teamGuide = await this.buildTeamGuideMcpStdioConfig();",
    "      if (teamGuide) stdioMcpServers.push(teamGuide);",
    "    }",
    "  }",
    "  private async buildTeamGuideMcpStdioConfig(): Promise<StdioMcpOption | undefined> {",
    "    return undefined;",
    "  }",
    "",
    "  async stop() {",
    "  }",
    "}",
  ].join("\n");
  const patchedManager = patchAionrsManagerContent(manager);
  assert.match(patchedManager, /import path from 'path';/);
  assert.match(patchedManager, /buildRelayDocumentSearchMcpStdioConfig\(mergedData\.workspace\)/);
  assert.match(patchedManager, /relay-document-search-mcp-stdio\.js/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_CONVERSATION_ID/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_METADATA_CACHE/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_FILENAME_INDEX/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_USER_MEMORY/);
  assert.match(patchedManager, /RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR/);
  assert.equal(patchAionrsManagerContent(patchedManager), patchedManager);
});

test("About, update, locale, and visible logo references use Relay Agent branding", () => {
  const about = patchAboutModalContent(
    [
      "window.dispatchEvent(new CustomEvent('aionui-open-update-modal', { detail: { source: 'about' } }));",
      "url: 'https://github.com/iOfficeAI/AionUi/wiki',",
      "url: 'https://github.com/iOfficeAI/AionUi/releases',",
      "url: 'https://github.com/iOfficeAI/AionUi/issues',",
      "url: 'https://www.aionui.com',",
      "<Typography.Title>",
      "              AionUi",
      "            </Typography.Title>",
    ].join("\n"),
    branding,
  );
  assert.match(about, /relay-agent-open-update-modal/);
  assert.match(about, /github\.com\/minimo162\/Relay_Agent\/releases/);
  assert.match(about, /Relay Agent/);
  assert.doesNotMatch(about, /iOfficeAI\/AionUi|www\.aionui\.com/);

  const update = patchUpdateModalContent(
    [
      "window.addEventListener('aionui-open-update-modal', handleOpenUpdateModal);",
      "window.removeEventListener('aionui-open-update-modal', handleOpenUpdateModal);",
    ].join("\n"),
  );
  assert.match(update, /relay-agent-open-update-modal/);
  assert.doesNotMatch(update, /aionui-open-update-modal/);

  const bridge = patchUpdateBridgeContent(
    [
      "const DEFAULT_REPO = 'iOfficeAI/AionUi';",
      "const DEFAULT_USER_AGENT = 'AionUi';",
      "  return base || `AionUi-update-${Date.now()}`;",
    ].join("\n"),
    branding,
  );
  assert.match(bridge, /minimo162\/Relay_Agent/);
  assert.match(bridge, /DEFAULT_USER_AGENT = 'Relay Agent'/);
  assert.match(bridge, /relay-agent-aionui-update/);

  const locale = JSON.parse(
    patchLocaleJsonContent(
      JSON.stringify({
        "tray.showWindow": "Show AionUi",
        login: { pageTitle: "AionUi - Sign In", brand: "AionUi" },
      }),
      branding,
    ),
  );
  assert.equal(locale["tray.showWindow"], "Show Relay Agent");
  assert.equal(locale.login.brand, "Relay Agent");

  assert.match(
    patchAgentLogoContent("import AionLogo from '@/renderer/assets/logos/brand/aion.svg';"),
    /brand\/app\.png/,
  );
});

test("titlebar and sidebar brand chrome use Relay Agent branding", () => {
  const titlebar = patchTitlebarContent(
    [
      "const AionLogoMark: React.FC = () => (",
      "  <svg className='app-titlebar__brand-logo' viewBox='0 0 80 80' fill='none' aria-hidden='true' focusable='false'>",
      "    <path d='M40 20 Q38 22 25 40 Q23 42 26 42 L30 42 Q32 40 40 30 Q48 40 50 42 L54 42 Q57 42 55 40 Q42 22 40 20' fill='currentColor'></path>",
      "    <circle cx='40' cy='46' r='3' fill='currentColor'></circle>",
      "    <path d='M18 50 Q40 70 62 50' stroke='currentColor' strokeWidth='3.5' fill='none' strokeLinecap='round'></path>",
      "  </svg>",
      ");",
      "",
      "// Claude-desktop-style sidebar toggle icon",
      "const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {",
      "  const appTitle = useMemo(() => 'AionUi', []);",
      "  return <AionLogoMark />;",
      "};",
    ].join("\n"),
    branding,
  );

  assert.match(titlebar, /const RelayLogoMark/);
  assert.match(titlebar, /const appTitle = useMemo\(\(\) => 'Relay Agent', \[\]\);/);
  assert.match(titlebar, /<RelayLogoMark \/>/);
  assert.doesNotMatch(titlebar, /AionLogoMark|useMemo\(\(\) => 'AionUi'/);

  const layout = patchLayoutBrandContent(
    [
      "import Titlebar from '@/renderer/components/layout/Titlebar';",
      "import { Layout as ArcoLayout } from '@arco-design/web-react';",
      "<svg",
      "                    className={classNames('w-5.5 h-5.5 absolute inset-0 m-auto', {",
      "                      ' scale-140': !collapsed,",
      "                    })}",
      "                    viewBox='0 0 80 80'",
      "                    fill='none'",
      "                  >",
      "                    <path key='logo-path-1' d='M40 20 Q38 22 25 40 Q23 42 26 42 L30 42 Q32 40 40 30 Q48 40 50 42 L54 42 Q57 42 55 40 Q42 22 40 20' fill='white'></path>",
      "                  </svg>",
      "<div className='flex-1 text-20px text-1 collapsed-hidden font-bold'>AionUi</div>",
    ].join("\n"),
    branding,
  );

  assert.match(layout, /import RelayLogo from '@\/renderer\/assets\/logos\/brand\/app\.png';/);
  assert.match(layout, /src=\{RelayLogo\}/);
  assert.match(layout, />Relay Agent<\/div>/);
  assert.doesNotMatch(layout, />AionUi<\/div>|logo-path-1/);
});

test("patchSettingsModalContent hides beginner-confusing settings tabs behind Relay advanced surfaces", () => {
  const fixture = [
    "import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';",
    "const RESIZE_DEBOUNCE_DELAY = 150;",
    "export type SettingTab = BuiltinSettingTab | (string & {});",
    "const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onCancel, defaultTab = 'gemini' }) => {",
    "  const [activeTab, setActiveTab] = useState<SettingTab>(defaultTab);",
    "  const [extensionTabs, setExtensionTabs] = useState<IExtensionSettingsTab[]>([]);",
    "  useEffect(() => {",
    "    handleResize();",
    "  }, [handleResize]);",
    "",
    "  // Fetch extension-contributed settings tabs when modal opens",
    "  useEffect(() => {",
    "    if (!visible) return;",
    "    void extensionsIpc.getSettingsTabs",
    "      .invoke()",
    "      .then((tabs) => {",
    "        setExtensionTabs(tabs ?? []);",
    "      });",
    "  }, [visible]);",
    "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
    "  const isDesktop = isElectronDesktop();",
    "  const menuItems = useMemo((): Array<{ key: SettingTab; label: string; icon: React.ReactNode }> => {",
    "    type MenuItem = { key: string; label: string; icon: React.ReactNode };",
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
    "      builtinItems.push({",
    "        key: 'webui',",
    "        label: t('settings.webui'),",
    "        icon: <Earth theme='outline' size='20' fill={iconColors.secondary} />,",
    "      });",
    "    }",
    "    builtinItems.push(",
    "      {",
    "        key: 'system',",
    "        label: t('settings.system'),",
    "        icon: <Computer theme='outline' size='20' fill={iconColors.secondary} />,",
    "      },",
    "      { key: 'about', label: t('settings.about'), icon: <Info theme='outline' size='20' fill={iconColors.secondary} /> }",
    "    );",
    "    return builtinItems;",
    "  }, [t, isDesktop, extensionTabs, resolveExtTabName]);",
    "  const renderBuiltinContent = () => {",
    "    switch (activeTab) {",
    "      case 'tools':",
    "        return <ToolsModalContent />;",
    "      case 'about':",
    "        return <AboutModalContent />;",
    "    }",
    "  };",
    "};",
  ].join("\n");

  const once = patchSettingsModalContent(fixture);
  const twice = patchSettingsModalContent(once);

  assert.equal(twice, once);
  assert.match(once, /ConfigStorage/);
  assert.match(once, /relay\.advancedSurfaces\.enabled/);
  assert.match(once, /isRelayAdvancedSurfaceTab\(activeTab\)/);
  assert.match(once, /tab === 'tools'/);
  assert.match(once, /tab === 'system'/);
  assert.match(once, /setActiveTab\('about'\)/);
  assert.match(once, /setExtensionTabs\(\[\]\)/);
  assert.match(once, /\[visible, relayAdvancedSurfacesEnabled\]/);
  assert.match(once, /if \(relayAdvancedSurfacesEnabled\) \{/);
  assert.match(once, /if \(isDesktop && relayAdvancedSurfacesEnabled\) \{/);
  assert.match(once, /builtinItems\.push\(\{ key: 'about'/);
  assert.match(once, /return <AboutModalContent \/>;/);
  assert.match(once, /return <ToolsModalContent \/>;/);
});

test("patchWebuiModalContent hides channels and LAN access behind Relay advanced surfaces", () => {
  const fixture = [
    "const DESKTOP_WEBUI_ALLOW_REMOTE_KEY = 'webui.desktop.allowRemote';",
    "const WebuiModalContent: React.FC = () => {",
    "  const [activeTab, setActiveTab] = useState<'webui' | 'channels'>('webui');",
    "  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment",
    "  const isDesktop = isElectronDesktop();",
    "",
    "  const [status, setStatus] = useState<IWebUIStatus | null>(null);",
    "  const loadStatus = useCallback(async () => {",
    "      const [savedEnabled, savedAllowRemote] = await Promise.all([",
    "        ConfigStorage.get(DESKTOP_WEBUI_ENABLED_KEY).catch(() => false),",
    "        ConfigStorage.get(DESKTOP_WEBUI_ALLOW_REMOTE_KEY).catch(() => false),",
    "      ]);",
    "      setWebuiEnabled(savedEnabled === true);",
    "      setAllowRemotePreference(savedAllowRemote === true);",
    "  }, []);",
    "            {[",
    "              t('settings.webui.enable', { defaultValue: 'Enable WebUI' }),",
    "              t('settings.webui.accessUrl', { defaultValue: 'Access URL' }),",
    "              t('settings.webui.allowRemote', { defaultValue: 'Allow Remote Access' }),",
    "            ].map((stepLabel, idx) => (",
    "              <div key={stepLabel}>{idx}</div>",
    "            ))}",
    "          <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>",
    "            <Earth theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />",
    "            <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.webui.featureRemoteDesc')}</div>",
    "          </div>",
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
    "          {status?.running && status.allowRemote && (",
    "            <div>qr</div>",
    "          )}",
    "        onChange={(key) => setActiveTab((key as 'webui' | 'channels') || 'webui')}",
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
    "      {activeTab === 'webui' ? (",
    "        webuiPanel",
    "      ) : (",
    "        <ChannelModalContentLazy />",
    "      )}",
    "};",
  ].join("\n");

  const once = patchWebuiModalContent(fixture);
  const twice = patchWebuiModalContent(once);

  assert.equal(twice, once);
  assert.match(once, /relay\.advancedSurfaces\.enabled/);
  assert.match(once, /setRelayAdvancedSurfacesEnabled/);
  assert.match(once, /relayAdvancedSurfacesEnabled && status\?\.running/);
  assert.match(once, /\{relayAdvancedSurfacesEnabled && \(/);
  assert.match(once, /activeTab === 'webui' \|\| !relayAdvancedSurfacesEnabled/);
});

test("Relay seed overlay persists OfficeCLI assistant defaults into AionUi config", () => {
  const relaySeed = readFileSync("integrations/aionui/overlay/src/process/utils/relaySeed.ts", "utf8");

  assert.match(relaySeed, /relay\.defaultEnabledSkills/);
  assert.match(relaySeed, /relay\.defaultAssistantPresetIds/);
  assert.match(relaySeed, /relay\.advancedSurfaces\.enabled/);
  assert.match(relaySeed, /relay\.providerOnboarding\.enabled/);
  assert.match(relaySeed, /relay\.workspaceSearch\.enabled/);
  assert.match(relaySeed, /relay\.workspaceSearch\.surface/);
  assert.match(relaySeed, /relay\.workspaceSearch\.integrationMode/);
  assert.match(relaySeed, /relay\.workspaceSearch\.rendererPolicy/);
  assert.match(relaySeed, /relay\.workspaceSearch\.defaultSkillEntrypoints/);
  assert.match(relaySeed, /relay\.workspaceSearch\.highLevelTool/);
  assert.match(relaySeed, /relay\.workspaceSearch\.legacyDiagnosticShell/);
  assert.match(relaySeed, /relay\.workspaceSearch\.hiddenBeginnerTerms/);
  assert.match(relaySeed, /relay\.aionuiUx\.integrationMode/);
  assert.match(relaySeed, /relay\.aionuiUx\.primaryEntrypoint/);
  assert.match(relaySeed, /relay\.aionuiUx\.searchEntrypoints/);
  assert.match(relaySeed, /relay\.aionuiUx\.noNewSearchShell/);
  assert.match(relaySeed, /relay\.guidUx\.primarySurface/);
  assert.match(relaySeed, /relay\.guidUx\.beginnerFlowSteps/);
  assert.match(relaySeed, /relay\.guidUx\.requiredControls/);
  assert.match(relaySeed, /relay\.guidUx\.startAction/);
  assert.match(relaySeed, /relay\.guidUx\.noStandaloneSearchStartButton/);
  assert.match(relaySeed, /relay\.guidUx\.examplePrompts/);
  assert.match(relaySeed, /relay\.searchUx\.stateLabels/);
  assert.match(relaySeed, /relay\.searchUx\.noResultsGuidance/);
  assert.match(relaySeed, /relay\.searchUx\.resultCardActions/);
  assert.match(relaySeed, /relay\.searchUx\.resultBatching/);
  assert.match(relaySeed, /relay\.searchUx\.emptyStateActions/);
  assert.match(relaySeed, /relay\.searchUx\.queryPlanning/);
  assert.match(relaySeed, /relay\.beginnerUx\.hiddenSurfaces/);
  assert.match(relaySeed, /relay\.beginnerUx\.visibleSettingsTabs/);
  assert.match(relaySeed, /relay\.beginnerUx\.hideSkillsMarketBanner/);
  assert.match(relaySeed, /relay\.assistantCatalog\.mode/);
  assert.match(relaySeed, /relay\.assistantCatalog\.visiblePresetIds/);
  assert.match(relaySeed, /relay\.assistantCatalog\.hiddenPresetIds/);
  assert.match(relaySeed, /relay\.assistantCatalog\.hideUnlistedBuiltinPresets/);
  assert.match(relaySeed, /relay\.assistantCatalog\.beginnerTaskLabels/);
  assert.match(relaySeed, /tools\.useRipgrep/);
  assert.match(relaySeed, /builtin-\$\{preset\.id\}/);
  assert.match(relaySeed, /preset\.assistant/);
  assert.match(relaySeed, /presetById\.set\(preset\.assistant\.id, preset\)/);
  assert.match(relaySeed, /existingIds\.has\(preset\.assistant\.id\)/);
  assert.match(relaySeed, /preset\.assistant\.enabledSkills/);
  assert.match(relaySeed, /hideUnlistedBuiltinPresets/);
  assert.match(relaySeed, /enabled: false/);
  assert.match(relaySeed, /await configFile\.set\('assistants', updated\)/);
});

test("Relay gateway overlay starts bundled Copilot gateway and writes dynamic provider seed", () => {
  const relayGateway = readFileSync("integrations/aionui/overlay/src/process/utils/relayGateway.ts", "utf8");

  assert.match(relayGateway, /ELECTRON_RUN_AS_NODE/);
  assert.match(relayGateway, /--port',\n\s+'0'/);
  assert.match(relayGateway, /--port-file/);
  assert.match(relayGateway, /RELAY_AIONUI_PROVIDER_SEED_FILE/);
  assert.match(relayGateway, /Relay Agent \/ M365 Copilot/);
  assert.match(relayGateway, /function_calling/);
  assert.match(relayGateway, /tools\.useRipgrep/);
  assert.match(relayGateway, /relay-document-search/);
  assert.match(relayGateway, /relay\.workspaceSearch\.enabled/);
  assert.match(relayGateway, /relay\.workspaceSearch\.defaultSkillEntrypoints/);
  assert.match(relayGateway, /RELAY_DOCUMENT_SEARCH_HIGH_LEVEL_TOOL/);
  assert.match(relayGateway, /RelayDocumentSearchRequest\.v1/);
  assert.match(relayGateway, /relayDocumentSearchExecutor\.ts/);
  assert.match(relayGateway, /relayDocumentSearchQueryPlan\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchQueryPlan\.v1/);
  assert.match(relayGateway, /relay-query-normalizer-v1/);
  assert.match(relayGateway, /relayDocumentSearchIndexReport\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchIndexReport\.v1/);
  assert.match(relayGateway, /relayDocumentSearchResultGrouping\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchResultGrouping\.v1/);
  assert.match(relayGateway, /relayDocumentSearchProductResult\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchProductResult\.v1/);
  assert.match(relayGateway, /relayDocumentSearchFolderRoles\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchFolderRoles\.v1/);
  assert.match(relayGateway, /relayDocumentSearchUserMemory\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchUserMemory\.v1/);
  assert.match(relayGateway, /relayDocumentSearchCacheActions\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchCacheActions\.v1/);
  assert.match(relayGateway, /relayDocumentSearchSyncJournal\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchSyncJournal\.v1/);
  assert.match(relayGateway, /relayDocumentSearchSchedulerReport\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchSchedulerReport\.v1/);
  assert.match(relayGateway, /relayDocumentSearchIndexMaintenance\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchIndexMaintenance\.v1/);
  assert.match(relayGateway, /relayDocumentSearchQualityGates\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchQuality\.v1/);
  assert.match(relayGateway, /relayDocumentSearchQueryTrace\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchQueryTrace\.v1/);
  assert.match(relayGateway, /relayDocumentSearchEvidenceRedaction\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchEvidenceRedaction\.v1/);
  assert.match(relayGateway, /relayDocumentSearchEvidencePack\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchEvidencePack\.v1/);
  assert.match(relayGateway, /relayDocumentSearchLocalDraft\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchLocalDraft\.v1/);
  assert.match(relayGateway, /relayDocumentSearchPolishRequest\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchPolishRequest\.v1/);
  assert.match(relayGateway, /relayDocumentSearchPolishProvider\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchPolishProvider\.v1/);
  assert.match(relayGateway, /relayDocumentSearchPolishValidation\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchPolishValidation\.v1/);
  assert.match(relayGateway, /RelayDocumentSearchPolishedAnswer\.v1/);
  assert.match(relayGateway, /relayDocumentSearchAnswer\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchAnswer\.v1/);
  assert.match(relayGateway, /relayDocumentSearchCopilotState\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchCopilotState\.v1/);
  assert.match(relayGateway, /relayDocumentSearchFreshness\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchFreshness\.v1/);
  assert.match(relayGateway, /relayDocumentSearchMetadataCache\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchMetadataCache\.v1/);
  assert.match(relayGateway, /relayDocumentSearchFilenameIndex\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchFilenameIndex\.v1/);
  assert.match(relayGateway, /relayDocumentSearchIndexCoordinator\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchIndexCoordinator\.v1/);
  assert.match(relayGateway, /RelayDocumentSearchIndexHealthEvent\.v1/);
  assert.match(relayGateway, /relayParsedDocumentCache\.ts/);
  assert.match(relayGateway, /RelayParsedDocumentCache\.v1/);
  assert.match(relayGateway, /relayParsedDocumentIr\.ts/);
  assert.match(relayGateway, /RelayParsedDocumentIR\.v1/);
  assert.match(relayGateway, /relay-ir-v1/);
  assert.match(relayGateway, /relay-office-openxml-reader-v1/);
  assert.match(relayGateway, /relayDocumentSearchJobLifecycle\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchJobLifecycle\.v1/);
  assert.match(relayGateway, /relayDocumentSearchJobStore\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchJobStore\.v1/);
  assert.match(relayGateway, /runRelayDocumentSearchJob/);
  assert.match(relayGateway, /relayDocumentSearchBridge\.ts/);
  assert.match(relayGateway, /relayDocumentSearchDisplay\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchDisplay\.v1/);
  assert.match(relayGateway, /RelayDocumentSearchResultFlow\.v1/);
  assert.match(relayGateway, /RelayDocumentSearchAionUiResultFlow\.v1/);
  assert.match(relayGateway, /stableSelectionKeyField/);
  assert.match(relayGateway, /copilotProseSecondary/);
  assert.match(relayGateway, /relayDocumentSearchDerivedContentIndex\.ts/);
  assert.match(relayGateway, /RelayDocumentSearchDerivedContentIndex\.v1/);
  assert.match(relayGateway, /RelayDocumentSearchPreviewAnchor\.v1/);
  assert.match(relayGateway, /relayDocumentSearchMcpStdio\.ts/);
  assert.match(relayGateway, /relayDocumentSearchOpenAiToolSchema/);
  assert.match(relayGateway, /relay\.aionuiUx\.integrationMode/);
  assert.match(relayGateway, /guid-page-task-launcher/);
  assert.match(relayGateway, /GuidPage/);
  assert.match(relayGateway, /AssistantSelectionArea/);
  assert.match(relayGateway, /relay\.guidUx\.beginnerFlowSteps/);
  assert.match(relayGateway, /relay\.guidUx\.examplePrompts/);
  assert.match(relayGateway, /relay\.searchUx\.stateLabels/);
  assert.match(relayGateway, /relay\.searchUx\.resultCardActions/);
  assert.match(relayGateway, /relay\.beginnerUx\.hiddenSurfaces/);
  assert.match(relayGateway, /skills-market-banner/);
  assert.match(relayGateway, /agent-permission-mode-switcher/);
  assert.match(relayGateway, /assistant-preset-add-button/);
  assert.match(relayGateway, /copy-path/);
  assert.match(relayGateway, /broaden-keywords/);
  assert.match(relayGateway, /結果なし/);
  assert.match(relayGateway, /sendbox-at-file-mentions/);
  assert.match(relayGateway, /PreviewPanel/);
  assert.match(relayGateway, /officecli-xlsx/);
  assert.match(relayGateway, /RELAY_HIDDEN_ASSISTANT_PRESET_IDS/);
  assert.match(relayGateway, /relay\.assistantCatalog\.hideUnlistedBuiltinPresets/);
  assert.match(relayGateway, /資料を探す/);
  assert.match(relayGateway, /officecli-win-x64\.exe/);
  assert.match(relayGateway, /RELAY_OFFICECLI_PATH/);
  assert.match(relayGateway, /RELAY_OFFICECLI_EXPECTED_PATH/);
  assert.match(relayGateway, /prepareOfficeCli/);
  assert.match(relayGateway, /RELAY_BUNDLED_RIPGREP/);
  assert.match(relayGateway, /RELAY_RIPGREP_PATH/);
  assert.match(relayGateway, /prepareRipgrep/);
  assert.match(relayGateway, /RELAY_BUNDLED_NODE/);
  assert.match(relayGateway, /RELAY_LITEPARSE_RUNNER_ROOT/);
  assert.match(relayGateway, /preparePdfReader/);
  assert.match(relayGateway, /RELAY_SHARED_SEARCH_INTERNAL_FILE_LIMIT/);
  assert.match(relayGateway, /RELAY_SHARED_SEARCH_MAX_RETURNED_FILES/);
  assert.match(relayGateway, /RELAY_SHARED_SEARCH_PER_BRANCH_LIMIT/);
  assert.match(relayGateway, /RELAY_SHARED_SEARCH_BRANCH_DEPTH/);
  assert.match(relayGateway, /applySharedSearchDefaults/);
  assert.match(relayGateway, /resources', 'relay-tools', 'ripgrep'/);
  assert.match(relayGateway, /resources', 'relay-tools'/);
  assert.match(relayGateway, /liteparse-runner/);
  assert.match(relayGateway, /\.gemini', 'tmp', 'bin'/);
  assert.match(relayGateway, /prependProcessPath/);
  assert.match(relayGateway, /\/prewarm/);
  assert.match(relayGateway, /RELAY_COPILOT_NO_WINDOW_FOCUS/);
  assert.match(relayGateway, /RELAY_AIONUI_DISABLE_COPILOT_PREWARM/);
});
