import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, chromium } from "@playwright/test";

import {
  COPILOT_SERVER_URL,
  copilotServerHealth,
  postCopilotChatCompletion,
} from "./copilot-server-http";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
/** Playwright CDP default **9333** (test / YakuLingo-style); Relay app default is 9360 — override with CDP_ENDPOINT. */
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9333";

/** Same priority as `copilot_server.js` / `COMPOSER_ANCESTOR_CLOSEST` — avoids wrong `role=textbox`. */
const M365_COMPOSER_SELECTORS = [
  "#m365-chat-editor-target-element",
  '[data-lexical-editor="true"]',
  'div[role="textbox"][aria-label*="Copilot"]',
  'div[role="textbox"][aria-label*="メッセージ"]',
  'div[role="textbox"][aria-label*="Send a message"]',
  'div[role="textbox"]',
] as const;

/* ── Browser setup via CDP ───────────────────────────────────── */

function assertCopilotServerPrecondition(health: Awaited<ReturnType<typeof copilotServerHealth>>) {
  if (health.ok) return;
  throw new Error(
    `copilot_server is not reachable at ${COPILOT_SERVER_URL} (GET /status failed). ` +
      `Start the Node bridge with the same CDP port as CDP_ENDPOINT, e.g. ` +
      `node apps/desktop/src-tauri/binaries/copilot_server.js --cdp-port 9333 ` +
      `(default HTTP ${COPILOT_SERVER_URL}). Detail: ${health.detail ?? "(none)"}`,
  );
}

async function connectViaCDP() {
  return await chromium.connectOverCDP(CDP_ENDPOINT);
}

async function findCopilotPage(browser: any) {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    for (const page of pages) {
      try {
        const url = page.url();
        if (
          url.includes("m365.cloud.microsoft") ||
          url.includes("copilot.microsoft") ||
          url.includes("copilot.cloud.microsoft")
        ) {
          console.log(`[CDP] Found existing tab: ${url}`);
          return page;
        }
      } catch {
        continue;
      }
    }
  }

  console.log("[CDP] No existing Copilot tab, opening one...");
  const defaultContext = contexts[0] ?? (await browser.newContext());
  const page = await defaultContext.newPage();
  await page.goto(M365_COPILOT_URL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  return page;
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function getBodyLength(page: any): Promise<number> {
  return await page.evaluate(() => document.body.innerText?.length ?? 0);
}

/** Visible string in the M365 chat composer only (not other textboxes). */
async function getM365ComposerText(page: any): Promise<string> {
  return await page.evaluate(() => {
    const root =
      document.querySelector("#m365-chat-editor-target-element") ||
      document.querySelector('[data-lexical-editor="true"]') ||
      document.querySelector('div[role="textbox"][aria-label*="Copilot"]') ||
      document.querySelector('div[role="textbox"][aria-label*="メッセージ"]') ||
      document.querySelector('div[role="textbox"][aria-label*="Send a message"]') ||
      document.querySelector("div[role=\"textbox\"]");
    if (!root) return "";
    return (root.innerText || "").replace(/\u200b/g, "").trim();
  });
}

async function findM365Composer(page: any) {
  for (const sel of M365_COMPOSER_SELECTORS) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 1200 })) return loc;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Start a new conversation in M365 Copilot.
 * Clicks "New Chat" in the sidebar or navigates to /chat.
 */
