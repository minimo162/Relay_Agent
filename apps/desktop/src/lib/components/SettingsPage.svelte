<script lang="ts">
  /**
   * SettingsPage — Full-page settings (replaces SettingsModal)
   *
   * This is a wrapper that re-exports SettingsModal's interface
   * but renders as a full page instead of a modal overlay.
   * The actual settings UI is still delegated to SettingsModal internals
   * during the migration period.
   */
  import { createEventDispatcher } from "svelte";

  export let cdpPort = 9333;
  export let autoLaunchEdge = true;
  export let timeoutMs = 30000;
  export let approvalPolicy = "safe";
  export let tools: { name: string; enabled: boolean; source: string }[] = [];
  export let agentLoopEnabled = true;
  export let maxTurns = 5;
  export let planningEnabled = true;

  const dispatch = createEventDispatcher<{
    close: void;
    save: {
      cdpPort: number;
      autoLaunchEdge: boolean;
      timeoutMs: number;
      approvalPolicy: string;
      agentLoopEnabled: boolean;
      maxTurns: number;
      planningEnabled: boolean;
    };
    toolToggle: { name: string; enabled: boolean };
  }>();

  function handleSave() {
    dispatch("save", {
      cdpPort,
      autoLaunchEdge,
      timeoutMs,
      approvalPolicy,
      agentLoopEnabled,
      maxTurns,
      planningEnabled,
    });
  }
</script>

<div class="settings-page">
  <header class="settings-header">
    <h2 class="settings-title">設定</h2>
    <button class="btn btn-ghost btn-icon" type="button" on:click={() => dispatch("close")} aria-label="閉じる">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </header>

  <div class="settings-body">
    <!-- Connection Section -->
    <section class="settings-section">
      <h3 class="section-title">接続</h3>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">CDP ポート</span>
          <span class="setting-desc">Edge ブラウザの DevTools ポート</span>
        </div>
        <input class="input setting-input-sm" type="number" bind:value={cdpPort} min="1024" max="65535" />
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Edge 自動起動</span>
          <span class="setting-desc">Copilot 送信時に Edge を自動で開く</span>
        </div>
        <button
          class="toggle-switch" class:active={autoLaunchEdge}
          type="button" on:click={() => { autoLaunchEdge = !autoLaunchEdge; }}
          role="switch" aria-checked={autoLaunchEdge} aria-label="Edge 自動起動"
        ></button>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">タイムアウト (ms)</span>
          <span class="setting-desc">Copilot 応答の待機時間</span>
        </div>
        <input class="input setting-input-sm" type="number" bind:value={timeoutMs} min="5000" max="120000" step="1000" />
      </div>
    </section>

    <!-- Agent Section -->
    <section class="settings-section">
      <h3 class="section-title">エージェント</h3>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">エージェントループ</span>
          <span class="setting-desc">AI が自律的にタスクを実行</span>
        </div>
        <button
          class="toggle-switch" class:active={agentLoopEnabled}
          type="button" on:click={() => { agentLoopEnabled = !agentLoopEnabled; }}
          role="switch" aria-checked={agentLoopEnabled} aria-label="エージェントループ"
        ></button>
      </div>
      {#if agentLoopEnabled}
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">最大ターン数</span>
            <span class="setting-desc">1回の実行での最大ループ回数</span>
          </div>
          <input class="input setting-input-sm" type="number" bind:value={maxTurns} min="1" max="20" />
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">プランニング</span>
            <span class="setting-desc">実行前に計画を提案する</span>
          </div>
          <button
            class="toggle-switch" class:active={planningEnabled}
            type="button" on:click={() => { planningEnabled = !planningEnabled; }}
            role="switch" aria-checked={planningEnabled} aria-label="プランニング"
          ></button>
        </div>
      {/if}
    </section>

    <!-- Approval Section -->
    <section class="settings-section">
      <h3 class="section-title">承認ポリシー</h3>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">承認レベル</span>
          <span class="setting-desc">書込操作の承認要求レベル</span>
        </div>
        <select class="select setting-input-sm" bind:value={approvalPolicy}>
          <option value="safe">安全 (全て承認)</option>
          <option value="standard">標準</option>
          <option value="fast">高速 (自動承認)</option>
        </select>
      </div>
    </section>

    <!-- Tools Section -->
    {#if tools.length > 0}
      <section class="settings-section">
        <h3 class="section-title">ツール</h3>
        {#each tools as tool}
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label tool-label">{tool.name}</span>
              <span class="setting-desc">{tool.source}</span>
            </div>
            <button
              class="toggle-switch" class:active={tool.enabled}
              type="button" on:click={() => dispatch("toolToggle", { name: tool.name, enabled: !tool.enabled })}
              role="switch" aria-checked={tool.enabled} aria-label="{tool.name} を切替"
            ></button>
          </div>
        {/each}
      </section>
    {/if}
  </div>

  <div class="settings-footer">
    <button class="btn btn-primary" type="button" on:click={handleSave}>保存</button>
  </div>
</div>

<style>
  .settings-page {
    max-width: var(--content-max, 720px);
    margin: 0 auto;
    padding: var(--sp-6, 24px) var(--sp-4, 16px);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-6, 24px);
  }
  .settings-title {
    font-size: var(--sz-xl, 1.5rem);
    font-weight: 700;
    color: var(--c-text, #1c1917);
    margin: 0;
  }

  .settings-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8, 32px);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1, 4px);
  }

  .section-title {
    font-size: var(--sz-sm, 0.8125rem);
    font-weight: 500;
    color: var(--c-text-3, #a8a29e);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 var(--sp-2, 8px);
    padding-bottom: var(--sp-2, 8px);
    border-bottom: 1px solid var(--c-divider);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4, 16px);
    padding: var(--sp-3, 12px) 0;
  }

  .setting-info { flex: 1; min-width: 0; }
  .setting-label {
    display: block;
    font-size: var(--sz-base, 0.875rem);
    font-weight: 500;
    color: var(--c-text, #1c1917);
  }
  .setting-label.tool-label { font-family: var(--font-mono); font-size: var(--sz-sm); }
  .setting-desc {
    display: block;
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3, #a8a29e);
    margin-top: 2px;
  }

  .setting-input-sm {
    width: 100px;
    flex-shrink: 0;
  }

  .settings-footer {
    margin-top: var(--sp-8, 32px);
    display: flex;
    justify-content: flex-end;
  }
</style>
