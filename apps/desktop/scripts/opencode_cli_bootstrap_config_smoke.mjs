#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const manifestPath = resolve(appRoot, "src-tauri/bootstrap/openwork-opencode.json");
const installScript = resolve(scriptDir, "install_opencode_provider_config.mjs");

function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function bootstrappedEntrypointPath(cacheRoot, artifact) {
  return join(
    cacheRoot,
    "windows-x64",
    "opencode-cli",
    artifact.version,
    "extracted",
    artifact.entrypoint,
  );
}

function writeFakeOpencodeBin(path, version) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      `  console.log('opencode ${version}');`,
      "  process.exit(0);",
      "}",
      "console.error('fake opencode only supports --version in bootstrap smoke');",
      "process.exit(2);",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(path, 0o755);
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `command failed: node ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

const manifest = loadManifest();
const opencode = manifest.platforms?.["windows-x64"]?.opencodeCli;
assert.ok(opencode, "windows-x64 opencodeCli artifact is required");
assert.equal(opencode.entrypoint, "opencode.exe");
assert.match(opencode.sha256, /^[a-f0-9]{64}$/);

const root = mkdtempSync(join(tmpdir(), "relay-opencode-bootstrap-config-smoke-"));
const cacheRoot = join(root, "app-local-data", "openwork-opencode-bootstrap");
const workspace = join(root, "workspace");
const tokenFile = join(root, "provider-token");
const opencodeBin = bootstrappedEntrypointPath(cacheRoot, opencode);

writeFakeOpencodeBin(opencodeBin, opencode.version);

const versionProbe = spawnSync(opencodeBin, ["--version"], {
  encoding: "utf8",
});
assert.equal(versionProbe.status, 0);
assert.equal(versionProbe.stdout.trim(), `opencode ${opencode.version}`);

const install = runNode(
  [
    installScript,
    "--workspace",
    workspace,
    "--opencode-bin",
    opencodeBin,
  ],
  {
    RELAY_OPENCODE_PROVIDER_TOKEN_FILE: tokenFile,
    RELAY_OPENCODE_PROVIDER_PORT: "18180",
  },
);

assert.match(install.stdout, /opencode bin:/);
assert.match(install.stdout, new RegExp(`opencode ${opencode.version}`));

const config = JSON.parse(readFileSync(join(workspace, "opencode.json"), "utf8"));
assert.deepEqual(config.enabled_providers, ["relay-agent"]);
assert.equal(
  config.provider["relay-agent"].options.baseURL,
  "http://127.0.0.1:18180/v1",
);
assert.equal(config.provider["relay-agent"].models["m365-copilot"].name, "M365 Copilot");

const serialized = JSON.stringify(config);
assert.doesNotMatch(serialized, /experimental\/tool\/execute/);
assert.doesNotMatch(serialized, /opencode-runtime/);

console.log(
  JSON.stringify(
    {
      ok: true,
      opencodeBin,
      workspace,
      model: "relay-agent/m365-copilot",
    },
    null,
    2,
  ),
);
