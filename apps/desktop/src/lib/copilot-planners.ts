import type { RelayCodeContextFile, RelayDocumentSearchQueryPlanHints, RelaySearchResultCard } from "./ipc";

const SEARCH_PLAN_SCHEMA_VERSION = "RelayDocumentSearchCopilotQueryPlan.v1";
const SEARCH_RESULT_SCHEMA_VERSION = "RelayDocumentSearchCopilotResultSummary.v1";
const SEARCH_REFLECTION_SCHEMA_VERSION = "RelayDocumentSearchReflection.v1";
const OFFICE_PLAN_SCHEMA_VERSION = "RelayOfficeEditPlan.v2";
const CODE_PATCH_SCHEMA_VERSION = "RelayCodePatchPlan.v2";
const AGENT_STEP_SCHEMA_VERSION = "RelayAgentStep.v1";

const SEARCH_INTENTS = new Set(["find_files", "answer_with_evidence", "summarize_with_evidence", "inspect_file", "similar_documents"]);
const EVIDENCE_MODES = new Set(["none", "candidate", "required"]);
const THOROUGHNESS = new Set(["quick", "thorough"]);
const FILE_TYPES = new Set(["any", "txt", "md", "csv", "docx", "xlsx", "xlsm", "pptx", "pdf"]);
const TIME_SCOPE_INTENTS = new Set(["latest_first", "historical_examples", "balanced", "explicit_period", "unknown"]);
const OFFICE_RISK_LEVELS = new Set(["low", "medium", "high"]);
const OFFICE_OPERATION_KINDS = new Set(["cell_format", "range_format", "cell_value", "inspect"]);
const OFFICE_FORMAT_PROPS = new Set(["fill", "fontColor", "bold", "italic", "numberFormat"]);
const CODE_RISK_LEVELS = new Set(["low", "medium", "high"]);
const RESULT_CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const SEARCH_REFLECTION_ACTIONS = new Set(["finalize", "refine"]);
const AGENT_MODES = new Set(["document_search", "office_edit", "code"]);
const AGENT_ACTIONS = new Set(["use_tool", "ask_user", "finish", "error"]);

export const RELAY_AGENT_TOOL_CATALOG = [
  {
    name: "relay_document_search",
    mode: "document_search",
    description: "Search local workspace documents using Relay-managed ripgrep, metadata, and safe content extraction.",
  },
  {
    name: "officecli",
    mode: "office_edit",
    description: "Inspect or edit a selected Office file with argv-only OfficeCLI commands. Relay creates backups before edits.",
  },
  {
    name: "collect_code_context",
    mode: "code",
    description: "Collect bounded workspace-relative source files relevant to a coding instruction.",
  },
  {
    name: "apply_code_patch",
    mode: "code",
    description: "Apply reviewed exact string replacements to workspace-relative source files.",
  },
] as const;

type JsonRecord = Record<string, unknown>;

export type RelayOfficePlanCommand = {
  summary: string;
  argv: string[];
};

export type RelayOfficeEditOperation = {
  kind: "cell_format" | "range_format" | "cell_value" | "inspect";
  summary: string;
  sheet?: string;
  range?: string;
  value?: string | number | boolean | null;
  props?: Record<string, string | number | boolean>;
};

export type RelayOfficeEditPlan = {
  schemaVersion: "RelayOfficeEditPlan.v2";
  risk: "low" | "medium" | "high";
  operations: RelayOfficeEditOperation[];
  commands: RelayOfficePlanCommand[];
  summary?: string;
};

export type RelayCodePatchPlanEdit = {
  relativePath: string;
  oldString: string;
  newString: string;
  summary: string;
};

export type RelayCodePatchPlan = {
  schemaVersion: "RelayCodePatchPlan.v2";
  risk: "low" | "medium" | "high";
  summary: string;
  edits: RelayCodePatchPlanEdit[];
  verificationCommands: string[];
};

export type RelayAgentMode = "document_search" | "office_edit" | "code";
export type RelayAgentAction = "use_tool" | "ask_user" | "finish" | "error";
export type RelayAgentToolName = (typeof RELAY_AGENT_TOOL_CATALOG)[number]["name"];

