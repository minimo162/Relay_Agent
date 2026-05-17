import { createHash } from "node:crypto";

const decoyLabels = new Set(["negative_context", "guide_or_glossary", "prior_period", "generic_context", "no_evidence"]);

export function buildDciTrajectory(calls, final = "", options = {}) {
  const excerptChars = Math.max(40, Math.min(Number(options.excerptChars ?? 240), 600));
  const steps = calls.map((call, index) => buildStep(call, index + 1, excerptChars));
  const searchedTerms = unique(steps.flatMap((step) => [
    ...arrayOfStrings(step.args?.allTerms),
    ...arrayOfStrings(step.args?.anyTerms),
    ...arrayOfStrings(step.args?.excludeTerms),
    stringOrEmpty(step.args?.pattern),
  ]).filter(Boolean));
  const surfacedPaths = unique(steps.flatMap((step) => step.surfacedPaths ?? []));
  const matchedPaths = unique(steps.flatMap((step) => step.matchedPaths ?? []));
  const readTargets = unique(steps.map((step) => step.readTarget).filter(Boolean));
  const failedReadTargets = unique(steps
    .filter((step) => step.tool === "read" && step.status !== "success")
    .map((step) => step.readTarget)
    .filter(Boolean));
  const contextLabels = unique(steps.flatMap((step) => step.contextLabels ?? []));
  const finalNormalized = normalizePath(final);
  const finalCitedEvidence = unique(surfacedPaths.filter((path) => finalNormalized.includes(path)));
  const rejectedDecoys = unique(steps.flatMap((step) => {
    const labels = step.contextLabels ?? [];
    if (!labels.some((label) => decoyLabels.has(label))) return [];
    return (step.matchedPaths?.length ? step.matchedPaths : step.surfacedPaths ?? [])
      .filter((path) => path && !finalNormalized.includes(path));
  }));

  return {
    schemaVersion: "RelayDciTrajectory.v1",
    tools: steps.map((step) => step.tool),
    steps,
    searchedTerms,
    surfacedPaths,
    matchedPaths,
    readTargets,
    zeroMatchCount: steps.filter((step) => step.zeroMatch).length,
    failedReadTargets,
    contextLabels,
    rejectedDecoys,
    finalCitedEvidence,
    privacy: {
      rawDocumentTextIncluded: false,
      excerptChars,
    },
  };
}

export function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function buildStep(call, index, excerptChars) {
  const args = parseJsonObject(call.args);
  const parsedResults = call.results.map((result) => parseJsonObject(result));
  const failed = call.results.some((result) => String(result).trimStart().startsWith("Error:")) ||
    parsedResults.some((result) => result?.success === false || result?.status === "failed");
  const firstObservation = parsedResults.find((result) => result?.data)?.data;
  const step = {
    index,
    tool: call.name,
    args,
    status: failed ? "failed" : "success",
    summary: parsedResults.map((result) => result.summary).find((summary) => typeof summary === "string") ?? "",
    surfacedPaths: [],
    matchedPaths: [],
    contextLabels: [],
  };

  if (call.name === "glob") {
    const paths = parsedResults.flatMap((result) => Array.isArray(result?.data) ? result.data : []);
    step.surfacedPaths = unique(paths.filter((path) => typeof path === "string").map(normalizePath));
    step.zeroMatch = step.surfacedPaths.length === 0;
  } else if (call.name === "grep") {
    const data = firstObservation?.schemaVersion === "RelayGrepObservation.v1" ? firstObservation : {};
    const matches = Array.isArray(data.matches) ? data.matches : [];
    step.pattern = typeof data.pattern === "string" ? data.pattern : stringOrEmpty(args.pattern);
    step.allTerms = arrayOfStrings(data.allTerms ?? args.allTerms);
    step.anyTerms = arrayOfStrings(data.anyTerms ?? args.anyTerms);
    step.excludeTerms = arrayOfStrings(data.excludeTerms ?? args.excludeTerms);
    step.truncated = data.truncated === true;
    step.zeroMatch = matches.length === 0;
    step.matches = matches.map((match) => compactMatch(match, excerptChars));
    step.surfacedPaths = unique(step.matches.map((match) => match.displayPath).filter(Boolean));
    step.matchedPaths = step.surfacedPaths;
    step.contextLabels = unique(step.matches.flatMap((match) => match.contextLabels ?? []));
    if (data.continuation) step.continuation = data.continuation;
  } else if (call.name === "read") {
    const data = firstObservation?.schemaVersion === "RelayReadObservation.v1" ? firstObservation : {};
    const displayPath = normalizePath(data.displayPath ?? args.file_path ?? args.path ?? "");
    step.readTarget = normalizePath(args.file_path ?? args.path ?? displayPath);
    step.surfacedPaths = displayPath ? [displayPath] : [];
    step.matchedPaths = step.surfacedPaths;
    step.anchors = Array.isArray(data.anchors) ? data.anchors : [];
    step.evidenceState = typeof data.evidenceState === "string" ? data.evidenceState : "";
    step.contextLabels = arrayOfStrings(data.contextLabels);
    step.textSha256 = typeof data.textSha256 === "string" ? data.textSha256 : "";
    step.excerpt = boundedExcerpt(data.text, excerptChars);
    if (step.excerpt && !step.textSha256) step.textSha256 = hashText(String(data.text ?? ""));
    step.truncated = data.truncated === true;
    if (data.continuation) step.continuation = data.continuation;
  }

  if (step.surfacedPaths.length === 0) delete step.surfacedPaths;
  if (step.matchedPaths.length === 0) delete step.matchedPaths;
  if (step.contextLabels.length === 0) delete step.contextLabels;
  return step;
}

function compactMatch(match, excerptChars) {
  const excerpt = boundedExcerpt(match?.excerpt, excerptChars);
  return {
    displayPath: normalizePath(match?.displayPath ?? ""),
    lineNumber: Number.isFinite(match?.lineNumber) ? match.lineNumber : undefined,
    matchedTerms: arrayOfStrings(match?.matchedTerms),
    contextLabels: arrayOfStrings(match?.contextLabels),
    evidenceState: typeof match?.evidenceState === "string" ? match.evidenceState : "",
    excerpt,
    textSha256: excerpt ? hashText(String(match?.excerpt ?? "")) : undefined,
  };
}

function boundedExcerpt(value, limit) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => normalizePath(value.trim())))];
}
