#!/usr/bin/env node

const port = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18411", 10);

const response = await fetch(`http://127.0.0.1:${port}/approve-latest-workspace`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: "{}",
});

const raw = await response.text();
if (!response.ok) {
  throw new Error(`dev control request failed (${response.status}): ${raw}`);
}

process.stdout.write(`${raw}\n`);
