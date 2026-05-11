import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folderRolesPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFolderRoles.ts",
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

async function loadFolderRolesModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-folder-roles-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchFolderRoles.mjs"), transpile(folderRolesPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchFolderRoles.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("folder roles classify Japanese finance folder purpose from path segments", async () => {
  const { module, cleanup } = await loadFolderRolesModule();
  try {
    const report = module.classifyRelayDocumentSearchFolderRoles(
      "160期-1Q/ファイリング/⑫XSA/1.財務諸表/連結/XSA_連結CF.xlsx",
    );
    assert.equal(report.schemaVersion, "RelayDocumentSearchFolderRoles.v1");
    assert.equal(report.primaryRole, "filing");
    assert.ok(report.roles.some((role) => role.role === "filing" && role.segment === "ファイリング"));
  } finally {
    cleanup();
  }
});

test("folder roles summarize primary roles without document contents", async () => {
  const { module, cleanup } = await loadFolderRolesModule();
  try {
    const reports = [
      module.classifyRelayDocumentSearchFolderRoles("作業/backup/CFS.xlsx"),
      module.classifyRelayDocumentSearchFolderRoles("元データ/SAP/input.xlsx"),
      module.classifyRelayDocumentSearchFolderRoles("監査等委員会部提供/0715/CFS.xlsx"),
    ];
    const summary = module.summarizeRelayDocumentSearchFolderRoles(reports);
    assert.equal(summary.work, 1);
    assert.equal(summary.source, 1);
    assert.equal(summary.audit, 1);
    assert.equal(JSON.stringify(reports).includes("cell text"), false);
  } finally {
    cleanup();
  }
});
