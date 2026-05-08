import assert from "node:assert/strict";
import test from "node:test";

import {
  aionuiBinCandidates,
  aionuiLaunchEnv,
  bootstrapOfficeCliForLaunch,
  parseArgs,
  resolveAionuiBin,
} from "./start_aionui_relay_gateway.mjs";

function slashPath(path) {
  return String(path || "").replace(/\\/gu, "/");
}

test("AionUi launch args accept explicit shell path, seed printing, and OfficeCLI skip", () => {
  assert.deepEqual(parseArgs(["--print-seed", "--aionui-bin", "C:/Relay Agent/Relay Agent.exe", "--skip-officecli-bootstrap"]), {
    printSeed: true,
    aionuiBin: "C:/Relay Agent/Relay Agent.exe",
    skipOfficeCliBootstrap: true,
    help: false,
  });
});

test("AionUi Windows binary candidates prefer explicit env path then user-local install", () => {
  const candidates = aionuiBinCandidates({
    platform: "win32",
    env: {
      RELAY_AIONUI_BIN: "D:/Relay/Relay Agent.exe",
      LOCALAPPDATA: "C:/Users/example/AppData/Local",
      ProgramFiles: "C:/Program Files",
      "ProgramFiles(x86)": "C:/Program Files (x86)",
    },
  });
  const normalized = candidates.map(slashPath);

  assert.equal(normalized[0], "D:/Relay/Relay Agent.exe");
  assert.ok(normalized.includes("C:/Users/example/AppData/Local/Programs/Relay Agent/Relay Agent.exe"));
  assert.ok(normalized.includes("C:/Program Files/Relay Agent/Relay Agent.exe"));
});

test("AionUi binary resolution returns first existing candidate without requiring CLI args", () => {
  const existing = new Set(["usr/local/bin/relay-agent-aionui"]);
  const resolved = resolveAionuiBin(null, {
    platform: "linux",
    env: {},
    exists: (path) => existing.has(slashPath(path).replace(/^[A-Z]:\//iu, "").replace(/^\//u, "")),
  });

  assert.match(slashPath(resolved), /\/usr\/local\/bin\/relay-agent-aionui$/u);
});

test("AionUi launch env always passes Relay seed and prepends cached OfficeCLI when present", () => {
  const env = aionuiLaunchEnv({
    platform: "win32",
    seedFile: "C:/Users/example/.relay-agent/aionui-provider-seed.json",
    officeCliPath: "C:/Users/example/.relay-agent/tools/officecli/1.0.76/officecli.exe",
    baseEnv: {
      PATH: "C:/Windows/System32",
    },
    exists: () => true,
  });

  assert.equal(env.RELAY_AIONUI_PROVIDER_SEED_FILE, "C:/Users/example/.relay-agent/aionui-provider-seed.json");
  assert.equal(env.RELAY_OFFICECLI_PATH, "C:/Users/example/.relay-agent/tools/officecli/1.0.76/officecli.exe");
  assert.match(env.PATH, /^C:\/Users\/example\/\.relay-agent\/tools\/officecli\/1\.0\.76;/);
});

test("AionUi launch env records expected OfficeCLI path when it has not been downloaded yet", () => {
  const env = aionuiLaunchEnv({
    seedFile: "/tmp/seed.json",
    officeCliPath: "/tmp/missing-officecli",
    baseEnv: {
      PATH: "/usr/bin",
    },
    exists: () => false,
  });

  assert.equal(env.RELAY_AIONUI_PROVIDER_SEED_FILE, "/tmp/seed.json");
  assert.equal(env.RELAY_OFFICECLI_EXPECTED_PATH, "/tmp/missing-officecli");
  assert.equal(env.RELAY_OFFICECLI_PATH, undefined);
  assert.equal(env.PATH, "/usr/bin");
});

test("OfficeCLI bootstrap skips non-Windows hosts by default", async () => {
  const result = await bootstrapOfficeCliForLaunch({
    platform: "linux",
    download: async () => {
      throw new Error("should not download");
    },
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "non-windows-host");
  assert.match(result.path, /officecli/);
});

test("OfficeCLI bootstrap downloads and reports verified Windows artifact for launch", async () => {
  const result = await bootstrapOfficeCliForLaunch({
    platform: "win32",
    download: async () => ({
      reused: false,
      path: "C:/Users/example/.relay-agent/tools/officecli/1.0.76/officecli.exe",
      sha256: "a".repeat(64),
      size: 1234,
    }),
  });

  assert.equal(result.status, "ready-downloaded");
  assert.equal(result.path, "C:/Users/example/.relay-agent/tools/officecli/1.0.76/officecli.exe");
  assert.equal(result.sha256, "a".repeat(64));
  assert.equal(result.size, 1234);
});
