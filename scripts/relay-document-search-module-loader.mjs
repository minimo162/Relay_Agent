import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

function modulePath(repoRoot, name) {
  return resolve(repoRoot, "apps/desktop/document-search-src", `${name}.ts`);
}

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

export async function loadRelayDocumentSearchExecutorModule(options = {}) {
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : defaultRepoRoot;
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-module-"));
  try {
    for (const name of moduleNames) {
      writeFileSync(resolve(dir, `${name}.mjs`), transpile(modulePath(repoRoot, name)), "utf8");
    }
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchExecutor.mjs")).href),
      moduleDir: dir,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
