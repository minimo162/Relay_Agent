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

const relayWorkspaceRoot = process.env.RELAY_DOCUMENT_SEARCH_WORKSPACE || '';
const relayConversationId = process.env.RELAY_DOCUMENT_SEARCH_CONVERSATION_ID || undefined;
const relayMetadataCacheDir = process.env.RELAY_DOCUMENT_SEARCH_METADATA_CACHE_DIR || undefined;
const relayFilenameIndexDir = process.env.RELAY_DOCUMENT_SEARCH_FILENAME_INDEX_DIR || undefined;
const relayIndexDbPath = process.env.RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH || undefined;
const relayParsedDocumentCacheDir = process.env.RELAY_PARSED_DOCUMENT_CACHE_DIR || undefined;
const relayDerivedContentIndexDir = process.env.RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_DIR || undefined;
const relayIndexCoordinatorDir = process.env.RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR_DIR || undefined;
const relayUserMemoryDir = process.env.RELAY_DOCUMENT_SEARCH_USER_MEMORY_DIR || undefined;
const relaySyncJournalDir = process.env.RELAY_DOCUMENT_SEARCH_SYNC_JOURNAL_DIR || undefined;
const relayFailureRegistryDir = process.env.RELAY_DOCUMENT_SEARCH_FAILURE_REGISTRY_DIR || undefined;
const relayJobStoreDir = process.env.RELAY_DOCUMENT_SEARCH_JOB_STORE_DIR || undefined;
const relaySyncProducerRequested = process.env.RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER === '1';

const RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT = 'RelayDocumentSearchAionUiResultFlow.v1' as const;

type RelayDocumentSearchBridgeModule = typeof import('./relayDocumentSearchBridge');
type RelayDocumentSearchSyncProducerModule = typeof import('./relayDocumentSearchSyncProducer');
type RelayDocumentSearchSyncProducer = Awaited<
  ReturnType<RelayDocumentSearchSyncProducerModule['startRelayDocumentSearchSyncProducerFromEnvironment']>
>;

function normalizeRoots(roots: string[] | undefined): string[] {
  if (roots && roots.length > 0) return roots;
  return relayWorkspaceRoot ? [relayWorkspaceRoot] : [];
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handlerFailureContent(error: unknown): string {
  const message = messageFromError(error);
  return JSON.stringify(
    {
      schemaVersion: RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT,
      toolName: RELAY_DOCUMENT_SEARCH_TOOL_NAME,
      resultContract: RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT,
      status: 'failed',
      error: {
        code: 'relay_document_search_mcp_handler_failed',
        message,
      },
    },
    null,
    2,
  );
}

async function loadBridgeModule(): Promise<RelayDocumentSearchBridgeModule> {
  return import('./relayDocumentSearchBridge');
}

async function startSyncProducerInBackground(): Promise<RelayDocumentSearchSyncProducer | undefined> {
  if (!relaySyncProducerRequested) return undefined;
  try {
    const { startRelayDocumentSearchSyncProducerFromEnvironment } = await import('./relayDocumentSearchSyncProducer');
    return await startRelayDocumentSearchSyncProducerFromEnvironment({
      roots: normalizeRoots(undefined),
      syncJournalDir: relaySyncJournalDir,
    });
  } catch (error) {
    process.stderr.write(
      `[relay-document-search-mcp-stdio] Sync producer disabled after startup: ${messageFromError(error)}\n`,
    );
    return undefined;
  }
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
  `Find local workspace documents through Relay Agent. Use this as the first tool for document search, folder search, local file discovery, Office/text lookup, PDF filename discovery, and evidence-backed summaries. Returns ${RELAY_DOCUMENT_SEARCH_AIONUI_RESULT_FLOW_CONTRACT} with a compact result summary, structured result cards, continuation, selection, and secondary Copilot prose metadata. The full raw ${RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT} stays inside Relay diagnostics instead of being returned to chat.`,
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
    queryPlanHints: z
      .object({
        schemaVersion: z.enum(['RelayDocumentSearchCopilotQueryPlan.v1', 'RelayDocumentSearchCopilotQueryPlan.v3']),
        rawQuery: z.string().min(1).max(2000),
        intent: z.enum(['find_files', 'answer_with_evidence', 'summarize_with_evidence', 'inspect_file', 'similar_documents']),
        evidence: z.enum(['none', 'candidate', 'required']),
        thoroughness: z.enum(['quick', 'thorough']),
        coreConcepts: z.array(z.object({
          label: z.string().min(1).max(80),
          directTerms: z.array(z.string().min(1).max(80)).max(24),
          requiredTermGroups: z.array(z.array(z.string().min(1).max(80)).max(16)).max(8),
          entityRiskTerms: z.array(z.string().min(1).max(80)).max(24),
        })).max(8).optional(),
        expandedTerms: z.array(z.string().min(1).max(80)).max(40),
        supportTerms: z.array(z.string().min(1).max(80)).max(40),
        demoteTerms: z.array(z.string().min(1).max(80)).max(40),
        entityRiskTerms: z.array(z.string().min(1).max(80)).max(40).optional(),
        fileTypeHints: z.array(z.enum(['any', 'txt', 'md', 'csv', 'docx', 'xlsx', 'xlsm', 'pptx', 'pdf'])).max(10),
        timeScopeIntent: z
          .enum(['latest_first', 'historical_examples', 'balanced', 'explicit_period', 'unknown'])
          .optional(),
        summary: z.string().max(280).optional(),
      })
      .optional()
      .describe('Validated Copilot query-plan hints generated from the natural-language request.'),
  },
  async (args) => {
    try {
      const { handleRelayDocumentSearchToolCall, relayDocumentSearchBridgeToolDefinition } = await loadBridgeModule();
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
          useIndexDb: true,
          indexDbPath: relayIndexDbPath,
          indexDbPrimaryMode: 'primary',
          useParsedDocumentCache: true,
          parsedDocumentCacheDir: relayParsedDocumentCacheDir,
          useDerivedContentIndexCache: true,
          derivedContentIndexDir: relayDerivedContentIndexDir,
          useIndexCoordinator: true,
          indexCoordinatorDir: relayIndexCoordinatorDir,
          useFailureRegistry: true,
          failureRegistryDir: relayFailureRegistryDir,
          useJobStore: true,
          jobStoreDir: relayJobStoreDir,
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
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: handlerFailureContent(error) }],
        isError: true,
      };
    }
  },
);

async function main(): Promise<void> {
  let syncProducer: RelayDocumentSearchSyncProducer | undefined;
  const stopSyncProducer = () => {
    void syncProducer?.stop();
  };
  process.once('SIGINT', stopSyncProducer);
  process.once('SIGTERM', stopSyncProducer);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  void startSyncProducerInBackground().then((producer) => {
    syncProducer = producer;
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`[relay-document-search-mcp-stdio] Fatal error: ${error}\n`);
  process.exit(1);
});
