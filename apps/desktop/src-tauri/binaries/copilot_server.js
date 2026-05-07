#!/usr/bin/env node
// Dual-mode wrapper for the bundled Copilot gateway.
// Tauri resources do not include apps/desktop/package.json, so Windows runs
// this .js file as CommonJS. Keep this file free of static ESM syntax.

(async () => {
  const { dirname, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const entry = process.argv[1] || "";
  if (!/[\\/]copilot_server\.js$/u.test(entry)) return;

  const moduleUrl = pathToFileURL(resolve(dirname(entry), "copilot_server.mjs")).href;
  const { main } = await import(moduleUrl);
  await main();
})().catch((error) => {
  console.error("[copilot] fatal:", error);
  process.exit(1);
});
