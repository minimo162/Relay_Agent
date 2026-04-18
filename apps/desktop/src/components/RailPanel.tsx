import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import type { McpServer } from "../lib/ipc";
import type { PlanTimelineEntry, PlanTodoItem } from "../context/todo-write-parse";
import {
  fetchWorkspaceInstructionSurfaces,
  mcpAddServer,
  mcpRemoveServer,
  type WorkspaceInstructionSurfaces,
} from "../lib/ipc";
import { Button, IconButton, Input } from "./ui";
import { workspaceBasename } from "../lib/workspace-display";

function planGlyph(status: PlanTodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "●";
    case "in_progress":
      return "◐";
    default:
      return "○";
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  return platform.includes("mac") || ua.includes("mac os");
}

export function RailPanel(props: {
  mcpServers: () => McpServer[];
  setMcpServers: (fn: (prev: McpServer[]) => McpServer[]) => void;
  workspacePath: () => string;
  planTimeline: () => PlanTimelineEntry[];
  maxTurns: () => number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): JSX.Element {
  const [instructionSurfaces, setInstructionSurfaces] = createSignal<WorkspaceInstructionSurfaces | null>(
    null,
  );
  const [showAddServer, setShowAddServer] = createSignal(false);
  const [newServerName, setNewServerName] = createSignal("");
  const [newServerCommand, setNewServerCommand] = createSignal("");
  const [newServerArgs, setNewServerArgs] = createSignal("");

  createEffect(() => {
    const cwd = props.workspacePath()?.trim();
    if (!cwd) {
      setInstructionSurfaces(null);
      return;
    }
    void fetchWorkspaceInstructionSurfaces(cwd)
      .then(setInstructionSurfaces)
      .catch((err) => {
        console.error("[Rail] workspace surfaces failed", err);
        setInstructionSurfaces(null);
      });
  });

  const latestPlan = createMemo(() => {
    const t = props.planTimeline();
    return t.length > 0 ? t[t.length - 1] : null;
  });

  const planStats = createMemo(() => {
    const entry = latestPlan();
    if (!entry) return null;
    const total = entry.todos.length;
    const done = entry.todos.filter((i) => i.status === "completed").length;
    return { total, done };
  });

  const workspaceName = createMemo(() => {
    const p = props.workspacePath().trim();
    return p ? workspaceBasename(p) : null;
  });

  const addServer = async () => {
    const name = newServerName().trim();
    const command = newServerCommand().trim();
    const args = newServerArgs().trim();
    if (!name || !command) return;
    try {
      const server = await mcpAddServer({
        name,
        command,
        args: args ? args.split(" ").filter(Boolean) : [],
      });
      props.setMcpServers((prev) => [...prev, server]);
      setNewServerName("");
      setNewServerCommand("");
      setNewServerArgs("");
      setShowAddServer(false);
    } catch (err) {
      console.error("[MCP] Failed to add server:", err);
    }
  };

  const removeServer = async (index: number) => {
    const servers = props.mcpServers();
    const server = servers[index];
    try {
      await mcpRemoveServer(server.name);
      props.setMcpServers((prev) => prev.filter((_, i) => i !== index));
    } catch (err) {
      console.error(`[MCP] Failed to remove ${server.name}:`, err);
    }
  };

  const showActivity = createMemo(() => props.canUndo || props.canRedo);
  const kmod = createMemo(() => (isMacPlatform() ? "⌘" : "Ctrl+"));

  return (
    <aside class="ra-rail" aria-label="Context and tools" data-ra-shell-drawer="context">
      <div class="ra-rail__inner">
        {/* ── Plan ── */}
        <section class="ra-rail__card" data-ra-execution-plan>
          <div class="ra-rail__card-head">
            <span class="ra-rail__card-eyebrow">Plan</span>
            <Show when={planStats()}>
              {(stats) => (
                <span class="ra-rail__card-count">
                  {stats().done}／{stats().total}
                </span>
              )}
            </Show>
          </div>
          <Show
            when={latestPlan()}
            fallback={
              <p class="ra-rail__muted">
                Checklists appear here when Relay writes them.
              </p>
            }
          >
            {(entry) => (
              <ul class="ra-rail__plan-list">
                <For each={entry().todos}>
                  {(todo: PlanTodoItem) => (
                    <li
                      class="ra-rail__plan-item"
                      data-status={todo.status}
                    >
                      <span class="ra-rail__plan-glyph" aria-hidden="true">
                        {planGlyph(todo.status)}
                      </span>
                      <span class="ra-rail__plan-text">
                        {todo.activeForm || todo.content}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
        </section>

        {/* ── Activity (undo/redo) ── */}
        <Show when={showActivity()}>
          <section class="ra-rail__card">
            <div class="ra-rail__card-head">
              <span class="ra-rail__card-eyebrow">Activity</span>
            </div>
            <p class="ra-rail__muted">Revert the last file change made in this conversation.</p>
            <div class="ra-rail__activity-actions">
              <button
                type="button"
                class="ra-rail__ghost-btn"
                onClick={() => props.onUndo()}
                disabled={!props.canUndo}
              >
                ← Undo
              </button>
              <button
                type="button"
                class="ra-rail__ghost-btn"
                onClick={() => props.onRedo()}
                disabled={!props.canRedo}
              >
                Redo →
              </button>
            </div>
          </section>
        </Show>

        {/* ── Meta ── */}
        <section class="ra-rail__card">
          <div class="ra-rail__card-head">
            <span class="ra-rail__card-eyebrow">Session</span>
          </div>
          <dl class="ra-rail__meta-list">
            <div class="ra-rail__meta-row">
              <dt>Project</dt>
              <dd>{workspaceName() ?? "—"}</dd>
            </div>
            <div class="ra-rail__meta-row">
              <dt>Max turns</dt>
              <dd>{props.maxTurns()}</dd>
            </div>
            <div class="ra-rail__meta-row">
              <dt>Servers</dt>
              <dd>{props.mcpServers().length}</dd>
            </div>
          </dl>
        </section>

        {/* ── Integrations (MCP) ── */}
        <section class="ra-rail__card">
          <div class="ra-rail__card-head">
            <span class="ra-rail__card-eyebrow">Integrations</span>
            <Show
              when={!showAddServer()}
              fallback={
                <button
                  type="button"
                  class="ra-rail__link-btn"
                  onClick={() => setShowAddServer(false)}
                >
                  Cancel
                </button>
              }
            >
              <button
                type="button"
                class="ra-rail__link-btn"
                onClick={() => setShowAddServer(true)}
              >
                + Add
              </button>
            </Show>
          </div>

          <Show when={showAddServer()}>
            <div class="ra-rail__add-server">
              <Input
                type="text"
                placeholder="Name"
                value={newServerName()}
                onInput={(e) => setNewServerName(e.currentTarget.value)}
              />
              <Input
                type="text"
                placeholder="Command"
                value={newServerCommand()}
                onInput={(e) => setNewServerCommand(e.currentTarget.value)}
              />
              <Input
                type="text"
                placeholder="Args (space-separated)"
                value={newServerArgs()}
                onInput={(e) => setNewServerArgs(e.currentTarget.value)}
              />
              <Button variant="primary" onClick={() => void addServer()}>
                Add server
              </Button>
            </div>
          </Show>

          <Show
            when={props.mcpServers().length > 0}
            fallback={
              <p class="ra-rail__muted">No external tool servers connected.</p>
            }
          >
            <ul class="ra-rail__server-list">
              <For each={props.mcpServers()}>
                {(server, idx) => (
                  <li class="ra-rail__server-row">
                    <span
                      class={`ra-rail__server-dot ra-rail__server-dot--${
                        server.status === "connected" ? "on" : "off"
                      }`}
                      aria-hidden="true"
                    />
                    <div class="ra-rail__server-body">
                      <div class="ra-rail__server-name">{server.name}</div>
                      <div class="ra-rail__server-meta">
                        {server.toolCount} tool{server.toolCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <IconButton
                      variant="danger"
                      label="Remove server"
                      class="ra-rail__server-remove"
                      onClick={() => void removeServer(idx())}
                    >
                      ×
                    </IconButton>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={instructionSurfaces()}>
            {(surf) => (
              <Show when={surf().surfaces.some((s) => s.exists)}>
                <div class="ra-rail__surfaces">
                  <For each={surf().surfaces.filter((s) => s.exists)}>
                    {(s) => (
                      <div class="ra-rail__surface-row" title={s.path}>
                        <span class="ra-rail__surface-dot" aria-hidden="true" />
                        <span class="ra-rail__surface-label">{s.label}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </section>

        {/* ── Keys ── */}
        <section class="ra-rail__card ra-rail__card--keys">
          <div class="ra-rail__card-head">
            <span class="ra-rail__card-eyebrow">Keys</span>
          </div>
          <ul class="ra-rail__keys-list">
            <li><kbd>{kmod()}N</kbd><span>New chat</span></li>
            <li><kbd>{kmod()}K</kbd><span>Focus input</span></li>
            <li><kbd>{kmod()}/</kbd><span>Commands</span></li>
            <li><kbd>{kmod()}[</kbd><kbd>{kmod()}]</kbd><span>Switch chat</span></li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
