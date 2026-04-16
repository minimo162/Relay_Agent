import { For, Match, Show, Switch, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import type { McpServer } from "../lib/ipc";
import type { PlanTimelineEntry, PlanTodoItem } from "../context/todo-write-parse";
import {
  fetchWorkspaceInstructionSurfaces,
  mcpAddServer,
  mcpRemoveServer,
  type WorkspaceInstructionSurfaces,
} from "../lib/ipc";
import { Button, IconButton, Input } from "./ui";
import { TabTrack } from "./primitives";
import { ui } from "../lib/ui-tokens";
import { humanToolLabel } from "../lib/tool-timeline";

type TabId = "plan" | "servers";

const tabs: { id: TabId; label: string }[] = [
  { id: "plan", label: "Activity" },
  { id: "servers", label: "Integrations" },
];

function planStatusLabel(status: PlanTodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "Done";
    case "in_progress":
      return "In progress";
    default:
      return "Pending";
  }
}

export function ContextPanel(props: {
  mcpServers: () => McpServer[];
  setMcpServers: (fn: (prev: McpServer[]) => McpServer[]) => void;
  workspacePath: () => string;
  /** TodoWrite snapshots in order; UI shows newest first (OpenWork-style plan timeline). */
  planTimeline: () => PlanTimelineEntry[];
}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("plan");
  const [instructionSurfaces, setInstructionSurfaces] = createSignal<WorkspaceInstructionSurfaces | null>(
    null,
  );

  createEffect(() => {
    const cwd = props.workspacePath()?.trim();
    if (!cwd) {
      setInstructionSurfaces(null);
      return;
    }
    void fetchWorkspaceInstructionSurfaces(cwd)
      .then(setInstructionSurfaces)
      .catch((err) => {
        console.error("[Context] workspace surfaces failed", err);
        setInstructionSurfaces(null);
      });
  });

  const planNewestFirst = createMemo(() => {
    const t = props.planTimeline();
    return t.length > 0 ? [...t].reverse() : false;
  });
  const [showAddServer, setShowAddServer] = createSignal(false);
  const [newServerName, setNewServerName] = createSignal("");
  const [newServerCommand, setNewServerCommand] = createSignal("");
  const [newServerArgs, setNewServerArgs] = createSignal("");

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

  return (
    <aside class="ra-shell-context-panel" aria-label="Context and tools">
      <TabTrack tabs={tabs} active={activeTab()} onChange={setActiveTab} ariaLabel="Context panel" />
      <div class="flex-1 min-h-0 overflow-y-auto p-3 pt-2">
        <Switch>
          <Match when={activeTab() === "plan"}>
            <div class="flex flex-col gap-2" data-ra-execution-plan>
              <div class="ra-context-note">
                <span class={`ra-type-system-micro ${ui.mutedText}`}>Activity</span>
                <p class={`ra-type-button-label ${ui.textPrimary} mt-1`}>Conversation drives the work.</p>
                <p class={`ra-type-caption ${ui.mutedText} mt-1 leading-relaxed`}>
                  Checklists appear only when Relay writes them. Risky steps still pause for approval.
                </p>
              </div>
              <Show
                when={planNewestFirst()}
                fallback={
                  <div class="ra-context-empty-card">
                    <div class={`ra-type-button-label ${ui.textPrimary}`}>No activity yet</div>
                    <ul class={`ra-context-empty-list ra-type-caption ${ui.mutedText}`}>
                      <li>Ask Relay to inspect, review, or change something in the current project.</li>
                      <li>Any live checklist Relay writes will appear here.</li>
                    </ul>
                  </div>
                }
              >
                {(entries) => (
                  <div class="flex flex-col gap-1.5">
                    <For each={entries()}>
                      {(entry, snapIdx) => {
                        const total = props.planTimeline().length;
                        const chronologicalIndex = total - 1 - snapIdx();
                        const summaryLabel =
                          entry.atMs > 0
                            ? new Date(entry.atMs).toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : `Step ${chronologicalIndex + 1}`;
                        return (
                          <details
                            class={`${ui.radiusFeatured} border ${ui.border} bg-[var(--ra-surface-elevated)]/40 px-2 py-1.5`}
                            open={snapIdx() === 0}
                          >
                            <summary class={`cursor-pointer ra-type-button-label text-[var(--ra-text-primary)] list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}>
                              <span class="font-medium">
                                {summaryLabel}
                                <span class={`font-normal ${ui.mutedText}`}>
                                  {" "}
                                  · {entry.todos.length} task{entry.todos.length !== 1 ? "s" : ""}
                                </span>
                              </span>
                              <span class={`ra-type-mono-small ${ui.mutedText} truncate max-w-[40%]`}>
                                {entry.toolUseId}
                              </span>
                            </summary>
                            <ol class="list-decimal list-inside space-y-1.5 pl-0.5 mt-2 mb-0.5">
                              <For each={entry.todos}>
                                {(item: PlanTodoItem) => (
                                  <li class={`ra-type-button-label text-[var(--ra-text-primary)] leading-snug`}>
                                    <span class="font-medium">{item.activeForm || item.content}</span>
                                    <span
                                      class={`ml-2 ra-type-caption px-1.5 py-0.5 ${ui.radiusCompact} ${
                                        item.status === "completed"
                                          ? "bg-[var(--ra-green)]/15 text-[var(--ra-green)]"
                                          : item.status === "in_progress"
                                            ? "bg-[var(--ra-accent)]/15 text-[var(--ra-accent)]"
                                            : "bg-[var(--ra-surface-elevated)] text-[var(--ra-text-muted)]"
                                      }`}
                                    >
                                      {planStatusLabel(item.status)}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ol>
                          </details>
                        );
                      }}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </Match>

          <Match when={activeTab() === "servers"}>
            <div class="flex flex-col gap-2">
              <p class={`ra-type-system-caption leading-relaxed ${ui.mutedText}`}>
                Review project guidance and connected services here.
              </p>
              <details
                class={`${ui.radiusFeatured} border ${ui.border} ra-policy-card`}
                data-ra-workspace-instructions-details
              >
                <summary class={`cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                  <div class="ra-policy-card__summary">
                    <span class={`ra-type-system-micro ${ui.mutedText}`}>Workspace instructions</span>
                    <span class={`ra-type-caption ${ui.mutedText}`}>
                      {props.workspacePath()?.trim() ? "Review files" : "Project not set"}
                    </span>
                  </div>
                </summary>
                <div class="ra-policy-card__body">
                  <Show
                    when={!props.workspacePath()?.trim()}
                    fallback={
                      <Show
                        when={instructionSurfaces()}
                        fallback={<p class={`ra-type-caption ${ui.mutedText}`}>Scanning workspace instructions…</p>}
                      >
                        {(surf) => (
                          <div class="space-y-1.5" data-ra-workspace-instructions>
                            <Show when={surf().workspaceRoot}>
                              <p class={`ra-type-mono-small ${ui.mutedText} break-all`}>{surf().workspaceRoot}</p>
                            </Show>
                            <For each={surf().surfaces}>
                              {(s) => (
                                <div class={`flex items-start gap-2 ra-type-caption`}>
                                  <span
                                    class={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                      s.exists ? "bg-[var(--ra-green)]" : "bg-[var(--ra-text-muted)]"
                                    }`}
                                    aria-hidden
                                  />
                                  <div class="min-w-0 flex-1">
                                    <div class={`ra-type-button-label font-medium ${ui.textPrimary}`}>{s.label}</div>
                                    <div class={`ra-type-mono-small ${ui.mutedText} break-all`}>{s.path}</div>
                                    <div class={`ra-type-caption ${ui.mutedText}`}>
                                      {s.exists ? (s.isDirectory ? "Present (directory)" : "Present") : "Not found"}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        )}
                      </Show>
                    }
                  >
                    <p class={`ra-type-caption ${ui.mutedText}`}>
                      Choose a project from the header to show instruction files here.
                    </p>
                  </Show>
                </div>
              </details>
              <div class={`${ui.radiusFeatured} border ${ui.border} p-2 space-y-2`}>
                <div class="flex items-center justify-between gap-2">
                  <span class={`ra-type-system-micro ${ui.mutedText}`}>Servers</span>
                  <span class={`ra-type-system-micro ${ui.mutedText}`}>
                    {props.mcpServers().length} connected
                  </span>
                </div>
              <div class="flex items-center justify-between gap-2">
                <Show
                  when={showAddServer()}
                  fallback={
                    <button
                      type="button"
                      class={`ra-type-button-label px-2.5 py-1 ${ui.radiusPill} border ${ui.border} ${ui.accent} hover:bg-[var(--ra-hover)] transition-colors`}
                      onClick={() => setShowAddServer(true)}
                    >
                      Add server
                    </button>
                  }
                >
                  <div class="flex flex-col gap-1.5 w-full">
                    <Input
                      type="text"
                      placeholder="Server name"
                      value={newServerName()}
                      onInput={(e) => setNewServerName(e.currentTarget.value)}
                      class="ra-type-button-label !py-1 !px-2"
                    />
                    <Input
                      type="text"
                      placeholder="Command (e.g. npx)"
                      value={newServerCommand()}
                      onInput={(e) => setNewServerCommand(e.currentTarget.value)}
                      class="ra-type-button-label !py-1 !px-2"
                    />
                    <Input
                      type="text"
                      placeholder="Args (space-separated)"
                      value={newServerArgs()}
                      onInput={(e) => setNewServerArgs(e.currentTarget.value)}
                      class="ra-type-button-label !py-1 !px-2"
                    />
                    <div class="flex gap-1">
                      <Button variant="primary" onClick={() => void addServer()} class="ra-type-button-label flex-1 !py-1">
                        Add
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setShowAddServer(false)}
                        class="ra-type-button-label flex-1 !py-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </Show>
              </div>

              <Show
                when={props.mcpServers().length > 0}
                fallback={
                  <div class={`ra-type-button-label ${ui.mutedText} text-center py-8 leading-relaxed px-1`}>
                    No external tool servers connected yet.
                  </div>
                }
              >
                <For each={props.mcpServers()}>
                  {(server, idx) => (
                    <div class={`group ra-quiet-row ra-quiet-row--align-center`}>
                      <span
                        class={`w-2 h-2 rounded-full flex-shrink-0 ${
                          server.status === "connected" ? "bg-[var(--ra-green)]" : "bg-[var(--ra-text-muted)]"
                        }`}
                        aria-hidden
                      />
                      <div class="flex-1 min-w-0">
                        <div class={`ra-type-button-label font-medium ${ui.textPrimary}`}>{server.name}</div>
                        <div class={`ra-type-mono-small ${ui.mutedText} truncate`}>
                          {server.command} {server.args.join(" ")}
                        </div>
                        <div class={`ra-type-caption ${ui.mutedText} opacity-60`}>
                          {server.toolCount} tool{server.toolCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <IconButton
                        variant="danger"
                        label="Remove server"
                        class="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => void removeServer(idx())}
                      >
                        ×
                      </IconButton>
                    </div>
                  )}
                </For>
              </Show>
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
