use serde::{Deserialize, Serialize};

use crate::agent_loop::retry::LoopStopReason;
use crate::registry::{SessionRegistry, SessionRunState, SessionState};

#[derive(Clone)]
pub(crate) struct LoopEpochGuard {
    pub(crate) session_id: String,
    pub(crate) registry: SessionRegistry,
    pub(crate) epoch: u64,
}

impl LoopEpochGuard {
    pub(crate) fn new(registry: &SessionRegistry, session_id: &str) -> Self {
        let epoch = registry
            .get_session(session_id, |entry| entry.loop_epoch)
            .ok()
            .flatten()
            .unwrap_or(0);
        Self {
            session_id: session_id.to_string(),
            registry: registry.clone(),
            epoch,
        }
    }

    pub(crate) fn is_current(&self) -> bool {
        self.registry
            .get_session(&self.session_id, |entry| entry.loop_epoch == self.epoch)
            .ok()
            .flatten()
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionPhase {
    Idle,
    Running,
    Retrying,
    Compacting,
    WaitingApproval,
    Cancelling,
}

impl AgentSessionPhase {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Retrying => "retrying",
            Self::Compacting => "compacting",
            Self::WaitingApproval => "waiting_approval",
            Self::Cancelling => "cancelling",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct AgentStatusOptions {
    pub(crate) attempt: Option<usize>,
    pub(crate) message: Option<String>,
    pub(crate) next_retry_at_ms: Option<u64>,
    pub(crate) tool_name: Option<String>,
    pub(crate) stop_reason: Option<LoopStopReason>,
}

impl AgentStatusOptions {
    pub(crate) fn with_attempt(mut self, attempt: usize) -> Self {
        self.attempt = Some(attempt);
        self
    }

    pub(crate) fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub(crate) fn with_next_retry_at_ms(mut self, next_retry_at_ms: u64) -> Self {
        self.next_retry_at_ms = Some(next_retry_at_ms);
        self
    }

    pub(crate) fn with_tool_name(mut self, tool_name: impl Into<String>) -> Self {
        self.tool_name = Some(tool_name.into());
        self
    }

    pub(crate) fn with_stop_reason(mut self, stop_reason: LoopStopReason) -> Self {
        self.stop_reason = Some(stop_reason);
        self
    }
}

pub(crate) fn mutate_session_if_current<F>(guard: &LoopEpochGuard, f: F)
where
    F: FnOnce(&mut SessionState),
{
    let _ignore = guard.registry.mutate_session(&guard.session_id, |entry| {
        if entry.loop_epoch == guard.epoch {
            f(entry);
        }
    });
}

pub(crate) fn set_session_run_state(guard: &LoopEpochGuard, run_state: SessionRunState) {
    mutate_session_if_current(guard, |entry| {
        entry.run_state = run_state;
        entry.running = !matches!(
            run_state,
            SessionRunState::Cancelling | SessionRunState::Finished
        );
    });
}

pub(crate) fn increment_session_retry_count(guard: &LoopEpochGuard, error_summary: &str) {
    let summary = error_summary.to_string();
    mutate_session_if_current(guard, |entry| {
        entry.retry_count += 1;
        entry.last_error_summary = Some(summary);
    });
}

pub(crate) fn set_session_error_summary(guard: &LoopEpochGuard, error_summary: &str) {
    let summary = error_summary.to_string();
    mutate_session_if_current(guard, |entry| {
        entry.last_error_summary = Some(summary);
    });
}

pub(crate) fn set_session_stop_reason(guard: &LoopEpochGuard, stop_reason: LoopStopReason) {
    let reason = stop_reason.as_str().to_string();
    mutate_session_if_current(guard, |entry| {
        entry.last_stop_reason = Some(reason);
    });
}

pub(crate) fn mark_terminal_status_emitted(guard: &LoopEpochGuard) -> bool {
    guard
        .registry
        .mutate_session(&guard.session_id, |entry| {
            if entry.loop_epoch != guard.epoch || entry.terminal_status_emitted {
                return false;
            }
            entry.terminal_status_emitted = true;
            true
        })
        .ok()
        .flatten()
        .unwrap_or(false)
}

pub(crate) fn clear_terminal_status_emitted(guard: &LoopEpochGuard) {
    mutate_session_if_current(guard, |entry| {
        entry.terminal_status_emitted = false;
    });
}
