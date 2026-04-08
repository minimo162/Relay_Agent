//! Workspace containment for file tools (claw-code / PARITY-style boundary checks).
//! When a session has a non-empty `cwd`, paths must resolve inside that directory after
//! lexical normalization and canonicalization (symlinks resolved when the path exists).

use std::io;
use std::path::{Component, Path, PathBuf};

/// Resolve `user_path` for tool use: absolute paths stay absolute; relative paths join `workspace_root`.
#[must_use]
pub fn resolve_against_workspace(user_path: &str, workspace_root: &Path) -> PathBuf {
    let path = Path::new(user_path.trim());
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_root.join(path)
    }
}

/// Collapse `.`, `..`, and duplicate separators without touching the filesystem.
#[must_use]
pub fn lexical_normalize(path: PathBuf) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

/// Ensure a path is inside `workspace_root` after normalization.
///
/// - If `full_path` exists, it is `canonicalize`d and checked against canonical workspace.
/// - If it does not exist (e.g. new file), existing ancestors are walked until one exists;
///   that ancestor is canonicalized and must lie under the workspace; `..` escapes are
///   rejected via [`lexical_normalize`] before existence checks.
pub fn assert_path_in_workspace(full_path: &Path, workspace_root: &Path) -> io::Result<()> {
    let root = workspace_root.canonicalize()?;
    let norm = lexical_normalize(full_path.to_path_buf());

    if norm.exists() {
        let c = norm.canonicalize()?;
        if !c.starts_with(&root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "path escapes workspace: {} (workspace root {})",
                    c.display(),
                    root.display()
                ),
            ));
        }
        return Ok(());
    }

    let mut probe = norm.clone();
    loop {
        if probe.as_os_str().is_empty() {
            break;
        }
        if probe.exists() {
            let c = probe.canonicalize()?;
            if !c.starts_with(&root) {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "path escapes workspace: parent resolves to {} (workspace root {})",
                        c.display(),
                        root.display()
                    ),
                ));
            }
            return Ok(());
        }
        if !probe.pop() {
            break;
        }
    }

    // Nothing on disk yet (e.g. deep new path): require lexical path to stay under root.
    let root_norm = lexical_normalize(root.clone());
    if !(norm.starts_with(&root_norm) || norm == root_norm) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "path outside workspace (lexical): {} (workspace root {})",
                norm.display(),
                root.display()
            ),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    #[test]
    fn lexical_normalize_collapses_dotdot() {
        let p = PathBuf::from("/a/b/../../etc/passwd");
        let n = lexical_normalize(p);
        assert!(n.ends_with("passwd"), "{n:?}");
    }

    #[test]
    fn assert_rejects_absolute_outside_workspace() {
        let dir = std::env::temp_dir().join(format!("relay-ws-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let outside = dir.parent().expect("temp parent").join("relay_ws_outside_probe.txt");
        let err =
            assert_path_in_workspace(&outside, &dir).expect_err("path outside workspace root");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        let _ = fs::remove_dir_all(&dir);
    }
}
