<svelte:head>
  <title>Relay Agent | Settings</title>
</svelte:head>

<div class="ra-view">
  <section class="ra-hero">
    <p class="ra-eyebrow">Settings route</p>
    <h1 class="ra-headline">Safety policy and local behavior live here.</h1>
    <p class="ra-lede">
      This page is intentionally narrow for the MVP. It gives the desktop shell a stable
      place for storage, policy, and execution rules before user-editable settings are
      introduced.
    </p>
  </section>

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
      <h2>Local storage</h2>
      <ul class="ra-list">
        <li>Sessions persist under the app-local `storage-v1` directory.</li>
        <li>Artifacts and logs remain tied to the owning session and turn.</li>
        <li>Future settings will expose path inspection, not arbitrary filesystem access.</li>
      </ul>
    </article>

    <article class="ra-panel">
      <h2>Deferred controls</h2>
      <ul class="ra-list">
        <li>Tool registry visibility</li>
        <li>CSV sanitization preferences</li>
        <li>Diagnostic export and cleanup actions</li>
      </ul>
    </article>
  </section>
</div>
