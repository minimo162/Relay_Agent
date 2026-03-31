# Codex プロンプト 08 — UI/UX 改善（Tasks 96〜103）

## 対象タスク

- **Task 96**: ウェルカム画面（初回起動）
- **Task 97**: ステップインジケーター リデザイン
- **Task 98**: Edge CDP セットアップガイド
- **Task 99**: エージェントループ モード説明トグルカード
- **Task 100**: エージェントループ進行パネル タイムライン化
- **Task 101**: 完了画面 リデザイン
- **Task 102**: エラーメッセージ ユーザーフレンドリー化
- **Task 103**: 空状態・プレースホルダー改善

## 概要

`apps/desktop/src/routes/+page.svelte`（約 3,554 行）と関連ファイルを改修し、
初見ユーザーが迷わず使えるUI/UXを実現する。

**基本方針:**
- 文脈ゼロでも次のアクションが自明
- 進行状態が常に画面から読み取れる
- エラーは人間の言葉で表示
- 既存の機能・ロジックは変更しない（UIの改善のみ）

## 前提

- SvelteKit SPA + Tauri v2
- `apps/desktop/src/routes/+page.svelte` が単一ページアプリの全体
- CSS カスタムプロパティ: `--ra-bg`, `--ra-surface`, `--ra-accent`, `--ra-success`, `--ra-error` など
- フォント: `'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif`（日本語）
- `apps/desktop/src/lib/continuity.ts` に `BrowserAutomationSettings` 型が定義済み

---

## Task 96: ウェルカム画面（初回起動）

### 実装場所

- `apps/desktop/src/routes/+page.svelte` — ステップ管理ロジックの前に条件分岐追加
- `apps/desktop/src/lib/welcome.ts`（新規）— `hasSeenWelcome()` / `markWelcomeSeen()` ヘルパー

### 実装内容

**`apps/desktop/src/lib/welcome.ts`（新規作成）:**

```typescript
const KEY = "relay_agent_welcome_seen";
export function hasSeenWelcome(): boolean {
  return localStorage.getItem(KEY) === "1";
}
export function markWelcomeSeen(): void {
  localStorage.setItem(KEY, "1");
}
```

**`+page.svelte` の変更:**

1. `<script>` ブロックに追加:
```typescript
import { hasSeenWelcome, markWelcomeSeen } from '$lib/welcome';
let showWelcome = !hasSeenWelcome();

function startFromWelcome() {
  markWelcomeSeen();
  showWelcome = false;
}
```

2. テンプレートの最上部（`<main>` の直下）に以下を追加:
```svelte
{#if showWelcome}
  <div class="welcome-overlay">
    <div class="welcome-card">
      <div class="welcome-logo">🤖</div>
      <h1 class="welcome-title">Relay Agent</h1>
      <p class="welcome-subtitle">
        Copilot があなたの代わりに、<br>表計算を自動化します
      </p>
      <div class="welcome-steps">
        <div class="welcome-step">
          <span class="welcome-step-icon">📁</span>
          <span class="welcome-step-label">ファイルを選ぶ</span>
        </div>
        <div class="welcome-step-arrow">→</div>
        <div class="welcome-step">
          <span class="welcome-step-icon">🤖</span>
          <span class="welcome-step-label">Copilot が処理</span>
        </div>
        <div class="welcome-step-arrow">→</div>
        <div class="welcome-step">
          <span class="welcome-step-icon">✅</span>
          <span class="welcome-step-label">確認して保存</span>
        </div>
      </div>
      <button class="welcome-btn" on:click={startFromWelcome}>
        始める →
      </button>
    </div>
  </div>
{/if}
```

3. CSS（`<style>` ブロックに追加）:
```css
.welcome-overlay {
  position: fixed;
  inset: 0;
  background: var(--ra-bg);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.welcome-card {
  text-align: center;
  max-width: 480px;
  padding: 3rem 2rem;
}
.welcome-logo {
  font-size: 4rem;
  margin-bottom: 1rem;
}
.welcome-title {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--ra-text);
  margin-bottom: 0.5rem;
}
.welcome-subtitle {
  font-size: 1.1rem;
  color: var(--ra-text-muted);
  line-height: 1.7;
  margin-bottom: 2.5rem;
}
.welcome-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 2.5rem;
}
.welcome-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}
.welcome-step-icon {
  font-size: 1.8rem;
}
.welcome-step-label {
  font-size: 0.78rem;
  color: var(--ra-text-muted);
  white-space: nowrap;
}
.welcome-step-arrow {
  color: var(--ra-accent);
  font-size: 1.2rem;
}
.welcome-btn {
  background: var(--ra-accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 0.85rem 2.5rem;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.welcome-btn:hover {
  opacity: 0.88;
}
```

