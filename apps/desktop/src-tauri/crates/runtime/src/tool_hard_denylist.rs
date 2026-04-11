//! Host-wide hard denylist for high-risk bash commands and sensitive file paths.
//! Applied regardless of `.claw` permission mode (unlike `bash_validation` read-only checks).

use std::io;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

static RE_SUDO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bsudo\b").expect("regex"));
static RE_RMDIR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\brmdir\b").expect("regex"));
static RE_RM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\brm\b").expect("regex"));
static RE_FIND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bfind\b").expect("regex"));
static RE_GIT_CONFIG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgit\s+config\b").expect("regex"));
static RE_GIT_PUSH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgit\s+push\b").expect("regex"));
static RE_GIT_COMMIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgit\s+commit\b").expect("regex"));
static RE_GIT_RESET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgit\s+reset\b").expect("regex"));
static RE_GIT_REBASE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgit\s+rebase\b").expect("regex"));
static RE_BREW_INSTALL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bbrew\s+install\b").expect("regex"));
static RE_CHMOD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bchmod\b").expect("regex"));
static RE_777: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b777\b").expect("regex"));
static RE_EXEC_RM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-exec\s+rm\b").expect("regex"));
static RE_XARGS_RM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bxargs\b[\s\S]{0,120}?\brm\b").expect("regex"));

const DENY_MSG: &str = "bash: command blocked by Relay hard denylist (destructive shell, sudo, or disallowed git/brew).";

fn deny() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, DENY_MSG)
}

/// True if this `rm` invocation includes destructive flags (`-r`/`-f`/etc.) anywhere before `;|&` newline.
fn rm_invocation_blocked(rest_after_rm: &str) -> bool {
    let stop = rest_after_rm
        .find(|ch| [';', '|', '&', '\n'].contains(&ch))
        .unwrap_or(rest_after_rm.len());
    let seg = rest_after_rm[..stop].trim();

    for token in seg.split_whitespace() {
        if token == "--recursive" || token == "--force" {
            return true;
        }
        if let Some(long) = token.strip_prefix("--") {
            if long.starts_with("recursive") || long.starts_with("force") {
                return true;
            }
            continue;
        }
        let Some(rest) = token.strip_prefix('-') else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }
        let cluster: String = rest
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .collect();
        let lower = cluster.to_ascii_lowercase();
        if lower.contains('r') || lower.contains('f') {
            return true;
        }
    }
    false
}

fn bash_rm_blocked(c: &str) -> bool {
    for m in RE_RM.find_iter(c) {
        if rm_invocation_blocked(&c[m.end()..]) {
            return true;
        }
    }
    false
}

fn bash_find_delete_blocked(c: &str) -> bool {
    RE_FIND.is_match(c) && c.contains("-delete")
}

/// Reject bash `command` when it matches the host hard denylist.
pub fn validate_bash_hard_deny(command: &str) -> io::Result<()> {
    let c = command.to_ascii_lowercase();

    if RE_SUDO.is_match(&c) {
        return Err(deny());
    }
    if RE_RMDIR.is_match(&c) {
        return Err(deny());
    }
    if bash_rm_blocked(&c) {
        return Err(deny());
    }
    if bash_find_delete_blocked(&c) {
        return Err(deny());
    }
    if RE_EXEC_RM.is_match(&c) {
        return Err(deny());
    }
    if RE_XARGS_RM.is_match(&c) {
        return Err(deny());
    }
    if RE_GIT_CONFIG.is_match(&c)
        || RE_GIT_PUSH.is_match(&c)
        || RE_GIT_COMMIT.is_match(&c)
        || RE_GIT_RESET.is_match(&c)
        || RE_GIT_REBASE.is_match(&c)
    {
        return Err(deny());
    }
    if RE_BREW_INSTALL.is_match(&c) {
        return Err(deny());
    }
    if RE_CHMOD.is_match(&c) && RE_777.is_match(&c) {
        return Err(deny());
    }

    Ok(())
}

const PATH_DENY_MSG: &str =
    "read_file/write_file: path blocked by Relay hard denylist (.env*, id_rsa*, *.key, *.pem).";

fn path_deny() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, PATH_DENY_MSG)
}

/// Reject reads/writes/edits under sensitive filename rules (case-insensitive basename / extension).
pub fn reject_sensitive_file_path(path: &Path) -> io::Result<()> {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Ok(());
    };
    let lower = name.to_ascii_lowercase();
    if lower.starts_with(".env") || lower.starts_with("id_rsa") {
        return Err(path_deny());
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_l = ext.to_ascii_lowercase();
        if ext_l == "key" || ext_l == "pem" {
            return Err(path_deny());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_denies_sudo_and_git_commit() {
        assert!(validate_bash_hard_deny("sudo ls").is_err());
        assert!(validate_bash_hard_deny("git commit -m x").is_err());
        assert!(validate_bash_hard_deny("cd x && git push").is_err());
    }

    #[test]
    fn bash_denies_rm_rf_and_rmdir() {
        assert!(validate_bash_hard_deny("rm -rf /tmp/x").is_err());
        assert!(validate_bash_hard_deny("/bin/rm -r foo").is_err());
        assert!(validate_bash_hard_deny("rm foo -f").is_err());
        assert!(validate_bash_hard_deny("rmdir d").is_err());
    }

    #[test]
    fn bash_allows_rm_i_and_git_status() {
        assert!(validate_bash_hard_deny("rm -i a b").is_ok());
        assert!(validate_bash_hard_deny("git status").is_ok());
        assert!(validate_bash_hard_deny("git diff").is_ok());
    }

    #[test]
    fn bash_denies_find_delete_xargs_chmod() {
        assert!(validate_bash_hard_deny("find . -name x -delete").is_err());
        assert!(validate_bash_hard_deny("find . -exec rm {} \\;").is_err());
        assert!(validate_bash_hard_deny("echo a | xargs rm").is_err());
        assert!(validate_bash_hard_deny("chmod 777 x").is_err());
        assert!(validate_bash_hard_deny("brew install jq").is_err());
    }

    #[test]
    fn bash_denies_obfuscated_destructive_sequences() {
        assert!(validate_bash_hard_deny("printf ok;SuDo id").is_err());
        assert!(validate_bash_hard_deny("echo x && /bin/RM -Rf ./tmp").is_err());
        assert!(validate_bash_hard_deny("find . -name t -DeLeTe").is_err());
    }

    #[test]
    fn bash_allows_common_safe_commands() {
        for cmd in [
            "ls -la",
            "cat Cargo.toml",
            "git status --short",
            "find . -name '*.rs' | head -n 5",
            "printf 'hello world'",
        ] {
            assert!(
                validate_bash_hard_deny(cmd).is_ok(),
                "expected safe command to pass: {cmd}"
            );
        }
    }

    #[test]
    fn path_denies_env_and_pem() {
        assert!(reject_sensitive_file_path(Path::new("/tmp/.env.local")).is_err());
        assert!(reject_sensitive_file_path(Path::new("id_rsa")).is_err());
        assert!(reject_sensitive_file_path(Path::new("/x/y.Z.PEM")).is_err());
        assert!(reject_sensitive_file_path(Path::new("readme.md")).is_ok());
    }
}
