import { test, expect } from "@playwright/test";

test("debug: capture JS errors in browser", async ({ page }) => {
  const jsErrors: string[] = [];
  page.on("pageerror", (err) => {
    jsErrors.push(err.message);
    console.log("PAGE ERROR:", err.message);
    console.log("STACK:", err.stack?.substring(0, 500));
  });

  // The webServer starts the preview. We just need to go to the page.
  await page.goto("/");

  // Wait for possible errors
  await page.waitForTimeout(3000);

  // Get what's actually rendered
  const rootContent = await page.locator("#root").innerHTML();
  console.log("ROOT innerHTML:", rootContent.substring(0, 500));

  // If there are errors, fail and show them
  if (jsErrors.length > 0) {
    console.log("=== JS ERRORS ===");
    for (const e of jsErrors) console.log(e);
  }

  // For now just report — we'll fix the errors
  expect(jsErrors).toEqual([]);
});
