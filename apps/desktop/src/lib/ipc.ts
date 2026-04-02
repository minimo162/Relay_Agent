import { invoke } from "@tauri-apps/api/core";
import {
  approvalPolicyConfigSchema,
  addProjectMemoryRequestSchema,
  assessCopilotHandoffRequestSchema,
  assessCopilotHandoffResponseSchema,
  batchCreateRequestSchema,
  batchJobSchema,
  batchSkipTargetRequestSchema,
  batchStatusRequestSchema,
  checkCopilotConnectionRequestSchema,
  copilotBrowserConnectResultSchema,
  copilotBrowserResultSchema,
  approvePlanRequestSchema,
  approvePlanResponseSchema,
  connectMcpServerRequestSchema,
  connectMcpServerResponseSchema,
  createProjectRequestSchema,
  createSessionRequestSchema,
  executeReadActionsRequestSchema,
  executeReadActionsResponseSchema,
  generateRelayPacketRequestSchema,
  inspectWorkbookRequestSchema,
  inspectWorkbookResponseSchema,
  initializeAppResponseSchema,
  linkSessionToProjectRequestSchema,
  listProjectsResponseSchema,
  listToolsResponseSchema,
  listSessionsResponseSchema,
  preflightWorkbookRequestSchema,
  preflightWorkbookResponseSchema,
  previewExecutionRequestSchema,
  previewExecutionResponseSchema,
  recordScopeApprovalRequestSchema,
  recordScopeApprovalResponseSchema,
  projectSchema,
  readProjectRequestSchema,
  readSessionRequestSchema,
  readTurnArtifactsRequestSchema,
  readTurnArtifactsResponseSchema,
  recordPlanProgressRequestSchema,
  relayPacketSchema,
  removeProjectMemoryRequestSchema,
  respondToApprovalRequestSchema,
  respondToApprovalResponseSchema,
  runExecutionRequestSchema,
  runExecutionMultiRequestSchema,
  runExecutionMultiResponseSchema,
  runExecutionResponseSchema,
  sessionDetailSchema,
  sendCopilotPromptRequestSchema,
  sessionSchema,
  setToolEnabledRequestSchema,
  setSessionProjectRequestSchema,
  startTurnRequestSchema,
  startTurnResponseSchema,
  submitCopilotResponseRequestSchema,
  submitCopilotResponseResponseSchema,
  planProgressRequestSchema,
  planProgressResponseSchema,
  pipelineCreateRequestSchema,
  pipelineSchema,
  pipelineStatusRequestSchema,
  toolRegistrationSchema,
  templateCreateRequestSchema,
  templateDeleteRequestSchema,
  templateFromSessionRequestSchema,
  templateGetRequestSchema,
  templateListRequestSchema,
  workflowTemplateSchema,
  setApprovalPolicyRequestSchema,
  updateProjectRequestSchema,
  validateOutputQualityRequestSchema,
  validateOutputQualityResponseSchema,
  type ApprovalPolicyConfig,
  type AddProjectMemoryRequest,
  type AssessCopilotHandoffRequest,
  type AssessCopilotHandoffResponse,
  type BatchCreateRequest,
  type BatchJob,
  type BatchSkipTargetRequest,
  type BatchStatusRequest,
  type CheckCopilotConnectionRequest,
  type CopilotBrowserResult,
  type CopilotBrowserConnectResult,
  type ApprovePlanRequest,
  type ApprovePlanResponse,
  type ConnectMcpServerRequest,
  type ConnectMcpServerResponse,
  type CreateProjectRequest,
  type CreateSessionRequest,
  type ExecuteReadActionsRequest,
  type ExecuteReadActionsResponse,
  type GenerateRelayPacketRequest,
  type GenerateRelayPacketResponse,
  type InspectWorkbookRequest,
  type InspectWorkbookResponse,
  type InitializeAppResponse,
  type LinkSessionToProjectRequest,
  type ListProjectsResponse,
  type ListToolsResponse,
  type ListSessionsResponse,
  type PreflightWorkbookRequest,
  type PreflightWorkbookResponse,
  type PreviewExecutionRequest,
  type PreviewExecutionResponse,
  type RecordScopeApprovalRequest,
  type RecordScopeApprovalResponse,
  type Project,
  type ReadProjectRequest,
  type ReadSessionRequest,
  type ReadTurnArtifactsRequest,
  type ReadTurnArtifactsResponse,
  type RecordPlanProgressRequest,
  type RemoveProjectMemoryRequest,
  type RespondToApprovalRequest,
  type RespondToApprovalResponse,
  type RunExecutionRequest,
  type RunExecutionMultiRequest,
  type RunExecutionMultiResponse,
  type RunExecutionResponse,
  type SendCopilotPromptRequest,
  type Session,
  type SessionDetail,
  type SetToolEnabledRequest,
  type SetSessionProjectRequest,
  type StartTurnRequest,
  type StartTurnResponse,
  type SubmitCopilotResponseRequest,
  type SubmitCopilotResponseResponse,
  type PlanProgressRequest,
  type PlanProgressResponse,
  type Pipeline,
  type PipelineCreateRequest,
  type PipelineStatusRequest,
  type ToolRegistration,
  type TemplateCreateRequest,
  type TemplateDeleteRequest,
  type TemplateFromSessionRequest,
  type TemplateGetRequest,
  type TemplateListRequest,
  type UpdateProjectRequest,
  type ValidateOutputQualityRequest,
  type ValidateOutputQualityResponse,
  type WorkflowTemplate,
  type SetApprovalPolicyRequest
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

const emptyResponseSchema: Schema<null> = {
  parse(value: unknown): null {
    if (value === null || typeof value === "undefined") {
      return null;
    }

    throw new TypeError("Expected an empty response.");
  }
};

function describeInvokeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage.trim();
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown desktop command error.";
    }
  }

  return "Unknown desktop command error.";
}

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
      `Failed to invoke \`${command}\`: ${describeInvokeError(error)}`,
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
      `Failed to invoke \`${command}\`: ${describeInvokeError(error)}`,
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

