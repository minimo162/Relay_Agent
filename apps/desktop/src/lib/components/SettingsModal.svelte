<script lang="ts">
  import type {
    ApprovalPolicy,
    McpTransport,
    ToolRegistration
  } from "@relay-agent/contracts";

  export let open = false;
  export let autoLaunchEdge = true;
  export let cdpPort = 9333;
  export let timeoutMs = 60000;
  export let maxTurns = 10;
  export let approvalPolicy: ApprovalPolicy = "safe";
  export let cdpTestStatus: "idle" | "testing" | "ok" | "fail" = "idle";
  export let cdpTestMessage = "";
  export let copiedBrowserCommandNotice = "";
  export let edgeLaunchCommand = "";
  export let autoPortRangeLabel = "";
  export let storagePath: string | null = null;
  export let tools: ToolRegistration[] = [];
  export let toolInfoMessage = "";
  export let toolErrorMessage = "";
  export let connectingMcp = false;
  export let mcpServerUrl = "";
  export let mcpServerName = "";
  export let mcpTransport: McpTransport = "sse";
  export let onClose: () => void = () => {};
  export let onToggleAutoLaunch: () => void = () => {};
  export let onPersist: () => void = () => {};
  export let onCopyCommand: () => void = () => {};
  export let onTestConnection: () => void = () => {};
  export let onToggleTool: (toolId: string, enabled: boolean) => void = () => {};
  export let onConnectMcpServer: () => void = () => {};

  $: builtinTools = tools.filter((tool) => tool.source === "builtin");
  $: mcpTools = tools.filter((tool) => tool.source === "mcp");
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click|self={onClose}>
    <div class="modal">
      <div class="modal-header">
        <h2>設定</h2>
        <button class="modal-close" type="button" on:click={onClose}>✕</button>
      </div>

      <div class="modal-body">
        <h3>実行ポリシー</h3>
        <ul class="settings-list">
          <li>書き込み操作はプレビューと確認を経てから実行されます</li>
          <li>保存先は常に別コピーです（元ファイルを直接変更しません）</li>
          <li>元のファイルは読み取り専用として扱われます</li>
        </ul>

        <label class="field-label" for="settings-approval-policy">承認ポリシー</label>
        <select
          id="settings-approval-policy"
          class="input"
          bind:value={approvalPolicy}
          on:change={onPersist}
        >
          <option value="safe">安全: すべて手動確認</option>
          <option value="standard">標準: readonly / low を自動承認</option>
          <option value="fast">高速: readonly / low / medium を自動承認</option>
        </select>

        <h3>Copilot ブラウザ自動化</h3>
        <div class="auto-launch-toggle" class:auto-launch-on={autoLaunchEdge}>
          <label class="auto-launch-label">
            <span>Edge を自動で起動する（推奨）</span>
            <button
              class="loop-toggle-switch"
              class:loop-switch-on={autoLaunchEdge}
              type="button"
              role="switch"
              aria-label="Edge 自動起動を切り替える"
              aria-checked={autoLaunchEdge}
              on:click={onToggleAutoLaunch}
            >
              <span class="loop-switch-thumb"></span>
            </button>
          </label>
          {#if autoLaunchEdge}
            <p class="auto-launch-hint">{autoPortRangeLabel}</p>
          {/if}
        </div>

        {#if !autoLaunchEdge}
          <label class="field-label" for="settings-cdp-port">CDP ポート</label>
          <input
            id="settings-cdp-port"
            class="input"
            type="number"
            min="1"
            max="65535"
            bind:value={cdpPort}
            on:change={onPersist}
          />
        {/if}

        <label class="field-label" for="settings-timeout">タイムアウト (ms)</label>
        <input
          id="settings-timeout"
          class="input"
          type="number"
          min="1000"
          step="1000"
          bind:value={timeoutMs}
          on:change={onPersist}
        />

        <label class="field-label" for="settings-max-turns">最大ターン数</label>
        <input
          id="settings-max-turns"
          class="input"
          type="number"
          min="1"
          max="20"
          bind:value={maxTurns}
          on:change={onPersist}
        />

        <div class="cdp-guide">
          <div class="cdp-command-row">
            <code class="cdp-command">{edgeLaunchCommand}</code>
            <button class="cdp-copy-btn" type="button" on:click={onCopyCommand}>
              コピー
            </button>
          </div>
          <div class="cdp-test-row">
            <button class="cdp-test-btn" type="button" disabled={cdpTestStatus === "testing"} on:click={onTestConnection}>
              {cdpTestStatus === "testing" ? "確認中…" : "接続テスト"}
            </button>
            {#if cdpTestStatus === "ok"}
              <span class="cdp-test-result cdp-test-ok">✓ {cdpTestMessage}</span>
            {:else if cdpTestStatus === "fail"}
              <span class="cdp-test-result cdp-test-fail">✗ {cdpTestMessage}</span>
            {/if}
          </div>
        </div>

        {#if copiedBrowserCommandNotice}
          <p class="field-success">{copiedBrowserCommandNotice}</p>
        {/if}

        <h3>ツール管理</h3>
        <div class="tool-section">
          <h4>ビルトインツール</h4>
          <div class="tool-list">
            {#each builtinTools as tool}
              <label class="tool-toggle">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  on:change={(event) =>
                    onToggleTool(tool.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <div class="tool-copy">
                  <div class="tool-topline">
                    <strong>{tool.title}</strong>
                    <span class="tool-phase">{tool.phase}</span>
                  </div>
                  <p>{tool.description}</p>
                  <p class="tool-meta">{tool.id}</p>
                </div>
              </label>
            {/each}
          </div>

          <h4>MCP サーバー</h4>
          <div class="mcp-server-input">
            <input class="input" type="text" bind:value={mcpServerUrl} placeholder="http://localhost:3100/mcp" />
            <input class="input" type="text" bind:value={mcpServerName} placeholder="サーバー名" />
            <select class="input" bind:value={mcpTransport}>
              <option value="sse">SSE / HTTP</option>
              <option value="stdio">stdio</option>
            </select>
            <button class="cdp-test-btn" type="button" on:click={onConnectMcpServer} disabled={connectingMcp}>
              {connectingMcp ? "接続中…" : "接続"}
            </button>
          </div>
          <p class="tool-meta">
            {#if mcpTransport === "stdio"}
              stdio では `URL` 欄に `node ./server.js` のような実行コマンドを入力します。
            {:else}
              SSE では `URL` 欄に `http://localhost:3100/mcp` のようなエンドポイントを入力します。
            {/if}
          </p>

          {#if toolInfoMessage}
            <p class="field-success">{toolInfoMessage}</p>
          {/if}
          {#if toolErrorMessage}
            <p class="field-warn">⚠ {toolErrorMessage}</p>
          {/if}

          {#if mcpTools.length > 0}
            <div class="tool-list">
              {#each mcpTools as tool}
                <div class="mcp-tool-card">
                  <div class="tool-topline">
                    <strong>{tool.title}</strong>
                    <span class="mcp-badge">MCP</span>
                  </div>
                  <p>{tool.description}</p>
                  <p class="tool-meta">{tool.id}</p>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if storagePath}
          <h3>ローカルストレージ</h3>
          <code class="storage-path">{storagePath}</code>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* --- Modal chrome --- */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--c-border-strong);
    position: sticky;
    top: 0;
    background: var(--c-surface);
    z-index: 1;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--sz-xl);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }

  .modal-close {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    color: var(--c-text-3);
    font-size: var(--sz-lg);
    transition: all var(--duration-fast) var(--ease);
  }

  .modal-close:hover {
    background: #f0eeea;
    color: var(--c-text);
  }

  .modal-body {
    padding: var(--sp-6);
    display: grid;
    gap: var(--sp-2);
  }

  .modal-body h3 {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    margin: var(--sp-6) 0 var(--sp-2) 0;
    padding-bottom: var(--sp-2);
    border-bottom: 1px solid var(--c-border-strong);
    letter-spacing: -0.01em;
  }

  .modal-body h3:first-child {
    margin-top: 0;
  }

  .modal-body h4 {
    font-size: var(--sz-base);
    font-weight: 500;
    color: var(--c-text-2);
    margin: var(--sp-4) 0 var(--sp-2) 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: var(--sz-xs);
  }

  /* --- Settings list --- */
  .settings-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-2);
  }

  .settings-list li {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    padding: var(--sp-2) var(--sp-3);
    background: #f0eeea;
    border-radius: var(--r-md);
    line-height: 1.5;
  }

  .settings-list li::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: var(--r-full);
    background: var(--c-accent);
    flex-shrink: 0;
    opacity: 0.6;
  }

  /* --- Field label --- */
  .field-label {
    display: block;
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    margin-top: var(--sp-4);
    margin-bottom: var(--sp-1);
    letter-spacing: 0.01em;
  }

  /* --- Auto-launch toggle --- */
  .auto-launch-toggle {
    padding: var(--sp-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
    background: #f0eeea;
    transition: all var(--duration-normal) var(--ease);
  }

  .auto-launch-toggle.auto-launch-on {
    border-color: rgba(13,148,136,0.20);
    background: rgba(13,148,136,0.04);
  }

  .auto-launch-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    font-weight: 500;
    cursor: pointer;
  }

  .auto-launch-hint {
    margin: var(--sp-2) 0 0;
    font-size: var(--sz-xs);
    color: var(--c-text-3);
  }

  /* --- Toggle switch (iOS-style) --- */
  .loop-toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--c-border-strong);
    border-radius: var(--r-full);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease);
    padding: 0;
  }

  .loop-toggle-switch.loop-switch-on {
    background: var(--c-accent);
  }

  .loop-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-fast) var(--ease);
    pointer-events: none;
  }

  .loop-toggle-switch.loop-switch-on .loop-switch-thumb {
    transform: translateX(20px);
  }

  /* --- CDP guide --- */
  .cdp-guide {
    margin-top: var(--sp-3);
    display: grid;
    gap: var(--sp-3);
  }

  .cdp-command-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    padding: var(--sp-2) var(--sp-3);
    overflow: hidden;
  }

  .cdp-command {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
    color: var(--c-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }

  .cdp-copy-btn {
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-accent);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-sm);
    background: var(--c-accent-subtle);
    border: 1px solid rgba(13,148,136,0.20);
    transition: all var(--duration-fast) var(--ease);
    flex-shrink: 0;
  }

  .cdp-copy-btn:hover {
    background: rgba(13,148,136,0.04);
  }

  .cdp-test-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .cdp-test-btn {
    font-size: var(--sz-sm);
    font-weight: 500;
    padding: var(--sp-2) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--c-surface);
    color: var(--c-text);
    border: 1px solid var(--c-border-strong);
    transition: all var(--duration-fast) var(--ease);
    white-space: nowrap;
  }

  .cdp-test-btn:hover:not(:disabled) {
    border-color: var(--c-border-strong);
    background: #f0eeea;
    transform: translateY(-1px);
  }

  .cdp-test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cdp-test-result {
    font-size: var(--sz-sm);
    font-weight: 500;
  }

  .cdp-test-ok {
    color: var(--c-success);
  }

  .cdp-test-fail {
    color: var(--c-error);
  }

  /* --- Messages --- */
  .field-success {
    color: var(--c-success);
    font-size: var(--sz-sm);
    margin: var(--sp-2) 0 0;
    font-weight: 500;
  }

  .field-warn {
    color: var(--c-warning);
    font-size: var(--sz-sm);
    margin: var(--sp-2) 0 0;
    font-weight: 500;
  }

  /* --- Tool management --- */
  .tool-section {
    display: grid;
    gap: var(--sp-2);
  }

  .tool-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--sp-3);
    margin: var(--sp-2) 0 var(--sp-4);
  }

  .tool-toggle,
  .mcp-tool-card {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--sp-3);
    align-items: start;
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    transition: all var(--duration-fast) var(--ease);
    cursor: pointer;
  }

  .tool-toggle:hover {
    border-color: var(--c-border-strong);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .tool-toggle input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--c-accent);
    margin-top: 2px;
    cursor: pointer;
  }

  .mcp-tool-card {
    grid-template-columns: 1fr;
    cursor: default;
  }

  .mcp-tool-card:hover {
    border-color: var(--c-border-strong);
  }

  .tool-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
  }

  .tool-topline strong {
    font-size: var(--sz-sm);
    color: var(--c-text);
  }

  .tool-copy p,
  .mcp-tool-card p {
    margin: var(--sp-1) 0 0;
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    line-height: 1.5;
  }

  .tool-phase,
  .mcp-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--sp-2);
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 700;
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    color: var(--c-text-2);
    white-space: nowrap;
  }

  .mcp-badge {
    background: var(--c-accent-subtle);
    border-color: rgba(13,148,136,0.20);
    color: var(--c-accent);
  }

  .tool-meta {
    font-size: var(--sz-xs);
    font-family: var(--font-mono);
    color: var(--c-text-3);
    word-break: break-all;
    line-height: 1.5;
  }

  /* --- MCP server form --- */
  .mcp-server-input {
    display: grid;
    grid-template-columns: 1fr 160px 140px auto;
    gap: var(--sp-3);
    margin-bottom: var(--sp-3);
    padding: var(--sp-4);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
  }

  /* --- Storage path --- */
  .storage-path {
    display: block;
    padding: var(--sp-3) var(--sp-4);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    word-break: break-all;
    user-select: all;
  }

  /* --- Responsive --- */
  @media (max-width: 720px) {
    .mcp-server-input {
      grid-template-columns: 1fr;
    }

    .tool-list {
      grid-template-columns: 1fr;
    }
  }
</style>
