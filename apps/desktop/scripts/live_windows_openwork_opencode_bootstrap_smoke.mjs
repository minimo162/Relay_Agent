#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

import { MODEL_REF, providerBaseURL, providerPort } from "./opencode_provider_config.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const manifestPath = resolve(appRoot, "src-tauri/bootstrap/openwork-opencode.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const platform = "windows-x64";
const platformManifest = manifest.platforms?.[platform];
const shouldDownload = process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_DOWNLOAD === "1";
const requireWindows = process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_REQUIRE_WINDOWS !== "0";
const cacheRoot = resolve(
  process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_CACHE ||
    join(tmpdir(), "relay-live-windows-openwork-opencode-bootstrap"),
);

function artifactPath(key, artifact) {
  const filename = artifact.url.split("/").pop();
  return join(cacheRoot, platform, key, artifact.version, filename);
}

async function downloadAndVerify(key, artifact) {
  const destination = artifactPath(key, artifact);
  mkdirSync(dirname(destination), { recursive: true });

  if (existsSync(destination)) {
    const verified = verifyFile(destination, artifact);
    if (verified.ok) return { ...verified, path: destination, reused: true };
    rmSync(destination, { force: true });
  }

  const partial = `${destination}.${randomUUID()}.partial`;
  const response = await fetch(artifact.url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed for ${artifact.url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(partial, { flags: "wx" }));
  const verified = verifyFile(partial, artifact);
  if (!verified.ok) {
    rmSync(partial, { force: true });
    throw new Error(
      `verification failed for ${artifact.name}: expected size=${artifact.size} sha256=${artifact.sha256}; actual size=${verified.size} sha256=${verified.sha256}`,
    );
  }
  renameSync(partial, destination);
  return { ...verified, path: destination, reused: false };
}

function verifyFile(path, artifact) {
  const size = statSync(path).size;
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return {
    ok: size === artifact.size && sha256 === artifact.sha256,
    size,
    sha256,
  };
}

if (!platformManifest) {
  throw new Error(`missing ${platform} bootstrap manifest`);
}

const artifacts = {
  openworkDesktop: platformManifest.openworkDesktop,
  opencodeCli: platformManifest.opencodeCli,
};

const report = {
  ok: true,
  platform,
  hostPlatform: process.platform,
  mode: shouldDownload ? "download_verify" : "preflight",
  cacheRoot,
  windowsRequired: requireWindows,
  supportedHost: process.platform === "win32",
  providerHandoff: {
    baseURL: providerBaseURL(providerPort()),
    model: MODEL_REF,
    apiKeyEnv: "RELAY_AGENT_API_KEY",
  },
  artifacts: {
    openworkDesktop: {
      version: artifacts.openworkDesktop.version,
      url: artifacts.openworkDesktop.url,
      sha256: artifacts.openworkDesktop.sha256,
      size: artifacts.openworkDesktop.size,
      installMode: artifacts.openworkDesktop.installMode,
      expectedPath: artifactPath("openwork-desktop", artifacts.openworkDesktop),
    },
    opencodeCli: {
      version: artifacts.opencodeCli.version,
      url: artifacts.opencodeCli.url,
      sha256: artifacts.opencodeCli.sha256,
      size: artifacts.opencodeCli.size,
      expectedPath: artifactPath("opencode-cli", artifacts.opencodeCli),
      expectedEntrypoint: join(
        cacheRoot,
        platform,
        "opencode-cli",
        artifacts.opencodeCli.version,
        "extracted",
        artifacts.opencodeCli.entrypoint,
      ),
    },
  },
  manualSteps: [
    "Start Relay provider gateway and export RELAY_AGENT_API_KEY.",
    "Download and verify OpenCode CLI and OpenWork Desktop artifacts.",
    "Extract OpenCode CLI and install Relay provider config into the target workspace.",
    "Open the verified OpenWork Desktop MSI only after explicit operator approval.",
    "Configure/OpenWork OpenCode path for relay-agent/m365-copilot.",
    "Run one provider text turn and one OpenCode-owned read tool turn.",
  ],
};

if (requireWindows && process.platform !== "win32") {
  report.ok = false;
  report.status = "blocked_non_windows_host";
  report.message = "B06 requires a clean Windows host with M365 Copilot sign-in; this run is preflight only.";
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (shouldDownload) {
  report.downloads = {
    opencodeCli: await downloadAndVerify("opencode-cli", artifacts.opencodeCli),
    openworkDesktop: await downloadAndVerify("openwork-desktop", artifacts.openworkDesktop),
  };
  report.status = "download_verified";
} else {
  report.status = "ready_for_explicit_download";
  report.message = "Set RELAY_LIVE_WINDOWS_BOOTSTRAP_DOWNLOAD=1 on Windows to download and verify real artifacts.";
}

console.log(JSON.stringify(report, null, 2));
