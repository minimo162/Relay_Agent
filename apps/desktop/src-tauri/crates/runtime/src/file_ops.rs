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
use crate::tool_hard_denylist::reject_sensitive_file_path;

/// Upper bound for loading a single file as UTF-8 text in `read_file` (plain text and `.ipynb` raw JSON).
pub const MAX_TEXT_FILE_READ_BYTES: u64 = 10 * 1024 * 1024;

/// Upper bound for `write_file` body size (aligned with claw-code `MAX_WRITE_SIZE` at the pinned SHA).
pub const MAX_WRITE_FILE_BYTES: usize = 10 * 1024 * 1024;

const MAX_GREP_LINE_LENGTH: usize = 2_000;
const MAX_WORKSPACE_SEARCH_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_WORKSPACE_SEARCH_MAX_FILES: usize = 50;
const DEFAULT_WORKSPACE_SEARCH_MAX_SNIPPETS: usize = 30;
const MAX_WORKSPACE_SEARCH_MAX_FILES: usize = 500;
const MAX_WORKSPACE_SEARCH_MAX_SNIPPETS: usize = 200;

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GrepSearchInput {
    pub pattern: String,
    pub path: Option<String>,
    #[serde(alias = "include")]
    pub glob: Option<String>,
    #[serde(rename = "output_mode")]
    pub output_mode: Option<String>,
    #[serde(rename = "-B")]
    pub before: Option<usize>,
    #[serde(rename = "-A")]
    pub after: Option<usize>,
    #[serde(rename = "-C")]
    pub context_short: Option<usize>,
    pub context: Option<usize>,
    #[serde(rename = "-n")]
    pub line_numbers: Option<bool>,
    #[serde(rename = "-i")]
    pub case_insensitive: Option<bool>,
    #[serde(rename = "type")]
    pub file_type: Option<String>,
    pub head_limit: Option<usize>,
    pub offset: Option<usize>,
    pub multiline: Option<bool>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchInput {
    pub query: String,
    pub paths: Option<Vec<String>>,
    pub mode: Option<String>,
    #[serde(rename = "include_ext")]
    pub include_ext: Option<Vec<String>>,
    #[serde(rename = "max_files")]
    pub max_files: Option<usize>,
    #[serde(rename = "max_snippets")]
    pub max_snippets: Option<usize>,
    pub context: Option<usize>,
    pub literal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSearchCandidate {
    pub path: String,
    pub score: f64,
    pub reasons: Vec<String>,
    #[serde(rename = "match_count")]
    pub match_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchSnippet {
    pub path: String,
    pub anchor: Option<String>,
    #[serde(rename = "line_start")]
    pub line_start: usize,
    #[serde(rename = "line_end")]
    pub line_end: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchLimits {
    #[serde(rename = "scanned_files")]
    pub scanned_files: usize,
    #[serde(rename = "skipped_files")]
    pub skipped_files: usize,
    pub truncated: bool,
    #[serde(rename = "elapsed_ms")]
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSearchOutput {
    pub query: String,
    pub strategy: Vec<String>,
    pub candidates: Vec<WorkspaceSearchCandidate>,
    pub snippets: Vec<WorkspaceSearchSnippet>,
    pub limits: WorkspaceSearchLimits,
    #[serde(rename = "needs_clarification")]
    pub needs_clarification: bool,
}

/// Read a file as text for the agent. Plain UTF-8 text uses line-based `offset` / `limit`.
/// `.ipynb` is rendered as numbered plain text. `.pdf` uses `pages` (1-based, e.g. `"1-3"` or `"5"`).
/// Common image formats return dimensions and format metadata (pixels are not passed to the LLM in this build).
pub fn read_file(
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
        .map_err(|error| annotate_read_file_error(error, &attempted_path))?;
    let lossy_path = absolute_path.to_string_lossy().into_owned();

    let ext = absolute_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    let full_text = match ext.as_deref() {
        Some("ipynb") => {
            let raw = fs::read(&absolute_path)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?;
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
            .map_err(|error| annotate_read_file_error(error, &absolute_path))?,
        Some("docx") => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` do not apply to DOCX files",
                ));
            }
            office::read_docx_as_text(&absolute_path)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?
        }
        Some("xlsx") => {
            if pages.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` and `slides` do not apply to XLSX files",
                ));
            }
            office::read_xlsx_as_text(&absolute_path, sheets)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?
        }
        Some("pptx") => {
            if pages.is_some() || sheets.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` and `sheets` do not apply to PPTX files",
                ));
            }
            office::read_pptx_as_text(&absolute_path, slides)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?
        }
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` apply only to matching PDF/Office files",
                ));
            }
            read_image_summary(&absolute_path)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?
        }
        _ => {
            if pages.is_some() || sheets.is_some() || slides.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages`, `sheets`, and `slides` apply only to matching PDF/Office files",
                ));
            }
            let bytes = fs::read(&absolute_path)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?;
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

fn annotate_read_file_error(error: io::Error, attempted_path: &Path) -> io::Error {
    if error.kind() == io::ErrorKind::NotFound {
        io::Error::new(
            error.kind(),
            format!(
                "{}; resolved path: {}",
                error,
                attempted_path.to_string_lossy()
            ),
        )
    } else {
        error
    }
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

pub fn write_file(path: &str, content: &str) -> io::Result<WriteFileOutput> {
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

pub fn edit_file(
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
    let occurrences = original_file.matches(old_string).count();
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
        original_file.replace(old_string, new_string)
    } else {
        original_file.replacen(old_string, new_string, 1)
    };
    fs::write(&absolute_path, &updated)?;

    Ok(EditFileOutput {
        file_path: absolute_path.to_string_lossy().into_owned(),
        old_string: old_string.to_owned(),
        new_string: new_string.to_owned(),
        original_file: original_file.clone(),
        structured_patch: make_patch(&original_file, &updated),
        user_modified: false,
        replace_all,
        git_diff: None,
    })
}

pub fn glob_search(pattern: &str, path: Option<&str>) -> io::Result<GlobSearchOutput> {
    let started = Instant::now();
    let base_dir = path
        .map(normalize_path)
        .transpose()?
        .unwrap_or(std::env::current_dir()?);
    if base_dir.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "glob_search path must be a directory: {}",
                base_dir.to_string_lossy()
            ),
        ));
    }
    let search_pattern = if Path::new(pattern).is_absolute() {
        pattern.to_owned()
    } else {
        base_dir.join(pattern).to_string_lossy().into_owned()
    };

    // The `glob` crate does not expand `{a,b}` groups. Expand them here so
    // agents can batch extension families like `**/*.{docx,xlsx,pptx,pdf}`.
    let expanded = expand_braces(&search_pattern);

    let mut seen = HashSet::new();
    let mut matches = Vec::new();
    for pattern in &expanded {
        let entries = glob::glob(pattern)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
        for entry in entries.flatten() {
            if entry.is_file() && !is_ignored_search_path(&entry) && seen.insert(entry.clone()) {
                matches.push(entry);
            }
        }
    }

    sort_paths_by_modified_desc(&mut matches);

    let truncated = matches.len() > 100;
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
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "glob_search",
        num_files = output.num_files,
        truncated = output.truncated,
        duration_ms = output.duration_ms,
        "glob_search completed"
    );
    Ok(output)
}

pub fn grep_search(input: &GrepSearchInput) -> io::Result<GrepSearchOutput> {
    if input.pattern.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "grep_search pattern is required",
        ));
    }

    let base_path = input
        .path
        .as_deref()
        .map(normalize_path)
        .transpose()?
        .unwrap_or(std::env::current_dir()?);

    let regex = RegexBuilder::new(&input.pattern)
        .case_insensitive(input.case_insensitive.unwrap_or(false))
        .dot_matches_new_line(input.multiline.unwrap_or(false))
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;

    let glob_filter = input
        .glob
        .as_deref()
        .map(Pattern::new)
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    let file_type = input.file_type.as_deref();
    let output_mode = input
        .output_mode
        .clone()
        .unwrap_or_else(|| String::from("files_with_matches"));
    let context = input.context.or(input.context_short).unwrap_or(0);

    let mut filenames = Vec::new();
    let mut content_lines = Vec::new();
    let mut total_matches = 0usize;

    let mut search_files = collect_search_files(&base_path)?;
    sort_paths_by_modified_desc(&mut search_files);

    for file_path in search_files {
        if !matches_optional_filters(&file_path, glob_filter.as_ref(), file_type) {
            continue;
        }

        let Ok(file_contents) = fs::read_to_string(&file_path) else {
            continue;
        };

        if output_mode == "count" {
            let count = regex.find_iter(&file_contents).count();
            if count > 0 {
                filenames.push(file_path.to_string_lossy().into_owned());
                total_matches += count;
            }
            continue;
        }

        let lines: Vec<&str> = file_contents.lines().collect();
        let mut matched_lines = Vec::new();
        for (index, line) in lines.iter().enumerate() {
            if regex.is_match(line) {
                total_matches += 1;
                matched_lines.push(index);
            }
        }

        if matched_lines.is_empty() {
            continue;
        }

        filenames.push(file_path.to_string_lossy().into_owned());
        if output_mode == "content" {
            for index in matched_lines {
                let start = index.saturating_sub(input.before.unwrap_or(context));
                let end = (index + input.after.unwrap_or(context) + 1).min(lines.len());
                for (current, line) in lines.iter().enumerate().take(end).skip(start) {
                    let prefix = if input.line_numbers.unwrap_or(true) {
                        format!("{}:{}:", file_path.to_string_lossy(), current + 1)
                    } else {
                        format!("{}:", file_path.to_string_lossy())
                    };
                    content_lines.push(format!("{prefix}{}", truncate_grep_line(line)));
                }
            }
        }
    }

    let (filenames, applied_limit, applied_offset) =
        apply_limit(filenames, input.head_limit, input.offset);
    let content_output = if output_mode == "content" {
        let (lines, limit, offset) = apply_limit(content_lines, input.head_limit, input.offset);
        let output = GrepSearchOutput {
            mode: Some(output_mode),
            num_files: filenames.len(),
            filenames,
            num_lines: Some(lines.len()),
            content: Some(lines.join("\n")),
            num_matches: None,
            applied_limit: limit,
            applied_offset: offset,
        };
        tracing::info!(
            target: "relay.runtime.search",
            tool = "grep_search",
            mode = ?output.mode,
            num_files = output.num_files,
            num_lines = output.num_lines.unwrap_or(0),
            applied_limit = output.applied_limit.unwrap_or(0),
            applied_offset = output.applied_offset.unwrap_or(0),
            "grep_search completed"
        );
        return Ok(output);
    } else {
        None
    };

    let output = GrepSearchOutput {
        mode: Some(output_mode.clone()),
        num_files: filenames.len(),
        filenames,
        content: content_output,
        num_lines: None,
        num_matches: (output_mode == "count").then_some(total_matches),
        applied_limit,
        applied_offset,
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "grep_search",
        mode = ?output.mode,
        num_files = output.num_files,
        num_matches = output.num_matches.unwrap_or(0),
        applied_limit = output.applied_limit.unwrap_or(0),
        applied_offset = output.applied_offset.unwrap_or(0),
        "grep_search completed"
    );
    Ok(output)
}

pub fn workspace_search(input: &WorkspaceSearchInput) -> io::Result<WorkspaceSearchOutput> {
    let started = Instant::now();
    let query = input.query.trim();
    if query.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace_search query is required",
        ));
    }

    let workspace_root = std::env::current_dir()?.canonicalize()?;
    let search_roots = workspace_search_roots(input.paths.as_ref(), &workspace_root)?;
    let include_ext = normalize_workspace_search_exts(input.include_ext.as_ref());
    let max_files = input
        .max_files
        .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_FILES)
        .clamp(1, MAX_WORKSPACE_SEARCH_MAX_FILES);
    let max_snippets = input
        .max_snippets
        .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_SNIPPETS)
        .clamp(1, MAX_WORKSPACE_SEARCH_MAX_SNIPPETS);
    let context = input.context.unwrap_or(2).min(10);
    let terms = workspace_search_terms(query);
    let mut scanned_files = 0usize;
    let mut skipped_files = 0usize;
    let mut truncated = false;
    let mut candidate_map = std::collections::BTreeMap::<String, WorkspaceCandidateAccumulator>::new();
    let mut snippets = Vec::new();
    let mut file_budget_reached = false;

    for root in &search_roots {
        for entry in WalkDir::new(root).into_iter().filter_entry(|entry| {
            !is_ignored_workspace_search_path(entry.path())
        }) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped_files += 1;
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            if is_ignored_workspace_search_path(&path) {
                skipped_files += 1;
                continue;
            }
            if !workspace_search_ext_allowed(&path, include_ext.as_ref()) {
                skipped_files += 1;
                continue;
            }
            let canonical = match path.canonicalize() {
                Ok(canonical) if canonical.starts_with(&workspace_root) => canonical,
                _ => {
                    skipped_files += 1;
                    continue;
                }
            };
            let metadata = match fs::metadata(&canonical) {
                Ok(metadata) => metadata,
                Err(_) => {
                    skipped_files += 1;
                    continue;
                }
            };
            if metadata.len() > MAX_WORKSPACE_SEARCH_TEXT_BYTES {
                skipped_files += 1;
                continue;
            }
            if scanned_files >= max_files {
                truncated = true;
                file_budget_reached = true;
                break;
            }
            scanned_files += 1;

            let path_string = canonical.to_string_lossy().into_owned();
            let mut accumulator = WorkspaceCandidateAccumulator::new(path_string.clone());
            score_workspace_path(&path_string, &terms, &mut accumulator);

            if is_office_workspace_search_path(&canonical) {
                // Office/PDF content is integrated through `office_search` below so
                // anchors and previews stay consistent with the Office extraction layer.
                if accumulator.score > 0.0 {
                    candidate_map.insert(path_string, accumulator);
                }
                continue;
            }

            let Ok(content) = fs::read_to_string(&canonical) else {
                skipped_files += 1;
                continue;
            };
            let file_snippets =
                score_workspace_text(&path_string, &content, &terms, context, &mut accumulator);
            if accumulator.score > 0.0 {
                candidate_map
                    .entry(path_string)
                    .and_modify(|existing| existing.merge(accumulator.clone()))
                    .or_insert(accumulator);
            }
            for snippet in file_snippets {
                if snippets.len() < max_snippets {
                    snippets.push(snippet);
                } else {
                    truncated = true;
                    break;
                }
            }
        }
        if file_budget_reached {
            break;
        }
    }

    if workspace_search_should_include_office(input.mode.as_deref(), include_ext.as_ref()) {
        let office_paths = workspace_search_office_paths(&search_roots);
        if !office_paths.is_empty() && snippets.len() < max_snippets {
            if let Ok(office_output) = office::office_search(&office::OfficeSearchInput {
                pattern: workspace_search_office_pattern(query, &terms),
                paths: office_paths,
                regex: Some(false),
                include_ext: Some(vec![
                    "docx".to_string(),
                    "xlsx".to_string(),
                    "pptx".to_string(),
                    "pdf".to_string(),
                ]),
                case_insensitive: Some(true),
                context: Some(120),
                max_results: Some(max_snippets.saturating_sub(snippets.len()).max(1)),
                max_files: Some(max_files),
            }) {
                truncated |= office_output.files_truncated
                    || office_output.results_truncated
                    || office_output.wall_clock_truncated;
                for hit in office_output.results {
                    let entry = candidate_map
                        .entry(hit.path.clone())
                        .or_insert_with(|| WorkspaceCandidateAccumulator::new(hit.path.clone()));
                    entry.score += 4.0;
                    entry.match_count += 1;
                    entry.push_reason(format!("office:{}", hit.anchor));
                    if snippets.len() < max_snippets {
                        snippets.push(WorkspaceSearchSnippet {
                            path: hit.path,
                            anchor: Some(hit.anchor),
                            line_start: 0,
                            line_end: 0,
                            preview: hit.preview,
                        });
                    }
                }
            }
        }
    }

    let mut candidates = candidate_map
        .into_values()
        .map(WorkspaceCandidateAccumulator::into_candidate)
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.match_count.cmp(&a.match_count))
            .then_with(|| a.path.cmp(&b.path))
    });
    if candidates.len() > max_files {
        candidates.truncate(max_files);
        truncated = true;
    }

    Ok(WorkspaceSearchOutput {
        query: query.to_string(),
        strategy: vec![
            "path_discovery".to_string(),
            "literal_grep".to_string(),
            "snippet_expansion".to_string(),
            "office_preview_anchor_integration".to_string(),
        ],
        needs_clarification: candidates.is_empty(),
        candidates,
        snippets,
        limits: WorkspaceSearchLimits {
            scanned_files,
            skipped_files,
            truncated,
            elapsed_ms: started.elapsed().as_millis(),
        },
    })
}

#[derive(Debug, Clone)]
struct WorkspaceCandidateAccumulator {
    path: String,
    score: f64,
    reasons: Vec<String>,
    match_count: usize,
}

impl WorkspaceCandidateAccumulator {
    fn new(path: String) -> Self {
        Self {
            path,
            score: 0.0,
            reasons: Vec::new(),
            match_count: 0,
        }
    }

    fn push_reason(&mut self, reason: String) {
        if !self.reasons.iter().any(|existing| existing == &reason) {
            self.reasons.push(reason);
        }
    }

    fn merge(&mut self, other: Self) {
        self.score += other.score;
        self.match_count += other.match_count;
        for reason in other.reasons {
            self.push_reason(reason);
        }
    }

    fn into_candidate(self) -> WorkspaceSearchCandidate {
        WorkspaceSearchCandidate {
            path: self.path,
            score: (self.score * 100.0).round() / 100.0,
            reasons: self.reasons,
            match_count: self.match_count,
        }
    }
}

fn workspace_search_roots(
    paths: Option<&Vec<String>>,
    workspace_root: &Path,
) -> io::Result<Vec<PathBuf>> {
    let requested = paths
        .filter(|paths| !paths.is_empty())
        .cloned()
        .unwrap_or_else(|| vec![String::from(".")]);
    let mut roots = Vec::new();
    for path in requested {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = if Path::new(trimmed).is_absolute() {
            PathBuf::from(trimmed)
        } else {
            workspace_root.join(trimmed)
        };
        let canonical = candidate.canonicalize()?;
        if !canonical.starts_with(workspace_root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "workspace_search path {} escapes workspace boundary {}",
                    canonical.display(),
                    workspace_root.display()
                ),
            ));
        }
        roots.push(canonical);
    }
    if roots.is_empty() {
        roots.push(workspace_root.to_path_buf());
    }
    Ok(roots)
}

fn normalize_workspace_search_exts(input: Option<&Vec<String>>) -> Option<HashSet<String>> {
    input.map(|items| {
        items
            .iter()
            .filter_map(|item| {
                let ext = item.trim().trim_start_matches('.').to_ascii_lowercase();
                (!ext.is_empty()).then_some(ext)
            })
            .collect()
    })
    .filter(|items: &HashSet<String>| !items.is_empty())
}

fn workspace_search_ext_allowed(path: &Path, include_ext: Option<&HashSet<String>>) -> bool {
    let Some(include_ext) = include_ext else {
        return true;
    };
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| include_ext.contains(&extension.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn workspace_search_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let lower_query = query.trim().to_ascii_lowercase();
    if !lower_query.is_empty() {
        terms.push(lower_query);
    }
    for token in query
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-'))
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        let token = token.to_ascii_lowercase();
        if !terms.iter().any(|existing| existing == &token) {
            terms.push(token);
        }
    }
    terms
}

fn score_workspace_path(
    path: &str,
    terms: &[String],
    accumulator: &mut WorkspaceCandidateAccumulator,
) {
    let lower = path.to_ascii_lowercase();
    for term in terms {
        if lower.contains(term) {
            accumulator.score += 2.0;
            accumulator.match_count += 1;
            accumulator.push_reason(format!("filename:{term}"));
        }
    }
}

fn score_workspace_text(
    path: &str,
    content: &str,
    terms: &[String],
    context: usize,
    accumulator: &mut WorkspaceCandidateAccumulator,
) -> Vec<WorkspaceSearchSnippet> {
    let mut snippets = Vec::new();
    let lines = content.lines().collect::<Vec<_>>();
    let lower_lines = lines
        .iter()
        .map(|line| line.to_ascii_lowercase())
        .collect::<Vec<_>>();
    for (index, lower_line) in lower_lines.iter().enumerate() {
        let mut matched_terms = Vec::new();
        for term in terms {
            if lower_line.contains(term) {
                matched_terms.push(term.as_str());
            }
        }
        if matched_terms.is_empty() {
            continue;
        }
        accumulator.score += 3.0 + matched_terms.len() as f64;
        accumulator.match_count += matched_terms.len();
        accumulator.push_reason(format!("grep:{}", matched_terms.join(",")));
        let start = index.saturating_sub(context);
        let end = (index + context + 1).min(lines.len());
        snippets.push(WorkspaceSearchSnippet {
            path: path.to_string(),
            anchor: None,
            line_start: start + 1,
            line_end: end,
            preview: lines[start..end].join("\n"),
        });
    }
    snippets
}

fn is_office_workspace_search_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("docx" | "xlsx" | "pptx" | "pdf")
    )
}

fn workspace_search_should_include_office(
    mode: Option<&str>,
    include_ext: Option<&HashSet<String>>,
) -> bool {
    if matches!(mode, Some("code" | "text")) {
        return false;
    }
    include_ext.is_none_or(|exts| {
        ["docx", "xlsx", "pptx", "pdf"]
            .iter()
            .any(|ext| exts.contains(*ext))
    })
}

fn workspace_search_office_paths(search_roots: &[PathBuf]) -> Vec<String> {
    let mut paths = Vec::new();
    for root in search_roots {
        let root = root.to_string_lossy();
        for ext in ["docx", "xlsx", "pptx", "pdf"] {
            paths.push(format!("{}/**/*.{}", root.trim_end_matches(['/', '\\']), ext));
        }
    }
    paths
}

