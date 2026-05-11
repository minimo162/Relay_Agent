import assert from "node:assert/strict";
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
const parsedDocumentIrPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
);
const parsedDocumentCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentCache.ts",
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

async function loadParsedDocumentCacheModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
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
  try {
    return {
      ir: await import(pathToFileURL(resolve(dir, "relayParsedDocumentIr.mjs")).href),
      cache: await import(pathToFileURL(resolve(dir, "relayParsedDocumentCache.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function fileMetadata(overrides = {}) {
  return {
    fileId: "file-cache",
    root: "/workspace",
    path: "/workspace/memo.md",
    displayPath: "memo.md",
    name: "memo.md",
    extension: "md",
    size: 48,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: "file-cache:48:1",
    ...overrides,
  };
}

test("Relay ParsedDocument cache reuses only matching source metadata and parser versions", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "キャッシュフロー計算書\n精算表");
    const written = await cache.writeRelayParsedDocumentCache(file, parsed, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(written.schemaVersion, "RelayParsedDocumentCache.v1");
    assert.match(written.cacheKey, /^[0-9a-f]{64}$/);
    assert.equal(written.parsedDocument.metadata.file_name, "memo.md");

    const hit = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(hit.parsedDocument.source_metadata_version, "file-cache:48:1");
    assert.equal(hit.parserVersion, "relay-text-reader-v1");

    const staleSource = await cache.readRelayParsedDocumentCache(
      fileMetadata({ sourceMetadataVersion: "file-cache:49:2" }),
      parsed.parser.version,
      {
        cacheDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );
    assert.equal(staleSource, undefined);

    const wrongParser = await cache.readRelayParsedDocumentCache(file, "relay-text-reader-v2", {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(wrongParser, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache does not persist low-confidence parser output", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-low-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = {
      ...ir.parseTextToRelayParsedDocument(file, "本文"),
      parser_confidence: "low",
    };
    const written = await cache.writeRelayParsedDocumentCache(file, parsed, { cacheDir });
    assert.equal(written, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache refuses flattened structure-profile parser output", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-profile-invalid-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "本文");
    const flattened = {
      ...parsed,
      content: {
        structure: {
          ...parsed.content.structure,
          text: "本文",
          subparagraphs: [],
        },
        tables: [],
      },
      warnings: [],
    };

    assert.equal(ir.validateRelayParsedDocument(flattened).ok, false);
    const written = await cache.writeRelayParsedDocumentCache(file, flattened, { cacheDir });
    assert.equal(written, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache stages records before active promotion", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-stage-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "段階コミット キャッシュフロー");
    const stage = await cache.stageRelayParsedDocumentCache(file, parsed, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(stage.schemaVersion, "RelayParsedDocumentCacheStage.v1");
    assert.equal(existsSync(stage.stagingPath), true);
    assert.equal(existsSync(stage.activePath), false);
    const beforePromote = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, {
      cacheDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(beforePromote, undefined);

    const promoted = await stage.promote();
    assert.equal(promoted.cacheKey, stage.cacheKey);
    assert.equal(existsSync(stage.stagingPath), false);
    assert.equal(existsSync(stage.activePath), true);
    const hit = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, {
      cacheDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    assert.equal(hit.cacheKey, stage.cacheKey);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache discards staged records without exposing active content", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-stage-discard-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "破棄される内容");
    const stage = await cache.stageRelayParsedDocumentCache(file, parsed, { cacheDir });
    await stage.discard();

    assert.equal(existsSync(stage.stagingPath), false);
    assert.equal(existsSync(stage.activePath), false);
    const hit = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, { cacheDir });
    assert.equal(hit, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache refuses to overwrite newer content-bearing cache records", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-downgrade-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "新しいスキーマを保持");
    const cacheKey = cache.relayParsedDocumentCacheKey(file, parsed.parser.version);
    const cachePath = resolve(cacheDir, cacheKey.slice(0, 2), `${cacheKey}.json`);
    mkdirSync(resolve(cacheDir, cacheKey.slice(0, 2)), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        schemaVersion: "RelayParsedDocumentCache.v1",
        cacheVersion: 99,
        cacheKeyVersion: "relay-parsed-document-cache-key-v1",
        cacheKey,
        generatedAt: "2026-05-09T00:00:00.000Z",
        root: file.root,
        fileId: file.fileId,
        sourcePath: file.path,
        sourceMetadataVersion: file.sourceMetadataVersion,
        parsedDocumentIrVersion: "relay-parsed-document-ir-v99",
        parserVersion: parsed.parser.version,
        parserProfile: parsed.parser.profile,
        parserParametersVersion: "default",
        parsedDocument: parsed,
      }),
      "utf8",
    );

    const migration = await cache.inspectRelayParsedDocumentCacheMigration(file, parsed.parser.version, { cacheDir });
    assert.equal(migration.schemaVersion, "RelayParsedDocumentCacheSchemaMigration.v1");
    assert.equal(migration.status, "read_only_downgrade");
    assert.equal(migration.readOnly, true);
    assert.equal(migration.detectedCacheVersion, 99);
    const stage = await cache.stageRelayParsedDocumentCache(file, parsed, { cacheDir });
    assert.equal(stage, undefined);
    const preserved = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.equal(preserved.cacheVersion, 99);
    assert.equal(preserved.parsedDocumentIrVersion, "relay-parsed-document-ir-v99");
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache enforces deterministic entry quota eviction", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-quota-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const firstFile = fileMetadata({
      fileId: "file-cache-old",
      path: "/workspace/old.md",
      displayPath: "old.md",
      name: "old.md",
      sourceMetadataVersion: "file-cache-old:48:1",
    });
    const secondFile = fileMetadata({
      fileId: "file-cache-new",
      path: "/workspace/new.md",
      displayPath: "new.md",
      name: "new.md",
      sourceMetadataVersion: "file-cache-new:48:1",
    });
    await cache.writeRelayParsedDocumentCache(
      firstFile,
      ir.parseTextToRelayParsedDocument(firstFile, "古いキャッシュ"),
      {
        cacheDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
        maxCacheEntries: 2,
      },
    );

    const quotaSeen = [];
    await cache.writeRelayParsedDocumentCache(
      secondFile,
      ir.parseTextToRelayParsedDocument(secondFile, "新しいキャッシュ"),
      {
        cacheDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
        maxCacheEntries: 1,
        onQuota: (quota) => quotaSeen.push(quota),
      },
    );

    assert.equal(quotaSeen.length, 1);
    assert.equal(quotaSeen[0].entryCount, 1);
    assert.equal(quotaSeen[0].evicted.length, 1);
    assert.equal(quotaSeen[0].evicted[0].reason, "entry_quota");
    assert.match(quotaSeen[0].evicted[0].path, /file|[0-9a-f]{64}\.json/);

    const stale = await cache.readRelayParsedDocumentCache(firstFile, "relay-text-reader-v1", {
      cacheDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    const fresh = await cache.readRelayParsedDocumentCache(secondFile, "relay-text-reader-v1", {
      cacheDir,
      now: new Date("2026-05-09T00:02:00.000Z"),
    });
    assert.equal(stale, undefined);
    assert.equal(fresh.fileId, "file-cache-new");
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache removes invalid records during quota maintenance", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-invalid-"));
  const { cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    writeFileSync(resolve(cacheDir, "invalid.json"), "not json", "utf8");
    const result = await cache.enforceRelayParsedDocumentCacheQuota({
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(result.evicted.length, 1);
    assert.equal(result.evicted[0].reason, "invalid_record");
    assert.deepEqual(result.errors, []);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache refuses content writes when protection is required but unavailable", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-policy-blocked-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const policies = [];
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "本文");
    const written = await cache.writeRelayParsedDocumentCache(file, parsed, {
      cacheDir,
      cacheProtectionMode: "protection_required",
      protectedAtRest: false,
      onPolicy: (policy) => policies.push(policy),
    });

    assert.equal(written, undefined);
    assert.equal(policies[0].schemaVersion, "RelayParsedDocumentCachePolicy.v1");
    assert.equal(policies[0].writeAllowed, false);
    assert.equal(policies[0].reason, "protection_required_but_unavailable");

    const hit = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, {
      cacheDir,
      cacheProtectionMode: "protection_required",
      protectedAtRest: false,
    });
    assert.equal(hit, undefined);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache allows protected-at-rest policy writes", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-policy-protected-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const policies = [];
    const file = fileMetadata();
    const parsed = ir.parseTextToRelayParsedDocument(file, "保護されたキャッシュ");
    const written = await cache.writeRelayParsedDocumentCache(file, parsed, {
      cacheDir,
      cacheProtectionMode: "protection_required",
      protectedAtRest: true,
      onPolicy: (policy) => policies.push(policy),
    });

    assert.equal(written.fileId, "file-cache");
    assert.equal(policies[0].writeAllowed, true);
    assert.equal(policies[0].protectionState, "externally_protected");
    assert.equal(policies[0].reason, "externally_protected");

    const hit = await cache.readRelayParsedDocumentCache(file, parsed.parser.version, {
      cacheDir,
      cacheProtectionMode: "protection_required",
      protectedAtRest: true,
    });
    assert.equal(hit.fileId, "file-cache");
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("Relay ParsedDocument cache rewrites high-confidence move records to current lineage", async () => {
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-cache-move-"));
  const { ir, cache, cleanup } = await loadParsedDocumentCacheModule();
  try {
    const previousFile = fileMetadata({
      fileId: "old-file-id",
      path: "/workspace/old/memo.md",
      displayPath: "old/memo.md",
      name: "memo.md",
      modifiedTime: "2026-05-09T00:00:00.000Z",
      sourceMetadataVersion: "old-v1",
    });
    const currentFile = fileMetadata({
      fileId: "new-file-id",
      path: "/workspace/new/memo.md",
      displayPath: "new/memo.md",
      name: "memo.md",
      modifiedTime: "2026-05-09T00:00:00.000Z",
      sourceMetadataVersion: "new-v1",
    });
    const parsed = ir.parseTextToRelayParsedDocument(previousFile, "移動済みキャッシュ");
    await cache.writeRelayParsedDocumentCache(previousFile, parsed, {
      cacheDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    const report = await cache.migrateRelayParsedDocumentCacheForHighConfidenceMoves(
      [
        {
          schemaVersion: "RelayDocumentSearchFreshness.v1",
          root: "/workspace",
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
          changes: [
            {
              file_id: "old-file-id",
              display_path: "new/memo.md",
              reason: "moved",
              previous_display_path: "old/memo.md",
              current_display_path: "new/memo.md",
              previous_path: "/workspace/old/memo.md",
              current_path: "/workspace/new/memo.md",
              previous_size: 48,
              current_size: 48,
              previous_modified_time: "2026-05-09T00:00:00.000Z",
              current_modified_time: "2026-05-09T00:00:00.000Z",
              previous_source_metadata_version: "old-v1",
              current_source_metadata_version: "new-v1",
              previous_file_id: "old-file-id",
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
          ai_boundary: {
            localMetadataOnly: true,
            extractedContentIncluded: false,
            originalFilesIncluded: false,
          },
        },
      ],
      {
        cacheDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(report.schemaVersion, "RelayParsedDocumentCacheMoveMigration.v1");
    assert.equal(report.highConfidenceMoveCount, 1);
    assert.equal(report.migratedCacheRecordCount, 1);
    assert.equal(report.skippedMissingCacheCount, 0);
    assert.equal(report.ai_boundary.extractedContentIncluded, true);

    const migrated = await cache.readRelayParsedDocumentCache(currentFile, parsed.parser.version, {
      cacheDir,
      now: new Date("2026-05-10T00:01:00.000Z"),
    });
    assert.equal(migrated.fileId, "new-file-id");
    assert.equal(migrated.sourcePath, resolve("/workspace/new/memo.md"));
    assert.equal(migrated.sourceMetadataVersion, "new-v1");
    assert.equal(migrated.parsedDocument.source_file_id, "new-file-id");
    assert.equal(migrated.parsedDocument.source_path, resolve("/workspace/new/memo.md"));
    assert.equal(migrated.parsedDocument.source_metadata_version, "new-v1");
    assert.match(migrated.parsedDocument.content.structure.subparagraphs[0].text, /移動済みキャッシュ/);
  } finally {
    cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
