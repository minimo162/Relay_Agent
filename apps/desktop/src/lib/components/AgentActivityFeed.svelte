<script lang="ts">
  export let visible = true;
  export let agentLoopEnabled = false;
  export let agentLoopTurn = 0;
  export let maxTurns = 1;
  export let entries: {
    id: string;
    label: string;
    status: "waiting" | "running" | "done" | "error";
    startTime: number;
    endTime?: number;
    detail?: string;
    errorMessage?: string;
    rawResult?: unknown;
    showDetail?: boolean;
  }[] = [];
  export let summary = "";
  export let finalStatus: string | null = null;
  export let onToggleDetail: (id: string) => void = () => {};

</script>

{#if visible && agentLoopEnabled && (summary || entries.length > 0)}
  <div class="activity-feed">
    <!-- Turn header -->
    <div class="feed-header">
      <span class="turn-number">T{agentLoopTurn || 1}</span>
      <div class="turn-progress-wrap">
        <span class="turn-label">ターン {agentLoopTurn || 1} / {maxTurns}</span>
        <div class="turn-track">
          <div class="turn-fill" style={`width: ${((agentLoopTurn || 1) / maxTurns) * 100}%`}></div>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div class="timeline">
      {#each entries as entry, i}
        <div
          class="timeline-entry"
          class:is-running={entry.status === "running"}
          class:is-done={entry.status === "done"}
          class:is-error={entry.status === "error"}
          class:is-waiting={entry.status === "waiting"}
        >
          <!-- Vertical line + status dot -->
          <div class="timeline-rail">
            {#if i > 0}
              <div class="timeline-line timeline-line-above"></div>
            {/if}
            <div class="status-dot">
              {#if entry.status === "running"}
                <div class="dot-pulse"></div>
              {/if}
            </div>
            {#if i < entries.length - 1}
              <div class="timeline-line timeline-line-below"></div>
            {/if}
          </div>

          <!-- Content -->
          <div class="timeline-content">
            <div class="entry-header">
              <span class="badge-tool">{entry.label}</span>
              {#if entry.status === "running"}
                <span class="sumi-spinner">
                  <span class="drop"></span>
                  <span class="drop"></span>
                  <span class="drop"></span>
                </span>
              {/if}
              {#if entry.endTime}
                <span class="elapsed-badge">
                  {((entry.endTime - entry.startTime) / 1000).toFixed(1)}s
                </span>
              {:else if entry.status === "running"}
                <span class="elapsed-badge elapsed-live">...</span>
              {/if}
            </div>

            {#if entry.status === "error" && entry.errorMessage}
              <div class="entry-error">{entry.errorMessage}</div>
            {/if}

            {#if entry.detail}
              <div class="entry-detail-text">{entry.detail}</div>
            {/if}

            {#if entry.rawResult}
              <button
                class="detail-toggle"
                type="button"
                on:click={() => onToggleDetail(entry.id)}
              >
                <span class="detail-toggle-arrow" class:open={entry.showDetail}>&#9654;</span>
                {entry.showDetail ? "詳細を隠す" : "詳細を見る"}
              </button>
              {#if entry.showDetail}
                <div class="detail-expand">
                  <pre class="detail-json">{JSON.stringify(entry.rawResult, null, 2)}</pre>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Summary bubble -->
    {#if summary}
      <div class="summary-bubble">
        <div class="summary-icon">AI</div>
        <div class="summary-body">
          <p class="summary-text">{summary}</p>
          {#if finalStatus}
            <span class="summary-status badge-tool">{finalStatus}</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* --- Feed container --- */
  .activity-feed {
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: 12px;
    padding: var(--sp-4);
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(20px) saturate(180%);
    overflow-y: auto;
    max-height: 480px;
    scroll-behavior: smooth;
  }

  /* --- Turn header --- */
  .feed-header {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-4);
    padding-bottom: var(--sp-3);
    border-bottom: 1px solid var(--c-border-strong);
  }

  .turn-number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .turn-progress-wrap {
    flex: 1;
    min-width: 0;
  }

  .turn-label {
    display: block;
    font-size: 0.75rem;
    color: var(--c-text-3);
    margin-bottom: var(--sp-1);
    letter-spacing: 0.02em;
  }

  .turn-track {
    height: 4px;
    background: var(--c-border-strong);
    border-radius: var(--r-full);
    overflow: hidden;
  }

  .turn-fill {
    height: 100%;
    background: var(--c-accent);
    border-radius: var(--r-full);
    transition: width 400ms var(--ease);
  }

  /* --- Timeline --- */
  .timeline {
    display: flex;
    flex-direction: column;
  }

  .timeline-entry {
    display: flex;
    gap: var(--sp-3);
    position: relative;
    min-height: 40px;
  }

  /* --- Rail (vertical line + dot) --- */
  .timeline-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 20px;
    flex-shrink: 0;
    position: relative;
  }

  .timeline-line {
    width: 2px;
    flex: 1;
    background: var(--c-border-strong);
  }

  .timeline-line-above {
    min-height: 4px;
  }

  .timeline-line-below {
    min-height: 4px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    background: var(--c-text-3);
    transition: background var(--duration-fast);
  }

  .is-running .status-dot {
    background: var(--c-accent);
  }

  .is-done .status-dot {
    background: var(--c-success);
  }

  .is-error .status-dot {
    background: var(--c-error);
  }

  /* Blue pulse for running */
  .dot-pulse {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: var(--c-accent);
    opacity: 0.4;
    animation: dot-pulse-anim 1.4s ease-in-out infinite;
  }

  @keyframes dot-pulse-anim {
    0%, 100% {
      transform: scale(0.8);
      opacity: 0.3;
    }
    50% {
      transform: scale(1.6);
      opacity: 0;
    }
  }

  /* --- Entry content --- */
  .timeline-content {
    flex: 1;
    min-width: 0;
    padding-bottom: var(--sp-3);
  }

  .entry-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  /* Elapsed time badge */
  .elapsed-badge {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--c-text-3);
    background: #f0eeea;
    padding: 0.0625rem var(--sp-2);
    border-radius: var(--r-full);
    letter-spacing: 0.02em;
  }

  .elapsed-live {
    color: var(--c-accent);
  }

  /* Error message */
  .entry-error {
    margin-top: var(--sp-1);
    font-size: 0.8125rem;
    color: var(--c-error);
    line-height: 1.5;
  }

  /* Progress / detail text */
  .entry-detail-text {
    margin-top: var(--sp-1);
    font-size: 0.8125rem;
    color: var(--c-text-2);
    line-height: 1.5;
  }

  /* --- Expandable detail --- */
  .detail-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
    padding: 0;
    border: none;
    background: none;
    color: var(--c-accent);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--duration-fast);
  }

  .detail-toggle:hover {
    color: var(--c-accent-hover);
  }

  .detail-toggle-arrow {
    display: inline-block;
    font-size: 0.5rem;
    transition: transform var(--duration-normal) var(--ease);
  }

  .detail-toggle-arrow.open {
    transform: rotate(90deg);
  }

  .detail-expand {
    overflow: hidden;
    animation: slide-down 400ms var(--ease) forwards;
  }

  @keyframes slide-down {
    from {
      max-height: 0;
      opacity: 0;
    }
    to {
      max-height: 600px;
      opacity: 1;
    }
  }

  .detail-json {
    margin-top: var(--sp-2);
    padding: var(--sp-3);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.6;
    color: var(--c-text-2);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* --- Summary bubble --- */
  .summary-bubble {
    display: flex;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--c-border-strong);
  }

  .summary-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    flex-shrink: 0;
    letter-spacing: -0.02em;
  }

  .summary-body {
    flex: 1;
    min-width: 0;
  }

  .summary-text {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--c-text);
    line-height: 1.6;
  }

  .summary-status {
    display: inline-block;
    margin-top: var(--sp-1);
  }

  /* --- Scrollbar --- */
  .activity-feed::-webkit-scrollbar {
    width: 4px;
  }

  .activity-feed::-webkit-scrollbar-track {
    background: transparent;
  }

  .activity-feed::-webkit-scrollbar-thumb {
    background: var(--c-border-strong);
    border-radius: var(--r-full);
  }

  .activity-feed::-webkit-scrollbar-thumb:hover {
    background: var(--c-accent);
  }
</style>
