import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import type { ContextFile, McpServer, Policy, SessionPreset } from "../lib/ipc";
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

type TabId = "files" | "servers" | "plan" | "policy";

const tabs: { id: TabId; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "servers", label: "MCP" },
  { id: "plan", label: "Plan" },
  { id: "policy", label: "Policy" },
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
  contextFiles: () => ContextFile[];
  setContextFiles: (fn: (prev: ContextFile[]) => ContextFile[]) => void;
  mcpServers: () => McpServer[];
  setMcpServers: (fn: (prev: McpServer[]) => McpServer[]) => void;
  workspacePath: () => string;
  sessionPreset: () => SessionPreset;
  /** TodoWrite snapshots in order; UI shows newest first (OpenWork-style plan timeline). */
  planTimeline: () => PlanTimelineEntry[];
}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("files");
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
  const [showAddFile, setShowAddFile] = createSignal(false);
  const [showAddServer, setShowAddServer] = createSignal(false);
  const [newFilePath, setNewFilePath] = createSignal("");
  const [newServerName, setNewServerName] = createSignal("");
  const [newServerCommand, setNewServerCommand] = createSignal("");
  const [newServerArgs, setNewServerArgs] = createSignal("");

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const addFile = async () => {
    const path = newFilePath().trim();
    if (!path) return;
    const name = path.split("/").pop() || path;
    props.setContextFiles((prev) => [
      ...prev,
      { name, path, size: Math.floor(Math.random() * 50000) + 500 },
    ]);
    setNewFilePath("");
    setShowAddFile(false);
  };

  const removeFile = (index: number) => {
    props.setContextFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const addServer = async () => {
    const name = newServerName().trim();
    const command = newServerCommand().trim();
    const args = newServerArgs().trim();
    if (!name || !command) return;
    try {
      const server = await mcpAddServer({
        name,
        command,
        args: args ? args.split(" ").filter(Boolean) : undefined,
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
          <Match when={activeTab() === "files"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                  {props.contextFiles().length} file{props.contextFiles().length !== 1 ? "s" : ""}
                </span>
                <Show
                  when={showAddFile()}
                  fallback={
                    <button
                      type="button"
                      class={`text-xs px-2.5 py-1 rounded-full border ${ui.border} ${ui.accent} hover:bg-[var(--ra-hover)] transition-colors`}
                      onClick={() => setShowAddFile(true)}
                    >
                      + Add File
                    </button>
                  }
                >
                  <div class="flex gap-1 items-center flex-1 min-w-0">
                    <Input
                      type="text"
                      placeholder="/path/to/file"
                      value={newFilePath()}
                      onInput={(e) => setNewFilePath(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addFile();
                        if (e.key === "Escape") setShowAddFile(false);
                      }}
                      class="text-xs flex-1 !py-1 !px-2"
                    />
                    <IconButton label="Add file" onClick={() => void addFile()} class="opacity-100">
                      ✓
                    </IconButton>
                    <IconButton label="Cancel" onClick={() => setShowAddFile(false)}>
                      ×
                    </IconButton>
                  </div>
                </Show>
              </div>

              <Show
                when={props.contextFiles().length > 0}
                fallback={
                  <div class={`text-xs ${ui.mutedText} text-center py-8`}>No context files</div>
                }
              >
                <For each={props.contextFiles()}>
                  {(file, idx) => (
                    <div class={`group ra-quiet-row`}>
                      <span class="ra-file-icon" aria-hidden />
                      <div class="flex-1 min-w-0">
                        <div class={`text-xs font-medium ${ui.textPrimary} truncate`}>{file.name}</div>
                        <div class={`text-[11px] ${ui.mutedText} truncate font-mono`}>{file.path}</div>
                        <div class={`text-[10px] ${ui.mutedText} opacity-60`}>{formatSize(file.size)}</div>
                      </div>
                      <IconButton
                        variant="danger"
                        label="Remove file"
                        class="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeFile(idx())}
                      >
                        ×
                      </IconButton>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Match>

          <Match when={activeTab() === "servers"}>
            <div class="flex flex-col gap-2">
              <p class={`text-[11px] leading-relaxed ${ui.mutedText}`}>
                MCP servers extend the agent like skills/plugins. Below: read-only checks for Claw-style
                instruction files under your configured workspace path (Settings).
              </p>
              <Show
                when={!props.workspacePath()?.trim()}
                fallback={
                  <Show
                    when={instructionSurfaces()}
                    fallback={
                      <p class={`text-[11px] ${ui.mutedText}`}>Scanning workspace instructions…</p>
                    }
                  >
                    {(surf) => (
                      <div
                        class={`rounded-lg border ${ui.border} p-2 space-y-1.5`}
                        data-ra-workspace-instructions
                      >
                        <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                          Workspace instructions
                        </span>
                        <Show when={surf().workspaceRoot}>
                          <p class={`text-[10px] font-mono ${ui.mutedText} break-all`}>
                            {surf().workspaceRoot}
                          </p>
                        </Show>
                        <For each={surf().surfaces}>
                          {(s) => (
                            <div class="flex items-start gap-2 text-[11px]">
                              <span
                                class={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                  s.exists ? "bg-[var(--ra-green)]" : "bg-[var(--ra-text-muted)]"
                                }`}
                                aria-hidden
                              />
                              <div class="min-w-0 flex-1">
                                <div class={`font-medium ${ui.textPrimary}`}>{s.label}</div>
                                <div class={`text-[10px] font-mono ${ui.mutedText} break-all`}>
                                  {s.path}
                                </div>
                                <div class={`text-[10px] ${ui.mutedText}`}>
                                  {s.exists
                                    ? s.isDirectory
                                      ? "Present (directory)"
                                      : "Present"
                                    : "Not found"}
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
                <p class={`text-[11px] ${ui.mutedText}`}>
                  Set a workspace path in Settings to scan for <span class="font-mono">CLAW.md</span> /{" "}
                  <span class="font-mono">.claw</span>.
                </p>
              </Show>
              <div class="flex items-center justify-between gap-2">
                <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                  {props.mcpServers().length} server{props.mcpServers().length !== 1 ? "s" : ""}
                </span>
                <Show
                  when={showAddServer()}
                  fallback={
                    <button
                      type="button"
                      class={`text-xs px-2.5 py-1 rounded-full border ${ui.border} ${ui.accent} hover:bg-[var(--ra-hover)] transition-colors`}
                      onClick={() => setShowAddServer(true)}
                    >
                      + Add Server
                    </button>
                  }
                >
                  <div class="flex flex-col gap-1.5 w-full">
                    <Input
                      type="text"
                      placeholder="Server name"
                      value={newServerName()}
                      onInput={(e) => setNewServerName(e.currentTarget.value)}
                      class="text-xs !py-1 !px-2"
                    />
                    <Input
                      type="text"
                      placeholder="Command (e.g. npx)"
                      value={newServerCommand()}
                      onInput={(e) => setNewServerCommand(e.currentTarget.value)}
                      class="text-xs !py-1 !px-2"
                    />
                    <Input
                      type="text"
                      placeholder="Args (space-separated)"
                      value={newServerArgs()}
                      onInput={(e) => setNewServerArgs(e.currentTarget.value)}
                      class="text-xs !py-1 !px-2"
                    />
                    <div class="flex gap-1">
                      <Button variant="primary" onClick={() => void addServer()} class="flex-1 !py-1 !text-xs">
                        Add
                      </Button>
                      <Button variant="secondary" onClick={() => setShowAddServer(false)} class="flex-1 !py-1 !text-xs">
                        Cancel
                      </Button>
                    </div>
                  </div>
                </Show>
              </div>

              <Show
                when={props.mcpServers().length > 0}
                fallback={
                  <div class={`text-xs ${ui.mutedText} text-center py-8 leading-relaxed px-1`}>
                    No MCP servers yet. Add one to expose external tools (similar to installing skills in
                    OpenWork).
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
                        <div class={`text-xs font-medium ${ui.textPrimary}`}>{server.name}</div>
                        <div class={`text-[11px] ${ui.mutedText} truncate font-mono`}>
                          {server.command} {server.args.join(" ")}
                        </div>
                        <div class={`text-[10px] ${ui.mutedText} opacity-60`}>
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

          <Match when={activeTab() === "plan"}>
            <div class="flex flex-col gap-2" data-ra-execution-plan>
              <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                Plan timeline
              </span>
              <p class={`text-[11px] leading-relaxed ${ui.mutedText}`}>
                Each <span class="font-mono text-[10px]">TodoWrite</span> update is a section; newest on
                top.
              </p>
              <Show
                when={planNewestFirst()}
                fallback={
                  <div class={`text-xs ${ui.mutedText} text-center py-6 leading-relaxed`}>
                    No task list yet. When the agent uses{" "}
                    <span class="font-mono text-[10px]">TodoWrite</span>, steps appear here.
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
                            class={`rounded-lg border ${ui.border} bg-[var(--ra-surface-elevated)]/40 px-2 py-1.5`}
                            open={snapIdx() === 0}
                          >
                            <summary class="cursor-pointer text-xs text-[var(--ra-text-primary)] list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                              <span class="font-medium">
                                {summaryLabel}
                                <span class={`font-normal ${ui.mutedText}`}>
                                  {" "}
                                  · {entry.todos.length} task{entry.todos.length !== 1 ? "s" : ""}
                                </span>
                              </span>
                              <span class={`text-[10px] font-mono ${ui.mutedText} truncate max-w-[40%]`}>
                                {entry.toolUseId}
                              </span>
                            </summary>
                            <ol class="list-decimal list-inside space-y-1.5 pl-0.5 mt-2 mb-0.5">
                              <For each={entry.todos}>
                                {(item: PlanTodoItem) => (
                                  <li class="text-xs text-[var(--ra-text-primary)] leading-snug">
                                    <span class="font-medium">{item.activeForm || item.content}</span>
                                    <span
                                      class={`ml-2 text-[10px] px-1.5 py-0.5 rounded-md ${
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

          <Match when={activeTab() === "policy"}>
            <div class="flex flex-col gap-2">
              <p class={`text-[11px] leading-relaxed ${ui.mutedText}`}>
                Effective tool gating for composer mode <span class="font-mono">{props.sessionPreset()}</span>.
                Interactive approvals and project <span class="font-mono">.claw</span> still apply (e.g. bash
                read-only guard).
              </p>
              <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                {permissionRows().length} tool{permissionRows().length !== 1 ? "s" : ""}
              </span>

              <Show
                when={permissionRows().length > 0}
                fallback={
                  <div class={`text-xs ${ui.mutedText} text-center py-8`}>Loading policy…</div>
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
                          <div class={`text-xs font-medium ${ui.textPrimary}`}>{policy.name}</div>
                          <Show when={policy.description}>
                            <div class={`text-[11px] ${ui.mutedText} truncate`}>{policy.description}</div>
                          </Show>
                        </div>
                        <span
                          class={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 ${badgeColor}`}
                        >
                          {badgeLabel}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
