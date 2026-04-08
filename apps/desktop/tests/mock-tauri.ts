/**
 * Mock Tauri API — replaces @tauri-apps/api in E2E tests
 * so we can test the Solid.js frontend without a real Tauri shell.
 */

import type {
  AgentApprovalNeededEvent,
  AgentErrorEvent,
  AgentToolResultEvent,
  AgentToolStartEvent,
  AgentTurnCompleteEvent,
} from "../src/lib/ipc";

/* ── Mock session state ─── */

let _sessionIdCounter = 0;
const _sessions = new Map<string, { running: boolean; history: unknown[] }>();
const _pendingApprovals = new Map<string, () => void>();
const _approvalResults = new Map<string, boolean>();
const _eventListeners: Array<(event: unknown) => void> = [];
const _nextResponse = {
  turnComplete: false,
  assistantMessage: "Mock agent completed the task successfully.",
};

/* ── Public helpers (called by test code) ─── */

export function mockSetNextTurnResponse(
  complete: boolean,
  message: string,
) {
  _nextResponse.turnComplete = complete;
  _nextResponse.assistantMessage = message;
}

export function mockEmitApproval(approvalEvent: AgentApprovalNeededEvent) {
  _pendingApprovals.set(approvalEvent.approvalId, () => {});
  dispatch({
    type: "approval_needed",
    data: approvalEvent,
  });
}

export function mockResolveApproval(
  approvalId: string,
  approved: boolean,
) {
  _approvalResults.set(approvalId, approved);
  const cb = _pendingApprovals.get(approvalId);
  if (cb) cb();
  _pendingApprovals.delete(approvalId);
}

export function mockEmitTurnComplete(event: AgentTurnCompleteEvent) {
  dispatch({ type: "turn_complete", data: event });
}

export function mockEmitToolStart(event: AgentToolStartEvent) {
  dispatch({ type: "tool_start", data: event });
}

export function mockEmitToolResult(event: AgentToolResultEvent) {
  dispatch({ type: "tool_result", data: event });
}

export function mockEmitError(event: AgentErrorEvent) {
  dispatch({ type: "error", data: event });
}

function dispatch(event: unknown) {
  for (const fn of _eventListeners) {
    fn(event);
  }
}

/* ── @tauri-apps/api/core mock ─── */

export async function mockInvoke(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const req = (args as any).request as Record<string, unknown>;

  switch (cmd) {
    case "start_agent": {
      _sessionIdCounter += 1;
      const id = `session-mock-${_sessionIdCounter}`;
      _sessions.set(id, { running: true, history: [] });

      // Simulate async completion
      setTimeout(() => {
        _sessions.set(id, { running: false, history: [] });
        dispatch({
          type: "turn_complete",
          data: {
            sessionId: id,
            stopReason: "end_turn",
            assistantMessage: _nextResponse.assistantMessage,
            messageCount: 1,
          } as AgentTurnCompleteEvent,
        });
      }, 50);

      return id;
    }

    case "respond_approval": {
      const { approvalId } = req as any;
      mockResolveApproval(approvalId, (req as any).approved);
      return undefined;
    }

    case "cancel_agent": {
      const { sessionId } = req as any;
      const entry = _sessions.get(sessionId);
      if (entry) entry.running = false;
      dispatch({
        type: "error",
        data: { sessionId, error: "cancelled", cancelled: true } as AgentErrorEvent,
      });
      return undefined;
    }

    case "get_session_history": {
      const { sessionId } = req as any;
      return {
        sessionId,
        running: false,
        messages: [],
      };
    }

    case "warmup_copilot_bridge":
      return { connected: true, loginRequired: false, url: null, error: null };

    default:
      throw new Error(`Unknown mock command: ${cmd}`);
  }
}

export function mockOnEvent(
  callback: (event: unknown) => void,
): () => void {
  _eventListeners.push(callback);
  return () => {
    const idx = _eventListeners.indexOf(callback);
    if (idx >= 0) _eventListeners.splice(idx, 1);
  };
}
