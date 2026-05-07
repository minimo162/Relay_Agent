#!/usr/bin/env node

import {
  downloadOfficeCliArtifact,
  officeCliArtifact,
  officeCliBootstrapPlan,
  officeCliCachedPath,
  officeCliPathEnv,
} from "./officecli_bootstrap.mjs";

function usage() {
  return [
    "Usage: pnpm --filter @relay-agent/desktop bootstrap:officecli [--print-plan] [--download]",
    "",
    "Downloads and verifies OfficeCLI into Relay-managed user-local storage.",
    "No admin approval or upstream install script is used.",
  ].join("\n");
}

function parseArgs(raw) {
  const parsed = {
    printPlan: false,
    download: false,
    help: false,
  };
  for (const arg of raw) {
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--print-plan") parsed.printPlan = true;
    else if (arg === "--download") parsed.download = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const artifact = officeCliArtifact();
  const outputPath = officeCliCachedPath({ artifact });
  const plan = officeCliBootstrapPlan();

  if (options.printPlan || !options.download) {
    console.log(JSON.stringify(plan, null, 2));
    if (!options.download) return;
  }

  const verified = await downloadOfficeCliArtifact({ artifact, outputPath });
  console.log("[relay-officecli] ready:", verified.path);
  console.log("[relay-officecli] sha256:", verified.sha256);
  console.log("[relay-officecli] PATH:", officeCliPathEnv(process.env.PATH, verified.path));
}

try {
  await main();
} catch (error) {
  console.error("[relay-officecli] bootstrap failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
