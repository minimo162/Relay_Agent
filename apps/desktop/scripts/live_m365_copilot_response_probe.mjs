#!/usr/bin/env node
/**
 * Playwright + CDP: send prompts to a signed-in M365 Copilot tab and save
 * visible-response artifacts that can be compared with Relay's DOM extractors.
 *
 * Example:
 *   pnpm --filter @relay-agent/desktop live:m365:copilot-response-probe -- \
 *     --prompt "日本の首都はどこですか？一言で答えてください。" \
 *     --prompt "次の fenced block をそのまま返してください: ```relay_tool\n{\"relay_tool_call\":true,\"name\":\"noop\",\"input\":{}}\n```"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import {
  ASSISTANT_REPLY_DOM_SELECTORS,
  COMPOSER_ANCESTOR_CLOSEST,
} from "../src-tauri/binaries/copilot_dom_poll.mjs";
import {
  extractAssistantReplyHeuristic,
  extractAssistantReplyStrict,
  extractAssistantReplyText,
  normalizeCopilotVisibleText,
  resolveAssistantReplyForReturn,
  waitForDomResponse,
} from "../src-tauri/binaries/copilot_wait_dom_response.mjs";

const DEFAULT_CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9360";
const DEFAULT_TIMEOUT_MS = 120_000;
const CHAT_URL = "https://m365.cloud.microsoft/chat/";
const RESPONSE_URL_RE =
  /substrate\.office\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|api\.bing\.microsoft\.com|services\.actions\.ms/i;

const NEW_CHAT_SELECTORS = [
  '[data-testid="newChatButton"]',
  'button[aria-label*="New chat"]',
  'button[aria-label*="新しいチャット"]',
  'button[aria-label*="New conversation"]',
];

const COMPOSER_SELECTORS = [
  "#m365-chat-editor-target-element",
  '[data-lexical-editor="true"]',
  'div[role="textbox"][aria-label*="Copilot"]',
  'div[role="textbox"][aria-label*="メッセージ"]',
  'div[role="textbox"][aria-label*="Send a message"]',
  'div[role="textbox"]',
];

const SEND_SELECTORS = [
  ".fai-SendButton:not([disabled])",
  'button[data-testid="sendButton"]:not([disabled])',
  'button[data-testid^="send"]:not([disabled])',
  'button[aria-label*="Send"]:not([disabled])',
  'button[aria-label*="送信"]:not([disabled])',
];

function parseArgs(argv) {
  const prompts = [];
  let cdpEndpoint = DEFAULT_CDP_ENDPOINT;
  let outputDir = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let newChatPerPrompt = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--":
        break;
      case "--cdp-endpoint":
        if (!next) throw new Error("--cdp-endpoint requires a value");
        cdpEndpoint = next;
        i += 1;
        break;
      case "--output-dir":
        if (!next) throw new Error("--output-dir requires a value");
        outputDir = path.resolve(next);
        i += 1;
        break;
      case "--timeout":
        if (!next) throw new Error("--timeout requires a value");
        timeoutMs = parsePositiveInt(next, "--timeout");
        i += 1;
        break;
      case "--prompt":
        if (!next) throw new Error("--prompt requires a value");
        prompts.push(next);
        i += 1;
        break;
      case "--prompt-file":
        if (!next) throw new Error("--prompt-file requires a value");
        prompts.push(fs.readFileSync(path.resolve(next), "utf8"));
        i += 1;
        break;
      case "--keep-chat":
        newChatPerPrompt = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (prompts.length === 0) {
    throw new Error("At least one --prompt or --prompt-file is required");
  }

  return {
    prompts,
    cdpEndpoint,
    outputDir:
      outputDir ??
      fs.mkdtempSync(path.join(os.tmpdir(), "relay-live-copilot-probe-")),
    timeoutMs,
    newChatPerPrompt,
  };
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function relaySessionAdapter(page) {
  return {
    async evaluate(expression) {
      return {
        value: await page.evaluate(expression),
      };
    },
  };
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function firstVisibleLocator(page, selectors, timeoutMs) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (await locator.isVisible({ timeout: Math.min(timeoutMs, 2_000) }).catch(() => false)) {
      return { selector, locator };
    }
  }
  return null;
}

async function ensureCopilotPage(browser, timeoutMs) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  let page =
    pages.find((candidate) => /m365\.cloud\.microsoft.*chat/i.test(candidate.url())) ??
    pages.find((candidate) => /copilot\.microsoft/i.test(candidate.url())) ??
    null;

  if (!page) {
    const context = contexts[0] ?? (await browser.newContext());
    page = await context.newPage();
  }

  if (!/m365\.cloud\.microsoft.*chat|copilot\.microsoft/i.test(page.url() || "")) {
    await page.goto(CHAT_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  }
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
  return page;
}

async function startNewChat(page, timeoutMs) {
  const button = await firstVisibleLocator(page, NEW_CHAT_SELECTORS, timeoutMs);
  if (button) {
    await button.locator.click({ timeout: timeoutMs });
    await page.waitForTimeout(1_500);
    return button.selector;
  }

  await page.goto(CHAT_URL, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page.waitForTimeout(1_500);
  return "Page.goto(chat)";
}

async function findComposer(page, timeoutMs) {
  const composer = await firstVisibleLocator(page, COMPOSER_SELECTORS, timeoutMs);
  if (!composer) {
    throw new Error("Could not find a visible Copilot composer");
  }
  return composer;
}

async function enterPrompt(page, prompt, timeoutMs) {
  const composer = await findComposer(page, timeoutMs);
  await composer.locator.click({ timeout: timeoutMs });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  try {
    await composer.locator.fill(prompt, { timeout: Math.min(timeoutMs, 5_000) });
  } catch {
    await page.keyboard.insertText(prompt);
  }
  await page.waitForTimeout(500);
  return composer.selector;
}

async function clickSend(page, timeoutMs) {
  const send = await firstVisibleLocator(page, SEND_SELECTORS, timeoutMs);
  if (!send) {
    throw new Error("Could not find an enabled send button");
  }
  await send.locator.click({ timeout: timeoutMs });
  return send.selector;
}

async function captureDomState(page, promptText) {
  const relaySession = relaySessionAdapter(page);
  const relayLooseExtract = normalizeCopilotVisibleText(await extractAssistantReplyText(relaySession));
  const relayStrictExtract = normalizeCopilotVisibleText(await extractAssistantReplyStrict(relaySession));
  const relayHeuristicExtract = normalizeCopilotVisibleText(await extractAssistantReplyHeuristic(relaySession));
  const relayResolvedExtract =
    (await resolveAssistantReplyForReturn(
      relaySession,
      relayLooseExtract,
      promptText.length,
      null,
    ).catch(() => null)) ?? "";

  const assistantSelectorMatches = [];
  for (const selector of ASSISTANT_REPLY_DOM_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    const last = count > 0 ? locator.nth(count - 1) : null;
    assistantSelectorMatches.push({
      selector,
      count,
      visibleCount:
        count > 0
          ? await locator.evaluateAll(
              (nodes) =>
                nodes.filter((node) => {
                  const rect = node.getBoundingClientRect?.();
                  if (!rect) return false;
                  const style = getComputedStyle(node);
                  return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    Number(style.opacity || "1") !== 0 &&
                    rect.width > 0 &&
                    rect.height > 0
                  );
                }).length,
            ).catch(() => 0)
          : 0,
      last:
        last
          ? {
              tag: await last.evaluate((el) => el.tagName.toLowerCase()).catch(() => null),
              testId: await last.getAttribute("data-testid").catch(() => null),
              role: await last.getAttribute("data-message-author-role").catch(() => null),
              className:
                await last.evaluate((el) => (el.className ? String(el.className).slice(0, 160) : null)).catch(() => null),
              sampleText:
                await last.evaluate((el) => {
                  const compact = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                  return compact.length > 320 ? `${compact.slice(0, 320)}…` : compact;
                }).catch(() => null),
            }
          : null,
    });
  }

  const selectorMatches = await page.evaluate(
    ({ composerSelector }) => {
      function walk(root, visit, depth = 0) {
        if (!root || depth > 16) return;
        if (root.nodeType === 1) visit(root);
        const tree = root.nodeType === 9 ? root.documentElement : root;
        if (!tree) return;
        for (const child of tree.children || []) walk(child, visit, depth + 1);
        if (tree.shadowRoot) walk(tree.shadowRoot, visit, depth + 1);
      }
      function queryDeepAll(selector, doc) {
        const out = [];
        walk(doc.documentElement || doc.body, (el) => {
          try {
            if (el.matches && el.matches(selector)) out.push(el);
          } catch (_) {}
        });
        return out;
      }
      function visible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect?.();
        if (!rect) return false;
        const style = getComputedStyle(el);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }
      function inComposer(el) {
        return !!(el && el.closest(composerSelector));
      }
      function nodeText(el) {
        return (el.innerText || el.textContent || "").trim();
      }
      function sampleText(text, max = 320) {
        const compact = String(text || "").replace(/\s+/g, " ").trim();
        return compact.length > max ? `${compact.slice(0, max)}…` : compact;
      }
      function summarizeNode(el) {
        return {
          tag: el?.tagName?.toLowerCase() || null,
          testId: el?.getAttribute?.("data-testid") || null,
          role: el?.getAttribute?.("data-message-author-role") || null,
          className: el?.className ? String(el.className).slice(0, 160) : null,
          sampleText: sampleText(nodeText(el)),
        };
      }
      const messageList = queryDeepAll('[data-testid="MessageListContainer"]', document).find(visible) || null;
      const visibleArticles = queryDeepAll("article", document)
        .filter((el) => visible(el) && !inComposer(el))
        .slice(-8)
        .map((el) => summarizeNode(el));
      return {
        pageUrl: location.href,
        pageTitle: document.title,
        bodyTail: sampleText((document.body?.innerText || document.body?.textContent || "").slice(-12000), 12000),
        messageListExists: !!messageList,
        messageListText: messageList ? nodeText(messageList) : "",
        messageListHtml: messageList ? messageList.innerHTML : "",
        visibleArticles,
      };
    },
    {
      composerSelector: COMPOSER_ANCESTOR_CLOSEST,
    },
  );

  let a11ySnapshot = "";
  try {
    const raw =
      typeof page.ariaSnapshot === "function"
        ? await page.ariaSnapshot()
        : await page.locator("body").ariaSnapshot();
    a11ySnapshot = typeof raw === "string" ? raw : String(raw);
  } catch (error) {
    a11ySnapshot = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    relayLooseExtract,
    relayStrictExtract,
    relayHeuristicExtract,
    relayResolvedExtract,
    assistantSelectorMatches,
    a11ySnapshot,
    ...selectorMatches,
  };
}

async function runTurn(page, turnIndex, prompt, options) {
  const turnLabel = `turn-${String(turnIndex + 1).padStart(2, "0")}`;
  const turnDir = path.join(options.outputDir, turnLabel);
  fs.mkdirSync(turnDir, { recursive: true });

  if (turnIndex === 0 || options.newChatPerPrompt) {
    const newChatSelector = await startNewChat(page, options.timeoutMs);
    writeText(path.join(turnDir, "new-chat.txt"), `${newChatSelector}\n`);
  }

  const beforeState = await captureDomState(page, "");
  writeJson(path.join(turnDir, "before.json"), beforeState);
  writeText(path.join(turnDir, "prompt.txt"), prompt);

  const observedResponses = [];
  const onResponse = (response) => {
    const url = response.url();
    if (!RESPONSE_URL_RE.test(url)) return;
    observedResponses.push({
      url,
      status: response.status(),
      contentType: response.headers()["content-type"] ?? null,
    });
  };
  page.on("response", onResponse);

  try {
    const composerSelector = await enterPrompt(page, prompt, options.timeoutMs);
    const screenshotBeforeSend = path.join(turnDir, "before-send.png");
    await page.screenshot({ path: screenshotBeforeSend, fullPage: true });
    const sendSelector = await clickSend(page, options.timeoutMs);
    const relayReply = await waitForDomResponse(
      relaySessionAdapter(page),
      null,
      prompt.length,
      null,
      { timeoutMs: options.timeoutMs },
    );
    await page.waitForTimeout(1_000);
    const afterState = await captureDomState(page, prompt);
    const screenshotAfterReply = path.join(turnDir, "after-reply.png");
    await page.screenshot({ path: screenshotAfterReply, fullPage: true });

    writeJson(path.join(turnDir, "after.json"), afterState);
    writeJson(path.join(turnDir, "observed-responses.json"), observedResponses);
    writeText(path.join(turnDir, "reply.txt"), `${relayReply}\n`);
    writeText(path.join(turnDir, "transcript.txt"), `${afterState.messageListText}\n`);
    writeText(path.join(turnDir, "message-list.html"), afterState.messageListHtml);
    writeText(path.join(turnDir, "aria-snapshot.txt"), `${afterState.a11ySnapshot}\n`);

    return {
      turn: turnLabel,
      promptChars: prompt.length,
      composerSelector,
      sendSelector,
      replyChars: relayReply.length,
      relayReply,
      relayResolvedExtract: afterState.relayResolvedExtract,
      messageListTextChars: afterState.messageListText.length,
      artifactDir: turnDir,
    };
  } finally {
    page.off("response", onResponse);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });

  const browser = await chromium.connectOverCDP(options.cdpEndpoint);
  try {
    const page = await ensureCopilotPage(browser, options.timeoutMs);
    const summary = [];
    for (let i = 0; i < options.prompts.length; i += 1) {
      summary.push(await runTurn(page, i, options.prompts[i], options));
    }
    const output = {
      cdpEndpoint: options.cdpEndpoint,
      outputDir: options.outputDir,
      turns: summary.map((turn) => ({
        ...turn,
        relayReplyPreview:
          turn.relayReply.length > 400 ? `${turn.relayReply.slice(0, 400)}…` : turn.relayReply,
      })),
    };
    writeJson(path.join(options.outputDir, "summary.json"), output);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
