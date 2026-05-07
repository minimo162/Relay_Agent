import assert from "node:assert/strict";
import test from "node:test";

import {
  aionuiBinCandidates,
  aionuiLaunchEnv,
  parseArgs,
  resolveAionuiBin,
} from "./start_aionui_relay_gateway.mjs";

test("AionUi launch args accept explicit shell path and seed printing", () => {
  assert.deepEqual(parseArgs(["--print-seed", "--aionui-bin", "C:/Relay Agent/Relay Agent.exe"]), {
    printSeed: true,
    aionuiBin: "C:/Relay Agent/Relay Agent.exe",
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

  assert.equal(candidates[0], "D:/Relay/Relay Agent.exe");
  assert.ok(candidates.includes("C:/Users/example/AppData/Local/Programs/Relay Agent/Relay Agent.exe"));
  assert.ok(candidates.includes("C:/Program Files/Relay Agent/Relay Agent.exe"));
});

test("AionUi binary resolution returns first existing candidate without requiring CLI args", () => {
  const existing = new Set(["/usr/local/bin/relay-agent-aionui"]);
  const resolved = resolveAionuiBin(null, {
    platform: "linux",
    env: {},
    exists: (path) => existing.has(path),
  });

  assert.equal(resolved, "/usr/local/bin/relay-agent-aionui");
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
