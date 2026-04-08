export interface PromptTemplate {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

const LS = "relay.promptTemplates.v1";

function readAll(): PromptTemplate[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (t): t is PromptTemplate =>
          !!t &&
          typeof t === "object" &&
          typeof (t as PromptTemplate).id === "string" &&
          typeof (t as PromptTemplate).title === "string" &&
          typeof (t as PromptTemplate).body === "string",
      )
      .map((t) => ({
        ...t,
        createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function writeAll(templates: PromptTemplate[]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS, JSON.stringify(templates));
    }
  } catch {
    /* ignore */
  }
}

export function listPromptTemplates(): PromptTemplate[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function addPromptTemplate(title: string, body: string): PromptTemplate {
  const t: PromptTemplate = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: title.trim() || "Untitled",
    body,
    createdAt: Date.now(),
  };
  const next = [t, ...readAll()];
  writeAll(next);
  return t;
}

export function removePromptTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}
