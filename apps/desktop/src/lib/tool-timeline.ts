/** Maps tool names to Cursor-style AI timeline accent colors (DESIGN.md). */
export type ToolTimelineKind = "thinking" | "grep" | "read" | "edit";

export type ToolCallStatus = "running" | "done" | "error";

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
      return "edit";
    default:
      return "thinking";
  }
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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeGrepSearch(rawResult: string): string {
  const obj = asObject(safeParseJson(rawResult));
  if (!obj) return "search finished";
  const matchCount = asNumber(obj.numMatches);
  if (matchCount != null) {
    return `${matchCount} hit${matchCount === 1 ? "" : "s"}`;
  }
  const fileCount = asNumber(obj.numFiles);
  if (fileCount != null) {
    return `${fileCount} file${fileCount === 1 ? "" : "s"}`;
  }
  return "search finished";
}

function summarizeGlobSearch(rawResult: string): string {
  const obj = asObject(safeParseJson(rawResult));
  if (!obj) return "scan finished";
  const fileCount = asNumber(obj.numFiles);
  if (fileCount == null) return "scan finished";
  return `${fileCount} file${fileCount === 1 ? "" : "s"}`;
}

export function toolStatusSummary(toolName: string, status: ToolCallStatus, result: string | null): string {
  if (status === "running") return "running…";
  if (status === "error") return "failed";
  if (!result) return "done";

  switch (toolName) {
    case "grep_search":
      return summarizeGrepSearch(result);
    case "glob_search":
      return summarizeGlobSearch(result);
    case "read_file":
      return "completed";
    case "write_file":
    case "edit_file":
      return "updated";
    default:
      return "done";
  }
}

export function shouldCollapseToolResult(toolName: string): boolean {
  switch (toolName) {
    case "grep_search":
    case "read_file":
    case "glob_search":
      return true;
    default:
      return true;
  }
}
