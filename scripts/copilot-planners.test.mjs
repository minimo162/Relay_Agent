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

test("code patch prompt uses context-relative paths only", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const prompt = module.buildCodePatchPlanPrompt({
      instruction: "README の見出しを更新して",
      workspacePath: "/workspace/project",
      contextFiles: [
        {
          relativePath: "README.md",
          language: "markdown",
          sizeBytes: 24,
          modifiedTime: null,
          content: "# Old title\n",
          truncated: false,
          score: 100,
          reasons: ["explicit target"],
        },
      ],
    });

    assert.match(prompt, /RelayCodePatchPlan\.v1/);
    assert.match(prompt, /README\.md/);
    assert.equal(prompt.includes('"path"'), false);
    assert.match(prompt, /Do not run code/);
  } finally {
    cleanup();
  }
});

test("code patch validator accepts exact context file edits", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const response = JSON.stringify({
      schemaVersion: "RelayCodePatchPlan.v1",
      rawInstruction: "README の見出しを更新して",
      workspacePath: "/workspace/project",
      risk: "low",
      summary: "READMEの見出しを更新します。",
      edits: [
        {
          relativePath: "README.md",
          oldString: "# Old title\n",
          newString: "# New title\n",
          summary: "見出しを更新",
        },
      ],
      verificationCommands: ["pnpm typecheck"],
    });
    const validation = module.validateCodePatchPlanText(
      response,
      "README の見出しを更新して",
      "/workspace/project",
      new Set(["README.md"]),
    );
    assert.equal(validation.ok, true);
    assert.equal(validation.value.edits[0].relativePath, "README.md");
  } finally {
    cleanup();
  }
});

test("code patch validator rejects paths outside context", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const response = JSON.stringify({
      schemaVersion: "RelayCodePatchPlan.v1",
      rawInstruction: "README の見出しを更新して",
      workspacePath: "/workspace/project",
      risk: "low",
      summary: "READMEの見出しを更新します。",
      edits: [
        {
          relativePath: "../README.md",
          oldString: "# Old title\n",
          newString: "# New title\n",
          summary: "見出しを更新",
        },
      ],
      verificationCommands: [],
    });
    const validation = module.validateCodePatchPlanText(
      response,
      "README の見出しを更新して",
      "/workspace/project",
      new Set(["README.md"]),
    );
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(" / "), /workspace-relative path/);
  } finally {
    cleanup();
  }
});

test("agent step prompt exposes only the current mode tools", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const prompt = module.buildAgentStepPrompt({
      mode: "office_edit",
      instruction: "Sheet1 の A1 を赤くして",
      workspacePath: "H:\\shr1\\book.xlsx",
      toolCatalog: module.RELAY_AGENT_TOOL_CATALOG,
    });

    assert.match(prompt, /RelayAgentStep\.v1/);
    assert.match(prompt, /officecli/);
    assert.equal(prompt.includes("relay_document_search"), false);
    assert.equal(prompt.includes("apply_code_patch"), false);
  } finally {
    cleanup();
  }
});

test("agent step validator accepts only allowed mode tools", async () => {
  const { module, cleanup } = await loadPlannerModule();
  try {
    const valid = module.validateAgentStepText(
      JSON.stringify({
        schemaVersion: "RelayAgentStep.v1",
        mode: "document_search",
        rawInstruction: "部品売上に関するファイルを探して",
        action: "use_tool",
        toolName: "relay_document_search",
        input: { query: "部品売上" },
        rationale: "資料検索ツールで候補を探します。",
      }),
      "document_search",
      "部品売上に関するファイルを探して",
      new Set(["relay_document_search"]),
    );
    assert.equal(valid.ok, true);

    const invalid = module.validateAgentStepText(
      JSON.stringify({
        schemaVersion: "RelayAgentStep.v1",
        mode: "document_search",
        rawInstruction: "部品売上に関するファイルを探して",
        action: "use_tool",
        toolName: "officecli",
        input: {},
        rationale: "Officeを編集します。",
      }),
      "document_search",
      "部品売上に関するファイルを探して",
      new Set(["relay_document_search"]),
    );
    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join(" / "), /toolName must be one of/);
  } finally {
    cleanup();
  }
});
