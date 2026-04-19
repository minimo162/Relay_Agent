/**
 * Slash commands system for the Composer input.
 *
 * Commands are prefixed with "/" and provide quick actions
 * like /help, /clear, /compact, /status.
 */

export interface SlashCommandContext {
  /** Current active session ID, or null */
  sessionId: string | null;
  /** Clear all chunks from the feed (local-only) */
  clearChunks: () => void;
  /** Compact the agent session via IPC */
  compactSession: (
    sessionId: string,
  ) => Promise<{ message: string; removedMessageCount: number }>;
  /** Whether a session is currently running */
  sessionRunning: boolean;
  /** Number of chunks currently in the feed */
  chunksCount: number;
}

export type SlashCommandResult =
  | { kind: "local"; display?: string }
  | { kind: "send"; text: string }
  | { kind: "noop" };

export interface SlashCommand {
  command: string;
  description: string;
  handler: (args: string, ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

/** Workspace `.relay/commands` entries (set from shell when cwd changes). */
let workspaceSlashCommands: SlashCommand[] = [];

export function setWorkspaceSlashCommands(cmds: SlashCommand[]): void {
  workspaceSlashCommands = cmds;
}

function mergedCommands(): SlashCommand[] {
  const out = [...builtinCommands];
  for (const w of workspaceSlashCommands) {
    const i = out.findIndex((c) => c.command === w.command);
    if (i >= 0) {
      out[i] = w;
    } else {
      out.push(w);
    }
  }
  return out;
}

/* ── Registered commands ───────────────────────────────────── */

const builtinCommands: SlashCommand[] = [
  {
    command: "/help",
    description: "Show available slash commands",
    handler: async (_args, _ctx) => {
      const list = mergedCommands()
        .map((c) => `  ${c.command.padEnd(14)} — ${c.description}`)
        .join("\n");
      return { kind: "local", display: `Available commands:\n\n${list}` };
    },
  },
  {
    command: "/clear",
    description: "Clear the current chat feed",
    handler: async (_args, ctx) => {
      ctx.clearChunks();
      return { kind: "local", display: "▎Chat cleared." };
    },
  },
  {
    command: "/compact",
    description: "Compact the agent session to free context",
    handler: async (_args, ctx) => {
      const sid = ctx.sessionId;
      if (!sid) return { kind: "local", display: "▎No active session to compact." };
      try {
        const res = await ctx.compactSession(sid);
        return {
          kind: "local",
          display: `▎Session compacted. Removed ${res.removedMessageCount} message(s).`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { kind: "local", display: `▎Failed to compact: ${msg}` };
      }
    },
  },
  {
    command: "/status",
    description: "Show current session status",
    handler: async (_args, ctx) => {
      const sid = ctx.sessionId;
      if (!sid) {
        return { kind: "local", display: "▎No active session. Feed is idle." };
      }
      const state = ctx.sessionRunning ? "running" : "idle";
      const msgs = ctx.chunksCount;
      return {
        kind: "local",
        display: `▎Session ${sid.slice(0, 8)}… | state: ${state} | messages: ${msgs}`,
      };
    },
  },
];

/* ── Public API ────────────────────────────────────────────── */

/**
 * Find commands matching the given query (text after "/").
 * Returns all commands when query is empty.
 */
export function findSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  const all = mergedCommands();
  if (!q) return all;
  return all.filter((c) => c.command.slice(1).startsWith(q));
}

/**
 * Execute a slash command by its full text (e.g. "/compact --verbose").
 * Returns whether the command is local-only, should be sent to the agent, or is a no-op.
 */
export async function executeSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");

  const cmd = mergedCommands().find((c) => c.command === cmdName);
  if (!cmd) return { kind: "noop" };

  try {
    return await cmd.handler(args, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "local", display: `▎Command error: ${msg}` };
  }
}

/**
 * Check if a string is a slash command (starts with "/").
 * Returns the command name portion (without "/") or null.
 */
export function parseSlashCommand(text: string): string | null {
  const match = text.match(/^\/([a-zA-Z]\w*)/);
  return match ? match[1] : null;
}

/**
 * Parse the current textarea value to detect slash-mode.
 * Only works when "/" is the first character on the current line.
 *
 * Returns { query: string } when in slash-mode, null otherwise.
 */
export function detectSlashMode(
  value: string,
  cursorPosition: number,
): { query: string } | null {
  // Look at text up to cursor
  const beforeCursor = value.substring(0, cursorPosition);
  // Get the current line (or the whole text if no newlines)
  const lines = beforeCursor.split("\n");
  const currentLine = lines[lines.length - 1];

  // Must start with "/" (possibly preceded by nothing — start of line)
  const match = currentLine.match(/^\/([a-zA-Z]*)$/);
  if (!match) return null;

  return { query: match[1] };
}
