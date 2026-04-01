import type { ToolRegistration } from "@relay-agent/contracts";
import type { BrowserCommandProgress } from "./copilot-browser";
import type { InvokeMcpToolResponse } from "@relay-agent/contracts";

const MCP_TOOL_TIMEOUT_MS = 30_000;

export type ToolRuntime = {
  sendToCopilot: (
    prompt: string,
    options?: { onProgress?: (event: BrowserCommandProgress) => void }
  ) => Promise<string>;
  invokeMcpTool: (payload: {
    toolId: string;
    args: Record<string, unknown>;
  }) => Promise<InvokeMcpToolResponse>;
};

async function resolveDefaultRuntime(): Promise<ToolRuntime> {
  const [{ sendToCopilot }, { invokeMcpTool }] = await Promise.all([
    import("./copilot-browser"),
    import("./ipc")
  ]);

  return {
    sendToCopilot,
    invokeMcpTool
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export async function invokeRegisteredTool(
  tool: ToolRegistration,
  args: Record<string, unknown>,
  options: { onBrowserProgress?: (event: BrowserCommandProgress) => void } = {},
  runtime?: ToolRuntime
): Promise<unknown> {
  const resolvedRuntime = runtime ?? (await resolveDefaultRuntime());

  if (tool.source === "builtin") {
    if (tool.id === "browser.send_to_copilot") {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        throw new Error("browser.send_to_copilot requires a prompt string.");
      }

      return {
        response: await resolvedRuntime.sendToCopilot(prompt, {
          onProgress: options.onBrowserProgress
        })
      };
    }

    throw new Error(`Built-in tool '${tool.id}' does not expose a desktop runtime executor`);
  }

  if (tool.source === "mcp") {
    if (!tool.mcpServerUrl) {
      throw new Error(`MCP tool '${tool.id}' is missing mcpServerUrl`);
    }
    if (!tool.enabled) {
      throw new Error(`Tool '${tool.id}' is disabled`);
    }

    const response = await withTimeout(
      resolvedRuntime.invokeMcpTool({
        toolId: tool.id,
        args
      }),
      MCP_TOOL_TIMEOUT_MS,
      `MCP tool '${tool.id}'`
    );
    return response.result;
  }

  throw new Error(`Unknown tool source '${(tool as ToolRegistration).source}'`);
}

export async function sendPromptViaBrowserTool(
  prompt: string,
  options: { onProgress?: (event: BrowserCommandProgress) => void } = {},
  runtime?: Pick<ToolRuntime, "sendToCopilot">
): Promise<string> {
  const result = await invokeRegisteredTool(
    {
      id: "browser.send_to_copilot",
      title: "Copilot にプロンプト送信",
      description: "Edge の M365 Copilot にプロンプトを送信し応答を取得",
      phase: "read",
      requiresApproval: false,
      source: "builtin",
      enabled: true
    },
    { prompt },
    { onBrowserProgress: options.onProgress },
    {
      sendToCopilot:
        runtime?.sendToCopilot ?? (await resolveDefaultRuntime()).sendToCopilot,
      invokeMcpTool: async () => {
        throw new Error("browser tool execution should not call MCP runtime");
      }
    }
  );

  if (!result || typeof result !== "object" || typeof (result as { response?: unknown }).response !== "string") {
    throw new Error("browser.send_to_copilot returned an invalid response payload.");
  }

  return (result as { response: string }).response;
}
