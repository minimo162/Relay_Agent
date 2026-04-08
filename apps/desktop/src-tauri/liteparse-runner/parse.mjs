#!/usr/bin/env node
/**
 * CLI: node parse.mjs <absolute-pdf-path> [targetPages]
 * targetPages: LiteParse format, e.g. "1-3,5" (omit for all pages).
 * Writes UTF-8 text to stdout; errors to stderr, exit non-zero on failure.
 */
import { LiteParse } from "@llamaindex/liteparse";
import { existsSync } from "node:fs";
import path from "node:path";

const pdfPath = process.argv[2];
const targetPages = process.argv[3] ?? "";

if (!pdfPath) {
  console.error("usage: parse.mjs <absolute-pdf-path> [targetPages]");
  process.exit(1);
}

if (!existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`);
  process.exit(1);
}

const abs = path.resolve(pdfPath);

const maxPages = (() => {
  const raw = process.env.RELAY_LITEPARSE_MAX_PAGES;
  if (!raw) return 10_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 10_000;
})();

const config = {
  ocrEnabled: false,
  outputFormat: "text",
  maxPages,
  dpi: 150,
  preciseBoundingBox: true,
};

if (targetPages.trim().length > 0) {
  config.targetPages = targetPages.trim();
}

const parser = new LiteParse(config);

try {
  const result = await parser.parse(abs);
  const text = result.text ?? "";
  process.stdout.write(text);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
}
