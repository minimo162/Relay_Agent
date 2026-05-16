#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(import.meta.dirname, "../..");
const rid = readArg("--rid") ?? process.env.RELAY_TARGET_RID ?? platformRid();

const ripgrepVersion = "15.1.0";
const ripgrepArtifacts = {
  "win-x64": {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${ripgrepVersion}/ripgrep-${ripgrepVersion}-x86_64-pc-windows-msvc.zip`,
    base: `ripgrep-${ripgrepVersion}-x86_64-pc-windows-msvc`,
    entrypoint: "rg.exe",
    output: "tools/ripgrep/win-x64/rg.exe",
    archive: "zip",
  },
  "linux-x64": {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${ripgrepVersion}/ripgrep-${ripgrepVersion}-x86_64-unknown-linux-musl.tar.gz`,
    base: `ripgrep-${ripgrepVersion}-x86_64-unknown-linux-musl`,
    entrypoint: "rg",
    output: "tools/ripgrep/linux-x64/rg",
    archive: "tar",
  },
};

const officeCli = {
  version: "1.0.92",
  url: "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.92/officecli-win-x64.exe",
  sha256: "ce5e4926dcfc766e467e92b207786822150a28930700f98334e10fe16ddc054a",
  size: 30_777_980,
  output: "tools/officecli/win-x64/officecli.exe",
};

await fetchRipgrep(rid);
if (rid === "win-x64") await fetchOfficeCli();

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function platformRid() {
  if (process.platform === "win32") return "win-x64";
  if (process.platform === "linux") return "linux-x64";
  throw new Error(`unsupported platform for Relay tool fetch: ${process.platform}`);
}

async function fetchRipgrep(targetRid) {
  const artifact = ripgrepArtifacts[targetRid];
  if (!artifact) throw new Error(`unsupported ripgrep RID: ${targetRid}`);
  const output = resolve(root, artifact.output);
  if (existsSync(output)) {
    console.log(`fetch-relay-tools: ripgrep exists: ${relativePath(output)}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "relay-rg-"));
  try {
    const archive = join(work, artifact.archive === "zip" ? "ripgrep.zip" : "ripgrep.tar.gz");
    await download(artifact.url, archive);
    const extractDir = join(work, "extract");
    mkdirSync(extractDir, { recursive: true });
    extractArchive(archive, artifact.archive, extractDir);
    const source = join(extractDir, artifact.base, artifact.entrypoint);
    if (!existsSync(source)) throw new Error(`ripgrep binary was not found in downloaded archive: ${source}`);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(source, output);
    if (artifact.entrypoint === "rg") chmodSync(output, 0o755);
    console.log(`fetch-relay-tools: wrote ${relativePath(output)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function fetchOfficeCli() {
  const output = resolve(root, officeCli.output);
  if (existsSync(output)) {
    verifyOfficeCli(output);
    console.log(`fetch-relay-tools: OfficeCLI exists, verified: ${relativePath(output)}`);
    return;
  }
  mkdirSync(dirname(output), { recursive: true });
  const temp = `${output}.download`;
  rmSync(temp, { force: true });
  await download(officeCli.url, temp);
  verifyOfficeCli(temp);
  copyFileSync(temp, output);
  rmSync(temp, { force: true });
  console.log(`fetch-relay-tools: wrote ${relativePath(output)}`);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { mode: 0o755 }));
}

function extractArchive(archive, kind, destination) {
  if (kind === "tar") {
    run("tar", ["-xf", archive, "-C", destination]);
    return;
  }
  if (process.platform === "win32") {
    const shell = hasCommand("pwsh") ? "pwsh" : "powershell";
    run(shell, [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${JSON.stringify(archive)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ]);
    return;
  }
  if (hasCommand("unzip")) {
    run("unzip", ["-q", archive, "-d", destination]);
    return;
  }
  run("tar", ["-xf", archive, "-C", destination]);
}

function verifyOfficeCli(path) {
  const stat = statSync(path);
  if (stat.size !== officeCli.size) {
    throw new Error(`OfficeCLI size mismatch: expected ${officeCli.size}, actual ${stat.size}`);
  }
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== officeCli.sha256) {
    throw new Error(`OfficeCLI sha256 mismatch: expected ${officeCli.sha256}, actual ${actual}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function hasCommand(command) {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function relativePath(path) {
  return path.replace(`${root}${process.platform === "win32" ? "\\" : "/"}`, "");
}
