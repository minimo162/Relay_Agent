#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workbenchDist = resolve(root, "apps/workbench/dist");
const wwwroot = resolve(root, "apps/sidecar/wwwroot");

if (!existsSync(workbenchDist)) {
  throw new Error("PDF client dist does not exist. Run pnpm --filter @relay-agent/workbench build first.");
}

rmSync(wwwroot, { recursive: true, force: true });
mkdirSync(wwwroot, { recursive: true });
cpSync(workbenchDist, wwwroot, { recursive: true });
writeFileSync(resolve(wwwroot, "relay-assets.json"), JSON.stringify({
  schemaVersion: "RelayPdfReviewAssets.v1",
  source: "apps/workbench/dist",
  generatedBy: "scripts/prepare-sidecar-assets.mjs",
}, null, 2));

console.log(`Prepared sidecar assets: ${wwwroot}`);
