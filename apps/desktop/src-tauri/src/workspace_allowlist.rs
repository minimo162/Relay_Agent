//! Persist tool names allowed without prompts per normalized workspace `cwd` (OpenWork-style "always" for this folder).
//! Stored under `~/.relay-agent/workspace_allowed_tools.json`.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::models::{WorkspaceAllowlistEntryRow, WorkspaceAllowlistSnapshot};

const STORE_FILENAME: &str = "workspace_allowed_tools.json";
const STORE_LOCK_FILENAME: &str = "workspace_allowed_tools.json.lock";
const STORE_VERSION: u32 = 1;
const STORE_LOCK_RETRY_ATTEMPTS: u32 = 50;
const STORE_LOCK_RETRY_DELAY_MS: u64 = 20;

#[derive(Debug, Default, Deserialize, Serialize)]
struct StoreFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    workspaces: HashMap<String, Vec<String>>,
}

#[derive(Debug)]
struct StorePaths {
    relay_agent_dir: PathBuf,
    store_path: PathBuf,
    lock_path: PathBuf,
}

#[derive(Debug, Default)]
struct ReadStoreOutcome {
    store: StoreFile,
    warnings: Vec<String>,
}

struct StoreLockGuard {
    lock_path: PathBuf,
    _lock_file: File,
}

impl Drop for StoreLockGuard {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.lock_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    "[RelayAgent] workspace allowlist lock cleanup failed at {}: {}",
                    self.lock_path.display(),
                    error
                );
            }
        }
    }
}

fn relay_agent_dir() -> Result<PathBuf, String> {
    if let Ok(h) = std::env::var("HOME") {
        if !h.trim().is_empty() {
            return Ok(PathBuf::from(h.trim()).join(".relay-agent"));
        }
    }
    if let Ok(h) = std::env::var("USERPROFILE") {
        if !h.trim().is_empty() {
            return Ok(PathBuf::from(h.trim()).join(".relay-agent"));
        }
    }
    Err("could not resolve home directory (HOME / USERPROFILE)".into())
}

fn store_paths_for_dir(relay_agent_dir: &Path) -> StorePaths {
    StorePaths {
        relay_agent_dir: relay_agent_dir.to_path_buf(),
        store_path: relay_agent_dir.join(STORE_FILENAME),
        lock_path: relay_agent_dir.join(STORE_LOCK_FILENAME),
    }
}

fn store_paths() -> Result<StorePaths, String> {
    Ok(store_paths_for_dir(&relay_agent_dir()?))
}

fn describe_store_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn sanitize_store(store: &mut StoreFile) {
    for tools in store.workspaces.values_mut() {
        let mut seen = HashSet::new();
        let mut cleaned = Vec::new();
        for tool in tools
            .iter()
            .map(|tool| tool.trim())
            .filter(|tool| !tool.is_empty())
        {
            if seen.insert(tool.to_string()) {
                cleaned.push(tool.to_string());
            }
        }
        cleaned.sort_unstable();
        *tools = cleaned;
    }
    store.workspaces.retain(|_, tools| !tools.is_empty());
    if !store.workspaces.is_empty() {
        store.version = STORE_VERSION;
    }
}

fn read_store_from_disk(path: &Path) -> Result<Option<StoreFile>, String> {
    let data = match fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to read workspace allowlist store {}: {}",
                describe_store_path(path),
                error
            ));
        }
    };
    let mut store: StoreFile = serde_json::from_str(&data).map_err(|error| {
        format!(
            "workspace allowlist store {} contains invalid JSON: {}",
            describe_store_path(path),
            error
        )
    })?;
    sanitize_store(&mut store);
    Ok(Some(store))
}

fn read_store_lenient(paths: &StorePaths) -> ReadStoreOutcome {
    match read_store_from_disk(&paths.store_path) {
        Ok(Some(store)) => ReadStoreOutcome {
            store,
            warnings: Vec::new(),
        },
        Ok(None) => ReadStoreOutcome::default(),
        Err(error) => ReadStoreOutcome {
            store: StoreFile::default(),
            warnings: vec![error],
        },
    }
}

fn read_store_strict(paths: &StorePaths) -> Result<StoreFile, String> {
    Ok(read_store_from_disk(&paths.store_path)?.unwrap_or_default())
}