export type RelayAgentStep = {
  schemaVersion: "RelayAgentStep.v1";
  mode: RelayAgentMode;
  rawInstruction: string;
  action: RelayAgentAction;
  toolName?: RelayAgentToolName;
  input?: JsonRecord;
  rationale: string;
  userMessage?: string;
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

export type RelayDocumentSearchReflection = {
  schemaVersion: "RelayDocumentSearchReflection.v1";
  rawQuery: string;
  snapshotId: string;
  action: "finalize" | "refine";
  rationale: string;
  refinedTerms: string[];
  supportTerms: string[];
  demoteTerms: string[];
  summary?: string;
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
  if (params.cards.some((card) => ["concept_candidate", "entity_context_match"].includes(card.evidenceState || ""))) {
    caveats.add("一部の候補は名称や周辺文脈からの推定で、目的の業務概念そのものは未確定です。");
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
    "- Do not add terms that are only company names, department names, or owner names unless the user explicitly asks for that entity.",
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
    "Do not claim file contents are confirmed unless evidenceState says content_confirmed or concept_confirmed.",
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
    "- If the evidenceState is filename_only, concept_candidate, entity_context_match, partial_content_match, or generic_content_match, call it a candidate and do not state that the document content proves relevance.",
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

export function buildDocumentSearchReflectionPrompt(params: {
  rawQuery: string;
  snapshotId: string;
  workspacePath: string;
  localSummary: string;
  coverageLabel: string;
  queryPlan: RelayDocumentSearchQueryPlanHints;
  cards: RelaySearchResultCard[];
}): string {
  const cardFacts = params.cards.slice(0, 40).map((card, index) => ({
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
    "RELAY DOCUMENT SEARCH REFLECTION",
    "Mode: document_search_reflection. This is not a chat-answer task.",
    "Your only job is to decide whether Relay should accept this local search snapshot or run one more refined local search.",
    "Do not call tools. Do not search Microsoft 365, SharePoint, the web, memory, plugins, or local files.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: SEARCH_REFLECTION_SCHEMA_VERSION,
      rawQuery: params.rawQuery,
      snapshotId: params.snapshotId,
      action: "finalize",
      rationale: "short reason based only on the candidate facts",
      refinedTerms: ["term to add only if action is refine"],
      supportTerms: ["supporting term to add only if action is refine"],
      demoteTerms: ["term to demote only if action is refine"],
      summary: "short Japanese search-quality note",
    }),
    "Rules:",
    `- schemaVersion must be ${SEARCH_REFLECTION_SCHEMA_VERSION}.`,
    "- rawQuery must equal USER REQUEST DATA exactly.",
    "- snapshotId must equal SNAPSHOT ID exactly.",
    "- action must be finalize or refine.",
    "- Choose refine only when the top candidates mostly match a nearby entity/name but do not confirm the user's compound concept.",
    "- For compound concepts, preserve all required parts. Example: 部品売上 needs parts AND sales; パーツ alone is not enough.",
    "- refinedTerms must add stricter concept terms, not broad generic words. Do not add company names unless the user asked for that company.",
    "- supportTerms are allowed only as secondary workflow terms that should not outrank the core concept.",
    "- demoteTerms should include misleading entity-only or copy/review words when visible in the candidates.",
    "- Never output file paths or candidateIds. Relay will execute any refinement locally.",
    "- Do not include markdown, prose outside JSON, tool calls, citations, or fields not shown in the schema.",
    "SNAPSHOT ID:",
    params.snapshotId,
    "WORKSPACE:",
    params.workspacePath,
    "CURRENT QUERY PLAN:",
    JSON.stringify({
      expandedTerms: params.queryPlan.expandedTerms,
      supportTerms: params.queryPlan.supportTerms,
      demoteTerms: params.queryPlan.demoteTerms,
      timeScopeIntent: params.queryPlan.timeScopeIntent,
    }),
    "LOCAL RELAY SUMMARY:",
    params.localSummary,
    "COVERAGE:",
    params.coverageLabel,
    "CANDIDATE FACTS:",
    JSON.stringify(cardFacts),
    "USER REQUEST DATA:",
    JSON.stringify(params.rawQuery),
    "Return the reflection JSON object now.",
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
    "Your only job is to translate the user's Office-file instruction into a small JSON operation plan.",
    "Do not call tools. Do not edit files. Do not use Microsoft 365 built-in editing, SharePoint, web search, plugins, or local file tools.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: OFFICE_PLAN_SCHEMA_VERSION,
      risk: "medium",
      operations: [
        {
          kind: "cell_format",
          summary: "short operation summary",
          sheet: "Sheet1",
          range: "A1",
          props: { fill: "FF0000" },
        },
      ],
      summary: "short plan summary",
    }),
    "Rules:",
    `- schemaVersion must be ${OFFICE_PLAN_SCHEMA_VERSION}.`,
    "- operations must contain one to five safe operations.",
    "- Supported operation kinds are cell_format, range_format, cell_value, and inspect.",
    "- Never output rawInstruction, filePath, commands, argv, shell syntax, or the officecli executable name.",
    "- Relay already knows TARGET FILE and will build OfficeCLI argv itself. Do not repeat any Windows path.",
    "- For Excel ranges, use a sheet-qualified path like \"/Sheet1/A1\". Use exact sheet names from OFFICE OUTLINE JSON.",
    "- If the user writes a spaced sheet name such as `Sheet 1` and the outline has a single close match such as `Sheet1`, use the exact outline name.",
    "- For simple Excel cell color requests, use kind cell_format with props.fill such as FF0000.",
    "- For writing a simple cell value, use kind cell_value with sheet, range, and value.",
    "- If the target sheet/range/object is ambiguous, return one inspect operation rather than guessing an edit.",
    "- Do not include markdown, prose, PowerShell, Bash, VBA, local file content, or fields not shown in the schema.",
    "TARGET FILE:",
    params.filePath,
    "OFFICE OUTLINE JSON:",
    params.outlineJson?.slice(0, 12000) || "(not inspected)",
    "USER REQUEST DATA:",
    JSON.stringify(instruction),
    "Return the Office edit plan JSON object now.",
  ].join("\n");
}

export function buildCodePatchPlanPrompt(params: {
  instruction: string;
  workspacePath: string;
  contextFiles: RelayCodeContextFile[];
}): string {
  const instruction = params.instruction.trim();
  const files = params.contextFiles.slice(0, 12).map((file) => ({
    relativePath: file.relativePath,
    language: file.language || "",
    truncated: file.truncated,
    score: file.score,
    reasons: file.reasons.slice(0, 6),
    content: file.content,
  }));
  return [
    "RELAY CODE PATCH PLAN COMPILER",
    "Mode: code_patch_plan. This is not a chat-answer task.",
    "Your only job is to produce a JSON patch plan using exact string replacements against the provided local context.",
    "Do not call tools. Do not search Microsoft 365, SharePoint, the web, memory, plugins, or local files.",
    "Do not run code, tests, shell commands, package managers, or formatters.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: CODE_PATCH_SCHEMA_VERSION,
      risk: "medium",
      summary: "short Japanese summary of the proposed code change",
      edits: [
        {
          relativePath: files[0]?.relativePath || "relative/path.ts",
          oldString: "exact text copied from the file content",
          newString: "replacement text",
          summary: "short edit summary",
        },
      ],
      verificationCommands: ["pnpm typecheck"],
    }),
    "Rules:",
    `- schemaVersion must be ${CODE_PATCH_SCHEMA_VERSION}.`,
    "- Never output rawInstruction, workspacePath, absolute paths, or parent directory paths.",
    "- Use only files listed in CONTEXT FILES. Do not invent paths.",
    "- relativePath must exactly match one CONTEXT FILES relativePath.",
    "- Every oldString must be copied exactly from the corresponding CONTEXT FILES content and should be unique in that file.",
    "- Do not use shell commands, markdown, prose outside JSON, or fields not shown in the schema.",
    "- If the requested change cannot be done safely with the provided context, return edits: [] and explain the missing context in summary.",
    "- Keep edits small and reviewable. Prefer one to eight edits; never exceed eight edits.",
    "- verificationCommands are suggestions for the user only; Relay will not execute them automatically.",
    "WORKSPACE:",
    params.workspacePath,
    "CONTEXT FILES:",
    JSON.stringify(files),
    "USER REQUEST DATA:",
    JSON.stringify(instruction),
    "Return the code patch plan JSON object now.",
  ].join("\n");
}

