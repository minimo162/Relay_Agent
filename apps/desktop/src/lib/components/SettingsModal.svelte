<script lang="ts">
  import { slide } from "svelte/transition";

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
  export let cdpTestStatus: "idle" | "testing" | "ok" | "fail" = "idle";
  export let cdpTestMessage = "";
  export let copiedBrowserCommandNotice = "";
  export let edgeLaunchCommand = "";
  export let autoPortRangeLabel = "";
  export let storagePath: string | null = null;
  export let onClose: () => void = () => {};
  export let onToggleAutoLaunch: () => void = () => {};
  export let onPersist: () => void = () => {};
  export let onCopyCommand: () => void = () => {};
  export let onTestConnection: () => void = () => {};
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

        {#if storagePath}
          <h3>ローカルストレージ</h3>
          <code class="storage-path">{storagePath}</code>
        {/if}
      </div>
    </div>
  </div>
{/if}
