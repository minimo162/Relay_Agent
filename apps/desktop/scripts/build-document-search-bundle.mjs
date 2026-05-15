#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const sourceDir = resolve(repoRoot, "apps/desktop/document-search-src");
const outputRoot = resolve(repoRoot, "apps/desktop/src-tauri/resources/relay-document-search");
const outputModules = resolve(outputRoot, "modules");
const outputScripts = resolve(outputRoot, "scripts");

const moduleNames = [
  "relayDocumentSearchContract",
  "relayDocumentSearchMetadataCache",
  "relayDocumentSearchQueryPlan",
  "relayDocumentSearchFilenameIndex",
  "relayDocumentSearchIndexCoordinator",
  "relayParsedDocumentIr",
  "relayParsedDocumentCache",
  "relayDocumentSearchDerivedContentIndex",
  "relayDocumentSearchIndexDb",
  "relayDocumentSearchIndexReport",
  "relayDocumentSearchResultGrouping",
  "relayDocumentSearchProductResult",
  "relayDocumentSearchFolderRoles",
  "relayDocumentSearchUserMemory",
  "relayDocumentSearchQualityGates",
  "relayDocumentSearchQueryTrace",
  "relayDocumentSearchEvidenceRedaction",
  "relayDocumentSearchPolishValidation",
  "relayDocumentSearchPolishRequest",
  "relayDocumentSearchPolishProvider",
  "relayDocumentSearchEvidencePack",
  "relayDocumentSearchLocalDraft",
  "relayDocumentSearchAnswer",
  "relayDocumentSearchCopilotState",
  "relayDocumentSearchFreshness",
  "relayDocumentSearchSyncJournal",
  "relayDocumentSearchFailureRegistry",
  "relayDocumentSearchSchedulerReport",
  "relayDocumentSearchBackgroundScheduler",
  "relayDocumentSearchExecutor",
];

function rewriteLocalImports(output) {
  let rewritten = output;
  for (const name of moduleNames) {
    rewritten = rewritten.replace(
      new RegExp(`from\\s+(['"])\\./${name}\\1`, "g"),
      `from './${name}.mjs'`,
    );
  }
  return rewritten;
}

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
  const diagnostics = (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText);
  if (diagnostics.length) {
    throw new Error(`Failed to transpile ${path}: ${diagnostics.join("; ")}`);
  }
  return rewriteLocalImports(compiled.outputText);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputModules, { recursive: true });
mkdirSync(outputScripts, { recursive: true });

for (const name of moduleNames) {
  const sourcePath = resolve(sourceDir, `${name}.ts`);
  const outputPath = resolve(outputModules, `${name}.mjs`);
  writeFileSync(outputPath, transpile(sourcePath), "utf8");
}

writeFileSync(
  resolve(outputScripts, "relay-document-search-cli.mjs"),
  readFileSync(resolve(repoRoot, "scripts/relay-document-search-cli.mjs"), "utf8"),
  "utf8",
);
writeFileSync(resolve(outputRoot, ".gitkeep"), "\n", "utf8");

console.log(`Wrote Relay document-search bundle to ${outputRoot}`);
