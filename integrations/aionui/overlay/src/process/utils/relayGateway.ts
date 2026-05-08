/**
 * Relay Agent gateway bootstrap for the Relay-branded AionUi shell.
 *
 * AionUi must see the Relay provider seed before initStorage() runs. This
 * module starts the bundled M365 Copilot gateway first, reads the dynamic
 * localhost port selected by the OS, writes the seed file, and points
 * RELAY_AIONUI_PROVIDER_SEED_FILE at that seed.
 */

import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const RELAY_PROVIDER_ID = 'relay-agent';
const RELAY_MODEL_ID = 'm365-copilot';
const RELAY_PROVIDER_NAME = 'Relay Agent / M365 Copilot';
const RELAY_CONTEXT_LIMIT = 128000;
const RELAY_SEED_FILE_ENV = 'RELAY_AIONUI_PROVIDER_SEED_FILE';
const DEFAULT_RELAY_EDGE_CDP_PORT = 9360;
const RELAY_DEFAULT_SKILLS = [
  'officecli-docx',
  'officecli-xlsx',
  'officecli-pptx',
  'officecli-financial-model',
  'officecli-data-dashboard',
];
const RELAY_DEFAULT_ASSISTANTS = [
  {
    id: 'word-creator',
    defaultEnabledSkills: ['officecli-docx'],
  },
  {
    id: 'excel-creator',
    defaultEnabledSkills: ['officecli-xlsx'],
  },
  {
    id: 'ppt-creator',
    defaultEnabledSkills: ['officecli-pptx'],
  },
];
const GATEWAY_FILES = [
  'copilot_server.js',
  'copilot_server.mjs',
  'copilot_dom_poll.mjs',
  'copilot_send_timing.mjs',
  'copilot_wait_dom_response.mjs',
];

type RelayGatewayStartupState = 'ready' | 'needs_attention' | 'disabled';

export type RelayGatewayStartupResult = {
  state: RelayGatewayStartupState;
  baseUrl?: string;
  seedFile?: string;
  statusFile?: string;
  message?: string;
};

let relayGatewayProcess: ChildProcess | null = null;
let relayGatewayResult: RelayGatewayStartupResult | null = null;
let quitHandlerRegistered = false;
let relayGatewayPrewarmStarted = false;

