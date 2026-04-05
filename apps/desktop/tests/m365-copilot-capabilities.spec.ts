import { test, expect, chromium } from "@playwright/test";

const CDP_WS = "ws://localhost:9222/devtools/browser/daad166f-a136-4331-88c8-1b2812fdc65d";
const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";

/* ── Helpers ─────────────────────────────────────────────────── */

async function findCopilotPage(browser: any) {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    for (const page of pages) {
      try {
        const url = page.url();
        if (url.includes("m365.cloud.microsoft")) {
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

async function sendMessage(page: any, text: string) {
  const selectors = [
    'div[role="textbox"]',
    'textarea',
    '[contenteditable="true"]',
    '#m365-chat-editor-target-element',
  ];
  
  let input: any = null;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: "attached", timeout: 10_000 });
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) { input = el; break; }
    } catch {}
  }
  
  if (!input) {
    console.error("Could not find input element");
    return false;
  }
  
  await input.click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(1_500);
  
  try {
    const sendBtn = page.locator("button[type='submit']").first();
    if (await sendBtn.isEnabled({ timeout: 3_000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }
  } catch {
    await page.keyboard.press("Enter");
  }
  
  console.log(`[SENT] ${text.substring(0, 60)}...`);
  await page.waitForTimeout(5_000);
  return true;
}

async function waitForResponseComplete(page: any, timeoutMs: number = 90_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(3_000);
    const done = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasResponse = body.includes("回答") || body.includes("作成") || body.includes("作成しました");
      const hasCompletion = body.includes("再生成") || body.includes("コピー") || 
        Array.from(document.querySelectorAll("button")).some(b => 
          b.textContent?.includes("再生成") || b.textContent?.includes("Copy") || b.textContent?.includes("コピー")
        );
      const cursor = document.querySelector("[class*='cursor'], [class*='streaming']");
      return hasResponse && hasCompletion && !cursor;
    }).catch(() => false);
    if (done) return true;
  }
  return false;
}

async function captureResponseText(page: any): Promise<string> {
  return await page.evaluate(() => {
    const articles = document.querySelectorAll("article");
    if (articles.length > 0) {
      return articles[articles.length - 1].innerText.substring(0, 1000);
    }
    const body = document.body.innerText;
    const lines = body.split("\n").filter(l => l.trim().length > 15);
    return lines.slice(Math.max(0, lines.length - 15)).join("\n").substring(0, 1000);
  }).catch(() => "capture failed");
}

async function checkFileArtifact(page: any): Promise<string> {
  return await page.evaluate(() => {
    const fileCards = document.querySelectorAll("[class*='file'], [class*='document'], [class*='artifact']");
    const codeBlocks = document.querySelectorAll("pre, code, [class*='code']");
    const fileNames: string[] = [];
    fileCards.forEach(el => {
      const txt = el.innerText.trim();
      if (txt.length > 2) fileNames.push(txt.substring(0, 100));
    });
    return `Files: ${fileNames.length > 0 ? fileNames.join(", ") : "none"}\nCode blocks: ${codeBlocks.length}`;
  }).catch(() => "file check failed");
}

/* ── Test Suite ──────────────────────────────────────────────────── */

let browser: any;
let page: any;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_WS);
  page = await findCopilotPage(browser);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(3_000);
});

test.afterAll(async () => {
  await browser.close().catch(() => {});
});

