import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_RELAY_EDGE_CDP_PORT = 9360;
export const DEFAULT_RELAY_OPENCODE_PROVIDER_PORT = 18180;
export const PROVIDER_ID = "relay-agent";
export const MODEL_ID = "m365-copilot";
export const MODEL_REF = `${PROVIDER_ID}/${MODEL_ID}`;

export function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function providerPort() {
  return envInt("RELAY_OPENCODE_PROVIDER_PORT", DEFAULT_RELAY_OPENCODE_PROVIDER_PORT);
}

export function edgeCdpPort() {
  return envInt("RELAY_EDGE_CDP_PORT", DEFAULT_RELAY_EDGE_CDP_PORT);
}

export function providerBaseURL(port = providerPort()) {
  return `http://127.0.0.1:${port}/v1`;
}

export function tokenFilePath() {
  return (
    process.env.RELAY_OPENCODE_PROVIDER_TOKEN_FILE ||
    join(homedir(), ".relay-agent", "opencode-provider-token")
  );
}

export function readOrCreateToken(filePath = tokenFilePath()) {
  const envToken = process.env.RELAY_AGENT_API_KEY?.trim();
  if (envToken) return { token: envToken, source: "RELAY_AGENT_API_KEY" };

  if (existsSync(filePath)) {
    const token = readFileSync(filePath, "utf8").trim();
    if (token) return { token, source: filePath };
  }

  const token = randomUUID();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return { token, source: filePath };
}

export function opencodeProviderConfig(baseURL = providerBaseURL()) {
  return {
    $schema: "https://opencode.ai/config.json",
    enabled_providers: [PROVIDER_ID],
    provider: {
      [PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Relay Agent / M365 Copilot",
        options: {
          baseURL,
          apiKey: "{env:RELAY_AGENT_API_KEY}",
        },
        models: {
          [MODEL_ID]: {
            name: "M365 Copilot",
            limit: {
              context: 128000,
              output: 8192,
            },
          },
        },
      },
    },
  };
}

export function mergeOpencodeConfig(existing, relayConfig = opencodeProviderConfig()) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const enabled = Array.isArray(base.enabled_providers) ? base.enabled_providers.filter(Boolean) : [];
  base.$schema = typeof base.$schema === "string" ? base.$schema : relayConfig.$schema;
  base.enabled_providers = [...new Set([...enabled, PROVIDER_ID])];
  base.provider = {
    ...(base.provider && typeof base.provider === "object" && !Array.isArray(base.provider)
      ? base.provider
      : {}),
    [PROVIDER_ID]: relayConfig.provider[PROVIDER_ID],
  };
  return base;
}

export function shellExportLine(token) {
  return `export RELAY_AGENT_API_KEY=${shellQuote(token)}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}
