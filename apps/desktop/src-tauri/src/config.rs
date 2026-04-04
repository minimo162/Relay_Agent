/// Application-wide configuration with sensible defaults.
/// All magic numbers should live here and be adjustable via UI or config file in the future.
/// Agent loop and session configuration.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Maximum number of agent turns per session.
    /// Default: 16 — enough for most tasks without ballooning token costs.
    pub max_turns: usize,
    /// Default: 32,000 tokens — max output for a single API call.
    pub max_tokens: usize,
    /// Number of recent messages to preserve during session compaction.
    pub compact_preserve_recent: usize,
    /// Token threshold before triggering compaction.
    pub compact_max_tokens: usize,
    /// Maximum number of concurrent agent sessions.
    pub max_concurrent_sessions: usize,
    /// Session cleanup TTL in minutes. Sessions completed/cancelled longer ago
    /// than this are evicted from the in-memory registry.
    pub session_cleanup_ttl_minutes: u64,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_turns: 16,
            max_tokens: 32_000,
            compact_preserve_recent: 2,
            compact_max_tokens: 4000,
            max_concurrent_sessions: 4,
            session_cleanup_ttl_minutes: 30,
        }
    }
}

impl AgentConfig {
    pub fn global() -> &'static Self {
        static CONFIG: std::sync::OnceLock<AgentConfig> = std::sync::OnceLock::new();
        CONFIG.get_or_init(AgentConfig::default)
    }
}