export function buildAgentStepPrompt(params: {
  mode: RelayAgentMode;
  instruction: string;
  workspacePath: string;
  toolCatalog: readonly { name: string; mode: string; description: string }[];
  observation?: string;
}): string {
  const instruction = params.instruction.trim();
  const tools = params.toolCatalog
    .filter((tool) => tool.mode === params.mode)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  return [
    "RELAY AGENT STEP PLANNER",
    "Mode: agent_step. This is not a chat-answer task.",
    "Copilot decides the next safe step; Relay executes the selected tool and validates every result.",
    "Do not call tools yourself. Do not search Microsoft 365, SharePoint, the web, memory, plugins, or local files.",
    "Return exactly one valid JSON object and nothing else. The first character must be `{` and the last character must be `}`.",
    "Use this schema exactly:",
    JSON.stringify({
      schemaVersion: AGENT_STEP_SCHEMA_VERSION,
      mode: params.mode,
      rawInstruction: instruction,
      action: "use_tool",
      toolName: tools[0]?.name || "relay_document_search",
      input: {},
      rationale: "short reason for the next step",
      userMessage: "short Japanese message only when action is ask_user, finish, or error",
    }),
    "Rules:",
    `- schemaVersion must be ${AGENT_STEP_SCHEMA_VERSION}.`,
    "- mode must equal MODE exactly.",
    "- rawInstruction must equal USER REQUEST DATA exactly.",
    "- action must be use_tool, ask_user, finish, or error.",
    "- When action is use_tool, toolName must be one of TOOL CATALOG names and input must be a JSON object.",
    "- When action is ask_user, finish, or error, do not include tool calls or executable instructions.",
    "- Relay will ignore any tool, file path, or command not represented in this JSON object and allowed by the current UI mode.",
    "- Do not include markdown, prose outside JSON, OpenAI tool_calls, recipient_name, shell commands, or fields not shown in the schema.",
    "MODE:",
    params.mode,
    "WORKSPACE:",
    params.workspacePath,
    "TOOL CATALOG:",
    JSON.stringify(tools),
    "OBSERVATION:",
    params.observation?.slice(0, 6000) || "(none)",
    "USER REQUEST DATA:",
    JSON.stringify(instruction),
    "Return the Relay agent step JSON object now.",
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

export function validateDocumentSearchReflectionText(
  text: string,
  rawQuery: string,
  snapshotId: string,
): PlannerValidation<RelayDocumentSearchReflection> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateDocumentSearchReflection(parsed.value, rawQuery, snapshotId);
}

export function validateOfficeEditPlanText(text: string, _rawInstruction: string, filePath: string): PlannerValidation<RelayOfficeEditPlan> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateOfficeEditPlan(parsed.value, filePath);
}

