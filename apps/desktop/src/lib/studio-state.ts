import { derived, get, writable, type Readable, type Writable } from "svelte/store";

type RelayMode = "discover" | "plan" | "repair" | "followup";

export type StudioTimelineTone = "pending" | "active" | "ready";

export type StudioTimelineEntry = {
  id: string;
  label: string;
  note: string;
  tone: StudioTimelineTone;
};

export type StudioWorkbookSummary = {
  sourceLabel: string;
  focusLabel: string;
  diffHeadline: string;
  diffDetail: string;
  warnings: string[];
};

export type StudioWorkflowStatus = {
  packetReady: boolean;
  validationReady: boolean;
  previewReady: boolean;
};

export type StudioState = {
  selectedSessionId: string | null;
  turnTitle: string;
  turnObjective: string;
  relayMode: RelayMode;
  workbookPath: string;
  workbookFocus: string;
  packetDraft: string;
  rawResponse: string;
  validationNote: string;
  previewNote: string;
  diffHeadline: string;
  previewWarnings: string[];
};

type StudioStateModel = {
  state: Writable<StudioState>;
  timeline: Readable<StudioTimelineEntry[]>;
  workbookSummary: Readable<StudioWorkbookSummary>;
  workflowStatus: Readable<StudioWorkflowStatus>;
  setSession: (sessionId: string | null | undefined) => void;
  updateTurnTitle: (value: string) => void;
  updateTurnObjective: (value: string) => void;
  updateRelayMode: (value: RelayMode) => void;
  updateWorkbookPath: (value: string) => void;
  updateWorkbookFocus: (value: string) => void;
  updateRawResponse: (value: string) => void;
  composePacketDraft: () => void;
  stageValidation: () => void;
  stagePreview: () => void;
  resetDraft: () => void;
};

function createInitialState(sessionId?: string | null): StudioState {
  return {
    selectedSessionId: sessionId ?? null,
    turnTitle: "",
    turnObjective: "",
    relayMode: "plan",
    workbookPath: "",
    workbookFocus: "Sheet1",
    packetDraft: "",
    rawResponse: "",
    validationNote: "",
    previewNote: "",
    diffHeadline: "",
    previewWarnings: []
  };
}

function summarizeSessionId(sessionId: string | null): string {
  if (!sessionId) {
    return "No session has been selected yet.";
  }

  return `Session ${sessionId.slice(0, 8)} is staged for the Studio draft flow.`;
}

function composePacketText(state: StudioState): string {
  return [
    `Mode: ${state.relayMode}`,
    `Turn: ${state.turnTitle || "Untitled draft"}`,
    `Objective: ${state.turnObjective || "Add a turn objective to continue."}`,
    `Workbook focus: ${state.workbookFocus || "Sheet1"}`
  ].join("\n");
}

function composeValidationText(state: StudioState): string {
  if (!state.rawResponse.trim()) {
    return "Paste a Copilot response draft before staging validation feedback.";
  }

  return [
    "Local validation draft staged.",
    `Characters captured: ${state.rawResponse.trim().length}.`,
    "Backend parsing and repair prompts will replace this placeholder in task 6.4."
  ].join(" ");
}

function composePreviewState(state: StudioState): Pick<
  StudioState,
  "previewNote" | "diffHeadline" | "previewWarnings"
> {
  const warnings = [
    "Preview is local-only until backend packet and diff wiring land.",
    "Original workbook inputs remain read-only."
  ];

  return {
    previewNote: state.turnObjective
      ? `Preview draft is scoped to "${state.turnObjective}" in ${state.workbookFocus || "Sheet1"}.`
      : "Add a turn objective before staging preview notes.",
    diffHeadline: state.turnTitle
      ? `Draft diff for ${state.turnTitle}`
      : "Draft diff preview will appear here.",
    previewWarnings: warnings
  };
}

