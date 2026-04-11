use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

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

/// Mutable runtime state owned by a single session.
pub struct SessionState {
    pub session: RuntimeSession,
    pub running: bool,
    pub run_state: SessionRunState,
    /// Monotonic loop ownership token. Incrementing this invalidates stale wakeups/emits.
    pub loop_epoch: u64,
    pub cancelled: Arc<AtomicBool>,
    /// Timestamp (UTC epoch seconds) when the session completed or was cancelled.
    pub finished_at: Option<i64>,
    /// Workspace `cwd` from `start_agent` (trimmed), for workspace-scoped allowlist persistence.
    pub workspace_cwd: Option<String>,
    /// Last terminal stop reason emitted by the backend loop.
    pub last_stop_reason: Option<String>,
    /// Total transient retries consumed by this session.
    pub retry_count: usize,
    /// Most recent backend error / rejection summary.
    pub last_error_summary: Option<String>,
    /// True once a terminal `agent:status` idle event has been emitted for the current epoch.
    pub terminal_status_emitted: bool,
}

impl SessionState {
    #[must_use]
    pub fn new(session: RuntimeSession, workspace_cwd: Option<String>) -> Self {
        Self {
            session,
            running: true,
            run_state: SessionRunState::Running,
            loop_epoch: 1,
            cancelled: Arc::new(AtomicBool::new(false)),
            finished_at: None,
            workspace_cwd,
            last_stop_reason: None,
            retry_count: 0,
            last_error_summary: None,
            terminal_status_emitted: false,
        }
    }

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

/// Shared state for a single agent session.
pub struct SessionHandle {
    state: RwLock<SessionState>,
    approvals: Mutex<HashMap<String, PendingApproval>>,
    user_questions: Mutex<HashMap<String, PendingUserQuestion>>,
    auto_allowed_tools: Mutex<HashSet<String>>,
    write_undo: Mutex<WriteUndoStacks>,
}

impl SessionHandle {
    #[must_use]
    pub fn new(state: SessionState, auto_allowed_tools: HashSet<String>) -> Self {
        Self {
            state: RwLock::new(state),
            approvals: Mutex::new(HashMap::new()),
            user_questions: Mutex::new(HashMap::new()),
            auto_allowed_tools: Mutex::new(auto_allowed_tools),
            write_undo: Mutex::new(WriteUndoStacks::default()),
        }
    }

    pub fn read_state<F, R>(&self, f: F) -> Result<R, AgentLoopError>
    where
        F: FnOnce(&SessionState) -> R,
    {
        let state = self
            .state
            .read()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(f(&state))
    }

    pub fn write_state<F, R>(&self, f: F) -> Result<R, AgentLoopError>
    where
        F: FnOnce(&mut SessionState) -> R,
    {
        let mut state = self
            .state
            .write()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(f(&mut state))
    }

    pub fn add_auto_allowed_tool(&self, tool_name: &str) -> Result<(), AgentLoopError> {
        let mut tools = self
            .auto_allowed_tools
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        tools.insert(tool_name.to_string());
        Ok(())
    }

    pub fn is_tool_auto_allowed(&self, tool_name: &str) -> Result<bool, AgentLoopError> {
        let tools = self
            .auto_allowed_tools
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(tools.contains(tool_name))
    }

    pub fn insert_pending_approval(
        &self,
        approval_id: String,
        pending: PendingApproval,
    ) -> Result<(), AgentLoopError> {
        let mut approvals = self
            .approvals
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        approvals.insert(approval_id, pending);
        Ok(())
    }

    pub fn take_pending_approval(
        &self,
        approval_id: &str,
    ) -> Result<Option<PendingApproval>, AgentLoopError> {
        let mut approvals = self
            .approvals
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(approvals.remove(approval_id))
    }

    pub fn drain_approvals(&self) -> Result<Vec<std::sync::mpsc::Sender<bool>>, AgentLoopError> {
        let mut approvals = self
            .approvals
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(approvals.drain().map(|(_, p)| p.tx).collect())
    }

    pub fn insert_pending_user_question(
        &self,
        question_id: String,
        pending: PendingUserQuestion,
    ) -> Result<(), AgentLoopError> {
        let mut questions = self
            .user_questions
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        questions.insert(question_id, pending);
        Ok(())
    }

    pub fn take_pending_user_question(
        &self,
        question_id: &str,
    ) -> Result<Option<PendingUserQuestion>, AgentLoopError> {
        let mut questions = self
            .user_questions
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(questions.remove(question_id))
    }

    pub fn drain_user_questions(
        &self,
    ) -> Result<Vec<std::sync::mpsc::Sender<String>>, AgentLoopError> {
        let mut questions = self
            .user_questions
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(questions.drain().map(|(_, p)| p.tx).collect())
    }

    pub fn with_write_undo<F, R>(&self, f: F) -> Result<R, AgentLoopError>
    where
        F: FnOnce(&mut WriteUndoStacks) -> R,
    {
        let mut stack = self
            .write_undo
            .lock()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(f(&mut stack))
    }
}

pub struct SessionRegistry {
    data: Arc<RwLock<HashMap<String, Arc<SessionHandle>>>>,
}

impl Clone for SessionRegistry {
    fn clone(&self) -> Self {
        Self {
            data: Arc::clone(&self.data),
        }
    }
}

impl SessionRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn insert(&self, id: String, handle: SessionHandle) -> Result<(), AgentLoopError> {
        let mut data = self
            .data
            .write()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        data.insert(id, Arc::new(handle));
        Ok(())
    }

