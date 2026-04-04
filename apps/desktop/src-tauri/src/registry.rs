use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::Arc;

use runtime::Session as RuntimeSession;

/// Shared state for an active agent session.
/// The approval channel map lets respond_approval() unblock the agent loop.
pub struct SessionEntry {
    pub session: RuntimeSession,
    pub running: bool,
    pub cancelled: Arc<std::sync::atomic::AtomicBool>,
    /// approval_id → oneshot Sender<bool>
    pub approvals: Mutex<HashMap<String, std::sync::mpsc::Sender<bool>>>,
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
}
