#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const token = "relay-security-token";
const port = 17893;
const dataDir = mkdtempSync(join(tmpdir(), "relay-sidecar-security-"));

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "ok" }),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function request(path, headers = {}, method = "GET", body = undefined) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestStatus(path, headers = {}, method = "GET", body = undefined) {
  const response = await request(path, headers, method, body);
  return response.statusCode;
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const status = await requestStatus(`/api/status?token=${encodeURIComponent(token)}`, { "X-Relay-Token": token });
      if (status === 200) return;
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

try {
  const sensitiveWorkspace = mkdtempSync(join(tmpdir(), "relay-private-workspace-"));
  const sensitiveFile = join(sensitiveWorkspace, "finance", "部品売上-secret.txt");
  mkdirSync(join(sensitiveWorkspace, "finance"), { recursive: true });
  writeFileSync(sensitiveFile, "PROJECT_SECRET_REVENUE=987654321\nowner=finance.owner@example.com\n", "utf8");
  mkdirSync(join(dataDir, "runs"), { recursive: true });
  mkdirSync(join(dataDir, "run-events"), { recursive: true });
  writeFileSync(join(dataDir, "runs", "run-sensitive.json"), JSON.stringify({
    runId: "run-sensitive",
    status: "failed",
    request: {
      instruction: "PROJECT_SECRET_REVENUE を含む部品売上ファイルを読んで",
      workspace: sensitiveWorkspace,
    },
    events: [
      {
        type: "tool_call_completed",
        message: `read ${sensitiveFile} for finance.owner@example.com`,
        detail: `Read ${sensitiveFile}\nPROJECT_SECRET_REVENUE=987654321\nowner=finance.owner@example.com`,
        data: {
          filePath: sensitiveFile,
          content: readFileSync(sensitiveFile, "utf8"),
          nested: {
            accessToken: "token=abc123",
            backupPath: join(sensitiveWorkspace, "backup.xlsx"),
          },
        },
      },
    ],
  }, null, 2), "utf8");
  writeFileSync(join(dataDir, "run-events", "run-sensitive.json"), JSON.stringify({
    type: "error",
    message: "Copilot transport failed",
    detail: `stderr: password=hunter2 path=${sensitiveFile}`,
  }, null, 2), "utf8");

  await waitForStatus();

  const noToken = await requestStatus("/api/status");
  if (noToken !== 401) throw new Error(`expected 401 without token, got ${noToken}`);

  const badHost = await requestStatus(`/api/status?token=${encodeURIComponent(token)}`, {
    "X-Relay-Token": token,
    Host: "relay.invalid",
  });
  if (badHost !== 403) throw new Error(`expected 403 for bad host, got ${badHost}`);

  const badOrigin = await requestStatus(`/agui/relay?token=${encodeURIComponent(token)}`, {
    "X-Relay-Token": token,
    "Content-Type": "application/json",
    Origin: "http://evil.invalid",
  }, "POST", JSON.stringify({
    threadId: "security-bad-origin-thread",
    runId: "security-bad-origin-run",
    state: {},
    messages: [{ id: "security-bad-origin-message", role: "user", content: "ping" }],
    tools: [],
    context: [{ description: "workspace", value: sensitiveWorkspace }],
    forwardedProps: { workspace: sensitiveWorkspace },
  }));
  if (badOrigin !== 403) throw new Error(`expected 403 for bad origin, got ${badOrigin}`);

  const noTokenSupportBundle = await requestStatus("/api/support-bundle", {
    "Content-Type": "application/json",
    Origin: `http://127.0.0.1:${port}`,
  }, "POST");
  if (noTokenSupportBundle !== 401) throw new Error(`expected 401 for support bundle without token, got ${noTokenSupportBundle}`);

  const supportBundle = await request(`/api/support-bundle?token=${encodeURIComponent(token)}`, {
    "X-Relay-Token": token,
    Origin: `http://127.0.0.1:${port}`,
  }, "POST");
  if (supportBundle.statusCode !== 200) throw new Error(`expected 200 for explicit support bundle export, got ${supportBundle.statusCode}`);
  const entries = readZipTextEntries(supportBundle.body);
  if (!entries.has("audit/tool-call-summary.json")) {
    throw new Error("support bundle is missing audit/tool-call-summary.json");
  }
  const auditSummary = JSON.parse(entries.get("audit/tool-call-summary.json"));
  if (auditSummary.schemaVersion !== "RelayToolCallAuditSummary.v1") {
    throw new Error(`unexpected audit summary schema: ${auditSummary.schemaVersion}`);
  }
  if (auditSummary.scannedFiles < 2 || auditSummary.toolLikeRecords < 1) {
    throw new Error(`audit summary did not inspect the synthetic run logs: ${JSON.stringify(auditSummary)}`);
  }
  const bundleText = [...entries.values()].join("\n");
  for (const forbidden of [
    "PROJECT_SECRET_REVENUE",
    "987654321",
    "finance.owner@example.com",
    "hunter2",
    sensitiveWorkspace,
    sensitiveFile,
  ]) {
    if (bundleText.includes(forbidden)) {
      throw new Error(`default support bundle leaked sensitive fixture value: ${forbidden}`);
    }
  }
  for (const expected of ["[REDACTED]", "[REDACTED_PATH]", "[REDACTED_EMAIL]"]) {
    if (!bundleText.includes(expected)) {
      throw new Error(`default support bundle did not include expected redaction marker: ${expected}`);
    }
  }

  const directoryListing = await requestStatus(`/assets/?token=${encodeURIComponent(token)}`, { "X-Relay-Token": token });
  if (directoryListing === 200) throw new Error("static asset directory listing is reachable");

  console.log("[sidecar-security-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

function readZipTextEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    if ((flags & 0x08) !== 0) throw new Error("zip entries with data descriptors are not supported by this smoke parser");
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataEnd);
    let content;
    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      content = inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    }
    entries.set(name, content.toString("utf8"));
    offset = dataEnd;
  }
  return entries;
}
