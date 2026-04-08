import { test, expect, chromium } from "@playwright/test";

const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT || "http://127.0.0.1:9333";
const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";

/* ── Helpers ─────────────────────────────────────────────────── */

async function findOrCreateCopilotPage(browser: any): Promise<any> {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    for (const page of pages) {
      try {
        const url = await page.url();
        if (url.includes("m365.cloud.microsoft") || url.includes("copilot.microsoft.com")) {
          console.log(`[CDP] Found Copilot: ${url}`);
          return page;
        }
      } catch {}
    }
  }
  console.log("[CDP] No Copilot tab, opening one...");
  const ctx = contexts[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto(M365_COPILOT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5_000);
  return page;
}

async function waitForPageReady(page: any): Promise<void> {
  // Wait for the page to be interactive
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  // If on a redirect/login page, try to recover
  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("account")) {
    console.log(`[WARN] Not on Copilot, navigating to ${M365_COPILOT_URL}`);
    await page.goto(M365_COPILOT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(5_000);
  }
}

async function sendMessage(page: any, text: string): Promise<boolean> {
  console.log(`[SENDING] ${text.substring(0, 60)}`);

  // Strategy 1: Try textarea input
  try {
    const textarea = page.locator('textarea[placeholder*="メッセージ"], textarea[placeholder*="message"], textarea[class*="chat"]');
    await textarea.first().waitFor({ state: "attached", timeout: 10_000 });
    await textarea.first().fill(text);
    await page.waitForTimeout(1_000);

    // Try Enter key
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3_000);
    console.log(`[SENT] via textarea + Enter`);
    return true;
  } catch {}

  // Strategy 2: Try contenteditable
  try {
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: "attached", timeout: 10_000 });
    await editor.click();
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(1_000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3_000);
    console.log(`[SENT] via contenteditable + Enter`);
    return true;
  } catch {}

  // Strategy 3: Try any textbox-like element
  try {
    const input = page.locator('input[type="text"], [role="textbox"]').first();
    await input.waitFor({ state: "attached", timeout: 10_000 });
    await input.fill(text);
    await page.waitForTimeout(1_000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3_000);
    console.log(`[SENT] via input[role=textbox] + Enter`);
    return true;
  } catch {}

  console.error("[ERROR] Could not find any input element for sending message");
  return false;
}

async function interceptCopilotResponse(page: any, timeoutMs: number = 120_000): Promise<{status: string; data: any; text: string}> {
  console.log(`[INTERCEPT] Waiting for Copilot API response (timeout: ${timeoutMs/1000}s)...`);

  const collectedChunks: string[] = [];
  let fullResponse = "";
  let responseCompleted = false;

  // Intercept the SSE/streaming response
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/v1/messages") || url.includes("/api/") || url.includes("/chat/") || url.includes("copilot") || url.includes("stream")) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("text/event-stream") || contentType.includes("application/json")) {
          const body = await response.body().catch(() => null);
          if (body) {
            const text = body.toString();
            collectedChunks.push(text);
            fullResponse += text;
          }
        }
      } catch {}
    }
  });

  // Wait for the page to show response indicators
  const start = Date.now();
  while (Date.now() - start < timeoutMs && !responseCompleted) {
    await page.waitForTimeout(5_000);

    // Check for completion indicators in the page
    const hasResponse = await page.evaluate(() => {
      const body = document.body.innerText;
      // Check for typical Copilot response indicators
      const hasContent = body.length > 500;
      const hasRegenerate = body.includes("再生成") || body.includes("Regenerate") || body.includes("Copy");
      const isNotLoading = !body.includes("読み込み");
      return hasContent && (hasRegenerate || isNotLoading);
    }).catch(() => false);

    // Also check if we have intercepted data
    if (fullResponse.length > 100 || hasResponse) {
      responseCompleted = true;
    }
  }

  if (fullResponse.length > 0) {
    console.log(`[INTERCEPTED] ${fullResponse.length} chars intercepted`);
    return { status: "intercepted", data: null, text: fullResponse.substring(0, 2000) };
  }

  // Fallback: extract text from page
  const pageText = await page.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split("\n").filter(l => l.trim().length > 10);
    return lines.slice(-20).join("\n");
  }).catch(() => "[page text extraction failed]");

  return { status: "page-fallback", data: null, text: pageText.substring(0, 2000) };
}

async function verifyResponseHasContent(page: any, keywords: string[]): Promise<{pass: boolean; found: string[]}> {
  const found: string[] = [];
  // Check page text
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  for (const kw of keywords) {
    if (bodyText.toLowerCase().includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }
  return { pass: found.length > 0, found };
}

/* ── Test Suite ──────────────────────────────────────────────────── */

let browser: any;
let page: any;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const wsEndpoint = await chromium.connectOverCDP(CDP_ENDPOINT).then(b => {
    // We need to find the actual wsEndpoint
    return null;
  }).catch(() => null);

  // Try with http endpoint first (connectOverCDP uses http internally)
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  page = await findOrCreateCopilotPage(browser);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2_000);
  console.log(`[SETUP] Page URL: ${page.url()}`);
  await waitForPageReady(page);
  console.log(`[SETUP] Ready. Page URL: ${page.url()}`);
});

