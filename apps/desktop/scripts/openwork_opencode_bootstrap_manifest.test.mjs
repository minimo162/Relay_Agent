import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  scriptDir,
  "../src-tauri/bootstrap/openwork-opencode.json",
);

function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function assertArtifact(artifact, expected) {
  assert.equal(typeof artifact.name, "string");
  assert.equal(artifact.version, expected.version);
  assert.equal(artifact.kind, expected.kind);
  assert.equal(artifact.format, expected.format);
  assert.equal(artifact.url, expected.url);
  assert.match(artifact.url, /^https:\/\/github\.com\//);
  assert.equal(artifact.sha256, expected.sha256);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.size, expected.size);
  assert.equal(artifact.entrypoint, expected.entrypoint);
  assert.equal(typeof artifact.license, "string");
}

test("OpenWork/OpenCode bootstrap manifest pins Windows x64 artifacts", () => {
  const manifest = loadManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(
    manifest.selectedTrack,
    "windows-x64-openwork-desktop-plus-opencode-cli",
  );
  assert.match(manifest.ownershipBoundary, /external OpenWork\/OpenCode/);
  assert.match(manifest.ownershipBoundary, /own UX, sessions, permissions, tools/);

  const windows = manifest.platforms?.["windows-x64"];
  assert.ok(windows, "windows-x64 platform entry is required");

  assertArtifact(windows.openworkDesktop, {
    version: "0.11.212",
    kind: "installer",
    format: "msi",
    url: "https://github.com/different-ai/openwork/releases/download/v0.11.212/openwork-desktop-windows-x64.msi",
    sha256: "e52d020a1f6c2073164ed06279c441869844cb07a396bffac0789d63a4b7f486",
    size: 218517504,
    entrypoint: "msiexec",
  });
  assert.equal(
    windows.openworkDesktop.installMode,
    "explicit-user-approved-installer",
  );
  assert.match(windows.openworkDesktop.license, /\/ee/);

  assertArtifact(windows.opencodeCli, {
    version: "1.14.25",
    kind: "archive",
    format: "zip",
    url: "https://github.com/anomalyco/opencode/releases/download/v1.14.25/opencode-windows-x64.zip",
    sha256: "8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b",
    size: 53772841,
    entrypoint: "opencode.exe",
  });
  assert.equal(windows.opencodeCli.license, "MIT");
});

test("OpenWork/OpenCode bootstrap manifest preserves provider-only boundary", () => {
  const serialized = JSON.stringify(loadManifest());

  assert.doesNotMatch(serialized, /resources\/opencode-runtime/);
  assert.doesNotMatch(serialized, /experimental\/tool\/execute/);
  assert.doesNotMatch(serialized, /OpencodeToolExecutionContext/);
  assert.match(serialized, /Relay must not execute tools/);
});
