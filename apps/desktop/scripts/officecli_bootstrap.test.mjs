import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  officeCliArtifact,
  officeCliBootstrapPlan,
  officeCliCachedPath,
  officeCliPathEnv,
  sha256File,
  verifyOfficeCliArtifactFile,
} from "./officecli_bootstrap.mjs";

test("OfficeCLI bootstrap plan is user-local and admin-free", () => {
  const plan = officeCliBootstrapPlan({
    cacheRoot: "C:/Users/example/AppData/Local/Relay Agent/tools/officecli",
  });

  assert.equal(plan.platform, "windows-x64");
  assert.equal(plan.version, "1.0.76");
  assert.equal(plan.requiresAdmin, false);
  assert.equal(plan.installMode, "relay-managed-portable-user-local");
  assert.equal(
    plan.url,
    "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.76/officecli-win-x64.exe",
  );
  assert.equal(plan.sha256, "f9e4895505858ab813e133d4d1f9f01004c7b4b08397408487f534caf9e2ec58");
  assert.match(plan.path, /OfficeCli|officecli/i);
  assert.match(plan.path, /1\.0\.76/);
  assert.match(plan.path, /officecli\.exe$/);
});

test("OfficeCLI path registration prepends the cache directory once", () => {
  const officeCliPath = "C:/Relay/tools/officecli/1.0.76/officecli.exe";
  const updated = officeCliPathEnv("C:/Windows/System32", officeCliPath, "win32");
  const repeated = officeCliPathEnv(updated, officeCliPath, "win32");

  assert.match(updated, /^C:\/Relay\/tools\/officecli\/1\.0\.76/);
  assert.equal(repeated, updated);
});

test("OfficeCLI cached path uses version and manifest entrypoint", () => {
  const artifact = officeCliArtifact();
  const cacheRoot = join(tmpdir(), "relay-officecli");
  assert.equal(
    officeCliCachedPath({ cacheRoot, artifact }),
    join(cacheRoot, "1.0.76", "officecli.exe"),
  );
});

test("OfficeCLI verifier checks size and sha256", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-officecli-verify-"));
  try {
    const file = join(dir, "officecli.exe");
    writeFileSync(file, "relay-officecli-test", "utf8");
    const sha256 = sha256File(file);

    const result = verifyOfficeCliArtifactFile(file, {
      size: "relay-officecli-test".length,
      sha256,
    });

    assert.equal(result.path, file);
    assert.equal(result.size, "relay-officecli-test".length);
    assert.equal(result.sha256, sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
