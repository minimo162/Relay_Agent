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
    "",
  ].join("\n"),
);

if (rid === "win-x64") {
  writeFileSync(
    join(output, "Start Relay Agent.cmd"),
    [
      "@echo off",
      "setlocal",
      "cd /d \"%~dp0\"",
      "start \"Relay Agent\" \"%~dp0Relay.Launcher.exe\"",
      "",
    ].join("\r\n"),
  );
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
