/**
 * Workspace skills loaded from `<workspace>/.relay/skills/<name>.md`.
 *
 * A skill is a reusable prompt + (optional) recommended tools/allowlist hint.
 * The Rust IPC `list_workspace_skills` returns the raw .md body and metadata;
 * this module parses YAML-style frontmatter for display and slash-command use.
 */

import { listWorkspaceSkills, type WorkspaceSkillRow } from "./ipc";

export interface RelaySkill {
  /** File stem (basename without .md). */
  name: string;
  /** Frontmatter `description`, falling back to the workspace row. */
  description: string;
  /** Frontmatter `tools` list (display hint; not enforced). */
  tools: string[];
  /** Frontmatter `allowlist` list (display hint; not enforced). */
  allowlist: string[];
  /** Body without the frontmatter block. */
  prompt: string;
  /** Absolute path to the source .md file. */
  source: string;
}

export async function fetchWorkspaceSkills(cwd: string | null): Promise<RelaySkill[]> {
  const rows = await listWorkspaceSkills(cwd);
  return rows.map(parseSkillRow);
}

export function parseSkillRow(row: WorkspaceSkillRow): RelaySkill {
  const { frontmatter, body } = splitFrontmatter(row.body);
  const description =
    pickString(frontmatter, "description") ?? row.description?.trim() ?? "";
  const tools = pickStringArray(frontmatter, "tools");
  const allowlist = pickStringArray(frontmatter, "allowlist");
  return {
    name: row.name.trim(),
    description,
    tools,
    allowlist,
    prompt: body.trim(),
    source: row.source,
  };
}

/* ── Frontmatter parser (small subset of YAML) ─────────────────── */

type Frontmatter = Record<string, string | string[]>;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(input: string): { frontmatter: Frontmatter; body: string } {
  const match = input.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: input };
  const raw = match[1] ?? "";
  const body = input.slice(match[0].length);
  return { frontmatter: parseSimpleFrontmatter(raw), body };
}

/**
 * Parses a tiny subset of YAML:
 * - `key: value`             → string
 * - `key: [a, b, c]`         → array
 * - `key:` followed by `  - item` lines → array
 * - `# comment` lines and blank lines are ignored
 *
 * No nesting, no quoting beyond stripping a single set of matching quotes.
 */
function parseSimpleFrontmatter(input: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = input.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line == null) {
      i++;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    if (!key) {
      i++;
      continue;
    }
    const valueRaw = line.slice(colon + 1).trim();
    if (valueRaw.length === 0) {
      // Look ahead for `  - item` style array
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next == null) break;
        const m = next.match(/^\s+-\s+(.+?)\s*$/);
        if (!m) break;
        items.push(stripQuotes(m[1]));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      }
      i++;
      continue;
    }
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      const inner = valueRaw.slice(1, -1);
      const items = inner
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
      out[key] = items;
    } else {
      out[key] = stripQuotes(valueRaw);
    }
    i++;
  }
  return out;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function pickString(frontmatter: Frontmatter, key: string): string | undefined {
  const v = frontmatter[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function pickStringArray(frontmatter: Frontmatter, key: string): string[] {
  const v = frontmatter[key];
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter((s) => s.length > 0);
  if (typeof v === "string" && v.trim().length > 0) return [v.trim()];
  return [];
}
