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

pub(crate) fn rg_files(
    cwd: &Path,
    globs: &[String],
    limit: usize,
) -> io::Result<Option<FileList>> {
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
        .arg("--hidden")
        .arg("--glob=!.git/*");
    for glob in globs {
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
        files.push(cwd.join(clean_rg_path(&line)));
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
    pattern: &str,
    globs: &[String],
) -> io::Result<Option<SearchOutput>> {
    let Some(binary) = rg_binary() else {
        return Ok(None);
    };
    let mut command = Command::new(binary);
    command
        .current_dir(cwd)
        .arg("--no-config")
        .arg("--json")
        .arg("--hidden")
        .arg("--glob=!.git/*")
        .arg("--no-messages");
    for glob in globs {
        command.arg(format!("--glob={glob}"));
    }
    command.arg("--").arg(pattern).arg(".");
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
        matches.push(SearchMatch {
            path: cwd.join(clean_rg_path(&data.path.text)),
            line_number: data.line_number,
            line: data.lines.text,
        });
    }
    let status = child.wait()?;
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

fn rg_binary() -> Option<String> {
    std::env::var("RELAY_RIPGREP_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| Some(String::from("rg")))
}

fn clean_rg_path(path: &str) -> &str {
    path.strip_prefix("./")
        .or_else(|| path.strip_prefix(".\\"))
        .unwrap_or(path)
}
