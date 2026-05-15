import type { RelayDocumentSearchQueryPlanHints, RelaySearchResultCard } from "./ipc";

const SEARCH_PLAN_SCHEMA_VERSION = "RelayDocumentSearchCopilotQueryPlan.v1";
const SEARCH_RESULT_SCHEMA_VERSION = "RelayDocumentSearchCopilotResultSummary.v1";
const OFFICE_PLAN_SCHEMA_VERSION = "RelayOfficeEditPlan.v1";

const SEARCH_INTENTS = new Set(["find_files", "answer_with_evidence", "summarize_with_evidence", "inspect_file", "similar_documents"]);
const EVIDENCE_MODES = new Set(["none", "candidate", "required"]);
const THOROUGHNESS = new Set(["quick", "thorough"]);
const FILE_TYPES = new Set(["any", "txt", "md", "csv", "docx", "xlsx", "xlsm", "pptx", "pdf"]);
const TIME_SCOPE_INTENTS = new Set(["latest_first", "historical_examples", "balanced", "explicit_period", "unknown"]);
const OFFICE_RISK_LEVELS = new Set(["low", "medium", "high"]);
const RESULT_CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

type JsonRecord = Record<string, unknown>;

export type RelayOfficePlanCommand = {
  summary: string;
  argv: string[];
};

export type RelayOfficeEditPlan = {
  schemaVersion: "RelayOfficeEditPlan.v1";
  rawInstruction: string;
  filePath: string;
  risk: "low" | "medium" | "high";
  commands: RelayOfficePlanCommand[];
  summary?: string;
};

export type RelayDocumentSearchResultCategory = {
  label: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  candidateIds: string[];
  paths: string[];
};

export type RelayDocumentSearchResultSummary = {
  schemaVersion: "RelayDocumentSearchCopilotResultSummary.v1";
  rawQuery: string;
  snapshotId: string;
  summary: string;
  categories: RelayDocumentSearchResultCategory[];
  caveats: string[];
};

export type PlannerValidation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function candidateIdForResultIndex(index: number): string {
  return `candidate-${String(index + 1).padStart(3, "0")}`;
}

export function buildLocalDocumentSearchResultSummary(params: {
  rawQuery: string;
  snapshotId: string;
  resultSummary: string;
  coverageLabel: string;
  cards: RelaySearchResultCard[];
}): RelayDocumentSearchResultSummary {
  const caveats = new Set<string>();
  if (params.coverageLabel) caveats.add(params.coverageLabel);
  if (params.cards.some((card) => (card.evidenceState || card.matchMode) === "filename_only")) {
    caveats.add("一部または全部の候補はファイル名・パスからの推定で、内容確認は未完了です。");
  }
  return {
    schemaVersion: SEARCH_RESULT_SCHEMA_VERSION,
    rawQuery: params.rawQuery,
    snapshotId: params.snapshotId,
    summary: params.resultSummary || "ローカル検索の候補を表示しています。",
    categories: [],
    caveats: [...caveats].slice(0, 6),
  };
}

