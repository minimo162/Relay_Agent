import path from "node:path";

/** Saved Playwright storage state (cookies + origins). Gitignored. */
export function microsoftAuthStatePath(): string {
  return path.join(process.cwd(), "tests", ".auth", "microsoft-copilot.json");
}
