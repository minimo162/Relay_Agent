<script lang="ts">
  import type { DiffSummary, PlanStep } from "@relay-agent/contracts";

  import ApprovalGate from "./ApprovalGate.svelte";
  import FileOpPreview from "./FileOpPreview.svelte";
  import SheetDiffCard from "./SheetDiffCard.svelte";

  type FileOpPreviewAction = {
    tool: string;
    args: Record<string, unknown>;
  };

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
  export let previewSheetDiffs: DiffSummary["sheets"] = [];
  export let fileWriteActions: FileOpPreviewAction[] = [];
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
        {#if fileWriteActions.length > 0 && previewSheetDiffs.length === 0}
          対象操作: {fileWriteActions.length} / 保存先: {previewOutputPath || "該当なし"}
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
      {#if fileWriteActions.length > 0}
        <div class="sheet-diff-grid">
          <FileOpPreview actions={fileWriteActions} />
        </div>
      {/if}
      <div class="sheet-diff-grid">
        {#each previewSheetDiffs as sheetDiff}
          <SheetDiffCard {sheetDiff} />
        {/each}
      </div>
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
  .intervention-panel {
    display: grid;
    gap: 1rem;
  }

  .intervention-header p,
  .intervention-meta {
    color: var(--ra-text-muted);
    font-size: 0.88rem;
  }

  .intervention-card {
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 14px;
    background: var(--ra-surface);
  }

  .intervention-error {
    border-color: #cf786c;
    background: #fff3f1;
  }

  .intervention-warning {
    border-color: #d2a55d;
    background: #fff8eb;
  }

  .plan-step-list,
  .sheet-diff-grid {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }

  .plan-step-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.65rem;
    padding: 0.75rem;
    border: 1px solid var(--ra-border);
    border-radius: 12px;
  }

  .plan-step-index {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ra-accent) 12%, var(--ra-surface));
    color: var(--ra-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
  }

  .plan-step-actions {
    display: grid;
    gap: 0.35rem;
  }

  .plan-step-topline {
    display: flex;
    gap: 0.4rem;
    justify-content: space-between;
  }

  .plan-step-tool,
  .plan-step-effect {
    color: var(--ra-text-muted);
    font-size: 0.82rem;
  }

  @media (max-width: 960px) {
    .intervention-panel {
      order: 3;
    }
  }
</style>