export function buildDocumentSearchPlanPrompt(params: {
  userQuery: string;
  workspacePath: string;
}): string {
  const userQuery = params.userQuery.trim();
  return [
    "RELAY DOCUMENT SEARCH QUERY PLAN COMPILER",
    "Mode: document_search_query_plan. This is not a chat-answer task.",
    "Your only job is to fill one JSON object that expands the user's local document search query.",
    "Do not call tools. Do not search Microsoft 365, SharePoint, the web, memory, plugins, or local files.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: SEARCH_PLAN_SCHEMA_VERSION,
      rawQuery: userQuery,
      intent: "find_files",
      evidence: "candidate",
      thoroughness: "thorough",
      expandedTerms: ["term or synonym"],
      supportTerms: ["supporting workflow term"],
      demoteTerms: ["output/review/backup term to avoid overranking"],
      fileTypeHints: ["any"],
      timeScopeIntent: "balanced",
      summary: "short reason for the expansion",
    }),
    "Rules:",
    `- schemaVersion must be ${SEARCH_PLAN_SCHEMA_VERSION}.`,
    "- rawQuery must equal USER REQUEST DATA exactly.",
    "- intent must be find_files for this UI mode.",
    "- evidence must be candidate.",
    "- thoroughness must be thorough.",
    "- expandedTerms should include direct synonyms, abbreviations, Japanese variants, English variants, and business aliases that can stand on their own.",
    "- For compound business concepts, keep the user's core concept intact. Example: 部品売上 means parts AND sales, not generic sales alone.",
    "- supportTerms should include workflow or workpaper terms that improve recall only after the core concept is present.",
    "- demoteTerms should include output/review/backup terms only when those are likely copies rather than source files.",
    "- fileTypeHints may include any, txt, md, csv, docx, xlsx, xlsm, pptx, pdf. Use any unless the user clearly narrows file type.",
    "- timeScopeIntent must be latest_first, historical_examples, balanced, explicit_period, or unknown.",
    "- Do not include roots, path, recipient_name, tool_calls, tool_uses, glob patterns, bash commands, or any field not shown in the schema.",
    "Examples:",
    "- 部品売上 -> expandedTerms can include 部品売上, 部品他売上, パーツ売上, 部販, 補修部品売上, parts sales, service parts revenue; supportTerms can include 国内DL, 実績データ, 内訳, 明細.",
    "- キャッシュフロー計算書 -> expandedTerms can include キャッシュフロー, CFS, CF, 連結CF, 連結CFS; supportTerms can include 精算表, 合算, ADJ.",
    `Relay-selected workspace context (do not rewrite it): ${params.workspacePath}`,
    "USER REQUEST DATA:",
    JSON.stringify(userQuery),
    "Return the query-plan JSON object now.",
  ].join("\n");
}

export function buildDocumentSearchResultSummaryPrompt(params: {
  rawQuery: string;
  snapshotId: string;
  workspacePath: string;
  localSummary: string;
  coverageLabel: string;
  cards: RelaySearchResultCard[];
}): string {
  const cardFacts = params.cards.slice(0, 80).map((card, index) => ({
    candidateId: candidateIdForResultIndex(index),
    position: index + 1,
    title: card.title,
    displayPath: (card.displayPath || card.path).replaceAll("\\", "/"),
    fileType: card.fileType || "",
    modifiedTime: card.modifiedTime || "",
    evidenceState: card.evidenceState || card.matchMode || "candidate",
    score: typeof card.score === "number" ? card.score : null,
    warnings: card.warnings.slice(0, 8),
  }));
  return [
    "RELAY DOCUMENT SEARCH RESULT ORGANIZER",
    "Mode: document_search_result_summary. This is not a search task.",
    "Your only job is to organize the completed local Relay search results into a concise JSON summary.",
    "Do not call tools. Do not search Microsoft 365, SharePoint, the web, memory, plugins, or local files.",
    "Do not claim file contents are confirmed unless evidenceState says content_confirmed.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: SEARCH_RESULT_SCHEMA_VERSION,
      rawQuery: params.rawQuery,
      snapshotId: params.snapshotId,
      summary: "one or two short Japanese sentences for the visible result snapshot",
      categories: [
        {
          label: "dynamic category label based only on these results",
          rationale: "why these files belong together, based only on names/paths/evidence states",
          confidence: "medium",
          candidateIds: ["candidate-001"],
        },
      ],
      caveats: ["short caveat when content is not confirmed or coverage is partial"],
    }),
    "Rules:",
    `- schemaVersion must be ${SEARCH_RESULT_SCHEMA_VERSION}.`,
    "- rawQuery must equal USER REQUEST DATA exactly.",
    "- snapshotId must equal SNAPSHOT ID exactly.",
    "- categories must be dynamic. Do not force fixed labels such as 作業元, 出力, 監査, バックアップ unless the result facts themselves support them.",
    "- Each category must include one or more exact candidateIds from CANDIDATE FACTS.",
    "- Never output file paths. The app will map candidateIds back to local paths.",
    "- A candidateId may appear in at most one category.",
    "- Use at most eight categories and keep labels short.",
    "- If the evidenceState is filename_only, call it a candidate and do not state that the document content proves relevance.",
    "- Do not include markdown, prose outside JSON, tool calls, citations, or fields not shown in the schema.",
    "SNAPSHOT ID:",
    params.snapshotId,
    "WORKSPACE:",
    params.workspacePath,
    "LOCAL RELAY SUMMARY:",
    params.localSummary,
    "COVERAGE:",
    params.coverageLabel,
    "CANDIDATE FACTS:",
    JSON.stringify(cardFacts),
    "USER REQUEST DATA:",
    JSON.stringify(params.rawQuery),
    "Return the result-summary JSON object now.",
  ].join("\n");
}

