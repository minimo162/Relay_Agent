#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(root, "dist/release");
const inventoryPath = resolve(outDir, "relay-release-inventory.json");
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

mkdirSync(outDir, { recursive: true });
writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
console.log(`Wrote ${relative(root, inventoryPath)}`);
