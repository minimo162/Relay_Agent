#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = resolve(import.meta.dirname, "../..");
const rid = readArg("--rid") ?? process.env.RELAY_TARGET_RID ?? platformRid();
const version = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8")).version;
const packageDir = resolve(root, "dist", `relay-agent-${rid}`);
const output =
  rid === "win-x64"
    ? resolve(root, "dist", `relay-agent-${version}-${rid}-portable.zip`)
    : resolve(root, "dist", `relay-agent-${version}-${rid}-portable.tar.gz`);

if (!existsSync(packageDir)) {
  throw new Error(`package directory does not exist. Run pnpm sidecar:publish:${ridName(rid)} first: ${packageDir}`);
}

rmSync(output, { force: true });

if (rid === "win-x64") {
  createZip(packageDir, output);
} else if (rid === "linux-x64") {
  run("tar", ["-C", packageDir, "-czf", output, "."]);
} else {
  throw new Error(`unsupported RID: ${rid}`);
}

console.log(`archive-sidecar: wrote ${relativePath(output)}`);

function createZip(sourceDir, outputPath) {
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${sourceDir.replaceAll("'", "''")}\\*' -DestinationPath '${outputPath.replaceAll("'", "''")}' -Force`,
    ]);
    return;
  }

  if (commandExists("7z")) {
    run("7z", ["a", "-tzip", outputPath, "."], { cwd: sourceDir });
    return;
  }

  if (commandExists("zip")) {
    run("zip", ["-r", outputPath, "."], { cwd: sourceDir });
    return;
  }

  throw new Error("Creating a Windows portable zip requires PowerShell on Windows, or 7z/zip on this platform.");
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function platformRid() {
  if (process.platform === "win32") return "win-x64";
  if (process.platform === "linux") return "linux-x64";
  throw new Error(`unsupported platform: ${process.platform}`);
}

function ridName(value) {
  if (value === "win-x64") return "windows";
  if (value === "linux-x64") return "linux";
  return value;
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) {
    const suffix = result.error ? ` (${result.error.message})` : "";
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}${suffix}`);
  }
}

function relativePath(path) {
  return path.replace(`${root}${process.platform === "win32" ? "\\" : "/"}`, "");
}
