<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    projectInfo,
    type PreflightWorkbookResponse,
    type Session,
    type StartupIssue
  } from "@relay-agent/contracts";
  import {
    listAuditHistory,
    createSession,
    discardStudioDraft,
    initializeApp,
    listRecoverableStudioDrafts,
    listRecentFiles,
    listRecentSessions,
    listSessions,
    markStudioDraftClean,
    pingDesktop,
    preflightWorkbook,
    rememberRecentFile,
    rememberRecentSession,
    type AuditHistoryEntry,
    type PersistedStudioDraft,
    type RecentFile,
    type RecentSession
  } from "$lib";

  type ObjectiveStarter = {
    label: string;
    objective: string;
    note: string;
  };
  type HelpEntry = {
    term: string;
    detail: string;
    action: string;
  };
  type QuickStartTemplate = {
    label: string;
    title: string;
    objective: string;
    note: string;
  };

  const sampleObjectiveStarters: ObjectiveStarter[] = [
    {
      label: "Show changes first",
      objective: "Open the sample file, show what would change, and save a safe copy.",
      note: "Good for a first walkthrough."
    },
    {
      label: "Keep approved rows",
      objective: "Keep approved rows, explain the planned changes, and save a safe copy.",
      note: "Matches the bundled demo workflow."
    },
    {
      label: "Check for risks",
      objective: "Inspect the sample file, point out anything risky, and prepare a safe copy plan.",
      note: "Useful when you want more explanation before saving."
    }
  ];
  const customObjectiveStarters: ObjectiveStarter[] = [
    {
      label: "Check my file safely",
      objective: "Open my workbook, show the planned changes, and save a separate safe copy.",
      note: "A simple default for first use."
    },
    {
      label: "Filter what I need",
      objective: "Keep only the rows I need, explain the result, and save a separate copy.",
      note: "Good for cleanup or review work."
    },
    {
      label: "Rename some columns",
      objective: "Rename the columns I choose, show the impact, and save a separate copy.",
      note: "Useful when column names need to be cleaned up."
    }
  ];
  const genericObjectiveStarters: ObjectiveStarter[] = [
    sampleObjectiveStarters[0],
    customObjectiveStarters[0],
    customObjectiveStarters[1]
  ];
  const sampleQuickStartTemplates: QuickStartTemplate[] = [
    {
      label: "Filter rows",
      title: "Approved sample review",
      objective: "Keep approved rows from the sample, explain what changed, and save a separate copy.",
      note: "A safe first walkthrough on the bundled file."
    },
    {
      label: "Add a new column",
      title: "Sample review label",
      objective: "Add a review label to the sample rows, show the impact, and save a separate copy.",
      note: "Good for learning preview before save."
    },
    {
      label: "Summarize totals",
      title: "Sample totals summary",
      objective: "Group the sample data into totals, explain the result, and save a separate copy.",
      note: "Useful for aggregate-style work."
    }
  ];
  const customQuickStartTemplates: QuickStartTemplate[] = [
    {
      label: "Rename columns",
      title: "Column rename cleanup",
      objective: "Rename the columns I choose, explain the impact, and save a separate copy.",
      note: "Good when headers need cleanup."
    },
    {
      label: "Change data types",
      title: "Column type cleanup",
      objective: "Fix the column types I choose, explain the impact, and save a separate copy.",
      note: "Useful when dates or numbers are inconsistent."
    },
    {
      label: "Filter rows",
      title: "Filtered workbook copy",
      objective: "Keep only the rows I need, explain the result, and save a separate copy.",
      note: "Good for reducing a large sheet."
    },
    {
      label: "Summarize totals",
      title: "Workbook totals summary",
      objective: "Summarize the rows I choose into totals, explain the result, and save a separate copy.",
      note: "Useful for aggregate reports."
    }
  ];

  let ping = "loading";
  let ipcStatus = "loading";
  let storageMode = "unavailable";
  let storagePath: string | null = null;
  let sessionCount = "0";
  let supportedModes = "loading";
  let startupStatus = "loading";
  let startupIssue: StartupIssue | null = null;
  let temporaryModeEnabled = false;
  let sampleWorkbookPath: string | null = null;
  let entryMode: "sample" | "custom" | null = null;
  let startupDiagnosticMessage = "";
  let startupDiagnosticError = "";

  let sessions: Session[] = [];
  let recentSessions: RecentSession[] = [];
  let recentFiles: RecentFile[] = [];
  let auditHistory: AuditHistoryEntry[] = [];
  let recoverableDrafts: PersistedStudioDraft[] = [];
  let sessionsLoading = true;
  let homeError = "";

  let title = "";
  let objective = "";
  let primaryWorkbookPath = "";
  let workbookPreflight: PreflightWorkbookResponse | null = null;
  let preflightPending = false;
  let preflightError = "";
  let lastPreflightPath = "";
  let createPending = false;
  let createError = "";
  let createSuccess = "";
  let homeHelpOpen = false;
  let titleInput: HTMLInputElement | undefined;
  let workbookPathInput: HTMLInputElement | undefined;
  let createButton: HTMLButtonElement | undefined;

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

  function loadRecentWork(): void {
    recentSessions = listRecentSessions();
    recentFiles = listRecentFiles();
    auditHistory = listAuditHistory();
    recoverableDrafts = listRecoverableStudioDrafts();
  }

  function describeRecoverySession(draft: PersistedStudioDraft): string {
    return (
      sessions.find((session) => session.id === draft.sessionId)?.title ??
      recentSessions.find((session) => session.sessionId === draft.sessionId)?.title ??
      `Session ${draft.sessionId.slice(0, 8)}`
    );
  }

  function acknowledgeRecoveryDraft(sessionId: string): void {
    markStudioDraftClean(sessionId);
    loadRecentWork();
  }

  function discardRecoveryDraft(sessionId: string): void {
    discardStudioDraft(sessionId);
    loadRecentWork();
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function formatFileSize(value: number): string {
    const kib = 1024;
    const mib = kib * 1024;

    if (value >= mib) {
      return `${(value / mib).toFixed(1)} MB`;
    }

    if (value >= kib) {
      return `${(value / kib).toFixed(1)} KB`;
    }

    return `${value} bytes`;
  }

  function formatWorkbookFormat(value: PreflightWorkbookResponse["format"]): string {
    return value === "xlsx" ? "Excel workbook" : "CSV";
  }

  function preflightTone(
    status: PreflightWorkbookResponse["status"]
  ): "ready" | "warning" | "error" {
    if (status === "blocked") {
      return "error";
    }

    if (status === "warning") {
      return "warning";
    }

    return "ready";
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

  function clearWorkbookPreflight(): void {
    workbookPreflight = null;
    preflightPending = false;
    preflightError = "";
    lastPreflightPath = "";
  }

  function handleWorkbookPathInput(): void {
    createError = "";
    createSuccess = "";

    if (primaryWorkbookPath.trim() !== lastPreflightPath) {
      workbookPreflight = null;
      preflightError = "";
    }
  }

  async function runWorkbookPreflight(force = false): Promise<PreflightWorkbookResponse | null> {
    const workbookPath = primaryWorkbookPath.trim();

    if (!workbookPath) {
      clearWorkbookPreflight();
      return null;
    }

    if (!force && workbookPath === lastPreflightPath && workbookPreflight) {
      return workbookPreflight;
    }

    preflightPending = true;
    preflightError = "";

    try {
      const result = await preflightWorkbook({ workbookPath });
      workbookPreflight = result;
      lastPreflightPath = workbookPath;
      return result;
    } catch (error) {
      workbookPreflight = null;
      preflightError = toErrorMessage(error);
      return null;
    } finally {
      preflightPending = false;
    }
  }

  $: createBlockedByStartup = Boolean(startupIssue) && !temporaryModeEnabled;
  $: showFirstRunWelcome = !sessionsLoading && sessions.length === 0;
  $: showPermissionRationale = showFirstRunWelcome || entryMode === "custom";
  $: sampleFlowAvailable = Boolean(sampleWorkbookPath);
  $: workbookPathNeedsRecheck =
    primaryWorkbookPath.trim().length > 0 && primaryWorkbookPath.trim() !== lastPreflightPath;
  $: objectiveStarters =
    entryMode === "sample"
      ? sampleObjectiveStarters
      : entryMode === "custom"
        ? customObjectiveStarters
        : genericObjectiveStarters;
  $: quickStartTemplates =
    entryMode === "sample"
      ? sampleQuickStartTemplates
      : customQuickStartTemplates;
  $: showGuidedStartGate = showFirstRunWelcome && entryMode === null;
  $: homeHelpEntries = showGuidedStartGate
    ? [
        {
          term: "Try the sample flow",
          detail: "Uses the bundled workbook so you can learn the steps without touching your own file first.",
          action: "Choose this when you want a low-risk walkthrough."
        },
        {
          term: "Use my own file",
          detail: "Opens the same guided form, but for a workbook path you already know.",
          action: "Choose this when you want to work on a real file right away."
        },
        {
          term: "Next step",
          detail: "After you choose one path, Relay Agent opens the form and gives example wording for your goal.",
          action: "Pick one start option above to continue."
        }
      ]
    : [
        {
          term: "Task name",
          detail: "A short label so you can spot this work later in Home and Studio.",
          action: "Keep it short and recognizable."
        },
        {
          term: "What do you want done?",
          detail: "Describe the business result you want in everyday language instead of technical commands.",
          action: "Say what should change, then let Relay Agent guide the steps."
        },
        {
          term: "Check this file",
          detail: "Runs a quick readiness check so unreadable or risky files are caught before Studio starts.",
          action: "Use it after choosing or editing the file path."
        }
      ] satisfies HelpEntry[];

  async function startSampleFlow(): Promise<void> {
    entryMode = "sample";
    createError = "";
    createSuccess = "";

    if (!sampleWorkbookPath) {
      return;
    }

    title = title.trim() ? title : "Bundled sample walkthrough";
    objective = objective.trim()
      ? objective
      : "Open the bundled sample CSV, review the changes, and prepare a safe save-copy plan.";
    primaryWorkbookPath = sampleWorkbookPath;

    await tick();
    await runWorkbookPreflight(true);
    createButton?.focus();
  }

  async function startCustomFlow(): Promise<void> {
    entryMode = "custom";
    createError = "";
    createSuccess = "";

    title = title.trim() ? title : "My first workbook task";
    objective = objective.trim()
      ? objective
      : "Open my workbook, check the planned changes, and save a safe copy.";

    if (sampleWorkbookPath && primaryWorkbookPath === sampleWorkbookPath) {
      primaryWorkbookPath = "";
    }

    clearWorkbookPreflight();

    await tick();
    workbookPathInput?.focus();
  }

  function useObjectiveStarter(starter: ObjectiveStarter): void {
    objective = starter.objective;
    createError = "";
    createSuccess = "";
  }

  function applyQuickStartTemplate(template: QuickStartTemplate): void {
    title = template.title;
    objective = template.objective;
    createError = "";
    createSuccess = "";
  }

  function buildStartupDiagnosticText(): string {
    const lines = [
      "Relay Agent startup summary",
      `startupStatus: ${startupStatus}`,
      `storageMode: ${storageMode}`,
      `sessionCount: ${sessionCount}`,
      `supportedRelayModes: ${supportedModes}`
    ];

    if (startupIssue) {
      lines.push(`problem: ${startupIssue.problem}`);
      lines.push(`reason: ${startupIssue.reason}`);
      if (startupIssue.storagePath) {
        lines.push(`storagePath: ${startupIssue.storagePath}`);
      }
      if (startupIssue.nextSteps.length > 0) {
        lines.push(`nextSteps: ${startupIssue.nextSteps.join(" | ")}`);
      }
    }

    return lines.join("\n");
  }

  async function copyStartupDetails(): Promise<void> {
    startupDiagnosticMessage = "";
    startupDiagnosticError = "";

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is not available in this build.");
      }

      await navigator.clipboard.writeText(buildStartupDiagnosticText());
      startupDiagnosticMessage = "Startup details copied. Share them with support if the problem continues.";
    } catch (error) {
      startupDiagnosticError = toErrorMessage(error);
    }
  }

  async function loadHome(): Promise<void> {
    sessionsLoading = true;
    homeError = "";
    createSuccess = "";
    startupDiagnosticMessage = "";
    startupDiagnosticError = "";

    const [pingResult, appResult, sessionsResult] = await Promise.allSettled([
      pingDesktop(),
      initializeApp(),
      listSessions()
    ]);

    ping = pingResult.status === "fulfilled" ? pingResult.value : "tauri-unavailable";

    if (appResult.status === "fulfilled") {
      ipcStatus = appResult.value.initialized ? "ready" : "pending";
      storageMode = appResult.value.storageMode;
      storagePath = appResult.value.storagePath ?? appResult.value.startupIssue?.storagePath ?? null;
      supportedModes = appResult.value.supportedRelayModes.join(", ");
      sessionCount = String(appResult.value.sessionCount);
      startupStatus = appResult.value.startupStatus;
      startupIssue = appResult.value.startupIssue ?? null;
      sampleWorkbookPath = appResult.value.sampleWorkbookPath ?? null;

      if (!startupIssue) {
        temporaryModeEnabled = false;
      }
    } else {
      ipcStatus = "tauri-unavailable";
      storageMode = "unavailable";
      storagePath = null;
      supportedModes = "unavailable";
      startupStatus = "attention";
      startupIssue = null;
      sampleWorkbookPath = null;
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
      const workbookPath = primaryWorkbookPath.trim();

      if (workbookPath) {
        const preflightResult = await runWorkbookPreflight(true);

        if (!preflightResult) {
          createError =
            preflightError || "Relay Agent could not finish the file check for this workbook.";
          return;
        }

        if (preflightResult.status === "blocked") {
          createError = preflightResult.summary;
          return;
        }
      } else {
        clearWorkbookPreflight();
      }

      const createdSession = await createSession({
        title,
        objective,
        primaryWorkbookPath: workbookPath || undefined
      });

      rememberRecentSession({
        sessionId: createdSession.id,
        title: createdSession.title,
        workbookPath: createdSession.primaryWorkbookPath ?? "",
        lastOpenedAt: new Date().toISOString(),
        lastTurnTitle: ""
      });

      if (workbookPath) {
        rememberRecentFile({
          path: workbookPath,
          lastUsedAt: new Date().toISOString(),
          sessionId: createdSession.id,
          source: "session"
        });
      }

      loadRecentWork();

      sessions = sortSessions([
        createdSession,
        ...sessions.filter((existingSession) => existingSession.id !== createdSession.id)
      ]);
      syncSessionCount();

      createSuccess = `Session "${createdSession.title}" is ready for Studio selection.`;
      title = "";
      objective = "";
      primaryWorkbookPath = "";
      clearWorkbookPreflight();
    } catch (error) {
      createError = toErrorMessage(error);
    } finally {
      createPending = false;
    }
  }

  onMount(async () => {
    await loadHome();
    loadRecentWork();
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

        <button class="route-chip action-chip" type="button" on:click={() => void copyStartupDetails()}>
          Copy startup details
        </button>
        <a class="route-chip" href="/settings">Open settings</a>
      </div>

      {#if startupDiagnosticError}
        <p class="form-message form-error" aria-live="polite">{startupDiagnosticError}</p>
      {/if}

      {#if startupDiagnosticMessage}
        <p class="form-message form-success" aria-live="polite">{startupDiagnosticMessage}</p>
      {/if}
    </section>
  {/if}

  {#if recoverableDrafts.length > 0}
    <section class="feedback feedback-warning" aria-live="polite">
      <strong>Recovery available</strong>
      <p>
        Relay Agent found locally autosaved work from a previous run that did not close cleanly.
        Restore it in Studio or discard it here.
      </p>

      <div class="recovery-list">
        {#each recoverableDrafts as draft}
          <article class="recovery-card">
            <div class="session-card-head">
              <div>
                <h3>{describeRecoverySession(draft)}</h3>
                <p>{draft.selectedTurnTitle || draft.turnTitle || "In-progress draft"}</p>
              </div>
              <span class="status-pill status-attention">recovery</span>
            </div>

            <div class="session-meta">
              <span>Saved {formatDate(draft.lastUpdatedAt)}</span>
              {#if draft.workbookPath}
                <span title={draft.workbookPath}>{draft.workbookPath}</span>
              {/if}
            </div>

            <div class="feedback-actions">
              <a
                class="session-link"
                href={`/studio?sessionId=${draft.sessionId}`}
                on:click={() => acknowledgeRecoveryDraft(draft.sessionId)}
              >
                Restore in Studio
              </a>
              <button
                class="route-chip action-chip"
                type="button"
                on:click={() => discardRecoveryDraft(draft.sessionId)}
              >
                Discard saved draft
              </button>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if showFirstRunWelcome}
    <section class="first-run-grid">
      <article class="ra-panel first-run-panel">
        <p class="panel-eyebrow">First run</p>
        <h2>Start safely with one clear choice.</h2>
        <p class="panel-copy">
          Relay Agent always writes a copy. Your original workbook stays unchanged while you
          review the plan first.
        </p>

        <div class="welcome-actions">
          <button
            class="primary-button"
            disabled={!sampleFlowAvailable}
            type="button"
            on:click={() => void startSampleFlow()}
          >
            Try the sample flow
          </button>
          <button class="route-chip action-chip" type="button" on:click={() => void startCustomFlow()}>
            Use my own file
          </button>
        </div>

        <ul class="welcome-list">
          <li>Start with the bundled sample if you want a low-risk walkthrough.</li>
          <li>Use your own file if you already know what workbook you want to inspect.</li>
          <li>Every write stays save-copy only, so the source file is not overwritten.</li>
        </ul>

        {#if !sampleFlowAvailable}
          <p class="form-message form-warning">
            This build does not currently expose the bundled sample path, so the custom-file path is the safe starting point.
          </p>
        {/if}
      </article>

      <article class="ra-panel permission-panel">
        <p class="panel-eyebrow">Before Windows asks</p>
        <h2>Why access prompts appear</h2>
        <ul class="ra-list">
          <li>Relay Agent needs access to the file you choose so it can inspect it safely.</li>
          <li>When you save a copy, Windows may also ask for access to the destination you picked.</li>
          <li>The original workbook is still treated as read-only and is not overwritten.</li>
        </ul>
      </article>
    </section>
  {/if}

  <section class="home-grid">
    <article class="ra-panel create-panel">
      <div class="panel-heading">
        <div>
          <p class="panel-eyebrow">Create session</p>
          <h2>{showFirstRunWelcome ? "Start your first task" : "Start a new task"}</h2>
        </div>
        <span class={`status-pill status-${startupStatus}`}>{startupStatus}</span>
      </div>

      <p class="panel-copy">
        {#if createBlockedByStartup}
          Startup checks still need attention before saved work can be created.
        {:else if showGuidedStartGate}
          Start with one choice above. After that, Relay Agent will guide you
          through describing the result you want in plain language.
        {:else if temporaryModeEnabled}
          Temporary mode is active. New sessions will work for this run, but they will not survive restart.
        {:else if entryMode === "sample"}
          Step 2 of 3: the bundled sample path is loaded. Describe what you want to happen, then create the session.
        {:else if entryMode === "custom"}
          Step 2 of 3: describe the result you want, then add the file Relay Agent should inspect.
        {:else}
          Describe the result you want and Relay Agent will store that task here before Studio begins.
        {/if}
      </p>

      <section class="feedback feedback-info" aria-live="polite">
        <strong>File safety</strong>
        <p>
          Relay Agent keeps the original workbook read-only. After review, it writes a separate
          copy instead of overwriting the source file.
        </p>
      </section>

      {#if showGuidedStartGate}
        <div class="guided-start-card">
          <p class="panel-eyebrow">First-time steps</p>
          <h3>Pick one starting path first.</h3>
          <ol class="guided-step-list">
            <li>Choose `Try the sample flow` for a safe walkthrough, or `Use my own file` for real work.</li>
            <li>Describe the business result you want in everyday language.</li>
            <li>Check the file path and create the session when the form looks right.</li>
          </ol>
        </div>
      {:else}
        {#if showPermissionRationale && !showFirstRunWelcome}
          <div class="permission-inline-note">
            <strong>Before Windows asks for access</strong>
            <p>
              Relay Agent only needs access to inspect the file you choose and to write the save-copy destination later.
              It does not overwrite the original workbook.
            </p>
          </div>
        {/if}

        <section class="help-panel">
          <div class="help-panel-head">
            <div>
              <p class="panel-eyebrow">Need help?</p>
              <h3>{showGuidedStartGate ? "What these choices mean" : "Quick help for this step"}</h3>
            </div>
            <button
              class="route-chip action-chip compact-chip"
              type="button"
              on:click={() => (homeHelpOpen = !homeHelpOpen)}
            >
              {homeHelpOpen ? "Hide help" : "Show help"}
            </button>
          </div>

          {#if homeHelpOpen}
            <div class="help-list">
              {#each homeHelpEntries as entry}
                <article class="help-card">
                  <strong>{entry.term}</strong>
                  <p>{entry.detail}</p>
                  <span>{entry.action}</span>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <div class="guided-start-card">
          <p class="panel-eyebrow">{entryMode ? "Step 2 of 3" : "Describe your goal"}</p>
          <h3>
            {entryMode === "sample"
              ? "What do you want to learn from the sample?"
              : entryMode === "custom"
                ? "What should happen to your file?"
                : "Describe the result you want."}
          </h3>
          <p class="guided-start-copy">
            Use plain work language. You do not need to mention relay packets, JSON, or tool names.
          </p>

          <div class="objective-starter-grid">
            {#each objectiveStarters as starter}
              <button
                class="objective-starter"
                type="button"
                on:click={() => useObjectiveStarter(starter)}
              >
                <strong>{starter.label}</strong>
                <span>{starter.note}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="guided-start-card">
          <p class="panel-eyebrow">Quick-start templates</p>
          <h3>Start from a common spreadsheet task.</h3>
          <p class="guided-start-copy">
            Templates fill both the task name and the goal. You can still edit the text before
            creating the session.
          </p>

          <div class="objective-starter-grid">
            {#each quickStartTemplates as template}
              <button
                class="objective-starter"
                type="button"
                on:click={() => applyQuickStartTemplate(template)}
              >
                <strong>{template.label}</strong>
                <span>{template.note}</span>
              </button>
            {/each}
          </div>
        </div>

        <form class="session-form" on:submit|preventDefault={() => void handleCreateSession()}>
          <label>
            <span>Task name</span>
            <input
              bind:this={titleInput}
              bind:value={title}
              maxlength="120"
              placeholder="Monthly sales cleanup"
              required
            />
            <p class="field-help">Use a short name so you can find this work again later.</p>
          </label>

          <label>
            <span>What do you want done?</span>
            <textarea
              bind:value={objective}
              rows="4"
              placeholder="Example: Keep approved rows, explain what will change, and save a separate copy."
              required
            ></textarea>
            <p class="field-help">
              Write the business outcome you want. Relay Agent will guide the technical steps later.
            </p>
          </label>

          <label>
            <span>File to inspect</span>
            <input
              bind:this={workbookPathInput}
              bind:value={primaryWorkbookPath}
              on:blur={() => void runWorkbookPreflight(true)}
              on:input={handleWorkbookPathInput}
              placeholder="/tmp/revenue-q2.csv"
            />
            <p class="field-help">
              {entryMode === "sample"
                ? "The sample path is already filled in. Check it once, then continue."
                : "Step 3 of 3: add the file Relay Agent should inspect before it prepares a safe copy."}
            </p>
          </label>

          <div class="inline-action-row">
            <button
              class="route-chip action-chip compact-chip"
              disabled={preflightPending || !primaryWorkbookPath.trim()}
              type="button"
              on:click={() => void runWorkbookPreflight(true)}
            >
              {preflightPending ? "Checking file..." : "Check this file"}
            </button>

            {#if workbookPathNeedsRecheck}
              <p class="inline-note">Run the file check again after changing the file path.</p>
            {/if}
          </div>

          {#if preflightError}
            <p class="form-message form-error" aria-live="polite">{preflightError}</p>
          {/if}

          {#if workbookPreflight}
            <section
              class={`feedback feedback-${preflightTone(workbookPreflight.status)}`}
              aria-live="polite"
            >
              <strong>{workbookPreflight.headline}</strong>
              <p>{workbookPreflight.summary}</p>

              <div class="preflight-meta">
                {#if workbookPreflight.format}
                  <span>{formatWorkbookFormat(workbookPreflight.format)}</span>
                {/if}

                {#if workbookPreflight.fileSizeBytes !== undefined}
                  <span>{formatFileSize(workbookPreflight.fileSizeBytes)}</span>
                {/if}
              </div>

              {#if workbookPreflight.checks.length > 0}
                <ul class="feedback-list">
                  {#each workbookPreflight.checks as check}
                    <li>
                      <strong>{check.title}:</strong> {check.detail}
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if workbookPreflight.guidance.length > 0}
                <div class="preflight-guidance">
                  <p class="preflight-guidance-label">Before you continue</p>
                  <ul class="feedback-list">
                    {#each workbookPreflight.guidance as hint}
                      <li>{hint}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </section>
          {/if}

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

          <div class="safe-defaults-card">
            <p class="panel-eyebrow">Safe defaults already on</p>
            <ul class="guided-step-list">
              <li>Your original file stays unchanged.</li>
              <li>Relay Agent shows the plan before anything is saved.</li>
              <li>The result is written as a separate copy instead of overwriting the source file.</li>
            </ul>
          </div>

          <button
            bind:this={createButton}
            class="primary-button"
            disabled={createPending || ipcStatus !== "ready" || createBlockedByStartup}
            type="submit"
          >
            {createPending
              ? "Creating session..."
              : showFirstRunWelcome
                ? "Create first session"
                : "Create session"}
          </button>
        </form>
      {/if}
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
          <dt>Storage path</dt>
          <dd>{storagePath ?? "Unavailable"}</dd>
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
      <h2>Data stays on this device</h2>
      <ul class="ra-list">
        <li>Sessions, turn history, preview records, and logs stay in local app storage.</li>
        <li>Nothing is auto-sent outside the app. Only text you manually paste into Copilot leaves the device.</li>
        <li>To remove saved work today, close Relay Agent and delete the folder shown below.</li>
      </ul>

      {#if storagePath}
        <p class="path-label">Current local storage folder</p>
        <code class="path-block">{storagePath}</code>
      {:else}
        <p class="path-fallback">
          Local storage is not ready yet, so there is no stable folder to remove from this run.
        </p>
      {/if}
    </article>

    <article class="ra-panel">
      <h2>Recent work</h2>

      {#if recentSessions.length === 0 && recentFiles.length === 0}
        <p class="path-fallback">
          Open a session in Studio or create one here, and Relay Agent will keep a short recent-work list on this device.
        </p>
      {:else}
        {#if recentSessions.length > 0}
          <div class="recent-block">
            <p class="panel-eyebrow">Recent sessions</p>
            <div class="session-list compact-session-list">
              {#each recentSessions as recentSession}
                <article class="session-card compact-session-card">
                  <div class="session-card-head">
                    <div>
                      <h3>{recentSession.title}</h3>
                      <p>{recentSession.lastTurnTitle || "Ready to resume in Studio."}</p>
                    </div>
                    <a class="session-link" href={`/studio?sessionId=${recentSession.sessionId}`}>
                      Resume
                    </a>
                  </div>

                  <div class="session-meta">
                    <span>Opened {formatDate(recentSession.lastOpenedAt)}</span>
                    {#if recentSession.workbookPath}
                      <span title={recentSession.workbookPath}>{recentSession.workbookPath}</span>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/if}

        {#if recentFiles.length > 0}
          <div class="recent-block">
            <p class="panel-eyebrow">Recent files</p>
            <div class="recent-file-list">
              {#each recentFiles as recentFile}
                <article class="recent-file-card">
                  <code>{recentFile.path}</code>
                  <div class="session-meta">
                    <span>{recentFile.source}</span>
                    <span>{formatDate(recentFile.lastUsedAt)}</span>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </article>

    <article class="ra-panel">
      <h2>Recent saves</h2>

      {#if auditHistory.length === 0}
        <p class="path-fallback">
          When Relay Agent saves a reviewed copy, the latest input, output, and summary will appear here.
        </p>
      {:else}
        <div class="recent-file-list">
          {#each auditHistory as entry}
            <article class="recent-file-card audit-card">
              <div class="session-card-head">
                <div>
                  <h3>{entry.turnTitle || entry.sessionTitle}</h3>
                  <p>{entry.summary}</p>
                </div>
                <a class="session-link" href={`/studio?sessionId=${entry.sessionId}${entry.turnId ? `&turnId=${entry.turnId}` : ""}&view=review`}>
                  Review
                </a>
              </div>

              <div class="session-meta">
                <span>Saved {formatDate(entry.executedAt)}</span>
                {#if entry.affectedRows > 0}
                  <span>{entry.affectedRows} row{entry.affectedRows === 1 ? "" : "s"}</span>
                {/if}
                {#if entry.targetCount > 0}
                  <span>{entry.targetCount} target{entry.targetCount === 1 ? "" : "s"}</span>
                {/if}
              </div>

              {#if entry.sourcePath}
                <code>{entry.sourcePath}</code>
              {/if}

              {#if entry.outputPath}
                <code>{entry.outputPath}</code>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </article>

    <article class="ra-panel">
      <h2>Current guidance coverage</h2>
      <ul class="ra-list">
        <li>File checks now catch unsupported, unreadable, or locale-sensitive inputs before session creation.</li>
        <li>CSV guidance now calls out delimiter, encoding, date, and number-format issues in plain language.</li>
        <li>Copy-time sensitivity warnings before Copilot handoff</li>
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

  .feedback-ready {
    border-color: rgba(30, 115, 72, 0.22);
    background: rgba(30, 115, 72, 0.08);
    color: #1e7348;
  }

  .feedback-detail {
    font-size: 0.92rem;
    word-break: break-word;
  }

  .feedback-list {
    margin: 0.75rem 0 0;
    padding-left: 1.15rem;
  }

  .inline-action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .compact-chip {
    padding: 0.55rem 0.85rem;
  }

  .inline-note {
    margin: 0;
    color: var(--ra-muted);
    font-size: 0.92rem;
  }

  .preflight-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.65rem;
    font-size: 0.92rem;
  }

  .preflight-guidance {
    margin-top: 0.9rem;
  }

  .preflight-guidance-label {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 700;
  }

  .feedback-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin-top: 0.9rem;
  }

  .recovery-list {
    display: grid;
    gap: 0.8rem;
    margin-top: 0.9rem;
  }

  .recovery-card {
    display: grid;
    gap: 0.8rem;
    padding: 0.95rem;
    border: 1px solid rgba(138, 90, 23, 0.18);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.68);
  }

  .first-run-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.9fr);
  }

  .first-run-panel,
  .permission-panel {
    display: grid;
    gap: 1rem;
    align-content: start;
  }

  .welcome-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  .welcome-list {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--ra-muted);
    display: grid;
    gap: 0.55rem;
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

  .guided-start-card {
    display: grid;
    gap: 0.85rem;
    padding: 1rem;
    border: 1px solid rgba(138, 90, 23, 0.18);
    border-radius: 1rem;
    background: rgba(255, 249, 240, 0.82);
  }

  .guided-start-card h3,
  .guided-start-copy {
    margin: 0;
  }

  .guided-start-copy {
    color: var(--ra-muted);
  }

  .guided-step-list {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.55rem;
    color: var(--ra-text);
  }

  .safe-defaults-card {
    display: grid;
    gap: 0.75rem;
    padding: 0.95rem 1rem;
    border: 1px solid rgba(91, 125, 56, 0.18);
    border-radius: 1rem;
    background: rgba(91, 125, 56, 0.08);
  }

  .help-panel {
    display: grid;
    gap: 0.85rem;
    padding: 1rem;
    border: 1px solid rgba(37, 50, 32, 0.12);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.7);
  }

  .help-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .help-panel-head h3 {
    margin: 0.2rem 0 0;
  }

  .help-list {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .help-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.9rem;
    border: 1px solid rgba(37, 50, 32, 0.08);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.84);
  }

  .help-card strong,
  .help-card p,
  .help-card span {
    margin: 0;
  }

  .help-card p {
    color: var(--ra-text);
    line-height: 1.5;
  }

  .help-card span {
    color: var(--ra-muted);
    font-size: 0.9rem;
    line-height: 1.45;
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

  .permission-inline-note {
    padding: 0.95rem 1rem;
    border: 1px solid rgba(138, 90, 23, 0.18);
    border-radius: 0.95rem;
    background: rgba(138, 90, 23, 0.06);
  }

  .permission-inline-note strong,
  .permission-inline-note p {
    margin: 0;
  }

  .permission-inline-note p {
    margin-top: 0.4rem;
    color: var(--ra-muted);
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
    font-size: 1rem;
    line-height: 1.5;
  }

  .session-form textarea {
    resize: vertical;
    min-height: 7rem;
  }

  .field-help {
    margin: 0;
    color: var(--ra-muted);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .objective-starter-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .objective-starter {
    display: grid;
    gap: 0.35rem;
    padding: 0.9rem;
    border: 1px solid rgba(138, 90, 23, 0.18);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.84);
    color: var(--ra-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .objective-starter strong,
  .objective-starter span {
    margin: 0;
  }

  .objective-starter span {
    color: var(--ra-muted);
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .objective-starter:hover {
    transform: translateY(-0.08rem);
    border-color: var(--ra-accent);
    box-shadow: 0 1rem 2rem rgba(31, 45, 36, 0.08);
  }

  .session-form input:focus,
  .session-form textarea:focus,
  .objective-starter:focus {
    outline: 3px solid rgba(138, 90, 23, 0.22);
    outline-offset: 2px;
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
    min-height: 2.75rem;
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

  .compact-session-list,
  .recent-file-list {
    gap: 0.75rem;
  }

  .session-card {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.76);
  }

  .compact-session-card,
  .recent-file-card {
    padding: 0.9rem;
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
    word-break: break-word;
  }

  .path-label {
    margin-top: 1rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ra-accent);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .path-block {
    display: block;
    margin-top: 0.55rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ra-text);
    font-size: 0.92rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .path-fallback {
    margin-top: 1rem;
  }

  .recent-block {
    display: grid;
    gap: 0.75rem;
  }

  .recent-block + .recent-block {
    margin-top: 1rem;
  }

  .recent-file-card {
    display: grid;
    gap: 0.65rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.76);
  }

  .audit-card h3 {
    font-size: 1.05rem;
  }

  .recent-file-card code {
    word-break: break-word;
  }

  @media (max-width: 960px) {
    .first-run-grid,
    .home-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .panel-heading,
    .help-panel-head,
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
