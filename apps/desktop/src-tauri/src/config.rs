/// Application-wide configuration with sensible defaults.
/// All magic numbers should live here and be adjustable via UI or config file in the future.
///
/// Agent loop and session configuration.
/// Hard-cut execution state lives in OpenCode/OpenWork; these values only tune
/// Relay's adapter-side retries and in-memory status cleanup.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Maximum number of agent turns per session.
    /// Default: 16 — enough for most tasks without ballooning token costs.
    pub max_turns: usize,
    /// Maximum number of concurrent agent sessions.
    pub max_concurrent_sessions: usize,
    /// Session cleanup TTL in minutes. Sessions completed/cancelled longer ago
    /// than this are evicted from the in-memory registry.
    pub session_cleanup_ttl_minutes: u64,
    /// Transient Copilot/CDP failures retried per outer turn before the loop stops.
    pub max_turn_retries: usize,
    /// Maximum assistant/tool follow-up iterations inside a single outer turn.
    pub max_inner_iterations: usize,
    /// Number of extra synthetic repair / "Continue." nudges allowed after a meta-only or
    /// tool-protocol-confused reply.
    pub meta_stall_nudge_limit: usize,
    /// Forced compaction attempts allowed when inline prompt size still blocks a turn.
    pub compact_retry_limit: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_turns: 16,
            max_concurrent_sessions: 4,
            session_cleanup_ttl_minutes: 30,
            max_turn_retries: 2,
            max_inner_iterations: 8,
            meta_stall_nudge_limit: 3,
            compact_retry_limit: 1,
        }
    }
}

impl AgentConfig {
    pub fn global() -> &'static Self {
        static CONFIG: std::sync::OnceLock<AgentConfig> = std::sync::OnceLock::new();
        CONFIG.get_or_init(AgentConfig::default)
    }
}
