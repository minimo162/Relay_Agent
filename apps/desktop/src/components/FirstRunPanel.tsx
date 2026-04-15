import { createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
import type { SessionPreset } from "../lib/ipc";
import { sessionModeLabel, sessionModeSummary } from "../lib/session-mode-label";
import { copilotWarmupStageDetail, type CopilotWarmupState } from "../shell/useCopilotWarmup";
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

function StepCard(props: {
  step: string;
  title: string;
  statusLabel: string;
  statusState: "good" | "warn" | "neutral";
  summary: string;
  detail: string;
  featured?: boolean;
  action?: JSX.Element;
  technicalDetail?: string | null;
  children?: JSX.Element;
}) {
  return (
    <section class={`ra-first-run__step ${props.featured ? "ra-first-run__step--primary" : ""}`}>
      <div class="ra-first-run__step-header">
        <div>
          <p class="ra-first-run__step-kicker">{props.step}</p>
          <h2 class="ra-type-title-sm text-[var(--ra-text-primary)] mt-1">{props.title}</h2>
        </div>
        <StepStatusBadge label={props.statusLabel} state={props.statusState} />
      </div>
      <div class="ra-first-run__step-body">
        <p class={`ra-type-body-sans ${ui.textPrimary}`}>{props.summary}</p>
        <p class={`ra-type-caption ${ui.mutedText}`}>{props.detail}</p>
        {props.action ? <div class="ra-first-run__step-action">{props.action}</div> : null}
        {props.technicalDetail ? (
          <details class="mt-1.5">
            <summary class={`ra-type-caption ${ui.mutedText} cursor-pointer`}>Details</summary>
            <p class={`ra-type-mono-small mt-1 ${ui.mutedText}`}>{props.technicalDetail}</p>
          </details>
        ) : null}
        {props.children}
      </div>
    </section>
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
      : "Open Settings and choose the project Relay should work in.",
  );
  const connectionReady = createMemo(
    () => props.copilotState.result?.connected || props.copilotState.status === "ready",
  );
  const copilotStageDetail = createMemo(() => copilotWarmupStageDetail(props.copilotState));
  const modeLabel = createMemo(() => sessionModeLabel(props.sessionPreset));
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
  const requestStatusLabel = createMemo(() => `Default: ${modeLabel()}`);
  const requestSummary = createMemo(() => {
    if (props.canStart) {
      return "Describe the result you want. Relay can start as soon as you send.";
    }
    return "Finish the first two steps before sending your first request.";
  });
  const requestDetail = createMemo(() =>
    props.startDisabledReason ?? `Your first chat starts in ${modeLabel()}. ${sessionModeSummary(props.sessionPreset)}`,
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
        <div class="ra-first-run__lead">
          <p class="ra-empty-state__eyebrow">Relay Agent</p>
          <h1 class={`ra-type-section-heading ${ui.textPrimary}`}>Set up once, then tell Relay what you want done</h1>
          <p class={`ra-type-body-sans ${ui.textSecondary}`}>
            Start by choosing a project and making sure Copilot is ready. After that, you can simply describe the outcome you want.
          </p>
          <ol class="ra-first-run__steps">
            <li>Choose the project Relay should work in.</li>
            <li>Check that Copilot is ready in this app.</li>
            <li>Describe the result you want.</li>
          </ol>
          <p class={`ra-type-caption ${ui.mutedText} mt-3`}>
            This keeps your first request from failing because the wrong project is selected or Copilot is not ready yet.
          </p>
        </div>

        <div class="ra-first-run__flow">
          <StepCard
            step="Step 1"
            title="Choose a project"
            statusLabel={hasWorkspace() ? "Ready" : "Needs setup"}
            statusState={hasWorkspace() ? "good" : "warn"}
            summary={
              hasWorkspace()
                ? `Relay is pointed at ${workspaceName()}.`
                : "Pick the folder Relay should read and update."
            }
            detail={workspaceHint()}
            action={
              <Button variant="primary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
                {hasWorkspace() ? "Change project" : "Choose project"}
              </Button>
            }
          />

          <StepCard
            step="Step 2"
            title="Check Copilot"
            statusLabel={connectionStatus()}
            statusState={connectionReady() ? "good" : props.copilotState.status === "checking" ? "neutral" : "warn"}
            summary={
              connectionReady()
                ? "Copilot is ready."
                : props.copilotState.status === "checking"
                  ? "Relay is checking the connection now."
                  : "Relay needs Copilot ready before it can complete your first request."
            }
            detail={connectionDetail()}
            technicalDetail={connectionTechnicalDetail()}
            action={connectionAction()}
          />

          <StepCard
            step="Step 3"
            title="Send your first request"
            statusLabel={requestStatusLabel()}
            statusState={props.canStart ? "good" : "neutral"}
            summary={requestSummary()}
            detail={requestDetail()}
            featured
          >
            <div class="ra-first-run__request-composer">{props.children}</div>
          </StepCard>
        </div>
      </div>
    </section>
  );
}
