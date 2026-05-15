import "./styles.css";

type StatusResponse = {
  app: string;
  version: string;
  ready: boolean;
  checks: ReadonlyArray<{
    name: string;
    ready: boolean;
    detail: string;
    required?: boolean;
  }>;
};

type RunEvent = {
  type: "status" | "tool" | "approval" | "final" | "error";
  message: string;
  detail?: string;
};

type PendingApproval = {
  approvalId: string;
  toolCall: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
  };
};

type RunStatus = "running" | "completed" | "failed" | "approval_required" | "cancelled";

type RunResponse = {
  runId: string;
  status: RunStatus;
  events: RunEvent[];
  pendingApproval?: PendingApproval | null;
};

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const workspaceStorageKey = "relay.workbench.workspace";
const workspaceHistoryKey = "relay.workbench.workspaceHistory";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <section class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Relay Agent</p>
        <h1>Workbench</h1>
      </div>
      <button class="status-pill" id="readiness" type="button">Checking</button>
    </header>

    <main class="workspace-layout">
      <section class="composer-panel" aria-label="Task composer">
        <div class="field-group">
          <div class="field-row">
            <label class="field-label" for="workspace">Workspace</label>
            <span id="workspace-state" class="field-state"></span>
          </div>
          <input id="workspace" class="workspace-input" autocomplete="off" spellcheck="false" placeholder="/path/to/workspace" />
          <div id="workspace-history" class="workspace-history" hidden></div>
        </div>

        <div class="field-group">
          <div class="field-row">
            <label class="field-label" for="instruction">Task</label>
            <span id="run-id" class="field-state"></span>
          </div>
          <textarea id="instruction" class="task-input" rows="3" placeholder="部品売上に関するファイルを探して"></textarea>
        </div>

        <div class="actions">
          <button id="refresh" class="secondary-button" type="button">更新</button>
          <button id="send" class="primary-button" type="button">送信</button>
        </div>
      </section>

      <section id="summary" class="summary-panel" hidden>
        <p id="summary-label" class="summary-label"></p>
        <div id="summary-text" class="summary-text"></div>
      </section>

      <section id="approval" class="approval-panel" hidden></section>

      <section class="run-panel" aria-live="polite">
        <div class="run-header">
          <h2>Activity</h2>
          <span id="run-state" class="run-state">Idle</span>
        </div>
        <ol id="events" class="events"></ol>
      </section>

      <details class="details">
        <summary>Details</summary>
        <pre id="raw"></pre>
      </details>
    </main>
  </section>
