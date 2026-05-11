import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const parsedDocumentIrPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
);

function transpile(path) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText),
    [],
  );
  return compiled.outputText;
}

async function loadParsedDocumentIrModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-parsed-document-ir-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(
    resolve(dir, "relayParsedDocumentIr.mjs"),
    transpile(parsedDocumentIrPath).replace(
      "from './relayDocumentSearchMetadataCache';",
      "from './relayDocumentSearchMetadataCache.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayParsedDocumentIr.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function fileMetadata(extension = "md", overrides = {}) {
  return {
    fileId: "file-text",
    root: "/workspace",
    path: `/workspace/memo.${extension}`,
    displayPath: `memo.${extension}`,
    name: `memo.${extension}`,
    extension,
    size: 48,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: "file-text:48:1",
    ...overrides,
  };
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test("Relay ParsedDocument IR preserves Dedoc-compatible text structure", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parseTextToRelayParsedDocument(
      fileMetadata(),
      ["# 見出し", "キャッシュフロー計算書の確認事項", "- 精算表"].join("\n"),
    );

    assert.equal(parsed.schemaVersion, "RelayParsedDocumentIR.v1");
    assert.equal(parsed.version, "relay-ir-v1");
    assert.equal(parsed.parser.name, "relay-text");
    assert.equal(parsed.parser.profile, "technical_document");
    assert.equal(parsed.source_file_id, "file-text");
    assert.equal(parsed.source_metadata_version, "file-text:48:1");
    assert.equal(parsed.content.structure.node_id, "root");
    assert.equal(parsed.content.structure.subparagraphs[0].metadata.paragraph_type, "heading");
    assert.equal(parsed.content.structure.subparagraphs[2].metadata.paragraph_type, "list_item");
    assert.deepEqual(parsed.content.tables, []);
    assert.deepEqual(parsed.attachments, []);
    assert.equal(parsed.metadata.extra_data.capabilities.schemaVersion, "RelayReaderCapabilityRegistry.v1");
    assert.equal(parsed.metadata.extra_data.capabilities.annotations, true);
    assert.equal(parsed.metadata.extra_data.structure_profile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(parsed.metadata.extra_data.structure_profile.profile, "technical_document");
    assert.equal(parsed.metadata.extra_data.structure_profile.status, "valid");
    assert.equal(parsed.metadata.extra_data.structure_profile.treeNodeCount, 4);
    assert.equal(module.validateRelayParsedDocument(parsed).ok, true);
  } finally {
    cleanup();
  }
});

test("Relay ParsedDocument IR exposes CSV cells as table metadata", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parseTextToRelayParsedDocument(fileMetadata("csv"), "項目,金額\nCFS,100");
    assert.equal(parsed.content.tables.length, 1);
    assert.equal(parsed.content.tables[0].rows[1][0].text, "CFS");
    assert.equal(parsed.content.tables[0].rows[1][1].metadata.line_number, 2);
    assert.equal(parsed.metadata.extra_data.capabilities.tables, true);
    assert.equal(parsed.metadata.extra_data.capabilities.cellAnchors, true);
  } finally {
    cleanup();
  }
});

test("Relay ParsedDocument IR extracts DOCX paragraphs into Office OpenXML structure", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parseOfficeOpenXmlBufferToRelayParsedDocument(
      fileMetadata("docx", {
        fileId: "file-docx",
        displayPath: "memo.docx",
        name: "memo.docx",
        sourceMetadataVersion: "file-docx:48:1",
      }),
      createStoredZip({
        "word/document.xml":
          '<w:document><w:body><w:p><w:r><w:t>キャッシュフロー計算書</w:t></w:r></w:p><w:p><w:r><w:t>精算表を確認</w:t></w:r></w:p></w:body></w:document>',
      }),
    );

    assert.equal(parsed.parser.name, "relay-office-openxml");
    assert.equal(parsed.parser.version, "relay-office-openxml-reader-v1");
    assert.equal(parsed.parser_confidence, "medium");
    assert.equal(parsed.metadata.file_type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(parsed.metadata.extra_data.capabilities.text, true);
    assert.equal(parsed.metadata.extra_data.capabilities.annotations, true);
    assert.equal(parsed.content.structure.subparagraphs[0].text, "キャッシュフロー計算書");
  } finally {
    cleanup();
  }
});

