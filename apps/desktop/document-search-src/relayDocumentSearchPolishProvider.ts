import { existsSync, readFileSync } from 'fs';

import type { RelayDocumentSearchPolishRequestV1 } from './relayDocumentSearchPolishRequest';

export const RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_CONTRACT =
  'RelayDocumentSearchPolishProvider.v1' as const;

const RELAY_SEED_FILE_ENV = 'RELAY_AIONUI_PROVIDER_SEED_FILE';
const DEFAULT_RELAY_MODEL_ID = 'm365-copilot';
const DEFAULT_PROVIDER_TIMEOUT_MS = 45000;

export type RelayDocumentSearchPolishProviderState =
  | 'not_requested'
  | 'not_allowed'
  | 'candidate_received'
  | 'failed';

export type RelayDocumentSearchPolishProviderReason =
  | 'disabled'
  | 'request_not_ready'
  | 'missing_provider_config'
  | 'missing_fetch'
  | 'provider_http_error'
  | 'provider_failed'
  | 'invalid_provider_response'
  | 'candidate_received';

export type RelayDocumentSearchPolishProviderReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_CONTRACT;
  state: RelayDocumentSearchPolishProviderState;
  reason: RelayDocumentSearchPolishProviderReason;
  generated_at: string;
  prompt_template_id: RelayDocumentSearchPolishRequestV1['prompt_template_id'];
  expected_output_schema: RelayDocumentSearchPolishRequestV1['expected_output_schema'];
  evidence_pack_id: string;
  local_draft_id: string;
  provider_kind?: 'callback' | 'openai_compatible';
  model?: string;
  endpoint_origin?: string;
  copilot_request_id?: string;
  copilot_turn_id?: string;
  elapsed_ms?: number;
  prompt_character_count: number;
  response_character_count?: number;
  candidate_received: boolean;
  local_search_blocked: false;
  local_draft_blocked: false;
  preview_open_blocked: false;
  warnings: Array<{ code: string; message: string }>;
};

export type RelayDocumentSearchPolishProviderFetchResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text(): Promise<string>;
};

export type RelayDocumentSearchPolishProviderFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<RelayDocumentSearchPolishProviderFetchResponse>;

export type RelayDocumentSearchPolishProviderCallbackInput = {
  polishRequest: RelayDocumentSearchPolishRequestV1;
  prompt: string;
  model: string;
  copilotRequestId: string;
  copilotSessionId: string;
};

export type RelayDocumentSearchPolishProviderCallbackResult =
  | unknown
  | {
      candidate?: unknown;
      rawText?: string;
      copilotRequestId?: string;
      copilotTurnId?: string;
      responseCharacterCount?: number;
    };

export type RelayDocumentSearchPolishProviderCallback = (
  input: RelayDocumentSearchPolishProviderCallbackInput,
) => Promise<RelayDocumentSearchPolishProviderCallbackResult>;

export type RelayDocumentSearchPolishProviderInvokeInput = {
  polishRequest: RelayDocumentSearchPolishRequestV1;
  enabled?: boolean;
  provider?: RelayDocumentSearchPolishProviderCallback;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  seedFile?: string;
  timeoutMs?: number;
  fetchImpl?: RelayDocumentSearchPolishProviderFetch;
  generatedAt?: string;
  forceFreshChat?: boolean;
};

export type RelayDocumentSearchPolishProviderInvokeResult = {
  report: RelayDocumentSearchPolishProviderReport;
  candidate?: unknown;
  copilotRequestId?: string;
  copilotTurnId?: string;
};

