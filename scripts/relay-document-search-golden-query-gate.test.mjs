import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const scriptPath = resolve(repoRoot, "scripts/relay-document-search-golden-query-gate.mjs");

test("Relay document search golden-query gate passes with privacy-safe report output", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-golden-test-"));
  try {
    const output = resolve(dir, "golden.md");
    const jsonOutput = resolve(dir, "golden.json");
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--output",
        output,
        "--json-output",
        jsonOutput,
        "--generated-at",
        "2026-05-11T00:00:00.000Z",
        "--max-latency-ms",
        "15000",
      ],
      { cwd: repoRoot, timeout: 60000 },
    );
    const result = JSON.parse(stdout.trim());
    const persisted = JSON.parse(readFileSync(jsonOutput, "utf8"));
    const report = readFileSync(output, "utf8");

    assert.equal(result.passed, true);
    assert.equal(persisted.passed, true);
    assert.equal(result.caseCount, 5);
    assert.equal(result.failedCaseCount, 0);
    assert.equal(result.expectedTopKCoverage, 1);
    assert.equal(result.forbiddenFalsePositiveCount, 0);
    assert.equal(result.unsupportedClaimFailureCount, 0);
    assert.equal(result.warningFailureCount, 0);
    assert.equal(result.latencyFailureCount, 0);
    assert.match(report, /Workspace Document Search Golden Queries/u);
    assert.match(report, /Temporary working directory pattern: `relay-wds09-golden-\*`/u);
    assert.doesNotMatch(report, /working capital movement/u);
    assert.doesNotMatch(report, /\/tmp\/relay-wds09-golden/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
