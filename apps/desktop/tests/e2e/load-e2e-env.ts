import fs from "node:fs";
import path from "node:path";

/**
 * Loads `apps/desktop/.env.e2e` into `process.env` (does not override existing vars).
 * Safe to call from playwright.config.ts and globalSetup (separate processes).
 */
export function loadE2eEnv(): void {
  const file = path.join(process.cwd(), ".env.e2e");
  if (!fs.existsSync(file)) {
    return;
  }
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
