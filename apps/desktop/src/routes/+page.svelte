<script lang="ts">
  import { onMount } from "svelte";
  import { projectInfo, type Session, type StartupIssue } from "@relay-agent/contracts";
  import { createSession, initializeApp, listSessions, pingDesktop } from "$lib";

  let ping = "loading";
  let ipcStatus = "loading";
  let storageMode = "unavailable";
  let sessionCount = "0";
  let supportedModes = "loading";
  let startupStatus = "loading";
  let startupIssue: StartupIssue | null = null;
  let temporaryModeEnabled = false;

  let sessions: Session[] = [];
  let sessionsLoading = true;
  let homeError = "";

  let title = "";
  let objective = "";
  let primaryWorkbookPath = "";
  let createPending = false;
  let createError = "";
  let createSuccess = "";

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "The desktop command failed before the Home route could finish the request.";
  }

  function sortSessions(items: Session[]): Session[] {
    return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function syncSessionCount(): void {
    sessionCount = String(sessions.length);
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function canRetryStartupChecks(): boolean {
    return startupIssue?.recoveryActions.includes("retryInit") ?? false;
  }

  function canContinueTemporaryMode(): boolean {
    return startupIssue?.recoveryActions.includes("continueTemporaryMode") ?? false;
  }

  function enableTemporaryMode(): void {
    temporaryModeEnabled = true;
  }

  $: createBlockedByStartup = Boolean(startupIssue) && !temporaryModeEnabled;

  async function loadHome(): Promise<void> {
    sessionsLoading = true;
    homeError = "";
    createSuccess = "";

    const [pingResult, appResult, sessionsResult] = await Promise.allSettled([
      pingDesktop(),
      initializeApp(),
      listSessions()
    ]);

    ping = pingResult.status === "fulfilled" ? pingResult.value : "tauri-unavailable";

    if (appResult.status === "fulfilled") {
      ipcStatus = appResult.value.initialized ? "ready" : "pending";
      storageMode = appResult.value.storageMode;
      supportedModes = appResult.value.supportedRelayModes.join(", ");
      sessionCount = String(appResult.value.sessionCount);
      startupStatus = appResult.value.startupStatus;
      startupIssue = appResult.value.startupIssue ?? null;

      if (!startupIssue) {
        temporaryModeEnabled = false;
      }
    } else {
      ipcStatus = "tauri-unavailable";
      storageMode = "unavailable";
      supportedModes = "unavailable";
      startupStatus = "attention";
      startupIssue = null;
      homeError = toErrorMessage(appResult.reason);
    }

    if (sessionsResult.status === "fulfilled") {
      sessions = sortSessions(sessionsResult.value);
      syncSessionCount();
    } else {
      sessions = [];
      homeError = homeError || toErrorMessage(sessionsResult.reason);
    }

    sessionsLoading = false;
  }

  async function handleCreateSession(): Promise<void> {
    createPending = true;
    createError = "";
    createSuccess = "";

    try {
      const createdSession = await createSession({
        title,
        objective,
        primaryWorkbookPath: primaryWorkbookPath.trim() || undefined
      });

      sessions = sortSessions([
        createdSession,
        ...sessions.filter((existingSession) => existingSession.id !== createdSession.id)
      ]);
      syncSessionCount();

      createSuccess = `Session "${createdSession.title}" is ready for Studio selection.`;
      title = "";
      objective = "";
      primaryWorkbookPath = "";
    } catch (error) {
      createError = toErrorMessage(error);
    } finally {
      createPending = false;
    }
  }

  onMount(async () => {
    await loadHome();
  });
</script>

<svelte:head>
  <title>Relay Agent | Home</title>
</svelte:head>

<div class="ra-view">
  <section class="ra-hero">
    <p class="ra-eyebrow">Home route</p>
    <h1 class="ra-headline">Create sessions and reopen the work that already lives on disk.</h1>
    <p class="ra-lede">
      Home now fronts the persisted session store. You can create a new session, see the
      saved list that survived restart, and hand any existing session into Studio for the
      next relay step.
    </p>
  </section>

  <section class="ra-chip-row" aria-label="Primary route links">
    <a class="route-chip" href="/studio">Open Studio shell</a>
    <a class="route-chip" href="/settings">Review MVP policies</a>
    <button class="route-chip action-chip" type="button" on:click={() => void loadHome()}>
      Refresh sessions
    </button>
  </section>

  {#if homeError}
    <section class="feedback feedback-error" aria-live="polite">
      <strong>Home load issue</strong>
      <p>{homeError}</p>
    </section>
  {/if}

  {#if startupIssue}
    <section class="feedback feedback-warning" aria-live="polite">
      <strong>{startupIssue.problem}</strong>
      <p>{startupIssue.reason}</p>

      {#if startupIssue.storagePath}
        <p class="feedback-detail">
          Storage path: <code>{startupIssue.storagePath}</code>
        </p>
      {/if}

      {#if startupIssue.nextSteps.length > 0}
        <ul class="feedback-list">
          {#each startupIssue.nextSteps as step}
            <li>{step}</li>
          {/each}
        </ul>
      {/if}

      <div class="feedback-actions">
        {#if canRetryStartupChecks()}
          <button class="route-chip action-chip" type="button" on:click={() => void loadHome()}>
            Retry startup checks
          </button>
        {/if}

        {#if canContinueTemporaryMode() && !temporaryModeEnabled}
          <button class="route-chip action-chip" type="button" on:click={enableTemporaryMode}>
            Continue in temporary mode
          </button>
        {/if}

        <a class="route-chip" href="/settings">Open settings</a>
      </div>
    </section>
  {/if}

  <section class="home-grid">
    <article class="ra-panel create-panel">
      <div class="panel-heading">
        <div>
          <p class="panel-eyebrow">Create session</p>
          <h2>Start a new objective</h2>
        </div>
        <span class={`status-pill status-${startupStatus}`}>{startupStatus}</span>
      </div>

      <p class="panel-copy">
        {#if createBlockedByStartup}
          Startup checks still need attention before saved work can be created.
        {:else if temporaryModeEnabled}
          Temporary mode is active. New sessions will work for this run, but they will not survive restart.
        {:else}
          Sessions persist immediately through the typed IPC layer. The workbook path stays
          optional until the CSV and Studio flows are wired further.
        {/if}
      </p>

      <form class="session-form" on:submit|preventDefault={() => void handleCreateSession()}>
        <label>
          <span>Title</span>
          <input bind:value={title} maxlength="120" placeholder="Revenue cleanup Q2" required />
        </label>

        <label>
          <span>Objective</span>
          <textarea
            bind:value={objective}
            rows="4"
            placeholder="Normalize the inbound CSV and prepare a safe save-copy plan."
            required
          ></textarea>
        </label>

        <label>
          <span>Primary workbook path</span>
          <input
            bind:value={primaryWorkbookPath}
            placeholder="/tmp/revenue-q2.csv"
          />
        </label>

        {#if createBlockedByStartup}
          <p class="form-message form-warning" aria-live="polite">
            Resolve the startup issue or choose temporary mode before creating a session.
          </p>
        {/if}

        {#if createError}
          <p class="form-message form-error" aria-live="polite">{createError}</p>
        {/if}

        {#if createSuccess}
          <p class="form-message form-success" aria-live="polite">{createSuccess}</p>
        {/if}

        <button
          class="primary-button"
          disabled={createPending || ipcStatus !== "ready" || createBlockedByStartup}
          type="submit"
        >
          {createPending ? "Creating session..." : "Create session"}
        </button>
      </form>
    </article>

    <article class="ra-panel session-panel">
      <div class="panel-heading">
        <div>
          <p class="panel-eyebrow">Persisted sessions</p>
          <h2>Session list</h2>
        </div>
        <span class="status-pill">{sessionCount} total</span>
      </div>

      <p class="panel-copy">
        The list below comes from `list_sessions` against local JSON storage, not from
        in-page mock state.
      </p>

      {#if sessionsLoading}
        <div class="empty-state">
          <h3>Loading sessions</h3>
          <p>Reading persisted records from the app-local storage directory.</p>
        </div>
      {:else if sessions.length === 0}
        <div class="empty-state">
          <h3>No sessions yet</h3>
          <p>Create the first session here, then continue into Studio.</p>
        </div>
      {:else}
        <div class="session-list">
          {#each sessions as session}
            <article class="session-card">
              <div class="session-card-head">
                <div>
                  <h3>{session.title}</h3>
                  <p>{session.objective}</p>
                </div>
                <span class={`status-pill status-${session.status}`}>{session.status}</span>
              </div>

              <div class="session-meta">
                <span>{session.turnIds.length} {session.turnIds.length === 1 ? "turn" : "turns"}</span>
                <span>Updated {formatDate(session.updatedAt)}</span>
                {#if session.primaryWorkbookPath}
                  <span title={session.primaryWorkbookPath}>{session.primaryWorkbookPath}</span>
                {/if}
              </div>

              <div class="session-actions">
                <a class="session-link" href={`/studio?sessionId=${session.id}`}>Open in Studio</a>
                <span class="session-id" title={session.id}>{session.id}</span>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </article>
  </section>

  <section class="ra-panel-grid">
    <article class="ra-panel">
      <h2>System snapshot</h2>
      <dl class="metrics">
        <div>
          <dt>Stage</dt>
          <dd>{projectInfo.stage}</dd>
        </div>
        <div>
          <dt>Startup status</dt>
          <dd>{startupStatus}</dd>
        </div>
        <div>
          <dt>IPC status</dt>
          <dd>{ipcStatus}</dd>
        </div>
        <div>
          <dt>Desktop ping</dt>
          <dd>{ping}</dd>
        </div>
        <div>
          <dt>Storage mode</dt>
          <dd>{storageMode}</dd>
        </div>
        <div>
          <dt>Session count</dt>
          <dd>{sessionCount}</dd>
        </div>
        <div>
          <dt>Relay modes</dt>
          <dd>{supportedModes}</dd>
        </div>
      </dl>
    </article>

    <article class="ra-panel">
      <h2>What lands next</h2>
      <ul class="ra-list">
        <li>Studio pane state bound to the selected session</li>
        <li>Turn start flow and relay packet generation</li>
        <li>Validation feedback and preview initiation from Studio</li>
      </ul>
    </article>
  </section>
</div>

<style>
  .route-chip {
    padding: 0.7rem 1rem;
    border: 1px solid var(--ra-border-strong);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    color: var(--ra-text);
    font-weight: 600;
    font: inherit;
    transition:
      transform 160ms ease,
      border-color 160ms ease;
  }

  .route-chip:hover {
    transform: translateY(-0.08rem);
    border-color: var(--ra-accent);
  }

  .action-chip {
    cursor: pointer;
  }

  .feedback {
    padding: 1rem 1.1rem;
    border-radius: 1rem;
    border: 1px solid transparent;
  }

  .feedback strong,
  .feedback p {
    margin: 0;
  }

  .feedback p {
    margin-top: 0.35rem;
  }

  .feedback-error {
    border-color: rgba(141, 45, 31, 0.22);
    background: rgba(141, 45, 31, 0.08);
    color: #7f2a20;
  }

  .feedback-warning {
    border-color: rgba(138, 90, 23, 0.24);
    background: rgba(138, 90, 23, 0.08);
    color: #7a5316;
  }

  .feedback-detail {
    font-size: 0.92rem;
    word-break: break-word;
  }

  .feedback-list {
    margin: 0.75rem 0 0;
    padding-left: 1.15rem;
  }

  .feedback-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin-top: 0.9rem;
  }

  .home-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
  }

  .create-panel,
  .session-panel {
    display: grid;
    align-content: start;
    gap: 1rem;
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .panel-heading h2 {
    margin: 0.2rem 0 0;
  }

  .panel-eyebrow {
    margin: 0;
    color: var(--ra-accent);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .panel-copy {
    margin: 0;
    color: var(--ra-muted);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    color: var(--ra-muted);
    font-size: 0.86rem;
    font-weight: 700;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .status-ready,
  .status-active {
    border-color: rgba(91, 125, 56, 0.28);
    color: #456626;
    background: rgba(91, 125, 56, 0.1);
  }

  .status-draft,
  .status-pending {
    border-color: rgba(138, 90, 23, 0.28);
    color: #8a5a17;
    background: rgba(138, 90, 23, 0.08);
  }

  .status-tauri-unavailable {
    border-color: rgba(141, 45, 31, 0.28);
    color: #7f2a20;
    background: rgba(141, 45, 31, 0.08);
  }

  .status-attention {
    border-color: rgba(138, 90, 23, 0.28);
    color: #8a5a17;
    background: rgba(138, 90, 23, 0.08);
  }

  .session-form {
    display: grid;
    gap: 0.95rem;
  }

  .session-form label {
    display: grid;
    gap: 0.45rem;
  }

  .session-form span {
    font-size: 0.92rem;
    font-weight: 700;
  }

  .session-form input,
  .session-form textarea {
    width: 100%;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 0.85rem;
    background: rgba(255, 255, 255, 0.95);
    color: var(--ra-text);
    font: inherit;
  }

  .session-form textarea {
    resize: vertical;
    min-height: 7rem;
  }

  .session-form input:focus,
  .session-form textarea:focus {
    outline: 2px solid rgba(138, 90, 23, 0.18);
    border-color: var(--ra-accent);
  }

  .form-message {
    margin: 0;
    font-size: 0.92rem;
  }

  .form-error {
    color: #7f2a20;
  }

  .form-warning {
    color: #8a5a17;
  }

  .form-success {
    color: #456626;
  }

  .primary-button {
    padding: 0.85rem 1rem;
    border: 0;
    border-radius: 0.95rem;
    background: linear-gradient(135deg, #8a5a17 0%, #5b7d38 100%);
    color: #fffdf7;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .primary-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .session-list {
    display: grid;
    gap: 0.9rem;
  }

  .session-card {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.76);
  }

  .session-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .session-card-head h3 {
    margin: 0;
    font-family: var(--ra-font-display);
    font-size: 1.25rem;
  }

  .session-card-head p {
    margin: 0.45rem 0 0;
    color: var(--ra-muted);
    line-height: 1.55;
  }

  .session-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    color: var(--ra-muted);
    font-size: 0.92rem;
  }

  .session-meta span {
    padding: 0.35rem 0.55rem;
    border-radius: 999px;
    background: rgba(31, 45, 36, 0.05);
  }

  .session-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .session-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.65rem 0.9rem;
    border: 1px solid var(--ra-border-strong);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    font-weight: 700;
  }

  .session-id {
    color: var(--ra-muted);
    font-size: 0.84rem;
  }

  .empty-state {
    display: grid;
    gap: 0.45rem;
    padding: 1.1rem;
    border: 1px dashed var(--ra-border-strong);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.54);
  }

  .empty-state h3,
  .empty-state p {
    margin: 0;
  }

  .empty-state p {
    color: var(--ra-muted);
  }

  .metrics {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .metrics div {
    padding: 1rem;
    border-radius: 1rem;
    background: rgba(31, 45, 36, 0.05);
  }

  .metrics dt {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ra-muted);
  }

  .metrics dd {
    margin: 0.4rem 0 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  @media (max-width: 960px) {
    .home-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .panel-heading,
    .session-card-head,
    .session-actions {
      grid-template-columns: 1fr;
      display: grid;
      justify-content: stretch;
    }

    .session-actions {
      justify-items: start;
    }
  }
</style>
