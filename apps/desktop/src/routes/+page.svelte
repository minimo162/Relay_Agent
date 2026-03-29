<script lang="ts">
  import { onMount } from "svelte";
  import { projectInfo } from "@relay-agent/contracts";
  import { initializeApp, pingDesktop } from "$lib";

  let ping = "loading";
  let ipcStatus = "loading";
  let storageMode = "unavailable";
  let sessionCount = "0";
  let supportedModes = "loading";

  onMount(async () => {
    const [pingResult, appResult] = await Promise.allSettled([
      pingDesktop(),
      initializeApp()
    ]);

    ping = pingResult.status === "fulfilled" ? pingResult.value : "tauri-unavailable";

    if (appResult.status === "fulfilled") {
      ipcStatus = appResult.value.initialized ? "ready" : "pending";
      storageMode = appResult.value.storageMode;
      sessionCount = String(appResult.value.sessionCount);
      supportedModes = appResult.value.supportedRelayModes.join(", ");
    } else {
      ipcStatus = "tauri-unavailable";
      supportedModes = "unavailable";
    }
  });
</script>

<svelte:head>
  <title>Relay Agent</title>
  <meta name="description" content="Relay Agent desktop shell" />
</svelte:head>

<main>
  <section>
    <p class="eyebrow">Relay Agent MVP</p>
    <h1>{projectInfo.name}</h1>
    <p class="summary">
      The backend command surface is live behind a contracts-validated frontend IPC
      layer, so the next step is wiring real session and studio flows onto it.
    </p>
    <dl>
      <div>
        <dt>Stage</dt>
        <dd>{projectInfo.stage}</dd>
      </div>
      <div>
        <dt>IPC status</dt>
        <dd>{ipcStatus}</dd>
      </div>
      <div>
        <dt>Desktop ping</dt>
        <dd>{ping}</dd>
      </div>
      <div>
        <dt>Storage mode</dt>
        <dd>{storageMode}</dd>
      </div>
      <div>
        <dt>Session count</dt>
        <dd>{sessionCount}</dd>
      </div>
      <div>
        <dt>Relay modes</dt>
        <dd>{supportedModes}</dd>
      </div>
    </dl>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top left, #f9e6b3, transparent 24rem),
      linear-gradient(160deg, #f6f4ec 0%, #e4efe2 100%);
    color: #163121;
  }

  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
  }

  section {
    width: min(42rem, 100%);
    padding: 2rem;
    border: 1px solid rgba(22, 49, 33, 0.12);
    border-radius: 1.5rem;
    background: rgba(255, 255, 255, 0.78);
    box-shadow: 0 1.5rem 3rem rgba(22, 49, 33, 0.08);
  }

  .eyebrow {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7a5c16;
  }

  h1 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3.2rem);
    line-height: 1.05;
  }

  .summary {
    margin: 1rem 0 1.5rem;
    max-width: 36rem;
    line-height: 1.6;
  }

  dl {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  div {
    padding: 1rem 1.25rem;
    border-radius: 1rem;
    background: rgba(22, 49, 33, 0.05);
  }

  dt {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #567360;
  }

  dd {
    margin: 0.4rem 0 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
</style>
