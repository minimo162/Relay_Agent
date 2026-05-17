#!/usr/bin/env node
import { buildDciTrajectory } from "./lib/dci-trajectory.mjs";
import { assertDciMetrics, computeDciMetrics } from "./lib/dci-metrics.mjs";

const gold = "evidence/q4-source.md";
const decoy = "notes/glossary.md";
const calls = [
  toolCall("glob", { pattern: "**/*" }, { success: true, tool: "glob", summary: "2 file candidates", data: [gold, decoy] }),
  toolCall("grep", { allTerms: ["部品", "売上"], includeGlobs: ["**/*.md"] }, {
    success: true,
    tool: "grep",
    summary: "2 content matches",
    data: {
      schemaVersion: "RelayGrepObservation.v1",
      pattern: "部品|売上",
      allTerms: ["部品", "売上"],
      anyTerms: [],
      excludeTerms: [],
      truncated: false,
      matches: [
        {
          displayPath: decoy,
          lineNumber: 2,
          excerpt: "用語ガイド: 部品売上という言葉の説明。これは根拠資料ではありません。",
          matchedTerms: ["部品", "売上"],
          contextLabels: ["guide_or_glossary", "negative_context"],
          evidenceState: "conjunctive_content_match",
        },
        {
          displayPath: gold,
          lineNumber: 3,
          excerpt: "FY160 4Q の部品 売上実績はこの集計表で確認する。",
          matchedTerms: ["部品", "売上"],
          contextLabels: ["possible_evidence"],
          evidenceState: "conjunctive_content_match",
        },
      ],
    },
  }),
  toolCall("read", { file_path: gold }, {
    success: true,
    tool: "read",
    summary: "120 chars read",
    data: {
      schemaVersion: "RelayReadObservation.v1",
      kind: "text",
      displayPath: gold,
      evidenceState: "exact_text",
      anchors: [{ kind: "text", displayPath: gold, startLine: 1, endLine: 4 }],
      text: "FY160 4Q の部品 売上実績はこの集計表で確認する。parts sales evidence.",
      contextLabels: ["possible_evidence"],
      textSha256: "fixture",
      truncated: false,
    },
  }),
];
const final = `根拠は ${gold} です。`;
const trajectory = buildDciTrajectory(calls, final);
if (trajectory.schemaVersion !== "RelayDciTrajectory.v1") {
  throw new Error(`unexpected trajectory schema: ${JSON.stringify(trajectory)}`);
}
if (trajectory.privacy.rawDocumentTextIncluded !== false) {
  throw new Error(`trajectory privacy flag is wrong: ${JSON.stringify(trajectory.privacy)}`);
}
if (trajectory.steps.find((step) => step.tool === "read")?.excerpt?.includes("parts sales evidence.") !== true) {
  throw new Error(`trajectory did not preserve bounded read evidence: ${JSON.stringify(trajectory.steps)}`);
}
if (!trajectory.rejectedDecoys.includes(decoy)) {
  throw new Error(`trajectory did not reject decoy: ${JSON.stringify(trajectory.rejectedDecoys)}`);
}
if (!trajectory.finalCitedEvidence.includes(gold)) {
  throw new Error(`trajectory did not record final citation: ${JSON.stringify(trajectory.finalCitedEvidence)}`);
}

const metrics = computeDciMetrics(calls, final, {
  goldPath: gold,
  hardNegativePaths: [decoy],
  evidencePattern: /部品 売上実績|parts sales evidence/,
  domainTerms: ["部品", "売上"],
});
assertDciMetrics(metrics, {
  noRetrieverTools: true,
  noFailedTools: true,
  noInventedReadTargets: true,
  weakClueConjunction: true,
  queryExpansionFromAmbiguity: true,
  coverageAny: true,
  localizationExactRead: true,
  evidenceSpanLocalized: true,
  hardNegativeRejected: true,
});

const failingMetrics = computeDciMetrics([
  ...calls,
  toolCall("read", { file_path: "invented/nope.md" }, { success: false, tool: "read", error: "not found", data: null }),
], `根拠は ${gold} です。`, {
  goldPath: gold,
  hardNegativePaths: [decoy],
  evidencePattern: /部品 売上実績|parts sales evidence/,
  domainTerms: ["部品", "売上"],
});
if (failingMetrics.noFailedTools !== false || failingMetrics.noInventedReadTargets !== false) {
  throw new Error(`failing metrics did not detect failed invented read: ${JSON.stringify(failingMetrics, null, 2)}`);
}

console.log("[dci-metrics-smoke] ok");

function toolCall(name, args, result) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2)}`,
    name,
    args: JSON.stringify(args),
    results: [JSON.stringify(result)],
  };
}
