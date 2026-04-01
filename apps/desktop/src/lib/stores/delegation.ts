import { derived, writable } from "svelte/store";

import type { ExecutionPlan } from "@relay-agent/contracts";

export type DelegationState =
  | "idle"
  | "goal_entered"
  | "planning"
  | "plan_review"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "error";

export type ActivityEventType =
  | "goal_set"
  | "file_attached"
  | "copilot_turn"
  | "tool_executed"
  | "plan_proposed"
  | "plan_approved"
  | "write_approval_requested"
  | "write_approved"
  | "step_completed"
  | "error"
  | "completed";

export type ActivityFeedEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  message: string;
  icon: string;
  badgeLabel?: string;
  detail?: string;
  expandable?: boolean;
  actionRequired?: boolean;
};

export type DelegationStoreState = {
  state: DelegationState;
  goal: string;
  attachedFiles: string[];
  plan: ExecutionPlan | null;
  currentStepIndex: number;
  error: string | null;
};

const DEFAULT_STATE: DelegationStoreState = {
  state: "idle",
  goal: "",
  attachedFiles: [],
  plan: null,
  currentStepIndex: -1,
  error: null
};
const MAX_ACTIVITY_EVENTS = 200;

function createDelegationStore() {
  const { subscribe, set, update } = writable<DelegationStoreState>(DEFAULT_STATE);

  return {
    subscribe,
    setGoal(goal: string, files: string[]) {
      update((state) => ({
        ...state,
        state: "goal_entered",
        goal,
        attachedFiles: files
      }));
    },
    startPlanning() {
      update((state) => ({ ...state, state: "planning", error: null }));
    },
    proposePlan(plan: ExecutionPlan) {
      update((state) => ({ ...state, state: "plan_review", plan }));
    },
    approvePlan() {
      update((state) => ({ ...state, state: "executing", currentStepIndex: 0 }));
    },
    advanceStep() {
      update((state) => ({
        ...state,
        currentStepIndex: state.currentStepIndex + 1
      }));
    },
    requestApproval() {
      update((state) => ({ ...state, state: "awaiting_approval" }));
    },
    resumeExecution() {
      update((state) => ({ ...state, state: "executing" }));
    },
    complete() {
      update((state) => ({ ...state, state: "completed" }));
    },
    setError(error: string) {
      update((state) => ({ ...state, state: "error", error }));
    },
    hydrate(snapshot: Partial<DelegationStoreState>) {
      set({
        ...DEFAULT_STATE,
        ...snapshot
      });
    },
    reset() {
      set(DEFAULT_STATE);
    }
  };
}

function createActivityFeedStore() {
  const { subscribe, set, update } = writable<ActivityFeedEvent[]>([]);

  return {
    subscribe,
    push(event: Omit<ActivityFeedEvent, "id" | "timestamp">) {
      update((events) => {
        const next = [
          ...events,
          {
            ...event,
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString()
          }
        ];
        return next.length > MAX_ACTIVITY_EVENTS
          ? next.slice(-MAX_ACTIVITY_EVENTS)
          : next;
      });
    },
    hydrate(snapshot: ActivityFeedEvent[]) {
      set(snapshot.slice(-MAX_ACTIVITY_EVENTS));
    },
    clear() {
      set([]);
    }
  };
}

export const delegationStore = createDelegationStore();
export const activityFeedStore = createActivityFeedStore();

export const requiresIntervention = derived(delegationStore, ($state) =>
  $state.state === "plan_review" ||
  $state.state === "awaiting_approval" ||
  $state.state === "error"
);
