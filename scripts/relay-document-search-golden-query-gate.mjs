import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRelayDocumentSearchExecutorModule } from "./relay-document-search-module-loader.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultGeneratedAt = "2026-05-11T00:00:00.000Z";
const defaultOutput = resolve(repoRoot, "docs/WORKSPACE_DOCUMENT_SEARCH_GOLDEN_QUERIES.md");
const defaultJsonOutput = "";
const defaultMaxLatencyMs = 10000;

function parseArgs(argv) {
  const out = {
    output: defaultOutput,
    jsonOutput: defaultJsonOutput,
    generatedAt: defaultGeneratedAt,
    keepTemp: false,
    maxLatencyMs: defaultMaxLatencyMs,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") out.output = resolve(argv[++index]);
    else if (arg === "--json-output") out.jsonOutput = resolve(argv[++index]);
    else if (arg === "--generated-at") out.generatedAt = argv[++index];
    else if (arg === "--keep-temp") out.keepTemp = true;
    else if (arg === "--max-latency-ms") out.maxLatencyMs = Number(argv[++index]);
    else if (arg === "--help") {
      console.log(
        "Usage: node scripts/relay-document-search-golden-query-gate.mjs [--output PATH] [--json-output PATH] [--max-latency-ms MS]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(out.maxLatencyMs) || out.maxLatencyMs <= 0) {
    throw new Error("--max-latency-ms must be a positive number");
  }
  return out;
}

function writeFixture(corpusRoot, relativePath, content) {
  const fullPath = resolve(corpusRoot, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content.trimStart(), "utf8");
}

function createFixtureCorpus(tempDir) {
  const corpusRoot = resolve(tempDir, "corpus");
  mkdirSync(corpusRoot, { recursive: true });
  const fixtures = [
    [
      "finance/cash-flow-forecast.md",
      `# Cash Flow Forecast

The cash flow forecast tracks operating runway, working capital, expected
receipts, supplier disbursements, and the weekly liquidity bridge.
`,
    ],
    [
      "finance/cash-flow-variance.md",
      `# Cash Flow Variance

The finance team compares forecast variance, working capital movement, and
receipt timing for the monthly cash flow review.
`,
    ],
    [
      "finance/cashflow-note-01.md",
      `# Cashflow Note 01

Cashflow liquidity forecast assumptions for routine finance review.
`,
    ],
    [
      "finance/cashflow-note-02.md",
      `# Cashflow Note 02

Cashflow liquidity forecast assumptions for routine finance review.
`,
    ],
    [
      "finance/cashflow-note-03.md",
      `# Cashflow Note 03

Cashflow liquidity forecast assumptions for routine finance review.
`,
    ],
    [
      "finance/cashflow-note-04.md",
      `# Cashflow Note 04

Cashflow liquidity forecast assumptions for routine finance review.
`,
    ],
    [
      "board/cashflow-board-pack.md",
      `# Cashflow Board Pack

The board pack covers cashflow liquidity decisions, covenant headroom, and the
forecast bridge used for executive review.
`,
    ],
    [
      "board/board-liquidity-minutes.md",
      `# Board Liquidity Minutes

Board minutes record liquidity decisions and forecast review actions.
`,
    ],
    [
      "legal/vendor-contract.md",
      `# Vendor Contract

The vendor contract renewal memo covers indemnity, termination notice, service
levels, and procurement approval.
`,
    ],
    [
      "archive/payroll-draft.md",
      `# Payroll Draft

Historical payroll checklist for salary approval and employee deduction review.
`,
    ],
    [
      "archive/payroll-archive-copy.md",
      `# Payroll Archive Copy

Archived payroll material for employee deductions and old approval routing.
`,
    ],
  ];
  for (const [relativePath, content] of fixtures) writeFixture(corpusRoot, relativePath, content);
  return { corpusRoot, fixtureCount: fixtures.length };
}

function goldenCases(corpusRoot, maxLatencyMs) {
  return [
    {
      id: "top-k-cash-flow",
      purpose: "Top-k expected coverage",
      request: {
        query: "cash flow forecast working capital variance",
        roots: [corpusRoot],
        intent: "answer_with_evidence",
        thoroughness: "thorough",
        fileTypes: ["md"],
        maxResults: 6,
        evidence: "required",
      },
      topK: 3,
      expectedBasenames: ["cash-flow-forecast.md", "cash-flow-variance.md"],
      minExpectedHitCount: 2,
      expectedCanAskCopilotForFinalAnswer: true,
      maxLatencyMs,
    },
    {
      id: "folder-skew-cashflow",
      purpose: "Folder-skew guard",
      request: {
        query: "cashflow liquidity board pack forecast",
        roots: [corpusRoot],
        intent: "find_files",
        thoroughness: "thorough",
        fileTypes: ["md"],
        maxResults: 5,
        evidence: "required",
      },
      topK: 5,
      expectedBasenames: ["cashflow-board-pack.md"],
      minExpectedHitCount: 1,
      maxTopKPerDirectory: 3,
      expectedCanAskCopilotForFinalAnswer: true,
      maxLatencyMs,
    },
    {
      id: "forbidden-payroll-false-positive",
      purpose: "Forbidden false-positive guard",
      request: {
        query: "vendor contract renewal indemnity termination",
        roots: [corpusRoot],
        intent: "answer_with_evidence",
        thoroughness: "thorough",
        fileTypes: ["md"],
        maxResults: 5,
        evidence: "required",
      },
      topK: 5,
      expectedBasenames: ["vendor-contract.md"],
      minExpectedHitCount: 1,
      forbiddenBasenames: ["payroll-draft.md", "payroll-archive-copy.md"],
      expectedCanAskCopilotForFinalAnswer: true,
      maxLatencyMs,
    },
    {
      id: "candidate-only-warning",
      purpose: "Warning correctness",
      request: {
        query: "cashflow forecast",
        roots: [corpusRoot],
        intent: "find_files",
        thoroughness: "quick",
        fileTypes: ["md"],
        maxResults: 4,
        evidence: "none",
      },
      topK: 4,
      expectedBasenames: ["cash-flow-forecast.md"],
      minExpectedHitCount: 1,
      expectedWarningCodes: ["candidate_only"],
      expectedCanAskCopilotForFinalAnswer: false,
      useIndexDb: false,
      maxLatencyMs,
    },
    {
      id: "unsupported-claim-no-results",
      purpose: "Unsupported-claim prevention",
      request: {
        query: "quartz zettabyte harmonica",
        roots: [corpusRoot],
        intent: "answer_with_evidence",
        thoroughness: "thorough",
        fileTypes: ["md"],
        maxResults: 4,
        evidence: "required",
      },
      topK: 4,
      expectedBasenames: [],
      minExpectedHitCount: 0,
      expectedWarningCodes: ["no_results"],
      expectedCanAskCopilotForFinalAnswer: false,
      maxLatencyMs,
    },
  ];
}

function resultPath(result) {
  return String(result.path || result.display_path || result.display_name || result.file_id || "unknown");
}

function resultBasename(result) {
  return basename(resultPath(result));
}

function relativeResultPath(result, corpusRoot) {
  const fullPath = resolve(resultPath(result));
  const label = relative(corpusRoot, fullPath);
  if (!label || label.startsWith("..")) return resultBasename(result);
  return label.replace(/\\/gu, "/");
}

function directoryLabel(relativePath) {
  const index = relativePath.lastIndexOf("/");
  return index >= 0 ? relativePath.slice(0, index) : ".";
}

function warningCodes(result) {
  return Array.isArray(result.diagnostics?.quality?.warnings)
    ? result.diagnostics.quality.warnings.map((warning) => String(warning.code)).filter(Boolean)
    : [];
}

function quality(result) {
  return result.diagnostics?.quality ?? {};
}

function evaluateCase(testCase, result, latencyMs, corpusRoot) {
  const labels = result.results.map(resultBasename);
  const relativePaths = result.results.map((item) => relativeResultPath(item, corpusRoot));
  const topKLabels = labels.slice(0, testCase.topK);
  const topKPaths = relativePaths.slice(0, testCase.topK);
  const expectedBasenames = testCase.expectedBasenames ?? [];
  const forbiddenBasenames = testCase.forbiddenBasenames ?? [];
  const expectedHitCount = expectedBasenames.filter((expected) => topKLabels.includes(expected)).length;
  const forbiddenHits = forbiddenBasenames.filter((forbidden) => labels.includes(forbidden));
  const directoryCounts = {};
  for (const item of topKPaths) {
    const directory = directoryLabel(item);
    directoryCounts[directory] = (directoryCounts[directory] ?? 0) + 1;
  }
  const maxDirectoryCount = Math.max(0, ...Object.values(directoryCounts));
  const codes = warningCodes(result);
  const expectedWarnings = testCase.expectedWarningCodes ?? [];
  const expectedCoveragePassed = expectedHitCount >= (testCase.minExpectedHitCount ?? expectedBasenames.length);
  const forbiddenPassed = forbiddenHits.length === 0;
  const folderSkewPassed = testCase.maxTopKPerDirectory === undefined ||
    maxDirectoryCount <= testCase.maxTopKPerDirectory;
  const warningPassed = expectedWarnings.every((code) => codes.includes(code));
  const actualCanAsk = Boolean(quality(result).canAskCopilotForFinalAnswer);
  const unsupportedClaimPassed = testCase.expectedCanAskCopilotForFinalAnswer === undefined ||
    actualCanAsk === testCase.expectedCanAskCopilotForFinalAnswer;
  const latencyPassed = latencyMs <= testCase.maxLatencyMs;
  const failureReasons = [];
  if (!expectedCoveragePassed) {
    failureReasons.push(`expected_top_k_hit_count:${expectedHitCount}/${testCase.minExpectedHitCount ?? expectedBasenames.length}`);
  }
  if (!forbiddenPassed) failureReasons.push(`forbidden_false_positive:${forbiddenHits.join(",")}`);
  if (!folderSkewPassed) failureReasons.push(`folder_skew:${maxDirectoryCount}/${testCase.maxTopKPerDirectory}`);
  if (!warningPassed) failureReasons.push(`missing_warning:${expectedWarnings.filter((code) => !codes.includes(code)).join(",")}`);
  if (!unsupportedClaimPassed) failureReasons.push(`unsupported_claim_policy:${actualCanAsk}`);
  if (!latencyPassed) failureReasons.push(`latency:${latencyMs}/${testCase.maxLatencyMs}`);
  return {
    id: testCase.id,
    purpose: testCase.purpose,
    status: result.status,
    passed: failureReasons.length === 0,
    failureReasons,
    resultCount: result.results.length,
    topK: testCase.topK,
    topKResults: topKPaths,
    expectedBasenames,
    expectedHitCount,
    forbiddenBasenames,
    forbiddenHits,
    directoryCounts,
    maxDirectoryCount,
    expectedWarningCodes: expectedWarnings,
    warningCodes: codes,
    canAskCopilotForFinalAnswer: actualCanAsk,
    answerPolicy: quality(result).answerPolicy ?? "unknown",
    latencyMs,
    maxLatencyMs: testCase.maxLatencyMs,
  };
}

function aggregateSummaries(summaries) {
  const totalExpected = summaries.reduce((sum, item) => sum + item.expectedBasenames.length, 0);
  const totalExpectedHits = summaries.reduce((sum, item) => sum + item.expectedHitCount, 0);
  return {
    caseCount: summaries.length,
    passedCaseCount: summaries.filter((item) => item.passed).length,
    failedCaseCount: summaries.filter((item) => !item.passed).length,
    expectedTopKCoverage: totalExpected > 0 ? totalExpectedHits / totalExpected : 1,
    expectedTopKHitCount: totalExpectedHits,
    expectedTopKTargetCount: totalExpected,
    folderSkewFailureCount: summaries.filter((item) => item.failureReasons.some((reason) => reason.startsWith("folder_skew:"))).length,
    forbiddenFalsePositiveCount: summaries.reduce((sum, item) => sum + item.forbiddenHits.length, 0),
    unsupportedClaimFailureCount: summaries.filter((item) =>
      item.failureReasons.some((reason) => reason.startsWith("unsupported_claim_policy:")),
    ).length,
    warningFailureCount: summaries.filter((item) =>
      item.failureReasons.some((reason) => reason.startsWith("missing_warning:")),
    ).length,
    latencyFailureCount: summaries.filter((item) => item.failureReasons.some((reason) => reason.startsWith("latency:"))).length,
    maxLatencyMs: Math.max(0, ...summaries.map((item) => item.latencyMs)),
  };
}

function renderMarkdown({ generatedAt, fixtureCount, summaries, aggregate }) {
  const rows = summaries.map((item) => [
    item.id,
    item.purpose,
    item.passed ? "pass" : "fail",
    `${item.expectedHitCount}/${item.expectedBasenames.length}`,
    item.forbiddenHits.length ? item.forbiddenHits.join(", ") : "-",
    item.maxDirectoryCount,
    item.warningCodes.length ? item.warningCodes.join(", ") : "-",
    item.canAskCopilotForFinalAnswer ? "yes" : "no",
    `${item.latencyMs}/${item.maxLatencyMs}`,
  ]);
  return `# Workspace Document Search Golden Queries

Generated: ${generatedAt}

## Scope

WDS09 runs a privacy-safe golden-query gate for Workspace Document Search. The
gate uses a synthetic Markdown corpus created under a temporary directory for
each run, then removes that directory after evaluation.

## Privacy Boundary

- The committed report records case IDs, aggregate counts, warning codes, and
  synthetic relative fixture labels only.
- It does not store original business documents, snippets, extracted document
  text, raw SQLite/FTS rows, raw DB contents, or absolute source paths.
- The fixture corpus is generated by
  \`scripts/relay-document-search-golden-query-gate.mjs\`; no user/shared-folder
  corpus is read by the default gate.
- Temporary working directory pattern: \`relay-wds09-golden-*\`.

## Acceptance Gates

- Expected top-k coverage must meet each case threshold.
- Folder skew must stay within the declared top-k per-directory limit.
- Forbidden false positives must not appear in returned results.
- Unsupported or no-result queries must not allow final Copilot answer wording.
- Expected warning codes must be present.
- Each query must finish within the latency budget.

## Fixture Corpus

- Synthetic files: ${fixtureCount}
- File type: Markdown
- Domains covered: finance cash-flow, board liquidity review, legal contracts,
  and archived payroll distractors.

## Results

| Case | Purpose | Gate | Expected Top-K | Forbidden Hits | Max Directory Count | Warnings | Final Answer Allowed | Latency ms |
| --- | --- | --- | ---: | --- | ---: | --- | --- | ---: |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Summary

- Passed cases: ${aggregate.passedCaseCount}/${aggregate.caseCount}.
- Expected top-k coverage: ${aggregate.expectedTopKHitCount}/${aggregate.expectedTopKTargetCount} (${aggregate.expectedTopKCoverage.toFixed(2)}).
- Folder-skew failures: ${aggregate.folderSkewFailureCount}.
- Forbidden false positives: ${aggregate.forbiddenFalsePositiveCount}.
- Unsupported-claim failures: ${aggregate.unsupportedClaimFailureCount}.
- Warning-code failures: ${aggregate.warningFailureCount}.
- Latency failures: ${aggregate.latencyFailureCount}.
- Maximum observed query latency: ${aggregate.maxLatencyMs} ms.

## Command

\`\`\`bash
node scripts/relay-document-search-golden-query-gate.mjs --generated-at ${generatedAt}
\`\`\`
`;
}

export async function runGoldenQueryGate(options = {}) {
  const args = {
    output: options.output ? resolve(options.output) : defaultOutput,
    jsonOutput: options.jsonOutput ? resolve(options.jsonOutput) : defaultJsonOutput,
    generatedAt: options.generatedAt ?? defaultGeneratedAt,
    keepTemp: Boolean(options.keepTemp),
    maxLatencyMs: options.maxLatencyMs ?? defaultMaxLatencyMs,
  };
  const tempDir = resolve(tmpdir(), `relay-wds09-golden-${process.pid}`);
  mkdirSync(tempDir, { recursive: true });
  const { module, cleanup } = await loadRelayDocumentSearchExecutorModule({ repoRoot });
  try {
    const { corpusRoot, fixtureCount } = createFixtureCorpus(tempDir);
    const summaries = [];
    const indexDbPath = resolve(tempDir, "document-search.sqlite");
    for (const testCase of goldenCases(corpusRoot, args.maxLatencyMs)) {
      const started = Date.now();
      const result = await module.executeRelayDocumentSearch(
        testCase.request,
        {
          jobId: `wds09-${testCase.id}`,
          queryId: `wds09-${testCase.id}`,
          now: new Date(args.generatedAt),
          useIndexDb: testCase.useIndexDb ?? true,
          indexDbPath,
          maxScanFiles: 1000,
          maxContentInspectFiles: 100,
          timeoutMs: args.maxLatencyMs,
        },
      );
      summaries.push(evaluateCase(testCase, result, Date.now() - started, corpusRoot));
    }
    const aggregate = aggregateSummaries(summaries);
    const report = renderMarkdown({
      generatedAt: args.generatedAt,
      fixtureCount,
      summaries,
      aggregate,
    });
    writeFileSync(args.output, report, "utf8");
    const json = {
      output: relative(repoRoot, args.output),
      passed: aggregate.failedCaseCount === 0,
      ...aggregate,
      cases: summaries.map((item) => ({
        id: item.id,
        passed: item.passed,
        failureReasons: item.failureReasons,
        expectedHitCount: item.expectedHitCount,
        expectedTargetCount: item.expectedBasenames.length,
        forbiddenHitCount: item.forbiddenHits.length,
        maxDirectoryCount: item.maxDirectoryCount,
        warningCodes: item.warningCodes,
        canAskCopilotForFinalAnswer: item.canAskCopilotForFinalAnswer,
        latencyMs: item.latencyMs,
      })),
    };
    if (args.jsonOutput) writeFileSync(args.jsonOutput, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    return json;
  } finally {
    cleanup();
    if (!args.keepTemp) rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runGoldenQueryGate(args);
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
