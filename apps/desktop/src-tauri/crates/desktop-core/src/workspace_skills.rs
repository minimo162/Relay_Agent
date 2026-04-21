//! Workspace skills loaded from `<workspace>/.relay/skills/*.md`.
//!
//! A skill is a reusable prompt + (optional) recommended tool/allowlist hint.
//! Frontmatter is parsed in TypeScript for display; this module only enumerates
//! .md files safely under the workspace root and returns their raw bodies.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};

use crate::models::WorkspaceSkillRow;

const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_MD_FILES: usize = 64;

fn is_safe_relay_rel(path: &Path) -> bool {
    path.components().all(|c| matches!(c, Component::Normal(_)))
}

fn path_under_root(root: &Path, candidate: &Path) -> bool {
    let mut r = root.components();
    let mut c = candidate.components();
    loop {
        match (r.next(), c.next()) {
            (None, None | Some(_)) => return true,
            (Some(a), Some(b)) if a == b => {}
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

pub fn list_for_cwd(cwd: Option<&str>) -> Result<Vec<WorkspaceSkillRow>, String> {
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
    let skills_dir = root_canon.join(".relay").join("skills");
    if !skills_dir.is_dir() || !path_under_root(&root_canon, &skills_dir) {
        return Ok(vec![]);
    }

    let mut by_name: HashMap<String, WorkspaceSkillRow> = HashMap::new();
    let read_dir = match fs::read_dir(&skills_dir) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("[relay] read_dir .relay/skills: {e}");
            return Ok(vec![]);
        }
    };
    let mut count = 0usize;
    for ent in read_dir.flatten() {
        if count >= MAX_MD_FILES {
            break;
        }
        let path = ent.path();
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
        if stem.is_empty() || !stem.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        let body = match read_capped(&path) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("[relay] skip skill {}: {e}", path.display());
                continue;
            }
        };
        by_name.insert(
            stem.to_string(),
            WorkspaceSkillRow {
                name: stem.to_string(),
                description: None,
                body,
                source: path.to_string_lossy().into_owned(),
            },
        );
        count += 1;
    }

    let mut v: Vec<_> = by_name.into_values().collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_md_under_dot_relay_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(".relay").join("skills");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("audit.md"), "# Audit\nbody").unwrap();
        fs::write(dir.join("ignored.txt"), "no").unwrap();
        let list = list_for_cwd(Some(tmp.path().to_str().unwrap())).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "audit");
        assert!(list[0].body.contains("body"));
    }

    #[test]
    fn missing_skills_dir_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let list = list_for_cwd(Some(tmp.path().to_str().unwrap())).unwrap();
        assert!(list.is_empty());
    }
}
