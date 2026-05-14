#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadOfficeCliArtifact,
  officeCliArtifact,
  verifyOfficeCliArtifactFile,
} from "./officecli_bootstrap.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outPath = resolve(repoRoot, "apps/desktop/src-tauri/binaries/relay-officecli-win-x64.exe");

async function main() {
  const artifact = officeCliArtifact(undefined, "windows-x64");
  mkdirSync(dirname(outPath), { recursive: true });

  if (existsSync(outPath)) {
    verifyOfficeCliArtifactFile(outPath, artifact);
    console.log(`fetch-bundled-officecli: exists, verified: ${outPath}`);
    return;
  }

  const tempCachePath = resolve(
    repoRoot,
    "apps/desktop/src-tauri/binaries/.relay-officecli-download-cache",
    artifact.version,
    artifact.entrypoint,
  );
  const downloaded = await downloadOfficeCliArtifact({ artifact, outputPath: tempCachePath });
  copyFileSync(downloaded.path, outPath);
  verifyOfficeCliArtifactFile(outPath, artifact);
  console.log(`fetch-bundled-officecli: wrote ${outPath}`);
}

main().catch((error) => {
  console.error("fetch-bundled-officecli:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
