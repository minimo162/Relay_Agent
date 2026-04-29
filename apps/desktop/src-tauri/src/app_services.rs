use std::sync::{Arc, Mutex};

use crate::copilot_server::CopilotServer;
use crate::models::OpenWorkSetupSnapshot;

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
    opencode_provider_bridge: Arc<CopilotBridgeManager>,
    openwork_setup: Arc<Mutex<OpenWorkSetupSnapshot>>,
}

impl AppServices {
    #[must_use]
    pub fn new() -> Self {
        Self {
            copilot_bridge: Arc::new(CopilotBridgeManager::new()),
            opencode_provider_bridge: Arc::new(CopilotBridgeManager::new()),
            openwork_setup: Arc::new(Mutex::new(OpenWorkSetupSnapshot::preparing(
                "Preparing OpenWork/OpenCode for M365 Copilot.",
            ))),
        }
    }

    #[must_use]
    pub fn copilot_bridge(&self) -> Arc<CopilotBridgeManager> {
        Arc::clone(&self.copilot_bridge)
    }

    #[must_use]
    pub fn opencode_provider_bridge(&self) -> Arc<CopilotBridgeManager> {
        Arc::clone(&self.opencode_provider_bridge)
    }

    #[must_use]
    pub fn openwork_setup_status(&self) -> OpenWorkSetupSnapshot {
        self.openwork_setup
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|error| {
                OpenWorkSetupSnapshot::needs_attention(format!(
                    "OpenWork/OpenCode setup status is unavailable: {error}"
                ))
            })
    }

    #[must_use]
    pub fn openwork_setup_store(&self) -> Arc<Mutex<OpenWorkSetupSnapshot>> {
        Arc::clone(&self.openwork_setup)
    }
}
