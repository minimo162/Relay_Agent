#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-smoke-token";
const port = 17891;
const dataDir = mkdtempSync(join(tmpdir(), "relay-sidecar-smoke-"));
const env = {
  ...process.env,
  RELAY_PORT: String(port),
  RELAY_LAUNCH_TOKEN: token,
  RELAY_DATA_DIR: dataDir,
  RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
  RELAY_ALLOW_MOCK_COPILOT: "1",
  RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "mock Copilot response from sidecar transport" }),
};

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForStatus() {
  const url = `http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return response.json();
    } catch {
      // Wait for Kestrel to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

try {
  const status = await waitForStatus();
  if (status.app !== "Relay Agent") throw new Error(`unexpected status app: ${status.app}`);
  if (status.ready !== true) throw new Error(`required readiness was not green: ${JSON.stringify(status)}`);
  if (!status.checks.some((check) => check.name === "copilot-cdp" && check.ready === true)) {
    throw new Error(`mock Copilot readiness was not reported: ${JSON.stringify(status)}`);
  }
  const officeCli = status.checks.find((check) => check.name === "officecli");
  if (!officeCli || officeCli.required !== false) {
    throw new Error(`OfficeCLI readiness must be optional: ${JSON.stringify(status)}`);
  }

  const models = await fetch(`http://127.0.0.1:${port}/v1/models?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!models.ok) throw new Error(`models endpoint failed: ${models.status}`);

  const health = await fetch(`http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!health.ok) throw new Error(`health endpoint failed: ${health.status}`);
  const healthJson = await health.json();
  if (healthJson.schemaVersion !== "RelayCoreHealth.v1") {
    throw new Error(`unexpected health contract: ${JSON.stringify(healthJson)}`);
  }

  const session = await fetch(`http://127.0.0.1:${port}/v1/copilot/session?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!session.ok) throw new Error(`copilot session endpoint failed: ${session.status}`);

  const tools = await fetch(`http://127.0.0.1:${port}/v1/tools?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!tools.ok) throw new Error(`tools endpoint failed: ${tools.status}`);

  const completion = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      model: "m365-copilot",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!completion.ok) throw new Error(`completion endpoint failed: ${completion.status}`);
  const completionJson = await completion.json();
  const expected = JSON.stringify({ action: "final", answer: "mock Copilot response from sidecar transport" });
  if (completionJson.choices?.[0]?.message?.content !== expected) {
    throw new Error(`unexpected completion response: ${JSON.stringify(completionJson)}`);
  }

  const agui = await postAgUi({
    port,
    token,
    workspace: process.cwd(),
    runId: "sidecar-smoke-run",
    instruction: "ping",
  });
  if (!hasRunFinished(agui.events)) {
    throw new Error(`official AG-UI stream did not emit run lifecycle events: ${agui.text}`);
  }
  if (assistantText(agui.events) !== "mock Copilot response from sidecar transport") {
    throw new Error(`official AG-UI final text mismatch: ${agui.text}`);
  }

  const pdfA = join(dataDir, "sample-a.pdf");
  const pdfB = join(dataDir, "sample-b.pdf");
  writeFileSync(pdfA, makeTextPdf("1. Overview\nThis is is a sample.\n2. Terms\nDate 2026-05-19. Amount 1,000."));
  writeFileSync(pdfB, makeTextPdf("1. Overview\nThis is a sample.\n2. Terms\nDate 2026-05-20. Amount 1,500."));

  const capabilities = await fetch(`http://127.0.0.1:${port}/v1/pdf/capabilities?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!capabilities.ok) throw new Error(`pdf capabilities endpoint failed: ${capabilities.status}`);

  const pdfReview = await fetch(`http://127.0.0.1:${port}/v1/pdf/review-paths?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ reviewType: "auto", paths: [pdfA, pdfB] }),
  });
  if (!pdfReview.ok) throw new Error(`pdf review endpoint failed: ${pdfReview.status} ${await pdfReview.text()}`);
  const pdfReviewJson = await pdfReview.json();
  if (pdfReviewJson.schemaVersion !== "RelayPdfReviewJob.v1") {
    throw new Error(`unexpected pdf review schema: ${JSON.stringify(pdfReviewJson)}`);
  }
  if (!pdfReviewJson.findings?.length) {
    throw new Error(`pdf review did not return page-cited findings: ${JSON.stringify(pdfReviewJson)}`);
  }
  if (!pdfReviewJson.sectionAlignments?.length) {
    throw new Error(`pdf review did not return a section correspondence table: ${JSON.stringify(pdfReviewJson)}`);
  }
  if (!pdfReviewJson.findings.every((finding) => finding.documentId && finding.page && finding.evidence !== undefined)) {
    throw new Error(`pdf findings are missing anchors: ${JSON.stringify(pdfReviewJson.findings)}`);
  }
  const report = await fetch(`http://127.0.0.1:${port}/v1/pdf/jobs/${pdfReviewJson.jobId}/report.md?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!report.ok) throw new Error(`pdf report endpoint failed: ${report.status}`);
  const reportText = await report.text();
  if (!reportText.includes("Relay PDF Review Report")) {
    throw new Error(`unexpected pdf report body: ${reportText}`);
  }

  console.log("[sidecar-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

function makeTextPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${escaped.length + 54} >>
stream
BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000059 00000 n 
0000000118 00000 n 
0000000247 00000 n 
0000000352 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
422
%%EOF
`;
}
