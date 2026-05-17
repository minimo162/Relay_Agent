const defaultAllowedTools = new Set(["glob", "grep", "read"]);
const defaultDomainTerms = [
  "部品",
  "サービス",
  "補修",
  "パーツ",
  "parts",
  "service",
  "revenue",
  "sales",
  "after",
  "aftermarket",
];

export function computeDciMetrics(calls, final, options = {}) {
  const allowedTools = new Set(options.allowedTools ?? [...defaultAllowedTools]);
  const goldPath = normalizePath(options.goldPath ?? "");
  const hardNegativePaths = normalizePathArray(options.hardNegativePaths ?? []);
  const domainTerms = normalizeTermArray(options.domainTerms ?? defaultDomainTerms).map((term) => term.toLowerCase());
  const evidencePattern = options.evidencePattern ?? /売上実績|parts sales|service parts revenue/;
  const grepCalls = calls.filter((call) => call.name === "grep");
  const readCalls = calls.filter((call) => call.name === "read");
  const grepArgs = grepCalls.map((call) => parseJsonObject(call.args));
  const grepMatchPaths = grepCalls.flatMap((call) => grepMatchPathsFromResults(call));
  const globPaths = calls.filter((call) => call.name === "glob").flatMap((call) => globPathsFromResults(call));
  const readTargets = readCalls.map((call) => readTarget(call)).filter(Boolean);
  const readObservations = readCalls.flatMap((call) => readObservationsFromResults(call));
  const allTermLists = grepArgs.flatMap((args) => normalizeTermArray(args.allTerms));
  const anyTermLists = grepArgs.flatMap((args) => normalizeTermArray(args.anyTerms));
  const allTerms = [...allTermLists, ...anyTermLists].map((term) => term.toLowerCase());
  const observedPaths = [...new Set([...globPaths, ...grepMatchPaths, ...readObservations.map((observation) => normalizePath(observation?.displayPath ?? ""))].filter(Boolean))];
  const acceptedReadSources = [...new Set([...observedPaths, goldPath, ...hardNegativePaths].filter(Boolean))];
  const finalNormalized = normalizePath(final);
  const failedTools = calls.filter((call) => toolResultFailed(call));
  const inventedReadTargets = readTargets.filter((target) => !acceptedReadSources.some((path) => target.endsWith(path)));
  const grepContextLabels = grepCalls.flatMap((call) => grepContextLabelsFromResults(call));
  const readContextLabels = readObservations.flatMap((observation) => normalizeTermArray(observation?.contextLabels));

  return {
    schemaVersion: "RelayDciTrajectoryMetrics.v1",
    goldPath,
    hardNegativePaths,
    tools: calls.map((call) => call.name),
    grepArgs,
    grepMatchPaths,
    globPaths,
    readTargets,
    observedPaths,
    failedToolCount: failedTools.length,
    inventedReadTargets,
    grepContextLabels,
    readContextLabels,
    noRetrieverTools: calls.every((call) => allowedTools.has(call.name)),
    noFailedTools: failedTools.length === 0,
    noInventedReadTargets: inventedReadTargets.length === 0,
    weakClueConjunction: grepArgs.some((args) => normalizeTermArray(args.allTerms).length >= 2 || normalizeTermArray(args.anyTerms).length >= 2),
    queryExpansionFromAmbiguity: domainTerms.some((term) => allTerms.some((observed) => observed.includes(term))),
    coverageAny: goldPath ? grepMatchPaths.includes(goldPath) : grepMatchPaths.length > 0,
    coverageHardNegatives: hardNegativePaths.filter((path) => grepMatchPaths.includes(path)),
    localizationExactRead: goldPath ? readTargets.some((target) => target.endsWith(goldPath)) : readTargets.length > 0,
    evidenceSpanLocalized: readObservations.some((observation) => {
      const observationPath = normalizePath(observation?.displayPath ?? "");
      const pathMatches = goldPath ? observationPath === goldPath : Boolean(observationPath);
      return pathMatches && evidencePattern.test(String(observation?.text ?? ""));
    }),
    hardNegativeRejected: goldPath
      ? finalNormalized.includes(goldPath) && hardNegativePaths.every((path) => !finalNormalized.includes(path))
      : hardNegativePaths.every((path) => !finalNormalized.includes(path)),
  };
}

export function assertDciMetrics(metrics, required = {}) {
  for (const key of Object.keys(required)) {
    if (metrics[key] !== required[key]) {
      throw new Error(`DCI metric ${key} expected ${required[key]} but got ${metrics[key]}: ${JSON.stringify(metrics, null, 2)}`);
    }
  }
}

function grepMatchPathsFromResults(call) {
  const paths = [];
  for (const result of call.results) {
    const parsed = parseJsonObject(result);
    const matches = parsed?.data?.matches;
    if (Array.isArray(matches)) {
      for (const match of matches) {
        if (typeof match?.displayPath === "string") paths.push(normalizePath(match.displayPath));
      }
    }
  }
  return paths;
}

function grepContextLabelsFromResults(call) {
  const labels = [];
  for (const result of call.results) {
    const parsed = parseJsonObject(result);
    const matches = parsed?.data?.matches;
    if (Array.isArray(matches)) {
      for (const match of matches) labels.push(...normalizeTermArray(match?.contextLabels));
    }
  }
  return labels;
}

function globPathsFromResults(call) {
  const paths = [];
  for (const result of call.results) {
    const parsed = parseJsonObject(result);
    if (Array.isArray(parsed?.data)) {
      for (const value of parsed.data) {
        if (typeof value === "string") paths.push(normalizePath(value));
      }
    }
  }
  return paths;
}

function readObservationsFromResults(call) {
  const observations = [];
  for (const result of call.results) {
    const parsed = parseJsonObject(result);
    if (parsed?.data?.schemaVersion === "RelayReadObservation.v1") observations.push(parsed.data);
  }
  return observations;
}

function toolResultFailed(call) {
  if (call.results.some((result) => String(result).includes("Error:"))) return true;
  return call.results.some((result) => {
    const parsed = parseJsonObject(result);
    return parsed?.success === false || parsed?.status === "failed";
  });
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeTermArray(value) {
  return Array.isArray(value)
    ? value.filter((term) => typeof term === "string" && term.trim()).map((term) => term.trim())
    : [];
}

function normalizePathArray(value) {
  return Array.isArray(value)
    ? value.filter((path) => typeof path === "string" && path.trim()).map((path) => normalizePath(path))
    : [];
}

function readTarget(call) {
  const parsed = parseJsonObject(call.args);
  return typeof parsed.file_path === "string" ? normalizePath(parsed.file_path) : "";
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}
