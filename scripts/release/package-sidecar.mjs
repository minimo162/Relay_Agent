#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const rid = readArg("--rid") ?? process.env.RELAY_TARGET_RID ?? platformRid();
const output = resolve(root, "dist", `relay-agent-${rid}`);
const appRoot = join(output, "app");
const coreRoot = join(appRoot, "relay-core");
const launcherPublishRoot = join(appRoot, "_launcher-publish");
const licensesRoot = join(output, "LICENSES");
const workbenchPackage = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8"));

const toolSources = {
  "win-x64": {
    appServer: "tools/codex-app-server/win-x64",
  },
  "linux-x64": {
    appServer: "tools/codex-app-server/linux-x64",
  },
};

const sources = toolSources[rid];
if (!sources) throw new Error(`unsupported RID: ${rid}`);

rmSync(output, { recursive: true, force: true });
mkdirSync(coreRoot, { recursive: true });
mkdirSync(launcherPublishRoot, { recursive: true });
mkdirSync(licensesRoot, { recursive: true });

run("dotnet", [
  "publish",
  "apps/sidecar/Relay.Sidecar.csproj",
  "--configuration",
  "Release",
  "--runtime",
  rid,
  "--self-contained",
  "true",
  "--output",
  coreRoot,
]);

run("dotnet", [
  "publish",
  "apps/launcher/Relay.Launcher.csproj",
  "--configuration",
  "Release",
  "--runtime",
  rid,
  "--self-contained",
  "true",
  "--output",
  launcherPublishRoot,
]);

if (rid === "win-x64") {
  copyFileSync(join(launcherPublishRoot, "Relay.Launcher.exe"), join(output, "Relay Agent.exe"));
} else if (rid === "linux-x64") {
  copyFileSync(join(launcherPublishRoot, "Relay.Launcher"), join(output, "relay-agent"));
  chmodSync(join(output, "relay-agent"), 0o755);
}
rmSync(launcherPublishRoot, { recursive: true, force: true });

copyIfExists("LICENSE", join(licensesRoot, "Relay_Agent_LICENSE.txt"));
copyIfExists("assets/app-icon/relay-agent.ico", join(appRoot, "relay-assets", "relay-agent.ico"));
copyIfExists("assets/app-icon/relay-agent.svg", join(appRoot, "relay-assets", "relay-agent.svg"));
copyIfExists("assets/app-icon/relay-agent.png", join(appRoot, "relay-assets", "relay-agent.png"));

writeFileSync(
  join(appRoot, "relay-default-config.json"),
  JSON.stringify({
    schemaVersion: "RelayDefaultConfig.v1",
    version: workbenchPackage.version,
    architecture: "codex-app-server-bridge-relay-core-sidecar",
    packageLayout: "portable-root-v2",
    dataDirectory: "user-local",
    localHttp: {
      bind: "127.0.0.1",
      launchTokenRequired: true,
      hostOriginValidation: true,
    },
    appServer: {
      command: rid === "win-x64" ? "app/app-server/codex.exe" : "app/app-server/codex",
      args: ["app-server"],
      home: "user-local",
      provider: "http://127.0.0.1:<port>/v1",
    },
    assets: {
      appIcon: "app/relay-assets/relay-agent.ico",
    },
  }, null, 2),
);

copyAppServerBundle(sources.appServer, join(appRoot, "app-server"));

writeFileSync(
  join(appRoot, "RELEASE_CONTENTS.txt"),
  [
    "Relay Agent portable package",
    `Version: ${workbenchPackage.version}`,
    `RID: ${rid}`,
    "",
    "Top-level files are intentionally limited to the launcher, README-FIRST.html, LICENSES/, and app/.",
    "",
    "Included runtime components under app/:",
    "- relay-core/Relay.Sidecar",
    "- relay-core/wwwroot",
    "- relay bridge endpoints for Codex app-server mediation",
    "- relay-assets",
    "- app-server",
    "- Codex app-server native tool runtime owns local file, shell, Office/PDF-adjacent, and coding work",
    "",
    "Excluded active runtime families:",
    "- AionUi",
    "- OpenCode/OpenWork",
    "- Tauri desktop shell",
    "",
  ].join("\n"),
);

writeFileSync(
  join(appRoot, "README_PORTABLE.txt"),
  [
    "Relay Agent Portable",
    `Version: ${workbenchPackage.version}`,
    `Package: ${rid}`,
    "",
    "How to start:",
    rid === "win-x64"
      ? "1. Extract the zip.\n2. Double-click the top-level Relay Agent.exe.\n3. Your browser opens Relay Bridge Workbench automatically."
      : "1. Extract the tar.gz.\n2. Run the top-level ./relay-agent.\n3. Your browser opens Relay Bridge Workbench automatically.",
    "",
    "No administrator rights are required.",
    "Relay stores runtime data under the current user's local application data directory, not in the selected work folder.",
    "Implementation files are under app/. Keep this folder intact.",
    "For first-time guidance, open the top-level README-FIRST.html.",
    "",
  ].join("\n"),
);

writeFileSync(join(output, "README-FIRST.html"), portableFrontDoorHtml(rid, workbenchPackage.version));

mkdirSync(join(appRoot, "starters"), { recursive: true });
writeFileSync(
  join(appRoot, "starters", "relay-html-tool-starter.html"),
  starterHtml(),
);

