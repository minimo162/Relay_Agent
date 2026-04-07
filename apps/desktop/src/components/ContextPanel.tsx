import { For, Match, Show, Switch, createSignal, type JSX } from "solid-js";
import type { ContextFile, McpServer, Policy } from "../lib/ipc";
import { mcpAddServer, mcpRemoveServer } from "../lib/ipc";
import { Button, IconButton, Input } from "./ui";
import { TabTrack } from "./primitives";
import { ui } from "../lib/ui-tokens";

type TabId = "files" | "servers" | "policy";

const tabs: { id: TabId; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "servers", label: "Servers" },
  { id: "policy", label: "Policy" },
];

export function ContextPanel(props: {
  contextFiles: () => ContextFile[];
  setContextFiles: (fn: (prev: ContextFile[]) => ContextFile[]) => void;
  mcpServers: () => McpServer[];
  setMcpServers: (fn: (prev: McpServer[]) => McpServer[]) => void;
  policies: () => Policy[];
}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<TabId>("files");
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
                  <div class={`text-xs ${ui.mutedText} text-center py-8`}>No files in context</div>
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
                  <div class={`text-xs ${ui.mutedText} text-center py-8`}>No MCP servers connected</div>
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

          <Match when={activeTab() === "policy"}>
            <div class="flex flex-col gap-2">
              <span class={`text-[11px] font-medium ${ui.mutedText} uppercase tracking-wide`}>
                {props.policies().length} active polic{props.policies().length !== 1 ? "ies" : "y"}
              </span>

              <Show
                when={props.policies().length > 0}
                fallback={
                  <div class={`text-xs ${ui.mutedText} text-center py-8`}>No active policies</div>
                }
              >
                <For each={props.policies()}>
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
                      <div class={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${ui.border}`}>
                        <div class="flex-1 min-w-0">
                          <div class={`text-xs font-medium ${ui.textPrimary}`}>{policy.name}</div>
                          <Show when={policy.description}>
                            <div class={`text-[11px] ${ui.mutedText} truncate`}>{policy.description}</div>
                          </Show>
                        </div>
                        <span
                          class={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badgeColor}`}
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
