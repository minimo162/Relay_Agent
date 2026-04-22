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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BashBlockReason {
    Sudo,
    Rmdir,
    RmRecursiveOrForce,
    FindDelete,
    FindExecRm,
    XargsRm,
    GitMutation,
    BrewInstall,
    Chmod777,
}

fn deny() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, DENY_MSG)
}

fn split_shell_fragments(command: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if !in_single => {
                current.push(ch);
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
                current.push(ch);
            }
            '"' if !in_single => {
                in_double = !in_double;
                current.push(ch);
            }
            ';' | '\n' if !in_single && !in_double => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
            }
            '|' if !in_single && !in_double => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
                if chars.peek() == Some(&'|') {
                    let _ = chars.next();
                }
            }
            '&' if !in_single && !in_double => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
                if chars.peek() == Some(&'&') {
                    let _ = chars.next();
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn tokenize_shell_words(segment: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let chars = segment.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in chars {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if !in_single => {
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn normalize_shell_token(token: &str) -> String {
    token
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(token)
        .trim()
        .to_ascii_lowercase()
}

fn is_env_assignment(token: &str) -> bool {
    let Some((name, _value)) = token.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && name
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        && !name.chars().next().is_some_and(|ch| ch.is_ascii_digit())
}

fn strip_wrappers(tokens: &[String]) -> &[String] {
    let mut rest = tokens;
    loop {
        while let Some(first) = rest.first() {
            if is_env_assignment(first) {
                rest = &rest[1..];
            } else {
                break;
            }
        }
        let Some(first) = rest.first() else {
            return rest;
        };
        match normalize_shell_token(first).as_str() {
            "env" => {
                rest = &rest[1..];
                while let Some(next) = rest.first() {
                    if next.starts_with('-') || is_env_assignment(next) {
                        rest = &rest[1..];
                    } else {
                        break;
                    }
                }
            }
            "command" | "builtin" | "nohup" | "time" => {
                rest = &rest[1..];
            }
            "nice" => {
                rest = &rest[1..];
                while let Some(next) = rest.first() {
                    if next.starts_with('-') {
                        rest = &rest[1..];
                    } else {
                        break;
                    }
                }
            }
            _ => return rest,
        }
    }
}

fn arg_is_rm_destructive(arg: &str) -> bool {
    let lower = arg.to_ascii_lowercase();
    if lower == "--recursive" || lower == "--force" {
        return true;
    }
    if let Some(long) = lower.strip_prefix("--") {
        return long.starts_with("recursive") || long.starts_with("force");
    }
    let Some(short) = lower.strip_prefix('-') else {
        return false;
    };
    if short.is_empty() {
        return false;
    }
    let cluster: String = short
        .chars()
        .take_while(char::is_ascii_alphanumeric)
        .collect();
    cluster.contains('r') || cluster.contains('f')
}

fn chmod_mode_is_blocked(arg: &str) -> bool {
    let trimmed = arg.trim();
    let octal = trimmed.trim_start_matches('0');
    octal == "777"
}

fn inspect_segment_tokens(tokens: &[String]) -> Option<BashBlockReason> {
    let tokens = strip_wrappers(tokens);
    let program = normalize_shell_token(tokens.first()?);
    match program.as_str() {
        "sudo" => Some(BashBlockReason::Sudo),
        "rmdir" => Some(BashBlockReason::Rmdir),
        "rm" => tokens[1..]
            .iter()
            .any(|arg| arg_is_rm_destructive(arg))
            .then_some(BashBlockReason::RmRecursiveOrForce),
        "find" => {
            if tokens[1..]
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("-delete"))
            {
                return Some(BashBlockReason::FindDelete);
            }
            tokens[1..].windows(2).find_map(|window| {
                (window[0].eq_ignore_ascii_case("-exec")
                    && matches!(normalize_shell_token(&window[1]).as_str(), "rm" | "rmdir"))
                .then_some(BashBlockReason::FindExecRm)
            })
        }
        "xargs" => tokens[1..]
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .and_then(|arg| {
                matches!(normalize_shell_token(arg).as_str(), "rm" | "rmdir")
                    .then_some(BashBlockReason::XargsRm)
            }),
        "git" => tokens
            .get(1)
            .and_then(|verb| match normalize_shell_token(verb).as_str() {
                "config" | "push" | "commit" | "reset" | "rebase" => {
                    Some(BashBlockReason::GitMutation)
                }
                _ => None,
            }),
        "brew" => tokens.get(1).and_then(|verb| {
            (normalize_shell_token(verb) == "install").then_some(BashBlockReason::BrewInstall)
        }),
        "chmod" => tokens[1..]
            .iter()
            .any(|arg| chmod_mode_is_blocked(arg))
            .then_some(BashBlockReason::Chmod777),
        _ => None,
    }
}

fn inspect_structured_bash_policy(command: &str) -> Option<BashBlockReason> {
    split_shell_fragments(command)
        .into_iter()
        .find_map(|segment| inspect_segment_tokens(&tokenize_shell_words(&segment)))
}

fn inspect_regex_fallback(command: &str) -> Option<BashBlockReason> {
    let c = command.to_ascii_lowercase();
    if RE_SUDO.is_match(&c) {
        return Some(BashBlockReason::Sudo);
    }
    if RE_RMDIR.is_match(&c) {
        return Some(BashBlockReason::Rmdir);
    }
    for m in RE_RM.find_iter(&c) {
        let stop = c[m.end()..]
            .find(|ch| [';', '|', '&', '\n'].contains(&ch))
            .map_or(c.len(), |offset| m.end() + offset);
        if c[m.end()..stop]
            .split_whitespace()
            .any(arg_is_rm_destructive)
        {
            return Some(BashBlockReason::RmRecursiveOrForce);
        }
    }
    if RE_FIND.is_match(&c) && c.contains("-delete") {
        return Some(BashBlockReason::FindDelete);
    }
    if RE_EXEC_RM.is_match(&c) {
        return Some(BashBlockReason::FindExecRm);
    }
    if RE_XARGS_RM.is_match(&c) {
        return Some(BashBlockReason::XargsRm);
    }
    if RE_GIT_CONFIG.is_match(&c)
        || RE_GIT_PUSH.is_match(&c)
        || RE_GIT_COMMIT.is_match(&c)
        || RE_GIT_RESET.is_match(&c)
        || RE_GIT_REBASE.is_match(&c)
    {
        return Some(BashBlockReason::GitMutation);
    }
    if RE_BREW_INSTALL.is_match(&c) {
        return Some(BashBlockReason::BrewInstall);
    }
    if RE_CHMOD.is_match(&c) && RE_777.is_match(&c) {
        return Some(BashBlockReason::Chmod777);
    }
    None
}

/// Reject bash `command` when it matches the host hard denylist.
pub fn validate_bash_hard_deny(command: &str) -> io::Result<()> {
    if inspect_structured_bash_policy(command).is_some()
        || inspect_regex_fallback(command).is_some()
    {
        return Err(deny());
    }
    Ok(())
}

const PATH_DENY_MSG: &str =
    "read/write: path blocked by Relay hard denylist (.env*, id_rsa*, *.key, *.pem).";

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
    use proptest::prelude::*;

    fn random_case(input: &str, flips: &[bool]) -> String {
        input
            .chars()
            .enumerate()
            .map(|(index, ch)| {
                if ch.is_ascii_alphabetic() && flips.get(index).copied().unwrap_or(false) {
                    ch.to_ascii_uppercase()
                } else {
                    ch
                }
            })
            .collect()
    }

    #[test]
    fn bash_denies_sudo_and_git_commit() {
        assert!(validate_bash_hard_deny("sudo ls").is_err());
        assert!(validate_bash_hard_deny("git commit -m x").is_err());
        assert!(validate_bash_hard_deny("cd x && git push").is_err());
        assert!(validate_bash_hard_deny("env DEBUG=1 sudo ls").is_err());
        assert!(validate_bash_hard_deny("command git reset --hard HEAD").is_err());
    }

    #[test]
    fn bash_denies_rm_rf_and_rmdir() {
        assert!(validate_bash_hard_deny("rm -rf /tmp/x").is_err());
        assert!(validate_bash_hard_deny("/bin/rm -r foo").is_err());
        assert!(validate_bash_hard_deny("rm foo -f").is_err());
        assert!(validate_bash_hard_deny("rmdir d").is_err());
        assert!(validate_bash_hard_deny("env PATH=/tmp rm --force a.txt").is_err());
    }

    #[test]
    fn bash_allows_rm_i_and_git_status() {
        assert!(validate_bash_hard_deny("rm -i a b").is_ok());
        assert!(validate_bash_hard_deny("git status").is_ok());
        assert!(validate_bash_hard_deny("git diff").is_ok());
        assert!(validate_bash_hard_deny("env PATH=/usr/bin git status --short").is_ok());
    }

    #[test]
    fn bash_denies_find_delete_xargs_chmod() {
        assert!(validate_bash_hard_deny("find . -name x -delete").is_err());
        assert!(validate_bash_hard_deny("find . -exec rm {} \\;").is_err());
        assert!(validate_bash_hard_deny("echo a | xargs rm").is_err());
        assert!(validate_bash_hard_deny("find . -type f -exec /bin/rm {} +").is_err());
        assert!(validate_bash_hard_deny("xargs -0 /bin/rmdir < dirs.txt").is_err());
        assert!(validate_bash_hard_deny("chmod 777 x").is_err());
        assert!(validate_bash_hard_deny("chmod 0777 x").is_err());
        assert!(validate_bash_hard_deny("brew install jq").is_err());
    }

    #[test]
    fn bash_denies_obfuscated_destructive_sequences() {
        assert!(validate_bash_hard_deny("printf ok;SuDo id").is_err());
        assert!(validate_bash_hard_deny("echo x && /bin/RM -Rf ./tmp").is_err());
        assert!(validate_bash_hard_deny("find . -name t -DeLeTe").is_err());
        assert!(validate_bash_hard_deny("env -i nice -n 5 sudo whoami").is_err());
    }

    #[test]
    fn bash_allows_common_safe_commands() {
        for cmd in [
            "ls -la",
            "cat Cargo.toml",
            "git status --short",
            "find . -name '*.rs' | head -n 5",
            "printf 'hello world'",
            "env FOO=bar command git diff --stat",
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

    proptest! {
        #[test]
        fn bash_structured_policy_blocks_rm_flag_variants(
            flag in prop_oneof![
                Just("-r"),
                Just("-f"),
                Just("-rf"),
                Just("-fr"),
                Just("--recursive"),
                Just("--force"),
            ],
            wraps in proptest::collection::vec(any::<bool>(), 0..16),
        ) {
            let cmd = random_case(&format!("env TMPDIR=/tmp command rm {flag} target.txt"), &wraps);
            prop_assert!(validate_bash_hard_deny(&cmd).is_err(), "command should be blocked: {cmd}");
        }

        #[test]
        fn bash_structured_policy_blocks_git_mutations_with_case_noise(
            verb in prop_oneof![
                Just("push"),
                Just("commit"),
                Just("reset"),
                Just("rebase"),
                Just("config"),
            ],
            flips in proptest::collection::vec(any::<bool>(), 0..32),
        ) {
            let cmd = random_case(&format!("env GIT_DIR=.git git {verb} origin main"), &flips);
            prop_assert!(validate_bash_hard_deny(&cmd).is_err(), "git mutation should be blocked: {cmd}");
        }

        #[test]
        fn bash_structured_policy_allows_common_git_inspection_with_case_noise(
            suffix in prop_oneof![
                Just("status --short"),
                Just("diff --stat"),
                Just("log --oneline -5"),
            ],
            flips in proptest::collection::vec(any::<bool>(), 0..32),
        ) {
            let cmd = random_case(&format!("env PATH=/usr/bin git {suffix}"), &flips);
            prop_assert!(validate_bash_hard_deny(&cmd).is_ok(), "safe git inspection should pass: {cmd}");
        }
    }
}
