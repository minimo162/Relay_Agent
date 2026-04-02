<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { OutputArtifact, PlanStep } from "@relay-agent/contracts";
  import ArtifactPreview from "./ArtifactPreview.svelte";

  export let phase: "plan" | "scope" | "write" | "permission" = "plan";
  /** permission phase — tool awaiting approval */
  export let permissionToolName = "";
  export let permissionDescription = "";
  export let planSteps: PlanStep[] = [];
  export let planSummary = "";
  export let artifacts: OutputArtifact[] = [];
  export let scopeViolations: string[] = [];
  export let scopeRootFolder = "";
  export let scopeSummary = "";
  export let previewSummary = "";
  export let previewOutputPath = "";
  export let previewWarnings: string[] = [];
  export let busy = false;
  export let errorMessage = "";
  export let reviewStepAvailable = false;

  const dispatch = createEventDispatcher<{
    approve: void;
    reject: void;
    replan: { feedback: string };
    back: void;
    retry: void;
    alwaysAllow: void;
    /** permission phase */
    permissionDeny: void;
    permissionAllowOnce: void;
    permissionAlwaysAllow: void;
  }>();

  let showReplanInput = false;
  let replanFeedback = "";
  let expanded = true;

  function handleApprove()     { dispatch("approve"); }
  function handleReject()      { dispatch("reject"); }
  function handleBack()        { dispatch("back"); }
  function handleRetry()       { dispatch("retry"); }
  function handleAlwaysAllow() { dispatch("alwaysAllow"); }
  function handleReplan() {
    if (replanFeedback.trim()) {
      dispatch("replan", { feedback: replanFeedback.trim() });
      replanFeedback = "";
      showReplanInput = false;
    }
  }

  function stepTypeLabel(step: PlanStep): string {
    const tool = step.tool ?? "";
    if (tool.startsWith("workbook.save") || tool.startsWith("table.")) return "書込";
    if (tool.startsWith("file.delete") || tool.startsWith("file.move")) return "変更";
    return "読取";
  }

  function stepTypeClass(step: PlanStep): string {
    const label = stepTypeLabel(step);
    if (label === "書込") return "write";
    if (label === "変更") return "modify";
    return "read";
  }
</script>

