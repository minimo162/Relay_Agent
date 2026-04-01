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
    gap: 1rem;
  }

  .timeline-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.9rem;
    border-radius: 14px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .timeline-step[data-status="running"] {
    border-color: var(--ra-accent);
  }

  .timeline-step[data-status="failed"] {
    border-color: #cf786c;
    background: #fff3f1;
  }

  .timeline-marker {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--ra-accent) 12%, white);
    color: var(--ra-accent);
    font-weight: 700;
  }

  .timeline-copy,
  .timeline-events {
    display: grid;
    gap: 0.45rem;
  }

  .timeline-topline {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .status-badge,
  .timeline-meta {
    color: var(--ra-text-muted);
    font-size: 0.82rem;
  }

  .timeline-error {
    color: #b04b43;
    font-size: 0.85rem;
  }

  .timeline-event {
    display: flex;
    gap: 0.5rem;
    font-size: 0.84rem;
    color: var(--ra-text-muted);
  }
</style>
