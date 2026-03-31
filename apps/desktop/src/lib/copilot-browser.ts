import { resolveResource } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import {
  copilotBrowserErrorCodeSchema,
  copilotBrowserResultSchema,
  type CopilotBrowserErrorCode,
  type CopilotBrowserResult
} from "@relay-agent/contracts";

import {
  loadBrowserAutomationSettings
} from "./continuity";

const RESOURCE_SCRIPT_PATH = "../scripts/dist/copilot-browser.js";

declare const __COPILOT_SCRIPT_DEV_PATH__: string;

type BrowserCommandAction = "connect" | "send";

type BrowserCommandOutput = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type ConnectResult =
  | { status: "ready" }
  | {
      status: "error";
      errorCode: CopilotBrowserErrorCode;
      message: string;
    };

export const COPILOT_ERROR_MESSAGES: Record<CopilotBrowserErrorCode, string> = {
  CDP_UNAVAILABLE:
    "Edge が CDP モードで起動していません。設定の「起動コマンドをコピー」で Edge を起動してから再試行してください。",
  NOT_LOGGED_IN:
    "M365 Copilot にログインしていません。Edge で M365 にログインしてから再試行してください。",
  RESPONSE_TIMEOUT:
    "Copilot の応答待機がタイムアウトしました。手動でコピー＆ペーストしてください。",
  COPILOT_ERROR:
    "Copilot がエラーを返しました。手動でコピー＆ペーストしてください。",
  SEND_FAILED:
    "プロンプトの送信に失敗しました。手動でコピー＆ペーストしてください。"
};

export class CopilotBrowserError extends Error {
  readonly errorCode: CopilotBrowserErrorCode;

  constructor(errorCode: CopilotBrowserErrorCode, message: string) {
    super(message);
    this.name = "CopilotBrowserError";
    this.errorCode = errorCode;
  }
}

export async function sendToCopilot(prompt: string): Promise<string> {
  const output = await runBrowserCommand("send", { prompt });
  const result = parseSendResult(output);

  if (result.status === "error") {
    throw new CopilotBrowserError(result.errorCode, result.message);
  }

  return result.response;
}

export async function checkCopilotConnection(): Promise<void> {
  const output = await runBrowserCommand("connect");
  const result = parseConnectResult(output);

  if (result.status === "error") {
    throw new CopilotBrowserError(result.errorCode, result.message);
  }
}

export function getCopilotBrowserErrorMessage(error: unknown): string {
  if (error instanceof CopilotBrowserError) {
    return COPILOT_ERROR_MESSAGES[error.errorCode];
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return COPILOT_ERROR_MESSAGES.SEND_FAILED;
}

async function runBrowserCommand(
  action: BrowserCommandAction,
  payload?: { prompt: string }
): Promise<BrowserCommandOutput> {
  const settings = loadBrowserAutomationSettings();
  const scriptPath = await resolveBrowserScriptPath();
  const args = [
    scriptPath,
    "--action",
    action,
    "--cdp-port",
    String(settings.cdpPort),
    "--timeout",
    String(settings.timeoutMs),
    ...(payload ? ["--prompt", payload.prompt] : [])
  ];

  console.log("[copilot-browser] scriptPath:", scriptPath);
  console.log("[copilot-browser] args:", args);

  const command = Command.create("node", args);
  let stdout = "";
  let stderr = "";

  command.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  command.stderr.on("data", (chunk) => {
    stderr += chunk;
    console.warn("[copilot-browser] stderr:", chunk);
  });

  const completion = new Promise<BrowserCommandOutput>((resolve, reject) => {
    command.on("close", ({ code }) => {
      console.log("[copilot-browser] close code:", code, "stdout:", stdout, "stderr:", stderr);
      resolve({ code, stdout, stderr });
    });
    command.on("error", (message) => {
      console.error("[copilot-browser] spawn error:", message);
      reject(
        new CopilotBrowserError(
          "SEND_FAILED",
          message || "Failed to start the Copilot browser automation command."
        )
      );
    });
  });

  await command.spawn();

  return completion;
}

async function resolveBrowserScriptPath(): Promise<string> {
  // __COPILOT_SCRIPT_DEV_PATH__ is injected by Vite define at build time.
  // Cast to unknown first to safely check for undefined at runtime.
  const devPath = (__COPILOT_SCRIPT_DEV_PATH__ as unknown) as string | undefined;

  if (import.meta.env.DEV && devPath) {
    console.log("[copilot-browser] using dev path:", devPath);
    return devPath;
  }

  try {
    const resourcePath = await resolveResource(RESOURCE_SCRIPT_PATH);
    console.log("[copilot-browser] using resource path:", resourcePath);
    return resourcePath;
  } catch (err) {
    console.warn("[copilot-browser] resolveResource failed:", err);
    if (devPath) return devPath;
    throw new CopilotBrowserError(
      "SEND_FAILED",
      "Could not resolve the path to copilot-browser.js. Run `pnpm copilot-browser:build` and restart the app."
    );
  }
}

function parseSendResult(output: BrowserCommandOutput): CopilotBrowserResult {
  const parsed = parseJsonLine(output.stdout);
  const result = copilotBrowserResultSchema.safeParse(parsed);

  if (result.success) {
    return result.data;
  }

  if (output.code === 0 && !output.stdout.trim()) {
    throw new CopilotBrowserError(
      "SEND_FAILED",
      "The Copilot browser script exited without returning JSON."
    );
  }

  throw new CopilotBrowserError(
    "SEND_FAILED",
    buildParseErrorMessage(output, result.error.message)
  );
}

function parseConnectResult(output: BrowserCommandOutput): ConnectResult {
  const parsed = parseJsonLine(output.stdout);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (record.status === "ready") {
      return { status: "ready" };
    }

    if (record.status === "error") {
      const errorCode = copilotBrowserErrorCodeSchema.safeParse(record.errorCode);
      const message =
        typeof record.message === "string" && record.message.trim()
          ? record.message
          : buildParseErrorMessage(output, "The connect response did not include a message.");

      if (errorCode.success) {
        return {
          status: "error",
          errorCode: errorCode.data,
          message
        };
      }
    }
  }

  throw new CopilotBrowserError(
    "SEND_FAILED",
    buildParseErrorMessage(output, "The connect response did not match the expected JSON shape.")
  );
}

function parseJsonLine(stdout: string): unknown {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.at(-1) ?? "";

  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function buildParseErrorMessage(output: BrowserCommandOutput, reason: string): string {
  const details = output.stderr.trim() || output.stdout.trim();
  if (details) {
    return `${reason} ${details}`.trim();
  }

  return reason;
}
