use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentLoopError {
    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("session registry lock poisoned: {0}")]
    RegistryLockPoisoned(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("agent loop failed: {0}")]
    AgentLoopFailed(String),

    #[error("agent loop panicked: {0}")]
    AgentLoopPanicked(String),

    #[error("concurrency limit reached")]
    ConcurrencyLimitReached,

    #[error("session was cancelled")]
    SessionCancelled,

    #[error("API error: {0}")]
    ApiError(String),

    #[error("initialization error: {0}")]
    InitializationError(String),

    #[error("persistence error: {0}")]
    PersistenceError(String),

    #[error("CDP connection failed: {0}")]
    CdpConnectionError(String),

    #[error("CDP command failed: {method} — {reason}")]
    CdpCommandError { method: String, reason: String },

    #[error("CDP timeout: {0}")]
    CdpTimeoutError(String),

    #[error("copilot page not found: {0}")]
    CopilotPageNotFound(String),

    #[error("copilot prompt failed: {0}")]
    CopilotPromptError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_not_found_display() {
        let err = AgentLoopError::SessionNotFound("abc-123".to_string());
        assert_eq!(err.to_string(), "session not found: abc-123");
    }

    #[test]
    fn test_registry_lock_poisoned_display() {
        let err = AgentLoopError::RegistryLockPoisoned("mutex error".to_string());
        assert_eq!(
            err.to_string(),
            "session registry lock poisoned: mutex error"
        );
    }

    #[test]
    fn test_invalid_input_display() {
        let err = AgentLoopError::InvalidInput("empty goal".to_string());
        assert_eq!(err.to_string(), "invalid input: empty goal");
    }

    #[test]
    fn test_agent_loop_failed_display() {
        let err = AgentLoopError::AgentLoopFailed("timeout".to_string());
        assert_eq!(err.to_string(), "agent loop failed: timeout");
    }

    #[test]
    fn test_agent_loop_panicked_display() {
        let err = AgentLoopError::AgentLoopPanicked("index out of bounds".to_string());
        assert_eq!(err.to_string(), "agent loop panicked: index out of bounds");
    }

    #[test]
    fn test_concurrency_limit_reached_display() {
        let err = AgentLoopError::ConcurrencyLimitReached;
        assert_eq!(err.to_string(), "concurrency limit reached");
    }

    #[test]
    fn test_session_cancelled_display() {
        let err = AgentLoopError::SessionCancelled;
        assert_eq!(err.to_string(), "session was cancelled");
    }

    #[test]
    fn test_api_error_display() {
        let err = AgentLoopError::ApiError("401 Unauthorized".to_string());
        assert_eq!(err.to_string(), "API error: 401 Unauthorized");
    }

    #[test]
    fn test_persistence_error_display() {
        let err = AgentLoopError::PersistenceError("disk full".to_string());
        assert_eq!(err.to_string(), "persistence error: disk full");
    }

    #[test]
    fn test_error_debug_contains_variant_name() {
        let err = AgentLoopError::SessionNotFound("x".to_string());
        let debug = format!("{err:?}");
        assert!(debug.contains("SessionNotFound"));
    }

    #[test]
    fn test_pattern_match_data_variant() {
        let err = AgentLoopError::SessionNotFound("s1".to_string());
        match err {
            AgentLoopError::SessionNotFound(id) => assert_eq!(id, "s1"),
            _ => panic!("expected SessionNotFound"),
        }
    }

    #[test]
    fn test_pattern_match_unit_variant() {
        let err = AgentLoopError::SessionCancelled;
        assert!(matches!(err, AgentLoopError::SessionCancelled));
    }

    #[test]
    fn test_pattern_match_concurrency_limit() {
        let err = AgentLoopError::ConcurrencyLimitReached;
        match err {
            AgentLoopError::ConcurrencyLimitReached => {}
            other => panic!("expected ConcurrencyLimitReached, got {other:?}"),
        }
    }

    #[test]
    fn test_cdp_connection_error_display() {
        let err = AgentLoopError::CdpConnectionError("browser unreachable".to_string());
        assert_eq!(
            err.to_string(),
            "CDP connection failed: browser unreachable"
        );
    }

    #[test]
    fn test_cdp_command_error_display() {
        let err = AgentLoopError::CdpCommandError {
            method: "Runtime.evaluate".to_string(),
            reason: "context destroyed".to_string(),
        };
        assert_eq!(
            err.to_string(),
            "CDP command failed: Runtime.evaluate — context destroyed"
        );
    }

    #[test]
    fn test_cdp_timeout_error_display() {
        let err = AgentLoopError::CdpTimeoutError("5s".to_string());
        assert_eq!(err.to_string(), "CDP timeout: 5s");
    }

    #[test]
    fn test_copilot_page_not_found_display() {
        let err = AgentLoopError::CopilotPageNotFound("no page matching URL".to_string());
        assert_eq!(
            err.to_string(),
            "copilot page not found: no page matching URL"
        );
    }

    #[test]
    fn test_copilot_prompt_error_display() {
        let err = AgentLoopError::CopilotPromptError("composer not found".to_string());
        assert_eq!(err.to_string(), "copilot prompt failed: composer not found");
    }
}