export function validateCodePatchPlanText(
  text: string,
  rawInstruction: string,
  workspacePath: string,
  allowedRelativePaths: Set<string>,
): PlannerValidation<RelayCodePatchPlan> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateCodePatchPlan(parsed.value, rawInstruction, workspacePath, allowedRelativePaths);
}

export function validateAgentStepText(
  text: string,
  expectedMode: RelayAgentMode,
  rawInstruction: string,
  allowedTools: Set<string>,
): PlannerValidation<RelayAgentStep> {
  const parsed = parseStrictJsonObject(text);
  if (!parsed.ok) return parsed;
  return validateAgentStep(parsed.value, expectedMode, rawInstruction, allowedTools);
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

function validateOfficeEditPlan(value: JsonRecord, filePath: string): PlannerValidation<RelayOfficeEditPlan> {
  const errors: string[] = [];
  rejectUnknownFields(value, ["schemaVersion", "risk", "operations", "summary"], errors, "Office plan");
  if (value.schemaVersion !== OFFICE_PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${OFFICE_PLAN_SCHEMA_VERSION}.`);
  const risk = enumValue(value.risk, OFFICE_RISK_LEVELS, "risk", errors);
  const summary = value.summary === undefined ? undefined : stringValue(value.summary, "summary", 280, errors);
  const operations = validateOfficeOperations(value.operations, errors);
  const commands = officeOperationsToCommands(operations, filePath, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: OFFICE_PLAN_SCHEMA_VERSION,
      risk: risk as RelayOfficeEditPlan["risk"],
      operations,
      commands,
      summary,
    },
  };
}

function validateDocumentSearchReflection(
  value: JsonRecord,
  rawQuery: string,
  snapshotId: string,
): PlannerValidation<RelayDocumentSearchReflection> {
  const errors: string[] = [];
  rejectUnknownFields(
    value,
    ["schemaVersion", "rawQuery", "snapshotId", "action", "rationale", "refinedTerms", "supportTerms", "demoteTerms", "summary"],
    errors,
    "search reflection",
  );
  if (value.schemaVersion !== SEARCH_REFLECTION_SCHEMA_VERSION) errors.push(`schemaVersion must be ${SEARCH_REFLECTION_SCHEMA_VERSION}.`);
  if (value.rawQuery !== rawQuery) errors.push("rawQuery must exactly match the original user request.");
  if (value.snapshotId !== snapshotId) errors.push("snapshotId must exactly match the Relay snapshot id.");
  const action = enumValue(value.action, SEARCH_REFLECTION_ACTIONS, "action", errors);
  const rationale = stringValue(value.rationale, "rationale", 280, errors);
  const refinedTerms = stringArray(value.refinedTerms, "refinedTerms", 20, errors);
  const supportTerms = stringArray(value.supportTerms, "supportTerms", 20, errors);
  const demoteTerms = stringArray(value.demoteTerms, "demoteTerms", 20, errors);
  const summary = value.summary === undefined ? undefined : stringValue(value.summary, "summary", 280, errors);
  if (action === "finalize" && refinedTerms.length) {
    errors.push("refinedTerms must be empty when action is finalize.");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: SEARCH_REFLECTION_SCHEMA_VERSION,
      rawQuery,
      snapshotId,
      action: action as RelayDocumentSearchReflection["action"],
      rationale,
      refinedTerms,
      supportTerms,
      demoteTerms,
      summary,
    },
  };
}

function validateCodePatchPlan(
  value: JsonRecord,
  _rawInstruction: string,
  _workspacePath: string,
  allowedRelativePaths: Set<string>,
): PlannerValidation<RelayCodePatchPlan> {
  const errors: string[] = [];
  rejectUnknownFields(
    value,
    ["schemaVersion", "risk", "summary", "edits", "verificationCommands"],
    errors,
    "code patch plan",
  );
  if (value.schemaVersion !== CODE_PATCH_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CODE_PATCH_SCHEMA_VERSION}.`);
  const risk = enumValue(value.risk, CODE_RISK_LEVELS, "risk", errors);
  const summary = stringValue(value.summary, "summary", 420, errors);
  const edits = validateCodePatchEdits(value.edits, allowedRelativePaths, errors);
  const verificationCommands = validateVerificationCommands(value.verificationCommands, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: CODE_PATCH_SCHEMA_VERSION,
      risk: risk as RelayCodePatchPlan["risk"],
      summary,
      edits,
      verificationCommands,
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

function validateAgentStep(
  value: JsonRecord,
  expectedMode: RelayAgentMode,
  rawInstruction: string,
  allowedTools: Set<string>,
): PlannerValidation<RelayAgentStep> {
  const errors: string[] = [];
  rejectUnknownFields(value, ["schemaVersion", "mode", "rawInstruction", "action", "toolName", "input", "rationale", "userMessage"], errors, "agent step");
  if (value.schemaVersion !== AGENT_STEP_SCHEMA_VERSION) errors.push(`schemaVersion must be ${AGENT_STEP_SCHEMA_VERSION}.`);
  if (value.rawInstruction !== rawInstruction) errors.push("rawInstruction must exactly match the original user instruction.");
  const mode = enumValue(value.mode, AGENT_MODES, "mode", errors) as RelayAgentMode;
  if (mode && mode !== expectedMode) errors.push(`mode must be ${expectedMode}.`);
  const action = enumValue(value.action, AGENT_ACTIONS, "action", errors) as RelayAgentAction;
  const rationale = stringValue(value.rationale, "rationale", 280, errors);
  const userMessage = value.userMessage === undefined ? undefined : stringValue(value.userMessage, "userMessage", 280, errors);
  let toolName: RelayAgentToolName | undefined;
  let input: JsonRecord | undefined;
  if (action === "use_tool") {
    if (typeof value.toolName !== "string" || !allowedTools.has(value.toolName)) {
      errors.push(`toolName must be one of: ${[...allowedTools].join(", ")}.`);
    } else {
      toolName = value.toolName as RelayAgentToolName;
    }
    if (value.input !== undefined && !isRecord(value.input)) {
      errors.push("input must be a JSON object when provided.");
    } else if (isRecord(value.input)) {
      input = value.input;
    } else {
      input = {};
    }
  } else if (value.toolName !== undefined || value.input !== undefined) {
    errors.push("toolName and input are only allowed when action is use_tool.");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: AGENT_STEP_SCHEMA_VERSION,
      mode: expectedMode,
      rawInstruction,
      action,
      ...(toolName ? { toolName } : {}),
      ...(input ? { input } : {}),
      rationale,
      ...(userMessage ? { userMessage } : {}),
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

function validateOfficeOperations(value: unknown, errors: string[]): RelayOfficeEditOperation[] {
  if (!Array.isArray(value)) {
    errors.push("operations must be an array.");
    return [];
  }
  if (value.length < 1 || value.length > 5) errors.push("operations must contain one to five entries.");
  const operations: RelayOfficeEditOperation[] = [];
  value.slice(0, 5).forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`operations[${index}] must be an object.`);
      return;
    }
    rejectUnknownFields(entry, ["kind", "summary", "sheet", "range", "value", "props"], errors, `operations[${index}]`);
    const kind = enumValue(entry.kind, OFFICE_OPERATION_KINDS, `operations[${index}].kind`, errors) as RelayOfficeEditOperation["kind"];
    const summary = stringValue(entry.summary, `operations[${index}].summary`, 160, errors);
    const sheet = entry.sheet === undefined ? undefined : officeSheetName(entry.sheet, `operations[${index}].sheet`, errors);
    const range = entry.range === undefined ? undefined : officeRangeValue(entry.range, `operations[${index}].range`, errors);
    const props = entry.props === undefined ? undefined : officeProps(entry.props, `operations[${index}].props`, errors);
    const value = entry.value === undefined ? undefined : officeScalarValue(entry.value, `operations[${index}].value`, errors);
    if ((kind === "cell_format" || kind === "range_format") && (!sheet || !range || !props || Object.keys(props).length === 0)) {
      errors.push(`operations[${index}] ${kind} requires sheet, range, and props.`);
    }
    if (kind === "cell_value" && (!sheet || !range || value === undefined)) {
      errors.push(`operations[${index}] cell_value requires sheet, range, and value.`);
    }
    if (kind === "inspect" && (sheet || range || value !== undefined || props)) {
      errors.push(`operations[${index}] inspect must not include sheet, range, value, or props.`);
    }
    if (summary && kind) {
      operations.push({
        kind,
        summary,
        ...(sheet ? { sheet } : {}),
        ...(range ? { range } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(props ? { props } : {}),
      });
    }
  });
  return operations;
}

function officeOperationsToCommands(
  operations: RelayOfficeEditOperation[],
  filePath: string,
  errors: string[],
): RelayOfficePlanCommand[] {
  return operations.map((operation, index) => {
    if (operation.kind === "inspect") {
      return {
        summary: operation.summary || "Officeファイルを確認",
        argv: ["view", filePath, "outline", "--json"],
      };
    }
    const target = `/${operation.sheet}/${operation.range}`;
    if (operation.kind === "cell_value") {
      return {
        summary: operation.summary,
        argv: ["set", filePath, target, "--value", String(operation.value ?? ""), "--json"],
      };
    }
    const argv = ["set", filePath, target];
    const props = operation.props || {};
    for (const [key, value] of Object.entries(props)) {
      argv.push("--prop", `${key}=${String(value)}`);
    }
    argv.push("--json");
    if (argv.length <= 4) {
      errors.push(`operations[${index}] did not produce any OfficeCLI property arguments.`);
    }
    return {
      summary: operation.summary,
      argv,
    };
  });
}

function officeSheetName(value: unknown, field: string, errors: string[]): string {
  const sheet = stringValue(value, field, 120, errors);
  if (/[\\/]/u.test(sheet)) errors.push(`${field} must not contain slashes.`);
  return sheet;
}

function officeRangeValue(value: unknown, field: string, errors: string[]): string {
  const range = stringValue(value, field, 80, errors).replace(/\s+/gu, "");
  if (!/^[A-Z]{1,4}\d+(?::[A-Z]{1,4}\d+)?$/iu.test(range)) {
    errors.push(`${field} must be an A1-style cell or range such as A1 or A1:B3.`);
  }
  return range.toUpperCase();
}

function officeScalarValue(value: unknown, field: string, errors: string[]): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string" && hasControlCharacters(value)) errors.push(`${field} must not contain control characters.`);
    if (typeof value === "string" && value.length > 4000) errors.push(`${field} must be 4000 characters or less.`);
    return value;
  }
  errors.push(`${field} must be a string, number, boolean, or null.`);
  return "";
}

