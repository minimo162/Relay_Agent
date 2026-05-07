import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, "../src-tauri/bootstrap/aionui-relay.json");

export function loadAionuiRelayManifest(path = manifestPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function officeCliArtifact(manifest = loadAionuiRelayManifest(), platform = "windows-x64") {
  const artifact = manifest.upstreams?.officeCli?.artifacts?.[platform];
  if (!artifact) {
    throw new Error(`missing OfficeCLI artifact for ${platform}`);
  }
  return {
    ...artifact,
    version: manifest.upstreams.officeCli.version,
  };
}

export function officeCliCacheRoot() {
  return process.env.RELAY_OFFICECLI_CACHE_DIR || join(homedir(), ".relay-agent", "tools", "officecli");
}

export function officeCliCachedPath({
  cacheRoot = officeCliCacheRoot(),
  artifact = officeCliArtifact(),
} = {}) {
  return join(cacheRoot, artifact.version, artifact.entrypoint);
}

export function officeCliPathEnv(existingPath, officeCliPath, platform = process.platform) {
  const separator = platform === "win32" ? ";" : ":";
  const dir = dirname(officeCliPath);
  const current = String(existingPath || "");
  if (!current) return dir;
  const parts = current.split(separator).filter(Boolean);
  const normalized = platform === "win32" ? dir.toLowerCase() : dir;
  const hasDir = parts.some((part) => (platform === "win32" ? part.toLowerCase() : part) === normalized);
  return hasDir ? current : [dir, ...parts].join(separator);
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function verifyOfficeCliArtifactFile(path, artifact = officeCliArtifact()) {
  const stat = statSync(path);
  if (stat.size !== artifact.size) {
    throw new Error(`OfficeCLI size mismatch: expected ${artifact.size}, actual ${stat.size}`);
  }
  const actual = sha256File(path);
  if (actual !== artifact.sha256) {
    throw new Error(`OfficeCLI sha256 mismatch: expected ${artifact.sha256}, actual ${actual}`);
  }
  return {
    path,
    size: stat.size,
    sha256: actual,
    reused: true,
  };
}

export async function downloadOfficeCliArtifact({
  artifact = officeCliArtifact(),
  outputPath = officeCliCachedPath({ artifact }),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (existsSync(outputPath)) {
    return verifyOfficeCliArtifactFile(outputPath, artifact);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable; Node 22+ is required for OfficeCLI bootstrap");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.download`;
  rmSync(tempPath, { force: true });

  const response = await fetchImpl(artifact.url);
  if (!response.ok || !response.body) {
    throw new Error(`OfficeCLI download failed with HTTP ${response.status} for ${artifact.url}`);
  }

  await pipeline(response.body, createWriteStream(tempPath, { mode: 0o755 }));
  verifyOfficeCliArtifactFile(tempPath, artifact);
  renameSync(tempPath, outputPath);
  try {
    chmodSync(outputPath, 0o755);
  } catch {
    /* best effort on Windows */
  }
  return verifyOfficeCliArtifactFile(outputPath, artifact);
}

export function officeCliBootstrapPlan({
  manifest = loadAionuiRelayManifest(),
  platform = "windows-x64",
  cacheRoot = officeCliCacheRoot(),
} = {}) {
  const artifact = officeCliArtifact(manifest, platform);
  const path = officeCliCachedPath({ cacheRoot, artifact });
  return {
    platform,
    version: artifact.version,
    url: artifact.url,
    sha256: artifact.sha256,
    size: artifact.size,
    path,
    pathEnv: officeCliPathEnv("", path),
    installMode: manifest.upstreams.officeCli.installMode,
    requiresAdmin: false,
  };
}
