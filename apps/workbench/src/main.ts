import "./styles.css";

type StatusResponse = {
  app: string;
  version: string;
  ready: boolean;
  checks: ReadonlyArray<{
    name: string;
    ready: boolean;
    detail: string;
  }>;
};

type RunEvent = {
  type: "status" | "tool" | "approval" | "final" | "error";
  message: string;
  detail?: string;
};

type RunResponse = {
  runId: string;
  status: "completed" | "failed";
  events: RunEvent[];
};

const token = new URLSearchParams(window.location.search).get("token") ?? "";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <section class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Relay Agent</p>
        <h1>Workbench</h1>
      </div>
      <div class="status-pill" id="readiness">Checking</div>
    </header>

    <section class="composer-panel">
      <label class="field-label" for="workspace">Workspace</label>
      <input id="workspace" class="workspace-input" placeholder="/path/to/workspace" />

      <label class="field-label" for="instruction">Task</label>
      <textarea id="instruction" class="task-input" rows="5" placeholder="部品売上に関するファイルを探して"></textarea>

      <div class="actions">
        <button id="send" class="primary-button">送信</button>
        <button id="refresh" class="secondary-button">状態を更新</button>
      </div>
    </section>

    <section class="run-panel" aria-live="polite">
      <div class="run-header">
        <h2>Run</h2>
        <span id="run-id"></span>
      </div>
      <ol id="events" class="events"></ol>
    </section>

    <details class="details">
      <summary>Details</summary>
      <pre id="raw"></pre>
    </details>
  </section>
`;

const readinessEl = document.querySelector<HTMLElement>("#readiness")!;
const workspaceEl = document.querySelector<HTMLInputElement>("#workspace")!;
const instructionEl = document.querySelector<HTMLTextAreaElement>("#instruction")!;
const sendEl = document.querySelector<HTMLButtonElement>("#send")!;
const refreshEl = document.querySelector<HTMLButtonElement>("#refresh")!;
const eventsEl = document.querySelector<HTMLOListElement>("#events")!;
const rawEl = document.querySelector<HTMLPreElement>("#raw")!;
const runIdEl = document.querySelector<HTMLElement>("#run-id")!;

function api(path: string): string {
  const url = new URL(path, window.location.origin);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function renderEvents(events: readonly RunEvent[]): void {
  eventsEl.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("li");
      item.className = `event event-${event.type}`;
      const title = document.createElement("strong");
      title.textContent = event.message;
      item.append(title);
      if (event.detail) {
        const detail = document.createElement("p");
        detail.textContent = event.detail;
        item.append(detail);
      }
      return item;
    }),
  );
}

async function refreshStatus(): Promise<void> {
  const response = await fetch(api("/api/status"), {
    headers: token ? { "X-Relay-Token": token } : {},
  });
  if (!response.ok) throw new Error(`Status failed: ${response.status}`);
  const status = (await response.json()) as StatusResponse;
  readinessEl.textContent = status.ready ? "Ready" : "Not ready";
  readinessEl.dataset.ready = String(status.ready);
  rawEl.textContent = JSON.stringify(status, null, 2);
}

async function runTask(): Promise<void> {
  sendEl.disabled = true;
  eventsEl.replaceChildren();
  runIdEl.textContent = "";
  try {
    const response = await fetch(api("/api/runs"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Relay-Token": token } : {}),
      },
      body: JSON.stringify({
        instruction: instructionEl.value,
        workspace: workspaceEl.value,
      }),
    });
    const result = (await response.json()) as RunResponse;
    runIdEl.textContent = result.runId;
    renderEvents(result.events);
    rawEl.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    renderEvents([{
      type: "error",
      message: "完了できませんでした",
      detail: error instanceof Error ? error.message : String(error),
    }]);
  } finally {
    sendEl.disabled = false;
  }
}

refreshEl.addEventListener("click", () => {
  void refreshStatus().catch((error) => {
    readinessEl.textContent = "Not ready";
    readinessEl.dataset.ready = "false";
    rawEl.textContent = error instanceof Error ? error.message : String(error);
  });
});
sendEl.addEventListener("click", () => void runTask());

void refreshStatus().catch((error) => {
  readinessEl.textContent = "Not ready";
  readinessEl.dataset.ready = "false";
  rawEl.textContent = error instanceof Error ? error.message : String(error);
});
