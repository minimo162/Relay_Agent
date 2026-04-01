import { listen } from "@tauri-apps/api/event";
import type {
  CopilotBrowserConnectResult,
  CopilotBrowserErrorCode,
  CopilotBrowserProgressEvent
} from "@relay-agent/contracts";

import {
  checkCopilotConnectionCommand,
  sendCopilotPrompt
} from "./ipc";
import {
  loadBrowserAutomationSettings
} from "./continuity";

const COPILOT_PROGRESS_EVENT = "copilot-browser-progress";

export type BrowserCommandProgress = {
  step: string;
  detail?: string;
};

type RunBrowserCommandOptions = {
  onProgress?: (event: BrowserCommandProgress) => void;
};

export const COPILOT_ERROR_MESSAGES: Record<CopilotBrowserErrorCode, string> = {
  CDP_UNAVAILABLE:
    "Edge に接続できませんでした。設定で自動起動を有効にするか、手動で起動してから再試行してください。",
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

export async function sendToCopilot(
  prompt: string,
  options: RunBrowserCommandOptions = {}
): Promise<string> {
  const settings = loadBrowserAutomationSettings();
  const requestId = crypto.randomUUID();
  const unlisten = await bindProgressListener(requestId, options.onProgress);

  try {
    const result = await sendCopilotPrompt({
      prompt,
      settings,
      progressEventId: requestId
    });

    if (result.status === "error") {
      throw new CopilotBrowserError(result.errorCode, result.message);
    }

    logResolvedCdpPort(result.cdpPort);
    return result.response;
  } finally {
    unlisten();
  }
}

export async function checkCopilotConnection(
  options: RunBrowserCommandOptions = {}
): Promise<void> {
  const settings = loadBrowserAutomationSettings();
  const requestId = crypto.randomUUID();
  const unlisten = await bindProgressListener(requestId, options.onProgress);

  try {
    const result = await checkCopilotConnectionCommand({
      settings,
      progressEventId: requestId
    });
    handleConnectResult(result);
  } finally {
    unlisten();
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

async function bindProgressListener(
  requestId: string,
  onProgress?: (event: BrowserCommandProgress) => void
): Promise<() => void> {
  if (!onProgress) {
    return () => undefined;
  }

  return listen<CopilotBrowserProgressEvent>(COPILOT_PROGRESS_EVENT, (event) => {
    if (event.payload.requestId !== requestId) {
      return;
    }

    onProgress({
      step: event.payload.step,
      detail: event.payload.detail
    });
  });
}

function handleConnectResult(result: CopilotBrowserConnectResult): void {
  if (result.status === "error") {
    throw new CopilotBrowserError(result.errorCode, result.message);
  }

  logResolvedCdpPort(result.cdpPort);
}

function logResolvedCdpPort(port: number | null | undefined): void {
  if (typeof port === "number" && Number.isFinite(port)) {
    console.log("[copilot-browser] connected cdpPort:", port);
  }
}
