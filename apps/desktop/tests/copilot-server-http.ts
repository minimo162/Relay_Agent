/**
 * HTTP client for the bundled `copilot_server.js` — same entry as the desktop app (`POST /v1/chat/completions`).
 * Requires `copilot_server.js` running (default `http://127.0.0.1:18080`) with `--cdp-port` matching Edge CDP.
 */

export const COPILOT_SERVER_URL =
  process.env.COPILOT_SERVER_URL ?? "http://127.0.0.1:18080";
const COPILOT_SERVER_BOOT_TOKEN = process.env.COPILOT_SERVER_BOOT_TOKEN?.trim() || "";

function copilotServerAuthHeaders(): HeadersInit {
  return COPILOT_SERVER_BOOT_TOKEN
    ? { "X-Relay-Boot-Token": COPILOT_SERVER_BOOT_TOKEN }
    : {};
}

export async function copilotServerHealth(): Promise<{
  ok: boolean;
  status?: number;
  detail?: string;
}> {
  const base = COPILOT_SERVER_URL.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/status`, {
      method: "GET",
      headers: copilotServerAuthHeaders(),
    });
    const text = await r.text();
    return {
      ok: r.ok,
      status: r.status,
      detail: text.length > 400 ? `${text.slice(0, 400)}…` : text,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export type CopilotCompletionOptions = {
  userPrompt: string;
  systemPrompt?: string;
  /** Same as `relay_new_chat` in `copilot_server.js` / `parseOpenAiRequest`. */
  relayNewChat?: boolean;
  relaySessionId?: string;
  relayRequestId?: string;
  /** Optional local files to send through `relay_attachments` (same path as the desktop app). */
  relayAttachments?: string[];
  /** Default 240s (Copilot can exceed 180s on slow paths). */
  timeoutMs?: number;
};

export async function postCopilotChatCompletion(opts: CopilotCompletionOptions): Promise<{
  assistantText: string;
  raw: unknown;
}> {
  const base = COPILOT_SERVER_URL.replace(/\/$/, "");
  const url = `${base}/v1/chat/completions`;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt?.trim()) {
    messages.push({ role: "system", content: opts.systemPrompt.trim() });
  }
  messages.push({ role: "user", content: opts.userPrompt });

  const body: Record<string, unknown> = {
    model: "relay-copilot-e2e",
    messages,
    relay_session_id: opts.relaySessionId ?? "playwright-session",
    relay_request_id:
      opts.relayRequestId ??
      globalThis.crypto?.randomUUID?.() ??
      `req-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
  if (opts.relayNewChat === true) {
    body.relay_new_chat = true;
  }
  if (opts.relayAttachments?.length) {
    body.relay_attachments = opts.relayAttachments;
  }

  const timeoutMs = opts.timeoutMs ?? 240_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...copilotServerAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `copilot_server POST ${res.status}: expected JSON, got: ${text.slice(0, 400)}`,
      );
    }
    if (!res.ok) {
      const errMsg =
        typeof json === "object" && json !== null && "error" in json
          ? formatCopilotServerError((json as { error: unknown }).error)
          : text.slice(0, 500);
      throw new Error(`copilot_server HTTP ${res.status}: ${errMsg}`);
    }
    const choices = (json as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    const assistantText = choices?.[0]?.message?.content ?? "";
    return { assistantText: String(assistantText), raw: json };
  } finally {
    clearTimeout(timer);
  }
}

function formatCopilotServerError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
