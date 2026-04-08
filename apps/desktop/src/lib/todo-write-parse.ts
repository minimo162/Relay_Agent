/** Parsed TodoWrite tool JSON (`newTodos` from tools crate). */
export interface PlanTodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
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
