import { For, Match, Show, Switch, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import type { McpServer, Policy, SessionPreset } from "../lib/ipc";
import { sessionModeLabel, sessionModeSummary } from "../lib/session-mode-label";
import type { PlanTimelineEntry, PlanTodoItem } from "../context/todo-write-parse";
import {
  fetchWorkspaceInstructionSurfaces,
  getDesktopPermissionSummary,
  mcpAddServer,
  mcpRemoveServer,
  type WorkspaceInstructionSurfaces,
} from "../lib/ipc";
import { Button, IconButton, Input } from "./ui";
import { TabTrack } from "./primitives";
import { ui } from "../lib/ui-tokens";

type TabId = "plan" | "servers";

const tabs: { id: TabId; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "servers", label: "MCP" },
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
  sessionPreset: () => SessionPreset;
  /** TodoWrite snapshots in order; UI shows newest first (OpenWork-style plan timeline). */
  planTimeline: () => PlanTimelineEntry[];
}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("plan");
  const [instructionSurfaces, setInstructionSurfaces] = createSignal<WorkspaceInstructionSurfaces | null>(
    null,
  );
  const [permissionRows, setPermissionRows] = createSignal<Policy[]>([]);

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

  createEffect(() => {
    const preset = props.sessionPreset();
    void getDesktopPermissionSummary(preset)
      .then((rows) =>
        setPermissionRows(
          rows.map((r) => ({
            name: r.name,
            requirement: r.requirement,
            description: r.description,
          })),
        ),
      )
      .catch((err) => {
        console.error("[Context] permission summary failed", err);
        setPermissionRows([]);
      });
  });
  const planNewestFirst = createMemo(() => {
    const t = props.planTimeline();
    return t.length > 0 ? [...t].reverse() : false;
  });
  const modeLabel = createMemo(() => sessionModeLabel(props.sessionPreset()));
  const modeSummary = createMemo(() => sessionModeSummary(props.sessionPreset()));
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
                <span class={`ra-type-system-micro ${ui.mutedText}`}>Current mode</span>
                <p class={`ra-type-button-label ${ui.textPrimary} mt-1`}>{modeLabel()}</p>
                <p class={`ra-type-caption ${ui.mutedText} mt-1 leading-relaxed`}>{modeSummary()}</p>
              </div>
              <Show
                when={planNewestFirst()}
                fallback={
                  <div class="ra-context-empty-card">
                    <div class={`ra-type-button-label ${ui.textPrimary}`}>No plan yet</div>
                    <div class={`ra-type-caption ${ui.mutedText} mt-1 leading-relaxed`}>
                      Relay will list task steps here after it starts working.
                    </div>
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

              <details class={`ra-policy-card ${ui.radiusFeatured} border ${ui.border} mt-2`} data-ra-tool-policy>
                <summary class={`cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                  <div class="ra-policy-card__summary">
                    <span class={`ra-type-system-micro ${ui.mutedText}`}>Tool rules</span>
                    <span class={`ra-type-caption ${ui.mutedText}`}>{modeLabel()}</span>
                  </div>
                </summary>
                <div class="ra-policy-card__body">
                  <p class={`ra-type-caption leading-relaxed ${ui.mutedText}`}>
                    {modeSummary()} Workspace-specific rules and approvals still apply.
                  </p>
                  <Show
                    when={permissionRows().length > 0}
                    fallback={
                      <div class={`ra-type-caption ${ui.mutedText} text-center py-3`}>Checking tool rules…</div>
                    }
                  >
                    <For each={permissionRows()}>
                      {(policy) => {
                        const badgeColor =
                          policy.requirement === "require_approval"
                            ? "bg-[var(--ra-yellow)]/20 text-[var(--ra-yellow)]"
                            : policy.requirement === "auto_deny"
                              ? "bg-[var(--ra-red)]/20 text-[var(--ra-red)]"
                              : "bg-[var(--ra-green)]/20 text-[var(--ra-green)]";

                        const badgeLabel =
                          policy.requirement === "require_approval"
                            ? "Needs approval"
                            : policy.requirement === "auto_deny"
                              ? "Blocked"
                              : "Allowed";

                        return (
                          <div class="ra-quiet-row ra-quiet-row--align-center gap-2">
                            <div class="flex-1 min-w-0">
                              <div class={`ra-type-button-label font-medium ${ui.textPrimary}`}>{policy.name}</div>
                              <Show when={policy.description}>
                                <div class={`ra-type-caption ${ui.mutedText} truncate`}>{policy.description}</div>
                              </Show>
                            </div>
                            <span
                              class={`ra-type-caption px-2 py-0.5 ${ui.radiusPill} font-medium whitespace-nowrap shrink-0 ${badgeColor}`}
                            >
                              {badgeLabel}
                            </span>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </details>
            </div>
          </Match>

          <Match when={activeTab() === "servers"}>
            <div class="flex flex-col gap-2">
              <p class={`ra-type-system-caption leading-relaxed ${ui.mutedText}`}>
                Connect external tool servers here. Workspace instruction files appear below when a
                folder is set.
              </p>
              <Show
                when={!props.workspacePath()?.trim()}
                fallback={
                  <Show
                    when={instructionSurfaces()}
                    fallback={<p class={`ra-type-caption ${ui.mutedText}`}>Scanning workspace instructions…</p>}
                  >
                    {(surf) => (
                      <div
                        class={`${ui.radiusFeatured} border ${ui.border} p-2 space-y-1.5`}
                        data-ra-workspace-instructions
                      >
                        <span class={`ra-type-system-micro ${ui.mutedText}`}>Workspace instructions</span>
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
                  Set a workspace from the header to surface this project&apos;s instruction files.
                </p>
              </Show>
              <div class="flex items-center justify-between gap-2">
                <span class={`ra-type-system-micro ${ui.mutedText}`}>
                  {props.mcpServers().length} server{props.mcpServers().length !== 1 ? "s" : ""}
                </span>
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
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