type RelayProviderSeed = {
  provider?: {
    baseUrl?: string;
    apiKey?: string;
    useModel?: string;
    model?: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function providerEnabledFromEnv(): boolean {
  return envFlag('RELAY_DOCUMENT_SEARCH_COPILOT_POLISH') ||
    envFlag('RELAY_WORKSPACE_SEARCH_COPILOT_POLISH');
}

function readSeed(seedFile: string | undefined): RelayProviderSeed | null {
  const file = seedFile || process.env[RELAY_SEED_FILE_ENV]?.trim();
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RelayProviderSeed;
  } catch {
    return null;
  }
}

function configuredProvider(input: RelayDocumentSearchPolishProviderInvokeInput): {
  baseUrl?: string;
  apiKey?: string;
  model: string;
} {
  const seed = readSeed(input.seedFile);
  const baseUrl = input.baseUrl ||
    process.env.RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_BASE_URL ||
    seed?.provider?.baseUrl;
  const apiKey = input.apiKey ||
    process.env.RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_API_KEY ||
    seed?.provider?.apiKey;
  const model = input.model ||
    process.env.RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_MODEL ||
    seed?.provider?.useModel ||
    seed?.provider?.model?.[0] ||
    DEFAULT_RELAY_MODEL_ID;
  return { baseUrl, apiKey, model };
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  if (/\/v1\/chat\/completions$/u.test(trimmed)) return trimmed;
  if (/\/v1$/u.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function endpointOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function baseReport(
  input: RelayDocumentSearchPolishProviderInvokeInput,
  state: RelayDocumentSearchPolishProviderState,
  reason: RelayDocumentSearchPolishProviderReason,
  generatedAt: string,
): RelayDocumentSearchPolishProviderReport {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_CONTRACT,
    state,
    reason,
    generated_at: generatedAt,
    prompt_template_id: input.polishRequest.prompt_template_id,
    expected_output_schema: input.polishRequest.expected_output_schema,
    evidence_pack_id: input.polishRequest.evidence_pack_id,
    local_draft_id: input.polishRequest.local_draft_id,
    prompt_character_count: input.polishRequest.prompt?.length ?? 0,
    candidate_received: state === 'candidate_received',
    local_search_blocked: false,
    local_draft_blocked: false,
    preview_open_blocked: false,
    warnings: [],
  };
}

function requestIdFor(polishRequest: RelayDocumentSearchPolishRequestV1): string {
  return polishRequest.correlation.copilotRequestId ||
    `relay-polish-${stableId(`${polishRequest.evidence_pack_id}:${polishRequest.local_draft_id}`)}`;
}

function sessionIdFor(polishRequest: RelayDocumentSearchPolishRequestV1): string {
  return polishRequest.correlation.copilotSessionId ||
    `relay-document-search-polish-${stableId(polishRequest.evidence_pack_id)}`;
}

function strictPolishSystemPrompt(expectedSchema: string): string {
  return [
    'You are polishing a Relay Agent local document-search answer.',
    `Return only one JSON object using schemaVersion "${expectedSchema}".`,
    'Do not call tools. Do not browse. Do not add facts.',
    'Every factual statement must keep the supplied citation ids.',
  ].join('\n');
}

function providerRequestBody(
  input: RelayDocumentSearchPolishProviderInvokeInput,
  model: string,
  copilotRequestId: string,
  copilotSessionId: string,
): Record<string, unknown> {
  return {
    model,
    stream: false,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: strictPolishSystemPrompt(input.polishRequest.expected_output_schema),
      },
      {
        role: 'user',
        content: input.polishRequest.prompt,
      },
    ],
    relay_session_id: copilotSessionId,
    relay_request_id: copilotRequestId,
    relay_stage_label: 'document_search_polish',
    relay_force_fresh_chat: input.forceFreshChat ?? true,
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function contentFromOpenAiResponse(body: unknown): string | undefined {
  if (isRecord(body) && body.schemaVersion === 'RelayDocumentSearchPolishedAnswer.v1') {
    return JSON.stringify(body);
  }
  const choice = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(message)) return undefined;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (isRecord(content)) return JSON.stringify(content);
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => isRecord(part) && typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
    return joined || undefined;
  }
  return undefined;
}

