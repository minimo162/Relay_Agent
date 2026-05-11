import assert from "node:assert/strict";
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
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const parsedDocumentIrPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
);
const derivedContentIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
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

async function loadDerivedContentIndexModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-derived-content-index-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayParsedDocumentIr.mjs"),
    transpile(parsedDocumentIrPath).replace(
      "from './relayDocumentSearchMetadataCache';",
      "from './relayDocumentSearchMetadataCache.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchDerivedContentIndex.mjs"),
    transpile(derivedContentIndexPath)
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  try {
    return {
      parsed: await import(pathToFileURL(resolve(dir, "relayParsedDocumentIr.mjs")).href),
      derived: await import(pathToFileURL(resolve(dir, "relayDocumentSearchDerivedContentIndex.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function fileMetadata(extension = "csv") {
  return {
    fileId: "file-derived",
    root: "/workspace",
    path: `/workspace/cfs.${extension}`,
    displayPath: `cfs.${extension}`,
    name: `cfs.${extension}`,
    extension,
    size: 64,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: "file-derived:64:1",
  };
}

test("Derived content index builds preview anchors from ParsedDocument text and tables", async () => {
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const parsedDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata(),
      "項目,金額\nキャッシュフロー計算書,100",
    );
    const index = derived.buildRelayDocumentSearchDerivedContentIndex(parsedDocument);

    assert.equal(index.schemaVersion, "RelayDocumentSearchDerivedContentIndex.v1");
    assert.equal(index.source_file_id, "file-derived");
    assert.equal(index.parsed_document_version, "relay-ir-v1");
    assert.equal(index.diagnostics.textEntryCount > 0, true);
    assert.equal(index.diagnostics.tableCellEntryCount > 0, true);
    assert.equal(index.diagnostics.previewAnchorCount, index.entries.length);
    assert.equal(index.diagnostics.structureProfile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(index.diagnostics.structureProfile.status, "valid");
    assert.equal(index.diagnostics.structureProfile.tableCount, 1);
    assert.equal(index.diagnostics.structureProfile.cellCount, 4);

    const cell = index.entries.find((entry) =>
      entry.entry_kind === "table_cell" && /キャッシュフロー計算書/.test(entry.preview.snippet)
    );
    assert.ok(cell);
    assert.equal(cell.preview.schemaVersion, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(cell.preview.kind, "table_cell");
    assert.match(cell.preview.snippet, /キャッシュフロー計算書/);
  } finally {
    cleanup();
  }
});

test("Derived content index searches normalized terms and returns capped anchors", async () => {
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const parsedDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata("md"),
      ["# CFS キャッシュフロー計算書", "作成資料", "精算表"].join("\n"),
    );
    const index = derived.buildRelayDocumentSearchDerivedContentIndex(parsedDocument);
    const result = derived.searchRelayDocumentSearchDerivedContentIndex(index, ["キャッシュフロー", "cfs"], {
      maxAnchors: 1,
    });

    assert.equal(result.schemaVersion, "RelayDocumentSearchDerivedContentIndex.v1");
    assert.equal(result.anchors.length, 1);
    assert.equal(result.preview_spans.length, 1);
    assert.equal(result.diagnostics.returnedAnchorCount, 1);
    assert.equal(result.diagnostics.returnedPreviewSpanCount, 1);
    assert.equal(result.diagnostics.matchedEntryCount >= 1, true);
    assert.equal(result.anchors[0].preview_anchor_contract, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(result.anchors[0].preview_span.schemaVersion, "RelayDocumentSearchPreviewSpan.v1");
    assert.equal(result.preview_spans[0].schemaVersion, "RelayDocumentSearchPreviewSpan.v1");
    assert.equal(result.preview_spans[0].entry_id, result.matches[0].entry.entry_id);
    assert.equal(result.preview_spans[0].highlights.some((highlight) => highlight.term === "cfs"), true);
    assert.deepEqual(result.anchors[0].matchedTerms.sort(), ["cfs", "キャッシュフロー"].sort());
    assert.match(result.anchors[0].snippet, /キャッシュフロー計算書/);

    const searchStore = derived.buildRelayDocumentSearchDerivedSearchStore(index);
    const storeResult = derived.searchRelayDocumentSearchDerivedSearchStore(searchStore, ["キャッシュフロー", "cfs"], {
      maxAnchors: 1,
    });
    assert.equal(searchStore.schemaVersion, "RelayDocumentSearchDerivedSearchStore.v1");
    assert.equal(searchStore.diagnostics.rowCount, index.entries.length);
    assert.equal(searchStore.diagnostics.previewSpanSeedCount, index.entries.length);
    assert.equal(searchStore.diagnostics.structureProfileStatus, "valid");
    assert.equal(storeResult.schemaVersion, "RelayDocumentSearchDerivedSearchStore.v1");
    assert.equal(storeResult.preview_spans[0].schemaVersion, "RelayDocumentSearchPreviewSpan.v1");
    assert.equal(storeResult.diagnostics.returnedPreviewSpanCount, 1);
  } finally {
    cleanup();
  }
});

test("Derived content index does not index invalid flattened ParsedDocument profiles", async () => {
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const parsedDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata("md"),
      "# CFS キャッシュフロー計算書",
    );
    const flattened = {
      ...parsedDocument,
      content: {
        structure: {
          ...parsedDocument.content.structure,
          text: "CFS キャッシュフロー計算書",
          subparagraphs: [],
        },
        tables: [],
      },
      warnings: [],
    };
    const index = derived.buildRelayDocumentSearchDerivedContentIndex(flattened);

    assert.equal(index.diagnostics.structureProfile.status, "invalid");
    assert.equal(index.diagnostics.structureProfile.errorCount > 0, true);
    assert.equal(index.entries.length, 0);
    assert.equal(index.diagnostics.previewAnchorCount, 0);
  } finally {
    cleanup();
  }
});

test("Derived content index cache commits through temp file swap and rejects stale source metadata", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-derived-content-index-cache-"));
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const parsedDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata("md"),
      "# CFS キャッシュフロー計算書",
    );
    const index = derived.buildRelayDocumentSearchDerivedContentIndex(parsedDocument);
    const written = await derived.writeRelayDocumentSearchDerivedContentIndexCache(parsedDocument, index, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(written.schemaVersion, "RelayDocumentSearchDerivedContentIndexCache.v1");
    assert.equal(written.cacheKeyVersion, "relay-derived-content-index-cache-key-v1");
    assert.equal(written.index.schemaVersion, "RelayDocumentSearchDerivedContentIndex.v1");
    assert.equal(written.searchStore.schemaVersion, "RelayDocumentSearchDerivedSearchStore.v1");
    assert.equal(written.searchStore.diagnostics.rowCount, index.entries.length);

    const hit = await derived.readRelayDocumentSearchDerivedContentIndexCache(parsedDocument, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(hit.index.entries.length, index.entries.length);
    assert.equal(hit.searchStore.rows.length, index.entries.length);

    const staleDocument = {
      ...parsedDocument,
      source_metadata_version: "file-derived:64:stale",
    };
    const stale = await derived.readRelayDocumentSearchDerivedContentIndexCache(staleDocument, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(stale, undefined);

    const aged = await derived.readRelayDocumentSearchDerivedContentIndexCache(parsedDocument, {
      cacheDir,
      maxAgeMs: 1,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    assert.equal(aged, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Derived content index cache stages records before active promotion", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-derived-content-index-cache-stage-"));
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const parsedDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata("md"),
      "# 段階コミット\nキャッシュフロー",
    );
    const index = derived.buildRelayDocumentSearchDerivedContentIndex(parsedDocument);
    const stage = await derived.stageRelayDocumentSearchDerivedContentIndexCache(parsedDocument, index, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(stage.schemaVersion, "RelayDocumentSearchDerivedContentIndexCacheStage.v1");
    assert.equal(existsSync(stage.stagingPath), true);
    assert.equal(existsSync(stage.activePath), false);
    const beforePromote = await derived.readRelayDocumentSearchDerivedContentIndexCache(parsedDocument, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(beforePromote, undefined);

    const promoted = await stage.promote();
    assert.equal(promoted.cacheKey, stage.cacheKey);
    assert.equal(promoted.searchStore.rows.length, index.entries.length);
    assert.equal(existsSync(stage.stagingPath), false);
    assert.equal(existsSync(stage.activePath), true);
    const hit = await derived.readRelayDocumentSearchDerivedContentIndexCache(parsedDocument, {
      cacheDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    assert.equal(hit.cacheKey, stage.cacheKey);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Derived content index cache enforces quota and protection policy", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-derived-content-index-cache-policy-"));
  const { parsed, derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const firstDocument = parsed.parseTextToRelayParsedDocument(
      fileMetadata("md"),
      "# 古いキャッシュ\nキャッシュフロー",
    );
    const firstIndex = derived.buildRelayDocumentSearchDerivedContentIndex(firstDocument);
    await derived.writeRelayDocumentSearchDerivedContentIndexCache(firstDocument, firstIndex, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
      maxCacheEntries: 2,
    });

    const secondFile = {
      ...fileMetadata("md"),
      fileId: "file-derived-new",
      path: "/workspace/new.md",
      displayPath: "new.md",
      name: "new.md",
      sourceMetadataVersion: "file-derived-new:64:1",
    };
    const secondDocument = parsed.parseTextToRelayParsedDocument(secondFile, "# 新しいキャッシュ");
    const secondIndex = derived.buildRelayDocumentSearchDerivedContentIndex(secondDocument);
    const quotaSeen = [];
    await derived.writeRelayDocumentSearchDerivedContentIndexCache(secondDocument, secondIndex, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
      maxCacheEntries: 1,
      onQuota: (quota) => quotaSeen.push(quota),
    });

    assert.equal(quotaSeen.length, 1);
    assert.equal(quotaSeen[0].entryCount, 1);
    assert.equal(quotaSeen[0].evicted.length, 1);
    assert.equal(quotaSeen[0].evicted[0].reason, "entry_quota");

    const oldHit = await derived.readRelayDocumentSearchDerivedContentIndexCache(firstDocument, {
      cacheDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    assert.equal(oldHit, undefined);

    const policies = [];
    const blocked = await derived.writeRelayDocumentSearchDerivedContentIndexCache(secondDocument, secondIndex, {
      cacheDir,
      cacheProtectionMode: "protection_required",
      protectedAtRest: false,
      onPolicy: (policy) => policies.push(policy),
    });
    assert.equal(blocked, undefined);
    assert.equal(policies.at(-1).schemaVersion, "RelayDocumentSearchDerivedContentIndexCachePolicy.v1");
    assert.equal(policies.at(-1).writeAllowed, false);
    assert.equal(policies.at(-1).reason, "protection_required_but_unavailable");
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Derived index ownership report transfers only high-confidence moves on rebuild", async () => {
  const { derived, cleanup } = await loadDerivedContentIndexModule();
  try {
    const report = derived.buildRelayDocumentSearchDerivedIndexOwnershipReport([
      {
        schemaVersion: "RelayDocumentSearchFreshness.v1",
        root: "/workspace",
        generated_at: "2026-05-10T00:00:00.000Z",
        checked_file_count: 2,
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
            file_id: "old-file-id",
            display_path: "new/report.xlsx",
            reason: "moved",
            previous_file_id: "old-file-id",
            current_file_id: "new-file-id",
            previous_path: "/workspace/old/report.xlsx",
            current_path: "/workspace/new/report.xlsx",
            previous_source_metadata_version: "old-v1",
            current_source_metadata_version: "new-v1",
            access_changed_actions: [],
            access_warning_codes: [],
            move_confidence: "high",
            tombstone: true,
            access_stale: false,
            access_unavailable: false,
            content_stale: true,
          },
          {
            file_id: "created-file-id",
            display_path: "created.xlsx",
            reason: "created",
            access_changed_actions: [],
            access_warning_codes: [],
            tombstone: false,
            access_stale: false,
            access_unavailable: false,
            content_stale: true,
          },
        ],
      },
    ]);

    assert.equal(report.schemaVersion, "RelayDocumentSearchDerivedIndexOwnership.v1");
    assert.equal(report.highConfidenceMoveCount, 1);
    assert.equal(report.transferOnRebuildCount, 1);
    assert.equal(report.cacheReuseAllowedCount, 0);
    assert.equal(report.moves[0].ownership_owner_file_id, "new-file-id");
    assert.equal(report.moves[0].ownership_action, "transfer_on_rebuild");
    assert.equal(report.moves[0].cache_reuse_allowed, false);
    assert.equal(report.ai_boundary.extractedContentIncluded, false);
  } finally {
    cleanup();
  }
});
