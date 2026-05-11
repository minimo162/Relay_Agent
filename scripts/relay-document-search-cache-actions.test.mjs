import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const filenameIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFilenameIndex.ts",
);
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const jobStorePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts",
);
const userMemoryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchUserMemory.ts",
);
const parsedDocumentIrPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
);
const parsedDocumentCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentCache.ts",
);
const derivedContentIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
);
const cacheActionsPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCacheActions.ts",
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

async function loadCacheActionsModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchFilenameIndex.mjs"),
    transpile(filenameIndexPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchJobStore.mjs"), transpile(jobStorePath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchUserMemory.mjs"),
    transpile(userMemoryPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayParsedDocumentIr.mjs"),
    transpile(parsedDocumentIrPath).replace(
      "from './relayDocumentSearchMetadataCache';",
      "from './relayDocumentSearchMetadataCache.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayParsedDocumentCache.mjs"),
    transpile(parsedDocumentCachePath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchDerivedContentIndex.mjs"),
    transpile(derivedContentIndexPath)
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchCacheActions.mjs"),
    transpile(cacheActionsPath)
      .replace("from './relayDocumentSearchFilenameIndex';", "from './relayDocumentSearchFilenameIndex.mjs';")
      .replace("from './relayDocumentSearchDerivedContentIndex';", "from './relayDocumentSearchDerivedContentIndex.mjs';")
      .replace("from './relayDocumentSearchJobStore';", "from './relayDocumentSearchJobStore.mjs';")
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchUserMemory';", "from './relayDocumentSearchUserMemory.mjs';")
      .replace("from './relayParsedDocumentCache';", "from './relayParsedDocumentCache.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchCacheActions.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function writeCacheFile(dir, file, content = "{}") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), content, "utf8");
}

function rootScopedCacheFileName(root) {
  return `${createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24)}.json`;
}

test("cache actions inspect and clear derived caches while preserving user memory and metadata", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-"));
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  const jobStoreDir = resolve(root, "jobs");
  const userMemoryDir = resolve(root, "user-memory");
  writeCacheFile(metadataCacheDir, "metadata.json");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(resolve(derivedContentIndexDir, "aa"), "derived.json");
  writeCacheFile(resolve(parsedDocumentCacheDir, "aa"), "parsed.json");
  writeCacheFile(jobStoreDir, "job.json");
  writeCacheFile(userMemoryDir, "user-memory.json");

  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const inspect = await module.runRelayDocumentSearchCacheAction("inspect", {
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir,
      userMemoryDir,
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });
    assert.equal(inspect.schemaVersion, "RelayDocumentSearchCacheActions.v1");
    assert.equal(inspect.ok, true);
    assert.equal(inspect.cancelled, false);
    assert.equal(inspect.before.find((store) => store.name === "filenameIndex").fileCount, 1);
    assert.equal(inspect.before.find((store) => store.name === "derivedContentIndex").contentBearing, true);
    assert.deepEqual(inspect.removedStores, []);

    const cleared = await module.runRelayDocumentSearchCacheAction("clear-derived-caches", {
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir,
      userMemoryDir,
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.cancelled, false);
    assert.deepEqual(cleared.removedStores.sort(), ["derivedContentIndex", "filenameIndex", "parsedDocumentCache"]);
    assert.ok(cleared.warnings.includes("metadata_user_memory_and_jobs_preserved"));
    assert.equal(cleared.after.find((store) => store.name === "filenameIndex").exists, false);
    assert.equal(cleared.after.find((store) => store.name === "derivedContentIndex").exists, false);
    assert.equal(cleared.after.find((store) => store.name === "parsedDocumentCache").exists, false);
    assert.equal(cleared.after.find((store) => store.name === "metadataCache").exists, true);
    assert.equal(cleared.after.find((store) => store.name === "userMemory").exists, true);
    assert.equal(cleared.after.find((store) => store.name === "jobStore").exists, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache actions refuse unsafe explicit paths unless tests opt in", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-unsafe-"));
  const filenameIndexDir = resolve(root, "filename-index");
  writeCacheFile(filenameIndexDir, "index.json");
  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const result = await module.runRelayDocumentSearchCacheAction("clear-filename-index", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir,
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      now: new Date("2026-05-09T00:00:00.000Z"),
    });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, false);
    assert.equal(result.removedStores.length, 0);
    assert.match(result.errors[0].message, /Refusing to remove unsafe cache path/);
    assert.equal(result.after.find((store) => store.name === "filenameIndex").exists, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache actions clear one root metadata and filename index without deleting shared stores", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-root-"));
  const workspaceA = resolve(root, "workspace-a");
  const workspaceB = resolve(root, "workspace-b");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  const workspaceBFile = rootScopedCacheFileName(workspaceB);
  writeCacheFile(metadataCacheDir, workspaceAFile);
  writeCacheFile(metadataCacheDir, `${workspaceAFile}.lock`);
  writeCacheFile(metadataCacheDir, workspaceBFile);
  writeCacheFile(filenameIndexDir, workspaceAFile);
  writeCacheFile(filenameIndexDir, workspaceBFile);
  writeCacheFile(resolve(root, "jobs"), "job.json");
  writeCacheFile(resolve(root, "user-memory"), "user-memory.json");

  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const result = await module.runRelayDocumentSearchCacheAction("clear-root-caches", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.removedStores.sort(), ["filenameIndex", "metadataCache"]);
    assert.ok(result.warnings.includes("root_metadata_and_filename_index_cleared"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(metadataCacheDir, `${workspaceAFile}.lock`)), false);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceBFile)), true);
    assert.equal(result.after.find((store) => store.name === "metadataCache").exists, true);
    assert.equal(result.after.find((store) => store.name === "filenameIndex").exists, true);
    assert.equal(result.after.find((store) => store.name === "jobStore").exists, true);
    assert.equal(result.after.find((store) => store.name === "userMemory").exists, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache actions remove one root caches after confirmation without deleting unrelated roots", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-remove-root-"));
  const workspaceA = resolve(root, "workspace-a");
  const workspaceB = resolve(root, "workspace-b");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  const jobStoreDir = resolve(root, "jobs");
  const userMemoryDir = resolve(root, "user-memory");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  const workspaceBFile = rootScopedCacheFileName(workspaceB);
  writeCacheFile(metadataCacheDir, workspaceAFile);
  writeCacheFile(metadataCacheDir, `${workspaceAFile}.lock`);
  writeCacheFile(metadataCacheDir, workspaceBFile);
  writeCacheFile(filenameIndexDir, workspaceAFile);
  writeCacheFile(filenameIndexDir, workspaceBFile);
  writeCacheFile(resolve(parsedDocumentCacheDir, "aa"), "a.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceA,
    fileId: "file-a",
    sourcePath: resolve(workspaceA, "a.docx"),
  }));
  writeCacheFile(resolve(parsedDocumentCacheDir, "aa"), "a.json.lock", "{}");
  writeCacheFile(resolve(parsedDocumentCacheDir, "bb"), "b.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceB,
    fileId: "file-b",
    sourcePath: resolve(workspaceB, "b.docx"),
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "aa"), "a.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "file-a",
    sourcePath: resolve(workspaceA, "a.docx"),
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "bb"), "b.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "file-b",
    sourcePath: resolve(workspaceB, "b.docx"),
  }));
  writeCacheFile(jobStoreDir, "job.json");
  writeCacheFile(userMemoryDir, "user-memory.json");

  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const result = await module.runRelayDocumentSearchCacheAction("remove-root-caches", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir,
      userMemoryDir,
      confirmRootRemoval: true,
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.removedStores.sort(), [
      "derivedContentIndex",
      "filenameIndex",
      "metadataCache",
      "parsedDocumentCache",
    ]);
    assert.equal(result.removedPathCounts.metadataCache, 2);
    assert.equal(result.removedPathCounts.filenameIndex, 1);
    assert.equal(result.removedPathCounts.parsedDocumentCache, 1);
    assert.equal(result.removedPathCounts.derivedContentIndex, 1);
    assert.ok(result.warnings.includes("root_scoped_caches_removed"));
    assert.ok(result.warnings.includes("unrelated_roots_user_memory_jobs_and_history_preserved"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(metadataCacheDir, `${workspaceAFile}.lock`)), false);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "aa", "a.json")), false);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "aa", "a.json.lock")), false);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "aa", "a.json")), false);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "bb", "b.json")), true);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "bb", "b.json")), true);
    assert.equal(result.after.find((store) => store.name === "jobStore").exists, true);
    assert.equal(result.after.find((store) => store.name === "userMemory").exists, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache actions require explicit confirmation before root removal", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-remove-root-confirm-"));
  const workspaceA = resolve(root, "workspace-a");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  writeCacheFile(metadataCacheDir, workspaceAFile);

  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const result = await module.runRelayDocumentSearchCacheAction("remove-root-caches", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir: resolve(root, "filename-index"),
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.removedStores, []);
    assert.deepEqual(result.removedPathCounts, {});
    assert.ok(result.errors.some((error) => error.message === "root_removal_confirmation_required"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache actions stop before destructive work when cancellation is already requested", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-actions-cancel-"));
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");
  const controller = new AbortController();
  controller.abort();

  const { module, cleanup } = await loadCacheActionsModule();
  try {
    const result = await module.runRelayDocumentSearchCacheAction("clear-derived-caches", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      allowUnsafeCacheDirForTests: true,
      signal: controller.signal,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.removedStores, []);
    assert.ok(result.warnings.includes("operation_cancelled"));
    assert.equal(result.after.find((store) => store.name === "filenameIndex").exists, true);
    assert.equal(result.after.find((store) => store.name === "derivedContentIndex").exists, true);
    assert.equal(result.after.find((store) => store.name === "parsedDocumentCache").exists, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
