#!/usr/bin/env node

import process from "node:process";

const port = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18411", 10);

async function readPrompt() {
  const argv = process.argv.slice(2);
  const normalizedArgs = argv[0] === "--" ? argv.slice(1) : argv;
  const argText = normalizedArgs.join(" ").trim();
  if (argText) return argText;
  if (process.stdin.isTTY) {
    throw new Error("Provide prompt text as arguments or stdin.");
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8").trim();
  if (!text) {
    throw new Error("Prompt text is empty.");
  }
  return text;
}

const text = await readPrompt();
const response = await fetch(`http://127.0.0.1:${port}/first-run-send`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({ text }),
});

const raw = await response.text();
if (!response.ok) {
  throw new Error(`dev control request failed (${response.status}): ${raw}`);
}

process.stdout.write(`${raw}\n`);