function normalizedCallbackResult(
  result: RelayDocumentSearchPolishProviderCallbackResult,
): {
  candidate?: unknown;
  responseText?: string;
  copilotRequestId?: string;
  copilotTurnId?: string;
  responseCharacterCount?: number;
} {
  if (!isRecord(result)) return { candidate: result };
  const hasWrapperShape =
    Object.prototype.hasOwnProperty.call(result, 'candidate') ||
    Object.prototype.hasOwnProperty.call(result, 'rawText') ||
    Object.prototype.hasOwnProperty.call(result, 'copilotRequestId') ||
    Object.prototype.hasOwnProperty.call(result, 'copilotTurnId');
  if (!hasWrapperShape) return { candidate: result };
  const responseText = asString(result.rawText);
  const parsedCandidate = responseText ? parseJsonObject(responseText) : undefined;
  const out: ReturnType<typeof normalizedCallbackResult> = {
    candidate: result.candidate ?? parsedCandidate,
  };
  if (responseText) out.responseText = responseText;
  if (asString(result.copilotRequestId)) out.copilotRequestId = asString(result.copilotRequestId);
  if (asString(result.copilotTurnId)) out.copilotTurnId = asString(result.copilotTurnId);
  if (typeof result.responseCharacterCount === 'number') out.responseCharacterCount = result.responseCharacterCount;
  return out;
}