export function buildOfficeEditPlanPrompt(params: {
  instruction: string;
  filePath: string;
  outlineJson?: string;
}): string {
  const instruction = params.instruction.trim();
  return [
    "RELAY OFFICE EDIT PLAN COMPILER",
    "Mode: office_edit_plan. This is not a chat-answer task.",
    "Your only job is to translate the user's Office-file instruction into reviewed OfficeCLI argv arrays.",
    "Do not call tools. Do not edit files. Do not use Microsoft 365 built-in editing, SharePoint, web search, plugins, or local file tools.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: OFFICE_PLAN_SCHEMA_VERSION,
      rawInstruction: instruction,
      filePath: params.filePath,
      risk: "medium",
      commands: [
        {
          summary: "short operation summary",
          argv: ["view", params.filePath, "outline", "--json"],
        },
      ],
      summary: "short plan summary",
    }),
    "Rules:",
    `- schemaVersion must be ${OFFICE_PLAN_SCHEMA_VERSION}.`,
    "- rawInstruction must equal USER REQUEST DATA exactly.",
    "- filePath must equal TARGET FILE exactly.",
    "- commands must contain one to five OfficeCLI commands as argv arrays; do not include the officecli executable name.",
    "- Every command argv must include TARGET FILE exactly once.",
    "- Add --json to every command.",
    "- For Excel ranges, use a sheet-qualified path like \"/Sheet1/A1\". Use exact sheet names from OFFICE OUTLINE JSON.",
    "- If the user writes a spaced sheet name such as `Sheet 1` and the outline has a single close match such as `Sheet1`, use the exact outline name.",
    "- For simple Excel cell color requests, prefer an argv like [\"set\", filePath, \"/Sheet1/A1\", \"--prop\", \"fill=FF0000\", \"--json\"].",
    "- If the target sheet/range/object is ambiguous, return a safe inspection command such as [\"view\", filePath, \"outline\", \"--json\"] rather than guessing an edit.",
    "- Do not include shell syntax, markdown, prose, command strings, PowerShell, Bash, VBA, or fields not shown in the schema.",
    "TARGET FILE:",
    params.filePath,
    "OFFICE OUTLINE JSON:",
    params.outlineJson?.slice(0, 12000) || "(not inspected)",
    "USER REQUEST DATA:",
    JSON.stringify(instruction),
    "Return the Office edit plan JSON object now.",
  ].join("\n");
}

export function validateDocumentSearchPlanText(text: string, rawQuery: string): PlannerValidation<RelayDocumentSearchQueryPlanHints> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateDocumentSearchPlan(parsed.value, rawQuery);
}

export function validateDocumentSearchResultSummaryText(
  text: string,
  rawQuery: string,
  snapshotId: string,
  candidatePathById: Map<string, string>,
): PlannerValidation<RelayDocumentSearchResultSummary> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateDocumentSearchResultSummary(parsed.value, rawQuery, snapshotId, candidatePathById);
}