export function createStudioState(initialSessionId?: string | null): StudioStateModel {
  const state = writable<StudioState>(createInitialState(initialSessionId));

  const workflowStatus = derived(state, ($state) => ({
    packetReady: Boolean($state.packetDraft.trim()),
    validationReady: Boolean($state.validationNote.trim()),
    previewReady: Boolean($state.previewNote.trim())
  }));

  const timeline = derived(state, ($state): StudioTimelineEntry[] => [
    {
      id: "session",
      label: "Session handoff",
      note: summarizeSessionId($state.selectedSessionId),
      tone: $state.selectedSessionId ? "ready" : "pending"
    },
    {
      id: "turn",
      label: "Turn draft",
      note:
        $state.turnTitle.trim() || $state.turnObjective.trim()
          ? `${$state.turnTitle || "Untitled"} is being shaped in ${$state.relayMode} mode.`
          : "Add a turn title and objective in the workflow pane.",
      tone:
        $state.turnTitle.trim() && $state.turnObjective.trim()
          ? "ready"
          : $state.turnTitle.trim() || $state.turnObjective.trim()
            ? "active"
            : "pending"
    },
    {
      id: "packet",
      label: "Packet draft",
      note: $state.packetDraft.trim()
        ? "A local packet outline is staged for backend wiring."
        : "Compose a packet outline once the turn draft is in place.",
      tone: $state.packetDraft.trim() ? "ready" : "pending"
    },
    {
      id: "response",
      label: "Pasted response",
      note: $state.rawResponse.trim()
        ? "Response text is captured locally and ready for parser wiring."
        : "Paste a response draft in the workflow pane to continue.",
      tone: $state.rawResponse.trim() ? "ready" : "pending"
    },
    {
      id: "validation",
      label: "Validation notes",
      note: $state.validationNote.trim()
        ? $state.validationNote
        : "Validation feedback will appear here before backend parsing is connected.",
      tone: $state.validationNote.trim() ? "ready" : "pending"
    },
    {
      id: "preview",
      label: "Preview brief",
      note: $state.previewNote.trim()
        ? $state.previewNote
        : "Preview notes and diff summary stay local until command wiring lands.",
      tone: $state.previewNote.trim() ? "ready" : "pending"
    }
  ]);

  const workbookSummary = derived(state, ($state) => ({
    sourceLabel: $state.workbookPath.trim()
      ? $state.workbookPath.trim()
      : "No workbook path has been staged yet.",
    focusLabel: $state.workbookFocus.trim() || "Sheet1",
    diffHeadline: $state.diffHeadline.trim()
      ? $state.diffHeadline
      : "Diff preview has not been staged yet.",
    diffDetail: $state.previewNote.trim()
      ? $state.previewNote
      : "The right pane will show workbook summary, diff context, and output warnings once preview state is staged.",
    warnings: $state.previewWarnings.length
      ? $state.previewWarnings
      : ["Preview warnings will appear here once the local draft is staged."]
  }));

  function update(mutator: (current: StudioState) => StudioState): void {
    state.update((current) => mutator(current));
  }

  return {
    state,
    timeline,
    workbookSummary,
    workflowStatus,
    setSession(sessionId) {
      const nextSessionId = sessionId ?? null;
      const current = get(state);

      if (current.selectedSessionId === nextSessionId) {
        return;
      }

      state.set(createInitialState(nextSessionId));
    },
    updateTurnTitle(value) {
      update((current) => ({ ...current, turnTitle: value }));
    },
    updateTurnObjective(value) {
      update((current) => ({ ...current, turnObjective: value }));
    },
    updateRelayMode(value) {
      update((current) => ({ ...current, relayMode: value }));
    },
    updateWorkbookPath(value) {
      update((current) => ({ ...current, workbookPath: value }));
    },
    updateWorkbookFocus(value) {
      update((current) => ({ ...current, workbookFocus: value }));
    },
    updateRawResponse(value) {
      update((current) => ({ ...current, rawResponse: value }));
    },
    composePacketDraft() {
      update((current) => ({
        ...current,
        packetDraft: composePacketText(current)
      }));
    },
    stageValidation() {
      update((current) => ({
        ...current,
        validationNote: composeValidationText(current)
      }));
    },
    stagePreview() {
      update((current) => ({
        ...current,
        ...composePreviewState(current)
      }));
    },
    resetDraft() {
      const current = get(state);
      state.set(createInitialState(current.selectedSessionId));
    }
  };
}
