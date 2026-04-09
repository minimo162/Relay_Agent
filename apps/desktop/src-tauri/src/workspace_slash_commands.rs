//! Discover `.relay/commands/*.md` and optional `.relay/commands.json` under the workspace cwd.
//! Paths are constrained under canonicalized `cwd` (no `..` escape).

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};

use serde::Deserialize;

use crate::models::WorkspaceSlashCommandRow;

const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_MD_FILES: usize = 64;

#[derive(Debug, Deserialize)]
struct CommandsJsonEntry {
    name: String,
    #[serde(default)]
    description: Option<String>,
    body: String,
}

fn is_safe_relay_rel(path: &Path) -> bool {
    path.components().all(|c| match c {
        Component::Normal(_) => true,
        _ => false,
    })
}

/// `candidate` must be same as or under `root` (both should be canonical).
fn path_under_root(root: &Path, candidate: &Path) -> bool {
    let mut r = root.components();
    let mut c = candidate.components();
    loop {
        match (r.next(), c.next()) {
            (None, None) => return true,
            (None, Some(_)) => return true,
            (Some(_), None) => return false,
            (Some(a), Some(b)) if a == b => continue,
            _ => return false,
        }
    }
}

fn read_capped(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("file exceeds {MAX_FILE_BYTES} bytes"));
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Load workspace slash commands; returns empty if `cwd` is missing or not a directory.
pub fn list_for_cwd(cwd: Option<&str>) -> Result<Vec<WorkspaceSlashCommandRow>, String> {
    let Some(raw) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(vec![]);
    };
    let root = Path::new(raw);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("workspace path not accessible: {e}"))?;
    let relay = root_canon.join(".relay");
    let commands_dir = relay.join("commands");
    let mut by_name: HashMap<String, WorkspaceSlashCommandRow> = HashMap::new();

    let json_path = commands_dir.join("commands.json");
    if json_path.is_file() && path_under_root(&root_canon, &json_path) {
        match read_capped(&json_path) {
            Ok(text) => match serde_json::from_str::<Vec<CommandsJsonEntry>>(&text) {
                Ok(rows) => {
                    for row in rows {
                        let name = row.name.trim().to_string();
                        if name.is_empty() || !name.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
                        {
                            continue;
                        }
                        let cmd = format!("/{name}");
                        by_name.insert(
                            cmd.clone(),
                            WorkspaceSlashCommandRow {
                                name,
                                description: row.description.filter(|s| !s.trim().is_empty()),
                                body: row.body,
                                source: json_path.to_string_lossy().into_owned(),
                            },
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("[relay] .relay/commands/commands.json parse error: {e}");
                }
            },
            Err(e) => tracing::warn!("[relay] .relay/commands/commands.json read error: {e}"),
        }
    }

    if commands_dir.is_dir() && path_under_root(&root_canon, &commands_dir) {
        let read_dir = match fs::read_dir(&commands_dir) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("[relay] read_dir .relay/commands: {e}");
                return Ok(finish_sorted(by_name));
            }
        };
        let mut count = 0usize;
        for ent in read_dir.flatten() {
            if count >= MAX_MD_FILES {
                break;
            }
            let path = ent.path();
            if path.file_name().and_then(|n| n.to_str()) == Some("commands.json") {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if !path.is_file() {
                continue;
            }
            if !path_under_root(&root_canon, &path) {
                continue;
            }
            let rel = path.strip_prefix(&root_canon).unwrap_or(&path);
            if !is_safe_relay_rel(rel) {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .trim();
            if stem.is_empty()
                || !stem
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_alphabetic())
                    .unwrap_or(false)
            {
                continue;
            }
            let body = match read_capped(&path) {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!("[relay] skip {}: {e}", path.display());
                    continue;
                }
            };
            let cmd = format!("/{stem}");
            by_name.insert(
                cmd,
                WorkspaceSlashCommandRow {
                    name: stem.to_string(),
                    description: None,
                    body,
                    source: path.to_string_lossy().into_owned(),
                },
            );
            count += 1;
        }
    }

    Ok(finish_sorted(by_name))
}

fn finish_sorted(by_name: HashMap<String, WorkspaceSlashCommandRow>) -> Vec<WorkspaceSlashCommandRow> {
    let mut v: Vec<_> = by_name.into_values().collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn md_and_json_merge_md_wins_on_name() {
        let tmp = tempfile::tempdir().unwrap();
        let relay = tmp.path().join(".relay").join("commands");
        fs::create_dir_all(&relay).unwrap();
        let mut f = fs::File::create(relay.join("hello.md")).unwrap();
        writeln!(f, "from md").unwrap();
        fs::write(
            relay.join("commands.json"),
            r#"[{"name":"hello","description":"d","body":"from json"}]"#,
        )
        .unwrap();
        let list = list_for_cwd(Some(tmp.path().to_str().unwrap())).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].body.trim(), "from md");
    }
}
