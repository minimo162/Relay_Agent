use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Deserialize;
use wait_timeout::ChildExt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileList {
    pub(crate) files: Vec<PathBuf>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchMatch {
    pub(crate) path: PathBuf,
    pub(crate) line_number: usize,
    pub(crate) line: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchOutput {
    pub(crate) matches: Vec<SearchMatch>,
    pub(crate) partial: bool,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RgFilesOptions<'a> {
    pub(crate) globs: &'a [String],
    pub(crate) hidden: bool,
    pub(crate) follow: bool,
    pub(crate) max_depth: Option<usize>,
    pub(crate) limit: usize,
}

impl<'a> RgFilesOptions<'a> {
    pub(crate) fn new(globs: &'a [String], limit: usize) -> Self {
        Self {
            globs,
            hidden: true,
            follow: false,
            max_depth: None,
            limit,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RgSearchOptions<'a> {
    pub(crate) pattern: &'a str,
    pub(crate) globs: &'a [String],
    pub(crate) files: Option<&'a [String]>,
    pub(crate) hidden: bool,
    pub(crate) follow: bool,
    pub(crate) max_depth: Option<usize>,
    pub(crate) max_count: Option<usize>,
    pub(crate) limit: Option<usize>,
}

impl<'a> RgSearchOptions<'a> {
    pub(crate) fn new(pattern: &'a str, globs: &'a [String]) -> Self {
        Self {
            pattern,
            globs,
            files: None,
            hidden: true,
            follow: false,
            max_depth: None,
            max_count: None,
            limit: None,
        }
    }
}

pub(crate) fn rg_files(cwd: &Path, options: RgFilesOptions<'_>) -> io::Result<Option<FileList>> {
    let limit = options.limit;
    if limit == 0 {
        return Ok(Some(FileList {
            files: Vec::new(),
            truncated: false,
        }));
    }

    let Some(binary) = rg_binary() else {
        return Ok(None);
    };
    let mut command = Command::new(binary);
    command
        .current_dir(cwd)
        .arg("--no-config")
        .arg("--files")
        .arg("--glob=!.git/*");
    apply_default_ignore_globs(&mut command);
    apply_common_args(&mut command, options.hidden, options.follow, options.max_depth);
    for glob in options.globs {
        command.arg(format!("--glob={glob}"));
    }
    command.arg(".");
    command.stdout(Stdio::piped()).stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("failed to capture rg stdout"))?;
    let mut files = Vec::new();
    let mut truncated = false;
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if files.len() >= limit {
            truncated = true;
            let _ = child.kill();
            break;
        }
        let clean = clean_rg_path(&line);
        if !options.hidden && is_hidden_relative_path(clean) {
            continue;
        }
        files.push(cwd.join(clean));
    }
    if truncated {
        let _ = child.wait_timeout(Duration::from_secs(1))?;
    } else if !child.wait()?.success() {
        return Ok(None);
    }

    Ok(Some(FileList { files, truncated }))
}

pub(crate) fn rg_search(
    cwd: &Path,
    options: RgSearchOptions<'_>,
) -> io::Result<Option<SearchOutput>> {
    let Some(binary) = rg_binary() else {
        return Ok(None);
    };
    let mut command = Command::new(binary);
    command
        .current_dir(cwd)
        .arg("--no-config")
        .arg("--json")
        .arg("--glob=!.git/*")
        .arg("--no-messages");
    apply_default_ignore_globs(&mut command);
    apply_common_args(&mut command, options.hidden, options.follow, options.max_depth);
    if let Some(max_count) = options.max_count.filter(|value| *value > 0) {
        command.arg(format!("--max-count={max_count}"));
    }
    for glob in options.globs {
        command.arg(format!("--glob={glob}"));
    }
    command.arg("--").arg(options.pattern);
    if let Some(files) = options.files.filter(|files| !files.is_empty()) {
        for file in files {
            command.arg(file);
        }
    } else {
        command.arg(".");
    }
    command.stdout(Stdio::piped()).stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("failed to capture rg stdout"))?;
    let mut matches = Vec::new();
    let mut hit_limit = false;
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<RgEvent>(&line) else {
            continue;
        };
        let RgEvent::Match { data } = event else {
            continue;
        };
        let clean_path = clean_rg_path(&data.path.text);
        if !options.hidden && is_hidden_relative_path(clean_path) {
            continue;
        }
        matches.push(SearchMatch {
            path: cwd.join(clean_path),
            line_number: data.line_number,
            line: data.lines.text,
        });
        if options.limit.is_some_and(|limit| matches.len() >= limit) {
            hit_limit = true;
            let _ = child.kill();
            break;
        }
    }
    let status = if hit_limit {
        let _ = child.wait_timeout(Duration::from_secs(1))?;
        return Ok(Some(SearchOutput {
            matches,
            partial: true,
        }));
    } else {
        child.wait()?
    };
    if status.success() || status.code() == Some(1) {
        return Ok(Some(SearchOutput {
            matches,
            partial: false,
        }));
    }
    if status.code() == Some(2) {
        return Ok(Some(SearchOutput {
            matches,
            partial: true,
        }));
    }
    Ok(None)
}

