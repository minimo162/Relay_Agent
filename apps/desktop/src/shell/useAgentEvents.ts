import { onCleanup, onMount, type Accessor } from "solid-js";
import {
  onAgentEvent,
  type AgentApprovalNeededEvent,
  type AgentErrorEvent,
  type AgentSessionStatusEvent,
  type AgentTextDeltaEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type AgentTurnCompleteEvent,
  type AgentUserQuestionNeededEvent,
  type UiChunk,
} from "../lib/ipc";
import type { Approval, SessionStatusSnapshot, UserQuestion } from "../components/shell-types";
import { buildPlanTimelineFromUiChunks, parseTodoWriteToolResult, type PlanTimelineEntry } from "../context/todo-write-parse";

type Setter<T> = (value: T | ((prev: T) => T)) => void;

interface UseAgentEventsOptions {
  activeSessionId: Accessor<string | null>;
  setChunks: Setter<UiChunk[]>;
  setPlanBySession: Setter<Record<string, PlanTimelineEntry[]>>;
  setStatusBySession: Setter<Record<string, SessionStatusSnapshot>>;
  setApprovals: Setter<Approval[]>;
  setUserQuestions: Setter<UserQuestion[]>;
  setSessionError: Setter<string | null>;
  reloadHistory: (
    sessionId: string,
    opts?: { fallbackAssistantText?: string; afterTurnComplete?: boolean },
  ) => Promise<void>;
}

export function useAgentEvents(options: UseAgentEventsOptions) {
  onMount(async () => {
    const appendAssistantText = (sessionId: string, text: string, isComplete: boolean) => {
      if (!text && !isComplete) return;
      if (options.activeSessionId() !== sessionId) return;
      if (!text && isComplete) return;

      options.setChunks((prev) => {
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
      if (options.activeSessionId() !== sessionId) return;
      options.setChunks((prev) => {
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
            input: (event.input ?? {}) as Record<string, unknown>,
            result: null,
            status: "running",
          });
        }
        return next;
      });
    };

    const trackToolResult = (sessionId: string, event: AgentToolResultEvent) => {
      if (event.toolName === "TodoWrite" && !event.isError) {
        const todos = parseTodoWriteToolResult(event.content);
        if (todos?.length) {
          options.setPlanBySession((prev) => {
            const cur = prev[sessionId] ?? [];
            if (cur.some((e) => e.toolUseId === event.toolUseId)) return prev;
            const entry: PlanTimelineEntry = {
              toolUseId: event.toolUseId,
              atMs: Date.now(),
              todos,
            };
            return { ...prev, [sessionId]: [...cur, entry] };
          });
        }
      }

      if (options.activeSessionId() !== sessionId) return;
      options.setChunks((prev) => {
        const idx = prev.findIndex(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (idx === -1) {
          return [
            ...prev,
            {
              kind: "tool_call",
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              input: {},
              result: event.content,
              status: event.isError ? "error" : "done",
            },
          ];
        }
        const cur = prev[idx] as Extract<UiChunk, { kind: "tool_call" }>;
        const next = [...prev];
        next[idx] = {
          kind: "tool_call",
          toolUseId: cur.toolUseId,
          toolName: cur.toolName,
          input: cur.input,
          result: event.content,
          status: event.isError ? "error" : "done",
        };
        return next;
      });
    };

    const unlisten = await onAgentEvent((event) => {
      switch (event.type) {
        case "status": {
          const e = event.data as AgentSessionStatusEvent;
          options.setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: {
              phase: e.phase,
              attempt: e.attempt ?? undefined,
              message: e.message ?? undefined,
              nextRetryAtMs: e.nextRetryAtMs ?? undefined,
              toolName: e.toolName ?? undefined,
              stopReason: e.stopReason ?? undefined,
            },
          }));
          if (e.phase === "idle" && e.stopReason !== "cancelled") {
            options.setSessionError(null);
          }
          break;
        }
        case "text_delta": {
          const e = event.data as AgentTextDeltaEvent;
          appendAssistantText(e.sessionId, e.text, e.isComplete);
          break;
        }
        case "turn_complete": {
          const e = event.data as AgentTurnCompleteEvent;
          options.setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: { phase: "idle", stopReason: e.stopReason },
          }));
          void options.reloadHistory(e.sessionId, {
            fallbackAssistantText: e.assistantMessage,
            afterTurnComplete: true,
          });
          break;
        }
        case "error": {
          const e = event.data as AgentErrorEvent;
          options.setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: prev[e.sessionId] ?? { phase: "idle" },
          }));
          if (!e.cancelled) options.setSessionError(e.error);
          break;
        }
        case "approval_needed": {
          const e = event.data as AgentApprovalNeededEvent;
          options.setApprovals((prev) => [
            ...prev,
            {
              sessionId: e.sessionId,
              approvalId: e.approvalId,
              toolName: e.toolName,
              description: e.description,
              target: e.target ?? undefined,
              workspaceCwdConfigured: Boolean(e.workspaceCwdConfigured),
            },
          ]);
          break;
        }
        case "user_question": {
          const e = event.data as AgentUserQuestionNeededEvent;
          options.setUserQuestions((prev) => [
            ...prev,
            {
              sessionId: e.sessionId,
              questionId: e.questionId,
              prompt: e.prompt,
            },
          ]);
          break;
        }
        case "tool_start":
          trackToolStart((event.data as AgentToolStartEvent).sessionId, event.data as AgentToolStartEvent);
          break;
        case "tool_result":
          trackToolResult((event.data as AgentToolResultEvent).sessionId, event.data as AgentToolResultEvent);
          break;
      }
    });

    onCleanup(() => unlisten());
  });
}
