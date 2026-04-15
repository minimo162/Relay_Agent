import { createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
import type { SessionPreset } from "../lib/ipc";
import { sessionModeLabel } from "../lib/session-mode-label";
import { type CopilotWarmupState } from "../shell/useCopilotWarmup";
import { Button } from "./ui";

function StepStatusBadge(props: {
  label: string;
  state: "good" | "warn" | "neutral";
}) {
  return (
    <span
      class={`ra-first-run__status-badge ra-type-system-micro ${
        props.state === "good"
          ? "ra-first-run__status-badge--good"
          : props.state === "warn"
            ? "ra-first-run__status-badge--warn"
            : "ra-first-run__status-badge--neutral"
      }`}
    >
      {props.label}
    </span>
  );
}

function SetupRow(props: {
  step: string;
  label: string;
  statusLabel: string;
  statusState: "good" | "warn" | "neutral";
  summary: string;
  detail: string;
  action: JSX.Element;
}) {
  return (
    <div class="ra-first-run__setup-row">
      <div class="ra-first-run__setup-row-main">
        <div class="ra-first-run__setup-row-topline">
          <span class="ra-first-run__step-kicker">{props.step}</span>
          <span class={`ra-type-button-label ${ui.textPrimary}`}>{props.label}</span>
        </div>
        <div class="ra-first-run__setup-row-copy">
          <p class={`ra-type-body-sans ${ui.textPrimary}`}>{props.summary}</p>
          <p class={`ra-type-caption ${ui.mutedText}`}>{props.detail}</p>
        </div>
      </div>
      <div class="ra-first-run__setup-row-side">
        <StepStatusBadge label={props.statusLabel} state={props.statusState} />
        {props.action}
      </div>
    </div>
  );
}

export function FirstRunPanel(props: {
  workspacePath: () => string;
  onOpenSettings: () => void;
  onReconnectCopilot: () => void;
  sessionPreset: SessionPreset;
  copilotState: CopilotWarmupState;
  canStart: boolean;
  startDisabledReason: string | null;
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
      : "Choose the project Relay should work in.",
  );
  const connectionReady = createMemo(
    () => props.copilotState.result?.connected || props.copilotState.status === "ready",
  );
  const modeLabel = createMemo(() => sessionModeLabel(props.sessionPreset));
  const connectionStatus = createMemo(() => {
    if (props.copilotState.status === "checking") return "Checking";
    if (connectionReady()) return "Ready";
    return "Needs setup";
  });
  const connectionDetail = createMemo(() => {
    if (props.copilotState.status === "checking") {
      return "Relay is checking the Copilot connection now.";
    }
    if (connectionReady()) {
      return "Copilot is ready in this app.";
    }
    if (props.copilotState.status === "needs_sign_in") {
      return "Open Settings, sign in to Copilot in Edge, then reconnect.";
    }
    return "Open Settings to review the connection, then try again.";
  });
  const showReconnect = createMemo(
    () => props.copilotState.status !== "checking" && !connectionReady(),
  );
  const requestSummary = createMemo(() => {
    if (props.canStart) {
      return "Describe the result you need, then send the first request.";
    }
    return "Finish the setup above before sending the first request.";
  });
  const requestDetail = createMemo(() =>
    props.startDisabledReason
      ?? `The first chat starts in ${modeLabel()} so Relay can work in the project right away.`,
  );
  const connectionAction = createMemo<JSX.Element>(() => {
    if (props.copilotState.status === "needs_sign_in" || props.copilotState.status === "checking") {
      return (
        <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
          Open Settings
        </Button>
      );
    }
    if (showReconnect()) {
      return (
        <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
          Reconnect Copilot
        </Button>
      );
    }
    return (
      <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
        Review Settings
      </Button>
    );
  });

  return (
    <section class="ra-first-run" aria-label="Get started">
      <div class="ra-first-run__panel">
        <div class="ra-first-run__card">
          <div class="ra-first-run__intro">
            <p class="ra-empty-state__eyebrow">Relay Agent</p>
            <h1 class={`ra-type-section-heading ${ui.textPrimary}`}>Set the project and Copilot, then send the first request</h1>
            <p class={`ra-type-body-sans ${ui.textSecondary}`}>
              Start with one clear path so Relay has the right project and a ready Copilot connection.
            </p>
            <ol class="ra-first-run__progress" aria-label="First-run steps">
              <li class="ra-first-run__progress-item">
                <span class="ra-first-run__progress-number">1</span>
                <span>Project</span>
              </li>
              <li class="ra-first-run__progress-item">
                <span class="ra-first-run__progress-number">2</span>
                <span>Copilot</span>
              </li>
              <li class="ra-first-run__progress-item">
                <span class="ra-first-run__progress-number">3</span>
                <span>Request</span>
              </li>
            </ol>
          </div>

          <section class="ra-first-run__readiness" aria-label="Setup before the first request">
            <div class="ra-first-run__readiness-header">
              <div>
                <p class="ra-first-run__step-kicker">Ready before you send</p>
                <h2 class={`ra-type-title-sm ${ui.textPrimary}`}>Check the two requirements</h2>
              </div>
            </div>

            <SetupRow
              step="Step 1"
              label="Project"
              statusLabel={hasWorkspace() ? "Ready" : "Needs setup"}
              statusState={hasWorkspace() ? "good" : "warn"}
              summary={
                hasWorkspace()
                  ? `Relay is pointed at ${workspaceName()}.`
                  : "Choose the folder Relay should read and update."
              }
              detail={workspaceHint()}
              action={
                <Button variant="primary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
                  {hasWorkspace() ? "Change project" : "Choose project"}
                </Button>
              }
            />

            <SetupRow
              step="Step 2"
              label="Copilot"
              statusLabel={connectionStatus()}
              statusState={connectionReady() ? "good" : props.copilotState.status === "checking" ? "neutral" : "warn"}
              summary={
                connectionReady()
                  ? "Copilot is ready."
                  : props.copilotState.status === "checking"
                    ? "Relay is checking the connection now."
                    : "Copilot needs to be ready before Relay can complete the first request."
              }
              detail={connectionDetail()}
              action={connectionAction()}
            />
          </section>

          <section class="ra-first-run__request-card" aria-label="First request">
            <div class="ra-first-run__request-header">
              <div>
                <p class="ra-first-run__step-kicker">Step 3</p>
                <h2 class={`ra-type-title-sm ${ui.textPrimary}`}>First request</h2>
              </div>
              <StepStatusBadge label={`Default: ${modeLabel()}`} state={props.canStart ? "good" : "neutral"} />
            </div>
            <p class={`ra-type-body-sans ${ui.textPrimary}`}>{requestSummary()}</p>
            <p class={`ra-type-caption ${ui.mutedText}`}>{requestDetail()}</p>
            <div class="ra-first-run__request-composer">{props.children}</div>
          </section>
        </div>
      </div>
    </section>
  );
}