test.describe("M365 Copilot File Operations & Coding", () => {
  test("T1 — Word Document Creation", async () => {
    await sendMessage(page, "「プロジェクト計画」のWord文書を作成して。概要、目的、スケジュール、成果物を含めて。");
    const t1 = await waitForResponseComplete(page, 120_000);
    const t1Content = await captureResponseText(page);
    const t1Files = await checkFileArtifact(page);
    console.log(`T1 Done: ${t1} | Artifacts: ${t1Files}`);
    await page.screenshot({ path: "test-results/m365-cap-t1.png" }).catch(() => {});
    expect(t1).toBe(true);
  });

  test("T2 — Code Generation (Python)", async () => {
    await sendMessage(page, "PythonでCSVファイルを読み込んでデータ集計するスクリプトを書いて。エラーハンドリングも含めて。");
    const t2 = await waitForResponseComplete(page, 120_000);
    const t2Content = await captureResponseText(page);
    const t2Files = await checkFileArtifact(page);
    console.log(`T2 Done: ${t2} | Code blocks: ${t2Content.includes("import ") || t2Content.includes("def ")}`);
    await page.screenshot({ path: "test-results/m365-cap-t2.png" }).catch(() => {});
    expect(t2).toBe(true);
  });

  test("T3 — Excel File Creation", async () => {
    await sendMessage(page, "Excelで月度売上表を作成して。列は日付、商品名、数量、単価、金額。サンプルデータ10行付きで。");
    const t3 = await waitForResponseComplete(page, 120_000);
    const t3Content = await captureResponseText(page);
    const t3Files = await checkFileArtifact(page);
    console.log(`T3 Done: ${t3} | Artifacts: ${t3Files}`);
    await page.screenshot({ path: "test-results/m365-cap-t3.png" }).catch(() => {});
    expect(t3).toBe(true);
  });

  test("T4 — File Reference (OneDrive)", async () => {
    await sendMessage(page, "OneDriveにある最近編集したファイルの一覧を表示して");
    const t4 = await waitForResponseComplete(page, 120_000);
    const t4Content = await captureResponseText(page);
    console.log(`T4 Done: ${t4} | Content: ${t4Content.substring(0, 200)}`);
    await page.screenshot({ path: "test-results/m365-cap-t4.png" }).catch(() => {});
    expect(t4).toBe(true);
  });

  test("T5 — PowerPoint Creation", async () => {
    await sendMessage(page, "新製品のマーケティングプレゼンテーションをPowerPointで作成して。5スライド、課題、解決策、スケジュール。");
    const t5 = await waitForResponseComplete(page, 120_000);
    const t5Content = await captureResponseText(page);
    const t5Files = await checkFileArtifact(page);
    console.log(`T5 Done: ${t5} | Artifacts: ${t5Files}`);
    await page.screenshot({ path: "test-results/m365-cap-t5.png" }).catch(() => {});
    expect(t5).toBe(true);
  });

  test("T6 — Code Edit (Modify Previous)", async () => {
    await sendMessage(page, "先ほど作ったPythonスクリプトにloggingを使ったログ出力機能を追加して");
    const t6 = await waitForResponseComplete(page, 120_000);
    const t6Content = await captureResponseText(page);
    const t6Files = await checkFileArtifact(page);
    console.log(`T6 Done: ${t6} | Has logging: ${t6Content.toLowerCase().includes("logging") || t6Content.includes("ログ")}`);
    await page.screenshot({ path: "test-results/m365-cap-t6.png" }).catch(() => {});
    expect(t6).toBe(true);
    expect(t6Content.toLowerCase()).toMatch(/logging|ログ/);
  });

  test("T7 — Conversation Context Persistence", async () => {
    const url = page.url();
    const hasConv = url.includes("conversation/");
    const convId = hasConv ? url.split("conversation/")[1]?.split("/")[0]?.split("?")[0] : "none";
    console.log(`T7 URL: ${url} | Has Conversation ID: ${hasConv} | ID: ${convId}`);
    expect(hasConv).toBe(true);
    
    await sendMessage(page, "これまで作成したWord文書、Pythonスクリプト、Excelファイルをまとめて説明して");
    const t7 = await waitForResponseComplete(page, 120_000);
    const t7Content = await captureResponseText(page);
    console.log(`T7 Done: ${t7} | Content: ${t7Content.substring(0, 300)}`);
    await page.screenshot({ path: "test-results/m365-cap-t7.png" }).catch(() => {});
    expect(t7).toBe(true);
  });
});
