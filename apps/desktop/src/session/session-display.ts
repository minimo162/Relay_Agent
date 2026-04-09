export type SessionMeta = {
  createdAt: number;
  /** First user message preview (one line). */
  preview?: string;
};

export function sessionPrimaryLine(meta: SessionMeta | undefined): string {
  const p = meta?.preview?.trim();
  if (p) return p.length > 52 ? `${p.slice(0, 49)}…` : p;
  return "Session";
}

export function formatSessionSubtitle(id: string, meta: SessionMeta | undefined): string {
  const ts = meta?.createdAt ?? Date.now();
  const dateStr = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
  return `${dateStr} · ${id.slice(0, 8)}…`;
}

export function truncatePromptPreview(text: string, maxLen: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= maxLen) return one;
  return `${one.slice(0, maxLen - 1)}…`;
}
