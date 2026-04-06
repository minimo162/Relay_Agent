import { accessSync, constants, mkdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { chromium, errors, type Browser, type Locator, type Page, type Response } from "playwright";

const COPILOT_URL = "https://m365.cloud.microsoft/chat/";
/** Default when not using `--auto-launch` (attach to existing browser). */
const DEFAULT_CDP_PORT = 9333;
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

type SelectorProbe = {
  name: string;
  selector: string;
  count: number;
  visible: boolean;
  sampleText: string | null;
};

type ObservedResponse = {
  url: string;
  status: number;
  contentType: string | null;
  matchedConfiguredPattern: boolean;
};

type InspectResult =
  | {
      status: "ok";
      cdpPort: number;
      page: {
        url: string;
        title: string;
      };
      promptAvailable: boolean;
      selectorProbes: SelectorProbe[];
      responseSelectorProbes: SelectorProbe[];
      suggestedApiPatterns: string[];
      sendProbe:
        | {
            promptPreview: string;
            responseSource: "network" | "dom" | "none";
            matchedConfiguredPattern: boolean;
            responseExcerpt: string | null;
            observedResponses: ObservedResponse[];
            usedSelectors: {
              newChatSelector: string | null;
              editorSelector: string | null;
              sendSelector: string | null;
              responseSelector: string | null;
            };
          }
        | null;
    }
  | ErrorResult;

type CliOptions = {
  action: "connect" | "send" | "inspect";
  cdpPort: number;
  autoLaunch: boolean;
  timeout: number;
  prompt?: string;
};

type SendInput = {
  prompt: string;
};

type CandidateLocator = {
  label: string;
  locator: Locator;
};

type SendAttemptDiagnostics = {
  observedResponses: ObservedResponse[];
  newChatSelector: string | null;
  editorSelector: string | null;
  sendSelector: string | null;
  responseSelector: string | null;
  responseSource: "network" | "dom" | "none";
  matchedConfiguredPattern: boolean;
};

type SendAttemptResult = {
  responseText: string;
  diagnostics: SendAttemptDiagnostics;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result =
    options.action === "connect"
      ? await handleConnect(options)
      : options.action === "inspect"
        ? await handleInspect(options, options.prompt)
        : await handleSend(options, options.prompt);

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseCliOptions(argv: string[]): CliOptions {
  let action: CliOptions["action"] | null = null;
  let cdpPort = DEFAULT_CDP_PORT;
  let autoLaunch = false;
  let timeout = 60000;
  let prompt: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--action":
        if (next !== "connect" && next !== "send" && next !== "inspect") {
          throw new Error("`--action` must be `connect`, `send`, or `inspect`.");
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
      const response = await runSendAttempt(page, input.prompt, options.timeout);
      const responseText = response.responseText;
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

async function handleInspect(options: CliOptions, promptArg?: string): Promise<InspectResult> {
  let browser: Browser | null = null;

  try {
    const connection = await connectToBrowser(options);
    browser = connection.browser;
    const page = await ensureCopilotPage(browser, options.timeout);
    const availabilityResult = await detectCopilotAvailability(page, options.timeout);
    if (availabilityResult) {
      return availabilityResult;
    }

    const selectorProbes = await probeSelectors(page, [
      { name: "newChatButton", selector: NEW_CHAT_SELECTOR },
      { name: "editor", selector: EDITOR_SELECTOR },
      { name: "sendReady", selector: SEND_READY_SEL },
      { name: "textboxRole", selector: "role=textbox" }
    ]);
    const responseSelectorProbes = await probeSelectors(
      page,
      RESPONSE_SEL_CANDIDATES.map((selector, index) => ({
        name: `responseCandidate${index + 1}`,
        selector
      }))
    );

    let sendProbe: InspectResult["sendProbe"] = null;
    let suggestedApiPatterns: string[] = [API_URL_PATTERN];

    if (promptArg?.trim()) {
      const sendResult = await runSendAttempt(page, promptArg, options.timeout);
      suggestedApiPatterns = buildSuggestedApiPatterns(sendResult.diagnostics.observedResponses);
      sendProbe = {
        promptPreview: buildPromptPreview(promptArg),
        responseSource: sendResult.diagnostics.responseSource,
        matchedConfiguredPattern: sendResult.diagnostics.matchedConfiguredPattern,
        responseExcerpt: buildResponseExcerpt(sendResult.responseText),
        observedResponses: sendResult.diagnostics.observedResponses,
        usedSelectors: {
          newChatSelector: sendResult.diagnostics.newChatSelector,
          editorSelector: sendResult.diagnostics.editorSelector,
          sendSelector: sendResult.diagnostics.sendSelector,
          responseSelector: sendResult.diagnostics.responseSelector
        }
      };
    }

    return {
      status: "ok",
      cdpPort: connection.port,
      page: {
        url: page.url(),
        title: await page.title().catch(() => "")
      },
      promptAvailable: await hasUsableCopilotPrompt(page),
      selectorProbes,
      responseSelectorProbes,
      suggestedApiPatterns,
      sendProbe
    };
  } catch (error) {
    return toErrorResult(error, "connect");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function relayAgentEdgeProfileDir(): string {
  return path.join(os.homedir(), "RelayAgentEdgeProfile");
}

function readDevToolsActivePort(profileDir: string): number | null {
  try {
    const raw = readFileSync(path.join(profileDir, "DevToolsActivePort"), "utf8");
    const line = raw.split("\n")[0]?.trim() ?? "";
    const port = parseInt(line, 10);
    if (!Number.isFinite(port) || port <= 0) {
      return null;
    }
    return port;
  } catch {
    return null;
  }
}

async function waitForDevToolsActivePort(profileDir: string, maxWaitMs: number): Promise<number> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const p = readDevToolsActivePort(profileDir);
    if (p !== null && (await isCdpListening(p))) {
      return p;
    }
    await sleep(100);
  }
  throw createError(
    "CDP_UNAVAILABLE",
    `DevToolsActivePort did not become ready under ${profileDir} within ${maxWaitMs}ms.`
  );
}

async function resolveCdpPortAutoLaunch(): Promise<number> {
  const profileDir = relayAgentEdgeProfileDir();
  mkdirSync(profileDir, { recursive: true });
  const existing = readDevToolsActivePort(profileDir);
  if (existing !== null && (await isCdpListening(existing))) {
    emitProgress("cdp_connect", `既存の Relay Agent 用 Edge に接続（ポート ${existing}）…`);
    return existing;
  }
  emitProgress("edge_launch", "Edge を起動中（CDP ポートは OS が自動割り当て）…");
  await launchEdgeWithAutoCdpPort(profileDir);
  return waitForDevToolsActivePort(profileDir, 30_000);
}

async function connectToBrowser(
  options: Pick<CliOptions, "cdpPort" | "autoLaunch">
): Promise<{ browser: Browser; port: number }> {
  const port = options.autoLaunch ? await resolveCdpPortAutoLaunch() : options.cdpPort;

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

/** Match Rust `launch_dedicated_edge`: isolated profile + OS-assigned debug port. */
async function launchEdgeWithAutoCdpPort(profileDir: string): Promise<void> {
  const edgeExecutable = resolveEdgeExecutable();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      edgeExecutable,
      [
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-restore-session-state",
        "about:blank"
      ],
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
): Promise<SendAttemptResult> {
  const diagnostics: SendAttemptDiagnostics = {
    observedResponses: [],
    newChatSelector: null,
    editorSelector: null,
    sendSelector: null,
    responseSelector: null,
    responseSource: "none",
    matchedConfiguredPattern: false
  };
  const onResponse = (response: Response) => {
    const url = response.url();
    if (!isRelevantObservedResponse(url)) {
      return;
    }

    const observed: ObservedResponse = {
      url,
      status: response.status(),
      contentType: response.headers()["content-type"] ?? null,
      matchedConfiguredPattern: url.includes(API_URL_PATTERN)
    };
    if (observed.matchedConfiguredPattern) {
      diagnostics.matchedConfiguredPattern = true;
    }
    diagnostics.observedResponses.push(observed);
  };

  page.on("response", onResponse);

  try {
    diagnostics.newChatSelector = await startNewChat(page, timeout);
    diagnostics.editorSelector = await enterPrompt(page, prompt, timeout);

    const networkResponsePromise = page.waitForResponse(
      (response) => response.url().includes(API_URL_PATTERN),
      { timeout: Math.min(timeout, NETWORK_CAPTURE_TIMEOUT_MS) }
    );

    diagnostics.sendSelector = await clickSend(page, timeout);

    // Wait for the send button to re-enable — this signals Copilot has finished
    // generating. We do this before any DOM read to avoid capturing partial text.
    await waitForGenerationComplete(page, timeout);

    let responseText = "";
    try {
      const response = await networkResponsePromise;
      responseText = await extractResponseText(response);
      if (responseText.trim()) {
        diagnostics.responseSource = "network";
        diagnostics.matchedConfiguredPattern = true;
      }
    } catch {
      // Network capture is opportunistic. If it fails, fall back to DOM polling.
    }

    if (!responseText.trim()) {
      const domResult = await readResponseFromDom(page, timeout);
      responseText = domResult.text;
      if (responseText.trim()) {
        diagnostics.responseSource = "dom";
        diagnostics.responseSelector = domResult.selector;
      }
    }

    if (!responseText.trim()) {
      throw createError(
        "RESPONSE_TIMEOUT",
        "Timed out while waiting for Copilot to produce a response."
      );
    }

    return {
      responseText,
      diagnostics
    };
  } finally {
    page.off("response", onResponse);
    diagnostics.observedResponses = dedupeObservedResponses(diagnostics.observedResponses);
  }
}

async function startNewChat(page: Page, timeout: number): Promise<string | null> {
  const button = await firstVisibleLocator([
    { label: 'getByTestId("newChatButton")', locator: page.getByTestId("newChatButton") },
    { label: NEW_CHAT_SELECTOR, locator: page.locator(NEW_CHAT_SELECTOR) }
  ]);
  if (!button) {
    return null;
  }

  await button.locator.click({ timeout });
  return button.label;
}

async function enterPrompt(page: Page, prompt: string, timeout: number): Promise<string> {
  const candidates: CandidateLocator[] = [
    { label: EDITOR_SELECTOR, locator: page.locator(EDITOR_SELECTOR) },
    { label: 'getByRole("textbox")', locator: page.getByRole("textbox") }
  ];

  for (const candidate of candidates) {
    if (!(await candidate.locator.count())) {
      continue;
    }

    const handle = candidate.locator.first();
    if (!(await handle.isVisible().catch(() => false))) {
      continue;
    }

    try {
      await handle.fill(prompt, { timeout });
      return candidate.label;
    } catch {
      await handle.click({ timeout });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.insertText(prompt);
      return candidate.label;
    }
  }

  throw createError("SEND_FAILED", "Could not find a Copilot prompt editor.");
}

async function clickSend(page: Page, timeout: number): Promise<string> {
  const sendButton = await firstVisibleLocator([
    { label: SEND_READY_SEL, locator: page.locator(SEND_READY_SEL) }
  ]);
  if (!sendButton) {
    throw createError("SEND_FAILED", "Could not find an enabled send button.");
  }

  await sendButton.locator.click({ timeout });
  return sendButton.label;
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

async function firstVisibleLocator(candidates: CandidateLocator[]): Promise<CandidateLocator | null> {
  for (const candidate of candidates) {
    if (!(await candidate.locator.count().catch(() => 0))) {
      continue;
    }

    const handle = candidate.locator.first();
    if (await handle.isVisible().catch(() => false)) {
      return {
        label: candidate.label,
        locator: handle
      };
    }
  }

  return null;
}

async function readResponseFromDom(
  page: Page,
  timeout: number
): Promise<{ text: string; selector: string | null }> {
  const deadline = Date.now() + timeout;
  let lastText = "";
  let stableCount = 0;
  let lastSelector: string | null = null;

  while (Date.now() < deadline) {
    const { text: nextText, selector } = await pickFirstNonEmptyFromSelectors(page, RESPONSE_SEL_CANDIDATES);

    if (nextText && nextText === lastText) {
      stableCount += 1;
      if (stableCount >= DOM_STABLE_POLLS) {
        return {
          text: nextText,
          selector: selector ?? lastSelector
        };
      }
    } else if (nextText) {
      lastText = nextText;
      lastSelector = selector;
      stableCount = 1;
    }

    await page.waitForTimeout(DOM_POLL_INTERVAL_MS);
  }

  return {
    text: lastText,
    selector: lastSelector
  };
}

async function pickFirstNonEmptyFromSelectors(
  page: Page,
  selectors: string[]
): Promise<{ text: string; selector: string | null }> {
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
      return {
        text,
        selector: sel
      };
    }
  }

  return {
    text: "",
    selector: null
  };
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

async function probeSelectors(
  page: Page,
  probes: Array<{ name: string; selector: string }>
): Promise<SelectorProbe[]> {
  const results: SelectorProbe[] = [];

  for (const probe of probes) {
    if (probe.selector === "role=textbox") {
      const locator = page.getByRole("textbox");
      const handle = locator.first();
      results.push({
        name: probe.name,
        selector: probe.selector,
        count: await locator.count().catch(() => 0),
        visible: await handle.isVisible().catch(() => false),
        sampleText: await readLocatorSampleText(handle)
      });
      continue;
    }

    const locator = page.locator(probe.selector);
    const handle = locator.first();
    results.push({
      name: probe.name,
      selector: probe.selector,
      count: await locator.count().catch(() => 0),
      visible: await handle.isVisible().catch(() => false),
      sampleText: await readLocatorSampleText(handle)
    });
  }

  return results;
}

async function readLocatorSampleText(locator: Locator): Promise<string | null> {
  const text = await locator
    .evaluate((node) => (node.textContent ?? "").trim().slice(0, 160))
    .catch(() => "");

  return text || null;
}

function dedupeObservedResponses(observedResponses: ObservedResponse[]): ObservedResponse[] {
  const seen = new Set<string>();
  const results: ObservedResponse[] = [];

  for (const item of observedResponses) {
    const key = `${item.url}|${item.status}|${item.contentType ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(item);
  }

  return results;
}

function isRelevantObservedResponse(url: string): boolean {
  return /(copilot|sydney|conversation|chat|m365\.cloud\.microsoft)/i.test(url);
}

function buildSuggestedApiPatterns(observedResponses: ObservedResponse[]): string[] {
  const candidates = observedResponses
    .map((item) => {
      try {
        const parsed = new URL(item.url);
        return parsed.pathname;
      } catch {
        return item.url;
      }
    })
    .filter((value) => /(conversation|chat|copilot|sydney)/i.test(value));

  const prioritized = [
    ...candidates.filter((value) => value.includes(API_URL_PATTERN)),
    ...candidates.filter((value) => !value.includes(API_URL_PATTERN))
  ];

  return Array.from(new Set(prioritized)).slice(0, 8);
}

function buildPromptPreview(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

function buildResponseExcerpt(responseText: string): string | null {
  const trimmed = responseText.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }

  return trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 197)}...`;
}

main().catch((error) => {
  const result = toErrorResult(error, "send");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
