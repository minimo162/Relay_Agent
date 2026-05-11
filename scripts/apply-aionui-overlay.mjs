#!/usr/bin/env node

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
    "[data-testid='btn-add-preset'] {",
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
    "    return String(pattern || '').replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
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
  const nodeSourcePath =
    sources.nodeSourcePath ??
    resolve(repoRoot, "apps/desktop/src-tauri/binaries/relay-node-x86_64-pc-windows-msvc.exe");
  if (!existsSync(nodeSourcePath)) {
    throw new Error(
      `Bundled Node was not found: ${nodeSourcePath}. Run TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc node apps/desktop/scripts/fetch-bundled-node.mjs before applying the AionUi overlay.`,
    );
  }
  const liteparseSourceDir =
    sources.liteparseSourceDir ?? resolve(repoRoot, "apps/desktop/src-tauri/liteparse-runner");
  if (!existsSync(resolve(liteparseSourceDir, "parse.mjs")) || !existsSync(resolve(liteparseSourceDir, "node_modules"))) {
    throw new Error(
      `LiteParse runner was not prepared: ${liteparseSourceDir}. Run npm ci --omit=dev --prefix apps/desktop/src-tauri/liteparse-runner before applying the AionUi overlay.`,
    );
  }

  const ripgrepDir = resolve(targetRoot, "resources/relay-tools/ripgrep");
  const nodeDir = resolve(targetRoot, "resources/relay-tools/node");
  const liteparseDir = resolve(targetRoot, "resources/relay-tools/liteparse-runner");
  mkdirSync(ripgrepDir, { recursive: true });
  mkdirSync(nodeDir, { recursive: true });
  copyFileSync(ripgrepSourcePath, resolve(ripgrepDir, "rg.exe"));
  copyFileSync(nodeSourcePath, resolve(nodeDir, "relay-node.exe"));
  cpSync(liteparseSourceDir, liteparseDir, { recursive: true });
  return resolve(targetRoot, "resources/relay-tools");
}

export function relayDocumentSearchSkillContent() {
  return ensureTrailingNewline(
    [
      "---",
      "name: relay-document-search",
      'description: "Use this skill for beginner-facing document search, local file discovery, Office/PDF reading, and evidence-backed summaries in Relay Agent."',
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

export function patchAionrsManagerContent(input) {
  let output = input;
  if (!output.includes("import path from 'path';")) {
    const anchor = "import { ipcBridge } from '@/common';";
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager import anchor");
    }
    output = output.replace(anchor, `${anchor}\nimport path from 'path';`);
  }

  const injection = [
    "      const relayDocumentSearch = this.buildRelayDocumentSearchMcpStdioConfig(mergedData.workspace);",
    "      if (relayDocumentSearch) stdioMcpServers.push(relayDocumentSearch);",
  ].join("\n");
  if (!output.includes(injection)) {
    const anchor = [
      "      const teamGuide = await this.buildTeamGuideMcpStdioConfig();",
      "      if (teamGuide) stdioMcpServers.push(teamGuide);",
      "    }",
    ].join("\n");
    if (!output.includes(anchor)) {
      throw new Error("Could not find AionrsManager team-guide MCP injection anchor");
    }
    output = output.replace(anchor, `${anchor}\n${injection}`);
  }

  if (!output.includes("private buildRelayDocumentSearchMcpStdioConfig")) {
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
        "  private buildRelayDocumentSearchMcpStdioConfig(workspace?: string): StdioMcpOption | undefined {",
        "    const scriptPath = path.join(__dirname, 'relay-document-search-mcp-stdio.js');",
        "    return {",
        "      name: 'relay-document-search',",
        "      command: 'node',",
        "      args: [scriptPath],",
        "      env: [",
        "        { name: 'RELAY_DOCUMENT_SEARCH_WORKSPACE', value: workspace || '' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_CONVERSATION_ID', value: this.conversation_id },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'metadata-cache') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'filename-index') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'user-memory') },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL', value: '1' },",
        "        { name: 'RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR', value: path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || process.cwd(), 'Relay Agent', 'document-search', 'sync-journal') },",
        "      ],",
        "    };",
        "  }",
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
  const rendererThemeBasePath = findRendererThemeBasePath(targetRoot);
  const settingsModalPath = resolve(targetRoot, "src/renderer/components/settings/SettingsModal/index.tsx");
  const webuiModalPath = resolve(
    targetRoot,
    "src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx",
  );
  const buildMcpServersPath = resolve(targetRoot, "scripts/build-mcp-servers.js");
  const aionrsManagerPath = resolve(targetRoot, "src/process/task/AionrsManager.ts");
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
    rendererThemeBasePath,
    settingsModalPath,
    webuiModalPath,
    buildMcpServersPath,
    aionrsManagerPath,
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
  writeFileSync(rendererThemeBasePath, patchRendererThemeBaseContent(readFileSync(rendererThemeBasePath, "utf8")), "utf8");
  patchRendererLocaleFiles(targetRoot);
  writeFileSync(settingsModalPath, patchSettingsModalContent(readFileSync(settingsModalPath, "utf8")), "utf8");
  writeFileSync(webuiModalPath, patchWebuiModalContent(readFileSync(webuiModalPath, "utf8")), "utf8");
  writeFileSync(buildMcpServersPath, patchAionuiBuildMcpServersContent(readFileSync(buildMcpServersPath, "utf8")), "utf8");
  writeFileSync(aionrsManagerPath, patchAionrsManagerContent(readFileSync(aionrsManagerPath, "utf8")), "utf8");
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