fn acquire_store_lock(paths: &StorePaths) -> Result<StoreLockGuard, String> {
    fs::create_dir_all(&paths.relay_agent_dir).map_err(|error| {
        format!(
            "failed to create relay-agent directory {}: {}",
            paths.relay_agent_dir.display(),
            error
        )
    })?;
    for _ in 0..STORE_LOCK_RETRY_ATTEMPTS {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&paths.lock_path)
        {
            Ok(mut lock_file) => {
                let _ = writeln!(
                    lock_file,
                    "pid={} created_at_ms={}",
                    std::process::id(),
                    now_unix_ms()
                );
                return Ok(StoreLockGuard {
                    lock_path: paths.lock_path.clone(),
                    _lock_file: lock_file,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                thread::sleep(Duration::from_millis(STORE_LOCK_RETRY_DELAY_MS));
            }
            Err(error) => {
                return Err(format!(
                    "failed to acquire workspace allowlist lock {}: {}",
                    paths.lock_path.display(),
                    error
                ));
            }
        }
    }
    Err(format!(
        "timed out acquiring workspace allowlist lock {}",
        paths.lock_path.display()
    ))
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

fn temp_store_path(paths: &StorePaths) -> PathBuf {
    paths.relay_agent_dir.join(format!(
        ".{}.tmp-{}-{}",
        STORE_FILENAME,
        std::process::id(),
        now_unix_ms()
    ))
}

fn replace_store_file(temp_path: &Path, store_path: &Path) -> Result<(), String> {
    tempfile::TempPath::try_from_path(temp_path)
        .and_then(|path| path.persist(store_path).map_err(|error| error.error))
        .map_err(|error| {
            format!(
                "failed to replace workspace allowlist store {}: {}",
                describe_store_path(store_path),
                error
            )
        })
}

#[cfg(unix)]
fn sync_parent_directory(store_path: &Path) -> Result<(), String> {
    let Some(parent) = store_path.parent() else {
        return Ok(());
    };
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            format!(
                "failed to sync workspace allowlist directory {}: {}",
                parent.display(),
                error
            )
        })
}

#[cfg(not(unix))]
fn sync_parent_directory(_store_path: &Path) -> Result<(), String> {
    Ok(())
}

