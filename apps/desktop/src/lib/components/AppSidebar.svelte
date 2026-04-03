<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let visible = false;
  export let sessions: { id: string; title: string; updatedAt: string }[] = [];
  export let currentSessionId = "";
  export let currentProjectName = "";

  const dispatch = createEventDispatcher<{
    newTask: void;
    selectSession: { id: string };
    selectProject: void;
    close: void;
  }>();

  let hoveredId = "";

  type GroupedSessions = { label: string; items: typeof sessions };

  $: groupedSessions = (() => {
    const groups: GroupedSessions[] = [];
    const today: typeof sessions = [];
    const yesterday: typeof sessions = [];
    const older: typeof sessions = [];
    const now = new Date();
    const todayStr = now.toDateString();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yestStr = yest.toDateString();

    for (const s of sessions) {
      const d = new Date(s.updatedAt).toDateString();
      if (d === todayStr) today.push(s);
      else if (d === yestStr) yesterday.push(s);
      else older.push(s);
    }

    if (today.length)     groups.push({ label: "Today", items: today });
    if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
    if (older.length)     groups.push({ label: "Past 7 Days", items: older });
    return groups;
  })();
</script>

{#if visible}
  <aside class="sidebar">
    <!-- New task -->
    <div class="sidebar-top">
      <button class="new-task-btn btn btn-primary" type="button" on:click={() => dispatch("newTask")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新しいタスク
      </button>
    </div>

    <!-- Sessions -->
    <div class="sidebar-sessions">
      {#if groupedSessions.length === 0}
        <p class="empty-state">最初のタスクを始めましょう</p>
      {:else}
        {#each groupedSessions as group}
          <div class="session-group">
            <span class="label-section">{group.label}</span>
            {#each group.items as session}
              <button
                class="session-item"
                class:active={session.id === currentSessionId}
                type="button"
                on:mouseenter={() => hoveredId = session.id}
                on:mouseleave={() => hoveredId = ""}
                on:click={() => dispatch("selectSession", { id: session.id })}
              >
                <span class="session-title">{session.title || "無題"}</span>
                {#if hoveredId === session.id}
                  <span
                    class="session-menu"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px">
                      <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                    </svg>
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Project -->
    {#if currentProjectName}
      <div class="sidebar-bottom">
        <button class="project-btn" type="button" on:click={() => dispatch("selectProject")}>
          <span class="project-label">{currentProjectName}</span>
          <svg style="width:12px;height:12px;opacity:0.4;flex-shrink:0" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .sidebar {
    width: var(--sidebar-w, 180px);
    height: calc(100vh - var(--titlebar-h, 38px) - var(--statusbar-h, 28px));
    display: flex;
    flex-direction: column;
    background: var(--c-sidebar, #f9fafb);
    border-right: 1px solid var(--c-divider);
    overflow: hidden;
    animation: sidebar-in var(--duration-normal) var(--ease) both;
  }

  @keyframes sidebar-in {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  .sidebar-top {
    padding: var(--sp-3);
    border-bottom: 1px solid var(--c-divider);
  }

  .new-task-btn {
    width: 100%;
    height: 32px;
    font-size: var(--sz-sm);
  }

  .sidebar-sessions {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-2) var(--sp-2);
  }

  .empty-state {
    text-align: center;
    font-size: var(--sz-sm);
    color: var(--c-text-3);
    padding: var(--sp-8) var(--sp-4);
    margin: 0;
  }

  .session-group {
    margin-bottom: var(--sp-2);
  }

  /* Overrides global .label-section to adjust horizontal padding */
  .session-group :global(.label-section) {
    padding-left: var(--sp-2);
    padding-right: var(--sp-2);
  }

  .session-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px var(--sp-2);
    border-radius: var(--r-md);       /* 16px */
    text-align: left;
    color: var(--c-text-2);
    font-size: var(--sz-sm);
    font-weight: 400;
    transition: background var(--duration-fast) var(--ease),
                color var(--duration-fast) var(--ease);
    min-height: 36px;
  }
  .session-item:hover {
    background: var(--c-border);      /* gray-100 */
    color: var(--c-text);
  }
  .session-item.active {
    background: #eef2f7;
    color: var(--c-text);
    font-weight: 500;
  }

  .session-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .session-menu {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-full);
    color: var(--c-text-3);
    flex-shrink: 0;
    transition: background var(--duration-fast), color var(--duration-fast);
  }
  .session-menu:hover {
    background: var(--c-border-strong);
    color: var(--c-text);
  }

  .sidebar-bottom {
    padding: var(--sp-3);
    border-top: 1px solid var(--c-divider);
  }

  .project-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--sp-2);
    font-size: var(--sz-xs);
    color: var(--c-text-2);
    border-radius: var(--r-md);
    transition: background var(--duration-fast);
  }
  .project-btn:hover { background: var(--c-border); }

  .project-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