export function validateOfficeEditPlanText(text: string, rawInstruction: string, filePath: string): PlannerValidation<RelayOfficeEditPlan> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateOfficeEditPlan(parsed.value, rawInstruction, filePath);
}

export function officePlanToArgs(command: RelayOfficePlanCommand): string {
  return command.argv.map(quoteArg).join(" ");
}

function parseStrictJsonObject(text: string): PlannerValidation<JsonRecord> {
  const raw = text.trim();
  if (!raw) return { ok: false, errors: ["Copilot returned an empty response."] };
  if (!raw.startsWith("{") || !raw.endsWith("}")) {
    return { ok: false, errors: ["Copilot must return exactly one JSON object with no prose or markdown."] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return { ok: false, errors: ["Copilot JSON must be an object."] };
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, errors: [`Copilot returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function validateDocumentSearchPlan(value: JsonRecord, rawQuery: string): PlannerValidation<RelayDocumentSearchQueryPlanHints> {
  const errors: string[] = [];
  rejectUnknownFields(value, [
    "schemaVersion",
    "rawQuery",
    "intent",
    "evidence",
    "thoroughness",
    "expandedTerms",
    "supportTerms",
    "demoteTerms",
    "fileTypeHints",
    "timeScopeIntent",
    "summary",
  ], errors, "query plan");
  if (value.schemaVersion !== SEARCH_PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${SEARCH_PLAN_SCHEMA_VERSION}.`);
  if (value.rawQuery !== rawQuery) errors.push("rawQuery must exactly match the original user request.");
  const intent = enumValue(value.intent, SEARCH_INTENTS, "intent", errors);
  const evidence = enumValue(value.evidence, EVIDENCE_MODES, "evidence", errors);
  const thoroughness = enumValue(value.thoroughness, THOROUGHNESS, "thoroughness", errors);
  const expandedTerms = stringArray(value.expandedTerms, "expandedTerms", 40, errors);
  const supportTerms = stringArray(value.supportTerms, "supportTerms", 40, errors);
  const demoteTerms = stringArray(value.demoteTerms, "demoteTerms", 40, errors);
  const fileTypeHints = enumArray(value.fileTypeHints, FILE_TYPES, "fileTypeHints", 10, errors);
  const timeScopeIntent = value.timeScopeIntent === undefined ? undefined : enumValue(value.timeScopeIntent, TIME_SCOPE_INTENTS, "timeScopeIntent", errors);
  const summary = value.summary === undefined ? undefined : stringValue(value.summary, "summary", 280, errors);
  if (intent !== "find_files") errors.push("intent must be find_files in the document-search UI.");
  if (evidence !== "candidate") errors.push("evidence must be candidate in the document-search UI.");
  if (thoroughness !== "thorough") errors.push("thoroughness must be thorough in the document-search UI.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: SEARCH_PLAN_SCHEMA_VERSION,
      rawQuery,
      intent: "find_files",
      evidence: "candidate",
      thoroughness: "thorough",
      expandedTerms,
      supportTerms,
      demoteTerms,
      fileTypeHints: fileTypeHints.length ? fileTypeHints : ["any"],
      timeScopeIntent: (timeScopeIntent || "unknown") as RelayDocumentSearchQueryPlanHints["timeScopeIntent"],
      summary,
    },
  };
}

function validateOfficeEditPlan(value: JsonRecord, rawInstruction: string, filePath: string): PlannerValidation<RelayOfficeEditPlan> {
  const errors: string[] = [];
  rejectUnknownFields(value, ["schemaVersion", "rawInstruction", "filePath", "risk", "commands", "summary"], errors, "Office plan");
  if (value.schemaVersion !== OFFICE_PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${OFFICE_PLAN_SCHEMA_VERSION}.`);
  if (value.rawInstruction !== rawInstruction) errors.push("rawInstruction must exactly match the original user instruction.");
  if (value.filePath !== filePath) errors.push("filePath must exactly match the selected file.");
  const risk = enumValue(value.risk, OFFICE_RISK_LEVELS, "risk", errors);
  const summary = value.summary === undefined ? undefined : stringValue(value.summary, "summary", 280, errors);
  const commands = validateOfficeCommands(value.commands, filePath, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: OFFICE_PLAN_SCHEMA_VERSION,
      rawInstruction,
      filePath,
      risk: risk as RelayOfficeEditPlan["risk"],
      commands,
      summary,
    },
  };
}

function validateDocumentSearchResultSummary(
  value: JsonRecord,
  rawQuery: string,
  snapshotId: string,
  candidatePathById: Map<string, string>,
): PlannerValidation<RelayDocumentSearchResultSummary> {
  const errors: string[] = [];
  rejectUnknownFields(value, ["schemaVersion", "rawQuery", "snapshotId", "summary", "categories", "caveats"], errors, "result summary");
  if (value.schemaVersion !== SEARCH_RESULT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${SEARCH_RESULT_SCHEMA_VERSION}.`);
  if (value.rawQuery !== rawQuery) errors.push("rawQuery must exactly match the original user request.");
  if (value.snapshotId !== snapshotId) errors.push("snapshotId must exactly match the Relay snapshot id.");
  const summary = stringValue(value.summary, "summary", 420, errors);
  const caveats = stringArray(value.caveats, "caveats", 6, errors).map((item) => item.slice(0, 160));
  const categories = validateResultCategories(value.categories, candidatePathById, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: SEARCH_RESULT_SCHEMA_VERSION,
      rawQuery,
      snapshotId,
      summary,
      categories,
      caveats,
    },
  };
}