async function invokeCallbackProvider(
  input: RelayDocumentSearchPolishProviderInvokeInput,
  generatedAt: string,
  model: string,
): Promise<RelayDocumentSearchPolishProviderInvokeResult> {
  const started = Date.now();
  const copilotRequestId = requestIdFor(input.polishRequest);
  const copilotSessionId = sessionIdFor(input.polishRequest);
  const report = baseReport(input, 'failed', 'provider_failed', generatedAt);
  report.provider_kind = 'callback';
  report.model = model;
  report.copilot_request_id = copilotRequestId;
  try {
    const raw = await input.provider?.({
      polishRequest: input.polishRequest,
      prompt: input.polishRequest.prompt ?? '',
      model,
      copilotRequestId,
      copilotSessionId,
    });
    const normalized = normalizedCallbackResult(raw);
    report.elapsed_ms = Date.now() - started;
    report.response_character_count =
      normalized.responseCharacterCount ?? normalized.responseText?.length ?? 0;
    if (normalized.copilotRequestId) report.copilot_request_id = normalized.copilotRequestId;
    if (normalized.copilotTurnId) report.copilot_turn_id = normalized.copilotTurnId;
    if (normalized.candidate === undefined) {
      report.state = 'failed';
      report.reason = 'invalid_provider_response';
      report.candidate_received = false;
      report.warnings.push({
        code: 'invalid_provider_response',
        message: 'Copilot polish provider did not return a JSON candidate.',
      });
      return { report, copilotRequestId: report.copilot_request_id, copilotTurnId: report.copilot_turn_id };
    }
    report.state = 'candidate_received';
    report.reason = 'candidate_received';
    report.candidate_received = true;
    return {
      report,
      candidate: normalized.candidate,
      copilotRequestId: report.copilot_request_id,
      copilotTurnId: report.copilot_turn_id,
    };
  } catch (error) {
    report.elapsed_ms = Date.now() - started;
    report.warnings.push({
      code: 'provider_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return { report, copilotRequestId: report.copilot_request_id };
  }
}

async function invokeOpenAiProvider(
  input: RelayDocumentSearchPolishProviderInvokeInput,
  generatedAt: string,
  config: { baseUrl: string; apiKey: string; model: string },
): Promise<RelayDocumentSearchPolishProviderInvokeResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const report = baseReport(input, 'failed', 'provider_failed', generatedAt);
  report.provider_kind = 'openai_compatible';
  report.model = config.model;
  const url = chatCompletionsUrl(config.baseUrl);
  const origin = endpointOrigin(url);
  if (origin) report.endpoint_origin = origin;
  if (!fetchImpl) {
    report.reason = 'missing_fetch';
    report.warnings.push({ code: 'missing_fetch', message: 'No fetch implementation is available.' });
    return { report };
  }

  const copilotRequestId = requestIdFor(input.polishRequest);
  const copilotSessionId = sessionIdFor(input.polishRequest);
  report.copilot_request_id = copilotRequestId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(providerRequestBody(input, config.model, copilotRequestId, copilotSessionId)),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    report.elapsed_ms = Date.now() - started;
    report.response_character_count = bodyText.length;
    if (response.ok === false || (response.status !== undefined && response.status >= 400)) {
      report.reason = 'provider_http_error';
      report.warnings.push({
        code: 'provider_http_error',
        message: `Copilot polish provider returned HTTP ${response.status ?? 'error'}.`,
      });
      return { report, copilotRequestId };
    }
    const body = parseJsonObject(bodyText);
    const content = contentFromOpenAiResponse(body);
    const candidate = typeof content === 'string' ? parseJsonObject(content) : undefined;
    if (candidate === undefined) {
      report.reason = 'invalid_provider_response';
      report.warnings.push({
        code: 'invalid_provider_response',
        message: 'Copilot polish provider response did not contain a JSON polished-answer candidate.',
      });
      return { report, copilotRequestId };
    }
    report.state = 'candidate_received';
    report.reason = 'candidate_received';
    report.candidate_received = true;
    return { report, candidate, copilotRequestId };
  } catch (error) {
    report.elapsed_ms = Date.now() - started;
    report.reason = 'provider_failed';
    report.warnings.push({
      code: 'provider_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return { report, copilotRequestId };
  } finally {
    clearTimeout(timeout);
  }
}

export async function invokeRelayDocumentSearchPolishProvider(
  input: RelayDocumentSearchPolishProviderInvokeInput,
): Promise<RelayDocumentSearchPolishProviderInvokeResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (input.polishRequest.status !== 'ready' || !input.polishRequest.prompt) {
    const report = baseReport(input, 'not_allowed', 'request_not_ready', generatedAt);
    report.warnings.push({
      code: 'request_not_ready',
      message: 'Polish provider was not invoked because the polish request is not ready.',
    });
    return { report };
  }

  const enabled = input.enabled === false
    ? false
    : Boolean(input.provider || input.enabled === true || providerEnabledFromEnv());
  if (!enabled) {
    return { report: baseReport(input, 'not_requested', 'disabled', generatedAt) };
  }

  const config = configuredProvider(input);
  if (input.provider) {
    return invokeCallbackProvider(input, generatedAt, config.model);
  }

  if (!config.baseUrl || !config.apiKey) {
    const report = baseReport(input, 'failed', 'missing_provider_config', generatedAt);
    report.provider_kind = 'openai_compatible';
    report.model = config.model;
    report.warnings.push({
      code: 'missing_provider_config',
      message: 'Copilot polish provider requires a base URL and API key.',
    });
    return { report };
  }
  return invokeOpenAiProvider(input, generatedAt, {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });
}

export function validateRelayDocumentSearchPolishProviderReport(
  input: unknown,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['polish provider report must be an object'] };
  if (input.schemaVersion !== RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_CONTRACT) {
    errors.push(`schemaVersion must be ${RELAY_DOCUMENT_SEARCH_POLISH_PROVIDER_CONTRACT}`);
  }
  if (!['not_requested', 'not_allowed', 'candidate_received', 'failed'].includes(String(input.state))) {
    errors.push('state is invalid');
  }
  if (typeof input.reason !== 'string' || !input.reason.trim()) errors.push('reason is required');
  if (typeof input.generated_at !== 'string' || !input.generated_at.trim()) errors.push('generated_at is required');
  if (typeof input.prompt_character_count !== 'number') errors.push('prompt_character_count must be a number');
  if (typeof input.candidate_received !== 'boolean') errors.push('candidate_received must be a boolean');
  if (input.local_search_blocked !== false) errors.push('local_search_blocked must be false');
  if (input.local_draft_blocked !== false) errors.push('local_draft_blocked must be false');
  if (input.preview_open_blocked !== false) errors.push('preview_open_blocked must be false');
  if (!Array.isArray(input.warnings)) errors.push('warnings must be an array');
  return { ok: errors.length === 0, errors };
}
