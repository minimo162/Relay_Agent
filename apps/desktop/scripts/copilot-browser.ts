import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page, type Response } from "playwright";

const COPILOT_URL = "https://m365.cloud.microsoft/chat/";
const NEW_CHAT_SELECTOR = '[data-testid="newChatButton"]';
const EDITOR_SELECTOR = "#m365-chat-editor-target-element";
const SEND_READY_SEL = ".fai-SendButton:not([disabled])";
const API_URL_PATTERN = "/sydney/conversation";
const DOM_STABLE_POLLS = 2;
const DOM_POLL_INTERVAL_MS = 200;
const MAX_COPILOT_RETRIES = 2;
const NETWORK_CAPTURE_TIMEOUT_MS = 15_000;

// Candidate selectors tried in order for DOM polling fallback.
// The first selector that yields non-empty text wins.
const RESPONSE_SEL_CANDIDATES = [
  '[data-testid="markdown-reply"]',
  '[data-testid="chat-message-content"]',
  '[data-testid="chat-turn-message"]',
  ".chat-turn-response",
  "cib-message-group[slot='assistant'] cib-message",
  "[class*='ResponseText']",
  "[class*='responseText']",
  "[class*='chat-bubble']",
];

type ErrorCode =
  | "CDP_UNAVAILABLE"
  | "NOT_LOGGED_IN"
  | "RESPONSE_TIMEOUT"
  | "COPILOT_ERROR"
  | "SEND_FAILED";

type ConnectResult =
  | { status: "ready" }
  | { status: "error"; errorCode: ErrorCode; message: string };

type SendResult =
  | { status: "ok"; response: string }
  | { status: "error"; errorCode: ErrorCode; message: string };

type CliOptions = {
  action: "connect" | "send";
  cdpPort: number;
  timeout: number;
};

type SendInput = {
  prompt: string;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result =
    options.action === "connect"
      ? await handleConnect(options)
      : await handleSend(options);

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseCliOptions(argv: string[]): CliOptions {
  let action: CliOptions["action"] | null = null;
  let cdpPort = 9222;
  let timeout = 60000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--action":
        if (next !== "connect" && next !== "send") {
          throw new Error("`--action` must be `connect` or `send`.");
        }
        action = next;
        index += 1;
        break;
      case "--cdp-port":
        cdpPort = parseNumberArg(next, "--cdp-port");
        index += 1;
        break;
      case "--timeout":
        timeout = parseNumberArg(next, "--timeout");
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!action) {
    throw new Error("`--action` is required.");
  }

  return { action, cdpPort, timeout };
}

