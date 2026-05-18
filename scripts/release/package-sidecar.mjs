#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const rid = readArg("--rid") ?? process.env.RELAY_TARGET_RID ?? platformRid();
const output = resolve(root, "dist", `relay-agent-${rid}`);
const workbenchPackage = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8"));

const toolSources = {
  "win-x64": {
    ripgrep: "tools/ripgrep/win-x64/rg.exe",
    officecli: "tools/officecli/win-x64/officecli.exe",
  },
  "linux-x64": {
    ripgrep: "tools/ripgrep/linux-x64/rg",
  },
};

const sources = toolSources[rid];
if (!sources) throw new Error(`unsupported RID: ${rid}`);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

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
  output,
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
  output,
]);

copyIfExists("LICENSE", join(output, "LICENSE"));
copyIfExists("assets/app-icon/relay-agent.ico", join(output, "relay-assets", "relay-agent.ico"));
copyIfExists("assets/app-icon/relay-agent.svg", join(output, "relay-assets", "relay-agent.svg"));
copyIfExists("assets/app-icon/relay-agent.png", join(output, "relay-assets", "relay-agent.png"));
writeFileSync(
  join(output, "relay-default-config.json"),
  JSON.stringify({
    schemaVersion: "RelayDefaultConfig.v1",
    version: workbenchPackage.version,
    architecture: "browser-workbench-dotnet-sidecar",
    dataDirectory: "user-local",
    localHttp: {
      bind: "127.0.0.1",
      launchTokenRequired: true,
      hostOriginValidation: true,
    },
    tools: {
      ripgrep: "relay-tools/ripgrep",
      officecli: rid === "win-x64" ? "relay-tools/officecli" : "optional",
    },
    assets: {
      appIcon: "relay-assets/relay-agent.ico",
    },
  }, null, 2),
);

copyTool(sources.ripgrep, join(output, "relay-tools/ripgrep", rid.startsWith("win") ? "rg.exe" : "rg"), true);
if (sources.officecli) {
  copyTool(sources.officecli, join(output, "relay-tools/officecli/officecli.exe"), true);
}

writeFileSync(
  join(output, "RELAY_RELEASE_CONTENTS.txt"),
  [
    "Relay Agent sidecar Workbench package",
    `Version: ${workbenchPackage.version}`,
    `RID: ${rid}`,
    "",
    "Included runtime components:",
    "- Relay.Sidecar",
    "- Relay.Launcher",
    "- Workbench static assets",
    "- Relay app icon under relay-assets",
    "- ripgrep under relay-tools/ripgrep",
    rid === "win-x64" ? "- OfficeCLI under relay-tools/officecli" : "- OfficeCLI is optional on this platform",
    "",
    "Excluded runtime families:",
    "- AionUi",
    "- OpenCode/OpenWork",
    "- Tauri desktop shell",
    "- Codex app-server or upstream Codex CLI bundle",
    "",
  ].join("\n"),
);

writeFileSync(
  join(output, "README_PORTABLE.txt"),
  [
    "Relay Agent Portable",
    `Version: ${workbenchPackage.version}`,
    `Package: ${rid}`,
    "",
    "How to start:",
    rid === "win-x64"
      ? "1. Extract the zip to a folder you can write to.\n2. Double-click Start Relay Agent.cmd or Relay.Launcher.exe.\n3. Your browser opens the local Workbench automatically."
      : "1. Extract the tar.gz to a folder you can write to.\n2. Run ./start-relay-agent.sh or ./Relay.Launcher.\n3. Your browser opens the local Workbench automatically.",
    "",
    "No administrator rights are required.",
    "Relay stores runtime data under the current user's local application data directory, not in the selected work folder.",
    "Keep this folder intact; relay-tools and wwwroot are required by the launcher.",
    "For first-time guidance, open Relay Agent.html in this folder.",
    "",
  ].join("\n"),
);

writeFileSync(
  join(output, "Relay Agent.html"),
  portableFrontDoorHtml(rid, workbenchPackage.version),
);

if (rid === "win-x64") {
  const windowsLauncher = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "start \"Relay Agent\" \"%~dp0Relay.Launcher.exe\"",
    "",
  ].join("\r\n");
  writeFileSync(join(output, "Start Relay Agent.cmd"), windowsLauncher);
  writeFileSync(join(output, "Relay Agent を起動.cmd"), windowsLauncher);
} else if (rid === "linux-x64") {
  const launcher = join(output, "start-relay-agent.sh");
  writeFileSync(
    launcher,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "cd \"$(dirname \"$0\")\"",
      "exec ./Relay.Launcher \"$@\"",
      "",
    ].join("\n"),
  );
  chmodSync(launcher, 0o755);
}

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

function copyTool(source, destination, required) {
  const fullSource = resolve(root, source);
  if (!existsSync(fullSource)) {
    if (required) throw new Error(`required tool source was not found: ${source}`);
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(fullSource, destination);
  console.log(`package-sidecar: bundled ${basename(destination)} from ${source}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function relativePath(path) {
  return path.replace(`${root}${process.platform === "win32" ? "\\" : "/"}`, "");
}

function portableFrontDoorHtml(rid, version) {
  const launchName = rid === "win-x64" ? "Relay Agent を起動.cmd" : "start-relay-agent.sh";
  const secondaryLaunch = rid === "win-x64" ? "Start Relay Agent.cmd / Relay.Launcher.exe" : "Relay.Launcher";
  const platformHint = rid === "win-x64"
    ? "Windowsでは、同じフォルダの起動ファイルをダブルクリックします。"
    : "Linuxでは、ターミナルから ./start-relay-agent.sh を実行します。";
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
      width: 40px;
      height: 40px;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--accent);
      background: var(--surface);
      font-weight: 700;
    }
    h1 {
      margin: 0;
      font-size: clamp(30px, 6vw, 48px);
      line-height: 1.05;
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
      <p>インストールせずに使える、M365 Copilot連携のローカル作業ワークベンチです。</p>
    </header>
    <section class="grid" aria-labelledby="start-title">
      <h2 id="start-title">はじめかた</h2>
      <ol class="steps">
        <li><span class="num">1</span><span><span class="file">${escapeHtml(launchName)}</span> を開きます。${escapeHtml(platformHint)}</span></li>
        <li><span class="num">2</span><span>ブラウザでWorkbenchが開いたら、作業フォルダを選択します。</span></li>
        <li><span class="num">3</span><span>チャットに依頼を入力します。PDF確認、ファイル検索、Office編集、コード作成を同じ画面で扱えます。</span></li>
      </ol>
      <p>別の起動方法: ${escapeHtml(secondaryLaunch)}。Relayのデータはユーザーのローカルアプリデータに保存され、選択した共有フォルダにはキャッシュを書き込みません。</p>
    </section>
    <section class="grid" aria-labelledby="pdf-title" style="margin-top: 18px;">
      <h2 id="pdf-title">PDFを確認する</h2>
      <div class="recipes">
        <section class="recipe">
          <strong>誤字・表記ゆれ</strong>
          <p>Workbenchの「PDFを選んで誤字確認」からPDFを選択します。下書きには選択したPDFパスが入ります。</p>
        </section>
        <section class="recipe">
          <strong>2つのPDF比較</strong>
          <p>「2つのPDFを選んで比較」からPDF A / PDF B を順に選択します。</p>
        </section>
      </div>
      <p>PDFはローカルのtext layerを読み取ります。画像だけのPDFやOCRが必要なページは、確認不可として扱われます。</p>
    </section>
    <p style="margin-top: 22px;">Version ${escapeHtml(version)} / ${escapeHtml(rid)}</p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