---

## Task 97: ステップインジケーター リデザイン

### 実装場所

`+page.svelte` — `.step-indicator` / `.step-banner` 付近の HTML と CSS

### 実装内容

現状の `.step-banner` を以下の構造に置き換える:

```svelte
<div class="step-progress-bar">
  {#each [
    { num: 1, icon: '📁', label: 'ファイル選択' },
    { num: 2, icon: '🤖', label: 'Copilot 処理' },
    { num: 3, icon: '✅', label: '確認・保存' }
  ] as step, i}
    <div
      class="step-node"
      class:current={currentStep === step.num}
      class:completed={currentStep > step.num}
    >
      <div class="step-circle">
        {#if currentStep > step.num}
          <span class="step-check">✓</span>
        {:else}
          <span class="step-icon">{step.icon}</span>
        {/if}
      </div>
      <span class="step-node-label">{step.label}</span>
    </div>
    {#if i < 2}
      <div class="step-connector" class:filled={currentStep > step.num}></div>
    {/if}
  {/each}
</div>
```

CSS:
```css
.step-progress-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 1rem 2rem;
  background: var(--ra-surface);
  border-bottom: 1px solid var(--ra-border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  opacity: 0.4;
  transition: opacity 0.3s;
}
.step-node.current,
.step-node.completed {
  opacity: 1;
}
.step-circle {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--ra-bg);
  border: 2px solid var(--ra-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  transition: background 0.3s, border-color 0.3s;
}
.step-node.current .step-circle {
  border-color: var(--ra-accent);
  background: var(--ra-accent);
  color: white;
}
.step-node.completed .step-circle {
  border-color: var(--ra-success);
  background: var(--ra-success);
  color: white;
}
.step-check {
  font-size: 1rem;
  font-weight: 700;
}
.step-node-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--ra-text-muted);
}
.step-node.current .step-node-label {
  color: var(--ra-accent);
  font-weight: 600;
}
.step-connector {
  flex: 1;
  height: 2px;
  background: var(--ra-border);
  min-width: 2rem;
  max-width: 4rem;
  transition: background 0.4s;
}
.step-connector.filled {
  background: var(--ra-success);
}
```

---

## Task 98: Edge CDP セットアップガイド

### 実装場所

`+page.svelte` — ブラウザ自動化設定モーダル（`cdpPort` 入力欄付近）

### 実装内容