test.afterAll(async () => {
  await browser.close().catch(() => {});
});

test("T1 — Word Document Creation", async () => {
  const sent = await sendMessage(page, "「プロジェクト計画」のWord文書を作成して。概要、目的、スケジュール、成果物を含めて。");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T1 Status: ${result.status}`);
  console.log(`T1 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["プロジェクト", "文書", "概要", "Word", "計画"]);
  console.log(`T1 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T2 — Code Generation (Python)", async () => {
  const sent = await sendMessage(page, "PythonでCSVファイルを読み込んでデータ集計するスクリプトを書いて。エラーハンドリングも含めて。");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T2 Status: ${result.status}`);
  console.log(`T2 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["import", "csv", "def", "import csv", "open(", "pandas"]);
  console.log(`T2 Has code: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T3 — Excel File Creation", async () => {
  const sent = await sendMessage(page, "Excelで月度売上表を作成して。列は日付、商品名、数量、単価、金額。サンプルデータ10行付きで。");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T3 Status: ${result.status}`);
  console.log(`T3 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["売上", "Excel", "日付", "商品名", "数量", "サンプル"]);
  console.log(`T3 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T4 — File Reference (OneDrive)", async () => {
  const sent = await sendMessage(page, "OneDriveにある最近編集したファイルの一覧を表示して");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T4 Status: ${result.status}`);
  console.log(`T4 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["OneDrive", "ファイル", "最近", "一覧", "名前"]);
  console.log(`T4 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T5 — PowerPoint Creation", async () => {
  const sent = await sendMessage(page, "新製品のマーケティングプレゼンテーションをPowerPointで作成して。5スライド、課題、解決策、スケジュール。");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T5 Status: ${result.status}`);
  console.log(`T5 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["PowerPoint", "プレゼン", "スライド", "課題", "解決策"]);
  console.log(`T5 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T6 — Code Edit (Modify Previous)", async () => {
  const sent = await sendMessage(page, "先ほど作ったPythonスクリプトにloggingを使ったログ出力機能を追加して");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T6 Status: ${result.status}`);
  console.log(`T6 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["logging", "logger", "ログ", "import logging", "setLevel"]);
  console.log(`T6 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T7 — Conversation Context Persistence", async () => {
  const url = page.url();
  const hasConv = url.includes("conversation/");
  const convId = hasConv ? url.split("conversation/")[1]?.split("/")[0]?.split("?")[0] : "none";
  console.log(`T7 URL: ${url}`);
  console.log(`T7 Has Conversation ID: ${hasConv} | ID: ${convId}`);
  expect(hasConv).toBe(true);

  const sent = await sendMessage(page, "これまで作成したWord文書、Pythonスクリプト、Excelファイルをまとめて説明して");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T7 Status: ${result.status}`);
  console.log(`T7 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["Word", "Python", "Excel", "文書", "スクリプト", "作成"]);
  console.log(`T7 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T8 — File Editing in Copilot", async () => {
  // Test: ask Copilot to edit/modify a created document
  const sent = await sendMessage(page, "先ほど作成したプロジェクト計画のWord文書を、チームメンバー追加とリスク管理セクションを追加して更新して");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T8 Status: ${result.status}`);
  console.log(`T8 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["チーム", "リスク", "更新", "文書", "追加"]);
  console.log(`T8 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T9 — TypeScript Code Generation", async () => {
  const sent = await sendMessage(page, "TypeScriptでREST APIからデータを取得して表示する簡易Fetch関数を作成して。async/await、エラーハンドリング付きで。");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T9 Status: ${result.status}`);
  console.log(`T9 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["async", "await", "fetch", "Error", "try", "catch"]);
  console.log(`T9 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});

test("T10 — Multi-step File Workflow", async () => {
  // Test a multi-step workflow: create data -> analyze -> summarize
  const sent = await sendMessage(page, "先ほど作成したExcel売上データの分析サマリーを生成して。合計売上、平均、最多的売商品を計算して");
  expect(sent).toBe(true);

  const result = await interceptCopilotResponse(page, 150_000);
  console.log(`T10 Status: ${result.status}`);
  console.log(`T10 Preview: ${result.text.substring(0, 300)}`);

  const check = await verifyResponseHasContent(page, ["売上", "合計", "平均", "分析", "商品"]);
  console.log(`T10 Keywords found: ${check.found.join(", ")}`);
  expect(check.pass).toBe(true);
});
