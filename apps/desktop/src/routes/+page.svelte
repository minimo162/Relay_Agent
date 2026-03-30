<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    type PreflightWorkbookResponse,
    type Session,
    type StartupIssue
  } from "@relay-agent/contracts";
  import {
    createSession,
    generateRelayPacket,
    initializeApp,
    listRecentSessions,
    listSessions,
    pingDesktop,
    preflightWorkbook,
    previewExecution,
    rememberRecentFile,
    rememberRecentSession,
    respondToApproval,
    runExecution,
    startTurn,
    submitCopilotResponse,
    type RecentSession
  } from "$lib";
  import { autoFixCopilotResponse } from "$lib/auto-fix";

  /* ── 状態 ── */
  type Step = 1 | 2 | 3;
  let currentStep: Step = 1;
  let busy = false;
  let errorMsg = "";
  let settingsOpen = false;

  /* アプリ起動 */
  let appReady = false;
  let startupIssue: StartupIssue | null = null;
  let storagePath: string | null = null;
  let sampleWorkbookPath: string | null = null;

  /* ステップ1: ファイルとやりたいこと */
  let filePath = "";
  let objectiveText = "";
  let preflight: PreflightWorkbookResponse | null = null;
  let preflightError = "";

  /* ステップ2: Copilot に聞く */
  let relayPacketText = "";
  let relayPacketSummary = "";
  let copilotResponse = "";
  let autoFixMessages: string[] = [];
  let showInstructionPreview = false;
  let sessionId = "";
  let turnId = "";

  /* ステップ3: 確認して保存 */
  let previewSummary = "";
  let previewTargetCount = 0;
  let previewAffectedRows = 0;
  let previewOutputPath = "";
  let previewWarnings: string[] = [];
  let previewRequiresApproval = false;
  let executionDone = false;
  let executionSummary = "";

  /* 最近の作業 */
  let recentSessions: RecentSession[] = [];
  let showRecent = false;

  /* テンプレート */
  const templates = [
    { label: "ファイルを安全に確認", objective: "ファイルを開いて、変更予定を表示し、安全なコピーを保存する" },
    { label: "必要な行だけ抽出", objective: "必要な行だけ残して、結果を説明し、別コピーとして保存する" },
    { label: "列名を変更", objective: "指定した列名を変更して、影響を表示し、別コピーとして保存する" },
    { label: "合計を集計", objective: "指定した行の合計を集計して、結果を説明し、別コピーとして保存する" }
  ];

  /* ── ヘルパー ── */
  function toError(e: unknown): string {
    if (e instanceof Error && e.message) return e.message;
    return "予期しないエラーが発生しました";
  }

  function resetAll(): void {
    currentStep = 1;
    busy = false;
    errorMsg = "";
    filePath = "";
    objectiveText = "";
    preflight = null;
    preflightError = "";
    relayPacketText = "";
    relayPacketSummary = "";
    copilotResponse = "";
    autoFixMessages = [];
    showInstructionPreview = false;
    sessionId = "";
    turnId = "";
    previewSummary = "";
    previewTargetCount = 0;
    previewAffectedRows = 0;
    previewOutputPath = "";
    previewWarnings = [];
    previewRequiresApproval = false;
    executionDone = false;
    executionSummary = "";
  }

  function deriveTitle(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "新しい作業";
    const first = trimmed.split(/[,.、。]/)[0].trim();
    return first.length > 30 ? first.slice(0, 30) + "…" : first;
  }

  async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  /* ── ステップ処理 ── */
  async function handleStep1(): Promise<void> {
    errorMsg = "";
    busy = true;

    try {
      const path = filePath.trim();
      if (!path) {
        errorMsg = "ファイルパスを入力してください";
        return;
      }
      if (!objectiveText.trim()) {
        errorMsg = "やりたいことを入力してください";
        return;
      }

      // ファイルチェック
      const result = await preflightWorkbook({ workbookPath: path });
      preflight = result;

      if (result.status === "blocked") {
        errorMsg = result.summary;
        return;
      }

      // セッション作成
      const title = deriveTitle(objectiveText);
      const session = await createSession({
        title,
        objective: objectiveText,
        primaryWorkbookPath: path
      });
      sessionId = session.id;

      rememberRecentSession({
        sessionId: session.id,
        title: session.title,
        workbookPath: path,
        lastOpenedAt: new Date().toISOString(),
        lastTurnTitle: ""
      });
      rememberRecentFile({
        path,
        lastUsedAt: new Date().toISOString(),
        sessionId: session.id,
        source: "session"
      });

      // ターン開始
      const turnResponse = await startTurn({
        sessionId: session.id,
        title,
        objective: objectiveText,
        mode: "plan"
      });
      turnId = turnResponse.turn.id;

      // 依頼テキスト生成
      const packet = await generateRelayPacket({
        sessionId: session.id,
        turnId: turnResponse.turn.id
      });
      relayPacketText = typeof packet === "string" ? packet : JSON.stringify(packet, null, 2);
      relayPacketSummary = `${title} — ${path}`;

      currentStep = 2;
    } catch (e) {
      errorMsg = toError(e);
    } finally {
      busy = false;
    }
  }

  async function handleStep2(): Promise<void> {
    errorMsg = "";
    autoFixMessages = [];
    busy = true;

    try {
      if (!copilotResponse.trim()) {
        errorMsg = "Copilot の返答を貼り付けてください";
        return;
      }

      // 自動修正
      const fixResult = autoFixCopilotResponse(copilotResponse);
      autoFixMessages = fixResult.fixes;
      const fixedResponse = fixResult.fixed;

      // 送信
      const submitResult = await submitCopilotResponse({
        sessionId,
        turnId,
        rawResponse: fixedResponse
      });

      if (!submitResult.accepted) {
        const issues = submitResult.validationIssues?.map((i: { message: string }) => i.message).join("; ");
        errorMsg = issues || "返答の形式が正しくありません";
        return;
      }

      // プレビュー
      const preview = await previewExecution({ sessionId, turnId });
      const diff = preview.diffSummary;
      previewSummary = `${diff.targetCount} 件の変更、推定 ${diff.estimatedAffectedRows} 行に影響`;
      previewTargetCount = diff.targetCount;
      previewAffectedRows = diff.estimatedAffectedRows;
      previewOutputPath = diff.outputPath;
      previewWarnings = preview.warnings;
      previewRequiresApproval = preview.requiresApproval;

      currentStep = 3;
    } catch (e) {
      errorMsg = toError(e);
    } finally {
      busy = false;
    }
  }

  async function handleStep3(): Promise<void> {
    errorMsg = "";
    busy = true;

    try {
      // 承認が必要なら承認する
      if (previewRequiresApproval) {
        await respondToApproval({ sessionId, turnId, decision: "approved" });
      }

      // 実行
      const result = await runExecution({ sessionId, turnId });
      executionSummary = result.executed
        ? `保存が完了しました${result.outputPath ? ` — ${result.outputPath}` : ""}`
        : (result.reason || "実行できませんでした");
      if (result.outputPath) {
        previewOutputPath = result.outputPath;
      }
      executionDone = true;
    } catch (e) {
      errorMsg = toError(e);
    } finally {
      busy = false;
    }
  }

  /* ── 初期化 ── */
  onMount(async () => {
    try {
      await pingDesktop();
      const app = await initializeApp();
      appReady = app.initialized;
      startupIssue = app.startupIssue ?? null;
      storagePath = app.storagePath ?? null;
      sampleWorkbookPath = app.sampleWorkbookPath ?? null;
    } catch (e) {
      errorMsg = toError(e);
    }

    recentSessions = listRecentSessions();
  });
