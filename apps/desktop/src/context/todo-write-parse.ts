import type { UiChunk } from "../lib/ipc";

/** Parsed TodoWrite tool JSON (`newTodos` from tools crate). */
export interface PlanTodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

/** One TodoWrite completion in the session plan timeline (`atMs === 0` when rebuilt from history). */
export interface PlanTimelineEntry {
  toolUseId: string;
  atMs: number;
  todos: PlanTodoItem[];
}

/** Rebuild plan snapshots from persisted session chunks (no wall-clock times). */
export function buildPlanTimelineFromUiChunks(chunks: UiChunk[]): PlanTimelineEntry[] {
  const out: PlanTimelineEntry[] = [];
  for (const c of chunks) {
    if (c.kind !== "tool_call") continue;
    if (c.toolName !== "TodoWrite") continue;
    if (c.status !== "done" || c.result == null) continue;
    const todos = parseTodoWriteToolResult(c.result);
    if (!todos?.length) continue;
    out.push({ toolUseId: c.toolUseId, atMs: 0, todos });
  }
  return out;
}

export function parseTodoWriteToolResult(content: string): PlanTodoItem[] | null {
  try {
    const j = JSON.parse(content) as { newTodos?: unknown };
    if (!Array.isArray(j.newTodos)) return null;
    const out: PlanTodoItem[] = [];
    for (const row of j.newTodos) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const contentStr = typeof r.content === "string" ? r.content : "";
      const activeForm = typeof r.activeForm === "string" ? r.activeForm : contentStr;
      const st = r.status;
      const status =
        st === "pending" || st === "in_progress" || st === "completed" ? st : "pending";
      if (!contentStr.trim()) continue;
      out.push({ content: contentStr, activeForm, status });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
