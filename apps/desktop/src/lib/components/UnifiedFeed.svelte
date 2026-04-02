<script context="module" lang="ts">
  export type StepEntry = {
    id: string;
    toolName: string;
    argsSummary?: string;
    status: "pending" | "running" | "done" | "error";
    startTime: number;
    endTime?: number;
    detail?: string;
  };

  export type StepCluster = {
    id: string;
    roundIndex: number;
    label: string;
    steps: StepEntry[];
    status: "running" | "done" | "error";
    startTime: number;
    endTime?: number;
    expanded: boolean;
  };

  /** Back-compat: accept flat FeedEntry[] and convert to clusters */
  export type FeedEntry = {
    id: string;
    type: "tool" | "thinking" | "error";
    label: string;
    status: "running" | "done" | "error";
    startTime: number;
    endTime?: number;
    detail?: string;
    rawResult?: unknown;
  };

  export function entriesToClusters(entries: FeedEntry[]): StepCluster[] {
    if (!entries.length) return [];
    const cluster: StepCluster = {
      id: "c0",
      roundIndex: 0,
      label: entries[0]?.label ?? "実行中",
      steps: entries.map((e) => ({
        id: e.id,
        toolName: e.label,
        argsSummary: "",
        status: e.status,
        startTime: e.startTime,
        endTime: e.endTime,
        detail: e.detail ?? (e.rawResult ? JSON.stringify(e.rawResult, null, 2) : undefined),
      })),
      status: entries.some((e) => e.status === "error")
        ? "error"
        : entries.some((e) => e.status === "running")
        ? "running"
        : "done",
      startTime: entries[0]?.startTime ?? Date.now(),
      endTime: entries.at(-1)?.endTime,
      expanded: true,
    };
    return [cluster];
  }
</script>

