import { createMemo, createSignal } from "solid-js";
import type { SessionMeta } from "../session/session-display";
import type { SessionStatusSnapshot } from "../components/shell-types";
import type { PlanTimelineEntry } from "../context/todo-write-parse";
import type { UiChunk } from "../lib/ipc";

export function createSessionStore() {
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [sessionIds, setSessionIds] = createSignal<string[]>([]);
  const [sessionMeta, setSessionMeta] = createSignal<Record<string, SessionMeta>>({});
  const [statusBySession, setStatusBySession] = createSignal<Record<string, SessionStatusSnapshot>>({});
  const [chunks, setChunks] = createSignal<UiChunk[]>([]);
  const [planBySession, setPlanBySession] = createSignal<Record<string, PlanTimelineEntry[]>>({});

  const sessionEntries = createMemo(() =>
    sessionIds().map((id) => ({ id, meta: sessionMeta()[id], status: statusBySession()[id] })),
  );

  const activeSessionStatus = createMemo<SessionStatusSnapshot>(() => {
    const sid = activeSessionId();
    if (!sid) return { phase: "idle" };
    return statusBySession()[sid] ?? { phase: "idle" };
  });

  const planTimelineForActiveSession = createMemo(() => {
    const id = activeSessionId();
    if (!id) return [];
    return planBySession()[id] ?? [];
  });

  const isFirstRun = createMemo(
    () => sessionIds().length === 0 && chunks().length === 0 && activeSessionId() === null,
  );

  return {
    activeSessionId,
    setActiveSessionId,
    sessionIds,
    setSessionIds,
    sessionMeta,
    setSessionMeta,
    statusBySession,
    setStatusBySession,
    chunks,
    setChunks,
    planBySession,
    setPlanBySession,
    sessionEntries,
    activeSessionStatus,
    planTimelineForActiveSession,
    isFirstRun,
  };
}
