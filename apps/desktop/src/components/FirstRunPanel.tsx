import { createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
import type { SessionPreset } from "../lib/ipc";
import { sessionModeDefaultNote, sessionModeLabel } from "../lib/session-mode-label";
import { copilotWarmupStageDetail, type CopilotWarmupState } from "../shell/useCopilotWarmup";
import { Button } from "./ui";

function PreflightItem(props: {
  label: string;
  value: string;
  detail: string;
  state: "good" | "warn" | "neutral";
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
      : "Choose a folder so Relay can inspect and edit the right files.",
  );
  const copilotSignedIn = createMemo(
    () => props.copilotState.result?.connected ?? props.copilotState.status === "ready",
  );
  const cdpReachable = createMemo(
    () => props.copilotState.result?.connected
      || props.copilotState.result?.loginRequired
      || props.copilotState.status === "ready"
      || props.copilotState.status === "needs_sign_in",
  );
  const copilotStageDetail = createMemo(() => copilotWarmupStageDetail(props.copilotState));

  return (
    <section class="ra-first-run" aria-label="Get started">
      <div class="ra-first-run__panel">
        <div class="ra-first-run__lead">
          <p class="ra-empty-state__eyebrow">Relay Agent</p>
          <h1 class={`ra-type-section-heading ${ui.textPrimary}`}>Tell Relay what you need</h1>
          <p class={`ra-type-body-sans ${ui.textSecondary}`}>
            Set up the workspace and Copilot connection, then describe the task in one clear request.
          </p>
        </div>

        <div class="ra-first-run__preflight">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p class={`ra-type-system-micro ${ui.mutedText}`}>Preflight</p>
              <p class={`ra-type-title-sm ${ui.textPrimary} mt-1`}>Check the basics before you start</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
                Reconnect Copilot
              </Button>
              <Button variant="primary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
                Open settings
              </Button>
            </div>
          </div>

          <div class="ra-preflight-grid">
            <PreflightItem
              label="Workspace selected"
              value={workspaceName()}
              detail={workspaceHint()}
              state={hasWorkspace() ? "good" : "warn"}
            />
            <PreflightItem
              label="Copilot signed in"
              value={copilotSignedIn() ? "Signed in" : "Needs attention"}
              detail={
                props.copilotState.status === "checking"
                  ? "Checking the Copilot sign-in state…"
                  : props.copilotState.status === "needs_sign_in"
                  ? props.copilotState.message ?? "Sign in to Copilot in Edge, then return here."
                  : copilotSignedIn()
                    ? "Copilot is ready for this app."
                    : copilotStageDetail() ?? props.copilotState.message ?? "Run a connection check from settings."
              }
              state={copilotSignedIn() ? "good" : "warn"}
            />
            <PreflightItem
              label="CDP reachable"
              value={cdpReachable() ? "Reachable" : "Not ready"}
              detail={
                props.copilotState.status === "checking"
                  ? copilotStageDetail() ?? "Checking the Edge connection…"
                  : cdpReachable()
                    ? "Relay can reach the Edge debugging endpoint."
                    : copilotStageDetail() ?? props.copilotState.message ?? "Open settings to review the browser connection."
              }
              state={cdpReachable() ? "good" : "warn"}
            />
            <PreflightItem
              label="Default work mode"
              value={sessionModeLabel(props.sessionPreset)}
              detail={sessionModeDefaultNote(props.sessionPreset)}
              state="neutral"
            />
          </div>
        </div>

        <div class="ra-first-run__request">
          <div class="min-w-0">
            <p class={`ra-type-system-micro ${ui.mutedText}`}>First request</p>
            <p class={`ra-type-title-sm ${ui.textPrimary} mt-1`}>Start with the outcome you want</p>
            <p class={`ra-type-caption ${ui.mutedText} mt-1`}>
              Ask Relay to review code, plan an implementation, or update files in the selected workspace.
            </p>
            <p class="ra-first-run__mode-note">{sessionModeDefaultNote(props.sessionPreset)}</p>
          </div>
          {props.children}
        </div>
      </div>
    </section>
  );
}
