import { test, expect } from "@playwright/test";

test("diagnose: why isn't the app rendering?", async ({ page }) => {
  // Listen for console messages
  const consoleMsgs: string[] = [];
  const errors: string[] = [];
  page.on("console", (msg) => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });

  // Go to the page from the webServer
  await page.goto("/");

  // Wait for network to settle
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // Check if the JS module loaded
  const scripts = await page.locator('script[type="module"]').count();
  console.log(`Module scripts found: ${scripts}`);

  // Check if solid-js/web is loaded
  const hasSolid = await page.evaluate(() => {
    try {
      // Check if #root has children
      const root = document.getElementById("root");
      return {
        rootExists: root !== null,
        childCount: root?.childNodes.length,
        innerHTML: root?.innerHTML?.substring(0, 200),
        outerHTML: root?.outerHTML?.substring(0, 200),
        bodyInner: document.body.innerHTML.substring(0, 500),
      };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log("Root state:", JSON.stringify(hasSolid, null, 2));

  // Check JS errors
  console.log("Console messages:", consoleMsgs.join("\n"));
  if (errors.length > 0) {
    console.log("Page errors:", errors.join("\n"));
  }

  // Try to force a re-render evaluation
  const evalResult = await page.evaluate(() => {
    // Check if solid's render function is available (should be bundled)
    const allScripts = document.querySelectorAll("script");
    const scriptSrcs: string[] = [];
    allScripts.forEach(s => scriptSrcs.push(s.src || "inline"));
    
    // Also check performance entries for the JS file
    const entries = performance.getEntriesByType("resource")
      .filter(e => e.name.includes(".js"));
    
    return {
      scriptCount: allScripts.length,
      scriptSources: scriptSrcs,
      jsResources: entries.map(e => ({ name: e.name, status: (e as any).responseStatus })),
    };
  });
  console.log("Scripts & resources:", JSON.stringify(evalResult, null, 2));

  // Fail to show results
  expect(errors.length).toBe(0);
});
