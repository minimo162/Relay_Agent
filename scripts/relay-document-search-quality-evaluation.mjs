import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { loadRelayDocumentSearchExecutorModule } from "./relay-document-search-module-loader.mjs";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultGeneratedAt = "2026-05-11T00:00:00.000Z";
const defaultCases = [
  {
    id: "workspace-search-cutover",
    query: "Workspace Document Search SQLite FTS cutover readiness",
    expectedBasenames: ["WORKSPACE_DOCUMENT_SEARCH_PLAN.md", "IMPLEMENTATION.md"],
  },
  {
    id: "aionui-windows-validation",
    query: "AionUi Windows validation Office workflows",
    expectedBasenames: ["AIONUI_WINDOWS_VALIDATION.md"],
  },
  {
    id: "opencode-provider-gateway",
    query: "OpenCode provider gateway M365 Copilot",
    expectedBasenames: ["OPENCODE_PROVIDER_GATEWAY.md"],
  },
  {
    id: "trusted-signing-release",
    query: "Trusted Signing Windows installer release workflow",
    expectedBasenames: ["TRUSTED_SIGNING_SETUP.md", "PACKAGING_POLICY.md"],
  },
];

function parseArgs(argv) {
  const out = {
    roots: [],
    output: resolve(repoRoot, "docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_EVALUATION.md"),
    generatedAt: defaultGeneratedAt,
    keepTemp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") out.roots.push(resolve(argv[++index]));
    else if (arg === "--output") out.output = resolve(argv[++index]);
    else if (arg === "--generated-at") out.generatedAt = argv[++index];
    else if (arg === "--keep-temp") out.keepTemp = true;
    else if (arg === "--help") {
      console.log("Usage: node scripts/relay-document-search-quality-evaluation.mjs [--root PATH] [--output PATH]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!out.roots.length) out.roots.push(resolve(repoRoot, "docs"));
  return out;
}

function countMarkdownFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) count += 1;
    }
  }
  return count;
}

function rootLabel(root) {
  const rel = relative(repoRoot, root);
  return rel && !rel.startsWith("..") ? rel : basename(root);
}

function resultLabel(result) {
  return basename(String(result.path || result.display_name || result.file_id || "unknown"));
}

function sourceKinds(result) {
  return Array.isArray(result.source_indexes)
    ? result.source_indexes.map((source) => String(source.kind)).filter(Boolean)
    : [];
}

function indexDbFacts(result) {
  const stage = result.diagnostics?.queryTrace?.stages?.find((item) => item?.name === "index_db");
  return stage?.facts ?? {};
}

function usageFacts(result) {
  return result.diagnostics?.indexDb?.resultUsage ?? {};
}

function caseSummary(testCase, result) {
  const labels = result.results.map(resultLabel);
  const expectedRanks = testCase.expectedBasenames
    .map((expected) => labels.findIndex((label) => label === expected))
    .filter((rank) => rank >= 0)
    .map((rank) => rank + 1);
  const facts = indexDbFacts(result);
  const usage = usageFacts(result);
  const top = result.results[0];
  return {
    id: testCase.id,
    query: testCase.query,
    expectedBasenames: testCase.expectedBasenames,
    status: result.status,
    resultCount: result.results.length,
    expectedHitCount: expectedRanks.length,
    bestExpectedRank: expectedRanks.length ? Math.min(...expectedRanks) : null,
    topResult: top ? resultLabel(top) : "none",
    topPrimarySource: top?.primary_source_index ?? "none",
    topSourceKinds: top ? sourceKinds(top) : [],
    readinessStatus: facts.readinessStatus ?? result.diagnostics?.indexDb?.cutoverReadiness?.status ?? "unknown",
    searchTruncated: Boolean(facts.searchTruncated ?? result.diagnostics?.indexDb?.search?.truncated),
    staleRows: Number(facts.staleEvidenceRowCount ?? result.diagnostics?.indexDb?.staleEvidenceRowCount ?? 0),
    candidateScoreTotal: Number(usage.candidateScoreTotal ?? 0),
    candidateUncappedScoreTotal: Number(usage.candidateUncappedScoreTotal ?? 0),
    candidateScoreCapLossTotal: Number(usage.candidateScoreCapLossTotal ?? 0),
    scoreCappedCandidateCount: Number(usage.scoreCappedCandidateCount ?? 0),
    promotedResultCount: Number(usage.promotedResultCount ?? 0),
    nonReturnedScoredCandidateCount: Number(usage.nonReturnedScoredCandidateCount ?? 0),
  };
}