console.log(`package-sidecar: wrote ${relativePath(output)}`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function platformRid() {
  if (process.platform === "win32") return "win-x64";
  if (process.platform === "linux") return "linux-x64";
  throw new Error(`unsupported platform: ${process.platform}`);
}

function copyIfExists(source, destination) {
  const fullSource = resolve(root, source);
  if (!existsSync(fullSource)) return;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(fullSource, destination);
}

function copyAppServerBundle(source, destination) {
  const fullSource = resolve(root, source);
  if (!existsSync(fullSource)) {
    throw new Error(`required Codex app-server source was not found: ${source}. Run pnpm appserver:fetch:${rid === "win-x64" ? "windows" : "linux"} first.`);
  }
  const executableName = rid.startsWith("win") ? "codex.exe" : "codex";
  if (!existsSync(join(fullSource, executableName))) {
    throw new Error(`Codex app-server executable is missing from ${source}`);
  }
  rmSync(destination, { recursive: true, force: true });
  copyDirectory(fullSource, destination);
  if (!rid.startsWith("win")) {
    chmodSync(join(destination, executableName), 0o755);
  }
  console.log(`package-sidecar: bundled Codex app-server from ${source}`);
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceEntry, destinationEntry);
    } else if (entry.isFile()) {
      copyFileSync(sourceEntry, destinationEntry);
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function relativePath(path) {
  return path.replace(`${root}${process.platform === "win32" ? "\\" : "/"}`, "");
}

function portableFrontDoorHtml(rid, version) {
  const launchName = rid === "win-x64" ? "Relay Agent.exe" : "relay-agent";
  const platformHint = rid === "win-x64"
    ? "Windowsでは、この1つだけをダブルクリックします。"
    : "Linuxでは、ターミナルから ./relay-agent を実行します。";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relay Agent Portable</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #d9e2ec;
      --text: #111827;
      --muted: #667085;
      --accent: #2563eb;
      --soft: #eff6ff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    main {
      width: min(100%, 860px);
      margin: 0 auto;
      padding: 56px 28px;
    }
    header {
      display: grid;
      gap: 10px;
      margin-bottom: 36px;
    }
    .mark {
      display: inline-grid;
      width: 38px;
      height: 38px;
      place-items: center;
      border-radius: 12px;
      background: var(--text);
      color: white;
      font-weight: 800;
    }
    h1 {
      margin: 0;
      font-size: clamp(30px, 5vw, 52px);
      line-height: 1.04;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    section {
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
    }
    .grid {
      display: grid;
      gap: 16px;
    }
    .steps {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .steps li {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .num {
      display: inline-grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 999px;
      background: var(--soft);
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
    }
    .file {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 6px 10px;
      color: var(--text);
      background: var(--surface);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 13px;
    }
    h2 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    .recipes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .recipe {
      box-shadow: none;
      padding: 18px;
    }
    .recipe strong {
      display: block;
      margin-bottom: 6px;
    }
    @media (max-width: 720px) {
      main { padding: 34px 16px; }
      .recipes { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="mark" aria-hidden="true">R</span>
      <h1>Relay Agent Portable</h1>
      <p>インストールせずに使える、M365 Copilot連携のローカルブリッジです。このHTMLは説明書です。起動は同じフォルダの実行ファイルから行います。</p>
    </header>
    <section class="grid" aria-labelledby="start-title">
      <h2 id="start-title">はじめかた</h2>
      <ol class="steps">
        <li><span class="num">1</span><span><span class="file">${escapeHtml(launchName)}</span> を開きます。${escapeHtml(platformHint)}</span></li>
        <li><span class="num">2</span><span>ブラウザでRelay Bridge Workbenchが開き、Readyになっていることを確認します。</span></li>
        <li><span class="num">3</span><span>WorkbenchからCodex app-server bridgeの状態を確認します。通常の作業はこのブリッジ経路で実行します。</span></li>
      </ol>
      <p>通常は ${escapeHtml(launchName)} だけを使います。内部ファイルは <span class="file">app/</span> にまとめています。削除や移動はしないでください。</p>
    </section>
    <section class="grid" aria-labelledby="api-title" style="margin-top: 18px;">
      <h2 id="api-title">ブリッジ経路</h2>
      <div class="recipes">
        <section class="recipe">
          <strong>Workbench bridge</strong>
          <p><code>/bridge/*</code> がブラウザからCodex app serverへ接続する標準経路です。</p>
        </section>
        <section class="recipe">
          <strong>Copilot provider</strong>
          <p><code>/v1/models</code> と <code>/v1/chat/completions</code> はapp server向けの低レベルproviderです。</p>
        </section>
      </div>
      <p>APIには起動時のlaunch tokenが必要です。Relay Bridge Workbenchは起動URLからtokenを受け取り、必要な診断情報を表示します。</p>
      <p>Relayのデータはユーザーのローカルアプリデータに保存され、共有フォルダにはキャッシュを書き込みません。</p>
    </section>
    <p style="margin-top: 22px;">Version ${escapeHtml(version)} / ${escapeHtml(rid)}</p>
  </main>
</body>
</html>
`;
}

function starterHtml() {
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8" />
<title>Relay Bridge Starter</title>
<body>
  <button id="send">Check Relay Bridge</button>
  <pre id="output"></pre>
  <script>
    const relayBase = prompt('Relay Bridge WorkbenchのBase URLを入力してください');
    const relayToken = prompt('Relay launch tokenを入力してください');
    async function checkBridge() {
      const url = new URL('/bridge/health', relayBase);
      url.searchParams.set('token', relayToken);
      const response = await fetch(url, {
        headers: { 'X-Relay-Token': relayToken }
      });
      if (!response.ok) throw new Error(await response.text());
      return JSON.stringify(await response.json(), null, 2);
    }
    document.querySelector('#send').onclick = async () => {
      const output = document.querySelector('#output');
      output.textContent = 'Running...';
      try {
        output.textContent = await checkBridge();
      } catch (error) {
        output.textContent = String(error);
      }
    };
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