function parseNumberArg(rawValue: string | undefined, flag: string): number {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

async function handleConnect(options: CliOptions): Promise<ConnectResult> {
  let browser: Browser | null = null;

  try {
    browser = await connectToBrowser(options);
    const page = await ensureCopilotPage(browser, options.timeout);
    const loginResult = detectLoginPage(page);
    if (loginResult) {
      return loginResult;
    }

    return { status: "ready" };
  } catch (error) {
    return toErrorResult(error, "connect");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function handleSend(options: CliOptions): Promise<SendResult> {
  let browser: Browser | null = null;

  try {
    const input = await readSendInput();
    browser = await connectToBrowser(options);
    const page = await ensureCopilotPage(browser, options.timeout);
    const loginResult = detectLoginPage(page);
    if (loginResult) {
      return loginResult;
    }

    for (let attempt = 0; attempt <= MAX_COPILOT_RETRIES; attempt += 1) {
      const responseText = await runSendAttempt(page, input.prompt, options.timeout);
      if (isKnownCopilotError(responseText)) {
        if (attempt === MAX_COPILOT_RETRIES) {
          return {
            status: "error",
            errorCode: "COPILOT_ERROR",
            message: responseText
          };
        }
        continue;
      }

      return {
        status: "ok",
        response: stripCitations(responseText)
      };
    }

    return {
      status: "error",
      errorCode: "COPILOT_ERROR",
      message: "Copilot returned an unrecoverable error."
    };
  } catch (error) {
    return toErrorResult(error, "send");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function connectToBrowser(options: Pick<CliOptions, "cdpPort">): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(`http://localhost:${options.cdpPort}`);
  } catch (error) {
    throw createError(
      "CDP_UNAVAILABLE",
      `Failed to connect to Edge on CDP port ${options.cdpPort}: ${describeError(error)}`
    );
  }
}

async function ensureCopilotPage(browser: Browser, timeout: number): Promise<Page> {
  const page = await getOrCreatePage(browser);
  if (!page.url().startsWith(COPILOT_URL)) {
    await page.goto(COPILOT_URL, {
      timeout,
      waitUntil: "domcontentloaded"
    });
  }
  await page.waitForLoadState("domcontentloaded", { timeout });
  return page;
}

function detectLoginPage(page: Page): ConnectResult | null {
  const url = page.url();
  if (/(login|signin)/i.test(url)) {
    return {
      status: "error",
      errorCode: "NOT_LOGGED_IN",
      message: "M365 Copilot login is required before browser automation can continue."
    };
  }
  return null;
}

async function getOrCreatePage(browser: Browser): Promise<Page> {
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  const existingPage = context.pages()[0];
  return existingPage ?? context.newPage();
}

async function runSendAttempt(
  page: Page,
  prompt: string,
  timeout: number
): Promise<string> {
  await startNewChat(page, timeout);
  await enterPrompt(page, prompt, timeout);

  const networkResponsePromise = page.waitForResponse(
    (response) => response.url().includes(API_URL_PATTERN),
    { timeout: Math.min(timeout, NETWORK_CAPTURE_TIMEOUT_MS) }
  );

  await clickSend(page, timeout);

  let responseText = "";
  try {
    const response = await networkResponsePromise;
    responseText = await extractResponseText(response);
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) {
      throw error;
    }
  }

  if (!responseText.trim()) {
    responseText = await readResponseFromDom(page, timeout);
  }

  if (!responseText.trim()) {
    throw createError(
      "RESPONSE_TIMEOUT",
      "Timed out while waiting for Copilot to produce a response."
    );
  }

  return responseText;
}

async function startNewChat(page: Page, timeout: number): Promise<void> {
  const button = firstVisibleLocator(page, [
    page.getByTestId("newChatButton"),
    page.locator(NEW_CHAT_SELECTOR)
  ]);
  const locator = await button;
  if (!locator) {
    return;
  }

  await locator.click({ timeout });
}

async function enterPrompt(page: Page, prompt: string, timeout: number): Promise<void> {
  const candidates = [
    page.locator(EDITOR_SELECTOR),
    page.getByRole("textbox")
  ];

  for (const locator of candidates) {
    if (!(await locator.count())) {
      continue;
    }

    const handle = locator.first();
    if (!(await handle.isVisible().catch(() => false))) {
      continue;
    }

    try {
      await handle.fill(prompt, { timeout });
      return;
    } catch {
      await handle.click({ timeout });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.insertText(prompt);
      return;
    }
  }

  throw createError("SEND_FAILED", "Could not find a Copilot prompt editor.");
}

async function clickSend(page: Page, timeout: number): Promise<void> {
  const sendButton = await firstVisibleLocator(page, [page.locator(SEND_READY_SEL)]);
  if (!sendButton) {
    throw createError("SEND_FAILED", "Could not find an enabled send button.");
  }

  await sendButton.click({ timeout });
}

async function firstVisibleLocator(page: Page, locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (!(await locator.count().catch(() => 0))) {
      continue;
    }

    const handle = locator.first();
    if (await handle.isVisible().catch(() => false)) {
      return handle;
    }
  }

  return null;
}

async function readResponseFromDom(page: Page, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout;
  let lastText = "";
  let stableCount = 0;

  while (Date.now() < deadline) {
    const nextText = await pickFirstNonEmptyFromSelectors(page, RESPONSE_SEL_CANDIDATES);

    if (nextText && nextText === lastText) {
      stableCount += 1;
      if (stableCount >= DOM_STABLE_POLLS) {
        return nextText;
      }
    } else if (nextText) {
      lastText = nextText;
      stableCount = 1;
    }

    await page.waitForTimeout(DOM_POLL_INTERVAL_MS);
  }

  return lastText;
}

async function pickFirstNonEmptyFromSelectors(page: Page, selectors: string[]): Promise<string> {
  for (const sel of selectors) {
    const text = await page
      .locator(sel)
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node.textContent ?? "").trim())
          .filter(Boolean)
          .at(-1) ?? ""
      )
      .catch(() => "");

    if (text) {
      return text;
    }
  }

  return "";
}

