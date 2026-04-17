import { createEffect, createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
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
  label: string;
  statusLabel: string;
  statusState: "good" | "warn" | "neutral";
  summary: string;
  detail: string;
  action?: JSX.Element;
}) {
  return (
    <div class="ra-first-run__setup-row">
      <div class="ra-first-run__setup-row-main">
        <div class="ra-first-run__setup-row-topline">
          <span class={`ra-type-button-label ${ui.textPrimary}`}>{props.label}</span>
          <StepStatusBadge label={props.statusLabel} state={props.statusState} />
        </div>
        <div class="ra-first-run__setup-row-copy">
          <p class={`ra-type-body-sans ${ui.textPrimary}`}>{props.summary}</p>
          <p class={`ra-type-caption ${ui.mutedText}`}>{props.detail}</p>
        </div>
      </div>
      {props.action ? <div class="ra-first-run__setup-row-side">{props.action}</div> : null}
    </div>
  );
}

export function FirstRunPanel(props: {
  workspacePath: () => string;
  onChooseProject: () => void;
  onReconnectCopilot: () => void;
  copilotState: CopilotWarmupState;
  showRequirements: boolean;
  missingProject: boolean;
  missingCopilot: boolean;
}): JSX.Element {
  let firstRequirementButtonRef: HTMLButtonElement | undefined;

  const workspace = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => workspace().length > 0);
  const workspaceName = createMemo(() =>
    hasWorkspace() ? workspaceBasename(workspace()) : "Not selected",
  );
  const workspaceHint = createMemo(() =>
    hasWorkspace()
      ? ellipsisPath(workspace(), 72)
      : "Choose the folder Relay should use.",
  );
  const connectionReady = createMemo(
    () => props.copilotState.result?.connected || props.copilotState.status === "ready",
  );
  const connectionStatus = createMemo(() => {
    if (props.copilotState.status === "checking") return "Checking";
    if (connectionReady()) return "Ready";
    return "Needs setup";
  });
  const connectionDetail = createMemo(() => {
    if (props.copilotState.status === "checking") {
      return "Relay is checking the connection now.";
    }
    if (connectionReady()) {
      return "Copilot is ready in this app.";
    }
    if (props.copilotState.status === "needs_sign_in") {
      return "Sign in to Copilot in Edge, then reconnect.";
    }
    return "Reconnect Copilot after Edge is ready.";
  });

  createEffect(() => {
    if (!props.showRequirements) return;
    queueMicrotask(() => firstRequirementButtonRef?.focus());
  });

  return (
    <section class="ra-first-run" aria-label="Get started" data-ra-setup-card="">
      <div class="ra-first-run__card">
        <div class="ra-first-run__intro">
          <p class="ra-empty-state__eyebrow">Relay Agent</p>
          <h1 class="ra-first-run__hero-heading">Start with the outcome you need.</h1>
          <p class={`ra-type-body-sans ${ui.textSecondary}`}>
            Set the project, confirm Copilot, and keep working in this same conversation.
          </p>
        </div>

        <div class="ra-first-run__readiness">
          <SetupRow
            label="Project"
            statusLabel={hasWorkspace() ? "Ready" : "Needs setup"}
            statusState={hasWorkspace() ? "good" : "warn"}
            summary={
              hasWorkspace()
                ? `Project set to ${workspaceName()}.`
                : "Choose the folder Relay should use."
            }
            detail={workspaceHint()}
            action={
              <Button variant={hasWorkspace() ? "secondary" : "primary"} type="button" class="ra-type-button-label" onClick={props.onChooseProject}>
                {hasWorkspace() ? "Change project" : "Choose project"}
              </Button>
            }
          />

          <SetupRow
            label="Copilot"
            statusLabel={connectionStatus()}
            statusState={connectionReady() ? "good" : props.copilotState.status === "checking" ? "neutral" : "warn"}
            summary={
              connectionReady()
                ? "Copilot is ready."
                : props.copilotState.status === "checking"
                  ? "Checking the connection now."
                  : "Copilot needs to be ready."
            }
            detail={connectionDetail()}
            action={
              connectionReady() ? undefined : (
                <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
                  Reconnect Copilot
                </Button>
              )
            }
          />
        </div>

        <div class="ra-first-run__example">
          <p class={`ra-type-system-micro ${ui.mutedText}`}>Example request</p>
          <p class={`ra-type-body-sans ${ui.textPrimary}`}>Clarify this setup flow and reduce friction.</p>
        </div>

        {props.showRequirements ? (
          <div class="ra-first-run__requirement-card" role="status" aria-live="polite" data-ra-first-run-requirements="">
            <div>
              <p class="ra-first-run__step-kicker">Before sending</p>
              <h2 class={`ra-type-button-label ${ui.textPrimary}`}>Finish setup. Your draft stays here.</h2>
            </div>
            <div class="ra-first-run__requirement-actions">
              {props.missingProject ? (
                <Button
                  ref={firstRequirementButtonRef}
                  variant="primary"
                  type="button"
                  class="ra-type-button-label"
                  onClick={props.onChooseProject}
                >
                  Choose project
                </Button>
              ) : null}
              {props.missingCopilot ? (
                <Button
                  ref={props.missingProject ? undefined : firstRequirementButtonRef}
                  variant="secondary"
                  type="button"
                  class="ra-type-button-label"
                  onClick={props.onReconnectCopilot}
                >
                  Reconnect Copilot
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
