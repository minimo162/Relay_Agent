/** Maps tool names to muted accent colors for the inline activity timeline. */
export type ToolTimelineKind = "thinking" | "grep" | "read" | "edit";

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolAuditPresentation {
  label: string;
  target?: string;
  summary: string;
  detailTitle?: string;
  detailBody?: string | null;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function toolTimelineKind(toolName: string): ToolTimelineKind {
  switch (toolName) {
    case "read_file":
    case "WebFetch":
      return "read";
    case "grep_search":
    case "glob_search":
    case "ToolSearch":
      return "grep";
    case "write_file":
    case "edit_file":
    case "NotebookEdit":
    case "pdf_merge":
    case "pdf_split":
      return "edit";
    default:
      return "thinking";
  }
}

export function humanToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_file: "Read file",
    glob_search: "Find files",
    grep_search: "Search file contents",
    write_file: "Write file",
    edit_file: "Edit file",
    pdf_merge: "Merge PDFs",
    pdf_split: "Split PDF",
    TodoWrite: "Update plan",
    WebFetch: "Fetch web page",
    WebSearch: "Search the web",
    bash: "Run shell command",
    PowerShell: "Run PowerShell",
    ToolSearch: "Find tools",
    NotebookEdit: "Edit notebook",
  };
  return labels[toolName] ?? toolName;
}

function inputPath(input: Record<string, unknown> | undefined): string | undefined {
  return (
    asString(input?.path) ??
    asString(input?.file_path) ??
    asString(input?.output_path) ??
    asString(input?.input_path) ??
    asString(input?.notebook_path) ??
    undefined
  );
}

function summarizeReadFile(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const parsed = asObject(result ? safeParseJson(result) : null);
  const file = asObject(parsed?.file);
  const lines = asNumber(file?.numLines);
  const total = asNumber(file?.totalLines);
  const pages = asString(input?.pages);
  return {
    label: "Read file",
    target: inputPath(input),
    summary:
      status === "running"
        ? "Reading file contents…"
        : lines != null
          ? `${lines} line${lines === 1 ? "" : "s"} loaded${total != null ? ` of ${total}` : ""}${pages ? ` · pages ${pages}` : ""}`
          : "Read complete",
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizeGlobSearch(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const parsed = asObject(result ? safeParseJson(result) : null);
  const fileCount = asNumber(parsed?.numFiles);
  return {
    label: "Find files",
    target: asString(input?.pattern) ?? inputPath(input),
    summary:
      status === "running"
        ? "Scanning the workspace…"
        : fileCount != null
          ? `${fileCount} file${fileCount === 1 ? "" : "s"} matched`
          : "Search complete",
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizeGrepSearch(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const parsed = asObject(result ? safeParseJson(result) : null);
  const matchCount = asNumber(parsed?.numMatches);
  const fileCount = asNumber(parsed?.numFiles);
  const pattern = asString(input?.pattern);
  const scope = asString(input?.path);
  let summary = "Search complete";
  if (status === "running") summary = "Searching file contents…";
  else if (matchCount != null) summary = `${matchCount} hit${matchCount === 1 ? "" : "s"} across ${fileCount ?? 0} file${fileCount === 1 ? "" : "s"}`;
  else if (fileCount != null) summary = `${fileCount} file${fileCount === 1 ? "" : "s"} scanned`;
  return {
    label: "Search file contents",
    target: pattern ? `${pattern}${scope ? ` · ${scope}` : ""}` : (scope ?? undefined),
    summary,
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizeWriteFile(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const parsed = asObject(result ? safeParseJson(result) : null);
  const filePath = asString(parsed?.filePath) ?? inputPath(input);
  const original = asString(parsed?.originalFile);
  return {
    label: "Write file",
    target: filePath,
    summary:
      status === "running"
        ? "Writing changes…"
        : original ? "File updated" : "File created",
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizeEditFile(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const parsed = asObject(result ? safeParseJson(result) : null);
  const filePath = asString(parsed?.filePath) ?? inputPath(input);
  const replaceAll = parsed?.replaceAll === true;
  const userModified = parsed?.userModified === true;
  let summary = "Edit applied";
  if (status === "running") summary = "Applying edit…";
  else if (userModified) summary = "Edit applied to a modified file";
  else if (replaceAll) summary = "All matching edits applied";
  return {
    label: "Edit file",
    target: filePath,
    summary,
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizePdfMerge(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const inputPaths = asArray(input?.input_paths);
  const output = asString(asObject(result ? safeParseJson(result) : null)?.output_path) ?? asString(input?.output_path);
  return {
    label: "Merge PDFs",
    target: output ?? undefined,
    summary:
      status === "running"
        ? "Combining PDF files…"
        : `${inputPaths?.length ?? 0} PDF${inputPaths?.length === 1 ? "" : "s"} merged`,
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

function summarizePdfSplit(
  status: ToolCallStatus,
  input: Record<string, unknown> | undefined,
  result: string | null,
): ToolAuditPresentation {
  const segments = asArray(input?.segments);
  const outputs = asArray(asObject(result ? safeParseJson(result) : null)?.outputs);
  return {
    label: "Split PDF",
    target: asString(input?.input_path) ?? undefined,
    summary:
      status === "running"
        ? "Creating split PDFs…"
        : `${outputs?.length ?? segments?.length ?? 0} output file${(outputs?.length ?? segments?.length ?? 0) === 1 ? "" : "s"} created`,
    detailTitle: "Show raw result",
    detailBody: result,
  };
}

export function toolAuditPresentation(
  toolName: string,
  status: ToolCallStatus,
  result: string | null,
  input?: Record<string, unknown>,
): ToolAuditPresentation {
  if (status === "error") {
    return {
      label: humanToolLabel(toolName),
      target: inputPath(input),
      summary: "Failed",
      detailTitle: "Show error details",
      detailBody: result,
    };
  }

  switch (toolName) {
    case "read_file":
      return summarizeReadFile(status, input, result);
    case "glob_search":
      return summarizeGlobSearch(status, input, result);
    case "grep_search":
      return summarizeGrepSearch(status, input, result);
    case "write_file":
      return summarizeWriteFile(status, input, result);
    case "edit_file":
      return summarizeEditFile(status, input, result);
    case "pdf_merge":
      return summarizePdfMerge(status, input, result);
    case "pdf_split":
      return summarizePdfSplit(status, input, result);
    default:
      return {
        label: humanToolLabel(toolName),
        target: inputPath(input),
        summary: status === "running" ? "Working…" : "Completed",
        detailTitle: "Show raw result",
        detailBody: result,
      };
  }
}

export function shouldCollapseToolResult(result: string | null): boolean {
  return Boolean(result && result.trim().length > 0);
}
