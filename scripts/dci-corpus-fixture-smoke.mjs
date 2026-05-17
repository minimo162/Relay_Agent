#!/usr/bin/env node
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const workspace = mkdtempSync(join(tmpdir(), "relay-dci-corpus-"));
const corpus = createAdversarialDciCorpus(workspace);

for (const path of [...corpus.goldPaths, ...corpus.hardNegativePaths]) {
  if (!existsSync(join(workspace, path))) {
    throw new Error(`expected DCI fixture missing: ${path}`);
  }
}
if (!corpus.hardNegativePaths.some((path) => path.includes("Mパーツ")) ||
    !corpus.hardNegativePaths.some((path) => path.includes("glossary"))) {
  throw new Error(`fixture lacks entity/glossary decoys: ${JSON.stringify(corpus, null, 2)}`);
}
if (!corpus.goldPaths.some((path) => path.endsWith(".csv"))) {
  throw new Error(`fixture lacks heterogeneous CSV evidence: ${JSON.stringify(corpus, null, 2)}`);
}

console.log("[dci-corpus-fixture-smoke] ok");
