//! Heuristic bash checks aligned with claw-code PARITY read-only / destructive-command ideas.
//! When project settings resolve to `read-only`, block commands that likely mutate disk or VCS.

use std::cell::RefCell;
use std::io;
use std::path::PathBuf;

use crate::config::{ConfigLoader, ResolvedPermissionMode};

thread_local! {
    static RELAY_BASH_CONFIG_ROOT: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

const MUTATING_COMMAND_SUBSTRINGS: &[&str] = &[
    " rm ",
    "\nrm ",
    "\trm ",
    ";rm ",
    "&&rm ",
    "||rm ",
    " rmdir ",
    ";rmdir ",
    " chmod ",
    ";chmod ",
    " chown ",
    ";chown ",
    " mkdir ",
    ";mkdir ",
    " mv ",
    ";mv ",
    " cp ",
    ";cp ",
    " touch ",
    ";touch ",
    " tee ",
    ";tee ",
    "git commit",
    "git push",
    "git merge",
    "git rebase",
    "git reset",
    "git stash",
];

/// Desktop agent loop sets this for the duration of one `bash` tool call so `.claw` settings
/// resolve against the session workspace (not the process CWD). Dropped after the call.
pub struct BashConfigCwdGuard {
    previous: Option<PathBuf>,
}

impl BashConfigCwdGuard {
    /// `root` is the session workspace directory used for `ConfigLoader::default_for`.
    #[must_use]
    pub fn set(root: Option<PathBuf>) -> Self {
        let previous = RELAY_BASH_CONFIG_ROOT.with(|c| {
            let mut g = c.borrow_mut();
            std::mem::replace(&mut *g, root)
        });
        Self { previous }
    }
}

impl Drop for BashConfigCwdGuard {
    fn drop(&mut self) {
        let prev = self.previous.take();
        RELAY_BASH_CONFIG_ROOT.with(|c| {
            *c.borrow_mut() = prev;
        });
    }
}

fn config_discovery_root() -> PathBuf {
    RELAY_BASH_CONFIG_ROOT.with(|c| {
        c.borrow()
            .clone()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

/// Returns `Err` if `command` should not run under the configured permission mode (e.g. read-only).
pub fn validate_bash_against_config_permission(command: &str) -> io::Result<()> {
    let mode = ConfigLoader::default_for(config_discovery_root())
        .load()
        .ok()
        .and_then(|cfg| cfg.permission_mode());

    if mode != Some(ResolvedPermissionMode::ReadOnly) {
        return Ok(());
    }

    if command_appears_mutating(command) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "bash: this command likely mutates files or git state, but permission mode is read-only \
(settings: `permissionMode` / `permissions.defaultMode`). \
Use workspace-write or danger-full-access, or use file tools / read-only-safe commands.",
        ));
    }

    Ok(())
}

fn command_appears_mutating(command: &str) -> bool {
    let c = command.to_ascii_lowercase();
    let t = c.trim_start();

    if t.starts_with("rm ") || t.starts_with("rmdir ") {
        return true;
    }

    for s in MUTATING_COMMAND_SUBSTRINGS {
        if c.contains(s) {
            return true;
        }
    }

    // Rough output redirection to a path (not `2>&1` / `>&` only)
    if (c.contains("> ") || c.contains(">>")) && !c.contains("2>&1") && !c.trim().ends_with(">&2") {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::command_appears_mutating;

    #[test]
    fn detects_rm_and_git_write() {
        assert!(command_appears_mutating("rm -f a.txt"));
        assert!(command_appears_mutating("git commit -m x"));
        assert!(command_appears_mutating("echo ok && rm x"));
    }

    #[test]
    fn allows_read_mostly_commands() {
        assert!(!command_appears_mutating("ls -la"));
        assert!(!command_appears_mutating("git status"));
        assert!(!command_appears_mutating("grep -r foo ."));
    }
}
