/** Last path segment (supports `/` and `\\`). */
export function workspaceBasename(path: string): string {
  const t = path.trim().replace(/[/\\]+$/, "");
  if (!t) return "";
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1] ?? t;
}

/**
 * Single-line path for UI; prefers `…/basename` when it fits, otherwise truncates the end.
 */
export function ellipsisPath(path: string, maxLen: number): string {
  const raw = path.trim();
  if (raw.length <= maxLen) return raw;
  if (maxLen < 8) {
    return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  const base = workspaceBasename(raw);
  const viaBase = `…/${base}`;
  if (viaBase.length <= maxLen) return viaBase;
  const tail = raw.slice(-(maxLen - 1));
  return `…${tail}`;
}
