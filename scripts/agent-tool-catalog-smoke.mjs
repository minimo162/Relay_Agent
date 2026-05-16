#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const token = "relay-tool-catalog-token";
const port = 17896;
const dataDir = mkdtempSync(join(tmpdir(), "relay-tool-catalog-data-"));
const fixturePath = join(process.cwd(), "scripts", "fixtures", "agent-tool-catalog-snapshot.json");

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "ok" }),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSidecar() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)]));
  }
  return value;
}

function compareJson(actual, expected) {
  const actualText = JSON.stringify(stable(actual), null, 2);
  const expectedText = JSON.stringify(stable(expected), null, 2);
  if (actualText === expectedText) return;

  const actualNames = actual.tools?.map((tool) => tool.name).join(", ") ?? "<missing>";
  const expectedNames = expected.tools?.map((tool) => tool.name).join(", ") ?? "<missing>";
  throw new Error([
    "Agent tool catalog snapshot drifted.",
    `Expected names: ${expectedNames}`,
    `Actual names:   ${actualNames}`,
    `Update ${fixturePath} only when the model-facing tool contract intentionally changes.`,
  ].join("\n"));
}

try {
  await waitForSidecar();
  const response = await fetch(`http://127.0.0.1:${port}/api/tool-catalog?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) throw new Error(`tool catalog endpoint failed: ${response.status}`);
  const catalog = await response.json();
  if (catalog.schemaVersion !== "RelayAgentToolCatalogSnapshot.v1") {
    throw new Error(`unexpected schemaVersion: ${catalog.schemaVersion}`);
  }

  const toolNames = catalog.tools.map((tool) => tool.name);
  const expectedNames = [
    "glob",
    "grep",
    "read",
    "officecli",
    "workspace_status",
    "diff",
    "ask_user",
    "officecli_mutate",
    "edit",
    "write",
    "apply_patch",
    "bash",
  ];
  if (JSON.stringify(toolNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`unexpected tool order/names: ${JSON.stringify(toolNames)}`);
  }
  for (const forbidden of ["rg_files", "rg_search", "run_command", "office_search"]) {
    if (toolNames.includes(forbidden)) throw new Error(`forbidden tool was exposed: ${forbidden}`);
  }

  if (process.argv.includes("--update")) {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    console.log(`[agent-tool-catalog-smoke] snapshot updated ${fixturePath}`);
  } else {
    if (!existsSync(fixturePath)) {
      throw new Error(`missing fixture ${fixturePath}; run with --update after reviewing the catalog`);
    }
    compareJson(catalog, JSON.parse(readFileSync(fixturePath, "utf8")));
    console.log("[agent-tool-catalog-smoke] ok");
  }
} finally {
  child.kill("SIGTERM");
}
