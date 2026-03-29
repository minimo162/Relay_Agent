import { invoke } from "@tauri-apps/api/core";
import {
  assessCopilotHandoffRequestSchema,
  assessCopilotHandoffResponseSchema,
  createSessionRequestSchema,
  generateRelayPacketRequestSchema,
  initializeAppResponseSchema,
  listSessionsResponseSchema,
  preflightWorkbookRequestSchema,
  preflightWorkbookResponseSchema,
  previewExecutionRequestSchema,
  previewExecutionResponseSchema,
  readSessionRequestSchema,
  relayPacketSchema,
  respondToApprovalRequestSchema,
  respondToApprovalResponseSchema,
  runExecutionRequestSchema,
  runExecutionResponseSchema,
  sessionDetailSchema,
  sessionSchema,
  startTurnRequestSchema,
  startTurnResponseSchema,
  submitCopilotResponseRequestSchema,
  submitCopilotResponseResponseSchema,
  type AssessCopilotHandoffRequest,
  type AssessCopilotHandoffResponse,
  type CreateSessionRequest,
  type GenerateRelayPacketRequest,
  type GenerateRelayPacketResponse,
  type InitializeAppResponse,
  type ListSessionsResponse,
  type PreflightWorkbookRequest,
  type PreflightWorkbookResponse,
  type PreviewExecutionRequest,
  type PreviewExecutionResponse,
  type ReadSessionRequest,
  type RespondToApprovalRequest,
  type RespondToApprovalResponse,
  type RunExecutionRequest,
  type RunExecutionResponse,
  type Session,
  type SessionDetail,
  type StartTurnRequest,
  type StartTurnResponse,
  type SubmitCopilotResponseRequest,
  type SubmitCopilotResponseResponse
} from "@relay-agent/contracts";

type Schema<T> = {
  parse(value: unknown): T;
};

const stringSchema: Schema<string> = {
  parse(value: unknown): string {
    if (typeof value !== "string") {
      throw new TypeError("Expected a string response.");
    }

    return value;
  }
};

export class RelayAgentIpcError extends Error {
  command: string;
  causeValue: unknown;

  constructor(command: string, message: string, causeValue?: unknown) {
    super(message);
    this.name = "RelayAgentIpcError";
    this.command = command;
    this.causeValue = causeValue;
  }
}

async function invokeWithoutPayload<TResponse>(
  command: string,
  responseSchema: Schema<TResponse>
): Promise<TResponse> {
  try {
    return responseSchema.parse(await invoke(command));
  } catch (error) {
    throw new RelayAgentIpcError(
      command,
      `Failed to invoke \`${command}\`.`,
      error
    );
  }
}

async function invokeWithPayload<TRequest, TResponse>(
  command: string,
  payload: TRequest,
  requestSchema: Schema<TRequest>,
  responseSchema: Schema<TResponse>
): Promise<TResponse> {
  try {
    const request = requestSchema.parse(payload);
    return responseSchema.parse(await invoke(command, { request }));
  } catch (error) {
    throw new RelayAgentIpcError(
      command,
      `Failed to invoke \`${command}\`.`,
      error
    );
  }
}

export async function pingDesktop(): Promise<string> {
  try {
    return await invokeWithoutPayload("ping", stringSchema);
  } catch {
    return "tauri-unavailable";
  }
}

export function initializeApp(): Promise<InitializeAppResponse> {
  return invokeWithoutPayload("initialize_app", initializeAppResponseSchema);
}

export function preflightWorkbook(
  payload: PreflightWorkbookRequest
): Promise<PreflightWorkbookResponse> {
  return invokeWithPayload(
    "preflight_workbook",
    payload,
    preflightWorkbookRequestSchema,
    preflightWorkbookResponseSchema
  );
}

export function createSession(
  payload: CreateSessionRequest
): Promise<Session> {
  return invokeWithPayload(
    "create_session",
    payload,
    createSessionRequestSchema,
    sessionSchema
  );
}

export function listSessions(): Promise<ListSessionsResponse> {
  return invokeWithoutPayload("list_sessions", listSessionsResponseSchema);
}

export function readSession(
  payload: ReadSessionRequest
): Promise<SessionDetail> {
  return invokeWithPayload(
    "read_session",
    payload,
    readSessionRequestSchema,
    sessionDetailSchema
  );
}

export function startTurn(
  payload: StartTurnRequest
): Promise<StartTurnResponse> {
  return invokeWithPayload(
    "start_turn",
    payload,
    startTurnRequestSchema,
    startTurnResponseSchema
  );
}

export function generateRelayPacket(
  payload: GenerateRelayPacketRequest
): Promise<GenerateRelayPacketResponse> {
  return invokeWithPayload(
    "generate_relay_packet",
    payload,
    generateRelayPacketRequestSchema,
    relayPacketSchema
  );
}

export function assessCopilotHandoff(
  payload: AssessCopilotHandoffRequest
): Promise<AssessCopilotHandoffResponse> {
  return invokeWithPayload(
    "assess_copilot_handoff",
    payload,
    assessCopilotHandoffRequestSchema,
    assessCopilotHandoffResponseSchema
  );
}

export function submitCopilotResponse(
  payload: SubmitCopilotResponseRequest
): Promise<SubmitCopilotResponseResponse> {
  return invokeWithPayload(
    "submit_copilot_response",
    payload,
    submitCopilotResponseRequestSchema,
    submitCopilotResponseResponseSchema
  );
}

export function previewExecution(
  payload: PreviewExecutionRequest
): Promise<PreviewExecutionResponse> {
  return invokeWithPayload(
    "preview_execution",
    payload,
    previewExecutionRequestSchema,
    previewExecutionResponseSchema
  );
}

export function respondToApproval(
  payload: RespondToApprovalRequest
): Promise<RespondToApprovalResponse> {
  return invokeWithPayload(
    "respond_to_approval",
    payload,
    respondToApprovalRequestSchema,
    respondToApprovalResponseSchema
  );
}

export function runExecution(
  payload: RunExecutionRequest
): Promise<RunExecutionResponse> {
  return invokeWithPayload(
    "run_execution",
    payload,
    runExecutionRequestSchema,
    runExecutionResponseSchema
  );
}

export const relayAgentIpc = {
  pingDesktop,
  initializeApp,
  preflightWorkbook,
  createSession,
  listSessions,
  readSession,
  startTurn,
  generateRelayPacket,
  assessCopilotHandoff,
  submitCopilotResponse,
  previewExecution,
  respondToApproval,
  runExecution
};

export type RelayAgentIpc = typeof relayAgentIpc;
