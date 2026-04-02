import { accessSync, constants } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import net from "net";
import { chromium, errors, type Browser, type Locator, type Page, type Response } from "playwright";

const COPILOT_URL = "https://m365.cloud.microsoft/chat/";
const CDP_PORT_RANGE_START = 9333;
const CDP_PORT_RANGE_END = 9342;
const NEW_CHAT_SELECTOR = '[data-testid="newChatButton"]';
const EDITOR_SELECTOR = "#m365-chat-editor-target-element";
const SEND_READY_SEL = ".fai-SendButton:not([disabled])";
const API_URL_PATTERN = "/sydney/conversation";
const DOM_STABLE_POLLS = 2;
const DOM_POLL_INTERVAL_MS = 200;
const MAX_COPILOT_RETRIES = 2;
const NETWORK_CAPTURE_TIMEOUT_MS = 15_000;
const COPILOT_UI_CHECK_TIMEOUT_MS = 5_000;
const COPILOT_UI_CHECK_POLL_MS = 250;
const COPILOT_UPSELL_PATTERNS = [
  /Microsoft 365 をアップグレードして Copilot Chat を使用する/i,
  /アップグレード時にプレミアム Copilot 特典を受ける/i,
  /Microsoft 365 を購入/i,
  /プランを比較/i
];

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

type ErrorResult = { status: "error"; errorCode: ErrorCode; message: string };

type ConnectResult =
  | { status: "ready"; cdpPort: number }
  | ErrorResult;

type SendResult =
  | { status: "ok"; response: string; cdpPort: number }
  | ErrorResult;

type CliOptions = {
  action: "connect" | "send";
  cdpPort: number;
  autoLaunch: boolean;
  timeout: number;
  prompt?: string;
};

type SendInput = {
  prompt: string;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result =
    options.action === "connect"
      ? await handleConnect(options)
      : await handleSend(options, options.prompt);

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseCliOptions(argv: string[]): CliOptions {
  let action: CliOptions["action"] | null = null;
  let cdpPort = CDP_PORT_RANGE_START;
  let autoLaunch = false;
  let timeout = 60000;
  let prompt: string | undefined;

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
      case "--auto-launch":
        autoLaunch = true;
        break;
      case "--timeout":
        timeout = parseNumberArg(next, "--timeout");
        index += 1;
        break;
      case "--prompt":
        if (next === undefined) {
          throw new Error("`--prompt` requires a value.");
        }
        prompt = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!action) {
    throw new Error("`--action` is required.");
  }

  return { action, cdpPort, autoLaunch, timeout, prompt };
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
    const connection = await connectToBrowser(options);
    browser = connection.browser;
    const page = await ensureCopilotPage(browser, options.timeout);
    const availabilityResult = await detectCopilotAvailability(page, options.timeout);
    if (availabilityResult) {
      return availabilityResult;
    }

    return {
      status: "ready",
      cdpPort: connection.port
    };
  } catch (error) {
    return toErrorResult(error, "connect");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function handleSend(options: CliOptions, promptArg?: string): Promise<SendResult> {
  let browser: Browser | null = null;

  try {
    const input = promptArg
      ? { prompt: promptArg }
      : await readSendInput();
    const connection = await connectToBrowser(options);
    browser = connection.browser;
    const page = await ensureCopilotPage(browser, options.timeout);
    const availabilityResult = await detectCopilotAvailability(page, options.timeout);
    if (availabilityResult) {
      return availabilityResult;
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
        response: stripCitations(responseText),
        cdpPort: connection.port
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

async function connectToBrowser(
  options: Pick<CliOptions, "cdpPort" | "autoLaunch">
): Promise<{ browser: Browser; port: number }> {
  let port = options.cdpPort;

  if (options.autoLaunch) {
    const existing = await findExistingCdpEdge();
    if (existing !== null) {
      port = existing;
      emitProgress("cdp_connect", `既存の Edge に接続中（ポート ${port}）…`);
    } else {
      emitProgress("port_scan", "空きポートを探索中…");
      port = await findAvailableCdpPort();
      emitProgress("edge_launch", `Edge を起動中（ポート ${port}）…`);
      await launchEdgeWithCdp(port);
    }
  }

  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    if (options.autoLaunch) {
      emitProgress("cdp_connect", "接続しました");
    }
    return { browser, port };
  } catch (error) {
    throw createError(
      "CDP_UNAVAILABLE",
      `Failed to connect to Edge on CDP port ${port}: ${describeError(error)}`
    );
  }
}

function emitProgress(step: string, detail?: string): void {
  process.stdout.write(`${JSON.stringify({ type: "progress", step, detail })}\n`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let settled = false;

    const finish = (isFree: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(isFree);
    };

    socket.once("connect", () => {
      finish(false);
    });
    socket.once("error", () => {
      finish(true);
    });
  });
}

async function findAvailableCdpPort(): Promise<number> {
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw createError(
    "CDP_UNAVAILABLE",
    `All CDP ports ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END} are in use.`
  );
}

async function findExistingCdpEdge(): Promise<number | null> {
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port += 1) {
    if (await isCdpListening(port)) {
      return port;
    }
  }

  return null;
}

async function launchEdgeWithCdp(port: number): Promise<void> {
  const edgeExecutable = resolveEdgeExecutable();

  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      edgeExecutable,
      [`--remote-debugging-port=${port}`, "--no-first-run"],
      { detached: true, stdio: "ignore" }
    );

    const handleError = (error: Error) => {
      reject(
        createError("CDP_UNAVAILABLE", `Failed to launch Edge: ${describeError(error)}`)
      );
    };

    child.once("error", handleError);
    child.once("spawn", () => {
      child.off("error", handleError);
      child.unref();
      resolve();
    });
  });

  await waitForCdpReady(port, { maxWaitMs: 5000, intervalMs: 500 });
}

