use thiserror::Error;

/// Errors that can occur during agent loop execution and session management.
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

    #[error("persistence error: {0}")]
    PersistenceError(String),
}
