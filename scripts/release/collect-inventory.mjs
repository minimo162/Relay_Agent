#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(root, "dist/release");
const inventoryPath = resolve(outDir, "relay-release-inventory.json");
const sbomPath = resolve(outDir, "relay-sbom.json");
const inputs = [
  "apps/sidecar/Relay.Sidecar.csproj",
  "apps/workbench/package.json",
  "apps/workbench/dist",
];

function walk(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

const files = inputs.flatMap((input) => walk(resolve(root, input))).map((file) => {
  const bytes = readFileSync(file);
  return {
    path: relative(root, file).replaceAll("\\", "/"),
    name: basename(file),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

const inventory = {
  schemaVersion: "RelayReleaseInventory.v1",
  generatedAt: new Date().toISOString(),
  activeArchitecture: "browser-workbench-dotnet-sidecar",
  excludedLegacyActivePaths: [
    "AionUi",
    "OpenCode/OpenWork",
    "Tauri runtime and installer",
    "old per-mode workflow runners",
  ],
  files,
};

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const workbenchPackage = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8"));
const sidecarProject = readFileSync(resolve(root, "apps/sidecar/Relay.Sidecar.csproj"), "utf8");
const dotnetPackages = [...sidecarProject.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)]
  .map((match) => ({ type: "nuget", name: match[1], version: match[2] }));

const sbom = {
  schemaVersion: "RelaySbom.v1",
  generatedAt: inventory.generatedAt,
  formatNote: "SBOM-style release inventory. Full CycloneDX/SPDX export is a future gate.",
  packageManager: rootPackage.packageManager,
  components: [
    ...Object.entries(rootPackage.devDependencies ?? {}).map(([name, version]) => ({ type: "npm-dev", name, version })),
    ...Object.entries(workbenchPackage.devDependencies ?? {}).map(([name, version]) => ({ type: "npm-dev", name, version })),
    ...dotnetPackages,
    { type: "dotnet", name: "Relay.Sidecar", version: sidecarProject.match(/<Version>([^<]+)<\/Version>/)?.[1] ?? "unknown" },
  ],
  bundledBinaries: [
    { name: "Relay.Sidecar", source: "self-contained dotnet publish" },
  ],
  intentionallyExcludedRuntimeFamilies: inventory.excludedLegacyActivePaths,
  fileHashes: files,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
console.log(`Wrote ${relative(root, inventoryPath)}`);
console.log(`Wrote ${relative(root, sbomPath)}`);