function officeProps(value: unknown, field: string, errors: string[]): Record<string, string | number | boolean> {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return {};
  }
  const props: Record<string, string | number | boolean> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!OFFICE_FORMAT_PROPS.has(key)) {
      errors.push(`${field}.${key} is not a supported formatting property.`);
      continue;
    }
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      errors.push(`${field}.${key} must be a string, number, or boolean.`);
      continue;
    }
    const normalized = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (typeof normalized === "string") {
      if (!normalized) {
        errors.push(`${field}.${key} must not be empty.`);
        continue;
      }
      if (hasControlOrShellSyntax(normalized)) errors.push(`${field}.${key} contains forbidden shell syntax.`);
      if (key === "fill" || key === "fontColor") {
        const color = normalized.replace(/^#/u, "").toUpperCase();
        if (!/^[0-9A-F]{6}$/u.test(color)) {
          errors.push(`${field}.${key} must be a 6-digit hex color.`);
          continue;
        }
        props[key] = color;
        continue;
      }
    }
    props[key] = normalized;
  }
  return props;
}

function validateCodePatchEdits(
  value: unknown,
  allowedRelativePaths: Set<string>,
  errors: string[],
): RelayCodePatchPlanEdit[] {
  if (!Array.isArray(value)) {
    errors.push("edits must be an array.");
    return [];
  }
  if (value.length > 8) errors.push("edits may contain at most eight entries.");
  const edits: RelayCodePatchPlanEdit[] = [];
  value.slice(0, 8).forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`edits[${index}] must be an object.`);
      return;
    }
    rejectUnknownFields(entry, ["relativePath", "oldString", "newString", "summary"], errors, `edits[${index}]`);
    const relativePath = stringValue(entry.relativePath, `edits[${index}].relativePath`, 260, errors).replaceAll("\\", "/");
    const oldString = stringValueAllowNewlines(entry.oldString, `edits[${index}].oldString`, 24000, errors);
    const newString = stringValueAllowNewlines(entry.newString, `edits[${index}].newString`, 36000, errors);
    const summary = stringValue(entry.summary, `edits[${index}].summary`, 180, errors);
    if (relativePath.startsWith("/") || /^[a-z]:/iu.test(relativePath) || relativePath.split("/").includes("..")) {
      errors.push(`edits[${index}].relativePath must be a workspace-relative path.`);
    }
    if (!allowedRelativePaths.has(relativePath)) {
      errors.push(`edits[${index}].relativePath was not provided in the local context: ${relativePath}`);
    }
    if (!oldString) errors.push(`edits[${index}].oldString must not be empty.`);
    if (oldString && oldString === newString) errors.push(`edits[${index}].oldString and newString must differ.`);
    if (relativePath && oldString && summary) {
      edits.push({ relativePath, oldString, newString, summary });
    }
  });
  return edits;
}

