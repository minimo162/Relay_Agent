use thiserror::Error;

#[derive(Debug, Clone, Error, PartialEq, Eq)]
#[error("{message}")]
pub struct DesktopCoreError {
    message: String,
}

impl DesktopCoreError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_desktop_core_error_display() {
        let err = DesktopCoreError::new("boundary failed");
        assert_eq!(err.to_string(), "boundary failed");
    }

    #[test]
    fn test_desktop_core_error_clone_and_compare() {
        let err = DesktopCoreError::new("same");
        assert_eq!(err.clone(), DesktopCoreError::new("same"));
    }
}
