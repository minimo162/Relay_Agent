#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(root, "dist/release");
const inventoryPath = resolve(outDir, "relay-release-inventory.json");
const sbomPath = resolve(outDir, "relay-sbom.json");
const workbenchPackage = JSON.parse(readFileSync(resolve(root, "apps/workbench/package.json"), "utf8"));
const inputs = [
  "apps/sidecar/Relay.Sidecar.csproj",
  "apps/launcher/Relay.Launcher.csproj",
  "apps/workbench/package.json",
  "apps/workbench/dist",
  "assets/app-icon",
  "tools/ripgrep",
  "tools/officecli",
  "dist/relay-agent-win-x64",
  "dist/relay-agent-linux-x64",
  `dist/relay-agent-${workbenchPackage.version}-win-x64-portable.zip`,
  `dist/relay-agent-${workbenchPackage.version}-linux-x64-portable.tar.gz`,
  "dist/installer",
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
  activeArchitecture: "html-tool-api-hub-relay-core-sidecar",
  portableRootPolicy: {
    windows: ["Relay Agent.exe", "README-FIRST.html", "LICENSES/", "app/"],
    linux: ["relay-agent", "README-FIRST.html", "LICENSES/", "app/"],
    internalsUnder: "app/",
  },
  excludedLegacyActivePaths: [
    "AionUi",
    "OpenCode/OpenWork",
    "Tauri runtime and installer",
    "old per-mode workflow runners",
  ],
  files,
};

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
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
    { type: "dotnet", name: "Relay.Launcher", version: readFileSync(resolve(root, "apps/launcher/Relay.Launcher.csproj"), "utf8").match(/<Version>([^<]+)<\/Version>/)?.[1] ?? "unknown" },
  ],
  bundledBinaries: [
    { name: "Relay.Sidecar", source: "self-contained dotnet publish" },
    { name: "Relay.Launcher", source: "self-contained dotnet publish" },
    { name: "ripgrep", source: "tools/ripgrep copied into app/relay-core/relay-tools/ripgrep" },
    { name: "officecli", source: "Windows release bundle when dist/relay-agent-win-x64/app/relay-core/relay-tools/officecli/officecli.exe is present", optional: true },
  ],
  intentionallyExcludedRuntimeFamilies: inventory.excludedLegacyActivePaths,
  fileHashes: files,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
console.log(`Wrote ${relative(root, inventoryPath)}`);
console.log(`Wrote ${relative(root, sbomPath)}`);
