use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use runtime::Session as RuntimeSession;

/// Shared state for an active agent session.
/// The approval channel map lets respond_approval() unblock the agent loop.
pub struct SessionEntry {
    pub session: RuntimeSession,
    pub running: bool,
    pub cancelled: Arc<AtomicBool>,
    /// Timestamp (UTC epoch seconds) when the session completed or was cancelled.
    /// Used for TTL-based eviction.
    pub finished_at: Option<i64>,
    /// approval_id → oneshot Sender<bool>
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
    data: Arc<Mutex<HashMap<String, SessionEntry>>>,
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

    /// Evict completed/cancelled sessions older than `ttl_seconds`.
    /// Call this periodically (e.g. on each new session start, or via a timer).
    pub fn cleanup_stale_sessions(&self, ttl_seconds: i64) -> usize {
        let Ok(mut data) = self.data.lock() else {
            eprintln!("[SessionRegistry] cleanup: lock poisoned");
            return 0;
        };
        let now = Utc::now().timestamp();
        let stale_ids: Vec<String> = data
            .iter()
            .filter(|(_, entry)| {
                // Only evict non-running sessions that have a finished_at timestamp
                !entry.running
                    && entry
                        .finished_at
                        .map(|t| now - t > ttl_seconds)
                        .unwrap_or(false)
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
        count
    }
}
