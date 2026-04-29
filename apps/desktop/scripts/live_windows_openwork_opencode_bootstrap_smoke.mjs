#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

import { MODEL_REF, providerBaseURL, providerPort } from "./opencode_provider_config.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const manifestPath = resolve(appRoot, "src-tauri/bootstrap/openwork-opencode.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const platform = "windows-x64";
const platformManifest = manifest.platforms?.[platform];
const shouldDownload = process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_DOWNLOAD === "1";
const requireWindows = process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_REQUIRE_WINDOWS !== "0";
const skipRustPreflight = process.env.RELAY_LIVE_WINDOWS_BOOTSTRAP_SKIP_RUST_PREFLIGHT === "1";
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

function runBootstrapPreflight() {
  if (skipRustPreflight) {
    return {
      skipped: true,
      reason: "RELAY_LIVE_WINDOWS_BOOTSTRAP_SKIP_RUST_PREFLIGHT=1",
    };
  }

  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      resolve(appRoot, "src-tauri/Cargo.toml"),
      "--bin",
      "relay-openwork-bootstrap",
      "--",
      "--platform",
      platform,
      "--cache-root",
      cacheRoot,
      "--json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    },
  );

  if (result.status !== 0) {
    return {
      ok: false,
      status: "failed",
      exitCode: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    };
  }

  const parsed = JSON.parse(result.stdout);
  return {
    ok: parsed.ok === true,
    status: parsed.status,
    mode: parsed.mode,
    providerGatewayStatus: parsed.providerGateway?.status ?? null,
    providerGatewaySkippedReason: parsed.providerGateway?.skippedReason ?? null,
    installerSkippedReason: parsed.openworkInstallerHandoff?.skippedReason ?? null,
    artifactStatuses: Object.fromEntries(
      (parsed.artifacts ?? []).map((artifact) => [artifact.artifact, artifact.status]),
    ),
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
  milestone: "B12-post-ux-removal-windows-bootstrap-e2e",
  mode: shouldDownload ? "download_verify" : "preflight",
  cacheRoot,
  windowsRequired: requireWindows,
  supportedHost: process.platform === "win32",
  productionEntrypoint: {
    rootDev: rootPackage.scripts?.dev ?? null,
    rootBootstrap: rootPackage.scripts?.["bootstrap:openwork-opencode"] ?? null,
    desktopBootstrap: desktopPackage.scripts?.["bootstrap:openwork-opencode"] ?? null,
    desktopTauriDev: desktopPackage.scripts?.["tauri:dev"] ?? null,
    desktopDiagTauriDev: desktopPackage.scripts?.["diag:tauri-dev"] ?? null,
  },
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
    "Run pnpm bootstrap:openwork-opencode -- --pretty and confirm Relay desktop UX is not the production entrypoint.",
    "Run pnpm bootstrap:openwork-opencode -- --download --workspace <workspace> --start-provider-gateway.",
    "Keep the printed RELAY_AGENT_API_KEY available to OpenCode/OpenWork.",
    "Open the verified OpenWork Desktop MSI only with --open-openwork-installer after explicit operator approval.",
    "Configure OpenWork/OpenCode for relay-agent/m365-copilot.",
    "Run one provider text turn and one OpenCode-owned read tool turn.",
  ],
};

report.bootstrapPreflight = runBootstrapPreflight();
if (report.bootstrapPreflight.ok === false) {
  report.ok = false;
  report.status = "bootstrap_preflight_failed";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (report.productionEntrypoint.rootDev !== "pnpm bootstrap:openwork-opencode -- --pretty") {
  report.ok = false;
  report.status = "production_entrypoint_not_bootstrap";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (report.productionEntrypoint.desktopTauriDev !== null) {
  report.ok = false;
  report.status = "desktop_tauri_dev_still_primary";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (requireWindows && process.platform !== "win32") {
  report.ok = false;
  report.status = "blocked_non_windows_host";
  report.message = "B12 requires a clean Windows host with M365 Copilot sign-in; this run is post-UX-removal readiness preflight only.";
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
