/** Maps tool names to Cursor-style AI timeline accent colors (DESIGN.md). */
export type ToolTimelineKind = "thinking" | "grep" | "read" | "edit";

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
