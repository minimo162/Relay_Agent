/// <reference types="vite/client" />
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import {
  cancelAgent,
  chunksFromHistory,
  compactAgentSession,
  getSessionHistory,
  mcpAddServer,
  mcpListServers,
  mcpRemoveServer,
  onAgentEvent,
  respondApproval,
  startAgent,
  type AgentApprovalNeededEvent,
  type AgentErrorEvent,
  type AgentTextDeltaEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type AgentTurnCompleteEvent,
  type ContextFile,
  type McpServer,
  type Policy,
  type UiChunk,
} from "./lib/ipc";
import {
  detectSlashMode,
  executeSlashCommand,
  findSlashCommands,
  type SlashCommand,
  type SlashCommandContext,
} from "./lib/slash-commands";
import { Button, Input, StatusDot } from "./components/ui";

/* Shared class tokens */
const C = {
  border: "border-[var(--ra-border)]",
  textPrimary: "text-[var(--ra-text-primary)]",
  textSecondary: "text-[var(--ra-text-secondary)]",
  textMuted: "text-[var(--ra-text-muted)]",
  accent: "text-[var(--ra-accent)]",
  surface: "bg-[var(--ra-surface)]",
  surfaceElevated: "bg-[var(--ra-surface-elevated)]",
  hover: "hover:bg-[var(--ra-hover)]",
  mutedText: "text-[var(--ra-text-muted)]",
};

/* ============================================================
   Session / Agent state
   ============================================================ */

type SessionState = "idle" | "running" | "error";

interface Approval {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
}

/* ============================================================
   Components
   ============================================================ */

/** Message bubble — user or assistant text */
function MessageBubble(props: { role: "user" | "assistant"; text: string }) {
  const isUser = props.role === "user";
  return (
    <div class={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        class={`max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-[var(--ra-accent)] text-white"
            : `${C.surfaceElevated} ${C.border} border`
        }`}
        data-ra-bubble-role={props.role}
      >
        {props.text}
      </div>
    </div>
  );
}

/** Tool call / result row */
function ToolCallRow(props: {
  toolUseId: string;
  toolName: string;
  status: "running" | "done" | "error";
  result: string | null;
}) {
  const icon =
    props.status === "running" ? "⟳"
    : props.status === "done" ? "✓"
    : "✗";
  const color =
    props.status === "running" ? "text-[var(--ra-yellow)]"
    : props.status === "done" ? "text-[var(--ra-green)]"
    : "text-[var(--ra-red)]";

  return (
    <div class={`my-2 text-xs ${C.mutedText} flex items-start gap-2`} data-ra-tool-row>
      <span class={`${color} font-mono text-sm`}>{icon}</span>
      <div class="flex-1 min-w-0">
        <span class="font-medium">{props.toolName}</span>
        {props.status === "running" && <span class="ml-2 animate-pulse">running…</span>}
        <Show when={props.result}>
          <pre class="mt-1 text-[11px] opacity-70 overflow-x-auto whitespace-pre-wrap font-mono">
            {props.result!.slice(0, 300)}
            {props.result!.length > 300 ? "…" : ""}
          </pre>
        </Show>
      </div>
    </div>
  );
}

/** Message feed */
function MessageFeed(props: { chunks: UiChunk[]; sessionState: SessionState }) {
  let container!: HTMLDivElement;

  createEffect(
    on(
      () => props.chunks.length,
      () => {
        // Auto-scroll to bottom on new messages
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      },
    ),
  );

  return (
    <div
      ref={container!}
      class="flex-1 overflow-y-auto px-6 py-4"
    >
      <Show when={props.chunks.length === 0}>
        <div class="flex h-full items-center justify-center text-center">
          <div>
            <div class="text-3xl mb-3">🧸</div>
            <p class={`text-sm ${C.textSecondary}`}>Relay Agent is ready</p>
            <p class={`text-xs ${C.mutedText} mt-1`}>
              Describe your task to get started
            </p>
          </div>
        </div>
      </Show>
      <For each={props.chunks}>
        {(chunk) => {
          if (chunk.kind === "tool_call") {
            return (
              <ToolCallRow
                toolUseId={chunk.toolUseId}
                toolName={chunk.toolName}
                status={chunk.status}
                result={chunk.result}
              />
            );
          }
          return <MessageBubble role={chunk.kind} text={chunk.text} />;
        }}
      </For>

      {/* Running indicator */}
      <Show when={props.sessionState === "running"}>
        <div
          class={`flex items-center gap-2 text-xs ${C.mutedText} mt-2`}
          data-ra-agent-thinking
        >
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--ra-yellow)] animate-pulse" />
          Agent is thinking…
        </div>
      </Show>
    </div>
  );
}

