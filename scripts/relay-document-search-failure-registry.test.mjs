import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const failureRegistryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFailureRegistry.ts",
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

async function loadFailureRegistryModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-failure-registry-module-"));
  const modulePath = resolve(dir, "relayDocumentSearchFailureRegistry.mjs");
  writeFileSync(modulePath, transpile(failureRegistryPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(modulePath).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("failure registry records capped metadata-only file failures", async () => {
  const registryDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-failure-registry-"));
  const workspace = resolve(registryDir, "workspace");
  const filePath = resolve(workspace, "Finance Report.docx");
  const longMessage = "x".repeat(500);
  const { module, cleanup } = await loadFailureRegistryModule();
  try {
    await module.recordRelayDocumentSearchFailure(
      {
        root: workspace,
        path: filePath,
        displayPath: "Finance Report.docx",
        fileId: "file-1",
        kind: "parser",
        code: "docx_parse_failed",
        message: longMessage,
        source: "parsed-document-cache",
      },
      {
        failureRegistryDir: registryDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    const registry = await module.recordRelayDocumentSearchFailure(
      {
        root: workspace,
        path: filePath,
        displayPath: "Finance Report.docx",
        fileId: "file-1",
        kind: "parser",
        code: "docx_parse_failed",
        message: "repeat failure",
        source: "parsed-document-cache",
      },
      {
        failureRegistryDir: registryDir,
        now: new Date("2026-05-10T00:01:00.000Z"),
      },
    );

    assert.equal(registry.schemaVersion, "RelayDocumentSearchFailureRegistry.v1");
    assert.equal(registry.failures.length, 1);
    assert.equal(registry.failures[0].root, workspace);
    assert.equal(registry.failures[0].path, filePath);
    assert.equal(typeof registry.failures[0].pathHash, "string");
    assert.equal(registry.failures[0].message, "repeat failure");
    assert.equal(registry.failures[0].attemptCount, 2);
    assert.equal(registry.failures[0].retryRequestedCount, 0);
    assert.equal(registry.failures[0].firstFailedAt, "2026-05-10T00:00:00.000Z");
    assert.equal(registry.failures[0].lastFailedAt, "2026-05-10T00:01:00.000Z");
    assert.equal(registry.ai_boundary.extractedContentIncluded, false);
    assert.equal(JSON.stringify(registry).includes("SECRET BODY TEXT"), false);
  } finally {
    cleanup();
    rmSync(registryDir, { recursive: true, force: true });
  }
});

test("failure registry builds root-scoped retry plans and marks requested failures", async () => {
  const registryDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-failure-retry-"));
  const workspaceA = resolve(registryDir, "workspace-a");
  const workspaceB = resolve(registryDir, "workspace-b");
  const { module, cleanup } = await loadFailureRegistryModule();
  try {
    await module.recordRelayDocumentSearchFailure(
      {
        root: workspaceA,
        path: resolve(workspaceA, "a.xlsx"),
        kind: "content",
        code: "content_extract_failed",
      },
      {
        failureRegistryDir: registryDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    await module.recordRelayDocumentSearchFailure(
      {
        root: workspaceB,
        path: resolve(workspaceB, "b.pdf"),
        kind: "access",
        code: "access_denied",
      },
      {
        failureRegistryDir: registryDir,
        now: new Date("2026-05-10T00:01:00.000Z"),
      },
    );

    const emptyPlan = await module.requestRelayDocumentSearchFailedFileRetries({
      root: resolve(registryDir, "workspace-c"),
      failureRegistryDir: registryDir,
      now: new Date("2026-05-10T00:02:00.000Z"),
    });
    assert.equal(emptyPlan.failedFileCount, 0);
    assert.deepEqual(emptyPlan.warnings, ["failed_file_registry_empty"]);

    const plan = await module.requestRelayDocumentSearchFailedFileRetries({
      root: workspaceA,
      failureRegistryDir: registryDir,
      maxFailures: 1,
      now: new Date("2026-05-10T00:03:00.000Z"),
    });
    assert.equal(plan.schemaVersion, "RelayDocumentSearchFailedFileRetryPlan.v1");
    assert.equal(plan.root, workspaceA);
    assert.equal(plan.failedFileCount, 1);
    assert.equal(plan.selectedFailureCount, 1);
    assert.equal(plan.selectedFailures[0].root, workspaceA);
    assert.equal(plan.selectedFailures[0].code, "content_extract_failed");
    assert.equal(plan.ai_boundary.originalFilesIncluded, false);

    const registry = await module.readRelayDocumentSearchFailureRegistry({
      failureRegistryDir: registryDir,
    });
    const workspaceAFailure = registry.failures.find((failure) => failure.root === workspaceA);
    const workspaceBFailure = registry.failures.find((failure) => failure.root === workspaceB);
    assert.equal(workspaceAFailure.retryRequestedCount, 1);
    assert.equal(workspaceAFailure.lastRetryRequestedAt, "2026-05-10T00:03:00.000Z");
    assert.equal(workspaceBFailure.retryRequestedCount, 0);
  } finally {
    cleanup();
    rmSync(registryDir, { recursive: true, force: true });
  }
});

test("failure registry executes per-file retry invalidation without deleting unrelated caches", async () => {
  const registryDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-failure-execution-"));
  const workspaceA = resolve(registryDir, "workspace-a");
  const workspaceB = resolve(registryDir, "workspace-b");
  const parsedCacheDir = resolve(registryDir, "parsed-document-cache");
  const derivedCacheDir = resolve(registryDir, "derived-content-index");
  const parsedAPath = resolve(parsedCacheDir, "aa", "parsed-a.json");
  const parsedBPath = resolve(parsedCacheDir, "bb", "parsed-b.json");
  const parsedALockPath = `${parsedAPath}.lock`;
  const derivedAPath = resolve(derivedCacheDir, "aa", "derived-a.json");
  const derivedBPath = resolve(derivedCacheDir, "bb", "derived-b.json");
  mkdirSync(resolve(parsedCacheDir, "aa"), { recursive: true });
  mkdirSync(resolve(parsedCacheDir, "bb"), { recursive: true });
  mkdirSync(resolve(derivedCacheDir, "aa"), { recursive: true });
  mkdirSync(resolve(derivedCacheDir, "bb"), { recursive: true });
  writeFileSync(parsedAPath, JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceA,
    fileId: "failed-file-a",
    sourcePath: resolve(workspaceA, "failed.docx"),
  }), "utf8");
  writeFileSync(parsedALockPath, "{}", "utf8");
  writeFileSync(parsedBPath, JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceB,
    fileId: "other-file-b",
    sourcePath: resolve(workspaceB, "other.docx"),
  }), "utf8");
  writeFileSync(derivedAPath, JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "failed-file-a",
    sourcePath: resolve(workspaceA, "failed.docx"),
  }), "utf8");
  writeFileSync(derivedBPath, JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "other-file-b",
    sourcePath: resolve(workspaceB, "other.docx"),
  }), "utf8");

  const { module, cleanup } = await loadFailureRegistryModule();
  try {
    await module.recordRelayDocumentSearchFailure(
      {
        root: workspaceA,
        path: resolve(workspaceA, "failed.docx"),
        fileId: "failed-file-a",
        kind: "parser",
        code: "docx_parse_failed",
      },
      {
        failureRegistryDir: registryDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    const plan = await module.requestRelayDocumentSearchFailedFileRetries({
      root: workspaceA,
      failureRegistryDir: registryDir,
      now: new Date("2026-05-10T00:01:00.000Z"),
    });
    const execution = await module.executeRelayDocumentSearchFailedFileRetries(plan, {
      parsedDocumentCacheDir: parsedCacheDir,
      derivedContentIndexDir: derivedCacheDir,
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:02:00.000Z"),
    });

    assert.equal(execution.schemaVersion, "RelayDocumentSearchFailedFileRetryExecution.v1");
    assert.equal(execution.targetFailureCount, 1);
    assert.equal(execution.invalidatedParsedDocumentCacheCount, 1);
    assert.equal(execution.invalidatedDerivedContentIndexCount, 1);
    assert.equal(execution.skippedMissingIdentityCount, 0);
    assert.ok(execution.warnings.includes("failed_file_retry_content_caches_invalidated"));
    assert.equal(existsSync(parsedAPath), false);
    assert.equal(existsSync(parsedALockPath), false);
    assert.equal(existsSync(derivedAPath), false);
    assert.equal(existsSync(parsedBPath), true);
    assert.equal(existsSync(derivedBPath), true);
  } finally {
    cleanup();
    rmSync(registryDir, { recursive: true, force: true });
  }
});