export function inspectWorkbook(
  payload: InspectWorkbookRequest
): Promise<InspectWorkbookResponse> {
  return invokeWithPayload(
    "inspect_workbook",
    payload,
    inspectWorkbookRequestSchema,
    inspectWorkbookResponseSchema
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

export function createProject(
  payload: CreateProjectRequest
): Promise<Project> {
  return invokeWithPayload(
    "create_project",
    payload,
    createProjectRequestSchema,
    projectSchema
  );
}

export function listProjects(): Promise<ListProjectsResponse> {
  return invokeWithoutPayload("list_projects", listProjectsResponseSchema);
}

export function listTools(): Promise<ListToolsResponse> {
  return invokeWithoutPayload("list_tools", listToolsResponseSchema);
}

export function setToolEnabled(
  payload: SetToolEnabledRequest
): Promise<ToolRegistration> {
  return invokeWithPayload(
    "set_tool_enabled",
    payload,
    setToolEnabledRequestSchema,
    toolRegistrationSchema
  );
}

export function connectMcpServer(
  payload: ConnectMcpServerRequest
): Promise<ConnectMcpServerResponse> {
  return invokeWithPayload(
    "connect_mcp_server",
    payload,
    connectMcpServerRequestSchema,
    connectMcpServerResponseSchema
  );
}

export function sendCopilotPrompt(
  payload: SendCopilotPromptRequest
): Promise<CopilotBrowserResult> {
  return invokeWithPayload(
    "send_copilot_prompt",
    payload,
    sendCopilotPromptRequestSchema,
    copilotBrowserResultSchema
  );
}

export function checkCopilotConnectionCommand(
  payload: CheckCopilotConnectionRequest
): Promise<CopilotBrowserConnectResult> {
  return invokeWithPayload(
    "check_copilot_connection",
    payload,
    checkCopilotConnectionRequestSchema,
    copilotBrowserConnectResultSchema
  );
}

export function readProject(
  payload: ReadProjectRequest
): Promise<Project> {
  return invokeWithPayload(
    "read_project",
    payload,
    readProjectRequestSchema,
    projectSchema
  );
}

export function updateProject(
  payload: UpdateProjectRequest
): Promise<Project> {
  return invokeWithPayload(
    "update_project",
    payload,
    updateProjectRequestSchema,
    projectSchema
  );
}

export function addProjectMemory(
  payload: AddProjectMemoryRequest
): Promise<Project> {
  return invokeWithPayload(
    "add_project_memory",
    payload,
    addProjectMemoryRequestSchema,
    projectSchema
  );
}

export function removeProjectMemory(
  payload: RemoveProjectMemoryRequest
): Promise<Project> {
  return invokeWithPayload(
    "remove_project_memory",
    payload,
    removeProjectMemoryRequestSchema,
    projectSchema
  );
}

export function linkSessionToProject(
  payload: LinkSessionToProjectRequest
): Promise<Project> {
  return invokeWithPayload(
    "link_session_to_project",
    payload,
    linkSessionToProjectRequestSchema,
    projectSchema
  );
}

export function setSessionProject(
  payload: SetSessionProjectRequest
): Promise<ListProjectsResponse> {
  return invokeWithPayload(
    "set_session_project",
    payload,
    setSessionProjectRequestSchema,
    listProjectsResponseSchema
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

export function readTurnArtifacts(
  payload: ReadTurnArtifactsRequest
): Promise<ReadTurnArtifactsResponse> {
  return invokeWithPayload(
    "read_turn_artifacts",
    payload,
    readTurnArtifactsRequestSchema,
    readTurnArtifactsResponseSchema
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

export function executeReadActions(
  payload: ExecuteReadActionsRequest
): Promise<ExecuteReadActionsResponse> {
  return invokeWithPayload(
    "execute_read_actions",
    payload,
    executeReadActionsRequestSchema,
    executeReadActionsResponseSchema
  );
}

export function approvePlan(
  payload: ApprovePlanRequest
): Promise<ApprovePlanResponse> {
  return invokeWithPayload(
    "approve_plan",
    payload,
    approvePlanRequestSchema,
    approvePlanResponseSchema
  );
}

export function getPlanProgress(
  payload: PlanProgressRequest
): Promise<PlanProgressResponse> {
  return invokeWithPayload(
    "get_plan_progress",
    payload,
    planProgressRequestSchema,
    planProgressResponseSchema
  );
}

export function recordPlanProgress(
  payload: RecordPlanProgressRequest
): Promise<PlanProgressResponse> {
  return invokeWithPayload(
    "record_plan_progress",
    payload,
    recordPlanProgressRequestSchema,
    planProgressResponseSchema
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

export function recordScopeApproval(
  payload: RecordScopeApprovalRequest
): Promise<RecordScopeApprovalResponse> {
  return invokeWithPayload(
    "record_scope_approval",
    payload,
    recordScopeApprovalRequestSchema,
    recordScopeApprovalResponseSchema
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

export function runExecutionMulti(
  payload: RunExecutionMultiRequest
): Promise<RunExecutionMultiResponse> {
  return invokeWithPayload(
    "run_execution_multi",
    payload,
    runExecutionMultiRequestSchema,
    runExecutionMultiResponseSchema
  );
}

export function validateOutputQuality(
  payload: ValidateOutputQualityRequest
): Promise<ValidateOutputQualityResponse> {
  return invokeWithPayload(
    "validate_output_quality",
    payload,
    validateOutputQualityRequestSchema,
    validateOutputQualityResponseSchema
  );
}

export function pipelineCreate(
  payload: PipelineCreateRequest
): Promise<Pipeline> {
  return invokeWithPayload(
    "pipeline_create",
    payload,
    pipelineCreateRequestSchema,
    pipelineSchema
  );
}

export function pipelineGetStatus(
  payload: PipelineStatusRequest
): Promise<Pipeline> {
  return invokeWithPayload(
    "pipeline_get_status",
    payload,
    pipelineStatusRequestSchema,
    pipelineSchema
  );
}

export async function pipelineRun(
  payload: PipelineStatusRequest
): Promise<void> {
  await invokeWithPayload(
    "pipeline_run",
    payload,
    pipelineStatusRequestSchema,
    emptyResponseSchema
  );
}

export async function pipelineCancel(
  payload: PipelineStatusRequest
): Promise<void> {
  await invokeWithPayload(
    "pipeline_cancel",
    payload,
    pipelineStatusRequestSchema,
    emptyResponseSchema
  );
}

export function batchCreate(
  payload: BatchCreateRequest
): Promise<BatchJob> {
  return invokeWithPayload(
    "batch_create",
    payload,
    batchCreateRequestSchema,
    batchJobSchema
  );
}

export function batchGetStatus(
  payload: BatchStatusRequest
): Promise<BatchJob> {
  return invokeWithPayload(
    "batch_get_status",
    payload,
    batchStatusRequestSchema,
    batchJobSchema
  );
}

export async function batchRun(
  payload: BatchStatusRequest
): Promise<void> {
  await invokeWithPayload(
    "batch_run",
    payload,
    batchStatusRequestSchema,
    emptyResponseSchema
  );
}

export async function batchSkipTarget(
  payload: BatchSkipTargetRequest
): Promise<void> {
  await invokeWithPayload(
    "batch_skip_target",
    payload,
    batchSkipTargetRequestSchema,
    emptyResponseSchema
  );
}

export function templateList(
  payload: TemplateListRequest = {}
): Promise<WorkflowTemplate[]> {
  return invokeWithPayload(
    "template_list",
    payload,
    templateListRequestSchema,
    workflowTemplateSchema.array()
  );
}

export function templateGet(
  payload: TemplateGetRequest
): Promise<WorkflowTemplate> {
  return invokeWithPayload(
    "template_get",
    payload,
    templateGetRequestSchema,
    workflowTemplateSchema
  );
}

export function templateCreate(
  payload: TemplateCreateRequest
): Promise<WorkflowTemplate> {
  return invokeWithPayload(
    "template_create",
    payload,
    templateCreateRequestSchema,
    workflowTemplateSchema
  );
}

export async function templateDelete(
  payload: TemplateDeleteRequest
): Promise<void> {
  await invokeWithPayload(
    "template_delete",
    payload,
    templateDeleteRequestSchema,
    emptyResponseSchema
  );
}

export function templateFromSession(
  payload: TemplateFromSessionRequest
): Promise<WorkflowTemplate> {
  return invokeWithPayload(
    "template_from_session",
    payload,
    templateFromSessionRequestSchema,
    workflowTemplateSchema
  );
}

export function getApprovalPolicy(): Promise<ApprovalPolicyConfig> {
  return invokeWithoutPayload("get_approval_policy", approvalPolicyConfigSchema);
}

export function setApprovalPolicy(
  payload: SetApprovalPolicyRequest
): Promise<ApprovalPolicyConfig> {
  return invokeWithPayload(
    "set_approval_policy",
    payload,
    setApprovalPolicyRequestSchema,
    approvalPolicyConfigSchema
  );
}

export const relayAgentIpc = {
  pingDesktop,
  initializeApp,
  preflightWorkbook,
  createProject,
  createSession,
  listProjects,
  readProject,
  updateProject,
  addProjectMemory,
  removeProjectMemory,
  linkSessionToProject,
  setSessionProject,
  listSessions,
  readSession,
  readTurnArtifacts,
  startTurn,
  generateRelayPacket,
  assessCopilotHandoff,
  submitCopilotResponse,
  executeReadActions,
  approvePlan,
  getPlanProgress,
  recordPlanProgress,
  previewExecution,
  recordScopeApproval,
  respondToApproval,
  runExecution,
  runExecutionMulti,
  validateOutputQuality,
  pipelineCreate,
  pipelineGetStatus,
  pipelineRun,
  pipelineCancel,
  batchCreate,
  batchGetStatus,
  batchRun,
  batchSkipTarget,
  templateList,
  templateGet,
  templateCreate,
  templateDelete,
  templateFromSession,
  getApprovalPolicy,
  setApprovalPolicy
};

export type RelayAgentIpc = typeof relayAgentIpc;
