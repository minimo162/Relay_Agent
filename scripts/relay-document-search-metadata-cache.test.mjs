import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
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

async function loadMetadataCacheModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-metadata-cache-module-"));
  const modulePath = resolve(dir, "relayDocumentSearchMetadataCache.mjs");
  writeFileSync(modulePath, transpile(metadataCachePath), "utf8");
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

function cachePathForRoot(root, cacheDir) {
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
  return resolve(cacheDir, `${hash}.json`);
}

function cachedFile(root) {
  return {
    fileId: "file-1",
    root: resolve(root),
    path: resolve(root, "memo.md"),
    displayPath: "memo.md",
    name: "memo.md",
    extension: "md",
    size: 10,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: "file-1:10:1",
    accessSnapshots: {
      metadata: {
        action: "metadata",
        state: "ok",
        checkedAt: "2026-05-09T00:00:00.000Z",
      },
      content: {
        action: "content",
        state: "access_denied",
        checkedAt: "2026-05-09T00:00:00.000Z",
        warningCode: "access_denied",
      },
    },
  };
}

test("Relay document search metadata cache persists discovery metadata only", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-root-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-store-"));
  const { module, cleanup } = await loadMetadataCacheModule();
  try {
    const written = await module.writeRelayDocumentSearchMetadataCache(
      root,
      [cachedFile(root)],
      { truncated: false, inaccessiblePathCount: 0 },
      { cacheDir, now: new Date("2026-05-09T00:00:00.000Z") },
    );
    assert.equal(written.schemaVersion, "RelayDocumentSearchMetadataCache.v1");
    assert.equal(written.stats.fileCount, 1);

    const read = await module.readRelayDocumentSearchMetadataCache(root, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(read.files[0].name, "memo.md");
    assert.equal(read.files[0].sourceMetadataVersion, "file-1:10:1");
    assert.equal(read.files[0].accessSnapshots.metadata.state, "ok");
    assert.equal(read.files[0].accessSnapshots.content.warningCode, "access_denied");
    assert.equal(read.files[0].content, undefined);
    assert.equal(read.parsedDocument, undefined);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay document search metadata cache recovers stale single-writer locks", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-lock-root-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-lock-store-"));
  const lockPath = `${cachePathForRoot(root, cacheDir)}.lock`;
  writeFileSync(
    lockPath,
    JSON.stringify({
      schemaVersion: "RelayDocumentSearchMetadataCacheLock.v1",
      pid: 1,
      createdAt: "2026-05-09T00:00:00.000Z",
    }),
    "utf8",
  );

  const { module, cleanup } = await loadMetadataCacheModule();
  try {
    const written = await module.writeRelayDocumentSearchMetadataCache(
      root,
      [cachedFile(root)],
      { truncated: false, inaccessiblePathCount: 0 },
      {
        cacheDir,
        lockStaleMs: 1,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );
    assert.equal(written.stats.fileCount, 1);
    assert.equal(existsSync(lockPath), false);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay document search metadata cache opens newer durable records read-only", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-downgrade-root-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-downgrade-store-"));
  const cachePath = cachePathForRoot(root, cacheDir);
  writeFileSync(
    cachePath,
    JSON.stringify({
      schemaVersion: "RelayDocumentSearchMetadataCache.v1",
      cacheVersion: 99,
      root: resolve(root),
      generatedAt: "2026-05-09T00:00:00.000Z",
      files: [],
      stats: { fileCount: 0, truncated: false, inaccessiblePathCount: 0 },
    }),
    "utf8",
  );

  const { module, cleanup } = await loadMetadataCacheModule();
  try {
    const migration = await module.inspectRelayDocumentSearchMetadataCacheMigration(root, { cacheDir });
    assert.equal(migration.schemaVersion, "RelayDocumentSearchMetadataCacheMigration.v1");
    assert.equal(migration.status, "read_only_downgrade");
    assert.equal(migration.readOnly, true);
    assert.equal(migration.detectedCacheVersion, 99);
    await assert.rejects(
      () => module.writeRelayDocumentSearchMetadataCache(
        root,
        [cachedFile(root)],
        { truncated: false, inaccessiblePathCount: 0 },
        { cacheDir },
      ),
      /metadata_cache_read_only_downgrade/,
    );
    const preserved = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.equal(preserved.cacheVersion, 99);
    assert.equal(preserved.files.length, 0);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
