#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const packageScript = readFileSync(resolve(root, "scripts/release/package-sidecar.mjs"), "utf8");
const archiveScript = readFileSync(resolve(root, "scripts/release/archive-sidecar.mjs"), "utf8");

assert(packageScript.includes('const appRoot = join(output, "app")'), "package script must define app/ as the implementation root");
assert(packageScript.includes('const licensesRoot = join(output, "LICENSES")'), "package script must define LICENSES/ at the package root");
assert(packageScript.includes('join(output, "README-FIRST.html")'), "package script must write README-FIRST.html at the package root");
assert(!packageScript.includes('join(output, "Relay Agent.html")'), "package root must not expose duplicate HTML launchers");
assert(!packageScript.includes('join(output, "Start Relay Agent.cmd")'), "package root must not expose helper cmd scripts");
assert(archiveScript.includes("-portable.zip"), "Windows archive name must identify the recommended portable package");
assert(archiveScript.includes("-portable.tar.gz"), "Linux archive name must identify the recommended portable package");

inspectPublishedPackage("win-x64", ["Relay Agent.exe", "README-FIRST.html", "LICENSES", "app"]);
inspectPublishedPackage("linux-x64", ["relay-agent", "README-FIRST.html", "LICENSES", "app"]);

console.log("[portable-root-smoke] ok");

function inspectPublishedPackage(rid, allowedEntries) {
  const packageRoot = resolve(root, "dist", `relay-agent-${rid}`);
  if (!existsSync(packageRoot)) return;
  if (!existsSync(join(packageRoot, "app", "relay-default-config.json"))) {
    return;
  }

  const actualEntries = readdirSync(packageRoot).sort();
  const expected = [...allowedEntries].sort();
  assert(
    JSON.stringify(actualEntries) === JSON.stringify(expected),
    `${rid} package root must contain only ${expected.join(", ")}; got ${actualEntries.join(", ")}`,
  );

  const appRoot = join(packageRoot, "app");
  assert(statSync(appRoot).isDirectory(), `${rid} package must contain app/`);
  assert(statSync(join(packageRoot, "LICENSES")).isDirectory(), `${rid} package must contain LICENSES/`);
  assert(statSync(join(packageRoot, "README-FIRST.html")).isFile(), `${rid} package must contain README-FIRST.html`);
  assert(readFileSync(join(packageRoot, "README-FIRST.html"), "utf8").includes(
    rid === "win-x64" ? "Relay Agent.exe" : "relay-agent",
  ), `${rid} README-FIRST.html must name the visible launcher`);

  for (const disallowed of [
    "Relay.Sidecar.exe",
    "Relay.Sidecar",
    "Relay.Launcher.exe",
    "Relay.Launcher",
    "relay-assets",
    "relay-tools",
    "wwwroot",
    "scripts",
    "schemas",
    "logs",
    "diagnostics",
    "relay-default-config.json",
    "RELAY_RELEASE_CONTENTS.txt",
    "README_PORTABLE.txt",
  ]) {
    assert(!actualEntries.includes(disallowed), `${rid} package root exposes implementation entry: ${disallowed}`);
  }

  assert(existsSync(join(appRoot, "relay-core")), `${rid} package must keep Relay Core under app/relay-core`);
  assert(existsSync(join(appRoot, "app-server")), `${rid} package must keep Codex app-server under app/app-server`);
  assert(existsSync(join(appRoot, "relay-assets", "relay-agent.ico")), `${rid} package must keep icon assets under app/relay-assets`);
  assert(!existsSync(join(appRoot, "relay-core", "relay-tools")), `${rid} package must not revive retired Relay-owned tool bundles`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
