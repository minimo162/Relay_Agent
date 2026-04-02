<script lang="ts">
  import type { OutputArtifact, PlanStep } from "@relay-agent/contracts";

  import ArtifactPreview from "./ArtifactPreview.svelte";
  import ApprovalGate from "./ApprovalGate.svelte";

  export let statusLabel = "";
  export let planReviewVisible = false;
  export let planSteps: PlanStep[] = [];
  export let planSummary = "";
  export let showReplanFeedback = false;
  export let replanFeedback = "";
  export let scopeApprovalVisible = false;
  export let scopeApprovalSummary = "";
  export let scopeApprovalRootFolder = "";
  export let scopeApprovalViolations: string[] = [];
  export let writeApprovalVisible = false;
  export let previewSummary = "";
  export let previewAffectedRows = 0;
  export let previewOutputPath = "";
  export let previewWarnings: string[] = [];
  export let artifacts: OutputArtifact[] = [];
  export let reviewStepAvailable = false;
  export let busy = false;
  export let errorMessage = "";
  export let onApprovePlan: () => void = () => {};
  export let onCancelPlan: () => void = () => {};
  export let onToggleReplan: () => void = () => {};
  export let onReplan: () => void = () => {};
  export let onMoveStep: (index: number, direction: -1 | 1) => void = () => {};
  export let onRemoveStep: (index: number) => void = () => {};
  export let onReplanFeedbackInput: (value: string) => void = () => {};
  export let onBackFromScopeApproval: () => void = () => {};
  export let onApproveScopeOverride: () => void = () => {};
  export let onBackFromApproval: () => void = () => {};
  export let onApproveWrite: () => void = () => {};
  export let onRetry: () => void = () => {};

  $: fileOperationCount = artifacts.filter(
    (artifact) => artifact.type === "file_operation"
  ).length;
  $: spreadsheetDiffCount = artifacts.filter(
    (artifact) => artifact.type === "spreadsheet_diff"
  ).length;
</script>