`;

const readinessEl = document.querySelector<HTMLButtonElement>("#readiness")!;
const workspaceEl = document.querySelector<HTMLInputElement>("#workspace")!;
const workspaceStateEl = document.querySelector<HTMLElement>("#workspace-state")!;
const workspaceHistoryEl = document.querySelector<HTMLElement>("#workspace-history")!;
const instructionEl = document.querySelector<HTMLTextAreaElement>("#instruction")!;
const sendEl = document.querySelector<HTMLButtonElement>("#send")!;
const refreshEl = document.querySelector<HTMLButtonElement>("#refresh")!;
const eventsEl = document.querySelector<HTMLOListElement>("#events")!;
const approvalEl = document.querySelector<HTMLElement>("#approval")!;
const rawEl = document.querySelector<HTMLPreElement>("#raw")!;
const runIdEl = document.querySelector<HTMLElement>("#run-id")!;
const runStateEl = document.querySelector<HTMLElement>("#run-state")!;
const summaryEl = document.querySelector<HTMLElement>("#summary")!;
const summaryLabelEl = document.querySelector<HTMLElement>("#summary-label")!;
const summaryTextEl = document.querySelector<HTMLElement>("#summary-text")!;

let currentRunId: string | null = null;
let currentStatus: RunStatus | "idle" = "idle";
let eventSource: EventSource | null = null;
let events: RunEvent[] = [];
let eventKeys = new Set<string>();

function api(path: string): string {
  const url = new URL(path, window.location.origin);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return token ? { ...extra, "X-Relay-Token": token } : extra;
}

function eventKey(event: RunEvent): string {
  return `${event.type}\u0000${event.message}\u0000${event.detail ?? ""}`;
}

function setEvents(nextEvents: readonly RunEvent[]): void {
  events = [];
  eventKeys = new Set();
  for (const event of nextEvents) appendEvent(event, false);
  renderEvents();
  renderSummary();
}

function appendEvent(event: RunEvent, render = true): void {
  const key = eventKey(event);
  if (eventKeys.has(key)) return;
  eventKeys.add(key);
  events.push(event);
  if (render) {
    renderEvents();
    renderSummary();
  }
}

function renderEvents(): void {
  if (events.length === 0) {
    eventsEl.replaceChildren(emptyActivity());
    return;
  }

  eventsEl.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("li");
      item.className = `event event-${event.type}`;
      const marker = document.createElement("span");
      marker.className = "event-marker";
      marker.textContent = event.type;
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.message;
      body.append(title);
      if (event.detail) {
        const detail = document.createElement("p");
        detail.textContent = event.detail;
        body.append(detail);
      }
      item.append(marker, body);
      return item;
    }),
  );
}

function emptyActivity(): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "event event-empty";
  const marker = document.createElement("span");
  marker.className = "event-marker";
  marker.textContent = "idle";
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "まだ実行していません";
  body.append(title);
  item.append(marker, body);
  return item;
}

function renderSummary(): void {
  const finalEvent = [...events].reverse().find((event) => event.type === "final");
  const errorEvent = [...events].reverse().find((event) => event.type === "error");
  const event = finalEvent ?? (currentStatus === "failed" ? errorEvent : undefined);
  if (!event) {
    summaryEl.hidden = true;
    summaryTextEl.textContent = "";
    summaryLabelEl.textContent = "";
    return;
  }

  summaryEl.hidden = false;
  summaryEl.dataset.kind = event.type;
  summaryLabelEl.textContent = event.type === "final" ? "Result" : "Error";
  summaryTextEl.textContent = event.detail || event.message;
}

function renderApproval(result: RunResponse): void {
  approvalEl.replaceChildren();
  approvalEl.hidden = true;
  if (!result.pendingApproval || result.status !== "approval_required") return;

  approvalEl.hidden = false;
  const toolCall = result.pendingApproval.toolCall;
  const target = approvalTarget(toolCall.args);
  const operation = String(toolCall.args.operation ?? toolCall.args.command ?? toolCall.tool);

  const header = document.createElement("div");
  header.className = "approval-header";
  const title = document.createElement("strong");
  title.textContent = "確認が必要です";
  const caption = document.createElement("span");
  caption.textContent = toolCall.tool;
  header.append(title, caption);

  const grid = document.createElement("dl");
  grid.className = "approval-facts";
  appendFact(grid, "操作", operation);
  appendFact(grid, "対象", target);

  const raw = document.createElement("details");
  raw.className = "approval-raw";
  const summary = document.createElement("summary");
  summary.textContent = "Raw";
  const detail = document.createElement("pre");
  detail.textContent = JSON.stringify(toolCall, null, 2);
  raw.append(summary, detail);

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const reject = document.createElement("button");
  reject.className = "secondary-button";
  reject.type = "button";
  reject.textContent = "実行しない";
  reject.addEventListener("click", () => void rejectRun(result.runId));
  const approve = document.createElement("button");
  approve.className = "primary-button";
  approve.type = "button";
  approve.textContent = "許可して続行";
  approve.addEventListener("click", () => void approveRun(result.runId));
  actions.append(reject, approve);
  approvalEl.append(header, grid, raw, actions);
}

function appendFact(list: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value || "-";
  list.append(term, detail);
}

function approvalTarget(args: Record<string, unknown>): string {
  const value = args.filePath ?? args.path ?? args.target ?? args.command ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function setRunChrome(status: RunStatus | "idle", runId: string | null): void {
  currentStatus = status;
  currentRunId = runId;
  const running = status === "running";
  sendEl.textContent = running ? "停止" : "送信";
  sendEl.dataset.running = running ? "true" : "false";
  refreshEl.disabled = running;
  runIdEl.textContent = runId ? runId : "";
  runStateEl.textContent = status === "approval_required" ? "Waiting" : statusLabel(status);
  runStateEl.dataset.status = status;
}

function statusLabel(status: RunStatus | "idle"): string {
  return {
    idle: "Idle",
    running: "Running",
    completed: "Done",
    failed: "Failed",
    approval_required: "Waiting",
    cancelled: "Stopped",
  }[status];
}

function renderRun(result: RunResponse): void {
  setRunChrome(result.status, result.runId);
  setEvents(result.events);
  renderApproval(result);
  rawEl.textContent = JSON.stringify(result, null, 2);
}

async function refreshStatus(): Promise<void> {
  const response = await fetch(api("/api/status"), {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Status failed: ${response.status}`);
  const status = (await response.json()) as StatusResponse;
  const copilotReady = status.checks.some((check) => check.name === "copilot-cdp" && check.ready);
  const optionalFailures = status.checks.filter((check) => check.required === false && !check.ready);
  if (status.ready) {
    readinessEl.textContent = "Ready";
    readinessEl.dataset.ready = "true";
    readinessEl.title = optionalFailures.length > 0
      ? `Optional capability unavailable: ${optionalFailures.map((check) => check.name).join(", ")}`
      : "";
  } else if (copilotReady) {
    readinessEl.textContent = "Limited";
    readinessEl.dataset.ready = "partial";
    readinessEl.title = "Some required local execution capability is unavailable.";
  } else {
    readinessEl.textContent = "Not ready";
    readinessEl.dataset.ready = "false";
    readinessEl.title = "Copilot transport is not available.";
  }
  rawEl.textContent = JSON.stringify(status, null, 2);
}