fn workspace_search_office_pattern(query: &str, terms: &[String]) -> String {
    terms
        .iter()
        .find(|term| term.chars().count() >= 3)
        .cloned()
        .unwrap_or_else(|| query.to_string())
}

fn collect_search_files(base_path: &Path) -> io::Result<Vec<PathBuf>> {
    if base_path.is_file() {
        return Ok(vec![base_path.to_path_buf()]);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(base_path).into_iter().filter_entry(|entry| {
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

fn is_ignored_workspace_search_path(path: &Path) -> bool {
    const IGNORED_DIRS: &[&str] = &[
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        "out",
        "coverage",
    ];
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        IGNORED_DIRS.iter().any(|ignored| name == *ignored)
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

fn expand_braces(pattern: &str) -> Vec<String> {
    let Some(start) = pattern.find('{') else {
        return vec![pattern.to_string()];
    };
    let Some(end_offset) = pattern[start + 1..].find('}') else {
        return vec![pattern.to_string()];
    };

    let end = start + 1 + end_offset;
    let prefix = &pattern[..start];
    let body = &pattern[start + 1..end];
    let suffix = &pattern[end + 1..];

    body.split(',')
        .flat_map(|part| expand_braces(&format!("{prefix}{part}{suffix}")))
        .collect()
}

fn matches_optional_filters(
    path: &Path,
    glob_filter: Option<&Pattern>,
    file_type: Option<&str>,
) -> bool {
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

    if let Some(file_type) = file_type {
        let extension = path.extension().and_then(|extension| extension.to_str());
        if extension != Some(file_type) {
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
        edit_file, glob_search, grep_search, read_file, workspace_search, write_file,
        GrepSearchInput, WorkspaceSearchInput, MAX_GREP_LINE_LENGTH, MAX_TEXT_FILE_READ_BYTES,
        MAX_WRITE_FILE_BYTES,
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
        let write_output = write_file(path.to_string_lossy().as_ref(), "one\ntwo\nthree")
            .expect("write should succeed");
        assert_eq!(write_output.kind, "create");

        let read_output = read_file(
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
    fn edits_file_contents() {
        let path = temp_path("edit.txt");
        write_file(path.to_string_lossy().as_ref(), "alpha beta alpha")
            .expect("initial write should succeed");
        let output = edit_file(path.to_string_lossy().as_ref(), "alpha", "omega", true)
            .expect("edit should succeed");
        assert!(output.replace_all);
    }

    #[test]
    fn edit_rejects_ambiguous_old_string_without_replace_all() {
        let path = temp_path("edit-amb.txt");
        write_file(path.to_string_lossy().as_ref(), "alpha beta alpha")
            .expect("initial write should succeed");
        let err = edit_file(path.to_string_lossy().as_ref(), "alpha", "omega", false)
            .expect_err("ambiguous replace should fail");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn reads_ipynb_as_numbered_text() {
        let path = temp_path("notebook").with_extension("ipynb");
        let nb = r#"{"cells":[{"cell_type":"code","metadata":{},"source":["print(1)"],"outputs":[]}],"metadata":{},"nbformat":4,"nbformat_minor":5}"#;
        fs::write(&path, nb).expect("write ipynb");
        let out = read_file(
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
        let err = read_file(
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
        let err = write_file(path.to_string_lossy().as_ref(), &huge).expect_err("oversized write");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(err.to_string().contains("too large"));
    }

    #[test]
    fn globs_and_greps_directory() {
        let dir = temp_path("search-dir");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let file = dir.join("demo.rs");
        write_file(
            file.to_string_lossy().as_ref(),
            "fn main() {\n println!(\"hello\");\n}\n",
        )
        .expect("file write should succeed");

        let globbed = glob_search("**/*.rs", Some(dir.to_string_lossy().as_ref()))
            .expect("glob should succeed");
        assert_eq!(globbed.num_files, 1);

        let grep_output = grep_search(&GrepSearchInput {
            pattern: String::from("hello"),
            path: Some(dir.to_string_lossy().into_owned()),
            glob: Some(String::from("**/*.rs")),
            output_mode: Some(String::from("content")),
            before: None,
            after: None,
            context_short: None,
            context: None,
            line_numbers: Some(true),
            case_insensitive: Some(false),
            file_type: None,
            head_limit: Some(10),
            offset: Some(0),
            multiline: Some(false),
        })
        .expect("grep should succeed");
        assert!(grep_output.content.unwrap_or_default().contains("hello"));
    }

    #[test]
    fn expand_braces_expands_extension_families() {
        let mut expanded = super::expand_braces("docs/**/*.{docx,xlsx,pptx,pdf}");
        expanded.sort();
        assert_eq!(
            expanded,
            vec![
                "docs/**/*.docx",
                "docs/**/*.pdf",
                "docs/**/*.pptx",
                "docs/**/*.xlsx"
            ]
        );
    }

    #[test]
    fn glob_search_with_braces_finds_unique_files() {
        let dir = temp_path("glob-braces");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("one.rs"), "fn one() {}\n").expect("write rs");
        fs::write(dir.join("two.ts"), "const two = 2;\n").expect("write ts");
        fs::write(dir.join("skip.md"), "# skip\n").expect("write md");

        let globbed = glob_search("**/*.{rs,ts,rs}", Some(dir.to_string_lossy().as_ref()))
            .expect("glob should succeed");
        assert_eq!(globbed.num_files, 2);
        assert!(globbed.filenames.iter().any(|path| path.ends_with("one.rs")));
        assert!(globbed.filenames.iter().any(|path| path.ends_with("two.ts")));
        assert!(!globbed.filenames.iter().any(|path| path.ends_with("skip.md")));
    }

    #[test]
    fn glob_search_rejects_file_path_base() {
        let path = temp_path("glob-file-base.txt");
        fs::write(&path, "hello").expect("write file");
        let err = glob_search("*.txt", Some(path.to_string_lossy().as_ref()))
            .expect_err("file base should be rejected");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert!(err.to_string().contains("path must be a directory"));
    }

    #[test]
    fn grep_search_accepts_opencode_include_alias() {
        let input: GrepSearchInput =
            serde_json::from_str(r#"{"pattern":"hello","path":"src","include":"*.rs"}"#)
                .expect("include alias should deserialize");
        assert_eq!(input.glob.as_deref(), Some("*.rs"));
    }

    #[test]
    fn grep_search_orders_files_by_modified_time_desc() {
        let dir = temp_path("grep-mtime");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let old = dir.join("old.txt");
        let new = dir.join("new.txt");
        fs::write(&old, "needle old\n").expect("write old file");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&new, "needle new\n").expect("write new file");

        let output = grep_search(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            glob: Some(String::from("*.txt")),
            output_mode: Some(String::from("files_with_matches")),
            before: None,
            after: None,
            context_short: None,
            context: None,
            line_numbers: Some(true),
            case_insensitive: Some(false),
            file_type: None,
            head_limit: Some(10),
            offset: Some(0),
            multiline: Some(false),
        })
        .expect("grep should succeed");

        assert_eq!(output.filenames.len(), 2);
        assert!(output.filenames[0].ends_with("new.txt"));
        assert!(output.filenames[1].ends_with("old.txt"));
    }

    #[test]
    fn search_excludes_git_internal_files() {
        let dir = temp_path("search-ignore-git");
        std::fs::create_dir_all(dir.join(".git/objects")).expect("git internals should be created");
        std::fs::create_dir_all(dir.join("src")).expect("src should be created");
        fs::write(dir.join(".git/objects/hidden.txt"), "needle hidden\n").expect("write git file");
        fs::write(dir.join("src/visible.txt"), "needle visible\n").expect("write visible file");

        let globbed = glob_search("**/*.txt", Some(dir.to_string_lossy().as_ref()))
            .expect("glob should succeed");
        assert_eq!(globbed.num_files, 1);
        assert!(globbed.filenames[0].ends_with("visible.txt"));
        assert!(!globbed.filenames.iter().any(|path| path.contains(".git")));

        let grep_output = grep_search(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            glob: Some(String::from("*.txt")),
            output_mode: Some(String::from("files_with_matches")),
            before: None,
            after: None,
            context_short: None,
            context: None,
            line_numbers: Some(true),
            case_insensitive: Some(false),
            file_type: None,
            head_limit: Some(10),
            offset: Some(0),
            multiline: Some(false),
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
    fn grep_search_rejects_empty_pattern() {
        let dir = temp_path("grep-empty-pattern");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("file.txt"), "anything\n").expect("write file");

        let err = grep_search(&GrepSearchInput {
            pattern: String::new(),
            path: Some(dir.to_string_lossy().into_owned()),
            glob: Some(String::from("*.txt")),
            output_mode: Some(String::from("files_with_matches")),
            before: None,
            after: None,
            context_short: None,
            context: None,
            line_numbers: Some(true),
            case_insensitive: Some(false),
            file_type: None,
            head_limit: Some(10),
            offset: Some(0),
            multiline: Some(false),
        })
        .expect_err("empty pattern should be rejected");
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert!(err.to_string().contains("pattern is required"));
    }

    #[test]
    fn grep_search_content_truncates_very_long_lines() {
        let dir = temp_path("grep-long-lines");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        let long_line = format!("needle {}", "x".repeat(MAX_GREP_LINE_LENGTH + 500));
        fs::write(dir.join("long.txt"), format!("{long_line}\n")).expect("write long file");

        let output = grep_search(&GrepSearchInput {
            pattern: String::from("needle"),
            path: Some(dir.to_string_lossy().into_owned()),
            glob: Some(String::from("*.txt")),
            output_mode: Some(String::from("content")),
            before: None,
            after: None,
            context_short: None,
            context: None,
            line_numbers: Some(true),
            case_insensitive: Some(false),
            file_type: None,
            head_limit: Some(10),
            offset: Some(0),
            multiline: Some(false),
        })
        .expect("grep should succeed");

        let content = output.content.expect("content output");
        assert!(content.contains("needle"));
        assert!(content.ends_with("..."));
        assert!(content.len() < long_line.len());
    }

    #[test]
    fn workspace_search_returns_ranked_candidates_snippets_and_limits() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search");
        std::fs::create_dir_all(dir.join("src")).expect("src should be created");
        std::fs::create_dir_all(dir.join("node_modules/pkg")).expect("ignored should be created");
        fs::write(
            dir.join("src/search.rs"),
            "pub fn workspace_search() {\n    // agentic search implementation\n}\n",
        )
        .expect("write search file");
        fs::write(
            dir.join("node_modules/pkg/noise.rs"),
            "agentic search implementation noise\n",
        )
        .expect("write ignored file");
        fs::write(dir.join("src/skip.md"), "agentic search implementation\n")
            .expect("write skipped extension");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("agentic search implementation"),
            paths: Some(vec![String::from("src"), String::from("node_modules")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(20),
            max_snippets: Some(10),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(!output.needs_clarification);
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/search.rs"));
        assert!(output.candidates[0].score > 0.0);
        assert!(output.snippets[0]
            .preview
            .contains("agentic search implementation"));
        assert_eq!(output.limits.scanned_files, 1);
        assert!(output.limits.skipped_files >= 1);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_reports_not_found_with_scope() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-empty");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("notes.txt"), "alpha beta\n").expect("write file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("missing needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.needs_clarification);
        assert!(output.candidates.is_empty());
        assert!(output.snippets.is_empty());
        assert_eq!(output.limits.scanned_files, 1);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_rejects_paths_outside_workspace() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-boundary");
        let outside = temp_path("workspace-search-outside");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        std::fs::create_dir_all(&outside).expect("outside should be created");
        std::env::set_current_dir(&dir).expect("set cwd");

        let err = workspace_search(&WorkspaceSearchInput {
            query: String::from("anything"),
            paths: Some(vec![outside.to_string_lossy().into_owned()]),
            mode: Some(String::from("text")),
            include_ext: None,
            max_files: None,
            max_snippets: None,
            context: None,
            literal: None,
        })
        .expect_err("outside path should be rejected");

        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(outside);
    }
}