function validateResultCategories(
  value: unknown,
  candidatePathById: Map<string, string>,
  errors: string[],
): RelayDocumentSearchResultCategory[] {
  if (!Array.isArray(value)) {
    errors.push("categories must be an array.");
    return [];
  }
  if (value.length > 8) errors.push("categories may contain at most eight entries.");
  const usedIds = new Set<string>();
  const categories: RelayDocumentSearchResultCategory[] = [];
  value.slice(0, 8).forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`categories[${index}] must be an object.`);
      return;
    }
    rejectUnknownFields(entry, ["label", "rationale", "confidence", "candidateIds"], errors, `categories[${index}]`);
    const label = stringValue(entry.label, `categories[${index}].label`, 40, errors);
    const rationale = stringValue(entry.rationale, `categories[${index}].rationale`, 220, errors);
    const confidence = enumValue(entry.confidence, RESULT_CONFIDENCE_LEVELS, `categories[${index}].confidence`, errors);
    const candidateIds = exactCandidateIdArray(entry.candidateIds, `categories[${index}].candidateIds`, 30, candidatePathById, usedIds, errors);
    const paths = candidateIds.map((candidateId) => candidatePathById.get(candidateId)).filter((path): path is string => Boolean(path));
    if (label && rationale && confidence && candidateIds.length && paths.length) {
      categories.push({
        label,
        rationale,
        confidence: confidence as RelayDocumentSearchResultCategory["confidence"],
        candidateIds,
        paths,
      });
    }
  });
  return categories;
}

