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
