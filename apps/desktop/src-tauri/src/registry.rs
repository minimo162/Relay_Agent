use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;

use chrono::Utc;
use runtime::Session as RuntimeSession;

use crate::error::AgentLoopError;
use crate::session_write_undo::WriteUndoStacks;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRunState {
    Running,
    Retrying,
    WaitingApproval,
    Compacting,
    Cancelling,
    Finished,
}

/// Pending UI approval: unblock channel plus tool name for session-scoped allow rules.
pub struct PendingApproval {
    pub tx: std::sync::mpsc::Sender<bool>,
    pub tool_name: String,
}

/// Pending `AskUserQuestion`: user text answer.
pub struct PendingUserQuestion {
    pub tx: std::sync::mpsc::Sender<String>,
}

/// Shared state for an active agent session.
/// The approval channel map lets `respond_approval()` unblock the agent loop.
pub struct SessionEntry {
    pub session: RuntimeSession,
    pub running: bool,
    pub run_state: SessionRunState,
    pub cancelled: Arc<AtomicBool>,
    /// Timestamp (UTC epoch seconds) when the session completed or was cancelled.
    /// Used for TTL-based eviction.
    pub finished_at: Option<i64>,
    /// `approval_id` → pending approval (channel + tool for policy memory)
    pub approvals: Mutex<HashMap<String, PendingApproval>>,
    /// `question_id` → pending AskUserQuestion (text answer)
    pub user_questions: Mutex<HashMap<String, PendingUserQuestion>>,
    /// Tool names the user chose "allow for this session" for (OpenWork-style).
    pub auto_allowed_tools: Mutex<HashSet<String>>,
    /// Workspace `cwd` from `start_agent` (trimmed), for workspace-scoped allowlist persistence.
    pub workspace_cwd: Option<String>,
    /// Stack of successful workspace writes for OpenCode-style undo/redo.
    pub write_undo: Mutex<WriteUndoStacks>,
    /// Last terminal stop reason emitted by the backend loop.
    pub last_stop_reason: Option<String>,
    /// Total transient retries consumed by this session.
    pub retry_count: usize,
    /// Most recent backend error / rejection summary.
    pub last_error_summary: Option<String>,
}

impl SessionEntry {
    /// Mark this session as finished and record the timestamp for TTL cleanup.
    pub fn mark_finished(&mut self) {
        self.running = false;
        self.run_state = SessionRunState::Finished;
        self.cancelled.store(true, Ordering::SeqCst);
        if self.finished_at.is_none() {
            self.finished_at = Some(Utc::now().timestamp());
        }
    }
}

pub struct SessionRegistry {
    pub(crate) data: Arc<Mutex<HashMap<String, SessionEntry>>>,
}

// Manual Clone: Arc is already shared, no deep clone needed
impl Clone for SessionRegistry {
    fn clone(&self) -> Self {
        Self {
            data: Arc::clone(&self.data),
        }
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            data: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Insert a session into the registry.
    pub fn insert(&self, id: String, entry: SessionEntry) -> Result<(), AgentLoopError> {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        data.insert(id, entry);
        Ok(())
    }

    /// Lock the registry and run a closure over the data.
    pub fn with_data<F, R>(&self, f: F) -> Result<R, AgentLoopError>
    where
        F: FnOnce(&mut HashMap<String, SessionEntry>) -> R,
    {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(f(&mut data))
    }

    /// Get a reference to a session entry (while holding the lock).
    pub fn get_session<F, R>(&self, session_id: &str, f: F) -> Result<Option<R>, AgentLoopError>
    where
        F: FnOnce(&SessionEntry) -> R,
    {
        let data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(data.get(session_id).map(f))
    }

    /// Mutate a session entry (while holding the lock).
    pub fn mutate_session<F, R>(&self, session_id: &str, f: F) -> Result<Option<R>, AgentLoopError>
    where
        F: FnOnce(&mut SessionEntry) -> R,
    {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(data.get_mut(session_id).map(f))
    }

    /// Drain all approval senders for a session and return them.
    pub fn drain_approvals(
        &self,
        session_id: &str,
    ) -> Result<Vec<std::sync::mpsc::Sender<bool>>, AgentLoopError> {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        let Some(entry) = data.get_mut(session_id) else {
            return Ok(Vec::new());
        };
        let mut approvals = entry
            .approvals
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(approvals.drain().map(|(_, p)| p.tx).collect())
    }

    pub fn drain_user_questions(
        &self,
        session_id: &str,
    ) -> Result<Vec<std::sync::mpsc::Sender<String>>, AgentLoopError> {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        let Some(entry) = data.get_mut(session_id) else {
            return Ok(Vec::new());
        };
        let mut q = entry
            .user_questions
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(q.drain().map(|(_, p)| p.tx).collect())
    }

    /// Count sessions whose agent loop is still marked running (includes in-flight work).
    pub fn running_session_count(&self) -> Result<usize, AgentLoopError> {
        let data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(data.values().filter(|e| e.running).count())
    }

    /// Evict completed/cancelled sessions older than `ttl_seconds`.
    /// Call this periodically (e.g. on each new session start, or via a timer).
    pub fn cleanup_stale_sessions(&self, ttl_seconds: i64) -> Result<usize, AgentLoopError> {
        let mut data = self
            .data
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        let now = Utc::now().timestamp();
        let stale_ids: Vec<String> = data
            .iter()
            .filter(|(_, entry)| {
                // Only evict non-running sessions that have a finished_at timestamp
                !entry.running && entry.finished_at.is_some_and(|t| now - t > ttl_seconds)
            })
            .map(|(id, _)| id.clone())
            .collect();

        let count = stale_ids.len();
        for id in &stale_ids {
            data.remove(id);
        }
        if count > 0 {
            tracing::info!(
                "[SessionRegistry] evicted {count} stale session(s) (TTL: {ttl_seconds}s)"
            );
        }
        Ok(count)
    }
}
