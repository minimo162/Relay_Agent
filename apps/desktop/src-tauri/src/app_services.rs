use std::sync::{Arc, Mutex};

use crate::copilot_server::CopilotServer;

pub struct CopilotServerState {
    pub server: Arc<Mutex<CopilotServer>>,
    pub started: bool,
}

#[derive(Default)]
pub struct CopilotBridgeManager {
    slot: Mutex<Option<CopilotServerState>>,
}

impl CopilotBridgeManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, Option<CopilotServerState>>, String> {
        self.slot
            .lock()
            .map_err(|e| format!("copilot server state lock poisoned: {e}"))
    }
}

pub struct AppServices {
    copilot_bridge: Arc<CopilotBridgeManager>,
}

impl AppServices {
    #[must_use]
    pub fn new() -> Self {
        Self {
            copilot_bridge: Arc::new(CopilotBridgeManager::new()),
        }
    }

    #[must_use]
    pub fn copilot_bridge(&self) -> Arc<CopilotBridgeManager> {
        Arc::clone(&self.copilot_bridge)
    }
}