<script lang="ts">
  import { afterUpdate } from "svelte";

  export let clusters: StepCluster[] = [];
  /** Back-compat: flat entries get auto-converted */
  export let entries: FeedEntry[] = [];
  export let isRunning = false;
  export let compacted = false;

  let scrollContainer: HTMLElement | null = null;

  $: displayClusters = clusters.length > 0
    ? clusters
    : entriesToClusters(entries);

  function toggleCluster(id: string) {
    displayClusters = displayClusters.map((c) =>
      c.id === id ? { ...c, expanded: !c.expanded } : c
    );
  }

  let expandedStepIds = new Set<string>();
  function toggleStep(id: string) {
    if (expandedStepIds.has(id)) expandedStepIds.delete(id);
    else expandedStepIds.add(id);
    expandedStepIds = expandedStepIds;
  }

  function elapsed(start: number, end?: number): string {
    const ms = (end ?? Date.now()) - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  afterUpdate(() => {
    if (scrollContainer && isRunning) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  });
</script>

{#if displayClusters.length > 0}
  <div class="feed" bind:this={scrollContainer}>
    <!-- Section header -->
    <span class="label-section">Execution Log</span>

    <!-- Compaction notice -->
    {#if compacted}
      <div class="compaction-notice">── コンテキストを圧縮しました ──</div>
    {/if}

    {#each displayClusters as cluster (cluster.id)}
      <div class="cluster" class:is-running={cluster.status === "running"} class:is-error={cluster.status === "error"}>
        <!-- Cluster header -->
        <button
          class="cluster-header"
          type="button"
          on:click={() => toggleCluster(cluster.id)}
        >
          <!-- Status icon -->
          <span class="cluster-status-icon">
            {#if cluster.status === "running"}
              <span class="step-spinner"></span>
            {:else if cluster.status === "done"}
              <svg viewBox="0 0 16 16" fill="none" stroke="var(--c-success)" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px">
                <polyline points="3 8 6.5 11.5 13 4.5"/>
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" fill="none" stroke="var(--c-error)" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px">
                <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
              </svg>
            {/if}
          </span>

          <!-- Label -->
          <span class="cluster-label">{cluster.label}</span>

          <!-- Step count badge -->
          <span class="cluster-badge">{cluster.steps.length}</span>

          <!-- Elapsed -->
          <span class="cluster-time">{elapsed(cluster.startTime, cluster.endTime)}</span>

          <!-- Expand chevron -->
          <span class="cluster-chevron" class:expanded={cluster.expanded}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px">
              <polyline points="4 6 8 10 12 6"/>
            </svg>
          </span>
        </button>

        <!-- Step rows -->
        {#if cluster.expanded}
          <div class="cluster-steps">
            {#each cluster.steps as step (step.id)}
              <div class="step-row" class:has-detail={!!step.detail}>
                <!-- Status icon -->
                <span class="step-icon">
                  {#if step.status === "running"}
                    <span class="step-spinner"></span>
                  {:else if step.status === "done"}
                    <svg viewBox="0 0 16 16" fill="none" stroke="var(--c-success)" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px">
                      <polyline points="3 8 6.5 11.5 13 4.5"/>
                    </svg>
                  {:else if step.status === "error"}
                    <svg viewBox="0 0 16 16" fill="none" stroke="var(--c-error)" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px">
                      <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                  {:else}
                    <span class="step-pending-dot"></span>
                  {/if}
                </span>

                <!-- Tool name + args -->
                <button
                  class="step-body"
                  type="button"
                  class:clickable={!!step.detail}
                  on:click={() => step.detail && toggleStep(step.id)}
                >
                  <span class="step-tool">{step.toolName}</span>
                  {#if step.argsSummary}
                    <span class="step-args">{step.argsSummary}</span>
                  {/if}
                </button>

                <!-- Elapsed -->
                {#if step.endTime || step.status === "running"}
                  <span class="step-time">{elapsed(step.startTime, step.endTime)}</span>
                {/if}
              </div>

              <!-- Detail accordion -->
              {#if expandedStepIds.has(step.id) && step.detail}
                <div class="step-detail">
                  <pre class="step-detail-pre">{step.detail}</pre>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .feed {
    overflow-y: auto;
    padding: 0 0 var(--sp-4);
  }

  /* Compaction divider */
  .compaction-notice {
    text-align: center;
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    padding: var(--sp-3) var(--sp-4);
    border-top: 1px dashed var(--c-border-strong);
    border-bottom: 1px dashed var(--c-border-strong);
    margin: var(--sp-2) 0;
  }

  /* ── Cluster ─────────────────────────────── */
  .cluster {
    border-radius: var(--r-md);
    margin-bottom: var(--sp-1);
    overflow: hidden;
    transition: background var(--duration-fast);
  }
  .cluster.is-running {
    border-left: 2px solid var(--c-accent);
    background: var(--c-accent-subtle);
  }
  .cluster.is-error {
    border-left: 2px solid var(--c-error);
    background: var(--c-error-subtle);
  }

  .cluster-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    min-height: 36px;
    text-align: left;
    color: var(--c-text);
    border-radius: var(--r-md);
    transition: background var(--duration-fast);
    cursor: pointer;
  }
  .cluster-header:hover { background: var(--c-border); }

  .cluster-status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
  }

  .cluster-label {
    flex: 1;
    font-size: var(--sz-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cluster-badge {
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-3);
    background: var(--c-border);
    border-radius: var(--r-full);
    padding: 0 6px;
    flex-shrink: 0;
  }

  .cluster-time {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .cluster-chevron {
    color: var(--c-text-3);
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease);
  }
  .cluster-chevron.expanded { transform: rotate(180deg); }

  /* ── Steps ───────────────────────────────── */
  .cluster-steps {
    padding: 0 var(--sp-3) var(--sp-2) calc(var(--sp-3) + 16px + var(--sp-2));
  }

  .step-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 28px;
    padding: 2px 0;
  }

  .step-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex-shrink: 0;
  }

  .step-pending-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c-border-strong);
  }

  .step-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--c-border-strong);
    border-top-color: var(--c-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .step-body {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .step-body.clickable { cursor: pointer; }
  .step-body.clickable:hover .step-tool { color: var(--c-accent); }

  .step-tool {
    font-size: var(--sz-sm);
    font-family: var(--font-mono);
    color: var(--c-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--duration-fast);
  }

  .step-args {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .step-time {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  /* Detail accordion */
  .step-detail {
    padding: var(--sp-2) 0 var(--sp-2) 26px;
  }
  .step-detail-pre {
    margin: 0;
    padding: var(--sp-3);
    font-size: var(--sz-xs);
    font-family: var(--font-mono);
    line-height: 1.5;
    color: var(--c-text-2);
    background: var(--c-canvas);
    border-radius: var(--r-sm);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 240px;
    overflow-y: auto;
  }
</style>
