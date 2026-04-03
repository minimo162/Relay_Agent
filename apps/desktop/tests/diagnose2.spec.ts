import { test, expect } from "@playwright/test";

test("diagnose: force-solid-render", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Check if solid-js/web's render function exists and what error it throws
  const result = await page.evaluate(async () => {
    const errors: string[] = [];
    try {
      // Try to run the same thing index.tsx does
      const root = document.getElementById("root");
      if (!root) return { error: "no #root" };
      
      // Test if document.getElementById works
      console.log("root found:", root.outerHTML.substring(0, 100));
      
      // Try to see what's in the JS module
      const body = document.body.innerHTML;
      
      return {
        bodyContent: body.substring(0, 500),
        childCount: root.childNodes.length,
        scripts: Array.from(document.querySelectorAll("script")).map(s => s.src || "inline"),
        hasRoot: true,
      };
    } catch (e: any) {
      return { error: e.message, stack: e.stack?.substring(0, 500) };
    }
  });
  
  console.log("Result:", JSON.stringify(result, null, 2));
  
  // Now try running Solid manually
  const solidResult = await page.evaluate(async () => {
    try {
      const { render } = await import("http://localhost:4173/assets/index-MKTqrupV.js");
      return { imported: true };
    } catch (e: any) {
      return { importError: e.message };
    }
  });
  
  console.log("Solid test:", JSON.stringify(solidResult, null, 2));
  
  expect(true).toBe(true);
});