async function startNewChat(page: any) {
  console.log("[CDP] Starting new chat...");

  // Method 1: Click "New Chat" in sidebar
  const newChatSelectors = [
    'button[aria-label="New chat"]',
    'button[aria-label="新しいチャット"]',
    'a[href*="/chat"]',
    'button:has-text("New Chat")',
    'button:has-text("新しいチャット")',
    // The "+ / New" button in the sidebar
    'div[role="button"]:has-text("+")',
    'button:has(svg):above(textarea)',
  ];

  for (const sel of newChatSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log(`[CDP] New chat via: ${sel}`);
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 2: Navigate to the base chat URL
  console.log("[CDP] No New Chat button found, navigating to /chat...");
  await page.goto(M365_COPILOT_URL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(2000);
  return true;
}

/* ── Tests ───────────────────────────────────────────────────── */

test.describe.configure({ mode: "serial" });

test.describe("M365 Copilot via CDP", () => {
  let browser: any;
  let page: any;

  test.beforeAll(async () => {
    assertCopilotServerPrecondition(await copilotServerHealth());
    browser = await connectViaCDP();
    page = await findCopilotPage(browser);
  });

  test("00 — start a new chat", async () => {
    await startNewChat(page);

    // Verify the page loaded
    const url = page.url();
    console.log(`[CDP] After new chat, URL: ${url}`);

    const input = await findM365Composer(page);
    expect(input).not.toBeNull();
    await expect(input!).toBeVisible({ timeout: 10_000 });

    const composerText = await getM365ComposerText(page);
    console.log(`[CDP] Composer text (should be empty): "${composerText}"`);

    await page.screenshot({ path: "test-results/cdp-00-new-chat.png" });
  });

  test("01 — m365.cloud.microsoft/chat is ready", async () => {
    const url = page.url();
    console.log(`[CDP] Current URL: ${url}`);
    expect(url).toBeTruthy();

    const title = await page.title();
    console.log(`[CDP] Page title: ${title}`);
    expect(title).toBeTruthy();

    await page.screenshot({ path: "test-results/cdp-01-chat-ready.png" });
  });

  test("02 — compose area is visible", async () => {
    const input = await findM365Composer(page);
    expect(input).not.toBeNull();
    await expect(input!).toBeVisible();

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
  });

  test("03 — send a prompt and receive a response", async () => {
    await page.screenshot({ path: "test-results/cdp-03-before-send.png" });

    const { assistantText } = await postCopilotChatCompletion({
      userPrompt: "日本の首都はどこですか？一言で答えてください。",
      relayNewChat: false,
    });
    expect(assistantText.trim().length).toBeGreaterThan(0);
    console.log(`[CDP] assistant reply (truncated): ${assistantText.slice(0, 200)}`);

    const finalLength = await getBodyLength(page);
    console.log(`[CDP] After response, body length: ${finalLength}`);
    expect(finalLength).toBeGreaterThan(40);

    await page.screenshot({ path: "test-results/cdp-03-response.png" });
  });

  test("04 — multi-turn follow-up", async () => {
    const bodyBefore = await getBodyLength(page);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    const { assistantText } = await postCopilotChatCompletion({
      userPrompt: "その都市の名所を3つ教えて",
      relayNewChat: false,
    });
    expect(assistantText.trim().length).toBeGreaterThan(0);

    const bodyAfter = await getBodyLength(page);
    console.log(`[CDP] After follow-up, body length: ${bodyAfter} (was ${bodyBefore})`);
    // Copilot sometimes answers tersely; require growth, not a fixed char budget.
    expect(bodyAfter).toBeGreaterThan(bodyBefore + 40);

    await page.screenshot({ path: "test-results/cdp-04-followup.png" });
  });

  test("05 — full-page screenshot of conversation", async () => {
    await page.screenshot({
      path: "test-results/cdp-05-full-page.png",
      fullPage: true,
    });
    console.log("[CDP] Full-page screenshot captured!");
  });
});

/** Real Copilot: assert the model does not cite typo tokens that are absent from the fixture (see docs/AGENT_EVALUATION_CRITERIA.md). */
const RELAY_GROUNDING_E2E =
  process.env.RELAY_GROUNDING_E2E === "1" || process.env.RELAY_GROUNDING_E2E === "true";

const groundingDescribe = RELAY_GROUNDING_E2E ? test.describe : test.describe.skip;

/** Tokens models often invent as "bugs" though absent from `tetris_grounding.html` / `tetris.html` (see AGENT_EVALUATION_CRITERIA). */
const GROUNDING_HALLUCINATION_TOKENS = ["x_size", "y_size", "bag.length0"] as const;
const ATTACHMENT_MISSING_OR_CONFUSED_RE =
  /(添付.*(されていません|見つかりません)|ファイル.*(添付|共有).*(してください)|please attach|not attached|no attachment|複数あります|特定できません)/i;

function summarizeGroundingComparison(mode: "inline" | "attachment", assistantText: string) {
  return {
    mode,
    len: assistantText.length,
    badTokens: GROUNDING_HALLUCINATION_TOKENS.filter((token) => assistantText.includes(token)),
    missingOrConfusedAttachment: ATTACHMENT_MISSING_OR_CONFUSED_RE.test(assistantText),
    preview: assistantText.replace(/\s+/g, " ").slice(0, 260),
  };
}

groundingDescribe(
  "Grounding E2E (RELAY_GROUNDING_E2E=1) — real M365 Copilot via CDP",
  () => {
    // Long paste + HTTP completion (same path as app `POST /v1/chat/completions`) can exceed default 180s.
    test.setTimeout(360_000);

    let browser: any;
    let page: any;

    test.beforeAll(async () => {
      assertCopilotServerPrecondition(await copilotServerHealth());
      browser = await connectViaCDP();
      page = await findCopilotPage(browser);
    });

    test("06 — tetris_grounding: reply must not cite hallucinated tokens", async () => {
      const fixturePath = join(__dirname, "../../../tests/fixtures/tetris_grounding.html");
      const html = readFileSync(fixturePath, "utf8");
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(html.includes(token), `fixture must not contain ${token}`).toBe(false);
      }

      const prompt = [
        "以下は単一HTMLファイルの全文です（read_file相当）。",
        "このソースに実在する内容だけに基づき、改善点を2～4文で述べてください。",
        "ソースに存在しない識別子や誤記（例: よくあるタイポ）を問題として列挙しないでください。",
        "",
        "--- file ---",
        html.length > 18_000 ? `${html.slice(0, 18_000)}\n\n…(truncated)` : html,
        "--- end ---",
      ].join("\n");

      const { assistantText } = await postCopilotChatCompletion({
        userPrompt: prompt,
        relayNewChat: true,
        timeoutMs: 300_000,
      });
      expect(assistantText.trim().length).toBeGreaterThan(0);

      const bodyText = await page.evaluate(() => document.body.innerText ?? "");
      const tail = bodyText.slice(-25_000);
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(tail, `Copilot text must not contain "${token}" (not in fixture)`).not.toContain(token);
      }

      await page.screenshot({
        path: "test-results-cdp-06-grounding.png",
        fullPage: true,
      });
    });

    test("07 — tetris.html: improvement suggestions must not cite hallucinated tokens", async () => {
      const fixturePath = join(__dirname, "../../../tests/fixtures/tetris.html");
      const html = readFileSync(fixturePath, "utf8");
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(html.includes(token), `fixture must not contain ${token}`).toBe(false);
      }

      const prompt = [
        "以下は単一HTMLファイルの全文です（read_file相当）。",
        "このソースを改善するための具体的な提案を2～4文で述べてください。",
        "ソースに存在しない識別子や誤記を問題として列挙しないでください。",
        "",
        "--- file ---",
        html.length > 18_000 ? `${html.slice(0, 18_000)}\n\n…(truncated)` : html,
        "--- end ---",
      ].join("\n");

      const { assistantText } = await postCopilotChatCompletion({
        userPrompt: prompt,
        relayNewChat: true,
        timeoutMs: 300_000,
      });
      expect(assistantText.trim().length).toBeGreaterThan(0);
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(assistantText, `HTTP assistant text must not contain "${token}" (not in fixture)`).not.toContain(
          token,
        );
      }

      const bodyText = await page.evaluate(() => document.body.innerText ?? "");
      const tail = bodyText.slice(-25_000);
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(tail, `Copilot page text must not contain "${token}" (not in fixture)`).not.toContain(token);
      }

      await page.screenshot({
        path: "test-results-cdp-07-tetris-improve.png",
        fullPage: true,
      });
    });

    test("08 — tetris_grounding: compare inline delivery vs attachment delivery", async ({
    }, testInfo) => {
      const fixturePath = join(__dirname, "../../../tests/fixtures/tetris_grounding.html");
      const html = readFileSync(fixturePath, "utf8");
      for (const token of GROUNDING_HALLUCINATION_TOKENS) {
        expect(html.includes(token), `fixture must not contain ${token}`).toBe(false);
      }

      const inlinePrompt = [
        "以下は単一HTMLファイルの全文です（read_file相当）。",
        "このソースに実在する内容だけに基づき、改善点を2～4文で述べてください。",
        "ソースに存在しない識別子や誤記を問題として列挙しないでください。",
        "",
        "--- file ---",
        html,
        "--- end ---",
      ].join("\n");

      const attachmentBundle = [
        "以下は単一HTMLファイルの全文です（read_file相当）。",
        "このソースに実在する内容だけに基づき、改善点を2～4文で述べてください。",
        "ソースに存在しない識別子や誤記を問題として列挙しないでください。",
        "",
        "--- file ---",
        html,
        "--- end ---",
      ].join("\n");

      const tmpDir = mkdtempSync(join(tmpdir(), "relay-attachment-compare-"));
      const attachmentPath = join(tmpDir, "tetris_grounding_bundle.txt");
      writeFileSync(attachmentPath, attachmentBundle, "utf8");

      try {
        const { assistantText: inlineAssistantText } = await postCopilotChatCompletion({
          userPrompt: inlinePrompt,
          relayNewChat: true,
          timeoutMs: 300_000,
        });
        expect(inlineAssistantText.trim().length).toBeGreaterThan(0);
        for (const token of GROUNDING_HALLUCINATION_TOKENS) {
          expect(
            inlineAssistantText,
            `inline assistant text must not contain "${token}" (not in fixture)`,
          ).not.toContain(token);
        }

        const { assistantText: attachmentAssistantText } = await postCopilotChatCompletion({
          userPrompt:
            "添付テキストファイルに全文があります。添付を読んで、実在する内容だけに基づき改善点を2～4文で述べてください。",
          relayAttachments: [attachmentPath],
          relayNewChat: true,
          timeoutMs: 300_000,
        });
        expect(attachmentAssistantText.trim().length).toBeGreaterThan(0);
        for (const token of GROUNDING_HALLUCINATION_TOKENS) {
          expect(
            attachmentAssistantText,
            `attachment assistant text must not contain "${token}" (not in fixture)`,
          ).not.toContain(token);
        }

        const comparison = {
          inline: summarizeGroundingComparison("inline", inlineAssistantText),
          attachment: summarizeGroundingComparison("attachment", attachmentAssistantText),
        };
        console.log("[CDP] inline-vs-attachment grounding compare:", JSON.stringify(comparison));
        await testInfo.attach("grounding-inline-vs-attachment.json", {
          body: JSON.stringify(comparison, null, 2),
          contentType: "application/json",
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
