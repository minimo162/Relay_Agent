<script lang="ts">
  export let busy = false;
  export let reviewStepAvailable = false;
  export let approvalEnabled: boolean | null = null;
  export let showRetry = false;
  export let backLabel = "内容を見直す";
  export let approveLabel = "保存する";
  export let onBack: () => void = () => {};
  export let onApprove: () => void = () => {};
  export let onRetry: () => void = () => {};

  $: resolvedApprovalEnabled = approvalEnabled ?? reviewStepAvailable;
</script>

<p class="safety-note">
  元のファイルはそのまま残ります。変更は別のコピーに保存されます。
</p>

<div class="btn-row">
  <button class="btn btn-secondary" type="button" on:click={onBack} disabled={busy || !resolvedApprovalEnabled}>
    {backLabel}
  </button>
  <button class="btn btn-primary btn-save" type="button" on:click={onApprove} disabled={busy || !resolvedApprovalEnabled}>
    {busy ? "保存しています…" : approveLabel}
  </button>
</div>

<p class="action-note">内容の確認を記録してから、新しいコピーを保存します。</p>

{#if showRetry}
  <button class="btn btn-secondary retry-button" type="button" on:click={onRetry}>
    やり直す
  </button>
{/if}

<style>
  /* ── Shizuka: ApprovalGate ── */

  .safety-note {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    margin: 0 0 var(--sp-4);
    background: var(--c-warning-subtle);
    border: 1px solid var(--c-warning-subtle);
    border-radius: var(--r-sm);
    color: var(--c-text-2);
    font-size: var(--sz-sm);
    line-height: 1.5;
  }

  .safety-note::before {
    content: "\1F6E1\FE0F";
    flex-shrink: 0;
    font-size: var(--sz-lg);
  }

  .btn-row {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
    margin-bottom: var(--sp-2);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--sz-sm);
    font-weight: 500;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease);
    line-height: 1.5;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Ghost-style back button */
  .btn-secondary {
    background: transparent;
    color: var(--c-text-2);
    border: 1px solid var(--c-border-strong);
  }

  .btn-secondary:not(:disabled):hover {
    background: var(--c-canvas);
    border-color: var(--c-border-strong);
    color: var(--c-text);
  }

  /* Large accent approve button */
  .btn-primary.btn-save {
    background: var(--c-accent);
    color: var(--c-text-inverse);
    padding: var(--sp-3) var(--sp-6);
    font-size: var(--sz-base);
    font-weight: 700;
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-sm);
  }

  .btn-primary.btn-save:not(:disabled):hover {
    background: var(--c-accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .btn-primary.btn-save:not(:disabled):active {
    transform: translateY(0);
    box-shadow: var(--shadow-sm);
  }

  .action-note {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
    margin: var(--sp-1) 0 var(--sp-4);
  }

  /* Retry button */
  .retry-button {
    margin-top: var(--sp-2);
    border-color: var(--c-error-subtle);
    color: var(--c-error);
  }

  .retry-button:not(:disabled):hover {
    background: var(--c-error-subtle);
    border-color: var(--c-error);
    color: var(--c-error);
  }
</style>