function recommendationLines(summaries) {
  const lines = [];
  const missingExpected = summaries.filter((item) => item.expectedHitCount === 0);
  const capped = summaries.filter((item) => item.candidateScoreCapLossTotal > 0);
  const truncated = summaries.filter((item) => item.searchTruncated);
  const stale = summaries.filter((item) => item.staleRows > 0);
  lines.push("Keep SQLite/FTS primary promotion behind the WDS02 ready gate; this run is a local repository corpus, not a customer/shared-folder acceptance run.");
  if (missingExpected.length) {
    lines.push(`Review query normalization and score weights before primary cutover: ${missingExpected.map((item) => item.id).join(", ")} missed all expected files.`);
  } else {
    lines.push("Expected files were present for every evaluation query, so the current filename/content/SQLite blend is acceptable as an MVP baseline.");
  }
  if (capped.length) {
    lines.push(`Keep score-cap telemetry enabled and inspect saturated queries before raising SQLite weight: ${capped.map((item) => item.id).join(", ")} hit the cap.`);
  }
  if (truncated.length) {
    lines.push(`Treat truncated FTS probes as degraded for cutover decisions: ${truncated.map((item) => item.id).join(", ")} reached the search row bound.`);
  }
  if (stale.length) {
    lines.push(`Do not promote stale FTS evidence to primary results until freshness is repaired: ${stale.map((item) => item.id).join(", ")} reported stale rows.`);
  }
  return lines;
}

function renderMarkdown({ roots, generatedAt, tempDir, summaries }) {
  const markdownCounts = roots.map((root) => ({ root, count: countMarkdownFiles(root) }));
  const expectedCoverage = summaries.filter((item) => item.expectedHitCount > 0).length;
  const topCoverage = summaries.filter((item) => item.bestExpectedRank === 1).length;
  const rows = summaries.map((item) => [
    item.id,
    item.status,
    `${item.expectedHitCount}/${item.expectedBasenames.length}`,
    item.bestExpectedRank ?? "-",
    item.topResult,
    item.topPrimarySource,
    item.readinessStatus,
    item.searchTruncated ? "yes" : "no",
    item.staleRows,
    item.candidateScoreCapLossTotal,
  ]);
  return `# Workspace Document Search SQLite/FTS Evaluation

Generated: ${generatedAt}

## Scope

WDS01 evaluates the current SQLite/FTS advisory path against the repository-local
documentation corpus available in this environment. No customer or shared-folder
corpus was available here, so this is a reproducible local baseline rather than
a release acceptance run for real customer data.

## Privacy Boundary

- The evaluation report records aggregate diagnostics and result basenames only.
- It does not store snippets, extracted document text, raw FTS rows, raw DB
  contents, or absolute source paths.
- The temporary SQLite database is created under a temporary directory and
  removed at the end of the run.
- Temporary working directory pattern: relay-wds01-eval-*

## Corpus

${markdownCounts.map((item) => `- ${rootLabel(item.root)}: ${item.count} Markdown files`).join("\n")}

## Query Results

| Case | Status | Expected Hits | Best Rank | Top Result | Top Source | Index DB | Truncated | Stale Rows | Cap Loss |
| --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Summary

- Expected-file coverage: ${expectedCoverage}/${summaries.length} cases.
- Top-rank expected-file coverage: ${topCoverage}/${summaries.length} cases.
- Total SQLite/FTS candidate score cap loss: ${summaries.reduce((sum, item) => sum + item.candidateScoreCapLossTotal, 0)}.
- Total stale SQLite/FTS rows reported: ${summaries.reduce((sum, item) => sum + item.staleRows, 0)}.

## Recommendations

${recommendationLines(summaries).map((line) => `- ${line}`).join("\n")}

## Follow-Up

- WDS02 consumes this report as a local baseline and keeps SQLite/FTS primary
  promotion behind an explicit ready/rollback gate.
- WDS03 complements this quality baseline with synthetic large-folder latency,
  DB size, WAL/SHM, checkpoint, and scheduler/backpressure measurements.
- WDS09 complements this repository-corpus baseline with a privacy-safe
  synthetic golden-query gate for top-k coverage, folder skew, warning
  correctness, unsupported-claim prevention, and latency.
- A release acceptance run still needs a representative user-approved folder
  set outside this repository.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = resolve(tmpdir(), `relay-wds01-eval-${process.pid}`);
  mkdirSync(tempDir, { recursive: true });
  const { module, cleanup } = await loadRelayDocumentSearchExecutorModule({ repoRoot });
  try {
    const summaries = [];
    for (const testCase of defaultCases) {
      const result = await module.executeRelayDocumentSearch(
        {
          query: testCase.query,
          roots: args.roots,
          fileTypes: ["md"],
          evidence: "required",
          maxResults: 8,
          thoroughness: "thorough",
        },
        {
          jobId: `wds01-${testCase.id}`,
          queryId: `wds01-${testCase.id}`,
          now: new Date(args.generatedAt),
          useIndexDb: true,
          indexDbPath: resolve(tempDir, "document-search.sqlite"),
          maxScanFiles: 5000,
          maxContentInspectFiles: 500,
          timeoutMs: 20000,
        },
      );
      summaries.push(caseSummary(testCase, result));
    }
    const report = renderMarkdown({
      roots: args.roots,
      generatedAt: args.generatedAt,
      tempDir,
      summaries,
    });
    writeFileSync(args.output, report, "utf8");
    console.log(JSON.stringify({
      output: relative(repoRoot, args.output),
      caseCount: summaries.length,
      expectedCoverage: summaries.filter((item) => item.expectedHitCount > 0).length,
      topCoverage: summaries.filter((item) => item.bestExpectedRank === 1).length,
    }));
  } finally {
    cleanup();
    if (!args.keepTemp) rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
