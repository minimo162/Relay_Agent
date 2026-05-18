import {
  HttpAgent,
  type AgentSubscriber,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
  type RunAgentParameters,
  type RunAgentResult,
} from "@ag-ui/client";
import type { Observable } from "rxjs";

export const relayAgentId = "relay-workbench";

export function createRelayAgUiAgent({
  url,
  headers,
  threadId,
  workspace,
}: {
  url: string;
  headers: Record<string, string>;
  threadId: string;
  workspace: string;
}): HttpAgent {
  const workspaceState = workspaceContext(workspace);
  return new RelayWorkspaceHttpAgent(
    {
      url,
      headers,
      agentId: relayAgentId,
      description: "Relay Workbench AG-UI transport",
      threadId,
      initialState: workspaceState,
    },
    workspace,
  );
}

class RelayWorkspaceHttpAgent extends HttpAgent {
  constructor(config: HttpAgentConfig, private readonly workspace: string) {
    super(config);
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return super.run(injectWorkspace(input, this.workspace));
  }

  override runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    return super.runAgent(injectWorkspaceParameters(parameters, this.workspace), subscriber);
  }

  override connectAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    return super.connectAgent(injectWorkspaceParameters(parameters, this.workspace), subscriber);
  }
}

function injectWorkspace(input: RunAgentInput, workspace: string): RunAgentInput {
  const context = workspaceContext(workspace);
  return {
    ...input,
    state: mergeRecord(input.state, context),
    context: mergeContext(input.context, workspace),
    forwardedProps: mergeRecord(input.forwardedProps, context),
  };
}

function injectWorkspaceParameters(
  parameters: RunAgentParameters | undefined,
  workspace: string,
): RunAgentParameters {
  const context = workspaceContext(workspace);
  return {
    ...parameters,
    context: mergeContext(parameters?.context, workspace),
    forwardedProps: mergeRecord(parameters?.forwardedProps, context),
  };
}

function workspaceContext(workspace: string): Record<string, string> {
  return {
    workspace,
    relay_workspace: workspace,
    relayWorkspace: workspace,
  };
}

function mergeRecord(value: unknown, extra: Record<string, string>): Record<string, unknown> {
  return {
    ...(isRecord(value) ? value : {}),
    ...extra,
  };
}

function mergeContext(
  value: RunAgentInput["context"] | undefined,
  workspace: string,
): RunAgentInput["context"] {
  const existing = Array.isArray(value) ? value : [];
  const withoutWorkspace = existing.filter((entry) =>
    entry.description !== "workspace" && entry.description !== "relay_workspace"
  );
  return [
    ...withoutWorkspace,
    { description: "workspace", value: workspace },
    { description: "relay_workspace", value: workspace },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