async function waitForCdpReady(
  port: number,
  opts: { maxWaitMs: number; intervalMs: number }
): Promise<void> {
  const deadline = Date.now() + opts.maxWaitMs;

  while (Date.now() < deadline) {
    if (await isCdpListening(port)) {
      return;
    }

    await sleep(opts.intervalMs);
  }

  throw createError(
    "CDP_UNAVAILABLE",
    `Edge launched but CDP did not respond on port ${port} within ${opts.maxWaitMs}ms.`
  );
}

async function isCdpListening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureCopilotPage(browser: Browser, timeout: number): Promise<Page> {
  const page = await getOrCreatePage(browser);
  if (shouldNavigateToCopilot(page.url())) {
    try {
      await page.goto(COPILOT_URL, {
        timeout,
        waitUntil: "domcontentloaded"
      });
    } catch (error) {
      const message = describeError(error);
      if (!(error instanceof errors.TimeoutError) && !/ERR_ABORTED/i.test(message)) {
        throw error;
      }
    }
  }
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
  return page;
}

function shouldNavigateToCopilot(url: string): boolean {
  if (!url || url === "about:blank") {
    return true;
  }

  return !/(m365\.cloud\.microsoft|login|signin|microsoftonline)/i.test(url);
}

async function detectCopilotAvailability(
  page: Page,
  timeout: number
): Promise<ErrorResult | null> {
  const url = page.url();
  if (/(login|signin)/i.test(url)) {
    return {
      status: "error",
      errorCode: "NOT_LOGGED_IN",
      message: "M365 Copilot login is required before browser automation can continue."
    };
  }

  const deadline = Date.now() + Math.min(timeout, COPILOT_UI_CHECK_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (await hasUsableCopilotPrompt(page)) {
      return null;
    }

    const unsupportedAccountState = await detectUnsupportedAccountState(page);
    if (unsupportedAccountState) {
      return unsupportedAccountState;
    }

    await page.waitForTimeout(COPILOT_UI_CHECK_POLL_MS);
  }

  if (await hasUsableCopilotPrompt(page)) {
    return null;
  }

  return (
    (await detectUnsupportedAccountState(page)) ?? {
      status: "error",
      errorCode: "NOT_LOGGED_IN",
      message:
        "M365 Copilot is open in Edge, but the current account cannot send prompts. Sign in with the account that has access to M365 Copilot and reopen chat."
    }
  );
}

async function hasUsableCopilotPrompt(page: Page): Promise<boolean> {
  const candidates = [page.locator(EDITOR_SELECTOR).first(), page.getByRole("textbox").first()];

  for (const candidate of candidates) {
    if (!(await candidate.count().catch(() => 0))) {
      continue;
    }

    if (await candidate.isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function detectUnsupportedAccountState(page: Page): Promise<ErrorResult | null> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (!bodyText) {
    return null;
  }

  if (COPILOT_UPSELL_PATTERNS.some((pattern) => pattern.test(bodyText))) {
    return {
      status: "error",
      errorCode: "NOT_LOGGED_IN",
      message:
        "M365 Copilot opened in Edge, but the current account does not have access to Copilot chat. Sign in with the account that can use M365 Copilot and reopen chat."
    };
  }

  return null;
}

function resolveEdgeExecutable(): string {
  const candidates =
    process.platform === "win32"
      ? [
          process.env["ProgramFiles(x86)"] &&
            path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
          process.env.ProgramFiles &&
            path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(os.homedir(), "AppData", "Local", "Microsoft", "Edge", "Application", "msedge.exe"),
          "msedge.exe"
        ]
      : ["msedge"];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!candidate.includes(path.sep)) {
      return candidate;
    }

    if (canAccessFile(candidate)) {
      return candidate;
    }
  }

  throw createError(
    "CDP_UNAVAILABLE",
    "Microsoft Edge could not be found. Install Edge or launch it manually with remote debugging enabled."
  );
}

function canAccessFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

  // Wait for the send button to re-enable — this signals Copilot has finished
  // generating. We do this before any DOM read to avoid capturing partial text.
  await waitForGenerationComplete(page, timeout);

  let responseText = "";
  try {
    const response = await networkResponsePromise;
    responseText = await extractResponseText(response);
  } catch {
    // Network capture is opportunistic. If it fails, fall back to DOM polling.
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

/**
 * Wait until the send button becomes enabled again, which signals that Copilot
 * has finished streaming its response. Falls back silently on timeout so that
 * DOM polling still has a chance to capture whatever is available.
 */
async function waitForGenerationComplete(page: Page, timeout: number): Promise<void> {
  try {
    // After clicking send the button briefly becomes enabled then disabled while
    // Copilot starts generating. Give it 2 s to go disabled first.
    await page.waitForSelector(".fai-SendButton[disabled]", { timeout: 2_000 }).catch(() => undefined);
    // Now wait for it to become enabled again (= generation complete).
    await page.waitForSelector(SEND_READY_SEL, { timeout });
  } catch {
    // Timeout — Copilot may still be generating; fall through to DOM polling.
  }
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

function toErrorResult(error: unknown, action: "connect" | "send"): ErrorResult {
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
