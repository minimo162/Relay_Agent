use std::cmp::Reverse;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Instant;

use glob::Pattern;
use image::GenericImageView;
use image::ImageReader;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

use crate::office;
use crate::pdf_liteparse;
use crate::search_backend;
use crate::tool_hard_denylist::reject_sensitive_file_path;

/// Upper bound for loading a single file as UTF-8 text in `read` (plain text and `.ipynb` raw JSON).
pub const MAX_TEXT_FILE_READ_BYTES: u64 = 10 * 1024 * 1024;

/// Upper bound for `write` body size (aligned with claw-code `MAX_WRITE_SIZE` at the pinned SHA).
pub const MAX_WRITE_FILE_BYTES: usize = 10 * 1024 * 1024;

const MAX_GREP_LINE_LENGTH: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TextFilePayload {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
    #[serde(rename = "numLines")]
    pub num_lines: usize,
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "totalLines")]
    pub total_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadFileOutput {
    #[serde(rename = "type")]
    pub kind: String,
    pub file: TextFilePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StructuredPatchHunk {
    #[serde(rename = "oldStart")]
    pub old_start: usize,
    #[serde(rename = "oldLines")]
    pub old_lines: usize,
    #[serde(rename = "newStart")]
    pub new_start: usize,
    #[serde(rename = "newLines")]
    pub new_lines: usize,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WriteFileOutput {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
    #[serde(rename = "structuredPatch")]
    pub structured_patch: Vec<StructuredPatchHunk>,
    #[serde(rename = "originalFile")]
    pub original_file: Option<String>,
    #[serde(rename = "gitDiff")]
    pub git_diff: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EditFileOutput {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "oldString")]
    pub old_string: String,
    #[serde(rename = "newString")]
    pub new_string: String,
    #[serde(rename = "originalFile")]
    pub original_file: String,
    #[serde(rename = "structuredPatch")]
    pub structured_patch: Vec<StructuredPatchHunk>,
    #[serde(rename = "userModified")]
    pub user_modified: bool,
    #[serde(rename = "replaceAll")]
    pub replace_all: bool,
    #[serde(rename = "gitDiff")]
    pub git_diff: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GlobSearchOutput {
    #[serde(rename = "durationMs")]
    pub duration_ms: u128,
    #[serde(rename = "numFiles")]
    pub num_files: usize,
    pub filenames: Vec<String>,
    pub truncated: bool,
    pub pattern: String,
    #[serde(rename = "baseDir")]
    pub base_dir: String,
    #[serde(rename = "searchPattern")]
    pub search_pattern: String,
    #[serde(rename = "expandedPatterns")]
    pub expanded_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GrepSearchInput {
    pub pattern: String,
    pub path: Option<String>,
    pub include: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GrepSearchOutput {
    pub mode: Option<String>,
    #[serde(rename = "numFiles")]
    pub num_files: usize,
    pub filenames: Vec<String>,
    pub content: Option<String>,
    #[serde(rename = "numLines")]
    pub num_lines: Option<usize>,
    #[serde(rename = "numMatches")]
    pub num_matches: Option<usize>,
    #[serde(rename = "appliedLimit")]
    pub applied_limit: Option<usize>,
    #[serde(rename = "appliedOffset")]
    pub applied_offset: Option<usize>,
}

/// Read a file as text for the agent. Plain UTF-8 text uses line-based `offset` / `limit`.
/// `.ipynb` is rendered as numbered plain text. `.pdf` uses `pages` (1-based, e.g. `"1-3"` or `"5"`).
/// Common image formats return dimensions and format metadata (pixels are not passed to the LLM in this build).
pub fn read(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    pages: Option<&str>,
    sheets: Option<&str>,
    slides: Option<&str>,
) -> io::Result<ReadFileOutput> {
    let attempted_path = normalize_path_allow_missing(path)?;
    reject_sensitive_file_path(&attempted_path)?;
    let absolute_path = attempted_path
        .canonicalize()
        .map_err(|error| annotate_read_error(error, &attempted_path))?;
    let lossy_path = absolute_path.to_string_lossy().into_owned();
    if absolute_path.is_dir() {
        if pages.is_some() || sheets.is_some() || slides.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "`pages`, `sheets`, and `slides` do not apply to directories",
            ));
        }
        return read_directory_listing(lossy_path, &absolute_path, offset, limit);
    }

    let ext = absolute_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    let full_text = match ext.as_deref() {
        Some("ipynb") => {
            let raw = fs::read(&absolute_path)
                .map_err(|error| annotate_read_error(error, &absolute_path))?;
            if raw.len() as u64 > MAX_TEXT_FILE_READ_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("notebook file too large (limit {MAX_TEXT_FILE_READ_BYTES} bytes)"),
                ));
            }
            let raw = String::from_utf8(raw).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "notebook is not valid UTF-8")
            })?;
            format_ipynb_text(&raw)?
        }
        Some("pdf") => pdf_liteparse::read_pdf_as_text(&absolute_path, pages)
            .map_err(|error| annotate_read_error(error, &absolute_path))?,
        Some("docx") => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` do not apply to DOCX files",
                ));
            }
            office::read_docx_as_text(&absolute_path)
                .map_err(|error| annotate_read_error(error, &absolute_path))?
        }
        Some("xlsx" | "xlsm") => {
            if pages.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` and `slides` do not apply to Excel files",
                ));
            }
            office::read_xlsx_as_text(&absolute_path, sheets)
                .map_err(|error| annotate_read_error(error, &absolute_path))?
        }
        Some("pptx") => {
            if pages.is_some() || sheets.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` and `sheets` do not apply to PPTX files",
                ));
            }
            office::read_pptx_as_text(&absolute_path, slides)
                .map_err(|error| annotate_read_error(error, &absolute_path))?
        }
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` apply only to matching PDF/Office files",
                ));
            }
            read_image_summary(&absolute_path)
                .map_err(|error| annotate_read_error(error, &absolute_path))?
        }
        _ => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` apply only to matching PDF/Office files",
                ));
            }
            let bytes = fs::read(&absolute_path)
                .map_err(|error| annotate_read_error(error, &absolute_path))?;
            if bytes.len() as u64 > MAX_TEXT_FILE_READ_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "file too large to read as text (limit {MAX_TEXT_FILE_READ_BYTES} bytes); use a smaller file or split the content"
                    ),
                ));
            }
            if bytes.contains(&0) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "file appears binary (NUL byte); not read as UTF-8 text",
                ));
            }
            String::from_utf8(bytes).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "file is not valid UTF-8; try a supported type (.pdf, .ipynb, png/jpg/gif/webp/bmp) or convert to text first",
                )
            })?
        }
    };

    Ok(slice_text_payload(lossy_path, &full_text, offset, limit))
}

fn annotate_read_error(error: io::Error, attempted_path: &Path) -> io::Error {
    if error.kind() == io::ErrorKind::NotFound {
        let suggestions = read_missing_path_suggestions(attempted_path);
        let suggestion_block = if suggestions.is_empty() {
            String::new()
        } else {
            format!("\n\nDid you mean one of these?\n{}", suggestions.join("\n"))
        };
        io::Error::new(
            error.kind(),
            format!(
                "{}; resolved path: {}{}",
                error,
                attempted_path.to_string_lossy(),
                suggestion_block
            ),
        )
    } else {
        error
    }
}

fn read_missing_path_suggestions(attempted_path: &Path) -> Vec<String> {
    let Some(parent) = attempted_path.parent() else {
        return Vec::new();
    };
    let Some(base) = attempted_path.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };
    let base_lower = base.to_ascii_lowercase();
    let base_stem_lower = attempted_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| base_lower.clone());
    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut suggestions = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let name_lower = name.to_ascii_lowercase();
            let name_stem_lower = entry
                .path()
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_else(|| name_lower.clone());
            (name_lower.contains(&base_lower)
                || base_lower.contains(&name_lower)
                || name_stem_lower.contains(&base_stem_lower)
                || base_stem_lower.contains(&name_stem_lower))
            .then(|| entry.path().to_string_lossy().into_owned())
        })
        .collect::<Vec<_>>();
    suggestions.sort();
    suggestions.truncate(3);
    suggestions
}

fn read_directory_listing(
    lossy_path: String,
    absolute_path: &Path,
    offset: Option<usize>,
    limit: Option<usize>,
) -> io::Result<ReadFileOutput> {
    let mut entries = fs::read_dir(absolute_path)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let mut name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() {
                name.push('/');
            }
            Some(name)
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()));
    let full_text = entries.join("\n");
    let mut output = slice_text_payload(lossy_path, &full_text, offset, limit);
    output.kind = String::from("directory");
    Ok(output)
}

fn slice_text_payload(
    file_path: String,
    full_text: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> ReadFileOutput {
    let lines: Vec<&str> = full_text.lines().collect();
    let start_index = offset.unwrap_or(0).min(lines.len());
    let end_index = limit.map_or(lines.len(), |limit| {
        start_index.saturating_add(limit).min(lines.len())
    });
    let selected = lines[start_index..end_index].join("\n");

    ReadFileOutput {
        kind: String::from("text"),
        file: TextFilePayload {
            file_path,
            content: selected,
            num_lines: end_index.saturating_sub(start_index),
            start_line: start_index.saturating_add(1),
            total_lines: lines.len(),
        },
    }
}

fn cell_source_as_string(source: &Value) -> String {
    match source {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|v| v.as_str()).collect::<String>(),
        _ => String::new(),
    }
}

fn summarize_notebook_outputs(outputs: &[Value]) -> String {
    let mut lines = Vec::new();
    for output in outputs {
        let kind = output
            .get("output_type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match kind {
            "stream" => {
                let name = output
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("stream");
                let text = output
                    .get("text")
                    .map(cell_source_as_string)
                    .unwrap_or_default();
                let preview: String = text.chars().take(500).collect();
                let ellipses = if text.len() > 500 { "…" } else { "" };
                lines.push(format!("    [{name}] {preview}{ellipses}"));
            }
            "execute_result" | "display_data" => {
                let mime_keys = output
                    .get("data")
                    .and_then(Value::as_object)
                    .map(|m| m.keys().map(String::as_str).collect::<Vec<_>>().join(", "))
                    .unwrap_or_default();
                lines.push(format!("    [data] {mime_keys}"));
            }
            "error" => {
                let ename = output
                    .get("ename")
                    .and_then(Value::as_str)
                    .unwrap_or("Error");
                let evalue = output.get("evalue").and_then(Value::as_str).unwrap_or("");
                lines.push(format!("    [error] {ename}: {evalue}"));
            }
            other => lines.push(format!("    [{other}]")),
        }
    }
    lines.join("\n")
}

fn format_ipynb_text(raw: &str) -> io::Result<String> {
    let notebook: Value =
        serde_json::from_str(raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let cells = notebook
        .get("cells")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "notebook JSON missing cells array",
            )
        })?;

    let mut out = Vec::new();
    let mut line_no = 1usize;
    for (i, cell) in cells.iter().enumerate() {
        let cell_type = cell.get("cell_type").and_then(Value::as_str).unwrap_or("?");
        let source = cell_source_as_string(cell.get("source").unwrap_or(&Value::Null));
        out.push(format!("{line_no:6}\t### Cell[{i}] ({cell_type})"));
        line_no += 1;
        for line in source.lines() {
            out.push(format!("{line_no:6}\t{line}"));
            line_no += 1;
        }
        if cell_type == "code" {
            if let Some(outputs) = cell.get("outputs").and_then(Value::as_array) {
                if !outputs.is_empty() {
                    out.push(format!("{line_no:6}\t### outputs"));
                    line_no += 1;
                    for summary_line in summarize_notebook_outputs(outputs).lines() {
                        out.push(format!("{line_no:6}\t{summary_line}"));
                        line_no += 1;
                    }
                }
            }
        }
    }
    Ok(out.join("\n"))
}

fn read_image_summary(path: &Path) -> io::Result<String> {
    let reader = ImageReader::open(path).map_err(|e| io::Error::other(e.to_string()))?;
    let reader = reader
        .with_guessed_format()
        .map_err(|e| io::Error::other(e.to_string()))?;
    let format = reader
        .format()
        .map_or_else(|| "unknown".into(), |f| format!("{f:?}"));
    let img = reader
        .decode()
        .map_err(|e| io::Error::other(e.to_string()))?;
    let (w, h) = img.dimensions();
    Ok(format!(
        "[Image file — multimodal LLM attachment is not wired through tool results in this build.]\npath: {}\nformat: {format}\nwidth: {w}\nheight: {h}\n",
        path.display()
    ))
}

pub fn write(path: &str, content: &str) -> io::Result<WriteFileOutput> {
    if content.len() > MAX_WRITE_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "content is too large ({} bytes, max {} bytes)",
                content.len(),
                MAX_WRITE_FILE_BYTES
            ),
        ));
    }

    let absolute_path = normalize_path_allow_missing(path)?;
    reject_sensitive_file_path(&absolute_path)?;
    let original_file = fs::read_to_string(&absolute_path).ok();
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&absolute_path, content)?;

    Ok(WriteFileOutput {
        kind: if original_file.is_some() {
            String::from("update")
        } else {
            String::from("create")
        },
        file_path: absolute_path.to_string_lossy().into_owned(),
        content: content.to_owned(),
        structured_patch: make_patch(original_file.as_deref().unwrap_or(""), content),
        original_file,
        git_diff: None,
    })
}

pub fn edit(
    path: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> io::Result<EditFileOutput> {
    let absolute_path = normalize_path(path)?;
    reject_sensitive_file_path(&absolute_path)?;
    let original_file = fs::read_to_string(&absolute_path)?;
    if old_string == new_string {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "old_string and new_string must differ",
        ));
    }
    let line_ending = detect_line_ending(&original_file);
    let old_string = convert_to_line_ending(&normalize_line_endings(old_string), line_ending);
    let new_string = convert_to_line_ending(&normalize_line_endings(new_string), line_ending);
    if old_string == new_string {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "old_string and new_string must differ",
        ));
    }
    let matched_old_string = match_edit_old_string(&original_file, &old_string, replace_all)?;
    let occurrences = original_file.matches(&matched_old_string).count();
    if occurrences == 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "old_string not found in file",
        ));
    }
    if !replace_all && occurrences != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "old_string must match exactly once when replace_all is false (found {occurrences} occurrences); add context or set replace_all"
            ),
        ));
    }

    let updated = if replace_all {
        original_file.replace(&matched_old_string, &new_string)
    } else {
        original_file.replacen(&matched_old_string, &new_string, 1)
    };
    fs::write(&absolute_path, &updated)?;

    Ok(EditFileOutput {
        file_path: absolute_path.to_string_lossy().into_owned(),
        old_string: matched_old_string,
        new_string,
        original_file: original_file.clone(),
        structured_patch: make_patch(&original_file, &updated),
        user_modified: false,
        replace_all,
        git_diff: None,
    })
}

fn match_edit_old_string(content: &str, old_string: &str, replace_all: bool) -> io::Result<String> {
    if content.contains(old_string) {
        return Ok(old_string.to_string());
    }

    let trimmed_matches = line_trimmed_matches(content, old_string);
    match trimmed_matches.len() {
        0 => Ok(old_string.to_string()),
        1 => Ok(trimmed_matches[0].clone()),
        count if replace_all => {
            let mut unique = trimmed_matches;
            unique.sort();
            unique.dedup();
            if unique.len() == 1 {
                Ok(unique.remove(0))
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "old_string matched {count} trimmed-line blocks with different original text; add exact context"
                    ),
                ))
            }
        }
        count => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "old_string matched {count} trimmed-line blocks; add exact context or set replace_all"
            ),
        )),
    }
}

fn line_trimmed_matches(content: &str, old_string: &str) -> Vec<String> {
    let content_lines = content.split('\n').collect::<Vec<_>>();
    let mut search_lines = old_string.split('\n').collect::<Vec<_>>();
    if search_lines.last().is_some_and(|line| line.is_empty()) {
        search_lines.pop();
    }
    if search_lines.is_empty() || search_lines.len() > content_lines.len() {
        return Vec::new();
    }

    let mut matches = Vec::new();
    for start in 0..=content_lines.len() - search_lines.len() {
        let candidate = &content_lines[start..start + search_lines.len()];
        if candidate
            .iter()
            .zip(search_lines.iter())
            .all(|(actual, expected)| actual.trim() == expected.trim())
        {
            matches.push(candidate.join("\n"));
        }
    }
    matches
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn detect_line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn convert_to_line_ending(text: &str, ending: &str) -> String {
    if ending == "\r\n" {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

#[derive(Debug, Clone, Default)]
pub struct GlobSearchOptions {
    pub follow: Option<bool>,
    pub max_depth: Option<usize>,
    pub hidden: Option<bool>,
}

pub fn glob(pattern: &str, path: Option<&str>) -> io::Result<GlobSearchOutput> {
    glob_with_options(pattern, path, &GlobSearchOptions::default())
}

pub fn glob_with_options(
    pattern: &str,
    path: Option<&str>,
    options: &GlobSearchOptions,
) -> io::Result<GlobSearchOutput> {
    let started = Instant::now();
    let base_dir = normalize_optional_search_path(path)?;
    if base_dir.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "glob path must be a directory: {}",
                base_dir.to_string_lossy()
            ),
        ));
    }
    let search_pattern = if Path::new(pattern).is_absolute() {
        pattern.to_owned()
    } else {
        base_dir.join(pattern).to_string_lossy().into_owned()
    };

    let (mut matches, rg_truncated) = if !Path::new(pattern).is_absolute() {
        let globs = vec![pattern.to_string()];
        let mut rg_options = search_backend::RgFilesOptions::new(&globs, 101);
        rg_options.hidden = options.hidden.unwrap_or(true);
        rg_options.follow = options.follow.unwrap_or(false);
        rg_options.max_depth = options.max_depth;
        match search_backend::rg_files(&base_dir, rg_options)? {
            Some(result) => (result.files, result.truncated),
            None => (
                glob_fallback(pattern, &search_pattern, &base_dir, options)?,
                false,
            ),
        }
    } else {
        (
            glob_fallback(pattern, &search_pattern, &base_dir, options)?,
            false,
        )
    };

    sort_paths_by_modified_desc(&mut matches);

    let truncated = rg_truncated || matches.len() > 100;
    let filenames = matches
        .into_iter()
        .take(100)
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    let output = GlobSearchOutput {
        duration_ms: started.elapsed().as_millis(),
        num_files: filenames.len(),
        filenames,
        truncated,
        pattern: pattern.to_string(),
        base_dir: base_dir.to_string_lossy().into_owned(),
        search_pattern,
        expanded_patterns: vec![pattern.to_string()],
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "glob",
        pattern = %output.pattern,
        base_dir = %output.base_dir,
        search_pattern = %output.search_pattern,
        expanded_patterns = ?output.expanded_patterns,
        num_files = output.num_files,
        truncated = output.truncated,
        duration_ms = output.duration_ms,
        "glob completed"
    );
    Ok(output)
}

fn glob_fallback(
    original_pattern: &str,
    search_pattern: &str,
    base_dir: &Path,
    options: &GlobSearchOptions,
) -> io::Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut matches = Vec::new();
    let entries = glob::glob(search_pattern)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    for entry in entries.flatten() {
        if entry.is_file() && !is_ignored_search_path(&entry) && seen.insert(entry.clone()) {
            matches.push(entry);
        }
    }
    if matches.is_empty() && !Path::new(original_pattern).is_absolute() {
        for matched in walk_glob_matches(base_dir, original_pattern, options)? {
            if seen.insert(matched.clone()) {
                matches.push(matched);
            }
        }
    }
    Ok(matches)
}

fn walk_glob_matches(
    base_dir: &Path,
    pattern: &str,
    options: &GlobSearchOptions,
) -> io::Result<Vec<PathBuf>> {
    let pattern = Pattern::new(pattern)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    let mut matches = Vec::new();
    let mut walker = WalkDir::new(base_dir).follow_links(options.follow.unwrap_or(false));
    if let Some(max_depth) = options.max_depth {
        walker = walker.max_depth(max_depth);
    }
    for entry in walker.into_iter().filter_entry(|entry| {
        !is_ignored_search_path(entry.path())
            && (options.hidden.unwrap_or(true) || !is_hidden_search_path(base_dir, entry.path()))
    }) {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if !path.is_file()
            || is_ignored_search_path(path)
            || (!options.hidden.unwrap_or(true) && is_hidden_search_path(base_dir, path))
        {
            continue;
        }
        let Ok(relative) = path.strip_prefix(base_dir) else {
            continue;
        };
        if pattern.matches_path(relative) {
            matches.push(path.to_path_buf());
        }
    }
    Ok(matches)
}

pub fn grep(input: &GrepSearchInput) -> io::Result<GrepSearchOutput> {
    if input.pattern.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "grep pattern is required",
        ));
    }
    validate_grep_pattern(input)?;

    let base_path = normalize_optional_search_path(input.path.as_deref())?;

    if let Some(output) = grep_with_rg(input, &base_path)? {
        return Ok(output);
    }

    grep_fallback(input, &base_path)
}

fn validate_grep_pattern(input: &GrepSearchInput) -> io::Result<()> {
    RegexBuilder::new(&input.pattern)
        .build()
        .map(|_| ())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))
}

fn grep_with_rg(input: &GrepSearchInput, base_path: &Path) -> io::Result<Option<GrepSearchOutput>> {
    let globs = input
        .include
        .as_ref()
        .map(|glob| vec![glob.clone()])
        .unwrap_or_default();
    let (search_root, files) = if base_path.is_file() {
        let parent = base_path.parent().unwrap_or_else(|| Path::new("."));
        let file_name = base_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("grep path has no filename: {}", base_path.display()),
                )
            })?;
        (parent, Some(vec![file_name]))
    } else {
        (base_path, None)
    };
    let Some(result) = search_backend::rg_search(
        search_root,
        search_backend::RgSearchOptions {
            files: files.as_deref(),
            ..search_backend::RgSearchOptions::new(&input.pattern, &globs)
        },
    )?
    else {
        return Ok(None);
    };
    let mut matches = result.matches;
    matches.sort_by(|left, right| {
        Reverse(modified_ms(&left.path))
            .cmp(&Reverse(modified_ms(&right.path)))
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.line_number.cmp(&right.line_number))
    });
    let mut filenames = Vec::new();
    let mut seen = HashSet::new();
    for item in &matches {
        if seen.insert(item.path.clone()) {
            filenames.push(item.path.to_string_lossy().into_owned());
        }
    }
    let lines = matches
        .iter()
        .take(100)
        .map(|item| {
            format!(
                "{}:{}:{}",
                item.path.to_string_lossy(),
                item.line_number,
                truncate_grep_line(item.line.trim_end_matches(['\r', '\n']))
            )
        })
        .collect::<Vec<_>>();
    let output = GrepSearchOutput {
        mode: Some(String::from("content")),
        num_files: filenames.len(),
        filenames,
        content: Some(lines.join("\n")),
        num_lines: Some(lines.len()),
        num_matches: None,
        applied_limit: Some(100),
        applied_offset: Some(0),
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "grep",
        backend = "rg",
        mode = ?output.mode,
        num_files = output.num_files,
        num_lines = output.num_lines.unwrap_or(0),
        partial = result.partial,
        applied_limit = output.applied_limit.unwrap_or(0),
        applied_offset = output.applied_offset.unwrap_or(0),
        "grep completed"
    );
    Ok(Some(output))
}

fn grep_fallback(input: &GrepSearchInput, base_path: &Path) -> io::Result<GrepSearchOutput> {
    let regex = RegexBuilder::new(&input.pattern)
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;

    let glob_filter = input
        .include
        .as_deref()
        .map(Pattern::new)
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;

    let mut filenames = Vec::new();
    let mut content_lines = Vec::new();

    let mut search_files = collect_search_files(base_path, input)?;
    sort_paths_by_modified_desc(&mut search_files);

    for file_path in search_files {
        if !matches_optional_filters(&file_path, glob_filter.as_ref()) {
            continue;
        }

        let Ok(file_contents) = fs::read_to_string(&file_path) else {
            continue;
        };

        let lines: Vec<&str> = file_contents.lines().collect();
        let mut matched_lines = Vec::new();
        for (index, line) in lines.iter().enumerate() {
            if regex.is_match(line) {
                matched_lines.push(index);
            }
        }

        if matched_lines.is_empty() {
            continue;
        }

        filenames.push(file_path.to_string_lossy().into_owned());
        for index in matched_lines {
            content_lines.push(format!(
                "{}:{}:{}",
                file_path.to_string_lossy(),
                index + 1,
                truncate_grep_line(lines[index])
            ));
        }
    }

    let (content_lines, applied_limit, applied_offset) =
        apply_limit(content_lines, Some(100), Some(0));
    let output = GrepSearchOutput {
        mode: Some(String::from("content")),
        num_files: filenames.len(),
        filenames,
        content: Some(content_lines.join("\n")),
        num_lines: Some(content_lines.len()),
        num_matches: None,
        applied_limit,
        applied_offset,
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "grep",
        mode = ?output.mode,
        num_files = output.num_files,
        num_lines = output.num_lines.unwrap_or(0),
        applied_limit = output.applied_limit.unwrap_or(0),
        applied_offset = output.applied_offset.unwrap_or(0),
        "grep completed"
    );
    Ok(output)
}

fn normalize_optional_search_path(path: Option<&str>) -> io::Result<PathBuf> {
    match path.map(str::trim) {
        Some(value)
            if !value.is_empty()
                && !value.eq_ignore_ascii_case("undefined")
                && !value.eq_ignore_ascii_case("null") =>
        {
            normalize_path(value)
        }
        _ => std::env::current_dir(),
    }
}

fn collect_search_files(base_path: &Path, input: &GrepSearchInput) -> io::Result<Vec<PathBuf>> {
    if base_path.is_file() {
        return Ok(vec![base_path.to_path_buf()]);
    }

    let globs = input
        .include
        .as_ref()
        .map(|glob| vec![glob.clone()])
        .unwrap_or_default();
    if let Some(result) = search_backend::rg_files(
        base_path,
        search_backend::RgFilesOptions::new(&globs, usize::MAX),
    )? {
        return Ok(result.files);
    }

    let mut files = Vec::new();
    let walker = WalkDir::new(base_path);
    for entry in walker.into_iter().filter_entry(|entry| {
        let path = entry.path();
        !is_ignored_search_path(path)
    }) {
        let entry = entry.map_err(|error| io::Error::other(error.to_string()))?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

fn modified_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis())
}

fn sort_paths_by_modified_desc(paths: &mut [PathBuf]) {
    paths.sort_by_key(|path| Reverse(modified_ms(path)));
}

fn is_ignored_search_path(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == ".git")
}

fn is_hidden_search_path(base_path: &Path, path: &Path) -> bool {
    path.strip_prefix(base_path)
        .unwrap_or(path)
        .components()
        .any(|component| {
            let text = component.as_os_str().to_string_lossy();
            text.starts_with('.') && text != "." && text != ".."
        })
}

fn truncate_grep_line(line: &str) -> String {
    if line.len() <= MAX_GREP_LINE_LENGTH {
        return line.to_string();
    }
    let mut end = 0;
    for (index, _) in line.char_indices() {
        if index > MAX_GREP_LINE_LENGTH {
            break;
        }
        end = index;
    }
    if end == 0 {
        return "...".to_string();
    }
    format!("{}...", &line[..end])
}

fn matches_optional_filters(path: &Path, glob_filter: Option<&Pattern>) -> bool {
    if let Some(glob_filter) = glob_filter {
        let path_string = path.to_string_lossy();
        let filename_matches = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| glob_filter.matches(name));
        if !glob_filter.matches(&path_string)
            && !glob_filter.matches_path(path)
            && !filename_matches
        {
            return false;
        }
    }

    true
}

fn apply_limit<T>(
    items: Vec<T>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> (Vec<T>, Option<usize>, Option<usize>) {
    let offset_value = offset.unwrap_or(0);
    let mut items = items.into_iter().skip(offset_value).collect::<Vec<_>>();
    let explicit_limit = limit.unwrap_or(250);
    if explicit_limit == 0 {
        return (items, None, (offset_value > 0).then_some(offset_value));
    }

    let truncated = items.len() > explicit_limit;
    items.truncate(explicit_limit);
    (
        items,
        truncated.then_some(explicit_limit),
        (offset_value > 0).then_some(offset_value),
    )
}

fn make_patch(original: &str, updated: &str) -> Vec<StructuredPatchHunk> {
    let mut lines = Vec::new();
    for line in original.lines() {
        lines.push(format!("-{line}"));
    }
    for line in updated.lines() {
        lines.push(format!("+{line}"));
    }

    vec![StructuredPatchHunk {
        old_start: 1,
        old_lines: original.lines().count(),
        new_start: 1,
        new_lines: updated.lines().count(),
        lines,
    }]
}

pub(crate) fn normalize_path(path: &str) -> io::Result<PathBuf> {
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()?.join(path)
    };
    candidate.canonicalize()
}

pub(crate) fn normalize_path_allow_missing(path: &str) -> io::Result<PathBuf> {
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()?.join(path)
    };

    if let Ok(canonical) = candidate.canonicalize() {
        return Ok(canonical);
    }

    if let Some(parent) = candidate.parent() {
        let canonical_parent = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        if let Some(name) = candidate.file_name() {
            return Ok(canonical_parent.join(name));
        }
    }

    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        edit, glob, glob_with_options, grep, normalize_optional_search_path, read,
        walk_glob_matches, write, GlobSearchOptions, GrepSearchInput, MAX_GREP_LINE_LENGTH,
        MAX_TEXT_FILE_READ_BYTES, MAX_WRITE_FILE_BYTES,
    };

    fn temp_path(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        std::env::temp_dir().join(format!("clawd-native-{name}-{unique}"))
    }

    #[test]
    fn reads_and_writes_files() {
        let path = temp_path("read-write.txt");
        let write_output = write(path.to_string_lossy().as_ref(), "one\ntwo\nthree")
            .expect("write should succeed");
        assert_eq!(write_output.kind, "create");

        let read_output = read(
            path.to_string_lossy().as_ref(),
            Some(1),
            Some(1),
            None,
            None,
            None,
        )
        .expect("read should succeed");
        assert_eq!(read_output.file.content, "two");
    }

    #[test]
    fn read_directory_lists_sorted_entries_with_directory_suffix() {
        let dir = temp_path("read-dir");
        fs::create_dir_all(dir.join("beta")).expect("create nested dir");
        fs::write(dir.join("alpha.txt"), "alpha").expect("write file");
        let output =
            read(dir.to_string_lossy().as_ref(), None, None, None, None, None).expect("read dir");
        assert_eq!(output.kind, "directory");
        assert_eq!(output.file.content, "alpha.txt\nbeta/");
    }

    #[test]
    fn read_missing_file_suggests_nearby_paths() {
        let dir = temp_path("read-missing-suggest");
        fs::create_dir_all(&dir).expect("create dir");
        fs::write(dir.join("report-final.md"), "report").expect("write report");
        let err = read(
            dir.join("report.md").to_string_lossy().as_ref(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect_err("missing read should fail");
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(err.to_string().contains("Did you mean one of these?"));
        assert!(err.to_string().contains("report-final.md"));
    }

    #[test]
    fn edits_file_contents() {
        let path = temp_path("edit.txt");
        write(path.to_string_lossy().as_ref(), "alpha beta alpha")
            .expect("initial write should succeed");
        let output = edit(path.to_string_lossy().as_ref(), "alpha", "omega", true)
            .expect("edit should succeed");
        assert!(output.replace_all);
    }

    #[test]
    fn edit_rejects_ambiguous_old_string_without_replace_all() {
        let path = temp_path("edit-amb.txt");
        write(path.to_string_lossy().as_ref(), "alpha beta alpha")
            .expect("initial write should succeed");
        let err = edit(path.to_string_lossy().as_ref(), "alpha", "omega", false)
            .expect_err("ambiguous replace should fail");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn edit_preserves_crlf_when_input_uses_lf() {
        let path = temp_path("edit-crlf.txt");
        fs::write(&path, "alpha\r\nbeta\r\ngamma\r\n").expect("write crlf");
        edit(
            path.to_string_lossy().as_ref(),
            "alpha\nbeta",
            "omega\nbeta",
            false,
        )
        .expect("edit should normalize input to file line endings");
        assert_eq!(
            fs::read_to_string(&path).expect("read crlf"),
            "omega\r\nbeta\r\ngamma\r\n"
        );
    }

    #[test]
    fn edit_falls_back_to_line_trimmed_match() {
        let path = temp_path("edit-trimmed.txt");
        fs::write(&path, "fn main() {\n    println!(\"hi\");\n}\n").expect("write file");
        edit(
            path.to_string_lossy().as_ref(),
            "fn main() {\nprintln!(\"hi\");\n}",
            "fn main() {\n    println!(\"bye\");\n}",
            false,
        )
        .expect("trimmed-line fallback should edit");
        assert_eq!(
            fs::read_to_string(&path).expect("read file"),
            "fn main() {\n    println!(\"bye\");\n}\n"
        );
    }

    #[test]
    fn reads_ipynb_as_numbered_text() {
        let path = temp_path("notebook").with_extension("ipynb");
        let nb = r#"{"cells":[{"cell_type":"code","metadata":{},"source":["print(1)"],"outputs":[]}],"metadata":{},"nbformat":4,"nbformat_minor":5}"#;
        fs::write(&path, nb).expect("write ipynb");
        let out = read(
            path.to_string_lossy().as_ref(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("read ipynb");
        assert!(out.file.content.contains("Cell[0]"));
        assert!(out.file.content.contains("print(1)"));
    }

    #[test]
    fn read_rejects_oversized_plain_text_file() {
        let path = temp_path("huge.txt");
        let size = (MAX_TEXT_FILE_READ_BYTES as usize).saturating_add(1);
        let big = vec![b'n'; size];
        fs::write(&path, &big).expect("write");
        let err = read(
            path.to_string_lossy().as_ref(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect_err("oversized read should fail");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn write_rejects_oversized_content() {
        let path = temp_path("oversize-write.txt");
        let huge = "x".repeat(MAX_WRITE_FILE_BYTES + 1);
        let err = write(path.to_string_lossy().as_ref(), &huge).expect_err("oversized write");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(err.to_string().contains("too large"));
    }

    #[test]
    fn globs_and_greps_directory() {
        let dir = temp_path("search-dir");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let file = dir.join("demo.rs");
        write(
            file.to_string_lossy().as_ref(),
            "fn main() {\n println!(\"hello\");\n}\n",
        )
        .expect("file write should succeed");

        let globbed =
            glob("**/*.rs", Some(dir.to_string_lossy().as_ref())).expect("glob should succeed");
        assert_eq!(globbed.num_files, 1);
        assert_eq!(globbed.pattern, "**/*.rs");
        assert_eq!(globbed.base_dir, dir.to_string_lossy());
        assert!(globbed.search_pattern.ends_with("**/*.rs"));
        assert_eq!(globbed.expanded_patterns.len(), 1);

        let grep_output = grep(&GrepSearchInput {
            pattern: String::from("hello"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("**/*.rs")),
        })
        .expect("grep should succeed");
        assert!(grep_output.content.unwrap_or_default().contains("hello"));
    }

    #[test]
    fn glob_keeps_brace_pattern_as_single_rg_glob() {
        let dir = temp_path("glob-braces");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("one.rs"), "fn one() {}\n").expect("write rs");
        fs::write(dir.join("two.ts"), "const two = 2;\n").expect("write ts");
        fs::write(dir.join("skip.md"), "# skip\n").expect("write md");

        let globbed = glob("**/*.{rs,ts,rs}", Some(dir.to_string_lossy().as_ref()))
            .expect("glob should succeed");
        assert_eq!(globbed.pattern, "**/*.{rs,ts,rs}");
        assert_eq!(
            globbed.expanded_patterns,
            vec!["**/*.{rs,ts,rs}".to_string()]
        );
    }

    #[test]
    fn glob_can_exclude_hidden_files() {
        let dir = temp_path("glob-hidden");
        std::fs::create_dir_all(dir.join(".secret")).expect("hidden dir should be created");
        fs::write(dir.join("visible.txt"), "visible\n").expect("write visible");
        fs::write(dir.join(".hidden.txt"), "hidden\n").expect("write hidden");
        fs::write(dir.join(".secret/nested.txt"), "nested\n").expect("write nested hidden");

        let globbed = glob_with_options(
            "**/*.txt",
            Some(dir.to_string_lossy().as_ref()),
            &GlobSearchOptions {
                hidden: Some(false),
                ..GlobSearchOptions::default()
            },
        )
        .expect("glob should succeed");

        assert_eq!(globbed.num_files, 1);
        assert!(globbed.filenames[0].ends_with("visible.txt"));
    }

    #[test]
    fn walk_glob_matches_finds_deep_relevant_filenames() {
        let dir = temp_path("glob-deep-fallback");
        let nested = dir.join("999連結/999期-9Q/連結決算/02精算表/ツール");
        std::fs::create_dir_all(&nested).expect("directory should be created");
        let expected = nested.join("FY999-9Q_連結精算表(リンク).xlsx");
        fs::write(&expected, b"placeholder").expect("write workbook placeholder");

        let matches = walk_glob_matches(&dir, "**/*精算表*", &GlobSearchOptions::default())
            .expect("walk glob should succeed");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0], expected);
    }

    #[test]
    fn glob_rejects_file_path_base() {
        let path = temp_path("glob-file-base.txt");
        fs::write(&path, "hello").expect("write file");
        let err = glob("*.txt", Some(path.to_string_lossy().as_ref()))
            .expect_err("file base should be rejected");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert!(err.to_string().contains("path must be a directory"));
    }

    #[test]
    fn grep_accepts_opencode_include() {
        let input: GrepSearchInput =
            serde_json::from_str(r#"{"pattern":"hello","path":"src","include":"*.rs"}"#)
                .expect("include should deserialize");
        assert_eq!(input.include.as_deref(), Some("*.rs"));
    }

    #[test]
    fn grep_rejects_legacy_compatibility_fields() {
        let error = serde_json::from_str::<GrepSearchInput>(
            r#"{"pattern":"hello","path":"src","glob":"*.rs","output_mode":"count","-i":true}"#,
        )
        .expect_err("legacy compatibility fields should be rejected");
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn search_path_placeholders_default_to_current_directory() {
        let cwd = std::env::current_dir().expect("current dir");

        assert_eq!(normalize_optional_search_path(None).unwrap(), cwd);
        assert_eq!(normalize_optional_search_path(Some("")).unwrap(), cwd);
        assert_eq!(
            normalize_optional_search_path(Some("undefined")).unwrap(),
            cwd
        );
        assert_eq!(normalize_optional_search_path(Some("null")).unwrap(), cwd);
    }

    #[test]
    fn grep_defaults_to_opencode_content_output_with_limit() {
        let dir = temp_path("grep-default-content");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let lines = (0..105)
            .map(|index| format!("needle {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(dir.join("many.txt"), format!("{lines}\n")).expect("write file");

        let output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("*.txt")),
        })
        .expect("grep should succeed");

        assert_eq!(output.mode.as_deref(), Some("content"));
        assert_eq!(output.num_lines, Some(100));
        assert_eq!(output.applied_limit, Some(100));
        let content = output.content.expect("content output");
        assert!(content.contains("many.txt:1:needle 0"));
        assert!(!content.contains("needle 104"));
    }

    #[test]
    fn grep_orders_files_by_modified_time_desc() {
        let dir = temp_path("grep-mtime");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let old = dir.join("old.txt");
        let new = dir.join("new.txt");
        fs::write(&old, "needle old\n").expect("write old file");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&new, "needle new\n").expect("write new file");

        let output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("*.txt")),
        })
        .expect("grep should succeed");

        assert_eq!(output.filenames.len(), 2);
        assert!(output.filenames[0].ends_with("new.txt"));
        assert!(output.filenames[1].ends_with("old.txt"));
    }

    #[test]
    fn grep_rg_path_can_target_single_file() {
        let dir = temp_path("grep-single-file");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let wanted = dir.join("wanted.txt");
        let ignored = dir.join("ignored.txt");
        fs::write(&wanted, "needle wanted\n").expect("write wanted file");
        fs::write(&ignored, "needle ignored\n").expect("write ignored file");

        let output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(wanted.to_string_lossy().into_owned()),
            include: None,
        })
        .expect("grep should succeed");

        assert_eq!(output.num_files, 1);
        assert!(output.filenames[0].ends_with("wanted.txt"));
        let content = output.content.expect("content output");
        assert!(content.contains("wanted.txt:1:needle wanted"));
        assert!(!content.contains("ignored.txt"));
    }

    #[test]
    fn grep_uses_opencode_fixed_content_behavior() {
        let dir = temp_path("grep-rg-options");
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).expect("nested directory should be created");
        fs::write(dir.join("root.txt"), "needle one\nneedle two\n").expect("write root");
        fs::write(nested.join("nested.txt"), "needle nested\n").expect("write nested");
        fs::write(dir.join(".hidden.txt"), "needle hidden\n").expect("write hidden");

        let output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("**/*.txt")),
        })
        .expect("grep should succeed");

        let content = output.content.expect("content output");
        assert!(content.contains("root.txt:1:needle one"));
        assert!(content.contains("needle two"));
        assert!(content.contains("nested.txt"));
        assert!(content.contains(".hidden.txt"));
    }

    #[test]
    fn search_excludes_git_internal_files() {
        let dir = temp_path("search-ignore-git");
        std::fs::create_dir_all(dir.join(".git/objects")).expect("git internals should be created");
        std::fs::create_dir_all(dir.join("src")).expect("src should be created");
        fs::write(dir.join(".git/objects/hidden.txt"), "needle hidden\n").expect("write git file");
        fs::write(dir.join("src/visible.txt"), "needle visible\n").expect("write visible file");

        let globbed =
            glob("**/*.txt", Some(dir.to_string_lossy().as_ref())).expect("glob should succeed");
        assert_eq!(globbed.num_files, 1);
        assert!(globbed.filenames[0].ends_with("visible.txt"));
        assert!(!globbed.filenames.iter().any(|path| path.contains(".git")));

        let grep_output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("*.txt")),
        })
        .expect("grep should succeed");
        assert_eq!(grep_output.filenames.len(), 1);
        assert!(grep_output.filenames[0].ends_with("visible.txt"));
        assert!(!grep_output
            .filenames
            .iter()
            .any(|path| path.contains(".git")));
    }

    #[test]
    fn grep_rejects_empty_pattern() {
        let dir = temp_path("grep-empty-pattern");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("file.txt"), "anything\n").expect("write file");

        let err = grep(&GrepSearchInput {
            pattern: String::new(),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("*.txt")),
        })
        .expect_err("empty pattern should be rejected");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert!(err.to_string().contains("pattern is required"));
    }

    #[test]
    fn grep_content_truncates_very_long_lines() {
        let dir = temp_path("grep-long-lines");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let long_line = format!("needle {}", "x".repeat(MAX_GREP_LINE_LENGTH + 500));
        fs::write(dir.join("long.txt"), format!("{long_line}\n")).expect("write long file");

        let output = grep(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            include: Some(String::from("*.txt")),
        })
        .expect("grep should succeed");

        let content = output.content.expect("content output");
        assert!(content.contains("needle"));
        assert!(content.ends_with("..."));
        assert!(content.len() < long_line.len());
    }
}
