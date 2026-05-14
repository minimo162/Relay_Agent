#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function readInput() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: relay-document-search-cli.mjs <input-json-path>");
  }
  return JSON.parse(readFileSync(inputPath, "utf8"));
}

function scriptDir() {
  return dirname(fileURLToPath(import.meta.url));
}

async function loadBundledExecutor() {
  const dir = process.env.RELAY_DOCUMENT_SEARCH_MODULE_DIR
    ? resolve(process.env.RELAY_DOCUMENT_SEARCH_MODULE_DIR)
    : resolve(scriptDir(), "../modules");
  const executorPath = resolve(dir, "relayDocumentSearchExecutor.mjs");
  if (!existsSync(executorPath)) return null;
  return {
    module: await import(pathToFileURL(executorPath).href),
    cleanup: () => {},
  };
}

async function loadSourceExecutor() {
  const loaderPath = resolve(scriptDir(), "relay-document-search-module-loader.mjs");
  const fallbackLoaderPath = resolve(scriptDir(), "../scripts/relay-document-search-module-loader.mjs");
  const source = existsSync(loaderPath) ? loaderPath : fallbackLoaderPath;
  const { loadRelayDocumentSearchExecutorModule } = await import(pathToFileURL(source).href);
  return loadRelayDocumentSearchExecutorModule({
    repoRoot: process.env.RELAY_REPO_ROOT || resolve(scriptDir(), ".."),
  });
}

function normalizeRequest(input) {
  const request = input?.request && typeof input.request === "object" ? input.request : {};
  return {
    query: String(request.query || "").trim(),
    roots: Array.isArray(request.roots) ? request.roots : [],
    intent: request.intent || "find_files",
    thoroughness: request.thoroughness || "thorough",
    fileTypes: Array.isArray(request.fileTypes) && request.fileTypes.length ? request.fileTypes : ["any"],
    maxResults: Number.isFinite(request.maxResults) ? request.maxResults : 50,
    evidence: request.evidence || "candidate",
    ...(request.queryPlanHints ? { queryPlanHints: request.queryPlanHints } : {}),
  };
}

function normalizeOptions(input) {
  const options = input?.options && typeof input.options === "object" ? input.options : {};
  return {
    useMetadataCache: true,
    useFilenameIndex: true,
    useIndexDb: true,
    indexDbPrimaryMode: "primary",
    useParsedDocumentCache: true,
    useDerivedContentIndexCache: true,
    useIndexCoordinator: true,
    useFailureRegistry: true,
    useJobStore: true,
    useUserMemory: true,
    useSyncJournal: true,
    timeoutMs: 120000,
    maxScanFiles: 25000,
    ...options,
  };
}

async function main() {
  const input = readInput();
  const loaded = (await loadBundledExecutor()) || (await loadSourceExecutor());
  try {
    const result = await loaded.module.executeRelayDocumentSearch(
      normalizeRequest(input),
      normalizeOptions(input),
    );
    process.stdout.write(JSON.stringify({ ok: true, result }, null, 2));
  } finally {
    loaded.cleanup?.();
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