function relayDataDir(): string {
  const dir = join(app.getPath('userData'), 'relay');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function relaySeedFilePath(): string {
  return join(relayDataDir(), 'aionui-provider-seed.json');
}

function relayStatusFilePath(): string {
  return join(relayDataDir(), 'relay-gateway-status.json');
}

function relayTokenFilePath(): string {
  return join(relayDataDir(), 'provider-token');
}

function readOrCreateToken(): string {
  const envToken = process.env.RELAY_AGENT_API_KEY?.trim();
  if (envToken) return envToken;

  const filePath = relayTokenFilePath();
  if (existsSync(filePath)) {
    const existingToken = readFileSync(filePath, 'utf8').trim();
    if (existingToken) return existingToken;
  }

  const token = randomUUID();
  writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return token;
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function relayGatewayCandidates(): string[] {
  const resourcesPath = process.resourcesPath || '';
  const appPath = app.getAppPath();
  return [
    process.env.RELAY_GATEWAY_DIR || '',
    resourcesPath ? join(resourcesPath, 'relay-gateway') : '',
    appPath ? join(dirname(appPath), 'relay-gateway') : '',
    appPath ? join(appPath, 'resources', 'relay-gateway') : '',
    join(process.cwd(), 'resources', 'relay-gateway'),
    join(process.cwd(), 'apps/desktop/src-tauri/binaries'),
  ].filter(Boolean);
}

function resolveRelayGatewayDir(): string | null {
  for (const candidate of relayGatewayCandidates()) {
    const dir = resolve(candidate);
    if (!existsSync(join(dir, 'copilot_server.js'))) continue;
    const missing = GATEWAY_FILES.filter((file) => !existsSync(join(dir, file)));
    if (missing.length === 0) return dir;
  }
  return null;
}

function writeStatus(status: Record<string, unknown>): string {
  const statusFile = relayStatusFilePath();
  writeFileSync(statusFile, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...status }, null, 2)}\n`, {
    encoding: 'utf8',
  });
  return statusFile;
}

function appendGatewayLog(line: string): void {
  try {
    appendFileSync(join(relayDataDir(), 'relay-gateway.log'), line, 'utf8');
  } catch {
    // Logging must not block app startup.
  }
}

function providerBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

function aionrsBaseUrlForRelay(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

function relayReadyStatus({
  baseUrl,
  seedFile,
  cdpPort,
  gatewayDir,
  prewarm,
}: {
  baseUrl: string;
  seedFile: string;
  cdpPort: number;
  gatewayDir: string;
  prewarm?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    state: 'ready',
    baseUrl,
    seedFile,
    cdpPort,
    gatewayDir,
    ...(prewarm ? { prewarm } : {}),
  };
}

function relayDefaultModel(): { id: string; useModel: string } {
  return {
    id: RELAY_PROVIDER_ID,
    useModel: RELAY_MODEL_ID,
  };
}

function relayProviderConfig(baseUrl: string, apiKey: string): Record<string, unknown> {
  return {
    id: RELAY_PROVIDER_ID,
    platform: 'custom',
    name: RELAY_PROVIDER_NAME,
    baseUrl,
    apiKey,
    model: [RELAY_MODEL_ID],
    useModel: RELAY_MODEL_ID,
    enabled: true,
    modelEnabled: {
      [RELAY_MODEL_ID]: true,
    },
    capabilities: [
      {
        type: 'text',
        isUserSelected: true,
      },
      {
        type: 'function_calling',
        isUserSelected: true,
      },
    ],
    contextLimit: RELAY_CONTEXT_LIMIT,
  };
}

function relaySeedBundle(baseUrl: string, apiKey: string): Record<string, unknown> {
  const provider = relayProviderConfig(baseUrl, apiKey);
  const defaults = {
    'model.config': [provider],
    'aionrs.defaultModel': relayDefaultModel(),
    'gemini.defaultModel': relayDefaultModel(),
    'webui.desktop.enabled': false,
    'webui.desktop.allowRemote': false,
    'relay.advancedSurfaces.enabled': false,
    'relay.channels.enabled': false,
    'relay.providerOnboarding.enabled': false,
    'relay.remoteAccess.enabled': false,
    'skillsMarket.enabled': false,
    'system.autoPreviewOfficeFiles': true,
    'relay.defaultEnabledSkills': [...RELAY_DEFAULT_SKILLS],
    'relay.defaultAssistantPresetIds': RELAY_DEFAULT_ASSISTANTS.map((assistant) => assistant.id),
  };

  return {
    schemaVersion: 1,
    source: RELAY_PROVIDER_ID,
    provider,
    defaults,
    launch: {
      providerBaseUrl: baseUrl,
      modelRef: `${RELAY_PROVIDER_ID}/${RELAY_MODEL_ID}`,
      aionrsBaseUrl: aionrsBaseUrlForRelay(baseUrl),
      gatewayMustStartBeforeShell: true,
    },
    skills: {
      enabledByDefault: [...RELAY_DEFAULT_SKILLS],
      assistantPresets: RELAY_DEFAULT_ASSISTANTS.map((assistant) => ({
        id: assistant.id,
        defaultEnabledSkills: [...assistant.defaultEnabledSkills],
      })),
    },
  };
}

function writeRelaySeed(baseUrl: string, apiKey: string): string {
  const seedFile = relaySeedFilePath();
  writeFileSync(seedFile, `${JSON.stringify(relaySeedBundle(baseUrl, apiKey), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    chmodSync(seedFile, 0o600);
  } catch {
    // Best effort on Windows.
  }
  process.env[RELAY_SEED_FILE_ENV] = seedFile;
  return seedFile;
}

function waitForGatewayPort(portFile: string, child: ChildProcess, timeoutMs = 20000): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const stderrTail: string[] = [];
    let interval: ReturnType<typeof setInterval>;
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = (): void => {
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('error', onError);
      child.stderr?.off('data', onStderr);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const succeed = (port: number): void => {
      if (settled) return;
      cleanup();
      resolvePromise(port);
    };

    const readPort = (): void => {
      if (!existsSync(portFile)) return;
      const value = Number.parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isFinite(value) && value > 0) succeed(value);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      fail(new Error(`copilot server exited before writing a port (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    };
    const onError = (error: Error): void => {
      fail(error);
    };
    const onStderr = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      appendGatewayLog(text);
      stderrTail.push(text.trim());
      while (stderrTail.length > 20) stderrTail.shift();
    };

    child.once('exit', onExit);
    child.once('error', onError);
    child.stderr?.on('data', onStderr);

    interval = setInterval(readPort, 100);
    timeout = setTimeout(() => {
      fail(
        new Error(
          `copilot server did not report a listening port within ${timeoutMs} ms` +
            (stderrTail.length ? `; stderr: ${stderrTail.join(' | ')}` : ''),
        ),
      );
    }, timeoutMs);

    readPort();
  });
}

function registerQuitHandler(): void {
  if (quitHandlerRegistered) return;
  quitHandlerRegistered = true;
  app.on('before-quit', stopRelayGateway);
}

export function stopRelayGateway(): void {
  if (!relayGatewayProcess || relayGatewayProcess.killed) return;
  relayGatewayProcess.kill('SIGTERM');
}

async function fetchRelayPrewarm(baseUrl: string, token: string): Promise<Record<string, unknown>> {
  const timeoutMs = intEnv('RELAY_COPILOT_PREWARM_TIMEOUT_MS', 120000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${aionrsBaseUrlForRelay(baseUrl)}/prewarm`;
  try {
    const response = await fetch(url, {
      headers: {
        'X-Relay-Boot-Token': token,
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `prewarm HTTP ${response.status}` +
          (typeof body.message === 'string' ? `: ${body.message}` : ''),
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function startRelayGatewayPrewarm({
  baseUrl,
  seedFile,
  cdpPort,
  gatewayDir,
  token,
}: {
  baseUrl: string;
  seedFile: string;
  cdpPort: number;
  gatewayDir: string;
  token: string;
}): void {
  if (relayGatewayPrewarmStarted) return;
  relayGatewayPrewarmStarted = true;
  if (process.env.RELAY_AIONUI_DISABLE_COPILOT_PREWARM === '1') {
    writeStatus(
      relayReadyStatus({
        baseUrl,
        seedFile,
        cdpPort,
        gatewayDir,
        prewarm: { state: 'disabled', message: 'Copilot background prewarm disabled by environment.' },
      }),
    );
    return;
  }

  writeStatus(
    relayReadyStatus({
      baseUrl,
      seedFile,
      cdpPort,
      gatewayDir,
      prewarm: { state: 'starting', message: 'Opening Microsoft 365 Copilot in the background.' },
    }),
  );

  void fetchRelayPrewarm(baseUrl, token)
    .then((status) => {
      const connected = status.connected === true;
      const prewarmed = status.prewarmed === true;
      const loginRequired = status.loginRequired === true;
      const url = typeof status.url === 'string' ? status.url : null;
      const message =
        typeof status.error === 'string'
          ? status.error
          : loginRequired
            ? 'Microsoft 365 sign-in is required before Relay can use Copilot.'
            : prewarmed
              ? 'Microsoft 365 Copilot is ready for the first request.'
              : connected
                ? 'Microsoft 365 Copilot is open; first request may still prepare a new chat.'
                : 'Microsoft 365 Copilot did not report ready.';
      writeStatus(
        relayReadyStatus({
          baseUrl,
          seedFile,
          cdpPort,
          gatewayDir,
          prewarm: {
            state: loginRequired ? 'needs_sign_in' : prewarmed ? 'ready' : connected ? 'page_ready' : 'needs_attention',
            message,
            connected,
            prewarmed,
            loginRequired,
            ...(url ? { url } : {}),
          },
        }),
      );
      appendGatewayLog(`[RelayGateway] Copilot prewarm: ${message}\n`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeStatus(
        relayReadyStatus({
          baseUrl,
          seedFile,
          cdpPort,
          gatewayDir,
          prewarm: {
            state: 'needs_attention',
            message,
            connected: false,
            prewarmed: false,
            loginRequired: false,
          },
        }),
      );
      appendGatewayLog(`[RelayGateway] Copilot prewarm failed: ${message}\n`);
    });
}

export async function startRelayGatewayBeforeShell(): Promise<RelayGatewayStartupResult> {
  if (process.env.RELAY_AIONUI_DISABLE_GATEWAY_AUTOSTART === '1') {
    relayGatewayResult = {
      state: 'disabled',
      statusFile: writeStatus({ state: 'disabled', message: 'Relay gateway autostart disabled by environment.' }),
    };
    return relayGatewayResult;
  }

  if (relayGatewayResult?.state === 'ready') return relayGatewayResult;

  registerQuitHandler();
  const statusFile = writeStatus({ state: 'starting', message: 'Starting Relay local M365 Copilot gateway.' });
  const gatewayDir = resolveRelayGatewayDir();
  if (!gatewayDir) {
    relayGatewayResult = {
      state: 'needs_attention',
      statusFile,
      message: 'Bundled Relay gateway files were not found.',
    };
    writeStatus({ state: 'needs_attention', message: relayGatewayResult.message });
    return relayGatewayResult;
  }

  const token = readOrCreateToken();
  const cdpPort = intEnv('RELAY_EDGE_CDP_PORT', DEFAULT_RELAY_EDGE_CDP_PORT);
  const instanceId = randomUUID();
  const portFile = join(relayDataDir(), `provider-port-${instanceId}.txt`);
  try {
    rmSync(portFile, { force: true });
  } catch {
    // Ignore stale file cleanup failures; port wait will fail if it cannot be overwritten.
  }

  const scriptPath = join(gatewayDir, 'copilot_server.js');
  relayGatewayProcess = spawn(process.execPath, [
    '--no-warnings',
    scriptPath,
    '--port',
    '0',
    '--cdp-port',
    String(cdpPort),
    '--boot-token',
    token,
    '--instance-id',
    instanceId,
    '--port-file',
    portFile,
  ], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      RELAY_AGENT_API_KEY: token,
      RELAY_EDGE_CDP_PORT: String(cdpPort),
      RELAY_COPILOT_NO_WINDOW_FOCUS: process.env.RELAY_COPILOT_NO_WINDOW_FOCUS || '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  relayGatewayProcess.on('exit', (code, signal) => {
    appendGatewayLog(`[RelayGateway] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    if (relayGatewayResult?.state === 'ready') {
      writeStatus({ state: 'needs_attention', message: 'Relay gateway stopped.', code, signal });
    }
  });

  try {
    const port = await waitForGatewayPort(portFile, relayGatewayProcess);
    const baseUrl = providerBaseUrl(port);
    const seedFile = writeRelaySeed(baseUrl, token);
    relayGatewayResult = {
      state: 'ready',
      baseUrl,
      seedFile,
      statusFile,
    };
    writeStatus(relayReadyStatus({ baseUrl, seedFile, cdpPort, gatewayDir }));
    startRelayGatewayPrewarm({ baseUrl, seedFile, cdpPort, gatewayDir, token });
    return relayGatewayResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stopRelayGateway();
    relayGatewayResult = {
      state: 'needs_attention',
      statusFile,
      message,
    };
    writeStatus({ state: 'needs_attention', message, gatewayDir });
    return relayGatewayResult;
  }
}
