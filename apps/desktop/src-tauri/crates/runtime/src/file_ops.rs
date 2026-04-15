use std::cmp::Reverse;
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

use crate::pdf_liteparse;
use crate::tool_hard_denylist::reject_sensitive_file_path;

/// Upper bound for loading a single file as UTF-8 text in `read_file` (plain text and `.ipynb` raw JSON).
pub const MAX_TEXT_FILE_READ_BYTES: u64 = 10 * 1024 * 1024;

/// Upper bound for `write_file` body size (aligned with claw-code `MAX_WRITE_SIZE` at the pinned SHA).
pub const MAX_WRITE_FILE_BYTES: usize = 10 * 1024 * 1024;

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

/// Read a file as text for the agent. Plain UTF-8 text uses line-based `offset` / `limit`.
/// `.ipynb` is rendered as numbered plain text. `.pdf` uses `pages` (1-based, e.g. `"1-3"` or `"5"`).
/// Common image formats return dimensions and format metadata (pixels are not passed to the LLM in this build).
pub fn read_file(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    pages: Option<&str>,
) -> io::Result<ReadFileOutput> {
    let attempted_path = normalize_path_allow_missing(path)?;
    reject_sensitive_file_path(&attempted_path)?;
    let absolute_path = attempted_path.canonicalize().map_err(|error| {
        annotate_read_file_error(error, &attempted_path)
    })?;
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
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") => {
            if pages.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` applies only to PDF files",
                ));
            }
            read_image_summary(&absolute_path)
                .map_err(|error| annotate_read_file_error(error, &absolute_path))?
        }
        _ => {
            if pages.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "`pages` applies only to PDF files",
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
    let search_pattern = if Path::new(pattern).is_absolute() {
        pattern.to_owned()
    } else {
        base_dir.join(pattern).to_string_lossy().into_owned()
    };

    let mut matches = Vec::new();
    let entries = glob::glob(&search_pattern)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    for entry in entries.flatten() {
        if entry.is_file() {
            matches.push(entry);
        }
    }

    matches.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .map(Reverse)
    });

    let truncated = matches.len() > 100;
    let filenames = matches
        .into_iter()
        .take(100)
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    Ok(GlobSearchOutput {
        duration_ms: started.elapsed().as_millis(),
        num_files: filenames.len(),
        filenames,
        truncated,
    })
}

pub fn grep_search(input: &GrepSearchInput) -> io::Result<GrepSearchOutput> {
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

    for file_path in collect_search_files(&base_path)? {
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
                    content_lines.push(format!("{prefix}{line}"));
                }
            }
        }
    }

    let (filenames, applied_limit, applied_offset) =
        apply_limit(filenames, input.head_limit, input.offset);
    let content_output = if output_mode == "content" {
        let (lines, limit, offset) = apply_limit(content_lines, input.head_limit, input.offset);
        return Ok(GrepSearchOutput {
            mode: Some(output_mode),
            num_files: filenames.len(),
            filenames,
            num_lines: Some(lines.len()),
            content: Some(lines.join("\n")),
            num_matches: None,
            applied_limit: limit,
            applied_offset: offset,
        });
    } else {
        None
    };

    Ok(GrepSearchOutput {
        mode: Some(output_mode.clone()),
        num_files: filenames.len(),
        filenames,
        content: content_output,
        num_lines: None,
        num_matches: (output_mode == "count").then_some(total_matches),
        applied_limit,
        applied_offset,
    })
}

fn collect_search_files(base_path: &Path) -> io::Result<Vec<PathBuf>> {
    if base_path.is_file() {
        return Ok(vec![base_path.to_path_buf()]);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(base_path) {
        let entry = entry.map_err(|error| io::Error::other(error.to_string()))?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

fn matches_optional_filters(
    path: &Path,
    glob_filter: Option<&Pattern>,
    file_type: Option<&str>,
) -> bool {
    if let Some(glob_filter) = glob_filter {
        let path_string = path.to_string_lossy();
        if !glob_filter.matches(&path_string) && !glob_filter.matches_path(path) {
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
        edit_file, glob_search, grep_search, read_file, write_file, GrepSearchInput,
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
        let write_output = write_file(path.to_string_lossy().as_ref(), "one\ntwo\nthree")
            .expect("write should succeed");
        assert_eq!(write_output.kind, "create");

        let read_output = read_file(path.to_string_lossy().as_ref(), Some(1), Some(1), None)
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
        let out = read_file(path.to_string_lossy().as_ref(), None, None, None).expect("read ipynb");
        assert!(out.file.content.contains("Cell[0]"));
        assert!(out.file.content.contains("print(1)"));
    }

    #[test]
    fn read_rejects_oversized_plain_text_file() {
        let path = temp_path("huge.txt");
        let size = (MAX_TEXT_FILE_READ_BYTES as usize).saturating_add(1);
        let big = vec![b'n'; size];
        fs::write(&path, &big).expect("write");
        let err = read_file(path.to_string_lossy().as_ref(), None, None, None)
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
}
