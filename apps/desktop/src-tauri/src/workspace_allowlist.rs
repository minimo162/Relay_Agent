//! Persist tool names allowed without prompts per normalized workspace `cwd` (OpenWork-style "always" for this folder).
//! Stored under `~/.relay-agent/workspace_allowed_tools.json`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::{WorkspaceAllowlistEntryRow, WorkspaceAllowlistSnapshot};

#[derive(Debug, Default, Deserialize, Serialize)]
struct StoreFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    workspaces: HashMap<String, Vec<String>>,
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

fn store_path() -> Result<PathBuf, String> {
    Ok(relay_agent_dir()?.join("workspace_allowed_tools.json"))
}

/// Normalize workspace path for stable map keys (canonicalize when possible).
pub fn normalize_workspace_key(cwd: &str) -> String {
    let t = cwd.trim();
    if t.is_empty() {
        return String::new();
    }
    let p = Path::new(t);
    p.canonicalize()
        .map(|x| x.to_string_lossy().into_owned())
        .unwrap_or_else(|_| t.to_string())
}

fn read_store() -> StoreFile {
    let Ok(path) = store_path() else {
        return StoreFile::default();
    };
    let data = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return StoreFile::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn write_store(store: &StoreFile) -> Result<(), String> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
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
    let store = read_store();
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
    let path = store_path()?;
    let store = read_store();
    let mut entries: Vec<WorkspaceAllowlistEntryRow> = store
        .workspaces
        .into_iter()
        .map(|(workspace_key, tools)| WorkspaceAllowlistEntryRow {
            workspace_key,
            tools,
        })
        .collect();
    entries.sort_by(|a, b| a.workspace_key.cmp(&b.workspace_key));
    Ok(WorkspaceAllowlistSnapshot {
        store_path: path.to_string_lossy().into_owned(),
        entries,
    })
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
    let mut store = read_store();
    let Some(entry) = store.workspaces.get_mut(&key) else {
        return Ok(());
    };
    entry.retain(|x| x != t);
    if entry.is_empty() {
        store.workspaces.remove(&key);
    }
    write_store(&store)
}

/// Remove all persisted allows for this workspace key.
pub fn clear_cwd(cwd: &str) -> Result<(), String> {
    let key = normalize_workspace_key(cwd);
    if key.is_empty() {
        return Err("workspace path is empty".into());
    }
    let mut store = read_store();
    store.workspaces.remove(&key);
    write_store(&store)
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
    let mut store = read_store();
    store.version = 1;
    let entry = store.workspaces.entry(key).or_default();
    if !entry.iter().any(|x| x == t) {
        entry.push(t.to_string());
    }
    write_store(&store)
}
