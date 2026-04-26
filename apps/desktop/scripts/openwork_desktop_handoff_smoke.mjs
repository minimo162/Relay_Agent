#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_REF,
  providerBaseURL,
  providerPort,
  readOrCreateToken,
} from "./opencode_provider_config.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const manifestPath = resolve(appRoot, "src-tauri/bootstrap/openwork-opencode.json");

function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function bootstrappedInstallerPath(cacheRoot, artifact) {
  return join(
    cacheRoot,
    "windows-x64",
    "openwork-desktop",
    artifact.version,
    "openwork-desktop-windows-x64.msi",
  );
}

function detectOpenWorkDesktop() {
  const override = process.env.RELAY_BOOTSTRAP_OPENWORK_DESKTOP_BIN?.trim();
  if (override) {
    return {
      status: "detected",
      source: "RELAY_BOOTSTRAP_OPENWORK_DESKTOP_BIN",
      path: resolve(override),
    };
  }
  return {
    status: "not_detected",
    source: "none",
    path: null,
  };
}

const manifest = loadManifest();
const openwork = manifest.platforms?.["windows-x64"]?.openworkDesktop;
assert.ok(openwork, "windows-x64 openworkDesktop artifact is required");
assert.equal(openwork.kind, "installer");
assert.equal(openwork.format, "msi");
assert.equal(openwork.entrypoint, "msiexec");
assert.equal(openwork.installMode, "explicit-user-approved-installer");
assert.match(openwork.sha256, /^[a-f0-9]{64}$/);
assert.match(openwork.license, /explicit review/);

const root = mkdtempSync(join(tmpdir(), "relay-openwork-desktop-handoff-smoke-"));
const cacheRoot = join(root, "app-local-data", "openwork-opencode-bootstrap");
const tokenFile = join(root, "provider-token");
const installerPath = bootstrappedInstallerPath(cacheRoot, openwork);

mkdirSync(dirname(installerPath), { recursive: true });
writeFileSync(installerPath, "placeholder: smoke does not execute MSI\n", "utf8");

const { token, source } = readOrCreateToken(tokenFile);
const handoff = {
  baseURL: providerBaseURL(providerPort()),
  model: MODEL_REF,
  apiKeyEnv: "RELAY_AGENT_API_KEY",
  apiKeySource: source,
  tokenPresent: token.length > 0,
};
const detection = detectOpenWorkDesktop();
const result = {
  ok: true,
  installMode: openwork.installMode,
  action: "diagnostic_handoff_only",
  installer: {
    path: installerPath,
    version: openwork.version,
    sha256: openwork.sha256,
    size: openwork.size,
  },
  detection,
  handoff,
};

assert.equal(result.action, "diagnostic_handoff_only");
assert.equal(result.handoff.baseURL, "http://127.0.0.1:18180/v1");
assert.equal(result.handoff.model, "relay-agent/m365-copilot");
assert.equal(result.handoff.apiKeyEnv, "RELAY_AGENT_API_KEY");
assert.equal(result.handoff.tokenPresent, true);
assert.notEqual(result.detection.status, "launched");

const serialized = JSON.stringify(result);
assert.doesNotMatch(serialized, /experimental\/tool\/execute/);
assert.doesNotMatch(serialized, /opencode-runtime/);

console.log(JSON.stringify(result, null, 2));
