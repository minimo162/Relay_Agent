import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const freshnessPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFreshness.ts",
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

async function loadFreshnessModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-freshness-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchFreshness.mjs"), transpile(freshnessPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchFreshness.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function file(overrides = {}) {
  return {
    fileId: "file-1",
    root: "/workspace",
    path: "/workspace/report.xlsx",
    displayPath: "report.xlsx",
    name: "report.xlsx",
    extension: "xlsx",
    size: 10,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: "v1",
    ...overrides,
  };
}

test("Freshness report marks mtime and size changes as content-stale metadata", async () => {
  const { module, cleanup } = await loadFreshnessModule();
  try {
    const report = module.buildRelayDocumentSearchFreshnessReport({
      root: "/workspace",
      generatedAt: "2026-05-10T00:00:00.000Z",
      previousFiles: [
        file(),
        file({
          fileId: "file-deleted",
          path: "/workspace/old.xlsx",
          displayPath: "old.xlsx",
          name: "old.xlsx",
          size: 11,
          sourceMetadataVersion: "old-v1",
        }),
      ],
      currentFiles: [
        file({
          size: 20,
          modifiedTime: "2026-05-09T00:05:00.000Z",
          sourceMetadataVersion: "v2",
        }),
        file({
          fileId: "file-created",
          path: "/workspace/new.xlsx",
          displayPath: "new.xlsx",
          name: "new.xlsx",
          size: 12,
          sourceMetadataVersion: "new-v1",
        }),
      ],
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchFreshness.v1");
    assert.equal(report.checked_file_count, 3);
    assert.equal(report.created_file_count, 1);
    assert.equal(report.modified_file_count, 1);
    assert.equal(report.deleted_file_count, 1);
    assert.equal(report.moved_file_count, 0);
    assert.equal(report.tombstone_count, 1);
    assert.equal(report.content_stale_file_count, 3);
    assert.equal(report.ai_boundary.extractedContentIncluded, false);
    assert.ok(report.changes.some((change) => change.display_path === "report.xlsx" && change.reason === "size_changed"));
    assert.ok(report.changes.every((change) => change.content_stale));
  } finally {
    cleanup();
  }
});

test("Freshness report preserves stable identity for high-confidence moves", async () => {
  const { module, cleanup } = await loadFreshnessModule();
  try {
    const report = module.buildRelayDocumentSearchFreshnessReport({
      root: "/workspace",
      generatedAt: "2026-05-10T00:00:00.000Z",
      previousFiles: [
        file({
          fileId: "stable-file-id",
          path: "/workspace/old/report.xlsx",
          displayPath: "old/report.xlsx",
          sourceMetadataVersion: "old-path-v1",
        }),
      ],
      currentFiles: [
        file({
          fileId: "new-path-file-id",
          path: "/workspace/new/report.xlsx",
          displayPath: "new/report.xlsx",
          sourceMetadataVersion: "new-path-v1",
        }),
      ],
    });

    assert.equal(report.checked_file_count, 1);
    assert.equal(report.created_file_count, 0);
    assert.equal(report.deleted_file_count, 0);
    assert.equal(report.moved_file_count, 1);
    assert.equal(report.tombstone_count, 1);
    assert.equal(report.content_stale_file_count, 1);
    const change = report.changes[0];
    assert.equal(change.reason, "moved");
    assert.equal(change.file_id, "stable-file-id");
    assert.equal(change.previous_file_id, "stable-file-id");
    assert.equal(change.current_file_id, "new-path-file-id");
    assert.equal(change.previous_display_path, "old/report.xlsx");
    assert.equal(change.current_display_path, "new/report.xlsx");
    assert.equal(change.move_confidence, "high");
    assert.equal(change.tombstone, true);
    assert.equal(change.content_stale, true);
  } finally {
    cleanup();
  }
});

test("Freshness report marks current-user access changes as stale unavailable evidence", async () => {
  const { module, cleanup } = await loadFreshnessModule();
  try {
    const previous = file({
      accessSnapshots: {
        metadata: { action: "metadata", state: "ok", checkedAt: "2026-05-09T00:00:00.000Z" },
        content: { action: "content", state: "ok", checkedAt: "2026-05-09T00:00:00.000Z" },
        preview: { action: "preview", state: "ok", checkedAt: "2026-05-09T00:00:00.000Z" },
        open: { action: "open", state: "ok", checkedAt: "2026-05-09T00:00:00.000Z" },
      },
    });
    const current = file({
      accessSnapshots: {
        metadata: { action: "metadata", state: "ok", checkedAt: "2026-05-10T00:00:00.000Z" },
        content: {
          action: "content",
          state: "access_denied",
          checkedAt: "2026-05-10T00:00:00.000Z",
          warningCode: "access_denied",
        },
        preview: {
          action: "preview",
          state: "access_denied",
          checkedAt: "2026-05-10T00:00:00.000Z",
          warningCode: "preview_denied",
        },
        open: { action: "open", state: "ok", checkedAt: "2026-05-10T00:00:00.000Z" },
      },
    });
    const report = module.buildRelayDocumentSearchFreshnessReport({
      root: "/workspace",
      generatedAt: "2026-05-10T00:00:00.000Z",
      previousFiles: [previous],
      currentFiles: [current],
    });

    assert.equal(report.checked_file_count, 1);
    assert.equal(report.unchanged_file_count, 0);
    assert.equal(report.modified_file_count, 0);
    assert.equal(report.access_changed_file_count, 1);
    assert.equal(report.access_unavailable_file_count, 1);
    assert.equal(report.content_stale_file_count, 1);
    const change = report.changes[0];
    assert.equal(change.reason, "access_changed");
    assert.deepEqual(change.access_changed_actions.sort(), ["content", "preview"].sort());
    assert.deepEqual(change.access_warning_codes.sort(), ["access_denied", "preview_denied"].sort());
    assert.equal(change.previous_access_state.content, "ok");
    assert.equal(change.current_access_state.content, "access_denied");
    assert.equal(change.access_stale, true);
    assert.equal(change.access_unavailable, true);
  } finally {
    cleanup();
  }
});

test("Freshness summary aggregates root reports without document contents", async () => {
  const { module, cleanup } = await loadFreshnessModule();
  try {
    const report = module.buildRelayDocumentSearchFreshnessReport({
      root: "/workspace",
      generatedAt: "2026-05-10T00:00:00.000Z",
      previousFiles: [file()],
      currentFiles: [file()],
    });
    const summary = module.summarizeRelayDocumentSearchFreshnessReports([report]);

    assert.equal(summary.schemaVersion, "RelayDocumentSearchFreshnessSummary.v1");
    assert.equal(summary.report_count, 1);
    assert.equal(summary.checked_file_count, 1);
    assert.equal(summary.moved_file_count, 0);
    assert.equal(summary.access_changed_file_count, 0);
    assert.equal(summary.access_unavailable_file_count, 0);
    assert.equal(summary.tombstone_count, 0);
    assert.equal(summary.content_stale_file_count, 0);
    assert.equal(summary.reports[0].ai_boundary.originalFilesIncluded, false);
  } finally {
    cleanup();
  }
});
