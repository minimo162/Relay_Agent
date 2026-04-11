use std::sync::{Arc, Mutex};

use tokio::sync::Semaphore;

use crate::config::AgentConfig;
use crate::copilot_server::CopilotServer;
use crate::registry::SessionRegistry;

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
    config: AgentConfig,
    registry: SessionRegistry,
    agent_semaphore: Arc<Semaphore>,
    copilot_bridge: Arc<CopilotBridgeManager>,
}

impl AppServices {
    #[must_use]
    pub fn new() -> Self {
        let config = AgentConfig::global().clone();
        Self {
            agent_semaphore: Arc::new(Semaphore::new(config.max_concurrent_sessions)),
            registry: SessionRegistry::new(),
            copilot_bridge: Arc::new(CopilotBridgeManager::new()),
            config,
        }
    }

    #[must_use]
    pub fn config(&self) -> &AgentConfig {
        &self.config
    }

    #[must_use]
    pub fn registry(&self) -> SessionRegistry {
        self.registry.clone()
    }

    #[must_use]
    pub fn agent_semaphore(&self) -> Arc<Semaphore> {
        Arc::clone(&self.agent_semaphore)
    }

    #[must_use]
    pub fn copilot_bridge(&self) -> Arc<CopilotBridgeManager> {
        Arc::clone(&self.copilot_bridge)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn semaphore_uses_configured_max_concurrent_sessions() {
        let services = AppServices::new();
        let max = services.config().max_concurrent_sessions;
        let semaphore = services.agent_semaphore();

        let permits = semaphore
            .clone()
            .acquire_many_owned(u32::try_from(max).expect("max_concurrent_sessions fits in u32"))
            .await
            .expect("semaphore should grant configured permits");

        assert!(
            semaphore.try_acquire().is_err(),
            "extra permit should not be available beyond configured max"
        );

        drop(permits);

        assert!(
            semaphore.try_acquire().is_ok(),
            "permit should become available after release"
        );
    }
}
