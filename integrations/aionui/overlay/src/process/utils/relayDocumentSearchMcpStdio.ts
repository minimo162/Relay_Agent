/**
 * Standalone stdio MCP server for Relay Document Search.
 *
 * AionUi owns the conversation, approvals, previews, and history. This server
 * exposes the single high-level Relay document-search tool to aionrs so the
 * model does not need to compose low-level glob/grep/read chains as the first
 * step.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
  RELAY_DOCUMENT_SEARCH_TOOL_NAME,
} from './relayDocumentSearchContract';
import {
  handleRelayDocumentSearchToolCall,
  RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT,
  relayDocumentSearchBridgeToolDefinition,
} from './relayDocumentSearchBridge';
import { startRelayDocumentSearchSyncProducerFromEnvironment } from './relayDocumentSearchSyncProducer';

const relayWorkspaceRoot = process.env.RELAY_DOCUMENT_SEARCH_WORKSPACE || '';
const relayConversationId = process.env.RELAY_DOCUMENT_SEARCH_CONVERSATION_ID || undefined;
const relayMetadataCacheDir = process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR || undefined;
const relayFilenameIndexDir = process.env.RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR || undefined;
const relayUserMemoryDir = process.env.RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR || undefined;
const relaySyncJournalDir = process.env.RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR || undefined;
const relaySyncProducerRequested = process.env.RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER === '1';

function normalizeRoots(roots: string[] | undefined): string[] {
  if (roots && roots.length > 0) return roots;
  return relayWorkspaceRoot ? [relayWorkspaceRoot] : [];
}

const server = new McpServer(
  {
    name: 'relay-document-search',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.tool(
  RELAY_DOCUMENT_SEARCH_TOOL_NAME,
  `Find local workspace documents through Relay Agent. Use this as the first tool for document search, folder search, local file discovery, Office/PDF lookup, and evidence-backed summaries. Returns ${RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT} with raw ${RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT}, structured result cards, continuation, selection, and secondary Copilot prose metadata.`,
  {
    query: z.string().min(1).max(2000).describe('The user request in their own words.'),
    roots: z
      .array(z.string().min(1))
      .max(16)
      .optional()
      .describe('Workspace roots to search. Omit to use the current AionUi workspace.'),
    intent: z
      .enum(['find_files', 'answer_with_evidence', 'summarize_with_evidence', 'inspect_file', 'similar_documents'])
      .optional()
      .describe('Document workflow intent.'),
    thoroughness: z.enum(['quick', 'thorough']).optional().describe('Search thoroughness.'),
    fileTypes: z
      .array(z.enum(['any', 'txt', 'md', 'csv', 'docx', 'xlsx', 'xlsm', 'pptx', 'pdf']))
      .optional()
      .describe('Optional file-type filters.'),
    maxResults: z.number().int().min(1).max(300).optional().describe('Maximum candidate count.'),
    evidence: z.enum(['none', 'candidate', 'required']).optional().describe('Evidence requirement.'),
  },
  async (args) => {
    const execution = await handleRelayDocumentSearchToolCall(
      {
        id: `relay-document-search-${Date.now().toString(36)}`,
        name: RELAY_DOCUMENT_SEARCH_TOOL_NAME,
        parameters: {
          ...args,
          roots: normalizeRoots(args.roots),
        },
      },
      {
        advertisedTools: [relayDocumentSearchBridgeToolDefinition],
        aionuiConversationId: relayConversationId,
        useMetadataCache: true,
        metadataCacheDir: relayMetadataCacheDir,
        useFilenameIndex: true,
        filenameIndexDir: relayFilenameIndexDir,
        useUserMemory: true,
        userMemoryDir: relayUserMemoryDir,
        useSyncJournal: true,
        syncJournalDir: relaySyncJournalDir,
        source: 'aionui-skill',
      },
    );

    return {
      content: [{ type: 'text' as const, text: execution.aionuiContent }],
      isError: !execution.ok,
    };
  },
);

async function main(): Promise<void> {
  const syncProducer = relaySyncProducerRequested
    ? await startRelayDocumentSearchSyncProducerFromEnvironment({
      roots: normalizeRoots(undefined),
      syncJournalDir: relaySyncJournalDir,
    })
    : undefined;
  const stopSyncProducer = () => {
    void syncProducer?.stop();
  };
  process.once('SIGINT', stopSyncProducer);
  process.once('SIGTERM', stopSyncProducer);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`[relay-document-search-mcp-stdio] Fatal error: ${error}\n`);
  process.exit(1);
});
