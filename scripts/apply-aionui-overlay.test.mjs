import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  isCliEntrypoint,
  patchDeepLinkContent,
  patchElectronBuilderContent,
  patchInitStorageContent,
  patchPackageJsonContent,
  patchSettingsModalContent,
  patchWebuiModalContent,
} from "./apply-aionui-overlay.mjs";

const branding = {
  packageName: "relay-agent-aionui",
  appId: "com.relayagent.app",
  productName: "Relay Agent",
  executableName: "Relay Agent",
  protocol: "relay-agent",
  publishOwner: "minimo162",
  publishRepo: "Relay_Agent",
  supportName: "Relay Agent",
};

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

test("patchElectronBuilderContent rebrands installer metadata, protocol, and update target", () => {
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
  assert.doesNotMatch(patched, /AionUi Protocol|x-scheme-handler\/aionui|owner: iOfficeAI/);
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

test("patchSettingsModalContent hides provider and remote setup tabs behind Relay advanced surfaces", () => {
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
    "  useEffect(() => {",
    "    extensionsIpc",
    "      .getSettingsTabs.invoke()",
    "      .then(setExtensionTabs);",
    "  }, [visible]);",
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
    "    return builtinItems;",
    "  }, [t, isDesktop, extensionTabs, resolveExtTabName]);",
    "  const renderBuiltinContent = () => {",
    "    switch (activeTab) {",
    "      case 'tools':",
    "        return <ToolsModalContent />;",
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
  assert.match(once, /if \(relayAdvancedSurfacesEnabled\) \{/);
  assert.match(once, /if \(isDesktop && relayAdvancedSurfacesEnabled\) \{/);
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
  assert.match(relaySeed, /builtin-\$\{preset\.id\}/);
  assert.match(relaySeed, /await configFile\.set\('assistants', updated\)/);
});