async function extractResponseText(response: Response): Promise<string> {
  const body = await response.text();
  const contentType = response.headers()["content-type"] ?? "";

  if (/application\/json/i.test(contentType)) {
    return coerceResponseTextFromPayload(parseJsonSafely(body)) ?? body;
  }

  if (/event-stream|ndjson|jsonl/i.test(contentType) || body.includes("data:")) {
    const chunks = body
      .split(/\r?\n/)
      .map((line) => line.replace(/^data:\s*/, "").trim())
      .filter((line) => line && line !== "[DONE]")
      .map((line) => coerceResponseTextFromPayload(parseJsonSafely(line)) ?? "")
      .filter(Boolean);

    if (chunks.length > 0) {
      return chunks.at(-1) ?? "";
    }
  }

  return coerceResponseTextFromPayload(parseJsonSafely(body)) ?? body.trim();
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function coerceResponseTextFromPayload(value: unknown): string | null {
  const visited = new Set<unknown>();

  function visit(candidate: unknown): string | null {
    if (!candidate || visited.has(candidate)) {
      return null;
    }

    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      return trimmed ? trimmed : null;
    }

    if (typeof candidate !== "object") {
      return null;
    }

    visited.add(candidate);

    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        const match = visit(candidate[index]);
        if (match) {
          return match;
        }
      }
      return null;
    }

    const record = candidate as Record<string, unknown>;
    const preferredKeys = [
      "response",
      "text",
      "content",
      "message",
      "markdown",
      "answer",
      "displayText"
    ];

    for (const key of preferredKeys) {
      const match = visit(record[key]);
      if (match) {
        return match;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const match = visit(nestedValue);
      if (match) {
        return match;
      }
    }

    return null;
  }

  return visit(value);
}

function stripCitations(text: string): string {
  return text
    .replace(/\[(\d+)\](?!\()/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isKnownCopilotError(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return [
    "これについてチャットできません",
    "something went wrong",
    "try again",
    "cannot complete this request",
    "unable to respond"
  ].some((pattern) => normalized.toLowerCase().includes(pattern.toLowerCase()));
}

async function readSendInput(): Promise<SendInput> {
  const raw = await readLineFromStdin();
  const parsed = parseJsonSafely(raw);

  if (!parsed || typeof parsed !== "object") {
    throw createError("SEND_FAILED", "stdin must contain a JSON object.");
  }

  const prompt = (parsed as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw createError("SEND_FAILED", "`prompt` must be a non-empty string.");
  }

  return { prompt };
}

async function readLineFromStdin(): Promise<string> {
  if (process.stdin.readableEnded) {
    throw createError("SEND_FAILED", "stdin did not contain a prompt payload.");
  }

  return new Promise<string>((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        cleanup();
        resolve(buffer.slice(0, newlineIndex).trim());
      }
    };

    const onEnd = () => {
      cleanup();
      const trimmed = buffer.trim();
      if (trimmed) {
        resolve(trimmed);
      } else {
        reject(createError("SEND_FAILED", "stdin did not contain a prompt payload."));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(createError("SEND_FAILED", describeError(error)));
    };

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

function createError(errorCode: ErrorCode, message: string): Error & { errorCode: ErrorCode } {
  const error = new Error(message) as Error & { errorCode: ErrorCode };
  error.errorCode = errorCode;
  return error;
}

function toErrorResult(error: unknown, action: "connect" | "send"): ConnectResult | SendResult {
  const errorCode = extractErrorCode(error) ?? (action === "connect" ? "CDP_UNAVAILABLE" : "SEND_FAILED");
  return {
    status: "error",
    errorCode,
    message: describeError(error)
  };
}

function extractErrorCode(error: unknown): ErrorCode | null {
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    typeof (error as { errorCode?: unknown }).errorCode === "string"
  ) {
    const code = (error as { errorCode: string }).errorCode;
    if (
      code === "CDP_UNAVAILABLE" ||
      code === "NOT_LOGGED_IN" ||
      code === "RESPONSE_TIMEOUT" ||
      code === "COPILOT_ERROR" ||
      code === "SEND_FAILED"
    ) {
      return code;
    }
  }

  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unexpected browser automation error.";
}

main().catch((error) => {
  const result = toErrorResult(error, "send");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