<div class="approval-card" data-phase={phase}>
  <!-- Left accent bar — phase colour -->
  <div class="accent-bar" data-phase={phase}></div>

  <div class="card-inner">
    <!-- Error banner -->
    {#if errorMessage}
      <div class="error-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>{errorMessage}</span>
        <button class="btn btn-sm btn-secondary" type="button" on:click={handleRetry}>再試行</button>
      </div>
    {/if}

    <!-- Header row (collapsible) -->
    <button class="header-row" type="button" on:click={() => expanded = !expanded}>
      <span class="phase-icon" data-phase={phase}>
        {#if phase === "plan"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        {:else if phase === "scope"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        {:else if phase === "permission"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        {/if}
      </span>
      <div class="header-text">
        <span class="header-title">
          {#if phase === "plan"}実行計画の確認
          {:else if phase === "scope"}スコープ確認
          {:else if phase === "permission"}ツール実行の許可
          {:else}変更の確認
          {/if}
        </span>
        {#if planSummary || scopeSummary || previewSummary}
          <span class="header-sub">{planSummary || scopeSummary || previewSummary}</span>
        {/if}
      </div>
      <svg class="chevron" class:open={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </button>

    <!-- Collapsible body -->
    {#if expanded}
      <div class="card-body">
        <!-- PLAN phase -->
        {#if phase === "plan" && planSteps.length > 0}
          <div class="plan-steps">
            {#each planSteps as step, i}
              <div class="plan-step">
                <span class="step-n">{i + 1}</span>
                <div class="step-body">
                  <span class="step-desc">{step.description}</span>
                  {#if step.tool}
                    <span class="step-tool badge badge-tool">{step.tool}</span>
                  {/if}
                </div>
                <span class="step-type {stepTypeClass(step)}">{stepTypeLabel(step)}</span>
              </div>
            {/each}
          </div>

          {#if showReplanInput}
            <div class="replan-box">
              <textarea
                class="textarea"
                bind:value={replanFeedback}
                placeholder="修正内容を入力…"
                rows="2"
              ></textarea>
              <div class="replan-actions">
                <button class="btn btn-sm btn-ghost" type="button" on:click={() => { showReplanInput = false; replanFeedback = ""; }}>
                  キャンセル
                </button>
                <button class="btn btn-sm btn-primary" type="button" on:click={handleReplan} disabled={!replanFeedback.trim()}>
                  送信
                </button>
              </div>
            </div>
          {/if}
        {/if}

        <!-- SCOPE phase -->
        {#if phase === "scope" && scopeViolations.length > 0}
          <div class="alert alert-warning">
            <p class="alert-title">プロジェクトスコープ外のアクセス</p>
            {#if scopeRootFolder}
              <p class="alert-detail">ルートフォルダ: <code>{scopeRootFolder}</code></p>
            {/if}
            <ul class="violation-list">
              {#each scopeViolations as v}
                <li>{v}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- PERMISSION phase -->
        {#if phase === "permission"}
          <div class="permission-body">
            {#if permissionToolName}
              <code class="perm-tool">{permissionToolName}</code>
            {/if}
            {#if permissionDescription}
              <p class="perm-desc">{permissionDescription}</p>
            {/if}
          </div>
        {/if}

        <!-- WRITE phase -->
        {#if phase === "write"}
          {#if previewWarnings.length > 0}
            <div class="alert alert-warning">
              {#each previewWarnings as w}<p>{w}</p>{/each}
            </div>
          {/if}
          {#if artifacts.length > 0}
            <div class="preview-wrap">
              <ArtifactPreview {artifacts} />
            </div>
          {/if}
          <div class="safety-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            元のファイルは変更されません
          </div>
          {#if previewOutputPath}
            <p class="output-path">出力先: <code>{previewOutputPath}</code></p>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Inline 3-choice action row -->
    <div class="action-row">
      {#if phase === "permission"}
        <!-- Permission: 拒否 / 今回のみ / 常に許可 -->
        <button class="choice-btn choice-reject" type="button" on:click={() => dispatch("permissionDeny")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          拒否
        </button>
        <button class="choice-btn choice-once" type="button" on:click={() => dispatch("permissionAllowOnce")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          今回のみ許可
        </button>
        <button class="choice-btn choice-always" type="button" on:click={() => dispatch("permissionAlwaysAllow")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
          常に許可
        </button>
      {:else}
        <!-- Reject / back -->
        <button class="choice-btn choice-reject" type="button" on:click={phase === "plan" && !showReplanInput ? () => { showReplanInput = true; } : handleReject}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          {#if phase === "plan"}修正を依頼{:else if phase === "scope"}拒否{:else}{reviewStepAvailable ? "内容を見直す" : "キャンセル"}{/if}
        </button>

        <!-- Once / approve -->
        <button class="choice-btn choice-once" type="button" on:click={handleApprove} disabled={busy}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {#if busy}
            <span class="spinner"></span>
          {:else if phase === "plan"}実行する
          {:else if phase === "scope"}今回のみ許可
          {:else}保存する
          {/if}
        </button>

        <!-- Always allow (scope/write only) -->
        {#if phase === "scope" || phase === "write"}
          <button class="choice-btn choice-always" type="button" on:click={handleAlwaysAllow} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
            常に許可
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .approval-card {
    position: relative;
    background: var(--c-surface, #fff);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md, 16px);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    margin: var(--sp-3, 12px) 0;
    animation: slide-up var(--duration-normal, 250ms) var(--ease) both;
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Left accent bar */
  .accent-bar {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    border-radius: var(--r-md) 0 0 var(--r-md);
  }
  .accent-bar[data-phase="plan"]       { background: var(--c-accent); }
  .accent-bar[data-phase="scope"]      { background: var(--c-warning); }
  .accent-bar[data-phase="write"]      { background: var(--c-success); }
  .accent-bar[data-phase="permission"] { background: var(--c-error); }

  .card-inner {
    padding: var(--sp-3, 12px) var(--sp-4, 16px) var(--sp-3, 12px) calc(var(--sp-4, 16px) + 3px);
  }

  /* Error banner */
  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    background: var(--c-error-subtle);
    border-radius: var(--r-sm, 8px);
    margin-bottom: var(--sp-3, 12px);
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-error);
  }
  .error-banner svg { width: 16px; height: 16px; flex-shrink: 0; }
  .error-banner span { flex: 1; }

  /* Header (collapsible toggle) */
  .header-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    width: 100%;
    text-align: left;
    padding: var(--sp-1, 4px) 0 var(--sp-2, 8px);
    cursor: pointer;
  }

  .phase-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm, 8px);
    flex-shrink: 0;
  }
  .phase-icon[data-phase="plan"]       { background: var(--c-accent-subtle);  color: var(--c-accent); }
  .phase-icon[data-phase="scope"]      { background: var(--c-warning-subtle); color: var(--c-warning); }
  .phase-icon[data-phase="write"]      { background: var(--c-success-subtle); color: var(--c-success); }
  .phase-icon[data-phase="permission"] { background: var(--c-error-subtle);   color: var(--c-error); }
  .phase-icon svg { width: 14px; height: 14px; }

  .header-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .header-title {
    font-size: var(--sz-sm, 0.875rem);
    font-weight: 600;
    color: var(--c-text);
    line-height: 1.3;
  }
  .header-sub {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--c-text-3);
    transition: transform var(--duration-fast) var(--ease);
  }
  .chevron.open { transform: rotate(180deg); }

  /* Body */
  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3, 12px);
    padding-bottom: var(--sp-3, 12px);
  }

  /* Plan steps */
  .plan-steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan-step {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: 6px var(--sp-2, 8px);
    border-radius: var(--r-sm, 8px);
    background: var(--c-canvas, #f6f9fc);
  }
  .step-n {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--sz-xs, 0.75rem);
    font-weight: 500;
    color: var(--c-text-2);
    background: var(--c-surface, #fff);
    border: 1px solid var(--c-border-strong);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .step-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    min-width: 0;
  }
  .step-desc {
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-tool {
    flex-shrink: 0;
  }
  .step-type {
    font-size: var(--sz-xs, 0.75rem);
    font-weight: 500;
    padding: 2px var(--sp-2, 8px);
    border-radius: var(--r-full, 9999px);
    flex-shrink: 0;
  }
  .step-type.read   { color: var(--c-accent);   background: var(--c-accent-subtle); }
  .step-type.write  { color: var(--c-warning);  background: var(--c-warning-subtle); }
  .step-type.modify { color: var(--c-error);    background: var(--c-error-subtle); }

  /* Replan */
  .replan-box {
    padding: var(--sp-3, 12px);
    background: var(--c-canvas);
    border-radius: var(--r-sm, 8px);
    border: 1px solid var(--c-border-strong);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
  }
  .replan-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2, 8px);
  }

  /* Safety note */
  .safety-note {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-success);
    background: var(--c-success-subtle);
    border-radius: var(--r-sm, 8px);
  }
  .safety-note svg { width: 14px; height: 14px; flex-shrink: 0; }

  .output-path {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
    margin: 0;
  }
  .output-path code {
    font-family: var(--font-mono);
    background: var(--c-canvas);
    padding: 1px 4px;
    border-radius: 4px;
  }

  .preview-wrap {
    border: 1px solid var(--c-border);
    border-radius: var(--r-sm, 8px);
    overflow: hidden;
  }

  /* ===== Inline 3-choice action row ===== */
  .action-row {
    display: flex;
    gap: var(--sp-2, 8px);
    padding-top: var(--sp-2, 8px);
    border-top: 1px solid var(--c-border);
  }

  .choice-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1, 4px);
    padding: 6px var(--sp-3, 12px);
    font-size: var(--sz-sm, 0.875rem);
    font-weight: 500;
    border-radius: var(--r-full, 9999px);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast), opacity var(--duration-fast);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .choice-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
  .choice-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .choice-reject {
    color: var(--c-text-2);
    background: transparent;
    border: 1px solid var(--c-border-strong);
  }
  .choice-reject:hover:not(:disabled) {
    border-color: var(--c-error);
    color: var(--c-error);
    background: var(--c-error-subtle);
  }

  .choice-once {
    flex: 1;
    justify-content: center;
    background: var(--c-accent);
    color: white;
    border: 1px solid transparent;
  }
  .choice-once:hover:not(:disabled) { background: var(--c-accent-hover); }
  .choice-once:active:not(:disabled) { transform: scale(0.97); }

  .choice-always {
    color: var(--c-text-2);
    background: transparent;
    border: 1px solid var(--c-border-strong);
  }
  .choice-always:hover:not(:disabled) {
    border-color: var(--c-success);
    color: var(--c-success);
    background: var(--c-success-subtle);
  }

  /* Scope violations */
  .alert-title  { font-weight: 500; margin: 0 0 4px; }
  .alert-detail { margin: 4px 0; font-size: var(--sz-xs, 0.75rem); }
  .alert-detail code {
    font-family: var(--font-mono);
    background: rgba(0,0,0,0.05);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .violation-list {
    margin: var(--sp-2, 8px) 0 0;
    padding-left: var(--sp-5, 20px);
    font-size: var(--sz-xs, 0.75rem);
  }
  .violation-list li { margin-bottom: 2px; }

  /* Permission phase */
  .permission-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
  }
  .perm-tool {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-error);
    background: var(--c-error-subtle);
    padding: 2px var(--sp-2, 8px);
    border-radius: var(--r-full);
  }
  .perm-desc {
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text-2);
    margin: 0;
    line-height: 1.5;
  }
</style>
