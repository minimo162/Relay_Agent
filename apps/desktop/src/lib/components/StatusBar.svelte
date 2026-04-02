<script lang="ts">
  export let copilotConnected: boolean = false;
  export let sessionName: string = "";
  export let projectName: string = "";
  export let agentTurn: number = 0;
  export let agentMaxTurns: number = 0;
  export let agentRunning: boolean = false;
</script>

<footer class="status-strip">
  <div class="strip-left">
    <div class="connection-dot" class:connected={copilotConnected}>
      <span class="dot-glow"></span>
    </div>
    <span class="strip-text">
      {copilotConnected ? "Copilot 接続中" : "Copilot 未接続"}
    </span>

    {#if projectName}
      <span class="strip-sep"></span>
      <span class="strip-text">{projectName}</span>
    {/if}
  </div>

  <div class="strip-right">
    {#if agentRunning}
      <div class="strip-agent">
        <span class="breeze-mini">
          <span class="breeze-dot"></span>
          <span class="breeze-dot"></span>
          <span class="breeze-dot"></span>
        </span>
        <span class="strip-text">T{agentTurn}/{agentMaxTurns}</span>
      </div>
    {/if}

    {#if sessionName}
      <span class="strip-sep"></span>
      <span class="strip-text session-name">{sessionName}</span>
    {/if}
  </div>
</footer>

<style>
  .status-strip {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--sp-4);
    height: var(--statusbar-h);
    background: transparent;
    border-top: 1px solid var(--c-divider);
    user-select: none;
    z-index: 90;
  }

  .strip-left,
  .strip-right {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .strip-text {
    font-size: var(--sz-2xs);
    color: var(--c-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Connection dot with glow */
  .connection-dot {
    position: relative;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c-text-3);
    flex-shrink: 0;
  }

  .connection-dot.connected {
    background: var(--c-success);
  }

  .connection-dot.connected .dot-glow {
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: var(--c-success);
    opacity: 0.3;
    animation: dot-glow-pulse 2s ease-in-out infinite;
  }

  @keyframes dot-glow-pulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.15; transform: scale(1.3); }
  }

  /* Separator */
  .strip-sep {
    width: 1px;
    height: 8px;
    background: var(--c-divider);
    flex-shrink: 0;
  }

  .session-name {
    max-width: 200px;
  }

  /* Agent progress */
  .strip-agent {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    color: var(--c-accent);
  }

  .strip-agent .strip-text {
    color: var(--c-accent);
    font-family: var(--font-mono);
  }

  /* Mini breeze spinner */
  .breeze-mini {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }

  .breeze-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--c-accent);
    animation: breeze-pulse 1.4s ease-in-out infinite;
  }

  .breeze-dot:nth-child(2) { animation-delay: 0.15s; }
  .breeze-dot:nth-child(3) { animation-delay: 0.3s; }
</style>