async function runTask(): Promise<void> {
  if (currentStatus === "running" && currentRunId) {
    await cancelRun(currentRunId);
    return;
  }

  closeEventStream();
  approvalEl.hidden = true;
  summaryEl.hidden = true;
  setRunChrome("running", null);
  setEvents([]);
  saveWorkspace(workspaceEl.value);

  try {
    const response = await fetch(api("/api/runs"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        instruction: instructionEl.value,
        workspace: workspaceEl.value,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as RunResponse;
    renderRun(result);
    if (result.status === "running") {
      connectEvents(result.runId);
    }
  } catch (error) {
    setRunChrome("failed", null);
    setEvents([{
      type: "error",
      message: "完了できませんでした",
      detail: error instanceof Error ? error.message : String(error),
    }]);
  }
}

function connectEvents(runId: string): void {
  closeEventStream();
  const source = new EventSource(api(`/api/runs/${encodeURIComponent(runId)}/events`));
  eventSource = source;
  source.addEventListener("run-event", (event) => {
    const data = (event as MessageEvent).data;
    if (!data) return;
    const runEvent = JSON.parse(data) as RunEvent;
    appendEvent(runEvent);
    if (runEvent.type === "final" || runEvent.type === "error" || runEvent.type === "approval") {
      window.setTimeout(() => void loadRun(runId), 120);
    }
  });
  source.onerror = () => {
    source.close();
    if (eventSource === source) eventSource = null;
    if (currentRunId === runId && currentStatus === "running") {
      window.setTimeout(() => void loadRun(runId), 180);
    }
  };
}

function closeEventStream(): void {
  eventSource?.close();
  eventSource = null;
}

async function loadRun(runId: string): Promise<void> {
  const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}`), {
    headers: authHeaders(),
  });
  if (!response.ok) return;
  const result = (await response.json()) as RunResponse;
  renderRun(result);
  if (result.status !== "running") closeEventStream();
}

async function approveRun(runId: string): Promise<void> {
  approvalEl.hidden = true;
  setRunChrome("running", runId);
  try {
    const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/approve`), {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as RunResponse;
    renderRun(result);
    if (result.status === "running") connectEvents(result.runId);
  } catch (error) {
    setRunChrome("failed", runId);
    appendEvent({
      type: "error",
      message: "承認後の実行に失敗しました",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function rejectRun(runId: string): Promise<void> {
  approvalEl.hidden = true;
  try {
    const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/reject`), {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as RunResponse;
    renderRun(result);
  } catch (error) {
    setRunChrome("failed", runId);
    appendEvent({
      type: "error",
      message: "却下に失敗しました",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cancelRun(runId: string): Promise<void> {
  sendEl.disabled = true;
  try {
    const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/cancel`), {
      method: "POST",
      headers: authHeaders(),
    });
    if (response.ok) {
      const result = (await response.json()) as RunResponse;
      renderRun(result);
    }
  } finally {
    sendEl.disabled = false;
  }
}

function autoResizeTask(): void {
  instructionEl.style.height = "auto";
  instructionEl.style.height = `${Math.min(Math.max(instructionEl.scrollHeight, 132), 320)}px`;
}

function saveWorkspace(workspace: string): void {
  const value = workspace.trim();
  if (!value) return;
  localStorage.setItem(workspaceStorageKey, value);
  const history = loadWorkspaceHistory().filter((item) => item !== value);
  localStorage.setItem(workspaceHistoryKey, JSON.stringify([value, ...history].slice(0, 4)));
  renderWorkspaceHistory();
  workspaceStateEl.textContent = compactPath(value);
}

function loadWorkspaceHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(workspaceHistoryKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function renderWorkspaceHistory(): void {
  const history = loadWorkspaceHistory();
  workspaceHistoryEl.replaceChildren();
  workspaceHistoryEl.hidden = history.length === 0;
  for (const item of history) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = compactPath(item);
    button.title = item;
    button.addEventListener("click", () => {
      workspaceEl.value = item;
      workspaceStateEl.textContent = compactPath(item);
    });
    workspaceHistoryEl.append(button);
  }
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

refreshEl.addEventListener("click", () => {
  void refreshStatus().catch((error) => {
    readinessEl.textContent = "Not ready";
    readinessEl.dataset.ready = "false";
    rawEl.textContent = error instanceof Error ? error.message : String(error);
  });
});
readinessEl.addEventListener("click", () => void refreshStatus());
sendEl.addEventListener("click", () => void runTask());
instructionEl.addEventListener("input", autoResizeTask);
instructionEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void runTask();
  }
});
workspaceEl.addEventListener("change", () => {
  workspaceStateEl.textContent = compactPath(workspaceEl.value);
});

workspaceEl.value = localStorage.getItem(workspaceStorageKey) ?? "";
workspaceStateEl.textContent = workspaceEl.value ? compactPath(workspaceEl.value) : "";
renderWorkspaceHistory();
renderEvents();
autoResizeTask();

void refreshStatus().catch((error) => {
  readinessEl.textContent = "Not ready";
  readinessEl.dataset.ready = "false";
  rawEl.textContent = error instanceof Error ? error.message : String(error);
});
