/**
 * Dedoc-compatible ParsedDocument IR for Relay Document Search.
 *
 * The IR is parser-owned and consumes an already discovered FileMetadata
 * snapshot. It never walks workspace roots, decides freshness, or mutates the
 * metadata cache.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { inflateRawSync } from 'zlib';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';

export const RELAY_PARSED_DOCUMENT_IR_CONTRACT = 'RelayParsedDocumentIR.v1' as const;
export const RELAY_PARSED_DOCUMENT_IR_VERSION = 'relay-ir-v1' as const;
export const RELAY_READER_CAPABILITY_REGISTRY_CONTRACT = 'RelayReaderCapabilityRegistry.v1' as const;
export const RELAY_TEXT_READER_VERSION = 'relay-text-reader-v1' as const;
export const RELAY_PDF_READER_VERSION = 'relay-pdf-liteparse-reader-v1' as const;
export const RELAY_OFFICE_OPENXML_READER_VERSION = 'relay-office-openxml-reader-v1' as const;
export const RELAY_STRUCTURE_PATTERN_VERSION = 'relay-patterns-v1' as const;
export const RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT =
  'RelayParsedDocumentStructureProfile.v1' as const;

export type RelayParserProfile =
  | 'default'
  | 'spreadsheet'
  | 'financial_workpaper'
  | 'filing_or_disclosure'
  | 'audit_material'
  | 'technical_document'
  | 'contract';

export type RelayParserWarning = {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  stage: 'reader' | 'normalizer' | 'structure' | 'attachment';
};

export type RelayParsedDocumentStructureProfileStatus = 'valid' | 'degraded' | 'invalid';

export type RelayParsedDocumentStructureProfileValidation = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT;
  profile: RelayParserProfile | string;
  status: RelayParsedDocumentStructureProfileStatus;
  treeNodeCount: number;
  tableCount: number;
  cellCount: number;
  annotationCount: number;
  metadataFieldCount: number;
  warningCount: number;
  attachmentCount: number;
  lossyWarningCount: number;
  unsupportedWarningCount: number;
  flattenedTextRejected: boolean;
  errors: string[];
  warnings: string[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayAnnotation = {
  type: string;
  value?: string | number | boolean;
  metadata?: Record<string, unknown>;
};

export type RelayTreeNode = {
  node_id: string;
  text: string;
  annotations: RelayAnnotation[];
  metadata: {
    paragraph_type: string;
    page_id: string | null;
    line_id: string | null;
    [key: string]: unknown;
  };
  subparagraphs: RelayTreeNode[];
};

export type RelayCellWithMeta = {
  cell_id: string;
  row: number;
  column: number;
  text: string;
  rowspan: number;
  colspan: number;
  metadata: Record<string, unknown>;
};

export type RelayTable = {
  table_id: string;
  rows: RelayCellWithMeta[][];
  metadata: Record<string, unknown>;
};

export type RelayParsedDocument = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_IR_CONTRACT;
  version: typeof RELAY_PARSED_DOCUMENT_IR_VERSION;
  parser: {
    name: string;
    version: string;
    profile: RelayParserProfile;
    capabilityRegistryVersion: typeof RELAY_READER_CAPABILITY_REGISTRY_CONTRACT;
    patternSetVersion: typeof RELAY_STRUCTURE_PATTERN_VERSION;
  };
  source_file_id: string;
  source_metadata_version: string;
  source_path: string;
  source_mtime: string;
  metadata: {
    uid: string;
    file_name: string;
    file_type: string;
    size: number;
    modified_time: number;
    extra_data: Record<string, unknown>;
  };
  content: {
    structure: RelayTreeNode;
    tables: RelayTable[];
  };
  warnings: RelayParserWarning[];
  attachments: RelayParsedDocument[];
  parser_confidence: 'high' | 'medium' | 'low';
};

export type RelayReaderOutput = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_IR_CONTRACT;
  stage: 'ReaderOutput';
  source_file_id: string;
  source_metadata_version: string;
  reader: string;
  lines: Array<{ raw_line_id: string; text: string; line_number: number }>;
  warnings: RelayParserWarning[];
};

export type RelayNormalizedDocument = {
  schemaVersion: typeof RELAY_PARSED_DOCUMENT_IR_CONTRACT;
  stage: 'NormalizedDocument';
  source_file_id: string;
  source_metadata_version: string;
  lines: Array<{ line_id: string; text: string; line_number: number }>;
  warnings: RelayParserWarning[];
};

export type RelayPdfReaderOptions = {
  nodePath?: string;
  runnerRoot?: string;
  parseScriptPath?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);
const PDF_EXTENSIONS = new Set(['pdf']);
const OFFICE_OPEN_XML_EXTENSIONS = new Set(['docx', 'xlsx', 'xlsm', 'pptx']);
const MAX_TEXT_READER_BYTES = 256 * 1024;
const MAX_PDF_READER_BYTES = 64 * 1024 * 1024;
const MAX_OFFICE_OPEN_XML_BYTES = 64 * 1024 * 1024;
const MAX_OFFICE_OPEN_XML_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_OFFICE_OPEN_XML_LINES = 5000;
const DEFAULT_PDF_READER_TIMEOUT_MS = 120_000;
const DEFAULT_PDF_READER_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function mimeTypeForExtension(extension: string): string {
  switch (extension) {
    case 'md':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    case 'txt':
      return 'text/plain';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

export function profileForDocumentFile(file: RelayDocumentSearchCachedFileMetadata): RelayParserProfile {
  const path = `${file.displayPath} ${file.name}`.normalize('NFKC').toLowerCase();
  if (/キャッシュフロー|連結|精算表|cfs?\b|bs|pl/u.test(path)) return 'financial_workpaper';
  if (/監査|audit/u.test(path)) return 'audit_material';
  if (/契約|contract/u.test(path)) return 'contract';
  if (file.extension === 'pdf' && /有価証券報告書|短信|決算|開示|disclosure|filing/u.test(path)) {
    return 'filing_or_disclosure';
  }
  if (file.extension === 'xlsx' || file.extension === 'xlsm') return 'spreadsheet';
  if (file.extension === 'md') return 'technical_document';
  return 'default';
}

function lineType(line: string): string {
  if (/^\s*#{1,6}\s+/u.test(line)) return 'heading';
  if (/^\s*[-*+]\s+/u.test(line) || /^\s*\d+[.)]\s+/u.test(line)) return 'list_item';
  if (line.trim().length === 0) return 'blank';
  return 'paragraph';
}

export function readerCapabilitiesForExtension(extension: string): Record<string, boolean | string> {
  return {
    schemaVersion: RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
    extension,
    text: TEXT_EXTENSIONS.has(extension) || PDF_EXTENSIONS.has(extension) || OFFICE_OPEN_XML_EXTENSIONS.has(extension),
    tables: extension === 'csv' || extension === 'xlsx' || extension === 'xlsm',
    annotations: extension === 'md' || extension === 'docx' || extension === 'pptx',
    attachments: false,
    pageAnchors: false,
    cellAnchors: extension === 'csv' || extension === 'xlsx' || extension === 'xlsm',
    cachedFormulas: extension === 'xlsx' || extension === 'xlsm',
    ocr: false,
    textLayerOnly: extension === 'pdf',
    hiddenState: extension === 'xlsx' || extension === 'xlsm',
  };
}

export async function readTextFileAsRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
): Promise<RelayParsedDocument | undefined> {
  if (!TEXT_EXTENSIONS.has(file.extension)) return undefined;
  if (file.size > MAX_TEXT_READER_BYTES) return textReaderSkippedDocument(file, 'text_reader_size_limit');
  const text = await readFile(file.path, 'utf8');
  return parseTextToRelayParsedDocument(file, text);
}

export function parseTextToRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  text: string,
): RelayParsedDocument {
  const readerOutput = buildReaderOutput(file, text);
  const normalized = normalizeReaderOutput(readerOutput);
  const parsed = buildParsedDocument(file, normalized);
  return finalizeRelayParsedDocument(parsed);
}

export async function readPdfFileAsRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  options: RelayPdfReaderOptions = {},
): Promise<RelayParsedDocument | undefined> {
  if (!PDF_EXTENSIONS.has(file.extension)) return undefined;
  if (file.size > MAX_PDF_READER_BYTES) {
    return skippedDocument(file, 'relay-pdf', RELAY_PDF_READER_VERSION, 'pdf_reader_size_limit');
  }
  const runtime = resolvePdfReaderRuntime(options);
  if (!runtime) return skippedDocument(file, 'relay-pdf', RELAY_PDF_READER_VERSION, 'pdf_reader_unavailable');

  const extracted = await runPdfReader(file.path, runtime, options);
  if (!extracted.ok) return skippedDocument(file, 'relay-pdf', RELAY_PDF_READER_VERSION, extracted.code);
  return parsePdfTextToRelayParsedDocument(file, extracted.text, extracted.warnings);
}

export function parsePdfTextToRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  text: string,
  warnings: RelayParserWarning[] = [],
): RelayParsedDocument {
  const readerOutput = buildReaderOutput(file, text, RELAY_PDF_READER_VERSION, [
    ...warnings,
    {
      code: 'pdf_page_anchors_unavailable',
      message: 'PDF text was extracted as one document-level stream; page anchors are not available in this reader.',
      severity: 'info',
      stage: 'reader',
    },
  ]);
  const normalized = normalizeReaderOutput(readerOutput);
  const parsed = buildParsedDocument(file, normalized, {
    parserName: 'relay-pdf',
    parserVersion: RELAY_PDF_READER_VERSION,
    confidence: text.trim() ? 'medium' : 'low',
    rootMetadata: {
      page_id: 'doc',
      extraction_method: 'liteparse_text_layer',
      page_anchors_available: false,
    },
  });
  return finalizeRelayParsedDocument(parsed);
}

export async function readOfficeOpenXmlFileAsRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
): Promise<RelayParsedDocument | undefined> {
  if (!OFFICE_OPEN_XML_EXTENSIONS.has(file.extension)) return undefined;
  if (file.size > MAX_OFFICE_OPEN_XML_BYTES) {
    return skippedDocument(file, 'relay-office-openxml', RELAY_OFFICE_OPENXML_READER_VERSION, 'office_openxml_reader_size_limit');
  }
  const buffer = await readFile(file.path);
  try {
    return parseOfficeOpenXmlBufferToRelayParsedDocument(file, buffer);
  } catch {
    return skippedDocument(file, 'relay-office-openxml', RELAY_OFFICE_OPENXML_READER_VERSION, 'office_openxml_reader_failed');
  }
}

export function parseOfficeOpenXmlBufferToRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  buffer: Buffer,
): RelayParsedDocument {
  const zip = readZipEntries(buffer, (name) => officeOpenXmlEntryWanted(file.extension, name));
  return parseOfficeOpenXmlEntriesToRelayParsedDocument(file, zip.entries, zip.warnings);
}

export function parseOfficeOpenXmlEntriesToRelayParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  entries: Map<string, string>,
  warnings: RelayParserWarning[] = [],
): RelayParsedDocument {
  const extracted = extractOfficeOpenXml(file, entries, warnings);
  const readerOutput = buildReaderOutput(file, extracted.lines.join('\n'), RELAY_OFFICE_OPENXML_READER_VERSION, extracted.warnings);
  const normalized = normalizeReaderOutput(readerOutput);
  const parsed = buildParsedDocument(file, normalized, {
    parserName: 'relay-office-openxml',
    parserVersion: RELAY_OFFICE_OPENXML_READER_VERSION,
    confidence: extracted.lines.length ? 'medium' : 'low',
    rootMetadata: {
      extraction_method: 'office_openxml_package',
      office_format: file.extension,
    },
    tables: extracted.tables,
  });
  return finalizeRelayParsedDocument(parsed);
}

function skippedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  parserName: string,
  parserVersion: string,
  code: string,
): RelayParsedDocument {
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_IR_CONTRACT,
    version: RELAY_PARSED_DOCUMENT_IR_VERSION,
    parser: {
      name: parserName,
      version: parserVersion,
      profile: profileForDocumentFile(file),
      capabilityRegistryVersion: RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
      patternSetVersion: RELAY_STRUCTURE_PATTERN_VERSION,
    },
    source_file_id: file.fileId,
    source_metadata_version: file.sourceMetadataVersion,
    source_path: file.path,
    source_mtime: file.modifiedTime,
    metadata: {
      uid: `parsed-${stableId(`${file.fileId}:${file.sourceMetadataVersion}`)}`,
      file_name: file.name,
      file_type: mimeTypeForExtension(file.extension),
      size: file.size,
      modified_time: Date.parse(file.modifiedTime) / 1000,
      extra_data: {
        capabilities: readerCapabilitiesForExtension(file.extension),
      },
    },
    content: {
      structure: {
        node_id: 'root',
        text: '',
        annotations: [],
        metadata: { paragraph_type: 'root', page_id: null, line_id: null },
        subparagraphs: [],
      },
      tables: [],
    },
    warnings: [
      {
        code,
        message: 'Reader skipped this file because it is unavailable or outside the current safe extraction budget.',
        severity: 'warning',
        stage: 'reader',
      },
    ],
    attachments: [],
    parser_confidence: 'low',
  };
}

function textReaderSkippedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  code: string,
): RelayParsedDocument {
  return skippedDocument(file, 'relay-text', RELAY_TEXT_READER_VERSION, code);
}

function buildReaderOutput(
  file: RelayDocumentSearchCachedFileMetadata,
  text: string,
  reader = RELAY_TEXT_READER_VERSION,
  warnings: RelayParserWarning[] = [],
): RelayReaderOutput {
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_IR_CONTRACT,
    stage: 'ReaderOutput',
    source_file_id: file.fileId,
    source_metadata_version: file.sourceMetadataVersion,
    reader,
    lines: text.split(/\r?\n/u).map((line, index) => ({
      raw_line_id: `raw-line-${index + 1}`,
      text: line,
      line_number: index + 1,
    })),
    warnings,
  };
}

function normalizeReaderOutput(readerOutput: RelayReaderOutput): RelayNormalizedDocument {
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_IR_CONTRACT,
    stage: 'NormalizedDocument',
    source_file_id: readerOutput.source_file_id,
    source_metadata_version: readerOutput.source_metadata_version,
    lines: readerOutput.lines.map((line) => ({
      line_id: `line-${line.line_number}`,
      text: line.text.normalize('NFKC'),
      line_number: line.line_number,
    })),
    warnings: [...readerOutput.warnings],
  };
}

function buildParsedDocument(
  file: RelayDocumentSearchCachedFileMetadata,
  normalized: RelayNormalizedDocument,
  options: {
    parserName?: string;
    parserVersion?: string;
    confidence?: RelayParsedDocument['parser_confidence'];
    rootMetadata?: Record<string, unknown>;
    tables?: RelayTable[];
  } = {},
): RelayParsedDocument {
  const profile = profileForDocumentFile(file);
  const parserName = options.parserName ?? 'relay-text';
  const parserVersion = options.parserVersion ?? RELAY_TEXT_READER_VERSION;
  const rootMetadata = options.rootMetadata ?? {};
  return {
    schemaVersion: RELAY_PARSED_DOCUMENT_IR_CONTRACT,
    version: RELAY_PARSED_DOCUMENT_IR_VERSION,
    parser: {
      name: parserName,
      version: parserVersion,
      profile,
      capabilityRegistryVersion: RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
      patternSetVersion: RELAY_STRUCTURE_PATTERN_VERSION,
    },
    source_file_id: file.fileId,
    source_metadata_version: file.sourceMetadataVersion,
    source_path: file.path,
    source_mtime: file.modifiedTime,
    metadata: {
      uid: `parsed-${stableId(`${file.fileId}:${file.sourceMetadataVersion}`)}`,
      file_name: file.name,
      file_type: mimeTypeForExtension(file.extension),
      size: file.size,
      modified_time: Date.parse(file.modifiedTime) / 1000,
      extra_data: {
        capabilities: readerCapabilitiesForExtension(file.extension),
      },
    },
    content: {
      structure: {
        node_id: 'root',
        text: '',
        annotations: [],
        metadata: { paragraph_type: 'root', page_id: null, line_id: null, profile, ...rootMetadata },
        subparagraphs: normalized.lines.map((line) => ({
          node_id: `node-${line.line_id}`,
          text: line.text,
          annotations: [],
          metadata: {
            paragraph_type: lineType(line.text),
            page_id: rootMetadata.page_id === 'doc' ? 'doc' : null,
            line_id: line.line_id,
            line_number: line.line_number,
            ...rootMetadata,
          },
          subparagraphs: [],
        })),
      },
      tables: options.tables ?? (file.extension === 'csv' ? csvTablesFromLines(file, normalized.lines) : []),
    },
    warnings: [...normalized.warnings],
    attachments: [],
    parser_confidence: options.confidence ?? 'high',
  };
}

function csvTablesFromLines(
  file: RelayDocumentSearchCachedFileMetadata,
  lines: RelayNormalizedDocument['lines'],
): RelayTable[] {
  const nonEmpty = lines.filter((line) => line.text.trim().length > 0);
  if (!nonEmpty.length) return [];
  return [
    {
      table_id: `table-${stableId(`${file.fileId}:${file.sourceMetadataVersion}:csv`)}`,
      rows: nonEmpty.map((line, rowIndex) =>
        line.text.split(',').map((cell, columnIndex) => ({
          cell_id: `cell-${rowIndex + 1}-${columnIndex + 1}`,
          row: rowIndex + 1,
          column: columnIndex + 1,
          text: cell.trim(),
          rowspan: 1,
          colspan: 1,
          metadata: {
            line_id: line.line_id,
            line_number: line.line_number,
          },
        })),
      ),
      metadata: {
        source: 'csv',
      },
    },
  ];
}

function officeOpenXmlEntryWanted(extension: string, name: string): boolean {
  const normalized = name.replace(/\\/gu, '/');
  if (extension === 'docx') {
    return /^word\/(document|header\d*|footer\d*)\.xml$/iu.test(normalized);
  }
  if (extension === 'xlsx' || extension === 'xlsm') {
    return (
      normalized === 'xl/sharedStrings.xml' ||
      normalized === 'xl/workbook.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/iu.test(normalized)
    );
  }
  if (extension === 'pptx') {
    return /^ppt\/slides\/slide\d+\.xml$/iu.test(normalized);
  }
  return false;
}

function extractOfficeOpenXml(
  file: RelayDocumentSearchCachedFileMetadata,
  entries: Map<string, string>,
  warnings: RelayParserWarning[],
): { lines: string[]; tables: RelayTable[]; warnings: RelayParserWarning[] } {
  if (file.extension === 'docx') return extractDocx(entries, warnings);
  if (file.extension === 'xlsx' || file.extension === 'xlsm') return extractXlsx(file, entries, warnings);
  if (file.extension === 'pptx') return extractPptx(entries, warnings);
  return { lines: [], tables: [], warnings };
}

function extractDocx(
  entries: Map<string, string>,
  warnings: RelayParserWarning[],
): { lines: string[]; tables: RelayTable[]; warnings: RelayParserWarning[] } {
  const lines: string[] = [];
  for (const [name, xml] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!name.startsWith('word/')) continue;
    const paragraphs = extractXmlBlocks(xml, 'p');
    for (const paragraph of paragraphs) {
      const text = extractTaggedText(paragraph, 't').join('');
      if (text.trim()) lines.push(text.trim());
      if (lines.length >= MAX_OFFICE_OPEN_XML_LINES) break;
    }
    if (lines.length >= MAX_OFFICE_OPEN_XML_LINES) break;
  }
  return {
    lines,
    tables: [],
    warnings: capLineWarnings(lines, warnings),
  };
}

function extractPptx(
  entries: Map<string, string>,
  warnings: RelayParserWarning[],
): { lines: string[]; tables: RelayTable[]; warnings: RelayParserWarning[] } {
  const lines: string[] = [];
  for (const [name, xml] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))) {
    if (!name.startsWith('ppt/slides/')) continue;
    const slide = name.match(/slide(\d+)\.xml$/iu)?.[1] || '?';
    const text = extractTaggedText(xml, 't').join(' ').replace(/\s+/gu, ' ').trim();
    if (text) lines.push(`Slide ${slide}: ${text}`);
    if (lines.length >= MAX_OFFICE_OPEN_XML_LINES) break;
  }
  return {
    lines,
    tables: [],
    warnings: capLineWarnings(lines, warnings),
  };
}

function extractXlsx(
  file: RelayDocumentSearchCachedFileMetadata,
  entries: Map<string, string>,
  warnings: RelayParserWarning[],
): { lines: string[]; tables: RelayTable[]; warnings: RelayParserWarning[] } {
  const sharedStrings = sharedStringsFromXml(entries.get('xl/sharedStrings.xml') || '');
  const sheets = workbookSheetsFromXml(entries.get('xl/workbook.xml') || '');
  const lines: string[] = [];
  const tables: RelayTable[] = [];
  let missingCachedFormulaCount = 0;

  for (const [name, xml] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))) {
    const sheetMatch = name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/iu);
    if (!sheetMatch) continue;
    const sheetIndex = Number.parseInt(sheetMatch[1], 10);
    const sheet = sheets[sheetIndex - 1] || { name: `Sheet${sheetIndex}`, state: 'visible' };
    const parsed = rowsFromWorksheetXml(xml, sharedStrings, sheet.name, sheet.state, sheetIndex);
    missingCachedFormulaCount += parsed.missingCachedFormulaCount;
    tables.push({
      table_id: `table-${stableId(`${file.fileId}:${file.sourceMetadataVersion}:${sheet.name}:${sheetIndex}`)}`,
      rows: parsed.rows,
      metadata: {
        source: file.extension,
        sheet_name: sheet.name,
        sheet_index: sheetIndex,
        hidden_state: sheet.state,
      },
    });
    for (const line of parsed.lines) {
      if (line.trim()) lines.push(line);
      if (lines.length >= MAX_OFFICE_OPEN_XML_LINES) break;
    }
    if (lines.length >= MAX_OFFICE_OPEN_XML_LINES) break;
  }

  const nextWarnings = capLineWarnings(lines, warnings);
  if (missingCachedFormulaCount > 0) {
    nextWarnings.push({
      code: 'formula_cached_value_missing',
      message: `Some spreadsheet formulas did not include cached values (${missingCachedFormulaCount}).`,
      severity: 'warning',
      stage: 'reader',
    });
  }
  if (tables.some((table) => table.metadata.hidden_state && table.metadata.hidden_state !== 'visible')) {
    nextWarnings.push({
      code: 'hidden_sheet_detected',
      message: 'One or more workbook sheets are hidden or very hidden.',
      severity: 'warning',
      stage: 'reader',
    });
  }
  return { lines, tables, warnings: nextWarnings };
}

function capLineWarnings(lines: string[], warnings: RelayParserWarning[]): RelayParserWarning[] {
  if (lines.length < MAX_OFFICE_OPEN_XML_LINES) return warnings;
  return [
    ...warnings,
    {
      code: 'office_openxml_line_limit',
      message: 'Office text extraction reached the current safe line budget.',
      severity: 'warning',
      stage: 'reader',
    },
  ];
}

function sharedStringsFromXml(xml: string): string[] {
  if (!xml) return [];
  return extractXmlBlocks(xml, 'si').map((block) => extractTaggedText(block, 't').join(''));
}

function workbookSheetsFromXml(xml: string): Array<{ name: string; state: string }> {
  if (!xml) return [];
  const sheets: Array<{ name: string; state: string }> = [];
  for (const tag of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b[^>]*>/giu)) {
    const sheetTag = tag[0];
    sheets.push({
      name: xmlAttribute(sheetTag, 'name') || `Sheet${sheets.length + 1}`,
      state: xmlAttribute(sheetTag, 'state') || 'visible',
    });
  }
  return sheets;
}

function rowsFromWorksheetXml(
  xml: string,
  sharedStrings: string[],
  sheetName: string,
  hiddenState: string,
  sheetIndex: number,
): { rows: RelayCellWithMeta[][]; lines: string[]; missingCachedFormulaCount: number } {
  const rows: RelayCellWithMeta[][] = [];
  const lines: string[] = [];
  let missingCachedFormulaCount = 0;
  for (const rowBlock of extractXmlBlocks(xml, 'row')) {
    const rowNumber = Number.parseInt(xmlAttribute(rowBlock, 'r') || `${rows.length + 1}`, 10);
    const cells: RelayCellWithMeta[] = [];
    const lineParts: string[] = [];
    for (const cellBlock of extractXmlBlocks(rowBlock, 'c')) {
      const cellAddress = xmlAttribute(cellBlock, 'r') || `${columnName(cells.length + 1)}${rowNumber}`;
      const cellType = xmlAttribute(cellBlock, 't') || '';
      const formula = extractTaggedText(cellBlock, 'f')[0] || '';
      const rawValue = extractTaggedText(cellBlock, 'v')[0] || '';
      const inlineText = extractTaggedText(cellBlock, 't').join('');
      const text = cellType === 's'
        ? sharedStrings[Number.parseInt(rawValue, 10)] || ''
        : inlineText || rawValue;
      if (formula && !rawValue) missingCachedFormulaCount += 1;
      const column = columnNumber(cellAddress);
      const row = Number.parseInt(cellAddress.match(/\d+/u)?.[0] || `${rowNumber}`, 10);
      const cell: RelayCellWithMeta = {
        cell_id: `${sheetName}!${cellAddress}`,
        row,
        column,
        text,
        rowspan: 1,
        colspan: 1,
        metadata: {
          sheet_name: sheetName,
          sheet_index: sheetIndex,
          cell_address: cellAddress,
          formula: formula || undefined,
          cached_value_state: formula ? (rawValue ? 'present' : 'missing') : 'not_formula',
          hidden_state: hiddenState,
        },
      };
      cells.push(cell);
      if (text.trim() || formula.trim()) {
        lineParts.push(`${cellAddress} ${text || formula}`.trim());
      }
    }
    if (cells.length) {
      rows.push(cells);
      if (lineParts.length) lines.push(`${sheetName}!${rowNumber}: ${lineParts.join(' | ')}`);
    }
  }
  return { rows, lines, missingCachedFormulaCount };
}

function extractXmlBlocks(xml: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?${localName}>`,
    'giu',
  );
  return [...xml.matchAll(pattern)].map((match) => match[0]);
}

function extractTaggedText(xml: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${localName}>`,
    'giu',
  );
  return [...xml.matchAll(pattern)]
    .map((match) => decodeXmlEntities(stripXmlTags(match[1])))
    .filter((text) => text.length > 0);
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/gu, '');
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'iu');
  const match = tag.match(pattern);
  return match ? decodeXmlEntities(match[2]) : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function columnNumber(cellAddress: string): number {
  const letters = (cellAddress.match(/[A-Z]+/iu)?.[0] || 'A').toUpperCase();
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value;
}

function columnName(column: number): string {
  let current = Math.max(1, column);
  let out = '';
  while (current > 0) {
    const modulo = (current - 1) % 26;
    out = String.fromCharCode(65 + modulo) + out;
    current = Math.floor((current - modulo) / 26);
  }
  return out;
}

function readZipEntries(
  buffer: Buffer,
  include: (name: string) => boolean,
): { entries: Map<string, string>; warnings: RelayParserWarning[] } {
  const warnings: RelayParserWarning[] = [];
  const entries = new Map<string, string>();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('zip end of central directory not found');
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('zip central directory entry is invalid');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!include(name)) continue;
    if (uncompressedSize > MAX_OFFICE_OPEN_XML_ENTRY_BYTES) {
      warnings.push({
        code: 'office_openxml_entry_size_limit',
        message: `Skipped oversized Office XML entry: ${name}`,
        severity: 'warning',
        stage: 'reader',
      });
      continue;
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('zip local file header is invalid');
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      warnings.push({
        code: 'office_openxml_unsupported_zip_method',
        message: `Skipped Office XML entry with unsupported ZIP method ${method}: ${name}`,
        severity: 'warning',
        stage: 'reader',
      });
      continue;
    }
    entries.set(name.replace(/\\/gu, '/'), data.toString('utf8'));
  }
  return { entries, warnings };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function resolvePdfReaderRuntime(
  options: RelayPdfReaderOptions,
): { nodePath: string; parseScriptPath: string; env: Record<string, string | undefined> } | undefined {
  const env = { ...process.env, ...options.env };
  const parseScriptPath = options.parseScriptPath || (options.runnerRoot || env.RELAY_LITEPARSE_RUNNER_ROOT
    ? join(options.runnerRoot || env.RELAY_LITEPARSE_RUNNER_ROOT || '', 'parse.mjs')
    : undefined);
  if (!parseScriptPath || !existsSync(parseScriptPath)) return undefined;

  const explicitNode = options.nodePath || env.RELAY_BUNDLED_NODE;
  const nodePath = explicitNode || process.execPath;
  if (explicitNode && !existsSync(explicitNode)) return undefined;
  return {
    nodePath,
    parseScriptPath,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: env.ELECTRON_RUN_AS_NODE || (process.versions?.electron ? '1' : undefined),
    },
  };
}

async function runPdfReader(
  path: string,
  runtime: { nodePath: string; parseScriptPath: string; env: Record<string, string | undefined> },
  options: RelayPdfReaderOptions,
): Promise<
  | { ok: true; text: string; warnings: RelayParserWarning[] }
  | { ok: false; code: string }
> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_PDF_READER_TIMEOUT_MS);
  const maxOutputBytes = Math.max(1024, options.maxOutputBytes ?? DEFAULT_PDF_READER_MAX_OUTPUT_BYTES);
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(runtime.nodePath, [runtime.parseScriptPath, path], {
        env: runtime.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ ok: false, code: 'pdf_reader_spawn_failed' });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (result: { ok: true; text: string; warnings: RelayParserWarning[] } | { ok: false; code: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: 'pdf_reader_timeout' });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish({ ok: false, code: 'pdf_reader_output_limit' });
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => finish({ ok: false, code: 'pdf_reader_spawn_failed' }));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish({ ok: false, code: 'pdf_reader_failed' });
        return;
      }
      const text = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8').trim();
      const warnings: RelayParserWarning[] = stderrText
        ? [{
            code: 'pdf_reader_stderr',
            message: stderrText.slice(0, 500),
            severity: 'warning',
            stage: 'reader',
          }]
        : [];
      finish({ ok: true, text, warnings });
    });
  });
}

type MutableStructureProfileValidation = Omit<
  RelayParsedDocumentStructureProfileValidation,
  'status' | 'lossyWarningCount' | 'unsupportedWarningCount' | 'ai_boundary'
> & {
  nonEmptyTextNodeCount: number;
};

const VALID_PARSER_PROFILES = new Set<string>([
  'default',
  'spreadsheet',
  'financial_workpaper',
  'filing_or_disclosure',
  'audit_material',
  'technical_document',
  'contract',
]);

const LOSSY_WARNING_PATTERN = /loss|unsupported|unavailable|limit|missing|flattened|skipped|failed|timeout|denied/iu;
const UNSUPPORTED_WARNING_PATTERN = /unsupported|unavailable|not_supported/iu;

function parserProfileFromInput(input: Record<string, unknown>): RelayParserProfile | string {
  const parser = isRecord(input.parser) ? input.parser : undefined;
  return typeof parser?.profile === 'string' && parser.profile.trim() ? parser.profile : 'unknown';
}

function parserWarningsFromInput(input: Record<string, unknown>): RelayParserWarning[] {
  if (!Array.isArray(input.warnings)) return [];
  return input.warnings.filter((warning): warning is RelayParserWarning =>
    isRecord(warning) &&
      typeof warning.code === 'string' &&
      typeof warning.message === 'string' &&
      (warning.severity === 'info' || warning.severity === 'warning' || warning.severity === 'error') &&
      (warning.stage === 'reader' || warning.stage === 'normalizer' || warning.stage === 'structure' || warning.stage === 'attachment'),
  );
}

function pushUnique(target: string[], code: string): void {
  if (!target.includes(code)) target.push(code);
}

function structureProfileMessage(code: string): string {
  switch (code) {
    case 'flattened_text_without_tree_nodes':
      return 'ParsedDocument content must not collapse extracted text into the root node without tree nodes.';
    case 'content_flattened_text_field_not_allowed':
      return 'ParsedDocument content must keep text inside structure nodes or table cells, not a flat content.text field.';
    case 'spreadsheet_profile_requires_table_cells':
      return 'Spreadsheet parser output must expose workbook cells as separate table cells.';
    case 'document_profile_requires_tree_nodes':
      return 'Document parser output must expose readable text as structure tree nodes.';
    case 'profile_page_anchors_unavailable':
      return 'The selected structure profile has text evidence but the current reader cannot provide page anchors.';
    case 'reader_capabilities_missing':
      return 'Reader capability metadata is missing from ParsedDocument metadata.extra_data.capabilities.';
    case 'annotations_present_for_unsupported_reader':
      return 'Annotations are present even though the reader capability registry marks annotations unsupported.';
    case 'attachments_present_for_unsupported_reader':
      return 'Attachments are present even though the reader capability registry marks attachments unsupported.';
    case 'fields_embedded_in_metadata':
      return 'Warnings, attachments, annotations, or table/cell payloads must not be embedded inside metadata fields.';
    case 'financial_workpaper_table_cells_unavailable':
      return 'Financial workpaper output has text evidence but no separated table cells from a table-capable reader.';
    case 'structure_profile_degraded':
      return 'ParsedDocument structure profile is usable but lossy or unsupported fields were recorded.';
    case 'structure_profile_validation_failed':
      return 'ParsedDocument structure profile validation failed.';
    default:
      return `ParsedDocument structure profile warning: ${code}`;
  }
}

function warningKey(warning: RelayParserWarning): string {
  return `${warning.stage}:${warning.severity}:${warning.code}`;
}

function dedupeParserWarnings(warnings: RelayParserWarning[]): RelayParserWarning[] {
  const seen = new Set<string>();
  const out: RelayParserWarning[] = [];
  for (const warning of warnings) {
    const key = warningKey(warning);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}

function structureWarningsForReport(report: RelayParsedDocumentStructureProfileValidation): RelayParserWarning[] {
  const warnings: RelayParserWarning[] = [];
  if (report.status === 'invalid') {
    warnings.push({
      code: 'structure_profile_validation_failed',
      message: `${structureProfileMessage('structure_profile_validation_failed')} ${report.errors.join(', ')}`,
      severity: 'error',
      stage: 'structure',
    });
  } else if (report.status === 'degraded') {
    warnings.push({
      code: 'structure_profile_degraded',
      message: structureProfileMessage('structure_profile_degraded'),
      severity: 'warning',
      stage: 'structure',
    });
  }
  for (const code of report.warnings) {
    warnings.push({
      code,
      message: structureProfileMessage(code),
      severity: 'warning',
      stage: 'structure',
    });
  }
  return warnings;
}

function countCodes(codes: string[], pattern: RegExp): number {
  return [...new Set(codes)].filter((code) => pattern.test(code)).length;
}

function finalizeStructureProfileReport(
  report: MutableStructureProfileValidation,
  allWarnings: RelayParserWarning[],
): RelayParsedDocumentStructureProfileValidation {
  const signalCodes = [
    ...allWarnings.map((warning) => warning.code),
    ...report.warnings,
    ...report.errors,
  ];
  const status: RelayParsedDocumentStructureProfileStatus = report.errors.length
    ? 'invalid'
    : report.warnings.length || signalCodes.some((code) => LOSSY_WARNING_PATTERN.test(code))
      ? 'degraded'
      : 'valid';
  return {
    schemaVersion: report.schemaVersion,
    profile: report.profile,
    status,
    treeNodeCount: report.treeNodeCount,
    tableCount: report.tableCount,
    cellCount: report.cellCount,
    annotationCount: report.annotationCount,
    metadataFieldCount: report.metadataFieldCount,
    warningCount: allWarnings.length,
    attachmentCount: report.attachmentCount,
    lossyWarningCount: countCodes(signalCodes, LOSSY_WARNING_PATTERN),
    unsupportedWarningCount: countCodes(signalCodes, UNSUPPORTED_WARNING_PATTERN),
    flattenedTextRejected: report.flattenedTextRejected,
    errors: report.errors,
    warnings: report.warnings,
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}

function emptyStructureProfileReport(
  profile: RelayParserProfile | string,
  errors: string[],
): RelayParsedDocumentStructureProfileValidation {
  return finalizeStructureProfileReport({
    schemaVersion: RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
    profile,
    treeNodeCount: 0,
    tableCount: 0,
    cellCount: 0,
    annotationCount: 0,
    metadataFieldCount: 0,
    warningCount: 0,
    attachmentCount: 0,
    flattenedTextRejected: false,
    errors,
    warnings: [],
    nonEmptyTextNodeCount: 0,
  }, []);
}

function metadataFieldEmbedsPayload(metadata: Record<string, unknown>): boolean {
  return ['warnings', 'attachments', 'annotations', 'tables', 'cells', 'rows', 'subparagraphs']
    .some((field) => field in metadata && field !== 'structure_profile');
}

function recordEmbeddedPayloadWarning(
  report: MutableStructureProfileValidation,
  metadata: Record<string, unknown> | undefined,
): void {
  if (metadata && metadataFieldEmbedsPayload(metadata)) {
    pushUnique(report.warnings, 'fields_embedded_in_metadata');
  }
}

function validateAnnotations(
  value: unknown,
  report: MutableStructureProfileValidation,
  path: string,
): void {
  if (!Array.isArray(value)) {
    pushUnique(report.errors, `${path}.annotations_array_required`);
    return;
  }
  report.annotationCount += value.length;
  for (const [index, annotation] of value.entries()) {
    if (!isRecord(annotation)) {
      pushUnique(report.errors, `${path}.annotations.${index}_object_required`);
      continue;
    }
    if (typeof annotation.type !== 'string') {
      pushUnique(report.errors, `${path}.annotations.${index}.type_required`);
    }
    if (annotation.metadata !== undefined && !isRecord(annotation.metadata)) {
      pushUnique(report.errors, `${path}.annotations.${index}.metadata_object_required`);
    }
  }
}

function validateTreeNode(
  value: unknown,
  report: MutableStructureProfileValidation,
  path: string,
): void {
  if (!isRecord(value)) {
    pushUnique(report.errors, `${path}_object_required`);
    return;
  }
  report.treeNodeCount += 1;
  if (typeof value.node_id !== 'string' || !value.node_id.trim()) pushUnique(report.errors, `${path}.node_id_required`);
  if (typeof value.text !== 'string') {
    pushUnique(report.errors, `${path}.text_required`);
  } else if (value.text.trim()) {
    report.nonEmptyTextNodeCount += 1;
  }
  validateAnnotations(value.annotations, report, path);
  if (!isRecord(value.metadata)) {
    pushUnique(report.errors, `${path}.metadata_object_required`);
  } else {
    report.metadataFieldCount += Object.keys(value.metadata).length;
    if (typeof value.metadata.paragraph_type !== 'string') pushUnique(report.errors, `${path}.metadata.paragraph_type_required`);
    recordEmbeddedPayloadWarning(report, value.metadata);
  }
  if (!Array.isArray(value.subparagraphs)) {
    pushUnique(report.errors, `${path}.subparagraphs_array_required`);
    return;
  }
  for (const [index, child] of value.subparagraphs.entries()) {
    validateTreeNode(child, report, `${path}.subparagraphs.${index}`);
  }
}

function validateTables(
  value: unknown,
  report: MutableStructureProfileValidation,
): void {
  if (!Array.isArray(value)) {
    pushUnique(report.errors, 'content.tables_array_required');
    return;
  }
  report.tableCount = value.length;
  for (const [tableIndex, table] of value.entries()) {
    const tablePath = `content.tables.${tableIndex}`;
    if (!isRecord(table)) {
      pushUnique(report.errors, `${tablePath}_object_required`);
      continue;
    }
    if (typeof table.table_id !== 'string' || !table.table_id.trim()) pushUnique(report.errors, `${tablePath}.table_id_required`);
    if (!isRecord(table.metadata)) {
      pushUnique(report.errors, `${tablePath}.metadata_object_required`);
    } else {
      report.metadataFieldCount += Object.keys(table.metadata).length;
      recordEmbeddedPayloadWarning(report, table.metadata);
    }
    if (!Array.isArray(table.rows)) {
      pushUnique(report.errors, `${tablePath}.rows_array_required`);
      continue;
    }
    for (const [rowIndex, row] of table.rows.entries()) {
      if (!Array.isArray(row)) {
        pushUnique(report.errors, `${tablePath}.rows.${rowIndex}_array_required`);
        continue;
      }
      for (const [cellIndex, cell] of row.entries()) {
        const cellPath = `${tablePath}.rows.${rowIndex}.${cellIndex}`;
        if (!isRecord(cell)) {
          pushUnique(report.errors, `${cellPath}_object_required`);
          continue;
        }
        report.cellCount += 1;
        if (typeof cell.cell_id !== 'string' || !cell.cell_id.trim()) pushUnique(report.errors, `${cellPath}.cell_id_required`);
        if (typeof cell.row !== 'number' || !Number.isFinite(cell.row)) pushUnique(report.errors, `${cellPath}.row_number_required`);
        if (typeof cell.column !== 'number' || !Number.isFinite(cell.column)) pushUnique(report.errors, `${cellPath}.column_number_required`);
        if (typeof cell.text !== 'string') pushUnique(report.errors, `${cellPath}.text_required`);
        if (typeof cell.rowspan !== 'number' || !Number.isFinite(cell.rowspan)) pushUnique(report.errors, `${cellPath}.rowspan_number_required`);
        if (typeof cell.colspan !== 'number' || !Number.isFinite(cell.colspan)) pushUnique(report.errors, `${cellPath}.colspan_number_required`);
        if (!isRecord(cell.metadata)) {
          pushUnique(report.errors, `${cellPath}.metadata_object_required`);
        } else {
          report.metadataFieldCount += Object.keys(cell.metadata).length;
          recordEmbeddedPayloadWarning(report, cell.metadata);
        }
      }
    }
  }
}

function capabilitiesFromInput(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = isRecord(input.metadata) ? input.metadata : undefined;
  const extraData = isRecord(metadata?.extra_data) ? metadata.extra_data : undefined;
  return isRecord(extraData?.capabilities) ? extraData.capabilities : undefined;
}

function finalizeRelayParsedDocument(parsed: RelayParsedDocument): RelayParsedDocument {
  const firstReport = validateRelayParsedDocumentStructureProfile(parsed);
  const warnings = dedupeParserWarnings([...parsed.warnings, ...structureWarningsForReport(firstReport)]);
  const storedReport = finalizeStructureProfileReport({
    schemaVersion: firstReport.schemaVersion,
    profile: firstReport.profile,
    treeNodeCount: firstReport.treeNodeCount,
    tableCount: firstReport.tableCount,
    cellCount: firstReport.cellCount,
    annotationCount: firstReport.annotationCount,
    metadataFieldCount: firstReport.metadataFieldCount,
    warningCount: warnings.length,
    attachmentCount: firstReport.attachmentCount,
    flattenedTextRejected: firstReport.flattenedTextRejected,
    errors: firstReport.errors,
    warnings: firstReport.warnings,
    nonEmptyTextNodeCount: 0,
  }, warnings);
  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      extra_data: {
        ...parsed.metadata.extra_data,
        structure_profile: storedReport,
      },
    },
    warnings,
    parser_confidence: storedReport.status === 'invalid'
      ? 'low'
      : storedReport.status === 'degraded' && parsed.parser_confidence === 'high'
        ? 'medium'
        : parsed.parser_confidence,
  };
}

export function validateRelayParsedDocumentStructureProfile(
  input: unknown,
): RelayParsedDocumentStructureProfileValidation {
  if (!isRecord(input)) return emptyStructureProfileReport('unknown', ['parsed_document_object_required']);
  const profile = parserProfileFromInput(input);
  const parserWarnings = parserWarningsFromInput(input);
  const report: MutableStructureProfileValidation = {
    schemaVersion: RELAY_PARSED_DOCUMENT_STRUCTURE_PROFILE_CONTRACT,
    profile,
    treeNodeCount: 0,
    tableCount: 0,
    cellCount: 0,
    annotationCount: 0,
    metadataFieldCount: 0,
    warningCount: parserWarnings.length,
    attachmentCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
    flattenedTextRejected: false,
    errors: [],
    warnings: [],
    nonEmptyTextNodeCount: 0,
  };

  if (!VALID_PARSER_PROFILES.has(String(profile))) pushUnique(report.errors, 'parser_profile_invalid');
  if (!isRecord(input.metadata)) {
    pushUnique(report.errors, 'metadata_object_required');
  } else {
    report.metadataFieldCount += Object.keys(input.metadata).length;
    if (isRecord(input.metadata.extra_data)) {
      report.metadataFieldCount += Object.keys(input.metadata.extra_data).length;
      recordEmbeddedPayloadWarning(report, input.metadata.extra_data);
    }
    recordEmbeddedPayloadWarning(report, input.metadata);
  }

  const capabilities = capabilitiesFromInput(input);
  if (!capabilities) pushUnique(report.warnings, 'reader_capabilities_missing');

  const content = isRecord(input.content) ? input.content : undefined;
  if (!content) {
    pushUnique(report.errors, 'content_object_required');
  } else {
    if ('warnings' in content || 'attachments' in content) pushUnique(report.warnings, 'fields_embedded_in_metadata');
    if (typeof content.text === 'string' && content.text.trim()) {
      report.flattenedTextRejected = true;
      pushUnique(report.errors, 'content_flattened_text_field_not_allowed');
    }
    validateTreeNode(content.structure, report, 'content.structure');
    validateTables(content.tables, report);
  }

  const root = content && isRecord(content.structure) ? content.structure : undefined;
  const rootText = typeof root?.text === 'string' ? root.text.trim() : '';
  const rootChildren = Array.isArray(root?.subparagraphs) ? root.subparagraphs.length : 0;
  if (rootText && rootChildren === 0 && report.tableCount === 0) {
    report.flattenedTextRejected = true;
    pushUnique(report.errors, 'flattened_text_without_tree_nodes');
  }

  const lowConfidenceEmpty = input.parser_confidence === 'low' &&
    !rootText &&
    report.nonEmptyTextNodeCount === 0 &&
    report.cellCount === 0;
  const hasTextEvidence = Boolean(rootText || report.nonEmptyTextNodeCount > 0);
  if (
    ['technical_document', 'filing_or_disclosure', 'audit_material', 'contract'].includes(String(profile)) &&
    hasTextEvidence &&
    report.treeNodeCount <= 1
  ) {
    pushUnique(report.errors, 'document_profile_requires_tree_nodes');
  }
  if (
    profile === 'spreadsheet' &&
    capabilities?.tables === true &&
    report.cellCount === 0 &&
    hasTextEvidence &&
    !lowConfidenceEmpty
  ) {
    pushUnique(report.errors, 'spreadsheet_profile_requires_table_cells');
  }
  if (
    profile === 'financial_workpaper' &&
    capabilities?.tables === true &&
    report.cellCount === 0 &&
    hasTextEvidence &&
    !lowConfidenceEmpty
  ) {
    pushUnique(report.warnings, 'financial_workpaper_table_cells_unavailable');
  }
  if (capabilities?.textLayerOnly === true && capabilities.pageAnchors !== true && hasTextEvidence) {
    pushUnique(report.warnings, 'profile_page_anchors_unavailable');
  }
  if (capabilities?.annotations === false && report.annotationCount > 0) {
    pushUnique(report.warnings, 'annotations_present_for_unsupported_reader');
  }
  if (capabilities?.attachments === false && report.attachmentCount > 0) {
    pushUnique(report.warnings, 'attachments_present_for_unsupported_reader');
  }

  return finalizeStructureProfileReport(report, parserWarnings);
}

export function validateRelayParsedDocument(
  input: unknown,
): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['parsed document must be an object'] };
  if (input.schemaVersion !== RELAY_PARSED_DOCUMENT_IR_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_PARSED_DOCUMENT_IR_CONTRACT}`);
  }
  if (input.version !== RELAY_PARSED_DOCUMENT_IR_VERSION) errors.push(`version must be ${RELAY_PARSED_DOCUMENT_IR_VERSION}`);
  if (!isRecord(input.parser)) {
    errors.push('parser is required');
  } else {
    if (typeof input.parser.name !== 'string') errors.push('parser.name is required');
    if (typeof input.parser.version !== 'string') errors.push('parser.version is required');
    if (typeof input.parser.profile !== 'string') errors.push('parser.profile is required');
    if (input.parser.capabilityRegistryVersion !== RELAY_READER_CAPABILITY_REGISTRY_CONTRACT) {
      errors.push(`parser.capabilityRegistryVersion must be ${RELAY_READER_CAPABILITY_REGISTRY_CONTRACT}`);
    }
    if (input.parser.patternSetVersion !== RELAY_STRUCTURE_PATTERN_VERSION) {
      errors.push(`parser.patternSetVersion must be ${RELAY_STRUCTURE_PATTERN_VERSION}`);
    }
  }
  if (typeof input.source_file_id !== 'string') errors.push('source_file_id is required');
  if (typeof input.source_metadata_version !== 'string') errors.push('source_metadata_version is required');
  if (!isRecord(input.metadata)) {
    errors.push('metadata is required');
  } else if (!isRecord(input.metadata.extra_data)) {
    errors.push('metadata.extra_data is required');
  }
  if (!isRecord(input.content)) {
    errors.push('content is required');
  } else {
    if (!isRecord(input.content.structure)) errors.push('content.structure is required');
    if (!Array.isArray(input.content.tables)) errors.push('content.tables must be an array');
  }
  if (!Array.isArray(input.warnings)) {
    errors.push('warnings must be an array');
  } else {
    input.warnings.forEach((warning, index) => {
      if (!isRecord(warning)) {
        errors.push(`warnings.${index} must be an object`);
        return;
      }
      if (typeof warning.code !== 'string') errors.push(`warnings.${index}.code is required`);
      if (typeof warning.message !== 'string') errors.push(`warnings.${index}.message is required`);
      if (warning.severity !== 'info' && warning.severity !== 'warning' && warning.severity !== 'error') {
        errors.push(`warnings.${index}.severity is invalid`);
      }
      if (warning.stage !== 'reader' && warning.stage !== 'normalizer' && warning.stage !== 'structure' && warning.stage !== 'attachment') {
        errors.push(`warnings.${index}.stage is invalid`);
      }
    });
  }
  if (!Array.isArray(input.attachments)) errors.push('attachments must be an array');
  if (errors.length === 0) {
    const structureProfile = validateRelayParsedDocumentStructureProfile(input);
    if (structureProfile.status === 'invalid') {
      errors.push(...structureProfile.errors.map((error) => `structure_profile.${error}`));
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