test("Relay ParsedDocument IR extracts XLSX cells and formula metadata", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parseOfficeOpenXmlBufferToRelayParsedDocument(
      fileMetadata("xlsx", {
        fileId: "file-xlsx",
        displayPath: "workbook.xlsx",
        name: "workbook.xlsx",
        sourceMetadataVersion: "file-xlsx:48:1",
      }),
      createStoredZip({
        "xl/workbook.xml":
          '<workbook><sheets><sheet name="CFS" sheetId="1" r:id="rId1" state="hidden"/></sheets></workbook>',
        "xl/sharedStrings.xml":
          '<sst><si><t>キャッシュフロー計算書</t></si><si><t>精算表</t></si></sst>',
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>SUM(C1:C2)</f></c></row></sheetData></worksheet>',
      }),
    );

    assert.equal(parsed.parser.name, "relay-office-openxml");
    assert.equal(parsed.parser.profile, "spreadsheet");
    assert.equal(parsed.metadata.extra_data.capabilities.tables, true);
    assert.equal(parsed.metadata.extra_data.capabilities.cellAnchors, true);
    assert.equal(parsed.content.tables.length, 1);
    assert.equal(parsed.content.tables[0].rows[0][0].text, "キャッシュフロー計算書");
    assert.equal(parsed.content.tables[0].rows[0][0].metadata.cell_address, "A1");
    assert.equal(parsed.content.tables[0].rows[0][1].metadata.formula, "SUM(C1:C2)");
    assert.equal(parsed.content.tables[0].rows[0][1].metadata.cached_value_state, "missing");
    assert.ok(parsed.warnings.some((warning) => warning.code === "formula_cached_value_missing"));
    assert.ok(parsed.warnings.some((warning) => warning.code === "hidden_sheet_detected"));
    assert.equal(parsed.metadata.extra_data.structure_profile.profile, "spreadsheet");
    assert.equal(parsed.metadata.extra_data.structure_profile.status, "degraded");
    assert.equal(parsed.metadata.extra_data.structure_profile.cellCount, 2);
  } finally {
    cleanup();
  }
});

test("Relay ParsedDocument IR preserves PDF text as document-level evidence", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parsePdfTextToRelayParsedDocument(
      fileMetadata("pdf", {
        fileId: "file-pdf",
        displayPath: "Final_有価証券報告書.pdf",
        name: "Final_有価証券報告書.pdf",
        sourceMetadataVersion: "file-pdf:48:1",
      }),
      ["連結キャッシュフロー計算書", "営業活動によるキャッシュフロー"].join("\n"),
    );

    assert.equal(parsed.parser.name, "relay-pdf");
    assert.equal(parsed.parser.version, "relay-pdf-liteparse-reader-v1");
    assert.equal(parsed.parser.profile, "filing_or_disclosure");
    assert.equal(parsed.parser_confidence, "medium");
    assert.equal(parsed.metadata.file_type, "application/pdf");
    assert.equal(parsed.metadata.extra_data.capabilities.text, true);
    assert.equal(parsed.metadata.extra_data.capabilities.textLayerOnly, true);
    assert.equal(parsed.content.structure.metadata.page_id, "doc");
    assert.equal(parsed.content.structure.subparagraphs[0].metadata.extraction_method, "liteparse_text_layer");
    assert.ok(parsed.warnings.some((warning) => warning.code === "pdf_page_anchors_unavailable"));
    assert.ok(parsed.warnings.some((warning) => warning.code === "structure_profile_degraded"));
    assert.ok(parsed.warnings.some((warning) => warning.code === "profile_page_anchors_unavailable"));
    assert.equal(parsed.metadata.extra_data.structure_profile.status, "degraded");
    assert.equal(parsed.metadata.extra_data.structure_profile.unsupportedWarningCount > 0, true);
  } finally {
    cleanup();
  }
});

test("Relay ParsedDocument structure-profile gate rejects flattened text-only output", async () => {
  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = module.parseTextToRelayParsedDocument(fileMetadata(), "flattened キャッシュフロー");
    const flattened = {
      ...parsed,
      content: {
        structure: {
          ...parsed.content.structure,
          text: "flattened キャッシュフロー",
          subparagraphs: [],
        },
        tables: [],
      },
      warnings: [],
    };

    const profile = module.validateRelayParsedDocumentStructureProfile(flattened);
    assert.equal(profile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(profile.status, "invalid");
    assert.equal(profile.flattenedTextRejected, true);
    assert.ok(profile.errors.includes("flattened_text_without_tree_nodes"));

    const validation = module.validateRelayParsedDocument(flattened);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /structure_profile\.flattened_text_without_tree_nodes/);
  } finally {
    cleanup();
  }
});

test("Relay PDF reader can use an explicit LiteParse-compatible runner", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-pdf-reader-workspace-"));
  const runner = mkdtempSync(resolve(tmpdir(), "relay-pdf-reader-runner-"));
  const pdfPath = resolve(workspace, "report.pdf");
  const parseScriptPath = resolve(runner, "parse.mjs");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(pdfPath, "%PDF fake", "utf8");
  writeFileSync(
    parseScriptPath,
    "process.stdout.write('キャッシュフロー計算書\\nPDF本文');",
    "utf8",
  );

  const { module, cleanup } = await loadParsedDocumentIrModule();
  try {
    const parsed = await module.readPdfFileAsRelayParsedDocument(
      fileMetadata("pdf", {
        path: pdfPath,
        displayPath: "report.pdf",
        name: "report.pdf",
        size: 9,
      }),
      {
        nodePath: process.execPath,
        parseScriptPath,
        timeoutMs: 5_000,
      },
    );
    assert.equal(parsed.parser.name, "relay-pdf");
    assert.equal(parsed.parser_confidence, "medium");
    assert.match(parsed.content.structure.subparagraphs[0].text, /キャッシュフロー計算書/);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runner, { recursive: true, force: true });
  }
});
