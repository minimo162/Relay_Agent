<script lang="ts">
  import { onMount } from "svelte";
  import { initializeApp } from "$lib";

  let storagePath: string | null = null;
  let storageReady = false;
  let settingsError = "";

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "Relay Agent could not load the current storage settings.";
  }

  onMount(async () => {
    try {
      const appState = await initializeApp();
      storageReady = appState.storageReady;
      storagePath = appState.storagePath ?? appState.startupIssue?.storagePath ?? null;
    } catch (error) {
      settingsError = toErrorMessage(error);
    }
  });
</script>

<svelte:head>
  <title>Relay Agent | Settings</title>
</svelte:head>

<div class="ra-view">
  <section class="ra-hero">
    <p class="ra-eyebrow">Settings route</p>
    <h1 class="ra-headline">Safety policy and local behavior live here.</h1>
    <p class="ra-lede">
      This page explains what Relay Agent keeps on this device, what never leaves the
      app automatically, and how operators can clear saved work today.
    </p>
  </section>

  {#if settingsError}
    <section class="feedback feedback-error" aria-live="polite">
      <strong>Settings load issue</strong>
      <p>{settingsError}</p>
    </section>
  {/if}

  <section class="ra-panel-grid">
    <article class="ra-panel">
      <h2>Execution policy</h2>
      <ul class="ra-list">
        <li>Write operations stay behind preview and approval.</li>
        <li>Save-copy is the default output mode.</li>
        <li>Original workbook inputs remain read-only.</li>
      </ul>
    </article>

    <article class="ra-panel">
      <h2>What stays local</h2>
      <ul class="ra-list">
        <li>Sessions, turns, relay artifacts, preview metadata, and logs stay on this device.</li>
        <li>Generated save-copy outputs stay in the destination you chose; they are not moved into app storage.</li>
        <li>Nothing is auto-sent outside the app. Only text you manually paste into Copilot leaves the device.</li>
      </ul>
    </article>

    <article class="ra-panel">
      <h2>How to remove saved work today</h2>
      <ul class="ra-list">
        <li>Close Relay Agent before removing saved data.</li>
        <li>Delete the local storage folder shown below to remove saved sessions, artifacts, and logs from this device.</li>
        <li>A dedicated in-app reset control is still deferred; manual folder deletion is the current supported cleanup path.</li>
      </ul>

      {#if storagePath}
        <p class="path-label">Current local storage folder</p>
        <code class="path-block">{storagePath}</code>
      {:else if storageReady}
        <p class="path-fallback">Relay Agent storage is ready, but the current path could not be resolved for display.</p>
      {:else}
        <p class="path-fallback">Local storage is not ready in this run, so there is no stable saved-work folder to remove yet.</p>
      {/if}
    </article>
  </section>
</div>

<style>
  .feedback {
    padding: 1rem 1.1rem;
    border-radius: 1rem;
    border: 1px solid transparent;
  }

  .feedback strong,
  .feedback p {
    margin: 0;
  }

  .feedback p {
    margin-top: 0.35rem;
  }

  .feedback-error {
    border-color: rgba(141, 45, 31, 0.22);
    background: rgba(141, 45, 31, 0.08);
    color: #7f2a20;
  }

  .path-label {
    margin-top: 1rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ra-accent);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .path-block {
    display: block;
    margin-top: 0.55rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ra-text);
    font-size: 0.92rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .path-fallback {
    margin-top: 1rem;
  }
</style>
