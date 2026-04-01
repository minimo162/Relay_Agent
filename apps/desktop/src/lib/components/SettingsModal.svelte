<script lang="ts">
  import { slide } from "svelte/transition";
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
  export let loopTimeoutMs = 120000;
  export let agentLoopEnabled = false;
  export let planningEnabled = true;
  export let autoApproveReadSteps = true;
  export let pauseBetweenSteps = false;
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

        <div class="loop-toggle-card" class:loop-toggle-on={agentLoopEnabled}>
          <div class="loop-toggle-header">
            <div class="loop-toggle-info">
              <span class="loop-toggle-icon">{agentLoopEnabled ? "🤖" : "💬"}</span>
              <div>
                <div class="loop-toggle-title">エージェントループ</div>
                <div class="loop-toggle-desc">
                  {#if agentLoopEnabled}
                    Copilot が自動で情報収集し、最適な処理を計画します
                  {:else}
                    1 回だけ Copilot に送信します
                  {/if}
                </div>
              </div>
            </div>
            <button
              class="loop-toggle-switch"
              class:loop-switch-on={agentLoopEnabled}
              type="button"
              role="switch"
              aria-label="エージェントループを切り替える"
              aria-checked={agentLoopEnabled}
              on:click={() => {
                agentLoopEnabled = !agentLoopEnabled;
                onPersist();
              }}
            >
              <span class="loop-switch-thumb"></span>
            </button>
          </div>

          {#if agentLoopEnabled}
            <div class="loop-options" transition:slide={{ duration: 200 }}>
              <label class="field-label loop-option-label" for="settings-max-turns">
                最大ターン数: {maxTurns}
              </label>
              <input
                id="settings-max-turns"
                class="loop-turns-slider"
                type="range"
                min="1"
                max="20"
                bind:value={maxTurns}
                on:input={onPersist}
              />

              <label class="field-label loop-option-label" for="settings-loop-timeout">
                ループタイムアウト (ms)
              </label>
              <input
                id="settings-loop-timeout"
                class="input"
                type="number"
                min="30000"
                max="300000"
                step="1000"
                bind:value={loopTimeoutMs}
                on:change={onPersist}
              />

              <div class="autonomous-settings">
                <label class="checkbox-row">
                  <input type="checkbox" bind:checked={planningEnabled} on:change={onPersist} />
                  <span>計画フェーズを有効にする</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" bind:checked={autoApproveReadSteps} on:change={onPersist} />
                  <span>読み取りステップを自動実行する</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" bind:checked={pauseBetweenSteps} on:change={onPersist} />
                  <span>各ステップの前で一時停止する</span>
                </label>
              </div>
            </div>
          {/if}
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
  .tool-list {
    display: grid;
    gap: 0.75rem;
    margin: 0.75rem 0 1rem;
  }

  .tool-toggle,
  .mcp-tool-card {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    align-items: start;
    padding: 0.8rem;
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    background: var(--ra-surface-muted);
  }

  .mcp-tool-card {
    grid-template-columns: 1fr;
  }

  .tool-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .tool-copy p,
  .mcp-tool-card p {
    margin: 0.2rem 0 0;
  }

  .tool-phase,
  .mcp-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    background: var(--ra-surface);
    border: 1px solid var(--ra-border);
  }

  .mcp-server-input {
    display: grid;
    grid-template-columns: 1fr 160px 140px auto;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .tool-meta {
    font-size: 0.8rem;
    word-break: break-all;
  }
</style>