1. `<script>` に追加:
```typescript
let cdpTestStatus: 'idle' | 'testing' | 'ok' | 'fail' = 'idle';
let cdpTestMessage = '';

async function testCdpConnection() {
  cdpTestStatus = 'testing';
  cdpTestMessage = '';
  try {
    const res = await fetch(`http://127.0.0.1:${browserSettings.cdpPort}/json/version`);
    if (res.ok) {
      const json = await res.json();
      const version = json.Browser?.split('/')[1]?.split('.')[0] ?? '';
      cdpTestMessage = `接続済み${version ? `（Edge ${version}）` : ''}`;
      cdpTestStatus = 'ok';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    cdpTestMessage = 'Edgeが起動しているか、ポート番号を確認してください';
    cdpTestStatus = 'fail';
  }
}
```

2. CDP ポート入力欄の直下に以下を追加（設定モーダル内）:
```svelte
<div class="cdp-guide">
  <details open>
    <summary class="cdp-guide-title">Edge を CDP モードで起動するには</summary>
    <div class="cdp-guide-body">
      <p class="cdp-guide-note">以下のコマンドを実行して Edge を起動してください:</p>
      <div class="cdp-command-row">
        <code class="cdp-command">msedge.exe --remote-debugging-port={browserSettings.cdpPort}</code>
        <button
          class="cdp-copy-btn"
          on:click={() => navigator.clipboard.writeText(`msedge.exe --remote-debugging-port=${browserSettings.cdpPort}`)}
        >
          コピー
        </button>
      </div>
    </div>
  </details>
  <div class="cdp-test-row">
    <button
      class="cdp-test-btn"
      disabled={cdpTestStatus === 'testing'}
      on:click={testCdpConnection}
    >
      {cdpTestStatus === 'testing' ? '確認中…' : '接続テスト'}
    </button>
    {#if cdpTestStatus === 'ok'}
      <span class="cdp-test-result cdp-test-ok">✓ {cdpTestMessage}</span>
    {:else if cdpTestStatus === 'fail'}
      <span class="cdp-test-result cdp-test-fail">✗ {cdpTestMessage}</span>
    {/if}
  </div>
</div>
```

CSS:
```css
.cdp-guide {
  margin-top: 0.75rem;
  background: var(--ra-bg);
  border: 1px solid var(--ra-border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
}
.cdp-guide-title {
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--ra-text-muted);
}
.cdp-guide-body {
  margin-top: 0.5rem;
}
.cdp-guide-note {
  font-size: 0.8rem;
  color: var(--ra-text-muted);
  margin-bottom: 0.4rem;
}
.cdp-command-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cdp-command {
  font-family: monospace;
  font-size: 0.8rem;
  background: var(--ra-surface);
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  flex: 1;
  overflow-x: auto;
}
.cdp-copy-btn {
  font-size: 0.78rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--ra-border);
  background: var(--ra-surface);
  border-radius: 4px;
  cursor: pointer;
}
.cdp-test-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.cdp-test-btn {
  font-size: 0.82rem;
  padding: 0.3rem 0.9rem;
  background: var(--ra-accent);
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.cdp-test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.cdp-test-result {
  font-size: 0.82rem;
}
.cdp-test-ok { color: var(--ra-success); }
.cdp-test-fail { color: var(--ra-error); }
```

---

## Task 99: エージェントループ モード説明トグルカード

### 実装場所

`+page.svelte` — 設定モーダル内の `agentLoopEnabled` チェックボックス部分

### 実装内容

チェックボックスを以下のトグルカードに置き換える:

```svelte
<div class="loop-toggle-card" class:loop-toggle-on={agentLoopEnabled}>
  <div class="loop-toggle-header">
    <div class="loop-toggle-info">
      <span class="loop-toggle-icon">{agentLoopEnabled ? '🤖' : '💬'}</span>
      <div>
        <div class="loop-toggle-title">エージェントループ</div>
        <div class="loop-toggle-desc">
          {#if agentLoopEnabled}
            Copilot が自動で情報収集し、最適な処理を計画します（推奨）
          {:else}
            1 回だけ Copilot に送信します（シンプルモード）
          {/if}
        </div>
      </div>
    </div>
    <button
      class="loop-toggle-switch"
      class:loop-switch-on={agentLoopEnabled}
      role="switch"
      aria-checked={agentLoopEnabled}
      on:click={() => { agentLoopEnabled = !agentLoopEnabled; }}
    >
      <span class="loop-switch-thumb"></span>
    </button>
  </div>

  {#if agentLoopEnabled}
    <div class="loop-options" transition:slide={{ duration: 200 }}>
      <label class="setting-label">
        最大ターン数: {maxTurns}
        <input type="range" min="1" max="20" bind:value={maxTurns} class="loop-turns-slider" />
      </label>
    </div>
  {/if}
</div>
```

`transition:slide` のためのインポートが必要: `import { slide } from 'svelte/transition';`

CSS:
```css
.loop-toggle-card {
  border: 2px solid var(--ra-border);
  border-radius: 10px;
  padding: 1rem;
  transition: border-color 0.2s, background 0.2s;
}
.loop-toggle-card.loop-toggle-on {
  border-color: var(--ra-accent);
  background: color-mix(in srgb, var(--ra-accent) 5%, var(--ra-surface));
}
.loop-toggle-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.loop-toggle-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.loop-toggle-icon {
  font-size: 1.5rem;
}
.loop-toggle-title {
  font-weight: 600;
  font-size: 0.9rem;
}
.loop-toggle-desc {
  font-size: 0.8rem;
  color: var(--ra-text-muted);
  margin-top: 0.1rem;
}
.loop-toggle-switch {
  width: 3rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--ra-border);
  border: none;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.loop-toggle-switch.loop-switch-on {
  background: var(--ra-accent);
}
.loop-switch-thumb {
  position: absolute;
  top: 0.2rem;
  left: 0.2rem;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  display: block;
}
.loop-switch-on .loop-switch-thumb {
  transform: translateX(1.4rem);
}
.loop-options {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--ra-border);
}
.loop-turns-slider {
  width: 100%;
  margin-top: 0.3rem;
}
```

---

## Task 100: エージェントループ進行パネル タイムライン化

### 実装場所

`+page.svelte` — `.agent-loop-panel` および関連の `progress-item` レンダリング部分

### データ型の更新

`<script>` 内の `loopProgressItems` 型を拡張:
```typescript
interface LoopProgressItem {
  tool: string;
  status: 'running' | 'done' | 'error';
  label: string;
  startTime: number;
  endTime?: number;
  errorMessage?: string;
  rawResult?: unknown;
  showDetail?: boolean;
}
```

### HTML の置き換え

`.agent-loop-panel` 内部を以下のタイムライン構造に変更:

```svelte
<div class="loop-timeline">
  <!-- ターン進行バー -->
  <div class="loop-turn-bar">
    <span class="loop-turn-label">ターン {currentTurn} / {maxTurns}</span>
    <div class="loop-turn-track">
      <div class="loop-turn-fill" style="width: {(currentTurn / maxTurns) * 100}%"></div>
    </div>
  </div>

  <!-- タイムラインアイテム -->
  {#each loopProgressItems as item}
    <div class="timeline-item" class:timeline-running={item.status === 'running'} class:timeline-done={item.status === 'done'} class:timeline-error={item.status === 'error'}>
      <div class="timeline-icon">
        {#if item.status === 'running'}
          <span class="spinner">⟳</span>
        {:else if item.status === 'done'}
          <span>✓</span>
        {:else}
          <span>✗</span>
        {/if}
      </div>
      <div class="timeline-body">
        <div class="timeline-tool-row">
          <span class="timeline-tool-name">{item.tool}</span>
          {#if item.endTime}
            <span class="timeline-duration">{((item.endTime - item.startTime) / 1000).toFixed(1)}s</span>
          {/if}
        </div>
        {#if item.status === 'error' && item.errorMessage}
          <div class="timeline-error-msg">{item.errorMessage}</div>
        {/if}
        {#if item.rawResult}
          <button class="timeline-detail-btn" on:click={() => { item.showDetail = !item.showDetail; }}>
            {item.showDetail ? '詳細を隠す' : '詳細を見る'}
          </button>
          {#if item.showDetail}
            <pre class="timeline-detail-json">{JSON.stringify(item.rawResult, null, 2)}</pre>
          {/if}
        {/if}
      </div>
    </div>
  {/each}

  <!-- Copilot コメントバブル -->
  {#if copilotSummary}
    <div class="copilot-bubble">
      <span class="copilot-bubble-icon">🤖</span>
      <div class="copilot-bubble-text">{copilotSummary}</div>
    </div>
  {/if}
</div>
```

CSS:
```css
.loop-timeline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.loop-turn-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.loop-turn-label {
  font-size: 0.78rem;
  color: var(--ra-text-muted);
  white-space: nowrap;
}
.loop-turn-track {
  flex: 1;
  height: 4px;
  background: var(--ra-border);
  border-radius: 2px;
}
.loop-turn-fill {
  height: 100%;
  background: var(--ra-accent);
  border-radius: 2px;
  transition: width 0.4s;
}
.timeline-item {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--ra-bg);
}
.timeline-running { border-left: 3px solid var(--ra-accent); }
.timeline-done    { border-left: 3px solid var(--ra-success); }
.timeline-error   { border-left: 3px solid var(--ra-error); }
.timeline-icon {
  font-size: 1rem;
  width: 1.2rem;
  text-align: center;
  flex-shrink: 0;
}
.timeline-running .timeline-icon { color: var(--ra-accent); }
.timeline-done    .timeline-icon { color: var(--ra-success); }
.timeline-error   .timeline-icon { color: var(--ra-error); }
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { display: inline-block; animation: spin 1s linear infinite; }
.timeline-body { flex: 1; min-width: 0; }
.timeline-tool-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.timeline-tool-name { font-size: 0.85rem; font-weight: 500; }
.timeline-duration { font-size: 0.75rem; color: var(--ra-text-muted); }
.timeline-error-msg {
  font-size: 0.78rem;
  color: var(--ra-error);
  margin-top: 0.2rem;
}
.timeline-detail-btn {
  font-size: 0.75rem;
  color: var(--ra-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-top: 0.25rem;
}
.timeline-detail-json {
  font-size: 0.7rem;
  background: var(--ra-surface);
  padding: 0.5rem;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 200px;
  margin-top: 0.25rem;
}
.copilot-bubble {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  background: color-mix(in srgb, var(--ra-accent) 8%, var(--ra-surface));
  border-radius: 10px;
  padding: 0.75rem 1rem;
  margin-top: 0.25rem;
}
.copilot-bubble-icon { font-size: 1.2rem; flex-shrink: 0; }
.copilot-bubble-text { font-size: 0.85rem; line-height: 1.5; }
```

**`loopProgressItems` の更新:** ループ実行中に `startTime` を記録し、完了時に `endTime` を設定するように既存の更新コードを修正。`copilotSummary` 変数に Copilot の `summary` フィールドを代入するコードも追加。

---

## Task 101: 完了画面 リデザイン

### 実装場所

`+page.svelte` — `status === 'done'` または保存完了後の表示ブロック

### 実装内容

完了状態の表示部分を以下に置き換える:

```svelte
<div class="completion-screen">
  <div class="completion-icon">✅</div>
  <h2 class="completion-title">完了しました！</h2>
  {#if copilotSummary}
    <p class="completion-summary">{copilotSummary}</p>
  {/if}

  <div class="completion-stats">
    {#if savedFilePath}
      <div class="stat-item">
        <span class="stat-icon">📄</span>
        <span class="stat-label">出力ファイル</span>
        <span class="stat-value">{savedFilePath.split(/[\\/]/).pop()}</span>
      </div>
    {/if}
    {#if elapsedSeconds}
      <div class="stat-item">
        <span class="stat-icon">⏱</span>
        <span class="stat-label">所要時間</span>
        <span class="stat-value">{elapsedSeconds} 秒</span>
      </div>
    {/if}
  </div>

  <div class="completion-actions">
    {#if savedFilePath}
      <button class="completion-open-btn" on:click={() => openFile(savedFilePath)}>
        📂 出力ファイルを開く
      </button>
    {/if}
    <button class="completion-reset-btn" on:click={resetAll}>
      もう一度
    </button>
  </div>
</div>
```

CSS:
```css
.completion-screen {
  text-align: center;
  padding: 3rem 2rem;
}
.completion-icon {
  font-size: 4rem;
  animation: pulse 0.6s ease-out;
}
@keyframes pulse {
  0%   { transform: scale(0.5); opacity: 0; }
  70%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}
.completion-title {
  font-size: 1.8rem;
  font-weight: 700;
  margin: 0.75rem 0 0.5rem;
}
.completion-summary {
  font-size: 0.95rem;
  color: var(--ra-text-muted);
  max-width: 400px;
  margin: 0 auto 1.5rem;
  line-height: 1.6;
}
.completion-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--ra-surface);
  border-radius: 10px;
  padding: 1rem 1.5rem;
  max-width: 380px;
  margin: 0 auto 2rem;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
}
.stat-icon { font-size: 1rem; }
.stat-label { color: var(--ra-text-muted); flex: 1; text-align: left; }
.stat-value { font-weight: 600; }
.completion-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}
.completion-open-btn {
  background: var(--ra-accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 0.7rem 1.5rem;
  font-size: 0.9rem;
  cursor: pointer;
}
.completion-reset-btn {
  background: var(--ra-surface);
  color: var(--ra-text);
  border: 1px solid var(--ra-border);
  border-radius: 8px;
  padding: 0.7rem 1.5rem;
  font-size: 0.9rem;
  cursor: pointer;
}
```

---

## Task 102: エラーメッセージ ユーザーフレンドリー化

### 実装場所

- `apps/desktop/src/lib/error-messages.ts`（新規）
- `+page.svelte` — 全エラー表示箇所

### `apps/desktop/src/lib/error-messages.ts`（新規作成）:

```typescript
interface FriendlyError {
  message: string;
  hint?: string;
  icon: string;
}

const ERROR_MAP: Array<{ pattern: RegExp; result: FriendlyError }> = [
  {
    pattern: /ECONNREFUSED.*922[0-9]/i,
    result: {
      icon: '🔌',
      message: 'Edge が CDP モードで起動していません。',
      hint: 'ポート 9222 で起動してください（設定モーダルの「接続テスト」を参照）'
    }
  },
  {
    pattern: /timeout|timed.?out/i,
    result: {
      icon: '⏱',
      message: 'Copilot の応答がタイムアウトしました。',
      hint: 'Edge の接続状態を確認してから、もう一度お試しください'
    }
  },
  {
    pattern: /maximum.?turns|max.*turns/i,
    result: {
      icon: '🔄',
      message: '最大ターン数に達しました。',
      hint: 'より具体的な目的を入力するか、最大ターン数を増やしてください'
    }
  },
  {
    pattern: /validation.*error|zod.*error|schema/i,
    result: {
      icon: '⚠️',
      message: 'Copilot の返答形式が想定外でした。',
      hint: 'もう一度試してください。繰り返す場合は手動モードをお試しください'
    }
  },
  {
    pattern: /cancelled|abort/i,
    result: {
      icon: '⏹',
      message: 'キャンセルしました。',
      hint: undefined
    }
  }
];

export function getFriendlyError(raw: string | Error): FriendlyError {
  const msg = raw instanceof Error ? (raw.message + ' ' + (raw.stack ?? '')) : raw;
  for (const { pattern, result } of ERROR_MAP) {
    if (pattern.test(msg)) return result;
  }
  return {
    icon: '⚠️',
    message: 'エラーが発生しました。',
    hint: raw instanceof Error ? raw.message : raw
  };
}
```

### `+page.svelte` での使用

`import { getFriendlyError } from '$lib/error-messages';` を追加。

エラー表示箇所（`errorMessage` を表示している全箇所）を以下のコンポーネントに変更:

```svelte
{#if errorMessage}
  {@const fe = getFriendlyError(errorMessage)}
  <div class="friendly-error">
    <span class="fe-icon">{fe.icon}</span>
    <div class="fe-body">
      <div class="fe-message">{fe.message}</div>
      {#if fe.hint}
        <div class="fe-hint">{fe.hint}</div>
      {/if}
    </div>
  </div>
{/if}
```

CSS:
```css
.friendly-error {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  background: color-mix(in srgb, var(--ra-error) 8%, var(--ra-surface));
  border: 1px solid color-mix(in srgb, var(--ra-error) 30%, transparent);
  border-radius: 8px;
  padding: 0.75rem 1rem;
}
.fe-icon { font-size: 1.3rem; flex-shrink: 0; }
.fe-body { flex: 1; }
.fe-message { font-size: 0.88rem; font-weight: 600; color: var(--ra-error); }
.fe-hint { font-size: 0.8rem; color: var(--ra-text-muted); margin-top: 0.2rem; }
```

---

## Task 103: 空状態・プレースホルダー改善

### 実装場所

`+page.svelte` — ステップ1のドロップゾーン、ステップ2の目的入力欄

### ドロップゾーン（ステップ1）

ファイル未選択時の表示を以下に強化（既存の `dropzone` クラス要素を置き換え）:

```svelte
<div
  class="dropzone-large"
  class:dropzone-hover={isDragOver}
  on:dragover|preventDefault={() => { isDragOver = true; }}
  on:dragleave={() => { isDragOver = false; }}
  on:drop|preventDefault={handleDrop}
  on:click={openFilePicker}
  role="button"
  tabindex="0"
>
  <div class="dropzone-icon">📊</div>
  <div class="dropzone-primary">CSV または XLSX ファイルをドロップ</div>
  <div class="dropzone-secondary">またはクリックして選択</div>
  <div class="dropzone-badges">
    <span class="ext-badge">.csv</span>
    <span class="ext-badge">.xlsx</span>
  </div>
</div>
```

CSS:
```css
.dropzone-large {
  border: 2px dashed var(--ra-border);
  border-radius: 14px;
  padding: 3.5rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.dropzone-large:hover,
.dropzone-hover {
  border-color: var(--ra-accent);
  background: color-mix(in srgb, var(--ra-accent) 4%, var(--ra-surface));
}
.dropzone-icon { font-size: 3rem; margin-bottom: 0.75rem; }
.dropzone-primary {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ra-text);
  margin-bottom: 0.3rem;
}
.dropzone-secondary {
  font-size: 0.85rem;
  color: var(--ra-text-muted);
  margin-bottom: 1rem;
}
.dropzone-badges {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}
.ext-badge {
  font-size: 0.75rem;
  font-family: monospace;
  background: var(--ra-surface);
  border: 1px solid var(--ra-border);
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
  color: var(--ra-text-muted);
}
```

### 目的欄プリセット（ステップ2）

目的入力 `<textarea>` の下に以下を追加:

```svelte
<div class="objective-presets">
  <span class="preset-label">例:</span>
  {#each [
    'approved が true の行だけ残してください',
    'amount 列の合計を新しい列として追加してください',
    '重複行を削除してシートを整理してください'
  ] as preset}
    <button
      class="preset-btn"
      on:click={() => { objective = preset; }}
    >
      {preset}
    </button>
  {/each}
</div>
```

CSS:
```css
.objective-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.5rem;
}
.preset-label {
  font-size: 0.78rem;
  color: var(--ra-text-muted);
  flex-shrink: 0;
}
.preset-btn {
  font-size: 0.78rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--ra-border);
  background: var(--ra-surface);
  border-radius: 999px;
  cursor: pointer;
  color: var(--ra-text);
  transition: border-color 0.15s, background 0.15s;
}
.preset-btn:hover {
  border-color: var(--ra-accent);
  background: color-mix(in srgb, var(--ra-accent) 6%, var(--ra-surface));
}
```

---

## 実装順序

Tasks を以下の順で実装する（依存関係順）:

1. **Task 102** — エラーメッセージ（他の変更に影響しない独立した変更）
2. **Task 97** — ステップインジケーター（基盤となる視覚的変更）
3. **Task 96** — ウェルカム画面（オーバーレイとして独立）
4. **Task 103** — 空状態・プレースホルダー（ステップ1/2の改善）
5. **Task 98** — CDP セットアップガイド（設定モーダル内）
6. **Task 99** — エージェントループトグルカード（設定モーダル内）
7. **Task 100** — ループ進行パネル タイムライン化（最も複雑）
8. **Task 101** — 完了画面（最後に実装）

## 注意事項

- 既存のロジック（IPC 呼び出し、エージェントループ関数、バリデーション処理）は変更しない
- 既存の CSS カスタムプロパティ（`--ra-*`）を使用する。新しい色を直接ハードコードしない
- `color-mix()` は最新の CSS で利用可能。Tauri WebView（WebKit2/Chromium）でサポート済み
- `transition:slide` は Svelte ビルトインの `svelte/transition` を使用
- `isDragOver` など新しい状態変数を追加する際は、既存の変数名と衝突しないよう確認する
- `currentTurn`, `maxTurns`, `copilotSummary`, `savedFilePath`, `elapsedSeconds` などの変数は
  既存の変数名に合わせて調整する（`+page.svelte` の実際の変数名を確認してから実装すること）

## 検証チェックリスト

- [ ] ローカルストレージ未設定でウェルカム画面が表示される
- [ ] ウェルカム画面の「始める」後は次回起動で表示されない
- [ ] ステップ1→2→3の遷移でプログレスバーが正しく更新される
- [ ] 設定モーダルに CDP ガイドと接続テストボタンが表示される
- [ ] エージェントループトグルのON/OFFでスライダーがアニメーション展開/格納される
- [ ] ループ実行中にタイムラインアイテムが順次追加される
- [ ] 保存完了後に完了画面とパルスアニメーションが表示される
- [ ] ECONNREFUSED エラーでユーザーフレンドリーなメッセージが表示される
- [ ] ドロップゾーンにホバー時に視覚的フィードバックがある
- [ ] プリセットボタンで目的欄にテキストが挿入される
