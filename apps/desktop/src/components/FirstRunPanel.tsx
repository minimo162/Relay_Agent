import { createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
import type { SessionPreset } from "../lib/ipc";
import { sessionModeLabel, sessionModeSummary } from "../lib/session-mode-label";
import { copilotWarmupStageDetail, type CopilotWarmupState } from "../shell/useCopilotWarmup";
import { Button } from "./ui";

function StartItem(props: {
  label: string;
  value: string;
  detail: string;
  state: "good" | "warn" | "neutral";
  technicalDetail?: string | null;
}) {
  return (
    <div class="ra-preflight-item">
      <p class={`ra-type-system-micro ${ui.mutedText}`}>{props.label}</p>
      <p class={`ra-type-button-label mt-1 ${ui.textPrimary}`}>{props.value}</p>
      <p class={`ra-type-caption mt-1 ${
        props.state === "good"
          ? "text-[var(--ra-green)]"
          : props.state === "warn"
            ? "text-[var(--ra-red)]"
            : ui.textMuted
      }`}>{props.detail}</p>
      {props.technicalDetail ? (
        <details class="mt-2">
          <summary class={`ra-type-caption ${ui.mutedText} cursor-pointer`}>Details</summary>
          <p class={`ra-type-mono-small mt-1 ${ui.mutedText}`}>{props.technicalDetail}</p>
        </details>
      ) : null}
    </div>
  );
}

export function FirstRunPanel(props: {
  workspacePath: () => string;
  onOpenSettings: () => void;
  onReconnectCopilot: () => void;
  sessionPreset: SessionPreset;
  copilotState: CopilotWarmupState;
  children: JSX.Element;
}): JSX.Element {
  const workspace = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => workspace().length > 0);
  const workspaceName = createMemo(() =>
    hasWorkspace() ? workspaceBasename(workspace()) : "Not selected",
  );
  const workspaceHint = createMemo(() =>
    hasWorkspace()
      ? ellipsisPath(workspace(), 72)
      : "Open settings and choose the folder Relay should inspect and edit.",
  );
  const connectionReady = createMemo(
    () => props.copilotState.result?.connected || props.copilotState.status === "ready",
  );
  const copilotStageDetail = createMemo(() => copilotWarmupStageDetail(props.copilotState));
  const connectionStatus = createMemo(() => {
    if (props.copilotState.status === "checking") return "Checking";
    if (connectionReady()) return "Ready";
    return "Needs setup";
  });
  const connectionDetail = createMemo(() => {
    if (props.copilotState.status === "checking") {
      return "Relay is checking the browser connection now.";
    }
    if (connectionReady()) {
      return "Copilot is ready in this app.";
    }
    if (props.copilotState.status === "needs_sign_in") {
      return "Open Settings, sign in to Copilot in Edge, then reconnect.";
    }
    return "Open Settings to review the connection, then try reconnecting.";
  });
  const connectionTechnicalDetail = createMemo(() => {
    const stage = copilotStageDetail();
    const message = props.copilotState.message?.trim() || null;
    if (stage && message && stage !== message) {
      return `${message} | ${stage}`;
    }
    return stage ?? message;
  });
  const showReconnect = createMemo(
    () => props.copilotState.status !== "checking" && !connectionReady(),
  );

  return (
    <section class="ra-first-run" aria-label="Get started">
      <div class="ra-first-run__panel">
        <div class="ra-first-run__lead">
          <p class="ra-empty-state__eyebrow">Relay Agent</p>
          <h1 class={`ra-type-section-heading ${ui.textPrimary}`}>Tell Relay what you need</h1>
          <p class={`ra-type-body-sans ${ui.textSecondary}`}>
            Start in three steps so Relay knows your project, your connection is ready, and your first request is clear.
          </p>
          <ol class="ra-first-run__steps">
            <li>Choose a project folder.</li>
            <li>Confirm the Copilot connection.</li>
            <li>Describe the outcome you want.</li>
          </ol>
        </div>

        <div class="ra-first-run__request ra-first-run__request--primary">
          <div class="min-w-0">
            <p class={`ra-type-system-micro ${ui.mutedText}`}>First request</p>
            <p class={`ra-type-title-sm ${ui.textPrimary} mt-1`}>Start with the outcome you want</p>
            <p class={`ra-type-caption ${ui.mutedText} mt-1`}>
              Be direct about the result, then let Relay inspect the code and choose the next steps.
            </p>
            <div class="ra-first-run__example">
              <span class={`ra-type-system-micro ${ui.mutedText}`}>Example</span>
              <p class={`ra-type-body-sans ${ui.textPrimary} mt-1`}>
                Summarize this repo and propose the smallest fix for the failing flow.
              </p>
            </div>
            <p class="ra-first-run__mode-note">
              New conversations start in {sessionModeLabel(props.sessionPreset)}. {sessionModeSummary(props.sessionPreset)}
            </p>
          </div>
          {props.children}
        </div>

        <div class="ra-first-run__preflight">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p class={`ra-type-system-micro ${ui.mutedText}`}>Start here</p>
              <p class={`ra-type-title-sm ${ui.textPrimary} mt-1`}>Confirm the basics, then send your first request</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="primary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
                Open Settings
              </Button>
              {showReconnect() ? (
                <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
                  Reconnect Copilot
                </Button>
              ) : null}
            </div>
          </div>

          <div class="ra-preflight-grid">
            <StartItem
              label="Project folder"
              value={hasWorkspace() ? workspaceName() : "Not selected"}
              detail={workspaceHint()}
              state={hasWorkspace() ? "good" : "warn"}
            />
            <StartItem
              label="Copilot connection"
              value={connectionStatus()}
              detail={connectionDetail()}
              technicalDetail={connectionTechnicalDetail()}
              state={connectionReady() ? "good" : props.copilotState.status === "checking" ? "neutral" : "warn"}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
