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
  <div class="agent-loop-panel">
    <div class="loop-timeline">
      <div class="loop-turn-bar">
        <span class="loop-turn-label">ターン {agentLoopTurn || 1} / {maxTurns}</span>
        <div class="loop-turn-track">
          <div class="loop-turn-fill" style={`width: ${((agentLoopTurn || 1) / maxTurns) * 100}%`}></div>
        </div>
      </div>

      {#each entries as entry}
        <div
          class="timeline-item"
          class:timeline-running={entry.status === "running"}
          class:timeline-done={entry.status === "done"}
          class:timeline-error={entry.status === "error"}
        >
          <div class="timeline-icon">
            {#if entry.status === "running"}
              <span class="spinner">⟳</span>
            {:else if entry.status === "done"}
              <span>✓</span>
            {:else}
              <span>✗</span>
            {/if}
          </div>
          <div class="timeline-body">
            <div class="timeline-tool-row">
              <span class="timeline-tool-name">{entry.label}</span>
              {#if entry.endTime}
                <span class="timeline-duration">
                  {((entry.endTime - entry.startTime) / 1000).toFixed(1)}s
                </span>
              {/if}
            </div>
            {#if entry.status === "error" && entry.errorMessage}
              <div class="timeline-error-msg">{entry.errorMessage}</div>
            {/if}
            {#if entry.detail}
              <div class="progress-message">{entry.detail}</div>
            {/if}
            {#if entry.rawResult}
              <button class="timeline-detail-btn" type="button" on:click={() => onToggleDetail(entry.id)}>
                {entry.showDetail ? "詳細を隠す" : "詳細を見る"}
              </button>
              {#if entry.showDetail}
                <pre class="timeline-detail-json">{JSON.stringify(entry.rawResult, null, 2)}</pre>
              {/if}
            {/if}
          </div>
        </div>
      {/each}

      {#if summary}
        <div class="copilot-bubble">
          <span class="copilot-bubble-icon">🤖</span>
          <div class="copilot-bubble-text">
            {summary}
            {#if finalStatus}
              <div class="copilot-bubble-status">status: {finalStatus}</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
