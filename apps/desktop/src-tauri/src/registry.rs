use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;

use chrono::Utc;
use runtime::Session as RuntimeSession;

use crate::error::AgentLoopError;

/// Shared state for an active agent session.
/// The approval channel map lets `respond_approval()` unblock the agent loop.
pub struct SessionEntry {
    pub session: RuntimeSession,
    pub running: bool,
    pub cancelled: Arc<AtomicBool>,
    /// Timestamp (UTC epoch seconds) when the session completed or was cancelled.
    /// Used for TTL-based eviction.
    pub finished_at: Option<i64>,
    /// `approval_id` → oneshot Sender<bool>
    pub approvals: Mutex<HashMap<String, std::sync::mpsc::Sender<bool>>>,
}

impl SessionEntry {
    /// Mark this session as finished and record the timestamp for TTL cleanup.
    pub fn mark_finished(&mut self) {
        self.running = false;
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
        Ok(approvals.drain().map(|(_, tx)| tx).collect())
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
