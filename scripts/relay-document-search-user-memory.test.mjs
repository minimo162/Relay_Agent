import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const userMemoryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchUserMemory.ts",
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

async function loadUserMemoryModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchUserMemory.mjs"),
    transpile(userMemoryPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchUserMemory.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function file(root, displayPath, name) {
  return {
    fileId: `file-${name}`,
    root,
    path: resolve(root, displayPath),
    displayPath,
    name,
    extension: "xlsx",
    size: 100,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: `source-${name}`,
  };
}

test("user memory stores pins and recent searches without document contents", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-root-")));
  const memoryDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-store-"));
  const { module, cleanup } = await loadUserMemoryModule();
  try {
    let memory = module.emptyRelayDocumentSearchUserMemory({ now: new Date("2026-05-09T00:00:00.000Z") });
    memory = module.withRelayDocumentSearchPinnedTarget(
      memory,
      {
        kind: "folder",
        path: resolve(root, "作業"),
        label: "CFS作業",
        createdAt: "2026-05-09T00:00:00.000Z",
      },
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );
    memory = module.withRelayDocumentSearchRecentSearch(
      memory,
      {
        query: "キャッシュフロー CFS",
        normalizedTerms: ["キャッシュフロー", "cfs"],
        roots: [root],
        fileTypes: ["xlsx"],
        resultFileIds: ["file-FY160-1Q_連結CFS精算表.xlsx"],
        resultPaths: [resolve(root, "作業/FY160-1Q_連結CFS精算表.xlsx")],
      },
      { now: new Date("2026-05-09T00:01:00.000Z") },
    );
    await module.writeRelayDocumentSearchUserMemory(memory, {
      memoryDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });

    const reloaded = await module.readRelayDocumentSearchUserMemory({ memoryDir });
    assert.equal(reloaded.schemaVersion, "RelayDocumentSearchUserMemory.v1");
    assert.equal(reloaded.normalizerVersion, "relay-query-normalizer-v1");
    assert.equal(reloaded.pins.length, 1);
    assert.equal(reloaded.recentSearches.length, 1);
    assert.equal(JSON.stringify(reloaded).includes("キャッシュフロー計算書の本文"), false);

    const boost = module.relayDocumentSearchUserMemoryBoostForFile(
      file(root, "作業/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx"),
      reloaded,
    );
    assert.equal(boost.score, 5);
    assert.deepEqual(boost.reasons, ["pin:folder:4", "history:recent-result:1"]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(memoryDir, { recursive: true, force: true });
  }
});

test("user memory migrates pins and history only for high-confidence moves", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-move-root-")));
  const { module, cleanup } = await loadUserMemoryModule();
  try {
    let memory = module.emptyRelayDocumentSearchUserMemory({ now: new Date("2026-05-09T00:00:00.000Z") });
    const previousPath = resolve(root, "old/FY160-1Q_連結CFS精算表.xlsx");
    const currentPath = resolve(root, "new/FY160-1Q_連結CFS精算表.xlsx");
    memory = module.withRelayDocumentSearchPinnedTarget(
      memory,
      {
        kind: "file",
        path: previousPath,
        label: "CFS file",
        createdAt: "2026-05-09T00:00:00.000Z",
      },
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );
    memory = module.withRelayDocumentSearchPinnedTarget(
      memory,
      {
        kind: "folder",
        path: resolve(root, "old"),
        label: "old folder",
        createdAt: "2026-05-09T00:00:00.000Z",
      },
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );
    memory = module.withRelayDocumentSearchRecentSearch(
      memory,
      {
        query: "CFS",
        normalizedTerms: ["cfs"],
        roots: [root],
        fileTypes: ["xlsx"],
        resultFileIds: ["stable-file-id"],
        resultPaths: [previousPath],
      },
      { now: new Date("2026-05-09T00:01:00.000Z") },
    );

    const migrated = module.applyRelayDocumentSearchMoveFreshnessToUserMemory(
      memory,
      [
        {
          schemaVersion: "RelayDocumentSearchFreshness.v1",
          root,
          generated_at: "2026-05-10T00:00:00.000Z",
          checked_file_count: 1,
          unchanged_file_count: 0,
          created_file_count: 0,
          modified_file_count: 0,
          deleted_file_count: 0,
          moved_file_count: 1,
          access_changed_file_count: 0,
          access_unavailable_file_count: 0,
          tombstone_count: 1,
          content_stale_file_count: 1,
          ai_boundary: {
            localMetadataOnly: true,
            extractedContentIncluded: false,
            originalFilesIncluded: false,
          },
          changes: [
            {
              file_id: "stable-file-id",
              display_path: "new/FY160-1Q_連結CFS精算表.xlsx",
              path: currentPath,
              reason: "moved",
              previous_path: previousPath,
              current_path: currentPath,
              previous_file_id: "stable-file-id",
              current_file_id: "new-file-id",
              access_changed_actions: [],
              access_warning_codes: [],
              move_confidence: "high",
              tombstone: true,
              access_stale: false,
              access_unavailable: false,
              content_stale: true,
            },
          ],
        },
      ],
      { now: new Date("2026-05-10T00:00:00.000Z") },
    );

    assert.equal(migrated.report.schemaVersion, "RelayDocumentSearchUserMemoryMoveMigration.v1");
    assert.equal(migrated.report.highConfidenceMoveCount, 1);
    assert.equal(migrated.report.migratedPinCount, 1);
    assert.equal(migrated.report.migratedRecentSearchCount, 1);
    assert.equal(migrated.record.pins.find((pin) => pin.kind === "file").path, currentPath);
    assert.equal(migrated.record.pins.find((pin) => pin.kind === "folder").path, resolve(root, "old"));
    assert.deepEqual(migrated.record.recentSearches[0].resultPaths, [currentPath]);
    assert.deepEqual(migrated.record.recentSearches[0].resultFileIds, ["new-file-id"]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