/** Approval request card — pops up when the agent needs permission */
function ApprovalOverlay(props: {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div class="absolute inset-x-0 bottom-0 z-10 p-4">
      <For each={props.approvals}>
        {(approval) => (
          <div class={`${C.surfaceElevated} ${C.border} border rounded-xl p-4 shadow-lg mb-2`}>
            <div class="flex items-start gap-3">
              <span class="text-amber-400 text-lg mt-0.5">⚠️</span>
              <div class="flex-1 min-w-0">
                <p class={`text-sm font-medium ${C.textPrimary}`}>
                  Tool: {approval.toolName}
                </p>
                <p class={`text-xs ${C.mutedText} mt-1`}>{approval.description}</p>
                <Show when={approval.target}>
                  <p class={`text-xs ${C.mutedText} mt-0.5 font-mono`}>{approval.target}</p>
                </Show>
              </div>
            </div>
            <div class="flex gap-2 mt-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => props.onReject(approval.approvalId)}
                class="px-4 py-1.5 text-xs"
              >
                Reject
              </Button>
              <Button
                variant="primary"
                onClick={() => props.onApprove(approval.approvalId)}
                class="px-4 py-1.5 text-xs"
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Sidebar sessions */
function Sidebar(props: {
  sessionIds: string[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = createSignal("");

  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return props.sessionIds;
    return props.sessionIds.filter((id) => id.toLowerCase().includes(q));
  });

  return (
    <aside class={`${C.surfaceElevated} ${C.border} border-r overflow-y-auto h-full`}>
      <div class={`p-3 border-b ${C.border}`}>
        <h2 class={`text-sm font-semibold ${C.textPrimary} mb-2`}>Sessions</h2>
        <Input
          type="text"
          placeholder="Search sessions…"
          class="text-xs"
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <Show when={filtered().length === 0}>
          <div class={`text-xs ${C.mutedText} text-center py-8`}>No matching sessions</div>
        </Show>
        <For each={filtered()}>
          {(id) => (
            <button
              class={`w-full text-left text-xs px-3 py-2 rounded-lg mb-1 transition-colors truncate ${
                props.activeSessionId === id
                  ? "bg-[var(--ra-accent)] text-white"
                  : `${C.hover} ${C.textSecondary}`
              }`}
              onClick={() => props.onSelect(id)}
            >
              {id.slice(0, 8)}…
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}

/** Context panel — files / servers / policy */
function ContextPanel(props: {
  contextFiles: () => ContextFile[];
  setContextFiles: (fn: (prev: ContextFile[]) => ContextFile[]) => void;
  mcpServers: () => McpServer[];
  setMcpServers: (fn: (prev: McpServer[]) => McpServer[]) => void;
  policies: () => Policy[];
}) {
  type TabId = "files" | "servers" | "policy";
  const [activeTab, setActiveTab] = createSignal<TabId>("files");
  const [showAddFile, setShowAddFile] = createSignal(false);
  const [showAddServer, setShowAddServer] = createSignal(false);
  const [newFilePath, setNewFilePath] = createSignal("");
  const [newServerName, setNewServerName] = createSignal("");
  const [newServerCommand, setNewServerCommand] = createSignal("");
  const [newServerArgs, setNewServerArgs] = createSignal("");

  const tabs: { id: TabId; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "servers", label: "Servers" },
    { id: "policy", label: "Policy" },
  ];

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const addFile = async () => {
    const path = newFilePath().trim();
    if (!path) return;
    const name = path.split("/").pop() || path;
    // Mock: create a file entry with fake size
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
      const server = await mcpAddServer({ name, command, args: args ? args.split(" ").filter(Boolean) : undefined });
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
    <aside
      class={`${C.surfaceElevated} ${C.border} border-l overflow-y-auto h-full flex flex-col`}
    >
      <div class={`flex border-b ${C.border}`}>
        <For each={tabs}>
          {(tab) => (
            <button
              class={`flex-1 text-xs py-2 text-center transition-colors ${
                activeTab() === tab.id
                  ? "text-[var(--ra-accent)] border-b-2 border-[var(--ra-accent)] font-medium"
                  : `${C.mutedText} hover:text-[var(--ra-text-primary)]`
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <Switch>
          {/* ── FILES TAB ── */}
          <Match when={activeTab() === "files"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class={`text-[11px] font-medium ${C.mutedText} uppercase tracking-wide`}>
                  {props.contextFiles().length} file{props.contextFiles().length !== 1 ? "s" : ""}
                </span>
                <Show
                  when={showAddFile()}
                  fallback={
                    <button
                      class={`text-xs px-2 py-1 rounded border ${C.border} ${C.accent} hover:bg-[var(--ra-hover)] transition-colors`}
                      onClick={() => setShowAddFile(true)}
                    >
                      + Add File
                    </button>
                  }
                >
                  <div class="flex gap-1 items-center">
                    <Input
                      type="text"
                      placeholder="/path/to/file"
                      value={newFilePath()}
                      onInput={(e) => setNewFilePath(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addFile();
                        if (e.key === "Escape") setShowAddFile(false);
                      }}
                      class="text-xs flex-1 !py-1 !px-2"
                    />
                    <Button
                      variant="primary"
                      onClick={addFile}
                      class="!px-2 !py-1 !text-xs"
                    >
                      ✓
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setShowAddFile(false)}
                      class="!px-2 !py-1 !text-xs"
                    >
                      ✕
                    </Button>
                  </div>
                </Show>
              </div>

              <Show
                when={props.contextFiles().length > 0}
                fallback={
                  <div class={`text-xs ${C.mutedText} text-center py-8`}>
                    No files in context
                  </div>
                }
              >
                <For each={props.contextFiles()}>
                  {(file, idx) => (
                    <div
                      class={`group flex items-start gap-2 px-2 py-2 rounded-lg border ${C.border} ${C.hover} transition-colors`}
                    >
                      <span class="text-sm mt-0.5 flex-shrink-0">📄</span>
                      <div class="flex-1 min-w-0">
                        <div class={`text-xs font-medium ${C.textPrimary} truncate`}>
                          {file.name}
                        </div>
                        <div class={`text-[11px] ${C.mutedText} truncate font-mono`}>
                          {file.path}
                        </div>
                        <div class={`text-[10px] ${C.mutedText} opacity-60`}>
                          {formatSize(file.size)}
                        </div>
                      </div>
                      <button
                        class="opacity-0 group-hover:opacity-100 text-[var(--ra-red)] text-xs transition-opacity px-1"
                        title="Remove file"
                        onClick={() => removeFile(idx())}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Match>

          {/* ── SERVERS TAB ── */}
          <Match when={activeTab() === "servers"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class={`text-[11px] font-medium ${C.mutedText} uppercase tracking-wide`}>
                  {props.mcpServers().length} server{props.mcpServers().length !== 1 ? "s" : ""}
                </span>
                <Show
                  when={showAddServer()}
                  fallback={
                    <button
                      class={`text-xs px-2 py-1 rounded border ${C.border} ${C.accent} hover:bg-[var(--ra-hover)] transition-colors`}
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
                      <Button
                        variant="primary"
                        onClick={addServer}
                        class="flex-1 !py-1 !text-xs"
                      >
                        Add
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setShowAddServer(false)}
                        class="flex-1 !py-1 !text-xs"
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
                  <div class={`text-xs ${C.mutedText} text-center py-8`}>
                    No MCP servers connected
                  </div>
                }
              >
                <For each={props.mcpServers()}>
                  {(server, idx) => (
                    <div
                      class={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border ${C.border} ${C.hover} transition-colors`}
                    >
                      <span
                        class={`w-2 h-2 rounded-full flex-shrink-0 ${
                          server.status === "connected"
                            ? "bg-[var(--ra-green)]"
                            : "bg-[var(--ra-text-muted)]"
                        }`}
                      />
                      <div class="flex-1 min-w-0">
                        <div class={`text-xs font-medium ${C.textPrimary}`}>
                          {server.name}
                        </div>
                        <div class={`text-[11px] ${C.mutedText} truncate font-mono`}>
                          {server.command} {server.args.join(" ")}
                        </div>
                        <div class={`text-[10px] ${C.mutedText} opacity-60`}>
                          {server.toolCount} tool{server.toolCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <button
                        class="opacity-0 group-hover:opacity-100 text-[var(--ra-red)] text-xs transition-opacity px-1"
                        title="Remove server"
                        onClick={() => removeServer(idx())}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Match>

          {/* ── POLICY TAB ── */}
          <Match when={activeTab() === "policy"}>
            <div class="flex flex-col gap-2">
              <span class={`text-[11px] font-medium ${C.mutedText} uppercase tracking-wide`}>
                {props.policies().length} active polic{props.policies().length !== 1 ? "ies" : "y"}
              </span>

              <Show
                when={props.policies().length > 0}
                fallback={
                  <div class={`text-xs ${C.mutedText} text-center py-8`}>
                    No active policies
                  </div>
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
                        ? "⚡ Approve"
                        : policy.requirement === "auto_deny"
                          ? "⛔ Deny"
                          : "✓ Allow";

                    return (
                      <div
                        class={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${C.border}`}
                      >
                        <div class="flex-1 min-w-0">
                          <div class={`text-xs font-medium ${C.textPrimary}`}>
                            {policy.name}
                          </div>
                          <Show when={policy.description}>
                            <div class={`text-[11px] ${C.mutedText} truncate`}>
                              {policy.description}
                            </div>
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

/** Slash command autocomplete dropdown */
function SlashAutocomplete(props: {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <div
      class="absolute left-0 bottom-full mb-1 min-w-full w-64 rounded-lg shadow-xl py-1 overflow-hidden z-50"
      style={{
        background: "var(--ra-surface-elevated, #1e1e2e)",
        border: "1px solid var(--ra-border, rgba(255,255,255,0.08))",
      }}
    >
      {props.commands.length === 0 ? (
        <div class="px-3 py-1.5 text-xs opacity-50">No matching commands</div>
      ) : (
        props.commands.map((cmd, i) => (
          <div
            class={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
              i === props.selectedIndex
                ? "bg-[var(--ra-accent)] text-white"
                : "opacity-70 hover:opacity-100 hover:bg-white/5"
            }`}
            onClick={() => props.onSelect(cmd)}
            onMouseEnter={() => props.onSelectIndex(i)}
          >
            <span class="font-mono font-medium">/{cmd.command}</span>
            <span class="opacity-60 ml-auto truncate max-w-[120px]">
              {cmd.description}
            </span>
          </div>
        ))
      )}
      <div class="px-3 py-1 text-[10px] opacity-40 border-t border-white/5">
        <kbd>Tab</kbd> or <kbd>Enter</kbd> to select
      </div>
    </div>
  );
}

/** Composer — input at bottom of main */
function Composer(props: {
  onSend: (text: string) => void;
  disabled: boolean;
  running: boolean;
  onCancel: () => void;
  /** Callback for slash command execution. Returns response text or null. */
  onSlashCommand?: (input: string) => Promise<string | null>;
  /** Append a response message directly to the feed (for slash command output) */
  onAppendAssistant?: (text: string) => void;
}) {
  const [text, setText] = createSignal("");
  const [slashMode, setSlashMode] = createSignal<{
    query: string;
    commands: SlashCommand[];
    selectedIndex: number;
  } | null>(null);

  let textareaRef!: HTMLTextAreaElement;

  /** Close slash dropdown and reset state */
  const closeSlashDropdown = () => setSlashMode(null);

  /** Select a command from the dropdown (completes to "/command ") */
  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.command} `);
    closeSlashDropdown();
    textareaRef.focus();
  };

  const send = async () => {
    const value = text().trim();
    if (!value || props.disabled) return;

    // Check if this is a slash command
    if (value.startsWith("/") && props.onSlashCommand) {
      const response = await props.onSlashCommand(value);
      setText("");
      if (response && props.onAppendAssistant) {
        // Append the command result as an assistant message
        props.onAppendAssistant(response);
      }
      // Show the command itself as a user message
      props.onSend(value);
      return;
    }

    // Normal send
    props.onSend(value);
    setText("");
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const newVal = e.currentTarget.value;
    setText(newVal);

    // Detect slash mode
    const detection = detectSlashMode(newVal, newVal.length);
    if (detection) {
      const matches = findSlashCommands(detection.query);
      setSlashMode({
        query: detection.query,
        commands: matches,
        selectedIndex: 0,
      });
    } else {
      closeSlashDropdown();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const current = slashMode();

    if (current && current.commands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMode({
          ...current,
          selectedIndex: (current.selectedIndex + 1) % current.commands.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMode({
          ...current,
          selectedIndex:
            (current.selectedIndex - 1 + current.commands.length) % current.commands.length,
        });
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectCommand(current.commands[current.selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashDropdown();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectCommand(current.commands[current.selectedIndex]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div class={`${C.surfaceElevated} ${C.border} border-t px-4 py-3 relative`}>
      <div class="relative">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="What would you like to do? (type / for commands)"
          value={text()}
          onInput={onInput}
          onKeyDown={onKey}
          disabled={props.disabled}
          class="resize-none w-full"
        />
        <Show when={slashMode()}>
          {(m) => (
            <SlashAutocomplete
              commands={m().commands}
              selectedIndex={m().selectedIndex}
              onSelect={selectCommand}
              onSelectIndex={(index) =>
                setSlashMode({ ...m(), selectedIndex: index })
              }
            />
          )}
        </Show>
      </div>
      <div class="flex justify-end mt-2 gap-2">
        <Show when={props.running}>
          <Button
            variant="secondary"
            onClick={props.onCancel}
            class="px-4 py-1.5 text-xs"
          >
            Cancel
          </Button>
        </Show>
        <Show when={text().trim().length > 0 && !props.running}>
          <Button
            variant="primary"
            disabled={props.disabled}
            onClick={send}
            class="px-4 py-1.5 text-xs"
          >
            Send
          </Button>
        </Show>
      </div>
    </div>
  );
}

/** Status bar */
function StatusBar(props: { sessionState: SessionState; sessionCount: number }) {
  const dot =
    props.sessionState === "running" ? "connecting"
    : props.sessionState === "error" ? "disconnected"
    : "connected";

  const label =
    props.sessionState === "running" ? "Agent running"
    : props.sessionState === "error" ? "Error"
    : "Ready";

  return (
    <footer
      class={`${C.surfaceElevated} ${C.border} border-t px-3 py-1 flex items-center gap-2 text-xs ${C.mutedText}`}
      style={{ "min-height": "28px" }}
      data-ra-footer-session={props.sessionState}
    >
      <StatusDot status={dot} label={label} />
      <span>Relay Agent v0.1.0</span>
      <span class="mx-auto">
        {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
      </span>
    </footer>
  );
}

/* ============================================================
   Shell — root layout
   ============================================================ */

export default function Shell(): JSX.Element {
  // Core session state
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [sessionIds, setSessionIds] = createSignal<string[]>([]);
  const [sessionRunning, setSessionRunning] = createSignal(false);
  const [sessionError, setSessionError] = createSignal<string | null>(null);

  // Messages rendered as flat chunks
  const [chunks, setChunks] = createSignal<UiChunk[]>([]);

  // Pending approval queue
  const [approvals, setApprovals] = createSignal<Approval[]>([]);

  // ── Context panel signals ────────────────────────────────
  const [contextFiles, setContextFiles] = createSignal<ContextFile[]>([
    { name: "README.md", path: "/tmp/Relay_Agent/README.md", size: 1024 },
    { name: "package.json", path: "/tmp/Relay_Agent/package.json", size: 2048 },
  ]);
  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);
  const [policies, setPolicies] = createSignal<Policy[]>([
    { name: "Bash", requirement: "require_approval", description: "Shell commands" },
    { name: "File write", requirement: "require_approval", description: "Write/modify files" },
    { name: "File read", requirement: "auto_allow", description: "Read-only access" },
    { name: "URL fetch", requirement: "auto_deny", description: "External requests" },
  ]);

  // ── Load MCP servers on mount ────────────────────────────
  onMount(async () => {
    try {
      const servers = await mcpListServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("[MCP] Failed to load servers:", err);
    }
  });

  const sessionState = createMemo((): SessionState => {
    if (sessionRunning()) return "running";
    if (sessionError()) return "error";
    return "idle";
  });

  // ── Start IPC event listener on mount ────────────────────
  onMount(async () => {
    const appendAssistantText = (sessionId: string, text: string, isComplete: boolean) => {
      if (!text && !isComplete) return;
      if (activeSessionId() !== sessionId) return;

      if (!text && isComplete) {
        return;
      }

      setChunks((prev) => {
        const next = [...prev];
        const last = next.at(-1);
        if (last?.kind === "assistant") {
          last.text += text;
          return next;
        }
        next.push({ kind: "assistant", text });
        return next;
      });
    };

    const trackToolStart = (sessionId: string, event: AgentToolStartEvent) => {
      if (activeSessionId() !== sessionId) return;
      setChunks((prev) => {
        const next = [...prev];
        const existing = next.find(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (!existing) {
          next.push({
            kind: "tool_call",
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            result: null,
            status: "running",
          });
        }
        return next;
      });
    };

    const trackToolResult = (sessionId: string, event: AgentToolResultEvent) => {
      if (activeSessionId() !== sessionId) return;
      setChunks((prev) => {
        const next = [...prev];
        const existing = next.find(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (existing) {
          existing.result = event.content;
          existing.status = event.isError ? "error" : "done";
          return next;
        }
        next.push({
          kind: "tool_call",
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          result: event.content,
          status: event.isError ? "error" : "done",
        });
        return next;
      });
    };

    const unlisten = await onAgentEvent((event) => {
      switch (event.type) {
        case "text_delta": {
          const e = event.data as AgentTextDeltaEvent;
          appendAssistantText(e.sessionId, e.text, e.isComplete);
          break;
        }

        case "turn_complete": {
          const e = event.data as AgentTurnCompleteEvent;
          console.log("[IPC] turn_complete", e.sessionId, e.stopReason);
          setSessionRunning(false);
          void reloadHistory(e.sessionId, {
            fallbackAssistantText: e.assistantMessage,
            afterTurnComplete: true,
          });
          break;
        }

        case "error": {
          const e = event.data as AgentErrorEvent;
          console.error("[IPC] error", e.sessionId, e.error);
          setSessionRunning(false);
          if (!e.cancelled) setSessionError(e.error);
          break;
        }

        case "approval_needed": {
          const e = event.data as AgentApprovalNeededEvent;
          console.log("[IPC] approval_needed", e.approvalId, e.toolName);
          setApprovals((prev) => [
            ...prev,
            {
              sessionId: e.sessionId,
              approvalId: e.approvalId,
              toolName: e.toolName,
              description: e.description,
              target: e.target,
            },
          ]);
          break;
        }

        case "tool_start": {
          const e = event.data as AgentToolStartEvent;
          trackToolStart(e.sessionId, e);
          break;
        }

        case "tool_result": {
          const e = event.data as AgentToolResultEvent;
          trackToolResult(e.sessionId, e);
          break;
        }
      }
    });

    onCleanup(() => unlisten());
  });

  // ── Reload session history from Rust storage ─────────────
  const reloadHistory = async (
    sessionId: string,
    opts?: { fallbackAssistantText?: string; afterTurnComplete?: boolean },
  ) => {
    try {
      const res = await getSessionHistory({ sessionId });
      let next = chunksFromHistory(res.messages);
      const hasAssistantText = next.some(
        (c) => c.kind === "assistant" && c.text.trim().length > 0,
      );
      const fb = opts?.fallbackAssistantText?.trim();
      if (!hasAssistantText && fb) {
        next = [...next, { kind: "assistant" as const, text: fb }];
      }
      setChunks(next);
      const idle = opts?.afterTurnComplete || !res.running;
      setSessionRunning(!idle);
      if (idle) setSessionError(null);
    } catch (err) {
      console.error("[IPC] load history failed", err);
      const fb = opts?.fallbackAssistantText?.trim();
      if (fb) {
        setChunks((prev) => [...prev, { kind: "assistant", text: fb }]);
      }
      if (opts?.afterTurnComplete) setSessionRunning(false);
    }
  };

  // ── Send a prompt (starts agent session) ─────────────────
  const handleSend = async (text: string) => {
    setSessionError(null);
    setApprovals([]);

    // Optimistic user message
    setChunks((prev) => [...prev, { kind: "user" as const, text }]);

    try {
      const sessionId = await startAgent({
        goal: text,
        files: [],
      });
      setActiveSessionId(sessionId);
      setSessionIds((prev) => [...prev, sessionId]);
      setSessionRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
      setSessionRunning(false);
    }
  };

  // ── Approval responses ───────────────────────────────────
  const handleApprove = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleReject = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: false });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  // ── Cancel ───────────────────────────────────────────────
  const handleCancel = async () => {
    const sid = activeSessionId();
    if (!sid) return;
    try {
      await cancelAgent({ sessionId: sid });
      setSessionRunning(false);
    } catch (err) {
      console.error("[IPC] cancel failed", err);
    }
  };

  // ── Select a session from sidebar ────────────────────────
  const selectSession = (id: string) => {
    setActiveSessionId(id);
    setSessionError(null);
    void reloadHistory(id);
  };

  return (
    <div
      class="grid h-screen overflow-hidden"
      style={{
        "grid-template-rows": "auto 1fr auto",
        "grid-template-columns": "260px 1fr 300px",
        background: "var(--ra-surface)",
      }}
    >
      {/* Header */}
      <header
        class={`col-span-full flex items-center gap-2 px-4 py-2 border-b ${C.border} ${C.surfaceElevated}`}
      >
        <span class="font-bold text-sm tracking-wide">Relay Agent</span>
        <div class="flex-1" />
        <StatusDot status={sessionRunning() ? "connecting" : "connected"} label="Copilot" />
        <button
          class={`px-3 py-1 text-xs rounded-full border ${C.border} ${C.mutedText} ${C.hover} transition-colors`}
        >
          ⚙ Settings
        </button>
      </header>

      {/* 3-pane body */}
      <Sidebar
        sessionIds={sessionIds()}
        activeSessionId={activeSessionId()}
        onSelect={selectSession}
      />

      {/* Main — feed + composer */}
      <main class="overflow-y-auto flex-1 flex-col relative">
        <Show when={sessionError()}>
          <div
            role="alert"
            data-ra-session-error
            class={`shrink-0 px-6 py-2 text-xs border-b ${C.border} ${C.surfaceElevated} text-[var(--ra-red)] whitespace-pre-wrap break-words`}
          >
            {sessionError()}
          </div>
        </Show>
        <MessageFeed chunks={chunks()} sessionState={sessionState()} />
        <Composer
          onSend={handleSend}
          disabled={sessionRunning()}
          running={sessionRunning()}
          onCancel={handleCancel}
          onSlashCommand={(input) => {
            const ctx: SlashCommandContext = {
              sessionId: activeSessionId(),
              clearChunks: () => setChunks([]),
              compactSession: (sid) => compactAgentSession({ sessionId: sid }),
              sessionRunning: sessionRunning(),
              chunksCount: chunks().length,
            };
            return executeSlashCommand(input, ctx);
          }}
          onAppendAssistant={(text: string) => {
            setChunks((prev) => [...prev, { kind: "assistant", text }]);
          }}
        />
        <ApprovalOverlay
          approvals={approvals()}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </main>

      <ContextPanel
        contextFiles={contextFiles}
        setContextFiles={setContextFiles}
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        policies={policies}
      />

      {/* Footer */}
      <div class="col-span-full">
        <StatusBar sessionState={sessionState()} sessionCount={sessionIds().length} />
      </div>
    </div>
  );
}
