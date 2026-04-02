<script lang="ts">
  import type { Pipeline } from "@relay-agent/contracts";

  import type { ActivityFeedEvent } from "$lib/stores/delegation";

  import InterventionPanel from "./InterventionPanel.svelte";

  export let pipeline: Pipeline | null = null;
  export let events: ActivityFeedEvent[] = [];

  const statusLabels = {
    pending: "待機中",
    running: "実行中",
    waiting_approval: "承認待ち",
    done: "完了",
    failed: "失敗"
  } as const;

  $: activeStep = pipeline?.steps.find((step) => step.status === "running") ?? null;
  $: waitingStep = pipeline?.steps.find((step) => step.status === "waiting_approval") ?? null;
  $: recentEvents = events.slice(-4);
</script>

<section class="pipeline-progress card">
  <div class="section-head">
    <div>
      <h3>進行状況</h3>
      <p>{pipeline ? `${pipeline.title} / ${pipeline.status}` : "まだ実行されていません。"}</p>
    </div>
  </div>

  {#if pipeline}
    <div class="timeline">
      {#each pipeline.steps as step (step.id)}
        <article class="timeline-step" data-status={step.status}>
          <div class="timeline-marker">{step.order + 1}</div>
          <div class="timeline-copy">
            <div class="timeline-topline">
              <strong>{step.goal}</strong>
              <span class="status-badge">{statusLabels[step.status]}</span>
            </div>
            <p class="timeline-meta">
              入力元: {step.inputSource === "user" ? "ユーザー指定" : "前ステップ出力"}
            </p>
            {#if step.outputArtifactKey}
              <p class="timeline-meta">出力: {step.outputArtifactKey}</p>
            {/if}
            {#if step.errorMessage}
              <p class="timeline-error">{step.errorMessage}</p>
            {/if}
            {#if activeStep?.id === step.id && recentEvents.length > 0}
              <div class="timeline-events">
                {#each recentEvents as event (event.id)}
                  <div class="timeline-event">
                    <span>{event.icon}</span>
                    <span>{event.message}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>

    {#if waitingStep}
      <InterventionPanel
        statusLabel="pipeline"
        writeApprovalVisible={true}
        previewSummary={`ステップ「${waitingStep.goal}」の承認待ちです。`}
        previewAffectedRows={0}
        previewOutputPath={waitingStep.outputArtifactKey ?? ""}
      />
    {/if}
  {/if}
</section>

<style>
  .pipeline-progress,
  .timeline {
    display: grid;
    gap: var(--sp-4);
  }

  .section-head h3 {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }

  .section-head p {
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    margin-top: var(--sp-1);
  }

  .timeline {
    position: relative;
  }

  .timeline-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--sp-3);
    padding: var(--sp-4);
    border-radius: var(--r-xl);
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }

  .timeline-step[data-status="pending"] {
    opacity: 0.65;
  }

  .timeline-step[data-status="running"] {
    border-color: var(--c-accent);
    border-left: 3px solid var(--c-accent);
    background: var(--c-accent-subtle);
    box-shadow: var(--shadow-md);
  }

  .timeline-step[data-status="done"] {
    border-left: 3px solid var(--c-success);
  }

  .timeline-step[data-status="failed"] {
    border-left: 3px solid var(--c-error);
    border-color: var(--c-error-subtle);
    background: var(--c-error-subtle);
  }

  .timeline-step[data-status="waiting_approval"] {
    border-left: 3px solid var(--c-warning);
    border-color: var(--c-warning-subtle);
    background: var(--c-warning-subtle);
  }

  .timeline-marker {
    width: 2rem;
    height: 2rem;
    border-radius: var(--r-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    font-size: var(--sz-sm);
    font-weight: 700;
    border: 2px solid rgba(13,148,136,0.20);
    flex-shrink: 0;
  }

  .timeline-step[data-status="done"] .timeline-marker {
    background: var(--c-success-subtle);
    color: var(--c-success);
    border-color: var(--c-success-subtle);
  }

  .timeline-step[data-status="failed"] .timeline-marker {
    background: var(--c-error-subtle);
    color: var(--c-error);
    border-color: var(--c-error-subtle);
  }

  .timeline-step[data-status="waiting_approval"] .timeline-marker {
    background: var(--c-warning-subtle);
    color: var(--c-warning);
    border-color: var(--c-warning-subtle);
  }

  .timeline-copy,
  .timeline-events {
    display: grid;
    gap: var(--sp-2);
  }

  .timeline-topline {
    display: flex;
    gap: var(--sp-2);
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
  }

  .timeline-topline strong {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 500;
    background: #f0eeea;
    color: var(--c-text-2);
  }

  .timeline-step[data-status="running"] .status-badge {
    background: var(--c-accent-subtle);
    color: var(--c-accent);
  }

  .timeline-step[data-status="done"] .status-badge {
    background: var(--c-success-subtle);
    color: var(--c-success);
  }

  .timeline-step[data-status="failed"] .status-badge {
    background: var(--c-error-subtle);
    color: var(--c-error);
  }

  .timeline-step[data-status="waiting_approval"] .status-badge {
    background: var(--c-warning-subtle);
    color: var(--c-warning);
  }

  .timeline-meta {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
  }

  .timeline-error {
    color: var(--c-error);
    font-size: var(--sz-xs);
    font-weight: 500;
  }

  .timeline-event {
    display: flex;
    gap: var(--sp-2);
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
  }
</style>