<aside class="intervention-panel">
  <div class="intervention-header">
    <h3>介入パネル</h3>
    {#if statusLabel}
      <p>{statusLabel}</p>
    {/if}
  </div>

  {#if errorMessage}
    <div class="intervention-card intervention-error">
      <strong>エラー</strong>
      <p>{errorMessage}</p>
    </div>
  {/if}

  {#if planReviewVisible}
    <div class="intervention-card">
      <h4>実行計画の確認</h4>
      <p>{planSummary}</p>
      <div class="plan-step-list">
        {#each planSteps as step, index (step.id)}
          <article class="plan-step-card" data-phase={step.phase}>
            <div class="plan-step-index">{index + 1}</div>
            <div class="plan-step-body">
              <div class="plan-step-topline">
                <span>{step.description}</span>
                <span class="plan-step-tool">{step.tool}</span>
              </div>
              {#if step.estimatedEffect}
                <p class="plan-step-effect">{step.estimatedEffect}</p>
              {/if}
            </div>
            <div class="plan-step-actions">
              <button class="btn btn-secondary" type="button" on:click={() => onMoveStep(index, -1)} disabled={index === 0}>
                ↑
              </button>
              <button class="btn btn-secondary" type="button" on:click={() => onMoveStep(index, 1)} disabled={index === planSteps.length - 1}>
                ↓
              </button>
              <button class="btn btn-secondary" type="button" on:click={() => onRemoveStep(index)}>
                削除
              </button>
            </div>
          </article>
        {/each}
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" type="button" on:click={onApprovePlan} disabled={busy || planSteps.length === 0}>
          計画を承認する
        </button>
        <button class="btn btn-secondary" type="button" on:click={onToggleReplan}>
          再計画する
        </button>
        <button class="btn btn-secondary" type="button" on:click={onCancelPlan}>
          キャンセル
        </button>
      </div>
      {#if showReplanFeedback}
        <textarea
          class="textarea"
          rows="4"
          value={replanFeedback}
          on:input={(event) =>
            onReplanFeedbackInput((event.currentTarget as HTMLTextAreaElement).value)}
          placeholder="先に列名を確認してください、など"
        ></textarea>
        <div class="btn-row">
          <button class="btn btn-secondary" type="button" on:click={onReplan} disabled={busy}>
            フィードバック付きで再計画
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if scopeApprovalVisible}
    <div class="intervention-card intervention-warning">
      <h4>プロジェクト範囲外アクセスの承認</h4>
      <p>{scopeApprovalSummary}</p>
      <p class="intervention-meta">許可ルート: {scopeApprovalRootFolder}</p>
      <div class="warnings">
        {#each scopeApprovalViolations as violation}
          <p class="field-warn">⚠ {violation}</p>
        {/each}
      </div>
      <p class="intervention-meta">
        このまま続行すると、選択中プロジェクトのルート外に対するファイル操作を許可します。
      </p>
      <ApprovalGate
        {busy}
        approvalEnabled={scopeApprovalVisible}
        backLabel="回答を見直す"
        approveLabel="このアクセスを許可して続行"
        onBack={onBackFromScopeApproval}
        onApprove={onApproveScopeOverride}
      />
    </div>
  {/if}

  {#if writeApprovalVisible}
    <div class="intervention-card">
      <h4>書き込み前の確認</h4>
      <p>{previewSummary}</p>
      <p class="intervention-meta">
        {#if fileOperationCount > 0 && spreadsheetDiffCount === 0}
          対象アーティファクト: {artifacts.length} / 保存先: {previewOutputPath || "該当なし"}
        {:else}
          影響行数: {previewAffectedRows} / 保存先: {previewOutputPath || "自動決定"}
        {/if}
      </p>
      {#if previewWarnings.length > 0}
        <div class="warnings">
          {#each previewWarnings as warning}
            <p class="field-warn">⚠ {warning}</p>
          {/each}
        </div>
      {/if}
      {#if artifacts.length > 0}
        <ArtifactPreview {artifacts} />
      {/if}
      <ApprovalGate
        {busy}
        {reviewStepAvailable}
        showRetry={Boolean(errorMessage)}
        backLabel="内容を見直す"
        approveLabel="保存する"
        onBack={onBackFromApproval}
        onApprove={onApproveWrite}
        onRetry={onRetry}
      />
    </div>
  {/if}

  {#if !planReviewVisible && !scopeApprovalVisible && !writeApprovalVisible && !errorMessage}
    <div class="intervention-card intervention-compact">
      <p>承認が必要になったら、ここに内容を表示します。</p>
    </div>
  {/if}
</aside>

<style>
  /* ── Shizuka: InterventionPanel ─────────────────────── */

  .intervention-panel {
    display: grid;
    gap: var(--sp-4);
  }

  /* ── Header ─────────────────────────────────────────────── */

  .intervention-header h3 {
    font-family: var(--font-sans);
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
    margin: 0 0 var(--sp-1);
  }

  .intervention-header p,
  .intervention-meta {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    line-height: 1.5;
  }

  /* ── Outer card (frame with warning border accent) ──────── */

  .intervention-card {
    padding: var(--sp-5);
    border: 1px solid var(--c-border-strong);
    border-left: 3px solid var(--c-warning);
    border-radius: 12px;
    background: var(--c-surface);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(20px) saturate(180%);
    transition: box-shadow var(--duration-normal) var(--ease),
                border-color var(--duration-normal) var(--ease);
  }

  .intervention-card:hover {
    box-shadow: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
  }

  .intervention-card h4 {
    font-family: var(--font-sans);
    font-size: var(--sz-base);
    font-weight: 700;
    color: var(--c-text);
    margin: 0 0 var(--sp-2);
  }

  .intervention-compact {
    border-left-color: var(--c-border-strong);
  }

  .intervention-compact p {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    margin: 0;
  }

  /* ── Error card ─────────────────────────────────────────── */

  .intervention-error {
    border-color: var(--c-error-subtle);
    border-left-color: var(--c-error);
    background: var(--c-error-subtle);
  }

  .intervention-error strong {
    color: var(--c-error);
  }

  /* ── Scope warning card (red border + icon alert) ───────── */

  .intervention-warning {
    border-color: var(--c-error-subtle);
    border-left-color: var(--c-error);
    background: var(--c-error-subtle);
    position: relative;
  }

  .intervention-warning::before {
    content: "\26A0";
    position: absolute;
    top: var(--sp-4);
    right: var(--sp-4);
    font-size: 1.25rem;
    color: var(--c-error);
    opacity: 0.7;
    line-height: 1;
  }

  .intervention-warning h4 {
    color: var(--c-error);
  }

  /* ── Warnings list ──────────────────────────────────────── */

  .warnings {
    margin: var(--sp-3) 0;
    padding: var(--sp-3);
    border: 1px solid var(--c-error-subtle);
    border-radius: 8px;
    background: var(--c-error-subtle);
  }

  .field-warn {
    color: var(--c-warning);
    font-size: var(--sz-sm);
    font-weight: 500;
    margin: var(--sp-1) 0;
    line-height: 1.5;
  }

  /* ── Plan step list ─────────────────────────────────────── */

  .plan-step-list {
    display: grid;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
  }

  /* Inner card within the outer frame */
  .plan-step-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--c-border-strong);
    border-radius: 8px;
    background: #f0eeea;
    transition: border-color var(--duration-fast) var(--ease),
                background var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }

  .plan-step-card:hover {
    border-color: var(--c-border-strong);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
  }

  /* Phase-based color coding for step index badges */

  /* Default / read phase: blue (accent) */
  .plan-step-index {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--r-full);
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--sz-xs);
    font-weight: 700;
    font-family: var(--font-mono);
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease);
  }

  .plan-step-card:hover .plan-step-index {
    transform: scale(1.08);
  }

  /* Read phase: blue/accent */
  .plan-step-card[data-phase="read"] .plan-step-index {
    background: var(--c-accent-subtle);
    color: var(--c-accent);
  }

  .plan-step-card[data-phase="read"] {
    border-left: 3px solid var(--c-accent);
  }

  /* Write phase: amber/warning */
  .plan-step-card[data-phase="write"] .plan-step-index {
    background: var(--c-warning-subtle);
    color: var(--c-warning);
  }

  .plan-step-card[data-phase="write"] {
    border-left: 3px solid var(--c-warning);
  }

  /* Delete phase: red/error */
  .plan-step-card[data-phase="delete"] .plan-step-index {
    background: var(--c-error-subtle);
    color: var(--c-error);
  }

  .plan-step-card[data-phase="delete"] {
    border-left: 3px solid var(--c-error);
  }

  /* ── Step body ──────────────────────────────────────────── */

  .plan-step-body {
    min-width: 0;
  }

  .plan-step-topline {
    display: flex;
    gap: var(--sp-2);
    justify-content: space-between;
    align-items: baseline;
  }

  .plan-step-topline > span:first-child {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
    line-height: 1.5;
  }

  .plan-step-tool {
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    background: #f0eeea;
    padding: 0.1rem var(--sp-2);
    border-radius: var(--r-full);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .plan-step-effect {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
    line-height: 1.4;
    margin-top: var(--sp-1);
  }

  /* ── Step reorder/remove actions ─────────────────────────── */

  .plan-step-actions {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    align-self: center;
  }

  .plan-step-actions .btn {
    padding: var(--sp-1);
    min-width: 1.75rem;
    min-height: 1.75rem;
    font-size: var(--sz-xs);
    border-radius: var(--r-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Button row ─────────────────────────────────────────── */

  .btn-row {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--sp-4);
  }

  /* Approve button: large, accent bg, hover brightens */
  .btn-row .btn-primary {
    padding: var(--sp-3) var(--sp-6);
    font-size: var(--sz-base);
    font-weight: 700;
    background: var(--c-accent);
    color: var(--c-text-inverse);
    border: none;
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-sm);
    transition: background var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease),
                transform var(--duration-fast) var(--ease);
    cursor: pointer;
  }

  .btn-row .btn-primary:hover:not(:disabled) {
    background: var(--c-accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .btn-row .btn-primary:active:not(:disabled) {
    transform: scale(0.97);
    box-shadow: var(--shadow-sm);
  }

  .btn-row .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Cancel / secondary buttons: ghost style (border only) */
  .btn-row .btn-secondary {
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--sz-sm);
    font-weight: 500;
    background: transparent;
    color: var(--c-text-2);
    border: 1px solid var(--c-border-strong);
    border-radius: 8px;
    transition: background var(--duration-fast) var(--ease),
                color var(--duration-fast) var(--ease),
                border-color var(--duration-fast) var(--ease);
    cursor: pointer;
  }

  .btn-row .btn-secondary:hover:not(:disabled) {
    background: #f0eeea;
    color: var(--c-text);
    border-color: var(--c-text-3);
  }

  .btn-row .btn-secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Replan textarea: expandable with slide animation ───── */

  .textarea {
    display: block;
    width: 100%;
    margin-top: var(--sp-3);
    padding: var(--sp-3);
    font-family: var(--font-sans);
    font-size: var(--sz-sm);
    color: var(--c-text);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: 8px;
    resize: vertical;
    min-height: 5rem;
    max-height: 16rem;
    line-height: 1.6;
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease),
                max-height 400ms var(--ease);
    animation: slide-expand 400ms var(--ease) both;
  }

  .textarea:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
    background: var(--c-surface);
  }

  .textarea::placeholder {
    color: var(--c-text-3);
  }

  @keyframes slide-expand {
    from {
      opacity: 0;
      max-height: 0;
      margin-top: 0;
      padding-top: 0;
      padding-bottom: 0;
      overflow: hidden;
    }
    to {
      opacity: 1;
      max-height: 16rem;
      margin-top: var(--sp-3);
      padding-top: var(--sp-3);
      padding-bottom: var(--sp-3);
      overflow: visible;
    }
  }

  /* ── Responsive ─────────────────────────────────────────── */

  @media (max-width: 960px) {
    .intervention-panel {
      order: 3;
    }

    .plan-step-card {
      grid-template-columns: auto 1fr;
    }

    .plan-step-actions {
      grid-column: 1 / -1;
      flex-direction: row;
      justify-content: flex-end;
    }
  }
</style>
