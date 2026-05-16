#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-office-pdf-read-token";
const port = 17896;
const dataDir = mkdtempSync(join(tmpdir(), "relay-office-pdf-read-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-office-pdf-read-workspace-"));
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

writeZip(join(workspace, "sample.docx"), {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX 部品売上 fixture</w:t></w:r></w:p></w:body></w:document>`,
});
writeZip(join(workspace, "sample.pptx"), {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>PPTX 部品売上 fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
});
writeZip(join(workspace, "sample.xlsx"), {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>XLSX 部品売上 fixture</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
});
writeFileSync(join(workspace, "sample.pdf"), `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 52 >>
stream
BT /F1 12 Tf 72 720 Td (PDF parts sales fixture) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
trailer
<< /Root 1 0 R >>
%%EOF
`, "latin1");

const filteredPdfText = "BT /F1 12 Tf 72 720 Td (Filtered PDF parts sales fixture) Tj ET";
const filteredPdfStream = deflateSync(Buffer.from(filteredPdfText, "latin1"));
writeFileSync(join(workspace, "filtered.pdf"), Buffer.concat([
  Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${filteredPdfStream.length} /Filter /FlateDecode >>
stream
`, "latin1"),
  filteredPdfStream,
  Buffer.from(`
endstream
endobj
xref
0 5
0000000000 65535 f
trailer
<< /Root 1 0 R >>
%%EOF
`, "latin1"),
]));

const cases = [
  ["sample.docx", "docx"],
  ["sample.xlsx", "xlsx"],
  ["sample.pptx", "pptx"],
  ["sample.pdf", "pdf"],
  ["filtered.pdf", "pdf"],
];
const responses = cases.flatMap(([path]) => [
  JSON.stringify({ action: "tool", tool: "read", args: { path } }),
  JSON.stringify({ action: "final", answer: `${path} read` }),
]);

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(responses),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForStatus();
  for (const [path, kind] of cases) {
    const run = await postAgUi({
      port,
      token,
      workspace,
      runId: `office-pdf-read-${path.replace(/[^a-z0-9]/gi, "-")}`,
      instruction: `read ${path}`,
    });
    if (!hasRunFinished(run.events)) {
      throw new Error(`${path} run did not complete: ${JSON.stringify(run.events)}`);
    }
    const readCall = collectToolCall(run.events, "read");
    const detail = readCall.results.join("\n");
    if (!detail.includes(`${kind} extracted`)) {
      throw new Error(`${path} did not use extracted ${kind} read path: ${JSON.stringify(run.events)}`);
    }
    if (!new RegExp(`${kind} extracted, [1-9][0-9]* chars read`).test(detail)) {
      throw new Error(`${path} extracted no text: ${detail}`);
    }
    if (detail.includes("warnings=")) {
      throw new Error(`${path} emitted extraction warnings: ${detail}`);
    }
    if (detail.includes("Binary file")) {
      throw new Error(`${path} fell back to binary read: ${detail}`);
    }
  }

  console.log("[office-pdf-read-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeZip(path, files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(path, Buffer.concat([...chunks, centralBytes, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
