<script lang="ts">
  import { page } from "$app/stores";
  import { projectInfo } from "@relay-agent/contracts";

  const navigation = [
    {
      href: "/",
      label: "Home",
      note: "Session hub"
    },
    {
      href: "/studio",
      label: "Studio",
      note: "Turn workflow"
    },
    {
      href: "/settings",
      label: "Settings",
      note: "Policies"
    }
  ];

  function isActive(pathname: string, href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }
</script>

<svelte:head>
  <meta name="description" content="Relay Agent desktop MVP shell" />
</svelte:head>

<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <p class="eyebrow">Relay Agent</p>
      <h1>{projectInfo.name}</h1>
      <p class="stage">Stage: {projectInfo.stage}</p>
      <p class="summary">
        Safe desktop relay for session-driven spreadsheet work, with save-copy only
        execution.
      </p>
    </div>

    <nav aria-label="Primary">
      {#each navigation as item}
        <a class:active={isActive($page.url.pathname, item.href)} href={item.href}>
          <span>{item.label}</span>
          <small>{item.note}</small>
        </a>
      {/each}
    </nav>

    <section class="rails">
      <p class="rails-title">MVP rails</p>
      <ul>
        <li>Original files stay read-only.</li>
        <li>Preview and approval come before write execution.</li>
        <li>CSV-first path stays the delivery center of gravity.</li>
      </ul>
    </section>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <p>Desktop shell</p>
      <span>{$page.url.pathname === "/" ? "Home" : $page.url.pathname.slice(1)}</span>
    </header>

    <main class="content">
      <slot />
    </main>
  </div>
</div>

<style>
  :global(:root) {
    --ra-bg: #f5efe1;
    --ra-bg-accent: rgba(183, 142, 72, 0.16);
    --ra-surface: rgba(255, 250, 241, 0.84);
    --ra-surface-strong: rgba(255, 255, 255, 0.92);
    --ra-border: rgba(37, 50, 32, 0.12);
    --ra-border-strong: rgba(37, 50, 32, 0.24);
    --ra-text: #1f2d24;
    --ra-muted: #5e695e;
    --ra-accent: #8a5a17;
    --ra-accent-strong: #5b7d38;
    --ra-shadow: 0 1.5rem 3rem rgba(31, 45, 36, 0.08);
    --ra-radius-lg: 1.6rem;
    --ra-radius-md: 1rem;
    --ra-font-display: "Trebuchet MS", "Avenir Next", sans-serif;
    --ra-font-body: "Segoe UI", "Verdana", sans-serif;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    color: var(--ra-text);
    font-family: var(--ra-font-body);
    background:
      radial-gradient(circle at top left, var(--ra-bg-accent), transparent 26rem),
      radial-gradient(circle at bottom right, rgba(91, 125, 56, 0.12), transparent 24rem),
      linear-gradient(145deg, #f8f4ea 0%, var(--ra-bg) 100%);
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(.ra-view) {
    display: grid;
    gap: 1.5rem;
  }

  :global(.ra-hero) {
    display: grid;
    gap: 1rem;
  }

  :global(.ra-eyebrow) {
    margin: 0;
    color: var(--ra-accent);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  :global(.ra-headline) {
    margin: 0;
    font-family: var(--ra-font-display);
    font-size: clamp(2rem, 4vw, 3.3rem);
    line-height: 1.05;
  }

  :global(.ra-lede) {
    margin: 0;
    max-width: 52rem;
    color: var(--ra-muted);
    line-height: 1.7;
  }

  :global(.ra-panel-grid) {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }

  :global(.ra-panel) {
    padding: 1.25rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-md);
    background: var(--ra-surface);
    box-shadow: var(--ra-shadow);
  }

  :global(.ra-panel h2),
  :global(.ra-panel h3) {
    margin: 0 0 0.6rem;
    font-family: var(--ra-font-display);
  }

  :global(.ra-panel p) {
    margin: 0;
    color: var(--ra-muted);
    line-height: 1.6;
  }

  :global(.ra-chip-row) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  :global(.ra-chip) {
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    color: var(--ra-muted);
    font-size: 0.92rem;
  }

  :global(.ra-list) {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--ra-muted);
    line-height: 1.6;
  }

  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: minmax(16rem, 19rem) minmax(0, 1fr);
  }

  .sidebar {
    display: grid;
    align-content: start;
    gap: 1.5rem;
    padding: 2rem 1.4rem;
    background: rgba(27, 42, 29, 0.92);
    color: #eff4ea;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }

  .brand {
    display: grid;
    gap: 0.65rem;
  }

  .eyebrow {
    margin: 0;
    color: #d5b36b;
    font-size: 0.75rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .brand h1 {
    margin: 0;
    font-family: var(--ra-font-display);
    font-size: 2rem;
    line-height: 1;
  }

  .stage,
  .summary,
  .rails-title,
  .rails li {
    margin: 0;
    color: rgba(239, 244, 234, 0.78);
    line-height: 1.55;
  }

  nav {
    display: grid;
    gap: 0.7rem;
  }

  nav a {
    display: grid;
    gap: 0.2rem;
    padding: 0.95rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
    transition:
      transform 160ms ease,
      background-color 160ms ease,
      border-color 160ms ease;
  }

  nav a:hover,
  nav a.active {
    transform: translateX(0.15rem);
    background: rgba(213, 179, 107, 0.12);
    border-color: rgba(213, 179, 107, 0.28);
  }

  nav span {
    font-weight: 700;
  }

  nav small {
    color: rgba(239, 244, 234, 0.68);
  }

  .rails {
    display: grid;
    gap: 0.8rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .rails-title {
    color: #d5b36b;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .rails ul {
    display: grid;
    gap: 0.7rem;
    margin: 0;
    padding-left: 1.2rem;
  }

  .workspace {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--ra-border);
    background: rgba(255, 255, 255, 0.54);
    backdrop-filter: blur(18px);
  }

  .topbar p,
  .topbar span {
    margin: 0;
    color: var(--ra-muted);
  }

  .topbar span {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    text-transform: capitalize;
  }

  .content {
    min-width: 0;
    padding: 1.5rem;
  }

  @media (max-width: 900px) {
    .shell {
      grid-template-columns: 1fr;
    }

    .sidebar {
      padding: 1.2rem;
      border-right: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    nav {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    nav a {
      min-width: 0;
    }
  }

  @media (max-width: 640px) {
    .content {
      padding: 1rem;
    }

    nav {
      grid-template-columns: 1fr;
    }

    .topbar {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
  }
</style>
