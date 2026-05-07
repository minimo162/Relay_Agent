import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(scriptDir, "../src-tauri/bootstrap/aionui-relay.json");

function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

test("AionUi Relay manifest pins exact upstream source baselines", () => {
  const manifest = loadManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.selectedTrack, "windows-x64-aionui-relay-officecli");
  assert.match(manifest.ownershipBoundary, /Relay-branded AionUi owns UX/);
  assert.match(manifest.ownershipBoundary, /Relay owns only the local OpenAI-compatible/);

  assert.equal(manifest.upstreams.aionUi.repository, "https://github.com/iOfficeAI/AionUi");
  assert.equal(manifest.upstreams.aionUi.version, "1.9.25");
  assert.equal(manifest.upstreams.aionUi.tag, "v1.9.25");
  assert.equal(manifest.upstreams.aionUi.commit, "bbada2a9268060d2b41ddf1d885a9b27ecd2103d");
  assert.equal(manifest.upstreams.aionUi.license, "Apache-2.0");

  assert.equal(manifest.upstreams.officeCli.repository, "https://github.com/iOfficeAI/OfficeCLI");
  assert.equal(manifest.upstreams.officeCli.version, "1.0.76");
  assert.equal(manifest.upstreams.officeCli.tag, "v1.0.76");
  assert.equal(manifest.upstreams.officeCli.commit, "958717ea25351b8920a3d8313d46e08b24b9c95b");
  assert.equal(manifest.upstreams.officeCli.license, "Apache-2.0");
});

test("AionUi Relay manifest pins admin-free OfficeCLI Windows artifact", () => {
  const manifest = loadManifest();
  const officeCli = manifest.upstreams.officeCli;
  const artifact = officeCli.artifacts["windows-x64"];

  assert.equal(officeCli.installMode, "relay-managed-portable-user-local");
  assert.equal(artifact.name, "officecli-win-x64.exe");
  assert.equal(artifact.kind, "binary");
  assert.equal(artifact.format, "exe");
  assert.equal(
    artifact.url,
    "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.76/officecli-win-x64.exe",
  );
  assert.equal(artifact.sha256, "f9e4895505858ab813e133d4d1f9f01004c7b4b08397408487f534caf9e2ec58");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.size, 30433916);
  assert.equal(artifact.entrypoint, "officecli.exe");
});

test("AionUi Relay manifest fixes Relay provider seed and disabled defaults", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.providerSeed, {
    id: "relay-agent",
    platform: "custom",
    name: "Relay Agent / M365 Copilot",
    baseUrlTemplate: "http://127.0.0.1:${port}/v1",
    apiKeySource: "Relay local provider token",
    model: "m365-copilot",
    displayModelRef: "relay-agent/m365-copilot",
    capabilities: ["text", "function_calling"],
    contextLimit: 128000,
  });

  assert.ok(manifest.disabledByDefault.includes("remote access"));
  assert.ok(manifest.disabledByDefault.includes("channel bots"));
  assert.ok(manifest.disabledByDefault.includes("manual provider onboarding"));
  assert.ok(manifest.disabledByDefault.includes("OpenWork handoff"));
  assert.ok(manifest.disabledByDefault.includes("OpenCode Web first-run launcher"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-docx"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-xlsx"));
  assert.ok(manifest.enabledByDefaultSkills.includes("officecli-pptx"));
});

test("AionUi Relay manifest fixes Relay product branding", () => {
  const manifest = loadManifest();

  assert.deepEqual(manifest.branding, {
    packageName: "relay-agent-aionui",
    appId: "com.relayagent.app",
    productName: "Relay Agent",
    executableName: "Relay Agent",
    windowTitle: "Relay Agent",
    protocol: "relay-agent",
    installerArtifactPrefix: "Relay.Agent",
    iconSource: "apps/desktop/src-tauri/icons/source/relay-agent.svg",
    publishOwner: "minimo162",
    publishRepo: "Relay_Agent",
    browserTitle: "Relay Agent",
    supportName: "Relay Agent",
  });
});
