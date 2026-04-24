use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::DesktopCoreError;
use crate::models::BrowserAutomationSettings;

const SESSION_RECORD_VERSION: u32 = 2;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_settings: Option<BrowserAutomationSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opencode_session_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LoadedSessionMetadata {
    pub config: PersistedSessionConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSessionRecord {
    session_id: String,
    version: u32,
    #[serde(default)]
    config: PersistedSessionConfig,
    #[serde(default, skip_serializing)]
    messages: Vec<Value>,
}

pub fn save_session(
    session_id: &str,
    config: PersistedSessionConfig,
) -> Result<(), DesktopCoreError> {
    validate_session_id(session_id)
        .map_err(|e| DesktopCoreError::new(format!("invalid session_id: {e}")))?;
    let dir = session_storage_dir()?;
    fs::create_dir_all(&dir).map_err(io_error)?;
    let path = dir.join(format!("{session_id}.json"));
    let record = PersistedSessionRecord {
        session_id: session_id.to_string(),
        version: SESSION_RECORD_VERSION,
        config,
        messages: Vec::new(),
    };
    let json = serde_json::to_string_pretty(&record)
        .map_err(|error| DesktopCoreError::new(format!("failed to serialize session: {error}")))?;
    fs::write(path, json).map_err(io_error)
}

pub fn load_session(session_id: &str) -> Result<Option<LoadedSessionMetadata>, DesktopCoreError> {
    validate_session_id(session_id)
        .map_err(|e| DesktopCoreError::new(format!("invalid session_id: {e}")))?;
    let path = session_storage_dir()?.join(format!("{session_id}.json"));
    if !path.is_file() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path).map_err(io_error)?;
    let record: PersistedSessionRecord = serde_json::from_str(&contents).map_err(|error| {
        DesktopCoreError::new(format!("failed to parse saved session: {error}"))
    })?;

    if !record.messages.is_empty() {
        tracing::debug!(
            "ignored {} legacy Relay transcript messages while loading session metadata for {session_id}",
            record.messages.len()
        );
    }

    Ok(Some(LoadedSessionMetadata {
        config: record.config,
    }))
}

fn session_storage_dir() -> Result<PathBuf, DesktopCoreError> {
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .or_else(|| {
            if cfg!(target_os = "windows") {
                std::env::var("LOCALAPPDATA").ok()
            } else {
                None
            }
        })
        .map(PathBuf::from)
        .ok_or_else(|| {
            DesktopCoreError::new("unable to resolve the home directory for session storage")
        })?;
    Ok(home.join(".relay-agent").join("sessions"))
}

fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if id.len() > 128 {
        return Err(format!(
            "session_id exceeds maximum length of 128 characters (got {})",
            id.len()
        ));
    }
    for ch in id.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_' {
            return Err(format!(
                "session_id contains invalid character '{ch}' (only alphanumeric, hyphens, and underscores are allowed)"
            ));
        }
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
fn io_error(error: std::io::Error) -> DesktopCoreError {
    DesktopCoreError::new(format!("session persistence failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    #[test]
    fn test_validate_session_id_normal() {
        assert!(validate_session_id("abc-123").is_ok());
        assert!(validate_session_id("session_01").is_ok());
        assert!(validate_session_id("simple").is_ok());
    }

    #[test]
    fn test_validate_session_id_empty() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn test_validate_session_id_too_long() {
        let long = "a".repeat(129);
        assert!(validate_session_id(&long).is_err());
        assert!(validate_session_id(&"a".repeat(128)).is_ok());
    }

    #[test]
    fn test_validate_session_id_invalid_chars() {
        assert!(validate_session_id("abc/def").is_err());
        assert!(validate_session_id("abc\\def").is_err());
        assert!(validate_session_id("abc..def").is_err());
        assert!(validate_session_id("abc def").is_err());
    }

    #[test]
    fn save_session_writes_metadata_without_relay_transcript() {
        let _lock = env_lock();
        let temp = tempfile::tempdir().expect("tempdir");
        let _env = EnvGuard::set([
            ("HOME", Some(temp.path().to_string_lossy().into_owned())),
            ("USERPROFILE", None),
        ]);

        save_session(
            "session-metadata-only",
            PersistedSessionConfig {
                goal: Some("Goal".to_string()),
                cwd: Some("/tmp/work".to_string()),
                max_turns: Some(4),
                browser_settings: None,
                opencode_session_id: Some("oc-session-1".to_string()),
            },
        )
        .expect("save metadata");

        let path = session_storage_dir()
            .expect("session dir")
            .join("session-metadata-only.json");
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).expect("read saved metadata"))
                .expect("saved metadata json");
        assert_eq!(saved["version"], SESSION_RECORD_VERSION);
        assert_eq!(saved["config"]["opencodeSessionId"], "oc-session-1");
        assert!(
            saved.get("messages").is_none(),
            "Relay transcript should not be persisted: {saved}"
        );
    }

    #[test]
    fn load_session_ignores_legacy_relay_transcript_messages() {
        let _lock = env_lock();
        let temp = tempfile::tempdir().expect("tempdir");
        let _env = EnvGuard::set([
            ("HOME", Some(temp.path().to_string_lossy().into_owned())),
            ("USERPROFILE", None),
        ]);

        let dir = session_storage_dir().expect("session dir");
        fs::create_dir_all(&dir).expect("create session dir");
        fs::write(
            dir.join("session-legacy-messages.json"),
            serde_json::to_string_pretty(&json!({
                "sessionId": "session-legacy-messages",
                "version": 1,
                "messages": [
                    {
                        "role": "user",
                        "blocks": [
                            {
                                "type": "text",
                                "text": "legacy Relay transcript should be ignored"
                            }
                        ]
                    }
                ],
                "config": {
                    "goal": "Goal",
                    "opencodeSessionId": "oc-session-legacy"
                }
            }))
            .expect("legacy metadata json"),
        )
        .expect("write legacy metadata");

        let loaded = load_session("session-legacy-messages")
            .expect("load legacy metadata")
            .expect("loaded metadata");
        assert_eq!(loaded.config.goal.as_deref(), Some("Goal"));
        assert_eq!(
            loaded.config.opencode_session_id.as_deref(),
            Some("oc-session-legacy")
        );
    }

    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock")
    }

    struct EnvGuard {
        previous: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn set<const N: usize>(values: [(&'static str, Option<String>); N]) -> Self {
            let previous = values
                .iter()
                .map(|(key, _)| (*key, std::env::var(key).ok()))
                .collect::<Vec<_>>();
            for (key, value) in values {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
            Self { previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.previous.drain(..).rev() {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}