function exactCandidateIdArray(
  value: unknown,
  field: string,
  maxItems: number,
  allowedCandidateIds: Map<string, string>,
  usedCandidateIds: Set<string>,
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${field} may contain at most ${maxItems} entries.`);
  const out: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== "string" || !item.trim()) {
      errors.push(`${field} entries must be non-empty strings.`);
      continue;
    }
    const candidateId = item.trim();
    if (hasControlCharacters(candidateId)) errors.push(`${field} entries must not contain control characters.`);
    if (!allowedCandidateIds.has(candidateId)) {
      errors.push(`${field} includes a candidateId that was not in the Relay candidate set: ${candidateId}`);
      continue;
    }
    if (usedCandidateIds.has(candidateId)) {
      errors.push(`${field} includes a candidateId already assigned to another category: ${candidateId}`);
      continue;
    }
    usedCandidateIds.add(candidateId);
    out.push(candidateId);
  }
  return out;
}

function validateOfficeCommands(value: unknown, filePath: string, errors: string[]): RelayOfficePlanCommand[] {
  if (!Array.isArray(value)) {
    errors.push("commands must be an array.");
    return [];
  }
  if (value.length < 1 || value.length > 5) errors.push("commands must contain one to five entries.");
  const commands: RelayOfficePlanCommand[] = [];
  value.slice(0, 5).forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`commands[${index}] must be an object.`);
      return;
    }
    rejectUnknownFields(entry, ["summary", "argv"], errors, `commands[${index}]`);
    const summary = stringValue(entry.summary, `commands[${index}].summary`, 160, errors);
    if (!Array.isArray(entry.argv)) {
      errors.push(`commands[${index}].argv must be an array.`);
      return;
    }
    const argv = entry.argv.map((item, argIndex) => {
      if (typeof item !== "string" || !item.trim()) {
        errors.push(`commands[${index}].argv[${argIndex}] must be a non-empty string.`);
        return "";
      }
      if (hasControlOrShellSyntax(item)) errors.push(`commands[${index}].argv[${argIndex}] contains forbidden shell syntax.`);
      return item.trim();
    }).filter(Boolean);
    if (argv.length < 2 || argv.length > 30) errors.push(`commands[${index}].argv must contain 2 to 30 arguments.`);
    if (/^officecli(?:\.exe)?$/iu.test(argv[0] || "")) errors.push(`commands[${index}].argv must not include the officecli executable.`);
    if (!/^[a-z][a-z0-9_-]*$/iu.test(argv[0] || "")) errors.push(`commands[${index}].argv[0] must be an OfficeCLI verb.`);
    const fileOccurrences = argv.filter((arg) => arg === filePath).length;
    if (fileOccurrences !== 1) errors.push(`commands[${index}].argv must include the selected file path exactly once.`);
    if (!argv.includes("--json")) argv.push("--json");
    commands.push({ summary, argv });
  });
  return commands;
}

function rejectUnknownFields(value: JsonRecord, allowed: string[], errors: string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedSet.has(field)) errors.push(`Unknown ${label} field: ${field}.`);
  }
}

function enumValue(value: unknown, allowed: Set<string>, field: string, errors: string[]): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    errors.push(`${field} must be one of: ${[...allowed].join(", ")}.`);
    return "";
  }
  return value;
}

function enumArray(value: unknown, allowed: Set<string>, field: string, maxItems: number, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${field} may contain at most ${maxItems} entries.`);
  const out = new Set<string>();
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== "string" || !allowed.has(item)) {
      errors.push(`${field} contains unsupported value: ${String(item)}.`);
      continue;
    }
    out.add(item);
  }
  return [...out];
}

function stringArray(value: unknown, field: string, maxItems: number, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${field} may contain at most ${maxItems} entries.`);
  const out = new Set<string>();
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== "string" || !item.trim()) {
      errors.push(`${field} entries must be non-empty strings.`);
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length > 80) errors.push(`${field} entries must be 80 characters or less.`);
    if (hasControlCharacters(trimmed)) errors.push(`${field} entries must not contain control characters.`);
    out.add(trimmed.slice(0, 80));
  }
  return [...out];
}

function stringValue(value: unknown, field: string, maxLength: number, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return "";
  }
  if (hasControlCharacters(value)) errors.push(`${field} must not contain control characters.`);
  return value.trim().slice(0, maxLength);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function hasControlOrShellSyntax(value: string): boolean {
  return /[\u0000-\u001f\u007f;&|<>`]/u.test(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function quoteArg(value: string): string {
  if (/^[^\s"';&|<>`]+$/u.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replaceAll('"', '\\"')}"`;
}