</script>

<svelte:head>
  <title>Relay Agent</title>
</svelte:head>

<!-- ヘッダー -->
<header class="header">
  <div class="header-left">
    <span class="header-icon">📋</span>
    <span class="header-title">Relay Agent</span>
  </div>
  <button
    class="header-settings"
    type="button"
    on:click={() => (settingsOpen = !settingsOpen)}
    aria-label="設定を開く"
  >⚙</button>
</header>

<!-- 最近の作業 -->
{#if recentSessions.length > 0 && currentStep === 1 && !executionDone}
  <button
    class="recent-toggle"
    type="button"
    on:click={() => (showRecent = !showRecent)}
  >
    {showRecent ? "最近の作業を閉じる" : `最近の作業（${recentSessions.length}件）`}
  </button>

  {#if showRecent}
    <div class="recent-list">
      {#each recentSessions.slice(0, 5) as rs}
        <div class="recent-item">
          <span class="recent-title">{rs.title}</span>
          {#if rs.workbookPath}
            <span class="recent-path">{rs.workbookPath}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

<!-- ステップインジケーター -->
<div class="steps-indicator">
  <div class="step-dot" class:active={currentStep >= 1} class:done={currentStep > 1}>1</div>
  <div class="step-line" class:active={currentStep >= 2}></div>
  <div class="step-dot" class:active={currentStep >= 2} class:done={currentStep > 2}>2</div>
  <div class="step-line" class:active={currentStep >= 3}></div>
  <div class="step-dot" class:active={currentStep >= 3}>3</div>
</div>

<!-- 起動エラー -->
{#if startupIssue}
  <div class="card card-warn">
    <strong>{startupIssue.problem}</strong>
    <p>{startupIssue.reason}</p>
  </div>
{/if}

<!-- ステップ 1: ファイルとやりたいこと -->
{#if currentStep === 1}
  <section class="card">
    <h2 class="step-title">ステップ 1: ファイルとやりたいこと</h2>

    <label class="field-label" for="file-path">ファイルパス</label>
    <div class="file-row">
      <input
        id="file-path"
        type="text"
        class="input"
        bind:value={filePath}
        placeholder="例: C:\Users\you\data.csv"
        disabled={busy}
      />
      {#if sampleWorkbookPath}
        <button
          class="chip"
          type="button"
          on:click={() => { filePath = sampleWorkbookPath ?? ''; }}
          disabled={busy}
        >練習用サンプル</button>
      {/if}
    </div>

    {#if preflight && preflight.status === "warning"}
      <p class="field-warn">⚠ {preflight.summary}</p>
    {/if}
    {#if preflightError}
      <p class="field-error">{preflightError}</p>
    {/if}

    <label class="field-label" for="objective">やりたいこと</label>
    <div class="template-row">
      {#each templates as t}
        <button
          class="chip"
          type="button"
          on:click={() => { objectiveText = t.objective; }}
          disabled={busy}
        >{t.label}</button>
      {/each}
    </div>
    <textarea
      id="objective"
      class="textarea"
      bind:value={objectiveText}
      placeholder="どんな変更をしたいか、自由に書いてください"
      rows="3"
      disabled={busy}
    ></textarea>

    {#if errorMsg && currentStep === 1}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <button
      class="btn btn-primary"
      type="button"
      on:click={handleStep1}
      disabled={busy || !filePath.trim() || !objectiveText.trim()}
    >
      {busy ? "準備中…" : "準備する →"}
    </button>
  </section>

<!-- ステップ 2: Copilot に聞く -->
{:else if currentStep === 2}
  <section class="card">
    <h2 class="step-title">ステップ 2: Copilot に聞く</h2>

    <!-- 折りたたみサマリー：ステップ1の内容 -->
    <div class="step-summary">
      <span class="step-summary-label">ファイル:</span> {filePath}
      <br />
      <span class="step-summary-label">やりたいこと:</span> {objectiveText.slice(0, 60)}{objectiveText.length > 60 ? "…" : ""}
    </div>

    <p class="instruction-text">
      下の「依頼をコピー」ボタンを押して、Copilot に貼り付けてください。
      返ってきた JSON をそのまま下のテキストエリアに貼り付けてください。
    </p>

    <div class="copy-row">
      <button
        class="btn btn-accent"
        type="button"
        on:click={() => copyToClipboard(relayPacketText)}
        disabled={busy}
      >📋 依頼をコピー</button>
      <button
        class="btn-link"
        type="button"
        on:click={() => (showInstructionPreview = !showInstructionPreview)}
      >{showInstructionPreview ? "依頼を閉じる" : "依頼を見る"}</button>
    </div>

    {#if showInstructionPreview}
      <pre class="preview-block">{relayPacketText}</pre>
    {/if}

    <label class="field-label" for="copilot-response">Copilot の返答</label>
    <textarea
      id="copilot-response"
      class="textarea textarea-tall"
      bind:value={copilotResponse}
      placeholder="Copilot から返ってきた JSON をここに貼り付け"
      rows="8"
      disabled={busy}
    ></textarea>

    {#if autoFixMessages.length > 0}
      <div class="autofix-notice">
        {#each autoFixMessages as msg}
          <span class="autofix-chip">✓ {msg}</span>
        {/each}
      </div>
    {/if}

    {#if errorMsg && currentStep === 2}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <div class="btn-row">
      <button
        class="btn btn-secondary"
        type="button"
        on:click={() => { currentStep = 1; errorMsg = ""; }}
        disabled={busy}
      >← 戻る</button>
      <button
        class="btn btn-primary"
        type="button"
        on:click={handleStep2}
        disabled={busy || !copilotResponse.trim()}
      >
        {busy ? "確認中…" : "確認する →"}
      </button>
    </div>
  </section>

<!-- ステップ 3: 確認して保存 -->
{:else if currentStep === 3 && !executionDone}
  <section class="card">
    <h2 class="step-title">ステップ 3: 確認して保存</h2>

    <!-- 折りたたみサマリー -->
    <div class="step-summary">
      <span class="step-summary-label">ファイル:</span> {filePath}
    </div>

    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">変更対象</span>
        <span class="summary-value">{previewTargetCount} 件</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">影響行数</span>
        <span class="summary-value">{previewAffectedRows} 行</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">保存先</span>
        <span class="summary-value summary-path">{previewOutputPath || "自動決定"}</span>
      </div>
    </div>

    {#if previewSummary}
      <p class="preview-text">{previewSummary}</p>
    {/if}

    {#if previewWarnings.length > 0}
      <div class="warnings">
        {#each previewWarnings as w}
          <p class="field-warn">⚠ {w}</p>
        {/each}
      </div>
    {/if}

    <p class="safety-note">
      元のファイルはそのまま残ります。変更は別のコピーに保存されます。
    </p>

    {#if errorMsg && currentStep === 3}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <div class="btn-row">
      <button
        class="btn btn-secondary"
        type="button"
        on:click={() => { currentStep = 2; errorMsg = ""; }}
        disabled={busy}
      >← 戻る</button>
      <button
        class="btn btn-primary btn-save"
        type="button"
        on:click={handleStep3}
        disabled={busy}
      >
        {busy ? "保存中…" : "保存する"}
      </button>
    </div>
  </section>

<!-- 完了画面 -->
{:else if executionDone}
  <section class="card card-success">
    <h2 class="step-title">保存が完了しました</h2>

    {#if executionSummary}
      <p class="execution-summary">{executionSummary}</p>
    {/if}

    {#if previewOutputPath}
      <p class="output-path">保存先: <code>{previewOutputPath}</code></p>
    {/if}

    <button
      class="btn btn-primary"
      type="button"
      on:click={resetAll}
    >新しい作業を始める</button>
  </section>
{/if}

<!-- 設定モーダル -->
{#if settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click|self={() => (settingsOpen = false)}>
    <div class="modal">
      <div class="modal-header">
        <h2>設定</h2>
        <button class="modal-close" type="button" on:click={() => (settingsOpen = false)}>✕</button>
      </div>

      <div class="modal-body">
        <h3>実行ポリシー</h3>
        <ul class="settings-list">
          <li>書き込み操作はプレビューと承認を経てから実行されます</li>
          <li>保存先は常に別コピーです（元ファイルを直接変更しません）</li>
          <li>元のファイルは読み取り専用として扱われます</li>
        </ul>

        <h3>データの保存場所</h3>
        <ul class="settings-list">
          <li>セッション・ログ・設定はこのデバイスにのみ保存されます</li>
          <li>アプリの外に自動送信されるデータはありません</li>
          <li>Copilot に渡すテキストのみ、手動でコピーした場合に外部に出ます</li>
        </ul>

        {#if storagePath}
          <h3>ローカルストレージ</h3>
          <code class="storage-path">{storagePath}</code>
          <p class="settings-hint">
            保存データを削除するには、アプリを閉じてからこのフォルダを削除してください。
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── ヘッダー ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
    margin-bottom: 0.5rem;
    padding-top: 0.75rem;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .header-icon {
    font-size: 1.3rem;
  }
  .header-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--ra-text);
  }
  .header-settings {
    background: none;
    border: none;
    font-size: 1.3rem;
    color: var(--ra-text-muted);
    padding: 0.25rem 0.5rem;
    border-radius: var(--ra-radius-sm);
    transition: color 0.15s;
  }
  .header-settings:hover {
    color: var(--ra-text);
    background: var(--ra-surface);
  }

  /* ── 最近の作業 ── */
  .recent-toggle {
    display: block;
    background: none;
    border: none;
    color: var(--ra-text-secondary);
    font-size: 0.85rem;
    padding: 0.25rem 0;
    margin-bottom: 0.5rem;
  }
  .recent-toggle:hover {
    color: var(--ra-accent);
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--ra-surface);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
  }
  .recent-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .recent-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ra-text);
  }
  .recent-path {
    font-size: 0.78rem;
    color: var(--ra-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── ステップインジケーター ── */
  .steps-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin: 1rem 0 1.5rem;
  }
  .step-dot {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 700;
    border: 2px solid var(--ra-border-strong);
    color: var(--ra-text-muted);
    background: var(--ra-surface);
    transition: all 0.2s;
  }
  .step-dot.active {
    border-color: var(--ra-accent);
    color: var(--ra-accent);
    background: var(--ra-accent-light);
  }
  .step-dot.done {
    border-color: var(--ra-success);
    color: white;
    background: var(--ra-success);
  }
  .step-line {
    width: 3rem;
    height: 2px;
    background: var(--ra-border-strong);
    transition: background 0.2s;
  }
  .step-line.active {
    background: var(--ra-accent);
  }

  /* ── カード ── */
  .card {
    background: var(--ra-surface);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: var(--ra-shadow);
  }
  .card-warn {
    border-color: #f59e0b;
    background: var(--ra-warn-light);
  }
  .card-success {
    border-color: var(--ra-success-border);
    background: var(--ra-success-light);
  }
  .step-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 0 1rem;
    color: var(--ra-text);
  }

  /* ── フォーム要素 ── */
  .field-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ra-text-secondary);
    margin-bottom: 0.35rem;
    margin-top: 1rem;
  }
  .field-label:first-of-type {
    margin-top: 0;
  }
  .input {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface);
    color: var(--ra-text);
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus {
    border-color: var(--ra-accent);
  }
  .textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface);
    color: var(--ra-text);
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
    line-height: 1.5;
  }
  .textarea:focus {
    border-color: var(--ra-accent);
  }
  .textarea-tall {
    min-height: 10rem;
  }
  .file-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .file-row .input {
    flex: 1;
  }

  /* ── チップ ── */
  .chip {
    display: inline-block;
    padding: 0.3rem 0.7rem;
    font-size: 0.82rem;
    border: 1px solid var(--ra-border);
    border-radius: 2rem;
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
    transition: all 0.15s;
    white-space: nowrap;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--ra-accent-border);
    color: var(--ra-accent);
    background: var(--ra-accent-light);
  }
  .chip:disabled {
    opacity: 0.5;
  }
  .template-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  /* ── ボタン ── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: var(--ra-radius-sm);
    font-weight: 600;
    font-size: 0.95rem;
    transition: all 0.15s;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--ra-accent);
    color: white;
    margin-top: 1rem;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--ra-accent-hover);
  }
  .btn-secondary {
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
    border: 1px solid var(--ra-border);
    margin-top: 1rem;
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--ra-surface);
    border-color: var(--ra-border-strong);
  }
  .btn-accent {
    background: var(--ra-accent);
    color: white;
  }
  .btn-accent:hover:not(:disabled) {
    background: var(--ra-accent-hover);
  }
  .btn-save {
    min-width: 8rem;
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--ra-text-muted);
    font-size: 0.85rem;
    padding: 0.25rem 0;
  }
  .btn-link:hover {
    color: var(--ra-accent);
  }
  .btn-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  /* ── エラー・警告 ── */
  .field-error {
    color: var(--ra-error);
    font-size: 0.88rem;
    margin: 0.5rem 0 0;
  }
  .field-warn {
    color: #b45309;
    font-size: 0.88rem;
    margin: 0.5rem 0 0;
  }

  /* ── ステップ2 固有 ── */
  .step-summary {
    padding: 0.6rem 0.75rem;
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    font-size: 0.85rem;
    color: var(--ra-text-secondary);
    margin-bottom: 1rem;
    line-height: 1.6;
  }
  .step-summary-label {
    font-weight: 600;
    color: var(--ra-text);
  }
  .instruction-text {
    font-size: 0.9rem;
    color: var(--ra-text-secondary);
    margin: 0 0 0.75rem;
    line-height: 1.6;
  }
  .copy-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .preview-block {
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    overflow-x: auto;
    max-height: 12rem;
    margin-bottom: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .autofix-notice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .autofix-chip {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    background: var(--ra-success-light);
    border: 1px solid var(--ra-success-border);
    border-radius: 2rem;
    color: var(--ra-success);
  }

  /* ── ステップ3 固有 ── */
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .summary-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem;
    background: var(--ra-surface-muted);
    border-radius: var(--ra-radius-sm);
    text-align: center;
  }
  .summary-label {
    font-size: 0.78rem;
    color: var(--ra-text-muted);
    font-weight: 600;
  }
  .summary-value {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ra-text);
  }
  .summary-path {
    font-size: 0.78rem;
    font-weight: 500;
    word-break: break-all;
  }
  .preview-text {
    font-size: 0.9rem;
    color: var(--ra-text-secondary);
    margin: 0 0 0.75rem;
  }
  .warnings {
    margin-bottom: 0.75rem;
  }
  .safety-note {
    font-size: 0.82rem;
    color: var(--ra-text-muted);
    background: var(--ra-success-light);
    border: 1px solid var(--ra-success-border);
    border-radius: var(--ra-radius-sm);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
  }

  /* ── 完了画面 ── */
  .execution-summary {
    font-size: 0.95rem;
    color: var(--ra-text);
    margin: 0.5rem 0 1rem;
  }
  .output-path {
    font-size: 0.88rem;
    color: var(--ra-text-secondary);
    margin-bottom: 1rem;
  }
  .output-path code {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.85rem;
  }

  /* ── 設定モーダル ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--ra-surface);
    border-radius: var(--ra-radius);
    width: min(520px, 90vw);
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: var(--ra-shadow-lg);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--ra-border);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .modal-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: var(--ra-text-muted);
    padding: 0.25rem 0.5rem;
    border-radius: var(--ra-radius-sm);
  }
  .modal-close:hover {
    color: var(--ra-text);
    background: var(--ra-surface-muted);
  }
  .modal-body {
    padding: 1.25rem;
  }
  .modal-body h3 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ra-text);
    margin: 1.25rem 0 0.5rem;
  }
  .modal-body h3:first-child {
    margin-top: 0;
  }
  .settings-list {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.88rem;
    color: var(--ra-text-secondary);
    line-height: 1.7;
  }
  .storage-path {
    display: block;
    padding: 0.6rem 0.75rem;
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    font-size: 0.85rem;
    word-break: break-all;
  }
  .settings-hint {
    font-size: 0.82rem;
    color: var(--ra-text-muted);
    margin-top: 0.5rem;
  }
</style>