fn apply_common_args(
    command: &mut Command,
    hidden: bool,
    follow: bool,
    max_depth: Option<usize>,
) {
    if hidden {
        command.arg("--hidden");
    } else {
        command.arg("--glob=!.*");
    }
    if follow {
        command.arg("--follow");
    }
    if let Some(max_depth) = max_depth {
        command.arg(format!("--max-depth={max_depth}"));
    }
}

fn apply_default_ignore_globs(command: &mut Command) {
    // Keep Relay's low-level search behavior close to opencode's rg-backed
    // file tools: include hidden files when requested, but skip bulky generated
    // trees that rarely contain source evidence and often dominate broad walks.
    const IGNORED_DIRS: &[&str] = &[
        ".git",
        ".svn",
        ".hg",
        "node_modules",
        "bower_components",
        ".pnpm-store",
        "vendor",
        "dist",
        "build",
        "out",
        ".next",
        "target",
        "bin",
        "obj",
        ".vscode",
        ".idea",
        ".turbo",
        ".output",
        ".cache",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".gradle",
    ];
    const IGNORED_FILES: &[&str] = &[
        "**/*.swp",
        "**/*.swo",
        "**/*.pyc",
        "**/.DS_Store",
        "**/Thumbs.db",
        "**/logs/**",
        "**/tmp/**",
        "**/temp/**",
        "**/*.log",
        "**/coverage/**",
        "**/.nyc_output/**",
    ];

    for dir in IGNORED_DIRS {
        command.arg(format!("--glob=!**/{dir}/**"));
    }
    for pattern in IGNORED_FILES {
        command.arg(format!("--glob=!{pattern}"));
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RgEvent {
    Match { data: RgMatchData },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct RgMatchData {
    path: RgText,
    lines: RgText,
    line_number: usize,
}

#[derive(Debug, Deserialize)]
struct RgText {
    text: String,
}

fn rg_binary() -> Option<PathBuf> {
    for env_key in ["RELAY_RIPGREP_PATH", "RELAY_BUNDLED_RIPGREP"] {
        if let Some(path) = env_path(env_key) {
            return Some(path);
        }
    }
    if let Some(path) = adjacent_sidecar_path() {
        return Some(path);
    }
    if let Some(path) = dev_sidecar_path() {
        return Some(path);
    }
    Some(PathBuf::from(rg_exe_name()))
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn adjacent_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let base = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    let path = base.join(format!("relay-rg{}", exe_suffix()));
    path.is_file().then_some(path)
}

fn dev_sidecar_path() -> Option<PathBuf> {
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").map(PathBuf::from)?;
    let path = manifest_dir.join("binaries").join(format!(
        "relay-rg-{}{}",
        target_triple(),
        exe_suffix()
    ));
    path.is_file().then_some(path)
}

fn rg_exe_name() -> &'static str {
    if cfg!(windows) {
        "rg.exe"
    } else {
        "rg"
    }
}

fn exe_suffix() -> &'static str {
    if cfg!(windows) {
        ".exe"
    } else {
        ""
    }
}

fn target_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (arch, os) {
        ("x86_64", "windows") => "x86_64-pc-windows-msvc".to_string(),
        ("aarch64", "windows") => "aarch64-pc-windows-msvc".to_string(),
        ("x86", "windows") => "i686-pc-windows-msvc".to_string(),
        ("x86_64", "macos") => "x86_64-apple-darwin".to_string(),
        ("aarch64", "macos") => "aarch64-apple-darwin".to_string(),
        ("x86_64", "linux") => "x86_64-unknown-linux-gnu".to_string(),
        ("aarch64", "linux") => "aarch64-unknown-linux-gnu".to_string(),
        _ => format!("{arch}-unknown-{os}"),
    }
}

fn clean_rg_path(path: &str) -> &str {
    path.strip_prefix("./")
        .or_else(|| path.strip_prefix(".\\"))
        .unwrap_or(path)
}

fn is_hidden_relative_path(path: &str) -> bool {
    path.split(['/', '\\'])
        .any(|part| part.starts_with('.') && part != "." && part != "..")
}
