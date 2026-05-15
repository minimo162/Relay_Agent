import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plannerPath = resolve(repoRoot, "apps/desktop/src/lib/copilot-planners.ts");

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

async function loadPlannerModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-copilot-planners-"));
  writeFileSync(resolve(dir, "copilot-planners.mjs"), transpile(plannerPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "copilot-planners.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("result summary prompt exposes candidate IDs instead of Windows paths", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const prompt = module.buildDocumentSearchResultSummaryPrompt({
      rawQuery: "部品売上に関するファイルを探して",
      snapshotId: "snapshot-test",
      workspacePath: "H:\\shr1\\05_経理部",
      localSummary: "候補があります。",
      coverageLabel: "10件を確認しました。",
      cards: [
        {
          title: "301 自動車・部品他売上総利益.xlsx",
          path: "H:\\shr1\\05_経理部\\301 自動車・部品他売上総利益.xlsx",
          displayPath: "160期-1Q\\連結決算\\301 自動車・部品他売上総利益.xlsx",
          fileType: "xlsx",
          modifiedTime: "2026-05-10T00:00:00.000Z",
          evidenceState: "filename_only",
          matchMode: "filename",
          score: 24,
          warnings: ["filename_only"],
        },
      ],
    });

    assert.match(prompt, /candidate-001/);
    assert.equal(prompt.includes("H:\\shr1\\05_経理部\\301"), false);
    assert.equal(prompt.includes('"path"'), false);
    assert.match(prompt, /Never output file paths/);
  } finally {
    cleanup();
  }
});

test("result summary validator maps candidate IDs to local paths", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const candidatePathById = new Map([
      ["candidate-001", "H:\\shr1\\05_経理部\\301 自動車・部品他売上総利益.xlsx"],
    ]);
    const response = JSON.stringify({
      schemaVersion: "RelayDocumentSearchCopilotResultSummary.v1",
      rawQuery: "部品売上に関するファイルを探して",
      snapshotId: "snapshot-test",
      summary: "部品売上に直接近い候補があります。",
      categories: [
        {
          label: "部品売上候補",
          rationale: "ファイル名に部品他売上が含まれます。",
          confidence: "high",
          candidateIds: ["candidate-001"],
        },
      ],
      caveats: ["内容は未確認です。"],
    });

    const validation = module.validateDocumentSearchResultSummaryText(
      response,
      "部品売上に関するファイルを探して",
      "snapshot-test",
      candidatePathById,
    );
    assert.equal(validation.ok, true);
    assert.deepEqual(validation.value.categories[0].candidateIds, ["candidate-001"]);
    assert.deepEqual(validation.value.categories[0].paths, [
      "H:\\shr1\\05_経理部\\301 自動車・部品他売上総利益.xlsx",
    ]);
  } finally {
    cleanup();
  }
});

test("result summary validator rejects raw path contracts", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const response = JSON.stringify({
      schemaVersion: "RelayDocumentSearchCopilotResultSummary.v1",
      rawQuery: "部品売上に関するファイルを探して",
      snapshotId: "snapshot-test",
      summary: "候補があります。",
      categories: [
        {
          label: "候補",
          rationale: "旧契約のパスです。",
          confidence: "medium",
          paths: ["H:\\shr1\\05_経理部\\301.xlsx"],
        },
      ],
      caveats: [],
    });
    const validation = module.validateDocumentSearchResultSummaryText(
      response,
      "部品売上に関するファイルを探して",
      "snapshot-test",
      new Map([["candidate-001", "H:\\shr1\\05_経理部\\301.xlsx"]]),
    );
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(" / "), /Unknown categories\[0\] field: paths/);
  } finally {
    cleanup();
  }
});