fn write_store(paths: &StorePaths, store: &StoreFile) -> Result<(), String> {
    fs::create_dir_all(&paths.relay_agent_dir).map_err(|error| {
        format!(
            "failed to create relay-agent directory {}: {}",
            paths.relay_agent_dir.display(),
            error
        )
    })?;
    let mut normalized = StoreFile {
        version: store.version,
        workspaces: store.workspaces.clone(),
    };
    sanitize_store(&mut normalized);
    if !normalized.workspaces.is_empty() {
        normalized.version = STORE_VERSION;
    }
    let json = serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?;
    let temp_path = temp_store_path(paths);
    let write_result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "failed to create workspace allowlist temp file {}: {}",
                    temp_path.display(),
                    error
                )
            })?;
        temp_file
            .write_all(json.as_bytes())
            .map_err(|error| format!("failed to write workspace allowlist temp file: {error}"))?;
        temp_file
            .sync_all()
            .map_err(|error| format!("failed to flush workspace allowlist temp file: {error}"))?;
        drop(temp_file);
        replace_store_file(&temp_path, &paths.store_path)?;
        sync_parent_directory(&paths.store_path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn snapshot_from_paths(paths: &StorePaths) -> WorkspaceAllowlistSnapshot {
    let outcome = read_store_lenient(paths);
    for warning in &outcome.warnings {
        tracing::warn!("[RelayAgent] {warning}");
    }
    let mut entries: Vec<WorkspaceAllowlistEntryRow> = outcome
        .store
        .workspaces
        .into_iter()
        .map(|(workspace_key, tools)| WorkspaceAllowlistEntryRow {
            workspace_key,
            tools,
        })
        .collect();
    entries.sort_by(|a, b| a.workspace_key.cmp(&b.workspace_key));
    WorkspaceAllowlistSnapshot {
        store_path: describe_store_path(&paths.store_path),
        entries,
        warnings: outcome.warnings,
    }
}

/// Normalize workspace path for stable map keys (canonicalize when possible).
pub fn normalize_workspace_key(cwd: &str) -> String {
    let t = cwd.trim();
    if t.is_empty() {
        return String::new();
    }
    let p = Path::new(t);
    p.canonicalize()
        .map_or_else(|_| t.to_string(), |x| x.to_string_lossy().into_owned())
}

/// Tools remembered for this workspace folder (empty if cwd empty or unreadable).
pub fn load_for_cwd(cwd: Option<&str>) -> HashSet<String> {
    let Some(c) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return HashSet::new();
    };
    let key = normalize_workspace_key(c);
    if key.is_empty() {
        return HashSet::new();
    }
    let store = match store_paths().map(|paths| read_store_lenient(&paths)) {
        Ok(outcome) => {
            for warning in &outcome.warnings {
                tracing::warn!("[RelayAgent] {warning}");
            }
            outcome.store
        }
        Err(error) => {
            tracing::warn!("[RelayAgent] workspace allowlist unavailable: {error}");
            return HashSet::new();
        }
    };
    store
        .workspaces
        .get(&key)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Full allow-list snapshot for Settings UI (sorted by workspace key).
pub fn snapshot() -> Result<WorkspaceAllowlistSnapshot, String> {
    let paths = store_paths()?;
    Ok(snapshot_from_paths(&paths))
}

/// Remove one tool from the normalized workspace entry; drops the key if the list becomes empty.
pub fn remove_tool_for_cwd(cwd: &str, tool_name: &str) -> Result<(), String> {
    let key = normalize_workspace_key(cwd);
    if key.is_empty() {
        return Err("workspace path is empty".into());
    }
    let t = tool_name.trim();
    if t.is_empty() {
        return Err("tool name is empty".into());
    }
    let paths = store_paths()?;
    let _lock = acquire_store_lock(&paths)?;
    let mut store = read_store_strict(&paths)?;
    let Some(entry) = store.workspaces.get_mut(&key) else {
        return Ok(());
    };
    entry.retain(|x| x != t);
    if entry.is_empty() {
        store.workspaces.remove(&key);
    }
    write_store(&paths, &store)
}

/// Remove all persisted allows for this workspace key.
pub fn clear_cwd(cwd: &str) -> Result<(), String> {
    let key = normalize_workspace_key(cwd);
    if key.is_empty() {
        return Err("workspace path is empty".into());
    }
    let paths = store_paths()?;
    let _lock = acquire_store_lock(&paths)?;
    let mut store = read_store_strict(&paths)?;
    store.workspaces.remove(&key);
    write_store(&paths, &store)
}

/// Insert `tool_name` for `cwd` and flush to disk.
pub fn remember_tool_for_workspace(cwd: &str, tool_name: &str) -> Result<(), String> {
    let key = normalize_workspace_key(cwd);
    if key.is_empty() {
        return Err("workspace path is empty".into());
    }
    let t = tool_name.trim();
    if t.is_empty() {
        return Err("tool name is empty".into());
    }
    let paths = store_paths()?;
    let _lock = acquire_store_lock(&paths)?;
    let mut store = read_store_strict(&paths)?;
    store.version = STORE_VERSION;
    let entry = store.workspaces.entry(key).or_default();
    if !entry.iter().any(|x| x == t) {
        entry.push(t.to_string());
    }
    write_store(&paths, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_paths(temp_dir: &TempDir) -> StorePaths {
        store_paths_for_dir(temp_dir.path())
    }

    #[test]
    fn snapshot_reports_invalid_json_warning() {
        let temp_dir = TempDir::new().expect("temp dir");
        let paths = test_paths(&temp_dir);
        fs::write(&paths.store_path, "{ invalid json").expect("write corrupt store");

        let snapshot = snapshot_from_paths(&paths);

        assert!(snapshot.entries.is_empty());
        assert_eq!(snapshot.warnings.len(), 1);
        assert!(snapshot.warnings[0].contains("invalid JSON"));
        assert!(snapshot.warnings[0].contains("workspace_allowed_tools.json"));
    }

    #[test]
    fn remember_tool_refuses_to_overwrite_corrupted_store() {
        let temp_dir = TempDir::new().expect("temp dir");
        let paths = test_paths(&temp_dir);
        fs::write(&paths.store_path, "{ invalid json").expect("write corrupt store");

        let lock = acquire_store_lock(&paths).expect("lock");
        let error = read_store_strict(&paths).expect_err("corrupt store should fail");
        drop(lock);

        assert!(error.contains("invalid JSON"));
        let current = fs::read_to_string(&paths.store_path).expect("read store");
        assert_eq!(current, "{ invalid json");
    }

    #[test]
    fn write_store_cleans_duplicates_and_snapshot_sorts_entries() {
        let temp_dir = TempDir::new().expect("temp dir");
        let paths = test_paths(&temp_dir);
        let mut store = StoreFile {
            version: 0,
            workspaces: HashMap::new(),
        };
        store.workspaces.insert(
            "/b".to_string(),
            vec!["bash".to_string(), " bash ".to_string(), "".to_string()],
        );
        store.workspaces.insert(
            "/a".to_string(),
            vec!["read_file".to_string(), "glob_search".to_string()],
        );

        write_store(&paths, &store).expect("write store");
        let snapshot = snapshot_from_paths(&paths);

        assert!(snapshot.warnings.is_empty());
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[0].workspace_key, "/a");
        assert_eq!(snapshot.entries[1].workspace_key, "/b");
        assert_eq!(snapshot.entries[1].tools, vec!["bash".to_string()]);
        assert!(!paths.lock_path.exists());
    }
}
