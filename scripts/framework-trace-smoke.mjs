#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturePath = join(process.cwd(), "scripts/fixtures/framework-trace-sample.json");
const trace = JSON.parse(readFileSync(fixturePath, "utf8"));
const categories = new Set(["provider", "projection", "admission", "approval", "tool", "terminal", "ui", "packaging"]);
const statuses = new Set(["ok", "error", "blocked", "provider_blocked"]);
const forbiddenAttributeKeys = new Set(["prompt", "rawPrompt", "response", "rawResponse", "fileContent", "stdout", "stderr"]);

if (trace.schemaVersion !== "RelayFrameworkTrace.v1") {
  throw new Error(`unexpected trace schemaVersion: ${trace.schemaVersion}`);
}
if (!Array.isArray(trace.spans) || trace.spans.length === 0) {
  throw new Error("trace fixture must contain spans");
}

const spanIds = new Set();
for (const span of trace.spans) {
  for (const field of ["schemaVersion", "traceId", "spanId", "name", "category", "agUiRunId", "agentSessionId", "status", "retryable", "startedAt", "attributes"]) {
    if (!(field in span)) throw new Error(`span missing ${field}: ${JSON.stringify(span)}`);
  }
  if (span.schemaVersion !== "RelayFrameworkTraceSpan.v1") throw new Error(`bad span schema: ${span.schemaVersion}`);
  if (span.traceId !== trace.traceId) throw new Error(`span trace mismatch: ${span.spanId}`);
  if (spanIds.has(span.spanId)) throw new Error(`duplicate spanId: ${span.spanId}`);
  spanIds.add(span.spanId);
  if (!categories.has(span.category)) throw new Error(`unknown category: ${span.category}`);
  if (!statuses.has(span.status)) throw new Error(`unknown status: ${span.status}`);
  if (typeof span.retryable !== "boolean") throw new Error(`retryable must be boolean: ${span.spanId}`);
  if (Number.isNaN(Date.parse(span.startedAt))) throw new Error(`invalid startedAt: ${span.startedAt}`);
  if (span.endedAt && Number.isNaN(Date.parse(span.endedAt))) throw new Error(`invalid endedAt: ${span.endedAt}`);
  if (!span.attributes || typeof span.attributes !== "object" || Array.isArray(span.attributes)) {
    throw new Error(`attributes must be an object: ${span.spanId}`);
  }
  for (const key of Object.keys(span.attributes)) {
    if (forbiddenAttributeKeys.has(key)) {
      throw new Error(`unredacted sensitive attribute key ${key} in ${span.spanId}`);
    }
  }
}

for (const span of trace.spans) {
  if (span.parentSpanId && !spanIds.has(span.parentSpanId)) {
    throw new Error(`missing parent span ${span.parentSpanId} for ${span.spanId}`);
  }
}

console.log("[framework-trace-smoke] ok");