    pub fn get_handle(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<SessionHandle>>, AgentLoopError> {
        let data = self
            .data
            .read()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        Ok(data.get(session_id).cloned())
    }

    pub fn get_session<F, R>(&self, session_id: &str, f: F) -> Result<Option<R>, AgentLoopError>
    where
        F: FnOnce(&SessionState) -> R,
    {
        let Some(handle) = self.get_handle(session_id)? else {
            return Ok(None);
        };
        Ok(Some(handle.read_state(f)?))
    }

    pub fn mutate_session<F, R>(&self, session_id: &str, f: F) -> Result<Option<R>, AgentLoopError>
    where
        F: FnOnce(&mut SessionState) -> R,
    {
        let Some(handle) = self.get_handle(session_id)? else {
            return Ok(None);
        };
        Ok(Some(handle.write_state(f)?))
    }

    /// Count sessions whose agent loop is still marked running (includes in-flight work).
    pub fn running_session_count(&self) -> Result<usize, AgentLoopError> {
        let handles: Vec<Arc<SessionHandle>> = self
            .data
            .read()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?
            .values()
            .cloned()
            .collect();
        let mut count = 0;
        for handle in handles {
            if handle.read_state(|state| state.running)? {
                count += 1;
            }
        }
        Ok(count)
    }

    /// Evict completed/cancelled sessions older than `ttl_seconds`.
    pub fn remove_stale_sessions(&self, ttl_seconds: i64) -> Result<usize, AgentLoopError> {
        let handles: Vec<(String, Arc<SessionHandle>)> = self
            .data
            .read()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?
            .iter()
            .map(|(id, handle)| (id.clone(), Arc::clone(handle)))
            .collect();

        let now = Utc::now().timestamp();
        let stale_ids: Vec<String> = handles
            .into_iter()
            .filter_map(|(id, handle)| {
                handle
                    .read_state(|state| {
                        (!state.running && state.finished_at.is_some_and(|t| now - t > ttl_seconds))
                            .then_some(id)
                    })
                    .ok()
                    .flatten()
            })
            .collect();

        let count = stale_ids.len();
        if count == 0 {
            return Ok(0);
        }

        let mut data = self
            .data
            .write()
            .map_err(|e| AgentLoopError::RegistryLockPoisoned(e.to_string()))?;
        for id in &stale_ids {
            data.remove(id);
        }
        tracing::info!("[SessionRegistry] evicted {count} stale session(s) (TTL: {ttl_seconds}s)");
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn session_handle_locking_does_not_block_other_sessions() {
        let registry = SessionRegistry::new();
        registry
            .insert(
                "s1".to_string(),
                SessionHandle::new(
                    SessionState::new(RuntimeSession::new(), None),
                    HashSet::new(),
                ),
            )
            .expect("insert session 1");
        registry
            .insert(
                "s2".to_string(),
                SessionHandle::new(
                    SessionState::new(RuntimeSession::new(), None),
                    HashSet::new(),
                ),
            )
            .expect("insert session 2");

        let session1 = registry
            .get_handle("s1")
            .expect("lookup s1")
            .expect("session 1 exists");
        let session2 = registry
            .get_handle("s2")
            .expect("lookup s2")
            .expect("session 2 exists");

        let barrier = Arc::new(Barrier::new(2));
        let worker_barrier = Arc::clone(&barrier);

        let worker = thread::spawn(move || {
            let _lock = session1.state.write().expect("lock session 1");
            worker_barrier.wait();
            thread::sleep(Duration::from_millis(150));
        });

        barrier.wait();

        let started = Instant::now();
        let running = session2
            .read_state(|state| state.running)
            .expect("read session 2 while session 1 is locked");
        let elapsed = started.elapsed();

        assert!(running);
        assert!(
            elapsed < Duration::from_millis(50),
            "session 2 read should not wait on session 1 lock: {elapsed:?}"
        );

        worker.join().expect("worker thread joins");
    }

    #[test]
    fn remove_stale_sessions_only_evicts_expired_finished_sessions() {
        let registry = SessionRegistry::new();

        let mut stale = SessionState::new(RuntimeSession::new(), None);
        stale.mark_finished();
        stale.finished_at = Some(Utc::now().timestamp() - 120);

        let mut fresh = SessionState::new(RuntimeSession::new(), None);
        fresh.mark_finished();
        fresh.finished_at = Some(Utc::now().timestamp());

        registry
            .insert(
                "stale".to_string(),
                SessionHandle::new(stale, HashSet::new()),
            )
            .expect("insert stale");
        registry
            .insert(
                "fresh".to_string(),
                SessionHandle::new(fresh, HashSet::new()),
            )
            .expect("insert fresh");

        let evicted = registry
            .remove_stale_sessions(60)
            .expect("stale cleanup succeeds");

        assert_eq!(evicted, 1);
        assert!(registry
            .get_handle("stale")
            .expect("lookup stale")
            .is_none());
        assert!(registry
            .get_handle("fresh")
            .expect("lookup fresh")
            .is_some());
    }
}
