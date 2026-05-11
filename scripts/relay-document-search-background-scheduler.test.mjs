import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
);
const backgroundSchedulerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchBackgroundScheduler.ts",
);

function transpile(path) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText),
    [],
  );
  return compiled.outputText;
}

async function loadBackgroundSchedulerModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-background-scheduler-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchBackgroundScheduler.mjs"),
    transpile(backgroundSchedulerPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchBackgroundScheduler.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function tick() {
  return new Promise((resolveTick) => setImmediate(resolveTick));
}

test("background scheduler runs promoted work with per-root backpressure", async () => {
  const { module, cleanup } = await loadBackgroundSchedulerModule();
  try {
    const scheduler = new module.RelayDocumentSearchBackgroundScheduler({
      paused: true,
      maxConcurrentJobs: 2,
      perRootConcurrency: 1,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    const releases = new Map();
    const starts = [];
    const runner = async (work) => {
      starts.push(work.workId);
      await new Promise((resolveRun) => releases.set(work.workId, resolveRun));
      return {
        status: "ok",
        jobId: work.jobId,
        progress: { stage: "background_indexed", percent: 100, scannedFiles: 1, skippedFiles: 0 },
      };
    };

    scheduler.enqueue(
      { workId: "work-idle-a", jobId: "job-idle-a", roots: ["/workspace/a"], priority: "idle" },
      runner,
    );
    scheduler.enqueue(
      { workId: "work-idle-b", jobId: "job-idle-b", roots: ["/workspace/a"], priority: "idle" },
      runner,
    );
    scheduler.enqueue(
      { workId: "work-query", jobId: "job-query", roots: ["/workspace/b"], priority: "normal" },
      runner,
    );
    scheduler.promote("work-query", "query_related_stale_file");

    const paused = scheduler.snapshot();
    assert.equal(paused.state, "paused");
    assert.equal(paused.queueDepth, 3);
    assert.equal(paused.items[0].workId, "work-query");
    assert.equal(paused.items[0].promotionReason, "query_related_stale_file");

    scheduler.resume();
    await tick();
    assert.deepEqual(starts, ["work-query", "work-idle-a"]);

    const running = scheduler.snapshot();
    assert.equal(running.activeJobCount, 2);
    assert.equal(running.queueDepth, 1);
    assert.equal(running.state, "throttled");
    assert.equal(running.throttledRoots.includes(resolve("/workspace/a")), true);
    assert.equal(
      running.roots
        .find((root) => root.root === resolve("/workspace/a"))
        .reasons.includes("per_root_concurrency_limit_reached"),
      true,
    );

    releases.get("work-query")();
    releases.get("work-idle-a")();
    await tick();
    await tick();
    assert.deepEqual(starts, ["work-query", "work-idle-a", "work-idle-b"]);

    releases.get("work-idle-b")();
    const drained = await scheduler.drain();
    assert.equal(drained.state, "clear");
    assert.equal(drained.completedJobCount, 3);
    assert.equal(drained.queueDepth, 0);
    assert.deepEqual(
      drained.items.map((item) => [item.workId, item.lifecycle]),
      [
        ["work-query", "completed"],
        ["work-idle-a", "completed"],
        ["work-idle-b", "completed"],
      ],
    );
  } finally {
    cleanup();
  }
});

test("background scheduler cancels queued and running work", async () => {
  const { module, cleanup } = await loadBackgroundSchedulerModule();
  try {
    const scheduler = new module.RelayDocumentSearchBackgroundScheduler({
      paused: true,
      maxConcurrentJobs: 1,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    let runnerCount = 0;

    scheduler.enqueue({ workId: "work-queued", roots: ["/workspace"] }, async () => {
      runnerCount += 1;
    });
    assert.equal(scheduler.requestCancel("work-queued"), true);
    scheduler.resume();
    await scheduler.drain();
    assert.equal(runnerCount, 0);
    assert.equal(scheduler.snapshot().cancelledJobCount, 1);

    let abortSeen = false;
    scheduler.enqueue({ workId: "work-running", roots: ["/workspace"] }, async (_work, { signal }) => {
      runnerCount += 1;
      await new Promise((resolveRun) => {
        signal.addEventListener(
          "abort",
          () => {
            abortSeen = true;
            resolveRun();
          },
          { once: true },
        );
      });
    });
    await tick();
    assert.equal(runnerCount, 1);
    assert.equal(scheduler.requestCancel("work-running"), true);

    const drained = await scheduler.drain();
    assert.equal(abortSeen, true);
    assert.equal(drained.cancelledJobCount, 2);
    assert.equal(drained.items.find((item) => item.workId === "work-running").lifecycle, "cancelled");
  } finally {
    cleanup();
  }
});
