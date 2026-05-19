#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "tools/codex-app-server/manifest.json");
const fetchScript = read("scripts/release/fetch-codex-app-server.mjs");
const packageScript = read("scripts/release/package-sidecar.mjs");
const inventoryScript = read("scripts/release/collect-inventory.mjs");
const packageJson = JSON.parse(read("package.json"));

assert(existsSync(manifestPath), "Codex app-server artifact manifest is missing");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

assert(manifest.schemaVersion === "RelayCodexAppServerArtifactManifest.v1", "unexpected manifest schema");
assert(manifest.source?.name === "@openai/codex", "manifest must pin @openai/codex");
assert(manifest.source?.packageVersion === "0.131.0", "manifest must pin the tested app-server package version");
assert(manifest.source?.license === "Apache-2.0", "manifest must record the redistributable license");
assert(Array.isArray(manifest.runtime?.commandArguments) && manifest.runtime.commandArguments.includes("app-server"), "manifest must record the app-server command");
assert(manifest.runtime?.provider?.model === "m365-copilot", "manifest must target Relay's m365-copilot model");

for (const rid of ["linux-x64", "win-x64"]) {
  const platform = manifest.platforms?.[rid];
  assert(platform, `manifest missing platform: ${rid}`);
  assert(platform.tarball?.startsWith("https://registry.npmjs.org/"), `${rid} tarball must come from npm registry`);
  assert(platform.integrity?.startsWith("sha512-"), `${rid} must pin sha512 integrity`);
  assert(/^[a-f0-9]{40}$/i.test(platform.shasum ?? ""), `${rid} must pin npm shasum`);
  assert(/^[a-f0-9]{64}$/i.test(platform.sha256 ?? ""), `${rid} must pin sha256`);
  assert(platform.expectedExecutableSource?.includes("/codex/"), `${rid} must record upstream executable source`);
  assert(platform.expectedPackageLayout?.startsWith("app/app-server/"), `${rid} must record package layout`);
}

assert(fetchScript.includes("verifyArchive"), "fetch script must verify downloaded archives");
assert(fetchScript.includes("relay-codex-app-server-manifest.json"), "fetch script must materialize runtime manifest");
assert(packageScript.includes("copyAppServerBundle"), "package script must copy the app-server bundle");
assert(packageScript.includes("app-server"), "package script must populate app/app-server");
assert(inventoryScript.includes("tools/codex-app-server"), "release inventory must include the pinned app-server manifest/materialization inputs");

for (const name of ["appserver:fetch:linux", "appserver:fetch:windows", "sidecar:app-server-artifact-smoke"]) {
  assert(packageJson.scripts?.[name], `missing package script: ${name}`);
}
assert(packageJson.scripts["sidecar:publish:linux"].includes("pnpm appserver:fetch:linux"), "linux publish must fetch the app server");
assert(packageJson.scripts["sidecar:publish:windows"].includes("pnpm appserver:fetch:windows"), "windows publish must fetch the app server");
assert(packageJson.scripts.check.includes("pnpm sidecar:app-server-artifact-smoke"), "pnpm check must include artifact smoke");

console.log("[app-server-artifact-smoke] ok");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
