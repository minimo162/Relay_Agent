import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMcpStdio.ts",
);

test("Relay document search MCP stdio entry is syntax-valid and tool-bound", () => {
  const source = readFileSync(mcpPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: mcpPath,
    reportDiagnostics: true,
  });

  assert.deepEqual(
    (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText),
    [],
  );
  assert.match(source, /new McpServer/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_TOOL_NAME/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT/);
  assert.match(source, /compact result summary/);
  assert.match(source, /stays inside Relay diagnostics/);
  assert.match(source, /handleRelayDocumentSearchToolCall/);
  assert.match(source, /execution\.aionuiContent/);
  assert.match(source, /startRelayDocumentSearchSyncProducerFromEnvironment/);
  assert.doesNotMatch(source, /from ['"]\.\/relayDocumentSearchBridge['"]/);
  assert.doesNotMatch(source, /from ['"]\.\/relayDocumentSearchSyncProducer['"]/);
  assert.match(source, /import\(['"]\.\/relayDocumentSearchBridge['"]\)/);
  assert.match(source, /import\(['"]\.\/relayDocumentSearchSyncProducer['"]\)/);
  assert.match(source, /relay_document_search_mcp_handler_failed/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_WORKSPACE/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR/);
  assert.match(source, /RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER/);
  assert.match(source, /useMetadataCache: true/);
  assert.match(source, /useFilenameIndex: true/);
  assert.match(source, /useUserMemory: true/);
  assert.match(source, /useSyncJournal: true/);
  assert.match(source, /queryPlanHints/);
  assert.match(source, /RelayDocumentSearchCopilotQueryPlan\.v1/);
});
