import { test, expect } from "@playwright/test";

test("debug: deep render check", async ({ page }) => {
  const consoleLogs: { type: string; text: string }[] = [];
  page.on("console", (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    consoleLogs.push({ type: "pageerror", text: err.message });
  });

  await page.goto("/");
  await page.waitForTimeout(3000);

  // Dump everything
  const html = await page.content();
  console.log("HTML length:", html.length);
  console.log("=== Console logs ===");
  for (const log of consoleLogs) {
    console.log(`  [${log.type}] ${log.text.substring(0, 200)}`);
  }

  // Check specific elements
  const hasRoot = !! await page.$("#root");
  const rootChildren = await page.evaluate(() => {
    const root = document.getElementById("root");
    return root ? root.children.length : 0;
  });
  console.log("Has #root:", hasRoot, "Children:", rootChildren);

  if (!hasRoot || rootChildren === 0) {
    // Try to find what's in the page
    const bodyChildren = await page.evaluate(() => {
      return Array.from(document.body.children).map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        text: el.textContent?.substring(0, 100)
      }));
    });
    console.log("Body children:", JSON.stringify(bodyChildren, null, 2));
  }

  expect(rootChildren).toBeGreaterThan(0);
});