function validateVerificationCommands(value: unknown, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("verificationCommands must be an array.");
    return [];
  }
  if (value.length > 5) errors.push("verificationCommands may contain at most five entries.");
  const commands: string[] = [];
  for (const [index, item] of value.slice(0, 5).entries()) {
    const command = stringValue(item, `verificationCommands[${index}]`, 160, errors);
    if (!command) continue;
    if (hasDangerousVerificationCommand(command)) {
      errors.push(`verificationCommands[${index}] contains a destructive or shell-control pattern.`);
      continue;
    }
    commands.push(command);
  }
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

function stringValueAllowNewlines(value: unknown, field: string, maxLength: number, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return "";
  }
  if (/[\u0000\u007f]/u.test(value)) errors.push(`${field} must not contain NUL or delete control characters.`);
  return value.slice(0, maxLength);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function hasControlOrShellSyntax(value: string): boolean {
  return /[\u0000-\u001f\u007f;&|<>`]/u.test(value);
}

function hasDangerousVerificationCommand(value: string): boolean {
  return /[;&|<>`]/u.test(value)
    || /\b(rm|del|erase|format|shutdown)\b/iu.test(value)
    || /\bgit\s+(reset|clean|push)\b/iu.test(value)
    || /\b--force\b/iu.test(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function quoteArg(value: string): string {
  if (/^[^\s"';&|<>`]+$/u.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replaceAll('"', '\\"')}"`;
}
